import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// (Named to run last: the workspace is read against everything the journeys before it published.)
// UX-HOME-1 — the Survey Studio workspace, full stack, read against the server's own records:
//   * live inventory equal to the server's counts; recents; the ways on; a compact notice;
//   * one search across surveys, modules, questions, conditions and answer sets;
//   * the building-blocks gallery with filters;
//   * THE PRIMARY ACCEPTANCE TEST: from the workspace, find a published module, open the inspector, and read every
//     step, answer, branch and destination, its conditions, how each survey enters and leaves it, its exact
//     dependencies, where it is reused and its revisions — then launch the next permitted action (test, reuse);
//   * the rules explorer's four families, each linking to the screen that owns it;
//   * a reader may inspect and is offered no action that changes anything;
//   * desktop and smaller viewports.
// Nothing is created or changed by this journey.
const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = 'test-results/persisted/shots';
type Who = 'survey_author' | 'survey_reader' | 'survey_simulator';
const account = (who: Who): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'))[who];
/* eslint-disable @typescript-eslint/no-explicit-any */
type S = { context: BrowserContext; page: Page };
async function session(browser: Browser, who: Who, path = '/', viewport = { width: 1440, height: 900 }): Promise<S> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signIn(page, account(who), path);
  return { context, page };
}
const get = async (s: S, path: string) => (await s.page.request.get(path)).json();

test.use({ actionTimeout: 20_000 });

test('UX-HOME-1 the workspace: discover a published module, inspect everything in it, and launch the next action', async ({ browser }) => {
  test.setTimeout(300_000);
  const author = await session(browser, 'survey_author', '/survey-studio');
  const page = author.page;
  const home = page.getByTestId('ss-saved-home');
  await expect(home).toHaveAttribute('data-loaded', 'true');

  // ---- what the server holds, and what the workspace says: the same numbers
  const ws = await get(author, '/api/v1/survey-definitions/workspace');
  const surveys = (await get(author, '/api/v1/survey-definitions')).items as any[];
  const modules = (await get(author, '/api/v1/survey-components?kind=MODULE')).items as any[];
  const conditions = (await get(author, '/api/v1/survey-components?kind=CONDITION')).items as any[];
  expect(ws.inventory.surveys.total).toBe(surveys.length);
  expect(ws.inventory.components.MODULE.components).toBe(new Set(modules.map((m) => m.code)).size);
  await expect(page.getByTestId('ss-ws-count-surveys')).toHaveAttribute('data-count', String(surveys.length));
  for (const k of ['MODULE', 'ITEM', 'CONDITION', 'OPTION_SET']) await expect(page.getByTestId(`ss-ws-count-${k}`)).toHaveAttribute('data-count', String(ws.inventory.components[k].components));
  await expect(page.getByTestId('ss-ws-count-ITEM')).toContainText(String(ws.inventory.components.ITEM.questions));
  // recents are the server's, newest first; nothing is waiting for the author of everything
  await expect(page.getByTestId('ss-ws-recent-drafts').locator('li')).toHaveCount(ws.recent_drafts.length);
  await expect(page.getByTestId('ss-ws-recent-drafts').locator('li').first()).toContainText(ws.recent_drafts[0].survey_name);
  await expect(page.getByTestId('ss-ws-recent-published').locator('li').first()).toContainText(ws.recent_published[0].survey_name);
  // the ways on are cards, and the notice is one line
  for (const id of ['ss-open-assignment', 'ss-open-controls', 'ss-open-journeys', 'ss-open-rules']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId('ss-standing-note')).toContainText('No survey here is eligible for a live call');
  expect((await page.getByTestId('ss-standing-note').boundingBox())!.height).toBeLessThan(40);
  // reused modules are the ones the server counts as pinned by more than one survey
  if (ws.reused_modules.length) await expect(page.getByTestId('ss-ws-reused').locator('li')).toHaveCount(ws.reused_modules.length);
  await page.screenshot({ path: `${SHOTS}/UXHOME01-workspace-desktop.png`, fullPage: true });

  // ---- the gallery: every latest published module is a card; filters and tabs
  const latest = modules.filter((m) => m.is_latest);
  await expect(page.getByTestId('ss-ws-grid-MODULE').locator('li')).toHaveCount(latest.length);
  await page.getByTestId('ss-ws-filter').selectOption('reused');
  await expect(page.getByTestId('ss-ws-grid-MODULE').locator('li')).toHaveCount(latest.filter((m) => m.used_by.surveys > 1).length);
  await page.getByTestId('ss-ws-filter').selectOption('all');
  await expect(page.getByTestId('ss-ws-grid-MODULE').locator('li')).toHaveCount(modules.length);
  await page.getByTestId('ss-ws-filter').selectOption('latest');
  await page.getByTestId('ss-ws-tab-CONDITION').click();
  await expect(page.getByTestId('ss-ws-grid-CONDITION').locator('li')).toHaveCount(conditions.filter((c) => c.is_latest).length);
  await page.getByTestId('ss-ws-tab-MODULE').click();

  // ---- one search across every kind
  // the module with the most to read: a decision if one is published, else the most endings and questions
  const target = [...latest].sort((x, y) => (y.facts.decisions - x.facts.decisions) || (y.facts.outcomes.length - x.facts.outcomes.length) || (y.facts.questions - x.facts.questions))[0];
  await page.getByTestId('ss-ws-search').fill(target.title);
  await expect(page.getByTestId('ss-ws-results')).toBeVisible();
  await expect(page.getByTestId(`ss-ws-block-MODULE-${target.code}-${target.version}`)).toBeVisible();
  await page.getByTestId('ss-ws-search').fill('zzz-nothing-is-called-this');
  await expect(page.getByTestId('ss-ws-results')).toHaveAttribute('data-count', '0');
  const someSurvey = surveys[0];
  await page.getByTestId('ss-ws-search').fill(someSurvey.name);
  await expect(page.getByTestId(`ss-survey-${someSurvey.code}`)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/UXHOME02-search-across-asset-kinds.png`, fullPage: true });
  await page.getByTestId('ss-ws-search-clear').click();

  // ============ PRIMARY ACCEPTANCE: a module with a decision, inspected from its card ============
  const detail = await get(author, `/api/v1/survey-components/MODULE/${target.code}/${target.version}`);
  const doc = detail.document;
  await page.getByTestId(`ss-ws-block-MODULE-${target.code}-${target.version}`).click();
  const ins = page.getByTestId('ss-inspector');
  await expect(ins).toHaveAttribute('data-loaded', 'true');
  await expect(ins).toHaveAttribute('data-code', target.code);
  await expect(page).toHaveURL(/inspect=MODULE/); // the address names the block: it can be linked
  await expect(page.locator('#ss-in-title')).toHaveText(detail.title);
  await expect(page.getByTestId('ss-in-meta')).toContainText(`Revision ${detail.version}`);
  // every step is a node of the graph and a row of "Every step" — as many as the published document has
  await expect(page.getByTestId('ss-in-graph').locator('button')).toHaveCount(doc.nodes.length);
  await expect(page.getByTestId('ss-in-steps').locator('ol > li')).toHaveCount(doc.nodes.length);
  for (const o of doc.outcomes) await expect(page.getByTestId(`ss-in-end-${o}`)).toBeVisible();
  for (const n of doc.nodes) {
    const row = page.getByTestId(`ss-in-step-${n.node}`);
    await expect(row).toHaveAttribute('data-type', n.type === 'DECISION' ? 'DECISION' : /QUESTION|STATEMENT/);
    const edges = doc.edges.filter((e: any) => e.from === n.node);
    if (edges.length) await expect(row.locator('.ss-in-branches li')).toHaveCount(edges.length); // every branch, with where it leads
    const ref = n.item ?? n.question;
    if (ref) { const wording = detail.dependencies.find((d: any) => d.kind === 'WORDING' && d.code === ref.code && d.version === ref.wording_version); await expect(row).toContainText(wording.document.text); }
  }
  // the graph is interactive: selecting a node selects its step
  const decision = doc.nodes.find((n: any) => n.type === 'DECISION');
  const pick = (decision ?? doc.nodes[0]).node;
  await page.getByTestId(`ss-in-node-${pick}`).click();
  await expect(page.getByTestId(`ss-in-node-${pick}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`ss-in-step-${pick}`)).toHaveClass(/on/);
  // reusable conditions, in words, with what they read
  const conds = detail.dependencies.filter((d: any) => d.kind === 'CONDITION');
  await expect(page.getByTestId('ss-in-conditions')).toContainText(conds.length ? conds[0].document.name : 'uses no reusable condition');
  if (conds.length) { await expect(page.getByTestId(`ss-in-condition-${conds[0].code}`).first()).toContainText('is met when'); await expect(page.getByTestId(`ss-in-condition-${conds[0].code}`).first()).toContainText('Unknown is never read as “not met”'); }
  // entry and exit, and each consuming survey with its pinned version
  await expect(page.getByTestId('ss-in-entry-exit')).toContainText('Starts at');
  for (const u of detail.published_in) { await expect(page.getByTestId(`ss-in-consumer-${u.survey_code}`)).toContainText(u.survey_name); await expect(page.getByTestId(`ss-in-consumer-${u.survey_code}`)).toContainText(`version ${u.version_label}`); await expect(page.getByTestId(`ss-in-consumer-${u.survey_code}`)).toContainText('Entered'); }
  // version history and governance; exact dependency versions on demand
  await expect(page.getByTestId('ss-in-history').locator('.ss-in-revisions li')).toHaveCount(detail.revisions.length);
  await page.getByTestId('ss-in-dependencies').locator('summary').click();
  await expect(page.getByTestId('ss-in-dependencies').locator('tbody tr')).toHaveCount(detail.dependencies.length + 1);
  await page.screenshot({ path: `${SHOTS}/UXHOME03-module-inspector-desktop.png` });
  await ins.evaluate((el) => el.scrollTo(0, 0));
  await page.getByTestId('ss-in-flow').screenshot({ path: `${SHOTS}/UXHOME04-module-execution-graph.png` });
  await page.getByTestId('ss-in-steps').screenshot({ path: `${SHOTS}/UXHOME05-every-step-answers-and-branches.png` });
  // a question of the module is inspected on its own, and the way back is the browser's
  const firstItem = doc.nodes.find((n: any) => n.item ?? n.question);
  await page.getByTestId(`ss-in-open-item-${firstItem.node}`).click();
  await expect(ins).toHaveAttribute('data-kind', 'ITEM');
  await expect(ins).toHaveAttribute('data-loaded', 'true');
  await page.getByTestId('ss-in-close').click();
  await expect(ins).toHaveCount(0);
  // the next permitted action: reuse — opens the chosen survey with its library on this exact block
  await page.getByTestId(`ss-ws-block-MODULE-${target.code}-${target.version}`).click();
  await expect(ins).toHaveAttribute('data-loaded', 'true');
  await page.getByTestId('ss-in-reuse').click();
  const mine = surveys.find((s) => !s.open_candidate_status)!;
  await page.getByTestId(`ss-in-reuse-${mine.code}`).click();
  await expect(page).toHaveURL(new RegExp(`/survey-studio/surveys/${mine.code}`));
  await expect(page.getByTestId('ss-library-source')).toBeVisible(); // the survey's own library, on the block
  await expect(page.getByTestId('ss-library-add')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/UXHOME06-reuse-opens-the-survey-library-on-the-block.png` });
  expect((await get(author, `/api/v1/survey-definitions/${mine.id}`)).draft_revision).toBe(mine.draft_revision); // nothing was changed by looking

  // ---- the rules explorer: four families, each from the module that owns it
  await page.goto('/survey-studio');
  await page.getByTestId('ss-open-rules').click();
  await expect(page.getByTestId('ss-rx')).toHaveAttribute('data-family', 'assignment');
  const policy = await get(author, '/api/v1/survey-assignment/policy');
  const inEffect = policy.rules.filter((r: any) => r.effective_now);
  await expect(page.getByTestId('ss-rx-assignment').locator('> li')).toHaveCount(inEffect.length);
  const bound = inEffect.find((r: any) => r.published_binding);
  await expect(page.getByTestId(`ss-rx-rule-${bound.rule_code}`)).toContainText(policy.bindings.find((b: any) => b.id === bound.published_binding).survey_name);
  await page.screenshot({ path: `${SHOTS}/UXHOME07-rules-explorer-assignment.png`, fullPage: true });
  await page.getByTestId('ss-rx-family-logic').click();
  await expect(page.getByTestId('ss-rx-conditions').locator('> li')).toHaveCount(Math.max(1, conditions.filter((c) => c.is_latest).length));
  if (conds.length) await expect(page.getByTestId(`ss-rx-condition-${conds[0].code}`)).toContainText('Met when');
  await page.getByTestId(`ss-rx-inspect-${target.code}`).click();
  await expect(ins).toHaveAttribute('data-code', target.code); // the same inspector, from the rules
  await page.getByTestId('ss-in-close').click();
  await page.getByTestId('ss-rx-family-applicability').click();
  const policies = (await get(author, '/api/v1/survey-evaluation/control-policies')).items.filter((p: any) => p.status === 'PUBLISHED');
  await expect(page.getByTestId('ss-rx-applicability').locator('> li')).toHaveCount(policies.reduce((n: number, p: any) => n + p.controls.reduce((m: number, c: any) => m + c.obligations.length, 0), 0));
  await page.screenshot({ path: `${SHOTS}/UXHOME08-rules-explorer-control-applicability.png`, fullPage: true });
  await page.getByTestId('ss-rx-family-findings').click();
  await expect(page.getByTestId('ss-rx-unavailable').or(page.getByTestId('ss-rx-findings'))).toBeVisible(); // shown, or said plainly why not

  // ---- a reader: inspects everything, and is offered nothing that changes anything
  const reader = await session(browser, 'survey_reader', '/survey-studio', { width: 1024, height: 768 });
  await expect(reader.page.getByTestId('ss-saved-home')).toHaveAttribute('data-loaded', 'true');
  await expect(reader.page.getByTestId('ss-read-only')).toBeVisible();
  await expect(reader.page.getByTestId('ss-create')).toHaveCount(0);
  await expect(reader.page.getByTestId('ss-open-assignment')).toHaveCount(0);
  await reader.page.screenshot({ path: `${SHOTS}/UXHOME09-workspace-1024-reader.png`, fullPage: true });
  await reader.page.getByTestId(`ss-ws-block-MODULE-${target.code}-${target.version}`).click();
  await expect(reader.page.getByTestId('ss-inspector')).toHaveAttribute('data-loaded', 'true');
  await expect(reader.page.getByTestId('ss-in-read-only')).toBeVisible();
  await expect(reader.page.getByTestId('ss-in-reuse')).toHaveCount(0);
  await expect(reader.page.getByTestId('ss-in-test')).toHaveCount(0);
  await expect(reader.page.getByTestId('ss-in-graph').locator('button')).toHaveCount(doc.nodes.length);
  await reader.page.screenshot({ path: `${SHOTS}/UXHOME10-inspector-1024-reader.png` });
  await reader.context.close();

  // ---- a narrow window: nothing overflows sideways
  const narrow = await session(browser, 'survey_simulator', '/survey-studio', { width: 768, height: 1024 });
  await expect(narrow.page.getByTestId('ss-saved-home')).toHaveAttribute('data-loaded', 'true');
  expect(await narrow.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await narrow.page.screenshot({ path: `${SHOTS}/UXHOME11-workspace-768.png`, fullPage: true });
  await narrow.page.getByTestId(`ss-ws-block-MODULE-${target.code}-${target.version}`).click();
  await expect(narrow.page.getByTestId('ss-inspector')).toHaveAttribute('data-loaded', 'true');
  await expect(narrow.page.getByTestId('ss-in-test')).toBeVisible(); // a simulator may test it
  await narrow.page.screenshot({ path: `${SHOTS}/UXHOME12-inspector-768.png` });
  await narrow.context.close();
  await author.context.close();
});
