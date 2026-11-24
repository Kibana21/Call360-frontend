// Survey Applicability (APPL-X1) — the editors every screen shares: a value editor that adapts to the variable's
// type, and the visual condition builder. The builder edits the canonical expression tree; when a trace from the
// Python evaluator is supplied it shows each part's result and marks the branch responsible.
import { useMemo, useState } from 'react';
import { MANY, NO_OPERAND, WORDS, childPath, operatorsFor, sentence, starter, valueLabel, withOperator } from './model/describe';
import type { Condition, Diagnostic, Expr, Operator, Scalar, Trace, Tri, Variable } from './model/types';
import { applicabilityLibrary } from './flag';
import { useAppl } from './store';
import { Icon, Picker, Tag, TriMark, type PickItem } from './ui';

export const SOURCE_WORD = { MAPPED: 'Mapped to a source', PROPOSED: 'Source proposed', UNMAPPED: 'No source yet', DERIVED: 'Worked out' } as const;
export const SOURCE_TONE = { MAPPED: 'published', PROPOSED: 'warn', UNMAPPED: 'unknown', DERIVED: 'info' } as const;

/** One value of a variable, with the control its type calls for. `unknown` adds an explicit "Not known" choice. */
export function ValueEditor({ variable: v, value, onChange, unknown, testid, compact }: { variable: Variable; value: unknown; onChange: (v: unknown) => void; unknown?: boolean; testid?: string; compact?: boolean }) {
  const id = testid ?? `ap-val-${v.code}`;
  if (v.type === 'BOOLEAN') {
    const opts: { key: string; label: string; val: unknown }[] = [{ key: 'yes', label: 'Yes', val: true }, { key: 'no', label: 'No', val: false }, ...(unknown ? [{ key: 'unknown', label: 'Not known', val: null }] : [])];
    return (
      <div className="ap-choice" role="radiogroup" aria-label={v.name} data-testid={id}>
        {opts.map((o) => <button key={o.key} type="button" role="radio" aria-checked={value === o.val} className={value === o.val ? 'on' : ''} data-testid={`${id}-${o.key}`} onClick={() => onChange(o.val)}>{o.label}</button>)}
      </div>
    );
  }
  if (v.type === 'ENUM') {
    const few = (v.values?.length ?? 0) <= 5 && !compact;
    if (few) return (
      <div className="ap-choice wrap" role="radiogroup" aria-label={v.name} data-testid={id}>
        {v.values!.map((o) => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} data-testid={`${id}-${o.value}`} onClick={() => onChange(o.value)}>{o.label}</button>)}
        {unknown ? <button type="button" role="radio" aria-checked={value === null} className={value === null ? 'on' : ''} data-testid={`${id}-unknown`} onClick={() => onChange(null)}>Not known</button> : null}
        {typeof value === 'string' && !v.values!.some((o) => o.value === value) ? <span className="ap-invalid-value" data-testid={`${id}-invalid`}><Icon name="warn" size={12} /> “{value}” is not an allowed value</span> : null}
      </div>
    );
    return (
      <select className="ap-input" aria-label={v.name} data-testid={id} value={value === null || value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
        {unknown || value === null || value === undefined ? <option value="">{unknown ? 'Not known' : 'Choose…'}</option> : null}
        {v.values?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        {typeof value === 'string' && !v.values?.some((o) => o.value === value) ? <option value={value}>{value} (not allowed)</option> : null}
      </select>
    );
  }
  if (v.type === 'MULTI_ENUM') {
    const have = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="ap-choice wrap" role="group" aria-label={v.name} data-testid={id}>
        {v.values?.map((o) => { const on = have.includes(o.value); return <button key={o.value} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} data-testid={`${id}-${o.value}`} onClick={() => onChange(on ? have.filter((x) => x !== o.value) : [...have, o.value])}>{on ? <Icon name="check" size={12} /> : null}{o.label}</button>; })}
        {unknown ? <button type="button" role="checkbox" aria-checked={value === null} className={value === null ? 'on' : ''} data-testid={`${id}-unknown`} onClick={() => onChange(value === null ? [] : null)}>Not known</button> : null}
      </div>
    );
  }
  const numeric = v.type === 'NUMBER' || v.type === 'DECIMAL' || v.type === 'MONEY';
  return (
    <span className="ap-inline-input">
      {v.type === 'MONEY' ? <span className="ap-affix">{v.currency}</span> : null}
      <input className="ap-input" aria-label={v.name} data-testid={id} type={numeric ? 'number' : v.type === 'DATE' ? 'date' : 'text'} step={v.type === 'NUMBER' ? 1 : v.type === 'DATE' ? undefined : 'any'}
        value={value === null || value === undefined ? '' : String(value)} placeholder={unknown ? 'Not known' : ''}
        onChange={(e) => { const t = e.target.value; onChange(t === '' ? (unknown ? null : numeric ? 0 : '') : numeric ? Number(t) : t); }} />
      {unknown && value !== null && value !== undefined ? <button type="button" className="ap-linkbtn" onClick={() => onChange(null)} data-testid={`${id}-unknown`}>Set to not known</button> : null}
    </span>
  );
}

const CATEGORY_ORDER = ['Application', 'Product', 'Sale', 'Premium', 'Risk', 'Customer'];
export function useVariableItems(only?: string[] | null): PickItem[] {
  const { data } = useAppl();
  return useMemo(() => [...data.variables]
    .filter((v) => v.status !== 'DEPRECATED' && (!only || only.includes(v.code)))
    .sort((a, b) => (CATEGORY_ORDER.indexOf(a.category) + 99) % 99 - (CATEGORY_ORDER.indexOf(b.category) + 99) % 99 || a.name.localeCompare(b.name))
    .map((v) => ({ id: v.code, label: v.name, hint: v.description, group: v.category, icon: 'variable' as const, tag: v.source.status === 'UNMAPPED' ? <Tag tone="unknown">no source</Tag> : undefined })), [data.variables, only]);
}

interface BuilderProps {
  expr: Expr | null; onChange: (e: Expr | null) => void; trace?: Trace | null; diagnostics?: Diagnostic[];
  /** the saved condition being edited, so it cannot be put inside itself */
  self?: string; testid?: string; emptyHint?: string; allowAlways?: boolean;
  /** how much of the builder is offered: one line, groups, or everything (saved conditions too) */
  level?: Level;
}
export type Level = 'simple' | 'grouped' | 'advanced';
/** The visual condition builder: rows of "variable · operator · value", grouped with ALL / ANY, negated, or a saved condition. */
export function ConditionBuilder({ expr, onChange, trace, diagnostics = [], self, testid = 'ap-builder', emptyHint, allowAlways, level = 'advanced' }: BuilderProps) {
  const { look } = useAppl();
  // the evaluator numbers nodes from wherever the expression sits (a requirement's id, for example): make them relative
  const tr = useMemo(() => { const m = new Map<string, Trace>(); const base = trace?.path ?? ''; const walk = (t?: Trace | null) => { if (!t) return; m.set(t.path === base ? '' : base ? t.path.slice(base.length + 1) : t.path, t); t.children?.forEach(walk); }; walk(trace); return m; }, [trace]);
  const issues = useMemo(() => { const m = new Map<string, Diagnostic[]>(); diagnostics.forEach((d) => { const p = String(d.at?.path ?? ''); m.set(p, [...(m.get(p) ?? []), d]); }); return m; }, [diagnostics]);
  if (!expr) {
    return (
      <div className="ap-builder empty" data-testid={testid}>
        <p className="ap-builder-hint">{emptyHint ?? (allowAlways ? 'No condition: this applies to every application.' : 'Start with one fact about the application.')}</p>
        <AddMenu onAdd={(e) => onChange(e)} self={self} testid={`${testid}-add`} label={allowAlways ? 'Add a condition' : 'Add the first condition'} primary level={level} />
      </div>
    );
  }
  // the root is always shown as a group so that adding a second line is one click
  const root: Expr = expr.op === 'all' || expr.op === 'any' ? expr : { op: 'all', args: [expr] };
  const wrapped = root !== expr;
  const lift = (e: Expr | null): Expr | null => {
    if (!e) return null;
    if ((e.op === 'all' || e.op === 'any') && e.args.length === 0) return null;
    if ((e.op === 'all' || e.op === 'any') && e.args.length === 1 && wrapped) return e.args[0]!;
    return e;
  };
  return (
    <div className={`ap-builder level-${level}`} data-testid={testid} data-level={level}>
      <Group node={root as Extract<Expr, { op: 'all' | 'any' }>} path="" tracePath={wrapped ? null : ''} onChange={(e) => onChange(lift(e))} tr={tr} issues={issues} self={self} testid={testid} depth={0} wrapped={wrapped} level={level} />
      <p className="ap-builder-says" data-testid={`${testid}-sentence`}><span>In words</span> {sentence(expr, look)}</p>
    </div>
  );
}

interface NodeProps { path: string; tracePath: string | null; tr: Map<string, Trace>; issues: Map<string, Diagnostic[]>; self?: string; testid: string; depth: number; level: Level }
const mark = (t: Trace | undefined) => (t ? <span className={`ap-node-result${t.decisive === false ? ' quiet' : ''}`} title={t.reason || undefined}><TriMark value={t.result as Tri} small word={t.result === 'TRUE' ? 'Yes' : t.result === 'FALSE' ? 'No' : 'Not known'} /></span> : null);

function Group({ node, onChange, wrapped, ...p }: NodeProps & { node: Extract<Expr, { op: 'all' | 'any' }>; onChange: (e: Expr | null) => void; wrapped?: boolean }) {
  const t = p.tracePath === null ? undefined : p.tr.get(p.tracePath);
  const set = (i: number, e: Expr | null) => onChange({ ...node, args: node.args.flatMap((a, n) => (n === i ? (e ? [e] : []) : [a])) });
  const move = (i: number, by: number) => { const args = [...node.args]; const [x] = args.splice(i, 1); args.splice(i + by, 0, x!); onChange({ ...node, args }); };
  const id = `${p.testid}-g${p.path.replaceAll('.', '_')}`;
  return (
    <div className={`ap-group depth-${Math.min(p.depth, 3)}${t ? ` is-${t.result.toLowerCase()}` : ''}`} data-testid={id} data-result={t?.result}>
      <div className="ap-group-head">
        <div className="ap-seg tight" role="radiogroup" aria-label="How these lines combine">
          <button type="button" role="radio" aria-checked={node.op === 'all'} className={node.op === 'all' ? 'on' : ''} data-testid={`${id}-all`} onClick={() => onChange({ ...node, op: 'all' })}>All of these</button>
          <button type="button" role="radio" aria-checked={node.op === 'any'} className={node.op === 'any' ? 'on' : ''} data-testid={`${id}-any`} onClick={() => onChange({ ...node, op: 'any' })}>Any of these</button>
        </div>
        <span className="ap-group-word">{node.op === 'all' ? 'AND' : 'OR'}</span>
        {mark(t)}
        {p.depth > 0 ? <button type="button" className="ap-iconbtn" aria-label="Remove this group" onClick={() => onChange(null)} data-testid={`${id}-remove`}><Icon name="trash" size={14} /></button> : null}
      </div>
      <div className="ap-group-body">
        {node.args.map((a, i) => {
          const cp = childPath(p.path, i);
          const tp = p.tracePath === null ? (wrapped ? '' : null) : childPath(p.tracePath, i);
          return (
            <div className="ap-line" key={cp}>
              <span className="ap-line-join" aria-hidden="true">{i === 0 ? '' : node.op === 'all' ? 'and' : 'or'}</span>
              <Node node={a} {...p} path={cp} tracePath={tp} depth={p.depth + 1} onChange={(e) => set(i, e)} />
              <span className="ap-line-tools">
                <button type="button" className="ap-iconbtn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={13} /></button>
                <button type="button" className="ap-iconbtn" aria-label="Move down" disabled={i === node.args.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={13} /></button>
              </span>
            </div>
          );
        })}
        <div className="ap-line add">
          <span className="ap-line-join" aria-hidden="true">{node.args.length ? (node.op === 'all' ? 'and' : 'or') : ''}</span>
          <AddMenu onAdd={(e) => onChange({ ...node, args: [...node.args, e] })} self={p.self} testid={`${id}-add`} label="Add" allowGroup level={p.level} />
        </div>
      </div>
      <Issues list={p.issues.get(p.path)} />
    </div>
  );
}

function Node({ node, onChange, ...p }: NodeProps & { node: Expr; onChange: (e: Expr | null) => void }) {
  const { look } = useAppl();
  const t = p.tracePath === null ? undefined : p.tr.get(p.tracePath);
  const id = `${p.testid}-n${p.path.replaceAll('.', '_')}`;
  if (node.op === 'all' || node.op === 'any') return <Group node={node} {...p} onChange={onChange} />;
  if (node.op === 'not') {
    return (
      <div className="ap-not" data-testid={id} data-result={t?.result}>
        <div className="ap-not-head"><span className="ap-not-word">NOT</span><span className="ap-not-says">the opposite of</span>{mark(t)}
          <button type="button" className="ap-linkbtn" onClick={() => onChange(node.arg)} data-testid={`${id}-unnegate`}>Remove “not”</button></div>
        <Node node={node.arg} {...p} path={childPath(p.path, 0)} tracePath={p.tracePath === null ? null : childPath(p.tracePath, 0)} depth={p.depth + 1} onChange={(e) => onChange(e ? { op: 'not', arg: e } : null)} />
      </div>
    );
  }
  if (node.op === 'ref') {
    const c = look.condition(node.condition);
    return (
      <div className={`ap-test ref${t ? ` is-${t.result.toLowerCase()}` : ''}`} data-testid={id} data-result={t?.result}>
        <span className="ap-chip cond"><Icon name="condition" size={13} /> {c?.name ?? node.condition}</span>
        <span className="ap-test-quiet">saved condition · version {node.version}{c && c.version !== node.version ? ` (version ${c.version} exists)` : ''}</span>
        <span className="ap-test-quiet says">{c ? sentence(c.history?.find((h) => h.version === node.version)?.expr ?? c.expr, look) : 'missing'}</span>
        {mark(t)}
        <RowTools onNegate={() => onChange({ op: 'not', arg: node })} onRemove={() => onChange(null)} id={id} />
        <Issues list={p.issues.get(p.path)} />
      </div>
    );
  }
  return <TestRow node={node} onChange={onChange} t={t} id={id} issues={p.issues.get(p.path)} />;
}

function RowTools({ onNegate, onRemove, id }: { onNegate: () => void; onRemove: () => void; id: string }) {
  return (
    <span className="ap-test-tools">
      <button type="button" className="ap-linkbtn" onClick={onNegate} data-testid={`${id}-negate`} title="Use the opposite of this line">Not</button>
      <button type="button" className="ap-iconbtn" aria-label="Remove this line" onClick={onRemove} data-testid={`${id}-remove`}><Icon name="trash" size={14} /></button>
    </span>
  );
}
function Issues({ list }: { list?: Diagnostic[] }) {
  if (!list?.length) return null;
  return <ul className="ap-issues">{list.map((d, i) => <li key={i} className={d.severity.toLowerCase()} data-testid={`ap-issue-${d.code}`}><Icon name={d.severity === 'INFO' ? 'info' : 'warn'} size={12} /> {d.message}</li>)}</ul>;
}

function TestRow({ node, onChange, t, id, issues }: { node: Extract<Expr, { op: 'test' }>; onChange: (e: Expr | null) => void; t?: Trace; id: string; issues?: Diagnostic[] }) {
  const { look, openDrawer } = useAppl();
  const v = look.variable(node.variable);
  const items = useVariableItems();
  const ops = operatorsFor(v);
  const operand = () => {
    if (!v || NO_OPERAND.includes(node.operator)) return null;
    if (MANY.includes(node.operator)) {
      if (v.type === 'STRING') return <input className="ap-input" aria-label="Values, separated by commas" data-testid={`${id}-values`} value={(node.values ?? []).join(', ')} onChange={(e) => onChange({ ...node, values: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="one, two" />;
      const have = node.values ?? [];
      return <div className="ap-choice wrap" role="group" aria-label="Values">{v.values?.map((o) => { const on = have.includes(o.value); return <button key={o.value} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} data-testid={`${id}-v-${o.value}`} onClick={() => onChange({ ...node, values: on ? have.filter((x) => x !== o.value) : [...have, o.value] })}>{on ? <Icon name="check" size={12} /> : null}{o.label}</button>; })}</div>;
    }
    if (node.operator === 'between') return <span className="ap-between"><ValueEditor variable={v} value={node.min} onChange={(x) => onChange({ ...node, min: x as Scalar })} testid={`${id}-min`} compact /><span>and</span><ValueEditor variable={v} value={node.max} onChange={(x) => onChange({ ...node, max: x as Scalar })} testid={`${id}-max`} compact /></span>;
    return <ValueEditor variable={v} value={node.value} onChange={(x) => onChange({ ...node, value: x as Scalar })} testid={`${id}-value`} compact />;
  };
  return (
    <div className={`ap-test${t ? ` is-${t.result.toLowerCase()}` : ''}${issues?.some((d) => d.severity === 'BLOCKER') ? ' bad' : ''}`} data-testid={id} data-result={t?.result}>
      <Picker label="Variable" testid={`${id}-var`} items={items} placeholder="Search variables…" onPick={(code) => { const nv = look.variable(code); if (nv) onChange(starter(nv)); }}
        button={<span className="ap-chip var"><Icon name="variable" size={13} /> {v?.name ?? node.variable} <Icon name="down" size={11} /></span>}
        footer={(close, q) => <button type="button" className="ap-pop-create" data-testid={`${id}-var-create`} onClick={() => { close(); openDrawer({ kind: 'variable', name: q, then: (made) => onChange(starter(made)) }); }}><Icon name="plus" size={13} /> Create a variable{q ? ` called “${q}”` : ''}</button>} />
      <select className="ap-input op" aria-label="Comparison" data-testid={`${id}-op`} value={node.operator} onChange={(e) => v && onChange(withOperator(node, e.target.value as Operator, v))}>
        {ops.map((o) => <option key={o} value={o}>{WORDS[o]}</option>)}
        {!ops.includes(node.operator) ? <option value={node.operator}>{WORDS[node.operator] ?? node.operator} (not valid here)</option> : null}
      </select>
      {operand()}
      {t ? <span className={`ap-node-result${t.decisive === false ? ' quiet' : ''}`} title={t.reason || undefined}><TriMark value={t.result as Tri} small word={t.result === 'TRUE' ? 'Yes' : t.result === 'FALSE' ? 'No' : 'Not known'} />{t.fact && t.result !== 'UNKNOWN' ? <em>{t.fact.name} = {t.fact.label}</em> : t.reason ? <em>{t.reason}</em> : null}</span> : null}
      <RowTools onNegate={() => onChange({ op: 'not', arg: node })} onRemove={() => onChange(null)} id={id} />
      <Issues list={issues} />
    </div>
  );
}

/** "Add": a fact about the application, a saved condition, or a nested group. */
/** The version a new reference names. With the saved library on, a condition that has a published version is
    referenced at that exact PUBLISHED version — never at a draft that only exists as work in progress. */
export const pinOf = (c: { version: number; status: string; history?: { version: number }[] }): number =>
  applicabilityLibrary() && c.status === 'DRAFT' && c.history?.length ? Math.max(...c.history.map((h) => h.version)) : c.version;
export function AddMenu({ onAdd, self, testid, label, allowGroup, primary, level = 'advanced' }: { onAdd: (e: Expr) => void; self?: string; testid: string; label: string; allowGroup?: boolean; primary?: boolean; level?: Level }) {
  const { data, look, openDrawer } = useAppl();
  const vars = useVariableItems();
  const [mode, setMode] = useState<'variable' | 'condition'>('variable');
  const conds: PickItem[] = data.conditions.filter((c) => c.code !== self).map((c: Condition) => ({ id: c.code, label: c.name, hint: sentence(c.expr, look), icon: 'condition', group: 'Saved conditions', tag: <Tag tone="cond">v{c.version}</Tag> }));
  const pick = (id: string) => {
    if (mode === 'condition') { const c = look.condition(id); if (c) onAdd({ op: 'ref', condition: c.code, version: c.version }); }
    else { const v = look.variable(id); if (v) onAdd(starter(v)); }
  };
  return (
    <span className="ap-add">
      <Picker label="Add a fact about the application" testid={`${testid}-fact`} items={vars} placeholder="Search variables…" onPick={(id) => { setMode('variable'); const v = look.variable(id); if (v) onAdd(starter(v)); }}
        button={<span className={`ap-btn ${primary ? 'primary' : 'quiet'}`} onMouseDown={() => setMode('variable')}><Icon name="plus" size={13} /> {label === 'Add' ? 'Fact' : label}</span>}
        footer={(close, q) => <button type="button" className="ap-pop-create" data-testid={`${testid}-fact-create`} onClick={() => { close(); openDrawer({ kind: 'variable', name: q, then: (made) => onAdd(starter(made)) }); }}><Icon name="plus" size={13} /> Create a variable{q ? ` called “${q}”` : ''}</button>} />
      {level === 'advanced' ? <Picker label="Use a saved condition" testid={`${testid}-saved`} items={conds} placeholder="Search saved conditions…" onPick={(id) => { setMode('condition'); const c = look.condition(id); if (c) onAdd({ op: 'ref', condition: c.code, version: pinOf(c) }); else pick(id); }}
        button={<span className="ap-btn quiet"><Icon name="condition" size={13} /> Saved condition</span>}
        footer={(close) => <button type="button" className="ap-pop-create" data-testid={`${testid}-saved-create`} onClick={() => { close(); openDrawer({ kind: 'condition', then: (made) => onAdd({ op: 'ref', condition: made.code, version: made.version }) }); }}><Icon name="plus" size={13} /> Create a condition</button>} /> : null}
      {allowGroup && level !== 'simple' ? <button type="button" className="ap-btn quiet" data-testid={`${testid}-group`} onClick={() => onAdd({ op: 'any', args: [] })}><Icon name="canvas" size={13} /> Group</button> : null}
    </span>
  );
}
export { valueLabel };
