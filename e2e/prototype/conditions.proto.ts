import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { accounts, signIn } from '../helpers';

// SS-02B.1 — Conditions and Routing Intelligence, demonstrated in Chromium with the prototype setting ON:
//   1 a module with two internal decision points          5 UNKNOWN handling with missing customer information
//   2 one reusable condition, two placements, two values  6 first-match multi-select routing with prioritised rules
//   3 an AND / OR / NOT condition with a readable summary 7 exclusive option and min/max selection validation
//   4 a condition that depends on an earlier answer       8 undo/redo for condition and route edits
const SHOTS = 'test-results/prototype/shots';
const WIDTHS = [1440, 1280, 1024] as const;
const shot = async (page: Page, name: string, target?: Locator) => {
  await page.waitForTimeout(260);
  if (target) await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const pick = async (page: Page, text: string | RegExp) => page.getByRole('option', { name: text }).first().click();
const typeQuestion = async (card: Locator, text: string) => { const box = card.locator('.ss-q-text textarea'); await box.fill(text); await box.blur(); };
const issues = (page: Page) => page.getByTestId('ss-issues');
const sentence = (page: Page, id: string) => page.getByTestId(`ss-d-sentence-${id}`);
const verdict = (page: Page) => page.getByTestId('ss-verdict-result');

async function scan(page: Page, name: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).include('[data-testid="survey-studio"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(bad.map((v) => `${name}: ${v.id} (${v.nodes.slice(0, 6).map((x) => x.target.join(' ')).join(', ')})`)).toEqual([]);
}

/** One screen state at the three supported desktop widths: no sideways page scroll, controls in view, screenshot, scan. */
async function atWidths(page: Page, name: string, essential: Locator[] = []) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect.soft(overflow, `sideways page scroll on ${name} at ${width}px`).toBeLessThanOrEqual(0);
    for (const el of essential) {
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      expect.soft(box && box.x >= 0 && box.x + box.width <= width, `${name} at ${width}px: an essential routing control is cut off`).toBeTruthy();
    }
    await scan(page, `${name}@${width}`);
    await page.screenshot({ path: `${SHOTS}/W-${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test.use({ actionTimeout: 10_000 });

test('SS-02B.1 conditions and routing: decision points, reusable conditions, earlier answers, unknown, ordered rules, limits, undo', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  await expect(page.getByTestId('ss-prototype-tag')).toHaveText(/Prototype · not saved/);

  await page.getByTestId('ss-create').click();
  await page.getByTestId('ss-create-name').fill('Conditions check');
  await page.getByTestId('ss-create-go').click();
  await page.getByTestId('ss-add-first').click();
  await page.getByTestId('ss-blank-module').click();
  await page.getByTestId('ss-new-module-name').fill('Affordability review');
  await page.getByTestId('ss-new-module-kind').selectOption('PRODUCT');
  await page.getByTestId('ss-new-module-intent').fill('Extra affordability checks for large commitments');
  await page.getByTestId('ss-new-module-go').click();
  await page.getByTestId('ss-new-YES_NO').click();
  await typeQuestion(page.getByTestId('ss-q-n1'), 'Are you comfortable with the premium you are paying?');
  await expect(issues(page)).toContainText('Routing complete');

  // ------------------------------------------------------------- 1. a decision point after an answer: safe insertion
  await page.getByTestId('ss-insert-n1-ANY').click();
  await page.getByTestId('ss-new-DECISION').click();
  const d1 = page.getByTestId('ss-d-d1');
  await expect(d1).toContainText('C1');
  await expect(sentence(page, 'd1')).toHaveText('Say what this decision checks');
  await expect(page.getByTestId('ss-dest-d1-NO_MATCH')).toContainText('End module: Completed'); // only "otherwise" inherits
  await expect(page.getByTestId('ss-dest-d1-MATCH')).toContainText('Choose destination'); // nothing invented
  await expect(page.getByTestId('ss-dest-d1-UNKNOWN')).toContainText('Choose what happens'); // never silently "otherwise"
  await expect(issues(page)).toContainText('3 to fix');
  await shot(page, 'CR1-new-decision-nothing-invented');

  // --------------------------------- 2. a reusable condition, bound with this placement's values; 5. unknown handling
  await page.getByTestId('ss-d-edit-d1').click();
  const drawer = page.getByRole('dialog', { name: 'What does C1 check?' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('radio', { name: 'Library condition' }).click();
  await page.getByTestId('ss-rule-saved').selectOption('C-LARGE-COMMITMENT@1');
  await expect(page.getByTestId('ss-rule-definition')).toContainText('Annual premium is above [Premium above] and Sum assured is at least [Sum assured at least]');
  await expect(page.getByTestId('ss-zone-definition')).toContainText('used in 1 place'); // the library module's own decision
  await expect(page.getByTestId('ss-rule-apply')).toBeDisabled(); // a placement without its values is not valid
  await page.getByTestId('ss-param-premium_above').fill('12000');
  await page.getByTestId('ss-param-sum_assured_at_least').fill('500000');
  await expect(page.getByTestId('ss-rule-sentence')).toHaveText('It matches when Annual premium is above 12,000 SGD and Sum assured is at least 500,000 SGD.');
  await expect(verdict(page)).toHaveText('Does not match'); // sample: premium 15,000, sum assured 300,000
  await page.getByTestId('ss-sample-policy.sum_assured').fill('600000');
  await expect(verdict(page)).toHaveText('Matches');
  await page.getByTestId('ss-sample-policy.annual_premium').fill('');
  await expect(verdict(page)).toHaveText('Unknown'); // TRUE-or-missing is unknown, never "does not match"
  await expect(page.getByTestId('ss-verdict')).toContainText('it is not treated as "otherwise"');
  await expect(page.getByTestId('ss-verdict')).toContainText('Annual premium is missing');
  await shot(page, 'CR3-condition-editor-expanded-library-condition');
  await scan(page, 'condition-drawer-library');
  await page.getByTestId('ss-rule-apply').click();
  await expect(drawer).toHaveCount(0);
  await expect(sentence(page, 'd1')).toHaveText('Annual premium is above 12,000 SGD and Sum assured is at least 500,000 SGD');
  await expect(d1).toContainText('Large commitment · v1');

  // "When the annual premium exceeds 12,000 and the sum assured is at least 500,000, ask an additional affordability question."
  await page.getByTestId('ss-dest-d1-MATCH').click();
  await page.getByTestId('ss-dest-d1-MATCH-new-YES_NO').click();
  await typeQuestion(page.getByTestId('ss-q-n2'), 'If your income fell, could you keep paying this premium?');
  await page.getByTestId('ss-dest-d1-UNKNOWN').click();
  await pick(page, 'End module: Unable to verify');
  await expect(page.getByTestId('ss-dest-d1-UNKNOWN')).toContainText('End module: Unable to verify');

  // ------------------------------------- 1 + 2. a second decision point: the SAME condition with DIFFERENT values
  await page.getByTestId('ss-insert-d1-NO_MATCH').click();
  await page.getByTestId('ss-new-DECISION').click();
  await page.getByTestId('ss-d-edit-d2').click();
  await page.getByRole('dialog', { name: 'What does C2 check?' }).getByRole('radio', { name: 'Library condition' }).click();
  await page.getByTestId('ss-rule-saved').selectOption('C-LARGE-COMMITMENT@1');
  await expect(page.getByTestId('ss-zone-definition')).toContainText('used in 2 places');
  await page.getByTestId('ss-param-premium_above').fill('30000');
  await page.getByTestId('ss-param-sum_assured_at_least').fill('1000000');
  await page.getByTestId('ss-rule-apply').click();
  await expect(sentence(page, 'd2')).toHaveText('Annual premium is above 30,000 SGD and Sum assured is at least 1,000,000 SGD');
  await expect(sentence(page, 'd1')).toHaveText('Annual premium is above 12,000 SGD and Sum assured is at least 500,000 SGD'); // the first placement is untouched
  await page.getByTestId('ss-dest-d2-MATCH').click();
  await pick(page, 'End module: Clarification required');
  await page.getByTestId('ss-dest-d2-UNKNOWN').click();
  await pick(page, 'Stop and flag for review');
  await expect(page.getByTestId('ss-dest-d2-UNKNOWN')).toContainText('Stop and flag for review');
  await page.getByTestId('ss-dest-n2-ANY').click();
  await pick(page, /C2 Condition/);
  await expect(page.getByTestId('ss-d-d2')).toContainText('2 routes lead here');
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'CR2-two-decision-points-compact', page.getByTestId('ss-q-n1'));

  // ------------------- 3. AND / OR / NOT with a readable summary; 4. an earlier answer as an input; 5. unknown again
  await page.getByTestId('ss-insert-d2-NO_MATCH').click();
  await page.getByTestId('ss-new-DECISION').click();
  await page.getByTestId('ss-d-edit-d3').click();
  await page.getByTestId('ss-rule-known').locator('summary').click();
  await expect(page.getByTestId('ss-rule-known')).toContainText('Q1 Are you comfortable with the premium');
  await expect(page.getByTestId('ss-rule-known')).toContainText('always asked before this');
  await expect(page.getByTestId('ss-rule-known')).toContainText('asked on some routes only'); // Q1a is asked only when C1 matches
  await page.getByTestId('ss-cond-field-0-0').selectOption('customer.age_years');
  await page.getByTestId('ss-cond-value-0-0').fill('60');
  await page.getByTestId('ss-cond-group-0').click();
  await page.getByTestId('ss-cond-op-1-0').selectOption('GT');
  await page.getByTestId('ss-cond-value-1-0').fill('12000');
  await page.getByTestId('ss-cond-add-1').click();
  await page.getByTestId('ss-cond-field-1-1').selectOption('answer:n1');
  await page.getByTestId('ss-cond-value-1-1').selectOption('NO');
  await page.getByTestId('ss-cond-group-1').click();
  await page.getByTestId('ss-group-kind-2').selectOption('NONE');
  await page.getByTestId('ss-cond-field-2-0').selectOption('policy.product_family');
  await expect(page.getByTestId('ss-rule-sentence')).toHaveText(
    'It matches when Customer age is at least 60 years and (Annual premium is above 12,000 SGD or the answer to Q1 is “No” or not Product family is Protection).');
  // age 45: a known "no" decides, whatever else is missing
  await expect(verdict(page)).toHaveText('Does not match');
  await page.getByTestId('ss-sample-customer.age_years').fill('65');
  await page.getByTestId('ss-sample-policy.annual_premium').fill('');
  await page.getByTestId('ss-sample-policy.product_family').selectOption('PROTECTION');
  await expect(verdict(page)).toHaveText('Unknown'); // premium missing and Q1 not answered yet
  await expect(page.getByTestId('ss-verdict')).toContainText('that question has not been answered');
  await shot(page, 'CR5-unknown-missing-information');
  await page.getByTestId('ss-sample-answer-n1').selectOption('NO');
  await expect(verdict(page)).toHaveText('Matches'); // one known "yes" inside an OR decides
  await page.getByTestId('ss-sample-answer-n1').selectOption('YES');
  await expect(verdict(page)).toHaveText('Unknown');
  await page.getByTestId('ss-rule-reusable').check();
  await expect(page.getByTestId('ss-rule-apply')).toBeDisabled();
  await page.getByTestId('ss-rule-name').fill('Older customer, large or uneasy commitment');
  await shot(page, 'CR4-and-or-not-with-earlier-answer');
  await scan(page, 'condition-drawer-builder');
  await page.getByTestId('ss-rule-apply').click();
  const d3text = 'Customer age is at least 60 years and (Annual premium is above 12,000 SGD or the answer to Q1 is “No” or not Product family is Protection)';
  await expect(sentence(page, 'd3')).toHaveText(d3text);
  await expect(page.locator('.ss-notice')).toContainText('to the library and applied it');

  // --------------------------------------------------------------------- 8. undo / redo of a condition and of a route
  await page.getByTestId('ss-undo').click();
  await expect(sentence(page, 'd3')).toHaveText('Say what this decision checks');
  await page.getByTestId('ss-redo').click();
  await expect(sentence(page, 'd3')).toHaveText(d3text);
  await page.getByTestId('ss-dest-d3-UNKNOWN').click();
  await pick(page, 'Stop and flag for review');
  await page.getByTestId('ss-undo').click();
  await expect(page.getByTestId('ss-dest-d3-UNKNOWN')).toContainText('Choose what happens');
  await page.getByTestId('ss-redo').click();
  await expect(page.getByTestId('ss-dest-d3-UNKNOWN')).toContainText('Stop and flag for review');

  // ----------------- 2. changing a shared definition: impact first, then a new version for THIS placement only
  await page.getByTestId('ss-d-edit-d2').click();
  await page.getByTestId('ss-rule-change').click();
  const impact = page.getByTestId('ss-rule-impact');
  await expect(impact.getByRole('listitem')).toHaveCount(3); // the library module and both placements here
  await expect(impact).toContainText('None of these change');
  await shot(page, 'CR6-shared-condition-impact');
  await page.getByTestId('ss-rule-new-version').click();
  await expect(page.getByTestId('ss-rule-derive-note')).toContainText('2 other places keep the version they have');
  await expect(page.getByTestId('ss-cond-named-0-0')).toHaveValue('Premium above'); // still a named setting
  await page.getByTestId('ss-cond-op-0-1').selectOption('GT');
  await page.getByTestId('ss-rule-apply').click();
  await expect(page.getByTestId('ss-d-d2')).toContainText('Large commitment · v2');
  await expect(sentence(page, 'd2')).toHaveText('Annual premium is above 30,000 SGD and Sum assured is above 1,000,000 SGD');
  await expect(page.getByTestId('ss-d-d1')).toContainText('Large commitment · v1'); // not silently changed
  await expect(sentence(page, 'd1')).toHaveText('Annual premium is above 12,000 SGD and Sum assured is at least 500,000 SGD');

  // ------------------------------------------------------ 7. exclusive answer and min/max selection validation
  await page.getByTestId('ss-dest-d3-MATCH').click();
  await page.getByTestId('ss-dest-d3-MATCH-new-MULTI_SELECT').click();
  const n3 = page.getByTestId('ss-q-n3');
  await typeQuestion(n3, 'Which of these worry you about the premium?');
  const add = page.getByTestId('ss-option-new-n3');
  for (const label of ['Too high', 'May rise', 'Job at risk', 'I never agreed', 'None of these']) { await add.fill(label); await add.press('Enter'); }
  await page.getByTestId('ss-more-n3-NONE_OF_THESE').click();
  await page.getByTestId('ss-menu-exclusive').check();
  await page.keyboard.press('Escape');
  await page.getByTestId('ss-more-n3-I_NEVER_AGREED').click();
  await page.getByTestId('ss-class-MANDATORY').click();
  await expect(page.getByTestId('ss-limit-max-n3')).toHaveValue('4'); // fitted: the exclusive answer cannot be combined
  await expect(page.getByTestId('ss-limits-example-n3')).toContainText('“None of these” can only be chosen on its own');
  await page.getByTestId('ss-limit-min-n3').fill('3');
  await page.getByTestId('ss-limit-max-n3').fill('2');
  await page.getByTestId('ss-limit-max-n3').blur();
  await expect(page.getByTestId('ss-limits-issue-n3')).toContainText('The minimum cannot be above the maximum');
  await shot(page, 'CR7a-selection-limits-invalid', n3);
  await page.getByTestId('ss-limit-max-n3').fill('9');
  await page.getByTestId('ss-limit-max-n3').blur();
  await expect(page.getByTestId('ss-limits-issue-n3')).toContainText('at most 9 answers, but only 4 can be combined');
  await page.getByTestId('ss-limit-min-n3').fill('1');
  await page.getByTestId('ss-limit-max-n3').fill('3');
  await page.getByTestId('ss-limit-max-n3').blur();
  await expect(page.getByTestId('ss-limits-issue-n3')).toHaveCount(0);
  await expect(page.getByTestId('ss-limits-example-n3')).toContainText('4 answers together are not');

  // --------------------------------------------------------- 6. first-matching-rule routing, explicit priority
  await expect(n3.getByRole('radio', { name: 'Everybody continues' })).toBeVisible(); // the existing modes are preserved
  await expect(n3.getByRole('radio', { name: 'Follow-ups for each answer' })).toBeVisible();
  await n3.getByRole('radio', { name: 'First matching rule' }).click();
  const rule = async (k: number, kind: 'ANY' | 'ALL' | 'NONE', opts: string[], dest: string) => {
    await page.getByTestId('ss-rule-add-n3').click();
    await page.getByTestId(`ss-rule-kind-n3-${k}`).selectOption(kind);
    for (const c of opts) await page.getByTestId(`ss-rule-opt-n3-${k}-${c}`).click();
    await page.getByTestId(`ss-rule-dest-n3-${k}`).click();
    await pick(page, dest);
  };
  await rule(1, 'ALL', ['TOO_HIGH', 'MAY_RISE'], 'End module: Clarification required');
  await rule(2, 'ANY', ['TOO_HIGH', 'JOB_AT_RISK'], 'End module: Completed');
  await rule(3, 'ANY', ['I_NEVER_AGREED'], 'End module: Escalate');
  await page.getByTestId('ss-fallback-n3').click();
  await pick(page, 'End module: Completed');
  // the mandatory escalation is checked last, so "Too high + I never agreed" would end as Completed: flagged
  await expect(page.getByTestId('ss-option-issue-n3-I_NEVER_AGREED')).toContainText('Put a rule for this answer first');
  await expect(issues(page)).toContainText('1 to fix');
  await page.getByTestId('ss-rule-up-n3-3').click();
  await page.getByTestId('ss-rule-up-n3-2').click();
  await expect(page.getByTestId('ss-rule-n3-1')).toContainText('I never agreed');
  await expect(issues(page)).toContainText('Routing complete');

  await page.getByTestId('ss-try-toggle-n3').click();
  const result = page.getByTestId('ss-try-result-n3');
  await page.getByTestId('ss-try-n3-TOO_HIGH').check();
  await page.getByTestId('ss-try-n3-MAY_RISE').check();
  await expect(result).toContainText('Rule 2 decides');
  await expect(result).toContainText('End module: Clarification required');
  await expect(page.getByTestId('ss-try-also-n3')).toContainText('rule 3'); // matched too, but only ONE route is taken
  await page.getByTestId('ss-try-n3-I_NEVER_AGREED').check();
  await expect(result).toContainText('Rule 1 decides');
  await expect(result).toContainText('End module: Escalate');
  await expect(page.getByTestId('ss-try-also-n3')).toContainText('rule 2, rule 3');
  await shot(page, 'CR8-first-matching-rule-winner', n3);
  await page.getByTestId('ss-try-n3-NONE_OF_THESE').check();
  await expect(page.getByTestId('ss-try-error-n3')).toContainText('cannot be combined'); // the exclusive answer
  await page.getByTestId('ss-try-n3-NONE_OF_THESE').uncheck();
  await page.getByTestId('ss-try-n3-JOB_AT_RISK').check();
  await expect(page.getByTestId('ss-try-error-n3')).toContainText('Choose at most 3'); // the selection limit
  for (const c of ['TOO_HIGH', 'MAY_RISE', 'JOB_AT_RISK', 'I_NEVER_AGREED']) await page.getByTestId(`ss-try-n3-${c}`).uncheck();
  await page.getByTestId('ss-try-n3-MAY_RISE').check();
  await expect(result).toContainText('No rule fits'); // explicit fallback
  await page.getByTestId('ss-try-n3-MAY_RISE').uncheck();
  await page.getByTestId('ss-try-n3-NONE_OF_THESE').check();
  await expect(result).toContainText('No rule fits');
  await shot(page, 'CR7b-exclusive-and-fallback', n3);

  // 8. undo / redo of a rule priority change
  await page.getByTestId('ss-try-n3-NONE_OF_THESE').uncheck();
  await page.getByTestId('ss-try-n3-TOO_HIGH').check();
  await page.getByTestId('ss-try-n3-MAY_RISE').check();
  await page.getByTestId('ss-rule-down-n3-2').click(); // "all of Too high, May rise" now comes after "any of Too high, Job at risk"
  await expect(result).toContainText('End module: Completed');
  await expect(page.getByTestId('ss-rule-unused-n3-3')).toBeVisible(); // it can no longer decide: shown, not hidden
  await page.getByTestId('ss-undo').click();
  await expect(result).toContainText('End module: Clarification required');
  await page.getByTestId('ss-redo').click();
  await expect(result).toContainText('End module: Completed');
  await page.getByTestId('ss-undo').click();

  await atWidths(page, 'conditions-builder', [page.getByTestId('ss-dest-d1-MATCH'), page.getByTestId('ss-dest-d3-UNKNOWN'), page.getByTestId('ss-fallback-n3'), page.getByTestId('ss-rule-dest-n3-1')]);
  await page.getByTestId('ss-fold-n3').click();
  await expect(page.getByTestId('ss-summary-n3')).toContainText('3 rules, the first match decides');
  await shot(page, 'CR9-module-overview-compact', page.getByTestId('ss-q-n1'));
  await page.getByTestId('ss-d-edit-d1').click();
  await atWidths(page, 'conditions-drawer');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ss-d-edit-d1')).toBeFocused(); // focus returns to the sentence that opened the drawer

  // ------------------------------------------------------------- the library: versions, settings and where used
  await page.getByRole('link', { name: 'Survey Studio' }).first().click();
  await page.getByTestId('ss-tab-conditions').click();
  await expect(page.getByTestId('ss-lib-condition-C-LARGE-COMMITMENT-1')).toContainText('Used in 2 places');
  await expect(page.getByTestId('ss-lib-condition-C-LARGE-COMMITMENT-2')).toContainText('Used in 1 place');
  await expect(page.getByTestId('ss-lib-condition-C-LARGE-COMMITMENT-1')).toContainText('Each place sets its own: Premium above, Sum assured at least');
  await expect(page.getByTestId('ss-lib-conditions')).toContainText('Older customer, large or uneasy commitment');
  await shot(page, 'CR10-library-conditions-versions');
  await page.getByTestId('ss-tab-modules').click();
  await page.goto('/survey-studio/modules/M-AFFORDABILITY%401'); // a reload resets the prototype: only the library module is checked here
  await expect(page.getByTestId('ss-lockbar')).toBeVisible();
  await expect(page.getByTestId('ss-d-sentence-d2')).toHaveText('the answer to Q1 is “No”');
  await expect(page.getByTestId('ss-d-d2')).toContainText('Stop and flag for review');
  await shot(page, 'CR11-library-module-with-decisions');
  await scan(page, 'library-module-with-decisions');
});
