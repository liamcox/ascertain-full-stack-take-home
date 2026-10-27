import os
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.schema import CreateSchema, DropSchema

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import make_engine  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture
def db_engine(tmp_path):
    postgres_url = os.getenv("TEST_DATABASE_URL")
    if postgres_url:
        # PostgreSQL integration runs use a unique schema per test, preserving
        # every existing table in the database supplied by the developer.
        base_engine = make_engine(postgres_url)
        schema = f"test_{uuid4().hex}"
        with base_engine.begin() as connection:
            connection.execute(CreateSchema(schema))
        engine = base_engine.execution_options(schema_translate_map={None: schema})
        try:
            yield engine
        finally:
            with base_engine.begin() as connection:
                connection.execute(DropSchema(schema, cascade=True))
            base_engine.dispose()
    else:
        engine = make_engine(f"sqlite:///{tmp_path / 'test.db'}")
        yield engine
        engine.dispose()


@pytest.fixture
def client(db_engine):
    with TestClient(create_app(db_engine, seed_enabled=False)) as test_client:
        yield test_client


@pytest.fixture
def profile():
    return {
        "first_name": "Avery",
        "last_name": "Bennett",
        "dob": "1985-06-15",
        "status": "active",
        "email": "avery.bennett@example.com",
        "allergies": ["Penicillin"],
        "conditions": ["Asthma"],
        "last_visit": "2024-06-10",
    }
