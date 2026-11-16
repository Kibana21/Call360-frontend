// FE (F5) — SBQ Risk Workbench: server values only, sale-grain overview kept apart from the assessment population,
// URL filters, the detail drawer (comparison, factors, history, links), and loading, empty, error, partial,
// not-found and forbidden states.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const USER_ME = { ...ME, roles: ['USER'], permissions: ['dashboard.read', 'case.read', 'policy.read', 'risk.read', 'search.use'] };
const T = '2026-10-15T02:00:00Z';
const row = (id: string, origin: string, band: string, over: Record<string, unknown> = {}) => ({
  id, sale_event_id: 's168', sale_ref: 'SALE-SG-000168', sale_event_type: 'NEW_BUSINESS', sold_at: T, policy_id: 'p157', policy_ref: 'POL-SG-000157',
  product_family: 'PROTECTION', is_ilp: false, channel: 'DIRECT', fsc_ref: 'FSC-0008', origin, status: 'FINAL', band_code: band, score: null,
  reason_codes: origin === 'RULE_ASSESSED' ? ['R-PREMIUM'] : ['SRC-LOW'], source_original_value: origin === 'SOURCE_ASSIGNED' ? 'SBQ-L' : null,
  rule_set: origin === 'RULE_ASSESSED' ? 'SYN-SBQ-RULES v2' : null, assessed_at: T, valid_at: T, input_snapshot_sha256: origin === 'RULE_ASSESSED' ? 'e'.repeat(64) : null,
  matched_factors: origin === 'RULE_ASSESSED' ? ['PREMIUM_AMOUNT_BAND'] : [], effective: origin === 'RULE_ASSESSED', supersedes_id: null, superseded_by: null,
  discrepancy: true, cases: [{ case_id: 'c121', case_ref: 'CB-2026-10121', route: '/cases/c121' }], is_synthetic: true, route: `/risk-assessments?assessment=${id}`, ...over,
});
const RULE = row('r1', 'RULE_ASSESSED', 'MEDIUM');
const SRC = row('r0', 'SOURCE_ASSIGNED', 'LOW');
const SUMMARY = {
  assessments: { total: 229, by_origin: { RULE_ASSESSED: 74, SOURCE_ASSIGNED: 155 }, by_status: { FINAL: 214, SUPERSEDED: 15 }, by_band: { HIGH: 77, LOW: 75, MEDIUM: 62, UNKNOWN: 15 }, superseded: 15 },
  sales: { total: 195, by_effective_band: { HIGH: 69, LOW: 66, MEDIUM: 58 }, without_assessment: 2, without_final_assessment: 0, source_rule_discrepancies: 3 },
};
const FACETS = { band: { HIGH: 77, LOW: 75, MEDIUM: 62 }, origin: { RULE_ASSESSED: 74, SOURCE_ASSIGNED: 155 }, status: { FINAL: 214, SUPERSEDED: 15 },
  factor: { ILP_INDICATOR: 24, PREMIUM_AMOUNT_BAND: 25 }, rule_set: { NONE: 155, 'SYN-SBQ-RULES v2': 65 }, product_family: { PROTECTION: 50 }, channel: { DIRECT: 40 },
  fsc: {}, effective: { true: 193, false: 36 }, discrepancy: { true: 6, false: 223 } };
const list = (items: unknown[], total = items.length) => ({ items, total, page: { next_cursor: null, limit: 25, sort: '-valid_at' }, facets: FACETS, summary: SUMMARY,
  markets: ['SG'], data_as_of: T, synthetic_badge: true });
const VOCAB = { list_code: 'risk_factor', version: 1, status: 'ACTIVE', bands: [],
  items: [{ code: 'PREMIUM_AMOUNT_BAND', label: 'Premium amount band (source-supplied label)', attributes: { value_type: 'ENUM' } },
    { code: 'ILP_INDICATOR', label: 'Investment-linked indicator', attributes: { value_type: 'BOOLEAN' } }] };
const DETAIL = {
  ...RULE, kind: 'CALLBACK_SELECTION', explanation: 'Seeded synthetic trace',
  factors: [{ factor_code: 'PREMIUM_AMOUNT_BAND', label: 'Premium amount band (source-supplied label)', value_type: 'ENUM', value: 'BAND_C', source: 'SYN-POLICY-ADMIN', matched_rule_id: 'R-PREMIUM', weight: null, result: 'MATCHED' },
    { factor_code: 'ILP_INDICATOR', label: 'Investment-linked indicator', value_type: 'BOOLEAN', value: false, source: 'SYN-POLICY-ADMIN', matched_rule_id: null, weight: null, result: 'NOT_MATCHED' }],
  rule_set_version: { code: 'SYN-SBQ-RULES', version: 2, status: 'PUBLISHED', effective_from: T, effective_to: null, checksum: 'f'.repeat(64), content_approval_status: 'SYNTHETIC_UNAPPROVED' },
  provenance: { source_type: 'SEED', source_system: 'SYN-SEED', source_reference: 'S0-SEED-1', source_observed_at: T, recorded_at: T, mapping_version: null, intake_item_id: null, is_synthetic: true },
  history: [SRC, RULE], comparison: { source_band: 'LOW', rule_band: 'MEDIUM', effective_band: 'MEDIUM', effective_id: 'r1', discrepancy: true },
};
const api = (over: Record<string, (req: Request) => Response> = {}) => ({
  'GET /api/v1/me': () => json(200, USER_ME),
  'GET /api/v1/risk-assessments': () => json(200, list([RULE, SRC], 229)),
  'GET /api/v1/risk-factors': () => json(200, VOCAB),
  'GET /api/v1/risk-assessments/r1': () => json(200, DETAIL),
  'GET /api/v1/risk-assessments/r0': () => json(200, { ...DETAIL, ...SRC, factors: [], rule_set_version: null, history: [SRC, RULE] }),
  ...over,
});

describe('SBQ Risk Workbench', () => {
  it('shows sale-grain overview, assessment population, vocabulary and the register from the server', async () => {
    stubApi(api());
    renderAt(<App />, '/risk-assessments');
    expect(await screen.findByRole('heading', { name: 'SBQ Risk Workbench' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'High-risk sales' })).toHaveTextContent('69');
    expect(screen.getByRole('region', { name: 'Source ≠ rule' })).toHaveTextContent('3');
    expect(screen.getByRole('region', { name: 'Low-risk sales' })).toHaveTextContent('2 of 195 sales unassessed');
    expect(screen.getByTestId('risk-population')).toHaveTextContent('By origin · 229 assessments');
    expect(screen.getByText(/not the customer's investment suitability/)).toBeInTheDocument();
    expect(await screen.findByTestId('factor-vocabulary')).toHaveTextContent('Investment-linked indicator');
    expect(screen.getByTestId('risk-total')).toHaveTextContent('Showing 2 of 229 matching assessments');
    const table = screen.getByTestId('risk-table');
    expect(within(table).getAllByText('Source ≠ rule')).toHaveLength(2);
    expect(within(table).getByText('SBQ-L')).toBeInTheDocument();
    expect(within(table).getAllByRole('link', { name: 'POL-SG-000157 Policy Detail' })[0]).toHaveAttribute('href', '/policies/p157?sale=s168&tab=risk');
    for (const name of ['Risk policy settings', 'Assess a sale']) expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('overview tiles and filters drive the URL', async () => {
    const seen: string[] = [];
    stubApi(api({ 'GET /api/v1/risk-assessments': (req: Request) => { seen.push(new URL(req.url).search); return json(200, list([RULE], 1)); } }));
    renderAt(<App />, '/risk-assessments');
    expect(await screen.findByRole('heading', { name: 'SBQ Risk Workbench' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Show assessments\s*:\s*Source ≠ rule/ }));
    await waitFor(() => expect(seen.some((s) => s.includes('discrepancy=true'))).toBe(true));
    expect(screen.getByText('Source ≠ rule: Yes')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Origin'), 'RULE_ASSESSED');
    await waitFor(() => expect(seen.some((s) => s.includes('origin=RULE_ASSESSED'))).toBe(true));
  });

  it('the drawer compares source and rule, explains factors, lists history and links to Policy and Call Detail', async () => {
    stubApi(api());
    renderAt(<App />, '/risk-assessments?assessment=r1');
    const drawer = await screen.findByRole('dialog', { name: 'SALE-SG-000168 · Rule-assessed' });
    expect(within(drawer).getByTestId('risk-comparison')).toHaveTextContent('Source-assigned (latest final)Low');
    expect(within(drawer).getByTestId('risk-comparison')).toHaveTextContent('Rule-assessed (latest final)Medium');
    expect(within(drawer).getByText(/disagree on this sale's band/)).toBeInTheDocument();
    expect(within(drawer).getByTestId('risk-factors')).toHaveTextContent('Premium amount band (source-supplied label)');
    expect(within(drawer).getByTestId('risk-factors')).toHaveTextContent('BAND_C');
    expect(within(drawer).getByText(/SYN-SBQ-RULES v2 · Published/)).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: /Call Detail CB-2026-10121/ })).toHaveAttribute('href', '/cases/c121');
    expect(within(drawer).getByRole('link', { name: /Policy Detail POL-SG-000157/ })).toHaveAttribute('href', '/policies/p157?sale=s168&tab=risk');
    expect(within(drawer).getByRole('button', { name: 'Close assessment details' })).toHaveFocus();
    // open the source-assigned version from the history
    await userEvent.click(within(within(drawer).getByTestId('risk-history')).getByRole('button', { name: /Source-assigned · Low/ }));
    expect(await screen.findByText(/No factor results are stored for this assessment/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('marks superseded assessments and shows not-found, empty, error, partial and forbidden states', async () => {
    stubApi(api({ 'GET /api/v1/risk-assessments': () => json(200, list([row('s1', 'SOURCE_ASSIGNED', 'UNKNOWN', { status: 'SUPERSEDED', superseded_by: 'x', effective: false, discrepancy: false })])),
      'GET /api/v1/risk-assessments/my': () => json(404, { code: 'NOT_FOUND', message: 'Not found', correlation_id: 'x', retryable: false }),
      'GET /api/v1/risk-factors': () => json(503, { code: 'X', message: 'x', correlation_id: 'corr-3', retryable: true }) }));
    const a = renderAt(<App />, '/risk-assessments?assessment=my');
    expect(await screen.findByText('Assessment not found or not available to you')).toBeInTheDocument();
    expect(within(screen.getByTestId('risk-table')).getByText('Superseded')).toBeInTheDocument();
    expect(within(screen.getByTestId('risk-table')).getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Factor vocabulary could not be loaded.')).toBeInTheDocument(); // partial: the register still renders
    a.unmount();

    stubApi(api({ 'GET /api/v1/risk-assessments': () => json(200, list([])) }));
    const b = renderAt(<App />, '/risk-assessments?q=none');
    expect(await screen.findByText('No matching assessments')).toBeInTheDocument();
    b.unmount();

    stubApi(api({ 'GET /api/v1/risk-assessments': () => json(500, { code: 'X', message: 'x', correlation_id: 'corr-5', retryable: true }) }));
    const c = renderAt(<App />, '/risk-assessments');
    expect(await screen.findByText('Risk assessments could not be loaded.')).toBeInTheDocument();
    c.unmount();

    stubApi({ 'GET /api/v1/me': () => json(200, { ...USER_ME, permissions: ['dashboard.read'] }) });
    renderAt(<App />, '/risk-assessments');
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
  });
});
