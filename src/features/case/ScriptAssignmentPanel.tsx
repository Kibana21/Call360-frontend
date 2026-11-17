// S2-C Call Detail — script assignment: status, the read-only preview of the deterministic decision (rule, explanation,
// contact used, condition trace, failure reasons), the apply action for users holding script.assign, the holds that
// would be released or placed and those that remain, and the attempt history. The backend decides everything; the
// preview's decision checksum is sent with the apply so a changed decision is never applied blindly.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import { ruleHref, OutcomeBadge, outcomeLabel } from '../rules/shared';
import { ErrorBox, errorText } from '../scripts/ScriptEditor';
import { short } from './evidence';

type View = components['schemas']['CaseScriptAssignment'];

const STATUS: Record<View['status'], [string, 'green' | 'blue' | 'red' | 'gray']> = {
  ASSIGNED: ['Script pinned', 'green'], READY_TO_ASSIGN: ['Ready to assign', 'blue'], BLOCKED: ['Assignment blocked', 'red'],
  NOT_ELIGIBLE: ['Not eligible', 'gray'],
};
const ruleLink = (ref: string) => {
  const [code, v] = ref.replace(/ \(proposed\)$/, '').split(' v');
  return <Link key={ref} className="link" to={ruleHref(code!)}>{code} v{v}</Link>;
};
const newKey = () => `assign-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}-${Date.now()}`;

export function ScriptAssignmentPanel({ caseId, recorded }: { caseId: string; recorded: ReactNode }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const view = useQuery({
    queryKey: ['case', caseId, 'assignment-preview'],
    queryFn: async () => unwrap(await api.GET('/api/v1/cases/{case_id}/script-assignment/preview', { params: { path: { case_id: caseId } } })),
  });
  const key = useRef(newKey());
  const [confirm, setConfirm] = useState(false);
  const run = useMutation({
    mutationFn: async (sha: string) => unwrap(await api.POST('/api/v1/cases/{case_id}/script-assignment/apply', {
      params: { path: { case_id: caseId }, header: { 'Idempotency-Key': key.current } }, body: { expected_decision_sha256: sha } })),
    onSuccess: () => { key.current = newKey(); setConfirm(false); },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['case', caseId] }); },
  });
  return (
    <Region query={view} label="script assignment">
      {() => {
        const v = view.data!;
        const p = v.preview;
        const [label, tone] = STATUS[v.status];
        return (
          <div className="stack" style={{ gap: 12 }} data-testid="script-assignment">
            <div className="row wrap" style={{ gap: 8 }}>
              <Badge tone={tone}>{label}</Badge>
              {v.status !== 'ASSIGNED' ? <OutcomeBadge outcome={p.outcome} /> : null}
              <span className="xsmall muted">Synthetic test-only scripts · assignment never verifies a case</span>
            </div>
            {v.current ? (
              <div data-testid="assignment-current">
                <div className="small"><span className="muted">Pinned </span>
                  <Link className="link strong" to={`/scripts/${v.current.script_family_id}?version=${v.current.script_version_id}`}>{v.current.script_label}</Link>
                  {' '}by {v.current.matched_rule ? ruleLink(v.current.matched_rule) : humanize(v.current.origin)} · {humanize(v.current.origin)} · {when(v.current.assigned_at)} SGT · {v.current.assigned_by}</div>
                {v.current.explanation ? <div className="explain" style={{ marginTop: 8 }}>{v.current.explanation}</div> : null}
                <div style={{ marginTop: 10 }}>{recorded}</div>
              </div>
            ) : (
              <div className="stack" style={{ gap: 10 }} data-testid="assignment-preview">
                <div className="section-label" style={{ margin: 0 }}>Preview (read-only, evaluated {when(p.evaluated_at)} SGT)</div>
                {p.script_label ? (
                  <div className="small">Would pin <strong data-testid="preview-script">{p.script_label}</strong> by {p.winning_rules.map(ruleLink)}</div>
                ) : <div className="small" role="note" data-testid="preview-blocked"><strong>{outcomeLabel(p.outcome)}:</strong> {p.reason}</div>}
                {p.explanation ? <div className="explain" data-testid="preview-explanation">{p.explanation}</div> : null}
                {p.winning_rules.length > 1 ? <p className="xsmall" style={{ margin: 0 }}>Tied rules: {p.winning_rules.map((r, i) => <span key={r}>{i ? ', ' : ''}{ruleLink(r)}</span>)}</p> : null}
                <dl className="kv xsmall">
                  <dt>Callback contact</dt><dd data-testid="preview-contact">{contactText(p.contact_resolution)}</dd>
                  <dt>Would release</dt><dd>{p.would_release.length ? p.would_release.map(humanize).join(', ') : 'Nothing'}</dd>
                  {p.would_place.length ? <><dt>Would place</dt><dd>{p.would_place.map(humanize).join(', ')}</dd></> : null}
                  <dt>Blocking holds remaining</dt><dd data-testid="preview-remaining">{p.remaining_blocking.length ? p.remaining_blocking.map(humanize).join(', ') : 'None'}</dd>
                  <dt>Decision checksum</dt><dd className="mono">{short(p.decision_sha256)}</dd>
                </dl>
                <details className="softbox" style={{ padding: 10 }}>
                  <summary className="small strong" style={{ cursor: 'pointer' }}>Rule trace ({p.trace.length} rules)</summary>
                  <ul className="plain-list stack" style={{ gap: 6, marginTop: 8 }} data-testid="preview-trace">
                    {p.trace.map((t) => {
                      const tr = t as { ref: string; priority: number; specificity: number; target_label: string; eligible: boolean; excluded_reason: string | null; match: string; selected: boolean; tied: boolean; conditions: { field: string; result: string; actual: unknown }[] };
                      return (
                        <li key={tr.ref} className="xsmall"><span className="mono strong">{tr.ref}</span> · priority {tr.priority} · specificity {tr.specificity} → {tr.target_label}{' '}
                          {tr.selected ? <Badge tone="green">Selected</Badge> : tr.tied ? <Badge tone="red">Tied</Badge> : !tr.eligible ? <Badge tone="gray">{`Excluded: ${tr.excluded_reason ?? ''}`}</Badge> : <Badge tone="gray">{humanize(tr.match)}</Badge>}
                          {tr.conditions.length ? <span className="muted"> · {tr.conditions.map((c) => `${c.result === 'PASS' ? '✓' : c.result === 'FAIL' ? '✗' : '?'} ${humanize(c.field.toUpperCase())}`).join(' ')}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                </details>
                {v.can_apply && can('script.assign') ? (confirm ? (
                  <div className="softbox stack" style={{ gap: 8 }} data-testid="apply-confirm">
                    <p className="small" style={{ margin: 0 }}>{p.would_assign
                      ? <>Pin <strong>{p.script_label}</strong> to {v.case_ref} and release {p.would_release.map(humanize).join(', ') || 'no hold'}. The pin is immutable; the case state does not change.</>
                      : <>Record this blocked decision{p.would_place.length ? ` and place ${p.would_place.map(humanize).join(', ')}` : ''}. No script is pinned.</>}</p>
                    <div className="row" style={{ gap: 8 }}>
                      <Button variant="primary" onClick={() => run.mutate(p.decision_sha256)} disabled={run.isPending} data-testid="apply-assignment">{p.would_assign ? 'Apply assignment' : 'Record blocked decision'}</Button>
                      <Button onClick={() => setConfirm(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : <div><Button variant={p.would_assign ? 'primary' : ''} icon="check" onClick={() => setConfirm(true)} data-testid="apply-open">{p.would_assign ? 'Apply assignment…' : 'Record blocked decision…'}</Button></div>)
                  : <p className="xsmall muted" style={{ margin: 0 }}>{v.blocked_reason ?? 'Applying an assignment needs the script-assignment permission (operations users).'}</p>}
                <ErrorBox error={run.error ? errorText(run.error) : null} />
              </div>
            )}
            {run.data ? <p className="small" role="status" data-testid="apply-result"><Badge tone={run.data.status === 'ASSIGNED' ? 'green' : 'amber'}>{humanize(run.data.status)}</Badge> {run.data.attempt?.reason}</p> : null}
            <div>
              <div className="section-label">Active holds</div>
              {v.holds.length ? (
                <ul className="plain-list" data-testid="assignment-holds">
                  {v.holds.map((h) => <li key={h.hold_reason} className="xsmall"><Badge tone={h.is_blocking ? 'red' : 'gray'}>{humanize(h.hold_reason)}</Badge> <span className="muted">{h.placed_reason ?? ''}</span></li>)}
                </ul>
              ) : <p className="xsmall muted" style={{ margin: 0 }} data-testid="assignment-no-holds">No active holds.</p>}
            </div>
            {v.attempts.length ? (
              <div><div className="section-label">Assignment attempts</div>
                <ul className="plain-list stack" style={{ gap: 4 }} data-testid="assignment-attempts">
                  {v.attempts.map((a) => <li key={a.id} className="xsmall"><OutcomeBadge outcome={a.outcome} /> {a.applied ? `pinned ${a.script_label}` : 'not pinned'}
                    {a.holds_released.length ? ` · released ${a.holds_released.map(humanize).join(', ')}` : ''}{a.holds_placed.length ? ` · placed ${a.holds_placed.map(humanize).join(', ')}` : ''} · {a.actor} · {when(a.evaluated_at)} SGT</li>)}
                </ul></div>
            ) : null}
          </div>
        );
      }}
    </Region>
  );
}

function contactText(r: Record<string, unknown>): string {
  const sel = r.selected as { role: string; label: string } | null;
  const status = String(r.status);
  if (sel) return `${humanize(sel.role)} (${sel.label || 'selected contact'})`;
  if (status === 'SAME_RESULT_FOR_ALL') return `${String(r.explanation)}`;
  if (status === 'NOT_NEEDED') return 'No eligible contact; the rules do not depend on the contact role';
  const considered = (r.considered as { role: string; outcome: string }[] | undefined) ?? [];
  return `Unresolved — ${String(r.explanation)}${considered.length ? ` (${considered.map((c) => `${humanize(c.role)}: ${outcomeLabel(c.outcome)}`).join('; ')})` : ''}`;
}
