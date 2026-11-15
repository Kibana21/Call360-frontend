// FE-01 (F2) — Call Explorer, Work Queues, Search and the top-bar search: URL-held filters reach the server
// unchanged; loading, empty, error, partial and forbidden states; no dead links to unfinished detail screens.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const USER_ME = { ...ME, roles: ['USER'], permissions: ['dashboard.read', 'case.read', 'queue.read', 'search.use', 'policy.read'] };
const row = (ref: string, over: Record<string, unknown> = {}) => ({
  case_id: `id-${ref}`, case_ref: ref, policy_id: 'p1', policy_ref: 'POL-SG-000001', policyholder: 'Example P. 001',
  product_family: 'ILP', product_subtype: 'ILP_REGULAR', is_ilp: true, risk_band: 'HIGH', state: 'AWAITING_CALLBACK',
  outcome: 'OPEN', holds: [], blocking_hold: false, overdue: true, due_at: '2026-11-10T00:00:00Z', attempts: 2,
  latest_attempt_status: 'NO_ANSWER', sessions: 0, script: 'SCR-ILP v1.0', evidence: 'NOT_AVAILABLE', is_synthetic: true,
  route: `/cases/id-${ref}`, ...over,
});
const list = (items: unknown[], total = items.length, next: string | null = null) => ({
  items, total, page: { next_cursor: next, limit: 25, sort: 'due_at' }, markets: ['SG'],
  data_as_of: '2026-11-15T04:00:00Z', synthetic_badge: true,
});
const FACETS = { total: 2, markets: ['SG'], data_as_of: '2026-11-15T04:00:00Z', facets: {
  state: { AWAITING_CALLBACK: 2 }, outcome: { OPEN: 2 }, band: { HIGH: 2 }, hold_reason: {}, product_family: { ILP: 2 },
  ilp: { true: 2 }, overdue: { true: 2 } } };

describe('Call Explorer', () => {
  it('sends the URL filters to the server and links each row to its Call Detail', async () => {
    const seen: URL[] = [];
    stubApi({
      'GET /api/v1/me': () => json(200, USER_ME),
      'GET /api/v1/cases': (r) => { seen.push(new URL(r.url)); return json(200, list([row('CB-2026-10001'), row('CB-2026-10002')], 2, 'c2')); },
      'GET /api/v1/cases/facets': () => json(200, FACETS),
    });
    renderAt(<App />, '/calls?kpi=KPI-04&kpi_set=numerator&from=2026-10-17&to=2026-11-16&band=HIGH&state=AWAITING_CALLBACK');
    const table = await screen.findByTestId('case-table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    const q = seen[0]!.searchParams;
    expect([q.get('kpi'), q.get('kpi_set'), q.get('from'), q.get('to'), q.get('band'), q.get('state')])
      .toEqual(['KPI-04', 'numerator', '2026-10-17', '2026-11-16', 'HIGH', 'AWAITING_CALLBACK']);
    expect(screen.getByTestId('register-total')).toHaveTextContent('Showing 2 of 2 matching cases');
    expect(screen.getByText(/Overview drilldown: KPI-04 numerator/)).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'CB-2026-10001' })).toHaveAttribute('href', '/cases/id-CB-2026-10001');
    expect(screen.getByRole('option', { name: 'High (2)' })).toBeInTheDocument();
    // Next page sends the server cursor
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(seen.at(-1)!.searchParams.get('cursor')).toBe('c2'));
  });

  it('shows the partial state when facets fail but the register loads', async () => {
    stubApi({
      'GET /api/v1/me': () => json(200, USER_ME),
      'GET /api/v1/cases': () => json(200, list([row('CB-2026-10001')])),
      'GET /api/v1/cases/facets': () => json(500, { code: 'INTERNAL', message: 'x', correlation_id: 'corr-1', retryable: true }),
    });
    renderAt(<App />, '/calls');
    expect(await screen.findByTestId('case-table')).toBeInTheDocument();
    expect(await screen.findByText(/Filter counts are unavailable/)).toBeInTheDocument();
  });

  it('shows empty, error with correlation id, invalid-filter and forbidden states', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME), 'GET /api/v1/cases': () => json(200, list([])), 'GET /api/v1/cases/facets': () => json(200, FACETS) });
    const { unmount } = renderAt(<App />, '/calls?q=NOPE');
    expect(await screen.findByText('No matching cases')).toBeInTheDocument();
    unmount();

    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME), 'GET /api/v1/cases': () => json(503, { code: 'X', message: 'down', correlation_id: 'corr-9', retryable: true }), 'GET /api/v1/cases/facets': () => json(200, FACETS) });
    const second = renderAt(<App />, '/calls');
    expect(await screen.findByText('Callback cases could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Reference: corr-9')).toBeInTheDocument();
    second.unmount();

    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME), 'GET /api/v1/cases': () => json(422, { code: 'INVALID_FILTER', message: 'Unknown outcome: X', correlation_id: null, retryable: false }), 'GET /api/v1/cases/facets': () => json(200, FACETS) });
    const third = renderAt(<App />, '/calls?outcome=X');
    expect(await screen.findByText('These filters are not valid: Unknown outcome: X')).toBeInTheDocument();
    third.unmount();

    stubApi({ 'GET /api/v1/me': () => json(200, { ...USER_ME, permissions: ['dashboard.read'] }) });
    renderAt(<App />, '/calls');
    expect(await screen.findByRole('heading', { name: /access restricted|not authori[sz]ed/i })).toBeInTheDocument();
  });

  it('shows a loading state first', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME), 'GET /api/v1/cases': () => new Promise<Response>(() => {}) as never, 'GET /api/v1/cases/facets': () => json(200, FACETS) });
    renderAt(<App />, '/calls');
    expect(await screen.findByText('Loading callback cases…')).toBeInTheDocument();
  });
});

describe('Work Queues', () => {
  const QUEUES = { markets: ['SG'], data_as_of: '2026-11-15T04:00:00Z', time_zone: 'Asia/Singapore', synthetic_badge: true, items: [
    { code: 'DUE_TODAY', label: 'Due today', count: 3, rule: 'r1', route: '/queues?queue=DUE_TODAY', register_route: '/calls?queue=DUE_TODAY', by_reason: [] },
    { code: 'OVERDUE', label: 'Overdue', count: 68, rule: 'r2', route: '/queues?queue=OVERDUE', register_route: '/calls?queue=OVERDUE', by_reason: [] },
    { code: 'AWAITING_CALLBACK', label: 'Awaiting callback', count: 88, rule: 'r3', route: '/queues?queue=AWAITING_CALLBACK', register_route: '/calls?queue=AWAITING_CALLBACK', by_reason: [] },
    { code: 'ON_HOLD', label: 'On hold', count: 8, rule: 'r4', route: '/queues?queue=ON_HOLD', register_route: '/calls?queue=ON_HOLD',
      by_reason: [{ hold_reason: 'DATA_CONFLICT', count: 3, blocking: 3, register_route: '/calls?queue=ON_HOLD&hold_reason=DATA_CONFLICT' }] },
  ] };

  it('shows queue counts, loads the selected queue through the register and filters on hold by reason', async () => {
    const seen: URL[] = [];
    stubApi({
      'GET /api/v1/me': () => json(200, USER_ME),
      'GET /api/v1/work-queues': () => json(200, QUEUES),
      'GET /api/v1/cases': (r) => { seen.push(new URL(r.url)); return json(200, list([row('CB-2026-10003', { holds: ['DATA_CONFLICT'], blocking_hold: true })])); },
    });
    renderAt(<App />, '/queues?queue=ON_HOLD');
    expect(await screen.findByTestId('queue-OVERDUE')).toHaveTextContent('68');
    await screen.findByTestId('case-table');
    expect(seen[0]!.searchParams.get('queue')).toBe('ON_HOLD');
    await userEvent.click(screen.getByRole('button', { name: /Data conflict \(3, 3 blocking\)/ }));
    await waitFor(() => expect(seen.at(-1)!.searchParams.get('hold_reason')).toBe('DATA_CONFLICT'));
    expect(screen.getByRole('link', { name: /Open in Call Explorer/ })).toHaveAttribute('href', '/calls?queue=ON_HOLD&hold_reason=DATA_CONFLICT');
    expect(screen.getByRole('button', { name: 'Launch browser session' })).toBeDisabled();
  });

  it('keeps the rows usable when the queue counts fail (partial)', async () => {
    stubApi({
      'GET /api/v1/me': () => json(200, USER_ME),
      'GET /api/v1/work-queues': () => json(500, { code: 'X', message: 'x', correlation_id: 'corr-2', retryable: true }),
      'GET /api/v1/cases': () => json(200, list([row('CB-2026-10004')])),
    });
    renderAt(<App />, '/queues');
    expect(await screen.findByText('Queue counts could not be loaded.')).toBeInTheDocument();
    expect(await screen.findByTestId('case-table')).toBeInTheDocument();
  });
});

describe('Search', () => {
  const HIT = { entity_type: 'policy', id: 'p1', ref: 'POL-SG-000001', masked_display: 'Example P. 001 · ILP (ILP)', matched_field: 'policy_ref',
    match_kind: 'EXACT', route: '/policies/p1', register_route: '/calls?q=POL-SG-000001' };

  it('a top-bar policy suggestion opens Policy Detail', async () => {
    stubApi({
      'GET /api/v1/me': () => json(200, USER_ME),
      'GET /api/v1/search/suggest': () => json(200, { items: [HIT], markets: ['SG'] }),
      'GET /api/v1/cases': () => json(200, list([row('CB-2026-10482')])),
      'GET /api/v1/cases/facets': () => json(200, FACETS),
      'GET /api/v1/dashboard/kpis': () => json(200, { items: [], markets: ['SG'], data_as_of: '2026-11-15T04:00:00Z', synthetic_badge: true, range: { from: '2026-10-17', to: '2026-11-16' } }),
    });
    renderAt(<App />, '/calls');
    const box = await screen.findByRole('combobox', { name: /Search cases, policies, attempts and sessions/ });
    await userEvent.type(box, 'POL-SG');
    const option = await screen.findByRole('option', { name: /POL-SG-000001/ });
    await userEvent.keyboard('{ArrowDown}');
    expect(option).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Policy Detail' })).toBeInTheDocument());
  });

  it('results page shows type, match kind and matched field, linking only to available screens', async () => {
    stubApi({
      'GET /api/v1/me': () => json(200, USER_ME),
      'GET /api/v1/search': () => json(200, { items: [HIT], total: 1, counts: { policy: 1 }, page: { next_cursor: null, limit: 20, sort: 'rank' }, markets: ['SG'] }),
    });
    renderAt(<App />, '/search?q=POL-SG-000001');
    const hit = await screen.findByTestId('search-hit');
    expect(hit).toHaveAttribute('href', HIT.route);
    expect(hit).toHaveTextContent('exact match');
    expect(hit).toHaveTextContent('on policy ref');
    expect(hit).toHaveTextContent('Opens Policy Detail');
    expect(screen.getByRole('button', { name: 'Policies (1)' })).toBeInTheDocument();
  });

  it('shows the empty state for a query with no hits in scope', async () => {
    stubApi({
      'GET /api/v1/me': () => json(200, USER_ME),
      'GET /api/v1/search': () => json(200, { items: [], total: 0, counts: {}, page: { next_cursor: null, limit: 20, sort: 'rank' }, markets: ['SG'] }),
    });
    renderAt(<App />, '/search?q=CB-2026-20001');
    expect(await screen.findByText('No matching records in your scope')).toBeInTheDocument();
  });
});
