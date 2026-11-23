import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// (Named to run last: it adds a member to the primary requirement group.)
// SHARED-1 — Assignment Rules and Finding Rules on their own, full stack: Chromium → Vite → FastAPI → PostgreSQL (the
// isolated test schema), with shared rule services switched on. A rule author and a rule checker who hold ONLY the
// dedicated permissions create and publish a rule that names no script; survey people bind it, group it, and an
// invented application gets a multi-survey plan and a coordinated simulation from it — with no dummy script. The
// numbers in the comments are the owner's twenty required demonstrations. Synthetic content only.
const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../../../Call360-backend');
const SHOTS = 'test-results/persisted/shots';
const ORIGIN = 'http://127.0.0.1:5174';
const A = '/api/v1/survey-assignment';
type Who = 'survey_ruleauthor' | 'survey_rulechecker' | 'survey_findingauthor' | 'survey_findingchecker' | 'survey_author' | 'survey_checker' | 'survey_publisher' | 'survey_simulator' | 'survey_reader' | 'user' | 'checker';
const account = (who: Who): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'))[who];
/* eslint-disable @typescript-eslint/no-explicit-any */
type S = { context: BrowserContext; page: Page };
async function session(browser: Browser, who: Who, path = '/'): Promise<S> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, account(who), path);
  return { context, page };
}
const shot = async (page: Page, name: string, full = true) => { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
const csrf = async (context: BrowserContext) => ({ 'X-CSRF-Token': (await context.cookies()).find((c) => c.name === 'c360_csrf')!.value, Origin: ORIGIN });
const get = async (s: S, path: string) => (await s.page.request.get(path)).json();
const status = async (s: S, path: string) => (await s.page.request.get(path)).status();
const post = async (s: S, path: string, data: unknown = {}) => { const r = await s.page.request.post(path, { data, headers: await csrf(s.context) }); expect(r.ok(), `${path}: ${await r.text()}`).toBe(true); return r.json(); };
const refused = async (s: S, path: string, data: unknown = {}) => (await s.page.request.post(path, { data, headers: await csrf(s.context) })).status();
const publishFixture = (prefix: string, name: string) =>
  execFileSync('uv', ['run', 'python', 'scripts/e2e_publish_fixture.py', prefix, name, 'e2e.survey.author', 'e2e.survey.checker', 'e2e.survey.publisher'], { cwd: backend, env: { ...process.env, CALL360_ENV_FILE: '.env.test' } }).toString().trim().split('\n').pop()!;

const PRIMARY = 'S1-PRIMARY', EXTRA = 'S1-EXTRA';
const version: Record<string, string> = {};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

test('SHARED-1.1 a survey-only rule is created and governed with the dedicated permissions, with no script', async ({ browser }) => {
  test.setTimeout(300_000);
  const legacy = await session(browser, 'user', '/assignment-rules');
  // ---- 1, 3. the existing script-backed rules, each with the script it targets and now its own market
  const before = await get(legacy, '/api/v1/assignment-rules');
  const seeded = before.items.find((i: any) => i.rule_code === 'SG-SALES-VERIFY');
  expect([seeded.target_kind, seeded.market, seeded.live.target.label]).toEqual(['SCRIPT_VERSION', 'SG', 'SALES_VERIFICATION_SG v1.1']);
  await expect(legacy.page.getByTestId('rule-SG-SALES-VERIFY')).toHaveAttribute('data-target-kind', 'SCRIPT_VERSION');
  await expect(legacy.page.getByTestId('rule-selects-SG-SALES-VERIFY')).toContainText('SALES_VERIFICATION_SG v1.1');
  const scriptsBefore = (await get(legacy, '/api/v1/scripts')).items.length;
  const scriptSideBefore = (await get(legacy, '/api/v1/script-assignment-rules')).items.map((r: any) => `${r.rule_code} v${r.version}`).sort();

  // ---- 13. a person with ONLY the dedicated permissions opens Assignment Rules — not through Script Studio
  const author = await session(browser, 'survey_ruleauthor', '/assignment-rules');
  const page = author.page;
  await expect(page.getByRole('heading', { name: 'Assignment Rules', level: 1 })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Assignment Rules', exact: true })).toBeVisible();
  await expect(page.getByTestId('rule-registry')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Script Studio', exact: true }).and(page.locator('.btn'))).toHaveCount(0); // no way into Script Studio is offered
  await expect(page.getByTestId('no-case-simulation')).toContainText('assigns scripts to synthetic cases');
  expect(await status(author, '/api/v1/scripts')).toBe(403);
  expect(await status(author, '/api/v1/survey-definitions')).toBe(403);
  expect(await status(author, '/api/v1/finding-rule-sets')).toBe(403);
  await shot(page, 'SHARED1-01-assignment-rules-with-the-dedicated-permission');

  // ---- 4. a new rule that names no script
  await page.getByTestId('new-rule').click();
  await expect(page.getByTestId('nr-kind')).toContainText('What does this rule select?');
  await page.getByTestId('nr-kind-survey').check();
  await page.getByLabel('Rule code').fill(PRIMARY);
  await page.getByLabel('Rule name').fill('ILP sold direct, paid yearly (survey only)');
  await shot(page, 'SHARED1-02-new-rule-that-selects-a-survey', false);
  await page.getByTestId('new-rule-create').click();
  await expect(page.getByTestId('rule-builder')).toBeVisible();
  await expect(page.getByTestId('rb-target')).toHaveCount(0); // there is no script to choose
  await expect(page.getByTestId('rb-survey-only')).toContainText('names no script and can never assign one to a callback case');
  await expect(page.getByTestId('rule-draft-header')).toContainText('Survey binding · no script');
  await page.getByTestId('rb-add-condition').selectOption('product_family');
  await page.getByTestId('rb-cond-product_family').getByLabel('ILP', { exact: true }).check();
  await page.getByTestId('rb-add-condition').selectOption('selling_channel');
  await page.getByTestId('rb-cond-selling_channel').getByLabel('Direct', { exact: true }).check();
  await page.getByTestId('rb-add-condition').selectOption('premium_frequency');
  await page.getByTestId('rb-cond-premium_frequency').getByLabel('Annual', { exact: true }).check();
  await page.getByTestId('rb-add-condition').selectOption('risk_band');
  await page.getByTestId('rb-cond-risk_band').getByLabel(/^Low/).check();
  // the highest priority, so that this rule — and no script-backed rule — wins for the application of the next journey
  await page.getByTestId('rb-priority').fill('1');
  await page.getByTestId('rb-save').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(page.getByTestId('issue-SURVEY_ONLY')).toContainText('assigns no script and can never assign one to a case');
  await expect(page.getByTestId('issue-NO_TARGET')).toHaveCount(0);
  await expect(page.getByTestId('rule-explanation')).toContainText(/no script/i);
  await shot(page, 'SHARED1-03-survey-only-rule-builder');
  // the simulation over cases does not apply to it, and says where it is tried instead
  await page.getByTestId('rule-tab-simulate').click();
  await expect(page.getByTestId('rule-not-on-cases')).toContainText('against a synthetic application');
  await page.getByTestId('rule-tab-rule').click();
  await page.getByLabel('Change summary for the checker').fill('A survey-only rule for ILP sold direct, paid yearly (synthetic)');
  await page.getByTestId('rule-submit').click();
  await expect(page.getByTestId('rule-draft-header')).toContainText('Locked for review');
  const ruleUrl = new URL(page.url());
  const draftId = ruleUrl.searchParams.get('draft')!;

  // ---- 5. two-person governance, as the existing rule contract requires: the author cannot approve or publish
  expect(await refused(author, `/api/v1/assignment-rule-drafts/${draftId}/review`, { decision: 'APPROVE', reason: 'my own rule' })).toBe(403);
  expect(await refused(author, `/api/v1/assignment-rule-drafts/${draftId}/publish`, { reason: 'x' })).toBe(403);
  const checker = await session(browser, 'survey_rulechecker', ruleUrl.pathname + ruleUrl.search);
  await checker.page.getByTestId('rule-tab-review').click();
  await checker.page.getByLabel('Reviewer reason').fill('Conditions and precedence reviewed (synthetic)');
  await checker.page.getByTestId('rule-approve').click();
  await expect(checker.page.getByTestId('rule-publish')).toBeEnabled();
  await checker.page.getByTestId('rule-publish').click();
  await expect(checker.page.getByTestId('rule-draft-header')).toContainText('Published');
  await checker.page.goto(`/assignment-rules/${PRIMARY}`); // the rule, as published
  await expect(checker.page.getByTestId('rule-version-header')).toContainText('Survey binding · no script');
  // ---- 6. its market is its own, and published
  await expect(checker.page.getByTestId('rule-market')).toHaveText('SG');
  await expect(checker.page.getByTestId('rule-selects')).toContainText('names no script and can never assign one to a callback case');
  await expect(checker.page.getByTestId('rule-cases-count')).toContainText('None, and never');
  await shot(checker.page, 'SHARED1-04-published-survey-only-rule');
  expect(await refused(checker, '/api/v1/assignment-rules', { code: 'S1-NOPE', name: 'A checker cannot author', target_kind: 'SURVEY_BINDING' })).toBe(403);

  // a second survey-only rule (an additional requirement), by the same two people through the same operations
  const second = await post(author, '/api/v1/assignment-rules', { code: EXTRA, name: 'ILP sold direct — extra survey (survey only)', description: 'SHARED-1 synthetic', market: 'SG', copy_from_rule_version_id: null, target_kind: 'SURVEY_BINDING' });
  const d2 = await get(author, `/api/v1/assignment-rule-drafts/${second.draft_id}`);
  expect([d2.target_kind, d2.target, d2.market]).toEqual(['SURVEY_BINDING', null, 'SG']);
  const content = { name: d2.name, description: d2.description, conditions: [{ field: 'market', values: ['SG'] }, { field: 'product_family', values: ['ILP'] }, { field: 'selling_channel', values: ['DIRECT'] }, { field: 'risk_band', values: ['LOW'] }], priority: 2, is_fallback: false, target_script_version_id: null, effective_from: null, effective_to: null };
  expect((await author.page.request.put(`/api/v1/assignment-rule-drafts/${second.draft_id}`, { data: { expected_row_version: d2.row_version, content }, headers: await csrf(author.context) })).ok()).toBe(true);
  // it cannot be given a script
  const withScript = await author.page.request.put(`/api/v1/assignment-rule-drafts/${second.draft_id}`, { data: { expected_row_version: d2.row_version + 1, content: { ...content, target_script_version_id: seeded.live.target.id } }, headers: await csrf(author.context) });
  expect([withScript.status(), (await withScript.json()).code]).toEqual([422, 'TARGET_NOT_ALLOWED']);
  const saved = await get(author, `/api/v1/assignment-rule-drafts/${second.draft_id}`);
  await post(author, `/api/v1/assignment-rule-drafts/${second.draft_id}/submit`, { expected_row_version: saved.row_version, change_summary: 'SHARED-1 additional survey-only rule (synthetic)' });
  await post(checker, `/api/v1/assignment-rule-drafts/${second.draft_id}/review`, { decision: 'APPROVE', reason: 'Checked conditions' });
  await post(checker, `/api/v1/assignment-rule-drafts/${second.draft_id}/publish`, { reason: 'SHARED-1 journey publication' });

  // the registry tells the two kinds apart, with each rule's market
  await page.goto('/assignment-rules');
  await expect(page.getByTestId(`rule-${PRIMARY}`)).toHaveAttribute('data-target-kind', 'SURVEY_BINDING');
  await expect(page.getByTestId(`rule-${PRIMARY}`)).toHaveAttribute('data-market', 'SG');
  await expect(page.getByTestId(`rule-selects-${PRIMARY}`)).toContainText('Never assigns a script to a case');
  await expect(page.getByTestId('rule-SG-SALES-VERIFY')).toHaveAttribute('data-target-kind', 'SCRIPT_VERSION');
  await page.getByTestId(`rule-${PRIMARY}`).scrollIntoViewIfNeeded();
  await shot(page, 'SHARED1-05-registry-script-backed-and-survey-only', false);

  // no script came into being, and the script side's list of rules is what it was
  expect((await get(legacy, '/api/v1/scripts')).items.length, 'no dummy script').toBe(scriptsBefore);
  expect((await get(legacy, '/api/v1/script-assignment-rules')).items.map((r: any) => `${r.rule_code} v${r.version}`).sort()).toEqual(scriptSideBefore);
  // ---- 11. it is never part of assigning a script to a case
  const sim = await post(legacy, '/api/v1/assignment-rules/simulate', { draft_ids: [], scope: 'ALL' });
  expect(JSON.stringify(sim)).not.toContain(PRIMARY);
  const caseId = (await get(legacy, '/api/v1/script-simulations/cases')).items?.[0]?.case_id ?? null;
  if (caseId) expect(JSON.stringify(await get(legacy, `/api/v1/cases/${caseId}/script-assignment/preview`))).not.toContain('S1-');
  await legacy.context.close(); await checker.context.close(); await author.context.close();
});

test('SHARED-1.2 it is bound to published surveys, grouped, and gives a multi-survey plan and a coordinated simulation', async ({ browser }) => {
  test.setTimeout(420_000);
  const codes = { A: publishFixture('K1', 'SHARED-1 primary survey'), B: publishFixture('K3', 'SHARED-1 additional survey') };
  const author = await session(browser, 'survey_author', '/survey-studio/assignment');
  const checker = await session(browser, 'survey_checker', '/survey-studio');
  const publisher = await session(browser, 'survey_publisher', '/survey-studio');
  const page = author.page;
  for (const [k, code] of Object.entries(codes)) {
    const s = (await get(author, '/api/v1/survey-definitions')).items.find((x: any) => x.code === code);
    version[k] = (await get(author, `/api/v1/survey-definitions/${s.id}/history`)).versions.find((v: any) => v.status === 'PUBLISHED').id;
  }

  // ---- 8. the survey-only rule in Survey assignment, bound by three people — the first binding through the screen
  const row = page.getByTestId(`ss-asg-rule-${PRIMARY}`);
  await expect(row).toHaveAttribute('data-target-kind', 'SURVEY_BINDING');
  await expect(row).toContainText('Survey only · names no script');
  await expect(page.getByTestId(`ss-asg-unbound-${PRIMARY}`)).toContainText('No survey bound');
  await page.getByTestId(`ss-asg-pick-${PRIMARY}`).selectOption(version.A!);
  await page.getByTestId(`ss-asg-propose-${PRIMARY}`).click();
  await expect(page.getByTestId(`ss-asg-open-${PRIMARY}`)).toHaveAttribute('data-status', 'PROPOSED');
  await checker.page.goto('/survey-studio/assignment');
  await checker.page.getByTestId(`ss-asg-approve-${PRIMARY}`).click();
  await expect(checker.page.getByTestId(`ss-asg-open-${PRIMARY}`)).toHaveAttribute('data-status', 'APPROVED');
  await publisher.page.goto('/survey-studio/assignment');
  await publisher.page.getByTestId(`ss-asg-publish-${PRIMARY}`).click();
  await expect(publisher.page.getByTestId(`ss-asg-bound-${PRIMARY}`)).toHaveAttribute('data-version', version.A!);
  await page.reload();
  await expect(page.getByTestId(`ss-asg-bound-${PRIMARY}`)).toHaveAttribute('data-version', version.A!);
  await row.scrollIntoViewIfNeeded();
  await shot(page, 'SHARED1-06-survey-only-rule-bound-to-a-published-survey', false);
  const b2 = await post(author, `${A}/bindings`, { rule_code: EXTRA, rule_version: 1, survey_version_id: version.B, note: 'SHARED-1 journey' });
  await post(checker, `${A}/bindings/${b2.id}/decision`, { verdict: 'APPROVE' });
  await post(publisher, `${A}/bindings/${b2.id}/publish`);
  const policy = Object.fromEntries((await get(author, `${A}/policy`)).rules.map((r: any) => [r.rule_code, r]));
  expect([policy[PRIMARY].target_kind, policy[PRIMARY].market_code, !!policy[PRIMARY].published_binding]).toEqual(['SURVEY_BINDING', 'SG', true]);
  expect(policy['SG-SALES-VERIFY'].target_kind).toBe('SCRIPT_VERSION');

  // ---- 9. governed requirement groups: the primary group gains the survey-only rule as a member (a new version of
  // the group, by three people), and an additional required group holds the second
  const groups = (await get(author, `${A}/groups`)).groups as any[];
  const primary = groups.filter((g) => g.kind === 'PRIMARY' && g.status === 'PUBLISHED').at(-1);
  const group = async (body: Record<string, unknown>) => {
    const g = await post(author, `${A}/groups`, body);
    await post(checker, `${A}/groups/${g.id}/decision`, { verdict: 'APPROVE' });
    return post(publisher, `${A}/groups/${g.id}/publish`);
  };
  await group(primary
    ? { code: primary.code, kind: 'PRIMARY', name: primary.name, purpose: 'The primary survey of an application, now also for ILP sold direct (SHARED-1 journey)', sequence: primary.sequence, members: [...primary.members.map((m: any) => ({ rule_code: m.rule_code, rule_version: m.rule_version })), { rule_code: PRIMARY, rule_version: 1 }] }
    : { code: 'PRIMARY-SG', kind: 'PRIMARY', name: 'Primary survey', purpose: 'The primary survey of an application (SHARED-1 journey)', sequence: 1, members: [{ rule_code: PRIMARY, rule_version: 1 }] });
  await group({ code: 'S1-EXTRA-GROUP', kind: 'ADD_REQUIRED', name: 'Extra survey for ILP sold direct', purpose: 'An additional required survey selected by a survey-only rule (SHARED-1 journey)', sequence: 77, members: [{ rule_code: EXTRA, rule_version: 1 }] });

  // ---- single-survey selection on the screen, for an invented application: the survey-only rule wins
  const sim = await session(browser, 'survey_simulator', '/survey-studio/assignment');
  const fields = Object.fromEntries((await get(sim, `${A}/options`)).fields.map((f: any) => [f.field, f.values.map((v: any) => v.value)]));
  const application = { market: 'SG', product_family: 'ILP', selling_channel: 'DIRECT', premium_frequency: 'ANNUAL', case_purpose: fields.case_purpose[0], product_code: null, is_ilp: true, risk_band: 'LOW', contact_role: [] };
  const ev = await post(sim, `${A}/evaluations`, { assignment_inputs: application, facts: {} });
  expect([ev.outcome, ev.selection, ev.survey_version_id, ev.decision.selected.rule]).toEqual(['SELECTED', 'MATCHED', version.A, `${PRIMARY} v1`]);
  expect(ev.call_plan.version_id).toBe(version.A);

  // ---- 10. the composite plan of both surveys, and the existing coordinated simulator
  for (const [f, v] of Object.entries({ product_family: 'ILP', selling_channel: 'DIRECT', premium_frequency: 'ANNUAL' })) await sim.page.getByTestId(`ss-asg-in-${f}`).selectOption(v);
  await sim.page.getByTestId('ss-asg-compose').click();
  const composite = sim.page.getByTestId('ss-asg-composite');
  await expect(composite).toHaveAttribute('data-composite', /.+/);
  const c = await get(sim, `${A}/composite-plans/${await composite.getAttribute('data-composite')}`);
  const mine = (c.composite.selected as any[]).filter((s) => [version.A, version.B].includes(s.survey_version_id));
  expect(mine.map((s) => [s.survey_version_id, s.rule]), JSON.stringify(c.composite.selected.map((s: any) => [s.group, s.rule]))).toEqual([[version.A, `${PRIMARY} v1`], [version.B, `${EXTRA} v1`]]);
  expect([c.selection_status, c.plan_status]).toEqual(['RESOLVED', 'READY']);
  await composite.scrollIntoViewIfNeeded();
  await shot(sim.page, 'SHARED1-07-composite-plan-from-survey-only-rules');
  const co = await post(sim, `${A}/composite-plans/${c.id}/coordinated-simulations`, { label: 'SHARED-1 journey' });
  expect((co.surveys as any[]).map((s) => s.survey_version_id)).toEqual((c.composite.selected as any[]).map((s) => s.survey_version_id));
  await sim.page.goto(`/survey-studio/coordinated-simulations/${co.id}`);
  await expect(sim.page.getByTestId('ss-co-stage')).toBeVisible();
  await expect(sim.page.getByTestId('ss-co-survey-1')).toContainText('SHARED-1 primary survey');
  await shot(sim.page, 'SHARED1-08-coordinated-simulation-of-the-plan');

  // ---- a new version of a rule, and a new binding, never rewrite the recorded composite plan
  const again = await get(sim, `${A}/composite-plans/${c.id}`);
  expect([again.fingerprint, JSON.stringify(again.composite)]).toEqual([c.fingerprint, JSON.stringify(c.composite)]);
  // ---- 7. a binding in another market is refused: a survey of the reader's market only can be chosen at all
  expect(await refused(author, `${A}/bindings`, { rule_code: 'MY-SALES-VERIFY', rule_version: 1, survey_version_id: version.A, note: 'x' })).toBe(404);
  for (const s of [author, checker, publisher, sim]) await s.context.close();
});

test('SHARED-1.3 Finding Rules with their own permissions; the legacy permissions and screens keep working', async ({ browser }) => {
  test.setTimeout(300_000);
  // ---- 13. Finding Rules opened and governed with the dedicated permissions only
  const fa = await session(browser, 'survey_findingauthor', '/finding-rules');
  await expect(fa.page.getByRole('heading', { name: 'Finding Rules', level: 1 })).toBeVisible();
  await expect(fa.page.getByTestId('frs-banner')).toContainText('Synthetic configuration');
  expect(await status(fa, '/api/v1/scripts')).toBe(403);
  expect(await status(fa, '/api/v1/assignment-rules')).toBe(403);
  const published = (await get(fa, '/api/v1/finding-rule-sets')).published_id as string | null;
  const semantics = published ? await get(fa, `/api/v1/finding-rule-sets/${published}`) : null;
  await fa.page.getByTestId('frs-new').click();
  await expect(fa.page.getByTestId('frs-detail')).toBeVisible();
  await shot(fa.page, 'SHARED1-09-finding-rules-with-the-dedicated-permission');
  const list = await get(fa, '/api/v1/finding-rule-sets');
  const draft = list.items.find((i: any) => i.status === 'DRAFT');
  const full = await get(fa, `/api/v1/finding-rule-sets/${draft.id}`);
  // one change to the set: a synthetic rule added — or, where an earlier journey already published a rule for the same
  // scope and outcome (two would be ambiguous, and the server refuses that), that rule's description revised
  const existing = full.rules.map((r: any) => ({ rule_code: r.rule_code, scope: r.scope, target: r.target, mandatory_only: r.mandatory_only, trigger: r.trigger, category: r.category, description: r.description, severity: r.severity, severity_justification: r.severity_justification, review_required: r.review_required }));
  const same = existing.find((r: any) => r.scope === 'ANY_QUESTION' && r.trigger === 'MISMATCH' && !r.mandatory_only);
  const rules = same ? existing.map((r: any) => (r === same ? { ...r, description: `${r.description} (revised in SHARED-1)`.slice(0, 300) } : r))
    : [...existing, { rule_code: 'FR-S1-ANY-MISMATCH', scope: 'ANY_QUESTION', target: null, mandatory_only: false, trigger: 'MISMATCH', category: 'FACT_MISMATCH', description: 'SHARED-1 synthetic rule', severity: 'LOW', severity_justification: 'Synthetic test severity, not an approved threshold', review_required: true }];
  const put = await fa.page.request.put(`/api/v1/finding-rule-sets/${draft.id}`, { data: { expected_row_version: full.row_version, rules }, headers: await csrf(fa.context) });
  expect(put.ok(), await put.text()).toBe(true);
  await post(fa, `/api/v1/finding-rule-sets/${draft.id}/submit`, { expected_row_version: (await put.json()).row_version, change_summary: 'SHARED-1: one synthetic rule added with the dedicated permission' });
  expect(await refused(fa, `/api/v1/finding-rule-sets/${draft.id}/review`, { decision: 'APPROVE', reason: 'mine' })).toBe(403);
  const fc = await session(browser, 'survey_findingchecker', `/finding-rules?version=${draft.id}`);
  await expect(fc.page.getByTestId('frs-detail')).toBeVisible();
  await fc.page.getByTestId('frs-reason').fill('Reviewed (synthetic)');
  await fc.page.getByTestId('frs-approve').click();
  await fc.page.getByTestId('frs-publish').click();
  await expect(fc.page.getByTestId('frs-immutable')).toBeVisible();
  await shot(fc.page, 'SHARED1-10-finding-rule-set-published-by-a-dedicated-checker');
  // ---- 16. the earlier published set is exactly what it was: superseded, with the same rules and fingerprint
  if (semantics) {
    const old = await get(fc, `/api/v1/finding-rule-sets/${published}`);
    expect([old.rules_sha256, JSON.stringify(old.rules), old.status]).toEqual([semantics.rules_sha256, JSON.stringify(semantics.rules), 'SUPERSEDED']);
  }
  expect(await refused(fc, '/api/v1/finding-rule-sets', { empty: true })).toBe(403);
  await fa.context.close(); await fc.context.close();

  // ---- 14, 18. the legacy permissions: Script Studio, Assignment Rules, Finding Rules and the simulator, as before
  const user = await session(browser, 'user', '/scripts');
  await expect(user.page.getByRole('heading', { name: 'Script Studio', level: 1 })).toBeVisible();
  for (const path of ['/api/v1/scripts', '/api/v1/assignment-rules', '/api/v1/finding-rule-sets', '/api/v1/script-assignment-rules']) expect(await status(user, path), path).toBe(200);
  await user.page.goto('/assignment-rules');
  await expect(user.page.getByTestId('new-rule')).toBeVisible();
  await expect(user.page.getByTestId('test-assignment')).toBeVisible();
  await expect(user.page.getByRole('link', { name: 'Script Studio', exact: true }).and(user.page.locator('.btn'))).toBeVisible();
  await user.page.goto('/finding-rules');
  await expect(user.page.getByTestId('frs-versions')).toBeVisible();
  await user.page.goto('/simulator');
  await expect(user.page.getByRole('heading', { name: /Simulation Workbench|Text Simulator/ }).first()).toBeVisible();
  await shot(user.page, 'SHARED1-11-legacy-user-keeps-script-studio-and-rules', false);
  // ---- 12. assignment history is still readable
  const rule = await get(user, '/api/v1/assignment-rules/SG-SALES-VERIFY/history');
  expect(rule.versions.length).toBeGreaterThan(0);
  await user.context.close();

  // ---- 15. nobody gains anything: survey people and a plain reader get no rule authority
  for (const who of ['survey_author', 'survey_reader'] as const) {
    const s = await session(browser, who, '/survey-studio');
    expect(await status(s, '/api/v1/assignment-rules'), `${who} reads assignment rules`).toBe(403);
    expect(await status(s, '/api/v1/finding-rule-sets'), `${who} reads finding rules`).toBe(403);
    expect(await refused(s, '/api/v1/assignment-rules', { code: 'S1-NOPE-2', name: 'Not allowed', target_kind: 'SURVEY_BINDING' })).toBe(403);
    await s.page.goto('/assignment-rules');
    await expect(s.page).toHaveURL(/\/unauthorized/);
    await s.context.close();
  }
  const ra = await session(browser, 'survey_ruleauthor', '/finding-rules');
  await expect(ra.page).toHaveURL(/\/unauthorized/); // one rule capability does not open the other
  await shot(ra.page, 'SHARED1-12-one-capability-does-not-open-the-other', false);
  await ra.context.close();
});
