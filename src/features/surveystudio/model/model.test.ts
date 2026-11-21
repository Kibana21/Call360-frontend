// SS-02A — the prototype's canonical model: operation rules, validation, the demonstration evaluator and its agreement
// with the SS-01 fixtures (Call360-specs docs/plans/survey-studio/fixtures) where the prototype implements the same rule.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeAst, effectiveSelection, evaluate, previewQueue, ruleWinner, selectionError, shadowedRules } from './engine';
import { availableAnswers, buildFlow, validateModule, validateSurvey } from './flow';
import {
  addFollowupQuestion, addInstance, addOption, createBlankModule, createSurvey, deleteNode, deriveModule, duplicateOption, edgeOf, findModule, findQuestion,
  insertQuestion, moveInstance, newQuestionVersion, permittedInterrupts, removeInstance, renameOption, setEdge, setFollowupBehaviour, setInterruptClass, setMode,
  setRejoin, toggleOther, updateQuestion, usage,
  addRule, conditionConsumers, insertDecision, patchOption, removeOption, moveRule, saveCondition, setDecisionBinding, setDecisionUnknown, setFallback, updateRule,
} from './ops';
import { sampleWorkspace } from './sample';
import { isQuestion, mKey, type Ast, type Binding, type Condition, type DecisionNode, type Module, type Question, type QuestionNode, type Target, type Workspace } from './types';

const label = (t: unknown) => (t && typeof t === 'object' && 'node' in t ? String((t as { node: string }).node) : t && typeof t === 'object' && 'outcome' in t ? `END:${(t as { outcome: string }).outcome}` : 'NONE');

const qn = (w: Workspace, key: string, id: string): QuestionNode => { const n = findModule(w, key)!.nodes.find((x) => x.id === id)!; if (!isQuestion(n)) throw new Error('not a question'); return n; };
const dn = (w: Workspace, key: string, id: string): DecisionNode => { const n = findModule(w, key)!.nodes.find((x) => x.id === id)!; if (isQuestion(n)) throw new Error('not a decision'); return n; };

/** A survey with a draft copy of Suitability, ready to edit. */
function draft(): { ws: Workspace; surveyId: string; key: string } {
  const [w1, surveyId] = createSurvey(sampleWorkspace(), { name: 'Test', purpose: '', modules: ['M-GENERAL', 'M-SUITABILITY', 'M-CLOSING'] });
  const [ws, key] = deriveModule(w1, surveyId, 'mi-suitability');
  return { ws, surveyId, key };
}

describe('survey composition', () => {
  it('pins library versions, continues on the normal outcome and leaves exceptional outcomes undecided', () => {
    const [ws, id] = createSurvey(sampleWorkspace(), { name: 'New business', purpose: '', modules: ['M-GENERAL', 'M-SUITABILITY', 'M-CLOSING'] });
    const s = ws.surveys.find((x) => x.id === id)!;
    expect(s.sequence.map((i) => [i.id, i.module.revision])).toEqual([['mi-general-verification', 1], ['mi-suitability', 1], ['mi-closing', 1]]);
    expect(s.sequence[1]!.routes).toEqual({ COMPLETED: '@CONTINUE', CLARIFICATION_REQUIRED: null }); // never invented
    expect(s.sequence[1]!.entry).toMatchObject({ mode: 'RULE', binding: { unknownPolicy: 'BLOCK' } });
    const messages = validateSurvey(ws, s).map((i) => i.message);
    expect(messages).toEqual(['General verification: choose what happens on "Unable to verify"', 'Suitability: choose what happens on "Clarification required"']);
  });

  it('gives a second placement of the same module its own instance identity', () => {
    const [w1, id] = createSurvey(sampleWorkspace(), { name: 'Twice', purpose: '', modules: ['M-GENERAL'] });
    const [w2, second] = addInstance(w1, id, 1, 'M-GENERAL@1');
    expect(second).toBe('mi-general-verification-2');
    expect(w2.surveys[0]!.sequence.map((i) => i.id)).toEqual(['mi-general-verification', 'mi-general-verification-2']);
  });

  it('never re-points a route silently when a module is removed, and flags a backward route after a move', () => {
    const [created, id] = createSurvey(sampleWorkspace(), { name: 'Routes', purpose: '', modules: ['M-GENERAL', 'M-SUITABILITY', 'M-ESCALATION', 'M-CLOSING'] });
    let ws = created;
    ws.surveys[0]!.sequence[1]!.routes.CLARIFICATION_REQUIRED = { instance: 'mi-escalation-and-follow-up' };
    const moved = moveInstance(ws, id, 2, 0); // escalation now runs before the module that routes to it
    expect(validateSurvey(moved, moved.surveys[0]!).map((i) => i.message)).toContain('Suitability: "Clarification required" leads backwards');
    ws = removeInstance(ws, id, 'mi-escalation-and-follow-up');
    expect(ws.surveys[0]!.sequence[1]!.routes.CLARIFICATION_REQUIRED).toBeNull();
  });

  it('requires an UNKNOWN policy on every entry rule', () => {
    const [ws, id] = createSurvey(sampleWorkspace(), { name: 'Policy', purpose: '', modules: ['M-HIGH-VALUE'] });
    const inst = ws.surveys[0]!.sequence[0]!;
    if (inst.entry.mode !== 'RULE') throw new Error('expected a rule');
    inst.entry.binding.unknownPolicy = null;
    expect(validateSurvey(ws, ws.surveys.find((x) => x.id === id)!).map((i) => i.message)).toContain('High value review: choose what happens when information is missing');
  });
});

describe('module editing rules', () => {
  it('refuses to edit a published module; a draft copy leaves the library version untouched', () => {
    const before = sampleWorkspace();
    expect(() => insertQuestion(before, 'M-SUITABILITY@1', { entry: true }, { type: 'YES_NO' })).toThrow(/published version/);
    const { ws, key } = draft();
    expect(key).toBe('M-SUITABILITY@2');
    const [after] = insertQuestion(ws, key, { entry: true }, { type: 'YES_NO' });
    expect(findModule(after, 'M-SUITABILITY@1')).toEqual(findModule(before, 'M-SUITABILITY@1'));
    expect(findModule(after, key)!.nodes).toHaveLength(4);
  });

  it('safe insertion: the new question inherits the former destination; switching to per-answer keeps it on the normal answer only', () => {
    const { ws, key } = draft();
    const [w1, id] = insertQuestion(ws, key, { from: 'n1', on: 'YES' }, { type: 'YES_NO' });
    let m = findModule(w1, key)!;
    expect(edgeOf(m, 'n1', 'YES')!.to).toEqual({ node: id });
    expect(edgeOf(m, id, 'ANY')!.to).toEqual({ node: 'n2' });
    const w2 = setMode(w1, key, id, 'PER_CHOICE');
    m = findModule(w2, key)!;
    expect(edgeOf(m, id, 'YES')!.to).toEqual({ node: 'n2' });
    expect(edgeOf(m, id, 'NO')).toBeUndefined(); // the alternate path is left for the author
    expect(validateModule(w2, m).map((i) => i.message)).toEqual(['Q2 has no question text', 'Q2: "No" has no destination']);
    const w3 = setEdge(w2, key, id, 'NO', { outcome: 'CLARIFICATION_REQUIRED' });
    expect(validateModule(w3, findModule(w3, key)!).filter((i) => i.where.on === 'NO')).toEqual([]);
  });

  it('ops never mutate their input, so undo restores the canonical model', () => {
    const { ws, key } = draft();
    const snapshot = structuredClone(ws);
    const [next] = insertQuestion(ws, key, { from: 'n1', on: 'YES' }, { type: 'SINGLE_SELECT' });
    expect(ws).toEqual(snapshot);
    expect(next).not.toEqual(snapshot);
  });

  it('keeps option codes stable when labels change, and adds Other as a coded option with a text rule', () => {
    const { ws, key } = draft();
    const [inserted, id] = insertQuestion(ws, key, { from: 'n1', on: 'YES' }, { type: 'SINGLE_SELECT' });
    let w = inserted;
    for (const l of ['Premium', 'Benefits', 'Premium']) w = addOption(w, key, id, l);
    const q = () => findQuestion(w, qn(w, key, id).q)!;
    expect(q().options.map((o) => o.code)).toEqual(['PREMIUM', 'BENEFITS', 'PREMIUM_2']);
    w = setMode(w, key, id, 'PER_CHOICE');
    w = setEdge(w, key, id, 'BENEFITS', { outcome: 'COMPLETED' });
    w = renameOption(w, key, id, 'BENEFITS', 'What the plan pays');
    expect(q().options[1]).toEqual({ code: 'BENEFITS', label: 'What the plan pays' });
    expect(edgeOf(findModule(w, key)!, id, 'BENEFITS')!.to).toEqual({ outcome: 'COMPLETED' }); // the route followed the code
    w = toggleOther(w, key, id, true);
    expect(q().options.at(-1)).toMatchObject({ code: 'OTHER', isOther: true, otherText: { required: true } });
    w = addOption(w, key, id, 'Claims');
    expect(q().options.map((o) => o.code)).toEqual(['PREMIUM', 'BENEFITS', 'PREMIUM_2', 'CLAIMS', 'OTHER']); // Other stays last
    expect(selectionError(q(), ['OTHER'], '')).toMatch(/text is required/);
    expect(selectionError(q(), ['OTHER'], 'A reason')).toBeNull();
  });

  it('a reused question keeps its shared definition: only a new version for this placement can change it', () => {
    const { ws, key } = draft();
    const [w1, id] = insertQuestion(ws, key, { entry: true }, { reuse: { code: 'Q-UNDERSTOOD', version: 1 } });
    expect(usage(w1, 'Q-UNDERSTOOD')).toBe(2); // Policy replacement and this placement
    expect(() => updateQuestion(w1, key, id, { text: 'Changed' })).toThrow(/shared, approved definition/);
    const routed = setMode(w1, key, id, 'PER_CHOICE'); // routing belongs to the placement and is free to change
    expect(qn(routed, key, id).routing.mode).toBe('PER_CHOICE');
    const w2 = updateQuestion(newQuestionVersion(w1, key, id), key, id, { text: 'Was that clear?' });
    expect(findQuestion(w2, { code: 'Q-UNDERSTOOD', version: 1 })!.wording.text).toBe('Did you understand what was just explained?');
    expect(findQuestion(w2, { code: 'Q-UNDERSTOOD', version: 2 })).toMatchObject({ published: false, wording: { text: 'Was that clear?', version: 2 } });
    expect(qn(w2, 'M-REPLACEMENT@1', findModule(w2, 'M-REPLACEMENT@1')!.nodes[1]!.id).q).toEqual({ code: 'Q-UNDERSTOOD', version: 1 }); // the other placement keeps v1
  });

  it('shows a merge as one node with several inbound routes, and a delete re-points them only as the author chose', () => {
    const { ws, key } = draft();
    const m = findModule(ws, key)!;
    const flow = buildFlow(ws, m);
    expect(flow.main.map((i) => [i.number, i.node.id])).toEqual([['Q1', 'n1'], ['Q2', 'n2']]);
    expect(flow.main[0]!.rows[1]!.lane.map((i) => [i.number, i.node.id])).toEqual([['Q1a', 'n3']]);
    expect(flow.main[1]!.inboundCount).toBe(2); // n2 is stored once; two routes arrive
    const undecided = deleteNode(ws, key, 'n2', null);
    expect(findModule(undecided, key)!.edges.filter((e) => e.from === 'n1' || e.from === 'n3')).toEqual([{ id: 'e2', from: 'n1', on: 'NO', to: { node: 'n3' } }]);
    const rewired = deleteNode(ws, key, 'n2', { outcome: 'COMPLETED' });
    expect(findModule(rewired, key)!.edges.filter((e) => 'outcome' in e.to).map((e) => e.from).sort()).toEqual(['n1', 'n3']);
  });
});

describe('follow-up queue (demonstration evaluator)', () => {
  const ws = sampleWorkspace();
  const m = findModule(ws, 'M-CLARIFICATIONS@1')!;
  const node = m.nodes[0] as QuestionNode;
  const q = findQuestion(ws, node.q)!;
  const run = (chosen: string[]) => previewQueue(node, q, chosen, label);

  it('asks follow-ups in the configured order whatever the click order, then rejoins once', () => {
    expect(run(['BENEFITS', 'PREMIUM']).steps.map((s) => [s.kind, s.label])).toEqual([['ASK', 'n2'], ['ASK', 'n3'], ['REJOIN', 'n4']]);
  });
  it('asks a shared follow-up once', () => {
    const r = run(['CLAIMS', 'BENEFITS']);
    expect(r.steps.map((s) => s.label)).toEqual(['n3', 'n4']);
    expect(r.deduped).toHaveLength(1);
  });
  it('stops on an interrupt and reports what was skipped', () => {
    const r = run(['PREMIUM', 'CRITICAL_RISK']);
    expect(r.steps).toEqual([{ kind: 'STOP', because: 'I did not agree to this policy', label: 'Stop: Escalate' }]);
    expect(r.skipped).toEqual(['n2']);
  });
  it('rejects an exclusive answer combined with another, and too few answers', () => {
    expect(run(['NONE', 'PREMIUM']).error).toMatch(/cannot be combined/);
    expect(run([]).error).toMatch(/at least 1/);
    expect(run(['NONE']).steps).toEqual([{ kind: 'REJOIN', label: 'n4' }]); // empty queue still rejoins
  });
  it('a new option in a follow-up plan is undeclared until the author decides', () => {
    const { ws: w0, key } = draft();
    const [inserted, id] = insertQuestion(w0, key, { from: 'n1', on: 'YES' }, { type: 'MULTI_SELECT' });
    let w = inserted;
    for (const l of ['Premium', 'Benefits']) w = addOption(w, key, id, l);
    w = setMode(w, key, id, 'SEQUENTIAL_FOLLOWUPS');
    w = addOption(w, key, id, 'Claims');
    const problems = () => validateModule(w, findModule(w, key)!).map((i) => i.message);
    expect(problems()).toContain('Q2: choose what "Claims" does');
    [w] = addFollowupQuestion(w, key, id, 'CLAIMS', { type: 'YES_NO' });
    w = setInterruptClass(w, key, id, 'PREMIUM', 'OPTIONAL');
    w = setFollowupBehaviour(w, key, id, 'PREMIUM', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_ESCALATE', outcome: 'ESCALATE' } });
    expect(problems().filter((p) => p.includes('choose what'))).toEqual([]);
    expect(findModule(w, key)!.outcomes).toContain('ESCALATE'); // declared outcomes follow the routes
    expect(w.surveys[0]!.sequence[1]!.routes.ESCALATE).toEqual({ surveyOutcome: 'ESCALATE' }); // …and it is terminal: an escalation always ends the call as itself (SS-02 closure)
  });
});

describe('SS-02A.1: governed interruptions', () => {
  /** A draft multi-select with ordinary, optional-interrupt and mandatory-escalation answers, in follow-up mode. */
  function plan() {
    const { ws: w0, key } = draft();
    const [inserted, id] = insertQuestion(w0, key, { from: 'n1', on: 'YES' }, { type: 'MULTI_SELECT' });
    let w = inserted;
    for (const l of ['Premium', 'Benefits', 'Complaint', 'Did not agree']) w = addOption(w, key, id, l);
    w = setInterruptClass(w, key, id, 'COMPLAINT', 'OPTIONAL');
    w = setInterruptClass(w, key, id, 'DID_NOT_AGREE', 'MANDATORY');
    w = setMode(w, key, id, 'SEQUENTIAL_FOLLOWUPS');
    const [w1, prem] = addFollowupQuestion(w, key, id, 'PREMIUM', { type: 'YES_NO' });
    const [w2, ben] = addFollowupQuestion(w1, key, id, 'BENEFITS', { type: 'YES_NO' });
    w = w2;
    const run = (ws: Workspace, chosen: string[]) => {
      const m = findModule(ws, key)!;
      const node = m.nodes.find((n) => n.id === id) as QuestionNode;
      return previewQueue(node, findQuestion(ws, node.q)!, chosen, label);
    };
    const messages = (ws: Workspace) => validateModule(ws, findModule(ws, key)!).map((i) => i.message);
    return { w, key, id, prem, ben, run, messages };
  }

  it('the definition decides what a placement may configure', () => {
    expect(permittedInterrupts(undefined)).toEqual([]);
    expect(permittedInterrupts('OPTIONAL')).toEqual(['STOP_ESCALATE', 'RESUME', 'STOP_REJOIN']);
    expect(permittedInterrupts('MANDATORY')).toEqual(['STOP_ESCALATE']);
    const { w, key, id } = plan();
    expect(() => setFollowupBehaviour(w, key, id, 'PREMIUM', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_ESCALATE', outcome: 'ESCALATE' } })).toThrow(/not allowed to interrupt/);
  });

  it('a mandatory escalation cannot be weakened by a placement', () => {
    const { w, key, id, messages } = plan();
    expect(messages(w)).toContain('Q2: "Did not agree" must stop and escalate'); // undeclared is not "no follow-up"
    expect(() => setFollowupBehaviour(w, key, id, 'DID_NOT_AGREE', { kind: 'NONE' })).toThrow(/mandatory escalation/);
    expect(() => setFollowupBehaviour(w, key, id, 'DID_NOT_AGREE', { kind: 'INTERRUPT', interrupt: { policy: 'RESUME' } })).toThrow(/only stop and escalate/);
    expect(() => setFollowupBehaviour(w, key, id, 'DID_NOT_AGREE', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_REJOIN', rejoin: { node: 'n2' } } })).toThrow(/only stop and escalate/);
    expect(() => addFollowupQuestion(w, key, id, 'DID_NOT_AGREE', { type: 'YES_NO' })).toThrow(/mandatory escalation/);
    const noOutcome = setFollowupBehaviour(w, key, id, 'DID_NOT_AGREE', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_ESCALATE' } });
    expect(messages(noOutcome)).toContain('Q2: choose the outcome when "Did not agree" stops the follow-ups'); // no invented outcome
    const ok = setFollowupBehaviour(w, key, id, 'DID_NOT_AGREE', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_ESCALATE', outcome: 'ESCALATE' } });
    expect(messages(ok).filter((x) => x.includes('Did not agree'))).toEqual([]);
    // …nor in the other routing modes
    expect(messages(setMode(ok, key, id, 'ALL_TO_NEXT'))).toContain('Q2: "Did not agree" must escalate, but everybody continues');
  });

  it('A — stop and escalate: no follow-up is asked and the skipped ones are reported', () => {
    const { w, key, id, prem, run } = plan();
    const a = setFollowupBehaviour(w, key, id, 'COMPLAINT', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_ESCALATE', outcome: 'ESCALATE' } });
    const r = run(a, ['PREMIUM', 'COMPLAINT']);
    expect(r.steps.map((s) => [s.kind, s.label])).toEqual([['STOP', 'Stop: Escalate']]);
    expect(r.skipped).toEqual([prem]);
  });

  it('B — handle first, then resume: the interrupt question is asked, then the remaining queue, then one rejoin', () => {
    const { w, key, id, prem, ben, run, messages } = plan();
    const empty = setFollowupBehaviour(w, key, id, 'COMPLAINT', { kind: 'INTERRUPT', interrupt: { policy: 'RESUME' } });
    expect(messages(empty)).toContain('Q2: "Complaint" has nothing to ask before the follow-ups continue'); // no implicit continuation
    const [b, ask] = addFollowupQuestion(empty, key, id, 'COMPLAINT', { type: 'FREE_TEXT' }, 'INTERRUPT');
    expect(run(b, ['BENEFITS', 'COMPLAINT', 'PREMIUM']).steps.map((s) => [s.kind, s.label])).toEqual([['ASK', ask], ['ASK', prem], ['ASK', ben], ['REJOIN', 'n2']]);
  });

  it('C — stop and go to an explicitly chosen destination; it is undecided until chosen', () => {
    const { w, key, id, prem, run, messages } = plan();
    const c0 = setFollowupBehaviour(w, key, id, 'COMPLAINT', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_REJOIN' } });
    expect(messages(c0)).toContain('Q2: choose where "Complaint" leads after stopping the follow-ups'); // no invented destination
    const c = setFollowupBehaviour(c0, key, id, 'COMPLAINT', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_REJOIN', rejoin: { node: 'n3' } } });
    const r = run(c, ['PREMIUM', 'COMPLAINT']);
    expect(r.steps.map((s) => [s.kind, s.label])).toEqual([['REJOIN', 'n3']]);
    expect(r.skipped).toEqual([prem]);
  });

  it('a mandatory escalation wins over any optional interruption selected with it', () => {
    const { w, key, id, run } = plan();
    let x = setFollowupBehaviour(w, key, id, 'DID_NOT_AGREE', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_ESCALATE', outcome: 'ESCALATE' } });
    x = setFollowupBehaviour(x, key, id, 'COMPLAINT', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_REJOIN', rejoin: { node: 'n3' } } });
    expect(run(x, ['COMPLAINT', 'DID_NOT_AGREE', 'PREMIUM']).steps.map((s) => s.label)).toEqual(['Stop: Escalate']);
    // even against another stop-and-escalate that comes earlier in the option order
    x = setFollowupBehaviour(x, key, id, 'COMPLAINT', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_ESCALATE', outcome: 'CLARIFICATION_REQUIRED' } });
    expect(run(x, ['COMPLAINT', 'DID_NOT_AGREE']).steps.map((s) => s.label)).toEqual(['Stop: Escalate']);
  });

  it('withdrawing permission resets a placement that relied on it', () => {
    const { w, key, id, messages } = plan();
    const a = setFollowupBehaviour(w, key, id, 'COMPLAINT', { kind: 'INTERRUPT', interrupt: { policy: 'STOP_REJOIN', rejoin: { node: 'n3' } } });
    const b = setInterruptClass(a, key, id, 'COMPLAINT', null);
    expect((findModule(b, key)!.nodes.find((n) => n.id === id) as QuestionNode).routing.interrupts).toEqual([]);
    expect(messages(b)).toContain('Q2: choose what "Complaint" does');
  });
});

describe('SS-02A.1: duplicate option and blank module', () => {
  it('a duplicate gets a new code and no route: it shows "Choose destination" and blocks until routed', () => {
    const { ws, key } = draft();
    const [inserted, id] = insertQuestion(ws, key, { from: 'n1', on: 'YES' }, { type: 'SINGLE_SELECT' });
    let w = inserted;
    for (const l of ['Premium', 'Benefits']) w = addOption(w, key, id, l);
    w = setMode(w, key, id, 'PER_CHOICE');
    w = setEdge(w, key, id, 'BENEFITS', { outcome: 'COMPLETED' });
    w = updateQuestion(w, key, id, { text: 'Which matters most?' });
    const before = structuredClone(findModule(w, key)!.edges);
    const [d, code] = duplicateOption(w, key, id, 'BENEFITS');
    const q = findQuestion(d, qn(d, key, id).q)!;
    expect(code).toBe('BENEFITS_COPY');
    expect(q.options.map((o) => [o.code, o.label])).toEqual([['PREMIUM', 'Premium'], ['BENEFITS', 'Benefits'], ['BENEFITS_COPY', 'Benefits (copy)']]);
    expect(findModule(d, key)!.edges).toEqual(before); // the original and its references are untouched
    expect(edgeOf(findModule(d, key)!, id, 'BENEFITS_COPY')).toBeUndefined(); // routing is not inherited
    expect(validateModule(d, findModule(d, key)!).map((i) => i.message)).toEqual(['Q2: "Benefits (copy)" has no destination']);
    const [again, code2] = duplicateOption(d, key, id, 'BENEFITS');
    expect(code2).toBe('BENEFITS_COPY_2'); // codes are never reused
    expect(findQuestion(again, qn(again, key, id).q)!.options).toHaveLength(4);
  });

  it('in a follow-up plan the duplicate is undeclared, and a duplicate keeps exclusivity and the interruption class', () => {
    const { ws, key } = draft();
    const [inserted, id] = insertQuestion(ws, key, { from: 'n1', on: 'YES' }, { type: 'MULTI_SELECT' });
    let w = inserted;
    for (const l of ['Premium', 'None']) w = addOption(w, key, id, l);
    w = setInterruptClass(w, key, id, 'PREMIUM', 'MANDATORY');
    w = setMode(w, key, id, 'SEQUENTIAL_FOLLOWUPS');
    const [d] = duplicateOption(w, key, id, 'NONE');
    const [e] = duplicateOption(d, key, id, 'PREMIUM');
    const opts = findQuestion(e, qn(e, key, id).q)!.options;
    expect(opts.find((o) => o.code === 'PREMIUM_COPY')).toMatchObject({ interrupt: 'MANDATORY' });
    const messages = validateModule(e, findModule(e, key)!).map((i) => i.message);
    expect(messages).toContain('Q2: choose what "None (copy)" does');
    expect(messages).toContain('Q2: "Premium (copy)" must stop and escalate');
    expect(() => duplicateOption(toggleOther(e, key, id, true), key, id, 'OTHER')).toThrow(/cannot be duplicated/);
  });

  it('a blank module is a draft, can be placed in one step, and is not ready until it has a question', () => {
    const [w0, surveyId] = createSurvey(sampleWorkspace(), { name: 'Blank', purpose: '', modules: ['M-GENERAL'] });
    const [w, made] = createBlankModule(w0, { name: 'Payment method check', kind: 'COMMON', intent: 'Checks how the premium is paid', place: { surveyId, index: 1 } });
    const m = findModule(w, made.moduleKey)!;
    expect(m).toMatchObject({ published: false, revision: 1, nodes: [], entry: null });
    expect(m.derivedFor).toBeUndefined();
    expect(w.surveys[0]!.sequence.map((i) => i.id)).toEqual(['mi-general-verification', 'mi-payment-method-check']);
    expect(validateSurvey(w, w.surveys[0]!).map((i) => i.message)).toContain('Payment method check has no questions yet');
    const [w2] = insertQuestion(w, made.moduleKey, { entry: true }, { type: 'YES_NO' });
    expect(findModule(w2, made.moduleKey)!.outcomes).toEqual(['COMPLETED']);
    expect(w2.surveys[0]!.sequence[1]!.routes).toEqual({ COMPLETED: '@CONTINUE' }); // the normal outcome follows the normal sequence
    const w3 = setRejoin(setMode(insertQuestion(w2, made.moduleKey, { from: 'n1', on: 'ANY' }, { type: 'MULTI_SELECT' })[0], made.moduleKey, 'n2', 'SEQUENTIAL_FOLLOWUPS'), made.moduleKey, 'n2', { outcome: 'ESCALATE' });
    expect(w3.surveys[0]!.sequence[1]!.routes).toEqual({ ESCALATE: { surveyOutcome: 'ESCALATE' } }); // the module now only ends by escalating; Escalate is governed: it ends the call (SS-02 closure)
  });
});

describe('conditions: three values (demonstration evaluator)', () => {
  const c: Condition = {
    code: 'C-T', version: 1, name: 't', shared: false, params: {},
    ast: { op: 'AND', args: [
      { op: 'GT', left: { field: 'policy.annual_premium' }, right: { literal: 12000 } },
      { op: 'OR', args: [
        { op: 'GTE', left: { field: 'policy.sum_assured' }, right: { literal: 500000 } },
        { op: 'GTE', left: { field: 'customer.age_years' }, right: { literal: 60 } }] }] },
  };
  const tri = (premium: number | null, sum: number | null, age: number | null) =>
    evaluate(c.ast, c, undefined, { 'policy.annual_premium': premium, 'policy.sum_assured': sum, 'customer.age_years': age }).result;
  it('missing input is UNKNOWN unless a known operand already decides', () => {
    expect(tri(15000, 300000, 65)).toBe('TRUE');
    expect(tri(12000, 600000, 65)).toBe('FALSE'); // exactly 12,000 is not "above"
    expect(tri(null, 300000, 65)).toBe('UNKNOWN'); // never read as false
    expect(tri(null, 300000, 45)).toBe('FALSE'); // UNKNOWN AND FALSE = FALSE
    expect(tri(15000, null, 65)).toBe('TRUE'); // UNKNOWN OR TRUE = TRUE
    expect(tri(15000, null, 45)).toBe('UNKNOWN');
  });
});

// ---- agreement with the SS-01 fixtures ----------------------------------------------------------------------------
const FIXTURES = resolve(__dirname, '../../../../../Call360-specs/docs/plans/survey-studio/fixtures');
const fixture = (name: string) => JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8'));

describe.skipIf(!existsSync(FIXTURES))('agreement with the SS-01 canonical fixtures', () => {
  it('F8: module entry verdicts match every expected run', () => {
    const fx = fixture('F8-survey-with-conditional-lego-modules.json');
    for (const run of fx.expected_runs) {
      for (const inst of fx.survey.instances) {
        if (inst.entry.mode !== 'RULE') continue;
        const status = run.expect.modules.find((x: { instance: string }) => x.instance === inst.instance).status;
        if (status === 'NOT_REACHED') continue;
        const def = fx.library.conditions.find((x: { code: string }) => x.code === inst.entry.binding.condition.code);
        const cond: Condition = { code: def.code, version: def.version, name: def.name, ast: def.ast as Ast, params: {}, shared: true };
        const binding: Binding = { condition: { code: def.code, version: def.version }, params: inst.entry.binding.params ?? {}, unknownPolicy: inst.entry.binding.unknown_policy };
        const result = evaluate(cond.ast, cond, binding, run.profile).result;
        const expected = status === 'ACTIVATED' ? 'TRUE' : status === 'SKIPPED_FALSE' ? 'FALSE' : 'UNKNOWN';
        expect(result, `${run.name} / ${inst.instance}`).toBe(expected);
      }
    }
  });

  it('F4: the follow-up queue matches every expected run', () => {
    const fx = fixture('F4-multi-select-ordered-followups.json');
    const mod = fx.library.modules[0];
    const src = mod.nodes[0];
    const set = fx.library.option_sets.find((s: { code: string }) => s.code === 'OS-CLARIFY-AREAS');
    const question: Question = {
      code: 'Q', version: 1, answerType: 'MULTI_SELECT', intent: '', published: true, wording: { version: 1, text: '', approval: 'SYNTHETIC_UNAPPROVED' },
      options: set.options.map((o: { code: string; business_label: string; exclusive?: boolean }) => ({ code: o.code, label: o.business_label, ...(o.exclusive ? { exclusive: true } : {}) })),
      selection: fx.library.questions[0].selection,
    };
    const r = src.routing;
    const node: QuestionNode = {
      id: 'n1', type: 'QUESTION', q: { code: 'Q', version: 1 },
      routing: {
        mode: 'SEQUENTIAL_FOLLOWUPS', rejoin: r.rejoin, noFollowup: r.no_followup,
        followups: [...r.followups].sort((a: { priority: number }, b: { priority: number }) => a.priority - b.priority).map((f: { option: string; nodes: string[] }) => ({ option: f.option, nodes: f.nodes })),
        interrupts: r.interrupts.map((i: { option: string; outcome: 'ESCALATE' }) => ({ option: i.option, policy: 'STOP_ESCALATE' as const, outcome: i.outcome })),
      },
    };
    for (const run of fx.expected_runs) {
      const chosen: string[] = run.answers['mi-clar/n1'].choices;
      const preview = previewQueue(node, question, chosen, label);
      const asked = preview.steps.filter((s) => s.kind === 'ASK').map((s) => `mi-clar/${s.label}`);
      const expectedFollowups = (run.expect.asked as string[]).filter((k) => k !== 'mi-clar/n1' && k !== 'mi-clar/n-confirm');
      expect(asked, run.name).toEqual(expectedFollowups);
      for (const bad of run.rejected ?? []) expect(selectionError(question, bad.answer.choices), `${run.name} rejects`).not.toBeNull();
    }
  });
});

// ---- SS-02B.1: conditions and routing intelligence ----------------------------------------------------------------
const LARGE = (premium: number, sum: number): Binding => ({ condition: { code: 'C-LARGE-COMMITMENT', version: 1 }, params: { premium_above: premium, sum_assured_at_least: sum }, unknownPolicy: null });

describe('decision points inside a module', () => {
  it('inserts safely: only "otherwise" inherits the former destination; matches, unknown and the condition start undecided', () => {
    const d0 = draft();
    const key = d0.key;
    const [ws, qid] = insertQuestion(d0.ws, key, { entry: true }, { type: 'YES_NO' });
    const before = findModule(ws, key)!;
    const first = before.nodes.find((x) => x.id === qid)!;
    const old = edgeOf(before, first.id, 'ANY')!.to;
    const [w, id] = insertDecision(ws, key, { from: first.id, on: 'ANY' });
    const m = findModule(w, key)!;
    expect(id).toBe('d1'); // decisions have their own stable ids
    expect(edgeOf(m, first.id, 'ANY')!.to).toEqual({ node: 'd1' });
    expect(edgeOf(m, 'd1', 'NO_MATCH')!.to).toEqual(old);
    expect(edgeOf(m, 'd1', 'MATCH')).toBeUndefined();
    expect(edgeOf(m, 'd1', 'UNKNOWN')).toBeUndefined();
    const parts = validateModule(w, m).filter((i) => i.where.nodeId === 'd1').map((i) => i.where.on ?? i.where.part);
    expect(parts.sort()).toEqual(['MATCH', 'UNKNOWN', 'condition']); // nothing invalid looks valid
  });

  it('a module can hold two decision points, each with explicit match / otherwise / unknown destinations', () => {
    const ws = sampleWorkspace();
    const m = findModule(ws, 'M-AFFORDABILITY@1')!;
    expect(m.nodes.filter((x) => !isQuestion(x)).map((x) => x.id)).toEqual(['d1', 'd2']);
    expect(validateModule(ws, m)).toEqual([]);
    const flow = buildFlow(ws, m);
    expect([...flow.numbers].map(([k, v]) => `${k}=${v}`)).toEqual(expect.arrayContaining(['n1=Q1', 'd1=C1', 'd2=C2']));
    const d1 = flow.main.find((x) => x.node.id === 'd1')!;
    expect(d1.rows.map((r) => [r.on, label(r.target)])).toEqual([['MATCH', 'n2'], ['NO_MATCH', 'd2'], ['UNKNOWN', 'END:UNABLE_TO_VERIFY']]);
  });

  it('unknown is an explicit choice: a destination, or stop for review — and switching clears the other', () => {
    const { ws, key } = draft();
    const first = findModule(ws, key)!.nodes[0]!;
    const [w1] = insertDecision(ws, key, { from: first.id, on: 'ANY' });
    const w2 = setDecisionUnknown(w1, key, 'd1', { to: { outcome: 'UNABLE_TO_VERIFY' } });
    expect(dn(w2, key, 'd1').binding!.unknownPolicy).toBe('ROUTE');
    expect(findModule(w2, key)!.outcomes).toContain('UNABLE_TO_VERIFY');
    const w3 = setDecisionUnknown(w2, key, 'd1', { stop: true });
    expect(dn(w3, key, 'd1').binding!.unknownPolicy).toBe('BLOCK');
    // stopping is the governed REVIEW_REQUIRED outcome: the run halts, it is not completed, and a survey cannot route it elsewhere
    expect(edgeOf(findModule(w3, key)!, 'd1', 'UNKNOWN')!.to).toEqual({ outcome: 'REVIEW_REQUIRED' });
    expect(findModule(w3, key)!.outcomes).toContain('REVIEW_REQUIRED');
    expect(w3.surveys[0]!.sequence.find((x) => mKey(x.module) === key)!.routes.REVIEW_REQUIRED).toEqual({ surveyOutcome: 'REVIEW_REQUIRED' });
    expect(validateModule(w3, findModule(w3, key)!).some((i) => i.where.nodeId === 'd1' && i.where.on === 'UNKNOWN')).toBe(false);
    // setting the condition afterwards keeps the unknown choice
    const w4 = setDecisionBinding(w3, key, 'd1', LARGE(12000, 500000));
    expect(dn(w4, key, 'd1').binding!.unknownPolicy).toBe('BLOCK');
  });
});

describe('reusable and parameterised conditions', () => {
  const two = () => {
    const { ws, key } = draft();
    const nodes = findModule(ws, key)!.nodes;
    const [w1] = insertDecision(ws, key, { from: nodes[0]!.id, on: 'ANY' });
    const [w2] = insertDecision(w1, key, { from: 'd1', on: 'NO_MATCH' });
    const w3 = setDecisionBinding(setDecisionBinding(w2, key, 'd1', LARGE(12000, 500000)), key, 'd2', LARGE(30000, 1000000));
    return { ws: w3, key };
  };

  it('one definition, two placements, different values — and different verdicts for the same customer', () => {
    const { ws, key } = two();
    const c = ws.conditions.find((x) => x.code === 'C-LARGE-COMMITMENT')!;
    const profile = { 'policy.annual_premium': 15000, 'policy.sum_assured': 600000 };
    expect(evaluate(c.ast, c, dn(ws, key, 'd1').binding!, profile).result).toBe('TRUE');
    expect(evaluate(c.ast, c, dn(ws, key, 'd2').binding!, profile).result).toBe('FALSE');
    expect(describeAst(c.ast, c, dn(ws, key, 'd1').binding!)).toBe('Annual premium is above 12,000 SGD and Sum assured is at least 500,000 SGD');
    expect(describeAst(c.ast, c, dn(ws, key, 'd2').binding!)).toBe('Annual premium is above 30,000 SGD and Sum assured is at least 1,000,000 SGD');
    const uses = conditionConsumers(ws, 'C-LARGE-COMMITMENT');
    expect(uses.filter((u) => u.moduleKey === key).map((u) => u.nodeId)).toEqual(['d1', 'd2']);
    expect(uses.some((u) => u.moduleKey === 'M-AFFORDABILITY@1')).toBe(true); // impact awareness reaches every consumer
  });

  it('changing the definition makes a new version for ONE placement; every other consumer keeps its version', () => {
    const { ws, key } = two();
    const v1 = ws.conditions.find((x) => x.code === 'C-LARGE-COMMITMENT' && x.version === 1)!;
    const [w1, v2] = saveCondition(ws, { ...v1, code: v1.code, ast: { op: 'GT', left: { field: 'policy.annual_premium' }, right: { param: 'premium_above' } }, params: { premium_above: v1.params.premium_above! } });
    const w2 = setDecisionBinding(w1, key, 'd2', { condition: { code: v2.code, version: v2.version }, params: { premium_above: 30000 }, unknownPolicy: null });
    expect(v2.version).toBe(2);
    expect(w2.conditions.find((x) => x.code === v1.code && x.version === 1)).toEqual(v1); // the old version is untouched
    expect(dn(w2, key, 'd1').binding!.condition.version).toBe(1);
    expect(dn(w2, key, 'd1').binding!.params).toEqual({ premium_above: 12000, sum_assured_at_least: 500000 });
    expect(dn(w2, 'M-AFFORDABILITY@1', 'd1').binding!.condition.version).toBe(1);
    expect(conditionConsumers(w2, v1.code).map((u) => u.version).sort()).toEqual([1, 1, 2]);
  });

  it('a placement with a missing value is flagged, not treated as valid', () => {
    const { ws, key } = two();
    const w = setDecisionBinding(ws, key, 'd1', { condition: { code: 'C-LARGE-COMMITMENT', version: 1 }, params: { premium_above: 12000 }, unknownPolicy: null });
    expect(validateModule(w, findModule(w, key)!).some((i) => i.where.nodeId === 'd1' && i.where.part === 'condition' && /needs a value/.test(i.message))).toBe(true);
  });

  it('nested AND / OR / NOT read as one sentence and follow three-valued logic', () => {
    const c: Condition = {
      code: 'C-T', version: 1, name: 'T', shared: false, params: {},
      ast: { op: 'AND', args: [
        { op: 'GTE', left: { field: 'customer.age_years' }, right: { literal: 60 } },
        { op: 'OR', args: [
          { op: 'GT', left: { field: 'policy.annual_premium' }, right: { literal: 12000 } },
          { op: 'NOT', arg: { op: 'EQ', left: { field: 'policy.product_family' }, right: { literal: 'PROTECTION' } } },
        ] },
      ] },
    };
    expect(describeAst(c.ast, c)).toBe('Customer age is at least 60 years and (Annual premium is above 12,000 SGD or not Product family is Protection)');
    const run = (p: Record<string, unknown>) => evaluate(c.ast, c, undefined, p as never).result;
    expect(run({ 'customer.age_years': 65, 'policy.annual_premium': 5000, 'policy.product_family': 'ILP' })).toBe('TRUE');
    expect(run({ 'customer.age_years': 65, 'policy.annual_premium': 5000, 'policy.product_family': 'PROTECTION' })).toBe('FALSE');
    expect(run({ 'customer.age_years': 65, 'policy.annual_premium': null, 'policy.product_family': 'PROTECTION' })).toBe('UNKNOWN');
    expect(run({ 'customer.age_years': 40, 'policy.annual_premium': null, 'policy.product_family': null })).toBe('FALSE'); // a known FALSE decides
  });
});

describe('earlier answers as condition inputs', () => {
  it('knows which answers always exist, which exist on some routes only, and which come later', () => {
    const ws = sampleWorkspace();
    const m = findModule(ws, 'M-AFFORDABILITY@1')!;
    expect(availableAnswers(m, 'd1')).toEqual({ always: ['n1'], sometimes: [] });
    expect(availableAnswers(m, 'd2')).toEqual({ always: ['n1'], sometimes: ['n2'] }); // Q2 is asked only when C1 matches
  });

  const affordabilityDraft = () => {
    const [w1, surveyId] = createSurvey(sampleWorkspace(), { name: 'T', purpose: '', modules: ['M-AFFORDABILITY'] });
    const [ws, key] = deriveModule(w1, surveyId, w1.surveys.find((x) => x.id === surveyId)!.sequence[0]!.id);
    return { ws, key };
  };

  it('a condition that reads a later answer is an error; one that reads a sometimes-asked answer relies on Unknown', () => {
    const { ws: ws0, key } = affordabilityDraft();
    // a condition on Q2 ("long term"), declared by the question's stable identity, pinned version and answer type
    const [w1, c] = saveCondition(ws0, { name: 'Cannot keep paying', shared: false, params: {}, inputs: { long_term: { question: { code: 'Q-AFFORD-LONG-TERM', version: 1 }, answerType: 'YES_NO', scope: 'MODULE' } }, ast: { op: 'EQ', left: { input: 'long_term' }, right: { literal: 'NO' } } });
    const bind = (node: string): Binding => ({ condition: { code: c.code, version: c.version }, params: {}, inputs: { long_term: { node } }, unknownPolicy: 'ROUTE' });
    const forward = setDecisionBinding(w1, key, 'd1', bind('n2')); // C1 comes BEFORE Q2
    expect(validateModule(forward, findModule(forward, key)!).some((i) => i.where.nodeId === 'd1' && /not asked before it/.test(i.message))).toBe(true);
    const sometimes = setDecisionBinding(w1, key, 'd2', bind('n2')); // Q2 is asked on some routes to C2
    expect(validateModule(sometimes, findModule(sometimes, key)!)).toEqual([]);
    const b = dn(sometimes, key, 'd2').binding!;
    expect(evaluate(c.ast, c, b, {}, { answers: {} }).result).toBe('UNKNOWN'); // not asked = unknown, never "no"
    expect(evaluate(c.ast, c, b, {}, { answers: { n2: 'NO' } }).result).toBe('TRUE');
    expect(evaluate(c.ast, c, b, {}, { answers: { n2: 'YES' } }).result).toBe('FALSE');
  });

  it('references are stable and typed: no display label is stored, and a wrong question, type or answer code is flagged', () => {
    const { ws, key } = affordabilityDraft();
    const local = ws.conditions.find((x) => x.code === 'C-LOCAL-NOT-COMFORTABLE')!;
    expect(local.inputs).toEqual({ comfortable: { question: { code: 'Q-PREMIUM-COMFORTABLE', version: 1 }, answerType: 'YES_NO', scope: 'MODULE' } });
    expect(JSON.stringify(local)).not.toMatch(/Are you comfortable|"label"/); // nothing depends on wording
    const issue = (w: Workspace) => validateModule(w, findModule(w, key)!).filter((i) => i.where.nodeId === 'd2' && i.where.part === 'condition').map((i) => i.message);
    expect(issue(ws)).toEqual([]);
    // bound to a placement of a DIFFERENT question (available at that point, but not the declared identity)
    const wrong = setDecisionBinding(ws, key, 'd2', { ...dn(ws, key, 'd2').binding!, inputs: { comfortable: { node: 'n2' } } });
    expect(issue(wrong)[0]).toMatch(/a different question from the one its condition reads/);
    // the condition compares with an option code the question does not have
    const [w2, bad] = saveCondition(ws, { ...local, code: undefined, name: 'x', ast: { op: 'EQ', left: { input: 'comfortable' }, right: { literal: 'MAYBE' } } });
    const stale = setDecisionBinding(w2, key, 'd2', { ...dn(ws, key, 'd2').binding!, condition: { code: bad.code, version: bad.version } });
    expect(issue(stale)[0]).toMatch(/an answer that no longer exists \(MAYBE\)/);
    // the declared answer type no longer fits
    const [w3, typed] = saveCondition(ws, { ...local, code: undefined, name: 'y', inputs: { comfortable: { ...local.inputs!.comfortable!, answerType: 'MULTI_SELECT' } } });
    const mistyped = setDecisionBinding(w3, key, 'd2', { ...dn(ws, key, 'd2').binding!, condition: { code: typed.code, version: typed.version } });
    expect(issue(mistyped)[0]).toMatch(/answer type .* no longer fits/);
  });

  it('multiple-choice answers: any / all / none of stable option codes; not answered is UNKNOWN, an empty selection is known', () => {
    const decl = { question: { code: 'Q-CLARIFY-AREAS', version: 1 }, answerType: 'MULTI_SELECT' as const, scope: 'MODULE' as const };
    const cond = (op: 'INCLUDES_ANY' | 'INCLUDES_ALL' | 'INCLUDES_NONE'): Condition => ({ code: 'C', version: 1, name: 'c', shared: false, params: {}, inputs: { areas: decl }, ast: { op, left: { input: 'areas' }, right: { literal: ['PREMIUM', 'CLAIMS'] } } });
    const b: Binding = { condition: { code: 'C', version: 1 }, params: {}, inputs: { areas: { node: 'n1' } }, unknownPolicy: 'ROUTE' };
    const run = (op: 'INCLUDES_ANY' | 'INCLUDES_ALL' | 'INCLUDES_NONE', answer: string[] | undefined | null) => evaluate(cond(op).ast, cond(op), b, {}, { answers: { n1: answer } }).result;
    expect([run('INCLUDES_ANY', ['CLAIMS']), run('INCLUDES_ALL', ['CLAIMS']), run('INCLUDES_NONE', ['CLAIMS'])]).toEqual(['TRUE', 'FALSE', 'FALSE']);
    expect([run('INCLUDES_ANY', ['PREMIUM', 'CLAIMS', 'BENEFITS']), run('INCLUDES_ALL', ['PREMIUM', 'CLAIMS', 'BENEFITS'])]).toEqual(['TRUE', 'TRUE']);
    expect(run('INCLUDES_NONE', ['BENEFITS'])).toBe('TRUE');
    // NOT ANSWERED is unknown for every operator — in particular "none of" must not become true by accident
    for (const op of ['INCLUDES_ANY', 'INCLUDES_ALL', 'INCLUDES_NONE'] as const) { expect(run(op, undefined)).toBe('UNKNOWN'); expect(run(op, null)).toBe('UNKNOWN'); }
    // ANSWERED WITH NOTHING SELECTED is a known, valid empty selection
    expect([run('INCLUDES_ANY', []), run('INCLUDES_ALL', []), run('INCLUDES_NONE', [])]).toEqual(['FALSE', 'FALSE', 'TRUE']);
  });

  it('deleting the question a condition reads leaves the input unmapped and flagged', () => {
    const [w1, surveyId] = createSurvey(sampleWorkspace(), { name: 'T', purpose: '', modules: ['M-AFFORDABILITY'] });
    const inst = w1.surveys.find((x) => x.id === surveyId)!.sequence[0]!;
    const [w2, key] = deriveModule(w1, surveyId, inst.id);
    const w3 = deleteNode(w2, key, 'n1', { node: 'd1' });
    expect(dn(w3, key, 'd2').binding!.inputs).toEqual({});
    expect(validateModule(w3, findModule(w3, key)!).some((i) => i.where.nodeId === 'd2' && /choose which earlier answer/.test(i.message))).toBe(true);
  });
});

describe('first-matching-rule routing for multiple choice', () => {
  const rules = () => {
    const { ws, key } = draft();
    const [w0, id] = insertQuestion(ws, key, { entry: true }, { type: 'MULTI_SELECT' });
    let w = w0;
    for (const name of ['Premium', 'Benefits', 'Claims', 'Never agreed', 'None of these']) w = addOption(w, key, id, name);
    const codes = findQuestion(w, qn(w, key, id).q)!.options.map((o) => o.code);
    w = updateQuestion(w, key, id, { selection: { min: 1, max: 3 } });
    w = setMode(w, key, id, 'ORDERED_RULES');
    const add = (ww: Workspace, kind: 'ANY' | 'ALL' | 'NONE', options: string[], to: Target) => { const [x, rid] = addRule(ww, key, id); return updateRule(x, key, id, rid, { kind, options, to }); };
    w = add(w, 'ANY', [codes[3]!], { outcome: 'ESCALATE' });
    w = add(w, 'ALL', [codes[0]!, codes[1]!], { outcome: 'CLARIFICATION_REQUIRED' });
    w = add(w, 'ANY', [codes[0]!, codes[2]!], { outcome: 'UNABLE_TO_VERIFY' });
    return { ws: w, key, id, codes };
  };

  it('switching mode keeps the former destination as the fallback and invents no rule', () => {
    const { ws, key } = draft();
    const [w0, id] = insertQuestion(ws, key, { entry: true }, { type: 'MULTI_SELECT' });
    const former = edgeOf(findModule(w0, key)!, id, 'ANY')!.to;
    const w = setMode(w0, key, id, 'ORDERED_RULES');
    expect(qn(w, key, id).routing).toMatchObject({ mode: 'ORDERED_RULES', rules: [], fallback: former });
  });

  it('exactly one rule wins — the first that fits — and later matches are reported, never run', () => {
    const { ws, key, id, codes } = rules();
    const node = qn(ws, key, id);
    const [premium, benefits, claims, never, none] = codes as [string, string, string, string, string];
    expect(ruleWinner(node, [premium, benefits])).toMatchObject({ index: 1, to: { outcome: 'CLARIFICATION_REQUIRED' }, alsoMatched: [2] });
    expect(ruleWinner(node, [premium, never])).toMatchObject({ index: 0, to: { outcome: 'ESCALATE' }, alsoMatched: [2] });
    expect(ruleWinner(node, [claims])).toMatchObject({ index: 2, alsoMatched: [] });
    expect(ruleWinner(node, [none])).toMatchObject({ index: -1, to: qn(ws, key, id).routing.fallback }); // no rule fits: the explicit fallback
    // priority is the list order: moving rule 3 above rule 2 changes the winner for the same selection
    const moved = moveRule(ws, key, id, 2, 1);
    expect(ruleWinner(qn(moved, key, id), [premium, benefits])).toMatchObject({ index: 1, to: { outcome: 'UNABLE_TO_VERIFY' }, alsoMatched: [2] });
  });

  it('flags a rule with no answers or no destination, a missing fallback, and a rule that can never decide', () => {
    const { ws, key, id, codes } = rules();
    const [w1, rid] = addRule(ws, key, id);
    const issues1 = validateModule(w1, findModule(w1, key)!).filter((i) => i.where.nodeId === id);
    expect(issues1.some((i) => i.where.on === `RULE:${rid}`)).toBe(true);
    const w2 = setFallback(updateRule(w1, key, id, rid, { options: [codes[0]!], to: { outcome: 'COMPLETED' } }), key, id, null);
    expect(validateModule(w2, findModule(w2, key)!).filter((i) => i.where.nodeId === id && i.where.on).map((i) => i.where.on)).toEqual(['FALLBACK']);
    expect(shadowedRules(qn(w2, key, id), findQuestion(w2, qn(w2, key, id).q)!)).toEqual([3]); // "any of Premium" is always beaten by rule 3
  });

  it('a mandatory escalation must win with an escalation, whatever else is selected', () => {
    const { ws, key, id, codes } = rules();
    const ok = setInterruptClass(ws, key, id, codes[3]!, 'MANDATORY');
    expect(validateModule(ok, findModule(ok, key)!).filter((i) => i.where.part === 'mandatory')).toEqual([]);
    // the escalation rule is now checked last, and an earlier rule that also fits ends the module as Completed
    const weakened = updateRule(moveRule(ok, key, id, 0, 2), key, id, 'r3', { to: { outcome: 'COMPLETED' } });
    expect(validateModule(weakened, findModule(weakened, key)!).some((i) => i.where.part === 'mandatory' && i.where.on === codes[3])).toBe(true);
  });
});

describe('multi-select selection limits', () => {
  it('are never changed by another edit: removing an answer or changing exclusivity raises a conflict and keeps them', () => {
    const { ws, key } = draft();
    const [w0, id] = insertQuestion(ws, key, { entry: true }, { type: 'MULTI_SELECT' });
    let w = w0;
    for (const name of ['A', 'B', 'C', 'D']) w = addOption(w, key, id, name);
    const q = () => findQuestion(w, qn(w, key, id).q)!;
    expect(q().selection).toBeUndefined(); // no limit until the author sets one; adding answers changes nothing
    expect(effectiveSelection(q())).toEqual({ min: 1, max: 4 });
    w = updateQuestion(w, key, id, { selection: { min: 2, max: 4 } });
    const issue = (ww: Workspace) => validateModule(ww, findModule(ww, key)!).find((i) => i.where.nodeId === id && i.where.part === 'selection');
    expect(issue(w)).toBeUndefined();
    const codes = q().options.map((o) => o.code);
    const removed = removeOption(w, key, id, codes[3]!);
    expect(findQuestion(removed, qn(removed, key, id).q)!.selection).toEqual({ min: 2, max: 4 }); // preserved exactly
    expect(issue(removed)!.message).toMatch(/at most 4 answers, but only 3 can be combined/);
    expect(issue(removed)!.fix).toMatch(/kept as you set them/);
    const exclusive = patchOption(w, key, id, codes[0]!, { exclusive: true });
    expect(findQuestion(exclusive, qn(exclusive, key, id).q)!.selection).toEqual({ min: 2, max: 4 });
    expect(issue(exclusive)).toBeDefined();
    const dup = duplicateOption(w, key, id, codes[0]!)[0];
    expect(findQuestion(dup, qn(dup, key, id).q)!.selection).toEqual({ min: 2, max: 4 }); // not widened either
    // the author resolves it explicitly; the earlier workspace is untouched, which is what undo restores
    const resolved = updateQuestion(removed, key, id, { selection: { min: 2, max: 3 } });
    expect(issue(resolved)).toBeUndefined();
    expect(findQuestion(w, qn(w, key, id).q)!.options).toHaveLength(4);
    expect(findQuestion(updateQuestion(removed, key, id, { selection: null }), qn(removed, key, id).q)!.selection).toBeUndefined();
  });

  it('validates the limits themselves and applies them, with exclusive answers and Other', () => {
    const { ws, key } = draft();
    const [w0, id] = insertQuestion(ws, key, { entry: true }, { type: 'MULTI_SELECT' });
    let w = w0;
    for (const name of ['A', 'B', 'C', 'None']) w = addOption(w, key, id, name);
    const q0 = findQuestion(w, qn(w, key, id).q)!;
    const [a, b, c, none] = q0.options.map((o) => o.code) as [string, string, string, string];
    w = toggleOther(w, key, id, true);
    const issue = (ww: Workspace) => validateModule(ww, findModule(ww, key)!).find((i) => i.where.nodeId === id && i.where.part === 'selection')?.message;
    expect(issue(updateQuestion(w, key, id, { selection: { min: 3, max: 2 } }))).toMatch(/do not make sense/);
    expect(issue(updateQuestion(w, key, id, { selection: { min: 1, max: 9 } }))).toMatch(/at most 9 answers, but only/);
    const good = updateQuestion(w, key, id, { selection: { min: 2, max: 3 } });
    expect(issue(good)).toBeUndefined();
    const q = { ...findQuestion(good, qn(good, key, id).q)!, options: findQuestion(good, qn(good, key, id).q)!.options.map((o) => (o.code === none ? { ...o, exclusive: true } : o)) };
    const other = q.options.find((o) => o.isOther)!.code;
    expect(selectionError(q, [a])).toBe('Choose at least 2.');
    expect(selectionError(q, [a, b, c, other], 'x')).toBe('Choose at most 3.');
    expect(selectionError(q, [a, none])).toMatch(/cannot be combined/);
    expect(selectionError(q, [a, other], '')).toMatch(/text is required/);
    expect(selectionError(q, [a, b])).toBeNull();
  });
});

describe.skipIf(!existsSync(FIXTURES))('SS-02B.1 agreement with fixture F6 (internal condition with UNKNOWN)', () => {
  it('reproduces all six expected runs through the same evaluator and binding inputs', () => {
    const fx = fixture('F6-internal-condition-with-unknown.json');
    const def = fx.library.conditions[0];
    const fm = fx.library.modules[0];
    // translate the canonical contract into the prototype's shape (documented in the SS-02B.1 report, section "contract notes")
    const cond: Condition = { code: def.code, version: def.version, name: def.name, ast: def.ast as Ast, shared: true, params: {}, inputs: { risk_understood: { question: { code: 'Q-RISKS-UNDERSTOOD', version: 1 }, answerType: 'YES_NO', scope: 'MODULE' } } };
    const m: Module = {
      code: 'M-F6', revision: 1, name: 'F6', kind: 'RISK', intent: '', published: false, entry: 'n1', outcomes: [],
      nodes: fm.nodes.map((n: { node: string; type: string; question?: { code: string; version: number }; routing?: { mode: string; normal_answer?: string }; binding?: { condition: { code: string; version: number }; params: Record<string, number>; inputs: Record<string, { answer: { node: string } }>; unknown_policy: string } }) => (n.type === 'DECISION'
        ? { id: n.node, type: 'DECISION', binding: { condition: n.binding!.condition, params: n.binding!.params, inputs: Object.fromEntries(Object.entries(n.binding!.inputs).map(([k, v]) => [k, { node: v.answer.node }])), unknownPolicy: n.binding!.unknown_policy === 'ROUTE_UNKNOWN' ? 'ROUTE' : 'BLOCK' } }
        : { id: n.node, type: 'QUESTION', q: { code: n.question!.code, version: n.question!.version }, routing: { mode: n.routing!.mode, ...(n.routing!.normal_answer ? { normal: n.routing!.normal_answer } : {}) } })),
      edges: fm.edges.map((x: { edge: string; from: string; on: string; to: Target }) => ({ id: x.edge, from: x.from, on: x.on, to: x.to })),
    };
    expect(fx.expected_runs).toHaveLength(6);
    for (const run of fx.expected_runs) {
      const answers: Record<string, string> = Object.fromEntries(Object.entries(run.answers as Record<string, { choice: string }>).map(([k, v]) => [k.split('/')[1]!, v.choice]));
      const asked: string[] = [];
      const trace: string[] = [];
      let at: Target = { node: m.entry! };
      for (let guard = 0; 'node' in at && guard < 20; guard++) {
        const id: string = at.node;
        const nd = m.nodes.find((x) => x.id === id)!;
        let on: string;
        if (isQuestion(nd)) { asked.push(`mi-enh/${nd.id}`); on = answers[nd.id]!; }
        else {
          const known = Object.fromEntries(asked.map((k) => [k.split('/')[1]!, answers[k.split('/')[1]!]]));
          const res = evaluate(cond.ast, cond, nd.binding!, run.profile, { answers: known }).result;
          trace.push(`mi-enh/${nd.id}: ${res}`);
          on = res === 'TRUE' ? 'MATCH' : res === 'FALSE' ? 'NO_MATCH' : 'UNKNOWN';
        }
        at = (edgeOf(m, nd.id, on) ?? edgeOf(m, nd.id, 'ANY'))!.to; // specific edge, then ANY
      }
      expect(asked, run.name).toEqual(run.expect.asked);
      expect(trace, run.name).toEqual(run.expect.trace);
      expect('outcome' in at ? at.outcome : null, run.name).toBe(run.expect.modules[0].outcome);
    }
  });
});
