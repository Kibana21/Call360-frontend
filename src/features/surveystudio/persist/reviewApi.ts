// Survey Studio (FI-2) — review and publication on the real candidates of the survey-definition API, through the
// generated client only. Nothing here decides anything: every rule is the server's.
import { api, unwrap } from '../../../api/client';
import type { components } from '../../../api/generated/schema';

export type SurveyHistory = components['schemas']['SurveyHistoryOut'];
export type CandidateDocuments = components['schemas']['SurveyCandidateDocumentsOut'];
export type CandidateAsset = components['schemas']['SurveyCandidateAsset'];
export type SurveyVersion = components['schemas']['SurveyVersionOut'];
export interface AcknowledgementIn { code: string; at: string; reason: string }

const cand = (candidate_id: string) => ({ params: { path: { candidate_id } } });
export const getHistory = async (surveyId: string): Promise<SurveyHistory> =>
  unwrap(await api.GET('/api/v1/survey-definitions/{survey_id}/history', { params: { path: { survey_id: surveyId } } }));
export const submitCandidate = async (surveyId: string, body: { note: string; acknowledgements: AcknowledgementIn[] }) =>
  unwrap(await api.POST('/api/v1/survey-definitions/{survey_id}/candidates', { params: { path: { survey_id: surveyId } }, body: { note: body.note, acknowledgements: body.acknowledgements as unknown as Array<Record<string, unknown>> } }));
export const getCandidateDocuments = async (candidateId: string): Promise<CandidateDocuments> =>
  unwrap(await api.GET('/api/v1/survey-candidates/{candidate_id}/documents', cand(candidateId)));
export const decideCandidate = async (candidateId: string, verdict: 'APPROVE' | 'REJECT', comment: string) =>
  unwrap(await api.POST('/api/v1/survey-candidates/{candidate_id}/decision', { ...cand(candidateId), body: { verdict, comment } }));
export const withdrawCandidate = async (candidateId: string, reason: string) =>
  unwrap(await api.POST('/api/v1/survey-candidates/{candidate_id}/withdraw', { ...cand(candidateId), body: { reason } }));
export const publishCandidate = async (candidateId: string): Promise<SurveyVersion> =>
  unwrap(await api.POST('/api/v1/survey-candidates/{candidate_id}/publish', { ...cand(candidateId), body: {} }));
export const getVersion = async (versionId: string): Promise<SurveyVersion> =>
  unwrap(await api.GET('/api/v1/survey-versions/{version_id}', { params: { path: { version_id: versionId } } }));

export const STATUS_LABEL: Record<string, string> = { IN_REVIEW: 'In review', APPROVED: 'Approved', REJECTED: 'Sent back', WITHDRAWN: 'Withdrawn', SUPERSEDED: 'Superseded', PUBLISHED: 'Published', SCHEDULED: 'Scheduled' };
export const EVENT_LABEL: Record<string, string> = { SUBMITTED: 'Submitted for review', APPROVED: 'Approved', REJECTED: 'Sent back', WITHDRAWN: 'Withdrawn', SUPERSEDED: 'Superseded by a newer one', PUBLISHED: 'Published', SCHEDULED: 'Scheduled' };
/** Why the identity rules refuse — the server's own codes, in a sentence. A permission never overrides these. */
export const RULE_TEXT: Record<string, string> = {
  SELF_REVIEW_DENIED: 'You are one of the people who made this candidate. A maker cannot approve or send back their own work, whatever permissions they hold.',
  SELF_PUBLISH_DENIED: 'You are one of the people who made this candidate. A maker cannot publish their own work, whatever permissions they hold.',
  APPROVER_PUBLISH_DENIED: 'You approved this candidate. The person who approves cannot also publish it: a third person must.',
  NOT_IN_REVIEW: 'This candidate is not waiting for a decision.',
  NOT_APPROVED: 'Only an approved candidate can be published.',
  NOT_SUBMITTER: 'Only the person who submitted a candidate can withdraw it.',
  NOT_OPEN: 'This candidate is closed.',
  MANIFEST_MISMATCH: 'The candidate does not match the versions it pins: it has been changed outside Call360. It cannot be approved or published.',
  ALREADY_DECIDED: 'This candidate has already been decided.',
};
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const short = (sha: string) => `${sha.slice(0, 12)}…`;
