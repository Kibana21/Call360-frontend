// Survey Studio prototype — the operation vocabulary (SS-01 Part A §2, Part D §3).
// Every edit made in any view goes through one of these pure functions: (workspace, arguments) → new workspace.
// They never mutate their input, so undo/redo restores the canonical model itself, not a picture of it.
// Rules encoded here, not in components: safe insertion (the former destination is inherited only by the normal
// answer), no invented exceptional routes, and "a placement never edits a shared definition".
import { ALL_OUTCOMES } from './sample';
import {
  isQuestion, mKey, qKey,
  type AnswerType, type Condition, type Edge, type Entry, type Instance, type Interrupt, type InterruptClass, type InterruptPolicy, type Module, type ModuleKind, type ModuleNode,
  type Binding, type DecisionNode, type Option, type OutcomeCode, type Question, type QuestionNode, type RoutingMode, type SetRule, type Survey, type SurveyTarget,
  type Target, type TextRule, type Workspace,
} from './types';

const clone = <T,>(v: T): T => structuredClone(v);
const slug = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'UNTITLED';

export const findModule = (ws: Workspace, key: string) => ws.modules.find((m) => mKey(m) === key);
export const findQuestion = (ws: Workspace, ref: { code: string; version: number }) => ws.questions.find((q) => qKey(q) === qKey(ref));
export const findSurvey = (ws: Workspace, id: string) => ws.surveys.find((s) => s.id === id);
export const findCondition = (ws: Workspace, ref: { code: string; version: number }) =>
  ws.conditions.find((c) => c.code === ref.code && c.version === ref.version);

function mod(ws: Workspace, key: string): Module {
  const m = findModule(ws, key);
  if (!m) throw new Error(`Unknown module ${key}`);
  if (m.published) throw new Error(`${key} is a published version and cannot be edited`);
  return m;
}
function qNode(m: Module, id: string): QuestionNode {
  const n = m.nodes.find((x) => x.id === id);
  if (!n || !isQuestion(n)) throw new Error(`Unknown question ${id}`);
  return n;
}
function dNode(m: Module, id: string): DecisionNode {
  const n = m.nodes.find((x) => x.id === id);
  if (!n || isQuestion(n)) throw new Error(`Unknown decision ${id}`);
  return n;
}
/** The question nodes of a module (decisions ask nothing and have no answer routing of their own). */
export const questionNodes = (m: Module): QuestionNode[] => m.nodes.filter(isQuestion);

/**
 * Every place a node can lead to, whatever kind of route it is: edges, a follow-up rejoin, an interruption's
 * destination, first-matching rules and their fallback. One list, so reachability, loops, outcomes, merges and
 * deletes all see the same routes.
 */
export function routesFrom(m: Module, node: ModuleNode): Array<{ via: string; to: Target }> {
  const out: Array<{ via: string; to: Target }> = m.edges.filter((x) => x.from === node.id).map((x) => ({ via: x.on, to: x.to }));
  const r = isQuestion(node) ? node.routing : undefined;
  if (!r) return out;
  if (r.rejoin) out.push({ via: 'REJOIN', to: r.rejoin });
  for (const f of r.followups ?? []) for (const id of f.nodes) out.push({ via: `FOLLOWUP:${f.option}`, to: { node: id } });
  for (const i of r.interrupts ?? []) {
    for (const id of i.nodes ?? []) out.push({ via: `INTERRUPT:${i.option}`, to: { node: id } });
    if (i.policy === 'STOP_REJOIN' && i.rejoin) out.push({ via: `INTERRUPT:${i.option}`, to: i.rejoin });
    if (i.policy === 'STOP_ESCALATE' && i.outcome) out.push({ via: `INTERRUPT:${i.option}`, to: { outcome: i.outcome } });
  }
  for (const rule of r.rules ?? []) if (rule.to) out.push({ via: `RULE:${rule.id}`, to: rule.to });
  if (r.mode === 'ORDERED_RULES' && r.fallback) out.push({ via: 'FALLBACK', to: r.fallback });
  return out;
}
function draftQuestion(ws: Workspace, m: Module, nodeId: string): Question {
  const q = findQuestion(ws, qNode(m, nodeId).q);
  if (!q) throw new Error('Unknown question definition');
  if (q.published) throw new Error(`${qKey(q)} is a shared, approved definition: create a new version or a copy to change it`);
  return q;
}

/** The trigger a question uses when everybody continues to one destination. */
export const defaultOn = (t: AnswerType) => (t === 'FREE_TEXT' ? 'AFTER_CAPTURE' : 'ANY');
export const edgeOf = (m: Module, from: string, on: string) => m.edges.find((x) => x.from === from && x.on === on);
const nextEdgeId = (m: Module) => `e${Math.max(0, ...m.edges.map((x) => Number(x.id.slice(1)) || 0)) + 1}`;
const nextId = (m: Module, prefix: 'n' | 'd') => `${prefix}${Math.max(0, ...m.nodes.filter((x) => x.id.startsWith(prefix)).map((x) => Number(x.id.slice(1)) || 0)) + 1}`;
const nextNodeId = (m: Module) => nextId(m, 'n');

function setEdgeIn(m: Module, from: string, on: string, to: Target | null) {
  const existing = edgeOf(m, from, on);
  if (!to) { m.edges = m.edges.filter((x) => x !== existing); return; }
  if (existing) existing.to = to; else m.edges.push({ id: nextEdgeId(m), from, on, to });
}

/** REVIEW_REQUIRED is governed: the run halts pending an authorised review, so a survey never routes it anywhere else. */
const HALT: SurveyTarget = { surveyOutcome: 'REVIEW_REQUIRED' };

/** Declared outcomes are exactly the outcomes some route of the module can reach; survey instances follow. */
function syncOutcomes(ws: Workspace, m: Module) {
  const used = new Set<OutcomeCode>();
  for (const nd of m.nodes) for (const r of routesFrom(m, nd)) if ('outcome' in r.to) used.add(r.to.outcome);
  m.outcomes = ALL_OUTCOMES.filter((o) => used.has(o));
  for (const s of ws.surveys) for (const inst of s.sequence) {
    if (mKey(inst.module) !== mKey(m)) continue;
    const routes: Instance['routes'] = {};
    // a new exceptional outcome starts undecided; the normal one follows the normal sequence, as when a module is added
    for (const o of m.outcomes) routes[o] = o === 'REVIEW_REQUIRED' ? HALT : o in inst.routes ? inst.routes[o]! : o === 'COMPLETED' ? '@CONTINUE' : null;
    inst.routes = routes;
  }
}

/** Follow-up nodes exist only for their queue; drop the ones nothing refers to any more. */
function dropOrphanFollowups(m: Module) {
  const used = new Set<string>();
  for (const nd of questionNodes(m)) {
    for (const f of nd.routing.followups ?? []) f.nodes.forEach((x) => used.add(x));
    for (const i of nd.routing.interrupts ?? []) (i.nodes ?? []).forEach((x) => used.add(x));
  }
  const gone = questionNodes(m).filter((nd) => nd.role === 'FOLLOWUP' && !used.has(nd.id)).map((nd) => nd.id);
  if (!gone.length) return;
  m.nodes = m.nodes.filter((nd) => !gone.includes(nd.id));
  m.edges = m.edges.filter((x) => !gone.includes(x.from));
}

// ---- surveys ------------------------------------------------------------------------------------------------------
export function createSurvey(ws0: Workspace, a: { name: string; purpose: string; modules: string[] }): [Workspace, string] {
  let ws = clone(ws0);
  const id = `S-${slug(a.name)}-${ws.seq}`;
  ws.surveys.push({ id, name: a.name.trim(), purpose: a.purpose.trim(), versionLabel: '0.1', sequence: [], createdAt: ws.seq });
  ws.seq += 1;
  a.modules.forEach((code, i) => {
    const m = ws.modules.filter((x) => x.code === code && x.published).sort((x, y) => y.revision - x.revision)[0];
    if (m) ws = addInstance(ws, id, i, mKey(m))[0];
  });
  return [ws, id];
}

export function renameSurvey(ws0: Workspace, surveyId: string, name: string): Workspace {
  const ws = clone(ws0);
  const s = findSurvey(ws, surveyId)!;
  s.name = name;
  return ws;
}

/** Adds a module instance at `index`. The normal outcome continues; every other outcome is left undecided. */
export function addInstance(ws0: Workspace, surveyId: string, index: number, moduleKey: string): [Workspace, string] {
  const ws = clone(ws0);
  const s = findSurvey(ws, surveyId)!;
  const m = findModule(ws, moduleKey)!;
  const base = `mi-${slug(m.name).toLowerCase()}`;
  let id = base;
  for (let k = 2; s.sequence.some((x) => x.id === id); k++) id = `${base}-${k}`;
  const routes: Instance['routes'] = {};
  for (const o of m.outcomes) routes[o] = o === 'REVIEW_REQUIRED' ? HALT : o === 'COMPLETED' ? '@CONTINUE' : null;
  const inst: Instance = { id, module: { code: m.code, revision: m.revision }, entry: clone(m.defaultEntry ?? { mode: 'ALWAYS' }) as Entry, routes };
  s.sequence.splice(index, 0, inst);
  return [ws, id];
}

export function moveInstance(ws0: Workspace, surveyId: string, from: number, to: number): Workspace {
  const ws = clone(ws0);
  const seq = findSurvey(ws, surveyId)!.sequence;
  if (from === to || from < 0 || to < 0 || from >= seq.length || to >= seq.length) return ws0;
  const [it] = seq.splice(from, 1);
  seq.splice(to, 0, it!);
  return ws;
}

/** Removes an instance. Routes that pointed at it become undecided (never silently re-pointed). */
export function removeInstance(ws0: Workspace, surveyId: string, instanceId: string): Workspace {
  const ws = clone(ws0);
  const s = findSurvey(ws, surveyId)!;
  s.sequence = s.sequence.filter((x) => x.id !== instanceId);
  for (const inst of s.sequence) for (const [o, t] of Object.entries(inst.routes)) {
    if (t && typeof t === 'object' && 'instance' in t && t.instance === instanceId) inst.routes[o] = null;
  }
  return ws;
}

export function setEntry(ws0: Workspace, surveyId: string, instanceId: string, entry: Entry): Workspace {
  const ws = clone(ws0);
  findSurvey(ws, surveyId)!.sequence.find((x) => x.id === instanceId)!.entry = clone(entry);
  return ws;
}

export function setRoute(ws0: Workspace, surveyId: string, instanceId: string, outcome: string, target: SurveyTarget | null): Workspace {
  const ws = clone(ws0);
  findSurvey(ws, surveyId)!.sequence.find((x) => x.id === instanceId)!.routes[outcome] = target;
  return ws;
}

export function saveCondition(ws0: Workspace, c: Omit<Condition, 'code' | 'version'> & { code?: string }): [Workspace, Condition] {
  const ws = clone(ws0);
  const code = c.code ?? `C-${slug(c.name || 'RULE')}-${ws.seq}`;
  const version = Math.max(0, ...ws.conditions.filter((x) => x.code === code).map((x) => x.version)) + 1;
  const saved: Condition = { ...clone(c), code, version };
  ws.conditions.push(saved);
  ws.seq += 1;
  return [ws, saved];
}

// ---- modules ------------------------------------------------------------------------------------------------------
/** Copy-on-write: a draft revision of a published module, pinned by this one instance only. */
export function deriveModule(ws0: Workspace, surveyId: string, instanceId: string): [Workspace, string] {
  const ws = clone(ws0);
  const inst = findSurvey(ws, surveyId)!.sequence.find((x) => x.id === instanceId)!;
  const src = findModule(ws, mKey(inst.module))!;
  const revision = Math.max(...ws.modules.filter((x) => x.code === src.code).map((x) => x.revision)) + 1;
  const copy: Module = { ...clone(src), revision, published: false, derivedFor: surveyId };
  delete copy.defaultEntry;
  ws.modules.push(copy);
  inst.module = { code: copy.code, revision };
  return [ws, mKey(copy)];
}

export function createModule(ws0: Workspace, a: { name: string; kind: ModuleKind; intent: string }): [Workspace, string] {
  const ws = clone(ws0);
  const m: Module = { code: `M-${slug(a.name)}-${ws.seq}`, revision: 1, name: a.name.trim(), kind: a.kind, intent: a.intent.trim(), published: false, entry: null, outcomes: [], nodes: [], edges: [] };
  ws.modules.push(m);
  ws.seq += 1;
  return [ws, mKey(m)];
}

/** Creates a blank draft module and, when asked, places it in a survey — one undoable step. */
export function createBlankModule(ws0: Workspace, a: { name: string; kind: ModuleKind; intent: string; place?: { surveyId: string; index: number } }): [Workspace, { moduleKey: string; instanceId?: string }] {
  const [w1, moduleKey] = createModule(ws0, a);
  if (!a.place) return [w1, { moduleKey }];
  const [w2, instanceId] = addInstance(w1, a.place.surveyId, a.place.index, moduleKey);
  return [w2, { moduleKey, instanceId }];
}

export function renameModule(ws0: Workspace, moduleKey: string, name: string): Workspace {
  const ws = clone(ws0);
  mod(ws, moduleKey).name = name;
  return ws;
}

// ---- questions ----------------------------------------------------------------------------------------------------
export type QuestionSpec = { type: AnswerType } | { reuse: { code: string; version: number } };
export type InsertAt = { entry: true } | { from: string; on: string };

function newQuestion(ws: Workspace, type: AnswerType): Question {
  const q: Question = {
    code: `Q-NEW-${ws.seq}`, version: 1, answerType: type, intent: '',
    options: type === 'YES_NO' ? [{ code: 'YES', label: 'Yes' }, { code: 'NO', label: 'No' }] : [],
    wording: { version: 1, text: '', approval: 'SYNTHETIC_UNAPPROVED' }, published: false,
    ...(type === 'FREE_TEXT' ? { textRule: { required: true, min: 1, max: 500 } } : {}),
  };
  ws.questions.push(q);
  ws.seq += 1;
  return q;
}

/**
 * Safe insertion. On an existing route A —on→ B: A —on→ X and X's default route inherits B; nothing else is invented.
 * On an undecided answer: A —on→ X, and X's own route is left undecided for the author.
 */
export function insertQuestion(ws0: Workspace, moduleKey: string, at: InsertAt, spec: QuestionSpec): [Workspace, string] {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  const q = 'reuse' in spec ? findQuestion(ws, spec.reuse)! : newQuestion(ws, spec.type);
  const id = nextNodeId(m);
  const node: QuestionNode = { id, type: 'QUESTION', q: { code: q.code, version: q.version }, routing: { mode: 'ALL_TO_NEXT' } };
  m.nodes.push(node);
  let inherited: Target | null;
  if ('entry' in at) {
    inherited = m.entry ? { node: m.entry } : { outcome: 'COMPLETED' }; // an empty module ends normally
    m.entry = id;
  } else {
    const old = edgeOf(m, at.from, at.on);
    inherited = old ? old.to : null;
    setEdgeIn(m, at.from, at.on, { node: id });
  }
  if (inherited) setEdgeIn(m, id, defaultOn(q.answerType), inherited);
  syncOutcomes(ws, m);
  return [ws, id];
}

export function updateQuestion(ws0: Workspace, moduleKey: string, nodeId: string, patch: { text?: string; intent?: string; selection?: { min: number; max: number } | null; textRule?: TextRule }): Workspace {
  const ws = clone(ws0);
  const q = draftQuestion(ws, mod(ws, moduleKey), nodeId);
  if (patch.text !== undefined) q.wording.text = patch.text;
  if (patch.intent !== undefined) q.intent = patch.intent;
  if (patch.selection === null) delete q.selection; else if (patch.selection) q.selection = patch.selection;
  if (patch.textRule) q.textRule = patch.textRule;
  return ws;
}

/** A new draft version of a shared question, pinned by THIS placement only; other placements keep their version. */
export function newQuestionVersion(ws0: Workspace, moduleKey: string, nodeId: string): Workspace {
  const ws = clone(ws0);
  const node = qNode(mod(ws, moduleKey), nodeId);
  const src = findQuestion(ws, node.q)!;
  const version = Math.max(...ws.questions.filter((x) => x.code === src.code).map((x) => x.version)) + 1;
  ws.questions.push({ ...clone(src), version, published: false, wording: { ...src.wording, version: src.wording.version + 1 } });
  node.q = { code: src.code, version };
  return ws;
}

/** A separate question with its own code, starting as a copy. */
export function forkQuestion(ws0: Workspace, moduleKey: string, nodeId: string): Workspace {
  const ws = clone(ws0);
  const node = qNode(mod(ws, moduleKey), nodeId);
  const src = findQuestion(ws, node.q)!;
  const code = `${src.code}-COPY-${ws.seq}`;
  ws.questions.push({ ...clone(src), code, version: 1, published: false, wording: { ...src.wording, version: 1 } });
  ws.seq += 1;
  node.q = { code, version: 1 };
  return ws;
}

/** Every draft-module node that pins this question version (a draft question can be placed more than once). */
function placements(ws: Workspace, q: Question): Array<[Module, QuestionNode]> {
  const out: Array<[Module, QuestionNode]> = [];
  for (const m of ws.modules) if (!m.published) for (const nd of questionNodes(m)) if (qKey(nd.q) === qKey(q)) out.push([m, nd]);
  return out;
}

export function optionCode(label: string, taken: string[]): string {
  const base = label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'OPTION';
  let code = base;
  for (let k = 2; taken.includes(code); k++) code = `${base}_${k}`;
  return code;
}

/** Adds a choice. Its code is fixed now; in per-choice and follow-up modes its behaviour starts undecided. */
export function addOption(ws0: Workspace, moduleKey: string, nodeId: string, label: string): Workspace {
  const ws = clone(ws0);
  const q = draftQuestion(ws, mod(ws, moduleKey), nodeId);
  const other = q.options.findIndex((o) => o.isOther);
  const opt: Option = { code: optionCode(label, q.options.map((o) => o.code)), label: label.trim() };
  if (other >= 0) q.options.splice(other, 0, opt); else q.options.push(opt); // "Other" stays last
  return ws;
}

/**
 * Duplicates an answer option: a NEW stable code, the editable presentation copied, placed directly below.
 * Routing is deliberately NOT copied: wherever answers are routed one by one, the copy starts undecided
 * ("Choose destination") and blocks submission until the author routes it. The original and its routes are untouched.
 */
export function duplicateOption(ws0: Workspace, moduleKey: string, nodeId: string, code: string): [Workspace, string] {
  const ws = clone(ws0);
  const q = draftQuestion(ws, mod(ws, moduleKey), nodeId);
  const at = q.options.findIndex((o) => o.code === code);
  const src = q.options[at];
  if (!src) throw new Error(`Unknown option ${code}`);
  if (src.isOther) throw new Error('"Other — please specify" cannot be duplicated');
  const label = `${src.label} (copy)`;
  const copy: Option = { code: optionCode(label, q.options.map((o) => o.code)), label, ...(src.exclusive ? { exclusive: true } : {}), ...(src.interrupt ? { interrupt: src.interrupt } : {}) };
  q.options.splice(at + 1, 0, copy);
  return [ws, copy.code];
}

/** Sets whether an answer may interrupt follow-ups. Only on a draft definition; placements that become illegal are reset to undecided. */
export function setInterruptClass(ws0: Workspace, moduleKey: string, nodeId: string, code: string, cls: InterruptClass | null): Workspace {
  const ws = clone(ws0);
  const q = draftQuestion(ws, mod(ws, moduleKey), nodeId);
  const o = q.options.find((x) => x.code === code)!;
  if (cls) o.interrupt = cls; else delete o.interrupt;
  const allowed = permittedInterrupts(cls ?? undefined);
  for (const [m, nd] of placements(ws, q)) {
    const r = nd.routing;
    if (r.mode !== 'SEQUENTIAL_FOLLOWUPS') continue;
    const it = r.interrupts?.find((i) => i.option === code);
    if (it && !allowed.includes(it.policy)) r.interrupts = r.interrupts!.filter((i) => i !== it);
    if (cls === 'MANDATORY') { r.noFollowup = r.noFollowup?.filter((c) => c !== code); r.followups = r.followups?.filter((f) => f.option !== code); }
    dropOrphanFollowups(m);
    syncOutcomes(ws, m);
  }
  return ws;
}

export function renameOption(ws0: Workspace, moduleKey: string, nodeId: string, code: string, label: string): Workspace {
  const ws = clone(ws0);
  draftQuestion(ws, mod(ws, moduleKey), nodeId).options.find((o) => o.code === code)!.label = label;
  return ws;
}

export function moveOption(ws0: Workspace, moduleKey: string, nodeId: string, from: number, to: number): Workspace {
  const ws = clone(ws0);
  const opts = draftQuestion(ws, mod(ws, moduleKey), nodeId).options;
  if (to < 0 || to >= opts.length) return ws0;
  const [it] = opts.splice(from, 1);
  opts.splice(to, 0, it!);
  return ws;
}

export function removeOption(ws0: Workspace, moduleKey: string, nodeId: string, code: string): Workspace {
  const ws = clone(ws0);
  const q = draftQuestion(ws, mod(ws, moduleKey), nodeId);
  q.options = q.options.filter((o) => o.code !== code); // stored selection limits are kept: a conflict is shown, never a silent change
  for (const [m, nd] of placements(ws, q)) {
    m.edges = m.edges.filter((x) => !(x.from === nd.id && x.on === code));
    const r = nd.routing;
    r.followups = r.followups?.filter((f) => f.option !== code);
    r.noFollowup = r.noFollowup?.filter((c) => c !== code);
    r.interrupts = r.interrupts?.filter((i) => i.option !== code);
    for (const rule of r.rules ?? []) rule.options = rule.options.filter((c) => c !== code); // a rule left with no answers is flagged
    if (r.normal === code) r.normal = q.options[0]?.code;
    dropOrphanFollowups(m);
    syncOutcomes(ws, m);
  }
  return ws;
}

export function patchOption(ws0: Workspace, moduleKey: string, nodeId: string, code: string, patch: { exclusive?: boolean; otherText?: TextRule }): Workspace {
  const ws = clone(ws0);
  const q = draftQuestion(ws, mod(ws, moduleKey), nodeId);
  const o = q.options.find((x) => x.code === code)!;
  if (patch.exclusive !== undefined) { if (patch.exclusive) o.exclusive = true; else delete o.exclusive; }
  if (patch.otherText) o.otherText = patch.otherText;
  return ws;
}

/** "Other — please specify" is an option with the stable code OTHER and a companion text rule, not a question type. */
export function toggleOther(ws0: Workspace, moduleKey: string, nodeId: string, on: boolean): Workspace {
  if (!on) return removeOption(ws0, moduleKey, nodeId, 'OTHER');
  const ws = clone(ws0);
  const q = draftQuestion(ws, mod(ws, moduleKey), nodeId);
  if (!q.options.some((o) => o.isOther)) {
    q.options.push({ code: 'OTHER', label: 'Other — please specify', isOther: true, otherText: { required: true, min: 3, max: 200 } });
  }
  return ws;
}

// ---- routing ------------------------------------------------------------------------------------------------------
export function setEdge(ws0: Workspace, moduleKey: string, nodeId: string, on: string, to: Target | null): Workspace {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  setEdgeIn(m, nodeId, on, to);
  syncOutcomes(ws, m);
  return ws;
}

/**
 * Switches how a question routes. Going to per-choice keeps the former destination on the NORMAL answer only;
 * the other answers become undecided so the author chooses them (no invented alternate path).
 */
export function setMode(ws0: Workspace, moduleKey: string, nodeId: string, mode: RoutingMode): Workspace {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  const node = qNode(m, nodeId);
  const q = findQuestion(ws, node.q)!;
  if (node.routing.mode === mode) return ws0;
  const r = node.routing;
  const common: Target | null =
    (r.mode === 'SEQUENTIAL_FOLLOWUPS' ? r.rejoin ?? null : r.mode === 'ORDERED_RULES' ? r.fallback ?? null : null)
    ?? edgeOf(m, nodeId, defaultOn(q.answerType))?.to
    ?? (r.normal ? edgeOf(m, nodeId, r.normal)?.to : undefined)
    ?? m.edges.find((x) => x.from === nodeId)?.to ?? null;
  m.edges = m.edges.filter((x) => x.from !== nodeId);
  if (mode === 'ALL_TO_NEXT') {
    node.routing = { mode };
    if (common) setEdgeIn(m, nodeId, defaultOn(q.answerType), common);
  } else if (mode === 'PER_CHOICE') {
    const normal = q.options[0]?.code;
    node.routing = { mode, ...(normal ? { normal } : {}) };
    if (common && normal) setEdgeIn(m, nodeId, normal, common);
  } else if (mode === 'ORDERED_RULES') {
    // no rule is invented; "otherwise" keeps the former common destination
    node.routing = { mode, rules: [], fallback: common };
  } else {
    // ordinary answers start as "no follow-up"; an answer that can interrupt is left for the author to decide
    node.routing = { mode, followups: [], noFollowup: q.options.filter((o) => !o.interrupt).map((o) => o.code), interrupts: [], rejoin: common };
  }
  dropOrphanFollowups(m);
  syncOutcomes(ws, m);
  return ws;
}

export function setNormal(ws0: Workspace, moduleKey: string, nodeId: string, code: string): Workspace {
  const ws = clone(ws0);
  qNode(mod(ws, moduleKey), nodeId).routing.normal = code;
  return ws;
}

function clearFollowup(node: QuestionNode, option: string) {
  const r = node.routing;
  r.followups = (r.followups ?? []).filter((f) => f.option !== option);
  r.noFollowup = (r.noFollowup ?? []).filter((c) => c !== option);
  r.interrupts = (r.interrupts ?? []).filter((i) => i.option !== option);
}

/** The behaviours a placement may choose for an answer, by the interruption class its DEFINITION gives it. */
export function permittedInterrupts(cls: InterruptClass | undefined): InterruptPolicy[] {
  return cls === 'MANDATORY' ? ['STOP_ESCALATE'] : cls === 'OPTIONAL' ? ['STOP_ESCALATE', 'RESUME', 'STOP_REJOIN'] : [];
}

function optionOf(ws: Workspace, node: QuestionNode, code: string) {
  const o = findQuestion(ws, node.q)?.options.find((x) => x.code === code);
  if (!o) throw new Error(`Unknown option ${code}`);
  return o;
}

/**
 * Declares what a selected answer does in a follow-up plan: nothing, or an interruption with one of the three
 * governed behaviours. The definition decides what is allowed: a prohibited answer cannot interrupt, and a mandatory
 * escalation cannot be turned into anything weaker. (Asking an ordinary follow-up uses addFollowupQuestion.)
 */
export function setFollowupBehaviour(ws0: Workspace, moduleKey: string, nodeId: string, option: string,
  b: { kind: 'NONE' } | { kind: 'INTERRUPT'; interrupt: Omit<Interrupt, 'option'> }): Workspace {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  const node = qNode(m, nodeId);
  const cls = optionOf(ws, node, option).interrupt;
  if (b.kind === 'NONE' && cls === 'MANDATORY') throw new Error('This answer is a mandatory escalation: it cannot be set to "no follow-up"');
  if (b.kind === 'INTERRUPT' && !permittedInterrupts(cls).includes(b.interrupt.policy)) {
    throw new Error(cls ? 'This answer is a mandatory escalation: it can only stop and escalate' : 'This answer is not allowed to interrupt the follow-ups');
  }
  const previous = node.routing.interrupts?.find((i) => i.option === option);
  clearFollowup(node, option);
  if (b.kind === 'NONE') node.routing.noFollowup!.push(option);
  else {
    const p = b.interrupt.policy;
    // keep only what the chosen behaviour uses, so nothing left over can act implicitly
    node.routing.interrupts!.push({
      option, policy: p,
      ...(p === 'STOP_ESCALATE' ? { outcome: b.interrupt.outcome ?? (previous?.policy === p ? previous.outcome : undefined) } : {}),
      ...(p === 'RESUME' ? { nodes: b.interrupt.nodes ?? (previous?.policy === p ? previous.nodes : undefined) ?? [] } : {}),
      ...(p === 'STOP_REJOIN' ? { rejoin: b.interrupt.rejoin ?? (previous?.policy === p ? previous.rejoin : undefined) ?? null } : {}),
    });
  }
  dropOrphanFollowups(m);
  syncOutcomes(ws, m);
  return ws;
}

/**
 * Creates (or links) the question asked when `option` is selected. As an ordinary follow-up it joins the end of the
 * queue; `as: 'INTERRUPT'` makes it the question a handle-and-resume interruption asks first.
 */
export function addFollowupQuestion(ws0: Workspace, moduleKey: string, nodeId: string, option: string,
  spec: QuestionSpec | { existing: string }, as: 'FOLLOWUP' | 'INTERRUPT' = 'FOLLOWUP'): [Workspace, string] {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  const node = qNode(m, nodeId);
  const cls = optionOf(ws, node, option).interrupt;
  if (as === 'FOLLOWUP' && cls === 'MANDATORY') throw new Error('This answer is a mandatory escalation: it cannot be given an ordinary follow-up');
  if (as === 'INTERRUPT' && !permittedInterrupts(cls).includes('RESUME')) throw new Error('This answer is not allowed to be handled and resumed');
  let target: string;
  if ('existing' in spec) target = spec.existing;
  else {
    const q = 'reuse' in spec ? findQuestion(ws, spec.reuse)! : newQuestion(ws, spec.type);
    target = nextNodeId(m);
    m.nodes.push({ id: target, type: 'QUESTION', q: { code: q.code, version: q.version }, routing: { mode: 'ALL_TO_NEXT' }, role: 'FOLLOWUP' });
    setEdgeIn(m, target, defaultOn(q.answerType), { ret: true });
  }
  if (as === 'INTERRUPT') {
    const it = node.routing.interrupts?.find((i) => i.option === option);
    if (it && it.policy === 'RESUME') it.nodes = [...(it.nodes ?? []), target];
    else { clearFollowup(node, option); node.routing.interrupts!.push({ option, policy: 'RESUME', nodes: [target] }); }
  } else {
    const at = (node.routing.followups ?? []).findIndex((f) => f.option === option);
    clearFollowup(node, option);
    const entry = { option, nodes: [target] };
    if (at >= 0) node.routing.followups!.splice(at, 0, entry); else node.routing.followups!.push(entry);
  }
  dropOrphanFollowups(m);
  syncOutcomes(ws, m);
  return [ws, target];
}

export function reorderFollowups(ws0: Workspace, moduleKey: string, nodeId: string, from: number, to: number): Workspace {
  const ws = clone(ws0);
  const f = qNode(mod(ws, moduleKey), nodeId).routing.followups!;
  if (from === to || to < 0 || to >= f.length) return ws0;
  const [it] = f.splice(from, 1);
  f.splice(to, 0, it!);
  return ws;
}

export function setRejoin(ws0: Workspace, moduleKey: string, nodeId: string, to: Target | null): Workspace {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  qNode(m, nodeId).routing.rejoin = to;
  syncOutcomes(ws, m);
  return ws;
}

/** Every route that leads into a node — what a delete must account for. */
export function inbound(m: Module, nodeId: string): Edge[] {
  return m.edges.filter((x) => 'node' in x.to && x.to.node === nodeId);
}
/** Number of routes of any kind that arrive at a node (edges, rejoins, rules, fallbacks, stop-and-go interruptions). */
export function inboundCount(m: Module, nodeId: string): number {
  return m.nodes.reduce((n, nd) => n + routesFrom(m, nd).filter((r) => 'node' in r.to && r.to.node === nodeId && !r.via.startsWith('FOLLOWUP:') && !(r.via.startsWith('INTERRUPT:') && isQuestion(nd) && nd.routing.interrupts?.some((i) => i.nodes?.includes(nodeId)))).length, 0);
}

/** Deletes a question or a decision. Inbound routes go to `rewire` if the author chose one; otherwise they become undecided. */
export function deleteNode(ws0: Workspace, moduleKey: string, nodeId: string, rewire: Target | null): Workspace {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  for (const x of inbound(m, nodeId)) { if (rewire) x.to = rewire; }
  if (!rewire) m.edges = m.edges.filter((x) => !('node' in x.to && x.to.node === nodeId));
  if (m.entry === nodeId) m.entry = rewire && 'node' in rewire ? rewire.node : null;
  for (const nd of m.nodes) {
    // a condition that read this question's answer keeps its named input, now unmapped and flagged
    if (!isQuestion(nd) && nd.binding?.inputs) for (const [k, v] of Object.entries(nd.binding.inputs)) if (v.node === nodeId) delete nd.binding.inputs[k];
  }
  for (const nd of questionNodes(m)) {
    const r = nd.routing;
    for (const rule of r.rules ?? []) if (rule.to && 'node' in rule.to && rule.to.node === nodeId) rule.to = rewire && !('ret' in rewire) ? rewire : null;
    if (r.fallback && 'node' in r.fallback && r.fallback.node === nodeId) r.fallback = rewire && !('ret' in rewire) ? rewire : null;
    if (r.rejoin && 'node' in r.rejoin && r.rejoin.node === nodeId) r.rejoin = rewire && !('ret' in rewire) ? rewire : null;
    if (r.followups) {
      const lost = r.followups.filter((f) => f.nodes.includes(nodeId)).map((f) => f.option);
      r.followups = r.followups.filter((f) => !f.nodes.includes(nodeId));
      // the option's behaviour is undecided again; it is not silently turned into "no follow-up"
      r.noFollowup = (r.noFollowup ?? []).filter((c) => !lost.includes(c));
    }
    for (const i of r.interrupts ?? []) {
      if (i.nodes) i.nodes = i.nodes.filter((x) => x !== nodeId); // the interrupt stays, now incomplete and flagged
      if (i.rejoin && 'node' in i.rejoin && i.rejoin.node === nodeId) i.rejoin = null;
    }
  }
  m.nodes = m.nodes.filter((nd) => nd.id !== nodeId);
  m.edges = m.edges.filter((x) => x.from !== nodeId);
  dropOrphanFollowups(m);
  if (!m.entry && m.nodes.length === 0) m.entry = null;
  syncOutcomes(ws, m);
  return ws;
}

// ---- decisions (SS-02B.1) -----------------------------------------------------------------------------------------
/**
 * Inserts a decision point. Safe insertion, as for questions: on an existing route A —on→ B the route now goes to the
 * decision and only OTHERWISE inherits B; MATCHES and UNKNOWN start undecided, and the condition itself is not set.
 */
export function insertDecision(ws0: Workspace, moduleKey: string, at: InsertAt): [Workspace, string] {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  const id = nextId(m, 'd');
  m.nodes.push({ id, type: 'DECISION', binding: null });
  let inherited: Target | null;
  if ('entry' in at) {
    inherited = m.entry ? { node: m.entry } : null;
    m.entry = id;
  } else {
    const old = edgeOf(m, at.from, at.on);
    inherited = old ? old.to : null;
    setEdgeIn(m, at.from, at.on, { node: id });
  }
  if (inherited) setEdgeIn(m, id, 'NO_MATCH', inherited);
  syncOutcomes(ws, m);
  return [ws, id];
}

/** Sets the condition binding of a decision (which condition version, this placement's values and answer mapping). */
export function setDecisionBinding(ws0: Workspace, moduleKey: string, nodeId: string, binding: Binding): Workspace {
  const ws = clone(ws0);
  const d = dNode(mod(ws, moduleKey), nodeId);
  d.binding = { ...clone(binding), unknownPolicy: d.binding?.unknownPolicy ?? binding.unknownPolicy ?? null };
  return ws;
}

/**
 * What a decision does when information is missing: follow an explicit Unknown route, or stop and flag for review.
 * Stopping is the governed REVIEW_REQUIRED outcome: the run halts pending an authorised review. Never "no".
 */
export function setDecisionUnknown(ws0: Workspace, moduleKey: string, nodeId: string, choice: { stop: true } | { to: Target }): Workspace {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  const d = dNode(m, nodeId);
  const base: Binding = d.binding ?? { condition: { code: '', version: 0 }, params: {}, unknownPolicy: null };
  if ('stop' in choice) { d.binding = { ...base, unknownPolicy: 'BLOCK' }; setEdgeIn(m, nodeId, 'UNKNOWN', { outcome: 'REVIEW_REQUIRED' }); }
  else { d.binding = { ...base, unknownPolicy: 'ROUTE' }; setEdgeIn(m, nodeId, 'UNKNOWN', choice.to); }
  syncOutcomes(ws, m);
  return ws;
}

// ---- first-matching-rule routing (SS-02B.1) -----------------------------------------------------------------------
export function addRule(ws0: Workspace, moduleKey: string, nodeId: string): [Workspace, string] {
  const ws = clone(ws0);
  const r = qNode(mod(ws, moduleKey), nodeId).routing;
  const id = `r${Math.max(0, ...(r.rules ?? []).map((x) => Number(x.id.slice(1)) || 0)) + 1}`;
  r.rules = [...(r.rules ?? []), { id, kind: 'ANY', options: [], to: null }];
  return [ws, id];
}
export function updateRule(ws0: Workspace, moduleKey: string, nodeId: string, ruleId: string, patch: Partial<Omit<SetRule, 'id'>>): Workspace {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  const rule = qNode(m, nodeId).routing.rules?.find((x) => x.id === ruleId);
  if (!rule) throw new Error(`Unknown rule ${ruleId}`);
  Object.assign(rule, clone(patch));
  syncOutcomes(ws, m);
  return ws;
}
export function removeRule(ws0: Workspace, moduleKey: string, nodeId: string, ruleId: string): Workspace {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  const r = qNode(m, nodeId).routing;
  r.rules = (r.rules ?? []).filter((x) => x.id !== ruleId);
  syncOutcomes(ws, m);
  return ws;
}
/** Priority is the order of the list. */
export function moveRule(ws0: Workspace, moduleKey: string, nodeId: string, from: number, to: number): Workspace {
  const ws = clone(ws0);
  const rules = qNode(mod(ws, moduleKey), nodeId).routing.rules ?? [];
  if (from === to || to < 0 || to >= rules.length) return ws0;
  const [it] = rules.splice(from, 1);
  rules.splice(to, 0, it!);
  return ws;
}
export function setFallback(ws0: Workspace, moduleKey: string, nodeId: string, to: Target | null): Workspace {
  const ws = clone(ws0);
  const m = mod(ws, moduleKey);
  qNode(m, nodeId).routing.fallback = to;
  syncOutcomes(ws, m);
  return ws;
}

// ---- conditions: versions and consumers (SS-02B.1) ----------------------------------------------------------------
export interface Consumer { kind: 'ENTRY' | 'DECISION'; label: string; surveyId?: string; instanceId?: string; moduleKey?: string; nodeId?: string; version: number }

/** Everywhere a condition (any version) is bound: module entry rules and decision points. */
export function conditionConsumers(ws: Workspace, code: string): Consumer[] {
  const out: Consumer[] = [];
  for (const sv of ws.surveys) for (const inst of sv.sequence) {
    if (inst.entry.mode === 'RULE' && inst.entry.binding.condition.code === code) {
      out.push({ kind: 'ENTRY', label: `${sv.name} › ${findModule(ws, mKey(inst.module))?.name ?? inst.id} — when it runs`, surveyId: sv.id, instanceId: inst.id, version: inst.entry.binding.condition.version });
    }
  }
  for (const m of ws.modules) for (const nd of m.nodes) {
    if (!isQuestion(nd) && nd.binding?.condition.code === code) {
      out.push({ kind: 'DECISION', label: `${m.name}${m.published ? '' : ' (draft)'} — a decision point`, moduleKey: mKey(m), nodeId: nd.id, version: nd.binding.condition.version });
    }
  }
  return out;
}

/** Number of places a question definition (any version) is used across the workspace. */
export function usage(ws: Workspace, code: string): number {
  return ws.modules.reduce((nUsed, m) => nUsed + questionNodes(m).filter((nd) => nd.q.code === code).length, 0);
}

export type { Survey };
