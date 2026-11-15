// Work Queues (`/queues`), F2: read-only operational queues (API-076) whose rows come from the register (API-035)
// with the same `queue` predicate, so a tab's count always equals its rows and the matching Overview card
// (Due today = OPS-02, On hold = OPS-03). Launching sessions is Stage S1; assignment is Stage S4.
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, unwrap, type WorkQueue } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Icon, type IconName } from '../../components/Icon';
import { Empty, ErrorState, Forbidden, Loading } from '../../components/StateView';
import { Badge, Button, Card, PageHead, StageChip } from '../../components/ui';
import { CaseTable, count, failure, humanize, Region, when } from './shared';
import { useCasePages } from './useCasePages';

const ICONS: Record<string, IconName> = { DUE_TODAY: 'clock', OVERDUE: 'alert', AWAITING_CALLBACK: 'phone', ON_HOLD: 'lock' };
const CODES = ['DUE_TODAY', 'OVERDUE', 'AWAITING_CALLBACK', 'ON_HOLD'] as const;

export function WorkQueuesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const allowed = can('queue.read');
  const queue = (CODES as readonly string[]).includes(params.get('queue') ?? '') ? params.get('queue')! : 'DUE_TODAY';
  const holdReason = queue === 'ON_HOLD' ? params.get('hold_reason') ?? '' : '';
  const queues = useQuery({
    queryKey: ['work-queues'], enabled: allowed,
    queryFn: async () => unwrap(await api.GET('/api/v1/work-queues')),
  });
  const rowsQuery = { queue, ...(holdReason ? { hold_reason: [holdReason] } : {}) };
  const pages = useCasePages(rowsQuery, { enabled: allowed && can('case.read') });

  if (!allowed || (queues.isError && failure(queues.error).status === 403)) return <Forbidden />;
  const byCode = new Map((queues.data?.items ?? []).map((q) => [q.code, q]));
  const active = byCode.get(queue as WorkQueue['code']);
  const choose = (code: string, reason = '') => setParams(() => {
    const p = new URLSearchParams({ queue: code });
    if (reason) p.set('hold_reason', reason);
    return p;
  });
  const registerRoute = holdReason
    ? active?.by_reason.find((r) => r.hold_reason === holdReason)?.register_route
    : active?.register_route;

  return (
    <>
      <PageHead eyebrow="Callback orchestration" title="Work Queues"
        description="Open Singapore callback cases that need contact or attention today. Counts use the same definitions as the Overview cards."
        actions={<>
          <Button variant="primary" icon="mic" disabled aria-describedby="wq-launch">Launch browser session</Button>
          <span id="wq-launch"><StageChip label="Stage S1 — Browser voice" /></span>
        </>} />

      <div className="layout cols-4" style={{ marginBottom: 18 }}>
        {queues.isPending ? <div style={{ gridColumn: '1 / -1' }}><Loading label="Loading queues…" /></div> : null}
        {queues.isError ? <div style={{ gridColumn: '1 / -1' }}>
          <ErrorState message="Queue counts could not be loaded." correlationId={failure(queues.error).ref} onRetry={() => void queues.refetch()} /></div> : null}
        {queues.data?.items.map((q) => (
          <button type="button" key={q.code} className={`card kpi queue-card${q.code === queue ? ' accent' : ''}`}
            aria-pressed={q.code === queue} onClick={() => choose(q.code)} title={q.rule}>
            <div className="kpi-top"><span>{q.label}</span><div className="kpi-icon"><Icon name={ICONS[q.code] ?? 'files'} /></div></div>
            <div className="kpi-number" data-testid={`queue-${q.code}`}>{count(q.count)}</div>
            <div className="kpi-sub">{q.rule}</div>
          </button>
        ))}
      </div>

      <Card pad={false}>
        <div className="table-toolbar">
          <div className="pill-tabs" role="group" aria-label="Queues">
            {CODES.map((code) => (
              <button type="button" key={code} className={code === queue ? 'active' : ''} aria-pressed={code === queue} onClick={() => choose(code)}>
                {byCode.get(code)?.label ?? humanize(code)}{byCode.get(code) ? ` (${count(byCode.get(code)!.count)})` : ''}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {registerRoute ? <Link className="btn subtle" to={registerRoute}><Icon name="files" size="sm" /> Open in Call Explorer</Link> : null}
          <Badge tone="blue">Browser channel only (S1)</Badge>
          <Badge tone="gray">Genesys: future</Badge>
        </div>
        {queue === 'ON_HOLD' && active ? (
          <div className="table-toolbar" aria-label="Hold reasons">
            <span className="small muted">By hold reason:</span>
            <div className="pill-tabs" role="group" aria-label="Hold reason">
              <button type="button" className={!holdReason ? 'active' : ''} aria-pressed={!holdReason} onClick={() => choose('ON_HOLD')}>All ({count(active.count)})</button>
              {active.by_reason.map((r) => (
                <button type="button" key={r.hold_reason} className={holdReason === r.hold_reason ? 'active' : ''} aria-pressed={holdReason === r.hold_reason}
                  onClick={() => choose('ON_HOLD', r.hold_reason)}>{humanize(r.hold_reason)} ({count(r.count)}{r.blocking ? `, ${r.blocking} blocking` : ''})</button>
              ))}
            </div>
          </div>
        ) : null}
        {!can('case.read') ? <Forbidden /> : (
          <Region query={pages.result} label="queue cases">{() => pages.result.data!.markets.length === 0
            ? <Empty title="No market is assigned to your account">Queues show Singapore cases only; ask an administrator for Singapore access.</Empty>
            : <CaseTable rows={pages.result.data!.items} variant="queue" caption={`${active?.label ?? humanize(queue)} queue`}
              emptyTitle={`No cases in “${active?.label ?? humanize(queue)}”`} emptyHint={active?.rule} />}</Region>
        )}
        <div className="row between wrap" style={{ padding: '14px 18px', borderTop: '1px solid var(--line)' }}>
          <span className="small muted" data-testid="queue-total">
            {pages.result.data ? `${count(pages.result.data.total)} cases · page ${pages.pageNumber}` : ''}
            {queues.data ? ` · as of ${when(queues.data.data_as_of)} SGT` : ''}
          </span>
          <div className="row">
            <Button tiny disabled={!pages.hasPrevious} onClick={pages.previous}>Previous</Button>
            <Button tiny disabled={!pages.hasNext} onClick={pages.next}>Next</Button>
          </div>
        </div>
      </Card>
    </>
  );
}
