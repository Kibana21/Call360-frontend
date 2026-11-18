import { expect, test, type Page } from '@playwright/test';
import { a11yAndLayout, INTAKE, writeHeaders } from './cp04a-checks';
import { accounts, signIn } from './helpers';
import { api, buildLifecycleScript, type Api } from './lifecycle-helpers';

// S2-D.1 — conversation lifecycle and control gates on the real stack. Governed setup through the normal APIs: the
// author builds a new synthetic lifecycle script (opening → identity → disclosure → consent → verification → closing),
// a different checker approves and publishes it, and a narrowly scoped rule (SG · protection · bancassurance · annual)
// targets it. A new synthetic sale is then assigned by the S2-C engine and simulated three times in the Text Simulator:
// normal closing, identity failure, and the customer declining to proceed. Nothing operational changes.
test.describe.configure({ timeout: 240_000 });

async function publishRule(author: Api, checker: Api, code: string, target: string): Promise<void> {
  const out = await author.post('/assignment-rules', { code, name: 'Lifecycle E2E rule (synthetic)' }, 201);
  const id = String(out.draft_id);
  const get = async () => (await (await author.page.request.get(`/api/v1/assignment-rule-drafts/${id}`)).json());
  const d = await get();
  const put = await author.page.request.put(`/api/v1/assignment-rule-drafts/${id}`, {
    headers: await writeHeaders(author.page),
    data: { expected_row_version: d.row_version, content: { name: d.name, description: 'S2-D.1 E2E (synthetic)', priority: 3, is_fallback: false,
      target_script_version_id: target, effective_from: null, effective_to: null,
      conditions: [{ field: 'market', values: ['SG'] }, { field: 'product_family', values: ['PROTECTION'] },
        { field: 'selling_channel', values: ['BANCASSURANCE'] }, { field: 'premium_frequency', values: ['ANNUAL'] }] } } });
  expect(put.status(), await put.text()).toBe(200);
  await author.post(`/assignment-rule-drafts/${id}/submit`, { expected_row_version: (await get()).row_version, change_summary: 'Lifecycle E2E rule' });
  await checker.post(`/assignment-rule-drafts/${id}/review`, { decision: 'APPROVE', reason: 'Checked conditions (E2E)' });
  await checker.post(`/assignment-rule-drafts/${id}/publish`, { reason: 'Lifecycle E2E publication' });
}

/** Act only on the expected current item (the server decides the order; waiting also avoids re-render races). */
async function deliver(page: Page, code: string) {
  await expect(page.getByTestId('sim-action')).toContainText(`${code}#`);
  await page.getByTestId('sim-present').click();
}
async function answer(page: Page, code: string, yes: boolean) {
  await deliver(page, code);
  await expect(page.getByTestId('sim-answer')).toBeVisible();
  await page.getByTestId(yes ? 'sim-yes' : 'sim-no').click();
}

test('S2-D.1: lifecycle script → assignment → normal closing, identity failure and declined to proceed', async ({ page, browser }) => {
  const { admin, user, checker } = accounts();
  const n = 800000 + Math.floor(Math.random() * 90000);
  const code = `LCE_${n}`;
  await signIn(page, user, '/scripts');
  const author = await api(page);
  const cctx = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const cpage = await cctx.newPage();
  await signIn(cpage, checker, '/scripts');
  const chk = await api(cpage);
  const vid = await buildLifecycleScript(author, chk, code);
  await publishRule(author, chk, `S2D1-E2E-${n}`, vid);
  await cctx.close();

  const actx = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const apage = await actx.newPage();
  await signIn(apage, admin, '/intake');
  const body = JSON.parse(JSON.stringify(INTAKE).replaceAll(/9\d{5}/g, String(n))) as typeof INTAKE;
  body.source_event_id = `SYN-EVT-S2D1-${n}-${Date.now()}`;
  body.policy.premium_frequency = 'ANNUAL';
  body.sale.selling_channel = 'BANCASSURANCE';
  body.sale.fsc_ref = 'FSC-0002';
  const created = await apage.request.post('/api/v1/intake/manual', { data: body, headers: { ...(await writeHeaders(apage)), 'Idempotency-Key': `e2e-s2d1-${n}` } });
  expect(created.status(), await created.text()).toBe(201);
  const caseId: string = (await created.json()).case.case_id;
  await actx.close();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/cases/${caseId}`);
  await page.getByTestId('apply-open').click();
  await page.getByTestId('apply-assignment').click();
  await expect(page.getByTestId('script-assignment')).toContainText(code);
  const before = await (await page.request.get(`/api/v1/cases/${caseId}`)).json();
  await page.getByTestId('start-text-simulation').click();
  await expect(page.getByTestId('sim-identity-configured')).toContainText('Configured');
  await expect(page.getByTestId('sim-plan-questions')).toContainText('Policy info · after identity');

  // 1. Normal conversation: opening → identity → disclosure → consent → verification → closing.
  await page.getByTestId('sim-start').click();
  await expect(page.getByTestId('sim-stages')).toContainText('Opening (current)');
  await expect(page.getByTestId('sim-lifecycle')).toContainText('All identity and consent outcomes are simulated');
  await a11yAndLayout(page, 's2d1-lifecycle');
  await page.setViewportSize({ width: 1440, height: 900 });
  await deliver(page, 'Q-LCE-OPEN');
  await answer(page, 'Q-LCE-ID-NAME', true);
  await answer(page, 'Q-LCE-ID-DOB', true);
  await expect(page.getByTestId('sim-gates')).toContainText('Confirmed');
  await deliver(page, 'Q-LCE-DISC');
  await answer(page, 'Q-LCE-PROCEED', true); // proceed
  await answer(page, 'Q-LCE-REC', false); // declines recording: continues without recording
  await expect(page.getByTestId('sim-lifecycle')).toContainText('Continue without recording');
  await answer(page, 'Q-LCE-POLICY', true); // policy information (acknowledged), now that identity is confirmed
  await answer(page, 'Q-LCE-UNDERSTOOD', true);
  await deliver(page, 'Q-LCE-CLOSE');
  await page.getByTestId('sim-end').click();
  await expect(page.getByTestId('sim-run-header')).toContainText('Completed');
  await expect(page.getByTestId('sim-trace-table')).toContainText('Gate updated');

  // 2. Identity failure: terminates, policy information withheld, the termination closing statement is offered.
  await page.getByTestId('sim-restart').click();
  await deliver(page, 'Q-LCE-OPEN');
  await answer(page, 'Q-LCE-ID-NAME', false);
  await expect(page.getByTestId('sim-termination')).toContainText('Identity failed');
  await deliver(page, 'Q-LCE-CLOSE');
  await page.getByTestId('sim-end').click();
  await expect(page.getByTestId('sim-run-header')).toContainText('Terminated');
  await expect(page.getByTestId('sim-questions')).not.toContainText('Q-LCE-POLICYCompleted');
  await expect(page.getByTestId('sim-outcome')).toContainText('no case, hold or attempt changed');

  // 3. Customer declines to proceed.
  await page.getByTestId('sim-restart').click();
  await deliver(page, 'Q-LCE-OPEN');
  await answer(page, 'Q-LCE-ID-NAME', true);
  await answer(page, 'Q-LCE-ID-DOB', true);
  await deliver(page, 'Q-LCE-DISC');
  await answer(page, 'Q-LCE-PROCEED', false);
  await expect(page.getByTestId('sim-termination')).toContainText('Declined to proceed');
  await expect(page.getByTestId('sim-gates')).toContainText('Declined');

  const after = await (await page.request.get(`/api/v1/cases/${caseId}`)).json();
  expect([after.state, after.attempts, after.sessions]).toEqual([before.state, before.attempts, before.sessions]); // no operational change
});
