// Assignment Rules (`/assignment-rules`, F6): recorded rule versions (API-064) with predicate, priority, specificity,
// target script version, effective dates, checker, and the cases each rule assigned. Read-only: rules are shown,
// never evaluated here; automatic assignment and hold release are Stage S2.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { Icon } from '../../components/Icon';
import { Empty } from '../../components/StateView';
import { Badge, Card, PageHead } from '../../components/ui';
import { Region, when } from '../cases/shared';
import { describeCondition, S2Actions, scriptHref, short, StatusBadge, SyntheticBanner, type AssignmentRule } from './shared';

const ruleName = (r: AssignmentRule) => `${r.rule_code} v${r.version}`;

export function AssignmentRulesPage() {
  const [params] = useSearchParams();
  const focus = params.get('rule');
  const rules = useQuery({ queryKey: ['assignment-rules'], queryFn: async () => unwrap(await api.GET('/api/v1/script-assignment-rules')) });
  return (
    <>
      <PageHead eyebrow="Policy-to-script mapping" title="Assignment Rules"
        description="The recorded rules that selected a script version for each callback case, with their priority, predicate, target and effective dates. Read-only in Stage 0."
        actions={<>
          <Link className="btn" to="/scripts">Script Studio</Link>
          <S2Actions id="ar-s2" labels={['Test assignment', 'New mapping rule']} />
        </>} />
      <SyntheticBanner />
      <div className="layout cols-2" style={{ marginBottom: 18 }}>
        <Card title="How a recorded assignment reads" subtitle="Shown from stored traces; nothing is evaluated on this page">
          <div className="rules-flow"><span className="rule-chip">Case inputs snapshot</span><Icon name="chev" size="sm" />
            <span className="rule-chip">Rule predicate</span><Icon name="chev" size="sm" /><span className="rule-chip">Priority, then specificity</span>
            <Icon name="chev" size="sm" /><span className="rule-chip" style={{ color: 'var(--red)' }}>Pinned script version</span></div>
          <div className="explain" style={{ marginTop: 16 }}>Each case keeps its matched rule version, input snapshot and hash, script version and manifest SHA-256.
            Changing a rule or script later never rewrites an existing assignment. Automatic evaluation for new cases arrives in Stage S2;
            until then intake cases stay on hold “Awaiting script assignment”.</div>
        </Card>
        <Card title="Rule summary" subtitle="Rule versions in your markets">
          <Region query={rules} label="rule summary">
            {() => {
              const items = rules.data!.items;
              const by = (s: string) => items.filter((r) => r.status === s).length;
              return (
                <div className="info-grid" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
                  <div className="info-tile"><label>Rule versions</label><strong>{items.length}</strong></div>
                  <div className="info-tile"><label>Published</label><strong>{by('PUBLISHED')}</strong></div>
                  <div className="info-tile"><label>Superseded / withdrawn</label><strong>{by('SUPERSEDED')} / {by('WITHDRAWN')}</strong></div>
                  <div className="info-tile"><label>Cases assigned</label><strong>{items.reduce((n, r) => n + r.cases_assigned, 0)}</strong></div>
                </div>
              );
            }}
          </Region>
        </Card>
      </div>
      <Card title="Rule registry" subtitle="Lower priority number wins; specificity breaks ties. Open a rule for the cases it assigned." pad={false}>
        <Region query={rules} label="assignment rules">
          {() => rules.data!.items.length === 0 ? <Empty title="No assignment rules in your markets" /> : (
            <div className="stack" style={{ padding: 16 }} data-testid="rule-registry">
              {rules.data!.items.map((r) => <RuleRow key={r.id} r={r} open={focus === ruleName(r)} />)}
            </div>
          )}
        </Region>
      </Card>
    </>
  );
}

function RuleRow({ r, open }: { r: AssignmentRule; open: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (open) ref.current?.scrollIntoView?.({ block: 'center' }); }, [open]);
  return (
    <details ref={ref} className={`softbox rule-row${open ? ' focused' : ''}`} open={open} data-testid={`rule-${r.rule_code}-v${r.version}`}>
      <summary className="row between wrap" style={{ cursor: 'pointer', gap: 12 }}>
        <span className="row wrap" style={{ gap: 8 }}>
          <span className="mono strong small">{ruleName(r)}</span><StatusBadge status={r.status} />
          <span className="xsmall muted">priority {r.priority} · specificity {r.specificity}</span>
        </span>
        <span className="small">→ <span className="strong">{r.target.family} v{r.target.version_label}</span> · {r.cases_assigned} case{r.cases_assigned === 1 ? '' : 's'}</span>
      </summary>
      <dl className="kv xsmall" style={{ marginTop: 12 }}>
        <dt>Applies when</dt><dd>{describeCondition(r.predicate)}</dd>
        <dt>Target script</dt><dd><Link className="link" to={scriptHref(r.target_family_id, r.target.script_version_id)}>{r.target.family} v{r.target.version_label}</Link>{' '}
          <StatusBadge status={r.target.status} /> <span className="mono">{short(r.target.manifest_sha256)}</span></dd>
        <dt>Effective</dt><dd>{r.effective_from ? when(r.effective_from) : 'Not set'} – {r.effective_to ? when(r.effective_to) : 'open'}</dd>
        <dt>Author / checker</dt><dd>{r.author_ref ?? '—'} / {r.checker_ref ?? '—'}</dd>
        <dt>Checksum</dt><dd className="mono">{short(r.checksum)}</dd>
        <dt>Market</dt><dd>{r.market}</dd>
      </dl>
      <div className="section-label" style={{ marginTop: 12 }}>Cases assigned by this rule {r.cases_assigned > r.recent_cases.length ? `(latest ${r.recent_cases.length} of ${r.cases_assigned})` : ''}</div>
      {r.recent_cases.length ? (
        <div className="row wrap" style={{ gap: 6 }} data-testid="rule-cases">
          {r.recent_cases.map((c) => <Link key={c.case_id} className="tag mono" to={`/cases/${c.case_id}`}>{c.case_ref}</Link>)}
        </div>
      ) : <p className="xsmall muted" style={{ margin: 0 }}>No case was assigned by this rule version.</p>}
      {r.status !== 'PUBLISHED' ? <p className="xsmall muted" style={{ marginBottom: 0 }}><Badge tone="gray" noDot>Historical</Badge> Kept for the cases it assigned; not used for new assignments.</p> : null}
    </details>
  );
}
