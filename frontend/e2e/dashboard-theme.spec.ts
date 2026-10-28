import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Dashboard, PatientPage } from '../src/api';

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const statuses = [
  { value: 'active', label: 'Active', count: 'active_patients' },
  { value: 'follow_up', label: 'Needs follow-up', count: 'follow_up_patients' },
  { value: 'inactive', label: 'Inactive', count: 'inactive_patients' },
] as const;

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

async function expectPageContained(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
}

test('live patient status chart links filter records and keyboard theme choice persists', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/dashboard');
  expect(response.status()).toBe(200);
  const dashboard = (await response.json()) as Dashboard;
  expect(dashboard.total_patients).toBeGreaterThan(0);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const root = page.locator('html');
  const chart = page.getByRole('region', { name: 'Patient status', exact: true });
  await expect(chart).toHaveAttribute('aria-busy', 'false');
  await expect(chart.locator('.patient-status-chart__total strong')).toHaveText(
    dashboard.total_patients.toLocaleString(),
  );
  for (const status of statuses) {
    const count = dashboard[status.count];
    const percentage = ((count / dashboard.total_patients) * 100).toLocaleString('en-US', {
      maximumFractionDigits: 1,
    });
    const legend = chart.locator(`a[href="/patients?status=${status.value}"]`);
    await expect(legend).toHaveAccessibleName(
      `${status.label}: ${count.toLocaleString()} patients, ${percentage}%. View patients.`,
    );
    await expect(legend.locator('.patient-status-chart__values strong')).toHaveText(
      count.toLocaleString(),
    );
    await expect(legend.locator('.patient-status-chart__values > span')).toHaveText(
      `${percentage}%`,
    );
  }

  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'light');
  const lightBackground = await root.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const darkToggle = page.getByRole('button', { name: 'Switch to dark theme', exact: true });
  await darkToggle.focus();
  await expect(darkToggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expect
    .poll(() => root.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(lightBackground);
  expect(await page.evaluate(() => localStorage.getItem('ascertain-color-scheme'))).toBe('dark');
  await page.reload();
  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expect(chart.locator('.patient-status-chart__total strong')).toHaveText(
    dashboard.total_patients.toLocaleString(),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await expectPageContained(page);
  const filteredResponse = page.waitForResponse(
    (result) =>
      result.request().method() === 'GET' &&
      new URL(result.url()).pathname === '/api/patients' &&
      new URL(result.url()).searchParams.get('status') === 'active',
  );
  await chart.locator('a[href="/patients?status=active"]').click();
  const filteredResult = await filteredResponse;
  expect(filteredResult.status()).toBe(200);
  const filtered = (await filteredResult.json()) as PatientPage;
  expect(filtered.total).toBe(dashboard.active_patients);
  expect(filtered.items.length).toBeGreaterThan(0);
  expect(filtered.items.every((patient) => patient.status === 'active')).toBe(true);
  await expect(page).toHaveURL(/\/patients\?status=active$/);
  await expect(page.getByRole('textbox', { name: 'Filter patients by status' })).toHaveValue(
    'Active',
  );
  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expectPageContained(page);

  const patient = filtered.items[0];
  await page.locator(`a[href="/patients/${patient.id}"]`).first().click();
  await expect(
    page.getByRole('heading', { name: `${patient.first_name} ${patient.last_name}`, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.patient-record-id')).toHaveText(patient.id);
  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expectPageContained(page);
  const lightToggle = page.getByRole('button', { name: 'Switch to light theme', exact: true });
  await lightToggle.focus();
  await page.keyboard.press('Space');
  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('ascertain-color-scheme'))).toBe('light');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Personal information', exact: true }),
  ).toBeVisible();
  await expect(root).toHaveAttribute('data-mantine-color-scheme', 'light');
  await expectPageContained(page);
});

test('empty status chart stays finite and fits mobile while following the system theme', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/api/dashboard', async (route) => {
    const url = new URL(route.request().url());
    if (!loopbackHosts.has(url.hostname) || route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        total_patients: 0,
        active_patients: 0,
        follow_up_patients: 0,
        inactive_patients: 0,
        recent_patients: [],
      },
    });
  });
  await page.goto('/');
  const chart = page.getByRole('region', { name: 'Patient status', exact: true });
  await expect(chart).toHaveAttribute('aria-busy', 'false');
  await expect(chart.locator('.patient-status-chart__total strong')).toHaveText('0');
  await expect(
    chart.getByText('Add a patient to see your workspace’s status breakdown.', { exact: true }),
  ).toBeVisible();
  await expect(chart.locator('.patient-status-chart__track')).toBeVisible();
  await expect(chart.locator('.patient-status-chart__segment')).toHaveCount(0);
  for (const status of statuses) {
    await expect(chart.locator(`a[href="/patients?status=${status.value}"]`)).toHaveAccessibleName(
      `${status.label}: 0 patients, 0%. View patients.`,
    );
  }
  await expect(chart).not.toContainText(/NaN|Infinity/);
  expect(await chart.locator('svg').evaluate((element) => element.outerHTML)).not.toMatch(
    /NaN|Infinity/,
  );
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expectPageContained(page);
  expect(await page.evaluate(() => localStorage.getItem('ascertain-color-scheme'))).toBeNull();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
  await expectPageContained(page);
});
