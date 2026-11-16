import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { f2Admin, f2User } from './f2-checks';
import { f3Admin, f3User } from './f3-checks';
import { f4Admin, f4User } from './f4-checks';
import { f5Admin, f5User } from './f5-checks';
import { cp04aAdmin, cp04aUser } from './cp04a-checks';
import { accounts, signIn } from './helpers';

// F1 — Overview on the real stack (backend 8001 + call360_test seeded with S0-SEED-1). E2E-02 (card values equal the
// API), D-39 (Singapore only), FE-04 (accessibility and layout).
async function apiKpis(page: Page): Promise<Record<string, { value: number | null; status: string }>> {
  const days = 30;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  const d = (offset: number) => { const x = new Date(`${today}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + offset); return x.toISOString().slice(0, 10); };
  const r = await page.request.get(`/api/v1/dashboard/kpis?from=${d(-(days - 1))}&to=${d(1)}`);
  expect(r.ok()).toBeTruthy();
  const body = await r.json();
  expect(body.markets).toEqual(['SG']);
  return Object.fromEntries(body.items.map((k: { definition_id: string }) => [k.definition_id, k]));
}

async function checkDashboard(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Command Centre' })).toBeVisible();
  const k = await apiKpis(page);
  await expect(page.getByTestId('kpi-OPS-01')).toHaveText(String(k['OPS-01']!.value));
  await expect(page.getByTestId('kpi-OPS-04')).toHaveText(String(k['OPS-04']!.value));
  await expect(page.getByTestId('kpi-OPS-05')).toHaveText(String(k['OPS-05']!.value));
  expect(k['KPI-08']!.status).toBe('NOT_MEASURED');
  await expect(page.getByRole('region', { name: 'KPI register' }).getByText('N/A').first()).toBeVisible();
  await expect(page.getByText('Synthetic data:')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Priority attention' }).getByRole('row').nth(1)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent activity' }).locator('.activity-item').first()).toBeVisible();
  // D-39: no Malaysian case reference (CB-2026-2xxxx) anywhere on the page.
  expect(await page.locator('body').innerText()).not.toMatch(/CB-2026-2\d{4}/);
}

// One sign-in per role keeps the suite under the per-IP login rate limit (20/min), which stays unchanged.
test('F1 Overview + F2 register, queues, search + F3 Call Detail + F4 Policy Explorer and Detail + F5 Risk Workbench + CP0.4a intake (ADMIN): real Singapore data; a11y and layout', async ({ page }) => {
  await signIn(page, accounts().admin);
  await checkDashboard(page);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${width}: ${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)).toEqual([]);
    await page.screenshot({ path: `test-results/screens/overview-${width}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
  await f2Admin(page);
  await f3Admin(page);
  await f4Admin(page);
  await f5Admin(page);
  await cp04aAdmin(page);
});

test('F1 Overview + F2 register and queues + F3 Call Detail + F4 Policy Detail + F5 Risk Workbench + CP0.4a intake (USER): the same real Singapore data', async ({ page }) => {
  await signIn(page, accounts().user);
  await checkDashboard(page);
  await f2User(page);
  await f3User(page);
  await f4User(page);
  await f5User(page);
  await cp04aUser(page);
});
