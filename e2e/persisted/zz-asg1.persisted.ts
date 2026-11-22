import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// (Named to run LAST: the FI-1 journey begins on a database with no surveys, and this one publishes two.)
// ASG-1 — synthetic application → assignment selection → published survey version → call plan → simulation, full stack:
// Chromium → Vite → FastAPI → PostgreSQL (isolated test schema). The assignment rules are made through the EXISTING
// Assignment Rules API by its own maker and checker. Two golden fixtures are published as surveys by three people.
// Bindings are proposed, approved and published in the browser by three different people. A fourth person, who holds
// only read and simulate, then selects, plans and simulates. What the screen shows is compared with what the server
// recorded. Simulation only: no case, script assignment or call is created. Synthetic content only.
const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../../../Call360-backend');
const SHOTS = 'test-results/persisted/shots';
const ORIGIN = 'http://127.0.0.1:5174';
const A = '/api/v1/survey-assignment';
type Who = 'survey_author' | 'survey_checker' | 'survey_publisher' | 'survey_simulator' | 'survey_reader' | 'user' | 'checker';
const account = (who: Who): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'))[who];
const shot = async (page: Page, name: string, full = true) => { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };

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
const publishFixture = (prefix: string, name: string) =>
  execFileSync('uv', ['run', 'python', 'scripts/e2e_publish_fixture.py', prefix, name, 'e2e.survey.author', 'e2e.survey.checker', 'e2e.survey.publisher'], { cwd: backend, env: { ...process.env, CALL360_ENV_FILE: '.env.test' } }).toString().trim().split('\n').pop()!;

/** A rule made, approved and published through the existing Assignment Rules API, by its own maker and checker. */
async function publishRule(maker: S, checker: S, code: string, conditions: Array<{ field: string; values: unknown[] }>) {
  const target = (await get(maker, '/api/v1/assignment-rules/options')).targets.find((t: any) => t.label === 'SALES_VERIFICATION_SG v1.1').id;
  const made = await post(maker, '/api/v1/assignment-rules', { code, name: `${code} rule`, description: 'ASG-1 synthetic rule' });
  const d = await get(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}`);
  const content = { name: d.name, description: d.description, conditions, priority: 1, is_fallback: false, target_script_version_id: target, effective_from: d.effective_from, effective_to: d.effective_to };
  const put = await maker.page.request.put(`/api/v1/assignment-rule-drafts/${made.draft_id}`, { data: { expected_row_version: d.row_version, content }, headers: await csrf(maker.context) });
  expect(put.ok(), await put.text()).toBe(true);
  const saved = await get(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}`);
  await post(maker, `/api/v1/assignment-rule-drafts/${made.draft_id}/submit`, { expected_row_version: saved.row_version, change_summary: 'ASG-1 journey rule (synthetic)' });
  await post(checker, `/api/v1/assignment-rule-drafts/${made.draft_id}/review`, { decision: 'APPROVE', reason: 'Checked conditions' });
  await post(checker, `/api/v1/assignment-rule-drafts/${made.draft_id}/publish`, { reason: 'ASG-1 journey publication' });
}

test('ASG-1 a synthetic application is selected by governed rules, planned and simulated — and nothing is assigned to anyone', async ({ browser }) => {
  test.setTimeout(420_000);
  const codeA = publishFixture('K1', 'Standard callback survey');
  const codeB = publishFixture('K8', 'Investment-linked callback survey');
  const maker = await session(browser, 'user');
  const ruleChecker = await session(browser, 'checker');
  const author = await session(browser, 'survey_author', '/survey-studio');
  const fields: Record<string, any[]> = Object.fromEntries((await get(author, `${A}/options`)).fields.map((f: any) => [f.field, f.values.map((v: any) => v.value)]));
  const [famA, famB] = fields.product_family as [string, string];
  const common = [{ field: 'market', values: ['SG'] }, { field: 'selling_channel', values: [fields.selling_channel![0]] }, { field: 'premium_frequency', values: [fields.premium_frequency![0]] }];
  const casesBefore = (await get(maker, '/api/v1/cases?page_size=1')).total ?? null;
  await publishRule(maker, ruleChecker, 'ASG-E2E-A', [...common, { field: 'product_family', values: [famA] }]);
  await publishRule(maker, ruleChecker, 'ASG-E2E-B', [...common, { field: 'product_family', values: [famB] }]);
  await maker.context.close(); await ruleChecker.context.close();

  // ---- the author finds the page from the Surveys list, reads the policy and proposes two bindings
  await author.page.getByTestId('ss-open-assignment').click();
  await expect(author.page.getByTestId('ss-asg-notice')).toContainText('Simulation only');
  await expect(author.page.getByTestId('ss-asg-notice')).toContainText('not permission to call');
  await expect(author.page.getByTestId('ss-asg-unbound-ASG-E2E-A')).toBeVisible();
  for (const [rule, code] of [['ASG-E2E-A', codeA], ['ASG-E2E-B', codeB]] as const) {
    const pick = author.page.getByTestId(`ss-asg-pick-${rule}`);
    await pick.selectOption({ label: await pick.locator('option', { hasText: `(${code})` }).textContent() ?? '' });
    await author.page.getByTestId(`ss-asg-propose-${rule}`).click();
    await expect(author.page.getByTestId(`ss-asg-open-${rule}`)).toHaveAttribute('data-status', 'PROPOSED');
  }
  await expect(author.page.getByTestId('ss-asg-approve-ASG-E2E-A')).toHaveCount(0); // the proposer is offered no decision
  await shot(author.page, 'ASG01-policy-with-proposed-bindings');
  const proposed = (await get(author, `${A}/policy`)).bindings.find((b: any) => b.rule_code === 'ASG-E2E-A');
  const refused = await author.page.request.post(`${A}/bindings/${proposed.id}/decision`, { data: { verdict: 'APPROVE' }, headers: await csrf(author.context) });
  expect(refused.status()).toBe(403); // and the server refuses it too
  // a proposed binding selects nothing yet
  const simulator = await session(browser, 'survey_simulator', '/survey-studio/assignment');
  await expect(simulator.page.getByTestId('ss-asg-evaluate')).toBeEnabled();
  await simulator.page.getByTestId('ss-asg-in-product_family').selectOption(String(famA));
  await simulator.page.getByTestId('ss-asg-evaluate').click();
  await expect(simulator.page.getByTestId('ss-asg-result')).toHaveAttribute('data-outcome', 'SURVEY_NOT_BOUND');
  await expect(simulator.page.getByTestId('ss-asg-plan')).toHaveCount(0);
  await shot(simulator.page, 'ASG02-winning-rule-has-no-survey-nothing-selected');

  // ---- a second person approves, a third publishes
  const checker = await session(browser, 'survey_checker', '/survey-studio/assignment');
  for (const rule of ['ASG-E2E-A', 'ASG-E2E-B']) { await checker.page.getByTestId(`ss-asg-approve-${rule}`).click(); await expect(checker.page.getByTestId(`ss-asg-open-${rule}`)).toHaveAttribute('data-status', 'APPROVED'); }
  await expect(checker.page.getByTestId('ss-asg-publish-ASG-E2E-A')).toHaveCount(0);
  await checker.context.close();
  const publisher = await session(browser, 'survey_publisher', '/survey-studio/assignment');
  for (const rule of ['ASG-E2E-A', 'ASG-E2E-B']) { await publisher.page.getByTestId(`ss-asg-publish-${rule}`).click(); await expect(publisher.page.getByTestId(`ss-asg-bound-${rule}`)).toBeVisible(); }
  await shot(publisher.page, 'ASG03-bindings-published');
  await publisher.context.close();
  const policy = await get(author, `${A}/policy`);
  const bound = (rule: string) => policy.bindings.find((b: any) => b.rule_code === rule && b.status === 'PUBLISHED');
  expect(bound('ASG-E2E-A').survey_code).toBe(codeA);
  expect(bound('ASG-E2E-B').survey_code).toBe(codeB);

  // ---- 1. two applications select two different published versions
  const result = simulator.page.getByTestId('ss-asg-result');
  await simulator.page.reload();
  await simulator.page.getByTestId('ss-asg-in-product_family').selectOption(String(famA));
  await simulator.page.getByTestId('ss-asg-evaluate').click();
  await expect(result).toHaveAttribute('data-selection', 'MATCHED');
  await expect(result).toHaveAttribute('data-version', bound('ASG-E2E-A').survey_version_id);
  await expect(simulator.page.getByTestId('ss-asg-selected')).toContainText('ASG-E2E-A v1');
  await expect(simulator.page.getByTestId('ss-asg-trace-ASG-E2E-A')).toHaveAttribute('data-selected', 'true');
  await expect(simulator.page.getByTestId('ss-asg-trace-ASG-E2E-B')).toHaveAttribute('data-match', 'NO_MATCH');
  const first = await get(simulator, `${A}/evaluations/${await result.getAttribute('data-evaluation')}`);
  expect(first.record_class).toBe('SIMULATION');
  expect(first.decision.selected.survey_code).toBe(codeA);
  await expect(simulator.page.getByTestId('ss-asg-reason')).toHaveText(first.decision.reason);
  await expect(result).toHaveAttribute('data-fingerprint', first.call_plan.fingerprint);
  await shot(simulator.page, 'ASG04-application-A-selects-survey-A');

  await simulator.page.getByTestId('ss-asg-in-product_family').selectOption(String(famB));
  await simulator.page.getByTestId('ss-asg-evaluate').click();
  await expect(result).toHaveAttribute('data-version', bound('ASG-E2E-B').survey_version_id);
  await expect(simulator.page.getByTestId('ss-asg-selected')).toContainText('ASG-E2E-B v1');
  const second = await get(simulator, `${A}/evaluations/${await result.getAttribute('data-evaluation')}`);
  expect(second.survey_version_id).not.toBe(first.survey_version_id);
  for (const m of second.call_plan.plan.modules) await expect(simulator.page.getByTestId('ss-asg-plan-modules').locator('li', { hasText: m.name })).toHaveAttribute('data-status', m.status);
  await expect(simulator.page.getByTestId('ss-asg-notice')).toContainText('nothing here assigns a survey to a customer case');
  await shot(simulator.page, 'ASG05-application-B-selects-survey-B-with-plan');

  // ---- 2. the same inputs again: the same version and the same plan fingerprint, in a new record
  await simulator.page.getByTestId('ss-asg-in-product_family').selectOption(String(famA));
  await simulator.page.getByTestId('ss-asg-in-product_family').selectOption(String(famB));
  await simulator.page.getByTestId('ss-asg-evaluate').click();
  await expect(result).not.toHaveAttribute('data-evaluation', second.id);
  await expect(result).toHaveAttribute('data-fingerprint', second.call_plan.fingerprint);
  const again = await get(simulator, `${A}/evaluations/${await result.getAttribute('data-evaluation')}`);
  expect([again.survey_version_id, again.decision_sha256, again.plan_fingerprint]).toEqual([second.survey_version_id, second.decision_sha256, second.plan_fingerprint]);

  // ---- 3. a missing fact stays missing in the plan; a missing input selects nothing
  await simulator.page.getByTestId('ss-asg-profile').selectOption('UNEASY_NO_AGE');
  await simulator.page.getByTestId('ss-asg-evaluate').click();
  await expect(simulator.page.getByTestId('ss-asg-plan-missing')).toContainText('customer.age_years');
  const noAge = await get(simulator, `${A}/evaluations/${await result.getAttribute('data-evaluation')}`);
  expect(noAge.call_plan.plan.inputs.find((i: any) => i.field === 'customer.age_years').state).toBe('MISSING');
  for (const m of noAge.call_plan.plan.modules.filter((x: any) => x.eligibility?.result === 'UNKNOWN')) expect(['UNKNOWN_SKIPPED', 'UNKNOWN_HALTS']).toContain(m.reason);
  await shot(simulator.page, 'ASG06-missing-fact-stays-missing-in-the-plan');
  await simulator.page.getByTestId('ss-asg-in-product_family').selectOption('');
  await simulator.page.getByTestId('ss-asg-evaluate').click();
  await expect(result).toHaveAttribute('data-selection', 'UNKNOWN_INPUT');
  await expect(result).toHaveAttribute('data-version', '');
  await expect(simulator.page.getByTestId('ss-asg-missing-inputs')).toContainText('product_family');
  await expect(simulator.page.getByTestId('ss-asg-trace-ASG-E2E-A')).toHaveAttribute('data-match', 'UNKNOWN');
  await expect(simulator.page.getByTestId('ss-asg-plan')).toHaveCount(0);
  await shot(simulator.page, 'ASG07-unknown-input-selects-nothing');

  // ---- from the selection to a server simulation of that exact version, and back to the evidence
  await simulator.page.getByTestId('ss-asg-profile').selectOption('NORMAL');
  await simulator.page.getByTestId('ss-asg-in-product_family').selectOption(String(famB));
  await simulator.page.getByTestId('ss-asg-evaluate').click();
  await expect(result).toHaveAttribute('data-selection', 'MATCHED');
  const chosen = await result.getAttribute('data-evaluation');
  await simulator.page.getByTestId('ss-asg-simulate').click();
  await expect(simulator.page).toHaveURL(new RegExp(`/surveys/${codeB}/simulate\\?simulation=`));
  await expect(simulator.page.getByTestId('ss-srv-from-assignment')).toBeVisible();
  const srv = simulator.page.getByTestId('ss-srv');
  await expect(srv).toHaveAttribute('data-simulation', /.+/);
  const sim = await get(simulator, `/api/v1/survey-simulations/${await srv.getAttribute('data-simulation')}`);
  expect(sim.version_id).toBe(bound('ASG-E2E-B').survey_version_id);
  expect(sim.record_class).toBe('SIMULATION');
  await expect(simulator.page.getByTestId('ss-srv-question')).toHaveText(sim.run.pending.text);
  await simulator.page.getByTestId('ss-srv-step').click();
  await expect(simulator.page.getByTestId('ss-srv-end')).toBeVisible({ timeout: 60_000 });
  await shot(simulator.page, 'ASG08-simulation-started-from-the-selection');
  await simulator.page.getByTestId('ss-srv-assignment-link').click();
  await expect(result).toHaveAttribute('data-evaluation', chosen!);
  await expect(simulator.page.getByTestId('ss-asg-simulations')).toContainText(sim.id.slice(0, 8));
  expect((await get(simulator, `${A}/evaluations/${chosen}`)).simulations).toEqual([sim.id]);
  await shot(simulator.page, 'ASG09-assignment-and-execution-evidence-together');

  // ---- being able to read surveys does not open the assignment policy: it shows Script Studio's rule conditions
  const reader = await session(browser, 'survey_reader', '/survey-studio');
  await expect(reader.page.getByTestId('ss-saved-home')).toBeVisible();
  await expect(reader.page.getByTestId('ss-open-assignment')).toHaveCount(0);
  await reader.page.goto(`/survey-studio/assignment?evaluation=${chosen}`);
  await expect(reader.page.getByTestId('ss-asg-not-permitted')).toBeVisible();
  await expect(reader.page.getByTestId('ss-asg-rules')).toHaveCount(0);
  await expect(reader.page.getByTestId('ss-asg-result')).toHaveCount(0);
  for (const path of [`${A}/policy`, `${A}/options`, `${A}/evaluations/${chosen}`]) expect((await reader.page.request.get(path)).status(), path).toBe(403);
  expect((await reader.page.request.post(`${A}/evaluations`, { data: { assignment_inputs: { market: 'SG' }, facts: {} }, headers: await csrf(reader.context) })).status()).toBe(403);
  await shot(reader.page, 'ASG10-survey-reader-cannot-open-the-policy', false);
  await reader.context.close();
  // … and the survey people gain nothing of Script Studio: the Assignment Rules API still needs its own permission
  for (const path of ['/api/v1/assignment-rules', '/api/v1/assignment-rules/options']) expect((await author.page.request.get(path)).status(), path).toBe(403);
  // what the policy returns is what this page needs: no script target, rule author, checker or draft
  expect(Object.keys((await get(author, `${A}/policy`)).rules[0]).sort()).toEqual(['effective_from', 'effective_now', 'effective_to', 'is_fallback', 'market_code', 'name', 'open_binding', 'priority', 'published_binding', 'ref', 'rule_code', 'rule_version', 'rule_version_id', 'specificity', 'when']);

  // ---- 12. no customer case was created by any of it
  const check = await session(browser, 'user');
  if (casesBefore !== null) expect((await get(check, '/api/v1/cases?page_size=1')).total).toBe(casesBefore);
  await check.context.close();
  await simulator.context.close(); await author.context.close();
});
