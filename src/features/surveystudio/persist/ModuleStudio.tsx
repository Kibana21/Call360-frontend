// Survey Studio (LIB-2) — a reusable module authored ON ITS OWN: no survey is created to make one.
//  * CreateModuleForm — names the module; the server issues its permanent code and an empty first revision.
//  * ModuleBuild      — the SAME guided builder and graph a survey's module is built with, on the module's own draft.
//  * ModuleTestPanel  — one module run by the Call360 Python engine in a fixed one-module frame. Every sentence,
//                       branch, refusal and ending shown is the server's; the browser decides nothing and nothing is
//                       recorded. A test is not approval.
//  * the review, candidate and version screens are the existing ones (ReviewPages): one governance, not two.
// Synthetic content only.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { BuilderPage } from '../BuilderPage';
import { JourneyNav } from '../JourneyNav';
import { KIND_LABEL } from '../model/sample';
import type { SimAnswer } from '../model/sim';
import { startNextRevision, workingModule } from '../model/standalone';
import { mKey, type Module, type ModuleKind } from '../model/types';
import { usePlace } from '../place';
import { StudioBar } from '../StudioRoot';
import { useStudio } from '../store';
import { Glyph, Tag } from '../ui';
import { createModule, getModule, testModule, type ModuleSummary, type ModuleTest, type TestInput, type TestTarget } from './moduleApi';
import { usePersistence } from './Persistence';
import { short } from './reviewApi';
import { AnswerForm, ServerTrace } from './ServerSimulation';
import { REJECTION_TEXT, TERMINAL_TEXT, type PyRun } from './serverRun';
import type { Facts } from './simApi';
import { missing, words } from './workspaceApi';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- the engine's run and the catalog are read as JSON
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const NO_TEST = 'Testing runs the Call360 engine, which needs the “simulate surveys” permission (survey.simulate). You do not hold it, so nothing was run.';
const say = (e: unknown) => (e instanceof ApiFailure ? (e.status === 403 ? NO_TEST : e.status === 404 ? 'This module is not available to you, or module testing is not switched on for this server.' : e.message) : 'The server could not be reached.');

// ---- create ---------------------------------------------------------------------------------------------------------
/** Creates the module and opens its builder. Nothing else is created: no survey, and nothing is published. */
export function CreateModuleForm({ onCancel }: { onCancel: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length >= 3;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    createModule({ name: name.trim(), description: description.trim() }).then((m) => nav(`/survey-studio/modules/${m.code}`))
      .catch((x) => setError(x instanceof ApiFailure ? (x.status === 403 ? 'You do not have permission to create a module.' : x.message) : 'The server could not be reached.')).finally(() => setBusy(false));
  };
  return (
    <form className="ss-create ss-create-module" onSubmit={submit} data-testid="ss-module-create-form" aria-label="Create module">
      <p className="ss-create-lede"><strong>A module is a reusable run of questions and branches.</strong> You build, test and publish it here on its own; any survey can then use the published revision. No survey is needed to make one.</p>
      <label className="ss-field"><span>Module name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Premium affordability check" data-testid="ss-module-create-name" required minLength={3} maxLength={160} /></label>
      <label className="ss-field"><span>What is it for? <em>optional — shown on its library card</em></span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Confirms the customer can keep paying the premium" data-testid="ss-module-create-description" maxLength={2000} /></label>
      {error ? <p className="ss-warn-text" role="alert" data-testid="ss-module-create-error">{error}</p> : null}
      <div className="ss-actions">
        <button type="submit" className="ss-btn primary" disabled={!valid || busy} data-testid="ss-module-create-go">{busy ? 'Creating…' : 'Create module and open the builder'}</button>
        <button type="button" className="ss-btn" onClick={onCancel}>Cancel</button>
        <span className="ss-muted">Call360 gives it a permanent code. It starts as a draft only you and other authors can see.</span>
      </div>
    </form>
  );
}

// ---- the library card a module will have ---------------------------------------------------------------------------
function Strip({ m }: { m: Module }) {
  const tiles = m.nodes.map((n) => (n.type === 'DECISION' ? 'decision' : n.type === 'STATEMENT' ? 'statement' : 'question'));
  return (
    <span className="ss-ws-strip" aria-hidden="true">
      {tiles.slice(0, 14).map((k, i) => <i key={i} className={k} />)}{tiles.length > 14 ? <b>+{tiles.length - 14}</b> : null}<em />
      {m.outcomes.map((o) => <i key={o} className={`end ${o === 'COMPLETED' ? 'ok' : ''}`} />)}
    </span>
  );
}
/** The card this revision would have in Building blocks once published — drawn from the draft as it is now. */
export function LibraryCardPreview({ m }: { m: Module }) {
  const questions = m.nodes.filter((n) => n.type === 'QUESTION').length;
  const branching = m.nodes.some((n) => n.type === 'DECISION' || !!n.routing.rules?.length || !!n.routing.followups?.length || !!n.routing.interrupts?.length || new Set(m.edges.filter((e) => e.from === n.id).map((e) => JSON.stringify(e.to))).size > 1);
  return (
    <div className="ss-ws-card block module preview" data-testid="ss-module-card-preview" aria-label="Preview of the library card">
      <div>
        <span className="ss-ws-card-top"><span className="ss-ws-card-kind">{KIND_LABEL[m.kind]}</span><Tag tone="draft">Preview</Tag></span>
        <strong className="ss-ws-card-title">{m.name}</strong>
        <Strip m={m} />
        {m.intent ? <span className="ss-ws-card-text">{m.intent}</span> : <span className="ss-ws-card-text quiet">No description yet — add one line under the module’s name.</span>}
        <span className="ss-ws-card-foot"><span>{plural(questions, 'question')} · {branching ? 'branches' : 'no branching'} · {plural(m.outcomes.length, 'ending')}</span><span className="ss-ws-card-version">Revision {m.revision}</span></span>
      </div>
    </div>
  );
}

/** Where the module stands, from the server: what is drafted, what is waiting on whom, what is published. */
function useStanding(moduleId: string | undefined, tick: unknown) {
  const [m, setM] = useState<ModuleSummary | null>(null);
  useEffect(() => {
    if (!moduleId) return undefined;
    let current = true;
    getModule(moduleId).then((x) => { if (current && !missing(x)) setM(x); });
    return () => { current = false; };
  }, [moduleId, tick]);
  return m;
}
const standingText = (s: ModuleSummary): string => {
  const c = s.open_candidate;
  if (c) return c.your_action === 'DECIDE' ? `Revision ${c.revision} is waiting for YOUR review.` : c.your_action === 'PUBLISH' ? `Revision ${c.revision} is approved and waiting for YOU to publish it.`
    : `Revision ${c.revision} is ${c.status === 'IN_REVIEW' ? 'in review: it is waiting for a reviewer' : 'approved: it is waiting for a publisher'}${c.submitted_by_you ? ' (someone other than you)' : ''}.`;
  if (s.latest_published_revision && !s.unpublished_changes) return `Revision ${s.latest_published_revision} is published and in the library.`;
  if (s.latest_published_revision) return `Revision ${s.latest_published_revision} is published. Revision ${s.working_revision} is a draft and is not in the library yet.`;
  return 'Not published yet: only its authors see this draft.';
};

// ---- build ----------------------------------------------------------------------------------------------------------
export function ModuleBuild() {
  const { ws, apply } = useStudio();
  const p = usePersistence()!;
  const place = usePlace();
  const survey = ws.surveys[0]!;
  const inst = survey.sequence[0];
  const m = workingModule(ws);
  const standing = useStanding(p.surveyId, p.revision);
  const [card, setCard] = useState(false);
  if (!inst || !m) return <div className="ss-empty page" role="alert" data-testid="ss-module-broken"><p><strong>This module’s draft could not be shown.</strong> It does not hold a module revision.</p><Link className="ss-btn" to="/survey-studio?view=blocks">Back to building blocks</Link></div>;
  const head = (
    <div className="ss-module-head" data-testid="ss-module-head" data-code={m.code} data-revision={m.revision} data-state={m.published ? 'FROZEN' : 'DRAFT'}>
      <p className="ss-module-standing" data-testid="ss-module-standing"><Glyph name="info" size={14} /> <span>Reusable module <span className="ss-code">{m.code}</span>, authored on its own. {standing ? standingText(standing) : ''}</span></p>
      <div className="ss-module-tools">
        {!m.published ? (
          <label className="ss-field inline"><span>Kind</span>
            <select value={m.kind} onChange={(e) => apply('Changed the kind of module', (w) => ({ ...w, modules: w.modules.map((x) => (mKey(x) === mKey(m) ? { ...x, kind: e.target.value as ModuleKind } : x)) }))} data-testid="ss-module-kind">
              {(Object.keys(KIND_LABEL) as ModuleKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select></label>) : null}
        <button type="button" className="ss-btn small" onClick={() => setCard((v) => !v)} aria-expanded={card} data-testid="ss-module-card-toggle">{card ? 'Hide' : 'Preview'} library card</button>
        <Link className="ss-btn small" to={`${place.base}/test`} data-testid="ss-module-to-test"><Glyph name="next" size={14} /> Test this module</Link>
        <Link className="ss-btn small" to={`${place.base}/review`} data-testid="ss-module-to-review">Review and publish</Link>
      </div>
      {card ? <LibraryCardPreview m={m} /> : null}
    </div>
  );
  return <BuilderPage standalone={{ surveyId: survey.id, instanceId: inst.id, head, onNextRevision: () => apply(`Started revision ${m.revision + 1}`, startNextRevision) }} />;
}

/** At the top of a module's review page: what will appear in the library, and that publishing is not approval for use. */
export function ModuleReviewLead() {
  const { ws } = useStudio();
  const m = workingModule(ws);
  if (!m) return null;
  return (
    <section className="ss-review-card ss-module-lead" aria-labelledby="ss-module-lead-h" data-testid="ss-module-review-lead">
      <div>
        <h2 id="ss-module-lead-h">What publishing this module does</h2>
        <p>Publishing puts revision {m.revision} in <strong>Building blocks</strong>, where any survey author can inspect it and add it to a survey. A survey that adds it pins this exact revision: a later revision never changes that survey unless its author chooses the newer one.</p>
        <p className="ss-muted">Publishing a module does not put it in any survey, does not change any survey, and makes nothing eligible for a call.</p>
      </div>
      <LibraryCardPreview m={m} />
    </section>
  );
}

// ---- test -----------------------------------------------------------------------------------------------------------
/** An answer as a person gave it — the option's own label where the engine delivered one — never as JSON. */
const answerWords = (a: Any, label: (code: string) => string): string =>
  a?.acknowledged !== undefined && a.acknowledged !== null ? (a.acknowledged ? 'Acknowledged' : 'Did not acknowledge')
    : a?.number !== undefined && a.number !== null ? String(a.number)
      : Array.isArray(a?.choices) ? (a.choices.length ? a.choices.map(label).join(', ') : 'Nothing chosen')
        : a?.choice !== undefined && a.choice !== null ? `${label(String(a.choice))}${a.other_text ? ` (“${a.other_text}”)` : ''}`
          : typeof a?.text === 'string' ? (a.text ? `“${a.text}”` : 'Left empty') : 'No answer given';
const SOURCE: Record<string, string> = { WORKING_DRAFT: 'The saved draft', FROZEN_REVISION: 'A submitted (frozen) revision', PUBLISHED_REVISION: 'A published revision' };

function FactsForm({ fields, facts, onApply, busy }: { fields: Record<string, Any>; facts: Facts; onApply: (f: Facts) => void; busy: boolean }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])));
  const codes = Object.keys(fields);
  if (!codes.length) return <p className="ss-muted" data-testid="ss-mt-no-facts">This module reads no customer or policy information: no condition in it needs a fact.</p>;
  const typed = (): Facts => Object.fromEntries(codes.flatMap((c): Array<[string, string | number | boolean]> => {
    const raw = (draft[c] ?? '').trim(), t = fields[c]?.type;
    if (raw === '') return []; // left empty = the fact is missing, which is itself something to test
    return [[c, t === 'BOOLEAN' ? raw === 'true' : t === 'MONEY' || t === 'INTEGER' ? (Number.isNaN(Number(raw)) ? raw : Number(raw)) : raw]];
  }));
  return (
    <form className="ss-mt-facts" onSubmit={(e) => { e.preventDefault(); onApply(typed()); }} data-testid="ss-mt-facts">
      {codes.map((c) => {
        const f = fields[c] ?? {};
        const set = (v: string) => setDraft((d) => ({ ...d, [c]: v }));
        return (
          <label key={c} className="ss-field"><span>{f.label ?? c}{f.unit ? <em> {f.unit}</em> : null}</span>
            {f.type === 'ENUM' ? <select value={draft[c] ?? ''} onChange={(e) => set(e.target.value)} data-testid={`ss-mt-fact-${c}`}><option value="">— missing —</option>{((f.values ?? []) as string[]).map((v) => <option key={v} value={v}>{words(v)}</option>)}</select>
              : f.type === 'BOOLEAN' ? <select value={draft[c] ?? ''} onChange={(e) => set(e.target.value)} data-testid={`ss-mt-fact-${c}`}><option value="">— missing —</option><option value="true">Yes</option><option value="false">No</option></select>
                : <input value={draft[c] ?? ''} onChange={(e) => set(e.target.value)} inputMode={f.type === 'TEXT' ? 'text' : 'decimal'} placeholder="missing" data-testid={`ss-mt-fact-${c}`} />}
          </label>
        );
      })}
      <button type="submit" className="ss-btn small" disabled={busy} data-testid="ss-mt-facts-apply">Use these facts and start again</button>
      <p className="ss-muted">Invented values. Leave one empty to test what the module does when the information is missing.</p>
    </form>
  );
}

/** One module, run by the Call360 engine. `unsaved` = the builder holds changes the server has not got. */
export function ModuleTestPanel({ target, unsaved, onSave, builder }: { target: TestTarget; unsaved?: number; onSave?: () => void; builder?: string }) {
  const { can } = useAuth();
  const allowed = can('survey.simulate');
  const [facts, setFacts] = useState<Facts>({});
  const [inputs, setInputs] = useState<TestInput[]>([]);
  const [t, setT] = useState<ModuleTest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ identical: boolean; first: string; second: string; inputs: number } | null>(null);
  const attempt = useRef(0);
  const key = JSON.stringify(target);
  const run = useCallback((f: Facts, i: TestInput[]) => {
    const mine = ++attempt.current;
    setBusy(true); setError(null); setReplay(null);
    testModule(JSON.parse(key) as TestTarget, f, i).then((r) => { if (mine === attempt.current) { setT(r); setFacts(f); setInputs(i); } })
      .catch((e) => { if (mine === attempt.current) setError(say(e)); }).finally(() => { if (mine === attempt.current) setBusy(false); });
  }, [key]);
  useEffect(() => { if (allowed) run({}, []); }, [allowed, run]);

  if (!allowed) return <div className="ss-empty" role="status" data-testid="ss-mt-not-permitted"><p><strong>You cannot test this module.</strong> {NO_TEST}</p></div>;
  if (!t) return error ? <p className="ss-note warn" role="alert" data-testid="ss-mt-error"><Glyph name="alert" size={14} /><span>{error}</span></p> : <p className="ss-loading" role="status" data-testid="ss-mt-loading"><span className="ss-spinner" aria-hidden="true" /> Asking the Call360 engine…</p>;

  const mod = t.module as Any;
  const r = t.run as unknown as PyRun | null;
  const last = t.inputs[t.inputs.length - 1] as Any;
  const pending = r?.pending ?? null;
  const refused = last && !last.accepted && pending && last.key === pending.key ? last : null;
  const blockers = (t.findings as Any[]).filter((f) => f.severity === 'BLOCKER');
  const give = (a: SimAnswer) => { if (pending) run(facts, [...inputs, { key: pending.key, answer: a }]); };
  const replayNow = () => {
    setBusy(true); setError(null);
    testModule(target, facts, inputs).then((again) => setReplay({ identical: again.run_sha256 === t.run_sha256, first: t.run_sha256 ?? '', second: again.run_sha256 ?? '', inputs: inputs.length }))
      .catch((e) => setError(say(e))).finally(() => setBusy(false));
  };
  const controls = (
    <div className="ss-sim-controls" role="group" aria-label="Test controls">
      <button type="button" className="ss-btn" onClick={() => run(facts, inputs.slice(0, -1))} disabled={busy || !inputs.length} data-testid="ss-mt-back" title="Take back the last answer and try another">Take back the last answer</button>
      <button type="button" className="ss-btn" onClick={() => run(facts, [])} disabled={busy} data-testid="ss-mt-restart">Start again</button>
      <button type="button" className="ss-btn" onClick={replayNow} disabled={busy || !inputs.length} data-testid="ss-mt-replay-go" title="Give the engine exactly the same facts and answers again and compare the two runs">Replay the same inputs</button>
    </div>
  );
  const end = r?.terminal;
  // option labels as the engine delivered them at each question of this path
  const known = new Map<string, string>();
  for (const e of (r?.events ?? []) as Any[]) for (const o of ((e.options ?? []) as Any[])) if (o?.code) known.set(String(o.code), String(o.label || o.code));
  for (const o of pending?.options ?? []) known.set(o.code, o.label || o.code);
  const labels = (c: string) => known.get(c) ?? words(c).replace(/^./, (x) => x.toUpperCase());
  return (
    <div className="ss-srv ss-mt" data-testid="ss-mt" data-status={t.status} data-revision={mod.revision} data-source={mod.source} data-inputs={t.inputs.length} data-run={t.run_sha256 ?? ''}>
      <p className="ss-note" data-testid="ss-mt-notice"><Glyph name="info" size={14} /><span><strong>A test, not an approval.</strong> The Call360 engine runs this one module with invented facts and the answers you give. Nothing is recorded, and a module that tests well is not thereby reviewed, published or eligible for any call.</span></p>
      {unsaved ? <p className="ss-note warn" role="status" data-testid="ss-mt-unsaved"><Glyph name="alert" size={14} /><span><strong>You have {plural(unsaved, 'unsaved change')}.</strong> The engine tests what is saved on the server, not what is on your screen. {onSave ? <button type="button" className="ss-link" onClick={onSave} data-testid="ss-mt-save">Save now</button> : null}</span></p> : null}
      {error ? <p className="ss-note warn" role="alert" data-testid="ss-mt-error"><Glyph name="alert" size={14} /><span>{error}</span></p> : null}
      <div className="ss-sim-grid">
        <aside className="ss-sim-side" aria-label="What is tested, and with which facts">
          <section aria-labelledby="ss-mt-what-h">
            <h2 id="ss-mt-what-h">What is being tested</h2>
            <dl className="ss-srv-ids" data-testid="ss-mt-identity">
              <div><dt>Module</dt><dd>{mod.name}</dd></div>
              <div><dt>Revision</dt><dd data-testid="ss-mt-revision">{mod.revision} · {SOURCE[mod.source] ?? mod.source}</dd></div>
              <div><dt>In the library</dt><dd>{mod.published ? 'Yes — published' : 'No — not published'}</dd></div>
              <div><dt>Module fingerprint</dt><dd className="ss-code">{short(mod.sha256)}</dd></div>
              <div><dt>Engine</dt><dd className="ss-code" data-testid="ss-mt-contract">{t.engine_contract}</dd></div>
            </dl>
            <details className="ss-sim-evidence" data-testid="ss-mt-manifest"><summary>Exact versions it ran on ({t.manifest.length})</summary>
              <ul className="ss-mt-manifest">{(t.manifest as Any[]).map((e) => <li key={`${e.kind}${e.code}${e.version}`}><span>{words(e.kind)}</span> <span className="ss-code">{e.code}</span> v{e.version} <span className="ss-code">{short(e.sha256)}</span></li>)}</ul></details>
          </section>
          <section aria-labelledby="ss-mt-facts-h">
            <h2 id="ss-mt-facts-h">Synthetic facts</h2>
            <FactsForm key={JSON.stringify(facts)} fields={t.fields as Record<string, Any>} facts={facts} busy={busy} onApply={(f) => run(f, [])} />
          </section>
        </aside>

        <main className="ss-sim-main" aria-label="The module, step by step">
          {!t.testable ? (
            <section className="ss-sim-stage end tone-halt" data-testid="ss-mt-not-testable" aria-labelledby="ss-mt-nt-h">
              <p className="ss-sim-eyebrow"><Glyph name="stop" size={14} /> Not run</p>
              <h2 id="ss-mt-nt-h">This module cannot be tested yet</h2>
              <p>The engine does not run a module that has {plural(blockers.length, 'blocker')}: it would have to guess. Fix {blockers.length === 1 ? 'it' : 'them'} in the builder, save, and test again.</p>
              <ul className="ss-server-findings">{blockers.map((f, i) => <li key={`${f.code}${f.at}${i}`}><span className="ss-finding-sev"><Glyph name="stop" size={14} /> Blocker</span><span><strong>{f.message}</strong><small><span className="ss-code">{f.code}</span> at <span className="ss-code">{f.at}</span></small></span></li>)}</ul>
              {builder ? <Link className="ss-btn primary" to={builder} data-testid="ss-mt-to-builder">Open the builder</Link> : null}
            </section>
          ) : !pending && r ? (
            <section className={`ss-sim-stage end tone-${end?.state === 'COMPLETED' ? 'ok' : end?.state === 'ENDED_WITH_OUTCOME' || end?.state === 'MANDATORY_ESCALATION' ? 'alt' : 'halt'}`} aria-labelledby="ss-mt-stage-h" data-testid="ss-mt-end" data-terminal={end?.state ?? ''} data-outcome={end?.survey_outcome ?? ''}>
              <p className="ss-sim-eyebrow"><Glyph name={end?.state === 'COMPLETED' ? 'check' : 'stop'} size={14} /> The module ended</p>
              <h2 id="ss-mt-stage-h" data-testid="ss-mt-end-headline">{end?.survey_outcome ? `Ending: ${words(end.survey_outcome)}` : TERMINAL_TEXT[end?.state ?? ''] ?? end?.state}</h2>
              {end?.reason ? <p>Reason code <span className="ss-code">{end.reason}</span> at <span className="ss-code">{end.at}</span>.</p> : null}
              <p className="ss-sim-fine">This is the ending the module reached on this path. In a survey, its author decides where each ending of the module leads. No case, finding or disposition was created.</p>
              {controls}
            </section>
          ) : pending && r ? (
            <section className="ss-sim-stage" aria-labelledby="ss-mt-stage-h" data-testid="ss-mt-stage" data-key={pending.key} data-type={pending.answer_type}>
              <p className="ss-sim-eyebrow"><span className="ss-code">{pending.key}</span>{pending.followup ? ' · follow-up question' : ''} <Tag>Call360 engine</Tag></p>
              <p className="ss-sim-hears">The customer would hear, exactly</p>
              <h2 id="ss-mt-stage-h" data-testid="ss-mt-question">{pending.text}</h2>
              {r.status === 'POLICY_UNRESOLVED' && r.policy_unresolved ? (
                <div className="ss-srv-policy" role="alert" data-testid="ss-mt-policy">
                  <strong><Glyph name="stop" size={14} /> Policy unresolved</strong>
                  <p>The customer did not acknowledge at <span className="ss-code">{r.policy_unresolved.key}</span> (reason code <span className="ss-code">{r.policy_unresolved.reason}</span>). What a call does then has not been decided by the business, so the engine does not continue past this point. This is not an ending of the module: take back the answer to try another.</p>
                </div>
              ) : refused ? <p className="ss-issue" role="alert" data-testid="ss-mt-reject" data-code={refused.rejection_code ?? ''}><Glyph name="alert" size={14} /> Not accepted ({refused.rejection_code}): {REJECTION_TEXT[refused.rejection_code ?? ''] ?? ''} The same question is still current.</p> : null}
              <AnswerForm key={`${pending.key}:${t.inputs.length}`} p={pending} busy={busy} onGive={give} />
              {pending.queue ? <div className="ss-sim-queue" data-testid="ss-mt-queue"><h3>Follow-up queue</h3><ol>{pending.queue.map((x) => <li key={x.node} className={x.state.toLowerCase()}><span>{x.state === 'DONE' ? 'Asked' : x.state === 'NOW' ? 'Now' : 'Next'}</span>{x.node}</li>)}</ol></div> : null}
              {controls}
            </section>
          ) : null}
          {replay ? (
            <p className={`ss-note ${replay.identical ? '' : 'warn'}`} role="status" data-testid="ss-mt-replay" data-identical={String(replay.identical)}>
              <Glyph name={replay.identical ? 'check' : 'alert'} size={14} />
              <span>{replay.identical ? <>The engine was given the same facts and the same {plural(replay.inputs, 'answer')} again: <strong>the run is identical</strong>.</> : <><strong>The replay differs from the first run.</strong> This must be investigated.</>} Run fingerprints <span className="ss-code">{short(replay.first)}</span> and <span className="ss-code">{short(replay.second)}</span>.</span>
            </p>
          ) : null}
          {t.inputs.length ? (
            <section className="ss-mt-given" aria-labelledby="ss-mt-given-h" data-testid="ss-mt-inputs">
              <h3 id="ss-mt-given-h">Answers given on this path</h3>
              <ol>{(t.inputs as Any[]).map((i) => <li key={i.seq} data-accepted={String(i.accepted)}><span className="ss-code">{i.key}</span> <span>{answerWords(i.answer, labels)}</span> {i.accepted ? <Tag tone="ok">Accepted</Tag> : <Tag tone="warn">Refused · {i.rejection_code}</Tag>}</li>)}</ol>
            </section>
          ) : null}
        </main>

        <aside className="ss-sim-timeline" aria-label="Execution trace">
          <h2>Execution trace</h2>
          <p className="ss-muted">Every step the engine took, in order, with what it read.</p>
          {r ? <ServerTrace run={r} /> : <p className="ss-muted">Nothing was run.</p>}
          {r ? (
            <details className="ss-sim-evidence" data-testid="ss-mt-delivered" open>
              <summary>Exact wording delivered ({r.delivered.length})</summary>
              <ol className="ss-srv-said">{r.delivered.map((d) => <li key={d.key}><span className="ss-code">{d.key} · {d.item} · wording {d.wording_version}</span><span>{d.text}</span></li>)}</ol>
            </details>) : null}
          {t.run_sha256 ? <p className="ss-muted">Run fingerprint <span className="ss-code" data-testid="ss-mt-run-sha">{short(t.run_sha256)}</span></p> : null}
        </aside>
      </div>
    </div>
  );
}

/** The Test step of a standalone module: its saved draft, by the engine. */
export function ModuleTestPage() {
  const { ws } = useStudio();
  const p = usePersistence()!;
  const place = usePlace();
  const survey = ws.surveys[0]!;
  const m = workingModule(ws);
  const target = useMemo((): TestTarget => ({ moduleId: p.surveyId }), [p.surveyId]);
  return (
    <>
      <StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: 'Building blocks', to: '/survey-studio?view=blocks' }, { label: survey.name, to: place.base }, { label: 'Test' }]} badge={m ? <Tag tone={m.published ? 'shared' : 'draft'}>Revision {m.revision}{m.published ? ' · frozen' : ' · draft'}</Tag> : undefined} />
      <JourneyNav survey={survey} at="test" compact />
      <div className="ss-mt-page" data-testid="ss-module-test-page">
        <header className="ss-review-head"><h1 className="ss-title">Test {survey.name}</h1><p className="ss-muted">Answer as a customer might and follow each branch. Take back an answer to try the other way.</p></header>
        {/* the saved revision is what is tested: a save starts the test again on what was saved */}
        <ModuleTestPanel key={p.revision} target={target} unsaved={p.dirty ? p.changed : 0} onSave={() => void p.save()} builder={place.base} />
      </div>
    </>
  );
}

/** Any PUBLISHED module of the library, tested on its own — however it was authored. Opened from the inspector. */
export function PublishedModuleTestPage({ bar }: { bar: (crumbs: string[]) => ReactNode }) {
  const { code = '', revision = '' } = useParams();
  const target = useMemo((): TestTarget => ({ code, revision: Number(revision) || 1 }), [code, revision]);
  return (
    <>
      {bar(['Survey Studio', `Test ${code} revision ${target.revision}`])}
      <div className="ss-mt-page" data-testid="ss-module-test-page" data-published="true">
        <header className="ss-review-head"><h1 className="ss-title">Test a published module</h1>
          <p className="ss-muted">Revision {target.revision} of <span className="ss-code">{code}</span>, exactly as published. <Link to={`/survey-studio?view=blocks&inspect=MODULE~${code}~${target.revision}`} data-testid="ss-mt-back-to-inspector">Back to its inspector</Link></p></header>
        <ModuleTestPanel key={`${code}@${target.revision}`} target={target} />
      </div>
    </>
  );
}
