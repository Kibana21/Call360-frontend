// Survey Studio (LIB-1) — the reusable component library, as pure functions on the one Workspace.
//  * bringIn: put a PUBLISHED component (and exactly the published versions it depends on) into the workspace, locked.
//    Nothing is copied or rewritten: the workspace then holds the same immutable versions, by the same identities.
//  * identitiesToIssue / recode: before a Save, every identity the editor made up is replaced by a code the SERVER
//    issued. The editor's own numbering is temporary and never becomes a permanent reference. A local copy of another
//    survey's component gets a code of its own, starts again at version 1, and records where it came from.
// There is no second model here: components arrive as canonical documents and pass through the one mapping.
import { assetKey, fromDocuments, toDocuments, type AssetDoc, type AssetKind, type DocumentSet } from './documents';
import type { Binding, Entry, Module, Option, Provenance, Question, Workspace } from './types';

const NO_SURVEY = { name: '', purpose: '', versionLabel: '' };
const k2 = (code: string, version: number) => `${code}@${version}`;

/** The Workspace entities of a set of published documents, all locked. */
export function entitiesOf(assets: AssetDoc[]): Pick<Workspace, 'questions' | 'conditions' | 'modules'> {
  const ws = fromDocuments({ content: { schema: 'call360.survey.content/1', code: '-', sequence: [] }, assets }, { meta: NO_SURVEY, frozen: new Set(assets.map(assetKey)) });
  return { questions: ws.questions, conditions: ws.conditions, modules: ws.modules };
}

/**
 * The workspace with a published component brought in. What is already there (the same code and version) is left as
 * it is. Returns also the documents that were added, in the editor's own form, so the save logic knows the server
 * already has them and never sends them.
 */
export function bringIn(ws: Workspace, assets: AssetDoc[]): { ws: Workspace; added: AssetDoc[] } {
  const e = entitiesOf(assets);
  const haveQ = new Set(ws.questions.map((q) => k2(q.code, q.version)));
  const haveC = new Set(ws.conditions.map((c) => k2(c.code, c.version)));
  const haveM = new Set(ws.modules.map((m) => k2(m.code, m.revision)));
  const questions = e.questions.filter((q) => !haveQ.has(k2(q.code, q.version)));
  const conditions = e.conditions.filter((c) => !haveC.has(k2(c.code, c.version)));
  const modules = e.modules.filter((m) => !haveM.has(k2(m.code, m.revision)));
  const next: Workspace = { ...ws, questions: [...ws.questions, ...questions], conditions: [...ws.conditions, ...conditions], modules: [...ws.modules, ...modules] };
  const before = new Set(toDocuments(ws, ws.surveys[0]!).assets.map(assetKey));
  return { ws: next, added: toDocuments(next, next.surveys[0]!).assets.filter((a) => !before.has(assetKey(a))) };
}

/** Use a published option set for one draft question: its answers become exactly the published ones, by reference. */
export function applyOptionSet(ws: Workspace, question: { code: string; version: number }, set: { code: string; version: number }, options: Option[]): Workspace {
  return { ...ws, questions: ws.questions.map((q) => (q.code === question.code && q.version === question.version && !q.published ? { ...q, options: options.map((o) => ({ ...o })), optionSet: { code: set.code, version: set.version } } : q)) };
}

// ---- server-issued identity -----------------------------------------------------------------------------------------
export type CodeKind = 'MODULE' | 'ITEM' | 'STATEMENT' | 'CONDITION' | 'OPTION_SET';
export interface Lineage {
  /** Every asset the server already has for this survey's editor: its key and whether THIS survey owns it. */
  known: ReadonlyMap<string, { owned: boolean }>;
  /** Codes the server issued to this survey in this session (`KIND:code`), saved or not: never asked for again. */
  issued?: ReadonlySet<string>;
}
interface Need { kind: 'MODULE' | 'ITEM' | 'CONDITION'; ask: CodeKind; code: string; version: number; foreign: boolean }

const lineageOwned = (l: Lineage, kind: AssetKind, code: string): 'none' | 'owned' | 'foreign' => {
  let seen = false;
  for (const [key, v] of l.known) if (key.startsWith(`${kind}:${code}@`)) { if (v.owned) return 'owned'; seen = true; }
  return seen ? 'foreign' : 'none';
};

/**
 * The modules, questions and conditions whose identity the server has never issued: brand-new ones (the editor's own
 * temporary code) and local copies of another survey's component (which may not add a version to that survey's code).
 * A new version of something this survey already owns keeps its code and needs nothing.
 */
export function identitiesToIssue(ws: Workspace, l: Lineage): Need[] {
  const out: Need[] = [];
  const consider = (kind: Need['kind'], ask: CodeKind, code: string, version: number) => {
    if (l.known.has(`${kind}:${code}@${version}`) || l.issued?.has(`${kind}:${code}`)) return;
    const own = lineageOwned(l, kind, code);
    if (own !== 'owned') out.push({ kind, ask, code, version, foreign: own === 'foreign' });
  };
  for (const m of ws.modules) if (!m.published) consider('MODULE', 'MODULE', m.code, m.revision);
  for (const q of ws.questions) if (!q.published) consider('ITEM', q.answerType === 'STATEMENT' ? 'STATEMENT' : 'ITEM', q.code, q.version);
  for (const c of ws.conditions) consider('CONDITION', 'CONDITION', c.code, c.version);
  return out;
}

/** How many codes of each kind to ask the server for. Brand-new versions of one temporary code share one new code. */
export function codesNeeded(needs: Need[]): Array<{ kind: CodeKind; count: number; keys: string[] }> {
  const groups = new Map<CodeKind, string[]>();
  for (const n of needs) {
    const key = n.foreign ? `${n.kind}:${n.code}@${n.version}` : `${n.kind}:${n.code}`;
    const list = groups.get(n.ask) ?? [];
    if (!list.includes(key)) list.push(key);
    groups.set(n.ask, list);
  }
  return [...groups].map(([kind, keys]) => ({ kind, count: keys.length, keys }));
}

const sourceOf = (l: Lineage, kind: AssetKind, code: string, below: number): Provenance => {
  let best = 0;
  for (const key of l.known.keys()) if (key.startsWith(`${kind}:${code}@`)) { const v = Number(key.slice(key.lastIndexOf('@') + 1)); if (v < below && v > best) best = v; }
  return { code, version: best || below - 1 || 1 };
};

/**
 * The workspace with every un-issued identity replaced by its server-issued code, consistently, everywhere it is
 * referred to. `issued` maps the keys of `codesNeeded` to the codes the server returned. A copy of a foreign component
 * starts at version 1 and records its source; everything else keeps its version. Instance, node, edge and rule
 * identities are local to a survey or module and are never changed.
 */
export function recode(ws: Workspace, needs: Need[], issued: ReadonlyMap<string, string>, l: Lineage): Workspace {
  type Ref = { code: string; version: number; from?: Provenance };
  const map = new Map<string, Ref>(); // `${kind}:${code}@${version}` -> new identity
  for (const n of needs) {
    const code = issued.get(n.foreign ? `${n.kind}:${n.code}@${n.version}` : `${n.kind}:${n.code}`);
    if (!code) throw new Error(`No code was issued for ${n.kind} ${n.code}`);
    map.set(`${n.kind}:${n.code}@${n.version}`, n.foreign ? { code, version: 1, from: sourceOf(l, n.kind, n.code, n.version) } : { code, version: n.version });
  }
  const item = (r: { code: string; version: number }) => { const t = map.get(`ITEM:${r.code}@${r.version}`); return t ? { code: t.code, version: t.version } : r; };
  const cond = (r: { code: string; version: number }) => { const t = map.get(`CONDITION:${r.code}@${r.version}`); return t ? { code: t.code, version: t.version } : r; };
  const mod = (r: { code: string; revision: number }) => { const t = map.get(`MODULE:${r.code}@${r.revision}`); return t ? { code: t.code, revision: t.version } : r; };
  const binding = (b: Binding): Binding => ({ ...b, condition: cond(b.condition) });
  const entry = (e: Entry): Entry => (e.mode === 'RULE' ? { ...e, binding: binding(e.binding) } : e);

  const questions = ws.questions.map((q): Question => {
    const t = map.get(`ITEM:${q.code}@${q.version}`);
    if (!t) return q;
    // a copy starts its own history: version 1, wording version 1
    return { ...q, code: t.code, version: t.version, ...(t.from ? { wording: { ...q.wording, version: 1 }, derivedFrom: { ...t.from } } : {}) };
  });
  const conditions = ws.conditions.map((c) => {
    const t = map.get(`CONDITION:${c.code}@${c.version}`);
    const inputs = c.inputs ? Object.fromEntries(Object.entries(c.inputs).map(([k, d]) => [k, { ...d, question: item(d.question) }])) : undefined;
    return { ...c, ...(inputs ? { inputs } : {}), ...(t ? { code: t.code, version: t.version, ...(t.from ? { derivedFrom: { ...t.from } } : {}) } : {}) };
  });
  const modules = ws.modules.map((m): Module => {
    const t = map.get(`MODULE:${m.code}@${m.revision}`);
    const nodes = m.published ? m.nodes : m.nodes.map((n) => (n.type === 'DECISION' ? { ...n, binding: n.binding ? binding(n.binding) : null } : { ...n, q: item(n.q) }));
    return { ...m, nodes, ...(m.defaultEntry && !m.published ? { defaultEntry: entry(m.defaultEntry) } : {}), ...(t ? { code: t.code, revision: t.version, ...(t.from ? { derivedFrom: { ...t.from } } : {}) } : {}) };
  });
  const surveys = ws.surveys.map((s) => ({ ...s, sequence: s.sequence.map((i) => ({ ...i, module: mod(i.module), entry: entry(i.entry) })) }));
  return { ...ws, questions, conditions, modules, surveys };
}

/**
 * The option sets the workspace would save under a name the server never issued: a question's own answers. Returns, for
 * each such set, the questions that hold it; `withOptionSetCodes` then gives them the issued code.
 */
export function optionSetsToIssue(ws: Workspace, l: Lineage): Array<{ key: string; questions: Array<{ code: string; version: number }> }> {
  const docs: DocumentSet = toDocuments(ws, ws.surveys[0]!);
  const out: Array<{ key: string; questions: Array<{ code: string; version: number }> }> = [];
  for (const a of docs.assets) {
    if (a.kind !== 'OPTION_SET' || l.known.has(assetKey(a)) || l.issued?.has(`OPTION_SET:${a.code}`) || lineageOwned(l, 'OPTION_SET', a.code) === 'owned') continue;
    const holders = docs.assets.filter((x) => x.kind === 'ITEM' && (x.document as { option_set?: { code: string; version: number } }).option_set?.code === a.code && (x.document as { option_set?: { version: number } }).option_set?.version === a.version)
      .map((x) => ({ code: x.code, version: x.version }));
    out.push({ key: assetKey(a), questions: holders });
  }
  return out;
}
export function withOptionSetCodes(ws: Workspace, sets: ReturnType<typeof optionSetsToIssue>, codes: string[]): Workspace {
  const of = new Map<string, string>();
  sets.forEach((s, i) => { for (const q of s.questions) of.set(k2(q.code, q.version), codes[i]!); });
  return { ...ws, questions: ws.questions.map((q) => (of.has(k2(q.code, q.version)) && !q.published ? { ...q, optionSet: { code: of.get(k2(q.code, q.version))!, version: 1 } } : q)) };
}
