// Browser-side session coordination (S0_IDENTITY_ACCESS_DESIGN §4, D-23 refined at CP0.1A).
// Tokens live only in HttpOnly cookies the SPA never reads. This module only sends the CSRF header and
// coordinates refresh: one refresh at a time per browser (Web Locks), re-probing /me first so a tab whose
// sibling already refreshed simply retries with the shared cookies.

export const CSRF_COOKIE = 'c360_csrf';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOCK_NAME = 'c360-refresh';

export function readCookie(name: string, source: string = document.cookie): string | null {
  for (const part of source.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export type RefreshOutcome = 'refreshed' | 'expired';
type Listener = () => void;
let expiredListener: Listener | null = null;
let inFlight: Promise<RefreshOutcome> | null = null;

export function onSessionExpired(listener: Listener | null): void {
  expiredListener = listener;
}

function withCsrf(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();
  if (UNSAFE.has(method)) {
    const token = readCookie(CSRF_COOKIE);
    if (token) headers.set('X-CSRF-Token', token);
  }
  return { ...init, headers, credentials: 'same-origin' };
}

async function refreshUnderLock(): Promise<RefreshOutcome> {
  // A sibling tab may already have refreshed while we waited for the lock.
  const probe = await fetch('/api/v1/me', { credentials: 'same-origin' });
  if (probe.ok) return 'refreshed';
  const r = await fetch('/api/v1/auth/refresh', withCsrf({ method: 'POST' }));
  if (r.ok) return 'refreshed';
  if (r.status === 409) return 'refreshed'; // REFRESH_SUPERSEDED: current cookies are already valid
  return 'expired';
}

/** Single-flight within the tab, Web-Locks serialised across tabs of this browser. */
export function refreshSession(): Promise<RefreshOutcome> {
  if (inFlight) return inFlight;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const run = locks ? locks.request(LOCK_NAME, refreshUnderLock) : refreshUnderLock();
  inFlight = Promise.resolve(run)
    .catch((): RefreshOutcome => 'expired')
    .finally(() => { inFlight = null; });
  return inFlight;
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { code?: string };
    return body.code ?? null;
  } catch {
    return null;
  }
}

const NO_RETRY = ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/auth/csrf'];

/** Adds the CSRF header to state-changing requests; cookies travel automatically (same origin). */
function prepare(request: Request): Request {
  const headers = new Headers(request.headers);
  if (UNSAFE.has(request.method.toUpperCase())) {
    const token = readCookie(CSRF_COOKIE);
    if (token) headers.set('X-CSRF-Token', token);
  }
  return new Request(request, { headers, credentials: 'same-origin' });
}

/** fetch wrapper used by the generated client: adds CSRF, refreshes once on an expired access token. */
export async function apiFetch(input: Request): Promise<Response> {
  const path = new URL(input.url, window.location.origin).pathname;
  const retry = input.clone();
  const first = await fetch(prepare(input));
  if (first.status !== 401 || NO_RETRY.includes(path)) return first;
  const code = await errorCode(first);
  if (code !== 'AUTH_TOKEN_EXPIRED' && code !== 'AUTH_REQUIRED') {
    if (code === 'AUTH_SESSION_INVALID') expiredListener?.();
    return first;
  }
  if ((await refreshSession()) === 'expired') {
    expiredListener?.();
    return first;
  }
  const second = await fetch(prepare(retry));
  if (second.status === 401) expiredListener?.();
  return second;
}

/** Only same-origin relative paths are accepted as post-login destinations (TM-32). */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (/^\/(login|session-expired)(\/|\?|$)/.test(value)) return '/';
  return value;
}
