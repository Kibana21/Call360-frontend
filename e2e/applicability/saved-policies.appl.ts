import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// APPL-X3 — applicability POLICIES saved in Call360, in a real browser against the real backend and the test database.
// A policy is created with a name and a reviewed code, built on the persisted library and REAL published Survey Studio
// versions, saved, and reopened in a NEW browser session; the saved revision is evaluated by the server from exactly
// what it pins; newer versions are adopted only deliberately; a draft dependency is reported and a change to it is
// noticed; two people cannot overwrite each other. Scenarios stay in the tab and say so.
const here = dirname(fileURLToPath(import.meta.url));
const accounts = (): Record<string, Account> => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'));
const SHOTS = 'test-results/applicability/shots';
const B = '/survey-studio/applicability';
const [A_, B_, C_] = ['S-APPL-DEMO-ILP', 'S-APPL-DEMO-NFTF', 'S-APPL-DEMO-COMBINED'] as const;
const CODE = 'ILP-NFTF-X3';
const contexts: BrowserContext[] = [];
/** every request the server refused for being too frequent: there must be none, or a journey is not what it seems */
const refused: string[] = [];
let author: Page, checker: Page, publisher: Page;
const open = async (browser: Browser, who: string, path = B): Promise<Page> => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  const p = await context.newPage();
  p.on('response', (r) => { if (r.status() === 429) refused.push(`${r.request().method()} ${new URL(r.url()).pathname}`); });
  p.on('requestfinished', (q) => { const u = new URL(q.url()); const t = q.timing().responseEnd; if (u.pathname.startsWith('/api/v1/applicability/policies') && t > 4000) console.log(`SLOW ${Math.round(t)}ms ${q.method()} ${u.pathname.replace(/[0-9a-f-]{36}/, '{id}')}${u.search}`); });
  await signIn(p, accounts()[who]!, path);
  return p;
};
const shot = async (p: Page, name: string, full = true) => { if (full) await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
const ready = async (p: Page) => { await expect(p.getByTestId('ap-catalogue')).toHaveAttribute('data-policies', 'ready', { timeout: 25_000 }); await expect(p.getByTestId('ap-catalogue')).toHaveAttribute('data-library', 'ready'); await expect(p.getByTestId('ap-catalogue')).toHaveAttribute('data-status', 'ready'); };
const go = async (p: Page, path: string) => { await p.goto(`${B}/${path}`); await ready(p); };
const bar = (p: Page) => p.getByTestId('ap-policy-bar');
const saved = async (p: Page) => { await expect(bar(p)).toHaveAttribute('data-state', 'saved', { timeout: 15_000 }); };
const save = async (p: Page) => { await expect(bar(p)).toHaveAttribute('data-state', 'unsaved'); await p.getByTestId('ap-save-draft').click(); await saved(p); };
const pick = async (p: Page, testid: string, option: string) => { await p.getByTestId(testid).click(); await p.getByTestId(`${testid}-opt-${option}`).click(); };
const link = async (p: Page, ...codes: string[]) => { await p.getByTestId('ap-editor-add-survey').click(); for (const c of codes) await p.getByTestId(`ap-survey-option-${c}-select`).click(); await p.getByTestId('ap-survey-picker-add').click(); };
const done = async (p: Page) => { await p.getByTestId('ap-editor-done').click(); await expect(p.getByTestId('ap-requirement-editor')).toHaveCount(0); };
const again = async (p: Page) => { await p.getByTestId('ap-prototype-note').click(); await p.getByTestId('ap-kept-refresh').click(); await p.getByTestId('ap-prototype-note').click(); await p.waitForTimeout(600); };
const source = (p: Page) => p.getByTestId('ap-preview-source').first();
const selected = (p: Page) => p.getByTestId('ap-preview-plan-selected').first().locator('li');
/** The saved revision evaluated by the server for one seeded scenario: status, surveys, fingerprint. */
const result = async (p: Page, scenario: string) => {
  await pick(p, 'ap-preview-scenario', scenario);
  await expect(source(p)).toHaveAttribute('data-source', 'SAVED');
  await p.waitForTimeout(500);
  const plan = p.getByTestId('ap-preview-plan').first();
  return { status: await plan.getAttribute('data-status'), surveys: await selected(p).count(), fingerprint: await source(p).getAttribute('data-fingerprint') };
};
const dep = (p: Page, kind: string, code: string) => p.getByTestId(`ap-dep-${kind}-${code}`);
/** Publish the library item open on the author's screen through the three people (as in APPL-X2). */
const publishItem = async (path: string) => {
  await author.getByTestId('ap-lib-submit').click();
  await author.getByTestId('ap-lib-freeze-ack').check();
  await author.getByTestId('ap-lib-ask-ok').click();
  await expect(author.getByTestId('ap-lib')).toHaveAttribute('data-state', 'in_review');
  await go(checker, path); await checker.getByTestId('ap-lib-approve').click(); await expect(checker.getByTestId('ap-lib')).toHaveAttribute('data-state', 'approved');
  await go(publisher, path); await publisher.getByTestId('ap-lib-publish').click(); await expect(publisher.getByTestId('ap-lib')).toHaveAttribute('data-state', 'published');
  await author.getByTestId('ap-prototype-note').click(); await author.getByTestId('ap-kept-refresh').click(); await author.getByTestId('ap-prototype-note').click();
  await expect(author.getByTestId('ap-lib')).toHaveAttribute('data-state', 'published');
};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async ({ browser }) => {
  author = await open(browser, 'survey_applauthor');
  checker = await open(browser, 'survey_applchecker');
  publisher = await open(browser, 'survey_applpublisher');
});
test.afterAll(async () => { expect(refused, 'requests refused as too frequent').toEqual([]); for (const c of contexts) await c.close().catch(() => undefined); });

test('X3.1 Journeys A and B: a blank policy, named and coded, saved, the browser closed, reopened in a new session, and evaluated from what it pins', async ({ browser }) => {
  test.setTimeout(240_000);
  await ready(author);
  // ---- the workspace says what is saved where; nobody is impersonated
  await expect(author.getByTestId('ap-signed-in')).toContainText('E2E Applicability Author');
  await expect(author.getByTestId('ap-persona')).toHaveCount(0);
  await author.getByTestId('ap-prototype-note').click();
  await expect(author.getByTestId('ap-kept-policies')).toContainText('Saved in Call360 as working drafts');
  await expect(author.getByTestId('ap-kept-scenarios')).toContainText('In this tab only');
  await shot(author, '70-where-things-are-kept-with-saved-policies', false);
  await author.getByTestId('ap-prototype-note').click();
  // ---- 1–3. create a blank policy: a name first, then a suggested code that is reviewed and changed
  await author.getByTestId('ap-nav-3').click();
  await author.getByTestId('ap-policy-new-blank').click();
  await expect(author.getByTestId('ap-policy-create-save')).toBeDisabled();
  await author.getByTestId('ap-policy-create-name').fill('ILP and NFTF applicability (persistent)');
  await expect(author.getByTestId('ap-code-input')).toHaveValue('ILP-AND-NFTF-APPLICABILITY-PERSISTENT'); // suggested from the name
  await expect(author.getByTestId('ap-code-note')).toContainText('The code is permanent');
  await author.getByTestId('ap-code-input').fill('1 bad code');
  await expect(author.getByTestId('ap-policy-create-save')).toBeDisabled();
  await author.getByTestId('ap-code-input').fill(CODE);
  await author.getByTestId('ap-policy-create-description').fill('Which showcase surveys a newly sold policy needs (synthetic).');
  await shot(author, '71-create-policy-name-then-code', false);
  await author.getByTestId('ap-policy-create-save').click();
  await expect(author).toHaveURL(new RegExp(`/policies/${CODE}`));
  await saved(author); // created = saved: a genuine draft in Call360
  await expect(author.getByTestId('ap-saved')).toContainText('Draft saved · revision 1');
  // ---- 5–8. a requirement: a published condition → the published Survey A; then saved
  await author.getByTestId('ap-add-requirement').click();
  await author.getByTestId('ap-smart-when').click();
  await author.getByTestId('ap-editor-name').fill('ILP needs Survey A');
  await expect(author.getByTestId('ap-editor-builder-sentence')).toContainText('“Is ILP”');
  await link(author, A_);
  await done(author);
  await expect(bar(author)).toHaveAttribute('data-state', 'unsaved');
  await expect(source(author)).toHaveAttribute('data-source', 'PREVIEW'); // an unsaved edit is a what-if, and says so
  await expect(source(author)).toContainText('Unsaved preview');
  await shot(author, '72-unsaved-edit-is-a-labelled-preview');
  await author.getByTestId('ap-save-draft').click();
  await saved(author);
  await expect(author.getByTestId('ap-saved')).toContainText('revision 2');
  await expect(source(author)).toHaveAttribute('data-source', 'SAVED');
  await expect(source(author)).toContainText('Saved revision 2 · evaluated by Call360');
  // the gallery duplicate-code check is market-scoped and server-enforced
  await author.getByTestId('ap-nav-3').click();
  await author.getByTestId('ap-policy-new-blank').click();
  await author.getByTestId('ap-policy-create-name').fill('Another policy');
  await author.getByTestId('ap-code-input').fill(CODE.toLowerCase());
  await expect(author.getByText('A policy with this code already exists in this market.')).toBeVisible();
  await expect(author.getByTestId('ap-policy-create-save')).toBeDisabled();
  await author.getByRole('button', { name: 'Cancel' }).click();

  // ---- 9–11. THE BROWSER IS CLOSED. A new browser session signs in and reopens the exact saved policy
  await author.context().close();
  author = await open(browser, 'survey_applauthor', `${B}/policies`);
  await ready(author);
  await expect(author.getByTestId(`ap-gallery-${CODE}`)).toContainText('ILP and NFTF applicability (persistent)');
  await expect(author.getByTestId(`ap-pstate-draft-${CODE}`)).toContainText('Draft saved · revision 2');
  await author.getByTestId(`ap-gallery-${CODE}-history`).click();
  await expect(author.getByTestId(`ap-gallery-${CODE}-events`)).toContainText('Saved · revision 2');
  await expect(author.getByTestId(`ap-gallery-${CODE}-events`)).toContainText('Created · revision 1');
  await shot(author, '73-gallery-after-reopening-in-a-new-session');
  await author.getByTestId(`ap-gallery-${CODE}-open`).click();
  await saved(author);
  await expect(author.getByTestId('ap-policy-name')).toHaveValue('ILP and NFTF applicability (persistent)');
  await expect(author.getByTestId('ap-card-r1-name')).toHaveText('ILP needs Survey A');
  await expect(author.getByTestId(`ap-card-r1-ticket-${A_}`)).toHaveAttribute('data-pinned', 'true');
  await expect(author.getByTestId(`ap-card-r1-ticket-${A_}`)).toHaveAttribute('data-version', '1.0');
  await shot(author, '74-policy-reopened-exactly-as-saved');

  // ---- 12. it is edited further: NFTF → B, and ILP AND NFTF → C (Journey B), on the real showcase versions
  await author.getByTestId('ap-add-requirement').click();
  await author.getByTestId('ap-smart-when').click();
  await author.getByTestId('ap-editor-name').fill('NFTF needs Survey B');
  await pick(author, 'ap-editor-builder-g-add-saved', 'nftf_applies');
  await author.getByTestId('ap-editor-builder-n0-remove').click();
  await link(author, B_);
  await done(author);
  await author.getByTestId('ap-add-requirement').click();
  await author.getByTestId('ap-smart-joined').click();
  await author.getByTestId('ap-editor-name').fill('ILP with NFTF needs Survey C');
  await expect(author.getByTestId('ap-editor-builder-sentence')).toContainText('“Is ILP” and “NFTF applies”');
  await link(author, C_);
  await done(author);
  await save(author);
  // ---- 13–14, 16. the SAVED revision, evaluated by the server for the five cases
  const both = await result(author, 'sc-both');
  expect(both).toMatchObject({ status: 'RESOLVED', surveys: 3 });
  await expect(author.getByTestId('ap-preview-plan-selected').first()).toContainText(/A · ILP product understanding[\s\S]*B · NFTF additional questions[\s\S]*C · Combined ILP \+ NFTF/);
  await expect(author.getByTestId('ap-preview-plan-selected').first()).toContainText('version 1.0');
  await shot(author, '75-saved-policy-additive-A-B-C');
  expect(await result(author, 'sc-ilp')).toMatchObject({ status: 'RESOLVED', surveys: 1 });
  expect(await result(author, 'sc-nftf')).toMatchObject({ status: 'RESOLVED', surveys: 1 });
  expect(await result(author, 'sc-neither')).toMatchObject({ status: 'RESOLVED', surveys: 0 });
  const unknown = await result(author, 'sc-missing');
  expect(unknown).toMatchObject({ status: 'UNRESOLVED', surveys: 1 });
  await expect(author.getByTestId('ap-preview-plan-pending').first()).toContainText(/B · NFTF additional questions[\s\S]*C · Combined ILP \+ NFTF/);
  await shot(author, '76-saved-policy-unknown-nftf-unresolved');
  // exact dependency versions and fingerprints, on screen
  await author.getByTestId('ap-deps-toggle').click();
  for (const [kind, code] of [['CONDITION', 'is_ilp'], ['CONDITION', 'nftf_applies'], ['VARIABLE', 'is_ilp'], ['VARIABLE', 'product_family'], ['VARIABLE', 'nftf'], ['SURVEY', A_], ['SURVEY', B_], ['SURVEY', C_]] as const) await expect(dep(author, kind, code)).toHaveAttribute('data-state', 'pinned');
  await expect(dep(author, 'VARIABLE', 'nftf')).toHaveAttribute('data-pinned', '1');
  await expect(author.getByTestId('ap-readiness')).toContainText('No blocker found · publication is not available yet');
  await shot(author, '77-dependency-manifest-exact-versions');
  // ---- the same saved revision gives the same fingerprint after a reload and in another person's session
  const fingerprint = both.fingerprint!;
  expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  await author.reload(); await ready(author);
  expect((await result(author, 'sc-both')).fingerprint).toBe(fingerprint);
  await go(checker, `policies/${CODE}`);
  expect((await result(checker, 'sc-both')).fingerprint).toBe(fingerprint);
  await author.getByTestId('ap-nav-4').click();
  await expect(author.getByTestId('ap-scenarios-kept')).toContainText('Scenarios are kept in this browser tab only'); // policies are saved; scenarios are not, and say so
  await author.getByTestId('ap-nav-3').click();
  await author.getByTestId(`ap-gallery-${CODE}-open`).click();
  // ---- 17. durable editing history; the matrix and the graph draw the same saved document
  await author.getByTestId('ap-view-matrix').click();
  await expect(author.getByTestId('ap-matrix').getByTestId('ap-preview-source')).toHaveAttribute('data-source', 'SAVED');
  await expect(author.getByTestId('ap-matrix-row-sc-both')).toHaveAttribute('data-status', 'RESOLVED');
  await shot(author, '78-matrix-of-the-saved-revision');
  await author.getByTestId('ap-view-canvas').click();
  await expect(author.locator('.ap-node.kind-requirement')).toHaveCount(3);
  await shot(author, '79-graph-of-the-saved-policy', false);
  await author.getByTestId('ap-view-cards').click();
});

test('X3.2 Journey C: Survey C replaces A and B — saved, reloaded, evaluated', async () => {
  await go(author, `policies/${CODE}`);
  await author.getByTestId('ap-card-r3-edit').click();
  await author.getByTestId('ap-editor-replace-r1').click();
  await author.getByTestId('ap-editor-replace-r2').click();
  await done(author);
  // before saving: a preview, compared with nothing silently — the saved revision still selects three
  await expect(source(author)).toHaveAttribute('data-source', 'PREVIEW');
  await save(author);
  await author.reload(); await ready(author);
  const both = await result(author, 'sc-both');
  expect(both).toMatchObject({ status: 'RESOLVED', surveys: 1 });
  await expect(author.getByTestId('ap-preview-plan-selected').first()).toContainText('C · Combined ILP + NFTF');
  await expect(author.getByTestId('ap-card-r1')).toHaveAttribute('data-outcome', 'REPLACED');
  await expect(author.getByTestId('ap-card-r2')).toHaveAttribute('data-outcome', 'REPLACED');
  expect(await result(author, 'sc-ilp')).toMatchObject({ status: 'RESOLVED', surveys: 1 });
  await shot(author, '80-saved-replacement-C-replaces-A-and-B');
  // undo after a save marks the draft unsaved again; it does not pretend the save was reversed
  await author.getByTestId('ap-card-r3-edit').click();
  await author.getByTestId('ap-editor-name').fill('ILP with NFTF needs only Survey C');
  await done(author);
  await save(author);
  const revision = await bar(author).getAttribute('data-revision');
  await author.getByTestId('ap-undo').click();
  await expect(bar(author)).toHaveAttribute('data-state', 'unsaved');
  await expect(bar(author)).toHaveAttribute('data-revision', revision!); // the saved revision is still there
  await expect(author.getByTestId('ap-policy-bar-says')).toContainText(`The saved draft is revision ${revision}`);
  await author.getByTestId('ap-redo').click();
  await saved(author);
});

test('X3.3 Journey D: a newer condition version is offered, never applied; adopting it is deliberate and undoable', async () => {
  test.setTimeout(240_000);
  // a condition of its own, published as version 1
  await go(author, 'conditions?c=new');
  await author.getByTestId('ap-condition-name').fill('Agency sale');
  await pick(author, 'ap-lab-builder-add-fact', 'sales_channel');
  await author.getByTestId('ap-condition-save').click();
  await expect(author.getByTestId('ap-lib')).toHaveAttribute('data-state', 'draft');
  await publishItem('conditions?c=agency_sale');
  // a policy that names version 1
  await author.getByTestId('ap-nav-3').click();
  await author.getByTestId('ap-policy-new-blank').click();
  await author.getByTestId('ap-policy-create-name').fill('Agency review');
  await author.getByTestId('ap-policy-create-save').click();
  await saved(author);
  await author.getByTestId('ap-add-requirement').click();
  await author.getByTestId('ap-smart-when').click();
  await pick(author, 'ap-editor-builder-g-add-saved', 'agency_sale');
  await author.getByTestId('ap-editor-builder-n0-remove').click();
  await link(author, A_);
  await done(author);
  await save(author);
  const before = (await result(author, 'sc-both')).fingerprint;
  // version 2 of the condition is published (three people)
  await go(author, 'conditions?c=agency_sale');
  await author.getByTestId('ap-lab-builder-n0-negate').click();
  await author.getByTestId('ap-condition-save').click();
  await expect(author.getByTestId('ap-lib')).toHaveAttribute('data-state', 'draft');
  await publishItem('conditions?c=agency_sale');
  await expect(author.getByTestId('ap-lib-tag')).toHaveText('Version 2 published');
  // the policy is reopened: version 1 is still pinned, the result and its fingerprint are unchanged, version 2 is offered
  await go(author, 'policies/AGENCY-REVIEW');
  await saved(author);
  expect((await result(author, 'sc-both')).fingerprint).toBe(before);
  await expect(dep(author, 'CONDITION', 'agency_sale')).toHaveAttribute('data-state', 'newer');
  await expect(dep(author, 'CONDITION', 'agency_sale')).toHaveAttribute('data-pinned', '1');
  await expect(dep(author, 'CONDITION', 'agency_sale')).toContainText('version 2 available');
  await expect(author.getByTestId('ap-reqdeps-r1')).toContainText('v2 available: Agency sale');
  await shot(author, '81-newer-condition-version-offered-not-applied');
  const manifest = await author.getByTestId('ap-deps-fingerprint').innerText();
  // deliberate adoption: the reference moves, the manifest changes, the draft is unsaved
  await author.getByTestId('ap-dep-CONDITION-agency_sale-adopt').click();
  await expect(bar(author)).toHaveAttribute('data-state', 'unsaved');
  await author.getByTestId('ap-deps-toggle').click();
  await expect(dep(author, 'CONDITION', 'agency_sale')).toHaveAttribute('data-pinned', '2');
  expect(await author.getByTestId('ap-deps-fingerprint').innerText()).not.toBe(manifest);
  await shot(author, '82-version-2-adopted-manifest-changed');
  // undone: the previous pin is back, and nothing is unsaved
  await author.getByTestId('ap-undo').click();
  await saved(author);
  await expect(dep(author, 'CONDITION', 'agency_sale')).toHaveAttribute('data-pinned', '1');
  expect(await author.getByTestId('ap-deps-fingerprint').innerText()).toBe(manifest);
  // adopted again and saved: now the saved policy pins version 2, and a reload keeps it
  await author.getByTestId('ap-redo').click();
  await save(author);
  await author.reload(); await ready(author);
  await author.getByTestId('ap-deps-toggle').click();
  await expect(dep(author, 'CONDITION', 'agency_sale')).toHaveAttribute('data-pinned', '2');
  expect((await result(author, 'sc-both')).fingerprint).not.toBe(before);
});

test('X3.4 Journey E: a draft dependency is allowed and reported; a change to it is noticed, not silently evaluated', async () => {
  test.setTimeout(180_000);
  await go(author, 'conditions?c=new');
  await author.getByTestId('ap-condition-name').fill('Replacement case');
  await pick(author, 'ap-lab-builder-add-fact', 'replacement');
  await author.getByTestId('ap-condition-save').click();
  await expect(author.getByTestId('ap-lib')).toHaveAttribute('data-state', 'draft'); // saved, NOT published
  await author.getByTestId('ap-nav-3').click();
  await author.getByTestId('ap-policy-new-blank').click();
  await author.getByTestId('ap-policy-create-name').fill('Replacement review');
  await author.getByTestId('ap-policy-create-save').click();
  await saved(author);
  await author.getByTestId('ap-add-requirement').click();
  await author.getByTestId('ap-smart-when').click();
  await pick(author, 'ap-editor-builder-g-add-saved', 'replacement_case');
  await author.getByTestId('ap-editor-builder-n0-remove').click();
  await link(author, A_);
  await done(author);
  await save(author); // a policy draft may be saved on a draft condition
  await author.reload(); await ready(author);
  await expect(author.getByTestId('ap-readiness')).toContainText('Draft contains unpublished dependencies — not ready for publication');
  await expect(dep(author, 'CONDITION', 'replacement_case')).toHaveAttribute('data-state', 'draft');
  await expect(dep(author, 'CONDITION', 'replacement_case')).toHaveAttribute('data-pinned', 'draft-1');
  await expect(author.getByTestId('ap-reqdeps-r1')).toContainText('unpublished: Replacement case');
  await expect(source(author)).toHaveAttribute('data-source', 'SAVED'); // it can still be designed with
  await shot(author, '83-draft-dependency-not-ready-for-publication');
  await author.getByTestId('ap-to-governance').click();
  await expect(author.getByTestId('ap-gov-readiness')).toContainText('Draft contains unpublished dependencies — not ready for publication');
  await expect(author.getByTestId('ap-gov-readiness')).toContainText('A policy cannot be submitted, approved or published yet');
  await expect(author.getByTestId('ap-gov-submit')).toHaveCount(0); // no simulated publication of a saved policy
  await shot(author, '84-readiness-page-no-simulated-publication');
  // the condition's draft is changed
  await go(author, 'conditions?c=replacement_case');
  await author.getByTestId('ap-lab-builder-n0-negate').click();
  await author.getByTestId('ap-condition-save').click();
  await expect(author.getByTestId('ap-lib')).toHaveAttribute('data-state', 'draft');
  // the policy notices: it is not evaluated as though nothing had changed
  await go(author, 'policies/REPLACEMENT-REVIEW');
  await expect(dep(author, 'CONDITION', 'replacement_case')).toHaveAttribute('data-state', 'stale');
  await expect(author.getByTestId('ap-readiness')).toContainText('A dependency changed — review it before relying on a result');
  await expect(source(author)).toHaveAttribute('data-status', 'DEPENDENCY_STALE');
  await expect(source(author)).toContainText('Not evaluated');
  await expect(author.getByTestId('ap-reqdeps-r1')).toContainText('changed: Replacement case');
  await shot(author, '85-changed-draft-dependency-not-evaluated');
  // reconciled deliberately, then saved
  await author.getByTestId('ap-dep-CONDITION-replacement_case-accept').click();
  await expect(bar(author)).toHaveAttribute('data-state', 'unsaved');
  await author.getByTestId('ap-save-draft').click();
  await saved(author);
  await expect(dep(author, 'CONDITION', 'replacement_case')).toHaveAttribute('data-pinned', 'draft-2');
  await expect(source(author)).toHaveAttribute('data-status', 'OK');
});

test('X3.5 Journey F: two signed-in people edit the same policy; the second save is refused and nothing is overwritten', async ({ browser }) => {
  const second = await open(browser, 'survey_applsecond', `${B}/policies/${CODE}`);
  await ready(second); await saved(second);
  await go(author, `policies/${CODE}`); await saved(author);
  await author.getByTestId('ap-policy-name').fill('ILP and NFTF applicability (edited by the first person)');
  await expect(bar(author)).toHaveAttribute('data-state', 'unsaved');
  await second.getByTestId('ap-policy-name').fill('ILP and NFTF applicability (edited by the second person)');
  await second.getByTestId('ap-save-draft').click();
  await saved(second);
  // the first person saves on the revision they opened: refused
  await author.getByTestId('ap-save-draft').click();
  await expect(bar(author)).toHaveAttribute('data-state', 'conflict');
  await expect(author.getByTestId('ap-policy-bar-says')).toContainText('E2E Second Applicability Author saved revision');
  await expect(author.getByTestId('ap-policy-bar-says')).toContainText('Nothing of yours was saved and nothing of theirs was overwritten');
  await expect(author.getByTestId('ap-policy-conflict-diff')).toContainText('theirs: “ILP and NFTF applicability (edited by the second person)”');
  await expect(author.getByTestId('ap-policy-name')).toHaveValue('ILP and NFTF applicability (edited by the first person)'); // their work is still on screen
  await shot(author, '86-concurrent-save-refused-with-comparison');
  // choice 1: take what is saved
  await author.getByTestId('ap-policy-reload').click();
  await saved(author);
  await expect(author.getByTestId('ap-policy-name')).toHaveValue('ILP and NFTF applicability (edited by the second person)');
  // choice 2, the other way round: keep mine, deliberately, as the next revision
  await second.getByTestId('ap-policy-name').fill('ILP and NFTF applicability (second, again)');
  await author.getByTestId('ap-policy-name').fill('ILP and NFTF applicability (persistent)');
  await author.getByTestId('ap-save-draft').click();
  await saved(author);
  await second.getByTestId('ap-save-draft').click();
  await expect(bar(second)).toHaveAttribute('data-state', 'conflict');
  await second.getByTestId('ap-policy-overwrite').click();
  await saved(second);
  await again(author);
  await expect(author.getByTestId('ap-policy-name')).toHaveValue('ILP and NFTF applicability (second, again)');
  await author.getByTestId('ap-policy-name').fill('ILP and NFTF applicability (persistent)');
  await author.getByTestId('ap-save-draft').click();
  await saved(author);
  await second.context().close();
});

test('X3.6 Journey G: from a saved policy to the published survey in Survey Studio, and back to the same editing context', async () => {
  await go(author, `policies/${CODE}?view=cards`);
  await author.getByTestId('ap-card-r3-edit').click();
  await author.getByTestId('ap-editor-name').fill('ILP with NFTF needs only Survey C (edited before leaving)');
  await done(author);
  await expect(bar(author)).toHaveAttribute('data-state', 'unsaved'); // an unsaved edit is carried through the round trip
  await author.getByTestId(`ap-card-r3-ticket-${C_}`).getByRole('button').first().click();
  await expect(author.getByTestId('ap-survey-preview')).toBeVisible();
  await expect(author.getByTestId('ap-preview-structure')).toBeVisible();
  await shot(author, '87-published-survey-C-preview-from-a-saved-policy', false);
  await author.getByTestId('ap-preview-open').click();
  await expect(author).toHaveURL(new RegExp(`/survey-studio/surveys/${C_}`));
  await expect(author.getByRole('heading', { name: 'Showcase welcome and understanding check (synthetic)' }).first()).toBeVisible({ timeout: 25_000 }); // its modules
  await expect(author.getByRole('heading', { name: 'Showcase closing (synthetic)' }).first()).toBeVisible(); // … every module of the published survey
  await expect(author.getByTestId('ss-applicability-return')).toContainText('ILP and NFTF applicability (persistent)');
  await shot(author, '88-survey-C-in-survey-studio-with-the-way-back');
  await author.getByTestId('ss-applicability-return').getByRole('link').click();
  await expect(author.getByTestId('ap-current-policy')).toHaveText('ILP and NFTF applicability (persistent)');
  await expect(author.getByTestId('ap-card-r3-name')).toHaveText('ILP with NFTF needs only Survey C (edited before leaving)');
  await expect(bar(author)).toHaveAttribute('data-state', 'unsaved');
  await author.getByTestId('ap-save-draft').click();
  await saved(author);
  // where used, from the server: Survey Studio lists the saved policies that pin this survey
  await author.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Surveys', exact: true }).click();
  await author.getByText('Applicability Showcase · C · Combined ILP + NFTF (synthetic demo)').first().click();
  await expect(author.getByTestId(`ss-appl-used-policy-${CODE}`)).toContainText('pins version 1 of this survey', { timeout: 25_000 });
  await expect(author.getByTestId('ss-applicability-where-used')).toContainText('ILP and NFTF applicability (persistent)', { timeout: 25_000 });
  await shot(author, '89-survey-studio-where-used-by-saved-policies');
});

test('X3.7 Journey H: read-only without the permission to edit; closed without the applicability permissions; refusals by the server', async ({ browser }) => {
  // the checker may read policies and may not change them
  await go(checker, `policies/${CODE}`);
  await expect(bar(checker)).toHaveAttribute('data-state', 'readonly');
  await expect(checker.getByTestId('ap-policy-name')).toHaveAttribute('readonly', '');
  await expect(checker.getByTestId('ap-save-draft')).toHaveCount(0);
  await expect(checker.getByTestId('ap-add-requirement')).toHaveCount(0); // nothing that changes the policy is offered
  await shot(checker, '90-read-only-for-a-person-who-may-not-edit', false);
  const id = await checker.evaluate(async (code) => (await (await fetch('/api/v1/applicability/policies')).json()).items.find((x: { code: string }) => x.code === code).id, CODE);
  const call = (p: Page, method: string, path: string, body?: unknown) => p.evaluate(async ([m, u, b]) => { const csrf = document.cookie.split('; ').find((c) => c.includes('c360_csrf='))?.split('=')[1] ?? ''; const r = await fetch(u as string, { method: m as string, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: b ? JSON.stringify(b) : undefined }); return [r.status, (await r.json().catch(() => ({}))).code]; }, [method, path, body ?? null]);
  const doc = await checker.evaluate(async (i) => (await (await fetch(`/api/v1/applicability/policies/${i}`)).json()), id);
  expect(await call(checker, 'PUT', `/api/v1/applicability/policies/${id}/draft`, { expected_revision: doc.draft_revision, document: doc.document, note: '' })).toEqual([403, 'FORBIDDEN']);
  expect(await call(checker, 'POST', '/api/v1/applicability/policies', { market_code: 'SG', code: 'NOT-ALLOWED', document: { name: 'Not allowed' }, origin: 'BLANK' })).toEqual([403, 'FORBIDDEN']);
  // the author: a stale revision, an invalid survey version, an invalid pin, another market — all refused
  const bad = structuredClone(doc.document);
  expect(await call(author, 'PUT', `/api/v1/applicability/policies/${id}/draft`, { expected_revision: 1, document: bad, note: '' })).toEqual([409, 'STALE_REVISION']);
  bad.requirements[0].action.surveys[0].fingerprint = '0'.repeat(64);
  expect(await call(author, 'PUT', `/api/v1/applicability/policies/${id}/draft`, { expected_revision: doc.draft_revision, document: bad, note: '' })).toEqual([422, 'INVALID_SURVEY_REFERENCE']);
  const pin = structuredClone(doc.document); pin.pins = [{ kind: 'VARIABLE', code: 'nftf', version: 9 }];
  expect(await call(author, 'PUT', `/api/v1/applicability/policies/${id}/draft`, { expected_revision: doc.draft_revision, document: pin, note: '' })).toEqual([422, 'INVALID_DEPENDENCY_PIN']);
  expect(await call(author, 'POST', '/api/v1/applicability/policies', { market_code: 'MY', code: 'OTHER-MARKET', document: { name: 'Other market' }, origin: 'BLANK' })).toEqual([403, 'MARKET_NOT_IN_SCOPE']);
  expect(await call(author, 'GET', '/api/v1/applicability/policies/00000000-0000-4000-8000-000000000000')).toEqual([404, 'NOT_FOUND']);
  const after = await checker.evaluate(async (i) => (await (await fetch(`/api/v1/applicability/policies/${i}`)).json()), id);
  expect([after.draft_revision, after.document_sha256, after.snapshot_sha256]).toEqual([doc.draft_revision, doc.document_sha256, doc.snapshot_sha256]); // nothing changed
  // a person with no applicability permission: the saved policies are closed, and the screen says so
  const reader = await open(browser, 'survey_reader', `${B}/policies`);
  await expect(reader.getByTestId('ap-catalogue')).toHaveAttribute('data-policies', 'forbidden', { timeout: 25_000 });
  await expect(reader.getByTestId('ap-gallery-status')).toContainText('not permitted to read saved policies');
  expect(await reader.evaluate(async () => (await fetch('/api/v1/applicability/policies')).status)).toBe(403);
  await shot(reader, '91-saved-policies-closed-without-permission', false);
});

test('X3.8 Journey I: 20, 50 and 100 saved requirements, a long name, a deep condition, keyboard, widths and accessibility', async () => {
  test.setTimeout(300_000);
  const view = () => author.evaluate(() => {
    const stage = document.querySelector('.ap-canvas-stage')!.getBoundingClientRect();
    const inside = (r: DOMRect) => r.left >= stage.left - 2 && r.right <= stage.right + 2 && r.top >= stage.top - 2 && r.bottom <= stage.bottom + 2;
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
    const on = document.querySelector('.react-flow__node .ap-node.on')?.getBoundingClientRect();
    // … and on the SCREEN: between the bottom of the fixed header and the bottom of the browser window, without scrolling
    const head = document.querySelector('.ap-top')!.getBoundingClientRect().bottom;
    const seen = (r: DOMRect) => r.top >= head - 1 && r.bottom <= window.innerHeight + 1 && r.left >= 0 && r.right <= window.innerWidth + 1;
    return { total: nodes.length, inside: nodes.filter(inside).length, selected: on ? inside(on) : null, onScreen: nodes.filter(seen).length, selectedOnScreen: on ? seen(on) : null, stageOnScreen: stage.top >= head - 1 && stage.bottom <= window.innerHeight + 1, zoom: Number(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a.toFixed(2)) };
  });
  for (const n of [20, 50, 100]) {
    await go(author, 'policies');
    await author.getByTestId(`ap-policy-scale-${n}`).click();
    await saved(author); // a generated policy is a genuine saved draft too
    await expect(author.getByTestId('ap-cards-count')).toHaveText(`${n} of ${n}`);
    await author.reload(); await ready(author); // … and it is still there, with all its requirements
    await expect(author.getByTestId('ap-cards-count')).toHaveText(`${n} of ${n}`);
    await author.getByTestId('ap-view-canvas').click();
    await expect(author.getByTestId('ap-canvas-large')).toHaveAttribute('data-mode', 'overview');
    await author.waitForTimeout(900);
    let v = await view();
    expect(v.inside, `overview of ${n}`).toBe(v.total);
    await pick(author, 'ap-canvas-goto', 'r7');
    await expect(author.locator('.ap-node.kind-requirement')).toHaveCount(1);
    await author.waitForTimeout(900);
    v = await view();
    expect(v.selected, `selected requirement of ${n}`).toBe(true);
    expect(v.inside, `neighbourhood of ${n}: ${JSON.stringify(v)}`).toBe(v.total);
    expect(v.zoom, `legible at ${n}`).toBeGreaterThanOrEqual(0.6);
    // what the person actually sees, with no scrolling of the page: the selection and its whole neighbourhood
    expect(v.selectedOnScreen, `selected requirement of ${n} is on the screen: ${JSON.stringify(v)}`).toBe(true);
    expect(v.onScreen, `neighbourhood of ${n} is on the screen: ${JSON.stringify(v)}`).toBe(v.total);
    expect(v.stageOnScreen, `the whole canvas of ${n} is on the screen`).toBe(true);
    if (n === 100) await shot(author, '92-AFTER-graph-focus-selection-on-the-screen', false);
    await author.getByTestId('ap-view-cards').click();
  }
  // ---- a long name stays readable in full: in the designer, the switcher and the gallery
  const long = 'Applicability policy for investment-linked and non-face-to-face new business, including replacement and rider cases, for the synthetic showcase';
  await author.getByTestId('ap-policy-name').fill(long);
  const title = await author.getByTestId('ap-policy-name').evaluate((el) => ({ clipped: el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2, title: el.getAttribute('title') }));
  expect(title).toEqual({ clipped: false, title: long });
  await author.getByTestId('ap-save-draft').click(); await saved(author);
  expect(await author.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await shot(author, '93-long-policy-name-readable-in-full', false);
  await go(author, 'policies');
  await author.getByTestId('ap-gallery-search').fill('non-face-to-face');
  await expect(author.getByTestId('ap-gallery-count')).toContainText('1 of');
  await expect(author.getByText(long).first()).toBeVisible();
  await author.getByTestId('ap-gallery-search').fill('');
  // ---- an archived policy is kept, shown with why and by whom, and restored after a confirmation
  await author.getByTestId('ap-gallery-AGENCY-REVIEW-archive').click();
  await author.getByTestId('ap-gallery-archive-reason').fill('Archived to show that a policy is kept and can be restored.');
  await author.getByTestId('ap-gallery-archive-ok').click();
  await expect(author.getByTestId('ap-gallery-AGENCY-REVIEW')).toHaveCount(0);
  await author.getByTestId('ap-archived-toggle').click();
  await expect(author.getByTestId('ap-archived-AGENCY-REVIEW')).toContainText('Archived by E2E Applicability Author');
  await expect(author.getByTestId('ap-archived-AGENCY-REVIEW')).toContainText('“Archived to show that a policy is kept and can be restored.”');
  await shot(author, '96-archived-policy-with-reason-and-history');
  await author.getByTestId('ap-archived-AGENCY-REVIEW-restore').click();
  await expect(author.getByTestId('ap-archived-confirm')).toContainText('Restore “Agency review”?');
  await author.getByTestId('ap-archived-AGENCY-REVIEW-confirm').click();
  await expect(author.getByTestId('ap-gallery-AGENCY-REVIEW')).toBeVisible();
  await author.getByTestId('ap-gallery-AGENCY-REVIEW-history').click();
  await expect(author.getByTestId('ap-gallery-AGENCY-REVIEW-events')).toContainText('Restored · revision');
  await expect(author.getByTestId('ap-gallery-AGENCY-REVIEW-events')).toContainText('Archived · revision');
  // ---- a deep nested condition, edited in the spacious focused mode
  await go(author, 'conditions?c=senior_ilp_outside_nftf');
  await author.getByTestId('ap-lab-focus').click();
  await expect(author.getByTestId('ap-conditions')).toHaveAttribute('data-focus', 'true');
  const width = await author.getByTestId('ap-lab-builder-sentence').evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(700);
  await shot(author, '94-condition-lab-focused-mode-nested');
  await author.getByTestId('ap-lab-focus').click();
  // ---- keyboard: a card moved with the keyboard on a saved policy, then saved
  await go(author, `policies/${CODE}`);
  const cards = () => author.locator('.ap-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('ap-card-', '')));
  const first = await cards();
  await author.getByTestId(`ap-card-${first[0]}`).click();
  await author.getByTestId(`ap-card-${first[0]}-down`).focus();
  await author.keyboard.press('Enter');
  expect((await cards()).slice(0, 2)).toEqual([first[1], first[0]]);
  await author.getByTestId('ap-undo').click();
  await saved(author);
  // ---- accessibility and widths on the screens of saved policies
  const found: string[] = [];
  const scan = async (name: string) => { await author.evaluate(() => window.scrollTo(0, 0)); await author.waitForTimeout(300); const r = await new AxeBuilder({ page: author }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').forEach((x) => found.push(`${name}: ${x.id} (${x.nodes.length}) ${x.nodes[0]?.target.join(' ')}`)); };
  await author.getByTestId('ap-deps-toggle').click();
  await scan('designer with dependencies');
  await author.getByTestId('ap-to-governance').click(); await scan('readiness');
  await go(author, 'policies'); await scan('gallery');
  await author.getByTestId('ap-policy-new-blank').click(); await author.waitForTimeout(400); await scan('create dialog');
  await author.getByRole('button', { name: 'Cancel' }).click();
  expect(found).toEqual([]);
  for (const width of [1440, 1280, 900, 390]) {
    await author.setViewportSize({ width, height: 900 });
    for (const path of ['policies', `policies/${CODE}`, `governance/${CODE}`]) {
      await go(author, path);
      expect(await author.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${path} at ${width}`).toBeLessThanOrEqual(0);
    }
    if (width === 390) await shot(author, '95-saved-policy-at-phone-width');
  }
  await author.setViewportSize({ width: 1440, height: 900 });
});
