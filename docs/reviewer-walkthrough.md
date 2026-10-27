# Reviewer walkthrough

Allow 3–5 minutes for the manual walkthrough after the app is running. All seeded records are fictional.

## Browse the deployed demo

Open [Ascertain Care](https://ascertain-care-liam-2026.liamcox190.chatgpt.site/). The free API may take about a minute to wake after inactivity; retry if the first request fails.

- Open the patient directory, search for a name, change the status filter, sort a column, and move between pages.
- Open an existing profile, read its saved notes, and select **Generate summary**. Refresh the profile URL to check direct navigation.
- At a narrow viewport, scroll the patient table horizontally; keyboard users can focus the table region and use the arrow keys.

Keep this hosted walkthrough read-only because the demo shares one public database. The [live API documentation](https://ascertain-care-liam-2026-api.onrender.com/docs) describes the schemas and endpoints; use the local stack for writes.

## Exercise the complete workflow locally

From a fresh repository checkout, start the isolated Docker Compose stack:

```sh
cp .env.example .env
docker compose up --build --detach --wait
```

Open [localhost:3000](http://localhost:3000), then use only a new fictional record for this journey:

1. Select **Add patient**. Submit an empty form to see required-field feedback, then create a patient with a recognizable test name and a past birth date.
2. Select **Edit patient**, change the phone number and address, save, and reload. Confirm both values persisted.
3. Add a note with a recognizable sentence and an explicit past date and time. Reload and confirm its content and timestamp persisted. The input and note display use the browser's local time; the API stores UTC.
4. Select **Generate summary**. Confirm it reflects the profile and includes the saved note.
5. Delete that note through its confirmation dialog. Confirm it disappears and the generated summary clears. Generate the summary again and confirm the deleted note is absent.
6. Copy the profile URL. Open **Patient actions → Delete patient**, confirm deletion, and revisit the copied URL. Confirm the missing-record page appears. Remove only the record created for this walkthrough.

Stop the stack with `docker compose down`. Its local database volume persists between runs.

## Reproduce the automated browser checks

Leave the seeded Compose stack running, then run:

```sh
cd frontend
npm ci
npx playwright install chromium
npm run test:e2e
```

On Linux, install Playwright's browser system dependencies if prompted (`npx playwright install --with-deps chromium`). The default target is `http://127.0.0.1:3000`. `E2E_BASE_URL` can select another loopback origin, for example:

```sh
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

The configuration rejects hosted targets. Browser requests to non-loopback hosts are also blocked so a local UI accidentally built with a hosted API URL cannot modify the shared demo. The workflow creates a unique patient and cleans up only that patient, including after a failed run. Other seeded records are read only.

These Playwright checks exercise real form validation, create/edit/reload persistence, a specific note timestamp, summaries, note and patient deletion, the missing-record state, and 390px table overflow and keyboard scrolling. Results are written to `frontend/playwright-report/`; failure screenshots, traces, and videos are retained in `frontend/test-results/`. Open the HTML report with `npx playwright show-report` from `frontend/`.

The separate `scripts/smoke_test.py` check uses HTTP requests through nginx's API proxy to verify API behavior, persistence, and SPA HTML delivery. It does not operate browser controls or verify rendered layout; Playwright covers those interactions.
