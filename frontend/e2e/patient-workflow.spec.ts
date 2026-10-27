import { expect, test } from '@playwright/test';
import type { Page, Response } from '@playwright/test';

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

// A local UI accidentally built with a hosted API URL must never write to that API.
test.beforeEach(async ({ context }) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && !loopbackHosts.has(url.hostname)) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
});

function apiResponse(page: Page, method: string, path: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && new URL(response.url()).pathname === path,
  );
}

async function expectStatus(response: Response, status: number) {
  const details = response.status() === status ? '' : `: ${await response.text()}`;
  expect(response.status(), `${response.request().method()} ${response.url()}${details}`).toBe(
    status,
  );
}

test('patient forms, persisted notes, summaries, and deletion work together', async ({
  page,
  request,
}) => {
  const firstName = 'Browser';
  const lastName = `Regression${Date.now()}`;
  const name = `${firstName} ${lastName}`;
  const noteContent = 'Evening walk tolerated. Review hydration at the next fictional visit.';
  let patientId: string | undefined;

  try {
    await page.goto('/patients');
    await expect(page.getByRole('heading', { name: 'Your patients.' })).toBeVisible();
    await page.getByRole('button', { name: 'Add patient', exact: true }).click();
    const createForm = page.getByRole('dialog');
    await createForm.getByRole('button', { name: 'Create patient', exact: true }).click();
    await expect(createForm.getByText('First name is required', { exact: true })).toBeVisible();
    await expect(createForm.getByText('Last name is required', { exact: true })).toBeVisible();
    await expect(
      createForm.getByText('Enter a valid date of birth that is not in the future', {
        exact: true,
      }),
    ).toBeVisible();
    await createForm.getByLabel('First name', { exact: false }).fill(firstName);
    await createForm.getByLabel('Last name', { exact: false }).fill(lastName);
    await createForm.getByLabel('Date of birth', { exact: false }).fill('1985-04-12');
    await createForm.getByLabel('Email address', { exact: true }).fill('browser@example.com');
    await createForm.getByLabel('Conditions', { exact: true }).fill('Exercise-induced asthma');
    await createForm.getByLabel('Allergies', { exact: true }).fill('Latex');
    const createdResponse = apiResponse(page, 'POST', '/api/patients');
    await createForm.getByRole('button', { name: 'Create patient', exact: true }).click();
    const created = await createdResponse;
    await expectStatus(created, 201);
    const createdPatient = (await created.json()) as { id: string };
    patientId = createdPatient.id;
    expect(patientId).toMatch(/^[0-9a-f-]{36}$/);
    const patientPath = `/api/patients/${patientId}`;
    const detailPath = `/patients/${patientId}`;
    await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Edit patient', exact: true }).click();
    const editForm = page.getByRole('dialog');
    await editForm.getByLabel('Phone number', { exact: true }).fill('(555) 010-2026');
    await editForm
      .getByLabel('Address', { exact: true })
      .fill('123 Fictional Lane, Example City, IL 60000');
    const updatedResponse = apiResponse(page, 'PUT', patientPath);
    await editForm.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expectStatus(await updatedResponse, 200);
    await expect(editForm).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '(555) 010-2026', exact: true })).toBeVisible();
    await expect(page.getByText('123 Fictional Lane, Example City, IL 60000')).toBeVisible();

    await page.getByLabel('Add a note', { exact: true }).fill(noteContent);
    await page.getByLabel('Note date and time', { exact: true }).fill('2020-02-03T04:05');
    const noteResponse = apiResponse(page, 'POST', `${patientPath}/notes`);
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    const savedNote = await noteResponse;
    await expectStatus(savedNote, 201);
    const note = (await savedNote.json()) as { id: string; timestamp: string };
    expect(new Date(note.timestamp).toISOString()).toBe('2020-02-03T04:05:00.000Z');
    await page.reload();
    const noteArticle = page.locator('article.note-item').filter({ hasText: noteContent });
    await expect(noteArticle).toBeVisible();
    await expect(noteArticle.locator('time')).toHaveAttribute('datetime', note.timestamp);
    await expect(noteArticle.locator('.note-time')).toHaveText('4:05 AM');

    const summaryResponse = apiResponse(page, 'GET', `${patientPath}/summary`);
    await page.getByRole('button', { name: 'Generate summary', exact: true }).click();
    await expectStatus(await summaryResponse, 200);
    const summary = page.locator('.summary-output');
    await expect(summary).toContainText(name);
    await expect(summary).toContainText('Exercise-induced asthma');
    await expect(summary).toContainText('Latex');
    await expect(summary).toContainText('2020-02-03 at 04:05 UTC');
    await expect(summary).toContainText(noteContent);

    await noteArticle.getByRole('button', { name: /^Delete note from / }).click();
    const deleteNoteDialog = page.getByRole('dialog', { name: 'Delete this note?' });
    await expect(deleteNoteDialog.getByText(noteContent)).toBeVisible();
    const deletedNoteResponse = apiResponse(page, 'DELETE', `${patientPath}/notes/${note.id}`);
    // This request is the regression check for the record-updated cache after note deletion.
    const refreshedPatientResponse = apiResponse(page, 'GET', patientPath);
    await deleteNoteDialog.getByRole('button', { name: 'Delete note', exact: true }).click();
    await expectStatus(await deletedNoteResponse, 204);
    await expectStatus(await refreshedPatientResponse, 200);
    await expect(noteArticle).toHaveCount(0);
    await expect(summary).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Every story starts somewhere' })).toBeVisible();

    const regeneratedResponse = apiResponse(page, 'GET', `${patientPath}/summary`);
    await page.getByRole('button', { name: 'Generate summary', exact: true }).click();
    await expectStatus(await regeneratedResponse, 200);
    await expect(summary).toContainText('No patient notes recorded.');
    await expect(summary).not.toContainText(noteContent);

    await page.getByRole('button', { name: 'Patient actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete patient', exact: true }).click();
    const deletePatientDialog = page.getByRole('dialog', { name: 'Delete patient?' });
    await expect(deletePatientDialog.getByText(name, { exact: true })).toBeVisible();
    const deletedPatientResponse = apiResponse(page, 'DELETE', patientPath);
    await deletePatientDialog.getByRole('button', { name: 'Delete patient', exact: true }).click();
    await expectStatus(await deletedPatientResponse, 204);
    await expect(page).toHaveURL(/\/patients$/);
    await page.goto(detailPath);
    await expect(page.getByRole('heading', { name: 'Patient record not found.' })).toBeVisible();
    const missingRecord = await request.get(patientPath);
    expect(missingRecord.status()).toBe(404);
  } finally {
    if (patientId) {
      // Failed runs clean up only the patient they created, on the loopback database.
      const cleanup = await request.delete(`/api/patients/${patientId}`);
      expect([204, 404]).toContain(cleanup.status());
    }
  }
});

test('390px pages contain overflow and patient tables scroll with the keyboard', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const patients = await request.get('/api/patients?page_size=1');
  expect(patients.status()).toBe(200);
  const data = (await patients.json()) as { items: { id: string }[] };
  expect(data.items.length, 'The isolated Compose database must contain seeded patients').toBe(1);
  const paths = [
    { path: '/', heading: 'Care starts with clarity.', table: true },
    { path: '/patients', heading: 'Your patients.', table: true },
    { path: `/patients/${data.items[0].id}`, heading: undefined, table: false },
  ];

  for (const { path, heading, table } of paths) {
    await page.goto(path);
    await expect(
      heading ? page.getByRole('heading', { name: heading, exact: true }) : page.locator('h1'),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(0);

    if (table) {
      const scrollArea = page.locator('.table-scroll');
      await expect(scrollArea.locator('tbody tr').first()).toBeVisible();
      await expect(scrollArea).toHaveAttribute('role', 'region');
      await expect(scrollArea).toHaveAttribute('tabindex', '0');
      await expect(scrollArea).toHaveAccessibleName(/\S+/);
      await expect
        .poll(() => scrollArea.evaluate((element) => element.scrollWidth > element.clientWidth))
        .toBe(true);
      await scrollArea.focus();
      await expect(scrollArea).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(() => scrollArea.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(0);
    } else {
      await expect(page.getByRole('heading', { name: 'Personal information' })).toBeVisible();
    }
  }
});
