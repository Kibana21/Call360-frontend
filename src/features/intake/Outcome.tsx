// The server's intake outcome (API-084 preview, API-085 result, or a stored run result). Everything shown comes
// from the response: references, holds, eligibility and source risk are never derived here.
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui';
import { humanize, RiskBadge, when } from '../cases/shared';
import type { IntakeOutcome } from './model';

export function OutcomeView({ outcome }: { outcome: IntakeOutcome }) {
  const c = outcome.case;
  const committed = outcome.mode === 'COMMITTED';
  return (
    <div className="stack intake-outcome" data-testid="intake-outcome">
      <div className="row wrap">
        {committed
          ? <Badge tone="green">{outcome.replayed ? 'Already submitted — stored result' : 'Submitted'}</Badge>
          : <Badge tone="blue">Preview — nothing saved</Badge>}
        {outcome.run_ref ? <span className="tag mono">{outcome.run_ref}</span> : null}
      </div>
      <dl className="intake-facts">
        <div><dt>Policy</dt><dd><span className="mono">{outcome.policy.policy_ref}</span> · {outcome.policy.outcome === 'NEW' ? 'New policy' : 'Existing policy (reused)'}</dd></div>
        <div><dt>Sale</dt><dd className="mono">{outcome.sale_ref}</dd></div>
        <div><dt>Callback case</dt><dd>{c.case_ref ? <span className="mono">{c.case_ref}</span> : <span className="muted">Reference assigned on submit</span>} · {humanize(c.state)}</dd></div>
        <div><dt>Due (source)</dt><dd>{when(c.due_at)} · Priority {c.priority}</dd></div>
        <div><dt>Pre-check</dt><dd>{c.callable ? 'Pre-check passed' : 'Blocked'}</dd></div>
        <div><dt>SBQ risk</dt><dd>{outcome.risk
          ? <><RiskBadge band={outcome.risk.band_code} /> <span className="xsmall muted">Source-assigned · {humanize(outcome.risk.status)} · source value {outcome.risk.source_original_value}</span></>
          : <span className="muted">{outcome.risk_note ?? 'No source risk supplied'}</span>}</dd></div>
        <div><dt>Script routing</dt><dd className="muted">Awaiting deterministic assignment — preview and apply it in Call Detail</dd></div>
        <div><dt>Compliance outcome</dt><dd className="muted">Not evaluated in Stage 0</dd></div>
      </dl>
      <div>
        <div className="section-label">Holds {committed ? 'placed' : 'that would apply'}</div>
        <ul className="plain-list">
          {outcome.holds.map((h) => (
            <li key={h.reason} className="row wrap"><Badge tone={h.blocking ? 'amber' : 'gray'}>{h.label}</Badge>{h.blocking ? <span className="xsmall muted">Blocking</span> : null}</li>
          ))}
        </ul>
      </div>
      {outcome.parties.length ? (
        <div>
          <div className="section-label">Parties</div>
          <ul className="plain-list">
            {outcome.parties.map((p, i) => (
              <li key={p.party_ref ?? i} className="small">
                <strong>{p.masked_name}</strong> {p.party_ref ? <span className="mono xsmall">{p.party_ref}</span> : <span className="xsmall muted">new party</span>}
                <span className="xsmall muted"> · {p.roles.map(humanize).join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <div className="section-label">Contact eligibility</div>
        <div className="table-wrap">
          <table className="data-table intake-elig">
            <caption className="sr-only">Contact eligibility</caption>
            <thead><tr><th scope="col">Party</th><th scope="col">Role</th><th scope="col">Eligible</th><th scope="col">Contact</th></tr></thead>
            <tbody>
              {outcome.eligibility.map((e, i) => (
                <tr key={i}>
                  <td>{e.masked_name}</td>
                  <td>{humanize(e.role)}</td>
                  <td>{e.eligible ? <Badge tone="green">Eligible</Badge> : <Badge tone="gray">{humanize(e.ineligibility_reason ?? 'NOT_ELIGIBLE')}</Badge>}</td>
                  <td className="mono">{e.contact_masked ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function OutcomeLinks({ outcome }: { outcome: IntakeOutcome }) {
  const r = outcome.routes ?? {};
  if (!r.policy && !r.case) return null;
  return (
    <div className="row wrap">
      {r.policy ? <Link className="btn" to={r.policy}>Open Policy Detail</Link> : null}
      {r.case ? <Link className="btn primary" to={r.case}>Open Call Detail</Link> : null}
    </div>
  );
}
