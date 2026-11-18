// S3-B: Finding Rules (governed rule editor with trigger-specific categories and required severity justification;
// checker review shown only to a non-maker) and simulated findings (grouped by category and severity, controls or
// "no control mapped", human-assessment items, outcomes not converted, replay).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';
import { RunFindings } from '../simulator/RunFindings';

afterEach(() => vi.unstubAllGlobals());

const T = '2026-11-18T10:00:00Z';
const AUTHOR = { ...ME, roles: ['USER'], permissions: ['dashboard.read', 'case.read', 'script.read', 'script.edit', 'script.simulate'] };
const CHECKER = { ...ME, roles: ['SC_CHECKER'], permissions: ['dashboard.read', 'script.read', 'script.approve', 'script.publish'] };
const OPTIONS = {
  engine: 'call360.finding-engine/1', triggers: ['MISMATCH', 'UNRESOLVED', 'HUMAN_ASSESSMENT_REQUIRED'],
  trigger_class: { MISMATCH: 'CUSTOMER_DISCREPANCY', UNRESOLVED: 'MISSING_EVIDENCE', HUMAN_ASSESSMENT_REQUIRED: 'HUMAN_ASSESSMENT' },
  class_labels: {}, categories: ['FACT_MISMATCH', 'MISSING_MANDATORY_ANSWER', 'NARRATIVE_REVIEW'],
  trigger_categories: { MISMATCH: ['FACT_MISMATCH'], UNRESOLVED: ['MISSING_MANDATORY_ANSWER'], HUMAN_ASSESSMENT_REQUIRED: ['NARRATIVE_REVIEW'] },
  severities: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], scopes: ['QUESTION', 'CONTROL', 'ANY_QUESTION'],
  controls: [{ code: 'SYN-CTRL-04', label: 'Premium term' }], questions: [{ code: 'Q-EVD-TERM', label: 'Term' }], note: 'n',
};
const set = (status: string, rules: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  id: 'v1', market_code: 'SG', version_no: 1, label: `SG finding rules v1 (${status.toLowerCase()})`, status, rules_count: rules.length, rules_sha256: 'a'.repeat(64),
  change_summary: null, created_at: T, published_at: null, created_by_name: 'Ops', row_version: 3, rules, content_approval_status: 'SYNTHETIC_UNAPPROVED',
  reviewed_by_name: null, review_reason: null, i_am_maker: true, diff_vs_published: null, warnings: [], history: [{ action: 'CREATED', reason: null, details: {}, occurred_at: T, actor_name: 'Ops' }],
  note: 'Synthetic', ...extra,
});
const RULE = { rule_code: 'FR-TERM-MISMATCH', scope: 'QUESTION', target: 'Q-EVD-TERM', mandatory_only: false, trigger: 'MISMATCH', category: 'FACT_MISMATCH',
  description: 'Premium term differs from the policy', severity: 'HIGH', severity_justification: 'Synthetic example severity', review_required: true, finding_class: 'CUSTOMER_DISCREPANCY', text: 'x' };

describe('Finding Rules', () => {
  it('adds a rule with governed values and a required severity justification, then submits', async () => {
    const puts: unknown[] = [];
    let current = set('DRAFT');
    stubApi({
      'GET /api/v1/me': () => json(200, AUTHOR), 'GET /api/v1/finding-rule-sets/options': () => json(200, OPTIONS),
      'GET /api/v1/finding-rule-sets': () => json(200, { items: [current], published_id: null, note: 'n' }),
      'GET /api/v1/finding-rule-sets/v1': () => json(200, current),
      'PUT /api/v1/finding-rule-sets/v1': async (r) => { puts.push(await r.json()); current = set('DRAFT', [RULE], { row_version: 4 }); return json(200, current); },
    });
    renderAt(<App />, '/finding-rules');
    expect(await screen.findByTestId('frs-banner')).toHaveTextContent('never a breach determination');
    await userEvent.click(await screen.findByTestId('frs-add-rule'));
    await userEvent.clear(screen.getByTestId('frs-f-code'));
    await userEvent.type(screen.getByTestId('frs-f-code'), 'fr-term-mismatch');
    await userEvent.selectOptions(screen.getByTestId('frs-f-question'), 'Q-EVD-TERM');
    await userEvent.selectOptions(screen.getByTestId('frs-f-trigger'), 'HUMAN_ASSESSMENT_REQUIRED');
    expect(screen.getByTestId('frs-f-category')).toHaveValue('NARRATIVE_REVIEW'); // categories follow the trigger
    expect(screen.getByTestId('frs-f-review')).toBeDisabled(); // human assessment always needs review
    await userEvent.selectOptions(screen.getByTestId('frs-f-trigger'), 'MISMATCH');
    expect(within(screen.getByTestId('frs-f-category')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Fact mismatch']);
    await userEvent.selectOptions(screen.getByTestId('frs-f-severity'), 'HIGH');
    await userEvent.type(screen.getByTestId('frs-f-justification'), 'Synthetic example severity');
    await userEvent.type(screen.getByTestId('frs-f-description'), 'Premium term differs from the policy');
    await userEvent.click(screen.getByTestId('frs-f-save'));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ expected_row_version: 3, rules: [{ rule_code: 'FR-TERM-MISMATCH', scope: 'QUESTION', target: 'Q-EVD-TERM', trigger: 'MISMATCH',
      category: 'FACT_MISMATCH', severity: 'HIGH', severity_justification: 'Synthetic example severity' }] });
    expect(await screen.findByTestId('frs-rule-FR-TERM-MISMATCH')).toHaveTextContent('Customer discrepancy');
  });

  it('shows review controls only to a checker who did not author the version', async () => {
    stubApi({
      'GET /api/v1/me': () => json(200, CHECKER), 'GET /api/v1/finding-rule-sets/options': () => json(200, OPTIONS),
      'GET /api/v1/finding-rule-sets': () => json(200, { items: [set('SUBMITTED_FOR_REVIEW', [RULE])], published_id: null, note: 'n' }),
      'GET /api/v1/finding-rule-sets/v1': () => json(200, set('SUBMITTED_FOR_REVIEW', [RULE], { i_am_maker: false })),
    });
    renderAt(<App />, '/finding-rules');
    expect(await screen.findByTestId('frs-approve')).toBeVisible();
    expect(screen.queryByTestId('frs-add-rule')).toBeNull(); // checkers cannot edit
  });
});

describe('Simulated findings', () => {
  it('groups findings by category and severity with controls, evidence, human assessment and unconverted outcomes', async () => {
    const finding = (q: string, cat: string, sev: string, cls: string, controls: unknown[] = []) => ({
      finding_key: `${q}-key`.padEnd(64, '0'), question_code: q, revision: 1, question_revision_id: `rev-${q}`, trigger: 'MISMATCH', finding_class: cls, category: cat, severity: sev,
      severity_justification: 'Synthetic example severity', severity_source: 'Finding rule FR-X in rule set SG finding rules v1', review_required: true,
      description: `Synthetic ${q}`, explanation: `${q} was evaluated mismatch; rule FR-X applies because its rule targets ${q}. Customer discrepancy, not a breach determination.`,
      controls, control_unmapped: !controls.length, rule: { rule_code: 'FR-X', text: 'FR-X: …', rule_set: { label: 'SG finding rules v1', sha256: 'b'.repeat(64), status: 'PUBLISHED' } },
      evidence: { execution_ref: 'SIM-1/EVL-1', answer: { value: 10 }, expected: { value: '15' }, evaluation_result: 'MISMATCH', fact_source: { kind: 'POLICY_FACT_SNAPSHOT' } }, engine: 'call360.finding-engine/1',
    });
    const FS = { id: 's1', finding_set_ref: 'FGS-0001', rule_set_label: 'SG finding rules v1', rule_set_status: 'PUBLISHED', rule_set_current_status: 'PUBLISHED',
      summary: { findings: 2, by_class: { CUSTOMER_DISCREPANCY: 2 }, review_required: 2 }, created_at: T, created_by_name: 'Ops', evaluation_id: 'e1', evaluation_ref: 'EVL-0001',
      rule_set_version_id: 'v1', rule_set_sha256: 'b'.repeat(64), engine_version: 'call360.finding-engine/1', input_sha256: 'c'.repeat(64),
      findings: [finding('Q-EVD-TERM', 'FACT_MISMATCH', 'HIGH', 'CUSTOMER_DISCREPANCY', [{ control_code: 'SYN-CTRL-04', control_name: 'Premium term', mapping_status: 'PROPOSED' }]),
        finding('Q-EVD-FREQ', 'FACT_MISMATCH', 'MEDIUM', 'CUSTOMER_DISCREPANCY')],
      not_converted: [{ question_code: 'Q-EVD-AGE', result: 'MISMATCH', reason: 'No rule in finding rule set SG finding rules v1 applies; no finding is generated' }],
      human_assessment: [{ question_code: 'Q-EVD-EXPLAIN', explanation: 'Free-text answer captured' }], replay: { matches: true, detail: 'identical findings' }, created: true, note: 'Simulation only' };
    let items: unknown[] = [];
    stubApi({
      'GET /api/v1/me': () => json(200, AUTHOR),
      'GET /api/v1/finding-rule-sets': () => json(200, { items: [], published_id: 'v1', note: 'n' }),
      'GET /api/v1/script-simulations/r1/evaluations/e1/findings': () => json(200, { items }),
      'POST /api/v1/script-simulations/r1/evaluations/e1/findings': () => { items = [FS]; return json(200, FS); },
      'GET /api/v1/script-simulations/r1/finding-sets/s1': () => json(200, FS),
    });
    renderAt(<RunFindings runId="r1" evaluationId="e1" canGenerate />, '/simulator');
    expect(await screen.findByTestId('sim-findings-none-yet')).toBeVisible();
    await userEvent.click(screen.getByTestId('sim-generate-findings'));
    expect(await screen.findByTestId('sim-findings-summary')).toHaveTextContent('2 findings');
    const cat = screen.getByTestId('findings-cat-FACT_MISMATCH');
    expect(cat).toHaveTextContent('HIGH 1');
    expect(cat).toHaveTextContent('MEDIUM 1');
    expect(screen.getByTestId('finding-controls-Q-EVD-TERM')).toHaveTextContent('SYN-CTRL-04 Premium term (proposed mapping)');
    expect(screen.getByTestId('finding-controls-Q-EVD-FREQ')).toHaveTextContent('No control mapped');
    expect(screen.getByTestId('finding-Q-EVD-TERM')).toHaveTextContent('not a breach determination');
    expect(screen.getByTestId('findings-human')).toHaveTextContent('Q-EVD-EXPLAIN');
    expect(screen.getByTestId('findings-not-converted')).toHaveTextContent('Q-EVD-AGE');
    expect(screen.getByTestId('sim-findings-replay')).toHaveTextContent('Reproduced');
  });
});
