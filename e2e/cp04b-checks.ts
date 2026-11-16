import { expect, type Page, type Request } from '@playwright/test';
import { a11yAndLayout, INTAKE } from './cp04a-checks';

// CP0.4b — the Manual Intake portal on the real stack (E2E-11) (backend 8001 + call360_test): fill the Data Intake form,
// server validation on fields (missing priority, due before sale, non-synthetic contact, non-SG reference), preview
// gating, one submission despite a double click, idempotent replay with the browser's key, links to Policy Detail
// and Call Detail, intake history, an existing-policy top-up from Policy Detail and a conflicting top-up (409).
// Called from overview.spec.ts to reuse its sign-ins.
const n = 910000 + Math.floor(Math.random() * 80000);
const DAY = 86400_000;
const sold = new Date(Date.now() - 3 * DAY);
/** A `datetime-local` value in SGT. */
const sgt = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 19);
const POLICY = `POL-SG-${n}`;

const panel = (page: Page) => page.getByRole('complementary', { name: 'Preview and submit' });
const label = (page: Page, name: string) => page.getByLabel(name, { exact: true });

async function preview(page: Page): Promise<void> {
  await panel(page).getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Previewing…' })).toHaveCount(0);
}

async function fillNewPolicy(page: Page): Promise<void> {
  await label(page, 'Policy reference').fill(POLICY);
  await label(page, 'Product').selectOption('SYN-PROT-TERM|PROTECTION|TERM_LIFE');
  await label(page, 'Policy premium (SGD)').fill('180.00');
  await label(page, 'Premium term (years)').fill('15');
  await label(page, 'Sum assured (SGD)').fill('250000.00');
  await label(page, 'Effective from (SGT)').fill(sgt(new Date(sold.getTime() + DAY)));
  await label(page, 'Sale reference').fill(`SALE-SG-${n}`);
  await label(page, 'Sold at (SGT)').fill(sgt(sold));
  await label(page, 'FSC representative').selectOption('FSC-0001');
  await expect(label(page, 'Selling channel')).toHaveValue('AGENCY');
  await label(page, 'Selling location').fill('SYN-BRANCH-02');
  await label(page, 'Proposal reference').fill(`PRP-UI-${n}`);
  await label(page, 'Sale premium (SGD)').fill('180.00');
  await label(page, 'Synthetic name').fill(`Example Portal Holder ${n}`);
  await label(page, 'Year of birth').fill('1991');
  await label(page, 'Contact 1 value').fill('+6591234567'); // not a reserved synthetic value: rejected below
  await page.getByLabel('Include a source-assigned risk').check();
  await label(page, 'Risk band').selectOption('MEDIUM');
  await label(page, "Source's original value").fill('SBQ-M');
  await label(page, 'Assessed at (SGT)').fill(sgt(new Date(sold.getTime() + 6 * 3600_000)));
  await label(page, 'Source request reference').fill(`SYN-REQ-UI-${n}`);
  await label(page, 'Due (SGT)').fill(sgt(new Date(sold.getTime() - DAY))); // before the sale: rejected below
  await label(page, 'Source event ID').fill(`SYN-EVT-UI-${n}`);
  await label(page, 'Reason for manual intake').fill('Portal manual intake, CP0.4b e2e (synthetic)');
}

export async function cp04bAdmin(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Data Intake' }).click();
  await expect(page.getByRole('heading', { name: 'Data Intake', level: 1 })).toBeVisible();
  await expect(page.getByTestId('source-MANUAL')).toContainText('Available');
  await expect(page.getByTestId('source-MOCK_API')).toContainText('Not available');
  const runsBefore = (await (await page.request.get('/api/v1/intake/import-runs')).json()).total as number;

  await fillNewPolicy(page);
  const submit = panel(page).getByRole('button', { name: 'Submit transaction' });
  await expect(submit).toBeDisabled();

  // 1. Missing priority: the request-schema error lands on the Priority select.
  await preview(page);
  await expect(page.getByTestId('intake-problem')).toContainText('Rejected: fix the highlighted fields');
  await expect(label(page, 'Priority')).toHaveAttribute('aria-invalid', 'true');
  await a11yAndLayout(page, 'intake-errors');
  await page.setViewportSize({ width: 1440, height: 900 });
  await label(page, 'Priority').selectOption('2');

  // 2. Synthetic-only: a real-looking phone number is rejected on its field.
  await preview(page);
  await expect(page.getByTestId('intake-problem')).toContainText('INGEST_CONTACT_NOT_SYNTHETIC');
  await expect(label(page, 'Contact 1 value')).toHaveAttribute('aria-invalid', 'true');
  await label(page, 'Contact 1 value').fill(`SYN-TEL-SG-${n}`);

  // 3. Due date before the sale (domain rule), shown on the Due field and reachable from the summary.
  await preview(page);
  await expect(label(page, 'Due (SGT)')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('intake-problem').getByRole('link', { name: /Callback › Due at/i }).click();
  await expect(label(page, 'Due (SGT)')).toBeFocused();
  await label(page, 'Due (SGT)').fill(sgt(new Date(sold.getTime() + 30 * DAY)));

  // 4. Singapore-only: a Malaysian reference is out of scope.
  await label(page, 'Policy reference').fill(`POL-MY-${n}`);
  await preview(page);
  await expect(page.getByTestId('intake-problem')).toContainText('INGEST_MARKET_NOT_IN_SCOPE');
  await label(page, 'Policy reference').fill(POLICY);

  // 5. A clean preview enables Submit; any edit invalidates it.
  await preview(page);
  await expect(page.getByTestId('preview-state')).toContainText('Preview matches the form');
  await expect(panel(page).getByTestId('intake-outcome')).toContainText('Preview — nothing saved');
  await expect(panel(page).getByTestId('intake-outcome')).toContainText('Awaiting script assignment');
  await expect(panel(page).getByTestId('intake-outcome')).toContainText('Reference assigned on submit');
  await expect(submit).toBeEnabled();
  await label(page, 'Selling location').fill('SYN-BRANCH-03');
  await expect(submit).toBeDisabled();
  await expect(page.getByTestId('preview-state')).toContainText('Form changed since preview');
  await preview(page);
  await a11yAndLayout(page, 'intake-preview');
  await page.setViewportSize({ width: 1440, height: 900 });

  // 6. A double click submits once; the browser's key replays the stored result.
  const posts: Request[] = [];
  const onRequest = (r: Request) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/intake/manual') posts.push(r); };
  page.on('request', onRequest);
  await submit.dblclick();
  const result = panel(page);
  await expect(page.getByRole('complementary', { name: 'Preview and submit' }).getByText('Submitted', { exact: true })).toBeVisible();
  page.off('request', onRequest);
  expect(posts).toHaveLength(1);
  const key = posts[0]!.headers()['idempotency-key'];
  expect(key).toMatch(/^portal-/);
  const caseRef = (await result.getByTestId('intake-outcome').innerText()).match(/CB-\d{4}-\d{5}/)![0];
  // The browser's key is stored with the run: reusing it for a different transaction is refused (the body of a
  // streamed fetch is not visible to Playwright, so the same-payload replay is covered by the unit test and CP0.4a).
  const reuse = await page.request.post('/api/v1/intake/manual', {
    data: INTAKE, // a different, well-formed transaction
    headers: { 'Idempotency-Key': key!, 'X-CSRF-Token': (await page.context().cookies()).find((c) => c.name === 'c360_csrf')!.value, Origin: new URL(page.url()).origin },
  });
  expect(reuse.status()).toBe(409);
  expect((await reuse.json()).code).toBe('IDEMPOTENCY_KEY_REUSED');
  const run = (await (await page.request.get('/api/v1/intake/import-runs')).json()).items[0];
  expect(run.counts.new).toBe(1);
  await expect(label(page, 'Sale reference')).toBeDisabled(); // the submitted form is locked
  expect(await page.locator('body').innerText()).not.toContain(`Example Portal Holder ${n}`.slice(8)); // name shown masked only
  await a11yAndLayout(page, 'intake-result');
  await page.setViewportSize({ width: 1440, height: 900 });

  // 7. Result → Policy Detail → back → Call Detail.
  await result.getByRole('link', { name: 'Open Policy Detail' }).click();
  await expect(page.getByRole('heading', { name: 'Policy Detail' })).toBeVisible();
  await expect(page.getByText(POLICY).first()).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Data Intake', level: 1 })).toBeVisible();
  // The form state does not survive navigation; the run history keeps the result and its links.
  await page.getByRole('tab', { name: 'Intake history' }).click();
  await expect(page.getByTestId('intake-runs')).toBeVisible();
  const runsAfter = (await (await page.request.get('/api/v1/intake/import-runs')).json()).total as number;
  expect(runsAfter).toBe(runsBefore + 1); // rejected previews did not create runs
  await expect(page.getByText(/Rejected submissions are not runs/)).toBeVisible();
  await page.getByTestId('intake-runs').getByRole('row').nth(1).getByRole('button', { name: /^View IR-/ }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText(`SYN-EVT-UI-${n}`);
  await expect(drawer).toContainText(caseRef);
  await a11yAndLayout(page, 'intake-history');
  await page.setViewportSize({ width: 1440, height: 900 });
  await drawer.getByRole('link', { name: 'Open Call Detail' }).click();
  await expect(page.getByRole('heading', { name: 'Call Detail' })).toBeVisible();
  await expect(page.getByText(caseRef).first()).toBeVisible();
  await expect(page.getByText(/Synthetic intake case/)).toBeVisible();
  await expect(page.getByTestId('cd-precheck')).toContainText(/Awaiting script assignment/i);

  // 8. Existing policy: Policy Detail → "Add a sale" opens the form prefilled from the stored policy.
  await page.goto(`/policies?q=${POLICY}`);
  await page.getByRole('link', { name: POLICY }).first().click();
  await page.getByRole('link', { name: 'Add a sale' }).click();
  await expect(page.getByTestId('existing-policy-note')).toContainText(POLICY);
  await expect(page.getByTestId('existing-parties')).toContainText('PTY-');
  await expect(label(page, 'Policy premium (SGD)')).toHaveValue('180.00');
  await expect(label(page, 'Sale type')).toHaveValue('TOP_UP');
  await expect(page.getByLabel('Synthetic name')).toHaveCount(0); // parties are reused by reference, not re-entered
  await label(page, 'Sale reference').fill(`SALE-SG-${n + 1}`);
  await label(page, 'Sold at (SGT)').fill(sgt(new Date(sold.getTime() + DAY)));
  await label(page, 'FSC representative').selectOption('FSC-0001');
  await label(page, 'Selling location').fill('SYN-BRANCH-02');
  await label(page, 'Proposal reference').fill(`PRP-UI-${n + 1}`);
  await label(page, 'Sale premium (SGD)').fill('5000.00');
  await label(page, 'Source request reference').fill(`SYN-REQ-UI-${n + 1}`);
  await label(page, 'Due (SGT)').fill(sgt(new Date(sold.getTime() + 20 * DAY)));
  await label(page, 'Priority').selectOption('3');
  await label(page, 'Source event ID').fill(`SYN-EVT-UI-${n + 1}`);
  await label(page, 'Reason for manual intake').fill('Portal top-up, CP0.4b e2e (synthetic)');
  // A changed policy premium conflicts with the stored policy (409, no correction).
  await label(page, 'Policy premium (SGD)').fill('999.00');
  await preview(page);
  await expect(page.getByTestId('intake-problem')).toContainText('Rejected: conflicts with stored data');
  await expect(page.getByTestId('intake-problem')).toContainText('INGEST_POLICY_FIELDS_DIFFER');
  await label(page, 'Policy premium (SGD)').fill('180.00');
  await preview(page);
  await expect(panel(page).getByTestId('intake-outcome')).toContainText('Existing policy (reused)');
  await panel(page).getByRole('button', { name: 'Submit transaction' }).click();
  await expect(panel(page).getByText('Submitted', { exact: true })).toBeVisible();
  await panel(page).getByRole('link', { name: 'Open Call Detail' }).click();
  await expect(page.getByRole('heading', { name: 'Call Detail' })).toBeVisible();
}

export async function cp04bUser(page: Page): Promise<void> {
  await page.goto('/intake');
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  expect((await page.request.get('/api/v1/intake/reference')).status()).toBe(403);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Data Intake' })).toBeVisible();
}
