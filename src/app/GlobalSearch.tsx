// Top-bar global search (⌘K / Ctrl+K) with typed, scoped suggestions (API-071; DV-12 lifted in F2). ARIA 1.2
// combobox: arrow keys move through suggestions, Enter opens the highlighted record (Call Detail, or Policy
// Detail for a policy) or the full results page, Escape closes.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { Icon } from '../components/Icon';
import { hitTarget, matchedLabel, TYPE_ICONS, TYPE_LABELS } from '../features/search/SearchPage';

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  const q = useDebounced(text.trim(), 200);
  const suggest = useQuery({
    queryKey: ['search', 'suggest', q], enabled: q.length >= 2,
    queryFn: async () => unwrap(await api.GET('/api/v1/search/suggest', { params: { query: { q } } })),
  });
  // Suggestions are shown only for the text currently typed, never for a stale debounced query.
  const items = q.length >= 2 && q === text.trim() ? suggest.data?.items ?? [] : [];

  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); }
    };
    const click = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', click);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', click); };
  }, []);

  const go = (to: string) => { setOpen(false); setText(''); input.current?.blur(); navigate(to, { state: { from: location.pathname + location.search } }); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = items[active];
      if (hit) go(hitTarget(hit));
      else if (text.trim()) go(`/search?q=${encodeURIComponent(text.trim())}`);
    }
  };
  const showList = open && text.trim().length >= 2;

  return (
    <div className="global-search" ref={wrap}>
      <label className="topsearch">
        <Icon name="search" size="sm" />
        <span className="sr-only">Search cases, policies, attempts and sessions</span>
        <input ref={input} role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} value={text} maxLength={64}
          placeholder="Search case, policy, attempt or session ref…" onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)} onKeyDown={onKey} />
        <kbd aria-hidden="true">⌘ K</kbd>
      </label>
      {showList ? (
        <ul className="suggest" id={listId} role="listbox" aria-label="Suggestions">
          {(suggest.isFetching || q !== text.trim()) && !items.length ? <li className="suggest-note" role="presentation">Searching…</li> : null}
          {suggest.isError ? <li className="suggest-note" role="presentation">Suggestions are unavailable. Press Enter to search.</li> : null}
          {!suggest.isFetching && suggest.isSuccess && q === text.trim() && !items.length ? <li className="suggest-note" role="presentation">No matching records in your scope</li> : null}
          {items.map((h, i) => (
            <li key={`${h.entity_type}:${h.ref}:${h.matched_field}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={i === active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); go(hitTarget(h)); }}
              onMouseEnter={() => setActive(i)}>
              <Icon name={TYPE_ICONS[h.entity_type] ?? 'files'} size="sm" />
              <span className="suggest-main"><b className="mono">{h.ref}</b><span className="xsmall muted">{h.masked_display}</span></span>
              <span className="xsmall muted">{TYPE_LABELS[h.entity_type]} · {matchedLabel(h.matched_field)}</span>
            </li>
          ))}
          <li className="suggest-note" role="presentation">Enter: open all results · ↑↓ to choose</li>
        </ul>
      ) : null}
    </div>
  );
}
