import createClient from 'openapi-fetch';
import type { components, paths } from './generated/schema';
import { apiFetch } from './session';

// Same-origin absolute base URL (the Vite proxy / reverse proxy serves the API on the SPA origin).
export const api = createClient<paths>({ baseUrl: typeof window === 'undefined' ? '' : window.location.origin, fetch: apiFetch });

export type Me = components['schemas']['MeResponse'];
export type AdminUser = components['schemas']['AdminUser'];
export type AuditEvent = components['schemas']['AuditEventOut'];
export type ApiError = components['schemas']['ErrorResponse'];

export class ApiFailure extends Error {
  constructor(public readonly status: number, public readonly body: Partial<ApiError> | undefined) {
    super(body?.message ?? `Request failed (${status})`);
  }
  get code(): string | undefined {
    return this.body?.code;
  }
}

/** Unwraps an openapi-fetch result, throwing ApiFailure with the server's error envelope. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined && result.response.ok) return result.data;
  throw new ApiFailure(result.response.status, result.error as Partial<ApiError> | undefined);
}
