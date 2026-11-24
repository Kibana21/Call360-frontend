import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// APPL-X4a — the persisted Scenario Studio, in a real browser against the real backend and the isolated TEST database.
// Synthetic scenarios are created, saved and reopened in a NEW browser session; variants show exactly what differs; a
// regression suite states — explicitly — what each scenario must select; a run records immutable evidence that reads
// the same after the policy, a scenario and the library have all changed. Every survey is a REAL published Survey
// Studio version of the "Applicability Showcase" (A ILP, B NFTF, C combined, D replacement, E rider).
const here = dirname(fileURLToPath(import.meta.url));
const accounts = (): Record<string, Account> => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'));
const SHOTS = 'test-results/scenarios/shots';
const B = '/survey-studio/applicability';
const POLICY = 'X4-SHOWCASE';
const S = { A: 'S-APPL-DEMO-ILP', B: 'S-APPL-DEMO-NFTF', C: 'S-APPL-DEMO-COMBINED', D: 'S-APPL-DEMO-REPLACEMENT', E: 'S-APPL-DEMO-RIDER' } as const;
const contexts: BrowserContext[] = [];
const refused: string[] = [];
const errors: string[] = [];
let author: Page, checker: Page, publisher: Page;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const open = async (browser: Browser, who: string, path = `${B}/policies`, viewport = { width: 1440, height: 900 }): Promise<Page> => {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  const p = await context.newPage();
  p.on('response', (r) => { if (r.status() === 429) refused.push(`${r.request().method()} ${new URL(r.url()).pathname}`); });
  p.on('pageerror', (e) => errors.push(`${who}: ${String(e).slice(0, 200)}`));
  await signIn(p, accounts()[who]!, path);
  return p;
};
const shot = async (p: Page, name: string, full = true) => { if (full) await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(450); await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
/** the governed HTTP API, as the signed-in person of that page */
const api = (p: Page, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: Json }> => p.evaluate(async ([u, m, b]) => {
  const csrf = document.cookie.split('; ').find((c) => c.startsWith('c360_csrf='))?.split('=')[1] ?? '';
  const r = await fetch(u as string, { method: m as string, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, [path.startsWith('/') ? path : `/api/v1/applicability/${path}`, method, body ?? null] as const);
const ok = async (p: Page, path: string, method = 'GET', body?: unknown): Promise<Json> => { const r = await api(p, path, method, body); expect(r.status, `${method} ${path}: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300); return r.body; };
const studio = async (p: Page, query = '') => { await p.goto(`${B}/scenarios?policy=${POLICY}${query ? `&${query}` : ''}`); await expect(p.getByTestId('ap-studio')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 }); };
const editor = (p: Page) => p.getByTestId('ap-scn-editor');
const saved = async (p: Page) => { await expect(editor(p)).toHaveAttribute('data-state', 'saved', { timeout: 15_000 }); };
const result = (p: Page) => p.getByTestId('ap-scn-result');
const picked = async (p: Page) => (await p.getByTestId('ap-scn-plan-selected').locator('li').allInnerTexts()).map((t) => (t.match(/· ([A-E]) ·/) ?? [])[1]).join('+') || 'none';
const settled = async (p: Page) => { await expect(result(p)).toHaveAttribute('data-state', /EVALUATED|COULD_NOT_EVALUATE|INVALID_DEFINITION/, { timeout: 15_000 }); await p.waitForTimeout(500); };
const openScenario = async (p: Page, code: string) => { await p.getByTestId('ap-scn-search').fill(code); await p.getByTestId(`ap-scn-${code}`).click(); await expect(editor(p)).toHaveAttribute('data-code', code, { timeout: 15_000 }); await settled(p); };
const fact = (p: Page, code: string) => p.getByTestId(`ap-scn-facts-${code}`);
const give = async (p: Page, code: string, option: string) => { const f = fact(p, code); if (await f.getByTestId(`ap-scn-facts-${code}-provide`).count()) await f.getByTestId(`ap-scn-facts-${code}-provide`).click(); await f.getByTestId(`ap-scn-facts-${code}-value-${option}`).click(); };
const saveScenario = async (p: Page) => { await expect(editor(p)).toHaveAttribute('data-state', 'unsaved'); await p.getByTestId('ap-scn-save').click(); await saved(p); await settled(p); };
const ids: Record<string, string> = {};
const surveys: Record<string, Json> = {};
let policyId = '';

/** A saved scenario through the API (the fast path for the many); the journeys also make them through the screen. */
const scenario = async (code: string, name: string, facts: Json, more: Json = {}) => {
  const made = await ok(author, 'scenarios', 'POST', { market_code: 'SG', code, document: { name, description: 'Synthetic. For the APPL-X4a showcase.', profiles: ['new_business'], facts }, policy_id: policyId, ...more });
  ids[code] = made.id; return made;
};
const expectation = (status: string, selected: string[], pending: string[] = [], more: Json = {}) => ({ status, selected: selected.map((k) => ({ code: surveys[k]!.code, version: surveys[k]!.version, name: surveys[k]!.name })), pending: pending.map((k) => surveys[k]!.code), confirmed: true, ...more });
/** State an expected outcome ON THE SCREEN: status, the surveys that must be selected, those that must be pending — then confirm. */
const state = async (p: Page, code: string, status: string, selected: (keyof typeof S)[], pending: (keyof typeof S)[] = []) => {
  const row = p.getByTestId(`ap-member-${code}`);
  if (!(await p.getByTestId(`ap-expect-${code}`).count())) await row.getByTestId(`ap-member-${code}-open`).click();
  const form = p.getByTestId(`ap-expect-${code}`);
  await form.getByTestId(`ap-expect-${code}-status-${status}`).click();
  for (const k of Object.keys(S) as (keyof typeof S)[]) {
    const box = form.getByTestId(`ap-expect-${code}-survey-${S[k]}`);
    if (((await box.getAttribute('aria-checked')) === 'true') !== selected.includes(k)) await box.click();
  }
  for (const k of pending) { const box = form.getByTestId(`ap-expect-${code}-pending-${S[k]}`); if ((await box.getAttribute('aria-checked')) !== 'true') await box.click(); }
  await form.getByTestId(`ap-expect-${code}-confirm`).click();
  await expect(form).toHaveAttribute('data-confirmed', 'true');
  await row.getByTestId(`ap-member-${code}-open`).click();
};
const suiteSaved = async (p: Page) => { await expect(p.getByTestId('ap-suite-editor')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 }); };
const saveSuite = async (p: Page) => { await p.getByTestId('ap-suite-save').click(); await suiteSaved(p); };
const runSuite = async (p: Page, expected: string) => { await p.getByTestId('ap-suite-run').click(); await expect(p.getByTestId('ap-suite-verdict')).toHaveAttribute('data-status', expected, { timeout: 60_000 }); await p.waitForTimeout(600); };
const openSuite = async (p: Page, code: string) => { await studio(p, 'view=suites'); await p.getByTestId(`ap-suite-${code}`).click(); await suiteSaved(p); };
const verdicts = async (p: Page) => Object.fromEntries(await p.getByTestId('ap-suite-members').locator('> li').evaluateAll((els) => els.map((e) => [e.getAttribute('data-testid')!.replace('ap-member-', ''), e.getAttribute('data-verdict')])));

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async ({ browser }) => {
  author = await open(browser, 'survey_applauthor');
  checker = await open(browser, 'survey_applchecker');
  publisher = await open(browser, 'survey_applpublisher');
  // ---- the REAL published showcase surveys, as a policy refers to them
  const all = (await ok(author, '/api/v1/survey-definitions')).items as Json[];
  for (const [k, code] of Object.entries(S)) {
    const s = all.find((x) => x.code === code)!; const v = await ok(author, `/api/v1/survey-versions/${s.latest_version_id}`);
    expect(v.status).toBe('PUBLISHED');
    surveys[k] = { code, name: s.name, version: v.version_no, label: v.label, version_id: v.id, definition_id: s.id, fingerprint: v.content_sha256, manifest: v.manifest_sha256, market: 'SG' };
  }
  // ---- a saved policy on the governed library: ILP → A, NFTF → B, ILP with NFTF → C, replacement → D, rider → E
  const req = (id: string, name: string, condition: string, k: string, replaces: string[] = []) => ({ id, name, when: { op: 'ref', condition, version: 1 }, action: { kind: 'INCLUDE', surveys: [surveys[k]] }, replaces });
  const made = await ok(author, 'policies', 'POST', { market_code: 'SG', code: POLICY, origin: 'BLANK', document: {
    name: 'ILP and NFTF applicability — scenario showcase', description: 'SYNTHETIC. Which showcase surveys a newly sold policy needs.', profiles: ['new_business'], scope: null, shared_deliveries: [], order: Object.values(S),
    requirements: [req('r1', 'ILP needs Survey A', 'is_ilp', 'A'), req('r2', 'NFTF needs Survey B', 'nftf_applies', 'B'), req('r3', 'ILP with NFTF needs Survey C', 'ilp_with_nftf', 'C'), req('r4', 'A replacement sale needs Survey D', 'replacement_applies', 'D'), req('r5', 'A critical-illness rider needs Survey E', 'rider_includes_ci', 'E')],
  } });
  policyId = made.id;
});
test.afterAll(async () => { expect(refused, 'requests refused as too frequent').toEqual([]); expect(errors, 'errors thrown in the browser').toEqual([]); for (const c of contexts) await c.close().catch(() => undefined); });

test('X4.1 Journey A: a synthetic ILP scenario is created with a name and a reviewed code, saved, the browser closed, and reopened identical', async ({ browser }) => {
  test.setTimeout(240_000);
  await studio(author);
  await expect(author.getByTestId('ap-synthetic-note')).toContainText('Synthetic data only');
  // the list is read before anything can be created (D-418)
  await expect(author.getByTestId('ap-scn-list')).toHaveAttribute('data-state', 'ready');
  await expect(author.getByTestId('ap-scn-list')).toContainText('No saved scenario yet');
  await shot(author, '01-studio-empty');
  await author.getByTestId('ap-scn-new').click();
  await expect(author.getByTestId('ap-scn-create')).toBeVisible();
  // every starting point is offered
  for (const s of ['blank', 'profile', 'template', 'copy', 'variant', 'generated']) await expect(author.getByTestId(`ap-scn-start-${s}`)).toBeVisible();
  await author.getByTestId('ap-scn-start-template').click();
  await author.getByTestId('ap-scn-template-ilp').click();
  await author.getByTestId('ap-policy-create-name').fill('ILP only — sold face to face');
  await expect(author.getByTestId('ap-code-input')).toHaveValue('ILP-ONLY-SOLD-FACE-TO-FACE'); // suggested from the name, after the name
  await expect(author.getByTestId('ap-code-note')).toContainText('The code is permanent');
  await author.getByTestId('ap-code-input').fill('ILP-ONLY');
  await author.getByTestId('ap-scn-create-description').fill('An investment-linked sale, face to face, nothing else.');
  await expect(author.getByTestId('ap-scn-create-purpose-REGRESSION')).toHaveAttribute('aria-checked', 'true');
  await shot(author, '02-create-scenario-guided');
  await author.getByTestId('ap-scn-create-save').click();
  await saved(author); await settled(author);
  ids['ILP-ONLY'] = (await ok(author, 'scenarios?q=ILP-ONLY')).items[0].id;
  // ---- the live result: Survey A, from the server's evaluator, for the SAVED scenario against the SAVED policy
  await expect(result(author)).toHaveAttribute('data-mode', 'SAVED_SCENARIO');
  await expect(result(author)).toHaveAttribute('data-reproducible', 'true');
  await expect(author.getByTestId('ap-scn-source')).toContainText('Reproducible');
  expect(await picked(author)).toBe('A');
  // only the facts this policy reads are shown by default — not every fact of the profile
  const count = await author.getByTestId('ap-scn-facts-count').innerText();
  const [shown, every] = count.match(/\d+/g)!.map(Number);
  expect(shown).toBeLessThan(every!); expect(shown).toBeLessThanOrEqual(6);
  // the template says nothing about riders, and the policy reads them: the result is honestly UNRESOLVED, with Survey E
  // pending and the missing fact named — the studio shows what a scenario still lacks
  await expect(author.getByTestId('ap-scn-plan')).toHaveAttribute('data-status', 'UNRESOLVED');
  await expect(author.getByTestId('ap-scn-plan-needs')).toContainText('Selected riders');
  await expect(fact(author, 'selected_riders')).toHaveAttribute('data-state', 'NOT_PROVIDED');
  // "no rider" is given explicitly (a multi-select with nothing chosen): now every requirement can be decided
  await fact(author, 'selected_riders').getByTestId('ap-scn-facts-selected_riders-provide').click();
  await settled(author);
  expect(await picked(author)).toBe('A+E'); // the sample value offered is a critical-illness rider: Survey E applies at once
  await fact(author, 'selected_riders').getByTestId('ap-scn-facts-selected_riders-value-CI').click(); // … and without it, it does not
  await settled(author);
  await expect(author.getByTestId('ap-scn-plan')).toHaveAttribute('data-status', 'RESOLVED');
  expect(await picked(author)).toBe('A');
  // a type-aware edit: the sales channel (an enumeration) — the result is of an UNSAVED edit and says so
  await author.getByTestId('ap-scn-facts-all').click();
  await give(author, 'sales_channel', 'AGENCY');
  await expect(editor(author)).toHaveAttribute('data-state', 'unsaved');
  await expect(result(author)).toHaveAttribute('data-mode', 'EXPLORATORY', { timeout: 15_000 });
  await expect(author.getByTestId('ap-scn-source')).toContainText('Exploratory — not evidence');
  await shot(author, '03-unsaved-edit-is-exploratory');
  await saveScenario(author);
  await expect(editor(author)).toHaveAttribute('data-revision', '2');
  await expect(result(author)).toHaveAttribute('data-reproducible', 'true');
  // the exact dependencies it was saved against
  await author.getByTestId('ap-scn-deps-toggle').click();
  await expect(author.getByTestId('ap-scn-deps')).toHaveAttribute('data-reproducible', 'true');
  for (const [kind, code] of [['VARIABLE', 'product_family'], ['VARIABLE', 'nftf'], ['VARIABLE', 'sales_channel'], ['PROFILE', 'new_business'], ['PROFILE', 'common'], ['PROFILE', 'nftf_extension']]) await expect(author.getByTestId(`ap-scn-dep-${kind}-${code}`)).toHaveAttribute('data-pinned', '1');
  const before = { fingerprint: await editor(author).getAttribute('data-fingerprint'), snapshot: await editor(author).getAttribute('data-snapshot'), plan: await author.getByTestId('ap-scn-plan').getAttribute('data-fingerprint'), facts: (await ok(author, `scenarios/${ids['ILP-ONLY']}`)).document.facts };
  await shot(author, '04-saved-scenario-with-exact-dependencies');
  // a survey can be previewed as the published Survey Studio content it is
  await author.getByTestId('ap-scn-plan-selected').locator('li').first().getByRole('button').first().click();
  await expect(author.getByTestId('ap-survey-path')).toBeVisible();
  await author.getByTestId('ap-scn-survey-preview').click();
  await expect(author.getByTestId('ap-survey-preview')).toBeVisible();
  await expect(author.getByTestId('ap-survey-preview')).toContainText('ILP product understanding');
  await author.waitForTimeout(900); await shot(author, '05-published-survey-preview', false);
  await author.keyboard.press('Escape');
  // ---- the browser is closed; a NEW session signs in and reopens the same scenario
  await author.context().close();
  author = await open(browser, 'survey_applauthor');
  await studio(author, `s=${ids['ILP-ONLY']}`);
  await saved(author); await settled(author);
  await expect(author.getByTestId('ap-scn-name')).toHaveValue('ILP only — sold face to face');
  expect({ fingerprint: await editor(author).getAttribute('data-fingerprint'), snapshot: await editor(author).getAttribute('data-snapshot'), plan: await author.getByTestId('ap-scn-plan').getAttribute('data-fingerprint'), facts: (await ok(author, `scenarios/${ids['ILP-ONLY']}`)).document.facts }).toEqual(before);
  await author.getByTestId('ap-scn-facts-all').click();
  await expect(fact(author, 'sales_channel').getByTestId('ap-scn-facts-sales_channel-value-AGENCY')).toHaveAttribute('aria-checked', 'true');
  await author.getByTestId('ap-scn-history-toggle').click();
  await expect(author.getByTestId('ap-scn-history')).toContainText('Created · revision 1');
  await expect(author.getByTestId('ap-scn-history')).toContainText('facts changed: Sales channel');
  await shot(author, '06-reopened-in-a-new-browser-session');
  // the "where things are kept" panel is truthful
  await author.getByTestId('ap-prototype-note').click();
  await expect(author.getByTestId('ap-kept-scenarios')).toContainText('Saved in Call360');
  await author.getByTestId('ap-prototype-note').click();
});

test('X4.2 Journey B: a variant is a saved scenario; one changed fact shows exactly which surveys change and why', async () => {
  test.setTimeout(240_000);
  await studio(author, `s=${ids['ILP-ONLY']}`); await saved(author);
  await author.getByTestId('ap-scn-variant').click();
  await expect(author.getByTestId('ap-scn-start-variant')).toHaveAttribute('aria-checked', 'true');
  await expect(author.getByTestId('ap-policy-create-name')).toHaveValue('ILP only — sold face to face — variant');
  await author.getByTestId('ap-policy-create-name').fill('ILP with NFTF');
  await author.getByTestId('ap-code-input').fill('ILP-NFTF');
  await author.getByTestId('ap-scn-create-save').click();
  await saved(author); await settled(author);
  await expect(editor(author)).toHaveAttribute('data-code', 'ILP-NFTF');
  ids['ILP-NFTF'] = (await ok(author, 'scenarios?q=ILP-NFTF')).items.find((x: Json) => x.code === 'ILP-NFTF').id;
  // a fresh variant has the same facts and the same surveys as its baseline
  await expect(author.getByTestId('ap-scn-variant-diff')).toContainText('The same facts as its baseline');
  await expect(author.getByTestId('ap-scn-variant-surveys')).toContainText('Same surveys as the baseline');
  // ONE fact is changed: NFTF applies
  await give(author, 'nftf', 'yes');
  await settled(author);
  await expect(author.getByTestId('ap-scn-variant-facts')).toHaveText(/NFTF applies\s*no\s*yes/);
  expect(await picked(author)).toBe('A+B+C');
  await expect(author.getByTestId('ap-scn-variant-surveys').locator('[data-change="added"]')).toHaveCount(2);
  await shot(author, '07-variant-one-fact-changed-unsaved');
  await saveScenario(author);
  // saved: the server says which requirements are the reason
  await expect(author.getByTestId('ap-scn-variant-why')).toContainText('NFTF needs Survey B');
  await expect(author.getByTestId('ap-scn-variant-why')).toContainText('ILP with NFTF needs Survey C');
  await author.getByTestId('ap-scn-facts-changed').click();
  await expect(author.getByTestId('ap-scn-facts-count')).toContainText('1 of');
  await shot(author, '08-variant-saved-with-the-difference-explained');
  // undo and redo work on the scenario; "reset to baseline" restores the baseline's facts
  await give(author, 'nftf', 'unknown'); await settled(author);
  await expect(result(author).getByTestId('ap-scn-plan')).toHaveAttribute('data-status', 'UNRESOLVED');
  await author.getByTestId('ap-scn-undo').click(); await saved(author);
  await author.getByTestId('ap-scn-facts-reset').click();
  await expect(author.getByTestId('ap-scn-variant-diff')).toContainText('The same facts as its baseline');
  await author.getByTestId('ap-scn-revert').click(); await saved(author);
  // the baseline knows its variants; the variant links back
  await author.getByTestId('ap-scn-baseline-link').click();
  await expect(editor(author)).toHaveAttribute('data-code', 'ILP-ONLY');
  await expect(author.getByTestId('ap-scn-variant-open-ILP-NFTF')).toBeVisible();
  // ---- the rest of the showcase scenarios (through the API, each a real saved scenario; four are variants of the baseline)
  const base = ids['ILP-ONLY'];
  await scenario('NFTF-ONLY', 'NFTF only', { product_family: 'PROTECTION', nftf: true, replacement: false, selected_riders: [] }, { baseline_id: base });
  await scenario('NEITHER', 'Neither ILP nor NFTF', { product_family: 'PROTECTION', nftf: false, replacement: false, selected_riders: [] }, { baseline_id: base });
  await scenario('NFTF-UNKNOWN', 'ILP, NFTF not known', { product_family: 'ILP', nftf: null, replacement: false, selected_riders: [] }, { baseline_id: base });
  await scenario('REPLACEMENT', 'ILP replacement sale', { product_family: 'ILP', nftf: false, replacement: true, selected_riders: [] }, { baseline_id: base });
  await scenario('RIDER-CI', 'Protection with a critical-illness rider', { product_family: 'PROTECTION', nftf: false, replacement: false, selected_riders: ['CI'] });
  await scenario('WHAT-IF', 'What if the channel were a broker', { product_family: 'ILP', nftf: true, sales_channel: 'BROKER' }, { purpose: 'EXPLORATORY' });
  await studio(author);
  await expect(author.getByTestId('ap-scn-count')).toContainText('Showing 8 of 8');
  await expect(author.getByTestId('ap-scn-WHAT-IF')).toHaveAttribute('data-purpose', 'EXPLORATORY');
  await author.getByTestId('ap-scn-purpose-filter').selectOption('EXPLORATORY');
  await expect(author.getByTestId('ap-scn-count')).toContainText('Showing 1 of 1');
  await author.getByTestId('ap-scn-purpose-filter').selectOption('');
  await author.getByTestId('ap-scn-search').fill('rider');
  await expect(author.getByTestId('ap-scn-count')).toContainText('Showing 1 of 1');
  await author.getByTestId('ap-scn-search').fill('');
  await openScenario(author, 'RIDER-CI'); expect(await picked(author)).toBe('E');
  await openScenario(author, 'REPLACEMENT'); expect(await picked(author)).toBe('A+D');
  await author.getByTestId('ap-scn-search').fill('');
  await shot(author, '09-scenario-gallery-with-variants');
  // a generated combination is offered as a starting point, and says that generation is not exhaustive proof
  await author.getByTestId('ap-scn-new').click();
  await author.getByTestId('ap-scn-start-generated').click();
  await expect(author.getByTestId('ap-scn-generated')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(author.getByTestId('ap-scn-generated-note')).toContainText(/every distinct result|NOT every possible application/);
  await expect(author.getByTestId('ap-scn-generated-0')).toBeVisible();
  await shot(author, '10-create-from-a-generated-combination');
  await author.getByTestId('ap-scn-create-cancel').click();
});

test('X4.3 Journey C: a regression suite with explicitly stated expectations is saved, reopened, and run against the saved policy', async () => {
  test.setTimeout(300_000);
  await studio(author, 'view=suites');
  await expect(author.getByTestId('ap-suites')).toHaveAttribute('data-state', 'ready');
  await author.getByTestId('ap-suite-new-empty').click();
  await author.getByTestId('ap-policy-create-name').fill('ILP and NFTF regression');
  await expect(author.getByTestId('ap-code-input')).toHaveValue('ILP-AND-NFTF-REGRESSION');
  await author.getByTestId('ap-code-input').fill('SHOWCASE');
  await expect(author.getByTestId('ap-suite-create-purpose-PUBLICATION_GATING')).toHaveAttribute('aria-checked', 'true');
  await author.getByTestId('ap-suite-create-save').click();
  await suiteSaved(author);
  await expect(author.getByTestId('ap-suite-verdict')).toHaveAttribute('data-status', 'NEVER');
  // the exploratory scenario cannot be added to a publication-gating suite; the regression scenarios can
  await author.getByTestId('ap-suite-add').click();
  await expect(author.getByTestId('ap-suite-add-opt-' + ids['WHAT-IF'])).toBeDisabled();
  await author.keyboard.press('Escape');
  for (const code of ['ILP-ONLY', 'NFTF-ONLY', 'ILP-NFTF', 'NEITHER', 'NFTF-UNKNOWN', 'REPLACEMENT', 'RIDER-CI']) { await author.getByTestId('ap-suite-add').click(); await author.getByTestId('ap-suite-add-opt-' + ids[code]).click(); }
  await expect(author.getByTestId('ap-suite-members').locator('> li')).toHaveCount(7);
  await expect(author.getByTestId('ap-member-ILP-ONLY')).toHaveAttribute('data-verdict', 'NO_EXPECTATION');
  // nothing is expected until a person says so: the "now" column shows what the policy selects, the "expected" column says "not stated"
  await expect(author.getByTestId('ap-member-ILP-ONLY-expected')).toContainText('not stated');
  await expect(author.getByTestId('ap-member-ILP-ONLY-actual')).toContainText('A · ILP product understanding', { timeout: 20_000 });
  // ---- every expected outcome is stated explicitly, survey by survey, and confirmed
  await state(author, 'ILP-ONLY', 'RESOLVED', ['A']);
  await state(author, 'NFTF-ONLY', 'RESOLVED', ['B']);
  await state(author, 'ILP-NFTF', 'RESOLVED', ['A', 'B', 'C']);
  await state(author, 'NEITHER', 'RESOLVED', []);
  await state(author, 'NFTF-UNKNOWN', 'UNRESOLVED', ['A'], ['B', 'C']);
  await state(author, 'REPLACEMENT', 'RESOLVED', ['A', 'D']);
  await state(author, 'RIDER-CI', 'RESOLVED', ['E']);
  // reorder with the keyboard-reachable controls: the rider scenario moves up one place
  await author.getByTestId('ap-member-RIDER-CI-up').click();
  expect(Object.keys(await verdicts(author))).toEqual(['ILP-ONLY', 'NFTF-ONLY', 'ILP-NFTF', 'NEITHER', 'NFTF-UNKNOWN', 'RIDER-CI', 'REPLACEMENT']);
  await author.getByTestId('ap-member-NFTF-UNKNOWN-open').click();
  await shot(author, '11-suite-builder-explicit-expectations');
  await author.getByTestId('ap-member-NFTF-UNKNOWN-open').click();
  // running is not offered while there are unsaved changes: a run uses what is saved
  await expect(author.getByTestId('ap-suite-run')).toBeDisabled();
  await saveSuite(author);
  // ---- saved and reopened: the same members, order and expectations
  await author.reload();
  await expect(author.getByTestId('ap-studio')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await suiteSaved(author);
  expect(Object.keys(await verdicts(author))).toEqual(['ILP-ONLY', 'NFTF-ONLY', 'ILP-NFTF', 'NEITHER', 'NFTF-UNKNOWN', 'RIDER-CI', 'REPLACEMENT']);
  await expect(author.getByTestId('ap-member-NFTF-UNKNOWN-expected')).toContainText('Unresolved');
  await expect(author.getByTestId('ap-member-NFTF-UNKNOWN-expected')).toContainText('+2 pending');
  await expect(author.getByTestId('ap-member-ILP-NFTF-expected').locator('.ap-chip.survey')).toHaveCount(3);
  const stored = await ok(author, `suites/${(await ok(author, `suites?policy_id=${policyId}`)).items[0].id}`);
  ids.SUITE = stored.id;
  expect(stored.member_list.every((m: Json) => m.expectation.confirmed === true && m.expectation.source === 'AUTHORED')).toBe(true);
  // ---- run and record: individual and overall results
  await runSuite(author, 'PASSED');
  await expect(author.getByTestId('ap-suite-verdict')).toContainText('7 of 7 passed');
  expect(new Set(Object.values(await verdicts(author)))).toEqual(new Set(['PASSED'])); // a deliberately expected UNRESOLVED result passes
  await expect(author.getByTestId('ap-member-NFTF-UNKNOWN-actual')).toContainText('Unresolved');
  // coverage of what was run: every requirement applied and did not apply; it says what it is, and is not exhaustive
  const cov = author.getByTestId('ap-coverage');
  await expect(cov).toHaveAttribute('data-meaningful', 'true');
  await expect(cov).toHaveAttribute('data-essential', '0');
  await expect(author.getByTestId('ap-coverage-label')).toContainText('does not prove every possible application');
  for (const r of ['r1', 'r2', 'r3', 'r4', 'r5']) { expect(Number(await author.getByTestId(`ap-coverage-${r}`).getAttribute('data-applies'))).toBeGreaterThan(0); expect(Number(await author.getByTestId(`ap-coverage-${r}`).getAttribute('data-not'))).toBeGreaterThan(0); }
  await expect(author.getByTestId('ap-coverage-conditions')).toBeVisible(); // condition branches not exercised are suggested, not hidden
  await shot(author, '12-suite-run-passed-with-coverage');
});

test('X4.4 Journey D: a wrong expectation fails with the exact difference; nothing is corrected automatically; the person corrects it', async () => {
  test.setTimeout(240_000);
  await openSuite(author, 'SHOWCASE');
  // intentionally wrong: ILP only is said to need Survey B
  await state(author, 'ILP-ONLY', 'RESOLVED', ['B']);
  await saveSuite(author);
  await runSuite(author, 'FAILED');
  await expect(author.getByTestId('ap-suite-verdict')).toContainText('6 of 7 passed');
  await expect(author.getByTestId('ap-member-ILP-ONLY')).toHaveAttribute('data-verdict', 'FAILED');
  const diffs = author.getByTestId('ap-member-ILP-ONLY-differences');
  await expect(diffs.locator('li')).toHaveCount(2);
  await expect(diffs).toContainText('Expected \'Applicability Showcase · B · NFTF additional questions (synthetic demo)\' to be selected; it is not selected');
  await expect(diffs).toContainText('is selected and was not expected');
  await expect(author.getByTestId('ap-member-ILP-ONLY-expected')).toContainText('B · NFTF additional questions');
  await expect(author.getByTestId('ap-member-ILP-ONLY-actual')).toContainText('A · ILP product understanding');
  await shot(author, '13-failed-expected-versus-actual');
  // the failure names the requirement, and the link opens it in the designer
  await author.getByTestId('ap-member-ILP-ONLY-requirement-r1').click();
  await expect(author.getByTestId('ap-designer')).toBeVisible({ timeout: 20_000 });
  // ---- NOTHING was changed by the failing run: the stored expectation is still the wrong one
  const kept = await ok(author, `suites/${ids.SUITE}`);
  expect(kept.member_list.find((m: Json) => m.code === 'ILP-ONLY').expectation.selected.map((s: Json) => s.code)).toEqual([S.B]);
  expect(kept.last_run.status).toBe('FAILED');
  // ---- "use the current result" only PROPOSES: it is not saved until the person confirms it
  await openSuite(author, 'SHOWCASE');
  await author.getByTestId('ap-member-ILP-ONLY-open').click();
  await author.getByTestId('ap-expect-ILP-ONLY-propose').click();
  await expect(author.getByTestId('ap-expect-ILP-ONLY')).toHaveAttribute('data-confirmed', 'false');
  await expect(author.getByTestId('ap-expect-ILP-ONLY')).toHaveAttribute('data-source', 'PROPOSED_FROM_RESULT');
  await expect(author.getByTestId('ap-member-ILP-ONLY')).toHaveAttribute('data-verdict', 'UNCONFIRMED');
  await expect(author.getByTestId('ap-suite-unconfirmed')).toContainText('you have not confirmed');
  await expect(author.getByTestId('ap-suite-save')).toBeDisabled();
  await expect(author.getByTestId('ap-expect-ILP-ONLY-unconfirmed')).toContainText('A result is not proof that it is right');
  await shot(author, '14-proposal-from-result-needs-confirmation');
  // the person discards the proposal and corrects the expectation explicitly instead
  await author.getByTestId('ap-suite-revert').click();
  await state(author, 'ILP-ONLY', 'RESOLVED', ['A']);
  await saveSuite(author);
  await runSuite(author, 'PASSED');
  await expect(author.getByTestId('ap-suite-verdict')).toContainText('7 of 7 passed');
  const after = await ok(author, `suites/${ids.SUITE}`);
  expect(after.member_list.find((m: Json) => m.code === 'ILP-ONLY').expectation.source).toBe('AUTHORED');
  // three runs are on record: passed, failed, passed — the failed one was not replaced
  const runs = (await ok(author, `runs?suite_id=${ids.SUITE}`)).items as Json[];
  expect(runs.map((r) => r.status)).toEqual(['PASSED', 'FAILED', 'PASSED']);
  ids.RUN_FAILED = runs[1]!.id; ids.RUN_PASSED = runs[0]!.id;
});

test('X4.5 Journey E: a published profile version stays pinned; a newer one is offered, adopted deliberately, undone; a mismatch is refused in a gating suite', async () => {
  test.setTimeout(300_000);
  // a dedicated scenario, so that the showcase suite is not disturbed
  await scenario('PINNED', 'Pinned profile example', { product_family: 'ILP', nftf: true, replacement: false, selected_riders: [] });
  await studio(author, `s=${ids.PINNED}`); await saved(author); await settled(author);
  await author.getByTestId('ap-scn-deps-toggle').click();
  const row = author.getByTestId('ap-scn-dep-PROFILE-nftf_extension');
  await expect(row).toHaveAttribute('data-state', 'exact');
  const was = { fingerprint: await editor(author).getAttribute('data-fingerprint'), snapshot: await editor(author).getAttribute('data-snapshot') };
  // ---- version 2 of the profile is published in the TEST library by three different people
  const asset = (await ok(author, 'assets?kind=PROFILE')).items.find((x: Json) => x.code === 'nftf_extension');
  const draft = await ok(author, `assets/${asset.id}/draft`, 'POST', {});
  await ok(author, `assets/${asset.id}/draft`, 'PUT', { expected_revision: draft.draft.revision, document: { ...draft.draft.document, description: 'Revised for the APPL-X4a journey (synthetic).' } });
  const pins = (await ok(author, `assets/${asset.id}/validate`, 'POST', {})).pins as Json[];
  const submitted = await ok(author, `assets/${asset.id}/submit`, 'POST', { expected_revision: (await ok(author, `assets/${asset.id}`)).draft.revision, note: 'journey E', pins: pins.map((p) => ({ kind: p.kind, code: p.code, version_no: p.version_no })) });
  await ok(checker, `candidates/${submitted.candidate.id}/decision`, 'POST', { verdict: 'APPROVE' });
  expect((await ok(publisher, `candidates/${submitted.candidate.id}/publish`, 'POST')).published.version_no).toBe(2);
  // ---- reopened: still version 1, the same fingerprints; version 2 is OFFERED, not applied
  await studio(author, `s=${ids.PINNED}`); await saved(author); await settled(author);
  expect({ fingerprint: await editor(author).getAttribute('data-fingerprint'), snapshot: await editor(author).getAttribute('data-snapshot') }).toEqual(was);
  await author.getByTestId('ap-scn-deps-toggle').click();
  await expect(row).toHaveAttribute('data-state', 'newer');
  await expect(row).toHaveAttribute('data-pinned', '1');
  await expect(row).toContainText('version 2 available');
  await shot(author, '15-newer-profile-version-offered-not-adopted');
  // deliberate adoption is an edit like any other …
  await author.getByTestId('ap-scn-dep-PROFILE-nftf_extension-adopt').click();
  await expect(editor(author)).toHaveAttribute('data-state', 'unsaved');
  await expect(row).toHaveAttribute('data-pinned', '2', { timeout: 15_000 });
  // … and is undone like any other: version 1 again, nothing to save
  await author.getByTestId('ap-scn-undo').click();
  await saved(author);
  await expect(row).toHaveAttribute('data-pinned', '1');
  // adopted again, saved, reloaded
  await author.getByTestId('ap-scn-redo').click();
  await saveScenario(author);
  await author.reload(); await expect(author.getByTestId('ap-studio')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 }); await saved(author);
  await author.getByTestId('ap-scn-deps-toggle').click();
  await expect(row).toHaveAttribute('data-pinned', '2');
  await expect(row).toHaveAttribute('data-state', 'exact');
  expect(await editor(author).getAttribute('data-snapshot')).not.toBe(was.snapshot);
  await shot(author, '16-newer-version-adopted-and-saved');
  // ---- the policy still pins version 1 of that profile. In a publication-gating suite that mismatch must be reconciled:
  //      the run says the test definition is invalid — it does not pass
  const strict = await ok(author, 'suites', 'POST', { market_code: 'SG', code: 'MISMATCH', policy_id: policyId, document: { name: 'Profile mismatch (demonstration)' }, purpose: 'PUBLICATION_GATING', members: [{ scenario_id: ids.PINNED, expectation: expectation('RESOLVED', ['A', 'B', 'C']) }] });
  await openSuite(author, 'MISMATCH');
  await runSuite(author, 'INVALID_DEFINITION');
  await expect(author.getByTestId('ap-member-PINNED')).toHaveAttribute('data-verdict', 'INVALID_DEFINITION');
  await expect(author.getByTestId('ap-member-PINNED-reason')).toContainText('Reconcile them before this scenario can count towards publication');
  await shot(author, '17-profile-mismatch-refused-in-a-gating-suite');
  // the same scenario in an EXPLORATORY suite is evaluated, with the scenario's version, and says so — it never counts
  const loose = await ok(author, 'suites', 'POST', { market_code: 'SG', code: 'MISMATCH-EXPLORE', policy_id: policyId, document: { name: 'Profile mismatch (exploratory)' }, purpose: 'EXPLORATORY', members: [{ scenario_id: ids.PINNED, expectation: expectation('RESOLVED', ['A', 'B', 'C']) }] });
  const run = await ok(author, `suites/${loose.id}/runs`, 'POST', { idempotency_key: 'journey-e-exploratory' });
  expect(run.status).toBe('PASSED'); expect(run.coverage.meaningful_for_publication).toBe(false);
  expect(((await ok(author, `runs/${run.id}/results/1`)).diagnostics as Json[]).map((d) => d.code)).toContain('PROFILE_VERSION_DIFFERS');
  expect(strict.id).toBeTruthy();
});

test('X4.6 Journey F: a recorded run reads the same after the policy, a scenario and the library have changed; it reproduces; runs are compared', async () => {
  test.setTimeout(300_000);
  const first = await ok(author, `runs/${ids.RUN_PASSED}`);
  const full = await ok(author, `runs/${ids.RUN_PASSED}/results/3`);
  // ---- everything around it changes: the policy (C now replaces A and B), and a scenario of the suite
  const pol = await ok(author, `policies/${policyId}?inspection=false`);
  const doc = structuredClone(pol.document); doc.requirements.find((r: Json) => r.id === 'r3').replaces = ['r1', 'r2'];
  await ok(author, `policies/${policyId}/draft`, 'PUT', { expected_revision: pol.draft_revision, document: doc, note: 'C replaces A and B' });
  const neither = await ok(author, `scenarios/${ids.NEITHER}`);
  await ok(author, `scenarios/${ids.NEITHER}/draft`, 'PUT', { expected_revision: neither.draft_revision, document: { ...neither.document, facts: { ...neither.document.facts, selected_riders: ['CI'] } } });
  // (journey E already published a new profile version)
  await studio(author, 'view=runs');
  await expect(author.getByTestId('ap-runs')).toHaveAttribute('data-state', 'ready');
  await expect(author.getByTestId(`ap-run-${ids.RUN_PASSED}`)).toHaveAttribute('data-status', 'PASSED');
  await expect(author.getByTestId(`ap-run-${ids.RUN_FAILED}`)).toHaveAttribute('data-status', 'FAILED');
  await shot(author, '18-recorded-run-history');
  await author.getByTestId(`ap-run-${ids.RUN_PASSED}`).getByTestId('ap-run-open').click();
  const view = author.getByTestId('ap-run-view');
  await expect(view).toHaveAttribute('data-state', 'ready');
  // the record is what it was: the same fingerprints, the same verdicts, the same plans
  await expect(view).toHaveAttribute('data-fingerprint', first.run_sha256);
  await expect(view).toHaveAttribute('data-record', first.record_sha256);
  await expect(view).toHaveAttribute('data-policy-revision', String(first.policy_revision));
  await expect(author.getByTestId('ap-run-immutable')).toContainText(`this run still shows revision ${first.policy_revision}`);
  await expect(author.getByTestId('ap-result-ILP-NFTF')).toHaveAttribute('data-plan', full.plan_fingerprint);
  expect(await ok(author, `runs/${ids.RUN_PASSED}`)).toEqual(first);
  expect(await ok(author, `runs/${ids.RUN_PASSED}/results/3`)).toEqual(full);
  // the full recorded result of one scenario: facts as they were, the versions read, the complete plan
  await author.getByTestId('ap-result-NEITHER-open').click();
  const drawer = author.getByTestId('ap-result-drawer');
  await expect(drawer.getByTestId('ap-result-facts')).toContainText('Selected riders none'); // as recorded — not the later edit
  await expect(drawer.getByTestId('ap-result-plan')).toHaveAttribute('data-status', 'RESOLVED');
  await shot(author, '19-recorded-result-in-full', false);
  await author.keyboard.press('Escape');
  // ---- re-evaluated from the record alone
  await author.getByTestId('ap-run-verify').click();
  await expect(author.getByTestId('ap-run-proof')).toHaveAttribute('data-reproduced', 'true', { timeout: 20_000 });
  await expect(author.getByTestId('ap-run-proof')).toContainText('7 of 7 results re-evaluated to the same fingerprint');
  // ---- what the policy's CURRENT saved draft would do with the same recorded scenarios — not recorded
  await author.getByTestId('ap-run-compare').selectOption('current');
  const cmp = author.getByTestId('ap-run-comparison');
  await expect(cmp).toHaveAttribute('data-kind', 'RUN_TO_CURRENT_DRAFT', { timeout: 20_000 });
  await expect(author.getByTestId('ap-run-comparison-note')).toContainText('NOT recorded');
  const changed = cmp.getByTestId('ap-compare-row').filter({ hasText: 'ILP with NFTF' });
  await expect(changed.locator('[data-change="removed"]')).toHaveCount(2); // A and B are replaced by C
  await expect(changed).toContainText('Failed');
  await shot(author, '20-recorded-run-against-the-current-draft');
  expect((await ok(author, `runs?suite_id=${ids.SUITE}`)).total).toBe(3); // looking recorded nothing
  // ---- a NEW run is a new record with its own outcome; the earlier run is not overwritten
  await openSuite(author, 'SHOWCASE');
  await expect(author.getByTestId('ap-suite-stale')).toContainText('The policy changed after that run');
  await expect(author.getByTestId('ap-member-NEITHER')).toHaveAttribute('data-verdict', 'NOT_RUN');
  await runSuite(author, 'FAILED');
  const now = await verdicts(author);
  expect(now['ILP-NFTF']).toBe('FAILED'); expect(now.NEITHER).toBe('FAILED'); expect(now['ILP-ONLY']).toBe('PASSED');
  const runs = (await ok(author, `runs?suite_id=${ids.SUITE}`)).items as Json[];
  expect(runs).toHaveLength(4);
  expect((await ok(author, `runs/${ids.RUN_PASSED}`)).run_sha256).toBe(first.run_sha256);
  // ---- two recorded runs compared: the changed fact, the changed selection, the reason
  await author.getByTestId('ap-suite-open-last-run').click();
  await expect(author.getByTestId('ap-run-view')).toHaveAttribute('data-status', 'FAILED');
  await author.getByTestId('ap-run-compare').selectOption(ids.RUN_PASSED!);
  await expect(cmp).toHaveAttribute('data-kind', 'RUN_TO_RUN', { timeout: 20_000 });
  const moved = cmp.getByTestId('ap-compare-row').filter({ hasText: 'Neither ILP nor NFTF' });
  await expect(moved).toContainText('fact Selected riders: none → CI');
  await expect(moved.locator('[data-change="added"]')).toContainText('E · Rider');
  await expect(cmp.getByTestId('ap-compare-row').filter({ hasText: 'ILP with NFTF' })).toContainText('replaced');
  await shot(author, '21-two-recorded-runs-compared');
  // the owner's original outcome is restored for the later journeys: the policy is additive again
  const again = await ok(author, `policies/${policyId}?inspection=false`);
  await ok(author, `policies/${policyId}/draft`, 'PUT', { expected_revision: again.draft_revision, document: pol.document, note: 'additive again' });
});

test('X4.7 Journey G: not known, not provided and invalid values are three states, shown as the evaluator reports them', async () => {
  test.setTimeout(180_000);
  await studio(author, `s=${ids['NFTF-UNKNOWN']}`); await saved(author); await settled(author);
  await expect(author.getByTestId('ap-scn-plan')).toHaveAttribute('data-status', 'UNRESOLVED');
  await expect(fact(author, 'nftf')).toHaveAttribute('data-state', 'UNKNOWN');
  expect(await picked(author)).toBe('A');
  await expect(author.getByTestId('ap-scn-plan-pending')).toContainText('B · NFTF additional questions');
  await expect(author.getByTestId('ap-scn-plan-needs')).toContainText('NFTF applies');
  await shot(author, '22-not-known-pending-surveys-and-the-reason');
  // NOT PROVIDED is a different state from NOT KNOWN
  await fact(author, 'nftf').getByTestId('ap-scn-facts-nftf-clear').click(); await settled(author);
  await expect(fact(author, 'nftf')).toHaveAttribute('data-state', 'NOT_PROVIDED');
  await expect(author.getByTestId('ap-scn-plan')).toHaveAttribute('data-status', 'UNRESOLVED');
  await author.getByTestId('ap-scn-revert').click(); await saved(author);
  // an INVALID value can be saved to test it: the server says so, the evaluator treats it as not known, and never as "no"
  const bad = await ok(author, 'scenarios', 'POST', { market_code: 'SG', code: 'INVALID-FAMILY', document: { name: 'A product family that is not allowed', profiles: ['new_business'], facts: { product_family: 'PETS', nftf: false } }, purpose: 'EXPLORATORY', policy_id: policyId });
  await studio(author, `s=${bad.id}`); await saved(author); await settled(author);
  await expect(author.getByTestId('ap-scn-diagnostic').first()).toContainText('not one of the allowed values');
  await expect(fact(author, 'product_family')).toHaveAttribute('data-state', 'INVALID');
  await expect(author.getByTestId('ap-scn-plan')).toHaveAttribute('data-status', 'UNRESOLVED');
  await shot(author, '23-invalid-value-is-not-known-never-false');
  // the screen's states are the Python evaluator's: asked directly, it returns the same three states
  const direct = await ok(author, 'scenarios/evaluate', 'POST', { policy_id: policyId, scenarios: [
    { ref: 'unknown', document: { name: 'nftf not known', facts: { product_family: 'ILP', nftf: null } } }, { ref: 'absent', document: { name: 'nftf not given', facts: { product_family: 'ILP' } } }, { ref: 'invalid', document: { name: 'nftf invalid', facts: { product_family: 'ILP', nftf: 'maybe' } } }] });
  expect(Object.fromEntries((direct.results as Json[]).map((r) => [r.ref, [r.plan.facts.nftf.state, r.plan.status, r.mode]]))).toEqual({ unknown: ['UNKNOWN', 'UNRESOLVED', 'EXPLORATORY'], absent: ['NOT_PROVIDED', 'UNRESOLVED', 'EXPLORATORY'], invalid: ['INVALID', 'UNRESOLVED', 'EXPLORATORY'] });
  // real-looking identifiers are refused, in a name or a note
  for (const name of ['Mrs Tan S1234567D', 'Policy P12345670', 'call tan@example.com']) expect((await api(author, 'scenarios', 'POST', { market_code: 'SG', code: 'REAL-DATA', document: { name, facts: {} } })).body.code).toBe('LOOKS_LIKE_REAL_DATA');
});

test('X4.8 Journey H: a hundred requirements and a hundred and twenty scenarios — paged, bounded, with honest coverage', async () => {
  test.setTimeout(420_000);
  const reqs = Array.from({ length: 100 }, (_, i) => { const n = i + 1; const k = ['A', 'B', 'D', 'E'][i % 4]!; return { id: `q${n}`, name: `Scale requirement ${n}`, when: { op: 'ref', condition: ['is_ilp', 'nftf_applies', 'replacement_applies', 'rider_includes_ci'][i % 4], version: 1 }, action: { kind: 'INCLUDE', surveys: [surveys[k]] }, replaces: [] }; });
  const shared = ['A', 'B', 'D', 'E'].map((k) => ({ survey: surveys[k]!.code, requirements: reqs.filter((r) => r.action.surveys[0]!.code === surveys[k]!.code).map((r) => r.id) }));
  const big = await ok(author, 'policies', 'POST', { market_code: 'SG', code: 'X4-SCALE', origin: 'SCALE', document: { name: 'Scale review — one hundred requirements', description: 'SYNTHETIC. Generated only to review scale.', profiles: ['new_business'], scope: null, shared_deliveries: shared, order: Object.values(S), requirements: reqs } });
  const members: Json[] = [];
  const t0 = Date.now();
  for (let i = 0; i < 120; i += 1) {
    const f = { product_family: i % 2 ? 'ILP' : 'PROTECTION', nftf: [true, false, null][i % 3], replacement: i % 5 === 0, selected_riders: i % 7 === 0 ? ['CI'] : [] };
    const s = await ok(author, 'scenarios', 'POST', { market_code: 'SG', code: `SCALE-${i + 1}`, document: { name: `Scale scenario ${i + 1}`, profiles: ['new_business'], facts: f }, policy_id: big.id });
    const sel = [f.product_family === 'ILP' ? 'A' : null, f.nftf === true ? 'B' : null, f.replacement ? 'D' : null, f.selected_riders.length ? 'E' : null].filter(Boolean) as string[];
    members.push({ scenario_id: s.id, expectation: expectation(f.nftf === null ? 'UNRESOLVED' : 'RESOLVED', sel, f.nftf === null ? ['B'] : []) });
  }
  const created = Date.now() - t0;
  const suite = await ok(author, 'suites', 'POST', { market_code: 'SG', code: 'SCALE-SUITE', policy_id: big.id, document: { name: 'Scale suite — one hundred and twenty scenarios' }, purpose: 'PUBLICATION_GATING', members });
  // ---- the studio follows the scale policy; lists are paged and nothing is evaluated to draw them
  let evaluations = 0;
  author.on('request', (q) => { if (q.url().includes('/scenarios/evaluate')) evaluations += 1; });
  const t1 = Date.now();
  await author.goto(`${B}/scenarios?policy=X4-SCALE`);
  await expect(author.getByTestId('ap-studio')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(author.getByTestId('ap-scn-count')).toContainText('Showing 50 of 120', { timeout: 20_000 });
  const listed = Date.now() - t1;
  await author.waitForTimeout(1200);
  expect(evaluations, 'only the one open scenario is evaluated to show the gallery').toBeLessThanOrEqual(2);
  await author.getByTestId('ap-scn-more').click();
  await expect(author.getByTestId('ap-scn-count')).toContainText('Showing 100 of 120');
  await expect(author.getByTestId('ap-scn-more')).toBeDisabled(); // a page is at most a hundred: search narrows the rest
  await author.getByTestId('ap-scn-search').fill('Scale scenario 117');
  await expect(author.getByTestId('ap-scn-count')).toContainText('Showing 1 of 1');
  await shot(author, '24-scale-gallery-paged', false);
  // ---- the suite: 120 members drawn without a live evaluation of each (that is offered up to 60), then run and recorded
  await author.goto(`${B}/scenarios?policy=X4-SCALE&view=suites&u=${suite.id}`);
  await suiteSaved(author);
  await expect(author.getByTestId('ap-suite-members').locator('> li')).toHaveCount(120);
  const t2 = Date.now();
  await runSuite(author, 'PASSED');
  const ran = Date.now() - t2;
  await expect(author.getByTestId('ap-suite-verdict')).toContainText('120 of 120 passed');
  const run = (await ok(author, `runs?suite_id=${suite.id}`)).items[0] as Json;
  console.log(`X4A-SCALE 120 scenarios created through the API in ${created} ms; gallery of 120 listed in ${listed} ms; suite of 120 × 100 requirements run and recorded in ${ran} ms on screen, ${run.duration_ms} ms evaluating`);
  expect(run.duration_ms).toBeLessThan(30_000);
  // coverage of a hundred requirements: readable, and honest about what it is
  await expect(author.getByTestId('ap-coverage')).toHaveAttribute('data-essential', '0');
  await expect(author.getByTestId('ap-coverage').locator('tbody tr')).toHaveCount(12);
  await author.getByTestId('ap-coverage-all').click();
  await expect(author.getByTestId('ap-coverage').locator('tbody tr')).toHaveCount(100);
  await expect(author.getByTestId('ap-coverage-label')).toContainText('does not prove every possible application');
  await author.getByTestId('ap-coverage-all').click();
  await shot(author, '25-scale-suite-run-and-coverage');
  // ---- the recorded run: fifty results a page, each full plan read on its own
  await author.getByTestId('ap-suite-open-last-run').click();
  await expect(author.getByTestId('ap-run-view')).toHaveAttribute('data-status', 'PASSED');
  await expect(author.getByTestId('ap-run-results').locator('> li')).toHaveCount(50);
  await expect(author.getByTestId('ap-run-range')).toHaveText('1–50 of 120');
  await author.getByTestId('ap-run-next').click(); await author.getByTestId('ap-run-next').click();
  await expect(author.getByTestId('ap-run-range')).toHaveText('101–120 of 120');
  await expect(author.getByTestId('ap-run-results').locator('> li')).toHaveCount(20);
  await author.getByTestId('ap-run-verify').click();
  await expect(author.getByTestId('ap-run-proof')).toContainText('120 of 120 results re-evaluated', { timeout: 60_000 });
  await shot(author, '26-scale-recorded-run-paged');
  // an oversized suite is refused, with the reason
  const tooMany = await api(author, 'suites', 'POST', { market_code: 'SG', code: 'TOO-MANY', policy_id: big.id, document: { name: 'Too many' }, purpose: 'EXPLORATORY', members: Array.from({ length: 201 }, () => ({ scenario_id: members[0]!.scenario_id })) });
  expect(tooMany.status).toBe(422);
});

test('X4.9 Journey I: read-only and unauthorised people; another market; stale, invalid and oversized requests; evidence cannot be changed', async ({ browser }) => {
  test.setTimeout(240_000);
  // ---- a person who may read but not edit: everything is shown, nothing can be changed
  await studio(checker, `s=${ids['ILP-ONLY']}`);
  await expect(editor(checker)).toHaveAttribute('data-state', 'readonly', { timeout: 15_000 });
  await expect(checker.getByTestId('ap-scn-bar-says')).toContainText('Read only');
  await expect(checker.getByTestId('ap-scn-save')).toHaveCount(0);
  await expect(checker.getByTestId('ap-scn-new')).toHaveCount(0);
  await expect(checker.getByTestId('ap-scn-name')).toHaveAttribute('readonly', '');
  await settled(checker); expect(await picked(checker)).toBe('A'); // reading and evaluating are allowed
  await shot(checker, '27-read-only-scenario', false);
  await studio(checker, `view=suites&u=${ids.SUITE}`);
  await expect(checker.getByTestId('ap-suite-editor')).toHaveAttribute('data-state', 'readonly');
  await expect(checker.getByTestId('ap-suite-run')).toHaveCount(0);
  const s = await ok(author, `scenarios/${ids['ILP-ONLY']}`); const u = await ok(author, `suites/${ids.SUITE}`);
  const tries: Record<string, unknown> = {
    'checker creates a scenario': (await api(checker, 'scenarios', 'POST', { market_code: 'SG', code: 'NOPE', document: { name: 'Not allowed', facts: {} } })).status,
    'checker saves a scenario': (await api(checker, `scenarios/${s.id}/draft`, 'PUT', { expected_revision: s.draft_revision, document: s.document })).status,
    'checker archives a scenario': (await api(checker, `scenarios/${s.id}/archive`, 'POST', { expected_revision: s.draft_revision, reason: 'not allowed to do this' })).status,
    'checker saves a suite': (await api(checker, `suites/${u.id}/draft`, 'PUT', { expected_revision: u.draft_revision, document: { name: 'x2' }, purpose: 'EXPLORATORY', members: [] })).status,
    'checker records a run': (await api(checker, `suites/${u.id}/runs`, 'POST', { idempotency_key: 'checker-not-allowed' })).status,
    'author, other market': (await api(author, 'scenarios', 'POST', { market_code: 'MY', code: 'OTHER', document: { name: 'Other market', facts: {} } })).body.code,
    'author, unknown scenario': (await api(author, 'scenarios/00000000-0000-4000-8000-000000000000')).status,
    'author, stale revision': (await api(author, `scenarios/${s.id}/draft`, 'PUT', { expected_revision: 1, document: { ...s.document, description: 'stale' } })).body.code,
    'author, invalid pin': (await api(author, `scenarios/${s.id}/draft`, 'PUT', { expected_revision: s.draft_revision, document: { ...s.document, pins: [{ kind: 'VARIABLE', code: 'nftf', version: 9 }] } })).body.code,
    'author, unknown fact': (await api(author, 'scenarios', 'POST', { market_code: 'SG', code: 'GHOST', document: { name: 'Unknown fact', facts: { no_such_fact: true } } })).body.code,
    'author, unconfirmed expectation': (await api(author, `suites/${u.id}/draft`, 'PUT', { expected_revision: u.draft_revision, document: { name: u.name }, purpose: u.purpose, members: [{ scenario_id: s.id, expectation: { status: 'RESOLVED', selected: [] } }] })).body.code,
    'author, change a recorded run (PUT)': (await api(author, `runs/${ids.RUN_PASSED}`, 'PUT', {})).status,
    'author, delete a recorded run': (await api(author, `runs/${ids.RUN_PASSED}`, 'DELETE')).status,
    'author, write without the CSRF token': await author.evaluate(async (id) => (await fetch(`/api/v1/applicability/suites/${id}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: 'no-csrf-token' }) })).status, u.id),
    'author, wrong CSRF token': await author.evaluate(async (id) => (await fetch(`/api/v1/applicability/suites/${id}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'wrong' }, body: JSON.stringify({ idempotency_key: 'bad-csrf-token' }) })).status, u.id),
  };
  console.log('X4A-SECURITY', JSON.stringify(tries));
  expect(tries).toEqual({ 'checker creates a scenario': 403, 'checker saves a scenario': 403, 'checker archives a scenario': 403, 'checker saves a suite': 403, 'checker records a run': 403, 'author, other market': 'MARKET_NOT_IN_SCOPE', 'author, unknown scenario': 404,
    'author, stale revision': 'STALE_REVISION', 'author, invalid pin': 'INVALID_DEPENDENCY_PIN', 'author, unknown fact': 'UNKNOWN_REFERENCE', 'author, unconfirmed expectation': 'EXPECTATION_NOT_CONFIRMED', 'author, change a recorded run (PUT)': 405, 'author, delete a recorded run': 405,
    'author, write without the CSRF token': 403, 'author, wrong CSRF token': 403 });
  // nothing was changed by any of it
  expect((await ok(author, `scenarios/${s.id}`)).scenario_fingerprint).toBe(s.scenario_fingerprint);
  expect((await ok(author, `suites/${u.id}`)).suite_sha256).toBe(u.suite_sha256);
  // ---- a second editor: the stale save is refused on the screen, nothing overwritten
  const second = await open(browser, 'survey_applsecond', `${B}/scenarios?policy=${POLICY}&s=${ids.NEITHER}`);
  await expect(second.getByTestId('ap-studio')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 }); await saved(second);
  await studio(author, `s=${ids.NEITHER}`); await saved(author);
  await author.getByTestId('ap-scn-description').fill('Edited by the first person.');
  await second.getByTestId('ap-scn-description').fill('Edited by the second person.');
  await second.getByTestId('ap-scn-save').click(); await saved(second);
  await author.getByTestId('ap-scn-save').click();
  await expect(editor(author)).toHaveAttribute('data-state', 'conflict');
  await expect(author.getByTestId('ap-scn-bar-says')).toContainText('Nothing of yours was saved and nothing of theirs was overwritten');
  await expect(author.getByTestId('ap-scn-description')).toHaveValue('Edited by the first person.');
  await shot(author, '28-stale-save-refused', false);
  await author.getByTestId('ap-scn-reload').click(); await saved(author);
  await expect(author.getByTestId('ap-scn-description')).toHaveValue('Edited by the second person.');
  // ---- a person with no applicability permission: the studio is closed
  const outsider = await open(browser, 'survey_author', `${B}/scenarios`);
  await expect(outsider.getByTestId('ap-studio')).toHaveAttribute('data-state', 'forbidden', { timeout: 30_000 });
  expect(await outsider.evaluate(async () => [(await fetch('/api/v1/applicability/scenarios')).status, (await fetch('/api/v1/applicability/suites')).status, (await fetch('/api/v1/applicability/runs')).status])).toEqual([403, 403, 403]);
});

test('X4.11 carry-forward: archived scenarios and suites are restored from the screen; the designer looks at saved scenarios read-only', async () => {
  test.setTimeout(240_000);
  // ---- an archived scenario: kept, shown with who and why, restored after a confirmation
  const s = await scenario('TO-ARCHIVE', 'Archived then restored', { product_family: 'ILP', nftf: false, replacement: false, selected_riders: [] });
  await ok(author, `scenarios/${s.id}/archive`, 'POST', { expected_revision: 1, reason: 'Archived to show that it is kept and can be restored.' });
  await studio(author);
  await expect(author.getByTestId('ap-scn-TO-ARCHIVE')).toHaveCount(0);
  await author.getByTestId('ap-scn-archived-toggle').check();
  await author.getByTestId('ap-scn-TO-ARCHIVE').click();
  await expect(editor(author)).toHaveAttribute('data-state', 'readonly');
  await expect(author.getByTestId('ap-scn-bar-says')).toContainText('Archived by E2E Applicability Author');
  await expect(author.getByTestId('ap-scn-bar-says')).toContainText('“Archived to show that it is kept and can be restored.”');
  await author.getByTestId('ap-scn-restore').click();
  await expect(author.getByTestId('ap-scn-history')).toContainText('Archived · revision 1'); // the history is shown before confirming
  await expect(author.getByTestId('ap-scn-restore-confirm')).toContainText('Restore “Archived then restored”?');
  await shot(author, '31-archived-scenario-restore-confirmation', false);
  await author.getByTestId('ap-scn-restore-ok').click();
  await saved(author);
  await author.getByTestId('ap-scn-history-toggle').click(); await author.getByTestId('ap-scn-history-toggle').click();
  await expect(author.getByTestId('ap-scn-history')).toContainText('Restored · revision 1');
  await author.getByTestId('ap-scn-archived-toggle').uncheck();
  await expect(author.getByTestId('ap-scn-TO-ARCHIVE')).toBeVisible();
  // a person who may not edit sees the archived scenario and no Restore control; the API refuses too
  await ok(author, `scenarios/${s.id}/archive`, 'POST', { expected_revision: 1, reason: 'Archived again for the read-only check.' });
  await studio(checker, `s=${s.id}`);
  await expect(editor(checker)).toHaveAttribute('data-state', 'readonly', { timeout: 15_000 });
  await expect(checker.getByTestId('ap-scn-restore')).toHaveCount(0);
  expect((await api(checker, `scenarios/${s.id}/restore`, 'POST', { expected_revision: 1 })).status).toBe(403);
  // ---- an archived suite: its recorded runs are kept; restored from the screen
  const u = await ok(author, 'suites', 'POST', { market_code: 'SG', code: 'TO-ARCHIVE', policy_id: policyId, document: { name: 'Suite archived then restored' }, purpose: 'EXPLORATORY', members: [{ scenario_id: ids['ILP-ONLY'], expectation: expectation('RESOLVED', ['A']) }] });
  const run = await ok(author, `suites/${u.id}/runs`, 'POST', { idempotency_key: 'before-archiving-it' });
  await ok(author, `suites/${u.id}/archive`, 'POST', { expected_revision: 1, reason: 'Archived to show that its runs are kept.' });
  await studio(author, 'view=suites');
  await expect(author.getByTestId('ap-suite-TO-ARCHIVE')).toHaveCount(0);
  await author.getByTestId('ap-suite-archived-toggle').check();
  await author.getByTestId('ap-suite-TO-ARCHIVE').click();
  await expect(author.getByTestId('ap-suite-editor')).toHaveAttribute('data-state', 'readonly');
  await expect(author.getByTestId('ap-suite-bar-says')).toContainText('its recorded runs are kept');
  await expect(author.getByTestId('ap-suite-history')).toContainText('Archived · revision 1');
  expect((await ok(author, `runs/${run.id}`)).run_sha256).toBe(run.run_sha256); // the evidence of an archived suite still reads
  await author.getByTestId('ap-suite-restore').click();
  await author.getByTestId('ap-suite-restore-ok').click();
  await suiteSaved(author);
  await expect(author.getByTestId('ap-suite-history')).toContainText('Restored · revision 1');
  // ---- the designer: saved scenarios are looked at read-only; the quick examples of the live preview are untouched
  await author.goto(`${B}/policies/${POLICY}`);
  await expect(author.getByTestId('ap-designer')).toBeVisible({ timeout: 30_000 });
  await expect(author.getByTestId('ap-preview-scenario')).toBeVisible(); // the accepted quick preview is still there
  await expect(author.getByTestId('ap-designer-saved-count')).toHaveAttribute('data-count', /\d+/, { timeout: 20_000 });
  const before = { runs: (await ok(author, `runs?policy_id=${policyId}`)).total, scenario: (await ok(author, `scenarios/${ids['ILP-NFTF']}`)).scenario_fingerprint };
  await author.getByTestId('ap-designer-saved').click();
  await author.getByTestId('ap-designer-saved-opt-' + ids['ILP-NFTF']).click();
  const drawer = author.getByTestId('ap-designer-saved-drawer');
  await expect(drawer.getByTestId('ap-designer-saved-source')).toHaveAttribute('data-policy-source', 'SAVED', { timeout: 20_000 });
  await expect(drawer.getByTestId('ap-designer-saved-plan')).toHaveAttribute('data-status', 'RESOLVED');
  await expect(drawer.getByTestId('ap-designer-saved-plan-selected').locator('li')).toHaveCount(3); // A, B and C, from the server
  await expect(drawer.getByTestId('ap-designer-saved-facts')).toContainText('NFTF applies yes');
  await shot(author, '32-designer-looks-at-a-saved-scenario-read-only', false);
  // nothing was changed or recorded by looking
  expect({ runs: (await ok(author, `runs?policy_id=${policyId}`)).total, scenario: (await ok(author, `scenarios/${ids['ILP-NFTF']}`)).scenario_fingerprint }).toEqual(before);
  await drawer.getByTestId('ap-designer-saved-open').click();
  await expect(author.getByTestId('ap-studio')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(editor(author)).toHaveAttribute('data-code', 'ILP-NFTF');
  // ---- an unsaved edit is not silently lost by going to Survey Studio and coming back
  await saved(author);
  await author.getByTestId('ap-scn-description').fill('Edited, not saved yet.');
  await expect(editor(author)).toHaveAttribute('data-state', 'unsaved');
  await author.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Surveys', exact: true }).click();
  await expect(author).toHaveURL(/survey-studio\?view=surveys/);
  await author.goBack();
  await expect(editor(author)).toHaveAttribute('data-state', 'unsaved', { timeout: 20_000 });
  await expect(author.getByTestId('ap-scn-description')).toHaveValue('Edited, not saved yet.');
  await author.getByTestId('ap-scn-revert').click(); await saved(author);
});

test('X4.10 keyboard, four widths and an accessibility scan', async () => {
  test.setTimeout(300_000);
  const found: string[] = [];
  const shell: string[] = [];
  // The studio is everything inside `.ap`. A finding in the application's outer shell (the main navigation, the account
  // button) is not this checkpoint's and is REPORTED, not hidden: it is printed and recorded in the report.
  const scan = async (name: string) => {
    await author.evaluate(() => window.scrollTo(0, 0)); await author.waitForTimeout(300);
    const r = await new AxeBuilder({ page: author }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    for (const x of r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')) for (const n of x.nodes) {
      const inside = await author.evaluate((sel) => { try { return !!document.querySelector(sel)?.closest('.ap'); } catch { return true; } }, String(n.target[0]));
      (inside ? found : shell).push(`${name}: ${x.id} ${n.target.join(' ')}`);
    }
  };
  const pages: [string, string, () => Promise<void>][] = [
    ['scenario', `s=${ids['ILP-NFTF']}`, async () => { await saved(author); await settled(author); }],
    ['suite', `view=suites&u=${ids.SUITE}`, async () => { await suiteSaved(author); }],
    ['run', `view=runs&r=${ids.RUN_FAILED}`, async () => { await expect(author.getByTestId('ap-run-view')).toHaveAttribute('data-state', 'ready'); }],
  ];
  for (const width of [1440, 1280, 900, 390]) {
    await author.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [name, query, wait] of pages) {
      await studio(author, query); await wait();
      const wide = await author.evaluate(() => { const over = document.documentElement.scrollWidth - document.documentElement.clientWidth; const w = document.documentElement.clientWidth; return { over, who: over > 0 ? [...document.querySelectorAll('.ap-studio *')].filter((e) => e.getBoundingClientRect().right > w + 1 && e.getBoundingClientRect().width < w + 200).slice(0, 6).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').join('.')}[${e.getAttribute('data-testid') ?? ''}] right=${Math.round(e.getBoundingClientRect().right)}`) : [] }; });
      expect(wide.over, `${name} at ${width}: no sideways scrolling of the page — ${wide.who.join(' | ')}`).toBeLessThanOrEqual(0);
      await shot(author, `30-${name}-${width}`);
      if (width === 1440 || width === 390) await scan(`${name} at ${width}`);
    }
  }
  await author.setViewportSize({ width: 1440, height: 900 });
  // the create flow, and an open expectation editor
  await studio(author, 'new=1'); await expect(author.getByTestId('ap-scn-create')).toBeVisible(); await scan('create a scenario');
  await studio(author, `view=suites&u=${ids.SUITE}`); await suiteSaved(author); await author.getByTestId('ap-member-ILP-ONLY-open').click(); await scan('expectation editor');
  console.log(`X4A-A11Y-SHELL ${JSON.stringify([...new Set(shell.map((x) => x.replace(/^[^:]+: /, '').replace(/ .*/, '')))])} in the application shell at phone width (${shell.length} nodes) — outside the studio, not changed here`);
  expect(found, 'serious or critical accessibility findings inside the Scenario Studio').toEqual([]);
  // ---- keyboard only: a fact is changed, the scenario saved, an expectation reached and a member reordered
  await studio(author, `s=${ids['WHAT-IF']}`); await saved(author); await settled(author);
  await author.getByTestId('ap-scn-facts-nftf-value-no').focus();
  await author.keyboard.press('Enter');
  await expect(editor(author)).toHaveAttribute('data-state', 'unsaved');
  await author.getByTestId('ap-scn-save').focus(); await author.keyboard.press('Enter'); await saved(author);
  await studio(author, `view=suites&u=${ids.SUITE}`); await suiteSaved(author);
  await author.getByTestId('ap-member-NEITHER-up').focus(); await author.keyboard.press('Enter');
  await expect(author.getByTestId('ap-suite-editor')).toHaveAttribute('data-state', 'unsaved');
  await author.getByTestId('ap-member-NEITHER-open').focus(); await author.keyboard.press('Enter');
  await expect(author.getByTestId('ap-expect-NEITHER')).toBeVisible();
  await author.keyboard.press('Tab');
  expect(await author.evaluate(() => !!document.activeElement?.closest('[data-testid="ap-expect-NEITHER"]'))).toBe(true); // focus moves into the form that opened
  await author.getByTestId('ap-suite-revert').click(); await suiteSaved(author);
});
