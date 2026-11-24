// Survey Applicability (APPL-X1) — the Smart Card Composer: one card per requirement, "WHEN condition → THEN surveys".
// Cards are reordered by dragging the handle or with the move buttons; surveys and conditions can be dropped onto a
// card from the palette or added with the pickers. The live result on each card comes from the Python evaluator.
import { shortName } from './usage';
import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { sentence } from './model/describe';
import { OUTCOME_WORD, OutcomeMark } from './plan';
import type { Diagnostic, Expr, Plan, Policy, Requirement, SurveyRef } from './model/types';
import { editPolicy, newId, useAppl } from './store';
import { SurveyTicket } from './SurveyPicker';
import { Icon, Tag, TriMark } from './ui';

export const DRAG = 'application/x-call360-applicability';
export type Dropped = { kind: 'survey' | 'condition' | 'variable' | 'requirement'; id: string };
export const dragData = (e: DragEvent, d: Dropped) => { e.dataTransfer.setData(DRAG, JSON.stringify(d)); e.dataTransfer.effectAllowed = 'copyMove'; };
const read = (e: DragEvent): Dropped | null => { try { return JSON.parse(e.dataTransfer.getData(DRAG)) as Dropped; } catch { return null; } };
const and = (when: Expr | null, extra: Expr): Expr => (!when ? extra : when.op === 'all' ? { ...when, args: [...when.args, extra] } : { op: 'all', args: [when, extra] });

interface Props {
  policy: Policy; plan?: Plan; diagnostics: Diagnostic[]; selected: string | null; onSelect: (id: string | null) => void;
  onSurvey: (code: string) => void; onEdit: (id: string) => void; readOnly?: boolean; activeSurvey?: string | null;
  /** APPL-X3: what a requirement depends on that needs attention (drafts, changed, newer versions) */
  deps?: (id: string) => ReactNode;
}
type Filter = 'all' | 'applies' | 'undecided' | 'problems';
type Grouping = 'none' | 'survey' | 'outcome';

/** A requirement as one sentence: WHEN [condition] → THEN [published surveys]. */
export function DesignerCards({ policy, plan, diagnostics, selected, onSelect, onSurvey, onEdit, readOnly, activeSurvey, deps }: Props) {
  const { data, update, look, say, setPreview } = useAppl();
  const [over, setOver] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [grouping, setGrouping] = useState<Grouping>('none');
  const big = policy.requirements.length > 8;
  // on a large policy every card starts as one line; any card can be opened, and all can be opened or closed at once
  const [openIds, setOpenIds] = useState<Set<string> | 'all'>(() => (big ? new Set() : 'all'));
  useEffect(() => { if (selected && openIds !== 'all' && !openIds.has(selected)) setOpenIds(new Set(openIds).add(selected)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  const isOpen = (id: string) => openIds === 'all' || openIds.has(id);
  const toggle = (id: string) => setOpenIds((o) => { const n = new Set(o === 'all' ? policy.requirements.map((r) => r.id) : o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const change = (label: string, f: (p: Policy) => void) => update(label, (d) => editPolicy(d, policy.code, f));
  const req = (label: string, id: string, f: (r: Requirement, p: Policy) => void) => change(label, (p) => { const r = p.requirements.find((x) => x.id === id); if (r) f(r, p); });
  const addSurvey = (id: string, s: SurveyRef) => req(`Link ${shortName(s.name)}`, id, (r, p) => {
    if (r.action.kind === 'INCLUDE') { if (!r.action.surveys.some((x) => x.code === s.code)) r.action.surveys.push(s); } else if (!r.action.alternatives.some((a) => a.survey.code === s.code)) r.action.alternatives.push({ survey: s, when: null });
    if (!p.order.includes(s.code)) p.order.push(s.code);
  });
  const drop = (e: DragEvent, r: Requirement) => {
    const d = read(e); setOver(null); if (!d || readOnly) return; e.preventDefault(); e.stopPropagation();
    if (d.kind === 'requirement') { if (d.id !== r.id) change('Reorder requirements', (p) => { const from = p.requirements.findIndex((x) => x.id === d.id), to = p.requirements.findIndex((x) => x.id === r.id); const [m] = p.requirements.splice(from, 1); p.requirements.splice(to, 0, m!); }); return; }
    if (d.kind === 'survey') { const s = data.surveys.find((x) => x.code === d.id); if (s) addSurvey(r.id, s); return; }
    if (d.kind === 'condition') { const c = look.condition(d.id); if (c) { req(`Add “${c.name}” to a condition`, r.id, (x) => { x.when = and(x.when, { op: 'ref', condition: c.code, version: c.version }); }); say(`“${c.name}” added to the condition`); } }
    if (d.kind === 'variable') { const v = look.variable(d.id); if (v) req(`Add ${v.name} to a condition`, r.id, (x) => { x.when = and(x.when, v.type === 'BOOLEAN' ? { op: 'test', variable: v.code, operator: 'is_true' } : { op: 'test', variable: v.code, operator: 'is_known' }); }); }
  };
  const outcome = (id: string) => plan?.requirements.find((x) => x.id === id);
  const problems = (id: string) => diagnostics.filter((d) => d.at?.kind === 'requirement' && d.at?.id === id);
  const k = q.trim().toLowerCase();
  const shown = policy.requirements.filter((r) => {
    const o = outcome(r.id)?.outcome;
    if (filter === 'applies' && o !== 'ACTIVE') return false;
    if (filter === 'undecided' && !['UNRESOLVED', 'PENDING', 'AMBIGUOUS', 'NO_ALTERNATIVE', 'CHOICE_UNRESOLVED'].includes(o ?? '')) return false;
    if (filter === 'problems' && !problems(r.id).some((d) => d.severity !== 'INFO')) return false;
    return !k || `${r.name} ${sentence(r.when, look)} ${(r.action.kind === 'INCLUDE' ? r.action.surveys : r.action.alternatives.map((a) => a.survey)).map((s) => s.name).join(' ')}`.toLowerCase().includes(k);
  });
  const keyOf = (r: Requirement) => (grouping === 'survey' ? (r.action.kind === 'INCLUDE' ? r.action.surveys : r.action.alternatives.map((a) => a.survey)).map((s) => shortName(s.name)).join(' + ') || 'No survey yet' : grouping === 'outcome' ? (outcome(r.id) ? OUTCOME_WORD[outcome(r.id)!.outcome] : 'Not previewed') : '');
  const groups = new Map<string, Requirement[]>();
  shown.forEach((r) => groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]));
  if (!policy.requirements.length) return null;
  const index = (id: string) => policy.requirements.findIndex((x) => x.id === id);
  return (
    <div className="ap-composer-cards">
      {big || q || filter !== 'all' ? (
        <div className="ap-toolbar ap-cards-bar" data-testid="ap-cards-bar">
          <label className="ap-searchbox"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a requirement, a condition or a survey" aria-label="Find a requirement" data-testid="ap-cards-search" /></label>
          <select className="ap-input" aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} data-testid="ap-cards-filter"><option value="all">All requirements</option><option value="applies">Applies in the preview</option><option value="undecided">Not decided in the preview</option><option value="problems">Has something to fix</option></select>
          <select className="ap-input" aria-label="Group by" value={grouping} onChange={(e) => setGrouping(e.target.value as Grouping)} data-testid="ap-cards-group"><option value="none">No grouping</option><option value="survey">Group by survey</option><option value="outcome">Group by preview outcome</option></select>
          <button type="button" className="ap-btn quiet" onClick={() => setOpenIds(openIds === 'all' ? new Set() : 'all')} data-testid="ap-cards-collapse">{openIds === 'all' ? 'Collapse all' : 'Expand all'}</button>
          <span className="ap-count" data-testid="ap-cards-count">{shown.length} of {policy.requirements.length}</span>
        </div>
      ) : null}
      {!shown.length ? <p className="ap-quiet ap-cards-none">No requirement matches. <button type="button" className="ap-linkbtn" onClick={() => { setQ(''); setFilter('all'); }}>Show all</button></p> : null}
      {[...groups.entries()].map(([label, list]) => (
        <section key={label || 'all'} className="ap-cards-group">
          {label ? <h3 className="ap-cards-grouphead">{label} <span className="ap-count">{list.length}</span></h3> : null}
          <ol className="ap-cards" data-testid="ap-cards">
            {list.map((r) => {
              const i = index(r.id);
              const res = outcome(r.id);
              const mine = problems(r.id);
              const surveys = r.action.kind === 'INCLUDE' ? r.action.surveys : r.action.alternatives.map((a) => a.survey);
              const lit = !!activeSurvey && surveys.some((s) => s.code === activeSurvey);
              const replacedBy = policy.requirements.filter((x) => x.replaces.includes(r.id));
              const open = isOpen(r.id);
              const saved = r.when?.op === 'ref' ? look.condition(r.when.condition) : undefined;
              return (
                <li key={r.id} className={`ap-card${open ? '' : ' closed'}${selected === r.id ? ' on' : ''}${over === r.id ? ' over' : ''}${res ? ` is-${res.outcome.toLowerCase()}` : ''}${lit ? ' lit' : ''}${activeSurvey && !lit ? ' dim' : ''}`} data-testid={`ap-card-${r.id}`} data-outcome={res?.outcome} data-open={open}
                  onClick={() => onSelect(r.id)} onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setOver(r.id); } }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, r)}>
                  <header className="ap-card-head">
                    {!readOnly ? <span className="ap-card-grip" draggable onDragStart={(e) => dragData(e, { kind: 'requirement', id: r.id })} title="Drag to reorder" aria-hidden="true"><Icon name="grip" /></span> : null}
                    <button type="button" className="ap-card-toggle" aria-expanded={open} aria-label={open ? 'Show as one line' : 'Show the whole card'} onClick={(e) => { e.stopPropagation(); toggle(r.id); }} data-testid={`ap-card-${r.id}-toggle`}><Icon name={open ? 'down' : 'right'} size={14} /></button>
                    <span className="ap-card-n">{i + 1}</span>
                    <span className="ap-card-title" data-testid={`ap-card-${r.id}-name`}>{r.name}</span>
                    {deps?.(r.id)}
                    {!open ? <span className="ap-card-oneline"><span className="ap-sentence-cond">{sentence(r.when, look)}</span><Icon name="arrow" size={13} /><span className="ap-sentence-surveys">{surveys.map((s) => shortName(s.name)).join(r.action.kind === 'CHOOSE_ONE' ? ' or ' : ', ') || 'no survey yet'}</span></span> : null}
                    {mine.some((d) => d.severity === 'BLOCKER') ? <Tag tone="bad" testid={`ap-card-${r.id}-blocked`}>to fix</Tag> : null}
                    <span className="ap-card-live" aria-live="polite"><OutcomeMark r={res} small={!open} /></span>
                    {!readOnly ? (
                      <span className="ap-card-tools">
                        <button type="button" className="ap-iconbtn" aria-label="Move this requirement up" disabled={i === 0} data-testid={`ap-card-${r.id}-up`} onClick={(e) => { e.stopPropagation(); change('Move a requirement up', (p) => { p.requirements.splice(i - 1, 0, p.requirements.splice(i, 1)[0]!); }); }}><Icon name="up" size={14} /></button>
                        <button type="button" className="ap-iconbtn" aria-label="Move this requirement down" disabled={i === policy.requirements.length - 1} data-testid={`ap-card-${r.id}-down`} onClick={(e) => { e.stopPropagation(); change('Move a requirement down', (p) => { p.requirements.splice(i + 1, 0, p.requirements.splice(i, 1)[0]!); }); }}><Icon name="down" size={14} /></button>
                        <button type="button" className="ap-iconbtn" aria-label="Duplicate this requirement" data-testid={`ap-card-${r.id}-duplicate`} onClick={(e) => { e.stopPropagation(); change(`Duplicate “${r.name}”`, (p) => { const id = newId('r', p.requirements.map((x) => x.id)); p.requirements.splice(i + 1, 0, { ...structuredClone(r), id, name: `${r.name} (copy)`, replaces: [] }); }); }}><Icon name="copy" size={14} /></button>
                        <button type="button" className="ap-iconbtn" aria-label="Remove this requirement" data-testid={`ap-card-${r.id}-remove`} onClick={(e) => { e.stopPropagation(); change(`Remove “${r.name}”`, (p) => { p.requirements = p.requirements.filter((x) => x.id !== r.id); p.requirements.forEach((x) => { x.replaces = x.replaces.filter((t) => t !== r.id); }); p.shared_deliveries = p.shared_deliveries.map((d) => ({ ...d, requirements: d.requirements.filter((t) => t !== r.id) })).filter((d) => d.requirements.length > 1); }); onSelect(null); }}><Icon name="trash" size={14} /></button>
                      </span>
                    ) : null}
                    {!readOnly ? <button type="button" className="ap-btn" onClick={(e) => { e.stopPropagation(); onSelect(r.id); onEdit(r.id); }} data-testid={`ap-card-${r.id}-edit`}>Edit</button> : null}
                  </header>
                  {open ? (
                    <>
                      <div className="ap-card-body">
                        <section className="ap-when" aria-label="When" data-testid={`ap-card-${r.id}-when`}>
                          <h3><span className="ap-when-word">When</span></h3>
                          <div className="ap-cond-summary" data-testid={`ap-card-${r.id}-summary`}>
                            <p className="ap-cond-says">{r.when ? sentence(saved ? (saved.history?.find((h) => r.when?.op === 'ref' && h.version === r.when.version)?.expr ?? saved.expr) : r.when, look) : 'Always — every application this policy covers'}</p>
                            <div className="ap-cond-foot">
                              {saved && r.when?.op === 'ref' ? <span className="ap-chip cond" title={`Saved condition, version ${r.when.version}`}><Icon name="condition" size={13} /> {saved.name} · v{r.when.version}</span> : null}
                              {res && r.when ? <TriMark value={res.trace.result} small word={res.trace.result === 'TRUE' ? 'True in the preview' : res.trace.result === 'FALSE' ? 'False in the preview' : 'Not known in the preview'} /> : null}
                            </div>
                            {res?.needs.length && res.trace.result === 'UNKNOWN' ? <p className="ap-cond-needs"><Icon name="question" size={12} /> {res.needs.map((n) => `${n.name}: ${n.reason}`).join('; ')}</p> : null}
                          </div>
                        </section>
                        <span className="ap-seam" aria-hidden="true"><Icon name="arrow" size={18} /></span>
                        <section className="ap-then" aria-label="Then" data-testid={`ap-card-${r.id}-then`}>
                          <h3><span className="ap-then-word">Then</span><span className="ap-then-kind">{r.action.kind === 'CHOOSE_ONE' ? 'exactly one of' : surveys.length > 1 ? 'all of' : 'include'}</span></h3>
                          <ul className="ap-tickets">
                            {surveys.map((s, si) => { const alt = r.action.kind === 'CHOOSE_ONE' ? r.action.alternatives[si] : null; const live = res?.choice?.alternatives[si]; return (
                              <li key={s.code} className={`${activeSurvey === s.code ? 'on' : ''}${live?.chosen ? ' chosen' : ''}`} data-testid={`ap-card-${r.id}-survey-${s.code}`}>
                                <SurveyTicket survey={s} onOpen={() => { onSurvey(s.code); setPreview(s); }} testid={`ap-card-${r.id}-ticket-${s.code}`} note={alt ? (alt.fallback ? 'the fallback' : alt.when ? `when ${sentence(alt.when, look)}` : 'needs a criterion') : undefined} />
                              </li>
                            ); })}
                            {!surveys.length ? <li className="ap-tickets-empty">No survey linked yet.{!readOnly ? <> <button type="button" className="ap-linkbtn" onClick={(e) => { e.stopPropagation(); onEdit(r.id); }}>Add a published survey</button></> : null}</li> : null}
                          </ul>
                          {res?.choice && res.choice.outcome !== 'CHOSEN' ? <p className="ap-card-choice-why" data-testid={`ap-card-${r.id}-choice`}><Icon name="warn" size={12} /> {res.choice.reason}</p> : null}
                        </section>
                      </div>
                      {r.replaces.length || replacedBy.length ? (
                        <footer className="ap-card-foot">
                          {r.replaces.length ? <div className="ap-replaces" data-testid={`ap-card-${r.id}-replaces`}><Icon name="replace" size={14} /><span>Replaces</span>{r.replaces.map((t) => <span key={t} className="ap-chip replace">{policy.requirements.find((x) => x.id === t)?.name ?? t}</span>)}</div> : null}
                          {replacedBy.length ? <span className="ap-replaced-by"><Icon name="info" size={13} /> Replaced by {replacedBy.map((x) => x.name).join(', ')} whenever {replacedBy.length === 1 ? 'it applies' : 'one of them applies'}</span> : null}
                        </footer>
                      ) : null}
                      {mine.length ? <ul className="ap-issues block">{mine.map((d, n) => <li key={n} className={d.severity.toLowerCase()} data-testid={`ap-card-${r.id}-issue-${d.code}`}><Icon name={d.severity === 'INFO' ? 'info' : 'warn'} size={12} /> {d.message}</li>)}</ul> : null}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
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
