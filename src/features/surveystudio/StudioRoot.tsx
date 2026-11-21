// Survey Studio prototype (SS-02A) — entry point, shared top bar and routes.
// Shown only when the build setting VITE_SURVEY_STUDIO_PROTOTYPE=1 is on (see flag.ts). Sample data only.
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import '../../styles/survey-studio.css';
import { BuilderPage } from './BuilderPage';
import { ComposerPage } from './ComposerPage';
import { HomePage } from './HomePage';
import { ReviewPage } from './ReviewPage';
import { SimulatorPage } from './SimulatorPage';
import { ValidationPage } from './ValidationPage';
import { fingerprint } from './model/canonical';
import { addDemoSurvey, demoBaseline } from './model/demo';
import { seedPublication, snapshot } from './model/governance';
import { addLargeModule } from './model/large';
import type { Issue } from './model/types';
import { StudioProvider, useStudio } from './store';
import { Glyph, Popover } from './ui';

export function StudioRoot() {
  return (
    <StudioProvider>
      <div className="ss" data-testid="survey-studio">
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="surveys/:surveyId" element={<ComposerPage />} />
          <Route path="surveys/:surveyId/simulate" element={<SimulatorPage />} />
          <Route path="surveys/:surveyId/validate" element={<ValidationPage />} />
          <Route path="surveys/:surveyId/review" element={<ReviewPage />} />
          <Route path="surveys/:surveyId/modules/:instanceId" element={<BuilderPage />} />
          <Route path="modules/:moduleKey" element={<BuilderPage />} />
        </Routes>
      </div>
    </StudioProvider>
  );
}

export interface Crumb { label: string; to?: string }

/** Breadcrumb, definition/instance badge, undo and redo, the issues list and the standing "not saved" message. */
export function StudioBar({ crumbs, badge, issues, onIssue, wording }: {
  crumbs: Crumb[]; badge?: ReactNode; issues?: Issue[]; onIssue?: (i: Issue) => void;
  /** Question versions in scope and how many carry unapproved wording — shown apart from routing. */
  wording?: { total: number; unapproved: number };
}) {
  const { ws, apply, undo, redo, undoLabel, redoLabel, notice, reset, govern } = useStudio();
  const nav = useNavigate();
  // one value for the whole canonical model: equal models give equal values, whichever view made the edits
  const stamp = useMemo(() => fingerprint(ws), [ws]);
  const errors = issues?.filter((i) => i.severity === 'ERROR') ?? [];
  // "Next issue" walks the open problems in order; F8 does the same from the keyboard.
  const at = useRef(0);
  const next = useRef<() => void>(() => undefined);
  next.current = () => {
    if (!errors.length || !onIssue) return;
    const issue = errors[at.current % errors.length]!;
    at.current = (at.current + 1) % errors.length;
    onIssue(issue);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'F8') { e.preventDefault(); next.current(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="ss-bar">
      <nav className="ss-crumbs" aria-label="Survey Studio breadcrumb">
        {crumbs.map((c, i) => (
          <Fragment key={`${c.label}-${i}`}>
            {i ? <Glyph name="right" size={13} /> : null}
            {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </Fragment>
        ))}
        {badge}
      </nav>
      <div className="ss-bar-tools">
        <span hidden data-testid="ss-model-fingerprint">{stamp}</span>
        <span className="ss-notice" role="status" aria-live="polite" key={notice?.at ?? 0}>{notice?.text ?? ''}</span>
        <button type="button" className="ss-tool" onClick={undo} disabled={!undoLabel} title={undoLabel ? `Undo: ${undoLabel}` : 'Nothing to undo'} data-testid="ss-undo">
          <Glyph name="undo" /> Undo
        </button>
        <button type="button" className="ss-tool" onClick={redo} disabled={!redoLabel} title={redoLabel ? `Redo: ${redoLabel}` : 'Nothing to redo'} data-testid="ss-redo">
          <Glyph name="redo" /> Redo
        </button>
        {issues && errors.length ? (
          <button type="button" className="ss-tool warn" onClick={() => next.current()} title="Go to the next thing to fix (F8)" aria-keyshortcuts="F8" data-testid="ss-next-issue">
            <Glyph name="next" /> Next issue
          </button>
        ) : null}
        {issues ? (
          <Popover label="Readiness" align="end" wide
            trigger={(p) => (
              <button type="button" className={`ss-tool ${errors.length ? 'warn' : 'routed'}`} {...p} data-testid="ss-issues">
                <Glyph name={errors.length ? 'alert' : 'check'} />
                {errors.length ? `${errors.length} to fix` : 'Routing complete'}
              </button>
            )}>
            {(close) => (
              <div className="ss-issues" data-testid="ss-issues-list">
                <h3>Readiness</h3>
                <dl className="ss-ready" data-testid="ss-readiness">
                  <div className={errors.length ? 'warn' : 'done'}><dt>Routing structure</dt>
                    <dd>{errors.length ? `${errors.length} to fix — listed below.` : 'Complete: every answer leads somewhere and every path ends.'}</dd></div>
                  <div className={wording && wording.unapproved ? 'warn' : 'done'}><dt>Wording approval</dt>
                    <dd>{wording ? (wording.unapproved ? `${wording.unapproved} of ${wording.total} question${wording.total === 1 ? '' : 's'} use wording that is not approved.` : `All ${wording.total} questions use approved wording.`) : 'Not assessed here.'}</dd></div>
                  <div className="warn"><dt>Ready to publish</dt>
                    <dd><strong>No.</strong> {errors.length ? 'Routing is incomplete. ' : ''}{wording && wording.unapproved ? 'Wording is not approved. ' : ''}The Validate step shows everything that stands in the way. Review and publishing in this prototype are a simulation: nothing is really approved or published.</dd></div>
                </dl>
                {errors.length ? <h3>Routing — fix these</h3> : null}
                <ul>
                  {errors.map((i) => (
                    <li key={i.id}>
                      <button type="button" onClick={() => { onIssue?.(i); close(); }}>
                        <Glyph name="alert" />
                        <span><strong>{i.message}</strong><small>{i.fix}</small></span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="ss-muted">Checked by the prototype's own routing rules. A real submission is validated by the server.</p>
              </div>
            )}
          </Popover>
        ) : null}
        <Popover label="About this prototype" align="end"
          trigger={(p) => <button type="button" className="ss-proto" {...p} data-testid="ss-prototype-tag" title="Sample data in memory only. Nothing is saved; reloading the page starts again."><Glyph name="info" size={14} /> Prototype · not saved</button>}>
          {(close) => (
            <div className="ss-about">
              <h3>This is a prototype — nothing is saved</h3>
              <p>Everything here is sample data held in memory while this page is open. Nothing is stored in the browser or sent to the Call360 server, nothing can be published, and reloading the page starts again from the sample library.</p>
              <p>Previews and checks come from a small demonstration evaluator in the browser. They illustrate the design; they are not the Call360 runtime.</p>
              <p>Model fingerprint <span className="ss-code" data-testid="ss-fingerprint-shown">{stamp}</span> — one value for the whole model. The Guided and Graph views edit the same model, so equivalent edits give the same value.</p>
              <button type="button" className="ss-btn" data-testid="ss-add-demo"
                onClick={() => {
                  const [next, id] = addDemoSurvey(ws);
                  apply('Added the demonstration survey', () => [next, id]);
                  // an earlier revision, seeded as a clearly labelled simulated publication, so revisions can be compared at once
                  const before = demoBaseline(next, id);
                  govern((g) => seedPublication(g, snapshot(before, before.surveys.find((x) => x.id === id)!), Date.UTC(2026, 9, 12, 2, 30)));
                  close();
                  nav(`/survey-studio/surveys/${id}/simulate`);
                }}>Add a demonstration survey and simulate it</button>
              <button type="button" className="ss-btn" data-testid="ss-add-large"
                onClick={() => { const key = apply('Added the 40-question sample module', addLargeModule); close(); if (key) nav(`/survey-studio/modules/${encodeURIComponent(key)}`); }}>Add a 40-question sample module</button>
              <button type="button" className="ss-btn" onClick={() => { reset(); close(); }} data-testid="ss-reset">Reset to the sample library</button>
            </div>
          )}
        </Popover>
      </div>
    </div>
  );
}
