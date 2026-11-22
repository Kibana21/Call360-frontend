// Survey Studio (EVAL-2A) — Controls and evidence: the control register, governed control policies, and the mappings
// that connect a control's required evidence to published survey questions and statements. SIMULATION ONLY.
// Nothing is decided here: the server validates every proposal and says why one is invalid, applicability is the
// server's three-valued answer, and a trial against a synthetic journey is computed by the server and not recorded.
// A policy creates no control and no insurance obligation; it refers to controls of the existing register.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { Glyph, Tag } from '../ui';
import {
  checkApplicability, decideMapping, decidePolicy, getBuilderOptions, getRegister, listJourneys, listMappings, listPolicies, previewEvaluation,
  proposeMapping, proposePolicy, publishMapping, publishPolicy, withdrawPolicy,
  type Applicability, type BuilderItem, type BuilderOptions, type ControlMapping, type ControlPolicy, type ControlPolicyIn, type EvaluationPreview,
  type JourneyRef, type RegisterControl,
} from './evalApi';
import { COVERAGE, OUTCOME } from './EvaluationWorkbench';
import { short } from './reviewApi';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- policy and mapping documents are read as JSON
const say = (e: unknown) => (e instanceof ApiFailure ? (e.status === 403 ? `You cannot do this: ${e.message}` : e.message) : 'The server could not be reached.');
const STATUS: Record<string, { label: string; tone: 'plain' | 'ok' | 'warn' | 'draft' }> = {
  PROPOSED: { label: 'Proposed — awaiting a decision', tone: 'draft' }, APPROVED: { label: 'Approved — awaiting publication', tone: 'draft' }, PUBLISHED: { label: 'Published', tone: 'ok' },
  SUPERSEDED: { label: 'Superseded', tone: 'plain' }, REJECTED: { label: 'Rejected', tone: 'warn' }, WITHDRAWN: { label: 'Withdrawn', tone: 'warn' },
};
const METHOD: Record<string, string> = { EXACT_BOOLEAN: 'A yes or no that must be…', ACKNOWLEDGEMENT: 'The customer acknowledges', NUMERIC_COMPARE: 'A number compared with…', ENUM_MATCH: 'One of these choices', NARRATIVE_REVIEW: 'Free text, assessed by a person', SET_MATCH: 'A selection compared with these choices' };
const APPLIES: Record<string, { label: string; tone: 'plain' | 'ok' | 'warn' | 'draft' }> = { APPLICABLE: { label: 'Required', tone: 'ok' }, NOT_APPLICABLE: { label: 'Not applicable', tone: 'plain' }, UNKNOWN: { label: 'Unknown', tone: 'draft' } };
const typeWords = (t: string) => t.toLowerCase().replace(/_/g, ' ');
const conditionWords = (a: Any): string => (a ? `when “${a.condition.name ?? a.condition.code}” holds${Object.keys(a.params ?? {}).length ? ` (${Object.entries(a.params).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ')})` : ''}` : 'for every application in scope');

interface EvidenceDraft { key: string; description: string; evidence_type: string; required: boolean }
interface ObligationDraft { key: string; title: string; condition: string; params: Record<string, string>; evidence: EvidenceDraft[] }
interface ControlDraft { control_code: string; purpose: string; obligations: ObligationDraft[] }
interface PolicyDraft { code: string; name: string; scope_statement: string; completeness: string; empty_set_is_complete: boolean; owner: string; source: string; controls: ControlDraft[] }
const blankPolicy = (): PolicyDraft => ({ code: '', name: '', scope_statement: '', completeness: 'PARTIAL', empty_set_is_complete: false, owner: '', source: '', controls: [] });
const num = (v: string): unknown => (v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v);
const condOf = (o: ObligationDraft) => { if (!o.condition) return null; const [code, version] = o.condition.split('@'); return { condition: { code, version: Number(version) }, params: Object.fromEntries(Object.entries(o.params).map(([k, v]) => [k, num(v)])) }; };
const toBody = (d: PolicyDraft, market: string): ControlPolicyIn => ({
  market_code: market, code: d.code, name: d.name, scope_statement: d.scope_statement, scope: null, completeness: d.completeness, empty_set_is_complete: d.empty_set_is_complete, owner: d.owner, source: d.source,
  controls: d.controls.map((c) => ({ control_code: c.control_code, purpose: c.purpose, description: '', obligations: c.obligations.map((o) => ({ key: o.key, title: o.title, applicability: condOf(o), combination: 'ALL_REQUIRED', evidence: o.evidence })) })),
});
const fromPolicy = (p: ControlPolicy): PolicyDraft => ({
  code: p.code, name: p.name, scope_statement: p.scope_statement, completeness: p.completeness, empty_set_is_complete: p.empty_set_is_complete, owner: p.owner, source: p.source,
  controls: (p.controls as Any[]).map((c) => ({ control_code: c.control.code, purpose: c.purpose, obligations: (c.obligations as Any[]).map((o) => ({ key: o.key, title: o.title, condition: o.applicability ? `${o.applicability.condition.code}@${o.applicability.condition.version}` : '', params: Object.fromEntries(Object.entries(o.applicability?.params ?? {}).map(([k, v]) => [k, String(v)])), evidence: o.evidence })) })),
});

interface EntryDraft { obligation: string; requirement: string; item: string; method: string; expected: string; operator: string; value: string; unit: string; accepted: string[]; mode: string }
const entryBody = (e: EntryDraft, items: BuilderItem[]) => {
  const it = items.find((i) => `${i.code}@${i.version}` === e.item);
  const answer = e.method !== 'DELIVERY';
  const rule = !answer ? null : e.method === 'EXACT_BOOLEAN' ? { method: e.method, expected_boolean: e.expected === 'YES' }
    : e.method === 'NUMERIC_COMPARE' ? { method: e.method, evaluation: { operator: e.operator, value: e.value === '' ? null : Number(e.value), unit: e.unit } }
    : e.method === 'ENUM_MATCH' ? { method: e.method, evaluation: { accepted: e.accepted } }
    : e.method === 'SET_MATCH' ? { method: e.method, evaluation: { mode: e.mode, options: e.accepted } } : { method: e.method };
  return { item: it ? { code: it.code, version: it.version } : { code: '', version: 0 }, evidence_type: answer ? 'ANSWER' : 'DELIVERY', required: true, survey_code: null, rule, obligation: e.obligation, requirement: e.requirement };
};

export function ControlBuilderPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [register, setRegister] = useState<RegisterControl[]>([]);
  const [policies, setPolicies] = useState<ControlPolicy[] | null | undefined>(undefined);
  const [mappings, setMappings] = useState<ControlMapping[]>([]);
  const [options, setOptions] = useState<BuilderOptions | null>(null);
  const [journeys, setJourneys] = useState<JourneyRef[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const allowed = can('survey.evaluation.read');
  const view = params.get('view') ?? 'control';
  const controlCode = params.get('control') ?? '';
  const policyId = params.get('policy') ?? '';
  const go = (next: Record<string, string>) => { setError(null); setParams(next); };

  const load = useCallback(() => {
    if (!allowed) return;
    Promise.all([getRegister(), listMappings(), listPolicies(), getBuilderOptions()]).then(([r, m, p, o]) => { setRegister(r); setMappings(m); setPolicies(p); setOptions(o); if (p) listJourneys().then(setJourneys).catch(() => setJourneys([])); }).catch((e) => setFailed(say(e)));
  }, [allowed]);
  useEffect(load, [load]);
  const act = (work: () => Promise<unknown>, then?: () => void) => { setBusy(true); setError(null); work().then(() => { load(); then?.(); }).catch((e) => { setError(say(e)); load(); }).finally(() => setBusy(false)); };

  const published = useMemo(() => (policies ?? []).filter((p) => p.status === 'PUBLISHED'), [policies]);
  const policy = (policies ?? []).find((p) => p.id === policyId) ?? null;
  const control = register.find((c) => c.control_code === controlCode) ?? null;
  const shown = register.filter((c) => !search.trim() || `${c.control_code} ${c.name}`.toLowerCase().includes(search.trim().toLowerCase()));
  const market = options?.market_code ?? 'SG';

  const bar = (
    <div className="ss-bar">
      <nav className="ss-crumbs" aria-label="Survey Studio breadcrumb"><Link to="/survey-studio">Survey Studio</Link><Glyph name="right" size={13} /><span aria-current="page">Controls and evidence</span></nav>
      <div className="ss-bar-tools"><span className="ss-proto saved-mode"><Glyph name="info" size={14} /> Simulation · synthetic</span></div>
    </div>
  );
  if (!allowed) return <>{bar}<div className="ss-empty page" role="status" data-testid="ss-cb-not-permitted"><p><strong>You cannot open controls and evidence.</strong> Reading control policies and mappings needs its own permission, which you do not hold.</p></div></>;
  if (failed) return <>{bar}<div className="ss-empty page" role="alert" data-testid="ss-cb-failed"><p><strong>Controls and evidence could not be loaded.</strong> {failed}</p></div></>;
  if (policies === undefined) return <>{bar}<p className="ss-loading page" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading controls and evidence…</p></>;

  return (
    <>
      {bar}
      <div className="ss-co ss-ev ss-cb" data-testid="ss-cb" data-policies={policies === null ? 'unavailable' : policies.length}>
        <header>
          <h1 className="ss-title">Controls and evidence</h1>
          <p className="ss-note" data-testid="ss-cb-notice"><Glyph name="info" size={14} /><span>A <strong>control policy</strong> says which controls must be assessed, when each applies and what evidence it needs. A <strong>mapping</strong> says which published survey questions and statements supply that evidence. Both are proposed, approved and published by three different people. Everything here is synthetic and used for simulations only: it creates no compliance obligation and establishes nothing about a real application.</span></p>
        </header>
        {error ? <p className="ss-note warn" role="alert" data-testid="ss-cb-error"><Glyph name="alert" size={14} /><span>{error}</span></p> : null}
        {policies === null ? <p className="ss-note warn" data-testid="ss-cb-unavailable"><Glyph name="info" size={14} /><span>Control policies are not switched on for this server. The control register and the existing mappings are shown; policies, applicability and coverage are not available here.</span></p> : null}

        <div className="ss-co-grid">
          <aside aria-label="Controls and policies">
            <h2>Controls of the register</h2>
            <label className="ss-field"><span>Find a control</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code or name" data-testid="ss-cb-search" /></label>
            <ul className="ss-cb-list" data-testid="ss-cb-controls">
              {shown.map((c) => (
                <li key={c.control_code} className={view === 'control' && c.control_code === controlCode ? 'on' : ''}>
                  <button type="button" onClick={() => go({ view: 'control', control: c.control_code })} data-testid={`ss-cb-control-${c.control_code}`}>
                    <span>{c.name.replace(/ \(synthetic control\)$/, '')}</span>
                    <span className="ss-muted">{c.control_code} · {c.published.length ? 'evidence mapped' : 'no evidence mapped'}{published.some((p) => (p.controls as Any[]).some((x) => x.control.code === c.control_code)) ? ' · in a published policy' : ''}</span>
                  </button>
                </li>
              ))}
              {shown.length === 0 ? <li className="ss-muted">No control matches.</li> : null}
            </ul>
            {policies !== null ? (
              <>
                <h2>Control policies</h2>
                <ul className="ss-cb-list" data-testid="ss-cb-policies">
                  {policies.map((p) => (
                    <li key={p.id} className={view === 'policy' && p.id === policyId ? 'on' : ''}>
                      <button type="button" onClick={() => go({ view: 'policy', policy: p.id })} data-testid={`ss-cb-policy-${p.code}-${p.revision}`} data-status={p.status}>
                        <span>{p.name}</span><span className="ss-muted">Revision {p.revision} · {STATUS[p.status]?.label ?? p.status}</span>
                      </button>
                    </li>
                  ))}
                  {policies.length === 0 ? <li className="ss-muted" data-testid="ss-cb-no-policies">No control policy has been proposed yet.</li> : null}
                </ul>
                {can('survey.edit') ? <button type="button" className="ss-btn" onClick={() => go({ view: 'compose' })} data-testid="ss-cb-new-policy">Draft a control policy</button> : null}
              </>
            ) : null}
          </aside>

          <main aria-label="Details">
            {view === 'compose' && options ? <PolicyComposer key={params.get('from') ?? 'new'} options={options} register={register} market={market} from={(policies ?? []).find((p) => p.id === params.get('from')) ?? null} busy={busy} onPropose={(body) => act(async () => { const p = await proposePolicy(body); go({ view: 'policy', policy: p.id }); })} />
              : view === 'policy' && policy ? <PolicyView policy={policy} busy={busy} can={can} onRevise={() => go({ view: 'compose', from: policy.id })} onDecide={(v, c) => act(() => decidePolicy(policy.id, v, c))} onPublish={() => act(() => publishPolicy(policy.id))} onWithdraw={(r) => act(() => withdrawPolicy(policy.id, r))} onMap={(code) => go({ view: 'map', control: code, policy: policy.id })} />
              : view === 'map' && control && policy && options ? <MappingBuilder key={`${control.control_code}:${policy.id}`} control={control} policy={policy} options={options} journeys={journeys} mappings={mappings.filter((m) => m.control_code === control.control_code)} market={market} busy={busy} can={can} onPropose={(body) => act(() => proposeMapping(body))} onDecide={(id, v) => act(() => decideMapping(id, v))} onPublish={(id) => act(() => publishMapping(id))} />
              : control ? <ControlView control={control} policies={policies ?? []} mappings={mappings.filter((m) => m.control_code === control.control_code)} onMap={(p) => go({ view: 'map', control: control.control_code, policy: p })} onPolicy={(p) => go({ view: 'policy', policy: p })} />
              : <div className="ss-empty" data-testid="ss-cb-start"><p><strong>Choose a control or a policy on the left.</strong> A control shows what it is, the policies that require it and the evidence mapped to it. A policy shows what it requires and lets you revise, review or publish it.</p></div>}
          </main>
        </div>
      </div>
    </>
  );
}

/** What can happen to a proposal now, and whether the person looking at it is the one who can do it. */
function nextStep(status: string, isProposer: boolean, isApprover: boolean, can: (p: string) => boolean, what: string): { action: string; title: string; text: string; mine: boolean } {
  if (status === 'PROPOSED') {
    if (isProposer) return { action: 'WAIT_FOR_APPROVER', title: 'Waiting for approval.', text: `You proposed this ${what}, so someone else must decide it.`, mine: false };
    return can('survey.approve') ? { action: 'APPROVE', title: 'You can approve or reject this.', text: `Check what it requires, then decide. A third person publishes it.`, mine: true } : { action: 'WAIT_FOR_APPROVER', title: 'Waiting for approval.', text: 'Deciding it needs the approval permission, which you do not hold.', mine: false };
  }
  if (status === 'APPROVED') {
    if (isProposer || isApprover) return { action: 'WAIT_FOR_PUBLISHER', title: 'Approved — waiting for publication.', text: `You proposed or approved this ${what}, so a third person must publish it.`, mine: false };
    return can('survey.publish') ? { action: 'PUBLISH', title: 'You can publish this.', text: 'Publishing makes it the one used for simulations and supersedes the revision before it.', mine: true } : { action: 'WAIT_FOR_PUBLISHER', title: 'Approved — waiting for publication.', text: 'Publishing it needs the publication permission, which you do not hold.', mine: false };
  }
  if (status === 'PUBLISHED') return { action: 'NONE', title: 'In use for simulations.', text: `Nothing is waiting. To change it, draft a new revision; this one is never edited.`, mine: false };
  return { action: 'NONE', title: 'Closed.', text: `This ${what} is ${status.toLowerCase()}. It is kept as a record and is not used for new evaluations.`, mine: false };
}

function ControlView({ control, policies, mappings, onMap, onPolicy }: { control: RegisterControl; policies: ControlPolicy[]; mappings: ControlMapping[]; onMap: (policyId: string) => void; onPolicy: (policyId: string) => void }) {
  const inPolicies = policies.filter((p) => (p.controls as Any[]).some((c) => c.control.code === control.control_code));
  return (
    <>
      <section className="ss-srv-block" aria-labelledby="ss-cb-control-h" data-testid="ss-cb-control" data-control={control.control_code}>
        <h2 id="ss-cb-control-h">{control.name}</h2>
        <p data-testid="ss-cb-control-standing">{control.content_approval_status === 'SYNTHETIC_UNAPPROVED' ? <Tag tone="draft">Synthetic — not approved content</Tag> : <Tag tone="ok">Approved by S&amp;C</Tag>} Owner: {control.owner_role}</p>
        <p className="ss-muted">The register holds a name and a code. It has no revisions of its own: a policy and a mapping each pin the control as it was, and say so if it changes later. What the control is for, when it applies and what evidence it needs are stated by a control policy.</p>
        <details className="ss-cb-tech"><summary>Technical details</summary><dl className="ss-srv-ids"><div><dt>Control code</dt><dd className="ss-code">{control.control_code}</dd></div><div><dt>Fingerprint as registered</dt><dd className="ss-code">{control.control_sha256}</dd></div></dl></details>
      </section>
      <section className="ss-srv-block" aria-labelledby="ss-cb-in-h" data-testid="ss-cb-control-policies">
        <h2 id="ss-cb-in-h">Policies that require this control <span className="ss-count">{inPolicies.length}</span></h2>
        {inPolicies.length === 0 ? <p className="ss-muted">No control policy names this control. Nothing governed says when it must be assessed.</p> : null}
        {inPolicies.map((p) => {
          const c = (p.controls as Any[]).find((x) => x.control.code === control.control_code);
          return (
            <article key={p.id} className="ss-cb-card">
              <header><button type="button" className="ss-linklike" onClick={() => onPolicy(p.id)}>{p.name} · revision {p.revision}</button> <Tag tone={STATUS[p.status]?.tone}>{STATUS[p.status]?.label ?? p.status}</Tag></header>
              <p>{c.purpose}</p>
              <ul className="ss-ev-reasons">{(c.obligations as Any[]).map((o) => <li key={o.key}><strong>{o.title}</strong> — required {conditionWords(o.applicability)}. Evidence: {(o.evidence as Any[]).map((e) => `${e.description} (${e.evidence_type === 'ANSWER' ? 'an answer' : 'a delivery'}${e.required ? '' : ', optional'})`).join('; ')}.</li>)}</ul>
              {p.status === 'PUBLISHED' || p.status === 'APPROVED' || p.status === 'PROPOSED' ? <button type="button" className="ss-btn small" onClick={() => onMap(p.id)} data-testid={`ss-cb-map-${p.code}-${p.revision}`}>Map evidence for this control</button> : null}
            </article>
          );
        })}
      </section>
      <section className="ss-srv-block" aria-labelledby="ss-cb-maps-h" data-testid="ss-cb-control-mappings">
        <h2 id="ss-cb-maps-h">Evidence mappings <span className="ss-count">{mappings.length}</span></h2>
        {mappings.length === 0 ? <p className="ss-muted">No survey question or statement has been mapped to this control.</p> : null}
        {mappings.map((m) => <MappingCard key={m.id} m={m} />)}
      </section>
    </>
  );
}

function MappingCard({ m, children }: { m: ControlMapping; children?: React.ReactNode }) {
  return (
    <article className="ss-cb-card" data-testid="ss-cb-mapping" data-status={m.status} data-revision={m.revision}>
      <header><strong>Mapping revision {m.revision}</strong> <Tag tone={STATUS[m.status]?.tone}>{STATUS[m.status]?.label ?? m.status}</Tag></header>
      <ul className="ss-ev-reasons">{(m.entries as Any[]).map((e, i) => <li key={i}>{e.evidence_type === 'ANSWER' ? <>A published question’s answer — <strong>{String(e.rule_text).toLowerCase()}</strong></> : <>A published statement, delivered exactly as published</>}{e.requirement ? null : <> <span className="ss-muted">(made before control policies: it names no policy requirement)</span></>}</li>)}</ul>
      <details className="ss-cb-tech"><summary>Technical details</summary><ul className="ss-ev-reasons">{(m.entries as Any[]).map((e, i) => <li key={i}><span className="ss-code">{e.item.code} v{e.item.version}</span>{e.requirement ? <> supplies <span className="ss-code">{e.obligation ? `${e.obligation}/` : ''}{e.requirement}</span></> : null}</li>)}<li>Mapping fingerprint <span className="ss-code">{m.mapping_sha256}</span></li></ul></details>
      {children}
    </article>
  );
}

function PolicyView({ policy, busy, can, onRevise, onDecide, onPublish, onWithdraw, onMap }: { policy: ControlPolicy; busy: boolean; can: (p: string) => boolean; onRevise: () => void; onDecide: (v: 'APPROVE' | 'REJECT', comment: string) => void; onPublish: () => void; onWithdraw: (reason: string) => void; onMap: (control: string) => void }) {
  const [comment, setComment] = useState('');
  const st = STATUS[policy.status] ?? { label: policy.status, tone: 'plain' as const };
  const next = nextStep(policy.status, policy.is_proposer, policy.is_approver, can, 'policy revision');
  return (
    <section className="ss-srv-block" aria-labelledby="ss-cb-policy-h" data-testid="ss-cb-policy" data-policy={policy.id} data-status={policy.status} data-revision={policy.revision}>
      <h2 id="ss-cb-policy-h">{policy.name} <span className="ss-muted">revision {policy.revision}</span> <Tag tone={st.tone}>{st.label}</Tag></h2>
      <p className="ss-note" data-testid="ss-cb-policy-standing"><Glyph name="info" size={14} /><span><strong>Synthetic, for simulations only.</strong> {policy.status === 'PUBLISHED' ? 'Published here means three people governed it inside Call360. It is not an approved compliance policy, and being complete under it says nothing about regulatory coverage.' : 'It is not an approved compliance policy.'}</span></p>
      <p className={`ss-cb-next ${next.mine ? 'mine' : ''}`} data-testid="ss-cb-next" data-action={next.action}><strong>{next.title}</strong> {next.text}</p>
      <dl className="ss-srv-ids">
        <div><dt>Covers</dt><dd>{policy.scope_statement}</dd></div>
        <div><dt>Its list of controls is</dt><dd data-testid="ss-cb-policy-completeness" data-completeness={policy.completeness}>{policy.completeness === 'DECLARED_COMPLETE' ? 'declared complete — coverage can be assessed against it' : 'partial — complete coverage can never be asserted under it'}</dd></div>
        <div><dt>Owner</dt><dd>{policy.owner}</dd></div>
        <div><dt>Source</dt><dd>{policy.source}</dd></div>
      </dl>
      <h3>What it requires</h3>
      {(policy.controls as Any[]).map((c) => (
        <article key={c.control.code} className="ss-cb-card" data-testid={`ss-cb-policy-control-${c.control.code}`}>
          <header><strong>{String(c.control.name).replace(/ \(synthetic control\)$/, '')}</strong></header>
          <p>{c.purpose}</p>
          <ul className="ss-ev-reasons">{(c.obligations as Any[]).map((o) => <li key={o.key}><strong>{o.title}</strong> — required {conditionWords(o.applicability)}. Evidence needed: {(o.evidence as Any[]).map((e) => `${e.description} (${e.evidence_type === 'ANSWER' ? 'an answer' : 'a delivery'}${e.required ? '' : ', optional'})`).join('; ')}. Every required piece must match.</li>)}</ul>
          <details className="ss-cb-tech"><summary>Technical details</summary><ul className="ss-ev-reasons"><li>Control <span className="ss-code">{c.control.code}</span> · fingerprint <span className="ss-code">{c.control.sha256}</span></li>{(c.obligations as Any[]).map((o) => <li key={o.key}>Obligation <span className="ss-code">{o.key}</span> · combination <span className="ss-code">{o.combination}</span> · evidence {(o.evidence as Any[]).map((e) => e.key).join(', ')}{o.applicability ? <> · condition <span className="ss-code">{o.applicability.condition.code} v{o.applicability.condition.version}</span></> : null}</li>)}</ul></details>
          <button type="button" className="ss-btn small" onClick={() => onMap(c.control.code)} data-testid={`ss-cb-policy-map-${c.control.code}`}>Map evidence</button>
        </article>
      ))}
      <details className="ss-cb-tech"><summary>Technical details of this revision</summary><dl className="ss-srv-ids"><div><dt>Policy code</dt><dd className="ss-code">{policy.code}</dd></div><div><dt>Fingerprint</dt><dd className="ss-code">{policy.policy_sha256}</dd></div></dl></details>
      <h3>Review</h3>
      <ol className="ss-ev-history" data-testid="ss-cb-policy-history">{policy.history.map((h) => <li key={h.seq}>{h.event.toLowerCase()} by {h.display_name ?? 'a colleague'} <span className="ss-muted">{new Date(h.occurred_at).toLocaleString()}{h.comment ? ` — ${h.comment}` : ''}</span></li>)}</ol>
      <p className="ss-muted">Three different people propose, approve and publish. A published revision is never edited: a change is a new revision, and evaluations made under this one keep it.</p>
      {policy.status === 'PROPOSED' ? (
        can('survey.approve') && !policy.is_proposer ? (
          <div className="ss-cb-actions">
            <label className="ss-field"><span>Comment <em>(required to reject)</em></span><input value={comment} onChange={(e) => setComment(e.target.value)} data-testid="ss-cb-policy-comment" /></label>
            <button type="button" className="ss-btn primary" disabled={busy} onClick={() => onDecide('APPROVE', comment)} data-testid="ss-cb-policy-approve">Approve this revision</button>
            <button type="button" className="ss-btn" disabled={busy || comment.trim().length < 10} onClick={() => onDecide('REJECT', comment)} data-testid="ss-cb-policy-reject">Reject</button>
          </div>
        ) : null
      ) : null}
      {policy.status === 'APPROVED' ? (
        can('survey.publish') && !policy.is_proposer && !policy.is_approver ? <div className="ss-cb-actions"><button type="button" className="ss-btn primary" disabled={busy} onClick={onPublish} data-testid="ss-cb-policy-publish">Publish this revision</button></div>
          : null
      ) : null}
      <div className="ss-cb-actions">
        {can('survey.edit') ? <button type="button" className="ss-btn" onClick={onRevise} data-testid="ss-cb-policy-revise">Draft a new revision from this one</button> : null}
        {policy.status === 'PUBLISHED' && can('survey.publish') ? <button type="button" className="ss-btn" disabled={busy || comment.trim().length < 10} onClick={() => onWithdraw(comment)} title="Give a reason of at least 10 characters in the comment box">Withdraw</button> : null}
      </div>
    </section>
  );
}

function PolicyComposer({ options, register, market, from, busy, onPropose }: { options: BuilderOptions; register: RegisterControl[]; market: string; from: ControlPolicy | null; busy: boolean; onPropose: (body: ControlPolicyIn) => void }) {
  const [d, setD] = useState<PolicyDraft>(() => (from ? fromPolicy(from) : blankPolicy()));
  const [add, setAdd] = useState('');
  const [facts, setFacts] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<Applicability | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const usable = options.conditions.filter((c) => c.usable);
  const set = (patch: Partial<PolicyDraft>) => { setD((x) => ({ ...x, ...patch })); setCheck(null); };
  const setControl = (i: number, patch: Partial<ControlDraft>) => set({ controls: d.controls.map((c, n) => (n === i ? { ...c, ...patch } : c)) });
  const setOb = (i: number, j: number, patch: Partial<ObligationDraft>) => setControl(i, { obligations: d.controls[i]!.obligations.map((o, n) => (n === j ? { ...o, ...patch } : o)) });
  const setEv = (i: number, j: number, k: number, patch: Partial<EvidenceDraft>) => setOb(i, j, { evidence: d.controls[i]!.obligations[j]!.evidence.map((e, n) => (n === k ? { ...e, ...patch } : e)) });
  const reads = [...new Set(d.controls.flatMap((c) => c.obligations).flatMap((o) => usable.find((c) => `${c.code}@${c.version}` === o.condition)?.fields ?? []))].sort();
  const tryOut = () => {
    setChecking(true); setProblem(null);
    checkApplicability(toBody(d, market), Object.fromEntries(Object.entries(facts).filter(([k, v]) => reads.includes(k) && v.trim() !== '').map(([k, v]) => [k, num(v)])))
      .then(setCheck).catch((e) => { setCheck(null); setProblem(say(e)); }).finally(() => setChecking(false));
  };
  return (
    <section className="ss-srv-block ss-cb-form" aria-labelledby="ss-cb-compose-h" data-testid="ss-cb-compose">
      <h2 id="ss-cb-compose-h">{from ? `A new revision of ${from.name}` : 'Draft a control policy'}</h2>
      <p className="ss-muted">Nothing is saved until you propose it. A proposal cannot be edited afterwards; someone else approves it and a third person publishes it.</p>
      <div className="ss-asg-form">
        <label className="ss-field"><span>Policy code</span><input value={d.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} disabled={!!from} placeholder="POL-EXAMPLE" data-testid="ss-cb-f-code" /></label>
        <label className="ss-field"><span>Name</span><input value={d.name} onChange={(e) => set({ name: e.target.value })} data-testid="ss-cb-f-name" /></label>
        <label className="ss-field"><span>Owner</span><input value={d.owner} onChange={(e) => set({ owner: e.target.value })} data-testid="ss-cb-f-owner" /></label>
      </div>
      <label className="ss-field"><span>What this policy covers, in words</span><input value={d.scope_statement} onChange={(e) => set({ scope_statement: e.target.value })} data-testid="ss-cb-f-scope" /></label>
      <label className="ss-field"><span>Where it comes from</span><input value={d.source} onChange={(e) => set({ source: e.target.value })} data-testid="ss-cb-f-source" /></label>
      <fieldset className="ss-cb-choice">
        <legend>Is this the complete list of controls to assess, within what it covers?</legend>
        <label><input type="radio" name="completeness" checked={d.completeness === 'PARTIAL'} onChange={() => set({ completeness: 'PARTIAL' })} data-testid="ss-cb-f-partial" /> <span><strong>Partial.</strong> It lists some controls. Complete coverage can never be asserted under it.</span></label>
        <label><input type="radio" name="completeness" checked={d.completeness === 'DECLARED_COMPLETE'} onChange={() => set({ completeness: 'DECLARED_COMPLETE' })} data-testid="ss-cb-f-complete" /> <span><strong>Declared complete.</strong> Its approvers state that these are all the controls to assess. Coverage can then be assessed against it.</span></label>
      </fieldset>

      <h3>Controls it requires</h3>
      {d.controls.length === 0 ? <p className="ss-muted">Add a control from the register. A policy does not create controls.</p> : null}
      {d.controls.map((c, i) => (
        <article key={c.control_code} className="ss-cb-card" data-testid={`ss-cb-draft-${c.control_code}`}>
          <header><strong>{register.find((r) => r.control_code === c.control_code)?.name}</strong> <button type="button" className="ss-btn small" onClick={() => set({ controls: d.controls.filter((_, n) => n !== i) })}>Remove</button></header>
          <label className="ss-field"><span>What this control is for</span><input value={c.purpose} onChange={(e) => setControl(i, { purpose: e.target.value })} data-testid={`ss-cb-purpose-${c.control_code}`} /></label>
          {c.obligations.map((o, j) => {
            const cond = usable.find((x) => `${x.code}@${x.version}` === o.condition);
            return (
              <div key={j} className="ss-cb-ob" data-testid={`ss-cb-ob-${c.control_code}-${j}`}>
                <div className="ss-asg-form">
                  <label className="ss-field"><span>Reference <em>(a short key)</em></span><input value={o.key} onChange={(e) => setOb(i, j, { key: e.target.value.toUpperCase() })} data-testid={`ss-cb-ob-key-${c.control_code}-${j}`} /></label>
                  <label className="ss-field"><span>What must be verified</span><input value={o.title} onChange={(e) => setOb(i, j, { title: e.target.value })} data-testid={`ss-cb-ob-title-${c.control_code}-${j}`} /></label>
                  <label className="ss-field"><span>Required</span>
                    <select value={o.condition} onChange={(e) => setOb(i, j, { condition: e.target.value, params: {} })} data-testid={`ss-cb-ob-when-${c.control_code}-${j}`}>
                      <option value="">for every application in scope</option>
                      {usable.map((x) => <option key={`${x.code}@${x.version}`} value={`${x.code}@${x.version}`}>when “{x.name}” holds</option>)}
                    </select>
                  </label>
                  {(cond?.params ?? []).map((p) => <label key={p} className="ss-field"><span>{p.replace(/_/g, ' ')}</span><input inputMode="decimal" value={o.params[p] ?? ''} onChange={(e) => setOb(i, j, { params: { ...o.params, [p]: e.target.value } })} data-testid={`ss-cb-ob-param-${c.control_code}-${j}-${p}`} /></label>)}
                  <label className="ss-field"><span>Evidence combines as</span><select value="ALL_REQUIRED" disabled><option value="ALL_REQUIRED">every required piece must match</option></select></label>
                </div>
                {cond ? <p className="ss-muted">Reads {cond.fields.join(', ')} from the application. If that is not known, whether this applies is unknown — not “no”.</p> : null}
                <table className="ss-table">
                  <thead><tr><th scope="col">Reference</th><th scope="col">What the evidence is</th><th scope="col">Kind</th><th scope="col">Required</th><th scope="col"><span className="ss-sr">Remove</span></th></tr></thead>
                  <tbody>
                    {o.evidence.map((e, k) => (
                      <tr key={k}>
                        <td><input aria-label="Evidence key" value={e.key} onChange={(x) => setEv(i, j, k, { key: x.target.value.toUpperCase() })} data-testid={`ss-cb-ev-key-${c.control_code}-${j}-${k}`} /></td>
                        <td><input aria-label="What the evidence is" value={e.description} onChange={(x) => setEv(i, j, k, { description: x.target.value })} data-testid={`ss-cb-ev-desc-${c.control_code}-${j}-${k}`} /></td>
                        <td><select aria-label="Kind of evidence" value={e.evidence_type} onChange={(x) => setEv(i, j, k, { evidence_type: x.target.value })} data-testid={`ss-cb-ev-type-${c.control_code}-${j}-${k}`}><option value="ANSWER">the customer’s answer</option><option value="DELIVERY">a statement is delivered</option></select></td>
                        <td><input type="checkbox" aria-label="Required" checked={e.required} onChange={(x) => setEv(i, j, k, { required: x.target.checked })} /></td>
                        <td><button type="button" className="ss-btn small" onClick={() => setOb(i, j, { evidence: o.evidence.filter((_, n) => n !== k) })}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="ss-cb-actions">
                  <button type="button" className="ss-btn small" onClick={() => setOb(i, j, { evidence: [...o.evidence, { key: `E${o.evidence.length + 1}`, description: '', evidence_type: 'ANSWER', required: true }] })} data-testid={`ss-cb-ev-add-${c.control_code}-${j}`}>Add evidence</button>
                  {c.obligations.length > 1 ? <button type="button" className="ss-btn small" onClick={() => setControl(i, { obligations: c.obligations.filter((_, n) => n !== j) })}>Remove this obligation</button> : null}
                </div>
              </div>
            );
          })}
          <button type="button" className="ss-btn small" onClick={() => setControl(i, { obligations: [...c.obligations, { key: `OB${c.obligations.length + 1}`, title: '', condition: '', params: {}, evidence: [{ key: 'E1', description: '', evidence_type: 'ANSWER', required: true }] }] })} data-testid={`ss-cb-ob-add-${c.control_code}`}>Add another obligation of this control</button>
        </article>
      ))}
      <div className="ss-cb-actions">
        <label className="ss-field"><span>Add a control</span>
          <select value={add} onChange={(e) => setAdd(e.target.value)} data-testid="ss-cb-add-control"><option value="">Choose a control…</option>{register.filter((r) => !d.controls.some((c) => c.control_code === r.control_code)).map((r) => <option key={r.control_code} value={r.control_code}>{r.control_code} — {r.name}</option>)}</select>
        </label>
        <button type="button" className="ss-btn" disabled={!add} onClick={() => { set({ controls: [...d.controls, { control_code: add, purpose: '', obligations: [{ key: 'MAIN', title: '', condition: '', params: {}, evidence: [{ key: 'E1', description: '', evidence_type: 'ANSWER', required: true }] }] }] }); setAdd(''); }} data-testid="ss-cb-add-control-go">Add</button>
      </div>

      <h3>Try it on an invented application</h3>
      <p className="ss-muted">Give the facts the conditions read. Leave one empty to see what happens when it is not known. Nothing is recorded.</p>
      <div className="ss-asg-form">{reads.map((f) => <label key={f} className="ss-field"><span>{f}</span><input value={facts[f] ?? ''} onChange={(e) => { setFacts({ ...facts, [f]: e.target.value }); setCheck(null); }} data-testid={`ss-cb-fact-${f}`} /></label>)}</div>
      {reads.length === 0 ? <p className="ss-muted">No condition is used, so every obligation is required for every application.</p> : null}
      <div className="ss-cb-actions">
        <button type="button" className="ss-btn" disabled={checking || d.controls.length === 0} onClick={tryOut} data-testid="ss-cb-check">Check which controls this application needs</button>
        <button type="button" className="ss-btn primary" disabled={busy || d.controls.length === 0} onClick={() => onPropose(toBody(d, market))} data-testid="ss-cb-propose">Propose this {from ? 'revision' : 'policy'}</button>
      </div>
      {problem ? <p className="ss-note warn" role="alert" data-testid="ss-cb-invalid"><Glyph name="alert" size={14} /><span><strong>This policy cannot be proposed as it stands.</strong> {problem}</span></p> : null}
      {check ? (
        <div data-testid="ss-cb-check-result" data-fingerprint={check.fingerprint}>
          <table className="ss-table">
            <thead><tr><th scope="col">Control</th><th scope="col">Obligation</th><th scope="col">For this application</th><th scope="col">Why</th></tr></thead>
            <tbody>{(check.obligations as Any[]).map((o) => <tr key={`${o.control_code}/${o.obligation}`} data-testid={`ss-cb-applies-${o.control_code}-${o.obligation}`} data-status={o.status}><th scope="row">{register.find((r) => r.control_code === o.control_code)?.name ?? o.control_code}</th><td>{o.title}</td><td><Tag tone={APPLIES[o.status]?.tone}>{APPLIES[o.status]?.label ?? o.status}</Tag></td><td>{o.applicability.explanation}{(o.applicability.missing ?? []).length ? ` — not known: ${o.applicability.missing.join(', ')}` : ''}</td></tr>)}</tbody>
          </table>
          <p className="ss-muted">Determination <span className="ss-code" title={check.fingerprint}>{short(check.fingerprint)}</span>. The facts are invented catalog facts; their link to assignment inputs and call-plan facts is unverified.</p>
        </div>
      ) : null}
    </section>
  );
}

function MappingBuilder({ control, policy, options, journeys, mappings, market, busy, can, onPropose, onDecide, onPublish }: { control: RegisterControl; policy: ControlPolicy; options: BuilderOptions; journeys: JourneyRef[]; mappings: ControlMapping[]; market: string; busy: boolean; can: (p: string) => boolean; onPropose: (body: Record<string, unknown>) => void; onDecide: (id: string, v: 'APPROVE' | 'REJECT') => void; onPublish: (id: string) => void }) {
  const pc = (policy.controls as Any[]).find((c) => c.control.code === control.control_code);
  const requirements: Array<{ obligation: string; title: string; key: string; description: string; evidence_type: string; required: boolean }> = useMemo(() => ((pc?.obligations ?? []) as Any[]).flatMap((o) => (o.evidence as Any[]).map((e) => ({ obligation: o.key, title: o.title, ...e }))), [pc]);
  const latest = [...mappings].reverse().find((m) => m.status === 'PUBLISHED') ?? null;
  const [entries, setEntries] = useState<EntryDraft[]>(() => ((latest?.entries ?? []) as Any[]).filter((e) => e.requirement).map((e) => ({ obligation: e.obligation ?? pc?.obligations[0]?.key ?? '', requirement: e.requirement, item: `${e.item.code}@${e.item.version}`, method: e.rule?.method ?? 'DELIVERY', expected: e.rule?.expected?.value === false ? 'NO' : 'YES', operator: e.rule?.expected?.operator ?? 'EQ', value: e.rule?.expected?.value !== undefined && e.rule?.method === 'NUMERIC_COMPARE' ? String(e.rule.expected.value) : '', unit: e.rule?.expected?.unit ?? 'COUNT', accepted: e.rule?.expected?.accepted ?? e.rule?.expected?.options ?? [], mode: e.rule?.expected?.mode ?? 'INCLUDES_ALL' })));
  const [journey, setJourney] = useState('');
  const [trial, setTrial] = useState<EvaluationPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);
  const change = (next: EntryDraft[]) => { setEntries(next); setTrial(null); setProblem(null); };
  const setEntry = (i: number, patch: Partial<EntryDraft>) => change(entries.map((e, n) => (n === i ? { ...e, ...patch } : e)));
  const body = () => ({ market_code: market, control_code: control.control_code, combination: 'ALL_REQUIRED', applicability: null, entries: entries.map((e) => entryBody(e, options.items)), source: `Mapped for control policy ${policy.code} revision ${policy.revision} in the Controls and evidence builder` });
  const tryOut = () => {
    const j = journeys.find((x) => x.id === journey);
    if (!j) return;
    setTrying(true); setProblem(null);
    previewEvaluation(j.kind === 'COORDINATED' ? { coordinatedId: j.id } : { simulationId: j.id }, policy.id, [body()]).then(setTrial).catch((e) => { setTrial(null); setProblem(say(e)); }).finally(() => setTrying(false));
  };
  if (!pc) return <div className="ss-empty" data-testid="ss-cb-map-none"><p><strong>{policy.name} does not require {control.control_code}.</strong> Choose a policy that names this control.</p></div>;
  const mine = (trial?.controls as Any[] | undefined)?.filter((c) => c.control_code === control.control_code) ?? [];
  return (
    <section className="ss-srv-block ss-cb-form" aria-labelledby="ss-cb-map-h" data-testid="ss-cb-map" data-control={control.control_code}>
      <h2 id="ss-cb-map-h">Evidence for: {control.name.replace(/ \(synthetic control\)$/, '')}</h2>
      <p className="ss-muted">Under <strong>{policy.name}</strong>, revision {policy.revision}. For each piece of evidence the policy requires, choose the published question or statement that supplies it. A question that appears in several surveys supplies it wherever it is asked.</p>
      {requirements.map((r) => {
        const rows = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.obligation === r.obligation && e.requirement === r.key);
        const wanted = r.evidence_type === 'ANSWER' ? 'ANSWER' : 'DELIVERY';
        const candidates = options.items.filter((it) => (wanted === 'ANSWER' ? it.methods.length > 0 : true));
        return (
          <article key={`${r.obligation}/${r.key}`} className="ss-cb-card" data-testid={`ss-cb-req-${r.obligation}-${r.key}`} data-mapped={rows.length}>
            <header><strong>{r.description}</strong> <Tag>{r.evidence_type === 'ANSWER' ? 'an answer' : 'a delivery'}</Tag> {r.required ? <Tag tone="draft">required</Tag> : <Tag>optional</Tag>} {rows.length === 0 ? <Tag tone="warn">not mapped</Tag> : null}</header>
            <p className="ss-muted">For: {r.title}</p>
            {rows.map(({ e, i }) => {
              const it = options.items.find((x) => `${x.code}@${x.version}` === e.item);
              return (
                <div key={i} className="ss-cb-ob" data-testid={`ss-cb-entry-${r.obligation}-${r.key}-${rows.findIndex((x) => x.i === i)}`}>
                  <div className="ss-asg-form">
                    <label className="ss-field"><span>{wanted === 'ANSWER' ? 'Published question' : 'Published question or statement'}</span>
                      <select value={e.item} onChange={(x) => { const n = options.items.find((y) => `${y.code}@${y.version}` === x.target.value); setEntry(i, { item: x.target.value, method: wanted === 'DELIVERY' ? 'DELIVERY' : n?.methods[0] ?? '', accepted: [] }); }} data-testid={`ss-cb-item-${r.obligation}-${r.key}`}>
                        <option value="">Choose…</option>
                        {candidates.map((x) => <option key={`${x.code}@${x.version}`} value={`${x.code}@${x.version}`}>{x.name} — {typeWords(x.answer_type)} (in {x.surveys.map((v) => v.survey_name).join(', ')})</option>)}
                      </select>
                    </label>
                    {wanted === 'ANSWER' && it ? (
                      <label className="ss-field"><span>The answer is judged as</span>
                        <select value={e.method} onChange={(x) => setEntry(i, { method: x.target.value })} data-testid={`ss-cb-method-${r.obligation}-${r.key}`}>{it.methods.map((m) => <option key={m} value={m}>{METHOD[m] ?? m}</option>)}</select>
                      </label>
                    ) : null}
                    {e.method === 'EXACT_BOOLEAN' ? <label className="ss-field"><span>Expected answer</span><select value={e.expected} onChange={(x) => setEntry(i, { expected: x.target.value })} data-testid={`ss-cb-expected-${r.obligation}-${r.key}`}><option value="YES">yes</option><option value="NO">no</option></select></label> : null}
                    {e.method === 'NUMERIC_COMPARE' ? (
                      <>
                        <label className="ss-field"><span>Must be</span><select value={e.operator} onChange={(x) => setEntry(i, { operator: x.target.value })} data-testid={`ss-cb-operator-${r.obligation}-${r.key}`}>{Object.entries(options.operators).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                        <label className="ss-field"><span>This number</span><input inputMode="decimal" value={e.value} onChange={(x) => setEntry(i, { value: x.target.value })} data-testid={`ss-cb-value-${r.obligation}-${r.key}`} /></label>
                        <label className="ss-field"><span>Counted in</span><select value={e.unit} onChange={(x) => setEntry(i, { unit: x.target.value })}>{Object.entries(options.units).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                      </>
                    ) : null}
                  </div>
                  {e.method === 'SET_MATCH' ? <label className="ss-field"><span>The customer’s selection must include</span><select value={e.mode} onChange={(x) => setEntry(i, { mode: x.target.value })} data-testid={`ss-cb-mode-${r.obligation}-${r.key}`}>{Object.entries(options.set_modes).map(([k, v]) => <option key={k} value={k}>{v} the choices ticked below</option>)}</select></label> : null}
                  {(e.method === 'ENUM_MATCH' || e.method === 'SET_MATCH') && it ? <fieldset className="ss-cb-choice" data-testid={`ss-cb-choices-${r.obligation}-${r.key}`}><legend>{e.method === 'SET_MATCH' ? 'Choices' : 'Accepted choices'}</legend>{it.options.map((o) => <label key={o.code as string}><input type="checkbox" value={o.code as string} checked={e.accepted.includes(o.code as string)} onChange={(x) => setEntry(i, { accepted: x.target.checked ? [...e.accepted, o.code as string] : e.accepted.filter((a) => a !== o.code) })} /> <span>{String(o.label)}</span></label>)}</fieldset> : null}
                  {it ? <p className="ss-muted" data-testid={`ss-cb-implication-${r.obligation}-${r.key}`}>This exact revision is asked in {it.surveys.length} published {it.surveys.length === 1 ? 'survey' : 'surveys'}: {it.surveys.map((s) => `${s.survey_name} (${s.version_label})`).join('; ')}. Each time it is asked in a journey counts as evidence, and every one must match.</p> : null}
                  {wanted === 'ANSWER' && it && it.methods.length === 0 ? <p className="ss-issue">No way of judging a {typeWords(it.answer_type)} answer exists yet.</p> : null}
                  <button type="button" className="ss-btn small" onClick={() => change(entries.filter((_, n) => n !== i))}>Remove</button>
                </div>
              );
            })}
            <button type="button" className="ss-btn small" onClick={() => change([...entries, { obligation: r.obligation, requirement: r.key, item: '', method: wanted === 'DELIVERY' ? 'DELIVERY' : '', expected: 'YES', operator: 'EQ', value: '', unit: 'COUNT', accepted: [], mode: 'INCLUDES_ALL' }])} data-testid={`ss-cb-req-add-${r.obligation}-${r.key}`}>{rows.length ? 'Add another question for this evidence' : 'Choose what supplies this evidence'}</button>
          </article>
        );
      })}

      <h3>Test it against a simulated journey</h3>
      <p className="ss-muted">A trial shows how the answers already recorded in one simulated journey would be judged with the mapping as it stands on this page, under this policy. It shows whether the evidence is found, matches, is missing or conflicts in that journey — not that the mapping is right for every journey. Nothing is recorded or proposed.</p>
      <div className="ss-cb-actions">
        <label className="ss-field"><span>Simulated journey</span>
          <select value={journey} onChange={(e) => { setJourney(e.target.value); setTrial(null); }} data-testid="ss-cb-journey"><option value="">Choose a journey…</option>{journeys.map((j) => <option key={j.id} value={j.id}>{j.kind === 'COORDINATED' ? `Coordinated journey · ${j.surveys} surveys` : j.title} — {new Date(j.created_at).toLocaleString()}</option>)}</select>
        </label>
        <button type="button" className="ss-btn" disabled={!journey || trying || entries.length === 0} onClick={tryOut} data-testid="ss-cb-try">Test this mapping</button>
        {can('survey.edit') ? <button type="button" className="ss-btn primary" disabled={busy || entries.length === 0} onClick={() => onPropose(body())} data-testid="ss-cb-map-propose">Propose this mapping</button> : null}
      </div>
      {journeys.length === 0 ? <p className="ss-muted">No simulated journey exists yet. Run a simulation in a survey’s Simulator, or a coordinated simulation from Survey assignment.</p> : null}
      {problem ? <p className="ss-note warn" role="alert" data-testid="ss-cb-map-invalid"><Glyph name="alert" size={14} /><span><strong>This mapping is not valid as it stands.</strong> {problem}</span></p> : null}
      {trial ? (
        <div data-testid="ss-cb-trial" data-coverage={(trial.coverage as Any).status}>
          <p className="ss-note"><Glyph name="info" size={14} /><span><strong>Trial only — nothing was recorded.</strong> Coverage of the journey under this policy would be: {COVERAGE[(trial.coverage as Any).status]?.label ?? (trial.coverage as Any).status}. {(trial.coverage as Any).explanation}</span></p>
          {mine.map((c) => (
            <article key={c.obligation} className="ss-cb-card" data-testid={`ss-cb-trial-${c.obligation}`} data-outcome={c.outcome} data-coverage={c.coverage}>
              <header><strong>{c.obligation_title}</strong> <Tag tone={OUTCOME[c.outcome]?.tone}>{OUTCOME[c.outcome]?.label ?? c.outcome}</Tag> <Tag tone={COVERAGE[c.coverage]?.tone}>{COVERAGE[c.coverage]?.label ?? c.coverage}</Tag></header>
              <p>{OUTCOME[c.outcome]?.means} {COVERAGE[c.coverage]?.means}</p>
              {(c.reasons as Any[]).length ? <ul className="ss-ev-reasons">{(c.reasons as Any[]).map((x, i) => <li key={i} title={x.code}>{x.text}</li>)}</ul> : null}
              {(c.observations as Any[]).length ? <ul className="ss-ev-reasons">{(c.observations as Any[]).map((o) => <li key={o.seq} title={o.placement ?? ''}>{o.survey ? `Survey ${o.survey.position} of the journey` : 'No survey of this journey'}: {o.explanation}</li>)}</ul> : <p className="ss-muted">No evidence was found for this obligation in the journey.</p>}
            </article>
          ))}
        </div>
      ) : null}

      <h3>Mapping revisions of this control</h3>
      {mappings.length === 0 ? <p className="ss-muted" data-testid="ss-cb-map-empty">None yet.</p> : null}
      {[...mappings].reverse().map((m) => (
        <MappingCard key={m.id} m={m}>
          {m.status === 'PROPOSED' || m.status === 'APPROVED' ? (() => { const n = nextStep(m.status, m.is_proposer, m.is_approver, can, 'mapping'); return <p className={`ss-cb-next ${n.mine ? 'mine' : ''}`} data-testid="ss-cb-map-next" data-action={n.action}><strong>{n.title}</strong> {n.text}</p>; })() : null}
          {m.status === 'PROPOSED' && can('survey.approve') && !m.is_proposer ? <button type="button" className="ss-btn small primary" disabled={busy} onClick={() => onDecide(m.id, 'APPROVE')} data-testid="ss-cb-map-approve">Approve this mapping</button> : null}
          {m.status === 'APPROVED' && can('survey.publish') && !m.is_proposer && !m.is_approver ? <button type="button" className="ss-btn small primary" disabled={busy} onClick={() => onPublish(m.id)} data-testid="ss-cb-map-publish">Publish this mapping</button> : null}
        </MappingCard>
      ))}
    </section>
  );
}
