import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// FI-1 — Survey Studio on the real survey-definition API: Chromium → Vite → FastAPI → PostgreSQL (isolated test schema).
// One survey is created, edited in the Guided and Graph views, saved, and read back after a browser restart; two
// sessions collide and resolve explicitly; a save that fails part-way reports no success and changes nothing; the
// server's validation blocks; people without the permission or the market are refused. Synthetic content only.
const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = 'test-results/persisted/shots';
const CODE = 'S-FI-1-WALKTHROUGH';
const SURVEY = `/survey-studio/surveys/${CODE}`;
const MODULE = `${SURVEY}/modules/mi-payment-check`;
type Who = 'survey_author' | 'survey_second' | 'survey_reader' | 'survey_elsewhere' | 'user';
const account = (who: Who): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'))[who];

const shot = async (page: Page, name: string) => { await page.waitForTimeout(250); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const pick = async (page: Page, text: string | RegExp) => page.getByRole('option', { name: text }).first().click();
const typeQuestion = async (card: Locator, text: string) => { const box = card.locator('.ss-q-text textarea').first(); await box.fill(text); await box.blur(); };
const view = (page: Page, name: 'Guided' | 'Graph') => page.getByRole('radio', { name, exact: true }).click();
const status = (page: Page) => page.getByTestId('ss-save-status');
const saved = async (page: Page, revision: number) => { await expect(status(page)).toHaveAttribute('data-state', 'saved'); await expect(page.getByTestId('ss-revision')).toContainText(`Revision ${revision}`); };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function serverDraft(page: Page): Promise<any> {
  const list = await (await page.request.get('/api/v1/survey-definitions')).json();
  const id = list.items.find((s: any) => s.code === CODE).id;
  return (await page.request.get(`/api/v1/survey-definitions/${id}/draft/documents`)).json();
}
const fingerprintOf = (d: any) => ({ revision: d.revision, content: d.content_sha256, assets: d.assets.map((a: any) => `${a.kind}:${a.code}@${a.version}=${a.sha256}`).sort() });
const wordings = (d: any): string[] => d.assets.filter((a: any) => a.kind === 'WORDING').map((a: any) => a.document.text).sort();

async function session(browser: Browser, who: Who, path = '/'): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, account(who), path);
  return { context, page };
}

test.describe.configure({ mode: 'serial' });

test('FI-1.1 create → edit in Guided → edit in Graph → Save → browser restart → identical', async ({ browser }) => {
  test.setTimeout(180_000);
  let { context, page } = await session(browser, 'survey_author');

  // the author holds only survey permissions: Survey Studio is reachable, unrelated Script Studio screens are not
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await page.route('**/api/v1/survey-definitions', async (r) => { await new Promise((ok) => setTimeout(ok, 900)); await r.continue().catch(() => undefined); });
  await nav.getByRole('link', { name: 'Survey Studio' }).click();
  await expect(page.getByTestId('ss-loading')).toBeVisible();
  await shot(page, 'FI01-loading');
  await expect(page.getByTestId('ss-no-surveys')).toBeVisible();
  await page.unroute('**/api/v1/survey-definitions', { behavior: 'ignoreErrors' } as never);
  await expect(page.getByTestId('survey-studio')).toHaveAttribute('data-mode', 'persisted');
  await expect(page.getByTestId('ss-persisted-tag')).toContainText('Saved to Call360');
  await expect(page.getByTestId('ss-standing-note')).toContainText('No survey here is eligible for a live call');
  await expect(page.getByTestId('ss-prototype-tag')).toHaveCount(0);
  await shot(page, 'FI02-list-empty');

  await page.getByTestId('ss-create').click();
  await page.getByTestId('ss-create-name').fill('FI-1 walkthrough');
  await page.getByTestId('ss-create-purpose').fill('Synthetic survey for the FI-1 walkthrough');
  await expect(page.getByTestId('ss-create-code')).toHaveValue(CODE);
  await page.getByTestId('ss-create-go').click();
  await expect(page).toHaveURL(new RegExp(`${SURVEY}$`));
  await saved(page, 0); // created on the server: an empty draft at revision 0

  // ---- Guided: a blank module and two questions
  await page.getByTestId('ss-add-first').click();
  await page.getByTestId('ss-blank-module').click();
  await page.getByTestId('ss-new-module-name').fill('Payment check');
  await page.getByTestId('ss-new-module-kind').selectOption('PRODUCT');
  await page.getByTestId('ss-new-module-intent').fill('Confirms how the premium is paid');
  await page.getByTestId('ss-new-module-go').click();
  await expect(page).toHaveURL(new RegExp(`${MODULE}$`));
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');
  await page.getByTestId('ss-new-YES_NO').click();
  await typeQuestion(page.getByTestId('ss-q-n1'), 'Do you pay your premium by GIRO?');
  await page.getByTestId('ss-q-n1').getByRole('radio', { name: 'Different next questions' }).click();
  await page.getByTestId('ss-dest-n1-YES').click();
  await pick(page, 'End module: Completed');
  await page.getByTestId('ss-dest-n1-NO').click();
  await page.getByTestId('ss-dest-n1-NO-new-YES_NO').click();
  await typeQuestion(page.getByTestId('ss-q-n2'), 'Do you keep a receipt for each payment?');
  await expect(page.getByTestId('ss-revision')).toContainText('since revision 0');
  await shot(page, 'FI03-guided-unsaved');

  // ---- Graph: the same module; a question is changed there
  await view(page, 'Graph');
  await expect(page.getByTestId('ss-graph')).toBeVisible();
  await page.getByTestId('ss-g-node-n2').click();
  const panel = page.getByTestId('ss-g-panel');
  await expect(panel.getByTestId('ss-q-n2')).toBeVisible();
  await panel.locator('.ss-q-text textarea').fill('Do you keep a receipt for every cash payment?');
  await panel.locator('.ss-q-text textarea').blur();
  await expect(page.getByTestId('ss-g-node-n2')).toContainText('every cash payment');
  await shot(page, 'FI04-graph-unsaved');
  expect((await serverDraft(page)).revision, 'nothing is sent before Save: there is no autosave').toBe(0);

  // ---- Save: one request, one revision
  const requests: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/draft/')) requests.push(new URL(r.url()).pathname.split('/draft/')[1]!); });
  await page.getByTestId('ss-save').click();
  await saved(page, 1);
  expect(requests, 'the whole save is one atomic request').toEqual(['save']);
  await expect(page.getByTestId('ss-save')).toBeDisabled();
  await shot(page, 'FI05-graph-saved');
  const before = await serverDraft(page);
  expect(before.revision).toBe(1);
  expect(before.name).toBe('FI-1 walkthrough');
  expect(wordings(before)).toEqual(['Do you keep a receipt for every cash payment?', 'Do you pay your premium by GIRO?']);
  const module = before.assets.find((a: any) => a.kind === 'MODULE');
  expect(module.document.kind).toBe('PRODUCT');
  expect(module.document.authoring).toEqual({ intent: 'Confirms how the premium is paid' });
  expect(module.document.nodes.map((n: any) => n.node)).toEqual(['n1', 'n2']); // node identities as authored
  expect(before.content.sequence.map((i: any) => i.instance)).toEqual(['mi-payment-check']);
  for (const a of before.assets) expect(a.sha256).toMatch(/^[0-9a-f]{64}$/); // the server's own hash of every document

  // ---- a reload of the page shows the saved draft
  await page.reload();
  await saved(page, 1);
  await expect(page.getByTestId('ss-g-node-n2')).toContainText('every cash payment');

  // ---- browser restart: a new browser context, a new sign-in
  await context.close();
  ({ context, page } = await session(browser, 'survey_author', '/survey-studio'));
  await expect(page.getByTestId(`ss-survey-${CODE}`)).toContainText('FI-1 walkthrough');
  await expect(page.getByTestId(`ss-survey-${CODE}`)).toContainText('Revision 1');
  await shot(page, 'FI06-list-after-restart');
  await page.getByTestId(`ss-open-${CODE}`).click();
  await saved(page, 1);
  await page.goto(MODULE);
  await view(page, 'Guided');
  await expect(page.getByTestId('ss-q-n1').locator('.ss-q-text textarea').first()).toHaveValue('Do you pay your premium by GIRO?');
  await expect(page.getByTestId('ss-q-n2').locator('.ss-q-text textarea').first()).toHaveValue('Do you keep a receipt for every cash payment?');
  await expect(page.getByTestId('ss-dest-n1-YES')).toContainText('Completed');
  await saved(page, 1); // opening it changed nothing: nothing to save
  await expect(page.getByTestId('ss-save')).toBeDisabled();
  await shot(page, 'FI07-guided-after-restart');
  const after = await serverDraft(page);
  expect(fingerprintOf(after), 'content and identity are exactly preserved across the restart').toEqual(fingerprintOf(before));
  expect(after.assets.map((a: any) => a.document)).toEqual(before.assets.map((a: any) => a.document));
  await context.close();
});

test('FI-1.2 two sessions: a stale save is refused, nothing is lost, and the resolution is explicit', async ({ browser }) => {
  test.setTimeout(180_000);
  const a = await session(browser, 'survey_author', MODULE);
  const b = await session(browser, 'survey_second', MODULE);
  for (const s of [a, b]) { await view(s.page, 'Guided'); await saved(s.page, 1); }

  await typeQuestion(a.page.getByTestId('ss-q-n1'), 'Do you pay your premium by GIRO each month?');
  await a.page.getByTestId('ss-save').click();
  await saved(a.page, 2);

  await typeQuestion(b.page.getByTestId('ss-q-n2'), 'Do you keep a receipt for every payment made in cash?');
  await b.page.getByTestId('ss-save').click();
  await expect(status(b.page)).toHaveAttribute('data-state', 'conflict');
  await expect(b.page.getByTestId('ss-conflict-summary')).toContainText('revision 1');
  await expect(b.page.getByTestId('ss-conflict-summary')).toContainText('revision 2');
  await expect(b.page.getByTestId('ss-conflict-summary')).toContainText('E2E Survey Author');
  await expect(b.page.getByTestId('ss-conflict-summary')).toContainText('nothing of yours has been lost or sent');
  await expect(b.page.getByTestId('ss-conflict-theirs')).toContainText('Wording');
  await expect(b.page.getByTestId('ss-conflict-mine')).toContainText('Wording');
  await expect(b.page.getByTestId('ss-conflict-both')).toContainText('Nothing');
  await shot(b.page, 'FI08-conflict');
  let server = await serverDraft(b.page);
  expect(server.revision, 'the refused save changed nothing').toBe(2);
  expect(wordings(server)).toEqual(['Do you keep a receipt for every cash payment?', 'Do you pay your premium by GIRO each month?']);

  // deciding later keeps the local work exactly as it is
  await b.page.getByTestId('ss-conflict-keep').click();
  await expect(b.page.getByTestId('ss-conflict')).toHaveCount(0);
  await expect(b.page.getByTestId('ss-q-n2').locator('.ss-q-text textarea').first()).toHaveValue('Do you keep a receipt for every payment made in cash?');
  await expect(status(b.page)).toHaveAttribute('data-state', 'conflict');
  await shot(b.page, 'FI09-conflict-decide-later');

  // explicit, controlled retry: on top of the newer revision
  await b.page.getByTestId('ss-resolve').click();
  await b.page.getByTestId('ss-conflict-ontop').click();
  await saved(b.page, 3);
  server = await serverDraft(b.page);
  expect(server.revision).toBe(3);
  expect(wordings(server), 'both sessions\' changes are there: neither overwrote the other').toEqual(['Do you keep a receipt for every payment made in cash?', 'Do you pay your premium by GIRO each month?']);
  await expect(b.page.getByTestId('ss-q-n1').locator('.ss-q-text textarea').first()).toHaveValue('Do you pay your premium by GIRO each month?'); // the other session's change is now on screen
  await shot(b.page, 'FI10-conflict-resolved');

  // the first session is now the stale one: it chooses to load the newer draft instead
  await typeQuestion(a.page.getByTestId('ss-q-n1'), 'A change that will be discarded on purpose');
  await a.page.getByTestId('ss-save').click();
  await expect(status(a.page)).toHaveAttribute('data-state', 'conflict');
  await a.page.getByTestId('ss-conflict-reload').click();
  await saved(a.page, 3);
  await expect(a.page.getByTestId('ss-q-n2').locator('.ss-q-text textarea').first()).toHaveValue('Do you keep a receipt for every payment made in cash?');
  await expect(a.page.getByTestId('ss-q-n1').locator('.ss-q-text textarea').first()).toHaveValue('Do you pay your premium by GIRO each month?');
  expect((await serverDraft(a.page)).revision).toBe(3);
  await a.context.close();
  await b.context.close();
});

test('FI-1.3 a save that fails part-way, or never arrives, reports no success and changes nothing', async ({ browser }) => {
  test.setTimeout(180_000);
  const { context, page } = await session(browser, 'survey_author', MODULE);
  await view(page, 'Guided');
  await saved(page, 3);
  const start = await serverDraft(page);

  // a new question: several documents in one save (answers, item, wording, module)
  await page.getByTestId('ss-q-n2').getByRole('radio', { name: 'Different next questions' }).first().click();
  await page.getByTestId('ss-dest-n2-YES').click();
  await page.getByTestId('ss-dest-n2-YES-new-YES_NO').click();
  await typeQuestion(page.getByTestId('ss-q-n3'), 'Is the receipt in your own name?');
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');

  // the server refuses the LAST operation of the save: everything before it must be rolled back
  let sent = 0;
  await page.route('**/draft/save', async (r) => {
    const body = r.request().postDataJSON();
    sent = body.operations.length;
    body.operations.push({ op: 'PUT_ASSET', kind: 'MODULE', document: { schema: 'call360.survey.module/9', code: 'M-BROKEN', revision: 1 } });
    await r.continue({ postData: JSON.stringify(body) });
  });
  await page.getByTestId('ss-save').click();
  await expect(status(page)).toHaveAttribute('data-state', 'failed');
  expect(sent, 'the save held several good operations before the refused one').toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('ss-save-error')).toContainText('Not saved');
  await expect(page.getByTestId('ss-save-error')).toContainText('DOCUMENT_INVALID');
  await expect(page.getByTestId('ss-save-error')).toContainText('Nothing was changed on the server');
  await shot(page, 'FI11-save-failed');
  expect(fingerprintOf(await serverDraft(page)), 'no part of the failed save was kept').toEqual(fingerprintOf(start));
  await expect(page.getByTestId('ss-q-n3').locator('.ss-q-text textarea').first()).toHaveValue('Is the receipt in your own name?'); // the work is still here
  await page.unroute('**/draft/save');

  // the request never reaches the server
  await page.route('**/draft/save', (r) => r.abort('connectionfailed'));
  await page.getByTestId('ss-save').click();
  await expect(page.getByTestId('ss-save-error')).toContainText('could not be reached');
  expect((await serverDraft(page)).revision).toBe(3);
  await page.unroute('**/draft/save');

  // the reply is lost AFTER the server saved: trying again must not apply it twice
  await page.route('**/draft/save', async (r) => { await r.fetch(); await r.abort('connectionfailed'); });
  await page.getByTestId('ss-save').click();
  await expect(status(page)).toHaveAttribute('data-state', 'failed');
  expect((await serverDraft(page)).revision, 'the server did save it').toBe(4);
  await page.unroute('**/draft/save');
  let resent = 0;
  page.on('request', (r) => { if (r.url().endsWith('/draft/save')) resent += 1; });
  await page.getByTestId('ss-save').click();
  await saved(page, 4);
  expect(resent, 'recognised as already saved: nothing was sent a second time').toBe(0);
  const end = await serverDraft(page);
  expect(end.revision).toBe(4);
  expect(wordings(end)).toContain('Is the receipt in your own name?');
  await context.close();
});

test('FI-1.4 the server\'s validation is the one that counts', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await session(browser, 'survey_author', `${SURVEY}/validate`);
  const panel = page.getByTestId('ss-server-validation');
  await expect(panel).toHaveAttribute('data-state', 'blocked');
  await expect(page.getByTestId('ss-server-verdict')).toContainText('The server blocks this draft');
  await expect(page.getByTestId('ss-server-scope')).toContainText('saved revision 4');
  const codes = await page.getByTestId('ss-server-finding').evaluateAll((els) => els.map((e) => e.getAttribute('data-code')));
  expect(codes.length).toBeGreaterThan(0);
  for (const c of codes) expect(c).toMatch(/^[A-Z_]+$/); // stable codes from the server, not messages
  await expect(page.getByTestId('ss-editor-checks-title')).toContainText('not authoritative');
  await expect(page.getByTestId('ss-val-to-review')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('ss-val-notice')).toContainText('cannot override the server');
  await expect(page.getByTestId('ss-val-notice')).toContainText('No survey here is eligible for a live call');
  await shot(page, 'FI12-server-validation-blocked');

  // the server is asked directly: the same blockers, and a submission is refused by the server itself
  const d = await serverDraft(page);
  const csrf = (await context.cookies()).find((c) => c.name === 'c360_csrf')!.value;
  const submit = await page.request.post(`/api/v1/survey-definitions/${d.survey_id}/candidates`, { data: {}, headers: { 'X-CSRF-Token': csrf, Origin: 'http://127.0.0.1:5174' } });
  expect(submit.status(), await submit.text()).toBe(422);
  expect((await submit.json()).code).toBe('VALIDATION_BLOCKED');

  // review and publication are a later checkpoint: said plainly, nothing simulated
  await page.getByTestId('ss-journey-review').click();
  await expect(page.getByTestId('ss-review-later')).toContainText('not available yet');
  await shot(page, 'FI13-review-not-available');

  // an unsaved edit: the server says it has not seen it
  await page.goto(MODULE);
  await view(page, 'Guided');
  await typeQuestion(page.getByTestId('ss-q-n3'), 'Is the receipt in your own name, or a family member\'s?');
  await page.getByTestId('ss-journey-validate').click();
  await expect(page.getByTestId('ss-server-unsaved')).toContainText('unsaved change');
  await shot(page, 'FI14-server-validation-with-unsaved-changes');

  // leaving with unsaved work asks first, and staying keeps it
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByTestId('ss-leave')).toBeVisible();
  await shot(page, 'FI15-unsaved-leave-warning');
  await page.getByTestId('ss-leave-stay').click();
  await expect(page).toHaveURL(/\/validate$/);
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');
  expect(await page.evaluate(() => window.localStorage.length + window.sessionStorage.length), 'no survey data in browser storage').toBe(0);
  await context.close();
});

test('FI-1.5 access: read-only, no permission, another market, and no way into Script Studio', async ({ browser }) => {
  test.setTimeout(120_000);
  // read permission only: can open, cannot save
  const reader = await session(browser, 'survey_reader', MODULE);
  await saved(reader.page, 4);
  await expect(reader.page.getByTestId('ss-read-only')).toBeVisible();
  await expect(reader.page.getByTestId('ss-save')).toBeDisabled();
  const d = await serverDraft(reader.page);
  const csrf = (await reader.context.cookies()).find((c) => c.name === 'c360_csrf')!.value;
  const refused = await reader.page.request.post(`/api/v1/survey-definitions/${d.survey_id}/draft/save`, { data: { expected_revision: d.revision, operations: [{ op: 'SET_DETAILS', name: 'Changed by a reader' }] }, headers: { 'X-CSRF-Token': csrf, Origin: 'http://127.0.0.1:5174' } });
  expect(refused.status(), 'the server refuses, whatever the screen allows').toBe(403);
  expect((await refused.json()).code).toBe('FORBIDDEN');
  await shot(reader.page, 'FI16-read-only');
  await reader.page.goto('/survey-studio');
  await expect(reader.page.getByTestId('ss-create')).toHaveCount(0);
  await reader.context.close();

  // an ordinary user: no survey permission at all
  const plain = await session(browser, 'user', '/survey-studio');
  await expect(plain.page).toHaveURL(/\/unauthorized$/);
  expect((await plain.page.request.get('/api/v1/survey-definitions')).status()).toBe(403);
  await plain.context.close();

  // every survey permission, another market: the survey does not exist for them
  const other = await session(browser, 'survey_elsewhere', '/survey-studio');
  await expect(other.page.getByTestId('ss-no-surveys')).toBeVisible();
  await other.page.goto(SURVEY);
  await expect(other.page.getByTestId('ss-missing')).toContainText('no survey');
  expect((await other.page.request.get(`/api/v1/survey-definitions/${d.survey_id}/draft/documents`)).status()).toBe(404);
  await shot(other.page, 'FI17-other-market');
  await other.context.close();

  // the survey author reaches Survey Studio and nothing of Script Studio
  const author = await session(browser, 'survey_author', '/scripts');
  await expect(author.page).toHaveURL(/\/unauthorized$/);
  expect((await author.page.request.get('/api/v1/scripts')).status()).toBe(403);
  await author.page.goto('/assignment-rules');
  await expect(author.page).toHaveURL(/\/unauthorized$/);
  await author.context.close();
});

test('FI-1.6 browser Back and Forward with unsaved work: asked first; staying keeps everything; leaving harms nothing', async ({ browser }) => {
  test.setTimeout(180_000);
  // arrive the way a person does, so there is real history behind the survey: Overview → list → survey → module
  const { context, page } = await session(browser, 'survey_author', '/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Survey Studio' }).click();
  await page.getByTestId(`ss-open-${CODE}`).click();
  await expect(page).toHaveURL(new RegExp(`${SURVEY}$`));
  await page.getByTestId('ss-open-mi-payment-check').click();
  await expect(page).toHaveURL(new RegExp(`${MODULE}`));
  await view(page, 'Guided');
  const start = await serverDraft(page);
  const fp = async () => (await page.getByTestId('ss-model-fingerprint').textContent()) ?? '';

  // with nothing unsaved, Back and Forward are not interfered with
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${SURVEY}$`));
  await expect(page.getByTestId('ss-leave')).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${MODULE}`));

  // two unsaved edits, so there is undo history to preserve as well
  await typeQuestion(page.getByTestId('ss-q-n1'), 'Do you pay your premium by GIRO every month?');
  await typeQuestion(page.getByTestId('ss-q-n2'), 'Do you keep every cash receipt?');
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');
  const edited = await fp();

  // Back WITHIN the survey (module → composer) is ordinary navigation: no question asked, nothing lost
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${SURVEY}$`));
  await expect(page.getByTestId('ss-leave')).toHaveCount(0);
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');
  expect(await fp()).toBe(edited);

  // Back OUT of the survey (composer → list): held, and asked
  await page.goBack();
  await expect(page.getByTestId('ss-leave')).toBeVisible();
  await expect(page.getByTestId('ss-leave')).toHaveAttribute('data-via', 'history');
  await expect(page).toHaveURL(new RegExp(`${SURVEY}$`)); // the address is back where it was
  await shot(page, 'FI18-back-button-unsaved-warning');

  // STAY: the complete workspace is exactly as it was — model, undo history, save state
  await page.getByTestId('ss-leave-stay').click();
  await expect(page.getByTestId('ss-leave')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${SURVEY}$`));
  expect(await fp(), 'the model is identical after staying').toBe(edited);
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');
  await expect(page.getByTestId('ss-undo')).toBeEnabled();
  await expect(page.getByTestId('ss-undo')).toHaveAttribute('title', /Undo:/);
  await page.goForward(); // history is intact too: Forward still leads to the module
  await expect(page).toHaveURL(new RegExp(`${MODULE}`));
  await view(page, 'Guided');
  await expect(page.getByTestId('ss-q-n1').locator('.ss-q-text textarea').first()).toHaveValue('Do you pay your premium by GIRO every month?');
  await expect(page.getByTestId('ss-q-n2').locator('.ss-q-text textarea').first()).toHaveValue('Do you keep every cash receipt?');
  await page.getByTestId('ss-undo').click(); // undo still works after the held Back …
  await expect(page.getByTestId('ss-q-n2').locator('.ss-q-text textarea').first()).not.toHaveValue('Do you keep every cash receipt?');
  await page.getByTestId('ss-redo').click(); // … and redo
  expect(await fp()).toBe(edited);
  await shot(page, 'FI19-after-staying-work-intact');

  // asked again every time, not only the first
  await page.goBack();
  await page.goBack();
  await expect(page.getByTestId('ss-leave')).toBeVisible();
  // Escape is "stay"
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ss-leave')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${SURVEY}$`));

  // LEAVE: the move happens; the saved revision is untouched
  await page.goBack();
  await page.getByTestId('ss-leave-go').click();
  await expect(page).toHaveURL(/\/survey-studio$/);
  await expect(page.getByTestId(`ss-survey-${CODE}`)).toContainText(`Revision ${start.revision}`);
  expect(fingerprintOf(await serverDraft(page)), 'leaving sent nothing and changed nothing on the server').toEqual(fingerprintOf(start));
  await shot(page, 'FI20-after-leaving-list');

  // Forward back INTO the survey: the unsaved work is still there (memory only), and it can still be saved
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${SURVEY}$`));
  await expect(status(page)).toHaveAttribute('data-state', 'unsaved');
  expect(await fp()).toBe(edited);
  await page.getByTestId('ss-save').click();
  await saved(page, start.revision + 1);
  const end = await serverDraft(page);
  expect(end.revision).toBe(start.revision + 1);
  expect(wordings(end)).toContain('Do you keep every cash receipt?');
  expect(wordings(end)).toContain('Do you pay your premium by GIRO every month?');

  // once saved, Back leaves without a question
  await page.goBack();
  await expect(page).toHaveURL(/\/survey-studio$/);
  await expect(page.getByTestId('ss-leave')).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.length + window.sessionStorage.length)).toBe(0);
  await context.close();
});

