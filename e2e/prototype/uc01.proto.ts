import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { accounts, signIn } from '../helpers';

// UC-01 — Unified Survey Studio foundation, in Chromium with the prototype setting ON:
//   statements (opening, disclosure, transition, closing), number and acknowledgement questions, the wording-and-delivery
//   section on the card, controlled variables with deterministic rendering and explicit missing-value errors, delivery
//   modes with the undecided one blocked, and a customer-specific call plan preview — in Guided, Graph, Simulator and
//   Validation, all on the one model.
const SHOTS = 'test-results/prototype/shots';
const shot = async (page: Page, name: string, full = false) => { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
const step = async (page: Page, id: string) => page.getByTestId(`ss-journey-${id}`).click();
const view = (page: Page, name: 'Guided' | 'Graph') => page.getByRole('radio', { name, exact: true }).click();

async function scan(page: Page, name: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).include('[data-testid="survey-studio"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(bad.map((v) => `${name}: ${v.id} (${v.nodes.slice(0, 6).map((x) => x.target.join(' ')).join(', ')})`)).toEqual([]);
}

test.use({ actionTimeout: 12_000 });

test('UC-01: statements, typed answers, wording with variables, delivery and the call plan, on one model', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  await page.getByTestId('ss-prototype-tag').click();
  await page.getByTestId('ss-add-readiness').click();

  // ------------------------------------------------------------ 1. the call plan opens for the new survey
  // (the plan itself — its two verdicts, its compact overview and its three sections — is covered by uc02.proto.ts)
  await expect(page.getByTestId('ss-plan-verdict')).toHaveAttribute('data-status', 'READY');
  await expect(page.getByTestId('ss-plan-notice')).toContainText('No call is assembled, approved or made');

  // ------------------------------------------------------------ 2. the simulator runs the same model
  await page.getByTestId('ss-plan-simulate').click();
  await expect(page.getByTestId('ss-sim-question')).toHaveText('Can you confirm that you are the policyholder?');
  await expect(page.getByTestId('ss-sim')).toContainText('opening delivered: Good day. This is a service call about your SecureLife Protect plan.');
  await page.getByTestId('ss-sim-opt-YES').check();
  await page.getByTestId('ss-sim-answer').click();
  await page.getByTestId('ss-sim-opt-YES').check();
  await page.getByTestId('ss-sim-answer').click();
  // the disclosure is delivered on the way; then a number is asked and validated against its rule
  await expect(page.getByTestId('ss-sim')).toContainText('disclosure delivered: Our records show an annual premium of SGD 3,000, payable for 20 years.');
  await expect(page.getByTestId('ss-sim-question')).toHaveText('For how many years did your representative say you would pay premiums?');
  await page.getByTestId('ss-sim-number').fill('500');
  await page.getByTestId('ss-sim-answer').click();
  await expect(page.getByTestId('ss-sim-reject')).toContainText('The number is too high');
  await page.getByTestId('ss-sim-number').fill('20');
  await page.getByTestId('ss-sim-answer').click();
  // an acknowledgement: the only answer that can be simulated is "acknowledged"
  await expect(page.getByTestId('ss-sim-ack-note')).toContainText('not decided yet');
  await shot(page, 'UC08-simulator-acknowledgement-after-number');
  await page.getByTestId('ss-sim-answer').click();
  await page.getByTestId('ss-sim-run-all').click();
  await expect(page.getByTestId('ss-sim-end')).toHaveAttribute('data-terminal', 'COMPLETED');
  await expect(page.getByTestId('ss-sim')).toContainText('closing delivered: Thank you for your time. This call is now complete.');
  await shot(page, 'UC09-simulator-statements-delivered', true);
  await scan(page, 'simulator');

  // ------------------------------------------------------------ 3. Guided: one card, wording and delivery one step away
  await step(page, 'build');
  const s1 = page.getByTestId('ss-q-n1');
  await expect(s1).toHaveAttribute('data-item', 'STATEMENT');
  await expect(s1).toContainText('Opening statement');
  await expect(s1).toContainText('It takes no answer and cannot branch');
  await expect(page.getByTestId('ss-q-n2')).toContainText('Mandatory');
  await expect(page.getByTestId('ss-q-n2')).toContainText('Identity check');
  await expect(page.getByTestId('ss-number-rule-n5')).toHaveText('A whole number, between 1 and 99 (years).');
  // closed, the section is one line; nothing about delivery clutters the card
  await expect(page.getByTestId('ss-wording-n1-summary')).toHaveText('Exact text, spoken by the system · 1 variable · not approved');
  await expect(page.getByTestId('ss-wording-n1-preview')).toHaveCount(0);
  await shot(page, 'UC01-guided-statements-and-questions');
  await page.getByTestId('ss-wording-n1-toggle').click();
  await expect(page.getByTestId('ss-wording-n1-preview')).toContainText('Good day. This is a service call about your SecureLife Protect plan.');
  await expect(page.getByTestId('ss-wording-n1-vars')).toContainText('Plan name');
  await expect(page.getByTestId('ss-wording-n1-statement-OPENING')).toBeChecked();
  await expect(page.getByTestId('ss-wording-n1-blocked')).toContainText('Repeat and clarification wording');
  await shot(page, 'UC02-wording-and-delivery-open-on-a-statement');

  // a controlled variable, inserted from the catalog; the preview follows, and a customer without the value gets an error
  await page.getByTestId('ss-wording-n1-insert').click();
  await page.getByRole('option', { name: /Annual premium/ }).click();
  await expect(page.getByTestId('ss-wording-n1-preview')).toContainText('SecureLife Protect plan. SGD 3,000');
  await page.getByTestId('ss-wording-n1-who').selectOption('MISSING');
  await expect(page.getByTestId('ss-wording-n1-preview')).toHaveAttribute('data-state', 'error');
  await expect(page.getByTestId('ss-wording-n1-preview')).toContainText('Cannot be delivered to this customer');
  await shot(page, 'UC03-variable-missing-value-error');
  await page.getByTestId('ss-undo').click();
  await expect(page.getByTestId('ss-wording-n1-summary')).toContainText('1 variable');

  // the undecided delivery mode can be chosen, and is blocked at once — it never passes quietly
  await page.getByTestId('ss-wording-n1-delivery-CONVERSATIONAL').check();
  await expect(page.getByTestId('ss-wording-n1')).toContainText('is blocked');
  await expect(page.getByTestId('ss-status-n1')).toContainText('1 to fix');
  await shot(page, 'UC04-conversational-delivery-blocked');
  await page.getByTestId('ss-wording-n1-delivery-CONTROLLED_TTS').check();
  await expect(page.getByTestId('ss-status-n1')).toHaveCount(0);
  await page.getByTestId('ss-wording-n1-toggle').click();

  // roles of a question: declared, with the limits of what that means stated
  await page.getByTestId('ss-wording-n2-toggle').click();
  await expect(page.getByTestId('ss-wording-n2-mandatory')).toBeChecked();
  await expect(page.getByTestId('ss-wording-n2-role')).toHaveValue('IDENTITY_CHECK');
  await expect(page.getByTestId('ss-wording-n2')).toContainText('not decided yet');
  await page.getByTestId('ss-wording-n2-toggle').click();

  // add a statement where a question could be added: same menu, same card
  await page.getByTestId('ss-insert-n7-AFTER_CAPTURE').click();
  await page.getByTestId('ss-new-STATEMENT').click();
  const s8 = page.getByTestId('ss-q-n8');
  await expect(s8).toHaveAttribute('data-item', 'STATEMENT');
  await s8.getByLabel(/Statement text for/).fill('Please have your policy document to hand.');
  await s8.getByLabel(/Statement text for/).blur();
  await expect(s8).toContainText('Transition statement');
  // a number question and an acknowledgement are in the same menu as every other question type
  await page.getByTestId('ss-insert-n8-AFTER_CAPTURE').click();
  await expect(page.getByTestId('ss-new-NUMERIC')).toBeVisible();
  await expect(page.getByTestId('ss-new-ACKNOWLEDGEMENT')).toBeVisible();
  await page.keyboard.press('Escape');
  await scan(page, 'guided builder');

  // ------------------------------------------------------------ 4. Graph: the same items, the same model
  await view(page, 'Graph');
  await expect(page.getByTestId('ss-g-node-n1')).toContainText('Opening statement');
  await expect(page.getByTestId('ss-g-node-n8')).toContainText('Please have your policy document to hand.');
  await expect(page.getByTestId('ss-g-node-n8')).toHaveClass(/statement/);
  await expect(page.getByTestId('ss-g-node-n5')).toContainText('Number');
  await expect(page.getByTestId('ss-g-node-n6')).toContainText('Acknowledgement');
  await shot(page, 'UC10-graph-shows-the-same-statements');
  await view(page, 'Guided');
  await expect(page.getByTestId('ss-q-n8')).toContainText('Please have your policy document to hand.');

  // ------------------------------------------------------------ 5. Validation: undecided things are named, not invented
  await step(page, 'validate');
  await expect(page.getByTestId('survey-studio')).toContainText('Not structurally eligible for live calls');
  await expect(page.getByTestId('survey-studio')).toContainText('What happens when a customer does not answer is not decided yet');
  await shot(page, 'UC11-validation', true);
  await scan(page, 'validation');
});
