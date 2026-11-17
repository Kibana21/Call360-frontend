// CP0.4b — Data Intake screen: permissions, reference-driven inputs, preview gating, field errors, idempotent submit.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const ADMIN = { ...ME, permissions: [...ME.permissions, 'intake.read', 'intake.manual.submit', 'policy.read', 'case.read'] };
const USER = { ...ME, roles: ['USER'], permissions: ['dashboard.read', 'case.read', 'policy.read'] };
const SOURCES = { data_policy: 'SYNTHETIC_ONLY', items: [
  { source_type: 'MANUAL', available: true, note: 'Manual synthetic transaction intake (API)' },
  { source_type: 'MOCK_API', available: false, note: 'Mock upstream import is deferred (CP0.4b)' },
] };
const REFERENCE = {
  market_code: 'SG', currency: 'SGD', data_policy: 'SYNTHETIC_ONLY', source_system_prefix: 'SYN-', reserved_source_systems: ['SYN-SEED'],
  products: [{ product_code: 'SYN-PROT-TERM', product_family: 'PROTECTION', product_subtype: 'TERM_LIFE' }],
  fscs: [{ fsc_ref: 'FSC-0002', display_name: 'Example Representative 02', channel: 'BANCASSURANCE' }],
  risk_bands: [{ code: 'HIGH', label: 'High (synthetic)' }], risk_band_list_version: 'v',
  contact_formats: [{ channel: 'PHONE', code: 'PHONE_SYNTHETIC_ID', label: 'Non-dialable synthetic phone identifier', pattern: '^SYN-TEL-(SG|MY)-[0-9]{6}$', example: 'SYN-TEL-SG-123456' }],
  enums: { policy_status: ['IN_FORCE'], premium_frequency: ['MONTHLY', 'SINGLE'], sale_event_type: ['NEW_BUSINESS', 'TOP_UP'],
    selling_channel: ['AGENCY', 'BANCASSURANCE'], party_kind: ['PERSON'], party_role: ['OWNER', 'INSURED', 'AUTHORIZED_CONTACT'],
    contact_channel: ['PHONE', 'EMAIL'], consent_status: ['GRANTED'], risk_status: ['FINAL'] },
  priority_min: 1, priority_max: 5,
};
const outcome = (mode: 'PREVIEW' | 'COMMITTED') => ({
  mode, replayed: false, run_id: mode === 'COMMITTED' ? 'r1' : null, run_ref: mode === 'COMMITTED' ? 'IR-2026-000009' : null,
  payload_digest: 'd', source_system: 'SYN-POLICY-ADMIN', source_event_id: 'E1',
  policy: { outcome: 'NEW', policy_ref: 'POL-SG-900001', policy_id: mode === 'COMMITTED' ? 'p1' : null },
  sale_ref: 'SALE-SG-900001', sale_event_id: null, parties: [], eligibility: [], risk: null, risk_note: null,
  case: { case_id: mode === 'COMMITTED' ? 'c1' : null, case_ref: mode === 'COMMITTED' ? 'CB-2026-10600' : null, state: 'VALIDATED',
    obligation_type: 'NEW_BUSINESS_VERIFICATION', source_request_ref: 'R1', due_at: '2026-12-01T00:00:00Z', priority: 2, callable: false },
  holds: [{ reason: 'AWAITING_SCRIPT_ASSIGNMENT', label: 'Awaiting script assignment', blocking: true }],
  script_routing: 'AWAITING_DETERMINISTIC_ASSIGNMENT', compliance_outcome: 'NOT_EVALUATED_IN_S0',
  routes: mode === 'COMMITTED' ? { policy: '/policies/p1?sale=s1', case: '/cases/c1' } : {},
});
const base = (extra: Record<string, (r: Request) => Response> = {}) => ({
  'GET /api/v1/me': () => json(200, ADMIN), 'GET /api/v1/intake/sources': () => json(200, SOURCES),
  'GET /api/v1/intake/reference': () => json(200, REFERENCE), ...extra,
});
const panel = () => screen.getByRole('complementary', { name: 'Preview and submit' });

describe('Data Intake screen', () => {
  it('sends USER to the unauthorized screen', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, USER) });
    renderAt(<App />, '/intake');
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Manual intake transaction' })).toBeNull();
  });

  it('offers reference values and keeps Submit disabled until a preview matches the form', async () => {
    const preview = vi.fn(() => json(200, outcome('PREVIEW')));
    stubApi(base({ 'POST /api/v1/intake/manual/preview': preview }));
    renderAt(<App />, '/intake');
    expect(await screen.findByTestId('source-MOCK_API')).toHaveTextContent('Not available');
    const fsc = await screen.findByLabelText('FSC representative');
    expect(within(fsc).getByRole('option', { name: /FSC-0002/ })).toBeInTheDocument();
    await userEvent.selectOptions(fsc, 'FSC-0002');
    expect(screen.getByLabelText('Selling channel')).toHaveValue('BANCASSURANCE');
    expect(screen.getByText(/SYN-TEL-SG-123456/)).toBeInTheDocument();
    const submit = within(panel()).getByRole('button', { name: 'Submit transaction' });
    expect(submit).toBeDisabled();
    await userEvent.click(within(panel()).getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(submit).toBeEnabled());
    expect(within(panel()).getByTestId('intake-outcome')).toHaveTextContent('Preview — nothing saved');
    expect(within(panel()).getByText('Awaiting script assignment')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Sale reference'), 'X');
    expect(submit).toBeDisabled();
    expect(screen.getByTestId('preview-state')).toHaveTextContent('Form changed since preview');
  });

  it('shows server validation errors on the fields they belong to', async () => {
    stubApi(base({ 'POST /api/v1/intake/manual/preview': () => json(422, { code: 'INGEST_VALIDATION_FAILED', message: 'The transaction failed validation',
      details: [{ loc: ['body', 'callback_request', 'due_at'], code: 'BEFORE_SALE', message: 'Due date is before the sale' },
        { loc: ['body', 'parties', 0, 'contacts', 0, 'value'], code: 'CONTACT_NOT_SYNTHETIC', message: 'Not a reserved synthetic value' }] }) }));
    renderAt(<App />, '/intake');
    await userEvent.click(await within(await screen.findByRole('complementary', { name: 'Preview and submit' })).findByRole('button', { name: 'Preview' }));
    expect(await screen.findByTestId('intake-problem')).toHaveTextContent('Rejected: fix the highlighted fields');
    expect(screen.getByLabelText('Due (SGT)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Due (SGT)')).toHaveAccessibleDescription(/Due date is before the sale/);
    expect(screen.getByLabelText('Contact 1 value')).toHaveAttribute('aria-invalid', 'true');
    expect(within(panel()).getByRole('button', { name: 'Submit transaction' })).toBeDisabled();
  });

  it('submits once with an Idempotency-Key, retries with the same key, and links to the created records', async () => {
    const keys: (string | null)[] = [];
    let fail = true;
    stubApi(base({
      'POST /api/v1/intake/manual/preview': () => json(200, outcome('PREVIEW')),
      'POST /api/v1/intake/manual': (req) => {
        keys.push(req.headers.get('Idempotency-Key'));
        if (fail) { fail = false; throw new TypeError('network down'); }
        return json(201, outcome('COMMITTED'));
      },
      'GET /api/v1/intake/import-runs': () => json(200, { items: [], total: 0 }),
    }));
    renderAt(<App />, '/intake');
    await userEvent.click(await within(await screen.findByRole('complementary', { name: 'Preview and submit' })).findByRole('button', { name: 'Preview' }));
    const submit = await within(panel()).findByRole('button', { name: 'Submit transaction' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    fireEvent.click(submit); // a double click sends one request
    expect(await screen.findByTestId('intake-problem')).toHaveTextContent('could not be reached');
    expect(keys).toHaveLength(1);
    await userEvent.click(within(panel()).getByRole('button', { name: 'Retry submission' }));
    const result = await screen.findByRole('complementary', { name: 'Preview and submit' });
    expect(await within(result).findByText('Submitted')).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^portal-/);
    expect(keys[1]).toBe(keys[0]);
    expect(within(result).getByRole('link', { name: 'Open Call Detail' })).toHaveAttribute('href', '/cases/c1');
    expect(within(result).getByRole('link', { name: 'Open Policy Detail' })).toHaveAttribute('href', '/policies/p1?sale=s1');
    expect(within(result).getByText('CB-2026-10600')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Manual intake transaction' }).querySelector('fieldset')).toBeDisabled();
  });

  it('lists intake runs and explains that rejected attempts are audit events', async () => {
    stubApi(base({
      'GET /api/v1/intake/import-runs': () => json(200, { total: 1, items: [{ id: 'r1', run_ref: 'IR-2026-000001', source_type: 'MANUAL',
        source_system: 'SYN-POLICY-ADMIN', status: 'ACCEPTED', started_at: '2026-11-16T01:00:00Z', finished_at: '2026-11-16T01:00:00Z',
        requested_by: 'Demo Administrator', counts: { received: 1, new: 1, updated: 0, unchanged: 0, rejected: 0, quarantined: 0 }, payload_digest: 'd' }] }),
      'GET /api/v1/intake/import-runs/r1': () => json(200, { id: 'r1', run_ref: 'IR-2026-000001', source_type: 'MANUAL', source_system: 'SYN-POLICY-ADMIN',
        status: 'ACCEPTED', started_at: '2026-11-16T01:00:00Z', finished_at: null, requested_by: 'Demo Administrator',
        counts: { received: 1, new: 1, updated: 0, unchanged: 0, rejected: 0, quarantined: 0 }, payload_digest: 'd',
        items: [{ id: 'i1', source_system: 'SYN-POLICY-ADMIN', source_event_id: 'E1', entity_type: 'SALE_TRANSACTION', status: 'ACCEPTED', errors: [], payload_digest: 'd' }],
        result: outcome('COMMITTED') }),
    }));
    renderAt(<App />, '/intake?tab=history');
    expect(await screen.findByText(/Rejected submissions are not runs/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'View IR-2026-000001' }));
    const drawer = await screen.findByRole('dialog', { name: 'IR-2026-000001' });
    expect(await within(drawer).findByRole('link', { name: 'Open Call Detail' })).toHaveAttribute('href', '/cases/c1');
  });
});
