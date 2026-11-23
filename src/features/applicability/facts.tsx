// Survey Applicability (APPL-X1) — the synthetic facts of one application, edited with type-aware controls. A fact
// can be given a value, said to be "not known", or left out altogether; the evaluator keeps those apart.
import { ValueEditor } from './editors';
import type { Facts, FactState, Variable } from './model/types';
import { useAppl } from './store';
import { Icon, Tag } from './ui';

const STATE_WORD: Record<FactState['state'], string> = { KNOWN: '', UNKNOWN: 'Not known', NOT_PROVIDED: 'Not provided', INVALID: 'Invalid value', UNSUPPORTED: 'Not in this profile' };
export function FactsEditor({ codes, facts, onChange, states, groups, testid = 'ap-facts', highlight, compact }: {
  codes: string[]; facts: Facts; onChange: (f: Facts) => void; states?: Record<string, FactState>;
  groups?: { name: string; variables: string[] }[]; testid?: string; highlight?: string[]; compact?: boolean;
}) {
  const { look } = useAppl();
  const row = (code: string) => {
    const v = look.variable(code);
    if (!v) return null;
    const st = states?.[code];
    const given = code in facts;
    const derived = !!v.derived;
    return (
      <div key={code} className={`ap-fact${compact ? ' compact' : ''}${st && st.state !== 'KNOWN' ? ` is-${st.state.toLowerCase()}` : ''}${highlight?.includes(code) ? ' needed' : ''}`} data-testid={`${testid}-${code}`} data-state={st?.state ?? (given ? (facts[code] === null ? 'UNKNOWN' : 'KNOWN') : 'NOT_PROVIDED')}>
        <div className="ap-fact-name"><strong>{v.name}</strong>{v.source.status === 'UNMAPPED' ? <Tag tone="unknown" title={v.source.note}>no source yet</Tag> : null}{highlight?.includes(code) ? <Tag tone="warn">needed to decide</Tag> : null}</div>
        <div className="ap-fact-value">
          {derived ? <span className="ap-derived" data-testid={`${testid}-${code}-derived`}><Icon name="link" size={13} /> Worked out: <strong>{st ? (st.state === 'KNOWN' ? st.label : 'not known') : '…'}</strong></span>
            : given ? <ValueEditor variable={v as Variable} value={facts[code]} onChange={(x) => onChange({ ...facts, [code]: x })} unknown compact={compact} testid={`${testid}-${code}-value`} />
              : <button type="button" className="ap-btn quiet" data-testid={`${testid}-${code}-provide`} onClick={() => onChange({ ...facts, [code]: v.samples?.[0] ?? (v.type === 'BOOLEAN' ? true : v.type === 'MULTI_ENUM' ? [] : v.values?.[0]?.value ?? null) })}><Icon name="plus" size={13} /> Give a value</button>}
        </div>
        <div className="ap-fact-state">
          {st && st.state !== 'KNOWN' ? <span className="ap-fact-why" data-testid={`${testid}-${code}-state`}><Icon name={st.state === 'INVALID' ? 'warn' : 'question'} size={12} /> {STATE_WORD[st.state]}{st.state === 'INVALID' ? `: ${st.reason}` : ''}</span> : null}
          {given && !derived ? <button type="button" className="ap-linkbtn" data-testid={`${testid}-${code}-clear`} onClick={() => { const next = { ...facts }; delete next[code]; onChange(next); }}>Leave out</button> : null}
        </div>
      </div>
    );
  };
  if (groups?.length) {
    const grouped = new Set(groups.flatMap((g) => g.variables));
    const rest = codes.filter((c) => !grouped.has(c));
    return (
      <div className="ap-facts" data-testid={testid}>
        {groups.map((g) => { const mine = g.variables.filter((c) => codes.includes(c)); return mine.length ? <section key={g.name}><h4>{g.name}</h4>{mine.map(row)}</section> : null; })}
        {rest.length ? <section><h4>Other</h4>{rest.map(row)}</section> : null}
      </div>
    );
  }
  return <div className="ap-facts" data-testid={testid}>{codes.map(row)}</div>;
}
