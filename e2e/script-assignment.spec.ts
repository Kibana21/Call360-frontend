import { expect, test } from '@playwright/test';
import { a11yAndLayout, INTAKE, writeHeaders } from './cp04a-checks';
import { accounts, signIn } from './helpers';

// S2-C — deterministic script assignment on the real stack (backend 8001 + call360_test): a new synthetic Singapore
// sale (manual intake, ADMIN) creates a callback case held "Awaiting script assignment"; an operations user previews
// the deterministic decision in Call Detail, applies it, and sees the pinned script and the released hold. Assignment
// never verifies the case; a second apply never reassigns.
test.describe.configure({ timeout: 180_000 });

test('S2-C assignment: new sale → callback case → preview → apply → pinned script → hold released', async ({ page, browser }) => {
  const { admin, user } = accounts();
  const n = 800000 + Math.floor(Math.random() * 90000);
  const body = JSON.parse(JSON.stringify(INTAKE).replaceAll(/9\d{5}/g, String(n))) as typeof INTAKE;
  body.source_event_id = `SYN-EVT-S2C-${n}-${Date.now()}`;
  await signIn(page, admin, '/intake');
  const created = await page.request.post('/api/v1/intake/manual', {
    data: body, headers: { ...(await writeHeaders(page)), 'Idempotency-Key': `e2e-s2c-${n}-${Date.now()}` } });
  expect(created.status()).toBe(201);
  const out = await created.json();
  expect(out.holds.map((h: { reason: string }) => h.reason)).toContain('AWAITING_SCRIPT_ASSIGNMENT');
  const caseId: string = out.case.case_id;

  const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const up = await ctx.newPage();
  await signIn(up, user, `/cases/${caseId}`);
  await up.setViewportSize({ width: 1440, height: 900 });
  const panel = up.getByTestId('script-assignment');
  await expect(panel).toContainText('Ready to assign');
  await expect(up.getByTestId('preview-script')).toContainText('SALES_VERIFICATION_SG');
  await expect(up.getByTestId('preview-explanation')).toContainText('when the market is');
  await expect(up.getByTestId('assignment-holds')).toContainText('Awaiting script assignment');
  await expect(up.getByTestId('preview-remaining')).toHaveText('None');
  await a11yAndLayout(up, 's2c-preview');
  await up.setViewportSize({ width: 1440, height: 900 });
  await up.getByTestId('apply-open').click();
  await up.getByTestId('apply-assignment').click();
  await expect(panel).toContainText('Script pinned');
  await expect(up.getByTestId('assignment-current')).toContainText('SALES_VERIFICATION_SG');
  await expect(up.getByTestId('assignment-no-holds')).toBeVisible();
  await expect(up.getByTestId('assignment-attempts')).toContainText('released Awaiting script assignment');
  await expect(up.getByTestId('cd-script-link')).toContainText('SALES_VERIFICATION_SG');
  await expect(up.getByTestId('cd-matched-rule')).toBeVisible();

  const status = await (await up.request.get(`/api/v1/cases/${caseId}/script-assignment/preview`)).json();
  expect(status.status).toBe('ASSIGNED');
  expect(status.state).toBe('VALIDATED'); // no verification or compliance outcome
  const again = await up.request.post(`/api/v1/cases/${caseId}/script-assignment/apply`, {
    data: {}, headers: { ...(await writeHeaders(up)), 'Idempotency-Key': `e2e-s2c-again-${Date.now()}` } });
  expect((await again.json()).status).toBe('ALREADY_ASSIGNED');
  const pins = await (await up.request.get(`/api/v1/cases/${caseId}/script-assignment`)).json();
  expect(pins.items).toHaveLength(1);
  expect(pins.items[0].origin).toBe('ENGINE');
  await ctx.close();
});
