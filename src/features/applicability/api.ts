// Survey Applicability (APPL-X1) — every evaluation is done by the Python evaluator, through the generated client.
// These four operations are stateless: the documents travel in the request and nothing is stored. This file fetches
// results; it decides nothing.
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../api/client';
import type { Comparison, Data, Diagnostic, EvalRow, Expr, FactState, Facts, Need, Plan, Policy, Scenario, Trace, Tri } from './model/types';

const BASE = '/api/v1/survey-applicability/prototype';
type Body = Record<string, unknown>;
const workspaceOf = (d: Data): Body => ({ variables: d.variables, profiles: d.profiles, conditions: d.conditions });
const call = async <T,>(path: 'evaluate' | 'condition-test' | 'analyse' | 'scenarios', body: Body): Promise<T> =>
  // the request bodies are the canonical documents of model/types.ts; the generated client types them as open objects
  (unwrap(await api.POST(`${BASE}/${path}` as '/api/v1/survey-applicability/prototype/evaluate', { body: body as never })) as unknown as { result: T }).result;

export interface EvaluateResult { policy_fingerprint: string | null; results: EvalRow[] }
export interface ConditionResult { status: 'OK' | 'INVALID' | 'ERROR'; result?: Tri; trace?: Trace; needs?: Need[]; facts?: FactState[]; diagnostics: Diagnostic[]; error?: { code: string; message: string } }
export interface AnalyseResult { status: 'OK' | 'BLOCKED' | 'ERROR'; blockers?: number; diagnostics: Diagnostic[]; policy_fingerprint?: string | null; policy_variables?: string[]; error?: { code: string; message: string } }
export interface Coverage { checked: boolean; exhaustive?: boolean; variables?: { code: string; name: string }[]; combinations_examined?: number; distinct_results?: number; shown?: number; not_covered?: string[]; reason?: string; requirements?: { id: string; name: string; outcomes: string[]; never_active: boolean }[] }
export interface GenerateResult { status: string; scenarios: Scenario[]; coverage: Coverage }

export const evaluate = (d: Data, policy: Policy, scenarios: Pick<Scenario, 'id' | 'facts' | 'profiles'>[], compareWith?: Policy | null) =>
  call<EvaluateResult>('evaluate', { workspace: workspaceOf(d), policy, scenarios: scenarios.map((s) => ({ id: s.id, facts: s.facts, profiles: s.profiles?.length ? s.profiles : null })), compare_with: compareWith ?? null });
export const testCondition = (d: Data, expr: Expr, facts: Facts, profiles?: string[]) =>
  call<ConditionResult>('condition-test', { workspace: workspaceOf(d), expr, facts, profiles: profiles?.length ? profiles : null });
export const analyse = (d: Data, policy?: Policy | null) => call<AnalyseResult>('analyse', { workspace: workspaceOf(d), policy: policy ?? null });
export const generate = (d: Data, policy: Policy, limit = 40) => call<GenerateResult>('scenarios', { workspace: workspaceOf(d), policy, limit });

// ---- live results: re-asked whenever the documents change; the previous answer stays on screen meanwhile
const key = (...parts: unknown[]) => JSON.stringify(parts);
const live = { staleTime: 60_000, placeholderData: <T,>(prev: T | undefined) => prev, retry: false } as const;
const defs = (d: Data) => [d.variables, d.profiles, d.conditions];

export function useEvaluation(d: Data, policy: Policy | null | undefined, scenarios: Scenario[], compareWith?: Policy | null) {
  return useQuery({ queryKey: ['appl-eval', key(defs(d), policy, scenarios.map((s) => [s.id, s.facts, s.profiles]), compareWith ?? null)], enabled: !!policy && scenarios.length > 0, queryFn: () => evaluate(d, policy!, scenarios, compareWith), ...live });
}
export function useConditionTest(d: Data, expr: Expr | null, facts: Facts, profiles?: string[]) {
  return useQuery({ queryKey: ['appl-cond', key(defs(d), expr, facts, profiles ?? null)], enabled: !!expr, queryFn: () => testCondition(d, expr!, facts, profiles), ...live });
}
export function useAnalysis(d: Data, policy?: Policy | null) {
  return useQuery({ queryKey: ['appl-analyse', key(defs(d), policy ?? null)], queryFn: () => analyse(d, policy), ...live });
}
export type { Comparison, Plan };
