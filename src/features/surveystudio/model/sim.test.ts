// SS-02B.3 — the Journey Simulator's engine, verified against the SS-01 canonical fixtures (the reference
// interpreter's expectations), not against journeys that merely look plausible.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILES, addDemoSurvey, playback, scriptedAnswer } from './demo';
import { mandatoryOutcomes, validateSurvey } from './flow';
import { canonical, connectRoute, connectSurveyRoute, disconnectRoute, disconnectSurveyRoute, surveyRouteFor } from './graph';
import { activationOf, addRule, deriveModule, eligibilityOf, findModule, removeInstance, setActivation, setEdge, setEligibility, setIfIneligible, setIfSkippedInSequence, setMode, setRoute, updateRule } from './ops';
import { sampleWorkspace } from './sample';
import { eventSignature, firstDivergence, simulate, simulateInputs, validateAnswer, type SimAnswer, type SimEvent, type SimResult } from './sim';
import { isQuestion, mKey } from './types';
import type { Condition, Entry, Module, ModuleNode, Question, Survey, SurveyTarget, Target, Workspace } from './types';

const FIXTURES = resolve(__dirname, '../../../../../Call360-specs/docs/plans/survey-studio/fixtures');
/* eslint-disable @typescript-eslint/no-explicit-any */

/** The canonical fixture JSON (SS-01 contract) as a prototype workspace. A translation of shape only — no behaviour. */
function fromFixture(fx: any): { ws: Workspace; survey: Survey } {
  const lib = fx.library;
  const sets = new Map<string, any>(lib.option_sets.map((s: any) => [s.code, s]));
  const questions: Question[] = lib.questions.map((q: any) => {
    const set = q.option_set ? sets.get(q.option_set.code) : undefined;
    const wd = lib.wordings.find((w: any) => w.question === q.code);
    return {
      code: q.code, version: q.version, answerType: q.answer_type, intent: q.intent, published: true,
      options: (set?.options ?? []).map((o: any) => ({
        code: o.code, label: o.business_label, ...(o.exclusive ? { exclusive: true } : {}), ...(o.interrupt ? { interrupt: o.interrupt } : {}),
        ...(o.is_other ? { isOther: true, otherText: { required: !!o.other_text?.required, min: o.other_text?.min_length ?? 0, max: o.other_text?.max_length ?? 500 } } : {}),
      })),
      ...(q.selection ? { selection: q.selection } : {}),
      ...(q.text ? { textRule: { required: q.text.required ?? true, min: q.text.min_length ?? 0, max: q.text.max_length ?? 2000 } } : {}),
      wording: { version: wd?.wording_version ?? 1, text: wd?.text ?? q.intent, approval: 'SYNTHETIC_UNAPPROVED' },
    } as Question;
  });
  const target = (t: any): Target => (t.return ? { ret: true } : t);
  const modules: Module[] = lib.modules.map((m: any) => ({
    code: m.code, revision: m.revision, name: m.name, kind: 'COMMON', intent: '', published: true, entry: m.entry, outcomes: m.outcomes,
    nodes: m.nodes.map((n: any): ModuleNode => (n.type === 'DECISION'
      ? { id: n.node, type: 'DECISION', binding: { condition: n.binding.condition, params: n.binding.params ?? {}, inputs: Object.fromEntries(Object.entries(n.binding.inputs ?? {}).map(([k, v]: [string, any]) => [k, { node: v.answer.node }])), unknownPolicy: n.binding.unknown_policy === 'ROUTE_UNKNOWN' ? 'ROUTE' : 'BLOCK' } }
      : {
        id: n.node, type: 'QUESTION', q: { code: n.question.code, version: n.question.version }, ...(n.role ? { role: n.role } : {}),
        routing: {
          mode: n.routing.mode === 'PER_CHOICE_WITH_DEFAULT' ? 'PER_CHOICE' : n.routing.mode,
          ...(n.routing.normal_answer ? { normal: n.routing.normal_answer } : {}),
          ...(n.routing.followups ? { followups: [...n.routing.followups].sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0)).map((f: any) => ({ option: f.option, nodes: f.nodes })) } : {}),
          ...(n.routing.no_followup ? { noFollowup: n.routing.no_followup } : {}),
          ...(n.routing.interrupts ? { interrupts: [...n.routing.interrupts].sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0)).map((i: any) => ({ option: i.option, policy: i.policy ?? 'STOP_ESCALATE', outcome: i.outcome })) } : {}),
          ...(n.routing.rules ? { rules: n.routing.rules.map((r: any) => ({ id: r.rule, kind: r.when.kind, options: r.when.options, to: target(r.to) })), fallback: n.routing.fallback ? target(n.routing.fallback) : null } : {}),
          ...(n.routing.rejoin ? { rejoin: target(n.routing.rejoin) } : {}),
        },
      })),
    edges: m.edges.map((e: any) => ({ id: e.edge, from: e.from, on: e.on, to: target(e.to) })),
  }));
  const conditions: Condition[] = lib.conditions.map((c: any) => {
    // typed input declarations (D-131): given directly in fixture/2; in fixture/1, the question each input is bound to
    const inputs: Condition['inputs'] = {};
    for (const [k, v] of Object.entries(c.inputs ?? {}) as Array<[string, any]>) if (v.kind === 'ANSWER') inputs[k] = { question: v.question, answerType: v.answer_type, scope: v.scope };
    for (const m of lib.modules) for (const n of m.nodes) {
      if (n.type !== 'DECISION' || n.binding.condition.code !== c.code) continue;
      for (const [k, v] of Object.entries(n.binding.inputs ?? {}) as Array<[string, any]>) {
        const qn = m.nodes.find((x: any) => x.node === v.answer.node);
        const q = questions.find((x) => x.code === qn.question.code)!;
        inputs[k] ??= { question: { code: q.code, version: q.version }, answerType: q.answerType, scope: 'MODULE' };
      }
    }
    // fixture/2 uses the canonical operator names; the prototype spells them INCLUDES_*
    const ops: Record<string, string> = { CONTAINS_ANY: 'INCLUDES_ANY', CONTAINS_ALL: 'INCLUDES_ALL', CONTAINS_NONE: 'INCLUDES_NONE' };
    const ast = JSON.parse(JSON.stringify(c.ast), (key, v) => (key === 'op' && ops[v] ? ops[v] : v));
    return { code: c.code, version: c.version, name: c.name, ast, shared: true, params: Object.fromEntries(Object.entries(c.params ?? {}).map(([k, v]: [string, any]) => [k, { type: v.type, unit: v.unit, label: k }])), inputs };
  });
  const sv = fx.survey;
  const survey: Survey = {
    id: sv.code, name: sv.code, purpose: '', versionLabel: sv.version_label, createdAt: 1,
    sequence: sv.sequence.map((name: string) => {
      const i = sv.instances.find((x: any) => x.instance === name);
      const entry: Entry = i.entry.mode === 'RULE' ? { mode: 'RULE', binding: { condition: i.entry.binding.condition, params: i.entry.binding.params ?? {}, unknownPolicy: i.entry.binding.unknown_policy } } : i.entry;
      const st = (t: any): SurveyTarget => (t === '@CONTINUE' ? '@CONTINUE' : t.survey_outcome ? { surveyOutcome: t.survey_outcome } : { instance: t.instance });
      const routes: Record<string, SurveyTarget> = Object.fromEntries(i.routes.map((r: any) => [r.on, st(r.to)]));
      return { id: i.instance, module: i.module, entry, routes, ...(i.if_ineligible !== undefined ? { ifIneligible: st(i.if_ineligible) } : {}),
        ...(i.activation ? { activation: i.activation } : {}), ...(i.if_skipped_in_sequence !== undefined ? { ifSkippedInSequence: st(i.if_skipped_in_sequence) } : {}) };
    }),
  };
  return { ws: { questions, conditions, modules, surveys: [survey], seq: 1 }, survey };
}

/**
 * FIXTURE VOCABULARY MIGRATION v1 → v2 (owner decision D-136; `fixtures/README.md` §"Versions").
 * The historical fixtures (`call360.survey-studio.fixture/1`, F1–F8) are kept unchanged. They have ONE halted state,
 * `blocked: { reason: "BLOCKED_UNKNOWN" }` with module status `BLOCKED_UNKNOWN`. The engine (and fixture/2) keep three
 * states apart. This function is the whole of the mapping, and it is deliberately one-way and partial:
 *
 *   engine / fixture v2                        →  fixture v1
 *   terminal MISSING_INFORMATION_HALT          →  blocked.reason BLOCKED_UNKNOWN   (the only v1 halt)
 *   module status HALTED_MISSING_INFORMATION   →  module status BLOCKED_UNKNOWN
 *   terminal DRAFT_INVALID (reason R)          →  blocked.reason R                 (v1 ROUTE_MISSING etc.)
 *   terminal COMPLETED / ENDED_WITH_OUTCOME / MANDATORY_ESCALATION  →  survey_outcome
 *   terminal REVIEW_REQUIRED (governed module outcome)              →  NO v1 EQUIVALENT: throws
 *
 * v1 cannot express a governed REVIEW_REQUIRED outcome or a mandatory escalation as such, so those are verified only
 * by fixture/2. Nothing is collapsed inside the engine to make a v1 comparison pass.
 */
function inFixtureV1Terms(r: SimResult) {
  const t = r.terminal;
  if (t?.state === 'REVIEW_REQUIRED') throw new Error('fixture/1 has no equivalent of the governed REVIEW_REQUIRED outcome');
  const halted = t?.state === 'MISSING_INFORMATION_HALT' || t?.state === 'DRAFT_INVALID';
  return {
    asked: r.asked,
    modules: r.modules.map((m) => ({ instance: m.instance, status: m.status === 'HALTED_MISSING_INFORMATION' ? 'BLOCKED_UNKNOWN' : m.status, ...(m.outcome ? { outcome: m.outcome } : {}) })),
    survey_outcome: t && !halted ? t.surveyOutcome : undefined,
    blocked: t?.state === 'MISSING_INFORMATION_HALT' ? { reason: 'BLOCKED_UNKNOWN', at: t.at } : t?.state === 'DRAFT_INVALID' ? { reason: t.reason, at: t.at } : undefined,
  };
}

describe.skipIf(!existsSync(FIXTURES))('the SS-01 canonical fixtures, run through the simulator', () => {
  const files = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => /^F\d.*\.json$/.test(f)).sort() : [];
  const all = files.map((f) => JSON.parse(readFileSync(resolve(FIXTURES, f), 'utf8')));
  it('are the historical fixtures, schema /1, unchanged', () => { expect(new Set(all.map((fx) => fx.schema))).toEqual(new Set(['call360.survey-studio.fixture/1'])); });

  it('covers all eight fixtures: 25 expected runs and 7 rejected answers', () => {
    expect(all).toHaveLength(8);
    expect(all.reduce((n, fx) => n + fx.expected_runs.length, 0)).toBe(25);
    expect(all.reduce((n, fx) => n + fx.expected_runs.reduce((k: number, r: any) => k + (r.rejected ?? []).length, 0), 0)).toBe(7);
  });

  for (const fx of all) {
    for (const run of fx.expected_runs) {
      it(`${fx.fixture} · ${run.name}`, () => {
        const { ws, survey } = fromFixture(fx);
        // every rejected answer is offered FIRST at its question: it must be refused with the expected code, and the run must then proceed
        const bad = new Map<string, any[]>();
        for (const b of run.rejected ?? []) bad.set(b.at, [...(bad.get(b.at) ?? []), b]);
        const r = simulate(ws, survey, run.profile ?? {}, (key, attempt) => {
          const refused = bad.get(key) ?? [];
          return (attempt < refused.length ? refused[attempt].answer : run.answers[key]) as SimAnswer | undefined;
        });
        const exp = run.expect;
        const got = inFixtureV1Terms(r);
        expect(got.asked, 'asked').toEqual(exp.asked);
        expect(got.modules, 'modules').toEqual(exp.modules);
        expect(got.survey_outcome, 'survey_outcome').toEqual(exp.survey_outcome);
        expect(got.blocked, 'blocked').toEqual(exp.blocked);
        if (exp.evidence) expect(r.evidence, 'evidence').toEqual(exp.evidence);
        if (exp.trace) expect(r.trace, 'trace').toEqual(exp.trace);
        if (exp.edges_taken) expect(r.edges, 'edges_taken').toEqual(exp.edges_taken);
        expect(r.pending, 'nothing left unanswered').toBeNull();
        // the rejections, by stable code, in order
        const rejects = r.events.filter((e): e is Extract<SimEvent, { kind: 'REJECT' }> => e.kind === 'REJECT').map((e) => `${e.key}:${e.code}`);
        expect(rejects).toEqual((run.rejected ?? []).map((b: any) => `${b.at}:${b.error}`));
        for (const b of run.rejected ?? []) {
          const [inst, node] = b.at.split('/');
          const m = findModule(ws, `${survey.sequence.find((x) => x.id === inst)!.module.code}@1`)!;
          const n = m.nodes.find((x) => x.id === node) as Extract<ModuleNode, { type: 'QUESTION' }>;
          expect(validateAnswer(ws.questions.find((q) => q.code === n.q.code)!, b.answer)).toBe(b.error);
        }
      });
    }
  }
});

// ---- fixture schema /2: the rules decided in SS-02B.3.1, compared in the engine's own vocabulary (no mapping) ------------
const py = (ids: string[]) => `[${ids.map((x) => `'${x}'`).join(', ')}]`;
const pyJson = (t: SurveyTarget) => (t === '@CONTINUE' ? '"@CONTINUE"' : 'surveyOutcome' in t ? `{"survey_outcome": "${t.surveyOutcome}"}` : `{"instance": "${t.instance}"}`);
/** The simulator's events as the reference interpreter's trace lines (fixture/2). */
function traceV2(r: SimResult, v3 = false): string[] {
  const out: string[] = [];
  for (const e of r.events) {
    if (e.kind === 'ENTRY' && e.mode === 'RULE') out.push(`${e.instance}: entry ${e.result} via ${e.arrival}`);
    else if (e.kind === 'DISPOSITION') out.push(`${e.instance}: not eligible ${e.why.includes('jumped to') ? 'after jump' : 'in sequence'} -> ${pyJson(e.to)}`);
    else if (v3 && e.kind === 'SURVEY_ROUTE' && e.mandatory) out.push(`${e.instance}: mandatory escalation -> ${e.outcome}${e.overridden ? '; survey route overridden' : ''}`);
    else if (e.kind === 'DECISION') out.push(`${e.key}: ${e.result}`);
    else if (e.kind === 'ROUTE' && e.via.startsWith('RULE:')) out.push(`${e.key}: RULE ${e.via.slice(5)}${e.alsoRules?.length ? `; also ${py(e.alsoRules)}` : ''}`);
    else if (e.kind === 'ROUTE' && e.via === 'FALLBACK') out.push(`${e.key}: FALLBACK`);
    else if (e.kind === 'QUEUE' && e.interrupt?.outcome) out.push(`${e.key}: INTERRUPT ${e.interrupt.option} -> ${e.interrupt.outcome}; skipped ${py(e.interrupt.skippedNodes)}${e.interrupt.mandatory ? ' (mandatory)' : ''}`);
    else if (e.kind === 'QUEUE') out.push(`${e.key}: QUEUE ${py(e.queued.map((x) => x.node))}${e.dedupedNodes.length ? `; deduped ${py(e.dedupedNodes)}` : ''}`);
  }
  return out;
}

describe.skipIf(!existsSync(FIXTURES))('the SS-02B.3.1 golden fixtures (schema /2), run through the simulator', () => {
  const files = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => /^G\d.*\.json$/.test(f)).sort() : [];
  const all = files.map((f) => JSON.parse(readFileSync(resolve(FIXTURES, f), 'utf8')));

  it('covers six fixtures: 18 expected runs and 2 rejected answers, all schema /2', () => {
    expect(all.map((fx) => fx.fixture)).toEqual(['G1-jump-to-module-with-eligibility', 'G2-jump-skip-disposition-continue', 'G3-jump-without-skip-disposition-is-invalid',
      'G4-first-matching-rule-routing', 'G5-evidence-states-and-review-halt-in-module', 'G6-mandatory-escalation-precedence']);
    expect(new Set(all.map((fx) => fx.schema))).toEqual(new Set(['call360.survey-studio.fixture/2']));
    expect(all.reduce((n, fx) => n + fx.expected_runs.length, 0)).toBe(18);
    expect(all.reduce((n, fx) => n + fx.expected_runs.reduce((k: number, r: any) => k + (r.rejected ?? []).length, 0), 0)).toBe(2);
  });

  for (const fx of all) {
    for (const run of fx.expected_runs) {
      it(`${fx.fixture} · ${run.name}`, () => {
        const { ws, survey } = fromFixture(fx);
        const bad = new Map<string, any[]>();
        for (const b of run.rejected ?? []) bad.set(b.at, [...(bad.get(b.at) ?? []), b]);
        const r = simulate(ws, survey, run.profile ?? {}, (key, attempt) => {
          const refused = bad.get(key) ?? [];
          return (attempt < refused.length ? refused[attempt].answer : run.answers[key]) as SimAnswer | undefined;
        });
        const exp = run.expect;
        expect(r.asked, 'asked').toEqual(exp.asked);
        expect(r.modules.map((m) => ({ instance: m.instance, status: m.status, ...(m.outcome ? { outcome: m.outcome } : {}) })), 'modules').toEqual(exp.modules);
        // the terminal state, in the engine's own words: completed / ended / mandatory escalation / review required / missing-information halt / invalid draft
        const t = r.terminal!;
        expect({ state: t.state, ...(t.surveyOutcome ? { survey_outcome: t.surveyOutcome } : {}), ...(t.reason ? { reason: t.reason } : {}), ...(t.at ? { at: t.at } : {}) }, 'terminal').toEqual(exp.terminal);
        expect(traceV2(r), 'trace').toEqual(exp.trace);
        expect(Object.fromEntries(r.answerLines.map((l) => [l.key, l.state])), 'evidence states').toEqual(exp.evidence_states);
        expect(r.pending).toBeNull();
        const rejects = r.events.filter((e): e is Extract<SimEvent, { kind: 'REJECT' }> => e.kind === 'REJECT').map((e) => `${e.key}:${e.code}`);
        expect(rejects).toEqual((run.rejected ?? []).map((b: any) => `${b.at}:${b.error}`));
      });
    }
  }

  it('the invalid draft of G3 is caught by authoring validation, before anything runs', () => {
    const g3 = all.find((fx) => fx.fixture.startsWith('G3'));
    const g1 = all.find((fx) => fx.fixture.startsWith('G1'));
    const bad = fromFixture(g3), good = fromFixture(g1);
    const issue = validateSurvey(bad.ws, bad.survey).find((i) => i.where.on === '@SKIP');
    expect(issue).toMatchObject({ severity: 'ERROR', where: { instanceId: 'mi-specialist', on: '@SKIP' } });
    expect(issue!.message).toBe('Specialist call: choose what happens if it is jumped to but does not apply');
    expect(validateSurvey(good.ws, good.survey).filter((i) => i.where.on === '@SKIP')).toEqual([]);
  });
});

// ---- the demonstration survey and the synthetic profiles ---------------------------------------------------------
const demo = () => { const [ws, id] = addDemoSurvey(sampleWorkspace()); return { ws, id, survey: ws.surveys.find((x) => x.id === id)! }; };
const run = (id: string, d = demo()) => playback(d.ws, d.survey, PROFILES.find((p) => p.id === id)!);
const statuses = (r: SimResult) => Object.fromEntries(r.modules.map((m) => [m.name, m.outcome ? `${m.status}:${m.outcome}` : m.status]));
const of = <K extends SimEvent['kind']>(r: SimResult, kind: K) => r.events.filter((e): e is Extract<SimEvent, { kind: K }> => e.kind === kind);

describe('the demonstration survey', () => {
  it('is a complete draft: nothing to fix, so no journey is blocked by the draft itself', () => {
    const { ws, survey } = demo();
    expect(validateSurvey(ws, survey)).toEqual([]);
    expect(PROFILES.map((p) => p.id)).toEqual(expect.arrayContaining(['NORMAL', 'ILP', 'HIGH_PREMIUM', 'HIGH_SUM', 'MISSING', 'REPLACEMENT', 'ESCALATION']));
  });

  it('normal policyholder: only the modules that apply run; the call is completed', () => {
    const r = run('NORMAL');
    expect(r.end).toMatchObject({ status: 'COMPLETED', surveyOutcome: 'COMPLETED' });
    expect(statuses(r)).toEqual({
      'General verification': 'ACTIVATED:COMPLETED', Suitability: 'SKIPPED_FALSE', 'High value review': 'SKIPPED_FALSE', 'Policy replacement': 'SKIPPED_FALSE',
      'Affordability check': 'ACTIVATED:COMPLETED', Clarifications: 'ACTIVATED:COMPLETED', 'Escalation and follow-up': 'SKIPPED_FALSE', Closing: 'ACTIVATED:COMPLETED',
    });
    // why a module was skipped, in words, with the value that was read
    const skipped = of(r, 'ENTRY').find((e) => e.module === 'Suitability')!;
    expect(skipped.why).toBe('It is eligible when Product family is ILP. That is false for this customer.');
    expect(skipped.reads).toEqual([{ what: 'Product family', state: 'KNOWN', value: 'Protection' }]);
  });

  it('conditional modules activate for the customers they are meant for', () => {
    expect(statuses(run('ILP')).Suitability).toBe('ACTIVATED:COMPLETED');
    expect(statuses(run('HIGH_PREMIUM'))['High value review']).toBe('ACTIVATED:COMPLETED');
    expect(statuses(run('REPLACEMENT'))['Policy replacement']).toBe('ACTIVATED:COMPLETED');
    const high = run('HIGH_SUM');
    expect(statuses(high)['High value review']).toBe('ACTIVATED:COMPLETED');
    // inside Affordability: the large-commitment condition matches, so the extra question is asked
    const d = of(high, 'DECISION').find((e) => e.number === 'C1')!;
    expect(d).toMatchObject({ result: 'TRUE', via: 'MATCH' });
    expect(d.rule).toBe('Annual premium is above 12,000 SGD and Sum assured is at least 500,000 SGD');
    expect(d.reads).toEqual([{ what: 'Annual premium', state: 'KNOWN', value: '15,000 SGD' }, { what: 'Sum assured', state: 'KNOWN', value: '900,000 SGD' }]);
    expect(d.notChosen).toHaveLength(2);
    expect(high.asked).toContain('mi-affordability-check/n2');
    expect(run('NORMAL').asked).not.toContain('mi-affordability-check/n2');
  });

  it('missing data: UNKNOWN is never read as "no" — a known value may still decide, a skip records its reason, a decision takes its Unknown route', () => {
    const r = run('MISSING');
    const entries = Object.fromEntries(of(r, 'ENTRY').map((e) => [e.module, e]));
    expect(entries['High value review']).toMatchObject({ status: 'ACTIVATED', result: 'TRUE' }); // UNKNOWN OR TRUE = TRUE
    expect(entries['Policy replacement']).toMatchObject({ status: 'SKIPPED_UNKNOWN', result: 'UNKNOWN' });
    expect(entries['Policy replacement']!.why).toContain('recorded as “information missing” — not as “did not match”');
    expect(entries['Policy replacement']!.reads).toEqual([{ what: 'Replaces an existing policy', state: 'MISSING', value: 'missing' }]);
    const d = of(r, 'DECISION').find((e) => e.number === 'C1')!;
    expect(d).toMatchObject({ result: 'UNKNOWN', via: 'UNKNOWN', to: { outcome: 'UNABLE_TO_VERIFY' } }); // UNKNOWN AND TRUE = UNKNOWN
    expect(d.notChosen.join(' ')).toContain('unknown is never treated as “otherwise”');
    expect(r.end).toMatchObject({ status: 'ENDED_WITH_OUTCOME', surveyOutcome: 'UNABLE_TO_VERIFY' });
    expect(r.modules.find((m) => m.name === 'Closing')!.status).toBe('NOT_REACHED');
  });

  it('multi-select follow-ups: asked in configured order, deduplicated, with what was not asked', () => {
    const r = run('HIGH_SUM');
    const q = of(r, 'QUEUE')[0]!;
    expect(q.queued.map((x) => x.node)).toEqual(['n2', 'n3']); // PREMIUM first, then the question BENEFITS and CLAIMS share — not click order
    expect(q.queued[1]!.because).toBe('Benefits and Claims');
    expect(q.deduped).toHaveLength(1);
    expect(r.asked.filter((k) => k.startsWith('mi-clarifications/'))).toEqual(['mi-clarifications/n1', 'mi-clarifications/n2', 'mi-clarifications/n3', 'mi-clarifications/n4']);
    expect(of(r, 'ROUTE').find((e) => e.via === 'REJOIN')).toBeDefined();
  });

  it('mandatory escalation overrides everything else selected and ends the call with ESCALATE', () => {
    const r = run('ESCALATION');
    const q = of(r, 'QUEUE')[0]!;
    expect(q.interrupt).toMatchObject({ option: 'CRITICAL_RISK', outcome: 'ESCALATE', mandatory: true });
    expect(q.interrupt!.skipped).toHaveLength(1); // the Premium follow-up was not asked
    expect(r.asked.filter((k) => k.startsWith('mi-clarifications/'))).toEqual(['mi-clarifications/n1']);
    expect(statuses(r).Clarifications).toBe('ACTIVATED:ESCALATE');
    expect(r.end).toMatchObject({ status: 'MANDATORY_ESCALATION', surveyOutcome: 'ESCALATE' }); // not an ordinary early ending
    expect(r.terminal).toEqual({ state: 'MANDATORY_ESCALATION', surveyOutcome: 'ESCALATE' });
  });

  it('review required halts automated progression: pending review, not completed, nothing after it runs', () => {
    const r = run('NO_PRODUCT');
    // eligibility could not be decided: a MISSING-INFORMATION halt. The module never started, so this is not the governed module outcome.
    expect(r.end).toMatchObject({ status: 'MISSING_INFORMATION_HALT' });
    expect(r.end!.why).toContain('pending an authorised review; it is not completed');
    expect(r.terminal).toEqual({ state: 'MISSING_INFORMATION_HALT', reason: 'ELIGIBILITY_UNKNOWN', at: 'mi-suitability' });
    expect(r.terminal!.surveyOutcome).toBeUndefined(); // no survey outcome at all
    expect(statuses(r)).toMatchObject({ 'General verification': 'ACTIVATED:COMPLETED', Suitability: 'HALTED_MISSING_INFORMATION', 'High value review': 'NOT_REACHED', Closing: 'NOT_REACHED' });
  });

  it('keeps apart: answered, answered with nothing selected, left unanswered, and skipped on this path', () => {
    const r = run('NORMAL');
    const line = (key: string) => r.answerLines.find((x) => x.key === key)!;
    expect(line('mi-affordability-check/n1')).toMatchObject({ state: 'ANSWERED', given: 'Yes' });
    expect(line('mi-affordability-check/n2')).toMatchObject({ state: 'SKIPPED', given: 'not asked on this path' }); // the extra question
    expect(line('mi-closing/n1')).toMatchObject({ state: 'UNANSWERED' }); // optional remark left blank
    // a condition that reads an answer not collected on the executed path is UNKNOWN, and says why
    const d = demo();
    const [w1, key] = deriveModule(d.ws, d.id, 'mi-affordability-check');
    const local = w1.conditions.find((c) => c.code === 'C-LOCAL-NOT-COMFORTABLE')!;
    const w2: Workspace = { ...w1, conditions: [...w1.conditions, { ...local, code: 'C-T', inputs: { long: { question: { code: 'Q-AFFORD-LONG-TERM', version: 1 }, answerType: 'YES_NO', scope: 'MODULE' } }, ast: { op: 'EQ', left: { input: 'long' }, right: { literal: 'NO' } } }] };
    const m = findModule(w2, key)!;
    const d2 = m.nodes.find((n) => n.id === 'd2') as Extract<ModuleNode, { type: 'DECISION' }>;
    d2.binding = { condition: { code: 'C-T', version: 1 }, params: {}, inputs: { long: { node: 'n2' } }, unknownPolicy: 'BLOCK' };
    const r2 = playback(w2, w2.surveys.find((x) => x.id === d.id)!, PROFILES[0]!); // normal customer: Q1a (n2) is never asked
    const dec = of(r2, 'DECISION').find((e) => e.number === 'C2')!;
    expect(dec.result).toBe('UNKNOWN');
    expect(dec.reads).toEqual([{ what: 'the answer to Q1a', state: 'SKIPPED', value: 'not asked on this path' }]);
    // a decision set to "Stop and flag for review": the module RAN and ended with the governed outcome — a different terminal state
    expect(r2.end).toMatchObject({ status: 'REVIEW_REQUIRED', surveyOutcome: 'REVIEW_REQUIRED' });
    expect(r2.modules.find((x) => x.name === 'Affordability check')).toMatchObject({ status: 'ACTIVATED', outcome: 'REVIEW_REQUIRED' });
  });

  it('never bypasses an incomplete draft: a missing destination stops the run and says where', () => {
    const d = demo();
    const [w1, key] = deriveModule(d.ws, d.id, 'mi-general-verification');
    const off = disconnectRoute(w1, key, 'n1', 'YES');
    const r = playback(off, off.surveys.find((x) => x.id === d.id)!, PROFILES[0]!);
    expect(r.end).toMatchObject({ status: 'DRAFT_INVALID', reason: 'ROUTE_MISSING', where: 'mi-general-verification/n1' });
    expect(r.end!.why).toContain('Nothing was decided and nothing is guessed');
    expect(r.terminal!.surveyOutcome).toBeUndefined();
    expect(r.asked).toEqual(['mi-general-verification/n1']);
    // a rejected answer is never accepted to keep the run going
    const s = off.surveys.find((x) => x.id === d.id)!;
    const stuck = simulateInputs(d.ws, d.survey, PROFILES[0]!.facts, [{ choice: 'MAYBE' }]);
    expect(of(stuck, 'REJECT').map((e) => e.code)).toEqual(['UNKNOWN_OPTION']);
    expect(stuck.pending?.key).toBe('mi-general-verification/n1');
    expect(stuck.asked).toEqual([]);
    expect(s.sequence).toHaveLength(8);
  });

  it('a jump selects a candidate; the candidate still has to be eligible', () => {
    const d = demo();
    // eligible: the jump selects the specialist call, its condition is true, it runs
    const older = run('UNEASY_OLDER', d);
    const e1 = of(older, 'ENTRY').find((e) => e.module === 'Escalation and follow-up')!;
    expect(e1).toMatchObject({ arrival: 'JUMP', status: 'ACTIVATED', result: 'TRUE' });
    expect(e1.why).toBe('It was selected by a jump: “Clarification required” of Affordability check. A jump does not bypass eligibility: it is eligible when Customer age is at least 60 years. That is true for this customer.');
    expect(statuses(older)).toMatchObject({ 'Affordability check': 'ACTIVATED:CLARIFICATION_REQUIRED', Clarifications: 'SKIPPED_BY_ROUTE', 'Escalation and follow-up': 'ACTIVATED:COMPLETED', Closing: 'ACTIVATED:COMPLETED' });
    expect(older.terminal).toEqual({ state: 'COMPLETED', surveyOutcome: 'COMPLETED' });
    // not eligible: skipped with its reason, then the CONFIGURED skip disposition — not a silent continue
    const younger = run('UNEASY_YOUNGER', d);
    expect(of(younger, 'ENTRY').find((e) => e.module === 'Escalation and follow-up')).toMatchObject({ arrival: 'JUMP', status: 'SKIPPED_FALSE', result: 'FALSE' });
    expect(of(younger, 'DISPOSITION')[0]).toMatchObject({ to: { surveyOutcome: 'CLARIFICATION_REQUIRED' }, headline: 'Escalation and follow-up does not apply, so the call ends: Clarification required' });
    expect(younger.terminal).toEqual({ state: 'ENDED_WITH_OUTCOME', surveyOutcome: 'CLARIFICATION_REQUIRED' });
    expect(statuses(younger).Closing).toBe('NOT_REACHED');
    // unknown: its explicit UNKNOWN policy applies — here a missing-information halt
    const unknown = run('UNEASY_NO_AGE', d);
    expect(of(unknown, 'ENTRY').find((e) => e.module === 'Escalation and follow-up')).toMatchObject({ arrival: 'JUMP', status: 'HALTED_MISSING_INFORMATION', result: 'UNKNOWN' });
    expect(unknown.terminal).toEqual({ state: 'MISSING_INFORMATION_HALT', reason: 'ELIGIBILITY_UNKNOWN', at: 'mi-escalation-and-follow-up' });
    // no jump: in sequence the same module is simply skipped and the next one considered
    const normal = run('NORMAL', d);
    expect(of(normal, 'ENTRY').find((e) => e.module === 'Escalation and follow-up')).toMatchObject({ arrival: 'SEQUENCE', status: 'SKIPPED_FALSE' });
    expect(of(normal, 'DISPOSITION')).toEqual([]);
    // a module is considered at most once: no module appears twice among the entry decisions of any run
    for (const r of [older, younger, unknown, normal]) { const seen = of(r, 'ENTRY').map((e) => e.instance); expect(new Set(seen).size).toBe(seen.length); }
  });

  it('a jump target with no skip disposition is an invalid draft: flagged by validation, and it does not run past that point', () => {
    const d = demo();
    const off = setIfIneligible(d.ws, d.id, 'mi-escalation-and-follow-up', null);
    const sv = off.surveys.find((x) => x.id === d.id)!;
    expect(validateSurvey(off, sv).map((i) => i.message)).toEqual(['Escalation and follow-up: choose what happens if it is jumped to but does not apply']);
    const r = playback(off, sv, PROFILES.find((p) => p.id === 'UNEASY_YOUNGER')!);
    expect(r.terminal).toEqual({ state: 'DRAFT_INVALID', reason: 'SKIP_DISPOSITION_MISSING', at: 'mi-escalation-and-follow-up' });
    expect(playback(off, sv, PROFILES.find((p) => p.id === 'UNEASY_OLDER')!).terminal!.state).toBe('COMPLETED'); // eligible: the gap is never reached
    // a disposition may only go forward
    const back = setIfIneligible(d.ws, d.id, 'mi-escalation-and-follow-up', { instance: 'mi-general-verification' });
    expect(validateSurvey(back, back.surveys.find((x) => x.id === d.id)!).map((i) => i.message)).toEqual(['Escalation and follow-up: "if it does not apply" leads backwards']);
    expect(playback(back, back.surveys.find((x) => x.id === d.id)!, PROFILES.find((p) => p.id === 'UNEASY_YOUNGER')!).terminal).toMatchObject({ state: 'DRAFT_INVALID', reason: 'BACKWARD_ROUTE' });
  });

  it('the six terminal states are distinct facts, each reached by its own cause', () => {
    const d = demo();
    const state = (id: string) => run(id, d).terminal!.state;
    expect(state('NORMAL')).toBe('COMPLETED');
    expect(state('MISSING')).toBe('ENDED_WITH_OUTCOME'); // an exception outcome ends the call
    expect(state('ESCALATION')).toBe('MANDATORY_ESCALATION'); // the answer itself required it
    expect(state('NO_PRODUCT')).toBe('MISSING_INFORMATION_HALT'); // eligibility unknown: the module never started
    expect(state('UNEASY_NO_AGE')).toBe('MISSING_INFORMATION_HALT');
    // ESCALATE reached by an ordinary route is an ending with an outcome, not a mandatory escalation
    const [w1, key] = deriveModule(d.ws, d.id, 'mi-general-verification');
    const w2 = setRoute(setEdge(w1, key, 'n1', 'NO', { outcome: 'ESCALATE' }), d.id, 'mi-general-verification', 'ESCALATE', { surveyOutcome: 'ESCALATE' });
    const ordinary = playback(w2, w2.surveys.find((x) => x.id === d.id)!, { ...PROFILES[0]!, answers: { 'Q-IDENTITY-CONFIRMED': { choice: 'NO' } } });
    expect(ordinary.terminal).toEqual({ state: 'ENDED_WITH_OUTCOME', surveyOutcome: 'ESCALATE' });
  });

  it('the same journeys whether the jump and its skip disposition were set in the Composer or in the survey graph', () => {
    const d = demo();
    const blank = setIfIneligible(setRoute(d.ws, d.id, 'mi-affordability-check', 'CLARIFICATION_REQUIRED', null), d.id, 'mi-escalation-and-follow-up', null);
    const composer = setIfIneligible(setRoute(blank, d.id, 'mi-affordability-check', 'CLARIFICATION_REQUIRED', { instance: 'mi-escalation-and-follow-up' }), d.id, 'mi-escalation-and-follow-up', '@CONTINUE');
    const graph = connectSurveyRoute(connectSurveyRoute(blank, d.id, 'mi-affordability-check', 'CLARIFICATION_REQUIRED', { instance: 'mi-escalation-and-follow-up' }), d.id, 'mi-escalation-and-follow-up', '@SKIP', '@CONTINUE');
    expect(canonical(graph)).toBe(canonical(composer));
    for (const id of ['UNEASY_OLDER', 'UNEASY_YOUNGER', 'UNEASY_NO_AGE', 'NORMAL']) {
      const p = PROFILES.find((x) => x.id === id)!;
      expect(playback(graph, graph.surveys.find((x) => x.id === d.id)!, p).events, id).toEqual(playback(composer, composer.surveys.find((x) => x.id === d.id)!, p).events);
    }
    // with "continue" as the disposition the uneasy younger customer goes on to Closing instead of ending
    expect(playback(graph, graph.surveys.find((x) => x.id === d.id)!, PROFILES.find((x) => x.id === 'UNEASY_YOUNGER')!).terminal).toEqual({ state: 'COMPLETED', surveyOutcome: 'COMPLETED' });
    expect(disconnectSurveyRoute(graph, d.id, 'mi-escalation-and-follow-up', '@SKIP').surveys.find((x) => x.id === d.id)!.sequence.find((x) => x.id === 'mi-escalation-and-follow-up')!.ifIneligible).toBeNull();
  });

  it('step and back are exact: a run is a pure function of the model, the profile and the answers so far', () => {
    const { ws, survey } = demo();
    const p = PROFILES[0]!;
    const inputs: SimAnswer[] = [];
    const sigs: string[][] = [];
    for (let i = 0; i < 40; i++) {
      const r = simulateInputs(ws, survey, p.facts, inputs);
      sigs.push(r.events.map(eventSignature));
      if (!r.pending) break;
      inputs.push(scriptedAnswer(ws, survey, p, r.pending.key));
    }
    const full = playback(ws, survey, p);
    expect(sigs[sigs.length - 1]).toEqual(full.events.map(eventSignature)); // stepping to the end = full playback
    // going back one answer gives exactly the earlier state
    expect(simulateInputs(ws, survey, p.facts, inputs.slice(0, 3)).events.map(eventSignature)).toEqual(sigs[3]);
    expect(simulateInputs(ws, survey, p.facts, []).events.map(eventSignature)).toEqual(sigs[0]);
  });

  it('comparing two customers: the first divergence is the entry decision that differs', () => {
    const d = demo();
    const a = run('NORMAL', d), b = run('ILP', d);
    const at = firstDivergence(a.events, b.events);
    expect(at).toBeGreaterThan(0);
    expect(a.events[at]).toMatchObject({ kind: 'ENTRY', module: 'Suitability', status: 'SKIPPED_FALSE' });
    expect(b.events[at]).toMatchObject({ kind: 'ENTRY', module: 'Suitability', status: 'ACTIVATED' });
    expect(firstDivergence(a.events, run('NORMAL', d).events)).toBe(-1);
  });

  it('the same journey whether the survey was edited in Guided or in Graph', () => {
    const d = demo();
    const [w1, key] = deriveModule(d.ws, d.id, 'mi-general-verification');
    const guided = setEdge(w1, key, 'n1', 'NO', { outcome: 'ESCALATE' }); // Guided: the destination picker
    const graph = connectRoute(w1, key, 'n1', 'NO', { outcome: 'ESCALATE' }); // Graph: a connection
    const p = { ...PROFILES[0]!, answers: { ...PROFILES[0]!.answers, 'Q-IDENTITY-CONFIRMED': { choice: 'NO' } } };
    const viaGuided = playback(guided, guided.surveys.find((x) => x.id === d.id)!, p);
    const viaGraph = playback(graph, graph.surveys.find((x) => x.id === d.id)!, p);
    expect(viaGraph.events).toEqual(viaGuided.events);
    expect(statuses(viaGuided)['General verification']).toBe('ACTIVATED:ESCALATE');
    // the edit changed the journey: before it, "No" ended as Unable to verify
    expect(statuses(playback(w1, w1.surveys.find((x) => x.id === d.id)!, p))['General verification']).toBe('ACTIVATED:UNABLE_TO_VERIFY');
    // Escalate is terminal for the survey however the module reached it (SS-02 closure): the new outcome's survey route is
    // governed — set to end the call with Escalate, never left to choose — and this ordinary (non-mandatory) escalation ends the call
    const inst = guided.surveys.find((x) => x.id === d.id)!.sequence.find((x) => x.id === 'mi-general-verification')!;
    expect(inst.routes.ESCALATE).toEqual({ surveyOutcome: 'ESCALATE' });
    expect(viaGuided.terminal).toEqual({ state: 'ENDED_WITH_OUTCOME', surveyOutcome: 'ESCALATE' });
    expect(validateSurvey(guided, guided.surveys.find((x) => x.id === d.id)!).filter((i) => !i.where.moduleKey)).toEqual([]);
    // and the survey cannot route it anywhere else: every other mapping is rejected, and never followed
    for (const target of ['@CONTINUE', { instance: 'mi-closing' }, { surveyOutcome: 'COMPLETED' }, { surveyOutcome: 'UNABLE_TO_VERIFY' }] as SurveyTarget[]) {
      const bad = setRoute(guided, d.id, 'mi-general-verification', 'ESCALATE', target);
      const sv = bad.surveys.find((x) => x.id === d.id)!;
      expect(validateSurvey(bad, sv).filter((i) => i.where.part === 'escalation').map((i) => i.message)).toEqual(['General verification: "Escalate" must end the call with "Escalate"']);
      expect(playback(bad, sv, p).terminal).toEqual({ state: 'ENDED_WITH_OUTCOME', surveyOutcome: 'ESCALATE' });
      expect(surveyRouteFor(sv, 'mi-general-verification', 'ESCALATE', 'mi-closing', bad)).toEqual({ problem: expect.stringMatching(/is an escalation: it can only end the call/) });
    }
  });
});

// ---- fixture schema /3 (SS-02C): activation and eligibility independent, a jump as an activation, the skip disposition
// in sequence, and a mandatory escalation that survey-level routing cannot override. No mapping: the engine's own words.
describe.skipIf(!existsSync(FIXTURES))('the SS-02C golden fixtures (schema /3), run through the simulator', () => {
  const files = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => /^H\d.*\.json$/.test(f)).sort() : [];
  const all = files.map((f) => JSON.parse(readFileSync(resolve(FIXTURES, f), 'utf8')));

  it('covers four fixtures and 16 expected runs, all schema /3', () => {
    expect(all.map((fx) => fx.fixture)).toEqual(['H1-activation-and-eligibility-are-independent', 'H2-a-jump-is-an-activation-but-never-bypasses-eligibility',
      'H3-skip-disposition-in-sequence', 'H4-mandatory-escalation-cannot-be-overridden-by-survey-routing']);
    expect(new Set(all.map((fx) => fx.schema))).toEqual(new Set(['call360.survey-studio.fixture/3']));
    expect(all.reduce((n, fx) => n + fx.expected_runs.length, 0)).toBe(16);
  });

  for (const fx of all) {
    it(`${fx.fixture} · authoring validation reports exactly the expected errors`, () => {
      const { ws, survey } = fromFixture(fx);
      const got = validateSurvey(ws, survey).filter((i) => !i.where.moduleKey).map((i) => ({
        code: i.where.part === 'mandatory' ? 'MANDATORY_ESCALATION_OVERRIDDEN' : i.where.on === '@SKIP' ? 'SKIP_DISPOSITION_MISSING' : i.message,
        at: i.where.part === 'mandatory' ? `${i.where.instanceId}:${i.where.on}` : i.where.instanceId,
      }));
      expect(got).toEqual(fx.validation.errors);
    });
    for (const run of fx.expected_runs) {
      it(`${fx.fixture} · ${run.name}`, () => {
        const { ws, survey } = fromFixture(fx);
        const r = simulate(ws, survey, run.profile ?? {}, (key) => run.answers[key] as SimAnswer | undefined);
        const exp = run.expect;
        expect(r.asked, 'asked').toEqual(exp.asked);
        expect(r.modules.map((m) => ({ instance: m.instance, status: m.status, ...(m.outcome ? { outcome: m.outcome } : {}) })), 'modules').toEqual(exp.modules);
        const t = r.terminal!;
        expect({ state: t.state, ...(t.surveyOutcome ? { survey_outcome: t.surveyOutcome } : {}), ...(t.reason ? { reason: t.reason } : {}), ...(t.at ? { at: t.at } : {}) }, 'terminal').toEqual(exp.terminal);
        expect(traceV2(r, true), 'trace').toEqual(exp.trace);
        expect(Object.fromEntries(r.answerLines.map((l) => [l.key, l.state])), 'evidence states').toEqual(exp.evidence_states);
        expect(r.pending).toBeNull();
      });
    }
  }

  it('the earlier ON_OUTCOME shape and the new activation shape mean the same thing', () => {
    const { ws, survey } = fromFixture(all[0]);
    const concern = survey.sequence.find((x) => x.id === 'mi-concern')!;
    expect(concern.entry.mode).toBe('ON_OUTCOME'); // read unchanged
    expect(activationOf(concern)).toEqual({ of: 'mi-afford', outcomes: ['CLARIFICATION_REQUIRED'] });
    // rewriting it in the new shape changes no journey
    const ws2 = setActivation(ws, survey.id, 'mi-concern', activationOf(concern));
    const s2 = ws2.surveys[0]!;
    expect(s2.sequence.find((x) => x.id === 'mi-concern')).toMatchObject({ entry: { mode: 'ALWAYS' }, activation: { of: 'mi-afford' } });
    for (const run of all[0].expected_runs) {
      const next = (key: string) => run.answers[key] as SimAnswer | undefined;
      expect(simulate(ws2, s2, run.profile ?? {}, next).events.map(eventSignature)).toEqual(simulate(ws, survey, run.profile ?? {}, next).events.map(eventSignature));
    }
  });

  it('setting eligibility keeps the trigger, and setting the trigger keeps eligibility: the two are independent', () => {
    const { ws, survey } = fromFixture(all[0]);
    const b = eligibilityOf(survey.sequence.find((x) => x.id === 'mi-specialist')!)!;
    // give the earlier-shape module an eligibility condition: its trigger must survive, now in the new shape
    const w1 = setEligibility(ws, survey.id, 'mi-concern', b);
    const c1 = w1.surveys[0]!.sequence.find((x) => x.id === 'mi-concern')!;
    expect(activationOf(c1)).toEqual({ of: 'mi-afford', outcomes: ['CLARIFICATION_REQUIRED'] });
    expect(eligibilityOf(c1)).toEqual(b);
    // remove the trigger: eligibility stays; remove eligibility: nothing is left but "always"
    const w2 = setActivation(w1, survey.id, 'mi-concern', null);
    const c2 = w2.surveys[0]!.sequence.find((x) => x.id === 'mi-concern')!;
    expect(activationOf(c2)).toBeNull();
    expect(eligibilityOf(c2)).toEqual(b);
    expect(setEligibility(w2, survey.id, 'mi-concern', null).surveys[0]!.sequence.find((x) => x.id === 'mi-concern')!.entry).toEqual({ mode: 'ALWAYS' });
  });

  it('a jump activates a module in the earlier ON_OUTCOME shape too (A-1)', () => {
    const { ws, survey } = fromFixture(all[1]);
    // jump from Affordability straight to the earlier-shape module, whose trigger (Benefits completed) cannot have fired
    const w = setRoute(ws, survey.id, 'mi-afford', 'CLARIFICATION_REQUIRED', { instance: 'mi-concern' });
    const r = simulate(w, w.surveys[0]!, { 'customer.age_years': 40 }, (key) => ({ 'mi-afford/n1': { choice: 'NO' }, 'mi-concern/n1': { choice: 'YES' }, 'mi-closing/n1': { choice: 'YES' } } as Record<string, SimAnswer>)[key]);
    expect(r.modules.find((m) => m.instance === 'mi-concern')).toMatchObject({ status: 'ACTIVATED', outcome: 'COMPLETED' });
    const entry = r.events.find((e) => e.kind === 'ENTRY' && e.instance === 'mi-concern') as Extract<SimEvent, { kind: 'ENTRY' }>;
    expect(entry.arrival).toBe('JUMP');
    expect(entry.why).toMatch(/selected by a jump.*an explicit jump also selects it.*no eligibility condition/);
  });

  it('a disposition in sequence may not lead backwards, and a removed destination becomes undecided — never re-pointed', () => {
    const { ws, survey } = fromFixture(all[2]);
    const back = setIfSkippedInSequence(ws, survey.id, 'mi-concern', { instance: 'mi-afford' });
    expect(validateSurvey(back, back.surveys[0]!).map((i) => i.message)).toContain('Concern note: "if it does not apply" leads backwards');
    expect(simulate(back, back.surveys[0]!, { 'customer.age_years': 65 }, () => ({ choice: 'YES' })).terminal).toMatchObject({ state: 'DRAFT_INVALID', reason: 'BACKWARD_ROUTE' });
    const gone = removeInstance(ws, survey.id, 'mi-closing');
    expect(gone.surveys[0]!.sequence.find((x) => x.id === 'mi-specialist')!.ifSkippedInSequence).toBeNull();
    expect(validateSurvey(gone, gone.surveys[0]!).some((i) => i.where.on === '@SKIP_SEQ')).toBe(true);
    expect(simulate(gone, gone.surveys[0]!, { 'customer.age_years': 40 }, () => ({ choice: 'YES' })).terminal).toMatchObject({ state: 'DRAFT_INVALID', reason: 'SKIP_DISPOSITION_MISSING' });
    // "continue" is the default, so choosing it stores nothing
    expect(setIfSkippedInSequence(ws, survey.id, 'mi-specialist', '@CONTINUE').surveys[0]!.sequence.find((x) => x.id === 'mi-specialist')).not.toHaveProperty('ifSkippedInSequence');
  });
});

// ---- A-4: a mandatory escalation across the whole survey --------------------------------------------------------------
describe('a mandatory escalation cannot be overridden by survey-level routing', () => {
  const [ws, id] = addDemoSurvey(sampleWorkspace());
  const sv = (w: Workspace) => w.surveys.find((x) => x.id === id)!;
  const esc = PROFILES.find((p) => p.id === 'ESCALATION')!;
  const clar = sv(ws).sequence.find((x) => x.module.code === 'M-CLARIFICATIONS')!;
  const m = findModule(ws, mKey(clar.module))!;

  it('knows which outcomes of a module are mandatory escalations', () => {
    expect(mandatoryOutcomes(ws, m)).toEqual(['ESCALATE']);
    expect(mandatoryOutcomes(ws, findModule(ws, 'M-GENERAL@1')!)).toEqual([]);
  });

  it('the demonstration survey is valid, and the mandatory answer ends the call as a mandatory escalation', () => {
    expect(validateSurvey(ws, sv(ws))).toEqual([]);
    expect(playback(ws, sv(ws), esc).terminal).toEqual({ state: 'MANDATORY_ESCALATION', surveyOutcome: 'ESCALATE' });
  });

  const wrong: Array<[string, SurveyTarget]> = [
    ['continue to the next module', '@CONTINUE'], ['jump to a later module', { instance: 'mi-closing' }],
    ['end as a normal completion', { surveyOutcome: 'COMPLETED' }], ['end as an exception', { surveyOutcome: 'UNABLE_TO_VERIFY' }], ['halt for review', { surveyOutcome: 'REVIEW_REQUIRED' }],
  ];
  for (const [what, target] of wrong) {
    it(`rejects a survey route that would ${what}, and never follows it`, () => {
      const bad = setRoute(ws, id, clar.id, 'ESCALATE', target);
      const issues = validateSurvey(bad, sv(bad)).filter((i) => i.where.part === 'mandatory' && !i.where.moduleKey);
      expect(issues.map((i) => i.message)).toEqual(['Clarifications: a mandatory escalation must end the call with "Escalate"']);
      const r = playback(bad, sv(bad), esc);
      expect(r.terminal).toEqual({ state: 'MANDATORY_ESCALATION', surveyOutcome: 'ESCALATE' });
      expect(r.modules.find((x) => x.name === 'Closing')!.status).toBe('NOT_REACHED');
      const route = r.events.find((e) => e.kind === 'SURVEY_ROUTE' && e.mandatory) as Extract<SimEvent, { kind: 'SURVEY_ROUTE' }>;
      expect(route).toMatchObject({ overridden: true });
      expect(route.why).toMatch(/Survey-level routing cannot override it/);
    });
  }

  it('the survey graph refuses the same connections, with the reason, and allows only the governed ending', () => {
    const s = sv(ws);
    expect(surveyRouteFor(s, clar.id, 'ESCALATE', 'mi-closing', ws)).toHaveProperty('problem');
    expect(surveyRouteFor(s, clar.id, 'ESCALATE', 'end:COMPLETED', ws)).toHaveProperty('problem');
    expect(surveyRouteFor(s, clar.id, 'ESCALATE', `sout:UNABLE_TO_VERIFY@${clar.id}`, ws)).toHaveProperty('problem');
    expect(surveyRouteFor(s, clar.id, 'ESCALATE', `sout:ESCALATE@${clar.id}`, ws)).toEqual({ target: { surveyOutcome: 'ESCALATE' } });
    // an ordinary outcome of the same module is routed freely
    expect(surveyRouteFor(s, clar.id, 'COMPLETED', 'mi-closing', ws)).toHaveProperty('target');
  });

  it('holds for rule-based routing: the rule that wins for a mandatory answer makes its outcome mandatory at survey level', () => {
    const fx = JSON.parse(readFileSync(resolve(FIXTURES, 'H4-mandatory-escalation-cannot-be-overridden-by-survey-routing.json'), 'utf8'));
    const { ws: w0, survey } = fromFixture(fx);
    // re-express the multi-select as first-matching rules: FORGED first -> Escalate
    const [w1, key] = deriveModule(w0, survey.id, 'mi-areas');
    let w = setMode(w1, key, 'n1', 'ORDERED_RULES');
    let rule = findModule(w, key)!.nodes.filter(isQuestion).find((n) => n.id === 'n1')!.routing.rules?.[0]?.id;
    if (!rule) [w, rule] = addRule(w, key, 'n1');
    w = updateRule(w, key, 'n1', rule, { kind: 'ANY', options: ['FORGED'], to: { outcome: 'ESCALATE' } });
    const mod = findModule(w, key)!;
    expect(mandatoryOutcomes(w, mod)).toEqual(['ESCALATE']);
    const r = simulate(w, w.surveys[0]!, {}, (k) => ({ 'mi-consent/n1': { choice: 'AGREED' }, 'mi-areas/n1': { choices: ['PREMIUM', 'FORGED'] } } as Record<string, SimAnswer>)[k]);
    expect(r.terminal).toEqual({ state: 'MANDATORY_ESCALATION', surveyOutcome: 'ESCALATE' });
  });
});

// ---- fixture schema /4 (SS-02 closure): Escalate is terminal however the module reached it ----------------------------------
describe.skipIf(!existsSync(FIXTURES))('the SS-02 closure golden fixture (schema /4), run through the simulator', () => {
  const files = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => /^J\d.*\.json$/.test(f)).sort() : [];
  const all = files.map((f) => JSON.parse(readFileSync(resolve(FIXTURES, f), 'utf8')));

  it('covers one fixture and 4 expected runs, schema /4', () => {
    expect(all.map((fx) => `${fx.fixture}|${fx.schema}|${fx.expected_runs.length}`)).toEqual(['J1-escalate-is-terminal-in-every-routing-mode|call360.survey-studio.fixture/4|4']);
  });
  for (const fx of all) {
    it(`${fx.fixture} · authoring validation rejects every survey route that would continue, jump on or re-label an escalation`, () => {
      const { ws, survey } = fromFixture(fx);
      const got = validateSurvey(ws, survey).filter((i) => !i.where.moduleKey).map((i) => ({ code: i.where.part === 'escalation' ? 'ESCALATION_NOT_TERMINAL' : i.message, at: `${i.where.instanceId}:${i.where.on}` }));
      expect(got).toEqual(fx.validation.errors);
    });
    for (const run of fx.expected_runs) {
      it(`${fx.fixture} · ${run.name}`, () => {
        const { ws, survey } = fromFixture(fx);
        const r = simulate(ws, survey, run.profile ?? {}, (key) => run.answers[key] as SimAnswer | undefined);
        const exp = run.expect;
        expect(r.asked, 'asked').toEqual(exp.asked);
        expect(r.modules.map((m) => ({ instance: m.instance, status: m.status, ...(m.outcome ? { outcome: m.outcome } : {}) })), 'modules').toEqual(exp.modules);
        const t = r.terminal!;
        expect({ state: t.state, ...(t.surveyOutcome ? { survey_outcome: t.surveyOutcome } : {}) }, 'terminal').toEqual(exp.terminal);
        expect(traceV2(r, true), 'trace').toEqual(exp.trace);
        expect(Object.fromEntries(r.answerLines.map((l) => [l.key, l.state])), 'evidence states').toEqual(exp.evidence_states);
        // the trace says why the configured route was not followed
        const route = r.events.find((e) => e.kind === 'SURVEY_ROUTE' && e.overridden) as Extract<SimEvent, { kind: 'SURVEY_ROUTE' }> | undefined;
        if (t.surveyOutcome === 'ESCALATE') expect(route?.why).toMatch(/an escalation always ends the call — however the module reached it/);
      });
    }
  }
});
