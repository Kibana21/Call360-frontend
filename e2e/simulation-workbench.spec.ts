import { expect, test, type Page } from '@playwright/test';
import { a11yAndLayout } from './cp04a-checks';
import { accounts, signIn } from './helpers';
import { api, buildLifecycleScript, publishDraft } from './lifecycle-helpers';

// S2-E — Simulation Workbench on the real stack: a DRAFT lifecycle script (governed authoring API) → scenarios built in
// the UI (structured steps, dry run, expectations from actual) → batch run with expected vs actual → coverage →
// publish (different checker) and open draft B → compare A vs B → interactive version test of the draft on a synthetic
// case. No assignment, case state, attempt or session changes.
test.describe.configure({ timeout: 240_000 });

async function buildScenario(page: Page, vid: string, name: string, step?: { question: string; value: 'yes' | 'no' }) {
  await page.goto('/simulator?tab=scenarios&scenario=new');
  await expect(page.getByTestId('scn-editor')).toBeVisible();
  await page.getByTestId('scn-name').fill(name);
  await page.getByTestId('scn-version').selectOption(vid);
  await page.getByTestId('scn-fact-product_family').selectOption('PROTECTION');
  await page.getByTestId('scn-band').selectOption('LOW');
  await expect(page.getByTestId('scn-plan')).toContainText('Lifecycle gates present');
  if (step) {
    await page.getByTestId('scn-add-step').click();
    await page.getByTestId('scn-step-1-q').selectOption(step.question);
    await page.getByTestId('scn-step-1-value').selectOption(step.value);
  }
  await page.getByTestId('scn-dry-run').click();
  await expect(page.getByTestId('scn-preview')).toContainText('Compliance');
  await page.getByTestId('scn-use-actual').click();
  await page.getByTestId('scn-save').click();
  await expect(page.getByTestId('scn-editor')).toBeVisible();
  await expect(page).toHaveURL(/scenario=[0-9a-f-]{36}/);
}

test('S2-E: draft script → scenarios → batch run → coverage → version comparison → interactive version test', async ({ page, browser }) => {
  const { user, checker } = accounts();
  const n = 500000 + Math.floor(Math.random() * 90000);
  const code = `WBE_${n}`;
  const prefix = `WBE${n}`;
  await signIn(page, user, '/simulator');
  await page.setViewportSize({ width: 1440, height: 900 });
  const author = await api(page);
  const vid = await buildLifecycleScript(author, null, code, prefix); // left as a DRAFT
  const caseRow = (await (await page.request.get('/api/v1/script-simulations/cases?include_unassigned=true')).json()).items[0];
  const before = await (await page.request.get(`/api/v1/cases/${caseRow.case_id}`)).json();
  const assignments = (await (await page.request.get(`/api/v1/cases/${caseRow.case_id}/script-assignment`)).text());

  // Scenario library: two scenarios configured in the UI against the draft.
  await buildScenario(page, vid, 'Identity fails (E2E)', { question: `Q-${prefix}-ID-NAME`, value: 'no' });
  await expect(page.getByTestId('scn-exp-termination')).toHaveValue('IDENTITY_FAILED');
  await buildScenario(page, vid, 'Normal closing (E2E)');
  await expect(page.getByTestId('scn-exp-outcome')).toHaveValue('COMPLETED');
  await a11yAndLayout(page, 's2e-scenario-editor');
  await page.setViewportSize({ width: 1440, height: 900 });

  // Batch run: expected versus actual, explained; coverage.
  await page.goto('/simulator?tab=scenarios');
  const mine = [page.getByLabel('Select Identity fails (E2E)'), page.getByLabel('Select Normal closing (E2E)')];
  for (const box of mine) await expect(box).toHaveCount(1); // other specs may also have saved scenarios
  for (const box of mine) await box.check();
  await expect(page.getByTestId('scn-run-selected')).toContainText('(2)');
  await page.getByTestId('scn-run-selected').click();
  await expect(page.getByTestId('batch-header')).toContainText('Scenario run');
  await expect(page.getByTestId('batch-totals')).toContainText('Passed2');
  await expect(page.getByTestId('coverage')).toContainText('not a measure of compliance quality');
  await expect(page.getByTestId('coverage')).toContainText('Identity failed');
  await page.locator('[data-testid^="result-open-"]').first().click();
  await expect(page.getByTestId('result-detail')).toContainText('Every expectation matched');
  await a11yAndLayout(page, 's2e-test-run');
  await page.setViewportSize({ width: 1440, height: 900 });

  // Publish A (different checker), open draft B and add an item, then compare A vs B in the UI.
  const cctx = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const cpage = await cctx.newPage();
  await signIn(cpage, checker, '/scripts');
  await publishDraft(author, await api(cpage), vid);
  await cctx.close();
  const fam = (await (await page.request.get(`/api/v1/script-versions/${vid}`)).json()).script_family_id;
  const vb = String((await author.post(`/scripts/${fam}/drafts`, {}, 201)).script_version_id);
  const detail = await (await page.request.get(`/api/v1/script-versions/${vb}`)).json();
  const core = detail.sections.find((s: { module_code: string }) => s.module_code === `${code}_CORE`);
  await author.post(`/script-versions/${vb}/sections/${core.section_id}/questions`, { expected_row_version: detail.row_version, question_code: `Q-${prefix}-NEW`,
    content: { intent: 'Synthetic added item (E2E)', category: 'OTHER', customer_wording: '[Synthetic example, not approved wording] Is the premium affordable?',
      delivery_mode: 'CONVERSATIONAL', answer_type: 'YES_NO', mandatory: false, expected_answer_policy: 'COLLECT_ONLY' } });
  await page.goto('/simulator?tab=runs');
  await page.getByTestId('cmp-a').selectOption(vid);
  await page.getByTestId('cmp-b').selectOption(vb);
  await expect(page.getByTestId('cmp-scenarios')).toContainText('2 selected');
  await page.getByTestId('cmp-run').click();
  await expect(page.getByTestId('batch-header')).toContainText('Version comparison');
  await expect(page.getByTestId('comparison')).toContainText(`Added in B: Q-${prefix}-NEW`);
  await expect(page.getByTestId('coverage')).toHaveCount(2);

  // Interactive version test of draft B on a synthetic case (isolated snapshot; no assignment).
  await page.goto(`/simulator?version=${vb}&case=${caseRow.case_id}`);
  await expect(page.getByTestId('sim-plan')).toContainText('Version test');
  await page.getByTestId('sim-start').click();
  await expect(page.getByTestId('sim-run-header')).toContainText('In progress');
  await expect(page.getByTestId('sim-lifecycle')).toContainText('All identity and consent outcomes are simulated');
  await expect(page.getByTestId('sim-save-scenario')).toBeVisible();

  const after = await (await page.request.get(`/api/v1/cases/${caseRow.case_id}`)).json();
  expect([after.state, after.attempts, after.sessions]).toEqual([before.state, before.attempts, before.sessions]);
  expect(await (await page.request.get(`/api/v1/cases/${caseRow.case_id}/script-assignment`)).text()).toBe(assignments); // no assignment change
});
