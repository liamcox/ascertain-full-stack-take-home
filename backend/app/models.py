import enum
from datetime import date, datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, Date, DateTime, Enum, ForeignKey, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PatientStatus(str, enum.Enum):
    active = "active"
    follow_up = "follow_up"
    inactive = "inactive"


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    dob: Mapped[date] = mapped_column(Date)
    status: Mapped[PatientStatus] = mapped_column(
        Enum(PatientStatus, native_enum=False, create_constraint=True), default=PatientStatus.active, index=True
    )
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(50))
    address: Mapped[str | None] = mapped_column(String(500))
    blood_type: Mapped[str | None] = mapped_column(String(3))
    last_visit: Mapped[date | None] = mapped_column(Date, index=True)
    allergies: Mapped[list[str]] = mapped_column(JSON, default=list)
    conditions: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
    notes: Mapped[list["Note"]] = relationship(back_populates="patient", cascade="all, delete-orphan", passive_deletes=True)

    __table_args__ = (Index("ix_patients_name", "last_name", "first_name"),)

    @property
    def age(self) -> int:
        today = date.today()
        return today.year - self.dob.year - ((today.month, today.day) < (self.dob.month, self.dob.day))


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    patient_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    content: Mapped[str] = mapped_column(Text)
    patient: Mapped[Patient] = relationship(back_populates="notes")


class AppMetadata(Base):
    __tablename__ = "app_metadata"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
