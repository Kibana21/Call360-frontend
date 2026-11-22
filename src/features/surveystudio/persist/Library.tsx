// Survey Studio (LIB-1) — the component library: ONE selector for published modules, questions, conditions and answer
// sets, opened from the studio bar on every screen (Lego Composer, Guided Builder, Graph). It is a drawer over the
// screen the author is on, not another page or application: find, preview, then "Add to this survey" (the exact
// published version, pinned and locked) or "Edit a copy for this survey" (a local draft that records where it came from).
// Only what a PUBLISHED survey version pins is ever listed — that is decided by the server, not here.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiFailure } from '../../../api/client';
import { assetKey, optionsOfDocument, type AssetDoc, type AssetKind, type Doc } from '../model/documents';
import { bringIn, applyOptionSet } from '../model/library';
import { addInstance, deriveModule } from '../model/ops';
import { FIELDS } from '../model/sample';
import { mKey } from '../model/types';
import { useStudio } from '../store';
import { Glyph, Tag } from '../ui';
import { getComponent, listComponents, type Component, type ComponentDetail, type ComponentKind } from './api';
import { usePlace } from '../place';
import { usePersistence } from './Persistence';
import { short } from './reviewApi';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- published documents are read as JSON
interface Focus { kind: ComponentKind; code: string; version: number }
interface LibraryApi { openLibrary: (kind?: ComponentKind, focus?: Focus) => void; available: boolean }
const Ctx = createContext<LibraryApi>({ openLibrary: () => undefined, available: false });
export const useLibrary = () => useContext(Ctx);

const TABS: Array<{ kind: ComponentKind; label: string; one: string }> = [
  { kind: 'MODULE', label: 'Modules', one: 'module' }, { kind: 'ITEM', label: 'Questions', one: 'question' },
  { kind: 'CONDITION', label: 'Conditions', one: 'condition' }, { kind: 'OPTION_SET', label: 'Answer sets', one: 'answer set' },
];
const CATEGORY: Record<string, string> = { OPENING: 'Opening', COMMON: 'General', PRODUCT: 'Product', RISK: 'Risk', EXCEPTION: 'Exception', CLOSING: 'Closing', YES_NO: 'Yes / No', SINGLE_SELECT: 'One answer', MULTI_SELECT: 'Several answers', FREE_TEXT: 'Free text', NUMERIC: 'Number', ACKNOWLEDGEMENT: 'Acknowledgement', STATEMENT: 'Statement', CONDITION: 'Condition', OPTION_SET: 'Answers' };
const say = (e: unknown) => (e instanceof ApiFailure ? e.message : 'The library could not be reached.');
const target = (t: Any): string => (t == null ? 'not decided' : t.node ? `step ${t.node}` : t.outcome ? `ends the module: ${String(t.outcome).replace(/_/g, ' ').toLowerCase()}` : t.return ? 'back to the question that asked' : JSON.stringify(t));
const where = (c: Component) => c.published_in.map((s) => (s.artifact_kind === 'MODULE' ? `${s.survey_name} · published on its own, release ${s.version_label}` : `${s.survey_name} · version ${s.version_label}`)).join('; ');
const assetsOf = (d: ComponentDetail): AssetDoc[] => [
  ...(d.kind === 'OPTION_SET' ? [] : [{ kind: d.kind as AssetKind, code: d.code, version: d.version, document: d.document as Doc }]),
  ...d.dependencies.map((x): AssetDoc => ({ kind: x.kind as AssetKind, code: x.code, version: x.version, document: x.document as Doc })),
];

export function LibraryProvider({ children }: { children: ReactNode }) {
  const p = usePersistence();
  const [state, setState] = useState<{ kind: ComponentKind; focus?: Focus } | null>(null);
  const available = !!p?.library;
  const openLibrary = useCallback((kind: ComponentKind = 'MODULE', focus?: Focus) => setState({ kind: focus?.kind ?? kind, focus }), []);
  // UX-HOME-1: "Use in a survey" from the workspace inspector opens this survey with ?library=KIND~code~version: the
  // library opens on that published block. Adding it is still the author's own action here, and nothing is saved by it.
  const asked = useRef(false);
  useEffect(() => {
    if (!available || asked.current) return;
    const [kind, code, version] = (new URLSearchParams(window.location.search).get('library') ?? '').split('~');
    if (kind && code && Number(version) > 0 && TABS.some((t) => t.kind === kind)) { asked.current = true; openLibrary(kind as ComponentKind, { kind: kind as ComponentKind, code, version: Number(version) }); }
  }, [available, openLibrary]);
  const value = useMemo(() => ({ openLibrary, available }), [openLibrary, available]);
  return <Ctx.Provider value={value}>{children}{state && available ? <Drawer initial={state.kind} focus={state.focus} onClose={() => setState(null)} /> : null}</Ctx.Provider>;
}

/** The bar button that opens the library. On a module's screen it starts on Questions; elsewhere on Modules. */
export function LibraryButton() {
  const { openLibrary, available } = useLibrary();
  if (!available) return null;
  return <button type="button" className="ss-tool" onClick={() => openLibrary(window.location.pathname.includes('/modules/') ? 'ITEM' : 'MODULE')} data-testid="ss-library-open" title="Published modules, questions, conditions and answer sets you can reuse"><Glyph name="link" /> Add from library</button>;
}

// ---- newer published revisions: information only --------------------------------------------------------------------
/** "A newer revision has been published" for what this survey pins. Nothing is upgraded; nothing is blocked. */
export function NewerRevisions() {
  const { openLibrary, available } = useLibrary();
  const { ws } = useStudio();
  const [modules, setModules] = useState<Component[] | null>(null);
  const survey = ws.surveys[0];
  const pinned = useMemo(() => (survey ? survey.sequence.map((i) => i.module) : []), [survey]);
  const key = pinned.map((m) => mKey(m)).join('|');
  useEffect(() => { if (available && key) listComponents('MODULE').then(setModules).catch(() => setModules(null)); }, [available, key]);
  if (!available || !modules) return null;
  const notes = [...new Map(pinned.map((m) => [mKey(m), m])).values()]
    .map((m) => ({ m, c: modules.find((x) => x.code === m.code && x.version === m.revision) })).filter((x) => x.c && !x.c.is_latest);
  if (!notes.length) return null;
  return (
    <div className="ss-note info" data-testid="ss-newer-revisions"><Glyph name="info" size={14} />
      <span>{notes.map(({ m, c }) => (
        <span key={mKey(m)} className="ss-newer" data-testid={`ss-newer-${m.code}`}><strong>{c!.title}</strong> is pinned at revision {m.revision}. Revision {c!.latest_published_version} has been published. Nothing is changed for you: this survey stays on revision {m.revision}.{' '}
          <button type="button" className="ss-link" onClick={() => openLibrary('MODULE', { kind: 'MODULE', code: m.code, version: c!.latest_published_version })} data-testid={`ss-newer-see-${m.code}`}>See what changed</button> </span>))}</span>
    </div>
  );
}

// ---- the drawer ----------------------------------------------------------------------------------------------------
function Drawer({ initial, focus, onClose }: { initial: ComponentKind; focus?: Focus; onClose: () => void }) {
  const p = usePersistence()!;
  const { ws, apply } = useStudio();
  const [kind, setKind] = useState<ComponentKind>(initial);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Component[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Focus | null>(focus ?? null);
  const [detail, setDetail] = useState<ComponentDetail | null>(null);
  const [compare, setCompare] = useState<{ with: number; lines: string[] } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [target_, setTarget] = useState('');
  const search = useRef<HTMLInputElement | null>(null);
  const survey = ws.surveys[0]!;
  // LIB-2: a module authored on its own holds one module — itself. Another module cannot be placed in it.
  const tabs = usePlace(survey.id).mode === 'module' ? TABS.filter((t) => t.kind !== 'MODULE') : TABS;

  // focus goes to the search box on opening, and back to whatever opened the library on closing
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    search.current?.focus();
    return () => { opener?.focus?.(); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    setItems(null);
    setError(null);
    const t = window.setTimeout(() => { listComponents(kind, query).then(setItems).catch((e) => setError(say(e))); }, query ? 180 : 0);
    return () => window.clearTimeout(t);
  }, [kind, query]);
  useEffect(() => {
    setDetail(null); setCompare(null); setRefusal(null);
    if (!picked || picked.kind !== kind) return;
    const row = items?.find((c) => c.code === picked.code && c.version === picked.version);
    getComponent(picked.kind, picked.code, picked.version, row?.wording_version).then(setDetail).catch((e) => setError(say(e)));
  }, [picked, kind, items]);

  const tab = TABS.find((t) => t.kind === kind)!;
  const draftChoices = ws.questions.filter((q) => !q.published && ['YES_NO', 'SINGLE_SELECT', 'MULTI_SELECT'].includes(q.answerType));
  const here = (c: { kind: string; code: string; version: number }) => (c.kind === 'MODULE' ? survey.sequence.some((i) => i.module.code === c.code && i.module.revision === c.version)
    : c.kind === 'ITEM' ? ws.questions.some((q) => q.code === c.code && q.version === c.version) : c.kind === 'CONDITION' ? ws.conditions.some((x) => x.code === c.code && x.version === c.version) : false);

  /** Why this component cannot be placed here, in words; null when it can. The server checks again when it is saved. */
  const incompatible = (d: ComponentDetail): string | null => {
    if (d.missing_dependencies.length) return `It cannot be added: ${d.missing_dependencies.length} thing${d.missing_dependencies.length === 1 ? '' : 's'} it depends on ${d.missing_dependencies.length === 1 ? 'is' : 'are'} not published (${d.missing_dependencies.map((m: Any) => `${String(m.kind).toLowerCase()} ${m.code} version ${m.version}`).join(', ')}). A published component may only depend on published versions.`;
    const unknown = ((d.requires.fields ?? []) as string[]).filter((f) => !FIELDS.some((x) => x.code === f));
    if (unknown.length) return `It cannot be added: it reads customer or policy information this survey does not have (${unknown.join(', ')}).`;
    return null;
  };

  const act = (label: string, run: (d: ComponentDetail) => void) => {
    if (!detail) return;
    const why = incompatible(detail);
    if (why) { setRefusal(why); return; }
    try { run(detail); setDone(label); setRefusal(null); } catch (e) { setRefusal(e instanceof Error ? e.message : 'That could not be added.'); }
  };
  const addModule = (copy: boolean) => act(copy ? `Added an editable copy of “${detail!.title}”. It is yours to change; the published module is untouched.` : `Added “${detail!.title}”, pinned at revision ${detail!.version}. It is shared and locked.`, (d) => {
    const { ws: brought, added } = bringIn(ws, assetsOf(d));
    const [placed, instanceId] = addInstance(brought, survey.id, survey.sequence.length, `${d.code}@${d.version}`);
    const next = copy ? deriveModule(placed, survey.id, instanceId)[0] : placed;
    p.adopt(added);
    apply(copy ? `Added a copy of ${d.title} from the library` : `Added ${d.title} from the library`, () => next);
  });
  const addPart = () => act(`“${detail!.title}” is now in this survey. ${kind === 'ITEM' ? 'Wherever you add a question, choose “Reuse a question from the library”.' : 'It is offered wherever a rule is chosen.'}`, (d) => {
    const { ws: brought, added } = bringIn(ws, assetsOf(d));
    p.adopt(added);
    apply(`Brought ${d.title} in from the library`, () => brought);
  });
  const useAnswers = () => act('These answers are now used by that question, exactly as published.', (d) => {
    const [code, version] = target_.split('@');
    if (!code) throw new Error('Choose the question that should use these answers.');
    p.adopt([{ kind: 'OPTION_SET', code: d.code, version: d.version, document: d.document as Doc }]);
    apply(`Used the published answers ${d.title}`, (w) => applyOptionSet(w, { code, version: Number(version) }, { code: d.code, version: d.version }, optionsOfDocument(d.document as Doc)));
  });
  const showCompare = (other: number) => {
    if (!detail) return;
    getComponent(detail.kind as ComponentKind, detail.code, other, detail.wording_version).then((o) => setCompare({ with: other, lines: differences(detail, o) })).catch((e) => setError(say(e)));
  };

  return (
    <div className="ss-drawer-back" data-testid="ss-library" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="ss-drawer" role="dialog" aria-modal="true" aria-labelledby="ss-library-title">
        <header className="ss-drawer-head">
          <div><h2 id="ss-library-title">Add from the library</h2>
            <p className="ss-muted">Building blocks that other surveys have published. What you add is the exact published version: it is never copied or changed unless you ask for a copy. All wording is synthetic and unapproved for operational use.</p></div>
          <button type="button" className="ss-icon-btn" aria-label="Close the library" onClick={onClose} data-testid="ss-library-close"><Glyph name="close" /></button>
        </header>
        <div className="ss-drawer-tools">
          <div className="ss-seg" role="tablist" aria-label="Kind of component">
            {tabs.map((t) => <button key={t.kind} type="button" role="tab" aria-selected={kind === t.kind} className={kind === t.kind ? 'on' : ''} onClick={() => { setKind(t.kind); setPicked(null); setDone(null); }} data-testid={`ss-library-tab-${t.kind}`}>{t.label}</button>)}
          </div>
          <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tab.label.toLowerCase()} by name, description or the survey that published them`} aria-label={`Search ${tab.label.toLowerCase()}`} data-testid="ss-library-search" />
        </div>
        {done ? <p className="ss-note ok" role="status" data-testid="ss-library-done"><Glyph name="check" size={14} /><span>{done} <strong>Save</strong> to keep it.</span></p> : null}
        {error ? <p className="ss-note warn" role="alert" data-testid="ss-library-error"><Glyph name="alert" size={14} /><span>{error}</span></p> : null}
        <div className="ss-drawer-body">
          <div className="ss-lib-list" role="listbox" aria-label={tab.label} data-testid="ss-library-list">
            {items === null && !error ? <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading…</p> : null}
            {items && items.length === 0 ? <p className="ss-muted" data-testid="ss-library-empty">{query ? `No published ${tab.one} matches “${query}”.` : `No ${tab.one} has been published yet. A ${tab.one} appears here once a survey that uses it is published.`}</p> : null}
            {items?.map((c) => {
              const on = picked?.code === c.code && picked.version === c.version;
              return (
                <button key={`${c.code}@${c.version}@${c.wording_version ?? ''}`} type="button" role="option" aria-selected={on} className={`ss-lib-row ${on ? 'on' : ''}`} onClick={() => { setPicked({ kind, code: c.code, version: c.version }); setDone(null); }} data-testid={`ss-library-row-${c.code}-${c.version}`}>
                  <span className="ss-lib-row-top"><strong>{c.title || c.code}</strong>{here(c) ? <Tag tone="shared" glyph="check">In this survey</Tag> : null}</span>
                  {c.description ? <span className="ss-lib-row-desc">{c.description}</span> : null}
                  <span className="ss-lib-row-meta">{CATEGORY[c.category] ?? c.category} · {kind === 'MODULE' ? 'revision' : 'version'} {c.version}{c.is_latest ? ' · latest' : ` · a newer one (${c.latest_published_version}) is published`}</span>
                  <span className="ss-lib-row-meta">Published by {where(c)} · used by {c.used_by.surveys} survey{c.used_by.surveys === 1 ? '' : 's'}</span>
                </button>);
            })}
          </div>
          <div className="ss-lib-preview" data-testid="ss-library-preview" aria-live="polite">
            {!picked ? <p className="ss-muted">Choose a {tab.one} to see everything in it before you add it.</p>
              : !detail ? <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading the preview…</p>
                : (<>
                  <h3 data-testid="ss-library-title">{detail.title || detail.code} <Tag tone="shared" glyph="lock">Published · {kind === 'MODULE' ? 'revision' : 'version'} {detail.version}</Tag></h3>
                  {detail.description ? <p>{detail.description}</p> : null}
                  <dl className="ss-facts">
                    <div><dt>Published by</dt><dd data-testid="ss-library-source">{where(detail)}</dd></div>
                    <div><dt>Used by</dt><dd data-testid="ss-library-usage">{detail.used_by.surveys} survey{detail.used_by.surveys === 1 ? '' : 's'} · {detail.used_by.versions} published version{detail.used_by.versions === 1 ? '' : 's'}</dd></div>
                    <div><dt>Fingerprint</dt><dd><span className="ss-code" title={detail.sha256} data-testid="ss-library-sha">{short(detail.sha256)}</span></dd></div>
                    {detail.derived_from ? <div><dt>Made from</dt><dd><span className="ss-code">{String((detail.derived_from as Any).code)}</span> version {String((detail.derived_from as Any).version)}</dd></div> : null}
                  </dl>
                  <Preview d={detail} />
                  {detail.revisions.length > 1 ? (
                    <div className="ss-lib-revisions" data-testid="ss-library-revisions">
                      <h4>Published revisions</h4>
                      <ul>{detail.revisions.map((r) => (
                        <li key={r.version}><strong>{kind === 'MODULE' ? 'Revision' : 'Version'} {r.version}</strong>{r.version === detail.version ? ' — shown here' : ''} <small>{r.published_in.map((s) => `${s.survey_name} ${s.version_label}`).join('; ')}</small>
                          {r.version !== detail.version ? <> <button type="button" className="ss-link" onClick={() => showCompare(r.version)} data-testid={`ss-library-compare-${r.version}`}>What differs from this one</button> <button type="button" className="ss-link" onClick={() => setPicked({ kind, code: detail.code, version: r.version })} data-testid={`ss-library-show-${r.version}`}>Show it</button></> : null}</li>))}</ul>
                      {compare ? <div className="ss-lib-compare" data-testid="ss-library-compare"><strong>{kind === 'MODULE' ? 'Revision' : 'Version'} {detail.version} compared with {compare.with}</strong>{compare.lines.length ? <ul>{compare.lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p>Nothing differs in what a customer hears or where they are routed.</p>}</div> : null}
                    </div>) : null}
                  {refusal ? <p className="ss-note warn" role="alert" data-testid="ss-library-refusal"><Glyph name="alert" size={14} /><span>{refusal}</span></p> : null}
                  <div className="ss-lib-actions" data-testid="ss-library-actions">
                    {!p.canEdit ? <p className="ss-muted">You can look, but adding to a survey needs the survey.edit permission.</p>
                      : kind === 'MODULE' ? (<>
                        <div><button type="button" className="ss-btn primary" onClick={() => addModule(false)} data-testid="ss-library-add">Add to this survey</button><small>The exact published revision, pinned. Shared and locked: you set when it runs and where it leads, not what is in it.</small></div>
                        <div><button type="button" className="ss-btn" onClick={() => addModule(true)} data-testid="ss-library-copy">Edit a copy for this survey</button><small>A local draft you can change. It gets its own identity when saved and records this revision as its source. The published module is not touched.</small></div></>)
                        : kind === 'OPTION_SET' ? (
                          <div className="ss-lib-use">
                            {draftChoices.length ? (<>
                              <label className="ss-field"><span>Use these answers for</span>
                                <select value={target_} onChange={(e) => setTarget(e.target.value)} data-testid="ss-library-question">
                                  <option value="">Choose a draft question of this survey…</option>
                                  {draftChoices.map((q) => <option key={`${q.code}@${q.version}`} value={`${q.code}@${q.version}`}>{q.wording.text || q.intent || 'Untitled question'}</option>)}
                                </select></label>
                              <button type="button" className="ss-btn primary" disabled={!target_} onClick={useAnswers} data-testid="ss-library-use">Use these answers</button>
                              <small>The question then refers to this published set. Changing an answer afterwards gives the question its own set; this one is never changed.</small></>)
                              : <p className="ss-muted" data-testid="ss-library-no-question">Add a draft question with answers to this survey first: a published answer set is used by a question.</p>}
                          </div>)
                          : (<div><button type="button" className="ss-btn primary" onClick={addPart} disabled={here(detail)} data-testid="ss-library-add">{here(detail) ? 'Already in this survey' : 'Add to this survey'}</button>
                            <small>{kind === 'ITEM' ? 'The exact published question and wording, locked. Place it with “Reuse a question from the library” wherever you add a question; to change it, place it and choose “Create a new version” or “Make a separate question”.' : 'The exact published condition, locked. Each place that uses it supplies its own values.'}</small></div>)}
                  </div>
                </>)}
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Everything in a published component, in words and one table: what a person needs to decide whether to reuse it. */
function Preview({ d }: { d: ComponentDetail }) {
  const doc = d.document as Any;
  const dep = (kind: string, code: string, version: number) => d.dependencies.find((x) => x.kind === kind && x.code === code && x.version === version)?.document as Any;
  if (d.kind === 'MODULE') {
    const conditions = d.dependencies.filter((x) => x.kind === 'CONDITION');
    return (
      <div data-testid="ss-library-module-preview">
        <p className="ss-muted">{(d.facts as Any).questions} question{(d.facts as Any).questions === 1 ? '' : 's'} · {(d.facts as Any).statements} statement{(d.facts as Any).statements === 1 ? '' : 's'} · {(d.facts as Any).decisions} decision point{(d.facts as Any).decisions === 1 ? '' : 's'} · can end as: {((d.facts as Any).outcomes as string[]).map((o) => o.replace(/_/g, ' ').toLowerCase()).join(', ') || 'nothing yet'}</p>
        <table className="ss-table ss-frozen"><thead><tr><th scope="col">Step</th><th scope="col">What is asked or said <em>synthetic · unapproved</em></th><th scope="col">Answers</th><th scope="col">Where it leads</th></tr></thead>
          <tbody>{(doc.nodes as Any[]).map((n) => {
            const edges = (doc.edges as Any[]).filter((e) => e.from === n.node).map((e) => `${e.on === 'ANY' || e.on === 'AFTER_CAPTURE' ? 'then' : e.on} → ${target(e.to)}`).join(' · ');
            if (n.type === 'DECISION') { const c = n.binding ? dep('CONDITION', n.binding.condition.code, n.binding.condition.version) : null; return <tr key={n.node}><td>{n.node}</td><td>Decision: {c?.name ?? 'no condition'}</td><td>—</td><td>{edges}</td></tr>; }
            const item = dep('ITEM', n.item.code, n.item.version), wording = dep('WORDING', n.item.code, n.item.wording_version);
            const os = item?.option_set ? dep('OPTION_SET', item.option_set.code, item.option_set.version) : null;
            return <tr key={n.node}><td>{n.node}{doc.entry === n.node ? <small> · first</small> : null}</td><td>“{String(wording?.text ?? '')}”<small> · {CATEGORY[item?.answer_type] ?? item?.answer_type} · {String(wording?.delivery_mode ?? '').replace(/_/g, ' ').toLowerCase()}</small></td><td>{os ? (os.options as Any[]).map((o) => o.label || o.code).join(' / ') : '—'}</td><td>{edges || <em>by rule</em>}</td></tr>;
          })}</tbody></table>
        {conditions.length ? <p className="ss-muted">Conditions it uses: {conditions.map((c) => String((c.document as Any).name)).join(', ')}.</p> : null}
        {((d.requires.fields ?? []) as string[]).length ? <p className="ss-muted" data-testid="ss-library-requires">Needs this customer or policy information: {((d.requires.fields ?? []) as string[]).map((f) => FIELDS.find((x) => x.code === f)?.label ?? f).join(', ')}.</p> : null}
      </div>);
  }
  if (d.kind === 'ITEM') {
    const wording = dep('WORDING', d.code, d.wording_version ?? 0), os = doc.option_set ? dep('OPTION_SET', doc.option_set.code, doc.option_set.version) : null;
    return (
      <dl className="ss-facts tall" data-testid="ss-library-item-preview">
        <div><dt>Wording <em>synthetic · unapproved</em></dt><dd>“{String(wording?.text ?? '')}” <small>wording version {d.wording_version} · {String(wording?.delivery_mode ?? '').replace(/_/g, ' ').toLowerCase()}</small></dd></div>
        <div><dt>Kind of answer</dt><dd>{CATEGORY[doc.answer_type] ?? doc.answer_type}{doc.response_obligation ? ` · ${String(doc.response_obligation).replace(/_/g, ' ').toLowerCase()}` : ''}{doc.lifecycle_role ? ` · ${String(doc.lifecycle_role).replace(/_/g, ' ').toLowerCase()}` : ''}</dd></div>
        {os ? <div><dt>Answers</dt><dd>{(os.options as Any[]).map((o) => o.label || o.code).join(' / ')}</dd></div> : null}
        {doc.selection ? <div><dt>How many may be chosen</dt><dd>{doc.selection.min} to {doc.selection.max}</dd></div> : null}
        {doc.number_rule ? <div><dt>Number rule</dt><dd>{doc.number_rule.integer ? 'Whole number' : 'Number'}{doc.number_rule.min !== undefined ? `, from ${doc.number_rule.min}` : ''}{doc.number_rule.max !== undefined ? ` to ${doc.number_rule.max}` : ''}{doc.number_rule.unit ? ` ${doc.number_rule.unit}` : ''}</dd></div> : null}
        {doc.text_rule ? <div><dt>Text rule</dt><dd>{doc.text_rule.required ? 'Required' : 'Optional'}, {doc.text_rule.min_length} to {doc.text_rule.max_length} characters</dd></div> : null}
        {doc.intent ? <div><dt>What it establishes</dt><dd>{doc.intent}</dd></div> : null}
      </dl>);
  }
  if (d.kind === 'CONDITION') {
    const params = Object.entries((doc.params ?? {}) as Record<string, Any>), inputs = Object.entries((doc.inputs ?? {}) as Record<string, Any>);
    return (
      <dl className="ss-facts tall" data-testid="ss-library-condition-preview">
        <div><dt>Reads</dt><dd>{((d.facts as Any).fields as string[]).map((f) => FIELDS.find((x) => x.code === f)?.label ?? f).join(', ') || 'No customer or policy information'}</dd></div>
        <div><dt>Values each place supplies</dt><dd>{params.length ? params.map(([k, v]) => `${k} (${String(v.type).toLowerCase()}${v.unit ? `, ${v.unit}` : ''})`).join(', ') : 'None'}</dd></div>
        <div><dt>Earlier answers it reads</dt><dd>{inputs.length ? inputs.map(([k, v]) => `${k} (${CATEGORY[v.answer_type] ?? v.answer_type})`).join(', ') : 'None'}</dd></div>
        <div><dt>The rule</dt><dd><span className="ss-code">{JSON.stringify(doc.ast)}</span></dd></div>
        <div><dt>Its three results</dt><dd>Met · Not met · <strong>Unknown</strong> when something it reads is missing. Unknown is never treated as “not met”: each place says what happens then.</dd></div>
      </dl>);
  }
  return (
    <table className="ss-table" data-testid="ss-library-optionset-preview"><thead><tr><th scope="col">Answer</th><th scope="col">Code</th><th scope="col">Special</th></tr></thead>
      <tbody>{((doc.options ?? []) as Any[]).map((o) => <tr key={o.code}><td>{o.label}</td><td><span className="ss-code">{o.code}</span></td><td>{[o.exclusive ? 'cannot be combined' : '', o.is_other ? 'other, with text' : '', o.interrupt ? `interruption ${String(o.interrupt).toLowerCase()}` : ''].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody></table>);
}

/** What differs between two published revisions, in sentences. `a` is the one on screen. */
export function differences(a: ComponentDetail, b: ComponentDetail): string[] {
  const out: string[] = [];
  const text = (d: ComponentDetail, code: string, wv: number) => String((d.dependencies.find((x) => x.kind === 'WORDING' && x.code === code && x.version === wv)?.document as Any)?.text ?? '');
  if (a.kind === 'MODULE') {
    const an = new Map(((a.document as Any).nodes as Any[]).map((n) => [n.node, n])), bn = new Map(((b.document as Any).nodes as Any[]).map((n) => [n.node, n]));
    for (const [id, n] of an) {
      const o = bn.get(id);
      if (!o) { out.push(`Step ${id} is only in revision ${a.version}.`); continue; }
      if (n.item && o.item) {
        const ta = text(a, n.item.code, n.item.wording_version), tb = text(b, o.item.code, o.item.wording_version);
        if (ta !== tb) out.push(`Step ${id} is worded differently: revision ${a.version} says “${ta}”; revision ${b.version} says “${tb}”.`);
        else if (n.item.code !== o.item.code || n.item.version !== o.item.version) out.push(`Step ${id} uses a different question version.`);
      }
      const ea = JSON.stringify(((a.document as Any).edges as Any[]).filter((e) => e.from === id).map((e) => [e.on, e.to])), eb = JSON.stringify(((b.document as Any).edges as Any[]).filter((e) => e.from === id).map((e) => [e.on, e.to]));
      if (ea !== eb) out.push(`Step ${id} leads somewhere different.`);
    }
    for (const id of bn.keys()) if (!an.has(id)) out.push(`Step ${id} is only in revision ${b.version}.`);
    if (JSON.stringify((a.document as Any).outcomes) !== JSON.stringify((b.document as Any).outcomes)) out.push('The ways the module can end differ.');
    return out;
  }
  if (JSON.stringify(a.document) !== JSON.stringify(b.document)) out.push(a.kind === 'OPTION_SET' ? 'The answers differ.' : a.kind === 'CONDITION' ? 'The rule or its values differ.' : 'The question’s settings differ.');
  if (a.kind === 'ITEM' && text(a, a.code, a.wording_version ?? 0) !== text(b, b.code, b.wording_version ?? 0)) out.push(`The wording differs: “${text(a, a.code, a.wording_version ?? 0)}” against “${text(b, b.code, b.wording_version ?? 0)}”.`);
  return out;
}

export { assetKey };
