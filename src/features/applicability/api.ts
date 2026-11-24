// Survey Applicability (APPL-X1) — every evaluation is done by the Python evaluator, through the generated client.
// These four operations are stateless: the documents travel in the request and nothing is stored. This file fetches
// results; it decides nothing.
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../api/client';
import { isUnsaved, savedPolicy, toServer, type Inspection } from './policyStore';
import type { Comparison, Data, Diagnostic, EvalRow, Expr, FactState, Facts, Need, Plan, Policy, Scenario, Trace, Tri } from './model/types';

const BASE = '/api/v1/survey-applicability/prototype';
type Body = Record<string, unknown>;
const workspaceOf = (d: Data): Body => ({ variables: d.variables, profiles: d.profiles, conditions: d.conditions });
const call = async <T,>(path: 'evaluate' | 'condition-test' | 'analyse' | 'scenarios', body: Body): Promise<T> =>
  // the request bodies are the canonical documents of model/types.ts; the generated client types them as open objects
  (unwrap(await api.POST(`${BASE}/${path}` as '/api/v1/survey-applicability/prototype/evaluate', { body: body as never })) as unknown as { result: T }).result;

export interface EvaluateResult {
  policy_fingerprint: string | null; results: EvalRow[];
  /** APPL-X3. SAVED: the stored revision, evaluated by the server from exactly what it pins. PREVIEW: an unsaved edit —
      a what-if. Absent for a policy that lives in the tab. */
  source?: 'SAVED' | 'PREVIEW'; run_status?: 'OK' | 'DEPENDENCY_STALE' | 'INVALID_DEPENDENCY'; revision?: number; snapshot?: string; reason?: string;
}
export interface ConditionResult { status: 'OK' | 'INVALID' | 'ERROR'; result?: Tri; trace?: Trace; needs?: Need[]; facts?: FactState[]; diagnostics: Diagnostic[]; error?: { code: string; message: string } }
export interface AnalyseResult { status: 'OK' | 'BLOCKED' | 'ERROR'; blockers?: number; diagnostics: Diagnostic[]; policy_fingerprint?: string | null; policy_variables?: string[]; error?: { code: string; message: string }; inspection?: Inspection }
export interface Coverage { checked: boolean; exhaustive?: boolean; variables?: { code: string; name: string }[]; combinations_examined?: number; distinct_results?: number; shown?: number; not_covered?: string[]; reason?: string; requirements?: { id: string; name: string; outcomes: string[]; never_active: boolean }[] }
export interface GenerateResult { status: string; scenarios: Scenario[]; coverage: Coverage }

/** A policy the evaluator refuses (a circle of replacements, say) comes back with an error and no plan parts: give
    every reader the same shape, so the screen shows the error instead of failing. */
const EMPTY = { status: 'ERROR', requirements: [], selected: [], pending: [], excluded: [], needs: [], explanation: [], facts: {}, diagnostics: [] } as unknown as Plan;
const whole = (p: Plan | undefined): Plan => Object.assign({}, EMPTY, p ?? {});
export const evaluate = async (d: Data, policy: Policy, scenarios: Pick<Scenario, 'id' | 'facts' | 'profiles'>[], compareWith?: Policy | null): Promise<EvaluateResult> => {
  const kept = savedPolicy(policy.code);
  if (kept) {
    // a saved policy is evaluated BY THE SERVER from what it pins; an unsaved edit is a preview and is marked as one
    const body = scenarios.map((x) => ({ id: x.id, facts: x.facts, profiles: x.profiles?.length ? x.profiles : null }));
    const params = { path: { policy_id: kept.id } };
    const r = isUnsaved(policy)
      ? unwrap(await api.POST('/api/v1/applicability/policies/{policy_id}/preview', { params, body: { document: toServer(policy), scenarios: body, compare_with_saved: !!compareWith } }))
      : unwrap(await api.POST('/api/v1/applicability/policies/{policy_id}/evaluate', { params, body: { scenarios: body } }));
    const reason = ((r.reasons ?? [])[0] as { message?: string } | undefined)?.message;
    const rows: EvalRow[] = r.status === 'OK' ? (r.results as unknown as EvalRow[]) : scenarios.map((x) => ({ scenario: x.id, plan: { status: 'ERROR', error: { code: r.status, message: reason ?? 'It cannot be evaluated until its dependencies are reconciled.' } } as unknown as Plan }));
    return { policy_fingerprint: r.policy_fingerprint, source: r.source, run_status: r.status, revision: r.draft_revision, snapshot: r.snapshot_sha256, reason, results: rows.map((x) => ({ ...x, plan: whole(x.plan), before: x.before ? whole(x.before) : undefined })) };
  }
  const r = await evaluateRaw(d, policy, scenarios, compareWith);
  return { ...r, results: r.results.map((x) => ({ ...x, plan: whole(x.plan), before: x.before ? whole(x.before) : undefined })) };
};
const evaluateRaw = (d: Data, policy: Policy, scenarios: Pick<Scenario, 'id' | 'facts' | 'profiles'>[], compareWith?: Policy | null) =>
  call<EvaluateResult>('evaluate', { workspace: workspaceOf(d), policy, scenarios: scenarios.map((s) => ({ id: s.id, facts: s.facts, profiles: s.profiles?.length ? s.profiles : null })), compare_with: compareWith ?? null });
export const testCondition = (d: Data, expr: Expr, facts: Facts, profiles?: string[]) =>
  call<ConditionResult>('condition-test', { workspace: workspaceOf(d), expr, facts, profiles: profiles?.length ? profiles : null });
/** What each requirement depends on is reported per requirement, so that a card can show its own. */
const perRequirement = (list: Diagnostic[]): Diagnostic[] => list.flatMap((x) => { const reqs = (x.at?.requirements as string[] | undefined)?.filter((r) => r !== 'policy' && r !== 'scope'); return reqs?.length ? reqs.map((r) => ({ ...x, at: { ...x.at, requirement: r, dependency: true } })) : [{ ...x, at: { ...x.at, dependency: !!x.at?.requirements } }]; });
export const analyse = async (d: Data, policy?: Policy | null): Promise<AnalyseResult> => {
  const kept = policy ? savedPolicy(policy.code) : undefined;
  if (policy && kept) {
    // for a saved policy the SERVER inspects the document: its pins, every dependency and its state, and the evaluator's analysis
    const i = unwrap(await api.POST('/api/v1/applicability/policies/{policy_id}/inspect', { params: { path: { policy_id: kept.id } }, body: { document: toServer(policy) } }));
    return { status: i.blockers ? 'BLOCKED' : 'OK', blockers: i.blockers, diagnostics: perRequirement(i.diagnostics as unknown as Diagnostic[]), policy_fingerprint: i.policy_fingerprint, policy_variables: i.dependencies.filter((x) => x.kind === 'VARIABLE').map((x) => String(x.code)), inspection: i };
  }
  return call<AnalyseResult>('analyse', { workspace: workspaceOf(d), policy: policy ?? null });
};
export const generate = async (d: Data, policy: Policy, limit = 40) => {
  const kept = savedPolicy(policy.code);
  // scenario generation stays a stateless what-if (scenarios are not saved yet), but on the definitions the policy PINS
  const workspace = kept ? (await analyse(d, policy)).inspection?.workspace ?? workspaceOf(d) : workspaceOf(d);
  return call<GenerateResult>('scenarios', { workspace, policy, limit });
};

// ---- live results: re-asked whenever the documents change; the previous answer stays on screen meanwhile
const key = (...parts: unknown[]) => JSON.stringify(parts);
const live = { staleTime: 60_000, placeholderData: <T,>(prev: T | undefined) => prev, retry: false } as const;
const defs = (d: Data) => [d.variables, d.profiles, d.conditions];

export function useEvaluation(d: Data, policy: Policy | null | undefined, scenarios: Scenario[], compareWith?: Policy | null) {
  return useQuery({ queryKey: ['appl-eval', key(defs(d), policy, scenarios.map((s) => [s.id, s.facts, s.profiles]), compareWith ?? null, policy ? [savedPolicy(policy.code)?.revision, isUnsaved(policy)] : null)], enabled: !!policy && scenarios.length > 0, queryFn: () => evaluate(d, policy!, scenarios, compareWith), ...live });
}
export function useConditionTest(d: Data, expr: Expr | null, facts: Facts, profiles?: string[]) {
  return useQuery({ queryKey: ['appl-cond', key(defs(d), expr, facts, profiles ?? null)], enabled: !!expr, queryFn: () => testCondition(d, expr!, facts, profiles), ...live });
}
export function useAnalysis(d: Data, policy?: Policy | null) {
  return useQuery({ queryKey: ['appl-analyse', key(defs(d), policy ?? null, policy ? savedPolicy(policy.code)?.revision : null)], queryFn: () => analyse(d, policy), ...live });
}
export type { Comparison, Plan };
