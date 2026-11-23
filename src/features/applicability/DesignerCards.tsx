// Survey Applicability (APPL-X1) — the Smart Card Composer: one card per requirement, "WHEN condition → THEN surveys".
// Cards are reordered by dragging the handle or with the move buttons; surveys and conditions can be dropped onto a
// card from the palette or added with the pickers. The live result on each card comes from the Python evaluator.
import { useEffect, useState, type DragEvent } from 'react';
import { ConditionBuilder } from './editors';
import { sentence } from './model/describe';
import { OutcomeMark } from './plan';
import type { Diagnostic, Expr, Plan, Policy, Requirement, SurveyRef } from './model/types';
import { editPolicy, newId, useAppl } from './store';
import { Icon, Picker, Tag, TriMark, short } from './ui';

export const DRAG = 'application/x-call360-applicability';
export type Dropped = { kind: 'survey' | 'condition' | 'variable' | 'requirement'; id: string };
export const dragData = (e: DragEvent, d: Dropped) => { e.dataTransfer.setData(DRAG, JSON.stringify(d)); e.dataTransfer.effectAllowed = 'copyMove'; };
const read = (e: DragEvent): Dropped | null => { try { return JSON.parse(e.dataTransfer.getData(DRAG)) as Dropped; } catch { return null; } };
const and = (when: Expr | null, extra: Expr): Expr => (!when ? extra : when.op === 'all' ? { ...when, args: [...when.args, extra] } : { op: 'all', args: [when, extra] });

interface Props { policy: Policy; plan?: Plan; diagnostics: Diagnostic[]; selected: string | null; onSelect: (id: string | null) => void; onSurvey: (code: string) => void; readOnly?: boolean; activeSurvey?: string | null; /** a requirement whose condition should open for editing straight away (it was just added) */ editing?: string | null }

export function DesignerCards({ policy, plan, diagnostics, selected, onSelect, onSurvey, readOnly, activeSurvey, editing }: Props) {
  const { data, update, look, say } = useAppl();
  const [over, setOver] = useState<string | null>(null);
  // a card reads as a sentence; its condition opens into the builder only when asked
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => { if (editing) setOpen((o) => new Set(o).add(editing)); }, [editing]);
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const change = (label: string, f: (p: Policy) => void) => update(label, (d) => editPolicy(d, policy.code, f));
  const req = (label: string, id: string, f: (r: Requirement, p: Policy) => void) => change(label, (p) => { const r = p.requirements.find((x) => x.id === id); if (r) f(r, p); });
  const ensureOrder = (p: Policy, codes: string[]) => codes.forEach((c) => { if (!p.order.includes(c)) p.order.push(c); });
  const addSurvey = (id: string, s: SurveyRef) => req(`Add ${s.name.split(' · ')[0]} to a requirement`, id, (r, p) => {
    if (r.action.kind === 'INCLUDE') { if (!r.action.surveys.some((x) => x.code === s.code)) r.action.surveys.push(s); } else if (!r.action.alternatives.some((a) => a.survey.code === s.code)) r.action.alternatives.push({ survey: s, when: null });
    ensureOrder(p, [s.code]);
  });
  const drop = (e: DragEvent, r: Requirement, zone: 'when' | 'then' | 'card') => {
    const d = read(e); setOver(null); if (!d || readOnly) return; e.preventDefault(); e.stopPropagation();
    if (d.kind === 'requirement') { if (d.id !== r.id) change('Reorder requirements', (p) => { const from = p.requirements.findIndex((x) => x.id === d.id), to = p.requirements.findIndex((x) => x.id === r.id); const [m] = p.requirements.splice(from, 1); p.requirements.splice(to, 0, m!); }); return; }
    if (d.kind === 'survey') { const s = data.surveys.find((x) => x.code === d.id); if (s) addSurvey(r.id, s); return; }
    if (zone === 'then') { say('Drop conditions and variables on the WHEN side', 'info'); return; }
    if (d.kind === 'condition') { const c = look.condition(d.id); if (c) req(`Add “${c.name}” to a condition`, r.id, (x) => { x.when = and(x.when, { op: 'ref', condition: c.code, version: c.version }); }); }
    if (d.kind === 'variable') { const v = look.variable(d.id); if (v) req(`Add ${v.name} to a condition`, r.id, (x) => { x.when = and(x.when, v.type === 'BOOLEAN' ? { op: 'test', variable: v.code, operator: 'is_true' } : { op: 'test', variable: v.code, operator: 'is_known' }); }); }
  };
  if (!policy.requirements.length) return null;
  return (
    <ol className="ap-cards" data-testid="ap-cards">
      {policy.requirements.map((r, i) => {
        const res = plan?.requirements.find((x) => x.id === r.id);
        const mine = diagnostics.filter((d) => d.at?.kind === 'requirement' && d.at?.id === r.id);
        const whenIssues = mine.filter((d) => d.at?.part === 'when' && d.at?.path !== undefined);
        const others = policy.requirements.filter((x) => x.id !== r.id);
        const replacedBy = policy.requirements.filter((x) => x.replaces.includes(r.id));
        const surveys = r.action.kind === 'INCLUDE' ? r.action.surveys : r.action.alternatives.map((a) => a.survey);
        const lit = !!activeSurvey && surveys.some((s) => s.code === activeSurvey);
        return (
          <li key={r.id} className={`ap-card${selected === r.id ? ' on' : ''}${over === r.id ? ' over' : ''}${res ? ` is-${res.outcome.toLowerCase()}` : ''}${lit ? ' lit' : ''}${activeSurvey && !lit ? ' dim' : ''}`} data-testid={`ap-card-${r.id}`} data-outcome={res?.outcome}
            onClick={() => onSelect(r.id)} onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setOver(r.id); } }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, r, 'card')}>
            <header className="ap-card-head">
              {!readOnly ? <span className="ap-card-grip" draggable onDragStart={(e) => dragData(e, { kind: 'requirement', id: r.id })} title="Drag to reorder" aria-hidden="true"><Icon name="grip" /></span> : null}
              <span className="ap-card-n">{i + 1}</span>
              <input className="ap-card-name" aria-label="Requirement name" value={r.name} readOnly={readOnly} onChange={(e) => req('Rename a requirement', r.id, (x) => { x.name = e.target.value; })} data-testid={`ap-card-${r.id}-name`} />
              <span className="ap-card-live" aria-live="polite"><OutcomeMark r={res} /></span>
              {!readOnly ? (
                <span className="ap-card-tools">
                  <button type="button" className="ap-iconbtn" aria-label="Move this requirement up" disabled={i === 0} data-testid={`ap-card-${r.id}-up`} onClick={(e) => { e.stopPropagation(); change('Reorder requirements', (p) => { p.requirements.splice(i - 1, 0, p.requirements.splice(i, 1)[0]!); }); }}><Icon name="up" size={14} /></button>
                  <button type="button" className="ap-iconbtn" aria-label="Move this requirement down" disabled={i === policy.requirements.length - 1} data-testid={`ap-card-${r.id}-down`} onClick={(e) => { e.stopPropagation(); change('Reorder requirements', (p) => { p.requirements.splice(i + 1, 0, p.requirements.splice(i, 1)[0]!); }); }}><Icon name="down" size={14} /></button>
                  <button type="button" className="ap-iconbtn" aria-label="Duplicate this requirement" data-testid={`ap-card-${r.id}-duplicate`} onClick={(e) => { e.stopPropagation(); change(`Duplicate “${r.name}”`, (p) => { const id = newId('r', p.requirements.map((x) => x.id)); p.requirements.splice(i + 1, 0, { ...structuredClone(r), id, name: `${r.name} (copy)`, replaces: [] }); }); }}><Icon name="copy" size={14} /></button>
                  <button type="button" className="ap-iconbtn" aria-label="Remove this requirement" data-testid={`ap-card-${r.id}-remove`} onClick={(e) => { e.stopPropagation(); change(`Remove “${r.name}”`, (p) => { p.requirements = p.requirements.filter((x) => x.id !== r.id); p.requirements.forEach((x) => { x.replaces = x.replaces.filter((t) => t !== r.id); }); }); onSelect(null); }}><Icon name="trash" size={14} /></button>
                </span>
              ) : null}
            </header>

            <div className="ap-card-body">
              <section className="ap-when" aria-label="When" onDrop={(e) => drop(e, r, 'when')} data-testid={`ap-card-${r.id}-when`}>
                <h3><span className="ap-when-word">When</span>{r.when ? null : <Tag tone="info">always</Tag>}</h3>
                {readOnly || !open.has(r.id) ? (
                  <div className="ap-cond-summary" data-testid={`ap-card-${r.id}-summary`}>
                    {r.when?.op === 'ref' ? <span className="ap-chip cond"><Icon name="condition" size={13} /> {look.condition(r.when.condition)?.name ?? r.when.condition}</span> : null}
                    <p className="ap-cond-says">{r.when ? sentence(r.when.op === 'ref' ? (look.condition(r.when.condition)?.history?.find((h) => r.when?.op === 'ref' && h.version === r.when.version)?.expr ?? look.condition(r.when.condition)?.expr ?? r.when) : r.when, look) : 'Every application — no condition.'}</p>
                    <div className="ap-cond-foot">
                      {res && r.when ? <TriMark value={res.trace.result} small word={res.trace.result === 'TRUE' ? 'True for the preview' : res.trace.result === 'FALSE' ? 'False for the preview' : 'Not known for the preview'} /> : null}
                      {r.when?.op === 'ref' ? <span className="ap-quiet">saved condition · version {r.when.version}</span> : null}
                      {whenIssues.length ? <Tag tone={whenIssues.some((d) => d.severity === 'BLOCKER') ? 'bad' : 'warn'}>{whenIssues.length} to check</Tag> : null}
                      {!readOnly ? <button type="button" className="ap-linkbtn" onClick={(e) => { e.stopPropagation(); toggle(r.id); }} data-testid={`ap-card-${r.id}-edit-condition`}><Icon name="condition" size={12} /> {r.when ? 'Edit condition' : 'Add a condition'}</button> : null}
                    </div>
                    {res?.needs.length && res.trace.result === 'UNKNOWN' ? <p className="ap-cond-needs"><Icon name="question" size={12} /> {res.needs.map((n) => `${n.name}: ${n.reason}`).join('; ')}</p> : null}
                  </div>
                ) : (
                  <>
                    <ConditionBuilder expr={r.when} onChange={(e) => req('Change a condition', r.id, (x) => { x.when = e; })} trace={r.when ? res?.trace : null} diagnostics={whenIssues} allowAlways testid={`ap-card-${r.id}-builder`} />
                    <button type="button" className="ap-linkbtn" onClick={(e) => { e.stopPropagation(); toggle(r.id); }} data-testid={`ap-card-${r.id}-done-condition`}><Icon name="check" size={12} /> Done</button>
                  </>
                )}
              </section>
              <span className="ap-seam" aria-hidden="true"><Icon name="arrow" size={18} /></span>
              <section className="ap-then" aria-label="Then" onDrop={(e) => drop(e, r, 'then')} data-testid={`ap-card-${r.id}-then`}>
                <h3><span className="ap-then-word">Then</span>
                  {!readOnly ? (
                    <span className="ap-seg tight" role="radiogroup" aria-label="What happens">
                      <button type="button" role="radio" aria-checked={r.action.kind === 'INCLUDE'} className={r.action.kind === 'INCLUDE' ? 'on' : ''} data-testid={`ap-card-${r.id}-include`} onClick={() => req('Change to “include”', r.id, (x) => { if (x.action.kind === 'CHOOSE_ONE') x.action = { kind: 'INCLUDE', surveys: x.action.alternatives.map((a) => a.survey) }; })}>{surveys.length > 1 ? 'Include all of' : 'Include'}</button>
                      <button type="button" role="radio" aria-checked={r.action.kind === 'CHOOSE_ONE'} className={r.action.kind === 'CHOOSE_ONE' ? 'on' : ''} data-testid={`ap-card-${r.id}-choose`} onClick={() => req('Change to “choose one”', r.id, (x) => { if (x.action.kind === 'INCLUDE') x.action = { kind: 'CHOOSE_ONE', alternatives: x.action.surveys.map((s) => ({ survey: s, when: null })) }; })}>Choose one of</button>
                    </span>
                  ) : <Tag>{r.action.kind === 'INCLUDE' ? 'include' : 'choose one'}</Tag>}
                </h3>
                <ul className="ap-tickets">
                  {surveys.map((s, si) => {
                    const alt = r.action.kind === 'CHOOSE_ONE' ? r.action.alternatives[si] : null;
                    const chosen = res?.choice?.alternatives[si];
                    return (
                      <li key={s.code} className={`${activeSurvey === s.code ? 'on' : ''}${chosen?.chosen ? ' chosen' : ''}`} data-testid={`ap-card-${r.id}-survey-${s.code}`}>
                        <button type="button" className="ap-ticket" onClick={(e) => { e.stopPropagation(); onSurvey(s.code); }} title="See everything that can select this survey">
                          <span className="ap-ticket-n"><Icon name="survey" size={13} /></span>
                          <span className="ap-ticket-body"><strong>{s.name}</strong><small>pinned to version {s.label ?? s.version} · {short(s.fingerprint)}</small></span>
                        </button>
                        {!readOnly ? <button type="button" className="ap-iconbtn" aria-label={`Remove ${s.name}`} data-testid={`ap-card-${r.id}-survey-${s.code}-remove`} onClick={(e) => { e.stopPropagation(); req(`Remove ${s.name.split(' · ')[0]}`, r.id, (x) => { if (x.action.kind === 'INCLUDE') x.action.surveys = x.action.surveys.filter((y) => y.code !== s.code); else x.action.alternatives = x.action.alternatives.filter((a) => a.survey.code !== s.code); }); }}><Icon name="x" size={13} /></button> : null}
                        {alt ? (
                          <div className="ap-alt" data-testid={`ap-card-${r.id}-alt-${si}`}>
                            <span className="ap-alt-word">{alt.when ? 'when' : 'otherwise'}</span>
                            {chosen ? <Tag tone={chosen.chosen ? 'published' : chosen.result === 'UNKNOWN' ? 'unknown' : 'plain'}>{chosen.chosen ? 'chosen' : chosen.result === 'TRUE' ? 'eligible' : chosen.result === 'UNKNOWN' ? 'not known' : 'not eligible'}</Tag> : null}
                            {!readOnly ? <ConditionBuilder expr={alt.when} onChange={(e) => req('Change when an alternative is chosen', r.id, (x) => { if (x.action.kind === 'CHOOSE_ONE') x.action.alternatives[si]!.when = e; })} trace={chosen?.trace} testid={`ap-card-${r.id}-alt-${si}-builder`} allowAlways emptyHint="No criterion: this is the “otherwise” choice, used when no other fits." /> : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                  {!surveys.length ? <li className="ap-tickets-empty">No survey yet. Add one, or drop one here.</li> : null}
                </ul>
                {!readOnly ? <Picker label="Add a survey" testid={`ap-card-${r.id}-add-survey`} placeholder="Search published surveys…" items={data.surveys.map((s) => ({ id: s.code, label: s.name, hint: `${s.summary ?? ''} · version ${s.label ?? s.version}`, icon: 'survey', disabled: surveys.some((x) => x.code === s.code), tag: surveys.some((x) => x.code === s.code) ? <Tag>already here</Tag> : undefined }))} onPick={(code) => { const s = data.surveys.find((x) => x.code === code); if (s) addSurvey(r.id, s); }} button={<span className="ap-btn quiet"><Icon name="plus" size={13} /> Add a survey</span>} /> : null}
                {res?.choice && res.choice.outcome !== 'CHOSEN' ? <p className="ap-card-choice-why" data-testid={`ap-card-${r.id}-choice`}><Icon name="warn" size={12} /> {res.choice.reason}</p> : null}
              </section>
            </div>

            <footer className="ap-card-foot">
              <div className="ap-replaces" data-testid={`ap-card-${r.id}-replaces`}>
                <Icon name="replace" size={14} />
                {r.replaces.length ? <><span>Replaces</span>{r.replaces.map((t) => <span key={t} className="ap-chip replace">{policy.requirements.find((x) => x.id === t)?.name ?? t}{!readOnly ? <button type="button" aria-label="Stop replacing it" onClick={(e) => { e.stopPropagation(); req('Stop replacing a requirement', r.id, (x) => { x.replaces = x.replaces.filter((y) => y !== t); }); }}><Icon name="x" size={11} /></button> : null}</span>)}</> : <span className="ap-quiet">Adds to the others; replaces nothing</span>}
                {!readOnly && others.length ? <Picker label="Replace another requirement" testid={`ap-card-${r.id}-replace`} placeholder="Search requirements…" items={others.map((o) => ({ id: o.id, label: o.name, hint: 'When this one applies, that one will not contribute', icon: 'replace', disabled: r.replaces.includes(o.id) }))} onPick={(t) => req('Replace a requirement', r.id, (x) => { x.replaces.push(t); })} button={<span className="ap-linkbtn"><Icon name="plus" size={12} /> Replace a requirement</span>} /> : null}
              </div>
              {replacedBy.length ? <span className="ap-replaced-by"><Icon name="info" size={13} /> Replaced by {replacedBy.map((x) => x.name).join(', ')} whenever {replacedBy.length === 1 ? 'it applies' : 'one of them applies'}</span> : null}
            </footer>
            {mine.filter((d) => !(d.at?.part === 'when' && d.at?.path !== undefined)).length ? <ul className="ap-issues block">{mine.filter((d) => !(d.at?.part === 'when' && d.at?.path !== undefined)).map((d, n) => <li key={n} className={d.severity.toLowerCase()} data-testid={`ap-card-${r.id}-issue-${d.code}`}><Icon name={d.severity === 'INFO' ? 'info' : 'warn'} size={12} /> {d.message}</li>)}</ul> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** The governed delivery order: where each survey goes in the call, never whether it is required. */
export function DeliveryOrder({ policy, readOnly, plan }: { policy: Policy; readOnly?: boolean; plan?: Plan }) {
  const { data, update } = useAppl();
  const named = new Map<string, SurveyRef>();
  policy.requirements.forEach((r) => (r.action.kind === 'INCLUDE' ? r.action.surveys : r.action.alternatives.map((a) => a.survey)).forEach((s) => named.set(s.code, s)));
  const move = (i: number, by: number) => update('Change the delivery order', (d) => editPolicy(d, policy.code, (p) => { p.order.splice(i + by, 0, p.order.splice(i, 1)[0]!); }));
  const onDrop = (e: DragEvent, to: number) => { const from = Number(e.dataTransfer.getData('text/x-order')); if (Number.isNaN(from) || readOnly) return; e.preventDefault(); update('Change the delivery order', (d) => editPolicy(d, policy.code, (p) => { p.order.splice(to, 0, p.order.splice(from, 1)[0]!); })); };
  const missing = [...named.keys()].filter((c) => !policy.order.includes(c));
  return (
    <section className="ap-order" data-testid="ap-order" aria-label="Delivery order">
      <header><h3><Icon name="order" size={15} /> Delivery order</h3><p>The order in which required surveys are delivered. It never decides <em>whether</em> a survey is required.</p></header>
      <ol>
        {policy.order.map((code, i) => { const s = named.get(code) ?? data.surveys.find((x) => x.code === code); const sel = plan?.selected.find((x) => x.survey.code === code); return (
          <li key={code} draggable={!readOnly} onDragStart={(e) => e.dataTransfer.setData('text/x-order', String(i))} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, i)} className={`${sel ? 'selected' : ''}${named.has(code) ? '' : ' unused'}`} data-testid={`ap-order-${code}`}>
            <span className="ap-order-n">{i + 1}</span><span className="ap-order-name">{s?.name ?? code}{named.has(code) ? '' : ' (no requirement names it)'}</span>
            {!readOnly ? <span className="ap-order-tools"><button type="button" className="ap-iconbtn" aria-label={`Move ${s?.name ?? code} earlier`} disabled={i === 0} onClick={() => move(i, -1)} data-testid={`ap-order-${code}-up`}><Icon name="up" size={13} /></button><button type="button" className="ap-iconbtn" aria-label={`Move ${s?.name ?? code} later`} disabled={i === policy.order.length - 1} onClick={() => move(i, 1)} data-testid={`ap-order-${code}-down`}><Icon name="down" size={13} /></button></span> : null}
          </li>
        ); })}
      </ol>
      {missing.length ? <p className="ap-field-error" data-testid="ap-order-missing"><Icon name="warn" size={12} /> {missing.map((c) => named.get(c)?.name).join(', ')} {missing.length === 1 ? 'has' : 'have'} no place in the order. {!readOnly ? <button type="button" className="ap-linkbtn" onClick={() => update('Add surveys to the delivery order', (d) => editPolicy(d, policy.code, (p) => { p.order.push(...missing); }))}>Add at the end</button> : null}</p> : null}
    </section>
  );
}
