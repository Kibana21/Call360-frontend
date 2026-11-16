// F6 shared pieces: lifecycle badges, the synthetic-content banner, condition text and S2-gated actions.
import type { components } from '../../api/generated/schema';
import { Icon } from '../../components/Icon';
import { Badge, Button, StageChip, type Tone } from '../../components/ui';
import { humanize } from '../cases/shared';

export type ScriptVersionSummary = components['schemas']['ScriptVersionSummary'];
export type ScriptVersionDetail = components['schemas']['ScriptVersionDetail'];
export type ScriptQuestion = components['schemas']['ScriptQuestionOut'];
export type AssignmentRule = components['schemas']['AssignmentRuleOut'];

const STATUS_TONES: Record<string, Tone> = {
  PUBLISHED: 'green', DRAFT: 'amber', SUBMITTED_FOR_REVIEW: 'purple', APPROVED: 'blue', SCHEDULED: 'blue', SUPERSEDED: 'gray', WITHDRAWN: 'red',
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'gray'}>{humanize(status)}</Badge>;
}

export const scriptHref = (familyId: string, versionId?: string) => `/scripts/${familyId}${versionId ? `?version=${versionId}` : ''}`;
export const short = (sha?: string | null) => (sha ? `${sha.slice(0, 12)}…` : '—');

export function SyntheticBanner() {
  return (
    <div className="topnotice" role="note" data-testid="synthetic-script-banner">
      <div className="row"><Icon name="info" size="sm" />
        <span><strong>Synthetic — not approved AIA/MAS wording.</strong> Scripts, questions, controls and regulatory references here are illustrative
          Stage 0 content. They are not approved compliance language and must not be used with customers.</span>
      </div>
    </div>
  );
}

/** Stage S2 governance actions, visible but disabled (S0-A6). */
export function S2Actions({ id, labels }: { id: string; labels: string[] }) {
  return (
    <>
      {labels.map((l) => <Button key={l} tiny disabled aria-describedby={id}>{l}</Button>)}
      <span id={id}><StageChip label="Stage S2 — script governance" /></span>
    </>
  );
}

/** Human-readable rendering of a stored predicate or inclusion condition; it is shown, never evaluated. */
export function describeCondition(c: unknown): string {
  if (c == null) return 'Always included';
  if (typeof c !== 'object') return String(c);
  const o = c as Record<string, unknown>;
  if (Array.isArray(o.all)) return o.all.map(describeCondition).join(' and ');
  if (Array.isArray(o.any)) return `(${o.any.map(describeCondition).join(' or ')})`;
  if (Array.isArray(o.risk_band_in)) return `SBQ risk band is ${(o.risk_band_in as string[]).map(humanize).join(' or ')}`;
  if (typeof o.fact === 'string') {
    const v = o.equals;
    const value = typeof v === 'boolean' ? (v ? 'yes' : 'no') : /^[A-Z]{2,3}$/.test(String(v)) ? String(v) : humanize(String(v));
    return `${humanize(o.fact.toUpperCase())} is ${value}`;
  }
  return JSON.stringify(c);
}

export const show = (v: unknown): string => {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.length ? v.map(show).join(', ') : '—';
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 1 && entries[0]![0] === 'value') return show(entries[0]![1]); // stored as {"value": …}
    return entries.map(([k, x]) => `${k}: ${show(x)}`).join(' · ');
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};
