// Survey Applicability (APPL-X1) — a selection plan, drawn exactly as the Python evaluator returned it: what is
// required and in which order, what is still pending, what is not required and why, and which facts would settle it.
import type { Outcome, Plan, ReqResult } from './model/types';
import { Icon, Tag, short, type IconName } from './ui';

export const OUTCOME_WORD: Record<Outcome, string> = {
  ACTIVE: 'Applies', REPLACED: 'Replaced', PENDING: 'May be replaced', UNRESOLVED: 'Cannot tell yet', INACTIVE: 'Does not apply',
  AMBIGUOUS: 'More than one choice', NO_ALTERNATIVE: 'No choice fits', CHOICE_UNRESOLVED: 'Choice not decided',
};
const OUTCOME_ICON: Record<Outcome, IconName> = { ACTIVE: 'check', REPLACED: 'replace', PENDING: 'question', UNRESOLVED: 'question', INACTIVE: 'minus', AMBIGUOUS: 'warn', NO_ALTERNATIVE: 'warn', CHOICE_UNRESOLVED: 'question' };
export const outcomeTone = (o: Outcome) => (o === 'ACTIVE' ? 'true' : o === 'INACTIVE' ? 'false' : o === 'REPLACED' ? 'replaced' : 'unknown');
export function OutcomeMark({ r, small }: { r: Pick<ReqResult, 'outcome'> | undefined; small?: boolean }) {
  if (!r) return null;
  return <span className={`ap-outcome is-${outcomeTone(r.outcome)}${small ? ' small' : ''}`} data-outcome={r.outcome}><Icon name={OUTCOME_ICON[r.outcome]} size={small ? 11 : 13} /> {OUTCOME_WORD[r.outcome]}</span>;
}
const STATUS: Record<Plan['status'], { word: string; tone: string; icon: IconName }> = {
  RESOLVED: { word: 'Decided', tone: 'true', icon: 'check' }, UNRESOLVED: { word: 'Not decided yet', tone: 'unknown', icon: 'question' },
  OUT_OF_SCOPE: { word: 'This policy does not cover this application', tone: 'false', icon: 'minus' },
  SCOPE_UNRESOLVED: { word: 'Cannot tell whether this policy covers it', tone: 'unknown', icon: 'question' }, ERROR: { word: 'Could not be evaluated', tone: 'bad', icon: 'warn' },
};

export function PlanView({ plan, onSurvey, onRequirement, onNeed, onResolve, activeSurvey, compact, testid = 'ap-plan' }: {
  plan: Plan | undefined; onSurvey?: (code: string) => void; onRequirement?: (id: string) => void; onNeed?: (variable: string) => void;
  activeSurvey?: string | null; compact?: boolean; testid?: string;
  /** AP-2: state that one delivery of a survey satisfies exactly these requirements */
  onResolve?: (survey: string, requirements: string[]) => void;
}) {
  if (!plan) return <div className="ap-plan loading" data-testid={testid}><p className="ap-quiet">Working it out…</p></div>;
  const st = STATUS[plan.status];
  const name = (id: string) => plan.requirements.find((r) => r.id === id)?.name ?? id;
  if (plan.status === 'ERROR') return <div className="ap-plan" data-testid={testid} data-status="ERROR"><div className="ap-plan-status is-bad"><Icon name="warn" /> <strong>{st.word}</strong></div><p>{plan.error?.message}</p></div>;
  return (
    <div className={`ap-plan${compact ? ' compact' : ''}`} data-testid={testid} data-status={plan.status} data-fingerprint={plan.fingerprint}>
      <div className={`ap-plan-status is-${st.tone}`} data-testid={`${testid}-status`}><Icon name={st.icon} /> <strong>{st.word}</strong><span>{plan.summary}</span></div>

      {plan.selected.length ? (
        <section><h4>Required surveys, in delivery order</h4>
          <ol className="ap-plan-list" data-testid={`${testid}-selected`}>
            {plan.selected.map((e) => (
              <li key={e.survey.code} className={activeSurvey === e.survey.code ? 'on' : ''}>
                <button type="button" className="ap-ticket" onClick={() => onSurvey?.(e.survey.code)} data-testid={`${testid}-survey-${e.survey.code}`}>
                  <span className="ap-ticket-n">{e.position}</span>
                  <span className="ap-ticket-body"><strong>{e.survey.name}</strong><small>version {e.survey.label ?? e.survey.version} · {short(e.survey.fingerprint)}</small></span>
                  {e.conflict ? <Tag tone="bad">conflict</Tag> : null}
                </button>
                <span className="ap-plan-because">because {e.required_by.map((id, i) => <span key={id}>{i ? ', ' : ''}<button type="button" className="ap-linkbtn" onClick={() => onRequirement?.(id)}>{name(id)}</button></span>)}{e.obligations ? ` — delivered once for ${e.obligations} requirements` : ''}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : plan.status === 'RESOLVED' ? <p className="ap-plan-none" data-testid={`${testid}-none`}><Icon name="check" size={14} /> No survey is required for this application.</p> : null}

      {plan.pending.length ? (
        <section className="ap-plan-pending"><h4>Possibly required — not decided</h4>
          <ul className="ap-plan-list" data-testid={`${testid}-pending`}>{plan.pending.map((e) => <li key={e.survey.code}><button type="button" className="ap-ticket pending" onClick={() => onSurvey?.(e.survey.code)}><span className="ap-ticket-n"><Icon name="question" size={12} /></span><span className="ap-ticket-body"><strong>{e.survey.name}</strong><small>depends on {e.required_by.map(name).join(', ')}</small></span></button></li>)}</ul>
        </section>
      ) : null}

      {plan.needs.length ? (
        <section className="ap-plan-needs" data-testid={`${testid}-needs`}><h4>What would settle it</h4>
          <ul>{plan.needs.map((n) => <li key={n.variable}><button type="button" className="ap-need" onClick={() => onNeed?.(n.variable)} data-testid={`${testid}-need-${n.variable}`}><Icon name="question" size={13} /> <span><strong>{n.name}</strong> — {n.reason}</span></button></li>)}</ul>
        </section>
      ) : null}

      {!compact && plan.excluded.length ? (
        <section><h4>Not required</h4>
          <ul className="ap-plan-excluded" data-testid={`${testid}-excluded`}>{plan.excluded.map((e) => <li key={e.survey.code} data-testid={`${testid}-excluded-${e.survey.code}`}><button type="button" className="ap-linkbtn strong" onClick={() => onSurvey?.(e.survey.code)}>{e.survey.name}</button><span>{e.why.map((w) => w.text).join('; ') || 'no requirement asks for it'}</span></li>)}</ul>
        </section>
      ) : null}

      {!compact ? (
        <section><h4>Why, requirement by requirement</h4>
          <ul className="ap-plan-why" data-testid={`${testid}-explanation`}>{plan.requirements.map((r, i) => <li key={r.id} className={`is-${outcomeTone(r.outcome)}`}><button type="button" onClick={() => onRequirement?.(r.id)} data-testid={`${testid}-why-${r.id}`}><OutcomeMark r={r} small /><span>{plan.explanation[i]}</span></button></li>)}</ul>
        </section>
      ) : null}

      {plan.diagnostics.length ? <ul className="ap-issues block" data-testid={`${testid}-diagnostics`}>{plan.diagnostics.map((d, i) => <li key={i} className={d.severity.toLowerCase()} data-testid={`${testid}-diag-${d.code}`}><Icon name={d.severity === 'INFO' ? 'info' : 'warn'} size={12} /> <span>{d.message}{d.code === 'DUPLICATE_SURVEY' && onResolve && d.survey && d.requirements ? <> <button type="button" className="ap-linkbtn" data-testid={`${testid}-resolve-${d.survey}`} onClick={() => onResolve(d.survey!, d.requirements!)}>State that one delivery satisfies these {d.requirements.length} requirements</button></> : null}</span></li>)}</ul> : null}
      {!compact && plan.policy ? <p className="ap-plan-foot" data-testid={`${testid}-provenance`}>{plan.policy.name} · version {plan.policy.version} ({plan.policy.status.toLowerCase()}) · policy {short(plan.policy.fingerprint)} · result {short(plan.fingerprint)} · a synthetic result, not an assignment</p> : null}
    </div>
  );
}
