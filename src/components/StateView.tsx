// Loading / empty / error / forbidden states (S0_SCREEN_SPEC §1 rule 2).
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { Button } from './ui';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state-view" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <Icon name="info" size="lg" />
      <strong>{title}</strong>
      {children ? <p className="small">{children}</p> : null}
    </div>
  );
}

export function ErrorState({ message, correlationId, onRetry }: {
  message: string; correlationId?: string | null; onRetry?: () => void;
}) {
  return (
    <div className="state-view error" role="alert">
      <Icon name="alert" size="lg" />
      <div>
        <strong>{message}</strong>
        {correlationId ? <div className="xsmall muted mono">Reference: {correlationId}</div> : null}
      </div>
      {onRetry ? <Button tiny icon="refresh" onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="state-view" role="alert">
      <Icon name="lock" size="lg" />
      <strong>You do not have permission to view this.</strong>
    </div>
  );
}
