"""Repeatable fictional demo data; a persistent marker prevents accidental reseeding."""

import calendar
from datetime import date, datetime, time, timedelta, timezone
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AppMetadata, Note, Patient, PatientStatus

SEED_KEY = "demo-seed-v1"

FIRST_NAMES = (
    "Avery", "Jordan", "Morgan", "Taylor", "Cameron", "Riley", "Quinn", "Alex",
    "Sam", "Jamie", "Casey", "Robin", "Drew", "Emerson", "Finley", "Harper",
    "Jules", "Kendall", "Logan", "Parker", "Reese", "Rowan", "Skyler", "Sage",
)
LAST_NAMES = ("Bennett", "Chen", "Diaz", "Ellis", "Foster")
BLOOD_TYPES = ("A+", "O+", "B+", "AB+", "A-", "O-", "B-", "AB-", None)
CONDITIONS = ([], ["Hypertension"], ["Asthma"], ["Type 2 diabetes"], ["Seasonal allergies"], ["Migraine"])
ALLERGIES = ([], ["Penicillin"], [], ["Peanuts"], [], ["Latex"])
NOTE_TEXTS = (
    "Routine visit completed. Patient confirmed contact details and medication list.",
    "Patient reports no changes since the previous visit. Follow-up appointment discussed.",
    "Patient requested a copy of their visit summary. Administrative request recorded.",
    "Care coordination call completed. Patient confirmed the upcoming appointment.",
    "Annual review completed. Patient history and recorded allergies reviewed together.",
)


def seed_database(session: Session) -> bool:
    """Seed an empty database once; return whether demo patients were added.

    An existing database is marked as initialized without changing its data. The
    marker is independent of patients, so deleting all patients does not reset it.
    """
    if session.get(AppMetadata, SEED_KEY):
        return False
    if session.scalar(select(Patient.id).limit(1)):
        session.add(AppMetadata(key=SEED_KEY, value="Existing patient data; seed skipped"))
        session.commit()
        return False

    today = date.today()
    for index in range(120):
        first_name = FIRST_NAMES[index % len(FIRST_NAMES)]
        last_name = LAST_NAMES[index // len(FIRST_NAMES)]
        birth_year = today.year - (21 + (index * 7) % 65)
        birth_month = 1 + (index * 3) % 12
        birth_day = min(1 + (index * 11) % 28, calendar.monthrange(birth_year, birth_month)[1])
        patient_id = str(uuid5(NAMESPACE_URL, f"ascertain-demo-patient-{index}"))
        status = (PatientStatus.active, PatientStatus.follow_up, PatientStatus.active, PatientStatus.inactive)[index % 4]
        last_visit = today - timedelta(days=(index * 13) % 360) if index % 11 else None
        patient = Patient(
            id=patient_id,
            first_name=first_name,
            last_name=last_name,
            dob=date(birth_year, birth_month, birth_day),
            status=status,
            email=f"{first_name.lower()}.{last_name.lower()}@example.com",
            phone=f"(202) 555-{100 + index % 100:04d}",
            address=f"{100 + index} Example Lane, Springfield, IL 62701",
            blood_type=BLOOD_TYPES[index % len(BLOOD_TYPES)],
            last_visit=last_visit,
            conditions=CONDITIONS[index % len(CONDITIONS)].copy(),
            allergies=ALLERGIES[index % len(ALLERGIES)].copy(),
            created_at=datetime.combine(today - timedelta(days=450 + index), time(9), tzinfo=timezone.utc),
            updated_at=datetime.combine(last_visit or today - timedelta(days=90), time(14), tzinfo=timezone.utc),
        )
        session.add(patient)
        # Include profiles with zero, one, and several notes to exercise empty states.
        for note_index in range(index % 4):
            note_date = (last_visit or today - timedelta(days=30)) - timedelta(days=note_index * 28)
            patient.notes.append(Note(
                id=str(uuid5(NAMESPACE_URL, f"ascertain-demo-note-{index}-{note_index}")),
                timestamp=datetime.combine(note_date, time(10 + note_index, 15), tzinfo=timezone.utc),
                content=NOTE_TEXTS[(index + note_index) % len(NOTE_TEXTS)],
            ))
    session.add(AppMetadata(key=SEED_KEY, value="120 fictional patients created"))
    session.commit()
    return True
