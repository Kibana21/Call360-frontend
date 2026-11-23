// Assignment Rules (`/assignment-rules`, F6 → S2-B): the prioritised rule registry (live version per rule, open drafts,
// live conflicts), New rule / Copy rule, how precedence works, and a side-effect-free simulation of the live rules or
// of open drafts. Editing, review and publication happen on Rule Detail (`/assignment-rules/:ruleCode`). Automatic
// case assignment and hold release are Stage S2-C; nothing here assigns a case.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { capability } from '../../auth/capability';
import { Icon } from '../../components/Icon';
import { Empty } from '../../components/StateView';
import { Badge, Button, Card, PageHead } from '../../components/ui';
import { Region, when } from '../cases/shared';
import { AssignmentBatch } from '../rules/AssignmentBatch';
import { RuleSimulation } from '../rules/RuleSimulation';
import { BINDINGS_HREF, ConditionChips, ConflictList, ruleHref, RuleStatus, SURVEY_ONLY, TargetKind, useRuleOptions, type RuleSummary } from '../rules/shared';
import { ErrorBox, errorText, Field } from './ScriptEditor';
import { SyntheticBanner } from './shared';

export function AssignmentRulesPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  // SHARED-1: this capability is governed by its own permission or by the script permission that always governed it
  const rule = capability(can, 'assignment_rule');
  const scripts = can('script.read'); // Script Studio, and the simulation over cases, are still the script side's
  const opts = useRuleOptions();
  const reg = useQuery({ queryKey: ['rule-registry'], queryFn: async () => unwrap(await api.GET('/api/v1/assignment-rules')) });
  const [picked, setPicked] = useState<string[]>([]);
  const legacy = params.get('rule'); // F6 deep links: "SG-SALES-VERIFY v2"
  if (legacy && reg.data) {
    const [code, v] = legacy.split(' v');
    const item = reg.data.items.find((i) => i.rule_code === code);
    const ver = item?.versions.find((x) => String(x.version) === v);
    if (item) return <Navigate replace to={ruleHref(item.rule_code, ver ? `version=${ver.id}` : undefined)} />;
  }
  const showNew = params.get('new') === '1';
  const items = reg.data?.items ?? [];
  const openDrafts = items.flatMap((i) => (i.open_draft && i.open_draft.status !== 'PUBLISHED' ? [{ code: i.rule_code, d: i.open_draft }] : []));
  const ordered = [...items].sort((a, b) => (a.live?.priority ?? 1000) - (b.live?.priority ?? 1000) || (b.live?.specificity ?? 0) - (a.live?.specificity ?? 0) || a.rule_code.localeCompare(b.rule_code));
  return (
    <>
      <PageHead eyebrow="Policy-to-script mapping" title="Assignment Rules"
        description="Deterministically select the published script version for a callback case from approved policy, sale, SBQ risk and contact facts. Rules are drafted, simulated, approved by a different S&C checker and published as immutable versions."
        actions={<>
          {scripts ? <Link className="btn" to="/scripts">Script Studio</Link> : null}
          {can('survey.assignment.read') ? <Link className="btn" to={BINDINGS_HREF} data-testid="to-survey-bindings">Survey bindings and groups</Link> : null}
          {scripts ? <a className="btn" href="#rule-sim" data-testid="test-assignment"><Icon name="target" size="sm" />Test assignment</a> : null}
          {rule('edit') ? <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })} data-testid="new-rule">New mapping rule</Button> : null}
        </>} />
      <SyntheticBanner />
      {showNew && rule('edit') ? <NewRuleForm copyFrom={params.get('copy')} items={items} surveyOnly={!!opts.data?.survey_only_rules} onCancel={() => setParams({})} /> : null}
      <div className="layout cols-2" style={{ marginBottom: 18 }}>
        <Card title="How script assignment works" subtitle="The same deterministic logic is used for simulation now and for assignment in S2-C">
          <div className="rules-flow"><span className="rule-chip">Policy / Sale</span><Icon name="chev" size="sm" /><span className="rule-chip">SBQ Risk</span>
            <Icon name="chev" size="sm" /><span className="rule-chip">Prioritised rules</span><Icon name="chev" size="sm" /><span className="rule-chip" style={{ color: 'var(--red)' }}>Published script</span></div>
          <ol className="small" style={{ margin: '14px 0 0', paddingLeft: 18, lineHeight: 1.7 }} data-testid="precedence">
            {(opts.data?.precedence ?? []).map((p) => <li key={p}>{p}</li>)}
          </ol>
        </Card>
        <Card title="Rule summary" subtitle="Rules in your markets">
          <Region query={reg} label="rule summary">
            {() => (
              <div className="stack" style={{ gap: 12 }}>
                <div className="info-grid" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
                  <div className="info-tile"><label>Rules</label><strong>{items.length}</strong></div>
                  <div className="info-tile"><label>Live (published)</label><strong>{items.filter((i) => i.live).length}</strong></div>
                  <div className="info-tile"><label>Open drafts</label><strong>{openDrafts.length}</strong></div>
                  <div className="info-tile"><label>Cases assigned (recorded)</label><strong>{items.reduce((n, i) => n + i.versions.reduce((m, v) => m + v.cases_assigned, 0), 0)}</strong></div>
                </div>
                <div><div className="section-label">Live rule conflicts</div><ConflictList conflicts={reg.data!.conflicts} /></div>
              </div>
            )}
          </Region>
        </Card>
      </div>
      <Card title="Rule registry" subtitle="Ordered by precedence: lower priority number first, then higher specificity" pad={false}>
        <Region query={reg} label="assignment rules">
          {() => items.length === 0 ? <Empty title="No assignment rules in your markets" /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Rule registry"><table className="data-table" data-testid="rule-registry">
              <thead><tr><th>Priority</th><th>Rule</th><th>Conditions</th><th>Selects</th><th>Version</th><th>Status</th><th>Cases</th><th /></tr></thead>
              <tbody>{ordered.map((i) => <RegistryRow key={i.rule_code} i={i} />)}</tbody>
            </table></div>
          )}
        </Region>
      </Card>
      {scripts ? (<>
      <div id="rule-sim" style={{ marginTop: 18 }}>
        {openDrafts.length ? (
          <fieldset className="softbox" style={{ margin: '0 0 12px' }} data-testid="sim-draft-picker">
            <legend className="small strong">Include open drafts in the simulation (optional)</legend>
            <div className="row wrap" style={{ gap: 10 }}>
              {openDrafts.map(({ code, d }) => (
                <label key={d.id} className="row small" style={{ gap: 6 }}>
                  <input type="checkbox" checked={picked.includes(d.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, d.id] : picked.filter((x) => x !== d.id))} />
                  <span className="mono">{code}</span> v{d.planned_version} <RuleStatus status={d.status} />
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <RuleSimulation draftIds={picked} o={opts.data} title="Test assignment (simulation)" />
      </div>
      <div style={{ marginTop: 18 }}><AssignmentBatch /></div>
      </>) : (
        <p className="small muted" role="note" style={{ marginTop: 18 }} data-testid="no-case-simulation">The simulation on this page assigns scripts to synthetic cases and needs the script permission. A rule that selects a survey is tried in Survey bindings and groups, against a synthetic application.</p>
      )}
    </>
  );
}

function RegistryRow({ i }: { i: RuleSummary }) {
  const o = useRuleOptions().data;
  const v = i.live ?? i.versions[i.versions.length - 1] ?? null;
  const kind = i.target_kind;
  const market = i.market;
  return (
    <tr data-testid={`rule-${i.rule_code}`} data-target-kind={kind} data-market={market}>
      <td><b>{v ? `#${v.priority}` : '—'}</b><div className="xsmall muted">specificity {v?.specificity ?? '—'}</div></td>
      <td><Link className="link" to={ruleHref(i.rule_code)}>{i.name}</Link><div className="xsmall muted"><span className="mono">{i.rule_code}</span> · market {market}</div>
        {v?.is_fallback ? <Badge tone="blue">Fallback</Badge> : null}</td>
      <td style={{ whiteSpace: 'normal', maxWidth: 380 }}>{v ? <ConditionChips conditions={v.conditions} o={o} /> : <span className="muted">Draft only</span>}</td>
      <td style={{ whiteSpace: 'normal' }} data-testid={`rule-selects-${i.rule_code}`}>
        {kind === SURVEY_ONLY ? (<><TargetKind kind={kind} /><div className="xsmall muted">A survey, only where a survey binding is published. Never assigns a script to a case.</div></>)
          : <>{v?.target.label ?? '—'}<div className="xsmall muted">A script, for cases</div></>}
      </td>
      <td>{v ? `v${v.version}` : '—'}{i.open_draft ? <div><Link className="xsmall link" to={ruleHref(i.rule_code, `draft=${i.open_draft.id}`)}>v{i.open_draft.planned_version} {i.open_draft.status === 'DRAFT' ? 'draft' : 'in review'}</Link></div> : null}</td>
      <td>{i.live ? <RuleStatus status="PUBLISHED" /> : v ? <RuleStatus status={v.status} /> : <RuleStatus status={i.open_draft?.status ?? 'DRAFT'} />}
        {i.live ? <div className="xsmall muted">since {when(i.live.effective_from).split(',')[0]}</div> : null}</td>
      <td>{i.versions.reduce((n, x) => n + x.cases_assigned, 0)}</td>
      <td><Link className="btn tiny" to={ruleHref(i.rule_code)}>Details</Link></td>
    </tr>
  );
}

function NewRuleForm({ copyFrom, items, surveyOnly, onCancel }: { copyFrom: string | null; items: RuleSummary[]; /** this server can create a rule that names no script */ surveyOnly: boolean; onCancel: () => void }) {
  const nav = useNavigate();
  const all = items.flatMap((i) => i.versions.map((v) => ({ id: v.id, kind: v.target_kind, label: `${v.rule_code} v${v.version} · ${v.name}` })));
  // a copy selects the same kind of thing as the rule it is copied from
  const [kind, setKind] = useState<'SCRIPT_VERSION' | 'SURVEY_BINDING'>(() => (all.find((v) => v.id === copyFrom)?.kind === SURVEY_ONLY && surveyOnly ? 'SURVEY_BINDING' : 'SCRIPT_VERSION'));
  const versions = all.filter((v) => v.kind === kind);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copy, setCopy] = useState(copyFrom ?? '');
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/assignment-rules', { body: { code, name, description, market: 'SG', copy_from_rule_version_id: copy || null, target_kind: kind } })),
    onSuccess: (r) => nav(ruleHref(r.rule_code, `draft=${r.draft_id}`)),
  });
  return (
    <form className="card card-pad stack" style={{ gap: 12, marginBottom: 16 }} aria-labelledby="nr-h" data-testid="new-rule-form" onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate(); }}>
      <h2 id="nr-h" style={{ margin: 0, fontSize: 16 }}>New mapping rule</h2>
      <p className="xsmall muted" style={{ margin: 0 }}>Creates draft version 1 for Singapore. Configure its conditions{kind === 'SURVEY_BINDING' ? '' : ', target script'} and dates next, then submit for an S&C checker.</p>
      {surveyOnly ? (
        <fieldset className="softbox" style={{ margin: 0 }} data-testid="nr-kind">
          <legend className="small strong">What does this rule select?</legend>
          <div className="stack" style={{ gap: 8 }}>
            <label className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input type="radio" name="nr-kind" checked={kind === 'SCRIPT_VERSION'} onChange={() => { setKind('SCRIPT_VERSION'); setCopy(''); }} data-testid="nr-kind-script" />
              <span><strong>A script, for cases.</strong> It points at a published script version and can assign it to a callback case. It can also be bound to a survey.</span>
            </label>
            <label className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input type="radio" name="nr-kind" checked={kind === 'SURVEY_BINDING'} onChange={() => { setKind('SURVEY_BINDING'); setCopy(''); }} data-testid="nr-kind-survey" />
              <span><strong>A survey, through a binding.</strong> It points at no script. It selects a survey only where a survey binding to it is published, and it can never assign a script to a case. No script needs to exist.</span>
            </label>
          </div>
          <p className="xsmall muted" style={{ margin: '8px 0 0' }}>This is fixed when the rule is created and is the same for every later version of it.</p>
        </fieldset>
      ) : null}
      <div className="input-grid">
        <Field id="nr-code" label="Rule code" hint="Permanent identity: capital letters, digits, '_' or '-' (e.g. SG-ILP-HIGH)">
          {(p) => <input {...p} className="field labelled" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required minLength={3} maxLength={40} />}
        </Field>
        <Field id="nr-name" label="Rule name">{(p) => <input {...p} className="field labelled" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} />}</Field>
        <Field id="nr-desc" label="Purpose (optional)">{(p) => <input {...p} className="field labelled" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />}</Field>
        <Field id="nr-copy" label="Copy conditions and settings from (optional)">
          {(p) => <select {...p} className="field labelled" value={copy} onChange={(e) => setCopy(e.target.value)} data-testid="nr-copy"><option value="">Start empty (market only)</option>{versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>}
        </Field>
      </div>
      <ErrorBox error={create.error ? errorText(create.error) : null} />
      <div className="row" style={{ gap: 8 }}>
        <Button type="submit" variant="primary" icon="plus" disabled={create.isPending} data-testid="new-rule-create">{create.isPending ? 'Creating…' : 'Create rule draft'}</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
