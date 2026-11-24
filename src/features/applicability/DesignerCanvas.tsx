// Survey Applicability (APPL-X1) — the Visual Logic Canvas: the same policy document as the cards, drawn as a graph.
// Facts and conditions flow into requirements, requirements into surveys, surveys into the selection plan. A saved
// condition is ONE node however many requirements use it. Laid out automatically, left to right; focus on one
// requirement, condition or survey to see only what leads to and from it. Results on the nodes come from the evaluator.
import dagre from '@dagrejs/dagre';
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useState } from 'react';
import { sentence } from './model/describe';
import type { Expr, Plan, Policy, Trace, Tri } from './model/types';
import { OUTCOME_WORD, outcomeTone } from './plan';
import { useAppl } from './store';
import { Icon, Picker, type IconName } from './ui';
import { surveysOf, shortName } from './usage';

type Kind = 'context' | 'fact' | 'condition' | 'logic' | 'requirement' | 'survey' | 'plan' | 'cluster';
interface NodeData extends Record<string, unknown> { kind: Kind; title: string; sub?: string; badge?: string; tone?: string; ref?: string; dim?: boolean; on?: boolean }
const ICON: Record<Kind, IconName> = { context: 'profile', fact: 'variable', condition: 'condition', logic: 'canvas', requirement: 'policy', survey: 'survey', plan: 'order', cluster: 'cards' };
const SIZE: Record<Kind, [number, number]> = { context: [170, 60], fact: [190, 54], condition: [190, 60], logic: [96, 40], requirement: [224, 66], survey: [250, 60], plan: [200, 104], cluster: [230, 66] };

function Box({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className={`ap-node kind-${data.kind}${data.tone ? ` is-${data.tone}` : ''}${data.dim ? ' dim' : ''}${data.on ? ' on' : ''}`} data-testid={`ap-node-${data.ref}`} data-tone={data.tone}>
      {data.kind !== 'context' ? <Handle type="target" position={Position.Left} /> : null}
      <span className="ap-node-icon"><Icon name={ICON[data.kind]} size={14} /></span>
      <span className="ap-node-text"><strong>{data.title}</strong>{data.sub ? <small>{data.sub}</small> : null}</span>
      {data.badge ? <span className="ap-node-badge">{data.badge}</span> : null}
      {data.kind !== 'plan' ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}
const nodeTypes = { box: Box };
const TRI_TONE: Record<Tri, string> = { TRUE: 'true', FALSE: 'false', UNKNOWN: 'unknown' };

export interface CanvasSelection { kind: 'requirement' | 'survey' | 'condition' | 'variable'; id: string }
interface Props { policy: Policy; plan?: Plan; selection: CanvasSelection | null; onSelect: (s: CanvasSelection | null) => void; focus: boolean; expand: boolean; query: string }
/** Above this many requirements the canvas opens as an overview by survey, and always shows one neighbourhood at a time. */
export const LARGE = 12;

function build(policy: Policy, look: ReturnType<typeof useAppl>['look'], data: ReturnType<typeof useAppl>['data'], plan: Plan | undefined, expand: boolean) {
  const nodes = new Map<string, NodeData>();
  const edges: { id: string; source: string; target: string; label?: string; kind?: string }[] = [];
  const results = new Map<string, Tri>();
  // the evaluator's trace gives every condition and test its result; index it by what the node stands for
  const index = (t?: Trace | null) => { if (!t) return; if (t.op === 'ref') results.set(`c:${t.condition}@${t.version}`, t.result); t.children?.forEach(index); };
  plan?.requirements.forEach((r) => { index(r.trace); r.choice?.alternatives.forEach((a) => index(a.trace)); });
  const link = (source: string, target: string, label?: string, kind?: string) => { const id = `${source}>${target}${kind ?? ''}`; if (!edges.some((e) => e.id === id)) edges.push({ id, source, target, label, kind }); };
  const put = (id: string, d: NodeData) => { if (!nodes.has(id)) nodes.set(id, d); return id; };
  put('ctx', { kind: 'context', title: 'The application', sub: policy.profiles.map((c) => data.profiles.find((p) => p.code === c)?.name ?? c).join(' + ') || 'Any profile', ref: 'ctx' });
  const nodeFor = (e: Expr, trace?: Trace | null): string => {
    if (e.op === 'ref') {
      const c = look.condition(e.condition);
      const id = `c:${e.condition}@${e.version}`;
      const inner = c ? (c.history?.find((h) => h.version === e.version)?.expr ?? c.expr) : null;
      const res = results.get(id);
      put(id, { kind: 'condition', title: c?.name ?? e.condition, sub: inner ? sentence(inner, look) : 'missing', badge: `v${e.version}`, tone: res ? TRI_TONE[res] : undefined, ref: `condition-${e.condition}` });
      if (inner && expand) {
        if (inner.op === 'all' || inner.op === 'any') inner.args.forEach((a) => link(nodeFor(a), id, inner.op === 'all' ? 'and' : 'or'));
        else if (inner.op === 'not') link(nodeFor(inner.arg), id, 'not');
        else if (inner.op === 'test') { link('ctx', nodeFor(inner), undefined, 'ctx'); link(nodeFor(inner), id); }
        else link(nodeFor(inner), id);
      } else link('ctx', id, undefined, 'ctx');
      return id;
    }
    if (e.op === 'test') {
      const v = look.variable(e.variable);
      const id = `t:${JSON.stringify(e)}`;
      put(id, { kind: 'fact', title: v?.name ?? e.variable, sub: sentence(e, look), tone: trace ? TRI_TONE[trace.result] : undefined, ref: `variable-${e.variable}` });
      link('ctx', id, undefined, 'ctx');
      return id;
    }
    const id = `g:${JSON.stringify(e)}`;
    put(id, { kind: 'logic', title: e.op === 'all' ? 'All of' : e.op === 'any' ? 'Any of' : 'Not', tone: trace ? TRI_TONE[trace.result] : undefined, ref: `logic-${nodes.size}` });
    (e.op === 'not' ? [e.arg] : e.args).forEach((a, i) => link(nodeFor(a, trace?.children?.[i]), id));
    return id;
  };
  policy.requirements.forEach((r) => {
    const res = plan?.requirements.find((x) => x.id === r.id);
    const rid = `r:${r.id}`;
    put(rid, { kind: 'requirement', title: r.name, sub: r.action.kind === 'CHOOSE_ONE' ? 'Choose one survey' : surveysOf(r).length > 1 ? `Include ${surveysOf(r).length} surveys` : 'Include', badge: res ? OUTCOME_WORD[res.outcome] : undefined, tone: res ? outcomeTone(res.outcome) : undefined, ref: `requirement-${r.id}` });
    if (r.when) link(nodeFor(r.when, res?.trace), rid, 'when'); else link('ctx', rid, 'always');
    surveysOf(r).forEach((s, i) => {
      const sid = `s:${s.code}`;
      const sel = plan?.selected.find((x) => x.survey.code === s.code);
      const pen = plan?.pending.some((x) => x.survey.code === s.code);
      put(sid, { kind: 'survey', title: s.name, sub: `version ${s.label ?? s.version}`, badge: sel ? `#${sel.position}` : pen ? '?' : undefined, tone: plan ? (sel ? 'true' : pen ? 'unknown' : 'false') : undefined, ref: `survey-${s.code}` });
      const alt = r.action.kind === 'CHOOSE_ONE' ? r.action.alternatives[i] : null;
      link(rid, sid, alt ? (alt.when ? `one of · when ${sentence(alt.when, look)}` : 'one of · otherwise') : 'requires', alt ? 'alt' : undefined);
    });
    r.replaces.forEach((t) => link(rid, `r:${t}`, 'replaces', 'replace'));
  });
  put('plan', { kind: 'plan', title: 'Selection plan', sub: plan ? (plan.selected.length ? plan.selected.map((e) => `${e.position}. ${shortName(e.survey.name)}`).join('  ') : plan.status === 'RESOLVED' ? 'No survey required' : 'Not decided') : 'Pick a scenario to preview', badge: plan ? (plan.status === 'RESOLVED' ? 'Decided' : 'Not decided') : undefined, tone: plan ? (plan.status === 'RESOLVED' ? 'true' : 'unknown') : undefined, ref: 'plan' });
  [...nodes.keys()].filter((k) => k.startsWith('s:')).forEach((sid) => { const pos = policy.order.indexOf(sid.slice(2)); link(sid, 'plan', pos >= 0 ? `order ${pos + 1}` : undefined); });
  return { nodes, edges };
}

/** A large policy as an overview: for each survey, how many requirements can select it. Selecting one opens its neighbourhood. */
function clusters(policy: Policy, data: ReturnType<typeof useAppl>['data'], plan: Plan | undefined) {
  const nodes = new Map<string, NodeData>();
  const edges: { id: string; source: string; target: string; label?: string; kind?: string }[] = [];
  nodes.set('ctx', { kind: 'context', title: 'The application', sub: policy.profiles.map((c) => data.profiles.find((p) => p.code === c)?.name ?? c).join(' + ') || 'Any profile', ref: 'ctx' });
  const by = new Map<string, { name: string; label: string; reqs: string[] }>();
  policy.requirements.forEach((r) => surveysOf(r).forEach((s) => { const e = by.get(s.code) ?? { name: s.name, label: String(s.label ?? s.version), reqs: [] }; e.reqs.push(r.id); by.set(s.code, e); }));
  [...by.entries()].forEach(([code, e]) => {
    const active = plan?.requirements.filter((x) => e.reqs.includes(x.id) && x.outcome === 'ACTIVE').length ?? 0;
    const sel = plan?.selected.find((x) => x.survey.code === code);
    nodes.set(`k:${code}`, { kind: 'cluster', title: `${e.reqs.length} requirement${e.reqs.length === 1 ? '' : 's'}`, sub: plan ? `${active} apply in the preview` : 'can select this survey', ref: `cluster-${code}`, tone: plan ? (active ? 'true' : 'false') : undefined });
    nodes.set(`s:${code}`, { kind: 'survey', title: shortName(e.name), sub: `version ${e.label}`, badge: sel ? `#${sel.position}` : undefined, tone: plan ? (sel ? 'true' : 'false') : undefined, ref: `survey-${code}` });
    edges.push({ id: `ctx>k:${code}`, source: 'ctx', target: `k:${code}`, kind: 'ctx' }, { id: `k:${code}>s:${code}`, source: `k:${code}`, target: `s:${code}`, label: 'require' }, { id: `s:${code}>plan`, source: `s:${code}`, target: 'plan' });
  });
  nodes.set('plan', { kind: 'plan', title: 'Selection plan', sub: plan ? (plan.selected.length ? plan.selected.map((e) => `${e.position}. ${shortName(e.survey.name)}`).join('  ') : plan.status === 'RESOLVED' ? 'No survey required' : 'Not decided') : 'Pick a scenario to preview', badge: plan ? (plan.status === 'RESOLVED' ? 'Decided' : 'Not decided') : undefined, tone: plan ? (plan.status === 'RESOLVED' ? 'true' : 'unknown') : undefined, ref: 'plan' });
  return { nodes, edges };
}

function layout(nodes: Map<string, NodeData>, edges: { source: string; target: string; kind?: string }[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 22, ranksep: 54, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((d, id) => g.setNode(id, { width: SIZE[d.kind][0], height: SIZE[d.kind][1] }));
  edges.forEach((e) => { if (e.kind !== 'replace') g.setEdge(e.source, e.target); });
  dagre.layout(g);
  return new Map([...nodes.keys()].map((id) => { const n = g.node(id); const [w, h] = SIZE[nodes.get(id)!.kind]; return [id, { x: n.x - w / 2, y: n.y - h / 2 }]; }));
}

const idOf = (s: CanvasSelection | null) => (!s ? null : s.kind === 'requirement' ? `r:${s.id}` : s.kind === 'survey' ? `s:${s.id}` : null);

function Inner({ policy, plan, selection, onSelect, focus, expand, query }: Props) {
  const { look, data } = useAppl();
  const flow = useReactFlow();
  const large = policy.requirements.length > LARGE;
  const full = useMemo(() => build(policy, look, data, plan, expand), [policy, look, data, plan, expand]);
  const anchor = useMemo(() => {
    if (selection?.kind === 'condition') return [...full.nodes.keys()].find((k) => k.startsWith(`c:${selection.id}@`)) ?? null;
    if (selection?.kind === 'variable') return [...full.nodes.entries()].find(([, d]) => d.ref === `variable-${selection.id}`)?.[0] ?? null;
    return idOf(selection);
  }, [selection, full]);
  const overview = large && !anchor && !query.trim();
  const graph = useMemo(() => (overview ? clusters(policy, data, plan) : full), [overview, policy, data, plan, full]);
  // everything that leads to the selection, and everything it leads to
  const related = useMemo(() => {
    if (!anchor || !graph.nodes.has(anchor)) return null;
    const keep = new Set([anchor]);
    const walk = (start: string, dir: 'up' | 'down') => { const todo = [start]; while (todo.length) { const n = todo.pop()!; graph.edges.forEach((e) => { if (e.kind === 'ctx' && dir === 'down') return; const next = dir === 'up' ? (e.target === n ? e.source : null) : e.source === n ? e.target : null; if (next && !keep.has(next)) { keep.add(next); todo.push(next); } }); } };
    walk(anchor, 'up'); walk(anchor, 'down');
    return keep;
  }, [anchor, graph]);
  const k = query.trim().toLowerCase();
  const hits = useMemo(() => (k ? new Set([...graph.nodes.entries()].filter(([, d]) => `${d.title} ${d.sub ?? ''}`.toLowerCase().includes(k)).map(([id]) => id)) : null), [graph, k]);
  // a large policy is never drawn whole: one neighbourhood (or the search hits) at a time
  // In a large policy a neighbourhood shows what DECIDES it and what it selects. The two book-end nodes — "the
  // application" every requirement starts from and "the selection" every survey ends in — say nothing about one
  // neighbourhood and cost two columns of width, so they are left to the overview.
  const local = large && related ? new Set([...related].filter((id) => { const k = graph.nodes.get(id)?.kind; return id === anchor || (k !== 'context' && k !== 'plan'); })) : related;
  const visible = (focus || large) && local ? local : large && hits && !overview ? new Set([...hits]) : null;
  // Only what is SHOWN is laid out. Laying out the whole of a large policy and then hiding most of it left the few
  // nodes that remain scattered across an enormous plane — the selection ended up far outside the viewport.
  const visibleKey = visible ? [...visible].sort().join('|') : '';
  const pos = useMemo(() => {
    if (!visible) return layout(graph.nodes, graph.edges);
    return layout(new Map([...graph.nodes.entries()].filter(([id]) => visible.has(id))), graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target)));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `visible` is a new Set each render; its members are the key
  }, [graph, visibleKey]);
  const nodes: Node<NodeData>[] = [...graph.nodes.entries()].filter(([id]) => !visible || visible.has(id)).map(([id, d]) => ({
    id, type: 'box', position: pos.get(id)!, width: SIZE[d.kind][0], height: SIZE[d.kind][1], draggable: false,
    data: { ...d, dim: (!!related && !related.has(id)) || (!!hits && !hits.has(id)), on: id === anchor || !!hits?.has(id) },
    ariaLabel: `${d.kind}: ${d.title}${d.badge ? `, ${d.badge}` : ''}`,
  }));
  const edges: Edge[] = graph.edges.filter((e) => !visible || (visible.has(e.source) && visible.has(e.target))).map((e) => {
    const lit = !!related && related.has(e.source) && related.has(e.target);
    return {
      id: e.id, source: e.source, target: e.target, type: 'smoothstep', label: e.kind === 'ctx' ? undefined : e.label,
      className: `ap-edge${e.kind ? ` kind-${e.kind}` : ''}${related && !lit ? ' dim' : ''}${lit ? ' lit' : ''}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 6,
    };
  });
  const sig = `${nodes.length}:${focus}:${expand}:${anchor ?? ''}:${overview}:${visibleKey}:${k}`;
  // After every change of what is shown, bring it into view: the search hits when searching, otherwise everything
  // shown. Twice — once when the nodes are placed and once after they are measured — so a slow first paint cannot
  // leave the old position in place. If even the smallest zoom cannot hold it all, the selection itself is centred.
  useEffect(() => {
    const fit = () => {
      void flow.fitView({ padding: 0.08, duration: 200, minZoom: 0.3, maxZoom: 1.1, nodes: hits?.size ? [...hits].map((id) => ({ id })) : undefined }).then(() => {
        const at = anchor && !hits?.size ? flow.getNode(anchor) : null;
        if (!at) { onScreen(); return; }
        const box = document.querySelector('.ap-canvas-stage')?.getBoundingClientRect();
        const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(anchor!)}"]`)?.getBoundingClientRect();
        if (box && el && (el.left < box.left || el.right > box.right || el.top < box.top || el.bottom > box.bottom)) void flow.setCenter(at.position.x + (at.width ?? 0) / 2, at.position.y + (at.height ?? 0) / 2, { zoom: Math.max(flow.getZoom(), 0.6), duration: 200 });
        onScreen();
      });
    };
    // Being inside the canvas is not being on the SCREEN: the canvas can start low on the page, under the policy's
    // bars, and reach below the window. When the person asked for something (a selection, a search), the page itself
    // is moved so that the whole canvas sits just under the fixed header — the zoom is not touched.
    const onScreen = () => {
      if (!anchor && !hits?.size) return;
      window.setTimeout(() => {
        const stage = document.querySelector('.ap-canvas-stage')?.getBoundingClientRect();
        const head = document.querySelector('.ap-top')?.getBoundingClientRect().bottom ?? 0;
        const want = anchor ? [`.react-flow__node[data-id="${CSS.escape(anchor)}"]`] : [...(hits ?? [])].slice(0, 12).map((id) => `.react-flow__node[data-id="${CSS.escape(id)}"]`);
        const rects = want.map((q) => document.querySelector(q)?.getBoundingClientRect()).filter(Boolean) as DOMRect[];
        if (!stage || !rects.length) return;
        const hidden = rects.some((r) => r.top < head || r.bottom > window.innerHeight);
        if (hidden) window.scrollBy({ top: stage.top - head - 8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }, 260);
    };
    const a = window.setTimeout(fit, 60), b = window.setTimeout(fit, 420);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `sig` stands for everything that changes what is shown
  }, [sig, flow]);
  const pick = (id: string) => {
    if (id.startsWith('k:')) onSelect({ kind: 'survey', id: id.slice(2) });
    else if (id.startsWith('r:')) onSelect({ kind: 'requirement', id: id.slice(2) });
    else if (id.startsWith('s:')) onSelect({ kind: 'survey', id: id.slice(2) });
    else if (id.startsWith('c:')) onSelect({ kind: 'condition', id: id.slice(2).split('@')[0]! });
    else if (id.startsWith('t:')) onSelect({ kind: 'variable', id: (JSON.parse(id.slice(2)) as { variable: string }).variable });
    else onSelect(null);
  };
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_, n) => pick(n.id)} onPaneClick={() => onSelect(null)} nodesConnectable={false} nodesDraggable={false} elementsSelectable nodesFocusable edgesFocusable={false}
      onNodesChange={(changes) => { const s = changes.find((c) => c.type === 'select' && c.selected); if (s && 'id' in s) pick(s.id); }} minZoom={0.3} maxZoom={1.6} fitView fitViewOptions={{ padding: 0.08, minZoom: 0.3, maxZoom: 1.1 }} proOptions={{ hideAttribution: true }} aria-label="Applicability logic canvas">
      <Background gap={22} size={1.2} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap pannable zoomable position="bottom-right" nodeClassName={(n) => `kind-${(n.data as NodeData).kind}`} ariaLabel="Overview of the canvas" />
    </ReactFlow>
  );
}

export function DesignerCanvas(props: Omit<Props, 'focus' | 'expand' | 'query'>) {
  const large = props.policy.requirements.length > LARGE;
  const [focus, setFocus] = useState(false);
  const [expand, setExpand] = useState(true);
  const [query, setQuery] = useState('');
  return (
    <div className="ap-canvas" data-testid="ap-canvas">
      <div className="ap-canvas-bar">
        <label className="ap-searchbox"><Icon name="search" size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find on the canvas" aria-label="Find on the canvas" data-testid="ap-canvas-search" /></label>
        <button type="button" role="switch" aria-checked={focus} className={`ap-switch${focus ? ' on' : ''}`} onClick={() => setFocus(!focus)} disabled={!props.selection} data-testid="ap-canvas-focus" title={props.selection ? 'Show only what leads to and from the selection' : 'Select something first'}><Icon name="eye" size={13} /> Focus on the selection</button>
        <button type="button" role="switch" aria-checked={expand} className={`ap-switch${expand ? ' on' : ''}`} onClick={() => setExpand(!expand)} data-testid="ap-canvas-expand"><Icon name="canvas" size={13} /> Show how conditions are built</button>
        {large ? <Picker label="Go to a requirement" testid="ap-canvas-goto" placeholder="Search requirements…" items={props.policy.requirements.map((r) => ({ id: r.id, label: r.name, hint: surveysOf(r).map((x) => shortName(x.name)).join(', '), icon: 'policy' as const }))} onPick={(id) => props.onSelect({ kind: 'requirement', id })} button={<span className="ap-btn quiet"><Icon name="policy" size={13} /> Go to a requirement</span>} /> : null}
        {large && props.selection ? <button type="button" className="ap-btn quiet" onClick={() => props.onSelect(null)} data-testid="ap-canvas-overview"><Icon name="cards" size={13} /> Back to the overview</button> : null}
        <span className="ap-spacer" />
        <ul className="ap-legend" aria-label="Legend"><li className="kind-fact"><i /> Fact</li><li className="kind-condition"><i /> Condition</li><li className="kind-requirement"><i /> Requirement</li><li className="kind-survey"><i /> Survey</li><li className="kind-replace"><i /> replaces</li></ul>
      </div>
      <div className="ap-canvas-stage"><ReactFlowProvider><Inner {...props} focus={focus} expand={expand} query={query} /></ReactFlowProvider></div>
      {large ? <p className="ap-canvas-large" data-testid="ap-canvas-large" data-mode={props.selection ? 'neighbourhood' : 'overview'}><Icon name="info" size={13} /> {props.policy.requirements.length} requirements are too many to read at once. {props.selection ? 'Showing only what leads to and from your selection.' : 'Showing an overview by survey: select a survey or a group to open its neighbourhood, search, or go to a requirement.'}</p> : null}
      <p className="ap-quiet ap-canvas-hint">Select a node to inspect or edit it. Tab moves between nodes; Enter selects. The card view is the same policy as a list.</p>
    </div>
  );
}
