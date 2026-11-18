// S3-C case review (`/reviews/cases/:caseId`, inside the Review Workbench): the review dossier — case and policy
// summary, pinned script, conversation, answers against expected facts and evaluation results, findings with severity,
// justification, class and controls, evidence references, readiness checks, approvals and the insert-only history —
// and the governed actions: finding dispositions, raise / assess, further callback, escalation, decision proposals and
// (for a different checker) approvals. Every action needs a reason; the backend decides everything.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, PageHead, type Tone } from '../../components/ui';
import { humanize, Region, RiskBadge, when } from '../cases/shared';
import { ErrorBox, Field } from '../scripts/ScriptEditor';
import { errorText } from '../simulator/ScenarioLibrary';
import { show } from '../scripts/shared';
import { SeverityBadge } from './ReviewWorkbenchPage';

type Dossier = components['schemas']['ReviewCaseOut'];
type Finding = components['schemas']['ReviewFinding'];
type Question = components['schemas']['ReviewQuestion'];
type Approval = components['schemas']['ReviewApprovalOut'];
type Options = components['schemas']['ReviewOptions'];

const STATE_TONE: Record<string, Tone> = { AWAITING_REVIEW: 'amber', ESCALATED: 'red', AWAITING_CALLBACK: 'blue', VERIFIED: 'green', CLOSED_UNVERIFIED: 'gray' };
const STATUS_TONE: Record<string, Tone> = { OPEN: 'red', UNDER_REVIEW: 'amber', CONFIRMED: 'red', DISMISSED: 'gray', CLOSED: 'green' };
const CLASS_TONE: Record<string, Tone> = { CUSTOMER_DISCREPANCY: 'red', MISSING_EVIDENCE: 'amber', SYSTEM_DATA_ISSUE: 'blue', HUMAN_ASSESSMENT: 'purple' };
const RESULT_TONE: Record<string, Tone> = { MATCH: 'green', MISMATCH: 'red', INDETERMINATE: 'amber', NOT_EVALUATED: 'gray' };
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

export function useReviewOptions() {
  return useQuery({ queryKey: ['review-options'], queryFn: async () => unwrap(await api.GET('/api/v1/review/options')), staleTime: 300_000 });
}

export function ReviewCasePage() {
  const { caseId = '' } = useParams();
  const q = useQuery({ queryKey: ['review-case', caseId], queryFn: async () => unwrap(await api.GET('/api/v1/review/cases/{case_id}', { params: { path: { case_id: caseId } } })) });
  const opts = useReviewOptions();
  return (
    <Region query={q} label="the case review">
      {() => <CaseReview d={q.data!} o={opts.data} />}
    </Region>
  );
}

function CaseReview({ d, o }: { d: Dossier; o: Options | undefined }) {
  const c = d.case as { id: string; case_ref: string; state: string; row_version: number; has_blocking_hold: boolean; closure_reason?: string | null; verified_at?: string | null; is_synthetic: boolean };
  const pol = (d.policy ?? {}) as Record<string, unknown>;
  const asg = (d.assignment ?? {}) as Record<string, unknown>;
  const conv = d.conversation as Record<string, unknown> | null;
  return (
    <>
      <PageHead eyebrow="Review Workbench · case review" title={c.case_ref}
        description="Inspect the evidence, record dispositions with reasons and propose a governed case decision. Final decisions and dispositions of material findings need a different checker."
        actions={<div className="row" style={{ gap: 8 }}><Link className="btn" to="/reviews?tab=cases">Back to the queue</Link><Link className="btn" to={`/cases/${c.id}`}>Open Call Detail</Link></div>} />
      <div className="topnotice" role="note" data-testid="rc-banner"><span>{d.note}</span></div>
      <section className="card card-pad" data-testid="rc-header" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Badge tone={STATE_TONE[c.state] ?? 'gray'}>{humanize(c.state)}</Badge>
          {c.is_synthetic ? <Badge tone="amber">Synthetic</Badge> : null}
          {c.has_blocking_hold ? <Badge tone="red">Blocking hold</Badge> : null}
          {c.closure_reason ? <Badge tone="gray">{`Closure reason: ${humanize(c.closure_reason)}`}</Badge> : null}
          {c.verified_at ? <span className="xsmall muted">Verified {when(c.verified_at)}</span> : null}
        </div>
        <div className="info-grid" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
          <div className="info-tile"><label>Policy · sale</label><strong>{String(pol.policy_ref ?? '—')}</strong><div className="xsmall muted">{String(pol.product_code ?? '')} · {String(pol.sale_ref ?? '')} · {humanize(String(pol.selling_channel ?? ''))}</div></div>
          <div className="info-tile"><label>SBQ selection risk</label><strong>{pol.band ? <RiskBadge band={String(pol.band)} /> : '—'}</strong><div className="xsmall muted">Why the case was selected — not a finding</div></div>
          <div className="info-tile"><label>Pinned script</label><strong>{String(asg.script_label ?? 'None pinned')}</strong><div className="xsmall muted">{asg.version_status ? humanize(String(asg.version_status)) : ''}</div></div>
          <div className="info-tile" data-testid="rc-conversation"><label>Conversation</label><strong>{conv ? `${String(conv.session_ref)} · ${humanize(String(conv.status))}` : 'None recorded'}</strong>
            <div className="xsmall muted">{conv ? `${humanize(String(conv.transport))} · ${humanize(String(conv.record_origin))} · recording ${humanize(String(conv.media_status)).toLowerCase()} · transcript ${humanize(String(conv.transcript_status)).toLowerCase()}` : 'No evidence to review'}</div></div>
        </div>
        {d.attempts.some((a) => (a as { fixture?: boolean }).fixture) ? <p className="xsmall muted" style={{ margin: '10px 0 0' }} data-testid="rc-fixture">Includes an explicitly synthetic S3-C fixture conversation (scripted structured answers; transport synthetic) — not a customer contact or a voice session.</p> : null}
      </section>
      <div className="rc-grid">
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <FindingsCard d={d} o={o} />
          <AnswersCard d={d} o={o} />
          <EvidenceCard d={d} />
          <HistoryCard d={d} />
        </div>
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <ReadinessCard key={`r${c.row_version}`} d={d} o={o} />
          <ApprovalsCard d={d} />
          <CaseActionsCard key={`a${c.row_version}`} d={d} o={o} />
        </div>
      </div>
    </>
  );
}

// ---- shared action plumbing ----------------------------------------------------------------------------------------
function useAct(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['review-case', caseId] });
      void qc.invalidateQueries({ queryKey: ['review-cases'] });
      void qc.invalidateQueries({ queryKey: ['review-approvals'] });
      void qc.invalidateQueries({ queryKey: ['review-queue'] });
    },
  });
}

function ReasonForm({ label, submit, pending, testid, children, confirmLabel, disabled }: {
  label: string; submit: (reason: string, key: string) => void; pending: boolean; testid: string; children?: ReactNode; confirmLabel: string; disabled?: boolean;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [key] = useState(newKey);
  return (
    <form className="softbox stack" style={{ gap: 8 }} data-testid={testid} onSubmit={(e) => { e.preventDefault(); submit(reason, key); }}>
      {children}
      <Field id={`${id}-r`} label={label} hint="Required; recorded with your identity in the review history">{(p) => <textarea {...p} className="field textarea labelled" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} data-testid={`${testid}-reason`} />}</Field>
      <div><Button type="submit" variant="primary" disabled={pending || disabled} data-testid={`${testid}-submit`}>{pending ? 'Recording…' : confirmLabel}</Button></div>
    </form>
  );
}

// ---- findings ----------------------------------------------------------------------------------------------------
function FindingsCard({ d, o }: { d: Dossier; o: Options | undefined }) {
  return (
    <Card title={`Findings (${d.findings.length})`} subtitle="Flagged concerns for review — never breach determinations. Original evidence is never changed.">
      <div className="stack" style={{ gap: 12 }} data-testid="rc-findings">
        {!d.findings.length ? <p className="small muted" style={{ margin: 0 }}>No findings on this case. That alone never verifies it — see the readiness checks.</p> : null}
        {d.findings.map((f) => <FindingItem key={`${f.id}:${f.row_version}:${f.pending_approval_id ?? ''}`} f={f} caseId={String((d.case as { id: string }).id)} o={o} />)}
      </div>
    </Card>
  );
}

function FindingItem({ f, caseId, o }: { f: Finding; caseId: string; o: Options | undefined }) {
  const act = useAct(caseId);
  const [open, setOpen] = useState<string | null>(null);
  const rule = f.rule as { rule_code?: string; text?: string } | null;
  const controls = (f.controls ?? []) as { control_code?: string; control_name?: string; mapping_status?: string }[];
  return (
    <article className="softbox stack" style={{ gap: 6 }} data-testid={`rc-finding-${f.finding_ref}`}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="mono small strong">{f.finding_ref}</span>
        <SeverityBadge severity={f.severity} />{f.material ? <Badge tone="red">Material</Badge> : null}
        <Badge tone={STATUS_TONE[f.status] ?? 'gray'}>{humanize(f.status)}</Badge>
        <Badge tone={CLASS_TONE[f.finding_class] ?? 'gray'}>{humanize(f.finding_class)}</Badge>
        <Badge tone="purple">{humanize(f.origin)}</Badge>
        <span data-testid={`rc-sev-source-${f.finding_ref}`}>
          {f.origin === 'REVIEWER' ? <Badge tone="amber">Human-assigned severity</Badge> : f.rule ? <Badge tone="gray">Rule-assigned severity</Badge> : null}
        </span>
        {f.pending_approval_id ? <Badge tone="blue">Awaiting checker approval</Badge> : null}
      </div>
      <div className="small">{humanize(f.category)}{f.question_code ? <> · <span className="mono">{f.question_code}</span></> : null}</div>
      <div className="xsmall"><span className="muted">Severity justification: </span>{f.severity_justification} <span className="muted">({f.severity_source})</span></div>
      {rule?.text ? <div className="xsmall"><span className="muted">Finding rule: </span>{rule.text}</div> : null}
      {f.explanation ? <div className="xsmall"><span className="muted">Evaluation: </span>{f.explanation}</div> : null}
      <div className="xsmall" data-testid={`rc-finding-controls-${f.finding_ref}`}><span className="muted">Compliance controls: </span>{controls.length ? controls.map((c) => `${c.control_code}${c.control_name ? ` ${c.control_name}` : ''}${c.mapping_status ? ` (${humanize(c.mapping_status).toLowerCase()})` : ''}`).join('; ') : f.controls ? <Badge tone="amber">No control mapped</Badge> : 'Not recorded on this finding'}</div>
      <details><summary className="xsmall muted" style={{ cursor: 'pointer', minHeight: 24, display: 'inline-flex', alignItems: 'center' }}>Evidence references</summary>
        <pre className="xsmall" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '6px 0 0' }}>{JSON.stringify(f.evidence_refs, null, 2)}</pre></details>
      {f.allowed_actions.length ? (
        <div className="row wrap" style={{ gap: 6 }}>
          {f.allowed_actions.map((a) => <Button key={a} tiny variant={open === a ? 'primary' : undefined} onClick={() => setOpen(open === a ? null : a)} data-testid={`rc-f-${f.finding_ref}-${a}`}>{o?.finding_actions[a] ?? humanize(a)}</Button>)}
        </div>
      ) : null}
      {open ? (
        <ReasonForm key={open} label={`Reason — ${o?.finding_actions[open] ?? humanize(open)}`} pending={act.isPending} testid={`rc-f-form`} confirmLabel={['DISMISS', 'RESOLVE'].includes(open) && f.material ? 'Propose (needs a checker)' : 'Record'}
          submit={(reason, key) => act.mutate(async () => { await unwrap(await api.POST('/api/v1/review/findings/{finding_id}/actions', { params: { path: { finding_id: f.id } }, body: { action: open as 'CONFIRM', reason, expected_row_version: f.row_version, idempotency_key: key } })); setOpen(null); })}>
          {['DISMISS', 'RESOLVE'].includes(open) && f.material ? <p className="xsmall" style={{ margin: 0 }}>Material finding: this is a protected outcome and becomes a request for a different checker.</p> : null}
        </ReasonForm>
      ) : null}
      <ErrorBox error={act.error ? errorText(act.error) : null} />
    </article>
  );
}

// ---- answers -----------------------------------------------------------------------------------------------------
function AnswersCard({ d, o }: { d: Dossier; o: Options | undefined }) {
  const caseId = String((d.case as { id: string }).id);
  const findingsByQ = new Map(d.findings.map((f) => [f.question_code, f]));
  const editable = ['AWAITING_REVIEW', 'ESCALATED', 'AWAITING_CALLBACK'].includes(String((d.case as { state: string }).state));
  return (
    <Card title="Customer answers and expected policy facts" subtitle="Structured answers, expected values from the pinned rule and policy fact snapshot, deterministic evaluation results">
      {!d.questions.length ? <p className="small muted" style={{ margin: 0 }} data-testid="rc-no-answers">No conversation is recorded: there are no answers to review (missing evidence, never a pass).</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Answers"><table className="data-table" data-testid="rc-answers">
          <thead><tr><th>Question</th><th>Answer</th><th>Expected</th><th>Evaluation</th><th>Review</th></tr></thead>
          <tbody>{d.questions.filter((q) => q.applicable).map((q) => (
            <AnswerRow key={q.code} q={q} finding={findingsByQ.get(q.code)} caseId={caseId} rowVersion={Number((d.case as { row_version: number }).row_version)} o={o} editable={editable} />
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function AnswerRow({ q, finding, caseId, rowVersion, o, editable }: { q: Question; finding?: Finding; caseId: string; rowVersion: number; o: Options | undefined; editable: boolean }) {
  const { can } = useAuth();
  const act = useAct(caseId);
  const [mode, setMode] = useState<'raise' | 'assess' | null>(null);
  const [cat, setCat] = useState('');
  const [sev, setSev] = useState('');
  const [just, setJust] = useState('');
  const [outcome, setOutcome] = useState('SATISFACTORY');
  const exp = q.expected as { value?: unknown; source?: string } | null;
  const discrepancy = q.evaluation_result === 'MISMATCH' || q.evaluation_result === 'INDETERMINATE';
  const narrative = q.method === 'NARRATIVE_REVIEW';
  const canAct = editable && can('review.decide');
  return (
    <>
      <tr data-testid={`rc-q-${q.code}`}>
        <td><span className="mono small">{q.code}</span> {q.mandatory ? <Badge tone="red">Mandatory</Badge> : null}<div className="xsmall muted">{humanize(q.stage)}{q.role !== 'VERIFICATION' ? ` · ${humanize(q.role)}` : ''} · r{q.revision}</div></td>
        <td className="small">{q.executed ? <>{humanize(q.answer_state ?? '—')}{q.typed_value != null ? <div className="xsmall muted">{show(q.typed_value)}</div> : null}</> : <Badge tone="amber">Not executed</Badge>}</td>
        <td className="xsmall" style={{ whiteSpace: 'normal', maxWidth: 220 }}>{exp && exp.value !== undefined ? `${show(exp.value)}${exp.source ? ` (${exp.source.replace('POLICY_FACT:', 'policy fact ')})` : ''}` : q.rule_text ?? '—'}</td>
        <td>{q.evaluation_result ? <Badge tone={RESULT_TONE[q.evaluation_result] ?? 'gray'}>{humanize(q.evaluation_result)}</Badge> : <span className="xsmall muted">{q.method === 'COLLECT_ONLY' ? 'Capture only' : '—'}</span>}</td>
        <td className="xsmall" style={{ whiteSpace: 'normal' }}>
          {finding ? <span className="mono">{finding.finding_ref}</span> : discrepancy ? <Badge tone="amber">Unconverted discrepancy</Badge> : null}
          {q.assessment ? <div>Assessed: {humanize(String((q.assessment as { outcome: string }).outcome))}</div> : narrative && q.executed ? <div className="muted">Needs human assessment</div> : null}
          {canAct ? (
            <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
              {(discrepancy && !finding) || narrative ? <Button tiny onClick={() => setMode(mode === 'raise' ? null : 'raise')} data-testid={`rc-raise-${q.code}`}>Raise finding</Button> : null}
              {narrative && q.executed ? <Button tiny onClick={() => setMode(mode === 'assess' ? null : 'assess')} data-testid={`rc-assess-${q.code}`}>Assess</Button> : null}
            </div>
          ) : null}
        </td>
      </tr>
      {mode ? (
        <tr><td colSpan={5}>
          {mode === 'raise' ? (
            <ReasonForm label="Why a finding is raised" pending={act.isPending} testid="rc-raise-form" confirmLabel="Raise finding" disabled={!cat || !sev || just.trim().length < 10}
              submit={(reason, key) => act.mutate(async () => { await unwrap(await api.POST('/api/v1/review/cases/{case_id}/actions', { params: { path: { case_id: caseId } }, body: { action: 'RAISE_FINDING', reason, expected_row_version: rowVersion, idempotency_key: key, question_code: q.code, category: cat, severity: sev as 'LOW', severity_justification: just } })); setMode(null); })}>
              <div className="row wrap" style={{ gap: 8 }}>
                <label className="row xsmall" style={{ gap: 6 }}>Category<select className="field" value={cat} onChange={(e) => setCat(e.target.value)} data-testid="rc-raise-category"><option value="">Choose…</option>{(o?.categories ?? []).map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></label>
                <label className="row xsmall" style={{ gap: 6 }}>Severity<select className="field" value={sev} onChange={(e) => setSev(e.target.value)} data-testid="rc-raise-severity"><option value="">Choose…</option>{(o?.severities ?? []).map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              </div>
              <label className="xsmall stack" style={{ gap: 4 }}>Severity justification (10–300 characters)<input className="field" value={just} onChange={(e) => setJust(e.target.value)} maxLength={300} data-testid="rc-raise-justification" /></label>
            </ReasonForm>
          ) : (
            <ReasonForm label="Assessment reason" pending={act.isPending} testid="rc-assess-form" confirmLabel="Record assessment"
              submit={(reason, key) => act.mutate(async () => { await unwrap(await api.POST('/api/v1/review/cases/{case_id}/actions', { params: { path: { case_id: caseId } }, body: { action: 'ASSESS_ANSWER', reason, expected_row_version: rowVersion, idempotency_key: key, question_code: q.code, reason_code: outcome } })); setMode(null); })}>
              <label className="row xsmall" style={{ gap: 6 }}>Outcome<select className="field" value={outcome} onChange={(e) => setOutcome(e.target.value)} data-testid="rc-assess-outcome">{(o?.assessments ?? ['SATISFACTORY', 'CONCERN']).map((a) => <option key={a} value={a}>{humanize(a)}</option>)}</select></label>
              {outcome === 'CONCERN' ? <p className="xsmall" style={{ margin: 0 }}>A concern also needs a raised finding.</p> : null}
            </ReasonForm>
          )}
          <ErrorBox error={act.error ? errorText(act.error) : null} />
        </td></tr>
      ) : null}
    </>
  );
}

// ---- readiness and decisions ---------------------------------------------------------------------------------------
function ReadinessCard({ d, o }: { d: Dossier; o: Options | undefined }) {
  const { can } = useAuth();
  const c = d.case as { id: string; state: string; row_version: number };
  const act = useAct(c.id);
  const [mode, setMode] = useState<'VERIFY' | 'CLOSE_UNVERIFIED' | null>(null);
  const [closure, setClosure] = useState('');
  const err = act.error ? errorText(act.error) : null;
  const allowed = (d.allowed as { decisions?: string[] }).decisions ?? [];
  return (
    <Card title="Case decision" subtitle="A case is never verified only because it completed, matched or has no findings">
      <div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 6 }}><Badge tone={d.readiness.ready ? 'green' : 'red'}>{d.readiness.ready ? 'Ready to propose verification' : 'Not ready to verify'}</Badge></div>
        <ul className="plain-list stack" style={{ gap: 4 }} data-testid="rc-readiness" aria-label="Readiness checks">
          {d.readiness.checks.map((ch) => (
            <li key={ch.code} className="xsmall" data-testid={`rc-check-${ch.code}`}><Badge tone={ch.ok ? 'green' : 'red'}>{ch.ok ? 'Pass' : 'Blocked'}</Badge> <strong>{ch.label}</strong><div className="muted" style={{ marginLeft: 4 }}>{ch.detail}</div></li>
          ))}
        </ul>
        {can('review.decide') && allowed.length ? (
          <div className="row wrap" style={{ gap: 6 }}>
            {allowed.map((k) => <Button key={k} tiny variant={mode === k ? 'primary' : undefined} onClick={() => setMode(mode === k ? null : (k as 'VERIFY'))} data-testid={`rc-decide-${k}`}>{o?.decisions[k] ?? humanize(k)}</Button>)}
          </div>
        ) : null}
        {mode ? (
          <ReasonForm key={mode} label={mode === 'VERIFY' ? 'Why the case can be verified' : 'Why the case is closed unverified'} pending={act.isPending} testid="rc-decision-form"
            confirmLabel="Propose (needs a different checker)" disabled={mode === 'CLOSE_UNVERIFIED' && !closure}
            submit={(reason, key) => act.mutate(async () => { await unwrap(await api.POST('/api/v1/review/cases/{case_id}/decisions', { params: { path: { case_id: c.id } }, body: { decision: mode, reason, expected_row_version: c.row_version, idempotency_key: key, closure_reason: mode === 'CLOSE_UNVERIFIED' ? closure : null } })); setMode(null); })}>
            {mode === 'CLOSE_UNVERIFIED' ? <label className="row xsmall" style={{ gap: 6 }}>Closure reason<select className="field" value={closure} onChange={(e) => setClosure(e.target.value)} data-testid="rc-closure-reason"><option value="">Choose…</option>{(o?.closure_reasons ?? []).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select></label> : null}
          </ReasonForm>
        ) : null}
        {err ? <div data-testid="rc-decision-error"><ErrorBox error={err} /></div> : null}
      </div>
    </Card>
  );
}

function ApprovalsCard({ d }: { d: Dossier }) {
  const { me, can } = useAuth();
  const caseId = String((d.case as { id: string }).id);
  const act = useAct(caseId);
  const [open, setOpen] = useState<string | null>(null);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  if (!d.pending_approvals.length) return null;
  const meId = me?.principal.principal_id;
  return (
    <Card title="Awaiting checker approval" subtitle="Maker-checker: the proposer cannot decide their own proposal">
      <div className="stack" style={{ gap: 10 }} data-testid="rc-approvals">
        {d.pending_approvals.map((a: Approval) => (
          <div key={a.id} className="softbox stack" style={{ gap: 6 }} data-testid={`rc-approval-${a.approval_ref}`}>
            <div className="row wrap" style={{ gap: 6 }}><span className="mono small strong">{a.approval_ref}</span><Badge tone="blue">{humanize(a.proposed_action)}</Badge>{a.finding_ref ? <span className="mono xsmall">{a.finding_ref}</span> : null}{a.closure_reason ? <Badge tone="gray">{humanize(a.closure_reason)}</Badge> : null}</div>
            <div className="xsmall">Proposed by {a.proposed_by_name ?? '—'} · {when(a.proposed_at)} — {a.reason}</div>
            {can('review.approve') && a.proposed_by !== meId ? (
              open === a.id ? (
                <ReasonForm label="Checker reason" pending={act.isPending} testid="rc-approve-form" confirmLabel={decision === 'APPROVE' ? 'Approve' : 'Reject'}
                  submit={(reason, key) => act.mutate(async () => { await unwrap(await api.POST('/api/v1/review/approvals/{approval_id}/decide', { params: { path: { approval_id: a.id } }, body: { decision, reason, idempotency_key: key } })); setOpen(null); })}>
                  <label className="row xsmall" style={{ gap: 6 }}>Decision<select className="field" value={decision} onChange={(e) => setDecision(e.target.value as 'APPROVE')} data-testid="rc-approve-decision"><option value="APPROVE">Approve</option><option value="REJECT">Reject</option></select></label>
                </ReasonForm>
              ) : <div><Button tiny variant="primary" onClick={() => setOpen(a.id)} data-testid={`rc-approval-open-${a.approval_ref}`}>Decide as checker</Button></div>
            ) : <div className="xsmall muted" data-testid="rc-approval-wait">{a.proposed_by === meId ? 'You proposed this — a different checker must decide it.' : 'Needs a checker with review.approve.'}</div>}
          </div>
        ))}
        <ErrorBox error={act.error ? errorText(act.error) : null} />
      </div>
    </Card>
  );
}

function CaseActionsCard({ d, o }: { d: Dossier; o: Options | undefined }) {
  const { can } = useAuth();
  const c = d.case as { id: string; row_version: number };
  const act = useAct(c.id);
  const [mode, setMode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const allowed = (d.allowed as { case_actions?: string[] }).case_actions ?? [];
  if (!can('review.decide') || !allowed.length) return null;
  return (
    <Card title="Case actions" subtitle="Existing case states only; escalation blocks verification">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row wrap" style={{ gap: 6 }}>{allowed.map((k) => <Button key={k} tiny variant={mode === k ? 'primary' : undefined} onClick={() => setMode(mode === k ? null : k)} data-testid={`rc-case-${k}`}>{o?.case_actions[k] ?? humanize(k)}</Button>)}</div>
        {mode ? (
          <ReasonForm key={mode} label={`Reason — ${o?.case_actions[mode] ?? humanize(mode)}`} pending={act.isPending} testid="rc-case-form" confirmLabel="Record" disabled={mode === 'ESCALATE' && !code}
            submit={(reason, key) => act.mutate(async () => { await unwrap(await api.POST('/api/v1/review/cases/{case_id}/actions', { params: { path: { case_id: c.id } }, body: { action: mode as 'ESCALATE', reason, expected_row_version: c.row_version, idempotency_key: key, reason_code: mode === 'ESCALATE' ? code : null } })); setMode(null); })}>
            {mode === 'ESCALATE' ? <label className="row xsmall" style={{ gap: 6 }}>Escalation reason<select className="field" value={code} onChange={(e) => setCode(e.target.value)} data-testid="rc-escalation-reason"><option value="">Choose…</option>{Object.entries(o?.escalation_reasons ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label> : null}
          </ReasonForm>
        ) : null}
        <ErrorBox error={act.error ? errorText(act.error) : null} />
      </div>
    </Card>
  );
}

// ---- evidence and history ------------------------------------------------------------------------------------------
function EvidenceCard({ d }: { d: Dossier }) {
  const conv = d.conversation as Record<string, unknown> | null;
  return (
    <Card title="Evidence references" subtitle="Unavailable evidence is shown as unavailable">
      <dl className="kv xsmall" data-testid="rc-evidence" style={{ overflowWrap: 'anywhere', wordBreak: 'break-all', minWidth: 0 }}>
        <dt>Script manifest</dt><dd className="mono">{conv ? String(conv.script_manifest_sha256) : 'No conversation'}</dd>
        <dt>Policy fact snapshot</dt><dd className="mono">{conv ? `${String(conv.policy_fact_snapshot_id)} · ${String(conv.policy_fact_snapshot_sha256)}` : '—'}</dd>
        {d.media.map((m) => {
          const mm = m as { session_ref: string; available: boolean; detail?: string | null; recordings?: { asset_ref: string; status: string }[]; transcripts?: { run_ref: string; status: string }[] };
          return <div key={mm.session_ref} style={{ display: 'contents' }}><dt>{mm.session_ref}</dt><dd data-testid={`rc-media-${mm.session_ref}`}>{mm.available ? `${(mm.recordings ?? []).map((r) => `${r.asset_ref} ${r.status}`).join(', ')}; transcripts ${(mm.transcripts ?? []).map((t) => `${t.run_ref} ${t.status}`).join(', ') || 'none'}` : <span style={{ wordBreak: 'normal' }}><Badge tone="amber">Not available</Badge> {mm.detail ?? ''}</span>}</dd></div>;
        })}
        <dt>Holds</dt><dd>{d.holds.length ? d.holds.map((h) => `${humanize(String((h as { hold_reason: string }).hold_reason))}${(h as { released_at?: string }).released_at ? ' (released)' : ''}`).join('; ') : 'None'}</dd>
      </dl>
    </Card>
  );
}

function HistoryCard({ d }: { d: Dossier }) {
  return (
    <Card title="Review history and audit" subtitle="Insert-only: decisions are never overwritten">
      <ol className="plain-list stack xsmall" style={{ gap: 6 }} data-testid="rc-history">
        {!d.history.length ? <li className="muted">No review decision recorded yet.</li> : null}
        {d.history.map((h) => {
          const x = h as { decision_ref: string; action: string; reason: string; reason_code?: string | null; actor_name?: string | null; decided_at: string; from_status?: string | null; to_status?: string | null; case_state_before: string; case_state_after: string; finding_ref?: string | null; actor_permission: string };
          return (
            <li key={x.decision_ref} data-testid={`rc-history-${x.decision_ref}`}>
              <span className="mono">{x.decision_ref}</span> <strong>{humanize(x.action)}</strong>{x.finding_ref ? <> · <span className="mono">{x.finding_ref}</span></> : null}
              {x.from_status !== x.to_status && x.to_status ? ` · ${humanize(x.from_status ?? '—')} → ${humanize(x.to_status)}` : ''}
              {x.case_state_before !== x.case_state_after ? ` · case ${humanize(x.case_state_before)} → ${humanize(x.case_state_after)}` : ''}
              {x.reason_code ? ` · ${humanize(x.reason_code)}` : ''}
              <div className="muted">{x.actor_name ?? '—'} ({x.actor_permission}) · {when(x.decided_at)} — {x.reason}</div>
            </li>
          );
        })}
      </ol>
      <details style={{ marginTop: 10 }}><summary className="xsmall muted" style={{ cursor: 'pointer', minHeight: 24 }}>Case events ({d.events.length})</summary>
        <ul className="plain-list xsmall stack" style={{ gap: 2, marginTop: 6 }}>{d.events.map((e, i) => { const x = e as { event_type: string; occurred_at: string; summary: string }; return <li key={i}><strong>{humanize(x.event_type)}</strong> · {when(x.occurred_at)} — {x.summary}</li>; })}</ul></details>
    </Card>
  );
}
