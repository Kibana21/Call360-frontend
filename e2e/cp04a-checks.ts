import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// CP0.4a — manual transaction intake on the real stack (backend 8001 + call360_test). A synthetic Singapore
// transaction is submitted through the API (preview, commit, idempotent replay), then followed through the existing
// portal: Policy Explorer → Policy Detail, Work Queues (On hold · Awaiting script assignment) → Call Detail, the
// Overview counts and the Risk Workbench. Called from overview.spec.ts to reuse its sign-ins.
const n = 900000 + Math.floor(Math.random() * 90000);
const sold = new Date(Date.now() - 2 * 86400_000);
const iso = (d: Date) => d.toISOString();
export const INTAKE = {
  is_synthetic: true,
  source_system: 'SYN-POLICY-ADMIN',
  source_event_id: `SYN-EVT-E2E-${n}-${Date.now()}`,
  reason: 'E2E synthetic intake',
  policy: {
    policy_ref: `POL-SG-${n}`, market_code: 'SG', product_code: 'SYN-PROT-TERM', product_family: 'PROTECTION', product_subtype: 'TERM_LIFE',
    status: 'IN_FORCE', premium_amount: '180.00', currency: 'SGD', premium_frequency: 'MONTHLY', premium_term_years: 15,
    sum_assured: '250000.00', sum_assured_currency: 'SGD', effective_from: iso(new Date(sold.getTime() + 86400_000)),
  },
  sale: {
    sale_ref: `SALE-SG-${n}`, sale_event_type: 'NEW_BUSINESS', sold_at: iso(sold), fsc_ref: 'FSC-0001', selling_channel: 'AGENCY',
    selling_location: 'SYN-BRANCH-02', proposal_ref: `PRP-E2E-${n}`, premium_amount: '180.00', currency: 'SGD', premium_amount_band: 'BAND_A',
  },
  parties: [{
    kind: 'PERSON', name: `Example E2E Holder ${n}`, date_of_birth_year: 1990, roles: ['OWNER', 'PROPOSER', 'PAYER', 'INSURED'],
    contacts: [{ channel: 'PHONE', value: `SYN-TEL-SG-${n}`, consent_status: 'GRANTED' }],
  }],
  source_risk: { band_code: 'MEDIUM', source_original_value: 'SBQ-M', status: 'FINAL', assessed_at: iso(new Date(sold.getTime() + 6 * 3600_000)), reason_codes: ['SRC-MEDIUM'] },
  callback_request: { source_request_ref: `SYN-REQ-E2E-${n}`, due_at: iso(new Date(sold.getTime() + 30 * 86400_000)), priority: 2 },
};

// Unsafe API calls carry what the browser would send: the session CSRF token and the page Origin.
export async function writeHeaders(page: Page): Promise<Record<string, string>> {
  const token = (await page.context().cookies()).find((c) => c.name === 'c360_csrf')?.value ?? '';
  return { 'X-CSRF-Token': token, Origin: new URL(page.url()).origin };
}

async function kpi(page: Page, id: string): Promise<{ value: number | null; numerator: number | null; status: string }> {
  const body = await (await page.request.get('/api/v1/dashboard/kpis')).json();
  return body.items.find((k: { definition_id: string }) => k.definition_id === id);
}

export async function cp04aAdmin(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const openBefore = await kpi(page, 'OPS-01');
  const headers = await writeHeaders(page);

  // 1–2. Preview validates and persists nothing; an invalid transaction is rejected with field details.
  const preview = await page.request.post('/api/v1/intake/manual/preview', { data: INTAKE, headers });
  expect(preview.status()).toBe(200);
  expect((await preview.json()).holds.map((h: { reason: string }) => h.reason)).toEqual(['AWAITING_SCRIPT_ASSIGNMENT']);
  const bad = await page.request.post('/api/v1/intake/manual/preview', {
    data: { ...INTAKE, callback_request: { ...INTAKE.callback_request, priority: 9 } }, headers,
  });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).details[0].loc).toEqual(['body', 'callback_request', 'priority']);

  // 3–4. Commit stores policy, sale, party and the callback case; the same key replays the same result.
  const key = `e2e-${INTAKE.source_event_id}`;
  const commit = await page.request.post('/api/v1/intake/manual', { data: INTAKE, headers: { ...headers, 'Idempotency-Key': key } });
  expect(commit.status()).toBe(201);
  const out = await commit.json();
  const replay = await page.request.post('/api/v1/intake/manual', { data: INTAKE, headers: { ...headers, 'Idempotency-Key': key } });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).case.case_ref).toBe(out.case.case_ref);
  const caseRef: string = out.case.case_ref;

  // 5. Policy Explorer → Policy Detail.
  await page.goto(`/policies?q=${INTAKE.policy.policy_ref}`);
  await page.getByRole('link', { name: INTAKE.policy.policy_ref }).first().click();
  await expect(page.getByRole('heading', { name: 'Policy Detail' })).toBeVisible();
  await expect(page.getByText('submitted through manual intake from a synthetic source transaction')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(INTAKE.parties[0]!.name);

  // Work Queues → On hold → Awaiting script assignment → the new case → Call Detail.
  await page.goto('/queues');
  await page.getByTestId('queue-ON_HOLD').click();
  await page.getByRole('group', { name: 'Hold reason' }).getByRole('button', { name: /^Awaiting script assignment/ }).click();
  await page.getByRole('link', { name: caseRef, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Call Detail' })).toBeVisible();
  await expect(page.getByText(/Synthetic intake case/)).toBeVisible();
  await expect(page.getByTestId('cd-precheck')).toContainText('Blocked');
  await expect(page.getByTestId('cd-precheck')).toContainText(/Awaiting script assignment/i);
  await expect(page.getByTestId('cd-owner')).toHaveText('Unassigned');
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByText(/Callback obligation created for SALE-SG-/)).toBeVisible();
  await a11yAndLayout(page, 'intake-call-detail');
  await page.setViewportSize({ width: 1440, height: 900 });

  // Overview: open cases went up by exactly this case; the card equals the API.
  const openAfter = await kpi(page, 'OPS-01');
  expect(openAfter.value).toBe((openBefore.value ?? 0) + 1);
  await page.goto('/');
  await expect(page.getByTestId('kpi-OPS-01')).toHaveText(String(openAfter.value));
  expect((await kpi(page, 'KPI-14')).status).toBe('MEASURED');

  // Risk Workbench shows the stored source-assigned assessment (none is fabricated).
  await page.goto(`/risk-assessments?q=${INTAKE.sale.sale_ref}`);
  await expect(page.getByTestId('risk-total')).toContainText('of 1 matching assessments');
  expect(await page.locator('body').innerText()).not.toMatch(/POL-MY-|SALE-MY-/);
}

export async function cp04aUser(page: Page): Promise<void> {
  const headers = await writeHeaders(page);
  const r = await page.request.post('/api/v1/intake/manual/preview', { data: INTAKE, headers });
  expect(r.status()).toBe(403);
  // USER sees the intake-created case through the ordinary read APIs.
  const cases = await (await page.request.get(`/api/v1/cases?q=${INTAKE.policy.policy_ref}`)).json();
  expect(cases.total).toBe(1);
}

export async function a11yAndLayout(page: Page, name: string): Promise<void> {
  for (const width of [820, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width > 820) {
      // Let entrance animations (drawer fade) finish; mid-fade colours are not the rendered contrast.
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${name}@${width}: ${v.id} (${v.nodes.map((x) => x.target.join(' ')).join(', ')}) — ${v.nodes[0]?.failureSummary ?? ''}`)).toEqual([]);
    }
    await page.screenshot({ path: `test-results/screens/${name}-${width}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${name} at ${width}px`).toBeLessThanOrEqual(0);
  }
}
