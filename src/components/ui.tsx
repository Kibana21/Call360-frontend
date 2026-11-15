// Thin React wrappers over the mockup's design-system classes (src/styles/mockup.css).
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type Tone = 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'gray' | 'dark';

export function Badge({ tone = 'gray', children, noDot }: { tone?: Tone; children: ReactNode; noDot?: boolean }) {
  return <span className={`badge ${tone}${noDot ? ' no-dot' : ''}`}>{children}</span>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: '' | 'primary' | 'dark' | 'subtle' | 'danger';
  tiny?: boolean;
  icon?: IconName;
};

export function Button({ variant = '', tiny, icon, className, children, type = 'button', ...rest }: ButtonProps) {
  const cls = ['btn', variant, tiny ? 'tiny' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </button>
  );
}

export function PageHead({ eyebrow, title, description, actions }: {
  eyebrow: string; title: string; description?: string; actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="head-actions">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, subtitle, aside, children, pad = true }: {
  title?: string; subtitle?: string; aside?: ReactNode; children: ReactNode; pad?: boolean;
}) {
  return (
    <section className={`card${pad ? ' card-pad' : ''}`} aria-label={title}>
      {title ? (
        <div className="card-heading" style={pad ? undefined : { padding: '19px 19px 0' }}>
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Visible stage label for not-yet-available features (ADR-0008 §3–§4). */
export function StageChip({ label }: { label: string }) {
  return <span className="stage-chip">{label}</span>;
}
