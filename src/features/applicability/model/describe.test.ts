import { describe, expect, it } from 'vitest';
import { applicabilityEnabled } from '../flag';
import { navFor } from '../../../app/nav';
import { composed, conditionUses, surveyUses, variableUses } from '../usage';
import { mentions, nodeAt, operatorsFor, replaceAt, sentence, slug, starter, withOperator, type Lookup } from './describe';
import { seed } from './seed';
import type { Expr } from './types';

const d = seed();
const look: Lookup = { variable: (c) => d.variables.find((v) => v.code === c), condition: (c) => d.conditions.find((x) => x.code === c) };
const ref = (c: string): Expr => ({ op: 'ref', condition: c, version: 1 });

describe('Survey applicability — wording and document helpers (no evaluation happens in the browser)', () => {
  it('reads a condition as a sentence, with groups in brackets only where they are needed', () => {
    expect(sentence(null, look)).toBe('always');
    expect(sentence({ op: 'test', variable: 'product_family', operator: 'equals', value: 'ILP' }, look)).toBe('Product family is Investment-linked');
    expect(sentence({ op: 'all', args: [ref('is_ilp'), { op: 'any', args: [ref('nftf_applies'), ref('high_premium')] }, { op: 'not', arg: ref('replacement_applies') }] }, look))
      .toBe('“Is ILP” and (“NFTF applies” or “High premium”) and not “Replacement applies”');
    expect(sentence({ op: 'test', variable: 'annual_premium', operator: 'between', min: 1000, max: 5000 }, look)).toBe('Annual premium is between SGD 1,000 and SGD 5,000');
    expect(sentence({ op: 'test', variable: 'selected_riders', operator: 'includes_any', values: ['CI', 'WOP'] }, look)).toBe('Selected riders includes any of Critical illness, Waiver of premium');
  });
  it('offers only the comparisons a kind of value allows, and keeps a test valid when the comparison changes', () => {
    const v = (c: string) => look.variable(c)!;
    expect(operatorsFor(v('nftf'))).toEqual(['is_true', 'is_false', 'is_known', 'is_unknown']);
    expect(operatorsFor(v('annual_premium'))).not.toContain('in');
    expect(operatorsFor(v('commencement_date'))).toEqual(['on', 'before', 'after', 'between', 'is_known', 'is_unknown']);
    expect(starter(v('product_family'))).toEqual({ op: 'test', variable: 'product_family', operator: 'equals', value: 'ILP' });
    const t = starter(v('product_family')) as Extract<Expr, { op: 'test' }>;
    expect(withOperator(t, 'in', v('product_family'))).toEqual({ op: 'test', variable: 'product_family', operator: 'in', values: ['ILP'] });
    expect(withOperator(t, 'is_unknown', v('product_family'))).toEqual({ op: 'test', variable: 'product_family', operator: 'is_unknown' });
  });
  it('finds and replaces one node of an expression by its path', () => {
    const e: Expr = { op: 'all', args: [ref('is_ilp'), { op: 'not', arg: ref('nftf_applies') }] };
    expect(nodeAt(e, '1.0')).toEqual(ref('nftf_applies'));
    expect(replaceAt(e, '1.0', () => ref('high_premium'))).toEqual({ op: 'all', args: [ref('is_ilp'), { op: 'not', arg: ref('high_premium') }] });
    expect(replaceAt(e, '1', () => null)).toEqual({ op: 'all', args: [ref('is_ilp')] });
    expect([...mentions(e).conditions]).toEqual(['is_ilp', 'nftf_applies']);
    expect(slug('  Sale method (new) ')).toBe('sale_method_new');
  });
  it('answers "where is this used" through saved conditions and worked-out variables', () => {
    const uses = variableUses(d, 'product_family');
    expect(uses.map((u) => `${u.kind}:${u.label}`)).toEqual(expect.arrayContaining(['variable:Is ILP', 'condition:Is ILP', 'condition:ILP with NFTF', 'profile:Common insurance application', 'policy:ILP needs the ILP survey']));
    expect(conditionUses(d, 'nftf_applies').some((u) => u.label === 'ILP with NFTF needs the combined survey' && u.detail.includes('through another condition'))).toBe(true);
    expect(surveyUses(d, 'S-C').map((u) => u.detail)).toEqual(['Singapore new business · draft v2 · pins version 1.0']);
  });
  it('composes profiles by reference, with where each variable came from and what each profile narrows', () => {
    const c = composed(d, ['ilp_extension', 'nftf_extension']);
    expect(c.profiles).toEqual(['ilp_extension', 'common', 'nftf_extension']);
    expect(c.rows.find((r) => r.variable === 'product_family')).toMatchObject({ from: 'common', required: true });
    expect(c.rows.find((r) => r.variable === 'nftf')?.from).toBe('nftf_extension');
    expect(c.constraints).toEqual([{ variable: 'product_family', profile: 'ilp_extension', allowed: ['ILP'] }]);
  });
  it('is off unless its build setting is given, and is then listed under Survey Studio only', () => {
    expect(applicabilityEnabled()).toBe(false);
    const kids = (on: boolean) => navFor(true, true, on).flatMap((g) => g.items).find((i) => i.label === 'Survey Studio')!.children!.map((c) => c.label);
    expect(kids(false)).not.toContain('Survey applicability');
    expect(kids(true)).toEqual(['Home', 'Surveys', 'Building blocks', 'Survey applicability', 'Rules explorer']);
    expect(navFor(true, false, true).flatMap((g) => g.items).find((i) => i.label === 'Survey Studio')!.children).toBeUndefined();
  });
});
