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
import { differences } from './Library';
import { short } from './reviewApi';
import { MODULE_CATEGORY, answerOf, branchLabel, destination, missing, ruleInWords, versionContent, versionRecord, words } from './workspaceApi';

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
interface Arrow { from: string; to: Any; label: string; soft?: boolean }
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
    for (const e of ((doc.edges ?? []) as Any[]).filter((x) => x.from === s.node)) arrows.push({ from: s.node, to: e.to, label: branchLabel(String(e.on), label) });
    const r = s.routing ?? {};
    ((r.rules ?? []) as Any[]).forEach((rule, i) => arrows.push({ from: s.node, to: rule.to, label: `Rule ${i + 1}: ${rule.when?.kind === 'ALL' ? 'all of' : 'any of'} ${((rule.when?.options ?? []) as string[]).map((o) => `“${label(o)}”`).join(', ')} chosen` }));
    if (r.fallback) arrows.push({ from: s.node, to: r.fallback, label: 'Otherwise' });
    for (const f of (r.followups ?? []) as Any[]) for (const node of (f.nodes ?? []) as string[]) arrows.push({ from: s.node, to: { node }, label: `Follow-up if “${label(f.option)}”`, soft: true });
    for (const x of (r.interrupts ?? []) as Any[]) arrows.push({ from: s.node, to: x.outcome ? { outcome: x.outcome } : x.to, label: `Stops if “${label(x.option)}”` });
    if (r.rejoin) arrows.push({ from: s.node, to: r.rejoin, label: 'After the follow-ups' });
    if (r.empty_fallback && JSON.stringify(r.empty_fallback) !== JSON.stringify(r.rejoin)) arrows.push({ from: s.node, to: r.empty_fallback, label: 'If no follow-up applies' });
  }
  return { steps, arrows, outcomes: (doc.outcomes ?? []) as string[], name };
}

// ---- the execution graph ----------------------------------------------------------------------------------------------
const W = 216, H = 74, GX = 36, GY = 60;
function Graph({ steps, arrows, outcomes, selected, onSelect }: { steps: Step[]; arrows: Arrow[]; outcomes: string[]; selected: string | null; onSelect: (node: string) => void }) {
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
  const hot = (e: { from: string; to: string }) => selected !== null && (e.from === selected || e.to === selected);
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
          return <span key={`l${e.from}>${e.to}`} className={`ss-in-edge-label ${hot(e) ? 'hot' : ''}`} style={{ left: x, top: y }} title={e.labels.join(' · ')}>{e.labels.length > 2 ? `${e.labels[0]} +${e.labels.length - 1}` : e.labels.join(' · ')}</span>;
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

// ---- how each consuming survey enters and leaves the module -----------------------------------------------------------
function Consumers({ d, onInspect }: { d: ComponentDetail; onInspect: (c: Inspect) => void }) {
  const { can } = useAuth();
  const [rows, setRows] = useState<Record<string, { content: Any; record: Any } | null>>({});
  const uses = d.published_in;
  const key = uses.map((u) => u.version_id).join(',');
  useEffect(() => {
    let current = true;
    Promise.all(uses.map(async (u) => [u.version_id, { content: await versionContent(u.version_id), record: await versionRecord(u.version_id) }] as const)).then((all) => { if (current) setRows(Object.fromEntries(all)); });
    return () => { current = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the versions are identified by key
  if (!uses.length) return <p className="ss-muted">No published survey version pins this revision.</p>;
  return (
    <ul className="ss-in-consumers">
      {uses.map((u) => {
        const r = rows[u.version_id];
        const content = r && !missing(r.content) ? r.content.content : null;
        const published = r && !missing(r.record) ? ((r.record.history ?? []) as Any[]).find((h) => h.event === 'PUBLISHED') : null;
        const instances = ((content?.sequence ?? []) as Any[]).filter((i) => i.module?.code === d.code && Number(i.module?.revision) === d.version);
        return (
          <li key={u.version_id} data-testid={`ss-in-consumer-${u.survey_code}`} data-version={u.version_id}>
            <header>
              <div><strong>{u.survey_name}</strong><span className="ss-muted"> pins revision {d.version} in its version {u.version_label}{u.version_status !== 'PUBLISHED' ? ` (${words(u.version_status)})` : ''}</span></div>
              <span className="ss-in-row-actions">
                <Link className="ss-btn small" to={`/survey-studio/surveys/${u.survey_code}/versions/${u.version_id}`}>Open the version</Link>
                {can('survey.simulate') ? <Link className="ss-btn small" to={`/survey-studio/surveys/${u.survey_code}/simulate`} data-testid={`ss-in-test-${u.survey_code}`}>Test it here</Link> : null}
              </span>
            </header>
            {published ? <p className="ss-muted">Published by {published.actor_name ?? 'someone'} on {new Date(published.occurred_at).toLocaleDateString()}.</p> : null}
            {instances.map((i) => {
              const routes = (Array.isArray(i.routes) ? i.routes.map((x: Any) => [x.on, x.to]) : Object.entries(i.routes ?? {})) as Array<[string, Any]>;
              const cond = i.entry?.binding?.condition;
              return (
                <dl className="ss-in-facts" key={i.instance}>
                  <div><dt>Entered</dt><dd>{cond ? <>only when the condition <button type="button" className="ss-link" onClick={() => onInspect({ kind: 'CONDITION', code: cond.code, version: cond.version })}>{cond.code} v{cond.version}</button> is met{Object.keys(i.entry.binding.params ?? {}).length ? ` (${Object.entries(i.entry.binding.params).map(([k, v]) => `${k} = ${String(v)}`).join(', ')})` : ''}; if that cannot be decided: {words(i.entry.binding.unknown_policy)}</> : 'always, in its place in the survey'}</dd></div>
                  <div><dt>Left</dt><dd>{routes.map(([on, to]) => `${words(on)} → ${to === '@CONTINUE' ? 'the next module' : to?.survey_outcome ? `the survey ends: ${words(to.survey_outcome)}` : to?.instance ? `module ${to.instance}` : JSON.stringify(to)}`).join(' · ') || 'not stated'}</dd></div>
                </dl>
              );
            })}
            {r && !content ? <p className="ss-muted">How this survey enters and leaves the module could not be read.</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function ModuleBody({ d, onInspect }: { d: ComponentDetail; onInspect: (c: Inspect) => void }) {
  const { steps, arrows, outcomes, name } = useMemo(() => read(d), [d]);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const pick = (node: string) => { setSelected(node); list.current?.querySelector(`[data-node="${CSS.escape(node)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  const conditions = d.dependencies.filter((x) => x.kind === 'CONDITION');
  const needs = ((d.requires?.fields ?? []) as string[]);
  const entry = steps.find((s) => s.entry);
  return (
    <>
      <Section id="flow" title="How it runs" count={`${plural(steps.length, 'step')} · ${plural(arrows.length, 'branch', 'branches')}`}>
        <p className="ss-muted">Select a step to see what is asked there and where each answer leads. Solid lines are branches; dashed lines are follow-up questions.</p>
        <Graph steps={steps} arrows={arrows} outcomes={outcomes} selected={selected} onSelect={pick} />
      </Section>
      <Section id="steps" title="Every step" count={steps.length}>
        <ol className="ss-in-steps" ref={list}>
          {steps.map((s) => {
            const mine = arrows.filter((a) => a.from === s.node);
            const a = answerOf(s.item?.answer_type);
            return (
              <li key={s.node} className={selected === s.node ? 'on' : ''} data-node={s.node} data-testid={`ss-in-step-${s.node}`} data-type={s.type}>
                <button type="button" className="ss-in-step-head" onClick={() => setSelected(selected === s.node ? null : s.node)} aria-expanded={selected === s.node}>
                  <span className={`ss-in-step-n ${s.type.toLowerCase()}`}>{s.n}</span>
                  <span className="ss-in-step-title">{s.type === 'DECISION' ? <>Decision: {s.title}</> : <>“{s.title}”</>}</span>
                  <Tag tone={s.type === 'DECISION' ? 'warn' : s.type === 'STATEMENT' ? 'plain' : 'shared'}>{s.type === 'DECISION' ? 'Decision' : s.type === 'STATEMENT' ? 'Statement' : a.label}</Tag>
                </button>
                <div className="ss-in-step-body">
                  {s.type === 'DECISION' ? <ConditionCard doc={s.condition} binding={s.binding} /> : <Validation item={s.item} options={s.options} />}
                  <ul className="ss-in-branches" aria-label="Where it leads">
                    {mine.length ? mine.map((x, i) => <li key={i} className={x.soft ? 'soft' : ''}><span>{x.label}</span><Glyph name="right" size={13} /><strong>{x.to?.node ? <button type="button" className="ss-link" onClick={() => pick(x.to.node)}>{destination(x.to, name)}</button> : destination(x.to, name)}</strong></li>) : <li><span>No branch is written for this step.</span></li>}
                    {s.routing?.no_followup?.length ? <li className="soft"><span>No follow-up after: {(s.routing.no_followup as string[]).map((o) => `“${s.options.find((q) => q.code === o)?.label ?? words(o)}”`).join(', ')}</span></li> : null}
                  </ul>
                  {s.ref ? <p className="ss-in-step-ref"><button type="button" className="ss-link" onClick={() => onInspect({ kind: 'ITEM', code: s.ref.code, version: s.ref.version, wording: s.ref.wording_version })} data-testid={`ss-in-open-item-${s.node}`}>Inspect this {s.type === 'STATEMENT' ? 'statement' : 'question'} on its own</button><span className="ss-muted"> · wording version {s.ref.wording_version} · {words(s.wording?.delivery_mode)}</span></p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>
      <Section id="conditions" title="Conditions it uses" count={conditions.length}>
        {conditions.length ? conditions.map((c) => <div key={`${c.code}@${c.version}`} className="ss-in-dep-row"><ConditionCard doc={c.document} /><button type="button" className="ss-link" onClick={() => onInspect({ kind: 'CONDITION', code: c.code, version: c.version })}>Inspect the condition and where else it is used</button></div>) : <p className="ss-muted">This module uses no reusable condition. Its branches depend only on the answers given.</p>}
        {needs.length ? <p data-testid="ss-in-requires">It needs this customer or policy information: <strong>{needs.map(fieldLabel).join(', ')}</strong>.</p> : null}
      </Section>
      <Section id="entry-exit" title="How it is entered and left" count={`${plural(outcomes.length, 'ending')}`}>
        <dl className="ss-in-facts">
          <div><dt>Starts at</dt><dd>{entry ? <button type="button" className="ss-link" onClick={() => pick(entry.node)}>step {entry.n}: {entry.type === 'DECISION' ? entry.title : `“${entry.title}”`}</button> : 'no first step is stated'}</dd></div>
          <div><dt>Can end as</dt><dd>{outcomes.map(words).join(' · ') || 'no ending is stated'}</dd></div>
        </dl>
        <p className="ss-muted">When it is entered, and where each ending leads, is set by each survey that uses it:</p>
        <Consumers d={d} onInspect={onInspect} />
      </Section>
    </>
  );
}

function ItemBody({ d, onInspect }: { d: ComponentDetail; onInspect: (c: Inspect) => void }) {
  const doc = d.document as Any;
  const wording = d.dependencies.find((x) => x.kind === 'WORDING')?.document as Any;
  const os = d.dependencies.find((x) => x.kind === 'OPTION_SET');
  return (
    <Section id="item" title={doc.answer_type === 'STATEMENT' ? 'What is said' : 'What is asked'}>
      <blockquote className="ss-in-quote">“{String(wording?.text ?? d.title)}”</blockquote>
      <dl className="ss-in-facts"><div><dt>Kind of answer</dt><dd>{answerOf(doc.answer_type).label}</dd></div><div><dt>Wording</dt><dd>version {d.wording_version} · {words(wording?.delivery_mode)} · synthetic, unapproved</dd></div></dl>
      <Validation item={doc} options={((os?.document as Any)?.options ?? []) as Any[]} />
      {os ? <p><button type="button" className="ss-link" onClick={() => onInspect({ kind: 'OPTION_SET', code: os.code, version: os.version })}>Inspect its answer set</button></p> : null}
    </Section>
  );
}

function ConditionBody({ d }: { d: ComponentDetail }) {
  const reads = (((d.facts as Any).fields ?? []) as string[]);
  return <Section id="condition" title="What it evaluates"><ConditionCard doc={d.document} /><dl className="ss-in-facts"><div><dt>Reads</dt><dd>{reads.map(fieldLabel).join(' · ') || 'no customer or policy information'}</dd></div></dl></Section>;
}

function OptionSetBody({ d }: { d: ComponentDetail }) {
  return (
    <Section id="options" title="Answers" count={(((d.document as Any).options ?? []) as Any[]).length}>
      <ul className="ss-in-options">{(((d.document as Any).options ?? []) as Any[]).map((o) => <li key={o.code}><strong>{o.label}</strong>{[o.exclusive ? 'cannot be combined' : '', o.is_other ? 'other, with text' : '', o.interrupt ? `stops the question: ${words(o.interrupt)}` : ''].filter(Boolean).map((t) => <Tag key={t}>{t}</Tag>)}</li>)}</ul>
    </Section>
  );
}

const GLYPH: Record<ComponentKind, GlyphName> = { MODULE: 'flow', ITEM: 'text', CONDITION: 'branch', OPTION_SET: 'list' };

/** The drawer. `target` is what the address bar names; `onInspect` moves to another block; `onClose` closes it. */
export function InspectorDrawer({ target, surveys, onInspect, onClose }: { target: Inspect; surveys: SurveySummary[]; onInspect: (c: Inspect) => void; onClose: () => void }) {
  const { can } = useAuth();
  const [d, setD] = useState<ComponentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ with: number; lines: string[] } | null>(null);
  const [reuse, setReuse] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const key = inspectParam(target);
  useEffect(() => {
    let current = true;
    setD(null); setError(null); setCompare(null); setReuse(false);
    getComponent(target.kind, target.code, target.version, target.wording ?? undefined).then((x) => { if (current) setD(x); }).catch((e) => { if (current) setError(say(e)); });
    return () => { current = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the block is identified by key
  useEffect(() => { panel.current?.focus(); const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [onClose]);
  const showCompare = (v: number) => { if (d) getComponent(d.kind as ComponentKind, d.code, v).then((other) => setCompare({ with: v, lines: differences(d, other) })).catch((e) => setError(say(e))); };
  const editable = surveys.filter((s) => !s.open_candidate_status);
  const facts = (d?.facts ?? {}) as Any;
  const unit = target.kind === 'MODULE' ? 'Revision' : 'Version';
  return (
    <div className="ss-in-scrim" data-testid="ss-in-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="ss-in" role="dialog" aria-modal="true" aria-labelledby="ss-in-title" tabIndex={-1} ref={panel} data-testid="ss-inspector" data-kind={target.kind} data-code={target.code} data-version={target.version} data-loaded={String(!!d)}>
        <header className="ss-in-head">
          <div className="ss-in-head-main">
            <p className="ss-in-kind"><Glyph name={GLYPH[target.kind]} size={14} /> Published {KIND[target.kind].toLowerCase()}{d && target.kind === 'MODULE' ? ` · ${MODULE_CATEGORY[d.category] ?? words(d.category)}` : ''}</p>
            <h2 id="ss-in-title" className="ss-title">{d ? (target.kind === 'ITEM' ? `“${d.title}”` : d.title) : error ? 'Not available' : 'Loading…'}</h2>
            {d?.description ? <p className="ss-in-lede">{d.description}</p> : null}
            {d ? (
              <p className="ss-in-meta" data-testid="ss-in-meta">
                <Tag tone={d.is_latest ? 'ok' : 'draft'}>{unit} {d.version}{d.is_latest ? ' · latest published' : ` · revision ${d.latest_published_version} is newer`}</Tag>
                <Tag tone={d.used_by.surveys > 1 ? 'shared' : 'plain'}>Used by {plural(d.used_by.surveys, 'survey')}</Tag>
                {target.kind === 'MODULE' ? <span className="ss-muted">{plural(facts.questions ?? 0, 'question')} · {plural(facts.statements ?? 0, 'statement')} · {plural(facts.decisions ?? 0, 'decision')}</span> : null}
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
              {can('survey.edit') ? <button type="button" className="ss-btn primary" onClick={() => setReuse((v) => !v)} aria-expanded={reuse} data-testid="ss-in-reuse"><Glyph name="plus" size={14} /> Use in a survey</button> : <span className="ss-save-note" data-testid="ss-in-read-only">You can inspect this. Using it in a survey needs the “edit surveys” permission.</span>}
              {target.kind === 'MODULE' && d.published_in[0] ? (can('survey.simulate') ? <Link className="ss-btn" to={`/survey-studio/surveys/${d.published_in[0].survey_code}/simulate`} data-testid="ss-in-test"><Glyph name="next" size={14} /> Test in {d.published_in[0].survey_name}</Link> : <span className="ss-save-note">Testing needs the “simulate surveys” permission.</span>) : null}
              <a className="ss-btn" href="#ss-in-used">Where it is used</a>
            </div>
            {target.kind === 'MODULE' ? <p className="ss-muted ss-in-test-note">A module is tested inside a published survey that uses it: the simulator runs the survey’s exact pinned revision.</p> : null}
            {reuse ? (
              <div className="ss-in-reuse" data-testid="ss-in-reuse-panel">
                <p><strong>Choose the survey to open.</strong> Its library opens on this block, where you add the exact published {unit.toLowerCase()} (locked){target.kind === 'MODULE' ? ' or make an editable copy for that survey' : ''}. Nothing is changed until you save there.</p>
                {editable.length ? <ul>{editable.map((s) => <li key={s.id}><Link to={`/survey-studio/surveys/${s.code}?library=${encodeURIComponent(inspectParam({ kind: target.kind, code: d.code, version: d.version }))}`} data-testid={`ss-in-reuse-${s.code}`}>{s.name}</Link><span className="ss-muted"> · draft revision {s.draft_revision}</span></li>)}</ul> : <p className="ss-muted">No survey of yours is open for editing. Create one first.</p>}
              </div>
            ) : null}
            <div className="ss-in-body">
              {target.kind === 'MODULE' ? <ModuleBody d={d} onInspect={onInspect} /> : target.kind === 'ITEM' ? <ItemBody d={d} onInspect={onInspect} /> : target.kind === 'CONDITION' ? <ConditionBody d={d} /> : <OptionSetBody d={d} />}
              <Section id="used" title="Where it is used" count={plural(d.used_by.surveys, 'survey')}>
                {target.kind === 'MODULE' ? <p className="ss-muted">Listed with how each survey enters and leaves it under “How it is entered and left”.</p> : null}
                <ul className="ss-in-used">{d.published_in.map((u) => <li key={u.version_id}><Link to={`/survey-studio/surveys/${u.survey_code}/versions/${u.version_id}`}>{u.survey_name}</Link><span className="ss-muted"> · version {u.version_label} · pins {unit.toLowerCase()} {d.version}</span></li>)}</ul>
                {d.used_by.versions > d.published_in.length ? <p className="ss-muted">{d.used_by.versions} published versions pin it in all.</p> : null}
              </Section>
              <Section id="history" title="Versions and governance" count={plural(d.revisions.length, 'published revision')}>
                <p className="ss-muted">A block is published as part of a survey version, which three different people submit, approve and publish. A published {unit.toLowerCase()} is never changed: a change is a new one.</p>
                <ul className="ss-in-revisions">{d.revisions.map((r) => (
                  <li key={r.version} className={r.version === d.version ? 'on' : ''}>
                    <strong>{unit} {r.version}</strong>{r.version === d.version ? <Tag tone="ok">shown</Tag> : null}
                    <span className="ss-muted"> published in {r.published_in.map((s) => `${s.survey_name} ${s.version_label}`).join('; ') || 'no version you can read'}</span>
                    {r.version !== d.version ? <span className="ss-in-row-actions"><button type="button" className="ss-link" onClick={() => showCompare(r.version)} data-testid={`ss-in-compare-${r.version}`}>What differs</button><button type="button" className="ss-link" onClick={() => onInspect({ kind: target.kind, code: d.code, version: r.version })}>Inspect it</button></span> : null}
                  </li>))}</ul>
                {compare ? <div className="ss-in-compare" data-testid="ss-in-compare"><strong>{unit} {d.version} compared with {compare.with}</strong>{compare.lines.length ? <ul>{compare.lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p>Nothing differs in what a customer hears or where they are routed.</p>}</div> : null}
                {d.derived_from ? <p className="ss-muted">Made from <span className="ss-code">{String((d.derived_from as Any).code)}</span> version {String((d.derived_from as Any).version)}.</p> : null}
              </Section>
              <Section id="dependencies" title="Exact versions it depends on" count={d.dependencies.length} open={false}>
                {d.missing_dependencies.length ? <p className="ss-note warn" role="alert"><Glyph name="alert" size={14} /><span>{d.missing_dependencies.length} document(s) it pins could not be read.</span></p> : null}
                <table className="ss-table"><thead><tr><th scope="col">Kind</th><th scope="col">Code</th><th scope="col">Version</th><th scope="col">Fingerprint</th></tr></thead>
                  <tbody>
                    <tr><td>{KIND[target.kind]} (this one)</td><td><span className="ss-code">{d.code}</span></td><td>{d.version}</td><td><span className="ss-code" title={d.sha256}>{short(d.sha256)}</span></td></tr>
                    {d.dependencies.map((x) => <tr key={`${x.kind}-${x.code}-${x.version}`}><td>{x.kind === 'WORDING' ? 'Wording' : KIND[x.kind as ComponentKind] ?? words(x.kind)}</td><td><span className="ss-code">{x.code}</span></td><td>{x.version}</td><td><span className="ss-code" title={x.sha256}>{short(x.sha256)}</span></td></tr>)}
                  </tbody></table>
              </Section>
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}
