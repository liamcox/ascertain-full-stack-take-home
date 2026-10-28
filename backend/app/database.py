import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    # Hosting providers commonly supply the shorter PostgreSQL URL scheme.
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)

    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, pool_pre_ping=True, connect_args=connect_args)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            # The production database supplies these through pg_trgm and
            # regexp_replace. Register deterministic SQLite equivalents for
            # the same SQL search predicates in local development/tests.
            from .search import sqlite_regexp_replace, trigram_similarity
            connection.create_function("regexp_replace", 4, sqlite_regexp_replace, deterministic=True)
            connection.create_function("similarity", 2, trigram_similarity, deterministic=True)
    return engine


engine = make_engine(os.getenv("DATABASE_URL", "postgresql+psycopg://ascertain:ascertain_dev@localhost:5432/ascertain"))
