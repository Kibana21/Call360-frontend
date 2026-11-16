// Review Workbench (`/reviews`, F7): compliance findings of in-scope cases (API-077) with server-side search, filters,
// sorting and paging held in the URL, and a read-only detail of the selected finding: its recorded question, answer,
// rule evaluation, controls and the case, policy and sale it belongs to. Finding severity is shown apart from the
// case's SBQ selection band. No review decision exists before Stage S3, so every adjudication action is disabled.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { Icon } from '../../components/Icon';
import { Empty, Forbidden } from '../../components/StateView';
import { Badge, Button, Card, PageHead, StageChip, type Tone } from '../../components/ui';
import { useAuth } from '../../auth/AuthContext';
import { failure, humanize, Region, RiskBadge, when } from '../cases/shared';
import { show } from '../scripts/shared';

type ReviewItem = components['schemas']['ReviewItem'];
const SEVERITY_TONES: Record<string, Tone> = { CRITICAL: 'red', HIGH: 'amber', MEDIUM: 'blue', LOW: 'gray' };
const PAGE = 10;
const SORTS: [string, string][] = [['severity', 'Most severe first'], ['-raised_at', 'Newest first'], ['raised_at', 'Oldest first'], ['case_ref', 'Case reference'], ['finding_ref', 'Finding reference']];

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge tone={SEVERITY_TONES[severity] ?? 'gray'}>{`${humanize(severity)} severity`}</Badge>;
}

export function ReviewWorkbenchPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const queue = params.get('queue') === 'ALL' ? 'ALL' : 'AWAITING_REVIEW';
  const offset = Number(params.get('offset') ?? 0) || 0;
  const query: Record<string, unknown> = {
    queue, limit: PAGE, offset, sort: params.get('sort') ?? 'severity',
    ...(params.get('q') ? { q: params.get('q') } : {}),
    ...(params.getAll('severity').length ? { severity: params.getAll('severity') } : {}),
    ...(params.getAll('status').length ? { status: params.getAll('status') } : {}),
    ...(params.getAll('category').length ? { category: params.getAll('category') } : {}),
    ...(params.get('material') ? { material: params.get('material') === 'true' } : {}),
  };
  const allowed = can('queue.read');
  const list = useQuery({
    queryKey: ['review-queue', params.toString()], enabled: allowed,
    queryFn: async () => unwrap(await api.GET('/api/v1/review-queue', { params: { query: query as never } })),
  });
  const [text, setText] = useState(params.get('q') ?? '');
  useEffect(() => setText(params.get('q') ?? ''), [params]);
  if (!allowed) return <Forbidden />;
  if (list.isError && failure(list.error).status === 403) return <Forbidden />;

  const update = (mutate: (p: URLSearchParams) => void) => setParams((p) => { const n = new URLSearchParams(p); mutate(n); n.delete('offset'); return n; });
  const setOne = (k: string, v: string) => update((p) => { p.delete(k); if (v) p.set(k, v); });
  const data = list.data;
  const selectedId = params.get('finding');
  const selected = data?.items.find((i) => i.id === selectedId) ?? data?.items[0] ?? null;
  const f = data?.facets ?? {};
  const material = data ? Object.entries(f.severity ?? {}).filter(([s]) => data.material_severities.includes(s)).reduce((n, [, c]) => n + c, 0) : undefined;

  return (
    <>
      <PageHead eyebrow="Human accountability" title="Review Workbench"
        description="Compliance findings on Singapore callback cases, with the recorded answer, rule result and controls behind each one. Read-only: review decisions arrive in Stage S3."
        actions={<>
          {['Assign work', 'Export review queue'].map((l) => <Button key={l} tiny disabled aria-describedby="rw-s3">{l}</Button>)}
          <span id="rw-s3"><StageChip label="Stage S3 — review decisions" /></span>
        </>} />
      <div className="topnotice" role="note"><div className="row"><Icon name="info" size="sm" />
        <span><strong>Seeded synthetic findings.</strong> They were not produced by a Call360 voice session or compliance evaluation. No finding has been confirmed, dismissed or closed by a reviewer.</span></div></div>

      <div className="layout cols-4" style={{ marginBottom: 18 }} aria-label="Findings summary for this queue">
        <Tile label={queue === 'ALL' ? 'Findings' : 'Awaiting review'} value={data ? Object.values(f.status ?? {}).reduce((a, b) => a + b, 0) : undefined} sub="Open or under review unless “All findings”" accent />
        <Tile label="Critical severity" value={data ? f.severity?.CRITICAL ?? 0 : undefined} sub="Compliance finding severity" />
        <Tile label="Material" value={material} sub={data ? `Materiality policy: ${data.material_severities.map(humanize).join(', ')}` : ''} />
        <Tile label="Under review" value={data ? f.status?.UNDER_REVIEW ?? 0 : undefined} sub="No reviewer decision recorded in Stage 0" />
      </div>

      <div className="subtabs" role="tablist" aria-label="Review queues" style={{ marginBottom: 14 }}>
        {(['AWAITING_REVIEW', 'ALL'] as const).map((qv) => (
          <button key={qv} type="button" role="tab" aria-selected={queue === qv} className={queue === qv ? 'active' : ''}
            onClick={() => update((p) => { p.delete('finding'); if (qv === 'ALL') p.set('queue', 'ALL'); else p.delete('queue'); })}>
            {qv === 'ALL' ? 'All findings' : 'Awaiting review'}</button>
        ))}
      </div>

      <div className="layout rw-grid">
        <Card pad={false} title="Findings queue" subtitle="Search and filters run on the server"
          aside={data ? <Badge tone="gray" noDot>{`${data.total} matching`}</Badge> : undefined}>
          <form className="table-toolbar" role="search" aria-label="Filter findings" onSubmit={(e: FormEvent) => { e.preventDefault(); setOne('q', text.trim()); }}>
            <label className="sr-only" htmlFor="rw-q">Search findings</label>
            <input id="rw-q" className="field grow" placeholder="Finding, case, policy, sale or question code" value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" icon="search">Search</Button>
            <Select id="rw-severity" label="Severity" value={params.get('severity') ?? ''} onChange={(v) => setOne('severity', v)}
              options={['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => [s, `${humanize(s)} (${f.severity?.[s] ?? 0})`])} />
            <Select id="rw-status" label="Status" value={params.get('status') ?? ''} onChange={(v) => setOne('status', v)}
              options={Object.entries(f.status ?? {}).map(([s, n]) => [s, `${humanize(s)} (${n})`])} />
            <Select id="rw-category" label="Category" value={params.get('category') ?? ''} onChange={(v) => setOne('category', v)}
              options={Object.entries(f.category ?? {}).map(([s, n]) => [s, `${humanize(s)} (${n})`])} />
            <Select id="rw-material" label="Materiality" value={params.get('material') ?? ''} onChange={(v) => setOne('material', v)}
              options={[['true', 'Material only'], ['false', 'Not material']]} />
            <Select id="rw-sort" label="Sort" value={params.get('sort') ?? 'severity'} onChange={(v) => setOne('sort', v === 'severity' ? '' : v)} options={SORTS} noAll />
          </form>
          <Region query={list} label="findings">
            {() => data!.items.length === 0 ? (
              <Empty title={queue === 'ALL' ? 'No findings match' : 'No findings are awaiting review'}>Clear a filter or switch to “All findings”.</Empty>
            ) : (
              <>
                <ul className="plain-list rw-list" data-testid="review-list" aria-label="Findings">
                  {data!.items.map((i) => (
                    <li key={i.id}>
                      <button type="button" className={`review-card${selected?.id === i.id ? ' active' : ''}`} aria-pressed={selected?.id === i.id}
                        onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('finding', i.id); return n; })}>
                        <span className="activity-icon" aria-hidden="true"><Icon name="flag" /></span>
                        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                          <span className="row between wrap"><strong className="mono small">{i.finding_ref}</strong><SeverityBadge severity={i.severity} /></span>
                          <span className="small" style={{ display: 'block', margin: '6px 0' }}>{humanize(i.category)}{i.evidence.question_code ? ` · ${i.evidence.question_code}` : ''}</span>
                          <span className="row between wrap xsmall muted"><span>{i.case_ref} · {i.policy_ref}</span><span>{humanize(i.status)} · raised {when(i.raised_at).split(',')[0]}</span></span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Pager total={data!.total} offset={offset} onPage={(o) => setParams((p) => { const n = new URLSearchParams(p); n.delete('finding'); if (o) n.set('offset', String(o)); else n.delete('offset'); return n; })} />
              </>
            )}
          </Region>
        </Card>
        <div>{selected ? <FindingDetail i={selected} /> : data && data.items.length ? null : <Card title="Finding detail"><Empty title="Select a finding" /></Card>}</div>
      </div>
    </>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: number | undefined; sub: string; accent?: boolean }) {
  return (
    <div className={`card kpi${accent ? ' accent' : ''}`}>
      <div className="kpi-top"><span>{label}</span></div>
      <div className="kpi-number">{value ?? '—'}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

function Select({ id, label, value, onChange, options, noAll }: {
  id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][]; noAll?: boolean;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {noAll ? null : <option value="">{label}: all</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </>
  );
}

function Pager({ total, offset, onPage }: { total: number; offset: number; onPage: (o: number) => void }) {
  if (total <= PAGE) return null;
  const end = Math.min(offset + PAGE, total);
  return (
    <div className="row between" style={{ padding: '12px 17px', borderTop: '1px solid var(--line)' }}>
      <span className="xsmall muted" data-testid="review-page">{offset + 1}–{end} of {total}</span>
      <span className="row">
        <Button tiny onClick={() => onPage(Math.max(0, offset - PAGE))} disabled={offset === 0}>Previous</Button>
        <Button tiny onClick={() => onPage(offset + PAGE)} disabled={end >= total}>Next</Button>
      </span>
    </div>
  );
}

function FindingDetail({ i }: { i: ReviewItem }) {
  const e = i.evidence;
  return (
    <section className="card card-pad rw-detail" aria-labelledby="rw-detail-title" data-testid="finding-detail">
      <div className="row wrap"><SeverityBadge severity={i.severity} />{i.material ? <Badge tone="red">Material</Badge> : null}
        <Badge tone="gray">{humanize(i.status)}</Badge><Badge tone="purple">{humanize(i.origin)}</Badge></div>
      <h2 id="rw-detail-title" style={{ fontSize: 20, margin: '12px 0 4px' }} className="mono">{i.finding_ref}</h2>
      <p className="small muted" style={{ margin: 0 }}>{humanize(i.category)} · raised {when(i.raised_at)} SGT</p>

      <div className="info-grid" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))', marginTop: 16 }}>
        <div className="info-tile"><label>Callback case</label><strong><Link className="link" to={`/cases/${i.case_id}`}>{i.case_ref}</Link></strong>
          <div className="xsmall muted">{humanize(i.case_state)}</div></div>
        <div className="info-tile"><label>Policy · sale</label><strong><Link className="link" to={`/policies/${i.policy_id}?sale=${i.sale_event_id}`}>{i.policy_ref}</Link></strong>
          <div className="xsmall muted mono">{i.sale_ref}</div></div>
        <div className="info-tile"><label>Finding severity</label><strong>{humanize(i.severity)}</strong><div className="xsmall muted">Compliance attribute of this finding</div></div>
        <div className="info-tile"><label>SBQ selection risk (case)</label><strong><RiskBadge band={i.selection_risk_band} /></strong>
          <div className="xsmall muted">Why the case was selected — not a finding</div></div>
      </div>

      <div className="section-label" style={{ marginTop: 18 }}>Recorded evidence</div>
      <dl className="kv rw-kv">
        <dt>Question</dt><dd>{e.question_code ? <><span className="mono">{e.question_code}</span>{e.question_wording ? ` — ${e.question_wording}` : ''}</> : 'Not linked to a question'}</dd>
        <dt>Controls</dt><dd>{e.controls.length ? e.controls.join(', ') : '—'}</dd>
        <dt>Answer state</dt><dd>{e.answer_state ? humanize(e.answer_state) : '—'}</dd>
        <dt>Typed answer</dt><dd>{show(e.typed_value)}</dd>
        {e.verbatim_redacted ? <><dt>Verbatim (redacted)</dt><dd>“{e.verbatim_redacted}”</dd></> : null}
        <dt>Rule evaluation</dt><dd>{e.rule_ref ? `${e.rule_ref} v${e.rule_version ?? '—'} · ${humanize(e.rule_result ?? '—')}` : 'No rule evaluation (narrative flag)'}</dd>
        {e.rule_ref ? <><dt>Expected · observed</dt><dd>{show(e.rule_expected)} · {show(e.rule_observed)}</dd></> : null}
        <dt>Transcript</dt><dd>{e.transcript === 'NOT_AVAILABLE' ? 'Not available — transcripts are captured from Stage S1' : humanize(e.transcript)}</dd>
        <dt>Recording</dt><dd>Not available — recordings are captured from Stage S1</dd>
        <dt>Review</dt><dd>{i.review_closed_at ? `Closed ${when(i.review_closed_at)}` : 'No review decision recorded'}{i.reviewer_assigned ? ' · reviewer assigned' : ' · no reviewer assigned'}</dd>
      </dl>
      {e.label ? <p className="xsmall muted">{e.label}</p> : null}

      <div className="row wrap" style={{ marginTop: 14 }}>
        <Link className="btn primary" to={`/cases/${i.case_id}`} data-testid="open-call-detail">Open Call Detail</Link>
        {['Confirm', 'Reject', 'Request info', 'Assign', 'Send to checker'].map((l) => <Button key={l} tiny disabled aria-describedby="rw-detail-s3">{l}</Button>)}
        <span id="rw-detail-s3"><StageChip label="Stage S3" /></span>
      </div>
    </section>
  );
}
