// Survey Studio (SS-03B) — SIMULATION of published survey versions on the Call360 server, through the generated client
// only. The Python engine is the authority: this file fetches its results and decides nothing.
import { api, unwrap } from '../../../api/client';
import type { components } from '../../../api/generated/schema';
import type { SimAnswer } from '../model/sim';

export type ServerSimulation = components['schemas']['SurveySimulationOut'];
export type ServerCallPlan = components['schemas']['SurveyCallPlanOut'];
export type Facts = Record<string, string | number | boolean | null>;

export const createSimulation = async (versionId: string, facts: Facts, label = ''): Promise<ServerSimulation> =>
  unwrap(await api.POST('/api/v1/survey-versions/{version_id}/simulations', { params: { path: { version_id: versionId } }, body: { facts, label } }));
export const giveInput = async (sim: ServerSimulation, key: string, answer: SimAnswer): Promise<ServerSimulation> =>
  unwrap(await api.POST('/api/v1/survey-simulations/{simulation_id}/inputs', { params: { path: { simulation_id: sim.id } }, body: { expected_inputs: sim.inputs.length, key, answer: answer as Record<string, unknown> } }));
export const getSimulation = async (id: string): Promise<ServerSimulation> =>
  unwrap(await api.GET('/api/v1/survey-simulations/{simulation_id}', { params: { path: { simulation_id: id } } }));
export const createCallPlan = async (versionId: string, facts: Facts): Promise<ServerCallPlan> =>
  unwrap(await api.POST('/api/v1/survey-versions/{version_id}/call-plans', { params: { path: { version_id: versionId } }, body: { facts } }));
export const getCallPlan = async (id: string): Promise<ServerCallPlan> =>
  unwrap(await api.GET('/api/v1/survey-call-plans/{plan_id}', { params: { path: { plan_id: id } } }));
