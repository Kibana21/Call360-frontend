// Administration → Sessions (CP0.1B-3; API-019/020): active sessions without token material; revoking one needs a
// reason, is audited and signs that browser out on its next request. Your own session ends through Sign out.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, expectOk, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { Empty } from '../../components/StateView';
import { Badge, Button, Card } from '../../components/ui';
import { Region } from '../cases/shared';
import { adminWhen, ReasonDialog } from './shared';

type SessionRow = components['schemas']['AdminSessionOut'];

export function SessionsPage() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['admin', 'sessions'], queryFn: async () => unwrap(await api.GET('/api/v1/admin/sessions')) });
  const [target, setTarget] = useState<SessionRow | null>(null);
  return (
    <Card title="Active sessions" subtitle="Signed-in browsers, newest activity first. No token material is ever shown." pad={false}
      aside={<Button tiny icon="refresh" onClick={() => void sessions.refetch()}>Refresh</Button>}>
      <Region query={sessions} label="sessions">
        {() => sessions.data!.items.length === 0 ? <Empty title="No active sessions" /> : (
          <div className="table-wrap">
            <table className="data-table" data-testid="sessions">
              <caption className="sr-only">Active sessions</caption>
              <thead><tr><th scope="col">User</th><th scope="col">Signed in</th><th scope="col">Last activity</th><th scope="col">Idle expiry</th>
                <th scope="col">Absolute expiry</th><th scope="col">Address</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {sessions.data!.items.map((s) => (
                  <tr key={s.session_id}>
                    <td><div className="strong">{s.display_name} {s.current ? <Badge tone="blue">This session</Badge> : null}</div><div className="xsmall muted mono">{s.username}</div></td>
                    <td>{adminWhen(s.created_at)}</td><td>{adminWhen(s.last_seen_at)}</td>
                    <td>{adminWhen(s.idle_expires_at)}</td><td>{adminWhen(s.absolute_expires_at)}</td>
                    <td className="mono xsmall">{s.ip ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Button tiny variant="danger" disabled={s.current} title={s.current ? 'Use Sign out to end your own session' : undefined}
                        onClick={() => setTarget(s)} aria-label={`Revoke session of ${s.display_name}`}>Revoke</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Region>
      {target ? (
        <ReasonDialog eyebrow="Revoke session" title={target.display_name} confirm="Revoke session" danger
          description="Signs this browser out on its next request and ends its refresh tokens. The reason is recorded in the audit trail."
          onClose={() => setTarget(null)}
          onConfirm={async (reason) => {
            expectOk(await api.POST('/api/v1/admin/sessions/{session_id}/revoke', { params: { path: { session_id: target.session_id } }, body: { reason } }));
            await qc.invalidateQueries({ queryKey: ['admin'] });
            setTarget(null);
          }} />
      ) : null}
    </Card>
  );
}
