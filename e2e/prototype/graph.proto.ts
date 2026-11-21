import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { accounts, signIn } from '../helpers';

// SS-02B.2 — Advanced Graph Builder and Guided / Graph parity, demonstrated in Chromium with the prototype setting ON.
//  1 Guided → Graph                      7 mandatory escalation with no bypass
//  2 add a question in Graph             8 change a route in Graph, undo it from Guided
//  3 change a destination in Guided      9 a 40-question module that stays navigable
//  4 merge two branches                 10 the survey-level module graph, and editing a module route
//  5 an internal condition, three routes 11 search and jump to a question
//  6 sequential follow-ups and rejoin   12 a keyboard-only routing operation
// Parity is asserted with the model FINGERPRINT (one value for the whole canonical model), not with pictures.
const SHOTS = 'test-results/prototype/shots';
const shot = async (page: Page, name: string) => { await page.waitForTimeout(900); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const pick = async (page: Page, text: string | RegExp) => page.getByRole('option', { name: text }).first().click();
const fp = async (page: Page) => (await page.getByTestId('ss-model-fingerprint').textContent()) ?? '';
const issues = (page: Page) => page.getByTestId('ss-issues');
const view = (page: Page, name: 'Guided' | 'Graph' | 'Blocks') => page.getByRole('radio', { name, exact: true }).click();
const gnode = (page: Page, id: string) => page.getByTestId(`ss-g-node-${id}`);
const slot = (page: Page, node: string, via: string) => page.getByTestId(`ss-g-slot-${node}-${via}`);
const parity: string[] = [];
const record = (what: string, guided: string, graph: string) => { parity.push(`${guided === graph ? 'SAME' : 'DIFFERENT'}  guided=${guided}  graph=${graph}  ${what}`); expect(graph, what).toBe(guided); };

async function scan(page: Page, name: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).include('[data-testid="survey-studio"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(bad.map((v) => `${name}: ${v.id} (${v.nodes.slice(0, 6).map((x) => x.target.join(' ')).join(', ')})`)).toEqual([]);
}
async function atWidths(page: Page, name: string) {
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect.soft(overflow, `sideways page scroll on ${name} at ${width}px`).toBeLessThanOrEqual(0);
    await scan(page, `${name}@${width}`);
    await page.screenshot({ path: `${SHOTS}/W-${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
/** Drag a connection from one route's handle onto a card — the pointer gesture of the graph. */
async function connect(page: Page, node: string, via: string, target: string) {
  await page.waitForTimeout(700); // handles are measured after a re-layout
  const from = await slot(page, node, via).locator('.react-flow__handle').boundingBox();
  const to = await gnode(page, target).boundingBox();
  if (!from || !to) throw new Error(`cannot connect ${node}/${via} → ${target}: not on screen`);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
  await page.mouse.up();
}
/** Moves inside the app (a page load would reset the in-memory prototype). */
const openModule = async (page: Page, inst: string) => {
  await page.getByRole('navigation', { name: 'Survey Studio breadcrumb' }).getByRole('link', { name: 'Graph check' }).click();
  await page.getByTestId(`ss-open-${inst}`).click();
};

test.use({ actionTimeout: 12_000 });

test('SS-02B.2 graph builder: Guided/Graph parity, editing in the graph, large module, survey graph, keyboard', async ({ page }) => {
  test.setTimeout(420_000);
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  await page.getByTestId('ss-create').click();
  await page.getByTestId('ss-create-name').fill('Graph check');
  await page.getByTestId('ss-create-template').check();
  await page.getByTestId('ss-create-go').click();
  await page.getByTestId('ss-add-M-CONCERNS').click();
  await page.getByTestId('ss-add-M-CLARIFICATIONS').click();

  // ---------------------------------------------------------------- 1. open a module in Guided, then switch to Graph
  await page.getByTestId('ss-open-mi-suitability').click();
  await page.getByTestId('ss-derive').click();
  await expect(page.getByTestId('ss-lockbar')).toHaveCount(0);
  const guidedIds = (await page.locator('[data-node]').evaluateAll((els) => els.map((e) => e.getAttribute('data-node')))).sort();
  expect(guidedIds).toEqual(['n1', 'n2', 'n3']);
  const fp0 = await fp(page);
  await shot(page, 'GR1a-module-in-guided');
  await view(page, 'Graph');
  await expect(page.getByTestId('ss-graph')).toBeVisible();
  for (const id of guidedIds) await expect(gnode(page, id!)).toHaveCount(1); // every step once
  await expect(page.locator('.react-flow__node [data-testid^="ss-g-node-n"]')).toHaveCount(3);
  await expect(slot(page, 'n1', 'NO')).toContainText('Q1a');
  await expect(slot(page, 'n2', 'NO')).toContainText('Clarification required');
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  expect(await fp(page), 'switching views changes nothing in the model').toBe(fp0);
  await shot(page, 'GR1b-same-module-in-graph');
  await scan(page, 'graph-simple');

  // ------------------------------------------- PARITY A: re-point an answer — Guided picker vs graph drag-connection
  await view(page, 'Guided');
  await page.getByTestId('ss-dest-n2-NO').click();
  await pick(page, 'End module: Completed');
  const guidedA = await fp(page);
  await page.getByTestId('ss-undo').click();
  expect(await fp(page), 'undo restores the model exactly').toBe(fp0);
  await view(page, 'Graph');
  await connect(page, 'n2', 'NO', 'out:COMPLETED');
  await expect(slot(page, 'n2', 'NO')).toContainText('Completed');
  record('re-point "No" of Q2 to "Module ends · Completed"', guidedA, await fp(page));

  // ----------------------------------------------------- 8. …and undo that graph edit FROM THE GUIDED VIEW
  await view(page, 'Guided');
  await expect(page.getByTestId('ss-dest-n2-NO')).toContainText('End module: Completed'); // the graph edit is here
  await expect(page.getByTestId('ss-undo')).toHaveAttribute('title', /Routed Q2 in the graph/); // one history
  await page.getByTestId('ss-undo').click();
  await expect(page.getByTestId('ss-dest-n2-NO')).toContainText('End module: Clarification required');
  expect(await fp(page)).toBe(fp0);
  await view(page, 'Graph');
  await expect(slot(page, 'n2', 'NO')).toContainText('Clarification required'); // and the graph follows the undo
  await page.getByTestId('ss-redo').click(); // redo from the graph
  await expect(slot(page, 'n2', 'NO')).toContainText('Completed');
  await page.getByTestId('ss-undo').click();

  // -------------------------------- 2. add a question in Graph → it appears in Guided. PARITY B: same edit both ways
  await view(page, 'Guided');
  await page.getByTestId('ss-insert-n1-YES').click();
  await page.getByTestId('ss-new-YES_NO').click();
  const guidedB = await fp(page);
  await page.getByTestId('ss-undo').click();
  await view(page, 'Graph');
  await page.getByTestId('ss-g-insert-n1|YES').click();
  await expect(page.getByTestId('ss-g-panel')).toContainText('Add on this route');
  await page.getByTestId('ss-new-YES_NO').click();
  record('insert a Yes/No question on Q1 · Yes', guidedB, await fp(page));
  await expect(gnode(page, 'n4')).toHaveCount(1);
  const panel = page.getByTestId('ss-g-panel');
  await expect(panel.getByTestId('ss-q-n4')).toBeVisible(); // the new step is selected and its card is in the panel
  await panel.locator('.ss-q-text textarea').fill('Did you receive the product summary?');
  await panel.locator('.ss-q-text textarea').blur();
  await expect(gnode(page, 'n4')).toContainText('Did you receive the product summary?');
  await expect(slot(page, 'n4', 'ANY')).toContainText('Q3'); // safe insertion: it inherited the route to the risks question
  await shot(page, 'GR2-question-added-in-graph');
  await view(page, 'Guided');
  await expect(page.getByTestId('ss-q-n4')).toBeInViewport(); // selection kept across the switch
  await expect(page.getByTestId('ss-q-n4').locator('.ss-q-text textarea')).toHaveValue('Did you receive the product summary?');
  await expect(page).toHaveURL(/node=n4/);

  // ------------------------------------------- 3. change an answer destination in Guided → the graph edge updates
  await page.getByTestId('ss-dest-n2-NO').click();
  await pick(page, 'End module: Escalate');
  await view(page, 'Graph');
  await expect(slot(page, 'n2', 'NO')).toContainText('Escalate');
  await expect(gnode(page, 'out:ESCALATE@n2')).toBeVisible();
  await expect(gnode(page, 'out:CLARIFICATION_REQUIRED@n2')).toHaveCount(0);
  await expect(issues(page)).toContainText('Routing complete');

  // ------------------------------------------------------------- 4. merge two answer branches into one question
  await openModule(page, 'mi-customer-concerns');
  await page.getByTestId('ss-derive').click();
  await view(page, 'Graph');
  await page.getByTestId('ss-g-fit').click();
  await shot(page, 'GR4a-single-choice-before-merge');
  await connect(page, 'n1', 'BENEFITS', 'n2');
  await expect(slot(page, 'n1', 'BENEFITS')).toContainText('Q1a');
  await expect(gnode(page, 'n2')).toHaveCount(1); // the question exists once; it is not duplicated per branch
  await expect(slot(page, 'n1', 'PREMIUM')).toContainText('Q1a'); // both answers now name the same destination
  await expect(issues(page)).toContainText('1 to fix'); // the question nothing leads to any more is reported, not hidden
  await shot(page, 'GR4b-two-branches-merged');
  await view(page, 'Guided');
  await expect(page.getByTestId('ss-merge-n2')).toContainText('2 routes lead here');
  await page.getByTestId('ss-delete-n3').click();
  await page.getByTestId('ss-delete-confirm').click();
  await expect(issues(page)).toContainText('Routing complete');

  // ---------------------------- 5. an internal condition with three routes. PARITY C: added in Guided vs in Graph
  const before = await fp(page);
  await page.getByTestId('ss-insert-n5-YES').click();
  await page.getByTestId('ss-new-DECISION').click();
  const guidedC = await fp(page);
  await page.getByTestId('ss-undo').click();
  expect(await fp(page)).toBe(before);
  await view(page, 'Graph');
  await page.getByTestId('ss-g-fit').click();
  await page.getByTestId('ss-g-insert-n5|YES').click();
  await page.getByTestId('ss-new-DECISION').click();
  record('insert a condition on Q2 · Yes (safe insertion: only "otherwise" inherits)', guidedC, await fp(page));
  await expect(slot(page, 'd1', 'NO_MATCH')).toContainText('Completed');
  await expect(slot(page, 'd1', 'MATCH')).toContainText('Choose destination'); // nothing invented by the graph
  await expect(slot(page, 'd1', 'UNKNOWN')).toContainText('Choose destination');
  await expect(issues(page)).toContainText('3 to fix');
  await panel.getByTestId('ss-d-edit-d1').click();
  await page.getByTestId('ss-cond-value-0-0').fill('12000');
  await page.getByTestId('ss-rule-apply').click();
  await panel.getByTestId('ss-dest-d1-MATCH').click();
  await pick(page, 'End module: Clarification required');
  await panel.getByTestId('ss-dest-d1-UNKNOWN').click();
  await pick(page, 'Stop and flag for review');
  await expect(gnode(page, 'd1')).toContainText('Annual premium is at least 12,000 SGD');
  await expect(slot(page, 'd1', 'MATCH')).toContainText('Clarification required');
  await expect(slot(page, 'd1', 'UNKNOWN')).toContainText('Review');
  await expect(gnode(page, 'out:REVIEW_REQUIRED@d1')).toContainText('Stop · review required');
  await expect(issues(page)).toContainText('Routing complete');
  await page.getByTestId('ss-g-panel-close').click();
  await page.getByTestId('ss-g-fit').click();
  await shot(page, 'GR5-condition-with-three-routes');
  await view(page, 'Guided');
  await expect(page.getByTestId('ss-d-sentence-d1')).toHaveText('Annual premium is at least 12,000 SGD');
  await expect(page.getByTestId('ss-dest-d1-UNKNOWN')).toContainText('Stop and flag for review');

  // -------------------------------------- 6. sequential follow-ups with an explicit rejoin; 7. mandatory escalation
  await openModule(page, 'mi-clarifications');
  await view(page, 'Graph');
  await page.getByTestId('ss-g-fit').click();
  await expect(page.getByTestId('ss-g-edge-n1|QUEUE|0')).toContainText('1 · if “Premium”');
  await expect(page.getByTestId('ss-g-edge-n1|QUEUE|1')).toContainText('2 · if “Benefits” or “Claims”'); // one question for two answers, asked once
  await expect(page.getByTestId('ss-g-edge-n1|QUEUE|END')).toContainText('then rejoins');
  await expect(slot(page, 'n1', 'REJOIN')).toContainText('Q2');
  await expect(slot(page, 'n1', 'INT:CRITICAL_RISK')).toContainText('Escalate'); // the mandatory escalation
  await expect(gnode(page, 'out:ESCALATE@n1')).toBeVisible();
  await shot(page, 'GR6-follow-up-queue-and-rejoin');
  await scan(page, 'graph-follow-ups');
  await page.getByTestId('ss-g-collapse').click(); // collapsible group: the queue folds to one stub that still shows the rejoin
  await expect(gnode(page, 'stub:n1:followups')).toContainText('2 follow-up questions, asked in order');
  await expect(gnode(page, 'n2')).toHaveCount(0);
  await shot(page, 'GR6b-follow-up-queue-collapsed');
  await gnode(page, 'stub:n1:followups').click(); // selecting the stub opens it again
  await expect(gnode(page, 'n2')).toBeVisible();

  // --------------------------------------------- 9. a 40-question module with exceptions that remains navigable
  await page.getByTestId('ss-prototype-tag').click();
  await page.getByTestId('ss-add-large').click();
  await expect(page.getByTestId('ss-outline')).toContainText('42'); // 40 questions and 2 conditions
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'GR9a-forty-questions-guided');
  await view(page, 'Graph');
  await expect(gnode(page, 'stub:n3:NO')).toBeVisible(); // opens on the main journey; each branch is one stub
  await expect(page.locator('.react-flow__node [data-testid^="ss-g-node-stub:"]')).toHaveCount(8);
  await expect(gnode(page, 'n25')).toHaveCount(0);
  await shot(page, 'GR9b-forty-questions-main-journey');
  await page.getByTestId('ss-g-fit').click();
  await shot(page, 'GR9c-forty-questions-main-journey-overview');
  await page.getByTestId('ss-g-expand').click();
  await expect(page.locator('.react-flow__node .ss-g-node')).toHaveCount(42);
  await page.getByTestId('ss-g-fit').click();
  await shot(page, 'GR9d-forty-questions-all-branches-overview');

  // ------------------------------------------------------------------ 11. search and jump to a particular question
  await page.getByTestId('ss-outline').click();
  await page.getByRole('combobox', { name: 'Search by number or wording' }).fill('existing policies');
  await page.keyboard.press('Enter');
  await expect(gnode(page, 'n17')).toBeInViewport();
  await expect(gnode(page, 'n17')).toHaveClass(/selected/);
  await expect(panel).toContainText('Q17 · routes and details');
  await shot(page, 'GR11-search-and-jump');

  // ------------------------------------- 7. a mandatory escalation cannot be bypassed by a graph connection either
  await expect(slot(page, 'n17', 'PRESSURED')).toContainText('Escalate');
  const guarded = await fp(page);
  await expect(gnode(page, 'n16')).toBeInViewport();
  await connect(page, 'n17', 'PRESSURED', 'n16'); // try to send the mandatory escalation to an ordinary question
  await expect(page.getByTestId('ss-g-message')).toContainText('mandatory escalation');
  expect(await fp(page), 'a refused connection changes nothing').toBe(guarded);
  await expect(slot(page, 'n17', 'PRESSURED')).toContainText('Escalate');
  await panel.getByTestId('ss-dest-n17-PRESSURED').click();
  await expect(page.getByRole('option')).toHaveCount(2); // the picker offers the approved escalation outcome (and "leave undecided") — nothing else
  await expect(page.getByRole('option', { name: 'End module: Escalate' })).toBeVisible();
  await page.keyboard.press('Escape');
  await shot(page, 'GR7-mandatory-escalation-no-bypass');
  await atWidths(page, 'graph-large-with-panel');

  // ------------------------------------------------------------------ 12. a routing operation with the keyboard only
  await page.getByTestId('ss-g-panel-close').click();
  const kb = page.keyboard;
  const tabTo = async (l: Locator, name: string, max = 160) => {
    for (let i = 0; i < max; i++) { if (await l.evaluate((el) => el === document.activeElement).catch(() => false)) return; await kb.press('Tab'); }
    throw new Error(`Keyboard: could not reach ${name} with Tab`);
  };
  await page.getByTestId('ss-prototype-tag').focus(); // a known starting point before the canvas
  await tabTo(page.getByTestId('ss-outline'), 'the outline');
  await kb.press('Enter');
  await kb.type('charges and fees match');
  await kb.press('Enter'); // selects Q15; focus moves to its panel
  await expect(panel).toContainText('Q15 · routes and details');
  await tabTo(panel.getByTestId('ss-dest-n15-NO'), 'the destination of "No"');
  await kb.press('Enter');
  await kb.type('Escalate');
  await kb.press('Enter');
  await expect(slot(page, 'n15', 'NO')).toContainText('Escalate');
  await expect(gnode(page, 'out:ESCALATE@n15')).toBeVisible();
  await expect(page.getByTestId('ss-undo')).toHaveAttribute('title', /Routed "No"/);
  // a card can also be reached and selected in the canvas itself with Tab and Enter
  await page.getByTestId('ss-g-panel-close').click();
  await page.locator('.react-flow__node[data-id="n16"]').focus();
  await kb.press('Enter');
  await expect(panel).toContainText('Q16 · routes and details');
  await shot(page, 'GR12-keyboard-only-routing');
  await view(page, 'Guided');
  await expect(page.getByTestId('ss-q-n16')).toBeInViewport();

  // --------------------------------------------- 10. the survey-level module graph, sharing state with the Composer
  await page.getByRole('navigation', { name: 'Survey Studio breadcrumb' }).getByRole('link', { name: 'Survey Studio' }).click();
  await page.getByRole('link', { name: /Graph check/ }).click();
  await expect(page.getByTestId('ss-route-mi-suitability-ESCALATE')).toContainText('ends the call: Escalate'); // the outcome added in the module graph; an escalation is terminal, so its route is governed (SS-02 closure)
  await view(page, 'Graph');
  await expect(page.getByTestId('ss-survey-graph')).toBeVisible();
  for (const id of ['mi-general-verification', 'mi-suitability', 'mi-closing', 'mi-customer-concerns', 'mi-clarifications']) await expect(gnode(page, id)).toHaveCount(1);
  await expect(page.locator('.react-flow__node .ss-g-node.instance')).toHaveCount(5); // module instances only: questions are not expanded here
  await expect(gnode(page, 'mi-suitability')).toContainText('Runs when Product family is ILP');
  await expect(slot(page, 'mi-customer-concerns', 'REVIEW_REQUIRED')).toContainText('halts'); // governed: fixed, not routable
  await page.getByTestId('ss-g-fit').click();
  await shot(page, 'GR10a-survey-module-graph');
  // edit a module route by connecting: a jump to a later module
  const sBefore = await fp(page);
  // SS-02 closure: an escalation is terminal — the survey graph refuses to route it onward, and the model is untouched
  await connect(page, 'mi-suitability', 'ESCALATE', 'mi-clarifications');
  await expect(page.getByTestId('ss-g-message')).toContainText('is an escalation: it can only end the call with “Escalate”');
  expect(await fp(page)).toBe(sBefore);
  await connect(page, 'mi-general-verification', 'UNABLE_TO_VERIFY', 'mi-clarifications');
  await expect(slot(page, 'mi-general-verification', 'UNABLE_TO_VERIFY')).toContainText('Clarifications');
  const viaGraph = await fp(page);
  // a route may not go backwards, and the governed outcome cannot be re-pointed: refused, model untouched
  await page.getByTestId('ss-g-fit').click();
  await connect(page, 'mi-customer-concerns', 'COMPLETED', 'mi-general-verification');
  await expect(page.getByTestId('ss-g-message')).toContainText('A route may only go to a later module');
  await connect(page, 'mi-customer-concerns', 'REVIEW_REQUIRED', 'mi-clarifications');
  expect(await fp(page)).toBe(viaGraph);
  // the same edit made in the Composer gives the same model (PARITY D)
  await page.getByTestId('ss-undo').click();
  expect(await fp(page)).toBe(sBefore);
  await view(page, 'Blocks');
  await page.getByTestId('ss-route-mi-general-verification-UNABLE_TO_VERIFY').click();
  await pick(page, 'Jump to Clarifications');
  record('survey: route "Unable to verify" of General verification to the Clarifications module', await fp(page), viaGraph);
  await view(page, 'Graph');
  // reorder from the graph panel, see it in the Composer, undo it there
  await gnode(page, 'mi-closing').click();
  await expect(panel).toContainText('Closing · position 3 of 5');
  await panel.getByTestId('ss-g-down-mi-closing').click();
  await panel.getByTestId('ss-g-down-mi-closing').click();
  await expect(panel).toContainText('Closing · position 5 of 5');
  await panel.getByTestId('ss-route-mi-closing-COMPLETED').click(); // the Composer's own route control, in the panel
  await page.keyboard.press('Escape');
  await page.getByTestId('ss-g-fit').click();
  await shot(page, 'GR10b-survey-graph-route-and-reorder');
  await scan(page, 'survey-graph');
  await view(page, 'Blocks');
  await expect(page.locator('.ss-story .ss-card').last()).toHaveAttribute('data-testid', 'ss-card-mi-closing');
  await expect(page.getByTestId('ss-route-mi-general-verification-UNABLE_TO_VERIFY')).toContainText('jumps to Clarifications');
  await page.getByTestId('ss-undo').click();
  await page.getByTestId('ss-undo').click();
  await expect(page.locator('.ss-story .ss-card').nth(2)).toHaveAttribute('data-testid', 'ss-card-mi-closing');
  await view(page, 'Graph');
  await atWidths(page, 'survey-graph');

  writeFileSync('test-results/prototype/parity.txt', `SS-02B.2 Guided / Graph parity — model fingerprints (FNV-1a of the whole canonical model)\n${parity.join('\n')}\n`);
  expect(parity.every((l) => l.startsWith('SAME'))).toBe(true);
});

test('SS-02B.2 corrections: selection limits are never changed silently; condition references are stable and typed', async ({ page }) => {
  test.setTimeout(200_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  await page.getByTestId('ss-create').click();
  await page.getByTestId('ss-create-name').fill('Corrections');
  await page.getByTestId('ss-create-go').click();
  await page.getByTestId('ss-add-first').click();
  await page.getByTestId('ss-blank-module').click();
  await page.getByTestId('ss-new-module-name').fill('Limits check');
  await page.getByTestId('ss-new-module-kind').selectOption('PRODUCT');
  await page.getByTestId('ss-new-module-intent').fill('Corrections');
  await page.getByTestId('ss-new-module-go').click();
  await page.getByTestId('ss-new-MULTI_SELECT').click();
  const n1 = page.getByTestId('ss-q-n1');
  await n1.locator('.ss-q-text textarea').fill('Which of these apply to you?');
  await n1.locator('.ss-q-text textarea').blur();
  const add = page.getByTestId('ss-option-new-n1');
  for (const label of ['Alpha', 'Beta', 'Gamma', 'Delta']) { await add.fill(label); await add.press('Enter'); }

  // ---- correction 1: limits are the author's; another edit never changes them
  await expect(n1.getByTestId('ss-limits-n1')).toContainText('no limit set'); // adding answers set no limit
  const min = page.getByTestId('ss-limit-min-n1'), max = page.getByTestId('ss-limit-max-n1');
  await min.fill('2'); await min.blur();
  await max.fill('4'); await max.blur();
  await page.getByTestId('ss-more-n1-DELTA').click();
  await page.getByTestId('ss-menu-exclusive').check();
  await page.keyboard.press('Escape');
  const conflict = page.getByTestId('ss-limits-issue-n1');
  await expect(conflict).toContainText('at most 4 answers, but only 3 can be combined');
  await expect(conflict).toContainText('The limits were kept as you set them');
  await expect(max).toHaveValue('4'); // preserved, not fitted
  await expect(min).toHaveValue('2');
  await expect(page.getByTestId('ss-issues')).toContainText('1 to fix');
  await page.screenshot({ path: `${SHOTS}/GC1-selection-limit-conflict.png` });
  await page.getByTestId('ss-limit-fit-n1').click(); // the author chooses the replacement
  await expect(conflict).toHaveCount(0);
  await expect(max).toHaveValue('3');
  await page.getByTestId('ss-undo').click(); // undo restores the previous state: the conflict and the original limits
  await expect(conflict).toBeVisible();
  await expect(max).toHaveValue('4');
  await page.getByTestId('ss-undo').click(); // undo the exclusivity change: limits valid again, untouched throughout
  await expect(conflict).toHaveCount(0);
  await expect(max).toHaveValue('4');
  await page.getByTestId('ss-more-n1-DELTA').click();
  await page.getByTestId('ss-remove-option-n1-DELTA').click(); // deleting an answer: same rule
  await expect(conflict).toContainText('at most 4 answers, but only 3 can be combined');
  await expect(max).toHaveValue('4');
  await page.getByTestId('ss-limit-remove-n1').click();
  await expect(n1.getByTestId('ss-limits-n1')).toContainText('no limit set');
  await expect(page.getByTestId('ss-issues')).toContainText('Routing complete');

  // ---- correction 2: a condition depends on stable, typed references — not on wording
  await page.getByTestId('ss-insert-n1-ANY').click();
  await page.getByTestId('ss-new-DECISION').click();
  await page.getByTestId('ss-d-edit-d1').click();
  await page.getByTestId('ss-cond-field-0-0').selectOption('answer:n1');
  await expect(page.getByTestId('ss-cond-op-0-0')).toHaveValue('INCLUDES_ANY');
  await page.getByTestId('ss-cond-code-0-0-ALPHA').click();
  await page.getByTestId('ss-cond-code-0-0-BETA').click();
  await expect(page.getByTestId('ss-rule-sentence')).toHaveText('It matches when the answer to Q1 includes any of “Alpha”, “Beta”.');
  const verdict = page.getByTestId('ss-verdict-result');
  await expect(verdict).toHaveText('Unknown'); // not answered yet — never an empty selection
  await page.getByTestId('ss-sample-unanswered-n1').uncheck();
  await expect(verdict).toHaveText('Does not match'); // answered with nothing selected: a KNOWN empty selection
  await expect(page.getByTestId('ss-sample-answer-n1')).toContainText('a known empty selection');
  await page.getByTestId('ss-cond-op-0-0').selectOption('INCLUDES_NONE');
  await expect(verdict).toHaveText('Matches'); // "none of" is true for the empty selection …
  await page.getByTestId('ss-sample-unanswered-n1').check();
  await expect(verdict).toHaveText('Unknown'); // … and still Unknown when the question was not answered
  await page.getByTestId('ss-cond-op-0-0').selectOption('INCLUDES_ALL');
  await page.getByTestId('ss-sample-unanswered-n1').uncheck();
  await page.getByTestId('ss-sample-answer-n1-ALPHA').click();
  await expect(verdict).toHaveText('Does not match');
  await page.getByTestId('ss-sample-answer-n1-BETA').click();
  await expect(verdict).toHaveText('Matches');
  await page.screenshot({ path: `${SHOTS}/GC2-typed-answer-reference.png` });
  await page.getByTestId('ss-rule-apply').click();
  const sentence = page.getByTestId('ss-d-sentence-d1');
  await expect(sentence).toHaveText('the answer to Q1 includes all of “Alpha”, “Beta”');
  // rename an answer: the condition follows, because it holds the stable code, not the label
  const alpha = page.getByTestId('ss-option-n1-ALPHA').locator('.ss-option-label');
  await alpha.fill('First choice'); await alpha.blur();
  await expect(sentence).toHaveText('the answer to Q1 includes all of “First choice”, “Beta”');
  await expect(page.getByTestId('ss-d-issue-d1')).toHaveCount(0);
  // remove the answer: the reference no longer resolves, and that is an error — it never looks valid
  await page.getByTestId('ss-more-n1-ALPHA').click();
  await page.getByTestId('ss-remove-option-n1-ALPHA').click();
  await expect(page.getByTestId('ss-d-issue-d1')).toContainText('an answer that no longer exists (ALPHA)');
  await page.screenshot({ path: `${SHOTS}/GC3-stale-answer-reference-flagged.png` });
  await page.getByTestId('ss-undo').click();
  await expect(page.getByTestId('ss-d-issue-d1')).toHaveCount(0);

  // ---- P-3: "Stop and flag for review" is the governed REVIEW_REQUIRED outcome; a survey cannot route past it
  await page.getByTestId('ss-dest-d1-MATCH').click();
  await pick(page, 'End module: Clarification required');
  await page.getByTestId('ss-dest-d1-UNKNOWN').click();
  await pick(page, 'Stop and flag for review');
  await page.getByRole('link', { name: 'Corrections' }).click();
  const halted = page.getByTestId('ss-route-mi-limits-check-REVIEW_REQUIRED');
  await expect(halted).toContainText('the call halts · waits for an authorised review · not completed');
  await expect(halted).not.toHaveAttribute('aria-haspopup', 'dialog'); // not a picker: it cannot be routed elsewhere
  await page.screenshot({ path: `${SHOTS}/GC4-review-required-is-governed.png` });
});
