import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// (Named to run last: it walks ONE application across everything the journeys before it published and governed.)
// E2E-1 — one governed, synthetic application from assignment to assurance, in a real browser, full stack.
//   Steps 1–5 are done here through the SAME governed operations the screens use, from the signed-in sessions of
//   distinct people (a new survey reusing a published module; three people publish it; a published rule is bound to
//   it; it joins a governed requirement group). Authoring through the screens themselves is the subject of the
//   FI-1, FI-2 and LIB-1 journeys of this suite and is not repeated.
//   Steps 6–10 run the application through assignment and the coordinated simulation, with one refused answer.
//   Step 11 SELECTS the governed control policy and mappings that the EVAL-2A journey built and published in the
//   browser. The policy is named explicitly: nothing selects a control policy for an application.
//   Steps 12–15: evaluation, execution assurance (in the workbench), and the journey page that connects the screens.
// Then the contrasting scenarios, each as its own journey: a completed journey with an unsatisfied control, a
// cross-survey conflict, an unfinished journey, an application whose requirement cannot be resolved, and an earlier
// record after governance moved on. Every rule, control, mapping, finding rule and application is a TEST FIXTURE.
const here = dirname(fileURLToPath(import.meta.url));
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
const raw = async (s: S, path: string, data: unknown = {}) => s.page.request.post(path, { data, headers: await csrf(s.context) });
const post = async (s: S, path: string, data: unknown = {}) => { const r = await raw(s, path, data); expect(r.ok(), `${path}: ${await r.text()}`).toBe(true); return r.json(); };
const NAME_A = 'Premium term survey (shared question)';
const NAME_C = 'E2E-1 confirmation survey (reuses the term question)';
const FACTS = { 'policy.annual_premium': 3000, 'policy.is_replacement': true, 'customer.age_years': 40 };

test.use({ actionTimeout: 20_000 });

test('E2E-1 one governed synthetic application, from what was required to whether its execution was faithful', async ({ browser }) => {
  test.setTimeout(600_000);
  const author = await session(browser, 'survey_author', '/survey-studio');
  const checker = await session(browser, 'survey_checker', '/survey-studio');
  const publisher = await session(browser, 'survey_publisher', '/survey-studio');
  const three = async (path: string, body: unknown) => {
    const x = await post(author, path, body);
    expect((await raw(author, `${path}/${x.id}/decision`, { verdict: 'APPROVE' })).ok()).toBe(false); // the proposer never approves their own
    await post(checker, `${path}/${x.id}/decision`, { verdict: 'APPROVE' });
    await post(publisher, `${path}/${x.id}/publish`);
    return x;
  };

  // ================= steps 1–3: a survey that reuses a PUBLISHED module and question, published by three people
  const a = (await get(author, '/api/v1/survey-definitions')).items.find((x: any) => x.name === NAME_A);
  const draftA = await get(author, `/api/v1/survey-definitions/${a.id}/draft/documents`);
  const c = await post(author, '/api/v1/survey-definitions', { code: `S-E2E1-${Date.now().toString(36).toUpperCase()}`, name: NAME_C, purpose: 'synthetic: the end-to-end journey’s own survey' });
  const draftC = await get(author, `/api/v1/survey-definitions/${c.id}/draft/documents`);
  const first = draftA.content.sequence[0];
  const content = { ...draftC.content, sequence: [...draftC.content.sequence, { instance: 'mi-confirm', module: first.module, routes: Object.fromEntries(Object.keys(first.routes).map((k) => [k, k === 'COMPLETED' ? '@CONTINUE' : { survey_outcome: k }])) }] };
  await post(author, `/api/v1/survey-definitions/${c.id}/draft/save`, { expected_revision: draftC.revision, operations: [{ op: 'SET_CONTENT', content }] });
  const warnings = ((await post(author, `/api/v1/survey-definitions/${c.id}/draft/validate`)).findings ?? []).filter((f: any) => f.severity === 'WARNING');
  const cand = await post(author, `/api/v1/survey-definitions/${c.id}/candidates`, { note: 'E2E-1', acknowledgements: warnings.map((f: any) => ({ code: f.code, at: f.at, reason: 'Synthetic test content; acknowledged.' })) });
  expect((await raw(author, `/api/v1/survey-candidates/${cand.id}/decision`, { verdict: 'APPROVE' })).ok()).toBe(false); // no self-review
  await post(checker, `/api/v1/survey-candidates/${cand.id}/decision`, { verdict: 'APPROVE' });
  expect((await raw(checker, `/api/v1/survey-candidates/${cand.id}/publish`)).ok()).toBe(false); // the approver does not publish
  const versionC = (await post(publisher, `/api/v1/survey-candidates/${cand.id}/publish`)).id as string;
  await author.page.goto(`/survey-studio/surveys/${c.code}/versions/${versionC}`);
  await expect(author.page.locator('body')).toContainText(NAME_C);
  await author.page.screenshot({ path: `${SHOTS}/E2E101-published-survey-reusing-a-published-module.png`, fullPage: true });

  // ================= steps 4–5: a published assignment rule bound to it; a governed requirement group
  const maker = await session(browser, 'user');
  const ruleChecker = await session(browser, 'checker');
  const target = (await get(maker, '/api/v1/assignment-rules/options')).targets.find((t: any) => t.label === 'SALES_VERIFICATION_SG v1.1').id;
  const made = await post(maker, '/api/v1/assignment-rules', { code: 'M-E2E1', name: 'M-E2E1 rule', description: 'E2E-1 synthetic rule (stand-in conditions)' });
  const d = await get(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}`);
  const conditions = [{ field: 'market', values: ['SG'] }, { field: 'product_family', values: ['PROTECTION'] }, { field: 'selling_channel', values: ['DIRECT'] }, { field: 'premium_frequency', values: ['SINGLE'] }];
  const put = await maker.page.request.put(`/api/v1/assignment-rule-drafts/${made.draft_id}`, { data: { expected_row_version: d.row_version, content: { name: d.name, description: d.description, conditions, priority: 31, is_fallback: false, target_script_version_id: target, effective_from: d.effective_from, effective_to: d.effective_to } }, headers: await csrf(maker.context) });
  expect(put.ok(), await put.text()).toBe(true);
  await post(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}/submit`, { expected_row_version: (await get(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}`)).row_version, change_summary: 'E2E-1 journey rule (synthetic)' });
  await post(ruleChecker, `/api/v1/assignment-rule-drafts/${made.draft_id}/review`, { decision: 'APPROVE', reason: 'Checked conditions' });
  await post(ruleChecker, `/api/v1/assignment-rule-drafts/${made.draft_id}/publish`, { reason: 'E2E-1 journey publication' });
  await maker.context.close(); await ruleChecker.context.close();
  const binding = await three(`${A}/bindings`, { rule_code: 'M-E2E1', rule_version: 1, survey_version_id: versionC, note: 'E2E-1 journey' });
  await three(`${A}/groups`, { code: 'ADD-CONFIRM-E2E1', kind: 'ADD_REQUIRED', name: 'ADD-CONFIRM-E2E1', purpose: 'Synthetic: the confirmation survey of the end-to-end journey', sequence: 40, members: [{ rule_code: 'M-E2E1', rule_version: 1 }] });

  // ================= steps 6–10: the application; the composite plan; the coordinated simulation
  const sim = await session(browser, 'survey_simulator', '/survey-studio');
  const page = sim.page;
  const fields = Object.fromEntries((await get(sim, `${A}/options`)).fields.map((f: any) => [f.field, f.values.map((v: any) => v.value)]));
  const application = { market: 'SG', product_family: 'PROTECTION', selling_channel: 'DIRECT', premium_frequency: 'SINGLE', case_purpose: fields.case_purpose[0], product_code: fields.product_code[0], is_ilp: false, risk_band: fields.risk_band[0], contact_role: [fields.contact_role[0]] };
  const policy = (await get(sim, `${E}/control-policies`)).items.find((p: any) => p.code === 'POL-E2E' && p.status === 'PUBLISHED'); // step 11: SELECTED, by name
  /** One journey: `term(surveyCode)` gives the answer to the shared term question in that survey; `stopAfter` leaves it unfinished. */
  const journey = async (label: string, term: (position: number) => number, opts: { refuseFirst?: boolean; stopAfter?: number } = {}) => {
    const comp = await post(sim, `${A}/composite-plans`, { assignment_inputs: application, facts: FACTS });
    let co = await post(sim, `${A}/composite-plans/${comp.id}/coordinated-simulations`, { label });
    if (opts.refuseFirst) co = await post(sim, `${A}/coordinated-simulations/${co.id}/inputs`, { expected_inputs: 0, key: co.current.pending.key, answer: {} });
    let n = 0;
    while (co.status === 'RUNNING' && (opts.stopAfter === undefined || n < opts.stopAfter)) {
      const p = co.current.pending;
      const answer = p.answer_type === 'NUMERIC' ? { number: p.key.endsWith('/n1') ? term(co.current.position) : p.key.endsWith('/n2') ? 12.5 : -3 } : p.answer_type === 'ACKNOWLEDGEMENT' ? { acknowledged: true } : { choice: 'YES' };
      co = await post(sim, `${A}/coordinated-simulations/${co.id}/inputs`, { expected_inputs: co.progress.inputs, key: p.key, answer });
      n += 1;
    }
    return { comp, co };
  };
  const evaluated = async (coId: string) => post(sim, `${E}/evaluations`, { coordinated_simulation_id: coId, control_policy_id: policy.id });
  const jr = page.getByTestId('ss-jr');
  const dim = (k: string) => page.getByTestId(`ss-jr-dim-${k}`);
  const dims = async (expected: Record<string, string>) => { for (const [k, v] of Object.entries(expected)) await expect(dim(k)).toHaveAttribute('data-status', v); };

  // ---------------------------------------------------------------- Scenario A: the complete happy path
  const A_ = await journey('E2E-1 A: complete happy path', () => 20, { refuseFirst: true });
  expect([A_.comp.selection_status, A_.comp.ordering_status, A_.comp.plan_status]).toEqual(['RESOLVED', 'GOVERNED', 'READY']);
  const selected = A_.comp.composite.selected as any[];
  expect(selected.length).toBe(6); // primary, replacement, two term surveys, the journey's own survey, a closing survey
  expect(selected.find((s: any) => s.group === 'ADD-CONFIRM-E2E1')).toMatchObject({ rule: 'M-E2E1 v1', survey_version_id: versionC, binding_id: binding.id });
  expect(A_.co.status).toBe('ALL_SURVEYS_COMPLETED');
  expect(A_.co.progress.refused_inputs).toBe(1);
  await page.goto(`/survey-studio/coordinated-simulations/${A_.co.id}`);
  await expect(page.getByTestId('ss-co')).toHaveAttribute('data-status', 'ALL_SURVEYS_COMPLETED');
  await page.screenshot({ path: `${SHOTS}/E2E102-coordinated-simulation-six-governed-surveys-completed.png`, fullPage: true });

  // steps 12–13: evaluated under the NAMED policy; then the workbench
  const evA = await evaluated(A_.co.id);
  expect([evA.processing_status, evA.coverage.status, evA.findings.length]).toEqual(['COMPLETED', 'COMPLETE_WITHIN_POLICY_SCOPE', 0]);
  expect(Object.fromEntries(evA.controls.map((x: any) => [`${x.control_code}/${x.obligation}`, x.outcome]))).toEqual({ 'SYN-CTRL-01/TERM': 'SATISFIED', 'SYN-CTRL-04/IDENTITY': 'SATISFIED', 'SYN-CTRL-05/SENIOR': 'NOT_APPLICABLE' });
  expect(new Set(evA.controls.find((x: any) => x.obligation === 'TERM').observations.map((o: any) => o.simulation_id)).size).toBe(3); // one obligation, three surveys
  await page.goto(`/survey-studio/evaluations/${evA.id}`);
  await expect(page.getByTestId('ss-ev')).toHaveAttribute('data-coverage', 'COMPLETE_WITHIN_POLICY_SCOPE');
  // step 14: execution assurance, in the workbench
  await page.getByTestId('ss-ea-run').click();
  await expect(page.getByTestId('ss-ea')).toHaveAttribute('data-status', 'VERIFIED');
  await page.screenshot({ path: `${SHOTS}/E2E103-workbench-evaluation-coverage-and-assurance.png`, fullPage: true });

  // step 15: the journey, end to end — entered from the workbench
  await page.getByTestId('ss-ev-open-journey').click();
  await expect(jr).toHaveAttribute('data-journey', A_.co.id);
  const tA = await get(sim, `${E}/journey-trace?coordinated_simulation_id=${A_.co.id}`);
  await expect(jr).toHaveAttribute('data-trace', tA.trace_sha256); // the screen shows the server's chain
  await expect(jr).toHaveAttribute('data-evaluation', evA.id);
  await expect(jr).toHaveAttribute('data-recompute', 'true');
  await dims({ completion: 'ALL_SURVEYS_COMPLETED', satisfaction: 'EVALUATED', coverage: 'COMPLETE_WITHIN_POLICY_SCOPE', assurance: 'VERIFIED', eligibility: 'NOT_ESTABLISHED' });
  await expect(page.getByTestId('ss-jr-dims').locator('> div')).toHaveCount(5);
  await expect(dim('eligibility')).toContainText('Not established');
  await expect(page.getByTestId('ss-jr-notice')).toContainText('nothing here is a compliance outcome');
  // the seven questions, in order, and fifteen links — each with the records the server names
  expect(tA.chain.map((l: any) => l.step)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  for (const q of ['REQUIRED', 'SELECTED', 'HAPPENED', 'ASSESSED', 'GAPS', 'FINDINGS', 'FAITHFUL']) await expect(page.getByTestId(`ss-jr-q-${q}`)).toBeVisible();
  for (const l of tA.chain) {
    await expect(page.getByTestId(`ss-jr-link-${l.key}`)).toHaveAttribute('data-status', l.status);
    await expect(page.getByTestId(`ss-jr-link-${l.key}`)).toHaveAttribute('data-records', String(l.records.length));
  }
  expect(tA.chain.filter((l: any) => l.status !== 'RECORDED').map((l: any) => [l.key, l.status])).toEqual([['FINDINGS', 'NONE']]);
  const link = (t: any, k: string) => t.chain.find((l: any) => l.key === k);
  expect(link(tA, 'RULE_VERSIONS').records.map((r: any) => r.label)).toContain('M-E2E1 v1');
  expect(link(tA, 'SURVEY_VERSIONS').records.map((r: any) => r.id)).toEqual(A_.co.surveys.map((s: any) => s.survey_version_id));
  expect(link(tA, 'SIMULATIONS').records.map((r: any) => [r.id, r.sha256])).toEqual(A_.co.surveys.map((s: any) => [s.simulation_id, s.run_sha256]));
  expect(link(tA, 'COMPOSITE_PLAN').records[0]).toMatchObject({ id: A_.comp.id, sha256: A_.comp.fingerprint });
  expect(link(tA, 'CONTROL_POLICY').records[0]).toMatchObject({ id: policy.id, version: 1 });
  expect(link(tA, 'CONTROL_POLICY').records[0].facts.selected_by).toBe('NAMED_EXPLICITLY');
  expect(link(tA, 'EVALUATION').records[0]).toMatchObject({ id: evA.id, sha256: evA.result_sha256 });
  await expect(page.getByTestId('ss-jr-link-SURVEY_VERSIONS').locator(`li[data-id="${versionC}"]`)).toContainText(NAME_C);
  await expect(page.getByTestId('ss-jr-link-CONTROL_POLICY')).toContainText('Nothing selects a control policy for an application');
  await expect(page.getByTestId('ss-jr-no-gaps')).toBeVisible();
  // what is unverified or undecided is on the page
  for (const code of ['SYNTHETIC_CONTENT', 'INPUT_CONSISTENCY_UNVERIFIED', 'CROSS_SURVEY_POLICY_UNRESOLVED', 'POLICY_NAMED_EXPLICITLY', 'INPUT_LINEAGE_UNVERIFIED', 'NOT_SPOKEN']) await expect(page.getByTestId('ss-jr-open-points').locator(`li[data-code="${code}"]`)).toBeVisible();
  await page.getByTestId('ss-jr-dims').screenshot({ path: `${SHOTS}/E2E104a-journey-five-separate-dimensions.png` });
  await page.screenshot({ path: `${SHOTS}/E2E104-journey-five-dimensions-and-the-evidence-chain.png`, fullPage: true });
  await expect(page.getByTestId('ss-jr-more-COMPOSITE_PLAN')).toContainText('6 supporting record(s)'); // call plans on demand
  // technical identifiers and fingerprints on demand; and the way back to an existing screen
  const sims = page.getByTestId('ss-jr-link-SIMULATIONS');
  await sims.locator('summary').first().click();
  await expect(sims.locator('details').first()).toContainText(A_.co.surveys[0].run_sha256);
  await sims.screenshot({ path: `${SHOTS}/E2E105-drill-down-record-version-fingerprint-and-source.png` });
  await page.getByTestId('ss-jr-integrity').locator('summary').click();
  await expect(page.getByTestId('ss-jr-integrity').locator('li[data-ok="false"]')).toHaveCount(0);
  await page.getByTestId('ss-jr-open-coordinated').click();
  await expect(page.getByTestId('ss-co')).toHaveAttribute('data-coordinated', A_.co.id);
  // the entry point from Survey Studio's first page
  await page.goto('/survey-studio');
  await page.getByTestId('ss-open-journeys').click();
  await expect(page.getByTestId('ss-jr-list')).toBeVisible();
  await page.getByTestId(`ss-jr-row-${A_.co.id}`).getByRole('link').click();
  await expect(jr).toHaveAttribute('data-journey', A_.co.id);

  // ---------------------------------------------------------------- Scenario B: completed, one control NOT satisfied
  const B_ = await journey('E2E-1 B: completed, one control not satisfied', () => 30);
  const evB = await evaluated(B_.co.id);
  await post(sim, `${E}/assurance`, { coordinated_simulation_id: B_.co.id, evaluation_id: evB.id });
  expect(evB.findings.length).toBeGreaterThan(0);
  await page.goto(`/survey-studio/journeys/coordinated/${B_.co.id}`);
  await dims({ completion: 'ALL_SURVEYS_COMPLETED', coverage: 'COMPLETE_WITHIN_POLICY_SCOPE', assurance: 'VERIFIED', eligibility: 'NOT_ESTABLISHED' });
  await expect(dim('satisfaction')).toHaveAttribute('data-not-satisfied', '1'); // completed, covered and faithful — and not satisfied
  await expect(page.getByTestId('ss-jr-link-FINDINGS')).toHaveAttribute('data-records', String(evB.findings.length));
  await expect(page.getByTestId('ss-jr-link-FINDINGS').locator(`li[data-sha="${evB.findings[0].finding_key}"]`)).toBeVisible(); // the finding and its identity are kept
  await expect(page.getByTestId('ss-jr-no-gaps')).toBeVisible(); // not satisfied is not an evidence gap
  await page.screenshot({ path: `${SHOTS}/E2E106-scenario-B-completed-covered-verified-and-not-satisfied.png`, fullPage: true });

  // ---------------------------------------------------------------- Scenario D: two surveys, one question, conflicting answers
  const D_ = await journey('E2E-1 D: cross-survey conflict', (position) => (position >= 4 ? 30 : 20));
  const evD = await evaluated(D_.co.id);
  await post(sim, `${E}/assurance`, { coordinated_simulation_id: D_.co.id, evaluation_id: evD.id });
  const termD = evD.controls.find((x: any) => x.obligation === 'TERM');
  expect([evD.processing_status, termD.outcome, termD.coverage]).toEqual(['REQUIRES_REVIEW', 'REQUIRES_REVIEW', 'EVIDENCE_CONFLICTING']);
  expect(new Set(termD.observations.map((o: any) => o.result))).toEqual(new Set(['MATCH', 'MISMATCH'])); // both kept
  await page.goto(`/survey-studio/journeys/coordinated/${D_.co.id}`);
  await dims({ completion: 'ALL_SURVEYS_COMPLETED', coverage: 'INCOMPLETE', assurance: 'VERIFIED' });
  const gap = page.getByTestId('ss-jr-gaps').locator('li[data-control="SYN-CTRL-01"][data-obligation="TERM"]');
  await expect(gap).toHaveAttribute('data-coverage', 'EVIDENCE_CONFLICTING');
  await expect(gap.locator('.ss-ev-reasons li')).toHaveCount(termD.observations.length);
  await page.getByTestId('ss-jr-q-GAPS').screenshot({ path: `${SHOTS}/E2E107-scenario-D-conflicting-answers-both-kept.png` });

  // ---------------------------------------------------------------- Scenario C: an unfinished journey
  const C_ = await journey('E2E-1 C: unfinished', () => 20, { stopAfter: 2 });
  expect(C_.co.status).toBe('RUNNING');
  const notStarted = C_.co.surveys.filter((s: any) => s.state === 'NOT_STARTED');
  expect(notStarted.length).toBeGreaterThan(0);
  expect(notStarted.every((s: any) => s.simulation_id === null)).toBe(true); // nothing downstream was silently run
  const evC = await evaluated(C_.co.id);
  await post(sim, `${E}/assurance`, { coordinated_simulation_id: C_.co.id, evaluation_id: evC.id });
  await page.goto(`/survey-studio/journeys/coordinated/${C_.co.id}`);
  await dims({ completion: 'RUNNING', coverage: 'INCOMPLETE', assurance: 'INCOMPLETE', eligibility: 'NOT_ESTABLISHED' });
  await expect(page.getByTestId('ss-jr-gaps').locator('li')).not.toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/E2E108-scenario-C-unfinished-journey-gaps-visible.png`, fullPage: true });

  // ---------------------------------------------------------------- Scenario E: a requirement that cannot be resolved
  const { premium_frequency: _omitted, ...lacking } = application; void _omitted;
  const e1 = await post(sim, `${A}/composite-plans`, { assignment_inputs: lacking, facts: FACTS });
  expect(e1.selection_status).toBe('UNRESOLVED_REQUIREMENT');
  const unresolved = e1.composite.requirements.filter((r: any) => r.outcome === 'INPUT_MISSING');
  expect(unresolved.length).toBeGreaterThan(0);
  expect((await raw(sim, `${A}/composite-plans/${e1.id}/coordinated-simulations`, { label: 'must not start' })).status()).toBe(409);
  await page.goto(`/survey-studio/journeys/application/${e1.id}`);
  await expect(jr).toHaveAttribute('data-kind', 'APPLICATION_ONLY');
  await dims({ completion: 'NOT_STARTED', satisfaction: 'NOT_EVALUATED', coverage: 'NOT_EVALUATED', assurance: 'NOT_CHECKED', eligibility: 'NOT_ESTABLISHED' });
  await expect(page.getByTestId('ss-jr-link-REQUIREMENT_GROUPS')).toContainText('input missing: premium_frequency'); // unresolved, not dropped
  await expect(page.getByTestId('ss-jr-link-SIMULATIONS')).toHaveAttribute('data-status', 'NOT_RECORDED_YET');
  await page.screenshot({ path: `${SHOTS}/E2E109-scenario-E-missing-input-requirement-unresolved-nothing-run.png`, fullPage: true });

  // ---------------------------------------------------------------- Scenario F: an earlier record after governance moved on
  // a newer mapping revision of SYN-CTRL-01 (the term is now expected to be 30), published by three people
  const current = (await get(author, `${E}/mappings`)).items.find((m: any) => m.control_code === 'SYN-CTRL-01' && m.status === 'PUBLISHED');
  const entry = current.entries[0];
  await three(`${E}/mappings`, { market_code: 'SG', control_code: 'SYN-CTRL-01', combination: current.combination, applicability: null, source: 'E2E-1: a later synthetic revision of the mapping', entries: [{ item: entry.item, evidence_type: 'ANSWER', required: true, survey_code: null, obligation: 'TERM', requirement: 'E-TERM', rule: { method: 'NUMERIC_COMPARE', evaluation: { operator: 'EQ', value: 30, unit: 'COUNT' } } }] });
  const oldA = await get(sim, `${E}/evaluations/${evA.id}`);
  expect([oldA.result_sha256, oldA.replay.consistent, oldA.pins.mappings.find((m: any) => m.control_code === 'SYN-CTRL-01').revision]).toEqual([evA.result_sha256, true, current.revision]);
  expect(oldA.superseded_by_current_governance.map((x: any) => x.code)).toContain('MAPPING_REVISED');
  const newA = await evaluated(A_.co.id); // the SAME journey, evaluated again: a new record with the new meaning
  expect(newA.id).not.toBe(evA.id);
  expect(newA.controls.find((x: any) => x.obligation === 'TERM').outcome).toBe('NOT_SATISFIED');
  await page.goto(`/survey-studio/journeys/coordinated/${A_.co.id}?evaluation=${evA.id}`);
  await expect(jr).toHaveAttribute('data-evaluation', evA.id);
  await expect(jr).toHaveAttribute('data-trace', tA.trace_sha256); // the earlier chain: the same records, versions and fingerprints
  await expect(dim('satisfaction')).toHaveAttribute('data-not-satisfied', '0');
  await expect(page.getByTestId('ss-jr-link-EVALUATION')).toContainText('Governance has since moved on');
  await expect(page.getByTestId('ss-jr-evaluations').getByRole('link')).toHaveCount(1); // the later evaluation is one click away, and separate
  await page.screenshot({ path: `${SHOTS}/E2E110-scenario-F-earlier-record-keeps-its-meaning.png`, fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId('ss-jr-evaluations').getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`evaluation=${newA.id}`));
  await expect(jr).toHaveAttribute('data-evaluation', newA.id);
  await expect(dim('satisfaction')).toHaveAttribute('data-not-satisfied', '1');

  // ---------------------------------------------------------------- Scenario G: security
  const reader = await session(browser, 'survey_reader', '/survey-studio');
  expect((await reader.page.request.get(`${E}/journey-trace?coordinated_simulation_id=${A_.co.id}`)).status()).toBe(403);
  await reader.page.goto(`/survey-studio/journeys/coordinated/${A_.co.id}`);
  await expect(reader.page.getByTestId('ss-jr-not-permitted')).toBeVisible();
  await expect(reader.page.getByTestId('ss-open-journeys')).toHaveCount(0);
  expect((await sim.page.request.post(`${E}/assurance`, { data: { coordinated_simulation_id: A_.co.id } })).status()).toBe(403); // no CSRF token
  await reader.context.close();
  await author.context.close(); await checker.context.close(); await publisher.context.close(); await sim.context.close();
});
