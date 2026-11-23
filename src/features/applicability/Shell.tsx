// Survey Applicability Studio (APPL-X1) — the workspace frame: one header, the five-step journey that is also the
// navigation, undo and redo, who you are acting as, and the command palette. PROTOTYPE: kept in this tab only.
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import '../../styles/applicability.css';
import { ConditionLabPage } from './ConditionLab';
import { DesignerPage } from './Designer';
import { ConditionDrawer, VariableDrawer } from './drawers';
import { GovernancePage } from './Governance';
import { OverviewPage } from './Overview';
import { ProfilesPage } from './Profiles';
import { ScenariosPage } from './Scenarios';
import { ApplicabilityProvider, PEOPLE, useAppl } from './store';
import { Icon, usePanelFocus, type IconName } from './ui';
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
  return <ApplicabilityProvider><Frame /></ApplicabilityProvider>;
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
  const step = STEPS.find((x) => pathname.startsWith(x.to) || x.also?.some((a) => pathname.startsWith(a)));
  return (
    <div className="ap" data-testid="applicability">
      <header className="ap-top">
        <div className="ap-top-row">
          <nav className="ap-crumbs" aria-label="Breadcrumb"><Link to="/survey-studio">Survey Studio</Link><Icon name="right" size={12} /><Link to={BASE} aria-current={pathname === BASE ? 'page' : undefined}>Survey applicability</Link>{step ? <><Icon name="right" size={12} /><span aria-current="page">{step.label}</span></> : null}</nav>
          <div className="ap-top-tools">
            <span className="ap-proto" data-testid="ap-prototype-note" title="A design prototype. What you make here lives in this browser tab and is lost when the page is reloaded. Nothing is saved to Call360 and nothing here assigns a survey to anyone."><Icon name="info" size={13} /> Prototype · nothing is saved</span>
            <button type="button" className="ap-iconbtn labelled" onClick={s.undo} disabled={!s.canUndo} title={s.lastChange ? `Undo: ${s.lastChange}` : 'Nothing to undo'} data-testid="ap-undo"><Icon name="undo" /> Undo</button>
            <button type="button" className="ap-iconbtn labelled" onClick={s.redo} disabled={!s.canRedo} title={s.nextChange ? `Redo: ${s.nextChange}` : 'Nothing to redo'} data-testid="ap-redo"><Icon name="redo" /> Redo</button>
            <PersonaSwitch />
            <button type="button" className="ap-search" onClick={() => s.setPalette(true)} data-testid="ap-palette-open"><Icon name="search" size={14} /> Search or jump to… <kbd>⌘K</kbd></button>
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
          <Route path="policies" element={<DesignerPage />} />
          <Route path="policies/:code" element={<DesignerPage />} />
          <Route path="scenarios" element={<ScenariosPage />} />
          <Route path="governance" element={<GovernancePage />} />
          <Route path="governance/:code" element={<GovernancePage />} />
          <Route path="*" element={<div className="ap-page"><p>That page does not exist. <Link to={BASE}>Back to the overview</Link></p></div>} />
        </Routes>
      </main>
      {s.drawer?.kind === 'variable' ? <VariableDrawer key={`v-${s.drawer.code ?? 'new'}`} /> : null}
      {s.drawer?.kind === 'condition' ? <ConditionDrawer key={`c-${s.drawer.code ?? 'new'}`} /> : null}
      {s.palette ? <CommandPalette /> : null}
      <div className="ap-toasts" role="status" aria-live="polite">{s.toasts.map((t) => <div key={t.id} className={`ap-toast ${t.tone}`} data-testid="ap-toast"><Icon name={t.tone === 'warn' ? 'warn' : t.tone === 'info' ? 'info' : 'check'} size={14} /> {t.text}</div>)}</div>
    </div>
  );
}

function PersonaSwitch() {
  const { persona, setPersona } = useAppl();
  const [open, setOpen] = useState(false);
  const me = PEOPLE[persona];
  return (
    <div className="ap-persona">
      <button type="button" className="ap-persona-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="ap-persona" data-persona={persona}><Icon name="user" size={14} /> Acting as <strong>{me.name}</strong> · {me.role} <Icon name="down" size={11} /></button>
      {open ? (
        <div className="ap-pop right" role="menu">
          <p className="ap-pop-note">In this prototype you can step into each of the three people a policy needs. In Call360 these are three different sign-ins and the server enforces it.</p>
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
  const policy = s.data.policies[0];
  const cmds = useMemo<Cmd[]>(() => {
    const p = policy?.code;
    const act: Cmd[] = [
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
