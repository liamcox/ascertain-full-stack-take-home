import { expect, test } from '@playwright/test';

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

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

test('ranked suggestions show identity details and require an explicit patient choice', async ({
  page,
  request,
}) => {
  const suffix = Date.now()
    .toString(36)
    .replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)));
  const surname = `Searchwell${suffix}`;
  const exactName = `Avery ${surname}`;
  const fuzzyName = `Avrey ${surname}`;
  const ids: string[] = [];
  const fixtures = [
    { first_name: 'Avery', last_name: surname, dob: '1985-06-15', tag: 'exact' },
    { first_name: 'Avery', last_name: `${surname}son`, dob: '1976-02-23', tag: 'prefix' },
    {
      first_name: 'Morgan',
      last_name: `Other${suffix}`,
      dob: '1990-07-20',
      tag: 'substring',
      conditions: [exactName],
    },
    { first_name: 'Avrey', last_name: surname, dob: '1972-03-04', tag: 'fuzzy' },
  ];

  try {
    for (const fixture of fixtures) {
      const { tag, ...profile } = fixture;
      const response = await request.post('/api/patients', {
        data: {
          ...profile,
          status: 'active',
          email: `rank.${tag}.${suffix}@example.com`,
          phone: tag === 'exact' ? '+1 (202) 555-0401' : null,
        },
      });
      expect(response.status(), await response.text()).toBe(201);
      ids.push(((await response.json()) as { id: string }).id);
    }

    await page.goto('/patients');
    const search = page.getByRole('textbox', { name: /Search patients/ });
    await search.fill(exactName);
    const rows = page.locator('.patient-table tbody tr');
    const exactRow = rows.filter({ has: page.getByText(exactName, { exact: true }) });
    const fuzzyRow = rows.filter({ has: page.getByText(fuzzyName, { exact: true }) });
    await expect(exactRow.locator('.search-match')).toHaveText('Exact name');
    await expect(fuzzyRow.locator('.search-match')).toHaveText('Possible match');
    await expect(rows.locator('.search-match')).toHaveText([
      'Exact name',
      'Name starts with',
      'Contains search',
      'Possible match',
    ]);
    await expect(exactRow).toContainText('Jun 15, 1985');
    await expect(fuzzyRow).toContainText('Mar 4, 1972');
    await expect(fuzzyRow).toContainText(`rank.fuzzy.${suffix}@example.com`);
    await expect(fuzzyRow).not.toContainText(ids[3].slice(0, 8).toUpperCase());
    await expect(fuzzyRow.getByRole('link', { name: /^View / })).toHaveAttribute(
      'href',
      `/patients/${ids[3]}`,
    );
    await search.press('Enter');
    await expect(page).toHaveURL(/\/patients\?/);
    await expect(page.getByRole('heading', { name: 'Your patients.' })).toBeVisible();

    // Hold the next response: the existing rows stay visible and labelled with
    // their original search, rather than disappearing or claiming the new term.
    let releaseSearch: () => void = () => {};
    const heldResponse = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    const nextQuery = `ID ${ids[0].slice(0, 8).toUpperCase()}`;
    await page.route('**/api/patients?*', async (route) => {
      if (new URL(route.request().url()).searchParams.get('search') === nextQuery) {
        await heldResponse;
      }
      await route.continue();
    });
    await search.fill(nextQuery);
    try {
      await expect(page.locator('.directory-updating')).toContainText('Updating results…');
      await expect(rows).toHaveCount(4);
      await expect(fuzzyRow).toBeVisible();
      await expect(page.locator('.directory-results-label')).toContainText(exactName);
    } finally {
      releaseSearch();
    }
    await expect(exactRow.locator('.search-match')).toHaveText('Exact short ID');
    await expect(page.locator('.directory-results-label')).toContainText(nextQuery);
    await expect(page).toHaveURL(/\/patients\?/);

    for (const query of [ids[0], `Patient ID: {${ids[0].toUpperCase()}}`]) {
      await search.fill(query);
      await search.press('Enter');
      await expect(page.locator('.directory-results-label')).toContainText(query);
      await expect(exactRow.locator('.search-match')).toHaveText('Exact ID');
    }
    await search.fill(`rank.exact.${suffix}@example.com`);
    await expect(page.locator('.directory-results-label')).toContainText(
      `rank.exact.${suffix}@example.com`,
    );
    await expect(exactRow.locator('.search-match')).toHaveText('Exact contact');
    await search.fill('12025550401');
    await expect(page.locator('.directory-results-label')).toContainText('12025550401');
    await expect(exactRow.locator('.search-match')).toHaveText('Exact contact');

    // A typo stays a suggestion until the reviewer explicitly opens that exact record.
    await search.fill(exactName);
    await expect(fuzzyRow.locator('.search-match')).toHaveText('Possible match');
    await fuzzyRow.getByRole('link', { name: /^View / }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${ids[3]}$`));
    await expect(page.getByRole('heading', { name: fuzzyName, exact: true })).toBeVisible();
  } finally {
    for (const id of ids) {
      const cleanup = await request.delete(`/api/patients/${id}`);
      expect([204, 404]).toContain(cleanup.status());
    }
  }
});

test('typing waits 750ms, retains labelled results, and Enter searches immediately', async ({
  page,
}) => {
  // Control the debounce without relying on wall-clock timing on the CI runner.
  const clockStart = new Date('2026-10-28T12:00:00Z');
  await page.clock.install({ time: clockStart });
  await page.goto('/patients?search=Harpr');
  const search = page.getByRole('textbox', { name: /Search patients/ });
  const rows = page.locator('.patient-table tbody tr');
  const label = page.locator('.directory-results-label');
  await expect(label).toContainText('Harpr');
  await expect(rows).toHaveCount(5);
  await expect(rows.locator('.search-match')).toHaveText(Array(5).fill('Possible match'));
  const originalNames = await rows.locator('strong').allTextContents();
  await page.clock.pauseAt(new Date('2026-10-28T12:01:00Z'));

  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/patients') requests.push(url.searchParams.get('search') || '');
  });
  let releaseSearch: () => void = () => {};
  const heldResponse = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route('**/api/patients?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('search') === 'Harper') {
      await heldResponse;
    }
    await route.continue();
  });

  try {
    for (const text of ['H', 'Ha']) {
      await search.fill(text);
      await page.clock.runFor(500);
      expect(requests).toEqual([]);
      await expect(rows.locator('strong')).toHaveText(originalNames);
      await expect(label).toContainText('Harpr');
    }
    await search.fill('Harper');
    await page.clock.runFor(749);
    expect(requests).toEqual([]);
    await expect(page.locator('.directory-updating')).not.toContainText('Updating results…');
    await expect(rows.locator('strong')).toHaveText(originalNames);

    const debouncedRequest = page.waitForRequest(
      (request) => new URL(request.url()).searchParams.get('search') === 'Harper',
    );
    await page.clock.runFor(1);
    await debouncedRequest;
    expect(requests).toEqual(['Harper']);
    await expect(rows.locator('strong')).toHaveText(originalNames);
    await expect(label).toContainText('Harpr');
  } finally {
    releaseSearch();
    await page.clock.resume();
  }
  await expect(label).toContainText('Harper');
  await expect(rows.locator('.search-match')).toHaveText(Array(5).fill('Name starts with'));

  // Frozen timers prove Enter starts the request without waiting for debounce.
  await page.clock.pauseAt(new Date('2026-10-28T12:03:00Z'));
  const enteredRequest = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get('search') === 'Harper Bennett',
  );
  await search.fill('Harper Bennett');
  await search.press('Enter');
  await enteredRequest;
  expect(requests).toEqual(['Harper', 'Harper Bennett']);
  await page.clock.resume();
  await expect(label).toContainText('Harper Bennett');
  await expect(rows.first().locator('.search-match')).toHaveText('Exact name');
  await page.clock.runFor(1000);
  expect(requests).toEqual(['Harper', 'Harper Bennett']);
  await expect(page.getByRole('heading', { name: 'Your patients.' })).toBeVisible();

  // Changing a filter while a draft is waiting must commit both together,
  // rather than silently restoring the previous text from the URL.
  await page.clock.pauseAt(new Date('2026-10-28T12:05:00Z'));
  const filteredRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.searchParams.get('search') === 'Harper' && url.searchParams.get('status') === 'inactive'
    );
  });
  await search.fill('Harper');
  await page.getByRole('textbox', { name: 'Filter patients by status' }).click();
  await page.clock.runFor(200);
  await page.getByRole('option', { name: 'Inactive', exact: true }).click();
  await filteredRequest;
  await expect(search).toHaveValue('Harper');
  await page.clock.resume();
  await expect(label).toContainText('Harper');
  await expect(page.locator('.directory-results-meta')).toContainText('Inactive');
  await expect(rows).toHaveCount(5);

  // Leaving the directory cancels its pending draft; browser Back restores the
  // committed search without a delayed request for the abandoned text.
  await page.clock.pauseAt(new Date('2026-10-28T12:07:00Z'));
  await search.fill('Morgan');
  await page.getByRole('link', { name: /^View Harper Bennett,/ }).click();
  await page.clock.resume();
  await expect(page.getByRole('heading', { name: 'Harper Bennett', exact: true })).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue('Harper');
  await expect(label).toContainText('Harper');
  await page.clock.runFor(1000);
  expect(requests).not.toContain('Morgan');
});
