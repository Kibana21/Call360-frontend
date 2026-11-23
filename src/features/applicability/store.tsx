// Survey Applicability (APPL-X1) — the prototype's workspace, held in MEMORY for this browser tab only. Nothing is
// written to Call360 and nothing is put in browser storage: reloading the page starts again from the synthetic seed.
// Every change goes through `update`, which records it for undo and redo.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { seed } from './model/seed';
import type { Condition, Data, Persona, Policy, PolicyRecord, Variable } from './model/types';
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
}
const Ctx = createContext<Store | null>(null);
// kept for the life of the page so moving around Survey Studio and back does not lose work in progress
let memory: { data: Data; past: { label: string; data: Data }[]; future: { label: string; data: Data }[] } | null = null;
/** Test helper: start again from the seed. */
export const forgetApplicability = () => { memory = null; };
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

export function ApplicabilityProvider({ children }: { children: ReactNode }) {
  if (!memory) memory = { data: seed(), past: [], future: [] };
  const [, tick] = useState(0);
  const again = useCallback(() => tick((n) => n + 1), []);
  const [persona, setPersona] = useState<Persona>('maker');
  const [drawer, openDrawer] = useState<Drawer>(null);
  const [palette, setPalette] = useState(false);
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
  const reset = useCallback(() => { m.data = seed(); m.past = []; m.future = []; again(); say('Started again from the synthetic example', 'info'); }, [m, again, say]);
  const data = m.data;
  const value = useMemo<Store>(() => {
    const variables = new Map<string, Variable>(data.variables.map((x) => [x.code, x]));
    const conditions = new Map<string, Condition>(data.conditions.map((x) => [x.code, x]));
    const policy = (code: string) => data.policies.find((p) => p.code === code);
    return {
      data, update, undo, redo, canUndo: m.past.length > 0, canRedo: m.future.length > 0,
      lastChange: m.past.at(-1)?.label ?? null, nextChange: m.future[0]?.label ?? null,
      persona, setPersona, drawer, openDrawer, toasts, say, palette, setPalette, reset,
      look: { variable: (c) => variables.get(c), condition: (c) => conditions.get(c) },
      policy, working: (code) => { const r = policy(code); return r ? r.draft ?? r.published : null; },
    };
  }, [data, m.past, m.future, persona, drawer, toasts, palette, update, undo, redo, say, reset]);
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
