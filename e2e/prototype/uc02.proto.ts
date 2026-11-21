import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { accounts, signIn } from '../helpers';

// UC-02 — contract and call-plan readiness, in Chromium with the prototype setting ON:
//   the call plan answers TWO questions apart (can a plan be computed? may it be used on a real call?);
//   a compact overview with modules, open branches and the simulated run opened on demand;
//   a recording with no approved asset blocks; statements are labelled apart from questions.
const SHOTS = 'test-results/prototype/shots';
const shot = async (page: Page, name: string, full = false) => { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
const step = async (page: Page, id: string) => page.getByTestId(`ss-journey-${id}`).click();
const W = 'mi-welcome-and-checks';

async function scan(page: Page, name: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).include('[data-testid="survey-studio"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(bad.map((v) => `${name}: ${v.id} (${v.nodes.slice(0, 6).map((x) => x.target.join(' ')).join(', ')})`)).toEqual([]);
}

test.use({ actionTimeout: 12_000 });

test('UC-02: a computable plan is never a live-call approval; the plan is compact and opens on demand', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  await page.getByTestId('ss-prototype-tag').click();
  await page.getByTestId('ss-add-readiness').click();

  // ------------------------------------------------------------ A and B are two verdicts, side by side
  const a = page.getByTestId('ss-plan-verdict');
  const b = page.getByTestId('ss-plan-live');
  await expect(a).toHaveAttribute('data-status', 'READY');
  await expect(a).toContainText('Yes — a plan can be computed');
  await expect(a).toContainText('It says nothing about whether the survey may be used on a call');
  await expect(b).toHaveAttribute('data-eligible', 'no');
  await expect(b).toContainText('No — not eligible for a real call');
  // every readiness condition is explicit, with its own state
  const state = (id: string) => page.getByTestId(`ss-plan-cond-${id}`);
  await expect(page.getByTestId('ss-plan-conditions').getByRole('listitem')).toHaveCount(10);
  await expect(state('PLAN_COMPUTABLE')).toHaveAttribute('data-state', 'MET');
  await expect(state('PUBLISHED_VERSION')).toHaveAttribute('data-state', 'NOT_MET');
  await expect(state('WORDING_APPROVED')).toHaveAttribute('data-state', 'NOT_MET');
  await expect(state('DELIVERY_CONTROLLED')).toHaveAttribute('data-state', 'MET');
  await expect(state('GATE_IDENTITY_CHECK')).toHaveAttribute('data-state', 'MET');
  await expect(state('GATE_CONSENT_TO_PROCEED')).toHaveAttribute('data-state', 'NOT_MET');
  await expect(state('GATE_RECORDING_CONSENT')).toHaveAttribute('data-state', 'MET');
  await expect(state('ASSIGNMENT')).toHaveAttribute('data-state', 'NOT_AVAILABLE');
  await expect(state('CHANNEL')).toHaveAttribute('data-state', 'NOT_AVAILABLE');
  await expect(state('NO_ANSWER_POLICY')).toHaveAttribute('data-state', 'NOT_MET');
  await expect(page.getByTestId('ss-plan-identity')).toContainText('Courtesy callback with opening and closing (demonstration) · draft v0.1');
  await expect(page.getByTestId('ss-plan-identity')).toContainText('Normal policyholder');

  // ------------------------------------------------------------ the overview is compact: nothing long is open
  await expect(page.getByTestId('ss-plan-in')).toHaveText('3');
  await expect(page.getByTestId('ss-plan-out')).toHaveText('2');
  await expect(page.getByTestId('ss-plan-missing')).toHaveText('0');
  await expect(page.getByTestId('ss-plan-wording')).toHaveText('0');
  const openCount = Number(await page.getByTestId('ss-plan-open-count').textContent());
  expect(openCount).toBeGreaterThan(0);
  await expect(page.locator('[data-testid^="ss-plan-item-"]')).toHaveCount(0);
  await expect(page.getByTestId('ss-plan-said')).toHaveCount(0);
  const height = await page.evaluate(() => document.querySelector('[data-testid="ss-plan"]')!.getBoundingClientRect().height);
  expect(height).toBeLessThan(1500); // the whole overview, closed, is well under two screens
  await page.getByRole('heading', { name: 'Call plan preview' }).scrollIntoViewIfNeeded();
  await shot(page, 'UC20-plan-two-verdicts-as-seen-on-screen');
  await shot(page, 'UC21-plan-overview-two-verdicts-compact', true);
  await scan(page, 'call plan overview');

  // the reasons are one step away
  await page.getByTestId('ss-plan-conds-toggle').click();
  await expect(state('PUBLISHED_VERSION')).toContainText('A draft is never used on a call');
  await expect(state('GATE_IDENTITY_CHECK')).toContainText('What a call does when the customer says no, refuses or does not answer is not decided');
  await expect(state('ASSIGNMENT')).toContainText('chosen by hand');
  await shot(page, 'UC22-live-eligibility-conditions-with-reasons', true);
  await page.getByTestId('ss-plan-conds-toggle').click();

  // ------------------------------------------------------------ 1 · settled before the call: a module opens on demand
  await page.getByTestId(`ss-plan-module-${W}-toggle`).click();
  await expect(page.getByTestId(`ss-plan-item-${W}/n1`)).toContainText('Good day. This is a service call about your SecureLife Protect plan.');
  // statements are labelled apart from questions: S1, Q1, Q2, S2 … the canonical identities (n1, n2 …) are unchanged
  await expect(page.getByTestId(`ss-plan-item-${W}/n1`).locator('.ss-q-num')).toHaveText('S1');
  await expect(page.getByTestId(`ss-plan-item-${W}/n2`).locator('.ss-q-num')).toHaveText('Q1');
  await expect(page.getByTestId(`ss-plan-item-${W}/n3`).locator('.ss-q-num')).toHaveText('Q2');
  await expect(page.getByTestId(`ss-plan-item-${W}/n4`).locator('.ss-q-num')).toHaveText('S2');
  await expect(page.getByTestId(`ss-plan-item-${W}/n4`)).toContainText('Our records show an annual premium of SGD 3,000, payable for 20 years.');
  await expect(page.getByTestId(`ss-plan-item-${W}/n4`)).toContainText('Annual premium = SGD 3,000');
  await expect(page.getByTestId(`ss-plan-item-${W}/n1`)).toContainText('On every path');
  await expect(page.getByTestId(`ss-plan-item-${W}/n4`)).toContainText('Only on some paths');
  await expect(page.getByTestId('ss-plan-module-mi-high-value-review')).toHaveAttribute('data-status', 'OUT');
  await shot(page, 'UC23-one-module-opened-on-demand', true);

  // 2 · still conditional
  await page.getByTestId('ss-plan-open-toggle').click();
  await expect(page.locator('[data-testid="ss-plan-open-body"] dl > div')).toHaveCount(openCount); // the count in the overview is the list
  await expect(page.getByTestId(`ss-plan-open-${W}/n2`)).toContainText('The answer to Q1');
  await expect(page.getByTestId(`ss-plan-open-${W}/n2`)).toContainText('the module ends: Unable to verify');
  await expect(page.getByTestId('ss-plan-open-body')).toContainText('It does not choose between them');
  // 3 · actually delivered in the simulated run
  await expect(page.getByTestId('ss-plan-said-end')).toHaveAttribute('data-terminal', 'COMPLETED');
  await page.getByTestId('ss-plan-said-toggle').click();
  await expect(page.getByTestId('ss-plan-said-note')).toContainText('Not part of the plan');
  await expect(page.getByTestId('ss-plan-said').getByRole('listitem').first()).toContainText('SecureLife Protect');
  await shot(page, 'UC24-three-sections-opened', true);
  const hashNormal = await page.getByTestId('ss-plan-hash').textContent();

  // ------------------------------------------------------------ another application: another plan; still not eligible
  await page.getByTestId('ss-plan-profile').selectOption('HIGH_PREMIUM');
  await expect(page.getByTestId('ss-plan-module-mi-high-value-review')).toHaveAttribute('data-status', 'IN');
  await expect(page.getByTestId('ss-plan-hash')).not.toHaveText(hashNormal!);
  await expect(b).toHaveAttribute('data-eligible', 'no');

  // a missing value: A becomes "no", with the reason; nothing is defaulted
  await page.getByTestId('ss-plan-profile').selectOption('MISSING');
  await expect(a).toHaveAttribute('data-status', 'BLOCKED');
  await expect(a).toContainText('No — the plan cannot be completed');
  await expect(page.getByTestId('ss-plan-blockers')).toContainText('“Annual premium” is missing from this customer’s record.');
  await expect(state('PLAN_COMPUTABLE')).toHaveAttribute('data-state', 'NOT_MET');
  await expect(page.getByTestId('ss-plan-missing')).not.toHaveText('0');
  await expect(page.getByTestId('ss-plan-wording')).toHaveText('1');
  await expect(page.getByTestId('ss-plan-said-end')).toHaveAttribute('data-terminal', 'MISSING_INFORMATION_HALT');
  await page.getByTestId('ss-plan-inputs-toggle').click();
  await expect(page.getByTestId('ss-plan-input-policy.annual_premium')).toContainText('Missing');
  await shot(page, 'UC25-plan-not-computable-missing-value', true);

  // ------------------------------------------------------------ a recording with no approved asset BLOCKS
  await page.getByTestId('ss-plan-profile').selectOption('NORMAL');
  await step(page, 'build');
  await expect(page.getByTestId('ss-q-n1').locator('.ss-q-num').first()).toHaveText('S1');
  await expect(page.getByTestId('ss-q-n2').locator('.ss-q-num').first()).toHaveText('Q1');
  await page.getByTestId('ss-wording-n7-toggle').click();
  await page.getByTestId('ss-wording-n7-delivery-EXACT_AUDIO').check();
  await expect(page.getByTestId('ss-wording-n7')).toContainText('an approved recording is required, and none is attached');
  await expect(page.getByTestId('ss-status-n7')).toContainText('1 to fix');
  await shot(page, 'UC26-recording-without-asset-blocks');
  // it is a blocker in validation, not a warning that could be acknowledged; and the plan shows the delivery condition as not met
  await step(page, 'validate');
  await expect(page.getByTestId('ss-val-verdict')).toContainText(/cannot be submitted|blocker/i);
  await expect(page.locator('[data-testid="ss-finding"]', { hasText: 'an approved recording is required' }).getByTestId('ss-ack')).toHaveCount(0);
  await shot(page, 'UC27-validation-recording-is-a-blocker', true);
  await step(page, 'simulate');
  await page.getByTestId('ss-sim-plan').click();
  await expect(state('DELIVERY_CONTROLLED')).toHaveAttribute('data-state', 'NOT_MET');
  await page.getByTestId('ss-plan-conds-toggle').click();
  await expect(state('DELIVERY_CONTROLLED')).toContainText('needs an approved recording, and none is attached');
  await scan(page, 'call plan with a blocked delivery');
});
