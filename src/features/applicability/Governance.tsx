// Survey Applicability (APPL-X1) — Policy Governance and Impact: validate, submit, approve, publish. One policy is
// reviewed and published as a whole, by three different people. In this PROTOTYPE the three people are simulated and
// nothing is recorded in Call360; the rules shown are the ones the real lifecycle (APPL-X4) will enforce on the server.
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAnalysis, useEvaluation } from './api';
import { Dependencies, PolicyBar, usePolicies } from './policyService';
import { savedPolicy } from './policyStore';
import { RequirementSentence } from './Overview';
import { TYPE_LABEL, sentence } from './model/describe';
import type { Diagnostic, Persona, Policy } from './model/types';
import { Impact } from './Scenarios';
import { PEOPLE, logEvent, useAppl, who } from './store';
import { Empty, Icon, Tag, short } from './ui';
import { BASE, reach, surveysOf, shortName } from './usage';

type Tab = 'review' | 'validation' | 'impact' | 'manifest' | 'history';
const STAGES = ['Draft', 'Validated', 'In review', 'Approved', 'Published'] as const;
const where = (d: Diagnostic, code: string) => (d.at?.kind === 'requirement' ? `${BASE}/policies/${code}?r=${String(d.at.id)}` : d.at?.kind === 'condition' ? `${BASE}/conditions?c=${String(d.at.code)}` : d.at?.kind === 'variable' ? `${BASE}/variables?v=${String(d.at.code)}` : d.at?.kind === 'profile' ? `${BASE}/profiles?p=${String(d.at.code)}` : `${BASE}/policies/${code}`);

export function GovernancePage() {
  const { data, update, persona, setPersona, say, look } = useAppl();
  const { code } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'review';
  const { current } = useAppl();
  const rec = data.policies.find((p) => p.code === code) ?? current;
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const subject: Policy | null = rec ? rec.candidate?.policy ?? rec.draft ?? rec.published : null;
  const analysis = useAnalysis(data, subject);
  const pol = usePolicies();
  // APPL-X3: a saved policy has NO simulated approval. It is a working draft; publication arrives with APPL-X4.
  const persisted = pol.on && !!rec && !!savedPolicy(rec.code);
  const impact = useEvaluation(data, rec?.candidate?.policy ?? rec?.draft, rec?.published && (rec.candidate || rec.draft) ? data.scenarios : [], rec?.published);
  const manifest = useMemo(() => {
    if (!subject) return { variables: [], conditions: [], surveys: [], profiles: [] as string[] };
    const vars = new Set<string>(), conds = new Map<string, number>();
    const walk = (e: Parameters<typeof reach>[1]) => { const r = reach(data, e); r.variables.forEach((v) => vars.add(v)); };
    const refs = (e: unknown) => { const n = e as { op?: string; condition?: string; version?: number; args?: unknown[]; arg?: unknown } | null; if (!n) return; if (n.op === 'ref' && n.condition) { conds.set(n.condition, n.version ?? 1); const c = look.condition(n.condition); refs(c?.history?.find((h) => h.version === n.version)?.expr ?? c?.expr); } n.args?.forEach(refs); if (n.arg) refs(n.arg); };
    subject.requirements.forEach((r) => { walk(r.when); refs(r.when); if (r.action.kind === 'CHOOSE_ONE') r.action.alternatives.forEach((a) => { walk(a.when); refs(a.when); }); });
    walk(subject.scope); refs(subject.scope);
    const surveys = new Map(subject.requirements.flatMap(surveysOf).map((s) => [s.code, s]));
    return { variables: [...vars].map((c) => look.variable(c)).filter(Boolean), conditions: [...conds.entries()].map(([c, v]) => ({ c: look.condition(c), v })), surveys: subject.order.filter((c) => surveys.has(c)).map((c) => surveys.get(c)!), profiles: subject.profiles };
  }, [subject, data, look]);
  if (!rec || !subject) return <div className="ap-page"><Empty icon="policy" title="No policy yet" /></div>;
  const diagnostics = analysis.data?.diagnostics ?? [];
  const blockers = diagnostics.filter((d) => d.severity === 'BLOCKER');
  const warnings = diagnostics.filter((d) => d.severity === 'WARNING');
  const cand = rec.candidate;
  const stage = cand ? (cand.state === 'APPROVED' ? 3 : 2) : rec.draft ? (blockers.length || analysis.isLoading ? 0 : 1) : 4;
  const me = who(persona);
  const changedCount = impact.data?.results.filter((r) => r.comparison?.changed).length ?? 0;
  const goldenChanged = (impact.data?.results ?? []).filter((r) => r.comparison?.changed && data.scenarios.find((s) => s.id === r.scenario)?.golden).length;
  const go = (t: Tab) => setParams({ tab: t }, { replace: true });
  const act = (label: string, f: (r: NonNullable<typeof rec>) => void, done: string) => { update(label, (d) => { const r = d.policies.find((x) => x.code === rec.code); if (r) f(r); }); say(done); setNote(''); setReason(''); };
  const submit = () => act('Submit the policy for review', (r) => { r.candidate = { policy: { ...structuredClone(r.draft!), status: 'IN_REVIEW' }, fingerprint: analysis.data?.policy_fingerprint ?? null, submittedBy: me, note, state: 'IN_REVIEW' }; r.unsaved = false; logEvent(r, persona, `Submitted version ${r.draft!.version} for review`, note || undefined); }, 'Submitted. The candidate is now locked: it cannot be edited while it is in review.');
  const approve = () => act('Approve the policy', (r) => { r.candidate!.state = 'APPROVED'; r.candidate!.approvedBy = me; r.candidate!.policy.status = 'APPROVED'; logEvent(r, persona, `Approved version ${r.candidate!.policy.version}`, reason || undefined); }, 'Approved. A third person can now publish it.');
  const send = () => act('Return the policy to its author', (r) => { logEvent(r, persona, `Returned version ${r.candidate!.policy.version} to the author`, reason); r.candidate = null; }, 'Returned to the author with your reason. The draft can be edited again.');
  const publish = () => act('Publish the policy', (r) => { const p: Policy = { ...r.candidate!.policy, status: 'PUBLISHED' }; if (r.published) r.published.status = 'SUPERSEDED'; r.versions.push(p); logEvent(r, persona, `Published version ${p.version}`, r.published ? `Supersedes version ${r.published.version}` : undefined); r.published = p; r.draft = null; r.candidate = null; }, `Published. Earlier versions stay exactly as they were.`);
  const isMaker = cand ? cand.submittedBy === me : false;
  const isApprover = cand?.approvedBy === me;
  const refuse = (text: string) => <p className="ap-refusal" data-testid="ap-gov-refused"><Icon name="lock" size={13} /> {text}</p>;
  const pending = !cand ? (rec.draft ? { who: 'maker' as Persona, text: blockers.length ? 'Fix the blocking problems, then submit.' : 'Ready to submit for review.' } : null) : cand.state === 'IN_REVIEW' ? { who: 'checker' as Persona, text: 'Waiting for a checker to approve or return it.' } : { who: 'publisher' as Persona, text: 'Approved. Waiting for a publisher.' };

  return (
    <div className="ap-page ap-gov" data-testid="ap-governance">
      <header className="ap-pagehead">
        {persisted ? <div><h1>{subject.name}</h1><p>What this saved draft would need before it could be published. Nothing on this page publishes it.</p></div> : <div><h1>{subject.name}</h1><p>Reviewed and published as one policy, by three different people: the person who wrote it, a checker, and a publisher.</p><p className="ap-simulated" data-testid="ap-gov-simulated"><Icon name="info" size={13} /> <strong>Simulated in this prototype.</strong> The three people are a switch in this page and nothing is recorded in Call360. Only Survey Studio’s own publication of surveys is enforced by the server today.</p></div>}
        <div className="ap-policy-states">{rec.published ? <Tag tone="published" testid="ap-gov-published"><Icon name="lock" size={11} /> Version {rec.published.version} published · simulated</Tag> : null}{rec.draft && !cand ? <Tag tone="draft">Version {rec.draft.version} draft</Tag> : null}{cand ? <Tag tone="info" testid="ap-gov-candidate">Version {cand.policy.version} {cand.state === 'APPROVED' ? 'approved' : 'in review'}</Tag> : null}</div>
      </header>

      {persisted && rec ? (
        <section className="ap-nextstep ap-x4" data-testid="ap-gov-readiness" data-ready={analysis.data?.inspection?.ready_for_publication ?? false}>
          <PolicyBar rec={rec} />
          <h2>{analysis.data?.inspection ? (analysis.data.inspection.ready_for_publication ? 'No blocker was found' : analysis.data.inspection.stale ? 'A dependency changed — not ready for publication' : analysis.data.inspection.unpublished ? 'Draft contains unpublished dependencies — not ready for publication' : 'Not ready for publication') : 'Checking…'}</h2>
          <p data-testid="ap-gov-readiness-says">{analysis.data?.inspection?.readiness}</p>
          <p className="ap-quiet"><Icon name="info" size={13} /> <strong>A policy cannot be submitted, approved or published yet.</strong> This page shows what would stand in the way. Review by three different people, and published policy versions, arrive with the next checkpoint; until then nothing here records an approval, and no one is impersonated.</p>
          <Dependencies rec={rec} inspection={analysis.data?.inspection} editable={pol.canEdit} />
        </section>
      ) : (<>
      <ol className="ap-stages" aria-label="Where this version is" data-testid="ap-stages" data-stage={STAGES[stage]}>
        {STAGES.map((s, i) => <li key={s} className={i < stage ? 'done' : i === stage ? 'at' : ''}><span>{i < stage ? <Icon name="check" size={12} /> : i + 1}</span>{s}</li>)}
      </ol>

      {pending ? (
        <section className="ap-nextstep" data-testid="ap-gov-next">
          <div className="ap-nextstep-who"><span className="ap-avatar">{PEOPLE[pending.who].name[0]}</span><div><strong>Next: {PEOPLE[pending.who].role.toLowerCase()}</strong><span>{pending.text}</span></div></div>
          <div className="ap-nextstep-act">
            <p className="ap-quiet">You are acting as <strong>{PEOPLE[persona].name} · {PEOPLE[persona].role}</strong>.{persona !== pending.who ? <> <button type="button" className="ap-linkbtn" onClick={() => setPersona(pending.who)} data-testid="ap-gov-switch">Act as {PEOPLE[pending.who].name}</button></> : null}</p>
            {!cand ? (
              <>
                <textarea className="ap-input" rows={2} placeholder="A note for the checker: what changed and why" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for the checker" data-testid="ap-gov-note" />
                {persona !== 'maker' ? refuse('Only the maker submits a policy for review.') : blockers.length ? refuse(`${blockers.length} blocking problem${blockers.length === 1 ? '' : 's'} must be fixed first.`) : rec.unsaved ? refuse('Keep the draft (in the designer) before submitting it.') : null}
                <button type="button" className="ap-btn primary" disabled={persona !== 'maker' || !!blockers.length || rec.unsaved || !analysis.data} onClick={submit} data-testid="ap-gov-submit"><Icon name="arrow" size={13} /> Submit version {rec.draft?.version} for review</button>
              </>
            ) : cand.state === 'IN_REVIEW' ? (
              <>
                <textarea className="ap-input" rows={2} placeholder="Reason (required to return it)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" data-testid="ap-gov-reason" />
                {persona !== 'checker' ? refuse(isMaker ? 'The person who submitted a policy cannot approve it.' : 'Only a checker approves or returns a policy.') : null}
                <div className="ap-btnrow"><button type="button" className="ap-btn primary" disabled={persona !== 'checker'} onClick={approve} data-testid="ap-gov-approve"><Icon name="check" size={13} /> Approve</button>
                  <button type="button" className="ap-btn" disabled={persona !== 'checker' || reason.trim().length < 5} onClick={send} data-testid="ap-gov-return"><Icon name="undo" size={13} /> Return to the author</button></div>
              </>
            ) : (
              <>
                {persona !== 'publisher' ? refuse(isMaker ? 'The person who wrote a policy cannot publish it.' : isApprover ? 'The person who approved a policy cannot publish it: a third person must.' : 'Only a publisher publishes a policy.') : null}
                <button type="button" className="ap-btn primary" disabled={persona !== 'publisher'} onClick={publish} data-testid="ap-gov-publish"><Icon name="policy" size={13} /> Publish version {cand.policy.version}</button>
              </>
            )}
          </div>
        </section>
      ) : <section className="ap-nextstep done" data-testid="ap-gov-next"><div className="ap-nextstep-who"><span className="ap-avatar ok"><Icon name="check" size={14} /></span><div><strong>Version {rec.published?.version} is published — in this prototype only</strong><span>Nothing is waiting. To change it, open the designer: a new draft version starts from this one.</span></div></div><Link className="ap-btn" to={`${BASE}/policies/${rec.code}`}>Open the designer</Link></section>}
      </>)}

      <div className="ap-tabs" role="tablist" aria-label="Review">
        {([['review', 'eye', 'What is being published'], ['validation', 'warn', `Validation${blockers.length ? ` · ${blockers.length} to fix` : warnings.length ? ` · ${warnings.length} to check` : ''}`], ['impact', 'replace', `Impact${changedCount ? ` · ${changedCount} change${changedCount === 1 ? '' : 's'}` : ''}`], ['manifest', 'lock', 'Pinned versions'], ['history', 'history', 'History']] as const).map(([id, icon, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => go(id)} data-testid={`ap-gov-tab-${id}`}><Icon name={icon} size={14} /> {label}</button>)}
      </div>

      {tab === 'review' ? (
        <section className="ap-gov-review" data-testid="ap-gov-review">
          <div className="ap-policy-sentences">{subject.requirements.map((r) => <RequirementSentence key={r.id} r={r} />)}</div>
          <dl className="ap-facts-dl wide">
            <dt>Delivery order</dt><dd>{subject.order.map((c, i) => `${i + 1}. ${shortName(manifest.surveys.find((s) => s.code === c)?.name) || c}`).join('   ')}</dd>
            <dt>Shared deliveries</dt><dd>{subject.shared_deliveries.length ? subject.shared_deliveries.map((d) => `${shortName(manifest.surveys.find((x) => x.code === d.survey)?.name) || d.survey}: one delivery for ${d.requirements.length} requirements`).join('; ') : 'none stated — the same survey asked for twice stays unresolved'}</dd>
            <dt>Applies to</dt><dd>{subject.market} · {subject.profiles.map((c) => data.profiles.find((p) => p.code === c)?.name ?? c).join(' + ')}{subject.scope ? ` · only when ${sentence(subject.scope, look)}` : ''}</dd>
            <dt>Fingerprint</dt><dd><code data-testid="ap-gov-fingerprint">{analysis.data?.policy_fingerprint ?? '…'}</code></dd>
          </dl>
          <div className="ap-gov-checks">
            <div className={blockers.length ? 'bad' : 'ok'}><Icon name={blockers.length ? 'warn' : 'check'} /> {blockers.length ? `${blockers.length} blocking problem${blockers.length === 1 ? '' : 's'}` : 'No blocking problem'}</div>
            <div className={changedCount ? 'warn' : 'ok'}><Icon name="replace" /> {rec.published ? `${changedCount} of ${data.scenarios.length} saved scenarios change` : 'First version: nothing to compare with'}</div>
            <div className={goldenChanged ? 'bad' : 'ok'}><Icon name="scenario" /> {goldenChanged ? `${goldenChanged} regression scenario${goldenChanged === 1 ? '' : 's'} change — confirm this is intended` : 'No regression scenario changes'}</div>
          </div>
        </section>
      ) : null}

      {tab === 'validation' ? (
        <section data-testid="ap-gov-validation" data-blockers={blockers.length}>
          {!diagnostics.length && analysis.data ? <Empty icon="check" title="Nothing to fix">Every condition, survey, replacement and order entry checks out.</Empty> : null}
          {(['BLOCKER', 'WARNING', 'INFO'] as const).map((sev) => { const list = diagnostics.filter((d) => d.severity === sev); return list.length ? (
            <div key={sev} className={`ap-diag-group ${sev.toLowerCase()}`}><h3>{sev === 'BLOCKER' ? 'Must be fixed before review' : sev === 'WARNING' ? 'Worth checking' : 'For information'} <span className="ap-count">{list.length}</span></h3>
              <ul>{list.map((d, i) => <li key={i} data-testid={`ap-diag-${d.code}`}><Icon name={sev === 'INFO' ? 'info' : 'warn'} size={14} /><span>{d.message}</span><Link className="ap-linkbtn" to={where(d, rec.code)}>Go to it <Icon name="right" size={11} /></Link></li>)}</ul></div>
          ) : null; })}
          <p className="ap-quiet">Checked by Call360’s evaluator. Where a check would mean examining too many combinations it says “not checked” rather than passing.</p>
        </section>
      ) : null}

      {tab === 'impact' ? <Impact rows={impact.data?.results} /> : null}

      {tab === 'manifest' ? (
        <section className="ap-manifest" data-testid="ap-gov-manifest">
          <p className="ap-lede">Publishing freezes exactly these versions into the policy. A later version of any of them changes nothing here until someone adopts it in a new policy version.</p>
          <div className="ap-manifest-grid">
            <div><h3><Icon name="survey" size={14} /> Surveys <span className="ap-count">{manifest.surveys.length}</span></h3><ul className="ap-pins">{manifest.surveys.map((s) => <li key={s.code} data-testid={`ap-pin-survey-${s.code}`}><Icon name="lock" size={12} /><span><strong>{s.name}</strong><small>version {s.label ?? s.version} · {s.fingerprint}</small></span></li>)}</ul></div>
            <div><h3><Icon name="condition" size={14} /> Saved conditions <span className="ap-count">{manifest.conditions.length}</span></h3><ul className="ap-pins">{manifest.conditions.map(({ c, v }) => <li key={c?.code ?? v} data-testid={`ap-pin-condition-${c?.code}`}><Icon name="lock" size={12} /><span><strong>{c?.name}</strong><small>version {v}{c && c.version !== v ? ` — version ${c.version} exists and is not used here` : ''} · {c ? sentence(c.history?.find((h) => h.version === v)?.expr ?? c.expr, look) : ''}</small></span></li>)}</ul></div>
            <div><h3><Icon name="variable" size={14} /> Variables <span className="ap-count">{manifest.variables.length}</span></h3><ul className="ap-pins">{manifest.variables.map((v) => <li key={v!.code}><Icon name="lock" size={12} /><span><strong>{v!.name}</strong><small>version {v!.version} · {TYPE_LABEL[v!.type]}{v!.source.status === 'UNMAPPED' ? ' · no source yet' : ''}</small></span></li>)}</ul></div>
            <div><h3><Icon name="profile" size={14} /> Profiles <span className="ap-count">{manifest.profiles.length}</span></h3><ul className="ap-pins">{manifest.profiles.map((c) => { const p = data.profiles.find((x) => x.code === c); return <li key={c}><Icon name="lock" size={12} /><span><strong>{p?.name ?? c}</strong><small>version {p?.version}</small></span></li>; })}</ul>
              <h3><Icon name="policy" size={14} /> Evaluator</h3><ul className="ap-pins"><li><Icon name="lock" size={12} /><span><strong>call360.survey-applicability/0</strong><small>prototype contract · policy fingerprint {short(analysis.data?.policy_fingerprint)}</small></span></li></ul></div>
          </div>
        </section>
      ) : null}

      {tab === 'history' ? (
        <section data-testid="ap-gov-history">
          <ol className="ap-history">{[...rec.events].reverse().map((e, i) => <li key={i} className={e.persona}><span className="ap-avatar">{e.who[0]}</span><div><strong>{e.what}</strong><span>{e.who} · {e.at}</span>{e.detail ? <p>{e.detail}</p> : null}</div></li>)}</ol>
          <h3>Published versions</h3>
          <ul className="ap-pins">{[...rec.versions].reverse().map((v) => <li key={v.version} data-testid={`ap-version-${v.version}`}><Icon name="lock" size={12} /><span><strong>Version {v.version}</strong><small>{v.requirements.length} requirements · {v === rec.published ? 'current' : 'superseded, kept unchanged'}</small></span></li>)}</ul>
          <p className="ap-quiet">Prototype: this history lives in the browser tab. In Call360 every step is an audited, immutable record.</p>
        </section>
      ) : null}
    </div>
  );
}
