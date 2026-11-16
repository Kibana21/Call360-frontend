// Call Detail (`/cases/:caseId`), F3: read-only investigation of one Singapore callback case (API-037…047, API-063;
// S0_SCREEN_SPEC "Call Detail"). Every value comes from the server; outcome, SLA and control satisfaction are the
// backend's derivations. Recordings and transcripts do not exist before Stage S1 and are shown as NOT_AVAILABLE.
// Each region loads independently, so one failing region leaves the rest usable (partial state).
import { useQuery } from '@tanstack/react-query';
import { Fragment, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  api, unwrap, type Attempt, type CaseDetail, type Finding, type QuestionResult,
  type ScriptAssignment, type SessionDetail, type SurveyRun, type TimelineItem,
} from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { VoiceSessionTimeline } from '../voice/VoiceSessionTimeline';
import { Icon, type IconName } from '../../components/Icon';
import { Empty, ErrorState, Forbidden, Loading } from '../../components/StateView';
import { Badge, Button, Card, PageHead, StageChip, type Tone } from '../../components/ui';
import { BAND_LABELS, count, failure, humanize, OUTCOME_LABELS, Region, when } from '../cases/shared';
import { FactSnapshot, Risk, short, show } from './evidence';

const OUTCOME_TONES: Record<string, Tone> = {
  VERIFIED_COMPLIANT: 'green', VERIFIED_WITH_FINDINGS: 'amber', NOT_VERIFIED: 'gray', CANCELLED: 'gray', OPEN: 'blue',
};
const ATTEMPT_TONES: Record<string, string> = { CONNECTED: 'green', IN_SESSION: 'green', ENDED: 'green', FAILED: 'red', WRONG_PARTY: 'red' };
const SEVERITY_TONES: Record<string, Tone> = { CRITICAL: 'red', HIGH: 'red', MEDIUM: 'amber', LOW: 'gray' };
const TABS = [['evidence', 'Conversation & evidence'], ['answers', 'Structured answers'], ['context', 'Case, policy & risk'], ['timeline', 'Timeline']] as const;
const EVENT_ICONS: Record<string, IconName> = {
  ATTEMPT_RECORDED: 'phone', SESSION_RECORDED: 'mic', FINDING_RAISED: 'alert', HOLD_PLACED: 'lock', HOLD_RELEASED: 'check',
  SCRIPT_ASSIGNED: 'clipboard', CASE_CREATED: 'files', CASE_VERIFIED: 'check', CASE_CLOSED: 'close', CASE_CANCELLED: 'close',
  RISK_RECORDED: 'target', CONTACTS_SELECTED: 'users', CONTACT_CHANGED: 'edit',
};

// F3 refinement (owner, 2026-11-15): `callable` is a preliminary data-level eligibility check, never an authorisation
// to call. Blockers that share one cause (an active NO_ELIGIBLE_CONTACT hold and an empty eligible contact selection)
// are shown once, listing every piece of evidence behind them.
const CAUSE_LABELS: Record<string, string> = {
  NO_ELIGIBLE_CONTACT: 'No eligible contact', CASE_VERIFIED: 'Case already verified', CASE_CLOSED_UNVERIFIED: 'Case closed unverified',
  CASE_CANCELLED: 'Case cancelled',
};

export function precheckReasons(blockers: string[]): { cause: string; label: string; evidence: string[] }[] {
  const out = new Map<string, { cause: string; label: string; evidence: string[] }>();
  for (const b of blockers) {
    const [cause, evidence] = b.startsWith('HOLD:') ? [b.slice(5), 'active blocking hold']
      : b === 'NO_ELIGIBLE_CONTACT' ? [b, 'no eligible contact in the case contact selection'] : [b, 'case state'];
    const entry = out.get(cause) ?? { cause, label: CAUSE_LABELS[cause] ?? `${humanize(cause)} hold`, evidence: [] };
    entry.evidence.push(evidence);
    out.set(cause, entry);
  }
  return [...out.values()];
}

function PreCheck({ d }: { d: CaseDetail }) {
  const reasons = precheckReasons(d.callable_blockers);
  return (
    <div className="stack precheck" data-testid="cd-precheck">
      <span className="small muted">Contact pre-check (stored data only)</span>
      {d.callable ? <Badge tone="green">Pre-check passed</Badge> : <Badge tone="red">Blocked</Badge>}
      {reasons.length ? <ul className="precheck-reasons">{reasons.map((r) => (
        <li key={r.cause}><strong>{r.label}</strong> <span className="muted">— {r.evidence.join(' and ')}</span></li>
      ))}</ul> : null}
      <span className="xsmall muted">Not an authorisation to call a customer. S1-A allows only a local synthetic audio test.</span>
    </div>
  );
}

function backLabel(back: string): string {
  if (back.startsWith('/queues')) return 'queues';
  if (back.startsWith('/search')) return 'search';
  if (back.startsWith('/policies/')) return 'policy';
  if (back.startsWith('/policies')) return 'Policy Explorer';
  if (back.startsWith('/risk-assessments')) return 'Risk Workbench';
  return back === '/' ? 'Overview' : 'explorer';
}

function useCaseQuery<T>(key: unknown[], enabled: boolean, fn: () => Promise<T>) {
  return useQuery({ queryKey: key, enabled, queryFn: fn });
}

export function CallDetailPage() {
  const { caseId = '' } = useParams();
  const { can } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const allowed = can('case.read');
  const path = { params: { path: { case_id: caseId } } };
  const detail = useCaseQuery(['case', caseId], allowed, async () => unwrap(await api.GET('/api/v1/cases/{case_id}', path)));
  const ok = allowed && detail.isSuccess;
  const attempts = useCaseQuery(['case', caseId, 'attempts'], ok, async () => unwrap(await api.GET('/api/v1/cases/{case_id}/attempts', path)));
  const assignment = useCaseQuery(['case', caseId, 'assignment'], ok, async () => unwrap(await api.GET('/api/v1/cases/{case_id}/script-assignment', path)));
  const findings = useCaseQuery(['case', caseId, 'findings'], ok, async () => unwrap(await api.GET('/api/v1/cases/{case_id}/findings', path)));
  const timeline = useCaseQuery(['case', caseId, 'timeline'], ok, async () => unwrap(await api.GET('/api/v1/cases/{case_id}/timeline', path)));

  const items = attempts.data?.items ?? [];
  const withSession = items.filter((a) => a.session);
  const selectedAttempt = items.find((a) => a.id === params.get('attempt'))
    ?? items.find((a) => a.session?.session_id === params.get('session'))
    ?? withSession[withSession.length - 1] ?? items[items.length - 1];
  const sessionId = selectedAttempt?.session?.session_id;
  const runId = selectedAttempt?.session?.survey_run_id;
  const session = useCaseQuery(['session', sessionId], ok && !!sessionId,
    async () => unwrap(await api.GET('/api/v1/sessions/{session_id}', { params: { path: { session_id: sessionId! } } })));
  const run = useCaseQuery(['run', runId], ok && !!runId,
    async () => unwrap(await api.GET('/api/v1/survey-runs/{survey_run_id}', { params: { path: { survey_run_id: runId! } } })));
  const media = useCaseQuery(['media', sessionId], ok && !!sessionId,
    async () => unwrap(await api.GET('/api/v1/sessions/{session_id}/media', { params: { path: { session_id: sessionId! } } })));
  const transcript = useCaseQuery(['transcript', sessionId], ok && !!sessionId,
    async () => unwrap(await api.GET('/api/v1/sessions/{session_id}/transcript', { params: { path: { session_id: sessionId! } } })));

  if (!allowed) return <Forbidden />;
  const back = (location.state as { from?: string } | null)?.from ?? '/calls';
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab')! : 'evidence';
  const setParam = (k: string, v: string | null) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (v) n.set(k, v); else n.delete(k);
    if (k === 'attempt') n.delete('session');
    return n;
  }, { replace: true, state: location.state });

  const showAttempt = (id: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    n.set('attempt', id); n.delete('session'); n.delete('tab');
    return n;
  }, { state: location.state });

  const head = (
    <PageHead eyebrow="Case investigation" title="Call Detail"
      description="One verification obligation from sale context and selection risk to every contact attempt, the pinned script, answers and findings."
      actions={<>
        <Link className="btn" to={back}><Icon name="chev" size="sm" /> Back to {backLabel(back)}</Link>
        {detail.data?.callable && can('voice.session.start') ? (
          <Link className="btn" to={`/voice-studio?case=${caseId}`} data-testid="cd-start-voice"><Icon name="phone" size="sm" /> Start browser call</Link>
        ) : <Button icon="phone" disabled aria-describedby="cd-s1">Start browser call</Button>}
        <span id="cd-s1"><StageChip label={detail.data?.callable ? 'S1-A synthetic audio test' : 'Pre-check blocked'} /></span>
        <Button icon="download" disabled aria-describedby="cd-s3">Evidence bundle</Button>
        <Button variant="primary" icon="users" disabled aria-describedby="cd-s3">Assign reviewer</Button>
        <span id="cd-s3"><StageChip label="Stage S3" /></span>
      </>} />
  );
  if (detail.isPending) return <>{head}<Loading label="Loading Call Detail…" /></>;
  if (detail.isError) {
    const f = failure(detail.error);
    if (f.status === 403) return <>{head}<Forbidden /></>;
    if (f.status === 404 || f.status === 422) return <>{head}<Card><Empty title="Case not found or not available to you">
      Only Singapore callback cases in your scope can be opened. <Link className="linkbtn" to="/calls">Open Call Explorer</Link></Empty></Card></>;
    return <>{head}<ErrorState message="Call Detail could not be loaded." correlationId={f.ref} onRetry={() => void detail.refetch()} /></>;
  }
  const d = detail.data;
  const eligible = d.contact_selection.filter((s) => s.eligible);
  const here = { from: `${location.pathname}${location.search}` };
  const policyRoute = `/policies/${d.policy.id}?sale=${d.sale.id}`;

  return (
    <>
      {head}
      {d.is_synthetic ? (
        <div className="topnotice" role="note">
          <div className="row"><Icon name="info" size="sm" />
            {d.source_type === 'MANUAL'
              ? <span><strong>Synthetic intake case:</strong> created by manual intake from a synthetic source transaction. No script is assigned and no compliance evaluation runs in Stage 0.</span>
              : <span><strong>Seeded synthetic evidence:</strong> not produced by a Call360 voice session or compliance evaluation. Script wording is illustrative, not approved AIA or MAS language.</span>}
          </div>
          <Badge tone="blue">Synthetic</Badge>
        </div>
      ) : null}

      <section className="card card-pad case-header" aria-label="Case summary" style={{ marginBottom: 17 }}>
        <div className="row between wrap" style={{ alignItems: 'start' }}>
          <div>
            <div className="row wrap">
              <Badge tone="dark">{humanize(d.state)}</Badge>
              <span data-testid="cd-outcome"><Badge tone={OUTCOME_TONES[d.outcome] ?? 'gray'}>Outcome: {OUTCOME_LABELS[d.outcome] ?? d.outcome}</Badge></span>
              <SlaBadge d={d} />
              {d.risk_band ? <Badge tone={d.risk_band === 'HIGH' ? 'red' : d.risk_band === 'MEDIUM' ? 'amber' : 'green'}>
                {BAND_LABELS[d.risk_band] ?? d.risk_band} selection risk · {humanize(d.effective_risk?.origin ?? '')}</Badge>
                : <Badge tone="gray">No SBQ assessment</Badge>}
              {d.holds.filter((h) => h.active).map((h) => <Badge key={h.id} tone={h.is_blocking ? 'red' : 'amber'}>{h.is_blocking ? 'Blocking hold' : 'Hold'}: {humanize(h.hold_reason)}</Badge>)}
            </div>
            <h2 className="case-title"><span className="mono">{d.case_ref}</span> <span style={{ color: '#b9bfc9' }}>/</span> {d.parties.find((p) => p.roles.includes('OWNER'))?.masked_name ?? '—'}</h2>
            <div className="small muted">Policy <Link className="link mono strong" to={policyRoute} state={here} aria-label={`${d.policy.policy_ref} Policy Detail`}>{d.policy.policy_ref}</Link> · {humanize(d.policy.product_family)} · {humanize(d.policy.product_subtype)}
              {' '}· Sale <span className="mono">{d.sale.sale_ref}</span> ({humanize(d.sale.sale_event_type)}) · Due {when(d.due_at)} SGT · Owner <span data-testid="cd-owner">{d.owner ?? 'Unassigned'}</span></div>
          </div>
          <PreCheck d={d} />
        </div>
        <div className="info-grid case-tiles">
          <div className="info-tile"><label>Sales context</label><strong>{humanize(d.sale.selling_channel ?? '—')}</strong>
            <div className="xsmall muted">{d.sale.selling_location ?? '—'} · FSC {d.sale.fsc?.fsc_ref ?? '—'}</div></div>
          <div className="info-tile"><label>Contact person</label><strong>{eligible[0]?.masked_name ?? 'No eligible contact'}</strong>
            <div className="xsmall muted">{eligible[0] ? `${humanize(eligible[0].role)} · ${eligible[0].masked_contact ?? '—'}` : `${d.contact_selection.length} considered`}</div></div>
          <div className="info-tile"><label>Attempts</label><strong data-testid="cd-attempts">{d.attempts} · {d.sessions} session{d.sessions === 1 ? '' : 's'}</strong>
            <div className="xsmall muted">{items.length ? humanize(items[items.length - 1]!.status) : 'None yet'}</div></div>
          <div className="info-tile"><label>Assigned script</label><strong>{d.current_script
            ? <Link className="link" to={`/scripts/${d.current_script.script_family_id}?version=${d.current_script.script_version_id}`} data-testid="cd-script-link">{d.current_script.family} v{d.current_script.version_label}</Link>
            : 'Not assigned'}</strong>
            <div className="xsmall muted">{d.current_script ? humanize(d.current_script.status) : '—'}</div></div>
          <div className="info-tile"><label>Verification outcome</label><strong>{OUTCOME_LABELS[d.outcome] ?? d.outcome}</strong>
            <div className="xsmall muted">{d.state === 'VERIFIED' ? (d.controls_satisfied ? 'Mandatory controls satisfied' : 'Mandatory controls not all satisfied') : `${d.open_findings} open finding${d.open_findings === 1 ? '' : 's'}`}</div></div>
        </div>
      </section>

      <div className="subtabs" role="tablist" aria-label="Call Detail sections" style={{ margin: '0 0 16px' }}>
        {TABS.map(([k, label]) => (
          <button type="button" role="tab" key={k} id={`tab-${k}`} aria-selected={tab === k} aria-controls="cd-panel"
            className={tab === k ? 'active' : ''} onClick={() => setParam('tab', k === 'evidence' ? null : k)}>{label}</button>
        ))}
      </div>

      <div id="cd-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'evidence' ? (
          <div className="threepane cd-threepane">
            <Card title="Contact history" subtitle={`${d.attempts} attempt${d.attempts === 1 ? '' : 's'}, including unanswered`}>
              <Region query={attempts} label="contact attempts">{() => <Attempts items={items} selected={selectedAttempt?.id} onSelect={(id) => setParam('attempt', id)} />}</Region>
            </Card>
            <div className="stack" style={{ gap: 15 }}>
              <Card title="Recording" subtitle={selectedAttempt?.session ? `Session ${selectedAttempt.session.session_ref}` : 'No conversation for this attempt'}>
                <Unavailable q={media} none={!sessionId} fallback="Recording not available — no audio is captured before Stage S1" icon="headphones" testId="cd-recording" />
              </Card>
              <Card title="Transcript" subtitle="Recorded answers are shown under Question results">
                <Unavailable q={transcript} none={!sessionId} fallback="Transcript not available — transcripts are captured from Stage S1" icon="chat" testId="cd-transcript" />
              </Card>
              <Card title="Question results" subtitle="Expected-answer policy → observed answer → seeded rule outcome" aside={run.data ? <ControlsBadge run={run.data} /> : null}>
                {!runId ? <Empty title="No survey run for the selected attempt">Only connected attempts have a conversation session and survey run.</Empty>
                  : <Region query={run} label="survey run">{() => <QuestionCards run={run.data!} />}</Region>}
              </Card>
            </div>
            <div className="stack" style={{ gap: 15 }}>
              <Card title="Session pins" subtitle="Immutable inputs fixed when the session started">
                {!sessionId ? <Empty title="No session selected" /> : <Region query={session} label="session">{() => <SessionPins s={session.data!} />}</Region>}
              </Card>
              {selectedAttempt?.transport === 'BROWSER' ? <VoiceSessionTimeline sessionId={selectedAttempt.id} title={`Browser voice session · ${selectedAttempt.attempt_ref}`} /> : null}
              <Card title="Why this script" subtitle="Recorded assignment and rule trace">
                <Region query={assignment} label="script assignment">{() => <WhyScript items={assignment.data!.items} />}</Region>
              </Card>
              <Card title="Findings" subtitle="Severity is a compliance finding attribute, not selection risk">
                <Region query={findings} label="findings">{() => <Findings items={findings.data!.items} material={findings.data!.material_severities} />}</Region>
              </Card>
            </div>
          </div>
        ) : null}
        {tab === 'answers' ? (
          <Card title="Structured question results" subtitle={run.data ? `Survey run for ${run.data.session_ref} · ${humanize(run.data.status)} · script v${run.data.script.version_label}` : 'Select a connected attempt'} pad={false}>
            {!runId ? <Empty title="No survey run for the selected attempt" />
              : <Region query={run} label="survey run">{() => <AnswersTable q={run.data!.questions} />}</Region>}
          </Card>
        ) : null}
        {tab === 'context' ? <ContextTab d={d} policyRoute={policyRoute} from={here} /> : null}
        {tab === 'timeline' ? (
          <Card title="Case event timeline" subtitle="Every recorded case event, oldest first (synthetic)">
            <Region query={timeline} label="timeline">{() => <Events items={timeline.data!.items} onOpen={showAttempt} attempts={items} />}</Region>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function SlaBadge({ d }: { d: CaseDetail }) {
  const s = d.sla;
  const [tone, label]: [Tone, string] = s.exempt ? ['gray', `SLA exempt (${s.exemption_rule})`]
    : !s.matured ? ['blue', 'SLA: not yet due'] : s.breached ? ['red', 'SLA breached'] : ['green', 'Within SLA'];
  return <span title={s.note} data-testid="cd-sla"><Badge tone={tone}>{label}</Badge></span>;
}

function Unavailable({ q, none, fallback, icon, testId }: {
  q: { data?: { message: string }; isError: boolean }; none: boolean; fallback: string; icon: IconName; testId: string;
}) {
  return (
    <div className="unavailable" data-testid={testId} role="status">
      <Icon name={icon} size="lg" />
      <div><strong>{none ? 'Nothing to show — no conversation session for this attempt' : q.data?.message ?? fallback}</strong>
        <div className="xsmall muted">{none ? 'Unanswered, busy and failed attempts create no session.' : 'Status NOT_AVAILABLE. No player, seek bar or download is offered.'}</div></div>
    </div>
  );
}

function Attempts({ items, selected, onSelect }: { items: Attempt[]; selected?: string; onSelect: (id: string) => void }) {
  if (!items.length) return <Empty title="No contact attempts yet">The callback has not been attempted.</Empty>;
  return (
    <ol className="mini-timeline attempts-list" aria-label="Contact attempts">
      {[...items].reverse().map((a) => (
        <li className="step" key={a.id}>
          <div className={`step-dot ${ATTEMPT_TONES[a.status] ?? ''}`} />
          <button type="button" className={`step-body attempt-btn${a.id === selected ? ' selected' : ''}`} aria-pressed={a.id === selected}
            onClick={() => onSelect(a.id)} data-testid={`attempt-${a.sequence}`}>
            <strong>Attempt {a.sequence} · {humanize(a.status)}{a.transport === 'BROWSER' ? ' · Browser voice test' : ''}</strong>
            {a.started_at ? `${when(a.started_at)} SGT` : 'Not started'}
            <small>{show(a.contact_snapshot.channel)} {show(a.contact_snapshot.masked_value)} · {a.contacted_party ?? 'party not recorded'}</small>
            <small>{a.session ? `Session ${a.session.session_ref} · ${humanize(a.session.state)}` : 'No conversation or recording created'}</small>
            <small className="mono">{a.attempt_ref} · {humanize(a.record_origin)}</small>
          </button>
        </li>
      ))}
    </ol>
  );
}

function ControlsBadge({ run }: { run: SurveyRun }) {
  return run.controls_satisfied ? <Badge tone="green">Mandatory controls satisfied</Badge> : <Badge tone="amber">Mandatory controls not all satisfied</Badge>;
}

/** The answer as recorded: the typed value, plus the answer state when it adds information (e.g. 5 · state Yes). */
function observed(q: QuestionResult): string {
  if (!q.answer_state) return 'No answer recorded';
  const value = show(q.typed_value);
  const state = humanize(q.answer_state);
  return value === state || value === '—' ? state : `${value} · answer state ${state}`;
}

function ruleLabel(q: QuestionResult): [Tone, string] {
  if (!q.rule_result) return ['gray', q.expected_answer_policy === 'NARRATIVE_REVIEW' ? 'Needs human review (S3)' : 'No rule evaluation'];
  if (q.rule_result === 'MATCH') return ['green', 'Seeded rule outcome: MATCH'];
  return ['red', `Seeded rule outcome: ${q.rule_result} — needs review`];
}

function QuestionCards({ run }: { run: SurveyRun }) {
  if (!run.questions.length) return <Empty title="No questions were delivered in this run" />;
  return (
    <div data-testid="question-results">
      {run.questions.map((q) => {
        const [tone, label] = ruleLabel(q);
        return (
          <div key={q.question_execution_id} className={`evidence${q.rule_result && q.rule_result !== 'MATCH' ? ' red' : ''}`} data-question={q.question_code}>
            <div className="row between wrap"><span className="small muted mono">{q.position}. {q.question_code}{q.mandatory ? ' · mandatory' : ''}</span><Badge tone={tone}>{label}</Badge></div>
            <div className="q-wording">{q.wording}</div>
            <dl className="kv xsmall q-kv">
              <dt>Expected ({humanize(q.expected_answer_policy)})</dt><dd>{q.policy_fact_key ? `Policy fact ${q.policy_fact_key} = ${show(q.rule_expected)}` : show(q.rule_expected ?? q.expected_value)}</dd>
              <dt>Observed</dt><dd>{observed(q)}{q.verbatim_text_redacted ? <span className="muted"> — “{q.verbatim_text_redacted}”</span> : null}</dd>
              {q.control_satisfied != null ? <><dt>Mandatory control</dt><dd>{q.control_satisfied ? 'Satisfied' : 'Not satisfied'}</dd></> : null}
              {q.findings.length ? <><dt>Findings</dt><dd className="mono">{q.findings.join(', ')}</dd></> : null}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function SessionPins({ s }: { s: SessionDetail }) {
  const facts = s.fact_snapshot?.facts ?? {};
  return (
    <dl className="kv xsmall pins">
      <dt>Session</dt><dd className="mono">{s.session_ref} · {humanize(s.state)}</dd>
      <dt>Script version</dt><dd>{s.script.family} v{s.script.version_label} <Badge tone={s.script.status === 'PUBLISHED' ? 'green' : 'gray'}>{humanize(s.script.status)}</Badge></dd>
      <dt>Manifest SHA-256</dt><dd className="mono" title={s.script_manifest_sha256}>{short(s.script_manifest_sha256)} {s.script_pin_matches ? '✓ matches version' : '✗ differs from version'}</dd>
      <dt>Risk at session</dt><dd>{s.risk_assessment ? `${BAND_LABELS[s.risk_assessment.band_code ?? ''] ?? '—'} · ${humanize(s.risk_assessment.origin)}` : '—'} <span className="mono muted">{short(s.risk_snapshot_sha256)}</span></dd>
      <dt>Policy fact snapshot</dt><dd className="mono" title={s.fact_snapshot?.sha256}>{short(s.fact_snapshot?.sha256)} {s.fact_snapshot_pin_matches ? '✓ pinned' : '✗ differs'}</dd>
      <dt>Premium term (snapshot)</dt><dd>{show(facts.premium_term_years)} years · {show(facts.premium_frequency)}</dd>
      <dt>Contacted party</dt><dd>{s.contacted_party ?? '—'} · {show(s.contact_method_snapshot.masked_value)}</dd>
      <dt>Media / transcript</dt><dd>{humanize(s.media_status)} / {humanize(s.transcript_status)}</dd>
    </dl>
  );
}

function WhyScript({ items }: { items: ScriptAssignment[] }) {
  if (!items.length) return <Empty title="No script assigned">The case is held until a script is assigned.</Empty>;
  const a = items[0]!;
  const trace = a.rule_trace as { matched?: string; precedence?: string; resolved_sections?: string[]; excluded?: { rule: string; reason: string }[]; label?: string };
  return (
    <div className="stack" style={{ gap: 9 }}>
      <div><Link className="link small strong" to={`/scripts/${a.script.script_family_id}?version=${a.script.script_version_id}`}>{a.script.family} v{a.script.version_label}</Link> <Badge tone="gray">{humanize(a.script.status)}</Badge>
        <div className="xsmall muted mono" style={{ marginTop: 4 }}>manifest {short(a.script_manifest_sha256)}</div></div>
      <div className="rules-flow">{(trace.resolved_sections ?? []).map((s, i) => <span key={s} className="row" style={{ gap: 9 }}>{i ? <span className="arrow">+</span> : null}<span className="rule-chip">{humanize(s)}</span></span>)}</div>
      <dl className="kv xsmall">
        <dt>Matched rule</dt><dd>{a.matched_rule ? <Link className="link" to={`/assignment-rules?rule=${encodeURIComponent(a.matched_rule)}`}>{a.matched_rule}</Link> : trace.matched ?? '—'}</dd>
        <dt>Precedence</dt><dd>{trace.precedence ?? '—'}</dd>
        <dt>Inputs</dt><dd>{Object.entries(a.input_snapshot).filter(([k]) => !k.endsWith('_id')).map(([k, v]) => `${humanize(k)} ${show(v)}`).join(' · ')}</dd>
        {trace.excluded?.length ? <><dt>Not applied</dt><dd>{trace.excluded.map((x) => `${x.rule} (${x.reason})`).join('; ')}</dd></> : null}
        <dt>Assigned</dt><dd>{when(a.assigned_at)} SGT · {a.assigned_by}</dd>
      </dl>
      {trace.label ? <p className="xsmall muted" style={{ margin: 0 }}>{trace.label}</p> : null}
      {items.length > 1 ? <p className="xsmall muted">{items.length - 1} earlier assignment(s) retained.</p> : null}
    </div>
  );
}

function Findings({ items, material }: { items: Finding[]; material: string[] }) {
  if (!items.length) return <Empty title="No findings on this case" />;
  return (
    <div className="stack" style={{ gap: 9 }} data-testid="findings">
      {items.map((f) => (
        <div key={f.id} className={`evidence${material.includes(f.severity) ? ' red' : ''}`}>
          <div className="row between wrap"><span className="mono small strong">{f.finding_ref}</span>
            <span className="row"><Badge tone={SEVERITY_TONES[f.severity] ?? 'gray'}>{f.severity}</Badge><Badge tone="gray">{humanize(f.status)}</Badge></span></div>
          <div className="small" style={{ margin: '7px 0 4px' }}>{humanize(f.category)}{f.question_code ? ` · ${f.question_code}` : ''}</div>
          <div className="xsmall muted">Raised {when(f.raised_at)} SGT · origin {humanize(f.origin)} · {humanize(f.record_origin)}{material.includes(f.severity) ? ' · material' : ''}</div>
          <div className="xsmall muted">Review: {f.review_closed_at ? 'closed' : f.review_assigned_at ? 'assigned' : 'not assigned'} (review decisions arrive in Stage S3)</div>
        </div>
      ))}
    </div>
  );
}

function AnswersTable({ q }: { q: QuestionResult[] }) {
  if (!q.length) return <Empty title="No questions were delivered in this run" />;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Structured question results (scrolls horizontally)">
      <table className="data-table">
        <caption className="sr-only">Structured question results</caption>
        <thead><tr><th scope="col">Question</th><th scope="col">Expected-answer policy</th><th scope="col">Expected</th><th scope="col">Observed answer</th><th scope="col">Seeded rule outcome</th><th scope="col">Mandatory control</th><th scope="col">Delivery</th></tr></thead>
        <tbody>
          {q.map((x) => {
            const [tone, label] = ruleLabel(x);
            return (
              <tr key={x.question_execution_id}>
                <td className="wrap-cell"><strong className="mono">{x.question_code}</strong><div className="small muted" style={{ marginTop: 5, maxWidth: 320 }}>{x.wording}</div></td>
                <td>{humanize(x.expected_answer_policy)}</td>
                <td className="wrap-cell">{x.policy_fact_key ? `${x.policy_fact_key} = ${show(x.rule_expected)}` : show(x.rule_expected ?? x.expected_value)}</td>
                <td className="wrap-cell">{observed(x)}</td>
                <td><Badge tone={tone}>{label}</Badge></td>
                <td>{x.control_satisfied == null ? <span className="muted">Not counted</span> : x.control_satisfied ? 'Satisfied' : 'Not satisfied'}</td>
                <td>{humanize(x.delivery_status)}{x.retries ? ` · ${x.retries} retr${x.retries === 1 ? 'y' : 'ies'}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ContextTab({ d, policyRoute, from }: { d: CaseDetail; policyRoute: string; from: { from: string } }) {
  const canRisk = useAuth().can('risk.read');
  const snap = d.fact_snapshots[d.fact_snapshots.length - 1];
  const kv = (rows: [string, ReactNode][]) => <dl className="kv">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>;
  const money = (n: number | null | undefined, c?: string | null) => (n == null ? '—' : `${c ?? ''} ${n.toLocaleString('en-SG', { minimumFractionDigits: 2 })}`);
  return (
    <div className="layout cols-even">
      <Card title="Policy and sale" subtitle={`Source ${humanize(d.policy.source_type)}${d.sale.recorded_at ? ` · recorded ${when(d.sale.recorded_at)} SGT` : ''}`}
        aside={<Link className="btn tiny" to={policyRoute} state={from}><Icon name="briefcase" size="sm" /> Policy Detail</Link>}>
        {kv([
          ['Policy', <Link className="link mono" to={policyRoute} state={from}>{d.policy.policy_ref}</Link>], ['Product', `${d.policy.product_code} · ${humanize(d.policy.product_family)} · ${humanize(d.policy.product_subtype)}${d.policy.is_ilp ? ' · ILP' : ''}`],
          ['Premium', `${money(d.policy.premium_amount, d.policy.currency)} ${humanize(d.policy.premium_frequency ?? '')} · ${d.policy.premium_term_years ?? '—'} years`],
          ['Sum assured', money(d.policy.sum_assured, d.policy.sum_assured_currency)], ['Policy status', humanize(d.policy.status)],
          ['Sale event', <span><span className="mono">{d.sale.sale_ref}</span> · {humanize(d.sale.sale_event_type)} · {when(d.sale.sold_at)} SGT</span>],
          ['Channel / location', `${humanize(d.sale.selling_channel ?? '—')} · ${d.sale.selling_location ?? '—'}`], ['Campaign / proposal', `${d.sale.campaign_code ?? '—'} · ${d.sale.proposal_ref ?? '—'}`],
          ['FSC', d.sale.fsc ? `${d.sale.fsc.fsc_ref} · ${d.sale.fsc.display_name}` : '—'],
        ])}
      </Card>
      <Card title="Parties and contact eligibility" subtitle="Masked; eligibility is a data-level pre-check, not identity verification (S1)">
        <div className="section-label">Parties on the policy</div>
        {d.parties.map((p) => <div className="metricline" key={p.party_ref}><span><strong>{p.masked_name}</strong> <span className="mono xsmall muted">{p.party_ref}</span></span><span>{p.roles.map(humanize).join(', ')}</span></div>)}
        <div className="divider" />
        <div className="section-label">Contact selection</div>
        {d.contact_selection.length ? d.contact_selection.map((s, i) => (
          <div className="metricline" key={`${s.party_ref}-${s.role}-${i}`}><span>{s.masked_name} · {humanize(s.role)} · {s.masked_contact ?? 'no method'}</span>
            {s.eligible ? <Badge tone="green">Eligible</Badge> : <Badge tone="gray">{humanize(s.ineligibility_reason ?? 'Ineligible')}</Badge>}</div>
        )) : <Empty title="No contact selection recorded" />}
      </Card>
      <Card title="SBQ callback-selection risk" subtitle="Selection risk sets script and priority; it is not a misconduct verdict or the customer's risk tolerance"
        aside={canRisk ? <Link className="btn tiny" to={`/risk-assessments?q=${d.sale.sale_ref}${d.effective_risk ? `&assessment=${d.effective_risk.id}` : ''}`} state={from}>
          <Icon name="target" size="sm" /> Risk Workbench</Link> : null}>
        {d.risk_assessments.length ? <div className="stack" style={{ gap: 9 }}>{d.risk_assessments.map((a) => <Risk key={a.id} a={a} />)}</div>
          : <Empty title="No SBQ assessment recorded">The case is held for risk triage until one is supplied.</Empty>}
      </Card>
      <Card title="Policy fact snapshot" subtitle={snap ? `Captured ${when(snap.captured_at)} SGT · SHA-256 ${short(snap.sha256)}` : 'None'}>
        {snap ? <FactSnapshot snap={snap} /> : <Empty title="No fact snapshot" />}
      </Card>
      <Card title="Holds, SLA and closure" subtitle="Holds never pause the SLA clock">
        {kv([
          ['SLA', `${d.sla.exempt ? `Exempt (${d.sla.exemption_rule})` : !d.sla.matured ? 'Not yet due' : d.sla.breached ? 'Breached' : 'Met'} · due ${when(d.sla.due_at)} SGT`],
          ['Verified / closed', `${d.verified_at ? when(d.verified_at) : '—'} / ${d.closed_at ? when(d.closed_at) : '—'}`],
          ['Closure reason', d.closure_reason ? humanize(d.closure_reason) : '—'],
          ['Cancellation', d.cancellation ? `${humanize(String(d.cancellation.reason ?? ''))} · recorded ${d.cancellation.recorded_at ? when(String(d.cancellation.recorded_at)) : '—'} · authorisation ${d.cancellation.authorization_ref ?? 'not recorded'}` : '—'],
        ])}
        <div className="divider" />
        {d.holds.length ? d.holds.map((h) => (
          <div className="metricline" key={h.id}><span>{humanize(h.hold_reason)}{h.is_blocking ? ' (blocking)' : ''} · placed {when(h.placed_at)} by {h.placed_by}{h.placed_reason ? ` — ${h.placed_reason}` : ''}</span>
            <Badge tone={h.active ? 'amber' : 'gray'}>{h.active ? 'Active' : `Released ${h.released_at ? when(h.released_at) : ''}`}</Badge></div>
        )) : <p className="small muted">No holds recorded.</p>}
      </Card>
      <Card title="Case record" subtitle="Obligation and provenance">
        {kv([['Case', <span className="mono">{d.case_ref}</span>], ['Obligation', humanize(d.obligation_type)], ['Source request', d.source_request_ref ?? '—'],
          ['Market', d.market], ['Priority', String(d.priority ?? '—')], ['Source', `${humanize(d.source_type)}${d.is_synthetic ? ' · synthetic' : ''}`], ['Data as of', `${when(d.data_as_of)} SGT`]])}
      </Card>
    </div>
  );
}

function Events({ items, onOpen, attempts }: { items: TimelineItem[]; onOpen: (attemptId: string) => void; attempts: Attempt[] }) {
  if (!items.length) return <Empty title="No case events recorded" />;
  return (
    <div className="activity" data-testid="timeline">
      {items.map((e) => {
        const attempt = e.related_entity_type === 'contact_attempt' ? attempts.find((a) => a.id === e.related_entity_id)
          : e.related_entity_type === 'conversation_session' ? attempts.find((a) => a.session?.session_id === e.related_entity_id) : undefined;
        return (
          <div className="activity-item" key={e.id}>
            <div className="activity-icon"><Icon name={EVENT_ICONS[e.event_type] ?? 'info'} size="sm" /></div>
            <div className="activity-content"><strong>{e.summary}</strong><br /><span className="mono xsmall">{humanize(e.event_type)} · {e.actor_ref}</span>
              <small>{when(e.occurred_at)} SGT{attempt ? <> · <button type="button" className="linkbtn" onClick={() => onOpen(attempt.id)}>Show attempt {attempt.sequence}</button></> : null}</small></div>
          </div>
        );
      })}
      <p className="xsmall muted">{count(items.length)} events.</p>
    </div>
  );
}
