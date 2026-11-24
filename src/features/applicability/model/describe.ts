// Wording only — how a condition reads as a sentence, which operators a type offers, and sensible starting values.
// Nothing here evaluates a condition: TRUE / FALSE / UNKNOWN always come from the Python evaluator.
import type { Condition, Expr, Operator, Scalar, Variable, VarType } from './types';

export const TYPE_LABEL: Record<VarType, string> = {
  BOOLEAN: 'Yes / no', ENUM: 'One of a list', MULTI_ENUM: 'Several of a list', NUMBER: 'Whole number', DECIMAL: 'Decimal number',
  MONEY: 'Money', DATE: 'Date', STRING: 'Text',
};
export const TYPE_HINT: Record<VarType, string> = {
  BOOLEAN: 'A fact that is either yes or no.', ENUM: 'Exactly one value from a list you define.',
  MULTI_ENUM: 'Any number of values from a list you define.', NUMBER: 'A count or an age.', DECIMAL: 'A number with decimals.',
  MONEY: 'An amount in one stated currency.', DATE: 'A calendar date.', STRING: 'Free text. Only exact comparisons are offered.',
};
const NUM: Operator[] = ['gte', 'gt', 'lte', 'lt', 'between', 'equals', 'not_equals'];
export const OPERATORS: Record<VarType, Operator[]> = {
  BOOLEAN: ['is_true', 'is_false'], ENUM: ['equals', 'not_equals', 'in', 'not_in'], STRING: ['equals', 'not_equals', 'in', 'not_in'],
  MULTI_ENUM: ['includes_any', 'includes_all', 'includes_none'], NUMBER: NUM, DECIMAL: NUM, MONEY: NUM,
  DATE: ['on', 'before', 'after', 'between'],
};
export const PRESENCE: Operator[] = ['is_known', 'is_unknown'];
export const WORDS: Record<Operator, string> = {
  is_true: 'is yes', is_false: 'is no', equals: 'is', not_equals: 'is not', in: 'is one of', not_in: 'is none of',
  includes_any: 'includes any of', includes_all: 'includes all of', includes_none: 'includes none of', gt: 'is more than',
  gte: 'is at least', lt: 'is less than', lte: 'is at most', between: 'is between', on: 'is on', before: 'is before',
  after: 'is after', is_known: 'is known', is_unknown: 'is not known',
};
export const operatorsFor = (v: Variable | undefined): Operator[] => (v ? [...OPERATORS[v.type], ...PRESENCE] : []);
export const NO_OPERAND: Operator[] = ['is_true', 'is_false', 'is_known', 'is_unknown'];
export const MANY: Operator[] = ['in', 'not_in', 'includes_any', 'includes_all', 'includes_none'];

export function valueLabel(v: Variable | undefined, value: unknown): string {
  if (value === null || value === undefined) return 'not known';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.map((x) => valueLabel(v, x)).join(', ') || 'none';
  const opt = v?.values?.find((o) => o.value === value);
  if (opt) return opt.label;
  if (v?.type === 'MONEY' && typeof value === 'number') return `${v.currency ?? ''} ${value.toLocaleString('en-SG')}`.trim();
  if (typeof value === 'number') return value.toLocaleString('en-SG');
  return String(value);
}

/** A first, valid test on a variable: the operator and operand a person most likely means. */
export function starter(v: Variable): Expr {
  const op = OPERATORS[v.type][0]!;
  if (v.type === 'BOOLEAN') return { op: 'test', variable: v.code, operator: 'is_true' };
  if (v.type === 'ENUM') return { op: 'test', variable: v.code, operator: 'equals', value: v.values?.[0]?.value ?? null };
  if (v.type === 'MULTI_ENUM') return { op: 'test', variable: v.code, operator: 'includes_any', values: v.values?.[0] ? [v.values[0].value] : [] };
  if (v.type === 'DATE') return { op: 'test', variable: v.code, operator: 'on', value: '2026-01-01' };
  if (v.type === 'STRING') return { op: 'test', variable: v.code, operator: 'equals', value: '' };
  return { op: 'test', variable: v.code, operator: op, value: 0 };
}
/** Keep a test valid when its operator changes: move the operand into the shape the new operator needs. */
export function withOperator(t: Extract<Expr, { op: 'test' }>, operator: Operator, v: Variable): Expr {
  const base = { op: 'test' as const, variable: t.variable, operator };
  if (NO_OPERAND.includes(operator)) return base;
  const first: Scalar = t.value ?? t.values?.[0] ?? t.min ?? (v.type === 'ENUM' || v.type === 'MULTI_ENUM' ? v.values?.[0]?.value ?? null : v.type === 'DATE' ? '2026-01-01' : v.type === 'STRING' ? '' : 0);
  if (MANY.includes(operator)) return { ...base, values: t.values ?? (typeof first === 'string' && first ? [first] : []) };
  if (operator === 'between') return { ...base, min: t.min ?? first, max: t.max ?? first };
  return { ...base, value: first };
}

export interface Lookup { variable: (code: string) => Variable | undefined; condition: (code: string) => Condition | undefined }
/** A condition as a sentence. */
export function sentence(e: Expr | null | undefined, k: Lookup, top = true): string {
  if (!e) return 'always';
  if (e.op === 'all' || e.op === 'any') {
    if (!e.args.length) return e.op === 'all' ? 'always' : 'never';
    const s = e.args.map((a) => sentence(a, k, false)).join(e.op === 'all' ? ' and ' : ' or ');
    return top || e.args.length === 1 ? s : `(${s})`;
  }
  if (e.op === 'not') return `not ${sentence(e.arg, k, false)}`;
  if (e.op === 'ref') return `“${k.condition(e.condition)?.name ?? e.condition}”`;
  const v = k.variable(e.variable);
  const name = v?.name ?? e.variable;
  if (NO_OPERAND.includes(e.operator)) return `${name} ${WORDS[e.operator]}`;
  if (e.operator === 'between') return `${name} is between ${valueLabel(v, e.min)} and ${valueLabel(v, e.max)}`;
  if (MANY.includes(e.operator)) return `${name} ${WORDS[e.operator]} ${(e.values ?? []).map((x) => valueLabel(v, x)).join(', ') || '…'}`;
  return `${name} ${WORDS[e.operator]} ${e.value === null || e.value === undefined || e.value === '' ? '…' : valueLabel(v, e.value)}`;
}

// ---- reading and changing one node of an expression by its path ("0.1": first child, then its second child)
export const childPath = (path: string, i: number) => (path ? `${path}.${i}` : String(i));
export function nodeAt(e: Expr, path: string): Expr | undefined {
  let n: Expr | undefined = e;
  for (const p of path ? path.split('.') : []) {
    if (!n) return undefined;
    n = n.op === 'all' || n.op === 'any' ? n.args[Number(p)] : n.op === 'not' ? n.arg : undefined;
  }
  return n;
}
export function replaceAt(e: Expr, path: string, f: (n: Expr) => Expr | null): Expr | null {
  if (!path) return f(e);
  const [head, ...rest] = path.split('.');
  const tail = rest.join('.');
  if (e.op === 'all' || e.op === 'any') {
    const args = e.args.flatMap((a, i) => { if (i !== Number(head)) return [a]; const r = replaceAt(a, tail, f); return r ? [r] : []; });
    return { ...e, args };
  }
  if (e.op === 'not') { const r = replaceAt(e.arg, tail, f); return r ? { ...e, arg: r } : null; }
  return e;
}
/** Every variable and saved condition an expression names directly. */
export function mentions(e: Expr | null | undefined, into = { variables: new Set<string>(), conditions: new Set<string>() }) {
  if (!e) return into;
  if (e.op === 'all' || e.op === 'any') e.args.forEach((a) => mentions(a, into));
  else if (e.op === 'not') mentions(e.arg, into);
  else if (e.op === 'ref') into.conditions.add(e.condition);
  else into.variables.add(e.variable);
  return into;
}
export const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

/** Whether two documents say the same thing, whatever order their keys are in (a saved document comes back from the
    database with its keys reordered). */
const ordered = (x: unknown): unknown => (Array.isArray(x) ? x.map(ordered) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v)])) : x);
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
