// Intake history (API-082 runs, API-083 run detail). Only accepted submissions create intake runs; rejected
// attempts are recorded in the audit trail (INTAKE.REJECTED), which ADMIN can search under Administration → Audit.
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Empty } from '../../components/StateView';
import { Badge, Button, Card } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import type { IntakeOutcome } from './model';
import { OutcomeLinks, OutcomeView } from './Outcome';

export function IntakeHistory({ runId, onOpen }: { runId: string | null; onOpen: (id: string | null) => void }) {
  const { can } = useAuth();
  const runs = useQuery({ queryKey: ['intake', 'runs'], queryFn: async () => unwrap(await api.GET('/api/v1/intake/import-runs', { params: { query: { limit: 100 } } })) });
  return (
    <>
      <Card title="Intake runs" pad={false}
        subtitle="Accepted transactions, newest first. Rejected submissions are not runs: they are recorded in the audit trail."
        aside={can('audit.read') ? <Link className="btn tiny" to="/admin/audit">Audit trail</Link> : undefined}>
        <Region query={runs} label="intake runs">
          {() => runs.data!.items.length === 0 ? (
            <Empty title="No intake runs yet">Submitted transactions appear here with their results.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data-table" data-testid="intake-runs">
                <caption className="sr-only">Intake runs, {runs.data!.total} in total</caption>
                <thead><tr>
                  <th scope="col">Run</th><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Received</th>
                  <th scope="col">New</th><th scope="col">Rejected</th><th scope="col">Submitted by</th><th scope="col">Started</th>
                  <th scope="col"><span className="sr-only">Details</span></th>
                </tr></thead>
                <tbody>
                  {runs.data!.items.map((r) => (
                    <tr key={r.id}>
                      <td className="mono strong">{r.run_ref}</td>
                      <td>{humanize(r.source_type)}<div className="xsmall muted mono">{r.source_system}</div></td>
                      <td><Badge tone={r.status === 'ACCEPTED' ? 'green' : r.status === 'REJECTED' ? 'red' : 'gray'}>{humanize(r.status)}</Badge></td>
                      <td>{r.counts.received}</td><td>{r.counts.new}</td><td>{r.counts.rejected}</td>
                      <td>{r.requested_by}</td><td>{when(r.started_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="linkbtn" onClick={() => onOpen(r.id)} aria-label={`View ${r.run_ref}`}>View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Region>
      </Card>
      {runId ? <RunDrawer runId={runId} onClose={() => onOpen(null)} /> : null}
    </>
  );
}

function RunDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const run = useQuery({
    queryKey: ['intake', 'run', runId],
    queryFn: async () => unwrap(await api.GET('/api/v1/intake/import-runs/{run_id}', { params: { path: { run_id: runId } } })),
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const r = run.data;
  const outcome = r && r.result && 'case' in r.result ? (r.result as unknown as IntakeOutcome) : null;
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="run-title">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">Intake run</div>
            <h2 id="run-title" className="mono">{r?.run_ref ?? 'Loading…'}</h2>
          </div>
          <Button tiny icon="close" onClick={onClose} aria-label="Close run detail" autoFocus>Close</Button>
        </div>
        <div className="drawer-body">
          <Region query={run} label="the intake run">
            {() => (
              <div className="stack" style={{ gap: 16 }}>
                <dl className="intake-facts">
                  <div><dt>Status</dt><dd>{humanize(r!.status)}</dd></div>
                  <div><dt>Source</dt><dd>{humanize(r!.source_type)} · <span className="mono">{r!.source_system}</span></dd></div>
                  <div><dt>Submitted by</dt><dd>{r!.requested_by}</dd></div>
                  <div><dt>Started</dt><dd>{when(r!.started_at)}</dd></div>
                  <div><dt>Counts</dt><dd>{r!.counts.received} received · {r!.counts.new} new · {r!.counts.updated} updated · {r!.counts.rejected} rejected</dd></div>
                  <div><dt>Payload digest</dt><dd className="mono xsmall" style={{ wordBreak: 'break-all' }}>{r!.payload_digest}</dd></div>
                </dl>
                <div>
                  <div className="section-label">Transactions</div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <caption className="sr-only">Transactions in this run</caption>
                      <thead><tr><th scope="col">Source event</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Errors</th></tr></thead>
                      <tbody>
                        {r!.items.map((i) => (
                          <tr key={i.id}>
                            <td className="mono">{i.source_event_id}</td><td>{humanize(i.entity_type)}</td>
                            <td><Badge tone={i.status === 'ACCEPTED' ? 'green' : 'red'}>{humanize(i.status)}</Badge></td>
                            <td>{i.errors.length ? i.errors.map((e) => String((e as { code?: string }).code ?? '')).join(', ') : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {outcome ? (
                  <div>
                    <div className="section-label">Result</div>
                    <OutcomeView outcome={outcome} />
                    <div style={{ marginTop: 12 }}><OutcomeLinks outcome={outcome} /></div>
                  </div>
                ) : null}
              </div>
            )}
          </Region>
        </div>
      </aside>
    </div>
  );
}
