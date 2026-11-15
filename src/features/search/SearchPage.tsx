// Search (`/search`), F2: ranked, scoped hits over approved identifiers (API-070). Each hit shows its entity type,
// masked display, matched field and match kind. Case, attempt and session hits open Call Detail (F3); policy hits open
// Policy Detail (F4).
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, unwrap, type SearchHit } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Icon, type IconName } from '../../components/Icon';
import { Empty, Forbidden } from '../../components/StateView';
import { Badge, Button, Card, PageHead } from '../../components/ui';
import { count, Region, useFrom } from '../cases/shared';

export const TYPE_LABELS: Record<string, string> = { case: 'Callback case', policy: 'Policy', attempt: 'Contact attempt', session: 'Conversation session' };
export const TYPE_ICONS: Record<string, IconName> = { case: 'files', policy: 'briefcase', attempt: 'phone', session: 'mic' };
const KIND_TONES = { EXACT: 'green', PREFIX: 'blue', FUZZY: 'gray' } as const;
const TABS: [string, string][] = [['', 'All'], ['case', 'Cases'], ['policy', 'Policies'], ['attempt', 'Attempts'], ['session', 'Sessions']];

/** Where a hit opens: Call Detail for case, attempt and session hits; Policy Detail for policies. */
export const hitTarget = (h: SearchHit) => h.route;
export const matchedLabel = (f: string) => f.replace(/_/g, ' ').replace('contact phone', 'phone (exact, protected token)').replace('contact email', 'email (exact, protected token)');

export function SearchPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const [text, setText] = useState(q);
  const [cursor, setCursor] = useState<string[]>([]);
  useEffect(() => { setText(q); setCursor([]); }, [q, type]);
  const allowed = can('search.use');
  const results = useQuery({
    queryKey: ['search', q, type, cursor[cursor.length - 1] ?? null], enabled: allowed && q.trim().length > 0,
    queryFn: async () => unwrap(await api.GET('/api/v1/search', { params: { query: {
      q, limit: 20, ...(type ? { types: [type] } : {}), ...(cursor.length ? { cursor: cursor[cursor.length - 1] } : {}),
    } } })),
  });
  const totals = useQuery({ // per-type counts for the tabs, always over all types (scoped server-side)
    queryKey: ['search', 'counts', q], enabled: allowed && q.trim().length > 0,
    queryFn: async () => unwrap(await api.GET('/api/v1/search', { params: { query: { q, limit: 1 } } })),
  });
  if (!allowed) return <Forbidden />;
  const counts = totals.data?.counts ?? {};
  const submit = (e: FormEvent) => { e.preventDefault(); setParams(text.trim() ? { q: text.trim(), ...(type ? { type } : {}) } : {}); };

  return (
    <>
      <PageHead eyebrow="Cross-domain discovery" title="Search"
        description="Find a callback case, policy, contact attempt or conversation session by reference, or a case by an exact phone number or email. Results are limited to your Singapore scope." />
      <Card>
        <form className="row" role="search" aria-label="Search records" onSubmit={submit}
          style={{ height: 52, gap: 14, borderBottom: '1px solid var(--line)', marginBottom: 17, paddingBottom: 16 }}>
          <Icon name="search" size="lg" />
          <label className="sr-only" htmlFor="search-page-input">Search</label>
          <input id="search-page-input" className="field" style={{ flex: 1, border: 'none', fontSize: 15, boxShadow: 'none', padding: 0 }}
            value={text} maxLength={64} onChange={(e) => setText(e.target.value)} placeholder="Try CB-2026-10482, POL-SG-000001, AT-2026-…, SS-2026-…" />
          <Button type="submit" variant="primary">Search</Button>
        </form>
        <div className="row wrap between">
          <div className="pill-tabs" role="group" aria-label="Result type">
            {TABS.map(([code, label]) => (
              <button type="button" key={code} className={type === code ? 'active' : ''} aria-pressed={type === code}
                onClick={() => setParams(q ? { q, ...(code ? { type: code } : {}) } : {})}>
                {label}{totals.data ? ` (${count(code ? counts[code] ?? 0 : totals.data.total)})` : ''}
              </button>
            ))}
          </div>
          {results.data ? <span className="small muted" role="status">{count(results.data.total)} matching records · ranked exact, then prefix, then partial</span> : null}
        </div>
        <div style={{ marginTop: 14 }}>
          {!q.trim() ? <Empty title="Enter a reference to search">Case, policy, attempt and session references; phone and email match exactly only.</Empty> : (
            <Region query={results} label="search results">{() => results.data!.items.length === 0
              ? <Empty title="No matching records in your scope">Check the reference, or search a shorter prefix.</Empty>
              : <ul className="plain-list" aria-label="Search results">{results.data!.items.map((h) => <HitRow key={`${h.entity_type}:${h.ref}:${h.matched_field}`} h={h} />)}</ul>}</Region>
          )}
          {results.data && (cursor.length || results.data.page.next_cursor) ? (
            <div className="row right" style={{ marginTop: 12 }}>
              <Button tiny disabled={!cursor.length} onClick={() => setCursor((c) => c.slice(0, -1))}>Previous</Button>
              <Button tiny disabled={!results.data.page.next_cursor} onClick={() => setCursor((c) => [...c, results.data!.page.next_cursor!])}>Next</Button>
            </div>
          ) : null}
        </div>
      </Card>
    </>
  );
}

function HitRow({ h }: { h: SearchHit }) {
  const from = useFrom();
  return (
    <li>
      <Link className="search-result" to={hitTarget(h)} state={from} data-testid="search-hit">
        <div className="activity-icon"><Icon name={TYPE_ICONS[h.entity_type] ?? 'files'} /></div>
        <div style={{ flex: 1 }}>
          <div className="row wrap" style={{ marginBottom: 6 }}>
            <Badge tone="gray">{TYPE_LABELS[h.entity_type] ?? h.entity_type}</Badge>
            <Badge tone={KIND_TONES[h.match_kind]}>{h.match_kind.toLowerCase()} match</Badge>
            <span className="small muted">on {matchedLabel(h.matched_field)}</span>
          </div>
          <h4 className="mono">{h.ref}</h4>
          <p>{h.masked_display}</p>
          <p className="xsmall">{h.entity_type === 'policy' ? 'Opens Policy Detail' : `Opens Call Detail${h.entity_type === 'case' ? '' : ` at this ${h.entity_type}`}`}</p>
        </div>
        <Icon name="chev" size="sm" />
      </Link>
    </li>
  );
}
