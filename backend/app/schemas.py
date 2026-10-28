from datetime import date, datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from .models import PatientStatus


class PatientWrite(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    dob: date
    status: PatientStatus = PatientStatus.active
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=50)
    address: str | None = Field(default=None, max_length=500)
    blood_type: Literal["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] | None = None
    last_visit: date | None = None
    allergies: list[str] = Field(default_factory=list, max_length=50)
    conditions: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("email", "phone", "address", "blood_type", "last_visit", mode="before")
    @classmethod
    def empty_to_none(cls, value):
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("allergies", "conditions")
    @classmethod
    def validate_tags(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 100 for value in cleaned):
            raise ValueError("Each entry must contain between 1 and 100 characters")
        return list(dict.fromkeys(cleaned))

    @model_validator(mode="after")
    def valid_dates(self):
        today = date.today()
        if self.dob > today:
            raise ValueError("Date of birth cannot be in the future")
        if self.last_visit and self.last_visit > today:
            raise ValueError("Last visit cannot be in the future")
        if self.last_visit and self.last_visit < self.dob:
            raise ValueError("Last visit cannot be before date of birth")
        return self


class PatientRead(PatientWrite):
    model_config = ConfigDict(from_attributes=True)

    id: str
    age: int
    created_at: datetime
    updated_at: datetime


class SearchMatch(BaseModel):
    kind: Literal["exact_id", "exact_name", "exact_contact", "name_prefix", "substring", "fuzzy"]
    label: str
    score: float = Field(ge=0, le=1)


class PatientSearchResult(PatientRead):
    search_match: SearchMatch | None = None


class PatientPage(BaseModel):
    items: list[PatientSearchResult]
    total: int
    page: int
    page_size: int
    total_pages: int


class NoteWrite(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    timestamp: datetime
    content: str = Field(min_length=1, max_length=10000)

    @field_validator("timestamp")
    @classmethod
    def normalize_timestamp(cls, value: datetime) -> datetime:
        normalized = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        if normalized > datetime.now(timezone.utc) + timedelta(seconds=60):
            raise ValueError("Note timestamp cannot be in the future")
        return normalized


class NoteRead(NoteWrite):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patient_id: str


class PatientSummary(BaseModel):
    patient_id: str
    summary: str
    generated_at: datetime


class Dashboard(BaseModel):
    total_patients: int
    active_patients: int
    follow_up_patients: int
    inactive_patients: int
    recent_patients: list[PatientRead]
