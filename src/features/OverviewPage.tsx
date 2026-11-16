// Overview (Command Centre), F1: API-030…034 on real, Singapore-scoped data (S0_SCREEN_SPEC "Overview";
// S0_KPI_DEFINITIONS). Every number comes from the server; NOT_MEASURED KPIs render N/A, never a number.
// Each region has its own loading / error state, so one failing region leaves the others usable (partial).
// F2: cards, risk segments, outcome rows and priority rows open Call Explorer with the server's typed drilldown route.
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiFailure, unwrap, type ActivityItem, type AttentionItem, type Kpi, type RiskBucket } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon, type IconName } from '../components/Icon';
import { Empty, ErrorState, Forbidden, Loading } from '../components/StateView';
import { Badge, Button, Card, PageHead, StageChip, type Tone } from '../components/ui';

const RANGES = [7, 30, 90] as const;
const SGT = 'Asia/Singapore';
const OUTCOME_LABELS: Record<string, string> = {
  VERIFIED_COMPLIANT: 'Verified compliant', VERIFIED_WITH_FINDINGS: 'Verified with findings',
  NOT_VERIFIED: 'Not verified', CANCELLED: 'Cancelled', OPEN: 'Open',
};
const OUTCOME_TONES: Record<string, Tone> = {
  VERIFIED_COMPLIANT: 'green', VERIFIED_WITH_FINDINGS: 'amber', NOT_VERIFIED: 'gray', CANCELLED: 'gray', OPEN: 'blue',
};
const BAND_COLORS: Record<string, string> = {
  HIGH: '#c43c4e', MEDIUM: '#e7ab59', LOW: '#3d9879', UNKNOWN: '#8d96a3', NOT_ASSESSED: '#b4c0d4',
};
const BAND_TONES: Record<string, Tone> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'green' };

function localDate(offsetDays: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: SGT }).format(new Date()); // YYYY-MM-DD
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: SGT }).format(new Date(iso));
const day = (iso: string) =>
  new Intl.DateTimeFormat('en-SG', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const count = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-SG'));

export function formatKpi(k: Kpi): string {
  if (k.status === 'NOT_MEASURED') return 'N/A';
  if (k.value == null) return '—';
  if (k.unit === 'percent') return `${k.value.toFixed(1)}%`;
  if (k.unit === 'hours') return `${k.value.toFixed(1)} h`;
  return count(k.value);
}

function failure(error: unknown) {
  return error instanceof ApiFailure ? { status: error.status, ref: error.body?.correlation_id ?? null } : { status: 0, ref: null };
}

function Region({ query, label, children }: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; label: string; children: () => ReactNode;
}) {
  if (query.isPending) return <Loading label={`Loading ${label}…`} />;
  if (query.isError) {
    const f = failure(query.error);
    if (f.status === 403) return <Forbidden />;
    return <ErrorState message={`${label[0]!.toUpperCase()}${label.slice(1)} could not be loaded.`} correlationId={f.ref}
      onRetry={() => void query.refetch()} />;
  }
  return <>{children()}</>;
}

function Definition({ k }: { k: Kpi }) {
  return (
    <details className="kpi-def">
      <summary>Definition</summary>
      <dl className="kv xsmall">
        <dt>Rule</dt><dd>{k.eligibility_rule || '—'}</dd>
        {k.denominator != null ? <><dt>Numerator / denominator</dt><dd>{count(k.numerator)} / {count(k.denominator)}</dd></> : null}
        <dt>Cohort</dt><dd>{k.cohort_basis}</dd>
        <dt>Scope</dt><dd>{k.filter_scope.markets?.join(', ') || 'No market'} · {k.time_zone}</dd>
        <dt>As of</dt><dd>{when(k.data_as_of)} SGT</dd>
      </dl>
    </details>
  );
}

function KpiCard({ k, icon, sub, accent }: { k: Kpi | undefined; icon: IconName; sub?: string; accent?: boolean }) {
  if (!k) return null;
  return (
    <section className={`card kpi${accent ? ' accent' : ''}`} aria-label={k.label}>
      <div className="kpi-top"><span>{k.label}</span><div className="kpi-icon"><Icon name={icon} /></div></div>
      <div className="kpi-number" data-testid={`kpi-${k.definition_id}`}>{formatKpi(k)}</div>
      <div className="kpi-sub">{k.status === 'NOT_MEASURED' ? k.stage_note : sub}</div>
      {k.drilldown.numerator ? (
        <Link className="linkbtn kpi-drill" to={k.drilldown.numerator} data-testid={`drill-${k.definition_id}`}>
          View cases<span className="sr-only">: {k.label} in Call Explorer</span> <span aria-hidden="true">→</span></Link>
      ) : null}
      <Definition k={k} />
    </section>
  );
}

export function OverviewPage() {
  const { me, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const days = RANGES.find((r) => String(r) === params.get('days')) ?? 30;
  const from = localDate(-(days - 1));
  const to = localDate(1);
  const allowed = me?.permissions.includes('dashboard.read') ?? false;

  const kpis = useQuery({
    queryKey: ['dashboard', 'kpis', from, to], enabled: allowed,
    queryFn: async () => unwrap(await api.GET('/api/v1/dashboard/kpis', { params: { query: { from, to } } })),
  });
  const trend = useQuery({
    queryKey: ['dashboard', 'trend'], enabled: allowed,
    queryFn: async () => unwrap(await api.GET('/api/v1/dashboard/trend', { params: { query: { kpi: 'KPI-02', days: 7 } } })),
  });
  const risk = useQuery({
    queryKey: ['dashboard', 'risk'], enabled: allowed,
    queryFn: async () => unwrap(await api.GET('/api/v1/dashboard/risk-distribution')),
  });
  const attention = useQuery({
    queryKey: ['dashboard', 'attention'], enabled: allowed,
    queryFn: async () => unwrap(await api.GET('/api/v1/dashboard/attention', { params: { query: { limit: 8 } } })),
  });
  const activity = useQuery({
    queryKey: ['dashboard', 'activity'], enabled: allowed,
    queryFn: async () => unwrap(await api.GET('/api/v1/dashboard/activity', { params: { query: { limit: 6 } } })),
  });

  if (!me) return null;
  if (!allowed || (kpis.isError && failure(kpis.error).status === 403)) return <Forbidden />;
  const byId = new Map((kpis.data?.items ?? []).map((k) => [k.definition_id, k]));
  const noScope = kpis.data && kpis.data.markets.length === 0;

  return (
    <>
      <div className="topnotice" role="note">
        <div className="row"><Icon name="info" size="sm" />
          <span><strong>Synthetic data:</strong> every record is synthetic: the seeded examples (S0-SEED-1) and transactions submitted through manual intake. Not AIA data or an approved process. Singapore records only.</span>
        </div>
        <Badge tone="blue">Synthetic</Badge>
      </div>
      <PageHead eyebrow="S&C operations" title="Command Centre"
        description="One view of every policy-sale verification obligation, its risk, call progress and verification outcome."
        actions={<>
          <label className="sr-only" htmlFor="ov-range">Reporting range</label>
          <select id="ov-range" className="field" value={days}
            onChange={(e) => setParams((p) => { p.set('days', e.target.value); return p; })}>
            {RANGES.map((r) => <option key={r} value={r}>Last {r} days</option>)}
          </select>
          <Button icon="download" disabled aria-describedby="ov-export-note">Export report</Button>
          <span id="ov-export-note"><StageChip label="Stage S4 — Export" /></span>
          <Button variant="primary" icon="plus" disabled aria-describedby="ov-new-note">New callback case</Button>
          <span id="ov-new-note" className="sr-only">Cases are created through Data Intake in Stage 0.</span>
        </>} />

      {noScope ? (
        <Card><Empty title="No market is assigned to your account">Business data is shown only for Singapore; ask an administrator for Singapore access.</Empty></Card>
      ) : null}

      <div className="layout cols-5" style={{ marginBottom: 19 }}>
        {kpis.isPending ? <div style={{ gridColumn: '1 / -1' }}><Loading label="Loading KPIs…" /></div> : null}
        {kpis.isError ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <ErrorState message="KPIs could not be loaded." correlationId={failure(kpis.error).ref} onRetry={() => void kpis.refetch()} />
          </div>
        ) : null}
        {kpis.data ? <>
          <KpiCard k={byId.get('OPS-01')} icon="files" accent
            sub={`${count(Number(byId.get('OPS-01')?.breakdown.overdue ?? 0))} past due · SLA clock running`} />
          <KpiCard k={byId.get('OPS-02')} icon="clock" sub="Open cases due today (SGT)" />
          <KpiCard k={byId.get('KPI-03')} icon="phone" sub={`Completed / started · last ${days} days`} />
          <KpiCard k={byId.get('OPS-04')} icon="shield" sub="Includes seeded findings awaiting review" />
          <KpiCard k={byId.get('OPS-05')} icon="check"
            sub={`${count(Number(byId.get('OPS-05')?.breakdown.VERIFIED_COMPLIANT ?? 0))} compliant · ${count(Number(byId.get('OPS-05')?.breakdown.VERIFIED_WITH_FINDINGS ?? 0))} with findings · ${days} days`} />
        </> : null}
      </div>

      <div className="layout cols-2" style={{ marginBottom: 19 }}>
        <Card title="Callback activity" subtitle="Contact attempts per day, last seven days (SGT)" aside={<Badge tone="gray">7-day view</Badge>}>
          <Region query={trend} label="callback activity">{() => {
            const pts = trend.data!.points;
            const max = Math.max(1, ...pts.map((p) => p.denominator));
            const total = pts.reduce((s, p) => s + p.denominator, 0);
            return total === 0 ? <Empty title="No contact attempts in the last seven days" /> : <>
              <div className="bars" role="img" aria-label={pts.map((p) => `${day(p.date)}: ${p.denominator} attempts, ${p.numerator} connected`).join('; ')}>
                {pts.map((p) => (
                  <div className="barcol" key={p.date}>
                    <span className="xsmall muted">{p.denominator}</span>
                    <div className="bartrack"><div className={`bar ${p.numerator > 0 ? 'red' : 'navy'}`} style={{ height: `${(p.denominator / max) * 100}%` }} /></div>
                    <span className="barlabel">{day(p.date)}</span>
                  </div>
                ))}
              </div>
              <div className="legend" style={{ marginTop: 12 }}>
                <span><b style={{ background: '#d04355' }} />Days with ≥1 connected attempt</span>
                <span><b style={{ background: '#b4c0d4' }} />No connection</span>
              </div>
            </>;
          }}</Region>
        </Card>
        <Card title="Case distribution by risk" subtitle="Open cases by effective SBQ callback-selection band"
          aside={can('risk.read') ? <Link className="linkbtn" to="/risk-assessments">Assessments<span className="sr-only"> in the SBQ Risk Workbench</span> <span aria-hidden="true">→</span></Link> : null}>
          <Region query={risk} label="risk distribution">{() => <RiskDonut items={risk.data!.items} total={risk.data!.total_open} note={risk.data!.note} />}</Region>
        </Card>
      </div>

      <div className="layout cols-2" style={{ marginBottom: 19 }}>
        <Card title="Priority attention" subtitle="Open cases needing S&C action, highest priority first" pad={false}>
          <Region query={attention} label="priority attention">{() => <AttentionTable items={attention.data!.items} />}</Region>
        </Card>
        <Card title="Recent activity" subtitle="Latest case events (synthetic)">
          <Region query={activity} label="recent activity">{() => <Activity items={activity.data!.items} />}</Region>
        </Card>
      </div>

      <div className="layout cols-3">
        <div style={{ gridColumn: 'span 2' }}>
          <Card title="Verification outcomes" subtitle={`Cases due in the last ${days} days. Outcomes describe the callback verification, never the sale.`}>
            <Region query={kpis} label="outcomes">{() => <Outcomes kpis={byId} />}</Region>
          </Card>
        </div>
        <Card title="KPI register" subtitle="Every Stage 0 measure, with N/A where not yet measurable">
          <Region query={kpis} label="KPI register">{() => <Register items={kpis.data!.items} />}</Region>
        </Card>
      </div>
    </>
  );
}

function RiskDonut({ items, total, note }: { items: RiskBucket[]; total: number; note: string }) {
  if (total === 0) return <Empty title="No open cases in scope" />;
  const C = 2 * Math.PI * 42;
  let offset = 0;
  const arcs = items.filter((b) => b.count > 0).map((b) => {
    const len = (b.count / total) * C;
    const arc = <circle key={b.band} cx="55" cy="55" r="42" fill="none" stroke={BAND_COLORS[b.band] ?? '#999'} strokeWidth="13"
      strokeDasharray={`${len} ${C}`} strokeDashoffset={-offset} />;
    offset += len;
    return arc;
  });
  return (
    <div className="row" style={{ gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="donut">
        <svg viewBox="0 0 110 110" role="img" aria-label={items.map((b) => `${b.label}: ${b.count}`).join('; ')}>
          <circle cx="55" cy="55" r="42" fill="none" stroke="#eef0f4" strokeWidth="13" />{arcs}
        </svg>
        <div className="donut-center"><strong>{count(total)}</strong><span>Open cases</span></div>
      </div>
      <div className="legend-rows" style={{ flex: 1, minWidth: 155 }}>
        {items.map((b) => (
          <div className="legend-row" key={b.band}>
            <Link to={b.drilldown} className="legend-link" aria-label={`${b.label}: view ${b.count} open cases`}><i style={{ background: BAND_COLORS[b.band] ?? '#999' }} />{b.label}</Link>
            <b>{count(b.count)} · {b.share == null ? '—' : `${b.share}%`}</b>
          </div>
        ))}
        <div className="divider" style={{ margin: '4px 0' }} />
        <span className="xsmall muted">{note}</span>
      </div>
    </div>
  );
}

function AttentionTable({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return <Empty title="Nothing needs attention">No open case is overdue, held or awaiting review.</Empty>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">Priority attention</caption>
        <thead><tr><th scope="col">Case / policy</th><th scope="col">Reason</th><th scope="col">Risk</th><th scope="col">Due</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.case_id}>
              <td><Link className="link mono" to={i.route} state={{ from: '/' }} aria-label={`${i.case_ref} Call Detail`}>{i.case_ref}</Link><div className="small muted" style={{ marginTop: 5 }}>{i.policyholder} · {i.policy_ref}</div></td>
              <td className="wrap-cell">{i.reasons.map((r) => r.label).join(' · ')}{i.holds.length ? <div className="xsmall muted">Hold: {i.holds.join(', ')}</div> : null}</td>
              <td>{i.risk_band ? <Badge tone={BAND_TONES[i.risk_band] ?? 'gray'}>{i.risk_band}</Badge> : <Badge tone="gray">Not assessed</Badge>}</td>
              <td className="xsmall">{when(i.due_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EVENT_ICONS: Record<string, IconName> = {
  ATTEMPT_RECORDED: 'phone', SESSION_RECORDED: 'mic', FINDING_RAISED: 'alert', HOLD_PLACED: 'lock', HOLD_RELEASED: 'check',
  SCRIPT_ASSIGNED: 'clipboard', CASE_CREATED: 'files', CASE_VERIFIED: 'check', CASE_CLOSED: 'close', CASE_CANCELLED: 'close',
  RISK_RECORDED: 'target', CONTACTS_SELECTED: 'users', CONTACT_CHANGED: 'edit',
};

function Activity({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <Empty title="No recent activity" />;
  return (
    <div className="activity">
      {items.map((a) => (
        <div className="activity-item" key={a.event_id}>
          <div className="activity-icon"><Icon name={EVENT_ICONS[a.event_type] ?? 'info'} size="sm" /></div>
          <div className="activity-content"><strong>{a.summary}</strong><br /><Link className="linkbtn mono" to={`/cases/${a.case_id}`} state={{ from: '/' }}>{a.case_ref}</Link>
            <small>{when(a.occurred_at)} SGT</small></div>
        </div>
      ))}
    </div>
  );
}

function Outcomes({ kpis }: { kpis: Map<string, Kpi> }) {
  const dist = kpis.get('KPI-15');
  const sla = kpis.get('KPI-10');
  const open = kpis.get('OPS-01');
  if (!dist) return null;
  const counts = (dist.breakdown.counts ?? {}) as Record<string, number>;
  const shares = (dist.breakdown.shares ?? {}) as Record<string, number | null>;
  if (!dist.numerator) return <Empty title="No cases due in this range" />;
  return (
    <>
      <div className="outcome-grid">
        {Object.keys(OUTCOME_LABELS).map((k) => (
          <div className="metricline" key={k}>
            <span>{dist.drilldown.numerator
              ? <Link to={`${dist.drilldown.numerator}&outcome=${k}`} aria-label={`${OUTCOME_LABELS[k]}: view cases`}><Badge tone={OUTCOME_TONES[k] ?? 'gray'}>{OUTCOME_LABELS[k]}</Badge></Link>
              : <Badge tone={OUTCOME_TONES[k] ?? 'gray'}>{OUTCOME_LABELS[k]}</Badge>}</span>
            <b>{count(counts[k] ?? 0)} · {shares[k] == null ? '—' : `${shares[k]}%`}</b>
          </div>
        ))}
      </div>
      <div className="divider" style={{ margin: '8px 0 12px' }} />
      <div className="section-label">Timeliness (not an outcome)</div>
      <div className="metricline"><span>SLA breached (matured cases in range){sla?.drilldown.numerator ? <> · <Link className="linkbtn" to={sla.drilldown.numerator}>view</Link></> : null}</span>
        <b data-testid="kpi-KPI-10">{sla ? `${formatKpi(sla)} · ${count(sla.numerator)} of ${count(sla.denominator)}` : '—'}</b></div>
      <div className="metricline"><span>Overdue open cases (all dates) · <Link className="linkbtn" to="/queues?queue=OVERDUE">view queue</Link></span><b>{count(Number(open?.breakdown.overdue ?? 0))}</b></div>
      <div className="metricline"><span>SLA exemptions applied (SLA-EX-001)</span>
        <b>{count(Number((sla?.exemptions_applied[0] as { count?: number } | undefined)?.count ?? 0))}</b></div>
      <p className="xsmall muted">Not verified, Cancelled and SLA breach describe the callback verification only; they are not conclusions about the sale.</p>
    </>
  );
}

function Register({ items }: { items: Kpi[] }) {
  return (
    <div className="kpi-register">
      {items.filter((k) => k.definition_id.startsWith('KPI-')).map((k) => (
        <div className="metricline" key={k.definition_id}>
          <span><span className="mono xsmall muted">{k.definition_id}</span> {k.label}</span>
          {k.status === 'NOT_MEASURED'
            ? <span title={k.stage_note ?? undefined}><Badge tone="gray">N/A</Badge></span>
            : <b>{formatKpi(k)}</b>}
        </div>
      ))}
      <p className="xsmall muted">N/A: not measurable yet (recordings and transcripts arrive in Stage S1).</p>
    </div>
  );
}
