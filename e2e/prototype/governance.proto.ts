import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { accounts, signIn } from '../helpers';

// SS-02C — the final prototype checkpoint, end to end in Chromium with the prototype setting ON:
//   Library → Compose → Build modules → Simulate → Validate → Review → Publish, as ONE journey.
//   Validation: blockers and warnings, click-to-fix, acknowledgement; an invalid survey is never "ready".
//   Maker-checker (SIMULATED): submit, inspect, send back, change, resubmit, no self-approval, approve, a change voids
//   the approval, publish an immutable version, history and audit. Revision comparison with impacted journeys.
const SHOTS = 'test-results/prototype/shots';
const shot = async (page: Page, name: string, full = false) => { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
const pick = async (page: Page, text: string | RegExp) => page.getByRole('option', { name: text }).first().click();
const step = async (page: Page, id: string) => page.getByTestId(`ss-journey-${id}`).click();
const actAs = async (page: Page, id: string) => page.getByTestId('ss-actor').selectOption(id);
const standing = (page: Page) => page.getByTestId('ss-standing');
const SPEC = 'mi-escalation-and-follow-up';

async function scan(page: Page, name: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).include('[data-testid="survey-studio"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(bad.map((v) => `${name}: ${v.id} (${v.nodes.slice(0, 6).map((x) => x.target.join(' ')).join(', ')})`)).toEqual([]);
}

test.use({ actionTimeout: 12_000 });

test('SS-02C: validation, comparison and the simulated maker-checker journey, from library to published version', async ({ page }) => {
  test.setTimeout(420_000);
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  await shot(page, 'W01-library');
  await page.getByTestId('ss-prototype-tag').click();
  await page.getByTestId('ss-add-demo').click();

  // ---------------------------------------------------------------- one journey: the same strip on every step
  const strip = page.getByTestId('ss-journey');
  await expect(strip.getByRole('listitem')).toHaveText([/Library/, /Compose/, /Build modules/, /Simulate/, /Validate/, /Review and publish/]);
  await expect(strip.locator('[aria-current="step"]')).toContainText('Simulate');
  await expect(strip).toContainText('Draft'); // a seeded earlier version exists, and the draft differs from it
  await page.getByTestId('ss-sim-run-all').click();
  await shot(page, 'W05-simulate');
  await step(page, 'compose');
  await expect(strip.locator('[aria-current="step"]')).toContainText('Compose');
  await shot(page, 'W02-compose');

  // -------------------------------------------- A-4 at authoring time: a mandatory escalation offers only its governed ending
  await page.getByTestId('ss-route-mi-clarifications-ESCALATE').click();
  const opts = page.locator('[role="option"]');
  await expect(opts).toHaveCount(1);
  await expect(opts).toContainText('End the call: Escalate');
  await expect(opts).toContainText('Mandatory escalation — survey routing cannot continue, complete or re-route it');
  await page.keyboard.press('Escape');
  // an ordinary outcome of the same module is still routed freely
  await page.getByTestId('ss-route-mi-clarifications-COMPLETED').click();
  expect(await opts.count()).toBeGreaterThan(3);
  await page.keyboard.press('Escape');

  // --------------------------------------------------- A-2: activation and eligibility are two settings in one drawer
  await page.getByTestId(`ss-rule-${SPEC}`).click();
  await page.getByTestId('ss-activation').getByRole('radio', { name: 'After an outcome' }).click();
  await page.getByTestId('ss-rule-of').selectOption({ label: 'Affordability check' });
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Clarification required' }).check();
  await expect(page.getByTestId('ss-rule-sentence')).toHaveText('This module is selected after Affordability check ends with Clarification required. It then runs only when Customer age is at least 60 years.');
  await expect(page.getByTestId('ss-seq-skip')).toHaveValue(''); // in sequence, "continue" stays the normal default
  await shot(page, 'GV13-activation-and-eligibility');
  await page.getByTestId('ss-rule-apply').click();
  await expect(page.getByTestId(`ss-rule-${SPEC}`)).toContainText('after Affordability check ends with Clarification required, and only when Customer age is at least 60 years');
  await page.getByTestId('ss-undo').click();
  await expect(page.getByTestId(`ss-rule-${SPEC}`)).toContainText('when Customer age is at least 60 years');

  // ----------------------------------------------------------------------------- Validation: warnings only
  await step(page, 'validate');
  const verdict = page.getByTestId('ss-val-verdict');
  await expect(verdict).toHaveAttribute('data-state', 'attention');
  await expect(page.getByTestId('ss-val-blockers')).toHaveText('0');
  await expect(page.getByTestId('ss-val-verdict-title')).toContainText('Not ready for review');
  await expect(page.getByTestId('ss-val-notice')).toContainText('Nothing here is submitted or approved');
  await expect(page.getByTestId('ss-area-GOVERNANCE')).toHaveAttribute('data-state', 'ATTENTION');
  await expect(page.getByTestId('ss-area-ROUTING')).toHaveAttribute('data-state', 'OK');
  await shot(page, 'GV01-validation-warnings');
  await scan(page, 'validation (warnings)');

  // -------------------------------------- Story 10: an invalid draft — blockers grouped, navigable, submit unavailable
  await step(page, 'compose');
  await page.getByTestId(`ss-skip-${SPEC}`).click();
  await pick(page, 'Leave undecided for now');
  await step(page, 'validate');
  await expect(verdict).toHaveAttribute('data-state', 'blocked');
  await expect(page.getByTestId('ss-val-blockers')).toHaveText('2');
  await expect(page.getByTestId('ss-val-verdict-title')).toHaveText('Not ready for review — 2 blockers to fix');
  await expect(verdict).toContainText('a synthetic customer completing the call does not make an invalid survey valid');
  await expect(page.getByTestId('ss-area-CONDITIONS')).toHaveAttribute('data-state', 'BLOCKED');
  await expect(page.getByTestId('ss-area-COVERAGE')).toHaveAttribute('data-state', 'BLOCKED');
  await expect(page.getByTestId('ss-val-to-review')).toHaveAttribute('aria-disabled', 'true');
  const blocker = page.getByTestId('ss-finding').filter({ hasText: 'choose what happens if it is jumped to but does not apply' });
  await expect(blocker).toHaveAttribute('data-severity', 'BLOCKER');
  await expect(blocker).toContainText('Activation and eligibility · Escalation and follow-up');
  await expect(blocker.getByTestId('ss-ack')).toHaveCount(0); // a blocker cannot be acknowledged
  await shot(page, 'GV02-validation-blockers');
  // the ordinary customer still completes the call — and the survey is still not submittable
  await page.getByTestId('ss-val-coverage').locator('summary').click();
  await expect(page.getByTestId('ss-val-coverage')).toContainText('Normal policyholder');
  await expect(page.getByTestId('ss-val-coverage').getByRole('row', { name: /Normal policyholder/ })).toContainText('Completed');
  await expect(page.getByTestId('ss-val-coverage').getByRole('row', { name: /Uneasy younger customer/ })).toContainText('Cannot run — the draft is invalid');
  await step(page, 'review');
  await expect(page.getByTestId('ss-simulated-banner')).toContainText('Nothing is a real governance approval');
  await expect(page.getByTestId('ss-submit')).toBeDisabled();
  await expect(page.getByTestId('ss-submit-reason')).toContainText('Not ready for review: 2 blockers must be fixed');
  await shot(page, 'GV03-submit-refused-invalid-draft');

  // -------------------------------------------------------- click-to-fix: straight to the control, then back
  await step(page, 'validate');
  await blocker.getByTestId('ss-finding-go').click();
  await expect(page.getByTestId(`ss-card-${SPEC}`)).toBeInViewport();
  await page.getByTestId(`ss-skip-${SPEC}`).click();
  await pick(page, 'End the call: Clarification required');
  await step(page, 'validate');
  await expect(page.getByTestId('ss-val-blockers')).toHaveText('0');

  // ----------------------------------------- warnings: acknowledged with a reason, never silently
  const first = page.getByTestId('ss-finding').filter({ has: page.getByTestId('ss-ack') }).first();
  await first.getByTestId('ss-ack').click();
  await page.getByTestId('ss-ack-confirm').click();
  await expect(page.getByTestId('ss-findings').getByRole('alert')).toContainText('Say why this is acceptable');
  await page.getByTestId('ss-ack-note').fill('Known and accepted: to be decided with Compliance before any real use.');
  await page.getByTestId('ss-ack-confirm').click();
  await expect(page.getByTestId('ss-finding-acked').first()).toContainText('Acknowledged by Mei Ling Tan (author)');
  for (let guard = 0; guard < 8 && await page.getByTestId('ss-ack').count(); guard++) {
    await page.getByTestId('ss-ack').first().click();
    await page.getByTestId('ss-ack-note').fill('Reviewed with the team; acceptable for this revision.');
    await page.getByTestId('ss-ack-confirm').click();
  }
  await expect(verdict).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('ss-val-verdict-title')).toHaveText('Ready to submit for review');
  await expect(verdict).toContainText('It is not an approval');
  await shot(page, 'GV04-validation-ready');
  await page.getByTestId('ss-area-DEPENDENCIES').click();
  await expect(page.getByTestId('ss-val-lock')).toContainText('Shared library version');
  await shot(page, 'GV05-pinned-versions');
  await page.getByTestId('ss-area-ALL').click();

  // ------------------------------------------------------------------- submit (author), inspect (checker)
  await page.getByTestId('ss-val-to-review').click();
  await expect(standing(page)).toHaveAttribute('data-stage', 'DRAFT');
  await expect(standing(page)).toContainText('Draft with changes since version 1.0');
  await page.getByTestId('ss-submit').click();
  await expect(page.getByTestId('ss-rev-error')).toContainText('Describe what changed and why');
  await page.getByTestId('ss-submit-note').fill('Adds a specialist call for older customers who are not comfortable with the premium.');
  await page.getByTestId('ss-submit').click();
  // submitting froze a candidate with its own ID, revision and dependency manifest (C-1 is the seeded version 1.0)
  await expect(standing(page)).toHaveAttribute('data-stage', 'IN_REVIEW');
  await expect(standing(page)).toContainText('Candidate C-2 (revision 2) is waiting for a checker');
  const cand = page.getByTestId('ss-candidate');
  await expect(cand).toHaveAttribute('data-candidate', 'C-2');
  await expect(cand).toContainText('Frozen');
  await expect(page.getByTestId('ss-manifest')).toHaveText(/^[0-9a-f]{8}$/);
  await expect(page.getByTestId('ss-inspect-panel')).toContainText('Submitted by Mei Ling Tan (author)');
  // the author cannot decide her own submission
  await expect(page.getByTestId('ss-approve')).toBeDisabled();
  await expect(page.getByTestId('ss-decide-reason')).toContainText('Only a checker approves or rejects.');
  await actAs(page, 'p-checker');
  await expect(page.getByTestId('ss-acting')).toContainText('Arjun Menon');
  await expect(page.getByTestId('ss-approve')).toBeEnabled();
  await expect(page.getByTestId('ss-diff-summary')).toContainText('Journeys affected');
  await expect(page.getByTestId('ss-inspect-wording')).toContainText('May one of our specialists call you to explain this further?');
  await expect(page.getByTestId('ss-inspect-acks')).toContainText('Known and accepted');
  await page.getByTestId('ss-lock').locator('summary').click();
  await expect(page.getByTestId('ss-lock')).toContainText('M-ESCALATION v1');
  await shot(page, 'GV06-reviewer-inspection', true);
  await scan(page, 'reviewer inspection');
  // approving needs the wording to have been read; sending back needs a comment
  await page.getByTestId('ss-approve').click();
  await expect(page.getByTestId('ss-rev-error')).toContainText('Confirm that you have read');
  await page.getByTestId('ss-reject').click();
  await expect(page.getByTestId('ss-rev-error')).toContainText('Say what must change');
  await page.getByTestId('ss-decide-comment').fill('The closing acknowledgement should name the policy.');
  await page.getByTestId('ss-reject').click();
  await expect(standing(page)).toHaveAttribute('data-stage', 'REJECTED');

  // ----------------------------------------- the author changes a wording (Guided Builder) and resubmits
  await actAs(page, 'p-author');
  await expect(page.getByTestId('ss-sent-back')).toContainText('Candidate C-2 was sent back by Arjun Menon (checker)');
  await expect(page.getByTestId('ss-submit-reason')).toContainText('This exact draft was sent back as candidate C-2. Change it before submitting again.');
  await shot(page, 'GV07-sent-back');
  await step(page, 'compose');
  await page.getByTestId('ss-open-mi-closing').click();
  await expect(page.getByTestId('ss-journey').locator('[aria-current="step"]')).toContainText('Build modules');
  await page.getByTestId('ss-derive').click();
  await page.getByTestId('ss-change-n2').click();
  await page.getByTestId('ss-new-version').click();
  const box = page.getByTestId('ss-q-n2').locator('.ss-q-text textarea');
  await box.fill('Thank you. Do you acknowledge that this call about your policy has been completed?');
  await box.blur();
  await shot(page, 'W03-guided-builder');
  await step(page, 'review');
  await expect(standing(page)).toHaveAttribute('data-stage', 'DRAFT');

  // ------------------------------------------------------------------------------- compare two revisions
  await page.getByTestId('ss-tab-compare').click();
  await expect(page.getByTestId('ss-compare-from')).toHaveValue('v1'); // by default: against the latest published version
  await expect(page.getByTestId('ss-compare-to')).toHaveValue('draft');
  await expect(page.getByTestId('ss-changes-MODULES')).toContainText('Escalation and follow-up was added');
  const wording = page.getByTestId('ss-changes-QUESTIONS');
  await expect(wording).toContainText('Closing: the wording of a question changed');
  await expect(wording).toContainText('Thank you. Do you acknowledge that this call has been completed?');
  await expect(wording).toContainText('Thank you. Do you acknowledge that this call about your policy has been completed?');
  await expect(wording).toContainText('Needs wording approval');
  await expect(page.getByTestId('ss-changes-ROUTING')).toContainText('Affordability check: what “Clarification required” leads to');
  await expect(page.getByTestId('ss-changes-CONDITIONS')).toContainText('Whether High value review may run changed (eligibility)');
  await expect(page.getByTestId('ss-changes-DEPENDENCIES')).toContainText('Closing now pins a different module version');
  await expect(page.getByTestId('ss-changes-DEPENDENCIES')).toContainText('A question now pins a different version');
  await expect(page.getByTestId('ss-needs')).toContainText('Revalidation.');
  await expect(page.getByTestId('ss-needs')).toContainText('Re-approval. An approval belongs to one exact revision.');
  const journeys = page.getByTestId('ss-compare-journeys');
  await expect(journeys.locator('tr[data-changed="true"]')).not.toHaveCount(0);
  await expect(journeys.getByRole('row', { name: /Uneasy older customer/ })).toContainText('Now also runs Escalation and follow-up');
  await expect(journeys.getByRole('row', { name: /Normal policyholder/ })).toContainText('No difference');
  await shot(page, 'GV08-compare-revisions', true);
  await scan(page, 'compare revisions');
  // against the rejected candidate, only the wording change shows — a display number is not an identity
  await page.getByTestId('ss-compare-from').selectOption('C-2');
  await expect(page.getByTestId('ss-changes-MODULES')).toContainText('No change.');
  await expect(page.getByTestId('ss-changes-QUESTIONS').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('ss-changes-ROUTING')).toContainText('No change.');

  // ----------------------------------- a person with EVERY permission still cannot approve her own submission
  await page.getByTestId('ss-tab-review').click();
  await actAs(page, 'p-lead');
  await page.getByTestId('ss-submit-note').fill('Names the policy in the closing acknowledgement, as asked in review.');
  await page.getByTestId('ss-submit').click();
  await expect(standing(page)).toContainText('Candidate C-3 (revision 3) is waiting for a checker');
  await expect(page.getByTestId('ss-approve')).toBeDisabled();
  await expect(page.getByTestId('ss-decide-reason')).toContainText('You submitted this. Holding the checker permission is not enough: the maker and the checker must be different people.');
  await shot(page, 'GV09-no-self-approval');
  await actAs(page, 'p-checker');
  await expect(page.getByTestId('ss-inspect-wording').locator('li')).toHaveCount(2); // the new module's question and the changed closing wording
  await page.getByTestId('ss-wording-read').check();
  await page.getByTestId('ss-decide-comment').fill('Wording read and agreed.');
  await page.getByTestId('ss-approve').click();
  await expect(standing(page)).toHaveAttribute('data-stage', 'APPROVED');
  await expect(standing(page)).toContainText('Candidate C-3 (revision 3) is approved and waiting for a publisher');
  await expect(page.getByTestId('ss-publish-panel')).toContainText('approved by Arjun Menon (checker)');
  const manifest = (await page.getByTestId('ss-manifest').textContent())!;

  // -------------------------------- CLOSURE 2: publishing is a separate permission, with an identity check
  // the checker who approved it cannot publish: being a checker does not grant the right
  await expect(page.getByTestId('ss-publish')).toBeDisabled();
  await expect(page.getByTestId('ss-publish-reason')).toContainText('Publishing needs the Publisher permission. Arjun Menon does not hold it: being a checker does not grant the right to publish.');
  await shot(page, 'CL01-checker-cannot-publish');
  await actAs(page, 'p-author');
  await expect(page.getByTestId('ss-publish')).toBeDisabled();
  await expect(page.getByTestId('ss-publish-reason')).toContainText('Mei Ling Tan does not hold it: being an author does not grant the right to publish.');
  // Farah holds the Publisher permission — but she submitted this candidate
  await actAs(page, 'p-lead');
  await expect(page.getByTestId('ss-publish')).toBeDisabled();
  await expect(page.getByTestId('ss-publish-reason')).toContainText('You submitted this candidate. Holding the Publisher permission is not enough: the person who submits a candidate may not publish it.');
  await shot(page, 'CL02-submitter-cannot-publish');
  await actAs(page, 'p-publisher');
  await expect(page.getByTestId('ss-publish')).toBeEnabled();

  // ------------- CLOSURE 1 + 3: the candidate is immutable; the author goes on editing a SEPARATE draft.
  // The edit: an ORDINARY (non-mandatory) route to Escalate — which is terminal for the survey all the same.
  await actAs(page, 'p-author');
  await step(page, 'compose');
  await page.getByTestId('ss-open-mi-general-verification').click();
  await page.getByTestId('ss-derive').click();
  await page.getByTestId('ss-dest-n1-NO').click();
  await pick(page, 'End module: Escalate');
  await step(page, 'compose');
  // the new Escalate outcome is governed at once: it ends the call, and nothing else is offered
  const esc = page.getByTestId('ss-route-mi-general-verification-ESCALATE');
  await expect(esc).toContainText('ends the call: Escalate');
  await esc.click();
  await expect(opts).toHaveCount(1);
  await expect(opts).toContainText('End the call: Escalate');
  await expect(opts).toContainText('An escalation always ends the call — it cannot be continued or re-routed');
  await shot(page, 'CL03-ordinary-escalation-is-terminal');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ss-issues')).toContainText('Routing complete');
  // …and the simulator ends the call there: an ordinary ending with Escalate, not a "mandatory escalation"
  await step(page, 'review');
  // candidate C-3 is STILL approved, exactly as submitted; the draft is reported as a separate thing that has moved on
  await expect(standing(page)).toHaveAttribute('data-stage', 'APPROVED');
  await expect(standing(page)).toContainText('Candidate C-3 (revision 3) is approved and waiting for a publisher. The draft has later changes that are not part of it');
  await expect(page.getByTestId('ss-candidate')).toHaveAttribute('data-candidate', 'C-3');
  await expect(page.getByTestId('ss-manifest')).toHaveText(manifest); // the manifest it was approved with — not the draft's
  const ahead = page.getByTestId('ss-draft-ahead');
  await expect(ahead).toContainText('The draft has moved on from candidate C-3');
  await expect(ahead).toContainText('The approval cannot be moved onto the draft, whatever the draft is changed to.');
  await expect(page.getByTestId('ss-void-diff')).toContainText('General verification now pins a different module version');
  await shot(page, 'CL04-candidate-frozen-draft-moves-on', true);

  // the author submits the changed draft: a NEW candidate, C-4. C-3 is superseded; its approval is not carried over
  await page.getByTestId('ss-submit-note').fill('Escalates when the customer cannot confirm their identity.');
  await page.getByTestId('ss-submit').click();
  await expect(standing(page)).toHaveAttribute('data-stage', 'IN_REVIEW');
  await expect(standing(page)).toContainText('Candidate C-4 (revision 4) is waiting for a checker');
  await expect(page.getByTestId('ss-publish')).toHaveCount(0);

  // CLOSURE 1: UNDO does not resurrect the approval. The draft becomes, once more, exactly the content of C-3 …
  await step(page, 'compose');
  await page.getByTestId('ss-undo').click();
  await page.getByTestId('ss-undo').click();
  await expect(page.getByTestId('ss-route-mi-general-verification-ESCALATE')).toHaveCount(0);
  await step(page, 'review');
  // … and nothing is approved: C-3 stays superseded, C-4 stays in review, and there is nothing to publish
  await expect(standing(page)).toHaveAttribute('data-stage', 'IN_REVIEW');
  await expect(standing(page)).toContainText('Candidate C-4 (revision 4) is waiting for a checker. The draft has later changes that are not part of it');
  await actAs(page, 'p-publisher');
  await expect(page.getByTestId('ss-publish')).toHaveCount(0);
  await page.getByTestId('ss-tab-compare').click();
  await page.getByTestId('ss-compare-from').selectOption('C-3');
  await expect(page.getByTestId('ss-compare-from').locator('option:checked')).toHaveText('Candidate C-3 (revision 3) — superseded');
  await expect(page.getByTestId('ss-needs')).toContainText('These two revisions are identical'); // same content as C-3 — and still not approved
  await page.getByTestId('ss-tab-history').click();
  await expect(page.getByTestId('ss-audit')).toContainText('Superseded a candidate');
  await expect(page.getByTestId('ss-audit')).toContainText('Candidate C-3 (approved, not published) is closed by the submission of C-4. Its approval is not carried over');
  await shot(page, 'CL05-undo-does-not-resurrect-approval', true);

  // the only way forward is a new candidate with its own review: withdraw C-4, submit C-5, approve, publish
  await page.getByTestId('ss-tab-review').click();
  await actAs(page, 'p-author');
  await page.getByTestId('ss-withdraw').click();
  await expect(standing(page)).toHaveAttribute('data-stage', 'DRAFT');
  await page.getByTestId('ss-submit-note').fill('Names the policy in the closing acknowledgement. The escalation change is dropped.');
  await page.getByTestId('ss-submit').click();
  await expect(standing(page)).toContainText('Candidate C-5 (revision 5) is waiting for a checker');
  await actAs(page, 'p-checker');
  await page.getByTestId('ss-wording-read').check();
  await page.getByTestId('ss-approve').click();
  await expect(standing(page)).toContainText('Candidate C-5 (revision 5) is approved and waiting for a publisher');
  await shot(page, 'GV10-approved');

  // ------------------------------------------- publish the approved CANDIDATE as an immutable version (simulated)
  await actAs(page, 'p-publisher');
  await expect(page.getByTestId('ss-acting')).toContainText('Devi Krishnan');
  await page.getByTestId('ss-publish').click();
  await expect(standing(page)).toHaveAttribute('data-stage', 'PUBLISHED');
  await expect(page.getByTestId('ss-published-panel')).toContainText('Version 2.0 is published (simulated)');
  await expect(page.getByTestId('ss-published-panel')).toContainText('It is candidate C-5, revision 5');
  await expect(page.getByTestId('ss-journey')).toContainText('Published');
  await page.getByTestId('ss-tab-history').click();
  const v2 = page.getByTestId('ss-pub-2');
  await expect(v2).toContainText('Immutable');
  await expect(v2).toContainText('Simulated');
  await expect(page.getByTestId('ss-pub-binding-2')).toContainText('Candidate C-5 · revision 5 · dependency manifest');
  await expect(v2).toContainText('submitted by Mei Ling Tan (author)');
  await expect(v2).toContainText('approved by Arjun Menon (checker)');
  await expect(v2).toContainText('by Devi Krishnan (publisher)');
  await expect(page.getByTestId('ss-pub-1')).toContainText('Seeded with the demonstration');
  await page.getByTestId('ss-pub-wording-2').locator('summary').click();
  await expect(page.getByTestId('ss-pub-wording-2')).toContainText('Thank you. Do you acknowledge that this call about your policy has been completed?');
  const audit = page.getByTestId('ss-audit');
  for (const what of ['Submitted for review', 'Rejected (simulated)', 'Approved (simulated)', 'Superseded a candidate', 'Withdrew the candidate', 'Published (simulated)', 'Acknowledged a warning']) await expect(audit).toContainText(what);
  await shot(page, 'GV12-publication-history-and-audit', true);
  await scan(page, 'history and audit');
  // the published version does not move when the draft is edited afterwards
  const stamp = await v2.locator('.ss-code').first().textContent();
  await actAs(page, 'p-author');
  await step(page, 'compose');
  await page.getByTestId('ss-route-mi-general-verification-UNABLE_TO_VERIFY').click();
  await pick(page, 'End the call: Escalate');
  await step(page, 'review');
  await expect(standing(page)).toContainText('Draft with changes since version 2.0');
  await expect(page.getByTestId('ss-rev-fingerprint')).not.toHaveText(stamp!);
  await page.getByTestId('ss-tab-history').click();
  await expect(page.getByTestId('ss-pub-2').locator('.ss-code').first()).toHaveText(stamp!);
  await page.getByTestId('ss-tab-compare').click();
  await expect(page.getByTestId('ss-compare-from')).toHaveValue('v2');
  await expect(page.getByTestId('ss-changes-ROUTING').locator('li')).toHaveCount(1);

  // the remaining steps of the journey, for the walkthrough record
  await step(page, 'build');
  await page.getByRole('radio', { name: 'Graph' }).click();
  await expect(page.getByTestId('ss-graph-page')).toBeVisible();
  await shot(page, 'W04-advanced-graph');
});

// -------------------------------------------------------------------------------------------------------------------------
// CLOSURE 5: a menu opened in the Graph near the bottom of the window stays on screen (collision-aware placement).
const inView = async (page: Page) => page.locator('.ss-pop-panel').evaluate((el) => {
  const r = el.getBoundingClientRect();
  const last = [...el.querySelectorAll('[role="option"]')].pop()!.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, height: window.innerHeight, scrolls: el.scrollHeight > el.clientHeight + 1, lastBottom: last.bottom, placed: el.getAttribute('data-placed') };
});
test('SS-02 closure: Graph menus near the bottom of the window stay fully on screen', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  await page.getByTestId('ss-prototype-tag').click();
  await page.getByTestId('ss-add-demo').click();
  await step(page, 'compose');

  // 1. the survey graph's side panel, on a short window: the lowest route picker has no room below it
  await page.setViewportSize({ width: 1440, height: 620 });
  await page.getByRole('radio', { name: 'Graph', exact: true }).click();
  await page.getByTestId('ss-g-node-mi-affordability-check').click();
  const panel = page.getByTestId('ss-g-panel');
  const low = panel.getByTestId('ss-route-mi-affordability-check-UNABLE_TO_VERIFY');
  await low.scrollIntoViewIfNeeded();
  await low.click();
  let box = await inView(page);
  expect(box.top, 'top edge on screen').toBeGreaterThanOrEqual(0);
  expect(box.bottom, 'bottom edge on screen').toBeLessThanOrEqual(box.height);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/CL06-graph-menu-near-bottom-survey.png` });
  // every choice can be reached and chosen, including the last one
  await page.locator('.ss-pop-panel [role="option"]').last().scrollIntoViewIfNeeded();
  await page.locator('.ss-pop-panel [role="option"]').last().click();
  await expect(low).toContainText('ends the call: Unable to verify');

  // 2. the module graph: the route toolbar's "change" menu holds a long list on a very short window
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('radio', { name: 'Blocks', exact: true }).click();
  await page.getByTestId('ss-open-mi-clarifications').click();
  await page.getByTestId('ss-derive').click();
  await page.getByRole('radio', { name: 'Graph', exact: true }).click();
  await page.getByTestId('ss-g-fit').click();
  await page.waitForTimeout(600);
  // click ON a route's line at a point where it is visible (a line can pass behind a card)
  pick: for (const line of await page.locator('.react-flow__edge').all()) {
    for (const f of [0.5, 0.3, 0.7, 0.18, 0.85]) {
      const at = await line.locator('path.react-flow__edge-path').evaluate((el, k) => {
        const path = el as SVGPathElement; const pt = path.getPointAtLength(path.getTotalLength() * k); const m = path.getScreenCTM()!;
        return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
      }, f);
      await page.mouse.click(at.x, at.y);
      if (await page.getByTestId('ss-g-edge-change').count()) break pick;
    }
  }
  await expect(page.getByTestId('ss-g-edgebar')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 520 });
  await page.waitForTimeout(400);
  await page.getByTestId('ss-g-edge-change').scrollIntoViewIfNeeded();
  await page.getByTestId('ss-g-edge-change').click();
  box = await inView(page);
  expect(box.top, 'top edge on screen').toBeGreaterThanOrEqual(0);
  expect(box.bottom, 'bottom edge on screen').toBeLessThanOrEqual(box.height);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/CL07-graph-menu-near-bottom-module.png` });
  // the list is longer than the room: it scrolls INSIDE the menu, and its last choice is reachable without the page moving
  await page.locator('.ss-pop-panel [role="option"]').last().scrollIntoViewIfNeeded();
  const after = await inView(page);
  expect(after.lastBottom).toBeLessThanOrEqual(after.height);
  expect(after.bottom).toBeLessThanOrEqual(after.height);
  await page.keyboard.press('Escape');
});
