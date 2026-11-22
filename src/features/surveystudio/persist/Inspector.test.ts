import { describe, expect, it } from 'vitest';
import type { ComponentDetail } from './api';
import { read } from './Inspector';

// A published module as the library serves it, with the two forms of routing that are not edges: rule-ordered
// routing and sequential follow-ups. The inspector must show every one of their branches, and invent none.
const dep = (kind: string, code: string, document: Record<string, unknown>, version = 1) => ({ kind, code, version, sha256: 'x', document });
const detail = {
  kind: 'MODULE', code: 'M-T', version: 1,
  document: {
    entry: 'n1', outcomes: ['COMPLETED', 'ESCALATE', 'CLARIFICATION_REQUIRED'],
    nodes: [
      { node: 'n1', type: 'QUESTION', question: { code: 'Q-AREAS', version: 1, wording_version: 1 }, routing: { mode: 'SEQUENTIAL_FOLLOWUPS', followups: [{ option: 'PREMIUM', priority: 10, nodes: ['n-prem'] }, { option: 'BENEFITS', priority: 20, nodes: ['n-cover'] }], no_followup: ['NONE'], interrupts: [{ option: 'CRITICAL', priority: 1, outcome: 'ESCALATE' }], rejoin: { node: 'n2' }, empty_fallback: { node: 'n2' } } },
      { node: 'n-prem', type: 'QUESTION', question: { code: 'Q-PREM', version: 1, wording_version: 1 } },
      { node: 'n-cover', type: 'QUESTION', question: { code: 'Q-PREM', version: 1, wording_version: 1 } },
      { node: 'n2', type: 'QUESTION', question: { code: 'Q-CONCERNS', version: 1, wording_version: 1 }, routing: { mode: 'ORDERED_RULES', rules: [{ rule: 'r1', when: { kind: 'ALL', options: ['PREMIUM', 'BENEFITS'] }, to: { node: 'd1' } }, { rule: 'r2', when: { kind: 'ANY', options: ['PREMIUM'] }, to: { outcome: 'CLARIFICATION_REQUIRED' } }], fallback: { outcome: 'COMPLETED' } } },
      { node: 'd1', type: 'DECISION', binding: { condition: { code: 'C-OLD', version: 1 }, params: { minimum_age: 60 }, unknown_policy: 'ROUTE_UNKNOWN' } },
    ],
    edges: [
      { edge: 'e1', from: 'n-prem', on: 'ANY', to: { return: true } }, { edge: 'e2', from: 'n-cover', on: 'ANY', to: { return: true } },
      { edge: 'e3', from: 'd1', on: 'MATCH', to: { outcome: 'ESCALATE' } }, { edge: 'e4', from: 'd1', on: 'NO_MATCH', to: { outcome: 'COMPLETED' } }, { edge: 'e5', from: 'd1', on: 'UNKNOWN', to: { outcome: 'CLARIFICATION_REQUIRED' } },
    ],
  },
  dependencies: [
    dep('ITEM', 'Q-AREAS', { answer_type: 'MULTI_SELECT', option_set: { code: 'OS', version: 1 } }), dep('WORDING', 'Q-AREAS', { text: 'Which areas were unclear?' }),
    dep('ITEM', 'Q-PREM', { answer_type: 'YES_NO' }), dep('WORDING', 'Q-PREM', { text: 'Was the premium explained?' }),
    dep('ITEM', 'Q-CONCERNS', { answer_type: 'MULTI_SELECT', option_set: { code: 'OS', version: 1 } }), dep('WORDING', 'Q-CONCERNS', { text: 'Any concerns?' }),
    dep('OPTION_SET', 'OS', { options: [{ code: 'PREMIUM', label: 'The premium' }, { code: 'BENEFITS', label: 'The benefits' }, { code: 'NONE', label: 'None' }, { code: 'CRITICAL', label: 'A serious concern' }] }),
    dep('CONDITION', 'C-OLD', { name: 'Older customer', ast: { op: 'GTE', left: { field: 'customer.age_years' }, right: { param: 'minimum_age' } } }),
  ],
} as unknown as ComponentDetail;

describe('UX-HOME-1 the inspector reads a published module completely', () => {
  const { steps, arrows, outcomes, name } = read(detail);
  const from = (node: string) => arrows.filter((a) => a.from === node).map((a) => [a.label, a.to]);
  it('lists every step with its wording, kind and first step', () => {
    expect(steps.map((s) => [s.n, s.type, s.title, s.entry])).toEqual([[1, 'QUESTION', 'Which areas were unclear?', true], [2, 'QUESTION', 'Was the premium explained?', false], [3, 'QUESTION', 'Was the premium explained?', false], [4, 'QUESTION', 'Any concerns?', false], [5, 'DECISION', 'Older customer', false]]);
    expect(outcomes).toEqual(['COMPLETED', 'ESCALATE', 'CLARIFICATION_REQUIRED']);
    expect(name('d1')).toBe('step 5');
  });
  it('shows every follow-up, interruption and rejoin of a follow-up question — and marks follow-ups as such', () => {
    expect(from('n1')).toEqual([['Follow-up if “The premium”', { node: 'n-prem' }], ['Follow-up if “The benefits”', { node: 'n-cover' }], ['Stops if “A serious concern”', { outcome: 'ESCALATE' }], ['After the follow-ups', { node: 'n2' }]]);
    expect(arrows.filter((a) => a.soft).length).toBe(2);
    expect(from('n-prem')).toEqual([['Always, next', { return: true }]]);
  });
  it('shows every rule of rule-ordered routing in order, and what happens otherwise', () => {
    expect(from('n2')).toEqual([['Rule 1: all of “The premium”, “The benefits” chosen', { node: 'd1' }], ['Rule 2: any of “The premium” chosen', { outcome: 'CLARIFICATION_REQUIRED' }], ['Otherwise', { outcome: 'COMPLETED' }]]);
  });
  it('shows the three results of a decision', () => {
    expect(from('d1').map(([l]) => l)).toEqual(['When the condition is met', 'When the condition is not met', 'When it cannot be decided']);
  });
});
