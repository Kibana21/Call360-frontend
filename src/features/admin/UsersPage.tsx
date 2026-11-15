import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiFailure, unwrap, type AdminUser } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { initials } from '../../app/AppShell';
import { Empty, ErrorState, Forbidden, Loading } from '../../components/StateView';
import { Badge, Button, Card } from '../../components/ui';

const when = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }).format(new Date(iso)) : '—';

export function UsersPage() {
  const { me, can } = useAuth();
  const query = useInfiniteQuery({
    queryKey: ['admin', 'users'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.GET('/api/v1/admin/users', { params: { query: { limit: 50, cursor: pageParam } } })),
    getNextPageParam: (last) => last.page.next_cursor ?? undefined,
  });
  const [target, setTarget] = useState<AdminUser | null>(null);

  if (query.isPending) return <Card title="Users"><Loading label="Loading users…" /></Card>;
  if (query.isError) {
    const e = query.error;
    if (e instanceof ApiFailure && e.status === 403) return <Card title="Users"><Forbidden /></Card>;
    return <Card title="Users"><ErrorState message="Users could not be loaded." correlationId={e instanceof ApiFailure ? e.body?.correlation_id : null} onRetry={() => void query.refetch()} /></Card>;
  }
  const users = query.data.pages.flatMap((p) => p.items);
  const canManage = can('admin.users.manage');

  return (
    <Card title="Users" subtitle="Local demo identities. New accounts are created with the operator CLI until user creation is added later in Stage 0." pad={false}>
      {users.length === 0 ? <Empty title="No users yet" /> : (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">Call360 users</caption>
            <thead><tr><th scope="col">User</th><th scope="col">Groups</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col">Active sessions</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u.principal_id === me?.principal.principal_id;
                return (
                  <tr key={u.principal_id}>
                    <td><div className="row"><div className="avatar" style={{ width: 29, height: 29 }} aria-hidden="true">{initials(u.display_name)}</div><div><div className="strong">{u.display_name}</div><div className="xsmall muted mono">{u.username}</div></div></div></td>
                    <td>{u.groups.map((g) => <span key={g} className="tag mono" style={{ marginRight: 4 }}>{g}</span>)}</td>
                    <td>{u.roles.map((r) => <Badge key={r} tone={r === 'ADMIN' ? 'purple' : 'gray'}>{r}</Badge>)}</td>
                    <td>{u.status === 'ACTIVE' ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Disabled</Badge>}</td>
                    <td>{when(u.last_login_at)}</td>
                    <td>{u.active_sessions}</td>
                    <td style={{ textAlign: 'right' }}>
                      {canManage ? (
                        u.status === 'ACTIVE' ? (
                          <Button tiny variant="danger" disabled={self} title={self ? 'You cannot disable your own account' : undefined}
                            onClick={() => setTarget(u)} aria-label={`Disable ${u.display_name}`}>Disable</Button>
                        ) : (
                          <Button tiny onClick={() => setTarget(u)} aria-label={`Enable ${u.display_name}`}>Enable</Button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage ? (
        <div style={{ padding: 15 }}><Button onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>Load more</Button></div>
      ) : null}
      {target ? <StatusDialog user={target} onClose={() => setTarget(null)} /> : null}
    </Card>
  );
}

function StatusDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const qc = useQueryClient();
  const disabling = user.status === 'ACTIVE';
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: async () => unwrap(await api.PATCH('/api/v1/admin/users/{principal_id}', {
      params: { path: { principal_id: user.principal_id }, header: { 'If-Match': String(user.row_version) } },
      body: { status: disabling ? 'DISABLED' : 'ACTIVE', reason },
    })),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiFailure && e.code === 'CONFLICT_ROW_VERSION') setError('This user changed since you loaded the list. Close and try again.');
      else setError(e instanceof ApiFailure ? e.message : 'The change could not be saved.');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="status-title">
        <form className="modal-content" onSubmit={submit}>
          <div className="modal-head">
            <div>
              <div className="eyebrow">{disabling ? 'Disable account' : 'Enable account'}</div>
              <h2 id="status-title">{user.display_name}</h2>
              <p className="small muted" style={{ margin: 0 }}>{disabling
                ? 'Disabling ends every active session for this user immediately. The change and your reason are recorded in the audit trail.'
                : 'The user will be able to sign in again. The change and your reason are recorded in the audit trail.'}</p>
            </div>
          </div>
          <label className="form-label" htmlFor="reason">Reason (required)</label>
          <textarea id="reason" ref={first} className="field labelled textarea" rows={3} minLength={3} maxLength={500}
            value={reason} onChange={(e) => setReason(e.target.value)} required />
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="row right" style={{ marginTop: 20 }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant={disabling ? 'danger' : 'primary'} disabled={reason.trim().length < 3 || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : disabling ? 'Disable user' : 'Enable user'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
