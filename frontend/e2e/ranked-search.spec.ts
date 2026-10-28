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
    await expect(fuzzyRow).toContainText(ids[3].slice(0, 8).toUpperCase());
    await expect(fuzzyRow.getByRole('link', { name: /^View / })).toHaveAttribute(
      'aria-label',
      new RegExp(ids[3]),
    );
    await search.press('Enter');
    await expect(page).toHaveURL(/\/patients\?/);
    await expect(page.getByRole('heading', { name: 'Your patients.' })).toBeVisible();

    // Hold the next response to prove old suggestions cannot be clicked while updating.
    let releaseSearch: () => void = () => {};
    const heldResponse = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    const nextQuery = ids[0].slice(0, 8).toUpperCase();
    await page.route('**/api/patients?*', async (route) => {
      if (new URL(route.request().url()).searchParams.get('search') === nextQuery) {
        await heldResponse;
      }
      await route.continue();
    });
    await search.fill(nextQuery);
    try {
      await expect(page.locator('.directory-searching')).toBeVisible();
      await expect(rows).toHaveCount(0);
    } finally {
      releaseSearch();
    }
    await expect(exactRow.locator('.search-match')).toHaveText('Exact short ID');
    await expect(page).toHaveURL(/\/patients\?/);

    await search.fill(`rank.exact.${suffix}@example.com`);
    await expect(exactRow.locator('.search-match')).toHaveText('Exact contact');
    await search.fill('12025550401');
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
