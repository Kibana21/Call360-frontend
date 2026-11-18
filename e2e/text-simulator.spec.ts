import { expect, test, type Page } from '@playwright/test';
import { a11yAndLayout, INTAKE, writeHeaders } from './cp04a-checks';
import { accounts, signIn } from './helpers';

// S2-D — deterministic question controller through the Text Simulator on the real stack: new synthetic sale (intake)
// → callback case → script assignment (S2-C apply) → start a text simulation → answer every permitted question (each
// presented before it is answered) → sequence finished → end COMPLETED → inspect the trace. No operational change.
test.describe.configure({ timeout: 180_000 });

async function answerCurrent(page: Page): Promise<boolean> {
  const action = page.getByTestId('sim-action');
  if (!(await action.isVisible())) return false;
  const present = page.getByTestId('sim-present');
  if (await present.isVisible()) await present.click();
  await expect(page.getByTestId('sim-answer')).toBeVisible();
  const code = await action.locator('.mono.strong').first().innerText();
  if (await page.getByTestId('sim-yes').isVisible()) await page.getByTestId('sim-yes').click();
  else if (await page.getByTestId('sim-num').isVisible()) { await page.getByTestId('sim-num').fill('20'); await page.getByTestId('sim-submit').click(); }
  else if (await page.getByTestId('sim-choice').isVisible()) { await page.getByTestId('sim-choice').selectOption({ index: 1 }); await page.getByTestId('sim-submit').click(); }
  else { await page.getByTestId('sim-text').fill('Synthetic answer (E2E)'); await page.getByTestId('sim-submit').click(); }
  await expect(action.or(page.getByTestId('sim-finished'))).not.toContainText(`${code}#1`, { timeout: 10_000 }).catch(() => undefined);
  return true;
}

test('S2-D: new sale → case → assignment → text simulation → complete sequence → trace', async ({ page, browser }) => {
  const { admin, user } = accounts();
  const n = 700000 + Math.floor(Math.random() * 90000);
  const body = JSON.parse(JSON.stringify(INTAKE).replaceAll(/9\d{5}/g, String(n))) as typeof INTAKE;
  body.source_event_id = `SYN-EVT-S2D-${n}-${Date.now()}`;
  await signIn(page, admin, '/intake');
  const created = await page.request.post('/api/v1/intake/manual', {
    data: body, headers: { ...(await writeHeaders(page)), 'Idempotency-Key': `e2e-s2d-${n}-${Date.now()}` } });
  expect(created.status()).toBe(201);
  const caseId: string = (await created.json()).case.case_id;

  const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const up = await ctx.newPage();
  await signIn(up, user, `/cases/${caseId}`);
  await up.setViewportSize({ width: 1440, height: 900 });
  await up.getByTestId('apply-open').click();
  await up.getByTestId('apply-assignment').click();
  await expect(up.getByTestId('script-assignment')).toContainText('Script pinned');
  await up.getByTestId('start-text-simulation').click();
  await expect(up.locator('h2', { hasText: 'SALES_VERIFICATION_SG' })).toBeVisible();
  await expect(up.getByTestId('sim-modules')).toContainText('Not included'); // the ILP module does not apply
  const before = await (await up.request.get(`/api/v1/cases/${caseId}`)).json();
  await up.getByTestId('sim-start').click();
  await expect(up.getByTestId('sim-run-header')).toContainText('In progress');
  await expect(up.getByTestId('sim-yes')).toHaveCount(0); // requested is not presented
  await a11yAndLayout(up, 's2d-simulator');
  await up.setViewportSize({ width: 1440, height: 900 });
  for (let i = 0; i < 20 && (await answerCurrent(up)); i++) { /* answer every permitted question */ }
  await expect(up.getByTestId('sim-finished')).toBeVisible();
  await up.getByTestId('sim-end').click();
  await expect(up.getByTestId('sim-run-header')).toContainText('Completed');
  await expect(up.getByTestId('sim-outcome')).toContainText('not a customer verification');
  await expect(up.getByTestId('sim-trace-table')).toContainText('Sequence finished');
  await expect(up.getByTestId('sim-questions')).toContainText('Skipped by condition');
  const after = await (await up.request.get(`/api/v1/cases/${caseId}`)).json();
  expect([after.state, after.attempts, after.sessions]).toEqual([before.state, before.attempts, before.sessions]); // no operational change
  await ctx.close();
});
