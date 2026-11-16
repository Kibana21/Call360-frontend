// Policy Detail (`/policies/:policyId`), F4: read-only policy, sale, party, risk, script and callback context for one
// Singapore policy (API-051…055; S0_SCREEN_SPEC "Policy Explorer and Policy Detail"). Workspaces are tabs held in
// `?tab=`; the Sale Context for a specific sale is `?sale=<saleEventId>`, which must belong to the policy. Every value
// comes from the server; names and contact values are masked by the server. Each region loads independently, so one
// failing region leaves the rest usable (partial state).
import { useQuery } from '@tanstack/react-query';
import { Fragment, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api, unwrap, type PartyCard, type PolicyCase, type PolicyDetail, type PolicyHistory, type Provenance, type SaleContext, type SaleSummary } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/Icon';
import { Empty, ErrorState, Forbidden, Loading } from '../../components/StateView';
import { Badge, Button, Card, PageHead, StageChip, type Tone } from '../../components/ui';
import { FactSnapshot, Risk, short, show } from '../case/evidence';
import { BAND_LABELS, failure, humanize, OUTCOME_LABELS, Region, RiskBadge, when } from '../cases/shared';

const TABS = [
  ['sale', 'Sale context'], ['parties', 'Party & contact'], ['risk', 'SBQ risk'], ['script', 'Script assignment'],
  ['cases', 'Callback history'], ['source', 'Source & changes'],
] as const;
const OUTCOME_TONES: Record<string, Tone> = {
  VERIFIED_COMPLIANT: 'green', VERIFIED_WITH_FINDINGS: 'amber', NOT_VERIFIED: 'gray', CANCELLED: 'gray', OPEN: 'blue',
};
const money = (n: number | null | undefined, c?: string | null) => (n == null ? '—' : `${c ?? ''} ${n.toLocaleString('en-SG', { minimumFractionDigits: 2 })}`);
const day = (iso?: string | null) => (iso ? new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeZone: 'Asia/Singapore' }).format(new Date(iso)) : '—');
const kv = (rows: [string, ReactNode][]) => <dl className="kv">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>;
const source = (p: Provenance) => `${p.source_system ?? humanize(p.source_type)}${p.source_observed_at || p.recorded_at ? ` · as of ${day(p.source_observed_at ?? p.recorded_at)}` : ''}`;

function backLabel(back: string): string {
  if (back.startsWith('/cases/')) return 'Call Detail';
  if (back.startsWith('/search')) return 'search';
  if (back.startsWith('/calls')) return 'Call Explorer';
  if (back.startsWith('/queues')) return 'queues';
  if (back.startsWith('/risk-assessments')) return 'Risk Workbench';
  return back === '/' ? 'Overview' : 'Policy Explorer';
}

export function PolicyDetailPage() {
  const { policyId = '' } = useParams();
  const { can } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const allowed = can('policy.read');
  const path = { params: { path: { policy_id: policyId } } };
  const detail = useQuery({ queryKey: ['policy', policyId], enabled: allowed, queryFn: async () => unwrap(await api.GET('/api/v1/policies/{policy_id}', path)) });
  const ok = allowed && detail.isSuccess;
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab')! : 'sale';
  const sales = useQuery({ queryKey: ['policy', policyId, 'sales'], enabled: ok, queryFn: async () => unwrap(await api.GET('/api/v1/policies/{policy_id}/sales', path)) });
  const parties = useQuery({ queryKey: ['policy', policyId, 'parties'], enabled: ok && can('party.read') && tab === 'parties',
    queryFn: async () => unwrap(await api.GET('/api/v1/policies/{policy_id}/parties', path)) });
  const history = useQuery({ queryKey: ['policy', policyId, 'history'], enabled: ok && tab === 'source',
    queryFn: async () => unwrap(await api.GET('/api/v1/policies/{policy_id}/history', path)) });
  const requested = params.get('sale');
  const saleItems = sales.data?.items ?? [];
  const selected = saleItems.find((s) => s.id === requested) ?? saleItems.find((s) => s.id === detail.data?.latest_sale_id) ?? saleItems[saleItems.length - 1];
  const foreignSale = !!requested && sales.isSuccess && !saleItems.some((s) => s.id === requested);
  const saleCtx = useQuery({ queryKey: ['sale', selected?.id], enabled: ok && !!selected && (tab === 'sale' || tab === 'risk'),
    queryFn: async () => unwrap(await api.GET('/api/v1/sales/{sale_event_id}', { params: { path: { sale_event_id: selected!.id } } })) });

  if (!allowed) return <Forbidden />;
  const back = (location.state as { from?: string } | null)?.from ?? '/policies';
  const here = { from: `${location.pathname}${location.search}` };
  const setParam = (k: string, v: string | null) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (v) n.set(k, v); else n.delete(k);
    return n;
  }, { replace: true, state: location.state });

  const head = (
    <PageHead eyebrow="Policy 360 context" title="Policy Detail"
      description="One policy with its sale events, parties and masked contacts, SBQ selection risk, assigned scripts, callback cases and source lineage."
      actions={<>
        <Link className="btn" to={back}><Icon name="chev" size="sm" /> Back to {backLabel(back)}</Link>
        {can('intake.manual.submit') ? <Button icon="edit" disabled aria-describedby="pd-cp04">Correct field</Button> : null}
        {can('intake.manual.submit') ? <span id="pd-cp04"><StageChip label="Corrections — CP0.4b" /></span> : null}
        <Button icon="target" disabled aria-describedby="pd-s2">Request risk override</Button>
        <span id="pd-s2"><StageChip label="Stage S2" /></span>
      </>} />
  );
  if (detail.isPending) return <>{head}<Loading label="Loading Policy Detail…" /></>;
  if (detail.isError) {
    const f = failure(detail.error);
    if (f.status === 403) return <>{head}<Forbidden /></>;
    if (f.status === 404 || f.status === 422) return <>{head}<Card><Empty title="Policy not found or not available to you">
      Only Singapore policies in your scope can be opened. <Link className="linkbtn" to="/policies">Open Policy Explorer</Link></Empty></Card></>;
    return <>{head}<ErrorState message="Policy Detail could not be loaded." correlationId={f.ref} onRetry={() => void detail.refetch()} /></>;
  }
  const d = detail.data;
  const open = d.cases.filter((c) => c.outcome === 'OPEN').length;

  return (
    <>
      {head}
      {d.provenance.is_synthetic ? (
        <div className="topnotice" role="note">
          <div className="row"><Icon name="info" size="sm" />
            <span><strong>Synthetic policy data:</strong> {d.provenance.source_type === 'MANUAL' ? 'submitted through manual intake from a synthetic source transaction' : 'seeded for Stage 0 development'}; not an AIA customer record. Names and contact values are masked by the server.</span></div>
          <Badge tone="blue">Synthetic</Badge>
        </div>
      ) : null}

      <section className="card card-pad case-header" aria-label="Policy summary" style={{ marginBottom: 17 }}>
        <div className="row wrap">
          <Badge tone="dark">{humanize(d.status)}</Badge>
          {d.is_ilp ? <Badge tone="dark" noDot>ILP</Badge> : null}
          <span data-testid="pd-risk"><Badge tone={d.risk_band === 'HIGH' ? 'red' : d.risk_band === 'MEDIUM' ? 'amber' : d.risk_band === 'LOW' ? 'green' : 'gray'}>
            {BAND_LABELS[d.risk_band] ?? d.risk_band} selection risk · latest sale</Badge></span>
          <Badge tone="gray">Market {d.market}</Badge>
          <Badge tone="gray">Source {source(d.provenance)}</Badge>
        </div>
        <h2 className="case-title"><span className="mono">{d.policy_ref}</span> <span style={{ color: '#b9bfc9' }}>/</span> {d.owners.join(' & ') || '—'}</h2>
        <div className="small muted">{d.product_code} · {humanize(d.product_family)} · {humanize(d.product_subtype)} · Insured {d.insured.join(' & ') || '—'} · Effective {day(d.effective_from)}</div>
        <div className="info-grid case-tiles">
          <div className="info-tile"><label>Product</label><strong>{humanize(d.product_subtype)}</strong><div className="xsmall muted mono">{d.product_code}</div></div>
          <div className="info-tile"><label>Premium</label><strong>{money(d.premium_amount, d.currency)}</strong>
            <div className="xsmall muted">{d.premium_frequency ? humanize(d.premium_frequency) : '—'} · {d.premium_term_years ?? '—'} years</div></div>
          <div className="info-tile"><label>Sum assured</label><strong>{money(d.sum_assured, d.sum_assured_currency)}</strong><div className="xsmall muted">{humanize(d.status)}</div></div>
          <div className="info-tile"><label>Sale events</label><strong data-testid="pd-sales">{d.sales} · {d.top_ups} top-up{d.top_ups === 1 ? '' : 's'}</strong>
            <div className="xsmall muted">{selected ? `Latest ${day(saleItems[saleItems.length - 1]?.sold_at)}` : '—'}</div></div>
          <div className="info-tile"><label>Callback cases</label><strong data-testid="pd-cases">{d.cases.length} · {open} open</strong>
            <div className="xsmall muted">{d.cases.length ? `${OUTCOME_LABELS[d.cases[d.cases.length - 1]!.outcome] ?? ''} latest` : 'None'}</div></div>
        </div>
      </section>

      <div className="subtabs" role="tablist" aria-label="Policy Detail workspaces" style={{ margin: '0 0 16px' }}>
        {TABS.map(([k, label]) => (
          <button type="button" role="tab" key={k} id={`ptab-${k}`} aria-selected={tab === k} aria-controls="pd-panel"
            className={tab === k ? 'active' : ''} onClick={() => setParam('tab', k === 'sale' ? null : k)}>{label}</button>
        ))}
      </div>

      <div id="pd-panel" role="tabpanel" aria-labelledby={`ptab-${tab}`}>
        {foreignSale && (tab === 'sale' || tab === 'risk') ? <div className="topnotice" role="alert" style={{ marginBottom: 14 }}>
          <div className="row"><Icon name="alert" size="sm" /><span>The requested sale event does not belong to this policy; showing the latest sale instead.</span></div></div> : null}
        {tab === 'sale' || tab === 'risk' ? (
          <div className="layout pd-sales">
            <Card title="Sale events" subtitle={`${saleItems.length || d.sales} on this policy, oldest first`}>
              <Region query={sales} label="sale events">{() => <SaleList items={saleItems} selected={selected?.id} onSelect={(id) => setParam('sale', id)} />}</Region>
            </Card>
            {!selected ? (sales.isPending ? <Loading label="Loading sale context…" /> : <Card><Empty title="No sale event to show" /></Card>)
              : <Region query={saleCtx} label="sale context">{() => tab === 'sale'
                ? <SaleWorkspace ctx={saleCtx.data!} from={here} />
                : <RiskWorkspace ctx={saleCtx.data!} from={here} />}</Region>}
          </div>
        ) : null}
        {tab === 'parties' ? (can('party.read')
          ? <Region query={parties} label="parties">{() => <Parties items={parties.data!.items} from={here} />}</Region> : <Forbidden />) : null}
        {tab === 'script' ? <Scripts cases={d.cases} from={here} /> : null}
        {tab === 'cases' ? <Cases cases={d.cases} from={here} /> : null}
        {tab === 'source' ? <Region query={history} label="source lineage">{() => <Source d={d} h={history.data!} />}</Region> : null}
      </div>
    </>
  );
}

function SaleList({ items, selected, onSelect }: { items: SaleSummary[]; selected?: string; onSelect: (id: string) => void }) {
  if (!items.length) return <Empty title="No sale events recorded" />;
  return (
    <ul className="attempts-list" data-testid="sale-list">
      {items.map((s) => (
        <li key={s.id} style={{ marginBottom: 12 }}>
          <button type="button" className={`attempt-btn${s.id === selected ? ' selected' : ''}`} aria-pressed={s.id === selected}
            data-testid={`sale-${s.sale_ref}`} onClick={() => onSelect(s.id)}>
            <span className="row between"><strong className="mono">{s.sale_ref}</strong><Badge tone={s.sale_event_type === 'NEW_BUSINESS' ? 'gray' : 'purple'}>{humanize(s.sale_event_type)}</Badge></span>
            <small>{day(s.sold_at)} · {money(s.premium_amount, s.currency)} · {s.selling_channel ? humanize(s.selling_channel) : '—'}</small>
            <small>{BAND_LABELS[s.risk_band] ?? s.risk_band} risk · {s.cases.length} case{s.cases.length === 1 ? '' : 's'} · {s.fact_snapshots} snapshot{s.fact_snapshots === 1 ? '' : 's'}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SaleWorkspace({ ctx, from }: { ctx: SaleContext; from: { from: string } }) {
  const s = ctx.sale;
  return (
    <div className="stack" style={{ gap: 17 }}>
      <Card title={`Sale context ${s.sale_ref}`} subtitle={`Frozen at the sale · source ${source(ctx.provenance)}`}>
        <div data-testid="sale-context">{kv([
          ['Sale event', `${humanize(s.sale_event_type)} · ${when(s.sold_at)} SGT`],
          ['Premium', money(s.premium_amount, s.currency)],
          ['Channel / location', `${s.selling_channel ? humanize(s.selling_channel) : '—'} · ${s.selling_location ?? '—'}`],
          ['Campaign / proposal', `${s.campaign_code ?? '—'} · ${s.proposal_ref ?? '—'}`],
          ['FSC representative', s.fsc ? `${s.fsc.fsc_ref} · ${s.fsc.display_name}${s.fsc.channel ? ` · ${humanize(s.fsc.channel)}` : ''}${s.fsc.status ? ` · ${humanize(s.fsc.status)}` : ''}` : '—'],
          ['Product snapshot', show(s.product_snapshot)],
          ['External references', ctx.external_refs.map((x) => `${x.source_system} ${x.object_type}`).join(', ') || '—'],
        ])}</div>
      </Card>
      <Card title="Policy fact snapshots" subtitle="Insert-only; each sale keeps the facts captured for it, so later changes never rewrite history">
        {ctx.fact_snapshots.length ? <div className="stack" style={{ gap: 14 }}>{ctx.fact_snapshots.map((x) => (
          <div key={x.id} className="evidence">
            <div className="row between wrap" style={{ marginBottom: 8 }}><strong className="small">Captured {when(x.captured_at)} SGT</strong>
              <span className="xsmall muted mono" title={x.sha256}>schema v{x.schema_version} · SHA-256 {short(x.sha256)}</span></div>
            <FactSnapshot snap={x} />
          </div>
        ))}</div> : <Empty title="No fact snapshot for this sale" />}
      </Card>
      <Card title="Callback cases for this sale">
        <CaseLinks cases={ctx.cases} from={from} />
      </Card>
    </div>
  );
}

function RiskWorkspace({ ctx, from }: { ctx: SaleContext; from: { from: string } }) {
  const { can } = useAuth();
  const byId = new Map(ctx.risk_assessments.map((a) => [a.id, a]));
  const eff = ctx.risk_assessments.find((a) => a.effective);
  return (
    <Card title={`SBQ callback-selection risk · ${ctx.sale.sale_ref}`}
      subtitle="Most recent first; the effective assessment is the latest FINAL one"
      aside={can('risk.read') ? <Link className="btn tiny" to={`/risk-assessments?q=${ctx.sale.sale_ref}${eff ? `&assessment=${eff.id}` : ''}`} state={from}>
        <Icon name="target" size="sm" /> Risk Workbench</Link> : null}>
      <div className="explain" style={{ marginBottom: 12 }} role="note">SBQ selection risk decides script and priority for the callback. It is not the customer&apos;s
        investment suitability (shown in the fact snapshot) and not a compliance finding severity.</div>
      {ctx.risk_assessments.length ? <div className="stack" style={{ gap: 9 }} data-testid="risk-history">
        {ctx.risk_assessments.map((a) => <Risk key={a.id} a={a} supersedes={a.supersedes_id ? byId.get(a.supersedes_id) : undefined} />)}</div>
        : <Empty title="No SBQ assessment recorded">The callback is held for risk triage until one is supplied.</Empty>}
    </Card>
  );
}

function Parties({ items, from }: { items: PartyCard[]; from: { from: string } }) {
  if (!items.length) return <Empty title="No parties recorded on this policy" />;
  return (
    <div className="layout cols-even" data-testid="parties">
      {items.map((p) => (
        <Card key={p.party_ref} title={p.masked_name}
          subtitle={`${p.party_ref} · ${humanize(p.kind)} · ${humanize(p.personal_data_class)} · source ${source(p.provenance)}`}>
          <div className="section-label">Roles on this policy</div>
          {p.roles.map((r) => (
            <div className="metricline" key={`${r.role}-${r.valid_from}`}><span><strong>{humanize(r.role)}</strong>{r.authorization_ref ? <span className="muted"> · authorisation {r.authorization_ref}</span> : null}</span>
              <span className="xsmall">{r.current ? `Since ${day(r.valid_from)}` : `${day(r.valid_from)} – ${day(r.valid_to)}`} {r.current ? null : <Badge tone="gray">Ended</Badge>}</span></div>
          ))}
          <div className="divider" />
          <div className="section-label">Contact methods (masked)</div>
          {p.contacts.length ? p.contacts.map((c, i) => (
            <div className="metricline" key={`${c.channel}-${i}`}><span><span className="mono">{c.masked_value}</span> <span className="muted">· {humanize(c.channel)}{c.preference_rank ? ` · rank ${c.preference_rank}` : ''}{c.language ? ` · ${c.language}` : ''}</span></span>
              <span className="row wrap right">
                {!c.current ? <Badge tone="gray">Ended {day(c.valid_to)}</Badge> : null}
                {c.suppressed ? <Badge tone="red">Suppressed</Badge> : null}
                <Badge tone={c.consent_status === 'GRANTED' ? 'green' : 'gray'}>Consent {humanize(c.consent_status)}</Badge>
                <Badge tone="gray">{c.is_verified ? 'Verified' : 'Unverified'}</Badge>
              </span></div>
          )) : <p className="small muted">No contact method recorded.</p>}
          <div className="divider" />
          <div className="section-label">Contact eligibility evidence (per callback case)</div>
          {p.eligibility.length ? p.eligibility.map((e, i) => (
            <div className="metricline" key={`${e.case_id}-${e.role}-${i}`}>
              <span><Link className="link mono" to={`/cases/${e.case_id}`} state={from}>{e.case_ref}</Link> · {humanize(e.role)} · {e.masked_contact ?? 'no method'}
                <span className="xsmall muted"> · basis {humanize(e.rule_basis)} · decided {day(e.decided_at)}</span></span>
              <span className="row wrap right">{e.superseded ? <Badge tone="gray">Superseded</Badge> : null}
                {e.eligible ? <Badge tone="green">Eligible</Badge> : <Badge tone="gray">{humanize(e.ineligibility_reason ?? 'Ineligible')}</Badge>}</span></div>
          )) : <p className="small muted">Not considered for any callback case.</p>}
          <p className="xsmall muted" style={{ marginBottom: 0 }}>Eligibility is a data-level pre-check, not identity verification.</p>
        </Card>
      ))}
    </div>
  );
}

function CaseLinks({ cases, from }: { cases: PolicyCase[]; from: { from: string } }) {
  if (!cases.length) return <Empty title="No callback case for this sale" />;
  return <>{cases.map((c) => (
    <div className="metricline" key={c.case_id}><span><Link className="link mono" to={c.route} state={from}>{c.case_ref}</Link> · {humanize(c.state)}</span>
      <Badge tone={OUTCOME_TONES[c.outcome] ?? 'gray'}>{OUTCOME_LABELS[c.outcome] ?? c.outcome}</Badge></div>
  ))}</>;
}

function Cases({ cases, from }: { cases: PolicyCase[]; from: { from: string } }) {
  if (!cases.length) return <Card><Empty title="No callback cases on this policy" /></Card>;
  return (
    <Card pad={false} title="Callback history" subtitle="Every verification obligation on this policy, by sale">
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Callback cases on this policy (scrolls horizontally)">
        <table className="data-table" data-testid="policy-cases">
          <caption className="sr-only">Callback cases on this policy</caption>
          <thead><tr><th scope="col">Callback case</th><th scope="col">Sale</th><th scope="col">Risk</th><th scope="col">Case status</th>
            <th scope="col">Verification outcome</th><th scope="col">Due / verified</th><th scope="col">Script</th></tr></thead>
          <tbody>{cases.map((c) => (
            <tr key={c.case_id} data-case-ref={c.case_ref}>
              <td><Link className="link mono" to={c.route} state={from}>{c.case_ref}</Link></td>
              <td><span className="mono">{c.sale_ref}</span><div className="small muted" style={{ marginTop: 5 }}>{humanize(c.sale_event_type)}</div></td>
              <td><RiskBadge band={c.risk_band} /></td>
              <td><Badge tone="dark">{humanize(c.state)}</Badge></td>
              <td><Badge tone={OUTCOME_TONES[c.outcome] ?? 'gray'}>{OUTCOME_LABELS[c.outcome] ?? c.outcome}</Badge>
                <div className="xsmall muted" style={{ marginTop: 5 }}>{c.controls_satisfied == null ? '' : c.controls_satisfied ? 'Mandatory controls satisfied' : 'Mandatory controls not all satisfied'}
                  {c.open_findings ? ` · ${c.open_findings} open finding${c.open_findings === 1 ? '' : 's'}` : ''}</div></td>
              <td className="xsmall">{when(c.due_at)}{c.verified_at ? <div className="muted" style={{ marginTop: 5 }}>Verified {when(c.verified_at)}</div> : null}</td>
              <td className="xsmall mono">{c.script ? `${c.script.family} v${c.script.version_label}` : 'Not assigned'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Scripts({ cases, from }: { cases: PolicyCase[]; from: { from: string } }) {
  if (!cases.length) return <Card><Empty title="No callback case, so no script has been assigned" /></Card>;
  return (
    <div className="layout cols-even" data-testid="policy-scripts">
      {cases.map((c) => {
        const t = c.script_rationale as { matched?: string; precedence?: string; resolved_sections?: string[]; excluded?: { rule: string; reason: string }[]; label?: string };
        return (
          <Card key={c.case_id} title={`${c.case_ref} · ${c.sale_ref}`}
            aside={<Link className="btn tiny" to={c.route} state={from} aria-label={`${c.case_ref} Call Detail`}>Call Detail</Link>}
            subtitle={c.script ? `${c.script.family} v${c.script.version_label} · ${humanize(c.script.status)}` : 'Not assigned'}>
            {c.script ? <div className="stack" style={{ gap: 9 }}>
              <div className="rules-flow">{(t.resolved_sections ?? []).map((s, i) => <span key={s} className="row" style={{ gap: 9 }}>{i ? <span className="arrow">+</span> : null}<span className="rule-chip">{humanize(s)}</span></span>)}</div>
              <dl className="kv xsmall">
                <dt>Matched rule</dt><dd>{c.matched_rule ?? t.matched ?? '—'}</dd>
                <dt>Precedence</dt><dd>{t.precedence ?? '—'}</dd>
                {t.excluded?.length ? <><dt>Not applied</dt><dd>{t.excluded.map((x) => `${x.rule} (${x.reason})`).join('; ')}</dd></> : null}
                <dt>Assignment</dt><dd>{c.assignment_origin ? humanize(c.assignment_origin) : '—'} · manifest <span className="mono">{short(c.script.manifest_sha256)}</span></dd>
              </dl>
              {t.label ? <p className="xsmall muted" style={{ margin: 0 }}>{t.label}</p> : null}
            </div> : <Empty title="No script assigned">The case is held until a script is assigned.</Empty>}
          </Card>
        );
      })}
    </div>
  );
}

function Source({ d, h }: { d: PolicyDetail; h: PolicyHistory }) {
  return (
    <div className="stack" style={{ gap: 17 }}>
      <div className="topnotice" role="note" data-testid="field-changes">
        <div className="row"><Icon name="info" size="sm" /><span>{h.field_changes.message}</span></div><Badge tone="gray">Not available</Badge>
      </div>
      <div className="layout cols-even">
        <Card title="Material policy fields" subtitle="Value, source and as-of (POL-005)">
          <dl className="kv xsmall" data-testid="material-fields">{d.material_fields.map((f) => (
            <Fragment key={f.field}><dt>{humanize(f.field)}</dt>
              <dd>{show(f.value)} <span className="muted">· {f.source_system ?? '—'}{f.as_of ? ` as of ${day(f.as_of)}` : ''}</span></dd></Fragment>
          ))}</dl>
        </Card>
        <Card title="Policy record provenance">
          {kv([
            ['Source type', humanize(d.provenance.source_type)], ['Source system', d.provenance.source_system ?? '—'],
            ['Source reference', d.provenance.source_reference ?? '—'], ['Observed at source', d.provenance.source_observed_at ? `${when(d.provenance.source_observed_at)} SGT` : '—'],
            ['Recorded', d.provenance.recorded_at ? `${when(d.provenance.recorded_at)} SGT` : '—'], ['Mapping version', d.provenance.mapping_version ?? '—'],
            ['Intake item', d.provenance.intake_item_id ?? 'None (seeded)'], ['External references', d.external_refs.map((x) => `${x.source_system} ${x.object_type}`).join(', ') || '—'],
          ])}
        </Card>
      </div>
      <Card pad={false} title="Record lineage" subtitle="Every stored record on this policy with its source">
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Record lineage (scrolls horizontally)">
          <table className="data-table" data-testid="lineage">
            <caption className="sr-only">Record lineage</caption>
            <thead><tr><th scope="col">Record</th><th scope="col">Reference</th><th scope="col">Detail</th><th scope="col">Source</th><th scope="col">Recorded</th><th scope="col">External references</th></tr></thead>
            <tbody>{h.lineage.map((x, i) => (
              <tr key={`${x.entity_type}-${x.entity_ref}-${i}`}>
                <td>{humanize(x.entity_type)}</td><td className="mono">{x.entity_ref}</td><td>{humanize(x.label)}</td>
                <td className="xsmall">{humanize(x.provenance.source_type)} · {x.provenance.source_system ?? '—'}{x.provenance.is_synthetic ? ' · synthetic' : ''}</td>
                <td className="xsmall">{x.provenance.recorded_at ? when(x.provenance.recorded_at) : '—'}</td>
                <td className="xsmall">{x.external_refs.map((r) => r.source_system).join(', ') || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
