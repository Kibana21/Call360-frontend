// Survey Applicability (APPL-X4a) — saved synthetic scenarios, regression suites and recorded evaluation runs. This
// file is the only place that reads and writes them. Every result is worked out by the server's Python evaluator; the
// browser shows it and decides nothing.
import { api, ApiFailure, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import type { Comparison, Diagnostic, Facts, Plan } from './model/types';

type S = components['schemas'];
export type ScenarioSummary = S['ApplicabilityScenarioSummary'];
export type ScenarioDetail = S['ApplicabilityScenario'];
export type ScenarioInspection = S['ApplicabilityScenarioInspection'];
export type SuiteSummary = S['ApplicabilitySuiteSummary'];
export type SuiteDetail = S['ApplicabilitySuite'];
export type SuiteMember = S['ApplicabilitySuiteMember'];
export type RunSummary = S['ApplicabilityRunSummary'];
export type RunDetail = S['ApplicabilityRun'];
export type RunResultBrief = S['ApplicabilityRunResultSummary'];
export type RunResultFull = S['ApplicabilityRunResult'];
export type RunComparison = S['ApplicabilityRunComparison'];
export type Verification = S['ApplicabilityRunVerification'];
export type Purpose = 'REGRESSION' | 'EXPLORATORY';
export type SuitePurpose = 'PUBLICATION_GATING' | 'EXPLORATORY';
export type PlanStatus = 'RESOLVED' | 'UNRESOLVED' | 'OUT_OF_SCOPE' | 'SCOPE_UNRESOLVED';
export interface ScenarioDoc { name: string; description: string; profiles: string[]; facts: Facts; pins: { kind: string; code: string; version?: number; draft_revision?: number }[] }
/** What a person EXPECTS. `confirmed` is set only by the person; a proposal taken from a result stays unconfirmed until reviewed. */
export interface Expectation {
  status: PlanStatus; selected: { code: string; version: number | null; name: string }[]; pending: string[];
  replaced?: string[]; needs?: string[]; note?: string; source?: 'AUTHORED' | 'PROPOSED_FROM_RESULT'; confirmed: boolean; reviewed_at_revision?: number;
}
export interface Dep { kind: 'VARIABLE' | 'PROFILE'; code: string; name: string; state: 'PUBLISHED' | 'DRAFT'; version_no?: number; draft_revision?: number; content_sha256: string; newer_version_no?: number; stale?: boolean; current_draft_revision?: number | null; published_version_no?: number }
export interface Difference { kind: string; text: string; expected: unknown; actual: unknown; survey?: string; requirements?: string[] }
export interface EvalResult {
  ref: string; scenario_id: string | null; mode: 'SAVED_SCENARIO' | 'EXPLORATORY'; state: 'EVALUATED' | 'COULD_NOT_EVALUATE' | 'INVALID_DEFINITION'; reason: string | null;
  plan: Plan | null; diagnostics: Diagnostic[]; resolved: Dep[]; scenario_fingerprint: string; reproducible: boolean;
}
export interface Evaluation { policy_source: 'SAVED' | 'PREVIEW'; status: string; policy_revision: number; policy_fingerprint: string | null; reasons: Diagnostic[]; results: EvalResult[] }
export interface Coverage {
  label: string; exhaustive: boolean; scenarios_evaluated: number; resolved_positive_passing: number; negative_passing: number; unresolved: number; only_unresolved: boolean;
  requirements: { id: string; name: string; applies: number; does_not_apply: number; unknown: number; replaced: number; selected: number; replaces: string[]; replaced_them: number; conditions: { path: string; text: string; TRUE: number; FALSE: number; UNKNOWN: number }[] }[];
  gaps: { code: string; text: string; requirement: string | null }[]; essential_gaps: number; condition_gaps: number; meaningful_for_publication: boolean; why_not_meaningful: string | null;
}
export interface PairRow { scenario_id: string; scenario_name: string; in: 'BOTH' | 'BEFORE_ONLY' | 'AFTER_ONLY'; outcome_before: string | null; outcome_after: string | null; facts_changed: FactChange[]; expectation_changed: boolean; changed: boolean; comparison: (Comparison & { pending_added: string[]; pending_removed: string[]; now_resolved: boolean }) | null }
export interface FactChange { variable: string; before: unknown; after: unknown; before_given: boolean; after_given: boolean }

const A = '/api/v1/applicability';
export const why = (e: unknown) => (e instanceof ApiFailure ? e.message : e instanceof Error ? e.message : 'The request failed');
export const codeOf = (e: unknown) => (e instanceof ApiFailure ? e.code : '');
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const key = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---- scenarios
export const listScenarios = async (q: { policy_id?: string; q?: string; purpose?: Purpose; baseline_id?: string; archived?: boolean; limit?: number; offset?: number }) => unwrap(await api.GET(`${A}/scenarios`, { params: { query: q } }));
export const getScenario = async (id: string) => unwrap(await api.GET(`${A}/scenarios/{scenario_id}`, { params: { path: { scenario_id: id } } }));
export const createScenario = async (body: { market_code: string; code: string; document: ScenarioDoc | Omit<ScenarioDoc, 'pins'>; purpose: Purpose; policy_id?: string | null; baseline_id?: string | null; origin?: string }) => unwrap(await api.POST(`${A}/scenarios`, { body: body as never }));
export const saveScenario = async (id: string, expected_revision: number, document: ScenarioDoc, purpose: Purpose, note = '') => unwrap(await api.PUT(`${A}/scenarios/{scenario_id}/draft`, { params: { path: { scenario_id: id } }, body: { expected_revision, document: document as never, purpose, note } }));
export const archiveScenario = async (id: string, expected_revision: number, reason: string, restore = false) => unwrap(await api.POST(restore ? `${A}/scenarios/{scenario_id}/restore` : `${A}/scenarios/{scenario_id}/archive`, { params: { path: { scenario_id: id } }, body: { expected_revision, reason } }));
export const inspectScenario = async (market_code: string, document: ScenarioDoc, snapshot?: Record<string, unknown> | null) => unwrap(await api.POST(`${A}/scenarios/inspect`, { body: { market_code, document: document as never, snapshot: snapshot ?? null } }));
export const evaluateScenarios = async (policy_id: string, scenarios: { ref?: string; scenario_id?: string; document?: ScenarioDoc; snapshot?: Record<string, unknown> | null }[], policy_document?: Record<string, unknown> | null) =>
  unwrap(await api.POST(`${A}/scenarios/evaluate`, { body: { policy_id, policy_document: policy_document ?? null, scenarios: scenarios as never } })) as unknown as Evaluation;
export const compareScenarios = async (policy_id: string, before_id: string, after_id: string) => unwrap(await api.POST(`${A}/scenarios/compare`, { body: { policy_id, before_id, after_id } })) as unknown as { status: string; policy_revision: number; before: EvalResult; after: EvalResult; facts_changed: FactChange[]; comparison: PairRow['comparison'] };

// ---- suites
export const listSuites = async (q: { policy_id?: string; archived?: boolean; limit?: number; offset?: number }) => unwrap(await api.GET(`${A}/suites`, { params: { query: q } }));
export const getSuite = async (id: string) => unwrap(await api.GET(`${A}/suites/{suite_id}`, { params: { path: { suite_id: id } } }));
export type MemberIn = { scenario_id: string; expectation: Expectation | null };
export const createSuite = async (body: { market_code: string; code: string; policy_id: string; document: { name: string; description?: string }; purpose: SuitePurpose; members?: MemberIn[]; origin?: string }) => unwrap(await api.POST(`${A}/suites`, { body: body as never }));
export const saveSuite = async (id: string, expected_revision: number, document: { name: string; description: string }, purpose: SuitePurpose, members: MemberIn[], note = '') => unwrap(await api.PUT(`${A}/suites/{suite_id}/draft`, { params: { path: { suite_id: id } }, body: { expected_revision, document, purpose, members: members as never, note } }));
export const archiveSuite = async (id: string, expected_revision: number, reason: string, restore = false) => unwrap(await api.POST(restore ? `${A}/suites/{suite_id}/restore` : `${A}/suites/{suite_id}/archive`, { params: { path: { suite_id: id } }, body: { expected_revision, reason } }));

// ---- runs: immutable evidence
export const runSuite = async (id: string, idempotency_key = key()) => unwrap(await api.POST(`${A}/suites/{suite_id}/runs`, { params: { path: { suite_id: id } }, body: { idempotency_key } }));
export const listRuns = async (q: { suite_id?: string; policy_id?: string; limit?: number; offset?: number }) => unwrap(await api.GET(`${A}/runs`, { params: { query: q } }));
export const getRun = async (id: string, q: { outcome?: RunResultBrief['outcome']; limit?: number; offset?: number } = {}) => unwrap(await api.GET(`${A}/runs/{run_id}`, { params: { path: { run_id: id }, query: q } }));
export const getRunResult = async (id: string, position: number) => unwrap(await api.GET(`${A}/runs/{run_id}/results/{position}`, { params: { path: { run_id: id, position } } }));
export const verifyRun = async (id: string) => unwrap(await api.POST(`${A}/runs/{run_id}/verify`, { params: { path: { run_id: id } } }));
export const compareRuns = async (before_run_id: string, after_run_id: string) => unwrap(await api.POST(`${A}/runs/compare`, { body: { before_run_id, after_run_id } }));
export const againstCurrent = async (id: string) => unwrap(await api.POST(`${A}/runs/{run_id}/against-current`, { params: { path: { run_id: id } } }));

// ---- words
export const OUTCOME: Record<string, { word: string; tone: 'published' | 'bad' | 'warn' | 'unknown' | 'plain' }> = {
  PASSED: { word: 'Passed', tone: 'published' }, FAILED: { word: 'Failed', tone: 'bad' }, COULD_NOT_EVALUATE: { word: 'Could not evaluate', tone: 'warn' },
  INVALID_DEFINITION: { word: 'Test definition invalid', tone: 'warn' }, NO_EXPECTATION: { word: 'No expected outcome', tone: 'unknown' },
};
export const STATUS_WORD: Record<string, string> = { RESOLVED: 'Resolved', UNRESOLVED: 'Unresolved', OUT_OF_SCOPE: 'Out of scope', SCOPE_UNRESOLVED: 'Scope not known' };
export const factWord = (v: unknown, given = true): string => (!given || v === 'NOT_PROVIDED' ? 'not provided' : v === null ? 'not known' : v === true ? 'yes' : v === false ? 'no' : Array.isArray(v) ? v.join(', ') || 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v));
/** an expectation proposed from what the evaluator returned — NOT confirmed: the person must review it */
export const proposal = (plan: Plan): Expectation => ({
  status: (plan.status === 'ERROR' ? 'UNRESOLVED' : plan.status) as PlanStatus, selected: plan.selected.map((e) => ({ code: e.survey.code, version: e.survey.version, name: e.survey.name })),
  pending: plan.pending.map((e) => e.survey.code), source: 'PROPOSED_FROM_RESULT', confirmed: false,
});
export const stated = (e: Expectation | null | undefined) => { if (!e) return null; const { reviewed_at_revision: _r, ...rest } = e; void _r; return rest; };
