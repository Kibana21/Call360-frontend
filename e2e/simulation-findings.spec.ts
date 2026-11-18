import { expect, test, type Page } from '@playwright/test';
import { a11yAndLayout } from './cp04a-checks';
import { accounts, signIn } from './helpers';
import { api, buildLifecycleScript } from './lifecycle-helpers';

// S3-B — governed finding rules and simulated findings on the real stack: the author drafts finding rules in the UI →
// a different S&C checker approves and publishes them → synthetic callback (version test) with a wrong premium term →
// evaluate answers → generate findings (severity, controls, evidence) → re-generate (no duplicates) → a correct
// conversation produces no findings. No case, attempt, session, assignment or operational finding changes.
test.describe.configure({ timeout: 240_000 });

async function deliver(page: Page, code: string) {
  await expect(page.getByTestId('sim-action')).toContainText(`${code}#`);
  await page.getByTestId('sim-present').click();
}
async function yesNo(page: Page, code: string, yes: boolean) {
  await deliver(page, code);
  await expect(page.getByTestId('sim-answer')).toBeVisible();
  await page.getByTestId(yes ? 'sim-yes' : 'sim-no').click();
}
async function conversation(page: Page, p: string, termAnswer: number) {
  await page.getByTestId('sim-start').click();
  await deliver(page, `Q-${p}-OPEN`);
  await yesNo(page, `Q-${p}-ID-NAME`, true);
  await yesNo(page, `Q-${p}-ID-DOB`, true);
  await deliver(page, `Q-${p}-DISC`);
  await yesNo(page, `Q-${p}-PROCEED`, true);
  await yesNo(page, `Q-${p}-REC`, true);
  await yesNo(page, `Q-${p}-POLICY`, true);
  await yesNo(page, `Q-${p}-UNDERSTOOD`, true);
  await deliver(page, `Q-${p}-TERM`);
  await page.getByTestId('sim-num').fill(String(termAnswer));
  await page.getByTestId('sim-submit').click();
  await deliver(page, `Q-${p}-CLOSE`);
  await page.getByTestId('sim-end').click();
  await expect(page.getByTestId('sim-run-header')).toContainText('Completed');
  await page.getByTestId('sim-evaluate').click();
  await expect(page.getByTestId('sim-eval-header')).toContainText('EVL-');
}

test('S3-B: finding rules (maker-checker) → simulate → evaluate → findings with severity, controls and evidence', async ({ page, browser }) => {
  const { user, checker } = accounts();
  const n = 700000 + Math.floor(Math.random() * 90000);
  const code = `FDE_${n}`;
  const p = `FDE${n}`;
  await signIn(page, user, '/finding-rules');
  await page.setViewportSize({ width: 1440, height: 900 });
  const author = await api(page);
  const vid = await buildLifecycleScript(author, null, code, p);
  const detail = await (await page.request.get(`/api/v1/script-versions/${vid}`)).json();
  const core = detail.sections.find((s: { module_code: string }) => s.module_code === `${code}_CORE`);
  await author.post(`/script-versions/${vid}/sections/${core.section_id}/questions`, { expected_row_version: detail.row_version, question_code: `Q-${p}-TERM`,
    content: { intent: 'Customer states the premium term (E2E)', category: 'POLICY_FACT', customer_wording: '[Synthetic example, not approved wording] For how many years will you pay premiums?',
      delivery_mode: 'CONVERSATIONAL', answer_type: 'NUMERIC', mandatory: true, expected_answer_policy: 'NUMERIC_MATCH_POLICY_FACT', policy_fact_key: 'premium_term_years',
      evaluation: { operator: 'EQ', unit: 'YEARS' } } });

  // 1. Author drafts finding rules in the UI (governed values; severity with justification).
  await page.goto('/finding-rules');
  await page.getByTestId('frs-new').click();
  await expect(page.getByTestId('frs-detail')).toBeVisible();
  await page.getByTestId('frs-add-rule').click();
  const f = page.getByTestId('frs-rule-form');
  await f.getByTestId('frs-f-code').fill('FR-E2E-TERM-MISMATCH');
  await f.getByTestId('frs-f-question').selectOption(`Q-${p}-TERM`);
  await f.getByTestId('frs-f-trigger').selectOption('MISMATCH');
  await f.getByTestId('frs-f-category').selectOption('FACT_MISMATCH');
  await f.getByTestId('frs-f-severity').selectOption('HIGH');
  await f.getByTestId('frs-f-justification').fill('Synthetic E2E severity, not an approved threshold');
  await f.getByTestId('frs-f-description').fill('Customer understanding of the premium term differs from the policy');
  await f.getByTestId('frs-f-save').click();
  await expect(page.getByTestId('frs-rule-FR-E2E-TERM-MISMATCH')).toContainText('Customer discrepancy');
  await page.getByTestId('frs-summary').fill('Synthetic E2E finding rules');
  await page.getByTestId('frs-submit').click();
  await expect(page.getByTestId('frs-detail')).toBeVisible();
  await a11yAndLayout(page, 's3b-finding-rules');
  await page.setViewportSize({ width: 1440, height: 900 });

  // 2. A different S&C checker approves and publishes.
  const cctx = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const cpage = await cctx.newPage();
  await signIn(cpage, checker, '/finding-rules');
  await cpage.getByTestId('frs-reason').fill('Reviewed synthetic E2E rules');
  await cpage.getByTestId('frs-approve').click();
  await cpage.getByTestId('frs-publish').click();
  await expect(cpage.getByTestId('frs-immutable')).toContainText('Published and immutable');
  await cctx.close();

  // 3. A synthetic case with a premium term.
  const cases = (await (await page.request.get('/api/v1/script-simulations/cases?include_unassigned=true')).json()).items as { case_id: string }[];
  let caseId = '';
  let term = 0;
  for (const c of cases.slice(0, 40)) {
    const fx = await (await page.request.get(`/api/v1/simulation-workbench/case-facts?case_id=${c.case_id}`)).json();
    if (fx.facts?.premium_term_years) { caseId = c.case_id; term = Number(fx.facts.premium_term_years); break; }
  }
  expect(caseId).not.toBe('');
  const before = await (await page.request.get(`/api/v1/cases/${caseId}`)).json();
  const findingsBefore = (await (await page.request.get('/api/v1/review-queue?queue=ALL&limit=1')).json()).total;

  // 4. Completed conversation with a discrepancy → findings.
  await page.goto(`/simulator?version=${vid}&case=${caseId}`);
  await conversation(page, p, term + 5);
  await page.getByTestId('sim-generate-findings').click();
  await expect(page.getByTestId('sim-findings-summary')).toContainText('1 finding');
  const fnd = page.getByTestId(`finding-Q-${p}-TERM`);
  await expect(fnd).toContainText('HIGH');
  await expect(fnd).toContainText('Customer discrepancy');
  await expect(fnd).toContainText('not a breach determination');
  await expect(page.getByTestId(`finding-controls-Q-${p}-TERM`)).toContainText('No control mapped');
  await expect(page.getByTestId('sim-findings-replay')).toContainText('Reproduced');
  await a11yAndLayout(page, 's3b-run-findings');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('sim-generate-findings').click();
  await expect(page.getByTestId('sim-findings-reused')).toContainText('no duplicates written');

  // 5. Successful conversation → no findings.
  await page.getByTestId('sim-restart').click();
  await expect(page.getByTestId('sim-run-header')).toContainText('In progress');
  await deliver(page, `Q-${p}-OPEN`);
  await yesNo(page, `Q-${p}-ID-NAME`, true);
  await yesNo(page, `Q-${p}-ID-DOB`, true);
  await deliver(page, `Q-${p}-DISC`);
  await yesNo(page, `Q-${p}-PROCEED`, true);
  await yesNo(page, `Q-${p}-REC`, true);
  await yesNo(page, `Q-${p}-POLICY`, true);
  await yesNo(page, `Q-${p}-UNDERSTOOD`, true);
  await deliver(page, `Q-${p}-TERM`);
  await page.getByTestId('sim-num').fill(String(term));
  await page.getByTestId('sim-submit').click();
  await deliver(page, `Q-${p}-CLOSE`);
  await page.getByTestId('sim-end').click();
  await expect(page.getByTestId('sim-run-header')).toContainText('Completed');
  await page.getByTestId('sim-evaluate').click();
  await page.getByTestId('sim-generate-findings').click();
  await expect(page.getByTestId('findings-none')).toContainText('No findings');

  // 6. Isolation: no operational finding, case, attempt, session or assignment change.
  const after = await (await page.request.get(`/api/v1/cases/${caseId}`)).json();
  expect([after.state, after.attempts, after.sessions]).toEqual([before.state, before.attempts, before.sessions]);
  expect((await (await page.request.get('/api/v1/review-queue?queue=ALL&limit=1')).json()).total).toBe(findingsBefore);
});
