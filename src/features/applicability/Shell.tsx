// Survey Applicability Studio (APPL-X1) — the workspace frame: one header, the five-step journey that is also the
// navigation, undo and redo, who you are acting as, and the command palette. PROTOTYPE: kept in this tab only.
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import '../../styles/applicability.css';
import { ConditionLabPage } from './ConditionLab';
import { DesignerPage } from './Designer';
import { ConditionDrawer, VariableDrawer } from './drawers';
import { GovernancePage } from './Governance';
import { LibraryProvider, libraryOn, useLibrary } from './library';
import type { CatalogueState } from './surveys';
import { OverviewPage } from './Overview';
import { PoliciesPage } from './Policies';
import { PoliciesProvider, usePolicies } from './policyService';
import { useAuth } from '../../auth/AuthContext';
import { ProfilesPage } from './Profiles';
import { ScenariosPage } from './Scenarios';
import { ScenarioStudioPage } from './ScenarioStudio';
import { applicabilityScenarios } from './flag';
import { SurveyPreview } from './SurveyPreview';
import { usePublishedSurveys } from './surveys';
import { ApplicabilityProvider, PEOPLE, useAppl } from './store';
import { Icon, Picker, usePanelFocus, type IconName } from './ui';
import { BASE } from './usage';
import { VariablesPage } from './Variables';
import type { Persona } from './model/types';

const STEPS: { n: number; label: string; hint: string; to: string; also?: string[]; sub?: { label: string; to: string }[] }[] = [
  { n: 1, label: 'Define facts', hint: 'Variables and profiles', to: `${BASE}/variables`, also: [`${BASE}/profiles`], sub: [{ label: 'Variable library', to: `${BASE}/variables` }, { label: 'Application profiles', to: `${BASE}/profiles` }] },
  { n: 2, label: 'Build conditions', hint: 'Condition lab', to: `${BASE}/conditions` },
  { n: 3, label: 'Connect surveys', hint: 'Applicability designer', to: `${BASE}/policies` },
  { n: 4, label: 'Test scenarios', hint: 'Scenario and test lab', to: `${BASE}/scenarios` },
  { n: 5, label: 'Approve and publish', hint: 'Governance and impact', to: `${BASE}/governance` },
];

export function ApplicabilityRoot() {
  return <ApplicabilityProvider><LibraryProvider><PoliciesProvider><Frame /></PoliciesProvider></LibraryProvider></ApplicabilityProvider>;
}

function Frame() {
  const s = useAppl();
  const { pathname } = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); s.setPalette(true); }
      else if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);
  const catalogue = usePublishedSurveys(s.adoptCatalogue);
  const step = STEPS.find((x) => pathname.startsWith(x.to) || x.also?.some((a) => pathname.startsWith(a)));
  return (
    <div className="ap" data-testid="applicability">
      <header className="ap-top">
        <div className="ap-top-row">
          <PolicySwitch />
          <div className="ap-top-tools">
            <Kept catalogue={catalogue} />
            <span className="ap-undoredo">
              <button type="button" className="ap-iconbtn" onClick={s.undo} disabled={!s.canUndo} aria-label="Undo" title={s.lastChange ? `Undo: ${s.lastChange}` : 'Nothing to undo'} data-testid="ap-undo"><Icon name="undo" /></button>
              <button type="button" className="ap-iconbtn" onClick={s.redo} disabled={!s.canRedo} aria-label="Redo" title={s.nextChange ? `Redo: ${s.nextChange}` : 'Nothing to redo'} data-testid="ap-redo"><Icon name="redo" /></button>
            </span>
            <WhoIsActing />
            <button type="button" className="ap-search" onClick={() => s.setPalette(true)} data-testid="ap-palette-open" title="Search or jump to anything"><Icon name="search" size={14} /> Search <kbd>⌘K</kbd></button>
          </div>
        </div>
        <nav className="ap-journey" aria-label="Survey applicability">
          <NavLink to={BASE} end className={({ isActive }) => `ap-journey-home${isActive ? ' on' : ''}`} data-testid="ap-nav-overview"><Icon name="cards" size={14} /> Overview</NavLink>
          <ol>
            {STEPS.map((x) => {
              const on = x === step;
              return <li key={x.n} className={on ? 'on' : ''}><Link to={x.to} aria-current={on ? 'step' : undefined} data-testid={`ap-nav-${x.n}`}><span className="ap-journey-n">{x.n}</span><span><strong>{x.label}</strong><small>{x.hint}</small></span></Link></li>;
            })}
          </ol>
        </nav>
        {step?.sub ? <div className="ap-subnav" role="tablist" aria-label={step.label}>{step.sub.map((t) => <NavLink key={t.to} to={t.to} role="tab" className={({ isActive }) => (isActive ? 'on' : '')}>{t.label}</NavLink>)}</div> : null}
      </header>
      <main className="ap-main">
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="variables" element={<VariablesPage />} />
          <Route path="profiles" element={<ProfilesPage />} />
          <Route path="conditions" element={<ConditionLabPage />} />
          <Route path="policies" element={<PoliciesPage />} />
          <Route path="policies/:code" element={<DesignerPage />} />
          <Route path="scenarios" element={applicabilityScenarios() ? <ScenarioStudioPage /> : <ScenariosPage />} />
          <Route path="governance" element={<GovernancePage />} />
          <Route path="governance/:code" element={<GovernancePage />} />
          <Route path="*" element={<div className="ap-page"><p>That page does not exist. <Link to={BASE}>Back to the overview</Link></p></div>} />
        </Routes>
      </main>
      {s.drawer?.kind === 'variable' ? <VariableDrawer key={`v-${s.drawer.code ?? 'new'}`} /> : null}
      {s.drawer?.kind === 'condition' ? <ConditionDrawer key={`c-${s.drawer.code ?? 'new'}`} /> : null}
      {s.preview ? <SurveyPreview /> : null}
      {s.palette ? <CommandPalette /> : null}
      <div className="ap-toasts" role="status" aria-live="polite">{s.toasts.map((t) => <div key={t.id} className={`ap-toast ${t.tone}`} data-testid="ap-toast"><Icon name={t.tone === 'warn' ? 'warn' : t.tone === 'info' ? 'info' : 'check'} size={14} /> {t.text}</div>)}</div>
    </div>
  );
}

/** One quiet control that says where each kind of thing is kept — instead of a row of status chips. */
function Kept({ catalogue }: { catalogue: CatalogueState & { reload: () => void } }) {
  const lib = useLibrary();
  const pol = usePolicies();
  const { data } = useAppl();
  const [open, setOpen] = useState(false);
  const pending = lib.unsaved + (pol.on ? pol.unsaved : 0);
  const label = !lib.on ? 'Prototype · nothing is saved' : pol.on && lib.status === 'ready' ? (pending ? `${pending} unsaved` : 'All saved') : lib.status === 'ready' ? (lib.unsaved ? `Library: ${lib.unsaved} unsaved` : 'Library saved') : lib.status === 'loading' ? 'Reading the library…' : lib.status === 'forbidden' ? 'Library: no access' : 'Library could not be read';
  return (
    <span className={`ap-kept is-${lib.on ? lib.status : 'off'}${lib.unsaved || (pol.on && pol.unsaved) ? ' has-unsaved' : ''}`} data-testid="ap-catalogue" data-policies={pol.on ? pol.status : 'off'} data-status={catalogue.status} data-count={catalogue.surveys.length} data-library={lib.on ? lib.status : 'off'} data-unsaved={lib.unsaved}>
      <button type="button" className="ap-kept-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} data-testid="ap-prototype-note"><Icon name={lib.on && lib.status === 'ready' && !lib.unsaved && !(pol.on && pol.unsaved) ? 'check' : 'info'} size={13} /> {label} <Icon name="down" size={11} /></button>
      {open ? (
        <div className="ap-pop right ap-kept-pop" role="dialog" aria-label="Where things are kept" data-testid="ap-kept-pop">
          <dl>
            <dt><Icon name="variable" size={13} /> Variables, profiles, conditions</dt>
            <dd data-testid="ap-kept-library">{lib.on ? (lib.status === 'ready' ? <><strong>Saved in Call360.</strong> {data.variables.length + data.profiles.length + data.conditions.length} items; publishing needs three different people.{lib.unsaved ? ` ${lib.unsaved} changed in this tab and not saved yet.` : ''}</> : lib.status === 'forbidden' ? 'You are not permitted to read the saved library.' : lib.status === 'loading' ? 'Reading…' : `Could not be read${lib.reason ? `: ${lib.reason}` : ''}.`) : <><strong>In this tab only.</strong> A synthetic example; lost when the page is reloaded.</>}</dd>
            <dt><Icon name="policy" size={13} /> Applicability policies</dt>
            <dd data-testid="ap-kept-policies">{pol.on ? (pol.status === 'ready' ? <><strong>Saved in Call360 as working drafts.</strong> {data.policies.length} polic{data.policies.length === 1 ? 'y' : 'ies'}.{pol.unsaved ? ` ${pol.unsaved} with changes in this tab not saved yet.` : ''} Publication is not available yet.</> : pol.status === 'forbidden' ? 'You are not permitted to read saved policies.' : pol.status === 'loading' ? 'Reading…' : `Could not be read${pol.reason ? `: ${pol.reason}` : ''}.`) : <><strong>In this tab only.</strong> Not saved in Call360 yet: they are lost when the page is reloaded, and their approval is simulated.</>}</dd>
            <dt><Icon name="scenario" size={13} /> Synthetic scenarios</dt>
            <dd data-testid="ap-kept-scenarios">{applicabilityScenarios() ? <><strong>Saved in Call360.</strong> Scenarios, regression suites and recorded runs, in the Scenario studio. The quick examples of the designer’s live preview stay in this tab.</> : <><strong>In this tab only.</strong> Lost when the page is reloaded; saved scenarios arrive with policy publication.</>}</dd>
            <dt><Icon name="survey" size={13} /> Surveys</dt>
            <dd data-testid="ap-kept-surveys">{catalogue.status === 'loading' ? 'Reading Survey Studio…' : catalogue.status === 'unavailable' ? 'Survey Studio could not be read.' : <><strong>{catalogue.surveys.length} published versions</strong> read from Survey Studio. Nothing is invented here.</>}</dd>
          </dl>
          <button type="button" className="ap-btn quiet" onClick={() => { catalogue.reload(); void lib.refresh(); void pol.refresh(); }} data-testid="ap-kept-refresh"><Icon name="history" size={13} /> Read again from Call360</button>
          <p className="ap-pop-note">Nothing here assigns a survey to a case or permits a call.</p>
        </div>
      ) : null}
    </span>
  );
}

/** Which policy the workspace is about, and the way to the others. */
function PolicySwitch() {
  const { data, current, setCurrent } = useAppl();
  const pol = usePolicies();
  const go = useNavigate();
  const p = current ? current.draft ?? current.published : null;
  return (
    <div className="ap-policyswitch">
      <Picker label="Switch policy" testid="ap-policy-switch" placeholder="Search policies…" items={data.policies.map((r) => ({ id: r.code, label: (r.draft ?? r.published)!.name, hint: `${(r.draft ?? r.published)!.requirements.length} requirements · ${pol.on ? (r.unsaved ? 'unsaved changes' : 'saved draft') : r.draft ? 'draft in this tab' : 'published example (simulated)'}`, icon: 'policy' as const }))} onPick={(code) => { setCurrent(code); go(`${BASE}/policies/${code}`); }}
        button={<span className="ap-policyswitch-btn"><Icon name="policy" size={15} /><span><small>Policy</small><strong data-testid="ap-current-policy">{p?.name ?? 'None'}</strong></span><Icon name="down" size={12} /></span>}
        footer={(close) => <Link className="ap-pop-create" to={`${BASE}/policies`} onClick={close}><Icon name="cards" size={13} /> All policies — create, duplicate, compare</Link>} />
      {current ? <span className={`ap-policystate is-${current.candidate ? 'review' : current.draft ? (current.unsaved ? 'unsaved' : 'draft') : 'published'}`} data-testid="ap-policy-kept" title={pol.on ? 'This policy is saved in Call360 as a working draft. Publication of policies is not available yet.' : 'Applicability policies are not saved in Call360 yet: this one lives in this browser tab and is lost when the page is reloaded.'}>{pol.on ? (current.unsaved ? 'Draft · unsaved changes' : 'Draft · saved in Call360') : `${current.candidate ? 'In review (simulated)' : current.draft ? `Draft v${current.draft.version}` : `Published example v${current.published?.version}`} · in this tab only`}</span> : null}
    </div>
  );
}

/** With saved policies there is no simulated person: what is done is done by the signed-in person, and says so.
    The persona switch remains only where a policy's approval is still simulated in the tab. */
function WhoIsActing() {
  const pol = usePolicies();
  const { me, can } = useAuth();
  if (!pol.on) return <PersonaSwitch />;
  const may = [can('applicability.edit') && 'edit', can('applicability.approve') && 'approve library items', can('applicability.publish') && 'publish library items'].filter(Boolean).join(', ') || 'read only';
  return <span className="ap-signedin" data-testid="ap-signed-in" title={`Everything here is done as you, the signed-in person. You may: ${may}.`}><span className="ap-avatar small">{(me?.principal.display_name ?? '?')[0]}</span> <strong>{me?.principal.display_name}</strong></span>;
}

function PersonaSwitch() {
  const { persona, setPersona } = useAppl();
  const [open, setOpen] = useState(false);
  const me = PEOPLE[persona];
  return (
    <div className="ap-persona">
      <button type="button" className="ap-persona-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="ap-persona" data-persona={persona} title="Who you are acting as for applicability POLICIES, whose approval is simulated in this prototype"><span className="ap-avatar small">{me.name[0]}</span> <strong>{me.name}</strong> · {me.role} <Icon name="down" size={11} /></button>
      {open ? (
        <div className="ap-pop right" role="menu">
          <p className="ap-pop-note">For applicability policies only: step into each of the three people a policy needs. Their approval is simulated here.{libraryOn() ? ' Variables, profiles and conditions use your real sign-in, and the server enforces three different people.' : ''}</p>
          {(Object.keys(PEOPLE) as Persona[]).map((p) => <button key={p} type="button" role="menuitemradio" aria-checked={p === persona} className={`ap-persona-opt${p === persona ? ' at' : ''}`} data-testid={`ap-persona-${p}`} onClick={() => { setPersona(p); setOpen(false); }}><span className="ap-avatar">{PEOPLE[p].name[0]}</span><span className="ap-pop-text"><strong>{PEOPLE[p].name} · {PEOPLE[p].role}</strong><small>{PEOPLE[p].can}</small></span></button>)}
        </div>
      ) : null}
    </div>
  );
}

interface Cmd { id: string; label: string; hint: string; icon: IconName; group: string; run: () => void }
function CommandPalette() {
  const s = useAppl();
  const go = useNavigate();
  const close = () => s.setPalette(false);
  const ref = usePanelFocus(true, close);
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const policy = s.current;
  const cmds = useMemo<Cmd[]>(() => {
    const p = policy?.code;
    const act: Cmd[] = [
      { id: 'gallery', label: 'All policies', hint: 'Create, duplicate, compare', icon: 'cards', group: 'Do', run: () => go(`${BASE}/policies`) },
      { id: 'add-req', label: 'Add a requirement', hint: 'Applicability designer', icon: 'plus', group: 'Do', run: () => go(`${BASE}/policies/${p}?add=1`) },
      { id: 'new-var', label: 'Create a variable', hint: 'Variable library', icon: 'variable', group: 'Do', run: () => s.openDrawer({ kind: 'variable' }) },
      { id: 'new-cond', label: 'Create a condition', hint: 'Condition lab', icon: 'condition', group: 'Do', run: () => s.openDrawer({ kind: 'condition' }) },
      { id: 'run', label: 'Run a scenario', hint: 'Scenario and test lab', icon: 'play', group: 'Do', run: () => go(`${BASE}/scenarios`) },
      { id: 'new-sc', label: 'Create a scenario', hint: 'Scenario and test lab', icon: 'scenario', group: 'Do', run: () => go(`${BASE}/scenarios?new=1`) },
      { id: 'validate', label: 'Open validation', hint: 'Governance and impact', icon: 'warn', group: 'Do', run: () => go(`${BASE}/governance/${p}?tab=validation`) },
      { id: 'compare', label: 'Compare draft with published', hint: 'What changes for every saved scenario', icon: 'replace', group: 'Do', run: () => go(`${BASE}/scenarios?tab=impact`) },
      { id: 'matrix', label: 'Open the decision matrix', hint: 'Applicability designer', icon: 'table', group: 'Do', run: () => go(`${BASE}/policies/${p}?view=matrix`) },
      { id: 'canvas', label: 'Open the logic canvas', hint: 'Applicability designer', icon: 'canvas', group: 'Do', run: () => go(`${BASE}/policies/${p}?view=canvas`) },
      { id: 'undo', label: 'Undo', hint: s.lastChange ?? 'Nothing to undo', icon: 'undo', group: 'Do', run: s.undo },
    ];
    const find: Cmd[] = [
      ...s.data.policies.map((x) => ({ id: `pol-${x.code}`, label: (x.draft ?? x.published)!.name, hint: 'Applicability policy', icon: 'policy' as const, group: 'Policies', run: () => { s.setCurrent(x.code); go(`${BASE}/policies/${x.code}`); } })),
      ...s.data.surveys.map((x) => ({ id: `s-${x.code}`, label: x.name, hint: `Survey · focus the canvas on it`, icon: 'survey' as const, group: 'Surveys', run: () => go(`${BASE}/policies/${p}?view=canvas&focus=${x.code}`) })),
      ...s.data.conditions.map((x) => ({ id: `c-${x.code}`, label: x.name, hint: 'Saved condition', icon: 'condition' as const, group: 'Conditions', run: () => go(`${BASE}/conditions?c=${x.code}`) })),
      ...s.data.variables.map((x) => ({ id: `v-${x.code}`, label: x.name, hint: `Variable · ${x.category}`, icon: 'variable' as const, group: 'Variables', run: () => go(`${BASE}/variables?v=${x.code}`) })),
      ...s.data.profiles.map((x) => ({ id: `p-${x.code}`, label: x.name, hint: 'Application profile', icon: 'profile' as const, group: 'Profiles', run: () => go(`${BASE}/profiles?p=${x.code}`) })),
      ...s.data.scenarios.map((x) => ({ id: `sc-${x.id}`, label: x.name, hint: 'Scenario', icon: 'scenario' as const, group: 'Scenarios', run: () => go(`${BASE}/scenarios?s=${x.id}`) })),
    ];
    return [...act, ...find];
  }, [s, go, policy]);
  const match = (text: string) => { const k = text.trim().toLowerCase(); return (k ? cmds.filter((c) => `${c.label} ${c.hint} ${c.group}`.toLowerCase().includes(k)) : cmds.filter((c) => c.group === 'Do')).slice(0, 14); };
  const shown = match(q);
  useEffect(() => setAt(0), [q]);
  const run = (c?: Cmd) => { if (!c) return; close(); c.run(); };
  let group = '';
  return (
    <div className="ap-scrim top" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={ref} className="ap-cmd" role="dialog" aria-modal="true" aria-label="Search or jump to" data-testid="ap-palette">
        <div className="ap-pop-search"><Icon name="search" size={16} /><input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a survey, a condition, a variable — or type what you want to do" aria-label="Search" data-testid="ap-palette-input"
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => Math.min(n + 1, shown.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => Math.max(n - 1, 0)); } else if (e.key === 'Enter') { e.preventDefault(); const now = match(e.currentTarget.value); run(now[e.currentTarget.value === q ? at : 0]); } }} /></div>
        <ul role="listbox" aria-label="Results">
          {shown.map((c, n) => { const head = c.group !== group ? (group = c.group) : null; return (
            <li key={c.id} role="presentation">{head ? <div className="ap-pop-group">{head}</div> : null}
              <button type="button" role="option" aria-selected={n === at} className={n === at ? 'at' : ''} onMouseEnter={() => setAt(n)} onClick={() => run(c)} data-testid={`ap-cmd-${c.id}`}><span className="ap-pop-icon"><Icon name={c.icon} size={14} /></span><span className="ap-pop-text"><strong>{c.label}</strong><small>{c.hint}</small></span></button></li>
          ); })}
          {!shown.length ? <li className="ap-pop-none">Nothing matches “{q}”.</li> : null}
        </ul>
        <div className="ap-cmd-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
      </div>
    </div>
  );
}
