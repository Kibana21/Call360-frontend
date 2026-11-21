// Survey Studio prototype — Screen D (Guided Module Builder) and Screen E (Choice and Follow-up Designer).
// The normal path reads top to bottom; answers that leave it open as lanes underneath and say where they rejoin.
// Everything is edited on the card itself: type the question, add options, pick a destination, press "+" on a route.
// A shared question's wording and options are locked here — only its routing belongs to this placement.
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Suspense, createContext, lazy, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { bindingSentence, RuleDrawer } from './EntryRuleDrawer';
import { effectiveSelection, previewQueue, ruleWinner, selectionError, shadowedRules, targetLabel } from './model/engine';
import { buildFlow, normalNext, validateModule, wordingStatus, type Flow, type FlowDecision, type FlowEntry, type FlowItem } from './model/flow';
import {
  addFollowupQuestion, addOption, addRule, defaultOn, deleteNode, deriveModule, duplicateOption, findCondition, findModule, findSurvey, forkQuestion, inbound, insertDecision,
  insertQuestion, moveOption, moveRule, newQuestionVersion, patchOption, permittedInterrupts, questionNodes, removeOption, removeRule, renameModule, renameOption,
  reorderFollowups, setDecisionUnknown, setEdge, setFallback, setFollowupBehaviour, setInterruptClass, setMode, setRejoin, toggleOther, updateQuestion, updateRule, usage,
  type InsertAt, type QuestionSpec,
} from './model/ops';
import { ESCALATION_OUTCOMES, KIND_LABEL, OUTCOMES, OUTCOME_LABEL } from './model/sample';
import { isQuestion, mKey, type AnswerType, type Interrupt, type InterruptClass, type InterruptPolicy, type Issue, type Module, type OutcomeCode, type RoutingMode, type SetRule, type Target } from './model/types';
import { StudioBar } from './StudioRoot';
import { useFocusTarget, useStudio } from './store';
import { Glyph, InlineText, KIND_GLYPH, Picker, Popover, Segmented, Tag, type GlyphName, type PickItem } from './ui';

const TYPES: Array<{ type: AnswerType; label: string; hint: string; glyph: GlyphName }> = [
  { type: 'YES_NO', label: 'Yes / No', hint: 'Two fixed answers', glyph: 'yesno' },
  { type: 'SINGLE_SELECT', label: 'Single choice', hint: 'Pick one option', glyph: 'single' },
  { type: 'MULTI_SELECT', label: 'Multiple choice', hint: 'Pick several options', glyph: 'multi' },
  { type: 'FREE_TEXT', label: 'Free text', hint: "The customer's own words", glyph: 'text' },
];
const TYPE_OF = Object.fromEntries(TYPES.map((t) => [t.type, t])) as Record<AnswerType, (typeof TYPES)[number]>;

interface Ctx {
  m: Module; moduleKey: string; editable: boolean; issues: Issue[];
  label: (t: Target | null | undefined) => string; number: (id: string) => string;
  open: Set<string>; toggle: (key: string) => void;
  numbers: Map<string, string>;
  /** Opens the condition drawer for a decision point. */
  editCondition: (nodeId: string) => void;
  /** true in the Graph view's side panel: one step on its own, without the branches drawn under it (the graph shows those). */
  flat?: boolean;
  /** Called with the id of a step created from this card, so the active view can select it. */
  created?: (nodeId: string) => void;
}
const BuilderCtx = createContext<Ctx | null>(null);
const useB = () => useContext(BuilderCtx)!;

// The graph library is loaded only when the Graph view is opened.
const ModuleGraphView = lazy(() => import('./GraphView'));

/** The branch (lane) keys on the way to a step — what has to be open for it to be visible in either view. */
function lanesHolding(flow: Flow, id: string): string[] {
  const find = (list: FlowEntry[], path: string[]): string[] | null => {
    for (const e of list) {
      if (e.node.id === id) return path;
      const inFu = find(e.followups, [...path, `${e.node.id}:followups`]);
      if (inFu) return inFu;
      for (const r of e.rows) { const hit = find(r.lane, [...path, `${e.node.id}:${r.on}`]); if (hit) return hit; }
    }
    return null;
  };
  return find([...flow.main, ...flow.orphans], []) ?? [];
}

/** Gives an element the rest of the window's height, whatever sits above it. */
function useFillHeight(active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return undefined;
    const fit = () => { const el = ref.current; if (el) el.style.height = `${Math.max(440, window.innerHeight - el.getBoundingClientRect().top - window.scrollY - 14)}px`; };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });
  return ref;
}
export { useFillHeight };

/** Every step of a module in reading order, for the outline and for finding a step by its stable id. */
function outline(flow: Flow): Array<{ entry: FlowEntry; depth: number; group: string }> {
  const out: Array<{ entry: FlowEntry; depth: number; group: string }> = [];
  const walk = (e: FlowEntry, depth: number, group: string) => {
    out.push({ entry: e, depth, group });
    e.followups.forEach((f) => walk(f, depth + 1, 'Branches and follow-ups'));
    e.rows.forEach((r) => r.lane.forEach((c) => walk(c, depth + 1, 'Branches and follow-ups')));
  };
  flow.main.forEach((e) => walk(e, 0, 'Main journey'));
  flow.orphans.forEach((e) => walk(e, 0, 'Not connected'));
  return out;
}

export function BuilderPage() {
  const { surveyId, instanceId, moduleKey: paramKey } = useParams();
  const { ws, apply, requestFocus } = useStudio();
  const survey = surveyId ? findSurvey(ws, surveyId) : undefined;
  const inst = survey?.sequence.find((x) => x.id === instanceId);
  const moduleKey = inst ? mKey(inst.module) : decodeURIComponent(paramKey ?? '');
  const m = findModule(ws, moduleKey);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [ruleFor, setRuleFor] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const view: 'guided' | 'graph' = params.get('view') === 'graph' ? 'graph' : 'guided';
  const selected = params.get('node');
  const [tick, setTick] = useState(0);
  const [insertAt, setInsertAt] = useState<InsertAt | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const fill = useFillHeight(view === 'graph');
  /** View and selection live in the address, so they survive a view switch; they are presentation, not part of the model. */
  const go = (next: { view?: 'guided' | 'graph'; node?: string | null }) => {
    const p = new URLSearchParams(params);
    const v = next.view ?? view;
    if (v === 'graph') p.set('view', 'graph'); else p.delete('view');
    const n = next.node === undefined ? selected : next.node;
    if (n) p.set('node', n); else p.delete('node');
    setParams(p, { replace: true });
  };
  const select = (id: string | null, reveal = true) => {
    setInsertAt(null);
    go({ node: id });
    if (!id) return;
    if (reveal) {
      const holding = flow ? lanesHolding(flow, id) : [];
      if (holding.some((k) => closed.has(k))) setClosed(new Set([...closed].filter((k) => !holding.includes(k)))); // open only the branches that hold it
      setTick((t) => t + 1);
    }
    if (view === 'guided') requestFocus(`node:${id}`);
    else window.setTimeout(() => panel.current?.focus(), 60);
  };
  useEffect(() => {
    // arriving in Guided with a selection made in the graph: bring that card into view
    if (view === 'guided' && selected) requestFocus(`node:${selected}`);
    if (view === 'graph') setTick((t) => t + 1);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const flow = useMemo(() => (m ? buildFlow(ws, m) : null), [ws, m]);
  const issues = useMemo(() => (m ? validateModule(ws, m) : []), [ws, m]);

  if (!m || !flow) {
    return (<><StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: 'Module not found' }]} />
      <div className="ss-empty page"><p><strong>This module is not in the prototype workspace.</strong></p><Link className="ss-btn" to="/survey-studio">Back to Survey Studio</Link></div></>);
  }
  const editable = !m.published;
  const ctx: Ctx = {
    m, moduleKey, editable, issues,
    label: (t) => targetLabel(t, m, ws, flow.numbers), number: (id) => flow.numbers.get(id) ?? '?',
    numbers: flow.numbers, editCondition: setRuleFor, created: (id) => select(id),
    open: closed, toggle: (key) => setClosed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; }),
  };
  const crumbs = [{ label: 'Survey Studio', to: '/survey-studio' }, ...(survey ? [{ label: survey.name, to: `/survey-studio/surveys/${survey.id}` }] : []), { label: m.name }];
  const steps = outline(flow);
  const chosen = selected ? steps.find((x) => x.entry.node.id === selected)?.entry : undefined;
  const outlineItems: PickItem[] = steps.map(({ entry: e, depth, group }) => {
    const n = issues.filter((i) => i.where.nodeId === e.node.id).length;
    const text = e.kind === 'QUESTION' ? (e.question.wording.text.trim() || 'Untitled question') : `Condition: ${bindingSentence(ws, e.node.binding, m, flow.numbers) ?? 'not set'}`;
    return { id: e.node.id, label: `${'\u2003'.repeat(Math.min(depth, 3))}${e.number}  ${text}`, hint: n ? `${n} to fix` : undefined, group, glyph: (n ? 'alert' : e.kind === 'DECISION' ? 'branch' : TYPE_OF[e.question.answerType].glyph) as GlyphName };
  });
  const tools = (
    <>
      <Segmented<'guided' | 'graph'> label="View of this module" value={view} onChange={(v) => go({ view: v })}
        options={[{ value: 'guided', label: 'Guided', hint: 'Cards in reading order' }, { value: 'graph', label: 'Graph', hint: 'The same module as a map of routes' }]} />
      <Popover label="Outline: find a question" wide
        trigger={(p) => <button type="button" className="ss-btn small" {...p} data-testid="ss-outline"><Glyph name="search" size={14} /> Find a question · {steps.length}</button>}>
        {(close) => <Picker items={outlineItems} placeholder="Search by number or wording" onPick={(id) => { close(); select(id); }}
          footer={<p className="ss-muted">Every step once, in reading order. Choosing one selects it in this view.</p>} />}
      </Popover>
    </>
  );
  const insertAtEntry = (spec: QuestionSpec) => {
    const id = apply('Added a question', (w) => insertQuestion(w, moduleKey, { entry: true }, spec));
    if (id) requestFocus(`node:${id}`);
  };

  return (
    <BuilderCtx.Provider value={ctx}>
      <StudioBar crumbs={crumbs} issues={issues} wording={wordingStatus(ws, [m])}
        badge={editable ? <Tag tone="draft">{m.derivedFor ? `Draft v${m.revision} · this survey only` : 'Draft · not in the shared library'}</Tag> : <Tag tone="shared" glyph="lock">Shared module · v{m.revision}</Tag>}
        onIssue={(i) => { setClosed(new Set()); if (i.where.nodeId) requestFocus(`node:${i.where.nodeId}`); }} />
      <div className={`ss-builder ${view === 'graph' ? 'graph' : ''}`}>
        <header className="ss-builder-head">
          <span className={`ss-kind kind-${m.kind.toLowerCase()}`}><Glyph name={KIND_GLYPH[m.kind]} /> {KIND_LABEL[m.kind]} module</span>
          {editable
            ? <InlineText className="ss-title" value={m.name} label="Module name" placeholder="Module name" onCommit={(v) => { if (v.trim()) apply('Renamed the module', (w) => renameModule(w, moduleKey, v.trim())); }} />
            : <h1 className="ss-title">{m.name}</h1>}
          <p className="ss-muted">{m.intent}</p>
        </header>

        {!editable ? (
          <div className="ss-lockbar" data-testid="ss-lockbar">
            <Glyph name="lock" />
            <div><strong>This is the approved library version.</strong> It is used by other surveys, so it cannot be changed here.
              {survey && inst ? ' To change it for this survey, edit a copy: the library version and other surveys stay as they are.' : ' Open it from a survey to edit a copy for that survey.'}</div>
            {survey && inst ? (
              <button type="button" className="ss-btn primary" data-testid="ss-derive"
                onClick={() => apply(`Started a draft copy of ${m.name}`, (w) => deriveModule(w, survey.id, inst.id))}>Edit a copy for this survey</button>
            ) : null}
          </div>
        ) : null}

        {view === 'guided' && flow.main.length ? <div className="ss-viewbar" data-testid="ss-viewbar">{tools}</div> : null}
        {view === 'graph' ? (
          <div className="ss-graph-page" data-testid="ss-graph-page" ref={fill}>
            <Suspense fallback={<p className="ss-muted ss-g-loading">Opening the graph…</p>}>
              <ModuleGraphView m={m} moduleKey={moduleKey} editable={editable} issues={issues} collapsed={closed} setCollapsed={setClosed} label={ctx.label}
                selected={selected} focusTick={tick} onSelect={(id) => select(id, false)} onInsert={(at) => { setInsertAt(at); window.setTimeout(() => panel.current?.focus(), 60); }} tools={tools} />
            </Suspense>
            {insertAt || chosen ? (
              <aside ref={panel} className="ss-g-panel" tabIndex={-1} aria-label={insertAt ? 'Add a step on this route' : `Selected: ${chosen!.number}`} data-testid="ss-g-panel">
                <div className="ss-g-panel-head">
                  <strong>{insertAt ? 'Add on this route' : `${chosen!.number} · routes and details`}</strong>
                  <button type="button" className="ss-icon-btn" aria-label="Close the panel" onClick={() => { setInsertAt(null); go({ node: null }); }} data-testid="ss-g-panel-close"><Glyph name="close" /></button>
                </div>
                {insertAt ? (
                  <InsertMenu close={() => setInsertAt(null)}
                    onDecision={() => { const id = apply('Added a condition', (w) => insertDecision(w, moduleKey, insertAt)); if (id) select(id, false); }}
                    onPick={(spec) => { const id = apply('Added a question', (w) => insertQuestion(w, moduleKey, insertAt, spec)); if (id) select(id, false); }} />
                ) : (
                  <BuilderCtx.Provider value={{ ...ctx, flat: true }}>
                    <StepCard key={`${chosen!.node.id}-${editable}-panel`} item={chosen!} />
                    <p className="ss-muted">The same card as in the Guided view. A change here is the same change there, and Undo works from either.</p>
                  </BuilderCtx.Provider>
                )}
              </aside>
            ) : null}
          </div>
        ) : null}
        {view === 'guided' ? (
        <div className="ss-flow" data-testid="ss-flow"
          onFocusCapture={(e) => { const id = (e.target as HTMLElement).closest('[data-node]')?.getAttribute('data-node'); if (id && id !== selected) go({ node: id }); }}
          onClickCapture={(e) => { const id = (e.target as HTMLElement).closest('[data-node]')?.getAttribute('data-node'); if (id && id !== selected) go({ node: id }); }}>
          {flow.main.length === 0 ? (
            <div className="ss-empty" data-testid="ss-module-empty">
              <p><strong>This module has no questions yet.</strong> Add the first one — for example "Did your representative explain the plan?"</p>
              {editable ? <TypeButtons onPick={insertAtEntry} /> : null}
            </div>
          ) : (
            <>
              <div className="ss-terminal">Module starts</div>
              {editable ? <Connector at={{ entry: true }} /> : <div className="ss-wire" />}
              {flow.main.map((it, i) => {
                const next = normalNext(m, it.node, it.kind === 'QUESTION' ? it.question : undefined);
                const on = normalOn(it);
                return (
                  <div key={it.node.id} className="ss-step">
                    <StepCard key={`${it.node.id}-${editable}`} item={it} />
                    {i < flow.main.length - 1
                      ? (editable && on && next ? <Connector at={{ from: it.node.id, on }} /> : <div className={`ss-wire ${next ? '' : 'broken'}`} />)
                      : (
                        <>
                          {editable && on && next ? <Connector at={{ from: it.node.id, on }} /> : <div className={`ss-wire ${next ? '' : 'broken'}`} />}
                          <div className={`ss-terminal end ${next ? '' : 'undecided'}`}>{next && 'outcome' in next ? `Module ends · ${OUTCOME_LABEL[next.outcome]}` : next ? ctx.label(next) : 'The normal path stops here — choose where it leads'}</div>
                        </>
                      )}
                  </div>
                );
              })}
            </>
          )}
          {flow.orphans.length ? (
            <section className="ss-orphans" aria-label="Questions nothing leads to">
              <h2><Glyph name="alert" /> Not connected</h2>
              <p className="ss-muted">Nothing leads to these questions. Route an answer to them, or delete them.</p>
              {flow.orphans.map((it) => <StepCard key={it.node.id} item={it} />)}
            </section>
          ) : null}
        </div>
        ) : null}
      </div>
      {ruleFor && m.nodes.some((x) => x.id === ruleFor && !isQuestion(x)) ? (
        <RuleDrawer ctx={{ kind: 'DECISION', moduleKey, nodeId: ruleFor, number: flow.numbers.get(ruleFor) ?? '?', numbers: flow.numbers }} onClose={() => setRuleFor(null)} />
      ) : null}
    </BuilderCtx.Provider>
  );
}

/** The route a "+" on the normal path inserts into: a question's normal answer, or a decision's "Otherwise". */
function normalOn(it: FlowEntry): string | undefined {
  if (it.kind === 'DECISION') return 'NO_MATCH';
  const r = it.node.routing;
  return r.mode === 'ALL_TO_NEXT' ? defaultOn(it.question.answerType) : r.mode === 'PER_CHOICE' ? r.normal : undefined;
}

export function StepCard({ item }: { item: FlowEntry }) {
  return item.kind === 'QUESTION' ? <QuestionCard item={item} /> : <DecisionCard item={item} />;
}

// ---- inserting ----------------------------------------------------------------------------------------------------
function TypeButtons({ onPick, types }: { onPick: (spec: QuestionSpec) => void; types?: AnswerType[] }) {
  return (
    <div className="ss-type-buttons">
      {TYPES.filter((t) => !types || types.includes(t.type)).map((t) => (
        <button key={t.type} type="button" className="ss-type-btn" onClick={() => onPick({ type: t.type })} data-testid={`ss-new-${t.type}`}>
          <Glyph name={t.glyph} size={18} /><span><strong>{t.label}</strong><small>{t.hint}</small></span>
        </button>
      ))}
    </div>
  );
}

/** The one menu for adding a question anywhere: four types, or reuse a library question (pinned, not copied). */
function InsertMenu({ onPick, onDecision, close }: { onPick: (spec: QuestionSpec) => void; onDecision?: () => void; close: () => void }) {
  const { ws } = useStudio();
  const [reuse, setReuse] = useState(false);
  if (reuse) {
    const items: PickItem[] = ws.questions.filter((q) => q.published).map((q) => ({
      id: `${q.code}@${q.version}`, label: q.wording.text, hint: `${TYPE_OF[q.answerType].label} · used in ${usage(ws, q.code)} place${usage(ws, q.code) === 1 ? '' : 's'}`, glyph: TYPE_OF[q.answerType].glyph,
    }));
    return <Picker items={items} placeholder="Search library questions" onPick={(id) => { const [code, v] = id.split('@'); onPick({ reuse: { code: code!, version: Number(v) } }); close(); }}
      footer={<p className="ss-muted">Reusing pins the approved question. Its wording stays as approved; you decide the routing here.</p>} />;
  }
  return (
    <div className="ss-insert-menu">
      <h3>Add a question</h3>
      <TypeButtons onPick={(spec) => { onPick(spec); close(); }} />
      <button type="button" className="ss-link" onClick={() => setReuse(true)} data-testid="ss-reuse"><Glyph name="link" size={14} /> Reuse a question from the library</button>
      {onDecision ? (
        <button type="button" className="ss-link" onClick={() => { onDecision(); close(); }} data-testid="ss-new-DECISION" title="Checks customer details or an earlier answer and leads one of three ways. It asks nothing.">
          <Glyph name="branch" size={14} /> Add a condition — a decision that asks nothing</button>
      ) : null}
    </div>
  );
}

function Connector({ at }: { at: InsertAt }) {
  const { apply, requestFocus } = useStudio();
  const { moduleKey } = useB();
  const key = 'entry' in at ? 'entry' : `${at.from}-${at.on}`;
  return (
    <div className="ss-connector">
      <Popover label="Add a question here" wide
        trigger={(p) => <button type="button" className="ss-insert" {...p} aria-label="Add a question here" data-testid={`ss-insert-${key}`}><Glyph name="plus" size={14} /><span>Add a question here</span></button>}>
        {(close) => <InsertMenu close={close}
          onDecision={() => { const id = apply('Added a condition', (w) => insertDecision(w, moduleKey, at)); if (id) requestFocus(`node:${id}`); }}
          onPick={(spec) => {
            const id = apply('Added a question', (w) => insertQuestion(w, moduleKey, at, spec));
            if (id) requestFocus(`node:${id}`);
          }} />}
      </Popover>
    </div>
  );
}

// ---- destinations -------------------------------------------------------------------------------------------------
/** Every step of the module a route may lead to: questions on the main paths, and decision points. */
function stepItems(m: Module, selfId: string, label: (t: Target) => string): PickItem[] {
  return m.nodes.filter((nd) => nd.id !== selfId && !(isQuestion(nd) && nd.role === 'FOLLOWUP'))
    .map((nd) => ({ id: `n:${nd.id}`, label: label({ node: nd.id }), group: isQuestion(nd) ? 'A question in this module' : 'A condition in this module', glyph: (isQuestion(nd) ? 'right' : 'branch') as GlyphName }));
}

function DestinationPill({ nodeId, on, target, onSet, allowCreate = true, testId, escalationOnly = false }: {
  nodeId: string; on: string; target: Target | null; onSet: (t: Target | null) => void; allowCreate?: boolean; testId: string;
  /** A mandatory escalation may only end the module with an outcome other than Completed. */
  escalationOnly?: boolean;
}) {
  const { apply, requestFocus } = useStudio();
  const { m, moduleKey, editable, label, created } = useB();
  const text = label(target);
  if (!editable) return <span className={`ss-dest static ${target ? '' : 'undecided'}`}>{target ? <Glyph name="right" size={13} /> : <Glyph name="alert" size={14} />} {text}</span>;
  const items: PickItem[] = [
    ...(escalationOnly ? [] : stepItems(m, nodeId, label)),
    ...OUTCOMES.filter((o) => !escalationOnly || ESCALATION_OUTCOMES.includes(o)).map((o) => ({ id: `o:${o}`, label: `End module: ${OUTCOME_LABEL[o]}`, group: escalationOnly ? 'Mandatory escalation — end the module with' : 'End the module', glyph: (o === 'COMPLETED' ? 'check' : 'stop') as GlyphName })),
    ...(target ? [{ id: 'clear', label: 'Leave undecided for now', group: 'Other', glyph: 'close' as const }] : []),
  ];
  return (
    <Popover label="Choose where this leads" wide
      trigger={(p) => (
        <button type="button" className={`ss-dest ${target ? '' : 'undecided'}`} {...p} data-testid={testId}>
          {target ? <Glyph name="right" size={13} /> : <Glyph name="alert" size={14} />} <span>{target ? text : 'Choose destination'}</span>
        </button>
      )}>
      {(close) => (
        <Picker items={items} placeholder="Search questions and outcomes"
          onPick={(id) => { onSet(id === 'clear' ? null : id.startsWith('n:') ? { node: id.slice(2) } : { outcome: id.slice(2) as OutcomeCode }); close(); }}
          footer={allowCreate && !escalationOnly ? (
            <div className="ss-create-here">
              <span>Or create a new question here:</span>
              {TYPES.map((t) => (
                <button key={t.type} type="button" className="ss-chip-btn" data-testid={`${testId}-new-${t.type}`}
                  onClick={() => { const id = apply('Added a question', (w) => insertQuestion(w, moduleKey, { from: nodeId, on }, { type: t.type })); if (id) { requestFocus(`node:${id}`); created?.(id); } close(); }}>
                  <Glyph name={t.glyph} size={14} /> {t.label}
                </button>
              ))}
              <button type="button" className="ss-chip-btn" data-testid={`${testId}-new-DECISION`}
                onClick={() => { const id = apply('Added a condition', (w) => insertDecision(w, moduleKey, { from: nodeId, on })); if (id) { requestFocus(`node:${id}`); created?.(id); } close(); }}>
                <Glyph name="branch" size={14} /> Condition
              </button>
            </div>
          ) : undefined} />
      )}
    </Popover>
  );
}

// ---- the question card --------------------------------------------------------------------------------------------
/** The answers of a question that still lead nowhere, by name — shown even when the card is folded. */
function undecidedNames(item: FlowItem, issues: Issue[]): string[] {
  const q = item.question;
  return issues.filter((i) => i.where.nodeId === item.node.id && (i.where.on !== undefined || i.where.part === 'rejoin')).map((i) => {
    if (i.where.part === 'rejoin') return 'after the follow-ups';
    if (i.where.on === 'FALLBACK') return 'otherwise';
    if (i.where.on?.startsWith('RULE:')) return `rule ${(item.node.routing.rules ?? []).findIndex((x) => `RULE:${x.id}` === i.where.on) + 1}`;
    const o = q.options.find((x) => x.code === i.where.on);
    return o ? (o.label || o.code) : i.where.on === 'AFTER_CAPTURE' ? 'after the answer' : 'everybody';
  });
}

function summary(item: FlowItem, label: (t: Target | null | undefined) => string): string {
  const q = item.question, r = item.node.routing;
  const head = q.answerType === 'FREE_TEXT' ? 'Free text' : `${q.options.length} option${q.options.length === 1 ? '' : 's'}`;
  if (r.mode === 'ALL_TO_NEXT') return `${head} · everybody → ${label(item.rows[0]?.target ?? null)}`;
  if (r.mode === 'SEQUENTIAL_FOLLOWUPS') return `${head} · ${r.followups?.length ?? 0} with a follow-up · then → ${label(r.rejoin)}`;
  if (r.mode === 'ORDERED_RULES') return `${head} · ${r.rules?.length ?? 0} rule${r.rules?.length === 1 ? '' : 's'}, the first match decides · otherwise → ${label(r.fallback)}`;
  const groups = new Map<string, number>();
  for (const row of item.rows) groups.set(label(row.target), (groups.get(label(row.target)) ?? 0) + 1);
  return `${head} · ${[...groups].map(([t, k]) => `${k} → ${t}`).join(' · ')}`;
}

function QuestionCard({ item }: { item: FlowItem }) {
  const { ws, apply, requestFocus } = useStudio();
  const { m, moduleKey, editable, issues, label, number, flat } = useB();
  const { node, question: q } = item;
  const { ref, flash } = useFocusTarget(`node:${node.id}`);
  const mine = issues.filter((i) => i.where.nodeId === node.id);
  const issueFor = (on?: string, part?: string) => mine.find((i) => (on !== undefined ? i.where.on === on : i.where.part === part));
  const canEditQ = editable && !q.published;
  const isChoice = q.answerType === 'SINGLE_SELECT' || q.answerType === 'MULTI_SELECT';
  const isFollowup = node.role === 'FOLLOWUP';
  const [folded, setFolded] = useState(!editable && !flat);
  const [details, setDetails] = useState(false);
  /** The one answer whose interruption rule is open. Only one at a time, so a question never shows every rule at once. */
  const [openRule, setOpenRule] = useState<string | null>(null);
  useEffect(() => { if (flash) setFolded(false); }, [flash]); // jumping to an issue opens the card it is on
  const r = node.routing;
  const t = TYPE_OF[q.answerType];
  const uses = usage(ws, q.code);
  const modes: Array<{ value: RoutingMode; label: string; hint: string }> = q.answerType === 'MULTI_SELECT'
    ? [{ value: 'ALL_TO_NEXT', label: 'Everybody continues', hint: 'Any selection goes to one next question' },
      { value: 'SEQUENTIAL_FOLLOWUPS', label: 'Follow-ups for each answer', hint: 'Each selected answer can add a follow-up question, asked one at a time' },
      { value: 'ORDERED_RULES', label: 'First matching rule', hint: 'Rules are checked in order; the first that fits the selection decides the one next step' }]
    : [{ value: 'ALL_TO_NEXT', label: 'Everybody continues', hint: 'Every answer goes to one next question' },
      { value: 'PER_CHOICE', label: 'Different next questions', hint: 'Each answer can lead somewhere different' }];
  const sources = inbound(m, node.id);
  const rule = q.textRule ?? { required: true, min: 1, max: 500 };

  return (
    <article ref={ref} className={`ss-q ${flash ? 'flash' : ''} ${mine.length ? 'has-issue' : ''} ${isFollowup ? 'followup' : ''}`} data-testid={`ss-q-${node.id}`} data-node={node.id} aria-label={`${item.number}: ${q.wording.text || 'Untitled question'}`}>
      <header className="ss-q-head">
        <span className="ss-q-num">{item.number}</span>
        <span className="ss-q-type"><Glyph name={t.glyph} /> {t.label}</span>
        {q.published ? (
          editable ? (
            <Popover label="Change this shared question" wide
              trigger={(p) => <button type="button" className="ss-shared-chip" {...p} data-testid={`ss-change-${node.id}`} title="Its wording and options are shared. Routing here is yours to change."><Glyph name="lock" size={13} /> Shared · used in {uses} place{uses === 1 ? '' : 's'}</button>}>
              {(close) => (
                <div className="ss-confirm">
                  <h3>This question is shared</h3>
                  <p>It is used in {uses} place{uses === 1 ? '' : 's'}. Its wording and options cannot be changed from one placement. The routing below already belongs to this placement only — change it freely.</p>
                  <div className="ss-choices">
                    <button type="button" className="ss-choice-btn" data-testid="ss-new-version" onClick={() => { apply(`New draft version of ${q.code}`, (w) => newQuestionVersion(w, moduleKey, node.id)); close(); }}>
                      <strong>Create a new version for this placement</strong><small>Same question, version {q.version + 1}. Other placements keep version {q.version} until someone upgrades them.</small></button>
                    <button type="button" className="ss-choice-btn" data-testid="ss-fork" onClick={() => { apply(`Made a separate copy of ${q.code}`, (w) => forkQuestion(w, moduleKey, node.id)); close(); }}>
                      <strong>Make a separate question</strong><small>A new question with its own identity, starting as a copy.</small></button>
                  </div>
                  <button type="button" className="ss-btn" onClick={close}>Keep the shared question</button>
                </div>
              )}
            </Popover>
          ) : <span className="ss-shared-chip static"><Glyph name="lock" size={13} /> Shared · used in {uses} place{uses === 1 ? '' : 's'}</span>
        ) : null}
        {item.inboundCount > 1 ? (
          <Popover label="Routes that lead here"
            trigger={(p) => <button type="button" className="ss-merge" {...p} data-testid={`ss-merge-${node.id}`}><Glyph name="merge" size={14} /> {item.inboundCount} routes lead here</button>}>
            {() => (
              <div className="ss-preview"><h3>Routes that lead to {item.number}</h3>
                <ul>{sources.map((s) => {
                  const src = m.nodes.find((x) => x.id === s.from);
                  const sq = src && isQuestion(src) ? ws.questions.find((x) => x.code === src.q.code && x.version === src.q.version) : undefined;
                  const opt = sq?.options.find((o) => o.code === s.on)?.label;
                  return <li key={s.id}><strong>{number(s.from)}</strong> — {opt ? `answer "${opt}"` : s.on === 'ANY' ? 'everybody' : RESULT_TEXT[s.on] ?? 'after the answer'}</li>;
                })}
                {questionNodes(m).filter((x) => x.routing.rejoin && 'node' in x.routing.rejoin && x.routing.rejoin.node === node.id).map((x) => <li key={x.id}><strong>{number(x.id)}</strong> — after its follow-ups</li>)}
                </ul>
                <p className="ss-muted">This question exists once; every route arrives at the same place.</p></div>
            )}
          </Popover>
        ) : null}
        <span className="ss-q-tools">
          {mine.length ? (
            <button type="button" className="ss-status warn" data-testid={`ss-status-${node.id}`} title={mine.map((i) => i.message).join('\n')}
              onClick={() => { setFolded(false); requestFocus(`node:${node.id}`); }}><Glyph name="alert" size={14} /> {mine.length} to fix</button>
          ) : null}
          <button type="button" className={`ss-icon-btn ${details ? 'on' : ''}`} onClick={() => { setDetails(!details); setFolded(false); }} aria-expanded={details} aria-label={`Details of ${item.number}`} title="Details: version, wording approval and answer rules" data-testid={`ss-details-${node.id}`}><Glyph name="info" /></button>
          <button type="button" className="ss-icon-btn" onClick={() => setFolded(!folded)} aria-expanded={!folded} aria-label={folded ? `Expand ${item.number}` : `Collapse ${item.number}`} data-testid={`ss-fold-${node.id}`}>
            <Glyph name={folded ? 'down' : 'up'} /></button>
          {editable ? <DeleteStep item={item} /> : null}
        </span>
      </header>

      <div className="ss-q-text">
        {canEditQ ? (
          <InlineText value={q.wording.text} label={`Question text for ${item.number}`} placeholder="Type the question the customer is asked" autoFocus={flash && !q.wording.text}
            onCommit={(v) => apply('Edited the question text', (w) => updateQuestion(w, moduleKey, node.id, { text: v }))} />
        ) : <p className="ss-q-fixed">{q.wording.text}</p>}
        {issueFor(undefined, 'text') ? <p className="ss-issue" role="alert"><Glyph name="alert" size={14} /> {issueFor(undefined, 'text')!.message}. {issueFor(undefined, 'text')!.fix}</p> : null}
      </div>

      {details && !folded ? (
        <dl className="ss-details" data-testid={`ss-details-panel-${node.id}`}>
          <div><dt>Question</dt><dd>{q.published ? `Shared question · v${q.version}` : 'Draft question'} · used in {uses} place{uses === 1 ? '' : 's'} · <span className="ss-code">{q.code}</span></dd></div>
          <div><dt>Wording</dt><dd>Version {q.wording.version} · <strong>not approved</strong> (synthetic). Wording approval is separate from routing: a complete route does not make this wording approved.</dd></div>
          {q.answerType === 'MULTI_SELECT' && q.selection ? <div><dt>Selection</dt><dd>The customer chooses between {q.selection.min} and {q.selection.max} answers.</dd></div> : null}
          {q.answerType === 'FREE_TEXT' ? <div><dt>Answer rule</dt><dd><TextRuleEditor item={item} canEdit={canEditQ} /></dd></div> : null}
        </dl>
      ) : null}

      {folded ? (
        <div className="ss-q-summary" data-testid={`ss-summary-${node.id}`}>
          <span>{summary(item, label)}</span>
          {mine.length ? (
            <button type="button" className="ss-unresolved" onClick={() => setFolded(false)} data-testid={`ss-unresolved-${node.id}`}>
              <Glyph name="alert" size={14} />
              {undecidedNames(item, mine).length
                ? <span>Not decided: {undecidedNames(item, mine).map((n) => `${n} → ?`).join(' · ')}</span>
                : <span>{mine.length} to fix — {mine[0]!.message}</span>}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="ss-q-body">
          {q.answerType === 'FREE_TEXT' ? <p className="ss-quiet">{rule.required ? 'An answer is required' : 'The answer is optional'}, {rule.min}–{rule.max} characters.</p> : null}

          {q.answerType !== 'FREE_TEXT' && !isFollowup && editable ? (
            <Segmented<RoutingMode> label={`How ${item.number} routes`} value={r.mode} options={modes}
              onChange={(mode) => { setOpenRule(null); apply(mode === 'ALL_TO_NEXT' ? 'Set everybody to continue' : mode === 'PER_CHOICE' ? 'Set a route for each answer' : mode === 'ORDERED_RULES' ? 'Set first-matching-rule routing' : 'Set follow-ups for each answer', (w) => setMode(w, moduleKey, node.id, mode)); }} />
          ) : null}

          {/* a Yes/No question that simply continues needs no option rows: "Yes / No" is already in its header */}
          {q.answerType !== 'FREE_TEXT' && (isChoice || r.mode !== 'ALL_TO_NEXT') ? <OptionRows item={item} canEdit={canEditQ} isChoice={isChoice} issueFor={issueFor} openRule={openRule} setOpenRule={setOpenRule} /> : null}
          {issueFor(undefined, 'options') ? <p className="ss-issue" role="alert"><Glyph name="alert" size={14} /> {issueFor(undefined, 'options')!.message}.</p> : null}
          {q.answerType === 'MULTI_SELECT' && q.options.length ? <SelectionLimits item={item} canEdit={canEditQ} issue={issueFor(undefined, 'selection')} /> : null}

          {isFollowup ? <p className="ss-route-line"><span className="ss-route-label">Then</span><span className="ss-dest static"><Glyph name="right" size={13} /> back to the follow-up queue</span></p> : null}

          {!isFollowup && r.mode === 'ALL_TO_NEXT' && item.rows[0] ? (
            <div className="ss-route-line">
              <span className="ss-route-label">{item.rows[0].label}</span>
              <DestinationPill nodeId={node.id} on={item.rows[0].on} target={item.rows[0].target} testId={`ss-dest-${node.id}-${item.rows[0].on}`}
                onSet={(tg) => apply(`Routed ${item.number}`, (w) => setEdge(w, moduleKey, node.id, item.rows[0]!.on, tg))} />
              {issueFor(item.rows[0].on) ? <span className="ss-issue-inline" role="alert">{issueFor(item.rows[0].on)!.fix}</span> : null}
            </div>
          ) : null}

          {r.mode === 'SEQUENTIAL_FOLLOWUPS' ? <FollowupDesigner item={item} issueFor={issueFor} /> : null}
          {r.mode === 'ORDERED_RULES' && !isFollowup ? <RuleDesigner item={item} issueFor={issueFor} /> : null}
        </div>
      )}

      {item.followups.length && !flat ? (
        <Lane laneKey={`${node.id}:followups`} title={`Follow-up questions · ${item.followups.length}`} tail="each returns to the queue" items={item.followups} kind="followups" />
      ) : null}
      <BranchLanes item={item} />
    </article>
  );
}

/** The steps reached only through one route of a card, folded under it, saying where they rejoin. */
function BranchLanes({ item }: { item: FlowEntry }) {
  const { m, label, flat } = useB();
  if (flat) return null; // in the graph the branches are drawn as nodes, not folded under the card
  return (
    <>
      {item.rows.filter((row) => row.lane.length).map((row) => {
        const lastItem = row.lane[row.lane.length - 1]!;
        const end = normalNext(m, lastItem.node, lastItem.kind === 'QUESTION' ? lastItem.question : undefined);
        const what = row.lane.every((x) => x.kind === 'QUESTION') ? 'question' : 'step';
        return <Lane key={row.on} laneKey={`${item.node.id}:${row.on}`} title={`${row.label} · ${row.lane.length} ${what}${row.lane.length === 1 ? '' : 's'}`} open={!end}
          tail={end ? ('outcome' in end ? `ends the module: ${OUTCOME_LABEL[end.outcome]}` : `rejoins ${label(end)}`) : 'does not lead anywhere yet'} items={row.lane} kind="branch" />;
      })}
    </>
  );
}

function Lane({ laneKey, title, tail, items, kind, open: deadEnd }: { laneKey: string; title: string; tail: string; items: FlowEntry[]; kind: 'branch' | 'followups'; open?: boolean }) {
  const { open, toggle, issues, editable } = useB();
  const isOpen = !open.has(laneKey);
  const collect = (list: FlowEntry[]): Issue[] => list.flatMap((it) => [...issues.filter((i) => i.where.nodeId === it.node.id), ...collect(it.followups), ...it.rows.flatMap((r) => collect(r.lane))]);
  const inside = collect(items);
  return (
    <section className={`ss-lane ${kind} ${inside.length || deadEnd ? 'has-issue' : ''}`} data-testid={`ss-lane-${laneKey}`}>
      <button type="button" className="ss-lane-head" onClick={() => toggle(laneKey)} aria-expanded={isOpen}>
        <Glyph name={isOpen ? 'down' : 'right'} size={14} />
        <Glyph name={kind === 'branch' ? 'branch' : 'list'} size={14} />
        <strong>{title}</strong><span className={`ss-lane-tail ${deadEnd ? 'undecided' : ''}`}>{tail}</span>
        {inside.length ? <span className="ss-issue-inline" data-testid={`ss-lane-issues-${laneKey}`}><Glyph name="alert" size={14} /> {inside.length} to fix{isOpen ? '' : ` — ${inside[0]!.message}`}</span> : null}
      </button>
      {isOpen ? (
        <div className="ss-lane-body">
          {items.map((it) => <StepCard key={`${it.node.id}-${editable}`} item={it} />)}
          {deadEnd ? <div className="ss-terminal end undecided" data-testid={`ss-deadend-${laneKey}`}><Glyph name="alert" size={14} /> This branch stops here — choose where it leads</div> : null}
        </div>
      ) : null}
    </section>
  );
}

function DeleteStep({ item }: { item: FlowEntry }) {
  const { apply } = useStudio();
  const { m, moduleKey, label, number } = useB();
  const next = normalNext(m, item.node, item.kind === 'QUESTION' ? item.question : undefined);
  const sources = inbound(m, item.node.id);
  const [how, setHow] = useState<'next' | 'none'>(next && !('ret' in next) ? 'next' : 'none');
  return (
    <Popover label={`Delete ${item.number}`} align="end" wide
      trigger={(p) => <button type="button" className="ss-icon-btn" {...p} aria-label={`Delete ${item.number}`} data-testid={`ss-delete-${item.node.id}`}><Glyph name="trash" /></button>}>
      {(close) => (
        <div className="ss-confirm" data-testid="ss-delete-impact">
          <h3>Delete {item.number}?</h3>
          {sources.length ? (
            <><p>{sources.length} route{sources.length === 1 ? '' : 's'} lead{sources.length === 1 ? 's' : ''} here:</p>
              <ul>{sources.map((s) => <li key={s.id}>{number(s.from)} · {s.on === 'ANY' ? 'everybody' : s.on === 'AFTER_CAPTURE' ? 'after the answer' : RESULT_TEXT[s.on] ?? s.on}</li>)}</ul>
              <fieldset className="ss-choice stack">
                <legend>Where should {sources.length === 1 ? 'it' : 'they'} go instead?</legend>
                {next && !('ret' in next) ? <label className={how === 'next' ? 'on' : ''}><input type="radio" name="rewire" checked={how === 'next'} onChange={() => setHow('next')} />
                  <span><strong>{label(next)}</strong><small>{item.kind === 'QUESTION' ? 'Where this question normally leads.' : 'Where this decision leads when it does not match.'}</small></span></label> : null}
                <label className={how === 'none' ? 'on' : ''}><input type="radio" name="rewire" checked={how === 'none'} onChange={() => setHow('none')} />
                  <span><strong>Leave undecided</strong><small>Each route is marked "Choose destination" for you to set.</small></span></label>
              </fieldset></>
          ) : <p>No route leads here, so nothing else changes.</p>}
          {item.kind === 'QUESTION' && item.question.published ? <p className="ss-muted">Only this placement is removed. The shared question stays in the library.</p> : null}
          <div className="ss-actions">
            <button type="button" className="ss-btn danger" data-testid="ss-delete-confirm"
              onClick={() => { apply(`Deleted ${item.number}`, (w) => deleteNode(w, moduleKey, item.node.id, how === 'next' && next && !('ret' in next) ? next : null)); close(); }}>Delete</button>
            <button type="button" className="ss-btn" onClick={close}>Keep it</button>
          </div>
        </div>
      )}
    </Popover>
  );
}

function TextRuleEditor({ item, canEdit }: { item: FlowItem; canEdit: boolean }) {
  const { apply } = useStudio();
  const { moduleKey } = useB();
  const rule = item.question.textRule ?? { required: true, min: 1, max: 500 };
  const set = (patch: Partial<typeof rule>) => apply('Changed the text rule', (w) => updateQuestion(w, moduleKey, item.node.id, { textRule: { ...rule, ...patch } }));
  if (!canEdit) return <p className="ss-muted">{rule.required ? 'An answer is required' : 'The answer is optional'} · {rule.min}–{rule.max} characters</p>;
  return (
    <div className="ss-text-rule">
      <label className="ss-check"><input type="checkbox" checked={rule.required} onChange={(e) => set({ required: e.target.checked, min: e.target.checked ? Math.max(1, rule.min) : 0 })} /><span>An answer is required</span></label>
      <label className="ss-mini"><span>At least</span><input inputMode="numeric" value={rule.min} onChange={(e) => set({ min: Number(e.target.value.replace(/\D/g, '')) || 0 })} aria-label="Minimum characters" /><em>characters</em></label>
      <label className="ss-mini"><span>At most</span><input inputMode="numeric" value={rule.max} onChange={(e) => set({ max: Number(e.target.value.replace(/\D/g, '')) || 1 })} aria-label="Maximum characters" /><em>characters</em></label>
    </div>
  );
}

/** Option text: typed freely, committed on blur or Enter as ONE undoable step. Alt+↑/↓ reorders. The code never changes. */
function OptionLabel({ value, index, onCommit, onMove }: { value: string; index: number; onCommit: (v: string) => void; onMove: (delta: number) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(value); }
  return (
    <input className="ss-option-label" value={draft} aria-label={`Option ${index + 1} text`} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); if (draft !== value) onCommit(draft); onMove(e.key === 'ArrowUp' ? -1 : 1); }
      }} />
  );
}

const CLASS_TEXT = { OPTIONAL: 'May interrupt', MANDATORY: 'Must escalate' } as const;

// ---- options, with their routes on the same row -------------------------------------------------------------------
function OptionRows({ item, canEdit, isChoice, issueFor, openRule, setOpenRule }: {
  item: FlowItem; canEdit: boolean; isChoice: boolean; issueFor: (on?: string, part?: string) => Issue | undefined;
  openRule: string | null; setOpenRule: (code: string | null) => void;
}) {
  const { apply, requestFocus } = useStudio();
  const { moduleKey } = useB();
  const { node, question: q } = item;
  const [draft, setDraft] = useState('');
  const other = q.options.find((o) => o.isOther);
  const editable = canEdit && isChoice;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const add = () => { if (!draft.trim()) return; apply(`Added the option "${draft.trim()}"`, (w) => addOption(w, moduleKey, node.id, draft)); setDraft(''); };
  const move = (from: number, to: number) => {
    const max = q.options.length - (other ? 2 : 1); // "Other" stays last
    if (to < 0 || to > max || q.options[from]?.isOther) return;
    apply('Reordered the options', (w) => moveOption(w, moduleKey, node.id, from, to));
    requestFocus(`opt:${node.id}:${q.options[from]!.code}`);
  };
  return (
    <div className="ss-options" data-testid={`ss-options-${node.id}`}>
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragEnd={(e) => { if (e.over && e.active.id !== e.over.id) move(q.options.findIndex((o) => o.code === e.active.id), q.options.findIndex((o) => o.code === e.over!.id)); }}>
        <SortableContext items={q.options.map((o) => o.code)} strategy={verticalListSortingStrategy}>
          <ul>
            {q.options.map((o, i) => <OptionRow key={o.code} item={item} index={i} editable={editable} issueFor={issueFor} onMove={(d) => move(i, i + d)}
              ruleOpen={openRule === o.code} onRule={(open) => setOpenRule(open ? o.code : null)} />)}
          </ul>
        </SortableContext>
      </DndContext>
      {editable ? (
        <div className="ss-option-add">
          <span className="ss-option-mark" aria-hidden="true">+</span>
          <input value={draft} placeholder={q.options.length ? 'Add another option, then press Enter' : 'Type the first option, then press Enter'} aria-label="New option" data-testid={`ss-option-new-${node.id}`}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add} />
          <label className="ss-check other"><input type="checkbox" checked={!!other} data-testid={`ss-other-${node.id}`}
            onChange={(e) => apply(e.target.checked ? 'Added "Other — please specify"' : 'Removed "Other — please specify"', (w) => toggleOther(w, moduleKey, node.id, e.target.checked))} />
            <span>Include "Other — please specify"</span></label>
        </div>
      ) : null}
    </div>
  );
}

function OptionRow({ item, index, editable, issueFor, onMove, ruleOpen, onRule }: {
  item: FlowItem; index: number; editable: boolean; issueFor: (on?: string, part?: string) => Issue | undefined; onMove: (delta: number) => void;
  ruleOpen: boolean; onRule: (open: boolean) => void;
}) {
  const { apply, requestFocus, focus } = useStudio();
  const { moduleKey } = useB();
  const { node, question: q } = item;
  const o = q.options[index]!;
  const r = node.routing;
  const row = item.rows.find((x) => x.on === o.code);
  const issue = issueFor(o.code);
  const interrupt = r.mode === 'SEQUENTIAL_FOLLOWUPS' ? r.interrupts?.find((x) => x.option === o.code) : undefined;
  const movable = editable && !o.isOther;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: o.code, disabled: !movable });
  const li = useRef<HTMLLIElement | null>(null);
  const wanted = focus?.key === `opt:${node.id}:${o.code}` ? focus.at : 0;
  useEffect(() => { if (wanted) li.current?.querySelector<HTMLInputElement>('.ss-option-label')?.focus(); }, [wanted]);
  const last = index === q.options.length - (q.options.some((x) => x.isOther) ? 2 : 1);
  return (
    <li ref={(el) => { setNodeRef(el); li.current = el; }} style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`ss-option ${issue ? 'has-issue' : ''} ${isDragging ? 'dragging' : ''}`} data-testid={`ss-option-${node.id}-${o.code}`}>
      {movable ? <button type="button" className="ss-grip small" {...attributes} {...listeners} aria-label={`Drag to reorder ${o.label || 'this option'}`}><Glyph name="grip" size={14} /></button>
        : <span className="ss-option-mark" aria-hidden="true">{q.answerType === 'MULTI_SELECT' ? '☐' : '○'}</span>}
      {editable ? (
        <OptionLabel value={o.label} index={index} onMove={onMove}
          onCommit={(v) => apply('Renamed an option', (w) => renameOption(w, moduleKey, node.id, o.code, v))} />
      ) : <span className="ss-option-label fixed">{o.label}</span>}
      {o.exclusive ? <Tag>Only on its own</Tag> : null}
      {o.interrupt ? <Tag tone={o.interrupt === 'MANDATORY' ? 'warn' : 'plain'} glyph="stop">{CLASS_TEXT[o.interrupt]}</Tag> : null}

      {r.mode === 'PER_CHOICE' && row && node.role !== 'FOLLOWUP' ? (
        <DestinationPill nodeId={node.id} on={o.code} target={row.target} testId={`ss-dest-${node.id}-${o.code}`} escalationOnly={o.interrupt === 'MANDATORY'}
          onSet={(tg) => apply(`Routed "${o.label}"`, (w) => setEdge(w, moduleKey, node.id, o.code, tg))} />
      ) : null}
      {r.mode === 'SEQUENTIAL_FOLLOWUPS' ? <FollowupBehaviour item={item} option={o.code} undecided={!!issue} onInterrupt={() => onRule(true)} /> : null}
      {interrupt ? (
        <button type="button" className={`ss-rule-toggle ${ruleOpen ? 'on' : ''}`} aria-expanded={ruleOpen} onClick={() => onRule(!ruleOpen)} data-testid={`ss-rule-toggle-${node.id}-${o.code}`}>
          {ruleOpen ? 'Hide rule' : 'Rule'} <Glyph name={ruleOpen ? 'up' : 'down'} size={13} /></button>
      ) : null}

      {editable && !o.isOther ? (
        <button type="button" className="ss-icon-btn" aria-label={`Duplicate ${o.label}`} title="Duplicate this option" data-testid={`ss-duplicate-${node.id}-${o.code}`}
          onClick={() => {
            const routed = r.mode !== 'ALL_TO_NEXT';
            const code = apply(routed ? `Duplicated "${o.label}" — choose where the copy leads` : `Duplicated "${o.label}"`, (w) => duplicateOption(w, moduleKey, node.id, o.code));
            if (code) requestFocus(`opt:${node.id}:${code}`);
          }}><Glyph name="copy" /></button>
      ) : null}
      {editable ? <OptionMenu item={item} code={o.code} canUp={movable && index > 0} canDown={movable && !last} onMove={onMove} /> : null}
      {issue ? <span className="ss-issue-inline" role="alert" data-testid={`ss-option-issue-${node.id}-${o.code}`}><Glyph name="alert" size={14} /> {issue.where.part === 'mandatory' ? issue.fix : r.mode === 'PER_CHOICE' ? 'Not routed yet — choose a destination' : issue.fix}</span> : null}
      {o.isOther && o.otherText ? (
        <p className="ss-other-rule" data-testid={`ss-other-rule-${node.id}`}>When chosen, the customer is asked to specify — text {o.otherText.required ? 'required' : 'optional'}, up to {o.otherText.max} characters.</p>
      ) : null}
      {interrupt && ruleOpen ? <InterruptCard item={item} interrupt={interrupt} issue={issue} /> : null}
    </li>
  );
}

/**
 * Everything else about one answer, behind a single always-present button so the row never changes shape:
 * order, exclusivity, whether it may interrupt (part of the question's DEFINITION, so only on a draft question), remove.
 */
function OptionMenu({ item, code, canUp, canDown, onMove }: { item: FlowItem; code: string; canUp: boolean; canDown: boolean; onMove: (delta: number) => void }) {
  const { apply } = useStudio();
  const { moduleKey } = useB();
  const o = item.question.options.find((x) => x.code === code)!;
  const multi = item.question.answerType === 'MULTI_SELECT';
  const classes: Array<{ v: InterruptClass | null; title: string; text: string }> = [
    { v: null, title: 'Ordinary answer', text: 'It never interrupts anything.' },
    ...(multi ? [{ v: 'OPTIONAL' as const, title: 'May interrupt follow-ups', text: 'Each placement chooses: stop and escalate, handle it first and continue, or stop and go elsewhere.' }] : []),
    { v: 'MANDATORY', title: 'Must escalate', text: 'A required escalation. Every placement must stop and escalate; none can weaken it.' },
  ];
  return (
    <Popover label={`More for ${o.label}`} align="end" wide
      trigger={(p) => <button type="button" className="ss-icon-btn" {...p} aria-label={`More for ${o.label}`} title="Order, rules and remove" data-testid={`ss-more-${item.node.id}-${code}`}><Glyph name="more" /></button>}>
      {(close) => (
        <div className="ss-option-menu" data-testid="ss-option-menu">
          <p className="ss-muted">Stable code <span className="ss-code">{code}</span> — renaming or moving the answer never changes it.</p>
          {!o.isOther ? (
            <div className="ss-menu-row">
              <button type="button" className="ss-btn small" disabled={!canUp} onClick={() => { onMove(-1); close(); }} data-testid="ss-menu-up"><Glyph name="up" size={14} /> Move up</button>
              <button type="button" className="ss-btn small" disabled={!canDown} onClick={() => { onMove(1); close(); }} data-testid="ss-menu-down"><Glyph name="down" size={14} /> Move down</button>
            </div>
          ) : null}
          {multi && !o.isOther ? (
            <label className="ss-check"><input type="checkbox" checked={!!o.exclusive} data-testid="ss-menu-exclusive"
              onChange={(e) => apply(e.target.checked ? `Made "${o.label}" exclusive` : `"${o.label}" can be combined again`, (w) => patchOption(w, moduleKey, item.node.id, code, { exclusive: e.target.checked }))} />
              <span><strong>Exclusive</strong><small>Cannot be combined with other answers, e.g. "None of the above".</small></span></label>
          ) : null}
          {!o.isOther ? (
            <fieldset className="ss-menu-group">
              <legend>Can this answer interrupt?</legend>
              <p className="ss-muted">Part of the question itself, so it applies wherever the question is used.</p>
              <div className="ss-choices">
                {classes.map((c) => (
                  <button key={String(c.v)} type="button" className={`ss-choice-btn ${(o.interrupt ?? null) === c.v ? 'on' : ''}`} aria-pressed={(o.interrupt ?? null) === c.v} data-testid={`ss-class-${c.v ?? 'NONE'}`}
                    onClick={() => { apply(`"${o.label}": ${c.title.toLowerCase()}`, (w) => setInterruptClass(w, moduleKey, item.node.id, code, c.v)); close(); }}>
                    <strong>{c.title}</strong><small>{c.text}</small></button>
                ))}
              </div>
            </fieldset>
          ) : null}
          {o.isOther && o.otherText ? (
            <fieldset className="ss-menu-group">
              <legend>The text the customer specifies</legend>
              <label className="ss-check"><input type="checkbox" checked={o.otherText.required} data-testid="ss-menu-other-required"
                onChange={(e) => apply('Changed the "Other" text rule', (w) => patchOption(w, moduleKey, item.node.id, code, { otherText: { ...o.otherText!, required: e.target.checked } }))} /><span>Text required</span></label>
              <label className="ss-mini"><span>At most</span><input inputMode="numeric" aria-label="Maximum characters for Other" value={o.otherText.max}
                onChange={(e) => apply('Changed the "Other" text rule', (w) => patchOption(w, moduleKey, item.node.id, code, { otherText: { ...o.otherText!, max: Number(e.target.value.replace(/\D/g, '')) || 1 } }))} /><em>characters</em></label>
            </fieldset>
          ) : null}
          <button type="button" className="ss-btn small danger" data-testid={`ss-remove-option-${item.node.id}-${code}`}
            onClick={() => { apply(`Removed the option "${o.label}"`, (w) => removeOption(w, moduleKey, item.node.id, code)); close(); }}><Glyph name="trash" size={14} /> Remove this option</button>
        </div>
      )}
    </Popover>
  );
}

// ---- decision points (SS-02B.1) -----------------------------------------------------------------------------------
const RESULT_TEXT: Record<string, string> = { MATCH: 'when it matches', NO_MATCH: 'otherwise', UNKNOWN: 'when information is missing' };

/**
 * A decision point: it asks nothing, checks one condition and leads exactly one of three ways. The card shows the
 * condition as a sentence and the three destinations; the rule tree itself is only in the drawer.
 */
function DecisionCard({ item }: { item: FlowDecision }) {
  const { ws, apply, requestFocus } = useStudio();
  const { m, moduleKey, editable, issues, numbers, editCondition } = useB();
  const { node } = item;
  const { ref, flash } = useFocusTarget(`node:${node.id}`);
  const mine = issues.filter((i) => i.where.nodeId === node.id);
  const issueFor = (on?: string, part?: string) => mine.find((i) => (on !== undefined ? i.where.on === on : i.where.part === part));
  const b = node.binding;
  const c = b && b.condition.code ? findCondition(ws, b.condition) : undefined;
  const sentence = bindingSentence(ws, b, m, numbers);
  const newest = c ? Math.max(...ws.conditions.filter((x) => x.code === c.code && x.shared).map((x) => x.version), 0) : 0;
  const condIssue = issueFor(undefined, 'condition');
  return (
    <article ref={ref} className={`ss-q ss-d ${flash ? 'flash' : ''} ${mine.length ? 'has-issue' : ''}`} data-testid={`ss-d-${node.id}`} data-node={node.id} aria-label={`${item.number}: condition${sentence ? `, when ${sentence}` : ''}`}>
      <header className="ss-q-head">
        <span className="ss-q-num">{item.number}</span>
        <span className="ss-q-type"><Glyph name="branch" /> Condition</span>
        {c?.shared ? <span className="ss-shared-chip static" title="A library condition. What it checks is shared; the values below belong to this placement."><Glyph name="link" size={13} /> {c.name} · v{c.version}</span> : null}
        {c?.shared && newest > c.version ? <span className="ss-tag" data-testid={`ss-d-newer-${node.id}`} title="A newer version exists. Nothing is upgraded automatically: open the condition and choose the version for this placement.">v{newest} available · not applied</span> : null}
        {item.inboundCount > 1 ? <span className="ss-merge static"><Glyph name="merge" size={14} /> {item.inboundCount} routes lead here</span> : null}
        <span className="ss-q-tools">
          {mine.length ? (
            <button type="button" className="ss-status warn" data-testid={`ss-status-${node.id}`} title={mine.map((i) => i.message).join('\n')}
              onClick={() => requestFocus(`node:${node.id}`)}><Glyph name="alert" size={14} /> {mine.length} to fix</button>
          ) : null}
          {editable ? <DeleteStep item={item} /> : null}
        </span>
      </header>

      <div className="ss-d-when">
        <span className="ss-d-lead">When</span>
        {editable ? (
          <button type="button" className={`ss-d-sentence ${sentence ? '' : 'undecided'}`} onClick={() => editCondition(node.id)} data-testid={`ss-d-edit-${node.id}`}
            aria-label={sentence ? `Edit the condition: ${sentence}` : 'Say what this decision checks'}>
            <span data-testid={`ss-d-sentence-${node.id}`}>{sentence ?? 'Say what this decision checks'}</span><Glyph name="open" size={14} /></button>
        ) : <p className="ss-d-sentence static" data-testid={`ss-d-sentence-${node.id}`}>{sentence ?? 'No condition yet'}</p>}
      </div>
      {condIssue ? <p className="ss-issue" role="alert" data-testid={`ss-d-issue-${node.id}`}><Glyph name="alert" size={14} /> {condIssue.message}. {condIssue.fix}</p> : null}

      <div className="ss-d-rows">
        {item.rows.map((row) => (
          <div key={row.on} className={`ss-route-line ${row.on === 'UNKNOWN' ? 'unknown' : ''}`}>
            <span className="ss-route-label">{row.label}</span>
            {row.on === 'UNKNOWN'
              ? <UnknownPill item={item} target={row.target} undecided={!!issueFor('UNKNOWN')} />
              : <DestinationPill nodeId={node.id} on={row.on} target={row.target} testId={`ss-dest-${node.id}-${row.on}`}
                  onSet={(tg) => apply(`Routed ${item.number} · ${row.label.toLowerCase()}`, (w) => setEdge(w, moduleKey, node.id, row.on, tg))} />}
            {issueFor(row.on) ? <span className="ss-issue-inline" role="alert" data-testid={`ss-d-issue-${node.id}-${row.on}`}>{issueFor(row.on)!.fix}</span> : null}
          </div>
        ))}
      </div>
      <BranchLanes item={item} />
    </article>
  );
}

/** What happens when the condition cannot be worked out. Always an explicit choice: a destination, or stop for review. */
function UnknownPill({ item, target, undecided }: { item: FlowDecision; target: Target | null; undecided: boolean }) {
  const { apply } = useStudio();
  const { m, moduleKey, editable, label } = useB();
  const stop = item.node.binding?.unknownPolicy === 'BLOCK';
  const text = stop ? 'Stop and flag for review' : target ? label(target) : 'Choose what happens';
  const halts = 'Review required: the call does not continue and is not completed; it waits for an authorised review';
  if (!editable) return <span className={`ss-dest static ${undecided ? 'undecided' : ''}`}><Glyph name={stop ? 'stop' : 'right'} size={13} /> {text}</span>;
  const items: PickItem[] = [
    { id: 'stop', label: 'Stop and flag for review', hint: halts, group: 'Do not continue', glyph: 'stop' },
    ...stepItems(m, item.node.id, label),
    ...OUTCOMES.map((o) => ({ id: `o:${o}`, label: `End module: ${OUTCOME_LABEL[o]}`, group: 'End the module', glyph: (o === 'COMPLETED' ? 'check' : 'stop') as GlyphName })),
  ];
  return (
    <Popover label="What happens when information is missing" wide
      trigger={(p) => <button type="button" className={`ss-dest ${undecided ? 'undecided' : ''} ${stop ? 'stop' : ''}`} {...p} data-testid={`ss-dest-${item.node.id}-UNKNOWN`}>
        <Glyph name={undecided ? 'alert' : stop ? 'stop' : 'right'} size={13} /> <span>{text}</span></button>}>
      {(close) => <Picker items={items} placeholder="Search questions and outcomes"
        footer={<p className="ss-muted">Used when a customer detail is missing or an earlier question was not asked. It is never treated as “otherwise”.</p>}
        onPick={(id) => {
          apply(`Set what ${item.number} does when information is missing`, (w) => setDecisionUnknown(w, moduleKey, item.node.id, id === 'stop' ? { stop: true } : { to: id.startsWith('n:') ? { node: id.slice(2) } : { outcome: id.slice(2) as OutcomeCode } }));
          close();
        }} />}
    </Popover>
  );
}

// ---- multi-select: selection limits and first-matching-rule routing (SS-02B.1) ------------------------------------
/** A small whole-number field that commits on blur or Enter, so typing "12" is one undoable step, not two. */
function MiniNumber({ value, label, testId, onCommit }: { value: number; label: string; testId: string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(String(value)); }
  const commit = () => { const v = draft === '' ? value : Number(draft); if (v !== value) onCommit(v); else setDraft(String(value)); };
  return <input inputMode="numeric" value={draft} aria-label={label} data-testid={testId} onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 2))}
    onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

function SelectionLimits({ item, canEdit, issue }: { item: FlowItem; canEdit: boolean; issue?: Issue }) {
  const { apply } = useStudio();
  const { moduleKey } = useB();
  const q = item.question;
  const combinable = q.options.filter((o) => !o.exclusive);
  const exclusive = q.options.filter((o) => o.exclusive);
  const stored = q.selection; // undefined = the author has set no limits
  const sel = effectiveSelection(q);
  const most = Math.max(1, combinable.length);
  const save = (next: { min: number; max: number } | null, text: string) => apply(text, (w) => updateQuestion(w, moduleKey, item.node.id, { selection: next }));
  const names = combinable.map((o) => `“${o.label || o.code}”`);
  const accepted = names.slice(0, Math.max(1, Math.min(sel.max, Math.max(sel.min, 2)))).join(' + ');
  const example = [
    names.length ? `${accepted} is accepted` : '',
    sel.max < combinable.length ? `${sel.max + 1} answers together are not` : '',
    sel.min > 1 ? `fewer than ${sel.min} is not` : '',
    exclusive.length ? `“${exclusive[0]!.label}” can only be chosen on its own` : '',
  ].filter(Boolean).join('; ');
  // Limits that no longer fit the answers are a CONFLICT for the author to resolve: they are kept exactly as set until then.
  const fitted = stored ? { min: Math.min(stored.min, most), max: Math.min(Math.max(stored.max, 1), most) } : null;
  const fits = fitted && fitted.min <= fitted.max && (fitted.min !== stored!.min || fitted.max !== stored!.max);
  return (
    <div className={`ss-limits ${issue ? 'has-issue' : ''}`} data-testid={`ss-limits-${item.node.id}`}>
      {canEdit ? (
        <p className="ss-limits-line">
          <span>The customer chooses at least</span>
          <MiniNumber value={sel.min} label="Fewest answers the customer may choose" testId={`ss-limit-min-${item.node.id}`} onCommit={(v) => save({ ...sel, min: v }, 'Changed how many answers can be chosen')} />
          <span>and at most</span>
          <MiniNumber value={sel.max} label="Most answers the customer may choose" testId={`ss-limit-max-${item.node.id}`} onCommit={(v) => save({ ...sel, max: v }, 'Changed how many answers can be chosen')} />
          <span>of the {combinable.length} answers that can be combined{stored ? '.' : ' — no limit set, so up to all of them.'}</span>
          {stored && !issue ? <button type="button" className="ss-link quiet" onClick={() => save(null, 'Removed the selection limits')} data-testid={`ss-limit-clear-${item.node.id}`}>Remove the limits</button> : null}
        </p>
      ) : <p className="ss-limits-line"><span>The customer chooses between {sel.min} and {sel.max} answers.</span></p>}
      {issue ? (
        <div className="ss-conflict" role="alert" data-testid={`ss-limits-issue-${item.node.id}`}>
          <p className="ss-issue"><Glyph name="alert" size={14} /> {issue.message}. {issue.fix}</p>
          {canEdit ? (
            <p className="ss-conflict-actions">
              {fits ? <button type="button" className="ss-btn small" data-testid={`ss-limit-fit-${item.node.id}`}
                onClick={() => save(fitted, `Set the limits to ${fitted.min}–${fitted.max}`)}>Use at least {fitted.min} and at most {fitted.max}</button> : null}
              <button type="button" className="ss-btn small" data-testid={`ss-limit-remove-${item.node.id}`} onClick={() => save(null, 'Removed the selection limits')}>Remove the limits</button>
              <span className="ss-muted">or type new limits above. Nothing was changed for you.</span>
            </p>
          ) : null}
        </div>
      ) : example ? <p className="ss-quiet" data-testid={`ss-limits-example-${item.node.id}`}>For example: {example}.</p> : null}
    </div>
  );
}

const RULE_KINDS: Array<[SetRule['kind'], string]> = [['ANY', 'any of'], ['ALL', 'all of'], ['NONE', 'none of']];

/**
 * First-matching-rule routing for a multiple-choice question. The list order IS the priority: rules are checked from
 * the top and the first one that fits the selection decides the single next step. Nothing runs in parallel.
 */
function RuleDesigner({ item, issueFor }: { item: FlowItem; issueFor: (on?: string, part?: string) => Issue | undefined }) {
  const { apply } = useStudio();
  const { moduleKey, editable, label } = useB();
  const { node, question: q } = item;
  const rules = node.routing.rules ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [trying, setTrying] = useState(false);
  const unused = shadowedRules(node, q);
  const invalid = selectionError(q, picked, 'sample text');
  const win = ruleWinner(node, picked);
  const set = (rule: SetRule, patch: Partial<Omit<SetRule, 'id'>>, text: string) => apply(text, (w) => updateRule(w, moduleKey, node.id, rule.id, patch));
  return (
    <div className="ss-rules" data-testid={`ss-rules-${node.id}`}>
      <h4>Rules, checked from the top — the first one that fits decides</h4>
      {rules.length === 0 ? <p className="ss-muted">No rules yet. Without rules every selection takes the “Otherwise” route below.</p> : null}
      <ol className="ss-rule-list">
        {rules.map((rule, i) => {
          const issue = issueFor(`RULE:${rule.id}`);
          return (
            <li key={rule.id} className={`ss-rule ${issue ? 'has-issue' : ''}`} data-testid={`ss-rule-${node.id}-${i + 1}`}>
              <span className="ss-queue-n" aria-label={`Priority ${i + 1}`}>{i + 1}</span>
              <div className="ss-rule-main">
                <div className="ss-rule-if">
                  <span>If the selection includes</span>
                  {editable ? (
                    <select className="ss-select" aria-label={`Rule ${i + 1}: how the answers combine`} value={rule.kind} data-testid={`ss-rule-kind-${node.id}-${i + 1}`}
                      onChange={(e) => set(rule, { kind: e.target.value as SetRule['kind'] }, `Changed rule ${i + 1}`)}>
                      {RULE_KINDS.map(([k, text]) => <option key={k} value={k}>{text}</option>)}
                    </select>
                  ) : <strong>{RULE_KINDS.find(([k]) => k === rule.kind)![1]}</strong>}
                </div>
                <div className="ss-rule-opts" role="group" aria-label={`Rule ${i + 1}: answers to look for`}>
                  {q.options.map((o) => {
                    const on = rule.options.includes(o.code);
                    return (
                      <button key={o.code} type="button" className={`ss-rule-opt ${on ? 'on' : ''}`} aria-pressed={on} disabled={!editable} data-testid={`ss-rule-opt-${node.id}-${i + 1}-${o.code}`}
                        onClick={() => set(rule, { options: on ? rule.options.filter((c) => c !== o.code) : q.options.map((x) => x.code).filter((c) => c === o.code || rule.options.includes(c)) }, `Changed the answers of rule ${i + 1}`)}>
                        {on ? <Glyph name="check" size={12} /> : null} {o.label || o.code}
                      </button>
                    );
                  })}
                </div>
                {issue ? <p className="ss-issue" role="alert"><Glyph name="alert" size={14} /> {issue.fix}</p>
                  : unused.includes(i) ? <p className="ss-warn-text" data-testid={`ss-rule-unused-${node.id}-${i + 1}`}><Glyph name="alert" size={14} /> This rule never decides: an earlier rule always fits first, or no allowed selection fits it.</p> : null}
              </div>
              <DestinationPill nodeId={node.id} on={`RULE:${rule.id}`} target={rule.to} allowCreate={false} testId={`ss-rule-dest-${node.id}-${i + 1}`}
                onSet={(tg) => set(rule, { to: tg }, `Routed rule ${i + 1}`)} />
              {editable ? (
                <span className="ss-rule-tools">
                  <button type="button" className="ss-icon-btn" disabled={i === 0} aria-label={`Rule ${i + 1}: check earlier`} title="Check earlier (higher priority)" data-testid={`ss-rule-up-${node.id}-${i + 1}`}
                    onClick={() => apply('Changed the rule priority', (w) => moveRule(w, moduleKey, node.id, i, i - 1))}><Glyph name="up" /></button>
                  <button type="button" className="ss-icon-btn" disabled={i === rules.length - 1} aria-label={`Rule ${i + 1}: check later`} title="Check later (lower priority)" data-testid={`ss-rule-down-${node.id}-${i + 1}`}
                    onClick={() => apply('Changed the rule priority', (w) => moveRule(w, moduleKey, node.id, i, i + 1))}><Glyph name="down" /></button>
                  <button type="button" className="ss-icon-btn" aria-label={`Remove rule ${i + 1}`} data-testid={`ss-rule-remove-${node.id}-${i + 1}`}
                    onClick={() => apply(`Removed rule ${i + 1}`, (w) => removeRule(w, moduleKey, node.id, rule.id))}><Glyph name="trash" /></button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {editable ? <button type="button" className="ss-link" data-testid={`ss-rule-add-${node.id}`} onClick={() => apply('Added a rule', (w) => addRule(w, moduleKey, node.id))}><Glyph name="plus" size={13} /> Add a rule</button> : null}
      <div className="ss-route-line">
        <span className="ss-route-label">Otherwise</span>
        <DestinationPill nodeId={node.id} on="FALLBACK" target={node.routing.fallback ?? null} allowCreate={false} testId={`ss-fallback-${node.id}`}
          onSet={(tg) => apply('Set where it leads when no rule fits', (w) => setFallback(w, moduleKey, node.id, tg))} />
        {issueFor('FALLBACK') ? <span className="ss-issue-inline" role="alert">{issueFor('FALLBACK')!.fix}</span> : null}
      </div>
      <p className="ss-muted">Exactly one route is taken, never two at once. A selection that breaks the limits above is not routed at all: the question is asked again.</p>

      <div className="ss-try" data-testid={`ss-try-${node.id}`}>
        <button type="button" className="ss-disclosure" aria-expanded={trying} onClick={() => setTrying(!trying)} data-testid={`ss-try-toggle-${node.id}`}>
          <Glyph name={trying ? 'down' : 'right'} size={14} /> Try a combination</button>
        {trying ? (
          <>
            <div className="ss-try-options">
              {q.options.map((o) => (
                <label key={o.code} className={`ss-try-opt ${picked.includes(o.code) ? 'on' : ''}`}>
                  <input type="checkbox" checked={picked.includes(o.code)} data-testid={`ss-try-${node.id}-${o.code}`}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, o.code] : picked.filter((c) => c !== o.code))} /> {o.label}
                </label>
              ))}
            </div>
            {picked.length === 0 && !invalid ? <p className="ss-muted">Tick some answers to see which rule decides.</p>
              : invalid ? <p className="ss-issue" role="alert" data-testid={`ss-try-error-${node.id}`}><Glyph name="alert" size={14} /> Not accepted: {invalid} The customer is asked again; no rule is used.</p> : (
                <div className="ss-try-result" data-testid={`ss-try-result-${node.id}`}>
                  <p><strong>{win.index >= 0 ? `Rule ${win.index + 1} decides` : 'No rule fits — “Otherwise” decides'}</strong> → {label(win.to)}</p>
                  {win.alsoMatched.length ? <p className="ss-muted" data-testid={`ss-try-also-${node.id}`}>Also fits, but is not used because an earlier rule already decided: {win.alsoMatched.map((k) => `rule ${k + 1}`).join(', ')}.</p> : null}
                </div>
              )}
            <p className="ss-muted">Preview from the prototype's demonstration evaluator.</p>
          </>
        ) : <p className="ss-muted">See which rule decides for a set of answers.</p>}
      </div>
    </div>
  );
}

// ---- follow-up designer (Screen E) --------------------------------------------------------------------------------
const POLICY_TEXT: Record<InterruptPolicy, { title: string; text: string }> = {
  STOP_ESCALATE: { title: 'Stop and escalate', text: 'No follow-ups are asked. The module ends with the outcome you choose.' },
  RESUME: { title: 'Handle this first, then continue', text: 'Its own question is asked first; the remaining follow-ups then continue in order.' },
  STOP_REJOIN: { title: 'Stop and go to…', text: 'No follow-ups are asked. The customer continues at the destination you choose.' },
};

function FollowupBehaviour({ item, option, undecided, onInterrupt }: { item: FlowItem; option: string; undecided: boolean; onInterrupt: () => void }) {
  const { apply, requestFocus } = useStudio();
  const { moduleKey, editable, label } = useB();
  const r = item.node.routing;
  const o = item.question.options.find((x) => x.code === option)!;
  const f = r.followups?.find((x) => x.option === option);
  const it = r.interrupts?.find((x) => x.option === option);
  const text = f ? `asks ${label({ node: f.nodes[0]! })}`
    : it ? (it.policy === 'STOP_ESCALATE' ? `Stops · ${it.outcome ? OUTCOME_LABEL[it.outcome] : 'choose the outcome'}`
      : it.policy === 'RESUME' ? ((it.nodes ?? []).length ? 'Asked first, then continues' : 'Asked first · choose the question') : `Stops · goes to ${it.rejoin ? label(it.rejoin) : '… choose'}`)
      : r.noFollowup?.includes(option) ? 'no follow-up' : o.interrupt === 'MANDATORY' ? 'Choose the escalation' : 'Choose what this answer does';
  if (!editable) return <span className="ss-dest static">{text}</span>;
  const existing = [...new Set((r.followups ?? []).flatMap((x) => x.nodes))].filter((id) => !f?.nodes.includes(id));
  const allowed = permittedInterrupts(o.interrupt);
  const items: PickItem[] = [
    ...(o.interrupt === 'MANDATORY' ? [] : [
      { id: 'none', label: 'No follow-up', hint: 'This answer adds nothing to the queue', glyph: 'close' as const },
      ...TYPES.filter((t) => t.type !== 'MULTI_SELECT').map((t) => ({ id: `new:${t.type}`, label: `New ${t.label.toLowerCase()} question`, group: 'Ask a follow-up question', glyph: t.glyph })),
      ...existing.map((id) => ({ id: `use:${id}`, label: `Same as ${label({ node: id })}`, hint: 'Asked once even if several answers point to it', group: 'Ask a follow-up question', glyph: 'merge' as const })),
    ]),
    ...(o.interrupt === 'MANDATORY'
      ? ESCALATION_OUTCOMES.map((x) => ({ id: `esc:${x}`, label: `Stop and escalate: ${OUTCOME_LABEL[x]}`, hint: 'Required by the question — cannot be weakened', group: 'Mandatory escalation', glyph: 'stop' as const }))
      : allowed.map((pol) => ({ id: `int:${pol}`, label: POLICY_TEXT[pol].title, hint: POLICY_TEXT[pol].text, group: 'Interrupt the follow-ups', glyph: 'stop' as const }))),
  ];
  return (
    <Popover label={`What "${o.label}" does`} wide
      trigger={(p) => <button type="button" className={`ss-dest ${undecided ? 'undecided' : ''} ${it ? 'stop' : ''}`} {...p} data-testid={`ss-fu-${item.node.id}-${option}`}>
        {undecided ? <Glyph name="alert" size={14} /> : <Glyph name={it ? 'stop' : f ? 'right' : 'close'} size={13} />} <span>{text}</span></button>}>
      {(close) => <Picker items={items} placeholder="Choose what this answer does"
        footer={o.interrupt ? undefined : <p className="ss-muted">This answer is not allowed to interrupt the follow-ups. That is set on the answer itself (“Interruption”).</p>}
        onPick={(id) => {
          if (id === 'none') apply(`"${o.label}" has no follow-up`, (w) => setFollowupBehaviour(w, moduleKey, item.node.id, option, { kind: 'NONE' }));
          else if (id.startsWith('esc:')) { onInterrupt(); apply(`"${o.label}" stops and escalates`, (w) => setFollowupBehaviour(w, moduleKey, item.node.id, option, { kind: 'INTERRUPT', interrupt: { policy: 'STOP_ESCALATE', outcome: id.slice(4) as OutcomeCode } })); }
          else if (id.startsWith('int:')) { onInterrupt(); apply(`"${o.label}": ${POLICY_TEXT[id.slice(4) as InterruptPolicy].title.toLowerCase()}`, (w) => setFollowupBehaviour(w, moduleKey, item.node.id, option, { kind: 'INTERRUPT', interrupt: { policy: id.slice(4) as InterruptPolicy } })); }
          else if (id.startsWith('use:')) apply(`"${o.label}" shares a follow-up`, (w) => addFollowupQuestion(w, moduleKey, item.node.id, option, { existing: id.slice(4) }));
          else { const nid = apply(`Added a follow-up for "${o.label}"`, (w) => addFollowupQuestion(w, moduleKey, item.node.id, option, { type: id.slice(4) as AnswerType })); if (nid) requestFocus(`node:${nid}`); }
          close();
        }} />}
    </Popover>
  );
}

/** One interrupting answer: its governing class, the three behaviours (only the permitted ones selectable) and the one detail each needs. */
function InterruptCard({ item, interrupt, issue }: { item: FlowItem; interrupt: Interrupt; issue?: Issue }) {
  const { apply, requestFocus } = useStudio();
  const { moduleKey, editable, label } = useB();
  const o = item.question.options.find((x) => x.code === interrupt.option);
  const allowed = permittedInterrupts(o?.interrupt);
  const name = o?.label ?? interrupt.option;
  const set = (patch: Omit<Interrupt, 'option'>, text: string) => apply(text, (w) => setFollowupBehaviour(w, moduleKey, item.node.id, interrupt.option, { kind: 'INTERRUPT', interrupt: patch }));
  return (
    <div className={`ss-interrupt ${issue ? 'has-issue' : ''}`} data-testid={`ss-interrupt-${item.node.id}-${interrupt.option}`}>
      <div className="ss-interrupt-head">
        <strong>If the customer selects “{name}”</strong>
        {o?.interrupt === 'MANDATORY'
          ? <Tag tone="warn" glyph="lock">Mandatory escalation · set by the question</Tag>
          : <Tag glyph="stop">Optional interruption</Tag>}
      </div>
      <div className="ss-policy" role="radiogroup" aria-label={`What happens when ${name} is selected`}>
        {(Object.keys(POLICY_TEXT) as InterruptPolicy[]).map((pol) => {
          const ok = allowed.includes(pol);
          const on = interrupt.policy === pol;
          return (
            <button key={pol} type="button" role="radio" aria-checked={on} aria-disabled={!ok || !editable} className={`ss-policy-opt ${on ? 'on' : ''} ${ok ? '' : 'blocked'}`}
              data-testid={`ss-policy-${item.node.id}-${interrupt.option}-${pol}`}
              onClick={() => { if (ok && editable && !on) set({ policy: pol }, `"${name}": ${POLICY_TEXT[pol].title.toLowerCase()}`); }}>
              <strong>{POLICY_TEXT[pol].title}</strong>
              <small>{ok ? POLICY_TEXT[pol].text : 'Not available: this answer is a mandatory escalation, and a placement cannot weaken it.'}</small>
            </button>
          );
        })}
      </div>
      {interrupt.policy === 'STOP_ESCALATE' ? (
        <label className="ss-route-line"><span className="ss-route-label">End the module with</span>
          <select className="ss-select" value={interrupt.outcome ?? ''} disabled={!editable} data-testid={`ss-interrupt-outcome-${item.node.id}-${interrupt.option}`}
            onChange={(e) => set({ policy: 'STOP_ESCALATE', outcome: e.target.value as OutcomeCode }, `"${name}" ends the module: ${OUTCOME_LABEL[e.target.value as OutcomeCode]}`)}>
            <option value="" disabled>Choose the outcome…</option>
            {(o?.interrupt === 'MANDATORY' ? ESCALATION_OUTCOMES : OUTCOMES.filter((x) => x !== 'COMPLETED')).map((x) => <option key={x} value={x}>{OUTCOME_LABEL[x]}</option>)}
          </select></label>
      ) : null}
      {interrupt.policy === 'RESUME' ? (
        <div className="ss-route-line">
          <span className="ss-route-label">Ask first</span>
          {(interrupt.nodes ?? []).map((id) => <span key={id} className="ss-dest static"><Glyph name="right" size={13} /> {label({ node: id })}</span>)}
          {editable && !(interrupt.nodes ?? []).length ? (
            <Popover label="Add the question to ask first" wide
              trigger={(p) => <button type="button" className="ss-dest undecided" {...p} data-testid={`ss-interrupt-ask-${item.node.id}-${interrupt.option}`}><Glyph name="alert" size={14} /> <span>Add the question to ask first</span></button>}>
              {(close) => <div className="ss-insert-menu"><h3>Ask this first</h3><TypeButtons types={['YES_NO', 'SINGLE_SELECT', 'FREE_TEXT']} onPick={(spec) => {
                const nid = apply(`Added the question "${name}" asks first`, (w) => addFollowupQuestion(w, moduleKey, item.node.id, interrupt.option, spec, 'INTERRUPT'));
                if (nid) requestFocus(`node:${nid}`);
                close();
              }} /></div>}
            </Popover>
          ) : null}
          <span className="ss-muted">then the remaining follow-ups continue in order.</span>
        </div>
      ) : null}
      {interrupt.policy === 'STOP_REJOIN' ? (
        <div className="ss-route-line"><span className="ss-route-label">Continue at</span>
          <TargetPill item={item} target={interrupt.rejoin ?? null} empty="Choose the destination" testId={`ss-interrupt-rejoin-${item.node.id}-${interrupt.option}`}
            onSet={(tg) => set({ policy: 'STOP_REJOIN', rejoin: tg }, `"${name}" stops the follow-ups and continues elsewhere`)} /></div>
      ) : null}
      {issue ? <p className="ss-issue" role="alert"><Glyph name="alert" size={14} /> {issue.fix}</p> : null}
    </div>
  );
}

function SortableFollowup({ id, index, total, children, onMove }: { id: string; index: number; total: number; children: ReactNode; onMove: (to: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={`ss-queue-item ${isDragging ? 'dragging' : ''}`}>
      <button type="button" className="ss-grip small" {...attributes} {...listeners} aria-label="Drag to change the order"><Glyph name="grip" size={14} /></button>
      <span className="ss-queue-n">{index + 1}</span>
      {children}
      <span className="ss-option-tools show">
        <button type="button" className="ss-icon-btn" disabled={index === 0} aria-label="Ask earlier" onClick={() => onMove(index - 1)} data-testid={`ss-queue-up-${id}`}><Glyph name="up" /></button>
        <button type="button" className="ss-icon-btn" disabled={index === total - 1} aria-label="Ask later" onClick={() => onMove(index + 1)} data-testid={`ss-queue-down-${id}`}><Glyph name="down" /></button>
      </span>
    </li>
  );
}

function FollowupDesigner({ item, issueFor }: { item: FlowItem; issueFor: (on?: string, part?: string) => Issue | undefined }) {
  const { apply } = useStudio();
  const { moduleKey, editable, label } = useB();
  const { node, question: q } = item;
  const r = node.routing;
  const followups = r.followups ?? [];
  const interrupts = r.interrupts ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [trying, setTrying] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const preview = previewQueue(node, q, picked, label);
  const optLabel = (c: string) => q.options.find((o) => o.code === c)?.label ?? c;
  const move = (from: number, to: number) => apply('Changed the follow-up order', (w) => reorderFollowups(w, moduleKey, node.id, from, to));
  const undecided = q.options.filter((o) => !followups.some((f) => f.option === o.code) && !r.noFollowup?.includes(o.code) && !interrupts.some((i) => i.option === o.code));

  return (
    <div className="ss-fu-wrap">
      <div className="ss-followups" data-testid={`ss-followups-${node.id}`}>
        <div className="ss-fu-col">
          <h4>Follow-ups, in the order they are asked</h4>
          {followups.length === 0 && !undecided.length ? <p className="ss-muted">No follow-ups yet. Choose "Ask a follow-up question" on an answer above.</p> : null}
          {followups.length ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter}
              onDragEnd={(e) => { if (e.over && e.active.id !== e.over.id) move(followups.findIndex((f) => f.option === e.active.id), followups.findIndex((f) => f.option === e.over!.id)); }}>
              <SortableContext items={followups.map((f) => f.option)} strategy={verticalListSortingStrategy}>
                <ol className="ss-queue" data-testid={`ss-queue-${node.id}`}>
                  {followups.map((f, i) => (
                    <SortableFollowup key={f.option} id={f.option} index={i} total={followups.length} onMove={(to) => move(i, to)}>
                      <span className="ss-queue-text"><strong>{optLabel(f.option)}</strong><small>asks {label({ node: f.nodes[0]! })}</small></span>
                    </SortableFollowup>
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          ) : null}
          {undecided.length ? (
            <ul className="ss-queue" data-testid={`ss-queue-undecided-${node.id}`}>
              {undecided.map((o) => <li key={o.code} className="ss-queue-item undecided"><Glyph name="alert" size={14} /><span className="ss-queue-text"><strong>{o.label || o.code}</strong><small>not decided yet — choose what it does on its answer row</small></span></li>)}
            </ul>
          ) : null}
          <p className="ss-muted">Asked one at a time, in this order — never in the order the customer happened to choose. A question shared by two answers is asked once.</p>
          <div className="ss-route-line">
            <span className="ss-route-label">After the follow-ups</span>
            {editable
              ? <TargetPill item={item} target={r.rejoin ?? null} empty="Choose where everyone continues" testId={`ss-rejoin-${node.id}`} glyph="merge"
                  onSet={(tg) => apply('Set where follow-ups rejoin', (w) => setRejoin(w, moduleKey, node.id, tg))} />
              : <span className="ss-dest static"><Glyph name="right" size={13} /> {label(r.rejoin)}</span>}
            {issueFor(undefined, 'rejoin') ? <span className="ss-issue-inline" role="alert">Needed</span> : null}
          </div>
        </div>

        <div className="ss-fu-col ss-try" data-testid={`ss-try-${node.id}`}>
          <button type="button" className="ss-disclosure" aria-expanded={trying} onClick={() => setTrying(!trying)} data-testid={`ss-try-toggle-${node.id}`}>
            <Glyph name={trying ? 'down' : 'right'} size={14} /> Try a combination</button>
          {trying ? (<>
          <div className="ss-try-options">
            {q.options.map((o) => (
              <label key={o.code} className={`ss-try-opt ${picked.includes(o.code) ? 'on' : ''}`}>
                <input type="checkbox" checked={picked.includes(o.code)} data-testid={`ss-try-${node.id}-${o.code}`}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, o.code] : picked.filter((c) => c !== o.code))} /> {o.label}
              </label>
            ))}
          </div>
          {picked.length === 0 ? <p className="ss-muted">Tick some answers to see what the customer would be asked next.</p>
            : preview.error ? <p className="ss-issue" role="alert" data-testid={`ss-try-error-${node.id}`}><Glyph name="alert" size={14} /> {preview.error}</p> : (
              <ol className="ss-try-steps" data-testid={`ss-try-steps-${node.id}`}>
                {preview.steps.map((s, i) => (
                  <li key={i} className={s.kind.toLowerCase()}>
                    <span className="ss-try-kind">{s.kind === 'ASK' ? 'Ask' : s.kind === 'STOP' ? 'Stop' : 'Then'}</span>
                    <span><strong>{s.label}</strong>{s.because ? <small>because of “{s.because}”</small> : null}</span>
                  </li>
                ))}
              </ol>
            )}
          {preview.note && !preview.error ? <p className="ss-muted" data-testid={`ss-try-note-${node.id}`}>{preview.note}</p> : null}
          {preview.deduped.length ? <p className="ss-muted">Asked once only: {preview.deduped.join('; ')}.</p> : null}
          {preview.skipped.length ? <p className="ss-muted" data-testid={`ss-try-skipped-${node.id}`}>Not asked because of the stop: {preview.skipped.join('; ')}.</p> : null}
          <p className="ss-muted">Preview from the prototype's demonstration evaluator.</p>
          </>) : <p className="ss-muted">See what a customer would be asked for a set of answers.</p>}
        </div>
      </div>
    </div>
  );
}

/** A destination chooser for a queue: the rejoin, or where a stop-and-go interruption leads. */
function TargetPill({ item, target, onSet, empty, testId, glyph = 'right' }: { item: FlowItem; target: Target | null; onSet: (t: Target) => void; empty: string; testId: string; glyph?: GlyphName }) {
  const { m, label } = useB();
  const items: PickItem[] = [
    ...stepItems(m, item.node.id, label),
    ...OUTCOMES.map((o) => ({ id: `o:${o}`, label: `End module: ${OUTCOME_LABEL[o]}`, group: 'End the module', glyph: (o === 'COMPLETED' ? 'check' : 'stop') as GlyphName })),
  ];
  return (
    <Popover label={empty} wide
      trigger={(p) => <button type="button" className={`ss-dest ${target ? '' : 'undecided'}`} {...p} data-testid={testId}>
        {target ? <Glyph name={glyph} size={14} /> : <Glyph name="alert" size={14} />} <span>{target ? label(target) : empty}</span></button>}>
      {(close) => <Picker items={items} placeholder="Search questions and outcomes" onPick={(id) => { onSet(id.startsWith('n:') ? { node: id.slice(2) } : { outcome: id.slice(2) as OutcomeCode }); close(); }} />}
    </Popover>
  );
}
