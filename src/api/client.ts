import createClient from 'openapi-fetch';
import type { components, paths } from './generated/schema';
import { apiFetch } from './session';

// Same-origin absolute base URL (the Vite proxy / reverse proxy serves the API on the SPA origin).
export const api = createClient<paths>({ baseUrl: typeof window === 'undefined' ? '' : window.location.origin, fetch: apiFetch });

export type Me = components['schemas']['MeResponse'];
export type AdminUser = components['schemas']['AdminUser'];
export type AuditEvent = components['schemas']['AuditEventOut'];
export type ApiError = components['schemas']['ErrorResponse'];
export type CodeList = components['schemas']['CodeListOut'];
export type CodeListVersion = components['schemas']['CodeListVersionOut'];
export type FeatureFlag = components['schemas']['FeatureFlagOut'];
export type Kpi = components['schemas']['KpiOut'];
export type RiskBucket = components['schemas']['RiskBucket'];
export type AttentionItem = components['schemas']['AttentionItem'];
export type ActivityItem = components['schemas']['ActivityItem'];

export class ApiFailure extends Error {
  constructor(public readonly status: number, public readonly body: Partial<ApiError> | undefined) {
    super(body?.message ?? `Request failed (${status})`);
  }
  get code(): string | undefined {
    return this.body?.code;
  }
}

/** Unwraps an openapi-fetch result, throwing ApiFailure with the server's error envelope. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined && result.response.ok) return result.data;
  throw new ApiFailure(result.response.status, result.error as Partial<ApiError> | undefined);
}
export type CaseRow = components['schemas']['CaseRow'];
export type CaseList = components['schemas']['CaseList'];
export type CaseFacets = components['schemas']['CaseFacets'];
export type WorkQueue = components['schemas']['WorkQueue'];
export type SearchHit = components['schemas']['SearchHit'];
export type CaseQuery = NonNullable<paths['/api/v1/cases']['get']['parameters']['query']>;
export type CaseDetail = components['schemas']['CaseDetail'];
export type Attempt = components['schemas']['AttemptOut'];
export type SessionDetail = components['schemas']['SessionDetail'];
export type SurveyRun = components['schemas']['SurveyRunDetail'];
export type QuestionResult = components['schemas']['QuestionResult'];
export type Finding = components['schemas']['FindingOut'];
export type RiskAssessment = components['schemas']['RiskAssessmentOut'];
export type ScriptAssignment = components['schemas']['ScriptAssignmentOut'];
export type TimelineItem = components['schemas']['TimelineItem'];
export type Hold = components['schemas']['HoldOut'];
export type PolicyRow = components['schemas']['PolicyRow'];
export type PolicyList = components['schemas']['PolicyList'];
export type PolicyQuery = NonNullable<paths['/api/v1/policies']['get']['parameters']['query']>;
export type PolicyDetail = components['schemas']['PolicyDetail'];
export type PolicyCase = components['schemas']['PolicyCaseSummary'];
export type PartyCard = components['schemas']['PartyCard'];
export type SaleSummary = components['schemas']['SaleSummary'];
export type SaleContext = components['schemas']['SaleContext'];
export type PolicyHistory = components['schemas']['PolicyHistory'];
export type Provenance = components['schemas']['Provenance'];
export type FactSnapshot = components['schemas']['FactSnapshotOut'];
export type RiskRow = components['schemas']['RiskRow'];
export type RiskList = components['schemas']['RiskList'];
export type RiskQuery = NonNullable<paths['/api/v1/risk-assessments']['get']['parameters']['query']>;
export type RiskDetail = components['schemas']['RiskAssessmentDetail'];
export type RiskFactorVocabulary = components['schemas']['RiskFactorVocabulary'];
