// Voice Studio (`/voice-studio`): the backend's voice capability state (API-078) and, in S1-A, a local synthetic
// audio test with the mock provider on a callable Singapore case (`?case=<id>`, e.g. from Call Detail). Transcripts, script-controlled questions and any verification stay unavailable.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/Icon';
import { Forbidden } from '../../components/StateView';
import { Badge, Card, PageHead } from '../../components/ui';
import { Region } from '../cases/shared';
import { RecordingBadge } from './RecordingEvidence';
import { VoiceCallPanel } from './VoiceCallPanel';
import { END_REASON_TEXT, SessionStatusBadge, VoiceSessionTimeline } from './VoiceSessionTimeline';

const STATUS: Record<string, [string, 'green' | 'gray' | 'amber']> = {
  AVAILABLE: ['Available', 'green'], NOT_AVAILABLE: ['Not available', 'gray'], DISABLED: ['Disabled', 'gray'],
  NOT_PERFORMED: ['Not performed', 'gray'], NOT_EVALUATED: ['Not evaluated', 'gray'],
};

export function VoiceStudioPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const allowed = can('voice.preflight.read');
  const pre = useQuery({ queryKey: ['voice', 'preflight'], enabled: allowed, queryFn: async () => unwrap(await api.GET('/api/v1/voice/preflight')) });
  const caseParam = params.get('case');
  const caseQuery = useQuery({
    queryKey: ['case', caseParam], enabled: allowed && !!caseParam && can('case.read'),
    queryFn: async () => unwrap(await api.GET('/api/v1/cases/{case_id}', { params: { path: { case_id: caseParam! } } })),
  });
  const history = useQuery({
    queryKey: ['voice-sessions', caseParam], enabled: allowed && !!caseParam && can('case.read'), refetchInterval: 5000,
    queryFn: async () => unwrap(await api.GET('/api/v1/voice/sessions', { params: { query: { case_id: caseParam! } } })),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState<string | null>(null);
  if (!allowed) return <Forbidden />;
  const canStart = can('voice.session.start');
  const resumable = history.data?.items.find((h) => h.can_resume && h.session_id !== resumeDismissed) ?? null;
  return (
    <>
      <PageHead eyebrow="Browser callback" title="Voice Studio"
        description="Local, full-duplex browser audio with a mock voice provider (S1-A), persisted sessions (S1-B) optional consent-gated recording (S1-C) and, after a recorded session, a local machine transcript with synchronised playback in Call Detail (S1-D). The mock speaks only a fixed synthetic test message; it asks no questions and verifies nothing." />
      <div className="topnotice" role="note"><div className="row"><Icon name="info" size="sm" />
        <span><strong>TEST MODE · synthetic data only.</strong> No real customer is called, audio is recorded only if you choose to record a session, and no session can verify a customer or a case. Stage 0 governance sign-off is still pending.</span></div></div>
      <Region query={pre} label="voice availability">
        {() => {
          const p = pre.data!;
          const chosen = caseParam ? (caseQuery.data ? { id: caseQuery.data.case_id, ref: caseQuery.data.case_ref, callable: caseQuery.data.callable, blockers: caseQuery.data.callable_blockers } : null) : null;
          return (
            <div className="stack" style={{ gap: 18 }}>
              {canStart ? (
                <Card title="Case for the test session" subtitle="Only cases that pass the Call Detail pre-check can be used; holds are never bypassed.">
                  <label className="form-label" htmlFor="vs-case">Callable synthetic case</label>
                  <select id="vs-case" className="field labelled" value={caseParam ?? ''} style={{ maxWidth: 420 }}
                    onChange={(e) => setParams(e.target.value ? { case: e.target.value } : {})}>
                    <option value="">Choose a case</option>
                    {caseParam && !p.callable_cases.some((c) => c.case_id === caseParam) && chosen ? <option value={caseParam}>{chosen.ref}</option> : null}
                    {p.callable_cases.map((c) => <option key={c.case_id} value={c.case_id}>{c.case_ref} · {c.state.replace(/_/g, ' ').toLowerCase()}</option>)}
                  </select>
                  {chosen && !chosen.callable ? (
                    <div className="form-error" role="alert" data-testid="voice-not-callable">This case cannot be called: {chosen.blockers.join(', ')}.</div>
                  ) : null}
                </Card>
              ) : null}
              {canStart && chosen?.callable && resumable ? (
                <div className="topnotice" role="status" data-testid="voice-resumable">
                  <span>Your earlier session <strong className="mono">{resumable.attempt_ref}</strong> is {resumable.status === 'INTERRUPTED' ? 'disconnected' : 'waiting to connect'}. Resume it within 30 seconds of the disconnection, or it is ended automatically.</span>
                </div>
              ) : null}
              {canStart && chosen?.callable ? <VoiceCallPanel key={chosen.id} caseId={chosen.id} caseRef={chosen.ref} testMessage={p.test_message}
                notice={p.recording_notice ?? null} resumeId={resumable?.session_id} onResumeHandled={() => setResumeDismissed(resumable?.session_id ?? null)} /> : null}
              {chosen && history.data ? (
                <Card title={`Voice session history · ${chosen.ref}`} subtitle="Persisted browser test sessions for this case, newest first" pad={false}>
                  {history.data.items.length === 0 ? <p className="small muted" style={{ padding: '0 19px 16px' }}>No sessions yet.</p> : (
                    <div className="table-wrap">
                      <table className="data-table" data-testid="voice-history">
                        <caption className="sr-only">Voice sessions for {chosen.ref}</caption>
                        <thead><tr><th scope="col">Session</th><th scope="col">Status</th><th scope="col">Started</th><th scope="col">Final reason</th><th scope="col">Recording</th>
                          <th scope="col">Interruptions</th><th scope="col">Events</th><th scope="col"><span className="sr-only">Timeline</span></th></tr></thead>
                        <tbody>
                          {history.data.items.map((h) => (
                            <tr key={h.session_id}>
                              <td className="mono">{h.attempt_ref}<div className="xsmall muted">{h.yours ? 'you' : h.started_by}</div></td>
                              <td><SessionStatusBadge status={h.status} /></td>
                              <td>{h.started_at ? new Date(h.started_at).toLocaleString('en-SG') : '—'}</td>
                              <td>{h.end_reason ? END_REASON_TEXT[h.end_reason] ?? h.end_reason : '—'}</td>
                              <td><RecordingBadge status={h.recording.status} /></td>
                              <td>{h.interruptions}</td><td>{h.events_total}</td>
                              <td style={{ textAlign: 'right' }}><button type="button" className="linkbtn" onClick={() => setOpenId(openId === h.session_id ? null : h.session_id)}
                                aria-expanded={openId === h.session_id} aria-label={`Timeline of ${h.attempt_ref}`}>{openId === h.session_id ? 'Hide' : 'Timeline'}</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              ) : null}
              {openId ? <VoiceSessionTimeline sessionId={openId} title="Session timeline" /> : null}
              <Card title="Capabilities" subtitle={`Reported by the backend · ${p.reason}`} pad={false}>
                <div className="table-wrap">
                  <table className="data-table" data-testid="voice-capabilities" style={{ whiteSpace: 'normal' }}>
                    <caption className="sr-only">Voice capabilities</caption>
                    <thead><tr><th scope="col">Capability</th><th scope="col">Status</th><th scope="col">Stage</th><th scope="col">Reason</th></tr></thead>
                    <tbody>
                      {p.capabilities.map((c) => (
                        <tr key={c.code}><td className="strong">{c.label}</td>
                          <td><Badge tone={STATUS[c.status]?.[1] ?? 'gray'}>{STATUS[c.status]?.[0] ?? c.status}</Badge></td>
                          <td>{c.stage}</td><td className="small">{c.reason}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          );
        }}
      </Region>
    </>
  );
}
