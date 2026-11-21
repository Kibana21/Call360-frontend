// Survey Studio prototype — canonical snapshots of the one model, used to assert that two edit paths agree.
import type { Workspace } from './types';

const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v);
/** The whole canonical model as one stable string (keys sorted; array order is meaningful and kept). */
export const canonical = (ws: Workspace): string => JSON.stringify(sortKeys(ws));
/** A short fingerprint of the canonical model (FNV-1a), shown in the prototype so two edit paths can be compared. */
export function fingerprint(ws: Workspace): string {
  let h = 0x811c9dc5;
  const s = canonical(ws);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
