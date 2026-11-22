// Survey Studio (FI-2) — real review and publication of a saved survey.
//  * ReviewPage: the author submits the saved draft as an immutable candidate (server validation must pass and every
//    server-governed warning must be acknowledged with a reason); everybody sees the candidates and versions.
//  * CandidatePage: the frozen candidate as a reviewer inspects it, with approve / send back / withdraw / publish.
//  * VersionPage: a published, immutable version and its content.
// Every rule is enforced by the server; what is shown here is the server's own answer. A candidate is never editable:
// these screens have no editing control at all. Synthetic wording stays labelled as synthetic and unapproved.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { JourneyNav } from '../JourneyNav';
import { assetKey, changes, type AssetDoc, type AssetKind, type Doc, type DocumentSet } from '../model/documents';
import { StudioBar } from '../StudioRoot';
import { useStudio } from '../store';
import { Glyph, Tag } from '../ui';
import { validateDraft, type ServerValidation } from './api';
import { usePersistence } from './Persistence';
import {
  EVENT_LABEL, RULE_TEXT, STATUS_LABEL, decideCandidate, getCandidateDocuments, getHistory, getVersion, publishCandidate, short, submitCandidate, when, withdrawCandidate,
  type CandidateDocuments, type SurveyHistory, type SurveyVersion,
} from './reviewApi';
import { usePlace } from '../place';
import { STANDING_NOTE } from './standing';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- frozen documents are read as JSON
const REASON_MIN = 10;
const WORDING_NOTE = 'All wording here is synthetic sample text. Reviewing, approving or publishing a candidate in Call360 is a development step: it is not Compliance approval of insurance wording, and it makes nothing eligible for a live call.';
const problem = (e: unknown): { code?: string; message: string } => (e instanceof ApiFailure ? { code: e.code, message: (e.code && RULE_TEXT[e.code]) || (e.status === 403 ? 'You do not have permission for this.' : e.message) } : { message: 'The server could not be reached.' });
const tone = (status: string) => (status === 'PUBLISHED' || status === 'APPROVED' ? 'shared' : 'draft');

function Frame({ crumb, children }: { crumb: string; children: ReactNode }) {
  const { ws } = useStudio();
  const survey = ws.surveys[0]!;
  const place = usePlace(survey.id);
  const base = place.base;
  return (
    <>
      <StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: survey.name, to: base }, ...(crumb === 'Review and publish' ? [{ label: crumb }] : [{ label: 'Review and publish', to: `${base}/review` }, { label: crumb }])]} />
      <JourneyNav survey={survey} at="review" />
      <div className="ss-review" data-testid="ss-review" data-mode={place.mode}>{crumb === 'Review and publish' ? place.reviewLead : null}{children}</div>
    </>
  );
}

// ---- the survey's review page ---------------------------------------------------------------------------------------
export function ReviewPage() {
  const p = usePersistence()!;
  const { can } = useAuth();
  const nav = useNavigate();
  const { ws } = useStudio();
  const place = usePlace(ws.surveys[0]!.id);
  const base = place.base;
  const thing = place.mode === 'module' ? 'module' : 'survey';
  const [history, setHistory] = useState<SurveyHistory | null>(null);
  const [validation, setValidation] = useState<ServerValidation | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const author = can('survey.edit');
  const refresh = useCallback(() => {
    getHistory(p.surveyId).then(setHistory).catch((e) => setError(problem(e)));
    if (author) validateDraft(p.surveyId).then(setValidation).catch((e) => setError(problem(e)));
  }, [p.surveyId, author]);
  useEffect(refresh, [refresh, p.revision]);

  const blockers = validation?.findings.filter((f) => f.severity === 'BLOCKER') ?? [];
  const warnings = validation?.findings.filter((f) => f.severity === 'WARNING') ?? [];
  const key = (f: { code: string; at: string }) => `${f.code}|${f.at}`;
  const unacknowledged = warnings.filter((w) => (reasons[key(w)] ?? '').trim().length < REASON_MIN);
  const same = history?.candidates.filter((c) => c.content_sha256 === history.draft_content_sha256 && ['IN_REVIEW', 'APPROVED', 'PUBLISHED'].includes(c.status)).at(-1);
  const why = !validation ? 'Waiting for the server’s validation.'
    : p.dirty ? 'Save your changes first: the server submits the saved revision, not what is on screen.'
      : blockers.length ? `The server blocks this draft: ${blockers.length} blocker${blockers.length === 1 ? '' : 's'} to fix.`
        : same ? `This saved revision is already candidate C-${same.n} (${STATUS_LABEL[same.status]?.toLowerCase()}). Change the draft to submit a new one.`
          : unacknowledged.length ? `Acknowledge ${unacknowledged.length === 1 ? 'the warning' : `the ${unacknowledged.length} warnings`} below, with a reason.` : null;
  const submit = () => {
    setBusy(true);
    setError(null);
    submitCandidate(p.surveyId, { note: note.trim(), acknowledgements: warnings.map((w) => ({ code: w.code, at: w.at, reason: (reasons[key(w)] ?? '').trim() })) })
      .then(async (c) => { await p.refreshFromServer().catch(() => undefined); nav(`${base}/candidates/${c.id}`); }).catch((e) => { setError(problem(e)); refresh(); }).finally(() => setBusy(false));
  };

  return (
    <Frame crumb="Review and publish">
      <header className="ss-review-head">
        <h1 className="ss-title">Review and publish</h1>
        <p className="ss-muted">A submitted candidate is frozen: nobody can change it, and the draft stays yours to keep editing. A different person approves it, and a third person publishes it as an immutable version.</p>
        <p className="ss-note" data-testid="ss-wording-note"><Glyph name="info" size={14} /><span>{WORDING_NOTE}</span></p>
      </header>
      {error ? <p className="ss-note warn" role="alert" data-testid="ss-review-error"><Glyph name="alert" size={14} /><span><strong>That was refused.</strong> {error.message}{error.code ? <> <span className="ss-code">{error.code}</span></> : null}</span></p> : null}

      {author ? (
        <section className="ss-review-card" aria-labelledby="ss-submit-title" data-testid="ss-submit-panel">
          <h2 id="ss-submit-title">Submit the saved draft <small>revision {p.revision}</small></h2>
          <dl className="ss-facts">
            <div><dt>Server validation</dt><dd data-testid="ss-submit-validation">{!validation ? 'Checking…' : blockers.length ? `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}` : 'No blocker'}{validation && warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? '' : 's'} to acknowledge` : ''}</dd></div>
            <div><dt>Unsaved changes</dt><dd>{p.dirty ? `${p.changed} — not part of what would be submitted` : 'None'}</dd></div>
          </dl>
          {blockers.length ? (
            <ul className="ss-server-findings" data-testid="ss-submit-blockers">{blockers.map((f, i) => <li key={`${f.code}${f.at}${i}`}><span className="ss-finding-sev"><Glyph name="stop" size={14} /> Blocker</span><span><strong>{f.message}</strong><small><span className="ss-code">{f.code}</span> at <span className="ss-code">{f.at}</span></small></span></li>)}</ul>
          ) : null}
          {warnings.map((w) => (
            <div className="ss-ack" key={key(w)} data-testid={`ss-ack-${w.code}`}>
              <p><span className="ss-finding-sev"><Glyph name="alert" size={14} /> Warning</span> <strong>{w.message}</strong> <span className="ss-code">{w.code}</span></p>
              <label className="ss-field"><span>Why is it acceptable to submit with this warning? <em>Recorded with the candidate; the reviewer reads it. At least {REASON_MIN} characters.</em></span>
                <textarea rows={2} value={reasons[key(w)] ?? ''} onChange={(e) => setReasons((r) => ({ ...r, [key(w)]: e.target.value }))} maxLength={500} data-testid={`ss-ack-reason-${w.code}`} /></label>
            </div>
          ))}
          <label className="ss-field"><span>Note for the reviewer <em>optional</em></span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} data-testid="ss-submit-note" /></label>
          <div className="ss-actions">
            <button type="button" className="ss-btn primary" onClick={submit} disabled={busy || why !== null} data-testid="ss-submit">{busy ? 'Submitting…' : 'Submit for review'}</button>
            {why ? <span className="ss-muted" data-testid="ss-submit-why">{why}</span> : <span className="ss-muted">Freezes the saved revision {p.revision} as a new candidate. You cannot approve or publish it yourself.</span>}
          </div>
        </section>
      ) : <p className="ss-note" data-testid="ss-submit-not-author"><Glyph name="info" size={14} /><span>You can review this {thing}’s candidates. Submitting a draft needs the survey.edit permission.</span></p>}

      <section className="ss-review-card" aria-labelledby="ss-cands-title">
        <h2 id="ss-cands-title">Candidates</h2>
        {!history ? <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading…</p>
          : history.candidates.length === 0 ? <p className="ss-muted" data-testid="ss-no-candidates">Nothing has been submitted yet.</p>
            : (
              <table className="ss-table" data-testid="ss-candidates">
                <thead><tr><th scope="col">Candidate</th><th scope="col">Status</th><th scope="col">Submitted</th><th scope="col">Latest step</th><th scope="col">Content fingerprint</th></tr></thead>
                <tbody>{[...history.candidates].reverse().map((c) => (
                  <tr key={c.id} data-testid={`ss-candidate-row-${c.n}`} data-status={c.status}>
                    <td><Link to={`${base}/candidates/${c.id}`} data-testid={`ss-open-candidate-${c.n}`}><strong>C-{c.n}</strong></Link>{c.note ? <small> — {c.note}</small> : null}</td>
                    <td><Tag tone={tone(c.status)}>{STATUS_LABEL[c.status] ?? c.status}</Tag></td>
                    <td>{c.submitted_by ?? 'Unknown'}<small> · {when(c.submitted_at)} · from revision {c.draft_revision}</small></td>
                    <td>{c.last_event ? EVENT_LABEL[c.last_event] ?? c.last_event : '—'}<small>{c.last_event_by ? ` · ${c.last_event_by}` : ''} · {when(c.last_event_at)}</small></td>
                    <td><span className="ss-code" title={c.content_sha256}>{short(c.content_sha256)}</span></td>
                  </tr>))}</tbody>
              </table>)}
      </section>

      <section className="ss-review-card" aria-labelledby="ss-vers-title">
        <h2 id="ss-vers-title">Published versions</h2>
        {history && history.versions.length === 0 ? <p className="ss-muted" data-testid="ss-no-versions">No version has been published.</p> : null}
        {history && history.versions.length ? (
          <table className="ss-table" data-testid="ss-versions">
            <thead><tr><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Published</th><th scope="col">From</th><th scope="col">Content fingerprint</th></tr></thead>
            <tbody>{[...history.versions].reverse().map((v) => (
              <tr key={v.id} data-testid={`ss-version-row-${v.label}`} data-status={v.status}>
                <td><Link to={`${base}/versions/${v.id}`} data-testid={`ss-open-version-${v.label}`}><strong>Version {v.label}</strong></Link></td>
                <td><Tag tone={tone(v.status)}>{STATUS_LABEL[v.status] ?? v.status}</Tag></td>
                <td>{v.published_by ?? 'Unknown'}<small> · {when(v.published_at)}</small></td>
                <td><Link to={`${base}/candidates/${v.candidate_id}`}>C-{v.candidate_n}</Link></td>
                <td><span className="ss-code" title={v.content_sha256}>{short(v.content_sha256)}</span></td>
              </tr>))}</tbody>
          </table>) : null}
        <p className="ss-muted">{STANDING_NOTE}</p>
      </section>
    </Frame>
  );
}

// ---- frozen content, as a reviewer reads it ---------------------------------------------------------------------------
const target = (t: Any): string => (t == null ? 'not decided' : t === '@CONTINUE' ? 'the next module' : t.node ? `step ${t.node}` : t.outcome ? `ends the module: ${t.outcome}` : t.return ? 'returns to the question that asked' : t.instance ? `module ${t.instance}` : t.survey_outcome ? `ends the call: ${t.survey_outcome}` : JSON.stringify(t));
const KIND: Record<string, string> = { OPTION_SET: 'Answers', ITEM: 'Question or statement', WORDING: 'Wording', CONDITION: 'Condition', MODULE: 'Module' };
const named = (key: string) => { const [kind, rest] = key.split(':'); return `${KIND[kind!] ?? kind} ${rest!.replace('@', ' version ')}`; };
const setOf = (d: CandidateDocuments): DocumentSet => ({ content: d.content as Doc, assets: d.assets.filter((a) => a.document).map((a): AssetDoc => ({ kind: a.kind as AssetKind, code: a.code, version: a.version, document: a.document as Doc })) });

function Hash({ a }: { a: { sha256: string; intact: boolean } }) {
  return <span className={`ss-hash ${a.intact ? '' : 'bad'}`} title={a.sha256} data-intact={a.intact}><Glyph name={a.intact ? 'lock' : 'alert'} size={12} /> <span className="ss-code">{short(a.sha256)}</span>{a.intact ? '' : ' does not match'}</span>;
}

function FrozenContent({ d }: { d: CandidateDocuments }) {
  const find = (kind: string, code: string, version: number) => d.assets.find((a) => a.kind === kind && a.code === code && a.version === version);
  const sequence = ((d.content as Any).sequence ?? []) as Any[];
  const conditions = d.assets.filter((a) => a.kind === 'CONDITION');
  return (
    <div data-testid="ss-frozen-content">
      {sequence.map((inst, k) => {
        const m = find('MODULE', inst.module.code, inst.module.revision);
        const doc = m?.document as Any;
        return (
          <section className="ss-frozen-module" key={inst.instance} data-testid={`ss-frozen-module-${inst.instance}`}>
            <h3>{k + 1}. {doc?.name ?? inst.module.code} <small><span className="ss-code">{inst.module.code}</span> revision {inst.module.revision} · placed as <span className="ss-code">{inst.instance}</span></small> {m ? <Hash a={m} /> : <span className="ss-hash bad">missing</span>}</h3>
            <p className="ss-muted">{inst.eligibility ? <>Runs only when condition <span className="ss-code">{inst.eligibility.condition.code}</span> version {inst.eligibility.condition.version} holds (if unknown: {String(inst.eligibility.unknown_policy)}). </> : 'Runs always. '}
              {Object.entries((inst.routes ?? {}) as Record<string, Any>).map(([o, t]) => `${o} → ${target(t)}`).join(' · ')}</p>
            {doc ? (
              <table className="ss-table ss-frozen">
                <thead><tr><th scope="col">Step</th><th scope="col">Question or statement</th><th scope="col">Wording <em>synthetic · unapproved</em></th><th scope="col">Answers and routes</th><th scope="col">Pinned</th></tr></thead>
                <tbody>{(doc.nodes as Any[]).map((n) => {
                  if (n.type === 'DECISION') return (<tr key={n.node}><td><span className="ss-code">{n.node}</span></td><td>Decision point</td><td>{n.binding ? <>Condition <span className="ss-code">{n.binding.condition.code}</span> v{n.binding.condition.version}</> : 'No condition'}</td><td>{(doc.edges as Any[]).filter((e) => e.from === n.node).map((e) => `${e.on} → ${target(e.to)}`).join(' · ')}</td><td>—</td></tr>);
                  const item = find('ITEM', n.item.code, n.item.version), wording = find('WORDING', n.item.code, n.item.wording_version);
                  const idoc = item?.document as Any, os = idoc?.option_set ? find('OPTION_SET', idoc.option_set.code, idoc.option_set.version) : undefined;
                  const edges = (doc.edges as Any[]).filter((e) => e.from === n.node);
                  return (
                    <tr key={n.node} data-testid={`ss-frozen-node-${inst.instance}-${n.node}`}>
                      <td><span className="ss-code">{n.node}</span>{doc.entry === n.node ? <small> · first</small> : null}</td>
                      <td>{n.type === 'STATEMENT' ? 'Statement' : 'Question'} <span className="ss-code">{n.item.code}</span> v{n.item.version}<small> · {String(idoc?.answer_type ?? '').replace('_', ' ').toLowerCase()}{idoc?.response_obligation ? ` · ${String(idoc.response_obligation).toLowerCase()}` : ''}</small>{idoc?.intent ? <small> — {idoc.intent}</small> : null}</td>
                      <td>“{String((wording?.document as Any)?.text ?? '')}”<small> · wording v{n.item.wording_version} · {String((wording?.document as Any)?.delivery_mode ?? '').replace('_', ' ').toLowerCase()}</small></td>
                      <td>{os ? <small>{((os.document as Any).options as Any[]).map((o) => o.label || o.code).join(' / ')}<br /></small> : null}{edges.length ? edges.map((e) => `${e.on} → ${target(e.to)}`).join(' · ') : <em>routing by rule: {n.routing.mode}</em>}</td>
                      <td>{item ? <Hash a={item} /> : null} {wording ? <Hash a={wording} /> : null} {os ? <Hash a={os} /> : null}</td>
                    </tr>);
                })}</tbody>
              </table>) : null}
          </section>);
      })}
      {conditions.length ? (
        <section className="ss-frozen-module"><h3>Conditions</h3>
          <table className="ss-table"><thead><tr><th scope="col">Condition</th><th scope="col">Rule</th><th scope="col">Pinned</th></tr></thead>
            <tbody>{conditions.map((c) => <tr key={assetKey(c)}><td>{String((c.document as Any)?.name)} <span className="ss-code">{c.code}</span> v{c.version}</td><td><span className="ss-code">{JSON.stringify((c.document as Any)?.ast)}</span></td><td><Hash a={c} /></td></tr>)}</tbody></table>
        </section>) : null}
    </div>
  );
}

function ChangesSince({ d, history }: { d: CandidateDocuments; history: SurveyHistory | null }) {
  const { base } = usePlace(d.survey_code);
  const [before, setBefore] = useState<CandidateDocuments | null | 'none'>(null);
  const previous = useMemo(() => history?.versions.filter((v) => v.candidate_n < d.n).at(-1) ?? null, [history, d.n]);
  useEffect(() => {
    if (!history) return;
    if (!previous) { setBefore('none'); return; }
    getCandidateDocuments(previous.candidate_id).then(setBefore).catch(() => setBefore('none'));
  }, [history, previous]);
  if (before === null) return <p className="ss-muted">Comparing…</p>;
  if (before === 'none' || !previous) return <p className="ss-muted" data-testid="ss-changes-first">There is no earlier published version: everything in this candidate is new.</p>;
  const c = changes(setOf(before), setOf(d));
  const text = (set: CandidateDocuments, a: { code: string; version: number }) => String((set.assets.find((x) => x.kind === 'WORDING' && x.code === a.code && x.version === a.version)?.document as Any)?.text ?? '');
  const lines: Array<{ k: string; what: string; detail?: string }> = [
    ...(c.content ? [{ k: 'content', what: 'The modules of the survey, their order or their routes changed' }] : []),
    ...c.put.map((a) => ({ k: assetKey(a), what: `New in this candidate: ${named(assetKey(a))}`, detail: a.kind === 'WORDING' ? `“${text(d, a)}”` : undefined })),
    ...c.remove.map((a) => ({ k: `-${assetKey(a)}`, what: `No longer used: ${named(assetKey(a))}`, detail: a.kind === 'WORDING' ? `was “${text(before, a)}”` : undefined })),
  ];
  return (
    <div data-testid="ss-changes">
      <p className="ss-muted">Compared with <Link to={`${base}/versions/${previous.id}`}>Version {previous.label}</Link> (candidate C-{previous.candidate_n}). A changed question, wording or module is a new version of it; the earlier version is untouched.</p>
      {lines.length ? <ul className="ss-changes">{lines.map((l) => <li key={l.k}><strong>{l.what}</strong>{l.detail ? <small> {l.detail}</small> : null}</li>)}</ul> : <p>Nothing differs from Version {previous.label}.</p>}
    </div>
  );
}

// ---- one candidate ------------------------------------------------------------------------------------------------------
export function CandidatePage() {
  const { candidateId = '' } = useParams();
  return <CandidateView key={candidateId} candidateId={candidateId} crumb={null} />;
}

function CandidateView({ candidateId, crumb, version }: { candidateId: string; crumb: string | null; version?: SurveyVersion }) {
  const { can } = useAuth();
  const p = usePersistence()!;
  const nav = useNavigate();
  const place = usePlace(p.code);
  const [d, setD] = useState<CandidateDocuments | null>(null);
  const [history, setHistory] = useState<SurveyHistory | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const fetchAll = useCallback(() => {
    getCandidateDocuments(candidateId).then(setD).catch((e) => { if (e instanceof ApiFailure && e.status === 404) setMissing(true); else setError(problem(e)); });
    getHistory(p.surveyId).then(setHistory).catch(() => undefined);
  }, [candidateId, p.surveyId]);
  useEffect(fetchAll, [fetchAll]);
  const act = (run: () => Promise<unknown>, then?: (r: unknown) => void) => {
    setBusy(true);
    setError(null);
    run().then((r) => { setComment(''); if (then) then(r); else fetchAll(); }).catch((e) => { setError(problem(e)); fetchAll(); }).finally(() => setBusy(false));
  };
  if (missing) return <Frame crumb="Not found"><div className="ss-empty page" data-testid="ss-candidate-missing"><p><strong>There is no such candidate that you can open.</strong></p></div></Frame>;
  if (!d) return <Frame crumb="Candidate">{error ? <p className="ss-note warn" role="alert"><Glyph name="alert" size={14} /><span>{error.message}</span></p> : <p className="ss-loading page" role="status" data-testid="ss-loading"><span className="ss-spinner" aria-hidden="true" /> Loading the frozen candidate…</p>}</Frame>;
  const r = d.restrictions;
  const base = place.base;
  const tampered = !d.manifest_intact;
  return (
    <Frame crumb={crumb ?? `Candidate C-${d.n}`}>
      <header className="ss-review-head" data-testid="ss-candidate" data-status={d.status} data-n={d.n}>
        <h1 className="ss-title">{version ? <>Version {version.label} <small>published from candidate C-{d.n}</small></> : <>Candidate C-{d.n}</>} <Tag tone={tone(version ? version.status : d.status)}>{STATUS_LABEL[version ? version.status : d.status] ?? d.status}</Tag> <Tag tone="shared" glyph="lock">Frozen · cannot be changed</Tag></h1>
        <p className="ss-muted">Submitted by <strong>{d.submitted_by.name ?? 'Unknown'}</strong> on {when(d.submitted_at)}, from draft revision {d.draft_revision}.{d.note ? <> Note: “{d.note}”</> : null}{d.approver ? <> Approved by <strong>{d.approver.name ?? 'Unknown'}</strong>.</> : null}{d.version_label && !version ? <> Published as <Link to={`${base}/versions/${d.version_id}`} data-testid="ss-candidate-version-link">Version {d.version_label}</Link>.</> : null}</p>
        <p className="ss-note" data-testid="ss-wording-note"><Glyph name="info" size={14} /><span>{WORDING_NOTE}</span></p>
      </header>
      {error ? <p className="ss-note warn" role="alert" data-testid="ss-review-error"><Glyph name="alert" size={14} /><span><strong>That was refused.</strong> {error.message}{error.code ? <> <span className="ss-code" data-testid="ss-review-error-code">{error.code}</span></> : null}</span></p> : null}

      <section className={`ss-review-card ${tampered ? 'bad' : ''}`} aria-labelledby="ss-integrity-title" data-testid="ss-integrity" data-intact={d.manifest_intact}>
        <h2 id="ss-integrity-title">{tampered ? 'This candidate does not match the versions it pins' : 'Integrity: every pinned version matches its fingerprint'}</h2>
        <dl className="ss-facts">
          <div><dt>Content fingerprint</dt><dd><span className="ss-code" data-testid="ss-content-sha">{d.content_sha256}</span></dd></div>
          <div><dt>Manifest fingerprint</dt><dd><span className="ss-code" data-testid="ss-manifest-sha">{d.manifest_sha256}</span></dd></div>
          <div><dt>Pinned versions</dt><dd>{d.assets.length} — {d.assets.filter((a) => a.intact).length} verified{tampered ? `, ${d.assets.filter((a) => !a.intact).length} NOT matching` : ''}</dd></div>
        </dl>
        <p className="ss-muted">{tampered ? <strong data-testid="ss-tampered">It has been changed outside Call360, or a version it pins has. The server re-verifies this at approval and at publication and refuses both: {d.manifest_problems.join('; ')}.</strong> : 'Verified by the server now, from the stored documents. It is verified again when the candidate is approved and when it is published.'}</p>
      </section>

      <section className="ss-review-card" aria-labelledby="ss-makers-title" data-testid="ss-makers">
        <h2 id="ss-makers-title">Who made this candidate, and what that means</h2>
        <p>Makers — everyone who changed the draft before it was submitted: <strong data-testid="ss-maker-names">{d.makers.map((m) => m.name ?? 'Unknown').join(', ')}</strong>.</p>
        <ul className="ss-rules">
          <li>A maker can never approve, send back or publish this candidate.</li>
          <li>The person who approves it can never publish it: a third person must.</li>
          <li>These rules are enforced by the server and by the database, whatever permissions a person holds.</li>
        </ul>
        {r.is_maker ? <p className="ss-note warn" data-testid="ss-you-are-maker"><Glyph name="alert" size={14} /><span>You are a maker of this candidate: you cannot approve, send back or publish it.</span></p> : null}
        {r.is_approver ? <p className="ss-note warn" data-testid="ss-you-are-approver"><Glyph name="alert" size={14} /><span>You approved this candidate: you cannot publish it.</span></p> : null}
      </section>

      {version ? null : (
        <section className="ss-review-card" aria-labelledby="ss-actions-title" data-testid="ss-candidate-actions">
          <h2 id="ss-actions-title">Decision</h2>
          {can('survey.approve') ? (
            <div className="ss-decide" data-testid="ss-decide-panel">
              <label className="ss-field"><span>Comment <em>required to send back; recorded with the decision</em></span>
                <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} disabled={!r.can_decide} data-testid="ss-decision-comment" /></label>
              <div className="ss-actions">
                <button type="button" className="ss-btn primary" disabled={busy || !r.can_decide || tampered} onClick={() => act(() => decideCandidate(d.id, 'APPROVE', comment))} data-testid="ss-approve">Approve</button>
                <button type="button" className="ss-btn" disabled={busy || !r.can_decide || !comment.trim()} onClick={() => act(() => decideCandidate(d.id, 'REJECT', comment))} data-testid="ss-reject">Send back</button>
                {tampered && r.can_decide ? <button type="button" className="ss-btn" disabled={busy} onClick={() => act(() => decideCandidate(d.id, 'APPROVE', comment))} data-testid="ss-approve-anyway">Ask the server to approve it anyway</button> : null}
                {r.decide_reason ? <span className="ss-muted" data-testid="ss-decide-why">{RULE_TEXT[r.decide_reason] ?? r.decide_reason}</span> : tampered ? <span className="ss-muted">{RULE_TEXT.MANIFEST_MISMATCH}</span> : null}
              </div>
            </div>) : <p className="ss-muted" data-testid="ss-no-approve">Approving or sending back needs the survey.approve permission.</p>}
          {can('survey.publish') ? (
            <div className="ss-decide" data-testid="ss-publish-panel">
              <div className="ss-actions">
                <button type="button" className="ss-btn primary" disabled={busy || !r.can_publish} onClick={() => act(() => publishCandidate(d.id), (v) => nav(`${base}/versions/${(v as SurveyVersion).id}`))} data-testid="ss-publish">Publish as an immutable version</button>
                <span className="ss-muted" data-testid="ss-publish-why">{r.publish_reason ? RULE_TEXT[r.publish_reason] ?? r.publish_reason : 'The server re-verifies the manifest, then creates the version. Publishing makes nothing eligible for a live call.'}</span>
              </div>
            </div>) : <p className="ss-muted" data-testid="ss-no-publish">Publishing needs the survey.publish permission.</p>}
          {can('survey.edit') && r.can_withdraw ? (
            <div className="ss-actions"><button type="button" className="ss-btn" disabled={busy} onClick={() => act(() => withdrawCandidate(d.id, comment))} data-testid="ss-withdraw">Withdraw this candidate</button><span className="ss-muted">Only you, its submitter, can. The draft is not affected.</span></div>) : null}
        </section>)}

      <section className="ss-review-card" aria-labelledby="ss-acks-title" data-testid="ss-acknowledgements">
        <h2 id="ss-acks-title">Validation and acknowledged warnings</h2>
        <p data-testid="ss-candidate-validation">The server’s validation of exactly this content: <strong>{d.validation.blockers} blocker{d.validation.blockers === 1 ? '' : 's'}</strong>, {d.validation.warnings} warning{d.validation.warnings === 1 ? '' : 's'}.</p>
        {d.acknowledgements.length ? (
          <ul className="ss-acks">{d.acknowledgements.map((a) => (
            <li key={`${a.code}${a.at}`} data-testid={`ss-acked-${a.code}`}>
              <strong>{a.message}</strong> <span className="ss-code">{a.code}</span>
              <p>Acknowledged by <strong>{a.acknowledged_by_name ?? 'Unknown'}</strong>: “{a.reason}”</p>
              <small>Given for content fingerprint <span className="ss-code">{short(a.content_sha256)}</span> — {a.content_sha256 === d.content_sha256 ? 'the fingerprint of this candidate.' : <strong>NOT the fingerprint of this candidate.</strong>}</small>
            </li>))}</ul>) : <p className="ss-muted">No warning needed an acknowledgement.</p>}
      </section>

      <section className="ss-review-card" aria-labelledby="ss-changes-title">
        <h2 id="ss-changes-title">What changed</h2>
        <ChangesSince d={d} history={history} />
      </section>

      <section className="ss-review-card" aria-labelledby="ss-content-title">
        <h2 id="ss-content-title">Frozen content <small>read only</small></h2>
        <FrozenContent d={d} />
      </section>

      <section className="ss-review-card" aria-labelledby="ss-hist-title">
        <h2 id="ss-hist-title">History</h2>
        <ol className="ss-timeline" data-testid="ss-candidate-history">{d.history.map((h, i) => <li key={i} data-event={h.event}><strong>{EVENT_LABEL[h.event] ?? h.event}</strong> by {h.actor_name ?? 'Unknown'} <small>· {when(h.occurred_at)}</small>{h.reason ? <p>“{h.reason}”</p> : null}</li>)}</ol>
      </section>
    </Frame>
  );
}

// ---- one published version ---------------------------------------------------------------------------------------------
export function VersionPage() {
  const { versionId = '' } = useParams();
  const [v, setV] = useState<SurveyVersion | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setV(null); getVersion(versionId).then(setV).catch(() => setFailed(true)); }, [versionId]);
  if (failed) return <Frame crumb="Not found"><div className="ss-empty page" data-testid="ss-version-missing"><p><strong>There is no such version that you can open.</strong></p></div></Frame>;
  if (!v) return <Frame crumb="Version"><p className="ss-loading page" role="status" data-testid="ss-loading"><span className="ss-spinner" aria-hidden="true" /> Loading the published version…</p></Frame>;
  return (
    <div data-testid="ss-version" data-label={v.label} data-status={v.status}>
      <CandidateView key={v.id} candidateId={v.candidate_id} crumb={`Version ${v.label}`} version={v} />
    </div>
  );
}
