// Survey Applicability (APPL-X3) — applicability POLICIES saved in Call360 as working drafts. This file is the only
// place that reads and writes them. The designer keeps editing ONE document in the tab (cards, graph and matrix all
// draw it); this file knows whether it differs from what is saved, saves it with the revision it was opened at —
// never over someone else's work — and shows the exact dependencies the document pins. Nothing here decides which
// survey applies: the server's Python evaluator does. Publication of policies does not exist yet (APPL-X4).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiFailure, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { sentence, slug } from './model/describe';
import type { Expr, Pin, Policy, PolicyRecord, Requirement, SurveyRef } from './model/types';
import { forgetSaved, isUnsaved, policiesOn, rememberSaved, savedPolicy, toClient, toServer, type Dependency, type Inspection, type ServerPolicy } from './policyStore';
import { editPolicy, useAppl } from './store';
import { Field, Icon, Tag } from './ui';
import { surveysOf } from './usage';

const P = '/api/v1/applicability/policies';
const why = (e: unknown) => (e instanceof ApiFailure ? e.message : e instanceof Error ? e.message : 'The request failed');
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const EVENT: Record<string, string> = { CREATED: 'Created', DRAFT_SAVED: 'Saved', ARCHIVED: 'Archived', RESTORED: 'Restored' };
type Flag = { state: 'saving' | 'conflict' | 'error'; message?: string; revision?: number; by?: string; theirs?: Policy };
export type SaveState = 'saving' | 'saved' | 'unsaved' | 'conflict' | 'error' | 'readonly';

const record = (p: ServerPolicy): PolicyRecord => ({
  code: p.code, published: null, draft: toClient(p), candidate: null, versions: [], unsaved: false, origin: 'BLANK',
  events: p.events.map((e) => ({ at: when(e.occurred_at), who: e.actor, persona: 'system' as const, what: `${EVENT[e.event] ?? e.event} · revision ${e.draft_revision}`, detail: [e.comment, ...((e.detail.pinned as string[] | undefined) ?? []).map((x) => `pinned ${x}`), ...((e.detail.released as string[] | undefined) ?? []).map((x) => `released ${x}`)].filter(Boolean).join(' · ') || undefined })),
});

interface Policies {
  on: boolean; status: 'off' | 'loading' | 'ready' | 'forbidden' | 'unavailable'; reason?: string; canEdit: boolean;
  state: (code: string) => { save: SaveState; flag?: Flag; revision?: number; updatedBy?: string | null; updatedAt?: string };
  create: (p: { name: string; code: string; description: string; market: string; profiles: string[]; origin: string }, body?: Partial<Policy>) => Promise<string | null>;
  save: (code: string, opts?: { overwrite?: boolean }) => Promise<boolean>;
  /** drop what was changed in this tab and show what is saved */
  reload: (code: string) => Promise<void>;
  archive: (code: string, reason: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  taken: (code: string) => boolean;
  unsaved: number;
}
const OFF: Policies = { on: false, status: 'off', canEdit: true, state: () => ({ save: 'saved' }), create: async () => null, save: async () => true, reload: async () => {}, archive: async () => false, refresh: async () => {}, taken: () => false, unsaved: 0 };
const Ctx = createContext<Policies>(OFF);
export const usePolicies = () => useContext(Ctx);

export function PoliciesProvider({ children }: { children: ReactNode }) {
  const on = policiesOn();
  const s = useAppl();
  const { can } = useAuth();
  const [status, setStatus] = useState<Policies['status']>(on ? 'loading' : 'off');
  const [reason, setReason] = useState<string>();
  const [flags, setFlags] = useState<Record<string, Flag>>({});
  const [codes, setCodes] = useState<string[]>([]);
  const latest = useRef(s.data);
  latest.current = s.data;
  const may = can('applicability.read') && can('survey.read');
  const canEdit = can('applicability.edit') && can('survey.read');
  const flag = (code: string, v: Flag | null) => setFlags((f) => { const n = { ...f }; if (v) n[code] = v; else delete n[code]; return n; });

  /** one read of the gallery at a time: a second request made while one is running joins it instead of repeating it */
  const running = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async (force: string[] = []) => {
    if (!on) return;
    if (!may) { setStatus('forbidden'); return; }
    if (running.current && !force.length) return running.current;
    const work = (async () => {
    try {
      const list = unwrap(await api.GET(P, { params: { query: {} } })).items;
      // documents only: the inspection (the evaluator's whole analysis) is asked for the policy that is open, not for every one
      const full = await Promise.all(list.map(async (x) => unwrap(await api.GET(`${P}/{policy_id}`, { params: { path: { policy_id: x.id }, query: { inspection: false } } }))));
      // what was changed in this tab and not saved stays as it is; everything else becomes what is saved
      const keep = new Set(latest.current.policies.filter((r) => r.draft && !force.includes(r.code) && isUnsaved(r.draft)).map((r) => r.code));
      forgetSaved(); full.forEach(rememberSaved);
      s.adoptPolicies(full.map(record), keep);
      setCodes(full.map((x) => x.code.toLowerCase())); setStatus('ready'); setReason(undefined);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 403) setStatus('forbidden'); else { setStatus('unavailable'); setReason(why(e)); }
    }
    })();
    running.current = work;
    try { await work; } finally { if (running.current === work) running.current = null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the store's adoptPolicies is stable
  }, [on, may]);
  useEffect(() => { void refresh(); }, [refresh]);
  /** One policy read again and put in place of the tab's copy; the others are not touched and not re-read. */
  const refreshOne = useCallback(async (id: string) => {
    const one = unwrap(await api.GET(`${P}/{policy_id}`, { params: { path: { policy_id: id }, query: { inspection: false } } }));
    rememberSaved(one);
    const others = latest.current.policies.filter((r) => r.code !== one.code);
    s.adoptPolicies([record(one), ...others], new Set(others.map((r) => r.code)));
    setCodes((c) => [...new Set([...c, one.code.toLowerCase()])]);
    return one;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = useCallback<Policies['create']>(async (p, body) => {
    const by = new Map(latest.current.surveys.map((x) => [x.code, x]));
    const fix = (r: SurveyRef): SurveyRef => (r.version === 0 && by.has(r.code) ? { ...by.get(r.code)! } : r);
    const requirements = structuredClone(body?.requirements ?? []) as Requirement[];
    requirements.forEach((q) => { if (q.action.kind === 'INCLUDE') q.action.surveys = q.action.surveys.map(fix); else q.action.alternatives.forEach((a) => { a.survey = fix(a.survey); }); });
    const document = { name: p.name.trim(), description: p.description, profiles: p.profiles, scope: body?.scope ?? null, shared_deliveries: body?.shared_deliveries ?? [], requirements, order: body?.order ?? [], pins: body?.pins ?? [] };
    try {
      const made = unwrap(await api.POST(P, { body: { market_code: p.market, code: p.code, document, origin: p.origin } }));
      await refreshOne(made.id);
      s.say(`${made.name} created and saved as a draft`);
      return made.code;
    } catch (e) {
      // a refusal is never silent, and after one the list is read again so that the next suggestion is right
      s.say(e instanceof ApiFailure && e.code === 'CODE_TAKEN' ? `Not created: ${e.message}. Choose another code.` : `Not created: ${why(e)}`, 'warn');
      void refresh();
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshOne, refresh]);

  const save = useCallback<Policies['save']>(async (code, opts) => {
    const rec = latest.current.policies.find((x) => x.code === code);
    const kept = savedPolicy(code);
    if (!rec?.draft || !kept) return false;
    flag(code, { state: 'saving' });
    try {
      let revision = kept.revision;
      if (opts?.overwrite) revision = unwrap(await api.GET(`${P}/{policy_id}`, { params: { path: { policy_id: kept.id } } })).draft_revision;
      unwrap(await api.PUT(`${P}/{policy_id}/draft`, { params: { path: { policy_id: kept.id } }, body: { expected_revision: revision, document: toServer(rec.draft), note: '' } }));
      await refreshOne(kept.id); flag(code, null); s.say(`${rec.draft.name} saved`);
      return true;
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 409 && e.code === 'STALE_REVISION') {
        const d = (e.body?.details as { current_revision?: number; updated_by?: string }[] | undefined)?.[0];
        // what the other person saved is fetched to be SHOWN beside mine; nothing is merged and nothing of mine is replaced
        let theirs: Policy | undefined;
        try { theirs = toClient(unwrap(await api.GET(`${P}/{policy_id}`, { params: { path: { policy_id: kept.id } } }))); } catch { /* shown without the comparison */ }
        flag(code, { state: 'conflict', message: e.message, revision: d?.current_revision, by: d?.updated_by, theirs });
      } else if (e instanceof ApiFailure && e.code === 'NOTHING_CHANGED') { await refreshOne(kept.id); flag(code, null); return true; }
      else { flag(code, { state: 'error', message: why(e) + (((e as ApiFailure).body?.details as { message?: string }[] | undefined)?.[0]?.message ? ` — ${((e as ApiFailure).body!.details as { message: string }[])[0]!.message}` : '') }); s.say(why(e), 'warn'); }
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);
  const reload = useCallback(async (code: string) => { const kept = savedPolicy(code); if (kept) await refreshOne(kept.id); else await refresh([code]); flag(code, null); }, [refresh, refreshOne]);
  const archive = useCallback(async (code: string, reason_: string) => {
    const kept = savedPolicy(code);
    if (!kept) return false;
    try { unwrap(await api.POST(`${P}/{policy_id}/archive`, { params: { path: { policy_id: kept.id } }, body: { expected_revision: kept.revision, reason: reason_ } })); await refresh([code]); s.say('Archived. It is kept with its history and can be restored.', 'info'); return true; }
    catch (e) { s.say(why(e), 'warn'); return false; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const value = useMemo<Policies>(() => {
    if (!on) return OFF;
    const state: Policies['state'] = (code) => {
      const rec = s.data.policies.find((x) => x.code === code); const kept = savedPolicy(code); const f = flags[code];
      const dirty = !!rec?.draft && isUnsaved(rec.draft);
      const save_: SaveState = f?.state === 'saving' ? 'saving' : !canEdit ? 'readonly' : f?.state === 'conflict' && dirty ? 'conflict' : f?.state === 'error' && dirty ? 'error' : dirty ? 'unsaved' : 'saved';
      return { save: save_, flag: f, revision: kept?.revision, updatedBy: kept?.updatedBy, updatedAt: kept?.updatedAt };
    };
    return { on, status, reason, canEdit, state, create, save, reload, archive, refresh: () => refresh(), taken: (c) => codes.includes(c.trim().toLowerCase()), unsaved: s.data.policies.filter((r) => r.unsaved).length };
  }, [on, status, reason, canEdit, flags, codes, s.data.policies, create, save, reload, archive, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const reqLine = (r: Requirement, look: Parameters<typeof sentence>[1]) => `${r.when ? sentence(r.when, look) : 'always'} → ${surveysOf(r).map((x) => x.name).join(', ') || 'no survey'}`;

/** Where a saved policy stands — saved or not, refused, being saved — and what the signed-in person can do next. */
export function PolicyBar({ rec }: { rec: PolicyRecord }) {
  const pol = usePolicies();
  const { look } = useAppl();
  const st = pol.state(rec.code);
  const doc = rec.draft!;
  const theirs = st.flag?.theirs;
  const mine = new Set(doc.requirements.map((r) => reqLine(r, look)));
  const their = new Set((theirs?.requirements ?? []).map((r) => reqLine(r, look)));
  return (
    <div className={`ap-polbar is-${st.save}`} data-testid="ap-policy-bar" data-state={st.save} data-revision={st.revision}>
      <span className="ap-polbar-head">
        {st.save === 'saving' ? <Tag tone="info" testid="ap-policy-bar-tag">Saving…</Tag>
          : st.save === 'conflict' ? <Tag tone="bad" testid="ap-policy-bar-tag">Not saved — someone else saved first</Tag>
          : st.save === 'error' ? <Tag tone="bad" testid="ap-policy-bar-tag">Save failed</Tag>
          : st.save === 'unsaved' ? <Tag tone="warn" testid="ap-unsaved">Unsaved changes</Tag>
          : st.save === 'readonly' ? <Tag tone="plain" testid="ap-policy-bar-tag"><Icon name="lock" size={11} /> Read only</Tag>
          : <Tag tone="draft" testid="ap-saved">Draft saved · revision {st.revision}</Tag>}
        <span className="ap-polbar-says" data-testid="ap-policy-bar-says">
          {st.save === 'conflict' ? `${st.flag?.by ?? 'Someone else'} saved revision ${st.flag?.revision ?? ''} after you opened this policy. Nothing of yours was saved and nothing of theirs was overwritten.`
            : st.save === 'error' ? st.flag?.message
            : st.save === 'unsaved' ? `Your changes are only in this tab. The saved draft is revision ${st.revision}.`
            : st.save === 'readonly' ? 'You may read this policy. Changing it needs the permission to edit applicability.'
            : st.save === 'saving' ? '' : `Saved in Call360${st.updatedBy ? ` by ${st.updatedBy}` : ''} · ${when(st.updatedAt)}. A draft: publication is not available yet.`}
        </span>
      </span>
      <span className="ap-polbar-actions">
        {st.save === 'unsaved' || st.save === 'error' ? <><button type="button" className="ap-btn primary" onClick={() => void pol.save(rec.code)} data-testid="ap-save-draft"><Icon name="check" size={13} /> Save</button><button type="button" className="ap-btn quiet" onClick={() => void pol.reload(rec.code)} data-testid="ap-policy-revert">Discard my changes</button></> : null}
        {st.save === 'saved' || st.save === 'saving' ? <button type="button" className="ap-btn" disabled data-testid="ap-save-draft"><Icon name="check" size={13} /> Saved</button> : null}
        {st.save === 'conflict' ? <><button type="button" className="ap-btn" onClick={() => void pol.reload(rec.code)} data-testid="ap-policy-reload">Load their version (drop mine)</button><button type="button" className="ap-btn" onClick={() => void pol.save(rec.code, { overwrite: true })} data-testid="ap-policy-overwrite">Save mine as the next revision</button></> : null}
      </span>
      {st.save === 'conflict' && theirs ? (
        <div className="ap-polbar-diff" data-testid="ap-policy-conflict-diff">
          <strong>What differs</strong> <span className="ap-quiet">Nothing is merged for you: choose one, or copy what you need first.</span>
          <ul>
            {theirs.name !== doc.name ? <li>Name — theirs: “{theirs.name}”, yours: “{doc.name}”</li> : null}
            {theirs.description !== doc.description ? <li>Description — theirs: “{theirs.description || 'none'}”, yours: “{doc.description || 'none'}”</li> : null}
            {[...their].filter((x) => !mine.has(x)).map((x) => <li key={`t${x}`}><Tag tone="info">only in theirs</Tag> {x}</li>)}
            {[...mine].filter((x) => !their.has(x)).map((x) => <li key={`m${x}`}><Tag tone="warn">only in yours</Tag> {x}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const WORD: Record<Dependency['kind'], string> = { VARIABLE: 'Variable', PROFILE: 'Profile', CONDITION: 'Condition', SURVEY: 'Survey' };
const rewrite = (e: Expr | null, code: string, to: number): Expr | null => (!e ? e : e.op === 'ref' ? (e.condition === code ? { ...e, version: to } : e) : e.op === 'not' ? { ...e, arg: rewrite(e.arg, code, to)! } : e.op === 'test' ? e : { ...e, args: e.args.map((a) => rewrite(a, code, to)!) });
const setPin = (p: Policy, kind: Pin['kind'], code: string, pin: Partial<Pin> | null) => { const rest = (p.pins ?? []).filter((x) => !(x.kind === kind && x.code === code)); p.pins = pin ? [...rest, { kind, code, ...pin }] : rest; };
const everywhere = (p: Policy, f: (e: Expr | null) => Expr | null) => { p.scope = f(p.scope); p.requirements.forEach((r) => { r.when = f(r.when); if (r.action.kind === 'CHOOSE_ONE') r.action.alternatives.forEach((a) => { a.when = f(a.when); }); }); };

/** The dependency manifest of the document on screen: exactly what it pins, what has moved since, and — only when the
    person asks — the adoption of a newer version. Every action is an ordinary, undoable edit of the document. */
export function Dependencies({ rec, inspection, editable }: { rec: PolicyRecord; inspection?: Inspection; editable: boolean }) {
  const { data, update, say } = useAppl();
  const [open, setOpen] = useState(false);
  if (!inspection) return null;
  const deps = inspection.dependencies as unknown as Dependency[];
  const needs = deps.filter((d) => d.stale || d.state === 'DRAFT' || d.newer_version_no);
  const change = (label: string, f: (p: Policy) => void) => { update(label, (d) => editPolicy(d, rec.code, f)); say(`${label}. Save the policy to keep it; Undo restores the previous pin.`, 'info'); };
  const usedBy = (d: Dependency) => Object.entries(inspection.requirements).filter(([, x]) => (d.kind === 'SURVEY' ? x.surveys ?? [] : d.kind === 'CONDITION' ? (x.conditions ?? []).map((c) => c.split('@')[0]!) : d.kind === 'VARIABLE' ? x.variables ?? [] : x.profiles ?? []).includes(d.code)).map(([r]) => (r === 'policy' ? 'the policy' : r === 'scope' ? 'the scope' : rec.draft?.requirements.find((q) => q.id === r)?.name ?? r));
  const adopt = (d: Dependency) => {
    const to = d.newer_version_no!;
    if (d.kind === 'CONDITION') change(`Adopt version ${to} of “${d.name}”`, (p) => everywhere(p, (e) => rewrite(e, d.code, to)));
    else if (d.kind === 'SURVEY') { const latest = data.surveys.find((x) => x.code === d.code); if (!latest || latest.version !== to) { say('Read the survey catalogue again first (the control at the top right).', 'warn'); return; } change(`Adopt version ${latest.label ?? to} of ${d.name}`, (p) => p.requirements.forEach((r) => { if (r.action.kind === 'INCLUDE') r.action.surveys = r.action.surveys.map((x) => (x.code === d.code ? { ...latest } : x)); else r.action.alternatives.forEach((a) => { if (a.survey.code === d.code) a.survey = { ...latest }; }); })); }
    else change(`Adopt version ${to} of “${d.name}”`, (p) => setPin(p, d.kind as Pin['kind'], d.code, { version: to }));
  };
  const accept = (d: Dependency) => {
    if (d.current_draft_revision) change(`Accept draft revision ${d.current_draft_revision} of “${d.name}”`, (p) => setPin(p, d.kind as Pin['kind'], d.code, { draft_revision: d.current_draft_revision! }));
    else if (d.published_version_no) change(`Use published version ${d.published_version_no} of “${d.name}”`, (p) => { if (d.kind === 'CONDITION') { setPin(p, 'CONDITION', d.code, null); everywhere(p, (e) => rewrite(e, d.code, d.published_version_no!)); } else setPin(p, d.kind as Pin['kind'], d.code, { version: d.published_version_no! }); });
  };
  const publish = (d: Dependency) => change(`Use published version ${d.published_version_no} of “${d.name}”`, (p) => { if (d.kind === 'CONDITION') { setPin(p, 'CONDITION', d.code, null); everywhere(p, (e) => rewrite(e, d.code, d.published_version_no!)); } else setPin(p, d.kind as Pin['kind'], d.code, { version: d.published_version_no! }); });
  const show = open || needs.length > 0;
  return (
    <section className={`ap-deps${inspection.stale ? ' is-stale' : inspection.unpublished ? ' is-draft' : ''}`} data-testid="ap-deps" data-unpublished={inspection.unpublished} data-stale={inspection.stale} data-ready={inspection.ready_for_publication} aria-label="What this policy depends on">
      <header>
        <button type="button" className="ap-deps-toggle" aria-expanded={show} onClick={() => setOpen(!open)} data-testid="ap-deps-toggle"><Icon name={show ? 'down' : 'right'} size={13} /><strong>Depends on</strong> <span className="ap-quiet">{deps.filter((d) => d.kind !== 'SURVEY').length} library items and {deps.filter((d) => d.kind === 'SURVEY').length} published survey versions, each at an exact version</span></button>
        <span className={`ap-readiness${inspection.ready_for_publication ? ' ok' : ' no'}`} data-testid="ap-readiness">{inspection.stale ? <><Icon name="warn" size={13} /> A dependency changed — review it before relying on a result</> : inspection.unpublished ? <><Icon name="warn" size={13} /> Draft contains unpublished dependencies — not ready for publication</> : inspection.blockers ? <><Icon name="warn" size={13} /> {inspection.blockers} blocking problem{inspection.blockers === 1 ? '' : 's'} — not ready for publication</> : <><Icon name="check" size={13} /> No blocker found · publication is not available yet</>}</span>
      </header>
      {show ? (
        <ul className="ap-deps-list">
          {(open ? deps : needs).map((d) => { const state = d.stale ? 'stale' : d.state === 'DRAFT' ? 'draft' : d.newer_version_no ? 'newer' : 'pinned'; const used = usedBy(d); return (
            <li key={`${d.kind}-${d.code}-${d.version_no ?? d.draft_revision}`} className={`is-${state}`} data-testid={`ap-dep-${d.kind}-${d.code}`} data-state={state} data-pinned={d.state === 'DRAFT' ? `draft-${d.draft_revision}` : String(d.label ?? d.version_no)}>
              <span className="ap-dep-what"><Tag tone={d.kind === 'SURVEY' ? 'survey' : d.kind === 'CONDITION' ? 'cond' : d.kind === 'VARIABLE' ? 'var' : 'profile'}>{WORD[d.kind]}</Tag> <strong>{d.name}</strong>
                <small>{d.state === 'DRAFT' ? `draft revision ${d.draft_revision} · not published` : `version ${d.label ?? d.version_no}`} · <code title="Content fingerprint (SHA-256) of exactly what is pinned">{d.content_sha256.slice(0, 12)}…</code>{used.length ? ` · used by ${used.slice(0, 3).join(', ')}${used.length > 3 ? ` and ${used.length - 3} more` : ''}` : ''}</small></span>
              <span className="ap-dep-state">
                {d.stale ? <Tag tone="bad">changed since saved</Tag> : d.state === 'DRAFT' ? <Tag tone="warn">unpublished</Tag> : null}
                {d.newer_version_no ? <Tag tone="info">version {d.newer_version_no} available</Tag> : null}
                {!d.stale && d.state === 'PUBLISHED' && !d.newer_version_no ? <Tag tone="published">pinned</Tag> : null}
              </span>
              <span className="ap-dep-actions">
                {editable && d.stale ? <button type="button" className="ap-btn" onClick={() => accept(d)} data-testid={`ap-dep-${d.kind}-${d.code}-accept`}>{d.current_draft_revision ? `Review done: accept revision ${d.current_draft_revision}` : `Use published version ${d.published_version_no}`}</button> : null}
                {editable && !d.stale && d.state === 'DRAFT' && d.published_version_no ? <button type="button" className="ap-btn" onClick={() => publish(d)} data-testid={`ap-dep-${d.kind}-${d.code}-use-published`}>Use published version {d.published_version_no}</button> : null}
                {editable && d.newer_version_no ? <button type="button" className="ap-btn" onClick={() => adopt(d)} data-testid={`ap-dep-${d.kind}-${d.code}-adopt`}>Adopt version {d.newer_version_no}</button> : null}
              </span>
            </li>
          ); })}
        </ul>
      ) : null}
      {show ? <p className="ap-quiet">A pin never moves by itself: not when a newer version is published, and not when this policy is reopened. Fingerprint of this dependency set: <code data-testid="ap-deps-fingerprint">{inspection.snapshot_sha256.slice(0, 16)}…</code></p> : null}
    </section>
  );
}

/** What one requirement depends on that needs attention — shown on its card, in the inspector and in the matrix. */
export function RequirementDeps({ id, inspection }: { id: string; inspection?: Inspection }) {
  if (!inspection) return null;
  const mine = inspection.requirements[id];
  if (!mine) return null;
  const deps = (inspection.dependencies as unknown as Dependency[]).filter((d) => (d.kind === 'SURVEY' ? mine.surveys ?? [] : d.kind === 'CONDITION' ? (mine.conditions ?? []).map((c) => c.split('@')[0]!) : d.kind === 'VARIABLE' ? mine.variables ?? [] : []).includes(d.code));
  const flagged = deps.filter((d) => d.stale || d.state === 'DRAFT' || d.newer_version_no);
  if (!flagged.length) return null;
  return (
    <span className="ap-reqdeps" data-testid={`ap-reqdeps-${id}`}>
      {flagged.map((d) => <span key={`${d.kind}-${d.code}`} className={`ap-reqdep is-${d.stale ? 'stale' : d.state === 'DRAFT' ? 'draft' : 'newer'}`} title={d.stale ? 'This dependency changed after the policy was saved' : d.state === 'DRAFT' ? 'This dependency is a draft, not a published version' : 'A newer version is published; this requirement stays on the pinned one until you adopt it'}>
        <Icon name={d.stale || d.state === 'DRAFT' ? 'warn' : 'info'} size={11} /> {d.stale ? 'changed' : d.state === 'DRAFT' ? 'unpublished' : `v${d.newer_version_no} available`}: {d.name}</span>)}
    </span>
  );
}

/** A name first; then a suggested code the person can review and change; then creation. A code never changes. */
export function NameAndCode({ noun, name, setName, code, setCode, taken, style = 'upper' }: { noun: string; name: string; setName: (v: string) => void; code: string | null; setCode: (v: string | null) => void; taken: (code: string) => boolean; style?: 'upper' | 'lower' }) {
  const suggested = suggestCode(name, style);
  const value = code ?? suggested;
  const bad = value && !/^[A-Za-z][A-Za-z0-9_.-]{1,59}$/.test(value);
  const clash = !!value && taken(value);
  return (
    <>
      <Field label="Name" hint={`What the business calls this ${noun}. You can change it later.`}><input className="ap-input big" data-autofocus data-testid="ap-policy-create-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={noun === 'policy' ? 'For example: ILP and NFTF applicability' : 'For example: Senior applicant extension'} /></Field>
      <Field label="Code" hint={`Suggested from the name. Review it now: once the ${noun} is created its code never changes, and it must be unique in the market.`} error={bad ? 'Start with a letter; use 2 to 60 letters, digits, “-”, “_” or “.”.' : clash ? `A ${noun} with this code already exists in this market.` : null}>
        <span className="ap-code-row"><input className="ap-input" data-testid="ap-code-input" value={value} onChange={(e) => setCode(e.target.value)} disabled={!name.trim()} aria-describedby="ap-code-note" />{code !== null && code !== suggested ? <button type="button" className="ap-linkbtn" onClick={() => setCode(null)} data-testid="ap-code-suggest">Use the suggestion “{suggested}”</button> : null}</span>
      </Field>
      <p className="ap-quiet" id="ap-code-note" data-testid="ap-code-note"><Icon name="lock" size={11} /> The code is permanent. The name is not.</p>
    </>
  );
}
/** Archived policies: out of the gallery, never deleted. Each can be brought back, by a person who may edit, after
    they have seen why it was archived and its history. */
export function ArchivedPolicies() {
  const pol = usePolicies();
  const { say } = useAppl();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ServerPolicy[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const all = unwrap(await api.GET(P, { params: { query: { archived: true } } })).items.filter((x) => x.state === 'ARCHIVED');
      setList(await Promise.all(all.map(async (x) => unwrap(await api.GET(`${P}/{policy_id}`, { params: { path: { policy_id: x.id }, query: { inspection: false } } })))));
    } catch (e) { say(why(e), 'warn'); setList([]); }
  }, [say]);
  useEffect(() => { if (open) void load(); }, [open, load, pol.unsaved]);
  if (!pol.on || pol.status !== 'ready') return null;
  const restore = async (p: ServerPolicy) => {
    try { unwrap(await api.POST(`${P}/{policy_id}/restore`, { params: { path: { policy_id: p.id } }, body: { expected_revision: p.draft_revision, reason: '' } })); setAsking(null); await pol.refresh(); await load(); say(`${p.name} restored to the gallery as the draft it was`); }
    catch (e) { say(why(e), 'warn'); }
  };
  return (
    <section className="ap-archived" data-testid="ap-archived" aria-label="Archived policies">
      <button type="button" className="ap-btn quiet" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="ap-archived-toggle"><Icon name={open ? 'down' : 'right'} size={13} /> Archived policies{list ? ` (${list.length})` : ''}</button>
      {open ? (list === null ? <p className="ap-quiet">Reading…</p> : !list.length ? <p className="ap-quiet" data-testid="ap-archived-none">No policy is archived.</p> : (
        <ul className="ap-archived-list">
          {list.map((p) => { const last = [...p.events].reverse().find((e) => e.event === 'ARCHIVED'); return (
            <li key={p.id} data-testid={`ap-archived-${p.code}`}>
              <div><strong>{p.name}</strong> <code>{p.code}</code><small>Archived by {last?.actor ?? 'someone'} on {when(last?.occurred_at)} — “{last?.comment || 'no reason given'}”. Saved revision {p.draft_revision}; {p.requirements} requirement{p.requirements === 1 ? '' : 's'}.</small>
                <ol className="ap-lib-events">{p.events.map((e) => <li key={e.seq} data-event={e.event}><strong>{EVENT[e.event] ?? e.event} · revision {e.draft_revision}</strong> by {e.actor}<small>{when(e.occurred_at)}{e.comment ? ` · “${e.comment}”` : ''}</small></li>)}</ol></div>
              {pol.canEdit ? (asking === p.id
                ? <span className="ap-archived-ask" data-testid="ap-archived-confirm"><span>Restore “{p.name}”? It returns to the gallery exactly as it was saved; nothing else changes.</span><button type="button" className="ap-btn primary" onClick={() => void restore(p)} data-testid={`ap-archived-${p.code}-confirm`}>Yes, restore it</button><button type="button" className="ap-btn quiet" onClick={() => setAsking(null)}>Cancel</button></span>
                : <button type="button" className="ap-btn" onClick={() => setAsking(p.id)} data-testid={`ap-archived-${p.code}-restore`}><Icon name="history" size={13} /> Restore</button>)
                : <span className="ap-quiet">Restoring needs the permission to edit.</span>}
            </li>
          ); })}
        </ul>
      )) : null}
    </section>
  );
}

export const suggestCode = (name: string, style: 'upper' | 'lower' = 'upper'): string => (style === 'lower' ? slug(name) : name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40));
export const codeOk = (code: string, taken: (c: string) => boolean) => /^[A-Za-z][A-Za-z0-9_.-]{1,59}$/.test(code) && !taken(code);
