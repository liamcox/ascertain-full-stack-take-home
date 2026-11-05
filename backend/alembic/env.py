"""Alembic environment shared by the CLI, deployment, and isolated tests."""

from logging.config import fileConfig

from alembic import context

from app.database import Base, get_database_url, make_engine
from app import models  # noqa: F401: register the application metadata

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name, disable_existing_loggers=False)
target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    # PostgreSQL expression indexes are hand-reviewed in revision 0002 rather
    # than ORM metadata. Future autogeneration must not propose removing them.
    return not (type_ == "index" and name and name.startswith("ix_patients_search_"))


def run_migrations_offline():
    # SQL generation never connects to the configured database.
    url = make_url()
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True,
                      compare_type=True, include_object=include_object)
    with context.begin_transaction():
        context.run_migrations()


def make_url():
    from sqlalchemy.engine import make_url as parse_url

    url = parse_url(get_database_url())
    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+psycopg")
    return url


def migrate(connection):
    schema = connection.get_execution_options().get("schema_translate_map", {}).get(None)
    if schema and connection.dialect.name == "postgresql":
        # SET LOCAL stays inside this transaction and cannot leak into the pool.
        quoted = connection.dialect.identifier_preparer.quote_schema(schema)
        connection.exec_driver_sql(f"SET LOCAL search_path TO {quoted}, public")
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table_schema=schema,
        compare_type=True,
        include_object=include_object,
        render_as_batch=connection.dialect.name == "sqlite",
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connection = config.attributes.get("connection")
    if connection is not None:
        migrate(connection)
        return
    engine = make_engine(str(make_url().render_as_string(hide_password=False)))
    try:
        with engine.begin() as connection:
            migrate(connection)
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
