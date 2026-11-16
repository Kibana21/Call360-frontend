// FE-01 / FE-04 (CP0.2 audit-table fix) — long audit values wrap without truncation; full details stay reachable.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

const REASON = 'CP0.2 version 1: synthetic development fixtures (D-36), not AIA-approved business rules';
const EVENT = {
  event_id: '00000000-0000-0000-0000-000000000001', seq: 7, occurred_at: '2026-11-15T09:15:28Z',
  action: 'CONFIG.CODE_LIST_VERSION_ACTIVATED', outcome: 'SUCCEEDED', actor_display_name: null,
  actor_principal_id: null, actor_service: 'migration:0007_governed_values', actor_username: null,
  entity_type: 'code_list', entity_id: 'synthetic_contact_ranges', entity_version: 1, reason: REASON,
  correlation_id: null, session_id: null, source_ip: null, before: null,
  after: { version: 1, reference_data_version: '0007_governed_values', values: [{ code: 'PHONE_SYNTHETIC_ID' }] },
};

describe('Audit screen', () => {
  it('wraps long values in place and keeps the complete event available', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, ME),
      'GET /api/v1/admin/audit-events': () => json(200, { items: [EVENT], page: { next_cursor: null } }) });
    renderAt(<App />, '/admin/audit');
    const table = await screen.findByRole('table', { name: 'Audit events, newest first' });
    expect(table).toHaveClass('audit-table');
    const row = within(table).getAllByRole('row')[1]!;
    const cells = within(row).getAllByRole('cell');
    // Text and accessible names are complete and unchanged; long cells may wrap (CSS only).
    expect(within(row).getByRole('cell', { name: 'CONFIG.CODE_LIST_VERSION_ACTIVATED' })).toHaveClass('wrap');
    expect(cells[3]!).toHaveTextContent('Service: migration:0007_governed_values');
    expect(cells[3]!).toHaveClass('wrap');
    expect(cells[5]!).toHaveTextContent(REASON);
    expect(cells[5]!).toHaveClass('wrap-text');
    await userEvent.click(within(row).getByRole('button', { name: 'View' }));
    const drawer = screen.getByRole('dialog', { name: 'CONFIG.CODE_LIST_VERSION_ACTIVATED' });
    expect(within(drawer).getByText(/"reference_data_version": "0007_governed_values"/)).toHaveClass('jsonbox');
    expect(within(drawer).getByText(REASON)).toBeInTheDocument();
  });

  it('marks an out-of-scope record identifier as withheld (CP0.6-F1)', async () => {
    const denied = { ...EVENT, event_id: '00000000-0000-0000-0000-000000000002', seq: 8, action: 'ACCESS.DENIED_OBJECT', outcome: 'DENIED',
      entity_type: 'callback_case', entity_id: null, reason: 'out of scope or missing', after: null, scope_redacted: true };
    stubApi({ 'GET /api/v1/me': () => json(200, ME),
      'GET /api/v1/admin/audit-events': () => json(200, { items: [denied], page: { next_cursor: null } }) });
    renderAt(<App />, '/admin/audit');
    const table = await screen.findByRole('table', { name: 'Audit events, newest first' });
    expect(within(table).getAllByRole('row')[1]!).toHaveTextContent('callback_case · withheld (outside your markets)');
    await userEvent.click(within(table).getByRole('button', { name: 'View' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('record outside your markets; identifier withheld');
  });
});
