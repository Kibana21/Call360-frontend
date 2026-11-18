import { expect, test, type Page } from '@playwright/test';
import { a11yAndLayout } from './cp04a-checks';
import { accounts, signIn } from './helpers';
import { api, buildLifecycleScript } from './lifecycle-helpers';

// S3-A — deterministic answer evaluation on the real stack: configure evaluation rules in Script Studio (UI) → start a
// version-test simulation of the draft on a synthetic case → enter customer responses (some incorrect) → complete the
// conversation → evaluate answers → inspect matches, mismatches and the evidence trace → re-evaluate (same inputs, same
// record) → save as a scenario (generated baseline) → batch regression run with evaluation results. No case, attempt,
// session or assignment changes.
test.describe.configure({ timeout: 240_000 });

async function addQuestion(section: ReturnType<Page['getByTestId']>, code: string, wording: string, setup: (f: ReturnType<Page['getByTestId']>) => Promise<void>) {
  await section.getByTestId('add-question').click();
  const form = section.getByTestId('new-question-form');
  await form.getByLabel('Question code').fill(code);
  await form.getByLabel('Exact customer wording').fill(wording);
  await form.getByLabel('Intent (what the question establishes)').fill('Synthetic evaluation item (E2E)');
  await setup(form);
  await form.getByTestId('question-save').click();
  await expect(section.getByTestId(`edit-question-${code}`)).toBeVisible();
}

async function deliver(page: Page, code: string) {
  await expect(page.getByTestId('sim-action')).toContainText(`${code}#`);
  await page.getByTestId('sim-present').click();
}
async function yesNo(page: Page, code: string, yes: boolean) {
  await deliver(page, code);
  await expect(page.getByTestId('sim-answer')).toBeVisible();
  await page.getByTestId(yes ? 'sim-yes' : 'sim-no').click();
}

test('S3-A: rules in Script Studio → simulate → wrong answers → evaluate → evidence trace → baseline scenario → batch', async ({ page }) => {
  const { user } = accounts();
  const n = 600000 + Math.floor(Math.random() * 90000);
  const code = `EVE_${n}`;
  const p = `EVE${n}`;
  await signIn(page, user, '/scripts');
  await page.setViewportSize({ width: 1440, height: 900 });
  const author = await api(page);
  const vid = await buildLifecycleScript(author, null, code, p); // a DRAFT lifecycle script
  const fam = (await (await page.request.get(`/api/v1/script-versions/${vid}`)).json()).script_family_id;

  // 1. Script Studio: configure evaluation rules with structured fields.
  await page.goto(`/scripts/${fam}?version=${vid}`);
  const core = page.getByTestId('edit-section').filter({ hasText: `${code}_CORE` });
  await addQuestion(core, `Q-${p}-TERM`, 'For how many years will you pay premiums?', async (f) => {
    await f.getByLabel('Answer type').selectOption('NUMERIC');
    await expect(f.getByTestId('q-method')).toHaveValue('NUMERIC_MATCH_POLICY_FACT');
    await f.getByTestId('q-fact').selectOption('premium_term_years');
    await expect(f.getByTestId('q-unit')).toHaveValue('YEARS');
    await expect(f.getByTestId('evaluation-fields')).toContainText('No tolerance or threshold is assumed');
  });
  await addQuestion(core, `Q-${p}-ADVICE`, 'Were you given a copy of the product summary?', async (f) => {
    await f.getByTestId('q-method').selectOption('EXACT_BOOLEAN');
  });
  await expect(page.getByTestId(`rule-Q-${p}-TERM`)).toContainText('policy fact premium_term_years');
  await expect(page.getByTestId(`rule-Q-${p}-ADVICE`)).toContainText('Expected: yes');
  await a11yAndLayout(page, 's3a-script-studio-rules');
  await page.setViewportSize({ width: 1440, height: 900 });

  // 2. A synthetic case whose immutable fact snapshot has a premium term.
  const cases = (await (await page.request.get('/api/v1/script-simulations/cases?include_unassigned=true')).json()).items as { case_id: string }[];
  let caseId = '';
  let term = 0;
  for (const c of cases.slice(0, 40)) {
    const f = await (await page.request.get(`/api/v1/simulation-workbench/case-facts?case_id=${c.case_id}`)).json();
    if (f.facts?.premium_term_years && f.facts?.product_family === 'PROTECTION') { caseId = c.case_id; term = Number(f.facts.premium_term_years); break; }
  }
  expect(caseId).not.toBe('');
  const before = await (await page.request.get(`/api/v1/cases/${caseId}`)).json();
  const assignments = await (await page.request.get(`/api/v1/cases/${caseId}/script-assignment`)).text();

  // 3. Interactive version test: responses entered one by one; term and advice answered incorrectly.
  await page.goto(`/simulator?version=${vid}&case=${caseId}`);
  await expect(page.getByTestId('sim-plan')).toContainText('Version test');
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
  await page.getByTestId('sim-num').fill(String(term + 5)); // wrong: the policy's term differs by 5
  await page.getByTestId('sim-submit').click();
  await yesNo(page, `Q-${p}-ADVICE`, false); // wrong: expected yes
  await deliver(page, `Q-${p}-CLOSE`);
  await page.getByTestId('sim-end').click();
  await expect(page.getByTestId('sim-run-header')).toContainText('Completed');

  // 4. Evaluate: completed conversation, mismatches explained, evidence trace with pinned inputs and replay.
  await page.getByTestId('sim-evaluate').click();
  await expect(page.getByTestId('sim-eval-header')).toContainText('Mismatch 2');
  await expect(page.getByTestId('sim-eval-separate')).toContainText('The conversation completed, but the answers contain 2 mismatches');
  const termRow = page.getByTestId(`eval-Q-${p}-TERM`);
  await expect(termRow).toContainText(`${term} years (policy fact premium_term_years)`);
  const termWhy = page.getByTestId(`eval-why-Q-${p}-TERM`);
  await expect(termWhy).toContainText(`Answered ${term + 5} years`);
  await expect(termWhy).toContainText('differs by 5');
  await expect(page.getByTestId(`eval-Q-${p}-ADVICE`)).toContainText('Mismatch');
  await expect(page.getByTestId(`eval-Q-${p}-UNDERSTOOD`)).toContainText('Not evaluated'); // capture-only
  await expect(page.getByTestId('sim-eval-trace')).toContainText('exact content snapshot');
  await expect(page.getByTestId('sim-eval-trace')).toContainText('call360.answer-evaluation/1');
  await expect(page.getByTestId('sim-eval-replay')).toContainText('Reproduced');
  await a11yAndLayout(page, 's3a-run-evaluation');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('sim-evaluate').click();
  await expect(page.getByTestId('sim-eval-reused')).toContainText('nothing new written');

  // 5. Save as scenario: the expectations are a generated baseline (not independently validated); run it.
  await page.getByTestId('sim-save-scenario').click();
  await expect(page.getByTestId('scn-basis-generated')).toContainText('not independently validated');
  await expect(page.getByTestId('scn-exp-evaluations')).toContainText(`Q-${p}-TERM: Mismatch`);
  await page.getByTestId('scn-save').click();
  await expect(page).toHaveURL(/scenario=[0-9a-f-]{36}/);
  await page.getByTestId('scn-run').click();
  await expect(page.getByTestId('batch-totals')).toContainText('Passed1');
  await page.locator('[data-testid^="result-open-"]').first().click();
  await expect(page.getByTestId('result-evaluation')).toContainText('Mismatch 2');
  await expect(page.getByTestId('coverage-evaluations')).toContainText(`Q-${p}-TERM: mismatch`);

  // 6. Isolation: nothing operational changed.
  const after = await (await page.request.get(`/api/v1/cases/${caseId}`)).json();
  expect([after.state, after.attempts, after.sessions]).toEqual([before.state, before.attempts, before.sessions]);
  expect(await (await page.request.get(`/api/v1/cases/${caseId}/script-assignment`)).text()).toBe(assignments);
});
