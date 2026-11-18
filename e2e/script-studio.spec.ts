import { expect, test, type Page } from '@playwright/test';
import { a11yAndLayout } from './cp04a-checks';
import { accounts, signIn } from './helpers';

// S2-A — editable Script Studio on the real stack (backend 8001 + call360_test): Create Script → Add Sections and
// Questions → Save Draft → Submit → Approve as a different authorised user → Publish → View Immutable Version, beside
// the existing historical script versions. The maker (USER, script.edit) cannot approve; the checker (S&C checker role)
// cannot edit; every step goes through the UI.
test.describe.configure({ timeout: 180_000 });

async function addNewQuestion(section: ReturnType<Page['getByTestId']>, code: string, wording: string, intent: string,
  setup?: (form: ReturnType<Page['getByTestId']>) => Promise<void>) {
  await section.getByTestId('add-question').click();
  const form = section.getByTestId('new-question-form');
  await form.getByLabel('Question code').fill(code);
  await form.getByLabel('Exact customer wording').fill(wording);
  await form.getByLabel('Intent (what the question establishes)').fill(intent);
  if (setup) await setup(form);
  await form.getByTestId('question-save').click();
  await expect(section.getByTestId(`edit-question-${code}`)).toBeVisible();
}

test('S2-A Script Studio: create, edit, submit, approve by a different checker, publish, immutable', async ({ page, browser }) => {
  const { user, checker } = accounts();
  const code = `S2A_E2E_${Date.now().toString(36).toUpperCase()}`;
  await signIn(page, user, '/scripts');
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Create the script (family + draft v1.0).
  await page.getByTestId('new-script').click();
  await page.getByLabel('Family code').fill(code);
  await page.getByLabel('Name', { exact: true }).fill('E2E sales verification (synthetic)');
  await page.getByTestId('new-script-create').click();
  await expect(page.getByTestId('draft-editor')).toContainText('You are editing draft v1.0');
  await expect(page.getByTestId('no-sections')).toBeVisible();

  // 2. Sections and questions: a new common module, then a reused published module with an inclusion condition.
  await page.getByTestId('add-section').click();
  const addForm = page.getByTestId('add-section-form');
  await addForm.getByLabel('Module code').fill(`${code}_CORE`);
  await addForm.getByLabel('Module name').fill('Core sales conduct (E2E)');
  await addForm.getByTestId('add-section-save').click();
  const core = page.getByTestId('edit-section').first();
  await expect(core).toContainText(`${code}_CORE`);
  await addNewQuestion(core, `Q-${code}-EXPLAINED`, 'Did the representative explain how the plan works?', 'Representative explained the plan');
  await addNewQuestion(core, `Q-${code}-TERM`, 'For how many years will you pay premiums?', 'Customer states the premium term', async (form) => {
    await form.getByLabel('Answer type').selectOption('NUMERIC');
    await form.getByLabel('Evaluation method').selectOption('NUMERIC_MATCH_POLICY_FACT');
    await form.getByLabel('Compare with policy fact').selectOption('premium_term_years');
  });
  await core.getByRole('button', { name: `Move Q-${code}-TERM up` }).click();
  await expect(core.locator('[data-testid^="edit-question-"]').first()).toHaveAttribute('data-testid', `edit-question-Q-${code}-TERM`);
  // Edit the first question's wording (a new question revision) and link a control.
  const explained = core.getByTestId(`edit-question-Q-${code}-EXPLAINED`);
  await explained.getByTestId(`edit-Q-${code}-EXPLAINED`).click();
  await explained.getByLabel('Exact customer wording').fill('Did the representative explain how this plan works?');
  await explained.getByLabel('Reason for this change').fill('Clearer wording');
  await explained.getByTestId('question-save').click();
  await expect(explained).toContainText('how this plan works?');
  await expect(explained).toContainText('r2');
  await explained.getByTestId(`controls-Q-${code}-EXPLAINED`).click();
  await explained.getByTestId('add-control-link').click();
  await explained.getByLabel('Control', { exact: true }).selectOption({ index: 1 });
  await explained.getByLabel('Rationale').fill('Representative explanation (synthetic)');
  await explained.getByTestId('controls-save').click();
  await expect(explained).toContainText('1 control');
  await page.getByTestId('add-section').click();
  await page.getByTestId('sec-reuse').check();
  const moduleSelect = page.getByTestId('add-section-form').getByLabel('Published module', { exact: true });
  const ilp = await moduleSelect.locator('option').evaluateAll((os) => (os as HTMLOptionElement[]).find((o) => o.text.startsWith('ILP r1'))?.value ?? '');
  await moduleSelect.selectOption(ilp);
  await page.getByTestId('cond-add-sec-cond').click();
  await page.getByLabel('Condition 1 fact').selectOption('is_ilp');
  await page.getByTestId('add-section-save').click();
  await expect(page.getByTestId('edit-section')).toHaveCount(2);
  await expect(page.getByTestId('edit-section').nth(1)).toContainText('Is ILP is yes');
  await a11yAndLayout(page, 's2a-draft-editor');
  await page.setViewportSize({ width: 1440, height: 900 });

  // 3. Validate and submit (the content freezes with a manifest checksum).
  await page.getByTestId('validate').click();
  await expect(page.getByTestId('validation-status')).toHaveText('Valid');
  await page.getByLabel('Change summary for the reviewer').fill('First version of the E2E verification script');
  await page.getByTestId('submit-review').click();
  await expect(page.getByTestId('immutable-note')).toContainText('Locked for review');
  await page.getByTestId('sv-tab-review').click();
  await expect(page.getByTestId('review-panel')).toContainText('Awaiting an S&C checker');
  await expect(page.getByTestId('approve')).toHaveCount(0); // the maker holds no approval permission
  const familyUrl = page.url();

  // 4. A different, authorised checker reviews the diff, approves and publishes.
  const ctx = await browser.newContext({ baseURL: new URL(familyUrl).origin });
  const cp = await ctx.newPage();
  await signIn(cp, checker, new URL(familyUrl).pathname + new URL(familyUrl).search);
  await cp.setViewportSize({ width: 1440, height: 900 });
  await cp.getByTestId('sv-tab-diff').click();
  await expect(cp.getByTestId('diff-summary')).toContainText('6 added'); // 2 new + 4 reused ILP questions
  await expect(cp.getByTestId(`diff-Q-${code}-EXPLAINED`)).toContainText('how this plan works?');
  await cp.getByTestId('sv-tab-review').click();
  await cp.getByLabel('Reviewer reason').fill('Structure, expectations and controls reviewed');
  // S2-A.1: the mandatory question without a mapped control is flagged and must be acknowledged before approving.
  const ack = cp.getByTestId('unmapped-ack');
  await expect(ack).toContainText(`Q-${code}-TERM`);
  await expect(cp.getByTestId('approve')).toBeDisabled();
  for (const box of await ack.getByRole('checkbox').all()) await box.check();
  await cp.getByTestId('approve').click();
  await expect(cp.getByTestId('publish')).toBeVisible();
  await a11yAndLayout(cp, 's2a-review-publish');
  await cp.setViewportSize({ width: 1440, height: 900 });
  await cp.getByTestId('publish').click();
  await expect(cp.getByTestId('published-note')).toContainText('immutable');
  await cp.getByTestId('sv-tab-history').click();
  await expect(cp.getByTestId('history')).toContainText('Published');
  await expect(cp.getByTestId('history')).toContainText('Approved');
  await expect(cp.getByTestId('history')).toContainText('Submitted for review');
  await ctx.close();

  // 5. The maker sees the immutable published version beside the historical seeded versions.
  await page.reload();
  await expect(page.getByTestId('immutable-note')).toContainText('Immutable version');
  await expect(page.getByTestId('draft-editor')).toHaveCount(0);
  const vid = new URL(page.url()).searchParams.get('version')!;
  const detail = await (await page.request.get(`/api/v1/script-versions/${vid}`)).json();
  expect(detail.status).toBe('PUBLISHED');
  await expect(page.getByTestId('manifest-sha')).toHaveText(detail.manifest_sha256);
  expect(detail.author_ref).not.toBe(detail.reviewer_ref);
  await page.goto('/scripts');
  const lib = page.getByTestId('script-library');
  await expect(lib.getByRole('link', { name: `${code} v1.0` })).toBeVisible();
  await expect(lib.getByRole('link', { name: 'SALES_VERIFICATION_SG v1.1' })).toBeVisible();
  await expect(lib).toContainText('Superseded'); // historical seeded versions stay listed

  // 6. S2-A.1: start a new draft version and abandon it — audited, frozen, nothing deleted.
  await lib.getByRole('link', { name: `${code} v1.0` }).click();
  await page.getByTestId('new-draft').click();
  await expect(page.getByTestId('draft-editor')).toContainText('You are editing draft v1.1');
  await page.getByTestId('abandon-open').click();
  await page.getByLabel('Reason for abandoning').fill('Not needed after review (E2E)');
  await page.getByTestId('abandon-confirm').click();
  await expect(page.getByTestId('immutable-note')).toContainText('Abandoned draft');
  await page.getByTestId('sv-tab-history').click();
  await expect(page.getByTestId('history')).toContainText('Abandoned');
  await expect(page.getByTestId('new-draft')).toBeEnabled(); // the family can start again
});
