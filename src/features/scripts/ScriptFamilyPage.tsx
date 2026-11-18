// Script Detail (`/scripts/:scriptFamilyId?version=…`, F6 + S2-A): the family (API-061), its version history (API-062)
// and one version's ordered sections → modules → questions (API-063). S2-A adds the draft editor, review & publish
// (maker-checker), the semantic version diff and the change history (ScriptEditor.tsx). Every version carries the
// synthetic-content banner.
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, unwrap } from '../../api/client';
import { Empty } from '../../components/StateView';
import { Badge, Card, PageHead } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import { METHOD_LABEL, NewDraftButton, VersionWorkspace, ruleSummary } from './ScriptEditor';
import {
  ContentApprovalBadge, describeCondition, PublishedCaveat, scriptHref, show, StatusBadge, SyntheticBanner,
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

  return (
    <>
      <PageHead eyebrow="Controlled questionnaires" title="Script Detail"
        description={family.data ? `${family.data.code} · ${family.data.name} · ${family.data.market} · ${humanize(family.data.purpose)}` : 'Script family and version history'}
        actions={<>
          <Link className="btn" to="/scripts">Back to Script Studio</Link>
          {can('script.edit') && versions.isSuccess ? <NewDraftButton familyId={scriptFamilyId} versions={items} /> : null}
        </>} />
      <SyntheticBanner />
      <Region query={family} label="the script family">
        {() => (
          <div className="layout sd-grid">
            <Card title="Version history" subtitle="Oldest first; published versions are immutable">
              <Region query={versions} label="versions">
                {() => (
                  <nav aria-label="Script versions" data-testid="version-history">
                    {items.map((v) => <VersionItem key={v.id} v={v} active={v.id === selectedId} />)}
                  </nav>
                )}
              </Region>
              {family.data!.description ? <p className="xsmall muted" style={{ marginBottom: 0 }}>{family.data!.description}</p> : null}
            </Card>
            <div className="stack" style={{ gap: 16 }}>
              {!summary && versions.isSuccess ? <Card><Empty title="This version is not in this family" /></Card> : null}
              {summary ? <VersionHeader v={summary} d={detail.data} /> : null}
              {summary ? (
                <Region query={detail} label="the script version">
                  {() => <VersionWorkspace d={detail.data!} family={{ id: scriptFamilyId }} versions={items} readView={<Sections d={detail.data!} />} />}
                </Region>
              ) : null}
            </div>
          </div>
        )}
      </Region>
    </>
  );
}

function VersionItem({ v, active }: { v: ScriptVersionSummary; active: boolean }) {
  return (
    <Link to={scriptHref(v.script_family_id, v.id)} className={`script-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}
      style={{ display: 'block', textDecoration: 'none' }}>
      <div className="row between"><strong className="small">v{v.version_label}</strong><StatusBadge status={v.status} /></div>
      <div className="xsmall muted" style={{ marginTop: 6 }}>
        {v.effective_from ? `From ${when(v.effective_from).split(',')[0]}` : 'No effective date'}{v.effective_to ? ` to ${when(v.effective_to).split(',')[0]}` : ''}
      </div>
      <div className="xsmall muted">{v.questions} questions · {v.cases_assigned} cases{v.supersedes_label ? ` · supersedes v${v.supersedes_label}` : ''}</div>
    </Link>
  );
}

function VersionHeader({ v, d }: { v: ScriptVersionSummary; d: ScriptVersionDetail | undefined }) {
  return (
    <section className="card card-pad" aria-labelledby="sv-title" data-testid="version-header">
      <div className="row wrap"><StatusBadge status={v.status} /><Badge tone="blue">{v.family}</Badge><Badge tone="gray">{`v${v.version_label}`}</Badge>
        <ContentApprovalBadge status={v.content_approval_status} /></div>
      <h2 id="sv-title" style={{ fontSize: 22, margin: '13px 0 6px', letterSpacing: '-.4px' }}>{v.family_name} v{v.version_label}</h2>
      <p className="small muted" style={{ margin: 0 }}>Language {v.language} · validation {v.validation_status ? humanize(v.validation_status) : '—'}
        {v.published_at ? ` · published ${when(v.published_at)} SGT` : ''}</p>
      <PublishedCaveat status={v.status} approval={v.content_approval_status} />
      <div className="info-grid sd-tiles" style={{ marginTop: 18 }}>
        <div className="info-tile"><label>Questions</label><strong>{v.questions} total · {v.mandatory_questions} mandatory</strong></div>
        <div className="info-tile"><label>Effective</label><strong>{v.effective_from ? when(v.effective_from).split(',')[0] : 'Not set'}{v.effective_to ? ` – ${when(v.effective_to).split(',')[0]}` : ' – open'}</strong></div>
        <div className="info-tile"><label>Assigned cases</label><strong>{v.cases_assigned}</strong></div>
        <div className="info-tile"><label>Author / reviewer</label><strong data-testid="author-reviewer">{person(d, v.author_ref)} / {person(d, d?.reviewer_ref ?? v.reviewer_ref)}</strong></div>
        <div className="info-tile"><label>Supersedes</label><strong>{v.supersedes_label ? `v${v.supersedes_label}` : '—'}</strong></div>
        <div className="info-tile"><label>Selected by rules</label><strong>{v.rules_targeting.length ? v.rules_targeting.map((r, i) => (
          <span key={r}>{i ? ', ' : ''}<Link className="link" to={`/assignment-rules?rule=${encodeURIComponent(r)}`}>{r}</Link></span>)) : 'None'}</strong></div>
      </div>
      <div className="small" style={{ marginTop: 14 }}>
        <span className="muted">Manifest SHA-256 </span>
        {d?.manifest_sha256 ?? v.manifest_sha256
          ? <span className="mono" data-testid="manifest-sha" style={{ overflowWrap: 'anywhere' }}>{d?.manifest_sha256 ?? v.manifest_sha256}</span>
          : <span className="muted">Draft — no frozen manifest yet</span>}
      </div>
    </section>
  );
}

function Sections({ d }: { d: ScriptVersionDetail }) {
  return (
    <>
      <Card title="Structure" subtitle="Sections in delivery order; each module applies only when its condition holds">
        <ol className="sd-nav" aria-label="Question navigator">
          {d.sections.map((s) => (
            <li key={s.position}><a href={`#sec-${s.position}`} className="link">{s.position}. {s.module_name}</a>
              <span className="xsmall muted"> · {humanize(s.module_kind)} · {s.questions.length} question{s.questions.length === 1 ? '' : 's'} · {describeCondition(s.inclusion_condition)}</span></li>
          ))}
        </ol>
      </Card>
      {d.sections.map((s) => (
        <section key={s.position} id={`sec-${s.position}`} className="card card-pad" aria-labelledby={`sec-${s.position}-h`} data-testid="script-section">
          <div className="card-heading">
            <div><h2 id={`sec-${s.position}-h`}>{s.position}. {s.module_name}</h2>
              <p><span className="mono">{s.module_code}</span> · {humanize(s.module_kind)} module · {describeCondition(s.inclusion_condition)}</p></div>
            <Badge tone="gray" noDot>{`${s.questions.length} questions`}</Badge>
          </div>
          {s.questions.map((q) => <QuestionView key={q.question_code} q={q} section={s.position} />)}
        </section>
      ))}
    </>
  );
}

function QuestionView({ q, section }: { q: ScriptQuestion; section: number }) {
  return (
    <details className="script-question" data-testid={`question-${q.question_code}`} open={section === 1 && q.position === 1}>
      <summary className="script-question-head">
        <span className="q-num">{section}.{q.position}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="row wrap" style={{ gap: 6 }}><span className="mono strong small">{q.question_code}</span>
            {q.mandatory ? <Badge tone="red">Mandatory</Badge> : <Badge tone="gray">Optional</Badge>}
            <Badge tone="blue">{humanize(q.answer_type)}</Badge><Badge tone="gray">{humanize(q.delivery_mode)}</Badge>
            {q.mandatory && !q.controls.length ? <Badge tone="amber">No mapped control · checker review</Badge> : null}</span>
          <span className="small" style={{ display: 'block', marginTop: 6 }}>{q.wording}</span>
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
