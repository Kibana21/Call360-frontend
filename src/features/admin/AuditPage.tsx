import { useInfiniteQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, ApiFailure, unwrap, type AuditEvent } from '../../api/client';
import { Empty, ErrorState, Forbidden, Loading } from '../../components/StateView';
import { Badge, Button, Card } from '../../components/ui';

type Outcome = '' | 'SUCCEEDED' | 'DENIED' | 'FAILED';
const tone = (o: string) => (o === 'SUCCEEDED' ? 'green' : o === 'DENIED' ? 'red' : 'amber') as 'green' | 'red' | 'amber';
const actorOf = (e: AuditEvent) =>
  e.actor_display_name ?? (e.actor_service ? `Service: ${e.actor_service}` : e.actor_principal_id ? e.actor_principal_id.slice(0, 8) : 'Anonymous');
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Singapore' }).format(new Date(iso));

export function AuditPage() {
  const [filters, setFilters] = useState<{ action: string; outcome: Outcome }>({ action: '', outcome: '' });
  const [draft, setDraft] = useState(filters);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['admin', 'audit', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => unwrap(await api.GET('/api/v1/admin/audit-events', {
      params: { query: { limit: 50, cursor: pageParam, action: filters.action || undefined, outcome: filters.outcome || undefined } },
    })),
    getNextPageParam: (last) => last.page.next_cursor ?? undefined,
  });

  function apply(event: FormEvent) {
    event.preventDefault();
    setFilters(draft);
  }

  let body;
  if (query.isPending) body = <Loading label="Loading audit events…" />;
  else if (query.isError) {
    const e = query.error;
    body = e instanceof ApiFailure && e.status === 403 ? <Forbidden />
      : <ErrorState message="Audit events could not be loaded." correlationId={e instanceof ApiFailure ? e.body?.correlation_id : null} onRetry={() => void query.refetch()} />;
  } else {
    const events = query.data.pages.flatMap((p) => p.items);
    body = events.length === 0 ? <Empty title="No matching audit events" /> : (
      <div className="table-wrap">
        <table className="data-table audit-table">
          <caption className="sr-only">Audit events, newest first</caption>
          <thead><tr><th scope="col">Time (SGT)</th><th scope="col">Action</th><th scope="col">Outcome</th><th scope="col">Actor</th><th scope="col">Entity</th><th scope="col">Reason</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.event_id}>
                <td className="mono">{when(e.occurred_at)}</td>
                <td className="mono strong wrap action">{e.action}</td>
                <td><Badge tone={tone(e.outcome)}>{e.outcome}</Badge></td>
                <td className="wrap">{actorOf(e)}</td>
                <td className="mono xsmall wrap">{e.entity_type ? `${e.entity_type}${e.entity_id ? ` · ${e.entity_id.slice(0, 12)}` : ''}` : '—'}{e.scope_redacted ? <span className="muted"> · withheld (outside your markets)</span> : null}</td>
                <td className="wrap-text">{e.reason ?? '—'}</td>
                <td><button type="button" className="linkbtn" onClick={() => setSelected(e)}>View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Card title="Audit trail" subtitle="Append-only and hash-chained; nothing can be edited or deleted. This operational view shows events for your markets (Singapore) and platform events; records outside your markets are not listed or are shown with their identifier withheld. The complete ledger is retained and verified (System)." pad={false}>
      <form className="table-toolbar" onSubmit={apply} aria-label="Filter audit events">
        <label className="sr-only" htmlFor="f-action">Action starts with</label>
        <input id="f-action" className="field wide" placeholder="Action starts with, e.g. AUTH. or ADMIN." maxLength={64}
          value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
        <label className="sr-only" htmlFor="f-outcome">Outcome</label>
        <select id="f-outcome" className="field" value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value as Outcome })}>
          <option value="">All outcomes</option><option value="SUCCEEDED">Succeeded</option><option value="DENIED">Denied</option><option value="FAILED">Failed</option>
        </select>
        <Button type="submit" icon="filter">Apply</Button>
      </form>
      {body}
      {query.hasNextPage ? <div style={{ padding: 15 }}><Button onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>Load more</Button></div> : null}
      {selected ? <EventDrawer event={selected} onClose={() => setSelected(null)} /> : null}
    </Card>
  );
}

function EventDrawer({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="event-title">
        <div className="drawer-head">
          <div><div className="eyebrow">Audit event #{event.seq}</div><h2 id="event-title" className="mono wrap-anywhere">{event.action}</h2></div>
          <Button icon="close" onClick={onClose} aria-label="Close" autoFocus>Close</Button>
        </div>
        <div className="drawer-body">
          <dl className="kv">
            <dt>Time</dt><dd>{when(event.occurred_at)} SGT</dd>
            <dt>Outcome</dt><dd><Badge tone={tone(event.outcome)}>{event.outcome}</Badge></dd>
            <dt>Actor</dt><dd>{event.actor_display_name ?? (event.actor_service ? `Service: ${event.actor_service}` : '—')} {event.actor_username ? <span className="mono xsmall">({event.actor_username})</span> : null}</dd>
            <dt>Entity</dt><dd className="mono wrap-anywhere">{event.entity_type ?? '—'} {event.entity_id ?? ''}{event.scope_redacted
              ? <span className="muted" style={{ fontFamily: 'inherit' }}> — {event.action === 'SEED.MANIFEST' ? 'dataset-wide totals withheld (all markets)' : 'record outside your markets; identifier withheld'}</span> : null}</dd>
            <dt>Reason</dt><dd>{event.reason ?? '—'}</dd>
            <dt>Correlation ID</dt><dd className="mono xsmall">{event.correlation_id ?? '—'}</dd>
            <dt>Source IP</dt><dd className="mono xsmall">{event.source_ip ?? '—'}</dd>
          </dl>
          <div className="section-label" style={{ marginTop: 20 }}>Before</div>
          <pre className="jsonbox">{event.before ? JSON.stringify(event.before, null, 2) : '—'}</pre>
          <div className="section-label" style={{ marginTop: 14 }}>After</div>
          <pre className="jsonbox">{event.after ? JSON.stringify(event.after, null, 2) : '—'}</pre>
        </div>
      </aside>
    </div>
  );
}
