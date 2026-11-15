import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// F3 — Call Detail on the real stack (backend 8001 + call360_test with S0-SEED-1). E2E-03 (CB-2026-10482: 3 attempts,
// 1 session, pinned script and rationale; refresh and back keep context), the Dashboard → Work Queue → Call Detail
// journey, CB-2026-10497 (compliant, controls satisfied), out-of-scope ids, FE-04 accessibility and layout.
// Called from overview.spec.ts to reuse its sign-in (per-IP login rate limit).

export async function f3Admin(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Journey: Dashboard → Work Queues → Overdue → first case → Call Detail → back to the same queue.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Command Centre' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Work Queues' }).click();
  await page.getByRole('button', { name: /^Overdue \(/ }).click();
  await expect(page).toHaveURL(/\/queues\?queue=OVERDUE/);
  const firstRef = page.locator('[data-testid="case-table"] tbody tr').first().getAttribute('data-case-ref');
  const ref = (await firstRef)!;
  await page.getByRole('link', { name: ref, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Call Detail' })).toBeVisible();
  await expect(page.getByText(ref, { exact: true })).toBeVisible();
  await expect(page.getByTestId('cd-sla')).toContainText('SLA breached');
  await page.getByRole('link', { name: /Back to queues/ }).click();
  await expect(page).toHaveURL(/\/queues\?queue=OVERDUE/);

  // E2E-03 golden case through the top-bar search.
  const box = page.getByRole('combobox', { name: /Search cases, policies, attempts and sessions/ });
  await box.fill('CB-2026-10482');
  await expect(page.getByRole('option', { name: /CB-2026-10482/ }).first()).toBeVisible();
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}/);
  await expect(page.getByText('CB-2026-10482', { exact: true })).toBeVisible();
  await expect(page.getByTestId('cd-attempts')).toHaveText('3 · 1 session');
  for (const [n, status] of [[1, 'No answer'], [2, 'Busy'], [3, 'Connected']] as const) {
    await expect(page.getByTestId(`attempt-${n}`)).toContainText(`Attempt ${n} · ${status}`);
  }
  await expect(page.getByTestId('cd-recording')).toContainText('Recording not available — no audio is captured before Stage S1');
  await expect(page.getByTestId('cd-transcript')).toContainText('Transcript not available');
  const term = page.locator('[data-question="Q-PREMIUM-TERM-YEARS"]');
  await expect(term).toContainText('Seeded rule outcome: MISMATCH — needs review');
  await expect(term).toContainText('premium_term_years = 10');
  await expect(term).toContainText('5 · answer state');
  await expect(page.getByTestId('findings')).toContainText('HIGH');
  await expect(page.getByText(/COMMON_SALES_CONDUCT|Common sales conduct/).first()).toBeVisible();
  await expect(page.getByText('Mandatory controls not all satisfied').first()).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/Example Policyholder|@example\.invalid|SYN-TEL-SG-\d{6}/);
  // Selecting an unanswered attempt is held in the URL and survives a refresh.
  await page.getByTestId('attempt-1').click();
  await expect(page).toHaveURL(/attempt=/);
  await page.reload();
  await expect(page.getByTestId('attempt-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('cd-recording')).toContainText('no conversation session for this attempt');
  await page.getByRole('tab', { name: 'Case, policy & risk' }).click();
  await expect(page.getByTestId('risk-RULE_ASSESSED')).toContainText('Effective');
  await expect(page.getByTestId('risk-SOURCE_ASSIGNED')).toBeVisible();
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByTestId('timeline')).toContainText('Attempt 1: NO_ANSWER');
  await page.getByRole('tab', { name: 'Conversation & evidence' }).click();
  await page.getByTestId('attempt-3').click();
  await a11yAndLayout(page, 'call-detail-10482');

  // CB-2026-10497: compliant verification with every applicable mandatory control satisfied.
  await page.goto('/calls?q=CB-2026-10497');
  await page.getByRole('link', { name: 'CB-2026-10497', exact: true }).click();
  await expect(page.getByTestId('cd-outcome')).toContainText('Verified compliant');
  await expect(page.getByText('Mandatory controls satisfied').first()).toBeVisible();
  await expect(page.getByText('No findings on this case')).toBeVisible();
  await page.getByRole('link', { name: /Back to explorer/ }).click();
  await expect(page).toHaveURL(/\/calls\?q=CB-2026-10497/);

  // An id outside scope (or missing) shows the same not-found state.
  await page.goto('/cases/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('Case not found or not available to you')).toBeVisible();
}

export async function f3User(page: Page): Promise<void> {
  await page.goto('/calls?q=CB-2026-10494');
  await page.getByRole('link', { name: 'CB-2026-10494', exact: true }).click();
  await expect(page.getByTestId('cd-outcome')).toContainText('Cancelled');
  await expect(page.getByTestId('cd-sla')).toContainText('SLA exempt (SLA-EX-001)');
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
