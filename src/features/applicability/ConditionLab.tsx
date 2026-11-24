// Survey Applicability (APPL-X1) — the Condition Lab: named, reusable conditions built visually and tested live.
// The result of every test, the branch responsible and the quality checks all come from the Python evaluator.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConditionTest } from './api';
import { ConditionBuilder, type Level } from './editors';
import { FactsEditor } from './facts';
import { same, sentence, slug } from './model/describe';
import type { Condition, Expr, Facts, Trace } from './model/types';
import { LibraryBar, LibraryDot, useLibrary } from './library';
import { useAppl } from './store';
import { Empty, Icon, Segmented, Tag, TriMark, useParamState } from './ui';
import { conditionUses, reach } from './usage';

const levelOf = (e: Expr | null): Level => {
  if (!e || e.op === 'test') return 'simple';
  const has = (x: Expr): boolean => x.op === 'ref' || (x.op === 'not' ? has(x.arg) : x.op === 'all' || x.op === 'any' ? x.args.some(has) : false);
  return has(e) ? 'advanced' : 'grouped';
};
/** Which lines are the reason for the result, in words. */
function reasons(t: Trace | undefined): { text: string; result: string }[] {
  if (!t) return [];
  const out: { text: string; result: string }[] = [];
  const walk = (n: Trace) => {
    if (n.op === 'test') { out.push({ text: n.result === 'UNKNOWN' ? `${n.fact?.name ?? n.text}: ${n.fact?.reason ?? 'not known'}` : `${n.text} — ${n.result === 'TRUE' ? 'yes' : 'no'} (${n.fact?.name} = ${n.fact?.label})`, result: n.result }); return; }
    (n.children ?? []).filter((c) => c.decisive !== false).forEach(walk);
  };
  walk(t);
  return out;
}

export function ConditionLabPage() {
  const { data } = useAppl();
  const [chosen, pick] = useParamState('c');
  const sel = data.conditions.find((c) => c.code === chosen) ?? (chosen === 'new' ? undefined : data.conditions[0]);
  // one editor per condition: choosing another starts from what is saved at once, never a moment later
  return <Lab key={sel?.code ?? 'new'} chosen={chosen} pick={pick} />;
}

function Lab({ chosen, pick }: { chosen: string | null; pick: (c: string | null) => void }) {
  const { data, update, say, look } = useAppl();
  const lib = useLibrary();
  const [q, setQ] = useState('');
  const sel = data.conditions.find((c) => c.code === chosen) ?? (chosen === 'new' ? undefined : data.conditions[0]);
  const fresh = chosen === 'new';
  const [work, setWork] = useState<{ name: string; description: string; expr: Expr | null }>(() => (sel ? { name: sel.name, description: sel.description, expr: sel.expr } : { name: '', description: '', expr: null }));
  const [level, setLevel] = useState<Level>(() => levelOf(sel?.expr ?? null));
  // a deeply nested condition needs room: the builder alone, full width, with the live test beneath it
  const [focus, setFocus] = useState(false);
  const [facts, setFacts] = useState<Facts>({});
  const test = useConditionTest(data, work.expr, facts);
  const reads = useMemo(() => [...reach(data, work.expr).variables].filter((c) => !look.variable(c)?.derived || true), [data, work.expr, look]);
  // give every variable the condition reads a first sample value, once, so the test starts with a real answer
  useEffect(() => {
    const add: Facts = {};
    reads.forEach((c) => { const v = look.variable(c); if (v && !v.derived && !(c in facts)) add[c] = v.samples?.[0] ?? null; });
    if (Object.keys(add).length) setFacts((f) => ({ ...add, ...f }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reads.join('|')]);
  const dirty = !sel ? !!work.expr || !!work.name : sel.name !== work.name || sel.description !== work.description || !same(sel.expr, work.expr);
  const diagnostics = test.data?.diagnostics ?? [];
  const blockers = diagnostics.filter((d) => d.severity === 'BLOCKER');
  const code = sel?.code ?? slug(work.name);
  const clash = !sel && data.conditions.some((c) => c.code === code);
  const canSave = dirty && work.name.trim().length >= 2 && !!work.expr && !blockers.length && !clash;
  const uses = useMemo(() => (sel ? conditionUses(data, sel.code) : []), [data, sel]);
  const shown = data.conditions.filter((c) => !q.trim() || `${c.name} ${c.description} ${sentence(c.expr, look)}`.toLowerCase().includes(q.trim().toLowerCase()));
  const save = () => {
    if (!work.expr) return;
    const published = sel?.status === 'PUBLISHED';
    const exprChanged = !sel || !same(sel.expr, work.expr);
    const made: Condition = { code, name: work.name.trim(), description: work.description, expr: work.expr, status: 'DRAFT',
      version: sel ? sel.version + (published && exprChanged ? 1 : 0) : 1, history: sel && published && exprChanged ? [...(sel.history ?? []), { version: sel.version, expr: sel.expr }] : sel?.history };
    if (sel && published && !exprChanged && !lib.on) made.status = 'PUBLISHED';
    update(sel ? `Change condition ${made.name}` : `Create condition ${made.name}`, (d) => { const i = d.conditions.findIndex((c) => c.code === code); if (i >= 0) d.conditions[i] = made; else d.conditions.push(made); });
    if (!lib.on) say(sel && published && exprChanged ? `Saved as version ${made.version}. Policies that name version ${sel.version} are unchanged.` : `${made.name} saved`);
    // with the saved library on, "Save" keeps it in Call360 as a draft at once — never as a published version
    if (lib.on) void lib.save('CONDITION', code, { item: made });
    if (!sel) pick(code);
  };
  const publish = () => { if (!sel) return; update(`Publish condition ${sel.name}`, (d) => { const c = d.conditions.find((x) => x.code === sel.code); if (c) c.status = 'PUBLISHED'; }); say(`${sel.name} version ${sel.version} published`); };
  const result = test.data?.status === 'OK' ? test.data.result : undefined;
  const why = reasons(test.data?.trace);
  return (
    <div className={`ap-page ap-lab${focus ? ' focus' : ''}`} data-testid="ap-conditions" data-focus={focus}>
      <aside className="ap-list" aria-label="Saved conditions">
        <header><h2>Saved conditions</h2><button type="button" className="ap-btn quiet" onClick={() => pick('new')} data-testid="ap-condition-new"><Icon name="plus" size={13} /> New</button></header>
        <label className="ap-searchbox"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conditions" aria-label="Search conditions" data-testid="ap-condition-search" /></label>
        <ul>{shown.map((c) => <li key={c.code}><button type="button" className={c.code === sel?.code ? 'on' : ''} onClick={() => pick(c.code)} data-testid={`ap-condition-${c.code}`}><span className="ap-list-icon cond"><Icon name="condition" size={15} /></span><span><strong>{c.name}</strong><small>{sentence(c.expr, look)}</small></span>{lib.on ? <><LibraryDot kind="CONDITION" code={c.code} /><Tag>v{c.version}</Tag></> : c.status === 'DRAFT' ? <Tag tone="draft">v{c.version} draft</Tag> : <Tag>v{c.version}</Tag>}</button></li>)}
          {!shown.length ? <li className="ap-pop-none">No condition matches.</li> : null}</ul>
      </aside>

      <section className="ap-lab-main">
        <header className="ap-pagehead">
          <div className="ap-editable">
            <input className="ap-title-input" aria-label="Condition name" placeholder={fresh ? 'Name this condition, for example “ILP with NFTF”' : 'Condition name'} value={work.name} onChange={(e) => { const name = e.target.value; setWork((w) => ({ ...w, name })); }} data-testid="ap-condition-name" />
            <input className="ap-sub-input" aria-label="What this condition is for" placeholder="What is it for? (optional)" value={work.description} onChange={(e) => { const description = e.target.value; setWork((w) => ({ ...w, description })); }} />
          </div>
          <div className="ap-savebar" data-testid="ap-condition-state" data-state={dirty ? 'unsaved' : sel?.status === 'PUBLISHED' ? 'published' : 'saved'}>
            {dirty ? <Tag tone="warn">Unsaved changes</Tag> : sel && !lib.on ? <Tag tone={sel.status === 'PUBLISHED' ? 'published' : 'draft'}>{sel.status === 'PUBLISHED' ? `Version ${sel.version} published` : `Version ${sel.version} draft, saved`}</Tag> : null}
            {dirty && sel ? <button type="button" className="ap-btn quiet" onClick={() => setWork({ name: sel.name, description: sel.description, expr: sel.expr })}>Discard</button> : null}
            <button type="button" className="ap-btn primary" disabled={!canSave} onClick={save} data-testid="ap-condition-save"><Icon name="check" size={13} /> {sel?.status === 'PUBLISHED' && !same(sel.expr, work.expr) ? `Save as version ${sel.version + 1}` : 'Save'}</button>
            {!lib.on && sel && !dirty && sel.status === 'DRAFT' ? <button type="button" className="ap-btn" onClick={publish} data-testid="ap-condition-publish">Publish version {sel.version}</button> : null}
          </div>
        </header>
        {sel && !dirty ? <LibraryBar key={sel.code} kind="CONDITION" code={sel.code} /> : null}
        {clash ? <p className="ap-field-error"><Icon name="warn" size={12} /> A condition with this name already exists.</p> : null}

        <div className="ap-levelbar">
          <button type="button" className={`ap-btn quiet${focus ? ' on' : ''}`} aria-pressed={focus} onClick={() => setFocus(!focus)} data-testid="ap-lab-focus" title="Give the builder the whole width; the list of conditions is hidden and the live test moves beneath it"><Icon name="canvas" size={13} /> {focus ? 'Show the list and the test beside it' : 'Focus on the builder'}</button>
          <Segmented label="How much of the builder to show" value={level} onChange={setLevel} testid="ap-condition-level" options={[{ value: 'simple', label: 'Simple', testid: 'ap-level-simple' }, { value: 'grouped', label: 'Grouped', testid: 'ap-level-grouped' }, { value: 'advanced', label: 'Advanced', testid: 'ap-level-advanced' }]} />
          <span className="ap-quiet">{level === 'simple' ? 'One fact, one comparison, one value.' : level === 'grouped' ? 'Combine lines with “all of” and “any of”, negate them, nest groups.' : 'Everything, including saved conditions inside this one.'}</span>
        </div>
        <ConditionBuilder expr={work.expr} onChange={(e) => { setWork((w) => ({ ...w, expr: e })); if (levelOf(e) === 'advanced' && level !== 'advanced') setLevel('advanced'); else if (levelOf(e) === 'grouped' && level === 'simple') setLevel('grouped'); }} trace={test.data?.trace} diagnostics={diagnostics} self={sel?.code} level={level} testid="ap-lab-builder" emptyHint="Start with one fact about the application: pick a variable, a comparison and a value." />

        {diagnostics.filter((d) => !d.at?.path).length ? (
          <section className="ap-quality" data-testid="ap-condition-quality"><h3><Icon name="sparkle" size={14} /> Quality checks</h3>
            <ul className="ap-issues block">{diagnostics.filter((d) => !d.at?.path).map((d, i) => <li key={i} className={d.severity.toLowerCase()} data-testid={`ap-quality-${d.code}`}><Icon name={d.severity === 'INFO' ? 'info' : 'warn'} size={12} /> {d.message}</li>)}</ul></section>
        ) : work.expr && !blockers.length ? <p className="ap-quality-ok" data-testid="ap-condition-quality-ok"><Icon name="check" size={13} /> No contradiction, duplicate or circular reference was found.</p> : null}

        {sel ? (
          <div className="ap-lab-meta">
            <section data-testid="ap-condition-uses"><h3><Icon name="eye" size={14} /> Where it is used <span className="ap-count">{uses.length}</span></h3>
              {uses.length ? <ul className="ap-uses">{uses.map((u) => <li key={`${u.kind}-${u.code}`}><Link to={u.to}><Icon name={u.kind === 'policy' ? 'policy' : 'condition'} size={14} /><span><strong>{u.label}</strong><small>{u.detail}</small></span><Icon name="right" size={13} /></Link></li>)}</ul> : <p className="ap-quiet">Nothing uses it yet.</p>}</section>
            <section data-testid="ap-condition-versions"><h3><Icon name="history" size={14} /> Versions</h3>
              <ol className="ap-versions">{[{ version: sel.version, expr: sel.expr, now: true }, ...[...(sel.history ?? [])].reverse().map((h) => ({ ...h, now: false }))].map((h) => <li key={h.version} className={h.now ? 'now' : ''}><Tag tone={h.now ? (sel.status === 'PUBLISHED' ? 'published' : 'draft') : 'plain'}>Version {h.version}</Tag><span>{sentence(h.expr, look)}</span></li>)}</ol>
              <p className="ap-quiet">A policy names one exact version. A newer version changes nothing until a policy adopts it.</p></section>
          </div>
        ) : null}
      </section>

      <aside className="ap-testpanel" aria-label="Live test" data-testid="ap-condition-test">
        <h2><Icon name="play" size={15} /> Live test</h2>
        {!work.expr ? <Empty icon="scenario" title="Nothing to test yet">Build a condition and its result appears here as you type.</Empty> : (
          <>
            <div className={`ap-verdict is-${(result ?? 'none').toLowerCase()}`} data-testid="ap-test-result" data-result={result ?? test.data?.status}>
              {test.data?.status === 'OK' ? <><TriMark value={result} /><p>{result === 'TRUE' ? 'This application matches the condition.' : result === 'FALSE' ? 'This application does not match.' : 'It cannot be decided for this application.'}</p></>
                : test.data ? <><Tag tone="bad">Cannot be tested</Tag><p>{test.data.error?.message ?? 'Fix the problems marked in the builder first.'}</p></> : <p className="ap-quiet">Testing…</p>}
            </div>
            {why.length ? <ul className="ap-why" data-testid="ap-test-why">{why.map((w, i) => <li key={i} className={`is-${w.result.toLowerCase()}`}><Icon name={w.result === 'TRUE' ? 'check' : w.result === 'FALSE' ? 'minus' : 'question'} size={13} /> {w.text}</li>)}</ul> : null}
            <h3>Example application</h3>
            <p className="ap-quiet">Synthetic values for the facts this condition reads. Change one and the result updates.</p>
            <FactsEditor codes={reads} facts={facts} onChange={setFacts} states={Object.fromEntries((test.data?.facts ?? []).map((f) => [f.variable, f]))} highlight={test.data?.needs?.map((n) => n.variable)} testid="ap-test-facts" />
          </>
        )}
      </aside>
    </div>
  );
}
