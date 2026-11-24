// Survey Applicability (APPL-X1R) — the other direction: from a survey in Survey Studio to the applicability policies
// that name it, and the way back to where you were. These read the prototype's workspace in THIS browser tab only —
// applicability policies are not saved in Call360 yet — and say so.
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { setReturn, useReturn } from './crossnav';
import { applicabilityEnabled, applicabilityPolicies } from './flag';
import { peekApplicability } from './store';

const BASE = '/survey-studio/applicability';
/** For a survey shown in Survey Studio: which applicability requirements name it (prototype scope). */
export function ApplicabilityWhereUsed({ code }: { code: string }) {
  if (!applicabilityEnabled()) return null;
  return <WhereUsed code={code} />;
}
function WhereUsed({ code }: { code: string }) {
  // APPL-X3: with saved policies the answer comes from Call360 — every saved policy that pins a version of this survey
  const saved = useQuery({ queryKey: ['appl-policy-usage', code], enabled: applicabilityPolicies(), retry: false, queryFn: async () => unwrap(await api.GET('/api/v1/applicability/policies/usage', { params: { query: { kind: 'SURVEY', code } } })).items });
  const data = peekApplicability();
  const rows = (data?.policies ?? []).flatMap((rec) => [rec.draft ? { doc: rec.draft, state: 'draft' } : null, rec.published ? { doc: rec.published, state: 'published example' } : null].filter(Boolean).flatMap((x) => x!.doc.requirements
    .filter((r) => (r.action.kind === 'INCLUDE' ? r.action.surveys : r.action.alternatives.map((a) => a.survey)).some((s) => s.code === code))
    .map((r) => ({ key: `${x!.doc.code}-${x!.state}-${r.id}`, policy: x!.doc.name, code: x!.doc.code, state: x!.state, version: x!.doc.version, requirement: r.name, id: r.id, pinned: (r.action.kind === 'INCLUDE' ? r.action.surveys : r.action.alternatives.map((a) => a.survey)).find((s) => s.code === code)?.label }))));
  return (
    <section className="ss-appl-used" data-testid="ss-applicability-where-used" data-count={rows.length}>
      <h3>Where used in Survey applicability</h3>
      {applicabilityPolicies() ? (saved.data?.length ? <ul data-testid="ss-appl-used-saved">{saved.data.map((u) => <li key={u.policy_id}><Link to={`${BASE}/policies/${u.policy_code}?focus=${code}`} data-testid={`ss-appl-used-policy-${u.policy_code}`}><strong>{u.policy_name}</strong><span>saved policy draft · revision {u.draft_revision} · pins version {u.version_no} of this survey</span></Link></li>)}</ul>
        : <p>{saved.isError ? 'The saved applicability policies could not be read (you may not be permitted to read them).' : saved.isPending ? 'Reading…' : 'No saved applicability policy names this survey.'}</p>) : null}
      {applicabilityPolicies() && rows.length ? <h4>Requirements, as open in this browser tab</h4> : null}
      {applicabilityPolicies() && !rows.length ? null : !data ? <p>Open <Link to={BASE}>Survey applicability</Link> to see which policies name this survey.</p>
        : rows.length ? <ul>{rows.map((r) => <li key={r.key}><Link to={`${BASE}/policies/${r.code}?r=${r.id}`} data-testid={`ss-appl-used-${r.code}-${r.id}`}><strong>{r.requirement}</strong><span>{r.policy} · {r.state} v{r.version}{r.pinned ? ` · pinned to version ${r.pinned}` : ''}</span></Link></li>)}</ul>
          : <p>No applicability requirement in this browser tab names this survey.</p>}
      <p className="ss-appl-scope">{applicabilityPolicies() ? 'Saved policies are read from Call360 and are working drafts: no applicability policy is published yet, and nothing here selects a survey for a case.' : 'Prototype scope: only the applicability policies open in this browser tab. They are not saved in Call360, so this is not yet a complete “where used”.'}</p>
    </section>
  );
}
/** Shown in Survey Studio after arriving from an applicability policy: one click back to the same place. */
export function ApplicabilityReturn() {
  const back = useReturn();
  const { pathname } = useLocation();
  if (!applicabilityEnabled() || !back || pathname.startsWith(BASE)) return null;
  return <div className="ss-appl-return" data-testid="ss-applicability-return"><Link to={back.path} onClick={() => setReturn(null)}>← Back to “{back.label}” in Survey applicability</Link><button type="button" aria-label="Dismiss" onClick={() => setReturn(null)}>×</button></div>;
}
