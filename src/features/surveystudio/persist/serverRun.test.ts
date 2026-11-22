// SS-03B.3 — the browser's engine against the authoritative Python engine, on all 82 golden runs and 14 golden plans.
// Both sides start from files the BACKEND generated: the canonical documents of each fixture, and what the Python engine
// produced for each expected run and plan (Call360-backend scripts/export_survey_python_results.py; the backend's own
// tests prove those results against the golden fixtures). This file holds no expected value: it runs the browser engine
// on the same documents and the same inputs, through the very comparison the Simulator screen shows, and requires that
// there is no difference. Where the browser engine is known to differ, the difference is named here, not hidden.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCallPlan } from '../model/plan';
import { simulateInputs, type SimAnswer } from '../model/sim';
import { comparePlans, compareRuns, describe as describeEvent, inputsOf, versionWorkspace, type PyPlan, type PyRun } from './serverRun';

const SPECS = resolve(__dirname, '../../../../../Call360-specs/docs/plans/survey-studio');
const DOCS = resolve(SPECS, 'canonical-documents');
const PY = resolve(SPECS, 'python-results');
/* eslint-disable @typescript-eslint/no-explicit-any */
const have = existsSync(DOCS) && existsSync(PY);
const files = have ? readdirSync(PY).filter((f) => f.endsWith('.python.json')).sort() : [];
const load = (f: string) => {
  const py = JSON.parse(readFileSync(resolve(PY, f), 'utf8'));
  const docs = JSON.parse(readFileSync(resolve(DOCS, f.replace('.python.json', '.documents.json')), 'utf8'));
  return { name: py.source_fixture as string, py, docs };
};

describe.skipIf(!have)('the browser engine agrees with the Python engine on the golden fixtures', () => {
  const all = files.map(load);
  const cases = all.flatMap((f) => f.py.runs.map((r: any) => ({ f, r })));
  const plans = all.flatMap((f) => f.py.plans.map((p: any) => ({ f, p })));

  it('covers the 82 runs and 14 plans of the 27 fixtures', () => {
    expect([all.length, cases.length, plans.length]).toEqual([27, 82, 14]);
  });

  for (const { f, r } of cases) {
    it(`${f.name.slice(0, 2)} · ${r.name}`, () => {
      const { ws, survey } = versionWorkspace(f.docs, { name: f.name, label: '1.0' });
      const ts = simulateInputs(ws, survey, r.facts, inputsOf(r.inputs) as SimAnswer[]);
      expect(compareRuns(r.run as PyRun, ts)).toEqual([]);
      // every event of the Python run can be put into words
      for (const e of (r.run as PyRun).events) expect(describeEvent(e, r.run as PyRun).title.length).toBeGreaterThan(0);
    });
  }

  for (const { f, p } of plans) {
    it(`${f.name.slice(0, 2)} · plan · ${p.name}`, () => {
      const { ws, survey } = versionWorkspace(f.docs, { name: f.name, label: '1.0' });
      expect(comparePlans(p.plan as PyPlan, buildCallPlan(ws, survey, p.facts))).toEqual([]);
    });
  }
});

describe('a difference between the two engines is reported, never hidden', () => {
  const have1 = have && files.length > 0;
  it.skipIf(!have1)('names each thing that differs, with both values', () => {
    const f = load(files.find((x) => x.startsWith('K3'))!);
    const r = f.py.runs[0];
    const { ws, survey } = versionWorkspace(f.docs, { name: f.name, label: '1.0' });
    const ts = simulateInputs(ws, survey, r.facts, inputsOf(r.inputs) as SimAnswer[]);
    const py: PyRun = JSON.parse(JSON.stringify(r.run));
    py.asked = py.asked.slice(0, -1);
    py.delivered[0]!.text = `${py.delivered[0]!.text} (changed)`;
    py.modules[0]!.status = 'SKIPPED_FALSE';
    const d = compareRuns(py, ts);
    expect(d.map((x) => x.what)).toEqual(['Questions answered, in order', 'Modules: which ran, which were skipped, and their outcomes', 'Everything delivered, with its exact wording']);
    for (const x of d) { expect(x.server).not.toBe(x.browser); expect(x.server.length).toBeGreaterThan(0); }
  });
  it.skipIf(!have1)('does the same for a plan', () => {
    const f = load(files.find((x) => x.startsWith('K8'))!);
    const p = f.py.plans[0];
    const { ws, survey } = versionWorkspace(f.docs, { name: f.name, label: '1.0' });
    const py: PyPlan = JSON.parse(JSON.stringify(p.plan));
    py.status = py.status === 'READY' ? 'BLOCKED' : 'READY';
    py.modules[0]!.status = 'HALTS';
    expect(comparePlans(py, buildCallPlan(ws, survey, p.facts)).map((x) => x.what)).toEqual(['Whether a plan can be computed', 'Modules included, excluded, conditional or undecidable']);
  });
});
