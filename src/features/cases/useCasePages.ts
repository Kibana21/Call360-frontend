// Server-side keyset pagination over a cursor list API (API-035, API-050, API-056). Cursors are kept as a stack so
// "Previous" returns to the exact earlier page; any filter change resets to the first page.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap, type CaseQuery, type PolicyQuery, type RiskQuery } from '../../api/client';

interface CursorPage { page: { next_cursor?: string | null } }

export function useCursorPages<T extends CursorPage>(
  name: string, query: object, fetchPage: (cursor: string | undefined, limit: number) => Promise<T>,
  { limit = 25, enabled = true } = {},
) {
  const key = JSON.stringify(query);
  const [state, setState] = useState<{ key: string; stack: string[] }>({ key, stack: [] });
  const stack = state.key === key ? state.stack : [];
  const cursor = stack[stack.length - 1];
  const result = useQuery({
    queryKey: [name, key, limit, cursor ?? null],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => fetchPage(cursor, limit),
  });
  const next = result.data?.page.next_cursor ?? null;
  return {
    result,
    pageNumber: stack.length + 1,
    hasPrevious: stack.length > 0,
    hasNext: !!next && !result.isPlaceholderData,
    next: () => { if (next) setState({ key, stack: [...stack, next] }); },
    previous: () => setState({ key, stack: stack.slice(0, -1) }),
    limit,
  };
}

export function useCasePages(query: CaseQuery, opts: { limit?: number; enabled?: boolean } = {}) {
  return useCursorPages('cases', query, async (cursor, limit) =>
    unwrap(await api.GET('/api/v1/cases', { params: { query: { ...query, limit, ...(cursor ? { cursor } : {}) } } })), opts);
}

export function usePolicyPages(query: PolicyQuery, opts: { limit?: number; enabled?: boolean } = {}) {
  return useCursorPages('policies', query, async (cursor, limit) =>
    unwrap(await api.GET('/api/v1/policies', { params: { query: { ...query, limit, ...(cursor ? { cursor } : {}) } } })), opts);
}

export function useRiskPages(query: RiskQuery, opts: { limit?: number; enabled?: boolean } = {}) {
  return useCursorPages('risk', query, async (cursor, limit) =>
    unwrap(await api.GET('/api/v1/risk-assessments', { params: { query: { ...query, limit, ...(cursor ? { cursor } : {}) } } })), opts);
}
