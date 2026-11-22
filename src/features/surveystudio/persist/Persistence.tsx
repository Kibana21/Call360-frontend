// Survey Studio (FI-1) — what makes the editor's workspace a SAVED survey: the known server revision it started from,
// an explicit Save, and an explicit resolution when someone else saved first. There is no autosave and nothing is kept
// in browser storage: unsaved edits live in memory (store.tsx) and the author is warned before leaving them.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { MappingError, assetKey, changes, fromDocuments, isEmpty, seqFor, toDocuments, type AssetDoc, type DocumentSet } from '../model/documents';
import { codesNeeded, identitiesToIssue, optionSetsToIssue, recode, withOptionSetCodes, type Lineage } from '../model/library';
import type { Workspace } from '../model/types';
import { useStudio } from '../store';
import { documentsOf, issueCodes, loadDraft, saveDraft, type DraftDocuments } from './api';
import { noteHistoryPosition, passHeldMove, setHistoryGuard } from './historyGuard';
import { compare, onTop, operationsFor, serverHolds, type Comparison, type Details } from './saving';

/** What the editor knows about the server's draft: the revision it started from and the documents at that revision. */
export interface Baseline {
  /** LIB-1: whether this server offers the component library and issues codes. */
  library?: boolean;
  surveyId: string; code: string; revision: number;
  /** The server's documents in the editor's own form (what `toDocuments` gives for the loaded workspace). */
  editor: DocumentSet;
  frozen: Set<string>; owned: Set<string>; details: Details;
  updatedAt: string; updatedBy: string | null; note: string; versionLabel: string;
}

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'failed' | 'conflict';
export interface SaveError { message: string; code?: string; network: boolean; where?: string; /** The server answered and may have saved: do not say nothing changed there. */ unconfirmed?: boolean }
export interface Conflict { latest: DraftDocuments; server: DocumentSet; comparison: Comparison; open: boolean }

export interface Persistence {
  surveyId: string; code: string; status: SaveStatus; revision: number; savedAt: string; savedBy: string | null;
  canEdit: boolean; dirty: boolean; changed: number; error: SaveError | null; mappingError: string | null;
  conflict: Conflict | null; note: string; lastSavedNotice: string | null;
  save: () => Promise<void>;
  reloadServerDraft: () => void;
  saveOnTop: () => Promise<void>;
  keepEditing: () => void;
  openConflict: () => void;
  /**
   * FI-2: read the saved draft again and show it. Used after a submission, which freezes the versions the draft pins:
   * the editor must then treat them as published (a change is a new version). Refused while there is unsaved work.
   */
  refreshFromServer: () => Promise<void>;
  /** LIB-1: true when the server offers the component library. */
  library: boolean;
  /**
   * LIB-1: tell the save logic that these documents are published versions the server already has (brought in from the
   * library). They are never sent, and never owned by this survey.
   */
  adopt: (added: AssetDoc[]) => void;
}

const Ctx = createContext<Persistence | null>(null);
/** The persistence of the open survey, or null in the in-memory prototype. */
export const usePersistence = (): Persistence | null => useContext(Ctx);

export const versionLabelOf = (latest: string | null | undefined) => (latest ? `${latest}+` : '0.1');

/** The baseline and the workspace for a draft the server returned. Throws MappingError when the editor cannot show it. */
export function open(d: DraftDocuments, versionLabel: string, library = false): { baseline: Baseline; ws: Workspace } {
  const s = documentsOf(d);
  const ws = fromDocuments(s.set, { meta: { name: d.name, purpose: d.purpose, versionLabel }, frozen: s.frozen, seq: seqFor(d.code, s.set) });
  const editor = toDocuments(ws, ws.surveys[0]!);
  return { ws, baseline: { library, surveyId: d.survey_id, code: d.code, revision: d.revision, editor, frozen: s.frozen, owned: s.owned, details: { name: d.name, purpose: d.purpose }, updatedAt: d.updated_at, updatedBy: d.updated_by ?? null, note: d.note, versionLabel } };
}

/**
 * What the server's reply must hold for a save to count: the content and every document of the survey's own. A published
 * version brought in from the library but not placed is held in the editor only; the server neither stores it for this
 * survey nor returns it, so it is not expected back.
 */
const mustHold = (intended: DocumentSet, b: Baseline): DocumentSet => ({ content: intended.content, assets: intended.assets.filter((a) => !(b.frozen.has(assetKey(a)) && !b.owned.has(assetKey(a)))) });
const MISMATCH = 'The server answered, but its saved draft does not match what was sent. Your changes are still here; reload the page to see what the server has.';

const describe = (e: unknown): SaveError => {
  if (e instanceof ApiFailure) {
    const first = (e.body?.details as Array<Record<string, unknown>> | undefined)?.[0];
    const where = first && typeof first.operation_index === 'number' ? `${String(first.kind ?? first.op ?? 'operation')} (item ${Number(first.operation_index) + 1} of this save)` : undefined;
    const message = e.status === 403 ? 'You do not have permission to save this survey.' : e.status === 401 ? 'Your session has ended. Sign in again; your changes are still here.' : e.message;
    return { message, code: e.code, network: false, where };
  }
  return { message: 'The server could not be reached. Nothing was lost: your changes are still here.', network: true };
};

export function PersistenceProvider({ initial, onBaseline, children }: { initial: Baseline; onBaseline: (b: Baseline) => void; children: ReactNode }) {
  const { ws, replace, apply } = useStudio();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  /** Codes the server issued in this session, saved or not (`KIND:code`). */
  const issuedRef = useRef(new Set<string>());
  const { can } = useAuth();
  const [baseline, setBaselineState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /** The documents of a save whose reply never arrived: checked against the server before anything is sent again. */
  const unconfirmed = useRef<{ intended: DocumentSet; details: Details; from: number } | null>(null);
  const baseRef = useRef(baseline);
  const setBaseline = useCallback((b: Baseline) => { baseRef.current = b; setBaselineState(b); onBaseline(b); }, [onBaseline]);

  const survey = ws.surveys[0]!;
  const current = useMemo((): { set: DocumentSet | null; problem: string | null } => {
    try { return { set: toDocuments(ws, survey), problem: null }; } catch (e) { if (e instanceof MappingError) return { set: null, problem: e.message }; throw e; }
  }, [ws, survey]);
  const details: Details = useMemo(() => ({ name: survey.name, purpose: survey.purpose }), [survey.name, survey.purpose]);
  const detailsChanged = details.name !== baseline.details.name || details.purpose !== baseline.details.purpose;
  const change = useMemo(() => {
    if (!current.set) return null;
    const c = changes(baseline.editor, current.set);
    return { ...c, put: c.put.filter((a) => !baseline.frozen.has(assetKey(a))) }; // a frozen version never counts as a change
  }, [baseline.editor, baseline.frozen, current.set]);
  const changed = (change ? change.put.length + change.remove.length + (change.content ? 1 : 0) : 0) + (detailsChanged ? 1 : 0);
  const dirty = changed > 0 || current.set === null;
  const live = useRef({ current, details, detailsChanged });
  live.current = { current, details, detailsChanged };

  const adopt = useCallback((d: DraftDocuments, editor: DocumentSet) => {
    const s = documentsOf(d);
    setBaseline({ ...baseRef.current, revision: d.revision, editor, frozen: s.frozen, owned: s.owned, details: { name: d.name, purpose: d.purpose }, updatedAt: d.updated_at, updatedBy: d.updated_by ?? null });
    unconfirmed.current = null;
    setError(null);
    setConflict(null);
    setSaved(`Saved as revision ${d.revision}`);
  }, [setBaseline]);

  const raise = useCallback((latest: DraftDocuments, mine: DocumentSet) => {
    const b = baseRef.current;
    const server = open(latest, b.versionLabel, b.library).baseline.editor;
    setError(null);
    setConflict({ latest, server, comparison: compare(b.editor, mine, server), open: true });
  }, []);

  const save = useCallback(async () => {
    const b = baseRef.current;
    const { current: cur, details: det, detailsChanged: detCh } = live.current;
    if (busy || !cur.set) return;
    let intended = cur.set;
    setBusy(true);
    setSaved(null);
    try {
      if (b.library) {
        // LIB-1: nothing the editor numbered itself is ever saved. Every new module, question, condition and answer set
        // gets the code the server issues for it, and every reference to it is changed with it, before anything is sent.
        const lineage: Lineage = { known: new Map(b.editor.assets.map((a) => [assetKey(a), { owned: b.owned.has(assetKey(a)) }])), issued: issuedRef.current };
        let w = wsRef.current;
        const needs = identitiesToIssue(w, lineage);
        if (needs.length) {
          const groups = codesNeeded(needs);
          const got = await issueCodes(b.surveyId, groups.map((g) => ({ kind: g.kind, count: g.count })));
          const issued = new Map<string, string>();
          for (const g of groups) { const mine = got.filter((x) => x.kind === g.kind).map((x) => x.code); g.keys.forEach((key, i) => { issued.set(key, mine[i]!); issuedRef.current.add(`${key.split(':')[0]}:${mine[i]!}`); }); }
          w = recode(w, needs, issued, lineage);
        }
        const sets = optionSetsToIssue(w, lineage);
        if (sets.length) {
          const got = (await issueCodes(b.surveyId, [{ kind: 'OPTION_SET', count: sets.length }])).map((x) => x.code);
          got.forEach((c) => issuedRef.current.add(`OPTION_SET:${c}`));
          w = withOptionSetCodes(w, sets, got);
        }
        if (w !== wsRef.current) {
          const next = w;
          apply('Gave new items their permanent codes', () => next);
          wsRef.current = next;
          intended = toDocuments(next, next.surveys[0]!);
        }
      }
      // a save whose reply was lost: ask the server what it has before sending anything again
      const u = unconfirmed.current;
      if (u) {
        const latest = await loadDraft(b.surveyId);
        const s = documentsOf(latest);
        if (latest.revision === u.from + 1 && serverHolds(s.set, mustHold(u.intended, b)) && latest.name === u.details.name && latest.purpose === u.details.purpose) {
          adopt(latest, u.intended); // it HAD been saved: nothing is sent twice
          return;
        }
        if (latest.revision !== b.revision) { unconfirmed.current = null; raise(latest, intended); return; }
        unconfirmed.current = null; // the server never received it: send it now
      }
      const ops = operationsFor(b.editor, intended, { removable: new Set([...b.owned].filter((k) => !b.frozen.has(k))), details: detCh ? det : null, frozen: b.frozen });
      if (!ops.length) { setError(null); return; }
      let reply: DraftDocuments;
      try { reply = await saveDraft(b.surveyId, b.revision, ops); }
      catch (e) {
        if (e instanceof ApiFailure && e.status === 409 && e.code === 'STALE_DRAFT') { raise(await loadDraft(b.surveyId), intended); return; }
        const problem = describe(e);
        if (problem.network) unconfirmed.current = { intended, details: det, from: b.revision };
        setError(problem);
        return;
      }
      // saved only when the server's reply holds every document that was sent
      if (!serverHolds(documentsOf(reply).set, mustHold(intended, b))) { setError({ message: MISMATCH, network: false, unconfirmed: true }); return; }
      adopt(reply, intended);
    } catch (e) { setError(describe(e)); } finally { setBusy(false); }
  }, [busy, adopt, raise, apply]);

  const reloadServerDraft = useCallback(() => {
    const c = conflict;
    if (!c) return;
    const o = open(c.latest, baseRef.current.versionLabel, baseRef.current.library);
    setBaseline(o.baseline);
    setConflict(null);
    setError(null);
    unconfirmed.current = null;
    replace(o.ws, `Loaded the newer saved draft (revision ${c.latest.revision})`);
  }, [conflict, replace, setBaseline]);

  const saveOnTop = useCallback(async () => {
    const c = conflict, b = baseRef.current;
    const { current: cur, details: det, detailsChanged: detCh } = live.current;
    if (!c || !cur.set || busy) return;
    setBusy(true);
    try {
      const target = onTop(b.editor, cur.set, c.server);
      const s = documentsOf(c.latest);
      const ops = operationsFor(c.server, target, { removable: new Set([...s.owned].filter((k) => !s.frozen.has(k))), details: detCh ? det : null });
      let reply: DraftDocuments;
      if (ops.length) {
        try { reply = await saveDraft(b.surveyId, c.latest.revision, ops); }
        catch (e) {
          if (e instanceof ApiFailure && e.status === 409 && e.code === 'STALE_DRAFT') { raise(await loadDraft(b.surveyId), cur.set); return; }
          setError(describe(e));
          setConflict({ ...c, open: false });
          return;
        }
      } else reply = c.latest;
      if (!serverHolds(documentsOf(reply).set, mustHold(target, b))) { setError({ message: MISMATCH, network: false, unconfirmed: true }); return; }
      const o = open(reply, b.versionLabel, b.library);
      setBaseline(o.baseline);
      setConflict(null);
      setError(null);
      unconfirmed.current = null;
      setSaved(`Saved as revision ${reply.revision}`);
      replace(o.ws, `Saved your changes on top of revision ${c.latest.revision}`);
    } catch (e) { setError(describe(e)); } finally { setBusy(false); }
  }, [conflict, busy, raise, replace, setBaseline]);

  const refreshFromServer = useCallback(async () => {
    if (live.current.current.set === null || !isEmpty(changes(baseRef.current.editor, live.current.current.set)) || live.current.detailsChanged) return;
    const o = open(await loadDraft(baseRef.current.surveyId), baseRef.current.versionLabel, baseRef.current.library);
    setBaseline(o.baseline);
    replace(o.ws, 'The versions this draft pins are now frozen: a change to one is a new version');
  }, [replace, setBaseline]);

  const adoptPublished = useCallback((added: AssetDoc[]) => {
    const b = baseRef.current;
    const have = new Set(b.editor.assets.map(assetKey));
    const fresh = added.filter((a) => !have.has(assetKey(a)));
    if (!fresh.length) return;
    setBaseline({ ...b, editor: { ...b.editor, assets: [...b.editor.assets, ...fresh] }, frozen: new Set([...b.frozen, ...fresh.map(assetKey)]) });
  }, [setBaseline]);

  const keepEditing = useCallback(() => setConflict((c) => (c ? { ...c, open: false } : c)), []);
  const openConflict = useCallback(() => setConflict((c) => (c ? { ...c, open: true } : c)), []);

  // leaving the page (reload, close, another site) with unsaved work asks first; the browser shows its own wording
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const status: SaveStatus = busy ? 'saving' : conflict ? 'conflict' : error ? 'failed' : dirty ? 'unsaved' : 'saved';
  const value = useMemo<Persistence>(() => ({
    surveyId: baseline.surveyId, code: baseline.code, status, revision: baseline.revision, savedAt: baseline.updatedAt, savedBy: baseline.updatedBy,
    canEdit: can('survey.edit'), dirty, changed, error, mappingError: current.problem, conflict, note: baseline.note, lastSavedNotice: status === 'saved' ? saved : null,
    save, reloadServerDraft, saveOnTop, keepEditing, openConflict, refreshFromServer, library: !!baseline.library, adopt: adoptPublished,
  }), [baseline, status, can, dirty, changed, error, current.problem, conflict, saved, save, reloadServerDraft, saveOnTop, keepEditing, openConflict, refreshFromServer, adoptPublished]);

  return <Ctx.Provider value={value}>{children}<LeaveGuard dirty={dirty} code={baseline.code} /></Ctx.Provider>;
}

/**
 * Leaving this survey with unsaved work asks first — by a link, or by the browser's Back or Forward button. Staying
 * changes nothing at all: the workspace, its undo history and the open screen are untouched. Leaving does not discard
 * the changes either: they stay in memory for as long as this page is open and are still here, unsaved, on coming
 * back; the saved revision on the server is not touched. They are lost only by closing or reloading the page, which the
 * browser itself asks about.
 */
function LeaveGuard({ dirty, code }: { dirty: boolean; code: string }) {
  const nav = useNavigate();
  const location = useLocation();
  const [to, setTo] = useState<{ href: string } | { delta: number } | null>(null);
  const stay = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const inside = `/survey-studio/surveys/${code}`;
    const within = (pathname: string) => pathname === inside || pathname.startsWith(`${inside}/`);
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.origin !== window.location.origin) return;
      if (within(a.pathname)) return;
      e.preventDefault();
      e.stopPropagation();
      setTo({ href: a.pathname + a.search + a.hash });
    };
    document.addEventListener('click', onClick, true);
    setHistoryGuard({ inside: within, onBlocked: (delta) => setTo({ delta }) });
    return () => { document.removeEventListener('click', onClick, true); setHistoryGuard(null); };
  }, [dirty, code]);
  useEffect(() => { noteHistoryPosition(); }, [location]);
  useEffect(() => { if (to) stay.current?.focus(); }, [to]);
  if (!to) return null;
  const leave = () => { const dest = to; setTo(null); if ('href' in dest) nav(dest.href); else passHeldMove(dest.delta); };
  return (
    <div className="ss-modal-back" data-testid="ss-leave" data-via={'href' in to ? 'link' : 'history'}>
      <div className="ss-modal" role="dialog" aria-modal="true" aria-labelledby="ss-leave-title" onKeyDown={(e) => { if (e.key === 'Escape') setTo(null); }}>
        <h2 id="ss-leave-title">You have unsaved changes</h2>
        <p>They have not been saved to Call360. If you leave now they stay in this browser tab only, and are lost if the tab is closed or reloaded. The saved revision is not changed either way.</p>
        <div className="ss-actions">
          <button type="button" className="ss-btn primary" ref={stay} onClick={() => setTo(null)} data-testid="ss-leave-stay">Stay and keep editing</button>
          <button type="button" className="ss-btn" onClick={leave} data-testid="ss-leave-go">Leave without saving</button>
        </div>
      </div>
    </div>
  );
}

export { assetKey, isEmpty };
