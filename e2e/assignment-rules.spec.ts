import { expect, test } from '@playwright/test';
import { a11yAndLayout } from './cp04a-checks';
import { accounts, signIn } from './helpers';

// S2-B — editable Assignment Rules on the real stack (backend 8001 + call360_test): Create Rule → Configure Conditions
// → Select Published Script → Simulate Against Cases → Submit → Checker Approval → Publish, plus a blocked conflicting
// copy, a no-match simulation and the version history. Simulation and publication never change case assignments.
test.describe.configure({ timeout: 180_000 });

test('S2-B Assignment Rules: create, configure, simulate, submit, approve by a checker, publish', async ({ page, browser }) => {
  const { user, checker } = accounts();
  const code = `S2B-E2E-${Date.now().toString(36).toUpperCase()}`;
  await signIn(page, user, '/assignment-rules');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId('rule-SG-SALES-VERIFY')).toContainText('#10');
  const before = await (await page.request.get('/api/v1/assignment-rules')).json();
  const seededCases = before.items.find((i: { rule_code: string }) => i.rule_code === 'SG-SALES-VERIFY').live.cases_assigned;

  // 1. Create the rule.
  await page.getByTestId('new-rule').click();
  await page.getByLabel('Rule code').fill(code);
  await page.getByLabel('Rule name').fill('ILP sales with high SBQ risk (E2E)');
  await page.getByTestId('new-rule-create').click();
  await expect(page.getByTestId('rule-builder')).toBeVisible();
  await expect(page.getByTestId('rb-cond-market')).toContainText('Required — your market');

  // 2. Configure conditions with dropdowns and value chips; the explanation updates from the server.
  await page.getByTestId('rb-add-condition').selectOption('is_ilp');
  await page.getByTestId('rb-cond-is_ilp').getByLabel('ILP', { exact: true }).check();
  await page.getByTestId('rb-add-condition').selectOption('risk_band');
  await page.getByTestId('rb-cond-risk_band').getByLabel(/^High/).check();
  await page.getByTestId('rb-priority').fill('5');
  // 3. Select a published script version (withdrawn / superseded ones are not selectable).
  const target = page.getByTestId('rb-target');
  await expect(target.locator('option', { hasText: 'v0.9' })).toBeDisabled();
  await target.selectOption({ label: 'SALES_VERIFICATION_SG v1.1' });
  await expect(page.getByTestId('rule-explanation')).toContainText(/Assign SALES_VERIFICATION_SG v1\.1 when the market is Singapore.* and the product is an ILP and the SBQ sale-selection risk band is High/);
  await expect(page.getByTestId('rb-specificity')).toHaveText('3');
  await page.getByTestId('rb-save').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(page.getByTestId('conflict-OVERLAP')).toContainText('wins');
  await a11yAndLayout(page, 's2b-rule-builder');
  await page.setViewportSize({ width: 1440, height: 900 });

  // 4. Simulate against the synthetic Singapore cases (read-only).
  await page.getByTestId('rule-tab-simulate').click();
  await page.getByTestId('sim-run').click();
  await expect(page.getByTestId('sim-note')).toContainText('No side effects');
  const changed = Number((await page.getByTestId('sim-changed').locator('strong').innerText()).trim());
  expect(changed).toBeGreaterThan(0);
  await expect(page.getByTestId(`sim-rule-${code}`)).toContainText('Proposed');
  const firstWhy = page.locator('[data-testid^="sim-why-"]').first();
  await firstWhy.click();
  await expect(page.getByTestId('sim-trace').first()).toContainText('(passed)');
  await expect(page.getByTestId('sim-trace').first()).toContainText('Selected');
  await a11yAndLayout(page, 's2b-simulation');
  await page.setViewportSize({ width: 1440, height: 900 });
  // No match: before any rule was effective nothing can be selected.
  await page.getByLabel('Evaluate as of (SGT, optional)').fill('2025-01-01T09:00');
  await page.getByTestId('sim-run').click();
  await expect(page.getByTestId('sim-no-match').locator('strong')).not.toHaveText('0');

  // 5. Submit for review (locks the rule).
  await page.getByTestId('rule-tab-rule').click();
  await page.getByLabel('Change summary for the checker').fill('Route ILP high-risk sales to the verification script (E2E)');
  await page.getByTestId('rule-submit').click();
  await expect(page.getByTestId('rule-draft-header')).toContainText('Locked for review');
  await page.getByTestId('rule-tab-review').click();
  await expect(page.getByTestId('rule-review-panel')).toContainText('Awaiting an S&C checker');
  const ruleUrl = page.url();

  // 6. A different S&C checker approves and publishes.
  const ctx = await browser.newContext({ baseURL: new URL(ruleUrl).origin });
  const cp = await ctx.newPage();
  await signIn(cp, checker, new URL(ruleUrl).pathname + new URL(ruleUrl).search);
  await cp.setViewportSize({ width: 1440, height: 900 });
  await cp.getByTestId('rule-tab-review').click();
  await cp.getByLabel('Reviewer reason').fill('Conditions, precedence and simulation reviewed');
  await cp.getByTestId('rule-approve').click();
  await expect(cp.getByTestId('rule-publish')).toBeEnabled();
  await a11yAndLayout(cp, 's2b-review-publish');
  await cp.setViewportSize({ width: 1440, height: 900 });
  await cp.getByTestId('rule-publish').click();
  await expect(cp.getByTestId('rule-published-note')).toBeVisible();
  await cp.getByTestId('rule-tab-history').click();
  await expect(cp.getByTestId('rule-history')).toContainText('Published');
  await expect(cp.getByTestId('rule-history')).toContainText('Approved');
  await ctx.close();

  // 7. Live and immutable; no case was reassigned.
  await page.goto('/assignment-rules');
  const row = page.getByTestId(`rule-${code}`);
  await expect(row).toContainText('#5');
  await expect(row).toContainText('Published');
  await row.getByRole('link', { name: 'Details' }).click();
  await expect(page.getByTestId('rule-version-header')).toContainText('Immutable published version');
  const after = await (await page.request.get('/api/v1/assignment-rules')).json();
  const mine = after.items.find((i: { rule_code: string }) => i.rule_code === code);
  expect(mine.live.cases_assigned).toBe(0);
  expect(after.items.find((i: { rule_code: string }) => i.rule_code === 'SG-SALES-VERIFY').live.cases_assigned).toBe(seededCases);
  expect(mine.live.author_ref).not.toBe(mine.live.checker_ref);

  // 8. Conflicting rule: a copy of the seeded rule ties with it (same priority, specificity and script) and is blocked.
  await page.goto('/assignment-rules?rule=SG-SALES-VERIFY%20v2');
  await page.getByTestId('rule-copy').click();
  await page.getByLabel('Rule code').fill(`${code}-COPY`);
  await page.getByLabel('Rule name').fill('Copy of the seeded rule (E2E)');
  await page.getByTestId('new-rule-create').click();
  await expect(page.getByTestId('issue-CONFLICT_SAME_TARGET_TIE')).toBeVisible();
  await expect(page.getByTestId('rule-submit')).toBeDisabled();
  await page.getByTestId('rule-tab-history').click();
  await expect(page.getByTestId('rule-history')).toContainText('Draft created');
});
