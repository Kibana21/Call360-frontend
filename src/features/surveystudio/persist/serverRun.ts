// Survey Studio (SS-03B) — reading a run of the Python engine, and comparing it with the browser's own engine.
// Pure functions. The server's run is the authority; the browser engine (model/sim.ts, model/plan.ts) is run on the SAME
// published documents and the SAME inputs only to show whether the two agree. A difference is never hidden or resolved
// here: it is listed, in words, for a person to investigate. No execution rule lives in this file.
import type { AssetDoc, AssetKind, Doc, DocumentSet } from '../model/documents';
import { fromDocuments } from '../model/documents';
import type { CallPlan } from '../model/plan';
import type { SimAnswer, SimResult } from '../model/sim';
import type { Survey, Workspace } from '../model/types';

type Json = Record<string, unknown>;
export interface PyValue { variable: string; value: string | null; state: string }
export interface PyPending {
  key: string; instance: string; node: string; text: string; followup: boolean; answer_type: string; attempt: number;
  options: Array<{ code: string; label: string }>; selection?: { min: number; max: number } | null;
  number_rule?: { integer?: boolean; min?: number | null; max?: number | null } | null; text_rule?: Json | null;
  queue?: Array<{ node: string; state: 'DONE' | 'NOW' | 'NEXT' }>;
}
export interface PyEvent extends Json { at: number; kind: string }
export interface PyRun {
  status: 'PENDING' | 'POLICY_UNRESOLVED' | 'TERMINAL';
  terminal: { state: string; survey_outcome?: string; reason?: string; at?: string } | null;
  pending: PyPending | null;
  policy_unresolved: { key: string; code: string; reason: string } | null;
  asked: string[];
  delivered: Array<{ key: string; item: string; statement: boolean; wording_version: number; delivery_mode: string; text: string; values: PyValue[] }>;
  modules: Array<{ instance: string; name: string; status: string; outcome?: string }>;
  evidence_states: Record<string, string>;
  events: PyEvent[];
  rejections: Array<{ at: string; error: string }>;
}
export interface PyPlan {
  status: 'READY' | 'BLOCKED'; fingerprint: string;
  issues: Array<{ code: string; at: string }>;
  inputs: Array<{ field: string; type: string; state: string; value: unknown; used_by: string[] }>;
  modules: Array<{
    instance: string; name: string; status: string; reason: string;
    eligibility: { result: string; unknown_policy?: string | null; reads: Array<{ field: string; state: string; value: unknown }> } | null;
    items: Array<{ key: string; statement: boolean; answer_type: string; role: string | null; mandatory: boolean; delivery_mode: string; wording_version: number; source: string; text: string | null; values: PyValue[]; errors: Array<{ code: string; variable: string }>; certainty: string }>;
    open: Array<{ key: string; kind: string; alternatives: Array<{ on: string; to: unknown }> }>;
  }>;
  counts: Record<string, number>;
}

/** The published version's own documents as an editor workspace — only so the browser engine can be run on them. */
export function versionWorkspace(d: { content: unknown; assets: Array<{ kind: string; code: string; version: number; document?: unknown }> }, meta: { name: string; label: string }): { ws: Workspace; survey: Survey } {
  const assets = d.assets.filter((a) => a.document).map((a): AssetDoc => ({ kind: a.kind as AssetKind, code: a.code, version: a.version, document: a.document as Doc }));
  const set: DocumentSet = { content: d.content as Doc, assets };
  const ws = fromDocuments(set, { meta: { name: meta.name, purpose: '', versionLabel: meta.label }, frozen: new Set(assets.map((a) => `${a.kind}:${a.code}@${a.version}`)) });
  return { ws, survey: ws.surveys[0]! };
}

export interface Difference { what: string; server: string; browser: string }
const show = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
const differ = (out: Difference[], what: string, server: unknown, browser: unknown) => { if (JSON.stringify(server ?? null) !== JSON.stringify(browser ?? null)) out.push({ what, server: show(server), browser: show(browser) }); };

/** Where the Python run and the browser engine's run of the same documents and inputs do not agree. Empty = they agree. */
export function compareRuns(py: PyRun, ts: SimResult): Difference[] {
  const out: Difference[] = [];
  differ(out, 'Questions answered, in order', py.asked, ts.asked);
  differ(out, 'The question that is current', py.pending?.key ?? null, ts.pending?.key ?? null);
  differ(out, 'The sentence of the current question', py.pending?.text ?? null, ts.pending?.text ?? null);
  differ(out, 'How the run ended', py.terminal ? { state: py.terminal.state, outcome: py.terminal.survey_outcome ?? null, reason: py.terminal.reason ?? null, at: py.terminal.at ?? null } : null,
    ts.terminal ? { state: ts.terminal.state, outcome: ts.terminal.surveyOutcome ?? null, reason: ts.terminal.reason ?? null, at: ts.terminal.at ?? null } : null);
  differ(out, 'Modules: which ran, which were skipped, and their outcomes', py.modules.map((m) => `${m.instance}: ${m.status}${m.outcome ? ` → ${m.outcome}` : ''}`), ts.modules.map((m) => `${m.instance}: ${m.status}${m.outcome ? ` → ${m.outcome}` : ''}`));
  differ(out, 'Everything delivered, with its exact wording', py.delivered.map((d) => `${d.key} (wording ${d.wording_version}): ${d.text}`), ts.deliveries.map((d) => `${d.item_instance} (wording ${d.wording_version}): ${d.text}`));
  differ(out, 'Answers refused, with the reason code', py.rejections.map((r) => `${r.at}: ${r.error}`), ts.events.flatMap((e) => (e.kind === 'REJECT' ? [`${e.key}: ${e.code}`] : [])));
  return out;
}

/** Where the Python call plan and the browser's plan of the same documents and facts do not agree. */
export function comparePlans(py: PyPlan, ts: CallPlan): Difference[] {
  const out: Difference[] = [];
  const order = (xs: string[]) => [...xs].sort();
  differ(out, 'Whether a plan can be computed', py.status, ts.status);
  differ(out, 'What blocks the plan', order(py.issues.map((i) => `${i.code} at ${i.at}`)), order(ts.issues.map((i) => `${i.code} at ${i.at}`)));
  differ(out, 'Modules included, excluded, conditional or undecidable', py.modules.map((m) => `${m.instance}: ${m.status}`), ts.modules.map((m) => `${m.instance}: ${m.status}`));
  differ(out, 'The exact wording of every item', py.modules.flatMap((m) => m.items.map((i) => `${i.key}: ${i.text ?? '(cannot be delivered)'}`)), ts.modules.flatMap((m) => m.items.map((i) => `${i.key}: ${i.text ?? '(cannot be delivered)'}`)));
  differ(out, 'The points an answer still decides', py.modules.flatMap((m) => m.open.map((o) => `${o.key} ${o.kind}`)), ts.modules.flatMap((m) => m.open.map((o) => `${o.key} ${o.kind}`)));
  return out;
}

/** The inputs a simulation holds, in order, as the browser engine takes them (refused ones included). */
export const inputsOf = (inputs: Array<{ answer: unknown }>): SimAnswer[] => inputs.map((i) => i.answer as SimAnswer);

// ---- a run in words ------------------------------------------------------------------------------------------------
export const STATUS_TEXT: Record<string, string> = {
  ACTIVATED: 'Ran', RUNNING: 'Running now', SKIPPED_FALSE: 'Skipped: did not apply', SKIPPED_UNKNOWN: 'Skipped: information missing', SKIPPED_PRIOR_OUTCOME: 'Skipped: not triggered',
  SKIPPED_BY_ROUTE: 'Passed over by a jump', HALTED_MISSING_INFORMATION: 'Halted: information missing', NOT_REACHED: 'Not reached',
};
export const TERMINAL_TEXT: Record<string, string> = {
  COMPLETED: 'Completed', ENDED_WITH_OUTCOME: 'Ended early with a named outcome', MANDATORY_ESCALATION: 'Mandatory escalation', REVIEW_REQUIRED: 'Halted: review required',
  MISSING_INFORMATION_HALT: 'Halted: information missing', DRAFT_INVALID: 'The definition cannot run here',
};
export const REJECTION_TEXT: Record<string, string> = {
  TEXT_REQUIRED: 'An answer is required.', TEXT_TOO_SHORT: 'The answer is too short.', TEXT_TOO_LONG: 'The answer is too long.', CHOICE_REQUIRED: 'Choose an answer.',
  UNKNOWN_OPTION: 'That is not one of the answers.', DUPLICATE_OPTION: 'An answer was chosen twice.', TOO_FEW_SELECTED: 'Too few answers were chosen.', TOO_MANY_SELECTED: 'Too many answers were chosen.',
  EXCLUSIVE_OPTION_CONFLICT: 'One of the chosen answers cannot be combined with others.', OTHER_TEXT_REQUIRED: 'Text is required when “Other” is chosen.', OTHER_TEXT_TOO_SHORT: 'The “Other” text is too short.',
  OTHER_TEXT_TOO_LONG: 'The “Other” text is too long.', OTHER_TEXT_NOT_ALLOWED: 'Text was given, but “Other” was not chosen.', NUMBER_REQUIRED: 'A number is required.', NUMBER_NOT_WHOLE: 'A whole number is required.',
  NUMBER_TOO_LOW: 'The number is too low.', NUMBER_TOO_HIGH: 'The number is too high.', ACKNOWLEDGEMENT_REQUIRED: 'An acknowledgement is required.',
  NON_ANSWER_POLICY_UNRESOLVED: 'The customer did not acknowledge. What a call does then has not been decided.',
};
const TRI: Record<string, string> = { TRUE: 'applies', FALSE: 'does not apply', UNKNOWN: 'cannot be decided: information is missing' };
const answerWords = (a: SimAnswer): string =>
  a.acknowledged !== undefined && a.acknowledged !== null ? (a.acknowledged ? 'acknowledged' : 'not acknowledged')
    : a.number !== undefined && a.number !== null ? String(a.number)
      : a.choices ? (a.choices.length ? a.choices.join(', ') : 'nothing selected')
        : a.choice !== undefined && a.choice !== null ? `${a.choice}${a.other_text ? ` (“${a.other_text}”)` : ''}`
          : a.text !== undefined && a.text !== null ? (a.text ? `“${a.text}”` : 'left empty') : 'no answer';
const target = (to: unknown, names: Record<string, string>): string => {
  if (to === '@CONTINUE') return 'the next module';
  const t = (to ?? {}) as Json;
  if (t.survey_outcome) return `end of the call: ${String(t.survey_outcome)}`;
  if (t.instance) return `module ${names[String(t.instance)] ?? String(t.instance)}`;
  if (t.outcome) return `the module ends: ${String(t.outcome)}`;
  if (t.return) return 'back to the follow-up queue';
  if (t.node) return `step ${String(t.node)}`;
  return 'nowhere (no route)';
};
const reads = (e: PyEvent): string => ((e.reads as Array<{ what: string; name: string; state: string; value: unknown }> | undefined) ?? [])
  .map((r) => `${r.name} ${r.state === 'KNOWN' || r.state === 'ANSWERED' ? `= ${show(r.value)}` : `is ${r.state.toLowerCase().replace(/_/g, ' ')}`}`).join('; ');

export interface TraceLine { at: number; kind: string; tone: 'say' | 'ask' | 'answer' | 'reject' | 'decide' | 'route' | 'module' | 'end'; title: string; detail?: string }
/** One event of the Python run as one readable line. Every word here describes; nothing is decided. */
export function describe(e: PyEvent, run: PyRun): TraceLine {
  const names = Object.fromEntries(run.modules.map((m) => [m.instance, m.name]));
  const mod = names[String(e.instance)] ?? String(e.instance ?? '');
  const base = { at: e.at, kind: e.kind };
  switch (e.kind) {
    case 'ENTRY': {
      const status = STATUS_TEXT[String(e.status)] ?? String(e.status);
      const why = e.mode === 'RULE' ? `Its entry condition ${TRI[String(e.result)] ?? String(e.result)}${reads(e) ? ` (${reads(e)})` : ''}.` : e.mode === 'ON_OUTCOME' && e.status !== 'ACTIVATED' ? 'The earlier outcome that selects it did not happen.' : e.arrival === 'JUMP' ? 'Reached by a jump.' : 'Next in the sequence; it has no entry condition.';
      return { ...base, tone: 'module', title: `${mod}: ${status}`, detail: why };
    }
    case 'SAY': return { ...base, tone: 'say', title: 'Statement delivered', detail: String(e.text) };
    case 'ASK': return { ...base, tone: 'ask', title: e.followup ? 'Follow-up question asked' : 'Question asked', detail: String(e.text) };
    case 'REJECT': return { ...base, tone: 'reject', title: `Answer refused: ${String(e.code)}`, detail: `${answerWords(e.answer as SimAnswer)} — ${REJECTION_TEXT[String(e.code)] ?? ''} The same question stays current.` };
    case 'ANSWER': return { ...base, tone: 'answer', title: `Answer accepted: ${answerWords(e.answer as SimAnswer)}`, detail: String(e.text) };
    case 'DECISION': return { ...base, tone: 'decide', title: `Decision: the condition ${TRI[String(e.result)] ?? String(e.result)}`, detail: `${reads(e) ? `${reads(e)}. ` : ''}Goes to ${target(e.to, names)}.` };
    case 'QUEUE': {
      const i = e.interrupt as { option: string; policy: string; outcome?: string; mandatory?: boolean } | undefined;
      const queued = (e.queued as Array<{ node: string }>).map((q) => q.node);
      return { ...base, tone: 'route', title: i?.outcome ? `Interrupted by ${i.option}${i.mandatory ? ' (mandatory)' : ''}: ${i.outcome}` : `Follow-ups queued: ${queued.length ? queued.join(', ') : 'none'}`,
        detail: (e.not_asked as string[]).length ? `Not asked on this path: ${(e.not_asked as string[]).join(', ')}.` : undefined };
    }
    case 'ROUTE': return { ...base, tone: 'route', title: `Route: ${String(e.via).startsWith('RULE:') ? `rule ${String(e.via).slice(5)}` : String(e.via) === 'FALLBACK' ? 'no rule matched' : String(e.via).toLowerCase().replace(/_/g, ' ')}`, detail: `Goes to ${target(e.to, names)}.` };
    case 'MODULE_END': return { ...base, tone: 'module', title: `${mod} ended: ${String(e.outcome)}` };
    case 'SURVEY_ROUTE': return { ...base, tone: 'route', title: `After ${mod}: ${target(e.to, names)}`, detail: e.mandatory ? 'A mandatory escalation: no survey route can weaken it.' : (e.skipped as string[]).length ? `Passes over ${(e.skipped as string[]).map((s) => names[s] ?? s).join(', ')}.` : undefined };
    case 'DISPOSITION': return { ...base, tone: 'route', title: `${mod} did not run: ${target(e.to, names)}` };
    case 'END': return { ...base, tone: 'end', title: `Run ended: ${TERMINAL_TEXT[String(e.status)] ?? String(e.status)}${e.survey_outcome ? ` (${String(e.survey_outcome)})` : ''}`, detail: e.reason ? `${String(e.reason)} at ${String(e.where ?? "")}` : undefined };
    default: return { ...base, tone: 'route', title: e.kind };
  }
}
