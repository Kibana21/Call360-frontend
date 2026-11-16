import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// F5 — SBQ Risk Workbench on the real stack (backend 8001 + call360_test with S0-SEED-1). Overview equals the API
// summary (sale grain kept apart from assessment grain), a source-vs-rule conflict end to end (drawer comparison,
// factors, history, Call Detail and back), superseded history, Call Detail → Workbench, Singapore-only scope,
// FE-04 accessibility and responsive layout. Called from overview.spec.ts to reuse its sign-in.
export async function f5Admin(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const api = await (await page.request.get('/api/v1/risk-assessments?limit=1')).json();
  expect(api.markets).toEqual(['SG']);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'SBQ Risk Workbench' }).click();
  await expect(page.getByRole('heading', { name: 'SBQ Risk Workbench' })).toBeVisible();
  await expect(page.getByTestId('risk-total')).toContainText(`of ${api.total} matching assessments`);
  await expect(page.getByRole('region', { name: 'High-risk sales' })).toContainText(String(api.summary.sales.by_effective_band.HIGH));
  await expect(page.getByRole('region', { name: 'Source ≠ rule' })).toContainText(String(api.summary.sales.source_rule_discrepancies));
  await expect(page.getByTestId('risk-population')).toContainText(`By origin · ${api.summary.assessments.total} assessments`);
  expect(await page.locator('body').innerText()).not.toMatch(/POL-MY-|SALE-MY-|CB-2026-2\d{4}/);
  await a11yAndLayout(page, 'risk-workbench');
  await page.setViewportSize({ width: 1440, height: 900 });

  // A sale where the source system said LOW and the synthetic rule set said HIGH.
  const conflicts = await (await page.request.get('/api/v1/risk-assessments?discrepancy=true&limit=100')).json();
  await page.getByRole('button', { name: /Show assessments\s*:\s*Source ≠ rule/ }).click();
  await expect(page).toHaveURL(/discrepancy=true/);
  await expect(page.getByTestId('risk-total')).toContainText(`of ${conflicts.total} matching assessments`);
  const rule = conflicts.items.find((r: { origin: string; band_code: string }) => r.origin === 'RULE_ASSESSED' && r.band_code === 'HIGH');
  expect(rule, 'seeded LOW→HIGH conflict').toBeTruthy();
  await page.getByTestId(`open-${rule.id}`).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText(`${rule.sale_ref} · Rule-assessed`);
  await expect(drawer.getByTestId('risk-comparison')).toContainText('Source-assigned (latest final)Low');
  await expect(drawer.getByTestId('risk-comparison')).toContainText('Rule-assessed (latest final)High');
  await expect(drawer.getByTestId('risk-factors').locator('tbody tr')).not.toHaveCount(0);
  await expect(drawer.getByTestId('risk-history').locator('li')).toHaveCount(2);
  await expect(page).toHaveURL(new RegExp(`assessment=${rule.id}`));
  await a11yAndLayout(page, 'risk-drawer-conflict');
  await page.setViewportSize({ width: 1440, height: 900 });
  // Source-assigned version from the history: no factor results, its original value instead.
  await drawer.getByTestId('risk-history').getByRole('button', { name: /Source-assigned · Low/ }).click();
  await expect(drawer).toContainText('No factor results are stored for this assessment');
  // Drawer → Call Detail → back to the Workbench with the drawer open again.
  const caseRef = rule.cases[0].case_ref;
  await drawer.getByRole('link', { name: `Call Detail ${caseRef}` }).click();
  await expect(page.getByRole('heading', { name: 'Call Detail' })).toBeVisible();
  await page.getByRole('link', { name: /Back to Risk Workbench/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/assessment=/);

  // Superseded history: the source's UNKNOWN band replaced by a later FINAL record.
  await page.goto('/risk-assessments?status=SUPERSEDED');
  await page.getByTestId('risk-table').getByRole('button', { name: /^Details/ }).first().click();
  await expect(page.getByRole('dialog').getByTestId('risk-history')).toContainText(/supersedes Unknown/);
  await page.keyboard.press('Escape');

  // Call Detail (golden CB-2026-10482) → its effective assessment in the Workbench.
  await page.goto('/calls?q=CB-2026-10482');
  await page.getByRole('link', { name: 'CB-2026-10482', exact: true }).click();
  await page.getByRole('tab', { name: 'Case, policy & risk' }).click();
  await page.getByRole('main').getByRole('link', { name: 'Risk Workbench', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('SALE-SG-000001 · Rule-assessed');
  await expect(page.getByRole('dialog').getByTestId('risk-factors')).toContainText('Investment-linked indicator');

  // Singapore only.
  expect((await (await page.request.get('/api/v1/risk-assessments?q=SALE-MY')).json()).total).toBe(0);
  await page.goto('/risk-assessments?assessment=00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('Assessment not found or not available to you')).toBeVisible();
}

export async function f5User(page: Page): Promise<void> {
  await page.goto('/risk-assessments?discrepancy=true&origin=RULE_ASSESSED');
  await page.getByTestId('risk-table').getByRole('button', { name: /^Details/ }).first().click();
  await expect(page.getByRole('dialog').getByTestId('risk-comparison')).toContainText('Source-assigned (latest final)');
  expect(await page.locator('body').innerText()).not.toMatch(/SALE-MY-|POL-MY-|risk tolerance:/i);
}

async function a11yAndLayout(page: Page, name: string): Promise<void> {
  for (const width of [820, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width > 820) {
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${name}@${width}: ${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)).toEqual([]);
    }
    await page.screenshot({ path: `test-results/screens/${name}-${width}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${name} at ${width}px`).toBeLessThanOrEqual(0);
  }
}
