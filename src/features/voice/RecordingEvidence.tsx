// S1-C: a session's recording evidence as stored by the server (EVD-003): derived status, the consent decision and,
// per track, media status, computed coverage, duration, chunk count, gaps and checksums. Gaps are listed as the
// server found them; nothing is filled in. Audio retrieval here is an authorised download; S1-D playback lives in SessionPlayback.
import type { components } from '../../api/generated/schema';
import { Badge, type Tone } from '../../components/ui';

export type RecordingSummary = components['schemas']['RecordingSummary'];
type RecordingTrack = components['schemas']['RecordingTrack'];

export const RECORDING_STATUS: Record<string, [string, Tone, string]> = {
  NOT_RECORDED: ['Not recorded', 'gray', 'No audio was recorded for this session.'],
  RECORDING: ['Recording', 'red', 'Capture or upload in progress.'],
  COMPLETE: ['Recording complete', 'green', 'Both tracks stored with no gaps.'],
  PARTIAL: ['Recording partial', 'amber', 'Some audio is stored, with gaps listed below. Missing audio is never filled in.'],
  FAILED: ['Recording failed', 'red', 'Recording was consented but no audio was stored.'],
  PURGED: ['Recording deleted (retention)', 'gray', 'Audio was removed at the local retention limit; its manifest and checksums remain.'],
};
const TRACK_LABEL: Record<string, string> = { MIC: 'Microphone', PROVIDER_PLAYBACK: 'Provider playback (as rendered by the browser)' };
const GAP_TEXT: Record<string, string> = {
  MISSING: 'chunk missing', UPLOAD_FAILED: 'chunk could not be uploaded', DISCONTINUITY: 'audio discontinuity',
  SESSION_INTERRUPTED: 'connection interrupted before this segment', END_NOT_CONFIRMED: 'end of segment not confirmed by the browser',
  CAPTURE_INTERRUPTED: 'capture ended early', OBJECT_UNREADABLE: 'stored chunk unreadable',
};
const REASON_TEXT: Record<string, string> = {
  MIC_DEVICE_LOST: 'microphone lost', CONNECTION_LOST: 'connection lost', PAGE_CLOSED: 'page closed', UPLOAD_FAILED: 'upload failed',
  CAPTURE_ERROR: 'capture error',
};

export function RecordingBadge({ status }: { status: string }) {
  const [label, tone] = RECORDING_STATUS[status] ?? [status, 'gray' as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}

function gapText(g: RecordingTrack['gaps'][number]): string {
  const where = `segment ${g.segment}${g.seq ? `, chunk ${g.seq}` : ''}`;
  return `${GAP_TEXT[g.type] ?? g.type}${g.reason ? ` (${REASON_TEXT[g.reason] ?? g.reason})` : ''} — ${where}`;
}

export function RecordingEvidence({ rec, downloadBase }: { rec: RecordingSummary; downloadBase?: string | null }) {
  const [, , help] = RECORDING_STATUS[rec.status] ?? ['', 'gray', ''];
  const consent = rec.consent === 'GRANTED' ? 'Granted' : rec.consent === 'DECLINED' ? 'Declined' : 'Not asked';
  return (
    <div className="stack" style={{ gap: 10 }} data-testid="recording-evidence">
      <div className="row wrap" style={{ gap: 8 }}>
        <span data-testid="recording-status"><RecordingBadge status={rec.status} /></span>
        <span className="xsmall muted">Consent: <strong data-testid="recording-consent">{consent}</strong>
          {rec.consent_at ? ` · ${new Date(rec.consent_at).toLocaleString('en-SG')}` : ''}{rec.notice_version ? ` · notice ${rec.notice_version} (test only)` : ''}</span>
      </div>
      <p className="xsmall muted" style={{ margin: 0 }}>{help}</p>
      {rec.tracks.map((t) => (
        <section key={t.track} className="rec-track" data-testid={`recording-track-${t.track}`} aria-label={TRACK_LABEL[t.track] ?? t.track}>
          <div className="row wrap between" style={{ gap: 8 }}>
            <strong className="small">{TRACK_LABEL[t.track] ?? t.track}</strong>
            {downloadBase && t.media_status === 'AVAILABLE'
              ? <a className="link small" href={`${downloadBase}/${t.track}/audio`} download data-testid={`recording-download-${t.track}`}>Download WAV</a> : null}
          </div>
          <dl className="kv rw-kv">
            <dt>Status</dt><dd>{t.media_status.replace(/_/g, ' ').toLowerCase()}{t.coverage !== 'PENDING' ? ` · ${t.coverage.toLowerCase()}` : ''}</dd>
            <dt>Stored</dt><dd>{(t.duration_ms / 1000).toFixed(1)} s · {t.chunks_stored} chunk{t.chunks_stored === 1 ? '' : 's'} · <span className="mono">{t.codec}</span></dd>
            <dt>Gaps</dt><dd>{t.gaps.length ? <ul className="plain-list">{t.gaps.map((g, i) => <li key={i}>{gapText(g)}</li>)}</ul> : 'None'}</dd>
            <dt>Content SHA-256</dt><dd className="mono" title={t.content_sha256 ?? undefined}>{t.content_sha256 ? `${t.content_sha256.slice(0, 16)}…` : '—'}</dd>
            <dt>Asset</dt><dd className="mono">{t.asset_ref}{t.purged_at ? ` · audio deleted ${new Date(t.purged_at).toLocaleString('en-SG')}` : ''}</dd>
          </dl>
        </section>
      ))}
    </div>
  );
}
