// UC-02 — the schema /5 golden fixtures (K1–K8), run through the prototype's engine, validator and call-plan builder.
// The expectations were written by hand and are verified independently by a Python reference interpreter
// (Call360-specs …/fixtures/reference_interpreter_v5.py) that shares no code with this prototype. This file only
// TRANSLATES the fixture's shape into the prototype's model and back; it contains no behaviour and no expected values.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateModule } from './flow';
import { buildCallPlan } from './plan';
import { FIELDS } from './sample';
import { simulate, type SimAnswer, type SimResult } from './sim';
import type { Condition, Entry, Module, ModuleNode, Question, Survey, SurveyTarget, Workspace } from './types';

const FIXTURES = resolve(__dirname, '../../../../../Call360-specs/docs/plans/survey-studio/fixtures');
/* eslint-disable @typescript-eslint/no-explicit-any */

function fromFixture5(fx: any): { ws: Workspace; survey: Survey } {
  const lib = fx.library;
  const sets = new Map<string, any>(lib.option_sets.map((s: any) => [s.code, s]));
  const questions: Question[] = lib.items.map((i: any) => {
    const wd = lib.wordings.find((w: any) => w.item === i.code);
    return {
      code: i.code, version: i.version, answerType: i.answer_type, intent: i.intent, published: true,
      options: (i.option_set ? sets.get(i.option_set.code).options : []).map((o: any) => ({ code: o.code, label: o.label })),
      ...(i.number_rule ? { numberRule: i.number_rule } : {}), ...(i.statement_role ? { statement: i.statement_role } : {}),
      ...(i.mandatory ? { mandatory: true } : {}), ...(i.role ? { role: i.role } : {}),
      wording: { version: wd.wording_version, text: wd.text, approval: 'SYNTHETIC_UNAPPROVED', ...(wd.delivery_mode !== 'CONTROLLED_TTS' ? { delivery: wd.delivery_mode } : {}) },
    } as Question;
  });
  const modules: Module[] = lib.modules.map((m: any) => ({
    code: m.code, revision: m.revision, name: m.name, kind: 'COMMON', intent: '', published: true, entry: m.entry, outcomes: m.outcomes,
    nodes: m.nodes.map((n: any): ModuleNode => ({ id: n.node, type: n.type, q: { code: n.item.code, version: n.item.version }, routing: { mode: n.routing.mode, ...(n.routing.mode === 'PER_CHOICE' ? { normal: 'YES' } : {}) } })),
    edges: m.edges.map((e: any) => ({ id: e.edge, from: e.from, on: e.on, to: e.to })),
  }));
  const conditions: Condition[] = lib.conditions.map((c: any) => ({ code: c.code, version: c.version, name: c.name, ast: c.ast, shared: true, params: Object.fromEntries(Object.entries(c.params ?? {}).map(([k, v]: [string, any]) => [k, { type: v.type, unit: v.unit, label: k }])) }));
  const st = (t: any): SurveyTarget => (t === '@CONTINUE' ? '@CONTINUE' : { surveyOutcome: t.survey_outcome });
  const sv = fx.survey;
  const survey: Survey = {
    id: sv.code, name: sv.code, purpose: '', versionLabel: sv.version_label, createdAt: 1,
    sequence: sv.sequence.map((name: string) => {
      const i = sv.instances.find((x: any) => x.instance === name);
      const entry: Entry = i.entry.mode === 'RULE' ? { mode: 'RULE', binding: { condition: i.entry.binding.condition, params: i.entry.binding.params ?? {}, unknownPolicy: i.entry.binding.unknown_policy } } : { mode: 'ALWAYS' };
      return { id: i.instance, module: i.module, entry, routes: Object.fromEntries(i.routes.map((r: any) => [r.on, st(r.to)])) };
    }),
  };
  return { ws: { questions, conditions, modules, surveys: [survey], seq: 1 }, survey };
}

const values = (vs: Array<{ variable: string; value: string | null; state: string }>) => vs.map((v) => ({ variable: v.variable, value: v.value, state: v.state }));
const fxTarget = (t: any) => (t === null || t === undefined ? null : t === '@CONTINUE' ? '@CONTINUE' : 'surveyOutcome' in t ? { survey_outcome: t.surveyOutcome } : t);

/** The engine's result in the fixture's vocabulary. */
function runInFixtureTerms(r: SimResult) {
  const t = r.terminal;
  return {
    asked: r.asked,
    delivered: r.deliveries.map((d) => ({ key: d.item_instance, item: d.item, statement: d.statement, wording_version: d.wording_version, delivery_mode: d.delivery, text: d.text, values: values(d.values) })),
    rejections: r.events.flatMap((e) => (e.kind === 'REJECT' ? [{ at: e.key, error: e.code }] : [])),
    modules: r.modules.map((m) => ({ instance: m.instance, status: m.status, ...(m.outcome ? { outcome: m.outcome } : {}) })),
    terminal: t ? { state: t.state, ...(t.surveyOutcome ? { survey_outcome: t.surveyOutcome } : {}), ...(t.reason ? { reason: t.reason } : {}), ...(t.at ? { at: t.at } : {}) } : null,
    pending: r.pending?.key ?? null,
    evidence_states: Object.fromEntries(r.answerLines.map((l) => [l.key, l.state])),
  };
}

function planInFixtureTerms(ws: Workspace, survey: Survey, facts: any) {
  const p = buildCallPlan(ws, survey, facts);
  return {
    status: p.status,
    issues: p.issues.map((i) => ({ code: i.code, at: i.at })).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0)), // by place, then code — plain code-point order
    inputs: Object.fromEntries(p.inputs.map((i) => [i.code, i.state])),
    modules: p.modules.map((m) => ({ instance: m.instance, status: m.status })),
    items: Object.fromEntries(p.modules.flatMap((m) => m.items).map((i) => [i.key, { statement: i.statement, role: i.role, mandatory: i.mandatory, delivery_mode: i.delivery, wording_version: i.wordingVersion, text: i.text, values: values(i.values), certainty: i.certainty }])),
    open: Object.fromEntries(p.modules.flatMap((m) => m.open).map((o) => [o.key, { kind: o.kind, alternatives: o.alternatives.map((a) => ({ on: a.on, to: fxTarget(a.to) })) }])),
  };
}

const drive = (ws: Workspace, survey: Survey, run: any): SimResult => {
  const bad = new Map<string, any[]>();
  for (const b of run.rejected ?? []) bad.set(b.at, [...(bad.get(b.at) ?? []), b]);
  return simulate(ws, survey, run.facts ?? {}, (key, attempt) => {
    const refused = bad.get(key) ?? [];
    return (attempt < refused.length ? refused[attempt].answer : attempt === refused.length ? run.answers[key] : undefined) as SimAnswer | undefined;
  });
};

describe.skipIf(!existsSync(FIXTURES))('the schema /5 golden fixtures (K1–K8), run through the prototype', () => {
  const files = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => /^K\d.*\.json$/.test(f)).sort() : [];
  const all = files.map((f) => JSON.parse(readFileSync(resolve(FIXTURES, f), 'utf8')));

  it('covers eight fixtures: 19 expected runs, 14 expected plans, 12 expected validation errors, 10 rejected answers', () => {
    expect(new Set(all.map((fx) => fx.schema))).toEqual(new Set(['call360.survey-studio.fixture/5']));
    expect(all).toHaveLength(8);
    expect(all.reduce((n, fx) => n + fx.expected_runs.length, 0)).toBe(19);
    expect(all.reduce((n, fx) => n + fx.expected_plans.length, 0)).toBe(14);
    expect(all.reduce((n, fx) => n + fx.validation.errors.length, 0)).toBe(12);
    expect(all.reduce((n, fx) => n + fx.expected_runs.reduce((k: number, r: any) => k + (r.rejected ?? []).length, 0), 0)).toBe(10);
  });

  it('uses only fields the prototype catalog defines in the same way', () => {
    for (const fx of all) for (const [code, f] of Object.entries(fx.catalog.fields) as Array<[string, any]>) {
      const mine = FIELDS.find((x) => x.code === code);
      expect(mine, code).toBeDefined();
      expect({ type: mine!.type, unit: mine!.unit, values: mine!.values }, code).toEqual({ type: f.type, unit: f.unit, values: f.values });
    }
  });

  for (const fx of all) {
    it(`${fx.fixture} · validation`, () => {
      const { ws } = fromFixture5(fx);
      const got = ws.modules.flatMap((m) => validateModule(ws, m).filter((i) => i.code).map((i) => ({ code: i.code, at: `${m.code}/${i.where.nodeId}` })));
      expect(got).toEqual(fx.validation.errors);
    });
    for (const p of fx.expected_plans) {
      it(`${fx.fixture} · plan · ${p.name}`, () => {
        const { ws, survey } = fromFixture5(fx);
        expect(planInFixtureTerms(ws, survey, p.facts ?? {})).toEqual(p.expect);
      });
    }
    for (const run of fx.expected_runs) {
      it(`${fx.fixture} · run · ${run.name}`, () => {
        const { ws, survey } = fromFixture5(fx);
        const r = drive(ws, survey, run);
        expect(runInFixtureTerms(r)).toEqual(run.expect);
        // plan and run agree: whatever is delivered is delivered with exactly the text the plan settled for that item
        const planned = planInFixtureTerms(ws, survey, run.facts ?? {}).items;
        for (const d of r.deliveries) { expect(planned[d.item_instance]!.text, d.item_instance).toBe(d.text); expect(planned[d.item_instance]!.values).toEqual(values(d.values)); }
        // determinism: the same model, facts and answers give the same result again
        expect(runInFixtureTerms(drive(ws, survey, run))).toEqual(run.expect);
      });
    }
  }
});
