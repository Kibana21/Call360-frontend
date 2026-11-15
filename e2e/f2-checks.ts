import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// F2 — Call Explorer, Work Queues and search on the real stack (backend 8001 + call360_test with S0-SEED-1).
// E2E-02 (card → register count equality), queue counts = rows, URL-held filters, stable paging, scoped search,
// D-39 (no Malaysian record), FE-04 (accessibility and layout). Called from overview.spec.ts so the suite reuses
// its one sign-in per role and stays under the per-IP login rate limit (20/min).
const MY_REF = /CB-2026-2\d{4}|POL-MY-/;

async function registerTotal(page: Page): Promise<number> {
  const status = page.getByTestId('register-total');
  await expect(status).toContainText('matching cases');
  const m = (await status.innerText()).match(/of ([\d,]+) matching/);
  return Number(m![1]!.replace(/,/g, ''));
}

async function noMalaysianText(page: Page): Promise<void> {
  expect(await page.locator('body').innerText()).not.toMatch(MY_REF);
}

async function a11yAndLayout(page: Page, name: string): Promise<void> {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${name}@${width}: ${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)).toEqual([]);
    await page.screenshot({ path: `test-results/screens/${name}-${width}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${name} at ${width}px`).toBeLessThanOrEqual(0);
  }
}

export async function f2Admin(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });

  // E2E-02: every card with a drilldown opens Call Explorer with the identical count.
  for (const id of ['OPS-01', 'OPS-02', 'OPS-04', 'OPS-05']) {
    await page.goto('/');
    const card = Number((await page.getByTestId(`kpi-${id}`).innerText()).replace(/,/g, ''));
    await page.getByTestId(`drill-${id}`).click();
    await expect(page).toHaveURL(/\/calls\?/);
    expect(await registerTotal(page), id).toBe(card);
  }
  // Risk segment → register
  await page.goto('/');
  const risk = page.getByRole('region', { name: 'Case distribution by risk' });
  const high = risk.getByRole('link', { name: /^High \(synthetic\): view (\d+) open cases$/ });
  const highCount = Number((await high.getAttribute('aria-label'))!.match(/view (\d+)/)![1]);
  await high.click();
  expect(await registerTotal(page)).toBe(highCount);
  await expect(page.getByText('Risk: High')).toBeVisible();

  // Bookmarkable filters: reloading keeps the server query and the count.
  await page.goto('/calls?state=AWAITING_CALLBACK&band=HIGH&sort=case_ref');
  const filtered = await registerTotal(page);
  await page.reload();
  expect(await registerTotal(page)).toBe(filtered);
  await expect(page.getByLabel('State', { exact: true })).toHaveValue('AWAITING_CALLBACK');

  // Stable paging: next then previous returns the same first page; pages never overlap.
  await page.goto('/calls?sort=case_ref');
  const refs = async () => page.locator('[data-testid="case-table"] tbody tr').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-case-ref')));
  await expect(page.locator('[data-testid="case-table"] tbody tr')).toHaveCount(25);
  const first = await refs();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Page 2 ·')).toBeVisible();
  await expect.poll(async () => (await refs())[0]).not.toBe(first[0]);
  const second = await refs();
  expect(second).toHaveLength(25);
  expect(second.filter((r) => first.includes(r))).toEqual([]);
  expect([...first, ...second]).toEqual([...first, ...second].sort());
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.getByText('Page 1 ·')).toBeVisible();
  await expect.poll(refs).toEqual(first);
  await noMalaysianText(page);
  await a11yAndLayout(page, 'call-explorer');

  // Work Queues: each card count equals the rows the register returns for that queue.
  await page.goto('/queues');
  for (const code of ['DUE_TODAY', 'OVERDUE', 'AWAITING_CALLBACK', 'ON_HOLD']) {
    await page.getByTestId(`queue-${code}`).click();
    const n = Number((await page.getByTestId(`queue-${code}`).innerText()).replace(/,/g, ''));
    await expect(page.getByTestId('queue-total')).toContainText(`${n.toLocaleString('en-SG')} cases`);
  }
  await expect(page.getByRole('button', { name: 'Launch browser session' })).toBeDisabled();
  await page.getByRole('button', { name: /^On hold/ }).first().click();
  await a11yAndLayout(page, 'work-queues');

  // Top-bar search → policy suggestion → Policy Detail (F4; F2 opened the filtered register).
  await page.goto('/');
  const box = page.getByRole('combobox', { name: /Search cases, policies, attempts and sessions/ });
  await box.fill('POL-SG-000001');
  await expect(page.getByRole('option', { name: /POL-SG-000001/ }).first()).toBeVisible();
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/policies\/[0-9a-f-]{36}$/);
  await page.goto('/calls?q=POL-SG-000001');
  expect(await registerTotal(page)).toBe(1);
  // Policy ref and Enter → full results page
  await box.fill('POL-SG-000001');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=POL-SG-000001/);
  await expect(page.getByTestId('search-hit').first()).toContainText('exact match');
  await a11yAndLayout(page, 'search');
  // D-39: a Malaysian reference finds nothing anywhere.
  await page.goto('/search?q=CB-2026-20001');
  await expect(page.getByText('No matching records in your scope')).toBeVisible();
  await page.goto('/calls?q=POL-MY');
  await expect(page.getByText('No matching cases')).toBeVisible();
}

export async function f2User(page: Page): Promise<void> {
  await page.goto('/calls');
  const all = await registerTotal(page);
  const api = await (await page.request.get('/api/v1/cases?limit=1')).json();
  expect(all).toBe(api.total);
  expect(api.markets).toEqual(['SG']);
  await noMalaysianText(page);
  await page.goto('/queues?queue=OVERDUE');
  const card = Number((await page.getByTestId('queue-OVERDUE').innerText()).replace(/,/g, ''));
  await page.goto('/calls?queue=OVERDUE');
  expect(await registerTotal(page)).toBe(card);
  const suggest = await (await page.request.get('/api/v1/search/suggest?q=CB-2026-2')).json();
  expect(suggest.items).toEqual([]);
}
