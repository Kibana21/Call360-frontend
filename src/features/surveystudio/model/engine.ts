// Survey Studio prototype — DEMONSTRATION evaluator.
// A small in-browser reading of the SS-01 contracts so the prototype can show verdicts and previews. It is not the
// Call360 backend engine and makes no claim of parity with it: the deterministic runtime remains a server concern.
import { FIELDS, OUTCOME_LABEL } from './sample';
import type { Ast, Binding, Condition, FieldDef, Module, Operand, Question, QuestionNode, SetRule, Target, Workspace } from './types';

export type Tri = 'TRUE' | 'FALSE' | 'UNKNOWN';
export type Profile = Record<string, string | number | boolean | null | undefined>;
/** Answers collected so far, by question node: one option code, a set of codes, or undefined when not answered. */
export type Answers = Record<string, string | string[] | null | undefined>;
/** Extra context for a decision: the answers so far, and how to name an earlier answer in a sentence. */
export interface EvalContext { answers?: Answers; inputLabel?: (name: string) => string; optionLabel?: (name: string, code: string) => string }

export interface Explain {
  label: string; // plain-language line
  result: Tri;
  children?: Explain[];
}

export const fieldDef = (code: string): FieldDef | undefined => FIELDS.find((f) => f.code === code);

const fmt = (v: unknown, f?: { type?: string; unit?: string }): string => {
  if (v === null || v === undefined || v === '') return 'missing';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return f?.type === 'MONEY' ? `${v.toLocaleString('en-SG')} ${f.unit ?? ''}`.trim() : `${v.toLocaleString('en-SG')}${f?.unit ? ` ${f.unit}` : ''}`;
  const t = String(v);
  return t.length <= 3 ? t : t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' '); // short codes such as ILP stay as they are
};

const OP_TEXT: Record<string, string> = { EQ: 'is', NEQ: 'is not', GT: 'is above', GTE: 'is at least', LT: 'is below', LTE: 'is at most', INCLUDES_ANY: 'includes any of', INCLUDES_ALL: 'includes all of', INCLUDES_NONE: 'includes none of' };

function operandText(o: Operand, c: Condition, b?: Binding, ref?: FieldDef, ctx?: EvalContext, input?: string): string {
  if ('field' in o) return fieldDef(o.field)?.label ?? o.field;
  if ('input' in o) return ctx?.inputLabel?.(o.input) ?? `the answer to ${c.inputs?.[o.input]?.question.code ?? o.input}`; // a stable code, never a stored label
  if ('param' in o) {
    const v = b?.params[o.param];
    return v === undefined || v === '' ? `[${c.params[o.param]?.label ?? o.param}]` : fmt(v, c.params[o.param]);
  }
  if (input && Array.isArray(o.literal)) return o.literal.map((code) => ctx?.optionLabel?.(input, code) ?? fmt(code)).join(', ') || '(no answers chosen)';
  if (input && typeof o.literal === 'string') return ctx?.optionLabel?.(input, o.literal) ?? fmt(o.literal);
  return fmt(o.literal, ref);
}

/** A condition as one readable sentence, e.g. "Annual premium is at least 12,000 SGD or Sum assured is at least …". */
export function describeAst(ast: Ast, c: Condition, b?: Binding, nested = false, ctx?: EvalContext): string {
  if (ast.op === 'AND' || ast.op === 'OR') {
    const s = ast.args.map((a) => describeAst(a, c, b, true, ctx)).join(ast.op === 'AND' ? ' and ' : ' or ');
    return nested && ast.args.length > 1 ? `(${s})` : s;
  }
  if (ast.op === 'NOT') return `not ${describeAst(ast.arg, c, b, true, ctx)}`;
  const ref = 'field' in ast.left ? fieldDef(ast.left.field) : undefined;
  const input = 'input' in ast.left ? ast.left.input : undefined;
  return `${operandText(ast.left, c, b, ref, ctx)} ${OP_TEXT[ast.op]} ${operandText(ast.right, c, b, ref, ctx, input)}`;
}

function value(o: Operand, b: Binding | undefined, profile: Profile, ctx?: EvalContext): { known: boolean; v: unknown } {
  if ('literal' in o) return { known: true, v: o.literal };
  let v: unknown;
  if ('param' in o) v = b?.params[o.param];
  else if ('input' in o) {
    // not bound or not answered = UNKNOWN. An answered multiple-choice question with nothing selected is a KNOWN empty list.
    const node = b?.inputs?.[o.input]?.node;
    v = node ? ctx?.answers?.[node] : undefined;
  } else v = profile[o.field];
  return v === null || v === undefined || v === '' ? { known: false, v: null } : { known: true, v };
}

const and = (xs: Tri[]): Tri => (xs.includes('FALSE') ? 'FALSE' : xs.includes('UNKNOWN') ? 'UNKNOWN' : 'TRUE');
const or = (xs: Tri[]): Tri => (xs.includes('TRUE') ? 'TRUE' : xs.includes('UNKNOWN') ? 'UNKNOWN' : 'FALSE');

/** Three-valued evaluation (SS-01 Part A §5.3): a missing value is UNKNOWN unless a known operand already decides. */
export function evaluate(ast: Ast, c: Condition, b: Binding | undefined, profile: Profile, ctx?: EvalContext): Explain {
  if (ast.op === 'AND' || ast.op === 'OR') {
    const children = ast.args.map((a) => evaluate(a, c, b, profile, ctx));
    const result = (ast.op === 'AND' ? and : or)(children.map((x) => x.result));
    return { label: ast.op === 'AND' ? 'All of these' : 'Any of these', result, children };
  }
  if (ast.op === 'NOT') {
    const child = evaluate(ast.arg, c, b, profile, ctx);
    return { label: 'Not', result: child.result === 'UNKNOWN' ? 'UNKNOWN' : child.result === 'TRUE' ? 'FALSE' : 'TRUE', children: [child] };
  }
  const l = value(ast.left, b, profile, ctx), r = value(ast.right, b, profile, ctx);
  const ref = 'field' in ast.left ? fieldDef(ast.left.field) : undefined;
  const input = 'input' in ast.left ? ast.left.input : undefined;
  const leftText = operandText(ast.left, c, b, ref, ctx);
  const base = `${leftText} ${OP_TEXT[ast.op]} ${operandText(ast.right, c, b, ref, ctx, input)}`;
  if (!l.known || !r.known) {
    const why = !l.known ? (input ? 'that question has not been answered' : `${leftText} is missing`) : 'the value for this placement is missing';
    return { label: `${base} — ${why}`, result: 'UNKNOWN' };
  }
  const actual = input ? (Array.isArray(l.v) ? l.v : [l.v]).map((code) => ctx?.optionLabel?.(input, String(code)) ?? fmt(code)).join(', ') || 'nothing selected' : fmt(l.v, ref);
  let ok: boolean;
  if (ast.op === 'INCLUDES_ANY' || ast.op === 'INCLUDES_ALL' || ast.op === 'INCLUDES_NONE') {
    const chosen = (Array.isArray(l.v) ? l.v : [l.v]) as unknown[];
    const wanted = (Array.isArray(r.v) ? r.v : [r.v]) as unknown[];
    ok = ast.op === 'INCLUDES_ANY' ? wanted.some((x) => chosen.includes(x)) : ast.op === 'INCLUDES_ALL' ? wanted.every((x) => chosen.includes(x)) : !wanted.some((x) => chosen.includes(x));
  } else {
    const num = typeof l.v === 'number' || typeof r.v === 'number';
    const a = num ? Number(l.v) : l.v, z = num ? Number(r.v) : r.v;
    ok = ast.op === 'EQ' ? a === z : ast.op === 'NEQ' ? a !== z
      : ast.op === 'GT' ? (a as number) > (z as number) : ast.op === 'GTE' ? (a as number) >= (z as number)
        : ast.op === 'LT' ? (a as number) < (z as number) : (a as number) <= (z as number);
  }
  return { label: `${base} — actual: ${actual}`, result: ok ? 'TRUE' : 'FALSE' };
}

/** The option codes a condition compares each declared answer with (so they can be checked against the bound question). */
export function codesUsed(ast: Ast, acc: Record<string, string[]> = {}): Record<string, string[]> {
  if (ast.op === 'AND' || ast.op === 'OR') ast.args.forEach((a) => codesUsed(a, acc));
  else if (ast.op === 'NOT') codesUsed(ast.arg, acc);
  else if ('input' in ast.left && 'literal' in ast.right) {
    const lit = ast.right.literal;
    (acc[ast.left.input] ??= []).push(...(Array.isArray(lit) ? lit : [String(lit)]));
  }
  return acc;
}

/** Declared earlier answers a condition reads, in first-use order. */
export function inputsOf(ast: Ast, acc: string[] = []): string[] {
  if (ast.op === 'AND' || ast.op === 'OR') ast.args.forEach((a) => inputsOf(a, acc));
  else if (ast.op === 'NOT') inputsOf(ast.arg, acc);
  else for (const o of [ast.left, ast.right]) if ('input' in o && !acc.includes(o.input)) acc.push(o.input);
  return acc;
}

export function fieldsOf(ast: Ast, acc: string[] = []): string[] {
  if (ast.op === 'AND' || ast.op === 'OR') ast.args.forEach((a) => fieldsOf(a, acc));
  else if (ast.op === 'NOT') fieldsOf(ast.arg, acc);
  else for (const o of [ast.left, ast.right]) if ('field' in o && !acc.includes(o.field)) acc.push(o.field);
  return acc;
}

export const VERDICT: Record<Tri, string> = { TRUE: 'Matches', FALSE: 'Does not match', UNKNOWN: 'Unknown' };

// ---- first-matching-rule routing ----------------------------------------------------------------------------------
export const ruleMatches = (rule: SetRule, chosen: string[]): boolean =>
  rule.options.length > 0 && (rule.kind === 'ANY' ? rule.options.some((c) => chosen.includes(c))
    : rule.kind === 'ALL' ? rule.options.every((c) => chosen.includes(c)) : !rule.options.some((c) => chosen.includes(c)));

/**
 * The single destination for a selection: the FIRST rule that matches, in list order; otherwise the fallback.
 * One winner, never two paths. `alsoMatched` lists later rules that matched and did not run.
 */
export function ruleWinner(node: QuestionNode, chosen: string[]): { index: number; to: Target | null; alsoMatched: number[] } {
  const rules = node.routing.rules ?? [];
  const hits = rules.map((r, i) => (ruleMatches(r, chosen) ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) return { index: -1, to: node.routing.fallback ?? null, alsoMatched: [] };
  return { index: hits[0]!, to: rules[hits[0]!]!.to, alsoMatched: hits.slice(1) };
}

/** Every selection the question would accept (limits and exclusivity respected). Capped; used for checks, not display. */
export function validSelections(q: Question): string[][] {
  const codes = q.options.map((o) => o.code);
  if (codes.length > 12) return [];
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << codes.length; mask++) {
    const sel = codes.filter((_, i) => mask & (1 << i));
    if (!selectionError(q, sel, 'placeholder text')) out.push(sel);
  }
  return out;
}

/** Rules that can never win because an earlier rule always matches first (a warning for the author, not a blocker). */
export function shadowedRules(node: QuestionNode, q: Question): number[] {
  const rules = node.routing.rules ?? [];
  const wins = new Set(validSelections(q).map((sel) => ruleWinner(node, sel).index));
  return rules.map((r, i) => (r.options.length && !wins.has(i) ? i : -1)).filter((i) => i >= 0);
}

// ---- answers and follow-up queues ---------------------------------------------------------------------------------
/** The limits in force: the author's stored limits, or — when none were set — at least one, up to every combinable answer. */
export function effectiveSelection(q: Question): { min: number; max: number } {
  return q.selection ?? { min: 1, max: Math.max(1, q.options.filter((o) => !o.exclusive).length) };
}

export function selectionError(q: Question, chosen: string[], otherText?: string): string | null {
  const opts = new Map(q.options.map((o) => [o.code, o]));
  if (q.answerType === 'MULTI_SELECT') {
    const sel = effectiveSelection(q);
    // the most specific reason first: an exclusive answer chosen with others, then the limits
    const ex = chosen.find((c) => opts.get(c)?.exclusive);
    if (ex && chosen.length > 1) return `"${opts.get(ex)!.label}" cannot be combined with other answers.`;
    if (chosen.length < sel.min) return `Choose at least ${sel.min}.`;
    if (chosen.length > sel.max) return `Choose at most ${sel.max}.`;
  }
  const other = chosen.map((c) => opts.get(c)).find((o) => o?.isOther);
  if (other?.otherText) {
    const t = (otherText ?? '').trim();
    if (other.otherText.required && !t) return 'Please specify: text is required when "Other" is chosen.';
    if (t && t.length < other.otherText.min) return `Please specify: at least ${other.otherText.min} characters.`;
    if (t.length > other.otherText.max) return `Please specify: at most ${other.otherText.max} characters.`;
  }
  return null;
}

export interface QueueStep { kind: 'ASK' | 'REJOIN' | 'STOP'; label: string; because?: string; nodeId?: string }
export interface QueuePreview { error?: string; steps: QueueStep[]; skipped: string[]; deduped: string[]; /** why this behaviour won, when an interrupt applied */ note?: string }

/**
 * The deterministic follow-up queue for one selection (SS-01 Part A §4): interrupts first, then follow-ups in the
 * configured order (never click order), each node once, then exactly one rejoin.
 */
export function previewQueue(node: QuestionNode, q: Question, chosen: string[], label: (t: Target | null | undefined) => string): QueuePreview {
  const error = selectionError(q, chosen);
  if (error) return { error, steps: [], skipped: [], deduped: [] };
  const r = node.routing;
  const optLabel = (c: string) => q.options.find((o) => o.code === c)?.label ?? c;
  const ask = (id: string, because: string): QueueStep => ({ kind: 'ASK', nodeId: id, because, label: label({ node: id }) });
  const queue: QueueStep[] = [];
  const deduped: string[] = [];
  for (const f of r.followups ?? []) {
    if (!chosen.includes(f.option)) continue;
    for (const id of f.nodes) {
      if (queue.some((s) => s.nodeId === id)) deduped.push(`${label({ node: id })} (also for ${optLabel(f.option)})`);
      else queue.push(ask(id, optLabel(f.option)));
    }
  }
  // Interrupts. Precedence when several selected answers interrupt: a MANDATORY escalation first, whatever else was
  // selected; then stop-and-escalate, stop-and-go-to, handle-and-resume; ties by the option order. Nothing continues implicitly.
  const order = new Map(q.options.map((o, k) => [o.code, k]));
  const mandatory = (code: string) => (q.options.find((o) => o.code === code)?.interrupt === 'MANDATORY' ? 0 : 1);
  const rank = { STOP_ESCALATE: 0, STOP_REJOIN: 1, RESUME: 2 } as const;
  const hits = (r.interrupts ?? []).filter((i) => chosen.includes(i.option))
    .sort((a, b) => mandatory(a.option) - mandatory(b.option) || rank[a.policy] - rank[b.policy] || (order.get(a.option) ?? 0) - (order.get(b.option) ?? 0));
  const top = hits[0];
  if (top && top.policy === 'STOP_ESCALATE') {
    return {
      steps: [{ kind: 'STOP', because: optLabel(top.option), label: `Stop: ${top.outcome ? OUTCOME_LABEL[top.outcome] : 'outcome not chosen'}` }],
      skipped: queue.map((s) => s.label), deduped, note: `"${optLabel(top.option)}" stops the follow-ups and ends the module.`,
    };
  }
  if (top && top.policy === 'STOP_REJOIN') {
    return {
      steps: [{ kind: 'REJOIN', because: optLabel(top.option), label: label(top.rejoin) }],
      skipped: queue.map((s) => s.label), deduped, note: `"${optLabel(top.option)}" stops the follow-ups and continues at the chosen destination.`,
    };
  }
  const first = hits.flatMap((i) => (i.nodes ?? []).map((id) => ask(id, `${optLabel(i.option)} — handled first`)));
  const steps = [...first, ...queue.filter((s) => !first.some((x) => x.nodeId === s.nodeId))];
  return {
    steps: [...steps, { kind: 'REJOIN', label: label(r.rejoin) }], skipped: [], deduped,
    ...(first.length ? { note: `"${optLabel(hits[0]!.option)}" is handled first; the remaining follow-ups then continue.` } : {}),
  };
}

export function targetLabel(t: Target | null | undefined, m: Module, ws: Workspace, numbers: Map<string, string>): string {
  if (!t) return 'Not decided';
  if ('ret' in t) return 'Back to the follow-up queue';
  if ('outcome' in t) return t.outcome === 'REVIEW_REQUIRED' ? 'Stop: review required' : `End module: ${OUTCOME_LABEL[t.outcome]}`;
  const node = m.nodes.find((x) => x.id === t.node);
  if (node && node.type === 'DECISION') return `${numbers.get(t.node) ?? '?'} Condition`;
  const q = node && ws.questions.find((x) => x.code === node.q.code && x.version === node.q.version);
  const text = q?.wording.text.trim() || 'Untitled question';
  return `${numbers.get(t.node) ?? '?'} ${text.length > 46 ? `${text.slice(0, 45)}…` : text}`;
}
