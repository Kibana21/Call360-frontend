// Survey Studio prototype (SS-02A) — canonical model types.
// These mirror the SS-01 contracts (Call360-specs docs/plans/survey-studio/04_SS-01_CANONICAL_CONTRACTS.md and the
// fixtures beside it): Definitions and Versions are shared and never changed by a placement; Instances (module
// instances, question nodes) own routing and bindings. PROTOTYPE ONLY: nothing here is saved to the server.

/**
 * What kind of item a definition is (UC-01). NUMERIC and ACKNOWLEDGEMENT are answered questions; STATEMENT is not a
 * question at all: it is approved wording that is DELIVERED and takes no answer. All three, like FREE_TEXT, have exactly
 * one way on ("everybody continues") and cannot branch.
 */
export type AnswerType = 'YES_NO' | 'SINGLE_SELECT' | 'MULTI_SELECT' | 'FREE_TEXT' | 'NUMERIC' | 'ACKNOWLEDGEMENT' | 'STATEMENT';
/** Items with a single continuation: nothing about the answer can choose a route. */
export const singleRoute = (t: AnswerType) => t === 'FREE_TEXT' || t === 'NUMERIC' || t === 'ACKNOWLEDGEMENT' || t === 'STATEMENT';

/** What a statement is for. A declared role only: it changes no routing (UC-01). */
export type StatementRole = 'OPENING' | 'TRANSITION' | 'DISCLOSURE' | 'CLOSING';
/**
 * The lifecycle role of a QUESTION (the roles of the existing conversation lifecycle). Declared only: the gate
 * behaviour behind identity and consent — what happens when the customer says no, refuses or does not answer — is NOT
 * implemented here, because those rules are development assumptions awaiting a business decision. Absent = an ordinary
 * verification question.
 */
export type QuestionRole = 'IDENTITY_CHECK' | 'CONSENT_TO_PROCEED' | 'RECORDING_CONSENT' | 'CLOUD_PROCESSING_CONSENT';
/**
 * How approved wording may be delivered. CONTROLLED_TTS = exactly this text, synthesised; EXACT_AUDIO = an approved
 * recording; CONVERSATIONAL = the assistant phrases it. The last is selectable so its consequence can be seen, and is
 * blocked by validation: what an assistant may say in its own words has not been decided (G-6 AD-9).
 */
export type DeliveryMode = 'CONTROLLED_TTS' | 'EXACT_AUDIO' | 'CONVERSATIONAL';
/** NUMERIC answer rule. `unit` is a label shown to the author and reviewer; it is not converted. */
export interface NumberRule { integer: boolean; min?: number; max?: number; unit?: string }
export type ModuleKind = 'OPENING' | 'COMMON' | 'PRODUCT' | 'RISK' | 'EXCEPTION' | 'CLOSING';
/**
 * REVIEW_REQUIRED is governed, not an ordinary author-routable outcome (owner decision D-127): automated progression
 * halts and the run waits for an authorised review. It is never "completed" and a survey cannot route past it.
 */
export type OutcomeCode = 'COMPLETED' | 'CLARIFICATION_REQUIRED' | 'ESCALATE' | 'CUSTOMER_DECLINED' | 'UNABLE_TO_VERIFY' | 'REVIEW_REQUIRED';

export interface TextRule { required: boolean; min: number; max: number }

/** One coded choice. `code` is the stable identity; `label` can change without changing any route. */
export interface Option {
  code: string;
  label: string;
  exclusive?: boolean;
  isOther?: boolean;
  otherText?: TextRule;
  /**
   * Interruption governance (owner decision, SS-02A.1). Part of the DEFINITION, so a placement cannot change it.
   * absent = prohibited: this answer can never interrupt a follow-up queue;
   * OPTIONAL = a placement may configure an interruption, choosing one of the three behaviours;
   * MANDATORY = a required escalation: every placement must stop and escalate, and nothing may weaken that.
   */
  interrupt?: InterruptClass;
}
export type InterruptClass = 'OPTIONAL' | 'MANDATORY';
/** A = stop the queue and end with an approved outcome; B = ask the interrupt's question(s), then resume the queue;
 *  C = stop the queue and continue at an explicitly chosen destination. */
export type InterruptPolicy = 'STOP_ESCALATE' | 'RESUME' | 'STOP_REJOIN';

/** A Question Version: structure plus the pinned customer-facing wording (Wording Version). */
export interface Question {
  code: string;
  version: number;
  answerType: AnswerType;
  intent: string;
  options: Option[]; // YES_NO carries YES / NO
  /**
   * MULTI_SELECT limits, present only once the author has set them. Absent = at least one, up to every answer that can
   * be combined. Stored limits are NEVER changed by another edit (owner correction, SS-02B.2): when removing an answer
   * or changing exclusivity makes them impossible, that is a conflict the author resolves explicitly.
   */
  selection?: { min: number; max: number };
  textRule?: TextRule; // FREE_TEXT
  numberRule?: NumberRule; // NUMERIC
  /** STATEMENT only: what the statement is for. */
  statement?: StatementRole;
  /** Questions only: a declared lifecycle role. */
  role?: QuestionRole;
  /**
   * Questions only: the question must be asked and answered for the call to count as complete. A DECLARED attribute
   * carried to evaluation and review; what a call does when it is not answered is undecided (no-answer contract).
   */
  mandatory?: boolean;
  /**
   * The pinned Wording Version. `text` may contain controlled variables written {{field_code}}; each must name a field
   * of the governed catalog and is rendered deterministically (model/wording.ts). `delivery` absent = CONTROLLED_TTS.
   */
  wording: { version: number; text: string; approval: 'SYNTHETIC_UNAPPROVED'; delivery?: DeliveryMode };
  /** true = approved shared library version (immutable here); false = draft created in this session. */
  published: boolean;
}

export type Target = { node: string } | { outcome: OutcomeCode } | { ret: true };

export type RoutingMode = 'ALL_TO_NEXT' | 'PER_CHOICE' | 'SEQUENTIAL_FOLLOWUPS' | 'ORDERED_RULES';

/**
 * One prioritised rule of a first-matching-rule question (SS-02B.1). The array order IS the priority: the first rule
 * whose criteria the selected answers meet decides the single destination; nothing else runs.
 * ANY = at least one of the listed answers is selected; ALL = every listed answer is; NONE = none of them is.
 */
export interface SetRule { id: string; kind: 'ANY' | 'ALL' | 'NONE'; options: string[]; to: Target | null }

export interface Followup { option: string; nodes: string[] }
export interface Interrupt { option: string; policy: InterruptPolicy; outcome?: OutcomeCode; nodes?: string[]; rejoin?: Target | null }

export interface Routing {
  mode: RoutingMode;
  /** PER_CHOICE: the answer the author treats as the normal path (layout and safe insertion only). */
  normal?: string;
  /** SEQUENTIAL_FOLLOWUPS: array order is the execution order (priority). */
  followups?: Followup[];
  noFollowup?: string[];
  interrupts?: Interrupt[];
  rejoin?: Target | null;
  /** ORDERED_RULES: prioritised rules, then the mandatory "otherwise" destination when no rule matches. */
  rules?: SetRule[];
  fallback?: Target | null;
}

/**
 * An item node: a question, or (UC-01) a statement. Both place one definition from the one item master (`q`) and own
 * its routing; a STATEMENT node always places a definition whose answerType is STATEMENT, and the reverse.
 */
export interface QuestionNode {
  id: string;
  type: 'QUESTION' | 'STATEMENT';
  q: { code: string; version: number };
  routing: Routing;
  role?: 'FOLLOWUP';
}
/**
 * A decision point (SS-02B.1): asks nothing, evaluates one condition binding and leaves by exactly one of three
 * results. Its edges use `on`: MATCH | NO_MATCH | UNKNOWN. When information is missing the result is UNKNOWN, never
 * NO_MATCH; the binding's unknownPolicy says whether UNKNOWN follows its own route or stops the call for review.
 */
export interface DecisionNode { id: string; type: 'DECISION'; binding: Binding | null }
export type ModuleNode = QuestionNode | DecisionNode;
/** True for every item node — a question or a statement — i.e. everything that is not a decision. */
export const isQuestion = (n: ModuleNode): n is QuestionNode => n.type !== 'DECISION';
export const isStatement = (n: ModuleNode): boolean => n.type === 'STATEMENT';

/** `on`: YES | NO | an option code | ANY (the explicit "everybody continues" default) | AFTER_CAPTURE; for a decision MATCH | NO_MATCH | UNKNOWN. */
export interface Edge { id: string; from: string; on: string; to: Target }

export interface Module {
  code: string;
  revision: number;
  name: string;
  kind: ModuleKind;
  intent: string;
  published: boolean;
  entry: string | null;
  outcomes: OutcomeCode[];
  nodes: ModuleNode[];
  edges: Edge[];
  /** Recommended entry rule applied when the module is added to a survey (the author can change it). */
  defaultEntry?: Entry;
  /** Set on a draft revision derived for one survey (copy-on-write). */
  derivedFor?: string;
}

// ---- conditions -------------------------------------------------------------------------------------------------
export type FieldType = 'MONEY' | 'INTEGER' | 'ENUM' | 'BOOLEAN' | 'TEXT';
export interface FieldDef { code: string; label: string; type: FieldType; unit?: string; values?: string[] }

/**
 * `field` = a customer or policy attribute; `param` = a named setting whose value each placement supplies;
 * `input` = a named earlier answer, mapped to a question by each placement; `literal` = a fixed value.
 * A literal compared with an answer is a stable OPTION CODE (or a list of codes), never a display label.
 */
export type Operand = { field: string } | { param: string } | { input: string } | { literal: string | number | boolean | string[] };
/**
 * INCLUDES_ANY / INCLUDES_ALL / INCLUDES_NONE apply to a multiple-choice answer and take a list of option codes
 * (owner decision D-125). An answered question with nothing selected is a KNOWN empty selection; a question that was
 * not answered is UNKNOWN — the two are never confused.
 */
export type CompareOp = 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'INCLUDES_ANY' | 'INCLUDES_ALL' | 'INCLUDES_NONE';
/**
 * The typed declaration of an earlier answer a condition reads (owner correction, SS-02B.2). It names the question by
 * its stable identity and pinned version and carries its answer type, so the option codes used in the condition can be
 * checked. Nothing here is a display label: what the author sees is looked up from the question when it is shown.
 */
export interface InputDecl { question: { code: string; version: number }; answerType: AnswerType; scope: 'MODULE' }
export type Ast =
  | { op: 'AND'; args: Ast[] }
  | { op: 'OR'; args: Ast[] }
  | { op: 'NOT'; arg: Ast }
  | { op: CompareOp; left: Operand; right: Operand };

export interface Condition {
  code: string;
  version: number;
  name: string;
  ast: Ast;
  params: Record<string, { type: FieldType; unit?: string; label: string }>;
  /** Earlier answers the condition reads, by stable key; each placement binds a key to one question instance. */
  inputs?: Record<string, InputDecl>;
  /** true = in the reusable library (immutable: a change makes a new version); false = belongs to one placement. */
  shared: boolean;
}

/**
 * BLOCK = stop and flag for review: the governed REVIEW_REQUIRED outcome (a decision carries it as its UNKNOWN edge);
 * SKIP_WITH_REASON = module entry only; ROUTE = a decision follows the Unknown route the author chose.
 */
export type UnknownPolicy = 'BLOCK' | 'SKIP_WITH_REASON' | 'ROUTE';
export interface Binding {
  condition: { code: string; version: number };
  params: Record<string, number | string | boolean>;
  /** Which question instance (stable node id in this module) supplies each declared earlier answer (decisions only). */
  inputs?: Record<string, { node: string }>;
  /** null until the author chooses: missing data must never silently become FALSE. */
  unknownPolicy: UnknownPolicy | null;
}

export type Entry =
  | { mode: 'ALWAYS' }
  | { mode: 'RULE'; binding: Binding }
  | { mode: 'ON_OUTCOME'; of: string; outcomes: OutcomeCode[] };

/**
 * The ACTIVATION TRIGGER of a module (owner decision A-2, SS-02C): when it is SELECTED in sequence — only after a named
 * earlier module ends with one of these outcomes. It is independent of the eligibility condition (`entry`), which
 * decides whether a selected module may EXECUTE. An explicit jump is another way of selecting the module.
 */
export interface Activation { of: string; outcomes: OutcomeCode[] }

export type SurveyTarget = '@CONTINUE' | { instance: string } | { surveyOutcome: OutcomeCode };

export interface Instance {
  id: string; // stable instance code, e.g. mi-suitability
  module: { code: string; revision: number };
  /**
   * The ELIGIBILITY condition: ALWAYS = none; RULE = a condition with an explicit policy for UNKNOWN.
   * (`mode: 'ON_OUTCOME'` is the earlier shape of an activation trigger with no eligibility condition; it is still
   * read, and is equivalent to `activation` + `entry: ALWAYS`. New edits write `activation`.)
   */
  entry: Entry;
  /** The activation trigger, when the module is not simply selected in sequence. Absent = in sequence. */
  activation?: Activation;
  /** One route per declared module outcome; null = not yet decided by the author (a blocker). */
  routes: Record<string, SurveyTarget | null>;
  /**
   * The skip disposition AFTER A JUMP (D-135): what happens when this module is reached by a jump and is not eligible
   * (FALSE, or UNKNOWN with the policy "skip and record why"). Absent or null = not chosen: a validation error whenever
   * a jump can arrive here and the module can be skipped — never an invented fallback. Forward only.
   */
  ifIneligible?: SurveyTarget | null;
  /**
   * The skip disposition IN SEQUENCE (owner decision A-3, SS-02C): what happens when this module is reached in order
   * and is not eligible. Absent = the normal default, the next module is considered. A later module or an approved
   * terminal outcome may be configured instead. null = it pointed at a module that was removed: undecided, an error.
   */
  ifSkippedInSequence?: SurveyTarget | null;
}

export interface Survey {
  id: string; // S-…
  name: string;
  purpose: string;
  versionLabel: string;
  sequence: Instance[];
  createdAt: number; // counter value, for stable ordering
}

export interface Workspace {
  questions: Question[];
  conditions: Condition[];
  modules: Module[];
  surveys: Survey[];
  /** Monotonic counter for new codes, so ids are deterministic and never reused. */
  seq: number;
}

export interface Issue {
  id: string;
  severity: 'ERROR' | 'WARNING';
  /** A stable code for rules that the golden fixtures verify (UC-02). The message is for people and may be reworded. */
  code?: string;
  message: string;
  fix: string;
  where: { surveyId?: string; instanceId?: string; moduleKey?: string; nodeId?: string; on?: string; part?: string };
}

export const qKey = (q: { code: string; version: number }) => `${q.code}@${q.version}`;
export const mKey = (m: { code: string; revision: number }) => `${m.code}@${m.revision}`;
