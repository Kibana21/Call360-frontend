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
import { MODULE_CATEGORY, allComponents, answerOf, controlMappings, controlPolicies, getWorkspace, missing, requirementGroups, words, type Maybe, type WorkspaceSummary } from './workspaceApi';

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
          <span>{kind === 'MODULE' ? `${plural(facts.questions ?? 0, 'question')} · ${plural(facts.decisions ?? 0, 'decision')} · ${plural(((facts.outcomes ?? []) as string[]).length, 'ending')}` : `In ${c.published_in.map((s) => s.survey_name).slice(0, 1).join('')}${c.published_in.length > 1 ? ` +${c.published_in.length - 1}` : ''}`}</span>
          <span className="ss-ws-card-version">{kind === 'MODULE' ? 'Revision' : 'Version'} {c.version}{c.is_latest ? '' : ' · older'}</span>
        </span>
      </button>
    </li>
  );
}

function SurveyCard({ s }: { s: SurveySummary }) {
  const review = s.open_candidate_status ? words(s.open_candidate_status) : null;
  return (
    <li className="ss-ws-card survey" data-testid={`ss-survey-${s.code}`} data-status={s.open_candidate_status ?? (s.latest_version_label ? 'PUBLISHED' : 'DRAFT')}>
      <Link to={`/survey-studio/surveys/${s.code}`} data-testid={`ss-open-${s.code}`}>
        <span className="ss-ws-card-top">
          <span className="ss-ws-card-kind">{s.market_code} · Survey</span>
          {review ? <Tag tone="warn">{review}</Tag> : s.latest_version_label ? <Tag tone="ok">Published</Tag> : <Tag tone="draft">Draft only</Tag>}
        </span>
        <strong className="ss-ws-card-title">{s.name}</strong>
        {s.purpose ? <span className="ss-ws-card-text">{s.purpose}</span> : null}
        <span className="ss-ws-card-foot">
          <span>Revision {s.draft_revision}{s.latest_version_label ? ` · Version ${s.latest_version_label} published` : ' · never published'}</span>
          {hasPersistedMemory(s.code) ? <Tag tone="draft">Open in this tab</Tag> : null}
        </span>
      </Link>
    </li>
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
function otherGovernance(lists: { policies: Maybe<Any[]>; mappings: Maybe<Any[]>; groups: Maybe<Any> }, me: string, can: (p: string) => boolean): Any[] {
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
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const tab = (TABS.find((t) => t.kind === params.get('blocks'))?.kind ?? 'MODULE') as Tab;
  const filter = params.get('show') ?? 'latest';
  const surveyFilter = params.get('surveys') ?? 'all';
  const inspecting = parseInspect(params.get('inspect'));
  const set = useCallback((changes: Record<string, string | null>) => { const next = new URLSearchParams(window.location.search); /* the address as it is NOW: two quick changes must not lose one */ for (const [k, v] of Object.entries(changes)) { if (v === null || v === '') next.delete(k); else next.set(k, v); } setParams(next, { replace: true }); }, [setParams]);
  const inspect = useCallback((c: Inspect) => set({ inspect: inspectParam(c) }), [set]);
  const meId = String(((me?.principal ?? {}) as Any).id ?? '');

  const fetchAll = useCallback(() => {
    setError(null);
    listSurveys().then(setSurveys).catch((e) => setError(say(e)));
    getWorkspace().then(setSummary).catch(() => setSummary(null));
    Promise.all(TABS.map((t) => allComponents(t.kind))).then(([m, i, c, o]) => setBlocks({ MODULE: m!, ITEM: i!, CONDITION: c!, OPTION_SET: o! }));
    Promise.all([controlPolicies(), controlMappings(), requirementGroups()]).then(([policies, mappings, groups]) => setOther(otherGovernance({ policies, mappings, groups }, meId, can)));
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
  const shownBlocks = list && !missing(list) ? list.filter(filterBlock) : [];
  const found = q && blocks ? TABS.map((t) => ({ t, rows: missing(blocks[t.kind]) ? [] : (blocks[t.kind] as Component[]).filter((c) => c.is_latest && hit(q, c.title, c.code, c.description, c.category, ...c.published_in.map((s) => s.survey_name))) })) : null;
  const foundTotal = (found?.reduce((n, f) => n + f.rows.length, 0) ?? 0) + (q ? shownSurveys.length : 0);
  const libraryOff = summary ? !summary.library_enabled : !!list && missing(list);

  const ways: Array<{ to: string; testid: string; glyph: GlyphName; title: string; text: string; show: boolean }> = [
    { to: '/survey-studio/assignment', testid: 'ss-open-assignment', glyph: 'branch', title: 'Survey assignment', text: 'Which surveys the assignment rules select for an application, and in what order.', show: can('survey.assignment.read') },
    { to: '/survey-studio/controls', testid: 'ss-open-controls', glyph: 'check', title: 'Control policies and evidence', text: 'Which controls must be assessed, and which survey questions evidence them.', show: can('survey.evaluation.read') },
    { to: '/survey-studio/journeys', testid: 'ss-open-journeys', glyph: 'next', title: 'Application journeys and evaluation', text: 'Follow one invented application from what was required to its evaluation and assurance.', show: can('survey.evaluation.read') },
    { to: '/survey-studio/rules', testid: 'ss-open-rules', glyph: 'merge', title: 'Rules explorer', text: 'Assignment, survey-logic, control-applicability and finding rules, each with the screen that owns it.', show: true },
  ];

  return (
    <>
      <div className="ss-ws" data-testid="ss-saved-home" data-loaded={String(surveys !== null && blocks !== null)}>
        <header className="ss-ws-head">
          <div className="ss-ws-head-text">
            <h1 className="ss-title">Survey Studio</h1>
            <p>Callback surveys, built from reusable published blocks — and governed, simulated and evaluated from here.</p>
          </div>
          <div className="ss-ws-head-actions">
            {can('survey.edit') ? <button type="button" className="ss-btn primary big" onClick={() => setCreating(true)} data-testid="ss-create"><Glyph name="plus" /> New survey</button>
              : <span className="ss-save-note" data-testid="ss-read-only">Read only: you can open and inspect, but not change.</span>}
            <a className="ss-btn big" href="#ss-ws-blocks" data-testid="ss-ws-browse">Browse building blocks</a>
          </div>
          <div className="ss-ws-search" role="search">
            <Glyph name="search" size={18} />
            <input type="search" value={params.get('q') ?? ''} onChange={(e) => set({ q: e.target.value })} placeholder="Search surveys, modules, questions, conditions and answer sets" aria-label="Search Survey Studio" data-testid="ss-ws-search" />
            {q ? <button type="button" className="ss-link" onClick={() => set({ q: null })} data-testid="ss-ws-search-clear">Clear</button> : <span className="ss-ws-search-hint">by name, wording, code or the survey it is published in</span>}
          </div>
          <p className="ss-ws-notice" data-testid="ss-standing-note">
            <Glyph name="info" size={14} />
            <span><strong>Synthetic workspace.</strong> No survey here is eligible for a live call.{showNotice ? ` ${STANDING_NOTE}` : ''} </span>
            <button type="button" className="ss-link" onClick={() => setShowNotice((v) => !v)} aria-expanded={showNotice}>{showNotice ? 'Less' : 'Why'}</button>
            {summary ? <span className="ss-ws-market">Market {summary.markets.join(', ') || 'none'}</span> : null}
          </p>
        </header>

        {creating ? <CreateForm onCancel={() => setCreating(false)} onMade={(s) => nav(`/survey-studio/surveys/${s.code}`)} /> : null}

        {found ? (
          <section className="ss-ws-results" aria-label="Search results" data-testid="ss-ws-results" data-count={foundTotal}>
            <header><h2>{foundTotal ? `${plural(foundTotal, 'result')} for “${params.get('q')}”` : `Nothing matches “${params.get('q')}”`}</h2><span className="ss-muted">Published blocks show their latest revision.</span></header>
            {shownSurveys.length ? <><h3>Surveys</h3><ul className="ss-ws-grid">{shownSurveys.map((s) => <SurveyCard key={s.id} s={s} />)}</ul></> : null}
            {found.filter((f) => f.rows.length).map((f) => <div key={f.t.kind}><h3>{f.t.label}</h3><ul className="ss-ws-grid">{f.rows.map((c) => <BlockCard key={`${c.code}@${c.version}@${c.wording_version ?? ''}`} c={c} onInspect={inspect} />)}</ul></div>)}
            {!foundTotal ? <p className="ss-muted">Search looks at names, wording, descriptions, codes and the surveys a block is published in. Only published blocks are reusable, so drafts of modules and questions are found inside their survey.</p> : null}
          </section>
        ) : (
          <>
            <ul className="ss-ws-inventory" data-testid="ss-ws-inventory" aria-label="What Survey Studio holds">
              <li><a href="#ss-ws-surveys" data-testid="ss-ws-count-surveys" data-count={inv?.surveys.total ?? ''}><Glyph name="list" size={18} /><strong>{inv ? inv.surveys.total : '–'}</strong><span>Surveys</span><small>{inv ? `${inv.surveys.with_a_published_version} published · ${inv.surveys.never_published} draft only${inv.surveys.in_review + inv.surveys.approved_awaiting_publication ? ` · ${inv.surveys.in_review + inv.surveys.approved_awaiting_publication} in review` : ''}` : 'Counting…'}</small></a></li>
              {TABS.map((t) => {
                const k = kinds?.[t.kind];
                return (
                  <li key={t.kind}><a href="#ss-ws-blocks" onClick={() => set({ blocks: t.kind })} data-testid={`ss-ws-count-${t.kind}`} data-count={k?.components ?? ''}>
                    <Glyph name={t.glyph} size={18} /><strong>{k ? (t.kind === 'ITEM' ? k.questions : k.components) : libraryOff ? '–' : '–'}</strong><span>{t.label}</span>
                    <small>{k ? (t.kind === 'ITEM' ? `plus ${plural(k.statements, 'statement')} · ${k.pinned_by_more_than_one_survey} reused` : `${k.pinned_by_more_than_one_survey} reused by more than one survey`) : libraryOff ? 'The library is not switched on' : 'Counting…'}</small>
                  </a></li>
                );
              })}
            </ul>

            <div className="ss-ws-cols">
              <div className="ss-ws-main">
                <Panel title="Awaiting you" testid="ss-ws-awaiting" hint="Reviews and publications the rules allow you — and only you, not their author — to do now.">
                  {awaiting.length ? (
                    <ul className="ss-ws-rows">{awaiting.map((a) => (
                      <li key={a.key} data-action={a.action}><Link to={a.to}><span className="ss-ws-row-main"><strong>{a.title}</strong><small>{a.what} · {a.action === 'PUBLISH' ? 'approved, waiting to be published' : 'submitted, waiting for a decision'} · {ago(a.since)}</small></span><span className="ss-btn small">{a.action === 'PUBLISH' ? 'Publish' : 'Review'}</span></Link></li>))}</ul>
                  ) : <p className="ss-ws-quiet" data-testid="ss-ws-awaiting-none">Nothing is waiting for you.</p>}
                  {waiting.length ? <p className="ss-ws-hint" data-testid="ss-ws-waiting">Waiting on someone else: {waiting.map((w, i) => <span key={w.candidate_id}>{i ? '; ' : ''}<Link to={`/survey-studio/surveys/${w.survey_code}/candidates/${w.candidate_id}`}>{w.survey_name}</Link> ({w.waiting_for === 'A_PUBLISHER' ? 'needs a publisher' : 'needs a reviewer'})</span>)}.</p> : null}
                </Panel>
                <div className="ss-ws-pair">
                  <Panel title="Recently edited" testid="ss-ws-recent-drafts">
                    {summary?.recent_drafts.length ? <ul className="ss-ws-rows">{(summary.recent_drafts as Any[]).map((d) => (
                      <li key={d.survey_id}><Link to={`/survey-studio/surveys/${d.survey_code}`}><span className="ss-ws-row-main"><strong>{d.survey_name}</strong><small>Draft revision {d.draft_revision} · saved {ago(d.saved_at)}{d.saved_by_you ? ' by you' : ''}</small></span><Glyph name="right" size={14} /></Link></li>))}</ul>
                      : <p className="ss-ws-quiet">{summary ? 'No draft has been saved yet.' : 'Loading…'}</p>}
                  </Panel>
                  <Panel title="Recently published" testid="ss-ws-recent-published">
                    {summary?.recent_published.length ? <ul className="ss-ws-rows">{(summary.recent_published as Any[]).map((v) => (
                      <li key={v.version_id}><Link to={`/survey-studio/surveys/${v.survey_code}/versions/${v.version_id}`}><span className="ss-ws-row-main"><strong>{v.survey_name}</strong><small>Version {v.version_label} · published {ago(v.published_at)}</small></span><Glyph name="right" size={14} /></Link></li>))}</ul>
                      : <p className="ss-ws-quiet">{summary ? 'Nothing has been published yet.' : 'Loading…'}</p>}
                  </Panel>
                </div>
              </div>
              <nav className="ss-ws-ways" aria-label="Where surveys go next" data-testid="ss-ws-ways">
                {ways.filter((w) => w.show).map((w) => (
                  <Link key={w.to} to={w.to} data-testid={w.testid} className="ss-ws-way"><span className="ss-ws-way-glyph"><Glyph name={w.glyph} size={18} /></span><span><strong>{w.title}</strong><small>{w.text}</small></span><Glyph name="right" size={15} /></Link>))}
              </nav>
            </div>

            {(summary?.reused_modules ?? []).length ? (
              <section className="ss-ws-section" aria-labelledby="ss-ws-reused-h" data-testid="ss-ws-reused">
                <header><h2 id="ss-ws-reused-h">Modules reused across surveys</h2><span className="ss-muted">Counted from published versions: each of these is pinned by more than one survey.</span></header>
                <ul className="ss-ws-grid">{(summary!.reused_modules as Any[]).map((c) => <BlockCard key={`${c.code}@${c.version}`} c={c as Component} onInspect={inspect} />)}</ul>
              </section>
            ) : null}

            <section className="ss-ws-section" id="ss-ws-blocks" aria-labelledby="ss-ws-blocks-h" data-testid="ss-ws-blocks">
              <header>
                <h2 id="ss-ws-blocks-h">Building blocks</h2>
                <span className="ss-muted">Published and reusable. Select one to inspect everything inside it.</span>
              </header>
              <div className="ss-ws-toolbar">
                <div className="ss-ws-tabs" role="tablist" aria-label="Kinds of building block">
                  {TABS.map((t) => <button key={t.kind} type="button" role="tab" aria-selected={tab === t.kind} className={tab === t.kind ? 'on' : ''} onClick={() => set({ blocks: t.kind })} data-testid={`ss-ws-tab-${t.kind}`}><Glyph name={t.glyph} size={15} /> {t.label}{blocks && !missing(blocks[t.kind]) ? <span>{(blocks[t.kind] as Component[]).filter((c) => c.is_latest).length}</span> : null}</button>)}
                </div>
                <label className="ss-ws-filter">Show
                  <select value={filter} onChange={(e) => set({ show: e.target.value === 'latest' ? null : e.target.value })} data-testid="ss-ws-filter">
                    <option value="latest">Latest published revision of each</option><option value="reused">Reused by more than one survey</option><option value="all">Every published revision</option>
                  </select>
                </label>
              </div>
              <p className="ss-ws-hint">{TABS.find((t) => t.kind === tab)!.blurb}{tab === 'MODULE' ? <span className="ss-ws-legend" aria-hidden="true"> <i className="question" /> question <i className="statement" /> statement <i className="decision" /> decision <i className="end ok" /> ending</span> : null}</p>
              {!blocks ? <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading the library…</p>
                : missing(list!) ? <div className="ss-empty" data-testid="ss-ws-blocks-unavailable"><p><strong>The library cannot be shown.</strong> {list!.unavailable === 'OFF' ? 'The component library is not switched on for this server.' : list!.unavailable === 'NO_PERMISSION' ? 'You do not have permission to read it.' : 'It could not be reached.'}</p></div>
                  : shownBlocks.length ? <ul className="ss-ws-grid" data-testid={`ss-ws-grid-${tab}`}>{shownBlocks.map((c) => <BlockCard key={`${c.code}@${c.version}@${c.wording_version ?? ''}`} c={c} onInspect={inspect} />)}</ul>
                    : <div className="ss-empty" data-testid="ss-ws-blocks-none"><p><strong>No published {TABS.find((t) => t.kind === tab)!.one} {filter === 'reused' ? 'is reused by more than one survey' : 'yet'}.</strong> A {TABS.find((t) => t.kind === tab)!.one} becomes reusable when a survey that contains it is published.</p></div>}
            </section>

            <section className="ss-ws-section" id="ss-ws-surveys" aria-labelledby="ss-ws-surveys-h">
              <header>
                <h2 id="ss-ws-surveys-h">Surveys</h2>
                <div className="ss-ws-tabs small" role="tablist" aria-label="Surveys by status">
                  {[['all', 'All'], ['published', 'Published'], ['draft', 'Draft only'], ['review', 'In review']].map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={surveyFilter === k} className={surveyFilter === k ? 'on' : ''} onClick={() => set({ surveys: k === 'all' ? null : k! })} data-testid={`ss-ws-surveys-${k}`}>{label}</button>)}
                </div>
              </header>
              {error ? <div className="ss-empty" role="alert" data-testid="ss-list-error"><p><strong>The surveys could not be loaded.</strong> {error}</p><button type="button" className="ss-btn" onClick={fetchAll}>Try again</button></div>
                : surveys === null ? <p className="ss-loading" role="status" data-testid="ss-loading"><span className="ss-spinner" aria-hidden="true" /> Loading surveys…</p>
                  : surveys.length === 0 ? <div className="ss-empty" data-testid="ss-no-surveys"><p><strong>No surveys yet.</strong> {can('survey.edit') ? 'Create the first one.' : 'Nobody has created one.'}</p></div>
                    : shownSurveys.length ? <ul className="ss-ws-grid" data-testid="ss-surveys">{shownSurveys.map((s) => <SurveyCard key={s.id} s={s} />)}</ul>
                      : <p className="ss-ws-quiet">No survey is {surveyFilter === 'review' ? 'in review' : surveyFilter === 'draft' ? 'a draft only' : 'published'}.</p>}
            </section>
          </>
        )}
      </div>
      {inspecting ? <InspectorDrawer target={inspecting} surveys={can('survey.edit') ? surveys ?? [] : []} onInspect={inspect} onClose={() => set({ inspect: null })} /> : null}
    </>
  );
}
