import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// (Named to run last.) LIB-2 — a reusable module authored ON ITS OWN, full stack: Chromium → Vite → FastAPI →
// PostgreSQL (the isolated test schema), with standalone-module authoring switched on. The numbers in the comments are
// the owner's twenty required demonstrations. Nothing here creates a survey in order to author the module: the two
// surveys of steps 13–15 are the CONSUMERS that reuse it after it is published. Synthetic content only.
const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = 'test-results/persisted/shots';
const ORIGIN = 'http://127.0.0.1:5174';
type Who = 'survey_moduleauthor' | 'survey_checker' | 'survey_publisher' | 'survey_reader' | 'survey_elsewhere' | 'survey_everything';
const account = (who: Who): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'))[who];
/* eslint-disable @typescript-eslint/no-explicit-any */
type S = { context: BrowserContext; page: Page };
async function session(browser: Browser, who: Who, path = '/', viewport = { width: 1440, height: 900 }): Promise<S> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signIn(page, account(who), path);
  return { context, page };
}
const shot = async (page: Page, name: string, full = false) => { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
const pick = async (page: Page, text: string | RegExp) => page.getByRole('option', { name: text }).first().click();
const typeQuestion = async (card: Locator, text: string) => { const box = card.locator('.ss-q-text textarea').first(); await box.fill(text); await box.blur(); };
const save = async (page: Page) => {
  await page.getByTestId('ss-save').click();
  await expect(page.getByTestId('ss-save-status')).not.toHaveAttribute('data-state', 'saving');
  const state = await page.getByTestId('ss-save-status').getAttribute('data-state');
  expect(state, state === 'failed' ? (await page.getByTestId('ss-save-error').textContent()) ?? '' : '').toBe('saved');
};
const csrf = async (context: BrowserContext) => ({ 'X-CSRF-Token': (await context.cookies()).find((c) => c.name === 'c360_csrf')!.value, Origin: ORIGIN });
const get = async (s: S, path: string) => (await s.page.request.get(path)).json();
const post = async (s: S, path: string, data: unknown = {}) => s.page.request.post(path, { data, headers: await csrf(s.context) });
const options = async (page: Page, id: string, labels: string[]) => { const add = page.getByTestId(`ss-option-new-${id}`); for (const l of labels) { await add.fill(l); await add.press('Enter'); } };
const OPERATIONAL = ['callback_case', 'contact_attempt', 'conversation_session', 'finding'] as const;
/** Operational records, counted through the product's own reads: none may come into being anywhere in this journey. */
const operational = async (s: S) => ({ surveys: ((await get(s, '/api/v1/survey-definitions')).items as any[]).length });

/** The whole real workflow on a saved draft — a module's or a survey's: submit, a checker approves, a publisher publishes. */
async function publish(browser: Browser, author: S, base: string, note: string, shots?: string) {
  const page = author.page;
  await page.goto(`${base}/review`);
  await expect(page.getByTestId('ss-submit-validation')).toContainText('No blocker');
  await page.getByTestId('ss-ack-reason-SYNTHETIC_WORDING_UNAPPROVED').fill('Synthetic wording for the LIB-2 journey; never used on a call.');
  await page.getByTestId('ss-submit-note').fill(note);
  if (shots) await shot(page, `${shots}a-submit-for-review`, true);
  await page.getByTestId('ss-submit').click();
  await expect(page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'IN_REVIEW');
  const candidate = new URL(page.url()).pathname;
  const checker = await session(browser, 'survey_checker', candidate);
  await checker.page.getByTestId('ss-approve').click();
  await expect(checker.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'APPROVED');
  if (shots) await shot(checker.page, `${shots}b-approved-by-a-second-person`);
  await checker.context.close();
  const publisher = await session(browser, 'survey_publisher', candidate);
  await publisher.page.getByTestId('ss-publish').click();
  await expect(publisher.page.getByTestId('ss-version')).toHaveAttribute('data-status', 'PUBLISHED');
  if (shots) await shot(publisher.page, `${shots}c-published-by-a-third-person`);
  const label = await publisher.page.getByTestId('ss-version').getAttribute('data-label');
  await publisher.context.close();
  return { label, candidate };
}

const NAME = 'Premium affordability check';
const Q1 = 'Did your representative explain how much the premium is?';
const Q2 = 'How do you pay your premium?';
const Q3 = 'Which of these documents did you receive?';
const Q4 = 'If your income fell, could you keep paying this premium?';
const Q5 = 'Do you keep a receipt for each cash payment?';
let code = '';
let moduleId = '';
const base = () => `/survey-studio/modules/${code}`;

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

test('LIB-2.1 a module is created, built, saved, reopened and tested on its own — no survey', async ({ browser }) => {
  test.setTimeout(420_000);
  const author = await session(browser, 'survey_moduleauthor', '/survey-studio');
  const page = author.page;
  await expect(page.getByTestId('ss-saved-home')).toHaveAttribute('data-loaded', 'true');
  const before = await operational(author);
  const modulesBefore = ((await get(author, '/api/v1/survey-modules')).items as any[]).length;

  // ---- 1. create a module without creating a survey
  await expect(page.getByTestId('ss-ws-new-block')).toHaveText(/Create module/);
  await page.getByTestId('ss-ws-new-block').click();
  await page.getByTestId('ss-module-create-name').fill(NAME);
  await page.getByTestId('ss-module-create-description').fill('Confirms the customer understands and can keep paying the premium');
  await shot(page, 'LIB2-01-create-module-from-the-homepage');
  await page.getByTestId('ss-module-create-go').click();
  await expect(page).toHaveURL(/\/survey-studio\/modules\/M-\d+$/);
  code = new URL(page.url()).pathname.split('/').pop()!;
  const head = page.getByTestId('ss-module-head');
  await expect(head).toHaveAttribute('data-code', code);
  await expect(head).toHaveAttribute('data-state', 'DRAFT');
  await expect(page.getByTestId('ss-module-standing')).toContainText('Not published yet');
  await expect(page.getByTestId('ss-module-empty')).toContainText('no questions yet');
  await expect(page.getByTestId('ss-journey')).toHaveAttribute('data-mode', 'module');
  await expect(page.getByTestId('ss-journey')).not.toContainText('Compose'); // there is no survey to compose
  const mine = ((await get(author, '/api/v1/survey-modules')).items as any[]).find((m) => m.code === code);
  moduleId = mine.id;
  expect(((await get(author, '/api/v1/survey-modules')).items as any[]).length).toBe(modulesBefore + 1);
  expect(await operational(author), 'no survey was created to author the module').toEqual(before);
  expect(((await get(author, '/api/v1/survey-definitions')).items as any[]).some((s) => s.code === code)).toBe(false);
  await shot(page, 'LIB2-02-empty-module-builder');

  // ---- 2. yes/no, single-choice and multi-select questions
  await page.getByTestId('ss-new-YES_NO').click();
  await typeQuestion(page.getByTestId('ss-q-n1'), Q1);
  await page.getByTestId('ss-insert-n1-ANY').click();
  await page.getByTestId('ss-new-SINGLE_SELECT').click();
  await typeQuestion(page.getByTestId('ss-q-n2'), Q2);
  await options(page, 'n2', ['Giro', 'Credit card', 'Cash']);
  await page.getByTestId('ss-insert-n2-ANY').click();
  await page.getByTestId('ss-new-MULTI_SELECT').click();
  await typeQuestion(page.getByTestId('ss-q-n3'), Q3);
  await options(page, 'n3', ['Policy document', 'Benefit illustration', 'Product summary']);

  // ---- 4. a reusable condition deciding a branch; 5. the module's exits
  await page.getByTestId('ss-insert-n3-ANY').click();
  await page.getByTestId('ss-new-DECISION').click();
  await page.getByTestId('ss-d-edit-d1').click();
  await page.getByTestId('ss-cond-field-0-0').selectOption('policy.annual_premium');
  await page.getByTestId('ss-cond-op-0-0').selectOption('GT');
  await page.getByTestId('ss-cond-value-0-0').fill('12000');
  await expect(page.getByTestId('ss-rule-sentence')).toContainText('Annual premium is above 12,000');
  await shot(page, 'LIB2-03-condition-for-a-branch');
  await page.getByTestId('ss-rule-apply').click();
  await page.getByTestId('ss-dest-d1-MATCH').click();
  await page.getByTestId('ss-dest-d1-MATCH-new-YES_NO').click();
  await typeQuestion(page.getByTestId('ss-q-n4'), Q4);
  await page.getByTestId('ss-dest-d1-UNKNOWN').click();
  await pick(page, 'End module: Unable to verify');
  await page.getByTestId('ss-dest-n4-ANY').click();
  await pick(page, 'End module: Completed');

  // ---- 3. different next questions for different answers
  const n2 = page.getByTestId('ss-q-n2');
  await n2.getByRole('radio', { name: 'Different next questions' }).click();
  await page.getByTestId('ss-dest-n2-CASH').click();
  await page.getByTestId('ss-dest-n2-CASH-new-YES_NO').click();
  await typeQuestion(page.getByTestId('ss-q-n5'), Q5);
  for (const o of ['GIRO', 'CREDIT_CARD']) { await page.getByTestId(`ss-dest-n2-${o}`).click(); await pick(page, /Which of these documents/); }
  await page.getByTestId('ss-dest-n5-ANY').click();
  await pick(page, /Which of these documents/);
  const n1 = page.getByTestId('ss-q-n1');
  await n1.getByRole('radio', { name: 'Different next questions' }).click();
  await page.getByTestId('ss-dest-n1-NO').click();
  await pick(page, 'End module: Clarification required');
  await page.getByTestId('ss-dest-n1-YES').click();
  await pick(page, /How do you pay/);
  await expect(page.getByTestId('ss-issues')).toContainText('Routing complete');
  await shot(page, 'LIB2-04-questions-and-branches-guided', true);

  // the live graph of the same module, and the library card it will have
  await page.getByRole('radio', { name: 'Graph' }).click();
  await expect(page.getByTestId('ss-graph-page')).toBeVisible();
  await shot(page, 'LIB2-05-live-graph');
  await page.getByRole('radio', { name: 'Guided' }).click();
  await page.getByTestId('ss-module-card-toggle').click();
  await expect(page.getByTestId('ss-module-card-preview')).toContainText(NAME);
  await expect(page.getByTestId('ss-module-card-preview')).toContainText('5 questions · branches · 3 endings');
  await page.getByTestId('ss-module-head').scrollIntoViewIfNeeded();
  await shot(page, 'LIB2-06-library-card-preview');

  // ---- 6. save, and reopen the draft
  const sent: any[] = [];
  await page.route('**/draft/save', async (r) => { sent.push(r.request().postDataJSON()); await r.continue(); });
  await save(page);
  await page.unroute('**/draft/save');
  expect(sent[0].operations.some((o: any) => o.op === 'SET_DETAILS'), 'a module is named by its own document').toBe(false);
  const draft = await get(author, `/api/v1/survey-definitions/${moduleId}/draft/documents`);
  const doc = draft.assets.find((a: any) => a.kind === 'MODULE');
  expect([doc.code, doc.version, doc.state, doc.owned]).toEqual([code, 1, 'DRAFT', true]);
  expect(draft.content.sequence).toEqual([{ instance: 'module', module: { code, revision: 1 }, routes: Object.fromEntries(doc.document.outcomes.map((o: string) => [o, { survey_outcome: o }])) }]);
  expect(new Set(doc.document.outcomes)).toEqual(new Set(['COMPLETED', 'CLARIFICATION_REQUIRED', 'UNABLE_TO_VERIFY']));
  for (const a of draft.assets) expect(a.code, `${a.kind} ${a.code}`).toMatch(/^(M|Q|S|C|OS)-\d{6,}$/); // every identity is the server's
  expect(draft.assets.filter((a: any) => a.kind === 'CONDITION')).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('ss-module-head')).toHaveAttribute('data-code', code);
  await expect(page.getByTestId('ss-q-n1')).toContainText(Q1);
  await expect(page.getByTestId('ss-save-status')).toHaveAttribute('data-state', 'saved');
  await expect(page.getByTestId('ss-issues')).toContainText('Routing complete');
  // it is listed as a module in progress, not as a block of the library, and not as a survey
  await page.goto('/survey-studio');
  await expect(page.getByTestId(`ss-ws-module-${code}`)).toContainText(NAME);
  await expect(page.getByTestId(`ss-ws-module-${code}`)).toHaveAttribute('data-state', 'DRAFT');
  await shot(page, 'LIB2-07-home-module-in-progress', true);
  expect((await page.request.get(`/api/v1/survey-components/MODULE/${code}/1`)).status()).toBe(404);

  // ---- 7. the standalone module is tested by the Python engine; 8. a branching path and an invalid response
  await page.goto(`${base()}/test`);
  const mt = page.getByTestId('ss-mt');
  await expect(mt).toHaveAttribute('data-status', 'PENDING');
  await expect(mt).toHaveAttribute('data-source', 'WORKING_DRAFT');
  await expect(page.getByTestId('ss-mt-contract')).toContainText('call360.survey.');
  await expect(page.getByTestId('ss-mt-notice')).toContainText('A test, not an approval');
  await expect(page.getByTestId('ss-mt-question')).toHaveText(Q1);
  await shot(page, 'LIB2-08-test-first-question');
  const answer = async (opt: string | string[]) => { for (const o of [opt].flat()) await page.getByTestId(`ss-srv-opt-${o}`).check(); await page.getByTestId('ss-srv-answer').click(); };
  await answer('YES');
  await expect(page.getByTestId('ss-mt-question')).toHaveText(Q2);
  // an invalid response: nothing chosen. The engine refuses it with a stable code and the question stays current.
  await page.getByTestId('ss-srv-answer').click();
  await expect(page.getByTestId('ss-mt-reject')).toHaveAttribute('data-code', 'CHOICE_REQUIRED');
  await expect(page.getByTestId('ss-mt-question')).toHaveText(Q2);
  await shot(page, 'LIB2-09-test-invalid-response-refused');
  // one branch: Cash asks about receipts
  await answer('CASH');
  await expect(page.getByTestId('ss-mt-question')).toHaveText(Q5);
  await shot(page, 'LIB2-10-test-branch-cash');
  // the other branch: take the answer back, and Giro goes straight to the documents
  await page.getByTestId('ss-mt-back').click();
  await expect(page.getByTestId('ss-mt-question')).toHaveText(Q2);
  await answer('GIRO');
  await expect(page.getByTestId('ss-mt-question')).toHaveText(Q3);
  await answer(['POLICY_DOCUMENT', 'PRODUCT_SUMMARY']);
  // the annual premium is not known: the condition cannot be decided, and the module ends as its author routed that
  await expect(page.getByTestId('ss-mt-end')).toHaveAttribute('data-outcome', 'UNABLE_TO_VERIFY');
  await expect(page.getByTestId('ss-srv-trace')).toContainText('cannot be decided');
  await shot(page, 'LIB2-11-test-missing-fact-ends-unable-to-verify');
  // replay: the same facts and answers give the same run
  await page.getByTestId('ss-mt-replay-go').click();
  await expect(page.getByTestId('ss-mt-replay')).toHaveAttribute('data-identical', 'true');
  // with the fact supplied, the condition is met and the affordability question is asked
  await page.getByTestId('ss-mt-fact-policy.annual_premium').fill('20000');
  await page.getByTestId('ss-mt-facts-apply').click();
  await expect(page.getByTestId('ss-mt-question')).toHaveText(Q1);
  await answer('YES'); await answer('GIRO'); await answer(['BENEFIT_ILLUSTRATION']);
  await expect(page.getByTestId('ss-mt-question')).toHaveText(Q4);
  await answer('YES');
  await expect(page.getByTestId('ss-mt-end')).toHaveAttribute('data-outcome', 'COMPLETED');
  await expect(page.getByTestId('ss-mt-delivered')).toContainText(Q4);
  await page.getByTestId('ss-mt-replay-go').click();
  await expect(page.getByTestId('ss-mt-replay')).toHaveAttribute('data-identical', 'true');
  await shot(page, 'LIB2-12-test-condition-met-completed-and-replayed', true);
  // and "No" at the first question leaves by another exit
  await page.getByTestId('ss-mt-restart').click();
  await answer('NO');
  await expect(page.getByTestId('ss-mt-end')).toHaveAttribute('data-outcome', 'CLARIFICATION_REQUIRED');
  // ---- 19. testing recorded nothing: no simulation, no call plan, no survey
  expect(await operational(author)).toEqual(before);
  await author.context.close();
});

test('LIB-2.2 three different people publish it; nobody else can', async ({ browser }) => {
  test.setTimeout(300_000);
  const author = await session(browser, 'survey_moduleauthor', `${base()}/review`);
  const page = author.page;
  // ---- 9. submit — with the card the library will show
  await expect(page.getByTestId('ss-module-review-lead')).toContainText('What publishing this module does');
  await expect(page.getByTestId('ss-module-card-preview')).toContainText(NAME);
  await expect(page.getByTestId('ss-submit-validation')).toContainText('No blocker');
  await page.getByTestId('ss-ack-reason-SYNTHETIC_WORDING_UNAPPROVED').fill('Synthetic wording for the LIB-2 journey; never used on a call.');
  await page.getByTestId('ss-submit-note').fill('First revision of the affordability module');
  await shot(page, 'LIB2-13-review-submit-with-library-card', true);
  await page.getByTestId('ss-submit').click();
  await expect(page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'IN_REVIEW');
  const candidate = new URL(page.url()).pathname;
  const cid = candidate.split('/').pop()!;
  expect(candidate.startsWith(`${base()}/candidates/`)).toBe(true);

  // ---- 10. unauthorised publication is refused: the maker, by the screen and by the server
  await expect(page.getByTestId('ss-you-are-maker')).toBeVisible();
  await expect(page.getByTestId('ss-no-approve')).toBeVisible(); // the author holds neither permission…
  expect((await post(author, `/api/v1/survey-candidates/${cid}/decision`, { verdict: 'APPROVE' })).status()).toBe(403);
  expect((await post(author, `/api/v1/survey-candidates/${cid}/publish`)).status()).toBe(403);
  // …and a person who holds EVERY permission but made nothing still cannot publish what is not approved, nor both approve and publish
  const everything = await session(browser, 'survey_everything', candidate);
  expect((await post(everything, `/api/v1/survey-candidates/${cid}/publish`)).status()).toBe(409);
  await everything.context.close();
  // the author's home says it is waiting for someone else — and offers no step
  await page.goto('/survey-studio');
  await expect(page.getByTestId('ss-ws-waiting')).toContainText(NAME);
  await expect(page.getByTestId('ss-ws-waiting')).toContainText('needs a reviewer');
  await expect(page.getByTestId('ss-ws-waiting')).toContainText('Not your step');
  await expect(page.getByTestId('ss-ws-awaiting')).toHaveCount(0);
  await shot(page, 'LIB2-14-author-home-waiting-for-someone-else', true);
  // the frozen revision is locked in the builder
  await page.goto(base());
  await expect(page.getByTestId('ss-lockbar')).toContainText('Revision 1 has been submitted, so it is frozen');

  // the checker's home says it is waiting for THEM; they approve, and cannot publish
  const checker = await session(browser, 'survey_checker', '/survey-studio');
  const mine = checker.page.getByTestId('ss-ws-awaiting');
  await expect(mine).toContainText(`${NAME}, revision 1`);
  await expect(mine.locator('li[data-what="Module"]')).toHaveAttribute('data-action', 'DECIDE');
  await shot(checker.page, 'LIB2-15-checker-home-waiting-for-you', true);
  await mine.locator('li[data-what="Module"] a').click();
  await expect(checker.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'IN_REVIEW');
  await expect(checker.page.getByTestId('ss-review')).toHaveAttribute('data-mode', 'module');
  await checker.page.getByTestId('ss-approve').click();
  await expect(checker.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'APPROVED');
  await expect(checker.page.getByTestId('ss-no-publish')).toBeVisible();
  expect((await post(checker, `/api/v1/survey-candidates/${cid}/publish`)).status()).toBe(403);
  await shot(checker.page, 'LIB2-16-approved-by-the-checker');
  await checker.context.close();
  expect((await page.request.get(`/api/v1/survey-components/MODULE/${code}/1`)).status(), 'approved is not published').toBe(404);

  // the publisher publishes
  const publisher = await session(browser, 'survey_publisher', '/survey-studio');
  await expect(publisher.page.getByTestId('ss-ws-awaiting').locator('li[data-what="Module"]')).toHaveAttribute('data-action', 'PUBLISH');
  await publisher.page.getByTestId('ss-ws-awaiting').locator('li[data-what="Module"] a').click();
  await publisher.page.getByTestId('ss-publish').click();
  await expect(publisher.page.getByTestId('ss-version')).toHaveAttribute('data-status', 'PUBLISHED');
  await expect(publisher.page.getByTestId('ss-candidate-history')).toContainText('E2E Module Author');
  await expect(publisher.page.getByTestId('ss-candidate-history')).toContainText('E2E Survey Checker');
  await expect(publisher.page.getByTestId('ss-candidate-history')).toContainText('E2E Survey Publisher');
  await shot(publisher.page, 'LIB2-17-published-by-a-third-person', true);
  await publisher.context.close();
  const m = await get(author, `/api/v1/survey-modules/${moduleId}`);
  expect([m.latest_published_revision, m.unpublished_changes, m.open_candidate]).toEqual([1, false, null]);
  await author.context.close();
});

test('LIB-2.3 it is in the gallery and the inspector, and two surveys reuse the exact published revision', async ({ browser }) => {
  test.setTimeout(480_000);
  const author = await session(browser, 'survey_moduleauthor', '/survey-studio?view=blocks');
  const page = author.page;
  const ins = page.getByTestId('ss-inspector');
  const published = await get(author, `/api/v1/survey-components/MODULE/${code}/1`);

  // ---- 11. the module in the Building Blocks gallery
  const card = page.getByTestId(`ss-ws-block-MODULE-${code}-1`);
  await expect(card).toContainText(NAME);
  await expect(card).toContainText('Authored on its own');
  await expect(card).toContainText('5 questions · branches · 3 endings');
  await expect(page.getByTestId('ss-ws-module-drafts')).toHaveCount(0); // nothing is in progress: it is published
  await shot(page, 'LIB2-18-gallery-published-standalone-module', true);

  // ---- 12. the Module Inspector, with the module's own provenance and governance
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(ins).toHaveAttribute('data-loaded', 'true');
  await expect(page.getByTestId('ss-in-provenance')).toHaveAttribute('data-origin', 'MODULE');
  await expect(page.getByTestId('ss-in-provenance')).toContainText('Authored on its own as a reusable module');
  await expect(page.getByTestId('ss-in-provenance')).toContainText('It was not written inside a survey');
  const gov = page.getByTestId('ss-in-governance');
  for (const who of ['E2E Module Author', 'E2E Survey Checker', 'E2E Survey Publisher']) await expect(gov).toContainText(who);
  await expect(page.getByTestId('ss-in-steps').locator('li[data-node]')).toHaveCount(6);
  await expect(page.getByTestId('ss-in-working')).toContainText('No newer revision is being drafted');
  await expect(page.getByTestId('ss-in-where-used')).toContainText('No published survey version pins this revision');
  await shot(page, 'LIB2-19-inspector-standalone-provenance');
  await page.getByTestId('ss-in-tab-logic').click();
  await page.getByTestId('ss-in-logic').scrollIntoViewIfNeeded();
  await shot(page, 'LIB2-20-inspector-logic-graph');
  // keyboard focus stays inside the drawer, and goes back to the card that opened it
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="ss-inspector"]')), `Tab ${i + 1} left the inspector`).toBe(true); }
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="ss-inspector"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(ins).toHaveCount(0);
  await expect(card).toBeFocused();
  // tested on its own from the inspector: the published revision, by the engine
  await card.click();
  await page.getByTestId('ss-in-test-action').click();
  await expect(page).toHaveURL(new RegExp(`/survey-studio/module-tests/${code}/1$`));
  await expect(page.getByTestId('ss-mt')).toHaveAttribute('data-source', 'PUBLISHED_REVISION');
  await expect(page.getByTestId('ss-mt-question')).toHaveText(Q1);
  await shot(page, 'LIB2-21-published-module-tested-on-its-own');

  // ---- 13. reused in two different surveys; 14. each pins the exact published revision
  const pins: Array<{ code: string; versionId: string; content: string; manifest: string }> = [];
  for (const [i, s] of [['S-LIB2-CONSUMER-ONE', 'Affordability callback (one)'], ['S-LIB2-CONSUMER-TWO', 'Affordability callback (two)']].entries()) {
    const [sCode, sName] = s as [string, string];
    await page.goto('/survey-studio');
    await page.getByTestId('ss-create').click();
    await page.getByTestId('ss-create-name').fill(sName);
    await page.getByTestId('ss-create-code').fill(sCode);
    await page.getByTestId('ss-create-go').click();
    await expect(page).toHaveURL(new RegExp(`/surveys/${sCode}$`));
    if (i === 0) {
      // discovered in the composer's own library, inspected, and added
      await page.getByTestId('ss-library-open').click();
      await page.getByTestId('ss-library-tab-MODULE').click();
      await page.getByTestId('ss-library-search').fill('affordability');
      const row = page.getByTestId(`ss-library-row-${code}-1`);
      await expect(row).toContainText('published on its own, release 1.0');
      await row.click();
      await expect(page.getByTestId('ss-library-module-preview')).toContainText(Q2);
      await expect(page.getByTestId('ss-library-sha')).toHaveAttribute('title', published.sha256);
      await shot(page, 'LIB2-22-survey-composer-library-finds-the-module');
    } else {
      // from the inspector: "Reuse in a survey" opens that survey's library on the block
      await page.goto(`/survey-studio?view=blocks&inspect=MODULE~${code}~1`);
      await expect(ins).toHaveAttribute('data-loaded', 'true');
      await page.getByTestId('ss-in-reuse').click();
      await page.getByTestId(`ss-in-reuse-${sCode}`).click();
      await expect(page.getByTestId('ss-library-title')).toContainText(NAME);
    }
    await page.getByTestId('ss-library-add').click();
    await expect(page.getByTestId('ss-library-done')).toContainText('pinned at revision 1');
    await page.getByTestId('ss-library-close').click();
    const instance = 'mi-premium-affordability-check';
    await expect(page.getByTestId(`ss-open-${instance}`)).toBeVisible();
    // survey-level placement: where each ending of the module leads is the SURVEY author's decision
    for (const o of ['CLARIFICATION_REQUIRED', 'UNABLE_TO_VERIFY']) {
      await page.getByTestId(`ss-route-${instance}-${o}`).click();
      await pick(page, o === 'CLARIFICATION_REQUIRED' ? /End the call: Clarification required/ : /End the call: Unable to verify/);
    }
    if (i === 0) await shot(page, 'LIB2-23-survey-places-the-module-and-routes-its-endings', true);
    await save(page);
    const sid = ((await get(author, '/api/v1/survey-definitions')).items as any[]).find((x) => x.code === sCode).id;
    const d = await get(author, `/api/v1/survey-definitions/${sid}/draft/documents`);
    const pinned = d.assets.find((a: any) => a.kind === 'MODULE');
    expect([pinned.code, pinned.version, pinned.sha256, pinned.state, pinned.owned]).toEqual([code, 1, published.sha256, 'FROZEN', false]);
    // the shared module is locked in this survey; "Edit a copy" is still how a survey changes it for itself
    await page.getByTestId(`ss-open-${instance}`).click();
    await expect(page.getByTestId('ss-lockbar')).toContainText('cannot be changed here');
    await expect(page.getByTestId('ss-derive')).toBeVisible();
    const { label } = await publish(browser, author, `/survey-studio/surveys/${sCode}`, `Reuses ${NAME}`);
    expect(label).toBe('1.0');
    const h = await get(author, `/api/v1/survey-definitions/${sid}/history`);
    const vid = h.versions.at(-1).id;
    const v = await get(author, `/api/v1/survey-versions/${vid}/content`);
    const entry = v.manifest.find((e: any) => e.kind === 'MODULE');
    expect([entry.code, entry.version, entry.sha256]).toEqual([code, 1, published.sha256]);
    pins.push({ code: sCode, versionId: vid, content: v.content_sha256, manifest: v.manifest_sha256 });
  }
  const used = await get(author, `/api/v1/survey-components/MODULE/${code}/1`);
  expect(used.used_by).toEqual({ surveys: 2, versions: 2 });
  await page.goto(`/survey-studio?view=blocks&inspect=MODULE~${code}~1`);
  await expect(ins).toHaveAttribute('data-loaded', 'true');
  await expect(page.getByTestId('ss-in-meta')).toContainText('Used by 2 surveys');
  for (const p of pins) await expect(page.getByTestId(`ss-in-consumer-${p.code}`)).toContainText('pins revision 1');
  await page.getByTestId('ss-in-tab-where-used').click();
  await shot(page, 'LIB2-24-inspector-two-consuming-surveys');
  // the composed survey is simulated by the existing simulator (a person who may simulate)
  await page.goto(`/survey-studio/surveys/${pins[0]!.code}/simulate`);
  await expect(page.getByTestId('ss-srv')).toHaveAttribute('data-status', 'PENDING');
  await expect(page.getByTestId('ss-srv-question')).toHaveText(Q1);
  await shot(page, 'LIB2-25-composed-survey-simulated');

  // ---- 15. a newer module revision, published, changes neither survey; 16. the earlier revision stays
  await page.goto(base());
  await page.getByTestId('ss-next-revision').click();
  await expect(page.getByTestId('ss-module-head')).toHaveAttribute('data-revision', '2');
  await expect(page.getByTestId('ss-module-head')).toHaveAttribute('data-state', 'DRAFT');
  // the question it places is published too: changing its wording is a new version of the question, never an edit in place
  await page.getByTestId('ss-change-n1').click();
  await page.getByTestId('ss-new-version').click();
  await typeQuestion(page.getByTestId('ss-q-n1'), 'Did your representative explain the premium and when it is due?');
  await shot(page, 'LIB2-26-revision-two-drafted-from-the-published-one', true);
  await save(page);
  const two = await get(author, `/api/v1/survey-modules/${moduleId}`);
  expect([two.working_revision, two.working_state, two.unpublished_changes, two.latest_published_revision]).toEqual([2, 'DRAFT', true, 1]);
  expect((await page.request.get(`/api/v1/survey-components/MODULE/${code}/2`)).status(), 'a draft revision is not in the library').toBe(404);
  await publish(browser, author, base(), 'Second revision: clearer first question', 'LIB2-27');
  const after = await get(author, `/api/v1/survey-modules/${moduleId}`);
  expect(after.published.map((p: any) => [p.revision, p.status])).toEqual([[1, 'SUPERSEDED'], [2, 'PUBLISHED']]);
  for (const p of pins) {
    const v = await get(author, `/api/v1/survey-versions/${p.versionId}/content`);
    expect([v.content_sha256, v.manifest_sha256], `${p.code} is exactly as it was published`).toEqual([p.content, p.manifest]);
    expect(v.manifest.find((e: any) => e.kind === 'MODULE').version).toBe(1);
  }
  // the consuming survey is TOLD, and nothing is changed for it
  await page.goto(`/survey-studio/surveys/${pins[0]!.code}`);
  await expect(page.getByTestId(`ss-newer-${code}`)).toContainText('Nothing is changed for you');
  await shot(page, 'LIB2-28-consumer-told-of-newer-revision-not-upgraded');
  // both revisions are in the library; the earlier one is inspected and compared, exactly as published
  await page.goto(`/survey-studio?view=blocks&inspect=MODULE~${code}~1`);
  await expect(ins).toHaveAttribute('data-loaded', 'true');
  await expect(page.getByTestId('ss-in-meta')).toContainText('revision 2 is newer');
  await page.getByTestId('ss-in-tab-versions').click();
  await page.getByTestId('ss-in-compare-2').click();
  await expect(page.getByTestId('ss-in-compare')).toContainText('Revision 1 compared with 2');
  await expect(page.getByTestId('ss-in-versions')).toContainText('on its own, release 2.0');
  await shot(page, 'LIB2-29-earlier-revision-still-accessible-and-compared');
  const one = await get(author, `/api/v1/survey-components/MODULE/${code}/1`);
  expect([one.sha256, one.is_latest, one.used_by.surveys]).toEqual([published.sha256, false, 2]);
  expect((await get(author, `/api/v1/survey-components/MODULE/${code}/2`)).used_by.surveys).toBe(0);
  await author.context.close();
});

test('LIB-2.4 markets, permissions, modules written inside surveys, and nothing operational', async ({ browser }) => {
  test.setTimeout(240_000);
  // ---- 17. another market: the module does not exist there, drafted or published
  const elsewhere = await session(browser, 'survey_elsewhere', '/survey-studio?view=blocks');
  await expect(elsewhere.page.getByTestId('ss-saved-home')).toHaveAttribute('data-loaded', 'true');
  await expect(elsewhere.page.getByTestId(`ss-ws-block-MODULE-${code}-1`)).toHaveCount(0);
  expect(((await get(elsewhere, '/api/v1/survey-modules')).items as any[])).toEqual([]);
  expect((await elsewhere.page.request.get(`/api/v1/survey-modules/${moduleId}`)).status()).toBe(404);
  expect((await elsewhere.page.request.get(`/api/v1/survey-components/MODULE/${code}/1`)).status()).toBe(404);
  await elsewhere.page.goto(base());
  await expect(elsewhere.page.getByTestId('ss-missing')).toContainText(`There is no module ${code} that you can open`);
  await shot(elsewhere.page, 'LIB2-30-another-market-cannot-open-the-module');
  expect((await post(elsewhere, '/api/v1/survey-modules', { name: 'Elsewhere module' })).status()).toBe(403);
  await elsewhere.context.close();

  // a reader: may inspect; may not create, edit, test or publish
  const reader = await session(browser, 'survey_reader', '/survey-studio');
  await expect(reader.page.getByTestId('ss-saved-home')).toHaveAttribute('data-loaded', 'true');
  await expect(reader.page.getByTestId('ss-ws-new-block')).toHaveCount(0);
  expect((await post(reader, '/api/v1/survey-modules', { name: 'Reader module' })).status()).toBe(403);
  expect((await post(reader, '/api/v1/survey-module-tests', { module_id: moduleId })).status()).toBe(403);
  await reader.page.goto(`/survey-studio/module-tests/${code}/2`);
  await expect(reader.page.getByTestId('ss-mt-not-permitted')).toContainText('survey.simulate');
  await reader.page.goto(base());
  await expect(reader.page.getByTestId('ss-read-only')).toBeVisible();
  await shot(reader.page, 'LIB2-31-reader-can-open-but-not-change');
  await reader.context.close();

  // ---- 18. modules written inside a survey are as they were: found, inspected, attributed to their survey
  const author = await session(browser, 'survey_moduleauthor', '/survey-studio?view=blocks');
  const page = author.page;
  // (written here the way it always was: a module made INSIDE a survey, reusable once that survey is published)
  await page.goto('/survey-studio');
  await page.getByTestId('ss-create').click();
  await page.getByTestId('ss-create-name').fill('Survey with its own module');
  await page.getByTestId('ss-create-code').fill('S-LIB2-INSIDE');
  await page.getByTestId('ss-create-go').click();
  await page.getByTestId('ss-add-first').click();
  await page.getByTestId('ss-blank-module').click();
  await page.getByTestId('ss-new-module-name').fill('Identity inside a survey');
  await page.getByTestId('ss-new-module-intent').fill('Written inside a survey, as before LIB-2');
  await page.getByTestId('ss-new-module-go').click();
  await page.getByTestId('ss-new-YES_NO').click();
  await typeQuestion(page.getByTestId('ss-q-n1'), 'Are you the person named on this policy?');
  await page.getByTestId('ss-dest-n1-ANY').click();
  await pick(page, 'End module: Completed');
  await expect(page.getByTestId('ss-journey')).toHaveAttribute('data-mode', 'survey');
  await save(page);
  await publish(browser, author, '/survey-studio/surveys/S-LIB2-INSIDE', 'A module written inside a survey');
  const all = (await get(author, '/api/v1/survey-components?kind=MODULE')).items as any[];
  const extracted = all.filter((m) => m.origin?.artifact_kind === 'SURVEY' && m.origin.code === 'S-LIB2-INSIDE' && m.is_latest);
  expect(extracted.length, 'the module written inside the survey is in the library').toBe(1);
  const old = extracted[0];
  expect(old.published_in.every((s: any) => s.artifact_kind === 'SURVEY')).toBe(true);
  await page.goto(`/survey-studio?view=blocks&inspect=MODULE~${old.code}~${old.version}`);
  await expect(page.getByTestId('ss-inspector')).toHaveAttribute('data-loaded', 'true');
  await expect(page.getByTestId('ss-in-provenance')).toHaveAttribute('data-origin', 'SURVEY');
  await expect(page.getByTestId('ss-in-provenance')).toContainText(`Published as part of ${old.published_in[0].survey_name}`);
  await expect(page.getByTestId('ss-in-working')).toHaveCount(0);
  await shot(page, 'LIB2-32-survey-extracted-module-unchanged');
  // …and it too can now be tested on its own, exactly as published
  await page.getByTestId('ss-in-test-action').click();
  await expect(page.getByTestId('ss-mt')).toHaveAttribute('data-source', 'PUBLISHED_REVISION');
  expect(((await get(author, '/api/v1/survey-modules')).items as any[]).some((m) => m.code === old.code), 'it is not turned into a standalone module').toBe(false);

  // ---- 19. a standalone module is never a survey: not listed, not simulated, not planned — and nothing operational exists
  const surveys = (await get(author, '/api/v1/survey-definitions')).items as any[];
  expect(surveys.some((s) => s.code === code)).toBe(false);
  const m = await get(author, `/api/v1/survey-modules/${moduleId}`);
  for (const p of m.published) {
    expect((await post(author, `/api/v1/survey-versions/${p.version_id}/simulations`, { facts: {}, label: 'x' })).status()).toBe(404);
    expect((await post(author, `/api/v1/survey-versions/${p.version_id}/call-plans`, { facts: {} })).status()).toBe(404);
  }
  await page.goto('/survey-studio');
  await expect(page.getByTestId(`ss-survey-${code}`)).toHaveCount(0);
  await expect(page.getByTestId('ss-standing-note')).toContainText('No survey here is eligible for a live call');

  // ---- responsive: the builder and the test at 1280 and 900
  for (const width of [1280, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base());
    await expect(page.getByTestId('ss-module-head')).toBeVisible();
    const wide = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.ss *')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 12).map((e) => `${e.tagName}.${e.className}|${e.dataset.testid ?? ''}|${Math.round(e.getBoundingClientRect().right)}`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `sideways scroll in the builder at ${width}: ${wide.join('  ')}`).toBeLessThanOrEqual(0);
    await shot(page, `LIB2-33-builder-${width}`);
    await page.goto(`${base()}/test`);
    await expect(page.getByTestId('ss-mt-question')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `sideways scroll in the test at ${width}`).toBeLessThanOrEqual(0);
    await shot(page, `LIB2-34-test-${width}`);
    await page.goto('/survey-studio');
    await expect(page.getByTestId('ss-saved-home')).toHaveAttribute('data-loaded', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `sideways scroll on the homepage at ${width}`).toBeLessThanOrEqual(0);
    await shot(page, `LIB2-35-home-${width}`, true);
  }
  void OPERATIONAL;
  await author.context.close();
});
