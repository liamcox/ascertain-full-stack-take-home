"""SQL-backed directory relevance, with a small SQLite compatibility layer.

PostgreSQL performs candidate filtering with pg_trgm operators and indexed
expressions. SQLite uses the same padded trigram-set similarity in SQL UDFs for
local tests; it is a correctness fallback, not the production search engine.
"""

import re
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import Index, String, case, cast, false, func, literal, or_, text
from sqlalchemy.engine import Engine
from sqlalchemy.schema import CreateIndex

from .models import Patient


FUZZY_THRESHOLD = 0.3
MATCH_LABELS = {
    "exact_id": "Exact ID",
    "exact_name": "Exact name",
    "exact_contact": "Exact contact",
    "name_prefix": "Name starts with",
    "substring": "Contains search",
    "fuzzy": "Possible match",
}


def sqlite_regexp_replace(value: str | None, pattern: str, replacement: str, flags: str = "") -> str:
    return re.sub(pattern, replacement, value or "", count=0 if "g" in flags else 1)


def trigram_similarity(left: str | None, right: str | None) -> float:
    """Mirror pg_trgm's lowercased, padded, deduplicated word trigrams.

    ASCII names have identical results. Unicode classification/case conversion
    can vary with PostgreSQL's locale, so PostgreSQL remains authoritative.
    """
    def trigrams(value):
        words = re.findall(r"[^\W_]+", (value or "").lower(), flags=re.UNICODE)
        return {
            padded[index:index + 3]
            for word in words
            for padded in [f"  {word} "]
            for index in range(len(padded) - 2)
        }

    a, b = trigrams(left), trigrams(right)
    union = a | b
    return len(a & b) / len(union) if union else 0.0


def name_expressions():
    def normalized(value):
        return func.lower(func.regexp_replace(func.trim(value), r"\s+", " ", "g"))

    return normalized(Patient.first_name + " " + Patient.last_name), normalized(Patient.first_name), normalized(Patient.last_name)


def contact_expressions():
    email = func.lower(func.coalesce(Patient.email, ""))
    phone = func.regexp_replace(func.coalesce(Patient.phone, ""), "[^0-9]", "", "g")
    return email, phone


def short_id_expression():
    # Both PostgreSQL UUID text and SQLite's compact UUID storage start with the
    # same eight hex characters displayed by the directory.
    return func.lower(func.substr(cast(Patient.id, String), 1, 8))


def ensure_search_indexes(engine: Engine) -> None:
    if engine.dialect.name != "postgresql":
        return

    full_name, first_name, last_name = name_expressions()
    email, phone = contact_expressions()
    gin_expressions = {
        "full_name": full_name,
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "phone": func.lower(func.coalesce(Patient.phone, "")),
        "phone_digits": phone,
        "conditions": func.lower(cast(Patient.conditions, String)),
    }
    indexes = [
        Index(f"ix_patients_search_{name}_trgm", expression.label("search_value"),
              postgresql_using="gin", postgresql_ops={"search_value": "public.gin_trgm_ops"})
        for name, expression in gin_expressions.items()
    ] + [
        Index("ix_patients_search_exact_name", full_name),
        Index("ix_patients_search_exact_email", email),
        Index("ix_patients_search_exact_phone", phone),
        Index("ix_patients_search_short_id", short_id_expression()),
    ]
    # Keep extension-dependent indexes outside create_all, so each new test
    # schema gets them only after the database-wide extension is available.
    for index in indexes:
        Patient.__table__.indexes.discard(index)
    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public"))
        for index in indexes:
            # SQLAlchemy applies schema_translate_map to the table and its
            # indexes. IF NOT EXISTS makes repeated application starts safe.
            connection.execute(CreateIndex(index, if_not_exists=True))


@dataclass(frozen=True)
class RankedSearch:
    predicate: object
    kind: object
    tier: object
    similarity: object
    short_id: bool


def ranked_search(search: str, dialect: str) -> RankedSearch:
    value = " ".join(search.strip().split()).lower()
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    full_name, first_name, last_name = name_expressions()
    email, phone_digits = contact_expressions()
    phone = func.lower(func.coalesce(Patient.phone, ""))
    conditions = func.lower(cast(Patient.conditions, String))

    id_match = false()
    is_short_id = bool(re.fullmatch(r"[0-9a-f]{8}", value))
    is_full_id = False
    if is_short_id:
        id_match = short_id_expression() == value
    elif re.fullmatch(r"[0-9a-f-]{32,36}", value):
        try:
            id_match = Patient.id == str(UUID(value))
            is_full_id = True
        except ValueError:
            pass

    exact_name = full_name == value
    exact_contact = email == value
    phone_query = re.sub(r"[^0-9]", "", value) if re.fullmatch(r"[0-9+().\s-]+", value) else ""
    if phone_query:
        exact_contact = or_(exact_contact, phone_digits == phone_query)
    prefix = or_(*(name.like(f"{escaped}%", escape="\\") for name in (full_name, first_name, last_name)))
    substring = or_(*(column.like(pattern, escape="\\") for column in (full_name, email, phone, conditions)))
    if phone_query:
        substring = or_(substring, phone_digits.like(f"%{phone_query}%"))

    # Similar names are suggestions only. IDs, emails, phone numbers, wildcard
    # literals and one/two-letter queries never receive fuzzy expansion.
    allow_fuzzy = (
        not is_short_id
        and not is_full_id
        and sum(character.isalpha() for character in value) >= 3
        and all(character.isalpha() or character in " '-" for character in value)
    )
    similarity = literal(0.0)
    fuzzy = false()
    if allow_fuzzy:
        similarities = [func.similarity(name, value) for name in (full_name, first_name, last_name)]
        similarity = (func.greatest if dialect == "postgresql" else func.max)(*similarities)
        if dialect == "postgresql":
            # % is indexable; similarity(...) >= threshold alone would score
            # every row. The caller sets its transaction-local GUC explicitly.
            fuzzy = or_(*(name.op("OPERATOR(public.%)")(value) for name in (full_name, first_name, last_name)))
        else:
            fuzzy = similarity >= FUZZY_THRESHOLD

    conditions_by_kind = [
        ("exact_id", id_match, 0),
        ("exact_name", exact_name, 1),
        ("exact_contact", exact_contact, 1),
        ("name_prefix", prefix, 2),
        ("substring", substring, 3),
        ("fuzzy", fuzzy, 4),
    ]
    return RankedSearch(
        predicate=or_(*(condition for _, condition, _ in conditions_by_kind)),
        kind=case(*[(condition, kind) for kind, condition, _ in conditions_by_kind]),
        tier=case(*[(condition, tier) for _, condition, tier in conditions_by_kind], else_=5),
        similarity=case((fuzzy, similarity), else_=0.0),
        short_id=is_short_id,
    )
