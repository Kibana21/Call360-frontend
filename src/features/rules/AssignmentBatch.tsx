// S2-C manual trigger: preview (read-only) and apply deterministic assignment for eligible unassigned Singapore cases.
// Assigned and terminal cases are never touched; each case is applied in its own transaction with its own audit trail.
import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card } from '../../components/ui';
import { humanize } from '../cases/shared';
import { ErrorBox, errorText } from '../scripts/ScriptEditor';
import { OutcomeBadge } from './shared';

export function AssignmentBatch() {
  const { can } = useAuth();
  const key = useRef(`batch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const dry = useMutation({ mutationFn: async () => unwrap(await api.POST('/api/v1/script-assignments/run', { body: { dry_run: true, limit: 500 } })) });
  const apply = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/script-assignments/run', { params: { header: { 'Idempotency-Key': key.current } }, body: { dry_run: false, limit: 500 } })),
    onSuccess: () => { key.current = `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`; },
  });
  if (!can('script.assign')) return null;
  const r = apply.data ?? dry.data;
  return (
    <Card title="Assign scripts to unassigned cases" subtitle="Deterministic, using the published rules; preview first. Previously assigned cases are never reassigned.">
      <div className="stack" style={{ gap: 10 }} data-testid="assignment-batch">
        <div className="row wrap" style={{ gap: 8 }}>
          <Button icon="eye" onClick={() => dry.mutate()} disabled={dry.isPending || apply.isPending} data-testid="batch-preview">Preview unassigned cases</Button>
          <Button variant="primary" icon="check" onClick={() => apply.mutate()} disabled={!dry.data || apply.isPending || !!apply.data} data-testid="batch-apply">Apply to {dry.data?.cases ?? 0} case(s)</Button>
          <span className="xsmall muted">Successful cases get their script pinned and the “Awaiting script assignment” hold released; blocked cases keep their holds.</span>
        </div>
        <ErrorBox error={dry.error ? errorText(dry.error) : apply.error ? errorText(apply.error) : null} />
        {r ? (
          <>
            <div className="row wrap" style={{ gap: 6 }} data-testid="batch-summary">
              <Badge tone={r.dry_run ? 'gray' : 'green'}>{r.dry_run ? 'Preview' : 'Applied'}</Badge>
              {Object.entries(r.summary).map(([k, n]) => <span key={k} className="tag">{humanize(k)}: <strong>{n}</strong></span>)}
            </div>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Batch results"><table className="data-table" data-testid="batch-results">
              <thead><tr><th>Case</th><th>Outcome</th><th>Script</th><th>Holds</th><th>Reason</th></tr></thead>
              <tbody>{r.results.map((x) => (
                <tr key={x.case_id}><td><Link className="link" to={`/cases/${x.case_id}`}>{x.case_ref}</Link></td>
                  <td>{x.outcome ? <OutcomeBadge outcome={x.outcome} /> : humanize(x.status)}{!r.dry_run ? <div className="xsmall muted">{humanize(x.status)}</div> : null}</td>
                  <td>{x.script_label ?? '—'}</td>
                  <td className="xsmall">{x.would_release.length ? `release ${x.would_release.map(humanize).join(', ')}` : ''}{x.would_place.length ? ` place ${x.would_place.map(humanize).join(', ')}` : ''}</td>
                  <td className="xsmall" style={{ whiteSpace: 'normal', maxWidth: 420 }}>{x.reason}</td></tr>
              ))}</tbody>
            </table></div>
          </>
        ) : null}
      </div>
    </Card>
  );
}
