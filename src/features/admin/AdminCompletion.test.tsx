// CP0.1B-3 — Administration completion: create user with a one-time password shown once, password reset, groups with
// If-Match mapping changes, sessions (own session not revocable), system health, forced first-sign-in password change.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const ADMIN = { ...ME, permissions: [...ME.permissions, 'admin.groups.manage', 'admin.sessions.manage', 'system.health.read', 'config.read'] };
const user = (id: string, name: string, username: string) => ({
  principal_id: id, username, display_name: name, status: 'ACTIVE', groups: ['LOCAL_USER_SG'], roles: ['USER'], created_at: '2026-11-15T00:00:00Z',
  disabled_at: null, last_login_at: null, active_sessions: 0, row_version: 1,
});
const USERS = { items: [user(ME.principal.principal_id, 'Ada Admin', 'ada.admin'), user('u2', 'Ben User', 'ben.user')], page: { next_cursor: null, limit: 50, sort: 'created_at:asc' } };
const GROUP = (code: string, roles: string[]) => ({
  group_id: `g-${code}`, code, name: code === 'LOCAL_ADMIN' ? 'Administrators' : 'Singapore users', status: 'ACTIVE', provider: 'LOCAL',
  member_count: 1, roles, markets: ['SG'], mappings_version: 'abc123',
  members: [{ principal_id: code === 'LOCAL_ADMIN' ? ME.principal.principal_id : 'u2', username: 'x', display_name: code === 'LOCAL_ADMIN' ? 'Ada Admin' : 'Ben User',
    status: 'ACTIVE', valid_from: '2026-11-15T00:00:00Z', valid_to: null, provenance: 'LOCAL_ADMIN_ACTION', created_by: 'SYSTEM' }],
  former_members: [], role_history: [{ role: roles[0], effective_from: '2026-11-15T00:00:00Z', effective_to: null, approved_by: 'SYSTEM' }],
  scope_history: [{ market: 'SG', effective_from: '2026-11-15T00:00:00Z', effective_to: null, created_by: 'SYSTEM', change_reason: 'D-39' }],
});
const GROUPS = { items: [GROUP('LOCAL_ADMIN', ['ADMIN']), GROUP('LOCAL_USER_SG', ['USER'])], enabled_markets: ['SG'] };
const ROLES = { items: [{ code: 'ADMIN', name: 'Administrator', permissions: [] }, { code: 'USER', name: 'Operations user', permissions: [] }],
  reserved_permissions: [{ code: 'review.decide', alias: null, reserved: true, description: 'Reserved (S3)' }] };

describe('Administration completion', () => {
  it('creates a user and shows the one-time password once', async () => {
    const posts: Request[] = [];
    stubApi({ 'GET /api/v1/me': () => json(200, ADMIN), 'GET /api/v1/admin/users': () => json(200, USERS), 'GET /api/v1/admin/groups': () => json(200, GROUPS),
      'POST /api/v1/admin/users': (r) => { posts.push(r); return json(201, { user: user('u3', 'Cara New', 'cara.new'), one_time_password: 'Otp-Example-Value-123', replayed: false, note: 'Shown once' }); } });
    renderAt(<App />, '/admin/users');
    await userEvent.click(await screen.findByRole('button', { name: 'New user' }));
    const dialog = screen.getByRole('dialog', { name: 'Create a local user' });
    await userEvent.type(within(dialog).getByLabelText('Username'), 'cara.new');
    await userEvent.type(within(dialog).getByLabelText('Display name'), 'Cara New');
    await userEvent.type(within(dialog).getByLabelText('Reason (required)'), 'Joining the pilot');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await screen.findByTestId('one-time-password')).toHaveTextContent('Otp-Example-Value-123');
    expect(posts[0]!.headers.get('Idempotency-Key')).toMatch(/^user-/);
    await userEvent.click(screen.getByRole('button', { name: 'Done — hide password' }));
    expect(screen.queryByTestId('one-time-password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset password for Ben User' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Reset password for Ada Admin' })).toBeNull(); // own account: Change password instead
  });

  it('changes mappings with If-Match and shows reserved permissions as not grantable', async () => {
    const puts: Request[] = [];
    stubApi({ 'GET /api/v1/me': () => json(200, ADMIN), 'GET /api/v1/admin/groups': () => json(200, GROUPS), 'GET /api/v1/admin/roles': () => json(200, ROLES),
      'PUT /api/v1/admin/groups/g-LOCAL_USER_SG/mappings': (r) => { puts.push(r); return json(200, GROUPS.items[1]); } });
    renderAt(<App />, '/admin/groups');
    expect(await screen.findByTestId('reserved-permissions')).toHaveTextContent('review.decide');
    const admins = screen.getByTestId('group-LOCAL_ADMIN');
    expect(within(admins).getByRole('button', { name: 'Remove Ada Admin from Administrators' })).toBeDisabled(); // own admin access
    await userEvent.click(screen.getByRole('button', { name: 'Edit role and market mappings of Singapore users' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('SG'));
    await userEvent.type(within(dialog).getByLabelText('Reason (required)'), 'Pause access');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save mappings' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.headers.get('If-Match')).toBe('abc123');
    expect(await puts[0]!.json()).toEqual({ roles: ['USER'], markets: [], reason: 'Pause access' });
  });

  it('lists sessions without revoking your own, and shows system health', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ADMIN), 'GET /api/v1/admin/sessions': () => json(200, { items: [
      { session_id: 's1', principal_id: ME.principal.principal_id, username: 'ada.admin', display_name: 'Ada Admin', created_at: '2026-11-15T00:00:00Z', last_seen_at: '2026-11-15T00:00:00Z', idle_expires_at: '2026-11-15T00:30:00Z', absolute_expires_at: '2026-11-15T08:00:00Z', ip: '127.0.0.1', current: true },
      { session_id: 's2', principal_id: 'u2', username: 'ben.user', display_name: 'Ben User', created_at: '2026-11-15T00:00:00Z', last_seen_at: '2026-11-15T00:00:00Z', idle_expires_at: '2026-11-15T00:30:00Z', absolute_expires_at: '2026-11-15T08:00:00Z', ip: '127.0.0.1', current: false }] }),
      'GET /api/v1/admin/system-health': () => json(200, { checked_at: '2026-11-15T00:00:00Z', app_env: 'local', data_policy: 'SYNTHETIC_ONLY', current_stage: 'S0',
        migration_head: '0010_password_change_required', expected_migration_head: '0010_password_change_required', enabled_markets: ['SG'], openapi_sha256: 'f'.repeat(64),
        audit_chain_head: 'e'.repeat(64), audit_events: 10, counts: { users_active: 2, active_sessions: 2 },
        checks: [{ code: 'AUDIT_CHAIN', label: 'Audit hash chain', status: 'OK', detail: '10 events verified' }, { code: 'VOICE', label: 'Browser voice', status: 'NOT_AVAILABLE', detail: 'Introduced in Stage S1' }] }) });
    const { unmount } = renderAt(<App />, '/admin/sessions');
    expect(await screen.findByRole('button', { name: 'Revoke session of Ada Admin' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revoke session of Ben User' })).toBeEnabled();
    unmount();
    renderAt(<App />, '/admin/system');
    expect(await screen.findByTestId('health-checks')).toHaveTextContent('10 events verified');
    expect(screen.getByTestId('health-checks')).toHaveTextContent('Not available');
    expect(screen.getByTestId('count-users_active')).toHaveTextContent('2');
  });

  it('sends a user with a one-time password to Change password and nowhere else', async () => {
    const posts: Request[] = [];
    let required = true;
    stubApi({ 'GET /api/v1/me': () => json(200, { ...ME, roles: ['USER'], permissions: ['dashboard.read'], password_change_required: required }),
      'POST /api/v1/me/password': (r) => { posts.push(r); required = false; return new Response(null, { status: 204 }); },
      'GET /api/v1/dashboard/kpis': () => json(200, { items: [], markets: ['SG'] }) });
    renderAt(<App />, '/calls');
    expect(await screen.findByTestId('password-required')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('One-time password'), 'Otp-Example-Value-123');
    await userEvent.type(screen.getByLabelText('New password'), 'Portal-Ferry-Lantern-42');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'Portal-Ferry-Lantern-41');
    expect(screen.getByText('The two new passwords differ')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Confirm new password'));
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'Portal-Ferry-Lantern-42');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(await posts[0]!.json()).toEqual({ current_password: 'Otp-Example-Value-123', new_password: 'Portal-Ferry-Lantern-42' });
  });
});
