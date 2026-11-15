// FE-02 — CSRF header, single-flight/cross-tab refresh coordination, never touches browser storage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, onSessionExpired, readCookie, refreshSession, safeReturnPath } from './session';

type Handler = (req: Request) => Response | Promise<Response>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mockFetch(handler: Handler) {
  const calls: Request[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(String(input), 'http://localhost'), init);
    calls.push(req);
    return handler(req);
  }));
  return calls;
}

beforeEach(() => {
  document.cookie = 'c360_csrf=tok123; path=/';
  vi.stubGlobal('navigator', { ...navigator, locks: { request: (_n: string, cb: () => unknown) => Promise.resolve(cb()) } });
});
afterEach(() => { vi.unstubAllGlobals(); onSessionExpired(null); });

describe('safeReturnPath', () => {
  it.each([
    ['/admin/users', '/admin/users'], ['/admin/users?x=1', '/admin/users?x=1'], ['https://evil.example', '/'],
    ['//evil.example/x', '/'], ['/\\evil', '/'], [null, '/'], ['/login', '/'], ['/session-expired?x', '/'],
  ])('%s -> %s', (input, expected) => expect(safeReturnPath(input)).toBe(expected));
});

describe('readCookie', () => {
  it('reads a cookie by name', () => expect(readCookie('b', 'a=1; b=two%20words; c=3')).toBe('two words'));
});

describe('apiFetch', () => {
  it('adds the CSRF header only to state-changing requests', async () => {
    const calls = mockFetch(() => json(200, {}));
    await apiFetch(new Request('http://localhost/api/v1/admin/users'));
    await apiFetch(new Request('http://localhost/api/v1/admin/users/1', { method: 'PATCH', body: '{}' }));
    expect(calls[0]!.headers.get('X-CSRF-Token')).toBeNull();
    expect(calls[1]!.headers.get('X-CSRF-Token')).toBe('tok123');
  });

  it('refreshes once on an expired access token and retries the original request', async () => {
    let meCalls = 0;
    const calls = mockFetch((req) => {
      const path = new URL(req.url).pathname;
      if (path === '/api/v1/me') return ++meCalls === 1 ? json(401, { code: 'AUTH_TOKEN_EXPIRED' }) : json(200, {});
      if (path === '/api/v1/auth/refresh') return json(200, {});
      return meCalls >= 1 ? json(200, { ok: true }) : json(401, { code: 'AUTH_TOKEN_EXPIRED' });
    });
    const res = await apiFetch(new Request('http://localhost/api/v1/admin/users'));
    expect(res.status).toBe(200);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/v1/admin/users', '/api/v1/me', '/api/v1/auth/refresh', '/api/v1/admin/users']);
  });

  it('does not call refresh when a sibling tab already refreshed (probe succeeds)', async () => {
    const calls = mockFetch((req) => {
      const path = new URL(req.url).pathname;
      if (path === '/api/v1/me') return json(200, {});
      return calls.filter((c) => new URL(c.url).pathname === path).length > 1 ? json(200, {}) : json(401, { code: 'AUTH_REQUIRED' });
    });
    expect((await apiFetch(new Request('http://localhost/api/v1/admin/audit-events'))).status).toBe(200);
    expect(calls.some((c) => c.url.endsWith('/auth/refresh'))).toBe(false);
  });

  it('treats 409 REFRESH_SUPERSEDED as success and retries with current cookies', async () => {
    let attempts = 0;
    mockFetch((req) => {
      const path = new URL(req.url).pathname;
      if (path === '/api/v1/me') return json(401, { code: 'AUTH_REQUIRED' });
      if (path === '/api/v1/auth/refresh') return json(409, { code: 'REFRESH_SUPERSEDED' });
      return ++attempts === 1 ? json(401, { code: 'AUTH_TOKEN_EXPIRED' }) : json(200, {});
    });
    expect((await apiFetch(new Request('http://localhost/api/v1/admin/users'))).status).toBe(200);
  });

  it('shares one refresh between concurrent callers in a tab', async () => {
    const calls = mockFetch(async (req) => {
      const path = new URL(req.url).pathname;
      if (path === '/api/v1/me') return json(401, { code: 'AUTH_REQUIRED' });
      await new Promise((r) => setTimeout(r, 5));
      return json(200, {});
    });
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);
    expect([a, b]).toEqual(['refreshed', 'refreshed']);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('signals session expiry when refresh fails and never writes browser storage', async () => {
    const expired = vi.fn();
    onSessionExpired(expired);
    mockFetch((req) => (new URL(req.url).pathname === '/api/v1/auth/refresh'
      ? json(401, { code: 'AUTH_REFRESH_INVALID' }) : json(401, { code: 'AUTH_TOKEN_EXPIRED' })));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const res = await apiFetch(new Request('http://localhost/api/v1/admin/users'));
    expect(res.status).toBe(401);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('does not attempt refresh for the login endpoint', async () => {
    const calls = mockFetch(() => json(401, { code: 'AUTH_INVALID_CREDENTIALS' }));
    await apiFetch(new Request('http://localhost/api/v1/auth/login', { method: 'POST', body: '{}' }));
    expect(calls).toHaveLength(1);
  });
});
