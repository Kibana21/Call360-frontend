// Survey Studio (UX-HOME-1) — the workspace: the first screen of Survey Studio in persisted mode.
// It makes visible what Survey Studio already holds — surveys, and the reusable published blocks they are built from
// (modules, questions, conditions, answer sets) — with search across all of them, live counts, what was touched last,
// what awaits the signed-in person, and the ways on to assignment, controls, journeys and rules. Every number is
// counted by the server from the records as they stand. Nothing here is an estimate, a score or a usage statistic,
// and a section whose data is not available says so instead of showing a placeholder.
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { hasPersistedMemory } from '../store';
import { Glyph, Tag, type GlyphName } from '../ui';
import { listSurveys, type Component, type ComponentKind, type SurveySummary } from './api';
import { InspectorDrawer, inspectParam, parseInspect, type Inspect } from './Inspector';
import { STANDING_NOTE } from './standing';
import { SurveyOverviewDrawer } from './SurveyOverview';
import { MODULE_CATEGORY, allComponents, answerOf, assignmentPolicy, controlMappings, controlPolicies, getWorkspace, missing, requirementGroups, words, type Maybe, type WorkspaceSummary } from './workspaceApi';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- the summary's lists are read as JSON
type Tab = 'MODULE' | 'ITEM' | 'CONDITION' | 'OPTION_SET';
const TABS: Array<{ kind: Tab; label: string; one: string; glyph: GlyphName; blurb: string }> = [
  { kind: 'MODULE', label: 'Modules', one: 'module', glyph: 'flow', blurb: 'A run of questions and branches that does one job. Surveys are assembled from them.' },
  { kind: 'ITEM', label: 'Questions', one: 'question', glyph: 'text', blurb: 'One exact wording with its kind of answer. Statements are here too.' },
  { kind: 'CONDITION', label: 'Conditions', one: 'condition', glyph: 'branch', blurb: 'A reusable rule over customer or policy information that decides a branch.' },
  { kind: 'OPTION_SET', label: 'Answer sets', one: 'answer set', glyph: 'list', blurb: 'A list of answers that questions can share.' },
];
const say = (e: unknown) => (e instanceof ApiFailure ? (e.status === 403 ? 'You do not have permission for this.' : e.message) : 'The server could not be reached.');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : m < 10080 ? `${Math.round(m / 1440)} d ago` : new Date(iso).toLocaleDateString();
};
const hit = (q: string, ...texts: Array<string | null | undefined>) => texts.some((t) => (t ?? '').toLowerCase().includes(q));

/** The block strip: one small tile per question, statement and decision of a published module, and its endings.
    Drawn from the counts the library publishes for the module — a picture of what is in it, not decoration. */
function BlockStrip({ facts }: { facts: Any }) {
  const tiles: Array<[string, number]> = [['question', facts.questions ?? 0], ['statement', facts.statements ?? 0], ['decision', facts.decisions ?? 0]];
  const shown = 14;
  const all = tiles.flatMap(([k, n]) => Array.from({ length: n }, () => k));
  return (
    <span className="ss-ws-strip" aria-hidden="true">
      {all.slice(0, shown).map((k, i) => <i key={i} className={k} />)}
      {all.length > shown ? <b>+{all.length - shown}</b> : null}
      <em />
      {((facts.outcomes ?? []) as string[]).map((o) => <i key={o} className={`end ${o === 'COMPLETED' ? 'ok' : ''}`} title={`Ends: ${words(o)}`} />)}
    </span>
  );
}

function BlockCard({ c, onInspect }: { c: Component; onInspect: (c: Inspect) => void }) {
  const facts = c.facts as Any;
  const kind = c.kind as ComponentKind;
  const open = () => onInspect({ kind, code: c.code, version: c.version, wording: c.wording_version ?? null });
  const a = kind === 'ITEM' ? answerOf(facts.answer_type) : null;
  return (
    <li className={`ss-ws-card block ${kind.toLowerCase()}`}>
      <button type="button" onClick={open} data-testid={`ss-ws-block-${kind}-${c.code}-${c.version}`} data-kind={kind} data-code={c.code} aria-label={`Inspect ${c.title}`}>
        <span className="ss-ws-card-top">
          <span className="ss-ws-card-kind">{kind === 'MODULE' ? (MODULE_CATEGORY[c.category] ?? words(c.category)) : kind === 'ITEM' ? <><Glyph name={a!.glyph} size={13} /> {a!.label}</> : kind === 'CONDITION' ? 'Condition' : plural(facts.options ?? 0, 'answer')}</span>
          {c.used_by.surveys > 1 ? <Tag tone="shared">Reused · {c.used_by.surveys} surveys</Tag> : null}
        </span>
        <strong className="ss-ws-card-title">{kind === 'ITEM' ? `“${c.title}”` : c.title}</strong>
        {kind === 'MODULE' ? <BlockStrip facts={facts} /> : null}
        {c.description ? <span className="ss-ws-card-text">{c.description}</span> : kind === 'CONDITION' ? <span className="ss-ws-card-text">Reads {((facts.fields ?? []) as string[]).join(', ') || 'no customer or policy information'}</span> : null}
        <span className="ss-ws-card-foot">
          <span>{kind === 'MODULE' ? `${plural(facts.questions ?? 0, 'question')} · ${facts.branching ? 'branches' : 'no branching'} · ${plural(((facts.outcomes ?? []) as string[]).length, 'ending')}` : `In ${c.published_in.map((s) => s.survey_name).slice(0, 1).join('')}${c.published_in.length > 1 ? ` +${c.published_in.length - 1}` : ''}`}</span>
          <span className="ss-ws-card-version">Published · {kind === 'MODULE' ? 'revision' : 'version'} {c.version}{c.is_latest ? '' : ' · older'}</span>
        </span>
      </button>
    </li>
  );
}

function SurveyCard({ s, facts, onOpen }: { s: SurveySummary; facts?: Any; onOpen: (code: string) => void }) {
  const review = s.open_candidate_status ? words(s.open_candidate_status) : null;
  return (
    <li className="ss-ws-card survey" data-status={s.open_candidate_status ?? (s.latest_version_label ? 'PUBLISHED' : 'DRAFT')}>
      <button type="button" onClick={() => onOpen(s.code)} data-testid={`ss-ws-survey-${s.code}`} aria-label={`Overview of ${s.name}`}>
        <span className="ss-ws-card-top">
          <span className="ss-ws-card-kind">{s.market_code} · Survey</span>
          {review ? <Tag tone="warn">{review}</Tag> : s.latest_version_label ? <Tag tone="ok">Published · {s.latest_version_label}</Tag> : <Tag tone="draft">Draft only</Tag>}
        </span>
        <strong className="ss-ws-card-title">{s.name}</strong>
        {s.purpose ? <span className="ss-ws-card-text">{s.purpose}</span> : null}
        {facts ? <span className="ss-ws-card-facts">{plural(facts.modules, 'module')} · {plural(facts.questions, 'question')}{facts.branching ? ' · branches' : ' · no branching'}</span> : null}
        <span className="ss-ws-card-foot">
          <span>Draft revision {s.draft_revision}{facts?.saved_at ? ` · saved ${ago(facts.saved_at)}` : ''}</span>
          {hasPersistedMemory(s.code) ? <Tag tone="draft">Open in this tab</Tag> : null}
        </span>
      </button>
    </li>
  );
}

function SurveyRow({ s, saved, onOverview }: { s: SurveySummary; saved?: string; onOverview: (code: string) => void }) {
  const review = s.open_candidate_status ? words(s.open_candidate_status) : null;
  return (
    <li data-testid={`ss-survey-${s.code}`} data-status={s.open_candidate_status ?? (s.latest_version_label ? 'PUBLISHED' : 'DRAFT')}>
      <Link to={`/survey-studio/surveys/${s.code}`} data-testid={`ss-open-${s.code}`}>
        <span className="ss-ws-row-main"><strong>{s.name}</strong><small>Revision {s.draft_revision}{s.latest_version_label ? ` · Version ${s.latest_version_label} published` : ' · never published'}{saved ? ` · saved ${ago(saved)}` : ''}</small></span>
        {hasPersistedMemory(s.code) ? <Tag tone="draft">Open in this tab</Tag> : null}
        {review ? <Tag tone="warn">{review}</Tag> : s.latest_version_label ? <Tag tone="ok">Published</Tag> : <Tag tone="draft">Draft only</Tag>}
        <Glyph name="right" size={14} />
      </Link>
      <button type="button" className="ss-btn small" onClick={() => onOverview(s.code)} data-testid={`ss-ws-overview-${s.code}`} aria-label={`Overview of ${s.name}`}>Overview</button>
    </li>
  );
}

/** Where each kind of building block is made. Blocks are not created on their own: each is authored inside a survey,
    with the existing composer and module builder, and becomes reusable when that survey is published. This panel says
    so and opens the survey to make it in. It creates nothing itself. */
const MAKE: Record<Tab, { where: string; steps: string[] }> = {
  MODULE: { where: 'in a survey’s composer', steps: ['Open the survey you are building (or start a new one).', 'In the composer, choose “New module”, or “Add a module here” between two modules.', 'Name it and build its questions and branches in the module builder.'] },
  ITEM: { where: 'inside a module, in the module builder', steps: ['Open the survey, then open the module the question belongs to.', 'Add a question (or a statement) as a step, and write its exact wording and the kind of answer.', 'Set where each answer leads.'] },
  CONDITION: { where: 'inside a module or on a module’s entry, where a decision is needed', steps: ['Open the survey, then the module that needs a decision — or the module’s entry rule in the composer.', 'Add a decision and write its condition: what it reads and the value it compares with.', 'Say what happens when it is met, not met, and cannot be decided.'] },
  OPTION_SET: { where: 'with a question, in the module builder', steps: ['Open the survey and the module, and add or open a question that has a list of answers.', 'Write its answers. That list is the question’s answer set.', 'Another question can then use the same published set from the library.'] },
};
function MakeBlock({ kind, surveys, canEdit, onKind, onClose, onNewSurvey }: { kind: Tab; surveys: SurveySummary[]; canEdit: boolean; onKind: (k: Tab) => void; onClose: () => void; onNewSurvey: () => void }) {
  const t = TABS.find((x) => x.kind === kind)!;
  const open = surveys.filter((s) => !s.open_candidate_status);
  return (
    <section className="ss-ws-make" aria-labelledby="ss-ws-make-h" data-testid="ss-ws-make" data-kind={kind}>
      <header><h2 id="ss-ws-make-h">Create a building block</h2><button type="button" className="ss-icon-btn" onClick={onClose} aria-label="Close" data-testid="ss-ws-make-close"><Glyph name="close" /></button></header>
      <div className="ss-ws-tabs" role="tablist" aria-label="Kind of building block to create">{TABS.map((x) => <button key={x.kind} type="button" role="tab" aria-selected={kind === x.kind} className={kind === x.kind ? 'on' : ''} onClick={() => onKind(x.kind)} data-testid={`ss-ws-make-${x.kind}`}><Glyph name={x.glyph} size={15} /> {x.one[0]!.toUpperCase() + x.one.slice(1)}</button>)}</div>
      <div className="ss-ws-make-cols">
        <div>
          <p className="ss-ws-make-lede">A {t.one} is made <strong>{MAKE[kind].where}</strong>. It is not created on its own: it is built as part of a survey, and becomes a reusable building block here once that survey is published.</p>
          <ol className="ss-ws-make-steps">{MAKE[kind].steps.map((x) => <li key={x}>{x}</li>)}</ol>
        </div>
        <div>
          <h3>Choose the survey to make it in</h3>
          {!canEdit ? <p className="ss-ws-quiet">Creating needs the “edit surveys” permission, which you do not hold.</p>
            : (<>
              {open.length ? <ul className="ss-ws-rows">{open.slice(0, 6).map((s) => <li key={s.id}><Link to={`/survey-studio/surveys/${s.code}`} data-testid={`ss-ws-make-in-${s.code}`}><span className="ss-ws-row-main"><strong>{s.name}</strong><small>Draft revision {s.draft_revision}</small></span><span className="ss-btn small">Open its composer</span></Link></li>)}</ul> : <p className="ss-ws-quiet">No survey is open for editing.</p>}
              <p className="ss-ws-hint">{open.length > 6 ? `${open.length - 6} more are under Surveys. ` : ''}<button type="button" className="ss-link" onClick={onNewSurvey} data-testid="ss-ws-make-new-survey">Or start a new survey</button></p>
            </>)}
        </div>
      </div>
    </section>
  );
}

function Panel({ title, hint, children, testid, action }: { title: string; hint?: string; children: ReactNode; testid: string; action?: ReactNode }) {
  return (
    <section className="ss-ws-panel" aria-label={title} data-testid={testid}>
      <header><h2>{title}</h2>{action}</header>
      {hint ? <p className="ss-ws-hint">{hint}</p> : null}
      {children}
    </section>
  );
}

/** What awaits the signed-in person in the modules that govern things OTHER than survey candidates. Each list is that
    module's own; the next step is derived from the record's status and who proposed and approved it — the same facts
    the module's own screen shows — and the permission the server will check. */
function otherGovernance(lists: { policies: Maybe<Any[]>; mappings: Maybe<Any[]>; groups: Maybe<Any>; bindings: Maybe<Any> }, me: string, can: (p: string) => boolean): Any[] {
  const out: Any[] = [];
  const add = (rows: Any[], what: string, to: (r: Any) => string, name: (r: Any) => string) => {
    for (const r of rows) {
      const mine = r.is_proposer ?? r.proposed_by === me, approver = r.is_approver ?? r.approved_by === me;
      const action = r.status === 'PROPOSED' && !mine && can('survey.approve') ? 'DECIDE' : r.status === 'APPROVED' && !mine && !approver && can('survey.publish') ? 'PUBLISH' : null;
      if (action) out.push({ key: `${what}-${r.id}`, what, action, title: name(r), since: r.proposed_at, to: to(r) });
    }
  };
  if (!missing(lists.policies)) add(lists.policies, 'Control policy', (r) => `/survey-studio/controls?view=policy&policy=${r.id}`, (r) => `${r.name}, revision ${r.revision}`);
  if (!missing(lists.mappings)) add(lists.mappings, 'Control mapping', (r) => `/survey-studio/controls?view=map&control=${r.control_code}`, (r) => `${r.control_name ?? r.control_code}, revision ${r.revision}`);
  if (!missing(lists.bindings)) add((lists.bindings.bindings ?? []) as Any[], 'Survey binding', () => '/survey-studio/assignment', (r) => `${r.rule_code} v${r.rule_version} → ${r.survey_name}`);
  if (!missing(lists.groups)) add((lists.groups.groups ?? []) as Any[], 'Requirement group', () => '/survey-studio/assignment', (r) => `${r.name}, version ${r.version}`);
  return out;
}

export function WorkspacePage({ CreateForm }: { CreateForm: ComponentType<{ onCancel: () => void; onMade: (s: SurveySummary) => void }> }) {
  const { can, me } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [surveys, setSurveys] = useState<SurveySummary[] | null>(null);
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [blocks, setBlocks] = useState<Record<Tab, Maybe<Component[]>> | null>(null);
  const [other, setOther] = useState<Any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [making, setMaking] = useState<Tab | null>(null);
  const view = (['surveys', 'blocks'].includes(params.get('view') ?? '') ? params.get('view') : 'overview') as 'overview' | 'surveys' | 'blocks';
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const tab = (TABS.find((t) => t.kind === params.get('blocks'))?.kind ?? 'MODULE') as Tab;
  const filter = params.get('show') ?? 'latest';
  const surveyFilter = params.get('surveys') ?? 'all';
  const inspecting = parseInspect(params.get('inspect'));
  const opened = params.get('survey');
  const layout = params.get('layout') === 'list' ? 'list' : 'grid';
  const sort = params.get('sort') ?? 'name';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const set = useCallback((changes: Record<string, string | null>) => { const next = new URLSearchParams(window.location.search); /* the address as it is NOW: two quick changes must not lose one */ for (const [k, v] of Object.entries(changes)) { if (v === null || v === '') next.delete(k); else next.set(k, v); } setParams(next, { replace: true }); }, [setParams]);
  const inspect = useCallback((c: Inspect) => set({ inspect: inspectParam(c) }), [set]);
  const meId = String(((me?.principal ?? {}) as Any).id ?? '');

  const fetchAll = useCallback(() => {
    setError(null);
    listSurveys().then(setSurveys).catch((e) => setError(say(e)));
    getWorkspace().then(setSummary).catch(() => setSummary(null));
    Promise.all(TABS.map((t) => allComponents(t.kind))).then(([m, i, c, o]) => setBlocks({ MODULE: m!, ITEM: i!, CONDITION: c!, OPTION_SET: o! }));
    Promise.all([controlPolicies(), controlMappings(), requirementGroups(), assignmentPolicy()]).then(([policies, mappings, groups, bindings]) => setOther(otherGovernance({ policies, mappings, groups, bindings }, meId, can)));
  }, [meId]); // eslint-disable-line react-hooks/exhaustive-deps -- `can` follows the signed-in person
  useEffect(fetchAll, [fetchAll]);

  const inv = summary?.inventory as Any;
  const kinds = inv?.components as Record<Tab, Any> | null | undefined;
  const awaiting = [
    ...((summary?.awaiting_you ?? []) as Any[]).map((a) => ({ key: a.candidate_id, what: 'Survey', action: a.action, title: `${a.survey_name}, submission ${a.candidate_n}`, since: a.since, to: `/survey-studio/surveys/${a.survey_code}/candidates/${a.candidate_id}` })),
    ...other,
  ];
  const waiting = (summary?.waiting_on_others ?? []) as Any[];

  const shownSurveys = useMemo(() => (surveys ?? []).filter((s) => (!q || hit(q, s.name, s.code, s.purpose)) && (surveyFilter === 'all' || (surveyFilter === 'published' ? !!s.latest_version_label : surveyFilter === 'draft' ? !s.latest_version_label : !!s.open_candidate_status))), [surveys, q, surveyFilter]);
  const list = blocks?.[tab];
  const filterBlock = (c: Component) => (filter === 'all' || (filter === 'reused' ? c.used_by.surveys > 1 && c.is_latest : c.is_latest)) && (!q || hit(q, c.title, c.code, c.description, c.category, ...c.published_in.map((s) => s.survey_name)));
  const PAGE = 24;
  const sorted = list && !missing(list) ? [...list.filter(filterBlock)].sort((a, b) => (sort === 'reuse' ? b.used_by.surveys - a.used_by.surveys : sort === 'version' ? b.version - a.version : 0) || a.title.localeCompare(b.title)) : [];
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const shownBlocks = sorted.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE);
  const found = q && blocks ? TABS.map((t) => ({ t, rows: missing(blocks[t.kind]) ? [] : (blocks[t.kind] as Component[]).filter((c) => c.is_latest && hit(q, c.title, c.code, c.description, c.category, ...c.published_in.map((s) => s.survey_name))) })) : null;
  const foundTotal = (found?.reduce((n, f) => n + f.rows.length, 0) ?? 0) + (q ? shownSurveys.length : 0);
  const libraryOff = summary ? !summary.library_enabled : !!list && missing(list);

  const ways: Array<{ to: string; testid: string; glyph: GlyphName; title: string; text: string; show: boolean }> = [
    { to: '/survey-studio/assignment', testid: 'ss-open-assignment', glyph: 'branch', title: 'Survey assignment', text: 'Which surveys an application gets, and in what order.', show: can('survey.assignment.read') },
    { to: '/survey-studio/controls', testid: 'ss-open-controls', glyph: 'check', title: 'Control policies and evidence', text: 'Which controls are assessed, and which questions evidence them.', show: can('survey.evaluation.read') },
    { to: '/survey-studio/journeys', testid: 'ss-open-journeys', glyph: 'list', title: 'Application journeys', text: 'Follow one invented application from what was required to its assurance.', show: can('survey.evaluation.read') },
    { to: '/survey-studio/simulation', testid: 'ss-open-simulation', glyph: 'next', title: 'Simulation & Evaluation', text: 'Every simulator and evaluation screen, and what each is for.', show: true },
    { to: '/survey-studio/rules', testid: 'ss-open-rules', glyph: 'merge', title: 'Rules explorer', text: 'Every kind of rule, with the screen that owns it.', show: true },
  ];
  // most recently saved first (the server's times), then the rest by name
  const factsOf = new Map(((summary?.surveys ?? []) as Any[]).map((x) => [x.survey_id as string, x]));
  const openSurvey = (code: string) => set({ survey: code });
  const savedAt = new Map(((summary?.recent_drafts ?? []) as Any[]).map((d) => [d.survey_id as string, d.saved_at as string]));
  const ordered = [...(surveys ?? [])].sort((a, b) => (savedAt.get(b.id) ?? '').localeCompare(savedAt.get(a.id) ?? '') || a.name.localeCompare(b.name));
  const modules = blocks && !missing(blocks.MODULE) ? (blocks.MODULE as Component[]).filter((c) => c.is_latest) : [];
  const preview = [...modules].sort((a, b) => b.used_by.surveys - a.used_by.surveys || a.title.localeCompare(b.title)).slice(0, 4);
  const blockTotal = blocks ? TABS.reduce((n, t) => n + (missing(blocks[t.kind]) ? 0 : (blocks[t.kind] as Component[]).filter((c) => c.is_latest).length), 0) : null;
  const go = (v: 'overview' | 'surveys' | 'blocks', more: Record<string, string | null> = {}) => set({ view: v === 'overview' ? null : v, q: null, ...more });
  const one = TABS.find((t) => t.kind === tab)!;

  return (
    <>
      <div className="ss-ws" data-testid="ss-saved-home" data-view={q ? 'search' : view} data-loaded={String(surveys !== null && blocks !== null)}>
        <header className="ss-ws-head">
          <div className="ss-ws-head-text">
            <h1 className="ss-title">Survey Studio</h1>
            <p>Design, reuse and govern customer journeys.</p>
          </div>
          <div className="ss-ws-head-actions">
            {can('survey.edit') ? (<>
              <button type="button" className="ss-btn primary big" onClick={() => { setMaking(null); setCreating(true); }} data-testid="ss-create"><Glyph name="plus" /> Create survey</button>
              <button type="button" className="ss-btn big" onClick={() => { setCreating(false); setMaking('MODULE'); }} aria-expanded={making !== null} data-testid="ss-ws-new-block"><Glyph name="plus" /> Create module</button>
            </>) : <span className="ss-save-note" data-testid="ss-read-only">Read only: you can open and inspect, but not change.</span>}
            <button type="button" className="ss-btn big" onClick={() => go('blocks')} data-testid="ss-ws-explore">Explore building blocks</button>
          </div>
          <div className="ss-ws-search" role="search">
            <Glyph name="search" size={18} />
            <input type="search" value={params.get('q') ?? ''} onChange={(e) => set({ q: e.target.value })} placeholder="Search surveys, modules, questions, conditions and answer sets" aria-label="Search Survey Studio" data-testid="ss-ws-search" />
            {q ? <button type="button" className="ss-link" onClick={() => set({ q: null })} data-testid="ss-ws-search-clear">Clear</button> : null}
          </div>
        </header>

        <div className="ss-ws-nav">
          <div className="ss-ws-tabs" role="tablist" aria-label="Survey Studio">
            <button type="button" role="tab" aria-selected={!q && view === 'overview'} className={!q && view === 'overview' ? 'on' : ''} onClick={() => go('overview')} data-testid="ss-ws-view-overview">Overview</button>
            <button type="button" role="tab" aria-selected={!q && view === 'surveys'} className={!q && view === 'surveys' ? 'on' : ''} onClick={() => go('surveys')} data-testid="ss-ws-view-surveys">Surveys{surveys ? <span>{surveys.length}</span> : null}</button>
            <button type="button" role="tab" aria-selected={!q && view === 'blocks'} className={!q && view === 'blocks' ? 'on' : ''} onClick={() => go('blocks')} data-testid="ss-ws-view-blocks">Building blocks{blockTotal !== null ? <span>{blockTotal}</span> : null}</button>
            <Link to="/survey-studio/rules" className="ss-ws-tablink" data-testid="ss-ws-view-rules">Rules explorer</Link>
          </div>
          <p className="ss-ws-notice" data-testid="ss-standing-note">
            <Glyph name="info" size={14} />
            <span><strong>Synthetic workspace.</strong> No survey here is eligible for a live call.{showNotice ? ` ${STANDING_NOTE}` : ''}</span>
            <button type="button" className="ss-link" onClick={() => setShowNotice((v) => !v)} aria-expanded={showNotice}>{showNotice ? 'Less' : 'Why'}</button>
            {summary ? <span className="ss-ws-market">Market {summary.markets.join(', ') || 'none'}</span> : null}
          </p>
        </div>

        {creating ? <CreateForm onCancel={() => setCreating(false)} onMade={(s) => nav(`/survey-studio/surveys/${s.code}`)} /> : null}
        {making ? <MakeBlock kind={making} surveys={surveys ?? []} canEdit={can('survey.edit')} onKind={setMaking} onClose={() => setMaking(null)} onNewSurvey={() => { setMaking(null); setCreating(true); }} /> : null}

        {found ? (
          <section className="ss-ws-section ss-ws-results" aria-label="Search results" data-testid="ss-ws-results" data-count={foundTotal}>
            <header><h2>{foundTotal ? `${plural(foundTotal, 'result')} for “${params.get('q')}”` : `Nothing matches “${params.get('q')}”`}</h2><span className="ss-muted">Published blocks show their latest revision.</span></header>
            {shownSurveys.length ? <><h3>Surveys</h3><ul className="ss-ws-grid">{shownSurveys.map((s) => <SurveyCard key={s.id} s={s} facts={factsOf.get(s.id)} onOpen={openSurvey} />)}</ul></> : null}
            {found.filter((f) => f.rows.length).map((f) => <div key={f.t.kind}><h3>{f.t.label}</h3><ul className="ss-ws-grid">{f.rows.map((c) => <BlockCard key={`${c.code}@${c.version}@${c.wording_version ?? ''}`} c={c} onInspect={inspect} />)}</ul></div>)}
            {!foundTotal ? <p className="ss-muted">Search looks at names, wording, descriptions, codes and the surveys a block is published in. Only published blocks are reusable, so a draft module or question is found inside its survey.</p> : null}
          </section>
        ) : view === 'overview' ? (
          <>
            <ul className="ss-ws-inventory" data-testid="ss-ws-inventory" aria-label="What Survey Studio holds">
              <li><button type="button" onClick={() => go('surveys')} data-testid="ss-ws-count-surveys" data-count={inv?.surveys.total ?? ''}><Glyph name="list" size={18} /><strong>{inv ? inv.surveys.total : '–'}</strong><span>Surveys</span><small>{inv ? `${inv.surveys.with_a_published_version} published · ${inv.surveys.never_published} draft only${inv.surveys.in_review + inv.surveys.approved_awaiting_publication ? ` · ${inv.surveys.in_review + inv.surveys.approved_awaiting_publication} in review` : ''}` : 'Counting…'}</small></button></li>
              {TABS.map((t) => {
                const k = kinds?.[t.kind];
                return (
                  <li key={t.kind}><button type="button" onClick={() => go('blocks', { blocks: t.kind })} data-testid={`ss-ws-count-${t.kind}`} data-count={k?.components ?? ''}>
                    <Glyph name={t.glyph} size={18} /><strong>{k ? (t.kind === 'ITEM' ? k.questions : k.components) : '–'}</strong><span>{t.label}</span>
                    <small>{k ? (t.kind === 'ITEM' ? `plus ${plural(k.statements, 'statement')} · ${k.pinned_by_more_than_one_survey} reused` : `${k.pinned_by_more_than_one_survey} reused across surveys`) : libraryOff ? 'The library is not switched on' : 'Counting…'}</small>
                  </button></li>
                );
              })}
              <li><button type="button" onClick={() => go('surveys', { surveys: 'draft' })} data-testid="ss-ws-count-drafts" data-count={inv?.surveys.never_published ?? ''}><Glyph name="text" size={18} /><strong>{inv ? inv.surveys.never_published : '–'}</strong><span>Drafts</span><small>{inv ? 'surveys never published' : 'Counting…'}</small></button></li>
              <li><button type="button" onClick={() => go('surveys', { surveys: 'review' })} data-testid="ss-ws-count-review" data-count={inv ? inv.surveys.in_review + inv.surveys.approved_awaiting_publication : ''}><Glyph name="check" size={18} /><strong>{inv ? inv.surveys.in_review + inv.surveys.approved_awaiting_publication : '–'}</strong><span>Awaiting review</span><small>{inv ? `${inv.surveys.in_review} in review · ${inv.surveys.approved_awaiting_publication} approved, unpublished` : 'Counting…'}</small></button></li>
            </ul>

            <div className="ss-ws-cols">
              <div className="ss-ws-main">
                {awaiting.length || waiting.length ? (
                  <Panel title="Awaiting you" testid="ss-ws-awaiting" hint="Reviews and publications the rules allow you to do now.">
                    {awaiting.length ? (
                      <ul className="ss-ws-rows">{awaiting.map((a) => (
                        <li key={a.key} data-action={a.action}><Link to={a.to}><span className="ss-ws-row-main"><strong>{a.title}</strong><small>{a.what} · {a.action === 'PUBLISH' ? 'approved, waiting to be published' : 'submitted, waiting for a decision'} · {ago(a.since)}</small></span><span className="ss-btn small">{a.action === 'PUBLISH' ? 'Publish' : 'Review'}</span></Link></li>))}</ul>
                    ) : null}
                    {waiting.length ? <p className="ss-ws-hint" data-testid="ss-ws-waiting">Waiting on someone else: {waiting.map((w, i) => <span key={w.candidate_id}>{i ? '; ' : ''}<Link to={`/survey-studio/surveys/${w.survey_code}/candidates/${w.candidate_id}`}>{w.survey_name}</Link> ({w.waiting_for === 'A_PUBLISHER' ? 'needs a publisher' : 'needs a reviewer'})</span>)}.</p> : null}
                  </Panel>
                ) : null}
                <Panel title="Your surveys" testid="ss-ws-surveys-panel" hint={awaiting.length || waiting.length ? undefined : 'Most recently saved first. Nothing is waiting for your review.'} action={surveys && surveys.length > 6 ? <button type="button" className="ss-link" onClick={() => go('surveys')} data-testid="ss-ws-all-surveys">See all {surveys.length} as cards</button> : undefined}>
                  {error ? <div className="ss-empty" role="alert" data-testid="ss-list-error"><p><strong>The surveys could not be loaded.</strong> {error}</p><button type="button" className="ss-btn" onClick={fetchAll}>Try again</button></div>
                    : surveys === null ? <p className="ss-loading" role="status" data-testid="ss-loading"><span className="ss-spinner" aria-hidden="true" /> Loading surveys…</p>
                      : surveys.length === 0 ? <div className="ss-empty" data-testid="ss-no-surveys"><p><strong>No surveys yet.</strong> {can('survey.edit') ? 'Create the first one.' : 'Nobody has created one.'}</p></div>
                        : <ul className="ss-ws-rows scroll" data-testid="ss-surveys">{ordered.map((s) => <SurveyRow key={s.id} s={s} saved={savedAt.get(s.id)} onOverview={openSurvey} />)}</ul>}
                </Panel>
              </div>
              <nav className="ss-ws-ways" aria-label="Where surveys go next" data-testid="ss-ws-ways">
                <h2>Go to</h2>
                {ways.filter((w) => w.show).map((w) => (
                  <Link key={w.to} to={w.to} data-testid={w.testid} className="ss-ws-way"><span className="ss-ws-way-glyph"><Glyph name={w.glyph} size={18} /></span><span><strong>{w.title}</strong><small>{w.text}</small></span><Glyph name="right" size={15} /></Link>))}
              </nav>
            </div>

            <section className="ss-ws-section" aria-labelledby="ss-ws-preview-h" data-testid="ss-ws-preview">
              <header><h2 id="ss-ws-preview-h">Building blocks</h2><button type="button" className="ss-btn small" onClick={() => go('blocks')} data-testid="ss-ws-browse">Browse all{blockTotal !== null ? ` ${blockTotal}` : ''}</button></header>
              <p className="ss-ws-hint">Published modules, most reused first. Select one to see every question and branch inside it.</p>
              {!blocks ? <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading the library…</p>
                : preview.length ? <ul className="ss-ws-grid four">{preview.map((c) => <BlockCard key={`${c.code}@${c.version}`} c={c} onInspect={inspect} />)}</ul>
                  : <p className="ss-ws-quiet" data-testid="ss-ws-preview-none">{libraryOff ? 'The component library is not switched on for this server.' : 'No module is published yet. A module becomes a reusable block when a survey that contains it is published.'}</p>}
            </section>
          </>
        ) : view === 'surveys' ? (
          <section className="ss-ws-section" aria-labelledby="ss-ws-surveys-h" data-testid="ss-ws-surveys-view">
            <header>
              <h2 id="ss-ws-surveys-h">Surveys</h2>
              <div className="ss-ws-view-tools"><div className="ss-ws-tabs small" role="group" aria-label="Layout">{[['grid', 'Cards'], ['list', 'Table']].map(([k, label]) => <button key={k} type="button" aria-pressed={layout === k} className={layout === k ? 'on' : ''} onClick={() => set({ layout: k === 'grid' ? null : k! })} data-testid={`ss-ws-layout-${k}`}>{label}</button>)}</div>
              <div className="ss-ws-tabs small" role="tablist" aria-label="Surveys by status">
                {[['all', 'All'], ['published', 'Published'], ['draft', 'Draft only'], ['review', 'In review']].map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={surveyFilter === k} className={surveyFilter === k ? 'on' : ''} onClick={() => set({ surveys: k === 'all' ? null : k! })} data-testid={`ss-ws-surveys-${k}`}>{label}</button>)}
              </div></div>
            </header>
            {surveys === null ? <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading surveys…</p>
              : shownSurveys.length ? (layout === 'grid' ? <ul className="ss-ws-grid">{shownSurveys.map((s) => <SurveyCard key={s.id} s={s} facts={factsOf.get(s.id)} onOpen={openSurvey} />)}</ul>
                : (
                  <div className="ss-ws-tablewrap"><table className="ss-table" data-testid="ss-ws-surveys-table">
                    <thead><tr><th scope="col">Survey</th><th scope="col">Code</th><th scope="col">Market</th><th scope="col">Status</th><th scope="col">Draft</th><th scope="col">Published</th><th scope="col">Modules</th><th scope="col">Questions</th><th scope="col">Last saved</th></tr></thead>
                    <tbody>{shownSurveys.map((s) => { const f = factsOf.get(s.id); return (
                      <tr key={s.id}><th scope="row"><button type="button" className="ss-link" onClick={() => openSurvey(s.code)}>{s.name}</button></th><td><span className="ss-code">{s.code}</span></td><td>{s.market_code}</td><td>{s.open_candidate_status ? words(s.open_candidate_status) : s.latest_version_label ? 'published' : 'draft only'}</td><td>Revision {s.draft_revision}</td><td>{s.latest_version_label ? `Version ${s.latest_version_label}` : '—'}</td><td>{f?.modules ?? '—'}</td><td>{f?.questions ?? '—'}</td><td>{f?.saved_at ? new Date(f.saved_at).toLocaleString() : '—'}</td></tr>); })}</tbody>
                  </table></div>))
                : <p className="ss-ws-quiet">{surveys.length ? `No survey is ${surveyFilter === 'review' ? 'in review' : surveyFilter === 'draft' ? 'a draft only' : 'published'}.` : 'No surveys yet.'}</p>}
          </section>
        ) : (
          <section className="ss-ws-section" id="ss-ws-blocks" aria-labelledby="ss-ws-blocks-h" data-testid="ss-ws-blocks">
            <header>
              <h2 id="ss-ws-blocks-h">Building blocks</h2>
              {can('survey.edit') ? <button type="button" className="ss-btn small" onClick={() => { setCreating(false); setMaking(tab); }} data-testid="ss-ws-new-of-kind"><Glyph name="plus" size={14} /> New {one.one}</button> : null}
            </header>
            <div className="ss-ws-toolbar">
              <div className="ss-ws-tabs" role="tablist" aria-label="Kinds of building block">
                {TABS.map((t) => <button key={t.kind} type="button" role="tab" aria-selected={tab === t.kind} className={tab === t.kind ? 'on' : ''} onClick={() => set({ blocks: t.kind })} data-testid={`ss-ws-tab-${t.kind}`}><Glyph name={t.glyph} size={15} /> {t.label}{blocks && !missing(blocks[t.kind]) ? <span>{(blocks[t.kind] as Component[]).filter((c) => c.is_latest).length}</span> : null}</button>)}
              </div>
              <div className="ss-ws-view-tools">
              <div className="ss-ws-tabs small" role="group" aria-label="Layout">{[['grid', 'Cards'], ['list', 'List']].map(([k, label]) => <button key={k} type="button" aria-pressed={layout === k} className={layout === k ? 'on' : ''} onClick={() => set({ layout: k === 'grid' ? null : k! })} data-testid={`ss-ws-blocks-layout-${k}`}>{label}</button>)}</div>
              <label className="ss-ws-filter">Sort <select value={sort} onChange={(e) => set({ sort: e.target.value === 'name' ? null : e.target.value, page: null })} data-testid="ss-ws-sort"><option value="name">By name</option><option value="reuse">Most reused first</option><option value="version">Highest version first</option></select></label>
              <label className="ss-ws-filter">Show
                <select value={filter} onChange={(e) => set({ show: e.target.value === 'latest' ? null : e.target.value })} data-testid="ss-ws-filter">
                  <option value="latest">Latest published revision of each</option><option value="reused">Reused by more than one survey</option><option value="all">Every published revision</option>
                </select>
              </label>
              </div>
            </div>
            <p className="ss-ws-hint">{one.blurb} Only published {one.label.toLowerCase()} are listed — that is what makes them reusable — in market {summary?.markets.join(', ') ?? '…'}. Select one to inspect it.{tab === 'MODULE' ? <span className="ss-ws-legend" aria-hidden="true"> <i className="question" /> question <i className="statement" /> statement <i className="decision" /> decision <i className="end ok" /> ending</span> : null}</p>
            {!blocks ? <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading the library…</p>
              : missing(list!) ? <div className="ss-empty" data-testid="ss-ws-blocks-unavailable"><p><strong>The library cannot be shown.</strong> {list!.unavailable === 'OFF' ? 'The component library is not switched on for this server.' : list!.unavailable === 'NO_PERMISSION' ? 'You do not have permission to read it.' : 'It could not be reached.'}</p></div>
                : shownBlocks.length ? (<>
                  {layout === 'grid' ? <ul className="ss-ws-grid" data-testid={`ss-ws-grid-${tab}`}>{shownBlocks.map((c) => <BlockCard key={`${c.code}@${c.version}@${c.wording_version ?? ''}`} c={c} onInspect={inspect} />)}</ul>
                    : (
                      <div className="ss-ws-tablewrap"><table className="ss-table" data-testid={`ss-ws-list-${tab}`}>
                        <thead><tr><th scope="col">{one.label}</th><th scope="col">Kind</th><th scope="col">{tab === 'MODULE' ? 'Revision' : 'Version'}</th><th scope="col">Status</th><th scope="col">Used by</th><th scope="col">Published in</th><th scope="col">Code</th></tr></thead>
                        <tbody>{shownBlocks.map((c) => <tr key={`${c.code}@${c.version}@${c.wording_version ?? ''}`}><th scope="row"><button type="button" className="ss-link" onClick={() => inspect({ kind: c.kind as ComponentKind, code: c.code, version: c.version, wording: c.wording_version ?? null })} data-testid={`ss-ws-row-${c.kind}-${c.code}-${c.version}`}>{tab === 'ITEM' ? `“${c.title}”` : c.title}</button></th><td>{tab === 'MODULE' ? `${MODULE_CATEGORY[c.category] ?? words(c.category)}${(c.facts as Any).branching ? ' · branches' : ''}` : tab === 'ITEM' ? answerOf((c.facts as Any).answer_type).label : tab === 'CONDITION' ? 'Condition' : `${(c.facts as Any).options ?? 0} answers`}</td><td>{c.version}{c.is_latest ? '' : ' (older)'}</td><td>Published</td><td>{plural(c.used_by.surveys, 'survey')}</td><td>{c.published_in.map((x) => `${x.survey_name} ${x.version_label}`).join('; ')}</td><td><span className="ss-code">{c.code}</span></td></tr>)}</tbody>
                      </table></div>)}
                  {pages > 1 ? <nav className="ss-ws-pages" aria-label="Pages" data-testid="ss-ws-pages"><button type="button" className="ss-btn small" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Previous</button><span>Page {Math.min(page, pages)} of {pages} · {sorted.length} in all</span><button type="button" className="ss-btn small" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })} data-testid="ss-ws-next-page">Next</button></nav> : null}
                </>)
                  : <div className="ss-empty" data-testid="ss-ws-blocks-none"><p><strong>No published {one.one} {filter === 'reused' ? 'is reused by more than one survey' : 'yet'}.</strong> A {one.one} is made {MAKE[tab].where}, and becomes reusable when that survey is published.</p>{can('survey.edit') ? <button type="button" className="ss-btn" onClick={() => setMaking(tab)}>How to create one</button> : null}</div>}
          </section>
        )}
      </div>
      {opened && !inspecting && surveys?.find((x) => x.code === opened) ? <SurveyOverviewDrawer survey={surveys.find((x) => x.code === opened)!} facts={factsOf.get(surveys.find((x) => x.code === opened)!.id) ?? null} published={blocks && !missing(blocks.MODULE) ? (blocks.MODULE as Component[]) : []} onInspect={inspect} onClose={() => set({ survey: null })} /> : null}
      {inspecting ? <InspectorDrawer target={inspecting} surveys={can('survey.edit') ? surveys ?? [] : []} markets={summary?.markets ?? []} onInspect={inspect} onClose={() => set({ inspect: null })} /> : null}
    </>
  );
}
