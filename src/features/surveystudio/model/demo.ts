// Survey Studio prototype — synthetic customers and a demonstration survey for the Journey Simulator (SS-02B.3).
// Everything here is invented for demonstration: no real customer, policy or call. Each profile is a set of pinned
// facts plus the answers that customer gives, so a whole journey can be played back and two customers compared.
import type { Profile } from './engine';
import { createSurvey, eligibilityOf, findModule, findQuestion, removeInstance, setEligibility, setEntry, setIfIneligible, setRoute } from './ops';
import { simulate, type SimAnswer, type SimResult } from './sim';
import { isQuestion, mKey, type Entry, type OutcomeCode, type Question, type Survey, type Workspace } from './types';

export interface SimProfile {
  id: string;
  name: string;
  /** One line a business reader recognises. */
  summary: string;
  facts: Profile;
  /** What this customer answers, by question code. Anything not listed gets the ordinary answer (see `ordinaryAnswer`). */
  answers: Record<string, SimAnswer>;
}

const BASE: Profile = { 'policy.product_family': 'PROTECTION', 'policy.annual_premium': 3000, 'policy.sum_assured': 150000, 'policy.is_replacement': false, 'customer.age_years': 40, 'sale.channel': 'AGENCY' };
const NONE = { 'Q-CLARIFY-AREAS': { choices: ['NONE'] } };
const UNEASY = { 'Q-PREMIUM-COMFORTABLE': { choice: 'NO' } };

export const PROFILES: SimProfile[] = [
  { id: 'NORMAL', name: 'Normal policyholder', summary: 'Protection plan, modest premium, nothing unusual.', facts: BASE, answers: NONE },
  { id: 'ILP', name: 'ILP policyholder', summary: 'Bought an investment-linked plan.', facts: { ...BASE, 'policy.product_family': 'ILP', 'policy.annual_premium': 6000, 'policy.sum_assured': 200000 }, answers: NONE },
  { id: 'HIGH_PREMIUM', name: 'High-premium customer', summary: 'Annual premium of 25,000 SGD.', facts: { ...BASE, 'policy.annual_premium': 25000, 'policy.sum_assured': 200000 }, answers: NONE },
  {
    id: 'HIGH_SUM', name: 'High-sum-assured customer', summary: 'Sum assured of 900,000 SGD with a 15,000 SGD premium; wants several things explained again.',
    facts: { ...BASE, 'policy.annual_premium': 15000, 'policy.sum_assured': 900000 }, answers: { 'Q-CLARIFY-AREAS': { choices: ['CLAIMS', 'BENEFITS', 'PREMIUM'] } },
  },
  {
    id: 'MISSING', name: 'Missing-data customer', summary: 'The premium and the replacement flag are missing from the record.',
    facts: { ...BASE, 'policy.annual_premium': null, 'policy.sum_assured': 600000, 'policy.is_replacement': null }, answers: NONE,
  },
  { id: 'REPLACEMENT', name: 'Policy-replacement customer', summary: 'This sale replaced an existing policy.', facts: { ...BASE, 'policy.is_replacement': true }, answers: NONE },
  {
    id: 'ESCALATION', name: 'Mandatory-escalation customer', summary: 'Says “I did not agree to this policy”.',
    facts: BASE, answers: { 'Q-CLARIFY-AREAS': { choices: ['PREMIUM', 'CRITICAL_RISK'] } },
  },
  { id: 'NO_PRODUCT', name: 'Unknown-product customer', summary: 'The product family is missing from the record.', facts: { ...BASE, 'policy.product_family': null }, answers: NONE },
  // three customers who are NOT comfortable with the premium: that outcome JUMPS to the specialist call, which is only for older customers
  { id: 'UNEASY_OLDER', name: 'Uneasy older customer', summary: 'Aged 67 and not comfortable with the premium.', facts: { ...BASE, 'customer.age_years': 67 }, answers: { ...NONE, ...UNEASY } },
  { id: 'UNEASY_YOUNGER', name: 'Uneasy younger customer', summary: 'Aged 40 and not comfortable with the premium.', facts: BASE, answers: { ...NONE, ...UNEASY } },
  { id: 'UNEASY_NO_AGE', name: 'Uneasy customer, age unknown', summary: 'Not comfortable with the premium; the age is missing from the record.', facts: { ...BASE, 'customer.age_years': null }, answers: { ...NONE, ...UNEASY } },
];

/** The answer an unremarkable customer gives: yes; the normal choice; the answer that selects nothing further; a short remark. */
export function ordinaryAnswer(q: Question, normal?: string): SimAnswer {
  if (q.answerType === 'YES_NO') return { choice: 'YES' };
  if (q.answerType === 'FREE_TEXT') return (q.textRule?.required ?? true) ? { text: 'Nothing further, thank you.' } : { text: '' };
  const plain = q.options.filter((o) => !o.isOther && o.interrupt !== 'MANDATORY');
  if (q.answerType === 'SINGLE_SELECT') return { choice: (plain.find((o) => o.code === normal) ?? plain[0] ?? q.options[0])?.code };
  const alone = plain.find((o) => o.exclusive) ?? plain[0];
  return { choices: alone ? [alone.code] : [] };
}

/** What this profile answers to one question instance. */
export function scriptedAnswer(ws: Workspace, survey: Survey, p: SimProfile, key: string): SimAnswer {
  const [instanceId, nodeId] = key.split('/') as [string, string];
  const inst = survey.sequence.find((x) => x.id === instanceId);
  const m = inst ? findModule(ws, mKey(inst.module)) : undefined;
  const n = m?.nodes.find((x) => x.id === nodeId);
  if (!n || !isQuestion(n)) return {};
  const q = findQuestion(ws, n.q)!;
  return p.answers[q.code] ?? ordinaryAnswer(q, n.routing.normal);
}

/** The whole journey of one profile, every question answered as that customer would. */
export function playback(ws: Workspace, survey: Survey, p: SimProfile): SimResult {
  return simulate(ws, survey, p.facts, (key, attempt) => (attempt === 0 ? scriptedAnswer(ws, survey, p, key) : undefined));
}

/**
 * Adds a ready-made survey so the simulator can be tried at once: seven library modules, three with entry conditions,
 * every named outcome routed. One undoable step; built with the same operations as the Composer.
 */
export function addDemoSurvey(ws0: Workspace): [Workspace, string] {
  const [w0, id] = createSurvey(ws0, { name: 'New business callback (demonstration)', purpose: 'A ready-made survey for the Journey Simulator', modules: ['M-GENERAL', 'M-SUITABILITY', 'M-HIGH-VALUE', 'M-REPLACEMENT', 'M-AFFORDABILITY', 'M-CLARIFICATIONS', 'M-ESCALATION', 'M-CLOSING'] });
  let ws = w0;
  const seq = () => ws.surveys.find((x) => x.id === id)!.sequence;
  const of = (code: string) => seq().find((x) => x.module.code === code)!;
  // a missing replacement flag skips that module with the reason recorded; the other two entry rules stop for review
  const repl = of('M-REPLACEMENT');
  if (repl.entry.mode === 'RULE') ws = setEntry(ws, id, repl.id, { mode: 'RULE', binding: { ...repl.entry.binding, unknownPolicy: 'SKIP_WITH_REASON' } } as Entry);
  // the specialist call is ELIGIBLE only for older customers; when information is missing it stops for review
  const spec = of('M-ESCALATION');
  ws = setEntry(ws, id, spec.id, { mode: 'RULE', binding: { condition: { code: 'C-OLDER-CUSTOMER', version: 1 }, params: { minimum_age: 60 }, unknownPolicy: 'BLOCK' } });
  // every exceptional outcome ends the call with that outcome — except two JUMPS: Suitability's goes straight to
  // Clarifications (which has no condition), and an uneasy customer in Affordability goes to the specialist call
  for (const inst of seq()) {
    for (const o of Object.keys(inst.routes) as OutcomeCode[]) {
      if (o === 'COMPLETED' || o === 'REVIEW_REQUIRED') continue;
      const jump = inst.module.code === 'M-SUITABILITY' ? of('M-CLARIFICATIONS').id : inst.module.code === 'M-AFFORDABILITY' && o === 'CLARIFICATION_REQUIRED' ? spec.id : null;
      ws = setRoute(ws, id, inst.id, o, jump ? { instance: jump } : { surveyOutcome: o });
    }
  }
  // a jump does not bypass eligibility: if the specialist call does not apply, the call ends as "Clarification required"
  ws = setIfIneligible(ws, id, spec.id, { surveyOutcome: 'CLARIFICATION_REQUIRED' });
  return [ws, id];
}

/**
 * The demonstration survey as it stood in an EARLIER revision, so that a comparison can be shown at once (SS-02C).
 * Built from the current demonstration survey with the Composer's own operations: no specialist call (an uneasy customer
 * simply ended as "Clarification required"), a higher premium threshold for the high-value review, a missing replacement
 * flag stopped the call, and Suitability's exceptional outcomes ended the call instead of jumping to Clarifications.
 */
export function demoBaseline(ws0: Workspace, id: string): Workspace {
  let ws = ws0;
  const of = (code: string) => ws.surveys.find((x) => x.id === id)!.sequence.find((x) => x.module.code === code)!;
  ws = removeInstance(ws, id, of('M-ESCALATION').id);
  ws = setRoute(ws, id, of('M-AFFORDABILITY').id, 'CLARIFICATION_REQUIRED', { surveyOutcome: 'CLARIFICATION_REQUIRED' });
  const hv = eligibilityOf(of('M-HIGH-VALUE'));
  if (hv) ws = setEligibility(ws, id, of('M-HIGH-VALUE').id, { ...hv, params: { ...hv.params, premium_threshold: 30000 } });
  const rp = eligibilityOf(of('M-REPLACEMENT'));
  if (rp) ws = setEligibility(ws, id, of('M-REPLACEMENT').id, { ...rp, unknownPolicy: 'BLOCK' });
  for (const o of Object.keys(of('M-SUITABILITY').routes) as OutcomeCode[]) if (o !== 'COMPLETED' && o !== 'REVIEW_REQUIRED') ws = setRoute(ws, id, of('M-SUITABILITY').id, o, { surveyOutcome: o });
  return ws;
}
