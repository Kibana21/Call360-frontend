import { expect, type Page } from '@playwright/test';

// CP0.6 — integrated Stage 0 journey on the real stack: ONE new synthetic Singapore transaction is followed through
// every module, and each module must show the same record: intake (preview → idempotent submit) → Policy Explorer →
// Overview counts → Work Queues → Call Detail (holds, history, source risk) → SBQ Risk Workbench (the stored
// assessment) → Search → Administration audit trail; then the seeded traceability paths Script Studio → rule → case
// and Review Workbench → finding → case. Called from overview.spec.ts to reuse the ADMIN sign-in.
const n = 970000 + Math.floor(Math.random() * 20000);
const day = 86400_000;
const sold = new Date(Date.now() - 4 * day);
const iso = (d: Date) => d.toISOString();
const TXN = {
  is_synthetic: true, source_system: 'SYN-POLICY-ADMIN', source_event_id: `SYN-EVT-CP06-${n}`, reason: 'CP0.6 integrated acceptance (synthetic)',
  policy: { policy_ref: `POL-SG-${n}`, market_code: 'SG', product_code: 'SYN-ILP-GROWTH', product_family: 'ILP', product_subtype: 'ILP_REGULAR',
    status: 'IN_FORCE', premium_amount: '300.00', currency: 'SGD', premium_frequency: 'MONTHLY', premium_term_years: 12,
    sum_assured: '120000.00', sum_assured_currency: 'SGD', effective_from: iso(new Date(sold.getTime() + day)) },
  sale: { sale_ref: `SALE-SG-${n}`, sale_event_type: 'NEW_BUSINESS', sold_at: iso(sold), fsc_ref: 'FSC-0002', selling_channel: 'BANCASSURANCE',
    selling_location: 'SYN-BANK-01', proposal_ref: `PRP-CP06-${n}`, premium_amount: '300.00', currency: 'SGD' },
  parties: [{ kind: 'PERSON', name: `Example Cp06 Holder ${n}`, roles: ['OWNER', 'PROPOSER', 'PAYER', 'INSURED'],
    contacts: [{ channel: 'PHONE', value: `SYN-TEL-SG-${n}`, consent_status: 'GRANTED' }] }],
  source_risk: { band_code: 'HIGH', source_original_value: 'SBQ-H', status: 'FINAL', assessed_at: iso(new Date(sold.getTime() + 3600_000)), reason_codes: ['SRC-HIGH'] },
  callback_request: { source_request_ref: `SYN-REQ-CP06-${n}`, due_at: iso(new Date(sold.getTime() + 20 * day)), priority: 1 },
};

async function headers(page: Page): Promise<Record<string, string>> {
  const token = (await page.context().cookies()).find((c) => c.name === 'c360_csrf')?.value ?? '';
  return { 'X-CSRF-Token': token, Origin: new URL(page.url()).origin };
}

export async function cp06Integrated(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const kpi = async (id: string) => (await (await page.request.get('/api/v1/dashboard/kpis')).json()).items.find((k: { definition_id: string }) => k.definition_id === id).value as number;
  const openBefore = await kpi('OPS-01');
  const h = await headers(page);

  // Intake: preview persists nothing; commit; the same key replays; a new key for the same event is a duplicate.
  expect((await page.request.post('/api/v1/intake/manual/preview', { data: TXN, headers: h })).status()).toBe(200);
  expect(await kpi('OPS-01')).toBe(openBefore);
  const key = `cp06-${n}`;
  const out = await (await page.request.post('/api/v1/intake/manual', { data: TXN, headers: { ...h, 'Idempotency-Key': key } })).json();
  const replay = await page.request.post('/api/v1/intake/manual', { data: TXN, headers: { ...h, 'Idempotency-Key': key } });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).case.case_ref).toBe(out.case.case_ref);
  const dup = await page.request.post('/api/v1/intake/manual', { data: TXN, headers: { ...h, 'Idempotency-Key': `${key}-2` } });
  expect(dup.status()).toBe(409);
  const caseRef: string = out.case.case_ref;
  const caseId: string = out.case.case_id;

  // Policy Explorer → Policy Detail: the same policy, sale and case; the name is masked everywhere.
  await page.goto(`/policies?q=${TXN.policy.policy_ref}`);
  await expect(page.getByTestId('policy-total')).toContainText('of 1 matching');
  await page.getByRole('link', { name: TXN.policy.policy_ref }).first().click();
  await expect(page.getByRole('heading', { name: 'Policy Detail' })).toBeVisible();
  await expect(page.locator('body')).toContainText(TXN.sale.sale_ref);
  await expect(page.locator('body')).toContainText(caseRef);
  await expect(page.locator('body')).not.toContainText(TXN.parties[0]!.name);
  await expect(page.locator('body')).not.toContainText(TXN.parties[0]!.contacts[0]!.value);

  // Overview: exactly one more open case; the card equals the API.
  expect(await kpi('OPS-01')).toBe(openBefore + 1);
  await page.goto('/');
  await expect(page.getByTestId('kpi-OPS-01')).toHaveText(String(openBefore + 1));

  // Work Queues → On hold → Awaiting script assignment lists the case.
  await page.goto('/queues');
  await page.getByTestId('queue-ON_HOLD').click();
  await page.getByRole('group', { name: 'Hold reason' }).getByRole('button', { name: /^Awaiting script assignment/ }).click();
  await page.getByRole('link', { name: caseRef, exact: true }).click();

  // Call Detail: holds, source-assigned risk, history.
  await expect(page.getByRole('heading', { name: 'Call Detail' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/cases/${caseId}`));
  await expect(page.getByTestId('cd-precheck')).toContainText('Blocked');
  await expect(page.getByTestId('cd-precheck')).toContainText(/Awaiting script assignment/i);
  await expect(page.locator('body')).toContainText(/High/);
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByText(new RegExp(`Callback obligation created for ${TXN.sale.sale_ref}`))).toBeVisible();

  // SBQ Risk Workbench: the one stored, source-assigned HIGH assessment of this sale.
  const risk = await (await page.request.get(`/api/v1/risk-assessments?q=${TXN.sale.sale_ref}`)).json();
  expect(risk.total).toBe(1);
  expect(risk.items[0].band_code).toBe('HIGH');
  await page.goto(`/risk-assessments?q=${TXN.sale.sale_ref}`);
  await expect(page.getByTestId('risk-total')).toContainText('of 1 matching assessments');

  // Search finds the same case; the audit trail holds the commit with these references (no personal data).
  await page.goto(`/search?q=${caseRef}`);
  await expect(page.getByTestId('search-hit').first()).toContainText(caseRef);
  const audit = await (await page.request.get('/api/v1/admin/audit-events?action=INTAKE.COMMITTED&limit=20')).json();
  const event = audit.items.find((e: { after: { case_ref?: string } | null }) => e.after?.case_ref === caseRef);
  expect(event?.after?.policy_ref).toBe(TXN.policy.policy_ref);
  expect(JSON.stringify(audit)).not.toContain(TXN.parties[0]!.name);
  expect(JSON.stringify(audit)).not.toContain(TXN.parties[0]!.contacts[0]!.value);

  // Seeded traceability: Script Studio → rule → its case's Call Detail pins the same version; Review Workbench →
  // finding → Call Detail lists it.
  const rules = await (await page.request.get('/api/v1/script-assignment-rules')).json();
  const live = rules.items.find((r: { status: string }) => r.status === 'PUBLISHED');
  await page.goto(`/assignment-rules?rule=${encodeURIComponent(`${live.rule_code} v${live.version}`)}`);
  await page.getByTestId(`rule-${live.rule_code}-v${live.version}`).getByRole('link', { name: live.recent_cases[0].case_ref }).click();
  await expect(page.getByTestId('cd-script-link')).toHaveText(`${live.target.family} v${live.target.version_label}`);
  const findings = await (await page.request.get('/api/v1/review-queue?queue=ALL&limit=1')).json();
  const f = findings.items[0];
  await page.goto(`/reviews?queue=ALL&finding=${f.id}&q=${f.finding_ref}`);
  await page.getByTestId('finding-detail').getByTestId('open-call-detail').click();
  await expect(page.getByTestId('findings')).toContainText(f.finding_ref);

  // E2E-14: empty, error and partial states under controlled backend conditions.
  await page.goto('/reviews?queue=ALL&q=ZZZ-NO-MATCH-0000');
  await expect(page.getByRole('status').filter({ hasText: 'No findings match' })).toBeVisible();
  let fail = true;
  await page.route('**/api/v1/review-queue**', (route) => (fail
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_READY', message: 'Unavailable', correlation_id: 'e2e-503', retryable: true }) })
    : route.continue()));
  await page.goto('/reviews');
  const error = page.getByRole('alert').filter({ hasText: 'could not be loaded' });
  await expect(error).toBeVisible();
  await expect(error).toContainText('e2e-503');
  fail = false;
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('review-list')).toBeVisible();
  await page.unroute('**/api/v1/review-queue**');
  await page.goto(`/cases/${caseId}`); // partial: the case exists; transcript and recording are honestly unavailable
  await expect(page.getByRole('heading', { name: 'Call Detail' })).toBeVisible();
  await expect(page.locator('body')).toContainText(/not available|Nothing to show/i);
}
