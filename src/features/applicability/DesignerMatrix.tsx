// Survey Applicability (APPL-X1) — the Decision Matrix: example applications down the side, surveys across the top.
// Every cell is the Python evaluator's result for that application under this policy. Rows can be filtered, grouped
// and sorted; a cell leads back to the requirement responsible; the whole table exports as synthetic test evidence.
import { useMemo, useState } from 'react';
import { valueLabel } from './model/describe';
import type { EvalRow, Policy, Scenario, SurveyRef } from './model/types';
import { useAppl } from './store';
import { Empty, Icon, Tag } from './ui';
import { surveysOf } from './usage';

type Cell = { mark: 'selected' | 'pending' | 'replaced' | 'none'; text: string; why: string; req?: string };
function cellOf(row: EvalRow | undefined, s: SurveyRef): Cell {
  const plan = row?.plan;
  if (!plan || plan.status === 'ERROR') return { mark: 'none', text: '', why: plan?.error?.message ?? '' };
  const sel = plan.selected.find((e) => e.survey.code === s.code);
  if (sel) return { mark: 'selected', text: String(sel.position), why: `Required by ${sel.required_by.map((id) => plan.requirements.find((r) => r.id === id)?.name).join(', ')}`, req: sel.required_by[0] };
  const pen = plan.pending.find((e) => e.survey.code === s.code);
  if (pen) return { mark: 'pending', text: '?', why: `Not decided: depends on ${pen.required_by.map((id) => plan.requirements.find((r) => r.id === id)?.name).join(', ')}`, req: pen.required_by[0] };
  const ex = plan.excluded.find((e) => e.survey.code === s.code);
  const rep = ex?.why.find((w) => w.reason === 'REPLACED');
  if (rep) return { mark: 'replaced', text: '↺', why: rep.text, req: rep.requirement };
  return { mark: 'none', text: '–', why: ex?.why.map((w) => w.text).join('; ') || 'Not required', req: ex?.why[0]?.requirement };
}
const download = (name: string, type: string, text: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); window.setTimeout(() => URL.revokeObjectURL(a.href), 500); };

export function DesignerMatrix({ policy, scenarios, rows, variables, onOpen, onScenario, activeScenario, fingerprint }: {
  policy: Policy; scenarios: Scenario[]; rows: EvalRow[] | undefined; variables: string[];
  onOpen: (requirement: string) => void; onScenario: (id: string) => void; activeScenario?: string | null; fingerprint?: string | null;
}) {
  const { look, data } = useAppl();
  const [q, setQ] = useState('');
  const [suite, setSuite] = useState('ALL');
  const [group, setGroup] = useState<'none' | 'result' | 'suite' | 'condition'>('none');
  const [sort, setSort] = useState<'name' | 'status' | 'count'>('name');
  const [only, setOnly] = useState<'all' | 'unknown'>('all');
  const surveys = useMemo(() => { const m = new Map<string, SurveyRef>(); policy.requirements.forEach((r) => surveysOf(r).forEach((s) => m.set(s.code, s))); return policy.order.filter((c) => m.has(c)).map((c) => m.get(c)!).concat([...m.values()].filter((s) => !policy.order.includes(s.code))); }, [policy]);
  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.scenario, r])), [rows]);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    const list = scenarios.filter((s) => (suite === 'ALL' || s.suite === suite) && (!k || `${s.name} ${s.description}`.toLowerCase().includes(k)) && (only === 'all' || byId.get(s.id)?.plan.status !== 'RESOLVED'));
    const n = (s: Scenario) => byId.get(s.id)?.plan.selected?.length ?? 0;
    return [...list].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'status' ? (byId.get(a.id)?.plan.status ?? '').localeCompare(byId.get(b.id)?.plan.status ?? '') || a.name.localeCompare(b.name) : n(b) - n(a)));
  }, [scenarios, q, suite, only, sort, byId]);
  const keyOf = (s: Scenario) => {
    const plan = byId.get(s.id)?.plan;
    if (group === 'suite') return s.suite ?? 'No suite';
    if (group === 'result') return plan?.selected?.length ? plan.selected.map((e) => e.survey.name.split(' · ')[0]).join(' + ') + (plan.status === 'RESOLVED' ? '' : ' (not decided)') : plan?.status === 'RESOLVED' ? 'No survey required' : 'Not decided';
    if (group === 'condition') return plan?.requirements?.filter((r) => r.state === 'APPLIES').map((r) => r.name).join(' + ') || 'No requirement applies';
    return '';
  };
  const groups = useMemo(() => { const m = new Map<string, Scenario[]>(); shown.forEach((s) => m.set(keyOf(s), [...(m.get(keyOf(s)) ?? []), s])); return [...m.entries()]; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, group, byId]);
  const exportCsv = () => {
    const head = ['Scenario', ...variables.map((c) => look.variable(c)?.name ?? c), 'Result', ...surveys.map((s) => s.name), 'Explanation'];
    const esc = (x: unknown) => `"${String(x ?? '').replaceAll('"', '""')}"`;
    const lines = shown.map((s) => { const plan = byId.get(s.id)?.plan; return [s.name, ...variables.map((c) => plan?.facts?.[c]?.label ?? ''), plan?.status ?? '', ...surveys.map((v) => { const c = cellOf(byId.get(s.id), v); return c.mark === 'selected' ? `required (${c.text})` : c.mark === 'pending' ? 'not decided' : c.mark === 'replaced' ? 'replaced' : 'not required'; }), plan?.explanation?.join(' ') ?? ''].map(esc).join(','); });
    download(`${policy.code}-v${policy.version}-decision-matrix.csv`, 'text/csv', [head.map(esc).join(','), ...lines].join('\n'));
  };
  const exportJson = () => download(`${policy.code}-v${policy.version}-test-evidence.json`, 'application/json', JSON.stringify({ kind: 'SYNTHETIC TEST EVIDENCE — not an assignment', policy: { code: policy.code, version: policy.version, status: policy.status, fingerprint }, exported_at: new Date().toISOString(), scenarios: shown.map((s) => ({ name: s.name, facts: s.facts, result: byId.get(s.id)?.plan })) }, null, 1));
  if (!scenarios.length) return <Empty icon="scenario" title="No scenario to show">Create example applications in the Scenario lab, or generate combinations there.</Empty>;
  return (
    <div className="ap-matrix" data-testid="ap-matrix">
      <div className="ap-toolbar">
        <label className="ap-searchbox"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scenarios" aria-label="Search scenarios" data-testid="ap-matrix-search" /></label>
        <select className="ap-input" aria-label="Suite" value={suite} onChange={(e) => setSuite(e.target.value)} data-testid="ap-matrix-suite"><option value="ALL">Every suite</option>{data.suites.map((s) => <option key={s}>{s}</option>)}</select>
        <select className="ap-input" aria-label="Group rows by" value={group} onChange={(e) => setGroup(e.target.value as typeof group)} data-testid="ap-matrix-group"><option value="none">No grouping</option><option value="result">Group by result</option><option value="condition">Group by what applies</option><option value="suite">Group by suite</option></select>
        <select className="ap-input" aria-label="Sort rows by" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} data-testid="ap-matrix-sort"><option value="name">Sort by name</option><option value="status">Sort by result</option><option value="count">Most surveys first</option></select>
        <button type="button" role="switch" aria-checked={only === 'unknown'} className={`ap-switch${only === 'unknown' ? ' on' : ''}`} onClick={() => setOnly(only === 'all' ? 'unknown' : 'all')} data-testid="ap-matrix-unknown"><Icon name="question" size={13} /> Only undecided</button>
        <span className="ap-spacer" />
        <button type="button" className="ap-btn quiet" onClick={exportCsv} data-testid="ap-matrix-export-csv"><Icon name="download" size={13} /> Table (CSV)</button>
        <button type="button" className="ap-btn quiet" onClick={exportJson} data-testid="ap-matrix-export-json"><Icon name="download" size={13} /> Test evidence (JSON)</button>
      </div>
      <div className="ap-tablewrap">
        <table className="ap-table ap-matrix-table" data-testid="ap-matrix-table">
          <thead>
            <tr><th rowSpan={2} className="sticky">Example application</th><th colSpan={Math.max(variables.length, 1)} className="band facts">Its facts</th><th rowSpan={2}>Result</th><th colSpan={Math.max(surveys.length, 1)} className="band surveys">Surveys, in delivery order</th></tr>
            <tr>{variables.map((c) => <th key={c} className="fact">{look.variable(c)?.name ?? c}</th>)}{!variables.length ? <th /> : null}{surveys.map((s, i) => <th key={s.code} className="survey" title={s.name}><span className="ap-matrix-n">{i + 1}</span>{s.name.split(' · ')[0]}<small>{s.name.split(' · ')[1]}</small></th>)}</tr>
          </thead>
          {groups.map(([label, list]) => (
            <tbody key={label || 'all'}>
              {label ? <tr className="ap-matrix-group"><th colSpan={variables.length + surveys.length + 2}>{label} <span className="ap-count">{list.length}</span></th></tr> : null}
              {list.map((s) => { const row = byId.get(s.id); const plan = row?.plan; return (
                <tr key={s.id} className={`${activeScenario === s.id ? 'on' : ''}${plan && plan.status !== 'RESOLVED' ? ' undecided' : ''}`} data-testid={`ap-matrix-row-${s.id}`} data-status={plan?.status}>
                  <th scope="row" className="sticky"><button type="button" className="ap-rowbtn" onClick={() => onScenario(s.id)}>{s.name}</button>{s.golden ? <Tag tone="info">regression</Tag> : null}{s.generated ? <Tag>generated</Tag> : null}</th>
                  {variables.map((c) => { const f = plan?.facts?.[c]; return <td key={c} className={`fact${f && f.state !== 'KNOWN' ? ' unknown' : ''}`} title={f?.reason}>{f ? (f.state === 'KNOWN' ? f.label : f.state === 'INVALID' ? `invalid: ${valueLabel(look.variable(c), f.given)}` : 'not known') : '…'}</td>; })}
                  {!variables.length ? <td /> : null}
                  <td>{plan ? <Tag tone={plan.status === 'RESOLVED' ? 'published' : plan.status === 'ERROR' ? 'bad' : 'unknown'}>{plan.status === 'RESOLVED' ? 'Decided' : plan.status === 'ERROR' ? 'Error' : 'Not decided'}</Tag> : '…'}</td>
                  {surveys.map((v) => { const c = cellOf(row, v); return <td key={v.code} className={`cell is-${c.mark}`} data-testid={`ap-matrix-cell-${s.id}-${v.code}`} data-mark={c.mark}><button type="button" title={c.why} aria-label={`${v.name}: ${c.why}`} disabled={!c.req} onClick={() => c.req && onOpen(c.req)}>{c.mark === 'selected' ? <><Icon name="check" size={12} /><b>{c.text}</b></> : c.mark === 'pending' ? <Icon name="question" size={13} /> : c.mark === 'replaced' ? <Icon name="replace" size={13} /> : <span aria-hidden="true">–</span>}</button></td>; })}
                </tr>
              ); })}
            </tbody>
          ))}
        </table>
      </div>
      <ul className="ap-legend" aria-label="Legend"><li><span className="ap-cellkey is-selected"><Icon name="check" size={11} />1</span> Required, with its place in the order</li><li><span className="ap-cellkey is-pending"><Icon name="question" size={11} /></span> Not decided: a fact is not known</li><li><span className="ap-cellkey is-replaced"><Icon name="replace" size={11} /></span> Would apply, but is replaced</li><li><span className="ap-cellkey is-none">–</span> Not required</li></ul>
      <p className="ap-quiet">Select a cell to open the requirement responsible. {shown.length} of {scenarios.length} scenarios shown.</p>
    </div>
  );
}
