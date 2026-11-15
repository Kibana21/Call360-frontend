import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiFailure, unwrap, type Me } from '../api/client';
import { onSessionExpired } from '../api/session';

interface AuthState {
  me: Me | null | undefined; // undefined = loading, null = signed out
  can: (permission: string) => boolean;
  signOut: () => Promise<void>;
  reload: () => Promise<unknown>;
}

const Ctx = createContext<AuthState | null>(null);
export const ME_KEY = ['me'] as const;

export async function fetchMe(): Promise<Me | null> {
  try {
    return unwrap(await api.GET('/api/v1/me'));
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 401) return null;
    throw e;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const query = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 30_000, retry: false });

  useEffect(() => {
    onSessionExpired(() => {
      const hadSession = qc.getQueryData(ME_KEY) != null;
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      if (hadSession) {
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
        navigate(`/session-expired?returnTo=${returnTo}`, { replace: true });
      }
    });
    return () => onSessionExpired(null);
  }, [qc, navigate]);

  const signOut = useCallback(async () => {
    await api.POST('/api/v1/auth/logout');
    qc.clear();
    qc.setQueryData(ME_KEY, null);
    navigate('/login', { replace: true });
  }, [qc, navigate]);

  const me = query.isPending ? undefined : (query.data ?? null);
  const value = useMemo<AuthState>(() => ({
    me,
    can: (p) => !!me?.permissions.includes(p),
    signOut,
    reload: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  }), [me, signOut, qc]);

  void location; // re-render on navigation so guards re-evaluate
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
