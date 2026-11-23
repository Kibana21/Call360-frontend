import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loading } from '../components/StateView';
import { useAuth } from './AuthContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const location = useLocation();
  if (me === undefined) return <Loading label="Checking your session…" />;
  if (me === null) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }
  // CP0.1B-3: a one-time password must be replaced first (the server refuses everything else until then).
  if (me.password_change_required && location.pathname !== '/account/password') return <Navigate to="/account/password" replace />;
  return <>{children}</>;
}

/** UI-only convenience; the backend enforces every permission independently (IAM-005). */
/** `permission`: the one needed, or several of which ANY ONE is enough (a shared capability reachable by its own
    permission or by the legacy one). The server decides either way. */
export function RequirePermission({ permission, children }: { permission: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (![permission].flat().some(can)) return <Navigate to="/unauthorized" replace />;
  return <>{children}</>;
}
