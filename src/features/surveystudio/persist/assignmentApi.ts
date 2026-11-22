// Survey Studio (ASG-1) — survey selection by the existing governed assignment rules, through the generated client
// only. The server decides everything: which rule wins, which survey version it stands for, and the plan.
import { api, unwrap } from '../../../api/client';
import type { components } from '../../../api/generated/schema';
import type { Facts, ServerSimulation } from './simApi';

export type AssignmentPolicy = components['schemas']['SurveyAssignmentPolicy'];
export type AssignmentRule = components['schemas']['SurveyAssignmentRule'];
export type AssignmentBinding = components['schemas']['SurveyAssignmentBinding'];
export type AssignmentEvaluation = components['schemas']['SurveyAssignmentEvaluationOut'];
export type AssignmentInputs = Record<string, string | boolean | string[] | null>;
export interface AssignmentField { field: string; label: string; required: boolean; source: string; values: Array<{ value: string | boolean; label: string }> }

const bid = (binding_id: string) => ({ params: { path: { binding_id } } });
export const getAssignmentOptions = async (): Promise<AssignmentField[]> => unwrap(await api.GET('/api/v1/survey-assignment/options')).fields as unknown as AssignmentField[];
export const getAssignmentPolicy = async (): Promise<AssignmentPolicy> => unwrap(await api.GET('/api/v1/survey-assignment/policy'));
export const proposeBinding = async (body: { rule_code: string; rule_version: number; survey_version_id: string; note: string }): Promise<AssignmentBinding> =>
  unwrap(await api.POST('/api/v1/survey-assignment/bindings', { body }));
export const decideBinding = async (id: string, verdict: 'APPROVE' | 'REJECT', comment: string): Promise<AssignmentBinding> =>
  unwrap(await api.POST('/api/v1/survey-assignment/bindings/{binding_id}/decision', { ...bid(id), body: { verdict, comment } }));
export const publishBinding = async (id: string): Promise<AssignmentBinding> => unwrap(await api.POST('/api/v1/survey-assignment/bindings/{binding_id}/publish', bid(id)));
export const withdrawBinding = async (id: string, reason: string): Promise<AssignmentBinding> =>
  unwrap(await api.POST('/api/v1/survey-assignment/bindings/{binding_id}/withdraw', { ...bid(id), body: { reason } }));
export const evaluateAssignment = async (assignment_inputs: AssignmentInputs, facts: Facts): Promise<AssignmentEvaluation> =>
  unwrap(await api.POST('/api/v1/survey-assignment/evaluations', { body: { assignment_inputs, facts } }));
export const getEvaluation = async (id: string): Promise<AssignmentEvaluation> =>
  unwrap(await api.GET('/api/v1/survey-assignment/evaluations/{evaluation_id}', { params: { path: { evaluation_id: id } } }));
export const simulateEvaluation = async (id: string): Promise<ServerSimulation> =>
  unwrap(await api.POST('/api/v1/survey-assignment/evaluations/{evaluation_id}/simulations', { params: { path: { evaluation_id: id } } }));

// ---- ASG-2A: requirement groups and composite plans (one application, several surveys) -----------------------------
export type AssignmentGroup = components['schemas']['SurveyAssignmentGroup'];
export type CompositePlan = components['schemas']['SurveyCompositePlanOut'];
export type GroupKind = 'PRIMARY' | 'ADD_REQUIRED' | 'ALTERNATIVE';
const gid = (group_id: string) => ({ params: { path: { group_id } } });
/** Every group version in the caller's markets; null when requirement groups are not switched on for this server. */
export const getGroups = async (): Promise<AssignmentGroup[] | null> => {
  const r = await api.GET('/api/v1/survey-assignment/groups');
  if (r.response.status === 404) return null;
  return unwrap(r).groups;
};
export const proposeGroup = async (body: { code: string; kind: GroupKind; name: string; purpose: string; sequence: number | null; members: Array<{ rule_code: string; rule_version: number }>; note: string }): Promise<AssignmentGroup> =>
  unwrap(await api.POST('/api/v1/survey-assignment/groups', { body }));
export const decideGroup = async (id: string, verdict: 'APPROVE' | 'REJECT', comment: string): Promise<AssignmentGroup> =>
  unwrap(await api.POST('/api/v1/survey-assignment/groups/{group_id}/decision', { ...gid(id), body: { verdict, comment } }));
export const publishGroup = async (id: string): Promise<AssignmentGroup> => unwrap(await api.POST('/api/v1/survey-assignment/groups/{group_id}/publish', gid(id)));
export const withdrawGroup = async (id: string, reason: string): Promise<AssignmentGroup> =>
  unwrap(await api.POST('/api/v1/survey-assignment/groups/{group_id}/withdraw', { ...gid(id), body: { reason } }));
export const composePlan = async (assignment_inputs: AssignmentInputs, facts: Facts): Promise<CompositePlan> =>
  unwrap(await api.POST('/api/v1/survey-assignment/composite-plans', { body: { assignment_inputs, facts } }));
export const getCompositePlan = async (id: string): Promise<CompositePlan> =>
  unwrap(await api.GET('/api/v1/survey-assignment/composite-plans/{composite_id}', { params: { path: { composite_id: id } } }));

// ---- ASG-2B: coordinated simulation of the surveys of one composite plan ---------------------------------------------
export type CoordinatedSimulation = components['schemas']['SurveyCoordinatedSimulationOut'];
export const startCoordinated = async (compositeId: string, label = ''): Promise<CoordinatedSimulation> =>
  unwrap(await api.POST('/api/v1/survey-assignment/composite-plans/{composite_id}/coordinated-simulations', { params: { path: { composite_id: compositeId } }, body: { label } }));
export const giveCoordinatedInput = async (co: CoordinatedSimulation, key: string, answer: Record<string, unknown>): Promise<CoordinatedSimulation> =>
  unwrap(await api.POST('/api/v1/survey-assignment/coordinated-simulations/{coordinated_id}/inputs', { params: { path: { coordinated_id: co.id } }, body: { expected_inputs: co.progress.inputs ?? 0, key, answer } }));
export const getCoordinated = async (id: string): Promise<CoordinatedSimulation> =>
  unwrap(await api.GET('/api/v1/survey-assignment/coordinated-simulations/{coordinated_id}', { params: { path: { coordinated_id: id } } }));
