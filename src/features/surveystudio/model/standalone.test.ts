// LIB-2 — a module authored on its own: the fixed frame the editor keeps, and the next revision of a frozen module.
import { describe, expect, it } from 'vitest';
import { toDocuments } from './documents';
import { keepFrame, startNextRevision, workingModule } from './standalone';
import type { Module, Workspace } from './types';

const mod = (over: Partial<Module> = {}): Module => ({ code: 'M-100001', revision: 1, name: 'Affordability', kind: 'COMMON', intent: 'Checks the premium is affordable', published: false, entry: null, outcomes: ['COMPLETED', 'CLARIFICATION_REQUIRED'], nodes: [], edges: [], ...over });
const ws = (m: Module, routes: Record<string, unknown> = {}, more: Partial<Workspace> = {}): Workspace => ({
  questions: [], conditions: [], modules: [m], seq: 1,
  surveys: [{ id: m.code, name: 'old name', purpose: '', versionLabel: '0.1', createdAt: 1, sequence: [{ id: 'module', module: { code: m.code, revision: m.revision }, entry: { mode: 'ALWAYS' }, routes: routes as never }] }], ...more,
});

describe('a standalone module keeps its fixed frame', () => {
  it('every ending of the module ends the run as itself, and the definition is named after the module', () => {
    const framed = keepFrame(ws(mod(), { COMPLETED: '@CONTINUE', CLARIFICATION_REQUIRED: null }));
    const s = framed.surveys[0]!;
    expect(s.sequence).toHaveLength(1);
    expect(s.sequence[0]!.routes).toEqual({ COMPLETED: { surveyOutcome: 'COMPLETED' }, CLARIFICATION_REQUIRED: { surveyOutcome: 'CLARIFICATION_REQUIRED' } });
    expect([s.name, s.purpose]).toEqual(['Affordability', 'Checks the premium is affordable']);
    // exactly the content the server requires of a standalone module
    expect(toDocuments(framed, s).content).toEqual({ schema: 'call360.survey.content/1', code: 'M-100001', sequence: [{ instance: 'module', module: { code: 'M-100001', revision: 1 }, routes: { COMPLETED: { survey_outcome: 'COMPLETED' }, CLARIFICATION_REQUIRED: { survey_outcome: 'CLARIFICATION_REQUIRED' } } }] });
  });
  it('returns the same workspace when nothing needs changing, so an edit that changes nothing is not an edit', () => {
    const framed = keepFrame(ws(mod()));
    expect(keepFrame(framed)).toBe(framed);
  });
  it('drops an ending the module no longer has, and anything an author could not have chosen', () => {
    const w = ws(mod({ outcomes: ['COMPLETED'] }), { COMPLETED: { surveyOutcome: 'COMPLETED' }, ESCALATE: { surveyOutcome: 'ESCALATE' } });
    w.surveys[0]!.sequence[0]!.ifSkippedInSequence = '@CONTINUE';
    const inst = keepFrame(w).surveys[0]!.sequence[0]!;
    expect(inst.routes).toEqual({ COMPLETED: { surveyOutcome: 'COMPLETED' } });
    expect(inst.ifSkippedInSequence).toBeUndefined();
  });
});

describe('the next revision of a standalone module', () => {
  it('copies a frozen revision one revision on, holds it in the draft, and leaves the frozen one exactly as it was', () => {
    const frozen = mod({ published: true });
    const before = keepFrame(ws(frozen));
    const after = startNextRevision(before);
    expect(after.modules.map((m) => [m.revision, m.published])).toEqual([[1, true], [2, false]]);
    expect(after.modules[0]).toEqual(before.modules[0]);
    expect(workingModule(after)).toMatchObject({ code: 'M-100001', revision: 2, published: false, name: 'Affordability' });
    expect(after.surveys[0]!.sequence[0]!.module).toEqual({ code: 'M-100001', revision: 2 });
  });
  it('does nothing while the working revision can still be edited', () => {
    const w = keepFrame(ws(mod()));
    expect(startNextRevision(w)).toBe(w);
  });
});
