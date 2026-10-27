from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.main import create_app
from app.models import AppMetadata, Note, Patient
from app.seed import SEED_KEY, seed_database


def create_patient(client, profile, **changes):
    response = client.post("/patients", json={**profile, **changes})
    assert response.status_code == 201, response.text
    return response.json()


def add_note(client, patient_id, content="Contact details confirmed.", timestamp="2024-06-10T14:30:00Z"):
    response = client.post(f"/patients/{patient_id}/notes", json={"timestamp": timestamp, "content": content})
    assert response.status_code == 201, response.text
    return response.json()


def test_crud_persists_and_returns_derived_fields(client, profile):
    assert client.get("/health").json() == {"status": "ok"}
    patient = create_patient(client, profile, first_name="  Avery  ", phone="")
    assert patient["first_name"] == "Avery"
    assert patient["phone"] is None
    assert patient["blood_type"] is None
    assert patient["created_at"] and patient["updated_at"]
    today = date.today()
    assert patient["age"] == today.year - 1985 - ((today.month, today.day) < (6, 15))
    assert client.get(f"/patients/{patient['id']}").json() == patient

    edited = client.put(f"/patients/{patient['id']}", json={**profile, "status": "follow_up", "first_name": "Jordan", "conditions": []})
    assert edited.status_code == 200
    assert edited.json()["first_name"] == "Jordan"
    assert edited.json()["status"] == "follow_up"
    assert edited.json()["conditions"] == []
    assert client.get(f"/patients/{patient['id']}").json()["first_name"] == "Jordan"
    assert client.delete(f"/patients/{patient['id']}").status_code == 204
    assert client.get(f"/patients/{patient['id']}").status_code == 404
    assert client.get("/patients").json()["total"] == 0


def test_pagination_search_filter_and_sort(client, profile):
    create_patient(client, profile, last_name="Zulu", dob="1970-01-01", status="follow_up", conditions=["Asthma"], last_visit="2024-01-01")
    create_patient(client, profile, first_name="Jordan", last_name="Alpha", dob="2000-01-01", last_visit=None)
    create_patient(client, profile, first_name="Morgan", last_name="Middle", dob="1990-01-01", last_visit="2024-05-01")

    page = client.get("/patients", params={"page": 2, "page_size": 2}).json()
    assert page["total"] == 3 and page["total_pages"] == 2
    assert page["page"] == 2 and page["page_size"] == 2
    assert [patient["last_name"] for patient in page["items"]] == ["Zulu"]
    assert client.get("/patients", params={"page": 9}).json()["items"] == []
    matches = client.get("/patients", params={"search": " JORDAN alpha "}).json()
    assert matches["total"] == 1
    assert matches["items"][0]["last_name"] == "Alpha"
    assert client.get("/patients", params={"status": "follow_up"}).json()["total"] == 1
    assert client.get("/patients", params={"status": ""}).json()["total"] == 3
    assert client.get("/patients", params={"search": "asthma", "status": "follow_up"}).json()["total"] == 1
    assert client.get("/patients", params={"search": "%"}).json()["total"] == 0
    by_age = client.get("/patients", params={"sort_by": "age"}).json()["items"]
    assert [patient["dob"] for patient in by_age] == ["2000-01-01", "1990-01-01", "1970-01-01"]
    by_visit = client.get("/patients", params={"sort_by": "last_visit", "sort_order": "desc"}).json()["items"]
    assert [patient["last_name"] for patient in by_visit] == ["Middle", "Zulu", "Alpha"]
    descending = client.get("/patients", params={"sort_order": "desc"}).json()["items"]
    assert [patient["last_name"] for patient in descending] == ["Zulu", "Middle", "Alpha"]


@pytest.mark.parametrize("changes", [
    {"first_name": "   "},
    {"last_name": ""},
    {"dob": (date.today() + timedelta(days=1)).isoformat()},
    {"last_visit": (date.today() + timedelta(days=1)).isoformat()},
    {"last_visit": "1980-01-01"},
    {"email": "not-an-email"},
    {"blood_type": "C+"},
    {"status": "unknown"},
    {"allergies": ["   "]},
    {"conditions": ["x" * 101]},
    {"unexpected": True},
])
def test_patient_validation_rejects_bad_input(client, profile, changes):
    assert client.post("/patients", json={**profile, **changes}).status_code == 422
    assert client.get("/patients").json()["total"] == 0


@pytest.mark.parametrize("params", [{"page": 0}, {"page_size": 101}, {"sort_by": "unknown"}, {"sort_order": "unknown"}, {"status": "unknown"}])
def test_invalid_list_parameters(client, params):
    assert client.get("/patients", params=params).status_code == 422


def test_notes_order_scope_and_patient_cascade(client, profile, db_engine):
    patient = create_patient(client, profile)
    other = create_patient(client, profile, first_name="Jordan")
    older = add_note(client, patient["id"], content="Earlier visit", timestamp="2024-01-01T10:00:00Z")
    newer = add_note(client, patient["id"], content="Latest visit", timestamp="2024-02-01T10:00:00Z")
    notes = client.get(f"/patients/{patient['id']}/notes").json()
    assert [note["id"] for note in notes] == [newer["id"], older["id"]]
    assert client.delete(f"/patients/{other['id']}/notes/{newer['id']}").status_code == 404
    assert len(client.get(f"/patients/{patient['id']}/notes").json()) == 2
    assert client.delete(f"/patients/{patient['id']}/notes/{older['id']}").status_code == 204
    assert client.delete(f"/patients/{patient['id']}").status_code == 204
    with Session(db_engine) as session:
        assert session.scalar(select(func.count()).select_from(Note)) == 0


@pytest.mark.parametrize("content", ["   ", "", "x" * 10001])
def test_notes_require_bounded_nonblank_text(client, profile, content):
    patient = create_patient(client, profile)
    assert client.post(f"/patients/{patient['id']}/notes", json={"timestamp": "2024-01-01T10:00:00Z", "content": content}).status_code == 422


def test_notes_reject_future_timestamps_with_clock_skew_tolerance(client, profile):
    patient = create_patient(client, profile)
    url = f"/patients/{patient['id']}/notes"
    now = datetime.now(timezone.utc)
    allowed = client.post(url, json={"timestamp": (now + timedelta(seconds=30)).isoformat(), "content": "Current visit note."})
    assert allowed.status_code == 201
    future = client.post(url, json={"timestamp": (now + timedelta(minutes=5)).isoformat(), "content": "Future note."})
    assert future.status_code == 422
    assert len(client.get(url).json()) == 1


def test_summary_reflects_profile_and_note_changes(client, profile):
    patient = create_patient(client, profile)
    url = f"/patients/{patient['id']}/summary"
    initial = client.get(url).json()
    assert initial["patient_id"] == patient["id"]
    assert initial["generated_at"]
    assert "No patient notes recorded." in initial["summary"]
    assert "Asthma" in initial["summary"] and "Penicillin" in initial["summary"]
    note = add_note(client, patient["id"], content="Patient requested appointment reminder.")
    summary = client.get(url).json()["summary"]
    assert "2024-06-10" in summary and note["content"] in summary
    client.put(f"/patients/{patient['id']}", json={**profile, "first_name": "Taylor", "conditions": ["Migraine"]})
    updated = client.get(url).json()["summary"]
    assert "Taylor Bennett" in updated and "Migraine" in updated and "Asthma" not in updated
    client.delete(f"/patients/{patient['id']}/notes/{note['id']}")
    assert note["content"] not in client.get(url).json()["summary"]


def test_summary_combines_notes_into_chronological_narrative(client, profile):
    patient = create_patient(client, profile)
    add_note(client, patient["id"], "Latest recorded statement.", "2024-03-01T10:00:00Z")
    add_note(client, patient["id"], "Earliest recorded statement.", "2024-01-01T10:00:00Z")
    add_note(client, patient["id"], "Middle recorded statement.", "2024-02-01T10:00:00Z")
    summary = client.get(f"/patients/{patient['id']}/summary").json()["summary"]
    assert summary.index("Earliest recorded statement.") < summary.index("Middle recorded statement.") < summary.index("Latest recorded statement.")
    assert "The recorded history begins on" in summary
    assert "In a subsequent note on" in summary
    assert "Most recently, on" in summary


@pytest.mark.parametrize("patient_id", [str(uuid4()), "not-a-uuid"])
def test_missing_patient_routes_return_404(client, profile, patient_id):
    base = f"/patients/{patient_id}"
    assert client.get(base).status_code == 404
    assert client.put(base, json=profile).status_code == 404
    assert client.delete(base).status_code == 404
    assert client.get(f"{base}/notes").status_code == 404
    assert client.post(f"{base}/notes", json={"timestamp": "2024-01-01T10:00:00Z", "content": "Visit"}).status_code == 404
    assert client.get(f"{base}/summary").status_code == 404


def test_dashboard_counts_and_recent_visits(client, profile):
    create_patient(client, profile, status="active", last_visit="2024-01-01")
    create_patient(client, profile, status="follow_up", last_visit="2024-02-01")
    create_patient(client, profile, status="inactive", last_visit=None)
    result = client.get("/dashboard").json()
    assert result["total_patients"] == 3
    assert result["active_patients"] == 1
    assert result["follow_up_patients"] == 1
    assert result["inactive_patients"] == 1
    assert [patient["last_visit"] for patient in result["recent_patients"]] == ["2024-02-01", "2024-01-01"]


def test_seed_is_idempotent_and_never_restores_deleted_data(db_engine):
    with TestClient(create_app(db_engine, seed_enabled=True)) as client:
        result = client.get("/patients").json()
        assert result["total"] == 120
        patient = result["items"][0]
        assert client.delete(f"/patients/{patient['id']}").status_code == 204

    with TestClient(create_app(db_engine, seed_enabled=True)) as client:
        assert client.get("/patients").json()["total"] == 119

    with Session(db_engine) as session:
        session.execute(delete(Patient))
        session.commit()
        assert session.get(AppMetadata, SEED_KEY) is not None
        assert seed_database(session) is False

    with TestClient(create_app(db_engine, seed_enabled=True)) as client:
        assert client.get("/patients").json()["total"] == 0


def test_seed_preserves_an_existing_database(client, profile, db_engine):
    create_patient(client, profile)
    with Session(db_engine) as session:
        assert seed_database(session) is False
        assert session.scalar(select(func.count()).select_from(Patient)) == 1
        assert session.get(AppMetadata, SEED_KEY) is not None


def test_cors_uses_explicit_configured_origin(db_engine, monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://care.example.com")
    with TestClient(create_app(db_engine, seed_enabled=False)) as client:
        allowed = client.options("/patients", headers={"Origin": "https://care.example.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type"})
        assert allowed.status_code == 200
        assert allowed.headers["access-control-allow-origin"] == "https://care.example.com"
        denied = client.options("/patients", headers={"Origin": "https://elsewhere.example.com", "Access-Control-Request-Method": "POST"})
        assert denied.status_code == 400
        assert "access-control-allow-origin" not in denied.headers
