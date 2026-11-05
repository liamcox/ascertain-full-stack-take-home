"""Current patient, encounter, note, and application metadata schema.

Revision ID: 0001_initial
Revises: None

Definitions are frozen here rather than importing changing ORM models. Existing
unversioned databases must be inspected and explicitly stamped, never upgraded
through this create-table revision.
"""

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "patients",
        sa.Column("id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("first_name", sa.String(100), nullable=False),
        sa.Column("last_name", sa.String(100), nullable=False),
        sa.Column("dob", sa.Date(), nullable=False),
        sa.Column("status", sa.String(9), nullable=False),
        sa.Column("email", sa.String(254), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("address", sa.String(500), nullable=True),
        sa.Column("blood_type", sa.String(3), nullable=True),
        sa.Column("last_visit", sa.Date(), nullable=True),
        sa.Column("allergies", sa.JSON(), nullable=False),
        sa.Column("conditions", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('active', 'follow_up', 'inactive')", name="patientstatus"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_patients_status", "patients", ["status"])
    op.create_index("ix_patients_name", "patients", ["last_name", "first_name"])
    op.create_index("ix_patients_last_visit", "patients", ["last_visit"])
    op.create_table(
        "app_metadata",
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_table(
        "encounters",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("patient_id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("doctor_name", sa.String(100), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_encounters_patient_id", "encounters", ["patient_id"])
    op.create_index("ix_encounters_timestamp", "encounters", ["timestamp"])
    op.create_table(
        "notes",
        sa.Column("id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("patient_id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("encounter_id", sa.Integer(), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["encounter_id"], ["encounters.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notes_patient_id", "notes", ["patient_id"])
    op.create_index("ix_notes_encounter_id", "notes", ["encounter_id"])
    op.create_index("ix_notes_timestamp", "notes", ["timestamp"])


def downgrade() -> None:
    # Explicit operator-requested downgrade only. This removes application data;
    # normal deployment never runs downgrade. Back up and prefer roll-forward.
    op.drop_table("notes")
    op.drop_table("encounters")
    op.drop_table("app_metadata")
    op.drop_table("patients")
