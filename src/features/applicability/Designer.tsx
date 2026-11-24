// Survey Applicability (APPL-X1) — the Applicability Designer: one policy document, three views of it (cards, canvas,
// matrix), a palette on the left and an inspector on the right. Nothing here knows about assignment rules, survey
// bindings or requirement groups: a requirement names its surveys directly.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAnalysis, useEvaluation, type EvaluateResult } from './api';
import { Dependencies, PolicyBar, RequirementDeps, usePolicies } from './policyService';
import { savedPolicy } from './policyStore';
import { ConditionBuilder } from './editors';
import { FactsEditor } from './facts';
import { DeliveryOrder, DesignerCards, dragData } from './DesignerCards';
import { DesignerCanvas, type CanvasSelection } from './DesignerCanvas';
import { DesignerMatrix } from './DesignerMatrix';
import { RequirementEditor } from './RequirementEditor';
import { sentence } from './model/describe';
import type { Diagnostic, EvalRow, Expr, Plan, Policy, Requirement, SurveyRef } from './model/types';
import { OutcomeMark, PlanView } from './plan';
import { editPolicy, newId, useAppl } from './store';
import { Empty, Icon, Picker, Segmented, Tag, short, type IconName } from './ui';
import { BASE, composed, conditionUses, surveyUses, surveysOf, variableUses, shortName } from './usage';

type View = 'cards' | 'canvas' | 'matrix';
const ref = (code: string, version: number): Expr => ({ op: 'ref', condition: code, version });

export function DesignerPage() {
  const { data, update, look, openDrawer, say, persona } = useAppl();
  const { code } = useParams();
  const [params, setParams] = useSearchParams();
  const { current, setCurrent } = useAppl();
  const rec = data.policies.find((p) => p.code === code) ?? current;
  useEffect(() => { if (rec) setCurrent(rec.code); }, [rec, setCurrent]);
  const [showing, setShowing] = useState<'draft' | 'published'>('draft');
  const doc: Policy | null = rec ? (showing === 'published' && rec.published ? rec.published : rec.draft ?? rec.published) : null;
  const readOnly = !rec?.draft || doc !== rec.draft ? !!rec?.published && doc === rec.published && !!rec.draft : false;
  const locked = !!rec?.candidate;
  const pol = usePolicies();
  // APPL-X3: a policy that is saved in Call360. Its state, its save and its evaluation are the server's.
  const persisted = pol.on && !!rec && !!savedPolicy(rec.code);
  const view = (params.get('view') as View) || 'cards';
  const [scenarioId, setScenarioId] = useState<string>(() => params.get('s') ?? data.scenarios.find((s) => s.id === 'sc-both')?.id ?? data.scenarios[0]?.id ?? '');
  const [sel, setSel] = useState<CanvasSelection | null>(() => (params.get('r') ? { kind: 'requirement', id: params.get('r')! } : params.get('focus') ? { kind: 'survey', id: params.get('focus')! } : null));
  // the palette starts open only where there is room for three panes
  const [left, setLeft] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1600);
  const [editing, setEditing] = useState<string | null>(null);
  const [right, setRight] = useState(true);
  const [adding, setAdding] = useState(params.get('add') === '1');
  const scenario = data.scenarios.find((s) => s.id === scenarioId) ?? data.scenarios[0];
  const analysis = useAnalysis(data, doc);
  const live = useEvaluation(data, doc, scenario ? [scenario] : []);
  const all = useEvaluation(data, doc, data.scenarios);
  const plan = live.data?.results[0]?.plan;
  const diagnostics = analysis.data?.diagnostics ?? [];
  const blockers = diagnostics.filter((d) => d.severity === 'BLOCKER').length;
  const warnings = diagnostics.filter((d) => d.severity === 'WARNING').length;
  const policyVars = analysis.data?.policy_variables ?? [];
  const setView = (v: View) => { const p = new URLSearchParams(params); p.set('view', v); p.delete('add'); setParams(p, { replace: true }); };
  useEffect(() => { const r = params.get('r'); if (r) setSel({ kind: 'requirement', id: r }); const f = params.get('focus'); if (f) setSel({ kind: 'survey', id: f }); }, [params]);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (sel?.kind === 'requirement' && view === 'cards') cardRef.current?.querySelector(`[data-testid="ap-card-${sel.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [sel, view]);
  if (!rec || !doc) return <div className="ap-page"><Empty icon="policy" title="No policy yet">Create a policy to start connecting conditions to surveys.</Empty></div>;
  const editable = !readOnly && !locked && (!persisted || pol.canEdit);
  const change = (label: string, f: (p: Policy) => void) => update(label, (d) => editPolicy(d, rec.code, f));
  const addReq = (label: string, make: (p: Policy, id: string) => Requirement | Requirement[]) => {
    let first = '';
    change(label, (p) => { const ids = p.requirements.map((x) => x.id); const id = newId('r', ids); const made = make(p, id); const list = Array.isArray(made) ? made : [made]; first = list[0]!.id; p.requirements.push(...list); list.forEach((r) => surveysOf(r).forEach((s) => { if (!p.order.includes(s.code)) p.order.push(s.code); })); });
    setSel({ kind: 'requirement', id: first }); setEditing(first); setAdding(false); if (view !== 'cards') setView('cards');
  };
  const blank = (id: string, name: string, when: Expr | null, surveys: SurveyRef[] = []): Requirement => ({ id, name, when, action: { kind: 'INCLUDE', surveys }, replaces: [] });
  const save = () => { update('Save the draft', (d) => { const r = d.policies.find((x) => x.code === rec.code); if (r) { r.unsaved = false; r.events.push({ at: new Date().toISOString().slice(0, 16).replace('T', ' '), who: 'You', persona, what: `Kept draft version ${r.draft?.version} in this tab`, detail: 'Prototype: kept in this tab' }); } }); say('Draft kept in this tab. It is not saved to Call360 and is lost on reload.', 'info'); };
  const activeSurvey = sel?.kind === 'survey' ? sel.id : null;
  const resolve = editable ? (survey: string, requirements: string[]) => { change('State that one delivery satisfies several requirements', (p) => { p.shared_deliveries = [...p.shared_deliveries.filter((d) => d.survey !== survey || !d.requirements.every((r) => requirements.includes(r))), { survey, requirements }]; }); say('Stated: one delivery satisfies these requirements. It is listed under “Applies to”.'); } : undefined;
  // the canvas takes the whole width until something on it is selected
  const showRight = right && (view !== 'canvas' || !!sel);
  const profileVars = composed(data, doc.profiles);

  const smart: { id: string; icon: IconName; title: string; hint: string; run: () => void }[] = [
    { id: 'always', icon: 'survey', title: 'Include a survey always', hint: 'Every application gets it.', run: () => addReq('Add a requirement: always include', (_, id) => blank(id, 'Always include a survey', null)) },
    { id: 'when', icon: 'condition', title: 'Include a survey when a condition matches', hint: 'One condition, one survey.', run: () => addReq('Add a requirement', (_, id) => blank(id, 'New requirement', data.conditions[0] ? ref(data.conditions[0].code, data.conditions[0].version) : null)) },
    { id: 'several', icon: 'cards', title: 'Include several surveys together', hint: 'One condition requires more than one survey.', run: () => addReq('Add a requirement with several surveys', (_, id) => blank(id, 'Several surveys together', data.conditions[0] ? ref(data.conditions[0].code, data.conditions[0].version) : null, data.surveys.slice(0, 2))) },
    { id: 'joined', icon: 'canvas', title: 'Create a joined condition', hint: 'This AND that, with its own survey.', run: () => addReq('Add a joined requirement', (_, id) => blank(id, 'When both apply', { op: 'all', args: data.conditions.slice(0, 2).map((c) => ref(c.code, c.version)) })) },
    { id: 'choose', icon: 'order', title: 'Create an alternative group', hint: 'Exactly one survey from a set, by stated criteria.', run: () => addReq('Add a choose-one requirement', (_, id) => ({ id, name: 'Choose one survey', when: null, action: { kind: 'CHOOSE_ONE', alternatives: data.surveys.slice(0, 2).map((s, i) => ({ survey: s, when: i === 0 && data.conditions[0] ? ref(data.conditions[0].code, data.conditions[0].version) : null })) }, replaces: [] })) },
    { id: 'replace', icon: 'replace', title: 'Replace an existing requirement', hint: 'When this applies, a named requirement does not.', run: () => addReq('Add a replacing requirement', (p, id) => ({ ...blank(id, 'Replaces another requirement', { op: 'all', args: p.requirements.slice(0, 2).flatMap((r) => (r.when ? [r.when] : [])) }), replaces: p.requirements.slice(0, 2).map((r) => r.id) })) },
    { id: 'pattern', icon: 'sparkle', title: 'Start from a pattern: two alone, one combined', hint: 'A → one survey, B → another, A and B → a third that replaces both.', run: () => addReq('Add the “two alone, one combined” pattern', (p, id) => { const ids = [...p.requirements.map((x) => x.id), id]; const b = newId('r', ids); const c = newId('r', [...ids, b]); const [x, y] = data.conditions; const [s1, s2, s3] = data.surveys; return [blank(id, `${x?.name ?? 'First'} alone`, x ? ref(x.code, x.version) : null, s1 ? [s1] : []), blank(b, `${y?.name ?? 'Second'} alone`, y ? ref(y.code, y.version) : null, s2 ? [s2] : []), { ...blank(c, 'Both together', { op: 'all', args: [x, y].flatMap((k) => (k ? [ref(k.code, k.version)] : [])) }, s3 ? [s3] : []), replaces: [id, b] }]; }) },
  ];

  return (
    <div className="ap-designer" data-testid="ap-designer" data-view={view}>
      <header className="ap-designer-head">
        <div className="ap-editable">
          <textarea className="ap-title-input ap-title-area" rows={1} aria-label="Policy name" title={doc.name} value={doc.name} readOnly={!editable} onChange={(e) => change('Rename the policy', (p) => { p.name = e.target.value.replace(/\n/g, ' '); })} data-testid="ap-policy-name" />
          <span className="ap-designer-meta">{doc.code} · {doc.market} · {doc.requirements.length} requirement{doc.requirements.length === 1 ? '' : 's'}</span>
        </div>
        <div className="ap-designer-state" data-testid="ap-policy-state" data-state={locked ? 'in-review' : readOnly || !rec.draft ? 'published' : rec.unsaved ? 'unsaved' : 'saved'} data-persisted={persisted}>
          {persisted ? <PolicyBar rec={rec} /> : <>
          {rec.published && rec.draft ? <Segmented label="Which version to show" value={readOnly ? 'published' : 'draft'} onChange={(v) => setShowing(v as 'draft' | 'published')} options={[{ value: 'draft', label: `Draft v${rec.draft.version}`, testid: 'ap-show-draft' }, { value: 'published', label: `Published example v${rec.published.version}`, icon: 'lock', testid: 'ap-show-published' }]} /> : null}
          {readOnly ? <Tag tone="published" title="A simulated example state in this prototype"><Icon name="lock" size={11} /> Published example (simulated) — read only</Tag> : locked ? <Tag tone="info"><Icon name="lock" size={11} /> In review — locked</Tag> : !rec.draft ? <Tag tone="published" testid="ap-published-editable"><Icon name="lock" size={11} /> Version {rec.published?.version} published (simulated) · a change starts version {(rec.published?.version ?? 0) + 1}</Tag> : rec.unsaved ? <Tag tone="warn" testid="ap-unsaved" title="Applicability policies are not saved in Call360 yet">Changes not kept yet</Tag> : <Tag tone="draft" testid="ap-saved" title="Applicability policies are not saved in Call360 yet: reloading the page loses this draft">Draft kept in this tab only</Tag>}
          {editable ? <button type="button" className="ap-btn" onClick={save} disabled={!rec.unsaved} data-testid="ap-save-draft" title="Keeps this draft as a checkpoint in this browser tab. It is NOT saved to Call360 and is lost when the page is reloaded."><Icon name="check" size={13} /> Keep draft in this tab</button> : null}
          </>}
          <Link className={`ap-validation${blockers ? ' bad' : warnings ? ' warn' : ' ok'}`} to={`${BASE}/governance/${rec.code}?tab=validation`} data-testid="ap-validation-chip" data-blockers={blockers}><Icon name={blockers ? 'warn' : 'check'} size={13} /> {blockers ? `${blockers} to fix` : warnings ? `${warnings} to check` : 'No problems'}</Link>
          <Link className="ap-btn primary" to={`${BASE}/governance/${rec.code}`} data-testid="ap-to-governance">{persisted ? 'Review readiness' : 'Review and publish'} <Icon name="right" size={13} /></Link>
        </div>
      </header>

      <div className="ap-designer-bar">
        <button type="button" className={`ap-iconbtn labelled${left ? ' on' : ''}`} aria-pressed={left} onClick={() => setLeft(!left)} data-testid="ap-toggle-palette"><Icon name="panel" /> Palette</button>
        <Segmented label="View" value={view} onChange={setView} testid="ap-view" options={[{ value: 'cards', label: 'Cards', icon: 'cards', testid: 'ap-view-cards' }, { value: 'canvas', label: 'Canvas', icon: 'canvas', testid: 'ap-view-canvas' }, { value: 'matrix', label: 'Matrix', icon: 'table', testid: 'ap-view-matrix' }]} />
        <span className="ap-preview-with"><Icon name="play" size={13} /> Previewing
          <Picker label="Preview with a scenario" testid="ap-preview-scenario" items={data.scenarios.map((s) => ({ id: s.id, label: s.name, hint: s.description, group: s.suite ?? 'Scenarios', icon: 'scenario' }))} onPick={setScenarioId} placeholder="Search scenarios…" button={<span className="ap-chip scenario"><Icon name="scenario" size={13} /> {scenario?.name ?? 'Choose a scenario'} <Icon name="down" size={11} /></span>} />
        </span>
        <span className="ap-spacer" />
        {editable ? <button type="button" className="ap-btn primary" onClick={() => setAdding(!adding)} aria-expanded={adding} data-testid="ap-add-requirement"><Icon name="plus" size={14} /> Add requirement</button> : null}
        <button type="button" className={`ap-iconbtn labelled${right ? ' on' : ''}`} aria-pressed={right} onClick={() => setRight(!right)} data-testid="ap-toggle-inspector">Inspector <Icon name="panel" /></button>
      </div>

      {adding ? (
        <section className="ap-smart" data-testid="ap-smart-add" aria-label="What kind of requirement?">
          <header><h2>What do you want to say?</h2><button type="button" className="ap-iconbtn" aria-label="Close" onClick={() => setAdding(false)}><Icon name="x" /></button></header>
          <div className="ap-smart-grid">{smart.map((o) => <button key={o.id} type="button" onClick={o.run} data-testid={`ap-smart-${o.id}`}><span className="ap-smart-icon"><Icon name={o.icon} size={18} /></span><strong>{o.title}</strong><small>{o.hint}</small></button>)}</div>
        </section>
      ) : null}

      {editing && editable && doc.requirements.some((r) => r.id === editing) ? <RequirementEditor policy={doc} id={editing} plan={plan} diagnostics={diagnostics} onClose={() => setEditing(null)} /> : null}
      <div className={`ap-panes${left ? '' : ' no-left'}${showRight ? '' : ' no-right'}`}>
        {left ? <Palette policy={doc} editable={editable} sel={sel} onNew={(when, surveys, name) => addReq('Add a requirement from the palette', (_, id) => blank(id, name, when, surveys))} onToggleProfile={(c) => change('Change the profiles a policy uses', (p) => { p.profiles = p.profiles.includes(c) ? p.profiles.filter((x) => x !== c) : [...p.profiles, c]; })} profileVars={profileVars.rows.map((r) => r.variable)} /> : null}

        <div className="ap-center" ref={cardRef}>
          {persisted ? <Dependencies rec={rec} inspection={analysis.data?.inspection} editable={editable} /> : null}
          {view === 'cards' ? (
            <>
              <PolicySettings policy={doc} editable={editable} change={change} />
              {doc.requirements.length ? <DesignerCards policy={doc} plan={plan} diagnostics={diagnostics} deps={(id) => <RequirementDeps id={id} inspection={analysis.data?.inspection} />} selected={sel?.kind === 'requirement' ? sel.id : null} onSelect={(id) => setSel(id ? { kind: 'requirement', id } : null)} onSurvey={(c) => setSel({ kind: 'survey', id: c })} readOnly={!editable} activeSurvey={activeSurvey} onEdit={setEditing} />
                : <Empty icon="policy" title="This policy selects nothing yet" action={editable ? <button type="button" className="ap-btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add the first requirement</button> : undefined}>A requirement says: when these conditions apply, then these surveys are required.</Empty>}
              {editable && doc.requirements.length ? <button type="button" className="ap-add-card" onClick={() => setAdding(true)} data-testid="ap-add-requirement-bottom"><Icon name="plus" size={15} /> Add requirement</button> : null}
              {doc.requirements.length ? <DeliveryOrder policy={doc} readOnly={!editable} plan={plan} /> : null}
            </>
          ) : view === 'canvas' ? <DesignerCanvas policy={doc} plan={plan} selection={sel} onSelect={setSel} />
            : <DesignerMatrix policy={doc} scenarios={data.scenarios} rows={all.data?.results} source={<PreviewSource result={all.data} />} deps={(id) => <RequirementDeps id={id} inspection={analysis.data?.inspection} />} variables={policyVars} fingerprint={analysis.data?.policy_fingerprint} activeScenario={scenario?.id} onScenario={setScenarioId} onOpen={(id) => { setSel({ kind: 'requirement', id }); setView('cards'); }} />}
        </div>

        {showRight ? (
          <aside className="ap-inspector" aria-label="Inspector" data-testid="ap-inspector" data-kind={sel?.kind ?? 'policy'}>
            {sel?.kind === 'requirement' && doc.requirements.some((r) => r.id === sel.id) ? <RequirementInspector policy={doc} id={sel.id} plan={plan} all={all.data?.results} onScenario={setScenarioId} onClose={() => setSel(null)} diagnostics={diagnostics.filter((d) => d.at?.kind === 'requirement' && d.at?.id === sel.id)} editable={editable} change={change} />
              : sel?.kind === 'survey' ? <SurveyInspector policy={doc} code={sel.id} all={all.data?.results} onRequirement={(id) => { setSel({ kind: 'requirement', id }); if (view === 'matrix') setView('cards'); }} onScenario={setScenarioId} onClose={() => setSel(null)} />
                : sel?.kind === 'condition' ? <LibraryInspector kind="condition" code={sel.id} onClose={() => setSel(null)} />
                  : sel?.kind === 'variable' ? <LibraryInspector kind="variable" code={sel.id} onClose={() => setSel(null)} />
                    : (
                      <>
                        <header><div><span className="ap-side-kind"><Icon name="play" size={13} /> Live preview</span><h2>{scenario?.name ?? 'No scenario'}</h2></div></header>
                        <PreviewSource result={live.data} />
                        <p className="ap-side-says">What this policy selects for the example application. Change a fact and it is worked out again by Call360’s evaluator.</p>
                        {scenario ? <FactsEditor codes={policyVars.filter((c) => !look.variable(c)?.derived)} facts={scenario.facts} states={plan?.facts} highlight={plan?.needs.map((n) => n.variable)} compact testid="ap-preview-facts" onChange={(f) => update(`Change a fact of “${scenario.name}”`, (d) => { const s = d.scenarios.find((x) => x.id === scenario.id); if (s) s.facts = f; })} /> : null}
                        <PlanView plan={plan} compact onSurvey={(c) => setSel({ kind: 'survey', id: c })} onRequirement={(id) => setSel({ kind: 'requirement', id })} onResolve={resolve} testid="ap-preview-plan" />
                        <Link className="ap-btn quiet" to={`${BASE}/scenarios?s=${scenario?.id ?? ''}`}><Icon name="scenario" size={13} /> Open in the scenario lab</Link>
                        <button type="button" className="ap-linkbtn" onClick={() => openDrawer({ kind: 'variable' })}>Missing a fact? Create a variable</button>
                      </>
                    )}
            {sel ? (
              <section className="ap-inspector-live" data-testid="ap-inspector-live">
                <h3><Icon name="play" size={14} /> Live preview · {scenario?.name}</h3>
                <PreviewSource result={live.data} />
                <PlanView plan={plan} compact onSurvey={(c) => setSel({ kind: 'survey', id: c })} onRequirement={(id) => setSel({ kind: 'requirement', id })} onResolve={resolve} testid="ap-preview-plan" />
                <button type="button" className="ap-linkbtn" onClick={() => setSel(null)} data-testid="ap-inspector-to-preview">Change the example application’s facts</button>
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** Whose result this is: the SAVED revision evaluated by the server, or an unsaved edit previewed as a what-if. */
export function PreviewSource({ result }: { result?: EvaluateResult }) {
  if (!result?.source) return null;
  const stale = result.run_status && result.run_status !== 'OK';
  return (
    <p className={`ap-source-chip is-${stale ? 'stale' : result.source.toLowerCase()}`} data-testid="ap-preview-source" data-source={result.source} data-status={result.run_status} data-fingerprint={result.policy_fingerprint ?? ''}>
      <Icon name={stale ? 'warn' : result.source === 'SAVED' ? 'check' : 'info'} size={12} />
      {stale ? ` Not evaluated: ${result.reason ?? 'a dependency changed'}`
        : result.source === 'SAVED' ? ` Saved revision ${result.revision} · evaluated by Call360 from exactly what it pins`
          : ` Unsaved preview — a what-if on your edits, not the saved revision ${result.revision}`}
    </p>
  );
}

function PolicySettings({ policy, editable, change }: { policy: Policy; editable: boolean; change: (label: string, f: (p: Policy) => void) => void }) {
  const { data, look } = useAppl();
  const [open, setOpen] = useState(false);
  const name = (id: string) => policy.requirements.find((r) => r.id === id)?.name ?? id;
  const survey = (code: string) => policy.requirements.flatMap(surveysOf).find((x) => x.code === code)?.name ?? code;
  return (
    <section className="ap-settings" data-testid="ap-policy-settings">
      <button type="button" className="ap-settings-head" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="ap-policy-settings-toggle">
        <Icon name={open ? 'down' : 'right'} size={14} /><strong>Applies to</strong>
        <span>{policy.market} · {policy.scope ? `only when ${sentence(policy.scope, look)}` : 'every application'}</span>
        <span className="ap-settings-same" data-testid="ap-shared-summary">{policy.profiles.length ? `Facts from ${policy.profiles.map((c) => data.profiles.find((p) => p.code === c)?.name ?? c).join(' + ')}` : 'Any facts'}{policy.shared_deliveries.length ? ` · ${policy.shared_deliveries.length} shared deliver${policy.shared_deliveries.length === 1 ? 'y' : 'ies'}` : ''}</span>
      </button>
      {open ? (
        <div className="ap-settings-body">
          <div><h4>Which applications this policy covers</h4><p className="ap-quiet">The only thing that decides whether this policy applies. Profiles describe an application’s facts; they never decide this. Leave empty to cover every application.</p>
            {editable ? <ConditionBuilder expr={policy.scope} onChange={(e) => change('Change which applications a policy covers', (p) => { p.scope = e; })} allowAlways testid="ap-scope-builder" emptyHint="No limit: every application." /> : <p>{policy.scope ? sentence(policy.scope, look) : 'Every application.'}</p>}</div>
          <div data-testid="ap-shared-deliveries"><h4>One delivery for several requirements</h4><p className="ap-quiet">When two requirements ask for the same survey, nothing is merged unless it is stated here, for those requirements only.</p>
            {policy.shared_deliveries.length ? <ul className="ap-shared">{policy.shared_deliveries.map((d, i) => <li key={i} data-testid={`ap-shared-${d.survey}`}><Icon name="link" size={14} /><span><strong>{survey(d.survey)}</strong><small>one delivery satisfies {d.requirements.map(name).join(' and ')}</small></span>{editable ? <button type="button" className="ap-iconbtn" aria-label="Remove this statement" onClick={() => change('Remove a shared delivery', (p) => { p.shared_deliveries.splice(i, 1); })}><Icon name="x" size={13} /></button> : null}</li>)}</ul> : <p className="ap-quiet">None stated. A collision shows up in the live result with a way to resolve it.</p>}</div>
        </div>
      ) : null}
    </section>
  );
}

function Palette({ policy, editable, sel, onNew, onToggleProfile, profileVars }: { policy: Policy; editable: boolean; sel: CanvasSelection | null; onNew: (when: Expr | null, surveys: SurveyRef[], name: string) => void; onToggleProfile: (code: string) => void; profileVars: string[] }) {
  const { data, look, openDrawer, update } = useAppl();
  const [tab, setTab] = useState<'surveys' | 'conditions' | 'variables' | 'profiles'>('surveys');
  const [q, setQ] = useState('');
  const k = q.trim().toLowerCase();
  const hit = (...t: (string | undefined)[]) => !k || t.join(' ').toLowerCase().includes(k);
  const target = sel?.kind === 'requirement' ? policy.requirements.find((r) => r.id === sel.id) : undefined;
  const used = new Set(policy.requirements.flatMap((r) => surveysOf(r).map((s) => s.code)));
  const recent = useMemo(() => { const s = new Set<string>(); policy.requirements.forEach((r) => { const walk = (e: Expr | null) => { if (!e) return; if (e.op === 'ref') s.add(e.condition); else if (e.op === 'not') walk(e.arg); else if (e.op === 'all' || e.op === 'any') e.args.forEach(walk); }; walk(r.when); }); return s; }, [policy]);
  const toSel = (f: (r: Requirement, p: Policy) => void, label: string) => update(label, (d) => editPolicy(d, policy.code, (p) => { const r = p.requirements.find((x) => x.id === target?.id); if (r) f(r, p); }));
  return (
    <aside className="ap-palette" aria-label="Palette" data-testid="ap-palette-pane">
      <div className="ap-palette-tabs" role="tablist" aria-label="What to add">
        {([['surveys', 'survey', 'Surveys'], ['conditions', 'condition', 'Conditions'], ['variables', 'variable', 'Facts'], ['profiles', 'profile', 'Profiles']] as const).map(([id, icon, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={`ap-palette-${id}`}><Icon name={icon} size={14} />{label}</button>)}
      </div>
      <label className="ap-searchbox"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tab}`} aria-label={`Search ${tab}`} data-testid="ap-palette-search" /></label>
      <p className="ap-palette-hint">{!editable ? 'This version is read only.' : target ? <>Adds to <strong>{target.name}</strong>. Or drag onto any card.</> : 'Select a card to add to it, drag onto a card, or start a new requirement.'}</p>
      <ul className="ap-palette-list">
        {tab === 'surveys' ? data.surveys.filter((s) => hit(s.name, s.summary)).map((s) => (
          <li key={s.code} draggable={editable} onDragStart={(e) => dragData(e, { kind: 'survey', id: s.code })} data-testid={`ap-pal-survey-${s.code}`}>
            <span className="ap-pal-icon survey"><Icon name="survey" size={14} /></span><span className="ap-pal-text"><strong>{s.name}</strong><small>{s.summary} · version {s.label} · {short(s.fingerprint)}</small></span>
            {used.has(s.code) ? <Tag>in use</Tag> : null}
            {editable ? <button type="button" className="ap-iconbtn" aria-label={target ? `Add ${s.name} to ${target.name}` : `New requirement for ${s.name}`} data-testid={`ap-pal-survey-${s.code}-add`} onClick={() => (target ? toSel((r, p) => { if (r.action.kind === 'INCLUDE') { if (!r.action.surveys.some((x) => x.code === s.code)) r.action.surveys.push(s); } else if (!r.action.alternatives.some((a) => a.survey.code === s.code)) r.action.alternatives.push({ survey: s, when: null }); if (!p.order.includes(s.code)) p.order.push(s.code); }, `Add ${shortName(s.name)}`) : onNew(null, [s], `Requires ${shortName(s.name)}`))}><Icon name="plus" size={14} /></button> : null}
          </li>
        )) : null}
        {tab === 'conditions' ? [...data.conditions].sort((a, b) => Number(recent.has(b.code)) - Number(recent.has(a.code))).filter((c) => hit(c.name, c.description, sentence(c.expr, look))).map((c) => (
          <li key={c.code} draggable={editable} onDragStart={(e) => dragData(e, { kind: 'condition', id: c.code })} data-testid={`ap-pal-condition-${c.code}`}>
            <span className="ap-pal-icon cond"><Icon name="condition" size={14} /></span><span className="ap-pal-text"><strong>{c.name}</strong><small>{sentence(c.expr, look)}</small></span>
            {recent.has(c.code) ? <Tag>used here</Tag> : null}
            {editable ? <button type="button" className="ap-iconbtn" aria-label={target ? `Add “${c.name}” to the condition of ${target.name}` : `New requirement when “${c.name}”`} data-testid={`ap-pal-condition-${c.code}-add`} onClick={() => (target ? toSel((r) => { const x = ref(c.code, c.version); r.when = !r.when ? x : r.when.op === 'all' ? { ...r.when, args: [...r.when.args, x] } : { op: 'all', args: [r.when, x] }; }, `Add “${c.name}”`) : onNew(ref(c.code, c.version), [], `When ${c.name}`))}><Icon name="plus" size={14} /></button> : null}
          </li>
        )) : null}
        {tab === 'variables' ? data.variables.filter((v) => hit(v.name, v.description, v.category)).sort((a, b) => Number(profileVars.includes(b.code)) - Number(profileVars.includes(a.code))).map((v) => (
          <li key={v.code} draggable={editable} onDragStart={(e) => dragData(e, { kind: 'variable', id: v.code })} data-testid={`ap-pal-variable-${v.code}`} className={profileVars.length && !profileVars.includes(v.code) ? 'outside' : ''}>
            <span className="ap-pal-icon var"><Icon name="variable" size={14} /></span><span className="ap-pal-text"><strong>{v.name}</strong><small>{profileVars.length && !profileVars.includes(v.code) ? 'Not in this policy’s profiles' : v.description}</small></span>
            {v.source.status === 'UNMAPPED' ? <Tag tone="unknown">no source</Tag> : null}
          </li>
        )) : null}
        {tab === 'profiles' ? data.profiles.filter((p) => hit(p.name, p.description)).map((p) => { const on = policy.profiles.includes(p.code); return (
          <li key={p.code} data-testid={`ap-pal-profile-${p.code}`}>
            <span className="ap-pal-icon profile"><Icon name="profile" size={14} /></span><span className="ap-pal-text"><strong>{p.name}</strong><small>{composed(data, [p.code]).rows.length} variables</small></span>
            <button type="button" role="switch" aria-checked={on} className={`ap-switch${on ? ' on' : ''}`} disabled={!editable} onClick={() => onToggleProfile(p.code)} data-testid={`ap-pal-profile-${p.code}-toggle`}>{on ? 'Used' : 'Use'}</button>
          </li>
        ); }) : null}
      </ul>
      {tab === 'conditions' ? <button type="button" className="ap-btn quiet" onClick={() => openDrawer({ kind: 'condition' })} data-testid="ap-pal-new-condition"><Icon name="plus" size={13} /> Create a condition</button> : null}
      {tab === 'variables' ? <button type="button" className="ap-btn quiet" onClick={() => openDrawer({ kind: 'variable', name: q })} data-testid="ap-pal-new-variable"><Icon name="plus" size={13} /> Create a variable</button> : null}
    </aside>
  );
}

function RequirementInspector({ policy, id, plan, all, diagnostics, onScenario, onClose, editable, change }: { policy: Policy; id: string; plan: Plan | undefined; all: EvalRow[] | undefined; diagnostics: Diagnostic[]; onScenario: (id: string) => void; onClose: () => void; editable: boolean; change: (label: string, f: (p: Policy) => void) => void }) {
  const { data, look } = useAppl();
  const r = policy.requirements.find((x) => x.id === id)!;
  const res = plan?.requirements?.find((x) => x.id === id);
  const reach = (all ?? []).map((row) => ({ s: data.scenarios.find((x) => x.id === row.scenario), o: row.plan.requirements?.find((x) => x.id === id) })).filter((x) => x.s && x.o);
  return (
    <>
      <header><div><span className="ap-side-kind"><Icon name="policy" size={13} /> Requirement</span><h2>{r.name}</h2></div><button type="button" className="ap-iconbtn" aria-label="Close" onClick={onClose} data-testid="ap-inspector-close"><Icon name="x" /></button></header>
      <p className="ap-side-says"><span className="ap-when-word">When</span> {sentence(r.when, look)} <span className="ap-then-word">then</span> {r.action.kind === 'CHOOSE_ONE' ? 'one of ' : ''}{surveysOf(r).map((s) => shortName(s.name)).join(r.action.kind === 'CHOOSE_ONE' ? ' or ' : ', ') || 'nothing yet'}.</p>
      <section><h3>For the previewed application</h3><p><OutcomeMark r={res} /></p>
        {res?.needs?.length ? <ul className="ap-why">{res.needs.map((n) => <li key={n.name} className="is-unknown"><Icon name="question" size={13} /> {n.name}: {n.reason}</li>)}</ul> : null}
        {res?.replaced_by?.length ? <p className="ap-quiet">Replaced by {res.replaced_by.map((x) => policy.requirements.find((y) => y.id === x)?.name).join(', ')}.</p> : null}</section>
      {diagnostics.length ? <section><h3>Validation</h3><ul className="ap-issues block">{diagnostics.map((d, i) => <li key={i} className={d.severity.toLowerCase()}><Icon name="warn" size={12} /> {d.message}</li>)}</ul></section> : null}
      <section><h3>Note for reviewers</h3><textarea className="ap-input" rows={2} aria-label="Note for reviewers" readOnly={!editable} value={r.note ?? ''} placeholder="Why this requirement exists (optional)" onChange={(e) => change('Change a requirement note', (p) => { const x = p.requirements.find((y) => y.id === id); if (x) x.note = e.target.value; })} data-testid="ap-inspector-note" /></section>
      <section><h3>Pinned survey versions</h3><ul className="ap-pins">{surveysOf(r).map((s) => <li key={s.code}><Icon name="lock" size={12} /><span><strong>{s.name}</strong><small>version {s.label ?? s.version} · {s.fingerprint}</small></span></li>)}{!surveysOf(r).length ? <li className="ap-quiet">None yet.</li> : null}</ul></section>
      <section data-testid="ap-inspector-scenarios"><h3>In the saved scenarios</h3>
        <ul className="ap-uses">{reach.map(({ s, o }) => <li key={s!.id}><button type="button" onClick={() => onScenario(s!.id)}><Icon name="scenario" size={14} /><span><strong>{s!.name}</strong></span><OutcomeMark r={o} small /></button></li>)}</ul></section>
    </>
  );
}

function SurveyInspector({ policy, code, all, onRequirement, onScenario, onClose }: { policy: Policy; code: string; all: EvalRow[] | undefined; onRequirement: (id: string) => void; onScenario: (id: string) => void; onClose: () => void }) {
  const { data, look } = useAppl();
  const s = data.surveys.find((x) => x.code === code) ?? policy.requirements.flatMap(surveysOf).find((x) => x.code === code);
  const by = policy.requirements.filter((r) => surveysOf(r).some((x) => x.code === code));
  const replacers = policy.requirements.filter((r) => r.replaces.some((t) => by.some((b) => b.id === t)));
  const uses = surveyUses(data, code);
  const picks = (all ?? []).filter((row) => row.plan.selected?.some((e) => e.survey.code === code)).map((row) => data.scenarios.find((x) => x.id === row.scenario)).filter(Boolean);
  if (!s) return null;
  return (
    <>
      <header><div><span className="ap-side-kind"><Icon name="survey" size={13} /> Survey</span><h2>{s.name}</h2></div><button type="button" className="ap-iconbtn" aria-label="Close" onClick={onClose} data-testid="ap-inspector-close"><Icon name="x" /></button></header>
      <p className="ap-side-says">{s.summary}</p>
      <dl className="ap-facts-dl"><dt>Pinned version</dt><dd>{s.label ?? s.version} <Tag tone="published"><Icon name="lock" size={11} /> published</Tag></dd><dt>Content fingerprint</dt><dd><code>{s.fingerprint}</code></dd><dt>Place in the order</dt><dd>{policy.order.indexOf(code) >= 0 ? policy.order.indexOf(code) + 1 : 'not placed'}</dd></dl>
      <p className="ap-quiet">A synthetic catalogue entry for this prototype. In Call360 this opens the published survey in Survey Studio.</p>
      <section data-testid="ap-survey-selectors"><h3>Every condition that can select it <span className="ap-count">{by.length}</span></h3>
        <ul className="ap-uses">{by.map((r) => <li key={r.id}><button type="button" onClick={() => onRequirement(r.id)} data-testid={`ap-survey-by-${r.id}`}><Icon name="condition" size={14} /><span><strong>{r.name}</strong><small>when {sentence(r.when, look)}</small></span><Icon name="right" size={13} /></button></li>)}{!by.length ? <li className="ap-quiet">No requirement in this policy names it.</li> : null}</ul></section>
      <section data-testid="ap-survey-replacers"><h3>What can replace it <span className="ap-count">{replacers.length}</span></h3>
        {replacers.length ? <ul className="ap-uses">{replacers.map((r) => <li key={r.id}><button type="button" onClick={() => onRequirement(r.id)}><Icon name="replace" size={14} /><span><strong>{r.name}</strong><small>when {sentence(r.when, look)}</small></span><Icon name="right" size={13} /></button></li>)}</ul> : <p className="ap-quiet">Nothing replaces a requirement that asks for it.</p>}</section>
      <section><h3>Policies that name it <span className="ap-count">{new Set(uses.map((u) => u.detail.split(' · ').slice(0, 2).join(' · '))).size}</span></h3><ul className="ap-uses">{[...new Set(uses.map((u) => u.detail.split(' · ').slice(0, 2).join(' · ')))].map((d) => <li key={d}><span className="ap-use-plain"><Icon name="policy" size={14} /><span><strong>{d}</strong></span></span></li>)}</ul></section>
      <section data-testid="ap-survey-scenarios"><h3>Scenarios that get it <span className="ap-count">{picks.length}</span></h3>
        {picks.length ? <ul className="ap-uses">{picks.map((x) => <li key={x!.id}><button type="button" onClick={() => onScenario(x!.id)}><Icon name="scenario" size={14} /><span><strong>{x!.name}</strong></span><Icon name="right" size={13} /></button></li>)}</ul> : <p className="ap-quiet">No saved scenario is given this survey under this version of the policy.</p>}</section>
    </>
  );
}

function LibraryInspector({ kind, code, onClose }: { kind: 'condition' | 'variable'; code: string; onClose: () => void }) {
  const { data, look, openDrawer } = useAppl();
  const c = kind === 'condition' ? look.condition(code) : undefined;
  const v = kind === 'variable' ? look.variable(code) : undefined;
  const uses = kind === 'condition' ? conditionUses(data, code) : variableUses(data, code);
  return (
    <>
      <header><div><span className="ap-side-kind"><Icon name={kind} size={13} /> {kind === 'condition' ? 'Saved condition' : 'Variable'}</span><h2>{c?.name ?? v?.name ?? code}</h2></div><button type="button" className="ap-iconbtn" aria-label="Close" onClick={onClose} data-testid="ap-inspector-close"><Icon name="x" /></button></header>
      <p className="ap-side-says">{c ? sentence(c.expr, look) : v?.description}</p>
      {c ? <p><Tag tone={c.status === 'PUBLISHED' ? 'published' : 'draft'}>Version {c.version} {c.status === 'PUBLISHED' ? 'published' : 'draft'}</Tag></p> : null}
      <div className="ap-side-actions"><button type="button" className="ap-btn" onClick={() => openDrawer(kind === 'condition' ? { kind: 'condition', code } : { kind: 'variable', code })} data-testid="ap-inspector-edit"><Icon name={kind} size={13} /> Change here</button><Link className="ap-btn quiet" to={`${BASE}/${kind === 'condition' ? 'conditions?c=' : 'variables?v='}${code}`}>Open in the {kind === 'condition' ? 'condition lab' : 'variable library'}</Link></div>
      <section><h3>Where it is used <span className="ap-count">{uses.length}</span></h3><ul className="ap-uses">{uses.map((u) => <li key={`${u.kind}-${u.code}`}><Link to={u.to}><Icon name={u.kind === 'policy' ? 'policy' : u.kind} size={14} /><span><strong>{u.label}</strong><small>{u.detail}</small></span><Icon name="right" size={13} /></Link></li>)}</ul></section>
    </>
  );
}
