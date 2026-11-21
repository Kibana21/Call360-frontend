// Survey Studio prototype — the Journey Simulator's engine (SS-02B.3). DEMONSTRATION ONLY.
// It executes the SAME canonical model the Guided and Graph editors write (modules, nodes, edges, bindings, survey
// instances and routes) — there is no simulator-specific routing schema. It follows the SS-01 execution contract as
// given by the fixtures' reference interpreter: one cursor, edge resolution "specific, then ANY, else blocked",
// three-valued conditions, follow-up queues in configured order, first matching rule, and survey sequencing.
// It is NOT the Call360 runtime and makes no claim that a decision was executed or approved by it. Pure and
// deterministic: the same model, profile and answers always give the same trace.
import { describeAst, effectiveSelection, evaluate, fieldDef, fieldsOf, inputsOf, ruleWinner, type Explain, type Profile, type Tri } from './engine';
import { buildFlow, ruleText } from './flow';
import { activationOf, eligibilityOf, findCondition, findModule, findQuestion } from './ops';
import { OUTCOME_CATALOG, OUTCOME_LABEL } from './sample';
import {
  isQuestion, mKey,
  type Binding, type Instance, type Module, type OutcomeCode, type Question, type QuestionNode, type Survey, type SurveyTarget, type Target, type Workspace,
} from './types';

/** One answer, in the shape of the SS-01 answer contract: a choice, a set of choices, or text (plus the text of "Other"). */
export interface SimAnswer { choice?: string; choices?: string[]; text?: string; other_text?: string }

export type ModuleStatus = 'ACTIVATED' | 'RUNNING' | 'SKIPPED_FALSE' | 'SKIPPED_UNKNOWN' | 'SKIPPED_PRIOR_OUTCOME' | 'SKIPPED_BY_ROUTE' | 'HALTED_MISSING_INFORMATION' | 'NOT_REACHED';
/**
 * How a run ends. These are fundamentally different facts about a call and are never merged (owner decision D-136):
 *   COMPLETED                  every module that applied finished normally;
 *   ENDED_WITH_OUTCOME         a named outcome was routed to end the call (an exception, or an ordinary escalation route);
 *   MANDATORY_ESCALATION       the call ended with an escalation outcome BECAUSE a mandatory-escalation answer was given;
 *   REVIEW_REQUIRED            a module ended with the governed REVIEW_REQUIRED outcome ("Stop and flag for review");
 *   MISSING_INFORMATION_HALT   a module's eligibility could not be decided (UNKNOWN) and its policy is to stop for review;
 *   DRAFT_INVALID              the draft is incomplete or invalid here — nothing was decided, the run simply cannot continue.
 */
export type TerminalState = 'COMPLETED' | 'ENDED_WITH_OUTCOME' | 'MANDATORY_ESCALATION' | 'REVIEW_REQUIRED' | 'MISSING_INFORMATION_HALT' | 'DRAFT_INVALID';
/** How the survey arrived at a module: the next in sequence, a jump from an outcome route, or a jump from a skip disposition. */
export type Arrival = 'SEQUENCE' | 'JUMP';
/** How a value the engine read stood at that moment — the three states the evidence must keep apart, and "known". */
export type ReadState = 'KNOWN' | 'MISSING' | 'ANSWERED' | 'ANSWERED_EMPTY' | 'UNANSWERED' | 'SKIPPED';
export interface Read { what: string; state: ReadState; value: string }

interface Base { at: number; instance: string; module: string }
export type SimEvent =
  | (Base & { kind: 'ENTRY'; status: ModuleStatus; mode: string; arrival: Arrival; headline: string; why: string; result?: Tri; rule?: string; explain?: Explain; reads?: Read[] })
  | (Base & { kind: 'ASK'; key: string; node: string; number: string; text: string; followup: boolean })
  | (Base & { kind: 'REJECT'; key: string; code: string; message: string; given: string })
  | (Base & { kind: 'ANSWER'; key: string; node: string; number: string; text: string; given: string; state: ReadState; answer: SimAnswer })
  | (Base & { kind: 'ROUTE'; key: string; number: string; via: string; edge?: string; to: Target; headline: string; why: string; notChosen: string[]; alsoRules?: string[] })
  | (Base & { kind: 'DECISION'; key: string; number: string; rule: string; result: Tri; explain: Explain; reads: Read[]; via: string; edge?: string; to: Target; headline: string; why: string; notChosen: string[] })
  | (Base & { kind: 'QUEUE'; key: string; number: string; queued: Array<{ node: string; label: string; because: string }>; deduped: string[]; dedupedNodes: string[]; notAsked: string[]; interrupt?: { option: string; label: string; policy: string; outcome?: OutcomeCode; skipped: string[]; skippedNodes: string[]; mandatory: boolean }; headline: string; why: string })
  | (Base & { kind: 'MODULE_END'; outcome: OutcomeCode; headline: string })
  | (Base & { kind: 'SURVEY_ROUTE'; mandatory?: boolean; overridden?: boolean; outcome: OutcomeCode; headline: string; why: string; skipped: string[] })
  | (Base & { kind: 'DISPOSITION'; status: ModuleStatus; to: SurveyTarget; headline: string; why: string; skipped: string[] })
  | (Base & { kind: 'END'; status: TerminalState; surveyOutcome?: OutcomeCode; reason?: string; where?: string; headline: string; why: string });

export interface Pending {
  key: string; instance: string; node: string; number: string; module: string; question: Question; followup: boolean;
  /** The follow-up queue this question belongs to, when it is one: what is done, what is next. */
  queue?: Array<{ node: string; label: string; state: 'DONE' | 'NOW' | 'NEXT' }>;
}
export interface ModuleLine { instance: string; name: string; status: ModuleStatus; outcome?: OutcomeCode; why: string }
export interface Evidence { question_instance: string; question: string; wording_version: number; answer: SimAnswer }
export interface AnswerLine { key: string; instance: string; number: string; text: string; state: ReadState | 'NOT_REACHED'; given: string }
export interface SimResult {
  events: SimEvent[];
  modules: ModuleLine[];
  pending: Pending | null;
  end: Extract<SimEvent, { kind: 'END' }> | null;
  /** In the terms of the SS-01 reference interpreter, for fixture verification. */
  asked: string[]; edges: string[]; evidence: Evidence[]; trace: string[];
  /** The terminal state of the run, or null while a question is pending. */
  terminal: { state: TerminalState; surveyOutcome?: OutcomeCode; reason?: string; at?: string } | null;
  /** Every question of every module that ran: answered, answered with an empty selection, unanswered, or skipped on this path. */
  answerLines: AnswerLine[];
}

// ---- answer validation: the stable error codes of SS-01 Part A §3.7 -------------------------------------------------
const MESSAGE: Record<string, string> = {
  TEXT_REQUIRED: 'An answer is required.', TEXT_TOO_SHORT: 'The answer is too short.', TEXT_TOO_LONG: 'The answer is too long.',
  CHOICE_REQUIRED: 'Choose an answer.', UNKNOWN_OPTION: 'That is not one of the answers.', DUPLICATE_OPTION: 'An answer was chosen twice.',
  TOO_FEW_SELECTED: 'Too few answers were chosen.', TOO_MANY_SELECTED: 'Too many answers were chosen.',
  EXCLUSIVE_OPTION_CONFLICT: 'One of the chosen answers cannot be combined with others.',
  OTHER_TEXT_REQUIRED: 'Please specify: text is required when "Other" is chosen.', OTHER_TEXT_TOO_SHORT: 'Please specify: the text is too short.',
  OTHER_TEXT_TOO_LONG: 'Please specify: the text is too long.', OTHER_TEXT_NOT_ALLOWED: 'Text was given, but "Other" was not chosen.',
};
/** Returns the stable rejection code for an answer, or null when it is accepted. Order of checks follows the reference. */
export function validateAnswer(q: Question, a: SimAnswer): string | null {
  if (q.answerType === 'FREE_TEXT') {
    const text = (a.text ?? '').trim();
    const rule = q.textRule ?? { required: true, min: 0, max: 2000 };
    if (rule.required && !text) return 'TEXT_REQUIRED';
    if (text.length < rule.min) return 'TEXT_TOO_SHORT';
    if (text.length > rule.max) return 'TEXT_TOO_LONG';
    return null;
  }
  const single = q.answerType !== 'MULTI_SELECT';
  if (single && a.choice === undefined) return 'CHOICE_REQUIRED';
  const chosen = single ? [a.choice!] : [...(a.choices ?? [])];
  const opts = new Map(q.options.map((o) => [o.code, o]));
  if (chosen.some((c) => !opts.has(c))) return 'UNKNOWN_OPTION';
  if (new Set(chosen).size !== chosen.length) return 'DUPLICATE_OPTION';
  if (!single) {
    const sel = q.selection ?? (q.published ? { min: 0, max: q.options.length } : effectiveSelection(q));
    if (chosen.length < sel.min) return 'TOO_FEW_SELECTED';
    if (chosen.length > sel.max) return 'TOO_MANY_SELECTED';
    if (chosen.length > 1 && chosen.some((c) => opts.get(c)!.exclusive)) return 'EXCLUSIVE_OPTION_CONFLICT';
  }
  const other = chosen.map((c) => opts.get(c)!).find((o) => o.isOther);
  const text = (a.other_text ?? '').trim();
  if (!other) return a.other_text !== undefined ? 'OTHER_TEXT_NOT_ALLOWED' : null;
  const rule = other.otherText ?? { required: false, min: 0, max: 500 };
  if (rule.required && !text) return 'OTHER_TEXT_REQUIRED';
  if (text && text.length < rule.min) return 'OTHER_TEXT_TOO_SHORT';
  if (text.length > rule.max) return 'OTHER_TEXT_TOO_LONG';
  return null;
}
export const rejectionMessage = (code: string) => MESSAGE[code] ?? code;

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const optLabel = (q: Question, code: string) => q.options.find((o) => o.code === code)?.label ?? code;
/** An answer as the customer would have said it. */
export function answerText(q: Question, a: SimAnswer): string {
  if (q.answerType === 'FREE_TEXT') return (a.text ?? '').trim() ? `“${clip((a.text ?? '').trim(), 80)}”` : '(no answer given)';
  const codes = q.answerType === 'MULTI_SELECT' ? a.choices ?? [] : a.choice !== undefined ? [a.choice] : [];
  if (!codes.length) return q.answerType === 'MULTI_SELECT' ? '(nothing selected)' : '(no answer)';
  return codes.map((c) => optLabel(q, c)).join(', ') + ((a.other_text ?? '').trim() ? ` — “${clip(a.other_text!.trim(), 60)}”` : '');
}
const answerState = (q: Question, a: SimAnswer): ReadState =>
  (q.answerType === 'FREE_TEXT' ? ((a.text ?? '').trim() ? 'ANSWERED' : 'UNANSWERED') : q.answerType === 'MULTI_SELECT' && !(a.choices ?? []).length ? 'ANSWERED_EMPTY' : 'ANSWERED');
const fmtValue = (v: unknown, code?: string): string => {
  const f = code ? fieldDef(code) : undefined;
  if (v === null || v === undefined || v === '') return 'missing';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return `${v.toLocaleString('en-SG')}${f?.unit ? ` ${f.unit}` : ''}`;
  const t = String(v);
  return t.length <= 3 ? t : t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ');
};

type NoAt<T> = T extends unknown ? Omit<T, 'at'> : never;

class Stop extends Error {
  constructor(public status: 'BLOCKED' | 'REVIEW_REQUIRED' | 'MISSING_INFORMATION' | 'PENDING', public reason: string, public where: string, public human = '') { super(reason); }
}

/**
 * Runs a survey for one profile. `next(key, attempt)` supplies the answer for a question instance (`<instance>/<node>`);
 * returning undefined stops the run there with that question pending. A rejected answer is recorded and the same
 * question is asked again (attempt + 1), so validation can never be skipped.
 */
export function simulate(ws: Workspace, survey: Survey, profile: Profile, next: (key: string, attempt: number) => SimAnswer | undefined): SimResult {
  const events: SimEvent[] = [];
  const asked: string[] = [], edges: string[] = [], evidence: Evidence[] = [], trace: string[] = [];
  const answers = new Map<string, SimAnswer>(); // by question instance key
  const outcomes = new Map<string, OutcomeCode>();
  const status = new Map<string, ModuleLine>();
  let pending: Pending | null = null;
  let terminal: SimResult['terminal'] = null;
  const nameOf = (inst: Instance) => findModule(ws, mKey(inst.module))?.name ?? inst.id;
  const push = (e: NoAt<SimEvent>) => { events.push({ ...e, at: events.length } as SimEvent); };
  const targetText = (m: Module, numbers: Map<string, string>, t: Target | null): string => {
    if (!t) return 'nowhere';
    if ('ret' in t) return 'back to the follow-up queue';
    if ('outcome' in t) return t.outcome === 'REVIEW_REQUIRED' ? 'stop: review required' : `the end of the module (${OUTCOME_LABEL[t.outcome]})`;
    const n = m.nodes.find((x) => x.id === t.node);
    return n && !isQuestion(n) ? `the condition ${numbers.get(t.node) ?? ''}`.trim() : `${numbers.get(t.node) ?? 'the next question'}`;
  };

  /** Evaluates one condition binding and describes, in words, what was read and what stood where. */
  const judge = (b: Binding, m: Module | undefined, inst: string, numbers?: Map<string, string>) => {
    const c = findCondition(ws, b.condition);
    if (!c) throw new Stop('BLOCKED', 'CONDITION_MISSING', inst, 'Its condition no longer exists.');
    const nodeAnswers: Record<string, string | string[] | null | undefined> = {};
    const reads: Read[] = fieldsOf(c.ast).map((code) => {
      const v = profile[code];
      const known = !(v === null || v === undefined || v === '');
      return { what: fieldDef(code)?.label ?? code, state: known ? 'KNOWN' : 'MISSING', value: fmtValue(v, code) };
    });
    const qOfInput = (name: string): Question | undefined => {
      const n = m?.nodes.find((x) => x.id === b.inputs?.[name]?.node);
      return n && isQuestion(n) ? findQuestion(ws, n.q) : undefined;
    };
    for (const name of inputsOf(c.ast)) {
      const node = b.inputs?.[name]?.node;
      const q = qOfInput(name);
      const a = node ? answers.get(`${inst}/${node}`) : undefined;
      const what = `the answer to ${node ? numbers?.get(node) ?? 'an earlier question' : 'an earlier question'}`;
      if (!node || !q || !a) {
        // not collected on the path that was actually taken: UNKNOWN — never read as "no", and never as an empty selection
        reads.push({ what, state: 'SKIPPED', value: 'not asked on this path' });
        continue;
      }
      const state = answerState(q, a);
      nodeAnswers[node] = q.answerType === 'MULTI_SELECT' ? a.choices ?? [] : q.answerType === 'FREE_TEXT' ? a.text ?? null : a.choice ?? null;
      reads.push({ what, state, value: answerText(q, a) });
    }
    const ctx = {
      answers: nodeAnswers,
      inputLabel: (name: string) => { const node = b.inputs?.[name]?.node; return `the answer to ${node ? numbers?.get(node) ?? 'an earlier question' : 'an earlier question'}`; },
      optionLabel: (name: string, code: string) => `“${qOfInput(name)?.options.find((o) => o.code === code)?.label ?? code}”`,
    };
    const explain = evaluate(c.ast, c, b, profile, ctx);
    return { explain, result: explain.result, rule: describeAst(c.ast, c, b, false, ctx), reads, name: c.shared ? `${c.name} · v${c.version}` : undefined };
  };

  const runModule = (inst: Instance, m: Module): { outcome: OutcomeCode; mandatory: boolean } => {
    let mandatory = false; // true when the step that ended the module was a mandatory-escalation answer
    const flow = buildFlow(ws, m);
    const numbers = flow.numbers;
    const base = { instance: inst.id, module: m.name };
    const num = (id: string) => numbers.get(id) ?? id;
    const follow = (node: string, code: string): { to: Target; edge: string; specific: boolean } => {
      const specific = m.edges.filter((x) => x.from === node && x.on === code);
      const cands = specific.length ? specific : m.edges.filter((x) => x.from === node && x.on === 'ANY');
      if (cands.length !== 1) throw new Stop('BLOCKED', cands.length ? 'AMBIGUOUS_ROUTE' : 'ROUTE_MISSING', `${inst.id}/${node}`, `${num(node)} has no destination for this answer.`);
      edges.push(`${inst.id}/${cands[0]!.id}`);
      return { to: cands[0]!.to, edge: cands[0]!.id, specific: specific.length > 0 };
    };
    const ask = (nodeId: string, followup: boolean, queue?: Pending['queue']): { node: QuestionNode; q: Question; a: SimAnswer } => {
      const node = m.nodes.find((x) => x.id === nodeId);
      if (!node || !isQuestion(node)) throw new Stop('BLOCKED', 'NODE_MISSING', `${inst.id}/${nodeId}`, 'A route leads to a step that no longer exists.');
      const key = `${inst.id}/${nodeId}`;
      if (asked.includes(key)) throw new Stop('BLOCKED', 'REPEATED_EXECUTION', key, `${num(nodeId)} would be asked twice: the routes form a loop.`);
      if (asked.length > 200) throw new Stop('BLOCKED', 'TRAVERSAL_LIMIT', key, 'The journey is too long: the routes probably form a loop.');
      const q = findQuestion(ws, node.q)!;
      const text = q.wording.text.trim() || 'Untitled question';
      push({ kind: 'ASK', ...base, key, node: nodeId, number: num(nodeId), text, followup });
      for (let attempt = 0; ; attempt++) {
        const a = next(key, attempt);
        if (a === undefined) {
          pending = { key, instance: inst.id, node: nodeId, number: num(nodeId), module: m.name, question: q, followup, ...(queue ? { queue } : {}) };
          throw new Stop('PENDING', 'AWAITING_ANSWER', key);
        }
        const code = validateAnswer(q, a);
        if (code) { push({ kind: 'REJECT', ...base, key, code, message: rejectionMessage(code), given: answerText(q, a) }); if (attempt > 20) throw new Stop('BLOCKED', 'ANSWER_REJECTED', key, 'The answer keeps being rejected.'); continue; }
        asked.push(key);
        answers.set(key, a);
        evidence.push({ question_instance: key, question: `${q.code}@${node.q.version}`, wording_version: q.wording.version, answer: a });
        push({ kind: 'ANSWER', ...base, key, node: nodeId, number: num(nodeId), text, given: answerText(q, a), state: answerState(q, a), answer: a });
        return { node, q, a };
      }
    };

    let cur: Target | null = m.entry ? { node: m.entry } : null;
    for (;;) {
      if (!cur) throw new Stop('BLOCKED', 'ROUTE_MISSING', inst.id, `${m.name} has nothing to ask yet.`);
      if ('ret' in cur) throw new Stop('BLOCKED', 'RETURN_OUTSIDE_QUEUE', inst.id, 'A route returns to a follow-up queue that is not running.');
      if ('outcome' in cur) return { outcome: cur.outcome, mandatory };
      const n = m.nodes.find((x) => x.id === (cur as { node: string }).node);
      if (!n) throw new Stop('BLOCKED', 'NODE_MISSING', `${inst.id}/${(cur as { node: string }).node}`, 'A route leads to a step that no longer exists.');
      const key = `${inst.id}/${n.id}`;

      if (!isQuestion(n)) {
        if (!n.binding || !n.binding.condition.code) throw new Stop('BLOCKED', 'CONDITION_MISSING', key, `${num(n.id)} has no condition yet.`);
        const j = judge(n.binding, m, inst.id, numbers);
        trace.push(`${key}: ${j.result}`);
        const via = j.result === 'TRUE' ? 'MATCH' : j.result === 'FALSE' ? 'NO_MATCH' : 'UNKNOWN';
        const names = { MATCH: 'Matches', NO_MATCH: 'Otherwise', UNKNOWN: 'Unknown' } as const;
        const specific = m.edges.find((x) => x.from === n.id && x.on === via);
        if (!specific) throw new Stop('BLOCKED', 'ROUTE_MISSING', key, `${num(n.id)} has no destination for “${names[via]}”${via === 'UNKNOWN' ? ' — missing information is never treated as “otherwise”' : ''}.`);
        edges.push(`${inst.id}/${specific.id}`);
        const notChosen = (['MATCH', 'NO_MATCH', 'UNKNOWN'] as const).filter((x) => x !== via).map((x) => (x === 'MATCH' ? '“Matches” was not taken: the condition did not come out true.'
          : x === 'NO_MATCH' ? `“Otherwise” was not taken: ${j.result === 'UNKNOWN' ? 'the result is unknown, and unknown is never treated as “otherwise”' : 'the condition is true'}.`
            : '“Unknown” was not taken: everything the condition needs was known.'));
        push({
          kind: 'DECISION', ...base, key, number: num(n.id), rule: j.rule, result: j.result, explain: j.explain, reads: j.reads, via, edge: specific.id, to: specific.to,
          headline: `${num(n.id)} · ${j.result === 'TRUE' ? 'matches' : j.result === 'FALSE' ? 'does not match' : 'cannot be decided (unknown)'} → ${targetText(m, numbers, specific.to)}`,
          why: `The condition “${j.rule}” came out ${j.result === 'TRUE' ? 'TRUE' : j.result === 'FALSE' ? 'FALSE' : 'UNKNOWN'}, so the “${names[via]}” route is taken.`, notChosen,
        });
        cur = specific.to;
        continue;
      }

      const { node, q, a } = ask(n.id, false);
      mandatory = false; // it describes only the step that ends the module
      const r = node.routing;
      if (r.mode === 'SEQUENTIAL_FOLLOWUPS') {
        const chosen = a.choices ?? [];
        const index = (code: string) => q.options.findIndex((o) => o.code === code);
        const rank = (i: NonNullable<typeof r.interrupts>[number]) => (q.options.find((o) => o.code === i.option)?.interrupt === 'MANDATORY' ? 0 : 1);
        // a mandatory escalation leads; then configured order, then the order of the answers
        const hits = (r.interrupts ?? []).filter((i) => chosen.includes(i.option))
          .sort((x, y) => rank(x) - rank(y) || (r.interrupts ?? []).indexOf(x) - (r.interrupts ?? []).indexOf(y) || index(x.option) - index(y.option));
        const queueIds: string[] = [], deduped: string[] = [], becauseOf = new Map<string, string[]>();
        for (const f of (r.followups ?? []).filter((x) => chosen.includes(x.option))) for (const t of f.nodes) {
          if (queueIds.includes(t)) deduped.push(t); else queueIds.push(t);
          becauseOf.set(t, [...(becauseOf.get(t) ?? []), optLabel(q, f.option)]);
        }
        const label = (id: string) => { const fn = m.nodes.find((x) => x.id === id); const fq = fn && isQuestion(fn) ? findQuestion(ws, fn.q) : undefined; return `${num(id)} ${clip(fq?.wording.text ?? '', 50)}`; };
        const notAsked = (r.followups ?? []).filter((x) => !chosen.includes(x.option)).flatMap((x) => x.nodes).filter((t, i, all) => !queueIds.includes(t) && all.indexOf(t) === i);
        const queued = queueIds.map((id) => ({ node: id, label: label(id), because: becauseOf.get(id)!.join(' and ') }));
        const hit = hits[0];
        if (hit && hit.policy === 'STOP_ESCALATE') {
          if (!hit.outcome) throw new Stop('BLOCKED', 'ROUTE_MISSING', key, `“${optLabel(q, hit.option)}” stops the follow-ups but has no outcome.`);
          trace.push(`${key}: INTERRUPT ${hit.option} -> ${hit.outcome}; skipped [${queueIds.map((x) => `'${x}'`).join(', ')}]`);
          const mandatoryHit = q.options.find((o) => o.code === hit.option)?.interrupt === 'MANDATORY';
          push({
            kind: 'QUEUE', ...base, key, number: num(n.id), queued: [], deduped: [], dedupedNodes: [], notAsked: queueIds.map(label),
            interrupt: { option: hit.option, label: optLabel(q, hit.option), policy: hit.policy, outcome: hit.outcome, skipped: queueIds.map(label), skippedNodes: queueIds, mandatory: mandatoryHit },
            headline: `“${optLabel(q, hit.option)}” stops the follow-ups → ${OUTCOME_LABEL[hit.outcome]}`,
            why: `${mandatoryHit ? 'This answer is a mandatory escalation: it overrides everything else that was selected.' : 'This answer is set to stop the follow-ups.'} ${queueIds.length ? `${queueIds.length} follow-up question${queueIds.length === 1 ? ' was' : 's were'} not asked.` : 'No follow-up was pending.'}`,
          });
          return { outcome: hit.outcome, mandatory: mandatoryHit };
        }
        if (hit && hit.policy === 'STOP_REJOIN') {
          if (!hit.rejoin) throw new Stop('BLOCKED', 'ROUTE_MISSING', key, `“${optLabel(q, hit.option)}” stops the follow-ups but has no destination.`);
          push({
            kind: 'QUEUE', ...base, key, number: num(n.id), queued: [], deduped: [], dedupedNodes: [], notAsked: queueIds.map(label),
            interrupt: { option: hit.option, label: optLabel(q, hit.option), policy: hit.policy, skipped: queueIds.map(label), skippedNodes: queueIds, mandatory: false },
            headline: `“${optLabel(q, hit.option)}” stops the follow-ups → ${targetText(m, numbers, hit.rejoin)}`, why: 'This answer is set to stop the follow-ups and continue elsewhere.',
          });
          cur = hit.rejoin;
          continue;
        }
        const first = hit && hit.policy === 'RESUME' ? hit.nodes ?? [] : [];
        const order = [...first.filter((x) => !queueIds.includes(x)), ...queueIds];
        trace.push(`${key}: QUEUE [${queueIds.map((x) => `'${x}'`).join(', ')}]${deduped.length ? `; deduped [${deduped.map((x) => `'${x}'`).join(', ')}]` : ''}`);
        push({
          kind: 'QUEUE', ...base, key, number: num(n.id), queued: order.map((id) => queued.find((x) => x.node === id) ?? { node: id, label: label(id), because: optLabel(q, hit!.option) }),
          deduped: [...new Set(deduped)].map(label), dedupedNodes: deduped, notAsked: notAsked.map(label),
          ...(hit ? { interrupt: { option: hit.option, label: optLabel(q, hit.option), policy: hit.policy, skipped: [], skippedNodes: [], mandatory: false } } : {}),
          headline: order.length ? `${order.length} follow-up question${order.length === 1 ? '' : 's'} queued, in the configured order` : 'No follow-up is needed for this selection',
          why: `Follow-ups are asked one at a time in the order set on the question — not in the order the customer happened to choose.${deduped.length ? ' A question shared by two selected answers is asked once.' : ''}`,
        });
        let early: OutcomeCode | null = null;
        for (let i = 0; i < order.length && !early; i++) {
          const view = order.map((id, k) => ({ node: id, label: label(id), state: (k < i ? 'DONE' : k === i ? 'NOW' : 'NEXT') as 'DONE' | 'NOW' | 'NEXT' }));
          const f = ask(order[i]!, true, view);
          const got = follow(order[i]!, f.q.answerType === 'FREE_TEXT' ? 'AFTER_CAPTURE' : f.q.answerType === 'MULTI_SELECT' ? 'ANY' : f.a.choice!);
          if ('outcome' in got.to) {
            early = got.to.outcome;
            push({ kind: 'ROUTE', ...base, key: `${inst.id}/${order[i]}`, number: num(order[i]!), via: 'FOLLOWUP', edge: got.edge, to: got.to, headline: `${num(order[i]!)} ends the module: ${OUTCOME_LABEL[early]}`, why: 'This follow-up answer is routed to a module outcome, so the rest of the queue is not asked.', notChosen: [] });
          } else if (!('ret' in got.to)) throw new Stop('BLOCKED', 'FOLLOWUP_MUST_RETURN', `${inst.id}/${order[i]}`, 'A follow-up question must return to its queue or end the module.');
        }
        if (early) return { outcome: early, mandatory: false };
        if (!r.rejoin) throw new Stop('BLOCKED', 'ROUTE_MISSING', key, `${num(n.id)} has no destination after its follow-ups.`);
        push({ kind: 'ROUTE', ...base, key, number: num(n.id), via: 'REJOIN', to: r.rejoin, headline: `After the follow-ups → ${targetText(m, numbers, r.rejoin)}`, why: order.length ? 'The queue is finished; everyone rejoins at the same place.' : 'Nothing was queued, so the journey continues at the rejoin point.', notChosen: [] });
        cur = r.rejoin;
        continue;
      }
      if (r.mode === 'ORDERED_RULES') {
        const chosen = a.choices ?? [];
        const w = ruleWinner(node, chosen);
        const rules = r.rules ?? [];
        if (!w.to) throw new Stop('BLOCKED', 'ROUTE_MISSING', key, w.index >= 0 ? `Rule ${w.index + 1} of ${num(n.id)} has no destination.` : `${num(n.id)} has no “Otherwise” destination.`);
        const notChosen = [
          ...rules.slice(0, w.index >= 0 ? w.index : rules.length).map((rule, i) => `Rule ${i + 1} (${ruleText(q, rule)}) does not fit this selection.`),
          ...w.alsoMatched.map((i) => `Rule ${i + 1} (${ruleText(q, rules[i]!)}) also fits, but an earlier rule had already decided. Only one route is taken.`),
        ];
        push({
          kind: 'ROUTE', ...base, key, number: num(n.id), via: w.index >= 0 ? `RULE:${rules[w.index]!.id}` : 'FALLBACK', to: w.to, alsoRules: w.alsoMatched.map((i) => rules[i]!.id),
          headline: `${w.index >= 0 ? `Rule ${w.index + 1} decides` : 'No rule fits — “Otherwise” decides'} → ${targetText(m, numbers, w.to)}`,
          why: w.index >= 0 ? `Rules are checked from the top; rule ${w.index + 1} (${ruleText(q, rules[w.index]!)}) is the first that fits.` : 'Rules are checked from the top and none fits, so the “Otherwise” route is taken.', notChosen,
        });
        // a mandatory-escalation answer stays mandatory under rule-based routing: whatever rule wins, the ending is one
        mandatory = chosen.some((c) => q.options.find((o) => o.code === c)?.interrupt === 'MANDATORY');
        cur = w.to;
        continue;
      }
      const code = q.answerType === 'FREE_TEXT' ? 'AFTER_CAPTURE' : q.answerType === 'MULTI_SELECT' ? 'ANY' : a.choice!;
      const got = follow(n.id, code);
      const said = q.answerType === 'FREE_TEXT' ? 'the answer' : q.answerType === 'MULTI_SELECT' ? 'any selection' : `“${optLabel(q, a.choice!)}”`;
      const others = r.mode !== 'ALL_TO_NEXT' && (q.answerType === 'YES_NO' || q.answerType === 'SINGLE_SELECT')
        ? q.options.filter((o) => o.code !== a.choice).map((o) => { const e = m.edges.find((x) => x.from === n.id && x.on === o.code) ?? m.edges.find((x) => x.from === n.id && x.on === 'ANY'); return `“${o.label}” would have led to ${targetText(m, numbers, e?.to ?? null)}.`; })
        : [];
      const must = q.options.find((o) => o.code === a.choice)?.interrupt === 'MANDATORY';
      mandatory = must;
      push({
        kind: 'ROUTE', ...base, key, number: num(n.id), via: code, edge: got.edge, to: got.to,
        headline: `${num(n.id)} · ${said} → ${targetText(m, numbers, got.to)}`,
        why: must ? 'This answer is a mandatory escalation: its route can only lead to an approved escalation outcome.'
          : r.mode === 'ALL_TO_NEXT' ? 'Every answer to this question continues to the same place.'
            : got.specific && code !== 'ANY' && code !== 'AFTER_CAPTURE' ? `There is a route set for ${said}.` : `No route is specific to ${said}, so the route that covers every other answer applies.`,
        notChosen: others,
      });
      cur = got.to;
    }
  };

  // ---- the survey: modules in sequence. Three different things decide whether a module runs (D-135):
  //   ROUTING / JUMP   names the next CANDIDATE module (the next in sequence, or the target of a jump);
  //   ACTIVATION       when a module is selected at all: in sequence, by a jump, or by a named earlier outcome;
  //   ELIGIBILITY      whether the candidate may execute: its condition, with an explicit policy for UNKNOWN.
  // A jump never bypasses eligibility. A module is considered at most once and every move is forward: no re-entry, no loop.
  const seq = survey.sequence;
  let pos = 0;
  let jump: { from: string; because: string } | null = null; // set when the current candidate was reached by a jump
  const endCall = (o: OutcomeCode, inst: Instance, mandatory: boolean) => {
    const state: TerminalState = o === 'COMPLETED' ? 'COMPLETED' : mandatory && OUTCOME_CATALOG[o].cls === 'ESCALATION' ? 'MANDATORY_ESCALATION' : 'ENDED_WITH_OUTCOME';
    terminal = { state, surveyOutcome: o };
    push({
      kind: 'END', instance: inst.id, module: nameOf(inst), status: state, surveyOutcome: o,
      headline: state === 'COMPLETED' ? 'The call is completed' : state === 'MANDATORY_ESCALATION' ? `The call ends: ${OUTCOME_LABEL[o]} — mandatory escalation` : `The call ends: ${OUTCOME_LABEL[o]}`,
      why: state === 'COMPLETED' ? 'Every module that applied to this customer has finished.'
        : state === 'MANDATORY_ESCALATION' ? `The customer gave an answer that is a mandatory escalation. It overrides ordinary routing, and the call ends with “${OUTCOME_LABEL[o]}”. ${OUTCOME_CATALOG[o].meaning}`
          : `A module outcome was routed to end the call with “${OUTCOME_LABEL[o]}”. ${OUTCOME_CATALOG[o].meaning}`,
    });
  };
  /** Moves on from `inst` to a survey target. Returns false when the call ended. */
  const go = (inst: Instance, to: SurveyTarget, what: string, mandatory: boolean): boolean => {
    if (to === '@CONTINUE') { pos += 1; jump = null; return true; }
    if ('surveyOutcome' in to) { endCall(to.surveyOutcome, inst, mandatory); return false; }
    const tgt = seq.findIndex((x) => x.id === to.instance);
    if (tgt < 0) throw new Stop('BLOCKED', 'ROUTE_MISSING', inst.id, `${what} leads to a module that was removed.`);
    if (tgt <= pos) throw new Stop('BLOCKED', 'BACKWARD_ROUTE', inst.id, `${what} leads backwards. A module is never entered twice.`);
    for (const sk of seq.slice(pos + 1, tgt)) status.set(sk.id, { instance: sk.id, name: nameOf(sk), status: 'SKIPPED_BY_ROUTE', why: `${what} jumps straight to ${nameOf(seq[tgt]!)}.` });
    pos = tgt;
    jump = { from: inst.id, because: what };
    return true;
  };
  try {
    let ended = false;
    while (pos < seq.length && !ended) {
      const inst: Instance = seq[pos]!;
      const m = findModule(ws, mKey(inst.module));
      const name = m?.name ?? inst.id;
      const base = { instance: inst.id, module: name };
      if (!m) throw new Stop('BLOCKED', 'MODULE_MISSING', inst.id, 'This module is no longer in the workspace.');
      const act = activationOf(inst);
      const elig = eligibilityOf(inst);
      const arrival: Arrival = jump ? 'JUMP' : 'SEQUENCE';
      // 1. ACTIVATION — is the module selected at all? In sequence, by a named earlier outcome, or by an explicit jump.
      let selected = jump ? `It was selected by a jump: ${(jump as { because: string }).because}.` : 'It is next in the sequence.';
      let state: ModuleStatus = 'ACTIVATED';
      if (act) {
        const of = seq.find((x) => x.id === act.of);
        const ofName = of ? nameOf(of) : 'a removed module';
        const got = outcomes.get(act.of);
        const wanted = act.outcomes.map((o) => OUTCOME_LABEL[o]).join(' or ');
        if (jump) selected = `${selected} In sequence it is selected only after ${ofName} ends with ${wanted}; an explicit jump also selects it.`;
        else if (got && act.outcomes.includes(got)) selected = `It is selected because ${ofName} ended with ${OUTCOME_LABEL[got]} (it is activated only after ${ofName} ends with ${wanted}).`;
        else {
          state = 'SKIPPED_PRIOR_OUTCOME';
          push({
            kind: 'ENTRY', ...base, status: state, mode: 'ON_OUTCOME', arrival, headline: `${name} is skipped`,
            why: `It is activated only after ${ofName} ends with ${wanted}. ${got ? `${ofName} ended with ${OUTCOME_LABEL[got]}.` : `${ofName} did not run.`} It was not selected, so its eligibility was not checked.`,
          });
        }
      }
      // 2. ELIGIBILITY — may the selected module execute? Being selected (even by a jump) never bypasses this.
      if (state === 'ACTIVATED' && !elig) {
        push({ kind: 'ENTRY', ...base, status: 'ACTIVATED', mode: act ? 'ON_OUTCOME' : 'ALWAYS', arrival, headline: `${name} runs`, why: `${selected} It has no eligibility condition, so it runs.` });
      } else if (state === 'ACTIVATED' && elig) {
        const j = judge(elig, undefined, inst.id);
        trace.push(`${inst.id}: entry ${j.result}`);
        const policy = elig.unknownPolicy;
        if (j.result === 'UNKNOWN' && !policy) throw new Stop('BLOCKED', 'UNKNOWN_POLICY_MISSING', inst.id, `${name} does not say what happens when information is missing.`);
        state = j.result === 'TRUE' ? 'ACTIVATED' : j.result === 'FALSE' ? 'SKIPPED_FALSE' : policy === 'SKIP_WITH_REASON' ? 'SKIPPED_UNKNOWN' : 'HALTED_MISSING_INFORMATION';
        const missing = j.reads.filter((x) => x.state === 'MISSING').map((x) => x.what).join(', ');
        const lead = jump ? `${selected} A jump does not bypass eligibility: it is eligible when ${j.rule}.`
          : act ? `${selected} Being selected is not enough: it is eligible when ${j.rule}.` : `It is eligible when ${j.rule}.`;
        push({
          kind: 'ENTRY', ...base, status: state, mode: 'RULE', arrival, result: j.result, rule: j.rule, explain: j.explain, reads: j.reads,
          headline: state === 'ACTIVATED' ? `${name} runs` : state === 'HALTED_MISSING_INFORMATION' ? `${name} cannot be decided — the call halts` : `${name} is skipped`,
          why: state === 'ACTIVATED' ? `${lead} That is true for this customer.`
            : state === 'SKIPPED_FALSE' ? `${lead} That is false for this customer.`
              : state === 'SKIPPED_UNKNOWN' ? `${lead} That cannot be decided because ${missing || 'information'} is missing. This module is set to be skipped in that case, and the reason is recorded as “information missing” — not as “did not match”.`
                : `${lead} That cannot be decided because ${missing || 'information'} is missing. Missing information is never treated as “no”: this module is set to stop for review.`,
        });
        if (state === 'HALTED_MISSING_INFORMATION') {
          status.set(inst.id, { instance: inst.id, name, status: state, why: `Could not be decided: ${missing || 'information'} is missing.` });
          throw new Stop('MISSING_INFORMATION', 'ELIGIBILITY_UNKNOWN', inst.id, `Whether ${name} applies could not be decided because ${missing || 'information'} is missing.`);
        }
      }
      if (state !== 'ACTIVATED') {
        const last = events[events.length - 1] as Extract<SimEvent, { kind: 'ENTRY' }>;
        status.set(inst.id, { instance: inst.id, name, status: state, why: last.why });
        // The skip disposition applies however the module was reached (A-3). A module that was never SELECTED (its
        // activation trigger did not fire) is not "ineligible": the next module is simply considered.
        if (state === 'SKIPPED_PRIOR_OUTCOME') { pos += 1; continue; }
        const d = jump ? inst.ifIneligible : inst.ifSkippedInSequence;
        if (!jump && d === undefined) { pos += 1; continue; } // in sequence the normal default is to consider the next module
        // after a jump it must have been chosen; nothing is invented
        if (d === null || d === undefined) throw new Stop('BLOCKED', 'SKIP_DISPOSITION_MISSING', inst.id, `${name} was reached ${jump ? 'by a jump' : 'in sequence'} and does not apply, and the survey does not say what happens then.`);
        const text = d === '@CONTINUE' ? (seq[pos + 1] ? `the call continues with ${nameOf(seq[pos + 1]!)}` : 'that was the last module') : 'surveyOutcome' in d ? `the call ends: ${OUTCOME_LABEL[d.surveyOutcome]}` : `the call goes to ${nameOf(seq.find((x) => x.id === d.instance) ?? inst)}`;
        push({ kind: 'DISPOSITION', ...base, status: state, to: d, skipped: [], headline: `${name} does not apply, so ${text}`, why: `This is what the survey says to do when ${name} is ${jump ? 'jumped to' : 'reached'} but is not eligible.` });
        ended = !go(inst, d, `“If it does not apply” of ${name}`, false);
        continue;
      }
      jump = null;
      status.set(inst.id, { instance: inst.id, name, status: 'RUNNING', why: (events[events.length - 1] as Extract<SimEvent, { kind: 'ENTRY' }>).why });
      const ran = runModule(inst, m);
      const out = ran.outcome;
      outcomes.set(inst.id, out);
      status.set(inst.id, { instance: inst.id, name, status: 'ACTIVATED', outcome: out, why: status.get(inst.id)!.why });
      push({ kind: 'MODULE_END', ...base, outcome: out, headline: `${name} ends: ${OUTCOME_LABEL[out]}` });
      if (OUTCOME_CATALOG[out].cls === 'REVIEW_HALT') throw new Stop('REVIEW_REQUIRED', 'REVIEW_REQUIRED', inst.id, `${name} ended with the governed outcome “Review required” (a decision in it is set to stop and flag for review).`);
      // A mandatory escalation cannot be overridden by survey-level routing (A-4): it always ends the call with its
      // own governed escalation outcome, whatever route the survey has for that outcome.
      if (ran.mandatory && OUTCOME_CATALOG[out].cls !== 'ESCALATION') throw new Stop('BLOCKED', 'MANDATORY_ESCALATION_WEAKENED', inst.id, `A mandatory-escalation answer in ${name} ended the module with “${OUTCOME_LABEL[out]}”, which is not an escalation outcome.`);
      const configured = inst.routes[out];
      const honoured = !!configured && typeof configured === 'object' && 'surveyOutcome' in configured && configured.surveyOutcome === out;
      // Escalate is TERMINAL for the survey however the module reached it (SS-02 closure): never continued, never re-routed.
      const terminalEscalation = OUTCOME_CATALOG[out].cls === 'ESCALATION';
      const to: SurveyTarget | null | undefined = terminalEscalation ? { surveyOutcome: out } : configured;
      if (to === null || to === undefined) throw new Stop('BLOCKED', 'ROUTE_MISSING', `${inst.id}:${out}`, `${name} ended with “${OUTCOME_LABEL[out]}”, and the survey does not say what happens then.`);
      const what = `“${OUTCOME_LABEL[out]}” of ${name}`;
      if (to === '@CONTINUE') push({ kind: 'SURVEY_ROUTE', ...base, outcome: out, skipped: [], headline: seq[pos + 1] ? `Continues to ${nameOf(seq[pos + 1]!)}` : 'That was the last module', why: `${what} is routed to continue with the next module.` });
      else if ('surveyOutcome' in to) push({ kind: 'SURVEY_ROUTE', ...base, outcome: out, skipped: [], ...(ran.mandatory ? { mandatory: true } : {}), ...(terminalEscalation ? { overridden: !honoured } : {}), headline: `The call ends: ${OUTCOME_LABEL[to.surveyOutcome]}`, why: terminalEscalation && !ran.mandatory ? `“${OUTCOME_LABEL[out]}” is an escalation, and an escalation always ends the call — however the module reached it. Survey-level routing cannot continue or re-route it${honoured ? '' : ` — the route this draft has for “${OUTCOME_LABEL[out]}” is not followed, and validation reports it`}.` : ran.mandatory ? `A mandatory escalation always ends the call with “${OUTCOME_LABEL[out]}”. Survey-level routing cannot override it${honoured ? '' : ` — the route this draft has for “${OUTCOME_LABEL[out]}” is not followed, and validation reports it`}.` : `${what} is routed to end the call.` });
      else {
        const tgt = seq.findIndex((x) => x.id === to.instance);
        const skipped = tgt > pos ? seq.slice(pos + 1, tgt).map(nameOf) : [];
        const tname = tgt >= 0 ? nameOf(seq[tgt]!) : 'a removed module';
        push({ kind: 'SURVEY_ROUTE', ...base, outcome: out, skipped, headline: `Jumps to ${tname} as the next candidate`, why: `${what} is routed to ${tname}.${skipped.length ? ` ${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} passed over.` : ''} The jump only selects ${tname}; whether it runs is decided by its own eligibility.` });
      }
      ended = !go(inst, to, what, ran.mandatory);
    }
    if (!ended) endCall('COMPLETED', seq[seq.length - 1] ?? ({ id: '', module: { code: '', revision: 0 } } as Instance), false);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    if (e.status !== 'PENDING') {
      const inst = seq.find((x) => e.where.startsWith(x.id));
      const base = { instance: inst?.id ?? '', module: inst ? nameOf(inst) : '' };
      if (e.status === 'REVIEW_REQUIRED') {
        terminal = { state: 'REVIEW_REQUIRED', surveyOutcome: 'REVIEW_REQUIRED', reason: e.reason, at: e.where };
        push({ kind: 'END', ...base, status: 'REVIEW_REQUIRED', surveyOutcome: 'REVIEW_REQUIRED', reason: e.reason, where: e.where, headline: 'Halted — review required', why: `${e.human} Automated progression stops here. The run is pending an authorised review; it is not completed.` });
      } else if (e.status === 'MISSING_INFORMATION') {
        terminal = { state: 'MISSING_INFORMATION_HALT', reason: e.reason, at: e.where };
        push({ kind: 'END', ...base, status: 'MISSING_INFORMATION_HALT', reason: e.reason, where: e.where, headline: 'Halted — information is missing', why: `${e.human} The module never started, so it has no outcome. Automated progression stops here and the run is pending an authorised review; it is not completed.` });
      } else {
        terminal = { state: 'DRAFT_INVALID', reason: e.reason, at: e.where };
        push({ kind: 'END', ...base, status: 'DRAFT_INVALID', reason: e.reason, where: e.where, headline: 'This draft cannot run past here', why: `${e.human} The draft is incomplete or invalid at this point. Nothing was decided and nothing is guessed: fix it in the builder and run again.` });
      }
    }
  }
  const modules: ModuleLine[] = seq.map((x) => status.get(x.id) ?? { instance: x.id, name: nameOf(x), status: 'NOT_REACHED' as ModuleStatus, why: pending ? 'Not reached yet.' : 'The call ended before this module.' });

  // every question of every module that ran, and how it stands: answered, answered-empty, unanswered, or skipped on this path
  const answerLines: AnswerLine[] = [];
  for (const inst of seq) {
    const st = status.get(inst.id);
    if (!st || (st.status !== 'ACTIVATED' && st.status !== 'RUNNING')) continue;
    const m = findModule(ws, mKey(inst.module))!;
    const numbers = buildFlow(ws, m).numbers;
    for (const n of m.nodes) {
      if (!isQuestion(n)) continue;
      const q = findQuestion(ws, n.q)!;
      const key = `${inst.id}/${n.id}`;
      const a = answers.get(key);
      const running = st.status === 'RUNNING';
      answerLines.push({ key, instance: inst.id, number: numbers.get(n.id) ?? n.id, text: q.wording.text.trim() || 'Untitled question', state: a ? answerState(q, a) : running ? 'NOT_REACHED' : 'SKIPPED', given: a ? answerText(q, a) : running ? 'not reached yet' : 'not asked on this path' });
    }
  }
  const end = (events[events.length - 1]?.kind === 'END' ? events[events.length - 1] : null) as SimResult['end'];
  return { events, modules, pending, end, asked, edges, evidence, trace, terminal, answerLines };
}

/** A run driven by an ordered list of inputs (what the Simulator screen keeps): each ask consumes the next one. */
export function simulateInputs(ws: Workspace, survey: Survey, profile: Profile, inputs: SimAnswer[]): SimResult {
  let i = 0;
  return simulate(ws, survey, profile, () => (i < inputs.length ? inputs[i++] : undefined));
}

/** The signature of an event for comparing two journeys: what happened, not when. */
export const eventSignature = (e: SimEvent): string =>
  (e.kind === 'ENTRY' ? `ENTRY|${e.instance}|${e.status}` : e.kind === 'ASK' ? `ASK|${e.key}` : e.kind === 'ANSWER' ? `ANSWER|${e.key}|${JSON.stringify(e.answer)}`
    : e.kind === 'REJECT' ? `REJECT|${e.key}|${e.code}` : e.kind === 'ROUTE' ? `ROUTE|${e.key}|${e.via}|${JSON.stringify(e.to)}` : e.kind === 'DECISION' ? `DECISION|${e.key}|${e.result}`
      : e.kind === 'QUEUE' ? `QUEUE|${e.key}|${e.queued.map((x) => x.node).join(',')}|${e.interrupt?.option ?? ''}` : e.kind === 'MODULE_END' ? `MODULE_END|${e.instance}|${e.outcome}`
        : e.kind === 'SURVEY_ROUTE' ? `SURVEY_ROUTE|${e.instance}|${e.headline}` : e.kind === 'DISPOSITION' ? `DISPOSITION|${e.instance}|${e.headline}` : `END|${e.status}|${e.surveyOutcome ?? e.reason}`);
/** The first position at which two journeys differ, or -1 when they are the same. */
export function firstDivergence(a: SimEvent[], b: SimEvent[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (eventSignature(a[i]!) !== eventSignature(b[i]!)) return i;
  return a.length === b.length ? -1 : n;
}
