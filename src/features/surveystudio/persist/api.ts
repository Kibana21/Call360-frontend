// Survey Studio (FI-1) — the survey-definition API, through the generated client only. No hand-written DTO: every type
// here is taken from the backend's OpenAPI (src/api/generated/schema.d.ts).
import { api, unwrap } from '../../../api/client';
import type { components } from '../../../api/generated/schema';
import type { AssetDoc, AssetKind, Doc, DocumentSet } from '../model/documents';

export type SurveySummary = components['schemas']['SurveyOut'];
export type DraftDocuments = components['schemas']['SurveyDraftDocumentsOut'];
export type ServerValidation = components['schemas']['SurveyValidationOut'];
export type ServerFinding = components['schemas']['SurveyFindingOut'];
export type Operation =
  | { op: 'PUT_ASSET'; kind: AssetKind; document: Doc }
  | { op: 'REMOVE_ASSET'; kind: AssetKind; code: string; version: number }
  | { op: 'SET_CONTENT'; content: Doc }
  | { op: 'SET_DETAILS'; name: string; purpose: string };

export const listSurveys = async (): Promise<SurveySummary[]> => unwrap(await api.GET('/api/v1/survey-definitions')).items;
export const createSurvey = async (body: { code: string; name: string; purpose: string }): Promise<SurveySummary> =>
  unwrap(await api.POST('/api/v1/survey-definitions', { body }));
export const loadDraft = async (surveyId: string): Promise<DraftDocuments> =>
  unwrap(await api.GET('/api/v1/survey-definitions/{survey_id}/draft/documents', { params: { path: { survey_id: surveyId } } }));
/** ONE Save: every operation as one revision, or none of them (the server rolls the whole save back on any refusal). */
export const saveDraft = async (surveyId: string, expectedRevision: number, operations: Operation[]): Promise<DraftDocuments> =>
  unwrap(await api.POST('/api/v1/survey-definitions/{survey_id}/draft/save', { params: { path: { survey_id: surveyId } }, body: { expected_revision: expectedRevision, operations: operations as unknown as Array<Record<string, unknown>> } }));
export const validateDraft = async (surveyId: string): Promise<ServerValidation> =>
  unwrap(await api.POST('/api/v1/survey-definitions/{survey_id}/draft/validate', { params: { path: { survey_id: surveyId } } }));

/** The server's draft as a document set, with what the server says about each asset. */
export function documentsOf(d: DraftDocuments): { set: DocumentSet; frozen: Set<string>; owned: Set<string>; hashes: Map<string, string> } {
  const assets: AssetDoc[] = d.assets.map((a) => ({ kind: a.kind as AssetKind, code: a.code, version: a.version, document: a.document as Doc }));
  const key = (a: { kind: string; code: string; version: number }) => `${a.kind}:${a.code}@${a.version}`;
  return {
    set: { content: d.content as Doc, assets },
    frozen: new Set(d.assets.filter((a) => a.state === 'FROZEN').map(key)),
    owned: new Set(d.assets.filter((a) => a.owned).map(key)),
    hashes: new Map(d.assets.map((a) => [key(a), a.sha256])),
  };
}

// ---- LIB-1: the component library and server-issued codes -------------------------------------------------------------
export type ComponentKind = 'MODULE' | 'ITEM' | 'CONDITION' | 'OPTION_SET';
export type Component = components['schemas']['SurveyComponentOut'];
export type ComponentDetail = components['schemas']['SurveyComponentDetail'];
export const listComponents = async (kind: ComponentKind, q = ''): Promise<Component[]> =>
  unwrap(await api.GET('/api/v1/survey-components', { params: { query: { kind, q } } })).items;
export const getComponent = async (kind: ComponentKind, code: string, version: number, wordingVersion?: number | null): Promise<ComponentDetail> =>
  unwrap(await api.GET('/api/v1/survey-components/{kind}/{code}/{version}', { params: { path: { kind, code, version }, query: wordingVersion ? { wording_version: wordingVersion } : {} } }));
/** New permanent codes, issued by the server to this survey. The editor's own numbering never becomes permanent. */
export const issueCodes = async (surveyId: string, requests: Array<{ kind: 'MODULE' | 'ITEM' | 'STATEMENT' | 'CONDITION' | 'OPTION_SET'; count: number }>): Promise<Array<{ kind: string; code: string }>> =>
  unwrap(await api.POST('/api/v1/survey-definitions/{survey_id}/codes', { params: { path: { survey_id: surveyId } }, body: { requests } })).codes;
/** Whether the library is switched on for this server: with it off its routes do not exist. */
export const libraryAvailable = async (): Promise<boolean> => {
  const r = await api.GET('/api/v1/survey-components', { params: { query: { kind: 'MODULE', q: '' } } });
  return r.response.ok;
};
