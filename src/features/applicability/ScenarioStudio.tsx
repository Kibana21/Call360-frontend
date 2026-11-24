// Survey Applicability (APPL-X4a) — the Scenario Studio: synthetic applications SAVED in Call360, their variants, the
// regression suites that state what each one is expected to select, and the recorded runs that prove what happened.
// Everything shown as a result comes from the server's Python evaluator. The browser edits documents and draws answers.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { generate } from './api';
import { FactsEditor } from './facts';
import { same } from './model/describe';
import type { Facts, Plan, Policy } from './model/types';
import { PlanView } from './plan';
import { isUnsaved, savedPolicy, toServer } from './policyStore';
import { NameAndCode, codeOk, suggestCode, usePolicies } from './policyService';
import { RunHistory } from './RunHistory';
import {
  archiveScenario, codeOf, compareScenarios, createScenario, evaluateScenarios, factWord, getScenario, getSuite, inspectScenario, listScenarios, listSuites, saveScenario, saveSuite, when, why,
  type Dep, type Expectation, type Purpose, type ScenarioDetail, type ScenarioDoc, type ScenarioSummary,
} from './scenarioApi';
import { SurveyPath, TEMPLATES } from './Scenarios';
import { useAppl } from './store';
import { SuiteBuilder } from './SuiteBuilder';
import { DrawerPanel, Empty, Field, Icon, Picker, Segmented, Tag, short, useParamState } from './ui';
import { BASE, composed, shortName, surveysOf } from './usage';

export interface StudioPolicy { id: string; code: string; name: string; market: string; revision: number; doc: Policy; unsaved: boolean; surveys: { code: string; version: number; name: string }[] }
type View = 'scenarios' | 'suites' | 'runs';
const PURPOSE: Record<Purpose, { word: string; says: string }> = {
  REGRESSION: { word: 'Regression', says: 'May belong to a publication-gating suite. Its expected result is meant to stay true.' },
  EXPLORATORY: { word: 'Exploratory', says: 'For trying things out. Never counts towards publication.' },
};

export function ScenarioStudioPage() {
  const { current: rec, data, setCurrent } = useAppl();
  const pol = usePolicies();
  // a link may name the policy the studio is about: the studio then follows it (a reload forgets the tab's choice)
  const [named] = useParamState('policy');
  useEffect(() => { if (named && rec?.code !== named && data.policies.some((x) => x.code === named)) setCurrent(named); }, [named, rec?.code, data.policies, setCurrent]);
  const { can } = useAuth();
  const [viewParam, setView] = useParamState('view');
  const view = (['scenarios', 'suites', 'runs'].includes(viewParam ?? '') ? viewParam : 'scenarios') as View;
  const kept = rec ? savedPolicy(rec.code) : undefined;
  const policy = useMemo<StudioPolicy | null>(() => {
    if (!rec?.draft || !kept) return null;
    const seen = new Map<string, { code: string; version: number; name: string }>();
    rec.draft.requirements.forEach((r) => surveysOf(r).forEach((s) => { if (s?.code && !seen.has(s.code)) seen.set(s.code, { code: s.code, version: s.version, name: s.name }); }));
    return { id: kept.id, code: rec.code, name: rec.draft.name, market: rec.draft.market, revision: kept.revision, doc: rec.draft, unsaved: isUnsaved(rec.draft), surveys: [...seen.values()] };
  }, [rec, kept]);
  const canEdit = can('applicability.edit') && can('survey.read');

  if (pol.status === 'loading') return <div className="ap-page" data-testid="ap-studio" data-state="loading"><p className="ap-quiet">Reading the saved policies…</p></div>;
  if (pol.status === 'forbidden' || !can('applicability.read')) return <div className="ap-page" data-testid="ap-studio" data-state="forbidden"><Empty icon="lock" title="You are not permitted to read scenarios">Saved scenarios, suites and runs need the applicability read permission.</Empty></div>;
  if (named && rec?.code !== named && data.policies.some((x) => x.code === named)) return <div className="ap-page" data-testid="ap-studio" data-state="loading"><p className="ap-quiet">Opening the policy…</p></div>;
  if (!policy) return <div className="ap-page" data-testid="ap-studio" data-state="no-policy"><Empty icon="policy" title="Open a saved policy first" action={<Link className="ap-btn primary" to={`${BASE}/policies`}>Go to the policies</Link>}>Scenarios are tested against a saved applicability policy. Choose one in the policy menu or the gallery.</Empty></div>;

  return (
    <div className="ap-page ap-studio" data-testid="ap-studio" data-state="ready" data-view={view}>
      <header className="ap-pagehead ap-studio-head">
        <div>
          <h1>Scenario studio</h1>
          <p>Synthetic applications, saved in Call360. Test what <strong>{policy.name}</strong> selects, keep the cases that matter in a regression suite, and record what happened.</p>
        </div>
        <p className="ap-synthetic" data-testid="ap-synthetic-note" role="note"><Icon name="warn" size={14} /> <span><strong>Synthetic data only.</strong> Never enter a real customer, policy number, case or contact detail — not in a name, a note or a fact.</span></p>
      </header>
      {policy.unsaved ? <p className="ap-callout warn" data-testid="ap-studio-policy-unsaved"><Icon name="info" /> <span>This policy has changes in this tab that are not saved. Live results below are a <strong>preview</strong> of the unsaved edit; a suite run always uses the saved revision {policy.revision}. <Link to={`${BASE}/policies/${policy.code}`}>Open the designer to save</Link>.</span></p> : null}
      <div className="ap-tabs" role="tablist" aria-label="Scenario studio">
        {([['scenarios', 'scenario', 'Scenarios'], ['suites', 'cards', 'Regression suites'], ['runs', 'history', 'Recorded runs']] as const).map(([id, icon, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)} data-testid={`ap-studio-tab-${id}`}><Icon name={icon} size={14} /> {label}</button>
        ))}
      </div>
      {view === 'scenarios' ? <ScenariosView policy={policy} canEdit={canEdit} /> : view === 'suites' ? <SuiteBuilder policy={policy} canEdit={canEdit} /> : <RunHistory policy={policy} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the scenario list
function ScenariosView({ policy, canEdit }: { policy: StudioPolicy; canEdit: boolean }) {
  const [chosen, setChosen] = useParamState('s');
  const [fresh, setFresh] = useParamState('new');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'policy' | 'market'>('policy');
  const [purpose, setPurpose] = useState<'' | Purpose>('');
  const [limit, setLimit] = useState(50);
  const [archived, setArchived] = useState(false);
  const list = useQuery({ queryKey: ['x4-scenarios', scope === 'policy' ? policy.id : policy.market, q, purpose, limit, archived], queryFn: () => listScenarios({ policy_id: scope === 'policy' ? policy.id : undefined, q: q.trim() || undefined, purpose: purpose || undefined, limit, archived }), placeholderData: (p) => p });
  const items = list.data?.items ?? [];
  const sel = chosen ?? (fresh ? null : items[0]?.id ?? null);
  // D-418: nothing can be created until the list is known — a suggested code may already be taken
  const ready = list.isSuccess;
  return (
    <div className="ap-scenarios ap-studio-split">
      <aside className="ap-list" aria-label="Saved scenarios" data-testid="ap-scn-list" data-state={list.isLoading ? 'loading' : list.isError ? 'error' : 'ready'} data-total={list.data?.total ?? ''}>
        <header><h2>Scenarios</h2>{canEdit ? <button type="button" className="ap-btn quiet" disabled={!ready} title={ready ? undefined : 'The saved scenarios are still being read'} onClick={() => { setFresh('1'); setChosen(null); }} data-testid="ap-scn-new"><Icon name="plus" size={13} /> New</button> : null}</header>
        <label className="ap-searchbox"><Icon name="search" size={14} /><input value={q} onChange={(e) => { setQ(e.target.value); setLimit(50); }} placeholder="Search by name or code" aria-label="Search scenarios" data-testid="ap-scn-search" /></label>
        <div className="ap-list-filters">
          <Segmented label="Which scenarios" value={scope} onChange={setScope} testid="ap-scn-scope" options={[{ value: 'policy', label: 'This policy' }, { value: 'market', label: `All of ${policy.market}` }]} />
          <select className="ap-input" aria-label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as '' | Purpose)} data-testid="ap-scn-purpose-filter"><option value="">Any purpose</option><option value="REGRESSION">Regression</option><option value="EXPLORATORY">Exploratory</option></select>
        </div>
        <label className="ap-archived-toggle"><input type="checkbox" checked={archived} onChange={(e) => { setArchived(e.target.checked); setChosen(null); setFresh(null); }} data-testid="ap-scn-archived-toggle" /> Show archived scenarios</label>
        {list.isError ? <p className="ap-callout warn">The scenarios could not be read: {why(list.error)}</p> : null}
        <ul>{items.map((s) => <li key={s.id}><ScenarioRow s={s} on={s.id === sel} onPick={() => { setChosen(s.id); setFresh(null); }} /></li>)}</ul>
        {ready && !items.length ? <Empty icon="scenario" title={archived ? 'No archived scenario' : q || purpose ? 'No scenario matches' : 'No saved scenario yet'}>{archived ? 'Archived scenarios are kept here and can be restored.' : q || purpose ? 'Try another search.' : 'A scenario is one synthetic application with its facts. Create the first one.'}</Empty> : null}
        {list.data ? <p className="ap-quiet ap-list-foot" data-testid="ap-scn-count">Showing {items.length} of {list.data.total}{list.data.total > items.length ? <> · <button type="button" className="ap-linkbtn" onClick={() => setLimit(Math.min(limit + 50, 100))} disabled={limit >= 100} data-testid="ap-scn-more">{limit >= 100 ? 'Search to narrow' : 'Show more'}</button></> : null}</p> : null}
      </aside>
      <section className="ap-scn-main">
        {fresh && canEdit ? <NewScenario policy={policy} existing={items} from={fresh} onCancel={() => setFresh(null)} onCreated={(id) => { setFresh(null); setChosen(id); }} />
          : sel ? <ScenarioEditor key={sel} id={sel} policy={policy} canEdit={canEdit} onVariant={() => setFresh(`variant:${sel}`)} onCopy={() => setFresh(`copy:${sel}`)} onOpen={(id) => setChosen(id)} onGone={() => setChosen(null)} />
            : ready ? <Empty icon="scenario" title="Choose a scenario" action={canEdit ? <button type="button" className="ap-btn primary" onClick={() => setFresh('1')} data-testid="ap-scn-new-empty"><Icon name="plus" size={13} /> Create a scenario</button> : undefined}>Pick one on the left, or create a new synthetic application.</Empty> : <p className="ap-quiet">Reading the saved scenarios…</p>}
      </section>
    </div>
  );
}
function ScenarioRow({ s, on, onPick }: { s: ScenarioSummary; on: boolean; onPick: () => void }) {
  return (
    <button type="button" className={on ? 'on' : ''} onClick={onPick} data-testid={`ap-scn-${s.code}`} data-purpose={s.purpose}>
      <span className={`ap-dot is-${s.purpose === 'REGRESSION' ? 'true' : 'none'}`} aria-hidden="true" />
      <span><strong>{s.name}</strong><small>{s.baseline_id ? 'Variant · ' : ''}{s.facts} fact{s.facts === 1 ? '' : 's'}{s.unknown_facts ? ` · ${s.unknown_facts} not known` : ''}{s.suites ? ` · in ${s.suites} suite${s.suites === 1 ? '' : 's'}` : ''}</small></span>
      {s.purpose === 'EXPLORATORY' ? <Tag tone="unknown" title={PURPOSE.EXPLORATORY.says}>exploratory</Tag> : null}
    </button>
  );
}

// ------------------------------------------------------------------------------------------------- create a scenario
type Start = 'blank' | 'profile' | 'copy' | 'variant' | 'template' | 'generated';
const STARTS: { id: Start; icon: 'plus' | 'profile' | 'copy' | 'condition' | 'sparkle' | 'cards'; name: string; says: string }[] = [
  { id: 'blank', icon: 'plus', name: 'Blank', says: 'Start with no facts and give the ones that matter.' },
  { id: 'profile', icon: 'profile', name: 'From an application profile', says: 'The profile decides which facts are offered.' },
  { id: 'template', icon: 'cards', name: 'From a synthetic template', says: 'A ready-made starting point, such as ILP only.' },
  { id: 'copy', icon: 'copy', name: 'From an existing scenario', says: 'An independent copy of a saved scenario.' },
  { id: 'variant', icon: 'condition', name: 'As a variant', says: 'Copies a baseline and remembers it, so the difference is always shown.' },
  { id: 'generated', icon: 'sparkle', name: 'From a generated combination', says: 'Call360 proposes representative combinations of the conditions this policy reads.' },
];
function NewScenario({ policy, existing, from, onCancel, onCreated }: { policy: StudioPolicy; existing: ScenarioSummary[]; from: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const { data, look, say } = useAppl();
  const qc = useQueryClient();
  const preset = from.includes(':') ? (from.split(':') as [Start, string]) : null;
  const [start, setStart] = useState<Start>(preset ? preset[0] : 'blank');
  const [source, setSource] = useState<string | null>(preset ? preset[1] : null);
  const [template, setTemplate] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<string[]>(policy.doc.profiles.filter((c) => data.profiles.some((p) => p.code === c)));
  const [name, setName] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('REGRESSION');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; items: { name: string; description: string; facts: Facts; profiles: string[] }[]; note?: string }>({ status: 'idle', items: [] });
  const [picked, setPicked] = useState<number | null>(null);
  const base = useQuery({ queryKey: ['x4-scenario', source], queryFn: () => getScenario(source!), enabled: !!source && (start === 'copy' || start === 'variant') });
  const taken = useQuery({ queryKey: ['x4-code-taken', policy.market, (code ?? suggestCode(name)).toLowerCase()], queryFn: async () => (await listScenarios({ q: code ?? suggestCode(name), limit: 100 })).items.some((x) => x.code.toLowerCase() === (code ?? suggestCode(name)).toLowerCase()), enabled: name.trim().length >= 2 });
  useEffect(() => { if (start === 'variant' && base.data && !name) setName(`${base.data.name} — variant`); if (start === 'copy' && base.data && !name) setName(`${base.data.name} (copy)`); }, [start, base.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const runGenerator = async () => {
    setGen({ status: 'loading', items: [] });
    try { const g = await generate(data, policy.doc, 24); setGen({ status: 'ready', items: g.scenarios.map((s) => ({ name: s.name, description: s.description, facts: s.facts, profiles: s.profiles })), note: g.coverage.exhaustive ? `These ${g.scenarios.length} combinations are every distinct result of the ${g.coverage.variables?.length ?? 0} facts this policy reads.` : `Showing ${g.scenarios.length} representative combinations; generation was capped, so this is NOT every possible application.` }); }
    catch (e) { setGen({ status: 'error', items: [], note: why(e) }); }
  };
  const t = TEMPLATES.find((x) => x.id === template);
  const doc = (): Omit<ScenarioDoc, 'pins'> => {
    const known = (facts: Facts) => Object.fromEntries(Object.entries(facts).filter(([k]) => look.variable(k) && !look.variable(k)?.derived));
    if ((start === 'copy' || start === 'variant') && base.data) return { name: name.trim(), description: description || (start === 'variant' ? `A variant of “${base.data.name}”.` : base.data.description), profiles: (base.data.document as unknown as ScenarioDoc).profiles, facts: (base.data.document as unknown as ScenarioDoc).facts };
    if (start === 'template' && t) return { name: name.trim(), description: description || t.says, profiles, facts: known(t.facts) };
    if (start === 'generated' && picked !== null && gen.items[picked]) { const g = gen.items[picked]!; return { name: name.trim(), description: description || g.description, profiles: g.profiles.filter((c) => data.profiles.some((p) => p.code === c)), facts: known(g.facts) }; }
    return { name: name.trim(), description, profiles: start === 'blank' ? [] : profiles, facts: {} };
  };
  const value = code ?? suggestCode(name);
  const needs = start === 'copy' || start === 'variant' ? !base.data : start === 'template' ? !t : start === 'generated' ? picked === null : false;
  const can = name.trim().length >= 2 && codeOk(value, () => taken.data === true) && taken.isSuccess && !needs && !busy;
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const made = await createScenario({ market_code: policy.market, code: value, document: doc(), purpose, policy_id: policy.id, baseline_id: start === 'variant' ? source : null, origin: start === 'variant' ? `VARIANT:${base.data?.code}` : start === 'copy' ? `COPY:${base.data?.code}` : start === 'template' ? `TEMPLATE:${template}` : start.toUpperCase() });
      qc.setQueryData(['x4-scenario', made.id], made); await qc.invalidateQueries({ queryKey: ['x4-scenarios'] }); say(`“${made.name}” saved in Call360`); onCreated(made.id);
    } catch (e) { setError(codeOf(e) === 'CODE_TAKEN' ? `Not created: ${why(e)}. Choose another code.` : `Not created: ${why(e)}`); void taken.refetch(); } finally { setBusy(false); }
  };
  return (
    <section className="ap-newscn ap-newscn4" data-testid="ap-scn-create" aria-label="Create a scenario">
      <header><h2>Create a scenario</h2><button type="button" className="ap-iconbtn" aria-label="Cancel" onClick={onCancel} data-testid="ap-scn-create-cancel"><Icon name="x" /></button></header>
      <ol className="ap-steps3">
        <li><h3><span>1</span> How do you want to start?</h3>
          <div className="ap-templates" role="radiogroup" aria-label="Starting point">
            {STARTS.map((x) => <button key={x.id} type="button" role="radio" aria-checked={start === x.id} className={start === x.id ? 'on' : ''} onClick={() => { setStart(x.id); if (x.id === 'generated' && gen.status === 'idle') void runGenerator(); }} data-testid={`ap-scn-start-${x.id}`}><strong><Icon name={x.icon} size={14} /> {x.name}</strong><small>{x.says}</small></button>)}
          </div>
          {start === 'profile' || start === 'template' ? <Field label="Application profiles" hint="A profile groups the facts of a kind of application. Several can be combined."><div className="ap-choice wrap" role="group" aria-label="Profiles">{data.profiles.filter((p) => p.status === 'PUBLISHED').map((p) => { const on = profiles.includes(p.code); return <button key={p.code} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} data-testid={`ap-scn-create-profile-${p.code}`} onClick={() => setProfiles(on ? profiles.filter((c) => c !== p.code) : [...profiles, p.code])}>{on ? <Icon name="check" size={12} /> : null}{p.name}</button>; })}</div></Field> : null}
          {start === 'template' ? <div className="ap-templates small" role="radiogroup" aria-label="Template">{TEMPLATES.map((x) => <button key={x.id} type="button" role="radio" aria-checked={template === x.id} className={template === x.id ? 'on' : ''} onClick={() => { setTemplate(x.id); if (!name) setName(x.name); }} data-testid={`ap-scn-template-${x.id}`}><strong>{x.name}</strong><small>{x.says}</small></button>)}</div> : null}
          {start === 'copy' || start === 'variant' ? <Field label={start === 'variant' ? 'Baseline scenario' : 'Scenario to copy'} hint={start === 'variant' ? 'The variant keeps a link to it; every difference is shown.' : undefined}>
            <select className="ap-input" value={source ?? ''} onChange={(e) => setSource(e.target.value || null)} data-testid="ap-scn-create-source"><option value="">Choose a saved scenario…</option>{existing.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}{source && !existing.some((s) => s.id === source) && base.data ? <option value={source}>{base.data.name}</option> : null}</select></Field> : null}
          {start === 'generated' ? <div className="ap-gen-list" data-testid="ap-scn-generated" data-state={gen.status}>
            {gen.status === 'loading' ? <p className="ap-quiet">Working out representative combinations…</p> : gen.status === 'error' ? <p className="ap-callout warn">{gen.note}</p> : <>
              <p className="ap-quiet" data-testid="ap-scn-generated-note">{gen.note}</p>
              <div className="ap-templates small" role="radiogroup" aria-label="Generated combination">{gen.items.map((g, i) => <button key={i} type="button" role="radio" aria-checked={picked === i} className={picked === i ? 'on' : ''} onClick={() => { setPicked(i); if (!name) setName(g.name); }} data-testid={`ap-scn-generated-${i}`}><strong>{g.name}</strong><small>{Object.entries(g.facts).slice(0, 4).map(([k, v]) => `${look.variable(k)?.name ?? k}: ${factWord(v)}`).join(' · ')}</small></button>)}</div></>}
          </div> : null}
        </li>
        <li><h3><span>2</span> Name it</h3>
          <div className="ap-two"><div><NameAndCode noun="scenario" name={name} setName={setName} code={code} setCode={setCode} taken={() => taken.data === true} /></div>
            <Field label="What it stands for (optional)"><textarea className="ap-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="For example: an investment-linked sale concluded by phone" data-testid="ap-scn-create-description" /></Field></div>
        </li>
        <li><h3><span>3</span> What is it for?</h3>
          <div className="ap-templates small two" role="radiogroup" aria-label="Purpose">{(['REGRESSION', 'EXPLORATORY'] as const).map((p) => <button key={p} type="button" role="radio" aria-checked={purpose === p} className={purpose === p ? 'on' : ''} onClick={() => setPurpose(p)} data-testid={`ap-scn-create-purpose-${p}`}><strong>{PURPOSE[p].word}</strong><small>{PURPOSE[p].says}</small></button>)}</div>
        </li>
      </ol>
      {error ? <p className="ap-callout warn" role="alert" data-testid="ap-scn-create-error">{error}</p> : null}
      <footer><button type="button" className="ap-btn quiet" onClick={onCancel}>Cancel</button><button type="button" className="ap-btn primary" onClick={create} disabled={!can} data-testid="ap-scn-create-save"><Icon name="check" size={13} /> {busy ? 'Saving…' : 'Create and save'}</button></footer>
    </section>
  );
}

// --------------------------------------------------------------------------------------------- one scenario, edited
interface Work { doc: ScenarioDoc; purpose: Purpose }
type Hist = { past: Work[]; now: Work; future: Work[]; revision: number };
/** Unsaved edits of a scenario survive moving around the product in this tab (to Survey Studio and back, say): they are
    kept here until saved or discarded. They are NOT saved in Call360 until the person saves, and the save bar says so. */
const unsavedScenarios = new Map<string, Hist>();
const docOf = (d: ScenarioDetail): ScenarioDoc => ({ name: '', description: '', profiles: [], facts: {}, pins: [], ...(d.document as object) }) as ScenarioDoc;

function ScenarioEditor({ id, policy, canEdit, onVariant, onCopy, onOpen, onGone }: { id: string; policy: StudioPolicy; canEdit: boolean; onVariant: () => void; onCopy: () => void; onOpen: (id: string) => void; onGone: () => void }) {
  const { data, look, say, setPreview } = useAppl();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['x4-scenario', id], queryFn: () => getScenario(id) });
  const [hist, setHist] = useState<Hist | null>(() => unsavedScenarios.get(id) ?? null);
  const [flag, setFlag] = useState<{ state: 'saving' | 'conflict' | 'error'; message?: string } | null>(null);
  const [factScope, setFactScope] = useState<'policy' | 'profile' | 'changed'>('policy');
  const [factFind, setFactFind] = useState('');
  const [activeSurvey, setActiveSurvey] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'history' | 'archive'>('none');
  const [reason, setReason] = useState('');
  const [restoring, setRestoring] = useState(false);
  const d = detail.data;
  // the editor follows what is saved: on first load, and again after every save or reload
  useEffect(() => { if (d && (!hist || hist.revision !== d.draft_revision)) setHist({ past: [], now: { doc: docOf(d), purpose: d.purpose }, future: [], revision: d.draft_revision }); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const work = hist?.now;
  const dirty = !!d && !!work && (!same(work.doc, docOf(d)) || work.purpose !== d.purpose);
  useEffect(() => { if (hist && dirty) unsavedScenarios.set(id, hist); else unsavedScenarios.delete(id); }, [id, hist, dirty]);
  const edit = (f: (w: Work) => void) => setHist((h) => { if (!h) return h; const next = structuredClone(h.now); f(next); return same(next, h.now) ? h : { ...h, past: [...h.past, h.now].slice(-60), now: next, future: [] }; });
  const undo = () => setHist((h) => (h && h.past.length ? { ...h, past: h.past.slice(0, -1), now: h.past[h.past.length - 1]!, future: [h.now, ...h.future] } : h));
  const redo = () => setHist((h) => (h && h.future.length ? { ...h, past: [...h.past, h.now], now: h.future[0]!, future: h.future.slice(1) } : h));

  const policyDoc = policy.unsaved ? toServer(policy.doc) : null;
  const live = useQuery({
    queryKey: ['x4-eval', policy.id, policy.revision, policyDoc ? JSON.stringify(policyDoc) : null, dirty ? JSON.stringify(work?.doc) : [id, d?.draft_revision], d?.baseline_id ?? null], enabled: !!d && !!work, placeholderData: (p) => p, retry: false,
    queryFn: () => evaluateScenarios(policy.id, [dirty ? { ref: 'this', document: work!.doc, snapshot: d!.snapshot } : { ref: 'this', scenario_id: id }, ...(d!.baseline_id ? [{ ref: 'baseline', scenario_id: d!.baseline_id }] : [])], policyDoc),
  });
  const inspection = useQuery({ queryKey: ['x4-inspect', id, JSON.stringify(work?.doc)], enabled: !!d && !!work && dirty, placeholderData: (p) => p, retry: false, queryFn: () => inspectScenario(d!.market_code, work!.doc, d!.snapshot) });
  const because = useQuery({ queryKey: ['x4-variant', policy.id, policy.revision, d?.baseline_id, id, d?.draft_revision], enabled: !!d?.baseline_id && !dirty && !policy.unsaved, retry: false, queryFn: () => compareScenarios(policy.id, d!.baseline_id!, id) });
  const suites = useQuery({ queryKey: ['x4-suites', policy.id], queryFn: () => listSuites({ policy_id: policy.id, limit: 100 }) });

  if (detail.isError) return <Empty icon="warn" title="This scenario could not be read" action={<button type="button" className="ap-btn" onClick={onGone}>Back to the list</button>}>{why(detail.error)}</Empty>;
  if (!d || !work) return <p className="ap-quiet" data-testid="ap-scn-editor" data-state="loading">Reading the scenario…</p>;

  const row = live.data?.results.find((r) => r.ref === 'this');
  const baseRow = live.data?.results.find((r) => r.ref === 'baseline');
  const plan = row?.plan ?? undefined;
  const insp = dirty ? inspection.data ?? d.inspection : d.inspection;
  const deps = insp.dependencies as unknown as Dep[];
  const readOnly = !canEdit || d.state === 'ARCHIVED';
  const save = async (overwrite = false) => {
    setFlag({ state: 'saving' });
    try {
      const revision = overwrite ? (await getScenario(id)).draft_revision : d.draft_revision;
      const saved = await saveScenario(id, revision, work.doc, work.purpose);
      qc.setQueryData(['x4-scenario', id], saved); void qc.invalidateQueries({ queryKey: ['x4-scenarios'] }); setFlag(null); say(`Saved · revision ${saved.draft_revision}`);
    } catch (e) { setFlag(codeOf(e) === 'STALE_REVISION' ? { state: 'conflict', message: why(e) } : { state: 'error', message: why(e) }); }
  };
  // what is saved is read again and the editor is set to it — also when it is the same revision as before
  const reload = async () => { setFlag(null); const x = (await detail.refetch()).data ?? d; setHist({ past: [], now: { doc: docOf(x), purpose: x.purpose }, future: [], revision: x.draft_revision }); };
  const state = readOnly ? 'readonly' : flag?.state ?? (dirty ? 'unsaved' : 'saved');

  // ---- which facts to show: by default only what this policy reads
  const reads = Object.keys(plan?.facts ?? {});
  const comp = composed(data, work.doc.profiles);
  const groups = (() => { const m = new Map<string, string[]>(); comp.rows.forEach((r) => m.set(r.section, [...(m.get(r.section) ?? []), r.variable])); return [...m.entries()].map(([name, variables]) => ({ name, variables })); })();
  const every = [...new Set([...reads, ...comp.rows.map((r) => r.variable), ...Object.keys(work.doc.facts)])].filter((c) => look.variable(c));
  const baseFacts = (d.baseline?.facts ?? null) as Facts | null;
  const differs = (c: string) => !!baseFacts && ((c in baseFacts) !== (c in work.doc.facts) || !same(baseFacts[c], work.doc.facts[c]));
  const shown = every.filter((c) => {
    if (factScope === 'policy' && reads.length && !reads.includes(c) && !(c in work.doc.facts)) return false;
    if (factScope === 'changed' && !differs(c)) return false;
    const v = look.variable(c);
    return !factFind.trim() || `${v?.name} ${v?.description} ${c}`.toLowerCase().includes(factFind.trim().toLowerCase());
  });
  const changedFacts = baseFacts ? [...new Set([...Object.keys(baseFacts), ...Object.keys(work.doc.facts)])].filter(differs) : [];
  const picked = (p: Plan | null | undefined) => (p ? p.selected.map((e) => e.survey.code) : []);
  const names = new Map([...(plan?.selected ?? []), ...(plan?.pending ?? []), ...(baseRow?.plan?.selected ?? []), ...(baseRow?.plan?.pending ?? [])].map((e) => [e.survey.code, shortName(e.survey.name)]));
  const added = picked(plan).filter((c) => !picked(baseRow?.plan).includes(c));
  const removed = picked(baseRow?.plan).filter((c) => !picked(plan).includes(c));
  const adopt = (dep: Dep, to: { version?: number; draft_revision?: number }) => edit((w) => { w.doc.pins = [...w.doc.pins.filter((p) => !(p.kind === dep.kind && p.code === dep.code)), { kind: dep.kind, code: dep.code, ...to }]; });
  const addToSuite = async (suiteId: string) => {
    try {
      const u = await getSuite(suiteId);
      if (u.member_list.some((m) => m.scenario_id === id)) { say('It is already in that suite', 'info'); return; }
      await saveSuite(suiteId, u.draft_revision, { name: u.name, description: u.description }, u.purpose, [...u.member_list.map((m) => ({ scenario_id: m.scenario_id, expectation: m.expectation as unknown as Expectation | null })), { scenario_id: id, expectation: null }], `Added scenario ${d.code}`);
      await Promise.all([qc.invalidateQueries({ queryKey: ['x4-suites'] }), qc.invalidateQueries({ queryKey: ['x4-suite', suiteId] }), detail.refetch()]); say(`Added to “${u.name}”. State its expected outcome in the suite.`);
    } catch (e) { say(why(e), 'warn'); }
  };
  const restore = async () => { try { const back = await archiveScenario(id, d.draft_revision, '', true); qc.setQueryData(['x4-scenario', id], back); await qc.invalidateQueries({ queryKey: ['x4-scenarios'] }); setRestoring(false); say(`“${d.name}” restored exactly as it was saved`); } catch (e) { say(why(e), 'warn'); } };
  const archive = async () => { try { await archiveScenario(id, d.draft_revision, reason); await qc.invalidateQueries({ queryKey: ['x4-scenarios'] }); say(`“${d.name}” archived. It is kept and can be restored.`); onGone(); } catch (e) { say(why(e), 'warn'); } };

  return (
    <div className="ap-scn-split" data-testid="ap-scn-editor" data-state={state} data-code={d.code} data-revision={d.draft_revision} data-fingerprint={d.scenario_fingerprint} data-snapshot={d.snapshot_sha256}>
      <div className="ap-scn-inputs" data-testid="ap-scenario-inputs">
        <div className={`ap-savebar is-${state}`} data-testid="ap-scn-bar" data-state={state} role="status">
          <span className="ap-savebar-says" data-testid="ap-scn-bar-says">
            {state === 'readonly' ? <><Icon name="lock" size={13} /> {d.state === 'ARCHIVED' ? <>Archived by {[...d.events].reverse().find((e) => e.event === 'ARCHIVED')?.actor ?? 'someone'} — “{[...d.events].reverse().find((e) => e.event === 'ARCHIVED')?.comment || 'no reason given'}”. Read only; nothing was deleted.</> : 'Read only: you may not edit scenarios.'}</>
              : state === 'saving' ? 'Saving…' : state === 'conflict' ? <><Icon name="warn" size={13} /> {flag?.message}</> : state === 'error' ? <><Icon name="warn" size={13} /> Not saved: {flag?.message}</>
                : state === 'unsaved' ? <><Icon name="info" size={13} /> <strong>Unsaved changes.</strong> The result on the right is of the unsaved edit.</> : <><Icon name="check" size={13} /> <strong>Saved in Call360</strong> · revision {d.draft_revision} · {d.updated_by ?? 'someone'} · {when(d.updated_at)}</>}
          </span>
          {!readOnly ? <span className="ap-savebar-acts">
            <button type="button" className="ap-iconbtn" aria-label="Undo" disabled={!hist?.past.length} onClick={undo} data-testid="ap-scn-undo"><Icon name="undo" size={14} /></button>
            <button type="button" className="ap-iconbtn" aria-label="Redo" disabled={!hist?.future.length} onClick={redo} data-testid="ap-scn-redo"><Icon name="redo" size={14} /></button>
            {state === 'conflict' ? <><button type="button" className="ap-btn" onClick={() => void reload()} data-testid="ap-scn-reload">Show the saved version</button><button type="button" className="ap-btn" onClick={() => void save(true)} data-testid="ap-scn-overwrite">Save mine over it</button></>
              : <>{dirty ? <button type="button" className="ap-btn quiet" onClick={() => void reload()} data-testid="ap-scn-revert">Discard changes</button> : null}<button type="button" className="ap-btn primary" disabled={!dirty || state === 'saving' || work.doc.name.trim().length < 2} onClick={() => void save()} data-testid="ap-scn-save"><Icon name="check" size={13} /> Save</button></>}
          </span> : canEdit && d.state === 'ARCHIVED' ? <span className="ap-savebar-acts">{restoring
            ? <span className="ap-archived-ask" data-testid="ap-scn-restore-confirm"><span>Restore “{d.name}”? It returns to the list exactly as it was saved.</span><button type="button" className="ap-btn primary" onClick={() => void restore()} data-testid="ap-scn-restore-ok">Yes, restore it</button><button type="button" className="ap-btn quiet" onClick={() => setRestoring(false)}>Cancel</button></span>
            : <button type="button" className="ap-btn" onClick={() => { setRestoring(true); setPanel('history'); }} data-testid="ap-scn-restore"><Icon name="history" size={13} /> Restore</button>}</span> : null}
        </div>
        <div className="ap-scn-title">
          <textarea className="ap-title-input" rows={1} aria-label="Scenario name" readOnly={readOnly} value={work.doc.name} onChange={(e) => edit((w) => { w.doc.name = e.target.value.replace(/\n/g, ' '); })} data-testid="ap-scn-name" />
          <input className="ap-sub-input" aria-label="Scenario description" readOnly={readOnly} placeholder="What this example stands for" value={work.doc.description} onChange={(e) => edit((w) => { w.doc.description = e.target.value; })} data-testid="ap-scn-description" />
          <p className="ap-quiet"><code>{d.code}</code> · {d.market_code} · synthetic{d.baseline ? <> · variant of <button type="button" className="ap-linkbtn" onClick={() => onOpen(d.baseline!.id)} data-testid="ap-scn-baseline-link">{d.baseline.name}</button></> : null}</p>
        </div>
        <div className="ap-scn-tools">
          <Segmented label="Purpose" value={work.purpose} onChange={(p) => { if (!readOnly) edit((w) => { w.purpose = p; }); }} testid="ap-scn-purpose" options={[{ value: 'REGRESSION', label: 'Regression', testid: 'ap-scn-purpose-REGRESSION' }, { value: 'EXPLORATORY', label: 'Exploratory', testid: 'ap-scn-purpose-EXPLORATORY' }]} />
          {canEdit ? <>
            <button type="button" className="ap-btn quiet" onClick={onVariant} disabled={dirty} title={dirty ? 'Save first' : 'A saved copy that remembers this one as its baseline'} data-testid="ap-scn-variant"><Icon name="condition" size={13} /> Create a variant</button>
            <button type="button" className="ap-btn quiet" onClick={onCopy} disabled={dirty} title={dirty ? 'Save first' : undefined} data-testid="ap-scn-duplicate"><Icon name="copy" size={13} /> Duplicate</button>
            <Picker label="Add to a suite" testid="ap-scn-suite" items={(suites.data?.items ?? []).map((u) => ({ id: u.id, label: u.name, hint: u.purpose === 'PUBLICATION_GATING' ? 'Publication-gating' : 'Exploratory', icon: 'cards' as const, disabled: u.purpose === 'PUBLICATION_GATING' && d.purpose !== 'REGRESSION' }))} onPick={(u) => void addToSuite(u)} button={<span className="ap-btn quiet"><Icon name="cards" size={13} /> Add to a suite</span>} />
          </> : null}
          <button type="button" className={`ap-btn quiet${panel === 'history' ? ' on' : ''}`} onClick={() => setPanel(panel === 'history' ? 'none' : 'history')} data-testid="ap-scn-history-toggle"><Icon name="history" size={13} /> History</button>
          {canEdit && d.state !== 'ARCHIVED' ? <button type="button" className="ap-iconbtn" aria-label="Archive this scenario" onClick={() => setPanel(panel === 'archive' ? 'none' : 'archive')} data-testid="ap-scn-archive"><Icon name="trash" size={14} /></button> : null}
        </div>
        {d.suite_list.length ? <p className="ap-quiet" data-testid="ap-scn-suites">In {d.suite_list.map((u, i) => <span key={u.id}>{i ? ', ' : ''}<Link to={`?view=suites&u=${u.id}`}>{u.name}</Link></span>)}</p> : null}
        {panel === 'history' ? <ol className="ap-lib-events" data-testid="ap-scn-history">{d.events.map((e) => <li key={e.seq} data-event={e.event}><strong>{e.event === 'CREATED' ? 'Created' : e.event === 'DRAFT_SAVED' ? 'Saved' : e.event === 'ARCHIVED' ? 'Archived' : 'Restored'} · revision {e.draft_revision}</strong> by {e.actor}<small>{when(e.occurred_at)}{e.comment ? ` · “${e.comment}”` : ''}{(e.detail.facts_changed as string[] | undefined)?.length ? ` · facts changed: ${(e.detail.facts_changed as string[]).map((c) => look.variable(c)?.name ?? c).join(', ')}` : ''}</small></li>)}</ol> : null}
        {panel === 'archive' ? <div className="ap-callout" data-testid="ap-scn-archive-panel"><div><strong>Archive “{d.name}”?</strong><p>It leaves the list and is kept with its history. It can be restored.</p><input className="ap-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (at least 10 characters)" aria-label="Reason" data-testid="ap-scn-archive-reason" /> <button type="button" className="ap-btn" disabled={reason.trim().length < 10} onClick={() => void archive()} data-testid="ap-scn-archive-ok">Archive</button></div></div> : null}

        <Dependencies deps={deps} diagnostics={insp.diagnostics as unknown as { severity: string; code: string; message: string }[]} reproducible={insp.reproducible} readOnly={readOnly} onAdopt={adopt} fingerprint={insp.scenario_fingerprint} />

        <div className="ap-scn-profiles"><span>Profiles</span>
          {work.doc.profiles.map((c) => <span key={c} className="ap-chip profile"><Icon name="profile" size={13} /> {data.profiles.find((p) => p.code === c)?.name ?? c}{!readOnly ? <button type="button" aria-label={`Remove the profile ${c}`} onClick={() => edit((w) => { w.doc.profiles = w.doc.profiles.filter((x) => x !== c); w.doc.pins = w.doc.pins.filter((p) => !(p.kind === 'PROFILE' && p.code === c)); })}><Icon name="x" size={11} /></button> : null}</span>)}
          {!work.doc.profiles.length ? <span className="ap-quiet">none — every fact is offered</span> : null}
          {!readOnly ? <Picker label="Add a profile" testid="ap-scn-profile" items={data.profiles.filter((p) => !work.doc.profiles.includes(p.code)).map((p) => ({ id: p.code, label: p.name, hint: p.description, icon: 'profile' }))} onPick={(c) => edit((w) => { w.doc.profiles.push(c); })} button={<span className="ap-linkbtn"><Icon name="plus" size={12} /> Add a profile</span>} /> : null}
        </div>
        <div className="ap-factbar" data-testid="ap-scn-factbar">
          <div className="ap-seg tight" role="radiogroup" aria-label="Which facts to show">
            <button type="button" role="radio" aria-checked={factScope === 'policy'} className={factScope === 'policy' ? 'on' : ''} onClick={() => setFactScope('policy')} data-testid="ap-scn-facts-policy">Facts this policy reads</button>
            <button type="button" role="radio" aria-checked={factScope === 'profile'} className={factScope === 'profile' ? 'on' : ''} onClick={() => setFactScope('profile')} data-testid="ap-scn-facts-all">All profile facts</button>
            {baseFacts ? <button type="button" role="radio" aria-checked={factScope === 'changed'} className={factScope === 'changed' ? 'on' : ''} onClick={() => setFactScope('changed')} data-testid="ap-scn-facts-changed">Changed from baseline</button> : null}
          </div>
          <label className="ap-searchbox"><Icon name="search" size={14} /><input value={factFind} onChange={(e) => setFactFind(e.target.value)} placeholder="Find a fact" aria-label="Find a fact" data-testid="ap-scn-facts-search" /></label>
          {baseFacts && !readOnly ? <button type="button" className="ap-btn quiet" onClick={() => edit((w) => { w.doc.facts = structuredClone(baseFacts); })} disabled={!changedFacts.length} data-testid="ap-scn-facts-reset"><Icon name="undo" size={13} /> Reset to baseline</button> : null}
          <span className="ap-count" data-testid="ap-scn-facts-count">{shown.length} of {every.length} facts</span>
        </div>
        {!shown.length ? <p className="ap-quiet">No fact matches.{factScope === 'policy' && !reads.length ? ' This policy reads no fact yet.' : ''}</p> : null}
        <fieldset className="ap-plainset" disabled={readOnly}><FactsEditor codes={shown} groups={groups} facts={work.doc.facts} states={plan?.facts} highlight={plan?.needs.map((n) => n.variable)} testid="ap-scn-facts" onChange={(f) => edit((w) => { w.doc.facts = f; })} /></fieldset>
      </div>

      <div className="ap-scn-result" data-testid="ap-scn-result" aria-live="polite" data-mode={row?.mode} data-policy-source={live.data?.policy_source} data-state={row?.state} data-reproducible={row ? String(row.reproducible) : ''}>
        <h2>What the policy selects</h2>
        <p className={`ap-evalsource is-${row?.reproducible ? 'saved' : 'preview'}`} data-testid="ap-scn-source">
          {!row ? 'Working it out…' : row.reproducible ? <><Icon name="check" size={13} /> Saved scenario (revision {d.draft_revision}) against saved policy revision {live.data?.policy_revision}. Reproducible.</>
            : <><Icon name="info" size={13} /> {row.mode === 'EXPLORATORY' ? 'Unsaved edit of this scenario' : `Saved scenario (revision ${d.draft_revision})`} against {live.data?.policy_source === 'PREVIEW' ? 'an unsaved edit of the policy' : `saved policy revision ${live.data?.policy_revision}`}. {row.mode === 'EXPLORATORY' || live.data?.policy_source === 'PREVIEW' ? 'Exploratory — not evidence.' : 'Not reproducible: it reads an unpublished definition.'}</>}
        </p>
        {row && row.state !== 'EVALUATED' ? <div className="ap-callout warn" data-testid="ap-scn-not-evaluated"><Icon name="warn" /><div><strong>{row.state === 'INVALID_DEFINITION' ? 'This scenario cannot be evaluated as it is defined' : 'This could not be evaluated'}</strong><p>{row.reason}</p></div></div>
          : <PlanView plan={live.isError ? ({ status: 'ERROR', error: { code: 'ERROR', message: why(live.error) }, requirements: [], selected: [], pending: [], excluded: [], needs: [], explanation: [], facts: {}, diagnostics: [] } as unknown as Plan) : plan} activeSurvey={activeSurvey}
              onSurvey={(c) => setActiveSurvey(activeSurvey === c ? null : c)} onNeed={(v) => { setFactScope('profile'); window.setTimeout(() => document.querySelector<HTMLElement>(`[data-testid="ap-scn-facts-${v}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60); }} testid="ap-scn-plan" />}
        {activeSurvey && plan ? <>
          <SurveyPath plan={plan} code={activeSurvey} />
          <p className="ap-scn-survey-acts">
            <button type="button" className="ap-btn" onClick={() => { const e = [...plan.selected, ...plan.pending].find((x) => x.survey.code === activeSurvey); if (e) setPreview(e.survey); }} data-testid="ap-scn-survey-preview"><Icon name="survey" size={13} /> Preview the published survey</button>
            {plan.requirements.filter((r) => r.surveys.some((s) => s.code === activeSurvey)).slice(0, 3).map((r) => <Link key={r.id} className="ap-linkbtn" to={`${BASE}/policies/${policy.code}?r=${r.id}`} data-testid={`ap-scn-open-requirement-${r.id}`}>Open “{r.name}” in the designer</Link>)}
          </p></> : plan?.selected.length || plan?.pending.length ? <p className="ap-quiet">Select a survey to see the path that selected it, and to preview it.</p> : null}
        {d.baseline ? (
          <section className="ap-variant" data-testid="ap-scn-variant-diff">
            <h3><Icon name="condition" size={14} /> Compared with “{d.baseline.name}”</h3>
            {!changedFacts.length ? <p className="ap-quiet">The same facts as its baseline so far. Change one to see what differs.</p> : (
              <ul className="ap-diff-facts" data-testid="ap-scn-variant-facts">{changedFacts.map((c) => <li key={c}><strong>{look.variable(c)?.name ?? c}</strong> <span className="was">{factWord(baseFacts![c], c in baseFacts!)}</span> <Icon name="arrow" size={12} /> <span className="now">{factWord(work.doc.facts[c], c in work.doc.facts)}</span></li>)}</ul>
            )}
            {baseRow?.plan && plan ? <p className="ap-diff-surveys" data-testid="ap-scn-variant-surveys">
              {!added.length && !removed.length && baseRow.plan.status === plan.status ? <span className="ap-quiet">Same surveys as the baseline.</span> : <>
                {added.map((c) => <span key={c} className="ap-chip survey is-added" data-change="added">+ {names.get(c) ?? c}</span>)}
                {removed.map((c) => <span key={c} className="ap-chip plain is-removed" data-change="removed">− {names.get(c) ?? c}</span>)}
                {baseRow.plan.status !== plan.status ? <span className="ap-chip plain">{baseRow.plan.status.toLowerCase().replace('_', ' ')} → {plan.status.toLowerCase().replace('_', ' ')}</span> : null}</>}
            </p> : null}
            {because.data?.comparison?.because.length ? <ul className="ap-diff-why" data-testid="ap-scn-variant-why">{because.data.comparison.because.map((b) => <li key={b.requirement}><Link to={`${BASE}/policies/${policy.code}?r=${b.requirement}`}>{b.text}</Link></li>)}</ul> : dirty && (added.length || removed.length) ? <p className="ap-quiet">Save to see which requirements are the reason.</p> : null}
          </section>
        ) : null}
        {d.variant_list.length ? <section className="ap-variant" data-testid="ap-scn-variants"><h3>Variants of this scenario</h3><ul className="ap-variant-list">{d.variant_list.map((v) => <li key={v.id}><button type="button" className="ap-linkbtn" onClick={() => onOpen(v.id)} data-testid={`ap-scn-variant-open-${v.code}`}>{v.name}</button></li>)}</ul></section> : null}
        {plan?.fingerprint ? <p className="ap-quiet ap-fp" data-testid="ap-scn-fingerprints">Result <code title={plan.fingerprint}>{short(plan.fingerprint)}</code> · scenario <code title={row?.scenario_fingerprint}>{short(row?.scenario_fingerprint)}</code> · policy <code title={live.data?.policy_fingerprint ?? ''}>{short(live.data?.policy_fingerprint)}</code></p> : null}
      </div>
    </div>
  );
}

function Dependencies({ deps, diagnostics, reproducible, readOnly, onAdopt, fingerprint }: { deps: Dep[]; diagnostics: { severity: string; code: string; message: string }[]; reproducible: boolean; readOnly: boolean; onAdopt: (d: Dep, to: { version?: number; draft_revision?: number }) => void; fingerprint: string }) {
  const [open, setOpen] = useState(false);
  const attention = deps.filter((d) => d.newer_version_no || d.stale || d.state === 'DRAFT');
  const invalid = diagnostics.filter((x) => x.code === 'FACT_INVALID' || x.code === 'DERIVED_FACT' || x.severity === 'BLOCKER');
  useEffect(() => { if (attention.some((d) => d.stale)) setOpen(true); }, [attention.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="ap-deps ap-scn-deps" data-testid="ap-scn-deps" data-reproducible={String(reproducible)} data-attention={attention.length}>
      <button type="button" className="ap-deps-head" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="ap-scn-deps-toggle"><Icon name={open ? 'down' : 'right'} size={13} /> <strong>Saved against</strong> <span>{deps.length} librar{deps.length === 1 ? 'y item' : 'y items'}, each at an exact version</span>
        {attention.some((d) => d.stale) ? <Tag tone="bad">a dependency changed</Tag> : attention.some((d) => d.state === 'DRAFT') ? <Tag tone="warn">reads a draft</Tag> : attention.length ? <Tag tone="info">{attention.length} newer version{attention.length === 1 ? '' : 's'}</Tag> : <Tag tone="published">exact and reproducible</Tag>}</button>
      {invalid.map((x, i) => <p key={i} className="ap-callout warn" data-testid="ap-scn-diagnostic" data-code={x.code}><Icon name="warn" /> <span>{x.message}</span></p>)}
      {open ? <>
        <ul className="ap-deps-list">{deps.map((d) => (
          <li key={`${d.kind}-${d.code}`} data-testid={`ap-scn-dep-${d.kind}-${d.code}`} data-state={d.stale ? 'stale' : d.state === 'DRAFT' ? 'draft' : d.newer_version_no ? 'newer' : 'exact'} data-pinned={d.state === 'PUBLISHED' ? d.version_no : `draft-${d.draft_revision}`}>
            <Icon name={d.kind === 'PROFILE' ? 'profile' : 'variable'} size={13} /> <strong>{d.name}</strong> <span className="ap-quiet">{d.kind === 'PROFILE' ? 'profile' : 'fact'}</span>
            <span className="ap-dep-at">{d.state === 'PUBLISHED' ? `version ${d.version_no}` : `draft revision ${d.draft_revision}`} · <code title={d.content_sha256}>{short(d.content_sha256)}</code></span>
            {d.stale ? <><Tag tone="bad">changed since saved</Tag>{!readOnly ? (d.current_draft_revision ? <button type="button" className="ap-btn" onClick={() => onAdopt(d, { draft_revision: d.current_draft_revision! })} data-testid={`ap-scn-dep-${d.kind}-${d.code}-accept`}>Accept draft revision {d.current_draft_revision}</button> : d.published_version_no ? <button type="button" className="ap-btn" onClick={() => onAdopt(d, { version: d.published_version_no })} data-testid={`ap-scn-dep-${d.kind}-${d.code}-accept`}>Use published version {d.published_version_no}</button> : null) : null}</>
              : d.state === 'DRAFT' ? <Tag tone="warn">unpublished draft</Tag>
                : d.newer_version_no ? <><Tag tone="info">version {d.newer_version_no} available</Tag>{!readOnly ? <button type="button" className="ap-btn" onClick={() => onAdopt(d, { version: d.newer_version_no })} data-testid={`ap-scn-dep-${d.kind}-${d.code}-adopt`}>Adopt version {d.newer_version_no}</button> : null}</> : <Tag tone="published">exact</Tag>}
          </li>
        ))}</ul>
        {!deps.length ? <p className="ap-quiet">No fact or profile yet.</p> : null}
        <p className="ap-quiet">Scenario fingerprint <code title={fingerprint} data-testid="ap-scn-deps-fingerprint">{short(fingerprint)}</code>. A newer published version never changes this scenario; adopting one is your decision and can be undone.</p>
      </> : null}
    </section>
  );
}

// --------------------------------------------------------------- saved scenarios, read-only, from the designer
/** APPL-X4a carry-forward (5.1): the designer can LOOK at what this policy selects for a saved scenario, without
    leaving the designer and without changing anything. The quick in-tab examples of the live preview are untouched.
    A saved scenario is evaluated exactly as saved; while the policy has unsaved edits the answer is a labelled preview. */
export function SavedScenariosInDesigner({ doc }: { doc: Policy }) {
  const { look, setPreview } = useAppl();
  const kept = savedPolicy(doc.code);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['x4-scenarios', kept?.id, '', '', 100, false], queryFn: () => listScenarios({ policy_id: kept!.id, limit: 100 }), enabled: !!kept });
  const unsaved = isUnsaved(doc);
  const policyDoc = unsaved ? toServer(doc) : null;
  const one = useQuery({ queryKey: ['x4-designer-eval', kept?.id, kept?.revision, policyDoc ? JSON.stringify(policyDoc) : null, open], enabled: !!kept && !!open, retry: false, placeholderData: (p) => p, queryFn: () => evaluateScenarios(kept!.id, [{ ref: 'saved', scenario_id: open! }], policyDoc) });
  const detail = useQuery({ queryKey: ['x4-scenario', open], queryFn: () => getScenario(open!), enabled: !!open });
  if (!kept) return null;
  const items = list.data?.items ?? [];
  const row = one.data?.results[0];
  const facts = ((detail.data?.document as { facts?: Facts } | undefined)?.facts ?? {}) as Facts;
  return (
    <>
      <Picker label="Look at a saved scenario" testid="ap-designer-saved" placeholder="Search saved scenarios…" items={items.map((x) => ({ id: x.id, label: x.name, hint: `${x.code} · ${x.purpose === 'REGRESSION' ? 'regression' : 'exploratory'}`, icon: 'scenario' as const }))} onPick={setOpen}
        button={<span className="ap-chip plain" data-testid="ap-designer-saved-count" data-count={list.data?.total ?? ''}><Icon name="scenario" size={13} /> Saved scenarios{list.data ? ` (${list.data.total})` : ''} <Icon name="down" size={11} /></span>}
        footer={() => <Link className="ap-linkbtn" to={`${BASE}/scenarios?policy=${doc.code}`} data-testid="ap-designer-saved-studio">Open the Scenario studio</Link>} />
      {open ? (
        <DrawerPanel title={detail.data?.name ?? 'Saved scenario'} subtitle="A saved synthetic scenario — read only here" onClose={() => setOpen(null)} testid="ap-designer-saved-drawer">
          <p className={`ap-evalsource is-${row?.reproducible ? 'saved' : 'preview'}`} data-testid="ap-designer-saved-source" data-policy-source={one.data?.policy_source ?? ''}>
            {!row ? 'Working it out…' : unsaved ? <><Icon name="info" size={13} /> Saved scenario against your UNSAVED edit of this policy — a preview, not evidence.</> : <><Icon name="check" size={13} /> Saved scenario (revision {detail.data?.draft_revision}) against saved policy revision {one.data?.policy_revision}.</>}
          </p>
          <ul className="ap-diff-facts" data-testid="ap-designer-saved-facts">{Object.entries(facts).map(([k, v]) => <li key={k}><strong>{look.variable(k)?.name ?? k}</strong> <span className="now">{factWord(v)}</span></li>)}</ul>
          {row && row.state !== 'EVALUATED' ? <p className="ap-callout warn">{row.reason}</p> : <PlanView plan={row?.plan ?? undefined} testid="ap-designer-saved-plan" onSurvey={(c) => { const e = [...(row?.plan?.selected ?? []), ...(row?.plan?.pending ?? [])].find((y) => y.survey.code === c); if (e) setPreview(e.survey); }} />}
          <p><Link className="ap-btn" to={`${BASE}/scenarios?policy=${doc.code}&s=${open}`} data-testid="ap-designer-saved-open"><Icon name="scenario" size={13} /> Open it in the Scenario studio</Link></p>
          <p className="ap-quiet">Nothing is changed or recorded by looking. To edit the scenario, or to record a run, use the Scenario studio.</p>
        </DrawerPanel>
      ) : null}
    </>
  );
}

