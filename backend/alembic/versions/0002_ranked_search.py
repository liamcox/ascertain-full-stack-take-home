"""Manage pg_trgm and the existing, unchanged ranked-search expressions.

Revision ID: 0002_ranked_search
Revises: 0001_initial
"""

from alembic import op
import sqlalchemy as sa

revision = "0002_ranked_search"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

# Keep these definitions frozen. They intentionally match the original search
# expressions, including casts, normalization, and the public operator class.
SEARCH_INDEXES = {
    "ix_patients_search_full_name_trgm": ("gin", r"lower(regexp_replace(trim(first_name || ' ' || last_name), '\s+', ' ', 'g'))", True),
    "ix_patients_search_first_name_trgm": ("gin", r"lower(regexp_replace(trim(first_name), '\s+', ' ', 'g'))", True),
    "ix_patients_search_last_name_trgm": ("gin", r"lower(regexp_replace(trim(last_name), '\s+', ' ', 'g'))", True),
    "ix_patients_search_email_trgm": ("gin", "lower(coalesce(email, ''))", True),
    "ix_patients_search_phone_trgm": ("gin", "lower(coalesce(phone, ''))", True),
    "ix_patients_search_phone_digits_trgm": ("gin", "regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')", True),
    "ix_patients_search_conditions_trgm": ("gin", "lower(CAST(conditions AS VARCHAR))", True),
    "ix_patients_search_exact_name": ("btree", r"lower(regexp_replace(trim(first_name || ' ' || last_name), '\s+', ' ', 'g'))", False),
    "ix_patients_search_exact_email": ("btree", "lower(coalesce(email, ''))", False),
    "ix_patients_search_exact_phone": ("btree", "regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')", False),
    "ix_patients_search_short_id": ("btree", "lower(substr(CAST(id AS VARCHAR), 1, 8))", False),
}


def _schema():
    return op.get_context().opts.get("version_table_schema")


def _table():
    preparer = op.get_bind().dialect.identifier_preparer
    schema = _schema()
    return f"{preparer.quote_schema(schema)}.patients" if schema else "patients"


def upgrade() -> None:
    if op.get_context().dialect.name != "postgresql":
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public")
    # Existing installations may already have precisely these indexes from the
    # old startup helper. Refuse name collisions with another definition before
    # marking the revision successful, instead of blindly trusting IF NOT EXISTS.
    if not op.get_context().as_sql:
        from app.migrations import validate_search_indexes

        validate_search_indexes(op.get_bind(), require_all=False)
    for name, (method, expression, trigram) in SEARCH_INDEXES.items():
        operator = " public.gin_trgm_ops" if trigram else ""
        op.execute(sa.text(f"CREATE INDEX IF NOT EXISTS {name} ON {_table()} USING {method} ({expression}{operator})"))
    if not op.get_context().as_sql:
        # Index names are schema-wide: also catch IF NOT EXISTS collisions with
        # an unrelated table/relation, before the transaction can be committed.
        validate_search_indexes(op.get_bind(), require_all=True)


def downgrade() -> None:
    if op.get_context().dialect.name != "postgresql":
        return
    for name in reversed(SEARCH_INDEXES):
        op.drop_index(name, table_name="patients", schema=_schema())
    # pg_trgm is database-wide and may be used by another application/schema.
    # Keep it installed; dropping the extension would affect unrelated objects.
