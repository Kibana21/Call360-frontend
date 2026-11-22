import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// (Named to run last: the workspace is read against everything the journeys before it published.)
// UX-HOME-1 + NAV-1 — the Survey Studio workspace and the consolidated navigation, full stack, asserted against the
// server's own records. The numbers in the comments are the owner's twenty-six required browser journeys.
// Nothing is created or changed by this journey except where step 14 follows the existing reuse workflow up to — and
// not past — the author's own "Add to this survey".
const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = 'test-results/persisted/shots';
type Who = 'survey_author' | 'survey_reader' | 'survey_simulator' | 'survey_platform' | 'survey_elsewhere' | 'user';
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
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

test.use({ actionTimeout: 20_000 });

test('UX-HOME-1 + NAV-1 the workspace, the module inspector, the explorers and the consolidated navigation', async ({ browser }) => {
  test.setTimeout(420_000);
  const author = await session(browser, 'survey_author', '/survey-studio');
  const page = author.page;
  const home = page.getByTestId('ss-saved-home');
  const ins = page.getByTestId('ss-inspector');
  await expect(home).toHaveAttribute('data-loaded', 'true');

  // ---- 1, 2. the homepage and its real inventory: the server's counts
  const ws = await get(author, '/api/v1/survey-definitions/workspace');
  const surveys = (await get(author, '/api/v1/survey-definitions')).items as any[];
  const modules = (await get(author, '/api/v1/survey-components?kind=MODULE')).items as any[];
  const conditions = (await get(author, '/api/v1/survey-components?kind=CONDITION')).items as any[];
  const latest = modules.filter((m) => m.is_latest);
  await expect(page.getByRole('heading', { name: 'Survey Studio', level: 1 })).toBeVisible();
  await expect(home).toContainText('Design, reuse and govern customer journeys.');
  await expect(home).toHaveAttribute('data-view', 'overview');
  expect(ws.inventory.surveys.total).toBe(surveys.length);
  await expect(page.getByTestId('ss-ws-count-surveys')).toHaveAttribute('data-count', String(surveys.length));
  for (const k of ['MODULE', 'ITEM', 'CONDITION', 'OPTION_SET']) await expect(page.getByTestId(`ss-ws-count-${k}`)).toHaveAttribute('data-count', String(ws.inventory.components[k].components));
  await expect(page.getByTestId('ss-ws-count-drafts')).toHaveAttribute('data-count', String(ws.inventory.surveys.never_published));
  await expect(page.getByTestId('ss-ws-count-review')).toHaveAttribute('data-count', String(ws.inventory.surveys.in_review + ws.inventory.surveys.approved_awaiting_publication));
  await expect(page.getByTestId('ss-surveys').locator('> li')).toHaveCount(surveys.length);
  await expect(page.getByTestId('ss-surveys').locator('> li').first()).toContainText(ws.recent_drafts[0].survey_name);
  for (const id of ['ss-open-assignment', 'ss-open-controls', 'ss-open-journeys', 'ss-open-simulation', 'ss-open-rules']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId('ss-standing-note')).toContainText('No survey here is eligible for a live call');
  expect((await page.getByTestId('ss-standing-note').boundingBox())!.height).toBeLessThan(40); // one line, not a banner
  // the consolidated sidebar: five groups, Survey Studio open on Home
  for (const g of ['Workspace', 'Design & Govern', 'Simulate & Analyze', 'Operations', 'Legacy & Administration']) await expect(nav(page).getByText(g, { exact: true })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('app-crumb')).toContainText('Design & Govern');
  await page.screenshot({ path: `${SHOTS}/UXHOME01-workspace-and-consolidated-sidebar-1440.png`, fullPage: true });

  // "Create module" creates a module (LIB-2) — and only when the author says so: opening and cancelling the form
  // creates nothing, neither a module nor a survey
  const modulesBefore = (await get(author, '/api/v1/survey-modules')).items.length;
  await expect(page.getByTestId('ss-ws-new-block')).toHaveAttribute('data-mode', 'create');
  await page.getByTestId('ss-ws-new-block').click();
  await expect(page.getByTestId('ss-module-create-form')).toContainText('No survey is needed to make one');
  await expect(page.getByTestId('ss-module-create-go')).toBeDisabled(); // nothing to create until it has a name
  await page.screenshot({ path: `${SHOTS}/UXHOME02-create-module-form.png` });
  await page.getByTestId('ss-module-create-form').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('ss-module-create-form')).toHaveCount(0);
  expect((await get(author, '/api/v1/survey-definitions')).items.length).toBe(surveys.length);
  expect((await get(author, '/api/v1/survey-modules')).items.length).toBe(modulesBefore);

  // ---- 3. the Modules gallery, from its count; filters, sorting, card and list layouts
  await page.getByTestId('ss-ws-count-MODULE').click();
  await expect(home).toHaveAttribute('data-view', 'blocks');
  await expect(nav(page).getByRole('link', { name: 'Building blocks' })).toHaveAttribute('aria-current', 'page');
  const shown = Math.min(24, latest.length);
  await expect(page.getByTestId('ss-ws-grid-MODULE').locator('> li')).toHaveCount(shown);
  if (latest.length > 24) await expect(page.getByTestId('ss-ws-pages')).toContainText(`${latest.length} in all`);
  await page.getByTestId('ss-ws-sort').selectOption('reuse');
  const mostReused = [...latest].sort((a, b) => b.used_by.surveys - a.used_by.surveys || a.title.localeCompare(b.title))[0];
  await expect(page.getByTestId('ss-ws-grid-MODULE').locator('> li').first()).toContainText(mostReused.title);
  await page.getByTestId('ss-ws-blocks-layout-list').click();
  await expect(page.getByTestId('ss-ws-list-MODULE').locator('tbody tr')).toHaveCount(shown);
  await page.getByTestId('ss-ws-blocks-layout-grid').click();
  await page.getByTestId('ss-ws-filter').selectOption('reused');
  await expect(page.getByTestId('ss-ws-grid-MODULE').locator('> li')).toHaveCount(Math.min(24, latest.filter((m) => m.used_by.surveys > 1).length));
  await page.getByTestId('ss-ws-filter').selectOption('latest');
  await page.getByTestId('ss-ws-sort').selectOption('name');
  await page.getByTestId('ss-ws-tab-CONDITION').click();
  await expect(page.getByTestId('ss-ws-grid-CONDITION').locator('> li')).toHaveCount(Math.min(24, conditions.filter((c) => c.is_latest).length));
  await page.getByTestId('ss-ws-tab-MODULE').click();
  await page.screenshot({ path: `${SHOTS}/UXHOME03-building-blocks-gallery.png`, fullPage: true });

  // ---- 4. search for an existing published module (the one with the most to read: branches, endings, questions)
  const target = [...latest].sort((x, y) => (y.facts.decisions - x.facts.decisions) || (Number(y.facts.branching) - Number(x.facts.branching)) || (y.facts.outcomes.length - x.facts.outcomes.length) || (y.facts.questions - x.facts.questions))[0];
  expect(target.facts.branching).toBe(true); // a module that really branches
  await page.getByTestId('ss-ws-search').fill(target.title);
  await expect(page.getByTestId('ss-ws-results')).toBeVisible();
  await expect(page.getByTestId(`ss-ws-block-MODULE-${target.code}-${target.version}`)).toBeVisible();
  await page.getByTestId('ss-ws-search').fill('zzz-nothing-is-called-this');
  await expect(page.getByTestId('ss-ws-results')).toHaveAttribute('data-count', '0');
  await page.getByTestId('ss-ws-search').fill(surveys[0].name);
  await expect(page.getByTestId(`ss-ws-survey-${surveys[0].code}`)).toBeVisible(); // surveys are found by the same search
  await page.getByTestId('ss-ws-search').fill(target.title);
  await page.screenshot({ path: `${SHOTS}/UXHOME04-search-across-asset-kinds.png`, fullPage: true });

  // ---- 5. the Module Inspector, from the search result
  const detail = await get(author, `/api/v1/survey-components/MODULE/${target.code}/${target.version}`);
  const doc = detail.document;
  await page.getByTestId(`ss-ws-block-MODULE-${target.code}-${target.version}`).click();
  await expect(ins).toHaveAttribute('data-loaded', 'true');
  await expect(ins).toHaveAttribute('data-code', target.code);
  await expect(page).toHaveURL(/inspect=MODULE/); // the address names the block
  await expect(page.locator('#ss-in-title')).toHaveText(detail.title);
  await expect(page.getByTestId('ss-in-meta')).toContainText(`Revision ${detail.version}`);
  await expect(page.getByTestId('ss-in-meta')).toContainText('Branches');
  for (const t of ['overview', 'questions', 'logic', 'rules', 'dependencies', 'where-used', 'versions', 'test']) await expect(page.getByTestId(`ss-in-tab-${t}`)).toBeVisible();
  await expect(page.getByTestId('ss-in-governance').locator('li[data-event="PUBLISHED"]')).toHaveCount(1); // who published the version it came with
  await page.screenshot({ path: `${SHOTS}/UXHOME05-module-inspector-overview-and-governance.png` });

  // ---- 6. all module questions: exact wording, kind of answer, every branch
  await expect(page.getByTestId('ss-in-steps').locator('> li')).toHaveCount(doc.nodes.length);
  for (const n of doc.nodes) {
    const row = page.getByTestId(`ss-in-step-${n.node}`);
    const edges = doc.edges.filter((e: any) => e.from === n.node);
    if (edges.length) await expect(row.locator('.ss-in-branches li')).toHaveCount(edges.length);
    const ref = n.item ?? n.question;
    if (ref) { const wording = detail.dependencies.find((d: any) => d.kind === 'WORDING' && d.code === ref.code && d.version === ref.wording_version); await expect(row).toContainText(wording.document.text); }
  }
  await page.getByTestId('ss-in-questions').screenshot({ path: `${SHOTS}/UXHOME06-every-question-answers-and-branches.png` });

  // ---- 7. the actual branching graph, derived from this revision
  await page.getByTestId('ss-in-tab-logic').click();
  await expect(page.getByTestId('ss-in-graph').locator('button.ss-in-node')).toHaveCount(doc.nodes.length);
  for (const o of doc.outcomes) await expect(page.getByTestId(`ss-in-end-${o}`)).toBeVisible();
  await expect(page.getByTestId('ss-in-entry')).toContainText('A module has no entry condition of its own');
  // ---- 8. click a graph node: its question
  const brancher = doc.nodes.find((n: any) => new Set(doc.edges.filter((e: any) => e.from === n.node).map((e: any) => JSON.stringify(e.to))).size > 1) ?? doc.nodes[0];
  await page.getByTestId(`ss-in-node-${brancher.node}`).click();
  await expect(page.getByTestId(`ss-in-node-${brancher.node}`)).toHaveAttribute('aria-pressed', 'true');
  const bref = brancher.item ?? brancher.question;
  const bwording = bref ? detail.dependencies.find((d: any) => d.kind === 'WORDING' && d.code === bref.code && d.version === bref.wording_version).document.text : null;
  if (bwording) await expect(page.getByTestId('ss-in-node-detail')).toContainText(bwording);
  await expect(page.getByTestId(`ss-in-step-${brancher.node}`)).toHaveClass(/on/);
  // ---- 9. click a branch: the actual routing rule
  const edge = doc.edges.find((e: any) => e.from === brancher.node && !['ANY', 'AFTER_CAPTURE'].includes(e.on)) ?? doc.edges.find((e: any) => e.from === brancher.node);
  const to = edge.to.node ?? `end-${edge.to.outcome}`;
  await page.getByTestId(`ss-in-branch-${brancher.node}-${to}`).click();
  await expect(page.getByTestId('ss-in-branch-detail')).toContainText(`Link ${edge.edge}`);
  if (!['ANY', 'AFTER_CAPTURE', 'MATCH', 'NO_MATCH', 'UNKNOWN'].includes(edge.on)) await expect(page.getByTestId('ss-in-branch-detail')).toContainText(`option ${edge.on}`);
  await page.getByTestId('ss-in-logic').screenshot({ path: `${SHOTS}/UXHOME07-interactive-graph-and-the-routing-rule-of-a-branch.png` });

  // ---- 10. a reusable condition: in this module if it has one, else from the Conditions gallery
  const conds = detail.dependencies.filter((d: any) => d.kind === 'CONDITION');
  if (conds.length) await expect(page.getByTestId(`ss-in-condition-${conds[0].code}`).first()).toContainText('is met when');
  else await expect(page.getByTestId('ss-in-no-conditions')).toBeVisible();

  // ---- 11, 12. every survey consuming the module, with the exact revision each pins
  await page.getByTestId('ss-in-tab-where-used').click();
  for (const u of detail.published_in) {
    const row = page.getByTestId(`ss-in-consumer-${u.survey_code}`);
    await expect(row).toContainText(u.survey_name);
    await expect(row).toContainText(`version ${u.version_label}`);
    await expect(row).toContainText(`pins revision ${detail.version}`);
    await expect(row).toContainText('Entered');
  }
  await expect(page.getByTestId('ss-in-where-used')).toContainText('Publishing a newer one changes none of them');
  await page.getByTestId('ss-in-tab-dependencies').click();
  await expect(page.getByTestId('ss-in-dependencies').locator('tbody tr')).toHaveCount(detail.dependencies.length + 1);
  await page.getByTestId('ss-in-where-used').screenshot({ path: `${SHOTS}/UXHOME08-where-used-and-pinned-revisions.png` });

  // ---- 13. compare revisions — on a block that has more than one, if any is published; else it says there is one
  await page.getByTestId('ss-in-tab-versions').click();
  await expect(page.getByTestId('ss-in-versions').locator('.ss-in-revisions li')).toHaveCount(detail.revisions.length);
  const multi = modules.find((m) => m.latest_published_version > 1 && m.is_latest);
  if (multi) {
    await page.goto(`/survey-studio?view=blocks&inspect=MODULE~${multi.code}~${multi.version}`);
    await expect(ins).toHaveAttribute('data-loaded', 'true');
    await page.getByTestId('ss-in-tab-versions').click();
    await page.getByTestId(`ss-in-compare-${multi.version - 1}`).click();
    await expect(page.getByTestId('ss-in-compare')).toContainText(`Revision ${multi.version} compared with ${multi.version - 1}`);
    await page.getByTestId('ss-in-versions').screenshot({ path: `${SHOTS}/UXHOME09-compare-published-revisions.png` });
    await page.goto(`/survey-studio?view=blocks&inspect=MODULE~${target.code}~${target.version}`);
    await expect(ins).toHaveAttribute('data-loaded', 'true');
  } else if (detail.revisions.length < 2) await expect(page.getByTestId('ss-in-one-revision')).toBeVisible();

  // the Test section: the existing simulator, on a survey that pins the module — the author here may not simulate
  await page.getByTestId('ss-in-tab-test').click();
  await expect(page.getByTestId('ss-in-test')).toContainText('This revision can be tested on its own');
  await expect(page.getByTestId('ss-in-test-denied')).toBeVisible();

  // a question of the module is inspected on its own; Escape closes; the reader is back where they were (15)
  const firstItem = doc.nodes.find((n: any) => n.item ?? n.question);
  await page.getByTestId(`ss-in-open-item-${firstItem.node}`).click();
  await expect(ins).toHaveAttribute('data-kind', 'ITEM');
  await expect(ins).toHaveAttribute('data-loaded', 'true');
  await page.keyboard.press('Escape');
  await expect(ins).toHaveCount(0);
  await expect(home).toHaveAttribute('data-view', 'blocks'); // 15: the view the reader came from

  // ---- 14. reuse through the existing workflow: the chosen survey opens with its library on this exact block
  await page.getByTestId(`ss-ws-block-MODULE-${target.code}-${target.version}`).click();
  await expect(ins).toHaveAttribute('data-loaded', 'true');
  await page.getByTestId('ss-in-reuse').click();
  const mine = surveys.find((s) => !s.open_candidate_status)!;
  await page.getByTestId(`ss-in-reuse-${mine.code}`).click();
  await expect(page).toHaveURL(new RegExp(`/survey-studio/surveys/${mine.code}`));
  await expect(page.getByTestId('ss-library-source')).toBeVisible();
  await expect(page.getByTestId('ss-library-add')).toBeVisible(); // the existing "Add to this survey"
  await expect(page.getByTestId('ss-library-copy')).toBeVisible(); // … and "Edit a copy for this survey": a new draft, never the published one
  await page.screenshot({ path: `${SHOTS}/UXHOME10-reuse-through-the-existing-library.png` });
  expect((await get(author, `/api/v1/survey-definitions/${mine.id}`)).draft_revision).toBe(mine.draft_revision); // nothing was changed by looking
  // ---- 15. back to the workspace, to the view and the inspector the reader left
  await page.goBack();
  await expect(home).toHaveAttribute('data-view', 'blocks');
  await expect(ins).toHaveAttribute('data-code', target.code);
  await page.getByTestId('ss-in-close').click();

  // ---- 16. browse Surveys; open an existing published survey: an overview before any editor
  await nav(page).getByRole('link', { name: 'Surveys', exact: true }).click();
  await expect(home).toHaveAttribute('data-view', 'surveys');
  await expect(page.getByTestId('ss-ws-surveys-view').locator('ul.ss-ws-grid > li')).toHaveCount(surveys.length);
  await page.getByTestId('ss-ws-layout-list').click();
  await expect(page.getByTestId('ss-ws-surveys-table').locator('tbody tr')).toHaveCount(surveys.length);
  await page.getByTestId('ss-ws-layout-grid').click();
  await page.getByTestId('ss-ws-surveys-published').click();
  const publishedSurveys = surveys.filter((x) => x.latest_version_label);
  await expect(page.getByTestId('ss-ws-surveys-view').locator('ul.ss-ws-grid > li')).toHaveCount(publishedSurveys.length);
  await page.screenshot({ path: `${SHOTS}/UXHOME11-surveys-gallery.png`, fullPage: true });
  const consumer = publishedSurveys.find((x) => x.code === detail.published_in[0].survey_code)!;
  const facts = ws.surveys.find((x: any) => x.survey_code === consumer.code);
  await page.getByTestId(`ss-ws-survey-${consumer.code}`).click();
  const so = page.getByTestId('ss-survey-overview');
  await expect(so).toHaveAttribute('data-loaded', 'true');
  await expect(so).toContainText(`${facts.modules} module`);
  await expect(page.getByTestId('ss-so-structure').locator('ol > li')).toHaveCount(facts.modules);
  for (const id of [`ss-so-open-${consumer.code}`, 'ss-so-version', 'ss-so-governance']) await expect(page.getByTestId(id)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/UXHOME12-survey-overview-before-editing.png` });
  // a module of the survey is inspected from the survey
  await so.locator('[data-testid^="ss-so-inspect-"]').first().click();
  await expect(ins).toHaveAttribute('data-kind', 'MODULE');
  await expect(ins).toHaveAttribute('data-loaded', 'true');
  await page.getByTestId('ss-in-close').click();
  await expect(so).toBeVisible(); // … and closing it returns to the survey
  await page.getByTestId('ss-so-version').click();
  await expect(page).toHaveURL(new RegExp(`/survey-studio/surveys/${consumer.code}/versions/`)); // the existing published-version screen

  // ---- 23. existing deep links keep working, and the sidebar knows where they are
  for (const [path, crumb, item] of [[`/survey-studio/surveys/${consumer.code}`, 'Design & Govern', 'Surveys'], ['/survey-studio/assignment', 'Design & Govern', 'Survey bindings and groups'], ['/survey-studio/journeys', 'Simulate & Analyze', 'Application journeys'], ['/survey-studio/controls', 'Simulate & Analyze', 'Controls and evidence']] as const) {
    await page.goto(path);
    await expect(page.getByTestId('app-crumb')).toContainText(crumb);
    await expect(nav(page).getByRole('link', { name: item, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await page.goto(`/survey-studio?inspect=MODULE~${target.code}~${target.version}`); // a link straight to a block
  await expect(ins).toHaveAttribute('data-code', target.code);
  await author.context.close();

  // ============ the consolidated platform, as one person who may read across it ============
  const all = await session(browser, 'survey_platform', '/survey-studio');
  const p2 = all.page;
  await expect(p2.getByTestId('ss-saved-home')).toHaveAttribute('data-loaded', 'true');
  await p2.screenshot({ path: `${SHOTS}/UXHOME13-consolidated-sidebar.png` });

  // ---- 17. the Rules Explorer opens an Assignment Rule in its authoritative screen
  await nav(p2).getByRole('link', { name: 'Rules explorer' }).click();
  await expect(p2.getByTestId('ss-rx')).toHaveAttribute('data-family', 'assignment');
  const policy = await get(all, '/api/v1/survey-assignment/policy');
  const inEffect = policy.rules.filter((r: any) => r.effective_now);
  await expect(p2.getByTestId('ss-rx-assignment').locator('> li')).toHaveCount(inEffect.length);
  const bound = inEffect.find((r: any) => r.published_binding);
  await expect(p2.getByTestId(`ss-rx-rule-${bound.rule_code}`)).toContainText(policy.bindings.find((b: any) => b.id === bound.published_binding).survey_name);
  await p2.screenshot({ path: `${SHOTS}/UXHOME14-rules-explorer.png`, fullPage: true });
  for (const [family, list] of [['groups', 'ss-rx-groups'], ['logic', 'ss-rx-conditions'], ['applicability', 'ss-rx-applicability'], ['mappings', 'ss-rx-mappings']] as const) { await p2.getByTestId(`ss-rx-family-${family}`).click(); await expect(p2.getByTestId(list)).toBeVisible(); }
  const mappings = (await get(all, '/api/v1/survey-evaluation/mappings')).items.filter((m: any) => m.status === 'PUBLISHED');
  await expect(p2.getByTestId('ss-rx-mappings').locator('> li')).toHaveCount(mappings.length);
  // 10 (again): a reusable condition, from the rules explorer, in the inspector
  const cond = conditions.find((c) => c.is_latest);
  if (cond) {
    await p2.getByTestId('ss-rx-family-logic').click();
    await expect(p2.getByTestId(`ss-rx-condition-${cond.code}`)).toContainText('Met when');
    await p2.getByTestId(`ss-rx-condition-${cond.code}`).getByRole('button', { name: 'Inspect the condition' }).click();
    await expect(p2.getByTestId('ss-inspector')).toHaveAttribute('data-kind', 'CONDITION');
    await expect(p2.getByTestId(`ss-in-condition-${cond.code}`)).toContainText('is met when');
    await p2.getByTestId('ss-inspector').screenshot({ path: `${SHOTS}/UXHOME15-a-reusable-condition-inspected.png` });
    await p2.getByTestId('ss-in-close').click();
  }
  await p2.getByTestId('ss-rx-family-assignment').click();
  await p2.getByTestId(`ss-rx-rule-${bound.rule_code}`).getByRole('link', { name: 'Open the rule in Assignment Rules' }).click();
  await expect(p2).toHaveURL(new RegExp(`/assignment-rules/${bound.rule_code}`)); // the authoritative rule screen
  await expect(p2.getByTestId('app-crumb')).toContainText('Assignment Rules');

  // ---- 18. the authoritative Finding Rules editor, from the rules explorer and from the sidebar
  await p2.goto('/survey-studio/rules?family=findings');
  await expect(p2.getByTestId('ss-rx-findings')).toBeVisible();
  await p2.getByTestId('ss-rx-findings').getByRole('link', { name: 'Open it in Finding Rules' }).first().click();
  await expect(p2).toHaveURL(/\/finding-rules/);
  await expect(nav(p2).getByRole('link', { name: 'Finding Rules', exact: true })).toHaveAttribute('aria-current', 'page');

  // ---- 19, 20. Simulation & Evaluation: one page for every simulator and evaluation screen
  await nav(p2).getByRole('link', { name: 'Simulation & Evaluation', exact: true }).click();
  await expect(p2.getByTestId('ss-hub')).toBeVisible();
  for (const id of ['ss-hub-simulator', 'ss-hub-coordinated', 'ss-hub-journeys', 'ss-hub-evaluation', 'ss-hub-assurance', 'ss-hub-scripts']) await expect(p2.getByTestId(id)).toBeVisible();
  await p2.screenshot({ path: `${SHOTS}/UXHOME16-simulation-and-evaluation.png`, fullPage: true });
  const journeys = (await get(all, '/api/v1/survey-evaluation/journeys')).items as any[];
  const co = journeys.find((j) => j.kind === 'COORDINATED');
  await p2.getByTestId(`ss-hub-co-${co.id}`).click(); // 19: a coordinated simulation
  await expect(p2.getByTestId('ss-co')).toHaveAttribute('data-coordinated', co.id);
  await p2.goBack();
  await p2.getByTestId('ss-hub-open-controls').click(); // 20: control evaluation's policies and evidence
  await expect(p2.getByTestId('ss-cb')).toBeVisible();
  await nav(p2).getByRole('link', { name: 'Application journeys' }).click(); // 20: application journeys
  await expect(p2.getByTestId('ss-jr-list')).toBeVisible();
  await p2.getByTestId(`ss-jr-row-${co.id}`).getByRole('link').click();
  await expect(p2.getByTestId('ss-jr')).toHaveAttribute('data-journey', co.id);
  await p2.goto('/survey-studio/simulation');
  await p2.getByTestId('ss-hub-open-simulator').click(); // the script engine's workbench: a separate mode
  await expect(p2.getByRole('heading', { name: 'Simulation Workbench', level: 1 })).toBeVisible();

  // ---- 21. the operational Review Workbench, separately
  await nav(p2).getByRole('link', { name: 'Review Workbench' }).click();
  await expect(p2.getByRole('heading', { name: 'Review Workbench', level: 1 })).toBeVisible();
  await expect(p2.getByTestId('app-crumb')).toContainText('Operations');
  // ---- 22. legacy Script Studio, with an authorised identity
  await nav(p2).getByRole('link', { name: 'Script Studio' }).click();
  await expect(p2).toHaveURL(/\/scripts$/);
  await expect(p2.getByTestId('app-crumb')).toContainText('Legacy & Administration');
  await expect(p2.getByRole('heading', { name: 'Script Studio', level: 1 })).toBeVisible();
  // keyboard: the section toggle opens and closes with the keyboard, and says what it does
  const toggle = p2.getByTestId('nav-toggle-SurveyStudio');
  await toggle.focus();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await p2.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(nav(p2).getByRole('link', { name: 'Building blocks' })).toBeVisible();
  await all.context.close();

  // ---- 24. permission-restricted actions are unavailable, and denied by the server
  const reader = await session(browser, 'survey_reader', '/survey-studio', { width: 1280, height: 800 });
  const p3 = reader.page;
  await expect(p3.getByTestId('ss-saved-home')).toHaveAttribute('data-loaded', 'true');
  await expect(p3.getByTestId('ss-read-only')).toBeVisible();
  for (const id of ['ss-create', 'ss-ws-new-block', 'ss-open-assignment', 'ss-open-controls', 'ss-open-journeys']) await expect(p3.getByTestId(id)).toHaveCount(0);
  await expect(nav(p3).getByRole('link', { name: 'Survey bindings and groups' })).toHaveCount(0); // not listed for a person who may not open it
  await p3.screenshot({ path: `${SHOTS}/UXHOME17-workspace-1280-reader.png`, fullPage: true });
  await p3.getByTestId('ss-ws-view-blocks').click();
  await expect(p3.getByTestId('ss-ws-new-of-kind')).toHaveCount(0);
  await p3.getByTestId(`ss-ws-block-MODULE-${target.code}-${target.version}`).click();
  await expect(p3.getByTestId('ss-inspector')).toHaveAttribute('data-loaded', 'true');
  await expect(p3.getByTestId('ss-in-read-only')).toBeVisible();
  for (const id of ['ss-in-reuse', 'ss-in-test-action', 'ss-in-open-builder']) await expect(p3.getByTestId(id)).toHaveCount(0);
  await expect(p3.getByTestId('ss-in-steps').locator('> li')).toHaveCount(doc.nodes.length); // … and still reads everything
  await p3.screenshot({ path: `${SHOTS}/UXHOME18-inspector-1280-reader.png` });
  expect((await p3.request.get('/api/v1/survey-assignment/policy')).status()).toBe(403);
  expect((await p3.request.get('/api/v1/survey-evaluation/journeys')).status()).toBe(403);
  await p3.goto('/assignment-rules'); // a route the reader may not open stays guarded
  await expect(p3).toHaveURL(/\/unauthorized|\/assignment-rules/);
  await expect(p3.getByText(/do not have|restricted|not authori/i).first()).toBeVisible();
  await reader.context.close();

  // ---- 25. another market: nothing of this market is disclosed, in the workspace or by address
  const other = await session(browser, 'survey_elsewhere', '/survey-studio');
  const p4 = other.page;
  await expect(p4.getByTestId('ss-saved-home')).toHaveAttribute('data-loaded', 'true');
  await expect(p4.getByTestId('ss-ws-count-surveys')).toHaveAttribute('data-count', '0');
  await expect(p4.getByTestId('ss-ws-count-MODULE')).toHaveAttribute('data-count', '0');
  await expect(p4.getByTestId('ss-no-surveys')).toBeVisible();
  await expect(p4.getByTestId('ss-ws-preview-none')).toBeVisible();
  await p4.getByTestId('ss-ws-search').fill(target.title);
  await expect(p4.getByTestId('ss-ws-results')).toHaveAttribute('data-count', '0');
  await p4.goto(`/survey-studio?inspect=MODULE~${target.code}~${target.version}`);
  await expect(p4.getByTestId('ss-in-error')).toContainText('not published in a market you can read');
  expect(await p4.getByTestId('ss-inspector').textContent()).not.toContain(detail.title);
  await other.context.close();

  // ---- 26. a narrower window: the workspace and the inspector
  const narrow = await session(browser, 'survey_simulator', '/survey-studio', { width: 900, height: 1000 });
  const p5 = narrow.page;
  await expect(p5.getByTestId('ss-saved-home')).toHaveAttribute('data-loaded', 'true');
  expect(await p5.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); // nothing overflows sideways
  await p5.screenshot({ path: `${SHOTS}/UXHOME19-workspace-900.png`, fullPage: true });
  await p5.getByTestId('ss-ws-view-blocks').click();
  await p5.getByTestId(`ss-ws-block-MODULE-${target.code}-${target.version}`).click();
  await expect(p5.getByTestId('ss-inspector')).toHaveAttribute('data-loaded', 'true');
  await expect(p5.getByTestId('ss-in-test-action')).toBeVisible(); // a simulator may test it
  await p5.getByTestId('ss-in-tab-test').click();
  await expect(p5.getByTestId(`ss-in-test-${detail.published_in[0].survey_code}`)).toBeVisible();
  await p5.screenshot({ path: `${SHOTS}/UXHOME20-inspector-900.png` });
  await p5.getByTestId(`ss-in-test-${detail.published_in[0].survey_code}`).click(); // the existing simulator, the authoritative engine
  await expect(p5).toHaveURL(new RegExp(`/survey-studio/surveys/${detail.published_in[0].survey_code}/simulate`));
  await narrow.context.close();
});
