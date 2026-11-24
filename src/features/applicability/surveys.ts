// Survey Applicability (APPL-X1R) — the survey catalogue IS Survey Studio's: the published versions its own API
// lists, read through the generated client. Nothing is typed in or invented here, and a draft never appears. Each
// entry carries the exact published identity (version id, content and manifest fingerprints).
import { useEffect, useState } from 'react';
import { listSurveys } from '../surveystudio/persist/api';
import { api, unwrap } from '../../api/client';
import { missing, softly, versionRecord } from '../surveystudio/persist/workspaceApi';
import type { SurveyRef } from './model/types';

export type CatalogueState = { status: 'loading' | 'ready' | 'unavailable'; surveys: SurveyRef[]; total: number; reason?: string };
type Any = Record<string, unknown>;

/** Every survey of the reader's markets that has a PUBLISHED version, with that version's identity. */
export async function publishedSurveys(): Promise<{ surveys: SurveyRef[]; total: number }> {
  const all = await listSurveys();
  const published = all.filter((s) => s.latest_version_id);
  const rows = await Promise.all(published.map(async (s): Promise<SurveyRef | null> => {
    const v = await versionRecord(s.latest_version_id!);
    if (missing(v) || (v as Any).status !== 'PUBLISHED') return null;
    const r = v as Any;
    return {
      code: s.code, name: s.name, summary: s.purpose, market: s.market_code, definition_id: s.id, version_id: String(r.id),
      version: Number(r.version_no), label: String(r.label ?? s.latest_version_label ?? r.version_no),
      fingerprint: String(r.content_sha256), manifest: String(r.manifest_sha256), published_at: String(r.created_at ?? ''),
    };
  }));
  return { surveys: rows.filter((x): x is SurveyRef => !!x).sort((a, b) => a.name.localeCompare(b.name)), total: all.length };
}
export function usePublishedSurveys(adopt: (list: SurveyRef[]) => void): CatalogueState & { reload: () => void } {
  const [state, setState] = useState<CatalogueState>({ status: 'loading', surveys: [], total: 0 });
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    let live = true;
    publishedSurveys().then((r) => { if (!live) return; adopt(r.surveys); setState({ status: 'ready', ...r }); })
      .catch((e: unknown) => { if (live) { adopt([]); setState({ status: 'unavailable', surveys: [], total: 0, reason: e instanceof Error ? e.message : 'Survey Studio could not be read' }); } });
    return () => { live = false; };
  // read when the workspace opens and again when the person asks ("Read again"); a reference already pinned never moves
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn]);
  return { ...state, reload: () => setTurn((n) => n + 1) };
}

export interface PublishedDetail { record: Any | null; content: Any | null; assets: Any[]; events: { event: string; who: string; at: string; reason?: string }[] }
/** The published content of one version, and who submitted, approved and published it. */
export async function publishedDetail(s: SurveyRef): Promise<PublishedDetail> {
  if (!s.version_id) return { record: null, content: null, assets: [], events: [] };
  const record = await versionRecord(s.version_id);
  const rec = missing(record) ? null : (record as Any);
  // the documents of a published version are those of the immutable candidate it was published from
  let docs: Any | null = null;
  if (rec?.candidate_id) {
    const r = await softly(async () => unwrap(await api.GET('/api/v1/survey-candidates/{candidate_id}/documents', { params: { path: { candidate_id: String(rec.candidate_id) } } })));
    docs = missing(r) ? null : (r as unknown as Any);
  }
  const history = [...((docs?.history as Any[]) ?? []), ...((rec?.history as Any[]) ?? [])];
  const seen = new Set<string>();
  const events = history.map((h) => ({ event: String(h.event), who: String(h.actor_name ?? h.actor_ref ?? ''), at: String(h.occurred_at ?? ''), reason: h.reason ? String(h.reason) : undefined }))
    .filter((e) => { const k = `${e.event}|${e.at}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.at.localeCompare(b.at));
  return { record: rec, content: (docs?.content as Any) ?? null, assets: ((docs?.assets as Any[]) ?? []), events };
}
