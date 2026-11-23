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
import { Icon, type IconName } from './ui';
import { surveysOf } from './usage';

type Kind = 'context' | 'fact' | 'condition' | 'logic' | 'requirement' | 'survey' | 'plan';
interface NodeData extends Record<string, unknown> { kind: Kind; title: string; sub?: string; badge?: string; tone?: string; ref?: string; dim?: boolean; on?: boolean }
const ICON: Record<Kind, IconName> = { context: 'profile', fact: 'variable', condition: 'condition', logic: 'canvas', requirement: 'policy', survey: 'survey', plan: 'order' };
const SIZE: Record<Kind, [number, number]> = { context: [170, 60], fact: [190, 54], condition: [190, 60], logic: [96, 40], requirement: [224, 66], survey: [214, 60], plan: [200, 104] };

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
  put('plan', { kind: 'plan', title: 'Selection plan', sub: plan ? (plan.selected.length ? plan.selected.map((e) => `${e.position}. ${e.survey.name.split(' · ')[0]}`).join('  ') : plan.status === 'RESOLVED' ? 'No survey required' : 'Not decided') : 'Pick a scenario to preview', badge: plan ? (plan.status === 'RESOLVED' ? 'Decided' : 'Not decided') : undefined, tone: plan ? (plan.status === 'RESOLVED' ? 'true' : 'unknown') : undefined, ref: 'plan' });
  [...nodes.keys()].filter((k) => k.startsWith('s:')).forEach((sid) => { const pos = policy.order.indexOf(sid.slice(2)); link(sid, 'plan', pos >= 0 ? `order ${pos + 1}` : undefined); });
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
  const graph = useMemo(() => build(policy, look, data, plan, expand), [policy, look, data, plan, expand]);
  const pos = useMemo(() => layout(graph.nodes, graph.edges), [graph]);
  const anchor = useMemo(() => {
    if (selection?.kind === 'condition') return [...graph.nodes.keys()].find((k) => k.startsWith(`c:${selection.id}@`)) ?? null;
    if (selection?.kind === 'variable') return [...graph.nodes.entries()].find(([, d]) => d.ref === `variable-${selection.id}`)?.[0] ?? null;
    return idOf(selection);
  }, [selection, graph]);
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
  const visible = focus && related ? related : null;
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
  const sig = `${nodes.length}:${focus}:${expand}:${anchor ?? ''}`;
  useEffect(() => { const t = window.setTimeout(() => flow.fitView({ padding: 0.06, duration: 240, minZoom: 0.55, nodes: hits?.size ? [...hits].map((id) => ({ id })) : undefined }), 60); return () => window.clearTimeout(t); }, [sig, flow, hits]);
  const pick = (id: string) => {
    if (id.startsWith('r:')) onSelect({ kind: 'requirement', id: id.slice(2) });
    else if (id.startsWith('s:')) onSelect({ kind: 'survey', id: id.slice(2) });
    else if (id.startsWith('c:')) onSelect({ kind: 'condition', id: id.slice(2).split('@')[0]! });
    else if (id.startsWith('t:')) onSelect({ kind: 'variable', id: (JSON.parse(id.slice(2)) as { variable: string }).variable });
    else onSelect(null);
  };
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_, n) => pick(n.id)} onPaneClick={() => onSelect(null)} nodesConnectable={false} nodesDraggable={false} elementsSelectable nodesFocusable edgesFocusable={false}
      onNodesChange={(changes) => { const s = changes.find((c) => c.type === 'select' && c.selected); if (s && 'id' in s) pick(s.id); }} minZoom={0.3} maxZoom={1.6} fitView fitViewOptions={{ padding: 0.06, minZoom: 0.55 }} proOptions={{ hideAttribution: true }} aria-label="Applicability logic canvas">
      <Background gap={22} size={1.2} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap pannable zoomable position="bottom-right" nodeClassName={(n) => `kind-${(n.data as NodeData).kind}`} ariaLabel="Overview of the canvas" />
    </ReactFlow>
  );
}

export function DesignerCanvas(props: Omit<Props, 'focus' | 'expand' | 'query'>) {
  const [focus, setFocus] = useState(false);
  const [expand, setExpand] = useState(true);
  const [query, setQuery] = useState('');
  return (
    <div className="ap-canvas" data-testid="ap-canvas">
      <div className="ap-canvas-bar">
        <label className="ap-searchbox"><Icon name="search" size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find on the canvas" aria-label="Find on the canvas" data-testid="ap-canvas-search" /></label>
        <button type="button" role="switch" aria-checked={focus} className={`ap-switch${focus ? ' on' : ''}`} onClick={() => setFocus(!focus)} disabled={!props.selection} data-testid="ap-canvas-focus" title={props.selection ? 'Show only what leads to and from the selection' : 'Select something first'}><Icon name="eye" size={13} /> Focus on the selection</button>
        <button type="button" role="switch" aria-checked={expand} className={`ap-switch${expand ? ' on' : ''}`} onClick={() => setExpand(!expand)} data-testid="ap-canvas-expand"><Icon name="canvas" size={13} /> Show how conditions are built</button>
        <span className="ap-spacer" />
        <ul className="ap-legend" aria-label="Legend"><li className="kind-fact"><i /> Fact</li><li className="kind-condition"><i /> Condition</li><li className="kind-requirement"><i /> Requirement</li><li className="kind-survey"><i /> Survey</li><li className="kind-replace"><i /> replaces</li></ul>
      </div>
      <div className="ap-canvas-stage"><ReactFlowProvider><Inner {...props} focus={focus} expand={expand} query={query} /></ReactFlowProvider></div>
      <p className="ap-quiet ap-canvas-hint">Select a node to inspect or edit it. Tab moves between nodes; Enter selects. The card view is the same policy as a list.</p>
    </div>
  );
}
