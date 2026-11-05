from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Encounter, Note, Patient


def create_patient(client, profile, **changes):
    response = client.post("/patients", json={**profile, **changes})
    assert response.status_code == 201, response.text
    return response.json()


def encounter_payload(**changes):
    return {
        "doctor_name": "Dr. Jordan Morgan",
        "reason": "Annual wellness visit",
        "timestamp": "2024-06-10T14:30:00Z",
        **changes,
    }


def create_encounter(client, patient_id, **changes):
    response = client.post(f"/patients/{patient_id}/encounters", json=encounter_payload(**changes))
    assert response.status_code == 201, response.text
    return response.json()


def create_note(client, patient_id, **changes):
    response = client.post(
        f"/patients/{patient_id}/notes",
        json={"content": "Patient reports feeling well.", "timestamp": "2024-06-10T14:30:00Z", **changes},
    )
    assert response.status_code == 201, response.text
    return response.json()


def parse_timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_encounter_crud_persists_and_supports_many_per_patient(client, profile, db_engine):
    patient = create_patient(client, profile)
    base = f"/patients/{patient['id']}/encounters"
    assert client.get(base).json() == []

    first = create_encounter(client, patient["id"], doctor_name="  Dr. Jordan Morgan  ", reason="  Annual wellness visit  ")
    second = create_encounter(client, patient["id"], timestamp="2024-06-11T09:00:00Z")
    assert isinstance(first["id"], int) and first["id"] > 0
    assert second["id"] > first["id"]
    assert first["patient_id"] == patient["id"]
    assert first["doctor_name"] == "Dr. Jordan Morgan"
    assert first["reason"] == "Annual wellness visit"
    assert client.get(f"{base}/{first['id']}").json() == first
    assert [item["id"] for item in client.get(base).json()] == [second["id"], first["id"]]

    updated = client.put(
        f"{base}/{first['id']}",
        json=encounter_payload(doctor_name="  Dr. Avery Bennett  ", reason="  Follow-up visit  ", timestamp="2024-06-12T09:15:00Z"),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["id"] == first["id"]
    assert updated.json()["patient_id"] == patient["id"]
    assert updated.json()["doctor_name"] == "Dr. Avery Bennett"
    assert updated.json()["reason"] == "Follow-up visit"
    assert client.get(f"{base}/{first['id']}").json() == updated.json()

    with Session(db_engine) as session:
        stored = session.get(Encounter, first["id"])
        assert stored is not None
        assert stored.patient_id == patient["id"]
        assert stored.doctor_name == "Dr. Avery Bennett"
        assert stored.reason == "Follow-up visit"
        assert stored.patient.id == patient["id"]
        assert {item.id for item in stored.patient.encounters} == {first["id"], second["id"]}

    assert client.delete(f"{base}/{first['id']}").status_code == 204
    assert client.get(f"{base}/{first['id']}").status_code == 404
    assert [item["id"] for item in client.get(base).json()] == [second["id"]]
    with Session(db_engine) as session:
        assert session.get(Encounter, first["id"]) is None
        assert session.get(Patient, patient["id"]) is not None


def test_encounters_sort_equal_timestamps_by_id(client, profile):
    patient = create_patient(client, profile)
    older = create_encounter(client, patient["id"], timestamp="2024-01-01T10:00:00Z")
    first = create_encounter(client, patient["id"], timestamp="2024-02-01T10:00:00Z")
    second = create_encounter(client, patient["id"], timestamp="2024-02-01T10:00:00Z")
    result = client.get(f"/patients/{patient['id']}/encounters").json()
    assert [item["id"] for item in result] == [first["id"], second["id"], older["id"]]


def test_encounter_routes_keep_patient_ownership_scoped(client, profile):
    patient = create_patient(client, profile)
    other = create_patient(client, profile, first_name="Jordan")
    encounter = create_encounter(client, patient["id"])
    other_base = f"/patients/{other['id']}/encounters"
    assert client.get(other_base).json() == []
    assert client.get(f"{other_base}/{encounter['id']}").status_code == 404
    assert client.put(f"{other_base}/{encounter['id']}", json=encounter_payload(reason="Changed")).status_code == 404
    assert client.delete(f"{other_base}/{encounter['id']}").status_code == 404
    assert client.get(f"/patients/{patient['id']}/encounters/{encounter['id']}").json() == encounter

    for parent_id in (patient["id"], str(uuid4()), "not-a-uuid"):
        base = f"/patients/{parent_id}/encounters"
        assert client.get(f"{base}/2147483647").status_code == 404
        assert client.put(f"{base}/2147483647", json=encounter_payload()).status_code == 404
        assert client.delete(f"{base}/2147483647").status_code == 404
        if parent_id != patient["id"]:
            assert client.get(base).status_code == 404
            assert client.post(base, json=encounter_payload()).status_code == 404


@pytest.mark.parametrize("changes", [
    {"doctor_name": "   "},
    {"doctor_name": "x" * 101},
    {"reason": ""},
    {"reason": "  "},
    {"reason": "x" * 10001},
    {"timestamp": "not-a-datetime"},
    {"timestamp": None},
    {"patient_id": str(uuid4())},
    {"id": 123},
    {"unexpected": True},
])
def test_encounter_validation_rejects_bad_create_and_update(client, profile, changes):
    patient = create_patient(client, profile)
    encounter = create_encounter(client, patient["id"])
    base = f"/patients/{patient['id']}/encounters"
    assert client.post(base, json=encounter_payload(**changes)).status_code == 422
    assert client.put(f"{base}/{encounter['id']}", json=encounter_payload(**changes)).status_code == 422
    assert client.get(base).json() == [encounter]


@pytest.mark.parametrize("field", ["doctor_name", "reason", "timestamp"])
def test_encounter_write_requires_all_fields(client, profile, field):
    patient = create_patient(client, profile)
    encounter = create_encounter(client, patient["id"])
    payload = encounter_payload()
    payload.pop(field)
    base = f"/patients/{patient['id']}/encounters"
    assert client.post(base, json=payload).status_code == 422
    assert client.put(f"{base}/{encounter['id']}", json=payload).status_code == 422


@pytest.mark.parametrize("encounter_id", [0, -1, 2147483648, "not-an-integer"])
def test_encounter_routes_reject_invalid_ids(client, profile, encounter_id):
    patient = create_patient(client, profile)
    url = f"/patients/{patient['id']}/encounters/{encounter_id}"
    assert client.get(url).status_code == 422
    assert client.put(url, json=encounter_payload()).status_code == 422
    assert client.delete(url).status_code == 422


@pytest.mark.parametrize("timestamp", ["2024-06-10T14:30:00", "2024-06-10T09:30:00-05:00"])
def test_encounter_timestamps_normalize_to_utc(client, profile, timestamp):
    patient = create_patient(client, profile)
    encounter = create_encounter(client, patient["id"], timestamp=timestamp)
    expected = datetime(2024, 6, 10, 14, 30, tzinfo=timezone.utc)
    assert parse_timestamp(encounter["timestamp"]) == expected
    assert parse_timestamp(encounter["timestamp"]).utcoffset() == timedelta(0)
    stored = client.get(f"/patients/{patient['id']}/encounters/{encounter['id']}").json()
    assert parse_timestamp(stored["timestamp"]) == expected
    assert parse_timestamp(stored["timestamp"]).utcoffset() == timedelta(0)


def test_encounters_reject_future_timestamps_with_clock_skew_tolerance(client, profile):
    patient = create_patient(client, profile)
    base = f"/patients/{patient['id']}/encounters"
    now = datetime.now(timezone.utc)
    encounter = create_encounter(client, patient["id"], timestamp=(now + timedelta(seconds=30)).isoformat())
    future = encounter_payload(timestamp=(now + timedelta(minutes=5)).isoformat())
    assert client.post(base, json=future).status_code == 422
    assert client.put(f"{base}/{encounter['id']}", json=future).status_code == 422
    assert len(client.get(base).json()) == 1


def test_notes_can_optionally_link_to_encounters_and_filter(client, profile, db_engine):
    patient = create_patient(client, profile)
    first = create_encounter(client, patient["id"])
    second = create_encounter(client, patient["id"])
    unlinked = create_note(client, patient["id"])
    explicit_null = create_note(client, patient["id"], encounter_id=None)
    older = create_note(client, patient["id"], encounter_id=first["id"], timestamp="2024-01-01T10:00:00Z")
    newer = create_note(client, patient["id"], encounter_id=first["id"], timestamp="2024-02-01T10:00:00Z")
    other = create_note(client, patient["id"], encounter_id=second["id"])
    assert unlinked["encounter_id"] is None
    assert explicit_null["encounter_id"] is None
    assert newer["encounter_id"] == first["id"]

    base = f"/patients/{patient['id']}/notes"
    assert {item["id"] for item in client.get(base).json()} == {
        unlinked["id"], explicit_null["id"], older["id"], newer["id"], other["id"],
    }
    filtered = client.get(base, params={"encounter_id": first["id"]})
    assert filtered.status_code == 200, filtered.text
    assert [item["id"] for item in filtered.json()] == [newer["id"], older["id"]]
    assert [item["id"] for item in client.get(base, params={"encounter_id": second["id"]}).json()] == [other["id"]]

    with Session(db_engine) as session:
        encounter = session.get(Encounter, first["id"])
        assert {note.id for note in encounter.notes} == {older["id"], newer["id"]}
        assert session.get(Note, newer["id"]).encounter.id == first["id"]
        assert session.get(Note, unlinked["id"]).encounter is None

    assert client.delete(f"{base}/{newer['id']}").status_code == 204
    assert client.get(f"/patients/{patient['id']}/encounters/{first['id']}").status_code == 200


def test_note_encounter_links_and_filters_reject_missing_or_other_patient(client, profile):
    patient = create_patient(client, profile)
    other = create_patient(client, profile, first_name="Jordan")
    own_empty = create_encounter(client, patient["id"])
    foreign = create_encounter(client, other["id"])
    base = f"/patients/{patient['id']}/notes"
    assert client.get(base, params={"encounter_id": own_empty["id"]}).json() == []
    for encounter_id in (foreign["id"], 2147483647):
        response = client.post(base, json={
            "content": "Must not link across patient records.",
            "timestamp": "2024-06-10T14:30:00Z",
            "encounter_id": encounter_id,
        })
        assert response.status_code == 404
        assert client.get(base, params={"encounter_id": encounter_id}).status_code == 404
    assert client.get(base).json() == []


@pytest.mark.parametrize("encounter_id", [0, -1, 2147483648, "not-an-integer", 1.5, True])
def test_note_encounter_ids_require_positive_integers(client, profile, encounter_id):
    patient = create_patient(client, profile)
    base = f"/patients/{patient['id']}/notes"
    assert client.post(base, json={
        "content": "Visit note.", "timestamp": "2024-06-10T14:30:00Z", "encounter_id": encounter_id,
    }).status_code == 422
    assert client.get(base, params={"encounter_id": encounter_id}).status_code == 422


@pytest.mark.parametrize("delete_via_database", [False, True])
def test_deleting_encounter_preserves_notes_and_clears_link(client, profile, db_engine, delete_via_database):
    patient = create_patient(client, profile)
    encounter = create_encounter(client, patient["id"])
    linked = create_note(client, patient["id"], encounter_id=encounter["id"])
    unlinked = create_note(client, patient["id"])
    if delete_via_database:
        with Session(db_engine) as session:
            session.execute(delete(Encounter).where(Encounter.id == encounter["id"]))
            session.commit()
    else:
        assert client.delete(f"/patients/{patient['id']}/encounters/{encounter['id']}").status_code == 204

    notes = client.get(f"/patients/{patient['id']}/notes").json()
    assert {item["id"] for item in notes} == {linked["id"], unlinked["id"]}
    assert all(item["encounter_id"] is None for item in notes)
    assert client.get(f"/patients/{patient['id']}/encounters").json() == []
    with Session(db_engine) as session:
        stored = session.get(Note, linked["id"])
        assert stored is not None and stored.encounter_id is None
        assert stored.content == linked["content"]
        assert session.get(Patient, patient["id"]) is not None


@pytest.mark.parametrize("delete_via_database", [False, True])
def test_patient_deletion_cascades_encounters_and_notes(client, profile, db_engine, delete_via_database):
    patient = create_patient(client, profile)
    other = create_patient(client, profile, first_name="Jordan")
    encounter = create_encounter(client, patient["id"])
    other_encounter = create_encounter(client, other["id"])
    linked = create_note(client, patient["id"], encounter_id=encounter["id"])
    unlinked = create_note(client, patient["id"])
    other_note = create_note(client, other["id"], encounter_id=other_encounter["id"])
    if delete_via_database:
        with Session(db_engine) as session:
            session.execute(delete(Patient).where(Patient.id == patient["id"]))
            session.commit()
    else:
        assert client.delete(f"/patients/{patient['id']}").status_code == 204

    with Session(db_engine) as session:
        assert session.get(Encounter, encounter["id"]) is None
        assert session.get(Note, linked["id"]) is None
        assert session.get(Note, unlinked["id"]) is None
        assert session.get(Encounter, other_encounter["id"]) is not None
        assert session.get(Note, other_note["id"]).encounter_id == other_encounter["id"]
        assert session.scalar(select(func.count()).select_from(Encounter)) == 1


def test_encounter_foreign_keys_enforced_by_database(client, profile, db_engine):
    patient = create_patient(client, profile)
    with Session(db_engine) as session:
        session.add(Encounter(
            patient_id=str(uuid4()), doctor_name="Dr. Jordan Morgan", reason="Unknown patient",
            timestamp=datetime(2024, 6, 10, tzinfo=timezone.utc),
        ))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add(Note(
            patient_id=patient["id"], encounter_id=2147483647, content="Unknown encounter",
            timestamp=datetime(2024, 6, 10, tzinfo=timezone.utc),
        ))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.scalar(select(func.count()).select_from(Encounter)) == 0
        assert session.scalar(select(func.count()).select_from(Note)) == 0
