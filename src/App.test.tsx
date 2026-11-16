// FE-01 — screens and states: login, guards, shell navigation, admin loading/empty/error/forbidden.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { json, ME, renderAt, stubApi } from './test/render';

afterEach(() => vi.unstubAllGlobals());

const USER_ME = { ...ME, roles: ['USER'], permissions: ['case.read'], principal: { ...ME.principal, display_name: 'Uma User', username: 'uma' } };
const usersPage = (items: unknown[]) => json(200, { items, page: { next_cursor: null, limit: 50, sort: 'created_at:asc' }, total: null });
const user = (over: Record<string, unknown> = {}) => ({ principal_id: '22222222-2222-2222-2222-222222222222', username: 'bob', display_name: 'Bob Builder',
  status: 'ACTIVE', groups: ['LOCAL_USER_SG'], roles: ['USER'], created_at: '2026-11-15T00:00:00Z', disabled_at: null,
  last_login_at: null, active_sessions: 1, row_version: 3, ...over });

describe('authentication screens', () => {
  it('redirects anonymous users to login and shows a generic failure message', async () => {
    stubApi({
      'GET /api/v1/me': () => json(401, { code: 'AUTH_REQUIRED' }),
      'POST /api/v1/auth/refresh': () => json(401, { code: 'AUTH_REFRESH_INVALID' }),
      'GET /api/v1/auth/csrf': () => json(200, { csrf_token: 't' }),
      'POST /api/v1/auth/login': () => json(401, { code: 'AUTH_INVALID_CREDENTIALS', message: 'Sign-in failed' }),
    });
    renderAt(<App />, '/admin/users');
    expect(await screen.findByRole('heading', { name: 'Secure access' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue as/i })).toBeNull();
    await userEvent.type(screen.getByLabelText('Username'), 'someone');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password-1');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed. Check your username and password.');
  });

  it('shows throttling feedback on 429', async () => {
    stubApi({
      'GET /api/v1/me': () => json(401, { code: 'AUTH_REQUIRED' }),
      'POST /api/v1/auth/refresh': () => json(401, {}),
      'GET /api/v1/auth/csrf': () => json(200, { csrf_token: 't' }),
      'POST /api/v1/auth/login': () => json(429, { code: 'RATE_LIMITED' }),
    });
    renderAt(<App />, '/login');
    await userEvent.type(await screen.findByLabelText('Username'), 'someone');
    await userEvent.type(screen.getByLabelText('Password'), 'any-password-12');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many sign-in attempts/);
  });
});

describe('application shell', () => {
  it('renders the mockup navigation groups with stage-gated items and real session data', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ME) });
    renderAt(<App />, '/');
    expect(await screen.findByRole('heading', { name: 'Command Centre' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    for (const g of ['Workspace', 'Governance', 'Intelligence', 'Platform']) expect(within(nav).getByText(g)).toBeInTheDocument();
    const disabled = nav.querySelectorAll('[aria-disabled="true"]');
    expect(disabled.length).toBe(3); // Live Monitor, Campaigns (S4) + Analytics (S4); every Stage 0 screen is enabled after F7
    for (const label of ['Call Explorer', 'Work Queues', 'Search']) expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Script Studio' })).toHaveAttribute('href', '/scripts');
    expect(within(nav).getByText('Live Monitor').closest('[aria-disabled]')).toHaveAttribute('aria-disabled', 'true');
    expect(within(nav).getByRole('link', { name: /Administration/ })).toHaveAttribute('href', '/admin/users');
    expect(screen.getAllByText('Ada Admin').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Call 360|Survey Studio/);
  });

  it('sends a USER who opens Administration to the Unauthorized screen', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, USER_ME) });
    renderAt(<App />, '/admin/users');
    expect(await screen.findByRole('heading', { name: 'Administrator access required' })).toBeInTheDocument();
  });
});

describe('admin users states', () => {
  it('loading then table, with self-disable prevented', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ME),
      'GET /api/v1/admin/users': () => usersPage([user(), user({ principal_id: ME.principal.principal_id, username: 'ada.admin', display_name: 'Ada Admin', roles: ['ADMIN'] })]) });
    renderAt(<App />, '/admin/users');
    expect(await screen.findByText('Bob Builder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable Ada Admin' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disable Bob Builder' })).toBeEnabled();
  });

  it('empty state', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ME), 'GET /api/v1/admin/users': () => usersPage([]) });
    renderAt(<App />, '/admin/users');
    expect(await screen.findByText('No users yet')).toBeInTheDocument();
  });

  it('error state shows the correlation reference', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ME),
      'GET /api/v1/admin/users': () => json(500, { code: 'INTERNAL_ERROR', message: 'x', correlation_id: 'corr-123', retryable: true }) });
    renderAt(<App />, '/admin/users');
    expect(await screen.findByText('Users could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText(/corr-123/)).toBeInTheDocument();
  });

  it('forbidden state when the server denies the request', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ME),
      'GET /api/v1/admin/users': () => json(403, { code: 'FORBIDDEN', message: 'no' }) });
    renderAt(<App />, '/admin/users');
    expect(await screen.findByText('You do not have permission to view this.')).toBeInTheDocument();
  });

  it('disable requires a reason and sends If-Match with the row version', async () => {
    const patch = vi.fn((req: Request) => { void req; return json(200, user({ status: 'DISABLED', row_version: 4 })); });
    stubApi({ 'GET /api/v1/me': () => json(200, ME), 'GET /api/v1/admin/users': () => usersPage([user()]),
      'PATCH /api/v1/admin/users/22222222-2222-2222-2222-222222222222': patch });
    renderAt(<App />, '/admin/users');
    await userEvent.click(await screen.findByRole('button', { name: 'Disable Bob Builder' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Disable user' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Reason (required)'), 'Left the team');
    await userEvent.click(confirm);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const req = patch.mock.calls[0]![0];
    expect(req.headers.get('If-Match')).toBe('3');
    expect(await req.json()).toEqual({ status: 'DISABLED', reason: 'Left the team' });
  });
});
