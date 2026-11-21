// Survey Studio prototype (UC-01) — controlled variables in approved wording. DEMONSTRATION ONLY.
// A variable is written {{field_code}} and names ONE field of the governed catalog. Rendering is deterministic: the
// same wording and the same customer data always give the same sentence. A missing value is an explicit error — it is
// never guessed, defaulted or left for an assistant to fill in. The output formats below are prototype formats; how
// amounts and names are to be SPOKEN is a business decision that has not been taken (G-6 AD-8).
import { FIELDS } from './sample';
import type { DeliveryMode, FieldDef, Question } from './types';

export type Facts = Record<string, string | number | boolean | null | undefined>;
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** The variables a wording uses, in order of first appearance. */
export function variablesOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}
export const fieldOf = (code: string): FieldDef | undefined => FIELDS.find((f) => f.code === code);
/** Fields that may appear in wording. A yes/no fact has no approved spoken form, so it is not offered. */
export const WORDING_FIELDS = FIELDS.filter((f) => f.type !== 'BOOLEAN');

export type VariableProblem = 'UNKNOWN_VARIABLE' | 'TYPE_NOT_ALLOWED' | 'MALFORMED';
/** Authoring-time problems in a wording's variables (independent of any customer). */
export function variableProblems(text: string): Array<{ variable: string; problem: VariableProblem }> {
  const out: Array<{ variable: string; problem: VariableProblem }> = [];
  for (const v of variablesOf(text)) {
    const f = fieldOf(v);
    if (!f) out.push({ variable: v, problem: 'UNKNOWN_VARIABLE' });
    else if (f.type === 'BOOLEAN') out.push({ variable: v, problem: 'TYPE_NOT_ALLOWED' });
  }
  // a brace pair left over once well-formed variables are removed is a typing mistake, not a variable
  if (/\{\{|\}\}/.test(text.replace(TOKEN, ''))) out.push({ variable: '', problem: 'MALFORMED' });
  return out;
}

const group = (n: number) => String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** One stated format per type. No locale lookup: the output never depends on the machine it runs on. */
export function formatValue(f: FieldDef, v: string | number | boolean): string | null {
  if (f.type === 'MONEY' || f.type === 'INTEGER') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    // never rounded or truncated to fit: a whole-number field must hold a whole number, an amount at most two decimals
    if (f.type === 'INTEGER' && !Number.isInteger(v)) return null;
    if (f.type === 'MONEY' && Math.abs(Math.round(v * 100) - v * 100) > 1e-6) return null;
    const cents = f.type === 'MONEY' ? Math.round(Math.abs(v) * 100) % 100 : 0;
    const body = `${v < 0 ? '-' : ''}${group(v)}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
    return f.type === 'MONEY' ? `${f.unit ?? ''} ${body}`.trim() : body;
  }
  if (f.type === 'ENUM') {
    if (typeof v !== 'string' || (f.values && !f.values.includes(v))) return null;
    return v.length <= 3 ? v : v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
  }
  if (f.type === 'TEXT') return typeof v === 'string' && v.trim() ? v.trim() : null;
  return null;
}

export interface Rendered {
  /** The sentence to deliver, or null when it cannot be built. */
  text: string | null;
  /** Each variable with the value used, for the evidence record. */
  values: Array<{ variable: string; label: string; value: string | null; state: 'PRESENT' | 'MISSING' | 'INVALID' | 'UNKNOWN_VARIABLE' | 'MALFORMED' }>;
  /** Plain-language reasons the sentence cannot be delivered. Empty when `text` is set. */
  errors: string[];
}
/** Renders approved wording for one customer. Never improvises: any variable without a usable value is an error. */
export function renderWording(text: string, facts: Facts): Rendered {
  const values: Rendered['values'] = variablesOf(text).map((variable) => {
    const f = fieldOf(variable);
    if (!f || f.type === 'BOOLEAN') return { variable, label: f?.label ?? variable, value: null, state: 'UNKNOWN_VARIABLE' as const };
    const raw = facts[variable];
    if (raw === null || raw === undefined || raw === '') return { variable, label: f.label, value: null, state: 'MISSING' as const };
    const value = formatValue(f, raw);
    return { variable, label: f.label, value, state: value === null ? ('INVALID' as const) : ('PRESENT' as const) };
  });
  // an unfinished variable is never spoken with its braces: the wording cannot be delivered at all
  if (/\{\{|\}\}/.test(text.replace(TOKEN, ''))) values.push({ variable: '', label: 'an unfinished variable', value: null, state: 'MALFORMED' });
  const errors = values.filter((v) => v.state !== 'PRESENT').map((v) => (v.state === 'MISSING' ? `“${v.label}” is missing from this customer’s record.`
    : v.state === 'INVALID' ? `“${v.label}” has a value that cannot be used in wording.` : v.state === 'MALFORMED' ? 'The wording has an unfinished variable.' : `{{${v.variable}}} is not a field that wording may use.`));
  if (errors.length) return { text: null, values, errors };
  const by = new Map(values.map((v) => [v.variable, v.value!]));
  return { text: text.replace(TOKEN, (_, code: string) => by.get(code) ?? ''), values, errors };
}

export const DELIVERY_LABEL: Record<DeliveryMode, string> = { CONTROLLED_TTS: 'Exact text, spoken by the system', EXACT_AUDIO: 'Approved recording', CONVERSATIONAL: 'In the assistant’s own words' };
export const DELIVERY_HINT: Record<DeliveryMode, string> = {
  CONTROLLED_TTS: 'The customer hears exactly this text, word for word.',
  EXACT_AUDIO: 'Blocked until an approved recording is attached. A recording cannot be attached in this prototype.',
  CONVERSATIONAL: 'Blocked. What an assistant may say in its own words has not been decided.',
};
export const deliveryOf = (q: Question): DeliveryMode => q.wording.delivery ?? 'CONTROLLED_TTS';
