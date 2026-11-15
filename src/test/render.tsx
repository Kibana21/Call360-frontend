import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

export const ME = {
  principal: { principal_id: '11111111-1111-1111-1111-111111111111', display_name: 'Ada Admin', username: 'ada.admin' },
  roles: ['ADMIN'],
  permissions: ['admin.users.read', 'admin.users.manage', 'audit.read', 'dashboard.read'],
  markets: ['SG'],
  session: { session_id: 's', created_at: '2026-11-15T01:00:00Z', idle_expires_at: '2026-11-15T01:30:00Z',
    absolute_expires_at: '2026-11-15T09:00:00Z', access_expires_at: '2026-11-15T01:10:00Z' },
  environment: { app_env: 'local', data_policy: 'SYNTHETIC_ONLY' },
};

export function stubApi(routes: Record<string, (req: Request) => Response>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(String(input), 'http://localhost'), init);
    const key = `${req.method} ${new URL(req.url).pathname}`;
    const handler = routes[key];
    return handler ? handler(req) : new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 });
  }));
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function renderAt(ui: ReactElement, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>);
}
