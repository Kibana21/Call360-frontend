// FE-01 (CP0.1B-1) — Configuration screen states and permitted actions.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const ADMIN = { ...ME, permissions: [...ME.permissions, 'config.read', 'config.manage'] };
const version = (n: number, status: string, labels: [string, string][]) => ({
  version: n, status, effective_from: '2026-11-15T00:00:00Z', activated_at: '2026-11-15T00:00:00Z',
  superseded_at: status === 'SUPERSEDED' ? '2026-11-15T01:00:00Z' : null, change_reason: `reason ${n}`,
  created_by: 'SYSTEM:migration-0002', created_by_name: null,
  values: labels.map(([code, label], i) => ({ code, label, attributes: { synthetic: true }, sort_order: i })),
});
const LISTS = { items: [
  { code: 'market', name: 'Market', description: 'Synthetic markets', governed: false, active_version: 2,
    versions: [version(2, 'ACTIVE', [['SG', 'Singapore'], ['MY', 'Malaysia']]), version(1, 'SUPERSEDED', [['SG', 'SG old'], ['MY', 'MY old']])] },
  { code: 'sbq_risk_band', name: 'SBQ risk band', description: 'Governed', governed: true, active_version: null, versions: [] },
] };
const FLAGS = { current_stage: 'S0', items: [
  { code: 'voice.browser_sessions', description: 'Browser voice sessions', enabled: false, stage_gate: 'S1', locked: true,
    row_version: 1, updated_at: '2026-11-15T00:00:00Z', updated_by: 'SYSTEM', history: [] },
] };

describe('Configuration screen', () => {
  it('shows lists with governance, history and locked flags', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ADMIN), 'GET /api/v1/admin/code-lists': () => json(200, LISTS),
      'GET /api/v1/admin/feature-flags': () => json(200, FLAGS) });
    renderAt(<App />, '/admin/config');
    expect(await screen.findByText('Governed · read-only')).toBeInTheDocument();
    expect(screen.getByText('Labels editable')).toBeInTheDocument();
    expect(screen.getByText('Not yet seeded')).toBeInTheDocument();
    const enable = screen.getByRole('button', { name: 'Enable Browser voice sessions' });
    expect(enable).toBeDisabled();
    expect(enable).toHaveAccessibleDescription('Locked until Stage S1');
    await userEvent.click(screen.getByRole('button', { name: 'View Market' }));
    const drawer = screen.getByRole('dialog', { name: 'Market' });
    expect(within(drawer).getByLabelText('Version 1')).toHaveTextContent('SG old');
    expect(within(drawer).getByLabelText('Version 2')).toHaveTextContent('ACTIVE');
  });

  it('governed lists offer no edit action', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ADMIN), 'GET /api/v1/admin/code-lists': () => json(200, LISTS),
      'GET /api/v1/admin/feature-flags': () => json(200, FLAGS) });
    renderAt(<App />, '/admin/config');
    await userEvent.click(await screen.findByRole('button', { name: 'View SBQ risk band' }));
    const drawer = screen.getByRole('dialog', { name: 'SBQ risk band' });
    expect(within(drawer).getByRole('note')).toHaveTextContent(/read-only/);
    expect(within(drawer).queryByRole('button', { name: 'New version' })).toBeNull();
  });

  it('creates a market label version with the based-on version, fixed codes and a reason', async () => {
    const post = vi.fn((req: Request) => { void req; return json(201, LISTS.items[0]); });
    stubApi({ 'GET /api/v1/me': () => json(200, ADMIN), 'GET /api/v1/admin/code-lists': () => json(200, LISTS),
      'GET /api/v1/admin/feature-flags': () => json(200, FLAGS), 'POST /api/v1/admin/code-lists/market/versions': post });
    renderAt(<App />, '/admin/config');
    await userEvent.click(await screen.findByRole('button', { name: 'View Market' }));
    await userEvent.click(screen.getByRole('button', { name: 'New version' }));
    const submit = screen.getByRole('button', { name: 'Activate new version' });
    expect(submit).toBeDisabled();
    const sg = screen.getByLabelText(/Label for SG/);
    await userEvent.clear(sg);
    await userEvent.type(sg, 'Singapore (renamed)');
    await userEvent.type(screen.getByLabelText('Reason (required)'), 'Clearer label');
    await userEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = await post.mock.calls[0]![0].json();
    expect(body.based_on_version).toBe(2);
    expect(body.reason).toBe('Clearer label');
    expect(body.values.map((v: { code: string }) => v.code)).toEqual(['SG', 'MY']);
    expect(body.values[0].label).toBe('Singapore (renamed)');
  });

  it('loading, empty, error and forbidden states', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ADMIN),
      'GET /api/v1/admin/code-lists': () => json(500, { code: 'INTERNAL_ERROR', message: 'x', correlation_id: 'corr-9', retryable: true }),
      'GET /api/v1/admin/feature-flags': () => json(200, { current_stage: 'S0', items: [] }) });
    const first = renderAt(<App />, '/admin/config');
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(await screen.findByText('Code lists could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText(/corr-9/)).toBeInTheDocument();
    expect(await screen.findByText('No feature flags are registered')).toBeInTheDocument();
    first.unmount();
    vi.unstubAllGlobals();
    stubApi({ 'GET /api/v1/me': () => json(200, ADMIN), 'GET /api/v1/admin/code-lists': () => json(403, { code: 'FORBIDDEN', message: 'no' }),
      'GET /api/v1/admin/feature-flags': () => json(403, { code: 'FORBIDDEN', message: 'no' }) });
    renderAt(<App />, '/admin/config');
    await waitFor(() => expect(screen.getAllByText('You do not have permission to view this.')).toHaveLength(2));
  });

  it('USER without config.read is sent to Unauthorized', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, { ...ME, roles: ['USER'], permissions: ['case.read'] }) });
    renderAt(<App />, '/admin/config');
    expect(await screen.findByRole('heading', { name: 'Administrator access required' })).toBeInTheDocument();
  });
});
