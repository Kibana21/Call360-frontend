import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// F4 — Policy Explorer and Policy Detail on the real stack (backend 8001 + call360_test with S0-SEED-1). E2E-06
// (search → Policy Detail with parties, sale, risk with provenance and script assignment → Call Detail), the journey
// Policy Explorer → Policy Detail → Call Detail → back to the policy, Call Detail → Policy Detail, multi-sale and
// top-up snapshots, masking, Singapore-only scope, FE-04 accessibility and responsive layout.
// Called from overview.spec.ts to reuse its sign-in (per-IP login rate limit).
const UNMASKED = /Example Policyholder|[A-Za-z0-9._%+-]{2,}@example\.invalid|SYN-TEL-(SG|MY)-\d{6}/;

export async function f4Admin(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const api = await (await page.request.get('/api/v1/policies?limit=1')).json();
  expect(api.markets).toEqual(['SG']);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Policy Explorer' }).click();
  await expect(page.getByRole('heading', { name: 'Policy Explorer' })).toBeVisible();
  await expect(page.getByTestId('policy-total')).toContainText(`of ${api.total} matching policies`);
  expect(await page.locator('body').innerText()).not.toMatch(/POL-MY-|SALE-MY-|CB-2026-2\d{4}/);
  await a11yAndLayout(page, 'policy-explorer');
  await page.setViewportSize({ width: 1440, height: 900 });

  // Multi-sale filter held in the URL and equal to the API.
  const multi = await (await page.request.get('/api/v1/policies?multi_sale=true&limit=1')).json();
  await page.getByRole('checkbox', { name: 'Multiple sale events' }).click();
  await expect(page).toHaveURL(/multi_sale=true/);
  await expect(page.getByTestId('policy-total')).toContainText(`of ${multi.total} matching policies`);

  // Journey: Policy Explorer → Policy Detail (top-up policy) → Call Detail → back to the same policy and sale.
  await page.getByPlaceholder(/Policy, sale, party/).fill('POL-SG-000017');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/q=POL-SG-000017/);
  await page.getByRole('link', { name: 'POL-SG-000017', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Policy Detail' })).toBeVisible();
  await expect(page.getByTestId('pd-sales')).toHaveText('2 · 1 top-up');
  await expect(page.getByTestId('sale-SALE-SG-000118')).toHaveAttribute('aria-pressed', 'true'); // latest sale (top-up)
  await expect(page.getByTestId('fact-snapshot')).toContainText('TOP_UP');
  await page.getByTestId('sale-SALE-SG-000018').click();
  await expect(page).toHaveURL(/sale=/);
  await expect(page.getByTestId('fact-snapshot')).toContainText('NEW_BUSINESS'); // the original sale keeps its own snapshot
  await expect(page.getByTestId('sale-context')).toContainText('FSC-');
  const policyUrl = page.url();
  await page.getByRole('link', { name: 'CB-2026-10005', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Call Detail' })).toBeVisible();
  await expect(page.getByTestId('cd-outcome')).toContainText('Verified compliant');
  await page.getByRole('link', { name: /Back to policy/ }).click();
  await expect(page).toHaveURL(policyUrl);
  await expect(page.getByTestId('sale-SALE-SG-000018')).toHaveAttribute('aria-pressed', 'true');

  // Workspaces: parties (masked), risk with provenance, script assignment, callback history, source lineage.
  await page.getByRole('tab', { name: 'Party & contact' }).click();
  await expect(page.getByTestId('parties')).toContainText('SYN-TEL-SG-••••17');
  expect(await page.locator('body').innerText()).not.toMatch(UNMASKED);
  await a11yAndLayout(page, 'policy-detail-parties');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('tab', { name: 'SBQ risk' }).click();
  await expect(page.getByTestId('risk-history')).toBeVisible();
  await page.getByRole('tab', { name: 'Script assignment' }).click();
  await expect(page.getByTestId('policy-scripts')).toContainText('SALES_VERIFICATION_SG');
  await page.getByRole('tab', { name: 'Callback history' }).click();
  await expect(page.getByTestId('policy-cases').locator('tbody tr')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Source & changes' }).click();
  await expect(page.getByTestId('field-changes')).toContainText('not available');
  await expect(page.getByTestId('lineage')).toContainText('SALE-SG-000118');
  await expect(page.getByRole('button', { name: 'Correct field' })).toBeDisabled();
  await page.getByRole('tab', { name: 'Sale context' }).click();
  await a11yAndLayout(page, 'policy-detail-sale');
  await page.setViewportSize({ width: 1440, height: 900 });

  // E2E-06 via the top-bar search: policy hit → Policy Detail → Call Detail → Policy Detail again (case → policy).
  const box = page.getByRole('combobox', { name: /Search cases, policies, attempts and sessions/ });
  await box.fill('POL-SG-000001');
  await expect(page.getByRole('option', { name: /POL-SG-000001/ }).first()).toBeVisible();
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/policies\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('pd-risk')).toContainText('High');
  await page.getByRole('tab', { name: 'Callback history' }).click();
  await page.getByRole('link', { name: 'CB-2026-10482', exact: true }).click();
  await expect(page.getByTestId('cd-attempts')).toHaveText('3 · 1 session');
  await page.getByRole('link', { name: 'POL-SG-000001 Policy Detail' }).click();
  await expect(page.getByRole('heading', { name: 'Policy Detail' })).toBeVisible();
  await expect(page).toHaveURL(/\/policies\/[0-9a-f-]{36}\?sale=/);
  await page.getByRole('link', { name: /Back to Call Detail/ }).click();
  await expect(page.getByRole('heading', { name: 'Call Detail' })).toBeVisible();

  // Singapore only: no Malaysian policy is listed or searchable, and an unknown id is the same not-found.
  expect((await (await page.request.get('/api/v1/policies?q=POL-MY')).json()).total).toBe(0);
  await page.goto('/policies/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('Policy not found or not available to you')).toBeVisible();
}

export async function f4User(page: Page): Promise<void> {
  await page.goto('/policies?q=POL-SG-000017');
  await page.getByRole('link', { name: 'POL-SG-000017', exact: true }).click();
  await page.getByRole('tab', { name: 'Party & contact' }).click();
  await expect(page.getByTestId('parties')).toContainText('SYN-TEL-SG-••••');
  expect(await page.locator('body').innerText()).not.toMatch(UNMASKED);
  await expect(page.getByRole('button', { name: 'Correct field' })).toHaveCount(0); // ADMIN-only action
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
