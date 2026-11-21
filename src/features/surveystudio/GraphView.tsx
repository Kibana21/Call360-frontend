// Survey Studio prototype — the Graph view (SS-02B.2): the module question graph and the survey module graph.
// A second way of LOOKING at the one canonical model. Nodes, edges and layout are derived on every render
// (model/graph.ts); a gesture here calls the same operations as the Guided view and the Composer, through the same
// store, so there is one undo history. Positions, zoom, collapse and selection are presentation state only: moving a
// card never changes what is asked next.
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath, useConnection, useReactFlow, useUpdateNodeInternals,
  type Connection, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { connectProblem, connectRoute, connectSurveyRoute, layoutGraph, moduleGraph, surveyGraph, surveyRouteFor, targetOfNodeId, type GEdge, type GNode, type SNode } from './model/graph';
import type { InsertAt } from './model/ops';
import { KIND_LABEL, OUTCOME_LABEL } from './model/sample';
import type { Issue, Module, Survey, SurveyTarget, Target } from './model/types';
import { useStudio } from './store';
import { Glyph, KIND_GLYPH, type GlyphName } from './ui';

const TYPE_GLYPH: Record<string, GlyphName> = { YES_NO: 'yesno', SINGLE_SELECT: 'single', MULTI_SELECT: 'multi', FREE_TEXT: 'text' };
const TYPE_TEXT: Record<string, string> = { YES_NO: 'Yes / No', SINGLE_SELECT: 'Single choice', MULTI_SELECT: 'Multiple choice', FREE_TEXT: 'Free text' };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface GraphCtx { editable: boolean; short: (t: Target | SurveyTarget | null) => string; onInsert?: (at: InsertAt) => void }
const Ctx = createContext<GraphCtx>({ editable: false, short: () => '' });

/**
 * Where a connection lands. Normally a small dot at the top of a card; while a connection is being dragged it covers the
 * whole card, so the author drops on the card, not on a 7-pixel target.
 */
function TargetHandle({ connectable = true }: { connectable?: boolean }) {
  const dragging = useConnection((c) => c.inProgress);
  return <Handle type="target" id="in" position={Position.Top} className={`ss-g-handle in ${dragging && connectable ? 'cover' : ''}`} isConnectable={connectable} />;
}

// ---- nodes --------------------------------------------------------------------------------------------------------
type StepData = { g: GNode };
function SlotRows({ slots, id }: { slots: Array<{ via: string; label: string; tone?: string; undecided: boolean; connect: boolean; must?: boolean; target: Target | SurveyTarget | null }>; id: string }) {
  const { editable, short } = useContext(Ctx);
  return (
    <ul className="ss-g-rows">
      {slots.map((s) => (
        <li key={s.via} className={`ss-g-row ${s.tone ?? ''} ${s.undecided ? 'undecided' : ''}`} data-testid={`ss-g-slot-${id}-${s.via}`}>
          <span className="ss-g-row-label">{s.must ? <Glyph name="stop" size={12} /> : null}{clip(s.label, 24)}</span>
          <span className="ss-g-row-to">{s.undecided ? 'not decided' : short(s.target)}</span>
          {/* the handle a connection is dragged from; the same route can be set from the panel with the keyboard */}
          <Handle type="source" id={s.via} position={s.tone === 'normal' ? Position.Bottom : Position.Right} isConnectable={editable && s.connect}
            className={`ss-g-handle ${s.tone === 'normal' ? 'spine' : ''} ${s.undecided ? 'undecided' : ''}`} title={editable && s.connect ? `Drag to choose where “${s.label}” leads` : undefined} />
        </li>
      ))}
    </ul>
  );
}

function StepNode({ data, selected }: NodeProps<Node<StepData>>) {
  const g = data.g;
  const decision = g.kind === 'DECISION';
  return (
    <div className={`ss-g-node ${decision ? 'decision' : 'question'} ${g.followup ? 'followup' : ''} ${g.issues ? 'has-issue' : ''} ${selected ? 'selected' : ''} ${g.orphan ? 'orphan' : ''}`} data-testid={`ss-g-node-${g.id}`}>
      <TargetHandle connectable={!g.followup} />
      <div className="ss-g-head">
        <span className="ss-q-num">{g.number}</span>
        <span className="ss-g-type"><Glyph name={decision ? 'branch' : TYPE_GLYPH[g.answerType ?? 'YES_NO']!} size={13} /> {decision ? 'Condition' : g.followup ? 'Follow-up' : TYPE_TEXT[g.answerType ?? 'YES_NO']}</span>
        {g.shared ? <Glyph name="lock" size={12} /> : null}
        {g.issues ? <span className="ss-g-issue" data-testid={`ss-g-issue-${g.id}`}><Glyph name="alert" size={12} /> {g.issues}</span> : null}
      </div>
      <p className="ss-g-title">{decision ? <span className="ss-g-when">When </span> : null}{g.title}</p>
      <SlotRows slots={g.slots} id={g.id} />
      {g.followup ? <Handle type="source" id="NEXT" position={Position.Bottom} className="ss-g-handle spine" isConnectable={false} /> : null}
      {/* a queue leaves its parent from the bottom even when the rejoin row is not drawn as an edge of its own */}
    </div>
  );
}

function TerminalNode({ data }: NodeProps<Node<StepData>>) {
  const g = data.g;
  const cls = g.kind === 'START' ? 'start' : g.outcome === 'COMPLETED' ? 'ok' : g.outcome === 'REVIEW_REQUIRED' ? 'review' : g.outcome ? 'alt' : 'ok';
  return (
    <div className={`ss-g-terminal ${cls}`} data-testid={`ss-g-node-${g.id}`}>
      {g.kind !== 'START' ? <TargetHandle /> : null}
      {g.kind === 'OUTCOME' && g.outcome !== 'COMPLETED' ? <Glyph name="stop" size={13} /> : null}
      <span>{g.title}</span>
      {g.kind === 'START' ? <Handle type="source" id="ENTRY" position={Position.Bottom} className="ss-g-handle spine" isConnectable={false} /> : null}
    </div>
  );
}

function StubNode({ data }: NodeProps<Node<StepData>>) {
  const g = data.g;
  return (
    <div className={`ss-g-stub ${g.issues ? 'has-issue' : ''}`} data-testid={`ss-g-node-${g.id}`} title="Collapsed. Select to open this branch.">
      <TargetHandle connectable={false} />
      <span className="ss-g-stub-main"><Glyph name="right" size={13} /> {g.title}</span>
      <span className="ss-g-stub-sub">{g.subtitle}{g.issues ? ` · ${g.issues} to fix` : ''}</span>
      <Handle type="source" id="NEXT" position={Position.Bottom} className="ss-g-handle spine" isConnectable={false} />
    </div>
  );
}

type InstanceData = { s: SNode };
function InstanceNode({ data, selected }: NodeProps<Node<InstanceData>>) {
  const s = data.s;
  return (
    <div className={`ss-g-node instance kind-${(s.moduleKind ?? 'COMMON').toLowerCase()} ${s.issues ? 'has-issue' : ''} ${selected ? 'selected' : ''}`} data-testid={`ss-g-node-${s.id}`}>
      <TargetHandle />
      <div className="ss-g-head">
        <span className="ss-kind"><Glyph name={KIND_GLYPH[s.moduleKind ?? 'COMMON']} size={13} /> {KIND_LABEL[s.moduleKind ?? 'COMMON']}</span>
        <span className="ss-g-type">{s.version} · {s.questions} question{s.questions === 1 ? '' : 's'}</span>
        {s.issues ? <span className="ss-g-issue"><Glyph name="alert" size={12} /> {s.issues}</span> : null}
      </div>
      <p className="ss-g-title">{s.title}</p>
      <p className="ss-g-sub">{clip(s.subtitle ?? '', 84)}</p>
      <SlotRows id={s.id} slots={s.slots.map((x) => ({ ...x, tone: x.via === 'COMPLETED' ? 'normal' : x.via === 'REVIEW_REQUIRED' ? 'unknown' : 'alt' }))} />
    </div>
  );
}
function SurveyTerminal({ data }: NodeProps<Node<InstanceData>>) {
  const s = data.s;
  const cls = s.kind === 'START' ? 'start' : s.kind === 'END' ? 'ok' : s.outcome === 'REVIEW_REQUIRED' ? 'review' : 'alt';
  return (
    <div className={`ss-g-terminal ${cls}`} data-testid={`ss-g-node-${s.id}`}>
      {s.kind !== 'START' ? <TargetHandle /> : null}
      {s.kind === 'OUTCOME' ? <Glyph name="stop" size={13} /> : null}
      <span>{s.title}</span>
      {s.kind === 'START' ? <Handle type="source" id="ENTRY" position={Position.Bottom} className="ss-g-handle spine" isConnectable={false} /> : null}
    </div>
  );
}

// ---- edges --------------------------------------------------------------------------------------------------------
type RouteData = { e: GEdge };
function RouteEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<Edge<RouteData>>) {
  const { editable, onInsert } = useContext(Ctx);
  const e = data!.e;
  const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 14, offset: 18 });
  const side = sourcePosition === Position.Right;
  // "+" is offered on routes that leave from the bottom of a card, where there is room for a full-size target. A route
  // that leaves from a row on the side gets its new step from the selected card's panel ("create a new question here").
  const insert = editable && onInsert && e.insert && !side ? e.insert : null;
  // Labels sit AT THE START of a route, never in the middle of the line where they could land on another card.
  // A route that leaves from a row on the side is already named by that row, so it carries only its "+";
  // a route that leaves from the bottom (the normal journey, a queue) is named just under its card.
  const text = side ? '' : e.label;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`ss-g-edge ${e.tone} ${e.main ? 'main' : ''} ${e.synthetic ? 'synthetic' : ''}`} />
      {text || insert ? (
        <EdgeLabelRenderer>
          <div className={`ss-g-label nodrag nopan ${e.tone}`} data-testid={`ss-g-edge-${e.id}`} title={e.label || undefined}
            style={{ transform: side ? `translate(0, -50%) translate(${sourceX + 9}px, ${sourceY}px)` : `translate(-50%, 0) translate(${sourceX}px, ${sourceY + 8}px)` }}>
            {text ? <span>{text}</span> : null}
            {insert ? <button type="button" className="ss-g-plus" aria-label={`Add a question or condition on this route${e.label ? `: ${e.label}` : ''}`} title="Add a question or condition here" data-testid={`ss-g-insert-${e.id}`}
              onClick={(ev) => { ev.stopPropagation(); onInsert!(insert); }}><Glyph name="plus" size={12} /></button> : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { step: StepNode, terminal: TerminalNode, stub: StubNode, instance: InstanceNode, sterminal: SurveyTerminal };
const edgeTypes = { route: RouteEdge };
const marker = (tone: string) => ({ type: MarkerType.ArrowClosed, width: 16, height: 16, color: tone === 'escalate' ? '#b3263a' : tone === 'unknown' ? '#9a5a00' : tone === 'queue' ? '#3d4f9f' : '#6b7789' });

// ---- the canvas both graphs share --------------------------------------------------------------------------------
interface CanvasProps {
  nodes: Array<{ id: string; width: number; height: number; main?: boolean; type: string; data: StepData | InstanceData; label: string; selectable: boolean }>;
  edges: GEdge[];
  selected: string | null;
  /** Bumped when something outside the canvas asks to bring `selected` into view (outline, search, view switch). */
  focusTick: number;
  onPick: (id: string) => void;
  onConnect: (source: string, via: string, target: string) => void;
  toolbar: ReactNode;
  message: string | null;
  testId: string;
  minimapColor: (id: string) => string;
}

function Canvas({ nodes, edges, selected, focusTick, onPick, onConnect, toolbar, message, testId, minimapColor }: CanvasProps) {
  const flow = useReactFlow();
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const positions = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  const rf: Node[] = useMemo(() => nodes.map((n) => ({
    id: n.id, type: n.type, data: n.data, position: moved[n.id] ?? positions.get(n.id) ?? { x: 0, y: 0 }, width: n.width, height: n.height,
    // sizes are known in advance, so a re-render (selection, an edit) does not make the canvas forget where the handles are
    measured: { width: n.width, height: n.height },
    selected: n.id === selected, selectable: n.selectable, focusable: n.selectable, ariaLabel: n.label, draggable: true,
  })), [nodes, positions, moved, selected]);
  const re: Edge[] = useMemo(() => edges.map((e) => ({
    id: e.id, source: e.source, sourceHandle: e.handle, target: e.target, targetHandle: 'in', type: 'route', data: { e }, markerEnd: marker(e.tone), focusable: false, selectable: false,
  })), [edges]);
  const byId = useRef(new Map<string, Node>());
  byId.current = new Map(rf.map((n) => [n.id, n]));
  const box = useRef<HTMLDivElement | null>(null);
  // a route can move to another handle without the card changing size: ask for the handles to be read again
  const remeasure = useUpdateNodeInternals();
  useEffect(() => { remeasure(nodes.map((n) => n.id)); }, [nodes, remeasure]);
  /** Everything in view. Computed here from the layout, so it never waits on, or is overtaken by, a queued library fit. */
  const fitAll = () => {
    const el = box.current;
    const all = [...byId.current.values()];
    if (!el || !all.length) return;
    const x0 = Math.min(...all.map((n) => n.position.x)), x1 = Math.max(...all.map((n) => n.position.x + (n.width ?? 0)));
    const y0 = Math.min(...all.map((n) => n.position.y)), y1 = Math.max(...all.map((n) => n.position.y + (n.height ?? 0)));
    const zoom = Math.min(1, Math.max(0.12, Math.min(el.clientWidth / (x1 - x0), el.clientHeight / (y1 - y0)) * 0.9));
    void flow.setViewport({ x: el.clientWidth / 2 - ((x0 + x1) / 2) * zoom, y: el.clientHeight / 2 - ((y0 + y1) / 2) * zoom, zoom }, { duration: 240 });
  };
  /** The first view is READABLE, not "everything at once": the start of the journey at a legible size. Fit-to-view and the minimap give the overview. */
  const opening = () => {
    const el = box.current;
    const start = byId.current.get('start');
    if (!el || !start) return;
    const all = [...byId.current.values()];
    const width = Math.max(...all.map((n) => n.position.x + (n.width ?? 0))) - Math.min(...all.map((n) => n.position.x));
    const height = Math.max(...all.map((n) => n.position.y + (n.height ?? 0)));
    const zoom = Math.min(1, Math.max(0.86, Math.min((el.clientWidth - 40) / Math.max(width, 1), (el.clientHeight - 40) / Math.max(height, 1))));
    void flow.setViewport({ x: el.clientWidth / 2 - (start.position.x + (start.width ?? 0) / 2) * zoom, y: 18, zoom });
  };

  useEffect(() => {
    if (!focusTick || !selected) return;
    const n = byId.current.get(selected);
    if (n) void flow.setCenter(n.position.x + (n.width ?? 0) / 2, n.position.y + (n.height ?? 0) / 2, { zoom: Math.max(flow.getZoom(), 0.9), duration: 260 });
  }, [focusTick, selected, flow]);

  const onNodesChange = (changes: NodeChange[]) => {
    for (const c of changes) {
      // dragging is presentation only: it is remembered here and never reaches the model
      if (c.type === 'position' && c.position) setMoved((m) => ({ ...m, [c.id]: c.position! }));
      if (c.type === 'select' && c.selected) onPick(c.id);
    }
  };
  return (
    <div className="ss-g-wrap" data-testid={testId}>
      <div className="ss-g-toolbar">
        {toolbar}
        <button type="button" className="ss-btn small" onClick={() => { setMoved({}); window.setTimeout(fitAll, 40); }} data-testid="ss-g-tidy" title="Put every card back where the automatic layout places it">Tidy layout</button>
        <button type="button" className="ss-btn small" onClick={fitAll} data-testid="ss-g-fit">Fit to view</button>
        {message ? <span className="ss-g-message" role="status" data-testid="ss-g-message"><Glyph name="alert" size={14} /> {message}</span> : null}
      </div>
      <div className="ss-g-canvas" ref={box}>
        <ReactFlow nodes={rf} edges={re} onInit={() => { if (selected && byId.current.has(selected)) return; opening(); }} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
          onConnect={(c: Connection) => { if (c.source && c.sourceHandle && c.target) onConnect(c.source, c.sourceHandle, c.target); }}
          minZoom={0.12} maxZoom={1.6} deleteKeyCode={null} multiSelectionKeyCode={null} selectionKeyCode={null}
          nodesConnectable edgesFocusable={false} elevateEdgesOnSelect={false} proOptions={{ hideAttribution: false }} onlyRenderVisibleElements={false}
          aria-label="Graph. Use the outline or Tab to reach a step; Enter selects it and opens its routes in the panel.">
          <Background gap={22} size={1.2} color="#d5dbe5" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable position="bottom-right" style={{ width: 132, height: 96 }} nodeColor={(n) => minimapColor(n.id)} nodeStrokeWidth={2} ariaLabel="Overview of the whole graph" />
        </ReactFlow>
      </div>
    </div>
  );
}

// ---- module question graph ---------------------------------------------------------------------------------------
export interface ModuleGraphProps {
  m: Module; moduleKey: string; editable: boolean; issues: Issue[];
  collapsed: Set<string>; setCollapsed: (next: Set<string>) => void;
  selected: string | null; focusTick: number; onSelect: (id: string | null) => void; onInsert: (at: InsertAt) => void;
  label: (t: Target | null | undefined) => string;
  tools?: ReactNode;
}

function ModuleGraphInner({ m, moduleKey, editable, issues, collapsed, setCollapsed, selected, focusTick, onSelect, onInsert, tools }: ModuleGraphProps) {
  const { ws, apply } = useStudio();
  const [message, setMessage] = useState<string | null>(null);
  const g = useMemo(() => moduleGraph(ws, m, collapsed, issues), [ws, m, collapsed, issues]);
  const numbers = g.flow.numbers;
  // a large module opens on its main journey; every branch is one click away (and stays in the outline and the minimap)
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (m.nodes.length > 24 && collapsed.size === 0 && !selected) setCollapsed(new Set(g.lanes));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const short = (t: Target | SurveyTarget | null): string => {
    if (!t || typeof t === 'string' || 'ret' in t || 'instance' in t || 'surveyOutcome' in t) return '';
    return 'outcome' in t ? (t.outcome === 'REVIEW_REQUIRED' ? 'Review' : OUTCOME_LABEL[t.outcome]) : numbers.get(t.node) ?? '?';
  };
  const nodes = useMemo(() => g.nodes.map((n) => ({
    id: n.id, width: n.width, height: n.height, main: n.main, type: n.kind === 'QUESTION' || n.kind === 'DECISION' ? 'step' : n.kind === 'STUB' ? 'stub' : 'terminal', data: { g: n },
    selectable: n.kind === 'QUESTION' || n.kind === 'DECISION' || n.kind === 'STUB',
    label: n.kind === 'STUB' ? `Collapsed branch: ${n.title}. Select to open.` : `${n.number ?? ''} ${n.kind === 'DECISION' ? 'Condition: when ' : ''}${n.title}${n.issues ? `, ${n.issues} to fix` : ''}`,
  })), [g.nodes]);
  const by = useMemo(() => new Map(g.nodes.map((n) => [n.id, n])), [g.nodes]);
  const pick = (id: string) => {
    const n = by.get(id);
    if (n?.kind === 'STUB' && n.laneKey) { const next = new Set(collapsed); next.delete(n.laneKey); setCollapsed(next); return; }
    if (n?.kind === 'QUESTION' || n?.kind === 'DECISION') onSelect(id);
  };
  const connect = (source: string, via: string, targetId: string) => {
    const problem = editable ? connectProblem(ws, m, source, via, targetId) : 'This is the approved library version. Edit a copy to change its routes.';
    if (problem) { setMessage(problem); return; }
    setMessage(null);
    apply(`Routed ${numbers.get(source) ?? source} in the graph`, (w) => connectRoute(w, moduleKey, source, via, targetOfNodeId(targetId)!));
    onSelect(source);
  };
  const tone = (id: string) => { const n = by.get(id); return !n ? '#c9d1dd' : n.issues ? '#e6b656' : n.kind === 'DECISION' ? '#cfd6ff' : n.kind === 'OUTCOME' || n.kind === 'START' ? '#1d2b44' : n.kind === 'STUB' ? '#e9edf3' : n.main ? '#9fb0c9' : '#d5dbe5'; };
  return (
    <Ctx.Provider value={{ editable, short, onInsert }}>
      <Canvas nodes={nodes} edges={g.edges} selected={selected} focusTick={focusTick} onPick={pick} onConnect={connect} message={message} testId="ss-graph" minimapColor={tone}
        toolbar={<>
          {tools}
          {g.lanes.length ? (
            collapsed.size
              ? <button type="button" className="ss-btn small" onClick={() => setCollapsed(new Set())} data-testid="ss-g-expand">Open all branches</button>
              : <button type="button" className="ss-btn small" onClick={() => setCollapsed(new Set(g.lanes))} data-testid="ss-g-collapse">Show the main journey only</button>
          ) : null}
        </>} />
    </Ctx.Provider>
  );
}
export default function ModuleGraphView(props: ModuleGraphProps) {
  return <ReactFlowProvider><ModuleGraphInner {...props} /></ReactFlowProvider>;
}

// ---- survey module graph -----------------------------------------------------------------------------------------
export interface SurveyGraphProps { survey: Survey; issues: Issue[]; selected: string | null; focusTick: number; onSelect: (id: string | null) => void; entryText: (instanceId: string) => string; tools?: ReactNode }

function SurveyGraphInner({ survey, issues, selected, focusTick, onSelect, entryText, tools }: SurveyGraphProps) {
  const { ws, apply } = useStudio();
  const [message, setMessage] = useState<string | null>(null);
  const g = useMemo(() => surveyGraph(ws, survey, issues, entryText), [ws, survey, issues, entryText]);
  const name = (id: string) => g.nodes.find((n) => n.id === id)?.title ?? id;
  const short = (t: Target | SurveyTarget | null): string => {
    if (!t) return '';
    if (t === '@CONTINUE') return 'next';
    if (typeof t === 'object' && 'instance' in t) return clip(name(t.instance), 14);
    if (typeof t === 'object' && 'surveyOutcome' in t) return t.surveyOutcome === 'REVIEW_REQUIRED' ? 'halts' : 'ends';
    return '';
  };
  const nodes = useMemo(() => g.nodes.map((n) => ({
    id: n.id, width: n.width, height: n.height, main: n.main, type: n.kind === 'INSTANCE' ? 'instance' : 'sterminal', data: { s: n }, selectable: n.kind === 'INSTANCE',
    label: n.kind === 'INSTANCE' ? `Module ${(n.index ?? 0) + 1}: ${n.title}. ${n.subtitle ?? ''}${n.issues ? `, ${n.issues} to fix` : ''}` : n.title,
  })), [g.nodes]);
  const connect = (source: string, via: string, targetId: string) => {
    const r = surveyRouteFor(survey, source, via, targetId);
    if ('problem' in r) { setMessage(r.problem); return; }
    setMessage(null);
    apply(`Routed "${OUTCOME_LABEL[via as keyof typeof OUTCOME_LABEL] ?? via}" of ${name(source)} in the graph`, (w) => connectSurveyRoute(w, survey.id, source, via, r.target));
    onSelect(source);
  };
  const tone = (id: string) => { const n = g.nodes.find((x) => x.id === id); return !n ? '#c9d1dd' : n.issues ? '#e6b656' : n.kind === 'INSTANCE' ? '#9fb0c9' : '#1d2b44'; };
  return (
    <Ctx.Provider value={{ editable: true, short }}>
      <Canvas nodes={nodes} edges={g.edges} selected={selected} focusTick={focusTick} onPick={(id) => { if (survey.sequence.some((x) => x.id === id)) onSelect(id); }} onConnect={connect}
        message={message} testId="ss-survey-graph" minimapColor={tone} toolbar={tools} />
    </Ctx.Provider>
  );
}
export function SurveyGraphView(props: SurveyGraphProps) {
  return <ReactFlowProvider><SurveyGraphInner {...props} /></ReactFlowProvider>;
}
