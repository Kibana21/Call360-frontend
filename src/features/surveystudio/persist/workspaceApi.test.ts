import { describe, expect, it } from 'vitest';
import { branchLabel, destination, missing, ruleInWords } from './workspaceApi';

describe('UX-HOME-1 plain language for published documents', () => {
  const label = (f: string) => ({ 'customer.age_years': 'the customer’s age', 'policy.annual_premium': 'the annual premium' })[f] ?? f;
  it('writes a condition as a sentence', () => {
    expect(ruleInWords({ op: 'GTE', left: { field: 'customer.age_years' }, right: { param: 'minimum_age' } }, label)).toBe('the customer’s age is at least the value “minimum_age” supplied where it is used');
    expect(ruleInWords({ op: 'AND', args: [{ op: 'GT', left: { field: 'policy.annual_premium' }, right: { value: 12000 } }, { op: 'EQ', left: { input: 'risk_understood' }, right: { value: 'NO' } }] }, label)).toBe('the annual premium is more than 12000, and the earlier answer “risk_understood” is NO');
  });
  it('never guesses at a rule it does not recognise: it shows it as written', () => {
    const odd = { op: 'BETWEEN', of: [1, 2] };
    expect(ruleInWords(odd)).toBe(JSON.stringify(odd));
    expect(ruleInWords(null)).toBe('No rule is written.');
  });
  it('says where a branch leads and when', () => {
    const step = (n: string) => `step ${n.slice(1)}`;
    expect(destination({ node: 'n2' }, step)).toBe('step 2');
    expect(destination({ outcome: 'UNABLE_TO_VERIFY' }, step)).toBe('the module ends: unable to verify');
    expect(destination({ return: true }, step)).toBe('back to the question that asked the follow-up');
    expect(branchLabel('ANY', (c) => c)).toBe('Always, next');
    expect(branchLabel('UNKNOWN', (c) => c)).toBe('When it cannot be decided');
    expect(branchLabel('YES', () => 'Yes')).toBe('If “Yes”');
  });
  it('tells an unavailable read from a value', () => {
    expect(missing({ unavailable: 'OFF' })).toBe(true);
    expect(missing([])).toBe(false);
  });
});
