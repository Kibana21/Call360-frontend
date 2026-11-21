// FI-1 — the rules of a Save, exercised against a stand-in for the server that behaves as the real one is specified to:
// one revision per save, all or nothing, STALE_DRAFT on an old revision. The real server is exercised by the backend
// tests (tests/test_survey_fi1.py) and by the full-stack Playwright journey (e2e/persisted).
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../../../api/client';
import { assetKey, stable, toDocuments, type DocumentSet } from '../model/documents';
import { renameSurvey } from '../model/ops';
import { StudioProvider, forgetPersistedMemory, useStudio } from '../store';
import type { DraftDocuments, Operation } from './api';
import { PersistenceProvider, open, usePersistence } from './Persistence';
import { SaveControl, SaveMessages } from './SaveControl';
import { compare, onTop, operationsFor, serverHolds } from './saving';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = resolve(__dirname, '../../../../../Call360-specs/docs/plans/survey-studio/canonical-documents');
const raw = existsSync(DIR) ? JSON.parse(readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith('K1'))!), 'utf8')) : null;

vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));
const server = vi.hoisted(() => ({ draft: null as any, saves: [] as any[], fail: null as null | 'network' | 'network-after-commit' | 'refuse' | 'wrong-reply', loads: 0 }));
vi.mock('./api', async (orig) => {
  const real = await orig<typeof import('./api')>();
  const apply = (d: any, ops: Operation[]) => {
    const next = { ...d, revision: d.revision + 1, assets: [...d.assets], updated_by: 'Someone' };
    for (const op of ops) {
      if (op.op === 'SET_CONTENT') next.content = op.content;
      else if (op.op === 'SET_DETAILS') { next.name = op.name; next.purpose = op.purpose; }
      else if (op.op === 'PUT_ASSET') {
        const doc: any = op.document; const code = op.kind === 'WORDING' ? doc.item : doc.code; const version = op.kind === 'WORDING' ? doc.wording_version : op.kind === 'MODULE' ? doc.revision : doc.version;
        next.assets = [...next.assets.filter((a: any) => !(a.kind === op.kind && a.code === code && a.version === version)), { kind: op.kind, code, version, state: 'DRAFT', sha256: 'f'.repeat(64), owned: true, document: doc }];
      } else next.assets = next.assets.filter((a: any) => !(a.kind === op.kind && a.code === op.code && a.version === op.version));
    }
    return next;
  };
  return {
    ...real,
    loadDraft: vi.fn(async () => { server.loads += 1; return structuredClone(server.draft); }),
    saveDraft: vi.fn(async (_id: string, expected: number, ops: Operation[]) => {
      server.saves.push({ expected, ops });
      if (server.fail === 'network') { server.fail = null; throw new TypeError('Failed to fetch'); }
      if (server.fail === 'refuse') { server.fail = null; throw new ApiFailure(422, { code: 'DOCUMENT_INVALID', message: 'The document is not well formed', details: [{ operation_index: 0, op: 'PUT_ASSET', kind: 'MODULE' }] } as any); }
      if (expected !== server.draft.revision) throw new ApiFailure(409, { code: 'STALE_DRAFT', message: `The draft is at revision ${server.draft.revision}` } as any);
      const next = apply(server.draft, ops);
      if (server.fail === 'wrong-reply') { server.fail = null; return { ...structuredClone(next), content: { ...next.content, sequence: [] } }; }
      server.draft = next;
      if (server.fail === 'network-after-commit') { server.fail = null; throw new TypeError('Failed to fetch'); }
      return structuredClone(next);
    }),
  };
});

const draftOf = (): DraftDocuments => ({
  survey_id: '00000000-0000-0000-0000-000000000001', code: raw.content.code, name: 'Linear survey', purpose: 'synthetic', revision: 3, content: raw.content, content_sha256: raw.content_sha256,
  updated_at: '2026-11-22T01:00:00Z', updated_by: 'Dev Survey Author', note: 'Synthetic', catalogs: { fields: {}, outcomes: {}, response_obligations: [] },
  assets: raw.assets.map((a: any) => ({ kind: a.kind, code: a.code, version: a.version, state: 'DRAFT', sha256: a.sha256, owned: true, document: a.document })),
}) as DraftDocuments;

let studio: ReturnType<typeof useStudio>;
let p: NonNullable<ReturnType<typeof usePersistence>>;
function Probe() { studio = useStudio(); p = usePersistence()!; return null; }
function mount() {
  const o = open(draftOf(), '0.1');
  render(<MemoryRouter><StudioProvider memoryKey="t" initial={() => o.ws}><PersistenceProvider initial={o.baseline} onBaseline={() => undefined}><SaveControl /><SaveMessages /><Probe /></PersistenceProvider></StudioProvider></MemoryRouter>);
}
const edit = (name: string) => act(() => { studio.apply('Renamed', (w) => renameSurvey(w, w.surveys[0]!.id, name)); });
const editModule = (text: string) => act(() => { studio.apply('Changed a module', (w) => ({ ...w, modules: w.modules.map((m, i) => (i === 0 ? { ...m, name: text } : m)) })); });
const status = () => screen.getByTestId('ss-save-status').getAttribute('data-state');

describe.skipIf(!raw)('a Save', () => {
  beforeEach(() => { forgetPersistedMemory(); server.draft = draftOf(); server.saves = []; server.fail = null; server.loads = 0; });

  it('starts saved, with the revision shown, and has nothing to send', async () => {
    mount();
    expect(status()).toBe('saved');
    expect(screen.getByTestId('ss-revision').textContent).toContain('Revision 3');
    expect(screen.getByTestId('ss-save')).toBeDisabled();
    expect(p.dirty).toBe(false);
  });

  it('an edit is unsaved until the server confirms the whole save; then it is the new revision', async () => {
    mount();
    editModule('General verification, revised');
    expect(status()).toBe('unsaved');
    expect(screen.getByTestId('ss-revision').textContent).toContain('1 change since revision 3');
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('saved'));
    expect(server.saves).toHaveLength(1); // ONE request for the whole save
    expect(server.saves[0].expected).toBe(3); // from the explicitly known revision
    expect(server.saves[0].ops.map((o: Operation) => o.op)).toEqual(['PUT_ASSET']); // exactly what changed, nothing else
    expect(p.revision).toBe(4);
    expect(screen.getByTestId('ss-revision').textContent).toContain('Revision 4');
    expect(studio.undoLabel).toBe('Changed a module'); // saving is not an edit: undo history is kept
  });

  it('a name change is saved in the same single request as the documents', async () => {
    mount();
    editModule('Changed');
    edit('A new name');
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('saved'));
    expect(server.saves).toHaveLength(1);
    expect(server.saves[0].ops.map((o: Operation) => o.op)).toEqual(['PUT_ASSET', 'SET_DETAILS']);
    expect(server.draft.name).toBe('A new name');
  });

  it('a refused save reports no success, changes nothing on the server and keeps the work', async () => {
    mount();
    editModule('Will be refused');
    server.fail = 'refuse';
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('failed'));
    expect(screen.getByTestId('ss-save-error').textContent).toContain('Not saved');
    expect(screen.getByTestId('ss-save-error').textContent).toContain('DOCUMENT_INVALID');
    expect(screen.getByTestId('ss-save-error').textContent).toContain('MODULE (item 1 of this save)');
    expect(p.revision).toBe(3);
    expect(server.draft.revision).toBe(3);
    expect(studio.ws.modules[0]!.name).toBe('Will be refused'); // the local work is still there
    await userEvent.click(screen.getByTestId('ss-save')); // "Try again"
    await waitFor(() => expect(status()).toBe('saved'));
    expect(p.revision).toBe(4);
  });

  it('a reply that does not hold what was sent is not reported as saved', async () => {
    mount();
    editModule('Sent');
    server.fail = 'wrong-reply';
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('failed'));
    expect(screen.getByTestId('ss-save-error').textContent).toContain('does not match what was sent');
    expect(p.revision).toBe(3);
  });

  it('a network failure keeps the work; trying again sends it once', async () => {
    mount();
    editModule('Offline');
    server.fail = 'network';
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('failed'));
    expect(screen.getByTestId('ss-save-error').textContent).toContain('could not be reached');
    expect(studio.ws.modules[0]!.name).toBe('Offline');
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('saved'));
    expect(server.draft.revision).toBe(4); // one revision, not two
    expect(server.loads).toBe(1); // it asked the server what it had before sending again
  });

  it('a save that reached the server but whose reply was lost is recognised, not applied twice', async () => {
    mount();
    editModule('Reply lost');
    server.fail = 'network-after-commit';
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('failed'));
    expect(server.draft.revision).toBe(4); // the server HAS it
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('saved'));
    expect(server.saves).toHaveLength(1); // nothing was sent a second time
    expect(server.draft.revision).toBe(4);
    expect(p.revision).toBe(4);
  });
});

describe.skipIf(!raw)('two sessions', () => {
  beforeEach(() => { forgetPersistedMemory(); server.draft = draftOf(); server.saves = []; server.fail = null; server.loads = 0; });
  /** Another session saves a change to the first item's intent: the server moves to revision 4. */
  const otherSessionSaves = (touchModule = false) => {
    const d = structuredClone(server.draft);
    const item = d.assets.find((a: any) => a.kind === 'ITEM');
    item.document = { ...item.document, intent: 'Changed by the other session' };
    if (touchModule) { const m = d.assets.find((a: any) => a.kind === 'MODULE'); m.document = { ...m.document, name: 'Their module name' }; }
    server.draft = { ...d, revision: d.revision + 1, updated_by: 'Dev Survey Checker', updated_at: '2026-11-22T02:00:00Z' };
  };

  it('a stale save is refused, nothing is lost, and the newer draft is shown apart from the local work', async () => {
    mount();
    editModule('My module name');
    otherSessionSaves();
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('conflict'));
    expect(server.draft.revision).toBe(4); // my save changed nothing
    expect(studio.ws.modules[0]!.name).toBe('My module name'); // my work is intact
    expect(screen.getByTestId('ss-conflict-summary').textContent).toContain('revision 3');
    expect(screen.getByTestId('ss-conflict-summary').textContent).toContain('revision 4');
    expect(screen.getByTestId('ss-conflict-summary').textContent).toContain('Dev Survey Checker');
    expect(screen.getByTestId('ss-conflict-theirs').textContent).toContain('Question or statement');
    expect(screen.getByTestId('ss-conflict-mine').textContent).toContain('Module');
    expect(screen.getByTestId('ss-conflict-both').textContent).toContain('Nothing');
    // deciding later closes the panel and keeps everything; Save asks again
    await userEvent.click(screen.getByTestId('ss-conflict-keep'));
    expect(screen.queryByTestId('ss-conflict')).toBeNull();
    expect(status()).toBe('conflict');
    expect(studio.ws.modules[0]!.name).toBe('My module name');
    await userEvent.click(screen.getByTestId('ss-resolve'));
    expect(screen.getByTestId('ss-conflict')).toBeInTheDocument();
  });

  it('saving on top keeps their changes, applies mine, and is one new revision', async () => {
    mount();
    editModule('My module name');
    otherSessionSaves();
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('conflict'));
    await userEvent.click(screen.getByTestId('ss-conflict-ontop'));
    await waitFor(() => expect(status()).toBe('saved'));
    expect(server.draft.revision).toBe(5);
    expect(server.saves.at(-1).expected).toBe(4);
    expect(server.saves.at(-1).ops.map((o: Operation) => `${o.op}:${(o as any).kind}`)).toEqual(['PUT_ASSET:MODULE']); // only mine is sent
    expect(server.draft.assets.find((a: any) => a.kind === 'ITEM').document.intent).toBe('Changed by the other session'); // theirs survives
    expect(server.draft.assets.find((a: any) => a.kind === 'MODULE').document.name).toBe('My module name');
    expect(studio.ws.questions.some((q) => q.intent === 'Changed by the other session')).toBe(true); // and is now on screen
    expect(p.revision).toBe(5);
  });

  it('what both changed is named before anything is replaced', async () => {
    mount();
    editModule('My module name');
    otherSessionSaves(true);
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('conflict'));
    expect(screen.getByTestId('ss-conflict-both').textContent).toContain('Module');
    expect(screen.getByTestId('ss-conflict-ontop').parentElement!.textContent).toContain('your version replaces theirs');
    expect(server.draft.assets.find((a: any) => a.kind === 'MODULE').document.name).toBe('Their module name'); // untouched until chosen
  });

  it('reloading the newer draft is explicit and drops only the local changes', async () => {
    mount();
    editModule('My module name');
    otherSessionSaves();
    await userEvent.click(screen.getByTestId('ss-save'));
    await waitFor(() => expect(status()).toBe('conflict'));
    await userEvent.click(screen.getByTestId('ss-conflict-reload'));
    await waitFor(() => expect(status()).toBe('saved'));
    expect(p.revision).toBe(4);
    expect(studio.ws.modules[0]!.name).not.toBe('My module name');
    expect(studio.ws.questions.some((q) => q.intent === 'Changed by the other session')).toBe(true);
    expect(server.saves).toHaveLength(1); // only the refused attempt: reloading sends nothing
  });
});

describe.skipIf(!raw)('the pure rules of a save', () => {
  const base = (): DocumentSet => { const o = open(draftOf(), '0.1'); return toDocuments(o.ws, o.ws.surveys[0]!); };
  const withModuleName = (s: DocumentSet, name: string): DocumentSet => ({ ...s, assets: s.assets.map((a) => (a.kind === 'MODULE' ? { ...a, document: { ...a.document, name } } : a)) });

  it('orders a save: documents, then the content that pins them, then removals, then details', () => {
    const b = base();
    const next: DocumentSet = { content: { ...b.content, sequence: [] }, assets: withModuleName(b, 'x').assets.filter((a) => a.kind !== 'CONDITION').slice(1) };
    const removable = new Set(b.assets.map(assetKey));
    const ops = operationsFor(b, next, { removable, details: { name: 'N', purpose: '' } });
    const kinds = ops.map((o) => o.op);
    expect(kinds.indexOf('SET_CONTENT')).toBeGreaterThan(kinds.lastIndexOf('PUT_ASSET'));
    expect(kinds.indexOf('REMOVE_ASSET')).toBeGreaterThan(kinds.indexOf('SET_CONTENT'));
    expect(kinds.at(-1)).toBe('SET_DETAILS');
    // a version this survey does not own, or a frozen one, is never removed: it is only no longer pinned
    expect(operationsFor(b, next, { removable: new Set() }).some((o) => o.op === 'REMOVE_ASSET')).toBe(false);
  });

  it('serverHolds is true only when every sent document and the content are exactly there', () => {
    const b = base();
    expect(serverHolds(b, b)).toBe(true);
    expect(serverHolds(withModuleName(b, 'other'), b)).toBe(false);
    expect(serverHolds({ ...b, content: { ...b.content, sequence: [] } }, b)).toBe(false);
    expect(serverHolds({ ...b, assets: b.assets.slice(1) }, b)).toBe(false);
    expect(serverHolds({ ...b, assets: [...b.assets, { kind: 'ITEM', code: 'EXTRA', version: 1, document: {} }] }, b)).toBe(true);
  });

  it('compare names each side; onTop takes theirs where only they changed and mine where I changed', () => {
    const b = base();
    const mine = withModuleName(b, 'mine');
    const theirs: DocumentSet = { ...b, assets: b.assets.map((a) => (a.kind === 'ITEM' && a === b.assets.find((x) => x.kind === 'ITEM') ? { ...a, document: { ...a.document, intent: 'theirs' } } : a)) };
    const c = compare(b, mine, theirs);
    expect(c.mine).toHaveLength(1);
    expect(c.theirs).toHaveLength(1);
    expect(c.both).toEqual([]);
    const merged = onTop(b, mine, theirs);
    expect((merged.assets.find((a) => a.kind === 'MODULE')!.document as any).name).toBe('mine');
    expect((merged.assets.find((a) => a.kind === 'ITEM')!.document as any).intent).toBe('theirs');
    expect(stable(merged.content)).toBe(stable(theirs.content));
    const clash = compare(b, mine, withModuleName(theirs, 'theirs too'));
    expect(clash.both).toHaveLength(1);
  });
});
