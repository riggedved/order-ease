"""Pytest configuration and temporary database fixtures.

Ensures all tests run in complete isolation against a temporary SQLite database
and never pollute or touch the production database file.
"""

import os
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine
from sqlmodel.pool import StaticPool

from backend.app.main import app
from backend.app.db import get_session, seed_data_if_empty


@pytest.fixture(scope="function")
def temp_db(tmp_path, monkeypatch):
    """Creates a fresh, isolated temporary SQLite database for each test."""
    db_file = tmp_path / "temp_orderease.db"
    db_url = f"sqlite:///{db_file}"
    monkeypatch.setenv("DATABASE_URL", db_url)
    engine = create_engine(
        db_url,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed_data_if_empty(session)

    yield engine

    engine.dispose()
    if db_file.exists():
        try:
            db_file.unlink()
        except OSError:
            pass


@pytest.fixture(scope="function")
def session(temp_db):
    """Provides a database session bound to the isolated temporary database."""
    with Session(temp_db) as s:
        yield s


@pytest.fixture(scope="function")
def client(temp_db):
    """FastAPI TestClient with get_session overridden to point to the temporary database."""
    def get_test_session():
        with Session(temp_db) as s:
            yield s

    app.dependency_overrides[get_session] = get_test_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
