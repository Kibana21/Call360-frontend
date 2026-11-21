// Test helper: adds an unrelated module to the library.
import { addLargeModule } from './large';
import type { Workspace } from './types';

export const large = (ws: Workspace): Workspace => { const r = addLargeModule(ws); return Array.isArray(r) ? r[0] : r; };
