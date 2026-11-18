// S3-C case review: dossier (answers vs expected facts, findings with class, justification and controls, readiness),
// a disposition posts the reason with an idempotency key and the row version, a blocked verification shows every
// reason, and approval controls appear only for a checker who did not make the proposal.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const T = '2026-11-18T10:00:00Z';
const REVIEWER = { ...ME, principal: { ...ME.principal, principal_id: 'u-reviewer' }, roles: ['USER'], permissions: ['dashboard.read', 'case.read', 'queue.read', 'review.decide'] };
const CHECKER = { ...ME, principal: { ...ME.principal, principal_id: 'u-checker' }, roles: ['SC_CHECKER'], permissions: ['dashboard.read', 'case.read', 'queue.read', 'review.decide', 'review.approve'] };
const OPTIONS = { finding_actions: { START_REVIEW: 'Start review', CONFIRM: 'Confirm discrepancy', DISMISS: 'Dismiss with justification', REQUEST_INFORMATION: 'Request additional information', RESOLVE: 'Resolve' },
  case_actions: { REQUEST_CALLBACK: 'Request a further callback', ESCALATE: 'Escalate for investigation', RETURN_TO_REVIEW: 'Return to review' },
  decisions: { VERIFY: 'Verify the case', CLOSE_UNVERIFIED: 'Close unverified' }, escalation_reasons: { MIS_SELLING_CONCERN: 'Mis-selling concern' },
  closure_reasons: [{ code: 'UNABLE_TO_VERIFY', label: 'Unable to verify' }], assessments: ['SATISFACTORY', 'CONCERN'], categories: ['FACT_MISMATCH'], severities: ['LOW', 'HIGH'], material_severities: ['HIGH', 'CRITICAL'], note: 'n' };
const check = (code: string, ok: boolean, detail: string) => ({ code, label: code.replace(/_/g, ' ').toLowerCase(), ok, detail });
const DOSSIER = (approvals: unknown[] = []) => ({
  case: { id: 'c1', case_ref: 'CB-2026-90001', state: 'AWAITING_REVIEW', row_version: 4, has_blocking_hold: false, is_synthetic: true, closure_reason: null, verified_at: null },
  policy: { policy_ref: 'POL-SG-1', product_code: 'PRT', sale_ref: 'SALE-1', selling_channel: 'BANCASSURANCE', band: 'LOW' }, facts: {},
  assignment: { script_label: 'SG_LIFECYCLE_DEMO v1.0', version_status: 'PUBLISHED' }, holds: [],
  attempts: [{ attempt_ref: 'AT-1', fixture: true, transport: 'SYNTHETIC' }],
  conversation: { session_ref: 'SS-1', status: 'COMPLETED', transport: 'SYNTHETIC', record_origin: 'SYNTHETIC_SEED', media_status: 'NOT_REQUIRED', transcript_status: 'UNAVAILABLE', script_manifest_sha256: 'a'.repeat(64), policy_fact_snapshot_id: 'snap', policy_fact_snapshot_sha256: 'b'.repeat(64) },
  questions: [{ code: 'Q-TERM', wording: 'Term?', revision: 1, question_revision_id: 'r', mandatory: true, role: 'VERIFICATION', stage: 'VERIFICATION', applicable: true, skip_reason: null, method: 'NUMERIC_MATCH_POLICY_FACT', rule_text: 'x', executed: true, question_execution_id: 'qe1', delivery_status: 'DELIVERED', answer_state: 'YES', typed_value: { value: 15 }, verbatim: null, extraction_engine: 'S3C_FIXTURE', expected: { value: '20', source: 'POLICY_FACT:premium_term_years' }, observed: null, evaluation_result: 'MISMATCH', rule_ref: 'S3A answer-evaluation/1', controls: [], assessment: null },
    { code: 'Q-FREQ', wording: 'Freq?', revision: 1, question_revision_id: 'r2', mandatory: true, role: 'VERIFICATION', stage: 'VERIFICATION', applicable: true, skip_reason: null, method: 'ENUM_MATCH_POLICY_FACT', rule_text: 'x', executed: true, question_execution_id: 'qe2', delivery_status: 'DELIVERED', answer_state: 'YES', typed_value: { value: 'MONTHLY' }, verbatim: null, extraction_engine: 'S3C_FIXTURE', expected: { value: 'ANNUAL', source: 'POLICY_FACT:premium_frequency' }, observed: null, evaluation_result: 'MISMATCH', rule_ref: 'x', controls: [], assessment: null }],
  findings: [{ id: 'f1', finding_ref: 'FND-ENG-00001', question_code: 'Q-TERM', category: 'FACT_MISMATCH', severity: 'HIGH', material: true, status: 'OPEN', origin: 'RULE_EVALUATION', record_origin: 'SYNTHETIC_SEED', raised_at: T, row_version: 2,
    finding_class: 'CUSTOMER_DISCREPANCY', severity_justification: 'Synthetic: a wrong term is material', severity_source: 'Finding rule FR-TERM (SG finding rules v1)', rule: { rule_code: 'FR-TERM', text: 'FR-TERM: …' },
    controls: [{ control_code: 'SYN-CTRL-04', control_name: 'Premium term', mapping_status: 'PROPOSED' }], explanation: 'Answered 15; expected 20', evidence_refs: { finding_key: 'k' }, pending_approval_id: null, allowed_actions: ['START_REVIEW', 'CONFIRM', 'DISMISS', 'REQUEST_INFORMATION'] }],
  media: [{ session_ref: 'SS-1', available: false, detail: 'No recording exists (media status NOT_REQUIRED); transcript UNAVAILABLE' }],
  readiness: { ready: false, run: null, checks: [check('IDENTITY_GATE', true, 'Q-ID: YES'), check('DISCREPANCIES_DISPOSITIONED', false, 'Q-FREQ (mismatch, no finding)'), check('FINDINGS_DISPOSITIONED', false, 'Outstanding: FND-ENG-00001 (open)')] },
  pending_approvals: approvals, history: [], events: [], allowed: { case_actions: ['REQUEST_CALLBACK', 'ESCALATE'], decisions: ['VERIFY', 'CLOSE_UNVERIFIED'], approve: false }, note: 'Synthetic',
});

describe('Case review', () => {
  it('shows the dossier, records a disposition with a reason and shows why verification is blocked', async () => {
    const posted: { path: string; body: Record<string, unknown> }[] = [];
    stubApi({
      'GET /api/v1/me': () => json(200, REVIEWER), 'GET /api/v1/review/options': () => json(200, OPTIONS), 'GET /api/v1/review/cases/c1': () => json(200, DOSSIER()),
      'POST /api/v1/review/findings/f1/actions': async (r) => { posted.push({ path: 'finding', body: await r.json() }); return json(200, { decision_ref: 'RVD-00001', action: 'CONFIRM', from_status: 'OPEN', to_status: 'CONFIRMED', case_state_before: 'AWAITING_REVIEW', case_state_after: 'AWAITING_REVIEW', approval_id: null, replayed: false }); },
      'POST /api/v1/review/cases/c1/decisions': () => json(409, { code: 'NOT_READY_TO_VERIFY', message: 'The case cannot be verified yet', retryable: false, details: [{ message: 'No outstanding findings: Outstanding: FND-ENG-00001 (open)' }, { message: 'Every discrepancy raised as a finding and dispositioned: Q-FREQ (mismatch, no finding)' }] }),
    });
    renderAt(<App />, '/reviews/cases/c1');
    expect(await screen.findByTestId('rc-banner')).toBeVisible();
    expect(screen.getByTestId('rc-fixture')).toHaveTextContent('explicitly synthetic');
    expect(screen.getByTestId('rc-q-Q-TERM')).toHaveTextContent('20 (policy fact premium_term_years)');
    expect(screen.getByTestId('rc-q-Q-FREQ')).toHaveTextContent('Unconverted discrepancy');
    const f = screen.getByTestId('rc-finding-FND-ENG-00001');
    expect(f).toHaveTextContent('Customer discrepancy');
    expect(f).toHaveTextContent('Synthetic: a wrong term is material');
    expect(screen.getByTestId('rc-sev-source-FND-ENG-00001')).toHaveTextContent('Rule-assigned severity');
    expect(screen.getByTestId('rc-finding-controls-FND-ENG-00001')).toHaveTextContent('SYN-CTRL-04 Premium term (proposed)');
    expect(screen.getByTestId('rc-media-SS-1')).toHaveTextContent('No recording exists');
    expect(screen.getByTestId('rc-check-FINDINGS_DISPOSITIONED')).toHaveTextContent('Blocked');
    // A disposition needs a reason and posts the row version and an idempotency key.
    await userEvent.click(screen.getByTestId('rc-f-FND-ENG-00001-CONFIRM'));
    expect(screen.getByTestId('rc-f-form-submit')).toBeEnabled();
    await userEvent.type(screen.getByTestId('rc-f-form-reason'), 'Customer stated a different term');
    await userEvent.click(screen.getByTestId('rc-f-form-submit'));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toMatchObject({ action: 'CONFIRM', reason: 'Customer stated a different term', expected_row_version: 2 });
    expect(String(posted[0]!.body.idempotency_key).length).toBeGreaterThan(8);
    // Premature verification: the server's blocking reasons are shown.
    await userEvent.click(screen.getByTestId('rc-decide-VERIFY'));
    await userEvent.type(screen.getByTestId('rc-decision-form-reason'), 'All answers recorded');
    await userEvent.click(screen.getByTestId('rc-decision-form-submit'));
    const err = await screen.findByTestId('rc-decision-error');
    expect(err).toHaveTextContent('The case cannot be verified yet');
    expect(err).toHaveTextContent('Q-FREQ (mismatch, no finding)');
  });

  it('lets only a different checker decide a pending approval', async () => {
    const approval = { id: 'a1', approval_ref: 'RVA-0001', callback_case_id: 'c1', case_ref: 'CB-2026-90001', case_state: 'AWAITING_REVIEW', finding_id: null, finding_ref: null, severity: null, kind: 'CASE_DECISION',
      proposed_action: 'CLOSE_UNVERIFIED', proposed_to_status: 'CLOSED_UNVERIFIED', closure_reason: 'UNABLE_TO_VERIFY', reason: 'Refused mandatory answer', proposed_by: 'u-reviewer', proposed_by_name: 'Reviewer', proposed_at: T, status: 'PENDING', decided_at: null, decision_reason: null, readiness: {} };
    stubApi({ 'GET /api/v1/me': () => json(200, REVIEWER), 'GET /api/v1/review/options': () => json(200, OPTIONS), 'GET /api/v1/review/cases/c1': () => json(200, DOSSIER([approval])) });
    const { unmount } = renderAt(<App />, '/reviews/cases/c1');
    expect(await screen.findByTestId('rc-approval-wait')).toHaveTextContent('a different checker must decide it');
    unmount();
    let decided: unknown = null;
    stubApi({ 'GET /api/v1/me': () => json(200, CHECKER), 'GET /api/v1/review/options': () => json(200, OPTIONS), 'GET /api/v1/review/cases/c1': () => json(200, DOSSIER([approval])),
      'POST /api/v1/review/approvals/a1/decide': async (r) => { decided = await r.json(); return json(200, { decision_ref: 'RVD-00002', action: 'APPROVE_CLOSE_UNVERIFIED', from_status: null, to_status: null, case_state_before: 'AWAITING_REVIEW', case_state_after: 'CLOSED_UNVERIFIED', approval_id: 'a1', replayed: false }); } });
    renderAt(<App />, '/reviews/cases/c1');
    await userEvent.click(await screen.findByTestId('rc-approval-open-RVA-0001'));
    const form = screen.getByTestId('rc-approve-form');
    await userEvent.type(within(form).getByTestId('rc-approve-form-reason'), 'Closure reason checked');
    await userEvent.click(within(form).getByTestId('rc-approve-form-submit'));
    await waitFor(() => expect(decided).toMatchObject({ decision: 'APPROVE', reason: 'Closure reason checked' }));
  });
});
