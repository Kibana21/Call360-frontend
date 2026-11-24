// Survey Applicability (APPL-X1) — the Scenario and Test Lab. A scenario is one synthetic application: saved, named,
// duplicated, grouped into suites, run against the draft or the published policy. Results, explanations, generated
// combinations and the draft-versus-published comparison all come from the Python evaluator.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { generate, useEvaluation, type Coverage } from './api';
import { FactsEditor } from './facts';
import type { EvalRow, Scenario } from './model/types';
import { PlanView } from './plan';
import { useAppl } from './store';
import { Empty, Field, Icon, Picker, Segmented, Tag, useParamState } from './ui';
import { BASE, composed, shortName } from './usage';

type Tab = 'test' | 'generate' | 'impact';
const TEMPLATES: { id: string; name: string; says: string; facts: Record<string, unknown> }[] = [
  { id: 'ilp', name: 'ILP only', says: 'An investment-linked sale, nothing else.', facts: { product_family: 'ILP', nftf: false, replacement: false } },
  { id: 'nftf', name: 'NFTF only', says: 'A protection sale where NFTF applies.', facts: { product_family: 'PROTECTION', nftf: true, replacement: false } },
  { id: 'both', name: 'ILP + NFTF', says: 'Both at once.', facts: { product_family: 'ILP', nftf: true, replacement: false } },
  { id: 'neither', name: 'Neither', says: 'Protection, face to face.', facts: { product_family: 'PROTECTION', nftf: false, replacement: false } },
  { id: 'missing', name: 'ILP with missing NFTF', says: 'The application does not say.', facts: { product_family: 'ILP', nftf: null, replacement: false } },
  { id: 'replacement', name: 'Replacement', says: 'The sale replaces a policy.', facts: { product_family: 'ILP', nftf: false, replacement: true } },
  { id: 'premium', name: 'High premium', says: 'A large annual premium.', facts: { product_family: 'ILP', nftf: false, annual_premium: 80000 } },
  { id: 'riders', name: 'Several riders', says: 'More than one rider chosen.', facts: { product_family: 'PROTECTION', nftf: false, selected_riders: ['CI', 'WOP'] } },
  { id: 'empty', name: 'Missing required facts', says: 'Almost nothing is provided.', facts: {} },
  { id: 'conflict', name: 'Conflicting inputs', says: 'A value that is not allowed.', facts: { product_family: 'UNIT_TRUST', nftf: true } },
];

export function ScenariosPage() {
  const { data, update, say, look, current: rec } = useAppl();
  const [chosen, setChosen] = useParamState('s');
  const [tabParam, setTab] = useParamState('tab');
  const [fresh, setFresh] = useParamState('new');
  const tab = (tabParam as Tab) || 'test';
  const [against, setAgainst] = useState<'draft' | 'published'>(rec?.draft ? 'draft' : 'published');
  const policy = rec ? (against === 'published' ? rec.published : rec.draft) ?? rec.published ?? rec.draft : null;
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(fresh === '1');
  const sel = data.scenarios.find((s) => s.id === chosen) ?? data.scenarios[0];
  const [activeSurvey, setActiveSurvey] = useState<string | null>(null);
  // the fact editor shows only what this policy reads unless asked otherwise
  const [factScope, setFactScope] = useState<'policy' | 'all'>('policy');
  const [factFind, setFactFind] = useState('');
  const [factOnly, setFactOnly] = useState<'all' | 'changed' | 'missing' | 'unknown'>('all');
  const go = (patch: { s?: string | null; tab?: string | null; new?: string | null }) => { if ('s' in patch) setChosen(patch.s ?? null); if ('tab' in patch) setTab(patch.tab ?? null); if ('new' in patch) setFresh(patch.new ?? null); };
  const one = useEvaluation(data, policy, sel ? [sel] : [], rec?.draft && rec.published ? (against === 'draft' ? rec.published : rec.draft) : null);
  const all = useEvaluation(data, policy, data.scenarios);
  const impact = useEvaluation(data, rec?.draft, rec?.draft && rec.published ? data.scenarios : [], rec?.published);
  const row = one.data?.results[0];
  const plan = row?.plan;
  const byId = useMemo(() => new Map((all.data?.results ?? []).map((r) => [r.scenario, r])), [all.data]);
  const vars = useMemo(() => { if (!sel) return { codes: [] as string[], groups: [] as { name: string; variables: string[] }[] }; const c = composed(data, sel.profiles); const sections = new Map<string, string[]>(); c.rows.forEach((r) => sections.set(r.section, [...(sections.get(r.section) ?? []), r.variable])); const extra = Object.keys(sel.facts).filter((k) => !c.rows.some((r) => r.variable === k) && look.variable(k)); return { codes: [...c.rows.map((r) => r.variable), ...extra], groups: [...sections.entries()].map(([name, variables]) => ({ name, variables })) }; }, [data, sel, look]);
  const baseline = sel?.basedOn ? data.scenarios.find((x) => x.id === sel.basedOn) : undefined;
  const reads = Object.keys(plan?.facts ?? {});
  // a fact the policy reads is always offered, even when the scenario's profiles do not carry it
  const everyCode = [...new Set([...vars.codes, ...reads.filter((c) => look.variable(c))])];
  const factCodes = everyCode.filter((c) => {
    if (factScope === 'policy' && reads.length && !reads.includes(c)) return false;
    const v = look.variable(c); const st = plan?.facts?.[c]?.state;
    if (factFind.trim() && !`${v?.name} ${v?.description}`.toLowerCase().includes(factFind.trim().toLowerCase())) return false;
    if (factOnly === 'changed') return !!baseline && JSON.stringify(baseline.facts[c]) !== JSON.stringify(sel?.facts[c]);
    if (factOnly === 'missing') return !(c in (sel?.facts ?? {})) && !v?.derived;
    if (factOnly === 'unknown') return st === 'UNKNOWN' || st === 'NOT_PROVIDED' || st === 'INVALID' || sel?.facts[c] === null;
    return true;
  });
  const suites = useMemo(() => { const k = q.trim().toLowerCase(); const m = new Map<string, Scenario[]>(); data.scenarios.filter((s) => !k || `${s.name} ${s.description}`.toLowerCase().includes(k)).forEach((s) => m.set(s.suite ?? 'No suite', [...(m.get(s.suite ?? 'No suite') ?? []), s])); return [...m.entries()]; }, [data.scenarios, q]);
  const edit = (label: string, f: (s: Scenario) => void) => sel && update(label, (d) => { const s = d.scenarios.find((x) => x.id === sel.id); if (s) f(s); });
  const add = (s: Omit<Scenario, 'id'>) => { const id = `sc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; update(`Create scenario “${s.name}”`, (d) => { d.scenarios.push({ ...s, id }); if (s.suite && !d.suites.includes(s.suite)) d.suites.push(s.suite); }); go({ s: id, tab: 'test', new: null }); setCreating(false); return id; };
  const changed = (impact.data?.results ?? []).filter((r) => r.comparison?.changed);
  const exportReport = () => { if (!sel || !plan) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ kind: 'SYNTHETIC SCENARIO TEST REPORT — not an assignment', scenario: sel, policy: plan.policy, result: plan, exported_at: new Date().toISOString() }, null, 1)], { type: 'application/json' })); a.download = `scenario-${sel.id}-report.json`; a.click(); };

  return (
    <div className="ap-page ap-scenarios" data-testid="ap-scenarios">
      <aside className="ap-list" aria-label="Scenarios">
        <header><h2>Scenarios</h2><button type="button" className="ap-btn quiet" onClick={() => setCreating(true)} data-testid="ap-scenario-new"><Icon name="plus" size={13} /> New</button></header>
        <label className="ap-searchbox"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search scenarios" aria-label="Search scenarios" data-testid="ap-scenario-search" /></label>
        {suites.map(([suite, list]) => (
          <section key={suite}><h3>{suite} <span className="ap-count">{list.length}</span></h3>
            <ul>{list.map((s) => { const p = byId.get(s.id)?.plan; return (
              <li key={s.id}><button type="button" className={s.id === sel?.id ? 'on' : ''} onClick={() => go({ s: s.id, tab: tab === 'generate' ? 'test' : tab })} data-testid={`ap-scenario-${s.id}`} data-status={p?.status}>
                <span className={`ap-dot is-${p ? (p.status === 'RESOLVED' ? 'true' : 'unknown') : 'none'}`} aria-hidden="true" /><span><strong>{s.name}</strong><small>{p ? (p.status === 'RESOLVED' ? (p.selected.length ? p.selected.map((e) => shortName(e.survey.name)).join(', ') : 'No survey') : 'Not decided') : '…'}</small></span>{s.golden ? <Tag tone="info" title="A regression scenario: its result is expected to stay the same">regression</Tag> : null}
              </button></li>
            ); })}</ul>
          </section>
        ))}
        {!data.scenarios.length ? <Empty icon="scenario" title="No scenario yet">A scenario is one example application with its facts.</Empty> : null}
      </aside>

      <section className="ap-scn-main">
        <header className="ap-pagehead">
          <div><h1>Scenario and test lab</h1><p>Example applications with synthetic facts. Run them against the policy, see exactly why each survey is or is not required, and what a change would alter.</p><p className="ap-kept-note" data-testid="ap-scenarios-kept"><Icon name="info" size={13} /> <strong>Scenarios are kept in this browser tab only.</strong> They are synthetic, are lost when the page is reloaded, and are not saved in Call360 yet.</p></div>
          {rec?.draft && rec.published ? <Segmented label="Run against" value={against} onChange={setAgainst} testid="ap-against" options={[{ value: 'draft', label: `Draft v${rec.draft.version}`, testid: 'ap-against-draft' }, { value: 'published', label: `Published v${rec.published.version}`, icon: 'lock', testid: 'ap-against-published' }]} /> : null}
        </header>
        <div className="ap-tabs" role="tablist" aria-label="Scenario lab">
          {([['test', 'play', 'Test a scenario'], ['generate', 'sparkle', 'Generate combinations'], ['impact', 'replace', `Draft against published${changed.length ? ` · ${changed.length} change${changed.length === 1 ? '' : 's'}` : ''}`]] as const).map(([id, icon, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => go({ tab: id })} data-testid={`ap-tab-${id}`}><Icon name={icon} size={14} /> {label}</button>)}
        </div>

        {creating ? <NewScenario onCancel={() => { setCreating(false); go({ new: null }); }} onCreate={add} /> : null}

        {tab === 'test' && sel && !creating ? (
          <div className="ap-scn-split">
            <div className="ap-scn-inputs" data-testid="ap-scenario-inputs">
              <div className="ap-scn-title">
                <input className="ap-title-input" aria-label="Scenario name" value={sel.name} onChange={(e) => edit('Rename a scenario', (s) => { s.name = e.target.value; })} data-testid="ap-scenario-name" />
                <input className="ap-sub-input" aria-label="Scenario description" placeholder="What this example stands for" value={sel.description} onChange={(e) => edit('Describe a scenario', (s) => { s.description = e.target.value; })} />
              </div>
              <div className="ap-scn-tools">
                <button type="button" className="ap-btn quiet" data-testid="ap-scenario-duplicate" onClick={() => { add({ ...structuredClone(sel), name: `${sel.name} (copy)`, golden: false, basedOn: sel.id }); say('Duplicated'); }}><Icon name="copy" size={13} /> Duplicate</button>
                <button type="button" className="ap-btn quiet" data-testid="ap-scenario-variant" onClick={() => { add({ ...structuredClone(sel), name: `${sel.name} — variant`, description: `A variant of “${sel.name}”. Change the facts that differ.`, golden: false, basedOn: sel.id }); say('Variant created from this baseline'); }}><Icon name="condition" size={13} /> Create a variant</button>
                <Picker label="Move to a suite" testid="ap-scenario-suite" items={[...data.suites.map((s) => ({ id: s, label: s, icon: 'cards' as const }))]} onPick={(suite) => edit('Move a scenario to a suite', (s) => { s.suite = suite; })} button={<span className="ap-btn quiet"><Icon name="cards" size={13} /> {sel.suite ?? 'No suite'}</span>} footer={(close, text) => (text.trim() ? <button type="button" className="ap-pop-create" onClick={() => { close(); update(`Create suite “${text.trim()}”`, (d) => { if (!d.suites.includes(text.trim())) d.suites.push(text.trim()); const s = d.scenarios.find((x) => x.id === sel.id); if (s) s.suite = text.trim(); }); }}><Icon name="plus" size={13} /> New suite “{text.trim()}”</button> : <span className="ap-pop-note">Type a name to create a suite.</span>)} />
                <button type="button" role="switch" aria-checked={!!sel.golden} className={`ap-switch${sel.golden ? ' on' : ''}`} data-testid="ap-scenario-golden" onClick={() => edit(sel.golden ? 'Unmark a regression scenario' : 'Mark a regression scenario', (s) => { s.golden = !s.golden; })} title="A regression scenario’s result is expected to stay the same; a change to it is flagged in review.">Regression scenario</button>
                <button type="button" className="ap-btn quiet" onClick={exportReport} data-testid="ap-scenario-export"><Icon name="download" size={13} /> Report</button>
                <button type="button" className="ap-iconbtn" aria-label="Delete this scenario" data-testid="ap-scenario-delete" onClick={() => { update(`Delete scenario “${sel.name}”`, (d) => { d.scenarios = d.scenarios.filter((s) => s.id !== sel.id); }); go({ s: null }); say('Deleted — Undo brings it back', 'info'); }}><Icon name="trash" size={14} /></button>
              </div>
              <div className="ap-scn-profiles"><span>Profiles</span>{sel.profiles.map((c) => <span key={c} className="ap-chip profile"><Icon name="profile" size={13} /> {data.profiles.find((p) => p.code === c)?.name ?? c}<button type="button" aria-label="Remove this profile" onClick={() => edit('Change a scenario’s profiles', (s) => { s.profiles = s.profiles.filter((x) => x !== c); })}><Icon name="x" size={11} /></button></span>)}
                <Picker label="Add a profile" testid="ap-scenario-profile" items={data.profiles.filter((p) => !sel.profiles.includes(p.code)).map((p) => ({ id: p.code, label: p.name, hint: p.description, icon: 'profile' }))} onPick={(c) => edit('Change a scenario’s profiles', (s) => { s.profiles.push(c); })} button={<span className="ap-linkbtn"><Icon name="plus" size={12} /> Add a profile</span>} /></div>
              <div className="ap-factbar" data-testid="ap-factbar">
                <div className="ap-seg tight" role="radiogroup" aria-label="Which facts to show"><button type="button" role="radio" aria-checked={factScope === 'policy'} className={factScope === 'policy' ? 'on' : ''} onClick={() => setFactScope('policy')} data-testid="ap-facts-scope-policy">Facts this policy reads</button><button type="button" role="radio" aria-checked={factScope === 'all'} className={factScope === 'all' ? 'on' : ''} onClick={() => setFactScope('all')} data-testid="ap-facts-scope-all">Every fact of the profile</button></div>
                <label className="ap-searchbox"><Icon name="search" size={14} /><input value={factFind} onChange={(e) => setFactFind(e.target.value)} placeholder="Find a fact" aria-label="Find a fact" data-testid="ap-facts-search" /></label>
                <select className="ap-input" aria-label="Show" value={factOnly} onChange={(e) => setFactOnly(e.target.value as typeof factOnly)} data-testid="ap-facts-only"><option value="all">All</option><option value="unknown">Not known or invalid</option><option value="missing">Left out</option>{baseline ? <option value="changed">Changed from “{baseline.name}”</option> : null}</select>
                {baseline ? <button type="button" className="ap-btn quiet" data-testid="ap-facts-reset" onClick={() => edit(`Reset “${sel.name}” to its baseline`, (x) => { x.facts = structuredClone(baseline.facts); })}><Icon name="undo" size={13} /> Reset to “{baseline.name}”</button> : null}
                <span className="ap-count" data-testid="ap-facts-count">{factCodes.length} of {everyCode.length} facts</span>
              </div>
              {!factCodes.length ? <p className="ap-quiet">No fact matches. {factScope === 'policy' && !reads.length ? 'This policy reads no fact yet.' : ''}</p> : null}
              <FactsEditor codes={factCodes} groups={vars.groups} facts={sel.facts} states={plan?.facts} highlight={plan?.needs.map((n) => n.variable)} testid="ap-scenario-facts" onChange={(f) => edit(`Change a fact of “${sel.name}”`, (s) => { s.facts = f; })} />
            </div>
            <div className="ap-scn-result" data-testid="ap-scenario-result" aria-live="polite">
              <h2>What the policy selects</h2>
              <PlanView plan={plan} activeSurvey={activeSurvey} onSurvey={(c) => setActiveSurvey(activeSurvey === c ? null : c)} onNeed={(v) => document.querySelector<HTMLElement>(`[data-testid="ap-scenario-facts-${v}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })} testid="ap-result" />
              {activeSurvey && plan ? <SurveyPath plan={plan} code={activeSurvey} /> : plan?.selected.length ? <p className="ap-quiet">Select a survey to see the path that selected it.</p> : null}
              {row?.comparison && row.before ? <div className={`ap-callout${row.comparison.changed ? ' warn' : ''}`} data-testid="ap-scenario-compare"><Icon name="replace" /><div><strong>{row.comparison.changed ? `Different from ${against === 'draft' ? 'the published version' : 'the draft'}` : `Same result as ${against === 'draft' ? 'the published version' : 'the draft'}`}</strong>{row.comparison.changed ? <p>{against === 'draft' ? 'Published' : 'Draft'} gives: {row.before.summary}</p> : null}</div></div> : null}
              <Link className="ap-linkbtn" to={`${BASE}/policies/${rec?.code}?s=${sel.id}`}>Open this policy in the designer</Link>
            </div>
          </div>
        ) : null}

        {tab === 'generate' && policy && !creating ? <Generator onKeep={(list) => { update(`Keep ${list.length} generated scenario${list.length === 1 ? '' : 's'}`, (d) => { list.forEach((s, i) => d.scenarios.push({ ...s, id: `sc-gen-${Date.now().toString(36)}-${i}`, suite: 'Generated' })); if (!d.suites.includes('Generated')) d.suites.push('Generated'); }); say(`${list.length} scenario${list.length === 1 ? '' : 's'} kept in the suite “Generated”`); }} policyKey={`${against}`} /> : null}
        {tab === 'impact' && !creating ? <Impact rows={impact.data?.results} onOpen={(id) => go({ s: id, tab: 'test' })} /> : null}
      </section>
    </div>
  );
}

/** The condition-to-survey path that selected one survey for this application. */
function SurveyPath({ plan, code }: { plan: NonNullable<EvalRow['plan']>; code: string }) {
  const sel = plan.selected.find((e) => e.survey.code === code) ?? plan.pending.find((e) => e.survey.code === code);
  const reqs = plan.requirements.filter((r) => sel?.required_by.includes(r.id));
  if (!sel) return null;
  const leaves = (r: (typeof reqs)[number]) => { const out: { text: string; result: string }[] = []; const walk = (t: typeof r.trace) => { if (t.op === 'test') out.push({ text: `${t.fact?.name} = ${t.fact?.state === 'KNOWN' ? t.fact.label : 'not known'}`, result: t.result }); t.children?.filter((c) => c.decisive !== false).forEach(walk); }; walk(r.trace); return out; };
  return (
    <div className="ap-path" data-testid="ap-survey-path">
      <h4>How {shortName(sel.survey.name)} was selected</h4>
      {reqs.map((r) => (
        <ol key={r.id} className="ap-path-steps">
          <li className="facts">{leaves(r).map((l, i) => <span key={i} className={`ap-chip fact is-${l.result.toLowerCase()}`}>{l.text}</span>)}{!leaves(r).length ? <span className="ap-chip plain">always</span> : null}</li>
          <li className="cond"><Icon name="arrow" size={14} /><span className="ap-chip cond">{r.trace.text}</span></li>
          <li className="req"><Icon name="arrow" size={14} /><span className="ap-chip req">{r.name}</span></li>
          <li className="survey"><Icon name="arrow" size={14} /><span className="ap-chip survey">{shortName(sel.survey.name)}</span></li>
        </ol>
      ))}
    </div>
  );
}

function NewScenario({ onCancel, onCreate }: { onCancel: () => void; onCreate: (s: Omit<Scenario, 'id'>) => void }) {
  const { data, look } = useAppl();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [profiles, setProfiles] = useState<string[]>(['new_business'].filter((c) => data.profiles.some((p) => p.code === c)));
  const [template, setTemplate] = useState<string | null>(null);
  const t = TEMPLATES.find((x) => x.id === template);
  const make = () => {
    const rows = composed(data, profiles).rows.map((r) => r.variable);
    // start from the profile's own sample values, then lay the template over them
    const base = Object.fromEntries(rows.filter((c) => !look.variable(c)?.derived && look.variable(c)?.samples?.length && ['market', 'sales_channel'].includes(c)).map((c) => [c, look.variable(c)!.samples![0]]));
    onCreate({ name: name.trim() || t?.name || 'New scenario', description: description || t?.says || '', profiles, facts: { ...base, ...(t?.facts ?? {}) }, suite: 'My scenarios' });
  };
  return (
    <section className="ap-newscn" data-testid="ap-scenario-create" aria-label="Create a scenario">
      <header><h2>Create a scenario</h2><button type="button" className="ap-iconbtn" aria-label="Cancel" onClick={onCancel}><Icon name="x" /></button></header>
      <div className="ap-two">
        <Field label="Name"><input className="ap-input big" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t?.name ?? 'For example: ILP sold by phone'} data-testid="ap-scenario-create-name" /></Field>
        <Field label="What it stands for (optional)"><input className="ap-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t?.says ?? ''} /></Field>
      </div>
      <Field label="Application profile" hint="Decides which facts the scenario shows. Several can be combined.">
        <div className="ap-choice wrap" role="group" aria-label="Profiles">{data.profiles.map((p) => { const on = profiles.includes(p.code); return <button key={p.code} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} data-testid={`ap-scenario-create-profile-${p.code}`} onClick={() => setProfiles(on ? profiles.filter((c) => c !== p.code) : [...profiles, p.code])}>{on ? <Icon name="check" size={12} /> : null}{p.name}</button>; })}</div>
      </Field>
      <div className="ap-section-title">Start from a template <span className="ap-quiet">— synthetic test starting points, not compliance policy</span></div>
      <div className="ap-templates" role="radiogroup" aria-label="Template">
        <button type="button" role="radio" aria-checked={template === null} className={template === null ? 'on' : ''} onClick={() => setTemplate(null)} data-testid="ap-template-blank"><strong>Blank</strong><small>Fill in the facts yourself.</small></button>
        {TEMPLATES.map((x) => <button key={x.id} type="button" role="radio" aria-checked={template === x.id} className={template === x.id ? 'on' : ''} onClick={() => setTemplate(x.id)} data-testid={`ap-template-${x.id}`}><strong>{x.name}</strong><small>{x.says}</small></button>)}
      </div>
      <footer><button type="button" className="ap-btn quiet" onClick={onCancel}>Cancel</button><button type="button" className="ap-btn primary" onClick={make} disabled={!profiles.length} data-testid="ap-scenario-create-save"><Icon name="check" size={13} /> Create scenario</button></footer>
    </section>
  );
}

function Generator({ onKeep, policyKey }: { onKeep: (s: Scenario[]) => void; policyKey: string }) {
  const { data, current: rec } = useAppl();
  const policy = (policyKey === 'published' ? rec?.published : rec?.draft) ?? rec?.published ?? null;
  const [out, setOut] = useState<{ scenarios: Scenario[]; coverage: Coverage } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const run = async () => { if (!policy) return; setBusy(true); try { const r = await generate(data, policy); setOut(r); setPicked(new Set(r.scenarios.map((s) => s.id))); } finally { setBusy(false); } };
  useEffect(() => { setOut(null); }, [policyKey]);
  const results = useEvaluation(data, policy, out?.scenarios ?? []);
  const by = new Map((results.data?.results ?? []).map((r) => [r.scenario, r.plan]));
  const cov = out?.coverage;
  return (
    <div className="ap-gen" data-testid="ap-generator">
      <div className="ap-gen-intro"><div><h2>Generate useful combinations</h2><p>Call360 varies only the facts this policy actually reads — each yes / no, each listed value, “not known”, and each number just below, at and above a threshold — and keeps one example for every <strong>different result</strong>.</p></div>
        <button type="button" className="ap-btn primary" onClick={run} disabled={busy || !policy} data-testid="ap-generate-run"><Icon name="sparkle" size={14} /> {busy ? 'Generating…' : out ? 'Generate again' : 'Generate'}</button></div>
      {cov ? (
        <div className={`ap-coverage${cov.checked ? '' : ' bad'}`} data-testid="ap-coverage">
          {cov.checked ? (
            <>
              <dl><div><dt>Facts varied</dt><dd>{cov.variables?.map((v) => v.name).join(', ') || 'none'}</dd></div><div><dt>Combinations examined</dt><dd data-testid="ap-coverage-examined">{cov.combinations_examined?.toLocaleString()}{cov.exhaustive ? ' — every one' : ' — a sample'}</dd></div><div><dt>Different results found</dt><dd data-testid="ap-coverage-distinct">{cov.distinct_results}</dd></div><div><dt>Shown</dt><dd>{cov.shown}</dd></div></dl>
              <div className="ap-coverage-not"><strong>What this does not cover</strong><ul>{cov.not_covered?.map((n) => <li key={n}>{n}</li>)}</ul></div>
              {cov.requirements?.some((r) => r.never_active) ? <p className="ap-field-error"><Icon name="warn" size={12} /> Never selected in any combination: {cov.requirements.filter((r) => r.never_active).map((r) => r.name).join(', ')}.</p> : <p className="ap-quality-ok"><Icon name="check" size={13} /> Every requirement is reached by at least one combination.</p>}
            </>
          ) : <p><Icon name="warn" size={14} /> Nothing was generated: {cov.reason}.</p>}
        </div>
      ) : <Empty icon="sparkle" title="No combinations yet">Generating never claims to be exhaustive when it is not: it says how many combinations it examined and what it left out.</Empty>}
      {out?.scenarios.length ? (
        <>
          <div className="ap-tablewrap"><table className="ap-table" data-testid="ap-generated">
            <thead><tr><th><span className="ap-sr">Keep</span></th><th>Generated application</th><th>Kind</th><th>Result</th><th>Required surveys</th></tr></thead>
            <tbody>{out.scenarios.map((s) => { const p = by.get(s.id); const on = picked.has(s.id); return (
              <tr key={s.id} data-testid={`ap-generated-${s.id}`} data-status={p?.status}><td><button type="button" role="checkbox" aria-checked={on} aria-label={`Keep ${s.name}`} className={`ap-checkbtn${on ? ' on' : ''}`} onClick={() => { const n = new Set(picked); if (on) n.delete(s.id); else n.add(s.id); setPicked(n); }}>{on ? <Icon name="check" size={12} /> : null}</button></td>
                <th scope="row">{s.name}</th><td><Tag tone={s.kind === 'COMBINATION' ? 'plain' : 'warn'}>{s.kind === 'COMBINATION' ? 'combination' : s.kind === 'INVALID_INPUT' ? 'invalid input' : 'missing input'}</Tag></td>
                <td>{p ? <Tag tone={p.status === 'RESOLVED' ? 'published' : 'unknown'}>{p.status === 'RESOLVED' ? 'Decided' : 'Not decided'}</Tag> : '…'}</td><td>{p ? (p.selected.map((e) => shortName(e.survey.name)).join(', ') || (p.status === 'RESOLVED' ? 'none' : '—')) : '…'}{p?.pending.length ? <small> · possibly {p.pending.map((e) => shortName(e.survey.name)).join(', ')}</small> : null}</td></tr>
            ); })}</tbody>
          </table></div>
          <div className="ap-gen-foot"><span className="ap-quiet">{picked.size} of {out.scenarios.length} chosen</span><button type="button" className="ap-btn primary" disabled={!picked.size} onClick={() => onKeep(out.scenarios.filter((s) => picked.has(s.id)))} data-testid="ap-generate-keep"><Icon name="check" size={13} /> Keep the chosen ones as scenarios</button></div>
        </>
      ) : null}
    </div>
  );
}

export function Impact({ rows, onOpen, compact }: { rows: EvalRow[] | undefined; onOpen?: (id: string) => void; compact?: boolean }) {
  const { data, current: rec } = useAppl();
  if (!rec?.draft || !rec.published) return <Empty icon="replace" title="Nothing to compare">A comparison needs a published version and a draft.</Empty>;
  if (!rows) return <p className="ap-quiet">Comparing…</p>;
  const changed = rows.filter((r) => r.comparison?.changed);
  const goldenHit = changed.filter((r) => data.scenarios.find((s) => s.id === r.scenario)?.golden);
  const newUnknown = rows.filter((r) => r.comparison?.new_unknown);
  return (
    <div className="ap-impact" data-testid="ap-impact">
      <div className="ap-impact-summary">
        <div className={changed.length ? 'warn' : 'ok'}><strong data-testid="ap-impact-changed">{changed.length}</strong><span>of {rows.length} saved scenarios get a different result</span></div>
        <div className={rows.length - changed.length ? 'ok' : ''}><strong data-testid="ap-impact-unchanged">{rows.length - changed.length}</strong><span>stay exactly the same</span></div>
        <div className={newUnknown.length ? 'bad' : 'ok'}><strong>{newUnknown.length}</strong><span>become undecided</span></div>
        <div className={goldenHit.length ? 'bad' : 'ok'}><strong data-testid="ap-impact-golden">{goldenHit.length}</strong><span>regression scenarios change</span></div>
      </div>
      <p className="ap-quiet">Published version {rec.published.version} on the left, draft version {rec.draft.version} on the right. Every line is what Call360’s evaluator worked out for both.</p>
      <ul className="ap-impact-list">
        {rows.filter((r) => !compact || r.comparison?.changed).map((r) => { const s = data.scenarios.find((x) => x.id === r.scenario); const c = r.comparison; if (!s || !c) return null; const names = (p: EvalRow['plan'] | undefined): string[] => (p?.selected ?? []).map((e) => shortName(e.survey.name)); return (
          <li key={r.scenario} className={c.changed ? 'changed' : 'same'} data-testid={`ap-impact-${r.scenario}`} data-changed={c.changed}>
            <header><button type="button" className="ap-linkbtn strong" onClick={() => onOpen?.(s.id)}>{s.name}</button>{s.golden ? <Tag tone={c.changed ? 'bad' : 'info'}>regression</Tag> : null}{c.changed ? <Tag tone="warn">changes</Tag> : <Tag tone="published">unchanged</Tag>}</header>
            <div className="ap-impact-sides">
              <div><small>Published</small><p>{names(r.before).map((n) => <span key={n} className={`ap-chip survey${c.removed.some((x) => x.startsWith(n)) ? ' removed' : ''}`}>{n}</span>)}{!names(r.before).length ? <span className="ap-quiet">{r.before?.status === 'RESOLVED' ? 'no survey' : 'not decided'}</span> : null}</p></div>
              <Icon name="arrow" size={16} />
              <div><small>Draft</small><p>{names(r.plan).map((n) => <span key={n} className={`ap-chip survey${c.added.some((x) => x.startsWith(n)) ? ' added' : ''}`}>{n}</span>)}{!names(r.plan).length ? <span className="ap-quiet">{r.plan.status === 'RESOLVED' ? 'no survey' : 'not decided'}</span> : null}</p></div>
            </div>
            {c.changed ? <ul className="ap-impact-why" data-testid={`ap-impact-${r.scenario}-why`}>
              {c.added.length ? <li className="added"><Icon name="plus" size={12} /> Added: {c.added.join(', ')}</li> : null}
              {c.removed.length ? <li className="removed"><Icon name="minus" size={12} /> Removed: {c.removed.join(', ')}</li> : null}
              {c.revised.length ? <li><Icon name="replace" size={12} /> Different version: {c.revised.join(', ')}</li> : null}
              {c.order_changed ? <li><Icon name="order" size={12} /> The delivery order changes</li> : null}
              {c.new_unknown ? <li className="removed"><Icon name="question" size={12} /> It was decided and is now undecided</li> : null}
              {c.because.map((b) => <li key={b.requirement} className="because"><Icon name="arrow" size={12} /> Because {b.text}{rec ? <> — <Link to={`${BASE}/policies/${rec.code}?r=${b.requirement}`}>open the requirement</Link></> : null}</li>)}
            </ul> : null}
          </li>
        ); })}
      </ul>
    </div>
  );
}
