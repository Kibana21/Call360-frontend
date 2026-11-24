// Survey Studio (UX-HOME-1 + NAV-1) — one survey at a glance, before any editor is opened. READ ONLY.
// It reads the survey's current draft documents and its history through the operations the composer and the review
// screens already use, and lays out the modules in the order the survey runs them, with how each is entered and where
// each of its endings leads. A module that is published in the library opens in the inspector from here.
import { ApplicabilityWhereUsed } from '../../applicability/WhereUsed';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { Glyph, Tag } from '../ui';
import { loadDraft, type Component, type DraftDocuments, type SurveySummary } from './api';
import { useDialogFocus } from './focus';
import type { Inspect } from './Inspector';
import { EVENT_LABEL, STATUS_LABEL, getHistory, short, type SurveyHistory } from './reviewApi';
import { answerOf, words } from './workspaceApi';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- draft documents are read as JSON
const say = (e: unknown) => (e instanceof ApiFailure ? e.message : 'The server could not be reached.');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function SurveyOverviewDrawer({ survey, facts, published, onInspect, onClose }: { survey: SurveySummary; facts: Any | null; published: Component[]; onInspect: (c: Inspect) => void; onClose: () => void }) {
  const { can } = useAuth();
  const [draft, setDraft] = useState<DraftDocuments | null>(null);
  const [history, setHistory] = useState<SurveyHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    let current = true;
    setDraft(null); setHistory(null); setError(null);
    loadDraft(survey.id).then((d) => { if (current) setDraft(d); }).catch((e) => { if (current) setError(say(e)); });
    getHistory(survey.id).then((h) => { if (current) setHistory(h); }).catch(() => undefined);
    return () => { current = false; };
  }, [survey.id]);
  useDialogFocus(panel, onClose);
  const assets = (draft?.assets ?? []) as Any[];
  const docOf = (kind: string, code: string, version: number) => assets.find((a) => a.kind === kind && a.code === code && a.version === version) as Any | undefined;
  const sequence = (((draft?.content as Any)?.sequence ?? []) as Any[]);
  const isPublished = (code: string, version: number) => published.some((c) => c.code === code && c.version === version);
  const review = survey.open_candidate_status ? words(survey.open_candidate_status) : null;
  const byKind = (k: string) => assets.filter((a) => a.kind === k);
  return (
    <div className="ss-in-scrim" data-testid="ss-so-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="ss-in ss-so" role="dialog" aria-modal="true" aria-labelledby="ss-so-title" tabIndex={-1} ref={panel} data-testid="ss-survey-overview" data-code={survey.code} data-loaded={String(!!draft)}>
        <header className="ss-in-head">
          <div className="ss-in-head-main">
            <p className="ss-in-kind"><Glyph name="list" size={14} /> Survey · market {survey.market_code}</p>
            <h2 id="ss-so-title" className="ss-title">{survey.name}</h2>
            {survey.purpose ? <p className="ss-in-lede">{survey.purpose}</p> : null}
            <p className="ss-in-meta">
              {review ? <Tag tone="warn">{review}</Tag> : survey.latest_version_label ? <Tag tone="ok">Version {survey.latest_version_label} published</Tag> : <Tag tone="draft">Never published</Tag>}
              <Tag>Draft revision {survey.draft_revision}</Tag>
              {facts ? <><span className="ss-muted">{plural(facts.modules, 'module')} · {plural(facts.questions, 'question')} · {plural(facts.statements, 'statement')} · {plural(facts.decisions, 'decision')}</span>{facts.branching ? <Tag tone="warn">Branches</Tag> : <Tag>No branching</Tag>}</> : null}
            </p>
          </div>
          <button type="button" className="ss-icon-btn" onClick={onClose} aria-label="Close the survey overview" data-testid="ss-so-close"><Glyph name="close" /></button>
        </header>
        <div className="ss-in-actions" data-testid="ss-so-actions">
          <Link className="ss-btn primary" to={`/survey-studio/surveys/${survey.code}`} data-testid={`ss-so-open-${survey.code}`}>{can('survey.edit') ? 'Open the builder' : 'Open the survey'}</Link>
          {survey.latest_version_id ? <Link className="ss-btn" to={`/survey-studio/surveys/${survey.code}/versions/${survey.latest_version_id}`} data-testid="ss-so-version">View published version {survey.latest_version_label}</Link> : null}
          {survey.latest_version_id && can('survey.simulate') ? <Link className="ss-btn" to={`/survey-studio/surveys/${survey.code}/simulate`} data-testid="ss-so-simulate">Simulate</Link> : null}
          <Link className="ss-btn" to={`/survey-studio/surveys/${survey.code}/review`} data-testid="ss-so-governance">Review and governance</Link>
        </div>
        <ApplicabilityWhereUsed code={survey.code} />
        {error ? <div className="ss-empty" role="alert"><p><strong>This survey’s content cannot be shown.</strong> {error}</p></div> : null}
        {!draft && !error ? <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading the survey…</p> : null}
        {draft ? (
          <div className="ss-in-body">
            <details className="ss-in-section" open data-testid="ss-so-structure">
              <summary><h3>What it contains, in the order it runs</h3><span className="ss-in-count">{plural(sequence.length, 'module')} · current draft</span></summary>
              <div className="ss-in-section-body">
                {sequence.length ? (
                  <ol className="ss-so-modules">
                    {sequence.map((inst, n) => {
                      const ref = inst.module ?? {};
                      const m = docOf('MODULE', ref.code, ref.revision);
                      const doc = (m?.document ?? {}) as Any;
                      const nodes = (doc.nodes ?? []) as Any[];
                      const routes = (Array.isArray(inst.routes) ? inst.routes.map((x: Any) => [x.on, x.to]) : Object.entries(inst.routes ?? {})) as Array<[string, Any]>;
                      const cond = inst.entry?.binding?.condition;
                      const condDoc = cond ? (docOf('CONDITION', cond.code, cond.version)?.document as Any) : null;
                      const pub = isPublished(ref.code, ref.revision);
                      return (
                        <li key={inst.instance} data-testid={`ss-so-module-${inst.instance}`} data-published={String(pub)}>
                          <header>
                            <span className="ss-in-step-n">{n + 1}</span>
                            <strong>{doc.name ?? ref.code}</strong>
                            {pub ? <Tag tone="ok">Published · revision {ref.revision}</Tag> : <Tag tone="draft">{m?.state === 'DRAFT' ? 'Draft' : 'Not in the library'} · revision {ref.revision}</Tag>}
                            {m && !m.owned ? <Tag tone="shared">Reused</Tag> : null}
                            {pub ? <button type="button" className="ss-btn small" onClick={() => onInspect({ kind: 'MODULE', code: ref.code, version: ref.revision })} data-testid={`ss-so-inspect-${inst.instance}`}>Inspect</button>
                              : <Link className="ss-btn small" to={`/survey-studio/surveys/${survey.code}/modules/${inst.instance}`}>Open in the builder</Link>}
                          </header>
                          <dl className="ss-in-facts">
                            <div><dt>Entered</dt><dd>{cond ? `only when “${condDoc?.name ?? cond.code}” is met${Object.keys(inst.entry.binding.params ?? {}).length ? ` (${Object.entries(inst.entry.binding.params).map(([k, v]) => `${k} = ${String(v)}`).join(', ')})` : ''}; if that cannot be decided: ${words(inst.entry.binding.unknown_policy)}` : 'always'}</dd></div>
                            <div><dt>Contains</dt><dd>{nodes.length ? nodes.map((x) => { const r = x.item ?? x.question; const item = r ? (docOf('ITEM', r.code, r.version)?.document as Any) : null; return x.type === 'DECISION' ? 'a decision' : (item?.answer_type === 'STATEMENT' || x.type === 'STATEMENT') ? 'a statement' : `a question (${answerOf(item?.answer_type).label.toLowerCase()})`; }).join(', ') : 'nothing yet'}</dd></div>
                            <div><dt>Then</dt><dd>{routes.map(([on, to]) => `${words(on)} → ${to === '@CONTINUE' ? 'the next module' : to?.survey_outcome ? `the survey ends: ${words(to.survey_outcome)}` : to?.instance ? `module ${to.instance}` : JSON.stringify(to)}`).join(' · ') || 'not stated'}</dd></div>
                          </dl>
                        </li>
                      );
                    })}
                  </ol>
                ) : <p className="ss-muted" data-testid="ss-so-empty">This survey has no module yet. Open the builder and choose “New module”, or add one from the library.</p>}
              </div>
            </details>
            <details className="ss-in-section" data-testid="ss-so-dependencies">
              <summary><h3>Dependencies</h3><span className="ss-in-count">{plural(assets.length, 'document')}</span></summary>
              <div className="ss-in-section-body">
                <p className="ss-muted">Every document the current draft holds or pins, by exact version. “Own” was made in this survey; the rest are pinned from the library.</p>
                <table className="ss-table"><thead><tr><th scope="col">Kind</th><th scope="col">Code</th><th scope="col">Version</th><th scope="col">State</th><th scope="col">Fingerprint</th></tr></thead>
                  <tbody>{['MODULE', 'ITEM', 'WORDING', 'CONDITION', 'OPTION_SET'].flatMap((k) => byKind(k)).map((a) => <tr key={`${a.kind}-${a.code}-${a.version}`}><td>{words(a.kind)}</td><td><span className="ss-code">{a.code}</span></td><td>{a.version}</td><td>{a.owned ? 'own' : 'pinned'} · {words(a.state)}</td><td><span className="ss-code" title={a.sha256}>{short(a.sha256)}</span></td></tr>)}</tbody></table>
              </div>
            </details>
            <details className="ss-in-section" open data-testid="ss-so-history">
              <summary><h3>Versions and governance</h3><span className="ss-in-count">{history ? `${plural(history.versions.length, 'published version')} · ${plural(history.candidates.length, 'submission')}` : ''}</span></summary>
              <div className="ss-in-section-body">
                {!history ? <p className="ss-muted">Loading its history…</p> : (
                  <>
                    {(history.versions as Any[]).length ? <ul className="ss-in-revisions">{(history.versions as Any[]).map((v) => <li key={v.id}><strong>Version {v.label}</strong><Tag tone={v.status === 'PUBLISHED' ? 'ok' : 'plain'}>{STATUS_LABEL[v.status] ?? words(v.status)}</Tag><span className="ss-muted"> published {new Date(v.published_at).toLocaleString()}{v.published_by?.name ? ` by ${v.published_by.name}` : ''} · from submission {v.candidate_n}</span><span className="ss-in-row-actions"><Link to={`/survey-studio/surveys/${survey.code}/versions/${v.id}`}>Open</Link></span></li>)}</ul> : <p className="ss-muted">No version has been published.</p>}
                    {(history.candidates as Any[]).length ? <><h4>Submissions</h4><ul className="ss-in-revisions">{(history.candidates as Any[]).map((c) => <li key={c.id}><strong>Submission {c.n}</strong><Tag tone={c.status === 'IN_REVIEW' || c.status === 'APPROVED' ? 'warn' : 'plain'}>{STATUS_LABEL[c.status] ?? words(c.status)}</Tag><span className="ss-muted"> submitted {new Date(c.submitted_at).toLocaleDateString()}{c.submitted_by?.name ? ` by ${c.submitted_by.name}` : ''}{c.last_event ? ` · ${(EVENT_LABEL[c.last_event] ?? words(c.last_event)).toLowerCase()}${c.last_event_by?.name ? ` by ${c.last_event_by.name}` : ''}` : ''}</span><span className="ss-in-row-actions"><Link to={`/survey-studio/surveys/${survey.code}/candidates/${c.id}`}>Open</Link></span></li>)}</ul></> : null}
                  </>)}
              </div>
            </details>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
