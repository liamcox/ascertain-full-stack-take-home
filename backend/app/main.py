import math
import os
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import case, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .database import Base, engine
from .models import Note, Patient, PatientStatus, utc_now
from .schemas import Dashboard, NoteRead, NoteWrite, PatientPage, PatientRead, PatientSearchResult, PatientSummary, PatientWrite, SearchMatch
from .search import FUZZY_THRESHOLD, MATCH_LABELS, ensure_search_indexes, ranked_search
from .seed import seed_database


def get_db(request: Request):
    with request.app.state.session_factory() as session:
        yield session


DB = Annotated[Session, Depends(get_db)]


def get_patient(session: Session, patient_id: str) -> Patient:
    try:
        normalized_id = str(UUID(patient_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Patient not found") from None
    patient = session.get(Patient, normalized_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


def patient_notes(session: Session, patient_id: str) -> list[Note]:
    return list(session.scalars(select(Note).where(Note.patient_id == patient_id).order_by(Note.timestamp.desc(), Note.id)))


def create_app(db_engine: Engine = engine, seed_enabled: bool | None = None) -> FastAPI:
    session_factory = sessionmaker(bind=db_engine, expire_on_commit=False)
    should_seed = seed_enabled if seed_enabled is not None else os.getenv("SEED_DATA", "true").lower() == "true"

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        Base.metadata.create_all(db_engine)
        ensure_search_indexes(db_engine)
        if should_seed:
            with session_factory() as session:
                seed_database(session)
        yield

    application = FastAPI(
        title="Ascertain Patient API",
        description="Patient directory, notes, and deterministic summaries for fictional demo data.",
        version="1.0.0",
        lifespan=lifespan,
    )
    application.state.session_factory = session_factory
    origins = [origin.strip().rstrip("/") for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000,http://localhost:8080").split(",") if origin.strip()]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Accept"],
    )

    @application.get("/health", tags=["Health"])
    def health(session: DB):
        session.execute(text("SELECT 1"))
        return {"status": "ok"}

    @application.get("/patients", response_model=PatientPage, tags=["Patients"])
    def list_patients(
        session: DB,
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=12, ge=1, le=100),
        search: str = Query(default="", max_length=200),
        status: Literal["", "active", "follow_up", "inactive"] | None = None,
        sort_by: Literal["name", "age", "last_visit", "status"] = "name",
        sort_order: Literal["asc", "desc"] = "asc",
    ):
        query = select(Patient)
        ranking = None
        if search.strip():
            if db_engine.dialect.name == "postgresql":
                # No connection-pool state leaks: set_config's true flag scopes
                # the indexable % operator threshold to this transaction only.
                session.execute(select(func.set_config("pg_trgm.similarity_threshold", str(FUZZY_THRESHOLD), True)))
            ranking = ranked_search(search, db_engine.dialect.name)
            query = query.where(ranking.predicate)
        if status:
            query = query.where(Patient.status == PatientStatus(status))
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        if sort_by == "age":
            # A later birthday means a younger patient.
            ordering = [Patient.dob.desc() if sort_order == "asc" else Patient.dob.asc()]
        elif sort_by == "last_visit":
            ordering = [(Patient.last_visit.asc() if sort_order == "asc" else Patient.last_visit.desc()).nullslast()]
        elif sort_by == "status":
            ordering = [Patient.status.asc() if sort_order == "asc" else Patient.status.desc()]
        else:
            columns = [func.lower(Patient.last_name), func.lower(Patient.first_name)]
            ordering = [column.asc() if sort_order == "asc" else column.desc() for column in columns]
        if ranking is None:
            items = session.scalars(query.order_by(*ordering, Patient.id).offset((page - 1) * page_size).limit(page_size)).all()
        else:
            # Relevance always precedes the chosen column sort. Only fuzzy
            # suggestions use trigram similarity within their tier.
            fuzzy_order = case((ranking.kind == "fuzzy", ranking.similarity), else_=0.0)
            rows = session.execute(query.add_columns(ranking.kind, ranking.similarity).order_by(
                ranking.tier, fuzzy_order.desc(), *ordering, Patient.id,
            ).offset((page - 1) * page_size).limit(page_size)).all()
            items = []
            for patient, kind, score in rows:
                item = PatientSearchResult.model_validate(patient)
                label = "Exact short ID" if kind == "exact_id" and ranking.short_id else MATCH_LABELS[kind]
                item.search_match = SearchMatch(kind=kind, label=label, score=round(float(score), 6) if kind == "fuzzy" else 1.0)
                items.append(item)
        return {"items": items, "total": total, "page": page, "page_size": page_size, "total_pages": math.ceil(total / page_size)}

    @application.get("/dashboard", response_model=Dashboard, tags=["Patients"])
    def dashboard(session: DB):
        counts = dict(session.execute(select(Patient.status, func.count()).group_by(Patient.status)).all())
        recent = session.scalars(select(Patient).where(Patient.last_visit.is_not(None)).order_by(Patient.last_visit.desc(), Patient.id).limit(5)).all()
        return {
            "total_patients": sum(counts.values()),
            "active_patients": counts.get(PatientStatus.active, 0),
            "follow_up_patients": counts.get(PatientStatus.follow_up, 0),
            "inactive_patients": counts.get(PatientStatus.inactive, 0),
            "recent_patients": recent,
        }

    @application.post("/patients", response_model=PatientRead, status_code=status.HTTP_201_CREATED, tags=["Patients"])
    def create_patient(payload: PatientWrite, session: DB):
        patient = Patient(**payload.model_dump())
        session.add(patient)
        session.commit()
        session.refresh(patient)
        return patient

    @application.get("/patients/{patient_id}", response_model=PatientRead, tags=["Patients"])
    def read_patient(patient_id: str, session: DB):
        return get_patient(session, patient_id)

    @application.put("/patients/{patient_id}", response_model=PatientRead, tags=["Patients"])
    def update_patient(patient_id: str, payload: PatientWrite, session: DB):
        patient = get_patient(session, patient_id)
        for key, value in payload.model_dump().items():
            setattr(patient, key, value)
        patient.updated_at = utc_now()
        session.commit()
        session.refresh(patient)
        return patient

    @application.delete("/patients/{patient_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Patients"])
    def delete_patient(patient_id: str, session: DB):
        session.delete(get_patient(session, patient_id))
        session.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.get("/patients/{patient_id}/notes", response_model=list[NoteRead], tags=["Notes"])
    def list_notes(patient_id: str, session: DB):
        patient = get_patient(session, patient_id)
        return patient_notes(session, patient.id)

    @application.post("/patients/{patient_id}/notes", response_model=NoteRead, status_code=status.HTTP_201_CREATED, tags=["Notes"])
    def create_note(patient_id: str, payload: NoteWrite, session: DB):
        patient = get_patient(session, patient_id)
        note = Note(patient_id=patient.id, **payload.model_dump())
        session.add(note)
        patient.updated_at = utc_now()
        session.commit()
        session.refresh(note)
        return note

    @application.delete("/patients/{patient_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Notes"])
    def delete_note(patient_id: str, note_id: str, session: DB):
        patient = get_patient(session, patient_id)
        try:
            normalized_id = str(UUID(note_id))
        except ValueError:
            raise HTTPException(status_code=404, detail="Note not found") from None
        note = session.scalar(select(Note).where(Note.id == normalized_id, Note.patient_id == patient.id))
        if note is None:
            raise HTTPException(status_code=404, detail="Note not found")
        session.delete(note)
        patient.updated_at = utc_now()
        session.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.get("/patients/{patient_id}/summary", response_model=PatientSummary, tags=["Summaries"])
    def summarize_patient(patient_id: str, session: DB):
        patient = get_patient(session, patient_id)
        notes = patient_notes(session, patient.id)
        status_label = {PatientStatus.active: "Active", PatientStatus.follow_up: "Needs follow-up", PatientStatus.inactive: "Inactive"}[patient.status]
        profile = " ".join([
            f"{patient.first_name} {patient.last_name} is {patient.age} years old (born {patient.dob.isoformat()}) and has a patient status of {status_label}.",
            f"The last recorded visit was {patient.last_visit.isoformat()}." if patient.last_visit else "No last visit date is recorded.",
            f"Blood type is {patient.blood_type}." if patient.blood_type else "Blood type is not recorded.",
            f"Recorded conditions: {', '.join(patient.conditions)}." if patient.conditions else "No conditions are recorded.",
            f"Recorded allergies: {', '.join(patient.allergies)}." if patient.allergies else "No allergies are recorded.",
        ])
        if notes:
            chronological = list(reversed(notes))
            history = []
            for index, note in enumerate(chronological):
                recorded_at = note.timestamp.strftime("%Y-%m-%d at %H:%M UTC")
                if len(chronological) == 1:
                    lead = f"One patient note is recorded, dated {recorded_at}, stating:"
                elif index == 0:
                    lead = f"The recorded history begins on {recorded_at}, when the note states:"
                elif index == len(chronological) - 1:
                    lead = f"Most recently, on {recorded_at}, the note states:"
                else:
                    lead = f"In a subsequent note on {recorded_at}, the record states:"
                history.append(f'{lead} “{note.content}”')
            narrative = " ".join(history)
        else:
            narrative = "No patient notes recorded."
        return {"patient_id": patient.id, "summary": f"{profile}\n\n{narrative}", "generated_at": utc_now()}

    return application


app = create_app()
