import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { accounts, signIn } from '../helpers';

// SS-02B.3 — the Journey Simulator, demonstrated in Chromium with the prototype setting ON and synthetic customers:
// a normal complete journey; conditional module activation; a skipped module with its explanation; an UNKNOWN
// decision; multi-select follow-ups; a mandatory escalation; a review-required halt; two customers compared with the
// first divergence; step / back / restart / playback; and the same journey after an edit in the builder.
const SHOTS = 'test-results/prototype/shots';
const shot = async (page: Page, name: string) => { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const pick = async (page: Page, text: string | RegExp) => page.getByRole('option', { name: text }).first().click();
const profile = async (page: Page, id: string) => page.getByTestId(`ss-sim-profile-${id}`).click();
const runAll = async (page: Page) => { await page.getByTestId('ss-sim-run-all').click(); await expect(page.getByTestId('ss-sim-end')).toBeVisible(); };
const headline = (page: Page) => page.getByTestId('ss-sim-end-headline');
const mod = (page: Page, inst: string) => page.getByTestId(`ss-sim-module-${inst}`);
const timeline = (page: Page) => page.getByTestId('ss-sim-timeline');

async function scan(page: Page, name: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).include('[data-testid="survey-studio"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(bad.map((v) => `${name}: ${v.id} (${v.nodes.slice(0, 6).map((x) => x.target.join(' ')).join(', ')})`)).toEqual([]);
}
async function atWidths(page: Page, name: string) {
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect.soft(overflow, `sideways page scroll on ${name} at ${width}px`).toBeLessThanOrEqual(0);
    await scan(page, `${name}@${width}`);
    await page.screenshot({ path: `${SHOTS}/W-${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test.use({ actionTimeout: 12_000 });

test('SS-02B.3 journey simulator: seven synthetic customers, explanations, comparison, step/back/restart, after an edit', async ({ page }) => {
  test.setTimeout(420_000);
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  await page.getByTestId('ss-prototype-tag').click();
  await page.getByTestId('ss-add-demo').click();
  await expect(page).toHaveURL(/\/surveys\/S-NEW-BUSINESS-CALLBACK-DEMONS-1\/simulate/);
  await expect(page.getByTestId('ss-prototype-tag')).toHaveText(/Prototype · not saved/); // still displayed
  await expect(page.getByTestId('ss-sim-notice')).toContainText('It is not the Call360 runtime: nothing here was executed, approved, saved or sent');
  await expect(page.getByTestId('ss-sim-draft-issues')).toHaveCount(0);

  // ------------------------------------------------------------------------- step, back, restart: what the customer hears
  await expect(page.getByTestId('ss-sim-question')).toHaveText('Can you confirm that you are the policyholder?');
  await expect(page.getByTestId('ss-sim-next')).toContainText('the module ends: Unable to verify'); // what "No" would do, before answering
  await page.getByTestId('ss-sim-answer').click(); // no answer chosen: validation is not skipped
  await expect(page.getByTestId('ss-sim-reject')).toContainText('Not accepted: Choose an answer. The question is asked again.');
  await expect(page.getByTestId('ss-sim-question')).toHaveText('Can you confirm that you are the policyholder?');
  await page.getByTestId('ss-sim-back').click(); // take back the rejected attempt
  await page.getByTestId('ss-sim-opt-YES').check();
  await page.getByTestId('ss-sim-answer').click();
  await expect(page.getByTestId('ss-sim-question')).toHaveText('Can you confirm that you purchased this policy?');
  await expect(page.getByTestId('ss-sim-decided')).toContainText('Q1 · “Yes” → Q2');
  await expect(page.getByTestId('ss-sim-decided')).toContainText('There is a route set for “Yes”.');
  await expect(page.getByTestId('ss-sim-decided')).toContainText('“No” would have led to the end of the module (Unable to verify).');
  await page.getByTestId('ss-sim-step').click(); // this customer's own answer
  await expect(page.getByTestId('ss-sim-question')).toHaveText('Did your representative explain how the plan works?');
  await shot(page, 'SJ9a-step-what-the-customer-hears-and-why');
  await page.getByTestId('ss-sim-back').click();
  await expect(page.getByTestId('ss-sim-question')).toHaveText('Can you confirm that you purchased this policy?');
  await page.getByTestId('ss-sim-restart').click();
  await expect(page.getByTestId('ss-sim-question')).toHaveText('Can you confirm that you are the policyholder?');
  await expect(timeline(page).locator('[data-kind="ANSWER"]')).toHaveCount(0);
  await expect(page.getByTestId('ss-sim-back')).toBeDisabled();
  await shot(page, 'SJ9b-after-back-and-restart');
  await scan(page, 'simulator-question');

  // --------------------------------------------------------------------- 1. the normal policyholder: a complete journey
  await page.getByTestId('ss-sim-play').click(); // full-run playback, one answer at a time
  await expect(page.getByTestId('ss-sim-end')).toBeVisible({ timeout: 30_000 });
  await expect(headline(page)).toHaveText('The call is completed');
  await expect(mod(page, 'mi-general-verification')).toContainText('Ran · Completed');
  await expect(mod(page, 'mi-suitability')).toContainText('Skipped · did not apply');
  await expect(mod(page, 'mi-high-value-review')).toContainText('Skipped · did not apply');
  await expect(mod(page, 'mi-closing')).toContainText('Ran · Completed');
  await shot(page, 'SJ1-normal-complete-journey');

  // ------------------------------------------------------------------------------- 3. a skipped module, with its explanation
  await mod(page, 'mi-suitability').getByRole('button').click();
  await expect(page.getByTestId('ss-sim-module-why-mi-suitability')).toContainText('Why was this skipped?');
  await expect(page.getByTestId('ss-sim-module-why-mi-suitability')).toContainText('It is eligible when Product family is ILP. That is false for this customer.');
  const entry = timeline(page).locator('[data-kind="ENTRY"]').filter({ hasText: 'Suitability is skipped' });
  await entry.getByRole('button', { name: 'Why?' }).click();
  await expect(entry).toContainText('Product family');
  await expect(entry).toContainText('Protection');
  await shot(page, 'SJ3-skipped-module-with-explanation');
  await page.getByTestId('ss-sim-evidence').locator('summary').click();
  await expect(page.getByTestId('ss-sim-evidence')).toContainText('not asked on this path'); // the extra affordability question
  await expect(page.getByTestId('ss-sim-evidence')).toContainText('asked · left unanswered'); // the optional closing remark
  await scan(page, 'simulator-complete');

  // -------------------------------------------------------------------------- 2. conditional module activation (ILP)
  await profile(page, 'ILP');
  await expect(page.getByTestId('ss-sim-facts')).toContainText('ILP');
  await runAll(page);
  await expect(mod(page, 'mi-suitability')).toContainText('Ran · Completed');
  await mod(page, 'mi-suitability').getByRole('button').click();
  await expect(page.getByTestId('ss-sim-module-why-mi-suitability')).toContainText('Why did this run?');
  await expect(page.getByTestId('ss-sim-module-why-mi-suitability')).toContainText('That is true for this customer.');
  await shot(page, 'SJ2-conditional-module-activation');
  for (const [id, inst] of [['HIGH_PREMIUM', 'mi-high-value-review'], ['REPLACEMENT', 'mi-policy-replacement']] as const) {
    await profile(page, id);
    await runAll(page);
    await expect(mod(page, inst)).toContainText('Ran · Completed');
    await expect(headline(page)).toHaveText('The call is completed');
  }

  // ------------------------------------------------- 5. multi-select follow-ups in configured order (high sum assured)
  await profile(page, 'HIGH_SUM');
  for (let i = 0; i < 40 && !(await page.getByTestId('ss-sim-queue').count()); i++) await page.getByTestId('ss-sim-step').click();
  await expect(page.getByTestId('ss-sim-queue')).toContainText('Now');
  await expect(page.getByTestId('ss-sim-decided')).toContainText('2 follow-up questions queued, in the configured order');
  await expect(page.getByTestId('ss-sim-decided')).toContainText('not in the order the customer happened to choose');
  await expect(page.getByTestId('ss-sim-decided')).toContainText('Asked once, though two selected answers lead to it');
  await shot(page, 'SJ5-multi-select-follow-up-execution');
  await runAll(page);
  await expect(headline(page)).toHaveText('The call is completed');
  await expect(timeline(page).locator('[data-kind="DECISION"]').first()).toContainText('C1 · matches'); // the large-commitment condition

  // ------------------------------------------------------------------------------ 4. an UNKNOWN decision (missing data)
  await profile(page, 'MISSING');
  await expect(page.getByTestId('ss-sim-facts').locator('dd.missing')).toHaveCount(2);
  await runAll(page);
  await expect(headline(page)).toHaveText('The call ends: Unable to verify');
  await expect(mod(page, 'mi-policy-replacement')).toContainText('Skipped · information missing');
  const unknown = timeline(page).locator('[data-kind="DECISION"]').filter({ hasText: 'cannot be decided (unknown)' });
  await unknown.getByRole('button', { name: 'Why?' }).click();
  await expect(unknown).toContainText('came out UNKNOWN, so the “Unknown” route is taken');
  await expect(unknown).toContainText('Annual premium');
  await expect(unknown).toContainText('missing');
  await unknown.getByText('Why not another route').click();
  await expect(unknown).toContainText('unknown is never treated as “otherwise”');
  await shot(page, 'SJ4-unknown-decision');

  // --------------------------------------------------------------------------------------- 6. mandatory escalation
  await profile(page, 'ESCALATION');
  await runAll(page);
  await expect(headline(page)).toHaveText('The call ends: Escalate — mandatory escalation');
  await expect(page.getByTestId('ss-sim-end')).toHaveAttribute('data-terminal', 'MANDATORY_ESCALATION');
  await expect(page.getByTestId('ss-sim-end')).toContainText('Escalate is classified as an escalation');
  const stop = timeline(page).locator('[data-kind="QUEUE"]');
  await expect(stop).toContainText('“I did not agree to this policy” stops the follow-ups → Escalate');
  await stop.getByRole('button', { name: 'Why?' }).click();
  await expect(stop).toContainText('mandatory escalation: it overrides everything else that was selected');
  await expect(stop).toContainText('Not asked because the queue was stopped');
  await expect(mod(page, 'mi-closing')).toContainText('Not reached');
  await shot(page, 'SJ6-mandatory-escalation');

  // ---------------------------------------------------------------------------------------- 7. a review-required halt
  await profile(page, 'NO_PRODUCT');
  await runAll(page);
  await expect(headline(page)).toHaveText('Halted — information is missing'); // eligibility unknown: not the governed module outcome
  await expect(page.getByTestId('ss-sim-end')).toHaveAttribute('data-terminal', 'MISSING_INFORMATION_HALT');
  await expect(page.getByTestId('ss-sim-end')).toContainText('pending an authorised review; it is not completed');
  await expect(page.getByTestId('ss-sim-review-note')).toContainText('belongs to a separate review capability');
  await expect(mod(page, 'mi-suitability')).toContainText('Halted · information missing');
  await expect(mod(page, 'mi-high-value-review')).toContainText('Not reached');
  await shot(page, 'SJ7-review-required-halt');
  await scan(page, 'simulator-halt');
  await atWidths(page, 'simulator');

  // -------------------------------------------------------------- 8. two customers side by side, and where they part
  await profile(page, 'NORMAL');
  await page.getByTestId('ss-sim-compare').selectOption('ILP');
  await expect(page.getByTestId('ss-sim-divergence')).toContainText('then they part');
  await expect(page.getByTestId('ss-sim-div-a')).toContainText('Suitability is skipped — It is eligible when Product family is ILP. That is false for this customer.');
  await expect(page.getByTestId('ss-sim-div-b')).toContainText('Suitability runs — It is eligible when Product family is ILP. That is true for this customer.');
  await expect(page.getByTestId('ss-sim-div-facts')).toContainText('Product family (Protection / ILP)');
  await expect(page.getByTestId('ss-sim-col-end-a')).toHaveText('The call is completed');
  await page.getByTestId('ss-sim-jump').click();
  await expect(page.getByTestId('ss-sim-col-a').locator('li.diverge')).toBeInViewport();
  await expect(page.getByTestId('ss-sim-col-b').locator('li.diverge')).toBeInViewport();
  await shot(page, 'SJ8-two-profile-comparison-and-divergence');
  await atWidths(page, 'simulator-compare');
  await page.getByTestId('ss-sim-compare').selectOption('ESCALATION'); // same record, different answers
  await expect(page.getByTestId('ss-sim-divergence')).toContainText('Their records are the same; they differ in what they answer.');
  await expect(page.getByTestId('ss-sim-col-end-b')).toHaveText('The call ends: Escalate — mandatory escalation');
  await page.getByTestId('ss-sim-compare').selectOption('');

  // ------------------------------------------------- 10. the same journey after an edit in the builder (Guided, then Graph)
  await page.getByTestId('ss-sim-opt-NO').check(); // "No, I am not the policyholder"
  await page.getByTestId('ss-sim-answer').click();
  await expect(headline(page)).toHaveText('The call ends: Unable to verify');
  await shot(page, 'SJ10a-before-the-edit');
  await page.getByRole('navigation', { name: 'Survey Studio breadcrumb' }).getByRole('link', { name: /New business callback/ }).click();
  await page.getByTestId('ss-open-mi-general-verification').click();
  await page.getByTestId('ss-derive').click();
  await page.getByTestId('ss-dest-n1-NO').click(); // Guided: "No" now escalates
  await pick(page, 'End module: Escalate');
  await page.getByRole('navigation', { name: 'Survey Studio breadcrumb' }).getByRole('link', { name: /New business callback/ }).click();
  await page.getByTestId('ss-simulate').click();
  // SS-02 closure: an escalation is TERMINAL for the survey however the module reached it. The new Escalate outcome is
  // therefore governed from the moment it appears — it ends the call — and the draft is complete, not waiting for a route.
  await expect(page.getByTestId('ss-sim-draft-issues')).toHaveCount(0);
  await page.getByTestId('ss-sim-opt-NO').check();
  await page.getByTestId('ss-sim-answer').click();
  await expect(headline(page)).toHaveText('The call ends: Escalate'); // an ordinary ending with Escalate — not a "mandatory escalation"
  await expect(page.getByTestId('ss-sim-end')).toHaveAttribute('data-terminal', 'ENDED_WITH_OUTCOME');
  await expect(page.getByTestId('ss-sim-decided')).toContainText('Q1 · “No” → the end of the module (Escalate)');
  await shot(page, 'SJ10b-ordinary-escalation-ends-the-call');
  // the survey cannot route it anywhere else: in the Graph panel only its own ending is offered
  await page.getByRole('navigation', { name: 'Survey Studio breadcrumb' }).getByRole('link', { name: /New business callback/ }).click();
  await page.getByRole('radio', { name: 'Graph', exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByTestId('ss-g-node-mi-general-verification').click();
  await page.getByTestId('ss-g-panel').getByTestId('ss-route-mi-general-verification-ESCALATE').click();
  await expect(page.locator('[role="option"]')).toHaveCount(1);
  await expect(page.locator('[role="option"]')).toContainText('An escalation always ends the call');
  await pick(page, 'End the call: Escalate');
  await page.getByRole('radio', { name: 'Blocks', exact: true }).click();
  await page.getByTestId('ss-simulate').click();
  await page.getByTestId('ss-sim-opt-NO').check();
  await page.getByTestId('ss-sim-answer').click();
  await expect(headline(page)).toHaveText('The call ends: Escalate'); // the same journey whether reached from Guided or Graph
  await shot(page, 'SJ10c-same-journey-after-guided-and-graph-edits');
});
