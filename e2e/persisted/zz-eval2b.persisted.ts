import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// (Named to run after zz-eval2a: it verifies the execution of the journeys recorded there.)
// EVAL-2B — execution assurance, full stack, inside the Evaluation Workbench:
//   * the coordinated journey of EVAL-2A (two surveys sharing one question, answered 20 and 30) is verified survey by
//     survey and as a journey; the conflict found by the control evaluation stays as it was found, beside two
//     VERIFIED executions;
//   * a single-survey journey with a refused answer and a non-completed ending: the refusal and the ending are
//     recorded as they happened, and neither is a fault in the execution;
//   * an unfinished journey: assurance is incomplete, not failed;
//   * expected-versus-recorded drill-down, exact pinned wording, branches, and the link to the simulation trace.
// The authoritative executor cannot produce a deviation, so none is shown here: tampered recordings are tested in
// the backend, where they are made and named as such. Simulation only.
const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = 'test-results/persisted/shots';
const ORIGIN = 'http://127.0.0.1:5174';
const E = '/api/v1/survey-evaluation';
type Who = 'survey_simulator' | 'survey_reader';
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

test.use({ actionTimeout: 20_000 });

test('EVAL-2B the recorded execution of a journey is verified, with expected-versus-recorded drill-down', async ({ browser }) => {
  test.setTimeout(420_000);
  const sim = await session(browser, 'survey_simulator', '/survey-studio');
  const page = sim.page;
  const ev = page.getByTestId('ss-ev');
  const ea = page.getByTestId('ss-ea');
  const assuranceOf = async () => get(sim, `${E}/assurance/${await ea.getAttribute('data-assurance')}`);

  // ---- the coordinated conflict journey recorded by the EVAL-2A journey, and its evaluation under the policy
  const journey = (await get(sim, `${E}/journeys`)).items.find((j: any) => j.kind === 'COORDINATED' && j.label === 'EVAL-2A conflict journey');
  const evaluation = (await get(sim, `${E}/evaluations?coordinated_simulation_id=${journey.id}`)).items.filter((e: any) => e.policy).pop();
  const before = await get(sim, `${E}/evaluations/${evaluation.id}`);
  await page.goto(`/survey-studio/evaluations/${evaluation.id}`);
  await expect(ev).toHaveAttribute('data-evaluation', evaluation.id);
  // four statements, side by side; the execution has not been checked yet, and that is said
  await expect(ea).toHaveAttribute('data-status', 'NOT_CHECKED');
  await expect(page.getByTestId('ss-ea-side').locator('div')).toHaveCount(4);
  await expect(page.getByTestId('ss-ea-status')).toHaveText('Not checked yet');
  await expect(page.getByTestId('ss-ea-side')).toContainText('Not established');
  await page.getByTestId('ss-ea-run').click();
  await expect(ea).toHaveAttribute('data-status', 'VERIFIED');
  const a = await assuranceOf();
  expect([a.record_class, a.status, a.journey_kind, a.evaluation_id, a.operational_call_eligibility.status]).toEqual(['SIMULATION', 'VERIFIED', 'COORDINATED', evaluation.id, 'NOT_ESTABLISHED']);
  expect(a.surveys.map((s: any) => s.status)).toEqual(a.surveys.map(() => 'VERIFIED'));
  expect(a.journey_checks.map((c: any) => c.status)).toEqual(['PASSED', 'PASSED', 'PASSED', 'PASSED', 'PASSED']);
  expect(a.findings).toEqual([]);
  // the screen says what the server recorded, and what VERIFIED does not mean
  await expect(page.getByTestId('ss-ea-status')).toHaveText('Verified');
  await expect(page.getByTestId('ss-ea-means')).toContainText('not a compliance outcome and does not make a call eligible');
  await expect(ea).toContainText('It does not show that a person heard any wording');
  await expect(ea).toHaveAttribute('data-findings', '0');
  for (const s of a.surveys) { await expect(page.getByTestId(`ss-ea-survey-${s.position}`)).toHaveAttribute('data-status', s.status); await expect(page.getByTestId(`ss-ea-survey-${s.position}`)).toHaveAttribute('data-simulation', s.simulation_id); }
  for (const c of a.journey_checks) await expect(page.getByTestId('ss-ea-journey').locator(`li[data-check="${c.check}"]`)).toHaveAttribute('data-status', 'PASSED');
  // evaluation, coverage, assurance and eligibility are four different answers for the same journey
  await expect(ev).toHaveAttribute('data-processing', 'REQUIRES_REVIEW');
  await expect(ev).toHaveAttribute('data-coverage', 'INCOMPLETE');
  await page.screenshot({ path: `${SHOTS}/EVAL2B01-assurance-beside-evaluation-coverage-and-eligibility.png`, fullPage: true });

  // ---- drill-down: expected versus recorded for the survey that reuses the shared question
  const shared = a.surveys.find((s: any) => s.deliveries.some((d: any) => d.placement === 'mi-shared/n1'));
  const row = page.getByTestId(`ss-ea-survey-${shared.position}`);
  await row.locator('summary').first().click();
  await expect(page.getByTestId(`ss-ea-checks-${shared.position}`).locator('li')).toHaveCount(8);
  await expect(page.getByTestId(`ss-ea-checks-${shared.position}`).locator('li[data-status="PASSED"]')).toHaveCount(8);
  await page.getByTestId(`ss-ea-expected-${shared.position}`).locator('summary').click();
  const delivered = page.getByTestId(`ss-ea-expected-${shared.position}`).locator('tbody tr[data-wording]');
  await expect(delivered).toHaveCount(shared.deliveries.length);
  for (const d of shared.deliveries) { await expect(page.getByTestId(`ss-ea-expected-${shared.position}`).locator(`tr[data-placement="${d.placement}"]`)).toHaveAttribute('data-wording', 'EXACT'); await expect(page.getByTestId(`ss-ea-expected-${shared.position}`).locator(`tr[data-placement="${d.placement}"]`)).toContainText(d.recorded_text); }
  await page.getByTestId(`ss-ea-branches-${shared.position}`).locator('summary').click();
  await expect(page.getByTestId(`ss-ea-branches-${shared.position}`).locator('li')).toHaveCount(shared.branches.length + shared.rejections.length);
  await row.screenshot({ path: `${SHOTS}/EVAL2B02-expected-versus-recorded-exact-wording-and-branches.png` });

  // ---- the conflict the control evaluation found is unchanged, and it rests on two VERIFIED executions
  const term = a.control_evidence.find((c: any) => c.control_code === 'SYN-CTRL-01' && c.obligation === 'TERM');
  expect([term.outcome, term.coverage, term.execution_evidence, term.result_is_trustworthy]).toEqual(['REQUIRES_REVIEW', 'EVIDENCE_CONFLICTING', 'EXECUTION_VERIFIED', true]);
  expect(term.evidence.map((x: any) => [x.result, x.delivery, x.execution])).toEqual([['MATCH', 'EXACT', 'EXECUTION_VERIFIED'], ['MISMATCH', 'EXACT', 'EXECUTION_VERIFIED']]);
  const control = page.getByTestId('ss-ev-control-SYN-CTRL-01-TERM');
  await expect(control).toHaveAttribute('data-outcome', 'REQUIRES_REVIEW'); // not recalculated
  await control.locator('summary').first().click();
  await expect(page.getByTestId('ss-ev-trust-SYN-CTRL-01-TERM')).toHaveAttribute('data-execution', 'EXECUTION_VERIFIED');
  await expect(page.getByTestId('ss-ev-trust-SYN-CTRL-01-TERM')).toHaveAttribute('data-trustworthy', 'true');
  // a control whose question is in no survey of the journey: there is no execution to verify — a coverage matter
  await page.getByTestId('ss-ev-control-SYN-CTRL-04-IDENTITY').locator('summary').first().click();
  await expect(page.getByTestId('ss-ev-trust-SYN-CTRL-04-IDENTITY')).toHaveAttribute('data-execution', 'NO_EXECUTION_EVIDENCE');
  expect((await get(sim, `${E}/evaluations/${evaluation.id}`)).result_sha256).toBe(before.result_sha256); // the evaluation was not touched
  await control.screenshot({ path: `${SHOTS}/EVAL2B03-conflict-unchanged-beside-verified-executions.png` });
  // checking again with nothing changed is the same result; no new record
  const count = (await get(sim, `${E}/assurance?coordinated_simulation_id=${journey.id}`)).items.length;
  await page.getByTestId('ss-ea-again').click();
  await expect(ea).toHaveAttribute('data-assurance', a.id);
  expect((await get(sim, `${E}/assurance?coordinated_simulation_id=${journey.id}`)).items.length).toBe(count);

  // ---- a refused answer and a non-completed ending: recorded as they happened, and not a fault in the execution
  const survey = (await get(sim, '/api/v1/survey-definitions')).items.find((x: any) => x.name === 'Policy replacement survey');
  const version = (await get(sim, `/api/v1/survey-definitions/${survey.id}/history`)).versions.find((v: any) => v.status === 'PUBLISHED').id;
  const facts = { 'policy.annual_premium': 3000, 'policy.is_replacement': false, 'customer.age_years': 40 };
  let s = await post(sim, `/api/v1/survey-versions/${version}/simulations`, { facts, label: 'EVAL-2B refused then declined' });
  const unfinished = await post(sim, `/api/v1/survey-versions/${version}/simulations`, { facts, label: 'EVAL-2B unfinished' });
  s = await post(sim, `/api/v1/survey-simulations/${s.id}/inputs`, { expected_inputs: 0, key: 'mi-opening/n2', answer: {} });
  s = await post(sim, `/api/v1/survey-simulations/${s.id}/inputs`, { expected_inputs: 1, key: 'mi-opening/n2', answer: { choice: 'NO' } });
  expect(s.run.terminal.state).toBe('ENDED_WITH_OUTCOME');
  const e2 = await post(sim, `${E}/evaluations`, { simulation_id: s.id });
  await page.goto(`/survey-studio/evaluations/${e2.id}`);
  await page.getByTestId('ss-ea-run').click();
  await expect(ea).toHaveAttribute('data-status', 'VERIFIED');
  const a2 = await assuranceOf();
  expect([a2.surveys[0].ending.state, a2.surveys[0].ending.completed, a2.surveys[0].rejections.map((r: any) => r.code), a2.summary.surveys_ended_without_completed]).toEqual(['ENDED_WITH_OUTCOME', false, ['CHOICE_REQUIRED'], 1]);
  await page.getByTestId('ss-ea-survey-1').locator('summary').first().click();
  await expect(page.getByTestId('ss-ea-ending-1')).toContainText('It is not a fault in the execution');
  await page.getByTestId('ss-ea-branches-1').locator('summary').click();
  await expect(page.getByTestId('ss-ea-branches-1').locator('li[data-code="CHOICE_REQUIRED"]')).toContainText('It was not recorded as an answer');
  await page.getByTestId('ss-ea-expected-1').locator('summary').click();
  await expect(page.getByTestId('ss-ea-expected-1').locator('tr[data-class="SURVEY_ENDED_BEFORE"]')).toHaveCount(a2.surveys[0].exclusions.length);
  await expect(page.getByTestId('ss-ea-expected-1').locator('tr[data-class="OMISSION"]')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/EVAL2B04-refused-answer-and-non-completed-ending-preserved.png`, fullPage: true });
  // the link from the assurance result to the survey's own simulation trace
  await page.getByTestId('ss-ea-survey-1').locator('details.ss-cb-tech summary', { hasText: 'Technical details' }).click();
  await page.getByTestId('ss-ea-trace-1').click();
  await expect(page).toHaveURL(new RegExp(`simulation=${s.id}`));
  await expect(page.getByTestId('ss-srv-trace')).toBeVisible();

  // ---- an unfinished journey: assurance is INCOMPLETE — not failed, and not verified
  const e3 = await post(sim, `${E}/evaluations`, { simulation_id: unfinished.id });
  await page.goto(`/survey-studio/evaluations/${e3.id}`);
  await page.getByTestId('ss-ea-run').click();
  await expect(ea).toHaveAttribute('data-status', 'INCOMPLETE');
  await expect(page.getByTestId('ss-ea-status')).toHaveText('Incomplete');
  await page.getByTestId('ss-ea-survey-1').locator('summary').first().click();
  await expect(page.getByTestId('ss-ea-checks-1').locator('li[data-check="TERMINATION"]')).toHaveAttribute('data-status', 'INCOMPLETE');
  await page.getByTestId('ss-ea').screenshot({ path: `${SHOTS}/EVAL2B05-unfinished-journey-assurance-incomplete.png` });

  // ---- security: a reader of surveys cannot read or request an assurance result
  const reader = await session(browser, 'survey_reader', '/survey-studio');
  expect((await reader.page.request.get(`${E}/assurance/${a.id}`)).status()).toBe(403);
  expect((await reader.page.request.post(`${E}/assurance`, { data: { simulation_id: s.id }, headers: await csrf(reader.context) })).status()).toBe(403);
  await reader.context.close();
  await sim.context.close();
});
