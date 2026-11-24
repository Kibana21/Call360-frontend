// Survey Studio (FI-1) — the PERSISTED application: the same Lego Composer, Guided Builder, Graph, Simulator, Call plan
// and Validation screens as the prototype, on real surveys saved to Call360 through the survey-definition API.
// Shown only when the build setting VITE_SURVEY_STUDIO_PERSISTED=1 is on, to people who hold `survey.read`.
// Synthetic content only. Review and publication run on the real, immutable candidates of the API (persist/ReviewPages).
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import '../../../styles/survey-studio.css';
import { ApiFailure } from '../../../api/client';
import { BuilderPage } from '../BuilderPage';
import { CallPlanPage } from '../CallPlanPage';
import { ComposerPage } from '../ComposerPage';
import { SimulatorPage } from '../SimulatorPage';
import { ValidationPage } from '../ValidationPage';
import { MappingError } from '../model/documents';
import type { Workspace } from '../model/types';
import { StudioProvider, forgetPersistedMemory, hasPersistedMemory } from '../store';
import { Glyph } from '../ui';
import { createSurvey, libraryAvailable, listSurveys, loadDraft, type SurveySummary } from './api';
import { AssignmentPage } from './AssignmentPage';
import { CoordinatedSimulationPage } from './CoordinatedSimulation';
import { ControlBuilderPage } from './ControlBuilder';
import { EvaluationWorkbenchPage } from './EvaluationWorkbench';
import { JourneyListPage, JourneyPage } from './JourneyPage';
import { LibraryProvider } from './Library';
import { listModules } from './moduleApi';
import { ModuleBuild, ModuleReviewLead, ModuleTestPage, PublishedModuleTestPage } from './ModuleStudio';
import { PersistenceProvider, open, versionLabelOf, type Baseline } from './Persistence';
import { CandidatePage, ReviewPage, VersionPage } from './ReviewPages';
import { RulesExplorerPage } from './RulesExplorer';
import { SimulationHubPage } from './SimulationHub';
import { WorkspacePage } from './Workspace';
import { missing } from './workspaceApi';
import { keepFrame } from '../model/standalone';
import { PlaceProvider, type Place } from '../place';
import { applicabilityEnabled } from '../../applicability/flag';
import { ApplicabilityRoot } from '../../applicability/Shell';
import { ApplicabilityReturn } from '../../applicability/WhereUsed';


// the baseline of each survey opened in this page, beside its unsaved workspace (store.tsx): memory only
const baselines = new Map<string, Baseline>();
/** Test helper: forget every opened survey. */
export const forgetOpenedSurveys = () => { baselines.clear(); forgetPersistedMemory(); };

export function PersistedStudioRoot() {
  return (
    <div className="ss" data-testid="survey-studio" data-mode="persisted">
      <ApplicabilityReturn />
      <Routes>
        <Route index element={<><Bar crumbs={['Survey Studio']} /><WorkspacePage CreateForm={CreateForm} /></>} />
        <Route path="rules" element={<RulesExplorerPage />} />
        <Route path="simulation" element={<SimulationHubPage />} />
        <Route path="assignment" element={<AssignmentPage />} />
        <Route path="coordinated-simulations/:coordinatedId" element={<CoordinatedSimulationPage />} />
        <Route path="evaluations/:evaluationId" element={<EvaluationWorkbenchPage />} />
        <Route path="controls" element={<ControlBuilderPage />} />
        <Route path="journeys" element={<JourneyListPage />} />
        <Route path="journeys/:kind/:journeyId" element={<JourneyPage />} />
        <Route path="surveys/:surveyId/*" element={<OpenSurvey />} />
        {/* LIB-2: a reusable module authored on its own, and the test of any published module */}
        <Route path="modules/:moduleCode/*" element={<OpenModule />} />
        <Route path="module-tests/:code/:revision" element={<PublishedModuleTestPage bar={(crumbs) => <Bar crumbs={crumbs} />} />} />
        {/* APPL-X1: the Survey Applicability prototype — its own workspace, only when its build setting is on */}
        {applicabilityEnabled() ? <Route path="applicability/*" element={<ApplicabilityRoot />} /> : null}
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

/** LIB-2: a standalone module is opened like a survey — the same draft, the same save — under its own address. */
function OpenModule() {
  const { moduleCode = '' } = useParams();
  return <OpenOne key={`module:${moduleCode}`} code={moduleCode} module />;
}

function OpenOne({ code, module = false }: { code: string; module?: boolean }) {
  const memory = module ? `module:${code}` : code;
  const what = module ? 'module' : 'survey';
  const place = useMemo((): Place | null => (module ? { mode: 'module', base: `/survey-studio/modules/${code}`, reviewLead: <ModuleReviewLead /> } : null), [module, code]);
  const [load, setLoad] = useState<Load>(() => (baselines.has(memory) && hasPersistedMemory(memory) ? { state: 'ready', baseline: baselines.get(memory)!, ws: null } : { state: 'loading' }));
  const attempt = useRef(0);
  const fetchDraft = useCallback(() => {
    const mine = ++attempt.current;
    setLoad({ state: 'loading' });
    (async () => {
      let summary: { id: string; latest_version_label?: string | null } | undefined;
      if (module) { const all = await listModules(); summary = missing(all) ? undefined : all.find((m) => m.code === code); }
      else summary = (await listSurveys()).find((s) => s.code === code);
      if (!summary) return { state: 'missing' } as Load;
      const o = open(await loadDraft(summary.id), versionLabelOf(summary.latest_version_label), await libraryAvailable().catch(() => false));
      return { state: 'ready', baseline: o.baseline, ws: o.ws } as Load;
    })().then((l) => { if (mine === attempt.current) setLoad(l); })
      .catch((e) => { if (mine !== attempt.current) return; setLoad(e instanceof MappingError ? { state: 'unsupported', message: e.message } : e instanceof ApiFailure && e.status === 404 ? { state: 'missing' } : { state: 'error', message: say(e) }); });
  }, [code, module]);
  useEffect(() => { if (load.state === 'loading') fetchDraft(); /* only on first arrival */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const remember = useCallback((b: Baseline) => { baselines.set(memory, b); }, [memory]);

  if (load.state === 'loading') return (<><Bar crumbs={['Survey Studio', code]} /><p className="ss-loading page" role="status" data-testid="ss-loading"><span className="ss-spinner" aria-hidden="true" /> Loading the saved draft of {code}…</p></>);
  if (load.state === 'missing') return (<><Bar crumbs={['Survey Studio', module ? 'Module not found' : 'Survey not found']} /><div className="ss-empty page" data-testid="ss-missing"><p><strong>There is no {what} {code} that you can open.</strong> It may not exist, {module ? 'standalone modules may not be switched on for this server, ' : ''}or it may belong to a market you do not work in.</p><Link className="ss-btn" to="/survey-studio">Back to Survey Studio</Link></div></>);
  if (load.state === 'error') return (<><Bar crumbs={['Survey Studio', code]} /><div className="ss-empty page" role="alert" data-testid="ss-load-error"><p><strong>The saved draft could not be loaded.</strong> {load.message}</p><button type="button" className="ss-btn" onClick={fetchDraft}>Try again</button></div></>);
  if (load.state === 'unsupported') return (<><Bar crumbs={['Survey Studio', code]} /><div className="ss-empty page" role="alert" data-testid="ss-unsupported"><p><strong>This editor cannot open the saved draft without losing something, so it has not opened it.</strong> {load.message}</p><Link className="ss-btn" to="/survey-studio">Back to Survey Studio</Link></div></>);

  if (load.ws) baselines.set(memory, load.baseline);
  const ws = load.ws;
  if (place) {
    return (
      <PlaceProvider value={place}>
        <StudioProvider key={memory} memoryKey={memory} initial={() => ws!} normalize={keepFrame}>
          <PersistenceProvider initial={load.baseline} onBaseline={remember}>
            <LibraryProvider>
              <Routes>
                <Route index element={<ModuleBuild />} />
                <Route path="test" element={<ModuleTestPage />} />
                <Route path="review" element={<ReviewPage />} />
                <Route path="candidates/:candidateId" element={<CandidatePage />} />
                <Route path="versions/:versionId" element={<VersionPage />} />
                <Route path="*" element={<Missing />} />
              </Routes>
            </LibraryProvider>
          </PersistenceProvider>
        </StudioProvider>
      </PlaceProvider>
    );
  }
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
