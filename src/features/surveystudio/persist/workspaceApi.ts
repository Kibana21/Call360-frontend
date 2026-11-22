// Survey Studio (UX-HOME-1) — what the workspace reads. READ ONLY, through the generated client. Every list here is an
// existing, authoritative read of another module; the one new read is the workspace summary (counts, recency and what
// awaits the signed-in person). A read the server does not offer here (a feature that is off, a permission not held)
// comes back as `unavailable` with the reason — it is never replaced by an invented value.
import { api, ApiFailure, unwrap } from '../../../api/client';
import type { components } from '../../../api/generated/schema';
import type { Component, ComponentKind } from './api';

export type WorkspaceSummary = components['schemas']['SurveyWorkspaceOut'];
export type Unavailable = { unavailable: 'OFF' | 'NO_PERMISSION' | 'FAILED' };
export type Maybe<T> = T | Unavailable;
export const missing = <T,>(x: Maybe<T>): x is Unavailable => typeof x === 'object' && x !== null && 'unavailable' in x;
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- other modules' lists are read as JSON

const soft = async <T,>(work: () => Promise<T>): Promise<Maybe<T>> => {
  try { return await work(); } catch (e) {
    return { unavailable: e instanceof ApiFailure ? (e.status === 404 ? 'OFF' : e.status === 403 ? 'NO_PERMISSION' : 'FAILED') : 'FAILED' };
  }
};
export const getWorkspace = async (): Promise<WorkspaceSummary> => unwrap(await api.GET('/api/v1/survey-definitions/workspace'));
export const allComponents = (kind: ComponentKind): Promise<Maybe<Component[]>> =>
  soft(async () => unwrap(await api.GET('/api/v1/survey-components', { params: { query: { kind, q: '' } } })).items);
export const versionContent = (versionId: string): Promise<Maybe<Any>> =>
  soft(async () => unwrap(await api.GET('/api/v1/survey-versions/{version_id}/content', { params: { path: { version_id: versionId } } })));
export const versionRecord = (versionId: string): Promise<Maybe<Any>> =>
  soft(async () => unwrap(await api.GET('/api/v1/survey-versions/{version_id}', { params: { path: { version_id: versionId } } })));
/** A candidate with its lifecycle events — who submitted, approved and published it. */
export const candidateRecord = (candidateId: string): Promise<Maybe<Any>> =>
  soft(async () => unwrap(await api.GET('/api/v1/survey-candidates/{candidate_id}', { params: { path: { candidate_id: candidateId } } })));
// ---- the four families of rules, each from the module that owns it ---------------------------------------------------
export const assignmentPolicy = (): Promise<Maybe<Any>> => soft(async () => unwrap(await api.GET('/api/v1/survey-assignment/policy')));
export const requirementGroups = (): Promise<Maybe<Any>> => soft(async () => unwrap(await api.GET('/api/v1/survey-assignment/groups')));
export const controlPolicies = (): Promise<Maybe<Any[]>> => soft(async () => unwrap(await api.GET('/api/v1/survey-evaluation/control-policies')).items as Any[]);
export const controlMappings = (): Promise<Maybe<Any[]>> => soft(async () => unwrap(await api.GET('/api/v1/survey-evaluation/mappings')).items as Any[]);
export const findingRuleSets = (): Promise<Maybe<Any>> => soft(async () => unwrap(await api.GET('/api/v1/finding-rule-sets')) as Any);

// ---- plain language for published documents --------------------------------------------------------------------------
export const words = (s: unknown) => String(s ?? '').toLowerCase().replace(/_/g, ' ');
export const ANSWER: Record<string, { label: string; glyph: 'yesno' | 'single' | 'multi' | 'number' | 'text' | 'ack' | 'say' }> = {
  YES_NO: { label: 'Yes or no', glyph: 'yesno' }, SINGLE_SELECT: { label: 'One answer from a list', glyph: 'single' }, MULTI_SELECT: { label: 'Several answers from a list', glyph: 'multi' },
  NUMERIC: { label: 'A number', glyph: 'number' }, FREE_TEXT: { label: 'Free text', glyph: 'text' }, ACKNOWLEDGEMENT: { label: 'Acknowledgement', glyph: 'ack' }, STATEMENT: { label: 'Statement (nothing is asked)', glyph: 'say' },
};
export const answerOf = (t: unknown) => ANSWER[String(t)] ?? { label: words(t) || 'Not stated', glyph: 'text' as const };
export const MODULE_CATEGORY: Record<string, string> = { OPENING: 'Opening', COMMON: 'General', PRODUCT: 'Product', RISK: 'Risk', EXCEPTION: 'Exception', CLOSING: 'Closing' };
const OP: Record<string, string> = { GTE: 'is at least', GT: 'is more than', LTE: 'is at most', LT: 'is less than', EQ: 'is', NEQ: 'is not', NE: 'is not', IN: 'is one of', NOT_IN: 'is none of', CONTAINS: 'includes', IS_TRUE: 'is true', IS_FALSE: 'is false' };
const operand = (x: Any, label: (field: string) => string): string =>
  x == null ? 'nothing' : typeof x !== 'object' ? String(x) : x.field ? label(x.field) : x.param ? `the value “${x.param}” supplied where it is used` : x.input ? `the earlier answer “${x.input}”` : 'value' in x ? (Array.isArray(x.value) ? x.value.join(', ') : String(x.value)) : JSON.stringify(x);
/** A published condition's rule as a sentence. Anything this does not recognise is shown as written, never guessed. */
export function ruleInWords(ast: Any, label: (field: string) => string = (f) => f): string {
  if (!ast || typeof ast !== 'object') return 'No rule is written.';
  const op = String(ast.op ?? '');
  const args = (ast.args ?? ast.terms ?? ast.conditions) as Any[] | undefined;
  if ((op === 'AND' || op === 'ALL') && args) return args.map((a) => ruleInWords(a, label)).join(', and ');
  if ((op === 'OR' || op === 'ANY') && args) return args.map((a) => ruleInWords(a, label)).join(', or ');
  if (op === 'NOT') return `not (${ruleInWords(ast.arg ?? args?.[0], label)})`;
  if (OP[op] && 'left' in ast) return `${operand(ast.left, label)} ${OP[op]}${'right' in ast ? ` ${operand(ast.right, label)}` : ''}`;
  return JSON.stringify(ast);
}
/** Where a branch leads, in words. */
export const destination = (t: Any, stepName: (node: string) => string): string =>
  t == null ? 'nowhere is decided' : t.node ? stepName(t.node) : t.outcome ? `the module ends: ${words(t.outcome)}` : t.return ? 'back to the question that asked the follow-up' : JSON.stringify(t);
export const branchLabel = (on: string, optionLabel: (code: string) => string): string =>
  on === 'ANY' || on === 'AFTER_CAPTURE' ? 'Always, next' : on === 'MATCH' ? 'When the condition is met' : on === 'NO_MATCH' ? 'When the condition is not met' : on === 'UNKNOWN' ? 'When it cannot be decided' : `If “${optionLabel(on)}”`;
