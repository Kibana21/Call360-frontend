import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { accounts, signIn } from '../helpers';

// SS-02B.2.1 — Connection editing in the Graph view, demonstrated in Chromium with the prototype setting ON.
//  1 delete a Yes connection and reconnect it        7 change a survey-level module outcome connection
//  2 delete a No connection and leave it unresolved  8 an invalid mandatory-escalation connection is refused
//  3 the validation error in Guided and in Graph     9 undo and redo a deletion and a reconnection
//  4 reconnect the No route and resolve the issue   10 the same edit in Guided and in Graph: equal fingerprints
//  5 re-point a single-choice option                11 edge editing with the keyboard only
//  6 disconnect / reconnect a decision MATCH route
const SHOTS = 'test-results/prototype/shots';
const shot = async (page: Page, name: string) => { await page.waitForTimeout(700); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const pick = async (page: Page, text: string | RegExp) => page.getByRole('option', { name: text }).first().click();
const fp = async (page: Page) => (await page.getByTestId('ss-model-fingerprint').textContent()) ?? '';
const issues = (page: Page) => page.getByTestId('ss-issues');
const view = (page: Page, name: 'Guided' | 'Graph' | 'Blocks') => page.getByRole('radio', { name, exact: true }).click();
const gnode = (page: Page, id: string) => page.getByTestId(`ss-g-node-${id}`);
const slot = (page: Page, node: string, via: string) => page.getByTestId(`ss-g-slot-${node}-${via}`);
const edge = (page: Page, id: string) => page.getByTestId(`rf__edge-${id}`);
const bar = (page: Page) => page.getByTestId('ss-g-edgebar');
const notice = (page: Page) => page.locator('.ss-notice');
const parity: string[] = [];
const record = (what: string, guided: string, graph: string) => { parity.push(`${guided === graph ? 'SAME' : 'DIFFERENT'}  guided=${guided}  graph=${graph}  ${what}`); expect(graph, what).toBe(guided); };

async function scan(page: Page, name: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => undefined))));
  const result = await new AxeBuilder({ page }).include('[data-testid="survey-studio"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(bad.map((v) => `${name}: ${v.id} (${v.nodes.slice(0, 6).map((x) => x.target.join(' ')).join(', ')})`)).toEqual([]);
}
/** Click ON a route's line, as an author would, at a point where the line is actually visible (a long line can pass behind a card). */
async function clickEdge(page: Page, id: string) {
  await page.waitForTimeout(600);
  for (const at of [0.5, 0.3, 0.7, 0.18, 0.85, 0.08]) {
    const p = await edge(page, id).locator('path.react-flow__edge-path').evaluate((el, f) => {
      const path = el as SVGPathElement;
      const pt = path.getPointAtLength(path.getTotalLength() * f);
      const m = path.getScreenCTM()!;
      return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
    }, at);
    await page.mouse.click(p.x, p.y);
    if (await edge(page, id).evaluate((el) => el.classList.contains('selected'))) break;
  }
  await expect(edge(page, id)).toHaveClass(/selected/);
  await expect(bar(page)).toBeVisible();
  // aiming at a line can first land on a card, whose side panel takes focus a moment later; the route's actions are what we act on
  await page.waitForTimeout(150);
  await bar(page).getByRole('button').first().focus();
}
/** Drag a connection from one route's own handle onto a card. */
async function connect(page: Page, node: string, via: string, target: string) {
  await page.waitForTimeout(600);
  const from = await slot(page, node, via).locator('.react-flow__handle').boundingBox();
  const to = await gnode(page, target).boundingBox();
  if (!from || !to) throw new Error(`cannot connect ${node}/${via} → ${target}: not on screen`);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
  await page.mouse.up();
}
const toSurvey = async (page: Page) => page.getByRole('navigation', { name: 'Survey Studio breadcrumb' }).getByRole('link', { name: 'Edge check' }).click();

test.use({ actionTimeout: 12_000 });

test('SS-02B.2.1 connection editing: select, disconnect, redraw, refuse, undo, parity, keyboard', async ({ page }) => {
  test.setTimeout(420_000);
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, accounts().user, '/survey-studio');
  await page.getByTestId('ss-create').click();
  await page.getByTestId('ss-create-name').fill('Edge check');
  await page.getByTestId('ss-create-template').check();
  await page.getByTestId('ss-create-go').click();
  await page.getByTestId('ss-add-M-CONCERNS').click();
  await page.getByTestId('ss-add-M-AFFORDABILITY').click();
  await page.getByTestId('ss-open-mi-suitability').click();
  await page.getByTestId('ss-derive').click();
  await expect(issues(page)).toContainText('Routing complete');
  const fp0 = await fp(page);

  // -------------------- 10. the same edit made in Guided first (to compare with the graph): disconnect, then re-point
  await page.getByTestId('ss-dest-n1-YES').click();
  await pick(page, 'Leave undecided for now');
  const guidedOff = await fp(page);
  await page.getByTestId('ss-dest-n1-YES').click();
  await pick(page, /What would you like us to clarify/);
  const guidedOn = await fp(page);
  await page.getByTestId('ss-undo').click();
  await page.getByTestId('ss-undo').click();
  expect(await fp(page)).toBe(fp0);

  // ------------------------------------------------ 1. delete a Yes connection and reconnect it to another question
  await view(page, 'Graph');
  await page.getByTestId('ss-g-fit').click();
  await clickEdge(page, 'n1|YES');
  await expect(edge(page, 'n1|YES')).toHaveClass(/selected/); // selected and highlighted
  await expect(page.getByTestId('ss-g-edge-name')).toHaveText('Q1 · Yes → Q2');
  await expect(page.getByTestId('ss-g-edge-change')).toBeVisible();
  await expect(page.getByTestId('ss-g-edge-disconnect')).toBeVisible();
  await shot(page, 'CE1-route-selected-with-toolbar');
  await scan(page, 'route-toolbar');
  await page.getByTestId('ss-g-edge-disconnect').click(); // no confirmation: it is an ordinary, undoable draft edit
  await expect(notice(page)).toContainText('Disconnected Q1 · Yes — it needs a destination');
  await expect(edge(page, 'n1|YES')).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  for (const id of ['n1', 'n2', 'n3']) await expect(gnode(page, id)).toHaveCount(1); // no question deleted
  await expect(slot(page, 'n1', 'YES')).toContainText('Choose destination'); // the answer is still there, with no destination
  await expect(page.getByTestId('ss-g-broken-n1-YES')).toBeVisible(); // a broken, dashed route indicator
  await expect(issues(page)).toContainText('1 to fix');
  const graphOff = await fp(page);
  record('disconnect Q1 · Yes (Guided "Leave undecided" vs graph "Disconnect route")', guidedOff, graphOff);
  await shot(page, 'CE2-route-disconnected-choose-destination');
  await connect(page, 'n1', 'YES', 'n3'); // redraw from the answer's own handle to another question
  await expect(notice(page)).toContainText('Routed Q1 in the graph');
  await expect(edge(page, 'n1|YES')).toHaveCount(1);
  await expect(page.getByTestId('ss-g-broken-n1-YES')).toHaveCount(0);
  await expect(issues(page)).toContainText('Routing complete');
  const graphOn = await fp(page);
  record('re-point Q1 · Yes to the "clarify" question (Guided picker vs graph drag from the Yes handle)', guidedOn, graphOn);

  // ---------------------------------------------- 9. undo and redo the deletion and the reconnection, exactly
  await page.getByTestId('ss-undo').click();
  expect(await fp(page), 'undo the reconnection').toBe(graphOff);
  await expect(slot(page, 'n1', 'YES')).toContainText('Choose destination');
  await page.getByTestId('ss-undo').click();
  expect(await fp(page), 'undo the deletion: the exact original model').toBe(fp0);
  await expect(edge(page, 'n1|YES')).toHaveCount(1);
  await page.getByTestId('ss-redo').click();
  expect(await fp(page), 'redo the deletion').toBe(graphOff);
  await page.getByTestId('ss-redo').click();
  expect(await fp(page), 'redo the reconnection').toBe(graphOn);
  await page.getByTestId('ss-undo').click();
  await page.getByTestId('ss-undo').click(); // back to the original for the next steps

  // -------------------------------------- 2. delete a No connection with the Delete key and leave it unresolved
  await clickEdge(page, 'n2|NO');
  await expect(page.getByTestId('ss-g-edge-name')).toHaveText('Q2 · No → Module ends · Clarification required');
  await page.keyboard.press('Delete');
  await expect(edge(page, 'n2|NO')).toHaveCount(0);
  await expect(gnode(page, 'out:CLARIFICATION_REQUIRED@n2')).toHaveCount(0); // the terminal was only a picture of the route
  await expect(slot(page, 'n2', 'NO')).toContainText('Choose destination');
  await expect(page.getByTestId('ss-g-broken-n2-NO')).toBeVisible();

  // ------------------------------------------------- 3. the validation error, in Graph and in Guided, and navigable
  await expect(issues(page)).toContainText('1 to fix'); // not routing-complete
  await expect(page.getByTestId('ss-g-issue-n2')).toContainText('1');
  await page.getByTestId('ss-next-issue').click(); // navigable: it selects the step in the graph
  await expect(gnode(page, 'n2')).toHaveClass(/selected/);
  await expect(page.getByTestId('ss-g-panel').getByTestId('ss-option-issue-n2-NO')).toContainText('Not routed yet');
  await shot(page, 'CE3-unresolved-route-in-graph');
  await page.getByTestId('ss-g-panel-close').click();
  await view(page, 'Guided');
  await expect(page.getByTestId('ss-dest-n2-NO')).toContainText('Choose destination');
  await expect(page.getByTestId('ss-option-issue-n2-NO')).toContainText('Not routed yet');
  await expect(issues(page)).toContainText('1 to fix');
  await issues(page).click();
  await expect(page.getByTestId('ss-readiness')).toContainText(/1 to fix/);
  await expect(page.getByTestId('ss-readiness')).toContainText('No.'); // not ready to publish
  await shot(page, 'CE3b-unresolved-route-in-guided');
  await page.keyboard.press('Escape');

  // ------------------------------------------------------------ 4. reconnect the No route and resolve the issue
  await view(page, 'Graph');
  await page.getByTestId('ss-g-fit').click();
  await connect(page, 'n2', 'NO', 'out:COMPLETED'); // onto a module outcome
  await expect(slot(page, 'n2', 'NO')).toContainText('Completed');
  await expect(issues(page)).toContainText('Routing complete');
  await expect(page.getByTestId('ss-g-issue-n2')).toHaveCount(0);

  // ----------------------------------------- 11. edge editing with the keyboard only: select, re-point, disconnect
  const kb = page.keyboard;
  const tabTo = async (l: Locator, name: string, max = 200) => {
    for (let i = 0; i < max; i++) { if (await l.evaluate((el) => el === document.activeElement).catch(() => false)) return; await kb.press('Tab'); }
    throw new Error(`Keyboard: could not reach ${name} with Tab`);
  };
  await page.getByTestId('ss-g-fit').focus();
  await tabTo(edge(page, 'n3|AFTER_CAPTURE'), 'the route after the free-text question');
  await expect(edge(page, 'n3|AFTER_CAPTURE')).toHaveAttribute('aria-label', /Route: Q1a · After the answer → Q2/);
  await kb.press('Enter'); // select the route: its toolbar opens and takes focus
  await expect(page.getByTestId('ss-g-edge-change')).toBeFocused();
  await kb.press('Enter');
  await kb.type('Unable to verify');
  await kb.press('Enter'); // a new destination without dragging
  await expect(slot(page, 'n3', 'AFTER_CAPTURE')).toContainText('Unable to verify');
  await expect(page.locator('.react-flow__node[data-id="n3"]')).toBeFocused(); // predictable focus: the source card
  await tabTo(edge(page, 'n3|AFTER_CAPTURE'), 'the same route again');
  await kb.press('Enter');
  await tabTo(page.getByTestId('ss-g-edge-disconnect'), 'Disconnect route');
  await kb.press('Enter');
  await expect(slot(page, 'n3', 'AFTER_CAPTURE')).toContainText('Choose destination');
  await expect(page.locator('.react-flow__node[data-id="n3"]')).toBeFocused();
  await kb.press('Enter'); // open the source card's routes
  const panel = page.getByTestId('ss-g-panel');
  await tabTo(panel.getByTestId('ss-dest-n3-AFTER_CAPTURE'), 'the destination control of the disconnected route');
  await kb.press('Enter');
  await kb.type('Do you understand');
  await kb.press('Enter');
  await expect(slot(page, 'n3', 'AFTER_CAPTURE')).toContainText('Q2');
  await expect(issues(page)).toContainText('Routing complete');
  await shot(page, 'CE11-keyboard-only-edge-editing');
  await page.getByTestId('ss-g-panel-close').click();

  // ---------------------------------- 5. re-point a single-choice option to a different question; endpoint dragging
  await toSurvey(page);
  await page.getByTestId('ss-open-mi-customer-concerns').click();
  await page.getByTestId('ss-derive').click();
  await view(page, 'Graph');
  await page.getByTestId('ss-g-fit').click();
  await expect(slot(page, 'n1', 'CLAIMS')).toContainText('Q1c');
  await clickEdge(page, 'n1|CLAIMS');
  await expect(page.getByTestId('ss-g-edge-name')).toHaveText('Q1 · How to claim → Q1c');
  await page.getByTestId('ss-g-edge-change').click();
  await pick(page, /Are you comfortable paying this premium/);
  await expect(slot(page, 'n1', 'CLAIMS')).toContainText('Q1a');
  await expect(edge(page, 'n1|CLAIMS')).toHaveCount(1);
  await expect(edge(page, 'n1|PREMIUM')).toHaveCount(1); // two answers, one destination: each is still its own route
  await expect(gnode(page, 'n2')).toHaveCount(1);
  await expect(gnode(page, 'n4')).toHaveCount(1); // the former destination was not deleted; it is reported as unreached
  await expect(issues(page)).toContainText('1 to fix');
  await shot(page, 'CE5-single-choice-option-repointed');
  // change the destination by dragging the END of the connection onto another card
  await page.waitForTimeout(600);
  const end = await edge(page, 'n1|CLAIMS').locator('.react-flow__edgeupdater-target').boundingBox();
  const back = await gnode(page, 'n4').boundingBox();
  await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2);
  await page.mouse.down();
  await page.mouse.move(back!.x + back!.width / 2, back!.y + back!.height / 2, { steps: 14 });
  await page.mouse.up();
  await expect(slot(page, 'n1', 'CLAIMS')).toContainText('Q1c');
  await expect(issues(page)).toContainText('Routing complete');

  // ----------------------------------------------------- 6. disconnect and reconnect a decision's MATCH route
  await page.getByTestId('ss-g-insert-n5|YES').click();
  await page.getByTestId('ss-new-DECISION').click();
  await panel.getByTestId('ss-dest-d1-MATCH').click();
  await pick(page, 'End module: Escalate');
  await page.getByTestId('ss-g-panel-close').click();
  await page.getByTestId('ss-g-fit').click();
  await clickEdge(page, 'd1|NO_MATCH');
  await expect(page.getByTestId('ss-g-edge-name')).toHaveText('C1 · Otherwise → Module ends · Completed'); // every decision route has its own named handle
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
  await clickEdge(page, 'd1|MATCH');
  await expect(page.getByTestId('ss-g-edge-name')).toHaveText('C1 · Matches → Module ends · Escalate');
  await page.getByTestId('ss-g-edge-disconnect').click();
  await expect(slot(page, 'd1', 'MATCH')).toContainText('Choose destination');
  await expect(page.getByTestId('ss-g-broken-d1-MATCH')).toBeVisible();
  await expect(gnode(page, 'd1')).toHaveCount(1);
  await connect(page, 'd1', 'MATCH', 'out:CLARIFICATION_REQUIRED@n5');
  await expect(slot(page, 'd1', 'MATCH')).toContainText('Clarification required');
  await shot(page, 'CE6-decision-match-reconnected');

  // ---------- a line that shows STRUCTURE is explained, not deleted: the order of a follow-up queue is not a route
  await toSurvey(page);
  await page.getByTestId('ss-add-M-CLARIFICATIONS').click();
  await page.getByTestId('ss-open-mi-clarifications').click();
  await view(page, 'Graph');
  await page.getByTestId('ss-g-fit').click();
  const structure = await fp(page);
  await clickEdge(page, 'n1|QUEUE|0');
  await expect(page.getByTestId('ss-g-edge-why')).toContainText('The order in which follow-up questions are asked. It is not a route of its own');
  await expect(page.getByTestId('ss-g-edge-disconnect')).toHaveCount(0);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('ss-g-message')).toContainText('It is not a route of its own');
  expect(await fp(page)).toBe(structure);
  await shot(page, 'CE-structure-line-explained');
  await page.getByTestId('ss-g-edge-owner').click(); // the semantic edit: on the question that owns the queue
  await expect(panel).toContainText('Q1 · routes and details');

  // ------------------------------------- 8. an invalid mandatory-escalation connection is refused, however it is tried
  await page.getByTestId('ss-prototype-tag').click();
  await page.getByTestId('ss-add-large').click();
  await view(page, 'Graph');
  await page.getByTestId('ss-outline').click();
  await page.getByRole('combobox', { name: 'Search by number or wording' }).fill('existing policies');
  await page.keyboard.press('Enter');
  await page.getByTestId('ss-g-panel-close').click();
  const guarded = await fp(page);
  await clickEdge(page, 'n17|PRESSURED');
  await expect(page.getByTestId('ss-g-edge-name')).toContainText('I was pressured to cancel one');
  await page.getByTestId('ss-g-edge-change').click();
  await expect(page.getByRole('option')).toHaveCount(1); // the only destination offered: the approved escalation outcome
  await expect(page.getByRole('option', { name: 'End module: Escalate' })).toBeVisible();
  await shot(page, 'CE8-mandatory-escalation-only-approved-outcome');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await connect(page, 'n17', 'PRESSURED', 'n16'); // by dragging from the handle
  await expect(page.getByTestId('ss-g-message')).toContainText('mandatory escalation: it can only lead to an approved escalation outcome');
  expect(await fp(page), 'a refused connection changes nothing').toBe(guarded);
  await clickEdge(page, 'n17|PRESSURED'); // disconnect it, then try to redraw it somewhere it may not go
  await page.getByTestId('ss-g-edge-disconnect').click();
  await expect(slot(page, 'n17', 'PRESSURED')).toContainText('Choose destination');
  await expect(issues(page)).toContainText('1 to fix'); // an unrouted mandatory escalation blocks completeness
  const unrouted = await fp(page);
  await connect(page, 'n17', 'PRESSURED', 'n16');
  await expect(page.getByTestId('ss-g-message')).toContainText('mandatory escalation');
  expect(await fp(page)).toBe(unrouted);
  await page.getByTestId('ss-undo').click();
  expect(await fp(page)).toBe(guarded);
  await expect(issues(page)).toContainText('Routing complete');

  // -------------------------------------------------- 7. change a survey-level module outcome connection
  await page.getByRole('navigation', { name: 'Survey Studio breadcrumb' }).getByRole('link', { name: 'Survey Studio' }).click();
  await page.getByRole('link', { name: /Edge check/ }).click();
  await view(page, 'Graph');
  await page.getByTestId('ss-g-fit').click();
  const sBefore = await fp(page);
  await clickEdge(page, 'mi-general-verification|COMPLETED');
  await expect(page.getByTestId('ss-g-edge-name')).toHaveText('General verification · Completed → Suitability');
  await shot(page, 'CE7-survey-route-selected');
  await page.getByTestId('ss-g-edge-change').click();
  await pick(page, 'Jump to Closing');
  await expect(slot(page, 'mi-general-verification', 'COMPLETED')).toContainText('Closing');
  const viaGraph = await fp(page);
  await clickEdge(page, 'mi-general-verification|COMPLETED');
  await page.getByTestId('ss-g-edge-disconnect').click(); // disconnect: both modules stay; the outcome needs a destination
  await expect(slot(page, 'mi-general-verification', 'COMPLETED')).toContainText('Choose destination');
  await expect(page.getByTestId('ss-g-broken-mi-general-verification-COMPLETED')).toBeVisible();
  await expect(page.locator('.react-flow__node .ss-g-node.instance')).toHaveCount(6);
  const viaGraphOff = await fp(page);
  await connect(page, 'mi-general-verification', 'COMPLETED', 'mi-suitability'); // redraw to the next module
  expect(await fp(page), 'back to the original survey routing').toBe(sBefore);
  // the governed halt is a protected outcome: explained, not deletable, not re-pointable
  await clickEdge(page, 'mi-affordability-check|REVIEW_REQUIRED');
  await expect(page.getByTestId('ss-g-edge-why')).toContainText('Review required is governed');
  await expect(page.getByTestId('ss-g-edge-disconnect')).toHaveCount(0);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('ss-g-message')).toContainText('Review required is governed');
  expect(await fp(page)).toBe(sBefore);
  await page.keyboard.press('Escape');
  if (await page.getByTestId('ss-g-panel-close').count()) await page.getByTestId('ss-g-panel-close').click(); // a card may have been selected while aiming at the line
  await page.getByTestId('ss-g-fit').click();
  await connect(page, 'mi-customer-concerns', 'COMPLETED', 'mi-general-verification'); // an illegal backward route
  await expect(page.getByTestId('ss-g-message')).toContainText('A route may only go to a later module');
  expect(await fp(page)).toBe(sBefore);
  await scan(page, 'survey-graph-routes');
  // the same two edits in the Composer give the same models
  await view(page, 'Blocks');
  await page.getByTestId('ss-route-mi-general-verification-COMPLETED').click();
  await pick(page, 'Jump to Closing');
  record('survey: re-point "Completed" of General verification to Closing (Composer vs graph toolbar)', await fp(page), viaGraph);
  await expect(page.getByTestId('ss-route-mi-general-verification-COMPLETED')).toContainText('jumps to Closing');

  expect(viaGraphOff).not.toBe(viaGraph);
  writeFileSync('test-results/prototype/connection_parity.txt', `SS-02B.2.1 connection editing — model fingerprints (FNV-1a of the whole canonical model)\n${parity.join('\n')}\n`);
  expect(parity.every((l) => l.startsWith('SAME'))).toBe(true);
});
