# Ascertain Care

A full-stack patient management demo built with React, TypeScript, FastAPI, and PostgreSQL. The interface supports a dashboard, patient records, timestamped notes, and deterministic patient summaries.

**Demo:** [Ascertain Care](https://ascertain-care-liam-2026.liamcox190.chatgpt.site). **Public repository:** [liamcox/ascertain-full-stack-take-home](https://github.com/liamcox/ascertain-full-stack-take-home). **Live API:** [interactive documentation](https://ascertain-care-liam-2026-api.onrender.com/docs).

The deployed API uses Render's free Python service and PostgreSQL 17 on Neon's Free plan. After inactivity, allow about a minute for the backend to wake before retrying a failed request. [Render free service behavior](https://render.com/docs/free#spinning-down-on-idle).

All seeded records are fictional. This take-home intentionally has no authentication or authorization; use synthetic data only. Anyone who can reach the demo API can read or change its records.

## Run locally

Install Docker with the Compose plugin, then run from the repository root:

```sh
cp .env.example .env
docker compose up --build
```

Open [the app](http://localhost:3000) and [interactive API documentation](http://localhost:8000/docs). The API health endpoint is [localhost:8000/health](http://localhost:8000/health).

Compose starts three services: the React build served by nginx, FastAPI, and PostgreSQL. PostgreSQL stays on the internal Compose network. A named volume preserves records between restarts. The backend creates the schema and seeds 120 fictional patients on first startup. A persisted seed marker prevents duplication and prevents deleted patients from reappearing on restart. The initial PostgreSQL schema is provided in [`backend/sql/001_initial.sql`](backend/sql/001_initial.sql) and additive search indexes in [`backend/sql/002_ranked_patient_search.sql`](backend/sql/002_ranked_patient_search.sql) for inspection; startup applies the equivalent definitions automatically.

Stop with `docker compose down`. To deliberately discard **all local patient data** and reseed on the next start, use `docker compose down --volumes`.

### Develop without Docker

Use Python 3.12+, Node.js 22+, and a running PostgreSQL instance. Create a database and set `DATABASE_URL` to its connection string in the backend shell:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
export DATABASE_URL='postgresql+psycopg://ascertain:ascertain_dev@localhost:5432/ascertain'
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API initializes and seeds the database automatically. In a second shell:

```sh
cd frontend
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173). Vite proxies `/api` to the local FastAPI process and removes that prefix. The backend itself exposes `/patients`, not `/api/patients`.

## Workflows

| Route | Behavior |
| --- | --- |
| `/` | Dashboard with status counts and recent visits. |
| `/patients` | Searchable patient directory, status filters, sorting, and server-side pagination. |
| `/patients/:id` | View a profile, manage notes, generate a summary, edit, or delete the record. |
| Other paths | Missing-page state with a route back to the app. |

Use **Add patient** on the dashboard or directory to open the creation form; saving opens the new profile. Use **Edit patient** on a profile to open its edit form. Notes are added inline with a date/time picker defaulting to now.

The header’s light/dark control follows the device theme initially and remembers a manual choice in browser local storage. The dashboard’s patient-status donut uses the API’s current status counts, with labelled counts and percentages; each legend link opens that filtered directory. Loading and zero-patient states are handled without empty-chart arithmetic errors.

The interface includes loading, empty, failed-request, validation, and missing-record states. Destructive actions require confirmation. Successful mutations refresh the relevant directory, detail, notes, and dashboard queries.

## Data model and rules

- Patients have UUIDs, first/last name, date of birth, status, optional contact/address information, blood type, conditions, allergies, and last visit date. Age is calculated from date of birth rather than stored.
- Status values are `active`, `follow_up`, and `inactive`, displayed as Active, Needs follow-up, and Inactive.
- Names must be nonblank. Birth and last visit dates cannot be in the future; a visit cannot precede birth. Optional emails must be valid, and blood type is restricted to the eight standard ABO/Rh values.
- Conditions and allergies are trimmed, deduplicated lists. An empty list means nothing was recorded, not a confirmed absence.
- Notes belong to one patient, contain nonblank text, and have timestamps normalized to UTC. Notes are returned newest first. Deleting a patient also deletes its notes.
- Summaries are generated on request as a profile paragraph followed by a chronological narrative quoting the saved notes. They preserve recorded content and identify missing fields. They do not call an LLM or make clinical inferences, diagnoses, or recommendations.

The seed dataset includes all statuses, missing optional fields, and patients with zero, one, or multiple notes.

## API

FastAPI publishes the complete request/response schemas at `/docs` and `/openapi.json`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Application and database readiness. |
| `GET` | `/dashboard` | Counts by status and the five latest recorded visits. |
| `GET` | `/patients` | Search, filter, sort, and paginate patients. |
| `POST` | `/patients` | Create a patient (`201`). |
| `GET` | `/patients/{id}` | Retrieve a patient. |
| `PUT` | `/patients/{id}` | Replace editable patient fields. |
| `DELETE` | `/patients/{id}` | Delete a patient and associated notes (`204`). |
| `GET`, `POST` | `/patients/{id}/notes` | List notes or add a timestamped note (`201`). |
| `DELETE` | `/patients/{id}/notes/{note_id}` | Delete a note belonging to the specified patient (`204`). |
| `GET` | `/patients/{id}/summary` | Generate a current template summary. |

Directory parameters: `search`, `status`, `page` (1+), `page_size` (1–100; default 12), `sort_by` (`name`, `age`, `last_visit`, or `status`), and `sort_order` (`asc` or `desc`). Results include `items`, `total`, `page`, `page_size`, and `total_pages`; stable ID ordering breaks ties. Missing patients/notes return `404`; invalid request data returns `422`.

### Ranked patient search

Nonblank searches rank candidates in this order, before pagination:

1. Exact full UUID (canonical or compact). The API also accepts eight-character short IDs for compatibility, but the UI shows only the complete ID on a patient profile. Copied `ID` / `Patient ID` labels, optional `:` or `#`, whitespace, braces, and validated UUID/short-ID grouping are accepted; the complete remaining value must be a valid short or full ID. Short IDs are not guaranteed unique; collisions return every matching patient.
2. Exact full name or contact. Name matching ignores case and repeated whitespace; email ignores case, and phone matching ignores formatting characters.
3. A full, first, or last name starting with the search.
4. A substring in the full name, email, phone, or recorded conditions. SQL wildcard characters are treated literally.
5. Similar names, labelled **Possible match**. PostgreSQL `pg_trgm` compares full, first, and last names with a similarity threshold of 0.3; suggestions within this tier sort by similarity. Fuzzy expansion requires at least three letters and allows only letters, spaces, apostrophes, or hyphens. IDs, email addresses, phone numbers, and one/two-letter queries do not receive fuzzy expansion. This catches some name typos; it is not a guarantee that every misspelling will match.

The chosen column sort breaks relevance ties, followed by stable ID ordering. With no search, column sorting applies normally. Status filtering applies to all candidate types. Each list item carries `search_match` (`kind`, `label`, and `score`), or `null` for an unfiltered directory. The fuzzy score is text similarity, not a probability that two records identify the same person; other tiers use 1.0. The UI displays labels rather than numerical confidence.

Directory rows show date of birth and contact details. Shortened IDs are omitted from rows and profile headings; the profile’s secondary **Record details** section shows the complete ID with a **Copy ID** button. Directory search leads with names and contacts; its help explains how to paste the complete profile ID for exact lookup. A similar name never selects or opens a patient automatically. Typing waits for a 750ms pause before issuing a search; Enter commits immediately, and input-method composition finishes before searching. Previous rows and counts remain visible with the original completed query, filter, sort, and page labels until the new result is ready. A small fixed-space updating indicator appears only during an actual request. Changing a filter or sort commits a pending name together with that change; browser navigation cancels abandoned drafts. Search state remains in the URL. Failed updates show an error and retry while preserving clearly labelled previous results. Superseded requests use abort signals, and results remain scoped to their query key.

## Architecture and tradeoffs

```text
React + TypeScript + Mantine
  └─ TanStack Query / fetch
       └─ FastAPI + Pydantic
            └─ SQLAlchemy + psycopg
                 └─ PostgreSQL
```

React Router handles page navigation. React Hook Form and Zod provide immediate form feedback; Pydantic independently validates API input. TanStack Query owns remote data, caching, loading/error states, and invalidation. Component state is sufficient for transient UI, so Redux would add little value here.

Pagination, candidate filtering, and relevance ranking run in SQL rather than downloading every profile. Small pages make virtualization unnecessary for this dataset. Database indexes cover names, status, visit dates, and note relationships. PostgreSQL uses GIN trigram expression indexes for names, contacts, and conditions, plus exact-match expression indexes. Startup installs `pg_trgm` in `public` and creates missing search indexes idempotently; the database role needs permission to install this trusted extension and create indexes. SQLite uses compatible trigram SQL functions for test compatibility; Unicode classification can vary with locale, so PostgreSQL remains authoritative and is the production search path. A larger dataset would still require realistic load tests, query-plan inspection, and versioned index migrations.

SQLAlchemy models keep persistence separate from API schemas. Schema creation uses `create_all` to keep a fresh take-home install simple. A production application would need versioned migrations, authentication, access control, audit history, and operational monitoring before holding real patient information.

Stretch features include server-side filtering/sorting, API tests, advanced ranked search, persistent light/dark themes, a patient-status chart, browser journeys, and CI checks. The initial scope prioritized complete workflows, validation, persistence, and reproducible setup; frontend refinements were added during review. The chart uses native SVG with a visible, keyboard-accessible legend rather than an additional chart library. Mantine manages color-scheme preference while semantic CSS tokens cover the custom interface.

## Checks

Run the backend suite from `backend/`:

```sh
python -m pip install -r requirements-dev.txt
pytest
```

The suite defaults to an isolated SQLite database. To exercise PostgreSQL, set `TEST_DATABASE_URL` to a test database connection string before running `pytest`. Each test creates and removes its own unique schema; the database role must have schema-creation permission.

Run frontend checks from `frontend/`:

```sh
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run build
```

With the seeded Compose stack running, reproduce the full-stack smoke check from the repository root:

```sh
python3 scripts/smoke_test.py --api-base http://127.0.0.1:3000/api --frontend-url http://127.0.0.1:3000
```

This checks the frontend API proxy, pagination, patient CRUD and persistence, timestamped notes, summaries, and root/detail SPA HTML. It modifies only a disposable patient fixture it creates and removes that fixture during cleanup; existing patient records are only read.

The committed verification workflow checks 52 API tests against PostgreSQL 17 and repeats the suite on isolated SQLite databases, including search tier order, normalization, typo suggestions, literal wildcard behavior, and filtered pagination. It runs frontend lint, formatting, typechecking, a production build, and `npm audit --audit-level=moderate`. The updated lock file currently reports zero known vulnerabilities.

The Compose job builds and starts the three services, runs the HTTP smoke check through nginx, and then runs Chromium against the actual React application. The six browser tests cover:

- Required form validation; create → edit → reload → timestamped note → summary → delete note → regenerate → delete patient → missing-record page.
- The patient-query refresh after note deletion, plus loaded dashboard, directory, and detail layouts at 390px. Table pages must have no document overflow and must support keyboard scrolling within their table region.
- Ranked exact-name, prefix, substring, and fuzzy suggestions; copied short/full ID and contact searches; visible birth dates/contact details and full-ID clipboard copying on profiles; retained results with their original query while a response is held; and explicit navigation to the chosen patient.
- Live dashboard status counts/percentages and filtering links; keyboard theme switching, preference persistence across navigation/reload, mobile containment, and system-theme/empty-chart behavior.
- Clock-controlled debounce checks: no requests before the final 750ms pause, immediate Enter without duplicate requests, draft preservation with filters, and cancellation when navigating away and back.

To reproduce browser checks against the running local Compose stack:

```sh
cd frontend
npm ci
npx playwright install chromium
npm run test:e2e
```

Browser tests accept only loopback origins and create/clean up their own patient. CI uploads the HTML report and failure evidence as the `browser-verification` artifact. The HTTP smoke check verifies API responses and SPA HTML; it does not operate React forms. Docker is unavailable on the development machine, so the complete container and Chromium check runs on GitHub's Ubuntu runner.

See the [theme and chart verification run](https://github.com/liamcox/ascertain-full-stack-take-home/actions/runs/40739227526) for this change and the [verification workflow](https://github.com/liamcox/ascertain-full-stack-take-home/actions/workflows/verify.yml) for newer results and the [reviewer walkthrough](docs/reviewer-walkthrough.md) for a short manual journey. Hosted browser checks cover read workflows; mutation evidence comes from the isolated Compose browser suite. Mobile containment is checked after patient rows load.

Python direct and transitive dependencies are constrained by the committed requirements lock files; npm uses the committed `package-lock.json`.

## Configuration and deployment

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Backend | PostgreSQL connection string. `postgres://` and `postgresql://` are normalized to the psycopg SQLAlchemy driver. |
| `SEED_DATA` | Backend | `true` by default; seed a fresh database once. Set `false` to start without demo records. |
| `CORS_ORIGINS` | Backend | Comma-separated exact frontend origins, without paths or trailing slashes. |
| `PORT` | Backend | Listening port; defaults to `8000`. |
| `VITE_API_URL` | Frontend build | `/api` for local proxying, or the hosted API's HTTPS origin. Never put credentials in this value. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Compose | Local database initialization settings from `.env`. |
| `FRONTEND_PORT`, `BACKEND_PORT` | Compose | Published local ports; default to `3000` and `8000`. |

The deployment uses ChatGPT Sites for the compiled UI, Render for FastAPI, and Neon for PostgreSQL. Production `VITE_API_URL` is `https://ascertain-care-liam-2026-api.onrender.com`; there is no mocked data mode. It is public build-time configuration; database credentials belong only in backend environment variables. The hosted API uses native Python 3.12.12; Docker Compose remains the local delivery path.

See [the deployment guide](docs/deployment.md) for repository publication, hosting setup, and end-to-end checks.
