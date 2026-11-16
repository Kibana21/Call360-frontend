// F6 — Script Studio, Script Detail and Assignment Rules: read-only content, synthetic labelling, server filters,
// structure order, controls kept apart from regulatory references, rule cases and S2-gated actions.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';
import { describeCondition } from './shared';

afterEach(() => vi.unstubAllGlobals());

const USER = { ...ME, roles: ['USER'], permissions: ['dashboard.read', 'case.read', 'script.read'] };
const FAM = 'f1';
const summary = (id: string, label: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, script_family_id: FAM, family: 'SALES_VERIFICATION_SG', family_name: 'Sales verification (synthetic)', market: 'SG',
  purpose: 'SALE_VERIFICATION', version_label: label, status, validation_status: 'VALID', language: 'en',
  effective_from: '2026-07-18T00:00:00Z', effective_to: null, published_at: null, manifest_sha256: status === 'DRAFT' ? null : 'a'.repeat(64),
  content_approval_status: 'SYNTHETIC_UNAPPROVED', author_ref: 'SYN-AUTHOR', reviewer_ref: 'SYN-REVIEWER', supersedes_id: null, supersedes_label: null,
  modules: [{ position: 1, module_code: 'COMMON_SALES_CONDUCT', module_name: 'Common', module_kind: 'COMMON', module_revision: 2, inclusion_condition: null, questions: 1 },
    { position: 2, module_code: 'ELEVATED_RISK', module_name: 'Elevated risk', module_kind: 'RISK', module_revision: 1, inclusion_condition: { risk_band_in: ['HIGH'] }, questions: 1 }],
  questions: 2, mandatory_questions: 1, cases_assigned: 166, rules_targeting: ['SG-SALES-VERIFY v2'], ...extra,
});
const LIB = { total: 2, markets: ['SG'], items: [summary('v10', '1.0', 'SUPERSEDED'), summary('v11', '1.1', 'PUBLISHED', { supersedes_label: '1.0' })],
  facets: { status: { PUBLISHED: 1, SUPERSEDED: 1 }, language: { en: 2 }, product_family: { ILP: 2 }, risk_band: { HIGH: 2 }, channel: {} } };
const question = (pos: number, code: string, controls: unknown[] = []) => ({
  position: pos, question_code: code, intent: `Intent ${code}`, wording: `Wording of ${code}`, revision: 1, delivery_mode: 'CONVERSATIONAL',
  answer_type: 'YES_NO', mandatory: pos === 1, expected_answer_policy: 'EXACT_BOOLEAN', expected_value: true, acceptable_variants: ['yes'],
  unacceptable_outcomes: ['NO'], policy_fact_key: null, not_applicable_predicate: null, branch_condition: null, controls, content_approval_status: 'SYNTHETIC_UNAPPROVED',
});
const DETAIL = {
  id: 'v11', script_family_id: FAM, family: 'SALES_VERIFICATION_SG', family_name: 'Sales verification (synthetic)', market: 'SG', version_label: '1.1',
  status: 'PUBLISHED', validation_status: 'VALID', language: 'en', effective_from: '2026-07-18T00:00:00Z', effective_to: null, manifest_sha256: 'a'.repeat(64),
  author_ref: null, reviewer_ref: null, published_at: null, content_approval_status: 'SYNTHETIC_UNAPPROVED',
  sections: [
    { position: 1, module_code: 'COMMON_SALES_CONDUCT', module_name: 'Common', module_kind: 'COMMON', inclusion_condition: null,
      questions: [question(1, 'Q-REP-DISCLOSED', [{ control_code: 'SYN-CTRL-01', name: 'Representative disclosure', rationale: 'r', status: 'PROPOSED',
        issuer: 'SYNTHETIC REGULATOR', title: 'Synthetic placeholder reference', document_version: null, interpretation_status: 'NOT_REVIEWED' }])] },
    { position: 2, module_code: 'ELEVATED_RISK', module_name: 'Elevated risk', module_kind: 'RISK', inclusion_condition: { risk_band_in: ['HIGH'] },
      questions: [question(1, 'Q-PRESSURE-FELT')] },
  ],
};
const RULES = { total: 2, items: [
  { id: 'r1', rule_code: 'SG-SALES-VERIFY', version: 1, status: 'SUPERSEDED', predicate: { all: [{ fact: 'market', equals: 'SG' }] }, priority: 10, specificity: 2,
    effective_from: '2026-01-19T00:00:00Z', effective_to: '2026-07-18T00:00:00Z', checksum: 'c'.repeat(64), author_ref: 'A', checker_ref: 'B', market: 'SG',
    target: { script_version_id: 'v10', script_family_id: FAM, family: 'SALES_VERIFICATION_SG', version_label: '1.0', status: 'SUPERSEDED', manifest_sha256: 'a'.repeat(64), content_approval_status: 'SYNTHETIC_UNAPPROVED' },
    target_family_id: FAM, cases_assigned: 25, recent_cases: [{ case_id: 'c1', case_ref: 'CB-2026-10001', assigned_at: '2026-02-01T00:00:00Z' }] },
  { id: 'r2', rule_code: 'SG-SALES-VERIFY', version: 2, status: 'PUBLISHED', predicate: { all: [{ fact: 'market', equals: 'SG' }, { fact: 'case_purpose', equals: 'SALE_VERIFICATION' }] },
    priority: 10, specificity: 2, effective_from: '2026-07-18T00:00:00Z', effective_to: null, checksum: 'd'.repeat(64), author_ref: 'A', checker_ref: 'B', market: 'SG',
    target: { script_version_id: 'v11', script_family_id: FAM, family: 'SALES_VERIFICATION_SG', version_label: '1.1', status: 'PUBLISHED', manifest_sha256: 'a'.repeat(64), content_approval_status: 'SYNTHETIC_UNAPPROVED' },
    target_family_id: FAM, cases_assigned: 166, recent_cases: [{ case_id: 'c2', case_ref: 'CB-2026-10200', assigned_at: '2026-08-01T00:00:00Z' }] },
] };
const base = (extra: Record<string, (r: Request) => Response> = {}) => ({
  'GET /api/v1/me': () => json(200, USER), 'GET /api/v1/controls': () => json(200, { items: [] }),
  'GET /api/v1/regulatory-references': () => json(200, { items: [] }), ...extra,
});

describe('Script Studio', () => {
  it('lists versions with synthetic labelling, server-side filters and S2-gated actions', async () => {
    const seen: string[] = [];
    stubApi(base({ 'GET /api/v1/scripts': (req) => { seen.push(new URL(req.url).search); return json(200, LIB); } }));
    renderAt(<App />, '/scripts');
    const table = await screen.findByTestId('script-library');
    expect(within(table).getByRole('link', { name: 'SALES_VERIFICATION_SG v1.1' })).toHaveAttribute('href', '/scripts/f1?version=v11');
    expect(screen.getByTestId('synthetic-script-banner')).toHaveTextContent('not approved AIA/MAS wording');
    expect(screen.getByRole('button', { name: 'New script draft' })).toBeDisabled();
    expect(screen.getByLabelText('Channel')).toBeDisabled(); // no channel-specific module exists
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'PUBLISHED');
    await waitFor(() => expect(seen.at(-1)).toContain('status=PUBLISHED'));
  });

  it('shows a version in structural order with expected answers, controls and separate regulatory references', async () => {
    stubApi(base({
      'GET /api/v1/scripts/f1': () => json(200, { id: FAM, code: 'SALES_VERIFICATION_SG', name: 'Sales verification (synthetic)', market: 'SG', purpose: 'SALE_VERIFICATION', description: null, versions: LIB.items }),
      'GET /api/v1/scripts/f1/versions': () => json(200, { script_family_id: FAM, family: 'SALES_VERIFICATION_SG', items: LIB.items }),
      'GET /api/v1/script-versions/v11': () => json(200, DETAIL),
    }));
    renderAt(<App />, '/scripts/f1');
    const history = await screen.findByTestId('version-history');
    expect(within(history).getByRole('link', { current: 'page' })).toHaveTextContent('v1.1'); // published version selected by default
    expect(await screen.findByTestId('manifest-sha')).toHaveTextContent('a'.repeat(64));
    const sections = await screen.findAllByTestId('script-section');
    expect(sections.map((s) => within(s).getByRole('heading').textContent)).toEqual(['1. Common', '2. Elevated risk']);
    expect(sections[1]).toHaveTextContent('SBQ risk band is High');
    const q = screen.getByTestId('question-Q-REP-DISCLOSED');
    expect(q).toHaveTextContent('Exact boolean');
    expect(within(q).getByTestId('question-controls')).toHaveTextContent('SYN-CTRL-01');
    expect(within(q).getByText(/Regulatory reference \(public, separate from the AIA control\)/)).toBeInTheDocument();
    for (const name of ['Edit', 'Publish', 'Approve']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'SG-SALES-VERIFY v2' })).toHaveAttribute('href', '/assignment-rules?rule=SG-SALES-VERIFY%20v2');
  });

  it('shows rule versions with readable predicates, targets and the cases they assigned; a linked rule opens', async () => {
    stubApi(base({ 'GET /api/v1/script-assignment-rules': () => json(200, RULES) }));
    renderAt(<App />, '/assignment-rules?rule=SG-SALES-VERIFY%20v2');
    const live = await screen.findByTestId('rule-SG-SALES-VERIFY-v2');
    expect(live).toHaveAttribute('open');
    expect(screen.getByTestId('rule-SG-SALES-VERIFY-v1')).not.toHaveAttribute('open');
    expect(live).toHaveTextContent('Market is SG and Case purpose is Sale verification');
    expect(within(live).getByRole('link', { name: 'SALES_VERIFICATION_SG v1.1' })).toHaveAttribute('href', '/scripts/f1?version=v11');
    expect(within(live).getByRole('link', { name: 'CB-2026-10200' })).toHaveAttribute('href', '/cases/c2');
    expect(screen.getByTestId('rule-SG-SALES-VERIFY-v1')).toHaveTextContent('Historical');
    expect(screen.getByRole('button', { name: 'Test assignment' })).toBeDisabled();
  });

  it('describes stored conditions without evaluating them', () => {
    expect(describeCondition(null)).toBe('Always included');
    expect(describeCondition({ fact: 'is_ilp', equals: true })).toBe('Is ILP is yes');
    expect(describeCondition({ any: [{ risk_band_in: ['HIGH', 'MEDIUM'] }] })).toBe('(SBQ risk band is High or Medium)');
  });
});
