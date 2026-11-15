// FE-01 (F1) — Overview: server values only, N/A for NOT_MEASURED, forbidden, partial failure and empty states.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { json, ME, renderAt, stubApi } from '../test/render';

afterEach(() => vi.unstubAllGlobals());

const kpi = (id: string, label: string, over: Record<string, unknown> = {}) => ({
  definition_id: id, label, grain: 'case', numerator: 3, denominator: 10, value: 30.0, unit: 'percent',
  status: 'MEASURED', stage_note: null, cohort_basis: 'callback_case.due_at ∈ range',
  range: { from: '2026-10-17', to: '2026-11-16' }, time_zone: 'Asia/Singapore', filter_scope: { markets: ['SG'] },
  dedup_rule: 'COUNT(DISTINCT callback_case.id)', eligibility_rule: `${label} rule`, exclusions: {},
  exemptions_applied: [], materiality_policy_version: null, reopen_handling: 'NOT_SUPPORTED_IN_S0',
  data_as_of: '2026-11-15T04:00:00Z', reporting_version: 'S0-KPI-2', synthetic_badge: true,
  drilldown: { numerator: null, denominator: null }, breakdown: {}, ...over,
});
const KPIS = {
  markets: ['SG'], data_as_of: '2026-11-15T04:00:00Z', synthetic_badge: true, range: { from: '2026-10-17', to: '2026-11-16' },
  items: [
    kpi('OPS-01', 'Open callback cases', { unit: 'count', value: 169, numerator: 169, denominator: null, breakdown: { overdue: 41 } }),
    kpi('OPS-02', 'Due today', { unit: 'count', value: 4, numerator: 4, denominator: null }),
    kpi('KPI-03', 'Survey completion (completed / started)', { value: 77.5 }),
    kpi('OPS-04', 'Awaiting review', { unit: 'count', value: 23, numerator: 23, denominator: null }),
    kpi('OPS-05', 'Verified cases', { unit: 'count', value: 12, breakdown: { VERIFIED_COMPLIANT: 9, VERIFIED_WITH_FINDINGS: 3 } }),
    kpi('KPI-08', 'Recording integrity', { status: 'NOT_MEASURED', value: null, numerator: null, denominator: null,
      stage_note: 'No recordings are captured before Stage S1' }),
    kpi('KPI-10', 'SLA breach rate', { value: 40.0, numerator: 4, denominator: 10, exemptions_applied: [{ rule: 'SLA-EX-001', count: 1 }] }),
    kpi('KPI-15', 'Outcome distribution', { unit: 'count', value: 30, numerator: 30, denominator: 30, breakdown: {
      counts: { VERIFIED_COMPLIANT: 9, VERIFIED_WITH_FINDINGS: 3, NOT_VERIFIED: 5, CANCELLED: 2, OPEN: 11 },
      shares: { VERIFIED_COMPLIANT: 30, VERIFIED_WITH_FINDINGS: 10, NOT_VERIFIED: 16.7, CANCELLED: 6.7, OPEN: 36.7 } } }),
  ],
};
const ok = {
  'GET /api/v1/dashboard/kpis': () => json(200, KPIS),
  'GET /api/v1/dashboard/trend': () => json(200, { definition_id: 'KPI-02', label: 'Connection rate', days: 7,
    time_zone: 'Asia/Singapore', markets: ['SG'], data_as_of: KPIS.data_as_of, synthetic_badge: true,
    points: [{ date: '2026-11-15', numerator: 1, denominator: 3, value: 33.3 }] }),
  'GET /api/v1/dashboard/risk-distribution': () => json(200, { total_open: 10, markets: ['SG'], data_as_of: KPIS.data_as_of,
    synthetic_badge: true, note: 'Risk affects script selection and handling priority, not an automatic misconduct verdict.',
    items: [{ band: 'HIGH', label: 'High (synthetic)', count: 4, share: 40, drilldown: '/calls' },
      { band: 'LOW', label: 'Low (synthetic)', count: 6, share: 60, drilldown: '/calls' }] }),
  'GET /api/v1/dashboard/attention': () => json(200, { markets: ['SG'], data_as_of: KPIS.data_as_of, synthetic_badge: true,
    items: [{ case_id: 'c1', case_ref: 'CB-2026-10482', policy_ref: 'POL-SG-000001', policyholder: 'Example P. 001',
      state: 'AWAITING_REVIEW', due_at: '2026-11-10T00:00:00Z', risk_band: 'HIGH', holds: [], priority: 55,
      reasons: [{ code: 'OVERDUE', label: 'Past due (SLA clock running)' }], route: '/cases/c1' }] }),
  'GET /api/v1/dashboard/activity': () => json(200, { markets: ['SG'], synthetic_badge: true,
    items: [{ event_id: 'e1', occurred_at: '2026-11-14T02:00:00Z', event_type: 'FINDING_RAISED',
      summary: 'HIGH FACT_MISMATCH finding (seeded synthetic)', case_id: 'c1', case_ref: 'CB-2026-10482', related_entity_type: 'finding' }] }),
};

describe('Overview (Command Centre)', () => {
  it('shows server values, N/A for unmeasured KPIs and every region', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ME), ...ok });
    renderAt(<App />, '/');
    expect(await screen.findByRole('heading', { name: 'Command Centre' })).toBeInTheDocument();
    expect(await screen.findByTestId('kpi-OPS-01')).toHaveTextContent('169');
    expect(screen.getByTestId('kpi-KPI-03')).toHaveTextContent('77.5%');
    expect(screen.getByText(/9 compliant · 3 with findings/)).toBeInTheDocument();
    expect(screen.getByText('41 past due · SLA clock running')).toBeInTheDocument();
    const register = screen.getByRole('region', { name: 'KPI register' });
    expect(within(register).getByText('N/A')).toBeInTheDocument();
    expect(within(register).getByText('Recording integrity')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-KPI-10')).toHaveTextContent('40.0% · 4 of 10');
    expect(await screen.findByRole('link', { name: 'CB-2026-10482 Call Detail' })).toHaveAttribute('href', '/cases/c1');
    expect(screen.getByText('High (synthetic)')).toBeInTheDocument();
    expect(screen.getByText('HIGH FACT_MISMATCH finding (seeded synthetic)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New callback case' })).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/non-compliant sale|mis-sold/i);
  });

  it('keeps other regions usable when one region fails (partial) and offers retry', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ME), ...ok,
      'GET /api/v1/dashboard/attention': () => json(500, { code: 'INTERNAL', message: 'x', correlation_id: 'corr-1', retryable: true }) });
    renderAt(<App />, '/');
    expect(await screen.findByText('Priority attention could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Reference: corr-1')).toBeInTheDocument();
    expect(await screen.findByTestId('kpi-OPS-01')).toHaveTextContent('169');
  });

  it('is forbidden without dashboard.read', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, { ...ME, permissions: ['audit.read'] }) });
    renderAt(<App />, '/');
    expect(await screen.findByText('You do not have permission to view this.')).toBeInTheDocument();
  });

  it('explains an empty scope instead of showing numbers', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, { ...ME, markets: [] }), ...ok,
      'GET /api/v1/dashboard/kpis': () => json(200, { ...KPIS, markets: [] }),
      'GET /api/v1/dashboard/risk-distribution': () => json(200, { total_open: 0, markets: [], data_as_of: KPIS.data_as_of,
        synthetic_badge: false, note: 'n', items: [] }) });
    renderAt(<App />, '/');
    expect(await screen.findByText('No market is assigned to your account')).toBeInTheDocument();
    expect(await screen.findByText('No open cases in scope')).toBeInTheDocument();
  });
});
