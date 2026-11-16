// Administration → System (CP0.1B-3; API-026): the Administration dashboard counts and the platform health checks
// reported by the backend — database, migration head, synthetic-only data, audit hash chain, protection keys — plus
// the honest status of capabilities that arrive later (mock upstream, browser voice).
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../api/client';
import { Badge, Button, Card, type Tone } from '../../components/ui';
import { Region } from '../cases/shared';
import { adminWhen } from './shared';

const TONES: Record<string, Tone> = { OK: 'green', WARN: 'amber', FAIL: 'red', NOT_AVAILABLE: 'gray' };
const LABELS: Record<string, string> = { OK: 'OK', WARN: 'Warning', FAIL: 'Failed', NOT_AVAILABLE: 'Not available' };
const COUNTS: [string, string][] = [
  ['users_active', 'Active users'], ['users_disabled', 'Disabled users'], ['active_admins', 'Active administrators'],
  ['groups', 'Groups'], ['active_sessions', 'Active sessions'], ['audit_events_24h', 'Audit events (24 h)'],
];

export function SystemPage() {
  const health = useQuery({ queryKey: ['admin', 'system-health'], queryFn: async () => unwrap(await api.GET('/api/v1/admin/system-health')) });
  return (
    <Region query={health} label="system health">
      {() => {
        const h = health.data!;
        return (
          <div className="stack" style={{ gap: 19 }}>
            <div className="layout sys-counts" aria-label="Administration summary">
              {COUNTS.map(([k, label]) => (
                <div key={k} className="card kpi" data-testid={`count-${k}`}>
                  <div className="kpi-top"><span>{label}</span></div>
                  <div className="kpi-number">{h.counts[k] ?? '—'}</div>
                </div>
              ))}
            </div>
            <div className="layout cols-2">
              <Card title="Health checks" subtitle={`Checked ${adminWhen(h.checked_at)} SGT`} pad={false}
                aside={<Button tiny icon="refresh" onClick={() => void health.refetch()}>Re-check</Button>}>
                <div className="table-wrap">
                  <table className="data-table" data-testid="health-checks" style={{ whiteSpace: 'normal' }}>
                    <caption className="sr-only">Health checks</caption>
                    <thead><tr><th scope="col">Check</th><th scope="col">Status</th><th scope="col">Detail</th></tr></thead>
                    <tbody>
                      {h.checks.map((c) => (
                        <tr key={c.code}><td className="strong">{c.label}</td><td><Badge tone={TONES[c.status] ?? 'gray'}>{LABELS[c.status] ?? c.status}</Badge></td><td className="small">{c.detail}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title="Platform" subtitle="Environment facts reported by the server">
                <dl className="kv sys-kv">
                  <dt>Stage</dt><dd>{h.current_stage}</dd>
                  <dt>Environment</dt><dd>{h.app_env}</dd>
                  <dt>Data policy</dt><dd>{h.data_policy}</dd>
                  <dt>Enabled markets</dt><dd>{h.enabled_markets.join(', ')}</dd>
                  <dt>Migration head</dt><dd className="mono">{h.migration_head ?? '—'}</dd>
                  <dt>OpenAPI SHA-256</dt><dd className="mono" data-testid="openapi-sha">{h.openapi_sha256 || '—'}</dd>
                  <dt>Audit chain head</dt><dd className="mono">{h.audit_chain_head ?? '—'}</dd>
                  <dt>Audit events</dt><dd>{h.audit_events}</dd>
                </dl>
              </Card>
            </div>
          </div>
        );
      }}
    </Region>
  );
}
