// Survey Studio prototype — one in-browser store for every screen.
// Holds the canonical workspace plus undo and redo stacks of whole workspaces, so undo restores the model itself.
// Kept in memory only: PROTOTYPE, nothing is stored in the browser or sent to the server; a page reload resets it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyGov, type GovState } from './model/governance';
import { sampleWorkspace } from './model/sample';
import type { Workspace } from './model/types';

const LIMIT = 80;

interface Entry { ws: Workspace; label: string }
interface State { ws: Workspace; past: Entry[]; future: Entry[] }

export interface Studio {
  ws: Workspace;
  /** Applies one operation as one undoable step. The label is shown in the acknowledgement and on Undo. */
  apply: <R>(label: string, op: (ws: Workspace) => Workspace | [Workspace, R]) => R | undefined;
  undo: () => void;
  redo: () => void;
  undoLabel: string | null;
  redoLabel: string | null;
  /** The latest acknowledgement, e.g. "Added Suitability" or "Undid: Added Suitability". */
  notice: { text: string; at: number } | null;
  reset: () => void;
  /** Ask a screen to bring one control into view (used by the issues list). */
  focus: { key: string; at: number } | null;
  requestFocus: (key: string) => void;
  /**
   * The SIMULATED review-and-publish state (SS-02C): who is acting, acknowledgements, submissions, decisions, publications
   * and the audit trail. Kept apart from the canonical model and from undo: an approval is not an edit of the survey.
   */
  gov: GovState;
  /** Applies one governance step. Returns the plain-English reason when the rules refuse it, otherwise null. */
  govern: (step: (g: GovState) => GovState) => string | null;
}

const Ctx = createContext<Studio | null>(null);

// Held in memory for the life of the page so the workspace survives moving between Call360 screens. The project's
// security rule IAM-008 forbids browser storage, and the prototype does not need it: a page reload starts afresh.
let memory: State | null = null;
let govMemory: GovState | null = null;
const load = (): State => memory ?? { ws: sampleWorkspace(), past: [], future: [] };

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load);
  const [notice, setNotice] = useState<Studio['notice']>(null);
  const [focus, setFocus] = useState<Studio['focus']>(null);
  const [gov, setGov] = useState<GovState>(() => govMemory ?? emptyGov());
  const govRef = useRef(gov);
  govRef.current = gov;
  useEffect(() => { govMemory = gov; }, [gov]);
  const govern = useCallback<Studio['govern']>((step) => {
    try { const next = step(govRef.current); govRef.current = next; setGov(next); return null; } catch (e) { return e instanceof Error ? e.message : 'That is not allowed.'; }
  }, []);
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => { memory = state; }, [state]);

  const say = useCallback((text: string) => setNotice({ text, at: Date.now() }), []);

  const apply = useCallback<Studio['apply']>((label, op) => {
    const cur = ref.current;
    const result = op(cur.ws);
    const [ws, value] = Array.isArray(result) ? result : [result, undefined];
    if (ws === cur.ws) return value;
    const next = { ws, past: [...cur.past, { ws: cur.ws, label }].slice(-LIMIT), future: [] };
    ref.current = next;
    setState(next);
    say(label);
    return value;
  }, [say]);

  const undo = useCallback(() => {
    const cur = ref.current;
    const last = cur.past[cur.past.length - 1];
    if (!last) return;
    const next = { ws: last.ws, past: cur.past.slice(0, -1), future: [{ ws: cur.ws, label: last.label }, ...cur.future] };
    ref.current = next;
    setState(next);
    say(`Undid: ${last.label}`);
  }, [say]);

  const redo = useCallback(() => {
    const cur = ref.current;
    const first = cur.future[0];
    if (!first) return;
    const next = { ws: first.ws, past: [...cur.past, { ws: cur.ws, label: first.label }], future: cur.future.slice(1) };
    ref.current = next;
    setState(next);
    say(`Redid: ${first.label}`);
  }, [say]);

  const reset = useCallback(() => {
    const next = { ws: sampleWorkspace(), past: [], future: [] };
    ref.current = next;
    setState(next);
    govRef.current = emptyGov();
    setGov(govRef.current);
    say('Prototype reset to the sample library');
  }, [say]);

  const requestFocus = useCallback((key: string) => setFocus({ key, at: Date.now() }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // let fields undo typing
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const value = useMemo<Studio>(() => ({
    ws: state.ws, apply, undo, redo, reset, notice, focus, requestFocus, gov, govern,
    undoLabel: state.past[state.past.length - 1]?.label ?? null,
    redoLabel: state.future[0]?.label ?? null,
  }), [state, apply, undo, redo, reset, notice, focus, requestFocus, gov, govern]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Test helper: forget the in-memory workspace. */
export const resetStudioMemory = () => { memory = null; govMemory = null; };

export function useStudio(): Studio {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio must be used inside StudioProvider');
  return v;
}

/** Scrolls a control into view and flashes it when an issue asks for it. */
export function useFocusTarget(key: string) {
  const { focus } = useStudio();
  const el = useRef<HTMLDivElement | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!focus || focus.key !== key || !el.current) return;
    el.current.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 1600);
    return () => window.clearTimeout(t);
  }, [focus, key]);
  return { ref: el, flash };
}
