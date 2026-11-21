// Script Detail (`/scripts/:scriptFamilyId?version=…`, F6 + S2-A): the family (API-061), its version history (API-062)
// and one version's ordered sections → modules → questions (API-063). S2-A adds the draft editor, review & publish
// (maker-checker), the semantic version diff and the change history (ScriptEditor.tsx). Every version carries the
// synthetic-content banner. S2-A.2: the version being viewed sits in a bar at the top (picker, status, key facts) and the
// rest is split into tabs — Questions, Versions, Review & publish, Compare versions, Change history, Details.
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, unwrap } from '../../api/client';
import { Empty } from '../../components/StateView';
import { Badge, Card, PageHead } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import { METHOD_LABEL, NewDraftButton, VersionWorkspace, ruleSummary } from './ScriptEditor';
import {
  compareLabels, ContentApprovalBadge, describeCondition, PublishedCaveat, scriptHref, show, StatusBadge, SyntheticBanner,
  type ScriptQuestion, type ScriptVersionDetail, type ScriptVersionSummary,
} from './shared';

export function ScriptFamilyPage() {
  const { scriptFamilyId = '' } = useParams();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const path = { params: { path: { script_family_id: scriptFamilyId } } };
  const family = useQuery({ queryKey: ['script-family', scriptFamilyId], queryFn: async () => unwrap(await api.GET('/api/v1/scripts/{script_family_id}', path)) });
  const versions = useQuery({ queryKey: ['script-family', scriptFamilyId, 'versions'], queryFn: async () => unwrap(await api.GET('/api/v1/scripts/{script_family_id}/versions', path)) });
  const items = versions.data?.items ?? [];
  const selectedId = params.get('version') ?? items.find((v) => v.status === 'PUBLISHED')?.id ?? items[items.length - 1]?.id ?? null;
  const summary = items.find((v) => v.id === selectedId) ?? null;
  const detail = useQuery({
    queryKey: ['script-version', selectedId], enabled: !!selectedId && !!summary,
    queryFn: async () => unwrap(await api.GET('/api/v1/script-versions/{script_version_id}', { params: { path: { script_version_id: selectedId! } } })),
  });

  const ordered = [...items].sort((x, y) => compareLabels(y.version_label, x.version_label));
  const live = items.find((v) => v.status === 'PUBLISHED') ?? null;
  return (
    <>
      <PageHead eyebrow="Script Studio · script" title={family.data?.name ?? 'Script'}
        description={family.data ? `${family.data.code} · ${family.data.market} · ${humanize(family.data.purpose)}${family.data.description ? ` · ${family.data.description}` : ''}` : 'Script family and version history'}
        actions={<>
          <Link className="btn" to="/scripts">Back to Script Studio</Link>
          {can('script.edit') && versions.isSuccess ? <NewDraftButton familyId={scriptFamilyId} versions={items} /> : null}
        </>} />
      <SyntheticBanner />
      <Region query={family} label="the script family">
        {() => (
          <div className="stack" style={{ gap: 16 }}>
            {!summary && versions.isSuccess ? <Card><Empty title="This version is not in this family" /></Card> : null}
            {summary ? <VersionBar v={summary} ordered={ordered} live={live} /> : null}
            {summary ? (
              <Region query={detail} label="the script version">
                {() => <VersionWorkspace d={detail.data!} family={{ id: scriptFamilyId }} versions={items}
                  readView={<Sections d={detail.data!} />}
                  versionsView={<VersionTimeline ordered={ordered} selectedId={selectedId} />}
                  detailsView={<VersionDetails v={summary} d={detail.data} />} />}
              </Region>
            ) : null}
          </div>
        )}
      </Region>
    </>
  );
}

const versionText = (v: ScriptVersionSummary) => `v${v.version_label} · ${humanize(v.status)}${v.status === 'PUBLISHED' ? ' (in use)' : ''}`;

/** The version being viewed, always at the top: a picker, its status and the few facts that matter. */
function VersionBar({ v, ordered, live }: { v: ScriptVersionSummary; ordered: ScriptVersionSummary[]; live: ScriptVersionSummary | null }) {
  const [params, setParams] = useSearchParams();
  const pick = (id: string) => setParams(() => { const n = new URLSearchParams(); n.set('version', id); const t = params.get('tab'); if (t) n.set('tab', t); return n; });
  return (
    <section className="card card-pad version-bar" aria-label="Version being viewed" data-testid="version-header">
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="form-label" htmlFor="sv-pick" style={{ margin: 0 }}>Viewing version</label>
        <select id="sv-pick" className="field" value={v.id} onChange={(e) => pick(e.target.value)} data-testid="version-picker">
          {ordered.map((o) => <option key={o.id} value={o.id}>{versionText(o)}</option>)}
        </select>
        <StatusBadge status={v.status} />
        <ContentApprovalBadge status={v.content_approval_status} />
        {live && live.id !== v.id ? <Link className="link small" to={scriptHref(live.script_family_id, live.id)} data-testid="go-live">Go to the version in use (v{live.version_label})</Link> : null}
      </div>
      <p className="small version-facts">
        {v.questions} questions ({v.mandatory_questions} mandatory) ·{' '}
        {v.effective_from ? `effective ${when(v.effective_from).split(',')[0]}${v.effective_to ? ` – ${when(v.effective_to).split(',')[0]}` : ' onwards'}` : 'no effective date'} ·{' '}
        {v.cases_assigned} assigned case{v.cases_assigned === 1 ? '' : 's'} ·{' '}
        {v.rules_targeting.length ? <>selected by {v.rules_targeting.map((r, i) => (
          <span key={r}>{i ? ', ' : ''}<Link className="link" to={`/assignment-rules?rule=${encodeURIComponent(r)}`}>{r}</Link></span>))}</> : 'no assignment rule selects it'}
      </p>
      <PublishedCaveat status={v.status} approval={v.content_approval_status} />
    </section>
  );
}

/** Every version of the script, newest first, as a timeline. */
function VersionTimeline({ ordered, selectedId }: { ordered: ScriptVersionSummary[]; selectedId: string | null }) {
  return (
    <Card title="Versions" subtitle="Newest first. Each version is a frozen snapshot; only one is in use at a time, and publishing a new one replaces it.">
      <nav aria-label="Script versions" data-testid="version-history">
        {ordered.map((v) => <VersionItem key={v.id} v={v} active={v.id === selectedId} />)}
      </nav>
    </Card>
  );
}

function VersionItem({ v, active }: { v: ScriptVersionSummary; active: boolean }) {
  return (
    <Link to={scriptHref(v.script_family_id, v.id)} className={`script-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}
      style={{ display: 'block', textDecoration: 'none' }}>
      <div className="row between"><strong className="small">v{v.version_label}{active ? ' · viewing' : ''}</strong><StatusBadge status={v.status} /></div>
      <div className="xsmall muted" style={{ marginTop: 6 }}>
        {v.effective_from ? `From ${when(v.effective_from).split(',')[0]}` : 'No effective date'}{v.effective_to ? ` to ${when(v.effective_to).split(',')[0]}` : ''}
        {' · '}{v.questions} questions · {v.cases_assigned} cases{v.supersedes_label ? ` · replaced v${v.supersedes_label}` : ''}
      </div>
    </Link>
  );
}

/** Technical record of the version: people, rules, dates and the frozen manifest checksum. */
function VersionDetails({ v, d }: { v: ScriptVersionSummary; d: ScriptVersionDetail | undefined }) {
  return (
    <Card title="Details" subtitle="Who wrote and reviewed this version, and the checksum that proves its content has not changed">
      <div className="info-grid sd-tiles" data-testid="version-details">
        <div className="info-tile"><label>Questions</label><strong>{v.questions} total · {v.mandatory_questions} mandatory</strong></div>
        <div className="info-tile"><label>Effective</label><strong>{v.effective_from ? when(v.effective_from).split(',')[0] : 'Not set'}{v.effective_to ? ` – ${when(v.effective_to).split(',')[0]}` : ' – open'}</strong></div>
        <div className="info-tile"><label>Assigned cases</label><strong>{v.cases_assigned}</strong></div>
        <div className="info-tile"><label>Author / reviewer</label><strong data-testid="author-reviewer">{person(d, v.author_ref)} / {person(d, d?.reviewer_ref ?? v.reviewer_ref)}</strong></div>
        <div className="info-tile"><label>Replaces</label><strong>{v.supersedes_label ? `v${v.supersedes_label}` : '—'}</strong></div>
        <div className="info-tile"><label>Language · validation</label><strong>{v.language} · {v.validation_status ? humanize(v.validation_status) : '—'}</strong></div>
      </div>
      <p className="small" style={{ margin: '14px 0 0' }}>{v.published_at ? `Published ${when(v.published_at)} SGT.` : 'Not published.'}</p>
      <div className="small" style={{ marginTop: 8 }}>
        <span className="muted">Manifest SHA-256 </span>
        {d?.manifest_sha256 ?? v.manifest_sha256
          ? <span className="mono" data-testid="manifest-sha" style={{ overflowWrap: 'anywhere' }}>{d?.manifest_sha256 ?? v.manifest_sha256}</span>
          : <span className="muted">Draft — no frozen manifest yet</span>}
      </div>
    </Card>
  );
}

function Sections({ d }: { d: ScriptVersionDetail }) {
  const total = d.sections.reduce((n, s) => n + s.questions.length, 0);
  return (
    <>
      <p className="small muted" style={{ margin: 0 }} data-testid="questions-summary">
        {d.sections.length} section{d.sections.length === 1 ? '' : 's'} · {total} question{total === 1 ? '' : 's'}, asked in this order.
        A section with a condition is only used when its condition holds. Click a question to see how its answer is checked.
      </p>
      {d.sections.map((s) => (
        <section key={s.position} id={`sec-${s.position}`} className="card card-pad" aria-labelledby={`sec-${s.position}-h`} data-testid="script-section">
          <div className="card-heading">
            <div><h2 id={`sec-${s.position}-h`}>{s.position}. {s.module_name}</h2>
              <p>{s.inclusion_condition == null ? 'Always asked' : `Only when ${describeCondition(s.inclusion_condition).replace(/^\(|\)$/g, '')}`}
                <span className="muted"> · <span className="mono">{s.module_code}</span> · {humanize(s.module_kind)} section</span></p></div>
            <Badge tone="gray" noDot>{`${s.questions.length} question${s.questions.length === 1 ? '' : 's'}`}</Badge>
          </div>
          {s.questions.map((q) => <QuestionView key={q.question_code} q={q} section={s.position} />)}
        </section>
      ))}
    </>
  );
}

function QuestionView({ q, section }: { q: ScriptQuestion; section: number }) {
  return (
    <details className="script-question" data-testid={`question-${q.question_code}`}>
      <summary className="script-question-head">
        <span className="q-num">{section}.{q.position}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="q-wording">{q.wording}</span>
          <span className="row wrap" style={{ gap: 6, marginTop: 7 }}>
            {q.mandatory ? <Badge tone="red">Mandatory</Badge> : <Badge tone="gray">Optional</Badge>}
            <Badge tone="blue">{humanize(q.answer_type)}</Badge><Badge tone="gray">{humanize(q.delivery_mode)}</Badge>
            {q.mandatory && !q.controls.length ? <Badge tone="amber">No mapped control · checker review</Badge> : null}
            <span className="mono xsmall muted">{q.question_code}</span></span>
        </span>
      </summary>
      <div className="question-body">
        <dl className="kv xsmall">
          <dt>Intent</dt><dd>{q.intent ?? '—'}</dd>
          <dt>Revision</dt><dd>r{q.revision} · {q.content_approval_status === 'APPROVED_BY_SC' ? 'Approved by S&C' : 'Synthetic, not production-approved'}</dd>
          <dt>Evaluation method</dt><dd>{METHOD_LABEL[q.expected_answer_policy] ?? humanize(q.expected_answer_policy)}</dd>
          <dt>Evaluation rule</dt><dd data-testid={`read-rule-${q.question_code}`}>{ruleSummary(q)}</dd>
          <dt>Lifecycle role</dt><dd>{humanize(q.lifecycle_role ?? 'VERIFICATION')} · on failure {humanize(q.on_failure ?? 'CONTINUE')}{q.discloses_policy_information ? ' · discloses policy information (after identity)' : ''}{q.deliver_on_termination ? ' · delivered on termination' : ''}</dd>
          <dt>Expected value</dt><dd>{show(q.expected_value)}</dd>
          {q.policy_fact_key ? <><dt>Compared with policy fact</dt><dd className="mono">{q.policy_fact_key}</dd></> : null}
          <dt>Acceptable variants</dt><dd>{show(q.acceptable_variants)}</dd>
          <dt>Unacceptable outcomes</dt><dd>{show(q.unacceptable_outcomes)}</dd>
          {q.not_applicable_predicate ? <><dt>Not applicable when</dt><dd>{describeCondition(q.not_applicable_predicate)}</dd></> : null}
          {q.branch_condition ? <><dt>Asked when</dt><dd>{describeCondition(q.branch_condition)}</dd></> : null}
        </dl>
        <div className="section-label" style={{ marginTop: 10 }}>Controls</div>
        {q.controls.length ? (
          <ul className="plain-list" data-testid="question-controls">
            {q.controls.map((c, i) => {
              const ctl = c as Record<string, string | null>;
              return (
                <li key={i} className="small">
                  <span className="mono strong">{ctl.control_code}</span> {ctl.name}
                  <div className="xsmall muted">{ctl.rationale ?? ''}{ctl.status ? ` · mapping ${humanize(ctl.status)}` : ''}</div>
                  {ctl.title ? <div className="xsmall regref">Regulatory reference (public, separate from the AIA control): {ctl.title}
                    {ctl.document_version ? ` · ${ctl.document_version}` : ''} · {humanize(ctl.interpretation_status ?? 'NOT_REVIEWED')}</div> : null}
                </li>
              );
            })}
          </ul>
        ) : <p className="xsmall muted" style={{ margin: 0 }}>No control linked.</p>}
        <p className="xsmall muted" style={{ marginBottom: 0 }}>A “yes” is not automatically compliant: the expected-answer policy is applied by the backend rules in Stage S3.</p>
      </div>
    </details>
  );
}

/** A principal reference as a display name when the server resolved it (seeded versions carry synthetic labels). */
function person(d: ScriptVersionDetail | undefined, ref: string | null | undefined): string {
  if (!ref) return '—';
  return d?.people?.[ref] ?? ref;
}
