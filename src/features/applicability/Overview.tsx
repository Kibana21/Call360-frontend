// Survey Applicability (APPL-X1) — the overview: what is published, what is being changed, and what needs attention.
import { Link } from 'react-router-dom';
import { useAnalysis, useEvaluation } from './api';
import { sentence } from './model/describe';
import type { Requirement } from './model/types';
import { useAppl } from './store';
import { Icon, Tag } from './ui';
import { BASE, surveysOf } from './usage';

export function RequirementSentence({ r }: { r: Requirement }) {
  const { look } = useAppl();
  const names = surveysOf(r).map((s) => s.name.split(' · ')[0]);
  return (
    <p className="ap-sentence" data-testid={`ap-sentence-${r.id}`}>
      <span className="ap-when-word">When</span> <span className="ap-sentence-cond">{sentence(r.when, look)}</span>
      <span className="ap-then-word">then</span> <span className="ap-sentence-surveys">{r.action.kind === 'CHOOSE_ONE' ? `one of ${names.join(' or ')}` : names.join(', ')}</span>
      {r.replaces.length ? <span className="ap-sentence-replace"> — replacing {r.replaces.length} other requirement{r.replaces.length === 1 ? '' : 's'}</span> : null}
    </p>
  );
}

export function OverviewPage() {
  const { data, working } = useAppl();
  const rec = data.policies[0];
  const doc = rec ? working(rec.code) : null;
  const analysis = useAnalysis(data, doc);
  const impact = useEvaluation(data, rec?.draft, rec?.draft && rec?.published ? data.scenarios : [], rec?.published);
  const blockers = analysis.data?.diagnostics.filter((d) => d.severity === 'BLOCKER').length ?? 0;
  const warnings = analysis.data?.diagnostics.filter((d) => d.severity === 'WARNING').length ?? 0;
  const changed = impact.data?.results.filter((r) => r.comparison?.changed).length ?? 0;
  const read = new Set(analysis.data?.policy_variables ?? []);
  const unmapped = data.variables.filter((v) => read.has(v.code) && v.source.status === 'UNMAPPED');
  return (
    <div className="ap-page ap-overview" data-testid="ap-overview">
      <section className="ap-lead">
        <h1>Which surveys does an application need?</h1>
        <p className="ap-lead-says">Write it the way you would say it: <strong>when</strong> these conditions apply, <strong>then</strong> these surveys are required. Test it against example applications, then publish it as one reviewed policy.</p>
      </section>

      {rec && doc ? (
        <section className="ap-policy-card" data-testid={`ap-policy-${rec.code}`}>
          <header>
            <div><h2>{doc.name}</h2><p>{doc.description}</p></div>
            <div className="ap-policy-states">
              {rec.published ? <Tag tone="published" testid="ap-state-published"><Icon name="lock" size={11} /> Version {rec.published.version} published</Tag> : <Tag tone="plain">Nothing published yet</Tag>}
              {rec.draft ? <Tag tone="draft" testid="ap-state-draft">Version {rec.draft.version} draft{rec.unsaved ? ' · unsaved changes' : ''}</Tag> : null}
              {rec.candidate ? <Tag tone="info">{rec.candidate.state === 'APPROVED' ? 'Approved, waiting for publication' : 'In review'}</Tag> : null}
            </div>
          </header>
          <div className="ap-policy-body">
            <div className="ap-policy-sentences">{doc.requirements.map((r) => <RequirementSentence key={r.id} r={r} />)}{!doc.requirements.length ? <p className="ap-quiet">No requirement yet.</p> : null}</div>
            <div className="ap-policy-actions">
              <Link className="ap-btn primary" to={`${BASE}/policies/${rec.code}`} data-testid="ap-open-designer"><Icon name="cards" size={14} /> Open the designer</Link>
              <Link className="ap-btn" to={`${BASE}/scenarios`}><Icon name="play" size={14} /> Test scenarios</Link>
              <Link className="ap-btn" to={`${BASE}/governance/${rec.code}`}><Icon name="policy" size={14} /> Review and publish</Link>
            </div>
          </div>
        </section>
      ) : null}

      <section className="ap-attention" aria-label="What needs attention">
        <h2>What needs attention</h2>
        <ul>
          <li className={blockers ? 'bad' : 'ok'} data-testid="ap-attn-validation"><Icon name={blockers ? 'warn' : 'check'} /><div><strong>{blockers ? `${blockers} problem${blockers === 1 ? '' : 's'} must be fixed before review` : 'No blocking problem in the draft'}</strong><span>{warnings ? `${warnings} thing${warnings === 1 ? '' : 's'} worth a look.` : 'Nothing else was flagged.'} <Link to={`${BASE}/governance/${rec?.code}?tab=validation`}>Open validation</Link></span></div></li>
          {rec?.draft && rec.published ? <li className={changed ? 'warn' : 'ok'} data-testid="ap-attn-impact"><Icon name="replace" /><div><strong>{changed ? `The draft changes the result of ${changed} of ${data.scenarios.length} saved scenarios` : 'The draft changes no saved scenario'}</strong><span>Compared with published version {rec.published.version}. <Link to={`${BASE}/scenarios?tab=impact`}>See exactly what changes</Link></span></div></li> : null}
          <li className={unmapped.length ? 'warn' : 'ok'} data-testid="ap-attn-sources"><Icon name="link" /><div><strong>{unmapped.length ? `${unmapped.length} fact${unmapped.length === 1 ? '' : 's'} this policy reads ${unmapped.length === 1 ? 'has' : 'have'} no source yet` : 'Every fact this policy reads has a source'}</strong><span>{unmapped.length ? `${unmapped.map((v) => v.name).join(', ')}. The policy can be designed and tested, but not used for real applications.` : 'Good.'} <Link to={`${BASE}/variables`}>Variable library</Link></span></div></li>
        </ul>
      </section>

      <section className="ap-shelf" aria-label="Libraries">
        {([
          ['variable', 'Variables', data.variables.length, 'Facts about an application, defined once.', `${BASE}/variables`],
          ['profile', 'Application profiles', data.profiles.length, 'Reusable sets of variables that combine.', `${BASE}/profiles`],
          ['condition', 'Saved conditions', data.conditions.length, 'Named statements you can reuse.', `${BASE}/conditions`],
          ['scenario', 'Scenarios', data.scenarios.length, 'Example applications to test with.', `${BASE}/scenarios`],
        ] as const).map(([icon, label, n, hint, to]) => (
          <Link key={label} to={to} className={`ap-shelf-item kind-${icon}`}><span className="ap-shelf-icon"><Icon name={icon} size={18} /></span><span><strong>{n} {label.toLowerCase()}</strong><small>{hint}</small></span><Icon name="right" size={14} /></Link>
        ))}
      </section>
    </div>
  );
}
