// Survey Studio (EVAL-1) — journey-level control evaluation of simulations, through the generated client only.
// The server evaluates: answers by the existing deterministic evaluator, findings by the published finding rules.
import { api, ApiFailure, unwrap } from '../../../api/client';
import type { components } from '../../../api/generated/schema';

export type JourneyEvaluation = components['schemas']['SurveyJourneyEvaluationOut'];
export type JourneyEvaluationRef = components['schemas']['SurveyJourneyEvaluationRef'];
export type Journey = { simulationId: string } | { coordinatedId: string };

const query = (j: Journey) => ('simulationId' in j ? { simulation_id: j.simulationId } : { coordinated_simulation_id: j.coordinatedId });
export const getEvaluation = async (id: string): Promise<JourneyEvaluation> =>
  unwrap(await api.GET('/api/v1/survey-evaluation/evaluations/{evaluation_id}', { params: { path: { evaluation_id: id } } }));
/** null when evaluation is not switched on for this server (the operations do not exist there). */
export const listEvaluations = async (j: Journey): Promise<JourneyEvaluationRef[] | null> => {
  try {
    return unwrap(await api.GET('/api/v1/survey-evaluation/evaluations', { params: { query: query(j) } })).items;
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null;
    throw e;
  }
};
export const evaluateJourney = async (j: Journey): Promise<JourneyEvaluation> =>
  unwrap(await api.POST('/api/v1/survey-evaluation/evaluations', { body: query(j) }));

// ---- EVAL-2A: governed control policies, applicability, coverage, and the mappings of EVAL-1 ------------------------
export type ControlPolicy = components['schemas']['SurveyControlPolicy'];
export type ControlPolicyIn = components['schemas']['SurveyControlPolicyIn'];
export type ControlMapping = components['schemas']['SurveyControlMapping'];
export type RegisterControl = components['schemas']['SurveyControl'];
export type BuilderOptions = components['schemas']['SurveyBuilderOptions'];
export type BuilderItem = components['schemas']['SurveyBuilderItem'];
export type BuilderCondition = components['schemas']['SurveyBuilderCondition'];
export type Applicability = components['schemas']['SurveyControlApplicabilityOut'];
export type EvaluationPreview = components['schemas']['SurveyEvaluationPreviewOut'];
export type JourneyRef = components['schemas']['SurveyEvaluationJourney'];
type J = Record<string, unknown>;

const pid = (policy_id: string) => ({ params: { path: { policy_id } } });
const mid = (mapping_id: string) => ({ params: { path: { mapping_id } } });
/** null when control policies are not switched on for this server. */
const orNull = async <T,>(work: () => Promise<T>): Promise<T | null> => { try { return await work(); } catch (e) { if (e instanceof ApiFailure && e.status === 404) return null; throw e; } };
export const getRegister = async (): Promise<RegisterControl[]> => unwrap(await api.GET('/api/v1/survey-evaluation/controls')).items;
export const listMappings = async (): Promise<ControlMapping[]> => unwrap(await api.GET('/api/v1/survey-evaluation/mappings')).items;
export const proposeMapping = async (body: J): Promise<ControlMapping> => unwrap(await api.POST('/api/v1/survey-evaluation/mappings', { body: body as never }));
export const decideMapping = async (id: string, verdict: 'APPROVE' | 'REJECT', comment = ''): Promise<ControlMapping> => unwrap(await api.POST('/api/v1/survey-evaluation/mappings/{mapping_id}/decision', { ...mid(id), body: { verdict, comment } }));
export const publishMapping = async (id: string): Promise<ControlMapping> => unwrap(await api.POST('/api/v1/survey-evaluation/mappings/{mapping_id}/publish', mid(id)));
export const listPolicies = (): Promise<ControlPolicy[] | null> => orNull(async () => unwrap(await api.GET('/api/v1/survey-evaluation/control-policies')).items);
export const getPolicy = async (id: string): Promise<ControlPolicy> => unwrap(await api.GET('/api/v1/survey-evaluation/control-policies/{policy_id}', pid(id)));
export const proposePolicy = async (body: ControlPolicyIn): Promise<ControlPolicy> => unwrap(await api.POST('/api/v1/survey-evaluation/control-policies', { body }));
export const decidePolicy = async (id: string, verdict: 'APPROVE' | 'REJECT', comment = ''): Promise<ControlPolicy> => unwrap(await api.POST('/api/v1/survey-evaluation/control-policies/{policy_id}/decision', { ...pid(id), body: { verdict, comment } }));
export const publishPolicy = async (id: string): Promise<ControlPolicy> => unwrap(await api.POST('/api/v1/survey-evaluation/control-policies/{policy_id}/publish', pid(id)));
export const withdrawPolicy = async (id: string, reason: string): Promise<ControlPolicy> => unwrap(await api.POST('/api/v1/survey-evaluation/control-policies/{policy_id}/withdraw', { ...pid(id), body: { reason } }));
export const getBuilderOptions = (): Promise<BuilderOptions | null> => orNull(async () => unwrap(await api.GET('/api/v1/survey-evaluation/builder-options')));
export const listJourneys = async (): Promise<JourneyRef[]> => unwrap(await api.GET('/api/v1/survey-evaluation/journeys')).items;
export const checkApplicability = async (policy: ControlPolicyIn | string, facts: J): Promise<Applicability> =>
  unwrap(await api.POST('/api/v1/survey-evaluation/applicability', { body: typeof policy === 'string' ? { control_policy_id: policy, facts } : { policy, facts } }));
export const previewEvaluation = async (j: Journey, policyId: string | null, mappings: J[]): Promise<EvaluationPreview> =>
  unwrap(await api.POST('/api/v1/survey-evaluation/evaluations/preview', { body: { ...query(j), control_policy_id: policyId, mappings } }));
export const evaluateUnder = async (j: Journey, policyId: string | null): Promise<JourneyEvaluation> =>
  unwrap(await api.POST('/api/v1/survey-evaluation/evaluations', { body: { ...query(j), control_policy_id: policyId } }));

// ---- EVAL-2B: execution assurance — whether the RECORDED execution of a simulated journey followed what it pinned ----
export type ExecutionAssurance = components['schemas']['SurveyExecutionAssuranceOut'];
export type ExecutionAssuranceRef = components['schemas']['SurveyExecutionAssuranceRef'];
/** null when execution assurance is not switched on for this server. */
export const listAssurance = (j: Journey): Promise<ExecutionAssuranceRef[] | null> =>
  orNull(async () => unwrap(await api.GET('/api/v1/survey-evaluation/assurance', { params: { query: query(j) } })).items);
export const getAssurance = async (id: string): Promise<ExecutionAssurance> =>
  unwrap(await api.GET('/api/v1/survey-evaluation/assurance/{assurance_id}', { params: { path: { assurance_id: id } } }));
export const createAssurance = async (j: Journey, evaluationId: string | null): Promise<ExecutionAssurance> =>
  unwrap(await api.POST('/api/v1/survey-evaluation/assurance', { body: { ...query(j), evaluation_id: evaluationId } }));

// ---- E2E-1: one journey's records as one chain, from the application to its execution assurance. Read-only. ----------
export type JourneyTrace = components['schemas']['SurveyJourneyTraceOut'];
export type JourneyTraceLink = components['schemas']['SurveyJourneyTraceLink'];
export type TraceKind = 'coordinated' | 'survey' | 'application';
/** null when the journey view is not switched on for this server, or the journey is not available to you. */
export const getJourneyTrace = (kind: TraceKind, id: string, evaluationId?: string | null): Promise<JourneyTrace | null> =>
  orNull(async () => unwrap(await api.GET('/api/v1/survey-evaluation/journey-trace', { params: { query: {
    ...(kind === 'coordinated' ? { coordinated_simulation_id: id } : kind === 'survey' ? { simulation_id: id } : { composite_plan_id: id }),
    ...(evaluationId ? { evaluation_id: evaluationId } : {}),
  } } })));
