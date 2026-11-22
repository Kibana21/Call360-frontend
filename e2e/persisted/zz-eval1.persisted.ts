import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// (Named to run after zz-asg2a: it evaluates a coordinated journey of the surveys, rules and groups published there.)
// EVAL-1 — journey-level control evaluation, full stack: governed control mappings proposed, approved and published
// by three people through the API; a three-survey coordinated simulation run in the browser; ONE evaluation of the
// journey opened in the Evaluation Workbench; drill-down from a control to the answers and events that support it.
// What the screen shows is compared with the evaluation the server recorded. Simulation only.
//
// The mappings, the finding rules and their severities are TEST FIXTURES on the seeded synthetic control register.
// They are not business policy, and the application's "replacement" condition is the ASG-2A stand-in.
const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../../../Call360-backend');
const SHOTS = 'test-results/persisted/shots';
const ORIGIN = 'http://127.0.0.1:5174';
const A = '/api/v1/survey-assignment';
const E = '/api/v1/survey-evaluation';
type Who = 'survey_author' | 'survey_checker' | 'survey_publisher' | 'survey_simulator' | 'survey_reader';
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
const NAMES = { LIFE: 'Life verification survey', REPLACEMENT: 'Policy replacement survey', STD: 'Closing survey (standard)' };

test.use({ actionTimeout: 20_000 });

test('EVAL-1 a coordinated journey is evaluated control by control, with drill-down to the evidence', async ({ browser }) => {
  test.setTimeout(420_000);
  // ---- what has no Survey Studio screen: a published finding rule set (existing lifecycle) and the item identities
  const setup = JSON.parse(execFileSync('uv', ['run', 'python', 'scripts/e2e_eval_setup.py', ...Object.values(NAMES)], { cwd: backend, env: { ...process.env, CALL360_ENV_FILE: '.env.test' } }).toString().trim().split('\n').pop()!);
  const items = (k: keyof typeof NAMES) => setup.surveys[NAMES[k]].items as Record<string, { code: string; version: number }>;
  const life = items('LIFE'), repl = items('REPLACEMENT'), closing = items('STD');

  // ---- governed mappings, each by three different people. One control takes evidence from TWO surveys.
  const author = await session(browser, 'survey_author', '/survey-studio');
  const checker = await session(browser, 'survey_checker', '/survey-studio');
  const publisher = await session(browser, 'survey_publisher', '/survey-studio');
  const answer = (item: unknown, rule: unknown) => ({ item, evidence_type: 'ANSWER', required: true, survey_code: null, rule });
  const yes = { method: 'EXACT_BOOLEAN', expected_boolean: true };
  const mappings: Array<[string, unknown[]]> = [
    ['SYN-CTRL-01', [answer(life['mi-call/n2'], yes), answer(closing['mi-ack/n2'], { method: 'ACKNOWLEDGEMENT' })]],
    ['SYN-CTRL-02', [answer(life['mi-call/n5'], { method: 'EXACT_BOOLEAN', expected_boolean: false })]],
    ['SYN-CTRL-03', [answer(repl['mi-senior/n1'], { method: 'ACKNOWLEDGEMENT' })]],
  ];
  for (const [control_code, entries] of mappings) {
    const m = await post(author, `${E}/mappings`, { market_code: 'SG', control_code, combination: 'ALL_REQUIRED', applicability: null, entries, source: 'Synthetic mapping for the EVAL-1 browser journey' });
    const self = await author.page.request.post(`${E}/mappings/${m.id}/decision`, { data: { verdict: 'APPROVE' }, headers: await csrf(author.context) });
    expect(self.status()).toBe(403); // the proposer holds no approval permission, and could not approve their own anyway
    await post(checker, `${E}/mappings/${m.id}/decision`, { verdict: 'APPROVE' });
    expect((await post(publisher, `${E}/mappings/${m.id}/publish`)).status).toBe('PUBLISHED');
  }
  const register = await get(author, `${E}/controls`);
  expect(register.items.map((c: any) => [c.control_code, c.published.length])).toEqual([['SYN-CTRL-01', 1], ['SYN-CTRL-02', 1], ['SYN-CTRL-03', 1], ['SYN-CTRL-04', 0], ['SYN-CTRL-05', 0]]);
  await author.context.close(); await checker.context.close(); await publisher.context.close();

  // ---- the journey: three surveys, one after another, each by its own simulation
  const sim = await session(browser, 'survey_simulator', '/survey-studio/assignment');
  const page = sim.page;
  const co = page.getByTestId('ss-co');
  const ev = page.getByTestId('ss-ev');
  const fullShot = async (name: string) => { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
  for (const [f, v] of Object.entries({ product_family: 'PROTECTION', selling_channel: 'BROKER', premium_frequency: 'SINGLE' })) await page.getByTestId(`ss-asg-in-${f}`).selectOption(v);
  await page.getByTestId('ss-asg-compose').click();
  await page.getByTestId('ss-asg-coordinate').click();
  await expect(co).toHaveAttribute('data-status', 'RUNNING');
  const coordinatedId = (await co.getAttribute('data-coordinated'))!;

  // ---- an unfinished journey can be evaluated: nothing that is missing is read as satisfied
  await expect(page.getByTestId('ss-ev-entry')).toHaveAttribute('data-count', '0');
  await page.getByTestId('ss-ev-evaluate').click();
  await expect(page).toHaveURL(/\/survey-studio\/evaluations\//);
  await expect(ev).toHaveAttribute('data-kind', 'COORDINATED');
  await expect(ev).toHaveAttribute('data-processing', 'INCOMPLETE');
  let recorded = await get(sim, `${E}/evaluations/${await ev.getAttribute('data-evaluation')}`);
  expect(recorded.record_class).toBe('SIMULATION');
  expect(recorded.journey.complete).toBe(false);
  expect(recorded.summary.by_outcome.SATISFIED).toBe(0);
  await expect(page.getByTestId('ss-ev-control-SYN-CTRL-01')).toHaveAttribute('data-outcome', 'INSUFFICIENT_EVIDENCE');
  await expect(page.getByTestId('ss-ev-survey-2')).toHaveAttribute('data-simulation', ''); // not started: its evidence does not exist
  const early = recorded.id;
  await fullShot('EVAL01-unfinished-journey-nothing-is-assumed');

  // ---- complete the journey: K1 (yes, yes), K8 (identity confirmed), K4 (acknowledged)
  await page.getByTestId('ss-ev-back').click();
  await expect(co).toHaveAttribute('data-status', 'RUNNING');
  await page.getByTestId('ss-co-step').click();
  await expect(page.getByTestId('ss-co-stage')).toHaveAttribute('data-key', 'mi-call/n5');
  await page.getByTestId('ss-co-step').click();
  await expect(page.getByTestId('ss-co-survey-2')).toHaveAttribute('data-state', 'CURRENT');
  await page.getByTestId('ss-co-step').click();
  await expect(page.getByTestId('ss-co-survey-3')).toHaveAttribute('data-state', 'CURRENT');
  await page.getByTestId('ss-srv-ack').click();
  await expect(co).toHaveAttribute('data-status', 'ALL_SURVEYS_COMPLETED');
  const journey = await get(sim, `${A}/coordinated-simulations/${coordinatedId}`);

  // ---- ONE journey-level evaluation of three completed surveys
  await expect(page.getByTestId('ss-ev-entry')).toHaveAttribute('data-count', '1');
  await page.getByTestId('ss-ev-evaluate').click();
  await expect(page).toHaveURL(/\/survey-studio\/evaluations\//);
  await expect(ev).not.toHaveAttribute('data-evaluation', early);
  recorded = await get(sim, `${E}/evaluations/${await ev.getAttribute('data-evaluation')}`);
  expect([recorded.journey_kind, recorded.coordinated_id, recorded.journey.complete]).toEqual(['COORDINATED', coordinatedId, true]);
  expect(recorded.journey.executions.map((x: any) => [x.simulation_id, x.run_sha256, x.ending])).toEqual(journey.surveys.map((s: any) => [s.simulation_id, s.run_sha256, 'COMPLETED']));
  expect(recorded.pins.journey.replay_sha256).toBe(journey.replay_sha256);
  const outcome = Object.fromEntries(recorded.controls.map((c: any) => [c.control_code, c.outcome]));
  // every survey completed — and one control is satisfied, one is not, one lacks its evidence, two have no mapping
  expect(outcome).toEqual({ 'SYN-CTRL-01': 'SATISFIED', 'SYN-CTRL-02': 'NOT_SATISFIED', 'SYN-CTRL-03': 'INSUFFICIENT_EVIDENCE', 'SYN-CTRL-04': 'UNRESOLVED', 'SYN-CTRL-05': 'UNRESOLVED' });
  expect(recorded.processing_status).toBe('INCOMPLETE'); // completed surveys are not a completed evaluation
  expect(recorded.coverage.status).toBe('NOT_ASSERTED');

  // the screen says what the server recorded, and keeps the three statuses apart
  await expect(ev).toHaveAttribute('data-result', recorded.result_sha256);
  await expect(page.getByTestId('ss-ev-status')).toHaveText(/Evaluation incomplete/);
  await expect(page.getByTestId('ss-ev-summary')).toContainText('3 of 3 surveys completed');
  await expect(page.getByTestId('ss-ev-notice')).toContainText('no model judges anything');
  await expect(page.getByTestId('ss-ev-notice')).toContainText('A match is not a compliance pass');
  await expect(page.getByTestId('ss-ev-coverage')).toContainText('Complete coverage is not asserted');
  for (const [o, n] of Object.entries(recorded.summary.by_outcome)) await expect(page.locator(`[data-testid="ss-ev-counts"] li[data-outcome="${o}"]`)).toHaveAttribute('data-count', String(n));
  await expect(page.getByTestId('ss-ev-count-applicable')).toContainText(`${recorded.summary.applicable}`);
  for (const c of recorded.controls) await expect(page.getByTestId(`ss-ev-control-${c.control_code}`)).toHaveAttribute('data-outcome', c.outcome);
  for (const n of [1, 2, 3]) await expect(page.getByTestId(`ss-ev-survey-${n}`)).toHaveAttribute('data-simulation', journey.surveys[n - 1].simulation_id);
  await expect(page.getByTestId('ss-ev-class')).toHaveText('Simulation');
  await expect(page.getByTestId('ss-ev-consistent')).toHaveAttribute('data-consistent', 'true');
  await expect(page.getByTestId('ss-ev-rule-set')).toContainText(setup.finding_rule_set.label);
  await expect(page.getByTestId('ss-ev-history').locator('li')).toHaveCount(2);
  await fullShot('EVAL02-journey-evaluation-summary');

  // ---- drill-down: one control, evidence from two different surveys, each with its exact wording and answer
  const one = page.getByTestId('ss-ev-control-SYN-CTRL-01');
  await one.locator('summary').first().click();
  const rows = page.getByTestId('ss-ev-evidence-SYN-CTRL-01').locator('tbody tr');
  await expect(rows).toHaveCount(2);
  const c1 = recorded.controls.find((c: any) => c.control_code === 'SYN-CTRL-01');
  expect(c1.observations.map((o: any) => [o.survey.position, o.simulation_id, o.result])).toEqual([[1, journey.surveys[0].simulation_id, 'MATCH'], [3, journey.surveys[2].simulation_id, 'MATCH']]);
  await expect(rows.nth(0)).toHaveAttribute('data-survey', '1');
  await expect(rows.nth(1)).toHaveAttribute('data-survey', '3');
  for (const [i, o] of c1.observations.entries()) { await expect(rows.nth(i)).toContainText(o.wording.text); await expect(rows.nth(i)).toContainText(`${o.item.code} v${o.item.version}`); await expect(rows.nth(i)).toContainText(o.evaluation.rule_text); }
  await expect(page.getByTestId('ss-ev-mapping-SYN-CTRL-01')).toContainText(`revision ${c1.mapping.revision}`);
  await one.screenshot({ path: `${SHOTS}/EVAL03-one-control-evidence-from-two-surveys.png` });

  // ---- a control that is NOT satisfied although its survey completed, with its finding from the existing rules
  const two = page.getByTestId('ss-ev-control-SYN-CTRL-02');
  await two.locator('summary').first().click();
  await expect(page.getByTestId('ss-ev-evidence-SYN-CTRL-02').locator('tbody tr')).toHaveAttribute('data-result', 'MISMATCH');
  const f2 = recorded.findings.find((f: any) => f.control_code === 'SYN-CTRL-02');
  expect([f2.rule.rule_code, f2.rule.rule_set.version_id, f2.simulation_id, f2.placement]).toEqual(['FR-E2E-MISMATCH', setup.finding_rule_set.version_id, journey.surveys[0].simulation_id, 'mi-call/n5']);
  const card = two.getByTestId('ss-ev-finding');
  await expect(card).toHaveAttribute('data-rule', 'FR-E2E-MISMATCH');
  await expect(card).toContainText(f2.explanation);
  await expect(card).toContainText(f2.severity_source);
  await two.screenshot({ path: `${SHOTS}/EVAL04-not-satisfied-with-evidence-linked-finding.png` });

  // ---- missing evidence is visible as a gap: the survey's own condition left the module out for this application.
  //      That does not make the control unnecessary — it is insufficient evidence, and it is not a finding either
  const three = page.getByTestId('ss-ev-control-SYN-CTRL-03');
  await three.locator('summary').first().click();
  const c3 = recorded.controls.find((c: any) => c.control_code === 'SYN-CTRL-03');
  expect([c3.observations[0].result, c3.observations[0].gap, c3.applicability.status]).toEqual(['NOT_APPLICABLE', 'MODULE_EXCLUDED_BY_CONDITION', 'APPLICABLE']);
  await expect(page.getByTestId('ss-ev-evidence-SYN-CTRL-03').locator('tbody tr')).toHaveAttribute('data-gap', c3.observations[0].gap);
  await expect(page.getByTestId('ss-ev-evidence-SYN-CTRL-03').locator('[data-testid="ss-ev-gap"]')).toContainText('own condition left this module out');
  await expect(three.getByTestId('ss-ev-finding')).toHaveCount(0);
  // … and a control nobody mapped is a stated configuration gap
  await page.getByTestId('ss-ev-control-SYN-CTRL-05').locator('summary').first().click();
  await expect(page.getByTestId('ss-ev-mapping-SYN-CTRL-05')).toContainText('none published');
  await expect(page.getByTestId('ss-ev-reasons-SYN-CTRL-05').locator('li')).toHaveAttribute('data-code', 'MAPPING_MISSING');
  await expect(page.getByTestId('ss-ev-gap-controls')).toHaveText('SYN-CTRL-04, SYN-CTRL-05');
  await expect(page.getByTestId('ss-ev-gap-items')).toHaveText(String(recorded.coverage.items_without_mapping.length));
  await expect(page.getByTestId('ss-ev-findings')).toHaveAttribute('data-count', String(recorded.findings.length));
  expect(recorded.findings.length).toBe(1);
  await fullShot('EVAL05-gaps-and-findings');

  // ---- filters: by control outcome, by the survey the evidence comes from, by findings
  await page.getByTestId('ss-ev-filter-outcome').selectOption('NOT_SATISFIED');
  await expect(page.getByTestId('ss-ev-shown')).toHaveText('1');
  await expect(page.getByTestId('ss-ev-controls').locator('> li')).toHaveAttribute('data-testid', 'ss-ev-control-SYN-CTRL-02');
  await page.getByTestId('ss-ev-filter-outcome').selectOption('');
  await page.getByTestId('ss-ev-filter-survey').selectOption({ index: 3 }); // the third survey: a filter, not the subject
  await expect(page.getByTestId('ss-ev-shown')).toHaveText('1');
  await expect(page.getByTestId('ss-ev-evidence-SYN-CTRL-01').locator('tbody tr')).toHaveCount(1);
  await page.getByTestId('ss-ev-filter-survey').selectOption('');
  await page.getByTestId('ss-ev-filter-finding').selectOption('WITH');
  await expect(page.getByTestId('ss-ev-shown')).toHaveText('1');
  await page.getByTestId('ss-ev-filter-finding').selectOption('WITHOUT');
  await expect(page.getByTestId('ss-ev-shown')).toHaveText('4');
  await page.getByTestId('ss-ev-filter-outcome').selectOption('NOT_SATISFIED');
  await expect(page.getByTestId('ss-ev-none')).toBeVisible();
  await page.getByTestId('ss-ev-filter-outcome').selectOption(''); await page.getByTestId('ss-ev-filter-finding').selectOption('');

  // ---- evaluating again with nothing changed is the SAME evaluation; no new record
  const before = (await get(sim, `${E}/evaluations?coordinated_simulation_id=${coordinatedId}`)).items.length;
  await page.getByTestId('ss-ev-again').click();
  await expect(ev).toHaveAttribute('data-evaluation', recorded.id);
  expect((await get(sim, `${E}/evaluations?coordinated_simulation_id=${coordinatedId}`)).items.length).toBe(before);

  // ---- a single survey is the same model with one execution: the other survey's evidence does not exist there
  await page.getByTestId('ss-ev-survey-1').getByRole('link', { name: 'its own simulation' }).click();
  await expect(page.getByTestId('ss-srv-evaluation')).toBeVisible();
  await page.getByTestId('ss-ev-evaluate').click();
  await expect(ev).toHaveAttribute('data-kind', 'SINGLE_SURVEY');
  const single = await get(sim, `${E}/evaluations/${await ev.getAttribute('data-evaluation')}`);
  expect([single.simulation_id, single.journey.executions.length]).toEqual([journey.surveys[0].simulation_id, 1]);
  await expect(page.getByTestId('ss-ev-control-SYN-CTRL-01')).toHaveAttribute('data-outcome', 'INSUFFICIENT_EVIDENCE');
  await page.getByTestId('ss-ev-control-SYN-CTRL-01').locator('summary').first().click();
  await expect(page.getByTestId('ss-ev-evidence-SYN-CTRL-01').locator('tbody tr').nth(1)).toHaveAttribute('data-gap', 'ITEM_NOT_IN_JOURNEY');
  await fullShot('EVAL06-single-survey-journey-same-model');

  // ---- security: a reader of surveys cannot read an evaluation, and the screen says so without an error
  const reader = await session(browser, 'survey_reader', `/survey-studio/evaluations/${recorded.id}`);
  await expect(reader.page.getByTestId('ss-ev-not-permitted')).toBeVisible();
  expect((await reader.page.request.get(`${E}/evaluations/${recorded.id}`)).status()).toBe(403);
  expect((await reader.page.request.post(`${E}/evaluations`, { data: { coordinated_simulation_id: coordinatedId }, headers: await csrf(reader.context) })).status()).toBe(403);
  await reader.context.close();
  await sim.context.close();
});
