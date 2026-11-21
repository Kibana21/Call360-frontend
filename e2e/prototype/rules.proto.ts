import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { accounts, signIn } from '../helpers';

// SS-02B.3.1 — business-rule correctness, demonstrated in Chromium with the prototype setting ON:
//  1 a jump where eligibility passes       4 a genuine REVIEW_REQUIRED halt (a module's governed outcome)
//  2 a jump where eligibility fails        5 a structurally invalid draft that cannot run
//  3 a jump where eligibility is UNKNOWN   6 eligibility told apart from activation in the authoring UI
const SHOTS = 'test-results/prototype/shots';
const shot = async (page: Page, name: string) => { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const pick = async (page: Page, text: string | RegExp) => page.getByRole('option', { name: text }).first().click();
const profile = async (page: Page, id: string) => page.getByTestId(`ss-sim-profile-${id}`).click();
const runAll = async (page: Page) => { await page.getByTestId('ss-sim-run-all').click(); await expect(page.getByTestId('ss-sim-end')).toBeVisible(); };
const end = (page: Page) => page.getByTestId('ss-sim-end');
const headline = (page: Page) => page.getByTestId('ss-sim-end-headline');
const mod = (page: Page, inst: string) => page.getByTestId(`ss-sim-module-${inst}`);
const timeline = (page: Page) => page.getByTestId('ss-sim-timeline');
const toSurvey = async (page: Page) => page.getByRole('navigation', { name: 'Survey Studio breadcrumb' }).getByRole('link', { name: /New business callback/ }).click();
const SPEC = 'mi-escalation-and-follow-up';

async function scan(page: Page, name: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).include('[data-testid="survey-studio"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(bad.map((v) => `${name}: ${v.id} (${v.nodes.slice(0, 6).map((x) => x.target.join(' ')).join(', ')})`)).toEqual([]);
}

test.use({ actionTimeout: 12_000 });

test('SS-02B.3.1 business rules: a jump does not bypass eligibility; terminal states are told apart; an invalid draft does not run', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  await page.getByTestId('ss-prototype-tag').click();
  await page.getByTestId('ss-add-demo').click();
  await expect(page.getByTestId('ss-sim-notice')).toContainText('It is not the Call360 runtime'); // still told apart from the operational runtime
  await expect(page.getByTestId('ss-sim-draft-issues')).toHaveCount(0);

  // ------------------------------------------------------------------------ 1. a jump where eligibility PASSES
  await profile(page, 'UNEASY_OLDER');
  await runAll(page);
  await expect(headline(page)).toHaveText('The call is completed');
  await expect(end(page)).toHaveAttribute('data-terminal', 'COMPLETED');
  await expect(mod(page, 'mi-affordability-check')).toContainText('Ran · Clarification required');
  await expect(mod(page, 'mi-clarifications')).toContainText('Passed over by a jump');
  await expect(mod(page, SPEC)).toContainText('Ran · Completed');
  await expect(timeline(page)).toContainText('Jumps to Escalation and follow-up as the next candidate');
  const passed = timeline(page).locator('[data-kind="ENTRY"]').filter({ hasText: 'Escalation and follow-up runs' });
  await passed.getByRole('button', { name: 'Why?' }).click();
  await expect(passed).toContainText('It was selected by a jump: “Clarification required” of Affordability check.');
  await expect(passed).toContainText('A jump does not bypass eligibility: it is eligible when Customer age is at least 60 years. That is true for this customer.');
  await expect(passed).toContainText('67 years');
  await passed.scrollIntoViewIfNeeded();
  await shot(page, 'BR1-jump-eligibility-passes');

  // ------------------------------------------------------------------------- 2. a jump where eligibility FAILS
  await profile(page, 'UNEASY_YOUNGER');
  await runAll(page);
  await expect(headline(page)).toHaveText('The call ends: Clarification required');
  await expect(end(page)).toHaveAttribute('data-terminal', 'ENDED_WITH_OUTCOME');
  await expect(mod(page, SPEC)).toContainText('Skipped · did not apply'); // skipped with an explicit reason — not entered unconditionally
  await expect(mod(page, 'mi-closing')).toContainText('Not reached');
  const failed = timeline(page).locator('[data-kind="ENTRY"]').filter({ hasText: 'Escalation and follow-up is skipped' });
  await failed.getByRole('button', { name: 'Why?' }).click();
  await expect(failed).toContainText('A jump does not bypass eligibility: it is eligible when Customer age is at least 60 years. That is false for this customer.');
  const disposition = timeline(page).locator('[data-kind="DISPOSITION"]');
  await expect(disposition).toContainText('Escalation and follow-up does not apply, so the call ends: Clarification required');
  await disposition.getByRole('button', { name: 'Why?' }).click();
  await expect(disposition).toContainText('This is what the survey says to do when Escalation and follow-up is jumped to but is not eligible.');
  await failed.scrollIntoViewIfNeeded();
  await shot(page, 'BR2-jump-eligibility-fails-skip-disposition');

  // --------------------------------------------------------------------- 3. a jump where eligibility is UNKNOWN
  await profile(page, 'UNEASY_NO_AGE');
  await expect(page.getByTestId('ss-sim-facts').locator('dd.missing')).toHaveCount(1);
  await runAll(page);
  await expect(headline(page)).toHaveText('Halted — information is missing');
  await expect(end(page)).toHaveAttribute('data-terminal', 'MISSING_INFORMATION_HALT');
  await expect(page.getByTestId('ss-sim-terminal')).toContainText('A missing-information halt');
  await expect(page.getByTestId('ss-sim-terminal')).toContainText('This is not a module outcome, and not a completed run.');
  await expect(mod(page, SPEC)).toContainText('Halted · information missing');
  const unknown = timeline(page).locator('[data-kind="ENTRY"]').filter({ hasText: 'cannot be decided' });
  await unknown.getByRole('button', { name: 'Why?' }).click();
  await expect(unknown).toContainText('A jump does not bypass eligibility');
  await expect(unknown).toContainText('Missing information is never treated as “no”: this module is set to stop for review.');
  await shot(page, 'BR3-jump-eligibility-unknown-halt');
  await scan(page, 'missing-information-halt');

  // ------------------------------------------------- 6. eligibility and activation told apart in the authoring UI
  await toSurvey(page);
  const skip = page.getByTestId(`ss-skip-${SPEC}`);
  await expect(page.getByTestId(`ss-skip-row-${SPEC}`)).toContainText('Jumped to, but does not apply');
  await expect(skip).toContainText('ends the call: Clarification required');
  await expect(page.locator('[data-testid^="ss-skip-row-"]')).toHaveCount(1); // only on the one card where it matters
  await page.getByTestId(`ss-rule-${SPEC}`).click();
  // activation and eligibility are two independent settings, each explained where it is set (SS-02C, A-2)
  await expect(page.getByTestId('ss-rule-kind-note')).toContainText('Eligibility decides whether the selected module may run');
  await expect(page.getByTestId('ss-rule-kind-note')).toContainText('A jump never bypasses it.');
  await expect(page.getByTestId('ss-activation-note')).toContainText('Activation decides when the module is selected: when the survey reaches it in order');
  await page.getByTestId('ss-activation').getByRole('radio', { name: 'After an outcome' }).click();
  await expect(page.getByTestId('ss-activation-note')).toContainText('only after the earlier module ends that way. Another module can also select it with an explicit jump.');
  await shot(page, 'BR6-eligibility-versus-activation');
  await page.keyboard.press('Escape');

  // ---------------------------------------------------- 5. a structurally invalid draft that cannot run
  await skip.click();
  await pick(page, 'Leave undecided for now');
  await expect(skip).toContainText('Choose what happens');
  await expect(page.getByTestId('ss-issues')).toContainText('1 to fix');
  await page.getByTestId('ss-issues').click();
  await expect(page.getByTestId('ss-issues-list')).toContainText('Escalation and follow-up: choose what happens if it is jumped to but does not apply');
  await expect(page.getByTestId('ss-readiness')).toContainText('No.');
  await shot(page, 'BR5a-invalid-draft-flagged-in-authoring');
  await scan(page, 'composer-skip-disposition');
  await page.keyboard.press('Escape');
  await page.getByTestId('ss-simulate').click();
  await expect(page.getByTestId('ss-sim-draft-issues')).toContainText('1 to fix in this draft');
  await profile(page, 'UNEASY_YOUNGER');
  await runAll(page);
  await expect(headline(page)).toHaveText('This draft cannot run past here');
  await expect(end(page)).toHaveAttribute('data-terminal', 'DRAFT_INVALID');
  await expect(end(page)).toContainText('was reached by a jump and does not apply, and the survey does not say what happens then');
  await expect(end(page)).toContainText('Nothing was decided and nothing is guessed');
  await expect(page.getByTestId('ss-sim-terminal')).toContainText('Not a result of a call');
  await shot(page, 'BR5b-invalid-draft-cannot-run');
  await page.getByTestId('ss-sim-open-survey').click(); // fix it: an explicit disposition
  await skip.click();
  await pick(page, 'Continue to the next module');
  await expect(page.getByTestId('ss-issues')).toContainText('Routing complete');
  // the survey graph shows the same disposition as a route of its own
  await page.getByRole('radio', { name: 'Graph', exact: true }).click();
  await expect(page.getByTestId(`ss-g-slot-${SPEC}-@SKIP`)).toContainText('If it does not apply');
  await page.getByRole('radio', { name: 'Blocks', exact: true }).click();
  await page.getByTestId('ss-simulate').click();
  await profile(page, 'UNEASY_YOUNGER');
  await runAll(page);
  await expect(headline(page)).toHaveText('The call is completed'); // skipped, then on to Closing — as configured
  await expect(timeline(page).locator('[data-kind="DISPOSITION"]')).toContainText('does not apply, so the call continues with Closing');

  // ------------------------------------------ 4. a genuine REVIEW_REQUIRED halt: a module's governed outcome
  await toSurvey(page);
  await page.getByTestId('ss-open-mi-affordability-check').click();
  await page.getByTestId('ss-derive').click();
  await page.getByTestId('ss-dest-d1-UNKNOWN').click(); // when the large-commitment condition cannot be decided: stop and flag
  await pick(page, 'Stop and flag for review');
  await toSurvey(page);
  await expect(page.getByTestId('ss-route-mi-affordability-check-REVIEW_REQUIRED')).toContainText('the call halts · waits for an authorised review · not completed');
  await page.getByTestId('ss-simulate').click();
  await profile(page, 'MISSING');
  await runAll(page);
  await expect(headline(page)).toHaveText('Halted — review required');
  await expect(end(page)).toHaveAttribute('data-terminal', 'REVIEW_REQUIRED');
  await expect(page.getByTestId('ss-sim-terminal')).toContainText('The governed outcome “Review required”: a module ran and ended with it.');
  await expect(end(page)).toContainText('pending an authorised review; it is not completed');
  await expect(page.getByTestId('ss-sim-review-note')).toContainText('belongs to a separate review capability');
  await expect(mod(page, 'mi-affordability-check')).toContainText('Ran · Review required'); // the module RAN — unlike the missing-information halt
  await expect(mod(page, 'mi-clarifications')).toContainText('Not reached');
  await expect(timeline(page).locator('[data-kind="DECISION"]').first()).toContainText('cannot be decided (unknown) → stop: review required');
  await shot(page, 'BR4-genuine-review-required-halt');
  await scan(page, 'review-required-halt');
});
