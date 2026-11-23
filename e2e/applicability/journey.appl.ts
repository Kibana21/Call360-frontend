import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// APPL-X1 — Survey Applicability Studio, the PROTOTYPE, in a real browser against the real backend: every result on
// screen is computed by the Python evaluator through the four stateless operations. One person works through the whole
// journey in one page, the way a business user would — define a fact, build conditions, connect surveys, test
// scenarios, review and publish. The numbers in the comments are the owner's acceptance demonstrations (Part 17).
// The workspace lives in the page's memory (nothing is saved), so the journey moves by the application's own
// navigation and never reloads.
const here = dirname(fileURLToPath(import.meta.url));
const account = (): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8')).survey_author;
const SHOTS = 'test-results/applicability/shots';
const B = '/survey-studio/applicability';
let page: Page;
const shot = async (name: string, full = true) => { if (full) await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
const nav = async (n: number | 'overview') => { await page.getByTestId(`ap-nav-${n}`).click(); };
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const selected = (id = 'ap-preview-plan') => page.getByTestId(`${id}-selected`);
const pick = async (testid: string, option: string) => { await page.getByTestId(testid).click(); await page.getByTestId(`${testid}-opt-${option}`).click(); };

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page = await context.newPage();
  await signIn(page, account(), B);
});
test.afterAll(async () => { await page.context().close(); });

test('APPL-X1.1 the workspace: one journey, an honest prototype notice, nothing of the old vocabulary', async () => {
  await expect(page.getByTestId('applicability')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Which surveys does an application need?' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Survey applicability' })).toBeVisible();
  await expect(page.getByTestId('ap-prototype-note')).toContainText('nothing is saved');
  for (const [n, label] of [[1, 'Define facts'], [2, 'Build conditions'], [3, 'Connect surveys'], [4, 'Test scenarios'], [5, 'Approve and publish']] as const) await expect(page.getByTestId(`ap-nav-${n}`)).toContainText(label);
  await expect(page.getByTestId('ap-state-published')).toContainText('Version 1 published');
  await expect(page.getByTestId('ap-state-draft')).toContainText('Version 2 draft');
  await expect(page.getByTestId('ap-sentence-r3')).toContainText('replacing 2 other requirements');
  await expect(page.getByTestId('ap-attn-impact')).toContainText(/changes the result of \d of 7 saved scenarios/);
  await expect(page.getByTestId('ap-attn-sources')).toContainText('NFTF applies');
  // a business user never meets the old mechanism
  await expect(page.getByTestId('applicability')).not.toContainText(/assignment rule|survey binding|requirement group|priority/i);
  await shot('01-applicability-home');
});

test('APPL-X1.2 define facts: a variable from scratch, an enum with values, a profile that combines sets (1–4)', async () => {
  await nav(1);
  await expect(page.getByTestId('ap-variable-count')).toHaveText('12 of 12');
  await shot('02-variable-library');
  // ---- 1, 2. a new enum variable through the guided flow; the flow adapts to the kind chosen
  await page.getByTestId('ap-variable-new').click();
  const drawer = page.getByTestId('ap-variable-drawer');
  await page.getByTestId('ap-var-name').fill('Product family');
  await expect(page.getByTestId('ap-var-twins')).toContainText('already exists'); // a duplicate is pointed out, not silently created
  await page.getByTestId('ap-var-name').fill('Sale method');
  await expect(page.getByTestId('ap-var-twins')).toHaveCount(0);
  await page.getByTestId('ap-var-description').fill('How the customer and the adviser met (synthetic).');
  await page.getByTestId('ap-var-next').click();
  await page.getByTestId('ap-var-type-BOOLEAN').click();
  await page.getByTestId('ap-var-next').click();
  await expect(drawer).toContainText('Nothing to set up'); // a yes/no fact has no range and no list
  await page.getByTestId('ap-var-back').click();
  await page.getByTestId('ap-var-type-ENUM').click();
  await page.getByTestId('ap-var-next').click();
  await expect(page.getByTestId('ap-var-next')).toBeDisabled(); // an enum needs values
  for (const v of ['Face to face', 'Phone', 'Online']) { await page.getByTestId('ap-var-value-new').fill(v); await page.getByTestId('ap-var-value-new').press('Enter'); }
  await expect(page.getByTestId('ap-var-values').locator('li')).toHaveCount(3);
  await shot('03-variable-creation', false);
  await page.getByTestId('ap-var-next').click();
  await page.getByTestId('ap-var-profile-common').click();
  await page.getByTestId('ap-var-next').click();
  await page.getByTestId('ap-var-source-UNMAPPED').click();
  await page.getByTestId('ap-var-next').click();
  await expect(page.getByTestId('ap-var-review')).toContainText('Face to face, Phone, Online');
  await page.getByTestId('ap-var-save').click();
  await expect(page.getByTestId('ap-variable-sale_method')).toBeVisible();
  await page.getByTestId('ap-variable-sale_method').click();
  await expect(page.getByTestId('ap-variable-inspector')).toContainText('No source yet');
  await expect(page.getByTestId('ap-variable-uses')).toContainText('Common insurance application');
  // search and filters; the table view
  await page.getByTestId('ap-variable-search').fill('premium');
  await expect(page.getByTestId('ap-variable-count')).toHaveText('2 of 13');
  await page.getByTestId('ap-variable-search').fill('');
  await page.getByTestId('ap-variable-view-table').click();
  await expect(page.getByTestId('ap-variable-table').locator('tbody tr')).toHaveCount(13);
  await page.getByTestId('ap-variable-view-cards').click();
  // ---- 35. from a variable to everything that depends on it
  await page.getByTestId('ap-variable-nftf').click();
  await expect(page.getByTestId('ap-variable-uses')).toContainText('ILP with NFTF');
  await expect(page.getByTestId('ap-variable-uses')).toContainText('NFTF needs the NFTF survey');

  // ---- 3, 4. profiles: reusable sets that combine; where each variable came from; incompatible sets are reported
  await page.getByRole('tab', { name: 'Application profiles' }).click();
  await page.getByTestId('ap-profile-new').click();
  await page.getByTestId('ap-profile-name').fill('Phone sale extension');
  await page.getByTestId('ap-profile-add-0').click();
  await expect(page.getByTestId('ap-profile-add-0-opt-sale_method')).toBeDisabled(); // already carried by the profile it builds on: never added twice
  await expect(page.getByTestId('ap-profile-add-0-opt-sale_method')).toContainText('already in Common insurance application');
  await page.getByTestId('ap-profile-add-0-opt-selected_riders').click();
  await expect(page.getByTestId('ap-merged-selected_riders')).toContainText('from Phone sale extension');
  await expect(page.getByTestId('ap-merged-sale_method')).toContainText('from Common insurance application');
  await expect(page.getByTestId('ap-merged-product_family')).toContainText('from Common insurance application'); // built on, not copied
  await pick('ap-profile-combine', 'nftf_extension');
  await expect(page.getByTestId('ap-merged-nftf')).toContainText('from NFTF extension');
  await shot('04-profile-composer');
  await page.getByTestId('ap-profile-ilp_extension').click();
  await pick('ap-profile-combine', 'protection_extension');
  await expect(page.getByTestId('ap-profile-conflict')).toContainText('No application can fit both');
  await expect(page.getByTestId('ap-profile-sample')).toBeDisabled();
});

test('APPL-X1.3 build conditions: simple, joined, nested, three-valued, checked for quality (5–9)', async () => {
  await nav(2);
  await page.getByTestId('ap-condition-ilp_with_nftf').click();
  // ---- 7. the joined condition, tested live: ILP yes, NFTF not known → cannot tell, and it says which line is why
  await expect(page.getByTestId('ap-test-result')).toHaveAttribute('data-result', 'TRUE');
  await page.getByTestId('ap-test-facts-nftf-value-unknown').click();
  await expect(page.getByTestId('ap-test-result')).toHaveAttribute('data-result', 'UNKNOWN');
  await expect(page.getByTestId('ap-test-why')).toContainText('NFTF applies: the application says it is not known');
  await expect(page.getByTestId('ap-test-facts-nftf')).toContainText('needed to decide');
  await page.getByTestId('ap-test-facts-product_family-value-PROTECTION').click();
  await expect(page.getByTestId('ap-test-result')).toHaveAttribute('data-result', 'FALSE'); // false AND unknown is false
  await shot('06-condition-lab-advanced');
  await expect(page.getByTestId('ap-condition-uses')).toContainText('ILP with NFTF needs the combined survey');
  await expect(page.getByTestId('ap-condition-quality-ok')).toBeVisible();

  // ---- 5. a simple condition: variable → comparison → value, only valid choices offered
  await page.getByTestId('ap-condition-new').click();
  await page.getByTestId('ap-condition-name').fill('Sold by phone');
  await expect(page.getByTestId('ap-condition-level')).toBeVisible();
  await pick('ap-lab-builder-add-fact', 'sale_method');
  await expect(page.getByTestId('ap-lab-builder-n0-op').locator('option')).toHaveText(['is', 'is not', 'is one of', 'is none of', 'is known', 'is not known']);
  await page.getByTestId('ap-lab-builder-n0-value').selectOption('PHONE');
  await expect(page.getByTestId('ap-lab-builder-sentence')).toContainText('Sale method is Phone');
  await shot('05-condition-lab-simple');
  await expect(page.getByTestId('ap-condition-state')).toHaveAttribute('data-state', 'unsaved');
  await page.getByTestId('ap-condition-save').click();
  await expect(page.getByTestId('ap-condition-sold_by_phone')).toBeVisible();

  // ---- 8. nested AND / OR / NOT, with a saved condition inside
  await page.getByTestId('ap-condition-new').click();
  await page.getByTestId('ap-condition-name').fill('ILP by phone or high premium, not a replacement');
  await page.getByTestId('ap-level-advanced').click();
  await pick('ap-lab-builder-add-saved', 'is_ilp');
  await page.getByTestId('ap-lab-builder-g-add-group').click(); // an "any of" group
  await pick('ap-lab-builder-g1-add-saved', 'sold_by_phone');
  await pick('ap-lab-builder-g1-add-saved', 'high_premium');
  await pick('ap-lab-builder-g-add-saved', 'replacement_applies');
  await page.getByTestId('ap-lab-builder-n2-negate').click();
  await expect(page.getByTestId('ap-lab-builder-sentence')).toContainText('“Is ILP” and (“Sold by phone” or “High premium”) and not “Replacement applies”');
  await expect(page.getByTestId('ap-test-result')).toHaveAttribute('data-result', /TRUE|FALSE|UNKNOWN/);
  await page.getByTestId('ap-condition-save').click();
  // a contradiction is found by the evaluator, not guessed
  await pick('ap-lab-builder-g-add-saved', 'replacement_applies');
  await expect(page.getByTestId('ap-quality-NEVER_TRUE')).toContainText('can never be true');
  await shot('06b-condition-quality-check');
  await page.getByRole('button', { name: 'Discard' }).click();
});

test('APPL-X1.4 connect surveys: cards, replacement and addition, several surveys, alternatives, order (10–20)', async () => {
  await nav(3);
  await expect(page.getByTestId('ap-designer')).toBeVisible();
  // ---- 16. ILP + NFTF with explicit replacement: C replaces A and B
  await expect(page.getByTestId('ap-preview-plan')).toHaveAttribute('data-status', 'RESOLVED');
  await expect(selected().locator('li')).toHaveCount(1);
  await expect(selected()).toContainText('Survey C');
  await expect(page.getByTestId('ap-card-r1')).toHaveAttribute('data-outcome', 'REPLACED');
  await expect(page.getByTestId('ap-card-r3')).toHaveAttribute('data-outcome', 'ACTIVE');
  await shot('11-ilp-nftf-replacement');
  const fp = await page.getByTestId('ap-preview-plan').getAttribute('data-fingerprint');
  // ---- 15. remove the replacement: the three are additive
  for (let i = 0; i < 2; i += 1) await page.getByTestId('ap-card-r3-replaces').getByRole('button', { name: 'Stop replacing it' }).first().click();
  await expect(selected().locator('li')).toHaveCount(3);
  await expect(selected()).toContainText(/Survey A[\s\S]*Survey B[\s\S]*Survey C/);
  await expect(page.getByTestId('ap-unsaved')).toBeVisible();
  await shot('10-ilp-nftf-additive');
  // undo twice restores the replacement, and the same input gives the same fingerprint (44)
  await page.getByTestId('ap-undo').click(); await page.getByTestId('ap-undo').click();
  await expect(selected().locator('li')).toHaveCount(1);
  await expect(page.getByTestId('ap-preview-plan')).toHaveAttribute('data-fingerprint', fp!);
  await page.getByTestId('ap-redo').click(); await page.getByTestId('ap-undo').click();

  // ---- 10, 11. a new requirement in a few clear actions: add → say what you mean → pick the condition → pick the survey
  await page.getByTestId('ap-add-requirement').click();
  await expect(page.getByTestId('ap-smart-add')).toContainText('What do you want to say?');
  await shot('07b-smart-add', false);
  await page.getByTestId('ap-smart-when').click();
  const fresh = page.getByTestId('ap-card-r5');
  await expect(fresh).toBeVisible();
  await page.getByTestId('ap-card-r5-name').fill('A phone sale needs the affordability survey');
  await page.getByTestId('ap-card-r5-builder-n0-remove').click();
  await pick('ap-card-r5-builder-add-saved', 'sold_by_phone');
  await pick('ap-card-r5-add-survey', 'S-E');
  // ---- 12. one condition, several surveys
  await pick('ap-card-r5-add-survey', 'S-F');
  await expect(page.getByTestId('ap-card-r5-then').locator('.ap-tickets > li')).toHaveCount(2);
  await expect(page.getByTestId('ap-order-S-E')).toBeVisible(); // a new survey takes a place in the delivery order
  await expect(page.getByTestId('ap-card-r5')).toHaveAttribute('data-outcome', 'UNRESOLVED'); // the preview does not say how it was sold
  await expect(page.getByTestId('ap-preview-plan')).toHaveAttribute('data-status', 'UNRESOLVED');
  await expect(page.getByTestId('ap-preview-plan-needs')).toContainText('Sale method');
  // ---- 13, 19. several conditions, one survey: stated meaning, never silent
  await pick('ap-card-r4-add-survey', 'S-C');
  await page.getByTestId('ap-inspector-to-preview').click(); // back to the example application's facts
  await page.getByTestId('ap-preview-facts-replacement-value-yes').click();
  await expect(page.getByTestId('ap-preview-plan-diag-SURVEY_REQUIRED_BY_SEVERAL')).toContainText('delivered once and satisfies each of them');
  await page.getByTestId('ap-policy-settings-toggle').click();
  await page.getByTestId('ap-same-CONFLICT').click();
  await expect(page.getByTestId('ap-preview-plan-diag-SAME_SURVEY_CONFLICT')).toContainText('treats that as a conflict');
  await page.getByTestId('ap-same-ONE_DELIVERY').click();
  await page.getByTestId('ap-policy-settings-toggle').click();
  // ---- 18. the delivery order places surveys; it does not select them
  const before = await selected().locator('li').allInnerTexts();
  await page.getByTestId('ap-order-S-D-up').click();
  await expect.poll(async () => (await selected().locator('li').allInnerTexts()).join('|')).not.toBe(before.join('|'));
  await expect(selected().locator('li')).toHaveCount(before.length);
  await page.getByTestId('ap-undo').click();
  // ---- 17. exclusive alternatives: more than one eligible is never settled by list order
  await page.getByTestId('ap-card-r5-choose').click();
  await expect(page.getByTestId('ap-card-r5-alt-0')).toContainText('otherwise');
  await expect(page.getByTestId('ap-validation-chip')).toHaveAttribute('data-blockers', '1'); // two "otherwise" alternatives
  await shot('07c-choose-one');
  await page.getByTestId('ap-card-r5-include').click();
  await expect(page.getByTestId('ap-validation-chip')).toHaveAttribute('data-blockers', '0');
  // ---- 20. UNKNOWN is kept and explained
  await pick('ap-preview-scenario', 'sc-missing');
  await expect(page.getByTestId('ap-preview-plan')).toHaveAttribute('data-status', 'UNRESOLVED');
  await expect(page.getByTestId('ap-card-r1')).toHaveAttribute('data-outcome', 'PENDING');
  await expect(page.getByTestId('ap-preview-plan-needs')).toContainText('NFTF applies — the application says it is not known');
  await shot('14-unknown-explained');
  await pick('ap-preview-scenario', 'sc-both');
  await expect(overflow()).resolves.toBe(0);
  await shot('07-card-composer');
  await page.getByTestId('ap-save-draft').click();
  await expect(page.getByTestId('ap-saved')).toBeVisible();
});

test('APPL-X1.5 the same policy as a canvas and as a matrix; from a survey to what selects it (34)', async () => {
  await page.getByTestId('ap-view-canvas').click();
  await expect(page.getByTestId('ap-canvas')).toBeVisible();
  await expect(page.getByTestId('ap-node-survey-S-C')).toBeVisible();
  await expect(page.getByTestId('ap-node-requirement-r3')).toHaveAttribute('data-tone', 'true');
  await expect(page.getByTestId('ap-node-requirement-r1')).toHaveAttribute('data-tone', 'replaced');
  await expect(page.getByTestId('ap-node-condition-is_ilp')).toHaveCount(1); // one node, however many requirements use it
  await shot('08-visual-graph');
  // ---- 34. select a survey: every condition that can select it, what replaces it, the scenarios that get it
  await page.getByTestId('ap-node-survey-S-C').click();
  await expect(page.getByTestId('ap-inspector')).toHaveAttribute('data-kind', 'survey');
  await expect(page.getByTestId('ap-survey-selectors')).toContainText('ILP with NFTF needs the combined survey');
  await expect(page.getByTestId('ap-survey-selectors')).toContainText('A replacement needs the replacement survey');
  await expect(page.getByTestId('ap-survey-scenarios')).toContainText('ILP + NFTF');
  await page.getByTestId('ap-canvas-focus').click();
  await expect(page.getByTestId('ap-node-survey-S-A')).toHaveCount(0); // focus shows only what leads to the selection
  await shot('08b-graph-focused-on-a-survey');
  await page.getByTestId('ap-canvas-focus').click();
  await page.getByTestId('ap-inspector-close').click();
  // keyboard: the canvas is reachable and a node can be selected without a mouse
  await page.locator('.react-flow__node[data-id="r:r2"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ap-inspector')).toHaveAttribute('data-kind', 'requirement');

  await page.getByTestId('ap-view-matrix').click();
  // the new phone-sale requirement reads a fact no saved scenario gives yet: every row says so instead of guessing
  await expect(page.getByTestId('ap-matrix-row-sc-both')).toHaveAttribute('data-status', 'UNRESOLVED');
  await expect(page.getByTestId('ap-matrix-cell-sc-both-S-E')).toHaveAttribute('data-mark', 'pending');
  await expect(page.getByTestId('ap-matrix-cell-sc-both-S-C')).toHaveAttribute('data-mark', 'selected');
  await expect(page.getByTestId('ap-matrix-cell-sc-both-S-A')).toHaveAttribute('data-mark', 'replaced');
  await expect(page.getByTestId('ap-matrix-cell-sc-ilp-S-A')).toHaveAttribute('data-mark', 'selected');
  await expect(page.getByTestId('ap-matrix-cell-sc-missing-S-A')).toHaveAttribute('data-mark', 'pending');
  await expect(page.getByTestId('ap-matrix-row-sc-invalid')).toContainText('invalid: UNIT_TRUST'); // 30
  await page.getByTestId('ap-matrix-group').selectOption('result');
  await expect(page.getByTestId('ap-matrix-table').locator('.ap-matrix-group')).not.toHaveCount(0);
  await expect(page.getByTestId('ap-matrix-table').locator('.ap-matrix-group').first()).toContainText(/Survey|Not decided|No survey/);
  await shot('09-decision-matrix');
  const download = page.waitForEvent('download');
  await page.getByTestId('ap-matrix-export-json').click();
  expect((await download).suggestedFilename()).toBe('SG-NEW-BUSINESS-v2-test-evidence.json');
  await page.getByTestId('ap-matrix-cell-sc-both-S-A').getByRole('button').click(); // back to the card responsible
  await expect(page.getByTestId('ap-designer')).toHaveAttribute('data-view', 'cards');
  await expect(page.getByTestId('ap-card-r1')).toHaveClass(/(^| )on( |$)/); // the requirement that asked for it, which says what replaces it
  await expect(page.getByTestId('ap-card-r1')).toContainText('Replaced by ILP with NFTF needs the combined survey');
  // the command palette, by keyboard
  await page.keyboard.press('Control+k');
  await page.getByTestId('ap-palette-input').fill('survey b');
  await expect(page.getByTestId('ap-cmd-s-S-B')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ap-inspector')).toHaveAttribute('data-kind', 'survey');
  await expect(page.getByTestId('ap-inspector')).toContainText('Survey B');
});

test('APPL-X1.6 scenarios: create, save, duplicate, templates, live results, generated matrix, impact (21–33)', async () => {
  await nav(4);
  await expect(page.getByTestId('ap-scenarios')).toBeVisible();
  // ---- 21, 24. a new scenario from a profile and a template
  await page.getByTestId('ap-scenario-new').click();
  await page.getByTestId('ap-template-both').click();
  await page.getByTestId('ap-scenario-create-name').fill('Phone ILP with NFTF');
  await shot('12-scenario-creation');
  await page.getByTestId('ap-scenario-create-save').click();
  await expect(page.getByTestId('ap-scenario-name')).toHaveValue('Phone ILP with NFTF');
  await expect(page.getByTestId('ap-result')).toHaveAttribute('data-status', 'UNRESOLVED'); // the sale method is not given yet
  // ---- changing a fact reruns the evaluation at once
  await page.getByTestId('ap-scenario-facts-sale_method-provide').click();
  await page.getByTestId('ap-scenario-facts-sale_method-value-PHONE').click();
  await expect(page.getByTestId('ap-result')).toHaveAttribute('data-status', 'RESOLVED');
  await expect(selected('ap-result')).toContainText(/Survey C[\s\S]*Survey E[\s\S]*Survey F/);
  await expect(page.getByTestId('ap-result-excluded-S-A')).toContainText('replaced by');
  await expect(page.getByTestId('ap-result-provenance')).toContainText(/version 2 \(draft\) · policy [0-9a-f]{10}/);
  // 34: from a selected survey to the path that selected it
  await page.getByTestId('ap-result-survey-S-E').click();
  await expect(page.getByTestId('ap-survey-path')).toContainText('Sale method = Phone');
  await expect(page.getByTestId('ap-scenario-facts-is_ilp-derived')).toContainText('yes'); // a worked-out fact shows its value
  await shot('13-scenario-testing');
  // ---- 22, 23. it is saved (in this tab), reopened, duplicated
  await page.getByTestId('ap-scenario-duplicate').click();
  await expect(page.getByTestId('ap-scenario-name')).toHaveValue('Phone ILP with NFTF (copy)');
  await page.getByTestId('ap-scenario-sc-ilp').click();
  // ---- 25–29. the five core cases
  await expect(selected('ap-result')).toContainText('Survey A');
  await page.getByTestId('ap-scenario-sc-nftf').click();
  await expect(selected('ap-result')).toContainText('Survey B');
  await page.getByTestId('ap-scenario-sc-both').click();
  await expect(selected('ap-result')).toContainText('Survey C');
  await expect(page.getByTestId('ap-scenario-compare')).toContainText('Different from the published version');
  await page.getByTestId('ap-scenario-sc-neither').click();
  await expect(page.getByTestId('ap-result')).toHaveAttribute('data-status', 'UNRESOLVED'); // how it was sold is not known yet
  await page.getByTestId('ap-result-need-sale_method').click();
  await page.getByTestId('ap-scenario-facts-sale_method-provide').click();
  await page.getByTestId('ap-scenario-facts-sale_method-value-FACE_TO_FACE').click();
  await expect(page.getByTestId('ap-result-none')).toBeVisible(); // neither: decided, and no survey is required
  await page.getByTestId('ap-scenario-sc-missing').click();
  await expect(page.getByTestId('ap-result')).toHaveAttribute('data-status', 'UNRESOLVED');
  await expect(page.getByTestId('ap-result-pending')).toContainText('Survey C');
  await page.getByTestId('ap-result-need-nftf').click();
  await expect(page.getByTestId('ap-scenario-facts-nftf')).toHaveAttribute('data-state', 'UNKNOWN');
  // ---- 30. an invalid source fact is reported as invalid, and treated as not known — never as "no"
  await page.getByTestId('ap-scenario-sc-invalid').click();
  await expect(page.getByTestId('ap-scenario-facts-product_family')).toHaveAttribute('data-state', 'INVALID');
  await expect(page.getByTestId('ap-result-diag-FACT_INVALID')).toContainText('not one of the allowed values');
  // the same scenario against the published policy
  await page.getByTestId('ap-scenario-sc-both').click();
  await page.getByTestId('ap-against-published').click();
  await expect(selected('ap-result')).toContainText(/Survey A[\s\S]*Survey B/);
  await page.getByTestId('ap-against-draft').click();

  // ---- 31. a generated matrix that says what it covered
  await page.getByTestId('ap-tab-generate').click();
  await page.getByTestId('ap-generate-run').click();
  await expect(page.getByTestId('ap-coverage-examined')).toContainText('every one');
  expect(Number(await page.getByTestId('ap-coverage-distinct').innerText())).toBeGreaterThan(8);
  await expect(page.getByTestId('ap-coverage')).toContainText('What this does not cover');
  await expect(page.getByTestId('ap-generated').locator('tbody tr')).not.toHaveCount(0);
  await shot('13b-generated-combinations');

  // ---- 32, 33. draft against published: exactly which scenarios change, and which requirement is why
  await page.getByTestId('ap-tab-impact').click();
  await expect(page.getByTestId('ap-impact-sc-both')).toHaveAttribute('data-changed', 'true');
  await expect(page.getByTestId('ap-impact-sc-both-why')).toContainText('Added: Survey C');
  await expect(page.getByTestId('ap-impact-sc-both-why')).toContainText('Removed: Survey A');
  await expect(page.getByTestId('ap-impact-sc-both-why')).toContainText('‘ILP with NFTF needs the combined survey’ is new');
  await expect(page.getByTestId('ap-impact-sc-neither')).toHaveAttribute('data-changed', 'false');
  await expect(page.getByTestId('ap-impact-sc-ilp-why')).toContainText('It was decided and is now undecided'); // a new unknown is called out
  expect(Number(await page.getByTestId('ap-impact-golden').innerText())).toBe(3); // regression scenarios change: flagged for the reviewer
  await shot('15-draft-versus-published-impact');
});

test('APPL-X1.7 review and publish by three people; pinned versions; a newer condition changes nothing (36–42)', async () => {
  await nav(5);
  await expect(page.getByTestId('ap-stages')).toHaveAttribute('data-stage', 'Validated'); // 36
  await page.getByTestId('ap-gov-tab-manifest').click();
  await expect(page.getByTestId('ap-pin-survey-S-C')).toContainText('version 1.0');
  await expect(page.getByTestId('ap-pin-condition-nftf_applies')).toContainText('version 1');
  await page.getByTestId('ap-gov-tab-review').click();
  const fingerprint = await page.getByTestId('ap-gov-fingerprint').innerText();
  expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  await page.getByTestId('ap-gov-note').fill('Adds the combined survey and the replacement survey (synthetic).');
  await page.getByTestId('ap-gov-submit').click(); // 37
  await expect(page.getByTestId('ap-stages')).toHaveAttribute('data-stage', 'In review');
  // ---- 38, 40. the maker cannot approve; a checker can
  await expect(page.getByTestId('ap-gov-approve')).toBeDisabled();
  await expect(page.getByTestId('ap-gov-refused')).toContainText('cannot approve it');
  await shot('16-governance-in-review');
  await page.getByTestId('ap-gov-switch').click();
  await expect(page.getByTestId('ap-persona')).toHaveAttribute('data-persona', 'checker');
  await page.getByTestId('ap-gov-approve').click();
  await expect(page.getByTestId('ap-stages')).toHaveAttribute('data-stage', 'Approved');
  // ---- 39, 40. the approver cannot publish; a third person does
  await expect(page.getByTestId('ap-gov-publish')).toBeDisabled();
  await expect(page.getByTestId('ap-gov-refused')).toContainText('a third person must');
  await page.getByTestId('ap-gov-switch').click();
  await page.getByTestId('ap-gov-publish').click();
  await expect(page.getByTestId('ap-stages')).toHaveAttribute('data-stage', 'Published');
  await expect(page.getByTestId('ap-gov-published')).toContainText('Version 2 published');
  await page.getByTestId('ap-gov-tab-history').click();
  await expect(page.getByTestId('ap-gov-history')).toContainText(/Published version 2[\s\S]*Approved version 2[\s\S]*Submitted version 2/);
  await expect(page.getByTestId('ap-version-1')).toContainText('superseded, kept unchanged');
  await shot('16b-governance-published');
  // ---- 41. the published policy keeps the exact versions it pinned; the designer shows it read only
  await nav(3);
  await expect(page.getByTestId('ap-policy-state')).toHaveAttribute('data-state', 'published');
  // ---- 42. a newer version of a condition does not change what is published
  await nav(2);
  await page.getByTestId('ap-condition-nftf_applies').click();
  await page.getByTestId('ap-lab-builder-n0-op').selectOption('is_false');
  await page.getByTestId('ap-condition-save').click();
  await expect(page.getByTestId('ap-condition-versions')).toContainText(/Version 2[\s\S]*NFTF applies is no[\s\S]*Version 1[\s\S]*NFTF applies is yes/);
  await nav(4);
  await page.getByTestId('ap-scenario-sc-both').click();
  await expect(selected('ap-result')).toContainText('Survey C'); // still decided by version 1 of the condition
  await expect(page.getByTestId('ap-result-provenance')).toContainText('version 2 (published)');
  await nav(5);
  await page.getByTestId('ap-gov-tab-manifest').click();
  await expect(page.getByTestId('ap-pin-condition-nftf_applies')).toContainText('version 1 — version 2 exists and is not used here');
  await page.getByTestId('ap-gov-tab-review').click();
  await expect(page.getByTestId('ap-gov-fingerprint')).toHaveText(fingerprint); // the published fingerprint did not move
});

test('APPL-X1.8 it holds at 1280, 900 and a phone width; no serious accessibility violation', async () => {
  const stops = [['overview', 'overview'], [1, 'variables'], [2, 'conditions'], [3, 'designer'], [4, 'scenarios'], [5, 'governance']] as const;
  for (const width of [1280, 900, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [n, name] of stops) {
      await nav(n);
      await page.waitForTimeout(500);
      expect(await overflow(), `${name} at ${width}px overflows sideways`).toBeLessThanOrEqual(0);
      await shot(`17-responsive-${width}-${name}`, width !== 390);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const found: string[] = [];
  for (const [n, name] of stops) {
    await nav(n);
    await page.waitForTimeout(500);
    const result = await new AxeBuilder({ page }).include('[data-testid="applicability"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    found.push(...result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${name}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`));
  }
  expect(found).toEqual([]);
});
