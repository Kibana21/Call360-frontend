// Survey Studio prototype — small shared interface pieces (design-system components for SS-02A).
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ModuleKind } from './model/types';

// ---- glyphs (local 20×20 line icons; decorative, always paired with text or an accessible name) ---------------------
const PATHS = {
  plus: 'M10 4v12M4 10h12',
  copy: 'M7 7h9v9H7V7Zm-3 6V4h9',
  next: 'M4 10h11m-4-4 4 4-4 4',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
  undo: 'M7 5 3 9l4 4M3 9h8a5 5 0 0 1 0 10H9',
  redo: 'm13 5 4 4-4 4M17 9H9a5 5 0 0 0 0 10h2',
  grip: 'M7 5h.01M7 10h.01M7 15h.01M13 5h.01M13 10h.01M13 15h.01',
  up: 'm5 12 5-5 5 5',
  down: 'm5 8 5 5 5-5',
  right: 'm8 5 5 5-5 5',
  close: 'M5 5l10 10M15 5 5 15',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10',
  search: 'M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12Zm8 2-3.5-3.5',
  alert: 'M10 3 2 17h16L10 3Zm0 5v4m0 3h.01',
  check: 'm4 10 4 4 8-8',
  merge: 'M5 3v4a5 5 0 0 0 5 5h5M5 17v-4M12 9l3 3-3 3',
  branch: 'M5 3v14M5 9h6a4 4 0 0 0 4-4V3',
  link: 'M8 12a4 4 0 0 0 6 0l2-2a4 4 0 0 0-6-6l-1 1M12 8a4 4 0 0 0-6 0l-2 2a4 4 0 0 0 6 6l1-1',
  lock: 'M5 9h10v8H5V9Zm2 0V7a3 3 0 0 1 6 0v2',
  open: 'M8 4H4v12h12v-4M11 4h5v5M16 4l-7 7',
  spark: 'M10 2v4M10 14v4M2 10h4M14 10h4M5 5l2 2M13 13l2 2M15 5l-2 2M7 13l-2 2',
  list: 'M4 5h12M4 10h12M4 15h8',
  flow: 'M4 4h5v4H4V4Zm7 8h5v4h-5v-4ZM6.5 8v3a1 1 0 0 0 1 1H11',
  text: 'M4 5h12M10 5v11M7 16h6',
  yesno: 'M3 10a7 7 0 1 0 14 0 7 7 0 0 0-14 0Zm7-7v14',
  single: 'M3 10a7 7 0 1 0 14 0 7 7 0 0 0-14 0Zm5 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z',
  multi: 'M4 4h12v12H4V4Zm3 6 2 2 4-4',
  stop: 'M6 3h8l3 3v8l-3 3H6l-3-3V6l3-3Z',
  info: 'M10 9v5m0-8h.01M3 10a7 7 0 1 0 14 0 7 7 0 0 0-14 0Z',
  number: 'M8 3 6 17M14 3l-2 14M4 7h13M3 13h13',
  ack: 'M4 4h12v12H4V4Zm3 6 2 2 4-4M7 2v2m6-2v2',
  say: 'M4 4h12v9H9l-4 3v-3H4V4Z',
  variable: 'M7 4c-2 0-2 2-2 3s0 3-2 3c2 0 2 2 2 3s0 3 2 3m6-12c2 0 2 2 2 3s0 3 2 3c-2 0-2 2-2 3s0 3-2 3',
} as const;
export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 16 }: { name: GlyphName; size?: number }) {
  return (
    <svg className="ss-glyph" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

export const KIND_GLYPH: Record<ModuleKind, GlyphName> = {
  OPENING: 'spark', COMMON: 'list', PRODUCT: 'flow', RISK: 'alert', EXCEPTION: 'stop', CLOSING: 'check',
};

// ---- popover ------------------------------------------------------------------------------------------------------
/** A menu or picker anchored to its trigger. Closes on outside press and Escape; returns focus to the trigger. */
export function Popover({ trigger, children, align = 'start', label, open: controlled, onOpenChange, wide }: {
  trigger: (p: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'dialog'; ref: (el: HTMLButtonElement | null) => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  wide?: boolean;
}) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const setOpen = (v: boolean) => { setInner(v); onOpenChange?.(v); };
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  /**
   * In the graph editors the popover is placed against the WINDOW, so neither a scrolling side panel nor the bottom of
   * the screen can clip it. Placement is collision-aware: below the trigger when it fits, otherwise above, otherwise on
   * the side with more room with its own height limited to that room (it scrolls inside). Never off-screen.
   */
  const [fixed, setFixed] = useState<{ left: number; top: number; maxHeight?: number; side: 'below' | 'above' } | null>(null);
  const close = () => { setOpen(false); btn.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const el = panel.current;
    // a graph surface, but not inside the zoomed canvas itself (a transformed ancestor would capture "fixed")
    const host = wrap.current?.closest('.react-flow__viewport') ? null : wrap.current?.closest<HTMLElement>('.ss-g-panel, .ss-g-wrap, .ss-graph-page');
    if (host && btn.current) {
      const place = () => {
        if (!btn.current) return;
        el.style.maxHeight = '';
        const r = el.getBoundingClientRect();
        const b = btn.current.getBoundingClientRect();
        const GAP = 6, EDGE = 8;
        const below = window.innerHeight - b.bottom - GAP - EDGE, above = b.top - GAP - EDGE;
        const side: 'below' | 'above' = r.height <= below || below >= above ? 'below' : 'above';
        const room = Math.max(120, side === 'below' ? below : above);
        const height = Math.min(r.height, room);
        // The route toolbar is itself positioned with a transform, which makes it the containing block of anything
        // "fixed" inside it: window coordinates are converted to that block's own.
        const block = wrap.current?.closest<HTMLElement>('.ss-g-edgebar');
        const o = block ? block.getBoundingClientRect() : null;
        const dx = o && block ? o.left + block.clientLeft : 0, dy = o && block ? o.top + block.clientTop : 0;
        setFixed({ left: Math.max(EDGE, Math.min(b.left, window.innerWidth - r.width - EDGE)) - dx, top: (side === 'below' ? b.bottom + GAP : Math.max(EDGE, b.top - GAP - height)) - dy, side, ...(r.height > room ? { maxHeight: room } : {}) });
      };
      place();
      const shut = () => setOpen(false); // the anchor moves when the panel scrolls
      const scroller = host.classList.contains('ss-g-panel') ? host : null;
      scroller?.addEventListener('scroll', shut, { once: true });
      window.addEventListener('resize', place);
      const first = el.querySelector<HTMLElement>('[data-autofocus], input, button');
      first?.focus({ preventScroll: true });
      return () => { window.removeEventListener('resize', place); scroller?.removeEventListener('scroll', shut); };
    }
    setFixed(null);
    const r = el.getBoundingClientRect();
    setFlip(r.bottom > window.innerHeight - 8 && r.top - r.height > 80);
    const first = panel.current.querySelector<HTMLElement>('[data-autofocus], input, button');
    first?.focus({ preventScroll: true });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <span className="ss-pop" ref={wrap}>
      {trigger({ onClick: () => setOpen(!open), 'aria-expanded': open, 'aria-haspopup': 'dialog', ref: (el) => { btn.current = el; } })}
      {open ? (
        <div ref={panel} className={`ss-pop-panel ${align === 'end' ? 'end' : ''} ${flip ? 'flip' : ''} ${wide ? 'wide' : ''}`} role="dialog" aria-label={label}
          data-placed={fixed ? fixed.side : undefined}
          style={fixed ? { position: 'fixed', left: fixed.left, top: fixed.top, right: 'auto', bottom: 'auto', ...(fixed.maxHeight ? { maxHeight: fixed.maxHeight, overflowY: 'auto' as const } : {}) } : undefined}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
          {children(close)}
        </div>
      ) : null}
    </span>
  );
}

// ---- searchable picker --------------------------------------------------------------------------------------------
export interface PickItem { id: string; label: string; hint?: string; group?: string; glyph?: GlyphName; tone?: 'warn' }

/** Search-as-you-type list with arrow-key navigation. Used for destinations, modules, questions and conditions. */
export function Picker({ items, onPick, placeholder, empty, footer }: {
  items: PickItem[]; onPick: (id: string) => void; placeholder: string; empty?: string; footer?: ReactNode;
}) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const id = useId();
  const shown = items.filter((it) => !q.trim() || `${it.label} ${it.hint ?? ''} ${it.group ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(a + 1, shown.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && shown[at]) { e.preventDefault(); onPick(shown[at]!.id); }
  };
  let lastGroup: string | undefined;
  return (
    <div className="ss-picker">
      <div className="ss-picker-search">
        <Glyph name="search" />
        <input data-autofocus value={q} placeholder={placeholder} aria-label={placeholder} role="combobox" aria-expanded="true" aria-controls={id}
          aria-activedescendant={shown[at] ? `${id}-${at}` : undefined}
          onChange={(e) => { setQ(e.target.value); setAt(0); }} onKeyDown={key} />
      </div>
      <ul className="ss-picker-list" id={id} role="listbox">
        {shown.length === 0 ? <li className="ss-picker-empty">{empty ?? 'Nothing matches.'}</li> : null}
        {shown.map((it, i) => {
          const head = it.group && it.group !== lastGroup ? <li className="ss-picker-group" role="presentation">{it.group}</li> : null;
          lastGroup = it.group;
          return (
            <span key={it.id} style={{ display: 'contents' }}>
              {head}
              <li id={`${id}-${i}`} role="option" aria-selected={i === at} className={`ss-picker-item ${i === at ? 'active' : ''}`}
                onMouseEnter={() => setAt(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(it.id)}>
                {it.glyph ? <Glyph name={it.glyph} /> : null}
                <span className="ss-picker-text"><span>{it.label}</span>{it.hint ? <small>{it.hint}</small> : null}</span>
              </li>
            </span>
          );
        })}
      </ul>
      {footer ? <div className="ss-picker-foot">{footer}</div> : null}
    </div>
  );
}

// ---- segmented control ---------------------------------------------------------------------------------------------
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ value: T; label: string; hint?: string }>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="ss-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''}
          title={o.hint} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

// ---- drawer -------------------------------------------------------------------------------------------------------
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal side drawer (SS-02A.2). While it is open the rest of Survey Studio is inert and dimmed, Tab stays inside it,
 * Escape closes it, and focus returns to the control that opened it. It is named by its heading and described by its
 * subtitle.
 */
export function Drawer({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const self = ref.current;
    const root = self?.closest('.ss');
    // everything in the studio except the drawer's own ancestors becomes inert: no pointer, no focus, hidden from assistive technology
    const background = root ? Array.from(root.querySelectorAll<HTMLElement>(':scope > *, :scope > * > *'))
      .filter((el) => self && !el.contains(self) && !self.contains(el) && el !== backdrop.current) : [];
    background.forEach((el) => el.setAttribute('inert', ''));
    self?.focus();
    return () => {
      background.forEach((el) => el.removeAttribute('inert'));
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0]!, last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <>
      <div ref={backdrop} className="ss-backdrop" onMouseDown={onClose} data-testid="ss-drawer-backdrop" />
      <aside ref={ref} className="ss-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subtitle ? descId : undefined} tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="ss-drawer-head">
          <div><h2 id={titleId}>{title}</h2>{subtitle ? <p id={descId}>{subtitle}</p> : null}</div>
          <button type="button" className="ss-icon-btn" onClick={onClose} aria-label="Close"><Glyph name="close" /></button>
        </header>
        <div className="ss-drawer-body">{children}</div>
        {footer ? <footer className="ss-drawer-foot">{footer}</footer> : null}
      </aside>
    </>
  );
}

// ---- auto-growing text --------------------------------------------------------------------------------------------
/** A text area that looks like the text it holds and commits on blur (one undo step per edit, not per keystroke). */
export function InlineText({ value, onCommit, placeholder, label, className, autoFocus, readOnly }: {
  value: string; onCommit: (v: string) => void; placeholder: string; label: string; className?: string; autoFocus?: boolean; readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return (
    <textarea ref={ref} className={`ss-inline-text ${className ?? ''}`} rows={1} value={draft} placeholder={placeholder} aria-label={label} readOnly={readOnly}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
  );
}

export function Tag({ children, tone = 'plain', glyph }: { children: ReactNode; tone?: 'plain' | 'shared' | 'draft' | 'warn' | 'ok'; glyph?: GlyphName }) {
  return <span className={`ss-tag ${tone}`}>{glyph ? <Glyph name={glyph} size={13} /> : null}{children}</span>;
}
