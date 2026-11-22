// Survey Studio (UX-HOME-1) — the inspector: one published building block, complete, without opening an editor.
// READ ONLY. It shows the published document the library already serves (the same one the composer pins): every step,
// its exact wording, answers and validation, every branch and where it leads, the conditions it uses and what they
// evaluate, how it is entered and left in each survey that uses it, the exact versions it depends on, who uses it,
// and its published revisions. Nothing here is a second registry: it is the component library, laid out to be read.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { FIELDS } from '../model/sample';
import { Glyph, Tag, type GlyphName } from '../ui';
import { getComponent, type ComponentDetail, type ComponentKind, type SurveySummary } from './api';
import { useDialogFocus } from './focus';
import { differences } from './Library';
import { getModule, type ModuleSummary } from './moduleApi';
import { short } from './reviewApi';
import { MODULE_CATEGORY, answerOf, branchLabel, candidateRecord, destination, missing, ruleInWords, versionContent, versionRecord, words } from './workspaceApi';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- published documents are read as JSON
export type Inspect = { kind: ComponentKind; code: string; version: number; wording?: number | null };
export const inspectParam = (c: Inspect) => [c.kind, c.code, c.version, ...(c.wording ? [c.wording] : [])].join('~');
export const parseInspect = (s: string | null): Inspect | null => {
  const [kind, code, version, wording] = (s ?? '').split('~');
  return kind && code && Number(version) > 0 && ['MODULE', 'ITEM', 'CONDITION', 'OPTION_SET'].includes(kind) ? { kind: kind as ComponentKind, code, version: Number(version), wording: wording ? Number(wording) : null } : null;
};
const KIND: Record<ComponentKind, string> = { MODULE: 'Module', ITEM: 'Question', CONDITION: 'Condition', OPTION_SET: 'Answer set' };
const fieldLabel = (f: string) => FIELDS.find((x) => x.code === f)?.label ?? f;
const say = (e: unknown) => (e instanceof ApiFailure ? (e.status === 404 ? 'This block is not published in a market you can read.' : e.message) : 'The library could not be reached.');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- a published module as steps and links ----------------------------------------------------------------------------
interface Step { node: string; n: number; type: 'QUESTION' | 'STATEMENT' | 'DECISION'; title: string; item: Any; wording: Any; options: Any[]; condition: Any; binding: Any; routing: Any; entry: boolean; ref: Any }
interface Arrow { from: string; to: Any; label: string; soft?: boolean; /** what in the published document makes this branch */ why: string }
export function read(d: ComponentDetail): { steps: Step[]; arrows: Arrow[]; outcomes: string[]; name: (node: string) => string } {
  const doc = d.document as Any;
  const dep = (kind: string, code: string, version: number) => d.dependencies.find((x) => x.kind === kind && x.code === code && x.version === version)?.document as Any;
  const steps: Step[] = ((doc.nodes ?? []) as Any[]).map((n, i) => {
    const ref = n.item ?? n.question ?? null;
    const item = ref ? dep('ITEM', ref.code, ref.version) : null;
    const wording = ref ? dep('WORDING', ref.code, ref.wording_version) : null;
    const os = item?.option_set ? dep('OPTION_SET', item.option_set.code, item.option_set.version) : null;
    const condition = n.binding ? dep('CONDITION', n.binding.condition.code, n.binding.condition.version) : null;
    const type = n.type === 'DECISION' ? 'DECISION' : item?.answer_type === 'STATEMENT' || n.type === 'STATEMENT' ? 'STATEMENT' : 'QUESTION';
    return { node: n.node, n: i + 1, type, title: type === 'DECISION' ? (condition?.name ?? 'Decision') : String(wording?.text ?? item?.intent ?? 'Untitled step'), item, wording, options: (os?.options ?? []) as Any[], condition, binding: n.binding ?? null, routing: n.routing ?? null, entry: doc.entry === n.node, ref };
  });
  const byNode = new Map(steps.map((s) => [s.node, s]));
  const name = (node: string) => { const s = byNode.get(node); return s ? `step ${s.n}` : `step “${node}”`; };
  const arrows: Arrow[] = [];
  for (const s of steps) {
    const label = (code: string) => s.options.find((o) => o.code === code)?.label ?? words(code);
    for (const e of ((doc.edges ?? []) as Any[]).filter((x) => x.from === s.node)) {
      const on = String(e.on);
      const why = on === 'ANY' || on === 'AFTER_CAPTURE' ? `Link ${e.edge ?? ''}: taken whatever is answered or said at this step.`
        : ['MATCH', 'NO_MATCH', 'UNKNOWN'].includes(on) ? `Link ${e.edge ?? ''}: the result “${on === 'MATCH' ? 'met' : on === 'NO_MATCH' ? 'not met' : 'cannot be decided'}” of the condition ${s.condition?.name ?? s.binding?.condition?.code ?? ''}${s.binding?.condition ? ` (${s.binding.condition.code} version ${s.binding.condition.version})` : ''}.`
          : `Link ${e.edge ?? ''}: the answer “${label(on)}” (option ${on}) of this question’s answer set${s.item?.option_set ? ` ${s.item.option_set.code} version ${s.item.option_set.version}` : ''}.`;
      arrows.push({ from: s.node, to: e.to, label: branchLabel(on, label), why });
    }
    const r = s.routing ?? {};
    ((r.rules ?? []) as Any[]).forEach((rule, i) => arrows.push({ from: s.node, to: rule.to, label: `Rule ${i + 1}: ${rule.when?.kind === 'ALL' ? 'all of' : 'any of'} ${((rule.when?.options ?? []) as string[]).map((o) => `“${label(o)}”`).join(', ')} chosen`, why: `Routing rule ${rule.rule ?? i + 1} of this question, tried in order: the first rule that holds is taken.` }));
    if (r.fallback) arrows.push({ from: s.node, to: r.fallback, label: 'Otherwise', why: 'The fallback of this question’s ordered routing: taken when no rule holds.' });
    for (const f of (r.followups ?? []) as Any[]) for (const node of (f.nodes ?? []) as string[]) arrows.push({ from: s.node, to: { node }, label: `Follow-up if “${label(f.option)}”`, soft: true, why: `A follow-up question queued when “${label(f.option)}” (option ${f.option}) is among the answers${f.priority !== undefined ? `, priority ${f.priority}` : ''}. Follow-ups are asked one after another, then the survey rejoins.` });
    for (const x of (r.interrupts ?? []) as Any[]) arrows.push({ from: s.node, to: x.outcome ? { outcome: x.outcome } : x.to, label: `Stops if “${label(x.option)}”`, why: `An interruption: when “${label(x.option)}” (option ${x.option}) is among the answers, no follow-up is asked.` });
    if (r.rejoin) arrows.push({ from: s.node, to: r.rejoin, label: 'After the follow-ups', why: 'The rejoin point of this question’s follow-ups.' });
    if (r.empty_fallback && JSON.stringify(r.empty_fallback) !== JSON.stringify(r.rejoin)) arrows.push({ from: s.node, to: r.empty_fallback, label: 'If no follow-up applies', why: 'Where this question leads when none of its follow-ups applies.' });
  }
  return { steps, arrows, outcomes: (doc.outcomes ?? []) as string[], name };
}

// ---- the execution graph ----------------------------------------------------------------------------------------------
const W = 216, H = 74, GX = 36, GY = 60;
function Graph({ steps, arrows, outcomes, selected, onSelect, branch, onBranch }: { steps: Step[]; arrows: Arrow[]; outcomes: string[]; selected: string | null; onSelect: (node: string) => void; branch: string | null; onBranch: (key: string) => void }) {
  const g = useMemo(() => {
    const entry = steps.find((s) => s.entry) ?? steps[0];
    const level = new Map<string, number>();
    const queue: string[] = entry ? [entry.node] : [];
    if (entry) level.set(entry.node, 0);
    while (queue.length) { const at = queue.shift() as string; for (const a of arrows.filter((x) => x.from === at && x.to?.node)) if (!level.has(a.to.node)) { level.set(a.to.node, (level.get(at) ?? 0) + 1); queue.push(a.to.node); } }
    let deepest = Math.max(0, ...level.values());
    for (const s of steps) if (!level.has(s.node)) level.set(s.node, ++deepest); // not reached from the first step: still shown
    const ends = [...new Set([...outcomes, ...arrows.filter((a) => a.to?.outcome).map((a) => String(a.to.outcome))])];
    const rows: string[][] = [];
    for (const s of steps) (rows[level.get(s.node) as number] ??= []).push(s.node);
    rows.push(ends.map((o) => `end:${o}`));
    const widest = Math.max(1, ...rows.map((r) => (r ?? []).length));
    const width = widest * W + (widest - 1) * GX;
    const at = new Map<string, { x: number; y: number }>();
    rows.forEach((r, y) => (r ?? []).forEach((id, i) => { const span = r.length * W + (r.length - 1) * GX; at.set(id, { x: (width - span) / 2 + i * (W + GX), y: y * (H + GY) }); }));
    const merged = new Map<string, { from: string; to: string; labels: string[]; soft: boolean }>();
    for (const a of arrows) {
      const to = a.to?.node ? String(a.to.node) : a.to?.outcome ? `end:${a.to.outcome}` : null;
      if (!to || !at.has(to)) continue; // "back to the asker" is said on the step, not drawn
      const k = `${a.from}>${to}`;
      const m = merged.get(k) ?? { from: a.from, to, labels: [], soft: !!a.soft };
      m.labels.push(a.label); merged.set(k, m);
    }
    // a link to the very next row is drawn straight down; any other (a jump over rows, or back up) goes round the
    // right-hand side in its own lane, so that no line runs behind a step it does not touch
    let lanes = 0;
    const edges = [...merged.values()].map((e) => { const a = at.get(e.from)!, b = at.get(e.to)!; const direct = b.y - a.y === H + GY; return { ...e, lane: direct ? -1 : lanes++ }; });
    return { at, ends, width, lanes, full: width + (lanes ? 36 + lanes * 22 : 0), height: rows.length * (H + GY) - GY, edges };
  }, [steps, arrows, outcomes]);
  const hot = (e: { from: string; to: string }) => branch === `${e.from}>${e.to}` || (branch === null && selected !== null && (e.from === selected || e.to === selected));
  return (
    <div className="ss-in-graph-scroll" data-testid="ss-in-graph">
      <div className="ss-in-graph" style={{ width: g.full, height: g.height }} data-lanes={g.lanes}>
        <svg width={g.full} height={g.height} aria-hidden="true">
          <defs>
            <marker id="ss-in-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="ss-in-arrowhead" /></marker>
            <marker id="ss-in-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="ss-in-arrowhead hot" /></marker>
          </defs>
          {g.edges.map((e) => {
            const a = g.at.get(e.from), b = g.at.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + W / 2, x2 = b.x + W / 2, ya = a.y + H / 2, yb = b.y + H / 2;
            const side = g.width + 28 + e.lane * 22;
            const path = e.lane < 0 ? `M${x1} ${a.y + H} C${x1} ${a.y + H + GY / 2} ${x2} ${b.y - GY / 2} ${x2} ${b.y - 2}`
              : `M${a.x + W} ${ya} L${side - 10} ${ya} Q${side} ${ya} ${side} ${ya + (yb > ya ? 10 : -10)} L${side} ${yb + (yb > ya ? -10 : 10)} Q${side} ${yb} ${side - 10} ${yb} L${b.x + W + 2} ${yb}`;
            return <path key={`${e.from}>${e.to}`} d={path} className={`ss-in-edge ${e.soft ? 'soft' : ''} ${hot(e) ? 'hot' : ''}`} markerEnd={`url(#ss-in-arrow${hot(e) ? '-hot' : ''})`} data-from={e.from} data-to={e.to} />;
          })}
        </svg>
        {g.edges.map((e) => {
          const a = g.at.get(e.from), b = g.at.get(e.to);
          if (!a || !b) return null;
          const x = e.lane < 0 ? (a.x + b.x) / 2 + W / 2 : a.x + W + 46, y = e.lane < 0 ? (a.y + H + b.y) / 2 : a.y + H / 2 - 11;
          return <button type="button" key={`l${e.from}>${e.to}`} className={`ss-in-edge-label ${hot(e) ? 'hot' : ''}`} style={{ left: x, top: y }} title={e.labels.join(' · ')} onClick={() => onBranch(`${e.from}>${e.to}`)} aria-pressed={branch === `${e.from}>${e.to}`} data-testid={`ss-in-branch-${e.from}-${e.to.replace(':', '-')}`}>{e.labels.length > 2 ? `${e.labels[0]} +${e.labels.length - 1}` : e.labels.join(' · ')}</button>;
        })}
        {steps.map((s) => {
          const p = g.at.get(s.node) as { x: number; y: number };
          return (
            <button key={s.node} type="button" className={`ss-in-node ${s.type.toLowerCase()} ${selected === s.node ? 'on' : ''}`} style={{ left: p.x, top: p.y, width: W, height: H }} onClick={() => onSelect(s.node)} aria-pressed={selected === s.node} data-testid={`ss-in-node-${s.node}`} data-type={s.type}>
              <span className="ss-in-node-kind"><b>{s.n}</b> {s.type === 'DECISION' ? 'Decision' : s.type === 'STATEMENT' ? 'Statement' : answerOf(s.item?.answer_type).label}{s.entry ? ' · starts here' : ''}</span>
              <span className="ss-in-node-text">{s.title}</span>
            </button>
          );
        })}
        {g.ends.map((o) => { const p = g.at.get(`end:${o}`) as { x: number; y: number }; return <span key={o} className={`ss-in-end ${o === 'COMPLETED' ? 'ok' : ''}`} style={{ left: p.x, top: p.y, width: W, height: H }} data-testid={`ss-in-end-${o}`}><Glyph name={o === 'COMPLETED' ? 'check' : 'stop'} size={14} /> Ends: {words(o)}</span>; })}
      </div>
    </div>
  );
}

function Section({ id, title, count, children, open = true }: { id: string; title: string; count?: number | string; children: ReactNode; open?: boolean }) {
  return (
    <details className="ss-in-section" open={open} data-testid={`ss-in-${id}`} id={`ss-in-${id}`}>
      <summary><h3>{title}</h3>{count !== undefined ? <span className="ss-in-count">{count}</span> : null}</summary>
      <div className="ss-in-section-body">{children}</div>
    </details>
  );
}

function Validation({ item, options }: { item: Any; options: Any[] }) {
  if (!item) return null;
  const rows: Array<[string, string]> = [];
  if (options.length) rows.push(['Answers', options.map((o) => `${o.label || o.code}${o.exclusive ? ' (cannot be combined)' : ''}${o.is_other ? ' (other, with text)' : ''}`).join(' · ')]);
  if (item.selection) rows.push(['How many may be chosen', `${item.selection.min} to ${item.selection.max}`]);
  if (item.number_rule) rows.push(['Number accepted', `${item.number_rule.integer ? 'a whole number' : 'a number'}${item.number_rule.min !== undefined ? `, from ${item.number_rule.min}` : ''}${item.number_rule.max !== undefined ? ` to ${item.number_rule.max}` : ''}${item.number_rule.unit ? ` ${words(item.number_rule.unit)}` : ''}`]);
  if (item.text_rule) rows.push(['Text accepted', `${item.text_rule.required ? 'required' : 'optional'}, ${item.text_rule.min_length} to ${item.text_rule.max_length} characters`]);
  if (item.answer_type === 'YES_NO' && !options.length) rows.push(['Answers', 'Yes · No']);
  if (item.answer_type === 'ACKNOWLEDGEMENT') rows.push(['Accepted', 'An acknowledgement. Declining it has no decided consequence: the survey stops as “policy unresolved”.']);
  if (item.response_obligation) rows.push(['Must it be answered', words(item.response_obligation)]);
  if (item.intent) rows.push(['What it establishes', String(item.intent)]);
  return rows.length ? <dl className="ss-in-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null;
}

function ConditionCard({ doc, binding }: { doc: Any; binding?: Any }) {
  if (!doc) return <p className="ss-muted">The condition’s document is not available.</p>;
  const params = Object.entries((doc.params ?? {}) as Record<string, Any>), inputs = Object.entries((doc.inputs ?? {}) as Record<string, Any>);
  return (
    <div className="ss-in-condition" data-testid={`ss-in-condition-${doc.code}`}>
      <p className="ss-in-rule"><Glyph name="branch" size={14} /> <span><strong>{doc.name}</strong> is met when {ruleInWords(doc.ast, fieldLabel)}.</span></p>
      {doc.description ? <p className="ss-muted">{doc.description}</p> : null}
      <dl className="ss-in-facts">
        {params.length ? <div><dt>Values supplied where it is used</dt><dd>{params.map(([k, v]) => `${k}${binding?.params && k in binding.params ? ` = ${String(binding.params[k])}` : ''} (${words(v.type)}${v.unit ? `, ${words(v.unit)}` : ''})`).join(' · ')}</dd></div> : null}
        {inputs.length ? <div><dt>Earlier answers it reads</dt><dd>{inputs.map(([k, v]) => `${k} (${answerOf(v.answer_type).label.toLowerCase()})`).join(' · ')}</dd></div> : null}
        {binding?.unknown_policy ? <div><dt>If it cannot be decided</dt><dd>{({ BLOCK: 'the survey does not start until the information is known', SKIP_WITH_REASON: 'the module is left out, and the reason is recorded', ROUTE_UNKNOWN: 'it follows its own “cannot be decided” branch' } as Record<string, string>)[binding.unknown_policy] ?? words(binding.unknown_policy)}</dd></div> : null}
        <div><dt>Its three results</dt><dd>Met · not met · unknown. Unknown is never read as “not met”.</dd></div>
      </dl>
    </div>
  );
}

function ItemBody({ d, onInspect }: { d: ComponentDetail; onInspect: (c: Inspect) => void }) {
  const doc = d.document as Any;
  const wording = d.dependencies.find((x) => x.kind === 'WORDING')?.document as Any;
  const os = d.dependencies.find((x) => x.kind === 'OPTION_SET');
  return (
    <>
      <blockquote className="ss-in-quote">“{String(wording?.text ?? d.title)}”</blockquote>
      <dl className="ss-in-facts"><div><dt>Kind of answer</dt><dd>{answerOf(doc.answer_type).label}</dd></div><div><dt>Wording</dt><dd>version {d.wording_version} · {words(wording?.delivery_mode)} · synthetic, unapproved</dd></div></dl>
      <Validation item={doc} options={((os?.document as Any)?.options ?? []) as Any[]} />
      {os ? <p><button type="button" className="ss-link" onClick={() => onInspect({ kind: 'OPTION_SET', code: os.code, version: os.version })}>Inspect its answer set</button></p> : null}
    </>
  );
}

function ConditionBody({ d }: { d: ComponentDetail }) {
  const reads = (((d.facts as Any).fields ?? []) as string[]);
  return <><ConditionCard doc={d.document} /><dl className="ss-in-facts"><div><dt>Reads</dt><dd>{reads.map(fieldLabel).join(' · ') || 'no customer or policy information'}</dd></div></dl></>;
}

function OptionSetBody({ d }: { d: ComponentDetail }) {
  return (
    <>
      <ul className="ss-in-options">{(((d.document as Any).options ?? []) as Any[]).map((o) => <li key={o.code}><strong>{o.label}</strong>{[o.exclusive ? 'cannot be combined' : '', o.is_other ? 'other, with text' : '', o.interrupt ? `stops the question: ${words(o.interrupt)}` : ''].filter(Boolean).map((t) => <Tag key={t}>{t}</Tag>)}</li>)}</ul>
    </>
  );
}

// ---- what the consuming surveys say about a block: how each enters and leaves it, and who governed its publication ----
interface Use { content: Any; record: Any; candidate: Any }
function useUses(d: ComponentDetail | null): Record<string, Use> {
  const [rows, setRows] = useState<Record<string, Use>>({});
  const key = (d?.published_in ?? []).map((u) => u.version_id).join(',');
  useEffect(() => {
    let current = true;
    setRows({});
    Promise.all((d?.published_in ?? []).map(async (u) => {
      const [content, record] = await Promise.all([versionContent(u.version_id), versionRecord(u.version_id)]);
      const candidate = !missing(record) && record.candidate_id ? await candidateRecord(String(record.candidate_id)) : null;
      return [u.version_id, { content: missing(content) ? null : content.content, record: missing(record) ? null : record, candidate: candidate && !missing(candidate) ? candidate : null }] as const;
    })).then((all) => { if (current) setRows(Object.fromEntries(all)); });
    return () => { current = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the versions are identified by key
  return rows;
}
const instancesOf = (use: Use | undefined, d: ComponentDetail) => (((use?.content?.sequence ?? []) as Any[]).filter((i) => i.module?.code === d.code && Number(i.module?.revision) === d.version));
const EVENT: Record<string, string> = { SUBMITTED: 'Submitted for review', APPROVED: 'Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn', PUBLISHED: 'Published', SUPERSEDED: 'Superseded by a newer version' };

function Governance({ use }: { use: Use | undefined }) {
  if (!use) return <p className="ss-muted">Loading its governance history…</p>;
  const events = [...(((use.candidate?.history ?? []) as Any[])), ...(((use.record?.history ?? []) as Any[]))].filter((e, i, all) => all.findIndex((x) => x.event === e.event && x.occurred_at === e.occurred_at) === i).sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
  if (!events.length) return <p className="ss-muted">Its governance history could not be read.</p>;
  return <ol className="ss-in-timeline" data-testid="ss-in-governance">{events.map((e, i) => <li key={i} data-event={e.event}><strong>{EVENT[e.event] ?? words(e.event)}</strong> by {e.actor_name ?? 'someone'}<span className="ss-muted"> · {new Date(e.occurred_at).toLocaleString()}{e.reason ? ` · “${e.reason}”` : ''}</span></li>)}</ol>;
}

function WhereUsed({ d, uses, unit, onInspect }: { d: ComponentDetail; uses: Record<string, Use>; unit: string; onInspect: (c: Inspect) => void }) {
  const { can } = useAuth();
  if (!d.published_in.length) return <p className="ss-muted">No published survey version pins this {unit.toLowerCase()}.</p>;
  return (
    <ul className="ss-in-consumers">
      {d.published_in.map((u) => {
        const use = uses[u.version_id];
        const instances = d.kind === 'MODULE' ? instancesOf(use, d) : [];
        return (
          <li key={u.version_id} data-testid={`ss-in-consumer-${u.survey_code}`} data-version={u.version_id}>
            <header>
              <div><strong>{u.survey_name}</strong><span className="ss-muted"> · version {u.version_label} · {words(u.version_status)} · pins {unit.toLowerCase()} {d.version}</span></div>
              <span className="ss-in-row-actions">
                <Link className="ss-btn small" to={`/survey-studio/surveys/${u.survey_code}/versions/${u.version_id}`}>Open the version</Link>
                <Link className="ss-btn small" to={`/survey-studio/surveys/${u.survey_code}`}>Open the survey</Link>
              </span>
            </header>
            {instances.map((i) => {
              const routes = (Array.isArray(i.routes) ? i.routes.map((x: Any) => [x.on, x.to]) : Object.entries(i.routes ?? {})) as Array<[string, Any]>;
              const cond = i.entry?.binding?.condition;
              return (
                <dl className="ss-in-facts" key={i.instance}>
                  <div><dt>Entered</dt><dd>{cond ? <>only when the condition <button type="button" className="ss-link" onClick={() => onInspect({ kind: 'CONDITION', code: cond.code, version: cond.version })}>{cond.code} version {cond.version}</button> is met{Object.keys(i.entry.binding.params ?? {}).length ? ` (${Object.entries(i.entry.binding.params).map(([k, v]) => `${k} = ${String(v)}`).join(', ')})` : ''}; if that cannot be decided: {words(i.entry.binding.unknown_policy)}</> : 'always, in its place in the survey'}</dd></div>
                  <div><dt>Left</dt><dd>{routes.map(([on, to]) => `${words(on)} → ${to === '@CONTINUE' ? 'the next module' : to?.survey_outcome ? `the survey ends: ${words(to.survey_outcome)}` : to?.instance ? `module ${to.instance}` : JSON.stringify(to)}`).join(' · ') || 'not stated'}</dd></div>
                  {can('survey.edit') ? <div><dt>Builder</dt><dd><Link to={`/survey-studio/surveys/${u.survey_code}/modules/${i.instance}`} data-testid={`ss-in-builder-${u.survey_code}`}>Open this module in the survey’s builder</Link><span className="ss-muted"> (the survey’s current draft)</span></dd></div> : null}
                </dl>
              );
            })}
            {use && d.kind === 'MODULE' && !use.content ? <p className="ss-muted">How this survey enters and leaves the module could not be read.</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

const SECTIONS: Record<ComponentKind, Array<[string, string]>> = {
  MODULE: [['overview', 'Overview'], ['questions', 'Questions'], ['logic', 'Logic'], ['rules', 'Rules'], ['dependencies', 'Dependencies'], ['where-used', 'Where used'], ['versions', 'Versions'], ['test', 'Test']],
  ITEM: [['overview', 'Overview'], ['content', 'Wording and answers'], ['dependencies', 'Dependencies'], ['where-used', 'Where used'], ['versions', 'Versions']],
  CONDITION: [['overview', 'Overview'], ['content', 'What it evaluates'], ['dependencies', 'Dependencies'], ['where-used', 'Where used'], ['versions', 'Versions']],
  OPTION_SET: [['overview', 'Overview'], ['content', 'Answers'], ['dependencies', 'Dependencies'], ['where-used', 'Where used'], ['versions', 'Versions']],
};

function ModuleLogic({ d, steps, arrows, outcomes, name, selected, pick, uses, onInspect }: { d: ComponentDetail; steps: Step[]; arrows: Arrow[]; outcomes: string[]; name: (n: string) => string; selected: string | null; pick: (n: string) => void; uses: Record<string, Use>; onInspect: (c: Inspect) => void }) {
  const [branch, setBranch] = useState<string | null>(null);
  const node = steps.find((s) => s.node === selected) ?? null;
  const picked = branch ? arrows.filter((a) => `${a.from}>${a.to?.node ? a.to.node : a.to?.outcome ? `end:${a.to.outcome}` : ''}` === branch) : [];
  const entries = d.published_in.flatMap((u) => instancesOf(uses[u.version_id], d).map((i) => ({ u, i }))).filter((x) => x.i.entry?.binding?.condition);
  return (
    <>
      <p className="ss-muted">Drawn from revision {d.version} as published. Select a step or a branch label to see exactly what makes it. Solid lines are branches; dashed lines are follow-up questions.</p>
      <dl className="ss-in-facts ss-in-entry" data-testid="ss-in-entry">
        <div><dt>Entry</dt><dd>{steps.find((s) => s.entry) ? <button type="button" className="ss-link" onClick={() => { setBranch(null); pick(steps.find((s) => s.entry)!.node); }}>step {steps.find((s) => s.entry)!.n}</button> : 'no first step is stated'}. A module has no entry condition of its own: each survey that uses it sets one, or none.</dd></div>
        {entries.length ? <div><dt>Entry conditions set by surveys</dt><dd>{entries.map(({ u, i }) => <span key={`${u.version_id}-${i.instance}`}>{u.survey_name}: <button type="button" className="ss-link" onClick={() => onInspect({ kind: 'CONDITION', code: i.entry.binding.condition.code, version: i.entry.binding.condition.version })}>{i.entry.binding.condition.code} version {i.entry.binding.condition.version}</button>. </span>)}</dd></div> : null}
        <div><dt>Exits</dt><dd>{outcomes.map(words).join(' · ') || 'no ending is stated'}. Where each ending leads is set by each survey (see “Where used”).</dd></div>
      </dl>
      <Graph steps={steps} arrows={arrows} outcomes={outcomes} selected={selected} onSelect={(n) => { setBranch(null); pick(n); }} branch={branch} onBranch={(k) => setBranch(branch === k ? null : k)} />
      {picked.length ? (
        <div className="ss-in-detail" data-testid="ss-in-branch-detail" role="status">
          <h4>Branch from {name(picked[0]!.from)} to {destination(picked[0]!.to, name)}</h4>
          <ul>{picked.map((a, i) => <li key={i}><strong>{a.label}.</strong> {a.why}</li>)}</ul>
          <p className="ss-muted">From “{steps.find((s) => s.node === picked[0]!.from)?.title}”.</p>
        </div>
      ) : node ? (
        <div className="ss-in-detail" data-testid="ss-in-node-detail" role="status">
          <h4>Step {node.n}: {node.type === 'DECISION' ? `Decision — ${node.title}` : `“${node.title}”`}</h4>
          {node.type === 'DECISION' ? <ConditionCard doc={node.condition} binding={node.binding} /> : <Validation item={node.item} options={node.options} />}
          <ul>{arrows.filter((a) => a.from === node.node).map((a, i) => <li key={i}><strong>{a.label}</strong> → {destination(a.to, name)}</li>)}</ul>
        </div>
      ) : null}
    </>
  );
}

const GLYPH: Record<ComponentKind, GlyphName> = { MODULE: 'flow', ITEM: 'text', CONDITION: 'branch', OPTION_SET: 'list' };

/** The drawer. `target` is what the address names; `onInspect` moves to another block; `onClose` closes it. */
export function InspectorDrawer({ target, surveys, markets = [], standalone = false, onInspect, onClose }: { target: Inspect; surveys: SurveySummary[]; markets?: string[]; /** LIB-2: this server offers modules authored on their own, and the test of one module. */ standalone?: boolean; onInspect: (c: Inspect) => void; onClose: () => void }) {
  const { can } = useAuth();
  const [d, setD] = useState<ComponentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ with: number; lines: string[] } | null>(null);
  const [reuse, setReuse] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const key = inspectParam(target);
  useEffect(() => {
    let current = true;
    setD(null); setError(null); setCompare(null); setReuse(false); setSelected(null);
    getComponent(target.kind, target.code, target.version, target.wording ?? undefined).then((x) => { if (current) setD(x); }).catch((e) => { if (current) setError(say(e)); });
    return () => { current = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the block is identified by key
  useDialogFocus(panel, onClose);
  const uses = useUses(d);
  const module = useMemo(() => (d && target.kind === 'MODULE' ? read(d) : null), [d, target.kind]);
  const showCompare = (v: number) => { if (d) getComponent(d.kind as ComponentKind, d.code, v).then((other) => setCompare({ with: v, lines: differences(d, other) })).catch((e) => setError(say(e))); };
  const jump = (id: string) => { const el = panel.current?.querySelector(`#ss-in-${id}`) as HTMLDetailsElement | null; if (el) { el.open = true; el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } };
  const pick = (node: string) => { setSelected(node); list.current?.querySelector(`[data-node="${CSS.escape(node)}"]`)?.scrollIntoView({ block: 'nearest' }); };
  const editable = surveys.filter((s) => !s.open_candidate_status);
  const facts = (d?.facts ?? {}) as Any;
  const unit = target.kind === 'MODULE' ? 'Revision' : 'Version';
  // LIB-2: a module published on its own has a publication record of its own, which is not a survey that uses it
  const own = d?.published_in.find((u) => u.artifact_kind === 'MODULE');
  const consumers = (d?.published_in ?? []).filter((u) => u.artifact_kind !== 'MODULE');
  const first = own ?? consumers[0];
  const firstSurvey = consumers[0];
  const origin = d?.origin ?? null;
  const alone = origin?.artifact_kind === 'MODULE';
  const [working, setWorking] = useState<ModuleSummary | null>(null);
  const originId = alone && target.kind === 'MODULE' ? origin!.definition_id : null;
  useEffect(() => {
    setWorking(null);
    if (!originId) return undefined;
    let current = true;
    getModule(originId).then((m) => { if (current && !missing(m)) setWorking(m); });
    return () => { current = false; };
  }, [originId]);
  const doc = (d?.document ?? {}) as Any;
  const conditions = (d?.dependencies ?? []).filter((x) => x.kind === 'CONDITION');
  const needs = ((d?.requires?.fields ?? []) as string[]);
  return (
    <div className="ss-in-scrim" data-testid="ss-in-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="ss-in" role="dialog" aria-modal="true" aria-labelledby="ss-in-title" tabIndex={-1} ref={panel} data-testid="ss-inspector" data-kind={target.kind} data-code={target.code} data-version={target.version} data-loaded={String(!!d)}>
        <header className="ss-in-head">
          <div className="ss-in-head-main">
            <p className="ss-in-kind"><Glyph name={GLYPH[target.kind]} size={14} /> Published {KIND[target.kind].toLowerCase()}{d && target.kind === 'MODULE' ? ` · ${MODULE_CATEGORY[d.category] ?? words(d.category)}` : ''}</p>
            <h2 id="ss-in-title" className="ss-title">{d ? (target.kind === 'ITEM' ? `“${d.title}”` : d.title) : error ? 'Not available' : 'Loading…'}</h2>
            {d ? (
              <p className="ss-in-meta" data-testid="ss-in-meta">
                <Tag tone={d.is_latest ? 'ok' : 'draft'}>{unit} {d.version}{d.is_latest ? ' · latest published' : ` · ${unit.toLowerCase()} ${d.latest_published_version} is newer`}</Tag>
                <Tag tone={d.used_by.surveys > 1 ? 'shared' : 'plain'}>Used by {plural(d.used_by.surveys, 'survey')}</Tag>
                {target.kind === 'MODULE' ? <><span className="ss-muted">{plural(facts.questions ?? 0, 'question')} · {plural(facts.statements ?? 0, 'statement')} · {plural(facts.decisions ?? 0, 'decision')}</span>{facts.branching ? <Tag tone="warn">Branches</Tag> : <Tag>No branching</Tag>}</> : null}
              </p>
            ) : null}
          </div>
          <button type="button" className="ss-icon-btn" onClick={onClose} aria-label="Close the inspector" data-testid="ss-in-close"><Glyph name="close" /></button>
        </header>
        {error ? <div className="ss-empty" role="alert" data-testid="ss-in-error"><p><strong>This block cannot be shown.</strong> {error}</p></div> : null}
        {!d && !error ? <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading the published document…</p> : null}
        {d ? (
          <>
            <div className="ss-in-actions" data-testid="ss-in-actions">
              {can('survey.edit') ? <button type="button" className="ss-btn primary" onClick={() => setReuse((v) => !v)} aria-expanded={reuse} data-testid="ss-in-reuse"><Glyph name="plus" size={14} /> Reuse in a survey</button> : <span className="ss-save-note" data-testid="ss-in-read-only">You can inspect this. Reusing or changing it needs the “edit surveys” permission.</span>}
              {target.kind === 'MODULE' && can('survey.simulate') ? (standalone ? <Link className="ss-btn" to={`/survey-studio/module-tests/${d.code}/${d.version}`} data-testid="ss-in-test-action" data-mode="module"><Glyph name="next" size={14} /> Test this module</Link>
                : firstSurvey ? <Link className="ss-btn" to={`/survey-studio/surveys/${firstSurvey.survey_code}/simulate`} data-testid="ss-in-test-action" data-mode="survey"><Glyph name="next" size={14} /> Test in a survey</Link> : null) : null}
              {target.kind === 'MODULE' && alone && can('survey.edit') ? <Link className="ss-btn" to={`/survey-studio/modules/${origin!.code}`} data-testid="ss-in-open-builder" data-mode="module">{working?.unpublished_changes ? `Continue draft revision ${working.working_revision}` : 'Open in the Module Builder'}</Link>
                : target.kind === 'MODULE' && firstSurvey && can('survey.edit') && instancesOf(uses[firstSurvey.version_id], d)[0] ? <Link className="ss-btn" to={`/survey-studio/surveys/${firstSurvey.survey_code}/modules/${instancesOf(uses[firstSurvey.version_id], d)[0].instance}`} data-testid="ss-in-open-builder">Open in the builder</Link> : null}
            </div>
            {reuse ? (
              <div className="ss-in-reuse" data-testid="ss-in-reuse-panel">
                <p><strong>Choose the survey to open.</strong> Its library opens on this block. There you add the exact published {unit.toLowerCase()} (pinned and locked){target.kind === 'MODULE' ? ', or choose “Edit a copy for this survey” to start a new draft from it' : ''}. This published {unit.toLowerCase()} is never changed, and nothing is saved until you save there.</p>
                {editable.length ? <ul>{editable.map((s) => <li key={s.id}><Link to={`/survey-studio/surveys/${s.code}?library=${encodeURIComponent(inspectParam({ kind: target.kind, code: d.code, version: d.version }))}`} data-testid={`ss-in-reuse-${s.code}`}>{s.name}</Link><span className="ss-muted"> · draft revision {s.draft_revision}</span></li>)}</ul> : <p className="ss-muted">No survey of yours is open for editing. Create one first.</p>}
              </div>
            ) : null}
            <nav className="ss-in-tabs" aria-label="Sections of this block" data-testid="ss-in-tabs">{SECTIONS[target.kind].map(([id, label]) => <button key={id} type="button" onClick={() => jump(id)} data-testid={`ss-in-tab-${id}`}>{label}</button>)}</nav>
            <div className="ss-in-body">
              <Section id="overview" title="Overview">
                {d.description ? <p className="ss-in-lede">{d.description}</p> : <p className="ss-muted">No purpose or description was written for this {KIND[target.kind].toLowerCase()}.</p>}
                <dl className="ss-in-facts">
                  <div><dt>Market</dt><dd>{markets.length ? markets.join(', ') : 'the markets you can read'}</dd></div>
                  <div><dt>Status</dt><dd>Published — {unit.toLowerCase()} {d.version}{d.is_latest ? ', the latest' : `; ${unit.toLowerCase()} ${d.latest_published_version} is newer`}. A published {unit.toLowerCase()} is never changed.</dd></div>
                  <div><dt>Provenance</dt><dd data-testid="ss-in-provenance" data-origin={origin?.artifact_kind ?? ''}>{alone && target.kind === 'MODULE' ? <>Authored on its own as a reusable module (<span className="ss-code">{origin!.code}</span>){own ? <>, and published on its own as release {own.version_label}</> : null}. It was not written inside a survey.</>
                    : alone ? <>Written inside the reusable module {origin!.name} (<span className="ss-code">{origin!.code}</span>), which was authored on its own{own ? <>, and published with its release {own.version_label}</> : null}.</>
                      : first ? <>Published as part of {first.survey_name}, version {first.version_label}.</> : 'Not known.'}{d.derived_from ? <> Made from <span className="ss-code">{String((d.derived_from as Any).code)}</span> version {String((d.derived_from as Any).version)}.</> : null} No owner is recorded for a block on its own.</dd></div>
                  <div><dt>Used by</dt><dd>{plural(d.used_by.surveys, 'survey')} · {plural(d.used_by.versions, 'published version')}</dd></div>
                </dl>
                <h4>{own ? 'Governance of its own publication' : 'Governance of the version that published it'}</h4>
                {first ? <Governance use={uses[first.version_id]} /> : <p className="ss-muted">No publishing version can be read.</p>}
              </Section>
              {module ? (
                <>
                  <Section id="questions" title="Questions" count={`${module.steps.length} steps`}>
                    <ol className="ss-in-steps" ref={list} data-testid="ss-in-steps">
                      {module.steps.map((s) => {
                        const mine = module.arrows.filter((a) => a.from === s.node);
                        const a = answerOf(s.item?.answer_type);
                        return (
                          <li key={s.node} className={selected === s.node ? 'on' : ''} data-node={s.node} data-testid={`ss-in-step-${s.node}`} data-type={s.type}>
                            <button type="button" className="ss-in-step-head" onClick={() => setSelected(selected === s.node ? null : s.node)} aria-pressed={selected === s.node}>
                              <span className={`ss-in-step-n ${s.type.toLowerCase()}`}>{s.n}</span>
                              <span className="ss-in-step-title">{s.type === 'DECISION' ? <>Decision: {s.title}</> : <>“{s.title}”</>}</span>
                              <Tag tone={s.type === 'DECISION' ? 'warn' : s.type === 'STATEMENT' ? 'plain' : 'shared'}>{s.type === 'DECISION' ? 'Decision' : s.type === 'STATEMENT' ? 'Statement' : a.label}</Tag>
                            </button>
                            <div className="ss-in-step-body">
                              {s.type === 'DECISION' ? <ConditionCard doc={s.condition} binding={s.binding} /> : <Validation item={s.item} options={s.options} />}
                              <ul className="ss-in-branches" aria-label="Where it leads">
                                {mine.length ? mine.map((x, i) => <li key={i} className={x.soft ? 'soft' : ''}><span>{x.label}</span><Glyph name="right" size={13} /><strong>{x.to?.node ? <button type="button" className="ss-link" onClick={() => pick(x.to.node)}>{destination(x.to, module.name)}</button> : destination(x.to, module.name)}</strong></li>) : <li><span>No branch is written for this step.</span></li>}
                                {s.routing?.no_followup?.length ? <li className="soft"><span>No follow-up after: {(s.routing.no_followup as string[]).map((o) => `“${s.options.find((q) => q.code === o)?.label ?? words(o)}”`).join(', ')}</span></li> : null}
                              </ul>
                              {s.ref ? <p className="ss-in-step-ref"><button type="button" className="ss-link" onClick={() => onInspect({ kind: 'ITEM', code: s.ref.code, version: s.ref.version, wording: s.ref.wording_version })} data-testid={`ss-in-open-item-${s.node}`}>Inspect this {s.type === 'STATEMENT' ? 'statement' : 'question'} on its own</button><span className="ss-muted"> · version {s.ref.version}, wording version {s.ref.wording_version} · {words(s.wording?.delivery_mode)}{s.type === 'QUESTION' ? ' · an answer that is not valid is refused, recorded as refused, and the question stays current' : ''}</span></p> : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </Section>
                  <Section id="logic" title="Logic" count={`${plural(module.arrows.length, 'branch', 'branches')} · ${plural(module.outcomes.length, 'exit')}`}>
                    <ModuleLogic d={d} steps={module.steps} arrows={module.arrows} outcomes={module.outcomes} name={module.name} selected={selected} pick={pick} uses={uses} onInspect={onInspect} />
                  </Section>
                  <Section id="rules" title="Rules" count={plural(conditions.length, 'condition')}>
                    {conditions.length ? conditions.map((c) => {
                      const at = module.steps.filter((s) => s.binding?.condition?.code === c.code && s.binding?.condition?.version === c.version);
                      return (
                        <div key={`${c.code}@${c.version}`} className="ss-in-dep-row">
                          <ConditionCard doc={c.document} binding={at[0]?.binding} />
                          <p className="ss-muted">{(c.document as Any).name}, version {c.version}. Used at {at.length ? at.map((s) => `step ${s.n}`).join(', ') : 'no step of this module'}. Met, not met and “cannot be decided” each follow their own branch (see the step). <button type="button" className="ss-link" onClick={() => onInspect({ kind: 'CONDITION', code: c.code, version: c.version })}>Inspect the condition and where else it is used</button></p>
                        </div>
                      );
                    }) : <p className="ss-muted" data-testid="ss-in-no-conditions">This module uses no reusable condition. Its branches depend only on the answers given.</p>}
                    {needs.length ? <p data-testid="ss-in-requires">It needs this customer or policy information: <strong>{needs.map(fieldLabel).join(', ')}</strong>.</p> : null}
                  </Section>
                </>
              ) : (
                <Section id="content" title={target.kind === 'ITEM' ? (doc.answer_type === 'STATEMENT' ? 'What is said' : 'Wording and answers') : target.kind === 'CONDITION' ? 'What it evaluates' : 'Answers'}>
                  {target.kind === 'ITEM' ? <ItemBody d={d} onInspect={onInspect} /> : target.kind === 'CONDITION' ? <ConditionBody d={d} /> : <OptionSetBody d={d} />}
                </Section>
              )}
              <Section id="dependencies" title="Dependencies" count={d.dependencies.length}>
                <p className="ss-muted">Every document this {unit.toLowerCase()} pins, by its exact version. Nothing is “the latest”.</p>
                {d.missing_dependencies.length ? <p className="ss-note warn" role="alert"><Glyph name="alert" size={14} /><span>{d.missing_dependencies.length} document(s) it pins could not be read.</span></p> : null}
                <table className="ss-table"><thead><tr><th scope="col">Kind</th><th scope="col">What</th><th scope="col">Version</th><th scope="col">Fingerprint</th></tr></thead>
                  <tbody>
                    <tr><td>{KIND[target.kind]} (this one)</td><td>{d.title} <span className="ss-code">{d.code}</span></td><td>{d.version}</td><td><span className="ss-code" title={d.sha256}>{short(d.sha256)}</span></td></tr>
                    {d.dependencies.map((x) => { const xd = x.document as Any; const k = x.kind as ComponentKind; return (
                      <tr key={`${x.kind}-${x.code}-${x.version}`}><td>{x.kind === 'WORDING' ? 'Wording' : KIND[k] ?? words(x.kind)}</td>
                        <td>{x.kind === 'WORDING' ? `“${String(xd.text ?? '')}”` : x.kind === 'ITEM' ? (xd.intent || words(xd.answer_type)) : x.kind === 'CONDITION' ? xd.name : `${((xd.options ?? []) as Any[]).length} answers`} {x.kind !== 'WORDING' ? <button type="button" className="ss-link" onClick={() => onInspect({ kind: k, code: x.code, version: x.version })}><span className="ss-code">{x.code}</span></button> : <span className="ss-code">{x.code}</span>}</td>
                        <td>{x.version}</td><td><span className="ss-code" title={x.sha256}>{short(x.sha256)}</span></td></tr>); })}
                  </tbody></table>
              </Section>
              <Section id="where-used" title="Where used" count={plural(d.used_by.surveys, 'survey')}>
                <p className="ss-muted">Each survey pins this exact {unit.toLowerCase()}. Publishing a newer one changes none of them: a survey moves only when its own author pins the newer one and the survey is published again.</p>
                <WhereUsed d={{ ...d, published_in: consumers }} uses={uses} unit={unit} onInspect={onInspect} />
              </Section>
              <Section id="versions" title="Versions" count={plural(d.revisions.length, `published ${unit.toLowerCase()}`)}>
                <ul className="ss-in-revisions">{d.revisions.map((r) => (
                  <li key={r.version} className={r.version === d.version ? 'on' : ''}>
                    <strong>{unit} {r.version}</strong>{r.version === d.version ? <Tag tone="ok">shown</Tag> : null}
                    <span className="ss-muted"> published {r.published_in.map((x) => (x.artifact_kind === 'MODULE' ? `on its own, release ${x.version_label}` : `in ${x.survey_name} ${x.version_label}`)).join('; ') || 'in no version you can read'}</span>
                    {r.version !== d.version ? <span className="ss-in-row-actions"><button type="button" className="ss-link" onClick={() => showCompare(r.version)} data-testid={`ss-in-compare-${r.version}`}>Compare with this one</button><button type="button" className="ss-link" onClick={() => onInspect({ kind: target.kind, code: d.code, version: r.version })}>Inspect it</button></span> : null}
                  </li>))}</ul>
                {working ? <p className="ss-in-working" data-testid="ss-in-working" data-revision={working.working_revision} data-unpublished={String(working.unpublished_changes)}>
                  {working.open_candidate ? <>Revision {working.open_candidate.revision} is {working.open_candidate.status === 'IN_REVIEW' ? 'in review, waiting for a reviewer' : 'approved, waiting for a publisher'}. It is not in the library until it is published. </>
                    : working.unpublished_changes ? <>Draft revision {working.working_revision} is being written. It is not in the library, and no survey can use it, until it is published. </>
                      : <>No newer revision is being drafted. </>}
                  {can('survey.edit') ? <Link to={`/survey-studio/modules/${working.code}`}>Open the Module Builder</Link> : null}</p> : null}
                {d.revisions.length < 2 ? <p className="ss-muted" data-testid="ss-in-one-revision">Only one {unit.toLowerCase()} is published, so there is nothing to compare yet.</p> : null}
                {compare ? <div className="ss-in-compare" data-testid="ss-in-compare"><strong>{unit} {d.version} compared with {compare.with}</strong>{compare.lines.length ? <ul>{compare.lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p>Nothing differs in what a customer hears or where they are routed.</p>}</div> : null}
              </Section>
              {target.kind === 'MODULE' ? (
                <Section id="test" title="Test">
                  {standalone ? <p data-testid="ss-in-test-alone">This revision can be tested on its own: the Call360 engine runs just this module, with invented facts and the answers you give, and records nothing. {can('survey.simulate') ? <Link className="ss-btn small" to={`/survey-studio/module-tests/${d.code}/${d.version}`} data-testid="ss-in-test-module">Test revision {d.version} on its own</Link> : null}</p>
                    : <p>A module cannot be simulated on its own on this server: the existing simulator runs a published <em>survey</em> version, by the authoritative execution engine, with this exact revision pinned. Choose a survey that uses it.</p>}
                  {consumers.length ? <p className="ss-muted">Inside a survey, with that survey’s own entry and exit routes:</p> : null}
                  {!can('survey.simulate') ? <p className="ss-muted" data-testid="ss-in-test-denied">Simulating needs the “simulate surveys” permission.</p>
                    : consumers.length ? <ul className="ss-in-used">{consumers.map((u) => <li key={u.version_id}><Link className="ss-btn small" to={`/survey-studio/surveys/${u.survey_code}/simulate`} data-testid={`ss-in-test-${u.survey_code}`}>Simulate {u.survey_name}</Link><span className="ss-muted"> version {u.version_label}</span></li>)}</ul>
                      : <p className="ss-muted">No published survey pins this revision yet.</p>}
                </Section>
              ) : null}
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}
