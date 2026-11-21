import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { accounts, signIn } from '../helpers';

// SS-02A.1 — the refinements requested by the owner, demonstrated in Chromium with the prototype setting ON:
//   R: blank module, five options + duplicate + routing the copy, follow-ups, optional interruption with resume,
//      stop-and-go, mandatory escalation that cannot be overridden, collapsed branch with an unresolved destination,
//      undo/redo, and layouts at 1440 / 1280 / 1024 px with accessibility scans.
//   K: a survey and a module authored with the keyboard alone.
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
/** The stable codes of a question's answers, in display order (each row's test id carries its code). */
const codes = (card: Locator, node: string) => card.locator('.ss-option').evaluateAll((els, n) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace(`ss-option-${n}-`, '')), node);

/** One screen state at the three supported desktop widths: no sideways page scroll, screenshot, accessibility scan. */
async function atWidths(page: Page, name: string, essential: Locator[] = []) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => undefined))));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect.soft(overflow, `sideways page scroll on ${name} at ${width}px`).toBeLessThanOrEqual(0);
    for (const el of essential) {
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      expect.soft(box && box.x >= 0 && box.x + box.width <= width, `${name} at ${width}px: an essential routing control is cut off`).toBeTruthy();
    }
    const result = await new AxeBuilder({ page }).include('[data-testid="survey-studio"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect.soft(bad.map((v) => `${name}@${width}: ${v.id} (${v.nodes.slice(0, 6).map((x) => x.target.join(' ')).join(', ')})`)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/W-${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('SS-02A.1 refinements: blank module, duplicate, interruptions, unresolved branches, undo, widths', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  await expect(page.getByTestId('ss-prototype-tag')).toHaveText(/Prototype · not saved/);
  await atWidths(page, 'home');

  await page.getByTestId('ss-create').click();
  await page.getByTestId('ss-create-name').fill('Refinement check');
  await page.getByTestId('ss-create-go').click();

  // ------------------------------------------------------------------------------------------- blank module creation
  await page.getByTestId('ss-add-first').click();
  await page.getByTestId('ss-blank-module').click();
  await page.getByTestId('ss-new-module-name').fill('Payment method check');
  await page.getByTestId('ss-new-module-kind').selectOption('PRODUCT');
  await page.getByTestId('ss-new-module-intent').fill('Checks how the premium is paid');
  await shot(page, 'R1-create-blank-module');
  await page.getByTestId('ss-new-module-go').click();
  await expect(page).toHaveURL(/\/surveys\/S-REFINEMENT-CHECK-1\/modules\/mi-payment-method-check$/);
  await expect(page.getByTestId('ss-module-empty')).toContainText('no questions yet');
  await expect(page.locator('.ss-crumbs')).toContainText('Draft · not in the shared library');
  await expect(page.locator('.ss-notice')).toContainText('Created the blank module "Payment method check"');
  await shot(page, 'R2-blank-module-empty-state');

  // ------------------------------------------------------------ five options, duplicate, route the copy, reorder
  await page.getByTestId('ss-new-SINGLE_SELECT').click();
  const n1 = page.getByTestId('ss-q-n1');
  await typeQuestion(n1, 'How do you pay your premium?');
  const add = page.getByTestId('ss-option-new-n1');
  for (const label of ['Giro', 'Credit card', 'Cash', 'Cheque', 'Bank transfer']) { await add.fill(label); await add.press('Enter'); }
  await n1.getByRole('radio', { name: 'Different next questions' }).click();
  for (const code of ['CREDIT_CARD', 'CHEQUE', 'BANK_TRANSFER']) { await page.getByTestId(`ss-dest-n1-${code}`).click(); await pick(page, 'End module: Completed'); }
  await page.getByTestId('ss-dest-n1-CASH').click();
  await page.getByTestId('ss-dest-n1-CASH-new-YES_NO').click();
  await typeQuestion(page.getByTestId('ss-q-n2'), 'Do you have a receipt for each cash payment?');

  await page.getByTestId('ss-duplicate-n1-CASH').click();
  const copy = page.getByTestId('ss-option-n1-CASH_COPY');
  await page.getByTestId('ss-more-n1-CASH_COPY').click();
  await expect(page.getByTestId('ss-option-menu')).toContainText('CASH_COPY'); // a new stable code
  await page.keyboard.press('Escape');
  await copy.locator('.ss-option-label').focus();
  await expect(copy.locator('.ss-option-label')).toHaveValue('Cash (copy)');
  await expect(copy.locator('.ss-option-label')).toBeFocused(); // ready to rename
  await expect(page.getByTestId('ss-dest-n1-CASH_COPY')).toContainText('Choose destination'); // routing is NOT inherited
  await expect(page.getByTestId('ss-option-issue-n1-CASH_COPY')).toContainText('Not routed yet');
  await expect(page.getByTestId('ss-dest-n1-CASH')).toContainText('Do you have a receipt'); // the original keeps its route
  await expect(page.locator('.ss-notice')).toContainText('choose where the copy leads');
  await expect(issues(page)).toContainText('2 to fix'); // the copy, and the new question that leads nowhere yet
  await shot(page, 'R3-duplicate-option-unresolved', n1);
  await copy.locator('.ss-option-label').fill('Cash at a branch');
  await copy.locator('.ss-option-label').press('Alt+ArrowUp'); // keyboard reorder: above the original
  await expect.poll(() => codes(n1, 'n1')).toEqual(['GIRO', 'CREDIT_CARD', 'CASH_COPY', 'CASH', 'CHEQUE', 'BANK_TRANSFER']);
  await expect(page.getByTestId('ss-option-n1-CASH_COPY').locator('.ss-option-label')).toHaveValue('Cash at a branch'); // renamed, same code
  await page.getByTestId('ss-dest-n1-CASH_COPY').click();
  await pick(page, /Do you have a receipt/);
  await expect(page.getByTestId('ss-merge-n2')).toContainText('2 routes lead here');
  await expect(issues(page)).toContainText('1 to fix');
  await shot(page, 'R4-copy-routed-and-reordered', n1);

  // --------------------------------------------------------------- collapsed branch with an unresolved destination
  const lane = page.getByTestId('ss-lane-n1:CASH_COPY');
  await expect(page.getByTestId('ss-deadend-n1:CASH_COPY')).toContainText('This branch stops here');
  await lane.locator('.ss-lane-head').click(); // collapse it
  await expect(page.getByTestId('ss-q-n2')).toHaveCount(0);
  await expect(page.getByTestId('ss-lane-issues-n1:CASH_COPY')).toContainText('1 to fix — Q1a does not lead anywhere');
  await expect(lane).toContainText('does not lead anywhere yet');
  await shot(page, 'R5-collapsed-branch-unresolved', n1);
  await page.getByTestId('ss-next-issue').click(); // opens the lane and goes to the problem
  await expect(page.getByTestId('ss-q-n2')).toBeVisible();
  await page.getByTestId('ss-fold-n2').click(); // a folded card still names what is undecided
  await expect(page.getByTestId('ss-unresolved-n2')).toContainText('Not decided: everybody → ?');
  await shot(page, 'R6-folded-card-names-undecided', page.getByTestId('ss-q-n2'));
  await page.getByTestId('ss-unresolved-n2').click();
  await page.getByTestId('ss-dest-n2-ANY').click();
  await pick(page, 'End module: Completed');
  await expect(issues(page)).toContainText('Routing complete');

  // ------------------------------------------------------------------- multi-select follow-ups and interruptions
  await page.getByTestId('ss-insert-n1-GIRO').click();
  await page.getByTestId('ss-new-MULTI_SELECT').click();
  const n3 = page.getByTestId('ss-q-n3');
  await typeQuestion(n3, 'Has anything gone wrong with your payments?');
  const add3 = page.getByTestId('ss-option-new-n3');
  for (const label of ['Charged twice', 'Payment failed', 'I want to complain', 'I never agreed to pay', 'Nothing']) { await add3.fill(label); await add3.press('Enter'); }
  const setClass = async (code: string, cls: 'OPTIONAL' | 'MANDATORY') => {
    await page.getByTestId(`ss-more-n3-${code}`).click();
    await page.getByTestId(`ss-class-${cls}`).click();
  };
  await setClass('I_WANT_TO_COMPLAIN', 'OPTIONAL');
  await page.getByTestId('ss-more-n3-I_NEVER_AGREED_TO_PAY').click();
  await shot(page, 'R7-interruption-governance-on-the-answer');
  await page.getByTestId('ss-class-MANDATORY').click();
  await expect(page.getByTestId('ss-option-n3-I_NEVER_AGREED_TO_PAY')).toContainText('Must escalate');
  // a mandatory escalation is enforced in every routing mode
  await expect(page.getByTestId('ss-option-issue-n3-I_NEVER_AGREED_TO_PAY')).toContainText('so this answer can stop and escalate');
  await page.getByTestId('ss-more-n3-NOTHING').click();
  await page.getByTestId('ss-menu-exclusive').check();
  await page.keyboard.press('Escape');
  await n3.getByRole('radio', { name: 'Follow-ups for each answer' }).click();
  await expect(page.getByTestId('ss-queue-undecided-n3')).toContainText('I want to complain'); // an undeclared answer shows in the queue too
  await page.getByTestId('ss-fu-n3-CHARGED_TWICE').click();
  await pick(page, 'New yes / no question');
  await typeQuestion(page.getByTestId('ss-q-n4'), 'Was the second charge refunded?');
  await page.getByTestId('ss-fu-n3-PAYMENT_FAILED').click();
  await pick(page, 'New yes / no question');
  await typeQuestion(page.getByTestId('ss-q-n5'), 'Has the failed payment been retried?');

  // mandatory escalation: the only choices are escalations, and the other behaviours cannot be selected
  await page.getByTestId('ss-fu-n3-I_NEVER_AGREED_TO_PAY').click();
  await expect(page.getByRole('option', { name: /No follow-up/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /New yes \/ no question/ })).toHaveCount(0);
  await pick(page, 'Stop and escalate: Escalate');
  const must = page.getByTestId('ss-interrupt-n3-I_NEVER_AGREED_TO_PAY');
  await expect(must).toContainText('Mandatory escalation · set by the question');
  for (const pol of ['RESUME', 'STOP_REJOIN']) {
    const b = page.getByTestId(`ss-policy-n3-I_NEVER_AGREED_TO_PAY-${pol}`);
    await expect(b).toHaveAttribute('aria-disabled', 'true');
    await expect(b).toContainText('a placement cannot weaken it');
    await b.click({ force: true }); // trying anyway changes nothing
  }
  await expect(page.getByTestId('ss-policy-n3-I_NEVER_AGREED_TO_PAY-STOP_ESCALATE')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('ss-fu-n3-I_NEVER_AGREED_TO_PAY')).toContainText('Stops · Escalate');
  await shot(page, 'R8-mandatory-escalation-cannot-be-overridden', must);

  // optional interruption B: handle it first, then resume the queue
  await page.getByTestId('ss-fu-n3-I_WANT_TO_COMPLAIN').click();
  await pick(page, 'Handle this first, then continue');
  await expect(issues(page)).toContainText('1 to fix'); // nothing continues implicitly: the question to ask first is required
  await expect(must).toHaveCount(0); // SS-02A.2: one interruption rule is open at a time
  await page.getByTestId('ss-interrupt-ask-n3-I_WANT_TO_COMPLAIN').click();
  await page.getByTestId('ss-new-FREE_TEXT').click();
  await typeQuestion(page.getByTestId('ss-q-n6'), 'What is your complaint about?');
  await page.getByTestId('ss-try-toggle-n3').click();
  await page.getByTestId('ss-try-n3-PAYMENT_FAILED').check();
  await page.getByTestId('ss-try-n3-I_WANT_TO_COMPLAIN').check();
  await page.getByTestId('ss-try-n3-CHARGED_TWICE').check();
  const steps = page.getByTestId('ss-try-steps-n3').getByRole('listitem');
  await expect(steps).toHaveText([/Ask.*What is your complaint about/, /Ask.*second charge refunded/, /Ask.*failed payment been retried/, /Then.*End module: Completed/]);
  await expect(page.getByTestId('ss-try-note-n3')).toContainText('handled first; the remaining follow-ups then continue');
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'R9-optional-interruption-handle-and-resume', n3);
  // SS-02A.2: the default state is compact — every interrupting answer keeps a short badge, no rule is expanded
  await page.getByTestId('ss-rule-toggle-n3-I_WANT_TO_COMPLAIN').click();
  await expect(page.locator('.ss-interrupt')).toHaveCount(0);
  await expect(page.getByTestId('ss-fu-n3-I_WANT_TO_COMPLAIN')).toContainText('Asked first, then continues');
  await expect(page.getByTestId('ss-fu-n3-I_NEVER_AGREED_TO_PAY')).toContainText('Stops · Escalate');
  await expect(page.getByTestId('ss-option-n3-I_NEVER_AGREED_TO_PAY')).toContainText('Must escalate'); // never hidden
  await page.getByTestId('ss-try-toggle-n3').click();
  await shot(page, 'U5-multi-select-default-compact', n3);
  await page.getByTestId('ss-rule-toggle-n3-I_NEVER_AGREED_TO_PAY').click();
  await expect(page.getByTestId('ss-interrupt-n3-I_NEVER_AGREED_TO_PAY')).toBeVisible();
  await shot(page, 'U6-multi-select-interruption-rule-expanded', n3);
  await page.getByTestId('ss-rule-toggle-n3-I_WANT_TO_COMPLAIN').click(); // opening another closes the first
  await expect(page.getByTestId('ss-interrupt-n3-I_NEVER_AGREED_TO_PAY')).toHaveCount(0);
  await page.getByTestId('ss-try-toggle-n3').click();
  await atWidths(page, 'builder-interruptions', [page.getByTestId('ss-rejoin-n3'), page.getByTestId('ss-fu-n3-I_WANT_TO_COMPLAIN')]);

  // optional interruption C: stop and go to an explicitly chosen destination
  await page.getByTestId('ss-policy-n3-I_WANT_TO_COMPLAIN-STOP_REJOIN').click();
  await expect(page.getByTestId('ss-interrupt-rejoin-n3-I_WANT_TO_COMPLAIN')).toContainText('Choose the destination'); // never invented
  await expect(issues(page)).toContainText('1 to fix');
  await expect(page.getByTestId('ss-q-n6')).toHaveCount(0); // its question went with the behaviour that needed it
  await page.getByTestId('ss-interrupt-rejoin-n3-I_WANT_TO_COMPLAIN').click();
  await pick(page, 'End module: Clarification required');
  await expect(steps).toHaveText([/Then.*End module: Clarification required/]);
  await expect(page.getByTestId('ss-try-skipped-n3')).toContainText('second charge refunded');
  await shot(page, 'R10-optional-interruption-stop-and-go', n3);

  // optional interruption A: stop and escalate — and a mandatory escalation wins when both are selected
  await page.getByTestId('ss-policy-n3-I_WANT_TO_COMPLAIN-STOP_ESCALATE').click();
  await page.getByTestId('ss-interrupt-outcome-n3-I_WANT_TO_COMPLAIN').selectOption('CLARIFICATION_REQUIRED');
  await expect(steps).toHaveText([/Stop.*Clarification required/]);
  await page.getByTestId('ss-try-n3-I_NEVER_AGREED_TO_PAY').check();
  await expect(steps).toHaveText([/Stop.*Escalate/]);
  await expect(issues(page)).toContainText('Routing complete');

  // ------------------------------------------------------------------------------- undo / redo after structural edits
  await page.getByTestId('ss-undo').click(); // the outcome choice
  await page.getByTestId('ss-undo').click(); // the switch to stop-and-escalate
  await expect(page.getByTestId('ss-policy-n3-I_WANT_TO_COMPLAIN-STOP_REJOIN')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('ss-interrupt-rejoin-n3-I_WANT_TO_COMPLAIN')).toContainText('End module: Clarification required');
  await page.getByTestId('ss-undo').click(); // the destination
  await page.getByTestId('ss-undo').click(); // the switch to stop-and-go: handle-and-resume and its question are back
  await expect(page.getByTestId('ss-q-n6').locator('.ss-q-text textarea')).toHaveValue('What is your complaint about?');
  await expect(page.locator('.ss-notice')).toContainText('Undid:');
  await page.getByTestId('ss-redo').click();
  await page.getByTestId('ss-redo').click();
  await expect(page.getByTestId('ss-interrupt-rejoin-n3-I_WANT_TO_COMPLAIN')).toContainText('End module: Clarification required');
  await page.getByTestId('ss-delete-n3').click();
  await page.getByTestId('ss-delete-confirm').click();
  await expect(n3).toHaveCount(0);
  await page.getByTestId('ss-undo').click();
  await expect(n3).toBeVisible();
  await expect(page.getByTestId('ss-q-n4')).toBeVisible(); // its follow-ups came back with it
  await shot(page, 'R11-after-undo-redo', n3);

  // ----------------------------------------------- back in the composer: the draft module and its new outcomes
  await page.getByRole('link', { name: 'Refinement check' }).click();
  const card = page.getByTestId('ss-card-mi-payment-method-check');
  await expect(card).toContainText('Draft · not in the shared library');
  await expect(page.getByTestId('ss-route-mi-payment-method-check-ESCALATE')).toContainText('ends the call: Escalate'); // an escalation is terminal: its route is governed, not left to choose (SS-02 closure)
  await atWidths(page, 'composer-with-issues', [page.getByTestId('ss-route-mi-payment-method-check-ESCALATE')]);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.reload(); // at 1024 the library starts closed and opens as an overlay
  await signInAgainIfNeeded(page);
});

/** The prototype keeps nothing: after a reload the workspace is the sample library again, and the message says so. */
async function signInAgainIfNeeded(page: Page) {
  await page.goto('/survey-studio');
  await expect(page.getByTestId('ss-prototype-tag')).toHaveText(/Prototype · not saved/);
  await expect(page.getByTestId('ss-no-drafts')).toBeVisible(); // nothing was persisted, and nothing pretends otherwise
  await page.getByTestId('ss-prototype-tag').click();
  await expect(page.getByText('nothing is saved')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/R12-not-saved-after-reload-1024.png` });
  await page.keyboard.press('Escape');
  await page.getByTestId('ss-create').click();
  await page.getByTestId('ss-create-name').fill('Narrow');
  await page.getByTestId('ss-create-template').check();
  await page.getByTestId('ss-create-go').click();
  await expect(page.getByTestId('ss-shelf')).toHaveCount(0); // the library is not in the way at 1024
  await page.getByRole('button', { name: 'Module library' }).click();
  await expect(page.getByTestId('ss-shelf')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/W-composer-library-overlay-1024.png` });
  await page.getByRole('button', { name: 'Hide the module library' }).click();
  await page.getByTestId('ss-rule-mi-suitability').click();
  await atWidths(page, 'condition-drawer');
}

// =====================================================================================================================
// Keyboard only. After signing in, no mouse or touch action is used: every step is a key press.
// =====================================================================================================================
test('SS-02A.1 keyboard-only authoring: survey, modules, reorder, routes, questions, options, duplicate, undo', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  const kb = page.keyboard;
  const focused = (l: Locator) => l.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)).catch(() => false);
  /** Press Tab until the control has focus — a real traversal, so an unreachable control fails the test. */
  const tabTo = async (l: Locator, name: string, max = 140) => {
    for (let i = 0; i < max; i++) {
      if (await focused(l)) {
        await expect(l, `${name}: focus must be visible`).toBeFocused();
        return;
      }
      await kb.press('Tab');
    }
    throw new Error(`Keyboard: could not reach ${name} with Tab`);
  };
  const cards = page.locator('[data-testid^="ss-card-"] h3');

  // skip the application navigation, then create a survey
  await kb.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await kb.press('Enter');
  await tabTo(page.getByTestId('ss-create'), 'Create survey');
  await kb.press('Enter');
  await expect(page.getByTestId('ss-create-name')).toBeFocused(); // focus lands in the first field
  await kb.type('Keyboard survey');
  await kb.press('Enter');
  await expect(page).toHaveURL(/\/surveys\/S-KEYBOARD-SURVEY-1$/);

  // add three modules by search
  await tabTo(page.getByTestId('ss-add-first'), 'Add your first module');
  await kb.press('Enter');
  await expect(page.getByPlaceholder('Search modules to add')).toBeFocused();
  await kb.type('general');
  await kb.press('Enter');
  await expect(cards).toHaveText(['General verification']);
  for (const [gap, word] of [['ss-add-here-1', 'suitab'], ['ss-add-here-2', 'closing']] as const) {
    await tabTo(page.getByTestId(gap), 'Add a module here');
    await kb.press('Enter');
    await kb.type(word);
    await kb.press('Enter');
  }
  await expect(cards).toHaveText(['General verification', 'Suitability', 'Closing']);

  // reorder: keyboard drag, then the move button
  await tabTo(page.getByRole('button', { name: 'Drag to reorder Closing' }), 'drag handle of Closing');
  await kb.press('Space');
  await page.waitForTimeout(200);
  await kb.press('ArrowUp');
  await page.waitForTimeout(200);
  await kb.press('Space');
  await expect(cards).toHaveText(['General verification', 'Closing', 'Suitability']);
  await tabTo(page.getByTestId('ss-down-mi-closing'), 'Move Closing down');
  await kb.press('Enter');
  await expect(cards).toHaveText(['General verification', 'Suitability', 'Closing']);

  // route the two exceptional outcomes
  await kb.press('F8'); // next issue
  await tabTo(page.getByTestId('ss-route-mi-general-verification-UNABLE_TO_VERIFY'), 'route for Unable to verify');
  await kb.press('Enter');
  await kb.type('unable');
  await kb.press('Enter');
  await expect(page.getByTestId('ss-route-mi-general-verification-UNABLE_TO_VERIFY')).toBeFocused(); // focus returns to the control
  await tabTo(page.getByTestId('ss-route-mi-suitability-CLARIFICATION_REQUIRED'), 'route for Clarification required');
  await kb.press('Enter');
  await kb.press('Enter'); // the first choice: continue to the next module
  await expect(page.getByTestId('ss-issues')).toContainText('Routing complete');

  // entry rule drawer: open, change the missing-information policy, apply; Escape would cancel
  await tabTo(page.getByTestId('ss-rule-mi-suitability'), 'entry rule chip');
  await kb.press('Enter');
  await expect(page.getByRole('dialog', { name: 'When does Suitability run?' })).toBeFocused();
  await tabTo(page.getByTestId('ss-policy-block'), 'missing-information choice'); // a radio group is one tab stop…
  await kb.press('ArrowDown'); // …and the arrow keys move within it
  await expect(page.getByTestId('ss-policy-skip')).toBeChecked();
  await tabTo(page.getByTestId('ss-rule-apply'), 'Apply');
  await kb.press('Enter');
  await expect(page.getByRole('dialog', { name: 'When does Suitability run?' })).toHaveCount(0);
  await expect(page.getByTestId('ss-rule-mi-suitability')).toBeFocused(); // focus returns to the control that opened the drawer

  // SS-02A.2: the drawer is modal — Tab never leaves it, the background is inert, Escape closes and restores focus
  await kb.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'When does Suitability run?' });
  await expect(dialog).toBeFocused();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAccessibleDescription(/Applies to this place in this survey only/);
  await expect(page.locator('.ss-canvas')).toHaveAttribute('inert', '');
  await expect(page.locator('.ss-bar')).toHaveAttribute('inert', '');
  const inside = () => dialog.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));
  for (let i = 0; i < 45; i++) { await kb.press('Tab'); expect(await inside(), `Tab ${i + 1} left the drawer`).toBe(true); }
  for (let i = 0; i < 12; i++) { await kb.press('Shift+Tab'); expect(await inside(), `Shift+Tab ${i + 1} left the drawer`).toBe(true); }
  await page.screenshot({ path: `${SHOTS}/U7-condition-drawer-keyboard-focus.png` });
  await kb.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('ss-rule-mi-suitability')).toBeFocused();
  await expect(page.locator('.ss-canvas')).not.toHaveAttribute('inert', '');

  // open the module, make a draft copy, add a Yes/No question on a route
  await tabTo(page.getByTestId('ss-open-mi-suitability'), 'Open module');
  await kb.press('Enter');
  await tabTo(page.getByTestId('ss-derive'), 'Edit a copy for this survey');
  await kb.press('Enter');
  await tabTo(page.getByTestId('ss-insert-n1-YES'), 'Add a question here');
  await kb.press('Enter');
  await expect(page.getByTestId('ss-new-YES_NO')).toBeFocused();
  await kb.press('Enter');
  const n4 = page.getByTestId('ss-q-n4');
  await expect(n4.locator('.ss-q-text textarea')).toBeFocused(); // straight into the new question's text
  await kb.type('Did your representative explain the charges?');
  await kb.press('Enter'); // commits the text
  await tabTo(n4.getByRole('radio', { name: 'Different next questions' }), 'Different next questions');
  await kb.press('Enter');
  await tabTo(page.getByTestId('ss-dest-n4-NO'), 'destination of No');
  await kb.press('Enter');
  await kb.type('clarification req');
  await kb.press('Enter');
  await expect(page.getByTestId('ss-dest-n4-NO')).toContainText('End module: Clarification required');

  // a single-choice question: options by typing, duplicate, reorder, route the copy
  await tabTo(page.getByTestId('ss-insert-n4-YES'), 'Add a question here (after Q2)');
  await kb.press('Enter');
  await kb.press('Tab'); // second type: Single choice
  await expect(page.getByTestId('ss-new-SINGLE_SELECT')).toBeFocused();
  await kb.press('Enter');
  const n5 = page.getByTestId('ss-q-n5');
  await expect(n5.locator('.ss-q-text textarea')).toBeFocused();
  await kb.type('Which part matters most to you?');
  await kb.press('Enter');
  await tabTo(page.getByTestId('ss-option-new-n5'), 'new option field');
  for (const label of ['Premium', 'Benefits', 'Claims']) { await kb.type(label); await kb.press('Enter'); }
  await expect.poll(() => codes(n5, 'n5')).toEqual(['PREMIUM', 'BENEFITS', 'CLAIMS']);
  await tabTo(n5.getByRole('radio', { name: 'Different next questions' }), 'Different next questions (Q3)');
  await kb.press('Enter');
  for (const code of ['BENEFITS', 'CLAIMS']) {
    await tabTo(page.getByTestId(`ss-dest-n5-${code}`), `destination of ${code}`);
    await kb.press('Enter');
    await kb.type('completed');
    await kb.press('Enter');
  }
  for (let i = 0; i < 4; i++) await kb.press('Shift+Tab'); // back up to the Claims row
  await tabTo(page.getByTestId('ss-duplicate-n5-CLAIMS'), 'Duplicate Claims');
  await kb.press('Enter');
  const copy = page.getByTestId('ss-option-n5-CLAIMS_COPY');
  await expect(copy.locator('.ss-option-label')).toBeFocused();
  await expect(page.getByTestId('ss-dest-n5-CLAIMS_COPY')).toContainText('Choose destination');
  await kb.press('ControlOrMeta+a');
  await kb.type('Claims by post');
  await kb.press('Alt+ArrowUp');
  await expect.poll(() => codes(n5, 'n5')).toEqual(['PREMIUM', 'BENEFITS', 'CLAIMS_COPY', 'CLAIMS']);
  await expect(page.getByTestId('ss-option-n5-CLAIMS_COPY').locator('.ss-option-label')).toBeFocused(); // focus follows the moved row
  await tabTo(page.getByTestId('ss-dest-n5-CLAIMS_COPY'), 'destination of the copy');
  await kb.press('Enter');
  await kb.type('clarify');
  await kb.press('Enter');
  await expect(page.getByTestId('ss-dest-n5-CLAIMS_COPY')).toContainText('What would you like us to clarify');
  await expect(page.getByTestId('ss-issues')).toContainText('Routing complete');
  await page.screenshot({ path: `${SHOTS}/K1-keyboard-only-module.png` });

  // undo and redo from the keyboard
  await tabTo(page.getByTestId('ss-undo'), 'Undo');
  await kb.press('Enter');
  await expect(page.getByTestId('ss-dest-n5-CLAIMS_COPY')).toContainText('Choose destination');
  await kb.press('Tab');
  await expect(page.getByTestId('ss-redo')).toBeFocused();
  await kb.press('Enter');
  await expect(page.getByTestId('ss-dest-n5-CLAIMS_COPY')).toContainText('What would you like us to clarify');
  await kb.press('ControlOrMeta+z'); // the shortcut, with focus on a button
  await expect(page.getByTestId('ss-dest-n5-CLAIMS_COPY')).toContainText('Choose destination');
  await kb.press('ControlOrMeta+Shift+z');
  await expect(page.getByTestId('ss-issues')).toContainText('Routing complete');
});
