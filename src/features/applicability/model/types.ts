// Survey Applicability (APPL-X1) — the canonical documents, exactly as the Python evaluator reads them
// (specs 56_APPL-X1 §3). The browser edits these documents and DRAWS what the evaluator returns; it never decides
// which surveys apply.
export type VarType = 'BOOLEAN' | 'ENUM' | 'MULTI_ENUM' | 'NUMBER' | 'DECIMAL' | 'MONEY' | 'DATE' | 'STRING';
export type SourceStatus = 'MAPPED' | 'PROPOSED' | 'UNMAPPED' | 'DERIVED';
export interface Option { value: string; label: string }
export interface Variable {
  code: string; name: string; description: string; category: string; type: VarType;
  values?: Option[]; currency?: string; min?: number; max?: number;
  markets: string[];
  source: { status: SourceStatus; system?: string; field?: string; note?: string };
  owner?: string; samples?: unknown[]; derived?: { expr: Expr } | null;
  version: number; status: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED';
  /** the published version this draft would replace, kept for the comparison */
  previous?: Variable | null;
}
export interface Profile {
  code: string; name: string; description: string; extends: string[];
  sections: { name: string; variables: string[] }[];
  required: string[]; constraints?: Record<string, { allowed: string[] }>;
  version: number; status: 'DRAFT' | 'PUBLISHED';
}
export type Operator =
  | 'is_true' | 'is_false' | 'equals' | 'not_equals' | 'in' | 'not_in' | 'includes_any' | 'includes_all' | 'includes_none'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'on' | 'before' | 'after' | 'is_known' | 'is_unknown';
export type Scalar = string | number | boolean | null;
export type Expr =
  | { op: 'all'; args: Expr[] }
  | { op: 'any'; args: Expr[] }
  | { op: 'not'; arg: Expr }
  | { op: 'test'; variable: string; operator: Operator; value?: Scalar; values?: string[]; min?: Scalar; max?: Scalar }
  | { op: 'ref'; condition: string; version: number };
export interface Condition {
  code: string; name: string; description: string; expr: Expr; version: number; status: 'DRAFT' | 'PUBLISHED';
  history?: { version: number; expr: Expr }[];
}
export interface SurveyRef { code: string; version: number; name: string; fingerprint: string; label?: string; summary?: string }
export type Action =
  | { kind: 'INCLUDE'; surveys: SurveyRef[] }
  | { kind: 'CHOOSE_ONE'; alternatives: { survey: SurveyRef; when: Expr | null }[] };
export interface Requirement { id: string; name: string; when: Expr | null; action: Action; replaces: string[]; note?: string }
export type SameSurvey = 'ONE_DELIVERY' | 'CONFLICT' | null;
export interface Policy {
  code: string; name: string; market: string; description: string; profiles: string[]; scope: Expr | null;
  same_survey: SameSurvey; requirements: Requirement[]; order: string[]; version: number;
  status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'SUPERSEDED';
}
export type Persona = 'maker' | 'checker' | 'publisher';
export interface PolicyEvent { at: string; who: string; persona: Persona | 'system'; what: string; detail?: string }
export interface Candidate { policy: Policy; fingerprint: string | null; submittedBy: string; note: string; approvedBy?: string; state: 'IN_REVIEW' | 'APPROVED' }
export interface PolicyRecord {
  code: string; published: Policy | null; draft: Policy | null; candidate: Candidate | null;
  versions: Policy[]; events: PolicyEvent[]; unsaved: boolean;
}
export type Facts = Record<string, unknown>;
export interface Scenario {
  id: string; name: string; description: string; profiles: string[]; facts: Facts;
  suite?: string; golden?: boolean; generated?: boolean; kind?: string; basedOn?: string;
}
export interface Data {
  variables: Variable[]; profiles: Profile[]; conditions: Condition[]; surveys: SurveyRef[];
  policies: PolicyRecord[]; scenarios: Scenario[]; suites: string[];
}

// ---- what the evaluator returns (contract call360.survey-applicability/0)
export type Tri = 'TRUE' | 'FALSE' | 'UNKNOWN';
export interface FactState { variable: string; name: string; state: 'KNOWN' | 'UNKNOWN' | 'NOT_PROVIDED' | 'INVALID' | 'UNSUPPORTED'; value: unknown; label: string; reason: string; derived?: boolean; given?: unknown }
export interface Trace {
  op: 'all' | 'any' | 'not' | 'test' | 'ref'; path: string; result: Tri; text: string; decisive?: boolean; reason?: string;
  children?: Trace[]; variable?: string; operator?: Operator; fact?: FactState; condition?: string; version?: number;
}
export interface Need { variable: string; name: string; state: string; reason: string }
export type Outcome = 'ACTIVE' | 'REPLACED' | 'PENDING' | 'UNRESOLVED' | 'INACTIVE' | 'AMBIGUOUS' | 'NO_ALTERNATIVE' | 'CHOICE_UNRESOLVED';
export interface ReqResult {
  id: string; name: string; state: 'APPLIES' | 'DOES_NOT_APPLY' | 'UNRESOLVED'; outcome: Outcome; trace: Trace; action: string;
  replaces: string[]; replaced_by?: string[]; may_be_replaced_by?: string[]; surveys: SurveyRef[]; needs: Need[];
  choice?: { outcome: string; reason: string; chosen: SurveyRef | null; alternatives: { index: number; survey: SurveyRef; otherwise: boolean; result: Tri | null; chosen: boolean; trace: Trace | null }[] };
}
export interface Diagnostic { severity: 'BLOCKER' | 'WARNING' | 'INFO'; code: string; message: string; at?: Record<string, unknown>; survey?: string; variable?: string }
export interface Selected { survey: SurveyRef; required_by: string[]; position?: number; obligations?: number; conflict?: boolean }
export interface Plan {
  status: 'RESOLVED' | 'UNRESOLVED' | 'OUT_OF_SCOPE' | 'SCOPE_UNRESOLVED' | 'ERROR';
  policy?: { code: string; name: string; version: number; status: string; fingerprint: string };
  requirements: ReqResult[]; selected: Selected[]; pending: Selected[];
  excluded: { survey: SurveyRef; why: { requirement: string; reason: string; text: string }[] }[];
  needs: Need[]; explanation: string[]; summary?: string; facts: Record<string, FactState>;
  diagnostics: Diagnostic[]; fingerprint?: string; facts_fingerprint?: string; error?: { code: string; message: string; at?: string };
}
export interface Comparison {
  changed: boolean; added: string[]; removed: string[]; revised: string[]; order_changed: boolean;
  status_before: string; status_after: string; new_unknown: boolean; because: { requirement: string; name: string; change: string; text: string }[];
}
export interface EvalRow { scenario: string; plan: Plan; before?: Plan; comparison?: Comparison }
