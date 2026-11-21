// Survey Studio prototype — guided layout and validation, both computed from the canonical graph.
// The guided view is a READING of the graph (normal path first, exceptions as lanes); it stores nothing of its own,
// so it can never disagree with the model. Validation mirrors the SS-01 rule list (Part B §10.1) for what SS-02A edits.
import { codesUsed, ruleWinner, validSelections } from './engine';
import { activationOf, canBeIneligible, defaultOn, edgeOf, findCondition, findModule, findQuestion, inboundCount, jumpSources, permittedInterrupts, questionNodes, routesFrom } from './ops';
import { ESCALATION_OUTCOMES, OUTCOME_LABEL } from './sample';
import { isQuestion, mKey, type OutcomeCode, type DecisionNode, type Issue, type Module, type ModuleNode, type Question, type QuestionNode, type Survey, type Target, type Workspace } from './types';

export interface FlowRow {
  /** An answer code, ANY / AFTER_CAPTURE, a decision result (MATCH | NO_MATCH | UNKNOWN), `RULE:<id>` or FALLBACK. */
  on: string;
  label: string;
  target: Target | null;
  /** Steps reached only through this route, shown as a folded lane under it. */
  lane: FlowEntry[];
}
interface FlowBase { number: string; rows: FlowRow[]; followups: FlowItem[]; inboundCount: number }
export interface FlowItem extends FlowBase { kind: 'QUESTION'; node: QuestionNode; question: Question }
export interface FlowDecision extends FlowBase { kind: 'DECISION'; node: DecisionNode }
export type FlowEntry = FlowItem | FlowDecision;
export interface Flow { main: FlowEntry[]; orphans: FlowEntry[]; numbers: Map<string, string> }

/**
 * Where a step normally leads: a question's default route, its normal answer's route, its follow-up rejoin or its
 * rules' "otherwise"; for a decision, the OTHERWISE route (the path taken when the condition does not apply).
 */
export function normalNext(m: Module, node: ModuleNode, q?: Question): Target | null {
  if (!isQuestion(node)) return edgeOf(m, node.id, 'NO_MATCH')?.to ?? null;
  const r = node.routing;
  if (r.mode === 'SEQUENTIAL_FOLLOWUPS') return r.rejoin ?? null;
  if (r.mode === 'ORDERED_RULES') return r.fallback ?? null;
  if (r.mode === 'PER_CHOICE') return (r.normal ? edgeOf(m, node.id, r.normal)?.to : undefined) ?? null;
  return edgeOf(m, node.id, defaultOn(q?.answerType ?? 'YES_NO'))?.to ?? null;
}

const RULE_KIND = { ANY: 'any of', ALL: 'all of', NONE: 'none of' } as const;
/** "includes any of Premium, Benefits" — the plain-language criteria of one prioritised rule. */
export function ruleText(q: Question, rule: { kind: 'ANY' | 'ALL' | 'NONE'; options: string[] }): string {
  const names = rule.options.map((c) => q.options.find((o) => o.code === c)?.label ?? c);
  return names.length ? `includes ${RULE_KIND[rule.kind]} ${names.join(', ')}` : 'no answers chosen yet';
}

export function buildFlow(ws: Workspace, m: Module): Flow {
  const placed = new Set<string>();
  const numbers = new Map<string, string>();
  const byId = new Map(m.nodes.map((nd) => [nd.id, nd]));
  const qOf = (nd: QuestionNode) => findQuestion(ws, nd.q)!;
  const next = (nd: ModuleNode) => normalNext(m, nd, isQuestion(nd) ? qOf(nd) : undefined);
  let decisions = 0;

  const chain = (start: string | null): ModuleNode[] => {
    const out: ModuleNode[] = [];
    let cur = start;
    while (cur && byId.has(cur) && !placed.has(cur)) {
      const nd = byId.get(cur)!;
      if (isQuestion(nd) && nd.role === 'FOLLOWUP') break;
      placed.add(cur);
      out.push(nd);
      const t = next(nd);
      cur = t && 'node' in t ? t.node : null;
    }
    return out;
  };

  /**
   * Questions are numbered along their path: Q1, Q2 … on the main path, Q2a, Q2b … on the branches that leave Q2.
   * Decisions are C1, C2 … in reading order. A decision asks nothing, so the questions on its branches are numbered
   * after the question it follows (a decision after Q1 leads to Q1a), sharing that question's letters.
   */
  const letters = new Map<string, number>();
  const anchor = new Map<string, string>();
  let mainCount = 0;
  const number = (nodes: ModuleNode[], prefix: string | null, owner: string | null): void => {
    let last = owner;
    for (const nd of nodes) {
      if (!isQuestion(nd)) { decisions += 1; numbers.set(nd.id, `C${decisions}`); anchor.set(nd.id, last ?? `C${decisions}`); continue; }
      let num: string;
      if (prefix === null) { mainCount += 1; num = `Q${mainCount}`; }
      else { const k = letters.get(prefix) ?? 0; letters.set(prefix, k + 1); num = `${prefix}${String.fromCharCode(97 + (k % 26))}`; }
      numbers.set(nd.id, num);
      last = num;
    }
  };

  const entry = (nd: ModuleNode): FlowEntry => {
    const my = numbers.get(nd.id)!;
    let rowDefs: Array<{ on: string; label: string; target: Target | null }>;
    if (!isQuestion(nd)) {
      rowDefs = [['MATCH', 'Matches'], ['NO_MATCH', 'Otherwise'], ['UNKNOWN', 'Unknown']].map(([on, label]) => ({ on: on!, label: label!, target: edgeOf(m, nd.id, on!)?.to ?? null }));
    } else {
      const q = qOf(nd);
      const r = nd.routing;
      rowDefs = r.mode === 'ALL_TO_NEXT' ? [{ on: defaultOn(q.answerType), label: q.answerType === 'FREE_TEXT' ? 'After the answer' : 'Everybody', target: edgeOf(m, nd.id, defaultOn(q.answerType))?.to ?? null }]
        : r.mode === 'PER_CHOICE' ? q.options.map((o) => ({ on: o.code, label: o.label, target: edgeOf(m, nd.id, o.code)?.to ?? null }))
          : r.mode === 'ORDERED_RULES' ? [...(r.rules ?? []).map((rule, i) => ({ on: `RULE:${rule.id}`, label: `Rule ${i + 1}`, target: rule.to })), { on: 'FALLBACK', label: 'Otherwise', target: r.fallback ?? null }]
            : [];
    }
    const pending = rowDefs.map((d) => ({ ...d, laneNodes: d.target && 'node' in d.target ? chain(d.target.node) : [] }));
    // number every lane of this step before descending, so siblings read a, b, c… in order
    const prefix = isQuestion(nd) ? my : anchor.get(nd.id)!;
    for (const p of pending) number(p.laneNodes, prefix, prefix);
    const base = {
      number: my,
      inboundCount: inboundCount(m, nd.id),
    };
    if (!isQuestion(nd)) return { kind: 'DECISION', node: nd, ...base, followups: [], rows: pending.map((p) => ({ on: p.on, label: p.label, target: p.target, lane: p.laneNodes.map(entry) })) };
    const r = nd.routing;
    const fuIds = [...new Set([...(r.followups ?? []).flatMap((f) => f.nodes), ...(r.interrupts ?? []).flatMap((i) => i.nodes ?? [])])];
    const fuNodes = fuIds.map((id) => byId.get(id)).filter((x): x is QuestionNode => !!x && isQuestion(x));
    fuNodes.forEach((fn, i) => { placed.add(fn.id); numbers.set(fn.id, `${my}.${i + 1}`); });
    return {
      kind: 'QUESTION', node: nd, question: qOf(nd), ...base,
      rows: pending.map((p) => ({ on: p.on, label: p.label, target: p.target, lane: p.laneNodes.map(entry) })),
      followups: fuNodes.map((fn) => entry(fn) as FlowItem),
    };
  };

  const mainNodes = chain(m.entry);
  number(mainNodes, null, null);
  const main = mainNodes.map(entry);
  const rest = m.nodes.filter((nd) => !placed.has(nd.id) && !(isQuestion(nd) && nd.role === 'FOLLOWUP'));
  rest.forEach((nd, i) => { placed.add(nd.id); if (isQuestion(nd)) numbers.set(nd.id, `X${i + 1}`); else { decisions += 1; numbers.set(nd.id, `C${decisions}`); } });
  return { main, orphans: rest.map(entry), numbers };
}

// ---- which earlier answers a decision can rely on (SS-02B.1) ------------------------------------------------------
/** Successors of every node over every kind of route (follow-up questions are reached from, and return to, their parent). */
function successors(m: Module): Map<string, string[]> {
  const out = new Map<string, string[]>(m.nodes.map((nd) => [nd.id, []]));
  for (const nd of m.nodes) {
    for (const r of routesFrom(m, nd)) {
      if ('node' in r.to) out.get(nd.id)!.push(r.to.node);
      // a follow-up question returns to its parent's queue, i.e. to whatever the parent leads to afterwards
      if ('ret' in r.to) for (const parent of questionNodes(m)) {
        if (routesFrom(m, parent).some((x) => 'node' in x.to && x.to.node === nd.id && (x.via.startsWith('FOLLOWUP:') || x.via.startsWith('INTERRUPT:'))) && parent.routing.rejoin && 'node' in parent.routing.rejoin) out.get(nd.id)!.push(parent.routing.rejoin.node);
      }
    }
  }
  return out;
}

export interface Availability {
  /** Asked on EVERY route to this point: its answer is always there when the condition is evaluated. */
  always: string[];
  /** Asked on SOME routes only: reading it is allowed, and gives Unknown when it was not asked. */
  sometimes: string[];
}

/** The questions whose answers exist when execution reaches `nodeId` (dominators = always; other ancestors = sometimes). */
export function availableAnswers(m: Module, nodeId: string): Availability {
  const succ = successors(m);
  const pred = new Map<string, string[]>(m.nodes.map((nd) => [nd.id, []]));
  for (const [from, tos] of succ) for (const t of tos) pred.get(t)?.push(from);
  const all = m.nodes.map((nd) => nd.id);
  const dom = new Map<string, Set<string>>(all.map((id) => [id, new Set(id === m.entry ? [id] : all)]));
  for (let changed = true; changed;) {
    changed = false;
    for (const id of all) {
      if (id === m.entry) continue;
      const ps = pred.get(id) ?? [];
      // dominators of a node = itself + what dominates EVERY predecessor
      let acc: string[] | null = null;
      for (const p of ps) { const d = dom.get(p)!; acc = acc === null ? [...d] : acc.filter((x) => d.has(x)); }
      const nextSet = new Set<string>([...(acc ?? []), id]);
      if (nextSet.size !== dom.get(id)!.size) { dom.set(id, nextSet); changed = true; }
    }
  }
  const ancestors = new Set<string>();
  const walk = (id: string) => { for (const p of pred.get(id) ?? []) if (!ancestors.has(p)) { ancestors.add(p); walk(p); } };
  walk(nodeId);
  const isQ = (id: string) => { const nd = m.nodes.find((x) => x.id === id); return !!nd && isQuestion(nd); };
  const always = [...(dom.get(nodeId) ?? [])].filter((id) => id !== nodeId && isQ(id) && ancestors.has(id));
  return { always, sometimes: [...ancestors].filter((id) => isQ(id) && !always.includes(id)) };
}

/** Wording approval is a separate matter from routing: how many question versions in scope carry unapproved wording. */
export function wordingStatus(ws: Workspace, modules: Module[]): { total: number; unapproved: number } {
  const seen = new Map<string, boolean>();
  for (const m of modules) for (const nd of questionNodes(m)) {
    const q = findQuestion(ws, nd.q);
    if (q) seen.set(`${q.code}@${q.version}`, (q.wording.approval as string) === 'APPROVED_BY_SC');
  }
  return { total: seen.size, unapproved: [...seen.values()].filter((ok) => !ok).length };
}

// ---- validation ---------------------------------------------------------------------------------------------------
function hasCycle(m: Module): boolean {
  const next = successors(m);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const t of next.get(id) ?? []) if (visit(t)) return true;
    state.set(id, 2);
    return false;
  };
  return m.nodes.some((nd) => visit(nd.id));
}

export function validateModule(ws: Workspace, m: Module, ctx: { surveyId?: string; instanceId?: string } = {}): Issue[] {
  const moduleKey = mKey(m);
  const out: Issue[] = [];
  const add = (severity: Issue['severity'], message: string, fix: string, where: Issue['where']) =>
    out.push({ id: `${moduleKey}|${where.nodeId ?? ''}|${where.on ?? ''}|${where.part ?? ''}|${message}`, severity, message, fix, where: { ...ctx, moduleKey, ...where } });
  if (!m.nodes.length) {
    add('ERROR', `${m.name} has no questions yet`, 'Add the first question.', { part: 'empty' });
    return out;
  }
  if (!m.entry) add('ERROR', `${m.name} has no first question`, 'Choose which question starts the module.', { part: 'entry' });
  const flow = buildFlow(ws, m);
  const label = (nd: ModuleNode) => flow.numbers.get(nd.id) ?? nd.id;

  // ---- decision points: a condition, an explicit destination for each of the three results, and inputs that exist
  for (const nd of m.nodes) {
    if (isQuestion(nd)) continue;
    const where = { nodeId: nd.id };
    const b = nd.binding;
    const c = b && b.condition.code ? findCondition(ws, b.condition) : undefined;
    if (!c) add('ERROR', `${label(nd)} has no condition yet`, 'Say what this decision checks.', { ...where, part: 'condition' });
    else {
      if (Object.keys(c.params).some((k) => b!.params[k] === undefined || b!.params[k] === '')) add('ERROR', `${label(nd)}: the condition needs a value`, 'Fill in the missing value for this placement.', { ...where, part: 'condition' });
      const avail = availableAnswers(m, nd.id);
      const used = codesUsed(c.ast);
      for (const [name, decl] of Object.entries(c.inputs ?? {})) {
        const mapped = b!.inputs?.[name]?.node;
        const target = mapped ? m.nodes.find((x) => x.id === mapped) : undefined;
        const declared = findQuestion(ws, decl.question);
        const what = declared?.wording.text.trim() || decl.question.code;
        if (!mapped || !target || !isQuestion(target)) { add('ERROR', `${label(nd)}: choose which earlier answer is "${what}"`, 'Pick the question whose answer the condition reads.', { ...where, part: 'condition' }); continue; }
        if (!avail.always.includes(mapped) && !avail.sometimes.includes(mapped)) {
          add('ERROR', `${label(nd)} reads the answer to ${label(target)}, which is not asked before it`, 'A condition can only read an answer collected earlier on the route. Move the decision or pick another answer.', { ...where, part: 'condition' });
          continue;
        }
        // the reference is typed: same question identity, same answer type, and every option code it compares must exist
        const actual = findQuestion(ws, target.q);
        if (target.q.code !== decl.question.code) add('ERROR', `${label(nd)} is bound to ${label(target)}, a different question from the one its condition reads`, 'Bind it to a placement of the declared question, or change the condition.', { ...where, part: 'condition' });
        else if (actual && actual.answerType !== decl.answerType) add('ERROR', `${label(nd)}: the answer type of ${label(target)} no longer fits the condition`, 'Change the condition, or bind it to a question of the declared type.', { ...where, part: 'condition' });
        else if (actual) {
          const gone = (used[name] ?? []).filter((code) => !actual.options.some((o) => o.code === code));
          if (gone.length) add('ERROR', `${label(nd)} compares ${label(target)} with an answer that no longer exists (${gone.join(', ')})`, 'Change the condition to use the answers this version of the question has.', { ...where, part: 'condition' });
        }
      }
    }
    if (!edgeOf(m, nd.id, 'MATCH')) add('ERROR', `${label(nd)}: choose where it leads when it matches`, 'Pick the destination for "Matches".', { ...where, on: 'MATCH' });
    if (!edgeOf(m, nd.id, 'NO_MATCH')) add('ERROR', `${label(nd)}: choose where it leads otherwise`, 'Pick the destination for "Otherwise".', { ...where, on: 'NO_MATCH' });
    if (!b?.unknownPolicy || !edgeOf(m, nd.id, 'UNKNOWN')) {
      add('ERROR', `${label(nd)}: choose what happens when information is missing`, 'Missing information is never treated as "does not match". Pick a destination, or stop for review.', { ...where, on: 'UNKNOWN' });
    }
  }

  for (const nd of questionNodes(m)) {
    const q = findQuestion(ws, nd.q);
    if (!q) continue;
    const where = { nodeId: nd.id };
    if (!q.wording.text.trim()) add('ERROR', `${label(nd)} has no question text`, 'Type what the customer is asked.', { ...where, part: 'text' });
    if (q.answerType === 'SINGLE_SELECT' || q.answerType === 'MULTI_SELECT') {
      if (q.options.length < 2) add('ERROR', `${label(nd)} needs at least two answer options`, 'Add options.', { ...where, part: 'options' });
      if (q.options.some((o) => !o.label.trim())) add('ERROR', `${label(nd)} has an option without a label`, 'Name every option.', { ...where, part: 'options' });
    }
    const r = nd.routing;
    if (r.mode === 'ALL_TO_NEXT' && !edgeOf(m, nd.id, defaultOn(q.answerType))) {
      add('ERROR', `${label(nd)} does not lead anywhere`, 'Choose where everybody goes next.', { ...where, on: defaultOn(q.answerType) });
    }
    if (r.mode === 'PER_CHOICE') {
      for (const o of q.options) if (!edgeOf(m, nd.id, o.code)) {
        add('ERROR', `${label(nd)}: "${o.label || o.code}" has no destination`, 'Choose where this answer leads.', { ...where, on: o.code });
      }
    }
    if (q.answerType === 'MULTI_SELECT' && q.selection) {
      const combinable = q.options.filter((o) => !o.exclusive).length;
      const { min, max } = q.selection;
      if (min < 0 || max < 1 || min > max) add('ERROR', `${label(nd)}: the selection limits do not make sense`, 'The minimum cannot be above the maximum.', { ...where, part: 'selection' });
      else if (min > 1 && min > combinable) add('ERROR', `${label(nd)}: at least ${min} answers, but only ${combinable} can be combined`, 'The limits were kept as you set them. Choose new limits, or add answers that can be combined.', { ...where, part: 'selection' });
      else if (max > Math.max(combinable, 1)) add('ERROR', `${label(nd)}: at most ${max} answers, but only ${combinable} can be combined`, 'The limits were kept as you set them. Choose a new maximum, or add answers that can be combined.', { ...where, part: 'selection' });
    }
    if (r.mode === 'ORDERED_RULES') {
      (r.rules ?? []).forEach((rule, i) => {
        if (!rule.options.length) add('ERROR', `${label(nd)}: rule ${i + 1} has no answers to look for`, 'Choose the answers this rule looks for.', { ...where, on: `RULE:${rule.id}` });
        else if (!rule.to) add('ERROR', `${label(nd)}: rule ${i + 1} has no destination`, 'Choose where this rule leads.', { ...where, on: `RULE:${rule.id}` });
      });
      if (!r.fallback) add('ERROR', `${label(nd)}: choose where it leads when no rule matches`, 'Every answer must lead somewhere: set "Otherwise".', { ...where, on: 'FALLBACK' });
    }
    // A mandatory escalation holds in every routing mode: no placement may weaken it.
    for (const o of q.options.filter((x) => x.interrupt === 'MANDATORY')) {
      const name = o.label || o.code;
      if (r.mode === 'ALL_TO_NEXT') {
        add('ERROR', `${label(nd)}: "${name}" must escalate, but everybody continues`, q.answerType === 'MULTI_SELECT' ? 'Use "Follow-ups for each answer" so this answer can stop and escalate.' : 'Use "Different next questions" and end the module with an escalation for this answer.', { ...where, on: o.code, part: 'mandatory' });
      } else if (r.mode === 'PER_CHOICE') {
        const t = edgeOf(m, nd.id, o.code)?.to;
        if (t && !('outcome' in t && ESCALATION_OUTCOMES.includes(t.outcome))) add('ERROR', `${label(nd)}: "${name}" must escalate`, 'Its destination must be an approved escalation outcome.', { ...where, on: o.code, part: 'mandatory' });
      } else if (r.mode === 'ORDERED_RULES') {
        // whatever else is selected with it, the rule that wins must end the module with an escalation
        const weak = validSelections(q).filter((sel) => sel.includes(o.code)).some((sel) => {
          const t = ruleWinner(nd, sel).to;
          return !(t && 'outcome' in t && ESCALATION_OUTCOMES.includes(t.outcome));
        });
        if (weak) add('ERROR', `${label(nd)}: "${name}" must escalate`, 'Put a rule for this answer first, ending the module with an approved escalation outcome.', { ...where, on: o.code, part: 'mandatory' });
      } else if (!r.interrupts?.some((i) => i.option === o.code && i.policy === 'STOP_ESCALATE')) {
        add('ERROR', `${label(nd)}: "${name}" must stop and escalate`, 'It is a mandatory escalation. Choose its outcome.', { ...where, on: o.code });
      }
    }
    if (r.mode === 'SEQUENTIAL_FOLLOWUPS') {
      for (const o of q.options) {
        const declared = r.followups?.some((f) => f.option === o.code) || r.noFollowup?.includes(o.code) || r.interrupts?.some((i) => i.option === o.code);
        if (!declared && o.interrupt !== 'MANDATORY') add('ERROR', `${label(nd)}: choose what "${o.label || o.code}" does`, 'Pick a follow-up, no follow-up, or stop.', { ...where, on: o.code });
      }
      for (const i of r.interrupts ?? []) {
        const o = q.options.find((x) => x.code === i.option);
        const name = o?.label || i.option;
        if (!permittedInterrupts(o?.interrupt).includes(i.policy)) {
          add('ERROR', `${label(nd)}: "${name}" is not allowed to do this`, o?.interrupt === 'MANDATORY' ? 'It is a mandatory escalation: it must stop and escalate.' : 'This answer may not interrupt the follow-ups.', { ...where, on: i.option });
        } else if (i.policy === 'STOP_ESCALATE' && o?.interrupt === 'MANDATORY' && i.outcome && !ESCALATION_OUTCOMES.includes(i.outcome)) {
          add('ERROR', `${label(nd)}: "${name}" must escalate`, 'Its outcome must be an approved escalation outcome.', { ...where, on: i.option, part: 'mandatory' });
        } else if (i.policy === 'STOP_ESCALATE' && (!i.outcome || i.outcome === 'COMPLETED')) {
          add('ERROR', `${label(nd)}: choose the outcome when "${name}" stops the follow-ups`, 'Pick the escalation or outcome.', { ...where, on: i.option });
        } else if (i.policy === 'RESUME' && !(i.nodes ?? []).length) {
          add('ERROR', `${label(nd)}: "${name}" has nothing to ask before the follow-ups continue`, 'Add the question to ask first.', { ...where, on: i.option });
        } else if (i.policy === 'STOP_REJOIN' && !i.rejoin) {
          add('ERROR', `${label(nd)}: choose where "${name}" leads after stopping the follow-ups`, 'Pick the destination.', { ...where, on: i.option });
        }
      }
      if (!r.rejoin) add('ERROR', `${label(nd)} has no question after its follow-ups`, 'Choose where the customer continues after the follow-ups.', { ...where, part: 'rejoin' });
    }
  }
  for (const it of flow.orphans) add('ERROR', `Nothing leads to ${it.kind === 'QUESTION' ? `"${it.question.wording.text.trim() || 'Untitled question'}"` : `the decision ${it.number}`}`, 'Route something to it, or delete it.', { nodeId: it.node.id, part: 'orphan' });
  if (hasCycle(m)) add('ERROR', `${m.name} contains a loop`, 'A question leads back to an earlier one. Change that route.', { part: 'cycle' });
  return out;
}

/**
 * The outcomes a module can end with BECAUSE a mandatory-escalation answer was given. A survey may only route these to
 * end the call with that same governed escalation outcome (owner decision A-4, SS-02C): survey-level routing can never
 * turn a mandatory escalation into a continuation, a normal completion or a review halt.
 */
export function mandatoryOutcomes(ws: Workspace, m: Module): OutcomeCode[] {
  const out = new Set<OutcomeCode>();
  for (const nd of m.nodes) {
    if (!isQuestion(nd)) continue;
    const q = findQuestion(ws, nd.q);
    if (!q) continue;
    for (const o of q.options.filter((x) => x.interrupt === 'MANDATORY')) {
      const r = nd.routing;
      if (r.mode === 'PER_CHOICE') { const t = edgeOf(m, nd.id, o.code)?.to; if (t && 'outcome' in t) out.add(t.outcome); }
      else if (r.mode === 'ORDERED_RULES') {
        for (const sel of validSelections(q).filter((x) => x.includes(o.code))) { const t = ruleWinner(nd, sel).to; if (t && 'outcome' in t) out.add(t.outcome); }
      } else for (const i of r.interrupts ?? []) if (i.option === o.code && i.policy === 'STOP_ESCALATE' && i.outcome) out.add(i.outcome);
    }
  }
  return ESCALATION_OUTCOMES.filter((o) => out.has(o));
}
/**
 * Every outcome of a module that is an ESCALATION (owner correction, SS-02 closure): Escalate is TERMINAL for the survey
 * however the module reached it — by a mandatory answer, an ordinary route, a rule, an interruption or a decision. A
 * survey may only route such an outcome to end the call with that same outcome.
 */
export const escalationOutcomes = (m: Module): OutcomeCode[] => ESCALATION_OUTCOMES.filter((o) => m.outcomes.includes(o));
/** Whether a survey route honours a mandatory escalation: it must end the call with that same escalation outcome. */
export const honoursEscalation = (o: OutcomeCode, t: unknown): boolean => !!t && typeof t === 'object' && 'surveyOutcome' in t && (t as { surveyOutcome: OutcomeCode }).surveyOutcome === o;

export function validateSurvey(ws: Workspace, s: Survey): Issue[] {
  const out: Issue[] = [];
  const add = (message: string, fix: string, where: Issue['where']) =>
    out.push({ id: `${s.id}|${where.instanceId ?? ''}|${where.on ?? ''}|${where.part ?? ''}|${message}`, severity: 'ERROR', message, fix, where: { surveyId: s.id, ...where } });
  if (!s.sequence.length) add('This survey has no modules yet', 'Add the first module.', { part: 'empty' });
  s.sequence.forEach((inst, i) => {
    const m = findModule(ws, mKey(inst.module));
    if (!m) return;
    const where = { instanceId: inst.id };
    for (const o of m.outcomes) {
      const t = inst.routes[o];
      if (t === null || t === undefined) {
        add(`${m.name}: choose what happens on "${OUTCOME_LABEL[o]}"`, 'Continue, jump to a later module, or end the survey.', { ...where, on: o });
      } else if (typeof t === 'object' && 'instance' in t) {
        const at = s.sequence.findIndex((x) => x.id === t.instance);
        if (at < 0) add(`${m.name}: "${OUTCOME_LABEL[o]}" leads to a module that was removed`, 'Choose another destination.', { ...where, on: o });
        else if (at <= i) add(`${m.name}: "${OUTCOME_LABEL[o]}" leads backwards`, 'A route may only go to a later module.', { ...where, on: o });
      }
    }
    if (inst.entry.mode === 'RULE') {
      const b = inst.entry.binding;
      const c = findCondition(ws, b.condition);
      if (!c) add(`${m.name}: its entry condition no longer exists`, 'Choose another condition.', { ...where, part: 'entry' });
      else if (Object.keys(c.params).some((p) => b.params[p] === undefined || b.params[p] === '')) {
        add(`${m.name}: the entry condition needs a value`, 'Fill in the missing threshold.', { ...where, part: 'entry' });
      }
      if (!b.unknownPolicy) add(`${m.name}: choose what happens when information is missing`, 'Missing data is never treated as "no". Pick stop or skip.', { ...where, part: 'entry' });
    }
    const act = activationOf(inst);
    if (act) {
      const at = s.sequence.findIndex((x) => x.id === act.of);
      if (at < 0 || at >= i) add(`${m.name}: it waits for a module that does not run before it`, 'Pick an earlier module, or change when this runs.', { ...where, part: 'entry' });
      else if (!act.outcomes.length) add(`${m.name}: choose which outcome activates it`, 'Pick at least one outcome.', { ...where, part: 'entry' });
    }
    // a mandatory escalation cannot be overridden by survey-level routing (A-4): its outcome may only end the call as itself
    const must = mandatoryOutcomes(ws, m);
    for (const o of escalationOutcomes(m)) {
      const t = inst.routes[o];
      if (t === null || t === undefined || honoursEscalation(o, t)) continue;
      if (must.includes(o)) add(`${m.name}: a mandatory escalation must end the call with "${OUTCOME_LABEL[o]}"`, `Survey routing cannot override a mandatory escalation. Route "${OUTCOME_LABEL[o]}" to end the call: ${OUTCOME_LABEL[o]}.`, { ...where, on: o, part: 'mandatory' });
      // Escalate is terminal even when no mandatory answer is involved: an escalation is never continued, completed or re-routed
      else add(`${m.name}: "${OUTCOME_LABEL[o]}" must end the call with "${OUTCOME_LABEL[o]}"`, `An escalation is terminal for the survey, however the module reached it. Route "${OUTCOME_LABEL[o]}" to end the call: ${OUTCOME_LABEL[o]}.`, { ...where, on: o, part: 'escalation' });
    }
    // a jump names this module as the next CANDIDATE; its eligibility is still checked, so what happens when it does
    // not apply must be chosen explicitly (D-135) — the survey never invents a fallback
    const jumps = jumpSources(s, inst.id);
    if (canBeIneligible(inst)) {
      const q = inst.ifSkippedInSequence;
      if (q === null) add(`${m.name}: choose what happens if it is reached in sequence but does not apply`, 'It pointed at a module that was removed. Continue, go to a later module, or end the call.', { ...where, on: '@SKIP_SEQ' });
      else if (q && typeof q === 'object' && 'instance' in q && s.sequence.findIndex((x) => x.id === q.instance) <= i) add(`${m.name}: "if it does not apply" leads backwards`, 'It may only go to a later module, so a module is never entered twice.', { ...where, on: '@SKIP_SEQ' });
      const d = inst.ifIneligible;
      if (d === null || d === undefined) { if (jumps.length) add(`${m.name}: choose what happens if it is jumped to but does not apply`, 'A jump does not bypass its condition. Continue, go to a later module, or end the call.', { ...where, on: '@SKIP' }); }
      else if (typeof d === 'object' && 'instance' in d) {
        const at = s.sequence.findIndex((x) => x.id === d.instance);
        if (at < 0) add(`${m.name}: "if it does not apply" leads to a module that was removed`, 'Choose another destination.', { ...where, on: '@SKIP' });
        else if (at <= i) add(`${m.name}: "if it does not apply" leads backwards`, 'It may only go to a later module, so a module is never entered twice.', { ...where, on: '@SKIP' });
      }
    }
    out.push(...validateModule(ws, m, { surveyId: s.id, instanceId: inst.id }));
  });
  return out;
}
