"""Explicit Alembic execution, read-only startup checks, and safe baselining.

Nothing in this module stamps a database automatically. Validation is a separate
operator action; see docs/migrations.md before adopting an existing database.
"""

import argparse
from pathlib import Path
import re

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

BASELINE_REVISION = "0001_initial"
SEARCH_REVISION = "0002_ranked_search"
_BACKEND = Path(__file__).resolve().parents[1]


def migration_config(connection: Connection | None = None) -> Config:
    config = Config(str(_BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(_BACKEND / "alembic"))
    if connection is not None:
        config.attributes["connection"] = connection
    return config


def physical_schema(connection: Connection) -> str | None:
    return connection.get_execution_options().get("schema_translate_map", {}).get(None)


def upgrade_database(engine: Engine) -> None:
    """Upgrade explicitly; refuse to create over an unversioned existing schema."""
    with engine.begin() as connection:
        schema = physical_schema(connection)
        inspector = sa.inspect(connection)
        tables = set(inspector.get_table_names(schema=schema))
        current = MigrationContext.configure(connection, opts={"version_table_schema": schema}).get_current_heads()
        if not current and tables & {"patients", "notes", "encounters", "app_metadata"}:
            raise RuntimeError(
                "Existing application tables have no Alembic revision. Back up and validate the schema, "
                "then explicitly stamp the verified revision; see docs/migrations.md. No tables were changed."
            )
        command.upgrade(migration_config(connection), "head")


def require_schema_current(engine: Engine) -> None:
    """Check revision state only. Startup never creates, upgrades, or stamps."""
    expected = set(ScriptDirectory.from_config(migration_config()).get_heads())
    with engine.connect() as connection:
        actual = set(MigrationContext.configure(
            connection, opts={"version_table_schema": physical_schema(connection)}
        ).get_current_heads())
    if actual != expected:
        raise RuntimeError(
            f"Database schema is not current (found {sorted(actual) or 'unversioned'}, "
            f"expected {sorted(expected)}). Run `alembic -c backend/alembic.ini upgrade head` "
            "before starting the API. For existing unversioned tables, validate and explicitly "
            "baseline first; see docs/migrations.md."
        )


# Frozen baseline requirements, independent of future ORM model changes.
# (SQLAlchemy type, nullable). SQLAlchemy's dialect compiler supplies native UUID
# versus SQLite CHAR(32), and TIMESTAMPTZ versus DATETIME consistently.
def _baseline_columns():
    return {
        "patients": {
            "id": (sa.Uuid(), False), "first_name": (sa.String(100), False),
            "last_name": (sa.String(100), False), "dob": (sa.Date(), False),
            "status": (sa.String(9), False), "email": (sa.String(254), True),
            "phone": (sa.String(50), True), "address": (sa.String(500), True),
            "blood_type": (sa.String(3), True), "last_visit": (sa.Date(), True),
            "allergies": (sa.JSON(), False), "conditions": (sa.JSON(), False),
            "created_at": (sa.DateTime(timezone=True), False),
            "updated_at": (sa.DateTime(timezone=True), False),
        },
        "notes": {
            "id": (sa.Uuid(), False), "patient_id": (sa.Uuid(), False),
            "encounter_id": (sa.Integer(), True),
            "timestamp": (sa.DateTime(timezone=True), False), "content": (sa.Text(), False),
        },
        "encounters": {
            "id": (sa.Integer(), False), "patient_id": (sa.Uuid(), False),
            "doctor_name": (sa.String(100), False), "reason": (sa.Text(), False),
            "timestamp": (sa.DateTime(timezone=True), False),
        },
        "app_metadata": {"key": (sa.String(100), False), "value": (sa.Text(), False)},
    }


_ORDINARY_INDEXES = {
    "patients": {"ix_patients_status": ["status"], "ix_patients_name": ["last_name", "first_name"],
                 "ix_patients_last_visit": ["last_visit"]},
    "notes": {"ix_notes_patient_id": ["patient_id"], "ix_notes_encounter_id": ["encounter_id"],
              "ix_notes_timestamp": ["timestamp"]},
    "encounters": {"ix_encounters_patient_id": ["patient_id"], "ix_encounters_timestamp": ["timestamp"]},
    "app_metadata": {},
}


def _normalize_expression(expression: str) -> str:
    """Normalize only PostgreSQL's harmless deparser casts and parentheses.

    String literals are preserved byte-for-byte. Function/operator order and
    argument order remain significant, detecting incorrect named indexes.
    """
    expression = re.sub(r"\bTRIM\(BOTH FROM\s+", "trim(", expression, flags=re.IGNORECASE)
    expression = re.sub(r"CAST\((\w+) AS (?:VARCHAR|character varying)\)", r"\1::varchar", expression, flags=re.IGNORECASE)
    expression = re.sub(r"::character varying", "::varchar", expression, flags=re.IGNORECASE)
    pieces = re.split(r"('(?:''|[^'])*')", expression)
    for index in range(0, len(pieces), 2):
        piece = pieces[index].lower().replace("::text", "")
        if index and pieces[index - 1].startswith("'"):
            # PostgreSQL chooses VARCHAR for an untyped coalesce fallback.
            piece = re.sub(r"^::varchar\b", "", piece)
        pieces[index] = re.sub(r'[\s()"]+', "", piece)
    return "".join(pieces)


def _status_check_matches(sql: str) -> bool:
    normalized = _normalize_expression(sql).replace("::varchar", "").replace("::[]", "")
    # PostgreSQL deparses IN as = ANY(ARRAY[...]); SQLite preserves IN.
    return normalized in {
        "statusin'active','follow_up','inactive'",
        "status=anyarray['active','follow_up','inactive'][]",
        "status=anyarray['active','follow_up','inactive']",
    }


def _foreign_key_signature(foreign_key: dict, schema: str | None, default_schema: str):
    referred_schema = foreign_key.get("referred_schema")
    if referred_schema in {None, schema, default_schema if schema is None else schema}:
        referred_schema = None
    options = foreign_key.get("options", {})
    return (
        tuple(foreign_key["constrained_columns"]), referred_schema,
        foreign_key["referred_table"], tuple(foreign_key["referred_columns"]),
        options.get("ondelete", "NO ACTION").upper(),
        options.get("onupdate", "NO ACTION").upper(),
        bool(options.get("deferrable", False)), options.get("match", "SIMPLE").upper(),
    )



def _foreign_keys(connection: Connection, inspector, table_name: str, schema: str | None):
    reflected = inspector.get_foreign_keys(table_name, schema=schema)
    if connection.dialect.name != "sqlite":
        return reflected
    # SQLite's catalog retains actions on inline REFERENCES added with ALTER
    # TABLE. SQLAlchemy's DDL parser can omit those enforced foreign-key actions.
    preparer = connection.dialect.identifier_preparer
    prefix = f"{preparer.quote_schema(schema)}." if schema else ""
    table = preparer.quote_identifier(table_name)
    rows = connection.exec_driver_sql(f"PRAGMA {prefix}foreign_key_list({table})").mappings()
    grouped = {}
    for row in rows:
        grouped.setdefault(row["id"], []).append(row)
    result = []
    for rows in grouped.values():
        rows.sort(key=lambda row: row["seq"])
        columns = [row["from"] for row in rows]
        matched = next((fk for fk in reflected if fk["constrained_columns"] == columns), {})
        options = dict(matched.get("options", {}))
        options.update(ondelete=rows[0]["on_delete"], onupdate=rows[0]["on_update"])
        # SQLite reports MATCH NONE and implements the effective behavior of
        # MATCH SIMPLE. Preserve explicit nondefault reflected semantics.
        result.append({
            "constrained_columns": columns, "referred_schema": schema,
            "referred_table": rows[0]["table"],
            "referred_columns": [row["to"] for row in rows], "options": options,
        })
    # PRAGMA omits deferrability. Reject deferred constraints even if reflection
    # misses them on an ALTER-added inline REFERENCES clause.
    ddl = connection.scalar(sa.text(
        f"SELECT sql FROM {prefix}sqlite_schema WHERE type='table' AND name=:name"
    ), {"name": table_name}) or ""
    immediate_ddl = re.sub(r"\bNOT\s+DEFERRABLE\b", "", ddl, flags=re.IGNORECASE)
    if re.search(r"\bDEFERRABLE\b", immediate_ddl, flags=re.IGNORECASE):
        raise RuntimeError(f"Schema validation failed: {table_name} has unexpected deferrable foreign keys")
    return result


def _valid_encounter_id_generation(connection: Connection, column: dict, schema: str | None) -> bool:
    if connection.dialect.name != "postgresql":
        return column.get("default") is None and not column.get("identity")
    preparer = connection.dialect.identifier_preparer
    qualified = f"{preparer.quote_schema(schema)}.encounters" if schema else "encounters"
    sequence = connection.scalar(sa.text("SELECT pg_get_serial_sequence(:table_name, 'id')"), {"table_name": qualified})
    if not sequence:
        return False
    if column.get("identity"):
        # Both serial and GENERATED BY DEFAULT retain explicit-ID compatibility.
        return not column["identity"].get("always", False)
    match = re.fullmatch(r"nextval\('((?:''|[^'])+)'::regclass\)", column.get("default") or "")
    if not match:
        return False
    return bool(connection.scalar(sa.text(
        "SELECT CAST(CAST(:actual AS regclass) AS oid) = CAST(CAST(:owned AS regclass) AS oid)"
    ), {"actual": match[1].replace("''", "'"), "owned": sequence}))



def _validate_constraint_catalog(connection: Connection) -> None:
    if connection.dialect.name != "postgresql":
        return
    schema = physical_schema(connection) or sa.inspect(connection).default_schema_name
    invalid = connection.execute(sa.text("""
        SELECT t.relname, c.conname FROM pg_constraint c
        JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname=:schema AND t.relname IN ('patients','notes','encounters','app_metadata')
          AND (NOT c.convalidated OR (c.contype='c' AND c.connoinherit))
    """), {"schema": schema}).all()
    if invalid:
        raise RuntimeError(f"Schema validation failed: unvalidated/nonstandard constraints {invalid}")


def _validate_ordinary_index_catalog(connection: Connection) -> None:
    if connection.dialect.name != "postgresql":
        return
    schema = physical_schema(connection) or sa.inspect(connection).default_schema_name
    rows = connection.execute(sa.text("""
        SELECT ci.relname AS name, t.relname AS table_name, am.amname AS method,
               i.indisvalid, i.indisready, i.indnkeyatts, i.indnatts,
               i.indoption::smallint[] AS options
        FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid
        JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        JOIN pg_am am ON am.oid=ci.relam WHERE n.nspname=:schema
    """), {"schema": schema}).mappings()
    actual = {row["name"]: row for row in rows}
    for table_name, definitions in _ORDINARY_INDEXES.items():
        for name, columns in definitions.items():
            found = actual.get(name)
            if (not found or found["table_name"] != table_name or found["method"] != "btree"
                    or not found["indisvalid"] or not found["indisready"]
                    or found["indnkeyatts"] != len(columns) or found["indnatts"] != len(columns)
                    or any(found["options"])):
                raise RuntimeError(f"Schema validation failed: invalid/incompatible index {name}")


def validate_schema(engine: Engine, revision: str = BASELINE_REVISION) -> None:
    """Validate without data writes, DDL, or stamping. Raise on any mismatch."""
    if revision not in {BASELINE_REVISION, SEARCH_REVISION, "head"}:
        raise ValueError(f"Unsupported validation revision: {revision}")
    errors = []
    with engine.connect() as connection:
        inspector = sa.inspect(connection)
        schema = physical_schema(connection)
        tables = set(inspector.get_table_names(schema=schema))
        for table_name, expected in _baseline_columns().items():
            if table_name not in tables:
                errors.append(f"missing table {table_name}")
                continue
            actual = {column["name"]: column for column in inspector.get_columns(table_name, schema=schema)}
            if set(actual) != set(expected):
                errors.append(f"{table_name}: column mismatch; missing={sorted(set(expected) - set(actual))}, extra={sorted(set(actual) - set(expected))}")
            for name, (column_type, nullable) in expected.items():
                if name not in actual:
                    continue
                found = actual[name]
                if str(found["type"].compile(dialect=connection.dialect)).upper() != str(column_type.compile(dialect=connection.dialect)).upper():
                    errors.append(f"{table_name}.{name}: unexpected type {found['type']}")
                if found["nullable"] != nullable:
                    errors.append(f"{table_name}.{name}: nullable must be {nullable}")
                if (table_name, name) == ("encounters", "id"):
                    if not _valid_encounter_id_generation(connection, found, schema):
                        errors.append("encounters.id: expected generated integer primary key with its owned sequence")
                elif found.get("default") is not None or found.get("identity"):
                    errors.append(f"{table_name}.{name}: unexpected server default/identity")
                if found.get("computed"):
                    errors.append(f"{table_name}.{name}: unexpected generated column")
            expected_pk = ["key"] if table_name == "app_metadata" else ["id"]
            if inspector.get_pk_constraint(table_name, schema=schema).get("constrained_columns") != expected_pk:
                errors.append(f"{table_name}: incorrect primary key")
            if inspector.get_unique_constraints(table_name, schema=schema):
                errors.append(f"{table_name}: unexpected unique constraints")
            checks = inspector.get_check_constraints(table_name, schema=schema)
            if table_name == "patients":
                if (len(checks) != 1 or checks[0].get("name") != "patientstatus"
                        or not _status_check_matches(checks[0]["sqltext"])
                        or any(checks[0].get("dialect_options", {}).values())):
                    errors.append("patients: expected named patientstatus constraint allowing active/follow_up/inactive")
            elif checks:
                errors.append(f"{table_name}: unexpected check constraints")
            fks = {_foreign_key_signature(fk, schema, inspector.default_schema_name) for fk in _foreign_keys(connection, inspector, table_name, schema)}
            expected_fks = set()
            if table_name in {"encounters", "notes"}:
                expected_fks.add((("patient_id",), None, "patients", ("id",), "CASCADE", "NO ACTION", False, "SIMPLE"))
            if table_name == "notes":
                expected_fks.add((("encounter_id",), None, "encounters", ("id",), "SET NULL", "NO ACTION", False, "SIMPLE"))
            if fks != expected_fks:
                errors.append(f"{table_name}: foreign keys/delete behavior differ from baseline")
            indexes = {index["name"]: index for index in inspector.get_indexes(table_name, schema=schema)}
            for name, columns in _ORDINARY_INDEXES[table_name].items():
                found = indexes.get(name)
                if (not found or found.get("column_names") != columns or found.get("unique")
                        or found.get("column_sorting") or found.get("include_columns")
                        or found.get("dialect_options", {}).get("postgresql_using", "btree") != "btree"
                        or any(key.endswith("_where") and value is not None
                               for key, value in found.get("dialect_options", {}).items())):
                    errors.append(f"{table_name}: missing or incompatible index {name}")
            if any(index.get("unique") for index in indexes.values() if not index.get("duplicates_constraint")):
                errors.append(f"{table_name}: unexpected unique index")
        if errors:
            raise RuntimeError("Schema validation failed:\n- " + "\n- ".join(errors))
        _validate_constraint_catalog(connection)
        _validate_ordinary_index_catalog(connection)
        # Existing search index names must be correct even before revision 2;
        # missing search indexes are expected and will be added on upgrade.
        validate_search_indexes(connection, require_all=revision in {SEARCH_REVISION, "head"})


def validate_search_indexes(connection: Connection, *, require_all: bool) -> None:
    if connection.dialect.name != "postgresql":
        return
    definitions = ScriptDirectory.from_config(migration_config()).get_revision(SEARCH_REVISION).module.SEARCH_INDEXES
    schema = physical_schema(connection) or sa.inspect(connection).default_schema_name
    extension_schema = connection.scalar(sa.text(
        "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm'"
    ))
    if extension_schema not in {None, "public"}:
        raise RuntimeError(f"pg_trgm is installed in {extension_schema}; reviewed migration expects public. Do not stamp.")
    if require_all and extension_schema != "public":
        raise RuntimeError("Schema validation failed: pg_trgm extension is missing from public.")
    rows = connection.execute(sa.text("""
        SELECT ci.relname AS name, am.amname AS method,
               pg_get_expr(i.indexprs, i.indrelid) AS expression,
               pg_get_expr(i.indpred, i.indrelid) AS predicate,
               i.indisunique, i.indisvalid, i.indisready, i.indnkeyatts, i.indnatts,
               i.indoption[0] AS options,
               ARRAY(SELECT no.nspname || '.' || oc.opcname
                     FROM unnest(i.indclass) WITH ORDINALITY x(oid, ord)
                     JOIN pg_opclass oc ON oc.oid=x.oid
                     JOIN pg_namespace no ON no.oid=oc.opcnamespace ORDER BY x.ord) AS opclasses
        FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid
        JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        JOIN pg_am am ON am.oid=ci.relam
        WHERE n.nspname=:schema AND t.relname='patients'
    """), {"schema": schema}).mappings()
    actual = {row["name"]: row for row in rows}
    errors = []
    for name, (method, expression, trigram) in definitions.items():
        found = actual.get(name)
        if found is None:
            if require_all:
                errors.append(f"missing {name}")
            continue
        expected_opclass = "public.gin_trgm_ops" if trigram else "pg_catalog.text_ops"
        if (found["method"] != method or not found["expression"]
                or _normalize_expression(found["expression"]) != _normalize_expression(expression)
                or found["predicate"] is not None or found["indisunique"]
                or not found["indisvalid"] or not found["indisready"]
                or found["indnkeyatts"] != 1 or found["indnatts"] != 1
                or found["options"] != 0 or list(found["opclasses"]) != [expected_opclass]):
            errors.append(f"incompatible definition for {name}")
    if errors:
        raise RuntimeError("Search index validation failed:\n- " + "\n- ".join(errors))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="action", required=True)
    validate = subparsers.add_parser("validate", help="Read-only baseline validation; never stamps")
    validate.add_argument("--revision", choices=[BASELINE_REVISION, SEARCH_REVISION, "head"], required=True)
    subparsers.add_parser("upgrade", help="Explicitly run Alembic upgrade head")
    arguments = parser.parse_args()
    from .database import get_database_url, make_engine

    engine = make_engine(get_database_url())
    try:
        if arguments.action == "validate":
            validate_schema(engine, arguments.revision)
            print(f"Schema matches {arguments.revision}. Validation wrote no data and did not stamp.")
        else:
            upgrade_database(engine)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
