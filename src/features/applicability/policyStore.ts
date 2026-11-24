// Survey Applicability (APPL-X3) — what the SERVER holds for each saved policy, kept outside React so that the
// evaluation calls (api.ts) and the tab's store can both ask: is this document the saved one, or an unsaved edit?
// Nothing here decides anything about applicability.
import type { components } from '../../api/generated/schema';
import { applicabilityPolicies } from './flag';
import { same } from './model/describe';
import type { Policy } from './model/types';

export type ServerPolicy = components['schemas']['ApplicabilityPolicy'];
export type Inspection = components['schemas']['ApplicabilityPolicyInspection'];
export interface Dependency {
  kind: 'VARIABLE' | 'PROFILE' | 'CONDITION' | 'SURVEY'; code: string; name: string; state: 'PUBLISHED' | 'DRAFT';
  version_no?: number; version_id?: string; draft_revision?: number; content_sha256: string; manifest_sha256?: string; label?: string;
  stale?: boolean; current_draft_revision?: number | null; published_version_no?: number; newer_version_no?: number;
}
export interface Saved { id: string; code: string; revision: number; document: Record<string, unknown>; updatedBy: string | null; updatedAt: string; snapshotSha: string; documentSha: string }

const saved = new Map<string, Saved>();
export const policiesOn = (): boolean => applicabilityPolicies();
export const savedPolicy = (code: string): Saved | undefined => (policiesOn() ? saved.get(code) : undefined);
export const rememberSaved = (p: ServerPolicy) => saved.set(p.code, { id: p.id, code: p.code, revision: p.draft_revision, document: p.document, updatedBy: p.updated_by, updatedAt: p.updated_at, snapshotSha: p.snapshot_sha256, documentSha: p.document_sha256 });
export const forgetSaved = (code?: string) => { if (code) saved.delete(code); else saved.clear(); };

const OWN = ['code', 'market', 'version', 'status'];
/** The document as it is stored: the policy's own fields. Market and code are the row's and never change. */
export const toServer = (p: Policy): Record<string, unknown> => Object.fromEntries(Object.entries(p as unknown as Record<string, unknown>).filter(([k]) => !OWN.includes(k)));
/** The stored document as the designer edits it. */
export const toClient = (p: Pick<ServerPolicy, 'code' | 'market_code' | 'document'>): Policy => ({ description: '', profiles: [], scope: null, shared_deliveries: [], requirements: [], order: [], pins: [], ...(p.document as object), code: p.code, market: p.market_code, version: 1, status: 'DRAFT' } as unknown as Policy);
/** Whether what is in the tab differs from what is saved (key order does not matter). */
export const isUnsaved = (p: Policy): boolean => { const s = savedPolicy(p.code); return !!s && !same(toServer(p), s.document); };
