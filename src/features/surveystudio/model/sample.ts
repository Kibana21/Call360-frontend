// Survey Studio prototype — synthetic sample library, modelled on the SS-01 canonical fixtures (F1–F8).
// Illustrative only: wording, thresholds and outcomes are not approved AIA/MAS language or business policy.
import type {
  Binding, Condition, DecisionNode, Edge, Entry, FieldDef, Module, ModuleKind, ModuleNode, Option, OutcomeCode, Question, QuestionNode, Routing, Target, Workspace,
} from './types';

export const FIELDS: FieldDef[] = [
  { code: 'policy.product_family', label: 'Product family', type: 'ENUM', values: ['PROTECTION', 'ILP', 'ENDOWMENT'] },
  { code: 'policy.annual_premium', label: 'Annual premium', type: 'MONEY', unit: 'SGD' },
  { code: 'policy.sum_assured', label: 'Sum assured', type: 'MONEY', unit: 'SGD' },
  { code: 'policy.is_replacement', label: 'Replaces an existing policy', type: 'BOOLEAN' },
  { code: 'customer.age_years', label: 'Customer age', type: 'INTEGER', unit: 'years' },
  { code: 'sale.channel', label: 'Selling channel', type: 'ENUM', values: ['AGENCY', 'BANCASSURANCE', 'DIRECT'] },
  { code: 'policy.plan_name', label: 'Plan name', type: 'TEXT' },
  { code: 'policy.term_years', label: 'Policy term', type: 'INTEGER', unit: 'years' },
];

/**
 * The controlled outcome catalog (owner decision D-133): stable codes with an explicit classification. PROTOTYPE,
 * synthetic — the business-approved catalog is deferred to production governance approval.
 *   NORMAL_COMPLETION  the module or call finished normally;
 *   EXCEPTION          a named non-normal ending. It is NOT an escalation, whatever its wording suggests;
 *   ESCALATION         a valid destination for a mandatory escalation. For the prototype this is ESCALATE only;
 *   REVIEW_HALT        governed: automated progression halts and the run is pending authorised review, not completed.
 * No class is implied by another: "Review required" and the exception outcomes are not equivalent to escalation.
 */
export type OutcomeClass = 'NORMAL_COMPLETION' | 'EXCEPTION' | 'ESCALATION' | 'REVIEW_HALT';
export const OUTCOME_CATALOG: Record<OutcomeCode, { label: string; cls: OutcomeClass; routable: boolean; meaning: string }> = {
  COMPLETED: { label: 'Completed', cls: 'NORMAL_COMPLETION', routable: true, meaning: 'Finished normally.' },
  CLARIFICATION_REQUIRED: { label: 'Clarification required', cls: 'EXCEPTION', routable: true, meaning: 'Something needs to be explained to the customer.' },
  ESCALATE: { label: 'Escalate', cls: 'ESCALATION', routable: true, meaning: 'Passed to a person for handling. The only valid mandatory-escalation outcome.' },
  CUSTOMER_DECLINED: { label: 'Customer declined', cls: 'EXCEPTION', routable: true, meaning: 'The customer chose not to continue.' },
  UNABLE_TO_VERIFY: { label: 'Unable to verify', cls: 'EXCEPTION', routable: true, meaning: 'The verification could not be completed.' },
  REVIEW_REQUIRED: { label: 'Review required', cls: 'REVIEW_HALT', routable: false, meaning: 'Automated progression halts; the run is pending authorised review and is not completed.' },
};
export const ALL_OUTCOMES = Object.keys(OUTCOME_CATALOG) as OutcomeCode[];
export const OUTCOME_LABEL = Object.fromEntries(ALL_OUTCOMES.map((o) => [o, OUTCOME_CATALOG[o].label])) as Record<OutcomeCode, string>;
/** Outcomes an author may choose as an ordinary destination. REVIEW_REQUIRED is governed and reached only by "Stop and flag for review". */
export const OUTCOMES = ALL_OUTCOMES.filter((o) => OUTCOME_CATALOG[o].routable);
/** A mandatory escalation must end with an outcome CLASSIFIED as an escalation — not merely any outcome other than Completed (D-128, D-133). */
export const ESCALATION_OUTCOMES: OutcomeCode[] = ALL_OUTCOMES.filter((o) => OUTCOME_CATALOG[o].cls === 'ESCALATION');

export const KIND_LABEL: Record<ModuleKind, string> = {
  OPENING: 'Opening', COMMON: 'General', PRODUCT: 'Product', RISK: 'Enhanced review', EXCEPTION: 'Exception', CLOSING: 'Closing',
};

const YES_NO: Option[] = [{ code: 'YES', label: 'Yes' }, { code: 'NO', label: 'No' }];

function q(code: string, answerType: Question['answerType'], intent: string, text: string, extra: Partial<Question> = {}): Question {
  return {
    code, version: 1, answerType, intent, options: answerType === 'YES_NO' ? YES_NO : [],
    wording: { version: 1, text, approval: 'SYNTHETIC_UNAPPROVED' }, published: true, ...extra,
  };
}
const n = (id: string, question: Question, routing: Routing = { mode: 'ALL_TO_NEXT' }, role?: 'FOLLOWUP'): QuestionNode =>
  ({ id, type: 'QUESTION', q: { code: question.code, version: question.version }, routing, ...(role ? { role } : {}) });
const d = (id: string, binding: Binding): DecisionNode => ({ id, type: 'DECISION', binding });
const e = (id: string, from: string, on: string, to: Target): Edge => ({ id, from, on, to });
const node = (id: string): Target => ({ node: id });
const out = (outcome: OutcomeCode): Target => ({ outcome });

function mod(code: string, name: string, kind: ModuleKind, intent: string, outcomes: OutcomeCode[], nodes: ModuleNode[], edges: Edge[], defaultEntry?: Entry): Module {
  return { code, revision: 1, name, kind, intent, published: true, entry: nodes[0]?.id ?? null, outcomes, nodes, edges, ...(defaultEntry ? { defaultEntry } : {}) };
}

export function sampleWorkspace(): Workspace {
  // ---- questions --------------------------------------------------------------------------------------------
  const identity = q('Q-IDENTITY-CONFIRMED', 'YES_NO', 'Customer confirms they are the policyholder', 'Can you confirm that you are the policyholder?');
  const purchase = q('Q-CONFIRM-PURCHASE', 'YES_NO', 'Customer confirms the purchase', 'Can you confirm that you purchased this policy?');
  const repExplained = q('Q-REP-EXPLAINED', 'YES_NO', 'Representative explained the plan', 'Did your representative explain how the plan works?');
  const benefits = q('Q-BENEFITS-EXPLAINED', 'YES_NO', 'Benefits were explained', 'Did your representative explain the benefits of this plan?');
  const risks = q('Q-RISKS-UNDERSTOOD', 'YES_NO', 'Customer understands the key risks', 'Do you understand the key risks and exclusions?');
  const clarify = q('Q-WHAT-TO-CLARIFY', 'FREE_TEXT', 'What the customer wants clarified', 'What would you like us to clarify?', { textRule: { required: true, min: 5, max: 500 } });
  const understood = q('Q-UNDERSTOOD', 'YES_NO', 'Customer understood what was just explained', 'Did you understand what was just explained?');
  const proceed = q('Q-CONFIRM-PROCEED', 'YES_NO', 'Customer is content to proceed', 'Are you content to proceed with this policy?');
  const concern = q('Q-MAIN-CONCERN', 'SINGLE_SELECT', "The customer's most important concern", 'Which of these is most important to you?', {
    options: [
      { code: 'PREMIUM', label: 'Whether I can afford the premium' }, { code: 'BENEFITS', label: 'What the plan pays' },
      { code: 'CLAIMS', label: 'How to claim' }, { code: 'NONE', label: 'None of these' },
    ],
  });
  const premiumDetail = q('Q-PREMIUM-DETAIL', 'YES_NO', 'Premium is affordable for the full term', 'Are you comfortable paying this premium for the full term?');
  const benefitsDetail = q('Q-BENEFITS-DETAIL', 'YES_NO', 'Benefits match what was explained', 'Do the benefits match what was explained to you?');
  const claimsDetail = q('Q-CLAIMS-DETAIL', 'YES_NO', 'Claims process was explained', 'Was the claims process explained to you?');
  const areas = q('Q-CLARIFY-AREAS', 'MULTI_SELECT', 'Areas the customer wants clarified', 'Which of these would you like us to clarify? You may choose more than one.', {
    options: [
      { code: 'PREMIUM', label: 'Premium' }, { code: 'BENEFITS', label: 'Benefits' }, { code: 'CLAIMS', label: 'Claims' },
      { code: 'CRITICAL_RISK', label: 'I did not agree to this policy', interrupt: 'MANDATORY' }, { code: 'NONE', label: 'None of the above', exclusive: true },
    ],
    selection: { min: 1, max: 4 },
  });
  const premiumClarify = q('Q-PREMIUM-CLARIFY', 'YES_NO', 'Premium amount and term are understood', 'Is the premium amount and payment term clear to you now?');
  const coverClarify = q('Q-COVER-CLARIFY', 'YES_NO', 'Cover and claims are understood', 'Is it clear to you what the plan covers and how to claim?');
  const reason = q('Q-PURCHASE-REASON', 'SINGLE_SELECT', 'Main reason for buying', 'What was your main reason for buying this policy?', {
    options: [
      { code: 'PROTECTION', label: 'Protection for family' }, { code: 'SAVINGS', label: 'Savings' },
      { code: 'OTHER', label: 'Other — please specify', isOther: true, otherText: { required: true, min: 5, max: 200 } },
    ],
  });
  const reasonMatches = q('Q-REASON-MATCHES-ADVICE', 'YES_NO', 'Stated reason matches the advice given', 'Does that match the advice your representative gave you?');
  const ilpRisk = q('Q-ILP-RISK-UNDERSTOOD', 'YES_NO', 'Customer understands investment risk', 'Do you understand that the value of this plan can go down as well as up?');
  const funds = q('Q-SOURCE-OF-FUNDS', 'YES_NO', 'Customer confirms the source of funds', 'Can you confirm the funds for this policy are your own?');
  const affordability = q('Q-AFFORDABILITY', 'YES_NO', 'Premium remains affordable after retirement', 'Will you still be able to afford this premium after you retire?');
  const replCosts = q('Q-REPLACEMENT-COSTS', 'YES_NO', 'Customer was told the costs of replacing a policy', 'Were you told about the costs of replacing your existing policy?');
  const callback = q('Q-CALLBACK-CONSENT', 'YES_NO', 'Customer agrees to a follow-up from a specialist', 'May one of our specialists call you to explain this further?');
  const anythingElse = q('Q-ANYTHING-ELSE', 'FREE_TEXT', "Customer's own remarks", 'Is there anything else you would like to tell us?', { textRule: { required: false, min: 0, max: 500 } });
  const comfortable = q('Q-PREMIUM-COMFORTABLE', 'YES_NO', 'Customer is comfortable with the premium today', 'Are you comfortable with the premium you are paying for this policy?');
  const longTerm = q('Q-AFFORD-LONG-TERM', 'YES_NO', 'Premium stays affordable if income falls', 'If your income fell, would you still be able to keep paying this premium?');
  const closingAck = q('Q-CLOSING-ACK', 'YES_NO', 'Customer acknowledges the closing statement', 'Thank you. Do you acknowledge that this call has been completed?');

  // ---- conditions -------------------------------------------------------------------------------------------
  const cIlp: Condition = {
    code: 'C-IS-ILP', version: 1, name: 'Product is ILP', shared: true, params: {},
    ast: { op: 'EQ', left: { field: 'policy.product_family' }, right: { literal: 'ILP' } },
  };
  const cHigh: Condition = {
    code: 'C-HIGH-VALUE', version: 1, name: 'High value sale', shared: true,
    params: {
      premium_threshold: { type: 'MONEY', unit: 'SGD', label: 'Premium threshold' },
      sum_assured_threshold: { type: 'MONEY', unit: 'SGD', label: 'Sum assured threshold' },
    },
    ast: { op: 'OR', args: [
      { op: 'GTE', left: { field: 'policy.annual_premium' }, right: { param: 'premium_threshold' } },
      { op: 'GTE', left: { field: 'policy.sum_assured' }, right: { param: 'sum_assured_threshold' } },
    ] },
  };
  const cRepl: Condition = {
    code: 'C-IS-REPLACEMENT', version: 1, name: 'Policy replacement', shared: true, params: {},
    ast: { op: 'EQ', left: { field: 'policy.is_replacement' }, right: { literal: true } },
  };
  const cOlder: Condition = {
    code: 'C-OLDER-CUSTOMER', version: 1, name: 'Older customer', shared: true,
    params: { minimum_age: { type: 'INTEGER', unit: 'years', label: 'Minimum age' } },
    ast: { op: 'GTE', left: { field: 'customer.age_years' }, right: { param: 'minimum_age' } },
  };
  // A parameterised condition: what it checks is shared; each place that uses it sets its own two amounts.
  const cLarge: Condition = {
    code: 'C-LARGE-COMMITMENT', version: 1, name: 'Large commitment', shared: true,
    params: {
      premium_above: { type: 'MONEY', unit: 'SGD', label: 'Premium above' },
      sum_assured_at_least: { type: 'MONEY', unit: 'SGD', label: 'Sum assured at least' },
    },
    ast: { op: 'AND', args: [
      { op: 'GT', left: { field: 'policy.annual_premium' }, right: { param: 'premium_above' } },
      { op: 'GTE', left: { field: 'policy.sum_assured' }, right: { param: 'sum_assured_at_least' } },
    ] },
  };
  // Reads an earlier answer. It belongs to one placement (not in the library); the placement says which question it means.
  const cNotComfortable: Condition = {
    code: 'C-LOCAL-NOT-COMFORTABLE', version: 1, name: 'Rule in Affordability check', shared: false, params: {},
    inputs: { comfortable: { question: { code: 'Q-PREMIUM-COMFORTABLE', version: 1 }, answerType: 'YES_NO', scope: 'MODULE' } },
    ast: { op: 'EQ', left: { input: 'comfortable' }, right: { literal: 'NO' } },
  };

  // ---- modules ----------------------------------------------------------------------------------------------
  const general = mod('M-GENERAL', 'General verification', 'COMMON', 'Confirms who we are speaking to and that the purchase happened.',
    ['COMPLETED', 'UNABLE_TO_VERIFY'],
    [n('n1', identity, { mode: 'PER_CHOICE', normal: 'YES' }), n('n2', purchase), n('n3', repExplained)],
    [e('e1', 'n1', 'YES', node('n2')), e('e2', 'n1', 'NO', out('UNABLE_TO_VERIFY')), e('e3', 'n2', 'ANY', node('n3')), e('e4', 'n3', 'ANY', out('COMPLETED'))]);

  const suitability = mod('M-SUITABILITY', 'Suitability', 'PRODUCT', 'Checks the customer understood the benefits and risks of an investment-linked plan.',
    ['COMPLETED', 'CLARIFICATION_REQUIRED'],
    [n('n1', benefits, { mode: 'PER_CHOICE', normal: 'YES' }), n('n2', risks, { mode: 'PER_CHOICE', normal: 'YES' }), n('n3', clarify)],
    [e('e1', 'n1', 'YES', node('n2')), e('e2', 'n1', 'NO', node('n3')), e('e3', 'n3', 'AFTER_CAPTURE', node('n2')),
      e('e4', 'n2', 'YES', out('COMPLETED')), e('e5', 'n2', 'NO', out('CLARIFICATION_REQUIRED'))],
    { mode: 'RULE', binding: { condition: { code: 'C-IS-ILP', version: 1 }, params: {}, unknownPolicy: 'BLOCK' } });

  const concerns = mod('M-CONCERNS', 'Customer concerns', 'COMMON', "Asks for the customer's main concern and follows up on it.",
    ['COMPLETED', 'CLARIFICATION_REQUIRED'],
    [n('n1', concern, { mode: 'PER_CHOICE', normal: 'NONE' }), n('n2', premiumDetail), n('n3', benefitsDetail), n('n4', claimsDetail),
      n('n5', proceed, { mode: 'PER_CHOICE', normal: 'YES' })],
    [e('e1', 'n1', 'PREMIUM', node('n2')), e('e2', 'n1', 'BENEFITS', node('n3')), e('e3', 'n1', 'CLAIMS', node('n4')), e('e4', 'n1', 'NONE', node('n5')),
      e('e5', 'n2', 'ANY', node('n5')), e('e6', 'n3', 'ANY', node('n5')), e('e7', 'n4', 'ANY', node('n5')),
      e('e8', 'n5', 'YES', out('COMPLETED')), e('e9', 'n5', 'NO', out('CLARIFICATION_REQUIRED'))]);

  const clarifications = mod('M-CLARIFICATIONS', 'Clarifications', 'COMMON', 'Lets the customer pick several areas and asks one follow-up for each.',
    ['COMPLETED', 'CLARIFICATION_REQUIRED', 'ESCALATE'],
    [n('n1', areas, {
      mode: 'SEQUENTIAL_FOLLOWUPS',
      followups: [{ option: 'PREMIUM', nodes: ['n2'] }, { option: 'BENEFITS', nodes: ['n3'] }, { option: 'CLAIMS', nodes: ['n3'] }],
      noFollowup: ['NONE'], interrupts: [{ option: 'CRITICAL_RISK', policy: 'STOP_ESCALATE', outcome: 'ESCALATE' }], rejoin: node('n4'),
    }), n('n2', premiumClarify, { mode: 'ALL_TO_NEXT' }, 'FOLLOWUP'), n('n3', coverClarify, { mode: 'ALL_TO_NEXT' }, 'FOLLOWUP'),
      n('n4', proceed, { mode: 'PER_CHOICE', normal: 'YES' })],
    [e('e1', 'n2', 'ANY', { ret: true }), e('e2', 'n3', 'ANY', { ret: true }), e('e3', 'n4', 'YES', out('COMPLETED')), e('e4', 'n4', 'NO', out('CLARIFICATION_REQUIRED'))]);

  const purchaseReason = mod('M-PURCHASE-REASON', 'Reason for purchase', 'COMMON', 'Records why the customer bought, with an "Other" answer when none fits.',
    ['COMPLETED'],
    [n('n1', reason, { mode: 'PER_CHOICE', normal: 'PROTECTION' }), n('n2', reasonMatches), n('n3', proceed)],
    [e('e1', 'n1', 'PROTECTION', node('n3')), e('e2', 'n1', 'SAVINGS', node('n3')), e('e3', 'n1', 'OTHER', node('n2')),
      e('e4', 'n2', 'ANY', node('n3')), e('e5', 'n3', 'ANY', out('COMPLETED'))]);

  const highValue = mod('M-HIGH-VALUE', 'High value review', 'RISK', 'Extra checks when the premium or the sum assured is large.',
    ['COMPLETED', 'CLARIFICATION_REQUIRED'],
    [n('n1', funds), n('n2', affordability, { mode: 'PER_CHOICE', normal: 'YES' })],
    [e('e1', 'n1', 'ANY', node('n2')), e('e2', 'n2', 'YES', out('COMPLETED')), e('e3', 'n2', 'NO', out('CLARIFICATION_REQUIRED'))],
    { mode: 'RULE', binding: { condition: { code: 'C-HIGH-VALUE', version: 1 }, params: { premium_threshold: 12000, sum_assured_threshold: 500000 }, unknownPolicy: 'BLOCK' } });

  const replacement = mod('M-REPLACEMENT', 'Policy replacement', 'PRODUCT', 'Asked only when this sale replaces an existing policy.',
    ['COMPLETED'], [n('n1', replCosts), n('n2', understood)],
    [e('e1', 'n1', 'ANY', node('n2')), e('e2', 'n2', 'ANY', out('COMPLETED'))],
    { mode: 'RULE', binding: { condition: { code: 'C-IS-REPLACEMENT', version: 1 }, params: {}, unknownPolicy: 'BLOCK' } });

  const escalation = mod('M-ESCALATION', 'Escalation and follow-up', 'EXCEPTION', 'Arranges a specialist call when something needs clarifying.',
    // n2 is the SAME question definition the Clarifications module ends with: one shared question, two modules
    ['COMPLETED'], [n('n1', callback), n('n2', proceed)], [e('e1', 'n1', 'ANY', node('n2')), e('e2', 'n2', 'ANY', out('COMPLETED'))]);

  const closing = mod('M-CLOSING', 'Closing', 'CLOSING', 'Thanks the customer and closes the call.',
    ['COMPLETED'], [n('n1', anythingElse), n('n2', closingAck)],
    [e('e1', 'n1', 'AFTER_CAPTURE', node('n2')), e('e2', 'n2', 'ANY', out('COMPLETED'))]);

  // Two decision points inside one module: customer details decide whether an extra question is asked, and an
  // earlier answer decides how the module ends. Each says where it leads when information is missing.
  const affordabilityCheck = mod('M-AFFORDABILITY', 'Affordability check', 'PRODUCT', 'Asks an extra affordability question when the commitment is large.',
    ['COMPLETED', 'CLARIFICATION_REQUIRED', 'UNABLE_TO_VERIFY', 'REVIEW_REQUIRED'],
    [
      n('n1', comfortable),
      d('d1', { condition: { code: 'C-LARGE-COMMITMENT', version: 1 }, params: { premium_above: 12000, sum_assured_at_least: 500000 }, unknownPolicy: 'ROUTE' }),
      n('n2', longTerm),
      d('d2', { condition: { code: 'C-LOCAL-NOT-COMFORTABLE', version: 1 }, params: {}, inputs: { comfortable: { node: 'n1' } }, unknownPolicy: 'BLOCK' }),
    ],
    [
      e('e1', 'n1', 'ANY', node('d1')),
      e('e2', 'd1', 'MATCH', node('n2')), e('e3', 'd1', 'NO_MATCH', node('d2')), e('e4', 'd1', 'UNKNOWN', out('UNABLE_TO_VERIFY')),
      e('e5', 'n2', 'ANY', node('d2')),
      e('e6', 'd2', 'MATCH', out('CLARIFICATION_REQUIRED')), e('e7', 'd2', 'NO_MATCH', out('COMPLETED')), e('e8', 'd2', 'UNKNOWN', out('REVIEW_REQUIRED')),
    ]);

  return {
    questions: [identity, purchase, repExplained, benefits, risks, clarify, understood, proceed, concern, premiumDetail, benefitsDetail, claimsDetail,
      areas, premiumClarify, coverClarify, reason, reasonMatches, ilpRisk, funds, affordability, replCosts, callback, anythingElse, closingAck, comfortable, longTerm],
    conditions: [cIlp, cHigh, cRepl, cOlder, cLarge, cNotComfortable],
    modules: [general, suitability, highValue, affordabilityCheck, replacement, concerns, clarifications, purchaseReason, escalation, closing],
    surveys: [],
    seq: 1,
  };
}

/** Starter template offered by "Create survey": three modules from the library. */
export const TEMPLATE_MODULES = ['M-GENERAL', 'M-SUITABILITY', 'M-CLOSING'];
