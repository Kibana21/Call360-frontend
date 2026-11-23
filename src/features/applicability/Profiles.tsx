// Survey Applicability (APPL-X1) — Application Profiles: reusable sets of variables that combine. A profile points
// at variables; it never copies their definitions. What a combination adds up to, and any conflict, is shown beside it.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAnalysis } from './api';
import { useVariableItems } from './editors';
import { TYPE_LABEL, slug } from './model/describe';
import type { Data, Profile } from './model/types';
import { useAppl } from './store';
import { Icon, Picker, Tag, useParamState } from './ui';
import { BASE, composed, docsOf } from './usage';

const TONES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const edit = (d: Data, code: string, f: (p: Profile) => void) => { const p = d.profiles.find((x) => x.code === code); if (p) { f(p); if (p.status === 'PUBLISHED') { p.status = 'DRAFT'; p.version += 1; } } };

export function ProfilesPage() {
  const { data, update, look, openDrawer, say } = useAppl();
  const go = useNavigate();
  const [chosen, setChosen] = useParamState('p');
  const sel = data.profiles.find((p) => p.code === chosen) ?? data.profiles[0];
  const [also, setAlso] = useState<string[]>([]);
  const items = useVariableItems();
  const analysis = useAnalysis(data, null);
  const pick = (code: string) => { setChosen(code); setAlso([]); };
  const combo = useMemo(() => (sel ? composed(data, [sel.code, ...also]) : { rows: [], constraints: [], profiles: [] }), [data, sel, also]);
  const tone = (code: string) => TONES[combo.profiles.indexOf(code) % TONES.length];
  const conflicts = useMemo(() => {
    const out: string[] = [];
    const by = new Map<string, { profile: string; allowed: string[] }[]>();
    combo.constraints.forEach((c) => by.set(c.variable, [...(by.get(c.variable) ?? []), c]));
    by.forEach((list, variable) => list.forEach((a, i) => list.slice(i + 1).forEach((b) => { if (!a.allowed.some((x) => b.allowed.includes(x))) out.push(`${look.variable(variable)?.name ?? variable}: “${data.profiles.find((p) => p.code === a.profile)?.name}” allows only ${a.allowed.join(', ')} and “${data.profiles.find((p) => p.code === b.profile)?.name}” allows only ${b.allowed.join(', ')}. No application can fit both.`); })));
    return out;
  }, [combo, data.profiles, look]);
  if (!sel) return null;
  const problems = analysis.data?.diagnostics.filter((d) => d.at?.kind === 'profile' && d.at?.code === sel.code) ?? [];
  const consumers = data.policies.flatMap((rec) => docsOf(rec).filter(({ doc }) => doc.profiles.some((c) => composed(data, [c]).profiles.includes(sel.code))).map(({ doc, state }) => ({ doc, state })));
  // what this profile already carries, itself or through what it builds on: a variable is never added twice
  const own = composed(data, [sel.code]);
  const newProfile = () => { const name = 'New profile'; let code = slug(name), n = 1; while (data.profiles.some((p) => p.code === code)) code = `${slug(name)}_${++n}`; update('Create a profile', (d) => d.profiles.push({ code, name: n > 1 ? `${name} ${n}` : name, description: '', extends: ['common'], sections: [{ name: 'Variables', variables: [] }], required: [], version: 1, status: 'DRAFT' })); pick(code); };
  const sample = () => {
    const id = `sc-${Date.now().toString(36)}`;
    const facts = Object.fromEntries(combo.rows.filter((r) => !look.variable(r.variable)?.derived).map((r) => { const v = look.variable(r.variable)!; const allowed = combo.constraints.find((c) => c.variable === r.variable)?.allowed; return [r.variable, allowed?.[0] ?? v.samples?.[0] ?? null]; }));
    update(`Create a sample application from ${sel.name}`, (d) => d.scenarios.push({ id, name: `Sample: ${[sel.name, ...also.map((c) => data.profiles.find((p) => p.code === c)?.name)].join(' + ')}`, description: 'Made from a profile, with its sample values. Change anything.', profiles: [sel.code, ...also], facts, suite: 'From profiles' }));
    say('Sample application created'); go(`${BASE}/scenarios?s=${id}`);
  };
  return (
    <div className="ap-page ap-profiles" data-testid="ap-profiles">
      <aside className="ap-list" aria-label="Profiles">
        <header><h2>Profiles</h2><button type="button" className="ap-btn quiet" onClick={newProfile} data-testid="ap-profile-new"><Icon name="plus" size={13} /> New</button></header>
        <ul>{data.profiles.map((p) => <li key={p.code}><button type="button" className={p.code === sel.code ? 'on' : ''} onClick={() => pick(p.code)} data-testid={`ap-profile-${p.code}`}><span className="ap-list-icon"><Icon name="profile" size={15} /></span><span><strong>{p.name}</strong><small>{composed(data, [p.code]).rows.length} variables{p.extends.length ? ` · builds on ${p.extends.length}` : ''}</small></span>{p.status === 'DRAFT' ? <Tag tone="draft">Draft</Tag> : null}</button></li>)}</ul>
      </aside>

      <section className="ap-composer" aria-label={`${sel.name}: composer`}>
        <header className="ap-pagehead">
          <div className="ap-editable">
            <input className="ap-title-input" aria-label="Profile name" value={sel.name} onChange={(e) => update('Rename profile', (d) => edit(d, sel.code, (p) => { p.name = e.target.value; }))} data-testid="ap-profile-name" />
            <input className="ap-sub-input" aria-label="What this profile is for" placeholder="What is this profile for?" value={sel.description} onChange={(e) => update('Describe profile', (d) => edit(d, sel.code, (p) => { p.description = e.target.value; }))} />
          </div>
          <Tag tone={sel.status === 'PUBLISHED' ? 'published' : 'draft'}>{sel.status === 'PUBLISHED' ? `Version ${sel.version} published` : `Version ${sel.version} draft`}</Tag>
        </header>

        <div className="ap-block">
          <h3>Builds on</h3>
          <p className="ap-quiet">Everything in these profiles is part of this one. Variables are shared, never copied.</p>
          <div className="ap-chips">
            {sel.extends.map((c) => <span key={c} className={`ap-chip profile tone-${tone(c)}`}><Icon name="profile" size={13} /> {data.profiles.find((p) => p.code === c)?.name ?? c}<button type="button" aria-label={`Stop building on ${c}`} onClick={() => update('Remove a base profile', (d) => edit(d, sel.code, (p) => { p.extends = p.extends.filter((x) => x !== c); }))}><Icon name="x" size={11} /></button></span>)}
            <Picker label="Build on another profile" testid="ap-profile-extend" items={data.profiles.filter((p) => p.code !== sel.code && !sel.extends.includes(p.code) && !composed(data, [p.code]).profiles.includes(sel.code)).map((p) => ({ id: p.code, label: p.name, hint: p.description, icon: 'profile' }))} onPick={(c) => update('Build on a profile', (d) => edit(d, sel.code, (p) => { p.extends.push(c); }))} button={<span className="ap-btn quiet"><Icon name="plus" size={13} /> Build on a profile</span>} />
          </div>
        </div>

        {sel.sections.map((s, si) => (
          <div className="ap-block" key={si} data-testid={`ap-profile-section-${si}`}>
            <div className="ap-block-head"><input className="ap-h3-input" aria-label="Section name" value={s.name} onChange={(e) => update('Rename section', (d) => edit(d, sel.code, (p) => { p.sections[si]!.name = e.target.value; }))} />
              <button type="button" className="ap-iconbtn" aria-label={`Remove section ${s.name}`} onClick={() => update('Remove section', (d) => edit(d, sel.code, (p) => { p.sections.splice(si, 1); }))}><Icon name="trash" size={14} /></button></div>
            <ul className="ap-pvars">
              {s.variables.map((code, vi) => { const v = look.variable(code); const req = sel.required.includes(code); const rule = sel.constraints?.[code]; return (
                <li key={code} data-testid={`ap-profile-var-${code}`}>
                  <span className="ap-pvar-name"><Icon name="variable" size={14} /><strong>{v?.name ?? code}</strong><small>{v ? TYPE_LABEL[v.type] : 'missing'}</small></span>
                  {v?.type === 'ENUM' ? <span className="ap-pvar-allow" role="group" aria-label={`${v.name}: values this profile allows`}><small>Allows</small>{v.values!.map((o) => { const on = !rule || rule.allowed.includes(o.value); return <button key={o.value} type="button" role="checkbox" aria-checked={on} className={`ap-minichip${on ? ' on' : ''}`} data-testid={`ap-profile-allow-${code}-${o.value}`} onClick={() => update('Change what a profile allows', (d) => edit(d, sel.code, (p) => { const all = v.values!.map((x) => x.value); const cur = p.constraints?.[code]?.allowed ?? all; const next = on ? cur.filter((x) => x !== o.value) : [...cur, o.value]; p.constraints = { ...(p.constraints ?? {}) }; if (next.length === all.length || !next.length) delete p.constraints[code]; else p.constraints[code] = { allowed: next }; }))}>{o.label}</button>; })}</span> : null}
                  <span className="ap-pvar-tools">
                    <button type="button" role="switch" aria-checked={req} className={`ap-switch${req ? ' on' : ''}`} data-testid={`ap-profile-required-${code}`} onClick={() => update('Change whether a variable is required', (d) => edit(d, sel.code, (p) => { p.required = req ? p.required.filter((x) => x !== code) : [...p.required, code]; }))}>{req ? 'Required' : 'Optional'}</button>
                    <button type="button" className="ap-iconbtn" aria-label="Move up" disabled={vi === 0} onClick={() => update('Reorder variables', (d) => edit(d, sel.code, (p) => { const a = p.sections[si]!.variables; a.splice(vi - 1, 0, a.splice(vi, 1)[0]!); }))}><Icon name="up" size={13} /></button>
                    <button type="button" className="ap-iconbtn" aria-label="Move down" disabled={vi === s.variables.length - 1} onClick={() => update('Reorder variables', (d) => edit(d, sel.code, (p) => { const a = p.sections[si]!.variables; a.splice(vi + 1, 0, a.splice(vi, 1)[0]!); }))}><Icon name="down" size={13} /></button>
                    <button type="button" className="ap-iconbtn" aria-label={`Remove ${v?.name ?? code} from this profile`} onClick={() => update('Remove a variable from a profile', (d) => edit(d, sel.code, (p) => { p.sections[si]!.variables = p.sections[si]!.variables.filter((x) => x !== code); p.required = p.required.filter((x) => x !== code); }))}><Icon name="x" size={13} /></button>
                  </span>
                </li>
              ); })}
              {!s.variables.length ? <li className="ap-pvars-empty">No variable in this section yet.</li> : null}
            </ul>
            <Picker label={`Add a variable to ${s.name}`} testid={`ap-profile-add-${si}`} items={items.map((i) => { const from = own.rows.find((r) => r.variable === i.id)?.from; return { ...i, disabled: !!from, tag: from ? <Tag>{from === sel.code ? 'already here' : `already in ${data.profiles.find((p) => p.code === from)?.name ?? from}`}</Tag> : i.tag }; })} placeholder="Search variables…" onPick={(code) => update('Add a variable to a profile', (d) => edit(d, sel.code, (p) => { p.sections[si]!.variables.push(code); }))}
              button={<span className="ap-btn quiet"><Icon name="plus" size={13} /> Add a variable</span>}
              footer={(close, q) => <button type="button" className="ap-pop-create" onClick={() => { close(); openDrawer({ kind: 'variable', name: q, then: (made) => update('Add a new variable to a profile', (d) => edit(d, sel.code, (p) => { if (!p.sections[si]!.variables.includes(made.code)) p.sections[si]!.variables.push(made.code); })) }); }}><Icon name="plus" size={13} /> Create a variable{q ? ` called “${q}”` : ''}</button>} />
          </div>
        ))}
        <button type="button" className="ap-btn quiet" onClick={() => update('Add a section', (d) => edit(d, sel.code, (p) => { p.sections.push({ name: 'New section', variables: [] }); }))} data-testid="ap-profile-add-section"><Icon name="plus" size={13} /> Add a section</button>
        {problems.length ? <ul className="ap-issues block">{problems.map((d, i) => <li key={i} className={d.severity.toLowerCase()}><Icon name="warn" size={12} /> {d.message}</li>)}</ul> : null}
      </section>

      <aside className="ap-result" aria-label="The resulting application" data-testid="ap-profile-result">
        <h2>The resulting application</h2>
        <p className="ap-quiet">An application can use several profiles at once. Add others to see what the combination carries.</p>
        <div className="ap-chips">
          <span className={`ap-chip profile tone-${tone(sel.code)}`}><Icon name="profile" size={13} /> {sel.name}</span>
          {also.map((c) => <span key={c} className={`ap-chip profile tone-${tone(c)}`}><Icon name="profile" size={13} /> {data.profiles.find((p) => p.code === c)?.name}<button type="button" aria-label="Remove from the combination" onClick={() => setAlso(also.filter((x) => x !== c))}><Icon name="x" size={11} /></button></span>)}
          <Picker label="Combine with another profile" testid="ap-profile-combine" align="right" items={data.profiles.filter((p) => p.code !== sel.code && !also.includes(p.code)).map((p) => ({ id: p.code, label: p.name, hint: p.description, icon: 'profile' }))} onPick={(c) => setAlso([...also, c])} button={<span className="ap-btn quiet"><Icon name="plus" size={13} /> Combine with…</span>} />
        </div>
        {conflicts.length ? <div className="ap-callout bad" data-testid="ap-profile-conflict"><Icon name="warn" /><div><strong>These profiles cannot be used together</strong><ul>{conflicts.map((c) => <li key={c}>{c}</li>)}</ul></div></div> : null}
        <ul className="ap-merged">
          {combo.rows.map((r) => { const v = look.variable(r.variable); const rule = combo.constraints.filter((c) => c.variable === r.variable); return (
            <li key={r.variable} className={`tone-${tone(r.from)}`} data-testid={`ap-merged-${r.variable}`} data-from={r.from}>
              <span className="ap-merged-band" aria-hidden="true" />
              <span className="ap-merged-name"><strong>{v?.name ?? r.variable}</strong><small>from {data.profiles.find((p) => p.code === r.from)?.name}{r.from !== sel.code && !also.includes(r.from) ? ' (built on)' : ''}</small></span>
              <span className="ap-merged-tags">{r.required ? <Tag tone="info">required</Tag> : null}{rule.map((c) => <Tag key={c.profile} tone="warn">only {c.allowed.map((x) => v?.values?.find((o) => o.value === x)?.label ?? x).join(', ')}</Tag>)}{v?.derived ? <Tag>worked out</Tag> : null}</span>
            </li>
          ); })}
        </ul>
        <div className="ap-result-foot">
          <button type="button" className="ap-btn" onClick={sample} disabled={!!conflicts.length} data-testid="ap-profile-sample"><Icon name="scenario" size={13} /> Create a sample application</button>
          <span className="ap-quiet">{combo.rows.length} variables from {combo.profiles.length} profile{combo.profiles.length === 1 ? '' : 's'}</span>
        </div>
        <h3>Used by</h3>
        {consumers.length ? <ul className="ap-uses">{consumers.map(({ doc, state }) => <li key={`${doc.code}-${state}`}><Link to={`${BASE}/policies/${doc.code}`}><Icon name="policy" size={14} /><span><strong>{doc.name}</strong><small>{state.toLowerCase()} version {doc.version}</small></span><Icon name="right" size={13} /></Link></li>)}</ul> : <p className="ap-quiet">No policy uses this profile yet.</p>}
      </aside>
    </div>
  );
}
