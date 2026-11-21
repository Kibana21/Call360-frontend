// Survey Studio (FI-1) — the rules of a Save, as pure functions, so they can be tested without a browser or a server.
// A Save starts from a known revision, sends exactly what changed as ONE atomic request, and is reported as saved only
// when the server's reply contains every document that was sent. Nothing here hides a partial save: the server either
// applies all of it or none of it.
import { assetKey, changes, isEmpty, stable, type AssetDoc, type Change, type DocumentSet } from '../model/documents';
import type { Operation } from './api';

export interface Details { name: string; purpose: string }

/** The operations of one Save: documents first, then the content that pins them, then removals, then the details. */
export function operationsFor(base: DocumentSet, next: DocumentSet, opts: { removable: ReadonlySet<string>; details?: Details | null }): Operation[] {
  const c = changes(base, next);
  return [
    ...c.put.map((a): Operation => ({ op: 'PUT_ASSET', kind: a.kind, document: a.document })),
    ...(c.content ? [{ op: 'SET_CONTENT', content: c.content } as Operation] : []),
    // only this survey's own unfrozen versions are ever removed; a frozen or shared version is simply no longer pinned
    ...c.remove.filter((r) => opts.removable.has(assetKey(r))).map((r): Operation => ({ op: 'REMOVE_ASSET', ...r })),
    ...(opts.details ? [{ op: 'SET_DETAILS', name: opts.details.name, purpose: opts.details.purpose } as Operation] : []),
  ];
}

/** True when the server's draft holds every document of `intended` exactly, and the same content. */
export function serverHolds(server: DocumentSet, intended: DocumentSet): boolean {
  if (stable(server.content) !== stable(intended.content)) return false;
  const has = new Map(server.assets.map((a) => [assetKey(a), stable(a.document)]));
  return intended.assets.every((a) => has.get(assetKey(a)) === stable(a.document));
}

export interface Comparison {
  /** Documents changed, added or removed on the server since the revision this editor started from. */
  theirs: string[];
  /** Documents this editor changed, added or removed. */
  mine: string[];
  /** Documents changed on both sides: saving "on top" replaces the server's version of exactly these with this editor's. */
  both: string[];
  contentTheirs: boolean; contentMine: boolean;
}
const touched = (c: Change): string[] => [...c.put.map(assetKey), ...c.remove.map(assetKey)];

/** What each side changed since the common starting point. Nothing is merged here: this only names it. */
export function compare(base: DocumentSet, mine: DocumentSet, server: DocumentSet): Comparison {
  const m = changes(base, mine), t = changes(base, server);
  const ms = touched(m), ts = new Set(touched(t));
  return { theirs: [...ts].sort(), mine: [...ms].sort(), both: ms.filter((k) => ts.has(k)).sort(), contentTheirs: t.content !== null, contentMine: m.content !== null };
}

/**
 * The document set of an explicit "save my changes on top of the newer draft": the server's newer draft, with this
 * editor's own changes applied over it. Documents only the other session changed are kept as the server has them;
 * documents this editor changed take this editor's version — including the ones changed on both sides, which the
 * author has been shown by name before choosing this.
 */
export function onTop(base: DocumentSet, mine: DocumentSet, server: DocumentSet): DocumentSet {
  const m = changes(base, mine);
  const removed = new Set(m.remove.map(assetKey));
  const put = new Map(m.put.map((a) => [assetKey(a), a]));
  const assets: AssetDoc[] = server.assets.filter((a) => !removed.has(assetKey(a))).map((a) => put.get(assetKey(a)) ?? a);
  const have = new Set(assets.map(assetKey));
  for (const a of m.put) if (!have.has(assetKey(a))) assets.push(a);
  return { content: m.content ?? server.content, assets };
}

export { isEmpty };
