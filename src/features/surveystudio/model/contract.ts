// Survey Studio prototype (UC-01) — INTERFACE CONTRACTS towards the existing evaluation and findings engines.
// Nothing here evaluates an answer, raises a finding or replaces an engine. It states, in types, what Survey Studio
// will hand to those engines, and shows the projection from the one canonical model, so the contract can be reviewed
// and tested before any backend exists. Field names follow the content document the engines read today
// (Call360-specs docs/plans/survey-studio/21_UC-01_CONSOLIDATION_MAP.md §4).
import { buildFlow } from './flow';
import { findModule, findQuestion } from './ops';
import { isQuestion, mKey, type AnswerType, type NumberRule, type Survey, type Workspace } from './types';
import { deliveryOf, variablesOf } from './wording';

/** The eight evaluation methods of the existing answer-evaluation engine. Survey Studio selects one; it never computes one. */
export type EvaluationMethod = 'EXACT_BOOLEAN' | 'ACKNOWLEDGEMENT' | 'NUMERIC_COMPARE' | 'NUMERIC_MATCH_POLICY_FACT' | 'ENUM_MATCH' | 'ENUM_MATCH_POLICY_FACT' | 'NARRATIVE_REVIEW' | 'COLLECT_ONLY';
export interface EvaluationConfig {
  method: EvaluationMethod;
  /** EXACT_BOOLEAN: the expected yes/no. */
  expected_boolean?: boolean;
  /** NUMERIC_*: operator, value or policy fact, unit, and an optional approved tolerance with its approval reference. */
  operator?: 'EQ' | 'GTE' | 'LTE' | 'GT' | 'LT'; value?: number; policy_fact_key?: string; unit?: string; tolerance?: number; tolerance_reference?: string;
  /** ENUM_MATCH: accepted option CODES (the existing engine matches labels; codes are the replacement). */
  accepted_options?: string[];
}
/** One link from a question to a compliance control, as the findings engine reads it. */
export interface ControlLink { control_code: string; regulatory_reference?: string; rationale: string }
/** Which evaluation methods a question of each type may use. A statement is never evaluated. */
export const METHODS_FOR: Record<AnswerType, EvaluationMethod[]> = {
  YES_NO: ['EXACT_BOOLEAN', 'COLLECT_ONLY'], ACKNOWLEDGEMENT: ['ACKNOWLEDGEMENT', 'COLLECT_ONLY'],
  NUMERIC: ['NUMERIC_COMPARE', 'NUMERIC_MATCH_POLICY_FACT', 'COLLECT_ONLY'], SINGLE_SELECT: ['ENUM_MATCH', 'ENUM_MATCH_POLICY_FACT', 'COLLECT_ONLY'],
  MULTI_SELECT: ['COLLECT_ONLY'], FREE_TEXT: ['NARRATIVE_REVIEW', 'COLLECT_ONLY'], STATEMENT: [],
};

export interface ContentItem {
  /** `<module instance>/<node>`: unique per placement, so a question placed twice is evaluated twice (D-115). */
  execution_key: string;
  question_code: string; version: number; wording_version: number; position: string;
  item_type: 'QUESTION' | 'STATEMENT';
  answer_type: AnswerType;
  options: Array<{ code: string; label: string }>;
  number_rule: NumberRule | null;
  customer_wording: string; variables: string[];
  delivery_mode: string; verbatim_required: boolean;
  mandatory: boolean; lifecycle_role: string;
  /** null = not configured. Survey Studio cannot configure these until it is connected to the engines. */
  evaluation: EvaluationConfig | null;
  controls: ControlLink[];
}
export interface ContentDocument { schema: 'call360.survey-content/draft-uc01'; survey: string; sections: Array<{ instance: string; module_code: string; module_revision: number; module_name: string; items: ContentItem[] }> }

const STATEMENT_ROLE = { OPENING: 'OPENING_STATEMENT', TRANSITION: 'TRANSITION_STATEMENT', DISCLOSURE: 'DISCLOSURE', CLOSING: 'CLOSING_STATEMENT' } as const;

/** The content document for one survey: every placed item with what the evaluation and findings engines need to know. */
export function toContent(ws: Workspace, survey: Survey): ContentDocument {
  return {
    schema: 'call360.survey-content/draft-uc01', survey: survey.id,
    sections: survey.sequence.map((inst) => {
      const m = findModule(ws, mKey(inst.module))!;
      const numbers = buildFlow(ws, m).numbers;
      const order = new Map([...numbers.keys()].map((nid, k) => [nid, k])); // reading order; labels are display only
      const items: ContentItem[] = m.nodes.filter(isQuestion).filter((n) => numbers.has(n.id))
        .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
        .map((n) => {
          const q = findQuestion(ws, n.q)!;
          const delivery = deliveryOf(q);
          const statement = q.answerType === 'STATEMENT';
          return {
            execution_key: `${inst.id}/${n.id}`, question_code: q.code, version: q.version, wording_version: q.wording.version, position: numbers.get(n.id)!,
            item_type: statement ? 'STATEMENT' : 'QUESTION', answer_type: q.answerType, options: q.options.map((o) => ({ code: o.code, label: o.label })), number_rule: q.numberRule ?? null,
            customer_wording: q.wording.text.trim(), variables: variablesOf(q.wording.text), delivery_mode: delivery, verbatim_required: delivery !== 'CONVERSATIONAL',
            mandatory: !statement && !!q.mandatory, lifecycle_role: statement ? STATEMENT_ROLE[q.statement ?? 'TRANSITION'] : q.role ?? 'VERIFICATION',
            evaluation: null, controls: [],
          };
        });
      return { instance: inst.id, module_code: m.code, module_revision: m.revision, module_name: m.name, items };
    }),
  };
}

/**
 * Why the engines as they stand TODAY could not read an item — the gap list for the replacement interface, not an
 * error in the survey. Empty = today's engines could read it unchanged.
 */
export function legacyGaps(item: ContentItem): string[] {
  const gaps: string[] = [];
  if (item.answer_type === 'MULTI_SELECT') gaps.push('Multiple choice is not an answer type the existing engines know.');
  if (item.answer_type === 'SINGLE_SELECT') gaps.push('The existing engines match choice LABELS; Survey Studio identifies choices by stable CODES.');
  if (item.item_type === 'STATEMENT') gaps.push('The existing model stores a statement as an acknowledgement question with a role; here it is a statement that takes no answer.');
  if (item.lifecycle_role === 'TRANSITION_STATEMENT') gaps.push('“Transition” is not a role the existing lifecycle knows.');
  if (item.variables.length) gaps.push('The existing engines have no controlled variables in wording.');
  return gaps;
}
