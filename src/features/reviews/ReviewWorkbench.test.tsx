// F7 — Review Workbench and Voice Studio: server-filtered findings, read-only detail with evidence and context,
// severity apart from selection risk, no fabricated review outcome, disabled S3/S1 actions, permission states.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';
import { micErrorMessage } from '../voice/useVoiceSession';

afterEach(() => vi.unstubAllGlobals());

const USER = { ...ME, roles: ['USER'], permissions: ['dashboard.read', 'case.read', 'queue.read', 'policy.read', 'voice.preflight.read'] };
const item = (n: number, severity: string, extra: Record<string, unknown> = {}) => ({
  id: `f${n}`, finding_ref: `FND-2026-0000${n}`, category: 'FACT_MISMATCH', severity, material: ['HIGH', 'CRITICAL'].includes(severity),
  status: 'OPEN', origin: 'RULE_EVALUATION', record_origin: 'SYNTHETIC_SEED', raised_at: '2026-10-01T02:00:00Z', review_assigned_at: null,
  review_closed_at: null, reviewer_assigned: false, case_id: `c${n}`, case_ref: `CB-2026-1000${n}`, case_state: 'AWAITING_REVIEW',
  policy_id: `p${n}`, policy_ref: `POL-SG-00000${n}`, sale_event_id: `s${n}`, sale_ref: `SALE-SG-00000${n}`, selection_risk_band: 'LOW',
  evidence: { question_code: 'Q-PREMIUM-TERM-YEARS', question_wording: 'For how many years…', controls: ['SYN-CTRL-04'], answer_state: 'ANSWERED',
    typed_value: { value: 5 }, verbatim_redacted: null, rule_ref: 'NUMERIC_MATCH', rule_version: '1', rule_expected: { value: 10 },
    rule_observed: { value: 5 }, rule_result: 'FAIL', transcript: 'NOT_AVAILABLE', recording: 'NOT_AVAILABLE', label: 'Seeded synthetic example' },
  ...extra,
});
const QUEUE = { items: [item(1, 'CRITICAL'), item(2, 'LOW')], total: 2, limit: 10, offset: 0, markets: ['SG'], material_severities: ['CRITICAL', 'HIGH'],
  facets: { severity: { CRITICAL: 1, LOW: 1 }, status: { OPEN: 2 }, category: { FACT_MISMATCH: 2 }, origin: { RULE_EVALUATION: 2 } } };

describe('Review Workbench', () => {
  it('shows findings with evidence and context, severity apart from selection risk, and no review outcome', async () => {
    const seen: string[] = [];
    stubApi({ 'GET /api/v1/me': () => json(200, USER), 'GET /api/v1/review-queue': (r) => { seen.push(new URL(r.url).search); return json(200, QUEUE); } });
    renderAt(<App />, '/reviews');
    const detail = await screen.findByTestId('finding-detail');
    expect(detail).toHaveTextContent('FND-2026-00001');
    expect(detail).toHaveTextContent('Critical severity');
    expect(within(detail).getByText('Why the case was selected — not a finding')).toBeInTheDocument();
    expect(detail).toHaveTextContent('NUMERIC_MATCH v1 · Fail');
    expect(detail).toHaveTextContent('10 · 5');
    expect(detail).toHaveTextContent('No review decision recorded');
    expect(detail).toHaveTextContent('Not available — recordings are captured from Stage S1');
    expect(within(detail).getByTestId('open-call-detail')).toHaveAttribute('href', '/cases/c1');
    expect(within(detail).getByRole('link', { name: 'POL-SG-000001' })).toHaveAttribute('href', '/policies/p1?sale=s1');
    for (const name of ['Confirm', 'Reject', 'Send to checker']) expect(within(detail).getByRole('button', { name })).toBeDisabled();
    await userEvent.click(within(screen.getByTestId('review-list')).getByRole('button', { name: /FND-2026-00002/ }));
    expect(screen.getByTestId('finding-detail')).toHaveTextContent('FND-2026-00002');
    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'CRITICAL');
    await waitFor(() => expect(seen.at(-1)).toContain('severity=CRITICAL'));
    await userEvent.click(screen.getByRole('tab', { name: 'All findings' }));
    await waitFor(() => expect(seen.at(-1)).toContain('queue=ALL'));
  });

  it('shows an empty queue and the unauthorized state', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, USER), 'GET /api/v1/review-queue': () => json(200, { ...QUEUE, items: [], total: 0 }) });
    const { unmount } = renderAt(<App />, '/reviews');
    expect(await screen.findByText('No findings are awaiting review')).toBeInTheDocument();
    unmount();
    stubApi({ 'GET /api/v1/me': () => json(200, { ...USER, permissions: ['dashboard.read'] }) });
    renderAt(<App />, '/reviews');
    expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
  });
});

describe('Voice Studio (S1-A)', () => {
  const capability = (code: string, status: string) => ({ code, label: code, status, reason: 'r', stage: 'S1-A' });
  const PRE = (start: boolean) => ({
    status: start ? 'AVAILABLE' : 'NOT_AVAILABLE', reason: start ? 'Local synthetic audio test' : 'Not available to your role', stage: 'S1-A',
    provider: 'MOCK', data_policy: 'SYNTHETIC_ONLY', test_message: ['Hello. This is a Call360 synthetic audio test.'],
    capabilities: [capability('VOICE_SESSION', start ? 'AVAILABLE' : 'NOT_AVAILABLE'), capability('RECORDING', 'DISABLED'), capability('IDENTITY', 'NOT_PERFORMED')],
    callable_cases: start ? [{ case_id: 'c1', case_ref: 'CB-2026-10003', state: 'READY' }] : [],
  });
  const CASE = (callable: boolean) => ({ case_id: 'c1', case_ref: 'CB-2026-10003', callable, callable_blockers: callable ? [] : ['HOLD:AWAITING_SCRIPT_ASSIGNMENT'] });

  it('without the start permission shows capabilities only and never touches the microphone', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    stubApi({ 'GET /api/v1/me': () => json(200, USER), 'GET /api/v1/voice/preflight': () => json(200, PRE(false)) });
    renderAt(<App />, '/voice-studio');
    expect(await screen.findByTestId('voice-capabilities')).toHaveTextContent('Disabled');
    expect(screen.queryByTestId('voice-start')).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('a denied microphone stops before any session is created', async () => {
    const getUserMedia = vi.fn(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); });
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const created = vi.fn(() => json(201, {}));
    stubApi({ 'GET /api/v1/me': () => json(200, { ...USER, permissions: [...USER.permissions, 'voice.session.start'] }),
      'GET /api/v1/voice/preflight': () => json(200, PRE(true)), 'GET /api/v1/cases/c1': () => json(200, CASE(true)),
      'POST /api/v1/voice/sessions': created });
    renderAt(<App />, '/voice-studio?case=c1');
    expect(await screen.findByTestId('voice-message')).toHaveTextContent('Call360 synthetic audio test');
    await userEvent.click(screen.getByTestId('voice-start'));
    expect(await screen.findByTestId('voice-error')).toHaveTextContent('Microphone access was blocked');
    expect(created).not.toHaveBeenCalled();
    expect(screen.getByTestId('voice-start')).toBeEnabled(); // can retry after allowing the microphone
  });

  it('a held case cannot be used for a test session', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, { ...USER, permissions: [...USER.permissions, 'voice.session.start'] }),
      'GET /api/v1/voice/preflight': () => json(200, PRE(true)), 'GET /api/v1/cases/c1': () => json(200, CASE(false)) });
    renderAt(<App />, '/voice-studio?case=c1');
    expect(await screen.findByTestId('voice-not-callable')).toHaveTextContent('HOLD:AWAITING_SCRIPT_ASSIGNMENT');
    expect(screen.queryByTestId('voice-start')).toBeNull();
  });

  it('explains microphone failures', () => {
    expect(micErrorMessage({ name: 'NotFoundError' })).toMatch(/No microphone/);
    expect(micErrorMessage({ name: 'NotReadableError' })).toMatch(/in use/);
  });
});
