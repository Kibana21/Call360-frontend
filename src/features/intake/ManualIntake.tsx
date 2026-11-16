// Manual Intake form (CP0.4b). The user fills the transaction; "Preview" sends the exact current payload to API-084
// and shows the server's validation and planned effects; "Submit" is possible only while that preview still matches
// the form, and sends API-085 with an Idempotency-Key that is kept for retries of the same payload.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiFailure, unwrap } from '../../api/client';
import { Badge, Button, Card } from '../../components/ui';
import { humanize, Region } from '../cases/shared';
import {
  emptyContact, emptyForm, emptyParty, fieldId, isoToSgtInput, issuesOf, newIdempotencyKey, prefillFromPolicy, productKey,
  sgtInputToIso, toPayload, type FieldIssue, type IntakeForm, type IntakeOutcome, type IntakeReference,
} from './model';
import { OutcomeLinks, OutcomeView } from './Outcome';

interface Problem { status: number; code: string; message: string; correlationId?: string | null }

function problemOf(e: unknown): Problem {
  if (e instanceof ApiFailure) return { status: e.status, code: e.code ?? 'ERROR', message: e.message, correlationId: e.body?.correlation_id };
  return { status: 0, code: 'NETWORK', message: 'The server could not be reached. Your entries are kept; try again.' };
}

/** Immutable update of a nested form value by dotted path (`parties.0.contacts.1.value`). */
function setIn<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const copy: Record<string, unknown> | unknown[] = Array.isArray(obj) ? [...obj] : { ...(obj as Record<string, unknown>) };
  (copy as Record<string, unknown>)[head!] = rest.length ? setIn((obj as Record<string, unknown>)[head!], rest.join('.'), value) : value;
  return copy as T;
}

export function ManualIntake({ onShowRun }: { onShowRun: (runId: string) => void }) {
  const reference = useQuery({ queryKey: ['intake', 'reference'], queryFn: async () => unwrap(await api.GET('/api/v1/intake/reference')) });
  return (
    <Region query={reference} label="intake reference data">
      {() => <IntakeWorkspace reference={reference.data!} onShowRun={onShowRun} />}
    </Region>
  );
}

function IntakeWorkspace({ reference: ref, onShowRun }: { reference: IntakeReference; onShowRun: (runId: string) => void }) {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [form, setForm] = useState<IntakeForm>(emptyForm);
  const [preview, setPreview] = useState<{ json: string; outcome: IntakeOutcome } | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempt, setAttempt] = useState<{ json: string; key: string } | null>(null);
  const [result, setResult] = useState<IntakeOutcome | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const payload = useMemo(() => toPayload(form, ref), [form, ref]);
  const json = useMemo(() => JSON.stringify(payload), [payload]);
  const fresh = preview !== null && preview.json === json;
  const set = (path: string, value: unknown) => setForm((f) => setIn(f, path, value));
  const err = (key: string) => issues.filter((i) => i.key === key);

  const fail = (e: unknown) => {
    const p = problemOf(e);
    const fieldIssues = e instanceof ApiFailure ? issuesOf(e.body?.details) : [];
    setIssues(fieldIssues);
    setProblem(p);
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const previewMutation = useMutation({
    mutationFn: async (body: { json: string }) => ({
      json: body.json,
      outcome: unwrap(await api.POST('/api/v1/intake/manual/preview', { body: payload })),
    }),
    onMutate: () => { setProblem(null); setIssues([]); },
    onSuccess: (r) => setPreview(r),
    onError: (e) => { setPreview(null); fail(e); },
  });

  const submitMutation = useMutation({
    mutationFn: async (a: { json: string; key: string }) => unwrap(await api.POST('/api/v1/intake/manual', {
      body: payload, params: { header: { 'Idempotency-Key': a.key } },
    })),
    onMutate: () => setProblem(null),
    onSuccess: (r) => {
      setResult(r);
      setIssues([]);
      void qc.invalidateQueries();
      requestAnimationFrame(() => summaryRef.current?.focus());
    },
    onError: (e) => fail(e),
  });

  const busy = previewMutation.isPending || submitMutation.isPending;
  const runPreview = () => previewMutation.mutate({ json });
  const runSubmit = () => {
    if (!fresh || busy || result) return;
    // The same payload keeps its key, so a retry after a lost response replays instead of creating twice.
    const a = attempt?.json === json ? attempt : { json, key: newIdempotencyKey() };
    setAttempt(a);
    submitMutation.mutate(a);
  };
  const reset = () => {
    setForm(emptyForm()); setPreview(null); setIssues([]); setProblem(null); setAttempt(null); setResult(null);
    window.scrollTo({ top: 0 });
  };

  // `?policy=POL-SG-…` (from Policy Detail) opens the form on that existing policy.
  const initialPolicy = params.get('policy');
  const locked = result !== null;
  const ctx: Ctx = { form, set, err, ref, locked };

  return (
    <div className="intake-grid">
      <form className="stack" style={{ gap: 16 }} aria-label="Manual intake transaction" noValidate
        onSubmit={(e) => { e.preventDefault(); runPreview(); }}>
        <fieldset className="intake-fieldset" disabled={locked}>
          <PolicySection ctx={ctx} initialPolicy={initialPolicy} onLoaded={(p) => setForm((f) => prefillFromPolicy(f, p))}
            onNew={() => setForm((f) => ({ ...emptyForm(), source_system: f.source_system, source_event_id: f.source_event_id, reason: f.reason, sale: f.sale, callback: f.callback, include_risk: f.include_risk, risk: f.risk }))} />
          <SaleSection ctx={ctx} />
          <PartiesSection ctx={ctx} />
          <RiskSection ctx={ctx} />
          <CallbackSection ctx={ctx} />
          <SourceSection ctx={ctx} />
        </fieldset>
      </form>

      <aside className="intake-panel" aria-label="Preview and submit">
        <Card title={result ? 'Submission result' : 'Preview and submit'}
          subtitle={result ? 'Stored by the intake API' : 'The server validates the exact form below; nothing is saved by a preview.'}>
          <div ref={summaryRef} tabIndex={-1} className="stack" style={{ outline: 'none' }}>
            {!result ? (
              <div className="row wrap" aria-live="polite" data-testid="preview-state">
                {fresh ? <Badge tone="green">Preview matches the form</Badge>
                  : preview ? <Badge tone="amber">Form changed since preview — preview again</Badge>
                  : <Badge tone="gray">Not previewed</Badge>}
              </div>
            ) : null}
            {problem ? <ProblemView problem={problem} issues={issues} /> : null}
            {result ? (
              <>
                <OutcomeView outcome={result} />
                <OutcomeLinks outcome={result} />
                <div className="row wrap">
                  {result.run_id ? <Button tiny onClick={() => onShowRun(result.run_id!)}>View intake run</Button> : null}
                  <Button tiny icon="plus" onClick={reset}>Start another transaction</Button>
                </div>
              </>
            ) : (
              <>
                <div className="row wrap">
                  <Button variant={fresh ? '' : 'primary'} icon="search" onClick={runPreview} disabled={busy}>
                    {previewMutation.isPending ? 'Previewing…' : 'Preview'}
                  </Button>
                  <Button variant={fresh ? 'primary' : ''} icon="upload" onClick={runSubmit} disabled={!fresh || busy}
                    aria-describedby="submit-note">
                    {submitMutation.isPending ? 'Submitting…' : attempt?.json === json && problem && problem.status === 0 ? 'Retry submission' : 'Submit transaction'}
                  </Button>
                </div>
                <p id="submit-note" className="xsmall muted" style={{ margin: 0 }}>
                  {fresh ? 'Submits exactly what was previewed, once. A retry of the same transaction returns the stored result.'
                    : 'Submit is available after a successful preview of the current form.'}
                </p>
                {fresh && preview ? <OutcomeView outcome={preview.outcome} /> : null}
              </>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}

function ProblemView({ problem, issues }: { problem: Problem; issues: FieldIssue[] }) {
  const conflict = problem.status === 409;
  return (
    <div className="form-error" role="alert" data-testid="intake-problem">
      <strong>{conflict ? 'Rejected: conflicts with stored data' : problem.status === 422 ? 'Rejected: fix the highlighted fields' : 'The request did not complete'}</strong>
      <div className="small" style={{ marginTop: 4 }}>{problem.message} <span className="mono xsmall">({problem.code})</span></div>
      {issues.length ? (
        <ul className="plain-list small" style={{ marginTop: 8 }} aria-label="Validation errors">
          {issues.map((i, n) => (
            <li key={n}><a href={`#${fieldId(i.key)}`} onClick={(e) => { e.preventDefault(); focusField(i.key); }}>
              {labelOfKey(i.key)}</a>: {i.message} <span className="mono xsmall">{i.code}</span></li>
          ))}
        </ul>
      ) : null}
      {problem.correlationId ? <div className="xsmall muted" style={{ marginTop: 6 }}>Reference {problem.correlationId}</div> : null}
    </div>
  );
}

function focusField(key: string) {
  let k = key;
  while (k) {
    const el = document.getElementById(fieldId(k));
    if (el) { el.focus(); el.scrollIntoView?.({ block: 'center' }); return; }
    k = k.includes('.') ? k.slice(0, k.lastIndexOf('.')) : '';
  }
}

const KEY_LABELS: Record<string, string> = {
  source_system: 'Source system', source_event_id: 'Source event ID', reason: 'Reason', parties: 'Parties',
  'policy.market_code': 'Market',
};
function labelOfKey(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key]!;
  const parts = key.split('.');
  const named = parts.map((p, i) => (/^\d+$/.test(p) ? `${parts[i - 1] === 'parties' ? 'party' : 'contact'} ${Number(p) + 1}` : humanize(p.toUpperCase())));
  return named.join(' › ') || 'Transaction';
}

// ---- inputs ------------------------------------------------------------------------------------------------------
interface Ctx {
  form: IntakeForm; set: (path: string, value: unknown) => void; err: (key: string) => FieldIssue[];
  ref: IntakeReference; locked: boolean;
}

function get(form: IntakeForm, key: string): string {
  return String(key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], form) ?? '');
}

function Field({ ctx, k, label, hint, children, wide }: {
  ctx: Ctx; k: string; label: string; hint?: ReactNode; children: (p: { id: string; invalid: boolean; describedBy?: string }) => ReactNode; wide?: boolean;
}) {
  const id = fieldId(k);
  const errors = ctx.err(k);
  const describedBy = [hint ? `${id}-hint` : '', errors.length ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`intake-field${wide ? ' wide' : ''}${errors.length ? ' invalid' : ''}`}>
      <label className="form-label" htmlFor={id}>{label}</label>
      {children({ id, invalid: errors.length > 0, describedBy })}
      {hint ? <div id={`${id}-hint`} className="xsmall muted field-hint">{hint}</div> : null}
      {errors.length ? <div id={`${id}-err`} className="field-error">{errors.map((e) => e.message).join('; ')} <span className="mono">({errors.map((e) => e.code).join(', ')})</span></div> : null}
    </div>
  );
}

function Text({ ctx, k, label, hint, placeholder, type = 'text', wide, readOnly, inputMode }: {
  ctx: Ctx; k: string; label: string; hint?: ReactNode; placeholder?: string; type?: string; wide?: boolean; readOnly?: boolean;
  inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <Field ctx={ctx} k={k} label={label} hint={hint} wide={wide}>
      {(p) => <input id={p.id} className="field labelled" type={type} value={get(ctx.form, k)} placeholder={placeholder} readOnly={readOnly}
        inputMode={inputMode} aria-invalid={p.invalid || undefined} aria-describedby={p.describedBy} autoComplete="off" spellCheck={false}
        onChange={(e) => ctx.set(k, e.target.value)} />}
    </Field>
  );
}

function DateTime({ ctx, k, label, hint }: { ctx: Ctx; k: string; label: string; hint?: ReactNode }) {
  return (
    <Field ctx={ctx} k={k} label={`${label} (SGT)`} hint={hint}>
      {(p) => <input id={p.id} className="field labelled" type="datetime-local" step={1} value={isoToSgtInput(get(ctx.form, k))}
        aria-invalid={p.invalid || undefined} aria-describedby={p.describedBy}
        onChange={(e) => ctx.set(k, sgtInputToIso(e.target.value))} />}
    </Field>
  );
}

function Select({ ctx, k, label, options, hint, blank, onPick }: {
  ctx: Ctx; k: string; label: string; options: [string, string][]; hint?: ReactNode; blank?: string; onPick?: (v: string) => void;
}) {
  return (
    <Field ctx={ctx} k={k} label={label} hint={hint}>
      {(p) => <select id={p.id} className="field labelled" value={get(ctx.form, k)} aria-invalid={p.invalid || undefined} aria-describedby={p.describedBy}
        onChange={(e) => (onPick ? onPick(e.target.value) : ctx.set(k, e.target.value))}>
        {blank !== undefined ? <option value="">{blank}</option> : null}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>}
    </Field>
  );
}

const enumOpts = (ref: IntakeReference, name: string): [string, string][] => (ref.enums[name] ?? []).map((v) => [v, humanize(v)]);

function Section({ n, title, subtitle, children, aside, sectionKey, ctx }: {
  n: number; title: string; subtitle: string; children: ReactNode; aside?: ReactNode; sectionKey?: string; ctx: Ctx;
}) {
  const errors = sectionKey ? ctx.err(sectionKey) : [];
  return (
    <section className="card card-pad intake-section" aria-labelledby={`sec-${n}`} id={sectionKey ? fieldId(sectionKey) : undefined} tabIndex={sectionKey ? -1 : undefined}>
      <div className="card-heading">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="q-num" aria-hidden="true">{n}</span>
          <div><h2 id={`sec-${n}`}>{title}</h2><p>{subtitle}</p></div>
        </div>
        {aside}
      </div>
      {errors.length ? <div className="field-error" style={{ marginBottom: 12 }}>{errors.map((e) => `${e.message} (${e.code})`).join('; ')}</div> : null}
      {children}
    </section>
  );
}

// ---- sections ----------------------------------------------------------------------------------------------------
function PolicySection({ ctx, initialPolicy, onLoaded, onNew }: {
  ctx: Ctx; initialPolicy: string | null; onLoaded: (p: Parameters<typeof prefillFromPolicy>[1]) => void; onNew: () => void;
}) {
  const { form, ref } = ctx;
  const [lookup, setLookup] = useState(initialPolicy ?? '');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState<string | null>(null);
  const load = useMutation({
    mutationFn: async (policyRef: string) => {
      const list = unwrap(await api.GET('/api/v1/policies', { params: { query: { q: policyRef } } }));
      const row = list.items.find((r) => r.policy_ref === policyRef);
      if (!row) throw new Error('No Singapore policy with this reference is in your scope.');
      return unwrap(await api.GET('/api/v1/policies/{policy_id}', { params: { path: { policy_id: row.policy_id } } }));
    },
    onMutate: () => setLoadError(null),
    onSuccess: (p) => { setPolicyId(p.id); onLoaded(p); },
    onError: (e) => setLoadError(e instanceof ApiFailure ? `The policy could not be loaded (${e.code ?? e.status}).` : (e as Error).message),
  });
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (initialPolicy && !autoLoaded.current) { autoLoaded.current = true; load.mutate(initialPolicy.trim()); }
  }, [initialPolicy, load]);
  const parties = useQuery({
    queryKey: ['policy', policyId, 'parties'], enabled: form.mode === 'EXISTING' && !!policyId,
    queryFn: async () => unwrap(await api.GET('/api/v1/policies/{policy_id}/parties', { params: { path: { policy_id: policyId! } } })),
  });
  const existing = form.mode === 'EXISTING';
  const products: [string, string][] = ref.products.map((p) => [productKey(p), `${p.product_code} · ${humanize(p.product_family)} · ${humanize(p.product_subtype)}`]);

  return (
    <Section ctx={ctx} n={1} title="Policy" subtitle={`A new ${ref.market_code} policy, or a further sale on an existing one. Amounts in ${ref.currency}.`}>
      <div className="pill-tabs" role="radiogroup" aria-label="Policy" style={{ marginBottom: 16 }}>
        <button type="button" role="radio" aria-checked={!existing} className={!existing ? 'active' : ''}
          onClick={() => { if (existing) { setPolicyId(null); onNew(); } }}>New policy</button>
        <button type="button" role="radio" aria-checked={existing} className={existing ? 'active' : ''}
          onClick={() => document.getElementById('policy-lookup')?.focus()}>Existing policy</button>
      </div>
      <div className="row wrap" style={{ marginBottom: 14, alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label className="form-label" htmlFor="policy-lookup">Existing policy reference</label>
          <input id="policy-lookup" className="field labelled mono" value={lookup} placeholder={`POL-${ref.market_code}-000000`}
            onChange={(e) => setLookup(e.target.value)} aria-describedby="policy-lookup-hint"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (lookup.trim()) load.mutate(lookup.trim()); } }} />
        </div>
        <Button onClick={() => lookup.trim() && load.mutate(lookup.trim())} disabled={load.isPending || !lookup.trim()}>
          {load.isPending ? 'Loading…' : 'Load policy'}
        </Button>
      </div>
      <div id="policy-lookup-hint" className="xsmall muted" style={{ marginTop: -8, marginBottom: 14 }}>
        Loads the stored policy so a further sale can be attached. Leave blank for a new policy.
      </div>
      {loadError ? <div className="form-error" role="alert" style={{ marginTop: 0, marginBottom: 14 }}>{loadError}</div> : null}
      {existing ? (
        <div className="explain" style={{ marginBottom: 14 }} data-testid="existing-policy-note">
          Prefilled from the stored policy <strong className="mono">{form.policy.policy_ref}</strong>. The sale is attached only when these values match;
          any change is rejected by the server. Field corrections are not available yet.
        </div>
      ) : null}
      <div className="input-grid">
        <Text ctx={ctx} k="policy.policy_ref" label="Policy reference" placeholder={`POL-${ref.market_code}-000000`} readOnly={existing}
          hint={existing ? 'Loaded policy' : `Synthetic ${ref.market_code} reference`} />
        <Select ctx={ctx} k="policy.product" label="Product" blank="Select a product" options={products} />
        <Select ctx={ctx} k="policy.status" label="Policy status" options={enumOpts(ref, 'policy_status')} />
        <Select ctx={ctx} k="policy.premium_frequency" label="Premium frequency" options={enumOpts(ref, 'premium_frequency')} />
        <Text ctx={ctx} k="policy.premium_amount" label={`Policy premium (${ref.currency})`} inputMode="decimal" placeholder="0.00" />
        <Text ctx={ctx} k="policy.premium_term_years" label="Premium term (years)" inputMode="numeric" hint="Leave blank for single premium" />
        <Text ctx={ctx} k="policy.sum_assured" label={`Sum assured (${ref.currency})`} inputMode="decimal" hint="Optional" />
        <DateTime ctx={ctx} k="policy.effective_from" label="Effective from" />
      </div>
      {existing ? (
        <div style={{ marginTop: 16 }}>
          <div className="section-label">Recorded parties</div>
          <Region query={parties} label="policy parties">
            {() => (
              <ul className="plain-list" data-testid="existing-parties">
                {parties.data!.items.map((p) => (
                  <li key={p.party_ref} className="small">
                    <strong>{p.masked_name}</strong> <span className="mono xsmall">{p.party_ref}</span>
                    <span className="xsmall muted"> · {p.roles.filter((r) => r.current).map((r) => humanize(r.role)).join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Region>
          <p className="xsmall muted" style={{ marginBottom: 0 }}>The sale uses these recorded parties and roles. Adding or changing parties needs field corrections, which are not available yet.</p>
        </div>
      ) : null}
    </Section>
  );
}

function SaleSection({ ctx }: { ctx: Ctx }) {
  const { ref } = ctx;
  const fscs: [string, string][] = ref.fscs.map((f) => [f.fsc_ref, `${f.fsc_ref} · ${f.display_name} · ${humanize(f.channel)}`]);
  return (
    <Section ctx={ctx} n={2} title="Sale" subtitle="The sale event and the representative (FSC) who made it.">
      <div className="input-grid">
        <Text ctx={ctx} k="sale.sale_ref" label="Sale reference" placeholder={`SALE-${ref.market_code}-000000`} />
        <Select ctx={ctx} k="sale.sale_event_type" label="Sale type" options={enumOpts(ref, 'sale_event_type')} />
        <DateTime ctx={ctx} k="sale.sold_at" label="Sold at" />
        <Select ctx={ctx} k="sale.fsc_ref" label="FSC representative" blank="Select an FSC" options={fscs}
          onPick={(v) => { ctx.set('sale.fsc_ref', v); const f = ref.fscs.find((x) => x.fsc_ref === v); if (f) ctx.set('sale.selling_channel', f.channel); }}
          hint="Active representatives; the selling channel follows the FSC's recorded channel" />
        <Select ctx={ctx} k="sale.selling_channel" label="Selling channel" blank="Select a channel" options={enumOpts(ref, 'selling_channel')} />
        <Text ctx={ctx} k="sale.selling_location" label="Selling location" placeholder="SYN-BRANCH-01" />
        <Text ctx={ctx} k="sale.proposal_ref" label="Proposal reference" />
        <Text ctx={ctx} k="sale.campaign_code" label="Campaign code" hint="Optional" />
        <Text ctx={ctx} k="sale.premium_amount" label={`Sale premium (${ref.currency})`} inputMode="decimal" placeholder="0.00" />
        <Text ctx={ctx} k="sale.premium_amount_band" label="Premium band (source label)" hint="Optional, as the source labels it" />
      </div>
    </Section>
  );
}

function PartiesSection({ ctx }: { ctx: Ctx }) {
  const { form, ref, set } = ctx;
  if (form.mode === 'EXISTING') return null;
  const formats = ref.contact_formats;
  const hintFor = (channel: string) => {
    const f = formats.filter((x) => x.channel === channel);
    return f.length ? `${f.map((x) => x.label).join('; ')} — e.g. ${f.map((x) => x.example).join(', ')}` : undefined;
  };
  return (
    <Section ctx={ctx} n={3} title="Parties and contacts" sectionKey="parties"
      subtitle="New synthetic parties with their roles. Contact values must be reserved synthetic identifiers; parties are never matched by name or contact."
      aside={<Button tiny icon="plus" onClick={() => set('parties', [...form.parties, emptyParty()])} disabled={ctx.locked || form.parties.length >= 10}>Add party</Button>}>
      <div className="stack">
        {form.parties.map((p, i) => {
          const base = `parties.${i}`;
          return (
            <fieldset key={i} className="softbox intake-party" id={fieldId(base)} tabIndex={-1}>
              <legend className="strong small">Party {i + 1}</legend>
              {ctx.err(base).length ? <div className="field-error">{ctx.err(base).map((e) => `${e.message} (${e.code})`).join('; ')}</div> : null}
              <div className="input-grid">
                <Select ctx={ctx} k={`${base}.kind`} label="Party type" options={enumOpts(ref, 'party_kind')} />
                <Text ctx={ctx} k={`${base}.name`} label="Synthetic name" hint="Shown masked after submission" />
                <Text ctx={ctx} k={`${base}.source_party_id`} label="Source party ID" hint="Optional source identifier" />
                <Text ctx={ctx} k={`${base}.date_of_birth_year`} label="Year of birth" inputMode="numeric" hint="Optional" />
              </div>
              <RoleBoxes ctx={ctx} base={base} roles={p.roles} />
              {p.roles.includes('AUTHORIZED_CONTACT') ? (
                <div className="input-grid" style={{ marginTop: 12 }}>
                  <Text ctx={ctx} k={`${base}.auth_reference`} label="Authorisation reference" hint="Evidence of the authorisation, if recorded" />
                  <DateTime ctx={ctx} k={`${base}.auth_valid_from`} label="Authorised from" />
                  <DateTime ctx={ctx} k={`${base}.auth_valid_to`} label="Authorised until" hint="Optional" />
                </div>
              ) : null}
              <div className="section-label" style={{ marginTop: 14 }}>Contacts</div>
              {p.contacts.map((c, j) => {
                const cb = `${base}.contacts.${j}`;
                return (
                  <div key={j} className="input-grid intake-contact" id={fieldId(cb)} tabIndex={-1}>
                    <Select ctx={ctx} k={`${cb}.channel`} label={`Contact ${j + 1} channel`} options={enumOpts(ref, 'contact_channel')} />
                    <Text ctx={ctx} k={`${cb}.value`} label={`Contact ${j + 1} value`} hint={hintFor(c.channel)} />
                    <Select ctx={ctx} k={`${cb}.consent_status`} label={`Contact ${j + 1} consent`} options={enumOpts(ref, 'consent_status')} />
                    <Select ctx={ctx} k={`${cb}.preference_rank`} label={`Contact ${j + 1} preference`} options={[1, 2, 3, 4, 5].map((n) => [String(n), `Rank ${n}`])} />
                  </div>
                );
              })}
              <div className="row wrap" style={{ marginTop: 10 }}>
                <Button tiny icon="plus" onClick={() => set(`${base}.contacts`, [...p.contacts, emptyContact(p.contacts.length ? 'EMAIL' : 'PHONE')])}
                  disabled={ctx.locked || p.contacts.length >= 6}>Add contact</Button>
                {p.contacts.length ? <Button tiny onClick={() => set(`${base}.contacts`, p.contacts.slice(0, -1))} disabled={ctx.locked}>Remove last contact</Button> : null}
                {form.parties.length > 1 ? <Button tiny variant="danger" onClick={() => set('parties', form.parties.filter((_, n) => n !== i))} disabled={ctx.locked}>Remove party {i + 1}</Button> : null}
              </div>
            </fieldset>
          );
        })}
      </div>
    </Section>
  );
}

function RoleBoxes({ ctx, base, roles }: { ctx: Ctx; base: string; roles: string[] }) {
  const k = `${base}.roles`;
  const errors = ctx.err(k);
  return (
    <fieldset className={`intake-roles${errors.length ? ' invalid' : ''}`} id={fieldId(k)} tabIndex={-1}
      aria-describedby={errors.length ? `${fieldId(k)}-err` : undefined}>
      <legend className="form-label">Roles</legend>
      <div className="row wrap">
        {(ctx.ref.enums.party_role ?? []).map((r) => (
          <label key={r} className="checkline">
            <input type="checkbox" checked={roles.includes(r)}
              onChange={(e) => ctx.set(k, e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />
            {humanize(r)}
          </label>
        ))}
      </div>
      {errors.length ? <div id={`${fieldId(k)}-err`} className="field-error">{errors.map((e) => `${e.message} (${e.code})`).join('; ')}</div> : null}
    </fieldset>
  );
}

function RiskSection({ ctx }: { ctx: Ctx }) {
  const { form, ref, set } = ctx;
  return (
    <Section ctx={ctx} n={form.mode === 'EXISTING' ? 3 : 4} title="Source risk (optional)" sectionKey="risk"
      subtitle="The SBQ callback-selection risk exactly as the source assigned it. Call360 does not calculate a band or score.">
      <label className="checkline" style={{ marginBottom: form.include_risk ? 14 : 0 }}>
        <input type="checkbox" checked={form.include_risk} onChange={(e) => set('include_risk', e.target.checked)} />
        Include a source-assigned risk
      </label>
      {form.include_risk ? (
        <div className="input-grid">
          <Select ctx={ctx} k="risk.band_code" label="Risk band" blank="Select a band" options={ref.risk_bands.map((b) => [b.code, b.label])}
            hint="Active SBQ risk band list" />
          <Text ctx={ctx} k="risk.source_original_value" label="Source's original value" placeholder="SBQ-H" />
          <Select ctx={ctx} k="risk.status" label="Assessment status" options={enumOpts(ref, 'risk_status')} />
          <DateTime ctx={ctx} k="risk.assessed_at" label="Assessed at" />
          <Text ctx={ctx} k="risk.reason_codes" label="Reason codes" wide hint="Comma-separated codes, as supplied by the source" />
        </div>
      ) : null}
    </Section>
  );
}

function CallbackSection({ ctx }: { ctx: Ctx }) {
  const { ref, form } = ctx;
  const priorities: [string, string][] = [];
  for (let n = ref.priority_min; n <= ref.priority_max; n += 1) priorities.push([String(n), `Priority ${n}`]);
  return (
    <Section ctx={ctx} n={form.mode === 'EXISTING' ? 4 : 5} title="Callback request" sectionKey="callback"
      subtitle="The verification obligation as the source requested it. Due date and priority are supplied by the source, not set by Call360.">
      <div className="input-grid">
        <Text ctx={ctx} k="callback.source_request_ref" label="Source request reference" />
        <DateTime ctx={ctx} k="callback.due_at" label="Due" hint="May be in the past; not before the sale" />
        <Select ctx={ctx} k="callback.priority" label="Priority" blank="Select a priority" options={priorities}
          hint={`${ref.priority_min} is the highest`} />
      </div>
    </Section>
  );
}

function SourceSection({ ctx }: { ctx: Ctx }) {
  const { ref, form } = ctx;
  return (
    <Section ctx={ctx} n={form.mode === 'EXISTING' ? 5 : 6} title="Source and reason"
      subtitle="Where this transaction comes from and why it is entered manually. Recorded with the run and audit trail.">
      <div className="input-grid">
        <Text ctx={ctx} k="source_system" label="Source system" hint={`Must start with ${ref.source_system_prefix}; ${ref.reserved_source_systems.join(', ')} is reserved`} />
        <Text ctx={ctx} k="source_event_id" label="Source event ID" hint="Unique per source system; a repeated event is rejected" />
        <Field ctx={ctx} k="reason" label="Reason for manual intake" wide>
          {(p) => <textarea id={p.id} className="field labelled textarea" rows={3} maxLength={500} value={form.reason}
            aria-invalid={p.invalid || undefined} aria-describedby={p.describedBy} onChange={(e) => ctx.set('reason', e.target.value)} />}
        </Field>
      </div>
      <p className="xsmall muted" style={{ marginBottom: 0 }}>
        Recorded as a synthetic transaction ({ref.data_policy.replace(/_/g, ' ').toLowerCase()}); market {ref.market_code}, currency {ref.currency}.
      </p>
    </Section>
  );
}
