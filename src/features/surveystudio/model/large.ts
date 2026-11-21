// Survey Studio prototype — a large synthetic module (40 questions with branches, merges, two conditions, a follow-up
// queue, mandatory escalations and first-matching rules), added on request so the Graph and Guided views can be judged
// at realistic size. Illustrative wording only. Built through one operation, so adding it is one undoable step.
import type { Condition, Edge, Module, ModuleNode, Option, OutcomeCode, Question, Routing, Target, Workspace } from './types';

const TOPICS = [
  'that you are the policyholder', 'the policy you bought', 'who sold you the policy', 'the premium amount', 'how often you pay', 'the policy term',
  'what the plan covers', 'what the plan does not cover', 'the waiting period', 'the free-look period', 'how to make a claim', 'the surrender value',
  'the guaranteed benefits', 'the non-guaranteed benefits', 'the charges and fees', 'your financial needs', 'your existing policies', 'the product summary',
  'the benefit illustration', 'your health declaration', 'your nominated beneficiaries', 'anything left unclear', 'which documents you received', 'this call',
];

export function addLargeModule(ws0: Workspace): [Workspace, string] {
  const ws = structuredClone(ws0);
  const tag = ws.seq;
  const code = `M-FULL-VERIFICATION-${tag}`;
  const questions: Question[] = [];
  const nodes: ModuleNode[] = [];
  const edges: Edge[] = [];
  const YN: Option[] = [{ code: 'YES', label: 'Yes' }, { code: 'NO', label: 'No' }];
  let e = 0;
  const node = (id: string): Target => ({ node: id });
  const out = (outcome: OutcomeCode): Target => ({ outcome });
  const edge = (from: string, on: string, to: Target) => { e += 1; edges.push({ id: `e${e}`, from, on, to }); };
  const add = (k: number, answerType: Question['answerType'], text: string, routing: Routing = { mode: 'ALL_TO_NEXT' }, options: Option[] = [], extra: Partial<Question> = {}, role?: 'FOLLOWUP') => {
    const qc = `Q-FV${tag}-${String(k).padStart(2, '0')}`;
    questions.push({ code: qc, version: 1, answerType, intent: text, options: answerType === 'YES_NO' ? YN : options, wording: { version: 1, text, approval: 'SYNTHETIC_UNAPPROVED' }, published: false, ...extra });
    nodes.push({ id: `n${k}`, type: 'QUESTION', q: { code: qc, version: 1 }, routing, ...(role ? { role } : {}) });
    return qc;
  };
  const yes = (k: number) => add(k, 'YES_NO', `Did your representative explain ${TOPICS[k - 1]}?`);
  const side = (k: number, text: string, to: Target) => { add(k, 'YES_NO', text); edge(`n${k}`, 'ANY', to); };

  // ---- the spine: 24 questions, most of them simply continue ------------------------------------------------------
  const plain = [1, 2, 4, 5, 7, 8, 9, 10, 11, 13, 14, 16, 18, 19, 20, 21, 24];
  for (const k of plain) yes(k);
  for (const k of plain) if (k !== 24 && k !== 9 && k !== 19) edge(`n${k}`, 'ANY', node(`n${k + 1}`));
  edge('n24', 'ANY', out('COMPLETED'));

  // n3: a Yes/No branch that rejoins the spine
  const q3 = add(3, 'YES_NO', 'Is the premium amount what you expected?', { mode: 'PER_CHOICE', normal: 'YES' });
  edge('n3', 'YES', node('n4')); edge('n3', 'NO', node('n25'));
  side(25, 'Was the premium different from what you were first quoted?', node('n26'));
  side(26, 'Has the difference now been explained to you?', node('n4'));

  // n6: single choice; two answers MERGE into one question, a third takes a longer branch that rejoins further on
  add(6, 'SINGLE_SELECT', 'How was the policy term explained to you?', { mode: 'PER_CHOICE', normal: 'IN_PERSON' },
    [{ code: 'IN_PERSON', label: 'In person' }, { code: 'BY_PHONE', label: 'By phone' }, { code: 'IN_WRITING', label: 'In writing only' }, { code: 'NOT_EXPLAINED', label: 'It was not explained' }]);
  edge('n6', 'IN_PERSON', node('n7')); edge('n6', 'BY_PHONE', node('n27')); edge('n6', 'IN_WRITING', node('n27')); edge('n6', 'NOT_EXPLAINED', node('n28'));
  side(27, 'Did you have the chance to ask questions about the term?', node('n7'));
  side(28, 'Would you like the policy term explained now?', node('n29'));
  side(29, 'Is the policy term clear to you now?', node('n9'));

  // d1 after n9: customer details decide whether two more questions are asked
  nodes.push({ id: 'd1', type: 'DECISION', binding: { condition: { code: 'C-LARGE-COMMITMENT', version: 1 }, params: { premium_above: 12000, sum_assured_at_least: 500000 }, unknownPolicy: 'ROUTE' } });
  edge('n9', 'ANY', node('d1')); edge('d1', 'MATCH', node('n30')); edge('d1', 'NO_MATCH', node('n10')); edge('d1', 'UNKNOWN', out('UNABLE_TO_VERIFY'));
  side(30, 'Is this premium a comfortable share of your income?', node('n31'));
  side(31, 'Could you keep paying it if your income fell?', node('n10'));

  // n12: multiple choice with a follow-up queue, an exclusive answer and a mandatory escalation
  add(12, 'MULTI_SELECT', 'Which of these would you like explained again? You may choose more than one.', {
    mode: 'SEQUENTIAL_FOLLOWUPS', rejoin: node('n13'), noFollowup: ['NONE'],
    followups: [{ option: 'SURRENDER', nodes: ['n32'] }, { option: 'CLAIMS', nodes: ['n33'] }, { option: 'CHARGES', nodes: ['n34'] }],
    interrupts: [{ option: 'NEVER_AGREED', policy: 'STOP_ESCALATE', outcome: 'ESCALATE' }],
  }, [{ code: 'SURRENDER', label: 'Surrender value' }, { code: 'CLAIMS', label: 'Claims' }, { code: 'CHARGES', label: 'Charges' },
    { code: 'NEVER_AGREED', label: 'I did not agree to this policy', interrupt: 'MANDATORY' }, { code: 'NONE', label: 'None of these', exclusive: true }], { selection: { min: 1, max: 3 } });
  for (const [k, text] of [[32, 'Is the surrender value clear to you now?'], [33, 'Is the claims process clear to you now?'], [34, 'Are the charges clear to you now?']] as Array<[number, string]>) {
    add(k, 'YES_NO', text, { mode: 'ALL_TO_NEXT' }, [], {}, 'FOLLOWUP');
    edge(`n${k}`, 'ANY', { ret: true });
  }

  // n15: an answer that ends the module with a named outcome
  add(15, 'YES_NO', 'Do the charges and fees match what you were told?', { mode: 'PER_CHOICE', normal: 'YES' });
  edge('n15', 'YES', node('n16')); edge('n15', 'NO', out('CLARIFICATION_REQUIRED'));

  // n17: a mandatory escalation with no way around it, and a three-question branch
  add(17, 'SINGLE_SELECT', 'Which best describes your existing policies?', { mode: 'PER_CHOICE', normal: 'NONE_HELD' },
    [{ code: 'NONE_HELD', label: 'I have no other policy' }, { code: 'KEPT', label: 'I kept my existing policy' }, { code: 'REPLACED', label: 'I replaced an existing policy' },
      { code: 'PRESSURED', label: 'I was pressured to cancel one', interrupt: 'MANDATORY' }]);
  edge('n17', 'NONE_HELD', node('n18')); edge('n17', 'KEPT', node('n18')); edge('n17', 'REPLACED', node('n35')); edge('n17', 'PRESSURED', out('ESCALATE'));
  side(35, 'Were you told the costs of replacing your policy?', node('n36'));
  side(36, 'Were you told what cover you might lose?', node('n37'));
  side(37, 'Are you content with the replacement?', node('n18'));

  // d2 after n19: an EARLIER ANSWER (n3) decides; missing information stops for review
  const local: Condition = {
    code: `C-LOCAL-FV-${tag}`, version: 1, name: 'Rule in Full verification', shared: false, params: {},
    inputs: { in_premium: { question: { code: q3, version: 1 }, answerType: 'YES_NO', scope: 'MODULE' } },
    ast: { op: 'EQ', left: { input: 'in_premium' }, right: { literal: 'NO' } },
  };
  nodes.push({ id: 'd2', type: 'DECISION', binding: { condition: { code: local.code, version: 1 }, params: {}, inputs: { in_premium: { node: 'n3' } }, unknownPolicy: 'BLOCK' } });
  edge('n19', 'ANY', node('d2')); edge('d2', 'MATCH', node('n38')); edge('d2', 'NO_MATCH', node('n20')); edge('d2', 'UNKNOWN', out('REVIEW_REQUIRED'));
  side(38, 'Does the benefit illustration show the premium you now pay?', node('n39'));
  side(39, 'Would you like a corrected illustration sent to you?', node('n20'));

  // n22: free text; n23: first-matching-rule routing
  add(22, 'FREE_TEXT', 'Is there anything that is still unclear to you?', { mode: 'ALL_TO_NEXT' }, [], { textRule: { required: false, min: 0, max: 500 } });
  edge('n22', 'AFTER_CAPTURE', node('n23'));
  add(23, 'MULTI_SELECT', 'Which documents did you receive?', {
    mode: 'ORDERED_RULES', fallback: node('n24'),
    rules: [{ id: 'r1', kind: 'NONE', options: ['POLICY', 'SUMMARY'], to: node('n40') }, { id: 'r2', kind: 'ALL', options: ['POLICY', 'SUMMARY', 'ILLUSTRATION'], to: node('n24') }],
  }, [{ code: 'POLICY', label: 'Policy contract' }, { code: 'SUMMARY', label: 'Product summary' }, { code: 'ILLUSTRATION', label: 'Benefit illustration' }, { code: 'NOTHING', label: 'I received nothing', exclusive: true }]);
  side(40, 'Shall we send the missing documents to your address on record?', node('n24'));

  const order = (id: string) => (id.startsWith('d') ? 100 + Number(id.slice(1)) : Number(id.slice(1)));
  nodes.sort((a, b) => order(a.id) - order(b.id));
  const m: Module = {
    code, revision: 1, name: 'Full verification (40 questions)', kind: 'COMMON', intent: 'A long synthetic module for judging the builder at realistic size.', published: false, entry: 'n1',
    outcomes: ['COMPLETED', 'CLARIFICATION_REQUIRED', 'ESCALATE', 'UNABLE_TO_VERIFY', 'REVIEW_REQUIRED'], nodes, edges,
  };
  ws.questions.push(...questions);
  ws.conditions.push(local);
  ws.modules.push(m);
  ws.seq += 1;
  return [ws, `${m.code}@${m.revision}`];
}
