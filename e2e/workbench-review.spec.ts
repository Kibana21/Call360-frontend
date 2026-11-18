import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { a11yAndLayout, INTAKE, writeHeaders } from './cp04a-checks';
import { accounts, signIn } from './helpers';
import { api, buildLifecycleScript, type Api } from './lifecycle-helpers';

// S3-C — human review and case resolution on the real stack. Governed setup: a published synthetic lifecycle script,
// a narrowly scoped assignment rule (SG · protection · broker · monthly) and published finding rules. Two new synthetic
// sales are assigned by the S2-C engine; an explicitly synthetic operational fixture conversation (CLI, transport
// SYNTHETIC — never a voice session or a simulation run) is recorded on each. Review Workbench: a premature verification
// is blocked, a discrepancy is confirmed and the case escalated; the clean case is verified by maker → checker.
test.describe.configure({ timeout: 240_000 });
const backend = '../Call360-backend';

async function publishRule(author: Api, checker: Api, code: string, target: string): Promise<void> {
  const out = await author.post('/assignment-rules', { code, name: 'Review E2E rule (synthetic)' }, 201);
  const id = String(out.draft_id);
  const get = async () => (await (await author.page.request.get(`/api/v1/assignment-rule-drafts/${id}`)).json());
  const d = await get();
  const put = await author.page.request.put(`/api/v1/assignment-rule-drafts/${id}`, {
    headers: await writeHeaders(author.page),
    data: { expected_row_version: d.row_version, content: { name: d.name, description: 'S3-C E2E (synthetic)', priority: 3, is_fallback: false,
      target_script_version_id: target, effective_from: null, effective_to: null,
      conditions: [{ field: 'market', values: ['SG'] }, { field: 'product_family', values: ['PROTECTION'] },
        { field: 'selling_channel', values: ['BROKER'] }, { field: 'premium_frequency', values: ['MONTHLY'] }] } } });
  expect(put.status(), await put.text()).toBe(200);
  await author.post(`/assignment-rule-drafts/${id}/submit`, { expected_row_version: (await get()).row_version, change_summary: 'Review E2E rule' });
  await checker.post(`/assignment-rule-drafts/${id}/review`, { decision: 'APPROVE', reason: 'Checked conditions (E2E)' });
  await checker.post(`/assignment-rule-drafts/${id}/publish`, { reason: 'Review E2E publication' });
}

async function newCase(apage: Page, n: number): Promise<string> {
  const body = JSON.parse(JSON.stringify(INTAKE).replaceAll(/9\d{5}/g, String(n))) as typeof INTAKE;
  body.source_event_id = `SYN-EVT-S3C-${n}-${Date.now()}`;
  body.policy.premium_frequency = 'MONTHLY';
  body.sale.selling_channel = 'BROKER';
  body.sale.fsc_ref = 'FSC-0003'; // a seeded broker representative
  const created = await apage.request.post('/api/v1/intake/manual', { data: body, headers: { ...(await writeHeaders(apage)), 'Idempotency-Key': `e2e-s3c-${n}` } });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).case.case_id as string;
}

function fixture(caseRef: string, answers: Record<string, unknown>): Record<string, unknown> {
  const out = execFileSync('uv', ['run', 'call360', '--env-file', '.env.test', 'review-fixture', '--case', caseRef, '--answers', JSON.stringify(answers), '--confirm-synthetic'],
    { cwd: backend, encoding: 'utf8' });
  return JSON.parse(out.slice(out.indexOf('{'))) as Record<string, unknown>;
}

test('S3-C: synthetic operational case → findings → review → disposition → blocked premature verification → escalation → maker-checker verification', async ({ page, browser }) => {
  const { user, checker } = accounts();
  const n = 610000 + Math.floor(Math.random() * 80000);
  const code = `RVE_${n}`;
  const p = `RVE${n}`;
  await signIn(page, user, '/reviews');
  await page.setViewportSize({ width: 1440, height: 900 });
  const author = await api(page);
  const origin = new URL(page.url()).origin;
  const cctx = await browser.newContext({ baseURL: origin });
  const cpage = await cctx.newPage();
  await signIn(cpage, checker, '/reviews');
  const chk = await api(cpage);
  const vid = await buildLifecycleScript(author, chk, code, p);
  await publishRule(author, chk, `S3C-E2E-${n}`, vid);
  // Finding rules: a new version (copy of anything published) adding an any-mandatory-unresolved rule.
  const fr = await author.post('/finding-rule-sets', {}, 201) as { id: string; row_version: number; rules: Record<string, unknown>[] };
  const keep = ['rule_code', 'scope', 'target', 'mandatory_only', 'trigger', 'category', 'description', 'severity', 'severity_justification', 'review_required'];
  const rules = [...fr.rules.map((r) => Object.fromEntries(keep.map((k) => [k, r[k]]))), { rule_code: `FR-E2E-UNRES-${n}`, scope: 'ANY_QUESTION', target: null, mandatory_only: true, trigger: 'UNRESOLVED',
    category: 'MISSING_MANDATORY_ANSWER', description: 'A mandatory answer is missing (E2E)', severity: 'MEDIUM', severity_justification: 'Synthetic E2E severity, not an approved threshold', review_required: true }];
  const put = await page.request.put(`/api/v1/finding-rule-sets/${fr.id}`, { data: { expected_row_version: fr.row_version, rules }, headers: await writeHeaders(page) });
  expect(put.status(), await put.text()).toBe(200);
  await author.post(`/finding-rule-sets/${fr.id}/submit`, { expected_row_version: (await put.json()).row_version, change_summary: 'S3-C E2E rules' });
  await chk.post(`/finding-rule-sets/${fr.id}/review`, { decision: 'APPROVE', reason: 'Reviewed E2E finding rules' });
  await chk.post(`/finding-rule-sets/${fr.id}/publish`, {});

  // Two new synthetic sales, assigned by the engine; one explicitly synthetic fixture conversation on each.
  const ids: Record<string, string> = {};
  const actx = await browser.newContext({ baseURL: origin });
  const apage = await actx.newPage();
  await signIn(apage, accounts().admin, '/intake'); // one administrator sign-in for both synthetic sales
  for (const [k, offset] of [['bad', 0], ['good', 1]] as const) ids[k] = await newCase(apage, n + offset);
  await actx.close();
  for (const k of ['bad', 'good'] as const) {
    await page.goto(`/cases/${ids[k]}`);
    await page.getByTestId('apply-open').click();
    await page.getByTestId('apply-assignment').click();
    await expect(page.getByTestId('script-assignment')).toContainText(code);
  }
  const ref = async (id: string) => (await (await page.request.get(`/api/v1/cases/${id}`)).json()).case_ref as string;
  const bad = fixture(await ref(ids.bad!), { [`Q-${p}-POLICY`]: 'REFUSED' });
  expect(bad.findings).toHaveLength(1);
  fixture(await ref(ids.good!), {});

  // Review Workbench → cases → the discrepancy case.
  await page.goto('/reviews?tab=cases');
  await page.getByTestId(`rw-case-${await ref(ids.bad!)}`).click();
  await expect(page.getByTestId('rc-fixture')).toContainText('explicitly synthetic');
  await expect(page.getByTestId(`rc-q-Q-${p}-POLICY`)).toContainText('Refused');
  await expect(page.getByTestId('rc-check-MANDATORY_ANSWERED')).toContainText('Blocked');
  await expect(page.getByTestId('rc-check-IDENTITY_GATE')).toContainText('Pass');
  // Premature verification is blocked with reasons.
  await page.getByTestId('rc-decide-VERIFY').click();
  await page.getByTestId('rc-decision-form-reason').fill('The conversation completed');
  await page.getByTestId('rc-decision-form-submit').click();
  await expect(page.getByTestId('rc-decision-error')).toContainText('cannot be verified yet');
  await expect(page.getByTestId('rc-decision-error')).toContainText(`Q-${p}-POLICY`);
  // Confirm the discrepancy (reason required), then escalate with a REV-003 reason.
  const finding = page.locator('[data-testid^="rc-finding-FND-ENG-"]').first();
  await finding.locator('[data-testid$="-CONFIRM"]').click();
  await page.getByTestId('rc-f-form-reason').fill('The customer refused a mandatory question');
  await page.getByTestId('rc-f-form-submit').click();
  await expect(finding).toContainText('Confirmed');
  await page.getByTestId('rc-case-ESCALATE').click();
  await page.getByTestId('rc-escalation-reason').selectOption('MIS_SELLING_CONCERN');
  await page.getByTestId('rc-case-form-reason').fill('Refusal pattern suggests a mis-selling concern');
  await page.getByTestId('rc-case-form-submit').click();
  await expect(page.getByTestId('rc-header')).toContainText('Escalated');
  await expect(page.getByTestId('rc-history')).toContainText('Escalate');
  await a11yAndLayout(page, 's3c-case-review');
  await page.setViewportSize({ width: 1440, height: 900 });

  // The clean case: maker proposes VERIFY; the checker (different user) approves.
  await page.goto(`/reviews/cases/${ids.good}`);
  await expect(page.getByTestId('rc-readiness')).toBeVisible();
  for (const c of ['IDENTITY_GATE', 'LIFECYCLE_GATES', 'MANDATORY_ANSWERED', 'EVIDENCE_COMPLETE', 'FINDINGS_DISPOSITIONED']) await expect(page.getByTestId(`rc-check-${c}`)).toContainText('Pass');
  await page.getByTestId('rc-decide-VERIFY').click();
  await page.getByTestId('rc-decision-form-reason').fill('All readiness checks pass on the recorded evidence');
  await page.getByTestId('rc-decision-form-submit').click();
  await expect(page.getByTestId('rc-approval-wait')).toContainText('a different checker must decide it');
  await cpage.goto('/reviews?tab=approvals');
  await expect(cpage.getByTestId('rw-approvals')).toContainText(await ref(ids.good!));
  await cpage.goto(`/reviews/cases/${ids.good}`);
  await cpage.locator('[data-testid^="rc-approval-open-"]').click();
  await cpage.getByTestId('rc-approve-form-reason').fill('Evidence and checks reviewed as checker');
  await cpage.getByTestId('rc-approve-form-submit').click();
  await expect(cpage.getByTestId('rc-header')).toContainText('Verified');
  await expect(cpage.getByTestId('rc-history')).toContainText('Approve verify');
  await cctx.close();
  // This journey needs three sign-ins; let the local per-IP sign-in window (20 / minute, unchanged) clear before the
  // next spec so its sign-ins are not throttled.
  await page.waitForTimeout(61_000);
});
