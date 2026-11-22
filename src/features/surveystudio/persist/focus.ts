// Survey Studio — keyboard focus for a drawer that is a modal dialog (the inspector, the survey overview).
// On opening, focus moves into the drawer; Tab and Shift+Tab stay inside it; Escape closes it; and on closing, focus
// goes back to whatever opened it. Nothing here is visual, and nothing here has been tested with a screen reader.
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
/** What Tab can reach inside `el`, in order. A control inside a closed <details> is skipped; its <summary> is not. */
export function focusableIn(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => {
    const closed = x.closest('details:not([open])');
    return !closed || (x.tagName === 'SUMMARY' && x.parentElement === closed);
  });
}

export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!el) return;
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const f = focusableIn(el);
      const first = f[0], last = f[f.length - 1], active = document.activeElement as HTMLElement | null;
      if (!first || !last) { e.preventDefault(); el.focus(); return; }
      if (!active || !el.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // back to what opened the drawer, if it is still there (a card of the gallery, a row of the list)
      if (opener && opener !== document.body && document.contains(opener)) opener.focus();
    };
  }, [ref]);
}
