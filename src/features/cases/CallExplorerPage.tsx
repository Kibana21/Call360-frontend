// Call Explorer (`/calls`), F2: the server-side callback case register (API-035) with facet counts (API-036).
// Filters live in the URL so a register view can be bookmarked or opened from an Overview drilldown; the server
// applies Singapore scope, every filter and the identical KPI predicate (S0_SCREEN_SPEC "Call Explorer").
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/Icon';
import { Empty, Forbidden } from '../../components/StateView';
import { Badge, Button, Card, PageHead, StageChip } from '../../components/ui';
import {
  BAND_LABELS, CaseTable, count, failure, humanize, LIST_PARAMS, OUTCOME_LABELS, QUEUE_LABELS, Region, SCALAR_PARAMS,
  toQuery, when,
} from './shared';
import { useCasePages } from './useCasePages';

const SORTS: [string, string][] = [
  ['due_at', 'Due date (earliest first)'], ['-due_at', 'Due date (latest first)'], ['case_ref', 'Case reference'],
  ['risk_band', 'Risk (highest first)'], ['state', 'Case state'], ['-attempts', 'Most attempts'],
];
const FILTER_LABELS: Record<string, string> = {
  q: 'Search', state: 'State', outcome: 'Outcome', band: 'Risk', hold_reason: 'Hold reason', product_family: 'Product',
  ilp: 'ILP', overdue: 'Overdue', on_hold: 'On hold', due_from: 'Due from', due_to: 'Due before', queue: 'Queue',
};

function valueLabel(key: string, value: string): string {
  if (key === 'outcome') return OUTCOME_LABELS[value] ?? value;
  if (key === 'band') return BAND_LABELS[value] ?? value;
  if (key === 'queue') return QUEUE_LABELS[value] ?? value;
  if (key === 'ilp' || key === 'overdue' || key === 'on_hold') return value === 'true' ? 'Yes' : 'No';
  if (key === 'q' || key === 'due_from' || key === 'due_to') return value;
  return humanize(value);
}

export function CallExplorerPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = toQuery(params);
  const allowed = can('case.read');
  const pages = useCasePages(query, { enabled: allowed });
  const { kpi, kpi_set, from, to } = query;
  const facets = useQuery({
    queryKey: ['cases', 'facets', JSON.stringify(query)], enabled: allowed,
    queryFn: async () => unwrap(await api.GET('/api/v1/cases/facets', { params: { query } })),
  });
  const [text, setText] = useState(params.get('q') ?? '');
  useEffect(() => setText(params.get('q') ?? ''), [params]);

  if (!allowed) return <Forbidden />;
  const data = pages.result.data;
  if (pages.result.isError && failure(pages.result.error).status === 403) return <Forbidden />;

  const update = (mutate: (p: URLSearchParams) => void) => setParams((p) => { const n = new URLSearchParams(p); mutate(n); return n; });
  const setOne = (key: string, value: string) => update((p) => { p.delete(key); if (value) p.set(key, value); });
  const removeValue = (key: string, value: string) => update((p) => {
    const rest = p.getAll(key).filter((v) => v !== value);
    p.delete(key);
    rest.forEach((v) => p.append(key, v));
  });
  const clearKpi = () => update((p) => { ['kpi', 'kpi_set', 'from', 'to'].forEach((k) => p.delete(k)); });
  const submit = (e: FormEvent) => { e.preventDefault(); setOne('q', text.trim()); };
  const f = facets.data?.facets ?? {};
  const options = (dim: string) => {
    const current = params.getAll(dim);
    const codes = new Set([...Object.keys(f[dim] ?? {}), ...current]);
    return [...codes].sort().map((c) => ({ code: c, n: f[dim]?.[c] ?? 0 }));
  };
  const select = (dim: string, label: string, labels: (c: string) => string) => (
    <>
      <label className="sr-only" htmlFor={`f-${dim}`}>{label}</label>
      <select id={`f-${dim}`} className="field" value={params.getAll(dim).length === 1 ? params.get(dim)! : ''}
        onChange={(e) => setOne(dim, e.target.value)}>
        <option value="">{label}: all</option>
        {options(dim).map((o) => <option key={o.code} value={o.code}>{labels(o.code)} ({count(o.n)})</option>)}
      </select>
    </>
  );
  const chips: { key: string; value: string }[] = [];
  for (const k of LIST_PARAMS) params.getAll(k).forEach((v) => chips.push({ key: k, value: v }));
  for (const k of SCALAR_PARAMS) {
    const v = params.get(k);
    if (v && !['kpi', 'kpi_set', 'from', 'to', 'sort'].includes(k)) chips.push({ key: k, value: v });
  }
  const hasFilters = chips.length > 0 || !!kpi;

  return (
    <>
      <PageHead eyebrow="Call register" title="Call Explorer"
        description="All Singapore callback obligations with their attempts, sessions, risk and verification outcome. Filtering, sorting and paging run on the server."
        actions={<>
          <Button icon="download" disabled aria-describedby="ce-export">Export CSV</Button>
          <span id="ce-export"><StageChip label="Stage S4 — Export" /></span>
        </>} />
      <Card pad={false}>
        <form className="table-toolbar" role="search" aria-label="Filter callback cases" onSubmit={submit}>
          <label className="row" style={{ flex: 1, minWidth: 230, border: '1px solid #e3e6eb', padding: '0 11px', borderRadius: 8, height: 36 }}>
            <Icon name="search" size="sm" />
            <span className="sr-only">Search cases</span>
            <input className="field" style={{ border: 0, boxShadow: 'none', width: '100%' }} value={text} maxLength={64}
              onChange={(e) => setText(e.target.value)} placeholder="Case, policy, attempt or session ref; exact phone or email" />
          </label>
          <Button type="submit" variant="subtle" icon="search">Search</Button>
          {select('state', 'State', humanize)}
          {select('outcome', 'Outcome', (c) => OUTCOME_LABELS[c] ?? c)}
          {select('band', 'Risk', (c) => BAND_LABELS[c] ?? c)}
          {select('product_family', 'Product', humanize)}
          {select('hold_reason', 'Hold reason', humanize)}
        </form>
        <div className="table-toolbar">
          <label className="row small" htmlFor="f-due-from">Due from
            <input id="f-due-from" type="date" className="field" value={params.get('due_from') ?? ''} onChange={(e) => setOne('due_from', e.target.value)} /></label>
          <label className="row small" htmlFor="f-due-to">Due before
            <input id="f-due-to" type="date" className="field" value={params.get('due_to') ?? ''} onChange={(e) => setOne('due_to', e.target.value)} /></label>
          <label className="row small"><input type="checkbox" checked={params.get('overdue') === 'true'}
            onChange={(e) => setOne('overdue', e.target.checked ? 'true' : '')} /> Overdue only
            {f.overdue ? <span className="muted">({count(f.overdue.true ?? 0)})</span> : null}</label>
          <label className="row small"><input type="checkbox" checked={params.get('on_hold') === 'true'}
            onChange={(e) => setOne('on_hold', e.target.checked ? 'true' : '')} /> On hold</label>
          <label className="row small"><input type="checkbox" checked={params.get('ilp') === 'true'}
            onChange={(e) => setOne('ilp', e.target.checked ? 'true' : '')} /> ILP only</label>
          <span style={{ flex: 1 }} />
          <label className="sr-only" htmlFor="f-sort">Sort</label>
          <select id="f-sort" className="field" value={params.get('sort') ?? 'due_at'} onChange={(e) => setOne('sort', e.target.value === 'due_at' ? '' : e.target.value)}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
          </select>
          <Button variant="subtle" icon="refresh" disabled={!hasFilters} onClick={() => setParams(new URLSearchParams())}>Clear filters</Button>
        </div>
        {hasFilters ? (
          <div className="filter-chips" aria-label="Active filters">
            {kpi ? (
              <span className="filter-chip strong-chip">Overview drilldown: {kpi} {kpi_set} · due {from} → {to} (exclusive)
                <button type="button" aria-label="Remove the Overview drilldown" onClick={clearKpi}><Icon name="close" size="sm" /></button></span>
            ) : null}
            {chips.map((c) => (
              <span className="filter-chip" key={`${c.key}=${c.value}`}>{FILTER_LABELS[c.key] ?? c.key}: {valueLabel(c.key, c.value)}
                <button type="button" aria-label={`Remove filter ${FILTER_LABELS[c.key] ?? c.key} ${valueLabel(c.key, c.value)}`}
                  onClick={() => (LIST_PARAMS as readonly string[]).includes(c.key) ? removeValue(c.key, c.value) : setOne(c.key, '')}>
                  <Icon name="close" size="sm" /></button></span>
            ))}
          </div>
        ) : null}
        <div className="row between wrap" style={{ padding: '13px 18px', borderBottom: '1px solid var(--line)' }}>
          <span className="muted small" role="status" aria-live="polite" data-testid="register-total">
            {data ? <>Showing <b style={{ color: '#3e4c60' }}>{count(data.items.length)}</b> of <b style={{ color: '#3e4c60' }}>{count(data.total)}</b> matching cases
</> : 'Loading…'}
          </span>
          <div className="row">
            <Badge tone="blue">Case-level grain</Badge><Badge tone="gray">All attempts retained</Badge>
            <Badge tone="gray">Singapore only</Badge>{data?.synthetic_badge ? <Badge tone="blue">Synthetic</Badge> : null}
          </div>
        </div>
        {facets.isError ? <div className="xsmall muted" style={{ padding: '8px 18px' }} role="note">Filter counts are unavailable; the register below is unaffected.</div> : null}
        <Region query={pages.result} label="callback cases">{() => data!.markets.length === 0
          ? <Empty title="No market is assigned to your account">Callback cases are shown only for Singapore; ask an administrator for Singapore access.</Empty>
          : <CaseTable rows={data!.items} caption="Callback cases" emptyTitle="No matching cases"
            emptyHint={hasFilters ? 'Try removing a filter or clearing the search.' : 'No callback cases are in scope.'} />}</Region>
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
