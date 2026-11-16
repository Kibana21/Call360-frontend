// Script Studio library (`/scripts`, F6): every script version in the caller's markets (API-060) with server-side
// filters in the URL, plus the controls (API-066) and regulatory references (API-065) the questions link to.
// Read-only: drafting, review and publishing are Stage S2.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { Empty } from '../../components/StateView';
import { Badge, Button, Card, PageHead } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import { S2Actions, scriptHref, short, StatusBadge, SyntheticBanner } from './shared';

const STATUSES = ['DRAFT', 'SUBMITTED_FOR_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'SUPERSEDED', 'WITHDRAWN'] as const;
type Status = (typeof STATUSES)[number];

export function ScriptLibraryPage() {
  const [params, setParams] = useSearchParams();
  const query = {
    status: params.getAll('status') as Status[],
    language: params.get('language') ?? undefined,
    effective_on: params.get('effective_on') ?? undefined,
    product_family: params.get('product_family') ?? undefined,
    risk_band: params.get('risk_band') ?? undefined,
    channel: params.get('channel') ?? undefined,
    q: params.get('q') ?? undefined,
  };
  const library = useQuery({
    queryKey: ['scripts', params.toString()],
    queryFn: async () => unwrap(await api.GET('/api/v1/scripts', { params: { query } })),
  });
  const [text, setText] = useState(params.get('q') ?? '');
  useEffect(() => setText(params.get('q') ?? ''), [params]);
  const setOne = (k: string, v: string) => setParams((p) => { const n = new URLSearchParams(p); n.delete(k); if (v) n.set(k, v); return n; });
  const facets = library.data?.facets ?? {};
  const filtered = [...params.keys()].length > 0;

  return (
    <>
      <PageHead eyebrow="Controlled questionnaires" title="Script Studio"
        description="Versioned callback scripts: modules, questions, expected answers, controls and the assignment rules that select them. Read-only in Stage 0."
        actions={<>
          <Link className="btn" to="/assignment-rules">View assignment rules</Link>
          <S2Actions id="ss-s2" labels={['New script draft']} />
        </>} />
      <SyntheticBanner />

      <Card pad={false} title="Script library" subtitle="Every version in your markets, with its lifecycle status. Filters run on the server."
        aside={library.data ? <Badge tone="gray" noDot>{`${library.data.total} version${library.data.total === 1 ? '' : 's'}`}</Badge> : undefined}>
        <form className="table-toolbar" role="search" aria-label="Filter scripts"
          onSubmit={(e: FormEvent) => { e.preventDefault(); setOne('q', text.trim()); }}>
          <label className="sr-only" htmlFor="ss-q">Search scripts</label>
          <input id="ss-q" className="field wide" placeholder="Family, version or module" value={text} onChange={(e) => setText(e.target.value)} />
          <FacetSelect id="ss-status" label="Status" value={params.get('status') ?? ''} onChange={(v) => setOne('status', v)}
            options={STATUSES.map((s) => [s, `${humanize(s)} (${facets.status?.[s] ?? 0})`])} />
          <FacetSelect id="ss-product" label="Product" value={params.get('product_family') ?? ''} onChange={(v) => setOne('product_family', v)}
            options={Object.entries(facets.product_family ?? {}).map(([k, n]) => [k, `${humanize(k)} (${n})`])} />
          <FacetSelect id="ss-band" label="Risk band" value={params.get('risk_band') ?? ''} onChange={(v) => setOne('risk_band', v)}
            options={Object.entries(facets.risk_band ?? {}).map(([k, n]) => [k, `${humanize(k)} (${n})`])} />
          <FacetSelect id="ss-channel" label="Channel" value={params.get('channel') ?? ''} onChange={(v) => setOne('channel', v)}
            options={Object.entries(facets.channel ?? {}).map(([k, n]) => [k, `${humanize(k)} (${n})`])}
            emptyNote="No channel-specific modules" />
          <FacetSelect id="ss-language" label="Language" value={params.get('language') ?? ''} onChange={(v) => setOne('language', v)}
            options={Object.entries(facets.language ?? {}).map(([k, n]) => [k, `${k} (${n})`])} />
          <label className="sr-only" htmlFor="ss-effective">Effective on</label>
          <input id="ss-effective" type="date" className="field" value={params.get('effective_on') ?? ''} title="Effective on"
            onChange={(e) => setOne('effective_on', e.target.value)} />
          <Button type="submit" icon="search">Search</Button>
          {filtered ? <Button onClick={() => setParams(new URLSearchParams())}>Clear filters</Button> : null}
        </form>
        <p className="xsmall muted" style={{ margin: '0 17px 10px' }}>
          Product, risk band and channel match the conditions written on each version's modules; no case is evaluated.
        </p>
        <Region query={library} label="script library">
          {() => library.data!.items.length === 0 ? (
            <Empty title="No script versions match">Clear a filter to see more versions.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data-table" data-testid="script-library">
                <caption className="sr-only">Script versions</caption>
                <thead><tr>
                  <th scope="col">Script version</th><th scope="col">Status</th><th scope="col">Effective</th><th scope="col">Modules</th>
                  <th scope="col">Questions</th><th scope="col">Assigned cases</th><th scope="col">Rules</th><th scope="col">Manifest</th>
                </tr></thead>
                <tbody>
                  {library.data!.items.map((v) => (
                    <tr key={v.id}>
                      <td><Link className="link" to={scriptHref(v.script_family_id, v.id)}>{v.family} v{v.version_label}</Link>
                        <div className="xsmall muted">{v.family_name} · {v.market} · {v.language}</div></td>
                      <td><StatusBadge status={v.status} /></td>
                      <td>{v.effective_from ? when(v.effective_from).split(',')[0] : 'Not set'}{v.effective_to ? ` – ${when(v.effective_to).split(',')[0]}` : ''}</td>
                      <td>{v.modules.map((m) => humanize(m.module_code)).join(' · ')}</td>
                      <td>{v.questions} <span className="xsmall muted">({v.mandatory_questions} mandatory)</span></td>
                      <td>{v.cases_assigned}</td>
                      <td>{v.rules_targeting.length ? v.rules_targeting.join(', ') : '—'}</td>
                      <td className="mono xsmall" title={v.manifest_sha256 ?? 'Draft — no frozen manifest'}>{v.manifest_sha256 ? short(v.manifest_sha256) : 'Draft'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Region>
      </Card>

      <div className="layout cols-even" style={{ marginTop: 19 }}>
        <ControlsCard />
        <ReferencesCard />
      </div>
    </>
  );
}

function FacetSelect({ id, label, value, onChange, options, emptyNote }: {
  id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][]; emptyNote?: string;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)} disabled={!options.length && !value}
        title={!options.length && emptyNote ? emptyNote : undefined}>
        <option value="">{options.length || value ? `${label}: all` : `${label}: ${emptyNote ?? 'none'}`}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </>
  );
}

function ControlsCard() {
  const controls = useQuery({ queryKey: ['controls'], queryFn: async () => unwrap(await api.GET('/api/v1/controls')) });
  return (
    <Card title="Controls" subtitle="Proposed S&C controls and the questions that evidence them" pad>
      <Region query={controls} label="controls">
        {() => controls.data!.items.length === 0 ? <Empty title="No controls linked to scripts in your markets" /> : (
          <div className="stack" data-testid="controls">
            {controls.data!.items.map((c) => (
              <details key={c.id} className="softbox">
                <summary className="row between wrap" style={{ cursor: 'pointer' }}>
                  <span><span className="mono strong small">{c.control_code}</span> <span className="small">{c.name}</span></span>
                  <span className="row"><Badge tone="amber">{humanize(c.content_approval_status)}</Badge><span className="xsmall muted">{c.questions.length} question{c.questions.length === 1 ? '' : 's'}</span></span>
                </summary>
                <ul className="plain-list" style={{ marginTop: 10 }}>
                  {c.questions.map((q) => (
                    <li key={q.question_code} className="small">
                      <span className="mono strong">{q.question_code}</span> — {q.intent ?? '—'}
                      <div className="xsmall muted">In {q.script_versions.join(', ')} · mapping {humanize(q.mapping_status)}
                        {q.regulatory_reference_title ? ` · regulatory reference: ${q.regulatory_reference_title}` : ''}</div>
                    </li>
                  ))}
                </ul>
                <div className="xsmall muted">Owner: {c.owner_role ?? '—'}</div>
              </details>
            ))}
          </div>
        )}
      </Region>
    </Card>
  );
}

function ReferencesCard() {
  const refs = useQuery({ queryKey: ['regulatory-references'], queryFn: async () => unwrap(await api.GET('/api/v1/regulatory-references')) });
  return (
    <Card title="Regulatory references" subtitle="Public references, kept separate from AIA controls; interpretation by S&C is pending" pad>
      <Region query={refs} label="regulatory references">
        {() => refs.data!.items.length === 0 ? <Empty title="No regulatory references in your markets" /> : (
          <div className="stack" data-testid="regulatory-references">
            {refs.data!.items.map((r) => (
              <div key={r.id} className="softbox">
                <div className="row between wrap"><strong className="small">{r.title}</strong><Badge tone="gray">{humanize(r.interpretation_status)}</Badge></div>
                <div className="xsmall muted" style={{ marginTop: 6 }}>{r.issuer} · {r.jurisdiction}{r.document_version ? ` · ${r.document_version}` : ''}
                  {r.published_on ? ` · ${r.published_on}` : ''} · linked controls: {r.controls.length ? r.controls.join(', ') : 'none'}</div>
              </div>
            ))}
          </div>
        )}
      </Region>
    </Card>
  );
}
