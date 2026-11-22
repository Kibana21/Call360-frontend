// Survey Studio (LIB-2) — a module authored ON ITS OWN, as pure functions on the one Workspace.
// A module's execution needs a survey content around it: where each of its endings leads. For a module that has no
// survey, that content is a fixed frame and nothing else — the module, once, always entered, every ending of the
// module ending the run as itself. The server holds a standalone module to exactly this frame (it refuses anything
// else, whatever client sent it); `keepFrame` keeps the editor's workspace in it, so that what is saved is what the
// server expects. Nothing here is a second model: the module is the same Module, edited by the same operations.
import { stable } from './documents';
import type { Instance, Module, Workspace } from './types';

const working = (ws: Workspace): { inst: Instance; m: Module } | null => {
  const inst = ws.surveys[0]?.sequence[0];
  const m = inst ? ws.modules.find((x) => x.code === inst.module.code && x.revision === inst.module.revision) : undefined;
  return inst && m ? { inst, m } : null;
};
/** The module revision a standalone module's draft holds. */
export const workingModule = (ws: Workspace): Module | null => working(ws)?.m ?? null;

/** The workspace with its frame as the server requires it. Returns the SAME workspace when nothing needs changing. */
export function keepFrame(ws: Workspace): Workspace {
  const w = working(ws);
  const s = ws.surveys[0];
  if (!w || !s) return ws;
  const routes: Instance['routes'] = Object.fromEntries(w.m.outcomes.map((o) => [o, { surveyOutcome: o }]));
  const plain = s.sequence.length === 1 && w.inst.entry.mode === 'ALWAYS' && !w.inst.activation && w.inst.ifIneligible === undefined && w.inst.ifSkippedInSequence === undefined;
  if (plain && stable(w.inst.routes) === stable(routes) && s.name === w.m.name && s.purpose === w.m.intent) return ws;
  return { ...ws, surveys: [{ ...s, name: w.m.name, purpose: w.m.intent, sequence: [{ id: w.inst.id, module: { ...w.inst.module }, entry: { mode: 'ALWAYS' }, routes }] }, ...ws.surveys.slice(1)] };
}

/**
 * Start the next revision of a standalone module whose working revision is frozen (submitted or published): a copy of
 * it, one revision on, which the draft then holds. The frozen revision stays exactly as it is, and whatever pins it is
 * not affected. The same workspace is returned when the working revision can still be edited.
 */
export function startNextRevision(ws: Workspace): Workspace {
  const w = working(ws);
  const s = ws.surveys[0];
  if (!w || !s || !w.m.published) return ws;
  const revision = Math.max(...ws.modules.filter((x) => x.code === w.m.code).map((x) => x.revision)) + 1;
  const copy: Module = { ...(JSON.parse(JSON.stringify(w.m)) as Module), revision, published: false };
  delete copy.derivedFor;
  delete copy.derivedFrom;
  return keepFrame({ ...ws, modules: [...ws.modules, copy], surveys: [{ ...s, sequence: [{ ...w.inst, module: { code: copy.code, revision } }] }, ...ws.surveys.slice(1)] });
}
