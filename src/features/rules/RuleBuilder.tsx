// S2-B visual rule builder: structured conditions from approved fields and governed values (no expressions), priority,
// calculated specificity, target script version, effective dates and the explicit fallback flag. Unsaved content is
// checked by the backend (`POST /assignment-rules/explain`) as you edit; saving uses the draft's row version.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/Icon';
import { Badge, Button, Card } from '../../components/ui';
import { isoToSgtInput, sgtInputToIso } from '../intake/model';
import { ErrorBox, errorText, Field } from '../scripts/ScriptEditor';
import { ConflictList, IssueList, type RuleCondition, type RuleContent, type RuleDraft, type RuleOptions, type RuleValue } from './shared';

type Err = ReturnType<typeof errorText> | null;

function fromDraft(d: RuleDraft): RuleContent {
  return {
    name: d.name, description: d.description, conditions: d.conditions, priority: d.priority, is_fallback: d.is_fallback,
    target_script_version_id: d.target?.id ?? null, effective_from: d.effective_from ?? null, effective_to: d.effective_to ?? null,
  };
}
const same = (a: RuleContent, b: RuleContent) => JSON.stringify(a) === JSON.stringify(b);

/** Debounced copy of a value (immediate validation feedback without a request per keystroke). */
function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useRuleChange(draftId: string, ruleCode: string) {
  const qc = useQueryClient();
  const [error, setError] = useState<Err>(null);
  const m = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => setError(null),
    onError: (e) => setError(errorText(e)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['rule-draft', draftId] });
      void qc.invalidateQueries({ queryKey: ['rule-history', ruleCode] });
      void qc.invalidateQueries({ queryKey: ['rule-registry'] });
    },
  });
  return { run: (fn: () => Promise<unknown>) => m.mutateAsync(fn).then(() => true, () => false), pending: m.isPending, error };
}

export function RuleBuilder({ d, o, onSaved }: { d: RuleDraft; o: RuleOptions; onSaved?: () => void }) {
  const [c, setC] = useState<RuleContent>(() => fromDraft(d));
  useEffect(() => { setC(fromDraft(d)); }, [d.id, d.row_version]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !same(c, fromDraft(d));
  const ch = useRuleChange(d.id, d.rule_code);
  const probe = useDebounced(c);
  const live = useQuery({
    queryKey: ['rule-explain', d.id, JSON.stringify(probe)],
    enabled: dirty,
    queryFn: async () => unwrap(await api.POST('/api/v1/assignment-rules/explain', { body: { ...probe, rule_code: d.rule_code, market: d.market } })),
    placeholderData: (prev) => prev,
  });
  const analysis = dirty && live.data ? live.data : d.analysis;
  const used = new Set(c.conditions.map((x) => x.field));
  const free = o.fields.filter((f) => !used.has(f.field));
  const setCond = (field: string, values: RuleValue[]) => setC({ ...c, conditions: c.conditions.map((x) => (x.field === field ? { field, values } : x)) });
  const save = () => ch.run(async () => unwrap(await api.PUT('/api/v1/assignment-rule-drafts/{draft_id}', { params: { path: { draft_id: d.id } }, body: { expected_row_version: d.row_version, content: c } }))).then((ok) => { if (ok) onSaved?.(); });
  const targets = o.targets;
  const chosen = targets.find((t) => t.id === c.target_script_version_id);

  return (
    <div className="stack" style={{ gap: 16 }} data-testid="rule-builder">
      <Card title="Rule" subtitle="Name it for business users; the rule code is its permanent identity">
        <div className="input-grid">
          <Field id="rb-name" label="Rule name">{(p) => <input {...p} className="field labelled" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} maxLength={120} />}</Field>
          <Field id="rb-desc" label="Purpose (optional)">{(p) => <input {...p} className="field labelled" value={c.description ?? ''} onChange={(e) => setC({ ...c, description: e.target.value })} maxLength={1000} />}</Field>
        </div>
      </Card>

      <Card title="When does this rule apply?" subtitle="All conditions must hold. A field you do not add is unrestricted (any value). No code or expressions.">
        <div className="stack" style={{ gap: 10 }} data-testid="rule-conditions">
          {c.conditions.map((cond) => (
            <ConditionRow key={cond.field} cond={cond} o={o} locked={o.fields.find((f) => f.field === cond.field)?.required ?? false}
              onChange={(values) => setCond(cond.field, values)}
              onRemove={() => setC({ ...c, conditions: c.conditions.filter((x) => x.field !== cond.field) })} />
          ))}
          {free.length ? (
            <div className="row wrap" style={{ gap: 8 }}>
              <label className="form-label" htmlFor="rb-add" style={{ margin: 0 }}>Add a condition</label>
              <select id="rb-add" className="field" value="" data-testid="rb-add-condition"
                onChange={(e) => { const f = o.fields.find((x) => x.field === e.target.value); if (f) setC({ ...c, conditions: [...c.conditions, { field: f.field, values: [] }] }); }}>
                <option value="">Choose a field…</option>
                {free.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
              </select>
            </div>
          ) : null}
          {o.unsupported.length ? (
            <p className="xsmall muted" style={{ margin: 0 }} data-testid="rb-unsupported">
              Not available as conditions: {o.unsupported.map((u) => <span key={u.field} title={u.reason}><strong>{u.label}</strong> — {u.reason}</span>)}
            </p>
          ) : null}
        </div>
      </Card>

      <Card title="Precedence, target and dates" subtitle="Lower priority number wins; on equal priority the more specific rule wins">
        <div className="input-grid">
          <Field id="rb-priority" label="Priority (1 is highest)" hint="1–999. Equal priority and specificity with another rule is a conflict.">
            {(p) => <input {...p} type="number" min={1} max={999} className="field labelled" value={c.priority}
              onChange={(e) => setC({ ...c, priority: Number(e.target.value) })} data-testid="rb-priority" />}
          </Field>
          <div className="stack" style={{ gap: 4 }}>
            <span className="form-label" style={{ marginBottom: 0 }}>Specificity (calculated)</span>
            <strong className="small" data-testid="rb-specificity">{analysis.specificity}</strong>
            <span className="xsmall muted">Number of constrained fields; several values in one field count once. Cannot be edited.</span>
          </div>
          <Field id="rb-target" label="Assign this published script version" hint={chosen && chosen.content_approval_status !== 'APPROVED_BY_SC' ? 'Synthetic script — not production-approved wording' : undefined}>
            {(p) => (
              <select {...p} className="field labelled" value={c.target_script_version_id ?? ''} data-testid="rb-target"
                onChange={(e) => setC({ ...c, target_script_version_id: e.target.value || null })}>
                <option value="">Choose a script version…</option>
                {targets.map((t) => <option key={t.id} value={t.id} disabled={!t.selectable}>{t.label}{t.selectable ? '' : ` (${t.status.toLowerCase()} — not selectable)`}</option>)}
              </select>
            )}
          </Field>
          <div className="stack" style={{ gap: 6 }}>
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={c.is_fallback ?? false} onChange={(e) => setC({ ...c, is_fallback: e.target.checked })} data-testid="rb-fallback" />
              Default fallback rule
            </label>
            <span className="xsmall muted">Used only when no other rule matches; never used to resolve ambiguity. Must be approved like any rule.</span>
          </div>
          <Field id="rb-from" label="Effective from (SGT)" hint="Leave empty to start on publication">
            {(p) => <input {...p} type="datetime-local" className="field labelled" value={c.effective_from ? isoToSgtInput(c.effective_from) : ''}
              onChange={(e) => setC({ ...c, effective_from: e.target.value ? sgtInputToIso(e.target.value) : null })} data-testid="rb-from" />}
          </Field>
          <Field id="rb-to" label="Effective to (SGT, optional)" hint="Leave empty for open-ended">
            {(p) => <input {...p} type="datetime-local" className="field labelled" value={c.effective_to ? isoToSgtInput(c.effective_to) : ''}
              onChange={(e) => setC({ ...c, effective_to: e.target.value ? sgtInputToIso(e.target.value) : null })} data-testid="rb-to" />}
          </Field>
        </div>
      </Card>

      <Card title="In plain English" subtitle={dirty ? 'Checked by the server as you edit (not saved yet)' : 'Saved draft'}>
        <div className="stack" style={{ gap: 12 }} aria-live="polite">
          <div className="explain" data-testid="rule-explanation">{analysis.explanation}</div>
          <div><div className="section-label">Validation</div><IssueList analysis={analysis} /></div>
          <div><div className="section-label">Overlaps and conflicts with live rules and other drafts</div><ConflictList conflicts={analysis.conflicts} /></div>
        </div>
      </Card>

      <div className="row wrap" style={{ gap: 8 }}>
        <Button variant="primary" icon="check" onClick={() => void save()} disabled={!dirty || ch.pending} data-testid="rb-save">{ch.pending ? 'Saving…' : 'Save draft'}</Button>
        <Button onClick={() => setC(fromDraft(d))} disabled={!dirty || ch.pending}>Discard changes</Button>
        {dirty ? <span className="small muted" role="status" data-testid="rb-dirty">Unsaved changes</span> : <span className="small muted">All changes saved · row version {d.row_version}</span>}
      </div>
      <ErrorBox error={ch.error} />
    </div>
  );
}

function ConditionRow({ cond, o, locked, onChange, onRemove }: {
  cond: RuleCondition; o: RuleOptions; locked: boolean; onChange: (v: RuleValue[]) => void; onRemove: () => void;
}) {
  const f = o.fields.find((x) => x.field === cond.field);
  if (!f) return null;
  const toggle = (v: RuleValue, on: boolean) => onChange(on ? [...cond.values, v] : cond.values.filter((x) => x !== v));
  return (
    <fieldset className="softbox" style={{ margin: 0 }} data-testid={`rb-cond-${cond.field}`}>
      <legend className="small strong" style={{ padding: '0 4px' }}>{f.label} {locked ? <Icon name="lock" size="sm" /> : null}</legend>
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className="row wrap" style={{ gap: 6 }}>
          <span className="small muted">is any of</span>
          {f.values.map((v) => {
            const on = cond.values.includes(v.value);
            return (
              <label key={String(v.value)} className={`tag${on ? ' strong' : ''}`} style={{ cursor: locked ? 'default' : 'pointer', borderColor: on ? '#d89aa3' : undefined, background: on ? '#fff6f7' : undefined }}>
                <input type="checkbox" checked={on} disabled={locked} onChange={(e) => toggle(v.value, e.target.checked)} />{v.label}
              </label>
            );
          })}
        </span>
        {locked ? <Badge tone="gray" noDot>Required — your market</Badge> : <Button tiny onClick={onRemove} aria-label={`Remove the ${f.label} condition`}>Remove</Button>}
      </div>
      <div className="xsmall muted" style={{ marginTop: 6 }}>{f.source}{cond.values.length === 0 ? ' · choose at least one value, or remove the condition to allow any' : ''}</div>
    </fieldset>
  );
}

/** Submission and abandonment of a saved draft (author or editor). */
export function SubmitPanel({ d }: { d: RuleDraft }) {
  const { me } = useAuth();
  const ch = useRuleChange(d.id, d.rule_code);
  const [summary, setSummary] = useState('');
  const [abandon, setAbandon] = useState(false);
  const [reason, setReason] = useState('');
  const maker = !!me && d.makers.includes(me.principal.principal_id);
  return (
    <Card title="Submit for checker review" subtitle="Submission validates conflicts and target eligibility, freezes the rule (SHA-256) and locks it">
      <div className="stack" style={{ gap: 10 }} data-testid="rule-submit-panel">
        {!d.analysis.valid ? <p className="small" role="note"><Badge tone="red">Blocked</Badge> Fix the validation errors above before submitting.</p> : null}
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void ch.run(async () => unwrap(await api.POST('/api/v1/assignment-rule-drafts/{draft_id}/submit', { params: { path: { draft_id: d.id } }, body: { expected_row_version: d.row_version, change_summary: summary } }))); }}>
          <Field id="rs-summary" label="Change summary for the checker" hint="What the rule does and why (10–2000 characters)">
            {(p) => <textarea {...p} className="field textarea labelled" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} required minLength={10} />}
          </Field>
          <div><Button type="submit" variant="primary" icon="upload" disabled={ch.pending || !d.analysis.valid} data-testid="rule-submit">Submit for review</Button></div>
        </form>
        {maker ? (abandon ? (
          <form className="softbox stack" style={{ gap: 8 }} data-testid="rule-abandon-form" onSubmit={(e) => { e.preventDefault(); void ch.run(async () => unwrap(await api.POST('/api/v1/assignment-rule-drafts/{draft_id}/abandon', { params: { path: { draft_id: d.id } }, body: { expected_row_version: d.row_version, reason } }))); }}>
            <p className="small" style={{ margin: 0 }}>Abandoning freezes this draft and records your reason. Nothing is deleted.</p>
            <Field id="ra-reason" label="Reason for abandoning">{(p) => <textarea {...p} className="field textarea labelled" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} />}</Field>
            <div className="row" style={{ gap: 8 }}><Button type="submit" variant="danger" data-testid="rule-abandon-confirm">Abandon draft</Button><Button onClick={() => setAbandon(false)}>Keep draft</Button></div>
          </form>
        ) : <div><Button tiny variant="danger" onClick={() => setAbandon(true)} data-testid="rule-abandon">Abandon draft…</Button></div>) : null}
        <ErrorBox error={ch.error} />
      </div>
    </Card>
  );
}
