import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { accounts, signIn } from '../helpers';

// SS-02A — Survey Studio prototype: the eight evidence journeys (A–H) as one continuous authoring session in Chromium,
// with the prototype build setting ON (playwright.prototype.config.ts). One sign-in; every step is a real interaction
// on the canonical prototype model. Screenshots go to test-results/prototype/shots/.
const SHOTS = 'test-results/prototype/shots';
const shot = async (page: Page, name: string, target?: Locator) => {
  await page.waitForTimeout(260); // let the 120–220 ms transitions settle
  if (target) await target.evaluate((el) => el.scrollIntoView({ block: 'start' })); // cards keep a scroll margin below the sticky bars
  // viewport captures (the app shell has a fixed sidebar and sticky bars, which full-page stitching distorts)
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
/** Automated accessibility scan (WCAG 2.x A/AA rules); serious and critical findings fail the run. */
const a11y = async (page: Page, name: string) => {
  await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).include('[data-testid="survey-studio"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(bad.map((v) => `${name}: ${v.id} (${v.nodes.slice(0, 8).map((x) => x.target.join(' ')).join(', ')}) — ${v.nodes[0]?.failureSummary ?? ''}`)).toEqual([]);
};
const pick = async (page: Page, text: string | RegExp) => page.getByRole('option', { name: text }).first().click();
const typeQuestion = async (card: Locator, text: string) => {
  const box = card.locator('.ss-q-text textarea');
  await box.fill(text);
  await box.blur();
};
const issues = (page: Page) => page.getByTestId('ss-issues');

test('SS-02A journeys A–H: build a survey, shape a module, test a condition, undo and redo', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');

  // ---------------------------------------------------------------------------------------------- A. three-module survey
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Build a callback survey');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Survey Studio' })).toBeVisible();
  await expect(page.getByTestId('ss-no-drafts')).toBeVisible();
  await expect(page.getByTestId('ss-prototype-tag')).toContainText('Prototype');
  await shot(page, 'A1-home-empty-library');
  await shot(page, 'U1-home-and-library');
  await a11y(page, 'home');
  await page.getByTestId('ss-lib-search').fill('review');
  await expect(page.getByTestId('ss-lib-modules').getByRole('listitem')).toHaveCount(1); // search-as-you-type
  await page.getByTestId('ss-lib-search').fill('');

  await page.getByTestId('ss-create').click();
  await page.getByTestId('ss-create-name').fill('New business callback');
  await page.getByTestId('ss-create-purpose').fill('Verify a new policy sale');
  await shot(page, 'A2-create-survey');
  await page.getByTestId('ss-create-go').click();
  await expect(page).toHaveURL(/\/survey-studio\/surveys\/S-NEW-BUSINESS-CALLBACK-1$/);
  await expect(page.getByTestId('ss-add-first')).toBeVisible();
  await expect(issues(page)).toContainText('1 to fix'); // an empty survey is not ready
  await shot(page, 'A3-composer-empty');
  await a11y(page, 'composer-empty');

  await page.getByTestId('ss-add-first').click();
  await page.getByPlaceholder('Search modules to add').fill('general');
  await pick(page, /General verification/);
  await page.getByTestId('ss-shelf-search').fill('suit');
  await page.getByTestId('ss-add-M-SUITABILITY').click();
  await page.getByTestId('ss-shelf-search').fill('');
  await page.getByTestId('ss-add-here-2').click();
  await pick(page, /Closing/);
  const cards = page.locator('[data-testid^="ss-card-"]');
  await expect(cards).toHaveCount(3);
  await expect(page.getByTestId('ss-rule-mi-suitability')).toContainText('when Product family is ILP');
  // exceptional outcomes are never routed for the author
  await expect(page.getByTestId('ss-route-mi-suitability-CLARIFICATION_REQUIRED')).toContainText('Choose what happens');
  await expect(page.getByTestId('ss-route-mi-general-verification-UNABLE_TO_VERIFY')).toContainText('Choose what happens');
  await expect(page.getByTestId('ss-route-mi-general-verification-COMPLETED')).toContainText('continues to Suitability');
  await expect(issues(page)).toContainText('2 to fix');
  await shot(page, 'A4-three-modules-unrouted-outcomes');
  await a11y(page, 'composer-with-issues');

  await issues(page).click();
  await expect(page.getByTestId('ss-issues-list')).toContainText('choose what happens on "Unable to verify"');
  await shot(page, 'A5-issues-list');
  await page.keyboard.press('Escape');
  await page.getByTestId('ss-route-mi-general-verification-UNABLE_TO_VERIFY').click();
  await pick(page, 'End the call: Unable to verify');
  await page.getByTestId('ss-route-mi-suitability-CLARIFICATION_REQUIRED').click();
  await pick(page, /Continue to the next module/);
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'A6-three-modules-ready');
  await shot(page, 'U2-lego-composer');
  // SS-02A.2: routing being complete is not "ready" — wording approval and publication are reported apart from it
  await issues(page).click();
  await expect(page.getByTestId('ss-readiness')).toContainText('Complete: every answer leads somewhere');
  await expect(page.getByTestId('ss-readiness')).toContainText('8 of 8 questions use wording that is not approved');
  await expect(page.getByTestId('ss-readiness')).toContainText(/Ready to publish\s*No\./);
  await shot(page, 'U8-readiness-routing-wording-publication');
  await page.keyboard.press('Escape');

  // -------------------------------------------------------------------------------------- open a module: shared → draft copy
  await page.getByTestId('ss-open-mi-suitability').click();
  await expect(page.getByTestId('ss-lockbar')).toContainText('approved library version');
  await shot(page, 'B0-module-shared-read-only');
  await page.getByTestId('ss-derive').click();
  await expect(page.getByTestId('ss-lockbar')).toHaveCount(0);
  await expect(page.locator('.ss-crumbs')).toContainText('Draft v2 · this survey only');

  // ------------------------------------------------------------------------------------------- B. Yes/No with two routes
  await page.getByTestId('ss-insert-n1-YES').click();
  await shot(page, 'B1-insert-menu');
  await page.getByTestId('ss-new-YES_NO').click();
  const n4 = page.getByTestId('ss-q-n4');
  await typeQuestion(n4, 'Did your representative explain the charges?');
  await expect(page.getByTestId('ss-dest-n4-ANY')).toContainText('Do you understand the key risks'); // inherited the former destination
  await n4.getByRole('radio', { name: 'Different next questions' }).click();
  await expect(page.getByTestId('ss-dest-n4-YES')).toContainText('Do you understand the key risks');
  await expect(page.getByTestId('ss-dest-n4-NO')).toContainText('Choose destination'); // never invented
  await expect(issues(page)).toContainText('1 to fix');
  await shot(page, 'B2-yes-no-unresolved-route');
  await a11y(page, 'builder-with-issue');
  await page.getByTestId('ss-dest-n4-NO').click();
  await pick(page, 'End module: Clarification required');
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'B3-yes-no-two-routes', n4);
  await shot(page, 'U3-simple-yes-no-question', n4);

  // ---------------------------------------------------------------- C. five-option single choice, dedicated destinations
  await page.getByTestId('ss-insert-n4-YES').click();
  await page.getByTestId('ss-new-SINGLE_SELECT').click();
  const n5 = page.getByTestId('ss-q-n5');
  await typeQuestion(n5, 'Which part of the plan matters most to you?');
  const add = page.getByTestId('ss-option-new-n5');
  for (const label of ['Premium', 'Benefits', 'Claims', 'Charges', 'Nothing in particular']) {
    await add.fill(label);
    await add.press('Enter'); // focus stays in the field: five options are five lines of typing
  }
  await expect(n5.locator('.ss-option')).toHaveCount(5);
  await page.getByTestId('ss-more-n5-NOTHING_IN_PARTICULAR').click(); // the stable code lives in the answer's More menu
  await expect(page.getByTestId('ss-option-menu')).toContainText('NOTHING_IN_PARTICULAR');
  await page.keyboard.press('Escape');
  await shot(page, 'C1-five-options-everybody-continues', n5);
  await n5.getByRole('radio', { name: 'Different next questions' }).click();
  await expect(issues(page)).toContainText('4 to fix');
  await page.getByTestId('ss-dest-n5-BENEFITS').click();
  await shot(page, 'C2-destination-picker');
  await page.getByTestId('ss-dest-n5-BENEFITS-new-YES_NO').click(); // create the follow-on question right here
  const n6 = page.getByTestId('ss-q-n6');
  await typeQuestion(n6, 'Do the benefits match what was explained to you?');
  await page.getByTestId('ss-dest-n6-ANY').click();
  await pick(page, /Do you understand the key risks/);
  await page.getByTestId('ss-dest-n5-CLAIMS').click();
  await pick(page, /What would you like us to clarify/);
  await page.getByTestId('ss-dest-n5-CHARGES').click();
  await pick(page, 'End module: Clarification required');
  await page.getByTestId('ss-dest-n5-NOTHING_IN_PARTICULAR').click();
  await pick(page, 'End module: Completed');
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'C3-five-options-dedicated-destinations', n5);
  await shot(page, 'U4-five-option-single-choice', n5);

  // ----------------------------------------------------------------------------------------------- D. Other + specify
  await page.getByTestId('ss-other-n5').check();
  await expect(page.getByTestId('ss-option-n5-OTHER').locator('.ss-option-label')).toHaveValue('Other — please specify'); // its code is OTHER (the test id), whatever the label
  await expect(page.getByTestId('ss-other-rule-n5')).toContainText('asked to specify');
  await expect(page.getByTestId('ss-dest-n5-OTHER')).toContainText('Choose destination');
  await page.getByTestId('ss-dest-n5-OTHER').click();
  await pick(page, /What would you like us to clarify/);
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'D1-other-please-specify', n5);

  // ---------------------------------------------------- E. multi-select: two ordered follow-ups and one shared rejoin
  await page.getByTestId('ss-insert-n5-PREMIUM').click();
  await page.getByTestId('ss-new-MULTI_SELECT').click();
  const n7 = page.getByTestId('ss-q-n7');
  await typeQuestion(n7, 'Which of these would you like us to explain again?');
  const add7 = page.getByTestId('ss-option-new-n7');
  for (const label of ['Premium', 'Benefits', 'None of these']) { await add7.fill(label); await add7.press('Enter'); }
  await n7.getByRole('radio', { name: 'Follow-ups for each answer' }).click();
  await page.getByTestId('ss-more-n7-NONE_OF_THESE').click();
  await page.getByTestId('ss-menu-exclusive').check();
  await page.keyboard.press('Escape');
  await page.getByTestId('ss-fu-n7-PREMIUM').click();
  await shot(page, 'E1-follow-up-behaviour-menu');
  await pick(page, 'New yes / no question');
  await typeQuestion(page.getByTestId('ss-q-n8'), 'Is the premium amount and term clear to you now?');
  await page.getByTestId('ss-fu-n7-BENEFITS').click();
  await pick(page, 'New yes / no question');
  await typeQuestion(page.getByTestId('ss-q-n9'), 'Is it clear to you what the plan pays?');
  const queue = page.getByTestId('ss-queue-n7').getByRole('listitem');
  await expect(queue).toHaveText([/Premium/, /Benefits/]);
  await page.getByTestId('ss-queue-up-BENEFITS').click(); // accessible reorder
  await expect(queue).toHaveText([/Benefits/, /Premium/]);
  await page.getByTestId('ss-queue-up-PREMIUM').click();
  await expect(queue).toHaveText([/Premium/, /Benefits/]);
  await expect(page.getByTestId('ss-rejoin-n7')).toContainText('Do you understand the key risks'); // explicit, inherited rejoin
  // tick Benefits first, then Premium: execution follows the configured order, not the click order
  await page.getByTestId('ss-try-toggle-n7').click();
  await page.getByTestId('ss-try-n7-BENEFITS').check();
  await page.getByTestId('ss-try-n7-PREMIUM').check();
  const steps = page.getByTestId('ss-try-steps-n7').getByRole('listitem');
  await expect(steps).toHaveText([/Ask.*premium amount and term/, /Ask.*what the plan pays/, /Then.*Do you understand the key risks/]);
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'E2-ordered-follow-ups-and-rejoin', n7);
  await a11y(page, 'builder-follow-ups');
  await page.getByTestId('ss-try-n7-NONE_OF_THESE').check();
  await expect(page.getByTestId('ss-try-error-n7')).toContainText('cannot be combined');
  await shot(page, 'E3-exclusive-combination-rejected', page.getByTestId('ss-try-n7'));
  await page.getByTestId('ss-try-n7-NONE_OF_THESE').uncheck();

  // -------------------------------------------------------------- F. reuse a question: definition versus placement
  await page.getByTestId('ss-insert-entry').click();
  await page.getByTestId('ss-reuse').click();
  await page.getByPlaceholder('Search library questions').fill('understand what');
  await shot(page, 'F1-reuse-from-library');
  await pick(page, /Did you understand what was just explained/);
  const n10 = page.getByTestId('ss-q-n10');
  await expect(n10).toContainText('Shared · used in 2 places');
  await page.getByTestId('ss-details-n10').click(); // version and wording approval are one step away, not on the card
  await expect(page.getByTestId('ss-details-panel-n10')).toContainText('Shared question · v1');
  await expect(page.getByTestId('ss-details-panel-n10')).toContainText('not approved');
  await expect(n10.locator('.ss-q-text textarea')).toHaveCount(0); // the shared wording cannot be typed over
  await n10.getByRole('radio', { name: 'Different next questions' }).click(); // routing belongs to this placement
  await page.getByTestId('ss-dest-n10-NO').click();
  await pick(page, 'End module: Clarification required');
  await page.getByTestId('ss-change-n10').click();
  await expect(page.getByText('This question is shared')).toBeVisible();
  await shot(page, 'F2-shared-definition-vs-placement');
  await page.getByTestId('ss-new-version').click();
  await expect(page.getByTestId('ss-details-panel-n10')).toContainText('Draft question');
  await expect(page.getByTestId('ss-change-n10')).toHaveCount(0);
  await expect(n10.locator('.ss-q-text textarea')).toHaveValue('Did you understand what was just explained?');
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'F3-module-complete');
  await a11y(page, 'builder-complete');
  // the library definition is untouched: v1 is still listed, and the other survey module still pins it
  await page.getByRole('link', { name: 'Survey Studio' }).first().click();
  await page.getByTestId('ss-tab-questions').click();
  await page.getByTestId('ss-lib-search').fill('understand what');
  await expect(page.getByTestId('ss-lib-questions')).toContainText('Q-UNDERSTOOD · v1');
  await page.getByTestId('ss-lib-search').fill('');
  await expect(page.getByTestId('ss-drafts')).toContainText('New business callback');
  await page.getByTestId('ss-drafts').getByRole('link').first().click();

  // ------------------------------------------------------------ G. configure and test a condition with missing input
  await expect(page.getByTestId('ss-card-mi-suitability')).toContainText('Draft v2 · this survey only');
  await page.getByTestId('ss-add-M-CONCERNS').click();
  await page.getByTestId('ss-route-mi-customer-concerns-CLARIFICATION_REQUIRED').click();
  await pick(page, 'End the call: Clarification required');
  // reorder with the keyboard: pick up, move up, drop (above Closing)
  await page.getByRole('button', { name: 'Drag to reorder Customer concerns' }).focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(200);
  await page.keyboard.press('Space');
  await expect(cards).toHaveCount(4);
  await expect(cards.locator('h3')).toHaveText(['General verification', 'Suitability', 'Customer concerns', 'Closing']);
  await page.getByTestId('ss-rule-mi-customer-concerns').click();
  await page.getByRole('radio', { name: 'Build a condition' }).click();
  await page.getByTestId('ss-cond-op-0-0').selectOption('GT');
  await page.getByTestId('ss-cond-value-0-0').fill('12000');
  await page.getByTestId('ss-cond-group-0').click();
  await page.getByTestId('ss-cond-field-1-0').selectOption('policy.sum_assured');
  await page.getByTestId('ss-cond-value-1-0').fill('500000');
  await page.getByTestId('ss-cond-add-1').click();
  await page.getByTestId('ss-cond-field-1-1').selectOption('customer.age_years');
  await page.getByTestId('ss-cond-value-1-1').fill('60');
  await expect(page.getByTestId('ss-rule-sentence')).toContainText('Annual premium is above 12,000 SGD and (Sum assured is at least 500,000 SGD or Customer age is at least 60 years)');
  await expect(page.getByTestId('ss-rule-apply')).toBeDisabled();
  await expect(page.locator('.ss-drawer-blocker')).toContainText('Choose what happens when information is missing');
  await expect(page.getByTestId('ss-verdict-result')).toHaveText('Does not match'); // 15,000 > 12,000, but neither of the other two
  await shot(page, 'G1-condition-drawer-policy-required');
  await page.getByTestId('ss-sample-customer.age_years').fill('65');
  await expect(page.getByTestId('ss-verdict-result')).toHaveText('Matches');
  await page.getByTestId('ss-sample-policy.annual_premium').fill(''); // the premium is missing
  await expect(page.getByTestId('ss-verdict-result')).toHaveText('Unknown'); // never read as "no"
  await page.getByTestId('ss-policy-block').check();
  await expect(page.getByTestId('ss-verdict')).toContainText('The call stops here and is flagged for review');
  await shot(page, 'G2-condition-unknown-with-missing-input');
  await a11y(page, 'condition-drawer');
  await page.getByTestId('ss-sample-customer.age_years').fill('45'); // now a known FALSE decides, even with the premium missing
  await expect(page.getByTestId('ss-verdict-result')).toHaveText('Does not match');
  await page.getByTestId('ss-rule-apply').click();
  await expect(page.getByTestId('ss-rule-mi-customer-concerns')).toContainText('when Annual premium is above 12,000 SGD and (Sum assured');
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'G3-composer-with-condition-chip');

  // --------------------------------------------------------------------------- H. undo and redo structural changes
  await page.getByTestId('ss-remove-mi-suitability').click();
  await shot(page, 'H1-remove-impact');
  await page.getByTestId('ss-remove-confirm').click();
  await expect(cards).toHaveCount(3);
  await expect(page.getByTestId('ss-route-mi-general-verification-COMPLETED')).toContainText('continues to Customer concerns');
  await page.getByTestId('ss-undo').click();
  await expect(cards).toHaveCount(4);
  await expect(page.getByTestId('ss-card-mi-suitability')).toContainText('Draft v2 · this survey only'); // the model came back, not a picture of it
  await expect(page.locator('.ss-notice')).toContainText('Undid: Removed Suitability');
  await page.getByTestId('ss-redo').click();
  await expect(cards).toHaveCount(3);
  await page.getByTestId('ss-undo').click();
  await page.getByTestId('ss-down-mi-general-verification').click();
  await expect(cards.locator('h3').nth(1)).toHaveText('General verification');
  await page.getByRole('heading', { name: 'Module library' }).click(); // move focus out of the button
  await page.keyboard.press('ControlOrMeta+z'); // keyboard undo
  await expect(cards.locator('h3').first()).toHaveText('General verification');
  await shot(page, 'H2-after-undo-redo');

  // inside the module: delete a question that several routes lead to, see the impact, then undo
  await page.getByTestId('ss-open-mi-suitability').click();
  await page.getByTestId('ss-merge-n2').click();
  await shot(page, 'H3-merge-routes-lead-here');
  await page.keyboard.press('Escape');
  await page.getByTestId('ss-delete-n2').click();
  await expect(page.getByTestId('ss-delete-impact')).toContainText('routes lead here');
  await shot(page, 'H4-delete-impact');
  await page.getByTestId('ss-delete-confirm').click();
  await expect(page.getByTestId('ss-q-n2')).toHaveCount(0);
  await page.getByTestId('ss-undo').click();
  await expect(page.getByTestId('ss-q-n2')).toBeVisible();
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'H5-module-after-undo');
});
