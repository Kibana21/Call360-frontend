// Survey Applicability (APPL-X1) — things created without leaving the page: a variable (a guided, type-aware flow)
// and a saved condition. Each opens over whatever the person was doing and returns them to the same place, with the
// new item already used there.
import { useMemo, useState } from 'react';
import { useConditionTest } from './api';
import { ConditionBuilder, SOURCE_WORD } from './editors';
import { TYPE_HINT, TYPE_LABEL, mentions, sentence, slug } from './model/describe';
import type { Condition, Expr, Option, Variable, VarType } from './model/types';
import { useLibrary } from './library';
import { useAppl } from './store';
import { DrawerPanel, Field, Icon, Tag, type IconName } from './ui';

const STEPS = ['Name', 'Type', 'Allowed values', 'Applicability', 'Source and ownership', 'Review'] as const;
const TYPE_ICON: Record<VarType, IconName> = { BOOLEAN: 'check', ENUM: 'order', MULTI_ENUM: 'cards', NUMBER: 'plus', DECIMAL: 'plus', MONEY: 'download', DATE: 'history', STRING: 'variable' };
const CATEGORIES = ['Application', 'Product', 'Sale', 'Premium', 'Risk', 'Customer'];
const similar = (a: string, b: string) => { const x = a.toLowerCase().replace(/[^a-z0-9]/g, ''), y = b.toLowerCase().replace(/[^a-z0-9]/g, ''); return x.length > 2 && (x === y || x.includes(y) || y.includes(x)); };

export function VariableDrawer() {
  const { data, drawer, openDrawer, update, say } = useAppl();
  const lib = useLibrary();
  const d = drawer?.kind === 'variable' ? drawer : null;
  const existing = d?.code ? data.variables.find((v) => v.code === d.code) : undefined;
  const [step, setStep] = useState(0);
  const [v, setV] = useState<Variable>(() => existing ? structuredClone(existing) : {
    code: '', name: d?.name ?? '', description: '', category: 'Application', type: 'BOOLEAN', markets: ['SG'],
    source: { status: 'UNMAPPED', note: '' }, owner: '', samples: [], version: 1, status: 'DRAFT',
  });
  const [profiles, setProfiles] = useState<string[]>(() => existing ? data.profiles.filter((p) => p.sections.some((s) => s.variables.includes(existing.code))).map((p) => p.code) : []);
  const [raw, setRaw] = useState('');
  const set = (patch: Partial<Variable>) => setV((x) => ({ ...x, ...patch }));
  const code = existing?.code ?? slug(v.name);
  const listed = v.type === 'ENUM' || v.type === 'MULTI_ENUM';
  const numeric = v.type === 'NUMBER' || v.type === 'DECIMAL' || v.type === 'MONEY';
  const twins = useMemo(() => data.variables.filter((o) => o.code !== existing?.code && v.name.trim() && similar(o.name, v.name)), [data.variables, v.name, existing]);
  const errors: Record<number, string | null> = {
    0: v.name.trim().length < 2 ? 'Give the variable a name.' : !existing && data.variables.some((o) => o.code === code) ? 'A variable with this name already exists.' : null,
    1: null,
    2: listed && (v.values?.length ?? 0) < 2 ? 'Add at least two values.' : v.type === 'MONEY' && !v.currency ? 'Choose the currency.' : numeric && v.min !== undefined && v.max !== undefined && v.min > v.max ? 'The lowest value is above the highest.' : null,
    3: null, 4: null, 5: null,
  };
  const firstError = STEPS.findIndex((_, i) => errors[i]);
  if (!d) return null;
  const close = () => openDrawer(null);
  const addValue = () => { const label = raw.trim(); if (!label) return; const value = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''); if (!value || v.values?.some((o) => o.value === value)) return; set({ values: [...(v.values ?? []), { value, label }] }); setRaw(''); };
  const save = () => {
    const made: Variable = { ...v, code, values: listed ? v.values : undefined, currency: v.type === 'MONEY' ? v.currency : undefined, min: numeric ? v.min : undefined, max: numeric ? v.max : undefined, version: existing ? existing.version + (existing.status === 'PUBLISHED' ? 1 : 0) : 1, status: 'DRAFT', previous: existing ? (existing.status === 'PUBLISHED' ? { ...existing, previous: null } : existing.previous ?? null) : null };
    update(existing ? `Change variable ${made.name}` : `Create variable ${made.name}`, (x) => {
      const i = x.variables.findIndex((o) => o.code === code);
      if (i >= 0) x.variables[i] = made; else x.variables.push(made);
      x.profiles.forEach((p) => {
        const has = p.sections.some((s) => s.variables.includes(code));
        if (profiles.includes(p.code) && !has) { if (!p.sections.length) p.sections.push({ name: 'Added', variables: [] }); p.sections.at(-1)!.variables.push(code); }
        if (!profiles.includes(p.code) && has) p.sections.forEach((s) => { s.variables = s.variables.filter((c) => c !== code); });
      });
    });
    // with the saved library on it is kept in Call360 as a DRAFT: usable while designing, never a published dependency
    if (lib.on) void lib.save('VARIABLE', code, { item: made }); else say(existing ? `${made.name} changed — a new draft version` : `${made.name} created`);
    close();
    d.then?.(made);
  };
  const body = () => {
    if (step === 0) return (
      <>
        <Field label="What is this fact called?" hint="Use the words the business uses. People will search for it by this name." error={step === 0 ? null : errors[0]}>
          <input className="ap-input big" data-autofocus data-testid="ap-var-name" value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="For example: Replacement applies" />
        </Field>
        {twins.length ? <div className="ap-callout warn" data-testid="ap-var-twins"><Icon name="warn" /> <div><strong>This looks like something that already exists.</strong><ul>{twins.map((t) => <li key={t.code}>{t.name} — {t.description}</li>)}</ul>Reuse it if it means the same thing: one fact, defined once.</div></div> : null}
        <Field label="What does it mean?" hint="One or two sentences. This is shown wherever the variable is used.">
          <textarea className="ap-input" rows={3} data-testid="ap-var-description" value={v.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label="Group"><div className="ap-choice wrap" role="radiogroup" aria-label="Group">{CATEGORIES.map((c) => <button key={c} type="button" role="radio" aria-checked={v.category === c} className={v.category === c ? 'on' : ''} onClick={() => set({ category: c })}>{c}</button>)}</div></Field>
      </>
    );
    if (step === 1) return (
      <div className="ap-typegrid" role="radiogroup" aria-label="Kind of value">
        {(Object.keys(TYPE_LABEL) as VarType[]).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={v.type === t} className={v.type === t ? 'on' : ''} data-testid={`ap-var-type-${t}`} onClick={() => set({ type: t, values: t === 'ENUM' || t === 'MULTI_ENUM' ? v.values ?? [] : undefined })}>
            <span className="ap-typegrid-icon"><Icon name={TYPE_ICON[t]} size={18} /></span><strong>{TYPE_LABEL[t]}</strong><small>{TYPE_HINT[t]}</small>
          </button>
        ))}
      </div>
    );
    if (step === 2) {
      if (listed) return (
        <>
          <p className="ap-lede">The values {v.name || 'this variable'} can take. {v.type === 'MULTI_ENUM' ? 'An application can have several of them.' : 'An application has exactly one.'}</p>
          <ul className="ap-values" data-testid="ap-var-values">
            {(v.values ?? []).map((o: Option, i) => (
              <li key={o.value}><Icon name="grip" size={14} /><input className="ap-input" aria-label={`Value ${i + 1}`} value={o.label} onChange={(e) => set({ values: v.values!.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)) })} /><code>{o.value}</code>
                <button type="button" className="ap-iconbtn" aria-label={`Remove ${o.label}`} onClick={() => set({ values: v.values!.filter((_, n) => n !== i) })}><Icon name="trash" size={14} /></button></li>
            ))}
          </ul>
          <div className="ap-addrow"><input className="ap-input" data-testid="ap-var-value-new" value={raw} onChange={(e) => setRaw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addValue(); } }} placeholder="Type a value and press Enter" aria-label="New value" /><button type="button" className="ap-btn" onClick={addValue} data-testid="ap-var-value-add"><Icon name="plus" size={13} /> Add value</button></div>
          {errors[2] ? <p className="ap-field-error"><Icon name="warn" size={12} /> {errors[2]}</p> : null}
        </>
      );
      if (v.type === 'BOOLEAN') return <div className="ap-callout"><Icon name="info" /> <div><strong>Nothing to set up.</strong> A yes / no fact is always one of: yes, no, or not known. “Not known” is never treated as no.</div></div>;
      if (numeric) return (
        <>
          {v.type === 'MONEY' ? <Field label="Currency" hint="Amounts in another currency are rejected, never converted." error={errors[2]?.includes('currency') ? errors[2] : null}><div className="ap-choice" role="radiogroup" aria-label="Currency">{['SGD', 'MYR', 'USD'].map((c) => <button key={c} type="button" role="radio" aria-checked={v.currency === c} className={v.currency === c ? 'on' : ''} data-testid={`ap-var-currency-${c}`} onClick={() => set({ currency: c })}>{c}</button>)}</div></Field> : null}
          <div className="ap-two"><Field label="Lowest allowed (optional)"><input className="ap-input" type="number" value={v.min ?? ''} onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field><Field label="Highest allowed (optional)" error={errors[2]?.includes('lowest') ? errors[2] : null}><input className="ap-input" type="number" value={v.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field></div>
        </>
      );
      return <div className="ap-callout"><Icon name="info" /> <div><strong>Nothing to set up.</strong> {v.type === 'DATE' ? 'A date can be compared as on, before, after or between.' : 'Text can only be compared exactly — there is no “contains” or pattern matching.'}</div></div>;
    }
    if (step === 3) return (
      <>
        <p className="ap-lede">Which application profiles carry this fact? A profile is a reusable set of variables; choose none and add it later if you are not sure.</p>
        <div className="ap-checklist">{data.profiles.map((p) => { const on = profiles.includes(p.code); return <button key={p.code} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} data-testid={`ap-var-profile-${p.code}`} onClick={() => setProfiles(on ? profiles.filter((c) => c !== p.code) : [...profiles, p.code])}><span className="ap-check">{on ? <Icon name="check" size={12} /> : null}</span><span><strong>{p.name}</strong><small>{p.description}</small></span></button>; })}</div>
        <Field label="Markets"><div className="ap-choice" role="group" aria-label="Markets">{['SG', 'MY'].map((m) => { const on = v.markets.includes(m); return <button key={m} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} onClick={() => set({ markets: on ? v.markets.filter((x) => x !== m) : [...v.markets, m] })}>{m}</button>; })}</div></Field>
      </>
    );
    if (step === 4) return (
      <>
        <Field label="Where does the value come from?" hint="Be honest here: a policy can be designed and tested before a source exists, but it cannot be used for real applications without one.">
          <div className="ap-checklist">{(['UNMAPPED', 'PROPOSED', 'MAPPED'] as const).map((st) => <button key={st} type="button" role="radio" aria-checked={v.source.status === st} className={v.source.status === st ? 'on' : ''} data-testid={`ap-var-source-${st}`} onClick={() => set({ source: { ...v.source, status: st } })}><span className="ap-check round">{v.source.status === st ? <Icon name="dot" size={12} /> : null}</span><span><strong>{SOURCE_WORD[st]}</strong><small>{st === 'UNMAPPED' ? 'Nothing feeds it yet. Usable in synthetic scenarios only.' : st === 'PROPOSED' ? 'A source is suggested but the mapping is not approved.' : 'An approved mapping to a source field exists.'}</small></span></button>)}</div>
        </Field>
        {v.source.status !== 'UNMAPPED' ? <div className="ap-two"><Field label="Source system"><input className="ap-input" value={v.source.system ?? ''} onChange={(e) => set({ source: { ...v.source, system: e.target.value } })} /></Field><Field label="Source field"><input className="ap-input" value={v.source.field ?? ''} onChange={(e) => set({ source: { ...v.source, field: e.target.value } })} /></Field></div> : null}
        <Field label="Note on the source (optional)"><input className="ap-input" value={v.source.note ?? ''} onChange={(e) => set({ source: { ...v.source, note: e.target.value } })} /></Field>
        <Field label="Business owner (optional)" hint="Who decides what this fact means."><input className="ap-input" data-testid="ap-var-owner" value={v.owner ?? ''} onChange={(e) => set({ owner: e.target.value })} /></Field>
      </>
    );
    return (
      <div className="ap-review" data-testid="ap-var-review">
        <h3>{v.name || 'Unnamed'}</h3><p>{v.description || 'No description.'}</p>
        <dl>
          <dt>Kind of value</dt><dd>{TYPE_LABEL[v.type]}{v.type === 'MONEY' ? ` · ${v.currency ?? 'no currency'}` : ''}</dd>
          {listed ? <><dt>Allowed values</dt><dd>{(v.values ?? []).map((o) => o.label).join(', ') || 'none'}</dd></> : null}
          {numeric && (v.min !== undefined || v.max !== undefined) ? <><dt>Range</dt><dd>{v.min ?? '…'} to {v.max ?? '…'}</dd></> : null}
          <dt>Profiles</dt><dd>{profiles.map((c) => data.profiles.find((p) => p.code === c)?.name).join(', ') || 'none yet'}</dd>
          <dt>Markets</dt><dd>{v.markets.join(', ') || 'none'}</dd>
          <dt>Source</dt><dd>{SOURCE_WORD[v.source.status]}{v.source.system ? ` · ${v.source.system}` : ''}{v.source.field ? ` · ${v.source.field}` : ''}</dd>
          <dt>Owner</dt><dd>{v.owner || 'not stated'}</dd>
          <dt>Identifier</dt><dd><code>{code || '—'}</code> <small>made from the name; it never changes afterwards</small></dd>
        </dl>
        {firstError >= 0 ? <p className="ap-field-error"><Icon name="warn" size={12} /> {errors[firstError]} <button type="button" className="ap-linkbtn" onClick={() => setStep(firstError)}>Go to “{STEPS[firstError]}”</button></p> : null}
      </div>
    );
  };
  return (
    <DrawerPanel wide testid="ap-variable-drawer" onClose={close} title={existing ? `Change ${existing.name}` : 'Create a variable'}
      subtitle={existing?.status === 'PUBLISHED' ? `Published version ${existing.version} stays as it is. Saving makes draft version ${existing.version + 1}; nothing that uses version ${existing.version} changes.` : 'A fact about an application, defined once and reused everywhere.'}
      footer={<>
        <button type="button" className="ap-btn quiet" onClick={close}>Cancel</button>
        <span className="ap-spacer" />
        {step > 0 ? <button type="button" className="ap-btn" onClick={() => setStep(step - 1)} data-testid="ap-var-back"><Icon name="left" size={13} /> Back</button> : null}
        {step < STEPS.length - 1 ? <button type="button" className="ap-btn primary" disabled={!!errors[step]} onClick={() => setStep(step + 1)} data-testid="ap-var-next">Next: {STEPS[step + 1]} <Icon name="right" size={13} /></button>
          : <button type="button" className="ap-btn primary" disabled={firstError >= 0} onClick={save} data-testid="ap-var-save"><Icon name="check" size={13} /> {existing ? 'Save as a new draft version' : 'Create variable'}</button>}
      </>}>
      <ol className="ap-wizard" aria-label="Steps">
        {STEPS.map((s, i) => <li key={s} className={i === step ? 'at' : i < step ? 'done' : ''}><button type="button" onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined} disabled={i > step && STEPS.slice(0, i).some((_, n) => errors[n])} data-testid={`ap-var-step-${i}`}><span>{i < step ? <Icon name="check" size={11} /> : i + 1}</span>{s}</button></li>)}
      </ol>
      <div className="ap-wizard-body">{body()}{step < 5 && errors[step] && step !== 2 ? <p className="ap-field-error" data-testid="ap-var-error"><Icon name="warn" size={12} /> {errors[step]}</p> : null}</div>
    </DrawerPanel>
  );
}

/** A saved condition created (or changed) over the current page, with a live test beside it. */
export function ConditionDrawer() {
  const { data, drawer, openDrawer, update, say, look } = useAppl();
  const lib = useLibrary();
  const d = drawer?.kind === 'condition' ? drawer : null;
  const existing = d?.code ? data.conditions.find((c) => c.code === d.code) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [expr, setExpr] = useState<Expr | null>(existing?.expr ?? null);
  const test = useConditionTest(data, expr, {});
  if (!d) return null;
  const code = existing?.code ?? slug(name);
  const clash = !existing && data.conditions.some((c) => c.code === code);
  const blockers = test.data?.diagnostics.filter((x) => x.severity === 'BLOCKER') ?? [];
  const ok = name.trim().length >= 2 && !!expr && !clash && !blockers.length;
  const close = () => openDrawer(null);
  const save = () => {
    if (!expr) return;
    const published = existing?.status === 'PUBLISHED';
    const made: Condition = { code, name: name.trim(), description, expr, version: existing ? existing.version + (published ? 1 : 0) : 1, status: 'DRAFT', history: existing && published ? [...(existing.history ?? []), { version: existing.version, expr: existing.expr }] : existing?.history };
    update(existing ? `Change condition ${made.name}` : `Create condition ${made.name}`, (x) => { const i = x.conditions.findIndex((c) => c.code === code); if (i >= 0) x.conditions[i] = made; else x.conditions.push(made); });
    if (lib.on) void lib.save('CONDITION', code, { item: made }); else say(existing ? `${made.name}: draft version ${made.version}. Policies keep the version they name.` : `${made.name} saved`);
    close();
    d.then?.(made);
  };
  const uses = mentions(expr);
  return (
    <DrawerPanel wide testid="ap-condition-drawer" onClose={close} title={existing ? `Change “${existing.name}”` : 'Create a condition'}
      subtitle={existing?.status === 'PUBLISHED' ? `Version ${existing.version} is published and stays as it is. Saving makes version ${existing.version + 1}. A policy keeps the exact version it names.` : 'A named, reusable statement about an application.'}
      footer={<><button type="button" className="ap-btn quiet" onClick={close}>Cancel</button><span className="ap-spacer" /><button type="button" className="ap-btn primary" disabled={!ok} onClick={save} data-testid="ap-cond-save"><Icon name="check" size={13} /> {existing ? 'Save as a new version' : 'Save condition'}</button></>}>
      <Field label="Name" hint="How people will find and read it, for example “ILP with NFTF”." error={clash ? 'A condition with this name already exists.' : null}>
        <input className="ap-input big" data-autofocus data-testid="ap-cond-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="What it is for (optional)"><input className="ap-input" data-testid="ap-cond-description" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="ap-section-title">When is it true?</div>
      <ConditionBuilder expr={expr} onChange={setExpr} self={existing?.code} diagnostics={test.data?.diagnostics} testid="ap-cond-builder" />
      {expr ? <p className="ap-quiet">Reads {uses.variables.size} variable{uses.variables.size === 1 ? '' : 's'}{uses.conditions.size ? ` and ${uses.conditions.size} saved condition${uses.conditions.size === 1 ? '' : 's'}` : ''}. <Tag tone="info">{sentence(expr, look)}</Tag></p> : null}
    </DrawerPanel>
  );
}
