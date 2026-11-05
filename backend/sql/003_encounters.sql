-- Additive PostgreSQL encounter schema; existing patient and note rows are preserved.
-- Legacy adoption aid for pre-encounter databases; see docs/migrations.md.
-- Run in the schema containing patients and notes (public for the demo).

CREATE TABLE IF NOT EXISTS encounters (
    id SERIAL NOT NULL PRIMARY KEY,
    patient_id UUID NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
    doctor_name VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_encounters_patient_id ON encounters (patient_id);

CREATE INDEX IF NOT EXISTS ix_encounters_timestamp ON encounters (timestamp);

ALTER TABLE notes
    ADD COLUMN IF NOT EXISTS encounter_id INTEGER
    REFERENCES encounters (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_notes_encounter_id ON notes (encounter_id);
