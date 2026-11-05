# Database migrations

Alembic is the sole production schema manager. API startup checks that its database
is at the current revision, then runs the existing optional 120-patient demo seed.
Startup performs no schema DDL and never stamps a database. `SEED_DATA=false`
disables demo seeding; migration commands never seed patients.

The reviewed history is:

| Revision | Database changes |
| --- | --- |
| `0001_initial` | `patients`, `encounters`, `notes`, `app_metadata`; primary keys, patient status check, foreign keys and ordinary indexes |
| `0002_ranked_search` | PostgreSQL `public.pg_trgm` and the original seven GIN/four exact-search indexes; no changes to search or ranking |

A patient has many encounters. Both encounters and notes reference their patient
with `ON DELETE CASCADE`. A note's nullable encounter reference uses `ON DELETE
SET NULL`. SQLite gets the same relational schema; PostgreSQL-only extension and
search indexes are intentionally skipped there.

## Fresh databases

From the repository root after installing backend requirements:

```sh
export DATABASE_URL='postgresql+psycopg://USER:PASSWORD@localhost:5432/NEW_DATABASE'
backend/.venv/bin/alembic -c backend/alembic.ini upgrade head
backend/.venv/bin/alembic -c backend/alembic.ini current
backend/.venv/bin/alembic -c backend/alembic.ini heads
```

The application and Alembic share `app.database.get_database_url()`, including the
`postgres://`/`postgresql://` hosting-provider aliases. The URL is read from the
environment; passwords are not committed to `alembic.ini`. The migration user needs
DDL privileges and permission to install `pg_trgm` in `public`; an administrator
can preinstall that extension if the deployment user cannot. An existing extension
in another schema is rejected rather than silently changing its ownership/schema.

The Docker backend command runs `python -m app.migrations upgrade` before Uvicorn.
Run one migration release job before starting multiple API instances; do not run
competing migrators. The helper refuses unversioned application tables and points
to the explicit baseline process below. An upgrade failure prevents API startup.

For a **new, separate** SQLite file:

```sh
export DATABASE_URL='sqlite:////absolute/path/to/new-demo.db'
backend/.venv/bin/alembic -c backend/alembic.ini upgrade head
```

Never point these example new-database commands at an existing file without
first checking its revision and following the adoption procedure.

## Adopt an existing database safely

1. Stop writers for the adoption window. Confirm the intended database URL and
   take a restorable backup. Record row counts and keep the old application
   release available. Validate a restored copy first where practical.
2. Check revision state with `alembic current`. An unversioned database is not
   automatically compatible merely because table names match.
3. From `backend/`, run the **read-only** validator:

   ```sh
   .venv/bin/python -m app.migrations validate --revision 0001_initial
   ```

   The validator requires the full current schema, including encounters and
   `notes.encounter_id`. It checks exact columns, dialect-specific types and
   nullability, primary keys, patient status values, foreign keys and delete
   behavior, ordinary indexes, and PostgreSQL encounter ID generation. It
   rejects unexpected unique/check constraints, unvalidated PostgreSQL
   constraints, invalid indexes, and incorrect existing named search indexes.
   Extra unrelated tables and extra nonunique indexes are permitted; custom
   triggers or other application-specific objects still need operator review.
   Validation does not inspect/repair application data or stamp a revision.
4. If validation succeeds, explicitly baseline that verified schema, then upgrade:

   ```sh
   .venv/bin/alembic stamp 0001_initial
   .venv/bin/alembic upgrade head
   .venv/bin/python -m app.migrations validate --revision head
   ```

   Stamping is an operator assertion; it creates/updates only Alembic's version
   metadata and **does not run the baseline's table-creation operations**. The
   subsequent revision adds missing search indexes without replacing records.
   Existing indexes must match the original definitions; a conflicting index
   name causes the upgrade to fail rather than accepting a broken baseline.
5. Recheck row counts, start the API, and verify `/health`, `/patients`, encounters,
   notes and dashboard. The demo seed keeps its existing safeguards for populated
   databases. Keep the backup until verification and the deployment are complete.

If all baseline **and search** objects already exist, this alternative is allowed
only after full head validation:

```sh
.venv/bin/python -m app.migrations validate --revision head
.venv/bin/alembic stamp head
```

Do not use `stamp head` to bypass a validation or upgrade failure. If schema
validation fails, investigate the reported differences and write a reviewed
forward migration/repair; do not suppress the check or rebuild populated tables.
After future migrations are added, extend the explicit validator before using
it to certify a newer revision.

### Databases older than encounter support

An older installation with no `encounters` table or `notes.encounter_id` is not
`0001_initial` and deliberately fails validation. Back up first and inspect its
actual schema. For PostgreSQL, the already-reviewed additive compatibility SQL is
`backend/sql/003_encounters.sql`; it is a one-time legacy bridge, not a deployment
migration runner:

```sh
# From repository root. PGURL is a native psql URL (postgresql://...), not +psycopg.
psql "$PGURL" -v ON_ERROR_STOP=1 -1 -f backend/sql/003_encounters.sql
# Then run the read-only 0001 validator and explicit stamp/upgrade above.
```

For an old SQLite file, use a backup and an explicit transaction with the same
additive definitions (UUIDs use SQLAlchemy's existing compact `CHAR(32)` storage):

```sql
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE TABLE encounters (
    id INTEGER NOT NULL PRIMARY KEY,
    patient_id CHAR(32) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_name VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL,
    timestamp DATETIME NOT NULL
);
CREATE INDEX ix_encounters_patient_id ON encounters(patient_id);
CREATE INDEX ix_encounters_timestamp ON encounters(timestamp);
ALTER TABLE notes ADD COLUMN encounter_id INTEGER REFERENCES encounters(id) ON DELETE SET NULL;
CREATE INDEX ix_notes_encounter_id ON notes(encounter_id);
COMMIT;
```

Apply that SQLite bridge only if inspection confirms **both** encounter objects
are absent and the rest of the legacy schema matches. A partially applied schema
needs an individually reviewed repair. Afterward run validation, explicitly stamp
`0001_initial`, and upgrade. Neither the application nor Alembic automatically
runs the legacy bridge or assumes that it succeeded.

## Development and verification

```sh
cd backend
.venv/bin/alembic history
.venv/bin/alembic revision --autogenerate -m 'describe the schema change'
# Review every generated operation, especially data preservation and SQLite.
.venv/bin/alembic upgrade head
.venv/bin/pytest -q
TEST_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@localhost:5432/TEST_DATABASE' .venv/bin/pytest -q
```

Alembic uses registered `Base.metadata` for future autogeneration. The initial
revision has frozen definitions and never calls `Base.metadata.create_all()`.
Hand-managed ranked-search indexes are excluded from autogenerated removal;
changes to those expressions need a separate reviewed migration. Use `upgrade
head --sql` to inspect an offline PostgreSQL script before execution. Creating the
GIN indexes is transactional and may lock a large existing table; plan a
maintenance window or author a separate concurrent-index migration for a large
production installation. Do not edit an already-applied revision to add an index.

Tests migrate SQLite by default. With `TEST_DATABASE_URL`, each test gets its own
random PostgreSQL schema, including an isolated `alembic_version` table. SQLAlchemy
schema translation and a transaction-local search path preserve every existing
application table in that database. Only the test-created schema is removed after
each test; `pg_trgm` remains installed because it is database-wide.

## Recovery

PostgreSQL migration DDL runs inside the migration transaction. A failed migration
rolls back and should not advance its revision; investigate the error and retry
after a reviewed repair. SQLite DDL is not fully transactional: retain backups and
inspect the schema after interruption before retrying. Never stamp past a failed
upgrade to make startup succeed.

Prefer a tested forward fix and compatible application rollback. An explicit
`downgrade 0001_initial` removes search indexes but retains the shared extension.
`downgrade base` drops the application tables and their data: it is not a recovery
procedure for a populated database. No deployment command performs downgrades,
drops existing databases, or removes volumes. Restore backups into a separate
database, validate them, and switch connection settings only after verification.

The shared-connection pattern follows the official [Alembic connection-sharing
cookbook](https://alembic.sqlalchemy.org/en/latest/cookbook.html#connection-sharing).
