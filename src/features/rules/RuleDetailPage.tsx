// Rule Detail (`/assignment-rules/:ruleCode?draft=…|version=…`, S2-B): the rule's published versions and drafts, the
// visual editor (draft), simulation, maker-checker review and publication (explicit supersede), version comparison and
// change history. The backend enforces every rule; this page only renders and submits.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/Icon';
import { Empty } from '../../components/StateView';
import { Badge, Button, Card, PageHead } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import { ErrorBox, errorText, Field } from '../scripts/ScriptEditor';
import { scriptHref, short, SyntheticBanner } from '../scripts/shared';
import { RuleBuilder, SubmitPanel, useRuleChange } from './RuleBuilder';
import { RuleSimulation } from './RuleSimulation';
import { ConditionChips, IssueList, people, ruleHref, RuleStatus, useRuleOptions, valueLabel, type RuleDraft, type RuleOptions, type RuleVersion } from './shared';

type Tab = 'rule' | 'simulate' | 'review' | 'compare' | 'history';

export function RuleDetailPage() {
  const { ruleCode = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const opts = useRuleOptions();
  const history = useQuery({ queryKey: ['rule-history', ruleCode], queryFn: async () => unwrap(await api.GET('/api/v1/assignment-rules/{rule_code}/history', { params: { path: { rule_code: ruleCode } } })) });
  const h = history.data;
  const openDraft = h?.drafts.find((d) => ['DRAFT', 'SUBMITTED_FOR_REVIEW', 'APPROVED'].includes(d.status));
  const live = h?.versions.slice().reverse().find((v) => v.status === 'PUBLISHED');
  const draftId = params.get('draft') ?? (params.get('version') ? null : openDraft?.id ?? null);
  const versionId = draftId ? null : params.get('version') ?? live?.id ?? h?.versions[h.versions.length - 1]?.id ?? null;
  const draft = useQuery({ queryKey: ['rule-draft', draftId], enabled: !!draftId, queryFn: async () => unwrap(await api.GET('/api/v1/assignment-rule-drafts/{draft_id}', { params: { path: { draft_id: draftId! } } })) });
  const version = h?.versions.find((v) => v.id === versionId) ?? null;
  const [tab, setTab] = useState<Tab>('rule');
  const [newErr, setNewErr] = useState<string | null>(null);
  const newVersion = async () => {
    try {
      const r = unwrap(await api.POST('/api/v1/assignment-rules/{rule_code}/drafts', { params: { path: { rule_code: ruleCode } }, body: {} }));
      await history.refetch();
      setParams({ draft: r.draft_id });
      setTab('rule');
    } catch (e) { setNewErr(errorText(e).message); }
  };
  const name = draft.data?.name ?? version?.name ?? h?.versions[0]?.name ?? ruleCode;
  return (
    <>
      <PageHead eyebrow="Policy-to-script mapping" title="Rule Detail" description={`${ruleCode} · ${name}`}
        actions={<>
          <Link className="btn" to="/assignment-rules">Back to Assignment Rules</Link>
          {can('script.edit') && live ? <Button icon="plus" onClick={() => void newVersion()} disabled={!!openDraft} data-testid="rule-new-version"
            title={openDraft ? `v${openDraft.planned_version} is still open` : 'New draft version from the live version'}>New version</Button> : null}
          {can('script.edit') && version ? <Button icon="copy" onClick={() => nav(`/assignment-rules?new=1&copy=${version.id}`)} data-testid="rule-copy">Copy as new rule</Button> : null}
        </>} />
      <SyntheticBanner />
      {newErr ? <div className="field-error" role="alert">{newErr}</div> : null}
      <Region query={history} label="the rule">
        {() => (
          <div className="layout sd-grid">
            <Card title="Versions and drafts" subtitle="Published versions are immutable">
              <nav aria-label="Rule versions" data-testid="rule-versions" className="stack" style={{ gap: 0 }}>
                {h!.versions.map((v) => (
                  <Link key={v.id} to={ruleHref(ruleCode, `version=${v.id}`)} className={`script-item${v.id === versionId ? ' active' : ''}`} aria-current={v.id === versionId ? 'page' : undefined} style={{ display: 'block', textDecoration: 'none' }}>
                    <div className="row between"><strong className="small">v{v.version}</strong><RuleStatus status={v.status} /></div>
                    <div className="xsmall muted" style={{ marginTop: 6 }}>From {when(v.effective_from).split(',')[0]}{v.effective_to ? ` to ${when(v.effective_to).split(',')[0]}` : ''} · priority {v.priority}</div>
                    <div className="xsmall muted">{v.cases_assigned} cases assigned{v.is_fallback ? ' · fallback' : ''}</div>
                  </Link>
                ))}
                {h!.drafts.filter((d) => d.status !== 'PUBLISHED').map((d) => (
                  <Link key={d.id} to={ruleHref(ruleCode, `draft=${d.id}`)} className={`script-item${d.id === draftId ? ' active' : ''}`} aria-current={d.id === draftId ? 'page' : undefined} style={{ display: 'block', textDecoration: 'none' }} data-testid={`rule-draft-item-${d.planned_version}`}>
                    <div className="row between"><strong className="small">v{d.planned_version} (draft)</strong><RuleStatus status={d.status} /></div>
                    <div className="xsmall muted" style={{ marginTop: 6 }}>{d.updated_at ? `Updated ${when(d.updated_at)}` : `Created ${when(d.created_at)}`}</div>
                  </Link>
                ))}
              </nav>
            </Card>
            <div className="stack" style={{ gap: 16 }}>
              {draftId ? (
                <Region query={draft} label="the rule draft">
                  {() => <DraftWorkspace d={draft.data!} o={opts.data} tab={tab} setTab={setTab} />}
                </Region>
              ) : version ? <VersionWorkspace v={version} o={opts.data} tab={tab} setTab={setTab} ruleCode={ruleCode} /> : <Card><Empty title="Nothing to show for this rule" /></Card>}
            </div>
          </div>
        )}
      </Region>
    </>
  );
}

function Tabs({ tab, setTab, tabs }: { tab: Tab; setTab: (t: Tab) => void; tabs: Array<[Tab, string]> }) {
  return (
    <div className="subtabs" role="tablist" aria-label="Rule sections">
      {tabs.map(([k, label]) => (
        <button key={k} type="button" role="tab" id={`rule-tab-${k}`} aria-selected={tab === k} aria-controls="rule-panel" className={tab === k ? 'active' : ''} onClick={() => setTab(k)} data-testid={`rule-tab-${k}`}>{label}</button>
      ))}
    </div>
  );
}

function VersionWorkspace({ v, o, tab, setTab, ruleCode }: { v: RuleVersion; o: RuleOptions | undefined; tab: Tab; setTab: (t: Tab) => void; ruleCode: string }) {
  const tabs: Array<[Tab, string]> = [['rule', 'Rule'], ['simulate', 'Simulate'], ['compare', 'Compare versions'], ['history', 'Change history']];
  const t = tab === 'review' ? 'rule' : tab;
  return (
    <>
      <section className="card card-pad" data-testid="rule-version-header">
        <div className="row wrap"><RuleStatus status={v.status} /><Badge tone="blue">{v.rule_code}</Badge><Badge tone="gray">{`v${v.version}`}</Badge>
          {v.is_fallback ? <Badge tone="blue">Default fallback</Badge> : null}<Badge tone="amber">Synthetic · not production-approved</Badge></div>
        <h2 style={{ fontSize: 22, margin: '13px 0 6px' }}>{v.name}</h2>
        <div className="explain" data-testid="rule-explanation">{v.explanation}</div>
        <div className="topnotice" role="note" style={{ margin: '14px 0 0' }}><div className="row"><Icon name="lock" size="sm" />
          <span>{v.status === 'PUBLISHED' ? 'Immutable published version. Changes need a new version; superseding it is an explicit checker decision.' : `Historical ${v.status.toLowerCase()} version, kept for the cases it assigned.`}</span></div></div>
      </section>
      <Tabs tab={t} setTab={setTab} tabs={tabs} />
      <div id="rule-panel" role="tabpanel" aria-labelledby={`rule-tab-${t}`} className="stack" style={{ gap: 16 }}>
        {t === 'rule' ? <VersionFacts v={v} o={o} /> : null}
        {t === 'simulate' ? <RuleSimulation draftIds={[]} o={o} title="Simulate the live rules" /> : null}
        {t === 'compare' ? <Compare ruleCode={ruleCode} current={`version:${v.id}`} /> : null}
        {t === 'history' ? <History ruleCode={ruleCode} /> : null}
      </div>
    </>
  );
}

function VersionFacts({ v, o }: { v: RuleVersion; o: RuleOptions | undefined }) {
  // Recorded assignments of this version (API-064): the traceability rule → case → pinned script (F6).
  const recorded = useQuery({ queryKey: ['assignment-rules'], queryFn: async () => unwrap(await api.GET('/api/v1/script-assignment-rules')) });
  const mine = recorded.data?.items.find((r) => r.id === v.id);
  return (
    <>
    <Card title="Conditions and settings">
      <dl className="kv">
        <dt>Applies when</dt><dd><ConditionChips conditions={v.conditions} o={o} /></dd>
        <dt>Priority / specificity</dt><dd>{v.priority} (1 is highest) / {v.specificity} (calculated)</dd>
        <dt>Assigns</dt><dd>{v.target.script_family_id ? <Link className="link" to={scriptHref(v.target.script_family_id, v.target.id ?? undefined)}>{v.target.label}</Link> : v.target.label}</dd>
        <dt>Effective</dt><dd>{when(v.effective_from)} – {v.effective_to ? when(v.effective_to) : 'open'} SGT</dd>
        <dt>Author / checker</dt><dd data-testid="rule-people">{people(v.people, v.author_ref)} / {people(v.people, v.checker_ref)}{v.published_by ? ` · published by ${people(v.people, v.published_by)}` : ''}</dd>
        <dt>Checksum</dt><dd className="mono">{short(v.checksum)}</dd>
        <dt>Cases assigned</dt><dd data-testid="rule-cases-count">{v.cases_assigned} cases (recorded assignments; publishing a rule never reassigns cases)</dd>
      </dl>
    </Card>
    <Card title="Cases assigned by this version" subtitle={mine && v.cases_assigned > mine.recent_cases.length ? `Latest ${mine.recent_cases.length} of ${v.cases_assigned}` : 'Each keeps its pinned script version'}>
      {mine?.recent_cases.length ? (
        <div className="row wrap" style={{ gap: 6 }} data-testid="rule-cases">
          {mine.recent_cases.map((c) => <Link key={c.case_id} className="tag mono" to={`/cases/${c.case_id}`}>{c.case_ref}</Link>)}
        </div>
      ) : <p className="xsmall muted" style={{ margin: 0 }}>{recorded.isPending ? 'Loading…' : 'No case was assigned by this rule version.'}</p>}
    </Card>
    </>
  );
}

function DraftWorkspace({ d, o, tab, setTab }: { d: RuleDraft; o: RuleOptions | undefined; tab: Tab; setTab: (t: Tab) => void }) {
  const { can } = useAuth();
  const editing = d.status === 'DRAFT' && can('script.edit');
  const tabs: Array<[Tab, string]> = [['rule', editing ? 'Edit rule' : 'Rule'], ['simulate', 'Simulate'], ['review', 'Review & publish'], ['compare', 'Compare versions'], ['history', 'Change history']];
  return (
    <>
      <section className="card card-pad" data-testid="rule-draft-header">
        <div className="row wrap"><RuleStatus status={d.status} /><Badge tone="blue">{d.rule_code}</Badge><Badge tone="gray">{`v${d.planned_version} draft`}</Badge>
          {d.is_fallback ? <Badge tone="blue">Default fallback</Badge> : null}<Badge tone="amber">Synthetic · not production-approved</Badge>
          {d.base_ref ? <span className="xsmall muted">based on {d.base_ref}</span> : null}{d.copied_from_ref ? <span className="xsmall muted">copied from {d.copied_from_ref}</span> : null}</div>
        <h2 style={{ fontSize: 22, margin: '13px 0 6px' }}>{d.name}</h2>
        <p className="small muted" style={{ margin: 0 }}>Author {people(d.people, d.author_ref)} · validation {humanize(d.validation_status)}{d.manifest_sha256 ? ` · manifest ${short(d.manifest_sha256)}` : ''}</p>
        {d.status !== 'DRAFT' ? <div className="topnotice" role="note" style={{ margin: '14px 0 0' }}><div className="row"><Icon name="lock" size="sm" />
          <span>{d.status === 'ABANDONED' ? 'Abandoned draft: frozen and kept for audit; nothing was deleted.' : d.status === 'PUBLISHED' ? 'Published: see the published version.' : 'Locked for review: content cannot change until the checker returns it or publishes it.'}</span></div></div> : null}
      </section>
      <Tabs tab={tab} setTab={setTab} tabs={tabs} />
      <div id="rule-panel" role="tabpanel" aria-labelledby={`rule-tab-${tab}`} className="stack" style={{ gap: 16 }}>
        {tab === 'rule' ? (editing && o ? <><RuleBuilder d={d} o={o} /><SubmitPanel d={d} /></> : <DraftFacts d={d} o={o} />) : null}
        {tab === 'simulate' ? (d.status === 'ABANDONED' || d.status === 'PUBLISHED' ? <Card><Empty title="Closed drafts cannot be simulated" /></Card> : <RuleSimulation draftIds={[d.id]} o={o} />) : null}
        {tab === 'review' ? <Review d={d} /> : null}
        {tab === 'compare' ? <Compare ruleCode={d.rule_code} current={`draft:${d.id}`} /> : null}
        {tab === 'history' ? <History ruleCode={d.rule_code} /> : null}
      </div>
    </>
  );
}

function DraftFacts({ d, o }: { d: RuleDraft; o: RuleOptions | undefined }) {
  return (
    <Card title="Conditions and settings">
      <div className="stack" style={{ gap: 12 }}>
        <div className="explain" data-testid="rule-explanation">{d.analysis.explanation}</div>
        <dl className="kv">
          <dt>Applies when</dt><dd><ConditionChips conditions={d.conditions} o={o} /></dd>
          <dt>Priority / specificity</dt><dd>{d.priority} / {d.analysis.specificity} (calculated)</dd>
          <dt>Assigns</dt><dd>{d.target?.label ?? '—'}</dd>
          <dt>Effective</dt><dd>{d.effective_from ? when(d.effective_from) : 'On publication'} – {d.effective_to ? when(d.effective_to) : 'open'}</dd>
        </dl>
        <div><div className="section-label">Validation now</div><IssueList analysis={d.analysis} /></div>
      </div>
    </Card>
  );
}

function Review({ d }: { d: RuleDraft }) {
  const { can, me } = useAuth();
  const ch = useRuleChange(d.id, d.rule_code);
  const [reason, setReason] = useState('');
  const [supersede, setSupersede] = useState(false);
  const maker = !!me && d.makers.includes(me.principal.principal_id);
  const steps: Array<[string, string]> = [['DRAFT', 'Draft'], ['SUBMITTED_FOR_REVIEW', 'Submitted'], ['APPROVED', 'Approved'], ['PUBLISHED', 'Published']];
  const at = steps.findIndex(([s]) => s === d.status);
  const review = (decision: 'APPROVE' | 'REQUEST_CHANGES') => ch.run(async () => unwrap(await api.POST('/api/v1/assignment-rule-drafts/{draft_id}/review', { params: { path: { draft_id: d.id } }, body: { decision, reason } })));
  const publish = () => ch.run(async () => unwrap(await api.POST('/api/v1/assignment-rule-drafts/{draft_id}/publish', { params: { path: { draft_id: d.id } }, body: { supersede_rule_version_id: supersede ? d.live_rule_version_id : null, reason: reason || null } })));
  const blocked = maker ? 'You authored or edited this rule: another S&C checker must review and publish it.' : null;
  return (
    <Card title="Review & publish" subtitle="Maker-checker: the author submits; a different S&C checker approves and publishes">
      <div className="stack" style={{ gap: 12 }} data-testid="rule-review-panel">
        <ol className="row wrap" aria-label="Lifecycle" style={{ gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
          {steps.map(([s, l], i) => <li key={s}><Badge tone={i < at ? 'green' : i === at ? 'blue' : 'gray'}>{`${i + 1}. ${l}${i === at ? ' (current)' : ''}`}</Badge></li>)}
          {d.status === 'ABANDONED' ? <li><RuleStatus status="ABANDONED" /></li> : null}
        </ol>
        <dl className="kv">
          <dt>Makers (cannot approve)</dt><dd>{d.makers.map((m) => people(d.people, m)).join(', ')}</dd>
          <dt>Reviewer</dt><dd>{people(d.people, d.reviewer_ref)}</dd>
          <dt>Manifest SHA-256</dt><dd className="mono" style={{ overflowWrap: 'anywhere' }}>{d.manifest_sha256 ?? 'Frozen on submission'}</dd>
          <dt>Re-check against current rules</dt><dd><IssueList analysis={d.analysis} testId="review-issues" /></dd>
        </dl>
        {d.status === 'DRAFT' ? <p className="small muted" style={{ margin: 0 }}>The author submits from “Edit rule” once validation passes.</p> : null}
        {d.status === 'SUBMITTED_FOR_REVIEW' ? (can('script.approve') ? (blocked ? <p className="small" role="note" data-testid="rule-maker-note">{blocked}</p> : (
          <div className="stack" style={{ gap: 8 }}>
            <p className="small" style={{ margin: 0 }}>Check the conditions, the <strong>Simulate</strong> and <strong>Compare versions</strong> tabs, then decide. A reason is recorded either way.</p>
            <Field id="rr-reason" label="Reviewer reason">{(p) => <textarea {...p} className="field textarea labelled" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="primary" icon="check" disabled={ch.pending} onClick={() => void review('APPROVE')} data-testid="rule-approve">Approve</Button>
              <Button disabled={ch.pending} onClick={() => void review('REQUEST_CHANGES')} data-testid="rule-return">Return for changes</Button>
            </div>
          </div>)) : <p className="small muted">Awaiting an S&C checker.</p>) : null}
        {d.status === 'APPROVED' ? (can('script.publish') ? (blocked ? <p className="small" role="note" data-testid="rule-maker-note">{blocked}</p> : (
          <div className="stack" style={{ gap: 8 }}>
            <p className="small" style={{ margin: 0 }}>Publishing re-validates the rule against the rules live now and makes this version immutable. It does <strong>not</strong> reassign any case (S2-C).</p>
            {d.live_rule_version_id ? (
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={supersede} onChange={(e) => setSupersede(e.target.checked)} data-testid="rule-supersede" />
                Supersede {d.live_ref} (required: a rule has one live version)
              </label>
            ) : null}
            <Field id="rp-reason" label="Publication note (optional)">{(p) => <input {...p} className="field labelled" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
            <div><Button variant="primary" icon="upload" disabled={ch.pending || (!!d.live_rule_version_id && !supersede)} onClick={() => void publish()} data-testid="rule-publish">Publish v{d.planned_version}</Button></div>
          </div>)) : <p className="small muted">Approved. Awaiting publication by an S&C checker.</p>) : null}
        {d.status === 'PUBLISHED' && d.published_rule_version_id ? <p className="small" data-testid="rule-published-note">Published. <Link className="link" to={ruleHref(d.rule_code, `version=${d.published_rule_version_id}`)}>Open the published version</Link>.</p> : null}
        <ErrorBox error={ch.error} />
      </div>
    </Card>
  );
}

const showValue = (o: RuleOptions | undefined, field: string, v: unknown): string => {
  if (v == null) return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return `${when(v)} SGT`;
  if (field === 'target_script_version_id') return o?.targets.find((t) => t.id === v)?.label ?? String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

function Compare({ ruleCode, current }: { ruleCode: string; current: string }) {
  const o = useRuleOptions().data;
  const h = useQuery({ queryKey: ['rule-history', ruleCode], queryFn: async () => unwrap(await api.GET('/api/v1/assignment-rules/{rule_code}/history', { params: { path: { rule_code: ruleCode } } })) });
  const refs = [...(h.data?.versions ?? []).map((v) => ({ id: `version:${v.id}`, label: `v${v.version} · ${humanize(v.status)}` })),
    ...(h.data?.drafts ?? []).filter((d) => d.status !== 'PUBLISHED').map((d) => ({ id: `draft:${d.id}`, label: `v${d.planned_version} draft · ${humanize(d.status)}` }))];
  const others = refs.filter((r) => r.id !== current);
  const [base, setBase] = useState<string>('');
  const chosen = base || others[others.length - 1]?.id || '';
  const diff = useQuery({
    queryKey: ['rule-diff', ruleCode, chosen, current], enabled: !!h.data,
    queryFn: async () => unwrap(await api.GET('/api/v1/assignment-rules/{rule_code}/diff', { params: { path: { rule_code: ruleCode }, query: { target: current, base: chosen || undefined } } })),
  });
  const effectTone: Record<string, 'green' | 'amber' | 'blue'> = { MORE_PERMISSIVE: 'amber', MORE_RESTRICTIVE: 'green', CHANGED: 'blue' };
  return (
    <Card title="Compare versions" subtitle="Condition changes show whether the rule became more or less permissive">
      <div className="stack" style={{ gap: 10 }} data-testid="rule-compare">
        <div className="row wrap" style={{ gap: 8 }}>
          <label className="form-label" htmlFor="rc-base" style={{ margin: 0 }}>Compare with</label>
          <select id="rc-base" className="field" value={chosen} onChange={(e) => setBase(e.target.value)}>
            <option value="">Nothing (all new)</option>{others.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        {diff.data ? (
          <>
            {diff.data.conditions.length ? <ul className="plain-list stack" style={{ gap: 6 }} data-testid="rule-diff-conditions">{diff.data.conditions.map((c) => (
              <li key={c.field} className="small"><Badge tone={effectTone[c.effect] ?? 'gray'}>{humanize(c.effect)}</Badge> <strong>{c.label}</strong>: {c.before ? c.before.map((v) => valueLabel(o, c.field, v)).join(', ') : 'any'} → {c.after ? c.after.map((v) => valueLabel(o, c.field, v)).join(', ') : 'any'}</li>))}</ul>
              : <p className="small muted" style={{ margin: 0 }}>No condition changes.</p>}
            {diff.data.fields.length ? <ul className="plain-list" data-testid="rule-diff-fields">{diff.data.fields.map((f) => <li key={f.field} className="small"><span className="muted">{humanize(f.field.toUpperCase())}:</span> <del>{showValue(o, f.field, f.before)}</del> → <ins>{f.field === 'effective_from' && !f.after ? 'On publication' : showValue(o, f.field, f.after)}</ins></li>)}</ul> : null}
          </>
        ) : <p className="small muted" role="status">{diff.isError ? 'The comparison could not be loaded.' : 'Comparing…'}</p>}
      </div>
    </Card>
  );
}

const EVENT: Record<string, string> = {
  DRAFT_CREATED: 'Draft created', CONTENT_CHANGED: 'Changed', VALIDATED: 'Validated', SUBMITTED: 'Submitted for review', CHANGES_REQUESTED: 'Returned for changes',
  APPROVED: 'Approved', PUBLISHED: 'Published', SUPERSEDED: 'Superseded previous version', ABANDONED: 'Abandoned',
};

function History({ ruleCode }: { ruleCode: string }) {
  const h = useQuery({ queryKey: ['rule-history', ruleCode], queryFn: async () => unwrap(await api.GET('/api/v1/assignment-rules/{rule_code}/history', { params: { path: { rule_code: ruleCode } } })) });
  return (
    <Card title="Change history" subtitle="Insert-only: who changed what, when and why">
      <Region query={h} label="the change history">
        {() => (
          <div className="mini-timeline" data-testid="rule-history">
            {h.data!.events.map((e) => (
              <div key={`${e.draft_id}-${e.seq}`} className="step"><span className={`step-dot${['PUBLISHED', 'APPROVED'].includes(e.event_type) ? ' green' : e.event_type === 'CHANGES_REQUESTED' || e.event_type === 'ABANDONED' ? ' red' : ''}`} />
                <div className="step-body"><strong>v{e.planned_version} · {EVENT[e.event_type] ?? humanize(e.event_type)}</strong>{e.actor_name}{e.reason ? ` — “${e.reason}”` : ''}
                  {Array.isArray((e.details as { fields?: string[] }).fields) ? <small>Fields: {((e.details as { fields: string[] }).fields).map((f) => humanize(f.toUpperCase())).join(', ')}</small> : null}
                  <small>{when(e.occurred_at)} SGT</small></div></div>
            ))}
            {!h.data!.events.length ? <p className="small muted">No Rule Studio changes recorded (seeded rule versions predate S2-B).</p> : null}
          </div>
        )}
      </Region>
    </Card>
  );
}
