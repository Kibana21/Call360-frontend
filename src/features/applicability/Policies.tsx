// Survey Applicability (APPL-X1R) — the policy gallery: every applicability policy in this workspace, and three honest
// ways to start one — from nothing, from a pattern, or by exploring the guided showcase. PROTOTYPE: policies live in
// this browser tab. "Published" here is a simulated example state, never a record in Call360.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TEMPLATES, scalePolicy } from './model/seed';
import { sentence } from './model/describe';
import type { Policy, PolicyRecord } from './model/types';
import { RequirementSentence } from './Overview';
import { ArchivedPolicies, NameAndCode, codeOk, suggestCode, usePolicies } from './policyService';
import { savedPolicy } from './policyStore';
import { addPolicy, useAppl } from './store';
import { DrawerPanel, Empty, Field, Icon, Tag } from './ui';
import { BASE, surveysOf, shortName } from './usage';

export const stateOf = (rec: PolicyRecord) => (rec.candidate ? 'In review (simulated)' : rec.draft ? (rec.unsaved ? 'Draft · unsaved in this tab' : 'Draft · in this tab') : 'Published example (simulated)');
export function PolicyStates({ rec }: { rec: PolicyRecord }) {
  const pol = usePolicies();
  const kept = pol.on ? savedPolicy(rec.code) : undefined;
  // a policy saved in Call360: a working draft — never a simulated "published" state
  if (kept) return <span className="ap-policy-states"><Tag tone={rec.unsaved ? 'warn' : 'draft'} testid={`ap-pstate-draft-${rec.code}`}>{rec.unsaved ? 'Unsaved changes in this tab' : `Draft saved · revision ${kept.revision}`}</Tag></span>;
  return (
    <span className="ap-policy-states">
      {rec.published ? <Tag tone="published" title="A simulated example state in this prototype. Nothing is published in Call360." testid={`ap-pstate-published-${rec.code}`}><Icon name="lock" size={11} /> v{rec.published.version} published · simulated</Tag> : null}
      {rec.draft ? <Tag tone={rec.unsaved ? 'warn' : 'draft'} testid={`ap-pstate-draft-${rec.code}`}>v{rec.draft.version} draft{rec.unsaved ? ' · unsaved' : ''} · in this tab</Tag> : null}
      {rec.candidate ? <Tag tone="info">in review · simulated</Tag> : null}
    </span>
  );
}

export function PoliciesPage() {
  const { data, update, say, look, setCurrent } = useAppl();
  const pol = usePolicies();
  const go = useNavigate();
  const [making, setMaking] = useState<null | 'blank' | 'template' | { copy: PolicyRecord }>(null);
  const [q, setQ] = useState('');
  const [market, setMarket] = useState('ALL');
  const [history, setHistory] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<{ code: string; reason: string } | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const open = (code: string) => { setCurrent(code); go(`${BASE}/policies/${code}`); };
  // with saved policies, creating one — blank, from a pattern or as a copy — makes a genuine saved draft
  const createSaved = async (p: Parameters<typeof addPolicy>[1] & { code: string }, body?: Parameters<typeof addPolicy>[2]) => { const code = await pol.create({ name: p.name, code: p.code, description: p.description, market: p.market, profiles: p.profiles, origin: p.origin ?? 'BLANK' }, body); if (code) open(code); };
  const create = (p: Parameters<typeof addPolicy>[1], body?: Parameters<typeof addPolicy>[2], then = true) => { let code = ''; update(`Create policy “${p.name}”`, (d) => { code = addPolicy(d, p, body); }); say(`${p.name} created — an unsaved draft in this tab`); if (then) open(code); return code; };
  const duplicate = (rec: PolicyRecord) => { if (pol.on) { setMaking({ copy: rec }); return; } const src = (rec.draft ?? rec.published)!; create({ name: `${src.name} (copy)`, description: src.description, market: src.market, profiles: src.profiles, origin: 'COPY' }, { requirements: src.requirements, order: src.order, scope: src.scope, shared_deliveries: src.shared_deliveries }); };
  const doc = (rec: PolicyRecord): Policy => (rec.draft ?? rec.published)!;
  const k = q.trim().toLowerCase();
  const shown = data.policies.filter((rec) => { const p = doc(rec); return (market === 'ALL' || p.market === market) && (!k || `${p.name} ${p.code} ${p.description} ${p.requirements.map((r) => `${r.name} ${sentence(r.when, look)} ${surveysOf(r).map((x) => x.name).join(' ')}`).join(' ')}`.toLowerCase().includes(k)); });
  // D-418: nothing can be created until the saved policies are KNOWN — a code suggested before the list has arrived
  // may already be taken, and the server then (rightly) refuses it
  const wait = pol.on && pol.status !== 'ready';
  const waiting = wait ? 'The saved policies are still being read' : undefined;
  const pair = compare.map((c) => data.policies.find((p) => p.code === c)).filter(Boolean) as PolicyRecord[];
  return (
    <div className="ap-page ap-gallery" data-testid="ap-gallery">
      <header className="ap-pagehead">
        <div><h1>Applicability policies</h1><p>A policy says which surveys an application needs: <strong>when</strong> these conditions apply, <strong>then</strong> these surveys are required.{pol.on ? ' Each policy is saved in Call360 as a working draft; publishing a policy is not available yet.' : ' Each one is reviewed and published as a whole.'}</p></div>
      </header>

      <section className="ap-starts" aria-label="Start a policy">
        <button type="button" onClick={() => setMaking('blank')} disabled={wait} title={waiting} data-testid="ap-policy-new-blank"><span className="ap-start-icon"><Icon name="plus" size={20} /></span><strong>Create from scratch</strong><small>A blank policy. Name it, add a requirement, pick a published survey.</small></button>
        <button type="button" onClick={() => setMaking('template')} disabled={wait} title={waiting} data-testid="ap-policy-new-template"><span className="ap-start-icon t"><Icon name="sparkle" size={20} /></span><strong>Start with a pattern</strong><small>Two alone and one combined, one condition for several surveys, choose one… Everything stays editable.</small></button>
        {pol.on ? null : <button type="button" onClick={() => open('SHOWCASE-ILP-NFTF')} disabled={!data.policies.some((p) => p.code === 'SHOWCASE-ILP-NFTF')} data-testid="ap-policy-explore"><span className="ap-start-icon s"><Icon name="eye" size={20} /></span><strong>Explore the ILP / NFTF showcase</strong><small>A worked example on the published showcase surveys of Survey Studio. Synthetic.</small></button>}
      </section>

      <div className="ap-gallery-head"><h2>{pol.on ? 'Saved policies' : 'In this workspace'} <span className="ap-count" data-testid="ap-gallery-count">{shown.length}{shown.length !== data.policies.length ? ` of ${data.policies.length}` : ''}</span></h2>
        <label className="ap-searchbox"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, code, condition or survey" aria-label="Search policies" data-testid="ap-gallery-search" /></label>
        <select className="ap-input" aria-label="Market" value={market} onChange={(e) => setMarket(e.target.value)} data-testid="ap-gallery-market"><option value="ALL">Every market</option>{[...new Set(data.policies.map((r) => doc(r).market))].map((m) => <option key={m} value={m}>{m}</option>)}</select>{compare.length ? <span className="ap-quiet">{compare.length === 2 ? 'Comparing two policies below.' : 'Choose one more policy to compare.'} <button type="button" className="ap-linkbtn" onClick={() => setCompare([])}>Clear</button></span> : null}</div>
      {pol.on && pol.status !== 'ready' ? <p className="ap-quiet" data-testid="ap-gallery-status">{pol.status === 'loading' ? 'Reading the saved policies…' : pol.status === 'forbidden' ? 'You are not permitted to read saved policies.' : `The saved policies could not be read${pol.reason ? `: ${pol.reason}` : ''}.`}</p> : null}
      {!data.policies.length && (!pol.on || pol.status === 'ready') ? <Empty icon="policy" title="No policy yet">Create one from scratch, or start with a pattern.</Empty> : null}
      {data.policies.length && !shown.length ? <Empty icon="policy" title="No policy matches">Try another word, or clear the search.</Empty> : null}
      <ul className="ap-pgrid">
        {shown.map((rec) => { const p = doc(rec); const picked = compare.includes(rec.code); const kept = pol.on ? savedPolicy(rec.code) : undefined; return (
          <li key={rec.code} className={`ap-pcard${picked ? ' on' : ''}`} data-testid={`ap-gallery-${rec.code}`}>
            <header><div><h3 title={p.name}>{p.name}</h3><p className="ap-pcard-code"><code>{p.code}</code>{kept ? ` · saved ${kept.updatedBy ? `by ${kept.updatedBy} ` : ''}${new Date(kept.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</p><p>{p.description || 'No description yet.'}</p></div><PolicyStates rec={rec} /></header>
            <div className="ap-pcard-body">
              {p.requirements.slice(0, 3).map((r) => <RequirementSentence key={r.id} r={r} />)}
              {p.requirements.length > 3 ? <p className="ap-quiet">and {p.requirements.length - 3} more requirement{p.requirements.length - 3 === 1 ? '' : 's'}</p> : null}
              {!p.requirements.length ? <p className="ap-quiet">No requirement yet: this policy selects nothing.</p> : null}
            </div>
            <footer>
              <span className="ap-quiet">{p.market} · {p.requirements.length} requirement{p.requirements.length === 1 ? '' : 's'} · {new Set(p.requirements.flatMap(surveysOf).map((s) => s.code)).size} survey{new Set(p.requirements.flatMap(surveysOf).map((s) => s.code)).size === 1 ? '' : 's'}{p.scope ? ` · only when ${sentence(p.scope, look)}` : ''}</span>
              <span className="ap-spacer" />
              <button type="button" role="switch" aria-checked={picked} className={`ap-switch${picked ? ' on' : ''}`} onClick={() => setCompare(picked ? compare.filter((c) => c !== rec.code) : [...compare.slice(-1), rec.code])} data-testid={`ap-gallery-${rec.code}-compare`}>Compare</button>
              {kept ? <button type="button" className="ap-btn quiet" aria-expanded={history === rec.code} onClick={() => setHistory(history === rec.code ? null : rec.code)} data-testid={`ap-gallery-${rec.code}-history`}><Icon name="history" size={13} /> History</button> : null}
              {kept && pol.canEdit ? <button type="button" className="ap-btn quiet" onClick={() => setArchiving({ code: rec.code, reason: '' })} data-testid={`ap-gallery-${rec.code}-archive`}><Icon name="trash" size={13} /> Archive</button> : null}
              <button type="button" className="ap-btn quiet" onClick={() => duplicate(rec)} disabled={wait} data-testid={`ap-gallery-${rec.code}-duplicate`}><Icon name="copy" size={13} /> Duplicate</button>
              <button type="button" className="ap-btn primary" onClick={() => open(rec.code)} data-testid={`ap-gallery-${rec.code}-open`}>Open <Icon name="right" size={13} /></button>
            </footer>
            {history === rec.code ? <ol className="ap-lib-events ap-pcard-history" data-testid={`ap-gallery-${rec.code}-events`}>{[...rec.events].reverse().map((e, n) => <li key={n}><strong>{e.what}</strong> by {e.who}<small>{e.at}{e.detail ? ` · ${e.detail}` : ''}</small></li>)}</ol> : null}
            {archiving?.code === rec.code ? (
              <div className="ap-lib-ask" data-testid="ap-gallery-archive-ask">
                <label>Archive “{p.name}”? It leaves the gallery; its document and history are kept and it can be restored. Say why (at least 10 characters).{rec.unsaved ? ' Its unsaved changes in this tab will be lost.' : ''}
                  <textarea className="ap-input" rows={2} value={archiving.reason} onChange={(e) => setArchiving({ code: rec.code, reason: e.target.value })} data-testid="ap-gallery-archive-reason" /></label>
                <div><button type="button" className="ap-btn primary" disabled={archiving.reason.trim().length < 10} onClick={() => { void pol.archive(rec.code, archiving.reason).then((ok) => { if (ok) setArchiving(null); }); }} data-testid="ap-gallery-archive-ok">Archive this policy</button><button type="button" className="ap-btn quiet" onClick={() => setArchiving(null)}>Cancel</button></div>
              </div>
            ) : null}
          </li>
        ); })}
      </ul>

      {pair.length === 2 ? (
        <section className="ap-compare" data-testid="ap-policy-compare" aria-label="Compare two policies">
          <h2>{doc(pair[0]!).name} compared with {doc(pair[1]!).name}</h2>
          <div className="ap-compare-cols">
            {pair.map((rec, i) => { const p = doc(rec), other = doc(pair[1 - i]!); const theirs = new Set(other.requirements.map((r) => `${sentence(r.when, look)}→${surveysOf(r).map((s) => s.code).join(',')}`)); return (
              <div key={rec.code}><h3>{p.name}</h3><PolicyStates rec={rec} />
                <ul>{p.requirements.map((r) => { const same = theirs.has(`${sentence(r.when, look)}→${surveysOf(r).map((s) => s.code).join(',')}`); return <li key={r.id} className={same ? 'same' : 'differs'}><RequirementSentence r={r} />{same ? <Tag tone="published">in both</Tag> : <Tag tone="warn">only here</Tag>}</li>; })}</ul>
                <p className="ap-quiet">Delivery order: {p.order.map((c) => shortName(p.requirements.flatMap(surveysOf).find((s) => s.code === c)?.name) || c).join(', ') || 'none'}</p></div>
            ); })}
          </div>
          <p className="ap-quiet">A comparison of what the two policies say. To see what they would select for the same application, run a scenario against each.</p>
        </section>
      ) : null}

      <ArchivedPolicies />

      <section className="ap-scale" aria-label="Try the designer at scale">
        <h2>See how the designer behaves on a large policy</h2>
        <p className="ap-quiet">Generated synthetic policies, only for reviewing the design at scale. Their conditions are combinations of the seeded variables and mean nothing.</p>
        <div className="ap-btnrow">{[20, 50, 100].map((n) => <button key={n} type="button" className="ap-btn" onClick={() => { const p = { name: `Scale review · ${n} requirements`, description: 'Generated to review the designer at scale. Synthetic, meaningless conditions.', market: 'SG', profiles: ['new_business'], origin: 'SCALE' as const }; if (pol.on) { let code = `SCALE-REVIEW-${n}`, i = 1; while (pol.taken(code)) code = `SCALE-REVIEW-${n}-${++i}`; void createSaved({ ...p, name: i > 1 ? `${p.name} (${i})` : p.name, code }, scalePolicy(n)); } else create(p, scalePolicy(n)); }} disabled={wait} title={waiting} data-testid={`ap-policy-scale-${n}`}>{n} requirements</button>)}</div>
      </section>

      {making ? <NewPolicy mode={typeof making === 'string' ? making : 'copy'} source={typeof making === 'string' ? undefined : making.copy} onClose={() => setMaking(null)} onCreate={(p, body) => { setMaking(null); if (pol.on && p.code) void createSaved({ ...p, code: p.code }, body); else create(p, body); }} /> : null}
      <p className="ap-quiet"><Link to={`${BASE}/scenarios`}>Test scenarios</Link> and <Link to={`${BASE}/governance`}>review</Link> always speak about the policy you opened last.</p>
    </div>
  );
}

function NewPolicy({ mode, source, onClose, onCreate }: { mode: 'blank' | 'template' | 'copy'; source?: PolicyRecord; onClose: () => void; onCreate: (p: Parameters<typeof addPolicy>[1] & { code?: string }, body?: Parameters<typeof addPolicy>[2]) => void }) {
  const { data } = useAppl();
  const pol = usePolicies();
  const from = source ? (source.draft ?? source.published)! : null;
  const [name, setName] = useState(from ? `${from.name} (copy)` : '');
  const [code, setCode] = useState<string | null>(null);
  const [description, setDescription] = useState(from?.description ?? '');
  const [market, setMarket] = useState('SG');
  const [profiles, setProfiles] = useState<string[]>(from ? from.profiles : data.profiles.some((p) => p.code === 'new_business') ? ['new_business'] : []);
  const finalCode = code ?? suggestCode(name);
  const body = from ? { requirements: from.requirements, order: from.order, scope: from.scope, shared_deliveries: from.shared_deliveries, pins: from.pins } : undefined;
  const [template, setTemplate] = useState<string | null>(mode === 'template' ? TEMPLATES[0]!.id : null);
  const t = TEMPLATES.find((x) => x.id === template);
  const clash = data.policies.some((p) => (p.draft ?? p.published)?.name.trim().toLowerCase() === name.trim().toLowerCase());
  return (
    <DrawerPanel wide onClose={onClose} testid="ap-policy-create" title={mode === 'template' ? 'Start with a pattern' : mode === 'copy' ? `Duplicate “${from?.name}”` : 'Create a policy from scratch'} subtitle={pol.on ? 'It is saved in Call360 as a working draft the moment you create it. Nothing is published.' : 'It starts as a draft in this browser tab. Nothing is published and nothing is saved to Call360.'}
      footer={<><button type="button" className="ap-btn quiet" onClick={onClose}>Cancel</button><span className="ap-spacer" /><button type="button" className="ap-btn primary" disabled={name.trim().length < 3 || (pol.on ? !codeOk(finalCode, pol.taken) : clash)} data-testid="ap-policy-create-save" onClick={() => onCreate({ name, description, market, profiles, origin: from ? 'COPY' : t ? 'TEMPLATE' : 'BLANK', code: pol.on ? finalCode : undefined }, body ?? t?.build())}><Icon name="check" size={13} /> Create policy</button></>}>
      {pol.on ? <NameAndCode noun="policy" name={name} setName={setName} code={code} setCode={setCode} taken={pol.taken} /> : <Field label="Name" hint="What the business calls this set of requirements." error={clash ? 'A policy with this name already exists in this workspace.' : null}><input className="ap-input big" data-autofocus data-testid="ap-policy-create-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: ILP and NFTF Applicability Demo" /></Field>}
      <Field label="What it is for (optional)"><input className="ap-input" data-testid="ap-policy-create-description" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Market"><div className="ap-choice" role="radiogroup" aria-label="Market">{['SG', 'MY'].map((m) => <button key={m} type="button" role="radio" aria-checked={market === m} className={market === m ? 'on' : ''} onClick={() => setMarket(m)}>{m === 'SG' ? 'Singapore' : 'Malaysia'}</button>)}</div></Field>
      <Field label="Which facts it works with" hint="Profiles only decide which variables are offered first. They never decide whether the policy applies — that is its scope, which you can set in the designer.">
        <div className="ap-choice wrap" role="group" aria-label="Profiles">{data.profiles.map((p) => { const on = profiles.includes(p.code); return <button key={p.code} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} onClick={() => setProfiles(on ? profiles.filter((c) => c !== p.code) : [...profiles, p.code])}>{on ? <Icon name="check" size={12} /> : null}{p.name}</button>; })}</div>
      </Field>
      {mode === 'template' ? (
        <><div className="ap-section-title">Pattern</div>
          <div className="ap-templates" role="radiogroup" aria-label="Pattern">{TEMPLATES.map((x) => <button key={x.id} type="button" role="radio" aria-checked={template === x.id} className={template === x.id ? 'on' : ''} onClick={() => setTemplate(x.id)} data-testid={`ap-policy-template-${x.id}`}><strong>{x.name}</strong><small>{x.says}</small></button>)}</div>
          <p className="ap-quiet">Patterns use the published showcase surveys of Survey Studio where they exist. You can change every part afterwards.</p></>
      ) : <div className="ap-callout"><Icon name="info" /><div><strong>What happens next</strong><p>The designer opens on an empty policy. Add a requirement, pick a published survey, choose “always” or “when”, then run a scenario.</p></div></div>}
    </DrawerPanel>
  );
}
