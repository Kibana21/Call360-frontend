import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// (Named to run after zz-asg1: it publishes more surveys and rules.)
// ASG-2A — one synthetic application, several surveys, full stack: a primary survey, additional required surveys and
// one of two alternatives, each selected by the existing rules within its own governed requirement group, each with
// its own SS-03B plan. The primary group is proposed, approved and published in the browser by three people.
// What the screen shows is compared with the composite the server recorded. Simulation only.
//
// Stand-ins: the rule language has no "replaces a policy" or "has a CI rider" field. Here "Life" is product family
// Protection, "replacement" is premium frequency Single and "CI rider" is sales channel Bancassurance.
const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../../../Call360-backend');
const SHOTS = 'test-results/persisted/shots';
const ORIGIN = 'http://127.0.0.1:5174';
const A = '/api/v1/survey-assignment';
type Who = 'survey_author' | 'survey_checker' | 'survey_publisher' | 'survey_simulator' | 'survey_reader' | 'user' | 'checker';
const account = (who: Who): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'))[who];
const shot = async (page: Page, name: string) => { await page.waitForTimeout(300); await page.getByTestId('ss-asg-composite').screenshot({ path: `${SHOTS}/${name}.png` }).catch(async () => { await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); }); };

/* eslint-disable @typescript-eslint/no-explicit-any */
type S = { context: BrowserContext; page: Page };
/** Published version ids by survey, filled by the first journey and used by the second (one worker, in order). */
const version: Record<string, string> = {};
async function session(browser: Browser, who: Who, path = '/'): Promise<S> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, account(who), path);
  return { context, page };
}
const csrf = async (context: BrowserContext) => ({ 'X-CSRF-Token': (await context.cookies()).find((c) => c.name === 'c360_csrf')!.value, Origin: ORIGIN });
const get = async (s: S, path: string) => (await s.page.request.get(path)).json();
const post = async (s: S, path: string, data: unknown = {}) => { const r = await s.page.request.post(path, { data, headers: await csrf(s.context) }); expect(r.ok(), `${path}: ${await r.text()}`).toBe(true); return r.json(); };
const publishFixture = (prefix: string, name: string) =>
  execFileSync('uv', ['run', 'python', 'scripts/e2e_publish_fixture.py', prefix, name, 'e2e.survey.author', 'e2e.survey.checker', 'e2e.survey.publisher'], { cwd: backend, env: { ...process.env, CALL360_ENV_FILE: '.env.test' } }).toString().trim().split('\n').pop()!;

async function publishRule(maker: S, checker: S, code: string, conditions: Array<{ field: string; values: unknown[] }>, priority: number) {
  const target = (await get(maker, '/api/v1/assignment-rules/options')).targets.find((t: any) => t.label === 'SALES_VERIFICATION_SG v1.1').id;
  const made = await post(maker, '/api/v1/assignment-rules', { code, name: `${code} rule`, description: 'ASG-2A synthetic rule' });
  const d = await get(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}`);
  const content = { name: d.name, description: d.description, conditions, priority, is_fallback: false, target_script_version_id: target, effective_from: d.effective_from, effective_to: d.effective_to };
  const put = await maker.page.request.put(`/api/v1/assignment-rule-drafts/${made.draft_id}`, { data: { expected_row_version: d.row_version, content }, headers: await csrf(maker.context) });
  expect(put.ok(), await put.text()).toBe(true);
  const saved = await get(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}`);
  await post(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}/submit`, { expected_row_version: saved.row_version, change_summary: 'ASG-2A journey rule (synthetic)' });
  await post(checker, `/api/v1/assignment-rule-drafts/${made.draft_id}/review`, { decision: 'APPROVE', reason: 'Checked conditions' });
  await post(checker, `/api/v1/assignment-rule-drafts/${made.draft_id}/publish`, { reason: 'ASG-2A journey publication' });
}

test.use({ actionTimeout: 20_000 }); // a control that is not there fails in seconds, not at the end of the test

test('ASG-2A one application selects a primary, additional required and alternative surveys, each with its own plan', async ({ browser }) => {
  test.setTimeout(480_000);
  const SG = { field: 'market', values: ['SG'] };
  const surveys: Record<string, string> = {
    LIFE: publishFixture('K1', 'Life verification survey'), REPLACEMENT: publishFixture('K8', 'Policy replacement survey'), CI: publishFixture('K7', 'Critical illness rider survey'),
    STD: publishFixture('K4', 'Closing survey (standard)'), AGENCY: publishFixture('K3', 'Closing survey (agency)'),
  };
  const maker = await session(browser, 'user');
  const ruleChecker = await session(browser, 'checker');
  const rules: Array<[string, Array<{ field: string; values: unknown[] }>, number, string]> = [
    ['M-LIFE', [SG, { field: 'product_family', values: ['PROTECTION'] }, { field: 'selling_channel', values: ['BROKER', 'BANCASSURANCE', 'DIRECT', 'AGENCY'] }], 2, 'LIFE'],
    ['M-REPL', [SG, { field: 'premium_frequency', values: ['SINGLE'] }, { field: 'product_family', values: ['PROTECTION', 'ENDOWMENT'] }], 3, 'REPLACEMENT'],
    ['M-CI', [SG, { field: 'product_family', values: ['PROTECTION'] }, { field: 'selling_channel', values: ['BANCASSURANCE'] }], 4, 'CI'],
    ['M-CLOSE-STD', [SG, { field: 'product_family', values: ['PROTECTION', 'ENDOWMENT'] }], 6, 'STD'],
    ['M-CLOSE-AGENCY', [SG, { field: 'product_family', values: ['PROTECTION', 'ENDOWMENT'] }, { field: 'selling_channel', values: ['AGENCY'] }], 6, 'AGENCY'],
  ];
  for (const [code, conditions, priority] of rules) await publishRule(maker, ruleChecker, code, conditions, priority);
  await maker.context.close(); await ruleChecker.context.close();

  const author = await session(browser, 'survey_author', '/survey-studio/assignment');
  const checker = await session(browser, 'survey_checker', '/survey-studio');
  const publisher = await session(browser, 'survey_publisher', '/survey-studio');
  // bindings and three of the groups through the API (three people each); the primary group through the screen
  const versionOf = async (code: string) => { const s = (await get(author, '/api/v1/survey-definitions')).items.find((x: any) => x.code === code); return (await get(author, `/api/v1/survey-definitions/${s.id}/history`)).versions.find((v: any) => v.status === 'PUBLISHED').id as string; };
  for (const [k, code] of Object.entries(surveys)) version[k] = await versionOf(code);
  for (const [code, , , survey] of rules) {
    const b = await post(author, `${A}/bindings`, { rule_code: code, rule_version: 1, survey_version_id: version[survey], note: 'ASG-2A journey' });
    await post(checker, `${A}/bindings/${b.id}/decision`, { verdict: 'APPROVE' });
    await post(publisher, `${A}/bindings/${b.id}/publish`);
  }
  const group = async (code: string, kind: string, members: string[], sequence: number | null, purpose: string) => {
    const g = await post(author, `${A}/groups`, { code, kind, name: `${code}`, purpose, sequence, members: members.map((m) => ({ rule_code: m, rule_version: 1 })) });
    await post(checker, `${A}/groups/${g.id}/decision`, { verdict: 'APPROVE' });
    await post(publisher, `${A}/groups/${g.id}/publish`);
  };

  // ---- before any group: the screen says the configuration cannot be trusted, and shows nothing as ready
  const simulator = await session(browser, 'survey_simulator', '/survey-studio/assignment');
  const composite = simulator.page.getByTestId('ss-asg-composite');
  const choose = async (inputs: Record<string, string>) => { for (const [f, v] of Object.entries(inputs)) await simulator.page.getByTestId(`ss-asg-in-${f}`).selectOption(v); };
  const life = { product_family: 'PROTECTION', selling_channel: 'BROKER', premium_frequency: 'ANNUAL' };
  const run = async (inputs: Record<string, string>) => { await choose(inputs); const before = (await composite.count()) ? await composite.getAttribute('data-composite') : null; await simulator.page.getByTestId('ss-asg-compose').click(); await expect(composite).not.toHaveAttribute('data-composite', before ?? 'none'); return get(simulator, `${A}/composite-plans/${await composite.getAttribute('data-composite')}`); };
  await expect(simulator.page.getByTestId('ss-asg-no-groups')).toBeVisible();
  let c = await run(life);
  await expect(composite).toHaveAttribute('data-selection', 'UNRESOLVED_CONFIGURATION');
  await expect(composite).toHaveAttribute('data-plan', 'UNRESOLVED');
  await expect(simulator.page.getByTestId('ss-asg-comp-issues')).toContainText('No primary group is published');
  await expect(simulator.page.getByTestId('ss-asg-comp-issues')).toContainText('belongs to no group');
  expect(c.composite.selected).toEqual([]);
  await shot(simulator.page, 'ASG2A01-no-groups-configuration-not-trusted');

  // ---- the primary group: proposed by the author on the screen, approved by a second person, published by a third
  await author.page.reload();
  await author.page.getByTestId('ss-asg-group-new').click();
  await author.page.getByTestId('ss-asg-group-code').fill('PRIMARY-E2E');
  await author.page.getByTestId('ss-asg-group-kind').selectOption('PRIMARY');
  await author.page.getByTestId('ss-asg-group-name').fill('Primary verification survey');
  await author.page.getByTestId('ss-asg-group-sequence').fill('1');
  await author.page.getByTestId('ss-asg-group-purpose').fill('The main verification survey of the application');
  await author.page.getByTestId('ss-asg-group-member-M-LIFE').check();
  await author.page.getByTestId('ss-asg-group-propose').click();
  await expect(author.page.getByTestId('ss-asg-group-PRIMARY-E2E')).toHaveAttribute('data-status', 'PROPOSED');
  await expect(author.page.getByTestId('ss-asg-group-approve-PRIMARY-E2E')).toHaveCount(0); // the proposer is offered no decision
  await author.page.screenshot({ path: `${SHOTS}/ASG2A02-primary-group-proposed.png`, fullPage: true });
  await checker.page.goto('/survey-studio/assignment');
  await checker.page.getByTestId('ss-asg-group-approve-PRIMARY-E2E').click();
  await expect(checker.page.getByTestId('ss-asg-group-PRIMARY-E2E')).toHaveAttribute('data-status', 'APPROVED');
  await publisher.page.goto('/survey-studio/assignment');
  await publisher.page.getByTestId('ss-asg-group-publish-PRIMARY-E2E').click();
  await expect(publisher.page.getByTestId('ss-asg-group-PRIMARY-E2E')).toHaveAttribute('data-status', 'PUBLISHED');
  await group('ADD-REPLACEMENT-E2E', 'ADD_REQUIRED', ['M-REPL'], 2, 'The replacement survey, required when the sale replaces an existing policy');
  await group('ADD-CI-E2E', 'ADD_REQUIRED', ['M-CI'], null, 'The critical-illness survey, required when the policy has a CI rider');
  await group('ALT-CLOSING-E2E', 'ALTERNATIVE', ['M-CLOSE-STD', 'M-CLOSE-AGENCY'], 9, 'The closing survey: one of the competing closing surveys');
  await simulator.page.goto('/survey-studio/assignment');
  for (const code of ['PRIMARY-E2E', 'ADD-REPLACEMENT-E2E', 'ADD-CI-E2E', 'ALT-CLOSING-E2E']) await expect(simulator.page.getByTestId(`ss-asg-group-${code}`)).toHaveAttribute('data-status', 'PUBLISHED');

  // ---- 1. a Life application: the primary survey, and the standard closing alternative
  c = await run(life);
  await expect(composite).toHaveAttribute('data-plan', 'READY');
  await expect(composite).toHaveAttribute('data-surveys', '2');
  await expect(simulator.page.getByTestId('ss-asg-req-PRIMARY-E2E')).toHaveAttribute('data-state', 'SELECTED');
  await expect(simulator.page.getByTestId('ss-asg-req-ADD-REPLACEMENT-E2E')).toHaveAttribute('data-state', 'NOT_APPLICABLE');
  await expect(simulator.page.getByTestId('ss-asg-journey-PRIMARY-E2E')).toHaveAttribute('data-version', version.LIFE!);
  await expect(composite).toHaveAttribute('data-fingerprint', c.fingerprint);
  expect(c.composite.selected.map((s: any) => s.survey_code)).toEqual([surveys.LIFE, surveys.STD]);
  await shot(simulator.page, 'ASG2A03-life-primary-survey');

  // ---- 2. a Life replacement: the primary plus the required replacement survey, in the governed order
  c = await run({ ...life, premium_frequency: 'SINGLE' });
  await expect(composite).toHaveAttribute('data-surveys', '3');
  await expect(composite).toHaveAttribute('data-plan', 'READY');
  await expect(composite).toHaveAttribute('data-ordering', 'GOVERNED');
  expect(c.composite.ordering.order).toEqual(['PRIMARY-E2E', 'ADD-REPLACEMENT-E2E', 'ALT-CLOSING-E2E']);
  await expect(simulator.page.getByTestId('ss-asg-journey').locator('ol > li')).toHaveCount(3);
  await expect(simulator.page.getByTestId('ss-asg-journey-ADD-REPLACEMENT-E2E')).toHaveAttribute('data-version', version.REPLACEMENT!);
  await expect(simulator.page.getByTestId('ss-asg-cross-survey')).toContainText('not decided');
  await expect(simulator.page.getByTestId('ss-asg-comp-consistency')).toContainText('not reconciled');
  // every survey is pinned and keeps its own plan: the composite's fingerprints are those of the individual plans
  for (const m of c.members.filter((x: any) => x.state === 'SELECTED')) {
    const plan = await get(simulator, `/api/v1/survey-call-plans/${m.call_plan_id}`);
    expect([plan.version_id, plan.fingerprint, plan.fingerprint_verified]).toEqual([m.survey_version_id, m.plan_fingerprint, true]);
  }
  const replacement = c;
  await shot(simulator.page, 'ASG2A04-life-replacement-primary-plus-required');
  // the same application again: a new record, the same composite fingerprint
  await choose({ premium_frequency: 'ANNUAL' });
  const again = await run({ ...life, premium_frequency: 'SINGLE' });
  expect(again.id).not.toBe(replacement.id);
  expect(again.fingerprint).toBe(replacement.fingerprint);

  // ---- 3. with a CI rider: the CI survey is required too — but its group has no governed position: not ready
  c = await run({ ...life, selling_channel: 'BANCASSURANCE' });
  await expect(simulator.page.getByTestId('ss-asg-req-ADD-CI-E2E')).toHaveAttribute('data-state', 'SELECTED');
  await expect(simulator.page.getByTestId('ss-asg-journey-ADD-CI-E2E')).toHaveAttribute('data-version', version.CI!);
  await expect(composite).toHaveAttribute('data-ordering', 'UNRESOLVED');
  await expect(composite).toHaveAttribute('data-plan', 'UNRESOLVED');
  await expect(simulator.page.getByTestId('ss-asg-order-unresolved')).toContainText('No order is governed');
  expect(c.composite.ordering.order).toBeNull();
  await shot(simulator.page, 'ASG2A05-ci-rider-additional-survey-order-unresolved');

  // ---- 4. two alternatives for the closing survey: the more specific agency rule wins, by the rules' own precedence
  c = await run({ ...life, selling_channel: 'AGENCY' });
  await expect(simulator.page.getByTestId('ss-asg-journey-ALT-CLOSING-E2E')).toHaveAttribute('data-version', version.AGENCY!);
  await simulator.page.getByTestId('ss-asg-req-ALT-CLOSING-E2E').locator('summary').click();
  await expect(simulator.page.getByTestId('ss-asg-req-ALT-CLOSING-E2E-M-CLOSE-AGENCY')).toHaveAttribute('data-selected', 'true');
  await expect(simulator.page.getByTestId('ss-asg-req-ALT-CLOSING-E2E-M-CLOSE-STD')).toHaveAttribute('data-match', 'MATCH');
  await shot(simulator.page, 'ASG2A06-alternative-resolved-by-precedence');

  // ---- 6. a missing input: the requirement that reads it is unresolved — it does not quietly stop applying
  c = await run({ ...life, premium_frequency: '' });
  await expect(simulator.page.getByTestId('ss-asg-req-ADD-REPLACEMENT-E2E')).toHaveAttribute('data-state', 'UNRESOLVED');
  await expect(simulator.page.getByTestId('ss-asg-req-ADD-REPLACEMENT-E2E')).toHaveAttribute('data-outcome', 'INPUT_MISSING');
  await expect(simulator.page.getByTestId('ss-asg-req-PRIMARY-E2E')).toHaveAttribute('data-state', 'SELECTED');
  await expect(composite).toHaveAttribute('data-selection', 'UNRESOLVED_REQUIREMENT');
  await expect(composite).toHaveAttribute('data-plan', 'UNRESOLVED');
  await expect(simulator.page.getByTestId('ss-asg-comp-missing-inputs')).toContainText('premium_frequency');
  await shot(simulator.page, 'ASG2A07-missing-input-requirement-unresolved');

  // ---- a recorded composite opens by its link, as recorded; the single-survey selection is still there beside it
  await simulator.page.goto(`/survey-studio/assignment?composite=${replacement.id}`);
  await expect(composite).toHaveAttribute('data-fingerprint', replacement.fingerprint);
  await expect(composite).toHaveAttribute('data-surveys', '3');
  await simulator.page.getByTestId('ss-asg-evaluate').click();
  await expect(simulator.page.getByTestId('ss-asg-result')).toHaveAttribute('data-selection', 'MATCHED'); // ASG-1: one winner only
  await expect(composite).toHaveCount(0);

  // ---- a person without the assignment-read permission sees none of it
  const reader = await session(browser, 'survey_reader');
  for (const path of [`${A}/groups`, `${A}/composite-plans/${replacement.id}`]) expect((await reader.page.request.get(path)).status(), path).toBe(403);
  expect((await reader.page.request.post(`${A}/composite-plans`, { data: { assignment_inputs: { market: 'SG' }, facts: {} }, headers: await csrf(reader.context) })).status()).toBe(403);
  for (const s of [reader, simulator, author, checker, publisher]) await s.context.close();
});

// ASG-2B — the Simulator's coordinated mode, on the groups, bindings and surveys the journey above published:
// a "Life replacement" application (stand-in conditions) needs three surveys in a governed order. Each is run by its
// own simulation on the server; the screen is compared with what the server recorded. Simulation only.
test('ASG-2B three surveys are simulated as one journey, each by its own run; the coordinator stops where nothing is decided', async ({ browser }) => {
  test.setTimeout(300_000);
  const sim = await session(browser, 'survey_simulator', '/survey-studio/assignment');
  const page = sim.page;
  const composite = page.getByTestId('ss-asg-composite');
  const co = page.getByTestId('ss-co');
  const fullShot = async (name: string) => { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
  const compose = async (inputs: Record<string, string>) => {
    for (const [f, v] of Object.entries(inputs)) await page.getByTestId(`ss-asg-in-${f}`).selectOption(v);
    const before = (await composite.count()) ? await composite.getAttribute('data-composite') : null;
    await page.getByTestId('ss-asg-compose').click();
    await expect(composite).not.toHaveAttribute('data-composite', before ?? 'none');
    return get(sim, `${A}/composite-plans/${await composite.getAttribute('data-composite')}`);
  };
  const state = async () => get(sim, `${A}/coordinated-simulations/${await co.getAttribute('data-coordinated')}`);
  const replacement = { product_family: 'PROTECTION', selling_channel: 'BROKER', premium_frequency: 'SINGLE' };

  // ---- the three states are three separate answers
  let c = await compose(replacement);
  await expect(page.getByTestId('ss-asg-state-plan')).toHaveAttribute('data-status', 'COMPUTABLE');
  await expect(page.getByTestId('ss-asg-state-coordination')).toHaveAttribute('data-status', 'PERMITTED');
  await expect(page.getByTestId('ss-asg-state-eligibility')).toHaveAttribute('data-status', 'NOT_ESTABLISHED');
  await expect(page.getByTestId('ss-asg-state-eligibility')).toContainText('Not established');
  expect(c.states.operational_call_eligibility.status).toBe('NOT_ESTABLISHED');
  expect(c.composite.ordering.order).toEqual(['PRIMARY-E2E', 'ADD-REPLACEMENT-E2E', 'ALT-CLOSING-E2E']);
  await composite.screenshot({ path: `${SHOTS}/ASG2B01-three-separate-states.png` });

  // ---- 2. the coordinator starts the first survey of the governed order, and only that one
  await page.getByTestId('ss-asg-coordinate').click();
  await expect(page).toHaveURL(/\/survey-studio\/coordinated-simulations\//);
  await expect(co).toHaveAttribute('data-status', 'RUNNING');
  await expect(co).toHaveAttribute('data-total', '3');
  await expect(page.getByTestId('ss-co-notice')).toContainText('It is not a call');
  await expect(page.getByTestId('ss-co-notice')).toContainText('operational call eligibility has not been established');
  await expect(page.getByTestId('ss-co-survey-1')).toHaveAttribute('data-state', 'CURRENT');
  for (const n of [2, 3]) { await expect(page.getByTestId(`ss-co-survey-${n}`)).toHaveAttribute('data-state', 'NOT_STARTED'); await expect(page.getByTestId(`ss-co-survey-${n}`)).toHaveAttribute('data-simulation', ''); }
  let s = await state();
  expect(s.record_class).toBe('SIMULATION');
  expect([s.composite_fingerprint, s.application_sha256]).toEqual([c.fingerprint, c.application_sha256]);
  await expect(page.getByTestId('ss-co-question')).toHaveText(s.current.pending.text); // the exact wording is the survey's own
  await fullShot('ASG2B02-coordinated-first-survey');

  // ---- 8, 9. an answer the survey refuses does not advance it, and the next survey is not started
  const firstKey = s.current.pending.key;
  await page.getByTestId('ss-srv-answer').click();
  await expect(page.getByTestId('ss-co-reject')).toHaveAttribute('data-code', 'CHOICE_REQUIRED');
  await expect(page.getByTestId('ss-co-stage')).toHaveAttribute('data-key', firstKey);
  await expect(page.getByTestId('ss-co-survey-2')).toHaveAttribute('data-state', 'NOT_STARTED');
  await fullShot('ASG2B03-refused-answer-stays-on-the-question');

  // ---- 3, 4. the first survey reaches "completed"; only then is the second started
  await page.getByTestId('ss-co-step').click();
  await expect(page.getByTestId('ss-co-stage')).not.toHaveAttribute('data-key', firstKey);
  await expect(page.getByTestId('ss-co-survey-2')).toHaveAttribute('data-state', 'NOT_STARTED'); // one question to go
  await page.getByTestId('ss-co-step').click();
  await expect(page.getByTestId('ss-co-survey-1')).toHaveAttribute('data-state', 'COMPLETED');
  await expect(page.getByTestId('ss-co-survey-2')).toHaveAttribute('data-state', 'CURRENT');
  await expect(page.getByTestId('ss-co-decisions').locator('li[data-decision="PROCEED"]')).toHaveCount(1);
  await expect(page.getByTestId('ss-co-decisions')).toContainText('Simulation rule only');
  await fullShot('ASG2B04-first-survey-completed-second-started');

  // ---- the second survey completes; the third asks for an acknowledgement. 10. a non-answer stops the coordinator
  await page.getByTestId('ss-co-step').click();
  await expect(page.getByTestId('ss-co-survey-2')).toHaveAttribute('data-state', 'COMPLETED');
  await expect(page.getByTestId('ss-co-survey-3')).toHaveAttribute('data-state', 'CURRENT');
  await page.getByTestId('ss-srv-no-ack').click();
  await expect(co).toHaveAttribute('data-status', 'POLICY_UNRESOLVED');
  await expect(page.getByTestId('ss-co-policy')).toContainText('has not been decided');
  await expect(page.getByTestId('ss-co-stop')).toHaveAttribute('data-code', 'POLICY_UNRESOLVED');
  s = await state();
  expect(s.surveys[2].simulation.run.terminal).toBeNull(); // nothing was completed, escalated or closed
  await fullShot('ASG2B05-policy-unresolved-stops-the-coordinator');

  // ---- 5. an acknowledgement is accepted; every survey has reached "completed" — progress, not an outcome
  await page.getByTestId('ss-srv-ack').click();
  await expect(co).toHaveAttribute('data-status', 'ALL_SURVEYS_COMPLETED');
  await expect(co).toHaveAttribute('data-completed', '3');
  await expect(page.getByTestId('ss-co-all-completed')).toContainText('progress, not an outcome');
  await expect(page.getByTestId('ss-co-end')).toContainText('No case, call attempt, finding or disposition was created');
  s = await state();
  expect(s.status).toBe('ALL_SURVEYS_COMPLETED');
  expect(s.decisions.map((d: any) => d.decision)).toEqual(['PROCEED', 'PROCEED']);

  // ---- 6. each survey keeps its own simulation, version, trace and fingerprint; the report merges nothing
  expect(new Set(s.surveys.map((x: any) => x.survey_version_id)).size).toBe(3);
  expect(s.surveys.map((x: any) => x.survey_version_id)).toEqual([version.LIFE, version.REPLACEMENT, version.STD]);
  let delivered = 0;
  for (const x of s.surveys) {
    const own = await get(sim, `/api/v1/survey-simulations/${x.simulation_id}`);
    expect([own.version_id, own.run_sha256, own.record_class, own.replay_consistent]).toEqual([x.survey_version_id, x.run_sha256, 'SIMULATION', true]);
    await expect(page.getByTestId(`ss-co-survey-${x.position}`)).toHaveAttribute('data-simulation', x.simulation_id);
    await page.getByTestId(`ss-co-trace-${x.position}`).locator('summary').click();
    await expect(page.getByTestId(`ss-co-trace-${x.position}`).getByTestId('ss-srv-trace').locator('li')).toHaveCount(own.run.events.length);
    delivered += own.run.delivered.length;
  }
  await expect(page.getByTestId('ss-co-report').locator('tbody tr')).toHaveCount(delivered + s.progress.refused_inputs);
  expect(s.progress.refused_inputs).toBe(2); // the empty answer and the non-acknowledgement, both kept as refused
  await fullShot('ASG2B06-all-three-surveys-completed-with-evidence');

  // ---- 7. the same inputs in a new coordinated simulation give the identical coordinated result
  await page.getByTestId('ss-co-replay-go').click();
  await expect(page.getByTestId('ss-co-replay')).toHaveAttribute('data-identical', 'true', { timeout: 60_000 });
  await page.getByTestId('ss-co-replay').screenshot({ path: `${SHOTS}/ASG2B07-replay-identical.png` });

  // ---- 17. a survey's own simulation opens in the existing single-survey Simulator, unchanged
  await page.getByTestId('ss-co-open-sim-1').click();
  await expect(page.getByTestId('ss-srv')).toHaveAttribute('data-simulation', s.surveys[0].simulation_id);
  await expect(page.getByTestId('ss-srv-end')).toHaveAttribute('data-terminal', 'COMPLETED');

  // ---- 11. a survey that ends without "completed": the coordinator stops, and starts nothing
  await page.goto(`/survey-studio/assignment?composite=${c.id}`);
  await page.getByTestId('ss-asg-coordinate').click();
  await expect(co).toHaveAttribute('data-status', 'RUNNING');
  await page.getByTestId('ss-srv-opt-NO').check();
  await page.getByTestId('ss-srv-answer').click();
  await expect(co).toHaveAttribute('data-status', 'CROSS_SURVEY_POLICY_UNRESOLVED');
  await expect(page.getByTestId('ss-co-stop')).toHaveAttribute('data-code', 'CROSS_SURVEY_POLICY_UNRESOLVED');
  await expect(page.getByTestId('ss-co-stop')).toContainText('has not been decided');
  await expect(page.getByTestId('ss-co-survey-1')).toHaveAttribute('data-state', 'STOPPED');
  for (const n of [2, 3]) await expect(page.getByTestId(`ss-co-survey-${n}`)).toHaveAttribute('data-state', 'NOT_STARTED');
  const stopped = await state();
  expect(stopped.surveys[0].simulation.run.terminal.state).toBe('ENDED_WITH_OUTCOME');
  expect(stopped.decisions).toEqual([{ after: 'PRIMARY-E2E', ending: 'ENDED_WITH_OUTCOME', decision: 'STOP', rule: 'CROSS_SURVEY_POLICY_UNRESOLVED', to: null }]);
  await fullShot('ASG2B08-non-completed-ending-stops-without-continuation');

  // ---- 13. no governed order: a coordinated simulation is blocked, and the screen says so beside a computable... nothing
  await page.goto('/survey-studio/assignment');
  c = await compose({ product_family: 'PROTECTION', selling_channel: 'BANCASSURANCE', premium_frequency: 'ANNUAL' });
  await expect(page.getByTestId('ss-asg-state-coordination')).toHaveAttribute('data-status', 'BLOCKED');
  await expect(page.getByTestId('ss-asg-state-coordination').locator('[data-code="ORDER_UNRESOLVED"]')).toBeVisible();
  await expect(page.getByTestId('ss-asg-state-eligibility')).toHaveAttribute('data-status', 'NOT_ESTABLISHED');
  await expect(page.getByTestId('ss-asg-coordinate')).toHaveCount(0);
  const refusedStart = await page.request.post(`${A}/composite-plans/${c.id}/coordinated-simulations`, { data: {}, headers: await csrf(sim.context) });
  expect([refusedStart.status(), (await refusedStart.json()).code]).toEqual([409, 'ORDER_UNRESOLVED']);
  await composite.screenshot({ path: `${SHOTS}/ASG2B09-coordination-blocked-order-unresolved.png` });

  // ---- 15. a survey reader can do none of it
  const reader = await session(browser, 'survey_reader');
  expect((await reader.page.request.get(`${A}/coordinated-simulations/${s.id}`)).status()).toBe(403);
  expect((await reader.page.request.post(`${A}/composite-plans/${c.id}/coordinated-simulations`, { data: {}, headers: await csrf(reader.context) })).status()).toBe(403);
  await reader.context.close();
  await sim.context.close();
});

