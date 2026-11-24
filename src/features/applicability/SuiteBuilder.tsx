// Survey Applicability (APPL-X4a) — the Regression Suite Builder. A suite is an ordered set of saved scenarios for one
// policy, each with the outcome a person EXPECTS. Expectations are stated and confirmed by the person; the current
// result may be offered as a PROPOSAL, never adopted silently. Running a suite records immutable evidence.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { same } from './model/describe';
import { NameAndCode, codeOk, suggestCode } from './policyService';
import {
  archiveSuite, codeOf, createSuite, evaluateScenarios, factWord, getRun, getSuite, listScenarios, listSuites, proposal, runSuite, saveSuite, stated, when, why, OUTCOME, STATUS_WORD,
  type Coverage, type Difference, type Expectation, type MemberIn, type PlanStatus, type SuiteDetail, type SuitePurpose, type SuiteSummary,
} from './scenarioApi';
import type { StudioPolicy } from './ScenarioStudio';
import { useAppl } from './store';
import { Empty, Field, Icon, Picker, Segmented, Tag, useParamState } from './ui';
import { BASE, shortName } from './usage';

const SUITE: Record<SuitePurpose, { word: string; says: string }> = {
  PUBLICATION_GATING: { word: 'Publication-gating', says: 'Regression scenarios only. A future publication will need a suite like this to pass.' },
  EXPLORATORY: { word: 'Exploratory', says: 'Any scenario. Useful for trying things; never counts towards publication.' },
};
interface Member { scenario_id: string; code: string; name: string; purpose: string; facts: Record<string, unknown>; expectation: Expectation | null; scenario_changed?: boolean }
interface Work { name: string; description: string; purpose: SuitePurpose; members: Member[] }
const workOf = (u: SuiteDetail): Work => ({ name: u.name, description: u.description, purpose: u.purpose, members: u.member_list.map((m) => ({ scenario_id: m.scenario_id, code: m.code, name: m.name, purpose: m.purpose, facts: m.facts, expectation: (m.expectation as unknown as Expectation | null) ?? null, scenario_changed: m.scenario_changed })) });
const wire = (w: Work): { doc: { name: string; description: string }; purpose: SuitePurpose; members: MemberIn[] } => ({ doc: { name: w.name.trim(), description: w.description }, purpose: w.purpose, members: w.members.map((m) => ({ scenario_id: m.scenario_id, expectation: m.expectation ? (stated(m.expectation) as Expectation) : null })) });

export function SuiteBuilder({ policy, canEdit }: { policy: StudioPolicy; canEdit: boolean }) {
  const [chosen, setChosen] = useParamState('u');
  const [creating, setCreating] = useState<null | { clone?: SuiteDetail }>(null);
  const list = useQuery({ queryKey: ['x4-suites', policy.id], queryFn: () => listSuites({ policy_id: policy.id, limit: 100 }) });
  const items = list.data?.items ?? [];
  if (chosen) return <SuiteEditor key={chosen} id={chosen} policy={policy} canEdit={canEdit} others={items.filter((u) => u.id !== chosen)} onBack={() => setChosen(null)} onClone={(u) => { setChosen(null); setCreating({ clone: u }); }} />;
  return (
    <div className="ap-suites" data-testid="ap-suites" data-state={list.isLoading ? 'loading' : list.isError ? 'error' : 'ready'}>
      <header className="ap-suites-head"><div><h2>Regression suites of this policy</h2><p className="ap-quiet">A suite says, scenario by scenario, which surveys must be selected. Run it after every change to see what still holds.</p></div>
        {canEdit ? <button type="button" className="ap-btn primary" disabled={!list.isSuccess} onClick={() => setCreating({})} data-testid="ap-suite-new"><Icon name="plus" size={13} /> New suite</button> : null}</header>
      {creating && canEdit ? <NewSuite policy={policy} clone={creating.clone} taken={(c) => items.some((u) => u.code.toLowerCase() === c.toLowerCase())} onCancel={() => setCreating(null)} onCreated={(id) => { setCreating(null); setChosen(id); }} /> : null}
      {list.isError ? <p className="ap-callout warn">The suites could not be read: {why(list.error)}</p> : null}
      <ul className="ap-suite-cards">{items.map((u) => <li key={u.id}><SuiteCard u={u} onOpen={() => setChosen(u.id)} /></li>)}</ul>
      {list.isSuccess && !items.length && !creating ? <Empty icon="cards" title="No suite yet" action={canEdit ? <button type="button" className="ap-btn primary" onClick={() => setCreating({})} data-testid="ap-suite-new-empty"><Icon name="plus" size={13} /> Create the first suite</button> : undefined}>Group saved scenarios and state what each must select.</Empty> : null}
    </div>
  );
}
function SuiteCard({ u, onOpen }: { u: SuiteSummary; onOpen: () => void }) {
  const last = u.last_run;
  return (
    <button type="button" className="ap-suite-card" onClick={onOpen} data-testid={`ap-suite-${u.code}`} data-last={last?.status ?? 'NEVER'}>
      <span className="ap-suite-card-top"><strong>{u.name}</strong><Tag tone={u.purpose === 'PUBLICATION_GATING' ? 'cond' : 'unknown'}>{SUITE[u.purpose].word}</Tag></span>
      <small>{u.members} scenario{u.members === 1 ? '' : 's'} · {u.with_expectation} with an expected outcome</small>
      <span className="ap-suite-card-run">{last ? <><Tag tone={OUTCOME[last.status]?.tone ?? 'plain'}>{OUTCOME[last.status]?.word ?? last.status}</Tag> <small>{last.passed} of {last.scenarios} passed · {when(last.created_at)}{last.suite_revision !== u.draft_revision ? ' · suite changed since' : ''}</small></> : <small className="ap-quiet">Never run</small>}</span>
    </button>
  );
}
function NewSuite({ policy, clone, taken, onCancel, onCreated }: { policy: StudioPolicy; clone?: SuiteDetail; taken: (c: string) => boolean; onCancel: () => void; onCreated: (id: string) => void }) {
  const { say } = useAppl();
  const qc = useQueryClient();
  const [name, setName] = useState(clone ? `${clone.name} (copy)` : '');
  const [code, setCode] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<SuitePurpose>(clone?.purpose ?? 'PUBLICATION_GATING');
  const [error, setError] = useState<string | null>(null);
  const value = code ?? suggestCode(name);
  const create = async () => {
    try {
      const made = await createSuite({ market_code: policy.market, code: value, policy_id: policy.id, document: { name: name.trim(), description: clone?.description ?? '' }, purpose, origin: clone ? `CLONE:${clone.code}` : 'BLANK',
        members: clone ? clone.member_list.map((m) => ({ scenario_id: m.scenario_id, expectation: m.expectation ? (stated(m.expectation as unknown as Expectation) as Expectation) : null })) : [] });
      await qc.invalidateQueries({ queryKey: ['x4-suites'] }); say(clone ? `Cloned with its ${clone.member_list.length} scenarios and their expected outcomes` : `“${made.name}” saved in Call360`); onCreated(made.id);
    } catch (e) { setError(`Not created: ${why(e)}`); }
  };
  return (
    <section className="ap-newscn" data-testid="ap-suite-create" aria-label="Create a suite">
      <header><h2>{clone ? `Clone “${clone.name}”` : 'Create a suite'}</h2><button type="button" className="ap-iconbtn" aria-label="Cancel" onClick={onCancel}><Icon name="x" /></button></header>
      <NameAndCode noun="suite" name={name} setName={setName} code={code} setCode={setCode} taken={taken} />
      <div className="ap-templates small two" role="radiogroup" aria-label="Purpose">{(['PUBLICATION_GATING', 'EXPLORATORY'] as const).map((p) => <button key={p} type="button" role="radio" aria-checked={purpose === p} className={purpose === p ? 'on' : ''} onClick={() => setPurpose(p)} data-testid={`ap-suite-create-purpose-${p}`}><strong>{SUITE[p].word}</strong><small>{SUITE[p].says}</small></button>)}</div>
      {error ? <p className="ap-callout warn" role="alert" data-testid="ap-suite-create-error">{error}</p> : null}
      <footer><button type="button" className="ap-btn quiet" onClick={onCancel}>Cancel</button><button type="button" className="ap-btn primary" disabled={name.trim().length < 2 || !codeOk(value, taken)} onClick={() => void create()} data-testid="ap-suite-create-save"><Icon name="check" size={13} /> Create and save</button></footer>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------- one suite
function SuiteEditor({ id, policy, canEdit, others, onBack, onClone }: { id: string; policy: StudioPolicy; canEdit: boolean; others: SuiteSummary[]; onBack: () => void; onClone: (u: SuiteDetail) => void }) {
  const { say, look } = useAppl();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['x4-suite', id], queryFn: () => getSuite(id) });
  const u = detail.data;
  const [work, setWork] = useState<{ w: Work; revision: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'saving' | 'running'>(null);
  const [flag, setFlag] = useState<{ state: 'conflict' | 'error'; message: string } | null>(null);
  const [against, setAgainst] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  useEffect(() => { if (u && (!work || work.revision !== u.draft_revision)) setWork({ w: workOf(u), revision: u.draft_revision }); }, [u]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = work?.w;
  const dirty = !!u && !!w && !same(wire(w), wire(workOf(u)));
  const unconfirmed = (w?.members ?? []).filter((m) => m.expectation && !m.expectation.confirmed);
  const lastId = u?.last_run?.id;
  const last = useQuery({ queryKey: ['x4-run', lastId, 'all'], queryFn: () => getRun(lastId!, { limit: 100 }), enabled: !!lastId });
  // what the policy selects NOW for each member — a live answer, not recorded; it is what a proposal is taken from
  const ids = (w?.members ?? []).map((m) => m.scenario_id);
  const now = useQuery({ queryKey: ['x4-suite-now', policy.id, policy.revision, ids.join(',')], enabled: ids.length > 0 && ids.length <= 60, retry: false, placeholderData: (p) => p, queryFn: () => evaluateScenarios(policy.id, ids.map((s) => ({ ref: s, scenario_id: s }))) });
  const pool = useQuery({ queryKey: ['x4-scenarios', policy.market, '', '', 100], queryFn: () => listScenarios({ limit: 100 }) });
  const other = useQuery({ queryKey: ['x4-suite', against], queryFn: () => getSuite(against!), enabled: !!against });
  const set = (f: (x: Work) => void) => setWork((cur) => { if (!cur) return cur; const next = structuredClone(cur.w); f(next); return { ...cur, w: next }; });
  const results = useMemo(() => new Map((last.data?.results ?? []).map((r) => [r.scenario_id, r])), [last.data]);
  const current = useMemo(() => new Map((now.data?.results ?? []).map((r) => [r.ref, r])), [now.data]);
  if (detail.isError) return <Empty icon="warn" title="This suite could not be read" action={<button type="button" className="ap-btn" onClick={onBack}>Back to the suites</button>}>{why(detail.error)}</Empty>;
  if (!u || !w) return <p className="ap-quiet" data-testid="ap-suite-editor" data-state="loading">Reading the suite…</p>;
  const readOnly = !canEdit || u.state === 'ARCHIVED';
  const stale = !!u.last_run && (u.last_run.suite_revision !== u.draft_revision || u.last_run.policy_revision !== policy.revision);
  const save = async (overwrite = false) => {
    setBusy('saving'); setFlag(null);
    try {
      const x = wire(w); const revision = overwrite ? (await getSuite(id)).draft_revision : u.draft_revision;
      const saved = await saveSuite(id, revision, x.doc, x.purpose, x.members);
      qc.setQueryData(['x4-suite', id], saved); void qc.invalidateQueries({ queryKey: ['x4-suites'] }); say(`Suite saved · revision ${saved.draft_revision}`);
    } catch (e) { setFlag({ state: codeOf(e) === 'STALE_REVISION' ? 'conflict' : 'error', message: why(e) }); } finally { setBusy(null); }
  };
  const run = async () => {
    setBusy('running');
    try { const r = await runSuite(id); qc.setQueryData(['x4-run', r.id, 'all'], r); await Promise.all([detail.refetch(), qc.invalidateQueries({ queryKey: ['x4-runs'] }), qc.invalidateQueries({ queryKey: ['x4-suites'] })]); say(`Run recorded: ${OUTCOME[r.status]?.word ?? r.status} — ${r.passed} of ${r.scenarios} passed`, r.status === 'PASSED' ? 'ok' : 'warn'); }
    catch (e) { say(`Not run: ${why(e)}`, 'warn'); } finally { setBusy(null); }
  };
  const move = (i: number, by: number) => set((x) => { const j = i + by; if (j < 0 || j >= x.members.length) return; const [a, b] = [x.members[i]!, x.members[j]!]; x.members[i] = b; x.members[j] = a; });
  const state = readOnly ? 'readonly' : busy === 'saving' ? 'saving' : flag?.state ?? (dirty ? 'unsaved' : 'saved');
  const cov = last.data?.coverage as unknown as Coverage | undefined;
  const inPool = (pool.data?.items ?? []).filter((s) => !w.members.some((m) => m.scenario_id === s.id));
  const counts = { passed: 0, failed: 0, other: 0 };
  w.members.forEach((m) => { const r = results.get(m.scenario_id); if (r?.outcome === 'PASSED') counts.passed += 1; else if (r?.outcome === 'FAILED') counts.failed += 1; else counts.other += 1; });

  return (
    <div className="ap-suite" data-testid="ap-suite-editor" data-state={state} data-code={u.code} data-revision={u.draft_revision} data-last={u.last_run?.status ?? 'NEVER'}>
      <p className="ap-back"><button type="button" className="ap-linkbtn" onClick={onBack} data-testid="ap-suite-back"><Icon name="left" size={12} /> All suites</button></p>
      <div className={`ap-savebar is-${state}`} data-testid="ap-suite-bar" data-state={state} role="status">
        <span className="ap-savebar-says" data-testid="ap-suite-bar-says">
          {state === 'readonly' ? <><Icon name="lock" size={13} /> Read only.</> : state === 'saving' ? 'Saving…' : state === 'conflict' || state === 'error' ? <><Icon name="warn" size={13} /> {flag?.message}</>
            : state === 'unsaved' ? <><Icon name="info" size={13} /> <strong>Unsaved changes.</strong> Save before running: a run uses what is saved.</> : <><Icon name="check" size={13} /> <strong>Saved in Call360</strong> · revision {u.draft_revision} · {u.updated_by ?? 'someone'} · {when(u.updated_at)}</>}
        </span>
        {!readOnly ? <span className="ap-savebar-acts">
          {state === 'conflict' ? <><button type="button" className="ap-btn" onClick={async () => { setFlag(null); const x = (await detail.refetch()).data ?? u; setWork({ w: workOf(x), revision: x.draft_revision }); }} data-testid="ap-suite-reload">Show the saved version</button><button type="button" className="ap-btn" onClick={() => void save(true)}>Save mine over it</button></>
            : <>{dirty ? <button type="button" className="ap-btn quiet" onClick={() => { setWork({ w: workOf(u), revision: u.draft_revision }); setFlag(null); }} data-testid="ap-suite-revert">Discard changes</button> : null}
              <button type="button" className="ap-btn" disabled={!dirty || !!busy || w.name.trim().length < 2 || unconfirmed.length > 0} title={unconfirmed.length ? `${unconfirmed.length} expected outcome${unconfirmed.length === 1 ? ' is' : 's are'} not confirmed yet` : undefined} onClick={() => void save()} data-testid="ap-suite-save"><Icon name="check" size={13} /> Save</button></>}
          <button type="button" className="ap-btn primary" disabled={dirty || !!busy || !w.members.length} title={dirty ? 'Save first' : !w.members.length ? 'Add a scenario first' : `Runs against saved policy revision ${policy.revision} and records the result`} onClick={() => void run()} data-testid="ap-suite-run"><Icon name="play" size={13} /> {busy === 'running' ? 'Running…' : 'Run and record'}</button>
        </span> : null}
      </div>
      {unconfirmed.length ? <p className="ap-callout warn" data-testid="ap-suite-unconfirmed"><Icon name="warn" /> <span>{unconfirmed.length} expected outcome{unconfirmed.length === 1 ? ' is a proposal' : 's are proposals'} that you have not confirmed. Review {unconfirmed.length === 1 ? 'it' : 'each'} and confirm, or clear it. Nothing is saved until then.</span></p> : null}

      <header className="ap-suite-head">
        <div className="ap-scn-title">
          <textarea className="ap-title-input" rows={1} aria-label="Suite name" readOnly={readOnly} value={w.name} onChange={(e) => set((x) => { x.name = e.target.value.replace(/\n/g, ' '); })} data-testid="ap-suite-name" />
          <input className="ap-sub-input" aria-label="Suite description" readOnly={readOnly} placeholder="What this suite protects" value={w.description} onChange={(e) => set((x) => { x.description = e.target.value; })} />
          <p className="ap-quiet"><code>{u.code}</code> · for <Link to={`${BASE}/policies/${policy.code}`}>{policy.name}</Link> · saved revision {policy.revision}</p>
        </div>
        <div className="ap-suite-tools">
          <Segmented label="Purpose" value={w.purpose} onChange={(p) => { if (readOnly) return; if (p === 'PUBLICATION_GATING' && w.members.some((m) => m.purpose !== 'REGRESSION')) { say('A publication-gating suite holds regression scenarios only. Remove the exploratory ones first.', 'warn'); return; } set((x) => { x.purpose = p; }); }} testid="ap-suite-purpose" options={[{ value: 'PUBLICATION_GATING', label: 'Publication-gating', testid: 'ap-suite-purpose-PUBLICATION_GATING' }, { value: 'EXPLORATORY', label: 'Exploratory', testid: 'ap-suite-purpose-EXPLORATORY' }]} />
          {canEdit ? <button type="button" className="ap-btn quiet" onClick={() => onClone(u)} disabled={dirty} data-testid="ap-suite-clone"><Icon name="copy" size={13} /> Clone</button> : null}
          {others.length ? <select className="ap-input" aria-label="Compare with another suite" value={against ?? ''} onChange={(e) => setAgainst(e.target.value || null)} data-testid="ap-suite-compare"><option value="">Compare with…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select> : null}
          {u.last_run ? <Link className="ap-btn quiet" to={`?view=runs&r=${u.last_run.id}`} data-testid="ap-suite-open-last-run"><Icon name="history" size={13} /> Last run</Link> : null}
          {canEdit && u.state !== 'ARCHIVED' ? <button type="button" className="ap-iconbtn" aria-label="Archive this suite" onClick={() => setArchiving(archiving === null ? '' : null)} data-testid="ap-suite-archive"><Icon name="trash" size={14} /></button> : null}
        </div>
      </header>
      {archiving !== null ? <div className="ap-callout" data-testid="ap-suite-archive-panel"><div><strong>Archive this suite?</strong><p>Its recorded runs are kept. It can be restored.</p><input className="ap-input" value={archiving} onChange={(e) => setArchiving(e.target.value)} placeholder="Why (at least 10 characters)" aria-label="Reason" data-testid="ap-suite-archive-reason" /> <button type="button" className="ap-btn" disabled={archiving.trim().length < 10} onClick={async () => { try { await archiveSuite(id, u.draft_revision, archiving); await qc.invalidateQueries({ queryKey: ['x4-suites'] }); onBack(); } catch (e) { say(why(e), 'warn'); } }} data-testid="ap-suite-archive-ok">Archive</button></div></div> : null}

      <section className="ap-suite-status" data-testid="ap-suite-status" aria-label="Status of the last run">
        {u.last_run ? <>
          <div className={`ap-suite-verdict is-${OUTCOME[u.last_run.status]?.tone}`} data-testid="ap-suite-verdict" data-status={u.last_run.status}><strong>{OUTCOME[u.last_run.status]?.word}</strong><span>{u.last_run.passed} of {u.last_run.scenarios} passed · recorded {when(u.last_run.created_at)} against policy revision {u.last_run.policy_revision}</span></div>
          {stale ? <p className="ap-quiet" data-testid="ap-suite-stale"><Icon name="info" size={12} /> {u.last_run.suite_revision !== u.draft_revision ? 'The suite' : 'The policy'} changed after that run. Run again to see what holds now; the earlier run is kept unchanged.</p> : null}
        </> : <div className="ap-suite-verdict is-plain" data-testid="ap-suite-verdict" data-status="NEVER"><strong>Not run yet</strong><span>State the expected outcome of each scenario, save, then run and record.</span></div>}
        {u.diagnostics.length ? <ul className="ap-suite-diags">{(u.diagnostics as unknown as { code: string; message: string; severity: string }[]).slice(0, 6).map((x, i) => <li key={i} data-code={x.code}><Icon name={x.severity === 'BLOCKER' ? 'warn' : 'info'} size={12} /> {x.message}</li>)}</ul> : null}
      </section>

      <section className="ap-members" aria-label="Scenarios in this suite">
        <header><h3>Scenarios and their expected outcomes <span className="ap-count">{w.members.length}</span></h3>
          {!readOnly ? <span className="ap-members-add">
            <Picker label="Add a saved scenario" testid="ap-suite-add" items={inPool.map((s) => ({ id: s.id, label: s.name, hint: `${s.code} · ${s.purpose === 'REGRESSION' ? 'regression' : 'exploratory'}`, icon: 'scenario' as const, disabled: w.purpose === 'PUBLICATION_GATING' && s.purpose !== 'REGRESSION' }))}
              onPick={(sid) => { const s = inPool.find((x) => x.id === sid); if (s) set((x) => { x.members.push({ scenario_id: s.id, code: s.code, name: s.name, purpose: s.purpose, facts: {}, expectation: null }); }); }} button={<span className="ap-btn"><Icon name="plus" size={13} /> Add a saved scenario</span>} />
            <Link className="ap-btn quiet" to="?view=scenarios&new=1" data-testid="ap-suite-new-scenario"><Icon name="scenario" size={13} /> Create a scenario</Link>
          </span> : null}</header>
        {!w.members.length ? <Empty icon="scenario" title="No scenario in this suite yet">Add saved scenarios, then say what each one must select.</Empty> : null}
        <ol className="ap-member-list" data-testid="ap-suite-members">
          {w.members.map((m, i) => {
            const r = results.get(m.scenario_id); const cur = current.get(m.scenario_id); const exp = m.expectation;
            const verdict = !exp ? 'NO_EXPECTATION' : !exp.confirmed ? 'UNCONFIRMED' : dirty || stale || !r ? 'NOT_RUN' : r.outcome;
            return (
              <li key={m.scenario_id} className={`ap-member is-${verdict.toLowerCase()}${open === m.scenario_id ? ' open' : ''}`} data-testid={`ap-member-${m.code}`} data-verdict={verdict} data-position={i + 1}>
                <div className="ap-member-row">
                  <span className="ap-member-order">{!readOnly ? <><button type="button" className="ap-iconbtn" aria-label={`Move ${m.name} up`} disabled={i === 0} onClick={() => move(i, -1)} data-testid={`ap-member-${m.code}-up`}><Icon name="up" size={12} /></button><button type="button" className="ap-iconbtn" aria-label={`Move ${m.name} down`} disabled={i === w.members.length - 1} onClick={() => move(i, 1)} data-testid={`ap-member-${m.code}-down`}><Icon name="down" size={12} /></button></> : null}<b>{i + 1}</b></span>
                  <span className="ap-member-name"><Link to={`?view=scenarios&s=${m.scenario_id}`}><strong>{m.name}</strong></Link>
                    <small>{Object.entries(m.facts).slice(0, 4).map(([k, v]) => `${look.variable(k)?.name ?? k}: ${factWord(v)}`).join(' · ') || m.code}{m.scenario_changed ? ' · changed since its expectation was reviewed' : ''}</small></span>
                  <span className="ap-member-exp" data-testid={`ap-member-${m.code}-expected`}><small>Expected</small><Outcome status={exp?.status} surveys={exp?.selected.map((s) => shortName(s.name))} pending={exp?.pending.length} empty="not stated" /></span>
                  <span className="ap-member-act" data-testid={`ap-member-${m.code}-actual`}><small>{r && !dirty && !stale ? 'Recorded' : 'Now'}</small>{(() => { const p = r && !dirty && !stale ? r.actual as { status?: string; selected?: { name: string }[]; pending?: string[] } : cur?.plan ? { status: cur.plan.status, selected: cur.plan.selected.map((e) => ({ name: e.survey.name })), pending: cur.plan.pending.map((e) => e.survey.code) } : null; return <Outcome status={p?.status} surveys={p?.selected?.map((s) => shortName(s.name))} pending={p?.pending?.length} empty={cur && cur.state !== 'EVALUATED' ? 'could not evaluate' : '…'} />; })()}</span>
                  <span className="ap-member-verdict"><Tag tone={verdict === 'PASSED' ? 'published' : verdict === 'FAILED' ? 'bad' : verdict === 'NOT_RUN' ? 'plain' : 'warn'} testid={`ap-member-${m.code}-verdict`}>{verdict === 'NOT_RUN' ? 'Not run' : verdict === 'UNCONFIRMED' ? 'Proposal — confirm' : OUTCOME[verdict]?.word ?? verdict}</Tag></span>
                  <button type="button" className="ap-btn quiet" aria-expanded={open === m.scenario_id} onClick={() => setOpen(open === m.scenario_id ? null : m.scenario_id)} data-testid={`ap-member-${m.code}-open`}>{open === m.scenario_id ? 'Close' : exp ? 'Review' : 'State expected'}</button>
                </div>
                {verdict === 'FAILED' && r ? <ul className="ap-member-diffs" data-testid={`ap-member-${m.code}-differences`}>{(r.differences as unknown as Difference[]).map((x, k) => <li key={k} data-kind={x.kind}><Icon name="warn" size={12} /> {x.text}{x.requirements?.length ? <> · {x.requirements.slice(0, 3).map((rid) => <Link key={rid} to={`${BASE}/policies/${policy.code}?r=${rid}`} data-testid={`ap-member-${m.code}-requirement-${rid}`}>open requirement {rid}</Link>)}</> : null}</li>)}</ul> : null}
                {(verdict === 'COULD_NOT_EVALUATE' || verdict === 'INVALID_DEFINITION') && r?.reason ? <p className="ap-member-diffs" data-testid={`ap-member-${m.code}-reason`}><Icon name="warn" size={12} /> {r.reason}</p> : null}
                {open === m.scenario_id ? <ExpectationEditor policy={policy} member={m} readOnly={readOnly} current={cur?.plan ?? null}
                  onChange={(e) => set((x) => { x.members[i]!.expectation = e; })} onRemove={() => { set((x) => { x.members.splice(i, 1); }); setOpen(null); }} /> : null}
              </li>
            );
          })}
        </ol>
        {ids.length > 60 ? <p className="ap-quiet">The live “now” column is shown for suites of up to 60 scenarios. Run the suite to see every result.</p> : null}
      </section>

      {cov && !dirty ? <CoveragePanel cov={cov} policy={policy} stale={stale} purpose={u.purpose} /> : null}
      {against && other.data ? <SuiteDiff mine={w} theirs={workOf(other.data)} theirName={other.data.name} /> : null}
      <details className="ap-suite-history"><summary>History of this suite</summary><ol className="ap-lib-events" data-testid="ap-suite-history">{u.events.map((e) => <li key={e.seq} data-event={e.event}><strong>{e.event === 'CREATED' ? 'Created' : e.event === 'DRAFT_SAVED' ? 'Saved' : e.event === 'ARCHIVED' ? 'Archived' : 'Restored'} · revision {e.draft_revision}</strong> by {e.actor}<small>{when(e.occurred_at)}{(e.detail.expectations_changed as string[] | undefined)?.length ? ` · ${(e.detail.expectations_changed as string[]).length} expected outcome(s) changed` : ''}{(e.detail.proposed_from_result as string[] | undefined)?.length ? ` · ${(e.detail.proposed_from_result as string[]).length} taken from a result and confirmed` : ''}</small></li>)}</ol></details>
    </div>
  );
}
function Outcome({ status, surveys, pending, empty }: { status?: string; surveys?: string[]; pending?: number; empty: string }) {
  if (!status) return <em className="ap-quiet">{empty}</em>;
  return <span className="ap-xout" data-status={status}><b className={`is-${status === 'RESOLVED' ? 'true' : 'unknown'}`}>{STATUS_WORD[status] ?? status}</b>{surveys?.length ? surveys.map((s) => <span key={s} className="ap-chip survey">{s}</span>) : <span className="ap-chip plain">no survey</span>}{pending ? <span className="ap-chip plain">+{pending} pending</span> : null}</span>;
}

// ------------------------------------------------------------------------------- stating an expected outcome
function ExpectationEditor({ policy, member, readOnly, current, onChange, onRemove }: { policy: StudioPolicy; member: Member; readOnly: boolean; current: import('./model/types').Plan | null; onChange: (e: Expectation | null) => void; onRemove: () => void }) {
  const exp = member.expectation;
  const blank: Expectation = { status: 'RESOLVED', selected: [], pending: [], source: 'AUTHORED', confirmed: false };
  // any change makes it unconfirmed again: the person must look at what they are about to save
  const edit = (f: (e: Expectation) => void) => { const next = structuredClone(exp ?? blank); f(next); next.confirmed = false; onChange(next); };
  const e = exp ?? blank;
  const replaceable = policy.doc.requirements.filter((r) => policy.doc.requirements.some((o) => o.replaces.includes(r.id)));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="ap-expect" data-testid={`ap-expect-${member.code}`} data-confirmed={String(!!exp?.confirmed)} data-source={exp?.source ?? ''}>
      <fieldset className="ap-plainset" disabled={readOnly}>
        <Field label="Expected plan status" hint="“Unresolved” is a legitimate expectation when a fact the policy needs is not known.">
          <div className="ap-seg" role="radiogroup" aria-label="Expected status">{(['RESOLVED', 'UNRESOLVED', 'OUT_OF_SCOPE', 'SCOPE_UNRESOLVED'] as PlanStatus[]).map((s) => <button key={s} type="button" role="radio" aria-checked={e.status === s} className={e.status === s ? 'on' : ''} onClick={() => edit((x) => { x.status = s; })} data-testid={`ap-expect-${member.code}-status-${s}`}>{STATUS_WORD[s]}</button>)}</div>
        </Field>
        <Field label="Surveys that must be selected" hint="Exactly these, at exactly these published versions. Leave all unticked for “no survey”.">
          <div className="ap-choice wrap" role="group" aria-label="Expected surveys">{policy.surveys.map((s) => { const on = e.selected.some((x) => x.code === s.code); return <button key={s.code} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} onClick={() => edit((x) => { x.selected = on ? x.selected.filter((y) => y.code !== s.code) : [...x.selected, { code: s.code, version: s.version, name: s.name }]; x.pending = x.pending.filter((c) => c !== s.code); })} data-testid={`ap-expect-${member.code}-survey-${s.code}`}>{on ? <Icon name="check" size={12} /> : null}{shortName(s.name)} <small>v{s.version}</small></button>; })}</div>
        </Field>
        {e.status !== 'RESOLVED' ? <Field label="Surveys that must be pending" hint="Required only if a missing fact turns out a certain way.">
          <div className="ap-choice wrap" role="group" aria-label="Expected pending surveys">{policy.surveys.filter((s) => !e.selected.some((x) => x.code === s.code)).map((s) => { const on = e.pending.includes(s.code); return <button key={s.code} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} onClick={() => edit((x) => { x.pending = toggle(x.pending, s.code); })} data-testid={`ap-expect-${member.code}-pending-${s.code}`}>{on ? <Icon name="check" size={12} /> : null}{shortName(s.name)}</button>; })}</div>
        </Field> : null}
        {replaceable.length ? <Field label="Requirements that must be replaced (optional)" hint="Tick a requirement to assert that it applies but is replaced by another.">
          <div className="ap-choice wrap" role="group" aria-label="Expected replaced requirements">{replaceable.map((r) => { const on = !!e.replaced?.includes(r.id); return <button key={r.id} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} onClick={() => edit((x) => { const next = toggle(x.replaced ?? [], r.id); if (next.length) x.replaced = next; else delete x.replaced; })} data-testid={`ap-expect-${member.code}-replaced-${r.id}`}>{on ? <Icon name="check" size={12} /> : null}{r.name}</button>; })}</div>
        </Field> : null}
        <Field label="Note for reviewers (optional)"><input className="ap-input" value={e.note ?? ''} onChange={(ev) => edit((x) => { x.note = ev.target.value; })} placeholder="Why this is the right outcome" data-testid={`ap-expect-${member.code}-note`} /></Field>
      </fieldset>
      {!readOnly ? <div className="ap-expect-foot">
        {current ? <button type="button" className="ap-btn quiet" onClick={() => onChange(proposal(current))} data-testid={`ap-expect-${member.code}-propose`} title="Fills the form with what the policy selects now. It is only a proposal: review it and confirm."><Icon name="sparkle" size={13} /> Use the current result as a proposal</button> : null}
        {exp ? <button type="button" className="ap-btn quiet" onClick={() => onChange(null)} data-testid={`ap-expect-${member.code}-clear`}>Clear the expectation</button> : null}
        <button type="button" className="ap-btn quiet" onClick={onRemove} data-testid={`ap-expect-${member.code}-remove`}><Icon name="trash" size={13} /> Remove from the suite</button>
        <span className="ap-spacer" />
        {exp && !exp.confirmed ? <span className="ap-expect-confirm" data-testid={`ap-expect-${member.code}-unconfirmed`}>{exp.source === 'PROPOSED_FROM_RESULT' ? 'Taken from the current result. A result is not proof that it is right — check it.' : 'Check it, then confirm.'} <button type="button" className="ap-btn primary" onClick={() => onChange({ ...exp, confirmed: true })} data-testid={`ap-expect-${member.code}-confirm`}><Icon name="check" size={13} /> I reviewed this — confirm</button></span>
          : exp ? <span className="ap-quiet" data-testid={`ap-expect-${member.code}-confirmed`}><Icon name="check" size={12} /> Confirmed{exp.source === 'PROPOSED_FROM_RESULT' ? ' (first taken from a result)' : ''}</span> : <span className="ap-quiet">No expected outcome: this scenario can neither pass nor fail.</span>}
      </div> : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------ coverage
export function CoveragePanel({ cov, policy, stale, purpose }: { cov: Coverage; policy: StudioPolicy; stale?: boolean; purpose: string }) {
  const [all, setAll] = useState(false);
  const essential = cov.gaps.filter((g) => !g.code.startsWith('CONDITION_'));
  const condition = cov.gaps.filter((g) => g.code.startsWith('CONDITION_'));
  const shown = cov.requirements.slice(0, all ? cov.requirements.length : 12);
  return (
    <section className="ap-coverage" data-testid="ap-coverage" data-meaningful={String(cov.meaningful_for_publication)} data-essential={cov.essential_gaps} aria-label="Coverage of the last run">
      <header><h3>What the last run exercised{stale ? <span className="ap-quiet"> · of the earlier run</span> : null}</h3>
        <Tag tone={cov.meaningful_for_publication ? 'published' : 'warn'} testid="ap-coverage-verdict">{cov.meaningful_for_publication ? 'Meaningful for publication' : purpose === 'EXPLORATORY' ? 'Exploratory: does not count towards publication' : `Not yet meaningful for publication: ${cov.why_not_meaningful}`}</Tag></header>
      <p className="ap-quiet" data-testid="ap-coverage-label">{cov.label}</p>
      <dl className="ap-coverage-facts"><div><dt>Scenarios evaluated</dt><dd>{cov.scenarios_evaluated}</dd></div><div><dt>Passing, resolved, selecting a survey</dt><dd>{cov.resolved_positive_passing}</dd></div><div><dt>Passing, with a requirement that does not apply</dt><dd>{cov.negative_passing}</dd></div><div><dt>Unresolved results</dt><dd>{cov.unresolved}</dd></div></dl>
      <table className="ap-coverage-table"><thead><tr><th scope="col">Requirement</th><th scope="col">Applies</th><th scope="col">Does not apply</th><th scope="col">Not known</th><th scope="col">Exercised</th></tr></thead>
        <tbody>{shown.map((r) => { const total = Math.max(1, r.applies + r.does_not_apply + r.unknown); return (
          <tr key={r.id} data-testid={`ap-coverage-${r.id}`} data-applies={r.applies} data-not={r.does_not_apply} data-unknown={r.unknown}>
            <th scope="row"><Link to={`${BASE}/policies/${policy.code}?r=${r.id}`}>{r.name}</Link>{r.replaces.length ? <small> · replaces {r.replaces.length}{r.replaced_them ? '' : ' (not exercised)'}</small> : null}</th>
            <td className={r.applies ? '' : 'gap'}>{r.applies}</td><td className={r.does_not_apply ? '' : 'gap'}>{r.does_not_apply}</td><td>{r.unknown}</td>
            <td><span className="ap-covbar" role="img" aria-label={`${r.applies} applies, ${r.does_not_apply} does not apply, ${r.unknown} not known`}><i className="t" style={{ width: `${(r.applies / total) * 100}%` }} /><i className="f" style={{ width: `${(r.does_not_apply / total) * 100}%` }} /><i className="u" style={{ width: `${(r.unknown / total) * 100}%` }} /></span></td>
          </tr>); })}</tbody></table>
      {cov.requirements.length > 12 ? <button type="button" className="ap-linkbtn" onClick={() => setAll(!all)} data-testid="ap-coverage-all">{all ? 'Show fewer' : `Show all ${cov.requirements.length} requirements`}</button> : null}
      {essential.length ? <><h4>Not yet tested — add a scenario for each</h4><ul className="ap-gaps" data-testid="ap-coverage-gaps">{essential.slice(0, 20).map((g, i) => <li key={i} data-code={g.code}><Icon name="warn" size={12} /> {g.requirement ? <Link to={`${BASE}/policies/${policy.code}?r=${g.requirement}`}>{g.text}</Link> : g.text}</li>)}{essential.length > 20 ? <li className="ap-quiet">and {essential.length - 20} more</li> : null}</ul></> : null}
      {condition.length ? <details className="ap-gaps-more" data-testid="ap-coverage-conditions"><summary>{condition.length} condition branch{condition.length === 1 ? '' : 'es'} not exercised (suggestions)</summary><ul className="ap-gaps">{condition.slice(0, 40).map((g, i) => <li key={i} data-code={g.code}><Icon name="info" size={12} /> {g.text}</li>)}{condition.length > 40 ? <li className="ap-quiet">and {condition.length - 40} more</li> : null}</ul></details> : null}
    </section>
  );
}
function SuiteDiff({ mine, theirs, theirName }: { mine: Work; theirs: Work; theirName: string }) {
  const b = new Map(theirs.members.map((m) => [m.scenario_id, m]));
  const a = new Map(mine.members.map((m) => [m.scenario_id, m]));
  const rows = [...mine.members.map((m) => ({ m, o: b.get(m.scenario_id) })), ...theirs.members.filter((m) => !a.has(m.scenario_id)).map((o) => ({ m: undefined as Member | undefined, o }))];
  return (
    <section className="ap-coverage" data-testid="ap-suite-diff" aria-label="Comparison with another suite">
      <header><h3>Compared with “{theirName}”</h3></header>
      <table className="ap-coverage-table"><thead><tr><th scope="col">Scenario</th><th scope="col">This suite expects</th><th scope="col">“{theirName}” expects</th><th scope="col" /></tr></thead>
        <tbody>{rows.map(({ m, o }) => { const x = m ?? o!; const differs = !m || !o || !same(stated(m.expectation), stated(o.expectation)); return (
          <tr key={x.scenario_id} data-differs={String(differs)}><th scope="row">{x.name}</th>
            <td>{m ? <Outcome status={m.expectation?.status} surveys={m.expectation?.selected.map((s) => shortName(s.name))} pending={m.expectation?.pending.length} empty="not stated" /> : <em className="ap-quiet">not in this suite</em>}</td>
            <td>{o ? <Outcome status={o.expectation?.status} surveys={o.expectation?.selected.map((s) => shortName(s.name))} pending={o.expectation?.pending.length} empty="not stated" /> : <em className="ap-quiet">not in that suite</em>}</td>
            <td>{differs ? <Tag tone="warn">differs</Tag> : <Tag tone="published">same</Tag>}</td></tr>); })}</tbody></table>
    </section>
  );
}
