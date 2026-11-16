// S1-B: a persisted voice session as stored by the backend — status, references, counts and the ordered event
// ledger (metadata only: no audio, transcript or microphone content). Used by Voice Studio and Call Detail.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { Badge, Card, type Tone } from '../../components/ui';
import { Region } from '../cases/shared';

export type VoiceSessionStatus = components['schemas']['VoiceSessionStatus'];

export const SESSION_STATUS: Record<string, [string, Tone]> = {
  PENDING_CONNECTION: ['Waiting to connect', 'blue'], NOT_CONNECTED: ['Never connected', 'gray'], CREATED: ['Live', 'green'],
  INTERRUPTED: ['Disconnected — can resume for 30 s', 'amber'], FINALIZING: ['Finalising', 'blue'],
  FINALIZED: ['Completed', 'gray'], ABORTED: ['Ended abnormally', 'red'],
};
export const END_REASON_TEXT: Record<string, string> = {
  STOPPED_BY_USER: 'Stopped by the user', MAX_DURATION: 'Reached the 5-minute limit', IDLE_TIMEOUT: 'No microphone audio for 20 seconds',
  ABANDONED: 'Not resumed after the connection was lost', ORPHANED: 'No live connection remained', BACKEND_RESTART: 'The server restarted',
  MIC_DEVICE_LOST: 'The microphone was disconnected', PAGE_CLOSED: 'The page was closed',
};
const EVENT_TEXT: Record<string, string> = {
  SESSION_REQUESTED: 'Session requested', CONNECTED: 'Connected · session pins fixed', RESUMED: 'Reconnected (resumed)',
  PROVIDER_RESPONSE_STARTED: 'Mock voice started speaking', PROVIDER_RESPONSE_COMPLETED: 'Mock voice finished the message',
  BARGE_IN: 'Interrupted by the caller — playback cleared', USER_TURN_ENDED: 'Caller finished speaking', MIC_MUTED: 'Microphone muted',
  MIC_UNMUTED: 'Microphone unmuted', CLIENT_NOTICE: 'Browser notice', DISCONNECTED: 'Connection lost', STOP_REQUESTED: 'Stop requested',
  ENDED: 'Session ended', ABANDONED: 'Abandoned', FAILED: 'Never connected',
};

export function SessionStatusBadge({ status }: { status: string }) {
  const [label, tone] = SESSION_STATUS[status] ?? [status, 'gray' as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function VoiceSessionTimeline({ sessionId, live = false, title = 'Persisted session' }: { sessionId: string; live?: boolean; title?: string }) {
  const q = useQuery({
    queryKey: ['voice-session', sessionId],
    queryFn: async () => unwrap(await api.GET('/api/v1/voice/sessions/{session_id}', { params: { path: { session_id: sessionId } } })),
    refetchInterval: live ? 2000 : false,
  });
  const wasLive = useRef(live);
  useEffect(() => { // when the session stops being live, fetch its final stored state once more
    if (wasLive.current && !live) {
      const t = setTimeout(() => void q.refetch(), 400);
      wasLive.current = live;
      return () => clearTimeout(t);
    }
    wasLive.current = live;
    return undefined;
  }, [live, q]);
  return (
    <Card title={title} subtitle="Stored by the server: status, references and the ordered event ledger (no audio or speech)">
      <Region query={q} label="voice session">
        {() => {
          const s = q.data!;
          return (
            <div className="stack" style={{ gap: 12 }} data-testid="voice-session-record">
              <div className="row wrap" style={{ gap: 8 }}>
                <SessionStatusBadge status={s.status} />
                <span className="mono small">{s.attempt_ref}{s.session_ref ? ` · ${s.session_ref}` : ''}</span>
                <span className="xsmall muted">started by {s.yours ? 'you' : s.started_by}</span>
              </div>
              <dl className="kv rw-kv">
                <dt>Started</dt><dd>{s.started_at ? new Date(s.started_at).toLocaleString('en-SG') : '—'}</dd>
                <dt>Ended</dt><dd>{s.ended_at ? new Date(s.ended_at).toLocaleString('en-SG') : '—'}</dd>
                <dt>Final reason</dt><dd data-testid="voice-session-reason">{s.end_reason ? END_REASON_TEXT[s.end_reason] ?? s.end_reason : '—'}</dd>
                <dt>Responses · interruptions</dt><dd><span data-testid="voice-session-responses">{s.responses}</span> · <span data-testid="voice-session-interruptions">{s.interruptions}</span></dd>
                <dt>Identity · compliance</dt><dd>Not performed · Not evaluated</dd>
                <dt>Recording · transcript</dt><dd>Disabled · Not available</dd>
              </dl>
              <div className="section-label">Event timeline ({s.events_total})</div>
              <ol className="voice-ledger" data-testid="voice-session-events">
                {(s.events ?? []).map((e) => (
                  <li key={e.seq}>
                    <span className="mono xsmall muted">#{e.seq} {time(e.occurred_at)}</span>{' '}
                    <span className="small">{EVENT_TEXT[e.event_type] ?? e.event_type}</span>
                    {e.details.reason ? <span className="xsmall muted"> · {END_REASON_TEXT[String(e.details.reason)] ?? String(e.details.reason)}</span> : null}
                    {e.details.response ? <span className="xsmall muted"> · response {String(e.details.response)}</span> : null}
                    <span className="xsmall muted"> · {e.source.toLowerCase()}</span>
                    {e.out_of_order ? <Badge tone="amber">arrived late</Badge> : null}
                  </li>
                ))}
              </ol>
            </div>
          );
        }}
      </Region>
    </Card>
  );
}
