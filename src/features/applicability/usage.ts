// Survey Applicability (APPL-X1) — "where is this used": plain look-ups over the documents (no evaluation).
import { mentions } from './model/describe';
import type { Data, Expr, Policy, PolicyRecord, Requirement } from './model/types';

export const exprsOf = (r: Requirement): (Expr | null)[] => [r.when, ...(r.action.kind === 'CHOOSE_ONE' ? r.action.alternatives.map((a) => a.when) : [])];
export const surveysOf = (r: Requirement) => (r.action.kind === 'CHOOSE_ONE' ? r.action.alternatives.map((a) => a.survey) : r.action.surveys);
export const docsOf = (rec: PolicyRecord): { doc: Policy; state: 'Draft' | 'Published' }[] => [...(rec.draft ? [{ doc: rec.draft, state: 'Draft' as const }] : []), ...(rec.published ? [{ doc: rec.published, state: 'Published' as const }] : [])];

/** Every saved condition an expression reaches, through other saved conditions. */
export function reach(d: Data, e: Expr | null | undefined, seen = new Set<string>()) {
  const vars = new Set<string>();
  const walk = (x: Expr | null | undefined) => {
    const m = mentions(x);
    m.variables.forEach((v) => { vars.add(v); const def = d.variables.find((o) => o.code === v)?.derived; if (def && !seen.has(`v:${v}`)) { seen.add(`v:${v}`); walk(def.expr); } });
    m.conditions.forEach((c) => { if (seen.has(c)) return; seen.add(c); walk(d.conditions.find((o) => o.code === c)?.expr); });
  };
  walk(e);
  return { variables: vars, conditions: new Set([...seen].filter((k) => !k.startsWith('v:'))) };
}
export interface Use { kind: 'condition' | 'variable' | 'profile' | 'policy' | 'scenario'; code: string; label: string; detail: string; to: string }
const B = '/survey-studio/applicability';

export function variableUses(d: Data, code: string): Use[] {
  const out: Use[] = [];
  d.variables.forEach((v) => { if (v.derived && mentions(v.derived.expr).variables.has(code)) out.push({ kind: 'variable', code: v.code, label: v.name, detail: 'is worked out from it', to: `${B}/variables?v=${v.code}` }); });
  d.conditions.forEach((c) => { if (reach(d, c.expr).variables.has(code)) out.push({ kind: 'condition', code: c.code, label: c.name, detail: `saved condition, version ${c.version}`, to: `${B}/conditions?c=${c.code}` }); });
  d.profiles.forEach((p) => { if (p.sections.some((s) => s.variables.includes(code))) out.push({ kind: 'profile', code: p.code, label: p.name, detail: 'carries it', to: `${B}/profiles?p=${p.code}` }); });
  d.policies.forEach((rec) => docsOf(rec).forEach(({ doc, state }) => doc.requirements.forEach((r) => { if (exprsOf(r).some((e) => reach(d, e).variables.has(code))) out.push({ kind: 'policy', code: `${doc.code}:${state}:${r.id}`, label: r.name, detail: `${doc.name} · ${state.toLowerCase()} version ${doc.version}`, to: `${B}/policies/${doc.code}?r=${r.id}` }); })));
  const n = d.scenarios.filter((s) => code in s.facts).length;
  if (n) out.push({ kind: 'scenario', code: 'scenarios', label: `${n} scenario${n === 1 ? '' : 's'}`, detail: 'give it a value', to: `${B}/scenarios` });
  return out;
}
export function conditionUses(d: Data, code: string): Use[] {
  const out: Use[] = [];
  d.conditions.forEach((c) => { if (c.code !== code && mentions(c.expr).conditions.has(code)) out.push({ kind: 'condition', code: c.code, label: c.name, detail: 'is built from it', to: `${B}/conditions?c=${c.code}` }); });
  d.policies.forEach((rec) => docsOf(rec).forEach(({ doc, state }) => doc.requirements.forEach((r) => {
    const versions = new Set<number>();
    const walk = (e: Expr | null | undefined) => { if (!e) return; if (e.op === 'ref') { if (e.condition === code) versions.add(e.version); } else if (e.op === 'not') walk(e.arg); else if (e.op === 'all' || e.op === 'any') e.args.forEach(walk); };
    exprsOf(r).forEach(walk);
    const indirect = !versions.size && exprsOf(r).some((e) => reach(d, e).conditions.has(code));
    if (versions.size || indirect) out.push({ kind: 'policy', code: `${doc.code}:${state}:${r.id}`, label: r.name, detail: `${doc.name} · ${state.toLowerCase()} v${doc.version}${versions.size ? ` · names version ${[...versions].join(', ')}` : ' · through another condition'}`, to: `${B}/policies/${doc.code}?r=${r.id}` });
  })));
  return out;
}
export function surveyUses(d: Data, code: string): Use[] {
  const out: Use[] = [];
  d.policies.forEach((rec) => docsOf(rec).forEach(({ doc, state }) => doc.requirements.forEach((r) => {
    const s = surveysOf(r).find((x) => x.code === code);
    if (s) out.push({ kind: 'policy', code: `${doc.code}:${state}:${r.id}`, label: r.name, detail: `${doc.name} · ${state.toLowerCase()} v${doc.version} · pins version ${s.label ?? s.version}`, to: `${B}/policies/${doc.code}?r=${r.id}` });
  })));
  return out;
}
/** The variables of some profiles, each with the profile it came from and whether a profile requires it. */
export function composed(d: Data, codes: string[]) {
  const rows: { variable: string; from: string; section: string; required: boolean }[] = [];
  const seen = new Set<string>();
  const constraints: { variable: string; profile: string; allowed: string[] }[] = [];
  const walk = (code: string, trail: string[]) => {
    if (seen.has(code) || trail.includes(code)) return;
    seen.add(code);
    const p = d.profiles.find((x) => x.code === code);
    if (!p) return;
    p.extends.forEach((e) => walk(e, [...trail, code]));
    p.sections.forEach((s) => s.variables.forEach((v) => { if (!rows.some((r) => r.variable === v)) rows.push({ variable: v, from: p.code, section: s.name, required: false }); }));
    Object.entries(p.constraints ?? {}).forEach(([variable, rule]) => constraints.push({ variable, profile: p.code, allowed: rule.allowed }));
  };
  codes.forEach((c) => walk(c, []));
  const required = new Set([...seen].flatMap((c) => d.profiles.find((p) => p.code === c)?.required ?? []));
  rows.forEach((r) => { r.required = required.has(r.variable); });
  return { rows, constraints, profiles: [...seen] };
}
export const BASE = B;

/** A survey's name where space is short: without the collection prefix and the "(synthetic demo)" suffix. */
export const shortName = (name: string | undefined): string => (name ?? '').replace(/^Applicability Showcase · /, '').replace(/ \(synthetic demo\)$/, '') || (name ?? '');
