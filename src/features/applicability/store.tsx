// Survey Applicability (APPL-X1) — the prototype's workspace, held in MEMORY for this browser tab only. Nothing is
// written to Call360 and nothing is put in browser storage: reloading the page starts again from the synthetic seed.
// Every change goes through `update`, which records it for undo and redo.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { applicabilityLibrary, applicabilityPolicies } from './flag';
import { isUnsaved } from './policyStore';
import { seed } from './model/seed';
import type { Condition, Data, Persona, Policy, PolicyRecord, Profile, SurveyRef, Variable } from './model/types';
import type { Lookup } from './model/describe';

export const PEOPLE: Record<Persona, { name: string; role: string; can: string }> = {
  maker: { name: 'Maya', role: 'Maker', can: 'Writes and submits' },
  checker: { name: 'Chen', role: 'Checker', can: 'Reviews and approves' },
  publisher: { name: 'Priya', role: 'Publisher', can: 'Publishes' },
};
export type Drawer =
  | { kind: 'variable'; code?: string; name?: string; then?: (made: Variable) => void }
  | { kind: 'condition'; code?: string; then?: (made: Condition) => void }
  | { kind: 'scenario'; id?: string }
  | null;
interface Toast { id: number; text: string; tone: 'ok' | 'info' | 'warn' }
interface Store {
  data: Data; update: (label: string, change: (d: Data) => void) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; lastChange: string | null; nextChange: string | null;
  persona: Persona; setPersona: (p: Persona) => void;
  drawer: Drawer; openDrawer: (d: Drawer) => void;
  toasts: Toast[]; say: (text: string, tone?: Toast['tone']) => void;
  look: Lookup;
  policy: (code: string) => PolicyRecord | undefined;
  /** The document a person is working on: the draft when there is one, otherwise what is published. */
  working: (code: string) => Policy | null;
  palette: boolean; setPalette: (open: boolean) => void;
  reset: () => void;
  /** The policy the workspace is about: scenarios, impact and governance all speak about this one. */
  current: PolicyRecord | undefined; setCurrent: (code: string) => void;
  /** What Survey Studio has published (surveys.ts): replaces the catalogue and pins references still waiting for a version. */
  adoptCatalogue: (list: SurveyRef[]) => void;
  /** A survey whose published content is being looked at over the current page. */
  preview: SurveyRef | null; setPreview: (s: SurveyRef | null) => void;
  /** APPL-X2: what the saved library holds replaces the tab's copy — except the items named in `keep`, which were
      changed here and not saved yet. Not an edit by the person, so not an undo step. */
  adoptLibrary: (ws: { variables: Variable[]; profiles: Profile[]; conditions: Condition[] }, keep: Set<string>) => void;  /** APPL-X3: the saved policies replace the tab's — except those named in `keep`, which were changed here and not
      saved yet. Not an edit by the person, so not an undo step. */
  adoptPolicies: (list: PolicyRecord[], keep: Set<string>) => void;
}
const Ctx = createContext<Store | null>(null);
// kept for the life of the page so moving around Survey Studio and back does not lose work in progress
let memory: { data: Data; past: { label: string; data: Data }[]; future: { label: string; data: Data }[]; current: string | null } | null = null;
/** What the prototype holds in this tab, for Survey Studio's "where used" — read only, and only this tab's memory. */
export const peekApplicability = (): Data | null => memory?.data ?? null;
/** Test helper: start again from the seed. */
export const forgetApplicability = () => { memory = null; };
/** With the saved library on, variables, profiles and conditions come from Call360, never from the built-in example. */
const start = (): Data => { const d = seed(); return { ...d, ...(applicabilityLibrary() ? { variables: [], profiles: [], conditions: [] } : {}), ...(applicabilityPolicies() ? { policies: [] } : {}) }; };
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

export function ApplicabilityProvider({ children }: { children: ReactNode }) {
  if (!memory) memory = { data: start(), past: [], future: [], current: null };
  const [tickN, tick] = useState(0);
  const again = useCallback(() => tick((n) => n + 1), []);
  const [persona, setPersona] = useState<Persona>('maker');
  const [drawer, openDrawer] = useState<Drawer>(null);
  const [palette, setPalette] = useState(false);
  const [preview, setPreview] = useState<SurveyRef | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const say = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const m = memory;
  const update = useCallback((label: string, change: (d: Data) => void) => {
    const next = structuredClone(m.data);
    change(next);
    m.past = [...m.past.slice(-79), { label, data: m.data }];
    m.future = [];
    m.data = next;
    again();
  }, [m, again]);
  const undo = useCallback(() => { const last = m.past.at(-1); if (!last) return; m.past = m.past.slice(0, -1); m.future = [{ label: last.label, data: m.data }, ...m.future]; m.data = last.data; again(); say(`Undid: ${last.label}`, 'info'); }, [m, again, say]);
  const redo = useCallback(() => { const next = m.future[0]; if (!next) return; m.future = m.future.slice(1); m.past = [...m.past, { label: next.label, data: m.data }]; m.data = next.data; again(); say(`Redid: ${next.label}`, 'info'); }, [m, again, say]);
  const reset = useCallback(() => { m.data = { ...seed(), ...(applicabilityLibrary() ? { variables: m.data.variables, profiles: m.data.profiles, conditions: m.data.conditions } : {}), ...(applicabilityPolicies() ? { policies: m.data.policies } : {}) }; m.past = []; m.future = []; m.current = null; again(); say('Started again from the synthetic example', 'info'); }, [m, again, say]);
  const setCurrent = useCallback((code: string) => { if (m.current !== code) { m.current = code; again(); } }, [m, again]);
  // Not an edit by the person, so not an undo step: the catalogue is Survey Studio's, and a reference that was never
  // pinned takes the version published now. A reference already pinned is NEVER moved to a newer version here.
  const adoptCatalogue = useCallback((list: SurveyRef[]) => {
    const by = new Map(list.map((x) => [x.code, x]));
    const pin = (d: Data) => {
      d.surveys = list;
      const fix = (r: SurveyRef): SurveyRef => (r.version === 0 && by.has(r.code) ? { ...by.get(r.code)! } : r);
      d.policies.forEach((rec) => [rec.draft, rec.published, rec.candidate?.policy, ...rec.versions].forEach((p) => p?.requirements.forEach((q) => {
        if (q.action.kind === 'INCLUDE') q.action.surveys = q.action.surveys.map(fix); else q.action.alternatives.forEach((a) => { a.survey = fix(a.survey); });
      })));
    };
    const next = structuredClone(m.data); pin(next); m.data = next;
    m.past.forEach((h) => pin(h.data)); m.future.forEach((h) => pin(h.data));
    again();
  }, [m, again]);
  const adoptLibrary = useCallback((ws: { variables: Variable[]; profiles: Profile[]; conditions: Condition[] }, keep: Set<string>) => {
    const merge = <T extends { code: string }>(kind: string, mine: T[], saved: T[]): T[] => {
      const kept = new Map(mine.filter((x) => keep.has(`${kind}:${x.code}`)).map((x) => [x.code, x]));
      return [...saved.map((x) => kept.get(x.code) ?? x), ...[...kept.values()].filter((x) => !saved.some((y) => y.code === x.code))];
    };
    m.data = { ...m.data, variables: merge('VARIABLE', m.data.variables, ws.variables), profiles: merge('PROFILE', m.data.profiles, ws.profiles), conditions: merge('CONDITION', m.data.conditions, ws.conditions) };
    again();
  }, [m, again]);
  const adoptPolicies = useCallback((list: PolicyRecord[], keep: Set<string>) => {
    const mine = new Map(m.data.policies.filter((x) => keep.has(x.code)).map((x) => [x.code, x]));
    // what is saved is the truth; an unsaved edit keeps its document and takes the saved history
    m.data = { ...m.data, policies: list.map((x) => (mine.has(x.code) ? { ...mine.get(x.code)!, events: x.events } : x)) };
    again();
  }, [m, again]);
  // With saved policies, "unsaved" is never a remembered flag: it is whether the tab's document differs from the saved
  // one. So an undo after a save shows the draft as unsaved again, and nothing pretends a save was reversed.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- what is saved lives outside React; the tick says it moved
  const data = useMemo(() => (applicabilityPolicies() ? { ...m.data, policies: m.data.policies.map((x) => ({ ...x, unsaved: !!x.draft && isUnsaved(x.draft) })) } : m.data), [m.data, tickN]);
  const value = useMemo<Store>(() => {
    const variables = new Map<string, Variable>(data.variables.map((x) => [x.code, x]));
    const conditions = new Map<string, Condition>(data.conditions.map((x) => [x.code, x]));
    const policy = (code: string) => data.policies.find((p) => p.code === code);
    return {
      data, update, undo, redo, canUndo: m.past.length > 0, canRedo: m.future.length > 0,
      lastChange: m.past.at(-1)?.label ?? null, nextChange: m.future[0]?.label ?? null,
      persona, setPersona, drawer, openDrawer, toasts, say, palette, setPalette, reset,
      current: policy(m.current ?? '') ?? data.policies[0], setCurrent, adoptCatalogue, adoptLibrary, adoptPolicies, preview, setPreview,
      look: { variable: (c) => variables.get(c), condition: (c) => conditions.get(c) },
      policy, working: (code) => { const r = policy(code); return r ? r.draft ?? r.published : null; },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `m` is the tab's memory; its parts are listed
  }, [data, m.past, m.future, m.current, persona, drawer, toasts, palette, preview, update, undo, redo, say, reset, setCurrent, adoptCatalogue, adoptLibrary, adoptPolicies]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAppl(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('Survey Applicability store is not mounted');
  return s;
}

// ---- changes to a policy that several screens make
export const who = (p: Persona) => `${PEOPLE[p].name} (${PEOPLE[p].role.toLowerCase()})`;
/** The draft of a policy, started from the published version when there is none yet. */
export function draftOf(rec: PolicyRecord): Policy {
  if (!rec.draft) {
    const from = rec.published!;
    rec.draft = { ...structuredClone(from), version: Math.max(...rec.versions.map((x) => x.version), from.version) + 1, status: 'DRAFT' };
    rec.events.push({ at: stamp(), who: 'You', persona: 'maker', what: `Started version ${rec.draft.version}` });
  }
  return rec.draft;
}
export function editPolicy(d: Data, code: string, change: (p: Policy) => void) {
  const rec = d.policies.find((x) => x.code === code);
  if (!rec) return;
  change(draftOf(rec));
  rec.unsaved = true;
}
export const logEvent = (rec: PolicyRecord, persona: Persona, what: string, detail?: string) => rec.events.push({ at: stamp(), who: who(persona), persona, what, detail });
export const newId = (prefix: string, taken: string[]) => { let n = taken.length + 1; while (taken.includes(`${prefix}${n}`)) n += 1; return `${prefix}${n}`; };

/** A new policy in the workspace: blank, from a template, or a copy. It starts as an unsaved draft; nothing is published. */
export function addPolicy(d: Data, p: { name: string; description: string; market: string; profiles: string[]; origin: PolicyRecord['origin'] }, body?: Pick<Policy, 'requirements' | 'order'> & Partial<Policy>): string {
  const stem = p.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'POLICY';
  let code = stem, n = 1;
  while (d.policies.some((x) => x.code === code)) code = `${stem}-${++n}`;
  const by = new Map(d.surveys.map((x) => [x.code, x]));
  const draft: Policy = { code, name: p.name.trim() || 'Untitled policy', market: p.market, description: p.description, profiles: p.profiles, scope: null, shared_deliveries: [], requirements: [], order: [], ...structuredClone(body ?? {}), version: 1, status: 'DRAFT' };
  draft.code = code; draft.name = p.name.trim() || 'Untitled policy';
  draft.requirements.forEach((q) => { const fix = (r: SurveyRef) => (r.version === 0 && by.has(r.code) ? { ...by.get(r.code)! } : r); if (q.action.kind === 'INCLUDE') q.action.surveys = q.action.surveys.map(fix); else q.action.alternatives.forEach((a) => { a.survey = fix(a.survey); }); });
  d.policies.push({ code, published: null, draft, candidate: null, versions: [], unsaved: true, origin: p.origin, events: [{ at: stamp(), who: 'You', persona: 'maker', what: p.origin === 'COPY' ? 'Created as a copy' : p.origin === 'TEMPLATE' ? 'Created from a template' : p.origin === 'SCALE' ? 'Generated to try the designer at scale' : 'Created from nothing' }] });
  return code;
}
