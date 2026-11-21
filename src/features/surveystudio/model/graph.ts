// Survey Studio prototype — the Graph view's reading of the canonical model (SS-02B.2).
// Everything here is DERIVED from the one workspace and stores nothing: a picture of the module graph (nodes, route
// slots, edges), an automatic layout, and the mapping from a graph gesture to the SAME operations the Guided view uses.
// There is no second routing model. Positions, zoom, collapse and selection are presentation state kept by the view.
import { Graph, layout as dagreLayout } from '@dagrejs/dagre';
import { describeAst } from './engine';
import { escalationOutcomes, mandatoryOutcomes, buildFlow, normalNext, ruleText, validateModule, type Flow, type FlowEntry } from './flow';
import {
  canBeIneligible, defaultOn, edgeOf, findCondition, findModule, findQuestion, jumpSources, setDecisionUnknown, setEdge, setFallback, setIfIneligible, setIfSkippedInSequence, setRejoin, setRoute, updateRule, type InsertAt,
} from './ops';
import { ESCALATION_OUTCOMES, OUTCOME_LABEL } from './sample';
import { isQuestion, mKey, type AnswerType, type Issue, type Module, type ModuleKind, type OutcomeCode, type Survey, type SurveyTarget, type Target, type Workspace } from './types';

export type Tone = 'normal' | 'alt' | 'unknown' | 'escalate' | 'queue';

/** One way out of a step. `via` is the canonical route key; a slot with `connect` can be re-pointed by a graph gesture. */
export interface Slot {
  via: string;
  label: string;
  target: Target | null;
  tone: Tone;
  /** May be set by dragging a connection (or its keyboard alternative). */
  connect: boolean;
  /** A question or condition may be inserted on this route. */
  insert?: InsertAt;
  /** A mandatory escalation: only an approved escalation outcome is a valid destination. */
  must?: boolean;
  undecided: boolean;
}

export interface GNode {
  id: string;
  kind: 'START' | 'QUESTION' | 'DECISION' | 'OUTCOME' | 'STUB';
  number?: string;
  title: string;
  subtitle?: string;
  answerType?: AnswerType;
  slots: Slot[];
  issues: number;
  main: boolean;
  followup?: boolean;
  shared?: boolean;
  orphan?: boolean;
  outcome?: OutcomeCode;
  /** STUB: the collapsed lane it stands for. */
  laneKey?: string;
  width: number;
  height: number;
}

export interface GEdge {
  id: string;
  source: string;
  /** The slot the edge leaves by (its `via`). */
  handle: string;
  target: string;
  label: string;
  tone: Tone;
  main: boolean;
  /**
   * Drawn to explain a canonical STRUCTURE (the order of a follow-up queue, a folded branch, where the module starts).
   * It is not a business route of its own, so it cannot be disconnected or re-pointed; `why` says what it shows and
   * `owner` is the step on which the structure is edited.
   */
  synthetic?: boolean;
  why?: string;
  owner?: string;
  insert?: InsertAt;
  /** The route's own name ("No", "Matches", "Rule 1 …") — the edge label may be empty when the card already says it. */
  route?: string;
  /** A mandatory escalation: may be redirected only to an approved escalation outcome. */
  must?: boolean;
  /** Set by an interruption rule on the answer, not by a connection. */
  fixed?: boolean;
}

const QUEUE_WHY = 'The order in which follow-up questions are asked. It is not a route of its own: change the order, or what each answer asks, on the question that owns the queue.';

export interface ModuleGraph { nodes: GNode[]; edges: GEdge[]; flow: Flow; lanes: string[] }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const lines = (s: string, per: number, max: number) => Math.min(max, Math.max(1, Math.ceil(s.length / per)));
export const NODE_W = 290;
const ROW_H = 24;

/** The graph id of the terminal an outcome is drawn as: one shared "Completed", and one per source for the exceptions. */
export const outcomeNodeId = (o: OutcomeCode, source: string) => (o === 'COMPLETED' ? 'out:COMPLETED' : `out:${o}@${source}`);
/** A graph node id back to a canonical target (null for the start, a collapsed-lane stub or anything else). */
export function targetOfNodeId(id: string): Target | null {
  if (id.startsWith('out:')) return { outcome: id.slice(4).split('@')[0] as OutcomeCode };
  if (id === 'start' || id.startsWith('stub:')) return null;
  return { node: id };
}

/** The ways out of one step, in the order the Guided card lists them. */
export function slotsOf(ws: Workspace, m: Module, entry: FlowEntry): Slot[] {
  const nd = entry.node;
  const mk = (via: string, label: string, target: Target | null, tone: Tone, extra: Partial<Slot> = {}): Slot => ({ via, label, target, tone, connect: true, undecided: target === null, ...extra });
  if (!isQuestion(nd)) {
    return [
      mk('MATCH', 'Matches', edgeOf(m, nd.id, 'MATCH')?.to ?? null, 'alt', { insert: { from: nd.id, on: 'MATCH' } }),
      mk('NO_MATCH', 'Otherwise', edgeOf(m, nd.id, 'NO_MATCH')?.to ?? null, 'normal', { insert: { from: nd.id, on: 'NO_MATCH' } }),
      mk('UNKNOWN', 'Unknown', edgeOf(m, nd.id, 'UNKNOWN')?.to ?? null, 'unknown', { undecided: !nd.binding?.unknownPolicy || !edgeOf(m, nd.id, 'UNKNOWN') }),
    ];
  }
  if (nd.role === 'FOLLOWUP') return [];
  const q = findQuestion(ws, nd.q)!;
  const r = nd.routing;
  const name = (code: string) => q.options.find((o) => o.code === code)?.label || code;
  if (r.mode === 'ALL_TO_NEXT') {
    const on = defaultOn(q.answerType);
    return [mk(on, q.answerType === 'FREE_TEXT' ? 'After the answer' : 'Everybody', edgeOf(m, nd.id, on)?.to ?? null, 'normal', { insert: { from: nd.id, on } })];
  }
  if (r.mode === 'PER_CHOICE') {
    return q.options.map((o) => mk(o.code, o.label || o.code, edgeOf(m, nd.id, o.code)?.to ?? null,
      o.interrupt === 'MANDATORY' ? 'escalate' : o.code === r.normal ? 'normal' : 'alt', { insert: { from: nd.id, on: o.code }, must: o.interrupt === 'MANDATORY' }));
  }
  if (r.mode === 'ORDERED_RULES') {
    return [
      ...(r.rules ?? []).map((rule, i) => mk(`RULE:${rule.id}`, `${i + 1} · ${clip(ruleText(q, rule), 40)}`, rule.to, 'alt')),
      mk('FALLBACK', 'Otherwise', r.fallback ?? null, 'normal'),
    ];
  }
  // sequential follow-ups: the queue is drawn as a chain; what is left to route here is the rejoin and any interruption
  return [
    ...(r.interrupts ?? []).filter((i) => i.policy !== 'RESUME').map((i) => mk(`INT:${i.option}`, `“${clip(name(i.option), 26)}” stops`,
      i.policy === 'STOP_ESCALATE' ? (i.outcome ? { outcome: i.outcome } : null) : i.rejoin ?? null, 'escalate',
      { connect: false, must: q.options.find((o) => o.code === i.option)?.interrupt === 'MANDATORY' })),
    mk('REJOIN', 'After the follow-ups', r.rejoin ?? null, 'normal'),
  ];
}

/** The follow-up questions of a queue in the order they are asked (interrupt questions that are "asked first" lead). */
function queueOf(ws: Workspace, entry: FlowEntry): Array<{ node: string; because: string }> {
  const nd = entry.node;
  if (!isQuestion(nd) || nd.routing.mode !== 'SEQUENTIAL_FOLLOWUPS') return [];
  const q = findQuestion(ws, nd.q)!;
  const name = (code: string) => q.options.find((o) => o.code === code)?.label || code;
  const out: Array<{ node: string; because: string[] }> = [];
  const push = (node: string, option: string) => { const hit = out.find((x) => x.node === node); if (hit) hit.because.push(name(option)); else out.push({ node, because: [name(option)] }); };
  for (const i of nd.routing.interrupts ?? []) if (i.policy === 'RESUME') for (const n of i.nodes ?? []) push(n, i.option);
  for (const f of nd.routing.followups ?? []) for (const n of f.nodes) push(n, f.option); // a question shared by two answers is asked once
  return out.map((x) => ({ node: x.node, because: x.because.map((b) => `“${clip(b, 18)}”`).join(' or ') }));
}

/**
 * The module as a graph. `collapsed` holds lane keys (`<node>:<route>`, the same keys the Guided view folds): a
 * collapsed lane is drawn as one stub that still shows where it rejoins, so no route silently disappears.
 */
export function moduleGraph(ws: Workspace, m: Module, collapsed: ReadonlySet<string> = new Set(), issues: Issue[] = validateModule(ws, m)): ModuleGraph {
  const flow = buildFlow(ws, m);
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const hidden = new Map<string, string>(); // hidden node id → the stub that stands for it
  const lanes: string[] = [];
  const mainIds = new Set(flow.main.map((x) => x.node.id));
  const count = (id: string) => issues.filter((i) => i.where.nodeId === id).length;
  const everything = (list: FlowEntry[]): string[] => list.flatMap((e) => [e.node.id, ...e.followups.map((f) => f.node.id), ...e.rows.flatMap((r) => everything(r.lane))]);

  const stub = (laneKey: string, inside: FlowEntry[] | string[], title: string, end: Target | null, source: string) => {
    const ids = typeof inside[0] === 'string' ? (inside as string[]) : everything(inside as FlowEntry[]);
    const id = `stub:${laneKey}`;
    for (const x of ids) hidden.set(x, id);
    const bad = ids.reduce((n, x) => n + count(x), 0);
    nodes.push({ id, kind: 'STUB', title, subtitle: end ? ('outcome' in end ? `ends: ${OUTCOME_LABEL[end.outcome]}` : 'rejoins the path') : 'does not lead anywhere yet', slots: [], issues: bad + (end ? 0 : 1), main: false, laneKey, width: 230, height: 58 });
    if (end && !('ret' in end)) pendingStubEnds.push({ id, end, source });
  };
  const pendingStubEnds: Array<{ id: string; end: Target; source: string }> = [];

  const visit = (entry: FlowEntry, orphan = false) => {
    const nd = entry.node;
    const slots = slotsOf(ws, m, entry);
    if (isQuestion(nd)) {
      const q = findQuestion(ws, nd.q)!;
      const title = q.wording.text.trim() || 'Untitled question';
      nodes.push({
        id: nd.id, kind: 'QUESTION', number: entry.number, title, answerType: q.answerType, slots, issues: count(nd.id), main: mainIds.has(nd.id),
        followup: nd.role === 'FOLLOWUP', shared: q.published, orphan, width: NODE_W, height: 50 + lines(title, 36, 2) * 21 + slots.length * ROW_H + (slots.length ? 10 : 4),
      });
    } else {
      const c = nd.binding && nd.binding.condition.code ? findCondition(ws, nd.binding.condition) : undefined;
      const title = c ? describeAst(c.ast, c, nd.binding!, false, {
        inputLabel: (k) => { const id = nd.binding?.inputs?.[k]?.node; return id ? `the answer to ${flow.numbers.get(id) ?? 'an earlier question'}` : 'an earlier answer'; },
        optionLabel: (k, code) => { const n = m.nodes.find((x) => x.id === nd.binding?.inputs?.[k]?.node); const q = n && isQuestion(n) ? findQuestion(ws, n.q) : undefined; return `“${q?.options.find((o) => o.code === code)?.label ?? code}”`; },
      }) : 'No condition yet';
      nodes.push({ id: nd.id, kind: 'DECISION', number: entry.number, title, subtitle: c?.shared ? `${c.name} · v${c.version}` : undefined, slots, issues: count(nd.id), main: mainIds.has(nd.id), orphan, width: NODE_W, height: 46 + lines(title, 38, 3) * 19 + 3 * ROW_H + 10 });
    }

    // the follow-up queue, as a chain in asking order with an explicit rejoin at the end
    const queue = queueOf(ws, entry);
    if (queue.length) {
      const key = `${nd.id}:followups`;
      lanes.push(key);
      const rejoin = isQuestion(nd) ? nd.routing.rejoin ?? null : null;
      if (collapsed.has(key)) {
        stub(key, queue.map((x) => x.node), `${queue.length} follow-up question${queue.length === 1 ? '' : 's'}, asked in order`, rejoin, nd.id);
        edges.push({ id: `${nd.id}|QUEUE`, source: nd.id, handle: 'REJOIN', target: `stub:${key}`, label: 'for each selected answer', tone: 'queue', main: false, synthetic: true, why: QUEUE_WHY, owner: nd.id });
      } else {
        queue.forEach((it, i) => {
          edges.push({ id: `${nd.id}|QUEUE|${i}`, source: i === 0 ? nd.id : queue[i - 1]!.node, handle: i === 0 ? 'REJOIN' : 'NEXT', target: it.node, label: `${i + 1} · if ${it.because}`, tone: 'queue', main: false, synthetic: true, why: QUEUE_WHY, owner: nd.id });
        });
        const last = queue[queue.length - 1]!.node;
        if (rejoin && !('ret' in rejoin)) edges.push({ id: `${nd.id}|QUEUE|END`, source: last, handle: 'NEXT', target: 'node' in rejoin ? rejoin.node : outcomeNodeId(rejoin.outcome, nd.id), label: 'then rejoins', tone: 'queue', main: false, synthetic: true, why: 'Where everyone continues after the follow-ups. It is the “After the follow-ups” route of the question that owns the queue.', owner: nd.id });
        for (const f of entry.followups) visit(f);
      }
    }

    // ordinary slots → edges. One edge per ROUTE (never merged), so each keeps its own identity — source step, route key —
    // and can be selected, disconnected and re-pointed on its own even when several answers share a destination.
    const drawn = queue.length ? slots.filter((s) => s.via !== 'REJOIN') : slots;
    const next = normalNext(m, nd, isQuestion(nd) ? findQuestion(ws, nd.q) : undefined);
    for (const sl of drawn) {
      if (!sl.target || 'ret' in sl.target) continue;
      const to = 'node' in sl.target ? sl.target.node : outcomeNodeId(sl.target.outcome, nd.id);
      const isMain = sl.tone === 'normal' && mainIds.has(nd.id) && !!next && 'node' in next && next.node === to && mainIds.has(to);
      edges.push({
        id: `${nd.id}|${sl.via}`, source: nd.id, handle: sl.via, target: to, label: slots.length === 1 ? '' : clip(sl.label, 28), route: sl.label, tone: sl.must ? 'escalate' : sl.tone, main: isMain,
        ...(sl.insert ? { insert: sl.insert } : {}), ...(sl.must ? { must: true } : {}), ...(sl.connect ? {} : { fixed: true, owner: nd.id, why: 'This answer interrupts the follow-ups. Where it leads is part of its interruption rule, set on the answer.' }),
      });
    }

    for (const row of entry.rows) {
      if (!row.lane.length) continue;
      const key = `${nd.id}:${row.on}`;
      lanes.push(key);
      if (collapsed.has(key)) {
        const lastItem = row.lane[row.lane.length - 1]!;
        const end = normalNext(m, lastItem.node, lastItem.kind === 'QUESTION' ? lastItem.question : undefined);
        const n = everything(row.lane).length;
        stub(key, row.lane, `${n} step${n === 1 ? '' : 's'} on “${clip(row.label, 22)}”`, end, nd.id);
      } else for (const child of row.lane) visit(child);
    }
  };

  nodes.push({ id: 'start', kind: 'START', title: 'Module starts', slots: [], issues: 0, main: true, width: 150, height: 36 });
  if (m.entry) edges.push({ id: 'start|ENTRY', source: 'start', handle: 'ENTRY', target: m.entry, label: '', tone: 'normal', main: true, insert: { entry: true }, synthetic: true, why: 'Where the module starts. It follows the first step; add a step before it to change what comes first.', owner: m.entry });
  for (const e of flow.main) visit(e);
  for (const e of flow.orphans) visit(e, true);
  for (const s of pendingStubEnds) edges.push({ id: `${s.id}|END`, source: s.id, handle: 'NEXT', target: 'node' in s.end ? s.end.node : outcomeNodeId((s.end as { outcome: OutcomeCode }).outcome, s.source), label: '', tone: 'alt', main: false, synthetic: true, why: 'A folded branch. Open it to see and edit the routes inside.' });

  // collapsed lanes: an edge into a hidden step goes to its stub; edges out of hidden steps are covered by the stub
  const visibleEdges: GEdge[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (hidden.has(e.source)) continue;
    const target = hidden.get(e.target) ?? e.target;
    if (target === e.source) continue;
    const key = `${e.source}|${e.handle}|${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    visibleEdges.push(target === e.target ? e : { ...e, target, insert: undefined }); // the route itself is unchanged; only its far end is folded
  }
  const visibleNodes = nodes.filter((n) => !hidden.has(n.id));

  // terminals: every outcome an edge reaches, as its own named node
  const have = new Set(visibleNodes.map((n) => n.id));
  for (const e of visibleEdges) {
    if (!e.target.startsWith('out:') || have.has(e.target)) continue;
    have.add(e.target);
    const code = e.target.slice(4).split('@')[0] as OutcomeCode;
    visibleNodes.push({ id: e.target, kind: 'OUTCOME', outcome: code, title: code === 'REVIEW_REQUIRED' ? 'Stop · review required' : `Module ends · ${OUTCOME_LABEL[code]}`, slots: [], issues: 0, main: code === 'COMPLETED', width: code === 'COMPLETED' ? 220 : 236, height: 38 });
  }
  return { nodes: visibleNodes, edges: visibleEdges.filter((e) => have.has(e.target) && have.has(e.source)), flow, lanes };
}

/**
 * Deterministic top-to-bottom layout. The ranking and ordering come from dagre; afterwards every row is shifted
 * sideways so the normal journey (`main` nodes) is one straight vertical spine, with branches hanging off it. Rows that
 * hold no spine step keep the shift of the row above, so a branch stays beside the part of the journey it left.
 */
export function layoutGraph(nodes: Array<{ id: string; width: number; height: number; main?: boolean }>, edges: Array<{ source: string; target: string; main?: boolean; label?: string }>): Map<string, { x: number; y: number }> {
  const g = new Graph({ multigraph: true });
  g.setGraph({ rankdir: 'TB', nodesep: 44, ranksep: 50, edgesep: 22, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  edges.forEach((e, i) => g.setEdge(e.source, e.target, { weight: e.main ? 12 : 1, minlen: 1, width: e.label ? Math.min(170, e.label.length * 6) : 0, height: e.label ? 18 : 0, labelpos: 'c' }, `e${i}`));
  dagreLayout(g);
  // where the spine's own edges pass through the rows between two spine steps (so a branch never sits on the spine line)
  const through: Array<{ x: number; y: number }> = [];
  edges.forEach((e, i) => { if (e.main) through.push(...((g.edge(e.source, e.target, `e${i}`) as { points?: Array<{ x: number; y: number }> }).points ?? [])); });
  const at = new Map(nodes.map((n) => [n.id, g.node(n.id) as { x: number; y: number }]));
  const rows = new Map<number, typeof nodes>();
  for (const n of nodes) { const y = Math.round(at.get(n.id)!.y); rows.set(y, [...(rows.get(y) ?? []), n]); }
  const spineX = (() => { const first = nodes.find((n) => n.main); return first ? at.get(first.id)!.x : 0; })();
  const out = new Map<string, { x: number; y: number }>();
  let shift = 0;
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(y)!;
    const anchor = row.find((n) => n.main);
    if (anchor) shift = spineX - at.get(anchor.id)!.x;
    else {
      const near = through.filter((p) => Math.abs(p.y - y) < 40).sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0];
      if (near) shift = spineX - near.x;
    }
    for (const n of row) { const p = at.get(n.id)!; out.set(n.id, { x: Math.round(p.x + shift - n.width / 2), y: Math.round(p.y - n.height / 2) }); }
  }
  return out;
}

// ---- gestures → the SAME operations the Guided view uses ----------------------------------------------------------
/** Why a connection is not allowed, in the author's words — or null when it is. Mirrors what the Guided pickers offer. */
export function connectProblem(ws: Workspace, m: Module, source: string, via: string, targetId: string): string | null {
  const from = m.nodes.find((x) => x.id === source);
  if (!from) return 'Routes start from a question or a condition.';
  if (via.startsWith('INT:') || via === 'NEXT' || via === 'ENTRY') return 'This route is set on the step itself, not by connecting.';
  const target = targetOfNodeId(targetId);
  if (!target) return 'Connect to a question, a condition or an outcome.';
  if ('node' in target) {
    if (target.node === source) return 'A step cannot lead to itself.';
    const to = m.nodes.find((x) => x.id === target.node);
    if (!to) return 'That step is not in this module.';
    if (isQuestion(to) && to.role === 'FOLLOWUP') return 'A follow-up question belongs to its queue and cannot be a destination.';
  }
  if ('outcome' in target && target.outcome === 'REVIEW_REQUIRED' && !(via === 'UNKNOWN' && !isQuestion(from))) return 'Review required is reached only by “Stop and flag for review”.';
  if (isQuestion(from)) {
    const q = findQuestion(ws, from.q);
    const must = q?.options.find((o) => o.code === via)?.interrupt === 'MANDATORY';
    if (must && !('outcome' in target && ESCALATION_OUTCOMES.includes(target.outcome))) return 'This answer is a mandatory escalation: it can only lead to an approved escalation outcome.';
  }
  return null;
}

/** Re-points one route. Dispatches to the existing operations; it adds no rule of its own. */
export function connectRoute(ws: Workspace, moduleKey: string, source: string, via: string, target: Target): Workspace {
  const m = findModule(ws, moduleKey)!;
  const from = m.nodes.find((x) => x.id === source)!;
  if (via === 'REJOIN') return setRejoin(ws, moduleKey, source, target);
  if (via === 'FALLBACK') return setFallback(ws, moduleKey, source, target);
  if (via.startsWith('RULE:')) return updateRule(ws, moduleKey, source, via.slice(5), { to: target });
  if (via === 'UNKNOWN' && !isQuestion(from)) return setDecisionUnknown(ws, moduleKey, source, 'outcome' in target && target.outcome === 'REVIEW_REQUIRED' ? { stop: true } : { to: target });
  return setEdge(ws, moduleKey, source, via, target);
}

/**
 * Why a route cannot be disconnected — or null when it can. Disconnecting leaves the route UNDECIDED in the draft (a
 * validation blocker until a destination is chosen); it never removes the step, the answer or the former destination.
 */
export function disconnectProblem(m: Module, source: string, via: string): string | null {
  const from = m.nodes.find((x) => x.id === source);
  if (!from) return 'This line shows structure; it is not a route of its own.';
  if (via.startsWith('INT:')) return 'This route is part of the answer’s interruption rule. Change it on the answer.';
  if (via === 'NEXT' || via === 'ENTRY') return 'This line shows structure; it is not a route of its own.';
  return null;
}

/** Disconnects one route: the same "leave undecided" the Guided destination picker offers, through the same operations. */
export function disconnectRoute(ws: Workspace, moduleKey: string, source: string, via: string): Workspace {
  const from = findModule(ws, moduleKey)!.nodes.find((x) => x.id === source)!;
  if (via === 'REJOIN') return setRejoin(ws, moduleKey, source, null);
  if (via === 'FALLBACK') return setFallback(ws, moduleKey, source, null);
  if (via.startsWith('RULE:')) return updateRule(ws, moduleKey, source, via.slice(5), { to: null });
  if (via === 'UNKNOWN' && !isQuestion(from)) return setDecisionUnknown(ws, moduleKey, source, { clear: true });
  return setEdge(ws, moduleKey, source, via, null);
}

// ---- the survey-level graph: module instances, entry conditions, named outcomes and transitions ---------------------
export interface SNode {
  id: string;
  main?: boolean;
  kind: 'START' | 'INSTANCE' | 'END' | 'OUTCOME';
  title: string;
  subtitle?: string;
  moduleKind?: ModuleKind;
  version?: string;
  questions?: number;
  index?: number;
  /** One per named outcome; plus '@SKIP' ("if it does not apply") when a jump can arrive at a module that has an eligibility condition. */
  slots: Array<{ via: string; label: string; target: SurveyTarget | null; undecided: boolean; connect: boolean }>;
  issues: number;
  outcome?: OutcomeCode;
  width: number;
  height: number;
}
/** The route key of a module's skip disposition in the survey graph. */
export const SKIP = '@SKIP';
/** The route key of a module's skip disposition when it is reached in sequence (shown only when one is configured). */
export const SKIP_SEQ = '@SKIP_SEQ';
export interface SurveyGraph { nodes: SNode[]; edges: GEdge[] }

export function surveyGraph(ws: Workspace, s: Survey, issues: Issue[], entryText: (instanceId: string) => string): SurveyGraph {
  const nodes: SNode[] = [{ id: 'start', kind: 'START', title: 'Start of call', slots: [], issues: 0, main: true, width: 150, height: 36 }];
  const edges: GEdge[] = [];
  const END = 'end:COMPLETED';
  if (s.sequence[0]) edges.push({ id: 'start|ENTRY', source: 'start', handle: 'ENTRY', target: s.sequence[0].id, label: '', tone: 'normal', main: true, synthetic: true, why: 'Where the call starts: the first module in the order. Reorder the modules to change it.' });
  s.sequence.forEach((inst, i) => {
    const m = findModule(ws, mKey(inst.module));
    if (!m) return;
    const runs = entryText(inst.id);
    const slots: SNode['slots'] = m.outcomes.map((o) => ({ via: o, label: OUTCOME_LABEL[o], target: inst.routes[o] ?? null, undecided: (inst.routes[o] ?? null) === null, connect: o !== 'REVIEW_REQUIRED' }));
    const must = mandatoryOutcomes(ws, m);
    const terminal = escalationOutcomes(m);
    if (canBeIneligible(inst) && inst.ifSkippedInSequence !== undefined) slots.push({ via: SKIP_SEQ, label: 'If it does not apply (in sequence)', target: inst.ifSkippedInSequence, undecided: inst.ifSkippedInSequence === null, connect: true });
    if (jumpSources(s, inst.id).length && canBeIneligible(inst)) slots.push({ via: SKIP, label: 'If it does not apply', target: inst.ifIneligible ?? null, undecided: (inst.ifIneligible ?? null) === null, connect: true });
    nodes.push({
      id: inst.id, kind: 'INSTANCE', main: true, title: m.name, subtitle: `Runs ${runs}`, moduleKind: m.kind, index: i,
      version: m.published ? `v${m.revision}` : `draft v${m.revision}`, questions: m.nodes.filter((x) => x.type === 'QUESTION').length,
      slots, issues: issues.filter((x) => x.where.instanceId === inst.id).length, width: 300, height: 62 + lines(runs, 40, 2) * 18 + Math.max(1, slots.length) * ROW_H + 10,
    });
    for (const sl of slots) {
      const t = sl.target;
      if (t === null) continue;
      let to: string;
      if (t === '@CONTINUE') to = s.sequence[i + 1]?.id ?? END;
      else if ('instance' in t) { if (!s.sequence.some((x) => x.id === t.instance)) continue; to = t.instance; }
      else to = `sout:${t.surveyOutcome}@${inst.id}`;
      const jump = t !== '@CONTINUE' && 'instance' in t;
      if (sl.via === SKIP || sl.via === SKIP_SEQ) { edges.push({ id: `${inst.id}|${sl.via}`, source: inst.id, handle: sl.via, target: to, route: sl.label, label: sl.via === SKIP ? 'if it does not apply' : 'if it does not apply · in sequence', tone: 'unknown', main: false }); continue; }
      edges.push({ id: `${inst.id}|${sl.via}`, source: inst.id, handle: sl.via, target: to, route: sl.label, ...(sl.connect ? {} : { fixed: true, owner: inst.id, why: 'Review required is governed: the call halts and waits for an authorised review. It cannot be disconnected or routed elsewhere.' }), label: must.includes(sl.via as OutcomeCode) && !jump ? `${sl.label} · mandatory escalation` : terminal.includes(sl.via as OutcomeCode) && !jump ? `${sl.label} · ends the call` : jump ? `${sl.label} · jumps` : sl.label, tone: sl.via === 'COMPLETED' ? 'normal' : sl.via === 'REVIEW_REQUIRED' ? 'unknown' : 'alt', main: t === '@CONTINUE' && sl.via === 'COMPLETED' });
    }
  });
  const have = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (have.has(e.target)) continue;
    have.add(e.target);
    if (e.target === END) nodes.push({ id: END, kind: 'END', main: true, title: 'End of call · Completed', slots: [], issues: 0, width: 220, height: 38 });
    else {
      const code = e.target.slice(5).split('@')[0] as OutcomeCode;
      nodes.push({ id: e.target, kind: 'OUTCOME', outcome: code, title: code === 'REVIEW_REQUIRED' ? 'Call halts · review required' : `End of call · ${OUTCOME_LABEL[code]}`, slots: [], issues: 0, width: 250, height: 38 });
    }
  }
  if (!have.has(END)) nodes.push({ id: END, kind: 'END', main: true, title: 'End of call · Completed', slots: [], issues: 0, width: 220, height: 38 });
  return { nodes, edges };
}

/** A survey-level connection as a route, or the reason it is not allowed. Uses the Composer's own rules. */
export function surveyRouteFor(s: Survey, source: string, via: string, targetId: string, ws?: Workspace): { target: SurveyTarget } | { problem: string } {
  const from = s.sequence.findIndex((x) => x.id === source);
  if (from < 0) return { problem: 'Routes start from a module outcome.' };
  // a mandatory escalation cannot be overridden by survey-level routing (A-4)
  const mod = ws ? findModule(ws, mKey(s.sequence[from]!.module)) : undefined;
  if (ws && mod && (escalationOutcomes(mod) as string[]).includes(via) && targetId.slice(5).split('@')[0] !== via) {
    return { problem: (mandatoryOutcomes(ws, mod) as string[]).includes(via)
      ? `“${OUTCOME_LABEL[via as OutcomeCode]}” of ${mod.name} is a mandatory escalation: it can only end the call with “${OUTCOME_LABEL[via as OutcomeCode]}”. Survey routing cannot override it.`
      : `“${OUTCOME_LABEL[via as OutcomeCode]}” of ${mod.name} is an escalation: it can only end the call with “${OUTCOME_LABEL[via as OutcomeCode]}”. An escalation is never continued or re-routed.` };
  }
  if (via === 'REVIEW_REQUIRED') return { problem: 'Review required always halts the call; it cannot be routed elsewhere.' };
  if (targetId === 'end:COMPLETED') return from === s.sequence.length - 1 ? { target: '@CONTINUE' } : { problem: 'To end the call early, connect to one of the “End of call” outcomes, or route to the last module.' };
  if (targetId.startsWith('sout:')) {
    const code = targetId.slice(5).split('@')[0] as OutcomeCode;
    return code === 'REVIEW_REQUIRED' ? { problem: 'Review required is reached only when a module stops for review.' } : { target: { surveyOutcome: code } };
  }
  const to = s.sequence.findIndex((x) => x.id === targetId);
  if (to < 0) return { problem: 'Connect to a module or an end of the call.' };
  if (to <= from) return { problem: 'A route may only go to a later module.' };
  return { target: to === from + 1 ? '@CONTINUE' : { instance: targetId } };
}
/** Why a survey route cannot be disconnected, or null. A disconnected route is undecided in the draft, as in the Composer. */
export function surveyDisconnectProblem(s: Survey, source: string, via: string): string | null {
  if (!s.sequence.some((x) => x.id === source)) return 'This line shows where the call starts; it is not a route of its own.';
  if (via === 'REVIEW_REQUIRED') return 'Review required is governed: the call halts and waits for an authorised review. It cannot be disconnected or routed elsewhere.';
  return null;
}
export const disconnectSurveyRoute = (ws: Workspace, surveyId: string, instanceId: string, outcome: string): Workspace =>
  (outcome === SKIP ? setIfIneligible(ws, surveyId, instanceId, null) : outcome === SKIP_SEQ ? setIfSkippedInSequence(ws, surveyId, instanceId, null) : setRoute(ws, surveyId, instanceId, outcome, null));
export const connectSurveyRoute = (ws: Workspace, surveyId: string, instanceId: string, outcome: string, target: SurveyTarget): Workspace =>
  (outcome === SKIP ? setIfIneligible(ws, surveyId, instanceId, target) : outcome === SKIP_SEQ ? setIfSkippedInSequence(ws, surveyId, instanceId, target) : setRoute(ws, surveyId, instanceId, outcome, target));

export { canonical, fingerprint } from './canonical';
