// Policy Explorer (`/policies`), F4: the server-side Singapore policy register (API-050) following the mockup's
// "Policy & Sales" screen. Filters live in the URL; the server applies scope, every filter, facets and keyset
// paging. Names are masked by the server; no contact value is shown in the list.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { PolicyQuery, PolicyRow } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Icon, type IconName } from '../../components/Icon';
import { Empty, Forbidden } from '../../components/StateView';
import { Badge, Button, Card, PageHead, StageChip } from '../../components/ui';
import { BAND_LABELS, count, failure, humanize, OUTCOME_LABELS, Region, RiskBadge, useFrom, when } from '../cases/shared';
import { usePolicyPages } from '../cases/useCasePages';

const LIST = ['product_family', 'band', 'channel', 'sale_type', 'case_state', 'outcome'] as const;
const SCALAR = ['q', 'ilp', 'multi_sale', 'sort'] as const;
const SORTS: [string, string][] = [
  ['-latest_sold_at', 'Latest sale (newest first)'], ['latest_sold_at', 'Latest sale (oldest first)'], ['policy_ref', 'Policy reference'],
  ['-premium_amount', 'Premium (highest first)'], ['risk_band', 'Risk (highest first)'], ['-cases', 'Most callback cases'],
];
const LABELS: Record<string, string> = {
  q: 'Search', product_family: 'Product', band: 'Risk', channel: 'Channel', sale_type: 'Sale type', case_state: 'Latest case',
  outcome: 'Latest outcome', ilp: 'ILP', multi_sale: 'Multiple sales',
};

export function toPolicyQuery(params: URLSearchParams): PolicyQuery {
  const q: Record<string, unknown> = {};
  for (const k of LIST) {
    const v = params.getAll(k).filter(Boolean);
    if (v.length) q[k] = v;
  }
  for (const k of SCALAR) {
    const v = params.get(k);
    if (v) q[k] = v;
  }
  return q as PolicyQuery;
}

const valueLabel = (key: string, v: string) => key === 'band' ? BAND_LABELS[v] ?? v : key === 'outcome' ? OUTCOME_LABELS[v] ?? v
  : key === 'ilp' || key === 'multi_sale' ? (v === 'true' ? 'Yes' : 'No') : key === 'q' ? v : humanize(v);
const money = (n: number | null | undefined, c?: string | null) => (n == null ? '—' : `${c ?? ''} ${n.toLocaleString('en-SG', { maximumFractionDigits: 2 })}`);

export function PolicyExplorerPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = toPolicyQuery(params);
  const allowed = can('policy.read');
  const pages = usePolicyPages(query, { enabled: allowed });
  const [text, setText] = useState(params.get('q') ?? '');
  useEffect(() => setText(params.get('q') ?? ''), [params]);

  if (!allowed) return <Forbidden />;
  if (pages.result.isError && failure(pages.result.error).status === 403) return <Forbidden />;
  const data = pages.result.data;
  const f = data?.facets ?? {};

  const update = (mutate: (p: URLSearchParams) => void) => setParams((p) => { const n = new URLSearchParams(p); mutate(n); return n; });
  const setOne = (key: string, value: string) => update((p) => { p.delete(key); if (value) p.set(key, value); });
  const removeValue = (key: string, value: string) => update((p) => {
    const rest = p.getAll(key).filter((v) => v !== value);
    p.delete(key);
    rest.forEach((v) => p.append(key, v));
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setOne('q', text.trim()); };
  const select = (dim: string, label: string, labels: (c: string) => string) => {
    const codes = [...new Set([...Object.keys(f[dim] ?? {}), ...params.getAll(dim)])].sort();
    return (
      <>
        <label className="sr-only" htmlFor={`pf-${dim}`}>{label}</label>
        <select id={`pf-${dim}`} className="field" value={params.getAll(dim).length === 1 ? params.get(dim)! : ''} onChange={(e) => setOne(dim, e.target.value)}>
          <option value="">{label}: all</option>
          {codes.map((c) => <option key={c} value={c}>{labels(c)} ({count(f[dim]?.[c] ?? 0)})</option>)}
        </select>
      </>
    );
  };
  const chips: { key: string; value: string }[] = [];
  for (const k of LIST) params.getAll(k).forEach((value) => chips.push({ key: k, value }));
  for (const k of SCALAR) { const v = params.get(k); if (v && k !== 'sort') chips.push({ key: k, value: v }); }
  const facetTotal = (dim: string) => Object.values(f[dim] ?? {}).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHead eyebrow="Policy & sale context" title="Policy Explorer"
        description="Authoritative Singapore policy, sale and contact context for selecting and investigating a callback. Read-only; filtering and paging run on the server."
        actions={<>
          <Button icon="plus" disabled aria-describedby="pe-intake">Manual intake</Button>
          <Button variant="primary" icon="refresh" disabled aria-describedby="pe-intake">Sync from source</Button>
          <span id="pe-intake"><StageChip label="Data Intake — CP0.4" /></span>
        </>} />
      <div className="layout cols-4" style={{ marginBottom: 18 }} aria-label="Policy summary for the current filters">
        <Tile label="Policies in scope" value={data?.total} sub="Matching the current filters" icon="briefcase" accent />
        <Tile label="ILP policies" value={data ? f.ilp?.true ?? 0 : undefined} sub="Investment-linked; ILP script sections" icon="layers" />
        <Tile label="High selection risk" value={data ? f.band?.HIGH ?? 0 : undefined} sub="Effective SBQ band of the latest sale" icon="alert" />
        <Tile label="Multiple sale events" value={data ? f.multi_sale?.true ?? 0 : undefined} sub={`Top-ups and replacements · of ${count(facetTotal('multi_sale'))}`} icon="database" />
      </div>
      <Card pad={false}>
        <form className="table-toolbar" role="search" aria-label="Filter policies" onSubmit={submit}>
          <label className="row" style={{ flex: 1, minWidth: 230, border: '1px solid #e3e6eb', padding: '0 11px', borderRadius: 8, height: 36 }}>
            <Icon name="search" size="sm" />
            <span className="sr-only">Search policies</span>
            <input className="field" style={{ border: 0, boxShadow: 'none', width: '100%' }} value={text} maxLength={64}
              onChange={(e) => setText(e.target.value)} placeholder="Policy, sale, party, case or FSC ref; exact phone or email" />
          </label>
          <Button type="submit" variant="subtle" icon="search">Search</Button>
          {select('product_family', 'Product', humanize)}
          {select('band', 'Risk', (c) => BAND_LABELS[c] ?? c)}
          {select('channel', 'Channel', humanize)}
          {select('sale_type', 'Sale type', humanize)}
          {select('case_state', 'Latest case', humanize)}
        </form>
        <div className="table-toolbar">
          <label className="row small"><input type="checkbox" checked={params.get('ilp') === 'true'} onChange={(e) => setOne('ilp', e.target.checked ? 'true' : '')} /> ILP only</label>
          <label className="row small"><input type="checkbox" checked={params.get('multi_sale') === 'true'} onChange={(e) => setOne('multi_sale', e.target.checked ? 'true' : '')} /> Multiple sale events</label>
          <span style={{ flex: 1 }} />
          <label className="sr-only" htmlFor="pf-sort">Sort</label>
          <select id="pf-sort" className="field" value={params.get('sort') ?? '-latest_sold_at'} onChange={(e) => setOne('sort', e.target.value === '-latest_sold_at' ? '' : e.target.value)}>
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
          <span className="muted small" role="status" aria-live="polite" data-testid="policy-total">
            {data ? <>Showing <b style={{ color: '#3e4c60' }}>{count(data.items.length)}</b> of <b style={{ color: '#3e4c60' }}>{count(data.total)}</b> matching policies</> : 'Loading…'}
          </span>
          <div className="row"><Badge tone="blue">Policy grain</Badge><Badge tone="gray">Source lineage available</Badge><Badge tone="gray">Singapore only</Badge>
            {data?.synthetic_badge ? <Badge tone="blue">Synthetic</Badge> : null}</div>
        </div>
        <Region query={pages.result} label="policies">{() => data!.markets.length === 0
          ? <Empty title="No market is assigned to your account">Policies are shown only for Singapore; ask an administrator for Singapore access.</Empty>
          : <PolicyTable rows={data!.items} emptyHint={chips.length ? 'Try removing a filter or clearing the search.' : 'No policies are in scope.'} />}</Region>
        <div className="row between wrap" style={{ padding: '14px 18px', borderTop: '1px solid var(--line)' }}>
          <span className="small muted">{data ? `Data as of ${when(data.data_as_of)} SGT · ` : ''}Page {pages.pageNumber} · {pages.limit} per page</span>
          <div className="row">
            <Button tiny disabled={!pages.hasPrevious} onClick={pages.previous} aria-label="Previous page">Previous</Button>
            <Button tiny disabled={!pages.hasNext} onClick={pages.next} aria-label="Next page">Next</Button>
          </div>
        </div>
      </Card>
    </>
  );
}

function Tile({ label, value, sub, icon, accent }: { label: string; value: number | undefined; sub: string; icon: IconName; accent?: boolean }) {
  return (
    <section className={`card kpi${accent ? ' accent' : ''}`} aria-label={label}>
      <div className="kpi-top"><span>{label}</span><div className="kpi-icon"><Icon name={icon} /></div></div>
      <div className="kpi-number">{value == null ? '—' : count(value)}</div>
      <div className="kpi-sub">{sub}</div>
    </section>
  );
}

function PolicyTable({ rows, emptyHint }: { rows: PolicyRow[]; emptyHint: string }) {
  const from = useFrom();
  if (!rows.length) return <Empty title="No matching policies">{emptyHint}</Empty>;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Policies (scrolls horizontally)">
      <table className="data-table" data-testid="policy-table">
        <caption className="sr-only">Policies</caption>
        <thead><tr>
          <th scope="col">Policy / sale</th><th scope="col">Policyholder / insured</th><th scope="col">Product</th><th scope="col">Premium</th>
          <th scope="col">Sales channel / FSC</th><th scope="col">SBQ risk</th><th scope="col">Callback</th><th scope="col"><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.policy_id} data-policy-ref={r.policy_ref}>
              <td><Link className="link mono" to={r.route} state={from}>{r.policy_ref}</Link>
                <div className="small muted" style={{ marginTop: 5 }}>{r.latest_sold_at ? when(r.latest_sold_at) : '—'}</div>
                {r.sales > 1 ? <div style={{ marginTop: 5 }}><Badge tone="purple">{r.sales} sales · {r.sale_types.filter((t) => t !== 'NEW_BUSINESS').map(humanize).join(', ')}</Badge></div> : null}</td>
              <td><b>{r.owner}</b><div className="small muted" style={{ marginTop: 5 }}>Insured: {r.insured}</div></td>
              <td>{humanize(r.product_family)}{r.is_ilp && r.product_family !== 'ILP' ? <> <Badge tone="dark" noDot>ILP</Badge></> : null}
                <div className="small muted mono" style={{ marginTop: 5 }}>{r.product_code}</div></td>
              <td>{money(r.premium_amount, r.currency)}<div className="small muted" style={{ marginTop: 5 }}>{r.premium_frequency ? humanize(r.premium_frequency) : '—'}</div></td>
              <td>{r.selling_channel ? humanize(r.selling_channel) : '—'}<div className="small muted" style={{ marginTop: 5 }}>{r.selling_location ?? '—'} · <span className="mono">{r.fsc_ref ?? '—'}</span></div></td>
              <td><RiskBadge band={r.risk_band} /></td>
              <td>{r.latest_case_id ? <Link className="link mono" to={`/cases/${r.latest_case_id}`} state={from} tabIndex={-1} aria-label={`${r.latest_case_ref} Call Detail`}>{r.latest_case_ref}</Link> : <span className="muted">No case</span>}
                <div className="small muted" style={{ marginTop: 5 }}>{r.latest_case_state ? humanize(r.latest_case_state) : ''}{r.cases > 1 ? ` · ${r.cases} cases` : ''}</div></td>
              <td><Link className="btn tiny" to={r.route} state={from} aria-label={`Policy Detail ${r.policy_ref}`} tabIndex={-1}>Policy Detail</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
