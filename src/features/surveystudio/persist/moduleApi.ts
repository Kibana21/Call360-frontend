// Survey Studio (LIB-2) — reusable modules authored on their own, through the generated client only.
// A standalone module is created here; from then on it is saved, validated, submitted, reviewed and published by the
// SAME operations as a survey, addressed by the module's id (persist/api.ts, reviewApi.ts). The test operation runs one
// module with the authoritative Python engine and records nothing; this file fetches its result and decides nothing.
import { api, unwrap } from '../../../api/client';
import type { components } from '../../../api/generated/schema';
import type { SimAnswer } from '../model/sim';
import type { Facts } from './simApi';
import { type Maybe, softly } from './workspaceApi';

export type ModuleSummary = components['schemas']['SurveyModuleOut'];
export type ModuleTest = components['schemas']['SurveyModuleTestOut'];
export interface TestInput { key: string; answer: SimAnswer }
/** What a test runs: a standalone module's working draft (or one of its revisions), or any PUBLISHED module. */
export type TestTarget = { moduleId: string; revision?: number } | { code: string; revision: number };

/** The standalone modules of the reader's markets, drafts included. `unavailable: OFF` when the server does not offer them. */
export const listModules = (): Promise<Maybe<ModuleSummary[]>> => softly(async () => unwrap(await api.GET('/api/v1/survey-modules')).items);
export const getModule = (id: string): Promise<Maybe<ModuleSummary>> =>
  softly(async () => unwrap(await api.GET('/api/v1/survey-modules/{module_id}', { params: { path: { module_id: id } } })));
export const createModule = async (body: { name: string; description: string }): Promise<ModuleSummary> => unwrap(await api.POST('/api/v1/survey-modules', { body }));
export const testModule = async (target: TestTarget, facts: Facts, inputs: TestInput[]): Promise<ModuleTest> =>
  unwrap(await api.POST('/api/v1/survey-module-tests', {
    body: { ...('moduleId' in target ? { module_id: target.moduleId, ...(target.revision ? { revision: target.revision } : {}) } : { code: target.code, revision: target.revision }), facts, inputs: inputs.map((i) => ({ key: i.key, answer: i.answer as Record<string, unknown> })) },
  }));
