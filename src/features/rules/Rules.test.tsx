// S2-B Assignment Rules UI: prioritised registry and legacy deep links, the visual builder (structured conditions only,
// server feedback, row-version save), maker-checker review with explicit supersede, and simulation results.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const USER = { ...ME, principal: { ...ME.principal, principal_id: 'u1' }, roles: ['USER'], permissions: ['dashboard.read', 'case.read', 'script.read', 'script.edit'] };
const CHECKER = { ...ME, principal: { ...ME.principal, principal_id: 'k1' }, roles: ['SC_CHECKER'], permissions: ['dashboard.read', 'script.read', 'script.approve', 'script.publish'] };
const OPTIONS = {
  fields: [
    { field: 'market', label: 'Market', values: [{ value: 'SG', label: 'Singapore' }], source: 'Governed code list', required: true },
    { field: 'is_ilp', label: 'ILP indicator', values: [{ value: true, label: 'ILP' }, { value: false, label: 'Not ILP' }], source: 'Policy fact snapshot', required: false },
    { field: 'risk_band', label: 'SBQ sale-selection risk band', values: [{ value: 'HIGH', label: 'High' }, { value: 'UNASSESSED', label: 'Unassessed (no final SBQ assessment)' }], source: 'sbq_risk_band', required: false },
  ],
  unsupported: [{ field: 'language', label: 'Language', reason: 'No language is recorded on cases.' }],
  targets: [{ id: 't1', label: 'SALES_VERIFICATION_SG v1.1', family: 'SALES_VERIFICATION_SG', version_label: '1.1', status: 'PUBLISHED', effective_from: '2026-07-18T00:00:00Z', effective_to: null, content_approval_status: 'SYNTHETIC_UNAPPROVED', selectable: true },
    { id: 't0', label: 'SALES_VERIFICATION_SG v0.9', family: 'SALES_VERIFICATION_SG', version_label: '0.9', status: 'WITHDRAWN', effective_from: '2025-10-11T00:00:00Z', effective_to: '2026-01-19T00:00:00Z', content_approval_status: 'SYNTHETIC_UNAPPROVED', selectable: false }],
  precedence: ['Priority first: a lower number wins (1 is the highest priority).'], priority_range: [1, 999],
};
const version = (v: number, status: string, extra: Record<string, unknown> = {}) => ({
  id: `rv${v}`, rule_code: 'SG-SALES-VERIFY', version: v, name: 'SG-SALES-VERIFY', status, priority: 10, specificity: 2, is_fallback: false,
  conditions: [{ field: 'market', values: ['SG'] }, { field: 'case_purpose', values: ['SALE_VERIFICATION'] }],
  explanation: 'Assign SALES_VERIFICATION_SG v1.1 when the market is SG and the callback purpose is Sale verification. Priority 10 (1 is highest), specificity 2.',
  target: { id: 't1', label: 'SALES_VERIFICATION_SG v1.1', script_family_id: 'f1', status: 'PUBLISHED' }, effective_from: '2026-07-18T00:00:00Z', effective_to: null,
  checksum: 'd'.repeat(64), author_ref: 'SYN-A', checker_ref: 'SYN-C', published_by: null, cases_assigned: 166, authored_in_rule_studio: false, ...extra,
});
const analysis = (extra: Record<string, unknown> = {}) => ({ issues: [], conflicts: [], specificity: 1, explanation: 'Assign the chosen script version when the market is SG.', valid: true, ...extra });
const draft = (extra: Record<string, unknown> = {}) => ({
  id: 'd1', rule_code: 'SG-ILP-HIGH', name: 'ILP high risk', description: '', market: 'SG', planned_version: 1, status: 'DRAFT',
  conditions: [{ field: 'market', values: ['SG'] }], priority: 100, is_fallback: false, target: null, effective_from: null, effective_to: null,
  validation_status: 'NOT_VALIDATED', manifest_sha256: null, author_ref: 'u1', reviewer_ref: null, publisher_ref: null, published_rule_version_id: null,
  base_rule_version_id: null, base_ref: null, copied_from_ref: null, live_rule_version_id: null, live_ref: null, row_version: 1, makers: ['u1'],
  people: { u1: 'Demo User' }, analysis: analysis(), created_at: '2026-11-17T10:00:00Z', updated_at: null, ...extra,
});
const history = (drafts: unknown[], versions: unknown[] = []) => ({ rule_code: 'SG-ILP-HIGH', events: [], versions, drafts });
const routes = (me: unknown, extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) => ({
  'GET /api/v1/me': () => json(200, me), 'GET /api/v1/assignment-rules/options': () => json(200, OPTIONS), ...extra,
});

describe('Assignment Rules', () => {
  it('lists rules in precedence order and redirects F6 deep links to Rule Detail', async () => {
    const registry = { total: 1, conflicts: [], items: [{ rule_code: 'SG-SALES-VERIFY', name: 'SG-SALES-VERIFY', market: 'SG', live: version(2, 'PUBLISHED'),
      versions: [version(1, 'SUPERSEDED'), version(2, 'PUBLISHED')], open_draft: null, drafts: [] }] };
    stubApi(routes(USER, {
      'GET /api/v1/assignment-rules': () => json(200, registry),
      'GET /api/v1/assignment-rules/SG-SALES-VERIFY/history': () => json(200, { ...history([], registry.items[0]!.versions), rule_code: 'SG-SALES-VERIFY' }),
    }));
    const { unmount } = renderAt(<App />, '/assignment-rules');
    const row = await screen.findByTestId('rule-SG-SALES-VERIFY');
    expect(row).toHaveTextContent('#10');
    expect(row).toHaveTextContent('SALES_VERIFICATION_SG v1.1');
    expect(screen.getByTestId('precedence')).toHaveTextContent('a lower number wins');
    expect(screen.getByTestId('new-rule')).toBeEnabled();
    unmount();
    renderAt(<App />, '/assignment-rules?rule=SG-SALES-VERIFY%20v2');
    expect(await screen.findByTestId('rule-version-header')).toHaveTextContent('Immutable published version');
    expect(screen.getByTestId('rule-explanation')).toHaveTextContent('when the market is SG');
  });

  it('builds conditions from governed values only, gets server feedback and saves with the row version', async () => {
    let saved: unknown = null;
    const explained: unknown[] = [];
    stubApi(routes(USER, {
      'GET /api/v1/assignment-rules/SG-ILP-HIGH/history': () => json(200, history([{ id: 'd1', planned_version: 1, status: 'DRAFT', name: 'ILP high risk', author_ref: 'u1', updated_at: null, created_at: '2026-11-17T10:00:00Z' }])),
      'GET /api/v1/assignment-rule-drafts/d1': () => json(200, draft()),
      'POST /api/v1/assignment-rules/explain': async (r) => { const b = await r.json(); explained.push(b); return json(200, analysis({ specificity: b.conditions.length, explanation: 'Assign SALES_VERIFICATION_SG v1.1 when the market is SG and the product is an ILP.' })); },
      'PUT /api/v1/assignment-rule-drafts/d1': async (r) => { saved = await r.json(); return json(200, { draft_id: 'd1', row_version: 2 }); },
    }));
    renderAt(<App />, '/assignment-rules/SG-ILP-HIGH?draft=d1');
    const builder = await screen.findByTestId('rule-builder');
    expect(within(builder).queryByRole('textbox', { name: /expression|json|sql/i })).toBeNull();
    expect(screen.getByTestId('rb-unsupported')).toHaveTextContent('Language');
    await userEvent.selectOptions(screen.getByTestId('rb-add-condition'), 'is_ilp');
    await userEvent.click(within(screen.getByTestId('rb-cond-is_ilp')).getByLabelText('ILP'));
    await userEvent.selectOptions(screen.getByTestId('rb-target'), 't1');
    expect(screen.getByRole('option', { name: /v0.9 \(withdrawn — not selectable\)/ })).toBeDisabled();
    await userEvent.clear(screen.getByTestId('rb-priority'));
    await userEvent.type(screen.getByTestId('rb-priority'), '5');
    await waitFor(() => expect(screen.getByTestId('rule-explanation')).toHaveTextContent('the product is an ILP'));
    await waitFor(() => expect(screen.getByTestId('rb-specificity')).toHaveTextContent('2'));
    expect(within(screen.getByTestId('rb-cond-market')).getByLabelText('Singapore')).toBeDisabled();
    await userEvent.click(screen.getByTestId('rb-save'));
    await waitFor(() => expect(saved).toMatchObject({
      expected_row_version: 1,
      content: { conditions: [{ field: 'market', values: ['SG'] }, { field: 'is_ilp', values: [true] }], priority: 5, target_script_version_id: 't1' },
    }));
    expect(explained.length).toBeGreaterThan(0);
  });

  it('lets a different checker approve and requires an explicit supersede to publish; makers are told they cannot', async () => {
    let published: unknown = null;
    const approved = draft({ status: 'APPROVED', manifest_sha256: 'e'.repeat(64), reviewer_ref: 'k0', live_rule_version_id: 'rv1', live_ref: 'SG-ILP-HIGH v1', planned_version: 2 });
    stubApi(routes(CHECKER, {
      'GET /api/v1/assignment-rules/SG-ILP-HIGH/history': () => json(200, history([{ id: 'd1', planned_version: 2, status: 'APPROVED', name: 'ILP high risk', author_ref: 'u1', updated_at: null, created_at: '2026-11-17T10:00:00Z' }])),
      'GET /api/v1/assignment-rule-drafts/d1': () => json(200, approved),
      'POST /api/v1/assignment-rule-drafts/d1/publish': async (r) => { published = await r.json(); return json(200, { draft_id: 'd1', status: 'PUBLISHED' }); },
    }));
    const { unmount } = renderAt(<App />, '/assignment-rules/SG-ILP-HIGH?draft=d1');
    await userEvent.click(await screen.findByTestId('rule-tab-review'));
    expect(screen.getByTestId('rule-publish')).toBeDisabled();
    await userEvent.click(screen.getByTestId('rule-supersede'));
    await userEvent.click(screen.getByTestId('rule-publish'));
    await waitFor(() => expect(published).toEqual({ supersede_rule_version_id: 'rv1', reason: null }));
    unmount();
    stubApi(routes({ ...CHECKER, principal: { ...CHECKER.principal, principal_id: 'u1' } }, {
      'GET /api/v1/assignment-rules/SG-ILP-HIGH/history': () => json(200, history([{ id: 'd1', planned_version: 1, status: 'SUBMITTED_FOR_REVIEW', name: 'x', author_ref: 'u1', updated_at: null, created_at: '2026-11-17T10:00:00Z' }])),
      'GET /api/v1/assignment-rule-drafts/d1': () => json(200, draft({ status: 'SUBMITTED_FOR_REVIEW', manifest_sha256: 'e'.repeat(64) })),
    }));
    renderAt(<App />, '/assignment-rules/SG-ILP-HIGH?draft=d1');
    await userEvent.click(await screen.findByTestId('rule-tab-review'));
    expect(screen.getByTestId('rule-maker-note')).toHaveTextContent('another S&C checker must review and publish it');
    expect(screen.queryByTestId('rule-approve')).toBeNull();
  });

  it('shows simulation outcomes, the cases each rule wins and a per-condition trace', async () => {
    const sim = {
      as_of: '2026-11-17T10:00:00Z', scope: 'ALL', drafts: ['d1'], side_effects: 'NONE', note: 'Simulation only: evaluated in a read-only transaction.',
      rules: [{ ref: 'SG-ILP-HIGH v1 (proposed)', rule_code: 'SG-ILP-HIGH', origin: 'PROPOSED', status: 'DRAFT', priority: 5, specificity: 2, is_fallback: false, target_label: 'SALES_VERIFICATION_SG v1.1', target_effective: true,
        effective_from: null, effective_to: null, effective_now: true, explanation: 'Assign…', conditions: [], cases_won: 1 }],
      conflicts: [{ kind: 'AMBIGUOUS', severity: 'ERROR', rules: ['A', 'B'], message: 'A and B tie', against: null }],
      summary: { cases: 2, baseline: { SELECTED: 2 }, proposed: { SELECTED: 1, AMBIGUOUS: 1 }, changed: 2, differs_from_existing: 0 },
      cases: [{ case_id: 'c1', case_ref: 'CB-2026-10001', state: 'VALIDATED', has_blocking_hold: true, inputs: { product_family: 'ILP', is_ilp: true, risk_band: 'HIGH', selling_channel: 'AGENCY' },
        existing: { script_version_id: 't1', script_label: 'SALES_VERIFICATION_SG v1.1', rule: 'SG-SALES-VERIFY v2', origin: 'SEED', assigned_at: '2026-08-01T00:00:00Z' },
        baseline: { outcome: 'SELECTED', selected_script_label: 'SALES_VERIFICATION_SG v1.1', selected_script_version_id: 't1', winning_rules: ['SG-SALES-VERIFY v2'], reason: 'r', determinable_script_label: null, trace: [] },
        proposed: { outcome: 'AMBIGUOUS', selected_script_label: null, selected_script_version_id: null, winning_rules: ['A', 'B'], reason: '2 rules match with equal priority', determinable_script_label: null,
          trace: [{ ref: 'A', rule_code: 'A', origin: 'PROPOSED', priority: 5, specificity: 2, is_fallback: false, target_label: 'X', eligible: true, excluded_reason: null, match: 'MATCH', selected: false, tied: true,
            conditions: [{ field: 'is_ilp', expected: [true], actual: true, result: 'PASS' }] }] },
        changed: true, differs_from_existing: false }],
    };
    let body: unknown = null;
    stubApi(routes(USER, {
      'GET /api/v1/assignment-rules/SG-ILP-HIGH/history': () => json(200, history([{ id: 'd1', planned_version: 1, status: 'DRAFT', name: 'ILP', author_ref: 'u1', updated_at: null, created_at: '2026-11-17T10:00:00Z' }])),
      'GET /api/v1/assignment-rule-drafts/d1': () => json(200, draft()),
      'POST /api/v1/assignment-rules/simulate': async (r) => { body = await r.json(); return json(200, sim); },
    }));
    renderAt(<App />, '/assignment-rules/SG-ILP-HIGH?draft=d1');
    await userEvent.click(await screen.findByTestId('rule-tab-simulate'));
    await userEvent.click(screen.getByTestId('sim-run'));
    expect(await screen.findByTestId('sim-note')).toHaveTextContent('No side effects');
    expect(body).toEqual({ draft_ids: ['d1'], scope: 'ALL', as_of: null });
    expect(screen.getByTestId('sim-ambiguous')).toHaveTextContent('1');
    expect(screen.getByTestId('conflict-AMBIGUOUS')).toHaveTextContent('A and B tie');
    const row = screen.getByTestId('sim-case-CB-2026-10001');
    expect(row).toHaveTextContent('Ambiguous');
    await userEvent.click(screen.getByTestId('sim-why-CB-2026-10001'));
    expect(screen.getByTestId('sim-trace')).toHaveTextContent('ILP indicator: ILP (passed)');
  });
});
