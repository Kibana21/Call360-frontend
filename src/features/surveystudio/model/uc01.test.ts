// UC-01 — statements, number and acknowledgement questions, wording with controlled variables, delivery modes,
// the call plan and the content contract, all on the ONE canonical model.
import { describe, expect, it } from 'vitest';
import { canonical, fingerprint } from './canonical';
import { METHODS_FOR, legacyGaps, toContent } from './contract';
import { PROFILES, addDemoSurvey, addReadinessDemo, playback } from './demo';
import { compare } from './diff';
import { validateModule, validateSurvey } from './flow';
import { assess, liveGates, snapshot } from './governance';
import { moduleGraph } from './graph';
import { createBlankModule, findModule, findQuestion, insertQuestion, setMode, updateQuestion } from './ops';
import { buildCallPlan } from './plan';
import { sampleWorkspace } from './sample';
import { simulateInputs, validateAnswer } from './sim';
import { isQuestion, isStatement, mKey, type Question, type Workspace } from './types';
import { renderWording, variableProblems, variablesOf } from './wording';

const [ws, id] = addReadinessDemo(sampleWorkspace());
const survey = (w: Workspace = ws) => w.surveys.find((x) => x.id === id)!;
const welcome = (w: Workspace = ws) => findModule(w, mKey(survey(w).sequence[0]!.module))!;
const profile = (pid: string) => PROFILES.find((p) => p.id === pid)!;
const qOf = (w: Workspace, nodeId: string): Question => { const n = welcome(w).nodes.find((x) => x.id === nodeId)!; if (!isQuestion(n)) throw new Error('not an item'); return findQuestion(w, n.q)!; };

describe('controlled variables in wording', () => {
  const facts = profile('NORMAL').facts;
  it('renders deterministically, with one stated format per type', () => {
    const text = 'Your {{policy.plan_name}} plan costs {{policy.annual_premium}} a year for {{policy.term_years}} years ({{policy.product_family}}).';
    const a = renderWording(text, facts), b = renderWording(text, facts);
    expect(a.text).toBe('Your SecureLife Protect plan costs SGD 3,000 a year for 20 years (Protection).');
    expect(b).toEqual(a);
    expect(a.values.map((v) => [v.variable, v.state])).toEqual([['policy.plan_name', 'PRESENT'], ['policy.annual_premium', 'PRESENT'], ['policy.term_years', 'PRESENT'], ['policy.product_family', 'PRESENT']]);
  });
  it('formats amounts without depending on the machine locale', () => {
    expect(renderWording('{{policy.annual_premium}}', { 'policy.annual_premium': 1234567.5 }).text).toBe('SGD 1,234,567.50');
    expect(renderWording('{{policy.annual_premium}}', { 'policy.annual_premium': 950 }).text).toBe('SGD 950');
  });
  it('a missing value is an explicit error and nothing is delivered', () => {
    const r = renderWording('Premium {{policy.annual_premium}}.', profile('MISSING').facts);
    expect(r.text).toBeNull();
    expect(r.values[0]!.state).toBe('MISSING');
    expect(r.errors[0]).toMatch(/Annual premium.*missing/);
  });
  it('a value of the wrong kind is an error, not a guess', () => {
    expect(renderWording('{{policy.annual_premium}}', { 'policy.annual_premium': 'lots' }).values[0]!.state).toBe('INVALID');
    expect(renderWording('{{policy.product_family}}', { 'policy.product_family': 'UNLISTED' }).text).toBeNull();
  });
  it('rejects unknown fields, yes/no facts and unfinished variables at authoring time', () => {
    expect(variableProblems('{{policy.nope}}')).toEqual([{ variable: 'policy.nope', problem: 'UNKNOWN_VARIABLE' }]);
    expect(variableProblems('{{policy.is_replacement}}')).toEqual([{ variable: 'policy.is_replacement', problem: 'TYPE_NOT_ALLOWED' }]);
    expect(variableProblems('Hello {{policy.plan_name')).toEqual([{ variable: '', problem: 'MALFORMED' }]);
    expect(variablesOf('{{ policy.plan_name }} and {{policy.plan_name}}')).toEqual(['policy.plan_name']);
  });
});

describe('the demonstration survey built with the editor\'s own operations', () => {
  it('is valid: no module or survey errors', () => {
    for (const inst of survey().sequence) expect(validateModule(ws, findModule(ws, mKey(inst.module))!).filter((i) => i.severity === 'ERROR')).toEqual([]);
    expect(validateSurvey(ws, survey()).filter((i) => i.severity === 'ERROR')).toEqual([]);
  });
  it('places statements as STATEMENT nodes and questions as QUESTION nodes, from one item master', () => {
    const kinds = welcome().nodes.map((n) => [n.type, isQuestion(n) ? findQuestion(ws, n.q)!.answerType : '-']);
    expect(kinds).toEqual([['STATEMENT', 'STATEMENT'], ['QUESTION', 'YES_NO'], ['QUESTION', 'YES_NO'], ['STATEMENT', 'STATEMENT'], ['QUESTION', 'NUMERIC'], ['QUESTION', 'ACKNOWLEDGEMENT'], ['STATEMENT', 'STATEMENT']]);
    expect(welcome().nodes.filter(isStatement).map((n) => isQuestion(n) && findQuestion(ws, n.q)!.statement)).toEqual(['OPENING', 'DISCLOSURE', 'TRANSITION']);
  });
  it('a statement, a number and an acknowledgement have exactly one way on and cannot branch', () => {
    for (const n of welcome().nodes) {
      if (!isQuestion(n)) continue;
      const q = findQuestion(ws, n.q)!;
      if (q.answerType === 'YES_NO') continue;
      expect(n.routing.mode).toBe('ALL_TO_NEXT');
      expect(() => setMode(ws, mKey(welcome()), n.id, 'PER_CHOICE')).toThrow(/one way on/);
    }
  });
  it('the Graph view shows the same items, statements named by their role', () => {
    const g = moduleGraph(ws, welcome());
    expect(g.nodes.filter((n) => n.kind === 'QUESTION').map((n) => n.statement ?? n.answerType)).toEqual(['Opening', 'YES_NO', 'YES_NO', 'Disclosure', 'NUMERIC', 'ACKNOWLEDGEMENT', 'Transition']);
  });
});

describe('the simulator runs the same model', () => {
  it('delivers statements without asking for an answer, and records exactly what was said', () => {
    const r = playback(ws, survey(), profile('NORMAL'));
    expect(r.terminal?.state).toBe('COMPLETED');
    const says = r.events.filter((e) => e.kind === 'SAY');
    expect(says.map((e) => e.kind === 'SAY' && e.role)).toEqual(['OPENING', 'DISCLOSURE', 'TRANSITION', 'CLOSING']);
    expect(says[1]!.kind === 'SAY' && says[1]!.text).toBe('Our records show an annual premium of SGD 3,000, payable for 20 years.');
    // statements are delivered, never "asked": the asked list is questions only
    expect(r.asked.some((k) => says.some((s) => s.kind === 'SAY' && s.key === k))).toBe(false);
    expect(r.deliveries.filter((d) => d.statement)).toHaveLength(4);
    expect(r.deliveries[0]).toMatchObject({ delivery: 'CONTROLLED_TTS', text: 'Good day. This is a service call about your SecureLife Protect plan.', wording_version: 1 });
  });
  it('the same customer always gets the same journey', () => {
    const a = playback(ws, survey(), profile('ILP')), b = playback(ws, survey(), profile('ILP'));
    expect(a.events).toEqual(b.events);
    expect(a.deliveries[0]!.text).toContain('GrowthLink Invest');
  });
  it('halts — it does not improvise — when wording needs a value the record does not have', () => {
    const r = playback(ws, survey(), profile('MISSING'));
    expect(r.terminal).toMatchObject({ state: 'MISSING_INFORMATION_HALT', reason: 'WORDING_VALUE_MISSING' });
    expect(r.end?.why).toMatch(/never completed by guessing/);
    expect(r.deliveries.map((d) => d.text).join(' ')).not.toMatch(/\{\{/);
  });
  it('validates a number against its rule and never accepts a non-acknowledgement', () => {
    const n = qOf(ws, 'n5'), ack = qOf(ws, 'n6');
    expect(validateAnswer(n, {})).toBe('NUMBER_REQUIRED');
    expect(validateAnswer(n, { number: 2.5 })).toBe('NUMBER_NOT_WHOLE');
    expect(validateAnswer(n, { number: 0 })).toBe('NUMBER_TOO_LOW');
    expect(validateAnswer(n, { number: 100 })).toBe('NUMBER_TOO_HIGH');
    expect(validateAnswer(n, { number: 20 })).toBeNull();
    expect(validateAnswer(ack, {})).toBe('ACKNOWLEDGEMENT_REQUIRED');
    expect(validateAnswer(ack, { acknowledged: true })).toBeNull();
  });
  it('a rejected number is asked again; the statement before it is not repeated', () => {
    const r = simulateInputs(ws, survey(), profile('NORMAL').facts, [{ choice: 'YES' }, { choice: 'YES' }, { number: 500 }]);
    expect(r.events.filter((e) => e.kind === 'REJECT').map((e) => e.kind === 'REJECT' && e.code)).toEqual(['NUMBER_TOO_HIGH']);
    expect(r.pending?.node).toBe('n5');
    expect(r.events.filter((e) => e.kind === 'SAY')).toHaveLength(2);
  });
  it('a "No" to the identity check follows the route the author set — no gate behaviour is built in', () => {
    const r = simulateInputs(ws, survey(), profile('NORMAL').facts, [{ choice: 'NO' }]);
    expect(r.terminal).toMatchObject({ state: 'ENDED_WITH_OUTCOME', surveyOutcome: 'UNABLE_TO_VERIFY' });
  });
});

describe('validation blocks what has not been decided', () => {
  const mk = mKey(welcome());
  const errorsOf = (w: Workspace) => validateModule(w, welcome(w)).filter((i) => i.severity === 'ERROR').map((i) => i.message);
  it('conversational delivery is blocked', () => {
    const w = updateQuestion(ws, mk, 'n1', { delivery: 'CONVERSATIONAL' });
    expect(errorsOf(w).join('|')).toMatch(/own words" is blocked/);
    expect(assess(w, survey(w)).blockers).toBeGreaterThan(0);
  });
  it('an approved recording blocks: with no recording attached, and with a variable in it (UC-02: never an acknowledgable warning)', () => {
    expect(errorsOf(updateQuestion(ws, mk, 'n1', { delivery: 'EXACT_AUDIO' })).join('|')).toMatch(/recording cannot contain a variable/);
    const w = updateQuestion(ws, mk, 'n7', { delivery: 'EXACT_AUDIO' });
    expect(errorsOf(w).join('|')).toMatch(/recording is required, and none is attached/);
    expect(validateModule(w, welcome(w)).filter((i) => i.severity === 'WARNING')).toEqual([]);
    expect(assess(w, survey(w)).ready).toBe(false);
  });
  it('an unknown variable is an error on the item that uses it', () => {
    const w = updateQuestion(ws, mk, 'n7', { text: 'Thank you {{customer.nickname}}.' });
    const issue = validateModule(w, welcome(w)).find((i) => i.where.part === 'wording');
    expect(issue).toMatchObject({ severity: 'ERROR', where: { nodeId: 'n7' } });
  });
  it('roles and the mandatory flag are guarded by the item kind', () => {
    expect(() => updateQuestion(ws, mk, 'n1', { mandatory: true })).toThrow(/statement/);
    expect(() => updateQuestion(ws, mk, 'n5', { role: 'IDENTITY_CHECK' })).toThrow(/yes\/no/);
    expect(() => updateQuestion(ws, mk, 'n2', { statement: 'CLOSING' })).toThrow(/Only a statement/);
  });
  it('reports live eligibility as information, never as approval', () => {
    expect(liveGates(ws, survey())).toEqual({ present: ['IDENTITY_CHECK', 'RECORDING_CONSENT'], missing: ['CONSENT_TO_PROCEED'] });
    const f = assess(ws, survey()).findings.find((x) => x.id.startsWith('G|LIVE'));
    expect(f).toMatchObject({ severity: 'INFO', area: 'GOVERNANCE' });
  });
});

describe('one canonical model', () => {
  it('choosing the default delivery leaves the model exactly as it was', () => {
    const mk = mKey(welcome());
    expect(canonical(updateQuestion(updateQuestion(ws, mk, 'n7', { delivery: 'EXACT_AUDIO' }), mk, 'n7', { delivery: 'CONTROLLED_TTS' }))).toBe(canonical(ws));
  });
  it('the sample library and the first demonstration survey are unchanged by UC-01', () => {
    const [w] = addDemoSurvey(sampleWorkspace());
    for (const q of w.questions) { expect(q.mandatory).toBeUndefined(); expect(q.wording.delivery).toBeUndefined(); expect(q.statement).toBeUndefined(); }
    expect(w.modules.flatMap((m) => m.nodes).every((n) => n.type !== 'STATEMENT')).toBe(true);
    expect(fingerprint(w)).toBe(fingerprint(addDemoSurvey(sampleWorkspace())[0]));
  });
  it('the same statement added two ways gives the same model', () => {
    const base = createBlankModule(sampleWorkspace(), { name: 'T', kind: 'OPENING', intent: '' });
    const a = insertQuestion(base[0], base[1].moduleKey, { entry: true }, { type: 'STATEMENT' });
    const b = insertQuestion(base[0], base[1].moduleKey, { entry: true }, { type: 'STATEMENT' });
    expect(canonical(a[0])).toBe(canonical(b[0]));
    expect(findModule(a[0], base[1].moduleKey)!.nodes[0]).toMatchObject({ type: 'STATEMENT', routing: { mode: 'ALL_TO_NEXT' } });
  });
  it('revision comparison reports wording, delivery, role and number-rule changes', () => {
    const mk = mKey(welcome());
    let w = updateQuestion(ws, mk, 'n1', { text: 'Hello. This call is about your {{policy.plan_name}} plan.' });
    w = updateQuestion(w, mk, 'n7', { delivery: 'EXACT_AUDIO', statement: 'CLOSING' });
    w = updateQuestion(w, mk, 'n5', { numberRule: { integer: true, min: 1, max: 50, unit: 'years' } });
    w = updateQuestion(w, mk, 'n6', { mandatory: true });
    const titles = compare(snapshot(ws, survey()), snapshot(w, survey(w))).changes.map((c) => c.title).join('|');
    expect(titles).toMatch(/the wording of a statement changed/);
    expect(titles).toMatch(/how it is delivered, or its role, changed/);
    expect(titles).toMatch(/the number it accepts changed/);
  });
});

describe('the call plan', () => {
  it('settles modules from application data and renders exact wording for this customer', () => {
    const p = buildCallPlan(ws, survey(), profile('NORMAL').facts);
    expect(p.status).toBe('READY');
    expect(p.modules.map((m) => [m.name, m.status])).toEqual([['Welcome and checks', 'IN'], ['Reason for purchase', 'IN'], ['High value review', 'OUT'], ['Policy replacement', 'OUT'], ['Wrap-up', 'IN']]);
    expect(p.modules[0]!.items[3]).toMatchObject({ statement: true, role: 'DISCLOSURE', text: 'Our records show an annual premium of SGD 3,000, payable for 20 years.', source: 'Our records show an annual premium of {{policy.annual_premium}}, payable for {{policy.term_years}} years.' });
    expect(p.inputs.find((i) => i.code === 'policy.annual_premium')).toMatchObject({ state: 'PRESENT', value: 'SGD 3,000' });
  });
  it('keeps what an answer will decide OPEN, with its alternatives — it does not guess a path', () => {
    const p = buildCallPlan(ws, survey(), profile('NORMAL').facts);
    const identity = p.modules[0]!.open.find((o) => o.key.endsWith('/n2'))!;
    expect(identity.alternatives).toEqual([{ when: '“Yes”', leads: 'Q2', on: 'YES', to: { node: 'n3' } }, { when: '“No”', leads: 'the module ends: Unable to verify', on: 'NO', to: { outcome: 'UNABLE_TO_VERIFY' } }]);
    const items = p.modules[0]!.items;
    expect(items.map((i) => i.certainty)).toEqual(['ALWAYS', 'ALWAYS', 'SOME', 'SOME', 'SOME', 'SOME', 'SOME']);
    expect(p.modules[0]!.open.some((o) => o.kind === 'OUTCOME')).toBe(true);
  });
  it('a high-premium customer gets a different plan from the same survey', () => {
    const p = buildCallPlan(ws, survey(), profile('HIGH_PREMIUM').facts);
    expect(p.modules.find((m) => m.name === 'High value review')!.status).toBe('IN');
    expect(p.hash).not.toBe(buildCallPlan(ws, survey(), profile('NORMAL').facts).hash);
  });
  it('is blocked, with the reason, when a value the wording needs is missing', () => {
    const p = buildCallPlan(ws, survey(), profile('MISSING').facts);
    expect(p.status).toBe('BLOCKED');
    expect(p.blockers.join(' ')).toMatch(/cannot be delivered.*Annual premium/);
    expect(p.modules[0]!.items[3]!.text).toBeNull();
  });
  it('is deterministic and agrees with what the simulator then delivers', () => {
    const facts = profile('NORMAL').facts;
    expect(buildCallPlan(ws, survey(), facts)).toEqual(buildCallPlan(ws, survey(), facts));
    const planned = new Map(buildCallPlan(ws, survey(), facts).modules.flatMap((m) => m.items).map((i) => [i.key, i.text]));
    for (const d of playback(ws, survey(), profile('NORMAL')).deliveries) expect(planned.get(d.item_instance)).toBe(d.text);
  });
  it('works for the first demonstration survey too, including a module that only a call outcome selects', () => {
    const [w, sid] = addDemoSurvey(sampleWorkspace());
    const s = w.surveys.find((x) => x.id === sid)!;
    const p = buildCallPlan(w, s, profile('UNEASY_OLDER').facts);
    expect(p.modules.length).toBe(s.sequence.length);
    expect(buildCallPlan(w, s, profile('NO_PRODUCT').facts).status).toBe('BLOCKED');
  });
});

describe('interface contract towards evaluation and findings', () => {
  const doc = toContent(ws, survey());
  it('projects every placed item with a unique execution key', () => {
    const items = doc.sections.flatMap((s) => s.items);
    expect(new Set(items.map((i) => i.execution_key)).size).toBe(items.length);
    expect(doc.sections[0]!.items.map((i) => [i.item_type, i.answer_type, i.lifecycle_role, i.mandatory])).toEqual([
      ['STATEMENT', 'STATEMENT', 'OPENING_STATEMENT', false], ['QUESTION', 'YES_NO', 'IDENTITY_CHECK', true], ['QUESTION', 'YES_NO', 'RECORDING_CONSENT', true],
      ['STATEMENT', 'STATEMENT', 'DISCLOSURE', false], ['QUESTION', 'NUMERIC', 'VERIFICATION', true], ['QUESTION', 'ACKNOWLEDGEMENT', 'VERIFICATION', false], ['STATEMENT', 'STATEMENT', 'TRANSITION_STATEMENT', false],
    ]);
  });
  it('carries no evaluation or control configuration: those engines are not replaced', () => {
    for (const i of doc.sections.flatMap((s) => s.items)) { expect(i.evaluation).toBeNull(); expect(i.controls).toEqual([]); }
    expect(METHODS_FOR.STATEMENT).toEqual([]);
    expect(METHODS_FOR.NUMERIC).toContain('NUMERIC_MATCH_POLICY_FACT');
  });
  it('names what today\'s engines could not read', () => {
    expect(legacyGaps(doc.sections[0]!.items[0]!).join(' ')).toMatch(/takes no answer/);
    expect(legacyGaps(doc.sections[0]!.items[4]!)).toEqual([]);
  });
});
