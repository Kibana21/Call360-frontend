import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// LIB-1 — the reusable component library, full stack: Chromium → Vite → FastAPI → PostgreSQL (isolated test schema),
// with the survey-definition and library settings on. Survey A publishes a module through the real author → checker →
// publisher workflow; another author finds it in the library, previews it, pins it into survey B, and makes an editable
// copy in survey C; published questions, conditions and answer sets are reused on their own; a newer published revision
// is shown as information and changes nothing. Every new identity comes from the server. Synthetic content only.
const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../../../Call360-backend');
const SHOTS = 'test-results/persisted/shots';
const ORIGIN = 'http://127.0.0.1:5174';
const SERVER_CODE = /^(M|Q|S|C|OS)-\d{6,}$/;
type Who = 'survey_author' | 'survey_second' | 'survey_checker' | 'survey_publisher' | 'survey_reader' | 'survey_elsewhere' | 'user';
const account = (who: Who): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'))[who];

const shot = async (page: Page, name: string, full = false) => { await page.waitForTimeout(280); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
const pick = async (page: Page, text: string | RegExp) => page.getByRole('option', { name: text }).first().click();
const typeQuestion = async (card: Locator, text: string) => { const box = card.locator('.ss-q-text textarea').first(); await box.fill(text); await box.blur(); };
const save = async (page: Page) => {
  await page.getByTestId('ss-save').click();
  await expect(page.getByTestId('ss-save-status')).not.toHaveAttribute('data-state', 'saving');
  const state = await page.getByTestId('ss-save-status').getAttribute('data-state');
  expect(state, state === 'failed' ? await page.getByTestId('ss-save-error').textContent() ?? '' : '').toBe('saved');
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type S = { context: BrowserContext; page: Page };
async function session(browser: Browser, who: Who, path = '/'): Promise<S> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, account(who), path);
  return { context, page };
}
const csrf = async (context: BrowserContext) => ({ 'X-CSRF-Token': (await context.cookies()).find((c) => c.name === 'c360_csrf')!.value, Origin: ORIGIN });
const api = async (page: Page, path: string) => (await page.request.get(path)).json();
const post = async (s: S, path: string, data: unknown = {}) => s.page.request.post(path, { data, headers: await csrf(s.context) });
const sidOf = async (page: Page, code: string) => (await api(page, '/api/v1/survey-definitions')).items.find((x: any) => x.code === code).id as string;
const draftOf = async (page: Page, code: string) => api(page, `/api/v1/survey-definitions/${await sidOf(page, code)}/draft/documents`);
const asset = (d: any, kind: string, where: (a: any) => boolean = () => true) => d.assets.find((a: any) => a.kind === kind && where(a));

async function createSurvey(page: Page, name: string, code: string) {
  await page.goto('/survey-studio');
  await page.getByTestId('ss-create').click();
  await page.getByTestId('ss-create-name').fill(name);
  await page.getByTestId('ss-create-code').fill(code);
  await page.getByTestId('ss-create-go').click();
  await expect(page).toHaveURL(new RegExp(`/surveys/${code}$`));
}
async function blankModule(page: Page, name: string, intent: string, first = true) {
  await page.getByTestId(first ? 'ss-add-first' : 'ss-shelf-new-module').click();
  if (first) await page.getByTestId('ss-blank-module').click();
  await page.getByTestId('ss-new-module-name').fill(name);
  await page.getByTestId('ss-new-module-intent').fill(intent);
  await page.getByTestId('ss-new-module-go').click();
}
/** The whole real workflow on a saved draft: the author submits, a checker approves, a publisher publishes. */
async function publish(browser: Browser, author: S, code: string, note: string) {
  await author.page.goto(`/survey-studio/surveys/${code}/review`);
  await expect(author.page.getByTestId('ss-submit-validation')).toContainText('No blocker');
  await author.page.getByTestId('ss-ack-reason-SYNTHETIC_WORDING_UNAPPROVED').fill('Synthetic wording for the library journey; never used on a call.');
  await author.page.getByTestId('ss-submit-note').fill(note);
  await author.page.getByTestId('ss-submit').click();
  await expect(author.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'IN_REVIEW');
  const candidate = author.page.url();
  const checker = await session(browser, 'survey_checker', new URL(candidate).pathname);
  await checker.page.getByTestId('ss-approve').click();
  await expect(checker.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'APPROVED');
  await checker.context.close();
  const publisher = await session(browser, 'survey_publisher', new URL(candidate).pathname);
  await publisher.page.getByTestId('ss-publish').click();
  await expect(publisher.page.getByTestId('ss-version')).toHaveAttribute('data-status', 'PUBLISHED');
  const label = await publisher.page.getByTestId('ss-version').getAttribute('data-label');
  await publisher.context.close();
  return label;
}
const openLibrary = async (page: Page, tab?: 'MODULE' | 'ITEM' | 'CONDITION' | 'OPTION_SET') => {
  await page.getByTestId('ss-library-open').click();
  await expect(page.getByTestId('ss-library')).toBeVisible();
  if (tab) await page.getByTestId(`ss-library-tab-${tab}`).click();
};

const A = 'S-LIB-SOURCE-A', B = 'S-LIB-CONSUMER-B', C = 'S-LIB-COPY-C', D = 'S-LIB-PARTS-D';
test.describe.configure({ mode: 'serial' });

test('LIB-1.1 survey A publishes a module; survey B finds it, previews it and pins the exact revision', async ({ browser }) => {
  test.setTimeout(300_000);
  // ---- survey A: built in the editor, saved under SERVER-ISSUED codes, and published by three people
  const a = await session(browser, 'survey_author');
  await createSurvey(a.page, 'Library source A', A);
  await blankModule(a.page, 'Identity confirmation', 'Confirms the customer is the person who bought the policy');
  await a.page.getByTestId('ss-new-YES_NO').click();
  await typeQuestion(a.page.getByTestId('ss-q-n1'), 'Are you the person named on this policy?');
  await a.page.getByTestId('ss-dest-n1-ANY').click();
  await pick(a.page, 'End module: Completed');
  await save(a.page);
  const aDraft = await draftOf(a.page, A);
  // nothing the editor numbered itself was saved: every asset code is one the server issued
  for (const x of aDraft.assets) expect(x.code, `${x.kind} ${x.code}`).toMatch(SERVER_CODE);
  expect(JSON.stringify(aDraft)).not.toContain('-NEW-');
  expect(aDraft.content.sequence[0].instance).toBe('mi-identity-confirmation'); // survey-local identities are as authored
  const aModule = asset(aDraft, 'MODULE');
  const aItem = asset(aDraft, 'ITEM');

  // before publication the library does not offer it, to anyone
  const b = await session(browser, 'survey_second');
  await createSurvey(b.page, 'Library consumer B', B);
  await openLibrary(b.page, 'MODULE');
  await b.page.getByTestId('ss-library-search').fill('Identity confirmation');
  await expect(b.page.getByTestId('ss-library-empty')).toContainText('No published module matches');
  await shot(b.page, 'LB01-library-nothing-until-published');
  await b.page.getByTestId('ss-library-close').click();
  expect((await b.page.request.get(`/api/v1/survey-components/MODULE/${aModule.code}/1`)).status()).toBe(404);

  expect(await publish(browser, a, A, 'First version of the identity module')).toBe('1.0');

  // ---- survey B: discovery, search, preview
  await openLibrary(b.page, 'MODULE');
  await expect(b.page.getByTestId(`ss-library-row-${aModule.code}-1`)).toContainText('Identity confirmation');
  await expect(b.page.getByTestId(`ss-library-row-${aModule.code}-1`)).toContainText('Published by Library source A · version 1.0');
  await expect(b.page.getByTestId(`ss-library-row-${aModule.code}-1`)).toContainText('used by 1 survey');
  await shot(b.page, 'LB02-library-discovery');
  await b.page.getByTestId('ss-library-search').fill('person who bought');
  await expect(b.page.getByTestId(`ss-library-row-${aModule.code}-1`)).toBeVisible(); // found by its description
  await b.page.getByTestId('ss-library-search').fill('library source');
  await expect(b.page.getByTestId(`ss-library-row-${aModule.code}-1`)).toBeVisible(); // and by the survey that published it
  await b.page.getByTestId('ss-library-search').fill('no such thing anywhere');
  await expect(b.page.getByTestId('ss-library-empty')).toBeVisible();
  await b.page.getByTestId('ss-library-search').fill('identity');
  await shot(b.page, 'LB03-library-search');
  await b.page.getByTestId(`ss-library-row-${aModule.code}-1`).click();
  const preview = b.page.getByTestId('ss-library-preview');
  await expect(preview.getByTestId('ss-library-title')).toContainText('Identity confirmation');
  await expect(preview).toContainText('Confirms the customer is the person who bought the policy');
  await expect(preview.getByTestId('ss-library-module-preview')).toContainText('Are you the person named on this policy?');
  await expect(preview.getByTestId('ss-library-module-preview')).toContainText('Yes / No');
  await expect(preview.getByTestId('ss-library-module-preview')).toContainText('ends the module: completed');
  await expect(preview.getByTestId('ss-library-module-preview')).toContainText('synthetic · unapproved');
  await expect(preview.getByTestId('ss-library-source')).toContainText('Library source A · version 1.0');
  await expect(preview.getByTestId('ss-library-sha')).toHaveAttribute('title', aModule.sha256);
  await shot(b.page, 'LB04-library-preview');

  // ---- add from library: the exact revision, pinned, shared and locked
  await b.page.getByTestId('ss-library-add').click();
  await expect(b.page.getByTestId('ss-library-done')).toContainText('pinned at revision 1');
  await shot(b.page, 'LB05-library-added');
  await b.page.getByTestId('ss-library-close').click();
  await expect(b.page.getByTestId('ss-open-mi-identity-confirmation')).toBeVisible();
  await expect(b.page.locator('.ss-tag', { hasText: 'Shared · v1' }).first()).toBeVisible();
  await expect(b.page.getByTestId('ss-save-status')).toHaveAttribute('data-state', 'unsaved');
  await shot(b.page, 'LB06-composer-shared-module');
  const sent: any[] = [];
  await b.page.route('**/draft/save', async (r) => { sent.push(r.request().postDataJSON()); await r.continue(); });
  await save(b.page);
  await b.page.unroute('**/draft/save');
  expect(sent[0].operations.map((o: any) => o.op), 'only the survey content is sent: the shared module is referenced, never copied').toEqual(['SET_CONTENT']);
  const bDraft = await draftOf(b.page, B);
  const pinned = asset(bDraft, 'MODULE');
  expect([pinned.code, pinned.version, pinned.sha256, pinned.state, pinned.owned]).toEqual([aModule.code, 1, aModule.sha256, 'FROZEN', false]);
  expect(bDraft.assets.every((x: any) => !x.owned)).toBe(true);
  expect(bDraft.assets.map((x: any) => `${x.kind}:${x.code}@${x.version}=${x.sha256}`).sort()).toEqual(aDraft.assets.map((x: any) => `${x.kind}:${x.code}@${x.version}=${x.sha256}`).sort()); // its questions, wording and answers too, by the same identities
  expect(bDraft.content.sequence[0].module).toEqual({ code: aModule.code, revision: 1 });
  // it is locked in the editor; the author still decides when it runs and where it leads
  await b.page.getByTestId('ss-open-mi-identity-confirmation').click();
  await expect(b.page.getByTestId('ss-lockbar')).toContainText('cannot be changed here');
  await shot(b.page, 'LB07-shared-module-locked');
  await b.page.goBack();
  await expect(b.page.getByTestId('ss-rule-mi-identity-confirmation')).toBeEnabled();
  await expect(b.page.getByTestId('ss-route-mi-identity-confirmation-COMPLETED')).toBeEnabled();

  // ---- B is published; both surveys reference the same source revision; the maker of B is B's author only
  expect(await publish(browser, b, B, 'Reuses the identity module of survey A')).toBe('1.0');
  const [aHist, bHist] = [await api(a.page, `/api/v1/survey-definitions/${await sidOf(a.page, A)}/history`), await api(b.page, `/api/v1/survey-definitions/${await sidOf(b.page, B)}/history`)];
  const [aCand, bCand] = [await api(a.page, `/api/v1/survey-candidates/${aHist.candidates[0].id}/documents`), await api(b.page, `/api/v1/survey-candidates/${bHist.candidates[0].id}/documents`)];
  const entry = (c: any) => { const m = c.assets.find((x: any) => x.kind === 'MODULE'); return [m.code, m.version, m.sha256]; };
  expect(entry(bCand)).toEqual(entry(aCand));
  expect(bCand.makers.map((m: any) => m.name)).toEqual(['E2E Second Author']);
  expect(aCand.makers.map((m: any) => m.name)).toEqual(['E2E Survey Author']);
  expect(bCand.manifest_intact && aCand.manifest_intact).toBe(true);
  const row = (await api(b.page, '/api/v1/survey-components?kind=MODULE')).items.find((x: any) => x.code === aModule.code);
  expect(row.used_by).toEqual({ surveys: 2, versions: 2 });
  await b.page.goto(`/survey-studio/surveys/${B}`);
  await openLibrary(b.page, 'MODULE');
  await b.page.getByTestId(`ss-library-row-${aModule.code}-1`).click();
  await expect(b.page.getByTestId('ss-library-usage')).toHaveText('2 surveys · 2 published versions');
  await expect(b.page.getByTestId(`ss-library-row-${aModule.code}-1`)).toContainText('In this survey');
  await shot(b.page, 'LB08-library-usage');
  expect(aItem.code).toMatch(SERVER_CODE);
  await a.context.close();
  await b.context.close();
});

test('LIB-1.2 a newer published revision is information only: survey B is not changed, upgraded or blocked', async ({ browser }) => {
  test.setTimeout(300_000);
  const b0 = await session(browser, 'survey_second');
  const before = await draftOf(b0.page, B);
  const bVersion = (await api(b0.page, `/api/v1/survey-definitions/${await sidOf(b0.page, B)}/history`)).versions[0];
  const bContent = await api(b0.page, `/api/v1/survey-versions/${bVersion.id}/content`);
  await b0.context.close();

  // survey A's author rewords the question (a new version of the module and of the question) and publishes 2.0
  const a = await session(browser, 'survey_author', `/survey-studio/surveys/${A}/modules/mi-identity-confirmation`);
  await a.page.getByTestId('ss-derive').click();
  await a.page.getByTestId('ss-change-n1').click();
  await a.page.getByTestId('ss-new-version').click();
  await typeQuestion(a.page.getByTestId('ss-q-n1'), 'Are you the policyholder named on this policy?');
  await save(a.page);
  const a2 = await draftOf(a.page, A);
  const module2 = asset(a2, 'MODULE', (x) => x.version === 2);
  expect(module2.code, 'a new revision of the survey\'s OWN module keeps its code').toBe(asset(a2, 'MODULE', (x) => x.version === 1).code);
  expect(await publish(browser, a, A, 'Reworded the identity question')).toBe('2.0');
  await a.context.close();

  const b = await session(browser, 'survey_second', `/survey-studio/surveys/${B}`);
  // told, plainly; nothing done for the author
  const notice = b.page.getByTestId('ss-newer-revisions');
  await expect(notice).toContainText('Identity confirmation is pinned at revision 1. Revision 2 has been published.');
  await expect(notice).toContainText('Nothing is changed for you');
  await expect(b.page.getByTestId('ss-save-status')).toHaveAttribute('data-state', 'saved'); // no change was made to the draft
  await shot(b.page, 'LB09-newer-revision-notice');
  await b.page.getByTestId(`ss-newer-see-${module2.code}`).click();
  await expect(b.page.getByTestId('ss-library-title')).toContainText('revision 2');
  await expect(b.page.getByTestId('ss-library-module-preview')).toContainText('Are you the policyholder named on this policy?');
  await b.page.getByTestId('ss-library-compare-1').click();
  await expect(b.page.getByTestId('ss-library-compare')).toContainText('worded differently');
  await expect(b.page.getByTestId('ss-library-compare')).toContainText('Are you the person named on this policy?');
  await expect(b.page.getByTestId('ss-library-compare')).toContainText('Are you the policyholder named on this policy?');
  await shot(b.page, 'LB10-compare-revisions');
  await b.page.getByTestId('ss-library-close').click();
  // exactly as it was: the draft, the pin, the published version
  expect(await draftOf(b.page, B)).toEqual(before);
  expect(await api(b.page, `/api/v1/survey-versions/${bVersion.id}/content`)).toEqual(bContent);
  // the server says the same: information, no blocker, nothing to acknowledge beyond the standing warning
  const v = await (await post(b, `/api/v1/survey-definitions/${await sidOf(b.page, B)}/draft/validate`)).json();
  expect(v.blockers).toBe(0);
  const newer = v.findings.filter((f: any) => f.code === 'NEWER_REVISION_PUBLISHED');
  expect(newer.map((f: any) => f.at)).toContain(`MODULE:${module2.code}@1`); // the module, and the question it rewords
  expect(new Set(newer.map((f: any) => f.severity))).toEqual(new Set(['INFO']));
  await b.page.goto(`/survey-studio/surveys/${B}/validate`);
  await expect(b.page.getByTestId('ss-server-verdict')).toContainText('no blocker');
  await b.context.close();
});

test('LIB-1.3 "Edit a copy for this survey": a local draft with its own server-issued identity; the source is untouched', async ({ browser }) => {
  test.setTimeout(240_000);
  const c = await session(browser, 'survey_second');
  const source = await draftOf(c.page, B); // B still pins revision 1 of A's module
  const src = asset(source, 'MODULE');
  const srcItem = asset(source, 'ITEM');
  await createSurvey(c.page, 'Library copy C', C);
  await openLibrary(c.page, 'MODULE');
  await c.page.getByTestId(`ss-library-row-${src.code}-1`).click(); // revision 1 is still offered, beside revision 2
  await expect(c.page.getByTestId(`ss-library-row-${src.code}-1`)).toContainText('a newer one (2) is published');
  await expect(c.page.getByTestId('ss-library-revisions')).toContainText('Revision 2');
  await c.page.getByTestId('ss-library-copy').click();
  await expect(c.page.getByTestId('ss-library-done')).toContainText('editable copy');
  await shot(c.page, 'LB11-edit-a-copy');
  await c.page.getByTestId('ss-library-close').click();
  await c.page.getByTestId('ss-open-mi-identity-confirmation').click();
  await expect(c.page.getByTestId('ss-lockbar')).toHaveCount(0); // the copy is editable
  await c.page.getByTestId('ss-change-n1').click(); // its question is still the published one, until changed
  await c.page.getByTestId('ss-new-version').click();
  await typeQuestion(c.page.getByTestId('ss-q-n1'), 'Are you the person who signed this application?');
  await shot(c.page, 'LB12-copy-edited');
  await save(c.page);
  const d = await draftOf(c.page, C);
  const mine = asset(d, 'MODULE', (x) => x.owned);
  const myItem = asset(d, 'ITEM', (x) => x.owned);
  // a NEW, server-issued identity; revision 1; provenance back to the source revision
  expect(mine.code).toMatch(SERVER_CODE);
  expect(mine.code).not.toBe(src.code);
  expect([mine.version, mine.state]).toEqual([1, 'DRAFT']);
  expect(mine.document.authoring.derived_from).toMatchObject({ code: src.code, version: 1 });
  expect(myItem.code).toMatch(SERVER_CODE);
  expect([myItem.version, myItem.document.authoring.derived_from.code]).toEqual([1, srcItem.code]);
  expect(asset(d, 'WORDING', (x) => x.code === myItem.code).document.text).toBe('Are you the person who signed this application?');
  expect(d.content.sequence[0].module).toEqual({ code: mine.code, revision: 1 });
  expect(d.assets.filter((x: any) => x.kind === 'MODULE').map((x: any) => x.code)).toEqual([mine.code]); // it no longer pins the source module
  // the published source, and every survey pinned to it, are exactly as they were
  expect(await draftOf(c.page, B)).toEqual(source);
  const lib = (await api(c.page, `/api/v1/survey-components/MODULE/${src.code}/1`));
  expect([lib.sha256, lib.document]).toEqual([src.sha256, src.document]);
  // the copy's maker is the person who made it
  await c.page.goto(`/survey-studio/surveys/${C}/review`);
  await c.page.getByTestId('ss-ack-reason-SYNTHETIC_WORDING_UNAPPROVED').fill('Synthetic wording; a local copy for the library journey.');
  await c.page.getByTestId('ss-submit').click();
  await expect(c.page.getByTestId('ss-maker-names')).toHaveText('E2E Second Author');
  await c.context.close();
});

test('LIB-1.4 published questions, conditions and answer sets are reused on their own, from the same selector', async ({ browser }) => {
  test.setTimeout(300_000);
  // a published survey with conditions, made by three people through the real service (test schema only)
  const source = execFileSync('uv', ['run', 'python', 'scripts/e2e_publish_fixture.py', 'K8', 'Conditions source K', 'e2e.survey.author', 'e2e.survey.checker', 'e2e.survey.publisher'], { cwd: backend, env: { ...process.env, CALL360_ENV_FILE: '.env.test' } }).toString().trim().split('\n').pop()!;
  const d = await session(browser, 'survey_second');
  const k = await draftOf(d.page, source);
  const kCondition = asset(k, 'CONDITION');
  const params = Object.keys(kCondition.document.params ?? {});
  const aItem = asset(await draftOf(d.page, A), 'ITEM', (x) => x.version === 1);
  const yesNo = asset(await draftOf(d.page, A), 'OPTION_SET');

  await createSurvey(d.page, 'Library parts D', D);
  await blankModule(d.page, 'My own checks', 'A module of this survey, built from published parts');
  // ---- a published QUESTION, on its own
  await openLibrary(d.page); // on a module's screen the library opens on Questions
  await expect(d.page.getByTestId('ss-library-tab-ITEM')).toHaveAttribute('aria-selected', 'true');
  await d.page.getByTestId('ss-library-search').fill('person named');
  await d.page.getByTestId(`ss-library-row-${aItem.code}-1`).click();
  await expect(d.page.getByTestId('ss-library-item-preview')).toContainText('Are you the person named on this policy?');
  await expect(d.page.getByTestId('ss-library-item-preview')).toContainText('Yes / No');
  await shot(d.page, 'LB13-library-question-preview');
  await d.page.getByTestId('ss-library-add').click();
  await expect(d.page.getByTestId('ss-library-done')).toContainText('Reuse a question from the library');
  await d.page.getByTestId('ss-library-close').click();
  // the survey's own question first; then the published one is placed before it with the editor's own control
  await d.page.getByTestId('ss-new-YES_NO').click();
  await typeQuestion(d.page.getByTestId('ss-q-n1'), 'Do you still want this policy?');
  await d.page.getByTestId('ss-dest-n1-ANY').click();
  await pick(d.page, 'End module: Completed');
  await d.page.getByTestId('ss-insert-entry').click();
  await d.page.getByTestId('ss-reuse').click();
  await pick(d.page, /Are you the person named on this policy/);
  await expect(d.page.getByTestId('ss-change-n2')).toContainText('Shared'); // pinned and locked, not copied
  await shot(d.page, 'LB13b-published-question-placed');

  // ---- a published ANSWER SET, for the survey's own new question
  await openLibrary(d.page, 'OPTION_SET');
  await d.page.getByTestId(`ss-library-row-${yesNo.code}-1`).click();
  await expect(d.page.getByTestId('ss-library-optionset-preview')).toContainText('Yes');
  await d.page.getByTestId('ss-library-question').selectOption({ label: 'Do you still want this policy?' });
  await shot(d.page, 'LB14-library-answer-set');
  await d.page.getByTestId('ss-library-use').click();
  await expect(d.page.getByTestId('ss-library-done')).toContainText('exactly as published');

  // ---- a published CONDITION, bound with this survey's own values
  await d.page.getByTestId('ss-library-tab-CONDITION').click();
  await d.page.getByTestId(`ss-library-row-${kCondition.code}-1`).click();
  await expect(d.page.getByTestId('ss-library-condition-preview')).toContainText('Unknown');
  await expect(d.page.getByTestId('ss-library-condition-preview')).toContainText('never treated as “not met”');
  for (const p of params) await expect(d.page.getByTestId('ss-library-condition-preview')).toContainText(p);
  await shot(d.page, 'LB15-library-condition-preview');
  await d.page.getByTestId('ss-library-add').click();
  await d.page.getByTestId('ss-library-close').click();
  await d.page.getByTestId('ss-journey-compose').click();
  await d.page.getByTestId('ss-rule-mi-my-own-checks').click();
  await d.page.getByRole('radio', { name: 'Library condition' }).click();
  await d.page.getByTestId('ss-rule-saved').selectOption(`${kCondition.code}@1`);
  await expect(d.page.getByTestId('ss-rule-apply')).toBeDisabled(); // a placement without its values is not valid
  for (const p of params) await d.page.getByTestId(`ss-param-${p}`).fill('15000');
  await d.page.getByTestId('ss-policy-skip').check();
  await shot(d.page, 'LB16-condition-bound-with-own-values');
  await d.page.getByTestId('ss-rule-apply').click();
  await save(d.page);

  const mine = await draftOf(d.page, D);
  const owned = (kind: string) => mine.assets.filter((x: any) => x.kind === kind && x.owned);
  const foreign = (kind: string) => mine.assets.filter((x: any) => x.kind === kind && !x.owned).map((x: any) => x.code);
  expect(foreign('ITEM')).toEqual([aItem.code]); // A's question, pinned
  expect(foreign('CONDITION')).toEqual([kCondition.code]); // K's condition, pinned
  expect(foreign('OPTION_SET')).toEqual([yesNo.code]); // A's answers, pinned once, used by both questions
  expect(owned('OPTION_SET')).toEqual([]);
  const myItem = owned('ITEM')[0];
  expect(myItem.code).toMatch(SERVER_CODE);
  expect(myItem.document.option_set).toEqual({ code: yesNo.code, version: 1 }); // the survey's own question uses the published answers by reference
  expect(owned('MODULE')[0].code).toMatch(SERVER_CODE);
  const eligibility = mine.content.sequence[0].eligibility;
  expect(eligibility.condition).toEqual({ code: kCondition.code, version: 1 });
  expect(Object.keys(eligibility.params).sort()).toEqual([...params].sort());
  expect(eligibility.unknown_policy).toBe('SKIP_WITH_REASON');
  const v = await (await post(d, `/api/v1/survey-definitions/${mine.survey_id}/draft/validate`)).json();
  expect(v.blockers, JSON.stringify(v.findings)).toBe(0);
  // a binding without its value is refused by the SERVER, by a stable code
  const broken = { ...mine.content, sequence: [{ ...mine.content.sequence[0], eligibility: { ...eligibility, params: {} } }] };
  expect((await post(d, `/api/v1/survey-definitions/${mine.survey_id}/draft/save`, { expected_revision: mine.revision, operations: [{ op: 'SET_CONTENT', content: broken }] })).status()).toBe(200);
  const bad = await (await post(d, `/api/v1/survey-definitions/${mine.survey_id}/draft/validate`)).json();
  if (params.length) expect(bad.findings.filter((f: any) => f.severity === 'BLOCKER').map((f: any) => f.code)).toContain('CONDITION_PARAM_MISSING');
  await d.context.close();
});

test('LIB-1.5 the library cannot be bypassed: unpublished, foreign, un-issued and out-of-scope are refused by the server', async ({ browser }) => {
  test.setTimeout(180_000);
  const author = await session(browser, 'survey_author');
  const second = await session(browser, 'survey_second');
  // survey C is a draft with a candidate in review: nothing of it is published
  const c = await draftOf(second.page, C);
  const cModule = asset(c, 'MODULE', (x) => x.owned);
  expect((await author.page.request.get(`/api/v1/survey-components/MODULE/${cModule.code}/1`)).status(), 'not in the library').toBe(404);
  expect((await api(author.page, '/api/v1/survey-components?kind=MODULE')).items.map((x: any) => x.code)).not.toContain(cModule.code);
  // a direct request to pin it into another survey is refused, and nothing is saved
  const a = await draftOf(author.page, A);
  const attempt = { ...a.content, sequence: [...a.content.sequence, { instance: 'mi-stolen', module: { code: cModule.code, revision: 1 }, routes: { COMPLETED: '@CONTINUE' } }] };
  let r = await post(author, `/api/v1/survey-definitions/${a.survey_id}/draft/save`, { expected_revision: a.revision, operations: [{ op: 'SET_CONTENT', content: attempt }] });
  expect([r.status(), (await r.json()).code]).toEqual([422, 'REFERENCE_NOT_PUBLISHED']);
  // adding a revision to another survey's code, or inventing a code, is refused
  r = await post(author, `/api/v1/survey-definitions/${a.survey_id}/draft/save`, { expected_revision: a.revision, operations: [{ op: 'PUT_ASSET', kind: 'MODULE', document: { ...cModule.document, revision: 2 } }] });
  expect([r.status(), (await r.json()).code]).toEqual([409, 'CODE_OWNED_ELSEWHERE']);
  r = await post(author, `/api/v1/survey-definitions/${a.survey_id}/draft/save`, { expected_revision: a.revision, operations: [{ op: 'PUT_ASSET', kind: 'MODULE', document: { ...cModule.document, code: 'M-MADE-UP-BY-A-CLIENT', revision: 1 } }] });
  expect([r.status(), (await r.json()).code]).toEqual([422, 'CODE_NOT_ISSUED']);
  expect((await draftOf(author.page, A)).revision).toBe(a.revision);

  // people: read-only may look and cannot add; no permission and another market see nothing
  const reader = await session(browser, 'survey_reader', `/survey-studio/surveys/${B}`);
  await expect(reader.page.getByTestId('ss-library-open')).toHaveCount(0);
  expect((await reader.page.request.get('/api/v1/survey-components?kind=MODULE')).status()).toBe(200);
  expect((await post(reader, `/api/v1/survey-definitions/${await sidOf(reader.page, B)}/codes`, { requests: [{ kind: 'ITEM', count: 1 }] })).status()).toBe(403);
  const plain = await session(browser, 'user');
  expect((await plain.page.request.get('/api/v1/survey-components?kind=MODULE')).status()).toBe(403);
  const other = await session(browser, 'survey_elsewhere');
  expect((await api(other.page, '/api/v1/survey-components?kind=MODULE')).items).toEqual([]);
  expect((await other.page.request.get(`/api/v1/survey-components/MODULE/${asset(a, 'MODULE').code}/1`)).status()).toBe(404);
  for (const s of [author, second, reader, plain, other]) await s.context.close();
});
