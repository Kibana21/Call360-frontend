// FE (F4) — Policy Explorer and Policy Detail: server values only, URL-held filters, tab and sale, links to Call Detail,
// masked parties, the not-available field-change ledger, and loading, empty, not-found, error, partial and forbidden.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const PERMS = ['dashboard.read', 'case.read', 'queue.read', 'search.use', 'policy.read', 'party.read'];
const USER_ME = { ...ME, roles: ['USER'], permissions: PERMS };
const T = '2026-10-15T02:00:00Z';
const prov = { source_type: 'SEED', source_system: 'SYN-SEED', source_reference: 'S0-SEED-1', source_observed_at: T, recorded_at: T, mapping_version: null, intake_item_id: null, is_synthetic: true };
const row = (ref: string, over: Record<string, unknown> = {}) => ({
  policy_id: ref, policy_ref: ref, owner: 'Example P. 017', insured: 'Example P. 018', product_code: 'SYN-END-SAVER', product_family: 'ENDOWMENT',
  product_subtype: 'ENDOWMENT', is_ilp: false, premium_amount: 980, currency: 'SGD', premium_frequency: 'ANNUAL', sales: 2, sale_types: ['NEW_BUSINESS', 'TOP_UP'],
  latest_sale_ref: 'SALE-SG-000118', latest_sold_at: T, selling_channel: 'BANCASSURANCE', selling_location: 'SYN-BANK-06', fsc_ref: 'FSC-0018', fsc_name: 'Example Representative 18',
  risk_band: 'LOW', script: 'SALES_VERIFICATION_SG v1.1', cases: 2, latest_case_id: 'c78', latest_case_ref: 'CB-2026-10078', latest_case_state: 'AWAITING_CALLBACK',
  latest_case_outcome: 'OPEN', is_synthetic: true, route: `/policies/${ref}`, ...over,
});
const FACETS = { product_family: { ENDOWMENT: 52, ILP: 71 }, ilp: { true: 71, false: 104 }, band: { HIGH: 65, LOW: 57 }, channel: { BANCASSURANCE: 30 },
  sale_type: { NEW_BUSINESS: 175, TOP_UP: 15 }, multi_sale: { true: 20, false: 155 }, case_state: { AWAITING_CALLBACK: 80 }, outcome: { OPEN: 100 } };
const list = (items: unknown[], total = items.length) => ({ items, total, page: { next_cursor: null, limit: 25, sort: '-latest_sold_at' }, facets: FACETS, markets: ['SG'], data_as_of: T, synthetic_badge: true });
const pin = { script_version_id: 'v11', family: 'SALES_VERIFICATION_SG', version_label: '1.1', status: 'PUBLISHED', manifest_sha256: 'a'.repeat(64), content_approval_status: 'SYNTHETIC_UNAPPROVED' };
const pcase = (id: string, ref: string, sale: string, type: string, state: string, outcome: string) => ({
  case_id: id, case_ref: ref, sale_event_id: sale, sale_ref: sale === 's1' ? 'SALE-SG-000018' : 'SALE-SG-000118', sale_event_type: type, state, outcome,
  controls_satisfied: state === 'VERIFIED' ? true : null, open_findings: 0, risk_band: 'LOW', due_at: T, verified_at: state === 'VERIFIED' ? T : null, closed_at: null,
  script: pin, matched_rule: 'SG-SALES-VERIFY v2', assignment_origin: 'SEED', script_rationale: { matched: 'SG-SALES-VERIFY v2', resolved_sections: ['COMMON_SALES_CONDUCT', 'SAVINGS'], precedence: 'priority, then specificity' },
  route: `/cases/${id}`,
});
const CASES = [pcase('c5', 'CB-2026-10005', 's1', 'NEW_BUSINESS', 'VERIFIED', 'VERIFIED_COMPLIANT'), pcase('c78', 'CB-2026-10078', 's2', 'TOP_UP', 'AWAITING_CALLBACK', 'OPEN')];
const DETAIL = {
  id: 'p17', policy_ref: 'POL-SG-000017', product_code: 'SYN-END-SAVER', product_family: 'ENDOWMENT', product_subtype: 'ENDOWMENT', is_ilp: false, status: 'IN_FORCE',
  premium_amount: 980, currency: 'SGD', premium_frequency: 'ANNUAL', premium_term_years: 15, sum_assured: 50000, sum_assured_currency: 'SGD', effective_from: T, effective_to: null,
  source_type: 'SEED', source_system: 'SYN-SEED', market: 'SG', provenance: prov,
  material_fields: [{ field: 'premium_amount', value: 980, source_system: 'SYN-SEED', source_reference: 'S0-SEED-1', as_of: T }],
  external_refs: [{ source_system: 'SYN-POLICY-ADMIN', object_type: 'POLICY', external_id: 'X' }], owners: ['Example P. 017'], insured: ['Example P. 018'],
  sales: 2, top_ups: 1, latest_sale_id: 's2', risk_band: 'LOW', cases: CASES, data_as_of: T,
};
const sale = (id: string, ref: string, type: string, premium: number) => ({
  id, sale_ref: ref, sale_event_type: type, sold_at: T, selling_channel: 'BANCASSURANCE', selling_location: 'SYN-BANK-06', campaign_code: null, proposal_ref: null,
  premium_amount: premium, currency: 'SGD', product_snapshot: { product_code: 'SYN-END-SAVER' }, fsc: { fsc_ref: 'FSC-0018', display_name: 'Example Representative 18', channel: 'BANCASSURANCE', status: 'ACTIVE' },
  source_type: 'SEED', source_system: 'SYN-SEED', recorded_at: T, source_reference: null, source_observed_at: T, risk_band: 'LOW', fact_snapshots: 1,
  cases: CASES.filter((c) => c.sale_event_id === id),
});
const SALES = { policy_id: 'p17', policy_ref: 'POL-SG-000017', items: [sale('s1', 'SALE-SG-000018', 'NEW_BUSINESS', 980), sale('s2', 'SALE-SG-000118', 'TOP_UP', 2500)] };
const risk = (id: string, origin: string, effective: boolean, supersedes: string | null = null) => ({ id, kind: 'CALLBACK_SELECTION', origin, status: 'FINAL', band_code: 'LOW', score: null,
  reason_codes: [], explanation: 'Seeded', source_original_value: origin === 'SOURCE_ASSIGNED' ? 'L' : null, rule_set: null, assessed_at: T, valid_at: T, input_snapshot_sha256: null,
  effective, factors: [], supersedes_id: supersedes });
const ctx = (s: ReturnType<typeof sale>, premium: string) => ({
  sale: s, policy_id: 'p17', policy_ref: 'POL-SG-000017', provenance: prov, external_refs: [],
  fact_snapshots: [{ id: `f${s.id}`, captured_at: T, schema_version: '1', sha256: `${s.id}`.padEnd(64, '0'), facts: { sale_event_type: s.sale_event_type, premium_amount: premium,
    suitability: { risk_tolerance: 'MODERATE' } }, field_provenance: { premium_amount: { source_system: 'SYN-POLICY-ADMIN', as_of: '2026-10-15' } } }],
  risk_assessments: s.id === 's2' ? [risk('r2', 'RULE_ASSESSED', true, 'r1'), risk('r1', 'SOURCE_ASSIGNED', false)] : [risk('r0', 'RULE_ASSESSED', true)],
  cases: s.cases,
});
const PARTIES = { policy_id: 'p17', policy_ref: 'POL-SG-000017', items: [
  { party_ref: 'PTY-000017', kind: 'PERSON', masked_name: 'Example P. 017', personal_data_class: 'CONFIDENTIAL', provenance: prov,
    roles: ['OWNER', 'PAYER'].map((role) => ({ role, valid_from: T, valid_to: null, current: true, authorization_ref: null, authorization_valid_from: null, authorization_valid_to: null, source_system: 'SYN-SEED' })),
    contacts: [{ channel: 'PHONE', masked_value: 'SYN-TEL-SG-••••17', is_verified: false, preference_rank: 1, language: 'en', timezone: null, consent_status: 'GRANTED', suppressed: false,
      valid_from: T, valid_to: null, current: true, source_system: 'SYN-SEED', source_observed_at: T },
    { channel: 'PHONE', masked_value: 'SYN-TEL-SG-••••99', is_verified: false, preference_rank: 2, language: 'en', timezone: null, consent_status: 'GRANTED', suppressed: true,
      valid_from: T, valid_to: T, current: false, source_system: 'SYN-SEED', source_observed_at: T }],
    eligibility: [{ case_id: 'c78', case_ref: 'CB-2026-10078', role: 'OWNER', channel: 'PHONE', masked_contact: 'SYN-TEL-SG-••••17', eligible: true, ineligibility_reason: null,
      rule_basis: 'OWNER', decided_at: T, decided_by: 'SYSTEM:seed', superseded: false }] },
] };
const HISTORY = { policy_id: 'p17', policy_ref: 'POL-SG-000017', lineage: [{ entity_type: 'sale_event', entity_ref: 'SALE-SG-000118', label: 'TOP_UP', provenance: prov, external_refs: [] }],
  field_changes: { availability: 'NOT_AVAILABLE', reason: 'LEDGER_ARRIVES_CP0_4', message: 'Field-level change history is not available yet: field corrections, which write the field_change ledger, arrive in CP0.4b.' } };
const detailApi = {
  'GET /api/v1/me': () => json(200, USER_ME),
  'GET /api/v1/policies/p17': () => json(200, DETAIL),
  'GET /api/v1/policies/p17/sales': () => json(200, SALES),
  'GET /api/v1/sales/s1': () => json(200, ctx(SALES.items[0]!, '980')),
  'GET /api/v1/sales/s2': () => json(200, ctx(SALES.items[1]!, '2500')),
  'GET /api/v1/policies/p17/parties': () => json(200, PARTIES),
  'GET /api/v1/policies/p17/history': () => json(200, HISTORY),
};

describe('Policy Explorer', () => {
  it('lists server rows with masked names, links and filter state in the URL', async () => {
    const seen: string[] = [];
    stubApi({
      'GET /api/v1/me': () => json(200, USER_ME),
      'GET /api/v1/policies': (req: Request) => { seen.push(new URL(req.url).search); return json(200, list([row('POL-SG-000017')], 175)); },
    });
    renderAt(<App />, '/policies?multi_sale=true');
    expect(await screen.findByRole('heading', { name: 'Policy Explorer' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'POL-SG-000017' })).toHaveAttribute('href', '/policies/POL-SG-000017');
    expect(screen.getByRole('link', { name: 'CB-2026-10078 Call Detail' })).toHaveAttribute('href', '/cases/c78');
    expect(screen.getByTestId('policy-total')).toHaveTextContent('Showing 1 of 175 matching policies');
    expect(screen.getByText('2 sales · Top up')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Multiple sale events' })).toHaveTextContent('20');
    expect(screen.getByText('Multiple sales: Yes')).toBeInTheDocument();
    expect(seen[0]).toContain('multi_sale=true');
    await userEvent.selectOptions(screen.getByLabelText('Product'), 'ILP');
    await waitFor(() => expect(seen.some((s) => s.includes('product_family=ILP'))).toBe(true));
    for (const name of ['Manual intake', 'Sync from source']) expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('shows empty, invalid-filter and forbidden states', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME), 'GET /api/v1/policies': () => json(200, { ...list([]), facets: {} }) });
    const a = renderAt(<App />, '/policies?q=nothing');
    expect(await screen.findByText('No matching policies')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'ILP policies' })).toHaveTextContent('0'); // a zero count, not "—"
    a.unmount();
    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME), 'GET /api/v1/policies': () => json(422, { code: 'INVALID_FILTER', message: 'Unknown outcome: X', correlation_id: 'c', retryable: false }) });
    const b = renderAt(<App />, '/policies?outcome=X');
    expect(await screen.findByText('These filters are not valid: Unknown outcome: X')).toBeInTheDocument();
    b.unmount();
    stubApi({ 'GET /api/v1/me': () => json(200, { ...USER_ME, permissions: ['dashboard.read'] }) });
    renderAt(<App />, '/policies');
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
  });
});

describe('Policy Detail', () => {
  it('shows the policy header, multi-sale context with historical snapshots and links to Call Detail', async () => {
    stubApi(detailApi);
    renderAt(<App />, '/policies/p17');
    expect(await screen.findByRole('heading', { name: 'Policy Detail' })).toBeInTheDocument();
    expect(await screen.findByText('POL-SG-000017')).toBeInTheDocument();
    expect(screen.getByTestId('pd-sales')).toHaveTextContent('2 · 1 top-up');
    expect(screen.getByTestId('pd-cases')).toHaveTextContent('2 · 1 open');
    expect(screen.getByText(/Synthetic policy data/)).toBeInTheDocument();
    // the latest sale (the top-up) is selected by default; its own snapshot is shown
    await waitFor(() => expect(screen.getByTestId('sale-SALE-SG-000118')).toHaveAttribute('aria-pressed', 'true'));
    expect(await screen.findByTestId('sale-context')).toHaveTextContent('FSC-0018');
    expect(screen.getByTestId('fact-snapshot')).toHaveTextContent('2500');
    expect(screen.getByText(/Investment suitability fact \(not SBQ selection risk\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CB-2026-10078' })).toHaveAttribute('href', '/cases/c78');
    await userEvent.click(screen.getByTestId('sale-SALE-SG-000018'));
    await waitFor(() => expect(screen.getByTestId('fact-snapshot')).toHaveTextContent('980'));
    expect(screen.getByRole('link', { name: 'CB-2026-10005' })).toHaveAttribute('href', '/cases/c5');
    expect(screen.getByRole('button', { name: 'Request risk override' })).toBeDisabled();
  });

  it('risk, parties, script, cases and source workspaces', async () => {
    stubApi(detailApi);
    renderAt(<App />, '/policies/p17?tab=risk&sale=s2');
    const history = await screen.findByTestId('risk-history');
    expect(history).toHaveTextContent('Supersedes');
    expect(screen.getByText(/not the customer's\s+investment suitability/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Party & contact' }));
    const parties = await screen.findByTestId('parties');
    expect(parties).toHaveTextContent('SYN-TEL-SG-••••17');
    expect(parties).toHaveTextContent('Suppressed');
    expect(parties).toHaveTextContent('Ended');
    expect(parties).not.toHaveTextContent(/SYN-TEL-SG-\d{6}/);
    await userEvent.click(screen.getByRole('tab', { name: 'Script assignment' }));
    expect(await screen.findByTestId('policy-scripts')).toHaveTextContent('SG-SALES-VERIFY v2');
    await userEvent.click(screen.getByRole('tab', { name: 'Callback history' }));
    expect(await screen.findByTestId('policy-cases')).toHaveTextContent('Verified compliant');
    await userEvent.click(screen.getByRole('tab', { name: 'Source & changes' }));
    expect(await screen.findByTestId('field-changes')).toHaveTextContent('Field-level change history is not available yet');
    expect(screen.getByTestId('lineage')).toHaveTextContent('SALE-SG-000118');
  });

  it('a sale from another policy is not shown; partial and not-found states', async () => {
    stubApi(detailApi);
    const a = renderAt(<App />, '/policies/p17?sale=other');
    expect(await screen.findByText(/does not belong to this policy/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('sale-SALE-SG-000118')).toHaveAttribute('aria-pressed', 'true'));
    a.unmount();

    stubApi({ ...detailApi, 'GET /api/v1/policies/p17/sales': () => json(503, { code: 'X', message: 'x', correlation_id: 'corr-9', retryable: true }) });
    const b = renderAt(<App />, '/policies/p17');
    expect(await screen.findByText('Sale events could not be loaded.')).toBeInTheDocument();
    expect(screen.getByTestId('pd-cases')).toBeInTheDocument(); // the header still renders
    b.unmount();

    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME), 'GET /api/v1/policies/my': () => json(404, { code: 'NOT_FOUND', message: 'Not found', correlation_id: 'x', retryable: false }) });
    const c = renderAt(<App />, '/policies/my');
    expect(await screen.findByText('Policy not found or not available to you')).toBeInTheDocument();
    c.unmount();

    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME), 'GET /api/v1/policies/p17': () => new Promise<Response>(() => {}) as never });
    renderAt(<App />, '/policies/p17');
    expect(await screen.findByText('Loading Policy Detail…')).toBeInTheDocument();
  });
});
