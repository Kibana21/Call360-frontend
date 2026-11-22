// Survey Studio (ASG-2A) — one application, several surveys. SIMULATION ONLY.
// Requirement groups say which published rules compete for ONE survey requirement: the primary survey, an additional
// required survey, or one of several alternatives. The server decides each group with the existing rules and plans
// each selected survey on its own. This file shows what it returned. It merges nothing, orders nothing that was not
// governed, and decides nothing about what happens between surveys.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { Glyph, Tag } from '../ui';
import { decideGroup, proposeGroup, publishGroup, startCoordinated, withdrawGroup, type AssignmentGroup, type AssignmentRule, type CompositePlan, type GroupKind } from './assignmentApi';
import { short, when } from './reviewApi';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- the composite is read as JSON
export const KIND: Record<string, { label: string; what: string }> = {
  PRIMARY: { label: 'Primary survey', what: 'The main survey of the application. A market has exactly one primary group.' },
  ADD_REQUIRED: { label: 'Additional required survey', what: 'One further survey, required as well when one of its rules matches.' },
  ALTERNATIVE: { label: 'Alternative surveys', what: 'Several surveys compete for one requirement; the rules’ own precedence picks one.' },
};
const STATUS: Record<string, string> = { PROPOSED: 'Proposed', APPROVED: 'Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn', PUBLISHED: 'Published', SUPERSEDED: 'Superseded' };
const STATE: Record<string, { label: string; tone?: 'ok' | 'warn' }> = { SELECTED: { label: 'Selected', tone: 'ok' }, NOT_APPLICABLE: { label: 'Does not apply to this application' }, UNRESOLVED: { label: 'Unresolved', tone: 'warn' } };
const WHY_UNRESOLVED: Record<string, string> = {
  NO_MATCH: 'No rule of the primary group matches: the application has no primary survey.',
  AMBIGUOUS: 'Rules of equal precedence match and select different surveys. None is chosen.',
  AMBIGUOUS_SAME_TARGET: 'Rules of equal precedence match. Equal precedence is held, not broken.',
  INPUT_MISSING: 'An input these rules read is not known. That is not the same as “does not apply”.',
  TARGET_NOT_EFFECTIVE: 'The winning rule’s survey version is no longer the published one. It is not replaced by a newer one.',
  SURVEY_NOT_BOUND: 'The winning rule has no published binding to a survey. The requirement does not disappear.',
};
const ISSUE: Record<string, string> = {
  PRIMARY_GROUP_MISSING: 'No primary group is published', PRIMARY_GROUP_CONFLICT: 'More than one primary group is published', RULE_IN_SEVERAL_GROUPS: 'A rule is in more than one group',
  GROUP_STRUCTURE_INVALID: 'A group’s members do not fit its kind', MEMBER_NOT_PUBLISHED: 'A group has no published member rule', BOUND_RULE_UNGROUPED: 'A rule bound to a survey belongs to no group',
};
const SELECTION: Record<string, string> = { RESOLVED: 'Every requirement is settled', UNRESOLVED_REQUIREMENT: 'A requirement is unresolved', UNRESOLVED_CONFIGURATION: 'The group configuration cannot be trusted' };
const ORDER_REASON: Record<string, string> = { ABSENT: 'No group has a governed position.', PARTIAL: 'Some groups have a governed position and some have none.', CONFLICTING: 'Two groups have the same governed position.' };

/** The published and open requirement groups, with the governance actions each person may take. */
export function GroupsSection({ groups, rules, busy, can, act }: { groups: AssignmentGroup[]; rules: AssignmentRule[]; busy: boolean; can: (p: string) => boolean; act: (w: () => Promise<unknown>) => void }) {
  const live = groups.filter((g) => g.status === 'PUBLISHED' || g.status === 'PROPOSED' || g.status === 'APPROVED');
  return (
    <section className="ss-srv-block" aria-labelledby="ss-asg-groups-h" data-testid="ss-asg-groups">
      <h2 id="ss-asg-groups-h">Requirement groups</h2>
      <p className="ss-muted">An application can need more than one survey. A group gathers the rules that compete for <strong>one</strong> requirement; the engine decides each group on its own, so a rule only ever competes with the rules of its own requirement. Like a binding, a group is proposed, approved and published by three different people.</p>
      {live.length === 0 ? <p className="ss-muted" data-testid="ss-asg-no-groups">No group is published or proposed. Without a published primary group, no multi-survey selection can be trusted.</p> : (
        <ul className="ss-asg-grouplist">
          {live.map((g) => (
            <li key={g.id} data-testid={`ss-asg-group-${g.code}`} data-status={g.status} data-kind={g.kind} data-version={g.version}>
              <header><strong>{g.name}</strong> <span className="ss-code">{g.code} v{g.version}</span> <Tag tone={g.kind === 'PRIMARY' ? 'ok' : undefined}>{KIND[g.kind]?.label ?? g.kind}</Tag> {g.status === 'PUBLISHED' ? null : <Tag tone="draft">{STATUS[g.status]}</Tag>}</header>
              <p>{g.purpose}</p>
              <p className="ss-muted">Rules: {g.members.map((m) => `${m.rule_code} v${m.rule_version}${m.rule_status === 'PUBLISHED' ? '' : ` (${m.rule_status.toLowerCase()})`}`).join(', ')} · {g.sequence === null || g.sequence === undefined ? 'no governed position in the order' : `governed position ${g.sequence}`} · {when(g.proposed_at)}</p>
              <div className="ss-actions">
                {g.status === 'PROPOSED' && can('survey.approve') ? <button type="button" className="ss-btn" disabled={busy} onClick={() => act(() => decideGroup(g.id, 'APPROVE', ''))} data-testid={`ss-asg-group-approve-${g.code}`}>Approve</button> : null}
                {g.status === 'APPROVED' && can('survey.publish') ? <button type="button" className="ss-btn primary" disabled={busy} onClick={() => act(() => publishGroup(g.id))} data-testid={`ss-asg-group-publish-${g.code}`}>Publish group</button> : null}
                {(g.status === 'PROPOSED' || g.status === 'APPROVED') && g.is_proposer ? <button type="button" className="ss-btn" disabled={busy} onClick={() => act(() => withdrawGroup(g.id, 'Withdrawn by its proposer'))}>Withdraw</button> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {can('survey.edit') ? <ProposeGroup rules={rules} busy={busy} act={act} /> : null}
    </section>
  );
}

function ProposeGroup({ rules, busy, act }: { rules: AssignmentRule[]; busy: boolean; act: (w: () => Promise<unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<GroupKind>('PRIMARY');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [sequence, setSequence] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const valid = /^[A-Z][A-Z0-9_-]{2,39}$/.test(code) && name.trim().length >= 3 && purpose.trim().length >= 10 && members.length > 0 && (sequence === '' || /^[1-9]\d*$/.test(sequence));
  if (!open) return <button type="button" className="ss-btn" onClick={() => setOpen(true)} data-testid="ss-asg-group-new">Propose a group, or a new version of one</button>;
  const submit = () => act(() => proposeGroup({ code, kind, name: name.trim(), purpose: purpose.trim(), sequence: sequence === '' ? null : Number(sequence), note: '',
    members: members.map((ref) => { const r = rules.find((x) => x.ref === ref)!; return { rule_code: r.rule_code, rule_version: r.rule_version! }; }) }).then(() => { setOpen(false); setCode(''); setName(''); setPurpose(''); setSequence(''); setMembers([]); }));
  return (
    <form className="ss-asg-groupform" onSubmit={(e) => { e.preventDefault(); if (valid) submit(); }} data-testid="ss-asg-group-form" aria-label="Propose a requirement group">
      <label className="ss-field"><span>Code <em>capitals, digits, hyphens; an existing code makes a new version</em></span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="ss-asg-group-code" maxLength={40} /></label>
      <label className="ss-field"><span>Kind</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as GroupKind)} data-testid="ss-asg-group-kind">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
      <p className="ss-muted ss-asg-wide">{KIND[kind]!.what}</p>
      <label className="ss-field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} data-testid="ss-asg-group-name" maxLength={160} /></label>
      <label className="ss-field"><span>Position in the order <em>optional; leave empty if no order is governed</em></span><input inputMode="numeric" value={sequence} onChange={(e) => setSequence(e.target.value)} data-testid="ss-asg-group-sequence" /></label>
      <label className="ss-field ss-asg-wide"><span>Purpose <em>which survey requirement this group stands for</em></span><input value={purpose} onChange={(e) => setPurpose(e.target.value)} data-testid="ss-asg-group-purpose" maxLength={2000} /></label>
      <fieldset className="ss-asg-wide ss-asg-members"><legend>Member rules <em>the published rules that compete for this requirement</em></legend>
        {rules.filter((r) => r.rule_version).map((r) => (
          <label key={r.ref}><input type="checkbox" checked={members.includes(r.ref)} onChange={(e) => setMembers(e.target.checked ? [...members, r.ref] : members.filter((m) => m !== r.ref))} data-testid={`ss-asg-group-member-${r.rule_code}`} /> {r.name} <span className="ss-code">{r.ref}</span></label>
        ))}
      </fieldset>
      <div className="ss-actions ss-asg-wide">
        <button type="submit" className="ss-btn primary" disabled={busy || !valid} data-testid="ss-asg-group-propose">Propose group</button>
        <button type="button" className="ss-btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

/** The composite: which surveys this application needs, why, each one's own plan, and what is not settled. */
const BLOCKER: Record<string, string> = {
  SELECTION_UNRESOLVED: 'Which surveys are required is not settled', NOTHING_SELECTED: 'No survey is selected', ORDER_UNRESOLVED: 'No order of the surveys is governed',
  PLAN_BLOCKED: 'A survey’s call plan cannot be computed', DUPLICATE_SURVEY_REQUIREMENT_UNRESOLVED: 'Two requirements select the same survey version', COMPOSITE_STALE: 'The composite is out of date',
};

export function CompositeResult({ c, canSimulate }: { c: CompositePlan; canSimulate: boolean }) {
  const nav = useNavigate();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const states = c.states as Any;
  const permitted = states.coordinated_simulation.status === 'PERMITTED';
  // permitted is about this composite; available is about this server. The control is offered only when both hold.
  const available = states.coordinated_simulation.available !== false;
  const start = () => {
    setStarting(true); setStartError(null);
    startCoordinated(c.id).then((co) => nav(`/survey-studio/coordinated-simulations/${co.id}`))
      .catch((e) => { setStartError(e instanceof ApiFailure ? (e.status === 404 ? 'Coordinated simulation is not switched on for this server.' : `${e.code ?? ''} ${e.message}`) : 'The server could not be reached.'); setStarting(false); });
  };
  const k = c.composite as Any;
  const selected = k.selected as Any[];
  const ordering = k.ordering as Any;
  const governed = ordering.status === 'GOVERNED';
  const ready = c.plan_status === 'READY';
  const journey = governed ? (ordering.order as string[]).map((code) => selected.find((s) => s.group === code)) : selected;
  return (
    <section className="ss-asg-result" aria-labelledby="ss-asg-comp-h" data-testid="ss-asg-composite" data-composite={c.id} data-selection={c.selection_status} data-plan={c.plan_status} data-ordering={c.ordering_status} data-fingerprint={c.fingerprint} data-surveys={selected.length}>
      <div className={`ss-plan-q ${ready ? 'yes' : 'no'}`}>
        <p className="ss-plan-q-label">3 · The surveys this application requires</p>
        <h2 id="ss-asg-comp-h"><Glyph name={c.selection_status === 'RESOLVED' ? 'check' : 'stop'} size={18} /> {selected.length === 0 ? 'No survey is selected' : `${selected.length} survey${selected.length === 1 ? '' : 's'} selected`} — {SELECTION[c.selection_status] ?? c.selection_status}</h2>
        <p className="ss-muted">Three separate questions. An answer to one says nothing about the others.</p>
        <dl className="ss-asg-states" data-testid="ss-asg-states">
          <div data-testid="ss-asg-state-plan" data-status={states.call_plan.status}><dt>Call plan</dt>
            <dd><strong>{states.call_plan.status === 'COMPUTABLE' ? 'Computable' : states.call_plan.status === 'NOT_COMPUTABLE' ? 'Not computable' : 'Unresolved'}</strong> — {states.call_plan.status === 'COMPUTABLE' ? 'the set of surveys is settled, their order is governed and each survey’s own plan can be computed.' : states.call_plan.status === 'NOT_COMPUTABLE' ? 'the set and the order are settled, but at least one survey’s own plan is blocked.' : 'the set of surveys or their order is not settled; see what is unresolved below.'}</dd></div>
          <div data-testid="ss-asg-state-coordination" data-status={states.coordinated_simulation.status} data-available={String(available)}><dt>Coordinated simulation</dt>
            <dd><strong>{permitted ? 'Permitted' : 'Blocked'}</strong>{permitted ? ' — every survey can be simulated in its governed order. A testing aid only.' : <> — {(states.coordinated_simulation.blockers as Any[]).map((b) => <span key={`${b.code}${b.at}`} className="ss-asg-blocker" data-code={b.code}><span className="ss-code">{b.code}</span> {BLOCKER[b.code] ?? ''}{b.at ? ` (${b.at})` : ''}. </span>)}</>}</dd></div>
          <div data-testid="ss-asg-state-eligibility" data-status={states.operational_call_eligibility.status}><dt>Operational call eligibility</dt>
            <dd><strong>Not established</strong> — nothing here establishes whether any of this may be used on a real customer call.</dd></div>
        </dl>
        {canSimulate && permitted && available ? <div className="ss-actions"><button type="button" className="ss-btn primary" onClick={start} disabled={starting} data-testid="ss-asg-coordinate">Start a coordinated simulation of these surveys</button></div> : null}
        {permitted && !available ? <p className="ss-save-note" data-testid="ss-asg-coordinate-unavailable">Coordinated simulation is not switched on for this server, so it cannot be started here. Each survey can still be simulated on its own.</p> : null}
        {startError ? <p className="ss-issue" role="alert" data-testid="ss-asg-coordinate-error"><Glyph name="alert" size={14} /> {startError}</p> : null}
        {k.missing_inputs.length ? <p data-testid="ss-asg-comp-missing-inputs">Inputs not known: <strong>{k.missing_inputs.join(', ')}</strong>. An unknown input is never read as “does not apply”.</p> : null}
        {k.missing_facts.length ? <p data-testid="ss-asg-comp-missing-facts">Facts missing for a plan: {(k.missing_facts as string[]).map((f) => <span key={f} className="ss-code">{f} </span>)}— nothing is assumed in their place.</p> : null}
        {c.recompute_consistent ? null : <p className="ss-issue" role="alert" data-testid="ss-asg-comp-drift"><Glyph name="alert" size={14} /> The rules, bindings, groups or survey versions have changed since this was recorded. What is shown is the recorded composite; computed again now it would differ.</p>}
        <p className="ss-muted">Composite fingerprint <span className="ss-code" title={c.fingerprint}>{short(c.fingerprint)}</span> · application fingerprint <span className="ss-code" title={c.application_sha256}>{short(c.application_sha256)}</span> · decided for {when(c.evaluated_at)} · kind of record: Simulation</p>
      </div>

      <p className="ss-note warn" data-testid="ss-asg-comp-consistency"><Glyph name="alert" size={14} /><span><strong>The two parts of the application are not reconciled.</strong> The inputs the rules read and the facts the plans read are entered separately; no approved mapping connects them, so nothing checks that they describe the same application.</span></p>

      {k.configuration_issues.length ? (
        <div className="ss-srv-diff" role="alert" data-testid="ss-asg-comp-issues">
          <h2><Glyph name="alert" size={15} /> The group configuration cannot be trusted</h2>
          <ul>{(k.configuration_issues as Any[]).map((i) => <li key={`${i.code}${i.at}`} data-code={i.code}><strong>{ISSUE[i.code] ?? i.code}</strong> <span className="ss-code">{i.at}</span> — {i.detail}</li>)}</ul>
        </div>
      ) : null}

      <div className="ss-srv-block" data-testid="ss-asg-journey" data-ordering={ordering.status}>
        <h2>The required survey journey</h2>
        {selected.length === 0 ? <p className="ss-muted">Nothing is selected.</p> : (
          <>
            {governed ? <p className="ss-muted">In the governed order of the groups.</p>
              : ordering.status === 'UNRESOLVED' ? <p className="ss-issue" role="alert" data-testid="ss-asg-order-unresolved"><Glyph name="alert" size={14} /> No order is governed for these surveys. {ORDER_REASON[ordering.reason] ?? ''} They are listed below, not ordered.</p> : null}
            <ol className={`ss-asg-journey ${governed ? 'ordered' : 'listed'}`}>
              {journey.map((s: Any) => (
                <li key={s.group} data-testid={`ss-asg-journey-${s.group}`} data-version={s.survey_version_id}>
                  <Tag tone={s.kind === 'PRIMARY' ? 'ok' : undefined}>{KIND[s.kind]?.label ?? s.kind}</Tag>
                  <Link to={`/survey-studio/surveys/${s.survey_code}/versions/${s.survey_version_id}`}><strong>{s.survey_name}</strong> · version {s.version_label}</Link>
                  <span className="ss-muted">own plan: {s.plan_status === 'READY' ? 'can be computed' : 'blocked'} · <span className="ss-code" title={s.plan_fingerprint}>{short(s.plan_fingerprint)}</span></span>
                </li>
              ))}
            </ol>
            {selected.length > 1 ? <p className="ss-note warn" data-testid="ss-asg-cross-survey"><Glyph name="alert" size={14} /><span><strong>What happens between the surveys is not decided.</strong> {k.cross_survey_policy.note} Each survey keeps its own plan, its own questions and its own evidence; nothing is merged or removed.</span></p> : null}
          </>
        )}
      </div>

      <div className="ss-srv-block">
        <h2>Why — each requirement</h2>
        <ul className="ss-asg-reqs" data-testid="ss-asg-requirements">
          {(k.requirements as Any[]).map((r) => {
            const st: { label: string; tone?: 'ok' | 'warn' } = STATE[r.state] ?? { label: String(r.state) };
            return (
              <li key={r.group.code} data-testid={`ss-asg-req-${r.group.code}`} data-state={r.state} data-outcome={r.outcome} data-kind={r.group.kind}>
                <header><strong>{r.group.name}</strong> <span className="ss-code">{r.group.code} v{r.group.version}</span> <Tag>{KIND[r.group.kind]?.label ?? r.group.kind}</Tag> <Tag tone={st.tone}>{st.label}</Tag></header>
                <p className="ss-muted">{r.group.purpose}</p>
                {r.state === 'SELECTED' ? (
                  <p>Rule <span className="ss-code">{r.selected.rule}</span>{r.by_fallback ? ' (the group’s explicit fallback rule)' : ''} stands for <Link to={`/survey-studio/surveys/${r.selected.survey_code}/versions/${r.selected.survey_version_id}`}><strong>{r.selected.survey_name}</strong> · version {r.selected.version_label}</Link> <span className="ss-muted">(content {short(r.selected.content_sha256)}, manifest verified)</span>. Its own plan: <strong>{r.plan.status === 'READY' ? 'can be computed' : 'blocked'}</strong>, {r.plan.items} items, {r.plan.open_points} point{r.plan.open_points === 1 ? '' : 's'} decided during the call. <Link to={`/survey-studio/surveys/${r.selected.survey_code}/plan`}>Open its call plan</Link> · <Link to={`/survey-studio/surveys/${r.selected.survey_code}/simulate`}>Simulate this survey</Link></p>
                ) : r.state === 'NOT_APPLICABLE' ? <p>No rule of this group matches the application, so this requirement does not apply to it.</p>
                  : <p className="ss-issue" role="alert"><Glyph name="alert" size={14} /> {WHY_UNRESOLVED[r.outcome] ?? 'The group’s configuration is not valid.'} <span className="ss-code">{r.outcome}</span>{r.missing_inputs.length ? ` · not known: ${r.missing_inputs.join(', ')}` : ''}</p>}
                <details><summary>The rules of this group, as the engine judged them</summary>
                  <table className="ss-table"><tbody>{(r.trace as Any[]).map((t) => (
                    <tr key={t.ref} data-testid={`ss-asg-req-${r.group.code}-${t.rule_code}`} data-match={t.match} data-selected={String(t.selected)}>
                      <th scope="row"><span className="ss-code">{t.ref}</span><br /><span className="ss-muted">priority {t.priority} · specificity {t.specificity}</span></th>
                      <td>{t.selected ? 'Selected' : !t.eligible ? `Not considered: ${t.excluded_reason}` : t.match === 'UNKNOWN' ? 'Cannot be decided' : t.tied ? 'Tied' : t.match === 'MATCH' ? 'Matches' : 'Does not match'}</td>
                      <td>{(t.conditions as Any[]).map((x) => `${x.field} ${x.result === 'PASS' ? 'met' : x.result === 'FAIL' ? 'not met' : 'not known'}`).join(' · ') || 'no conditions'}</td>
                      <td>{t.survey_version_id ? `${t.target_label}${t.survey_version_status === 'PUBLISHED' ? '' : ` (${String(t.survey_version_status).toLowerCase()}: not selectable)`}` : 'no survey bound'}</td>
                    </tr>))}</tbody></table>
                </details>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
