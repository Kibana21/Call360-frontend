// Survey Studio prototype (SS-02C) — Screen I, part 2: review, comparison and publishing, as a SIMULATED demonstration.
// Draft → Validate → Submit → Reviewer inspection → Approve or reject → Publish an immutable version → History.
// Nothing here is a real governance approval and no survey is published to Call360; every such word is labelled.
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { JourneyNav, STAGE_LABEL, useGovernance, when, who } from './JourneyNav';
import { CHANGE_AREAS, compare, type Comparison } from './model/diff';
import {
  canAuthor, canCheck, canPublish, decide, decideProblem, govOf, person, publish, publishProblem, snapshot, submit, submitProblem, withdraw,
  type Lock, type Readiness, type Snapshot, type Standing, type Submission, type SurveyGov,
} from './model/governance';
import { findSurvey } from './model/ops';
import type { Survey } from './model/types';
import { StudioBar } from './StudioRoot';
import { useStudio } from './store';
import { Glyph, Tag } from './ui';

type Tab = 'review' | 'compare' | 'history';
const STEPS: Array<{ id: string; label: string }> = [{ id: 'DRAFT', label: 'Draft' }, { id: 'VALID', label: 'Validated' }, { id: 'IN_REVIEW', label: 'In review' }, { id: 'APPROVED', label: 'Approved' }, { id: 'PUBLISHED', label: 'Published' }];

export function ReviewPage() {
  const { surveyId = '' } = useParams();
  const { ws, gov } = useStudio();
  const [params, setParams] = useSearchParams();
  const survey = findSurvey(ws, surveyId);
  const { readiness: r, standing: st } = useGovernance(survey);
  if (!survey || !r || !st) {
    return (<><StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: 'Survey not found' }]} />
      <div className="ss-empty page"><p><strong>This survey is not in the prototype workspace.</strong> It may have been cleared by a reset.</p>
        <Link className="ss-btn" to="/survey-studio">Back to Survey Studio</Link></div></>);
  }
  const sg = govOf(gov, survey.id);
  const tab: Tab = params.get('tab') === 'compare' ? 'compare' : params.get('tab') === 'history' ? 'history' : 'review';
  const go = (t: Tab) => setParams(t === 'review' ? {} : { tab: t }, { replace: true });
  const base = `/survey-studio/surveys/${survey.id}`;
  const reached = st.stage === 'PUBLISHED' ? 4 : st.stage === 'APPROVED' ? 3 : st.stage === 'IN_REVIEW' ? 2 : r.ready ? 1 : 0;
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [{ id: 'review', label: 'Review' }, { id: 'compare', label: 'Compare revisions' }, { id: 'history', label: 'Publication history and audit', count: sg.publications.length }];

  return (
    <>
      <StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: survey.name, to: base }, { label: 'Review and publish' }]} badge={<Tag tone="draft">Draft v{survey.versionLabel}</Tag>} />
      <JourneyNav survey={survey} at="review" />
      <div className="ss-rev" data-testid="ss-review">
        <p className="ss-simulated" data-testid="ss-simulated-banner" role="note"><Glyph name="info" size={16} />
          <span><strong>Simulated demonstration.</strong> Submitting, approving and publishing here happen only in this browser tab, between invented people. Nothing is a real governance approval, no wording is approved by anyone, and no survey is published to Call360 or used on a call.</span></p>

        <header className="ss-rev-head">
          <div>
            <h1 className="ss-title">Review and publish</h1>
            <p className="ss-rev-standing" data-testid="ss-standing" data-stage={st.stage}><Tag tone={st.stage === 'APPROVED' || st.stage === 'PUBLISHED' ? 'ok' : st.stage === 'REJECTED' ? 'warn' : 'draft'}>{STAGE_LABEL[st.stage]}</Tag> {st.text}. <span className="ss-muted">Draft fingerprint <span className="ss-code" data-testid="ss-rev-fingerprint">{st.fingerprint}</span></span></p>
          </div>
          <ol className="ss-lifecycle" aria-label="Lifecycle of this draft" data-testid="ss-lifecycle">
            {STEPS.map((s, i) => <li key={s.id} className={i < reached ? 'done' : i === reached ? 'here' : ''} aria-current={i === reached ? 'step' : undefined}>{i < reached ? <Glyph name="check" size={12} /> : null}{s.label}</li>)}
          </ol>
        </header>

        <div className="ss-tabs" role="tablist" aria-label="Review and publish">
          {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)} data-testid={`ss-tab-${t.id}`}>{t.label}{t.count ? <span className="ss-count">{t.count}</span> : null}</button>)}
        </div>

        {tab === 'review' ? <ReviewTab survey={survey} r={r} st={st} sg={sg} onCompare={() => go('compare')} /> : null}
        {tab === 'compare' ? <CompareTab survey={survey} sg={sg} /> : null}
        {tab === 'history' ? <HistoryTab sg={sg} /> : null}
      </div>
    </>
  );
}

// ---- the review itself ---------------------------------------------------------------------------------------------------
/** The identity of a frozen candidate: what a review, an approval and a publication are bound to. */
function CandidateId({ c }: { c: Submission }) {
  return (
    <dl className="ss-cand" data-testid="ss-candidate" data-candidate={c.id}>
      <div><dt>Candidate</dt><dd><strong>{c.id}</strong></dd></div>
      <div><dt>Revision</dt><dd>{c.n}</dd></div>
      <div><dt>Content fingerprint</dt><dd><span className="ss-code">{c.candidate.fingerprint}</span></dd></div>
      <div><dt>Dependency manifest</dt><dd><span className="ss-code" data-testid="ss-manifest">{c.manifestHash}</span> <small>{c.manifest.modules.length} modules · {c.manifest.questions.length} questions · {c.manifest.conditions.length} conditions</small></dd></div>
      <div><dt>State</dt><dd><Tag glyph="lock">Frozen</Tag> <small>It cannot be edited. The draft is a separate thing.</small></dd></div>
    </dl>
  );
}

function ReviewTab({ survey, r, st, sg, onCompare }: { survey: Survey; r: Readiness; st: Standing; sg: SurveyGov; onCompare: () => void }) {
  const { ws, gov, govern } = useStudio();
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [read, setRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/survey-studio/surveys/${survey.id}`;
  const me = person(gov.actor);
  const run = (step: Parameters<typeof govern>[0], then?: () => void) => { const problem = govern(step); setError(problem); if (!problem) then?.(); };
  const cantSubmit = submitProblem(gov, ws, survey);
  const cantDecide = decideProblem(gov, survey);
  const cantPublish = publishProblem(gov, survey);
  const sub = st.candidate;
  const open = !!sub && (sub.status === 'IN_REVIEW' || sub.status === 'APPROVED');
  // everything a reviewer or publisher sees comes from the FROZEN candidate, never from the draft as it is now
  const basis = sub ? sg.publications.filter((p) => p.candidate !== sub.id).slice(-1)[0]?.snapshot ?? null : null;
  const diff = useMemo(() => (basis && sub ? compare(basis, sub.candidate) : null), [basis, sub]);
  const canSubmitNow = st.stage === 'DRAFT' || st.stage === 'REJECTED' || (open && st.draftDiffers);

  return (
    <div className="ss-rev-grid">
      <section className="ss-rev-main" aria-label="What happens next">
        {st.stage === 'IN_REVIEW' && sub ? (
          <div className="ss-panel" data-testid="ss-inspect-panel">
            <h2>Reviewer inspection — candidate {sub.id}</h2>
            <CandidateId c={sub} />
            <p className="ss-rev-meta">Submitted by <strong>{who(sub.by)}</strong> on {when(sub.at)}</p>
            <blockquote className="ss-quote" data-testid="ss-inspect-note">{sub.note}</blockquote>

            <h3>What changed{diff ? ` since the last published version` : ''}</h3>
            {diff ? <DiffSummary d={diff} onOpen={onCompare} /> : <p className="ss-muted">This is the first candidate of this survey: there is no earlier version to compare with. Everything in it is new.</p>}

            <h3>Customer-facing wording to approve <span className="ss-count">{sub.wording.length}</span></h3>
            <p className="ss-muted">Sample text only: nothing here is approved AIA or MAS wording, and confirming it is a simulated step.</p>
            {sub.wording.length ? <ul className="ss-wording" data-testid="ss-inspect-wording">{sub.wording.map((q) => <li key={`${q.code}@${q.version}`}><span>“{q.text}”</span><small>{q.usedIn.join(', ')} · v{q.version} · {q.why}</small></li>)}</ul> : <p>No wording is new or changed.</p>}

            <h3>Pinned dependency manifest <span className="ss-code">{sub.manifestHash}</span></h3>
            <LockTable lock={sub.manifest} />

            <h3>Warnings the author acknowledged <span className="ss-count">{sub.acknowledged.length}</span></h3>
            {sub.acknowledged.length ? <ul className="ss-acks" data-testid="ss-inspect-acks">{sub.acknowledged.map((a, i) => <li key={i}><strong>{a.title}</strong><span>“{a.note}” — {who(a.by)}</span></li>)}</ul> : <p className="ss-muted">None.</p>}

            <div className="ss-decision" data-testid="ss-decision">
              <h3>Decision on candidate {sub.id}</h3>
              <p className="ss-muted">The decision is recorded against candidate {sub.id}, revision {sub.n}, manifest {sub.manifestHash} — and against nothing else.</p>
              {cantDecide ? <p className="ss-reason" data-testid="ss-decide-reason"><Glyph name="lock" size={14} /> {cantDecide}</p> : null}
              {sub.wording.length ? <label className="ss-check"><input type="checkbox" checked={read} disabled={!!cantDecide} onChange={(e) => setRead(e.target.checked)} data-testid="ss-wording-read" />
                <span><strong>I have read the {sub.wording.length} wording{sub.wording.length === 1 ? '' : 's'} listed above</strong><small>Required to approve.</small></span></label> : null}
              <label className="ss-field"><span>Comment <em>Required to send it back.</em></span>
                <textarea rows={2} value={comment} disabled={!!cantDecide} onChange={(e) => setComment(e.target.value)} data-testid="ss-decide-comment" /></label>
              <div className="ss-actions">
                <button type="button" className="ss-btn primary" disabled={!!cantDecide} onClick={() => run((g) => decide(g, survey, 'APPROVE', comment, read, Date.now()), () => { setComment(''); setRead(false); })} data-testid="ss-approve">Approve candidate {sub.id} (simulated)</button>
                <button type="button" className="ss-btn danger" disabled={!!cantDecide} onClick={() => run((g) => decide(g, survey, 'REJECT', comment, read, Date.now()), () => { setComment(''); setRead(false); })} data-testid="ss-reject">Send back for changes</button>
                {sub.by === gov.actor ? <button type="button" className="ss-btn" onClick={() => run((g) => withdraw(g, survey, Date.now()))} data-testid="ss-withdraw">Withdraw the candidate</button> : null}
              </div>
            </div>
          </div>
        ) : null}

        {st.stage === 'APPROVED' && sub?.decision ? (
          <div className="ss-panel" data-testid="ss-publish-panel">
            <h2>Candidate {sub.id} is approved — waiting for a publisher</h2>
            <CandidateId c={sub} />
            <p className="ss-rev-meta">Submitted by <strong>{who(sub.by)}</strong> · approved by <strong>{who(sub.decision.by)}</strong> on {when(sub.decision.at)}</p>
            {sub.decision.comment ? <blockquote className="ss-quote">{sub.decision.comment}</blockquote> : null}
            <p>Publishing makes version <strong>{sg.publications.length + 1}.0</strong> out of exactly this candidate and its manifest. It needs the <strong>Publisher permission</strong>, and a different person from the one who submitted it. Being an author or a checker does not grant it.</p>
            <LockTable lock={sub.manifest} />
            <div className="ss-actions">
              <button type="button" className="ss-btn primary" disabled={!!cantPublish} onClick={() => run((g) => publish(g, survey, Date.now()))} data-testid="ss-publish">Publish candidate {sub.id} as version {sg.publications.length + 1}.0 (simulated)</button>
              {cantPublish ? <span className="ss-reason" data-testid="ss-publish-reason"><Glyph name="lock" size={14} /> {cantPublish}</span> : <span className="ss-muted">Acting as {me.name}, who holds the Publisher permission.</span>}
            </div>
          </div>
        ) : null}

        {st.stage === 'PUBLISHED' && st.published ? (
          <div className="ss-panel ok" data-testid="ss-published-panel">
            <h2><Glyph name="check" size={16} /> Version {st.published.label} is published (simulated)</h2>
            <p>It is candidate {st.published.candidate}, revision {st.published.revision}, with manifest <span className="ss-code">{st.published.manifestHash}</span>. The draft is identical to it. Edit the survey to start the next revision; any change will need validation, a fresh review and a publisher.</p>
            <p className="ss-rev-links"><Link className="ss-btn small" to={base}><Glyph name="open" size={14} /> Open the survey</Link></p>
          </div>
        ) : null}

        {open && st.draftDiffers && sub ? (
          <div className="ss-void" data-testid="ss-draft-ahead" role="status">
            <h2><Glyph name="info" size={16} /> The draft has moved on from candidate {sub.id}</h2>
            <p>Candidate {sub.id} is frozen and is still {sub.status === 'APPROVED' ? 'approved' : 'in review'} exactly as it was submitted. The draft now has changes that are <strong>not in that candidate</strong> — they are not covered by its review{sub.status === 'APPROVED' ? ' or its approval' : ''}, and would not be published with it.
              {sub.status === 'APPROVED' ? ' The approval cannot be moved onto the draft, whatever the draft is changed to.' : ''} To have these changes reviewed, submit the draft as a new candidate: that closes {sub.id} and starts a fresh review.</p>
            <CandidateDiff from={sub.candidate} survey={survey} label={`What the draft has that candidate ${sub.id} does not`} />
          </div>
        ) : null}

        {canSubmitNow ? (
          <div className="ss-panel" data-testid="ss-submit-panel">
            <h2>{open ? `Submit the draft as a new candidate (closes ${sub!.id})` : st.stage === 'REJECTED' ? 'Change the draft, then submit a new candidate' : 'Submit this draft for review'}</h2>
            {st.stage === 'REJECTED' && sub?.decision ? <p className="ss-sent-back" data-testid="ss-sent-back"><strong>Candidate {sub.id} was sent back by {who(sub.decision.by)}:</strong> “{sub.decision.comment}”. That candidate is closed. Change the draft, then submit a new one.</p> : null}
            <dl className="ss-checklist" data-testid="ss-submit-checks">
              <div className={r.blockers ? 'no' : 'yes'}><dt><Glyph name={r.blockers ? 'stop' : 'check'} size={14} /> Structurally valid</dt><dd>{r.blockers ? `${r.blockers} blocker${r.blockers === 1 ? '' : 's'} to fix` : 'No blockers'}</dd></div>
              <div className={r.open ? 'no' : 'yes'}><dt><Glyph name={r.open ? 'alert' : 'check'} size={14} /> Warnings dealt with</dt><dd>{r.open ? `${r.open} of ${r.warnings} still to acknowledge` : r.warnings ? `All ${r.warnings} acknowledged with a reason` : 'None raised'}</dd></div>
              <div className="yes"><dt><Glyph name="info" size={14} /> Wording for the checker</dt><dd>{r.wording.toApprove.length} new or changed wording{r.wording.toApprove.length === 1 ? '' : 's'} to be read in review</dd></div>
              <div className="yes"><dt><Glyph name="lock" size={14} /> Versions that will be pinned</dt><dd>{r.lock.modules.length} modules · {r.lock.questions.length} questions · {r.lock.conditions.length} conditions</dd></div>
            </dl>
            {!r.ready ? <p><Link className="ss-btn" to={`${base}/validate`} data-testid="ss-rev-to-validate"><Glyph name="open" size={14} /> Open validation to deal with these</Link></p> : null}
            <label className="ss-field"><span>What changed, and why <em>Read by the checker and kept in the audit trail.</em></span>
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={!!cantSubmit} data-testid="ss-submit-note" placeholder="e.g. Adds a specialist call for older customers who are not comfortable with the premium." /></label>
            <div className="ss-actions">
              <button type="button" className="ss-btn primary" disabled={!!cantSubmit} onClick={() => run((g) => submit(g, ws, survey, note, Date.now()), () => setNote(''))} data-testid="ss-submit">Submit for review (simulated)</button>
              {cantSubmit ? <span className="ss-reason" data-testid="ss-submit-reason"><Glyph name="info" size={14} /> {cantSubmit}</span> : <span className="ss-muted">Submitting freezes a copy of this exact draft as candidate C-{sg.submissions.length + 1}. You can go on editing the draft; the candidate will not change.</span>}
            </div>
          </div>
        ) : null}
        {error ? <p className="ss-warn-text" role="alert" data-testid="ss-rev-error"><Glyph name="alert" size={14} /> {error}</p> : null}
      </section>

      <aside className="ss-rev-side" aria-label="Who does what">
        <h2>Three permissions, different people</h2>
        <ul className="ss-roles">
          <li className={canAuthor(me.id) ? 'me' : ''}><strong>Author (maker)</strong><span>Builds the survey, deals with validation, submits a candidate.</span></li>
          <li className={canCheck(me.id) ? 'me' : ''}><strong>Checker</strong><span>Inspects the frozen candidate, reads the wording, approves it or sends it back. Never the person who submitted it.</span></li>
          <li className={canPublish(me.id) ? 'me' : ''}><strong>Publisher</strong><span>Publishes an approved candidate as a version. A separate permission; never the person who submitted it.</span></li>
        </ul>
        <p className="ss-muted" data-testid="ss-acting">You are acting as <strong>{me.name}</strong>, {me.title.toLowerCase()}. Switch person in the bar above to play another part.</p>
        <h2>Latest events</h2>
        {sg.audit.length ? <ol className="ss-audit-mini">{sg.audit.slice(-4).reverse().map((a) => <li key={a.n}><strong>{a.action}{a.candidate ? ` · ${a.candidate}` : ''}</strong><span>{who(a.actor)} · {when(a.at)}</span></li>)}</ol> : <p className="ss-muted">Nothing has happened yet.</p>}
      </aside>
    </div>
  );
}

function CandidateDiff({ from, survey, label }: { from: Snapshot; survey: Survey; label: string }) {
  const { ws } = useStudio();
  const d = useMemo(() => compare(from, snapshot(ws, survey)), [from, ws, survey]);
  return (<details className="ss-val-panel" open data-testid="ss-void-diff"><summary><strong>{label}</strong><span>{d.changes.length} change{d.changes.length === 1 ? '' : 's'}</span></summary><ChangeList d={d} /></details>);
}

function DiffSummary({ d, onOpen }: { d: Comparison; onOpen: () => void }) {
  return (
    <div className="ss-diff-summary" data-testid="ss-diff-summary">
      {d.identical ? <p>Nothing differs from the published version.</p> : (
        <ul className="ss-diff-counts">{CHANGE_AREAS.map((a) => { const n = d.changes.filter((c) => c.area === a.id).length; return <li key={a.id} className={n ? '' : 'none'}><strong>{n}</strong><span>{a.label}</span></li>; })}
          <li className={d.impacted ? '' : 'none'}><strong>{d.impacted}</strong><span>Journeys affected</span></li></ul>
      )}
      <button type="button" className="ss-btn small" onClick={onOpen} data-testid="ss-open-compare"><Glyph name="branch" size={14} /> See every change</button>
    </div>
  );
}

function LockTable({ lock }: { lock: Lock }) {
  return (
    <details className="ss-val-panel" data-testid="ss-lock"><summary><strong>{lock.modules.length} modules · {lock.questions.length} questions · {lock.conditions.length} conditions</strong><span>pinned exactly</span></summary>
      <table className="ss-table"><thead><tr><th scope="col">Kind</th><th scope="col">Name</th><th scope="col">Pinned</th></tr></thead><tbody>
        {lock.modules.map((m) => <tr key={`m${m.code}${m.revision}`}><td>Module</td><td>{m.name}{m.shared ? '' : ' — draft for this survey'}</td><td><span className="ss-code">{m.code} v{m.revision}</span></td></tr>)}
        {lock.conditions.map((c) => <tr key={`c${c.code}${c.version}`}><td>Condition</td><td>{c.name}</td><td><span className="ss-code">{c.code} v{c.version}</span></td></tr>)}
        {lock.questions.map((q) => <tr key={`q${q.code}${q.version}`}><td>Question</td><td>“{q.text}”</td><td><span className="ss-code">{q.code} v{q.version}</span></td></tr>)}
      </tbody></table></details>
  );
}

// ---- comparing two revisions -----------------------------------------------------------------------------------------------
function CompareTab({ survey, sg }: { survey: Survey; sg: SurveyGov }) {
  const { ws } = useStudio();
  const [params, setParams] = useSearchParams();
  const revisions = useMemo(() => {
    const out: Array<{ id: string; label: string; snap: Snapshot }> = [];
    for (const p of sg.publications) out.push({ id: `v${p.version}`, label: `Version ${p.label} — published (simulated)`, snap: p.snapshot });
    for (const s of sg.submissions) if (s.status !== 'PUBLISHED') out.push({ id: s.id, label: `Candidate ${s.id} (revision ${s.n}) — ${s.status === 'IN_REVIEW' ? 'in review' : s.status === 'APPROVED' ? 'approved' : s.status === 'REJECTED' ? 'sent back' : s.status === 'SUPERSEDED' ? 'superseded' : 'withdrawn'}`, snap: s.candidate });
    out.push({ id: 'draft', label: 'Current draft', snap: snapshot(ws, survey) });
    return out;
  }, [sg, ws, survey]);
  const from = revisions.find((x) => x.id === params.get('from')) ?? revisions.find((x) => x.id === `v${sg.publications.length}`) ?? revisions[Math.max(0, revisions.length - 2)]!; // by default: against the latest published version
  const to = revisions.find((x) => x.id === params.get('to')) ?? revisions[revisions.length - 1]!;
  const d = useMemo(() => compare(from.snap, to.snap), [from, to]);
  const set = (k: 'from' | 'to', v: string) => { const p = new URLSearchParams(window.location.search); p.set('tab', 'compare'); p.set(k, v); setParams(p, { replace: true }); };

  if (revisions.length < 2) return <p className="ss-empty" data-testid="ss-compare-empty"><span><strong>There is nothing to compare with yet.</strong> Once this draft has been submitted or published, later changes can be compared with that revision.</span></p>;
  return (
    <div className="ss-compare" data-testid="ss-compare">
      <div className="ss-compare-pick">
        <label className="ss-field"><span>Earlier revision</span><select value={from.id} onChange={(e) => set('from', e.target.value)} data-testid="ss-compare-from">{revisions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <Glyph name="next" />
        <label className="ss-field"><span>Later revision</span><select value={to.id} onChange={(e) => set('to', e.target.value)} data-testid="ss-compare-to">{revisions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <span className="ss-muted">Fingerprints <span className="ss-code">{from.snap.fingerprint}</span> → <span className="ss-code">{to.snap.fingerprint}</span></span>
      </div>

      <section className={`ss-needs ${d.identical ? 'same' : ''}`} data-testid="ss-needs" aria-label="What this requires">
        <h2>{d.identical ? 'These two revisions are identical' : 'What this change requires'}</h2>
        <ul>{d.needs.text.map((t) => { const [head, ...rest] = t.split(': '); return <li key={t}>{rest.length ? <><strong>{head}.</strong> {rest.join(': ').replace(/^./, (c) => c.toUpperCase())}</> : t}</li>; })}</ul>
      </section>
      {d.identical ? null : <ChangeList d={d} />}

      <section className="ss-compare-block" data-testid="ss-compare-journeys" aria-label="Impacted journeys">
        <h2>Impacted journeys <span className="ss-count">{d.impacted} of {d.journeys.length}</span></h2>
        <p className="ss-muted">The same invented customers played through both revisions. A journey is “affected” when the questions asked, the modules that run or the way the call ends differ.</p>
        <table className="ss-table"><thead><tr><th scope="col">Customer</th><th scope="col">Earlier</th><th scope="col">Later</th><th scope="col">What differs</th></tr></thead>
          <tbody>{d.journeys.map((j) => <tr key={j.profile} className={j.changed ? 'changed' : ''} data-changed={j.changed}><td><strong>{j.name}</strong></td><td>{j.before}</td><td>{j.after}</td><td>{j.changed ? <><Tag tone="warn">Affected</Tag> {j.detail}</> : <span className="ss-muted">No difference</span>}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}

const KIND = { ADDED: 'Added', REMOVED: 'Removed', MODIFIED: 'Changed', MOVED: 'Moved' } as const;
function ChangeList({ d }: { d: Comparison }) {
  return (
    <>
      {CHANGE_AREAS.map((a) => {
        const mine = d.changes.filter((c) => c.area === a.id);
        return (
          <section key={a.id} className="ss-compare-block" data-testid={`ss-changes-${a.id}`} aria-label={a.label}>
            <h2>{a.label} <span className="ss-count">{mine.length}</span></h2>
            {mine.length === 0 ? <p className="ss-muted">No change.</p> : (
              <ul className="ss-changes">{mine.map((c) => (
                <li key={c.id} className={c.kind.toLowerCase()} data-kind={c.kind}>
                  <span className="ss-change-kind">{KIND[c.kind]}</span>
                  <div><h3>{c.title}{c.wording ? <Tag tone="warn">Needs wording approval</Tag> : null}</h3>
                    {c.before !== undefined || c.after !== undefined ? <dl className="ss-before-after">
                      {c.before !== undefined ? <div className="before"><dt>Before</dt><dd>{c.before}</dd></div> : null}
                      {c.after !== undefined ? <div className="after"><dt>After</dt><dd>{c.after}</dd></div> : null}</dl> : null}</div>
                </li>))}</ul>
            )}
            {a.id === 'QUESTIONS' && d.renumbered.length ? (
              <p className="ss-note" data-testid="ss-renumbered"><Glyph name="info" size={14} />
                <span><strong>{d.renumbered.length} question{d.renumbered.length === 1 ? ' was' : 's were'} only renumbered</strong> ({d.renumbered.slice(0, 3).map((x) => `${x.before} → ${x.after}`).join(', ')}{d.renumbered.length > 3 ? ', …' : ''}). A display number is not a question’s identity: these questions are unchanged and are not listed as changes.</span></p>
            ) : null}
          </section>
        );
      })}
    </>
  );
}

// ---- publication history and the audit trail ---------------------------------------------------------------------------------
function HistoryTab({ sg }: { sg: SurveyGov }) {
  return (
    <div className="ss-history" data-testid="ss-history">
      <section className="ss-compare-block" aria-label="Published versions">
        <h2>Published versions <span className="ss-count">{sg.publications.length}</span></h2>
        {sg.publications.length === 0 ? <p className="ss-empty"><span><strong>Nothing has been published.</strong> An approved candidate becomes version 1.0 when it is published.</span></p> : (
          <ul className="ss-pubs">{[...sg.publications].reverse().map((p) => (
            <li key={p.version} data-testid={`ss-pub-${p.version}`}>
              <div className="ss-pub-head"><h3>Version {p.label}</h3><Tag tone="ok" glyph="lock">Immutable</Tag><Tag>Simulated</Tag>{p.seeded ? <Tag tone="draft">Seeded with the demonstration</Tag> : null}
                <span className="ss-code">{p.snapshot.fingerprint}</span></div>
              <p className="ss-rev-meta" data-testid={`ss-pub-binding-${p.version}`}>Candidate <strong>{p.candidate}</strong> · revision {p.revision} · dependency manifest <span className="ss-code">{p.manifestHash}</span></p>
              <p className="ss-rev-meta">Published {when(p.at)} by {who(p.publishedBy)} · submitted by <strong>{who(p.submittedBy)}</strong> · approved by <strong>{who(p.approvedBy)}</strong></p>
              <blockquote className="ss-quote">{p.note}</blockquote>
              <LockTable lock={p.lock} />
              <details className="ss-val-panel" data-testid={`ss-pub-wording-${p.version}`}><summary><strong>Wording as approved (simulated)</strong><span>{p.lock.questions.length} questions</span></summary>
                <ul className="ss-wording">{p.lock.questions.map((q) => <li key={`${q.code}@${q.version}`}><span>“{q.text}”</span><small>{q.usedIn.join(', ')} · {q.code} v{q.version}</small></li>)}</ul></details>
            </li>))}</ul>
        )}
      </section>
      <section className="ss-compare-block" aria-label="Audit trail">
        <h2>Audit trail <span className="ss-count">{sg.audit.length}</span></h2>
        <p className="ss-muted">Every step, who took it, and the candidate it applied to — by ID and content fingerprint. Held in memory for this demonstration; in Call360 these would be immutable server-side audit events.</p>
        {sg.audit.length === 0 ? <p className="ss-muted">No events yet.</p> : (
          <table className="ss-table" data-testid="ss-audit"><thead><tr><th scope="col">#</th><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Detail</th><th scope="col">Candidate</th><th scope="col">Fingerprint</th></tr></thead>
            <tbody>{sg.audit.map((a) => <tr key={a.n}><td>{a.n}</td><td>{when(a.at)}</td><td>{who(a.actor)}</td><td><strong>{a.action}</strong></td><td>{a.detail}</td><td>{a.candidate ?? '—'}</td><td>{a.fingerprint ? <span className="ss-code">{a.fingerprint}</span> : '—'}</td></tr>)}</tbody></table>
        )}
      </section>
    </div>
  );
}
