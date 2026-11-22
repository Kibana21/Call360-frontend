// Survey Studio (NAV-1) — "Simulation & Evaluation": one place that says which simulator and which evaluation screen
// is for what, and opens it. A navigation page only. Call360 has two execution engines — the survey engine (Survey
// Studio) and the script engine (Script Studio's Simulation Workbench) — with different contracts; they are listed
// here as separate modes and nothing here merges, replaces or runs either. Everything is a link to an existing screen.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { Glyph, Tag, type GlyphName } from '../ui';
import { listSurveys, type SurveySummary } from './api';
import { listJourneys, type JourneyRef } from './evalApi';
import { journeyLink } from './JourneyPage';

function Mode({ glyph, title, text, engine, testid, children }: { glyph: GlyphName; title: string; text: string; engine: string; testid: string; children: ReactNode }) {
  return (
    <section className="ss-ws-panel ss-hub-mode" aria-label={title} data-testid={testid}>
      <header><h2><span className="ss-ws-way-glyph"><Glyph name={glyph} size={18} /></span> {title}</h2><Tag>{engine}</Tag></header>
      <p className="ss-ws-hint">{text}</p>
      {children}
    </section>
  );
}
const No = ({ children }: { children: ReactNode }) => <p className="ss-ws-quiet">{children}</p>;

export function SimulationHubPage() {
  const { can } = useAuth();
  const [surveys, setSurveys] = useState<SurveySummary[] | null>(null);
  const [journeys, setJourneys] = useState<JourneyRef[] | null>(null);
  useEffect(() => {
    let current = true;
    listSurveys().then((s) => { if (current) setSurveys(s); }).catch(() => { if (current) setSurveys([]); });
    if (can('survey.evaluation.read')) listJourneys().then((j) => { if (current) setJourneys(j); }).catch(() => { if (current) setJourneys([]); });
    return () => { current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- `can` follows the signed-in person
  const published = (surveys ?? []).filter((s) => s.latest_version_label);
  const coordinated = (journeys ?? []).filter((j) => j.kind === 'COORDINATED');
  return (
    <>
      <div className="ss-bar">
        <nav className="ss-crumbs" aria-label="Survey Studio breadcrumb"><Link to="/survey-studio">Survey Studio</Link><Glyph name="right" size={13} /><span aria-current="page">Simulation &amp; Evaluation</span></nav>
        <div className="ss-bar-tools"><span className="ss-proto saved-mode"><Glyph name="info" size={14} /> Simulation · synthetic</span></div>
      </div>
      <div className="ss-ws ss-hub" data-testid="ss-hub">
        <header className="ss-ws-head">
          <div className="ss-ws-head-text"><h1 className="ss-title">Simulation &amp; Evaluation</h1><p>Try a survey before anyone is called, follow one invented application end to end, and see what its answers mean for the controls. Nothing here calls a customer or creates an operational finding.</p></div>
        </header>
        <div className="ss-hub-grid">
          <Mode glyph="next" title="Survey simulator" engine="Survey engine" testid="ss-hub-simulator" text="Run one published survey step by step, with the exact wording and branches of its pinned version.">
            {!can('survey.simulate') ? <No>Simulating needs the “simulate surveys” permission.</No>
              : surveys === null ? <No>Loading…</No>
                : published.length ? <ul className="ss-ws-rows scroll short">{published.map((s) => <li key={s.id}><Link to={`/survey-studio/surveys/${s.code}/simulate`} data-testid={`ss-hub-sim-${s.code}`}><span className="ss-ws-row-main"><strong>{s.name}</strong><small>Version {s.latest_version_label}</small></span><span className="ss-btn small">Simulate</span></Link></li>)}</ul>
                  : <No>No survey is published yet. A survey can be simulated once a version of it is published.</No>}
          </Mode>
          <Mode glyph="branch" title="Coordinated simulation" engine="Survey engine" testid="ss-hub-coordinated" text="Several surveys for one application, one after another, in the governed order. It starts from a composite call plan.">
            {can('survey.assignment.read') ? <p><Link className="ss-btn" to="/survey-studio/assignment" data-testid="ss-hub-open-assignment">Compose a call plan in Survey assignment</Link></p> : <No>Composing a call plan needs the “read survey assignment” permission.</No>}
            {coordinated.length ? <><h3>Recent coordinated simulations</h3><ul className="ss-ws-rows scroll short">{coordinated.slice(0, 8).map((j) => <li key={j.id}><Link to={`/survey-studio/coordinated-simulations/${j.id}`} data-testid={`ss-hub-co-${j.id}`}><span className="ss-ws-row-main"><strong>{j.label || j.title}</strong><small>{j.surveys} surveys · {new Date(j.created_at).toLocaleString()}</small></span><Glyph name="right" size={14} /></Link></li>)}</ul></> : journeys !== null ? <No>No coordinated simulation has been run yet.</No> : null}
          </Mode>
          <Mode glyph="list" title="Application journeys" engine="Read only" testid="ss-hub-journeys" text="One invented application followed from what was required, through each survey, to its evaluation and assurance.">
            {can('survey.evaluation.read') ? (<>
              <p><Link className="ss-btn" to="/survey-studio/journeys" data-testid="ss-hub-open-journeys">Open application journeys</Link></p>
              {(journeys ?? []).length ? <ul className="ss-ws-rows scroll short">{(journeys ?? []).slice(0, 5).map((j) => <li key={j.id}><Link to={journeyLink(j.kind, j.id)}><span className="ss-ws-row-main"><strong>{j.label || j.title}</strong><small>{j.kind === 'COORDINATED' ? `${j.surveys} surveys, coordinated` : 'one survey'}</small></span><Glyph name="right" size={14} /></Link></li>)}</ul> : null}
            </>) : <No>Reading journeys needs the “read control evaluations” permission.</No>}
          </Mode>
          <Mode glyph="check" title="Control evaluation, coverage and findings" engine="Evaluation engines" testid="ss-hub-evaluation" text="A simulated journey checked control by control: outcomes, evidence coverage, and findings from the published finding rules. Opened from a journey.">
            {can('survey.evaluation.read') ? <p className="ss-hub-links"><Link className="ss-btn" to="/survey-studio/journeys">Choose a journey to evaluate</Link><Link className="ss-btn" to="/survey-studio/controls" data-testid="ss-hub-open-controls">Control policies and evidence</Link></p> : <No>Needs the “read control evaluations” permission.</No>}
          </Mode>
          <Mode glyph="lock" title="Execution assurance" engine="Assurance verifier" testid="ss-hub-assurance" text="Whether the recorded execution of a journey followed the survey versions it pinned. Shown beside a journey’s evaluation, in the Evaluation Workbench.">
            {can('survey.evaluation.read') ? <p><Link className="ss-btn" to="/survey-studio/journeys">Open it from a journey</Link></p> : <No>Needs the “read control evaluations” permission.</No>}
          </Mode>
          <Mode glyph="text" title="Simulation Workbench (scripts)" engine="Script engine · legacy" testid="ss-hub-scripts" text="The existing workbench for Script Studio’s linear scripts: scenarios, dry runs and answer evaluation. A different engine and contract from surveys; kept as it is.">
            {can('script.read') ? <p><Link className="ss-btn" to="/simulator" data-testid="ss-hub-open-simulator">Open the Simulation Workbench</Link></p> : <No>Needs the Script Studio read permission.</No>}
          </Mode>
        </div>
        <p className="ss-note"><Glyph name="info" size={14} /><span>The operational <strong>Review Workbench</strong> is a different thing: it reviews real callback cases and their findings and decisions. Nothing simulated or evaluated here is written there.{can('queue.read') ? <> <Link to="/reviews">Open the Review Workbench</Link>.</> : null}</span></p>
      </div>
    </>
  );
}
