// S2-E Simulation Workbench: scenario editor builds structured steps and expectations from the version's plan, dry run
// fills expectations from actual behaviour, saving posts structured content; test runs show explained differences,
// coverage (labelled structural) and version comparison.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';
import { RunEvaluation } from './AnswerEvaluation';

afterEach(() => vi.unstubAllGlobals());

const OPS = { ...ME, roles: ['USER'], permissions: ['dashboard.read', 'case.read', 'script.read', 'script.simulate'] };
const T = '2026-11-18T10:00:00Z';
const OPTIONS = {
  step_kinds: ['ANSWER', 'UNCLEAR', 'REFUSED', 'UNKNOWN', 'CLARIFICATION', 'NOT_DELIVERED', 'DELIVERED', 'EVENT'],
  events: { WRONG_PERSON: 'Wrong person', CALLBACK_REQUESTED: 'Callback', DECLINED_TO_CONTINUE: 'Declined', INTERRUPTED: 'Interrupted' },
  outcomes: ['COMPLETED', 'INCOMPLETE', 'TERMINATED'], termination_reasons: ['IDENTITY_FAILED', 'DECLINED_TO_PROCEED'],
  gates: ['identity', 'willingness', 'recording_consent', 'cloud_processing'], gate_statuses: ['CONFIRMED', 'FAILED', 'NOT_ASKED'],
  question_states: ['COMPLETED', 'UNRESOLVED', 'SKIPPED_BY_CONDITION', 'PENDING'], default_responses: ['AFFIRMATIVE', 'STRICT'],
  condition_facts: { product_family: ['PROTECTION', 'ILP'], is_ilp: [true, false] }, risk_bands: ['LOW', 'MEDIUM', 'HIGH'], note: 'Simulation only',
};
const VERSIONS = { items: [{ id: 'vd', version_label: '1.1', status: 'DRAFT', content_approval_status: 'SYNTHETIC_UNAPPROVED', family_id: 'f1', family: 'LC_DEMO', family_name: 'Lifecycle' },
  { id: 'vp', version_label: '1.0', status: 'PUBLISHED', content_approval_status: 'SYNTHETIC_UNAPPROVED', family_id: 'f1', family: 'LC_DEMO', family_name: 'Lifecycle' }] };
const q = (code: string, pos: number, stage: string, role: string, answer_type = 'YES_NO') => ({ code, revision: 1, section: 'S', section_name: 'S', position: pos, wording: code, answer_type,
  options: [], mandatory: true, delivery_mode: 'CONVERSATIONAL', max_reprompts: 1, applicable: true, skip_reason: null, role, stage, on_failure: 'TERMINATE', discloses_policy_information: false, deliver_on_termination: false });
const PLAN = { script_version_id: 'vd', script_label: 'LC_DEMO v1.1 (draft)', version_status: 'DRAFT', content_approval_status: 'SYNTHETIC_UNAPPROVED', content_sha256: 'a'.repeat(64),
  live_eligibility: { structurally_eligible: true, missing_mandatory_gates: [] }, sections: [{ module_code: 'S', name: 'S', kind: 'IDENTITY', position: 1, included: true, condition: 'always', stage: 'IDENTITY' }],
  questions: [q('Q-OPEN', 1, 'OPENING', 'OPENING_STATEMENT', 'ACKNOWLEDGEMENT'), q('Q-ID', 2, 'IDENTITY', 'IDENTITY_CHECK'), q('Q-CLOSE', 3, 'CLOSING', 'CLOSING_STATEMENT', 'ACKNOWLEDGEMENT')] };
const ACTUAL = { outcome: 'TERMINATED', termination_reason: 'IDENTITY_FAILED', termination_stage: 'IDENTITY', gates: { identity: 'FAILED', willingness: 'NOT_ASKED' }, mandatory_complete: false,
  mandatory_unresolved: ['Q-ID'], mandatory_open: [], sequence: ['Q-OPEN', 'Q-ID', 'Q-CLOSE'], applicable: ['Q-OPEN', 'Q-ID', 'Q-CLOSE'],
  evaluation_results: { 'Q-OPEN': 'NOT_EVALUATED', 'Q-ID': 'MISMATCH', 'Q-CLOSE': 'NOT_EVALUATED' } };
const item = (code: string, result: string, explanation: string, extra: Record<string, unknown> = {}) => ({ question_code: code, question_revision_id: `rev-${code}`, revision: 1,
  method: 'NUMERIC_MATCH_POLICY_FACT', rule: { method: 'NUMERIC_MATCH_POLICY_FACT' }, rule_text: 'Expected: equal to policy fact premium_term_years years',
  answer: { kind: 'ANSWER', state: 'VALUE', value: 5, verbatim: null }, normalized_answer: '5', expected: { value: '10', unit: 'YEARS', source: 'POLICY_FACT:premium_term_years', operator: 'EQ', tolerance: '0' },
  result, explanation, rule_evaluation_equivalent: result === 'MATCH' ? 'MATCH' : 'MISMATCH', stage: 'VERIFICATION', role: 'VERIFICATION', mandatory: true, wording: code, ...extra });
const base = (extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) => ({
  'GET /api/v1/me': () => json(200, OPS), 'GET /api/v1/simulation-workbench/options': () => json(200, OPTIONS),
  'GET /api/v1/simulation-workbench/versions': () => json(200, VERSIONS), 'POST /api/v1/simulation-workbench/plan': () => json(200, PLAN),
  'GET /api/v1/simulation-scenarios': () => json(200, { items: [] }), 'GET /api/v1/simulation-runs': () => json(200, { items: [] }), ...extra,
});

describe('Simulation Workbench', () => {
  it('builds a structured scenario, dry-runs it, uses the actual behaviour as expectations and saves it', async () => {
    const posted: Record<string, unknown> = {};
    stubApi(base({
      'POST /api/v1/simulation-scenarios/preview': async (r) => { posted.preview = await r.json(); return json(200, { status: 'PASSED', version_label: 'LC_DEMO v1.1 (draft)', problems: [], failures: [], error: null, stale_reasons: [], actual: ACTUAL, response_log: [] }); },
      'POST /api/v1/simulation-scenarios': async (r) => { posted.save = await r.json(); return json(201, { id: 's1', scenario_ref: 'SCN-0001', name: 'Identity fails', status: 'ACTIVE', row_version: 1, family_id: 'f1', family: 'LC_DEMO', copied_from_ref: null, revision: 1, version_label: 'LC_DEMO v1.1 (draft)', version_status: 'DRAFT', script_content_sha256: 'a'.repeat(64), source_case_ref: null, content: posted.save, revisions: [{ revision: 1, created_at: T, created_by: 'Ops', change_note: 'Created', version_label: 'LC_DEMO v1.1' }], runs: [] }); },
      'GET /api/v1/simulation-scenarios/s1': () => json(200, { id: 's1', scenario_ref: 'SCN-0001', name: 'Identity fails', status: 'ACTIVE', row_version: 1, family_id: 'f1', family: 'LC_DEMO', copied_from_ref: null, revision: 1, version_label: 'LC_DEMO v1.1 (draft)', version_status: 'DRAFT', script_content_sha256: 'a'.repeat(64), source_case_ref: null, content: posted.save, revisions: [], runs: [] }),
    }));
    renderAt(<App />, '/simulator?tab=scenarios&scenario=new');
    expect(await screen.findByTestId('sim-banner')).toHaveTextContent('No customer is contacted');
    expect(await screen.findByTestId('scn-plan')).toHaveTextContent('Lifecycle gates present');
    await userEvent.type(screen.getByTestId('scn-name'), 'Identity fails');
    await userEvent.click(screen.getByTestId('scn-add-step'));
    await userEvent.selectOptions(screen.getByTestId('scn-step-1-q'), 'Q-ID');
    await userEvent.selectOptions(screen.getByTestId('scn-step-1-value'), 'no');
    await userEvent.click(screen.getByTestId('scn-dry-run'));
    expect(await screen.findByTestId('scn-preview')).toHaveTextContent('Identity failed at Identity');
    expect(posted.preview).toMatchObject({ script_version_id: 'vd', steps: [{ question: 'Q-ID', kind: 'ANSWER', value: false }] });
    await userEvent.click(screen.getByTestId('scn-use-actual'));
    expect(screen.getByTestId('scn-exp-outcome')).toHaveValue('TERMINATED');
    expect(screen.getByTestId('scn-exp-basis')).toHaveValue('GENERATED_BASELINE'); // S2-E acceptance condition
    expect(screen.getByTestId('scn-basis-generated')).toHaveTextContent('not independently validated');
    expect(screen.getByTestId('scn-exp-evaluations')).toHaveTextContent('Q-ID: Mismatch');
    expect(screen.getByTestId('scn-exp-gate-identity')).toHaveValue('FAILED');
    await userEvent.click(screen.getByTestId('scn-save'));
    await waitFor(() => expect(posted.save).toMatchObject({ name: 'Identity fails', default_response: 'AFFIRMATIVE',
      expectations: { outcome: 'TERMINATED', termination_reason: 'IDENTITY_FAILED', gates: { identity: 'FAILED' }, sequence: ['Q-OPEN', 'Q-ID', 'Q-CLOSE'],
        basis: 'GENERATED_BASELINE', evaluations: { 'Q-ID': 'MISMATCH' } } }));
  });

  it('shows explained differences, structural coverage and a version comparison', async () => {
    const result = (side: string, status: string, failures: unknown[] = []) => ({ id: `r${side}`, side, scenario_id: 's1', scenario_ref: 'SCN-0001', scenario_name: 'Identity fails', revision: 2,
      script_version_id: side === 'A' ? 'vp' : 'vd', version_label: side === 'A' ? 'LC_DEMO v1.0' : 'LC_DEMO v1.1', version_status: side === 'A' ? 'PUBLISHED' : 'DRAFT', content_sha256: 'b'.repeat(64),
      plan_sha256: 'c'.repeat(64), status, stale: side === 'B', stale_reasons: side === 'B' ? ['The script content changed after this scenario revision was saved'] : [], problems: [], failures, error: null,
      actual: ACTUAL, response_log: [{ action_id: 'Q-ID#1', response: 'Q-ID: answer no', by: 'step 1' }], events: [{ type: 'GATE_UPDATED', question_code: null, action_id: null, data: { gate: 'identity' } }] });
    stubApi(base({
      'GET /api/v1/simulation-runs': () => json(200, { items: [{ id: 'b1', batch_ref: 'BAT-0001', kind: 'COMPARISON', totals: { A: { PASSED: 1 }, B: { FAILED: 1 } }, started_at: T, started_by: 'Ops', version_a: 'LC_DEMO v1.0', version_b: 'LC_DEMO v1.1' }] }),
      'GET /api/v1/simulation-runs/b1': () => json(200, { id: 'b1', batch_ref: 'BAT-0001', kind: 'COMPARISON', totals: { A: { PASSED: 1, TOTAL: 1 }, B: { FAILED: 1, STALE: 1, TOTAL: 1 } }, started_at: T, started_by: 'Ops',
        version_a: 'LC_DEMO v1.0', version_b: 'LC_DEMO v1.1', note: 'Simulation only', results: [result('A', 'PASSED'), result('B', 'FAILED', [{ check: 'outcome', message: 'Outcome: expected completed, got terminated' }])],
        coverage: [{ side: 'A', version_label: 'LC_DEMO v1.0', content_sha256: 'b'.repeat(64), runs: 1, questions_total: 3, questions_exercised: ['Q-OPEN', 'Q-ID'], questions_not_exercised: ['Q-CLOSE'],
          conditional_modules: [], conditional_modules_exercised: [], conditional_modules_not_exercised: [], lifecycle_paths_possible: ['NORMAL_COMPLETION', 'IDENTITY_FAILED'], lifecycle_paths_exercised: ['IDENTITY_FAILED'],
          lifecycle_paths_not_exercised: ['NORMAL_COMPLETION'], mandatory_never_completed: ['Q-ID'], mandatory_unresolved: [{ question: 'Q-ID', reasons: ['ANSWERED_NO'] }], note: 'Structural coverage only; not compliance quality' }],
        comparison: [{ scenario_id: 's1', scenario_ref: 'SCN-0001', scenario_name: 'Identity fails', status_a: 'PASSED', status_b: 'FAILED',
          plan_diff: { only_in_a: [], only_in_b: ['Q-NEW'], applicable_only_in_a: [], applicable_only_in_b: ['Q-NEW'], order_changed: false, item_changes: [] },
          outcome_diff: [{ field: 'outcome', a: 'TERMINATED', b: 'COMPLETED' }] }] }),
    }));
    renderAt(<App />, '/simulator?tab=runs&batch=b1');
    expect(await screen.findByTestId('batch-totals')).toHaveTextContent('B · Stale1');
    const cmp = screen.getByTestId('cmp-SCN-0001');
    expect(cmp).toHaveTextContent('Added in B: Q-NEW');
    expect(within(cmp).getByRole('table')).toHaveTextContent('TERMINATED');
    expect(screen.getByTestId('result-detail')).toHaveTextContent('Outcome: expected completed, got terminated'); // first non-passing result opens
    expect(screen.getByTestId('result-detail')).toHaveTextContent('content changed');
    const cov = screen.getByTestId('coverage');
    expect(cov).toHaveTextContent('Structural coverage only; not compliance quality');
    expect(cov).toHaveTextContent('2 / 3 (67%)');
    expect(cov).toHaveTextContent('Q-ID (ANSWERED_NO)');
  });

  it('evaluates an interactive run and shows results, the completion/evaluation separation and the evidence trace (S3-A)', async () => {
    let posted = 0;
    const EV = { id: 'e1', evaluation_ref: 'EVL-0001', events_evaluated: 40, engine_version: 'call360.answer-evaluation/1 (S3-A deterministic)', controller_status: 'COMPLETED',
      controller_outcome: 'COMPLETED', totals: { MISMATCH: 1, UNRESOLVED: 1, MATCH: 1 }, created_at: T, created_by_name: 'Ops', run_id: 'r1', sim_ref: 'SIM-1', case_ref: 'CB-1', mode: 'VERSION_TEST',
      script_version_id: 'vd', script_label: 'LC_DEMO v1.1', version_status: 'DRAFT', content_sha256: 'a'.repeat(64), content_source: 'CONTENT_SNAPSHOT', policy_fact_snapshot_id: 'snap-1',
      policy_fact_snapshot_sha256: 'b'.repeat(64), input_sha256: 'c'.repeat(64), events_sha256: 'd'.repeat(64), created: true, note: 'n',
      replay: { matches: true, detail: 'Re-derived from the stored inputs: identical results' },
      results: [item('Q-TERM', 'MISMATCH', 'Answered 5 years; expected equal to 10 years from policy fact premium_term_years; differs by 5'),
        item('Q-AMOUNT', 'UNRESOLVED', 'The customer refused to answer; an unresolved answer is never treated as a match', { answer: { kind: 'REFUSED', state: 'REFUSED', value: null } }),
        item('Q-ADVICE', 'MATCH', 'Answered yes; expected yes', { method: 'EXACT_BOOLEAN' })] };
    let items: unknown[] = [];
    stubApi(base({
      'GET /api/v1/script-simulations/r1/evaluations': () => json(200, { items }),
      'POST /api/v1/script-simulations/r1/evaluations': () => { posted += 1; items = [EV]; return json(200, EV); },
      'GET /api/v1/script-simulations/r1/evaluations/e1': () => json(200, EV),
    }));
    renderAt(<RunEvaluation runId="r1" canEvaluate status="COMPLETED" />, '/simulator');
    expect(await screen.findByTestId('sim-eval-none')).toHaveTextContent('No evaluation yet');
    await userEvent.click(screen.getByTestId('sim-evaluate'));
    expect(await screen.findByTestId('sim-eval-header')).toHaveTextContent('Mismatch 1');
    expect(posted).toBe(1);
    expect(screen.getByTestId('sim-eval-separate')).toHaveTextContent('The conversation completed, but the answers contain 1 mismatch and 1 unresolved answer');
    const row = screen.getByTestId('eval-Q-TERM');
    expect(row).toHaveTextContent('10 years (policy fact premium_term_years)');
    expect(row).toHaveTextContent('Mismatch');
    expect(screen.getByTestId('eval-why-Q-TERM')).toHaveTextContent('differs by 5');
    expect(screen.getByTestId('eval-Q-AMOUNT')).toHaveTextContent('Refused');
    expect(screen.getByTestId('sim-eval-trace')).toHaveTextContent('snap-1');
    expect(screen.getByTestId('sim-eval-replay')).toHaveTextContent('Reproduced');
    expect(screen.getByTestId('sim-evaluation')).toHaveTextContent('A match is not a compliance pass');
  });
});
