from datetime import date, datetime, timezone
from uuid import uuid4

from alembic import command
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import MetaData, String, delete, event, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.schema import DropIndex

from app.database import Base
from app.main import create_app
from app.migrations import (
    BASELINE_REVISION, SEARCH_REVISION, migration_config, physical_schema,
    require_schema_current, upgrade_database, validate_schema,
)
from app.models import AppMetadata, Encounter, Note, Patient


def revision_heads(engine):
    with engine.connect() as connection:
        return MigrationContext.configure(
            connection, opts={"version_table_schema": physical_schema(connection)}
        ).get_current_heads()


def add_existing_records(engine):
    timestamp = datetime(2026, 11, 1, 10, tzinfo=timezone.utc)
    with Session(engine) as session:
        patient = Patient(
            first_name="Avery", last_name="Bennett", dob=date(1985, 6, 15), status="active",
            allergies=["Penicillin"], conditions=["Asthma"], created_at=timestamp, updated_at=timestamp,
        )
        session.add(patient)
        session.flush()
        encounter = Encounter(patient_id=patient.id, doctor_name="Dr. Lee", reason="Existing visit", timestamp=timestamp)
        session.add(encounter)
        session.flush()
        old_note = Note(patient_id=patient.id, timestamp=timestamp, content="Existing unlinked note.")
        linked_note = Note(patient_id=patient.id, encounter_id=encounter.id, timestamp=timestamp, content="Existing encounter note.")
        session.add_all([old_note, linked_note, AppMetadata(key="existing-marker", value="preserved")])
        session.commit()
        return patient.id, old_note.id, linked_note.id, encounter.id, timestamp


def test_fresh_database_is_created_entirely_by_alembic(empty_db_engine):
    assert revision_heads(empty_db_engine) == ()
    upgrade_database(empty_db_engine)
    assert revision_heads(empty_db_engine) == (SEARCH_REVISION,)
    validate_schema(empty_db_engine, "head")
    require_schema_current(empty_db_engine)
    schema = empty_db_engine.get_execution_options().get("schema_translate_map", {}).get(None)
    assert {"patients", "encounters", "notes", "app_metadata", "alembic_version"} <= set(
        inspect(empty_db_engine).get_table_names(schema=schema)
    )
    with TestClient(create_app(empty_db_engine, seed_enabled=False)) as client:
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/patients").json()["total"] == 0


def test_existing_populated_schema_requires_validation_and_explicit_stamp(empty_db_engine):
    # Reproduce the previous application's complete, unversioned schema.
    # Only the test uses create_all; migrations contain frozen Alembic DDL.
    Base.metadata.create_all(empty_db_engine)
    patient_id, old_note_id, linked_note_id, encounter_id, timestamp = add_existing_records(empty_db_engine)
    with pytest.raises(RuntimeError, match="no Alembic revision"):
        upgrade_database(empty_db_engine)
    with pytest.raises(RuntimeError, match="unversioned"):
        require_schema_current(empty_db_engine)
    validate_schema(empty_db_engine, BASELINE_REVISION)
    assert revision_heads(empty_db_engine) == ()
    schema = empty_db_engine.get_execution_options().get("schema_translate_map", {}).get(None)
    assert "alembic_version" not in inspect(empty_db_engine).get_table_names(schema=schema)
    with empty_db_engine.begin() as connection:
        command.stamp(migration_config(connection), BASELINE_REVISION)
    upgrade_database(empty_db_engine)
    validate_schema(empty_db_engine, "head")
    with Session(empty_db_engine) as session:
        assert session.get(Patient, patient_id).conditions == ["Asthma"]
        assert session.get(Patient, patient_id).created_at.replace(tzinfo=timezone.utc) == timestamp
        assert session.get(Note, old_note_id).content == "Existing unlinked note."
        assert session.get(Note, old_note_id).encounter_id is None
        assert session.get(Note, linked_note_id).encounter_id == encounter_id
        assert session.get(Encounter, encounter_id).patient_id == patient_id
        assert session.get(AppMetadata, "existing-marker").value == "preserved"
    with TestClient(create_app(empty_db_engine, seed_enabled=False)) as client:
        assert client.get(f"/patients/{patient_id}").status_code == 200
        assert len(client.get(f"/patients/{patient_id}/notes").json()) == 2


def test_upgrade_from_initial_revision_preserves_rows(empty_db_engine):
    with empty_db_engine.begin() as connection:
        command.upgrade(migration_config(connection), BASELINE_REVISION)
    patient_id, *_ = add_existing_records(empty_db_engine)
    upgrade_database(empty_db_engine)
    assert revision_heads(empty_db_engine) == (SEARCH_REVISION,)
    with Session(empty_db_engine) as session:
        assert session.get(Patient, patient_id).first_name == "Avery"


def test_upgrade_is_idempotent_and_keeps_existing_records(db_engine):
    patient_id, old_note_id, *_ = add_existing_records(db_engine)
    upgrade_database(db_engine)
    upgrade_database(db_engine)
    assert revision_heads(db_engine) == (SEARCH_REVISION,)
    with Session(db_engine) as session:
        assert session.get(Patient, patient_id) is not None
        assert session.get(Note, old_note_id) is not None


@pytest.mark.parametrize("state", ["blank", "unversioned", "outdated"])
def test_startup_rejects_unready_database_without_ddl(empty_db_engine, state):
    if state == "unversioned":
        Base.metadata.create_all(empty_db_engine)
    elif state == "outdated":
        with empty_db_engine.begin() as connection:
            command.upgrade(migration_config(connection), BASELINE_REVISION)
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement.strip().upper())

    event.listen(empty_db_engine, "before_cursor_execute", capture)
    try:
        with pytest.raises(RuntimeError, match="Database schema is not current"):
            with TestClient(create_app(empty_db_engine, seed_enabled=False)):
                pass
    finally:
        event.remove(empty_db_engine, "before_cursor_execute", capture)
    assert not any(sql.startswith(("CREATE ", "ALTER ", "DROP ", "INSERT ", "UPDATE ", "DELETE ")) for sql in statements)


def test_current_database_startup_performs_no_schema_writes(db_engine):
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement.strip().upper())

    event.listen(db_engine, "before_cursor_execute", capture)
    try:
        with TestClient(create_app(db_engine, seed_enabled=False)) as client:
            assert client.get("/health").status_code == 200
    finally:
        event.remove(db_engine, "before_cursor_execute", capture)
    assert not any(sql.startswith(("CREATE ", "ALTER ", "DROP ")) for sql in statements)


@pytest.mark.parametrize("drift", ["type", "nullable", "foreign_key", "check", "missing_encounter_column"])
def test_baseline_validation_rejects_schema_drift(empty_db_engine, drift):
    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        table.to_metadata(metadata)
    if drift == "type":
        metadata.tables["patients"].c.first_name.type = String(50)
    elif drift == "nullable":
        metadata.tables["encounters"].c.patient_id.nullable = True
    elif drift == "foreign_key":
        next(iter(metadata.tables["encounters"].foreign_key_constraints)).ondelete = "RESTRICT"
    elif drift == "check":
        patients = metadata.tables["patients"]
        for constraint in list(patients.constraints):
            if constraint.name == "patientstatus":
                patients.constraints.remove(constraint)
    else:
        notes = metadata.tables["notes"]
        for constraint in list(notes.foreign_key_constraints):
            if "encounter_id" in constraint.column_keys:
                notes.constraints.remove(constraint)
        for index in list(notes.indexes):
            if index.name == "ix_notes_encounter_id":
                notes.indexes.remove(index)
        notes._columns.remove(notes.c.encounter_id)
    metadata.create_all(empty_db_engine)
    with pytest.raises(RuntimeError, match="Schema validation failed"):
        validate_schema(empty_db_engine, BASELINE_REVISION)
    assert revision_heads(empty_db_engine) == ()


def test_baseline_validation_requires_ordinary_indexes(db_engine):
    with db_engine.begin() as connection:
        index = next(index for index in Patient.__table__.indexes if index.name == "ix_patients_name")
        connection.execute(DropIndex(index))
    with pytest.raises(RuntimeError, match="ix_patients_name"):
        validate_schema(db_engine, BASELINE_REVISION)


def test_migrated_constraints_preserve_encounter_relationships(db_engine):
    patient_id, old_note_id, linked_note_id, first_id, timestamp = add_existing_records(db_engine)
    with Session(db_engine) as session:
        second = Encounter(patient_id=patient_id, doctor_name="Dr. Jones", reason="Follow-up", timestamp=timestamp)
        session.add(second)
        session.commit()
        second_id = second.id
    with db_engine.begin() as connection:
        connection.execute(delete(Encounter).where(Encounter.id == first_id))
    with Session(db_engine) as session:
        assert session.get(Note, linked_note_id).encounter_id is None
        assert session.get(Note, old_note_id).encounter_id is None
        assert session.get(Encounter, second_id).patient_id == patient_id
    with db_engine.begin() as connection:
        connection.execute(delete(Patient).where(Patient.id == patient_id))
    with Session(db_engine) as session:
        assert session.scalars(select(Encounter)).all() == []
        assert session.scalars(select(Note)).all() == []


def test_migrated_status_check_and_patient_foreign_key_are_enforced(db_engine):
    with pytest.raises(IntegrityError):
        with db_engine.begin() as connection:
            connection.execute(Encounter.__table__.insert().values(
                patient_id=str(uuid4()), doctor_name="Dr. Lee", reason="Invalid patient",
                timestamp=datetime.now(timezone.utc),
            ))
    with pytest.raises(IntegrityError):
        with Session(db_engine) as session:
            patient = Patient(first_name="Avery", last_name="Bennett", dob=date(1985, 6, 15), status="invalid")
            session.add(patient)
            session.commit()


def test_postgresql_search_indexes_are_validated_and_created(db_engine):
    if db_engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL catalog and pg_trgm integration test")
    validate_schema(db_engine, "head")
    schema = db_engine.get_execution_options().get("schema_translate_map", {}).get(None)
    with db_engine.begin() as connection:
        quoted = connection.dialect.identifier_preparer.quote_schema(schema) if schema else "public"
        connection.execute(text(f"DROP INDEX {quoted}.ix_patients_search_exact_email"))
        connection.execute(text(f"CREATE INDEX ix_patients_search_exact_email ON {quoted}.patients (first_name)"))
    with pytest.raises(RuntimeError, match="incompatible definition for ix_patients_search_exact_email"):
        validate_schema(db_engine, BASELINE_REVISION)


@pytest.mark.parametrize("expression,expected", [
    ("lower((COALESCE(email, ''::character varying))::text)", "lower(coalesce(email, ''))"),
    (r"lower(regexp_replace(TRIM(BOTH FROM (((first_name)::text || ' '::text) || (last_name)::text)), '\s+'::text, ' '::text, 'g'::text))",
     r"lower(regexp_replace(trim(first_name || ' ' || last_name), '\s+', ' ', 'g'))"),
    ("lower((conditions)::character varying::text)", "lower(CAST(conditions AS VARCHAR))"),
    ("lower(substr((id)::character varying::text, 1, 8))", "lower(substr(CAST(id AS VARCHAR), 1, 8))"),
])
def test_postgresql_deparser_normalization_preserves_existing_expressions(expression, expected):
    from app.migrations import _normalize_expression

    assert _normalize_expression(expression) == _normalize_expression(expected)
    assert _normalize_expression("lower(coalesce(first_name, ''))") != _normalize_expression("lower(coalesce(email, ''))")


def test_postgresql_baseline_rejects_missing_encounter_sequence_default(db_engine):
    if db_engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL SERIAL integration test")
    with db_engine.begin() as connection:
        schema = physical_schema(connection) or "public"
        quoted = connection.dialect.identifier_preparer.quote_schema(schema)
        connection.execute(text(f"ALTER TABLE {quoted}.encounters ALTER COLUMN id DROP DEFAULT"))
    with pytest.raises(RuntimeError, match="expected generated integer primary key"):
        validate_schema(db_engine, BASELINE_REVISION)


def test_postgresql_search_revision_rejects_other_table_index_name_collision(empty_db_engine):
    if empty_db_engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL index namespace integration test")
    with empty_db_engine.begin() as connection:
        command.upgrade(migration_config(connection), BASELINE_REVISION)
        schema = physical_schema(connection) or "public"
        quoted = connection.dialect.identifier_preparer.quote_schema(schema)
        connection.execute(text(f"CREATE INDEX ix_patients_search_exact_email ON {quoted}.notes (content)"))
    with pytest.raises(RuntimeError, match="missing ix_patients_search_exact_email"):
        upgrade_database(empty_db_engine)
    assert revision_heads(empty_db_engine) == (BASELINE_REVISION,)


def test_postgresql_baseline_rejects_unvalidated_constraints(db_engine):
    if db_engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL NOT VALID integration test")
    with db_engine.begin() as connection:
        schema = physical_schema(connection) or "public"
        quoted = connection.dialect.identifier_preparer.quote_schema(schema)
        connection.execute(text(f"ALTER TABLE {quoted}.patients DROP CONSTRAINT patientstatus"))
        connection.execute(text(
            f"ALTER TABLE {quoted}.patients ADD CONSTRAINT patientstatus "
            "CHECK (status IN ('active', 'follow_up', 'inactive')) NOT VALID"
        ))
    with pytest.raises(RuntimeError, match="Schema validation failed"):
        validate_schema(db_engine, BASELINE_REVISION)


@pytest.mark.parametrize("action,deferrability,valid", [
    ("SET NULL", "", True),
    ("RESTRICT", "", False),
    ("SET NULL", " DEFERRABLE INITIALLY DEFERRED", False),
])
def test_sqlite_legacy_alter_added_reference_uses_enforced_actions(
    empty_db_engine, action, deferrability, valid,
):
    if empty_db_engine.dialect.name != "sqlite":
        pytest.skip("SQLite ALTER TABLE reflection regression")
    Base.metadata.create_all(empty_db_engine, tables=[
        Patient.__table__, Encounter.__table__, AppMetadata.__table__,
    ])
    with empty_db_engine.begin() as connection:
        # Original notes table plus the prior helper's additive ALTER. This DDL
        # layout makes SQLAlchemy omit the inline FK's action from reflection.
        connection.exec_driver_sql(
            "CREATE TABLE notes (id CHAR(32) NOT NULL, patient_id CHAR(32) NOT NULL, "
            "timestamp DATETIME NOT NULL, content TEXT NOT NULL, PRIMARY KEY(id), "
            "FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE)"
        )
        connection.exec_driver_sql(
            "ALTER TABLE notes ADD COLUMN encounter_id INTEGER "
            f"REFERENCES encounters(id) ON DELETE {action}{deferrability}"
        )
        for column in ("patient_id", "timestamp", "encounter_id"):
            connection.exec_driver_sql(f"CREATE INDEX ix_notes_{column} ON notes({column})")
    if not valid:
        with pytest.raises(RuntimeError, match="Schema validation failed"):
            validate_schema(empty_db_engine, BASELINE_REVISION)
        assert revision_heads(empty_db_engine) == ()
        return
    patient_id, old_note_id, linked_note_id, encounter_id, _ = add_existing_records(empty_db_engine)
    validate_schema(empty_db_engine, BASELINE_REVISION)
    assert revision_heads(empty_db_engine) == ()
    with empty_db_engine.begin() as connection:
        command.stamp(migration_config(connection), BASELINE_REVISION)
    upgrade_database(empty_db_engine)
    validate_schema(empty_db_engine, "head")
    with empty_db_engine.begin() as connection:
        connection.execute(delete(Encounter).where(Encounter.id == encounter_id))
    with Session(empty_db_engine) as session:
        assert session.get(Patient, patient_id) is not None
        assert session.get(Note, linked_note_id).encounter_id is None
        assert session.get(Note, old_note_id).encounter_id is None
