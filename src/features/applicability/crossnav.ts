// Survey Applicability (APPL-X1R) — moving between the two products without losing your place. When someone opens a
// survey in Survey Studio from an applicability policy, where they came from is remembered IN MEMORY for this tab
// (never in browser storage) so Survey Studio can offer the way back to the same policy and view.
import { useSyncExternalStore } from 'react';

export interface ReturnTo { path: string; label: string }
let current: ReturnTo | null = null;
const listeners = new Set<() => void>();
export const setReturn = (r: ReturnTo | null) => { current = r; listeners.forEach((l) => l()); };
export const useReturn = (): ReturnTo | null => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => null);
