// F2 shared pieces: URL ⇄ API filter mapping, labels and the case table used by Call Explorer and Work Queues.
// The URL holds exactly the API's query parameters, so a bookmarked register reproduces the same server query.
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiFailure, type CaseQuery, type CaseRow } from '../../api/client';
import { Empty, ErrorState, Forbidden, Loading } from '../../components/StateView';
import { Badge, type Tone } from '../../components/ui';

export const SGT = 'Asia/Singapore';
export const LIST_PARAMS = ['state', 'outcome', 'band', 'hold_reason', 'product_family'] as const;
export const SCALAR_PARAMS = ['q', 'ilp', 'overdue', 'on_hold', 'due_from', 'due_to', 'queue', 'kpi', 'kpi_set', 'from', 'to', 'sort'] as const;

/** URLSearchParams → typed API query (unknown keys are ignored; the server validates values). */
export function toQuery(params: URLSearchParams): CaseQuery {
  const q: Record<string, unknown> = {};
  for (const k of LIST_PARAMS) {
    const v = params.getAll(k).filter(Boolean);
    if (v.length) q[k] = v;
  }
  for (const k of SCALAR_PARAMS) {
    const v = params.get(k);
    if (v) q[k] = v;
  }
  return q as CaseQuery;
}

export const humanize = (code: string) =>
  (code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ')).replace(/\bilp\b/gi, 'ILP');

export const OUTCOME_LABELS: Record<string, string> = {
  VERIFIED_COMPLIANT: 'Verified compliant', VERIFIED_WITH_FINDINGS: 'Verified with findings',
  NOT_VERIFIED: 'Not verified', CANCELLED: 'Cancelled', OPEN: 'Open',
  VERIFIED_CONTROL_EVIDENCE_INCOMPLETE: 'Verified — control evidence incomplete',
};
export const BAND_LABELS: Record<string, string> = {
  HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', UNKNOWN: 'Unknown', NOT_ASSESSED: 'Not assessed',
};
export const QUEUE_LABELS: Record<string, string> = {
  DUE_TODAY: 'Due today', OVERDUE: 'Overdue', AWAITING_CALLBACK: 'Awaiting callback', ON_HOLD: 'On hold',
};
const BAND_TONES: Record<string, Tone> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'green' };
const STATE_TONES: Record<string, Tone> = {
  VERIFIED: 'green', CLOSED_UNVERIFIED: 'gray', CANCELLED: 'gray', AWAITING_REVIEW: 'purple', ESCALATED: 'red',
  IN_PROGRESS: 'blue', AWAITING_CALLBACK: 'amber', READY: 'blue',
};

export const when = (iso: string) =>
  new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: SGT }).format(new Date(iso));
export const count = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-SG'));

export function failure(error: unknown) {
  return error instanceof ApiFailure ? { status: error.status, ref: error.body?.correlation_id ?? null, message: error.message } : { status: 0, ref: null, message: '' };
}

export function RiskBadge({ band }: { band: string }) {
  return <Badge tone={BAND_TONES[band] ?? 'gray'}>{BAND_LABELS[band] ?? band}</Badge>;
}

export function Region({ query, label, children }: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; label: string; children: () => ReactNode;
}) {
  if (query.isPending) return <Loading label={`Loading ${label}…`} />;
  if (query.isError) {
    const f = failure(query.error);
    if (f.status === 403) return <Forbidden />;
    const msg = f.status === 422 ? `These filters are not valid: ${f.message}` : `${label[0]!.toUpperCase()}${label.slice(1)} could not be loaded.`;
    return <ErrorState message={msg} correlationId={f.ref} onRetry={f.status === 422 ? undefined : () => void query.refetch()} />;
  }
  return <>{children()}</>;
}

/** Router state carrying the current list URL, so Call Detail's back link returns to the same filters. */
export function useFrom() {
  const location = useLocation();
  return { from: location.pathname + location.search };
}

export function CaseTable({ rows, caption, emptyTitle, emptyHint, variant = 'register' }: {
  rows: CaseRow[]; caption: string; emptyTitle: string; emptyHint?: string; variant?: 'register' | 'queue';
}) {
  const from = useFrom();
  if (rows.length === 0) return <Empty title={emptyTitle}>{emptyHint}</Empty>;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={`${caption} (scrolls horizontally)`}>
      <table className="data-table" data-testid="case-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Callback case</th><th scope="col">Customer / policy</th><th scope="col">Product</th>
            <th scope="col">Risk</th><th scope="col">Case status</th><th scope="col">Attempts / latest</th>
            <th scope="col">Due date</th><th scope="col">Assigned script</th>
            {variant === 'register' ? <th scope="col">Evidence</th> : null}
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.case_id} data-case-ref={r.case_ref}>
              <td><Link className="link mono" to={r.route} state={from}>{r.case_ref}</Link>
                <div className="small muted" style={{ marginTop: 5 }}>{OUTCOME_LABELS[r.outcome] ?? r.outcome}</div></td>
              <td><b>{r.policyholder}</b><div className="small muted" style={{ marginTop: 5 }}>
                <Link className="link mono" to={`/policies/${r.policy_id}`} state={from} tabIndex={-1} aria-label={`${r.policy_ref} Policy Detail`}>{r.policy_ref}</Link></div></td>
              <td>{humanize(r.product_family)}{r.is_ilp && r.product_family !== 'ILP' ? <> <Badge tone="dark" noDot>ILP</Badge></> : null}
                <div className="small muted" style={{ marginTop: 5 }}>{humanize(r.product_subtype)}</div></td>
              <td><RiskBadge band={r.risk_band} /></td>
              <td className="wrap-cell">
                <Badge tone={STATE_TONES[r.state] ?? 'gray'}>{humanize(r.state)}</Badge>
                {r.holds.length ? <div className="xsmall muted" style={{ marginTop: 5 }}>
                  {r.blocking_hold ? 'Blocking hold: ' : 'Hold: '}{r.holds.map(humanize).join(', ')}</div> : null}
              </td>
              <td>{r.attempts} / {r.latest_attempt_status ? humanize(r.latest_attempt_status) : 'None yet'}
                {r.sessions ? <div className="xsmall muted" style={{ marginTop: 5 }}>{r.sessions} session{r.sessions > 1 ? 's' : ''}</div> : null}</td>
              <td className="xsmall">{when(r.due_at)}{r.overdue ? <div style={{ marginTop: 5 }}><Badge tone="red">Overdue</Badge></div> : null}</td>
              <td className="xsmall mono">{r.script ?? 'Not assigned'}</td>
              {variant === 'register' ? <td><span title="Recordings and transcripts are captured from Stage S1"><Badge tone="gray" noDot>Not available (S1)</Badge></span></td> : null}
              <td><Link className="btn tiny" to={r.route} state={from} aria-label={`Call Detail ${r.case_ref}`} tabIndex={-1}>Call Detail</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
