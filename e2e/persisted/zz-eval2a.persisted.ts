import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// (Named to run after zz-eval1: it uses the surveys, rules, groups and finding rules published by the journeys before.)
// EVAL-2A — governed control policy, applicability and coverage, full stack:
//   * a control policy is drafted in the Controls and evidence builder, checked against an invented application,
//     refused once with the reason, proposed, approved by a second person and published by a third — in the browser;
//   * a mapping is built in the browser from a published question, tested against a simulated journey, proposed,
//     approved and published by three people;
//   * two DIFFERENT published surveys reuse ONE published question revision; a coordinated simulation answers it
//     differently in each; the Evaluation Workbench shows both answers on one control instance, requiring review;
//   * a required control whose evidence is missing, with its finding from the existing finding rules;
//   * coverage is reported separately from the evaluation, the control outcomes and operational eligibility.
// Every control, obligation, condition, mapping and rule is a TEST FIXTURE. Simulation only.
const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../../../Call360-backend');
const SHOTS = 'test-results/persisted/shots';
const ORIGIN = 'http://127.0.0.1:5174';
const A = '/api/v1/survey-assignment';
const E = '/api/v1/survey-evaluation';
type Who = 'survey_author' | 'survey_checker' | 'survey_publisher' | 'survey_simulator' | 'survey_reader' | 'user' | 'checker';
const account = (who: Who): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'))[who];

/* eslint-disable @typescript-eslint/no-explicit-any */
type S = { context: BrowserContext; page: Page };
async function session(browser: Browser, who: Who, path = '/'): Promise<S> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, account(who), path);
  return { context, page };
}
const csrf = async (context: BrowserContext) => ({ 'X-CSRF-Token': (await context.cookies()).find((c) => c.name === 'c360_csrf')!.value, Origin: ORIGIN });
const get = async (s: S, path: string) => (await s.page.request.get(path)).json();
const post = async (s: S, path: string, data: unknown = {}) => { const r = await s.page.request.post(path, { data, headers: await csrf(s.context) }); expect(r.ok(), `${path}: ${await r.text()}`).toBe(true); return r.json(); };
const py = (script: string, ...args: string[]) => execFileSync('uv', ['run', 'python', `scripts/${script}`, ...args], { cwd: backend, env: { ...process.env, CALL360_ENV_FILE: '.env.test' } }).toString().trim().split('\n').pop()!;
const NAME_A = 'Premium term survey (shared question)';
const NAME_B = 'Follow-up survey (reuses the term question)';

async function publishRule(maker: S, checker: S, code: string, conditions: Array<{ field: string; values: unknown[] }>, priority: number) {
  const target = (await get(maker, '/api/v1/assignment-rules/options')).targets.find((t: any) => t.label === 'SALES_VERIFICATION_SG v1.1').id;
  const made = await post(maker, '/api/v1/assignment-rules', { code, name: `${code} rule`, description: 'EVAL-2A synthetic rule' });
  const d = await get(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}`);
  const content = { name: d.name, description: d.description, conditions, priority, is_fallback: false, target_script_version_id: target, effective_from: d.effective_from, effective_to: d.effective_to };
  const put = await maker.page.request.put(`/api/v1/assignment-rule-drafts/${made.draft_id}`, { data: { expected_row_version: d.row_version, content }, headers: await csrf(maker.context) });
  expect(put.ok(), await put.text()).toBe(true);
  const saved = await get(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}`);
  await post(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}/submit`, { expected_row_version: saved.row_version, change_summary: 'EVAL-2A journey rule (synthetic)' });
  await post(checker, `/api/v1/assignment-rule-drafts/${made.draft_id}/review`, { decision: 'APPROVE', reason: 'Checked conditions' });
  await post(checker, `/api/v1/assignment-rule-drafts/${made.draft_id}/publish`, { reason: 'EVAL-2A journey publication' });
}

test.use({ actionTimeout: 20_000 });

test('EVAL-2A a governed control policy, a mapping built in the browser, and a cross-survey conflict shown as evidence', async ({ browser }) => {
  test.setTimeout(600_000);
  const author = await session(browser, 'survey_author', '/survey-studio');
  const checker = await session(browser, 'survey_checker', '/survey-studio');
  const publisher = await session(browser, 'survey_publisher', '/survey-studio');
  const three = async (path: string, body: unknown) => { const x = await post(author, path, body); await post(checker, `${path}/${x.id}/decision`, { verdict: 'APPROVE' }); await post(publisher, `${path}/${x.id}/publish`); return x; };

  // ---- survey A is published; survey B, a DIFFERENT survey, pins A's published module (the library, LIB-1)
  const codeA = py('e2e_publish_fixture.py', 'K3', NAME_A, 'e2e.survey.author', 'e2e.survey.checker', 'e2e.survey.publisher');
  const surveys = (await get(author, '/api/v1/survey-definitions')).items;
  const a = surveys.find((x: any) => x.code === codeA);
  const draftA = await get(author, `/api/v1/survey-definitions/${a.id}/draft/documents`);
  const b = await post(author, '/api/v1/survey-definitions', { code: `S-E2E-REUSE-${Date.now().toString(36).toUpperCase()}`, name: NAME_B, purpose: 'synthetic: reuses a published question of another survey' });
  const draftB = await get(author, `/api/v1/survey-definitions/${b.id}/draft/documents`);
  const first = draftA.content.sequence[0];
  const content = { ...draftB.content, sequence: [...draftB.content.sequence, { instance: 'mi-shared', module: first.module, routes: Object.fromEntries(Object.keys(first.routes).map((k) => [k, k === 'COMPLETED' ? '@CONTINUE' : { survey_outcome: k }])) }] };
  await post(author, `/api/v1/survey-definitions/${b.id}/draft/save`, { expected_revision: draftB.revision, operations: [{ op: 'SET_CONTENT', content }] });
  const findings = (await post(author, `/api/v1/survey-definitions/${b.id}/draft/validate`)).findings ?? [];
  const cand = await post(author, `/api/v1/survey-definitions/${b.id}/candidates`, { note: 'EVAL-2A', acknowledgements: findings.filter((f: any) => f.severity === 'WARNING').map((f: any) => ({ code: f.code, at: f.at, reason: 'Synthetic test content; acknowledged.' })) });
  await post(checker, `/api/v1/survey-candidates/${cand.id}/decision`, { verdict: 'APPROVE' });
  const versionB = (await post(publisher, `/api/v1/survey-candidates/${cand.id}/publish`)).id as string;
  const versionA = (await get(author, `/api/v1/survey-definitions/${a.id}/history`)).versions.find((v: any) => v.status === 'PUBLISHED').id as string;
  const setup = JSON.parse(py('e2e_eval_setup.py', NAME_A, NAME_B, 'Policy replacement survey'));
  const itemsA = setup.surveys[NAME_A].items, itemsB = setup.surveys[NAME_B].items, itemsK8 = setup.surveys['Policy replacement survey'].items;
  const shared = itemsA['mi-numbers/n1'];
  expect(itemsB['mi-shared/n1']).toEqual(shared); // one published question revision, two surveys

  // ---- both surveys are required for a "direct" application (stand-in conditions; ASG-2A)
  const maker = await session(browser, 'user');
  const ruleChecker = await session(browser, 'checker');
  const cond = [{ field: 'market', values: ['SG'] }, { field: 'product_family', values: ['PROTECTION'] }, { field: 'selling_channel', values: ['DIRECT'] }];
  await publishRule(maker, ruleChecker, 'M-EV-A', cond, 21);
  await publishRule(maker, ruleChecker, 'M-EV-B', cond, 22);
  await maker.context.close(); await ruleChecker.context.close();
  await three(`${A}/bindings`, { rule_code: 'M-EV-A', rule_version: 1, survey_version_id: versionA, note: 'EVAL-2A journey' });
  await three(`${A}/bindings`, { rule_code: 'M-EV-B', rule_version: 1, survey_version_id: versionB, note: 'EVAL-2A journey' });
  await three(`${A}/groups`, { code: 'ADD-TERM-A-E2E', kind: 'ADD_REQUIRED', name: 'ADD-TERM-A-E2E', purpose: 'Synthetic: the term survey', sequence: 5, members: [{ rule_code: 'M-EV-A', rule_version: 1 }] });
  await three(`${A}/groups`, { code: 'ADD-TERM-B-E2E', kind: 'ADD_REQUIRED', name: 'ADD-TERM-B-E2E', purpose: 'Synthetic: the follow-up survey', sequence: 6, members: [{ rule_code: 'M-EV-B', rule_version: 1 }] });

  // ---- the journey: the shared question is answered 20 in survey A and 30 in survey B
  const sim = await session(browser, 'survey_simulator', '/survey-studio');
  const fields = Object.fromEntries((await get(sim, `${A}/options`)).fields.map((f: any) => [f.field, f.values.map((v: any) => v.value)]));
  const application = { market: 'SG', product_family: 'PROTECTION', selling_channel: 'DIRECT', premium_frequency: 'ANNUAL', case_purpose: fields.case_purpose[0], product_code: fields.product_code[0], is_ilp: false, risk_band: fields.risk_band[0], contact_role: [fields.contact_role[0]] };
  const comp = await post(sim, `${A}/composite-plans`, { assignment_inputs: application, facts: {} });
  let co = await post(sim, `${A}/composite-plans/${comp.id}/coordinated-simulations`, { label: 'EVAL-2A conflict journey' });
  const ordinary = (p: any) => (p.answer_type === 'YES_NO' ? { choice: 'YES' } : p.answer_type === 'ACKNOWLEDGEMENT' ? { acknowledged: true } : { number: 20 });
  while (co.status === 'RUNNING') {
    const p = co.current.pending;
    const versionNow = co.surveys[co.current.position - 1].survey_version_id;
    const answer = p.answer_type === 'NUMERIC' ? { number: p.key.endsWith('/n1') ? (versionNow === versionB ? 30 : 20) : p.key.endsWith('/n2') ? 12.5 : -3 } : ordinary(p);
    co = await post(sim, `${A}/coordinated-simulations/${co.id}/inputs`, { expected_inputs: co.progress.inputs, key: p.key, answer });
  }
  expect(co.status).toBe('ALL_SURVEYS_COMPLETED');
  expect(co.surveys.map((s: any) => s.survey_version_id)).toEqual(expect.arrayContaining([versionA, versionB]));
  const simOf = (v: string) => co.surveys.find((s: any) => s.survey_version_id === v).simulation_id as string;

  // ============ the Controls and evidence builder: a control policy, in the browser ============
  const page = author.page;
  const options = await get(author, `${E}/builder-options`);
  const older = options.conditions.find((c: any) => c.usable && c.params.includes('minimum_age'));
  await page.goto('/survey-studio');
  await page.getByTestId('ss-open-controls').click();
  await expect(page.getByTestId('ss-cb')).toBeVisible();
  await expect(page.getByTestId('ss-cb-notice')).toContainText('creates no compliance obligation');
  // discover a control and inspect its definition
  await page.getByTestId('ss-cb-search').fill('elevated');
  await expect(page.getByTestId('ss-cb-controls').locator('li')).toHaveCount(1);
  await page.getByTestId('ss-cb-control-SYN-CTRL-05').click();
  await expect(page.getByTestId('ss-cb-control')).toContainText('It has no revisions of its own');
  await expect(page.getByTestId('ss-cb-control-policies')).toContainText('No control policy names this control');
  await page.getByTestId('ss-cb-search').fill('');

  await page.getByTestId('ss-cb-new-policy').click();
  await page.getByTestId('ss-cb-f-code').fill('POL-E2E');
  await page.getByTestId('ss-cb-f-name').fill('Synthetic verification policy');
  await page.getByTestId('ss-cb-f-owner').fill('Synthetic owner (test)');
  await page.getByTestId('ss-cb-f-scope').fill('Synthetic direct-channel applications of the browser journey');
  await page.getByTestId('ss-cb-f-source').fill('Synthetic test policy; not a business policy');
  await page.getByTestId('ss-cb-f-complete').check();
  const addControl = async (code: string, key: string, title: string, evKey: string, evDesc: string, purpose: string | null) => {
    await page.getByTestId('ss-cb-add-control').selectOption(code);
    await page.getByTestId('ss-cb-add-control-go').click();
    if (purpose) await page.getByTestId(`ss-cb-purpose-${code}`).fill(purpose);
    await page.getByTestId(`ss-cb-ob-key-${code}-0`).fill(key);
    await page.getByTestId(`ss-cb-ob-title-${code}-0`).fill(title);
    await page.getByTestId(`ss-cb-ev-key-${code}-0-0`).fill(evKey);
    await page.getByTestId(`ss-cb-ev-desc-${code}-0-0`).fill(evDesc);
  };
  await addControl('SYN-CTRL-01', 'TERM', 'The customer states the premium term', 'E-TERM', 'The term the customer states', null);
  // an invalid proposal says why, and where — nothing is recorded
  await page.getByTestId('ss-cb-propose').click();
  await expect(page.getByTestId('ss-cb-error')).toContainText('Control 1 (SYN-CTRL-01)');
  await expect(page.getByTestId('ss-cb-error')).toContainText('say what this control is for');
  expect((await get(author, `${E}/control-policies`)).items).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/EVAL2A01-invalid-policy-says-why.png`, fullPage: true });
  await page.getByTestId('ss-cb-purpose-SYN-CTRL-01').fill('Synthetic: the stated premium term is the one applied for');
  await addControl('SYN-CTRL-04', 'IDENTITY', 'The customer confirms who they are', 'E-ID', 'The customer confirms their identity', 'Synthetic: identity is confirmed before anything else');
  await addControl('SYN-CTRL-05', 'SENIOR', 'An older customer acknowledges the review', 'E-ACK', 'The customer acknowledges', 'Synthetic: elevated-risk review for older customers');
  // a governed applicability condition, chosen from the published conditions
  await page.getByTestId('ss-cb-ob-when-SYN-CTRL-05-0').selectOption(`${older.code}@${older.version}`);
  await page.getByTestId('ss-cb-ob-param-SYN-CTRL-05-0-minimum_age').fill('60');

  // ---- test against invented applications: unknown stays unknown; then not applicable; then required
  await page.getByTestId('ss-cb-check').click();
  await expect(page.getByTestId('ss-cb-applies-SYN-CTRL-05-SENIOR')).toHaveAttribute('data-status', 'UNKNOWN');
  await expect(page.getByTestId('ss-cb-applies-SYN-CTRL-05-SENIOR')).toContainText('not known: customer.age_years');
  await expect(page.getByTestId('ss-cb-applies-SYN-CTRL-01-TERM')).toHaveAttribute('data-status', 'APPLICABLE');
  const unknownPrint = await page.getByTestId('ss-cb-check-result').getAttribute('data-fingerprint');
  await page.getByTestId('ss-cb-fact-customer.age_years').fill('40');
  await page.getByTestId('ss-cb-check').click();
  await expect(page.getByTestId('ss-cb-applies-SYN-CTRL-05-SENIOR')).toHaveAttribute('data-status', 'NOT_APPLICABLE');
  await page.getByTestId('ss-cb-fact-customer.age_years').fill('70');
  await page.getByTestId('ss-cb-check').click();
  await expect(page.getByTestId('ss-cb-applies-SYN-CTRL-05-SENIOR')).toHaveAttribute('data-status', 'APPLICABLE');
  expect(await page.getByTestId('ss-cb-check-result').getAttribute('data-fingerprint')).not.toBe(unknownPrint);
  await page.screenshot({ path: `${SHOTS}/EVAL2A02-policy-builder-tested-on-an-invented-application.png`, fullPage: true });
  expect((await get(author, `${E}/control-policies`)).items).toEqual([]); // trying records nothing

  // ---- proposed by the author, approved by a second person, published by a third — each in the browser
  await page.getByTestId('ss-cb-propose').click();
  const view = page.getByTestId('ss-cb-policy');
  await expect(view).toHaveAttribute('data-status', 'PROPOSED');
  const policyId = (await view.getAttribute('data-policy'))!;
  await expect(page.getByTestId('ss-cb-policy-completeness')).toHaveAttribute('data-completeness', 'DECLARED_COMPLETE');
  // which governance action is available now is said in one place — and it is not the proposer's
  await expect(page.getByTestId('ss-cb-next')).toHaveAttribute('data-action', 'WAIT_FOR_APPROVER');
  await expect(page.getByTestId('ss-cb-next')).toContainText('someone else must decide it');
  await expect(page.getByTestId('ss-cb-policy-standing')).toContainText('It is not an approved compliance policy');
  await expect(page.getByTestId('ss-cb-policy-approve')).toHaveCount(0);
  await expect(page.getByTestId('ss-cb-policy-control-SYN-CTRL-05')).toContainText('required when');
  const url = `/survey-studio/controls?view=policy&policy=${policyId}`;
  await checker.page.goto(url);
  await expect(checker.page.getByTestId('ss-cb-next')).toHaveAttribute('data-action', 'APPROVE');
  await checker.page.getByTestId('ss-cb-policy-approve').click();
  await expect(checker.page.getByTestId('ss-cb-policy')).toHaveAttribute('data-status', 'APPROVED');
  await expect(checker.page.getByTestId('ss-cb-next')).toHaveAttribute('data-action', 'WAIT_FOR_PUBLISHER');
  await expect(checker.page.getByTestId('ss-cb-next')).toContainText('a third person must publish it');
  await expect(checker.page.getByTestId('ss-cb-policy-publish')).toHaveCount(0);
  await publisher.page.goto(url);
  await expect(publisher.page.getByTestId('ss-cb-next')).toHaveAttribute('data-action', 'PUBLISH');
  await publisher.page.getByTestId('ss-cb-policy-publish').click();
  await expect(publisher.page.getByTestId('ss-cb-policy')).toHaveAttribute('data-status', 'PUBLISHED');
  await expect(publisher.page.getByTestId('ss-cb-policy-standing')).toContainText('says nothing about regulatory coverage');
  await expect(publisher.page.getByTestId('ss-cb-policy-history').locator('li')).toHaveCount(3);
  const policy = await get(author, `${E}/control-policies/${policyId}`);
  expect(new Set([policy.proposed_by, policy.approved_by, policy.published_by]).size).toBe(3);
  await publisher.page.screenshot({ path: `${SHOTS}/EVAL2A03-policy-published-by-a-third-person.png`, fullPage: true });

  // ============ the mapping, built in the browser from a published question ============
  await page.goto(`/survey-studio/controls?view=map&control=SYN-CTRL-01&policy=${policyId}`);
  await expect(page.getByTestId('ss-cb-map')).toBeVisible();
  await expect(page.getByTestId('ss-cb-req-TERM-E-TERM')).toHaveAttribute('data-mapped', '0');
  await page.getByTestId('ss-cb-req-add-TERM-E-TERM').click();
  await page.getByTestId('ss-cb-item-TERM-E-TERM').selectOption(`${shared.code}@${shared.version}`);
  await expect(page.getByTestId('ss-cb-implication-TERM-E-TERM')).toContainText('2 published surveys'); // the implication of choosing a shared question
  await expect(page.getByTestId('ss-cb-implication-TERM-E-TERM')).toContainText(NAME_B);
  await expect(page.getByTestId('ss-cb-method-TERM-E-TERM')).toHaveValue('NUMERIC_COMPARE');
  await page.getByTestId('ss-cb-journey').selectOption(co.id);
  await page.getByTestId('ss-cb-try').click(); // no expected number yet: the server says why
  await expect(page.getByTestId('ss-cb-map-invalid')).toContainText('Enter the expected number');
  await page.getByTestId('ss-cb-value-TERM-E-TERM').fill('20');
  await page.getByTestId('ss-cb-try').click();
  // the trial shows the conflict BEFORE anything is proposed, and records nothing
  await expect(page.getByTestId('ss-cb-trial-TERM')).toHaveAttribute('data-outcome', 'REQUIRES_REVIEW');
  await expect(page.getByTestId('ss-cb-trial-TERM')).toHaveAttribute('data-coverage', 'EVIDENCE_CONFLICTING');
  await expect(page.getByTestId('ss-cb-trial')).toContainText('nothing was recorded');
  expect((await get(author, `${E}/evaluations?coordinated_simulation_id=${co.id}`)).items).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/EVAL2A04-mapping-builder-trial-shows-the-conflict.png`, fullPage: true });
  await page.getByTestId('ss-cb-map-propose').click();
  await expect(page.getByTestId('ss-cb-map-next')).toContainText('someone else must decide it');
  const mapUrl = `/survey-studio/controls?view=map&control=SYN-CTRL-01&policy=${policyId}`;
  await checker.page.goto(mapUrl);
  await checker.page.getByTestId('ss-cb-map-approve').click();
  await expect(checker.page.getByTestId('ss-cb-map-next')).toContainText('a third person must publish it');
  await publisher.page.goto(mapUrl);
  await publisher.page.getByTestId('ss-cb-map-publish').click();
  await expect(publisher.page.getByTestId('ss-cb-mapping').first()).toHaveAttribute('data-status', 'PUBLISHED');
  const m01 = (await get(author, `${E}/mappings`)).items.filter((m: any) => m.control_code === 'SYN-CTRL-01').pop();
  expect([m01.status, m01.entries[0].requirement, m01.entries[0].item]).toEqual(['PUBLISHED', 'E-TERM', shared]);
  expect(new Set([m01.proposed_by, m01.approved_by, m01.published_by]).size).toBe(3);
  // the identity control is mapped to a question that is NOT in this journey (three people, through the API)
  await three(`${E}/mappings`, { market_code: 'SG', control_code: 'SYN-CTRL-04', combination: 'ALL_REQUIRED', applicability: null, source: 'Synthetic mapping for the EVAL-2A browser journey', entries: [{ item: itemsK8['mi-opening/n2'], evidence_type: 'ANSWER', required: true, survey_code: null, rule: { method: 'EXACT_BOOLEAN', expected_boolean: true }, obligation: 'IDENTITY', requirement: 'E-ID' }] });
  await author.context.close(); await checker.context.close(); await publisher.context.close();

  // ============ the journey evaluated under the policy, in the Evaluation Workbench ============
  const w = sim.page;
  const ev = w.getByTestId('ss-ev');
  await w.goto(`/survey-studio/coordinated-simulations/${co.id}`);
  await w.getByTestId('ss-ev-policy-pick').selectOption(policyId);
  await w.getByTestId('ss-ev-evaluate').click();
  await expect(ev).toHaveAttribute('data-policy', policyId);
  const rec = await get(sim, `${E}/evaluations/${await ev.getAttribute('data-evaluation')}`);
  expect([rec.record_class, rec.policy.code, rec.policy.revision, rec.journey.complete]).toEqual(['SIMULATION', 'POL-E2E', 1, true]);
  const inst = (code: string, ob: string) => rec.controls.find((c: any) => c.control_code === code && c.obligation === ob);
  // ONE control instance, two observations, two simulations, two different accepted answers
  const term = inst('SYN-CTRL-01', 'TERM');
  expect(term.observations.map((o: any) => [o.simulation_id, o.survey.survey_version_id, o.evaluation.answer.value, o.result])).toEqual([[simOf(versionA), versionA, 20, 'MATCH'], [simOf(versionB), versionB, 30, 'MISMATCH']]);
  expect([term.outcome, term.coverage, term.reasons[0].code]).toEqual(['REQUIRES_REVIEW', 'EVIDENCE_CONFLICTING', 'EVIDENCE_CONFLICT']);
  const idn = inst('SYN-CTRL-04', 'IDENTITY');
  expect([idn.outcome, idn.coverage, idn.observations[0].gap]).toEqual(['INSUFFICIENT_EVIDENCE', 'EVIDENCE_MISSING', 'ITEM_NOT_IN_JOURNEY']);
  expect([inst('SYN-CTRL-05', 'SENIOR').outcome, inst('SYN-CTRL-05', 'SENIOR').coverage]).toEqual(['UNRESOLVED', 'APPLICABILITY_UNKNOWN']); // the application's age is not known
  expect([rec.coverage.status, rec.processing_status, rec.operational_compliance_eligibility.status]).toEqual(['INCOMPLETE', 'REQUIRES_REVIEW', 'NOT_ESTABLISHED']);
  // findings only under the existing governed rules: the mismatch and the missing evidence — nothing for the conflict
  expect(rec.findings.map((f: any) => [f.control_code, f.rule.rule_code]).sort()).toEqual([['SYN-CTRL-01', 'FR-E2E-MISMATCH'], ['SYN-CTRL-04', 'FR-E2E-NOT-ASKED']]);

  // the screen: every survey completed — coverage incomplete, evaluation requires review, eligibility not established
  await expect(ev).toHaveAttribute('data-coverage', 'INCOMPLETE');
  await expect(w.getByTestId('ss-ev-status')).toHaveText(/requires review/);
  await expect(w.getByTestId('ss-ev-coverage-status')).toHaveText(/Coverage: incomplete/);
  await expect(w.getByTestId('ss-ev-coverage')).toContainText('never inferred from survey questions having been answered');
  await expect(w.getByTestId('ss-ev-missing-inputs')).toContainText('customer.age_years');
  await expect(w.getByTestId('ss-ev-eligibility')).toHaveAttribute('data-status', 'NOT_ESTABLISHED');
  await expect(w.getByTestId('ss-ev-summary')).toContainText(`${co.surveys.length} of ${co.surveys.length} surveys completed`);
  for (const c of rec.controls) { await expect(w.getByTestId(`ss-ev-control-${c.control_code}-${c.obligation}`)).toHaveAttribute('data-outcome', c.outcome); await expect(w.getByTestId(`ss-ev-control-${c.control_code}-${c.obligation}`)).toHaveAttribute('data-coverage', c.coverage); }
  await w.screenshot({ path: `${SHOTS}/EVAL2A05-coverage-separate-from-outcome-and-eligibility.png`, fullPage: true });

  // both responses, each with its own survey and simulation, neither overriding the other
  const row = w.getByTestId('ss-ev-control-SYN-CTRL-01-TERM');
  await row.locator('summary').first().click();
  const rows = w.getByTestId('ss-ev-evidence-SYN-CTRL-01-TERM').locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-simulation', simOf(versionA));
  await expect(rows.nth(1)).toHaveAttribute('data-simulation', simOf(versionB));
  await expect(rows.nth(0)).toHaveAttribute('data-result', 'MATCH');
  await expect(rows.nth(1)).toHaveAttribute('data-result', 'MISMATCH');
  await expect(rows.nth(0).locator('td').nth(1)).toHaveText(/^20/);
  await expect(rows.nth(1).locator('td').nth(1)).toHaveText(/^30/);
  await expect(w.getByTestId('ss-ev-reasons-SYN-CTRL-01-TERM')).toContainText('none is chosen');
  await expect(w.getByTestId('ss-ev-requirements-SYN-CTRL-01-TERM').locator('li')).toHaveAttribute('data-status', 'MAPPED');
  await row.screenshot({ path: `${SHOTS}/EVAL2A06-one-control-two-surveys-conflicting-answers.png` });

  // a required control with missing evidence, and its governed finding
  const idRow = w.getByTestId('ss-ev-control-SYN-CTRL-04-IDENTITY');
  await idRow.locator('summary').first().click();
  await expect(w.getByTestId('ss-ev-evidence-SYN-CTRL-04-IDENTITY').locator('tbody tr')).toHaveAttribute('data-gap', 'ITEM_NOT_IN_JOURNEY');
  await expect(idRow.getByTestId('ss-ev-finding')).toHaveAttribute('data-rule', 'FR-E2E-NOT-ASKED');
  await expect(idRow.getByTestId('ss-ev-finding')).toContainText('no answer — the evidence is missing');
  await idRow.screenshot({ path: `${SHOTS}/EVAL2A07-required-control-missing-evidence-and-finding.png` });
  await w.getByTestId('ss-ev-filter-coverage').selectOption('EVIDENCE_CONFLICTING');
  await expect(w.getByTestId('ss-ev-shown')).toHaveText('1');
  await w.getByTestId('ss-ev-filter-coverage').selectOption('');
  await expect(w.getByTestId('ss-ev-policy-link')).toContainText('Synthetic verification policy, revision 1');

  // ---- security: a reader of surveys sees neither the builder nor a policy
  const reader = await session(browser, 'survey_reader', '/survey-studio/controls');
  await expect(reader.page.getByTestId('ss-cb-not-permitted')).toBeVisible();
  expect((await reader.page.request.get(`${E}/control-policies/${policyId}`)).status()).toBe(403);
  expect((await sim.page.request.post(`${E}/control-policies`, { data: {}, headers: await csrf(sim.context) })).status()).toBe(403); // the simulator cannot propose
  await reader.context.close();
  await sim.context.close();
});
