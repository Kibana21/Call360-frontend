// Survey Studio (FI-1) — the Save control and the conflict panel shown in the studio bar of a saved survey.
// Five states, each said in words and never by colour alone: saved, unsaved, saving, failed, conflict.
import { useEffect, useRef } from 'react';
import { Glyph } from '../ui';
import { usePersistence, type Persistence } from './Persistence';

const when = (iso: string) => new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const LABEL: Record<Persistence['status'], string> = { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', failed: 'Not saved', conflict: 'Newer draft on the server' };

export function SaveControl() {
  const p = usePersistence();
  if (!p) return null;
  const blocked = !p.canEdit || !!p.mappingError;
  return (
    <>
      <span className={`ss-save-state ${p.status}`} role="status" aria-live="polite" data-testid="ss-save-status" data-state={p.status}
        title={`Revision ${p.revision}, saved ${when(p.savedAt)}${p.savedBy ? ` by ${p.savedBy}` : ''}`}>
        <Glyph name={p.status === 'saved' ? 'check' : p.status === 'failed' || p.status === 'conflict' ? 'alert' : 'info'} size={14} />
        <span><strong>{LABEL[p.status]}</strong>
          <small data-testid="ss-revision">{p.status === 'unsaved' ? `${p.changed} change${p.changed === 1 ? '' : 's'} since revision ${p.revision}` : `Revision ${p.revision} · ${when(p.savedAt)}${p.savedBy ? ` · ${p.savedBy}` : ''}`}</small></span>
      </span>
      {p.status === 'conflict'
        ? <button type="button" className="ss-tool warn" onClick={p.openConflict} data-testid="ss-resolve"><Glyph name="alert" /> Resolve</button>
        : <button type="button" className={`ss-tool ${p.dirty && !blocked ? 'save' : ''}`} onClick={() => void p.save()} disabled={blocked || p.status === 'saving' || (!p.dirty && p.status !== 'failed')}
            title={!p.canEdit ? 'You can read this survey but not change it (survey.edit is needed to save).' : p.mappingError ?? (p.dirty ? 'Save your changes to Call360 as one new revision' : 'Nothing to save')} data-testid="ss-save">
            <Glyph name="check" /> {p.status === 'failed' ? 'Try again' : 'Save'}
          </button>}
      {!p.canEdit ? <span className="ss-save-note" data-testid="ss-read-only">Read only</span> : null}
    </>
  );
}

/** Below the bar: why a save failed, or that the model cannot be written, in a sentence. The work is never discarded. */
export function SaveMessages() {
  const p = usePersistence();
  if (!p) return null;
  return (
    <>
      {p.error && p.status === 'failed' ? (
        <p className="ss-note warn" role="alert" data-testid="ss-save-error"><Glyph name="alert" size={14} />
          <span><strong>Not saved.</strong> {p.error.message}{p.error.where ? ` The server refused ${p.error.where}.` : ''}{p.error.code ? <> <span className="ss-code">{p.error.code}</span></> : null} Nothing was changed on the server, and nothing here was lost. {p.error.network ? 'Try again checks first whether the earlier save had arrived, so it is never applied twice.' : 'Correct it and save again.'}</span></p>
      ) : null}
      {p.mappingError ? <p className="ss-note warn" role="alert" data-testid="ss-mapping-error"><Glyph name="alert" size={14} /><span><strong>This cannot be saved as it stands.</strong> {p.mappingError}</span></p> : null}
      {p.conflict?.open ? <ConflictPanel p={p} /> : null}
    </>
  );
}

const name = (key: string) => { const [kind, rest] = key.split(':'); return `${({ OPTION_SET: 'Answers', ITEM: 'Question or statement', WORDING: 'Wording', CONDITION: 'Condition', MODULE: 'Module' } as Record<string, string>)[kind!] ?? kind} ${rest!.replace('@', ' v')}`; };

function ConflictPanel({ p }: { p: Persistence }) {
  const c = p.conflict!;
  const first = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const { comparison: x, latest } = c;
  const list = (keys: string[], content: boolean) => [...(content ? ['The order and routing of modules in the survey'] : []), ...keys.map(name)];
  const theirsOnly = x.theirs.filter((k) => !x.both.includes(k));
  const mineOnly = x.mine.filter((k) => !x.both.includes(k));
  const bothContent = x.contentMine && x.contentTheirs;
  return (
    <div className="ss-modal-back" data-testid="ss-conflict">
      <div className="ss-modal wide" role="dialog" aria-modal="true" aria-labelledby="ss-conflict-title" onKeyDown={(e) => { if (e.key === 'Escape') p.keepEditing(); }}>
        <h2 id="ss-conflict-title">Someone saved this survey while you were editing</h2>
        <p data-testid="ss-conflict-summary">You started from <strong>revision {p.revision}</strong>. The server now has <strong>revision {latest.revision}</strong>{latest.updated_by ? <>, saved by <strong>{latest.updated_by}</strong></> : null} at {when(latest.updated_at)}. Your save was refused, and <strong>nothing of yours has been lost or sent</strong>. Nothing is merged or overwritten unless you choose it below.</p>
        <div className="ss-conflict-cols">
          <section aria-label="Changed on the server" data-testid="ss-conflict-theirs"><h3>Changed on the server only</h3>
            {list(theirsOnly, x.contentTheirs && !x.contentMine).length ? <ul>{list(theirsOnly, x.contentTheirs && !x.contentMine).map((t) => <li key={t}>{t}</li>)}</ul> : <p className="ss-muted">Nothing.</p>}</section>
          <section aria-label="Changed by you" data-testid="ss-conflict-mine"><h3>Changed by you only</h3>
            {list(mineOnly, x.contentMine && !x.contentTheirs).length ? <ul>{list(mineOnly, x.contentMine && !x.contentTheirs).map((t) => <li key={t}>{t}</li>)}</ul> : <p className="ss-muted">Nothing.</p>}</section>
          <section aria-label="Changed by both" className={x.both.length || bothContent ? 'warn' : ''} data-testid="ss-conflict-both"><h3>Changed by both</h3>
            {list(x.both, bothContent).length ? <ul>{list(x.both, bothContent).map((t) => <li key={t}>{t}</li>)}</ul> : <p className="ss-muted">Nothing: the two sets of changes do not touch the same thing.</p>}</section>
        </div>
        <div className="ss-conflict-choices">
          <div><button type="button" className="ss-btn" ref={first} onClick={p.keepEditing} data-testid="ss-conflict-keep">Keep editing — decide later</button>
            <small>Closes this. Your changes stay here, unsaved. Save will ask again.</small></div>
          <div><button type="button" className="ss-btn" onClick={p.reloadServerDraft} data-testid="ss-conflict-reload">Discard my changes and load revision {latest.revision}</button>
            <small>{x.mine.length + (x.contentMine ? 1 : 0) === 1 ? 'Your 1 unsaved change is dropped.' : `Your ${x.mine.length + (x.contentMine ? 1 : 0)} unsaved changes are dropped.`} This cannot be undone.</small></div>
          <div><button type="button" className="ss-btn primary" onClick={() => void p.saveOnTop()} data-testid="ss-conflict-ontop">Save my changes on top of revision {latest.revision}</button>
            <small>Keeps everything changed on the server only, and applies your changes over it as revision {latest.revision + 1}.{x.both.length || bothContent ? <strong> For the {x.both.length + (bothContent ? 1 : 0)} thing{x.both.length + (bothContent ? 1 : 0) === 1 ? '' : 's'} changed by both, your version replaces theirs.</strong> : ' Nothing of theirs is replaced.'}</small></div>
        </div>
      </div>
    </div>
  );
}
