// Survey Applicability (APPL-X1) — the small shared pieces of the workspace: icons, truth-value marks, drawers,
// searchable pickers. State is never carried by colour alone: every mark has a shape and a word.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Tri } from './model/types';

const PATHS = {
  variable: 'M7 3.5C5 3.5 5 5 5 6.5S5 9 3.5 10C5 11 5 12 5 13.5S5 16.5 7 16.5M13 3.5c2 0 2 1.5 2 3s0 2.5 1.5 3.5C15 11 15 12 15 13.5s0 3-2 3',
  profile: 'M10 3l7 3.5-7 3.5-7-3.5L10 3zM3 10l7 3.5 7-3.5M3 13.5L10 17l7-3.5',
  condition: 'M4 5h4a3 3 0 013 3v4a3 3 0 003 3h2M4 15h4a3 3 0 003-3M14 12.5l2.5 2.5-2.5 2.5',
  survey: 'M7 4h6M7 3h6v2H7V3zM5 4.5H4.5v12h11v-12H15M7.5 9h5M7.5 12h5',
  scenario: 'M8 3v5l-4 7a1.5 1.5 0 001.300 2.200h9.400A1.5 1.5 0 0016 15l-4-7V3M7 3h6M6.5 12h7',
  policy: 'M10 2.5l6 2.5v4.5c0 4-2.600 6.800-6 8-3.400-1.200-6-4-6-8V5l6-2.5zM7.5 10l2 2 3.5-4',
  check: 'M4 10.5l4 4 8-9', x: 'M5 5l10 10M15 5L5 15', question: 'M7.5 7.5a2.5 2.5 0 115 0c0 1.700-2.5 2-2.5 4M10 14.5v.5',
  plus: 'M10 4v12M4 10h12', search: 'M9 15A6 6 0 109 3a6 6 0 000 12zM13.5 13.5L17 17',
  down: 'M5 8l5 5 5-5', right: 'M8 5l5 5-5 5', left: 'M12 5l-5 5 5 5', up: 'M5 12l5-5 5 5',
  undo: 'M7 6L3.5 9.5 7 13M4 9.5h8a4 4 0 010 8h-2', redo: 'M13 6l3.5 3.5L13 13M16 9.5H8a4 4 0 000 8h2',
  grip: 'M7.5 5v.01M12.5 5v.01M7.5 10v.01M12.5 10v.01M7.5 15v.01M12.5 15v.01',
  replace: 'M4 7h10l-3-3M16 13H6l3 3', order: 'M8 5h9M8 10h9M8 15h9M3.5 4v2.5M3 9.5h1.5L3 11.5h1.5M3 14h1.5v3H3',
  trash: 'M4 6h12M8 6V4h4v2M6 6l.700 10h6.600L14 6', copy: 'M7 7h9v9H7zM4 13V4h9', play: 'M6 4l10 6-10 6V4z',
  warn: 'M10 3l7.5 13h-15L10 3zM10 8v4M10 14v.5', info: 'M10 17a7 7 0 100-14 7 7 0 000 14zM10 9v5M10 6v.5',
  arrow: 'M4 10h12M12 6l4 4-4 4', cards: 'M3 4h14v5H3zM3 11h14v5H3z', canvas: 'M3 4h5v4H3zM12 12h5v4h-5zM8 6h2a2 2 0 012 2v4',
  table: 'M3 4h14v12H3zM3 8h14M3 12h14M8 4v12', lock: 'M6 9V7a4 4 0 018 0v2M5 9h10v8H5z', eye: 'M2.5 10S5 4.5 10 4.5 17.5 10 17.5 10 15 15.5 10 15.5 2.5 10 2.5 10zM10 12a2 2 0 100-4 2 2 0 000 4z',
  link: 'M8.5 11.5a3 3 0 004.200 0l2.5-2.5a3 3 0 00-4.200-4.200l-1 1M11.5 8.5a3 3 0 00-4.200 0l-2.5 2.5a3 3 0 004.200 4.200l1-1',
  command: 'M7 7h6v6H7zM7 7H5.5A1.5 1.5 0 117 5.5V7zM13 7h1.5A1.5 1.5 0 1013 5.5V7zM7 13H5.5A1.5 1.5 0 107 14.5V13zM13 13h1.5a1.5 1.5 0 11-1.5 1.5V13z',
  user: 'M10 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3.5 17c.5-3 3-4.5 6.5-4.5s6 1.5 6.5 4.5', dot: 'M10 10v.01',
  sparkle: 'M10 3l1.5 4.5L16 9l-4.5 1.5L10 15l-1.5-4.5L4 9l4.5-1.5L10 3z', download: 'M10 3v10M6 9.5l4 4 4-4M4 16.5h12',
  minus: 'M4 10h12', panel: 'M3 4h14v12H3zM8 4v12', history: 'M4 10a6 6 0 106-6 6 6 0 00-4.5 2M4 4v3h3M10 7v3.5l2 1.5',
} as const;
export type IconName = keyof typeof PATHS;
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="ap-icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>
  );
}

export const TRI_WORD: Record<Tri, string> = { TRUE: 'Matches', FALSE: 'Does not match', UNKNOWN: 'Cannot tell yet' };
const TRI_ICON: Record<Tri, IconName> = { TRUE: 'check', FALSE: 'minus', UNKNOWN: 'question' };
/** A truth value as a shape and a word. */
export function TriMark({ value, word, small }: { value: Tri | undefined | null; word?: string; small?: boolean }) {
  if (!value) return <span className={`ap-tri ap-tri-none${small ? ' small' : ''}`} data-tri="NONE"><Icon name="dot" size={12} /> Not tested</span>;
  return <span className={`ap-tri ap-tri-${value.toLowerCase()}${small ? ' small' : ''}`} data-tri={value}><Icon name={TRI_ICON[value]} size={small ? 11 : 13} />{word ?? TRI_WORD[value]}</span>;
}
export function Tag({ tone = 'plain', children, title, testid }: { tone?: 'plain' | 'draft' | 'published' | 'warn' | 'bad' | 'info' | 'var' | 'cond' | 'survey' | 'profile' | 'unknown'; children: ReactNode; title?: string; testid?: string }) {
  return <span className={`ap-tag ap-tag-${tone}`} title={title} data-testid={testid}>{children}</span>;
}
export function Empty({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="ap-empty"><span className="ap-empty-icon"><Icon name={icon} size={22} /></span><strong>{title}</strong>{children ? <p>{children}</p> : null}{action}</div>;
}
export function Segmented<T extends string>({ value, options, onChange, label, testid }: { value: T; options: { value: T; label: string; icon?: IconName; testid?: string }[]; onChange: (v: T) => void; label: string; testid?: string }) {
  return (
    <div className="ap-seg" role="radiogroup" aria-label={label} data-testid={testid}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} data-testid={o.testid} onClick={() => onChange(o.value)}>
          {o.icon ? <Icon name={o.icon} size={14} /> : null}{o.label}
        </button>
      ))}
    </div>
  );
}

/** Keeps keyboard focus inside an open panel, closes it on Escape and gives focus back where it came from. */
export function usePanelFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const from = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button');
    first?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const a = items[0]!, z = items.at(-1)!;
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); from?.focus?.(); };
  }, [open, onClose]);
  return ref;
}
export function DrawerPanel({ title, subtitle, onClose, children, footer, wide, testid }: { title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; testid?: string }) {
  const ref = usePanelFocus(true, onClose);
  const id = useId();
  return (
    <div className="ap-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`ap-drawer${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} data-testid={testid}>
        <header className="ap-drawer-head">
          <div><h2 id={id}>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
          <button type="button" className="ap-iconbtn" aria-label="Close" onClick={onClose} data-testid="ap-drawer-close"><Icon name="x" /></button>
        </header>
        <div className="ap-drawer-body">{children}</div>
        {footer ? <footer className="ap-drawer-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export interface PickItem { id: string; label: string; hint?: string; group?: string; icon?: IconName; tag?: ReactNode; disabled?: boolean }
/** A searchable list in a popover: never a long dropdown. Arrow keys move, Enter chooses, Escape closes. */
export function Picker({ label, items, onPick, button, testid, placeholder = 'Search…', footer, align = 'left', className = '' }: {
  label: string; items: PickItem[]; onPick: (id: string) => void; button: ReactNode; testid?: string; placeholder?: string;
  footer?: (close: () => void, query: string) => ReactNode; align?: 'left' | 'right'; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const shown = useMemo(() => { const k = q.trim().toLowerCase(); return k ? items.filter((i) => `${i.label} ${i.hint ?? ''} ${i.group ?? ''}`.toLowerCase().includes(k)) : items; }, [items, q]);
  const close = () => { setOpen(false); setQ(''); btn.current?.focus(); };
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  useEffect(() => { setAt(0); }, [q, open]);
  const choose = (i: PickItem | undefined) => { if (!i || i.disabled) return; onPick(i.id); close(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => Math.min(n + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => Math.max(n - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(shown[at]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  let group = '';
  return (
    <div className={`ap-picker ${className}`} ref={wrap}>
      <button ref={btn} type="button" className="ap-picker-btn" aria-haspopup="listbox" aria-expanded={open} title={label} data-testid={testid} onClick={() => setOpen((o) => !o)}>{button}</button>
      {open ? (
        <div className={`ap-pop ${align}`} data-testid={testid ? `${testid}-panel` : undefined}>
          <div className="ap-pop-search"><Icon name="search" size={14} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={placeholder} aria-label={`${label}: search`} data-testid={testid ? `${testid}-search` : undefined} /></div>
          <ul role="listbox" aria-label={label}>
            {shown.map((i, n) => {
              const head = i.group && i.group !== group ? (group = i.group) : null;
              return (
                <li key={i.id} role="presentation">
                  {head ? <div className="ap-pop-group">{head}</div> : null}
                  <button type="button" role="option" aria-selected={n === at} disabled={i.disabled} className={n === at ? 'at' : ''} data-testid={testid ? `${testid}-opt-${i.id}` : undefined} onMouseEnter={() => setAt(n)} onClick={() => choose(i)}>
                    {i.icon ? <span className="ap-pop-icon"><Icon name={i.icon} size={14} /></span> : null}
                    <span className="ap-pop-text"><strong>{i.label}</strong>{i.hint ? <small>{i.hint}</small> : null}</span>{i.tag}
                  </button>
                </li>
              );
            })}
            {!shown.length ? <li className="ap-pop-none">Nothing matches “{q}”.</li> : null}
          </ul>
          {footer ? <div className="ap-pop-foot">{footer(close, q)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
export function Field({ label, hint, error, children, wide }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; wide?: boolean }) {
  return <label className={`ap-field${wide ? ' wide' : ''}${error ? ' bad' : ''}`}><span className="ap-field-label">{label}</span>{children}{error ? <span className="ap-field-error" role="alert"><Icon name="warn" size={12} /> {error}</span> : hint ? <span className="ap-field-hint">{hint}</span> : null}</label>;
}
export const short = (fingerprint: string | null | undefined) => (fingerprint ? fingerprint.slice(0, 10) : '—');

/** One value kept in the address (so a link can point at it) and in the page at once: the page changes immediately,
    the address follows. A change of the address from elsewhere (a link, the command palette) is followed too. */
export function useParamState(key: string): [string | null, (v: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(key);
  const [value, setValue] = useState(fromUrl);
  // what this page itself wrote to the address and has not yet seen come back: the address lags a moment behind
  const pending = useRef<(string | null)[]>([]);
  const seen = useRef(fromUrl);
  useEffect(() => {
    if (fromUrl === seen.current) return;
    seen.current = fromUrl;
    const mine = pending.current.indexOf(fromUrl);
    if (mine >= 0) pending.current = pending.current.slice(mine + 1); // our own write arriving: nothing to follow
    else { pending.current = []; setValue(fromUrl); } // a link or the command palette changed it: follow
  }, [fromUrl]);
  const set = useCallback((v: string | null) => {
    setValue(v);
    pending.current = [...pending.current, v];
    setParams((prev) => { const p = new URLSearchParams(prev); if (v === null) p.delete(key); else p.set(key, v); return p; }, { replace: true });
  }, [key, setParams]);
  return [value, set];
}
