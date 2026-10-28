# Deployment guide

The source runs locally as a three-service Docker Compose application. The hosted setup separates the static React UI on ChatGPT Sites, the Python API on Render, and PostgreSQL on Neon.

## Deployment record

| Component | URL / state |
| --- | --- |
| Public GitHub repository | [liamcox/ascertain-full-stack-take-home](https://github.com/liamcox/ascertain-full-stack-take-home) |
| Sites frontend | [Ascertain Care](https://ascertain-care-liam-2026.liamcox190.chatgpt.site); deployed and public |
| Render API | [ascertain-care-liam-2026-api.onrender.com](https://ascertain-care-liam-2026-api.onrender.com); healthy |
| API documentation | [Interactive FastAPI documentation](https://ascertain-care-liam-2026-api.onrender.com/docs) |
| Neon database | PostgreSQL 17 provisioned on the Free plan; connection string is secret |

The deployed API was checked for database health and fictional profiles. Ranked search uses `pg_trgm`; pasted ID labels are normalized before exact lookup. Read-only hosted checks cover typo suggestions and labelled short/full IDs. The verification workflow runs 52 API tests on both PostgreSQL 17 and SQLite, frontend checks and dependency audit, Docker Compose startup, HTTP smoke checks, and four Chromium browser tests. The browser suite exercises the full mutation journey, ranked patient suggestions, copied full IDs from profile record details, stable rows while typing, immediate Enter, explicit selection, and loaded pages at 390px with keyboard scrolling inside tables. Its disposable database is separate from the hosted demo. See the [verification workflow](https://github.com/liamcox/ascertain-full-stack-take-home/actions/workflows/verify.yml) for current results and the [reviewer walkthrough](reviewer-walkthrough.md).

The earlier mobile check missed overflow after rows loaded. The table scroll region now contains positioned content; loaded dashboard and directory measurements were rechecked at 390px. Read workflows are checked on the hosted demo; mutation and automatic layout evidence comes from the isolated Compose suite. Docker is unavailable on the development machine, so container checks run on GitHub's Ubuntu runner.

Neither service exposes a deployed Git revision endpoint. The database version above records the provisioned configuration; API health confirms connectivity, and PostgreSQL 17 behavior is independently exercised in CI. These are distinct from a runtime server-version or exact-revision assertion.

## 1. Publish the source

The public source is already published in the repository above. For a new deployment under another account, create a public GitHub repository named `ascertain-full-stack-take-home`. Keep `.env`, virtual environments, dependency folders, and build artifacts out of Git. Review the source before the first push.

If GitHub CLI is authenticated and no remote exists, run from the project root after creating the initial commit:

```sh
gh repo create ascertain-full-stack-take-home --public --source=. --remote=origin --push
```

Alternatively create an empty public repository through GitHub, add its URL as `origin`, and push the current branch. The repository contains both services; Render builds only `backend/`.

## 2. Create PostgreSQL on Neon

1. Create a project on Neon's Free plan and select a region near the API.
2. Use **Connect** to select the branch, database, and role. Copy the PostgreSQL connection string; a pooled URL is suitable for this API.
3. Preserve its SSL parameters, including `sslmode=require`. Supply the complete URL as Render's secret `DATABASE_URL` environment variable. The backend accepts the `postgresql://` scheme directly.

Do not add the connection string to the repository, frontend source, Sites configuration, screenshots, or README. Neon requires TLS; its connection dialog provides the applicable connection settings. [Neon connection documentation](https://neon.com/docs/connect/connect-from-any-app).

## 3. Deploy FastAPI on Render

The live API runs as a native Python **Web Service** on Render's **Free** instance type. To reproduce it, create a service from the GitHub repository and select the application branch.

Use the following settings for the native deployment:

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Runtime | Python 3 |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/health` |
| `PYTHON_VERSION` | `3.12.12` |
| `DATABASE_URL` | The secret Neon connection string |
| `SEED_DATA` | `true` |
| `CORS_ORIGINS` | `https://ascertain-care-liam-2026.liamcox190.chatgpt.site` |

On startup, FastAPI creates missing tables, ensures the `pg_trgm` extension exists in `public`, creates missing trigram/exact search indexes, and seeds an empty database once. The database role needs permission to install the trusted extension and create indexes. On a large production database, deploy indexes through a versioned migration with an appropriate concurrent-build strategy rather than blocking application startup. The seed marker is stored in PostgreSQL, so service restarts do not restore deleted records. `DATABASE_URL` is configured privately in Render and is never part of the frontend build.

The root `render.yaml` provides an alternative Docker Blueprint with the same application, free plan, environment variables, and health check. Import it through **New → Blueprint** and supply `DATABASE_URL` and `CORS_ORIGINS` when prompted. That Docker configuration is separate from the native Python runtime used by the current live service.

The Sites URL may not be available until frontend registration. Set `CORS_ORIGINS` after it is known, then redeploy the API. Avoid `*`; CORS should contain the exact origin the browser uses. An owner-only preview and a public Site may have different origins, so verify against the final published URL.

Once the service reports a successful deploy, check its returned HTTPS origin:

```sh
curl --fail https://ascertain-care-liam-2026-api.onrender.com/health
curl --fail 'https://ascertain-care-liam-2026-api.onrender.com/patients?page=1&page_size=1'
```

Expect `{"status":"ok"}` and a paginated response containing the seeded profiles. Open `/docs` to inspect the API. [Render FastAPI documentation](https://render.com/docs/deploy-fastapi).

Free Render services sleep after 15 minutes without inbound traffic and usually need about a minute to restart. The database persists on Neon; do not replace it with an SQLite file on Render's ephemeral disk. [Render free instance limitations](https://render.com/docs/free).

## 4. Publish the frontend on ChatGPT Sites

The frontend makes browser requests directly to the API. Build it with the real API origin, without an `/api` suffix:

```sh
cd frontend
VITE_API_URL=https://ascertain-care-liam-2026-api.onrender.com npm run build
```

Changing `VITE_API_URL` requires a new build and deployment. The variable is embedded in public JavaScript; it must contain only the API origin, never a password or database URL.

Use the Sites workflow to register the Site and package the compiled `frontend/dist/` contents as a static Site. Retain the Site's project ID in `.openai/hosting.json` in its prepared source directory and set the static directory to `dist`. Sites registration, source synchronization, saving a version, and deployment are separate steps; use the version and archive returned by the Sites helper for publication. A local, Git-ignored `sites/` directory holds the prepared Sites checkout and hosting configuration; the public application's source remains in `frontend/`.

Production must use the real FastAPI URL. The UI has no mocked API or browser-only data mode.

If the Sites URL changes after registration, update Render's `CORS_ORIGINS`. A browser refresh at `/patients` or a detail URL must return the SPA entry point; configure the static deployment's fallback if required by the host.

## 5. Verify the integrated demo

Use the final Sites URL and wait for the API's first wake-up if necessary:

1. Confirm dashboard counts and patient results come from the deployed API.
2. Search, filter by status, change sort, and move between pages.
3. Create a fictional patient, edit it, refresh the browser, and confirm persistence.
4. Add a timestamped note and generate a summary that includes it. Delete the note and verify the regenerated summary reflects the deletion.
5. Delete the test patient and confirm the detail route reports a missing record.
6. Refresh a nested route and check the layout at a narrow viewport.
7. Check browser requests for CORS errors and verify the API health check.

Record the actual URLs and verification results in this guide and the main README. A successful static deployment alone does not verify the database-backed workflows.

## Updates

After publishing backend changes, deploy the latest commit in Render. The current service uses a public repository URL without a GitHub integration; do not assume automatic deployments are enabled. Rebuild and redeploy the Sites frontend whenever frontend code or `VITE_API_URL` changes. Local `docker compose up --build` remains independent of hosted credentials.

This demo deliberately has no authentication and is shared mutable data. Keep all records synthetic. Production use would require access control and an operational plan beyond this take-home's scope.
