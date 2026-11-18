// S3-B Finding Rules (`/finding-rules`, Governance): the governed, versioned rule set that turns answer-evaluation
// outcomes into findings. Authors (script.edit) edit a draft with governed values only; a different S&C checker
// approves (script.approve) and publishes (script.publish); published versions are immutable and superseded versions
// are kept. Severity always comes from a rule with its justification — never assumed. Nothing here creates a finding.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useAuth } from '../../auth/AuthContext';
import { Empty } from '../../components/StateView';
import { Badge, Button, Card, PageHead, type Tone } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import { ErrorBox, errorText, Field } from '../scripts/ScriptEditor';

type RuleSet = components['schemas']['FindingRuleSetOut'];
type Rule = components['schemas']['FindingRuleIn'];
type Options = components['schemas']['FindingRuleOptions'];

export const SEVERITY_TONE: Record<string, Tone> = { CRITICAL: 'red', HIGH: 'red', MEDIUM: 'amber', LOW: 'gray' };
export const CLASS_TONE: Record<string, Tone> = { CUSTOMER_DISCREPANCY: 'red', MISSING_EVIDENCE: 'amber', SYSTEM_DATA_ISSUE: 'blue', HUMAN_ASSESSMENT: 'purple' };
const STATUS_TONE: Record<string, Tone> = { DRAFT: 'amber', SUBMITTED_FOR_REVIEW: 'blue', APPROVED: 'blue', PUBLISHED: 'green', SUPERSEDED: 'gray', ABANDONED: 'gray' };

export function useFindingRuleOptions() {
  return useQuery({ queryKey: ['finding-rule-options'], queryFn: async () => unwrap(await api.GET('/api/v1/finding-rule-sets/options')), staleTime: 300_000 });
}

export function useFindingRuleSets() {
  return useQuery({ queryKey: ['finding-rule-sets'], queryFn: async () => unwrap(await api.GET('/api/v1/finding-rule-sets')) });
}

export function FindingRulesPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useFindingRuleSets();
  const selected = params.get('version') ?? list.data?.items.find((i) => ['DRAFT', 'SUBMITTED_FOR_REVIEW', 'APPROVED'].includes(i.status))?.id ?? list.data?.published_id ?? list.data?.items[0]?.id ?? null;
  const create = useMutation({
    mutationFn: async (empty: boolean) => unwrap(await api.POST('/api/v1/finding-rule-sets', { body: { empty } })),
    onSuccess: (v) => { void qc.invalidateQueries({ queryKey: ['finding-rule-sets'] }); setParams({ version: v.id }); },
  });
  const open = list.data?.items.some((i) => ['DRAFT', 'SUBMITTED_FOR_REVIEW', 'APPROVED'].includes(i.status));
  return (
    <>
      <PageHead eyebrow="Compliance governance" title="Finding Rules"
        description="Governed rules that turn answer-evaluation outcomes into findings for human review: which question or compliance control, which evaluation outcome, the finding category, severity with its justification and whether review is required. Drafted by an author, approved and published by a different S&C checker; published versions are immutable."
        actions={can('script.edit') && !open ? <div className="row" style={{ gap: 8 }}>
          <Button variant="primary" icon="plus" onClick={() => create.mutate(false)} disabled={create.isPending} data-testid="frs-new">{list.data?.published_id ? 'New draft from published' : 'New rule set'}</Button>
        </div> : undefined} />
      <div className="topnotice" role="note" data-testid="frs-banner"><span><strong>Synthetic configuration.</strong> Rules, categories and severities here are development examples, not approved compliance policy or regulatory classifications. A finding is a flagged potential concern for review — never a breach determination, case decision or verification outcome.</span></div>
      <ErrorBox error={create.error ? errorText(create.error) : null} />
      <div className="layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <Card title="Versions" subtitle="Newest first; published versions are immutable">
          <Region query={list} label="finding rule sets">
            {() => list.data!.items.length ? (
              <nav aria-label="Finding rule set versions" className="stack" style={{ gap: 6 }} data-testid="frs-versions">
                {list.data!.items.map((v) => (
                  <button key={v.id} type="button" className={`softbox ${v.id === selected ? 'selected' : ''}`} onClick={() => setParams({ version: v.id })}
                    style={{ textAlign: 'left', cursor: 'pointer', border: v.id === selected ? '1px solid var(--red-500, #c8102e)' : undefined, minHeight: 44 }} data-testid={`frs-version-${v.version_no}`}>
                    <div className="row between" style={{ gap: 6 }}><strong className="small">v{v.version_no}</strong><Badge tone={STATUS_TONE[v.status] ?? 'gray'}>{humanize(v.status)}</Badge></div>
                    <div className="xsmall muted">{v.rules_count} rule{v.rules_count === 1 ? '' : 's'} · {v.published_at ? `published ${when(v.published_at)}` : `created ${when(v.created_at)}`}</div>
                  </button>
                ))}
              </nav>
            ) : <Empty title="No finding rules yet">Create the first rule set. Until one is published, no findings are generated.</Empty>}
          </Region>
        </Card>
        {selected ? <RuleSetView key={selected} id={selected} /> : <Card><Empty title="No version selected">Choose a version.</Empty></Card>}
      </div>
    </>
  );
}

function RuleSetView({ id }: { id: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const uid = useId();
  const opts = useFindingRuleOptions();
  const q = useQuery({ queryKey: ['finding-rule-set', id], queryFn: async () => unwrap(await api.GET('/api/v1/finding-rule-sets/{version_id}', { params: { path: { version_id: id } } })) });
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [summary, setSummary] = useState('');
  const [reason, setReason] = useState('');
  const path = { params: { path: { version_id: id } } };
  const done = (v: RuleSet) => { qc.setQueryData(['finding-rule-set', id], v); void qc.invalidateQueries({ queryKey: ['finding-rule-sets'] }); setEditing(null); };
  const save = useMutation({ mutationFn: async (rules: Rule[]) => unwrap(await api.PUT('/api/v1/finding-rule-sets/{version_id}', { ...path, body: { expected_row_version: q.data!.row_version, rules, change_summary: null } })), onSuccess: done });
  const submit = useMutation({ mutationFn: async () => unwrap(await api.POST('/api/v1/finding-rule-sets/{version_id}/submit', { ...path, body: { expected_row_version: q.data!.row_version, change_summary: summary } })), onSuccess: done });
  const review = useMutation({ mutationFn: async (decision: 'APPROVE' | 'RETURN') => unwrap(await api.POST('/api/v1/finding-rule-sets/{version_id}/review', { ...path, body: { decision, reason } })), onSuccess: done });
  const publish = useMutation({ mutationFn: async () => unwrap(await api.POST('/api/v1/finding-rule-sets/{version_id}/publish', path)), onSuccess: done });
  const abandon = useMutation({ mutationFn: async () => unwrap(await api.POST('/api/v1/finding-rule-sets/{version_id}/abandon', { ...path, body: { reason: reason || 'Abandoned by the author' } })), onSuccess: done });
  const err = save.error ?? submit.error ?? review.error ?? publish.error ?? abandon.error;
  return (
    <Region query={q} label="the finding rule set">
      {() => {
        const v = q.data!;
        const draft = v.status === 'DRAFT' && can('script.edit');
        const rules = v.rules.map((x) => ({ rule_code: x.rule_code, scope: x.scope, target: x.target, mandatory_only: x.mandatory_only, trigger: x.trigger, category: x.category, description: x.description, severity: x.severity, severity_justification: x.severity_justification, review_required: x.review_required }) as Rule);
        const d = v.diff_vs_published as { added: string[]; removed: string[]; changed: { rule_code: string; changes: Record<string, { from: unknown; to: unknown }> }[] } | null;
        return (
          <div className="stack" style={{ gap: 16 }}>
            <Card title={v.label} subtitle={`${v.rules_count} rules · checksum ${v.rules_sha256.slice(0, 12)}… · ${humanize(v.content_approval_status)}`} aside={<Badge tone={STATUS_TONE[v.status] ?? 'gray'}>{humanize(v.status)}</Badge>}>
              <div className="stack" style={{ gap: 10 }} data-testid="frs-detail">
                {v.status === 'PUBLISHED' ? <p className="small" style={{ margin: 0 }} data-testid="frs-immutable">Published and immutable. To change rules, open a new draft; this version is kept when superseded.</p> : null}
                {v.status === 'SUPERSEDED' ? <p className="small muted" style={{ margin: 0 }}>Superseded — kept unchanged as the configuration earlier findings used.</p> : null}
                {v.warnings.length ? <ul className="plain-list xsmall stack" style={{ gap: 2 }} aria-label="Warnings">{v.warnings.map((w) => <li key={w}><Badge tone="amber">Warning</Badge> {w}</li>)}</ul> : null}
                <RulesTable rules={v.rules} editable={draft} onEdit={(i) => setEditing(i)} onRemove={(i) => save.mutate(rules.filter((_, j) => j !== i))} />
                {draft && editing === null ? <div><Button icon="plus" onClick={() => setEditing('new')} data-testid="frs-add-rule">Add rule</Button></div> : null}
                {draft && editing !== null && opts.data ? (
                  <RuleForm o={opts.data} initial={editing === 'new' ? null : rules[editing] ?? null} pending={save.isPending} onCancel={() => setEditing(null)}
                    onSave={(r) => save.mutate(editing === 'new' ? [...rules, r] : rules.map((x, j) => (j === editing ? r : x)))} />
                ) : null}
                <ErrorBox error={err ? errorText(err) : null} />
              </div>
            </Card>
            {d && (d.added.length || d.removed.length || d.changed.length) ? (
              <Card title="Changes against the published version">
                <ul className="plain-list xsmall stack" style={{ gap: 4 }} data-testid="frs-diff">
                  {d.added.map((x) => <li key={`a${x}`}><Badge tone="green">Added</Badge> {x}</li>)}
                  {d.removed.map((x) => <li key={`r${x}`}><Badge tone="red">Removed</Badge> {x}</li>)}
                  {d.changed.map((x) => <li key={`c${x.rule_code}`}><Badge tone="amber">Changed</Badge> <span className="mono">{x.rule_code}</span> — {Object.entries(x.changes).map(([k, c]) => `${humanize(k.toUpperCase())}: ${String(c.from)} → ${String(c.to)}`).join('; ')}</li>)}
                </ul>
              </Card>
            ) : null}
            <Card title="Review and publish" subtitle="An author submits; a different S&C checker approves and publishes">
              <div className="stack" style={{ gap: 10 }} data-testid="frs-workflow">
                {draft ? (
                  <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
                    <Field id={`${uid}-s`} label="Change summary for the reviewer">{(p) => <input {...p} className="field labelled" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} style={{ minWidth: 280 }} data-testid="frs-summary" />}</Field>
                    <Button variant="primary" onClick={() => submit.mutate()} disabled={submit.isPending || !v.rules.length} data-testid="frs-submit">Submit for review</Button>
                    <Button variant="danger" onClick={() => abandon.mutate()} disabled={abandon.isPending} data-testid="frs-abandon">Abandon draft</Button>
                  </div>
                ) : null}
                {v.status === 'SUBMITTED_FOR_REVIEW' && can('script.approve') ? (
                  v.i_am_maker ? <p className="small" data-testid="frs-maker-note">You authored this version; another S&C checker must review it.</p> : (
                    <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
                      <Field id={`${uid}-r`} label="Reviewer reason">{(p) => <input {...p} className="field labelled" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} style={{ minWidth: 280 }} data-testid="frs-reason" />}</Field>
                      <Button variant="primary" onClick={() => review.mutate('APPROVE')} disabled={review.isPending} data-testid="frs-approve">Approve</Button>
                      <Button onClick={() => review.mutate('RETURN')} disabled={review.isPending} data-testid="frs-return">Return to author</Button>
                    </div>
                  )
                ) : null}
                {v.status === 'APPROVED' && can('script.publish') ? (v.i_am_maker ? <p className="small">You authored this version; another S&C checker must publish it.</p>
                  : <div><Button variant="primary" onClick={() => publish.mutate()} disabled={publish.isPending} data-testid="frs-publish">Publish</Button></div>) : null}
                {v.review_reason ? <p className="xsmall muted" style={{ margin: 0 }}>Review: {v.review_reason}{v.reviewed_by_name ? ` — ${v.reviewed_by_name}` : ''}</p> : null}
                <ol className="plain-list xsmall stack" style={{ gap: 2 }} aria-label="History" data-testid="frs-history">
                  {v.history.map((h, i) => <li key={i}><strong>{humanize(h.action)}</strong> · {h.actor_name ?? '—'} · {when(h.occurred_at)}{h.reason ? ` — ${h.reason}` : ''}</li>)}
                </ol>
                <p className="xsmall muted" style={{ margin: 0 }}>{v.note}</p>
              </div>
            </Card>
          </div>
        );
      }}
    </Region>
  );
}

function RulesTable({ rules, editable, onEdit, onRemove }: { rules: RuleSet['rules']; editable: boolean; onEdit: (i: number) => void; onRemove: (i: number) => void }) {
  if (!rules.length) return <p className="small muted" style={{ margin: 0 }}>No rules: no evaluation outcome becomes a finding.</p>;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Finding rules"><table className="data-table" data-testid="frs-rules">
      <thead><tr><th>Rule</th><th>Applies to</th><th>When evaluated</th><th>Finding</th><th>Severity</th>{editable ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead>
      <tbody>{rules.map((r, i) => (
        <tr key={r.rule_code} data-testid={`frs-rule-${r.rule_code}`}>
          <td><span className="mono small">{r.rule_code}</span><div className="xsmall muted" style={{ whiteSpace: 'normal', maxWidth: 260 }}>{r.description}</div></td>
          <td className="small">{r.scope === 'QUESTION' ? <span className="mono">{r.target}</span> : r.scope === 'CONTROL' ? <>Control <span className="mono">{r.target}</span></> : `Any ${r.mandatory_only ? 'mandatory ' : ''}question`}</td>
          <td className="small">{humanize(r.trigger)}<div className="xsmall"><Badge tone={CLASS_TONE[r.finding_class ?? ''] ?? 'gray'}>{humanize(r.finding_class ?? '')}</Badge></div></td>
          <td className="small">{humanize(r.category)}{r.review_required ? <div className="xsmall muted">Human review required</div> : null}</td>
          <td><Badge tone={SEVERITY_TONE[r.severity] ?? 'gray'}>{r.severity}</Badge><div className="xsmall muted" style={{ whiteSpace: 'normal', maxWidth: 240 }}>{r.severity_justification}</div></td>
          {editable ? <td><div className="row" style={{ gap: 4 }}><Button tiny onClick={() => onEdit(i)} aria-label={`Edit ${r.rule_code}`}>Edit</Button><Button tiny variant="danger" onClick={() => onRemove(i)} aria-label={`Remove ${r.rule_code}`}>Remove</Button></div></td> : null}
        </tr>
      ))}</tbody>
    </table></div>
  );
}

const EMPTY: Rule = { rule_code: 'FR-', scope: 'QUESTION', target: '', mandatory_only: false, trigger: 'MISMATCH', category: 'FACT_MISMATCH', description: '', severity: 'MEDIUM', severity_justification: '', review_required: true };

function RuleForm({ o, initial, pending, onSave, onCancel }: { o: Options; initial: Rule | null; pending: boolean; onSave: (r: Rule) => void; onCancel: () => void }) {
  const [r, setR] = useState<Rule>(initial ?? EMPTY);
  const id = useId();
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setR((x) => ({ ...x, [k]: v }));
  const cats = o.trigger_categories[r.trigger] ?? [];
  return (
    <form className="softbox stack" style={{ gap: 10 }} data-testid="frs-rule-form" onSubmit={(e) => { e.preventDefault(); onSave(r); }}>
      <div className="input-grid">
        <Field id={`${id}-c`} label="Rule code" hint="FR-…, stable">{(p) => <input {...p} className="field labelled" value={r.rule_code} onChange={(e) => set('rule_code', e.target.value.toUpperCase())} data-testid="frs-f-code" />}</Field>
        <Field id={`${id}-s`} label="Applies to">{(p) => <select {...p} className="field labelled" value={r.scope} onChange={(e) => setR((x) => ({ ...x, scope: e.target.value as Rule['scope'], target: '' }))} data-testid="frs-f-scope">
          <option value="QUESTION">A question</option><option value="CONTROL">Questions linked to a compliance control</option><option value="ANY_QUESTION">Any question</option></select>}</Field>
        {r.scope === 'QUESTION' ? <Field id={`${id}-q`} label="Question">{(p) => <select {...p} className="field labelled" value={r.target ?? ''} onChange={(e) => set('target', e.target.value)} data-testid="frs-f-question">
          <option value="">Choose…</option>{o.questions.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}</select>}</Field> : null}
        {r.scope === 'CONTROL' ? <Field id={`${id}-k`} label="Compliance control">{(p) => <select {...p} className="field labelled" value={r.target ?? ''} onChange={(e) => set('target', e.target.value)} data-testid="frs-f-control">
          <option value="">Choose…</option>{o.controls.map((x) => <option key={x.code} value={x.code}>{x.code} — {x.label}</option>)}</select>}</Field> : null}
        <Field id={`${id}-t`} label="When the evaluation is" hint={`Finding class: ${humanize(o.trigger_class[r.trigger] ?? '')} (system-defined)`}>{(p) => <select {...p} className="field labelled" value={r.trigger} onChange={(e) => { const t = e.target.value; setR((x) => ({ ...x, trigger: t, category: (o.trigger_categories[t] ?? [])[0] ?? x.category, review_required: t === 'HUMAN_ASSESSMENT_REQUIRED' ? true : x.review_required })); }} data-testid="frs-f-trigger">
          {o.triggers.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>}</Field>
        <Field id={`${id}-cat`} label="Finding category" hint="Only categories approved for this outcome">{(p) => <select {...p} className="field labelled" value={r.category} onChange={(e) => set('category', e.target.value)} data-testid="frs-f-category">
          {cats.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>}</Field>
        <Field id={`${id}-sev`} label="Severity" hint="Compliance finding severity — not SBQ selection risk">{(p) => <select {...p} className="field labelled" value={r.severity} onChange={(e) => set('severity', e.target.value as Rule['severity'])} data-testid="frs-f-severity">
          {o.severities.map((s) => <option key={s} value={s}>{s}</option>)}</select>}</Field>
      </div>
      <Field id={`${id}-j`} label="Severity justification" hint="Required: why this severity (10–300 characters); no severity is assumed">{(p) => <input {...p} className="field labelled" value={r.severity_justification} onChange={(e) => set('severity_justification', e.target.value)} maxLength={300} data-testid="frs-f-justification" />}</Field>
      <Field id={`${id}-d`} label="Finding description">{(p) => <input {...p} className="field labelled" value={r.description} onChange={(e) => set('description', e.target.value)} maxLength={300} data-testid="frs-f-description" />}</Field>
      <div className="row wrap" style={{ gap: 16 }}>
        {r.scope !== 'QUESTION' ? <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={!!r.mandatory_only} onChange={(e) => set('mandatory_only', e.target.checked)} data-testid="frs-f-mandatory" /> Mandatory questions only</label> : null}
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={r.review_required || r.trigger === 'HUMAN_ASSESSMENT_REQUIRED'} disabled={r.trigger === 'HUMAN_ASSESSMENT_REQUIRED'} onChange={(e) => set('review_required', e.target.checked)} data-testid="frs-f-review" /> Human review required</label>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Button type="submit" variant="primary" disabled={pending} data-testid="frs-f-save">{pending ? 'Saving…' : 'Save rule'}</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
