// Survey Studio (FI-1 correction) — the browser's Back and Forward buttons, when a saved survey has unsaved work.
// The application uses a plain browser router, which cannot refuse a history move. So this listener, registered when the
// module is loaded (before the router's own) and in the capture phase, sees every history move first. When a guard is
// set and the move would leave the survey, it hides the move from the router, puts the address back where it was, and
// asks the guard — which shows the same "unsaved changes" dialog as a link does. Nothing is unmounted, so the complete
// workspace, its undo history and the open view are exactly as they were. Choosing to leave repeats the move, unhidden.
// Moves between screens of the same survey are never touched. Closing or reloading the page is the browser's own prompt.
export interface HistoryGuard {
  /** True for addresses that belong to the open survey. */
  inside: (pathname: string) => boolean;
  /** Called when a move out of the survey has been held back: `delta` is the move (‑1 = Back once). */
  onBlocked: (delta: number) => void;
}

let guard: HistoryGuard | null = null;
let lastIndex: number | null = null;
let restoring = false;
let passing = false;

const indexNow = (): number | null => { const i = (window.history.state as { idx?: unknown } | null)?.idx; return typeof i === 'number' ? i : null; };

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    if (restoring) { restoring = false; e.stopImmediatePropagation(); return; } // our own move back into the survey
    if (passing) { passing = false; return; } // a move the author confirmed
    if (!guard) return;
    const now = indexNow();
    if (guard.inside(window.location.pathname)) { lastIndex = now; return; }
    if (now === null || lastIndex === null || now === lastIndex) return; // position unknown: do not interfere
    const delta = now - lastIndex;
    e.stopImmediatePropagation(); // the router never learns of the move, so nothing is unmounted
    restoring = true;
    window.history.go(-delta);
    guard.onBlocked(delta);
  }, true);
}

/** Set (or clear) the guard. While set, a Back or Forward that would leave the survey is held and reported. */
export function setHistoryGuard(g: HistoryGuard | null): void { guard = g; if (g) lastIndex = indexNow(); }
/** Tell the guard where the survey currently is in the history (after every in-application navigation). */
export function noteHistoryPosition(): void { if (guard && guard.inside(window.location.pathname)) lastIndex = indexNow(); }
/** Carry out a held move after the author chose to leave. */
export function passHeldMove(delta: number): void { passing = true; window.history.go(delta); }
