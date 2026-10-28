-- Additive PostgreSQL search indexes; existing patient and note rows are preserved.
-- App startup applies these same idempotent expressions automatically.
-- Run in the schema containing patients (public for the demo).

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX IF NOT EXISTS ix_patients_search_full_name_trgm ON patients USING gin (lower(regexp_replace(trim(first_name || ' ' || last_name), '\s+', ' ', 'g')) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_patients_search_first_name_trgm ON patients USING gin (lower(regexp_replace(trim(first_name), '\s+', ' ', 'g')) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_patients_search_last_name_trgm ON patients USING gin (lower(regexp_replace(trim(last_name), '\s+', ' ', 'g')) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_patients_search_email_trgm ON patients USING gin (lower(coalesce(email, '')) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_patients_search_phone_trgm ON patients USING gin (lower(coalesce(phone, '')) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_patients_search_phone_digits_trgm ON patients USING gin (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_patients_search_conditions_trgm ON patients USING gin (lower(CAST(conditions AS VARCHAR)) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_patients_search_exact_name ON patients (lower(regexp_replace(trim(first_name || ' ' || last_name), '\s+', ' ', 'g')));

CREATE INDEX IF NOT EXISTS ix_patients_search_exact_email ON patients (lower(coalesce(email, '')));

CREATE INDEX IF NOT EXISTS ix_patients_search_exact_phone ON patients (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'));

CREATE INDEX IF NOT EXISTS ix_patients_search_short_id ON patients (lower(substr(CAST(id AS VARCHAR), 1, 8)));
