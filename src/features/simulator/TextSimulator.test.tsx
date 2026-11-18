// S2-D Text Simulator: plan with included / excluded modules and approved skip reasons, start, simulated delivery
// before answering, server-decided next action, progress and trace; no client-side progression logic.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const OPS = { ...ME, roles: ['USER'], permissions: ['dashboard.read', 'case.read', 'script.read', 'script.simulate'] };
const T = '2026-11-17T10:00:00Z';
const PLAN = {
  case_id: 'c1', case_ref: 'CB-2026-10501', script_label: 'SALES_VERIFICATION_SG v1.1', script_version_id: 'v11', script_family_id: 'f1',
  manifest_sha256: 'a'.repeat(64), content_approval_status: 'SYNTHETIC_UNAPPROVED', facts: { product_family: 'PROTECTION', is_ilp: false }, risk_band: 'MEDIUM',
  sections: [{ module_code: 'COMMON_SALES_CONDUCT', name: 'Common', kind: 'COMMON', position: 1, included: true, condition: 'always' },
    { module_code: 'ILP', name: 'ILP', kind: 'PRODUCT', position: 3, included: false, condition: 'is ilp is yes' }],
  questions: [
    { code: 'Q-REP-DISCLOSED', revision: 1, section: 'COMMON_SALES_CONDUCT', section_name: 'Common', position: 1, wording: 'Did the representative disclose?', answer_type: 'YES_NO',
      options: [], mandatory: true, delivery_mode: 'CONVERSATIONAL', max_reprompts: 1, applicable: true, skip_reason: null },
    { code: 'Q-CHARGES-EXPLAINED', revision: 1, section: 'ILP', section_name: 'ILP', position: 2, wording: 'Charges?', answer_type: 'YES_NO', options: [], mandatory: true,
      delivery_mode: 'CONVERSATIONAL', max_reprompts: 1, applicable: false, skip_reason: 'Section ILP not included (is ilp is yes does not hold)' }],
  contacts: [{ selection_id: 's1', role: 'OWNER', label: 'Synthetic party 000322', assignment_contact: true }], note: 'Text simulation only',
};
const action = (presented: boolean) => ({ kind: 'ASK', action_id: 'Q-REP-DISCLOSED#1', question_code: 'Q-REP-DISCLOSED', wording: 'Did the representative disclose?', answer_type: 'YES_NO',
  options: [], mandatory: true, verbatim_required: false, presented, reprompts_used: 0, reprompts_allowed: 1, statement: false, note: presented ? 'Presented' : 'Present this question' });
const run = (next: object, status = 'IN_PROGRESS', events = 3) => ({
  id: 'r1', sim_ref: 'SIM-2026-10501-0001', case_id: 'c1', case_ref: 'CB-2026-10501', script_label: 'SALES_VERIFICATION_SG v1.1', script_version_id: 'v11', manifest_sha256: 'a'.repeat(64),
  contact_role: 'OWNER', status, outcome: null, started_at: T, ended_at: null, next_action: next, replayed: false, note: 'Text simulation only',
  summary: { mandatory_total: 2, mandatory_completed: [], mandatory_unresolved: [], mandatory_open: ['Q-REP-DISCLOSED'], mandatory_skipped_by_condition: ['Q-CHARGES-EXPLAINED'], skipped_by_condition: ['Q-CHARGES-EXPLAINED'] },
  questions: [{ code: 'Q-REP-DISCLOSED', section: 'COMMON_SALES_CONDUCT', position: 1, mandatory: true, answer_type: 'YES_NO', status: 'REQUESTED', requests: 1, reprompts_used: 0, reprompts_allowed: 1, answer: null, reason: null }],
  trace: Array.from({ length: events }, (_, i) => ({ seq: i + 1, event_type: ['STARTED', 'QUESTION_SKIPPED', 'QUESTION_REQUESTED', 'DELIVERY_RECORDED', 'ANSWER_RECEIVED'][i] ?? 'QUESTION_COMPLETED', question_code: null, action_id: null, data: {}, actor: 'Ops', occurred_at: T })),
});

describe('Text Simulator', () => {
  it('shows the plan, starts a run, requires simulated delivery before answering and follows the server', async () => {
    const bodies: Record<string, unknown> = {};
    stubApi({
      'GET /api/v1/me': () => json(200, OPS),
      'GET /api/v1/script-simulations/cases': () => json(200, { items: [{ case_id: 'c1', case_ref: 'CB-2026-10501', state: 'VALIDATED', script_label: 'SALES_VERIFICATION_SG v1.1', origin: 'ENGINE', simulations: 0 }] }),
      'GET /api/v1/script-simulations/plan': () => json(200, PLAN),
      'GET /api/v1/cases/c1/script-simulations': () => json(200, { items: [] }),
      'POST /api/v1/script-simulations': async (r) => { bodies.start = await r.json(); return json(201, run(action(false))); },
      'GET /api/v1/script-simulations/r1': () => json(200, run(action(false))),
      'POST /api/v1/script-simulations/r1/delivery': async (r) => { bodies.delivery = await r.json(); return json(200, run(action(true), 'IN_PROGRESS', 4)); },
      'POST /api/v1/script-simulations/r1/answer': async (r) => { bodies.answer = await r.json(); return json(200, run({ ...action(false), kind: 'SEQUENCE_FINISHED', action_id: null }, 'SEQUENCE_FINISHED', 6)); },
    });
    renderAt(<App />, '/simulator?case=c1');
    expect(await screen.findByTestId('sim-banner')).toHaveTextContent('No customer is contacted');
    expect(await screen.findByTestId('sim-modules')).toHaveTextContent('Not included');
    expect(screen.getByTestId('sim-plan-questions')).toHaveTextContent('Skipped by approved condition: Section ILP not included');
    await userEvent.click(screen.getByTestId('sim-start'));
    await waitFor(() => expect(bodies.start).toEqual({ case_id: 'c1', contact_selection_id: null, script_version_id: null }));
    expect(await screen.findByTestId('sim-wording')).toHaveTextContent('Did the representative disclose?');
    expect(screen.queryByTestId('sim-yes')).toBeNull(); // no answer before presentation
    await userEvent.click(screen.getByTestId('sim-present'));
    expect(bodies.delivery).toEqual({ action_id: 'Q-REP-DISCLOSED#1', delivered: true });
    await userEvent.click(await screen.findByTestId('sim-yes'));
    await waitFor(() => expect(bodies.answer).toEqual({ action_id: 'Q-REP-DISCLOSED#1', kind: 'ANSWER', value: true }));
    expect(await screen.findByTestId('sim-finished')).toBeInTheDocument();
    expect(screen.getByTestId('sim-trace-table')).toHaveTextContent('Answer received');
  });
});

// S2-D.1 lifecycle: stage stepper, simulated gates, statement delivery, conversation events and termination.
describe('Text Simulator lifecycle (S2-D.1)', () => {
  const life = (over: object = {}) => ({
    stage: 'OPENING', gates: { identity: 'PENDING', willingness: 'NOT_ASKED', recording_consent: 'NOT_ASKED', cloud_processing: 'NOT_ASKED' },
    flags: [], termination: null, disclosures_delivered: [], disclosures_undelivered: [], blocked_by_identity_gate: [], simulated: true, compliance_outcome: 'NOT_EVALUATED', ...over,
  });
  const opening = { ...action(false), action_id: 'Q-OPEN#1', question_code: 'Q-OPEN', wording: '[Synthetic] Hello', answer_type: 'ACKNOWLEDGEMENT', statement: true,
    stage: 'OPENING', role: 'OPENING_STATEMENT', completes_on_delivery: true };
  const closing = { ...opening, action_id: 'Q-CLOSE#1', question_code: 'Q-CLOSE', wording: '[Synthetic] Goodbye', stage: 'CLOSING', role: 'CLOSING_STATEMENT' };

  it('shows the stage and simulated gates, delivers statements and terminates on a conversation event', async () => {
    const bodies: Record<string, unknown> = {};
    stubApi({
      'GET /api/v1/me': () => json(200, OPS),
      'GET /api/v1/script-simulations/cases': () => json(200, { items: [] }),
      'GET /api/v1/script-simulations/r1': () => json(200, { ...run(opening), lifecycle: life() }),
      'POST /api/v1/script-simulations/r1/delivery': async (r) => { bodies.delivery = await r.json(); return json(200, { ...run({ ...opening, action_id: 'Q-ID#1', question_code: 'Q-ID', answer_type: 'YES_NO', role: 'IDENTITY_CHECK', stage: 'IDENTITY', completes_on_delivery: false, statement: false }), lifecycle: life({ stage: 'IDENTITY' }) }); },
      'POST /api/v1/script-simulations/r1/event': async (r) => {
        bodies.event = await r.json();
        return json(200, { ...run(closing), lifecycle: life({ stage: 'TERMINATION_CLOSING', gates: { identity: 'WRONG_PERSON', willingness: 'NOT_ASKED', recording_consent: 'NOT_ASKED', cloud_processing: 'NOT_ASKED' },
          termination: { reason: 'WRONG_PERSON', detail: 'The person answering is not the intended customer', stage: 'IDENTITY' } }) });
      },
    });
    renderAt(<App />, '/simulator?case=c1&run=r1');
    const panel = await screen.findByTestId('sim-lifecycle');
    expect(panel).toHaveTextContent('All identity and consent outcomes are simulated');
    expect(screen.getByTestId('sim-stages')).toHaveTextContent('Opening (current)');
    expect(screen.getByTestId('sim-gates')).toHaveTextContent('Identity (simulated)');
    expect(screen.getByTestId('sim-present')).toHaveTextContent('Mark as delivered (simulated)');
    await userEvent.click(screen.getByTestId('sim-present'));
    expect(bodies.delivery).toEqual({ action_id: 'Q-OPEN#1', delivered: true });
    expect(await screen.findByText('Identity (current)', { exact: false })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('sim-event-WRONG_PERSON'));
    await waitFor(() => expect(bodies.event).toEqual({ kind: 'WRONG_PERSON', note: null }));
    expect(await screen.findByTestId('sim-termination')).toHaveTextContent('Wrong person');
    expect(screen.getByTestId('sim-gates')).toHaveTextContent('Wrong person');
    expect(screen.queryByTestId('sim-events')).toBeNull(); // no further events after termination
    expect(screen.getByTestId('sim-wording')).toHaveTextContent('Goodbye');
  });
});
