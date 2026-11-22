// LIB-1 — bringing published components into the workspace, and replacing every identity the editor made up with one
// the server issued. Pure functions: no browser, no server. The server's side is tests/test_survey_lib1.py; the two
// together are exercised by the full-stack journey e2e/persisted/lib1.persisted.ts.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonical } from './canonical';
import { assetKey, changes, fromDocuments, isEmpty, stable, toDocuments, type AssetDoc, type DocumentSet } from './documents';
import { applyOptionSet, bringIn, codesNeeded, entitiesOf, identitiesToIssue, optionSetsToIssue, recode, withOptionSetCodes, type Lineage } from './library';
import { addInstance, createBlankModule, deriveModule, forkQuestion, insertQuestion, newQuestionVersion, saveCondition, updateQuestion } from './ops';
import type { Workspace } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = resolve(__dirname, '../../../../../Call360-specs/docs/plans/survey-studio/canonical-documents');
const fixture = (prefix: string): AssetDoc[] => JSON.parse(readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith(prefix))!), 'utf8')).assets.map((a: any) => ({ kind: a.kind, code: a.code, version: a.version, document: a.document }));
const empty = (): Workspace => fromDocuments({ content: { schema: 'call360.survey.content/1', code: 'S-B', sequence: [] }, assets: [] }, { meta: { name: 'B', purpose: '', versionLabel: '0.1' }, seq: 900 });
const lineageOf = (known: AssetDoc[], owned: boolean, extra: AssetDoc[] = []): Lineage => ({ known: new Map([...known.map((a) => [assetKey(a), { owned }] as const), ...extra.map((a) => [assetKey(a), { owned: true }] as const)]) });
const docs = (ws: Workspace): DocumentSet => toDocuments(ws, ws.surveys[0]!);
const codes = (set: DocumentSet, kind: string) => set.assets.filter((a) => a.kind === kind).map((a) => `${a.code}@${a.version}`).sort();

describe.skipIf(!existsSync(DIR))('bringing a published component into a survey', () => {
  it('adds exactly the published versions, locked, and the editor has nothing to save for them', () => {
    const published = fixture('K7');
    const { ws, added } = bringIn(empty(), published);
    expect(ws.modules.length).toBeGreaterThan(0);
    expect(ws.modules.every((m) => m.published) && ws.questions.every((q) => q.published)).toBe(true);
    // what was added is exactly what was published: the same identities and the same documents
    expect(added.map(assetKey).sort()).toEqual(published.map(assetKey).sort());
    for (const a of added) expect(stable(a.document), assetKey(a)).toBe(stable(published.find((p) => assetKey(p) === assetKey(a))!.document));
    // with those documents known to the save logic, nothing is sent
    expect(isEmpty(changes({ content: docs(ws).content, assets: added }, docs(ws)))).toBe(true);
    // bringing the same thing in twice changes nothing
    const again = bringIn(ws, published);
    expect(again.added).toEqual([]);
    expect(canonical(again.ws)).toBe(canonical(ws));
  });

  it('placing a published module pins its exact revision and leaves it unchanged', () => {
    const published = fixture('K7');
    const { ws } = bringIn(empty(), published);
    const m = ws.modules[0]!;
    const [placed, instanceId] = addInstance(ws, 'S-B', 0, `${m.code}@${m.revision}`);
    const set = docs(placed);
    expect((set.content as any).sequence[0].module).toEqual({ code: m.code, revision: m.revision });
    expect(instanceId).toBeTruthy();
    for (const p of published) expect(stable(set.assets.find((a) => assetKey(a) === assetKey(p))!.document)).toBe(stable(p.document));
    // a published module cannot be edited in place
    expect(() => updateQuestion(placed, `${m.code}@${m.revision}`, m.nodes.find((n) => n.type !== 'DECISION')!.id, { intent: 'x' })).toThrow();
  });

  it('a published answer set is used by reference, and editing afterwards never touches it', () => {
    const published = fixture('K1');
    const os = published.find((a) => a.kind === 'OPTION_SET')!;
    let ws = empty();
    const [w1, made] = createBlankModule(ws, { name: 'Mine', kind: 'COMMON', intent: '', place: { surveyId: 'S-B', index: 0 } });
    const [w2] = insertQuestion(w1, made.moduleKey, { entry: true }, { type: 'YES_NO' });
    ws = w2;
    const q = ws.questions[0]!;
    const options = (os.document as any).options.map((o: any) => ({ code: o.code, label: o.label }));
    ws = applyOptionSet(ws, q, { code: os.code, version: os.version }, options);
    const set = docs(ws);
    expect((set.assets.find((a) => a.kind === 'ITEM')!.document as any).option_set).toEqual({ code: os.code, version: os.version });
    expect(stable(set.assets.find((a) => a.kind === 'OPTION_SET')!.document)).toBe(stable(os.document)); // exactly the published set
    expect(entitiesOf(published).questions.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!existsSync(DIR))('server-issued identity', () => {
  /** A survey with one module made in the editor: two questions and a condition, all under the editor's own numbering. */
  const authored = (): Workspace => {
    let ws = empty();
    const [w1, made] = createBlankModule(ws, { name: 'Payment', kind: 'PRODUCT', intent: 'why', place: { surveyId: 'S-B', index: 0 } });
    const [w2, n1] = insertQuestion(w1, made.moduleKey, { entry: true }, { type: 'YES_NO' });
    const [w3] = insertQuestion(w2, made.moduleKey, { from: n1, on: 'ANY' }, { type: 'STATEMENT' });
    const [w4] = saveCondition(w3, { name: 'High value', ast: { op: 'GTE', left: { field: 'policy.annual_premium' }, right: { param: 't' } }, params: { t: { type: 'MONEY', unit: 'SGD', label: 'Threshold' } }, shared: true });
    ws = w4;
    return ws;
  };

  it('everything the editor numbered itself is found, and asked for by kind', () => {
    const ws = authored();
    const needs = identitiesToIssue(ws, { known: new Map() });
    expect(needs.map((n) => n.ask).sort()).toEqual(['CONDITION', 'ITEM', 'MODULE', 'STATEMENT']);
    expect(needs.every((n) => !n.foreign)).toBe(true);
    expect(codesNeeded(needs).map((g) => [g.kind, g.count]).sort()).toEqual([['CONDITION', 1], ['ITEM', 1], ['MODULE', 1], ['STATEMENT', 1]]);
  });

  it('recode replaces them everywhere, consistently, and changes nothing else', () => {
    const ws = authored();
    const l: Lineage = { known: new Map() };
    const needs = identitiesToIssue(ws, l);
    const issued = new Map(codesNeeded(needs).flatMap((g) => g.keys.map((k, i) => [k, `${{ MODULE: 'M', ITEM: 'Q', STATEMENT: 'S', CONDITION: 'C', OPTION_SET: 'OS' }[g.kind]}-10000${i + 1}`] as const)));
    let next = recode(ws, needs, issued, l);
    const sets = optionSetsToIssue(next, l);
    expect(sets).toHaveLength(1); // the yes/no question's own answers
    next = withOptionSetCodes(next, sets, ['OS-100009']);
    const before = docs(ws), after = docs(next);
    // no temporary code survives anywhere in what would be saved
    const text = JSON.stringify(after);
    for (const a of before.assets) expect(text.includes(`"${a.code}"`), a.code).toBe(false);
    expect(codes(after, 'MODULE')).toEqual(['M-100001@1']);
    expect(codes(after, 'ITEM').sort()).toEqual(['Q-100001@1', 'S-100001@1']);
    expect(codes(after, 'CONDITION')).toEqual(['C-100001@1']);
    expect(codes(after, 'OPTION_SET')).toEqual(['OS-100009@1']);
    // the module still places the same two things, at the same nodes; the survey still pins the module; instance and node identities are unchanged
    const m = after.assets.find((a) => a.kind === 'MODULE')!.document as any, m0 = before.assets.find((a) => a.kind === 'MODULE')!.document as any;
    expect(m.nodes.map((n: any) => n.node)).toEqual(m0.nodes.map((n: any) => n.node));
    expect(m.nodes.map((n: any) => n.item.code).sort()).toEqual(['Q-100001', 'S-100001']);
    expect((after.content as any).sequence[0]).toMatchObject({ instance: (before.content as any).sequence[0].instance, module: { code: 'M-100001', revision: 1 } });
    expect(m.kind).toBe('PRODUCT');
    expect(m.authoring.intent).toBe('why');
    // asked once: with those codes recorded as issued, nothing more is needed
    const issuedSet = new Set(['MODULE:M-100001', 'ITEM:Q-100001', 'ITEM:S-100001', 'CONDITION:C-100001', 'OPTION_SET:OS-100009']);
    expect(identitiesToIssue(next, { known: new Map(), issued: issuedSet })).toEqual([]);
    expect(optionSetsToIssue(next, { known: new Map(), issued: issuedSet })).toEqual([]);
  });

  it('a new version of something this survey owns keeps its code', () => {
    const ws = authored();
    const saved = docs(ws).assets; // pretend all of it is saved and owned
    const m = ws.modules[0]!;
    const next = { ...ws, questions: ws.questions.map((q, i) => (i === 0 ? { ...q, published: true } : q)) };
    const v2 = newQuestionVersion(next, `${m.code}@${m.revision}`, m.nodes[0]!.id);
    expect(identitiesToIssue(v2, lineageOf(saved, true))).toEqual([]);
    expect(optionSetsToIssue(v2, lineageOf(saved, true))).toEqual([]);
  });

  it('a local copy of another survey\'s module gets its own identity, restarts at revision 1 and records its source', () => {
    const published = fixture('K7');
    const { ws: brought } = bringIn(empty(), published);
    const src = brought.modules[0]!;
    const [placed, instanceId] = addInstance(brought, 'S-B', 0, `${src.code}@${src.revision}`);
    const [copy] = deriveModule(placed, 'S-B', instanceId);
    const l = lineageOf(published, false);
    const needs = identitiesToIssue(copy, l);
    expect(needs).toEqual([{ kind: 'MODULE', ask: 'MODULE', code: src.code, version: src.revision + 1, foreign: true }]);
    const next = recode(copy, needs, new Map(codesNeeded(needs).flatMap((g) => g.keys.map((k) => [k, 'M-200001'] as const))), l);
    const after = docs(next);
    const mine = after.assets.find((a) => a.kind === 'MODULE' && a.code === 'M-200001')!;
    expect(mine.version).toBe(1);
    expect((mine.document as any).authoring.derived_from).toEqual({ code: src.code, version: src.revision });
    expect((after.content as any).sequence[0].module).toEqual({ code: 'M-200001', revision: 1 });
    // the published source is still there, untouched, and nothing adds a revision to its code
    expect(stable(after.assets.find((a) => a.kind === 'MODULE' && a.code === src.code)!.document)).toBe(stable(published.find((p) => p.kind === 'MODULE' && p.code === src.code && p.version === src.revision)!.document));
    expect(codes(after, 'MODULE').filter((c) => c.startsWith(`${src.code}@`))).toEqual([`${src.code}@${src.revision}`]);
    // it still pins the published questions: only the module was copied
    expect(codes(after, 'ITEM')).toEqual(published.filter((p) => p.kind === 'ITEM').map((p) => `${p.code}@${p.version}`).sort());
    expect(identitiesToIssue(next, { ...l, issued: new Set(['MODULE:M-200001']) })).toEqual([]);
  });

  it('changing a published question in a copy makes a question of the survey\'s own, with its own answers', () => {
    const published = fixture('K7');
    const { ws: brought } = bringIn(empty(), published);
    const src = brought.modules[0]!;
    const [placed, instanceId] = addInstance(brought, 'S-B', 0, `${src.code}@${src.revision}`);
    const [copy, key] = deriveModule(placed, 'S-B', instanceId);
    const node = copy.modules.find((m) => `${m.code}@${m.revision}` === key)!.nodes.find((n) => n.type !== 'DECISION')!;
    const edited = updateQuestion(newQuestionVersion(copy, key, node.id), key, node.id, { text: 'My own wording?' });
    const l = lineageOf(published, false);
    const needs = identitiesToIssue(edited, l);
    expect(needs.map((n) => [n.kind, n.foreign])).toEqual([['MODULE', true], ['ITEM', true]]);
    const issued = new Map(codesNeeded(needs).flatMap((g) => g.keys.map((k) => [k, g.kind === 'MODULE' ? 'M-300001' : 'Q-300001'] as const)));
    const next = recode(edited, needs, issued, l);
    const item = docs(next).assets.find((a) => a.kind === 'ITEM' && a.code === 'Q-300001')!;
    expect(item.version).toBe(1);
    expect((item.document as any).authoring.derived_from.code).toBe((node as any).q.code);
    const wording = docs(next).assets.find((a) => a.kind === 'WORDING' && a.code === 'Q-300001')!;
    expect([wording.version, (wording.document as any).text]).toEqual([1, 'My own wording?']);
    // the published question and its wording are exactly as published
    for (const p of published.filter((x) => x.kind === 'ITEM' || x.kind === 'WORDING')) expect(stable(docs(next).assets.find((a) => assetKey(a) === assetKey(p))!.document)).toBe(stable(p.document));
    void forkQuestion;
  });
});
