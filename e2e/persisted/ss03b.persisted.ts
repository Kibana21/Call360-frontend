import { expect, test, type Browser, type BrowserContext, type Page, type Response } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// SS-03B.3 — the persisted Simulator and Call plan on REAL Python execution, full stack: Chromium → Vite → FastAPI →
// PostgreSQL (isolated test schema), with the simulation setting on. A golden fixture is published by three people
// through the real service; a person holding `survey.simulate` then simulates the published version (a person who can
// only READ surveys cannot). Every assertion
// about what the screen shows is checked against what the server itself returned — the screen decides nothing.
// Simulation only: nothing here is, starts or authorises a call. Synthetic content only.
const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../../../Call360-backend');
const SHOTS = 'test-results/persisted/shots';
const ORIGIN = 'http://127.0.0.1:5174';
type Who = 'survey_author' | 'survey_reader' | 'survey_simulator' | 'survey_simelsewhere' | 'user';
const account = (who: Who): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'))[who];
const shot = async (page: Page, name: string, full = false) => { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };

/* eslint-disable @typescript-eslint/no-explicit-any */
type S = { context: BrowserContext; page: Page };
async function session(browser: Browser, who: Who, path = '/'): Promise<S> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, account(who), path);
  return { context, page };
}
const csrf = async (context: BrowserContext) => ({ 'X-CSRF-Token': (await context.cookies()).find((c) => c.name === 'c360_csrf')!.value, Origin: ORIGIN });
const api = async (page: Page, path: string) => (await page.request.get(path)).json();
const publishFixture = (prefix: string, name: string) =>
  execFileSync('uv', ['run', 'python', 'scripts/e2e_publish_fixture.py', prefix, name, 'e2e.survey.author', 'e2e.survey.checker', 'e2e.survey.publisher'], { cwd: backend, env: { ...process.env, CALL360_ENV_FILE: '.env.test' } }).toString().trim().split('\n').pop()!;
/** Every simulation and call-plan response the page receives, as the server sent it. */
function listen(page: Page) {
  const seen: any[] = [];
  page.on('response', (r: Response) => { if (/\/api\/v1\/(survey-simulations|survey-versions\/[^/]+\/(simulations|call-plans)|survey-call-plans)/.test(r.url()) && r.ok()) r.json().then((j) => seen.push({ url: r.url(), method: r.request().method(), body: j })).catch(() => undefined); });
  return seen;
}
const srv = (page: Page) => page.getByTestId('ss-srv');
const simOf = async (page: Page) => api(page, `/api/v1/survey-simulations/${await srv(page).getAttribute('data-simulation')}`);
const settled = async (page: Page) => { await expect(srv(page)).toHaveAttribute('data-simulation', /.+/); await expect(page.getByTestId('ss-srv-parity')).not.toHaveAttribute('data-agree', 'pending'); };

let K8 = '';
let K4 = '';
test.beforeAll(() => {
  K8 = publishFixture('K8', 'Simulation source K8');
  K4 = publishFixture('K4', 'Simulation source K4');
});

test('SS-03B.1 a simulator simulates a published version step by step, and the screen shows the server’s run', async ({ browser }) => {
  test.setTimeout(240_000);
  const r = await session(browser, 'survey_simulator', `/survey-studio/surveys/${K8}/simulate`);
  const seen = listen(r.page);
  await r.page.reload();
  await settled(r.page);
  // the server panel is the default for a saved survey, and it says what it is
  await expect(r.page.getByTestId('ss-sim-engine-server')).toHaveAttribute('aria-pressed', 'true');
  await expect(r.page.getByTestId('ss-srv-notice')).toContainText('not a call');
  await expect(r.page.getByTestId('ss-srv-notice')).toContainText('nothing eligible for a real call');
  let sim = await simOf(r.page);
  expect(sim.record_class).toBe('SIMULATION');
  expect(seen.some((x) => x.method === 'POST' && x.body.id === sim.id)).toBe(true); // the page created it on the server
  // the exact sentence on the screen is the server's
  await expect(r.page.getByTestId('ss-srv-question')).toHaveText(sim.run.pending.text);
  await expect(r.page.getByTestId('ss-srv-stage')).toHaveAttribute('data-key', sim.run.pending.key);
  await shot(r.page, 'SIM01-server-simulator-first-question', true);

  // an answer the server refuses does not advance: submit the form with nothing chosen
  const key = sim.run.pending.key;
  await r.page.getByTestId('ss-srv-answer').click();
  await expect(r.page.getByTestId('ss-srv-reject')).toBeVisible();
  sim = await simOf(r.page);
  const last = sim.inputs.at(-1);
  expect(last.accepted).toBe(false);
  await expect(r.page.getByTestId('ss-srv-reject')).toHaveAttribute('data-code', last.rejection_code);
  expect(sim.run.pending.key).toBe(key); // the same question is still current
  expect(sim.run.asked).not.toContain(key);
  await expect(r.page.getByTestId('ss-srv-stage')).toHaveAttribute('data-key', key);
  await expect(r.page.getByTestId('ss-srv-stage')).toHaveAttribute('data-attempt', '1');
  await expect(r.page.getByTestId('ss-srv-trace').locator('li[data-kind="REJECT"]')).toHaveCount(1);
  await shot(r.page, 'SIM02-invalid-answer-refused-same-question');

  // one step: the ordinary answer is accepted and the server moves on — here, to the end of the run
  await r.page.getByTestId('ss-srv-step').click();
  await expect(r.page.getByTestId('ss-srv-end')).toBeVisible({ timeout: 60_000 });
  sim = await simOf(r.page);
  expect(sim.status).toBe('TERMINAL');
  expect(sim.run.asked).toContain(key);
  expect(sim.inputs.map((i: any) => i.accepted)).toEqual([false, true]); // the refused answer is kept, as refused
  await expect(r.page.getByTestId('ss-srv-end')).toHaveAttribute('data-terminal', sim.run.terminal.state);
  // modules, trace and delivered wording are the server's, one for one
  for (const m of sim.run.modules) await expect(r.page.getByTestId(`ss-srv-module-${m.instance}`)).toHaveAttribute('data-status', m.status);
  await expect(r.page.getByTestId('ss-srv-trace').locator('li')).toHaveCount(sim.run.events.length);
  await r.page.getByTestId('ss-srv-delivered').locator('summary').click();
  const said = await r.page.getByTestId('ss-srv-delivered').locator('li > span:last-child').allTextContents();
  expect(said).toEqual(sim.run.delivered.map((d: any) => d.text));
  expect(sim.run.modules.some((m: any) => m.status.startsWith('SKIPPED'))).toBe(true); // this customer skips some modules
  // the browser's own engine agrees with the server on this run
  await expect(r.page.getByTestId('ss-srv-parity')).toHaveAttribute('data-agree', 'true');
  await r.page.getByTestId('ss-srv-identity').locator('summary').click();
  await expect(r.page.getByTestId('ss-srv-class')).toHaveText('Simulation');
  await shot(r.page, 'SIM03-run-ended-trace-and-modules', true);

  // replay: the same inputs in a new simulation give the identical run
  await r.page.getByTestId('ss-srv-replay-go').click();
  await expect(r.page.getByTestId('ss-srv-replay')).toHaveAttribute('data-identical', 'true', { timeout: 60_000 });
  const replays = seen.filter((x) => x.body.label?.startsWith('Replay of'));
  expect(replays.length).toBeGreaterThan(0);
  expect(replays.at(-1).body.run_sha256).toBe(sim.run_sha256);
  expect(replays.at(-1).body.id).not.toBe(sim.id);
  await shot(r.page, 'SIM04-replay-identical');

  // another customer: a missing fact is not read as "no"
  await r.page.getByTestId('ss-srv-profile-UNEASY_NO_AGE').click();
  await expect(srv(r.page)).not.toHaveAttribute('data-simulation', sim.id);
  await settled(r.page);
  await r.page.getByTestId('ss-srv-run-all').click();
  await expect(srv(r.page)).not.toHaveAttribute('data-status', 'PENDING', { timeout: 60_000 });
  const other = await simOf(r.page);
  expect(other.facts['customer.age_years']).toBeNull();
  const unknown = other.run.events.filter((e: any) => e.kind === 'ENTRY' && e.result === 'UNKNOWN');
  expect(unknown.length).toBeGreaterThan(0);
  for (const e of unknown) expect(['SKIPPED_UNKNOWN', 'HALTED_MISSING_INFORMATION']).toContain(e.status); // never SKIPPED_FALSE
  for (const m of other.run.modules) await expect(r.page.getByTestId(`ss-srv-module-${m.instance}`)).toHaveAttribute('data-status', m.status);
  await expect(r.page.getByTestId('ss-srv-parity')).toHaveAttribute('data-agree', 'true');
  await shot(r.page, 'SIM05-missing-fact-is-unknown', true);

  // two customers side by side, both run on the server
  await r.page.getByTestId('ss-srv-compare-pick').selectOption('NORMAL');
  await expect(r.page.getByTestId('ss-srv-compare')).toBeVisible({ timeout: 90_000 });
  await expect(r.page.getByTestId('ss-srv-compare').locator('tr[data-differs="true"]').first()).toBeVisible();
  await shot(r.page, 'SIM06-two-customers-compared', true);
  await r.page.getByTestId('ss-srv-compare-close').click();

  // the draft preview is still there, and says it is not the engine
  await r.page.getByTestId('ss-sim-engine-draft').click();
  await expect(r.page.getByTestId('ss-sim-notice')).toContainText('not the Call360 engine');
  await expect(r.page.getByTestId('ss-sim-stage').or(r.page.getByTestId('ss-sim-end'))).toBeVisible();
  await expect(srv(r.page)).toHaveCount(0);
  await r.context.close();
});

test('SS-03B.2 a non-answer stops as “policy unresolved”: not an outcome, and the question stays current', async ({ browser }) => {
  test.setTimeout(180_000);
  const r = await session(browser, 'survey_simulator', `/survey-studio/surveys/${K4}/simulate`);
  await settled(r.page);
  for (let i = 0; i < 20 && !(await r.page.getByTestId('ss-srv-no-ack').isVisible()); i++) {
    const key = await r.page.getByTestId('ss-srv-stage').getAttribute('data-key');
    await r.page.getByTestId('ss-srv-step').click();
    await expect(r.page.getByTestId('ss-srv-stage')).not.toHaveAttribute('data-key', key!);
  }
  const key = await r.page.getByTestId('ss-srv-stage').getAttribute('data-key');
  await r.page.getByTestId('ss-srv-no-ack').click();
  await expect(r.page.getByTestId('ss-srv-policy')).toBeVisible();
  await expect(r.page.getByTestId('ss-srv-policy')).toContainText('has not been decided');
  await expect(r.page.getByTestId('ss-srv-policy')).toContainText('not an outcome');
  await expect(srv(r.page)).toHaveAttribute('data-status', 'POLICY_UNRESOLVED');
  await expect(r.page.getByTestId('ss-srv-end')).toHaveCount(0);
  let sim = await simOf(r.page);
  expect(sim.status).toBe('POLICY_UNRESOLVED');
  expect(sim.run.terminal).toBeNull();
  expect(sim.run.pending.key).toBe(key);
  expect(sim.run.policy_unresolved).toEqual({ key, code: 'POLICY_UNRESOLVED', reason: 'NON_ANSWER_POLICY_UNRESOLVED' });
  expect(sim.run.modules.filter((m: any) => m.outcome)).toEqual([]); // nothing completed, nothing escalated
  expect(sim.run.events.filter((e: any) => e.kind === 'END')).toEqual([]);
  await expect(r.page.getByTestId('ss-srv-parity')).toHaveAttribute('data-agree', 'true');
  await shot(r.page, 'SIM07-policy-unresolved', true);
  // an acknowledgement afterwards is accepted: the status was never an ending
  await r.page.getByTestId('ss-srv-ack').click();
  await expect(r.page.getByTestId('ss-srv-policy')).toHaveCount(0);
  sim = await simOf(r.page);
  expect(sim.run.asked).toContain(key);
  await r.context.close();
});

test('SS-03B.3 the call plan is the server’s, with exact wording and a fingerprint, and never says a call may be made', async ({ browser }) => {
  test.setTimeout(180_000);
  const r = await session(browser, 'survey_simulator', `/survey-studio/surveys/${K8}/plan`);
  const panel = r.page.getByTestId('ss-srvplan');
  await expect(panel).toHaveAttribute('data-plan', /.+/);
  await expect(r.page.getByTestId('ss-plan-engine-server')).toHaveAttribute('aria-pressed', 'true');
  const plan = await api(r.page, `/api/v1/survey-call-plans/${await panel.getAttribute('data-plan')}`);
  expect(plan.record_class).toBe('SIMULATION');
  expect(plan.fingerprint_verified).toBe(true);
  await expect(r.page.getByTestId('ss-srvplan-verdict')).toHaveAttribute('data-status', plan.status);
  await expect(r.page.getByTestId('ss-srvplan-fingerprint')).toHaveAttribute('title', plan.fingerprint);
  for (const m of plan.plan.modules) await expect(r.page.getByTestId(`ss-srvplan-module-${m.instance}`)).toHaveAttribute('data-status', m.status);
  const texts = plan.plan.modules.flatMap((m: any) => m.items.map((i: any) => i.text)).filter(Boolean);
  for (const t of texts.slice(0, 6)) await expect(panel).toContainText(t);
  await expect(r.page.getByTestId('ss-srvplan-notice')).toContainText('not permission to call');
  await expect(r.page.getByTestId('ss-srv-parity')).toHaveAttribute('data-agree', 'true');
  expect(plan.plan.modules.map((m: any) => m.status)).toContain('OUT');
  await shot(r.page, 'SIM08-server-call-plan', true);

  // the same facts again: another record, the same fingerprint
  const again = await (await r.page.request.post(`/api/v1/survey-versions/${plan.version_id}/call-plans`, { data: { facts: plan.facts }, headers: await csrf(r.context) })).json();
  expect(again.id).not.toBe(plan.id);
  expect(again.fingerprint).toBe(plan.fingerprint);

  // a missing fact blocks or halts; it is never guessed
  await r.page.getByTestId('ss-plan-profile').selectOption('UNEASY_NO_AGE');
  await expect(panel).not.toHaveAttribute('data-plan', plan.id);
  await expect(panel).toHaveAttribute('data-plan', /.+/);
  const second = await api(r.page, `/api/v1/survey-call-plans/${await panel.getAttribute('data-plan')}`);
  expect(second.fingerprint).not.toBe(plan.fingerprint);
  expect(second.plan.inputs.find((i: any) => i.field === 'customer.age_years').state).toBe('MISSING');
  const undecided = second.plan.modules.filter((m: any) => m.eligibility?.result === 'UNKNOWN');
  expect(undecided.length).toBeGreaterThan(0);
  for (const m of undecided) expect(['UNKNOWN_SKIPPED', 'UNKNOWN_HALTS']).toContain(m.reason);
  await expect(r.page.getByTestId('ss-srvplan-verdict')).toHaveAttribute('data-status', second.status);
  await expect(r.page.getByTestId('ss-srv-parity')).toHaveAttribute('data-agree', 'true');
  await shot(r.page, 'SIM09-server-call-plan-missing-fact', true);
  await r.context.close();
});

test('SS-03B.4 a difference between the browser engine and the server is shown in full, and the server’s result stands', async ({ browser }) => {
  test.setTimeout(120_000);
  const r = await session(browser, 'survey_simulator');
  // the browser engine is handed a published document with one sentence altered; the server still runs the real one
  await r.page.route('**/api/v1/survey-candidates/*/documents', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const a of body.assets) if (a.kind === 'WORDING' && a.document?.text) a.document.text = `${a.document.text} [altered in the browser]`;
    await route.fulfill({ response, json: body });
  });
  await r.page.goto(`/survey-studio/surveys/${K4}/simulate`);
  await settled(r.page);
  const parity = r.page.getByTestId('ss-srv-parity');
  await expect(parity).toHaveAttribute('data-agree', 'false');
  await expect(parity).toContainText('does not agree with the server');
  await expect(parity).toContainText('[altered in the browser]');
  const sim = await simOf(r.page);
  await expect(r.page.getByTestId('ss-srv-question')).toHaveText(sim.run.pending.text); // the screen still shows the server's sentence
  expect(sim.run.pending.text).not.toContain('altered');
  await shot(r.page, 'SIM10-difference-is-visible', true);
  await r.context.close();
});

test('SS-03B.5 simulation needs its own permission: refused to a reader, without permission, in another market and without a session', async ({ browser }) => {
  test.setTimeout(120_000);
  const simulator = await session(browser, 'survey_simulator');
  const surveys = (await api(simulator.page, '/api/v1/survey-definitions')).items;
  const sid = surveys.find((s: any) => s.code === K8).id;
  const version = (await api(simulator.page, `/api/v1/survey-definitions/${sid}/history`)).versions[0];
  const create = `/api/v1/survey-versions/${version.id}/simulations`;
  const mine = await (await simulator.page.request.post(create, { data: { facts: {} }, headers: await csrf(simulator.context) })).json();
  expect(mine.record_class).toBe('SIMULATION');
  expect(mine.engine_contract).toBe('call360.survey.execution/1');
  expect(mine.replay_consistent).toBe(true);
  const plan = await (await simulator.page.request.post(`/api/v1/survey-versions/${version.id}/call-plans`, { data: { facts: {} }, headers: await csrf(simulator.context) })).json();
  // without the CSRF token nothing is created
  expect((await simulator.page.request.post(create, { data: { facts: {} }, headers: { Origin: ORIGIN } })).status()).toBe(403);

  // a READER can read the survey, and a simulation or plan someone made — but cannot create or advance one
  const reader = await session(browser, 'survey_reader', `/survey-studio/surveys/${K8}/simulate`);
  await expect(reader.page.getByTestId('ss-srv-not-permitted')).toBeVisible();
  await expect(reader.page.getByTestId('ss-srv-not-permitted')).toContainText('survey.simulate');
  await expect(reader.page.getByTestId('ss-srv-stage')).toHaveCount(0);
  await shot(reader.page, 'SIM11-reader-cannot-simulate');
  await reader.page.goto(`/survey-studio/surveys/${K8}/plan`);
  await expect(reader.page.getByTestId('ss-srvplan-not-permitted')).toBeVisible();
  expect((await reader.page.request.post(create, { data: { facts: {} }, headers: await csrf(reader.context) })).status()).toBe(403);
  expect((await reader.page.request.post(`/api/v1/survey-simulations/${mine.id}/inputs`, { data: { expected_inputs: 0, key: mine.run.pending.key, answer: { choice: 'YES' } }, headers: await csrf(reader.context) })).status()).toBe(403);
  expect((await reader.page.request.post(`/api/v1/survey-versions/${version.id}/call-plans`, { data: { facts: {} }, headers: await csrf(reader.context) })).status()).toBe(403);
  expect((await reader.page.request.get(`/api/v1/survey-simulations/${mine.id}`)).status()).toBe(200);
  expect((await reader.page.request.get(`/api/v1/survey-call-plans/${plan.id}`)).status()).toBe(200);
  expect((await api(simulator.page, `/api/v1/survey-simulations/${mine.id}`)).inputs).toEqual([]); // the reader's input was not recorded
  await reader.context.close();

  const plain = await session(browser, 'user'); // signed in, no survey permission at all
  expect((await plain.page.request.post(create, { data: { facts: {} }, headers: await csrf(plain.context) })).status()).toBe(403);
  expect((await plain.page.request.get(`/api/v1/survey-simulations/${mine.id}`)).status()).toBe(403);
  await plain.context.close();

  const elsewhere = await session(browser, 'survey_simelsewhere'); // holds read and simulate, in another market
  expect((await elsewhere.page.request.post(create, { data: { facts: {} }, headers: await csrf(elsewhere.context) })).status()).toBe(404);
  expect((await elsewhere.page.request.get(`/api/v1/survey-simulations/${mine.id}`)).status()).toBe(404);
  expect((await elsewhere.page.request.get(`/api/v1/survey-call-plans/${plan.id}`)).status()).toBe(404);
  await elsewhere.context.close();

  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(`${ORIGIN}/api/v1/survey-simulations/${mine.id}`)).status()).toBe(401);
  await anonymous.close();
  await simulator.context.close();
});
