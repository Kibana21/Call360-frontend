// Survey Applicability (APPL-X1R) — one requirement, edited with room to think: when it applies, which published
// surveys it requires, how it behaves with the others, what it does for the application being previewed, and what
// is wrong with it. Every change is applied at once and can be undone; closing returns to the same card.
import { useState } from 'react';
import { ConditionBuilder } from './editors';
import type { Diagnostic, Plan, Policy, Requirement, SurveyRef } from './model/types';
import { OutcomeMark } from './plan';
import { editPolicy, useAppl } from './store';
import { SurveyPicker, SurveyTicket } from './SurveyPicker';
import { DrawerPanel, Icon, Tag } from './ui';
import { surveysOf, shortName } from './usage';

export function RequirementEditor({ policy, id, plan, diagnostics, onClose }: { policy: Policy; id: string; plan?: Plan; diagnostics: Diagnostic[]; onClose: () => void }) {
  const { update, setPreview } = useAppl();
  const [picking, setPicking] = useState(false);
  const r = policy.requirements.find((x) => x.id === id);
  if (!r) return null;
  const res = plan?.requirements.find((x) => x.id === id);
  const mine = diagnostics.filter((d) => d.at?.kind === 'requirement' && d.at?.id === id);
  const at = (part: string) => mine.filter((d) => d.at?.part === part);
  const whenIssues = mine.filter((d) => d.at?.part === 'when' && d.at?.path !== undefined);
  const req = (label: string, f: (x: Requirement, p: Policy) => void) => update(label, (d) => editPolicy(d, policy.code, (p) => { const x = p.requirements.find((y) => y.id === id); if (x) f(x, p); }));
  const surveys = surveysOf(r);
  const others = policy.requirements.filter((x) => x.id !== id);
  const add = (list: SurveyRef[]) => req(`Link ${list.map((s) => shortName(s.name)).join(', ')}`, (x, p) => {
    list.forEach((s) => { if (x.action.kind === 'INCLUDE') { if (!x.action.surveys.some((y) => y.code === s.code)) x.action.surveys.push(s); } else if (!x.action.alternatives.some((a) => a.survey.code === s.code)) x.action.alternatives.push({ survey: s, when: null }); if (!p.order.includes(s.code)) p.order.push(s.code); });
  });
  const disappearing = others.filter((o) => r.replaces.includes(o.id)).flatMap(surveysOf).map((s) => shortName(s.name));
  const issues = (list: Diagnostic[]) => (list.length ? <ul className="ap-issues block">{list.map((d, i) => <li key={i} className={d.severity.toLowerCase()} data-testid={`ap-editor-issue-${d.code}`}><Icon name={d.severity === 'INFO' ? 'info' : 'warn'} size={12} /> {d.message}</li>)}</ul> : null);
  return (
    <DrawerPanel wide testid="ap-requirement-editor" onClose={onClose} title="Edit requirement" subtitle="Changes apply as you make them and can be undone."
      footer={<><span className="ap-quiet" aria-live="polite">For the previewed application: <OutcomeMark r={res} small /></span><span className="ap-spacer" /><button type="button" className="ap-btn primary" onClick={onClose} data-testid="ap-editor-done"><Icon name="check" size={13} /> Done</button></>}>
      <input className="ap-title-input" aria-label="Requirement name" value={r.name} onChange={(e) => req('Rename a requirement', (x) => { x.name = e.target.value; })} data-testid="ap-editor-name" />

      <section className="ap-editor-when" data-testid="ap-editor-when">
        <h3><span className="ap-when-word">When</span> does this requirement apply?</h3>
        <div className="ap-choice" role="radiogroup" aria-label="When it applies">
          <button type="button" role="radio" aria-checked={!r.when} className={!r.when ? 'on' : ''} onClick={() => req('Apply a requirement always', (x) => { x.when = null; })} data-testid="ap-editor-always">Always</button>
          <button type="button" role="radio" aria-checked={!!r.when} className={r.when ? 'on' : ''} onClick={() => { if (!r.when) req('Give a requirement a condition', (x) => { x.when = { op: 'all', args: [] }; }); }} data-testid="ap-editor-conditional">When a condition matches</button>
        </div>
        {r.when ? <ConditionBuilder expr={r.when.op === 'all' && !r.when.args.length ? null : r.when} onChange={(e) => req('Change a condition', (x) => { x.when = e ?? { op: 'all', args: [] }; })} trace={res?.trace} diagnostics={whenIssues} testid="ap-editor-builder" emptyHint="Pick a fact about the application, or a condition you saved earlier." /> : <p className="ap-quiet">Every application this policy covers gets these surveys.</p>}
      </section>

      <section className="ap-editor-then" data-testid="ap-editor-then">
        <h3><span className="ap-then-word">Then</span> what is required?</h3>
        <div className="ap-checklist row" role="radiogroup" aria-label="What is required">
          <button type="button" role="radio" aria-checked={r.action.kind === 'INCLUDE'} className={r.action.kind === 'INCLUDE' ? 'on' : ''} data-testid="ap-editor-include" onClick={() => req('Include every listed survey', (x) => { if (x.action.kind === 'CHOOSE_ONE') x.action = { kind: 'INCLUDE', surveys: x.action.alternatives.map((a) => a.survey) }; })}><span className="ap-check round">{r.action.kind === 'INCLUDE' ? <Icon name="dot" size={12} /> : null}</span><span><strong>Include {surveys.length > 1 ? 'these surveys together' : 'this survey'}</strong><small>Every survey listed is required.</small></span></button>
          <button type="button" role="radio" aria-checked={r.action.kind === 'CHOOSE_ONE'} className={r.action.kind === 'CHOOSE_ONE' ? 'on' : ''} data-testid="ap-editor-choose" onClick={() => req('Choose exactly one survey', (x) => { if (x.action.kind === 'INCLUDE') x.action = { kind: 'CHOOSE_ONE', alternatives: x.action.surveys.map((s) => ({ survey: s, when: null })) }; })}><span className="ap-check round">{r.action.kind === 'CHOOSE_ONE' ? <Icon name="dot" size={12} /> : null}</span><span><strong>Choose exactly one</strong><small>Each survey has its own criterion. If more than one fits, nothing is chosen — the order of the list never decides.</small></span></button>
        </div>
        <ul className="ap-editor-surveys">
          {surveys.map((s, si) => { const alt = r.action.kind === 'CHOOSE_ONE' ? r.action.alternatives[si] : null; const live = res?.choice?.alternatives[si]; return (
            <li key={s.code} data-testid={`ap-editor-survey-${s.code}`}>
              <SurveyTicket survey={s} onOpen={() => setPreview(s)} testid={`ap-editor-ticket-${s.code}`} onAdopt={(latest) => req(`Adopt version ${latest.label ?? latest.version} of ${s.name}`, (x) => { if (x.action.kind === 'INCLUDE') x.action.surveys = x.action.surveys.map((y) => (y.code === s.code ? { ...latest } : y)); else x.action.alternatives.forEach((a) => { if (a.survey.code === s.code) a.survey = { ...latest }; }); })} onRemove={() => req(`Unlink ${shortName(s.name)}`, (x) => { if (x.action.kind === 'INCLUDE') x.action.surveys = x.action.surveys.filter((y) => y.code !== s.code); else x.action.alternatives = x.action.alternatives.filter((a) => a.survey.code !== s.code); })} />
              {alt ? (
                <div className="ap-alt" data-testid={`ap-editor-alt-${si}`}>
                  <span className={`ap-alt-word${!alt.when && !alt.fallback ? ' missing' : ''}`}>{alt.fallback ? 'The fallback: used only when no other alternative fits' : alt.when ? 'Use this one when' : 'Needs a criterion — or mark it as the fallback'}</span>
                  <button type="button" role="switch" aria-checked={!!alt.fallback} className={`ap-switch${alt.fallback ? ' on' : ''}`} data-testid={`ap-editor-alt-${si}-fallback`} onClick={() => req(alt.fallback ? 'Stop using an alternative as the fallback' : 'Use an alternative as the fallback', (x) => { if (x.action.kind === 'CHOOSE_ONE') { const a = x.action.alternatives[si]!; a.fallback = !a.fallback; if (a.fallback) a.when = null; } })}>Fallback</button>
                  {live ? <Tag tone={live.chosen ? 'published' : live.result === 'UNKNOWN' ? 'unknown' : 'plain'}>{live.chosen ? 'chosen for the preview' : live.missing_criterion ? 'incomplete' : live.result === 'TRUE' ? 'eligible' : live.result === 'UNKNOWN' ? 'not known' : live.otherwise ? 'fallback, not needed' : 'not eligible'}</Tag> : null}
                  {!alt.fallback ? <ConditionBuilder expr={alt.when} onChange={(e) => req('Change when an alternative is used', (x) => { if (x.action.kind === 'CHOOSE_ONE') x.action.alternatives[si]!.when = e; })} trace={live?.trace} testid={`ap-editor-alt-${si}-builder`} emptyHint="Say when this survey is the one to use." /> : null}
                </div>
              ) : null}
            </li>
          ); })}
          {!surveys.length ? <li className="ap-tickets-empty">No survey linked yet.</li> : null}
        </ul>
        <button type="button" className="ap-btn" onClick={() => setPicking(true)} data-testid="ap-editor-add-survey"><Icon name="plus" size={13} /> Add published surveys</button>
        {res?.choice && res.choice.outcome !== 'CHOSEN' ? <p className="ap-card-choice-why"><Icon name="warn" size={12} /> {res.choice.reason}</p> : null}
        {issues(mine.filter((d) => d.at?.part === 'action' || String(d.at?.part ?? '').startsWith('alternative') || d.code === 'ORDER_MISSING'))}
      </section>

      <section className="ap-editor-replace" data-testid="ap-editor-replace">
        <h3><Icon name="replace" size={15} /> Does it replace other requirements?</h3>
        <p className="ap-quiet">By default this requirement adds to the others. Tick a requirement to say: when this one applies, that one does not contribute. Only the ones you tick are affected.</p>
        {others.length ? <div className="ap-checklist">{others.map((o) => { const on = r.replaces.includes(o.id); return (
          <button key={o.id} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} data-testid={`ap-editor-replace-${o.id}`} onClick={() => req(on ? `Stop replacing “${o.name}”` : `Replace “${o.name}”`, (x) => { x.replaces = on ? x.replaces.filter((t) => t !== o.id) : [...x.replaces, o.id]; })}>
            <span className="ap-check">{on ? <Icon name="check" size={12} /> : null}</span><span><strong>{o.name}</strong><small>requires {surveysOf(o).map((s) => shortName(s.name)).join(', ') || 'nothing yet'}</small></span></button>
        ); })}</div> : <p className="ap-quiet">There is no other requirement to replace yet.</p>}
        {r.replaces.length ? <p className="ap-replace-preview" data-testid="ap-editor-replace-preview"><Icon name="info" size={13} /> When this requirement applies, {disappearing.join(', ') || 'nothing'} {disappearing.length === 1 ? 'is' : 'are'} no longer required through {r.replaces.length === 1 ? 'that requirement' : 'those requirements'}. Any other requirement that asks for the same survey still stands.</p> : null}
        {issues(at('replaces'))}
      </section>

      {issues(mine.filter((d) => !d.at?.part))}
      {picking ? <SurveyPicker onClose={() => setPicking(false)} onPick={add} already={surveys.map((s) => s.code)} /> : null}
    </DrawerPanel>
  );
}
