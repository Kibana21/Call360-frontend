// Administration → Groups (CP0.1B-3; API-014…018): local groups with members, role and market-scope mappings and
// their history. Membership and mapping changes need a reason, are audited with before/after, keep history (rows
// are ended, not deleted) and take effect on the member's next request. Reserved later-stage permissions are shown
// as not grantable; only enabled markets can be mapped. The server refuses changes that would remove the last
// administrator or the caller's own administrator access.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useAuth } from '../../auth/AuthContext';
import { Empty } from '../../components/StateView';
import { Badge, Button, Card } from '../../components/ui';
import { Region } from '../cases/shared';
import { adminWhen, ReasonDialog } from './shared';

type Group = components['schemas']['AdminGroup'];
type Member = components['schemas']['GroupMember'];

export function GroupsPage() {
  const groups = useQuery({ queryKey: ['admin', 'groups'], queryFn: async () => unwrap(await api.GET('/api/v1/admin/groups')) });
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: async () => unwrap(await api.GET('/api/v1/admin/roles')) });
  return (
    <div className="stack" style={{ gap: 19 }}>
      <Region query={groups} label="groups">
        {() => groups.data!.items.length === 0 ? <Card><Empty title="No groups are defined" /></Card> : (
          <>{groups.data!.items.map((g) => <GroupCard key={g.group_id} g={g} enabledMarkets={groups.data!.enabled_markets} roleCodes={(roles.data?.items ?? []).map((r) => r.code)} />)}</>
        )}
      </Region>
      <Card title="Roles and permissions" subtitle="Permissions are granted only through roles; reserved permissions belong to later stages and cannot be granted">
        <Region query={roles} label="roles">
          {() => (
            <div className="layout cols-even">
              {roles.data!.items.map((r) => (
                <div key={r.code} className="softbox" data-testid={`role-${r.code}`}>
                  <div className="row between"><strong className="small">{r.name}</strong><Badge tone={r.code === 'ADMIN' ? 'purple' : 'gray'}>{r.code}</Badge></div>
                  <div className="row wrap" style={{ gap: 4, marginTop: 10 }}>{r.permissions.map((p) => <span key={p.code} className="tag mono" title={p.description}>{p.code}</span>)}</div>
                </div>
              ))}
              <div className="softbox" data-testid="reserved-permissions">
                <strong className="small">Reserved — not grantable in Stage 0</strong>
                <ul className="plain-list" style={{ marginTop: 8 }}>
                  {roles.data!.reserved_permissions.map((p) => <li key={p.code} className="xsmall"><span className="mono">{p.code}</span> <span className="muted">{p.description}</span></li>)}
                </ul>
              </div>
            </div>
          )}
        </Region>
      </Card>
    </div>
  );
}

function GroupCard({ g, enabledMarkets, roleCodes }: { g: Group; enabledMarkets: string[]; roleCodes: string[] }) {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const manage = can('admin.groups.manage');
  const [removing, setRemoving] = useState<Member | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
  return (
    <Card title={g.name} subtitle={`${g.code} · ${g.provider} group · ${g.member_count} member${g.member_count === 1 ? '' : 's'}`}
      aside={<div className="row wrap">{g.roles.map((r) => <Badge key={r} tone={r === 'ADMIN' ? 'purple' : 'gray'}>{r}</Badge>)}
        {g.markets.length ? g.markets.map((m) => <Badge key={m} tone="blue">{m}</Badge>) : <Badge tone="amber">No market</Badge>}</div>}>
      <section aria-label={`${g.name} members`} data-testid={`group-${g.code}`}>
        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">Members of {g.name}</caption>
            <thead><tr><th scope="col">Member</th><th scope="col">Status</th><th scope="col">Member since</th><th scope="col">Added by</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {g.members.length === 0 ? <tr><td colSpan={5} className="muted">No current members</td></tr> : g.members.map((m) => (
                <tr key={m.principal_id}>
                  <td><div className="strong">{m.display_name}</div><div className="xsmall muted mono">{m.username}</div></td>
                  <td>{m.status === 'ACTIVE' ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Disabled</Badge>}</td>
                  <td>{adminWhen(m.valid_from)}</td>
                  <td className="xsmall">{m.provenance === 'LOCAL_ADMIN_ACTION' ? 'Administrator' : m.provenance}</td>
                  <td style={{ textAlign: 'right' }}>{manage ? (
                    <Button tiny variant="danger" onClick={() => setRemoving(m)} aria-label={`Remove ${m.display_name} from ${g.name}`}
                      disabled={m.principal_id === me?.principal.principal_id && g.roles.includes('ADMIN')}
                      title={m.principal_id === me?.principal.principal_id && g.roles.includes('ADMIN') ? 'You cannot remove your own administrator access' : undefined}>Remove</Button>
                  ) : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {manage ? (
          <div className="row wrap" style={{ marginTop: 12 }}>
            <Button tiny icon="plus" onClick={() => setAdding(true)} aria-label={`Add member to ${g.name}`}>Add member</Button>
            <Button tiny icon="edit" onClick={() => setEditing(true)} aria-label={`Edit role and market mappings of ${g.name}`}>Edit role and market mappings</Button>
          </div>
        ) : null}
        <details style={{ marginTop: 12 }}>
          <summary className="small strong" style={{ cursor: 'pointer' }}>History: memberships and mappings</summary>
          <div className="layout cols-even" style={{ marginTop: 10 }}>
            <div>
              <div className="section-label">Role mappings</div>
              <ul className="plain-list xsmall">{g.role_history.map((r, i) => <li key={i}><span className="mono strong">{r.role}</span> · from {adminWhen(r.effective_from)}{r.effective_to ? ` to ${adminWhen(r.effective_to)}` : ' (current)'} · by {r.approved_by}</li>)}</ul>
              <div className="section-label" style={{ marginTop: 10 }}>Market mappings</div>
              <ul className="plain-list xsmall">{g.scope_history.map((s, i) => <li key={i}><span className="mono strong">{s.market}</span> · from {adminWhen(s.effective_from)}{s.effective_to ? ` to ${adminWhen(s.effective_to)}` : ' (current)'} · {s.change_reason}</li>)}</ul>
            </div>
            <div>
              <div className="section-label">Former members</div>
              {g.former_members.length ? <ul className="plain-list xsmall">{g.former_members.map((m, i) => <li key={i}>{m.display_name} <span className="mono">{m.username}</span> · {adminWhen(m.valid_from)} to {adminWhen(m.valid_to)}</li>)}</ul>
                : <p className="xsmall muted" style={{ margin: 0 }}>None</p>}
            </div>
          </div>
        </details>
      </section>
      {removing ? (
        <ReasonDialog eyebrow="Remove member" title={`${removing.display_name} from ${g.name}`} confirm="Remove member" danger
          description="Ends the membership (history is kept). The member loses this group's roles and markets on their next request."
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            unwrap(await api.DELETE('/api/v1/admin/groups/{group_id}/members/{principal_id}', { params: { path: { group_id: g.group_id, principal_id: removing.principal_id } }, body: { reason } }));
            await refresh(); setRemoving(null);
          }} />
      ) : null}
      {adding ? <AddMemberDialog g={g} onClose={() => setAdding(false)} onDone={async () => { await refresh(); setAdding(false); }} /> : null}
      {editing ? <MappingsDialog g={g} enabledMarkets={enabledMarkets} roleCodes={roleCodes} onClose={() => setEditing(false)} onDone={async () => { await refresh(); setEditing(false); }} /> : null}
    </Card>
  );
}

function AddMemberDialog({ g, onClose, onDone }: { g: Group; onClose: () => void; onDone: () => Promise<void> }) {
  const users = useQuery({ queryKey: ['admin', 'users', 'all'], queryFn: async () => unwrap(await api.GET('/api/v1/admin/users', { params: { query: { limit: 200 } } })) });
  const current = new Set(g.members.map((m) => m.principal_id));
  const candidates = (users.data?.items ?? []).filter((u) => !current.has(u.principal_id) && u.status === 'ACTIVE');
  const [pid, setPid] = useState('');
  return (
    <ReasonDialog eyebrow="Add member" title={`Add to ${g.name}`} confirm="Add member" canConfirm={!!pid}
      description={`The user gains ${g.roles.join(', ') || 'no role'} and ${g.markets.join(', ') || 'no market'} on their next request.`}
      onClose={onClose}
      onConfirm={async (reason) => {
        unwrap(await api.PUT('/api/v1/admin/groups/{group_id}/members/{principal_id}', { params: { path: { group_id: g.group_id, principal_id: pid } }, body: { reason } }));
        await onDone();
      }}>
      <label className="form-label" htmlFor="am-user">User</label>
      <select id="am-user" className="field labelled" value={pid} onChange={(e) => setPid(e.target.value)} style={{ marginBottom: 12 }}>
        <option value="">{users.isPending ? 'Loading users…' : candidates.length ? 'Choose a user' : 'No other active users'}</option>
        {candidates.map((u) => <option key={u.principal_id} value={u.principal_id}>{u.display_name} ({u.username})</option>)}
      </select>
    </ReasonDialog>
  );
}

function MappingsDialog({ g, enabledMarkets, roleCodes, onClose, onDone }: {
  g: Group; enabledMarkets: string[]; roleCodes: string[]; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [roles, setRoles] = useState<string[]>(g.roles);
  const [markets, setMarkets] = useState<string[]>(g.markets);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <ReasonDialog eyebrow="Role and market mappings" title={g.name} confirm="Save mappings"
      description="Replaces the group's mappings as new effective-dated rows; the previous rows are kept as history. Members are affected on their next request."
      onClose={onClose}
      onConfirm={async (reason) => {
        unwrap(await api.PUT('/api/v1/admin/groups/{group_id}/mappings', {
          params: { path: { group_id: g.group_id }, header: { 'If-Match': g.mappings_version } },
          body: { roles: roles.sort(), markets: markets.sort(), reason },
        }));
        await onDone();
      }}>
      <fieldset className="intake-roles" style={{ marginBottom: 12 }}>
        <legend className="form-label">Roles</legend>
        <div className="row wrap">{roleCodes.map((r) => (
          <label key={r} className="checkline"><input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(roles, setRoles, r)} />{r}</label>
        ))}</div>
      </fieldset>
      <fieldset className="intake-roles" style={{ marginBottom: 12 }}>
        <legend className="form-label">Markets (enabled in Stage 0: {enabledMarkets.join(', ')})</legend>
        <div className="row wrap">{enabledMarkets.map((m) => (
          <label key={m} className="checkline"><input type="checkbox" checked={markets.includes(m)} onChange={() => toggle(markets, setMarkets, m)} />{m}</label>
        ))}</div>
      </fieldset>
    </ReasonDialog>
  );
}
