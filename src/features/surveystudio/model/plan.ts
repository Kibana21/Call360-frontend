// Survey Studio prototype (UC-01) — the customer-specific CALL PLAN. DEMONSTRATION ONLY.
// Built from the SAME canonical model the editors write and the simulator runs: there is no plan-specific schema.
// A call plan is what can be settled BEFORE a call from one customer's application data:
//   • which modules are in, out, or depend on what happens during the call;
//   • for every item that may be delivered, the exact approved wording with this customer's values put in;
//   • every point that is still OPEN — where an answer, not the plan, will decide the route — with its alternatives.
// It never contains what was actually said: that exists only once a call runs (the simulator's journey).
// It is NOT the Call360 runtime; nothing here assembles or approves a real call.
import { describeAst, evaluate, fieldDef, fieldsOf, type Tri } from './engine';
import { buildFlow } from './flow';
import { activationOf, eligibilityOf, findCondition, findModule, findQuestion, jumpSources, routesFrom } from './ops';
import { FIELDS, OUTCOME_CATALOG, OUTCOME_LABEL } from './sample';
import { isQuestion, mKey, singleRoute, type AnswerType, type DeliveryMode, type Module, type OutcomeCode, type QuestionNode, type Survey, type SurveyTarget, type Target, type Workspace } from './types';
import { liveGates, standing, type SurveyGov } from './governance';
import { deliveryOf, fieldOf, formatValue, renderWording, variablesOf, type Facts, type Rendered } from './wording';

export type InputState = 'PRESENT' | 'MISSING' | 'INVALID';
export interface PlanInput { code: string; label: string; state: InputState; value: string; usedBy: string[] }
/** IN = will run if the call reaches it; OUT = will not run for this customer; CONDITIONAL = selected only by what
 *  happens during the call; HALTS = cannot be decided from this customer's data, and the survey says to stop. */
export type PlanModuleStatus = 'IN' | 'OUT' | 'CONDITIONAL' | 'HALTS';
export interface PlanItem {
  key: string; number: string; statement: boolean; type: AnswerType; role: string | null; mandatory: boolean;
  delivery: DeliveryMode; item: string; wordingVersion: number;
  /** The approved wording as written, variables still in it. */
  source: string;
  /** The exact sentence for this customer, or null when it cannot be built. */
  text: string | null;
  errors: string[]; values: Rendered['values'];
  /** ALWAYS = on every path through the module; SOME = only on some paths (an answer decides). */
  certainty: 'ALWAYS' | 'SOME';
}
/** `on` and `to` are the canonical form of an alternative (an answer code, a rule, an outcome; and where it leads); `when` and `leads` are the same thing in words. */
export interface OpenPoint { key: string; number: string; kind: 'ANSWER' | 'CONDITION' | 'OUTCOME'; title: string; alternatives: Array<{ when: string; leads: string; on: string; to: Target | SurveyTarget | null }> }
/** Why a technical plan cannot be completed for this application: a stable code and where. */
export interface PlanIssue { code: 'WORDING_VALUE_MISSING' | 'ELIGIBILITY_UNKNOWN' | 'MODULE_MISSING'; at: string; message: string }
export interface PlanModule {
  instance: string; name: string; status: PlanModuleStatus; why: string;
  reads: Array<{ label: string; state: InputState; value: string }>;
  items: PlanItem[]; open: OpenPoint[];
}
export interface CallPlan {
  survey: { id: string; name: string; label: string };
  /**
   * QUESTION A ONLY — can a technical plan be computed from the supplied data? READY = every item that may be delivered
   * can be rendered and every module can be decided; BLOCKED = something a call could reach cannot be. This says
   * NOTHING about whether the survey may be used on a real call: that is `liveEligibility`, a separate question.
   */
  status: 'READY' | 'BLOCKED';
  issues: PlanIssue[];
  blockers: string[];
  inputs: PlanInput[];
  modules: PlanModule[];
  counts: { modulesIn: number; modulesOut: number; modulesConditional: number; items: number; always: number; open: number };
  /** A short fingerprint of the plan's content: the same model and the same customer data always give the same value. */
  hash: string;
}

const fnv = (s: string): string => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };

function showFact(code: string, facts: Facts): { state: InputState; value: string } {
  const f = fieldDef(code), v = facts[code];
  if (v === null || v === undefined || v === '') return { state: 'MISSING', value: 'missing' };
  if (f?.type === 'BOOLEAN') return typeof v === 'boolean' ? { state: 'PRESENT', value: v ? 'Yes' : 'No' } : { state: 'INVALID', value: String(v) };
  const out = f ? formatValue(f, v) : null;
  return out === null ? { state: 'INVALID', value: String(v) } : { state: 'PRESENT', value: f?.type === 'INTEGER' && f.unit ? `${out} ${f.unit}` : out };
}

/** True when every path from the module's entry to any ending passes through `nodeId`. */
function onEveryPath(m: Module, nodeId: string): boolean {
  if (!m.entry) return false;
  if (m.entry === nodeId) return true;
  const seen = new Set<string>([nodeId]); // walk the module as if this node were not there
  const stack = [m.entry];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = m.nodes.find((x) => x.id === id);
    if (!n) continue;
    for (const r of routesFrom(m, n)) {
      if ('outcome' in r.to) return false; // an ending is reachable without it
      if ('node' in r.to) stack.push(r.to.node);
    }
  }
  return true;
}

export function buildCallPlan(ws: Workspace, survey: Survey, facts: Facts): CallPlan {
  const used = new Map<string, string[]>();
  const note = (code: string, by: string) => used.set(code, [...new Set([...(used.get(code) ?? []), by])]);
  const issues: PlanIssue[] = [];
  const blockers = { push: (code: PlanIssue['code'], at: string, message: string) => { issues.push({ code, at, message }); } };
  const nameOf = (id: string) => { const i = survey.sequence.find((x) => x.id === id); return (i && findModule(ws, mKey(i.module))?.name) || id; };
  const surveyLeads = (pos: number, t: SurveyTarget | null | undefined): string =>
    (t === null || t === undefined ? 'not decided in the survey' : t === '@CONTINUE' ? (survey.sequence[pos + 1] ? `continues to ${nameOf(survey.sequence[pos + 1]!.id)}` : 'the call is complete')
      : 'surveyOutcome' in t ? `the call ends: ${OUTCOME_LABEL[t.surveyOutcome]}` : `jumps to ${nameOf(t.instance)}`);

  const modules: PlanModule[] = survey.sequence.map((inst, pos) => {
    const m = findModule(ws, mKey(inst.module));
    const name = m?.name ?? inst.id;
    if (!m) { blockers.push('MODULE_MISSING', inst.id, `${name} is no longer in the workspace.`); return { instance: inst.id, name, status: 'HALTS' as const, why: 'The module is missing.', reads: [], items: [], open: [] }; }

    // ---- selection and eligibility: everything here is decided from application data alone ----
    const act = activationOf(inst);
    const elig = eligibilityOf(inst);
    let status: PlanModuleStatus = 'IN';
    let why = 'It has no eligibility condition.';
    const reads: PlanModule['reads'] = [];
    if (elig) {
      const c = findCondition(ws, elig.condition);
      let result: Tri = 'UNKNOWN';
      let rule = 'its condition';
      if (c) {
        const ex = evaluate(c.ast, c, elig, facts);
        result = ex.result; rule = describeAst(c.ast, c, elig);
        for (const code of fieldsOf(c.ast)) { note(code, `Eligibility of ${name}`); reads.push({ label: fieldDef(code)?.label ?? code, ...showFact(code, facts) }); }
      }
      if (result === 'TRUE') why = `It is eligible: ${rule}.`;
      else if (result === 'FALSE') { status = 'OUT'; why = `It is not eligible: it applies only when ${rule}.`; }
      else if (elig.unknownPolicy === 'SKIP_WITH_REASON') { status = 'OUT'; why = `Whether it applies cannot be decided (${rule}) because information is missing. The survey says to skip it and record why.`; }
      else {
        status = 'HALTS';
        why = `Whether it applies cannot be decided (${rule}) because information is missing. The survey says to stop for review.`;
        blockers.push('ELIGIBILITY_UNKNOWN', inst.id, `If the call reaches ${name}, it halts: information needed to decide whether it applies is missing.`);
      }
    }
    if (status === 'IN' && act) {
      status = 'CONDITIONAL';
      why = `${why} It is selected only after ${nameOf(act.of)} ends with ${act.outcomes.map((o) => OUTCOME_LABEL[o]).join(' or ')}.`;
    } else if (status === 'IN' && jumpSources(survey, inst.id).length) {
      why = `${why} It is also the target of a jump.`;
    }
    if (status === 'OUT') return { instance: inst.id, name, status, why, reads, items: [], open: [] };

    // ---- the items that may be delivered, with the exact wording for this customer ----
    const flow = buildFlow(ws, m);
    const num = (id: string) => flow.numbers.get(id) ?? id;
    const leads = (t: Target | null | undefined): string => (!t ? 'not decided' : 'ret' in t ? 'back to the follow-up queue' : 'outcome' in t ? `the module ends: ${OUTCOME_LABEL[t.outcome]}` : num(t.node));
    // reading order = the order in which the flow labelled the steps; labels themselves are display only and are never sorted on
    const order = new Map([...flow.numbers.keys()].map((nid, k) => [nid, k]));
    const ordered = [...m.nodes].filter((n) => order.has(n.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const items: PlanItem[] = [];
    const open: OpenPoint[] = [];
    for (const n of ordered) {
      const key = `${inst.id}/${n.id}`;
      if (!isQuestion(n)) {
        const c = n.binding ? findCondition(ws, n.binding.condition) : undefined;
        open.push({
          key, number: num(n.id), kind: 'CONDITION', title: `A condition: ${c && n.binding ? describeAst(c.ast, c, n.binding) : 'not set'}`,
          alternatives: [['MATCH', 'it matches'], ['NO_MATCH', 'it does not match'], ['UNKNOWN', 'information is missing']].map(([on, when]) => { const to = m.edges.find((e) => e.from === n.id && e.on === on)?.to ?? null; return { when: when!, leads: leads(to), on: on!, to }; }),
        });
        continue;
      }
      const q = findQuestion(ws, n.q);
      if (!q) continue;
      const statement = q.answerType === 'STATEMENT';
      const certainty = n.role !== 'FOLLOWUP' && onEveryPath(m, n.id) ? 'ALWAYS' : 'SOME';
      const rendered = renderWording(q.wording.text.trim(), facts);
      for (const v of variablesOf(q.wording.text)) if (fieldOf(v)) note(v, `Wording of ${num(n.id)} in ${name}`);
      if (rendered.text === null) blockers.push('WORDING_VALUE_MISSING', key, `${num(n.id)} in ${name} cannot be delivered${certainty === 'ALWAYS' ? '' : ' (if the call reaches it)'}: ${rendered.errors.join(' ')}`);
      items.push({
        key, number: num(n.id), statement, type: q.answerType, role: statement ? (q.statement ?? 'TRANSITION') : q.role ?? null, mandatory: !!q.mandatory,
        delivery: deliveryOf(q), item: `${q.code}@${q.version}`, wordingVersion: q.wording.version, source: q.wording.text.trim(), text: rendered.text, errors: rendered.errors, values: rendered.values, certainty,
      });
      const open1 = openPoint(n, q.answerType, q.options.map((o) => [o.code, o.label] as [string, string]), m, leads);
      if (open1) open.push({ key, number: num(n.id), kind: 'ANSWER', title: `The answer to ${num(n.id)}`, alternatives: open1 });
    }
    // ---- where the module's own ending leads in the survey ----
    const outs = m.outcomes.filter((o) => OUTCOME_CATALOG[o]);
    if (outs.length > 1) {
      open.push({
        key: `${inst.id}:outcome`, number: '', kind: 'OUTCOME', title: `How ${name} ends`,
        alternatives: outs.map((o: OutcomeCode) => { const to: SurveyTarget | null = OUTCOME_CATALOG[o].cls === 'ESCALATION' ? { surveyOutcome: o } : inst.routes[o] ?? null; return { when: OUTCOME_LABEL[o], on: o, to, leads: OUTCOME_CATALOG[o].cls === 'REVIEW_HALT' ? 'the call halts for review' : OUTCOME_CATALOG[o].cls === 'ESCALATION' ? `the call ends: ${OUTCOME_LABEL[o]}` : surveyLeads(pos, inst.routes[o]) }; }),
      });
    }
    return { instance: inst.id, name, status, why, reads, items, open };
  });

  const inputs: PlanInput[] = FIELDS.filter((f) => used.has(f.code)).map((f) => ({ code: f.code, label: f.label, ...showFact(f.code, facts), usedBy: used.get(f.code)! }));
  const live = modules.filter((x) => x.status !== 'OUT');
  const all = live.flatMap((x) => x.items);
  const counts = {
    modulesIn: modules.filter((x) => x.status === 'IN').length, modulesOut: modules.filter((x) => x.status === 'OUT').length,
    modulesConditional: modules.filter((x) => x.status === 'CONDITIONAL' || x.status === 'HALTS').length,
    items: all.length, always: all.filter((x) => x.certainty === 'ALWAYS').length, open: live.reduce((n, x) => n + x.open.length, 0),
  };
  const content = { survey: survey.id, inputs, modules, issues };
  return { survey: { id: survey.id, name: survey.name, label: survey.versionLabel }, status: issues.length ? 'BLOCKED' : 'READY', issues, blockers: issues.map((i) => i.message), inputs, modules, counts, hash: fnv(JSON.stringify(content)) };
}

/** The alternatives at a question where the ANSWER decides the route; null when every answer continues to one place. */
function openPoint(n: QuestionNode, type: AnswerType, options: Array<[string, string]>, m: Module, leads: (t: Target | null | undefined) => string): OpenPoint['alternatives'] | null {
  const r = n.routing;
  if (singleRoute(type) || r.mode === 'ALL_TO_NEXT') return null;
  if (r.mode === 'PER_CHOICE') {
    const alts = options.map(([code, label]) => { const to = (m.edges.find((e) => e.from === n.id && e.on === code) ?? m.edges.find((e) => e.from === n.id && e.on === 'ANY'))?.to ?? null; return { when: `“${label}”`, leads: leads(to), on: code, to }; });
    // open only when the answer really chooses: every answer leading to the same place settles nothing
    return new Set(alts.map((a) => JSON.stringify(a.to))).size > 1 ? alts : null;
  }
  if (r.mode === 'ORDERED_RULES') {
    return [...(r.rules ?? []).map((rule, i) => ({ when: `rule ${i + 1} is the first that fits`, leads: leads(rule.to), on: `RULE:${rule.id}`, to: rule.to })), { when: 'no rule fits', leads: leads(r.fallback), on: 'FALLBACK', to: r.fallback ?? null }];
  }
  const label = (code: string) => options.find(([c]) => c === code)?.[1] ?? code;
  return [
    ...(r.followups ?? []).map((f) => ({ when: `“${label(f.option)}” is among the answers`, leads: `adds ${f.nodes.map((id) => leads({ node: id })).join(', ') || 'nothing'} to the follow-up queue`, on: `FOLLOWUP:${f.option}`, to: f.nodes[0] ? { node: f.nodes[0] } : null })),
    ...(r.interrupts ?? []).map((i) => ({ when: `“${label(i.option)}” is among the answers`, leads: i.policy === 'STOP_ESCALATE' ? `stops the follow-ups — ${leads(i.outcome ? { outcome: i.outcome } : null)}` : i.policy === 'STOP_REJOIN' ? `stops the follow-ups and goes to ${leads(i.rejoin)}` : `is handled first (${(i.nodes ?? []).map((id) => leads({ node: id })).join(', ') || 'not set'}), then the queue resumes`, on: `INTERRUPT:${i.option}`, to: i.policy === 'STOP_ESCALATE' ? (i.outcome ? { outcome: i.outcome } : null) : i.policy === 'STOP_REJOIN' ? i.rejoin ?? null : i.nodes?.[0] ? { node: i.nodes[0] } : null })),
    { when: 'the follow-ups are finished', leads: leads(r.rejoin), on: 'REJOIN', to: r.rejoin ?? null },
  ];
}

// ---- QUESTION B: may this survey be used on an operational callback? ----------------------------------------------------
/**
 * MET = established here; NOT_MET = established NOT to hold; NOT_AVAILABLE = cannot be established in this prototype at
 * all (the capability or the decision does not exist yet). Only MET counts towards eligibility.
 */
export type ConditionState = 'MET' | 'NOT_MET' | 'NOT_AVAILABLE';
export interface ReadinessCondition { id: string; group: 'PUBLICATION' | 'WORDING' | 'GATES' | 'ASSIGNMENT' | 'CHANNEL' | 'POLICY' | 'PLAN'; label: string; state: ConditionState; detail: string }
export interface LiveEligibility {
  /** True only when EVERY condition is MET. In this prototype that can never happen — by construction, not by accident. */
  eligible: boolean;
  conditions: ReadinessCondition[];
  met: number; notMet: number; notAvailable: number;
}

/**
 * The explicit readiness conditions for an operational callback (UC-02). Computing a plan (question A) is ONE condition
 * among many and never implies the rest. Structural facts are checked; policies are not invented: whether a customer's
 * "no" to identity or consent ends a call, and what a channel requires, are named as conditions and left NOT_AVAILABLE.
 */
export function liveEligibility(ws: Workspace, survey: Survey, sg: SurveyGov | undefined, plan: CallPlan): LiveEligibility {
  const st = standing(ws, survey, sg);
  const gates = liveGates(ws, survey);
  const items = survey.sequence.flatMap((inst) => { const m = findModule(ws, mKey(inst.module)); return (m?.nodes ?? []).filter(isQuestion).map((n) => findQuestion(ws, n.q)).filter((q): q is NonNullable<typeof q> => !!q); });
  const unapproved = items.filter((q) => (q.wording.approval as string) !== 'APPROVED_BY_SC').length;
  const conversational = items.filter((q) => deliveryOf(q) === 'CONVERSATIONAL').length;
  const recordings = items.filter((q) => deliveryOf(q) === 'EXACT_AUDIO').length;
  const gate = (id: 'IDENTITY_CHECK' | 'CONSENT_TO_PROCEED' | 'RECORDING_CONSENT', label: string): ReadinessCondition => ({
    id: `GATE_${id}`, group: 'GATES', label, state: gates.present.includes(id) ? 'MET' : 'NOT_MET',
    // PRESENCE ONLY. That the question exists says nothing about whether what the call does next is approved: see GATE_BEHAVIOUR.
    detail: gates.present.includes(id) ? 'Present: a mandatory question with this role is in the survey. This does not establish that its enforcement — what the call does on “no”, refusal or silence — is approved.' : 'Not present: no mandatory question with this role is in the survey.',
  });
  const publishedSame = st.stage === 'PUBLISHED' && !st.draftDiffers;
  const conditions: ReadinessCondition[] = [
    { id: 'PLAN_COMPUTABLE', group: 'PLAN', label: 'A plan can be computed for this application', state: plan.status === 'READY' ? 'MET' : 'NOT_MET', detail: plan.status === 'READY' ? 'Every item this customer could hear can be rendered, and every module can be decided.' : `${plan.issues.length} thing${plan.issues.length === 1 ? '' : 's'} a call could reach cannot be delivered or decided.` },
    { id: 'PUBLISHED_VERSION', group: 'PUBLICATION', label: 'The plan is built from a published, approved survey version', state: publishedSame ? 'NOT_AVAILABLE' : 'NOT_MET', detail: publishedSame ? 'This content matches a version published in this prototype — a simulation. No Call360 publication exists, so this cannot be met here.' : `This is a draft (${st.text.charAt(0).toLowerCase()}${st.text.slice(1)}). A draft is never used on a call.` },
    { id: 'WORDING_APPROVED', group: 'WORDING', label: 'Every item uses approved wording', state: unapproved ? 'NOT_MET' : 'MET', detail: unapproved ? `${unapproved} of ${items.length} item${items.length === 1 ? '' : 's'} use synthetic wording that nobody has approved.` : 'All wording is approved.' },
    { id: 'DELIVERY_CONTROLLED', group: 'WORDING', label: 'Every item can be delivered as approved', state: conversational || recordings ? 'NOT_MET' : 'MET', detail: conversational || recordings ? [conversational ? `${conversational} item${conversational === 1 ? '' : 's'} would be spoken in the assistant’s own words, which is blocked` : '', recordings ? `${recordings} item${recordings === 1 ? ' needs' : 's need'} an approved recording, and none is attached` : ''].filter(Boolean).join('; ') + '.' : 'Every item is delivered as its exact approved text.' },
    gate('IDENTITY_CHECK', 'A mandatory identity check is in the survey'),
    gate('CONSENT_TO_PROCEED', 'A mandatory consent to proceed is in the survey'),
    gate('RECORDING_CONSENT', 'A mandatory recording consent is in the survey'),
    { id: 'GATE_BEHAVIOUR', group: 'POLICY', label: 'What each gate does when the customer says no, refuses or does not answer is approved', state: 'NOT_MET', detail: 'Not decided. A gate being present shows only that the question is asked. Whether the call ends, continues or escalates afterwards is a business and compliance ruling that has not been made, and nothing here assumes one.' },
    { id: 'ASSIGNMENT', group: 'ASSIGNMENT', label: 'An approved assignment selects this version for this case', state: 'NOT_AVAILABLE', detail: 'The survey was chosen by hand for this preview. Assignment rules are not part of Survey Studio yet, and no case exists here.' },
    { id: 'CHANNEL', group: 'CHANNEL', label: 'The requirements of the call channel are met', state: 'NOT_AVAILABLE', detail: 'Channel requirements — for example consent before audio is sent to a cloud voice provider — are not defined for Survey Studio yet.' },
    { id: 'NO_ANSWER_POLICY', group: 'POLICY', label: 'What a call does when a customer does not answer is decided', state: 'NOT_MET', detail: 'Silence, refusal, a dropped call and repeats are open business and compliance decisions. Without them a call has no defined behaviour.' },
  ];
  const count = (s: ConditionState) => conditions.filter((c) => c.state === s).length;
  return { eligible: conditions.every((c) => c.state === 'MET'), conditions, met: count('MET'), notMet: count('NOT_MET'), notAvailable: count('NOT_AVAILABLE') };
}
