import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// FI-2 — real review and publication: Chromium → Vite → FastAPI → PostgreSQL (isolated test schema).
// Three people who each hold only their own part: an author (read, edit), a checker (read, approve) and a publisher
// (read, publish). A fourth holds every permission, to show that the identity rules stop them where no permission does.
// Runs after fi1.persisted.ts in the same reset schema; it uses its own surveys. Synthetic content only.
const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = 'test-results/persisted/shots';
const CODE = 'S-FI-2-REVIEW';
const SURVEY = `/survey-studio/surveys/${CODE}`;
const MODULE = `${SURVEY}/modules/mi-suitability-check`;
const ORIGIN = 'http://127.0.0.1:5174';
type Who = 'survey_author' | 'survey_checker' | 'survey_publisher' | 'survey_everything' | 'survey_reader' | 'user';
const account = (who: Who): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'))[who];

const shot = async (page: Page, name: string, full = false) => { await page.waitForTimeout(250); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
const pick = async (page: Page, text: string | RegExp) => page.getByRole('option', { name: text }).first().click();
const typeQuestion = async (card: Locator, text: string) => { const box = card.locator('.ss-q-text textarea').first(); await box.fill(text); await box.blur(); };
const status = (page: Page) => page.getByTestId('ss-save-status');
const saved = async (page: Page) => expect(status(page)).toHaveAttribute('data-state', 'saved');

/* eslint-disable @typescript-eslint/no-explicit-any */
async function session(browser: Browser, who: Who, path = '/'): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, account(who), path);
  return { context, page };
}
const csrf = async (context: BrowserContext) => ({ 'X-CSRF-Token': (await context.cookies()).find((c) => c.name === 'c360_csrf')!.value, Origin: ORIGIN });
const api = async (page: Page, path: string) => (await page.request.get(path)).json();
const surveyId = async (page: Page, code: string) => (await api(page, '/api/v1/survey-definitions')).items.find((s: any) => s.code === code).id as string;
const history = async (page: Page, code = CODE) => api(page, `/api/v1/survey-definitions/${await surveyId(page, code)}/history`);
const candidateDocs = async (page: Page, id: string) => api(page, `/api/v1/survey-candidates/${id}/documents`);
const post = async (s: { context: BrowserContext; page: Page }, path: string, data: unknown = {}) => s.page.request.post(path, { data, headers: await csrf(s.context) });

/** A small, valid survey: one module, one yes/no question that ends the module, which ends the call. Saved. */
async function buildSurvey(page: Page, name: string, code: string, moduleName: string, question: string) {
  await page.goto('/survey-studio');
  await page.getByTestId('ss-create').click();
  await page.getByTestId('ss-create-name').fill(name);
  await page.getByTestId('ss-create-code').fill(code);
  await page.getByTestId('ss-create-go').click();
  await expect(page).toHaveURL(new RegExp(`/surveys/${code}$`));
  await page.getByTestId('ss-add-first').click();
  await page.getByTestId('ss-blank-module').click();
  await page.getByTestId('ss-new-module-name').fill(moduleName);
  await page.getByTestId('ss-new-module-go').click();
  await page.getByTestId('ss-new-YES_NO').click();
  await typeQuestion(page.getByTestId('ss-q-n1'), question);
  await page.getByTestId('ss-dest-n1-ANY').click();
  await pick(page, 'End module: Completed');
  await page.getByTestId('ss-save').click();
  await saved(page);
}
/** On the review step: acknowledge the server's warning with a reason, and submit. Lands on the new candidate. */
async function submit(page: Page, code: string, reason: string, note: string) {
  await page.goto(`/survey-studio/surveys/${code}/review`);
  await expect(page.getByTestId('ss-submit-validation')).toContainText('No blocker');
  await page.getByTestId('ss-ack-reason-SYNTHETIC_WORDING_UNAPPROVED').fill(reason);
  await page.getByTestId('ss-submit-note').fill(note);
  await page.getByTestId('ss-submit').click();
  await expect(page.getByTestId('ss-candidate')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('FI-2.1 author submits C-1 → checker approves → publisher creates Version 1.0 → later edits change neither → C-2 is not approved', async ({ browser }) => {
  test.setTimeout(300_000);
  // ---------------------------------------------------------------------------------------------------------- AUTHOR
  const author = await session(browser, 'survey_author');
  await buildSurvey(author.page, 'FI-2 review walkthrough', CODE, 'Suitability check', 'Did your adviser explain why this plan suits you?');

  await author.page.getByTestId('ss-journey-review').click();
  await expect(author.page.getByTestId('ss-wording-note')).toContainText('not Compliance approval');
  await expect(author.page.getByTestId('ss-no-candidates')).toBeVisible();
  // the server validated the exact saved revision: no blocker, one governed warning, and submission waits for a reason
  await expect(author.page.getByTestId('ss-submit-validation')).toContainText('No blocker · 1 warning to acknowledge');
  await expect(author.page.getByTestId('ss-ack-SYNTHETIC_WORDING_UNAPPROVED')).toContainText('synthetic and not approved for operational use');
  await expect(author.page.getByTestId('ss-submit')).toBeDisabled();
  await expect(author.page.getByTestId('ss-submit-why')).toContainText('Acknowledge the warning');
  await author.page.getByTestId('ss-ack-reason-SYNTHETIC_WORDING_UNAPPROVED').fill('short');
  await expect(author.page.getByTestId('ss-submit')).toBeDisabled(); // a reason, not a tick
  // the server itself refuses a submission without the acknowledgement, whatever the screen does
  const sid = await surveyId(author.page, CODE);
  const bare = await post(author, `/api/v1/survey-definitions/${sid}/candidates`, { note: '', acknowledgements: [] });
  expect([bare.status(), (await bare.json()).code]).toEqual([422, 'ACKNOWLEDGEMENT_REQUIRED']);
  const reason = 'Synthetic wording for a development walkthrough; it will not be used on a call.';
  await author.page.getByTestId('ss-ack-reason-SYNTHETIC_WORDING_UNAPPROVED').fill(reason);
  await author.page.getByTestId('ss-submit-note').fill('First version for review');
  await expect(author.page.getByTestId('ss-submit')).toBeEnabled();
  await shot(author.page, 'FJ01-author-submit-with-acknowledgement', true);
  await author.page.getByTestId('ss-submit').click();

  // C-1: frozen, in review; its author cannot decide or publish it
  await expect(author.page.getByTestId('ss-candidate')).toHaveAttribute('data-n', '1');
  await expect(author.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'IN_REVIEW');
  await expect(author.page.getByTestId('ss-you-are-maker')).toContainText('you cannot approve, send back or publish it');
  await expect(author.page.getByTestId('ss-no-approve')).toBeVisible();
  await expect(author.page.getByTestId('ss-no-publish')).toBeVisible();
  await expect(author.page.getByTestId('ss-acked-SYNTHETIC_WORDING_UNAPPROVED')).toContainText(reason);
  await expect(author.page.getByTestId('ss-acked-SYNTHETIC_WORDING_UNAPPROVED')).toContainText('the fingerprint of this candidate');
  await expect(author.page.getByTestId('ss-frozen-node-mi-suitability-check-n1')).toContainText('Did your adviser explain why this plan suits you?');
  await shot(author.page, 'FJ02-author-candidate-C1-in-review', true);
  const c1 = new URL(author.page.url()).pathname.split('/').pop()!;
  const c1Frozen = await candidateDocs(author.page, c1);
  expect(c1Frozen.acknowledgements[0].content_sha256).toBe(c1Frozen.content_sha256);
  for (const [who, path] of [['decision', `/api/v1/survey-candidates/${c1}/decision`], ['publish', `/api/v1/survey-candidates/${c1}/publish`]] as const) {
    const r = await post(author, path, who === 'decision' ? { verdict: 'APPROVE', comment: '' } : {});
    expect([who, r.status(), (await r.json()).code]).toEqual([who, 403, 'FORBIDDEN']); // the author holds neither permission
  }

  // ---------------------------------------------------------------------------------------------------------- CHECKER
  const checker = await session(browser, 'survey_checker', '/survey-studio');
  await expect(checker.page.getByTestId(`ss-survey-${CODE}`)).toContainText('in review');
  await checker.page.getByTestId(`ss-open-${CODE}`).click();
  await expect(checker.page.getByTestId('ss-read-only')).toBeVisible(); // a checker cannot edit the draft
  await checker.page.getByTestId('ss-journey-review').click();
  await expect(checker.page.getByTestId('ss-submit-not-author')).toBeVisible();
  await expect(checker.page.getByTestId('ss-candidate-row-1')).toHaveAttribute('data-status', 'IN_REVIEW');
  await checker.page.getByTestId('ss-open-candidate-1').click();
  await expect(checker.page.getByTestId('ss-integrity')).toHaveAttribute('data-intact', 'true');
  await expect(checker.page.getByTestId('ss-content-sha')).toHaveText(c1Frozen.content_sha256);
  await expect(checker.page.getByTestId('ss-manifest-sha')).toHaveText(c1Frozen.manifest_sha256);
  await expect(checker.page.getByTestId('ss-maker-names')).toHaveText('E2E Survey Author');
  await expect(checker.page.getByTestId('ss-you-are-maker')).toHaveCount(0);
  await expect(checker.page.getByTestId('ss-candidate-validation')).toContainText('0 blockers');
  await expect(checker.page.getByTestId('ss-changes-first')).toBeVisible();
  await expect(checker.page.getByTestId('ss-frozen-content')).toContainText('Did your adviser explain why this plan suits you?');
  await expect(checker.page.getByTestId('ss-frozen-content')).toContainText('synthetic · unapproved');
  // nothing on a candidate can be edited: no text box but the checker's own comment
  expect(await checker.page.getByTestId('ss-frozen-content').locator('input, textarea, [contenteditable="true"]').count()).toBe(0);
  await expect(checker.page.getByTestId('ss-save')).toHaveCount(1);
  await expect(checker.page.getByTestId('ss-save')).toBeDisabled();
  await expect(checker.page.getByTestId('ss-no-publish')).toBeVisible(); // approving is not publishing
  await checker.page.getByTestId('ss-decision-comment').fill('Reads correctly; routes end where they should.');
  await shot(checker.page, 'FJ03-checker-inspects-C1', true);
  await checker.page.getByTestId('ss-approve').click();
  await expect(checker.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'APPROVED');
  await expect(checker.page.getByTestId('ss-candidate-history')).toContainText('Approved by E2E Survey Checker');
  await expect(checker.page.getByTestId('ss-candidate-history')).toContainText('Reads correctly');
  await expect(checker.page.getByTestId('ss-you-are-approver')).toBeVisible();
  await shot(checker.page, 'FJ04-checker-approved-C1', true);
  const cp = await post(checker, `/api/v1/survey-candidates/${c1}/publish`);
  expect([cp.status(), (await cp.json()).code]).toEqual([403, 'FORBIDDEN']);

  // -------------------------------------------------------------------------------------------------------- PUBLISHER
  const publisher = await session(browser, 'survey_publisher', `${SURVEY}/review`);
  await expect(publisher.page.getByTestId('ss-candidate-row-1')).toHaveAttribute('data-status', 'APPROVED');
  await publisher.page.getByTestId('ss-open-candidate-1').click();
  await expect(publisher.page.getByTestId('ss-integrity')).toHaveAttribute('data-intact', 'true');
  await expect(publisher.page.getByTestId('ss-no-approve')).toBeVisible();
  await expect(publisher.page.getByTestId('ss-publish')).toBeEnabled();
  await expect(publisher.page.getByTestId('ss-publish-why')).toContainText('re-verifies the manifest');
  await shot(publisher.page, 'FJ05-publisher-opens-approved-C1', true);
  await publisher.page.getByTestId('ss-publish').click();
  await expect(publisher.page.getByTestId('ss-version')).toHaveAttribute('data-label', '1.0');
  await expect(publisher.page.getByTestId('ss-version')).toHaveAttribute('data-status', 'PUBLISHED');
  await expect(publisher.page.getByTestId('ss-candidate-history')).toContainText('Published by E2E Survey Publisher');
  await expect(publisher.page.getByTestId('ss-frozen-content')).toContainText('Did your adviser explain why this plan suits you?');
  await expect(publisher.page.getByTestId('ss-wording-note')).toContainText('makes nothing eligible for a live call');
  await shot(publisher.page, 'FJ06-publisher-version-1.0', true);
  await publisher.page.goto(`${SURVEY}/review`);
  await expect(publisher.page.getByTestId('ss-version-row-1.0')).toHaveAttribute('data-status', 'PUBLISHED');
  await shot(publisher.page, 'FJ07-version-history');
  const afterPublish = await candidateDocs(publisher.page, c1);
  expect(afterPublish.content).toEqual(c1Frozen.content);
  expect(afterPublish.assets).toEqual(c1Frozen.assets); // approval and publication changed no document
  const v1 = (await history(publisher.page)).versions[0];
  const v1Content = await api(publisher.page, `/api/v1/survey-versions/${v1.id}/content`);
  expect(v1Content.content_sha256).toBe(c1Frozen.content_sha256);

  // ------------------------------------------------- the AUTHOR goes on editing: C-1 and Version 1.0 do not change
  await author.page.goto(MODULE);
  await expect(author.page.getByTestId('ss-lockbar')).toBeVisible(); // what the candidate pinned is frozen in the editor too
  await author.page.getByTestId('ss-derive').click();
  await author.page.getByTestId('ss-change-n1').click();
  await author.page.getByTestId('ss-new-version').click();
  await typeQuestion(author.page.getByTestId('ss-q-n1'), 'Did your adviser explain why this plan suits your needs and budget?');
  await author.page.getByTestId('ss-save').click();
  await saved(author.page);
  await shot(author.page, 'FJ08-author-edits-a-new-version');
  expect(await candidateDocs(author.page, c1), 'C-1 is exactly as it was frozen, apart from having been approved and published').toMatchObject({ content: c1Frozen.content, content_sha256: c1Frozen.content_sha256, manifest_sha256: c1Frozen.manifest_sha256, assets: c1Frozen.assets, acknowledgements: c1Frozen.acknowledgements, manifest_intact: true });
  expect(await api(author.page, `/api/v1/survey-versions/${v1.id}/content`), 'Version 1.0 is unchanged').toEqual(v1Content);
  await author.page.goto(`${SURVEY}/versions/${v1.id}`);
  await expect(author.page.getByTestId('ss-frozen-content')).toContainText('Did your adviser explain why this plan suits you?');
  await expect(author.page.getByTestId('ss-frozen-content')).not.toContainText('needs and budget');

  // ------------------------------------------------------- the changed draft is C-2: in review, nothing inherited
  await submit(author.page, CODE, 'Still synthetic wording; this revision rewords one question.', 'Reworded the suitability question');
  await expect(author.page.getByTestId('ss-candidate')).toHaveAttribute('data-n', '2');
  await expect(author.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'IN_REVIEW');
  await expect(author.page.getByTestId('ss-changes')).toContainText('Version 1.0');
  await expect(author.page.getByTestId('ss-changes')).toContainText('needs and budget');
  await shot(author.page, 'FJ09-author-candidate-C2-changes', true);
  const c2 = new URL(author.page.url()).pathname.split('/').pop()!;
  const c2Docs = await candidateDocs(author.page, c2);
  expect(c2Docs.content_sha256).not.toBe(c1Frozen.content_sha256);
  expect(c2Docs.approver).toBeNull();
  expect(c2Docs.acknowledgements[0].content_sha256).toBe(c2Docs.content_sha256); // acknowledged afresh for this content
  await publisher.page.goto(`${SURVEY}/candidates/${c2}`);
  await expect(publisher.page.getByTestId('ss-publish')).toBeDisabled();
  await expect(publisher.page.getByTestId('ss-publish-why')).toContainText('Only an approved candidate can be published');
  const early = await post(publisher, `/api/v1/survey-candidates/${c2}/publish`);
  expect([early.status(), (await early.json()).code], 'C-2 does not inherit C-1\'s approval').toEqual([409, 'NOT_APPROVED']);
  await shot(publisher.page, 'FJ10-publisher-C2-not-approved');

  // ------------------------------------------------- browser restart: status and history are the server's, not the tab's
  for (const s of [author, checker, publisher]) await s.context.close();
  const again = await session(browser, 'survey_checker', `${SURVEY}/review`);
  await expect(again.page.getByTestId('ss-candidate-row-1')).toHaveAttribute('data-status', 'PUBLISHED');
  await expect(again.page.getByTestId('ss-candidate-row-1')).toContainText('Published');
  await expect(again.page.getByTestId('ss-candidate-row-2')).toHaveAttribute('data-status', 'IN_REVIEW');
  await expect(again.page.getByTestId('ss-version-row-1.0')).toContainText('E2E Survey Publisher');
  await shot(again.page, 'FJ11-history-after-browser-restart');
  await again.page.getByTestId('ss-open-candidate-1').click();
  await expect(again.page.getByTestId('ss-candidate-history').locator('li')).toHaveCount(3);
  await expect(again.page.getByTestId('ss-candidate-version-link')).toContainText('Version 1.0');
  const h = await history(again.page);
  expect(h.candidates.map((c: any) => [c.n, c.status])).toEqual([[1, 'PUBLISHED'], [2, 'IN_REVIEW']]);
  expect(h.versions.map((v: any) => [v.label, v.status, v.candidate_n])).toEqual([['1.0', 'PUBLISHED', 1]]);
  // the checker sends C-2 back, with a reason: recorded, and the draft is still the author's to change
  await again.page.goto(`${SURVEY}/candidates/${c2}`);
  await expect(again.page.getByTestId('ss-reject')).toBeDisabled(); // no reason, no sending back
  await again.page.getByTestId('ss-decision-comment').fill('Please keep the original shorter wording.');
  await again.page.getByTestId('ss-reject').click();
  await expect(again.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'REJECTED');
  await expect(again.page.getByTestId('ss-candidate-history')).toContainText('Please keep the original shorter wording.');
  await shot(again.page, 'FJ12-checker-sends-C2-back', true);
  await again.context.close();
});

test('FI-2.2 self-review, self-publication and approver-publication are refused even with every permission; the unauthorised cannot review or publish', async ({ browser }) => {
  test.setTimeout(240_000);
  // ---- a person who holds ALL FOUR permissions makes and submits a candidate: they still cannot decide or publish it
  const all = await session(browser, 'survey_everything');
  await buildSurvey(all.page, 'FI-2 own work', 'S-FI-2-OWN', 'Own module', 'Is this your own signature on the form?');
  await submit(all.page, 'S-FI-2-OWN', 'Synthetic wording; a test of the identity rules.', 'My own candidate');
  await expect(all.page.getByTestId('ss-you-are-maker')).toBeVisible();
  await expect(all.page.getByTestId('ss-approve')).toBeDisabled();
  await expect(all.page.getByTestId('ss-decide-why')).toContainText('A maker cannot approve or send back their own work, whatever permissions they hold');
  await shot(all.page, 'FJ13-self-review-refused', true);
  const own = new URL(all.page.url()).pathname.split('/').pop()!;
  const selfReview = await post(all, `/api/v1/survey-candidates/${own}/decision`, { verdict: 'APPROVE', comment: '' });
  expect([selfReview.status(), (await selfReview.json()).code]).toEqual([403, 'SELF_REVIEW_DENIED']);
  // someone else approves it; the maker still cannot publish it
  const checker = await session(browser, 'survey_checker', `/survey-studio/surveys/S-FI-2-OWN/candidates/${own}`);
  await checker.page.getByTestId('ss-approve').click();
  await expect(checker.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'APPROVED');
  await all.page.reload();
  await expect(all.page.getByTestId('ss-publish')).toBeDisabled();
  await expect(all.page.getByTestId('ss-publish-why')).toContainText('A maker cannot publish their own work');
  const selfPublish = await post(all, `/api/v1/survey-candidates/${own}/publish`);
  expect([selfPublish.status(), (await selfPublish.json()).code]).toEqual([403, 'SELF_PUBLISH_DENIED']);
  await shot(all.page, 'FJ14-self-publication-refused', true);

  // ---- the same person APPROVES someone else's candidate: then they cannot publish that one
  const author = await session(browser, 'survey_author');
  await buildSurvey(author.page, 'FI-2 another author', 'S-FI-2-OTHER', 'Other module', 'Did you read the product summary?');
  await submit(author.page, 'S-FI-2-OTHER', 'Synthetic wording; a test of the identity rules.', 'For the approver-publication check');
  const other = new URL(author.page.url()).pathname.split('/').pop()!;
  await all.page.goto(`/survey-studio/surveys/S-FI-2-OTHER/candidates/${other}`);
  await expect(all.page.getByTestId('ss-you-are-maker')).toHaveCount(0);
  await all.page.getByTestId('ss-approve').click();
  await expect(all.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'APPROVED');
  await expect(all.page.getByTestId('ss-you-are-approver')).toBeVisible();
  await expect(all.page.getByTestId('ss-publish')).toBeDisabled();
  await expect(all.page.getByTestId('ss-publish-why')).toContainText('The person who approves cannot also publish it');
  await shot(all.page, 'FJ15-approver-publication-refused', true);
  const approverPublish = await post(all, `/api/v1/survey-candidates/${other}/publish`);
  expect([approverPublish.status(), (await approverPublish.json()).code]).toEqual([403, 'APPROVER_PUBLISH_DENIED']);
  expect((await candidateDocs(all.page, other)).status, 'nothing was published').toBe('APPROVED');
  expect((await history(all.page, 'S-FI-2-OTHER')).versions).toEqual([]);

  // ---- people without the permission
  const reader = await session(browser, 'survey_reader', `/survey-studio/surveys/S-FI-2-OTHER/candidates/${other}`);
  await expect(reader.page.getByTestId('ss-no-approve')).toBeVisible();
  await expect(reader.page.getByTestId('ss-no-publish')).toBeVisible();
  await expect(reader.page.getByTestId('ss-approve')).toHaveCount(0);
  await expect(reader.page.getByTestId('ss-publish')).toHaveCount(0);
  for (const [path, body] of [[`/api/v1/survey-candidates/${other}/decision`, { verdict: 'REJECT', comment: 'no' }], [`/api/v1/survey-candidates/${other}/publish`, {}], [`/api/v1/survey-candidates/${other}/withdraw`, { reason: '' }]] as const) {
    const r = await post(reader, path, body);
    expect([path.split('/').pop(), r.status(), (await r.json()).code]).toEqual([path.split('/').pop(), 403, 'FORBIDDEN']);
  }
  await shot(reader.page, 'FJ16-reader-cannot-review-or-publish', true);
  const plain = await session(browser, 'user', `/survey-studio/surveys/S-FI-2-OTHER/candidates/${other}`);
  await expect(plain.page).toHaveURL(/\/unauthorized$/);
  expect((await plain.page.request.get(`/api/v1/survey-candidates/${other}/documents`)).status()).toBe(403);
  for (const path of [`/api/v1/survey-candidates/${other}/decision`, `/api/v1/survey-candidates/${other}/publish`]) expect((await post(plain, path, { verdict: 'APPROVE', comment: '' })).status()).toBe(403);
  expect((await candidateDocs(all.page, other)).status).toBe('APPROVED'); // none of it changed anything
  for (const s of [all, checker, author, reader, plain]) await s.context.close();
});

test('FI-2.3 a tampered candidate is shown as such, and the server refuses to approve it', async ({ browser }) => {
  test.setTimeout(120_000);
  // someone with database access writes a candidate around the application: one pinned fingerprint is changed
  const forged = execFileSync('uv', ['run', 'python', 'scripts/e2e_forge_candidate.py', 'S-FI-2-OTHER'], { cwd: resolve(here, '../../../Call360-backend'), env: { ...process.env, CALL360_ENV_FILE: '.env.test' } }).toString().trim().split('\n').pop()!;
  const checker = await session(browser, 'survey_checker', `/survey-studio/surveys/S-FI-2-OTHER/candidates/${forged}`);
  await expect(checker.page.getByTestId('ss-integrity')).toHaveAttribute('data-intact', 'false');
  await expect(checker.page.getByTestId('ss-tampered')).toContainText('changed outside Call360');
  await expect(checker.page.locator('.ss-hash.bad').first()).toContainText('does not match');
  await expect(checker.page.getByTestId('ss-approve')).toBeDisabled();
  // even when asked outright, the server re-verifies and refuses
  await checker.page.getByTestId('ss-approve-anyway').click();
  await expect(checker.page.getByTestId('ss-review-error-code')).toHaveText('MANIFEST_MISMATCH');
  await expect(checker.page.getByTestId('ss-candidate')).toHaveAttribute('data-status', 'IN_REVIEW');
  await shot(checker.page, 'FJ17-tampered-candidate-refused', true);
  const direct = await post(checker, `/api/v1/survey-candidates/${forged}/decision`, { verdict: 'APPROVE', comment: '' });
  expect([direct.status(), (await direct.json()).code]).toEqual([409, 'MANIFEST_MISMATCH']);
  expect((await candidateDocs(checker.page, forged)).status).toBe('IN_REVIEW');
  const publisher = await session(browser, 'survey_publisher');
  const pub = await post(publisher, `/api/v1/survey-candidates/${forged}/publish`);
  expect([pub.status(), (await pub.json()).code]).toEqual([409, 'NOT_APPROVED']);
  expect((await history(checker.page, 'S-FI-2-OTHER')).versions, 'nothing was published from it').toEqual([]);
  await checker.context.close();
  await publisher.context.close();
});
