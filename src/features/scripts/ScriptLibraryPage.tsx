// Script Studio library (`/scripts`, F6): every script version in the caller's markets (API-060) with server-side
// filters in the URL, plus the controls (API-066) and regulatory references (API-065) the questions link to.
// S2-A.2: shown as one card per script family (the version in use first; drafts and older versions underneath);
// controls and references are folded away below the list.
// S2-A: users with script.edit create new script families here; drafting, review and publishing happen on the family page.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { Empty } from '../../components/StateView';
import { Badge, Button, Card, PageHead } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import { useAuth } from '../../auth/AuthContext';
import { NewScriptForm } from './ScriptEditor';
import { compareLabels, scriptHref, StatusBadge, SyntheticBanner, type ScriptVersionSummary } from './shared';

const STATUSES = ['DRAFT', 'SUBMITTED_FOR_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'SUPERSEDED', 'WITHDRAWN', 'ABANDONED'] as const;
type Status = (typeof STATUSES)[number];
const OPEN = ['DRAFT', 'SUBMITTED_FOR_REVIEW', 'APPROVED', 'SCHEDULED'];

/** Groups the server's version list by family (first-seen order), newest version first inside each family. */
export function groupByFamily(items: ScriptVersionSummary[]): Array<{ id: string; versions: ScriptVersionSummary[] }> {
  const by = new Map<string, ScriptVersionSummary[]>();
  for (const v of items) by.set(v.script_family_id, [...(by.get(v.script_family_id) ?? []), v]);
  return [...by].map(([id, vs]) => ({ id, versions: [...vs].sort((a, b) => compareLabels(b.version_label, a.version_label)) }));
}

export function ScriptLibraryPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
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
  const families = groupByFamily(library.data?.items ?? []);

  return (
    <>
      <PageHead eyebrow="Controlled questionnaires" title="Script Studio"
        description="Versioned callback scripts: modules, questions, expected answers, controls and the assignment rules that select them. Drafts are edited here and published only after an independent S&C checker approves them."
        actions={<>
          <Link className="btn" to="/assignment-rules">View assignment rules</Link>
          {can('script.edit') ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={creating} data-testid="new-script">New script</Button> : null}
        </>} />
      <SyntheticBanner />
      {creating ? <NewScriptForm onCancel={() => setCreating(false)} /> : null}

      <Card pad={false} title="Scripts" subtitle="One card per script. Each shows the version in use; drafts and older versions are listed underneath."
        aside={library.data ? <Badge tone="gray" noDot>{`${families.length} script${families.length === 1 ? '' : 's'} · ${library.data.total} version${library.data.total === 1 ? '' : 's'}`}</Badge> : undefined}>
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
          Filters apply to versions: a script is shown when at least one of its versions matches. Product, risk band and channel match the
          conditions written on each version's sections; no case is evaluated.
        </p>
        <Region query={library} label="script library">
          {() => families.length === 0 ? (
            <Empty title="No script versions match">Clear a filter to see more versions.</Empty>
          ) : (
            <ul className="family-list" data-testid="script-library" aria-label="Scripts">
              {families.map((f) => <FamilyCard key={f.id} versions={f.versions} />)}
            </ul>
          )}
        </Region>
      </Card>

      <details className="card card-pad ss-reference" style={{ marginTop: 19 }} data-testid="controls-and-references">
        <summary className="strong">Controls and regulatory references
          <span className="xsmall muted" style={{ fontWeight: 400 }}> · why the questions exist: the S&C controls they evidence and the public references behind them</span></summary>
        <div className="layout cols-even" style={{ marginTop: 16 }}>
          <ControlsCard />
          <ReferencesCard />
        </div>
      </details>
    </>
  );
}

/** One script family: the version in use as the headline, then every listed version (newest first) as a link. */
function FamilyCard({ versions }: { versions: ScriptVersionSummary[] }) {
  const head = versions[0]!;
  const live = versions.find((v) => v.status === 'PUBLISHED') ?? null;
  const open = versions.find((v) => OPEN.includes(v.status)) ?? null;
  const main = live ?? open ?? head;
  return (
    <li className="family-card" data-testid={`family-${head.family}`}>
      <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h3 className="family-name"><Link className="link" to={scriptHref(head.script_family_id, main.id)}>{head.family_name}</Link></h3>
          <div className="xsmall muted"><span className="mono">{head.family}</span> · {head.market} · {head.language}</div>
        </div>
        {live ? <Badge tone="green">{`In use: v${live.version_label}`}</Badge> : <Badge tone="gray">No version in use</Badge>}
      </div>
      <p className="small family-facts">
        {live ? <>
          <strong>v{live.version_label}</strong> in use{live.effective_from ? ` from ${when(live.effective_from).split(',')[0]}` : ''} ·{' '}
          {live.questions} questions ({live.mandatory_questions} mandatory) · {live.cases_assigned} assigned case{live.cases_assigned === 1 ? '' : 's'}
          {live.rules_targeting.length ? ` · selected by ${live.rules_targeting.join(', ')}` : ' · no assignment rule selects it'}
        </> : 'Not published yet: no case can be assigned this script.'}
        {open ? <> · <span className="strong">v{open.version_label} {humanize(open.status).toLowerCase()}</span></> : null}
      </p>
      <div className="row wrap family-versions" style={{ gap: 6 }}>
        <span className="xsmall muted">Versions:</span>
        {versions.map((v) => (
          <Link key={v.id} className="version-chip" to={scriptHref(v.script_family_id, v.id)}>
            <span className="strong"><span className="sr-only">{v.family} </span>v{v.version_label}</span> <StatusBadge status={v.status} />
          </Link>
        ))}
      </div>
    </li>
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
