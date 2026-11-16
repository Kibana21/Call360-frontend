import { expect, type Page } from '@playwright/test';
import { a11yAndLayout } from './cp04a-checks';

// F7 — Review Workbench and Voice Studio on the real stack (backend 8001 + call360_test with S0-SEED-1): queue totals
// equal API-077, filters and paging in the URL, the selected finding's recorded evidence and context, navigation to
// Call Detail (which lists the same finding), no review outcome, Singapore only, Voice Studio capability state,
// accessibility and layout. Called from overview.spec.ts for both roles (both hold queue.read).
const MALAYSIA = /POL-MY-|SALE-MY-|CB-2026-2\d{4}/;

export async function f7Journey(page: Page, shots: boolean): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const awaiting = await (await page.request.get('/api/v1/review-queue?limit=100')).json();
  const all = await (await page.request.get('/api/v1/review-queue?queue=ALL&limit=100')).json();
  expect(awaiting.markets).toEqual(['SG']);
  expect(awaiting.items.every((i: { review_closed_at: string | null }) => i.review_closed_at === null)).toBe(true);

  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Review Workbench' }).click();
  await expect(page.getByRole('heading', { name: 'Review Workbench', level: 1 })).toBeVisible();
  await expect(page.getByText(`${awaiting.total} matching`)).toBeVisible();
  if (awaiting.total > 10) {
    await expect(page.getByTestId('review-page')).toHaveText(`1–10 of ${awaiting.total}`);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/offset=10/);
    await expect(page.getByTestId('review-list').getByRole('button')).toHaveCount(Math.min(10, awaiting.total - 10));
  }
  await page.getByRole('tab', { name: 'All findings' }).click();
  await expect(page).toHaveURL(/queue=ALL/);
  await expect(page.getByText(`${all.total} matching`)).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(MALAYSIA);

  // A critical finding with a rule evaluation: evidence, controls, severity apart from selection risk, no decision.
  await page.getByLabel('Severity').selectOption('CRITICAL');
  await expect(page).toHaveURL(/severity=CRITICAL/);
  const crit = all.items.filter((i: { severity: string }) => i.severity === 'CRITICAL');
  await expect(page.getByTestId('review-list').getByRole('button')).toHaveCount(crit.length);
  const f = crit[0];
  await page.getByTestId('review-list').getByRole('button', { name: new RegExp(f.finding_ref) }).click();
  const detail = page.getByTestId('finding-detail');
  await expect(detail).toContainText(f.finding_ref);
  await expect(detail).toContainText('Critical severity');
  await expect(detail).toContainText('Why the case was selected — not a finding');
  if (f.evidence.question_code) await expect(detail).toContainText(f.evidence.question_code);
  await expect(detail).toContainText('No review decision recorded');
  await expect(detail).toContainText('Not available — recordings are captured from Stage S1');
  for (const name of ['Confirm', 'Reject', 'Send to checker']) await expect(detail.getByRole('button', { name })).toBeDisabled();
  if (shots) { await a11yAndLayout(page, 'review-workbench'); await page.setViewportSize({ width: 1440, height: 900 }); }

  // Navigation to Call Detail, which shows the same finding.
  await detail.getByTestId('open-call-detail').click();
  await expect(page.getByRole('heading', { name: 'Call Detail' })).toBeVisible();
  await expect(page.getByText(f.case_ref).first()).toBeVisible();
  await expect(page.getByTestId('findings')).toContainText(f.finding_ref);
  await page.goBack();
  await expect(page.getByTestId('finding-detail')).toContainText(f.finding_ref); // the URL kept the selection

  // Voice Studio (S1-A): honest capability state; nothing starts or plays until the user presses Start.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Voice Studio' }).click();
  await expect(page.getByRole('heading', { name: 'Voice Studio', level: 1 })).toBeVisible();
  await expect(page.getByTestId('voice-capabilities')).toContainText('Mock provider');
  await expect(page.getByTestId('voice-capabilities')).toContainText('Not performed');
  expect(await page.evaluate(() => document.querySelectorAll('audio, video').length)).toBe(0);
  if (shots) { await a11yAndLayout(page, 'voice-studio'); await page.setViewportSize({ width: 1440, height: 900 }); }
}
