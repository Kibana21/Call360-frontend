// S1-B — the persisted session record: status, references, final reason, counts and the ordered ledger.
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, renderAt, stubApi } from '../../test/render';
import { VoiceSessionTimeline } from './VoiceSessionTimeline';

afterEach(() => vi.unstubAllGlobals());

const event = (seq: number, event_type: string, extra: Record<string, unknown> = {}) => ({
  seq, event_type, source: 'SERVER', occurred_at: '2026-11-17T01:00:00Z', client_seq: null, out_of_order: false, details: {}, ...extra,
});

describe('VoiceSessionTimeline', () => {
  it('shows the stored session with its ordered events and final reason', async () => {
    stubApi({ 'GET /api/v1/voice/sessions/a1': () => json(200, {
      session_id: 'a1', attempt_ref: 'AT-2026-10048-4', session_ref: 'SS-2026-10048-4', case_id: 'c1', case_ref: 'CB-2026-10048',
      status: 'FINALIZED', started_at: '2026-11-17T01:00:00Z', ended_at: '2026-11-17T01:01:00Z', end_reason: 'STOPPED_BY_USER',
      responses: 2, interruptions: 1, events_total: 5, started_by: 'Ada', yours: true, can_resume: false,
      identity_verification: 'NOT_PERFORMED', compliance_outcome: 'NOT_EVALUATED', recording: 'DISABLED',
      events: [event(1, 'SESSION_REQUESTED'), event(2, 'CONNECTED'), event(3, 'BARGE_IN', { details: { response: 1 } }),
        event(4, 'MIC_UNMUTED', { source: 'CLIENT', client_seq: 1, out_of_order: true }), event(5, 'ENDED', { details: { reason: 'STOPPED_BY_USER' } })],
    }) });
    renderAt(<VoiceSessionTimeline sessionId="a1" />);
    expect(await screen.findByTestId('voice-session-record')).toHaveTextContent('Completed');
    expect(screen.getByTestId('voice-session-reason')).toHaveTextContent('Stopped by the user');
    const items = screen.getByTestId('voice-session-events').querySelectorAll('li');
    expect([...items].map((li) => li.textContent?.match(/#(\d+)/)?.[1])).toEqual(['1', '2', '3', '4', '5']);
    expect(items[2]).toHaveTextContent('Interrupted by the caller — playback cleared · response 1');
    expect(items[3]).toHaveTextContent('arrived late');
    expect(screen.getByTestId('voice-session-record')).toHaveTextContent('Not performed · Not evaluated');
  });
});
