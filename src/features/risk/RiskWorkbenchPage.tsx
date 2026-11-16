// SBQ Risk Workbench (`/risk-assessments`), F5: read-only register of stored SBQ callback-selection assessments
// (API-056) with the factor vocabulary (API-058) and a detail drawer (`?assessment=`, API-057), following the mockup's
// "Risk Assessment" screen. Nothing is scored or re-banded in the browser; "effective" and "source ≠ rule" come from the
// server. Two populations are kept apart and labelled: stored assessments, and sale events (their effective
// assessment). Callback cases are counted only on the Overview. Investment suitability and finding severity are not
// SBQ risk and are not shown here.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, unwrap, type RiskDetail, type RiskList, type RiskQuery, type RiskRow } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Icon, type IconName } from '../../components/Icon';
import { Empty, ErrorState, Forbidden, Loading } from '../../components/StateView';
import { Badge, Button, Card, PageHead, StageChip } from '../../components/ui';
import { short, show } from '../case/evidence';
import { BAND_LABELS, count, failure, humanize, Region, RiskBadge, useFrom, when } from '../cases/shared';
import { useRiskPages } from '../cases/useCasePages';

const LIST = ['band', 'factor', 'origin', 'status', 'rule_set', 'product_family', 'channel', 'fsc'] as const;
const SCALAR = ['q', 'effective', 'discrepancy', 'sort'] as const;
const SORTS: [string, string][] = [['-valid_at', 'Valid at (newest first)'], ['valid_at', 'Valid at (oldest first)'], ['band', 'Band (highest first)'], ['sale_ref', 'Sale reference'], ['origin', 'Origin']];
const LABELS: Record<string, string> = {
  q: 'Search', band: 'Band', factor: 'Matched factor', origin: 'Origin', status: 'Status', rule_set: 'Rule set', product_family: 'Product',
  channel: 'Channel', fsc: 'FSC', effective: 'Effective', discrepancy: 'Source ≠ rule',
};
const ORIGIN_LABELS: Record<string, string> = { SOURCE_ASSIGNED: 'Source-assigned', RULE_ASSESSED: 'Rule-assessed', MANUAL: 'Manual' };
const bandLabel = (c?: string | null) => (!c || c === 'NO_BAND' ? 'No band' : BAND_LABELS[c] ?? humanize(c));

export function toRiskQuery(params: URLSearchParams): RiskQuery {
  const q: Record<string, unknown> = {};
  for (const k of LIST) { const v = params.getAll(k).filter(Boolean); if (v.length) q[k] = v; }
  for (const k of SCALAR) { const v = params.get(k); if (v) q[k] = v; }
  return q as RiskQuery;
}

const valueLabel = (key: string, v: string) => key === 'band' ? bandLabel(v) : key === 'origin' ? ORIGIN_LABELS[v] ?? v
  : key === 'effective' || key === 'discrepancy' ? (v === 'true' ? 'Yes' : 'No') : key === 'q' || key === 'rule_set' || key === 'fsc' ? v : humanize(v);

export function RiskWorkbenchPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = toRiskQuery(params);
  const allowed = can('risk.read');
  const pages = useRiskPages(query, { enabled: allowed });
  const vocab = useQuery({ queryKey: ['risk-factors'], enabled: allowed, queryFn: async () => unwrap(await api.GET('/api/v1/risk-factors')) });
  const [text, setText] = useState(params.get('q') ?? '');
  useEffect(() => setText(params.get('q') ?? ''), [params]);

  if (!allowed) return <Forbidden />;
  if (pages.result.isError && failure(pages.result.error).status === 403) return <Forbidden />;
  const data = pages.result.data;
  const f = data?.facets ?? {};
  const labels = Object.fromEntries((vocab.data?.items ?? []).map((i) => [i.code, i.label]));

  const update = (mutate: (p: URLSearchParams) => void, replace = false) => setParams((p) => { const n = new URLSearchParams(p); mutate(n); return n; }, { replace });
  const setOne = (key: string, value: string) => update((p) => { p.delete(key); if (value) p.set(key, value); });
  const removeValue = (key: string, value: string) => update((p) => {
    const rest = p.getAll(key).filter((v) => v !== value); p.delete(key); rest.forEach((v) => p.append(key, v));
  });
  const open = (id: string | null) => update((p) => { if (id) p.set('assessment', id); else p.delete('assessment'); });
  const submit = (e: FormEvent) => { e.preventDefault(); setOne('q', text.trim()); };
  const select = (dim: string, label: string, labeller: (c: string) => string) => {
    const codes = [...new Set([...Object.keys(f[dim] ?? {}), ...params.getAll(dim)])].sort();
    return (
      <>
        <label className="sr-only" htmlFor={`rf-${dim}`}>{label}</label>
        <select id={`rf-${dim}`} className="field" value={params.getAll(dim).length === 1 ? params.get(dim)! : ''} onChange={(e) => setOne(dim, e.target.value)}>
          <option value="">{label}: all</option>
          {codes.map((c) => <option key={c} value={c}>{labeller(c)} ({count(f[dim]?.[c] ?? 0)})</option>)}
        </select>
      </>
    );
  };
  const chips: { key: string; value: string }[] = [];
  for (const k of LIST) params.getAll(k).forEach((value) => chips.push({ key: k, value }));
  for (const k of SCALAR) { const v = params.get(k); if (v && k !== 'sort') chips.push({ key: k, value: v }); }
  const selected = params.get('assessment');

  return (
    <>
      <PageHead eyebrow="SBQ sale assessment" title="SBQ Risk Workbench"
        description="Stored SBQ callback-selection assessments for Singapore sales: origin, factors, rule-set version, input hash and supersession. Read-only; nothing is scored here."
        actions={<>
          <Button icon="settings" disabled aria-describedby="rw-s2">Risk policy settings</Button>
          <Button variant="primary" icon="plus" disabled aria-describedby="rw-s2">Assess a sale</Button>
          <span id="rw-s2"><StageChip label="Stage S2 — RISK-008" /></span>
        </>} />
      <div className="explain" role="note" style={{ marginBottom: 18 }}><strong>SBQ callback-selection risk</strong> decides which sales are called back and with
        which script. It is not the customer&apos;s investment suitability or risk tolerance (a sourced fact shown in Policy Detail) and not a compliance
        finding severity. Bands, factors and rule sets are synthetic and not AIA-approved.</div>
      <Overview data={data} query={pages.result} onFilter={(p) => setParams(new URLSearchParams(p))} />
      <div className="layout cols-2" style={{ marginBottom: 18 }}>
        <Card title="Assessment population" subtitle="Counts of stored assessments (not sales or cases)">
          <Region query={pages.result} label="assessment summary">{() => <Population data={data!} />}</Region>
        </Card>
        <Card title="Risk factor vocabulary" subtitle={vocab.data ? `Governed code list ${vocab.data.list_code} v${vocab.data.version} · ${humanize(vocab.data.status)}` : 'Governed code list'}>
          <Region query={vocab} label="factor vocabulary">{() => (
            <div data-testid="factor-vocabulary">
              {vocab.data!.items.map((i) => (
                <div className="metricline" key={i.code}><span><strong>{i.label}</strong> <span className="mono xsmall muted">{i.code}</span></span>
                  <span className="row"><span className="xsmall muted">{humanize(String(i.attributes.value_type ?? ''))}</span>
                    <Badge tone="gray">{count(f.factor?.[i.code] ?? 0)} matched in results</Badge></span></div>
              ))}
              <p className="xsmall muted" style={{ marginBottom: 0 }}>No weights or thresholds are stored or applied in Stage 0; the vocabulary is synthetic.</p>
            </div>
          )}</Region>
        </Card>
      </div>
      <Card pad={false}>
        <form className="table-toolbar" role="search" aria-label="Filter risk assessments" onSubmit={submit}>
          <label className="row" style={{ flex: 1, minWidth: 230, border: '1px solid #e3e6eb', padding: '0 11px', borderRadius: 8, height: 36 }}>
            <Icon name="search" size="sm" /><span className="sr-only">Search assessments</span>
            <input className="field" style={{ border: 0, boxShadow: 'none', width: '100%' }} value={text} maxLength={64}
              onChange={(e) => setText(e.target.value)} placeholder="Sale, policy, case or FSC ref" />
          </label>
          <Button type="submit" variant="subtle" icon="search">Search</Button>
          {select('band', 'Band', bandLabel)}
          {select('origin', 'Origin', (c) => ORIGIN_LABELS[c] ?? c)}
          {select('status', 'Status', humanize)}
          {select('factor', 'Matched factor', (c) => labels[c] ?? c)}
          {select('rule_set', 'Rule set', (c) => (c === 'NONE' ? 'None (source-assigned)' : c))}
        </form>
        <div className="table-toolbar">
          {select('product_family', 'Product', humanize)}
          {select('channel', 'Channel', humanize)}
          <label className="row small"><input type="checkbox" checked={params.get('effective') === 'true'} onChange={(e) => setOne('effective', e.target.checked ? 'true' : '')} /> Effective only</label>
          <label className="row small"><input type="checkbox" checked={params.get('discrepancy') === 'true'} onChange={(e) => setOne('discrepancy', e.target.checked ? 'true' : '')} /> Source ≠ rule only</label>
          <span style={{ flex: 1 }} />
          <label className="sr-only" htmlFor="rf-sort">Sort</label>
          <select id="rf-sort" className="field" value={params.get('sort') ?? '-valid_at'} onChange={(e) => setOne('sort', e.target.value === '-valid_at' ? '' : e.target.value)}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
          </select>
          <Button variant="subtle" icon="refresh" disabled={!chips.length} onClick={() => setParams(new URLSearchParams())}>Clear filters</Button>
        </div>
        {chips.length ? (
          <div className="filter-chips" aria-label="Active filters">
            {chips.map((c) => (
              <span className="filter-chip" key={`${c.key}=${c.value}`}>{LABELS[c.key] ?? c.key}: {valueLabel(c.key, c.value)}
                <button type="button" aria-label={`Remove filter ${LABELS[c.key] ?? c.key} ${valueLabel(c.key, c.value)}`}
                  onClick={() => (LIST as readonly string[]).includes(c.key) ? removeValue(c.key, c.value) : setOne(c.key, '')}><Icon name="close" size="sm" /></button></span>
            ))}
          </div>
        ) : null}
        <div className="row between wrap" style={{ padding: '13px 18px', borderBottom: '1px solid var(--line)' }}>
          <span className="muted small" role="status" aria-live="polite" data-testid="risk-total">
            {data ? <>Showing <b style={{ color: '#3e4c60' }}>{count(data.items.length)}</b> of <b style={{ color: '#3e4c60' }}>{count(data.total)}</b> matching assessments</> : 'Loading…'}
          </span>
          <div className="row"><Badge tone="blue">Assessment grain</Badge><Badge tone="gray">Singapore only</Badge>{data?.synthetic_badge ? <Badge tone="blue">Synthetic</Badge> : null}</div>
        </div>
        <Region query={pages.result} label="risk assessments">{() => data!.markets.length === 0
          ? <Empty title="No market is assigned to your account">Assessments are shown only for Singapore; ask an administrator for Singapore access.</Empty>
          : <RiskTable rows={data!.items} labels={labels} onOpen={open} emptyHint={chips.length ? 'Try removing a filter or clearing the search.' : 'No assessments are in scope.'} />}</Region>
        <div className="row between wrap" style={{ padding: '14px 18px', borderTop: '1px solid var(--line)' }}>
          <span className="small muted">{data ? `Data as of ${when(data.data_as_of)} SGT · ` : ''}Page {pages.pageNumber} · {pages.limit} per page</span>
          <div className="row">
            <Button tiny disabled={!pages.hasPrevious} onClick={pages.previous} aria-label="Previous page">Previous</Button>
            <Button tiny disabled={!pages.hasNext} onClick={pages.next} aria-label="Next page">Next</Button>
          </div>
        </div>
      </Card>
      {selected ? <Drawer id={selected} labels={labels} onOpen={open} onClose={() => open(null)} /> : null}
    </>
  );
}

function Overview({ data, query, onFilter }: { data?: RiskList; query: { isPending: boolean; isError: boolean }; onFilter: (p: Record<string, string>) => void }) {
  const s = data?.summary.sales;
  const v = (n: number | undefined) => (s ? count(n ?? 0) : query.isError ? '—' : '…');
  const tile = (label: string, value: string, sub: string, icon: IconName, filter: Record<string, string>, accent = false) => (
    <section className={`card kpi${accent ? ' accent' : ''}`} aria-label={label}>
      <div className="kpi-top"><span>{label}</span><div className="kpi-icon"><Icon name={icon} /></div></div>
      <div className="kpi-number">{value}</div>
      <div className="kpi-sub">{sub}</div>
      <button type="button" className="linkbtn kpi-drill" onClick={() => onFilter(filter)}>Show assessments<span className="sr-only">: {label}</span> <span aria-hidden="true">→</span></button>
    </section>
  );
  return (
    <div className="layout cols-4" style={{ marginBottom: 18 }} aria-label="Sale events by effective SBQ band" data-testid="risk-overview">
      {tile('High-risk sales', v(s?.by_effective_band.HIGH), 'Sale events whose effective assessment is High', 'alert', { effective: 'true', band: 'HIGH' }, true)}
      {tile('Medium-risk sales', v(s?.by_effective_band.MEDIUM), 'Sale events whose effective assessment is Medium', 'target', { effective: 'true', band: 'MEDIUM' })}
      {tile('Low-risk sales', v(s?.by_effective_band.LOW), `Sale events whose effective assessment is Low · ${s ? count(s.without_assessment) : '…'} of ${s ? count(s.total) : '…'} sales unassessed`, 'check', { effective: 'true', band: 'LOW' })}
      {tile('Source ≠ rule', v(s?.source_rule_discrepancies), 'Sale events whose source-assigned and rule-assessed bands differ', 'layers', { discrepancy: 'true' })}
    </div>
  );
}

function Population({ data }: { data: RiskList }) {
  const a = data.summary.assessments;
  const bar = (label: string, n: number, key: string) => (
    <div className="report-bars" key={key}><span>{label}</span><div className="greybar"><span style={{ width: `${a.total ? (n / a.total) * 100 : 0}%` }} /></div><b>{count(n)}</b></div>
  );
  return (
    <div data-testid="risk-population">
      <div className="section-label">By origin · {count(a.total)} assessments</div>
      {Object.entries(a.by_origin).map(([k, n]) => bar(ORIGIN_LABELS[k] ?? humanize(k), n, `o-${k}`))}
      <div className="section-label" style={{ marginTop: 14 }}>By status</div>
      {Object.entries(a.by_status).map(([k, n]) => bar(humanize(k), n, `s-${k}`))}
      <div className="section-label" style={{ marginTop: 14 }}>By stored band</div>
      {Object.entries(a.by_band).map(([k, n]) => bar(bandLabel(k), n, `b-${k}`))}
    </div>
  );
}

function StatusBadges({ r }: { r: RiskRow }) {
  return (
    <span className="row wrap">
      {r.effective ? <Badge tone="blue">Effective</Badge> : null}
      {r.status === 'SUPERSEDED' || r.superseded_by ? <Badge tone="gray">Superseded</Badge> : r.status !== 'FINAL' ? <Badge tone="amber">{humanize(r.status)} (provisional)</Badge> : null}
      {r.discrepancy ? <Badge tone="amber">Source ≠ rule</Badge> : null}
    </span>
  );
}

function RiskTable({ rows, labels, onOpen, emptyHint }: { rows: RiskRow[]; labels: Record<string, string>; onOpen: (id: string) => void; emptyHint: string }) {
  const from = useFrom();
  if (!rows.length) return <Empty title="No matching assessments">{emptyHint}</Empty>;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Risk assessments (scrolls horizontally)">
      <table className="data-table" data-testid="risk-table">
        <caption className="sr-only">SBQ callback-selection risk assessments</caption>
        <thead><tr>
          <th scope="col">Sale / policy</th><th scope="col">Origin</th><th scope="col">SBQ band</th><th scope="col">Status</th>
          <th scope="col">Rule set / source value</th><th scope="col">Matched factors</th><th scope="col">Valid at</th><th scope="col">Callback</th>
          <th scope="col"><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} data-sale-ref={r.sale_ref} data-origin={r.origin}>
            <td><span className="mono strong">{r.sale_ref}</span> <span className="xsmall muted">{humanize(r.sale_event_type)}</span>
              <div className="small" style={{ marginTop: 5 }}><Link className="link mono" to={`/policies/${r.policy_id}?sale=${r.sale_event_id}&tab=risk`} state={from} tabIndex={-1}
                aria-label={`${r.policy_ref} Policy Detail`}>{r.policy_ref}</Link> <span className="muted">· {humanize(r.product_family)}{r.is_ilp && r.product_family !== 'ILP' ? ' · ILP' : ''}</span></div></td>
            <td><Badge tone={r.origin === 'RULE_ASSESSED' ? 'purple' : 'dark'}>{ORIGIN_LABELS[r.origin] ?? humanize(r.origin)}</Badge></td>
            <td>{r.band_code && r.band_code !== 'UNKNOWN' ? <RiskBadge band={r.band_code} /> : <Badge tone="gray">{bandLabel(r.band_code)}</Badge>}</td>
            <td><StatusBadges r={r} /></td>
            <td className="xsmall">{r.rule_set ?? <span className="mono">{r.source_original_value ?? '—'}</span>}<div className="muted" style={{ marginTop: 4 }}>{r.rule_set ? 'Rule set' : 'Source original value'}</div></td>
            <td className="wrap-cell">{r.matched_factors.length ? r.matched_factors.map((x) => <span key={x} className="tag" style={{ marginRight: 4 }}>{labels[x] ?? humanize(x)}</span>)
              : <span className="xsmall muted">{r.origin === 'RULE_ASSESSED' ? 'None matched' : 'Not factor-based'}</span>}</td>
            <td className="xsmall">{when(r.valid_at)}</td>
            <td className="xsmall">{r.cases.length ? r.cases.map((c) => <div key={c.case_id}><Link className="link mono" to={c.route} state={from} tabIndex={-1} aria-label={`${c.case_ref} Call Detail`}>{c.case_ref}</Link></div>) : <span className="muted">No case</span>}</td>
            <td><button type="button" className="btn tiny" data-testid={`open-${r.id}`} aria-label={`Details ${r.sale_ref} ${ORIGIN_LABELS[r.origin] ?? r.origin}`} onClick={() => onOpen(r.id)}>Details</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Drawer({ id, labels, onOpen, onClose }: { id: string; labels: Record<string, string>; onOpen: (id: string) => void; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['risk', id], queryFn: async () => unwrap(await api.GET('/api/v1/risk-assessments/{assessment_id}', { params: { path: { assessment_id: id } } })) });
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  let body: ReactNode;
  if (detail.isPending) body = <Loading label="Loading assessment…" />;
  else if (detail.isError) {
    const f = failure(detail.error);
    body = f.status === 404 || f.status === 422 ? <Empty title="Assessment not found or not available to you">Only Singapore assessments in your scope can be opened.</Empty>
      : f.status === 403 ? <Forbidden /> : <ErrorState message="The assessment could not be loaded." correlationId={f.ref} onRetry={() => void detail.refetch()} />;
  } else body = <DrawerBody d={detail.data} labels={labels} onOpen={onOpen} />;
  return (
    <div className="drawer-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="rw-drawer-title" data-testid="risk-drawer">
        <div className="drawer-head">
          <div><div className="eyebrow">SBQ assessment</div><h2 id="rw-drawer-title">{detail.data ? `${detail.data.sale_ref} · ${ORIGIN_LABELS[detail.data.origin] ?? detail.data.origin}` : 'Assessment'}</h2></div>
          <button ref={closeRef} type="button" className="btn icononly" aria-label="Close assessment details" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="drawer-body">{body}</div>
      </div>
    </div>
  );
}

function DrawerBody({ d, labels, onOpen }: { d: RiskDetail; labels: Record<string, string>; onOpen: (id: string) => void }) {
  const from = useFrom();
  const c = d.comparison;
  const byId = new Map(d.history.map((h) => [h.id, h]));
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row wrap">
        {d.band_code && d.band_code !== 'UNKNOWN' ? <RiskBadge band={d.band_code} /> : <Badge tone="gray">{bandLabel(d.band_code)}</Badge>}
        <Badge tone={d.origin === 'RULE_ASSESSED' ? 'purple' : 'dark'}>{ORIGIN_LABELS[d.origin] ?? d.origin}</Badge>
        <Badge tone="gray">{humanize(d.status)}</Badge><StatusBadges r={d} />
        {d.provenance.is_synthetic ? <Badge tone="blue">Synthetic</Badge> : null}
      </div>
      <section aria-label="Source-assigned and rule-assessed comparison" data-testid="risk-comparison">
        <div className="section-label">Source-assigned vs rule-assessed (this sale)</div>
        <div className="info-grid">
          <div className="info-tile"><label>Source-assigned (latest final)</label><strong>{c.source_band ? bandLabel(c.source_band) : 'None stored'}</strong></div>
          <div className="info-tile"><label>Rule-assessed (latest final)</label><strong>{c.rule_band ? bandLabel(c.rule_band) : 'None stored'}</strong></div>
          <div className="info-tile"><label>Effective (latest final)</label><strong>{c.effective_band ? bandLabel(c.effective_band) : 'Unavailable'}</strong></div>
        </div>
        {c.discrepancy ? <div className="explain" style={{ marginTop: 10 }} role="note">The source system and the synthetic rule set disagree on this sale&apos;s band. The
          effective band is the latest final assessment; no override workflow exists before Stage S2.</div> : null}
      </section>
      <section aria-label="Factors">
        <div className="section-label">Factors</div>
        {d.factors.length ? (
          <table className="data-table" data-testid="risk-factors"><caption className="sr-only">Factor results</caption>
            <thead><tr><th scope="col">Factor</th><th scope="col">Recorded value</th><th scope="col">Result</th><th scope="col">Source / rule</th></tr></thead>
            <tbody>{d.factors.map((f, i) => (
              <tr key={`${f.factor_code}-${i}`}><td>{f.label ?? labels[f.factor_code ?? ''] ?? f.factor_code}<div className="xsmall muted mono">{f.factor_code}</div></td>
                <td>{show(f.value)} <span className="xsmall muted">({humanize(f.value_type)})</span></td>
                <td><Badge tone={f.result === 'MATCHED' ? 'amber' : 'gray'}>{humanize(f.result)}</Badge></td>
                <td className="xsmall">{f.source}{f.matched_rule_id ? <div className="mono muted">{f.matched_rule_id}</div> : null}{f.weight != null ? <div className="muted">weight {f.weight}</div> : null}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="small muted" style={{ margin: 0 }}>No factor results are stored for this assessment: a source-assigned assessment carries the source&apos;s band and original value only.</p>}
      </section>
      <section aria-label="Assessment record">
        <div className="section-label">Assessment record</div>
        <dl className="kv xsmall">
          <dt>Kind</dt><dd>{humanize(d.kind)}</dd>
          <dt>Reason codes</dt><dd className="mono">{d.reason_codes.join(', ') || '—'}</dd>
          <dt>Explanation</dt><dd>{d.explanation ?? '—'}</dd>
          <dt>Source original value</dt><dd className="mono">{d.source_original_value ?? '—'}</dd>
          <dt>Score</dt><dd>{d.score ?? 'Not stored'}</dd>
          <dt>Rule set</dt><dd>{d.rule_set_version ? `${d.rule_set_version.code} v${d.rule_set_version.version} · ${humanize(d.rule_set_version.status)} · effective ${when(d.rule_set_version.effective_from)} · ${humanize(d.rule_set_version.content_approval_status)}` : 'None (not rule-assessed)'}</dd>
          {d.rule_set_version ? <><dt>Rule-set checksum</dt><dd className="mono" title={d.rule_set_version.checksum}>{short(d.rule_set_version.checksum)}</dd></> : null}
          <dt>Input snapshot SHA-256</dt><dd className="mono" title={d.input_snapshot_sha256 ?? ''}>{d.input_snapshot_sha256 ? short(d.input_snapshot_sha256) : 'Not recorded'}</dd>
          <dt>Assessed / valid at</dt><dd>{d.assessed_at ? when(d.assessed_at) : '—'} / {when(d.valid_at)} SGT</dd>
          <dt>Source</dt><dd>{humanize(d.provenance.source_type)} · {d.provenance.source_system ?? '—'} · {d.provenance.source_reference ?? '—'}</dd>
        </dl>
      </section>
      <section aria-label="Assessment history for this sale">
        <div className="section-label">History for {d.sale_ref} (oldest first)</div>
        <ol className="attempts-list" data-testid="risk-history">{d.history.map((h) => (
          <li key={h.id} style={{ marginBottom: 10 }}>
            <button type="button" className={`attempt-btn${h.id === d.id ? ' selected' : ''}`} aria-current={h.id === d.id ? 'true' : undefined} onClick={() => onOpen(h.id)}>
              <span className="row between wrap"><strong>{ORIGIN_LABELS[h.origin] ?? h.origin} · {bandLabel(h.band_code)}</strong><StatusBadges r={h} /></span>
              <small>{when(h.valid_at)} SGT · {humanize(h.status)}{h.supersedes_id ? ` · supersedes ${bandLabel(byId.get(h.supersedes_id)?.band_code)} (${humanize(byId.get(h.supersedes_id)?.origin ?? '')})` : ''}</small>
            </button>
          </li>
        ))}</ol>
      </section>
      <section aria-label="Linked records" className="row wrap">
        <Link className="btn" to={`/policies/${d.policy_id}?sale=${d.sale_event_id}&tab=risk`} state={from}><Icon name="briefcase" size="sm" /> Policy Detail {d.policy_ref}</Link>
        {d.cases.map((x) => <Link key={x.case_id} className="btn" to={x.route} state={from}><Icon name="files" size="sm" /> Call Detail {x.case_ref}</Link>)}
      </section>
    </div>
  );
}
