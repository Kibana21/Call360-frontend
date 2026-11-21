// SS-02B.2 — the Graph view is a second READING of the one canonical model. These tests assert that with canonical
// snapshots: an edit made by a graph gesture and the equivalent edit made in the Guided view give the identical model.
import { describe, expect, it } from 'vitest';
import { buildFlow, validateModule, validateSurvey } from './flow';
import {
  canonical, connectProblem, connectRoute, connectSurveyRoute, disconnectProblem, disconnectRoute, disconnectSurveyRoute, fingerprint, layoutGraph, moduleGraph, slotsOf, surveyDisconnectProblem,
  surveyGraph, surveyRouteFor, targetOfNodeId,
} from './graph';
import { addLargeModule } from './large';
import {
  addInstance, createSurvey, deriveModule, findModule, insertDecision, insertQuestion, moveInstance, routesFrom, setDecisionUnknown, setEdge, setFallback, setMode, setRejoin, setRoute,
  addOption, addRule, updateRule,
} from './ops';
import { sampleWorkspace } from './sample';
import { isQuestion, type Workspace } from './types';

const large = () => { const [ws, key] = addLargeModule(sampleWorkspace()); return { ws, key, m: findModule(ws, key)! }; };
const draft = () => {
  const [w1, surveyId] = createSurvey(sampleWorkspace(), { name: 'Parity', purpose: '', modules: ['M-GENERAL', 'M-SUITABILITY', 'M-AFFORDABILITY', 'M-CLOSING'] });
  const [ws, key] = deriveModule(w1, surveyId, 'mi-suitability');
  return { ws, surveyId, key };
};

describe('the 40-question module', () => {
  it('is a valid module with 40 questions, two conditions and every kind of routing', () => {
    const { ws, m } = large();
    expect(m.nodes.filter(isQuestion)).toHaveLength(40);
    expect(m.nodes.filter((n) => !isQuestion(n))).toHaveLength(2);
    expect(validateModule(ws, m)).toEqual([]);
    expect(new Set(m.nodes.filter(isQuestion).map((n) => n.routing.mode))).toEqual(new Set(['ALL_TO_NEXT', 'PER_CHOICE', 'SEQUENTIAL_FOLLOWUPS', 'ORDERED_RULES']));
  });

  it('draws every step exactly once, however many routes lead to it', () => {
    const { ws, m } = large();
    const g = moduleGraph(ws, m);
    const steps = g.nodes.filter((n) => n.kind === 'QUESTION' || n.kind === 'DECISION').map((n) => n.id);
    expect(steps.slice().sort()).toEqual(m.nodes.map((n) => n.id).sort()); // no step missing, none duplicated
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length);
    // two answers of n6 merge into ONE question: one node, and one edge PER ROUTE so each can be edited on its own
    const into27 = g.edges.filter((e) => e.target === 'n27');
    expect(into27.map((e) => [e.id, e.handle, e.route])).toEqual([['n6|BY_PHONE', 'BY_PHONE', 'By phone'], ['n6|IN_WRITING', 'IN_WRITING', 'In writing only']]);
    expect(g.nodes.filter((n) => n.id === 'n27')).toHaveLength(1);
    expect(g.edges.filter((e) => e.target === 'n7').map((e) => e.source).sort()).toEqual(['n27', 'n6']); // a shared destination with two incoming edges
  });

  it('shows every canonical route: each routed slot has an edge to its destination, and nothing else is invented', () => {
    const { ws, m } = large();
    const g = moduleGraph(ws, m);
    const has = (s: string, t: string) => g.edges.some((e) => e.source === s && e.target === t);
    for (const entry of [...g.flow.main, ...g.flow.orphans]) {
      const walk = (e: typeof entry): void => {
        for (const s of slotsOf(ws, m, e)) {
          if (!s.target || 'ret' in s.target) continue;
          if (s.via === 'REJOIN' && isQuestion(e.node) && (e.node.routing.followups ?? []).length) continue; // drawn at the end of the queue chain
          const to = 'node' in s.target ? s.target.node : `out:${s.target.outcome}${s.target.outcome === 'COMPLETED' ? '' : `@${e.node.id}`}`;
          expect(has(e.node.id, to), `${e.node.id} —${s.via}→ ${to}`).toBe(true);
        }
        e.rows.forEach((r) => r.lane.forEach(walk));
      };
      walk(entry);
    }
    // conversely: every non-synthetic edge is a real route of the canonical model
    for (const e of g.edges.filter((x) => !x.synthetic && x.source !== 'start')) {
      const from = m.nodes.find((n) => n.id === e.source)!;
      const target = targetOfNodeId(e.target)!;
      expect(routesFrom(m, from).some((r) => JSON.stringify(r.to) === JSON.stringify(target)), e.id).toBe(true);
    }
  });

  it('follow-ups are a chain in asking order with an explicit rejoin', () => {
    const { ws, m } = large();
    const g = moduleGraph(ws, m);
    const chain = g.edges.filter((e) => e.id.startsWith('n12|QUEUE')).map((e) => `${e.source}>${e.target}:${e.label}`);
    expect(chain).toEqual(['n12>n32:1 · if “Surrender value”', 'n32>n33:2 · if “Claims”', 'n33>n34:3 · if “Charges”', 'n34>n13:then rejoins']);
  });

  it('a mandatory escalation has exactly one way out, to an escalation outcome — no bypass edge exists', () => {
    const { ws, m } = large();
    const g = moduleGraph(ws, m);
    const must = slotsOf(ws, m, g.flow.main.find((e) => e.node.id === 'n17')!).find((s) => s.must)!;
    expect(must.target).toEqual({ outcome: 'ESCALATE' });
    expect(g.edges.filter((e) => e.source === 'n17' && e.tone === 'escalate').map((e) => e.target)).toEqual(['out:ESCALATE@n17']);
    // and a graph gesture cannot create one
    expect(connectProblem(ws, m, 'n17', 'PRESSURED', 'n18')).toMatch(/mandatory escalation/);
    expect(connectProblem(ws, m, 'n17', 'PRESSURED', 'out:COMPLETED')).toMatch(/mandatory escalation/);
    expect(connectProblem(ws, m, 'n17', 'PRESSURED', 'out:CLARIFICATION_REQUIRED@n15')).toMatch(/mandatory escalation/);
    expect(connectProblem(ws, m, 'n17', 'PRESSURED', 'out:ESCALATE@n17')).toBeNull();
    expect(connectProblem(ws, m, 'n12', 'INT:NEVER_AGREED', 'n13')).not.toBeNull();
  });

  it('collapsing branches keeps the picture truthful: stubs replace steps, every edge still has both ends', () => {
    const { ws, m } = large();
    const open = moduleGraph(ws, m);
    const closed = moduleGraph(ws, m, new Set(open.lanes));
    expect(open.lanes.length).toBeGreaterThanOrEqual(7);
    expect(closed.nodes.length).toBeLessThan(open.nodes.length);
    expect(closed.nodes.filter((n) => n.kind === 'STUB')).toHaveLength(open.lanes.length);
    const ids = new Set(closed.nodes.map((n) => n.id));
    for (const e of closed.edges) { expect(ids.has(e.source), e.id).toBe(true); expect(ids.has(e.target), e.id).toBe(true); }
    // the spine is still there, and each stub still says where its branch goes
    for (const k of [1, 2, 3, 4, 12, 24]) expect(ids.has(`n${k}`)).toBe(true);
    expect(closed.edges.some((e) => e.source === 'stub:n3:NO' && e.target === 'n4')).toBe(true);
    expect(closed.edges.some((e) => e.source === 'stub:n12:followups' && e.target === 'n13')).toBe(true);
  });

  it('lays out deterministically, without overlapping cards, and keeps the normal journey in reading order', () => {
    const { ws, m } = large();
    const g = moduleGraph(ws, m);
    const a = layoutGraph(g.nodes, g.edges), b = layoutGraph(g.nodes, g.edges);
    expect([...a]).toEqual([...b]);
    const box = g.nodes.map((n) => ({ n, ...a.get(n.id)! }));
    for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) {
      const p = box[i]!, q = box[j]!;
      const apart = p.x + p.n.width <= q.x || q.x + q.n.width <= p.x || p.y + p.n.height <= q.y || q.y + q.n.height <= p.y;
      expect(apart, `${p.n.id} overlaps ${q.n.id}`).toBe(true);
    }
    const spine = buildFlow(ws, m).main.map((e) => a.get(e.node.id)!.y);
    expect(spine).toEqual([...spine].sort((x, y) => x - y));
  });
});

describe('Guided / Graph parity: equivalent edits give the identical canonical model', () => {
  const same = (a: Workspace, b: Workspace) => { expect(canonical(a)).toBe(canonical(b)); expect(fingerprint(a)).toBe(fingerprint(b)); };

  it('re-pointing an answer: Guided destination picker ≡ graph connection', () => {
    const { ws, key } = draft();
    const m = findModule(ws, key)!;
    const src = m.nodes.filter(isQuestion).find((n) => n.routing.mode === 'PER_CHOICE')!;
    const other = m.nodes.find((n) => n.id !== src.id && isQuestion(n) && n.role !== 'FOLLOWUP')!;
    expect(connectProblem(ws, m, src.id, 'NO', other.id)).toBeNull();
    same(setEdge(ws, key, src.id, 'NO', { node: other.id }), connectRoute(ws, key, src.id, 'NO', targetOfNodeId(other.id)!));
    same(setEdge(ws, key, src.id, 'NO', { outcome: 'ESCALATE' }), connectRoute(ws, key, src.id, 'NO', targetOfNodeId(`out:ESCALATE@${src.id}`)!));
  });

  it('a decision: three routes, including Unknown → stop for review', () => {
    const { ws, key } = draft();
    const first = findModule(ws, key)!.nodes[0]!;
    const [w, d] = insertDecision(ws, key, { entry: true });
    same(setEdge(w, key, d, 'MATCH', { node: first.id }), connectRoute(w, key, d, 'MATCH', { node: first.id }));
    same(setDecisionUnknown(w, key, d, { to: { outcome: 'UNABLE_TO_VERIFY' } }), connectRoute(w, key, d, 'UNKNOWN', targetOfNodeId(`out:UNABLE_TO_VERIFY@${d}`)!));
    same(setDecisionUnknown(w, key, d, { stop: true }), connectRoute(w, key, d, 'UNKNOWN', targetOfNodeId(`out:REVIEW_REQUIRED@${d}`)!));
    expect(connectProblem(w, findModule(w, key)!, first.id, 'ANY', `out:REVIEW_REQUIRED@${d}`)).toMatch(/Stop and flag for review/); // not an ordinary destination
  });

  it('a follow-up rejoin, a rule destination and a rule fallback', () => {
    const { ws, key } = draft();
    const [w0, id] = insertQuestion(ws, key, { entry: true }, { type: 'MULTI_SELECT' });
    let w = addOption(addOption(w0, key, id, 'A'), key, id, 'B');
    const fu = setMode(w, key, id, 'SEQUENTIAL_FOLLOWUPS');
    same(setRejoin(fu, key, id, { outcome: 'COMPLETED' }), connectRoute(fu, key, id, 'REJOIN', targetOfNodeId('out:COMPLETED')!));
    w = setMode(w, key, id, 'ORDERED_RULES');
    const [wr, rid] = addRule(w, key, id);
    same(updateRule(wr, key, id, rid, { to: { outcome: 'ESCALATE' } }), connectRoute(wr, key, id, `RULE:${rid}`, { outcome: 'ESCALATE' }));
    same(setFallback(wr, key, id, { outcome: 'CLARIFICATION_REQUIRED' }), connectRoute(wr, key, id, 'FALLBACK', { outcome: 'CLARIFICATION_REQUIRED' }));
  });

  it('adding a question on a route gives the same model and the same stable id from either view', () => {
    const { ws, key } = draft();
    const g = moduleGraph(ws, findModule(ws, key)!);
    const e = g.edges.find((x) => x.insert && 'from' in x.insert)!;
    const [viaGraph, idG] = insertQuestion(ws, key, e.insert!, { type: 'YES_NO' }); // the graph's "+" on an edge carries the same InsertAt
    const at = e.insert as { from: string; on: string };
    const [viaGuided, idQ] = insertQuestion(ws, key, { from: at.from, on: at.on }, { type: 'YES_NO' });
    expect(idG).toBe(idQ);
    same(viaGraph, viaGuided);
    // and the graph of the result has the new step exactly once
    expect(moduleGraph(viaGraph, findModule(viaGraph, key)!).nodes.filter((n) => n.id === idG)).toHaveLength(1);
  });

  it('survey level: a graph connection is the Composer route; backwards and governed routes are refused', () => {
    const { ws, surveyId } = draft();
    const s = () => ws.surveys.find((x) => x.id === surveyId)!;
    const ids = s().sequence.map((x) => x.id);
    const jump = surveyRouteFor(s(), ids[1]!, 'CLARIFICATION_REQUIRED', ids[3]!);
    expect(jump).toEqual({ target: { instance: ids[3] } });
    same(setRoute(ws, surveyId, ids[1]!, 'CLARIFICATION_REQUIRED', { instance: ids[3]! }), connectSurveyRoute(ws, surveyId, ids[1]!, 'CLARIFICATION_REQUIRED', (jump as { target: never }).target));
    expect(surveyRouteFor(s(), ids[1]!, 'COMPLETED', ids[2]!)).toEqual({ target: '@CONTINUE' }); // the next module is "continue", not a jump
    expect(surveyRouteFor(s(), ids[2]!, 'COMPLETED', ids[0]!)).toEqual({ problem: 'A route may only go to a later module.' });
    expect(surveyRouteFor(s(), ids[2]!, 'REVIEW_REQUIRED', ids[3]!)).toHaveProperty('problem');
    expect(surveyRouteFor(s(), ids[1]!, 'CLARIFICATION_REQUIRED', `sout:ESCALATE@${ids[1]}`)).toEqual({ target: { surveyOutcome: 'ESCALATE' } });
  });

  it('the survey graph follows the Composer: one node per module instance, edges per outcome, reorder re-draws them', () => {
    const { ws, surveyId } = draft();
    const s = ws.surveys.find((x) => x.id === surveyId)!;
    const g = surveyGraph(ws, s, validateSurvey(ws, s), () => 'always');
    expect(g.nodes.filter((n) => n.kind === 'INSTANCE').map((n) => n.id)).toEqual(s.sequence.map((x) => x.id));
    expect(g.nodes.filter((n) => n.kind === 'INSTANCE').every((n) => (n.questions ?? 0) > 0)).toBe(true); // modules are NOT expanded into questions
    expect(g.edges.find((e) => e.source === 'mi-general-verification' && e.handle === 'COMPLETED')!.target).toBe('mi-suitability');
    // REVIEW_REQUIRED is governed: fixed, drawn, not connectable
    const aff = g.nodes.find((n) => n.id === 'mi-affordability-check')!;
    expect(aff.slots.find((x) => x.via === 'REVIEW_REQUIRED')).toMatchObject({ connect: false, target: { surveyOutcome: 'REVIEW_REQUIRED' } });
    const moved = moveInstance(ws, surveyId, 1, 2);
    const s2 = moved.surveys.find((x) => x.id === surveyId)!;
    const g2 = surveyGraph(moved, s2, [], () => 'always');
    expect(g2.edges.find((e) => e.source === 'mi-general-verification' && e.handle === 'COMPLETED')!.target).toBe('mi-affordability-check');
    const [added] = addInstance(ws, surveyId, 4, 'M-CONCERNS@1');
    expect(surveyGraph(added, added.surveys.find((x) => x.id === surveyId)!, [], () => 'always').nodes.filter((n) => n.kind === 'INSTANCE')).toHaveLength(5);
  });

  it('the fingerprint depends on the model only, not on how an object happened to be built', () => {
    const { ws } = draft();
    const shuffled = JSON.parse(JSON.stringify(ws, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as object).reverse()) : v))) as Workspace;
    expect(fingerprint(shuffled)).toBe(fingerprint(ws));
    expect(fingerprint(setEdge(ws, draft().key, findModule(ws, draft().key)!.nodes[0]!.id, 'X', { outcome: 'ESCALATE' }))).not.toBe(fingerprint(ws));
  });
});

// ---- SS-02B.2.1: selecting, disconnecting and re-pointing a route ---------------------------------------------------
describe('connection editing goes through the canonical model', () => {
  const same = (a: Workspace, b: Workspace) => expect(canonical(a)).toBe(canonical(b));
  /**
   * The routes of a module by their IDENTITY — source step and route key — with their destinations. A route that is
   * disconnected and connected again is the same route; the edge record that carries it is a new record (new record id,
   * last in the list), so "the same routing" is compared on identities, and undo is what restores the record itself.
   */
  const routing = (w: Workspace, key: string) => { const m = findModule(w, key)!; return m.nodes.flatMap((n) => routesFrom(m, n).map((r) => `${n.id}|${r.via}→${JSON.stringify(r.to)}`)).sort(); };

  it('disconnecting a route removes the routing binding only: the step, its answer and the former destination all stay', () => {
    const { ws, key, m } = large();
    const off = disconnectRoute(ws, key, 'n3', 'NO');
    const m2 = findModule(off, key)!;
    expect(m2.edges.some((e) => e.from === 'n3' && e.on === 'NO')).toBe(false); // gone from the model, not merely hidden
    expect(m2.nodes.map((n) => n.id)).toEqual(m.nodes.map((n) => n.id)); // no step deleted or duplicated
    expect(off.questions).toEqual(ws.questions); // the answer option is untouched
    expect(m2.edges.filter((e) => e.from === 'n3').map((e) => e.on)).toEqual(['YES']); // the other route keeps its identity
    same(off, setEdge(ws, key, 'n3', 'NO', null)); // exactly Guided's "Leave undecided for now"
    // shown as incomplete, with a navigable issue, and the draft is not routing-complete
    const g = moduleGraph(off, m2);
    expect(slotsOf(off, m2, g.flow.main.find((e) => e.node.id === 'n3')!).find((s) => s.via === 'NO')).toMatchObject({ undecided: true, target: null });
    expect(g.edges.some((e) => e.id === 'n3|NO')).toBe(false);
    const issues = validateModule(off, m2);
    expect(issues.some((i) => i.severity === 'ERROR' && i.where.nodeId === 'n3' && i.where.on === 'NO')).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
    // reconnecting gives back exactly the previous routing; nothing else in the model differs
    const back = connectRoute(off, key, 'n3', 'NO', { node: 'n25' });
    expect(routing(back, key)).toEqual(routing(ws, key));
    expect(findModule(back, key)!.nodes).toEqual(m.nodes);
    expect(back.questions).toEqual(ws.questions);
  });

  it('works for every kind of route, each through the operation Guided uses', () => {
    const { ws, key } = large();
    same(disconnectRoute(ws, key, 'n6', 'BY_PHONE'), setEdge(ws, key, 'n6', 'BY_PHONE', null)); // single choice, option-specific
    same(disconnectRoute(ws, key, 'n1', 'ANY'), setEdge(ws, key, 'n1', 'ANY', null)); // everybody continues
    same(disconnectRoute(ws, key, 'd1', 'MATCH'), setEdge(ws, key, 'd1', 'MATCH', null)); // decision: matches
    same(disconnectRoute(ws, key, 'd1', 'NO_MATCH'), setEdge(ws, key, 'd1', 'NO_MATCH', null)); // decision: otherwise
    same(disconnectRoute(ws, key, 'd1', 'UNKNOWN'), setDecisionUnknown(ws, key, 'd1', { clear: true })); // decision: unknown
    same(disconnectRoute(ws, key, 'n12', 'REJOIN'), setRejoin(ws, key, 'n12', null)); // multi-select: after the follow-ups
    same(disconnectRoute(ws, key, 'n23', 'FALLBACK'), setFallback(ws, key, 'n23', null)); // multi-select rules: otherwise
    same(disconnectRoute(ws, key, 'n23', 'RULE:r1'), updateRule(ws, key, 'n23', 'r1', { to: null })); // one prioritised rule
    same(disconnectRoute(ws, key, 'n15', 'NO'), setEdge(ws, key, 'n15', 'NO', null)); // a module outcome connection
    // an Unknown route left undecided is flagged and is never read as "otherwise"
    const off = disconnectRoute(ws, key, 'd1', 'UNKNOWN');
    expect(validateModule(off, findModule(off, key)!).some((i) => i.where.nodeId === 'd1' && i.where.on === 'UNKNOWN')).toBe(true);
    // a mandatory escalation may be disconnected (the draft is then incomplete) but re-pointed only to an approved escalation outcome
    const esc = disconnectRoute(ws, key, 'n17', 'PRESSURED');
    const m = findModule(esc, key)!;
    expect(validateModule(esc, m).some((i) => i.where.nodeId === 'n17' && i.where.on === 'PRESSURED')).toBe(true);
    expect(connectProblem(esc, m, 'n17', 'PRESSURED', 'n18')).toMatch(/mandatory escalation/);
    expect(connectProblem(esc, m, 'n17', 'PRESSURED', 'out:ESCALATE@n17')).toBeNull();
    expect(routing(connectRoute(esc, key, 'n17', 'PRESSURED', { outcome: 'ESCALATE' }), key)).toEqual(routing(ws, key));
  });

  it('tells a business route from a line that only shows structure, and says where the structure is edited', () => {
    const { ws, m } = large();
    const g = moduleGraph(ws, m);
    const queue = g.edges.filter((e) => e.id.startsWith('n12|QUEUE'));
    expect(queue.every((e) => e.synthetic && e.owner === 'n12' && !!e.why)).toBe(true);
    expect(g.edges.find((e) => e.id === 'start|ENTRY')).toMatchObject({ synthetic: true });
    expect(g.edges.find((e) => e.id === 'n12|INT:NEVER_AGREED')).toMatchObject({ fixed: true, owner: 'n12' });
    expect(disconnectProblem(m, 'n12', 'INT:NEVER_AGREED')).toMatch(/interruption rule/);
    expect(disconnectProblem(m, 'n32', 'NEXT')).toMatch(/not a route of its own/);
    expect(disconnectProblem(m, 'n3', 'NO')).toBeNull();
    // every ordinary route is one edge with a stable identity: source step + route key
    const ordinary = g.edges.filter((e) => !e.synthetic);
    expect(new Set(ordinary.map((e) => e.id)).size).toBe(ordinary.length);
    expect(ordinary.every((e) => e.id === `${e.source}|${e.handle}`)).toBe(true);
  });

  it('survey level: disconnect is the Composer route set to undecided; the governed halt cannot be disconnected', () => {
    const { ws, surveyId } = draft();
    const s = ws.surveys.find((x) => x.id === surveyId)!;
    const off = disconnectSurveyRoute(ws, surveyId, 'mi-general-verification', 'COMPLETED');
    same(off, setRoute(ws, surveyId, 'mi-general-verification', 'COMPLETED', null));
    const s2 = off.surveys.find((x) => x.id === surveyId)!;
    expect(s2.sequence.map((x) => x.id)).toEqual(s.sequence.map((x) => x.id)); // both modules stay
    expect(validateSurvey(off, s2).some((i) => i.where.instanceId === 'mi-general-verification' && i.where.on === 'COMPLETED')).toBe(true);
    expect(surveyGraph(off, s2, [], () => 'always').edges.some((e) => e.id === 'mi-general-verification|COMPLETED')).toBe(false);
    same(connectSurveyRoute(off, surveyId, 'mi-general-verification', 'COMPLETED', '@CONTINUE'), ws);
    expect(surveyDisconnectProblem(s, 'mi-affordability-check', 'REVIEW_REQUIRED')).toMatch(/governed/);
    expect(surveyDisconnectProblem(s, 'mi-general-verification', 'COMPLETED')).toBeNull();
    expect(surveyGraph(ws, s, [], () => 'always').edges.find((e) => e.id === 'mi-affordability-check|REVIEW_REQUIRED')).toMatchObject({ fixed: true });
  });
});
