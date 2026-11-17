// FE-01 (F3) — Call Detail: server values only, NOT_AVAILABLE media, attempt selection in the URL, and loading,
// not-found (out of scope), error, partial and forbidden states.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const USER_ME = { ...ME, roles: ['USER'], permissions: ['dashboard.read', 'case.read', 'queue.read', 'search.use', 'script.read'] };
const T = '2026-10-22T02:00:00Z';
const pin = { script_version_id: 'v11', family: 'SALES_VERIFICATION_SG', version_label: '1.1', status: 'PUBLISHED', manifest_sha256: 'a'.repeat(64), content_approval_status: 'SYNTHETIC_UNAPPROVED' };
const risk = { id: 'r1', kind: 'CALLBACK_SELECTION', origin: 'RULE_ASSESSED', status: 'FINAL', band_code: 'HIGH', score: null, reason_codes: ['R-ILP'],
  explanation: 'Seeded synthetic trace', source_original_value: null, rule_set: 'SYN-SBQ-RULES v2', assessed_at: T, valid_at: T, input_snapshot_sha256: null, effective: true,
  factors: [{ factor_code: 'ILP_INDICATOR', value_type: 'BOOLEAN', value: true, source: 'SYN', matched_rule_id: 'R-ILP', result: 'MATCHED' }] };
const snapshot = { id: 'pfs', captured_at: T, schema_version: '1', sha256: 'b'.repeat(64), facts: { premium_term_years: 10, suitability: { risk_tolerance: 'GROWTH' } }, field_provenance: {} };
const DETAIL = {
  case_id: 'c1', case_ref: 'CB-2026-10482', market: 'SG', obligation_type: 'SALE_VERIFICATION', source_request_ref: 'SYN-REQ', state: 'AWAITING_REVIEW',
  outcome: 'OPEN', controls_satisfied: false, open_findings: 1, priority: 1, owner: null, due_at: '2026-11-14T16:00:00Z', verified_at: null, closed_at: null,
  closure_reason: null, cancellation: null, sla: { due_at: '2026-11-14T16:00:00Z', matured: true, breached: true, exempt: false, exemption_rule: null, note: 'Timeliness only' },
  holds: [], callable: true, callable_blockers: [], risk_band: 'HIGH', effective_risk: risk, risk_assessments: [risk],
  policy: { id: 'p1', policy_ref: 'POL-SG-000001', product_code: 'SYN-ILP', product_family: 'ILP', product_subtype: 'ILP_REGULAR', is_ilp: true, status: 'IN_FORCE',
    premium_amount: 230, currency: 'SGD', premium_frequency: 'MONTHLY', premium_term_years: 10, sum_assured: null, sum_assured_currency: null, effective_from: T, effective_to: null, source_type: 'SEED', source_system: 'SYN' },
  sale: { id: 's1', sale_ref: 'SALE-SG-000001', sale_event_type: 'NEW_BUSINESS', sold_at: T, selling_channel: 'AGENCY', selling_location: 'SYN-BRANCH-07', campaign_code: null,
    proposal_ref: null, premium_amount: 230, currency: 'SGD', product_snapshot: {}, fsc: { fsc_ref: 'FSC-0013', display_name: 'Example Representative 13', channel: 'AGENCY', status: 'ACTIVE' },
    source_type: 'SEED', source_system: 'SYN', recorded_at: T },
  parties: [{ party_ref: 'PTY-000001', masked_name: 'Example P. 001', kind: 'PERSON', roles: ['OWNER'], authorization_ref: null }],
  contact_selection: [{ party_ref: 'PTY-000001', masked_name: 'Example P. 001', role: 'OWNER', channel: 'PHONE', masked_contact: 'SYN-TEL-SG-••••01', eligible: true,
    ineligibility_reason: null, rule_basis: 'OWNER', decided_at: T, decided_by: 'SYSTEM:seed' }],
  fact_snapshots: [snapshot], current_script: pin, attempts: 3, sessions: 1, source_type: 'SEED', is_synthetic: true, data_as_of: T,
};
const attempt = (n: number, status: string, session: unknown = null) => ({
  id: `a${n}`, attempt_ref: `AT-2026-10482-${n}`, case_id: 'c1', sequence: n, transport: 'SYNTHETIC', direction: 'OUTBOUND', status,
  contact_snapshot: { channel: 'PHONE', masked_value: 'SYN-TEL-SG-••••01' }, contacted_party: 'Example P. 001', scheduled_at: T, started_at: T, ended_at: T,
  failure_reason: null, record_origin: 'SYNTHETIC_SEED', attempt_kind: 'CONTACT_ATTEMPT', media_status: session ? 'NOT_REQUIRED' : null, session,
});
const ATTEMPTS = { items: [attempt(1, 'NO_ANSWER'), attempt(2, 'BUSY'),
  attempt(3, 'CONNECTED', { session_id: 'ss1', session_ref: 'SS-2026-10482', state: 'COMPLETED', survey_run_id: 'run1', survey_run_status: 'COMPLETED' })] };
const q = (code: string, over: Record<string, unknown>) => ({
  question_execution_id: code, position: 1, question_code: code, intent: null, wording: `[Synthetic example] ${code}?`, revision: 1, delivery_mode: 'EXACT',
  answer_type: 'BOOLEAN', mandatory: true, expected_answer_policy: 'EXACT_BOOLEAN', expected_value: null, policy_fact_key: null, delivery_status: 'DELIVERED',
  retries: 0, skip_reason: null, event_range: null, answer_state: 'YES', typed_value: { value: true }, verbatim_text_redacted: '[synthetic] yes',
  extraction_engine: 'SYNTHETIC_SEED', rule_ref: 'R', rule_expected: { value: true }, rule_observed: { value: true }, rule_result: 'MATCH', control_satisfied: true,
  findings: [], record_origin: 'SYNTHETIC_SEED', ...over,
});
const RUN = { id: 'run1', session_id: 'ss1', session_ref: 'SS-2026-10482', case_id: 'c1', case_ref: 'CB-2026-10482', status: 'COMPLETED', started_at: T, completed_at: T,
  script: pin, script_manifest_sha256: pin.manifest_sha256, policy_fact_snapshot_id: 'pfs', controls_satisfied: false, record_origin: 'SYNTHETIC_SEED',
  questions: [q('Q-REP-DISCLOSED', {}), q('Q-PREMIUM-TERM-YEARS', { position: 4, expected_answer_policy: 'NUMERIC_MATCH_POLICY_FACT', policy_fact_key: 'premium_term_years',
    typed_value: { value: 5 }, rule_expected: { value: 10 }, rule_observed: { value: 5 }, rule_result: 'MISMATCH', control_satisfied: false, findings: ['FND-2026-00001'] })] };
const NA = (what: string) => () => json(200, { session_id: 'ss1', availability: 'NOT_AVAILABLE', reason: 'NO_CAPTURE_BEFORE_S1',
  ...(what === 'media' ? { media_status: 'NOT_REQUIRED', can_retrieve_audio: false,
    recording: { status: 'NOT_RECORDED', consent: 'NOT_ASKED', consent_at: null, notice_version: null, tracks: [] } } : {}),
  message: what === 'media' ? 'Recording not available — no audio is captured before Stage S1' : 'Transcript not available — transcripts are captured from Stage S1' });
const PREVIEW = (status: string, over: Record<string, unknown> = {}) => ({
  case_id: 'c1', case_ref: 'CB-2026-10482', state: 'VALIDATED', status, blocked_reason: null, can_apply: status !== 'ASSIGNED', note: 'Synthetic test-only scripts.',
  current: status === 'ASSIGNED' ? { script_assignment_id: 'sa', script_version_id: pin.script_version_id, script_family_id: 'f1', script_label: 'SALES_VERIFICATION_SG v1.1',
    manifest_sha256: pin.manifest_sha256, matched_rule: 'SG-SALES-VERIFY v2', origin: 'SEED', assigned_at: T, assigned_by: 'SYSTEM:seed', explanation: null, input_sha256: 'c'.repeat(64) } : null,
  preview: { outcome: 'SELECTED', reason: 'SG-SALES-VERIFY v2 is the highest-precedence matching rule', would_assign: status === 'READY_TO_ASSIGN', script_version_id: 'v11', script_family_id: 'f1',
    script_label: 'SALES_VERIFICATION_SG v1.1', determinable_script_label: null, winning_rules: ['SG-SALES-VERIFY v2'], explanation: 'Assign SALES_VERIFICATION_SG v1.1 when the market is Singapore.',
    contact_resolution: { status: 'SINGLE', selected: { selection_id: 's1', role: 'OWNER', label: 'Example P. 001' }, considered: [], explanation: '' }, trace: [], inputs: {},
    would_release: ['AWAITING_SCRIPT_ASSIGNMENT'], would_place: [], remaining_blocking: [], decision_sha256: 'e'.repeat(64), evaluated_at: T },
  holds: status === 'ASSIGNED' ? [] : [{ hold_reason: 'AWAITING_SCRIPT_ASSIGNMENT', is_blocking: true, placed_at: T, source: 'INTAKE', placed_reason: 'Intake-created case' }],
  attempts: [], ...over,
});
const ok = {
  'GET /api/v1/me': () => json(200, USER_ME),
  'GET /api/v1/cases/c1': () => json(200, DETAIL),
  'GET /api/v1/cases/c1/attempts': () => json(200, ATTEMPTS),
  'GET /api/v1/cases/c1/script-assignment': () => json(200, { items: [{ id: 'sa', script: pin, script_manifest_sha256: pin.manifest_sha256, matched_rule: 'SG-SALES-VERIFY v2',
    rule_trace: { resolved_sections: ['COMMON_SALES_CONDUCT', 'ILP', 'ELEVATED_RISK'], precedence: 'priority, then specificity' }, input_snapshot: { risk_band: 'HIGH' },
    input_sha256: 'c', risk_assessment_id: 'r1', policy_fact_snapshot_id: 'pfs', origin: 'SEED', assigned_at: T, assigned_by: 'SYSTEM:seed', superseded: false }] }),
  'GET /api/v1/cases/c1/script-assignment/preview': () => json(200, PREVIEW('ASSIGNED')),
  'GET /api/v1/cases/c1/findings': () => json(200, { material_severities: ['CRITICAL', 'HIGH'], items: [{ id: 'f1', finding_ref: 'FND-2026-00001', category: 'FACT_MISMATCH',
    severity: 'HIGH', status: 'OPEN', origin: 'RULE_EVALUATION', record_origin: 'SYNTHETIC_SEED', evidence_refs: {}, question_execution_id: 'Q-PREMIUM-TERM-YEARS',
    question_code: 'Q-PREMIUM-TERM-YEARS', survey_run_id: 'run1', raised_at: T, review_assigned_at: null, review_closed_at: null }] }),
  'GET /api/v1/cases/c1/timeline': () => json(200, { items: [{ id: 'e1', event_type: 'ATTEMPT_RECORDED', occurred_at: T, actor_ref: 'SYSTEM:seed',
    related_entity_type: 'contact_attempt', related_entity_id: 'a1', summary: 'Attempt 1: NO_ANSWER (seeded synthetic)', route: '/cases/c1?attempt=a1' }] }),
  'GET /api/v1/sessions/ss1': () => json(200, { id: 'ss1', session_ref: 'SS-2026-10482', case_id: 'c1', case_ref: 'CB-2026-10482', attempt_id: 'a3', attempt_ref: 'AT-2026-10482-3',
    state: 'COMPLETED', transport: 'SYNTHETIC', started_at: T, ended_at: T, script: pin, script_manifest_sha256: pin.manifest_sha256, script_pin_matches: true,
    risk_assessment: risk, risk_snapshot_sha256: 'd'.repeat(64), fact_snapshot: snapshot, fact_snapshot_pin_matches: true, contacted_party: 'Example P. 001',
    contact_method_snapshot: { masked_value: 'SYN-TEL-SG-••••01' }, media_status: 'NOT_REQUIRED', transcript_status: 'UNAVAILABLE', record_origin: 'SYNTHETIC_SEED', survey_run_ids: ['run1'] }),
  'GET /api/v1/survey-runs/run1': () => json(200, RUN),
  'GET /api/v1/sessions/ss1/media': NA('media'),
  'GET /api/v1/sessions/ss1/transcript': NA('transcript'),
};

describe('Call Detail', () => {
  it('renders the investigation trail from the server, with recordings and transcripts NOT_AVAILABLE', async () => {
    stubApi(ok);
    renderAt(<App />, '/cases/c1');
    expect(await screen.findByRole('heading', { name: 'Call Detail' })).toBeInTheDocument();
    expect(await screen.findByText('CB-2026-10482')).toBeInTheDocument();
    expect(screen.getByTestId('cd-outcome')).toHaveTextContent('Outcome: Open');
    expect(screen.getByTestId('cd-sla')).toHaveTextContent('SLA breached');
    expect(screen.getByText(/Seeded synthetic evidence/)).toBeInTheDocument();
    expect(await screen.findByTestId('cd-recording')).toHaveTextContent('Recording not available — no audio is captured before Stage S1');
    expect(screen.getByTestId('cd-transcript')).toHaveTextContent('Transcript not available');
    expect(screen.queryByRole('button', { name: /play/i })).toBeNull();
    const results = await screen.findByTestId('question-results');
    const term = results.querySelector('[data-question="Q-PREMIUM-TERM-YEARS"]') as HTMLElement;
    expect(term).toHaveTextContent('Seeded rule outcome: MISMATCH — needs review');
    expect(term).toHaveTextContent('Policy fact premium_term_years = 10');
    expect(term).toHaveTextContent('5 · answer state Yes');
    expect(term).toHaveTextContent('FND-2026-00001');
    expect(await screen.findByTestId('findings')).toHaveTextContent('HIGH');
    expect(screen.getByText(/manifest aaaaaaaaaaaa/)).toBeInTheDocument();
    for (const name of ['Start browser call', 'Evidence bundle', 'Assign reviewer']) expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('selecting an unanswered attempt shows that it created no session', async () => {
    stubApi(ok);
    renderAt(<App />, '/cases/c1');
    await userEvent.click(await screen.findByTestId('attempt-1'));
    await waitFor(() => expect(screen.getByTestId('attempt-1')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('cd-recording')).toHaveTextContent('no conversation session for this attempt');
    expect(screen.getByText('No survey run for the selected attempt')).toBeInTheDocument();
  });

  it('context and timeline tabs show policy, parties, risk origins and events', async () => {
    stubApi(ok);
    renderAt(<App />, '/cases/c1?tab=context');
    expect(await screen.findByText('SBQ callback-selection risk')).toBeInTheDocument();
    expect(screen.getByTestId('risk-RULE_ASSESSED')).toHaveTextContent('Effective');
    expect(screen.getByText(/Investment suitability fact \(not SBQ selection risk\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/SYN-TEL-SG-••••01/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(await screen.findByTestId('timeline')).toHaveTextContent('Attempt 1: NO_ANSWER');
  });

  it('shows not-found for an out-of-scope case, errors with a reference, partial regions and forbidden', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME), 'GET /api/v1/cases/my': () => json(404, { code: 'NOT_FOUND', message: 'Not found or not available to you', correlation_id: 'x', retryable: false }) });
    const a = renderAt(<App />, '/cases/my');
    expect(await screen.findByText('Case not found or not available to you')).toBeInTheDocument();
    a.unmount();

    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME), 'GET /api/v1/cases/c1': () => json(500, { code: 'X', message: 'x', correlation_id: 'corr-7', retryable: true }) });
    const b = renderAt(<App />, '/cases/c1');
    expect(await screen.findByText('Call Detail could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Reference: corr-7')).toBeInTheDocument();
    b.unmount();

    stubApi({ ...ok, 'GET /api/v1/cases/c1/findings': () => json(503, { code: 'X', message: 'x', correlation_id: 'corr-8', retryable: true }) });
    const c = renderAt(<App />, '/cases/c1');
    expect(await screen.findByText('Findings could not be loaded.')).toBeInTheDocument();
    expect(await screen.findByTestId('question-results')).toBeInTheDocument(); // the rest still renders
    c.unmount();

    stubApi({ 'GET /api/v1/me': () => json(200, { ...USER_ME, permissions: ['dashboard.read'] }) });
    renderAt(<App />, '/cases/c1');
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
  });

  it('presents the contact pre-check as passed or blocked, with one entry per cause (F3 refinement)', async () => {
    stubApi(ok);
    const a = renderAt(<App />, '/cases/c1');
    const passed = await screen.findByTestId('cd-precheck');
    expect(passed).toHaveTextContent('Pre-check passed');
    expect(passed).toHaveTextContent('Not an authorisation to call');
    expect(passed).not.toHaveTextContent(/\bCallable\b/);
    expect(screen.getByTestId('cd-owner')).toHaveTextContent('Unassigned');
    expect(screen.getByRole('link', { name: 'POL-SG-000001 Policy Detail' })).toHaveAttribute('href', '/policies/p1?sale=s1');
    a.unmount();

    // CB-2026-10491: an active NO_ELIGIBLE_CONTACT hold and an empty eligible selection are one cause, shown once
    stubApi({ ...ok, 'GET /api/v1/cases/c1': () => json(200, { ...DETAIL, callable: false, callable_blockers: ['HOLD:NO_ELIGIBLE_CONTACT', 'NO_ELIGIBLE_CONTACT'] }) });
    renderAt(<App />, '/cases/c1');
    const blocked = await screen.findByTestId('cd-precheck');
    expect(blocked).toHaveTextContent('Blocked');
    const reasons = blocked.querySelectorAll('li');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toHaveTextContent('No eligible contact — active blocking hold and no eligible contact in the case contact selection');
  });

  it('labels an intake-created case as manual intake, not seeded evidence (CP0.4a)', async () => {
    const intake = { ...DETAIL, source_type: 'MANUAL', current_script: null, attempts: 0, sessions: 0, callable: false,
      callable_blockers: ['HOLD:AWAITING_SCRIPT_ASSIGNMENT'] };
    stubApi({ ...ok, 'GET /api/v1/cases/c1': () => json(200, intake), 'GET /api/v1/cases/c1/attempts': () => json(200, { items: [] }),
      'GET /api/v1/cases/c1/script-assignment': () => json(200, { items: [] }) });
    renderAt(<App />, '/cases/c1');
    expect(await screen.findByText(/Synthetic intake case/)).toBeInTheDocument();
    expect(screen.queryByText(/Seeded synthetic evidence/)).toBeNull();
  });

  it('previews the deterministic assignment and applies it with the decision checksum and an Idempotency-Key (S2-C)', async () => {
    const OPS = { ...USER_ME, permissions: [...USER_ME.permissions, 'script.assign'] };
    let sent: { body: unknown; key: string | null } | null = null;
    stubApi({ ...ok, 'GET /api/v1/me': () => json(200, OPS),
      'GET /api/v1/cases/c1/script-assignment': () => json(200, { items: [] }),
      'GET /api/v1/cases/c1/script-assignment/preview': () => json(200, PREVIEW('READY_TO_ASSIGN')),
      'POST /api/v1/cases/c1/script-assignment/apply': async (r) => { sent = { body: await r.json(), key: r.headers.get('Idempotency-Key') };
        return json(200, { case_id: 'c1', status: 'ASSIGNED', current: null, attempt: { id: 'at1', outcome: 'SELECTED', applied: true, reason: 'pinned', script_label: 'SALES_VERIFICATION_SG v1.1',
          winning_rules: ['SG-SALES-VERIFY v2'], holds_released: ['AWAITING_SCRIPT_ASSIGNMENT'], holds_placed: [], trigger: 'CASE', actor: 'Ops', evaluated_at: T, decision_sha256: 'e'.repeat(64) } }); } });
    renderAt(<App />, '/cases/c1');
    const panel = await screen.findByTestId('script-assignment');
    expect(panel).toHaveTextContent('Ready to assign');
    expect(screen.getByTestId('preview-script')).toHaveTextContent('SALES_VERIFICATION_SG v1.1');
    expect(screen.getByTestId('preview-contact')).toHaveTextContent('Owner');
    expect(screen.getByTestId('assignment-holds')).toHaveTextContent('Awaiting script assignment');
    await userEvent.click(screen.getByTestId('apply-open'));
    await userEvent.click(screen.getByTestId('apply-assignment'));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.body).toEqual({ expected_decision_sha256: 'e'.repeat(64) });
    expect(sent!.key).toMatch(/^assign-/);
  });

  it('shows why an ambiguous case stays blocked and offers no pin (S2-C)', async () => {
    stubApi({ ...ok, 'GET /api/v1/cases/c1/script-assignment': () => json(200, { items: [] }),
      'GET /api/v1/cases/c1/script-assignment/preview': () => json(200, PREVIEW('BLOCKED', { can_apply: false, preview: { ...PREVIEW('BLOCKED').preview, outcome: 'AMBIGUOUS', script_label: null,
        would_assign: false, winning_rules: ['A v1', 'B v1'], reason: '2 rules match with equal priority 2 and specificity 2', would_release: [], would_place: ['AWAITING_SCRIPT_REVIEW'],
        remaining_blocking: ['AWAITING_SCRIPT_ASSIGNMENT'] } })) });
    renderAt(<App />, '/cases/c1');
    expect(await screen.findByTestId('preview-blocked')).toHaveTextContent('Ambiguous: 2 rules match with equal priority');
    expect(screen.getByTestId('preview-remaining')).toHaveTextContent('Awaiting script assignment');
    expect(screen.queryByTestId('apply-open')).toBeNull(); // USER_ME lacks script.assign
  });

  it('shows a loading state first', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME), 'GET /api/v1/cases/c1': () => new Promise<Response>(() => {}) as never });
    renderAt(<App />, '/cases/c1');
    expect(await screen.findByText('Loading Call Detail…')).toBeInTheDocument();
  });
});
