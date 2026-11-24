import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';
import { fixtureSurvey } from './global-setup';

// APPL-X2 — the governed applicability LIBRARY in a real browser against the real backend and the test database.
// Variables, application profiles and reusable conditions are SAVED in Call360; publication is done by three different
// signed-in people, each in a browser session of their own, and the server enforces it. The applicability POLICY stays
// in the tab. The owner's primary acceptance criterion is the first journey, end to end.
const here = dirname(fileURLToPath(import.meta.url));
const accounts = (): Record<string, Account> => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8'));
const SHOTS = 'test-results/applicability/shots';
const B = '/survey-studio/applicability';
let author: Page, checker: Page, publisher: Page;
const contexts: BrowserContext[] = [];
/** every request the server refused for being too frequent: there must be none, or a journey is not what it seems */
const refused: string[] = [];
const open = async (browser: Browser, who: string, path = B): Promise<Page> => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  const p = await context.newPage();
  p.on('response', (r) => { if (r.status() === 429) refused.push(`${r.request().method()} ${new URL(r.url()).pathname}`); });
  p.on('requestfinished', (q) => { const u = new URL(q.url()); const t = q.timing().responseEnd; if (u.pathname.startsWith('/api/v1/applicability/policies') && t > 4000) console.log(`SLOW ${Math.round(t)}ms ${q.method()} ${u.pathname.replace(/[0-9a-f-]{36}/, '{id}')}${u.search}`); });
  p.on('response', (r) => { const u = new URL(r.url()); if (r.status() >= 400 && u.pathname.startsWith('/api/v1/applicability/policies') && r.request().method() === 'POST' && u.pathname.endsWith('/policies')) void r.text().then((t) => console.log(`POLICY CREATE REFUSED ${r.status()} ${t.slice(0, 600)}`)); });
  await signIn(p, accounts()[who]!, path);
  return p;
};
const shot = async (p: Page, name: string, full = true) => { if (full) await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(350); await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };
const ready = async (p: Page) => { await expect(p.getByTestId('ap-catalogue')).toHaveAttribute('data-library', 'ready', { timeout: 25_000 }); };
const bar = (p: Page) => p.getByTestId('ap-lib');
const state = async (p: Page, want: string) => { await expect(bar(p)).toHaveAttribute('data-state', want, { timeout: 15_000 }); };
const pick = async (p: Page, testid: string, option: string) => { await p.getByTestId(testid).click(); await p.getByTestId(`${testid}-opt-${option}`).click(); };
const editor = (p: Page) => p.getByTestId('ap-requirement-editor');
const again = async (p: Page) => { await p.getByTestId('ap-prototype-note').click(); await p.getByTestId('ap-kept-refresh').click(); await p.getByTestId('ap-prototype-note').click(); };
/** The three-person path for the item open on each person's screen. */
const through = async (path: string, version: number) => {
  await author.getByTestId('ap-lib-submit').click();
  // owner ruling A4: the exact versions that would be frozen are shown, and must be confirmed, before submitting
  await expect(author.getByTestId('ap-lib-freeze')).toContainText('Submitting freezes exactly this');
  await expect(author.getByTestId('ap-lib-ask-ok')).toBeDisabled();
  await author.getByTestId('ap-lib-ask-text').fill('Synthetic test item — please review.');
  await author.getByTestId('ap-lib-freeze-ack').check(); // the exact versions that would be frozen were shown
  await author.getByTestId('ap-lib-ask-ok').click();
  await state(author, 'in_review');
  await checker.goto(path); await ready(checker);
  await state(checker, 'in_review');
  await expect(checker.getByTestId('ap-lib-candidate')).toContainText('Frozen for review'); // the reviewer sees what it froze
  await checker.getByTestId('ap-lib-approve').click();
  await state(checker, 'approved');
  await publisher.goto(path); await ready(publisher);
  await state(publisher, 'approved');
  await expect(publisher.getByTestId('ap-lib-publish')).toContainText(`Publish version ${version}`);
  await publisher.getByTestId('ap-lib-publish').click();
  await state(publisher, 'published');
  await again(author);
  await state(author, 'published');
  await expect(author.getByTestId('ap-lib-tag')).toHaveText(`Version ${version} published`);
};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async ({ browser }) => {
  author = await open(browser, 'survey_applauthor');
  checker = await open(browser, 'survey_applchecker');
  publisher = await open(browser, 'survey_applpublisher');
});
test.afterAll(async () => { expect(refused, 'requests refused as too frequent').toEqual([]); for (const c of contexts) await c.close(); });

test('X2.1 primary criterion: a variable, into a profile, into a named AND / OR / NOT condition — saved, published by three people, reused at its exact version', async () => {
  test.setTimeout(240_000);
  await ready(author);
  // ---- the showcase library is the SAVED one, published through the governed API by three people
  await author.getByTestId('ap-nav-1').click();
  await expect(author.getByTestId('ap-variable-count')).toContainText('of ');
  await author.getByTestId('ap-variable-nftf').click();
  await state(author, 'published');
  await expect(author.getByTestId('ap-variable-source-panel')).toContainText(/not mapped|no source/i); // nothing invented for NFTF
  await author.getByTestId('ap-lib-history').click();
  await expect(author.getByTestId('ap-lib-version-1')).toContainText('submitted by E2E Applicability Author, approved by E2E Applicability Checker, published by E2E Applicability Publisher');
  await expect(author.getByTestId('ap-lib-events')).toContainText('Published by E2E Applicability Publisher');
  await shot(author, '41-variable-library-persisted-published');

  // ---- 1. create a reusable variable; it is saved as a DRAFT and survives a reload
  await author.getByTestId('ap-variable-new').click();
  await author.getByTestId('ap-var-name').fill('Senior applicant');
  await author.getByTestId('ap-var-description').fill('The applicant is aged 62 or over (synthetic illustration, no source defined).');
  for (let i = 0; i < 5; i += 1) await author.getByTestId('ap-var-next').click();
  await author.getByTestId('ap-var-save').click();
  await expect(author.getByTestId('ap-variable-drawer')).toHaveCount(0);
  await author.getByTestId('ap-variable-senior_applicant').click();
  await state(author, 'draft');
  await expect(author.getByTestId('ap-lib-says')).toContainText('It is not published');
  await author.reload(); await ready(author); // a new page load: everything in the tab is gone, the library is not
  await author.getByTestId('ap-nav-1').click();
  await author.getByTestId('ap-variable-senior_applicant').click();
  await state(author, 'draft');
  await expect(author.getByTestId('ap-variable-inspector')).toContainText('aged 62 or over');
  await shot(author, '42-variable-draft-saved-survives-reload');

  // ---- 2. compose it into an application profile. A draft variable is NOT a published dependency: the profile
  //         can be saved, and cannot be submitted, until the variable is published
  await author.goto(`${B}/profiles?p=new_business`); await ready(author);
  await state(author, 'published');
  await pick(author, 'ap-profile-add-0', 'senior_applicant');
  await state(author, 'unsaved');
  await expect(author.getByTestId('ap-prototype-note')).toContainText('1 unsaved');
  await expect(author.getByTestId('ap-lib-says')).toContainText('Saving starts draft version 2. Published version 1 does not change.');
  await shot(author, '43-profile-unsaved-change', false);
  await author.getByTestId('ap-lib-save').click();
  await state(author, 'draft');
  await expect(author.getByTestId('ap-lib-blockers')).toContainText('is not published yet');
  await expect(author.getByTestId('ap-lib-submit')).toBeDisabled();
  await shot(author, '44-profile-blocked-by-unpublished-variable');

  // ---- 3. three different people publish the variable. The author cannot approve; the checker cannot publish
  const variable = `${B}/variables?v=senior_applicant`;
  await author.goto(variable); await ready(author);
  await author.getByTestId('ap-lib-submit').click();
  await author.getByTestId('ap-lib-ask-text').fill('A new synthetic variable for the showcase.');
  await author.getByTestId('ap-lib-freeze-ack').check(); // the exact versions that would be frozen were shown
  await author.getByTestId('ap-lib-ask-ok').click();
  await state(author, 'in_review');
  await expect(author.getByTestId('ap-lib-approve')).toBeDisabled(); // the submitter, and without the permission
  await shot(author, '45-variable-submitted-author-cannot-approve', false);
  await checker.goto(variable); await ready(checker);
  await state(checker, 'in_review');
  await expect(checker.getByTestId('ap-lib-says')).toContainText('Submitted by E2E Applicability Author');
  // returned once, with a reason — and the author sees it
  await checker.getByTestId('ap-lib-return').click();
  await checker.getByTestId('ap-lib-ask-text').fill('Please say that no source has been defined.');
  await checker.getByTestId('ap-lib-ask-ok').click();
  await state(checker, 'returned');
  await expect(checker.getByTestId('ap-lib-submit')).toBeDisabled(); // the checker may decide, not draft or submit
  await again(author);
  await state(author, 'returned');
  await expect(author.getByTestId('ap-lib-says')).toContainText('E2E Applicability Checker returned it: “Please say that no source has been defined.”');
  await shot(author, '46-variable-returned-with-reason', false);
  await through(variable, 1);
  await expect(checker.getByTestId('ap-lib-tag')).toBeVisible();
  await author.getByTestId('ap-lib-history').click();
  await expect(author.getByTestId('ap-lib-events')).toContainText('Returned to the author by E2E Applicability Checker');
  await expect(author.getByTestId('ap-lib-version-1')).toContainText('published by E2E Applicability Publisher');
  await shot(author, '47-variable-published-by-three-people');

  // ---- 4. now the profile can be submitted; it becomes version 2 and pins the variable's exact version
  const profile = `${B}/profiles?p=new_business`;
  await author.goto(profile); await ready(author);
  await state(author, 'draft');
  await expect(author.getByTestId('ap-lib-blockers')).toHaveCount(0);
  await author.getByTestId('ap-lib-submit').click();
  await expect(author.getByTestId('ap-lib-freeze-VARIABLE-senior_applicant')).toHaveAttribute('data-version', '1');
  await expect(author.getByTestId('ap-lib-freeze-PROFILE-common')).toContainText('version 1');
  await shot(author, '61-submit-shows-exact-versions-to-be-frozen', false);
  await author.getByRole('button', { name: 'Cancel' }).click();
  await through(profile, 2);
  await author.getByTestId('ap-lib-history').click();
  await expect(author.getByTestId('ap-lib-version-2')).toContainText('variable senior_applicant v1');
  await expect(author.getByTestId('ap-lib-version-1')).toHaveAttribute('data-status', 'SUPERSEDED'); // kept, not rewritten
  await expect(author.getByTestId('ap-merged-senior_applicant')).toBeVisible();
  await shot(author, '48-profile-version-2-pins-the-variable');

  // ---- 5. a named condition with AND, OR and NOT, nested, reading saved conditions and the new variable — tested
  //         live by the server, then published by three people
  await author.goto(`${B}/conditions?c=new`); await ready(author);
  await author.getByTestId('ap-condition-name').fill('Senior ILP outside NFTF');
  await author.getByTestId('ap-level-advanced').click();
  await pick(author, 'ap-lab-builder-add-saved', 'is_ilp');
  await pick(author, 'ap-lab-builder-g-add-saved', 'nftf_applies');
  await author.getByTestId('ap-lab-builder-n1-negate').click();
  await author.getByTestId('ap-lab-builder-g-add-group').click();
  await pick(author, 'ap-lab-builder-g2-add-fact', 'senior_applicant');
  await pick(author, 'ap-lab-builder-g2-add-fact', 'replacement');
  const says = author.getByTestId('ap-lab-builder-sentence');
  await expect(says).toContainText('“Is ILP”');
  await expect(says).toContainText(/not .*“NFTF applies”/);
  await expect(says).toContainText(/Senior applicant is yes or Replacement applies is yes/);
  await expect(author.getByTestId('ap-test-result')).toHaveAttribute('data-result', /TRUE|FALSE|UNKNOWN/);
  await author.getByTestId('ap-condition-save').click();
  await state(author, 'draft');
  await shot(author, '49-condition-lab-and-or-not-saved-draft');
  const condition = `${B}/conditions?c=senior_ilp_outside_nftf`;
  await expect(author).toHaveURL(/c=senior_ilp_outside_nftf/);
  await through(condition, 1);
  await author.getByTestId('ap-lib-history').click();
  await expect(author.getByTestId('ap-lib-version-1')).toContainText('condition is_ilp v1');
  await expect(author.getByTestId('ap-lib-version-1')).toContainText('condition nftf_applies v1');
  await expect(author.getByTestId('ap-lib-version-1')).toContainText('variable senior_applicant v1');
  await shot(author, '50-condition-published-with-exact-pins');

  // ---- 6. the exact published version is reused in the Applicability Designer (the policy itself stays in the tab)
  await author.getByTestId('ap-nav-3').click();
  await author.getByTestId('ap-policy-new-blank').click();
  await author.getByTestId('ap-policy-create-name').fill('Senior review (library reuse)');
  await author.getByTestId('ap-policy-create-save').click();
  await expect(author.getByTestId('ap-designer')).toBeVisible();
  await author.getByTestId('ap-add-requirement').click();
  await author.getByTestId('ap-smart-when').click();
  await author.getByTestId('ap-editor-name').fill('Senior ILP applicants outside NFTF need Survey A');
  await pick(author, 'ap-editor-builder-g-add-saved', 'senior_ilp_outside_nftf');
  await author.getByTestId('ap-editor-builder-n0-remove').click(); // only the new condition
  await expect(author.getByTestId('ap-editor-builder-sentence')).toContainText('“Senior ILP outside NFTF”');
  await expect(editor(author)).toContainText('saved condition · version 1'); // the exact published version
  await author.getByTestId('ap-editor-add-survey').click();
  await author.getByTestId('ap-survey-option-S-APPL-DEMO-ILP-select').click();
  await author.getByTestId('ap-survey-picker-add').click();
  await author.getByTestId('ap-editor-done').click();
  await expect(author.getByTestId('ap-policy-bar')).toHaveAttribute('data-state', 'unsaved'); // the policy is saved only when the person saves it
  await author.getByTestId('ap-save-draft').click();
  await expect(author.getByTestId('ap-policy-bar')).toHaveAttribute('data-state', 'saved');
  await shot(author, '51-designer-reuses-the-published-condition');
});

test('X2.2 two people edit the same draft: the second save is refused, nothing is overwritten, and the choice is explicit', async () => {
  const one = author;
  const two = await author.context().newPage(); // the same person in a second tab stands for a second editor
  const url = `${B}/profiles?p=rider_extension`;
  await one.goto(url); await ready(one);
  await two.goto(url); await ready(two);
  const what = (p: Page) => p.getByLabel('What this profile is for');
  await what(one).fill('Changed in tab one (synthetic).');
  await state(one, 'unsaved');
  await what(two).fill('Changed in tab two (synthetic).');
  await two.getByTestId('ap-lib-save').click();
  await state(two, 'draft');
  // tab one still holds its own change, made on the earlier revision
  await one.bringToFront();
  await one.getByTestId('ap-lib-save').click({ timeout: 2500 }).catch(() => undefined); // the server refuses it (or the tab already noticed)
  await state(one, 'conflict');
  await expect(one.getByTestId('ap-lib-says')).toContainText('saved revision');
  await expect(one.getByTestId('ap-lib-says')).toContainText('Nothing of yours was saved and nothing of theirs was overwritten');
  await expect(what(one)).toHaveValue('Changed in tab one (synthetic).'); // their own work is still on the screen
  await shot(one, '52-concurrent-edit-conflict', false);
  // choice 1: take what is saved
  await one.getByTestId('ap-lib-reload').click();
  await state(one, 'draft');
  await expect(what(one)).toHaveValue('Changed in tab two (synthetic).');
  // choice 2, the other way round: keep mine, deliberately, as the NEXT revision
  await what(one).fill('Tab one, on purpose (synthetic).');
  await two.bringToFront();
  await what(two).fill('Tab two again (synthetic).');
  await two.getByTestId('ap-lib-save').click({ timeout: 2500 }).catch(() => undefined);
  if ((await bar(two).getAttribute('data-state')) === 'conflict') await two.getByTestId('ap-lib-overwrite').click();
  await state(two, 'draft');
  await one.bringToFront();
  await one.getByTestId('ap-lib-save').click({ timeout: 2500 }).catch(() => undefined);
  await state(one, 'conflict');
  await one.getByTestId('ap-lib-overwrite').click();
  await state(one, 'draft');
  await expect(what(one)).toHaveValue('Tab one, on purpose (synthetic).');
  await one.getByTestId('ap-lib-history').click();
  await expect(one.getByTestId('ap-lib-events').locator('li[data-event="DRAFT_SAVED"]')).not.toHaveCount(0); // every save is in the history
  // the draft is discarded: the published version was never touched
  await one.getByTestId('ap-lib-discard').click();
  await state(one, 'published');
  await expect(what(one)).toHaveValue('Added when riders can be selected.');
  await two.close();
});

test('X2.3 without the applicability permissions the saved library is closed, and the screen says so', async ({ browser }) => {
  const reader = await open(browser, 'survey_reader'); // may read Survey Studio; holds no applicability permission
  await expect(reader.getByTestId('ap-catalogue')).toHaveAttribute('data-library', 'forbidden', { timeout: 25_000 });
  await expect(reader.getByTestId('ap-prototype-note')).toContainText('no access');
  await reader.getByTestId('ap-nav-1').click();
  await expect(reader.getByTestId('ap-variable-count')).toHaveText('0 of 0'); // nothing leaks, and no built-in example stands in
  await reader.getByTestId('ap-prototype-note').click();
  await expect(reader.getByTestId('ap-kept-library')).toContainText('not permitted');
  await shot(reader, '53-library-closed-without-permission', false);
  const direct = await reader.evaluate(async () => (await fetch('/api/v1/applicability/assets')).status);
  expect(direct).toBe(403);
});

test('X2.4 a newer published survey version is adopted deliberately; the pinned reference never moves by itself', async () => {
  test.setTimeout(180_000);
  const FIX = 'S-APPL-TEST-ADOPT'; // an isolated TEST fixture survey; the showcase surveys are not touched
  await author.goto(`${B}/policies`); await ready(author);
  await author.getByTestId('ap-policy-new-blank').click();
  await author.getByTestId('ap-policy-create-name').fill('Adoption test');
  await author.getByTestId('ap-policy-create-save').click();
  await author.getByTestId('ap-add-requirement').click();
  await author.getByTestId('ap-smart-when').click();
  await author.getByTestId('ap-editor-add-survey').click();
  await author.getByTestId(`ap-survey-option-${FIX}-select`).click();
  await author.getByTestId('ap-survey-picker-add').click();
  const ticket = author.getByTestId(`ap-editor-ticket-${FIX}`);
  await expect(ticket).toHaveAttribute('data-version', '1.0');
  const before = await ticket.locator('small').first().innerText();
  await expect(author.getByTestId(`ap-editor-ticket-${FIX}-newer`)).toHaveCount(0);
  // Survey Studio publishes version 2 — through its governed API, by three people — while the policy is open
  fixtureSurvey(2);
  await author.getByTestId('ap-editor-done').click();
  await again(author);
  await author.getByTestId('ap-card-r1-edit').click();
  // nothing moved: the same version, the same fingerprint — and the newer one is offered, not applied
  await expect(ticket).toHaveAttribute('data-version', '1.0');
  expect(await ticket.locator('small').first().innerText()).toBe(before);
  await expect(author.getByTestId(`ap-editor-ticket-${FIX}-newer`)).toContainText('Version 2.0 is now published. This requirement stays on 1.0 until you adopt it.');
  await shot(author, '54-newer-survey-version-offered-not-applied', false);
  await author.getByTestId(`ap-editor-ticket-${FIX}-adopt`).click();
  await expect(ticket).toHaveAttribute('data-version', '2.0');
  expect(await ticket.locator('small').first().innerText()).not.toBe(before); // a different published fingerprint
  await expect(author.getByTestId(`ap-editor-ticket-${FIX}-newer`)).toHaveCount(0);
  await author.getByTestId('ap-editor-done').click();
  await expect(author.getByTestId('ap-undo')).toHaveAttribute('title', /Undo: Adopt version 2\.0/); // a deliberate, undoable edit
  await author.getByTestId('ap-undo').click();
  await expect(author.getByTestId(`ap-card-r1-ticket-${FIX}`)).toHaveAttribute('data-version', '1.0');
  await shot(author, '55-adoption-undone-back-on-version-1', false);
});

test('X2.5 ordering by keyboard and by dragging; a palette item dragged onto a requirement', async () => {
  await author.goto(`${B}/policies`); await ready(author);
  await author.getByTestId('ap-policy-new-template').click();
  await author.getByTestId('ap-policy-template-additive').click();
  await author.getByTestId('ap-policy-create-name').fill('Ordering test');
  await author.getByTestId('ap-policy-create-save').click();
  await expect(author.getByTestId('ap-designer')).toBeVisible();
  const cards = () => author.locator('.ap-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('ap-card-', '')));
  const order = () => author.locator('[data-testid="ap-order"] ol > li').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('ap-order-', '')));
  const first = await cards();
  expect(first.length).toBeGreaterThanOrEqual(2);
  // ---- keyboard: focus the "move down" control of the first requirement and press Enter
  await author.getByTestId(`ap-card-${first[0]}`).click();
  await author.getByTestId(`ap-card-${first[0]}-down`).focus();
  await author.keyboard.press('Enter');
  expect((await cards()).slice(0, 2)).toEqual([first[1], first[0]]);
  await author.getByTestId(`ap-card-${first[0]}-up`).focus();
  await author.keyboard.press('Space');
  expect(await cards()).toEqual(first);
  // ---- keyboard: the delivery order
  const o = await order();
  expect(o.length).toBeGreaterThanOrEqual(2);
  await author.getByTestId(`ap-order-${o[0]}-down`).focus();
  await author.keyboard.press('Enter');
  expect((await order()).slice(0, 2)).toEqual([o[1], o[0]]);
  // ---- dragging: the delivery order back again (the second row dropped on the first)
  await author.getByTestId(`ap-order-${o[0]}`).dragTo(author.getByTestId(`ap-order-${o[1]}`));
  expect(await order()).toEqual(o);
  // ---- dragging: a requirement by its grip onto another changes the order of the cards
  await author.getByTestId(`ap-card-${first[0]}`).locator('.ap-card-grip').dragTo(author.getByTestId(`ap-card-${first[1]}`));
  expect(await cards()).not.toEqual(first);
  await author.getByTestId('ap-undo').click();
  expect(await cards()).toEqual(first);
  // ---- dragging: a saved condition from the palette onto a requirement joins its condition
  if (!(await author.getByTestId('ap-palette-pane').count())) await author.getByTestId('ap-toggle-palette').click();
  await author.getByTestId('ap-palette-conditions').click();
  await author.getByTestId('ap-pal-condition-replacement_applies').dragTo(author.getByTestId(`ap-card-${first[0]}`));
  await expect(author.getByTestId(`ap-card-${first[0]}`)).toContainText('Replacement applies');
  await shot(author, '56-ordering-keyboard-and-drag');
});

test('X2.6 graph focus: at 20, 50 and 100 requirements the selection and its neighbourhood are inside the viewport', async () => {
  test.setTimeout(240_000);
  /** Where every drawn node is, relative to the canvas viewport. */
  const view = () => author.evaluate(() => {
    const stage = document.querySelector('.ap-canvas-stage')!.getBoundingClientRect();
    const inside = (r: DOMRect) => r.left >= stage.left - 2 && r.right <= stage.right + 2 && r.top >= stage.top - 2 && r.bottom <= stage.bottom + 2;
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
    const on = document.querySelector('.react-flow__node .ap-node.on')?.getBoundingClientRect();
    const zoom = Number(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a.toFixed(2));
    return { total: nodes.length, inside: nodes.filter(inside).length, selected: on ? inside(on) : null, zoom, height: on?.height ?? 0 };
  });
  const settled = async () => { await author.waitForTimeout(900); return view(); };
  for (const n of [20, 50, 100]) {
    await author.goto(`${B}/policies`); await ready(author);
    await author.getByTestId(`ap-policy-scale-${n}`).click();
    await author.getByTestId('ap-view-canvas').click();
    await expect(author.getByTestId('ap-canvas-large')).toHaveAttribute('data-mode', 'overview');
    let v = await settled();
    expect(v.inside, `overview of ${n}`).toBe(v.total); // the whole overview is in view
    // ---- one requirement and everything that leads to and from it
    await pick(author, 'ap-canvas-goto', 'r7');
    await expect(author.locator('.ap-node.kind-requirement')).toHaveCount(1);
    v = await settled();
    expect(v.selected, `selected requirement of ${n} is inside the viewport`).toBe(true);
    expect(v.inside, `neighbourhood of ${n}: ${JSON.stringify(v)}`).toBe(v.total);
    expect(v.total).toBeGreaterThanOrEqual(3); // the requirement, what it reads and the survey it selects
    expect(v.zoom).toBeGreaterThanOrEqual(0.45); // readable: five columns beside an open inspector fit at about half size
    await shot(author, `57-graph-focus-${n}-requirement-in-view`, false);
    // ---- a survey's neighbourhood: every requirement that selects it
    await author.getByTestId('ap-canvas-overview').click();
    await author.getByTestId('ap-node-survey-S-APPL-DEMO-ILP').click();
    await expect(author.locator('.ap-node.kind-requirement')).toHaveCount(n / 5);
    v = await settled();
    expect(v.selected, `selected survey of ${n} is inside the viewport`).toBe(true);
    if (n === 20) expect(v.inside).toBe(v.total); // small enough to show whole
    await shot(author, `58-graph-focus-${n}-survey-neighbourhood`, false);
    // ---- search brings the hits into view
    await author.getByTestId('ap-canvas-overview').click();
    await author.getByTestId('ap-canvas-search').fill('Replacement');
    v = await settled();
    expect(v.total).toBeGreaterThan(0);
    expect(v.inside).toBeGreaterThan(0);
    await author.getByTestId('ap-canvas-search').fill('');
  }
});

test('X2.7 the header at 1440 is quiet, nothing overflows, and no serious accessibility violation on the library screens', async () => {
  await author.setViewportSize({ width: 1440, height: 900 });
  await author.goto(`${B}/variables?v=nftf`); await ready(author);
  const tools = await author.locator('.ap-top-tools').evaluate((el) => ({ children: el.children.length, wraps: el.getBoundingClientRect().height > 44, text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim() }));
  expect(tools.children).toBeLessThanOrEqual(4); // one status control, undo/redo, who you act as, search
  expect(tools.wraps).toBe(false);
  expect(tools.text.length).toBeLessThan(70);
  await shot(author, '59-header-1440-quiet', false);
  const found: string[] = [];
  const scan = async (name: string) => { await author.evaluate(() => window.scrollTo(0, 0)); await author.waitForTimeout(300); const r = await new AxeBuilder({ page: author }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze(); r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').forEach((x) => found.push(`${name}: ${x.id} (${x.nodes.length}) ${x.nodes[0]?.target.join(' ')}`)); };
  await author.getByTestId('ap-lib-history').click();
  await expect(author.getByTestId('ap-lib-events')).toBeVisible();
  await scan('variable with history');
  await author.getByTestId('ap-prototype-note').click();
  await scan('where things are kept');
  await author.getByTestId('ap-prototype-note').click();
  await author.goto(`${B}/profiles?p=new_business`); await ready(author); await scan('profile');
  await author.goto(`${B}/conditions?c=senior_ilp_outside_nftf`); await ready(author); await scan('condition');
  expect(found).toEqual([]);
  for (const width of [1280, 900, 390]) {
    await author.setViewportSize({ width, height: 900 });
    for (const path of ['variables?v=nftf', 'profiles?p=new_business', 'conditions?c=senior_ilp_outside_nftf']) {
      await author.goto(`${B}/${path}`); await ready(author);
      expect(await author.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${path} at ${width}`).toBeLessThanOrEqual(0);
    }
    if (width === 390) await shot(author, '60-library-at-phone-width');
  }
  await author.setViewportSize({ width: 1440, height: 900 });
});
