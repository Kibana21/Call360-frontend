// Survey Studio (FI-1) — the PERSISTED application: the same Lego Composer, Guided Builder, Graph, Simulator, Call plan
// and Validation screens as the prototype, on real surveys saved to Call360 through the survey-definition API.
// Shown only when the build setting VITE_SURVEY_STUDIO_PERSISTED=1 is on, to people who hold `survey.read`.
// Synthetic content only. Review and publication run on the real, immutable candidates of the API (persist/ReviewPages).
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import '../../../styles/survey-studio.css';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { BuilderPage } from '../BuilderPage';
import { CallPlanPage } from '../CallPlanPage';
import { ComposerPage } from '../ComposerPage';
import { SimulatorPage } from '../SimulatorPage';
import { ValidationPage } from '../ValidationPage';
import { MappingError } from '../model/documents';
import type { Workspace } from '../model/types';
import { StudioProvider, forgetPersistedMemory, hasPersistedMemory } from '../store';
import { Glyph, Tag } from '../ui';
import { createSurvey, libraryAvailable, listSurveys, loadDraft, type SurveySummary } from './api';
import { LibraryProvider } from './Library';
import { PersistenceProvider, open, versionLabelOf, type Baseline } from './Persistence';
import { CandidatePage, ReviewPage, VersionPage } from './ReviewPages';
import { STANDING_NOTE } from './standing';


// the baseline of each survey opened in this page, beside its unsaved workspace (store.tsx): memory only
const baselines = new Map<string, Baseline>();
/** Test helper: forget every opened survey. */
export const forgetOpenedSurveys = () => { baselines.clear(); forgetPersistedMemory(); };

export function PersistedStudioRoot() {
  return (
    <div className="ss" data-testid="survey-studio" data-mode="persisted">
      <Routes>
        <Route index element={<SurveyListPage />} />
        <Route path="surveys/:surveyId/*" element={<OpenSurvey />} />
        <Route path="*" element={<Missing />} />
      </Routes>
    </div>
  );
}

const Missing = () => (<><Bar crumbs={['Survey Studio', 'Not found']} /><div className="ss-empty page"><p><strong>That page does not exist.</strong></p><Link className="ss-btn" to="/survey-studio">Back to Survey Studio</Link></div></>);

/** The plain bar of the screens that have no open survey (the list, loading, an error). */
function Bar({ crumbs }: { crumbs: string[] }) {
  return (
    <div className="ss-bar">
      <nav className="ss-crumbs" aria-label="Survey Studio breadcrumb">
        {crumbs.map((c, i) => (i < crumbs.length - 1 ? <span key={c}><Link to="/survey-studio">{c}</Link> <Glyph name="right" size={13} /> </span> : <span key={c} aria-current="page">{c}</span>))}
      </nav>
      <div className="ss-bar-tools"><span className="ss-proto saved-mode" data-testid="ss-persisted-tag" title="Surveys here are saved to the Call360 development database."><Glyph name="info" size={14} /> Saved to Call360 · synthetic</span></div>
    </div>
  );
}

const say = (e: unknown) => (e instanceof ApiFailure ? (e.status === 403 ? 'You do not have permission for this.' : e.message) : 'The server could not be reached.');

// ---- the list -----------------------------------------------------------------------------------------------------
function SurveyListPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<SurveySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const fetchAll = useCallback(() => { setError(null); listSurveys().then(setRows).catch((e) => setError(say(e))); }, []);
  useEffect(fetchAll, [fetchAll]);
  return (
    <>
      <Bar crumbs={['Survey Studio']} />
      <div className="ss-home" data-testid="ss-saved-home">
        <header className="ss-home-head">
          <div><h1 className="ss-title">Surveys</h1>
            <p className="ss-muted">Saved in Call360. Open one to compose it, build its modules and save your changes as a new revision.</p></div>
          {can('survey.edit') ? <button type="button" className="ss-btn primary big" onClick={() => setCreating(true)} data-testid="ss-create"><Glyph name="plus" /> New survey</button>
            : <span className="ss-save-note" data-testid="ss-read-only">Read only: you can open surveys but not change them.</span>}
        </header>
        <p className="ss-note" data-testid="ss-standing-note"><Glyph name="info" size={14} /><span>{STANDING_NOTE}</span></p>
        {creating ? <CreateForm onCancel={() => setCreating(false)} onMade={(s) => nav(`/survey-studio/surveys/${s.code}`)} /> : null}
        {error ? <div className="ss-empty" role="alert" data-testid="ss-list-error"><p><strong>The surveys could not be loaded.</strong> {error}</p><button type="button" className="ss-btn" onClick={fetchAll}>Try again</button></div>
          : rows === null ? <p className="ss-loading" role="status" data-testid="ss-loading"><span className="ss-spinner" aria-hidden="true" /> Loading surveys…</p>
            : rows.length === 0 ? <div className="ss-empty" data-testid="ss-no-surveys"><p><strong>No surveys yet.</strong> {can('survey.edit') ? 'Create the first one.' : 'Nobody has created one.'}</p></div>
              : (
                <table className="ss-table" data-testid="ss-surveys">
                  <thead><tr><th scope="col">Survey</th><th scope="col">Code</th><th scope="col">Draft</th><th scope="col">Published</th><th scope="col">In review</th></tr></thead>
                  <tbody>{rows.map((s) => (
                    <tr key={s.id} data-testid={`ss-survey-${s.code}`}>
                      <td><Link to={`/survey-studio/surveys/${s.code}`} data-testid={`ss-open-${s.code}`}><strong>{s.name}</strong></Link>{s.purpose ? <small> — {s.purpose}</small> : null}
                        {hasPersistedMemory(s.code) ? <> <Tag tone="draft">Open in this tab</Tag></> : null}</td>
                      <td><span className="ss-code">{s.code}</span></td>
                      <td>Revision {s.draft_revision}</td>
                      <td>{s.latest_version_label ? `Version ${s.latest_version_label}` : 'Never'}</td>
                      <td>{s.open_candidate_status ? s.open_candidate_status.replace('_', ' ').toLowerCase() : '—'}</td>
                    </tr>))}</tbody>
                </table>)}
      </div>
    </>
  );
}

const codeFrom = (name: string) => `S-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)}`;

function CreateForm({ onCancel, onMade }: { onCancel: () => void; onMade: (s: SurveySummary) => void }) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effective = code || codeFrom(name);
  const valid = name.trim().length >= 3 && /^[A-Z][A-Z0-9_-]{2,59}$/.test(effective);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    createSurvey({ code: effective, name: name.trim(), purpose: purpose.trim() }).then(onMade)
      .catch((x) => setError(x instanceof ApiFailure && x.code === 'SURVEY_CODE_TAKEN' ? `The code ${effective} is already used by another survey. Choose another code.` : say(x)))
      .finally(() => setBusy(false));
  };
  return (
    <form className="ss-create" onSubmit={submit} data-testid="ss-create-form" aria-label="Create survey">
      <label className="ss-field"><span>Survey name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New business callback" data-testid="ss-create-name" required minLength={3} maxLength={160} /></label>
      <label className="ss-field"><span>What is it for? <em>optional</em></span>
        <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Verify a new policy sale" data-testid="ss-create-purpose" maxLength={2000} /></label>
      <label className="ss-field"><span>Code <em>its permanent identity; capitals, digits, hyphens</em></span>
        <input value={effective} onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="ss-create-code" maxLength={60} /></label>
      {error ? <p className="ss-warn-text" role="alert" data-testid="ss-create-error">{error}</p> : null}
      <div className="ss-actions">
        <button type="submit" className="ss-btn primary" disabled={!valid || busy} data-testid="ss-create-go">{busy ? 'Creating…' : 'Create and open'}</button>
        <button type="button" className="ss-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---- one open survey ------------------------------------------------------------------------------------------------
type Load = { state: 'loading' } | { state: 'missing' } | { state: 'error'; message: string } | { state: 'unsupported'; message: string } | { state: 'ready'; baseline: Baseline; ws: Workspace | null };

/** Keyed by the survey, so opening another survey starts afresh and never shows the previous one's state. */
function OpenSurvey() {
  const { surveyId = '' } = useParams();
  return <OpenOne key={surveyId} code={surveyId} />;
}

function OpenOne({ code }: { code: string }) {
  const [load, setLoad] = useState<Load>(() => (baselines.has(code) && hasPersistedMemory(code) ? { state: 'ready', baseline: baselines.get(code)!, ws: null } : { state: 'loading' }));
  const attempt = useRef(0);
  const fetchDraft = useCallback(() => {
    const mine = ++attempt.current;
    setLoad({ state: 'loading' });
    (async () => {
      const summary = (await listSurveys()).find((s) => s.code === code);
      if (!summary) return { state: 'missing' } as Load;
      const o = open(await loadDraft(summary.id), versionLabelOf(summary.latest_version_label), await libraryAvailable().catch(() => false));
      return { state: 'ready', baseline: o.baseline, ws: o.ws } as Load;
    })().then((l) => { if (mine === attempt.current) setLoad(l); })
      .catch((e) => { if (mine !== attempt.current) return; setLoad(e instanceof MappingError ? { state: 'unsupported', message: e.message } : e instanceof ApiFailure && e.status === 404 ? { state: 'missing' } : { state: 'error', message: say(e) }); });
  }, [code]);
  useEffect(() => { if (load.state === 'loading') fetchDraft(); /* only on first arrival */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const remember = useCallback((b: Baseline) => { baselines.set(code, b); }, [code]);

  if (load.state === 'loading') return (<><Bar crumbs={['Survey Studio', code]} /><p className="ss-loading page" role="status" data-testid="ss-loading"><span className="ss-spinner" aria-hidden="true" /> Loading the saved draft of {code}…</p></>);
  if (load.state === 'missing') return (<><Bar crumbs={['Survey Studio', 'Survey not found']} /><div className="ss-empty page" data-testid="ss-missing"><p><strong>There is no survey {code} that you can open.</strong> It may not exist, or it may belong to a market you do not work in.</p><Link className="ss-btn" to="/survey-studio">Back to Survey Studio</Link></div></>);
  if (load.state === 'error') return (<><Bar crumbs={['Survey Studio', code]} /><div className="ss-empty page" role="alert" data-testid="ss-load-error"><p><strong>The saved draft could not be loaded.</strong> {load.message}</p><button type="button" className="ss-btn" onClick={fetchDraft}>Try again</button></div></>);
  if (load.state === 'unsupported') return (<><Bar crumbs={['Survey Studio', code]} /><div className="ss-empty page" role="alert" data-testid="ss-unsupported"><p><strong>This editor cannot open the saved draft without losing something, so it has not opened it.</strong> {load.message}</p><Link className="ss-btn" to="/survey-studio">Back to Survey Studio</Link></div></>);

  if (load.ws) baselines.set(code, load.baseline);
  const ws = load.ws;
  return (
    <StudioProvider key={code} memoryKey={code} initial={() => ws!}>
      <PersistenceProvider initial={load.baseline} onBaseline={remember}>
        <LibraryProvider>
        <Routes>
          <Route index element={<ComposerPage />} />
          <Route path="simulate" element={<SimulatorPage />} />
          <Route path="plan" element={<CallPlanPage />} />
          <Route path="validate" element={<ValidationPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="candidates/:candidateId" element={<CandidatePage />} />
          <Route path="versions/:versionId" element={<VersionPage />} />
          <Route path="modules/:instanceId" element={<BuilderPage />} />
        </Routes>
        </LibraryProvider>
      </PersistenceProvider>
    </StudioProvider>
  );
}
