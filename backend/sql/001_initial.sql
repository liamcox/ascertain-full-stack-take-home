-- PostgreSQL schema for the patient API.
-- App startup applies the equivalent SQLAlchemy metadata automatically.
-- This is the initial schema; future changes should use incremental migrations.

CREATE TABLE patients (
	id UUID NOT NULL, 
	first_name VARCHAR(100) NOT NULL, 
	last_name VARCHAR(100) NOT NULL, 
	dob DATE NOT NULL, 
	status VARCHAR(9) NOT NULL, 
	email VARCHAR(254), 
	phone VARCHAR(50), 
	address VARCHAR(500), 
	blood_type VARCHAR(3), 
	last_visit DATE, 
	allergies JSON NOT NULL, 
	conditions JSON NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT patientstatus CHECK (status IN ('active', 'follow_up', 'inactive'))
);

CREATE INDEX ix_patients_status ON patients (status);

CREATE INDEX ix_patients_name ON patients (last_name, first_name);

CREATE INDEX ix_patients_last_visit ON patients (last_visit);

CREATE TABLE app_metadata (
	key VARCHAR(100) NOT NULL, 
	value TEXT NOT NULL, 
	PRIMARY KEY (key)
);

CREATE TABLE notes (
	id UUID NOT NULL, 
	patient_id UUID NOT NULL, 
	timestamp TIMESTAMP WITH TIME ZONE NOT NULL, 
	content TEXT NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(patient_id) REFERENCES patients (id) ON DELETE CASCADE
);

CREATE INDEX ix_notes_patient_id ON notes (patient_id);

CREATE INDEX ix_notes_timestamp ON notes (timestamp);
