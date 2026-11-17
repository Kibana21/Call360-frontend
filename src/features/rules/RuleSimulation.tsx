// S2-B rule simulation: the live ruleset (baseline) and the ruleset with the chosen drafts published (proposed),
// evaluated by the backend against the synthetic Singapore cases in a read-only transaction. Shows outcomes, the
// cases each rule wins, conflicts, existing pinned assignments and a per-case condition trace. Nothing is assigned.
import { useMutation } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { Badge, Button, Card } from '../../components/ui';
import { humanize, RiskBadge, when } from '../cases/shared';
import { sgtInputToIso } from '../intake/model';
import { ErrorBox, errorText } from '../scripts/ScriptEditor';
import { ConflictList, fieldLabel, OutcomeBadge, outcomeLabel, valueLabel, type RuleOptions, type SimCase, type Simulation } from './shared';

type Filter = 'changed' | 'all' | 'attention' | 'existing';

export function RuleSimulation({ draftIds, o, title = 'Simulate against synthetic cases' }: { draftIds: string[]; o: RuleOptions | undefined; title?: string }) {
  const [scope, setScope] = useState<'ALL' | 'OPEN' | 'UNASSIGNED'>('ALL');
  const [asOf, setAsOf] = useState('');
  const [filter, setFilter] = useState<Filter>('changed');
  const run = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/assignment-rules/simulate', { body: { draft_ids: draftIds, scope, as_of: asOf ? sgtInputToIso(asOf) : null } })),
  });
  const s = run.data;
  return (
    <Card title={title} subtitle="Deterministic and read-only: no assignment, case state, hold or KPI is changed (automatic assignment is S2-C)">
      <div className="stack" style={{ gap: 14 }} data-testid="rule-simulation">
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div><label className="form-label" htmlFor="sim-scope">Cases</label>
            <select id="sim-scope" className="field" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="ALL">All Singapore cases</option><option value="OPEN">Open cases only</option><option value="UNASSIGNED">Cases without a script</option>
            </select></div>
          <div><label className="form-label" htmlFor="sim-asof">Evaluate as of (SGT, optional)</label>
            <input id="sim-asof" type="datetime-local" className="field" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
          <Button variant="primary" icon="play" onClick={() => run.mutate()} disabled={run.isPending} data-testid="sim-run">{run.isPending ? 'Simulating…' : draftIds.length ? 'Run simulation' : 'Simulate live rules'}</Button>
          <span className="xsmall muted">{draftIds.length ? `Live rules plus ${draftIds.length} proposed draft${draftIds.length === 1 ? '' : 's'}` : 'Live published rules only'}</span>
        </div>
        <ErrorBox error={run.error ? errorText(run.error) : null} />
        {s ? <Results s={s} o={o} filter={filter} setFilter={setFilter} /> : <p className="small muted" style={{ margin: 0 }}>Run the simulation to see which rule each case would match.</p>}
      </div>
    </Card>
  );
}

function Results({ s, o, filter, setFilter }: { s: Simulation; o: RuleOptions | undefined; filter: Filter; setFilter: (f: Filter) => void }) {
  const p = s.summary.proposed;
  const n = (k: string) => p[k] ?? 0;
  const attention = (c: SimCase) => !['SELECTED', 'SELECTED_BY_FALLBACK'].includes(c.proposed.outcome);
  const rows = s.cases.filter((c) => filter === 'all' || (filter === 'changed' && c.changed) || (filter === 'attention' && attention(c)) || (filter === 'existing' && c.differs_from_existing));
  const shown = rows.slice(0, 200);
  return (
    <>
      <p className="small" role="status" data-testid="sim-note" style={{ margin: 0 }}><Badge tone="green">No side effects</Badge> {s.note} Evaluated as of {when(s.as_of)} SGT.</p>
      <div className="info-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }} data-testid="sim-summary">
        <Tile label="Cases evaluated" value={s.summary.cases} />
        <Tile label="Script selected" value={n('SELECTED') + n('SELECTED_BY_FALLBACK')} sub={n('SELECTED_BY_FALLBACK') ? `${n('SELECTED_BY_FALLBACK')} by fallback` : undefined} />
        <Tile label="No match" value={n('NO_MATCH')} testId="sim-no-match" />
        <Tile label="Ambiguous" value={n('AMBIGUOUS') + n('AMBIGUOUS_SAME_TARGET')} sub={n('AMBIGUOUS_SAME_TARGET') ? `${n('AMBIGUOUS_SAME_TARGET')} same-script ties` : undefined} testId="sim-ambiguous" />
        <Tile label="Fail closed" value={n('INPUT_MISSING') + n('TARGET_NOT_EFFECTIVE')} sub="Missing input or script not effective" />
        <Tile label="Changed vs live rules" value={s.summary.changed} testId="sim-changed" />
        <Tile label="Differs from pinned script" value={s.summary.differs_from_existing} sub="Existing assignments are not changed" />
      </div>
      <div>
        <div className="section-label">Rules evaluated (precedence order)</div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Rules evaluated"><table className="data-table" data-testid="sim-rules">
          <thead><tr><th>Rule</th><th>Priority</th><th>Specificity</th><th>Target script</th><th>Effective</th><th>Cases won</th></tr></thead>
          <tbody>{s.rules.map((r) => (
            <tr key={r.ref} data-testid={`sim-rule-${r.rule_code}`}>
              <td><span className="mono strong">{r.ref}</span> {r.origin === 'PROPOSED' ? <Badge tone="purple">Proposed</Badge> : null}{r.is_fallback ? <Badge tone="blue">Fallback</Badge> : null}
                <div className="xsmall muted" style={{ whiteSpace: 'normal', maxWidth: 420 }}>{r.explanation}</div></td>
              <td>{r.priority}</td><td>{r.specificity}</td>
              <td>{r.target_label}{r.target_effective ? null : <> <Badge tone="amber">Not effective</Badge></>}</td>
              <td>{r.effective_now ? <Badge tone="green">Live</Badge> : <Badge tone="gray">{r.status === 'PUBLISHED' || r.origin === 'PROPOSED' ? 'Not yet / no longer' : humanize(r.status)}</Badge>}</td>
              <td><strong>{r.cases_won}</strong></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      <div><div className="section-label">Overlapping and conflicting rules</div><ConflictList conflicts={s.conflicts} /></div>
      <div>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div className="section-label" style={{ margin: 0 }}>Cases</div>
          <div className="pill-tabs" role="group" aria-label="Filter simulated cases">
            {([['changed', `Changed (${s.summary.changed})`], ['attention', `Needs attention (${s.cases.filter(attention).length})`], ['existing', `Differs from pinned (${s.summary.differs_from_existing})`], ['all', `All (${s.cases.length})`]] as const).map(([k, l]) => (
              <button key={k} type="button" className={filter === k ? 'active' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)} data-testid={`sim-filter-${k}`}>{l}</button>
            ))}
          </div>
        </div>
        {shown.length ? (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Simulated cases" style={{ marginTop: 10 }}><table className="data-table" data-testid="sim-cases">
            <thead><tr><th>Case</th><th>Inputs</th><th>Pinned script (unchanged)</th><th>Live rules</th><th>Proposed</th><th /></tr></thead>
            <tbody>{shown.map((c) => <CaseRow key={c.case_id} c={c} o={o} />)}</tbody>
          </table></div>
        ) : <p className="small muted">No cases in this view.</p>}
        {rows.length > shown.length ? <p className="xsmall muted">Showing the first {shown.length} of {rows.length}.</p> : null}
      </div>
    </>
  );
}

function Tile({ label, value, sub, testId }: { label: string; value: number; sub?: string; testId?: string }) {
  return <div className="info-tile" data-testid={testId}><label>{label}</label><strong style={{ fontSize: 20 }}>{value}</strong>{sub ? <div className="xsmall muted" style={{ marginTop: 4 }}>{sub}</div> : null}</div>;
}

function CaseRow({ c, o }: { c: SimCase; o: RuleOptions | undefined }) {
  const [open, setOpen] = useState(false);
  const i = c.inputs as Record<string, unknown>;
  return (
    <Fragment>
      <tr data-testid={`sim-case-${c.case_ref}`}>
        <td><Link className="link" to={`/cases/${c.case_id}`}>{c.case_ref}</Link><div className="xsmall muted">{humanize(c.state)}{c.has_blocking_hold ? ' · on hold' : ''}</div></td>
        <td className="xsmall">{String(i.product_family ?? '—')} · {i.is_ilp ? 'ILP' : 'not ILP'} · <RiskBadge band={String(i.risk_band ?? 'UNASSESSED')} /> · {String(i.selling_channel ?? '—')}</td>
        <td className="small">{c.existing ? <>{c.existing.script_label}<div className="xsmall muted">{c.existing.rule ?? humanize(c.existing.origin)}</div></> : <span className="muted">None</span>}</td>
        <td><OutcomeBadge outcome={c.baseline.outcome} /><div className="xsmall muted">{c.baseline.selected_script_label ?? '—'}</div></td>
        <td><OutcomeBadge outcome={c.proposed.outcome} /><div className="xsmall">{c.proposed.selected_script_label ?? c.proposed.determinable_script_label ?? '—'}</div>
          {c.changed ? <Badge tone="purple" noDot>Changed</Badge> : null}</td>
        <td><Button tiny onClick={() => setOpen(!open)} aria-expanded={open} data-testid={`sim-why-${c.case_ref}`}>{open ? 'Hide' : 'Why?'}</Button></td>
      </tr>
      {open ? (
        <tr><td colSpan={6} style={{ whiteSpace: 'normal', background: '#fafbfc' }}>
          <p className="small" style={{ marginTop: 0 }}><strong>{outcomeLabel(c.proposed.outcome)}:</strong> {c.proposed.reason}</p>
          <ul className="plain-list stack" style={{ gap: 8 }} data-testid="sim-trace">
            {(c.proposed.trace ?? []).map((t) => (
              <li key={t.ref} className="softbox" style={{ padding: 10 }}>
                <div className="row wrap" style={{ gap: 6 }}><span className="mono strong small">{t.ref}</span>
                  <span className="xsmall muted">priority {t.priority} · specificity {t.specificity} → {t.target_label}</span>
                  {t.selected ? <Badge tone="green">Selected</Badge> : t.tied ? <Badge tone="red">Tied</Badge> : null}
                  {!t.eligible ? <Badge tone="gray">Excluded: {t.excluded_reason}</Badge> : <Badge tone={t.match === 'MATCH' ? 'blue' : t.match === 'UNKNOWN' ? 'amber' : 'gray'}>{humanize(t.match)}</Badge>}</div>
                {t.conditions.length ? (
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    {t.conditions.map((x) => (
                      <span key={x.field} className="tag" title={`expected ${x.expected.join(' or ')}`}>
                        {x.result === 'PASS' ? '✓' : x.result === 'FAIL' ? '✗' : '?'} {fieldLabel(o, x.field)}: {Array.isArray(x.actual) ? (x.actual.length ? x.actual.map((v) => valueLabel(o, x.field, v)).join(', ') : 'none') : x.actual == null ? 'missing' : valueLabel(o, x.field, x.actual)}
                        <span className="muted"> ({x.result === 'PASS' ? 'passed' : x.result === 'FAIL' ? 'failed' : 'unknown'})</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </td></tr>
      ) : null}
    </Fragment>
  );
}
