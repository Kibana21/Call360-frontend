// Survey Applicability (APPL-X1) — the Variable Library: every fact about an application, defined once.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SOURCE_TONE, SOURCE_WORD } from './editors';
import { TYPE_LABEL, sentence, valueLabel } from './model/describe';
import type { Variable, VarType } from './model/types';
import { useAppl } from './store';
import { Empty, Icon, Segmented, Tag, useParamState } from './ui';
import { variableUses } from './usage';

const diff = (a: Variable, b: Variable) => {
  const rows: [string, string, string][] = [];
  const add = (label: string, x: unknown, y: unknown) => { const sx = String(x ?? '—'), sy = String(y ?? '—'); if (sx !== sy) rows.push([label, sx, sy]); };
  add('Name', a.name, b.name); add('Meaning', a.description, b.description); add('Kind of value', TYPE_LABEL[a.type], TYPE_LABEL[b.type]);
  add('Allowed values', a.values?.map((o) => o.label).join(', '), b.values?.map((o) => o.label).join(', '));
  add('Currency', a.currency, b.currency); add('Lowest', a.min, b.min); add('Highest', a.max, b.max);
  add('Source', SOURCE_WORD[a.source.status], SOURCE_WORD[b.source.status]); add('Owner', a.owner, b.owner);
  return rows;
};

export function VariablesPage() {
  const { data, openDrawer, look, update, say } = useAppl();
  const [chosen, pick] = useParamState('v');
  const [q, setQ] = useState('');
  const [type, setType] = useState<VarType | 'ALL'>('ALL');
  const [source, setSource] = useState<'ALL' | Variable['source']['status']>('ALL');
  const [market, setMarket] = useState('ALL');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const sel = data.variables.find((v) => v.code === chosen);
  const shown = useMemo(() => { const k = q.trim().toLowerCase(); return data.variables.filter((v) => (type === 'ALL' || v.type === type) && (source === 'ALL' || v.source.status === source) && (market === 'ALL' || v.markets.includes(market)) && (!k || `${v.name} ${v.description} ${v.category} ${v.code}`.toLowerCase().includes(k))); }, [data.variables, q, type, source, market]);
  const groups = useMemo(() => { const m = new Map<string, Variable[]>(); shown.forEach((v) => m.set(v.category, [...(m.get(v.category) ?? []), v])); return [...m.entries()]; }, [shown]);
  const uses = useMemo(() => (sel ? variableUses(data, sel.code) : []), [data, sel]);
  const types = [...new Set(data.variables.map((v) => v.type))];
  const usedCount = (v: Variable) => variableUses(data, v.code).filter((u) => u.kind !== 'scenario').length;
  return (
    <div className={`ap-page ap-split${sel ? ' has-side' : ''}`} data-testid="ap-variables">
      <div className="ap-split-main">
        <header className="ap-pagehead">
          <div><h1>Variable library</h1><p>Every fact about an application that a condition can read. Define each one once; reuse it in profiles, conditions, policies and scenarios.</p></div>
          <button type="button" className="ap-btn primary" onClick={() => openDrawer({ kind: 'variable' })} data-testid="ap-variable-new"><Icon name="plus" size={14} /> Create variable</button>
        </header>
        <div className="ap-toolbar">
          <label className="ap-searchbox"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or meaning" aria-label="Search variables" data-testid="ap-variable-search" /></label>
          <select className="ap-input" aria-label="Kind of value" value={type} onChange={(e) => setType(e.target.value as VarType | 'ALL')} data-testid="ap-variable-type"><option value="ALL">Every kind</option>{types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
          <select className="ap-input" aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as typeof source)} data-testid="ap-variable-source"><option value="ALL">Any source status</option>{(Object.keys(SOURCE_WORD) as (keyof typeof SOURCE_WORD)[]).map((s) => <option key={s} value={s}>{SOURCE_WORD[s]}</option>)}</select>
          <select className="ap-input" aria-label="Market" value={market} onChange={(e) => setMarket(e.target.value)}><option value="ALL">Every market</option><option value="SG">Singapore</option><option value="MY">Malaysia</option></select>
          <span className="ap-spacer" /><span className="ap-count" data-testid="ap-variable-count">{shown.length} of {data.variables.length}</span>
          <Segmented label="View" value={view} onChange={setView} options={[{ value: 'cards', label: 'Cards', icon: 'cards', testid: 'ap-variable-view-cards' }, { value: 'table', label: 'Table', icon: 'table', testid: 'ap-variable-view-table' }]} />
        </div>
        {!shown.length ? <Empty icon="variable" title="No variable matches" action={<button type="button" className="ap-btn" onClick={() => openDrawer({ kind: 'variable', name: q })}><Icon name="plus" size={13} /> Create “{q || 'a variable'}”</button>}>Try another word, or clear the filters.</Empty> : null}
        {view === 'cards' ? groups.map(([cat, list]) => (
          <section key={cat} className="ap-vargroup">
            <h2>{cat} <span>{list.length}</span></h2>
            <div className="ap-vargrid">
              {list.map((v) => (
                <button key={v.code} type="button" className={`ap-varcard${sel?.code === v.code ? ' on' : ''}`} onClick={() => pick(v.code)} data-testid={`ap-variable-${v.code}`} aria-pressed={sel?.code === v.code}>
                  <span className="ap-varcard-top"><strong>{v.name}</strong>{v.status !== 'PUBLISHED' ? <Tag tone={v.status === 'DRAFT' ? 'draft' : 'bad'}>{v.status === 'DRAFT' ? `Draft v${v.version}` : 'Deprecated'}</Tag> : null}</span>
                  <span className="ap-varcard-says">{v.description}</span>
                  <span className="ap-varcard-foot"><Tag tone="var">{TYPE_LABEL[v.type]}</Tag><Tag tone={SOURCE_TONE[v.source.status]}>{SOURCE_WORD[v.source.status]}</Tag><span className="ap-varcard-used">{usedCount(v)} use{usedCount(v) === 1 ? '' : 's'}</span></span>
                </button>
              ))}
            </div>
          </section>
        )) : shown.length ? (
          <div className="ap-tablewrap"><table className="ap-table" data-testid="ap-variable-table">
            <thead><tr><th>Variable</th><th>Kind</th><th>Values</th><th>Source</th><th>Version</th><th>Used</th></tr></thead>
            <tbody>{shown.map((v) => <tr key={v.code} className={sel?.code === v.code ? 'on' : ''}><th scope="row"><button type="button" className="ap-rowbtn" onClick={() => pick(v.code)}>{v.name}</button><small>{v.category}</small></th><td>{TYPE_LABEL[v.type]}</td><td>{v.values ? v.values.map((o) => o.label).join(', ') : v.type === 'MONEY' ? v.currency : v.derived ? 'worked out' : '—'}</td><td><Tag tone={SOURCE_TONE[v.source.status]}>{SOURCE_WORD[v.source.status]}</Tag></td><td>{v.status === 'PUBLISHED' ? `v${v.version}` : `v${v.version} draft`}</td><td>{usedCount(v)}</td></tr>)}</tbody>
          </table></div>
        ) : null}
      </div>
      {sel ? (
        <aside className="ap-side" aria-label={`${sel.name}: details`} data-testid="ap-variable-inspector">
          <header><div><span className="ap-side-kind"><Icon name="variable" size={13} /> Variable</span><h2>{sel.name}</h2></div><button type="button" className="ap-iconbtn" aria-label="Close details" onClick={() => pick(null)}><Icon name="x" /></button></header>
          <p className="ap-side-says">{sel.description}</p>
          <div className="ap-side-actions">
            <button type="button" className="ap-btn" onClick={() => openDrawer({ kind: 'variable', code: sel.code })} data-testid="ap-variable-edit"><Icon name="variable" size={13} /> Change</button>
            {sel.status === 'DRAFT' ? <button type="button" className="ap-btn" data-testid="ap-variable-publish" onClick={() => { update(`Publish variable ${sel.name}`, (d) => { const v = d.variables.find((x) => x.code === sel.code); if (v) { v.status = 'PUBLISHED'; v.previous = null; } }); say(`${sel.name} version ${sel.version} published. Nothing that names an earlier version changed.`); }}><Icon name="check" size={13} /> Publish version {sel.version}</button> : null}
          </div>
          <dl className="ap-facts-dl">
            <dt>Kind of value</dt><dd>{TYPE_LABEL[sel.type]}{sel.currency ? ` · ${sel.currency}` : ''}{sel.min !== undefined || sel.max !== undefined ? ` · ${sel.min ?? '…'} to ${sel.max ?? '…'}` : ''}</dd>
            {sel.values ? <><dt>Allowed values</dt><dd className="ap-chips">{sel.values.map((o) => <span key={o.value} className="ap-chip plain">{o.label}</span>)}</dd></> : null}
            {sel.derived ? <><dt>Worked out from</dt><dd>{sentence(sel.derived.expr, look)}</dd></> : null}
            <dt>Version</dt><dd>{sel.version} · {sel.status === 'PUBLISHED' ? 'published' : sel.status === 'DRAFT' ? 'draft, not yet published' : 'deprecated'}</dd>
            <dt>Markets</dt><dd>{sel.markets.join(', ')}</dd>
            <dt>Owner</dt><dd>{sel.owner || 'not stated'}</dd>
            <dt>Sample values</dt><dd>{sel.samples?.length ? sel.samples.map((x) => valueLabel(sel, x)).join(' · ') : 'none'}</dd>
          </dl>
          <section className={`ap-source is-${sel.source.status.toLowerCase()}`} data-testid="ap-variable-source-panel">
            <h3><Icon name="link" size={14} /> Where the value comes from</h3>
            <p><Tag tone={SOURCE_TONE[sel.source.status]}>{SOURCE_WORD[sel.source.status]}</Tag></p>
            {sel.source.system ? <p className="ap-lineage"><span>{sel.source.system}</span><Icon name="arrow" size={13} /><code>{sel.source.field}</code><Icon name="arrow" size={13} /><span>{sel.name}</span></p> : null}
            {sel.source.note ? <p className="ap-quiet">{sel.source.note}</p> : null}
          </section>
          {sel.previous ? (
            <section data-testid="ap-variable-diff"><h3><Icon name="replace" size={14} /> Draft version {sel.version} compared with published version {sel.previous.version}</h3>
              {diff(sel.previous, sel).length ? <table className="ap-diff"><thead><tr><th /><th>Published</th><th>Draft</th></tr></thead><tbody>{diff(sel.previous, sel).map(([l, a, b]) => <tr key={l}><th scope="row">{l}</th><td className="was">{a}</td><td className="now">{b}</td></tr>)}</tbody></table> : <p className="ap-quiet">No difference.</p>}
              <p className="ap-quiet">If this draft is published: {uses.filter((u) => u.kind === 'policy').length} requirement{uses.filter((u) => u.kind === 'policy').length === 1 ? '' : 's'} and {uses.filter((u) => u.kind === 'condition').length} saved condition{uses.filter((u) => u.kind === 'condition').length === 1 ? '' : 's'} read this variable. A published policy keeps the version it pinned until someone adopts the new one.</p></section>
          ) : null}
          <section data-testid="ap-variable-uses"><h3><Icon name="eye" size={14} /> Where it is used <span className="ap-count">{uses.length}</span></h3>
            {uses.length ? <ul className="ap-uses">{uses.map((u) => <li key={`${u.kind}-${u.code}`}><Link to={u.to} data-testid={`ap-use-${u.kind}-${u.code}`}><Icon name={u.kind === 'policy' ? 'policy' : u.kind} size={14} /><span><strong>{u.label}</strong><small>{u.detail}</small></span><Icon name="right" size={13} /></Link></li>)}</ul> : <p className="ap-quiet">Nothing uses it yet.</p>}
          </section>
        </aside>
      ) : null}
    </div>
  );
}
