// Survey Applicability (APPL-X2) — the governed LIBRARY: variables, application profiles and reusable conditions are
// saved in Call360 and published by three different signed-in people. This file is the only place that talks to the
// library API. The screens keep working on the copy in the tab; this file knows which items differ from what is saved,
// saves them with the revision they were opened at (never over someone else's work), and runs the real lifecycle.
// The server decides who may do what; what is offered here only mirrors it. Applicability POLICIES are not saved yet.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiFailure, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useAuth } from '../../auth/AuthContext';
import type { Condition, Profile, Variable } from './model/types';
import { useAppl } from './store';
import { Icon, Tag } from './ui';

export const libraryOn = (): boolean => import.meta.env.VITE_APPLICABILITY_LIBRARY === '1';
export type Kind = 'VARIABLE' | 'PROFILE' | 'CONDITION';
export type Asset = components['schemas']['ApplicabilityAsset'];
export type AssetDetail = components['schemas']['ApplicabilityAssetDetail'];
export type Pin = components['schemas']['ApplicabilityPin'];
type Item = Variable | Profile | Condition;
type Doc = Record<string, unknown>;
const A = '/api/v1/applicability';
export const keyOf = (kind: Kind, code: string) => `${kind}:${code}`;
const WORD: Record<Kind, string> = { VARIABLE: 'variable', PROFILE: 'profile', CONDITION: 'condition' };
const MANAGED = ['code', 'version', 'status', 'markets', 'previous', 'history', 'asset_id', 'version_id', 'fingerprint'];

/** The part of an item that is ITS definition: what is saved. Version, status and identity are the server's. */
export const documentOf = (item: Item): Doc => Object.fromEntries(Object.entries(item as unknown as Doc).filter(([k]) => !MANAGED.includes(k)));
/** Two definitions compared the way the server stores them: empty fields do not count, a derived variable's source is "derived". */
const clean = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(clean);
  if (x && typeof x === 'object') {
    const o = Object.entries(x as Doc).map(([k, v]) => [k, clean(v)] as const).filter(([, v]) => !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as Doc).length)));
    return Object.fromEntries(o.sort(([a], [b]) => a.localeCompare(b)));
  }
  return typeof x === 'string' ? x.trim() : x;
};
const shape = (kind: Kind, doc: Doc): string => {
  const d = clean(doc) as Doc;
  if (kind === 'VARIABLE') {
    const src = { status: 'UNMAPPED', ...((d.source as Doc) ?? {}) };
    if (d.derived) src.status = 'DERIVED';
    d.source = src;
    if (Array.isArray(d.values)) d.values = (d.values as Doc[]).map((o) => ({ label: o.label ?? o.value, value: o.value }));
  }
  return JSON.stringify(clean(d));
};

export type SaveState = 'new' | 'unsaved' | 'saving' | 'saved' | 'stale' | 'conflict' | 'error';
export interface ItemState {
  asset?: Asset; dirty: boolean; isNew: boolean; save: SaveState; message?: string;
  /** who saved the revision that is in the way, and which revision it is */
  conflict?: { revision: number; by: string };
}
interface Library {
  on: boolean; status: 'off' | 'loading' | 'ready' | 'forbidden' | 'unavailable'; reason?: string; market: string;
  assets: Asset[]; state: (kind: Kind, code: string) => ItemState;
  refresh: () => Promise<void>;
  /** `item`: what to save when it was changed in the same click and the tab has not caught up yet */
  save: (kind: Kind, code: string, opts?: { overwrite?: boolean; item?: Variable | Profile | Condition }) => Promise<boolean>;
  /** drop what was changed in this tab and show what is saved */
  reload: (kind: Kind, code: string) => Promise<void>;
  /** `pins`: the exact versions the person was shown; the server refuses if what would be frozen differs */
  submit: (asset: Asset, note: string, pins: Pin[]) => Promise<boolean>;
  decide: (asset: Asset, verdict: 'APPROVE' | 'RETURN', comment: string) => Promise<boolean>;
  publish: (asset: Asset) => Promise<boolean>;
  withdraw: (asset: Asset, reason: string) => Promise<boolean>;
  discard: (asset: Asset) => Promise<boolean>;
  unsaved: number;
}
const OFF: Library = {
  on: false, status: 'off', market: 'SG', assets: [], state: () => ({ dirty: false, isNew: false, save: 'saved' }), refresh: async () => {},
  save: async () => true, reload: async () => {}, submit: async () => false, decide: async () => false, publish: async () => false, withdraw: async () => false, discard: async () => false, unsaved: 0,
};
const Ctx = createContext<Library>(OFF);
export const useLibrary = () => useContext(Ctx);
const why = (e: unknown) => (e instanceof ApiFailure ? e.message : e instanceof Error ? e.message : 'The request failed');

export function LibraryProvider({ children }: { children: ReactNode }) {
  const on = libraryOn();
  const s = useAppl();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const market = me?.markets?.[0] ?? 'SG';
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState<Library['status']>(on ? 'loading' : 'off');
  const [reason, setReason] = useState<string>();
  const [flags, setFlags] = useState<Record<string, { save: SaveState; message?: string; conflict?: ItemState['conflict'] }>>({});
  /** the draft revision each item in the tab was taken from */
  const base = useRef<Record<string, number>>({});
  const first = useRef(true);
  const latest = useRef({ data: s.data, assets });
  latest.current = { data: s.data, assets };
  const mayRead = can('applicability.read');

  const local = useCallback((kind: Kind, code: string, data = latest.current.data): Item | undefined =>
    (kind === 'VARIABLE' ? data.variables : kind === 'PROFILE' ? data.profiles : data.conditions).find((x) => x.code === code), []);
  const serverDoc = (a: Asset | undefined): Doc | null => (a ? ((a.draft?.document ?? a.published?.document ?? null) as Doc | null) : null);
  const dirtyOf = useCallback((kind: Kind, code: string, list: Asset[], data = latest.current.data): { dirty: boolean; isNew: boolean; asset?: Asset } => {
    const asset = list.find((a) => a.kind === kind && a.code === code);
    const item = local(kind, code, data);
    if (!item) return { dirty: false, isNew: false, asset };
    const saved = serverDoc(asset);
    if (!saved) return { dirty: true, isNew: true, asset };
    return { dirty: shape(kind, documentOf(item)) !== shape(kind, saved), isNew: false, asset };
  }, [local]);

  const refresh = useCallback(async (force: string[] = []) => {
    if (!on) return;
    if (!mayRead) { setStatus('forbidden'); return; }
    try {
      const [list, ws] = await Promise.all([
        unwrap(await api.GET(`${A}/assets`, {})),
        unwrap(await api.GET(`${A}/workspace`, { params: { query: { market_code: market, view: 'authoring' } } })),
      ]);
      const mine = list.items.filter((a) => a.market_code === market);
      // what was changed in this tab and not saved stays as it is; everything else becomes what is saved
      const keep = new Set<string>();
      if (!first.current) {
        const { data } = latest.current;
        (['VARIABLE', 'PROFILE', 'CONDITION'] as Kind[]).forEach((kind) => (kind === 'VARIABLE' ? data.variables : kind === 'PROFILE' ? data.profiles : data.conditions).forEach((x) => {
          const k = keyOf(kind, x.code);
          if (!force.includes(k) && dirtyOf(kind, x.code, mine).dirty) keep.add(k);
        }));
      }
      mine.forEach((a) => { const k = keyOf(a.kind, a.code); if (!keep.has(k)) base.current[k] = a.draft_revision; });
      s.adoptLibrary(ws as unknown as { variables: Variable[]; profiles: Profile[]; conditions: Condition[] }, keep);
      first.current = false;
      setAssets(mine); setStatus('ready'); setReason(undefined);
      void qc.invalidateQueries({ queryKey: ['appl-lib-detail'] });
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 403) setStatus('forbidden'); else { setStatus('unavailable'); setReason(why(e)); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the store's adoptLibrary is stable
  }, [on, mayRead, market, dirtyOf, qc]);
  useEffect(() => { void refresh(); }, [refresh]);
  // someone else may have approved or published meanwhile: read again when the person comes back to this tab
  useEffect(() => {
    if (!on) return undefined;
    const back = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', back); document.addEventListener('visibilitychange', back);
    return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
  }, [on, refresh]);

  const flag = (k: string, v: { save: SaveState; message?: string; conflict?: ItemState['conflict'] } | null) => setFlags((f) => { const n = { ...f }; if (v) n[k] = v; else delete n[k]; return n; });
  const run = useCallback(async (k: string, work: () => Promise<unknown>, done: string): Promise<boolean> => {
    flag(k, { save: 'saving' });
    try { await work(); await refresh([k]); flag(k, null); s.say(done); return true; }
    catch (e) {
      if (e instanceof ApiFailure && e.status === 409 && (e.code === 'STALE_REVISION' || e.code === 'DRAFT_EXISTS')) {
        const d = (e.body?.details as { current_revision?: number; updated_by?: string }[] | undefined)?.[0];
        await refresh();
        flag(k, { save: 'conflict', message: e.message, conflict: { revision: d?.current_revision ?? 0, by: d?.updated_by ?? 'someone else' } });
      } else if (e instanceof ApiFailure && e.code === 'PINS_CHANGED') { flag(k, null); s.say('Not submitted: something this reads has a newer published version. Review the exact versions again.', 'warn'); await refresh();
      } else { flag(k, { save: 'error', message: why(e) }); s.say(why(e), 'warn'); await refresh(); }
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const save = useCallback(async (kind: Kind, code: string, opts?: { overwrite?: boolean; item?: Item }) => {
    const k = keyOf(kind, code);
    const item = opts?.item ?? local(kind, code);
    if (!item) return false;
    const document = documentOf(item);
    return run(k, async () => {
      const asset = latest.current.assets.find((a) => a.kind === kind && a.code === code);
      if (!asset) { unwrap(await api.POST(`${A}/assets`, { body: { market_code: market, kind, code, document } })); return; }
      const path = { asset_id: asset.id };
      let revision = opts?.overwrite ? asset.draft_revision : base.current[k] ?? asset.draft_revision;
      // a published item has no draft until someone changes it: saving starts one from the published version
      if (!asset.draft) revision = unwrap(await api.POST(`${A}/assets/{asset_id}/draft`, { params: { path }, body: {} })).draft!.revision;
      unwrap(await api.PUT(`${A}/assets/{asset_id}/draft`, { params: { path }, body: { expected_revision: revision, document } }));
    }, `${item.name} saved as a draft in the library`);
  }, [local, market, run]);
  const reload = useCallback(async (kind: Kind, code: string) => { const k = keyOf(kind, code); await refresh([k]); flag(k, null); }, [refresh]);
  const act = (asset: Asset, work: () => Promise<unknown>, done: string) => run(keyOf(asset.kind, asset.code), work, done);
  const submit = (asset: Asset, note: string, pins: Pin[]) => act(asset, async () => unwrap(await api.POST(`${A}/assets/{asset_id}/submit`, { params: { path: { asset_id: asset.id } }, body: { expected_revision: asset.draft_revision, note, pins: pins.map((p) => ({ kind: p.kind as Kind, code: p.code, version_no: p.version_no })) } })), `${asset.name} submitted for review`);
  const decide = (asset: Asset, verdict: 'APPROVE' | 'RETURN', comment: string) => act(asset, async () => unwrap(await api.POST(`${A}/candidates/{candidate_id}/decision`, { params: { path: { candidate_id: asset.candidate!.id } }, body: { verdict, comment } })), verdict === 'APPROVE' ? `${asset.name} approved` : `${asset.name} returned to its author`);
  const publish = (asset: Asset) => act(asset, async () => unwrap(await api.POST(`${A}/candidates/{candidate_id}/publish`, { params: { path: { candidate_id: asset.candidate!.id } } })), `${asset.name} published`);
  const withdraw = (asset: Asset, reason_: string) => act(asset, async () => unwrap(await api.POST(`${A}/candidates/{candidate_id}/withdraw`, { params: { path: { candidate_id: asset.candidate!.id } }, body: { reason: reason_ } })), `${asset.name} withdrawn from review`);
  const discard = (asset: Asset) => act(asset, async () => unwrap(await api.POST(`${A}/assets/{asset_id}/draft/discard`, { params: { path: { asset_id: asset.id } }, body: { expected_revision: asset.draft_revision } })), `The draft of ${asset.name} was discarded`);

  const value = useMemo<Library>(() => {
    if (!on) return OFF;
    const state = (kind: Kind, code: string): ItemState => {
      const k = keyOf(kind, code);
      const d = dirtyOf(kind, code, assets, s.data);
      const f = flags[k];
      const moved = d.dirty && !d.isNew && d.asset && base.current[k] !== undefined && base.current[k] !== d.asset.draft_revision;
      const saveState: SaveState = f?.save === 'saving' ? 'saving' : f?.save === 'conflict' && d.dirty ? 'conflict' : f?.save === 'error' && d.dirty ? 'error' : d.isNew ? 'new' : moved ? 'stale' : d.dirty ? 'unsaved' : 'saved';
      return { ...d, save: saveState, message: f?.message, // say who and which revision from what is saved NOW: the refusal itself does not always carry it
        conflict: (f?.save === 'conflict' || moved) && d.asset ? { revision: d.asset.draft?.revision ?? f?.conflict?.revision ?? d.asset.draft_revision, by: d.asset.draft?.updated_by ?? f?.conflict?.by ?? 'Someone else' } : f?.conflict };
    };
    const all: [Kind, { code: string }[]][] = [['VARIABLE', s.data.variables], ['PROFILE', s.data.profiles], ['CONDITION', s.data.conditions]];
    const unsaved = all.reduce((n, [kind, list]) => n + list.filter((x) => dirtyOf(kind, x.code, assets, s.data).dirty).length, 0);
    return { on, status, reason, market, assets, state, refresh: () => refresh(), save, reload, submit, decide, publish, withdraw, discard, unsaved };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, status, reason, market, assets, flags, s.data, dirtyOf, refresh, save, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssetDetail(asset: Asset | undefined, open: boolean) {
  return useQuery({
    queryKey: ['appl-lib-detail', asset?.id, asset?.draft_revision, asset?.state], enabled: !!asset && open, staleTime: 15_000,
    queryFn: async () => unwrap(await api.GET(`${A}/assets/{asset_id}`, { params: { path: { asset_id: asset!.id } } })),
  });
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const EVENT: Record<string, string> = { CREATED: 'Created', DRAFT_SAVED: 'Draft saved', DRAFT_STARTED: 'New draft started', DRAFT_DISCARDED: 'Draft discarded', SUBMITTED: 'Submitted for review', APPROVED: 'Approved', RETURNED: 'Returned to the author', WITHDRAWN: 'Withdrawn from review', PUBLISHED: 'Published', SUPERSEDED: 'Replaced by a newer version', DENIED: 'Refused' };
const RULE: Record<string, string> = { SELF_REVIEW_DENIED: 'the submitter tried to decide their own candidate', SELF_PUBLISH_DENIED: 'the submitter tried to publish', APPROVER_PUBLISH_DENIED: 'the approver tried to publish' };

/** Where one library item stands — saved or not, in review, published — and what the signed-in person can do next. */
export function LibraryBar({ kind, code, compact = false }: { kind: Kind; code: string; compact?: boolean }) {
  const lib = useLibrary();
  const { can, me } = useAuth();
  const [more, setMore] = useState(false);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState<null | 'RETURN' | 'SUBMIT' | 'WITHDRAW'>(null);
  const st = lib.state(kind, code);
  const a = st.asset;
  const open = !compact && (more || (!!a && !st.dirty));
  const detail = useAssetDetail(a, open);
  // Owner ruling A4: before submitting, the person sees the exact versions and fingerprints that would be frozen —
  // read from the server at that moment — and confirms them. Nothing is upgraded silently.
  const frozen = useQuery({
    queryKey: ['appl-lib-pins', a?.id, a?.draft_revision, asking === 'SUBMIT'], enabled: !!a && asking === 'SUBMIT', staleTime: 0, gcTime: 0,
    queryFn: async () => unwrap(await api.POST(`${A}/assets/{asset_id}/validate`, { params: { path: { asset_id: a!.id } }, body: {} })),
  });
  const [seen, setSeen] = useState(false);
  if (!lib.on) return null;
  if (lib.status === 'forbidden') return <div className="ap-lib" data-testid="ap-lib" data-state="forbidden"><Tag tone="warn">Read only</Tag><span className="ap-quiet">You are not permitted to read the saved library. Ask for the applicability permissions.</span></div>;
  const cand = a?.candidate ?? null;
  const blockers = (detail.data?.diagnostics ?? []).filter((d) => d.severity === 'BLOCKER');
  const word = WORD[kind];
  const state = st.save === 'saving' ? 'saving' : st.save === 'conflict' || st.save === 'stale' ? 'conflict' : st.save === 'error' ? 'error' : st.isNew ? 'new' : st.dirty ? 'unsaved' : (a?.state ?? 'EMPTY').toLowerCase();
  const locked = !!cand;
  const head = () => {
    if (state === 'saving') return <Tag tone="info" testid="ap-lib-tag">Saving…</Tag>;
    if (state === 'conflict') return <Tag tone="bad" testid="ap-lib-tag">Not saved — someone else saved first</Tag>;
    if (state === 'error') return <Tag tone="bad" testid="ap-lib-tag">Not saved</Tag>;
    if (state === 'new') return <Tag tone="warn" testid="ap-lib-tag">Not saved yet — only in this tab</Tag>;
    if (state === 'unsaved') return <Tag tone="warn" testid="ap-lib-tag">Unsaved changes</Tag>;
    if (state === 'in_review') return <Tag tone="info" testid="ap-lib-tag">Submitted — in review</Tag>;
    if (state === 'approved') return <Tag tone="info" testid="ap-lib-tag">Approved — waiting for a publisher</Tag>;
    if (state === 'returned') return <Tag tone="warn" testid="ap-lib-tag">Returned to the author</Tag>;
    if (state === 'draft') return <Tag tone="draft" testid="ap-lib-tag">Draft saved{a?.published ? ` — version ${a.published.version_no} stays published` : ''}</Tag>;
    return <Tag tone="published" testid="ap-lib-tag">Version {a?.published?.version_no} published</Tag>;
  };
  const says = () => {
    if (state === 'conflict') return `${st.conflict?.by ?? 'Someone else'} saved revision ${st.conflict?.revision ?? ''} of this ${word} after you opened it${st.conflict?.by === me?.principal.display_name ? ' (in another tab or window)' : ''}. Nothing of yours was saved and nothing of theirs was overwritten.`;
    if (state === 'error') return st.message ?? 'The save failed.';
    if (state === 'new') return `This ${word} exists only in this browser tab. Save it to keep it.`;
    if (state === 'unsaved') return locked ? 'It is in review, so it cannot be changed until it is returned, withdrawn or published.' : a?.published && !a.draft ? `Saving starts draft version ${(a.published.version_no ?? 0) + 1}. Published version ${a.published.version_no} does not change.` : 'What you changed is only in this tab until you save it.';
    if (state === 'in_review') return `Submitted by ${cand?.submitted_by}${cand?.is_submitter ? ' (you)' : ''} on ${when(cand?.submitted_at)}. Someone else must approve it.`;
    if (state === 'approved') return `Approved by ${cand?.decided_by}${cand?.is_approver ? ' (you)' : ''}. A third person — not ${cand?.submitted_by}, not ${cand?.decided_by} — must publish it.`;
    if (state === 'returned') return `${a?.returned?.decided_by} returned it: “${a?.returned?.decision_comment}”. Change it and submit again.`;
    if (state === 'draft') return `Saved in Call360${a?.draft?.updated_by ? ` by ${a.draft.updated_by}` : ''}, revision ${a?.draft?.revision}. It is not published: nothing published can read it yet.`;
    return a?.published ? `Published by ${a.published.published_by} on ${when(a.published.published_at)}. Changing it starts a new draft; this version never changes.` : '';
  };
  const ask = (what: 'RETURN' | 'SUBMIT' | 'WITHDRAW') => { setText(''); setAsking(what); };
  const base = a?.published?.pins ?? [];
  const moved = (p: Pin) => { const was = base.find((x) => x.kind === p.kind && x.code === p.code); return was && was.version_no !== p.version_no ? was.version_no : null; };
  const confirm = async () => {
    if (!a || !asking) return;
    const ok = asking === 'RETURN' ? await lib.decide(a, 'RETURN', text) : asking === 'SUBMIT' ? await lib.submit(a, text, frozen.data?.pins ?? []) : await lib.withdraw(a, text);
    setSeen(false); if (asking === 'SUBMIT' && !ok) void frozen.refetch();
    if (ok) setAsking(null);
  };
  const clean_ = !st.dirty && st.save !== 'saving';
  return (
    <div className={`ap-lib is-${state}${compact ? ' compact' : ''}`} data-testid="ap-lib" data-state={state} data-kind={kind} data-code={code}>
      <div className="ap-lib-head">{head()}<span className="ap-lib-says" data-testid="ap-lib-says">{says()}</span></div>
      <div className="ap-lib-actions">
        {(state === 'new' || state === 'unsaved' || state === 'error') && !locked ? <button type="button" className="ap-btn primary" disabled={!can('applicability.edit')} title={can('applicability.edit') ? undefined : 'You are not permitted to change the library'} onClick={() => void lib.save(kind, code)} data-testid="ap-lib-save"><Icon name="check" size={13} /> Save draft</button> : null}
        {(state === 'unsaved' || state === 'error') ? <button type="button" className="ap-btn quiet" onClick={() => void lib.reload(kind, code)} data-testid="ap-lib-revert">Discard my changes</button> : null}
        {state === 'conflict' ? <>
          <button type="button" className="ap-btn" onClick={() => void lib.reload(kind, code)} data-testid="ap-lib-reload">Load their version (drop mine)</button>
          <button type="button" className="ap-btn" onClick={() => void lib.save(kind, code, { overwrite: true })} data-testid="ap-lib-overwrite">Save mine as the next revision</button>
        </> : null}
        {clean_ && a && (a.state === 'DRAFT' || a.state === 'RETURNED') ? <>
          <button type="button" className="ap-btn primary" disabled={!can('applicability.edit') || detail.isPending || blockers.length > 0} title={blockers.length ? 'Resolve what is listed below first' : undefined} onClick={() => ask('SUBMIT')} data-testid="ap-lib-submit"><Icon name="right" size={13} /> Submit for review</button>
          <button type="button" className="ap-btn quiet" disabled={!can('applicability.edit')} onClick={() => void lib.discard(a)} data-testid="ap-lib-discard">Discard draft</button>
        </> : null}
        {clean_ && a && cand?.status === 'SUBMITTED' ? <>
          <button type="button" className="ap-btn primary" disabled={!can('applicability.approve') || cand.is_submitter} title={cand.is_submitter ? 'You submitted it: someone else must decide' : !can('applicability.approve') ? 'You are not permitted to approve' : undefined} onClick={() => void lib.decide(a, 'APPROVE', '')} data-testid="ap-lib-approve"><Icon name="check" size={13} /> Approve</button>
          <button type="button" className="ap-btn" disabled={!can('applicability.approve') || cand.is_submitter} onClick={() => ask('RETURN')} data-testid="ap-lib-return">Return…</button>
        </> : null}
        {clean_ && a && cand?.status === 'APPROVED' ? <button type="button" className="ap-btn primary" disabled={!can('applicability.publish') || cand.is_submitter || cand.is_approver} title={cand.is_submitter || cand.is_approver ? 'You submitted or approved it: a third person must publish' : !can('applicability.publish') ? 'You are not permitted to publish' : undefined} onClick={() => void lib.publish(a)} data-testid="ap-lib-publish"><Icon name="check" size={13} /> Publish version {(a.published?.version_no ?? 0) + 1}</button> : null}
        {clean_ && a && cand?.is_submitter ? <button type="button" className="ap-btn quiet" onClick={() => ask('WITHDRAW')} data-testid="ap-lib-withdraw">Withdraw</button> : null}
        {a && !compact ? <button type="button" className="ap-btn quiet" onClick={() => setMore(!more)} aria-expanded={more} data-testid="ap-lib-history"><Icon name="history" size={13} /> Versions and history</button> : null}
      </div>
      {asking ? (
        <div className="ap-lib-ask" data-testid="ap-lib-ask">
          <label>{asking === 'RETURN' ? 'What should the author change? (at least 10 characters)' : asking === 'SUBMIT' ? 'A note for the reviewer (optional)' : 'Why are you withdrawing it? (optional)'}
            <textarea className="ap-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} data-testid="ap-lib-ask-text" /></label>
          {asking === 'SUBMIT' ? (
            <div className="ap-lib-freeze" data-testid="ap-lib-freeze">
              <strong>Submitting freezes exactly this</strong>
              {frozen.isPending ? <p className="ap-quiet">Reading what it would pin…</p> : frozen.data ? <>
                {frozen.data.pins.length ? <ul>{frozen.data.pins.map((p) => { const was = moved(p); return (
                  <li key={`${p.kind}-${p.code}`} className={was ? 'moved' : ''} data-testid={`ap-lib-freeze-${p.kind}-${p.code}`} data-version={p.version_no}>
                    <span>{p.kind.toLowerCase()} <b>{p.code}</b> · version {p.version_no}</span><code title="Content fingerprint (SHA-256) of that published version">{p.content_sha256.slice(0, 12)}…</code>
                    {was ? <em>The published version of this {WORD[kind]} reads version {was}. Submitting would move it to version {p.version_no}.</em> : null}
                  </li>
                ); })}</ul> : <p className="ap-quiet">It reads no other library item.</p>}
                <label className="ap-lib-freeze-ack"><input type="checkbox" checked={seen} onChange={(e) => setSeen(e.target.checked)} data-testid="ap-lib-freeze-ack" /> I have reviewed these exact versions{frozen.data.pins.some((p) => moved(p)) ? ', including the newer ones' : ''}.</label>
              </> : <p className="ap-field-error">What it would pin could not be read.</p>}
            </div>
          ) : null}
          <div><button type="button" className="ap-btn primary" disabled={(asking === 'RETURN' && text.trim().length < 10) || (asking === 'SUBMIT' && (!frozen.data || !seen))} onClick={() => void confirm()} data-testid="ap-lib-ask-ok">{asking === 'RETURN' ? 'Return to the author' : asking === 'SUBMIT' ? 'Submit for review' : 'Withdraw'}</button><button type="button" className="ap-btn quiet" onClick={() => setAsking(null)}>Cancel</button></div>
        </div>
      ) : null}
      {cand && !compact ? (
        <div className="ap-lib-freeze" data-testid="ap-lib-candidate">
          <strong>Frozen for review · candidate {cand.candidate_no}</strong>
          <p className="ap-quiet">Content <code title="Content fingerprint (SHA-256)">{cand.content_sha256.slice(0, 12)}…</code> · manifest <code title="Manifest fingerprint (SHA-256)">{cand.manifest_sha256.slice(0, 12)}…</code>{cand.note ? ` · “${cand.note}”` : ''}</p>
          {cand.pins.length ? <ul>{cand.pins.map((p) => <li key={`${p.kind}-${p.code}`} data-testid={`ap-lib-candidate-${p.kind}-${p.code}`} data-version={p.version_no}><span>reads {p.kind.toLowerCase()} <b>{p.code}</b> · version {p.version_no}</span><code>{p.content_sha256.slice(0, 12)}…</code></li>)}</ul> : <p className="ap-quiet">It reads no other library item.</p>}
        </div>
      ) : null}
      {clean_ && blockers.length && a && !cand ? <ul className="ap-issues block" data-testid="ap-lib-blockers">{blockers.map((d, i) => <li key={i} className="blocker" data-code={d.code}><Icon name="warn" size={12} /> {d.message}</li>)}</ul> : null}
      {a && !compact && detail.data?.newer_pins.length ? <p className="ap-quiet" data-testid="ap-lib-newer"><Icon name="info" size={12} /> Published version {a.published?.version_no} reads {detail.data.newer_pins.map((p) => `${String(p.code)} version ${String(p.version_no)} (version ${String(p.current_version_no)} now exists)`).join(', ')}. It keeps what it pinned.</p> : null}
      {more && a ? (
        <div className="ap-lib-more" data-testid="ap-lib-more">
          {detail.isPending ? <p className="ap-quiet">Loading…</p> : detail.data ? <>
            <h4>Versions</h4>
            {detail.data.versions.filter((v) => v.version_no).length ? <ol className="ap-lib-versions">{[...detail.data.versions].filter((v) => v.version_no).reverse().map((v) => (
              <li key={v.id} data-testid={`ap-lib-version-${v.version_no}`} data-status={v.status}>
                <Tag tone={v.status === 'PUBLISHED' ? 'published' : 'plain'}>Version {v.version_no}{v.status === 'SUPERSEDED' ? ' · earlier' : ''}</Tag>
                <span>submitted by {v.submitted_by}, approved by {v.decided_by}, published by {v.published_by} · {when(v.published_at)}</span>
                <code title="Content fingerprint (SHA-256)">{v.content_sha256.slice(0, 12)}…</code>
                {v.pins.length ? <small>reads exactly: {v.pins.map((p) => `${p.kind.toLowerCase()} ${p.code} v${p.version_no}`).join(', ')}</small> : <small>reads nothing else</small>}
              </li>
            ))}</ol> : <p className="ap-quiet">Nothing is published yet.</p>}
            {detail.data.used_by.length ? <><h4>Used in the library by</h4><ul className="ap-lib-used">{detail.data.used_by.map((u, i) => <li key={i}>{u.name} <small>{u.kind.toLowerCase()} · {u.state === 'DRAFT' ? 'draft' : u.state === 'IN_REVIEW' ? 'in review' : `version ${u.version_no}${u.state === 'EARLIER_VERSION' ? ' (earlier)' : ''}`}{u.pinned_version ? ` · pins version ${u.pinned_version}` : ''}</small></li>)}</ul></> : null}
            <h4>History</h4>
            <ol className="ap-lib-events" data-testid="ap-lib-events">{detail.data.events.map((e) => <li key={e.seq} data-event={e.event}><strong>{EVENT[e.event] ?? e.event}</strong> by {e.actor}<small>{when(e.occurred_at)}{e.event === 'DENIED' ? ` · ${RULE[String(e.detail.rule)] ?? String(e.detail.rule)}` : ''}{e.comment ? ` · “${e.comment}”` : ''}</small></li>)}</ol>
          </> : <p className="ap-quiet">The history could not be read.</p>}
          <p className="ap-quiet">Signed in as {me?.principal.display_name}. You may: {[can('applicability.edit') && 'draft and submit', can('applicability.approve') && 'approve or return', can('applicability.publish') && 'publish'].filter(Boolean).join(', ') || 'read only'}. The server enforces three different people.</p>
        </div>
      ) : null}
    </div>
  );
}

/** One line for a list: the saved state of an item, so unsaved work is visible before it is lost. */
export function LibraryDot({ kind, code }: { kind: Kind; code: string }) {
  const lib = useLibrary();
  if (!lib.on) return null;
  const st = lib.state(kind, code);
  const state = st.isNew || st.dirty ? 'unsaved' : (st.asset?.state ?? 'PUBLISHED').toLowerCase();
  if (state === 'published') return null;
  const label = state === 'unsaved' ? 'Unsaved' : state === 'in_review' ? 'In review' : state === 'approved' ? 'Approved' : state === 'returned' ? 'Returned' : 'Draft';
  return <span className={`ap-libdot is-${state}`} data-testid={`ap-libdot-${kind}-${code}`} data-state={state}>{label}</span>;
}
