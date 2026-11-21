// Survey Studio prototype — Screen B: Survey Lego Composer.
// START → module cards → END. Each card says when it runs, which version it pins and what each outcome leads to.
// Reorder by drag (pointer or keyboard, via dnd-kit) or with the move buttons; every gap has "Add a module here".
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EntryRuleDrawer, entrySentence } from './EntryRuleDrawer';
import { ModuleTile } from './HomePage';
import { JourneyNav } from './JourneyNav';
import { NewModuleForm } from './NewModule';
import { escalationOutcomes, mandatoryOutcomes, validateSurvey, wordingStatus } from './model/flow';
import { activationOf, addInstance, canBeIneligible, findModule, findSurvey, jumpSources, moveInstance, removeInstance, renameSurvey, setIfIneligible, setIfSkippedInSequence, setRoute } from './model/ops';
import { KIND_LABEL, OUTCOMES, OUTCOME_LABEL } from './model/sample';
import { mKey, type Instance, type Issue, type Module, type Survey, type SurveyTarget } from './model/types';
import { StudioBar } from './StudioRoot';
import { useFocusTarget, useStudio } from './store';
import { useFillHeight } from './BuilderPage';
import { Glyph, InlineText, KIND_GLYPH, Picker, Popover, Segmented, Tag, type PickItem } from './ui';

// The graph library is loaded only when the survey graph is opened.
const SurveyGraphView = lazy(() => import('./GraphView').then((x) => ({ default: x.SurveyGraphView })));

export function ComposerPage() {
  const { surveyId = '' } = useParams();
  const { ws, apply, requestFocus } = useStudio();
  const [params, setParams] = useSearchParams();
  // Below 1200 px the library is an overlay opened on demand, so the canvas keeps its width (SS-02A.1).
  const [shelf, setShelf] = useState(() => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 1200px)').matches);
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);
  const panel = useRef<HTMLElement | null>(null);
  const fill = useFillHeight(params.get('view') === 'graph');
  const survey = findSurvey(ws, surveyId);
  const issues = useMemo(() => (survey ? validateSurvey(ws, survey) : []), [ws, survey]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  if (!survey) {
    return (<><StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: 'Survey not found' }]} />
      <div className="ss-empty page"><p><strong>This survey is not in the prototype workspace.</strong> It may have been cleared by a reset.</p>
        <Link className="ss-btn" to="/survey-studio">Back to Survey Studio</Link></div></>);
  }
  const ruleFor = params.get('rule');
  const view: 'blocks' | 'graph' = params.get('view') === 'graph' ? 'graph' : 'blocks';
  const picked = params.get('inst');
  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(window.location.search) /* the address itself: the router's state can lag a quick second change */;
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    setParams(p, { replace: true });
  };
  const pickedIndex = survey.sequence.findIndex((x) => x.id === picked);
  const pickedInst = pickedIndex >= 0 ? survey.sequence[pickedIndex]! : null;
  const library = ws.modules.filter((m) => m.published || !m.derivedFor); // approved versions, plus blank drafts made in this session
  const items: PickItem[] = library.map((m) => ({ id: mKey(m), label: m.name, hint: `${KIND_LABEL[m.kind]} · ${m.nodes.filter((x) => x.type === 'QUESTION').length} questions · ${m.published ? `v${m.revision}` : 'draft'}`, glyph: KIND_GLYPH[m.kind] }));
  const add = (index: number, key: string) => {
    const m = findModule(ws, key)!;
    const id = apply(`Added ${m.name}`, (w) => addInstance(w, survey.id, index, key));
    if (id) requestFocus(`inst:${id}`);
  };
  const onIssue = (i: Issue) => {
    if (i.where.part === 'entry' && i.where.instanceId) go({ rule: i.where.instanceId });
    if (view === 'graph' && i.where.instanceId) { go({ inst: i.where.instanceId }); setTick((t) => t + 1); }
    if (i.where.instanceId) requestFocus(`inst:${i.where.instanceId}`);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = survey.sequence.findIndex((x) => x.id === e.active.id), to = survey.sequence.findIndex((x) => x.id === e.over!.id);
    apply(`Moved ${findModule(ws, mKey(survey.sequence[from]!.module))!.name}`, (w) => moveInstance(w, survey.id, from, to));
  };

  return (
    <>
      <StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: survey.name }]} badge={<Tag tone="draft">Draft v{survey.versionLabel}</Tag>} issues={issues} onIssue={onIssue}
        wording={wordingStatus(ws, survey.sequence.map((x) => findModule(ws, mKey(x.module))).filter((x): x is Module => !!x))} />
      <JourneyNav survey={survey} at="compose" compact />
      <div className={`ss-composer ${shelf && view === 'blocks' ? '' : 'no-shelf'}`}>
        {shelf && view === 'blocks' ? (
          <aside className="ss-shelf" aria-label="Module library">
            <div className="ss-shelf-head">
              <h2>Module library</h2>
              <span className="ss-actions">
                <Popover label="Create a blank module" align="end" wide
                  trigger={(p) => <button type="button" className="ss-btn small" {...p} data-testid="ss-shelf-new-module"><Glyph name="plus" size={14} /> New module</button>}>
                  {(close) => <NewModuleForm place={{ surveyId: survey.id, index: survey.sequence.length }} onDone={close} />}
                </Popover>
                <button type="button" className="ss-icon-btn" onClick={() => setShelf(false)} aria-label="Hide the module library"><Glyph name="close" /></button>
              </span>
            </div>
            <label className="ss-search">
              <Glyph name="search" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search modules" aria-label="Search modules" data-testid="ss-shelf-search" />
            </label>
            <ul className="ss-tiles compact" data-testid="ss-shelf">
              {library.filter((m) => !query.trim() || `${m.name} ${m.intent} ${KIND_LABEL[m.kind]}`.toLowerCase().includes(query.trim().toLowerCase())).map((m) => (
                <ModuleTile key={mKey(m)} m={m} action={
                  <button type="button" className="ss-btn small primary" onClick={() => add(survey.sequence.length, mKey(m))} data-testid={`ss-add-${m.code}`}>
                    <Glyph name="plus" size={14} /> Add
                  </button>} />
              ))}
            </ul>
            <p className="ss-muted ss-shelf-note">Adding a module pins that exact version. It is not copied, and an approved version cannot change under you.</p>
          </aside>
        ) : null}

        <main className="ss-canvas" aria-label="Survey">
          <header className="ss-canvas-head">
            {!shelf && view === 'blocks' ? <button type="button" className="ss-btn small" onClick={() => setShelf(true)}><Glyph name="list" size={14} /> Module library</button> : null}
            <InlineText className="ss-title" value={survey.name} label="Survey name" placeholder="Survey name"
              onCommit={(v) => { if (v.trim()) apply('Renamed the survey', (w) => renameSurvey(w, survey.id, v.trim())); }} />
            {survey.purpose ? <p className="ss-muted">{survey.purpose}</p> : null}
            {survey.sequence.length ? <Link className="ss-btn small" to={`/survey-studio/surveys/${survey.id}/simulate`} data-testid="ss-simulate"><Glyph name="spark" size={14} /> Simulate a journey</Link> : null}
            {survey.sequence.length ? (
              <Segmented<'blocks' | 'graph'> label="View of this survey" value={view} onChange={(v) => { go({ view: v === 'graph' ? 'graph' : null }); setTick((t) => t + 1); }}
                options={[{ value: 'blocks', label: 'Blocks', hint: 'Modules in order' }, { value: 'graph', label: 'Graph', hint: 'The same survey as a map of modules and outcomes' }]} />
            ) : null}
          </header>

          {view === 'graph' && survey.sequence.length ? (
            <div className="ss-graph-page survey" data-testid="ss-survey-graph-page" ref={fill}>
              <Suspense fallback={<p className="ss-muted ss-g-loading">Opening the graph…</p>}>
                <SurveyGraphView survey={survey} issues={issues} selected={picked} focusTick={tick} entryText={(id) => entrySentence(ws, survey, survey.sequence.find((x) => x.id === id)!)}
                  onSelect={(id) => { go({ inst: id }); window.setTimeout(() => { if (panel.current && !panel.current.contains(document.activeElement)) panel.current.focus(); }, 60) /* never steal focus from a control inside the panel */; }} />
              </Suspense>
              {pickedInst ? <InstancePanel innerRef={panel} survey={survey} inst={pickedInst} index={pickedIndex} issues={issues.filter((x) => x.where.instanceId === pickedInst.id)}
                onRule={() => go({ rule: pickedInst.id })} onClose={() => go({ inst: null })} /> : null}
            </div>
          ) : (

          <div className="ss-story" data-testid="ss-story">
            <div className="ss-terminal">Start of call</div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={survey.sequence.map((x) => x.id)} strategy={verticalListSortingStrategy}>
                <AddHere index={0} items={items} onAdd={add} first={survey.sequence.length === 0} surveyId={survey.id} />
                {survey.sequence.map((inst, i) => (
                  <div key={inst.id} className="ss-slot">
                    <ModuleCard survey={survey} inst={inst} index={i} issues={issues.filter((x) => x.where.instanceId === inst.id)} />
                    <AddHere index={i + 1} items={items} onAdd={add} surveyId={survey.id} />
                  </div>
                ))}
              </SortableContext>
            </DndContext>
            <div className="ss-terminal end">End of call · {survey.sequence.length ? 'Completed' : 'nothing to ask yet'}</div>
          </div>
          )}
        </main>

        {ruleFor && survey.sequence.some((x) => x.id === ruleFor) ? (
          <EntryRuleDrawer survey={survey} instanceId={ruleFor} onClose={() => go({ rule: null })} />
        ) : null}
      </div>
    </>
  );
}

/**
 * The graph's side panel for one module instance: when it runs, what each outcome leads to, and its place in the order.
 * Every control calls the Composer's own operations, so the block view shows the same result immediately.
 */
function InstancePanel({ survey, inst, index, issues, onRule, onClose, innerRef }: {
  survey: Survey; inst: Instance; index: number; issues: Issue[]; onRule: () => void; onClose: () => void; innerRef: React.MutableRefObject<HTMLElement | null>;
}) {
  const { ws, apply } = useStudio();
  const m = findModule(ws, mKey(inst.module))!;
  const last = index === survey.sequence.length - 1;
  const entryIssue = issues.some((i) => i.where.part === 'entry');
  return (
    <aside ref={innerRef} className="ss-g-panel" tabIndex={-1} aria-label={`Selected module: ${m.name}`} data-testid="ss-g-panel">
      <div className="ss-g-panel-head">
        <strong>{m.name} · position {index + 1} of {survey.sequence.length}</strong>
        <button type="button" className="ss-icon-btn" aria-label="Close the panel" onClick={onClose} data-testid="ss-g-panel-close"><Glyph name="close" /></button>
      </div>
      <div className={`ss-card kind-${m.kind.toLowerCase()} in-panel`}>
        <div className="ss-card-body">
          <button type="button" className={`ss-rule-chip ${entryIssue ? 'warn' : ''}`} onClick={onRule} data-testid={`ss-g-rule-${inst.id}`}>
            <span className="ss-rule-when">Runs</span><span>{entrySentence(ws, survey, inst)}</span>{entryIssue ? <Glyph name="alert" size={14} /> : <Glyph name="right" size={13} />}
          </button>
          <OutcomeRoutes survey={survey} inst={inst} index={index} />
          <div className="ss-card-foot">
            <span className="ss-card-actions">
              <button type="button" className="ss-btn small" disabled={index === 0} data-testid={`ss-g-up-${inst.id}`} onClick={() => apply(`Moved ${m.name} earlier`, (w) => moveInstance(w, survey.id, index, index - 1))}><Glyph name="up" size={14} /> Earlier</button>
              <button type="button" className="ss-btn small" disabled={last} data-testid={`ss-g-down-${inst.id}`} onClick={() => apply(`Moved ${m.name} later`, (w) => moveInstance(w, survey.id, index, index + 1))}><Glyph name="down" size={14} /> Later</button>
              <Link className="ss-btn small" to={`/survey-studio/surveys/${survey.id}/modules/${inst.id}`}><Glyph name="open" size={14} /> Open module</Link>
            </span>
          </div>
        </div>
      </div>
      <p className="ss-muted">The same controls as the module's block. Removing a module is done in the Blocks view.</p>
    </aside>
  );
}

function AddHere({ index, items, onAdd, first, surveyId }: { index: number; items: PickItem[]; onAdd: (index: number, key: string) => void; first?: boolean; surveyId: string }) {
  const [blank, setBlank] = useState(false);
  return (
    <div className={`ss-gap ${first ? 'first' : ''}`}>
      <Popover label="Add a module here" wide onOpenChange={(o) => { if (!o) setBlank(false); }}
        trigger={(p) => (first
          ? <button type="button" className="ss-btn primary big" {...p} data-testid="ss-add-first"><Glyph name="plus" /> Add your first module</button>
          : <button type="button" className="ss-insert" {...p} aria-label="Add a module here" data-testid={`ss-add-here-${index}`}><Glyph name="plus" size={14} /><span>Add a module here</span></button>)}>
        {(close) => (blank
          ? <NewModuleForm place={{ surveyId, index }} onDone={close} />
          : <Picker items={items} placeholder="Search modules to add" onPick={(id) => { onAdd(index, id); close(); }}
              footer={<button type="button" className="ss-link" onClick={() => setBlank(true)} data-testid="ss-blank-module"><Glyph name="plus" size={14} /> Create a blank module</button>} />)}
      </Popover>
      {first ? <p className="ss-muted">A survey is a sequence of modules. Start with General verification, then add the ones that apply.</p> : null}
    </div>
  );
}

/** What each named outcome of one module instance leads to. The SAME control in the Composer card and the graph panel. */
export function OutcomeRoutes({ survey, inst, index }: { survey: Survey; inst: Instance; index: number }) {
  const { ws, apply } = useStudio();
  const m = findModule(ws, mKey(inst.module))!;
  const last = index === survey.sequence.length - 1;
  const jumps = jumpSources(survey, inst.id);
  const must = mandatoryOutcomes(ws, m);
  const terminal = escalationOutcomes(m); // Escalate ends the call however the module reached it
  return (
    <ul className="ss-outcomes" aria-label={`What happens after ${m.name}`}>
          {m.outcomes.length === 0 ? <li className="ss-muted">No way to finish yet — open the module and add a question.</li> : null}
          {m.outcomes.map((o) => {
            const t = inst.routes[o] ?? null;
            // a mandatory escalation cannot be overridden by survey routing (A-4): only its own governed ending is offered
            const choices: PickItem[] = terminal.includes(o) ? [
              { id: `o:${o}`, label: `End the call: ${OUTCOME_LABEL[o]}`, hint: must.includes(o) ? 'Mandatory escalation — survey routing cannot continue, complete or re-route it' : 'An escalation always ends the call — it cannot be continued or re-routed', group: must.includes(o) ? 'Mandatory escalation' : 'Escalation', glyph: 'stop' },
            ] : [
              { id: '@CONTINUE', label: last ? 'End the call: Completed' : 'Continue to the next module', hint: 'The normal sequence', glyph: 'down' },
              ...survey.sequence.slice(index + 2).map((x) => ({ id: `i:${x.id}`, label: `Jump to ${findModule(ws, mKey(x.module))?.name}`, hint: 'Modules in between are skipped', group: 'Jump ahead', glyph: 'branch' as const })),
              ...OUTCOMES.filter((x) => x !== 'COMPLETED').map((x) => ({ id: `o:${x}`, label: `End the call: ${OUTCOME_LABEL[x]}`, group: 'End the call', glyph: 'stop' as const })),
            ];
            if (o === 'REVIEW_REQUIRED') {
              return (
                <li key={o}>
                  <span className="ss-outcome alt">{OUTCOME_LABEL[o]}</span>
                  <span className="ss-route static" data-testid={`ss-route-${inst.id}-${o}`} title="Governed: this cannot be routed elsewhere."><Glyph name="stop" size={13} /> the call halts · waits for an authorised review · not completed</span>
                </li>
              );
            }
            return (
              <li key={o}>
                <span className={`ss-outcome ${o === 'COMPLETED' ? 'ok' : 'alt'}`} title={must.includes(o) ? 'A mandatory-escalation answer in this module ends it this way. It can only end the call.' : terminal.includes(o) ? 'An escalation always ends the call.' : undefined}>{OUTCOME_LABEL[o]}{terminal.includes(o) ? <Glyph name="lock" size={12} /> : null}</span>
                <Popover label={`What happens on ${OUTCOME_LABEL[o]}`} wide
                  trigger={(p) => <button type="button" className={`ss-route ${t === null ? 'undecided' : ''}`} {...p} data-testid={`ss-route-${inst.id}-${o}`}>
                    {t === null ? <Glyph name="alert" size={14} /> : <Glyph name="right" size={13} />} {routeText(survey, index, t, ws)}</button>}>
                  {(close) => <Picker items={choices} placeholder="Choose what happens" onPick={(id) => {
                    const target: SurveyTarget = id === '@CONTINUE' ? '@CONTINUE' : id.startsWith('i:') ? { instance: id.slice(2) } : { surveyOutcome: id.slice(2) as keyof typeof OUTCOME_LABEL };
                    apply(`Routed "${OUTCOME_LABEL[o]}" of ${m.name}`, (w) => setRoute(w, survey.id, inst.id, o, target));
                    close();
                  }} />}
                </Popover>
              </li>
            );
          })}
          {/* The skip disposition (D-135, A-3). After a JUMP it must be chosen — nothing is invented — so that row shows
              on every jump target that has an eligibility condition. In SEQUENCE the normal default is to consider the next
              module; that row shows only once something else has been configured (it is set in the condition drawer). */}
          {canBeIneligible(inst) ? (['SEQ', 'JUMP'] as const).filter((k) => (k === 'JUMP' ? jumps.length > 0 : inst.ifSkippedInSequence !== undefined)).map((k) => {
            const t = (k === 'JUMP' ? inst.ifIneligible : inst.ifSkippedInSequence) ?? null;
            const from = [...new Set(jumps.map((x) => findModule(ws, mKey(survey.sequence.find((y) => y.id === x.from)!.module))?.name ?? x.from))].join(', ');
            const what = k === 'JUMP' ? 'is jumped to but does not apply' : 'is reached in sequence but does not apply';
            const choices: PickItem[] = [
              { id: '@CONTINUE', label: last ? 'End the call: Completed' : 'Continue to the next module', hint: k === 'JUMP' ? 'As if it had been skipped in sequence' : 'The normal default', glyph: 'down' },
              ...survey.sequence.slice(index + 2).map((x) => ({ id: `i:${x.id}`, label: `Go to ${findModule(ws, mKey(x.module))?.name}`, hint: 'Its own condition is checked in turn', group: 'A later module', glyph: 'branch' as const })),
              ...OUTCOMES.filter((x) => x !== 'COMPLETED').map((x) => ({ id: `o:${x}`, label: `End the call: ${OUTCOME_LABEL[x]}`, group: 'End the call', glyph: 'stop' as const })),
              ...(t && k === 'JUMP' ? [{ id: 'clear', label: 'Leave undecided for now', group: 'Other', glyph: 'close' as const }] : []),
            ];
            return (
              <li key={k} className="ss-skip-row" data-testid={k === 'JUMP' ? `ss-skip-row-${inst.id}` : `ss-skipseq-row-${inst.id}`}>
                <span className="ss-outcome skip" title={k === 'JUMP' ? `${from} can jump here. A jump does not bypass this module's condition.` : 'What happens when this module is reached in order and its condition is not met.'}>{k === 'JUMP' ? 'Jumped to, but does not apply' : 'In sequence, but does not apply'}</span>
                <Popover label={`What happens when ${m.name} ${what}`} wide
                  trigger={(p) => <button type="button" className={`ss-route ${t === null ? 'undecided' : ''}`} {...p} data-testid={k === 'JUMP' ? `ss-skip-${inst.id}` : `ss-skipseq-${inst.id}`}>
                    {t === null ? <Glyph name="alert" size={14} /> : <Glyph name="right" size={13} />} {routeText(survey, index, t, ws)}</button>}>
                  {(close) => <Picker items={choices} placeholder="Choose what happens"
                    footer={<p className="ss-muted">{k === 'JUMP' ? `${from} can jump to this module. The jump only selects it: its condition is still checked. This is what happens when the condition is not met.` : 'Reached in order, the call normally continues with the next module. This replaces that default.'}</p>}
                    onPick={(id) => {
                      const target: SurveyTarget | null = id === 'clear' ? null : id === '@CONTINUE' ? '@CONTINUE' : id.startsWith('i:') ? { instance: id.slice(2) } : { surveyOutcome: id.slice(2) as keyof typeof OUTCOME_LABEL };
                      apply(`Set what happens when ${m.name} ${what}`, (w) => (k === 'JUMP' ? setIfIneligible(w, survey.id, inst.id, target) : setIfSkippedInSequence(w, survey.id, inst.id, target)));
                      close();
                    }} />}
                </Popover>
              </li>
            );
          }) : null}
        </ul>
  );
}

function routeText(survey: Survey, index: number, t: SurveyTarget | null, ws: ReturnType<typeof useStudio>['ws']): string {
  if (t === null) return 'Choose what happens';
  if (t === '@CONTINUE') {
    const next = survey.sequence[index + 1];
    return next ? `continues to ${findModule(ws, mKey(next.module))?.name ?? 'the next module'}` : 'ends the call: Completed';
  }
  if ('surveyOutcome' in t) return `ends the call: ${OUTCOME_LABEL[t.surveyOutcome]}`;
  const target = survey.sequence.find((x) => x.id === t.instance);
  return target ? `jumps to ${findModule(ws, mKey(target.module))?.name}` : 'leads to a removed module';
}

function ModuleCard({ survey, inst, index, issues }: { survey: Survey; inst: Instance; index: number; issues: Issue[] }) {
  const { ws, apply } = useStudio();
  const [, setParams] = useSearchParams();
  const m = findModule(ws, mKey(inst.module)) as Module;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: inst.id });
  const { ref, flash } = useFocusTarget(`inst:${inst.id}`);
  const last = index === survey.sequence.length - 1;
  const entryIssue = issues.some((x) => x.where.part === 'entry');
  const inside = issues.filter((x) => x.where.moduleKey).length; // problems inside the module's own questions and routes
  const usedBy = survey.sequence.flatMap((other) => Object.entries(other.routes).filter(([, t]) => t && typeof t === 'object' && 'instance' in t && t.instance === inst.id)
    .map(([o]) => `${findModule(ws, mKey(other.module))?.name}: ${OUTCOME_LABEL[o as keyof typeof OUTCOME_LABEL]}`));
  const waiting = survey.sequence.filter((o) => activationOf(o)?.of === inst.id).map((o) => findModule(ws, mKey(o.module))?.name ?? '');

  return (
    <article ref={(el) => { setNodeRef(el); ref.current = el as HTMLDivElement | null; }} style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`ss-card kind-${m.kind.toLowerCase()} ${isDragging ? 'dragging' : ''} ${flash ? 'flash' : ''} ${issues.length ? 'has-issue' : ''}`} data-testid={`ss-card-${inst.id}`} aria-label={`${m.name}, position ${index + 1} of ${survey.sequence.length}`}>
      <button type="button" className="ss-grip" {...attributes} {...listeners} aria-label={`Drag to reorder ${m.name}`}><Glyph name="grip" /></button>
      <div className="ss-card-body">
        <div className="ss-card-top">
          <span className="ss-kind"><Glyph name={KIND_GLYPH[m.kind]} /> {KIND_LABEL[m.kind]}</span>
          {m.published ? <Tag tone="shared" glyph="lock">Shared · v{m.revision}</Tag> : <Tag tone="draft">{m.derivedFor ? `Draft v${m.revision} · this survey only` : 'Draft · not in the shared library'}</Tag>}
          {inside ? <Tag tone="warn" glyph="alert">{inside} to fix inside</Tag> : null}
        </div>
        <h3>{m.name}</h3>
        <button type="button" className={`ss-rule-chip ${entryIssue ? 'warn' : ''}`} onClick={() => setParams({ rule: inst.id })} data-testid={`ss-rule-${inst.id}`}>
          <span className="ss-rule-when">Runs</span>
          <span>{entrySentence(ws, survey, inst)}</span>
          {entryIssue ? <Glyph name="alert" size={14} /> : <Glyph name="right" size={13} />}
        </button>
        <OutcomeRoutes survey={survey} inst={inst} index={index} />
        <div className="ss-card-foot">
          <span className="ss-muted">{m.nodes.filter((x) => x.type === 'QUESTION').length} question{m.nodes.filter((x) => x.type === 'QUESTION').length === 1 ? '' : 's'}</span>
          <span className="ss-card-actions">
            <button type="button" className="ss-icon-btn" disabled={index === 0} aria-label={`Move ${m.name} up`} data-testid={`ss-up-${inst.id}`}
              onClick={() => apply(`Moved ${m.name} up`, (w) => moveInstance(w, survey.id, index, index - 1))}><Glyph name="up" /></button>
            <button type="button" className="ss-icon-btn" disabled={last} aria-label={`Move ${m.name} down`} data-testid={`ss-down-${inst.id}`}
              onClick={() => apply(`Moved ${m.name} down`, (w) => moveInstance(w, survey.id, index, index + 1))}><Glyph name="down" /></button>
            <Popover label={`Remove ${m.name}`} align="end" wide
              trigger={(p) => <button type="button" className="ss-icon-btn" {...p} aria-label={`Remove ${m.name}`} data-testid={`ss-remove-${inst.id}`}><Glyph name="trash" /></button>}>
              {(close) => (
                <div className="ss-confirm">
                  <h3>Remove {m.name} from this survey?</h3>
                  {usedBy.length || waiting.length ? (
                    <><p>This affects:</p><ul>
                      {usedBy.map((u) => <li key={u}>{u} routes here — it will need a new destination.</li>)}
                      {waiting.map((u) => <li key={u}>{u} waits for this module's outcome — it will need a new rule.</li>)}
                    </ul></>
                  ) : <p>No other module routes here or waits for it. The library module itself is not changed.</p>}
                  <div className="ss-actions">
                    <button type="button" className="ss-btn danger" data-testid="ss-remove-confirm" onClick={() => { apply(`Removed ${m.name}`, (w) => removeInstance(w, survey.id, inst.id)); close(); }}>Remove</button>
                    <button type="button" className="ss-btn" onClick={close}>Keep it</button>
                  </div>
                </div>
              )}
            </Popover>
            <Link className="ss-btn small" to={`/survey-studio/surveys/${survey.id}/modules/${inst.id}`} data-testid={`ss-open-${inst.id}`}><Glyph name="open" size={14} /> Open module</Link>
          </span>
        </div>
      </div>
    </article>
  );
}
