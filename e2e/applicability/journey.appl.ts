import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// APPL-X1R — Survey Applicability Studio on REAL published Survey Studio surveys, in a real browser against the real
// backend. The global setup published the "Applicability Showcase" surveys through Survey Studio's governed API (three
// different people). One person then works through the owner's showcase journeys in ONE page: every survey offered is
// a published Survey Studio version, and every result is computed by the Python evaluator. The applicability
// workspace lives in the page's memory (nothing is saved), so the journey moves by the application's own navigation
// and never reloads — which is also what proves that leaving for Survey Studio and coming back keeps the work.
const here = dirname(fileURLToPath(import.meta.url));
const account = (): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8')).survey_applauthor;
const SHOTS = 'test-results/applicability/shots';
const B = '/survey-studio/applicability';
const [A_, B_, C_, D_, E_] = ['S-APPL-DEMO-ILP', 'S-APPL-DEMO-NFTF', 'S-APPL-DEMO-COMBINED', 'S-APPL-DEMO-REPLACEMENT', 'S-APPL-DEMO-RIDER'] as const;
const DEMO = 'ILP-AND-NFTF-APPLICABILITY-DEMO';
let page: Page;
const refused: string[] = [];
const shot = async (name: string, full = true) => { if (full) await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
const nav = async (n: number | 'overview') => { await page.getByTestId(`ap-nav-${n}`).click(); };
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const plan = () => page.getByTestId('ap-preview-plan');
const selected = (id = 'ap-preview-plan') => page.getByTestId(`${id}-selected`).locator('li');
const pick = async (testid: string, option: string) => { await page.getByTestId(testid).click(); await page.getByTestId(`${testid}-opt-${option}`).click(); };
const editor = () => page.getByTestId('ap-requirement-editor');
/** Choose published surveys in the rich picker, from inside the requirement editor. */
const link = async (...codes: string[]) => {
  await page.getByTestId('ap-editor-add-survey').click();
  for (const c of codes) await page.getByTestId(`ap-survey-option-${c}-select`).click();
  await page.getByTestId('ap-survey-picker-add').click();
};
const done = async () => { await page.getByTestId('ap-editor-done').click(); await expect(editor()).toHaveCount(0); };
const openPolicy = async (code: string) => { await nav(3); await page.getByTestId(`ap-gallery-${code}-open`).click(); await expect(page.getByTestId('ap-designer')).toBeVisible(); };
const sidebar = (name: string) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true });

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page = await context.newPage();
  page.on('response', (r) => { if (r.status() === 429) refused.push(`${r.request().method()} ${new URL(r.url()).pathname}`); });
  await signIn(page, account(), B);
});
test.afterAll(async () => { expect(refused, 'requests refused as too frequent').toEqual([]); await page.context().close(); });

test('X1R.1 the surveys are real: Survey Studio lists them, published, with modules, questions and branching', async () => {
  await expect(page.getByTestId('ap-catalogue')).toHaveAttribute('data-status', 'ready');
  expect(Number(await page.getByTestId('ap-catalogue').getAttribute('data-count'))).toBeGreaterThanOrEqual(5);
  // APPL-X2: the library is the saved one; policies stay in the tab, and the header says so in one place
  await expect(page.getByTestId('ap-catalogue')).toHaveAttribute('data-library', 'ready');
  // APPL-X3: policies are saved too; only the synthetic scenarios stay in the tab, and the header says so in one place
  await expect(page.getByTestId('ap-catalogue')).toHaveAttribute('data-policies', 'ready');
  await expect(page.getByTestId('ap-prototype-note')).toContainText('All saved');
  await page.getByTestId('ap-prototype-note').click();
  await expect(page.getByTestId('ap-kept-library')).toContainText('Saved in Call360');
  await expect(page.getByTestId('ap-kept-policies')).toContainText('Saved in Call360 as working drafts');
  await expect(page.getByTestId('ap-kept-scenarios')).toContainText('In this tab only');
  await shot('40-header-where-things-are-kept', false);
  await page.getByTestId('ap-prototype-note').click();
  await expect(page.getByTestId('applicability')).not.toContainText(/assignment rule|survey binding|requirement group|priority/i);
  await shot('01-applicability-home');
  // ---- Survey Studio's normal survey listing shows the showcase collection
  await sidebar('Surveys').click();
  for (const name of ['A · ILP product understanding', 'B · NFTF additional questions', 'C · Combined ILP + NFTF', 'D · Replacement scenario', 'E · Rider scenario']) await expect(page.getByText(`Applicability Showcase · ${name} (synthetic demo)`).first()).toBeVisible();
  await shot('05-survey-studio-demo-collection');
  // ---- the published surveys, opened in Survey Studio: each is built from LEGO modules, and all reuse one of them
  const welcome = 'Showcase welcome and understanding check (synthetic)';
  for (const [code, name] of [[A_, '06-published-ilp-survey-a'], [B_, '07-published-nftf-survey-b'], [C_, '08-published-combined-survey-c']] as const) {
    await page.goto(`/survey-studio/surveys/${code}`);
    await expect(page.getByRole('heading', { name: welcome }).first()).toBeVisible({ timeout: 25_000 }); // the same published module in each
    await expect(page.getByRole('heading', { name: 'Showcase closing (synthetic)' }).first()).toBeVisible();
    await shot(name);
  }
  await shot('10-reused-lego-module-in-survey-c');
  // its questions and where each answer leads, in the module builder
  await page.goto(`/survey-studio/surveys/${A_}/modules/mi-ilp-understanding`);
  await expect(page.getByTestId('survey-studio')).toContainText('what do you understand this plan to be for', { timeout: 25_000 });
  await expect(page.getByTestId('survey-studio')).toContainText('Which part would you most like to have explained again');
  await shot('09-survey-a-module-and-branching');
  // ---- real publication history, enforced by Survey Studio
  await page.goto(`/survey-studio/surveys/${A_}/review`);
  await expect(page.getByTestId('survey-studio')).toContainText(/published/i, { timeout: 25_000 });
  await shot('33-survey-studio-publication-history');
  await page.goto(B); // a fresh applicability workspace for the journeys below
  await expect(page.getByTestId('ap-catalogue')).toHaveAttribute('data-status', 'ready');
});

test('X1R.2 Journey A: from a blank policy, an ILP condition linked to the real published Survey A, opened and returned to', async () => {
  await nav(3);
  await expect(page.getByTestId('ap-gallery')).toBeVisible();
  await expect(page.getByTestId('ap-gallery')).toContainText('No policy yet'); // nothing is seeded: a policy exists only once someone saves one
  await shot('02-policy-gallery');
  await page.getByTestId('ap-policy-new-template').click();
  await expect(page.getByTestId('ap-policy-template-replace')).toBeVisible();
  await shot('04-policy-template-selection', false);
  await page.getByTestId('ap-drawer-close').click();
  // ---- a genuinely blank policy
  await page.getByTestId('ap-policy-new-blank').click();
  await page.getByTestId('ap-policy-create-name').fill('ILP and NFTF Applicability Demo');
  await page.getByTestId('ap-policy-create-description').fill('Built from nothing in the showcase journey (synthetic).');
  await shot('03-blank-policy-creation', false);
  await page.getByTestId('ap-policy-create-save').click();
  await expect(page.getByTestId('ap-current-policy')).toHaveText('ILP and NFTF Applicability Demo');
  await expect(page.getByTestId('ap-designer')).toContainText('This policy selects nothing yet');
  // ---- add a requirement: say what you mean → the condition → a real published survey
  await page.getByTestId('ap-add-requirement').click();
  await page.getByTestId('ap-smart-when').click();
  await expect(editor()).toBeVisible();
  await page.getByTestId('ap-editor-name').fill('ILP needs Survey A');
  await expect(page.getByTestId('ap-editor-builder-sentence')).toContainText('“Is ILP”');
  await page.getByTestId('ap-editor-add-survey').click();
  await page.getByTestId('ap-survey-picker-search').fill('showcase');
  await expect(page.getByTestId('ap-survey-picker-count')).toHaveText('5 published');
  await expect(page.getByTestId(`ap-survey-option-${A_}`)).toContainText('Published · version 1.0');
  await shot('11-real-published-survey-picker', false);
  await page.getByTestId(`ap-survey-option-${A_}-preview`).click(); // preview without leaving the picker
  const preview = page.getByTestId('ap-survey-preview');
  await expect(page.getByTestId('ap-preview-structure')).toContainText('3 modules');
  await expect(preview).toContainText('In your own words, what do you understand this plan to be for?');
  await expect(preview).toContainText('Showcase welcome and understanding check (synthetic)'); // the reusable LEGO module
  await expect(page.getByTestId('ap-preview-fingerprint')).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId('ap-preview-history')).toContainText(/Submitted[\s\S]*Approved[\s\S]*Published/);
  await expect(preview.locator('.ap-pv-questions > li.branches').first()).toBeVisible();
  await shot('12-survey-preview-inside-applicability', false);
  await preview.getByTestId('ap-drawer-close').click();
  await page.getByTestId(`ap-survey-option-${A_}-select`).click();
  await page.getByTestId('ap-survey-picker-add').click();
  await expect(page.getByTestId(`ap-editor-ticket-${A_}`)).toHaveAttribute('data-pinned', 'true');
  await done();
  await expect(page.getByTestId(`ap-card-r1-ticket-${A_}`)).toHaveAttribute('data-version', '1.0');
  await expect(page.getByTestId('ap-card-r1')).toContainText('Published in Survey Studio · version 1.0');
  // ---- condition → requirement → published survey → Survey Studio, and back to the same place
  await page.getByTestId(`ap-card-r1-ticket-${A_}`).getByRole('button').first().click();
  await page.getByTestId('ap-preview-open').click();
  await expect(page).toHaveURL(/\/survey-studio\/surveys\/S-APPL-DEMO-ILP$/);
  await expect(page.getByRole('heading', { name: 'ILP product understanding (synthetic)' }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('ss-applicability-return')).toContainText('ILP and NFTF Applicability Demo');
  await shot('34-cross-product-navigation', false);
  await page.getByTestId('ss-applicability-return').getByRole('link').click();
  await expect(page.getByTestId('ap-current-policy')).toHaveText('ILP and NFTF Applicability Demo'); // the in-memory draft survived
  await expect(page.getByTestId(`ap-card-r1-ticket-${A_}`)).toHaveAttribute('data-pinned', 'true');
  await expect(page.getByTestId('ap-unsaved')).toBeVisible();
});

test('X1R.3 Journeys B, D: NFTF → B, ILP AND NFTF → C; all three apply; an unknown fact; a duplicate resolved explicitly', async () => {
  await page.getByTestId('ap-add-requirement').click();
  await page.getByTestId('ap-smart-when').click();
  await page.getByTestId('ap-editor-name').fill('NFTF needs Survey B');
  await page.getByTestId('ap-editor-builder-n0-remove').click();
  await pick('ap-editor-builder-add-saved', 'nftf_applies');
  await link(B_);
  await done();
  await page.getByTestId('ap-add-requirement').click();
  await page.getByTestId('ap-smart-joined').click();
  await page.getByTestId('ap-editor-name').fill('ILP with NFTF needs Survey C');
  await expect(page.getByTestId('ap-editor-builder-sentence')).toContainText('“Is ILP” and “NFTF applies”');
  await link(C_);
  await shot('19-joined-condition-editor', false);
  await done();
  // ---- Scenario 3: both facts true → A + B + C, each an exact published version
  await expect(plan()).toHaveAttribute('data-status', 'RESOLVED');
  await expect(selected()).toHaveCount(3);
  await expect(page.getByTestId('ap-preview-plan-selected')).toContainText(/A · ILP product understanding[\s\S]*B · NFTF additional questions[\s\S]*C · Combined ILP \+ NFTF/);
  await expect(page.getByTestId('ap-preview-plan-selected')).toContainText('version 1.0');
  for (const r of ['r1', 'r2', 'r3']) await expect(page.getByTestId(`ap-card-${r}`)).toHaveAttribute('data-outcome', 'ACTIVE');
  await shot('18-card-composer-with-real-survey-links');
  await shot('25-additive-ilp-nftf-result', false);
  // ---- Journey D / Scenario 9: ILP true, NFTF not known → A definitely, B and C pending, not resolved
  await pick('ap-preview-scenario', 'sc-missing');
  await expect(plan()).toHaveAttribute('data-status', 'UNRESOLVED');
  await expect(selected()).toHaveCount(1);
  await expect(page.getByTestId('ap-preview-plan-selected')).toContainText('A · ILP product understanding');
  await expect(page.getByTestId('ap-preview-plan-pending')).toContainText(/B · NFTF additional questions[\s\S]*C · Combined ILP \+ NFTF/);
  await expect(page.getByTestId('ap-preview-plan-needs')).toContainText('NFTF applies — the application says it is not known');
  await expect(page.getByTestId('ap-card-r2')).toHaveAttribute('data-outcome', 'UNRESOLVED');
  await shot('30-unknown-explanation');
  await pick('ap-preview-scenario', 'sc-both');
  // ---- Scenario 6 / AP-2: two requirements ask for the same survey → never merged silently
  await page.getByTestId('ap-card-r2-edit').click();
  await link(A_);
  await done();
  await expect(plan()).toHaveAttribute('data-status', 'UNRESOLVED');
  await expect(page.getByTestId('ap-preview-plan-diag-DUPLICATE_SURVEY')).toContainText('Nothing says whether that is one delivery or several');
  await expect(page.getByTestId('ap-validation-chip')).not.toHaveAttribute('data-blockers', '0');
  await page.getByTestId(`ap-preview-plan-resolve-${A_}`).click();
  await expect(plan()).toHaveAttribute('data-status', 'RESOLVED');
  await expect(page.getByTestId('ap-preview-plan-diag-SURVEY_SHARED_DELIVERY')).toContainText('one delivery satisfies each of them');
  await expect(page.getByTestId('ap-preview-plan-selected')).toContainText('delivered once for 2 requirements');
  await shot('36-duplicate-survey-resolved-explicitly', false);
  await expect(page.getByTestId('ap-undo')).toHaveAttribute('title', /Undo: State that one delivery/);
  await page.getByTestId('ap-undo').click(); await page.getByTestId('ap-undo').click();
  await expect(selected()).toHaveCount(3);
  await expect(page.getByTestId('ap-validation-chip')).toHaveAttribute('data-blockers', '0');
});

test('X1R.4 Journey C: the combined survey explicitly replaces the two; invalid replacements are blocked beside the requirement', async () => {
  await page.getByTestId('ap-card-r3-edit').click();
  await page.getByTestId('ap-editor-replace-r1').click();
  await page.getByTestId('ap-editor-replace-r2').click();
  await expect(page.getByTestId('ap-editor-replace-preview')).toContainText('A · ILP product understanding, B · NFTF additional questions are no longer required');
  await shot('26b-guided-replacement', false);
  await done();
  await expect(selected()).toHaveCount(1);
  await expect(page.getByTestId('ap-preview-plan-selected')).toContainText('C · Combined ILP + NFTF');
  await expect(page.getByTestId('ap-card-r1')).toHaveAttribute('data-outcome', 'REPLACED');
  await expect(page.getByTestId('ap-card-r1')).toContainText('Replaced by ILP with NFTF needs Survey C');
  await shot('26-exclusive-replacement-result');
  // ---- Scenario 11: a circle is refused, with the reason on the requirement
  await page.getByTestId('ap-card-r1-edit').click();
  await page.getByTestId('ap-editor-replace-r3').click();
  await expect(page.getByTestId('ap-validation-chip')).not.toHaveAttribute('data-blockers', '0');
  await expect(editor()).toContainText(/circle|Chains are not allowed/);
  await shot('36b-invalid-replacement-blocked', false);
  await page.getByTestId('ap-editor-replace-r3').click();
  await done();
  await expect(page.getByTestId('ap-validation-chip')).toHaveAttribute('data-blockers', '0');
  // ---- the same policy as a canvas and as a matrix
  await page.getByTestId('ap-view-canvas').click();
  await expect(page.getByTestId(`ap-node-survey-${C_}`)).toBeVisible();
  await expect(page.getByTestId('ap-node-requirement-r1')).toHaveAttribute('data-tone', 'replaced');
  await shot('20-visual-graph-small-policy');
  await page.getByTestId(`ap-node-survey-${C_}`).click();
  await expect(page.getByTestId('ap-inspector')).toHaveAttribute('data-kind', 'survey');
  await expect(page.getByTestId('ap-survey-selectors')).toContainText('ILP with NFTF needs Survey C');
  await page.getByTestId('ap-inspector-close').click();
  await page.getByTestId('ap-view-matrix').click();
  await expect(page.getByTestId(`ap-matrix-cell-sc-both-${C_}`)).toHaveAttribute('data-mark', 'selected');
  await expect(page.getByTestId(`ap-matrix-cell-sc-both-${A_}`)).toHaveAttribute('data-mark', 'replaced');
  await expect(page.getByTestId(`ap-matrix-cell-sc-ilp-${A_}`)).toHaveAttribute('data-mark', 'selected');
  await expect(page.getByTestId(`ap-matrix-cell-sc-missing-${A_}`)).toHaveAttribute('data-mark', 'pending');
  await shot('24-decision-matrix');
  await page.getByTestId('ap-view-cards').click();
  await page.getByTestId('ap-save-draft').click();
});

test('X1R.5 Journey G: a missing variable and a joined condition made inside the designer; several surveys; a new scenario', async () => {
  await page.getByTestId('ap-add-requirement').click();
  await page.getByTestId('ap-smart-when').click();
  await page.getByTestId('ap-editor-name').fill('A phone sale of an ILP needs two more surveys');
  await page.getByTestId('ap-editor-builder-g-add-fact').click();
  await page.getByTestId('ap-editor-builder-g-add-fact-search').fill('Sold by phone');
  await page.getByTestId('ap-editor-builder-g-add-fact-create').click();
  const wizard = page.getByTestId('ap-variable-drawer');
  await expect(page.getByTestId('ap-var-name')).toHaveValue('Sold by phone');
  await page.getByTestId('ap-var-description').fill('The sale was made over the phone (synthetic).');
  for (let i = 0; i < 5; i += 1) await page.getByTestId('ap-var-next').click();
  await page.getByTestId('ap-var-save').click();
  await expect(wizard).toHaveCount(0);
  await expect(editor()).toBeVisible(); // back in the same requirement, the new fact joined by AND
  await expect(page.getByTestId('ap-editor-builder-sentence')).toContainText('“Is ILP” and Sold by phone is yes');
  await link(D_, E_); // one condition, several published surveys
  await expect(editor().locator('.ap-editor-surveys > li')).toHaveCount(2);
  await done();
  await expect(page.getByTestId('ap-card-r4')).toHaveAttribute('data-outcome', 'UNRESOLVED');
  // ---- a new synthetic scenario, from scratch
  await nav(4);
  await page.getByTestId('ap-scenario-new').click();
  await page.getByTestId('ap-template-both').click();
  await page.getByTestId('ap-scenario-create-name').fill('Phone ILP with NFTF');
  await shot('27-create-scenario');
  await page.getByTestId('ap-scenario-create-save').click();
  await expect(page.getByTestId('ap-result')).toHaveAttribute('data-status', 'UNRESOLVED');
  await expect(page.getByTestId('ap-facts-scope-policy')).toHaveAttribute('aria-checked', 'true'); // only what this policy reads
  await page.getByTestId('ap-facts-scope-all').click();
  await page.getByTestId('ap-facts-search').fill('sold by');
  await page.getByTestId('ap-scenario-facts-sold_by_phone-provide').click();
  await page.getByTestId('ap-scenario-facts-sold_by_phone-value-yes').click();
  await page.getByTestId('ap-facts-search').fill('');
  await page.getByTestId('ap-facts-scope-policy').click();
  await expect(page.getByTestId('ap-result')).toHaveAttribute('data-status', 'RESOLVED');
  await expect(selected('ap-result')).toHaveCount(3);
  await expect(page.getByTestId('ap-result-selected')).toContainText(/C · Combined ILP \+ NFTF[\s\S]*D · Replacement scenario[\s\S]*E · Rider scenario/);
  await expect(page.getByTestId('ap-result-provenance')).toContainText(/policy [0-9a-f]{10}/);
  await shot('28-scenario-fact-editor');
  await page.getByTestId(`ap-result-survey-${E_}`).click();
  await expect(page.getByTestId('ap-survey-path')).toContainText('Sold by phone = yes');
  await shot('29-selected-published-surveys-result');
  // a variant of it: change one fact, see the difference, return to the baseline
  await page.getByTestId('ap-scenario-variant').click();
  await page.getByTestId('ap-scenario-facts-nftf-value-no').click();
  await expect(page.getByTestId('ap-result-selected')).toContainText('A · ILP product understanding');
  await page.getByTestId('ap-facts-only').selectOption('changed');
  await expect(page.getByTestId('ap-facts-count')).toContainText(/^1 of/);
  await page.getByTestId('ap-facts-reset').click();
  await page.getByTestId('ap-facts-only').selectOption('all');
  await expect(page.getByTestId('ap-result-selected')).toContainText('C · Combined ILP + NFTF');
  await page.getByTestId('ap-tab-generate').click();
  await page.getByTestId('ap-generate-run').click();
  await expect(page.getByTestId('ap-coverage')).toContainText('What this does not cover');
  await shot('27b-generated-combinations');
});

test('X1R.6 several policies: a pattern, a copy, a comparison, choose-one with an explicit fallback, a simulated baseline', async () => {
  await nav(3);
  await expect(page.getByTestId(`ap-gallery-${DEMO}`)).toContainText(/Draft saved|Unsaved changes/); // a working draft in Call360
  await page.getByTestId('ap-policy-new-template').click();
  await page.getByTestId('ap-policy-template-choose').click();
  await page.getByTestId('ap-policy-create-name').fill('One survey for an ILP sale');
  await page.getByTestId('ap-policy-create-save').click();
  await expect(page.getByTestId('ap-current-policy')).toHaveText('One survey for an ILP sale');
  await expect(selected()).toHaveCount(1);
  await expect(page.getByTestId('ap-preview-plan-selected')).toContainText('C · Combined ILP + NFTF'); // the one eligible
  await pick('ap-preview-scenario', 'sc-ilp');
  await expect(page.getByTestId('ap-preview-plan-selected')).toContainText('A · ILP product understanding'); // none eligible → the explicit fallback
  await pick('ap-preview-scenario', 'sc-missing');
  await expect(plan()).toHaveAttribute('data-status', 'UNRESOLVED'); // an unknown criterion is never guessed
  await page.getByTestId('ap-card-r1-edit').click();
  await page.getByTestId('ap-editor-alt-1-fallback').click(); // no fallback, no criterion: incomplete, and it says so
  await expect(page.getByTestId('ap-editor-issue-MISSING_CRITERION')).toContainText('mark it as the fallback');
  await shot('36c-choose-one-needs-criterion-or-fallback', false);
  await page.getByTestId('ap-editor-alt-1-fallback').click();
  await done();
  await pick('ap-preview-scenario', 'sc-both');
  // ---- a copy; saved conditions are shared between policies; the gallery compares two
  await nav(3);
  await page.getByTestId(`ap-gallery-${DEMO}-duplicate`).click();
  await expect(page.getByTestId('ap-code-input')).toHaveValue(`${DEMO}-COPY`); // a copy is named and coded before it exists
  await page.getByTestId('ap-policy-create-save').click();
  await expect(page.getByTestId('ap-current-policy')).toHaveText('ILP and NFTF Applicability Demo (copy)');
  await nav(2);
  await page.getByTestId('ap-condition-is_ilp').click();
  await expect(page.getByTestId('ap-condition-uses')).toContainText('ILP and NFTF Applicability Demo (copy)');
  await expect(page.getByTestId('ap-condition-uses')).toContainText('One survey for an ILP sale');
  await shot('14-condition-lab-reused-across-policies');
  await nav(3);
  await page.getByTestId(`ap-gallery-${DEMO}-compare`).click();
  await page.getByTestId(`ap-gallery-${DEMO}-COPY-compare`).click();
  await expect(page.getByTestId('ap-policy-compare')).toBeVisible();
  await shot('02b-policy-comparison');
  // ---- a saved policy has NO simulated publication: the page says what would stand in the way, and offers no approval
  await page.getByTestId(`ap-gallery-${DEMO}-open`).click();
  await nav(5);
  await expect(page.getByTestId('ap-gov-readiness')).toContainText('A policy cannot be submitted, approved or published yet');
  await expect(page.getByTestId('ap-gov-submit')).toHaveCount(0);
  await expect(page.getByTestId('ap-persona')).toHaveCount(0);
  await page.getByTestId('ap-gov-tab-manifest').click();
  await expect(page.getByTestId(`ap-pin-survey-${C_}`)).toContainText('version 1.0');
  await shot('32-readiness-no-simulated-publication');
});

test('X1R.7 scale: 20, 50 and 100 requirements stay navigable in cards and on the canvas', async () => {
  test.setTimeout(240_000);
  for (const n of [20, 50, 100]) {
    await nav(3);
    await page.getByTestId(`ap-policy-scale-${n}`).click();
    await expect(page.getByTestId('ap-cards-count')).toHaveText(`${n} of ${n}`);
    await expect(page.locator('.ap-card[data-open="true"]')).toHaveCount(0); // one line each, not a wall of editors
    if (n === 50) {
      await page.getByTestId('ap-cards-search').fill('broker · endowment'); // Task 7: find the right one among fifty
      const count = Number((await page.getByTestId('ap-cards-count').innerText()).split(' of ')[0]);
      expect(count).toBeGreaterThan(0); expect(count).toBeLessThan(10);
      await shot('18b-card-composer-50-requirements-searched');
      const id = (await page.locator('.ap-card').first().getAttribute('data-testid'))!.replace('ap-card-', '');
      await page.getByTestId(`ap-card-${id}-edit`).click();
      await page.getByTestId('ap-editor-name').fill('Found and renamed among fifty');
      await done();
      await page.getByTestId('ap-cards-search').fill('');
      await expect(page.getByTestId(`ap-card-${id}-name`)).toHaveText('Found and renamed among fifty');
      await page.getByTestId('ap-cards-group').selectOption('survey');
      await expect(page.locator('.ap-cards-grouphead')).toHaveCount(5);
      await page.getByTestId('ap-cards-group').selectOption('none');
    }
    await shot(`18c-card-composer-${n}-requirements`);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByTestId('ap-view-canvas').click();
    await expect(page.getByTestId('ap-canvas-large')).toBeVisible();
    if (await page.getByTestId('ap-canvas-overview').count()) await page.getByTestId('ap-canvas-overview').click(); // a requirement was selected: back to the overview
    await expect(page.getByTestId('ap-canvas-large')).toHaveAttribute('data-mode', 'overview');
    await expect(page.locator('.ap-node.kind-cluster')).toHaveCount(5); // an overview by survey, not a hundred boxes
    const tag = n === 20 ? '21' : n === 50 ? '22' : '23';
    await shot(`${tag}-visual-graph-${n}-requirements-overview`);
    await page.getByTestId(`ap-node-survey-${A_}`).click();
    await expect(page.getByTestId('ap-canvas-large')).toHaveAttribute('data-mode', 'neighbourhood');
    await expect(page.locator('.ap-node.kind-requirement')).toHaveCount(n / 5); // only what selects this survey
    await pick('ap-canvas-goto', 'r7');
    await expect(page.locator('.ap-node.kind-requirement')).toHaveCount(1); // one requirement and what leads to and from it
    await expect(page.getByTestId('ap-inspector')).toHaveAttribute('data-kind', 'requirement');
    await shot(`${tag}b-visual-graph-${n}-requirements-focused`);
    await page.getByTestId('ap-view-cards').click();
  }
});

test('X1R.8 from Survey Studio back to applicability; nothing overflows; no serious accessibility violation', async () => {
  test.setTimeout(240_000);
  // ---- Survey → Where used → applicability policies (the policies open in this tab, and it says so)
  await sidebar('Surveys').click();
  await page.getByText('Applicability Showcase · C · Combined ILP + NFTF (synthetic demo)').first().click();
  const used = page.getByTestId('ss-applicability-where-used');
  await expect(used).toContainText('ILP with NFTF needs Survey C');
  await expect(page.getByTestId(`ss-appl-used-policy-${DEMO}`)).toContainText('pins version 1 of this survey'); // from Call360
  await expect(used).toContainText('Saved policies are read from Call360');
  await shot('34b-survey-studio-where-used', false);
  await page.getByTestId(`ss-appl-used-${DEMO}-r3`).click();
  await expect(page.getByTestId('ap-current-policy')).toHaveText('ILP and NFTF Applicability Demo');
  await expect(page.getByTestId('ap-card-r3')).toHaveClass(/(^| )on( |$)/);
  const stops = [['overview', 'overview'], [1, 'variables'], [2, 'conditions'], [3, 'gallery'], [4, 'scenarios'], [5, 'governance']] as const;
  for (const width of [1280, 900, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [n, name] of stops) {
      await nav(n);
      await page.waitForTimeout(500);
      expect(await overflow(), `${name} at ${width}px overflows sideways`).toBeLessThanOrEqual(0);
      if (width !== 1280 || name === 'gallery') await shot(`35-responsive-${width}-${name}`, width !== 390);
    }
    await openPolicy(DEMO);
    await page.waitForTimeout(600);
    expect(await overflow(), `designer at ${width}px overflows sideways`).toBeLessThanOrEqual(0);
    await shot(`35-responsive-${width}-designer`, width !== 390);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const found: string[] = [];
  const scan = async (name: string) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250); const r = await new AxeBuilder({ page }).include('[data-testid="applicability"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); found.push(...r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${name}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)); };
  for (const [n, name] of stops) { await nav(n); await page.waitForTimeout(500); await scan(name); }
  await openPolicy(DEMO);
  await scan('designer');
  await page.getByTestId('ap-card-r1-edit').click();
  await page.waitForTimeout(500); // the drawer has finished sliding in
  await scan('requirement editor');
  await page.getByTestId('ap-editor-add-survey').click();
  await page.waitForTimeout(300);
  await scan('survey picker');
  expect(found).toEqual([]);
});

test('X1R.9 Journey F: a published showcase survey run on its own in Survey Studio\'s simulator', async ({ browser }) => {
  // the way there from a policy: the preview offers the survey's own simulator and remembers the way back
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); // the picker and the editor left open by the scan
  await expect(editor()).toHaveCount(0);
  await page.getByTestId(`ap-card-r1-ticket-${A_}`).getByRole('button').first().click();
  await page.getByTestId('ap-preview-simulate').click();
  await expect(page).toHaveURL(/\/survey-studio\/surveys\/S-APPL-DEMO-ILP\/simulate$/);
  await expect(page.getByTestId('ss-applicability-return')).toContainText('ILP and NFTF Applicability Demo');
  await page.getByTestId('ss-applicability-return').getByRole('link').click();
  await expect(page.getByTestId('ap-current-policy')).toHaveText('ILP and NFTF Applicability Demo');
  // running the published version needs the simulation permission: in the test environment that is a separate person
  const sim: Account = JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8')).survey_simulator;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await context.newPage();
  await signIn(p2, sim, `/survey-studio/surveys/${A_}/simulate`);
  const q = p2.getByTestId('ss-srv-question');
  const give = async () => { await p2.getByRole('button', { name: 'Give this answer' }).click(); };
  await expect(q).toContainText('Do you remember recently discussing a plan with an adviser?', { timeout: 25_000 });
  await p2.getByTestId('ss-srv-opt-YES').click(); await give();
  await expect(q).toContainText('what do you understand this plan to be for');
  await p2.getByTestId('ss-srv-stage').getByRole('textbox').first().fill('A synthetic free-text answer for the demonstration.'); await give();
  await expect(q).toContainText('Were the main features of the plan explained to you');
  await p2.getByTestId('ss-srv-opt-NO').click(); await give(); // "No" is the branch
  await expect(q).toContainText('Which part would you most like to have explained again?'); // reached only by that answer
  await p2.screenshot({ path: `${SHOTS}/37b-survey-studio-simulator-branch.png` });
  await p2.locator('[data-testid^="ss-srv-opt-"]').first().click(); await give();
  await expect(p2.getByTestId('ss-srv-end')).toBeVisible();
  await p2.screenshot({ path: `${SHOTS}/37-survey-studio-simulator-path-complete.png`, fullPage: true });
  await context.close();
});
