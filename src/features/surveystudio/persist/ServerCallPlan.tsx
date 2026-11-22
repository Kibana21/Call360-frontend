// Survey Studio (SS-03B.3) — the call plan of a PUBLISHED version, assembled by the Call360 server. SIMULATION ONLY.
// Everything shown is the server's plan. A plan that can be computed is not permission to call anyone: that is a
// separate question which this screen does not answer.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import type { SimProfile } from '../model/demo';
import { buildCallPlan } from '../model/plan';
import { Glyph, Tag } from '../ui';
import { short, when } from './reviewApi';
import { NO_SIMULATE, Parity, usePublishedVersion } from './ServerSimulation';
import { createCallPlan, type Facts, type ServerCallPlan as Plan } from './simApi';
import { comparePlans, type PyPlan } from './serverRun';

const STATUS: Record<string, string> = { IN: 'Included', OUT: 'Excluded', CONDITIONAL: 'Conditional on the call', HALTS: 'Cannot be decided' };
const REASON: Record<string, string> = {
  NO_CONDITION: 'It has no entry condition.', ELIGIBLE: 'Its entry condition applies to this application.', NOT_ELIGIBLE: 'Its entry condition does not apply to this application.',
  UNKNOWN_SKIPPED: 'Information is missing, and the survey says to skip it and record why.', UNKNOWN_HALTS: 'Information is missing, and the survey says to stop rather than guess.',
  ON_OUTCOME: 'It is selected only by an outcome of an earlier module, during the call.', MODULE_MISSING: 'The module is missing.',
};
const ISSUE: Record<string, string> = { WORDING_VALUE_MISSING: 'An item cannot be worded: a value it needs is missing or unusable.', ELIGIBILITY_UNKNOWN: 'Whether a module applies cannot be decided from this application.', MODULE_MISSING: 'A module is missing.', CONDITION_INVALID: 'A condition cannot be evaluated.' };
const shown = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
const say = (e: unknown) => (e instanceof ApiFailure ? (e.status === 403 ? NO_SIMULATE : e.status === 404 ? 'Call plans are not available on this server, or this version is not available to you.' : e.message) : 'The server could not be reached.');

export function ServerCallPlan({ profile, base }: { profile: SimProfile; base: string }) {
  const pv = usePublishedVersion();
  const { version, vw } = pv;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const versionId = version?.id;
  const allowed = useAuth().can('survey.simulate');
  useEffect(() => {
    if (!versionId || !allowed) return undefined;
    let live = true;
    setPlan(null); setError(null);
    createCallPlan(versionId, profile.facts as Facts).then((p) => { if (live) setPlan(p); }).catch((e) => { if (live) setError(say(e)); });
    return () => { live = false; };
  }, [versionId, profile, allowed]);
  const py = plan ? (plan.plan as unknown as PyPlan) : null;
  const differences = useMemo(() => (py && vw ? comparePlans(py, buildCallPlan(vw.ws, vw.survey, profile.facts)) : null), [py, vw, profile]);

  if (pv.loading) return <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading the published versions…</p>;
  if (pv.failed) return <div className="ss-empty" role="alert"><p><strong>The published versions could not be loaded.</strong> {pv.failed}</p></div>;
  if (!version) {
    return (
      <div className="ss-empty" data-testid="ss-srvplan-none">
        <p><strong>This survey has no published version yet.</strong> The Call360 server plans published versions only.</p>
        <Link className="ss-btn" to={`${base}/review`}>Review and publish</Link>
      </div>
    );
  }
  return (
    <div className="ss-srv" data-testid="ss-srvplan" data-plan={plan?.id ?? ''} data-status={plan?.status ?? ''}>
      <div className="ss-srv-head">
        <p className="ss-note" data-testid="ss-srvplan-notice"><Glyph name="info" size={14} /><span>Assembled by the Call360 server for an invented application. A plan that can be computed is <strong>not</strong> permission to call: it makes nothing eligible for a real call, and no call is assembled or made.</span></p>
        <div className="ss-srv-pick">
          <label className="ss-field inline"><span>Published version</span>
            <select value={version.id} onChange={(e) => pv.choose(e.target.value)} data-testid="ss-srvplan-version">
              {pv.versions.map((v) => <option key={v.id} value={v.id}>Version {v.label}{v.status === 'SUPERSEDED' ? ' (superseded)' : ''} · published {when(v.published_at)}</option>)}
            </select></label>
        </div>
      </div>
      {!allowed ? <div className="ss-empty" role="status" data-testid="ss-srvplan-not-permitted"><p><strong>You cannot generate a call plan.</strong> {NO_SIMULATE}</p></div> : null}
      {plan && !plan.recompute_consistent ? <p className="ss-note warn" role="alert" data-testid="ss-srvplan-drift"><Glyph name="alert" size={14} /><span>Assembling this plan again now does not give the recorded plan (recorded under {plan.plan_contract}). The recorded plan is shown; generate a new one before relying on it.</span></p> : null}
      {error ? <p className="ss-note warn" role="alert" data-testid="ss-srvplan-error"><Glyph name="alert" size={14} /><span>{error}</span></p> : null}
      {!allowed ? null : !plan || !py ? (error ? null : <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Assembling the plan on the server…</p>) : (
        <>
          <section className={`ss-plan-q ${py.status === 'READY' ? 'yes' : 'no'}`} aria-labelledby="ss-srvplan-h" data-testid="ss-srvplan-verdict" data-status={py.status}>
            <p className="ss-plan-q-label">Can a plan be computed from this application?</p>
            <h2 id="ss-srvplan-h"><Glyph name={py.status === 'READY' ? 'check' : 'stop'} size={18} /> {py.status === 'READY' ? 'Yes: a plan can be computed' : 'No: the plan is blocked'}</h2>
            {py.issues.length ? <ul className="ss-plan-blockers" data-testid="ss-srvplan-issues">{py.issues.map((i) => <li key={`${i.code}:${i.at}`} data-code={i.code}><Glyph name="alert" size={14} /> <span className="ss-code">{i.code}</span> at <span className="ss-code">{i.at}</span>. {ISSUE[i.code] ?? ''}</li>)}</ul> : <p>Every item this customer could hear can be worded, and every module can be decided.</p>}
            <p className="ss-muted">A technical answer only. Whether this survey may be used on a call is a different question, and it is not answered here.</p>
          </section>
          <dl className="ss-plan-identity" data-testid="ss-srvplan-identity">
            <div><dt>Version</dt><dd>{plan.version_label} of {plan.survey_code}</dd></div>
            <div><dt>Application</dt><dd>{profile.name}</dd></div>
            <div><dt>Plan fingerprint</dt><dd className="ss-code" data-testid="ss-srvplan-fingerprint" title={plan.fingerprint}>{short(plan.fingerprint)}{plan.fingerprint_verified ? ' · verified' : ' · NOT verified'}</dd></div>
            <div><dt>Kind of record</dt><dd>{plan.record_class === 'SIMULATION' ? 'Simulation' : plan.record_class}</dd></div>
          </dl>
          <Parity differences={differences} what="plan" />
          <section aria-labelledby="ss-srvplan-facts-h" className="ss-srv-block">
            <h2 id="ss-srvplan-facts-h">Facts the plan read</h2>
            {py.inputs.length ? (
              <table className="ss-table" data-testid="ss-srvplan-inputs"><thead><tr><th scope="col">Field</th><th scope="col">Stands as</th><th scope="col">Value used</th><th scope="col">Used by</th></tr></thead>
                <tbody>{py.inputs.map((i) => <tr key={i.field} data-state={i.state}><th scope="row"><span className="ss-code">{i.field}</span></th><td>{i.state === 'PRESENT' ? 'Present' : i.state === 'MISSING' ? 'Missing' : 'Unusable'}</td><td>{shown(i.value)}</td><td>{i.used_by.join(', ')}</td></tr>)}</tbody></table>
            ) : <p className="ss-muted">This version reads nothing from the application: every customer gets the same plan.</p>}
          </section>
          <section aria-labelledby="ss-srvplan-modules-h" className="ss-srv-block">
            <h2 id="ss-srvplan-modules-h">Modules and exact wording</h2>
            <ol className="ss-srv-planmods" data-testid="ss-srvplan-modules">
              {py.modules.map((m) => (
                <li key={m.instance} data-testid={`ss-srvplan-module-${m.instance}`} data-status={m.status}>
                  <header><strong>{m.name}</strong> <Tag tone={m.status === 'IN' ? 'ok' : m.status === 'HALTS' ? 'warn' : undefined}>{STATUS[m.status] ?? m.status}</Tag></header>
                  <p className="ss-muted">{REASON[m.reason] ?? m.reason}{m.eligibility?.reads.length ? ` Read: ${m.eligibility.reads.map((r) => `${r.field} ${r.state === 'PRESENT' ? `= ${shown(r.value)}` : `is ${r.state.toLowerCase()}`}`).join('; ')}.` : ''}</p>
                  {m.items.length ? (
                    <ol className="ss-srv-said">
                      {m.items.map((i) => (
                        <li key={i.key} data-deliverable={String(i.text !== null)}>
                          <span className="ss-code">{i.key} · wording {i.wording_version} · {i.statement ? 'statement' : 'question'} · {i.certainty === 'ALWAYS' ? 'on every path' : 'on some paths'}</span>
                          {i.text !== null ? <span>{i.text}</span> : <span className="ss-issue"><Glyph name="alert" size={14} /> Cannot be delivered: {i.errors.map((e) => `${e.variable || 'wording'} ${e.code.toLowerCase().replace(/_/g, ' ')}`).join('; ')}. Nothing is spoken in its place.</span>}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {m.open.length ? <p className="ss-muted" data-testid={`ss-srvplan-open-${m.instance}`}>{m.open.length} point{m.open.length === 1 ? '' : 's'} still decided during the call: {m.open.map((o) => `${o.key} (${o.kind === 'ANSWER' ? 'an answer' : o.kind === 'CONDITION' ? 'a condition' : 'the module’s outcome'})`).join(', ')}.</p> : null}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
