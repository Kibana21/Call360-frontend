// S1-E.1 Voice Lab: the settings tab shows server spend evidence (zero paid), disabled paid access and the
// fail-closed paid provider; a manager can engage the emergency stop with a reason; the playground shows the
// server's refusal reasons for a paid provider; results show said/heard wording and deviation attribution.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());
const T = '2026-11-18T10:00:00Z';
const USER = { ...ME, roles: ['USER'], permissions: ['dashboard.read', 'voicelab.use'] };
const MANAGER = { ...ME, roles: ['ADMIN'], permissions: ['dashboard.read', 'admin.users.read', 'voicelab.manage'] };
const rate = (i: string | null, o: string | null, basis = 'b', sess = '0') => ({ input_usd_per_audio_min: i, output_usd_per_audio_min: o, session_usd_per_min: sess, verified_on: '2026-11-18', basis, source: 's' });
const budget = (c: string) => ({ spend_class: c, overall_usd: '10', daily_usd: '2', per_experiment_usd: '1', max_concurrent_sessions: 1, interactive_max_s: 300,
  idle_timeout_s: 15, basis: 'Owner-proposed initial configuration', updated_by: null, updated_at: null, row_version: 1,
  usage: { overall: '0', daily: '0', held: '0', reconciled: '0', active: 0, reservations: 0 } });
const SETTINGS = (manage: boolean, kill = false) => ({
  control: { kill_switch: kill, kill_reason: kill ? 'Drill' : null, paid_enabled: false, retries_enabled: false, scheduling_enabled: false, updated_by: null, updated_at: null, row_version: 1 },
  budgets: [budget('SIMULATED'), budget('PAID')],
  providers: [
    { code: 'MOCK', label: 'Mock voice provider (keyless)', spend_class: 'NONE', available: true, reason: 'Local mock', models: ['mock-fixed-message-1'], voices: ['synthetic-fixed'], rate_card: rate('0', '0'), network: false },
    { code: 'AZURE_OPENAI_GPT_LIVE', label: 'Azure OpenAI GPT-Live (preferred, paid)', spend_class: 'PAID', available: false, reason: 'Not configured on this server: no verified Azure price', models: [], voices: ['marin', 'quartz'], rate_card: rate(null, null, 'UNKNOWN', '0'), network: true, vendor: 'AZURE', preferred: true, hidden: false },
    { code: 'OPENAI_GPT_LIVE', label: 'OpenAI GPT-Live (direct, paid)', spend_class: 'PAID', available: false, reason: 'Disabled: VOICE_LAB_GPT_LIVE_MODE is not LIVE', models: ['gpt-live-1'], voices: ['marin', 'quartz'], rate_card: rate('0', '0', 'verified', '0.05'), network: true, vendor: 'OPENAI', preferred: false, hidden: false },
  ],
  paid_spend: { paid_reservations: 0, paid_usd: '0', paid_sessions: 0, paid_experiments: 0 }, history: [], authorisations: [] as unknown[],
  gpt_live: { mode: 'DISABLED', api_key_configured: false, endpoint_host: 'api.openai.com', mock_endpoint_configured: false, mock_profile: 'AZURE', close_timeout_s: 5, protocol_notes: 'notes' }, retention_hours: 168,
  azure: { mode: 'DISABLED', endpoint_host: null, deployment: null, auth: 'API_KEY', credential_configured: false, entra_available: false, entra_scope: 'https://ai.azure.com/.default', audio_rate: 24000,
    deployment_type: null, region: null, price_usd_per_min: null, price_source: null, price_verified_on: null, missing: ['VOICE_LAB_AZURE_GPT_LIVE_MODE is not LIVE', 'no verified Azure price'] },
  recording_available: true, transcription_available: true, mock_message: ['Hello.'], can_manage: manage, note: 'n',
});
const PROMPT = { id: 'p1', prompt_ref: 'LAB-P-0001', name: 'Paid try', created_by: 'u', created_at: T, versions: [{ id: 'v1', version_no: 1, system_prompt: 's',
  turn_instructions: [], provider: 'OPENAI_GPT_LIVE', model: 'gpt-live-1', voice: 'marin', parameters: {}, change_note: 'Initial version', sha256: 'a'.repeat(64), created_by: 'u', created_at: T }] };

describe('Voice Lab', () => {
  it('shows zero paid spend, the fail-closed paid provider and lets a manager engage the emergency stop', async () => {
    let posted: unknown = null;
    stubApi({ 'GET /api/v1/me': () => json(200, MANAGER), 'GET /api/v1/voice-lab/settings': () => json(200, SETTINGS(true)),
      'POST /api/v1/voice-lab/kill-switch': async (r) => { posted = await r.json(); return json(200, SETTINGS(true, true).control); } });
    renderAt(<App />, '/voice-lab');
    const spend = await screen.findByTestId('lab-paid-spend');
    expect(spend).toHaveTextContent('USD 0.0000');
    expect(screen.getByTestId('lab-paid-switch-state')).toHaveTextContent('Off (default)');
    expect(screen.getByTestId('lab-gpt-config')).toHaveTextContent('Not configured');
    expect(screen.getByTestId('lab-gpt-config')).toHaveTextContent('USD 0.05 per minute, billed per second');
    expect(screen.getByTestId('lab-azure-rate')).toHaveTextContent('Unknown — every Azure session is refused (fail closed)');
    expect(screen.getByTestId('lab-auth-issue')).toHaveTextContent('price unknown'); // Azure (preferred) has no verified price
    await userEvent.selectOptions(screen.getByTestId('lab-auth-provider'), 'OPENAI_GPT_LIVE');
    expect(screen.getByTestId('lab-auth-issue')).toHaveTextContent('Issue (up to USD 0.1000)'); // 120 s × 0.05 / min
    expect(screen.queryByTestId('lab-tab-playground')).toBeNull(); // a manager without voicelab.use cannot run sessions
    await userEvent.type(screen.getByTestId('lab-kill-reason'), 'Emergency drill');
    await userEvent.click(screen.getByTestId('lab-kill-toggle'));
    await waitFor(() => expect(posted).toEqual({ engaged: true, reason: 'Emergency drill' }));
  });

  it('shows the server refusal reasons when a paid provider session is started', async () => {
    stubApi({ 'GET /api/v1/me': () => json(200, USER), 'GET /api/v1/voice-lab/settings': () => json(200, SETTINGS(false)),
      'GET /api/v1/voice-lab/prompts': () => json(200, { items: [PROMPT] }),
      'POST /api/v1/voice-lab/sessions': () => json(409, { code: 'PAID_DISABLED', message: 'Refused by Voice Lab cost controls', retryable: false,
        details: [{ message: 'PAID_DISABLED: paid providers are disabled (no paid access without separate authorisation)' }] }) });
    const media = { getUserMedia: vi.fn(async () => ({ getTracks: () => [], getAudioTracks: () => [] })) };
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: media });
    renderAt(<App />, '/voice-lab');
    await waitFor(() => expect(screen.getByTestId('lab-estimate')).toHaveTextContent('USD 0.1000')); // 120 s smoke-test maximum
    expect(screen.getByTestId('lab-paid-note')).toHaveTextContent('none issued');
    await userEvent.click(screen.getByTestId('lab-start'));
    const refusal = await screen.findByTestId('lab-refusal');
    expect(refusal).toHaveTextContent('Refused by Voice Lab cost controls');
    expect(within(refusal).getByText(/PAID_DISABLED: paid providers are disabled/)).toBeVisible();
  });
});
