// Survey Studio prototype — the condition drawer (Screens C and F).
// ONE contextual rule editor for both places a condition is used: "when does this module run?" (a survey's module
// instance) and a decision point inside a module. It starts with a sentence, never an expression box; the rule tree
// lives only here. Two things are kept visibly apart:
//   • the CONDITION — a definition. A library condition is shared and immutable: changing it means a new version
//     (only this placement moves to it) or a separate condition; other consumers are never changed silently.
//   • FOR THIS PLACEMENT — the binding: values for named settings, which earlier answer feeds each input, and (for a
//     module) what happens when information is missing. Missing information is never read as "no".
// Edits stay in the drawer until "Apply", which is one undoable step.
import { useMemo, useState } from 'react';
import { describeAst, evaluate, fieldDef, fieldsOf, inputsOf, VERDICT, type Answers, type EvalContext, type Explain, type Profile, type Tri } from './model/engine';
import { availableAnswers } from './model/flow';
import { activationOf, eligibilityOf, setActivation, setEligibility, setIfSkippedInSequence, conditionConsumers, findCondition, findModule, findQuestion, saveCondition, setDecisionBinding } from './model/ops';
import { OUTCOMES, FIELDS, OUTCOME_LABEL } from './model/sample';
import {
  isQuestion, mKey,
  type Ast, type Binding, type CompareOp, type Condition, type Instance, type Module, type OutcomeCode, type Question, type Survey,
  type UnknownPolicy, type Workspace,
} from './model/types';
import { useStudio } from './store';
import { Drawer, Glyph, Segmented, Tag } from './ui';

const short = (s: string, n = 72) => (s.length > n ? `${s.slice(0, n - 2)}…` : s);

/**
 * How a binding's earlier answers and option codes READ in a sentence. The condition stores only stable references
 * (question code and version, option codes, node ids); every word shown here is looked up at display time, so
 * renaming a question or an answer never changes what a condition depends on.
 */
export function sentenceContext(ws: Workspace, m: Module | undefined, b: Binding | undefined, numbers?: Map<string, string>, cond?: Condition): EvalContext {
  const c = cond ?? (b && b.condition.code ? findCondition(ws, b.condition) : undefined);
  const bound = (name: string): Question | undefined => {
    const node = m?.nodes.find((x) => x.id === b?.inputs?.[name]?.node);
    return node && isQuestion(node) ? findQuestion(ws, node.q) : undefined;
  };
  const declared = (name: string): Question | undefined => { const d = c?.inputs?.[name]; return d ? findQuestion(ws, d.question) : undefined; };
  return {
    inputLabel: (name) => {
      const id = b?.inputs?.[name]?.node;
      if (id && bound(name)) return `the answer to ${numbers?.get(id) ?? 'an earlier question'}`;
      const text = declared(name)?.wording.text.trim();
      return text ? `the answer to “${short(text, 44)}”` : 'an earlier answer (not chosen yet)';
    },
    optionLabel: (name, code) => `“${(bound(name) ?? declared(name))?.options.find((o) => o.code === code)?.label ?? code}”`,
  };
}

/** The sentence for any binding: "Annual premium is above 12,000 SGD and …". */
export function bindingSentence(ws: Workspace, b: Binding | null | undefined, m?: Module, numbers?: Map<string, string>): string | null {
  const c = b && b.condition.code ? findCondition(ws, b.condition) : undefined;
  return c ? describeAst(c.ast, c, b!, false, sentenceContext(ws, m, b!, numbers)) : null;
}

/** The compact sentence shown on the module card. */
export function entrySentence(ws: Workspace, survey: Survey, inst: Instance): string {
  const act = activationOf(inst);
  const elig = eligibilityOf(inst);
  let after = '';
  if (act) {
    const src = survey.sequence.find((x) => x.id === act.of);
    const name = src ? findModule(ws, mKey(src.module))?.name : 'a removed module';
    after = `after ${name} ends with ${act.outcomes.map((o) => OUTCOME_LABEL[o]).join(' or ') || '…'}`;
  }
  if (!elig) return after || 'always';
  const s = bindingSentence(ws, elig);
  const when = s ? `when ${short(s, after ? 52 : 74)}` : 'when … (condition missing)';
  return after ? `${after}, and only ${when}` : when;
}

type Mode = 'ALWAYS' | 'SAVED' | 'BUILD';
type GroupKind = 'ALL' | 'ANY' | 'NONE';
/** One line of the builder. `source` is a catalog field code, or `answer:<question node id>` for an earlier answer. */
interface Row { source: string; op: CompareOp; value: string; named: string | null }
interface Group { kind: GroupKind; rows: Row[]; groups: Group[] }

const NUM_OPS: Array<[CompareOp, string]> = [['GTE', 'is at least'], ['GT', 'is above'], ['LTE', 'is at most'], ['LT', 'is below'], ['EQ', 'is exactly']];
const OPS: Record<string, Array<[CompareOp, string]>> = {
  MONEY: NUM_OPS, INTEGER: NUM_OPS, ENUM: [['EQ', 'is'], ['NEQ', 'is not']], BOOLEAN: [['EQ', 'is']],
  ANSWER_ONE: [['EQ', 'is'], ['NEQ', 'is not']], ANSWER_MANY: [['INCLUDES_ANY', 'includes any of'], ['INCLUDES_ALL', 'includes all of'], ['INCLUDES_NONE', 'includes none of']],
};
/** Short codes such as ILP stay as written; longer values read as words. */
const enumText = (x: string) => (x.length <= 3 ? x : x.charAt(0) + x.slice(1).toLowerCase().replace(/_/g, ' '));
const newRow = (): Row => ({ source: 'policy.annual_premium', op: 'GTE', value: '', named: null });
const isAnswer = (r: Row) => r.source.startsWith('answer:');
const paramKey = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'value';

interface Built { ast: Ast; params: Condition['params']; inputs: NonNullable<Condition['inputs']>; values: Binding['params']; map: NonNullable<Binding['inputs']> }

/**
 * Builder rows → a condition definition (AST, named settings, typed answer declarations) plus this placement's binding.
 * An earlier answer is declared by the question's stable identity, pinned version and answer type; the binding maps the
 * declaration to the question instance (node) in this module. Option values are stable codes.
 */
function build(g: Group, qOf: (nodeId: string) => Question | undefined): Built {
  const out: Built = { ast: { op: 'AND', args: [] }, params: {}, inputs: {}, values: {}, map: {} };
  const keyFor = (node: string, q: Question): string => {
    const base = `in_${q.code.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    const key = out.map[base] && out.map[base].node !== node ? `${base}_${node}` : base; // two placements of one question in the same condition
    out.inputs[key] = { question: { code: q.code, version: q.version }, answerType: q.answerType, scope: 'MODULE' };
    out.map[key] = { node };
    return key;
  };
  const walk = (grp: Group): Ast => {
    const args: Ast[] = grp.rows.map((r): Ast => {
      if (isAnswer(r)) {
        const node = r.source.slice(7);
        const q = qOf(node)!;
        const many = q.answerType === 'MULTI_SELECT';
        return { op: r.op, left: { input: keyFor(node, q) }, right: { literal: many ? r.value.split(',').filter(Boolean) : r.value } };
      }
      const f = fieldDef(r.source)!;
      const v = f.type === 'BOOLEAN' ? r.value === 'true' : f.type === 'MONEY' || f.type === 'INTEGER' ? Number(r.value) : r.value;
      if (r.named !== null && (f.type === 'MONEY' || f.type === 'INTEGER')) {
        const key = paramKey(r.named || `${f.label} value`);
        out.params[key] = { type: f.type, label: r.named.trim() || `${f.label} value`, ...(f.unit ? { unit: f.unit } : {}) };
        out.values[key] = v as number;
        return { op: r.op, left: { field: r.source }, right: { param: key } };
      }
      return { op: r.op, left: { field: r.source }, right: { literal: v } };
    });
    args.push(...grp.groups.map(walk));
    const body: Ast = args.length === 1 ? args[0]! : grp.kind === 'ALL' ? { op: 'AND', args } : { op: 'OR', args };
    return grp.kind === 'NONE' ? { op: 'NOT', arg: body } : body;
  };
  out.ast = walk(g);
  return out;
}

/** A condition definition and a binding → builder rows (so an existing condition can be changed as a new version). */
function unbuild(c: Condition, b: Binding | undefined): Group {
  const row = (a: Extract<Ast, { left: unknown }>): Row | null => {
    if ('input' in a.left) {
      const node = b?.inputs?.[a.left.input]?.node;
      return node && 'literal' in a.right ? { source: `answer:${node}`, op: a.op, value: Array.isArray(a.right.literal) ? a.right.literal.join(',') : String(a.right.literal), named: null } : null;
    }
    if (!('field' in a.left)) return null;
    if ('param' in a.right) return { source: a.left.field, op: a.op, value: String(b?.params[a.right.param] ?? ''), named: c.params[a.right.param]?.label ?? a.right.param };
    return 'literal' in a.right && !Array.isArray(a.right.literal) ? { source: a.left.field, op: a.op, value: String(a.right.literal), named: null } : null;
  };
  const walk = (ast: Ast): Group => {
    if (ast.op === 'NOT') return { ...walk(ast.arg), kind: 'NONE' };
    if (ast.op === 'AND' || ast.op === 'OR') {
      const g: Group = { kind: ast.op === 'AND' ? 'ALL' : 'ANY', rows: [], groups: [] };
      for (const a of ast.args) {
        if (a.op === 'AND' || a.op === 'OR' || a.op === 'NOT') g.groups.push(walk(a));
        else { const r = row(a); if (r) g.rows.push(r); }
      }
      return g;
    }
    const r = row(ast);
    return { kind: 'ALL', groups: [], rows: r ? [r] : [] };
  };
  return walk(c.ast);
}

const complete = (g: Group): boolean => (g.rows.length + g.groups.length > 0)
  && g.rows.every((r) => r.value !== '' && (isAnswer(r) || ['ENUM', 'BOOLEAN'].includes(fieldDef(r.source)?.type ?? '') || !Number.isNaN(Number(r.value))))
  && g.groups.every(complete);

/** Where the drawer was opened: a module instance in a survey, or a decision point inside a module. */
export type RuleContext =
  | { kind: 'ENTRY'; survey: Survey; instanceId: string }
  | { kind: 'DECISION'; moduleKey: string; nodeId: string; number: string; numbers: Map<string, string> };

export function EntryRuleDrawer({ survey, instanceId, onClose }: { survey: Survey; instanceId: string; onClose: () => void }) {
  return <RuleDrawer ctx={{ kind: 'ENTRY', survey, instanceId }} onClose={onClose} />;
}

export function RuleDrawer({ ctx, onClose }: { ctx: RuleContext; onClose: () => void }) {
  const { ws, apply } = useStudio();
  const entry = ctx.kind === 'ENTRY';
  const index = entry ? ctx.survey.sequence.findIndex((x) => x.id === ctx.instanceId) : -1;
  const inst = entry ? ctx.survey.sequence[index]! : undefined;
  const m = entry ? findModule(ws, mKey(inst!.module))! : findModule(ws, ctx.moduleKey)!;
  const decision = !entry ? m.nodes.find((x) => x.id === ctx.nodeId) : undefined;
  const existing: Binding | null = entry ? eligibilityOf(inst!) : (decision && !isQuestion(decision) ? decision.binding : null);
  const current = existing && existing.condition.code ? findCondition(ws, existing.condition) : undefined;
  const earlier = entry ? ctx.survey.sequence.slice(0, index) : [];
  const nodeId = entry ? '' : ctx.nodeId;
  const numbers = entry ? undefined : ctx.numbers;
  const label = entry ? m.name : ctx.number;

  // earlier answers a decision may read: every route passes through them (always), or only some routes (sometimes)
  const avail = useMemo(() => (nodeId ? availableAnswers(m, nodeId) : { always: [], sometimes: [] }), [m, nodeId]);
  const qOf = (id: string): Question | undefined => { const n = m.nodes.find((x) => x.id === id); return n && isQuestion(n) ? findQuestion(ws, n.q) : undefined; };
  const answerName = (id: string) => `${numbers?.get(id) ?? '?'} ${short(qOf(id)?.wording.text || 'Untitled question', 38)}`;

  const [mode, setMode] = useState<Mode>(existing && current ? (current.shared ? 'SAVED' : 'BUILD') : entry ? 'ALWAYS' : 'BUILD');
  const act0 = entry ? activationOf(inst!) : null;
  /** Activation and eligibility are two independent settings (A-2): this is whether the module waits for a named outcome. */
  const [waits, setWaits] = useState(!!act0);
  /** What happens when the module is reached in sequence and is not eligible: '' = the default (the next module). */
  const [seqSkip, setSeqSkip] = useState(() => { const t = entry ? inst!.ifSkippedInSequence : undefined; return !t || t === '@CONTINUE' ? '' : 'instance' in t ? `i:${t.instance}` : `o:${t.surveyOutcome}`; });
  const [savedRef, setSavedRef] = useState(current?.shared ? `${current.code}@${current.version}` : '');
  const [params, setParams] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(existing?.params ?? {}).map(([k, v]) => [k, String(v)])));
  const [inputMap, setInputMap] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(existing?.inputs ?? {}).map(([k, v]) => [k, v.node])));
  const [group, setGroup] = useState<Group>(() => (current && !current.shared ? unbuild(current, existing ?? undefined) : { kind: 'ALL', rows: [newRow()], groups: [] }));
  const [policy, setPolicy] = useState<UnknownPolicy | null>(entry && existing ? existing.unknownPolicy : null);
  const [reusable, setReusable] = useState(false);
  const [name, setName] = useState('');
  /** Set when the author chose to change a library condition: what the edited result becomes. */
  const [derive, setDerive] = useState<{ kind: 'VERSION' | 'COPY'; from: Condition } | null>(null);
  const [changing, setChanging] = useState(false);
  const [of, setOf] = useState(act0 ? act0.of : earlier[earlier.length - 1]?.id ?? '');
  const [outs, setOuts] = useState<OutcomeCode[]>(act0 ? act0.outcomes : []);
  const [profile, setProfile] = useState<Profile>({ 'policy.product_family': 'ILP', 'policy.annual_premium': 15000, 'policy.sum_assured': 300000, 'policy.is_replacement': false, 'customer.age_years': 45, 'sale.channel': 'AGENCY' });
  const [answers, setAnswers] = useState<Answers>({});

  const saved = ws.conditions.find((c) => `${c.code}@${c.version}` === savedRef);
  const built = mode === 'BUILD' && complete(group) ? build(group, qOf) : null;
  const cond: Condition | null = mode === 'SAVED' ? saved ?? null
    : mode === 'BUILD' && built ? { code: 'C-PREVIEW', version: 1, name: name || 'This rule', ast: built.ast, params: built.params, inputs: built.inputs, shared: false } : null;
  const binding: Binding | null = !cond ? null : mode === 'BUILD' && built
    ? { condition: { code: cond.code, version: cond.version }, params: built.values, inputs: built.map, unknownPolicy: policy }
    : {
      condition: { code: cond.code, version: cond.version }, unknownPolicy: policy,
      params: Object.fromEntries(Object.keys(cond.params).filter((k) => params[k] !== undefined && params[k] !== '').map((k) => [k, Number(params[k])])),
      inputs: Object.fromEntries(Object.keys(cond.inputs ?? {}).filter((k) => inputMap[k]).map((k) => [k, { node: inputMap[k]! }])),
    };
  const paramsMissing = mode === 'SAVED' && !!cond && Object.keys(cond.params).some((k) => params[k] === undefined || params[k] === '');
  const inputsMissing = mode === 'SAVED' && !!cond && Object.keys(cond.inputs ?? {}).some((k) => !inputMap[k]);
  const sctx: EvalContext = { ...sentenceContext(ws, m, binding ?? undefined, numbers, cond ?? undefined), answers };
  const explain = cond && binding && !paramsMissing ? evaluate(cond.ast, cond, binding, profile, sctx) : null;
  const consumers = saved ? conditionConsumers(ws, saved.code) : [];
  const others = derive ? conditionConsumers(ws, derive.from.code).length - (existing?.condition.code === derive.from.code ? 1 : 0) : 0;

  const blocker =
    mode === 'SAVED' && !saved ? 'Choose a library condition.'
      : mode === 'BUILD' && !built ? 'Finish the condition: every line needs a value.'
        : paramsMissing ? 'Fill in the values for this placement.'
          : inputsMissing ? 'Choose which earlier answer the condition reads.'
            : entry && (mode === 'SAVED' || mode === 'BUILD') && !policy ? 'Choose what happens when information is missing.'
              : mode === 'BUILD' && (reusable || derive?.kind === 'COPY') && !name.trim() ? 'Name the condition so others can find it.'
                : entry && waits && (!of || !outs.length || !earlier.some((x) => x.id === of)) ? 'Choose the earlier module and at least one outcome that selects this one.' : null;

  const applyRule = () => {
    if (blocker) return;
    const done = entry ? `Changed when ${m.name} runs` : `Set the condition of ${label}`;
    // the two settings are written independently: the activation trigger, then the eligibility condition
    const trigger = (w: Workspace) => (ctx.kind === 'ENTRY' ? setActivation(w, ctx.survey.id, ctx.instanceId, waits ? { of, outcomes: outs } : null) : w);
    const bind = (w: Workspace, b: Binding) => (ctx.kind === 'ENTRY'
      ? setIfSkippedInSequence(setEligibility(trigger(w), ctx.survey.id, ctx.instanceId, b), ctx.survey.id, ctx.instanceId, !seqSkip ? null : seqSkip.startsWith('i:') ? { instance: seqSkip.slice(2) } : { surveyOutcome: seqSkip.slice(2) as OutcomeCode })
      : setDecisionBinding(w, ctx.moduleKey, ctx.nodeId, b));
    if (ctx.kind === 'ENTRY' && mode === 'ALWAYS') apply(done, (w) => setIfSkippedInSequence(setEligibility(trigger(w), ctx.survey.id, ctx.instanceId, null), ctx.survey.id, ctx.instanceId, null));
    else if (mode === 'SAVED' && binding) apply(done, (w) => bind(w, binding));
    else if (mode === 'BUILD' && built && binding) {
      const shared = reusable || !!derive;
      const newName = derive?.kind === 'VERSION' ? derive.from.name : shared ? name.trim() : entry ? `Rule for ${m.name}` : `Rule in ${m.name}`;
      const text = derive?.kind === 'VERSION' ? `New version of "${derive.from.name}" — only ${entry ? 'this module' : label} uses it`
        : shared ? `Added the condition "${newName}" to the library and applied it` : done;
      apply(text, (w) => {
        const [w2, c] = saveCondition(w, { name: newName, ast: built.ast, params: built.params, inputs: built.inputs, shared, ...(derive?.kind === 'VERSION' ? { code: derive.from.code } : {}) });
        return bind(w2, { ...binding, condition: { code: c.code, version: c.version } });
      });
    }
    onClose();
  };

  const ofName = earlier.find((x) => x.id === of) ? findModule(ws, mKey(earlier.find((x) => x.id === of)!.module))?.name : '…';
  const afterText = `after ${ofName} ends with ${outs.map((o) => OUTCOME_LABEL[o]).join(' or ') || '…'}`;
  const ruleText = cond && binding ? describeAst(cond.ast, cond, binding, false, sctx) : '…';
  const sentence = !entry ? (cond && binding ? `It matches when ${ruleText}.` : 'It matches when…')
    : waits ? (mode === 'ALWAYS' ? `This module runs ${afterText}.` : `This module is selected ${afterText}. It then runs only when ${ruleText}.`)
      : mode === 'ALWAYS' ? 'This module always runs.' : cond && binding ? `This module runs when ${ruleText}.` : 'This module runs when…';

  const modes: Array<{ value: Mode; label: string }> = entry
    ? [{ value: 'ALWAYS', label: 'No condition' }, { value: 'SAVED', label: 'Library condition' }, { value: 'BUILD', label: 'Build a condition' }]
    : [{ value: 'BUILD', label: 'Build a condition' }, { value: 'SAVED', label: 'Library condition' }];

  return (
    <Drawer title={entry ? `When does ${m.name} run?` : `What does ${label} check?`} onClose={onClose}
      subtitle={entry ? 'Applies to this place in this survey only. The library module is not changed.' : 'A decision point asks nothing. It checks a condition and leads one of three ways: matches, otherwise, or unknown.'}
      footer={<>
        {blocker ? <span className="ss-drawer-blocker" role="status"><Glyph name="alert" size={14} /> {blocker}</span> : <span />}
        <span className="ss-actions">
          <button type="button" className="ss-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ss-btn primary" disabled={!!blocker} onClick={applyRule} data-testid="ss-rule-apply">Apply</button>
        </span>
      </>}>
      <p className="ss-sentence" data-testid="ss-rule-sentence">{sentence}</p>

      {entry ? (
        <section className="ss-entry-part" aria-label="When it is selected" data-testid="ss-activation">
          <h3>1 · When it is selected <span>activation</span></h3>
          <Segmented<'SEQ' | 'OUT'> label="When this module is selected" value={waits ? 'OUT' : 'SEQ'} onChange={(v) => setWaits(v === 'OUT')}
            options={[{ value: 'SEQ', label: 'In sequence', hint: 'When the survey reaches it' }, { value: 'OUT', label: 'After an outcome', hint: 'Only after an earlier module ends a named way' }]} />
          <p className="ss-note" data-testid="ss-activation-note"><Glyph name="info" size={14} />
            <span><strong>Activation</strong> decides <em>when the module is selected</em>{waits ? ': only after the earlier module ends that way' : ': when the survey reaches it in order'}. Another module can also select it with an explicit jump. It is not a condition on the customer.</span></p>
          {waits ? (
            <div className="ss-block">
              {earlier.length === 0 ? <p className="ss-warn-text"><Glyph name="alert" size={14} /> No module runs before this one, so there is no outcome to wait for.</p> : (
                <>
                  <label className="ss-field"><span>Wait for</span>
                    <select value={of} onChange={(e) => { setOf(e.target.value); setOuts([]); }} data-testid="ss-rule-of">
                      {earlier.map((x) => <option key={x.id} value={x.id}>{findModule(ws, mKey(x.module))?.name}</option>)}
                    </select></label>
                  <fieldset className="ss-checks"><legend>Select this module when it ends with</legend>
                    {(findModule(ws, mKey(earlier.find((x) => x.id === of)?.module ?? inst!.module))?.outcomes ?? []).filter((o) => o !== 'REVIEW_REQUIRED' /* that outcome always halts the call: nothing can follow it */).map((o) => (
                      <label key={o} className="ss-check"><input type="checkbox" checked={outs.includes(o)} onChange={(e) => setOuts(e.target.checked ? [...outs, o] : outs.filter((x) => x !== o))} />
                        <span>{OUTCOME_LABEL[o]}</span></label>
                    ))}
                  </fieldset>
                </>
              )}
            </div>
          ) : null}
          <h3>2 · Whether it may run <span>eligibility</span></h3>
        </section>
      ) : null}
      <Segmented<Mode> label={entry ? 'Whether this module may run' : 'Where the condition comes from'} value={mode}
        onChange={(v) => { setMode(v); setDerive(null); setChanging(false); }} options={modes} />
      {entry ? (
        <p className="ss-note" data-testid="ss-rule-kind-note"><Glyph name="info" size={14} />
          <span><strong>Eligibility</strong> decides <em>whether the selected module may run</em>{mode === 'ALWAYS' ? ': with no condition, it runs whenever it is selected' : ' for this customer'}. However it was selected — in sequence, after an outcome or by a jump — this is still checked. A jump never bypasses it.</span></p>
      ) : null}

      {mode === 'SAVED' ? (
        <>
          <section className="ss-zone definition" aria-label="The condition (shared definition)" data-testid="ss-zone-definition">
            <h3><Glyph name="lock" size={14} /> The condition <span>shared definition</span></h3>
            <label className="ss-field"><span>Library condition</span>
              <select value={savedRef} onChange={(e) => { setSavedRef(e.target.value); setChanging(false); }} data-testid="ss-rule-saved">
                <option value="">Choose…</option>
                {ws.conditions.filter((c) => c.shared).map((c) => <option key={`${c.code}@${c.version}`} value={`${c.code}@${c.version}`}>{c.name} · v{c.version}</option>)}
              </select></label>
            {saved ? (
              <>
                <p className="ss-zone-fact" data-testid="ss-rule-definition">{describeAst(saved.ast, saved, undefined, false, sentenceContext(ws, m, undefined, numbers, saved))}</p>
                <p className="ss-muted"><Tag tone="shared" glyph="link">v{saved.version} · used in {consumers.length} place{consumers.length === 1 ? '' : 's'}</Tag> Shared. What it checks is the same wherever it is used.</p>
                {changing ? (
                  <div className="ss-impact" data-testid="ss-rule-impact">
                    <strong>Changing “{saved.name}”</strong>
                    {consumers.length ? <><p>It is used here:</p><ul>{consumers.map((u, i) => {
                      const here = ctx.kind === 'DECISION' && u.moduleKey === ctx.moduleKey;
                      return <li key={i}>{u.label}{here ? ` ${numbers?.get(u.nodeId ?? '') ?? ''}` : ''} <span className="ss-code">v{u.version}</span>{here && u.nodeId === nodeId ? <strong> · this placement</strong> : null}</li>;
                    })}</ul></> : <p>Nothing uses it yet.</p>}
                    <p>None of these change. Choose what your edited copy becomes:</p>
                    <div className="ss-choices">
                      <button type="button" className="ss-choice-btn" data-testid="ss-rule-new-version"
                        onClick={() => { setGroup(unbuild(saved, binding ?? undefined)); setDerive({ kind: 'VERSION', from: saved }); setMode('BUILD'); setChanging(false); }}>
                        <strong>A new version, for this placement</strong><small>“{saved.name}” version {Math.max(...ws.conditions.filter((c) => c.code === saved.code).map((c) => c.version)) + 1}. Every other place keeps its version until someone upgrades it.</small></button>
                      <button type="button" className="ss-choice-btn" data-testid="ss-rule-copy"
                        onClick={() => { setGroup(unbuild(saved, binding ?? undefined)); setDerive({ kind: 'COPY', from: saved }); setName(`${saved.name} (copy)`); setMode('BUILD'); setChanging(false); }}>
                        <strong>A separate condition</strong><small>A new library condition with its own name, starting as a copy.</small></button>
                    </div>
                  </div>
                ) : <button type="button" className="ss-link" onClick={() => setChanging(true)} data-testid="ss-rule-change"><Glyph name="lock" size={13} /> Change what this condition checks…</button>}
              </>
            ) : null}
          </section>
          {saved && (Object.keys(saved.params).length || Object.keys(saved.inputs ?? {}).length) ? (
            <section className="ss-zone binding" aria-label="For this placement" data-testid="ss-zone-binding">
              <h3>For this placement <span>changes nothing elsewhere</span></h3>
              {Object.entries(saved.params).map(([k, p]) => (
                <label key={k} className="ss-field"><span>{p.label}{p.unit ? ` (${p.unit})` : ''}</span>
                  <input inputMode="numeric" value={params[k] ?? ''} onChange={(e) => setParams({ ...params, [k]: e.target.value.replace(/[^0-9.]/g, '') })} data-testid={`ss-param-${k}`} /></label>
              ))}
              {Object.entries(saved.inputs ?? {}).map(([k, decl]) => {
                // typed reference: only placements of the declared question (same stable code) can supply this answer
                const fits = (id: string) => { const n = m.nodes.find((x) => x.id === id); return !!n && isQuestion(n) && n.q.code === decl.question.code; };
                const always = avail.always.filter(fits), sometimes = avail.sometimes.filter(fits);
                return (
                  <label key={k} className="ss-field"><span>Which earlier answer is “{short(findQuestion(ws, decl.question)?.wording.text || decl.question.code, 60)}”?</span>
                    <select value={inputMap[k] ?? ''} onChange={(e) => setInputMap({ ...inputMap, [k]: e.target.value })} data-testid={`ss-input-${k}`}>
                      <option value="">{always.length + sometimes.length ? 'Choose…' : 'This question is not asked before this point'}</option>
                      {always.map((id) => <option key={id} value={id}>{answerName(id)}</option>)}
                      {sometimes.map((id) => <option key={id} value={id}>{answerName(id)} — not always asked</option>)}
                    </select>
                    <em>Reads <span className="ss-code">{decl.question.code} · v{decl.question.version}</span> by its answer codes, not its wording.</em></label>
                );
              })}
            </section>
          ) : null}
        </>
      ) : null}

      {mode === 'BUILD' ? (
        <section className="ss-zone definition" aria-label="The condition" data-testid="ss-zone-definition">
          <h3>The condition {derive ? <span>{derive.kind === 'VERSION' ? `new version of “${derive.from.name}”` : 'a separate library condition'}</span> : <span>{reusable ? 'will be added to the library' : 'for this placement only'}</span>}</h3>
          {derive ? <p className="ss-muted" data-testid="ss-rule-derive-note"><Glyph name="info" size={13} /> {others > 0 ? `${others} other place${others === 1 ? ' keeps the version it has' : 's keep the version they have'}.` : 'No other place uses this condition.'} Only this placement will use what you build here.</p> : null}
          <GroupEditor group={group} onChange={setGroup} depth={0} always={avail.always} sometimes={avail.sometimes} answerName={answerName} qOf={qOf} />
          {!entry ? (
            <details className="ss-known" data-testid="ss-rule-known">
              <summary>What is known at this point</summary>
              <p className="ss-muted">Customer and policy details can always be checked. Earlier answers:</p>
              <ul>
                {avail.always.length + avail.sometimes.length === 0 ? <li className="ss-muted">No question is asked before this decision.</li> : null}
                {avail.always.map((id) => <li key={id}><Glyph name="check" size={13} /><span><strong>{answerName(id)}</strong> — always asked before this.</span></li>)}
                {avail.sometimes.map((id) => <li key={id}><Glyph name="alert" size={13} /><span><strong>{answerName(id)}</strong> — asked on some routes only. When it was not asked, the result is Unknown.</span></li>)}
              </ul>
            </details>
          ) : null}
          {!derive ? (
            <label className="ss-check"><input type="checkbox" checked={reusable} onChange={(e) => setReusable(e.target.checked)} data-testid="ss-rule-reusable" />
              <span><strong>Also add it to the reusable library</strong><small>Otherwise it belongs to this placement only. (Prototype: held in memory, not saved.)</small></span></label>
          ) : null}
          {(reusable && !derive) || derive?.kind === 'COPY' ? <label className="ss-field"><span>Condition name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Large premium for older customer" data-testid="ss-rule-name" /></label> : null}
        </section>
      ) : null}

      {entry && (mode === 'SAVED' || mode === 'BUILD') ? (
        <label className="ss-field" data-testid="ss-seq-skip-field"><span>If it does not apply when reached in sequence</span>
          <select value={seqSkip} onChange={(e) => setSeqSkip(e.target.value)} data-testid="ss-seq-skip">
            <option value="">{index === ctx.survey.sequence.length - 1 ? 'End the call: Completed (the normal default)' : 'Continue to the next module (the normal default)'}</option>
            {ctx.survey.sequence.slice(index + 2).map((x) => <option key={x.id} value={`i:${x.id}`}>Go to {findModule(ws, mKey(x.module))?.name} — its own condition is checked in turn</option>)}
            {OUTCOMES.filter((x) => x !== 'COMPLETED').map((x) => <option key={x} value={`o:${x}`}>End the call: {OUTCOME_LABEL[x]}</option>)}
          </select>
          <small className="ss-muted">When another module jumps here, what happens is chosen on the module’s card: after a jump nothing is assumed.</small></label>
      ) : null}
      {entry && (mode === 'SAVED' || mode === 'BUILD') ? (
        <fieldset className={`ss-choice stack ${policy ? '' : 'needed'}`}>
          <legend>If the information is missing</legend>
          <label className={policy === 'BLOCK' ? 'on' : ''}><input type="radio" name="unknown" checked={policy === 'BLOCK'} onChange={() => setPolicy('BLOCK')} data-testid="ss-policy-block" />
            <span><strong>Stop and flag for review</strong><small>The call does not continue until someone checks the data.</small></span></label>
          <label className={policy === 'SKIP_WITH_REASON' ? 'on' : ''}><input type="radio" name="unknown" checked={policy === 'SKIP_WITH_REASON'} onChange={() => setPolicy('SKIP_WITH_REASON')} data-testid="ss-policy-skip" />
            <span><strong>Skip this module and record why</strong><small>The skip is logged as "information missing", not as "did not match".</small></span></label>
          <p className="ss-muted">Missing information is never treated as "does not match".</p>
        </fieldset>
      ) : null}
      {!entry ? <p className="ss-note" data-testid="ss-rule-unknown-note"><Glyph name="info" size={14} /><span>When something the condition needs is missing, the result is <strong>Unknown</strong> — never "otherwise". Where Unknown leads is set on the decision card.</span></p> : null}

      {cond ? (
        <section className="ss-test" aria-label="Try it with sample values">
          <h3>Try it with sample values</h3>
          <div className="ss-test-fields">
            {fieldsOf(cond.ast).map((code) => {
              const f = fieldDef(code)!;
              const v = profile[code];
              const set = (nv: Profile[string]) => setProfile({ ...profile, [code]: nv });
              return (
                <label key={code} className="ss-field"><span>{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
                  {f.type === 'ENUM' ? (
                    <select value={v === null || v === undefined ? '' : String(v)} onChange={(e) => set(e.target.value || null)} data-testid={`ss-sample-${code}`}>
                      <option value="">Missing</option>{f.values!.map((x) => <option key={x} value={x}>{enumText(x)}</option>)}
                    </select>
                  ) : f.type === 'BOOLEAN' ? (
                    <select value={v === null || v === undefined ? '' : String(v)} onChange={(e) => set(e.target.value === '' ? null : e.target.value === 'true')} data-testid={`ss-sample-${code}`}>
                      <option value="">Missing</option><option value="true">Yes</option><option value="false">No</option>
                    </select>
                  ) : (
                    <input inputMode="numeric" placeholder="Missing" value={v === null || v === undefined ? '' : String(v)} data-testid={`ss-sample-${code}`}
                      onChange={(e) => { const t = e.target.value.replace(/[^0-9.]/g, ''); set(t === '' ? null : Number(t)); }} />
                  )}
                </label>
              );
            })}
            {binding ? inputsOf(cond.ast).map((key) => {
              const node = binding.inputs?.[key]?.node;
              const q = node ? qOf(node) : undefined;
              if (!node || !q) return null;
              const multi = q.answerType === 'MULTI_SELECT';
              const cur = answers[node];
              if (multi) {
                // three different states: not answered (unknown), answered with nothing selected (a known empty selection), answered
                const chosen = Array.isArray(cur) ? cur : null;
                return (
                  <fieldset key={key} className="ss-field ss-sample-many" data-testid={`ss-sample-answer-${node}`}>
                    <legend>Answer to {numbers?.get(node) ?? 'the earlier question'}</legend>
                    <label className="ss-check"><input type="checkbox" checked={chosen === null} onChange={(e) => setAnswers({ ...answers, [node]: e.target.checked ? null : [] })} data-testid={`ss-sample-unanswered-${node}`} /><span>Not answered yet</span></label>
                    <div className="ss-rule-opts">
                      {q.options.map((o) => {
                        const on = !!chosen?.includes(o.code);
                        return <button key={o.code} type="button" className={`ss-rule-opt ${on ? 'on' : ''}`} aria-pressed={on} disabled={chosen === null} data-testid={`ss-sample-answer-${node}-${o.code}`}
                          onClick={() => setAnswers({ ...answers, [node]: on ? chosen!.filter((c) => c !== o.code) : [...(chosen ?? []), o.code] })}>{o.label}</button>;
                      })}
                    </div>
                    {chosen && !chosen.length ? <em>Answered, with nothing selected — a known empty selection, not "missing".</em> : null}
                  </fieldset>
                );
              }
              return (
                <label key={key} className="ss-field"><span>Answer to {numbers?.get(node) ?? 'the earlier question'}</span>
                  <select value={typeof cur === 'string' ? cur : ''} data-testid={`ss-sample-answer-${node}`}
                    onChange={(e) => setAnswers({ ...answers, [node]: e.target.value === '' ? null : e.target.value })}>
                    <option value="">Not answered yet</option>
                    {q.options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </select></label>
              );
            }) : null}
          </div>
          {explain ? <Verdict explain={explain} policy={policy} entry={entry} /> : <p className="ss-muted">Fill in the values above to see the result.</p>}
        </section>
      ) : null}
    </Drawer>
  );
}

const TONE: Record<Tri, string> = { TRUE: 'ok', FALSE: 'no', UNKNOWN: 'unknown' };

function Verdict({ explain, policy, entry }: { explain: Explain; policy: UnknownPolicy | null; entry: boolean }) {
  const then = entry
    ? (explain.result === 'TRUE' ? 'The module runs.'
      : explain.result === 'FALSE' ? 'The module is skipped: the condition does not match.'
        : policy === 'BLOCK' ? 'The call stops here and is flagged for review.'
          : policy === 'SKIP_WITH_REASON' ? 'The module is skipped and "information missing" is recorded.'
            : 'Choose above what should happen in this case.')
    : (explain.result === 'TRUE' ? 'The decision takes its "Matches" route.'
      : explain.result === 'FALSE' ? 'The decision takes its "Otherwise" route.'
        : 'The decision takes its "Unknown" route — it is not treated as "otherwise".');
  return (
    <div className={`ss-verdict ${TONE[explain.result]}`} data-testid="ss-verdict">
      <div className="ss-verdict-head"><strong data-testid="ss-verdict-result">{VERDICT[explain.result]}</strong><span>{then}</span></div>
      <ExplainTree e={explain} />
      <p className="ss-muted">Worked out by the prototype's demonstration evaluator.</p>
    </div>
  );
}

export function ExplainTree({ e }: { e: Explain }) {
  return (
    <div className="ss-explain">
      <div className="ss-explain-line"><span className={`ss-dot ${TONE[e.result]}`} aria-hidden="true" /><span>{e.label}</span><em>{VERDICT[e.result]}</em></div>
      {e.children ? <div className="ss-explain-kids">{e.children.map((c, i) => <ExplainTree key={i} e={c} />)}</div> : null}
    </div>
  );
}

const KIND_TEXT: Record<GroupKind, string> = { ALL: 'All of these', ANY: 'Any of these', NONE: 'None of these' };

function GroupEditor({ group, onChange, depth, onRemove, always, sometimes, answerName, qOf }: {
  group: Group; onChange: (g: Group) => void; depth: number; onRemove?: () => void;
  always: string[]; sometimes: string[]; answerName: (id: string) => string; qOf: (id: string) => Question | undefined;
}) {
  const setRow = (i: number, patch: Partial<Row>) => onChange({ ...group, rows: group.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const typeOf = (r: Row) => (isAnswer(r) ? (qOf(r.source.slice(7))?.answerType === 'MULTI_SELECT' ? 'ANSWER_MANY' : 'ANSWER_ONE') : fieldDef(r.source)!.type);
  const pickSource = (i: number, r: Row, source: string) => {
    const next: Row = { ...r, source };
    const t = typeOf(next);
    const keep = OPS[t]!.some(([op]) => op === r.op); // keep the comparison when it still applies
    const f = fieldDef(source);
    setRow(i, { source, op: keep ? r.op : OPS[t]![0]![0], named: null, value: t === 'ANSWER_MANY' ? '' : isAnswer(next) ? qOf(source.slice(7))?.options[0]?.code ?? '' : f?.type === 'BOOLEAN' ? 'true' : f?.type === 'ENUM' ? f.values![0]! : '' });
  };
  return (
    <div className={`ss-group depth-${depth}`} data-testid={`ss-group-${depth}`}>
      <div className="ss-group-head">
        <select value={group.kind} aria-label="How the lines combine" onChange={(e) => onChange({ ...group, kind: e.target.value as GroupKind })} data-testid={`ss-group-kind-${depth}`}>
          {(Object.keys(KIND_TEXT) as GroupKind[]).map((k) => <option key={k} value={k}>{KIND_TEXT[k]}</option>)}
        </select>
        {onRemove ? <button type="button" className="ss-icon-btn" onClick={onRemove} aria-label="Remove this group"><Glyph name="trash" /></button> : null}
      </div>
      {group.rows.map((r, i) => {
        const t = typeOf(r);
        const f = fieldDef(r.source);
        const q = isAnswer(r) ? qOf(r.source.slice(7)) : undefined;
        const numeric = t === 'MONEY' || t === 'INTEGER';
        return (
          <div key={i} className="ss-cond-line">
            <div className="ss-cond-row">
              <select aria-label="What to check" value={r.source} data-testid={`ss-cond-field-${depth}-${i}`} onChange={(e) => pickSource(i, r, e.target.value)}>
                <optgroup label="Customer and policy">{FIELDS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</optgroup>
                {always.length || sometimes.length ? (
                  <optgroup label="Earlier answers">
                    {always.map((id) => <option key={id} value={`answer:${id}`}>Answer to {answerName(id)}</option>)}
                    {sometimes.map((id) => <option key={id} value={`answer:${id}`}>Answer to {answerName(id)} — not always asked</option>)}
                  </optgroup>
                ) : null}
              </select>
              <select aria-label="Comparison" value={r.op} onChange={(e) => setRow(i, { op: e.target.value as CompareOp })} data-testid={`ss-cond-op-${depth}-${i}`}>
                {OPS[t]!.map(([op, text]) => <option key={op} value={op}>{text}</option>)}
              </select>
              {q && t === 'ANSWER_MANY' ? (
                <span className="ss-muted">{r.value ? `${r.value.split(',').length} chosen` : 'choose below'}</span>
              ) : q ? (
                <select aria-label="Answer" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} data-testid={`ss-cond-value-${depth}-${i}`}>{q.options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select>
              ) : t === 'ENUM' ? (
                <select aria-label="Value" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })}>{f!.values!.map((x) => <option key={x} value={x}>{enumText(x)}</option>)}</select>
              ) : t === 'BOOLEAN' ? (
                <select aria-label="Value" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })}><option value="true">Yes</option><option value="false">No</option></select>
              ) : (
                <span className="ss-unit-input"><input aria-label="Value" inputMode="numeric" value={r.value} placeholder="Value" data-testid={`ss-cond-value-${depth}-${i}`}
                  onChange={(e) => setRow(i, { value: e.target.value.replace(/[^0-9.]/g, '') })} />{f?.unit ? <em>{f.unit}</em> : null}</span>
              )}
              <button type="button" className="ss-icon-btn" aria-label="Remove this line" onClick={() => onChange({ ...group, rows: group.rows.filter((_, k) => k !== i) })}><Glyph name="close" /></button>
            </div>
            {q && t === 'ANSWER_MANY' ? (
              <div className="ss-rule-opts" role="group" aria-label="Answers to look for">
                {q.options.map((o) => {
                  const codes = r.value.split(',').filter(Boolean);
                  const on = codes.includes(o.code);
                  return <button key={o.code} type="button" className={`ss-rule-opt ${on ? 'on' : ''}`} aria-pressed={on} data-testid={`ss-cond-code-${depth}-${i}-${o.code}`}
                    onClick={() => setRow(i, { value: q.options.map((x) => x.code).filter((c) => (c === o.code ? !on : codes.includes(c))).join(',') })}>{on ? <Glyph name="check" size={12} /> : null} {o.label}</button>;
                })}
              </div>
            ) : null}
            {numeric ? (
              r.named === null
                ? <button type="button" className="ss-link quiet" onClick={() => setRow(i, { named: `${f!.label} threshold` })} data-testid={`ss-cond-name-${depth}-${i}`}>Make this value a named setting</button>
                : (
                  <label className="ss-named"><span>Named setting — each place that uses the condition sets its own value</span>
                    <span className="ss-named-row"><input value={r.named} aria-label="Name of the setting" onChange={(e) => setRow(i, { named: e.target.value })} data-testid={`ss-cond-named-${depth}-${i}`} />
                      <button type="button" className="ss-link quiet" onClick={() => setRow(i, { named: null })}>Use a fixed value</button></span></label>
                )
            ) : null}
          </div>
        );
      })}
      {group.groups.map((g, i) => (
        <GroupEditor key={i} group={g} depth={depth + 1} always={always} sometimes={sometimes} answerName={answerName} qOf={qOf}
          onChange={(ng) => onChange({ ...group, groups: group.groups.map((x, k) => (k === i ? ng : x)) })}
          onRemove={() => onChange({ ...group, groups: group.groups.filter((_, k) => k !== i) })} />
      ))}
      <div className="ss-group-add">
        <button type="button" className="ss-link" onClick={() => onChange({ ...group, rows: [...group.rows, newRow()] })} data-testid={`ss-cond-add-${depth}`}><Glyph name="plus" size={13} /> Add a line</button>
        {depth < 2 ? <button type="button" className="ss-link" onClick={() => onChange({ ...group, groups: [...group.groups, { kind: 'ANY', rows: [newRow()], groups: [] }] })} data-testid={`ss-cond-group-${depth}`}><Glyph name="branch" size={13} /> Add a group</button> : null}
      </div>
    </div>
  );
}
