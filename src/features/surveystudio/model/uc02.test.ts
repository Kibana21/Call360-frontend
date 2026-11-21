// UC-02 — plan computability versus live-call eligibility, corrected delivery validation, statement labels.
import { describe, expect, it } from 'vitest';
import { PROFILES, addReadinessDemo } from './demo';
import { buildFlow, validateModule } from './flow';
import { assess, emptyGov, govOf } from './governance';
import { findModule, updateQuestion } from './ops';
import { buildCallPlan, liveEligibility } from './plan';
import { sampleWorkspace } from './sample';
import { validateAnswer } from './sim';
import { mKey, type Workspace } from './types';
import { renderWording } from './wording';

const [ws, id] = addReadinessDemo(sampleWorkspace());
const survey = (w: Workspace = ws) => w.surveys.find((x) => x.id === id)!;
const welcome = (w: Workspace = ws) => findModule(w, mKey(survey(w).sequence[0]!.module))!;
const facts = (pid: string) => PROFILES.find((p) => p.id === pid)!.facts;
const live = (w: Workspace, pid = 'NORMAL') => liveEligibility(w, survey(w), govOf(emptyGov(), id), buildCallPlan(w, survey(w), facts(pid)));
const stateOf = (w: Workspace, cid: string, pid = 'NORMAL') => live(w, pid).conditions.find((c) => c.id === cid)!.state;

describe('A — can a plan be computed — and B — may it be used on a real call — are separate answers', () => {
  it('a plan that computes perfectly is still not eligible for an operational callback', () => {
    expect(buildCallPlan(ws, survey(), facts('NORMAL')).status).toBe('READY');
    const l = live(ws);
    expect(l.eligible).toBe(false);
    expect(stateOf(ws, 'PLAN_COMPUTABLE')).toBe('MET');
  });
  it('lists every readiness condition explicitly, in its group', () => {
    expect(live(ws).conditions.map((c) => [c.id, c.group, c.state])).toEqual([
      ['PLAN_COMPUTABLE', 'PLAN', 'MET'], ['PUBLISHED_VERSION', 'PUBLICATION', 'NOT_MET'], ['WORDING_APPROVED', 'WORDING', 'NOT_MET'], ['DELIVERY_CONTROLLED', 'WORDING', 'MET'],
      ['GATE_IDENTITY_CHECK', 'GATES', 'MET'], ['GATE_CONSENT_TO_PROCEED', 'GATES', 'NOT_MET'], ['GATE_RECORDING_CONSENT', 'GATES', 'MET'],
      ['ASSIGNMENT', 'ASSIGNMENT', 'NOT_AVAILABLE'], ['CHANNEL', 'CHANNEL', 'NOT_AVAILABLE'], ['NO_ANSWER_POLICY', 'POLICY', 'NOT_MET'],
    ]);
  });
  it('a plan that cannot be computed makes that one condition fail; the others are judged on their own', () => {
    expect(stateOf(ws, 'PLAN_COMPUTABLE', 'MISSING')).toBe('NOT_MET');
    expect(stateOf(ws, 'GATE_IDENTITY_CHECK', 'MISSING')).toBe('MET');
  });
  it('can never report eligibility in the prototype: publication, assignment and channel cannot be established here', () => {
    const l = live(ws);
    expect(l.notAvailable).toBe(2);
    expect(l.met + l.notMet + l.notAvailable).toBe(l.conditions.length);
    expect(l.conditions.filter((c) => c.state === 'NOT_AVAILABLE').map((c) => c.id)).toEqual(['ASSIGNMENT', 'CHANNEL']);
  });
  it('a gate is a structural fact only: its detail says the behaviour on a "no" is not decided', () => {
    const g = live(ws).conditions.find((c) => c.id === 'GATE_IDENTITY_CHECK')!;
    expect(g.detail).toMatch(/not decided/);
  });
});

describe('delivery validation', () => {
  const mk = mKey(welcome());
  it('a recording with no approved asset is an ERROR with a stable code — never a warning', () => {
    const w = updateQuestion(ws, mk, 'n7', { delivery: 'EXACT_AUDIO' });
    const issue = validateModule(w, welcome(w)).find((i) => i.code === 'RECORDING_ASSET_MISSING');
    expect(issue).toMatchObject({ severity: 'ERROR', where: { nodeId: 'n7', part: 'delivery' } });
    const r = assess(w, survey(w));
    expect(r.findings.find((f) => /approved recording is required/.test(f.title))).toMatchObject({ severity: 'BLOCKER' });
    expect(r.ready).toBe(false);
    expect(stateOf(w, 'DELIVERY_CONTROLLED')).toBe('NOT_MET');
  });
  it('conversational delivery is an ERROR with a stable code and fails the delivery condition', () => {
    const w = updateQuestion(ws, mk, 'n7', { delivery: 'CONVERSATIONAL' });
    expect(validateModule(w, welcome(w)).some((i) => i.code === 'DELIVERY_CONVERSATIONAL_BLOCKED' && i.severity === 'ERROR')).toBe(true);
    expect(stateOf(w, 'DELIVERY_CONTROLLED')).toBe('NOT_MET');
  });
  it('a value is never rounded, truncated or defaulted to fit', () => {
    expect(renderWording('{{policy.annual_premium}}', { 'policy.annual_premium': 3000.005 }).values[0]!.state).toBe('INVALID');
    expect(renderWording('{{policy.term_years}}', { 'policy.term_years': 19.5 }).values[0]!.state).toBe('INVALID');
    expect(renderWording('{{policy.annual_premium}}', { 'policy.annual_premium': 0 }).text).toBe('SGD 0');
    expect(renderWording('{{policy.annual_premium}}', {}).text).toBeNull();
  });
  it('an unfinished variable is never spoken with its braces', () => {
    const r = renderWording('Your plan is {{policy.plan_name.', { 'policy.plan_name': 'X' });
    expect(r.text).toBeNull();
    expect(r.values).toEqual([{ variable: '', label: 'an unfinished variable', value: null, state: 'MALFORMED' }]);
  });
});

describe('an acknowledgement that is not given', () => {
  const ack = ws.questions.find((q) => q.answerType === 'ACKNOWLEDGEMENT')!;
  it('is blocked as unresolved policy, apart from "nothing was said"', () => {
    expect(validateAnswer(ack, { acknowledged: false })).toBe('NON_ANSWER_POLICY_UNRESOLVED');
    expect(validateAnswer(ack, {})).toBe('ACKNOWLEDGEMENT_REQUIRED');
    expect(validateAnswer(ack, { acknowledged: true })).toBeNull();
  });
});

describe('statement labels', () => {
  it('statements are labelled S1, S2 … and never take a question number; node ids are unchanged', () => {
    const flow = buildFlow(ws, welcome());
    expect(welcome().nodes.map((n) => [n.id, flow.numbers.get(n.id)])).toEqual([['n1', 'S1'], ['n2', 'Q1'], ['n3', 'Q2'], ['n4', 'S2'], ['n5', 'Q3'], ['n6', 'Q4'], ['n7', 'S3']]);
  });
  it('a module without statements is numbered exactly as before', () => {
    const m = findModule(ws, 'M-GENERAL@1')!;
    expect([...buildFlow(ws, m).numbers.values()].every((x) => /^[QCX]/.test(x))).toBe(true);
  });
  it('the plan lists items in reading order whatever their labels', () => {
    const p = buildCallPlan(ws, survey(), facts('NORMAL'));
    expect(p.modules[0]!.items.map((i) => i.number)).toEqual(['S1', 'Q1', 'Q2', 'S2', 'Q3', 'Q4', 'S3']);
    expect(p.modules[0]!.items.map((i) => i.key.split('/')[1])).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7']);
  });
});
