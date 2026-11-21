// F6 + S2-A — Script Studio, Script Detail and Assignment Rules: synthetic labelling, server filters, structure order,
// controls kept apart from regulatory references, rule cases; S2-A authoring (new script, draft editing with the
// row-version token, validation, submit) and the maker-checker review panel.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { json, ME, renderAt, stubApi } from '../../test/render';
import { compareLabels, describeCondition } from './shared';
import { ruleSummary } from './ScriptEditor';

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
  module_question_id: `mq-${code}`, question_bank_item_id: `qb-${code}`, category: 'SALES_CONDUCT', answer_schema: { type: 'yes_no' },
  evidence_required: true, max_reprompts: 1, escalation_rule_ref: null,
});
const sec = (position: number, code: string, name: string, kind: string, cond: unknown, questions: unknown[], status = 'PUBLISHED') => ({
  position, module_code: code, module_name: name, module_kind: kind, inclusion_condition: cond, questions,
  section_id: `s-${code}`, module_id: `m-${code}`, module_revision: 1, module_status: status,
});
const DETAIL = {
  id: 'v11', script_family_id: FAM, family: 'SALES_VERIFICATION_SG', family_name: 'Sales verification (synthetic)', market: 'SG', version_label: '1.1',
  status: 'PUBLISHED', validation_status: 'VALID', language: 'en', effective_from: '2026-07-18T00:00:00Z', effective_to: null, manifest_sha256: 'a'.repeat(64),
  author_ref: null, reviewer_ref: null, published_at: null, content_approval_status: 'SYNTHETIC_UNAPPROVED',
  sections: [
    sec(1, 'COMMON_SALES_CONDUCT', 'Common', 'COMMON', null, [question(1, 'Q-REP-DISCLOSED', [{ control_code: 'SYN-CTRL-01', name: 'Representative disclosure', rationale: 'r', status: 'PROPOSED',
      issuer: 'SYNTHETIC REGULATOR', title: 'Synthetic placeholder reference', document_version: null, interpretation_status: 'NOT_REVIEWED' }])]),
    sec(2, 'ELEVATED_RISK', 'Elevated risk', 'RISK', { risk_band_in: ['HIGH'] }, [question(1, 'Q-PRESSURE-FELT')]),
  ],
  row_version: 3, supersedes_id: null, supersedes_label: null, makers: ['SYN-AUTHOR'], controls_source: 'LIVE', people: {},
};
const OPTIONS = {
  controls: [{ id: 'c1', code: 'SYN-CTRL-01', label: 'Representative disclosure' }], regulatory_references: [{ id: 'rr1', code: 'p-1', label: 'Synthetic placeholder' }],
  condition_facts: { product_family: ['PROTECTION', 'ILP', 'ENDOWMENT'], is_ilp: [true, false] }, risk_bands: ['LOW', 'MEDIUM', 'HIGH'],
  fact_keys: { premium_term_years: 'Premium term' }, categories: ['SALES_CONDUCT', 'OTHER'], delivery_modes: ['CONVERSATIONAL', 'CONTROLLED_TTS', 'EXACT_AUDIO'],
  answer_types: ['YES_NO', 'NUMERIC', 'ENUM', 'FREE_TEXT', 'ACKNOWLEDGEMENT'], expected_answer_policies: ['EXACT_BOOLEAN', 'COLLECT_ONLY'],
  module_kinds: ['COMMON', 'PRODUCT', 'RISK', 'LANGUAGE'], published_modules: [{ id: 'm-ILP', code: 'ILP', revision: 1, name: 'Investment-linked', kind: 'PRODUCT', questions: 4 }],
};
const familyRoutes = (detail: unknown, items = LIB.items) => ({
  'GET /api/v1/scripts/f1': () => json(200, { id: FAM, code: 'SALES_VERIFICATION_SG', name: 'Sales verification (synthetic)', market: 'SG', purpose: 'SALE_VERIFICATION', description: null, versions: items }),
  'GET /api/v1/scripts/f1/versions': () => json(200, { script_family_id: FAM, family: 'SALES_VERIFICATION_SG', items }),
  'GET /api/v1/script-versions/v11': () => json(200, detail),
  'GET /api/v1/script-authoring/options': () => json(200, OPTIONS),
});
const base = (extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) => ({
  'GET /api/v1/me': () => json(200, USER), 'GET /api/v1/controls': () => json(200, { items: [] }),
  'GET /api/v1/regulatory-references': () => json(200, { items: [] }), ...extra,
});

describe('Script Studio', () => {
  it('lists versions with synthetic labelling, server-side filters and S2-gated actions', async () => {
    const seen: string[] = [];
    stubApi(base({ 'GET /api/v1/scripts': (req) => { seen.push(new URL(req.url).search); return json(200, LIB); } }));
    renderAt(<App />, '/scripts');
    const table = await screen.findByTestId('script-library');
    expect(within(table).getByRole('link', { name: /^SALES_VERIFICATION_SG v1\.1 / })).toHaveAttribute('href', '/scripts/f1?version=v11');
    expect(screen.getByTestId('synthetic-script-banner')).toHaveTextContent('not approved AIA/MAS wording');
    expect(screen.queryByRole('button', { name: 'New script' })).toBeNull(); // no script.edit: no authoring
    expect(screen.getByLabelText('Channel')).toBeDisabled(); // no channel-specific module exists
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'PUBLISHED');
    await waitFor(() => expect(seen.at(-1)).toContain('status=PUBLISHED'));
  });

  it('shows a version in structural order with expected answers, controls and separate regulatory references', async () => {
    stubApi(base(familyRoutes(DETAIL)));
    renderAt(<App />, '/scripts/f1');
    expect(await screen.findByTestId('version-picker')).toHaveValue('v11'); // published version selected by default
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sales verification (synthetic)');
    const sections = await screen.findAllByTestId('script-section');
    expect(sections.map((s) => within(s).getByRole('heading').textContent)).toEqual(['1. Common', '2. Elevated risk']);
    expect(sections[1]).toHaveTextContent('SBQ risk band is High');
    const q = screen.getByTestId('question-Q-REP-DISCLOSED');
    expect(q).toHaveTextContent('Expected yes / no');
    expect(within(q).getByTestId('question-controls')).toHaveTextContent('SYN-CTRL-01');
    expect(within(q).getByText(/Regulatory reference \(public, separate from the AIA control\)/)).toBeInTheDocument();
    expect(screen.getByTestId('immutable-note')).toHaveTextContent('Immutable version');
    expect(screen.queryByTestId('draft-editor')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New draft version' })).toBeNull(); // no script.edit
    expect(screen.getByRole('link', { name: 'SG-SALES-VERIFY v2' })).toHaveAttribute('href', '/assignment-rules?rule=SG-SALES-VERIFY%20v2');
    // S2-A.2: versions and technical details sit behind their own tabs.
    expect(screen.queryByTestId('version-history')).toBeNull();
    await userEvent.click(screen.getByTestId('sv-tab-versions'));
    const history = await screen.findByTestId('version-history');
    expect(within(history).getAllByRole('link').map((l) => l.textContent?.slice(0, 4))).toEqual(['v1.1', 'v1.0']); // newest first
    expect(within(history).getByRole('link', { current: 'page' })).toHaveTextContent('v1.1');
    await userEvent.click(screen.getByTestId('sv-tab-details'));
    expect(await screen.findByTestId('manifest-sha')).toHaveTextContent('a'.repeat(64));
  });

  it('S2-A.2: groups the library into one card per script with the version in use first', async () => {
    stubApi(base({ 'GET /api/v1/scripts': () => json(200, LIB) }));
    renderAt(<App />, '/scripts');
    const list = await screen.findByTestId('script-library');
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(1); // two versions, one script
    expect(within(cards[0]!).getByRole('heading', { level: 3 })).toHaveTextContent('Sales verification (synthetic)');
    expect(within(cards[0]!).getByRole('link', { name: 'Sales verification (synthetic)' })).toHaveAttribute('href', '/scripts/f1?version=v11');
    expect(cards[0]).toHaveTextContent('In use: v1.1');
    expect(within(cards[0]!).getAllByRole('link', { name: /^SALES_VERIFICATION_SG v/ }).map((l) => l.textContent))
      .toEqual(['SALES_VERIFICATION_SG v1.1 Published', 'SALES_VERIFICATION_SG v1.0 Superseded']); // name includes the visible status
    expect(screen.getByTestId('controls-and-references')).not.toHaveAttribute('open'); // folded away by default
  });

  it('S2-A.2: orders version labels numerically', () => {
    expect(['1.9', '1.10', '1.0', '2.0'].sort(compareLabels)).toEqual(['1.0', '1.9', '1.10', '2.0']);
  });

  it('creates a script and edits a draft with the row-version token, then validates and submits it (author)', async () => {
    const posts: Array<[string, unknown]> = [];
    const AUTHOR = { ...USER, permissions: [...USER.permissions, 'script.edit'] };
    const draft = { ...DETAIL, status: 'DRAFT', manifest_sha256: null, validation_status: 'NOT_VALIDATED', row_version: 7, makers: [ME.principal.principal_id] };
    const items = [summary('v11', '1.1', 'DRAFT')];
    const record = (status = 200, body: unknown = { script_version_id: 'v11', row_version: 8 }) => async (r: Request) => {
      posts.push([`${r.method} ${new URL(r.url).pathname}`, await r.json().catch(() => null)]);
      return json(status, body);
    };
    stubApi(base({
      'GET /api/v1/me': () => json(200, AUTHOR), ...familyRoutes(draft, items),
      'POST /api/v1/script-versions/v11/sections': record(),
      'POST /api/v1/script-versions/v11/validate': record(200, { script_version_id: 'v11', validation_status: 'VALID', issues: [{ severity: 'WARNING', code: 'NO_CONTROL', message: 'Q-PRESSURE-FELT is mandatory but linked to no control' }] }),
      'POST /api/v1/script-versions/v11/submit': record(422, { code: 'STALE_DRAFT', message: 'This draft was changed by someone else; reload it before editing', correlation_id: null, retryable: false }),
    }));
    renderAt(<App />, '/scripts/f1?version=v11');
    expect(await screen.findByTestId('draft-editor')).toHaveTextContent('You are editing draft v1.1');
    await userEvent.click(screen.getByTestId('add-section'));
    await userEvent.click(screen.getByTestId('sec-reuse'));
    await userEvent.selectOptions(screen.getByLabelText('Published module'), 'm-ILP');
    await userEvent.click(screen.getByTestId('cond-add-sec-cond'));
    await userEvent.selectOptions(screen.getByLabelText('Condition 1 fact'), 'is_ilp');
    await userEvent.click(screen.getByTestId('add-section-save'));
    await waitFor(() => expect(posts[0]?.[0]).toBe('POST /api/v1/script-versions/v11/sections'));
    expect(posts[0]![1]).toEqual({ expected_row_version: 7, module_id: 'm-ILP', inclusion_condition: { fact: 'is_ilp', equals: true } });
    await userEvent.click(screen.getByTestId('validate'));
    expect(await screen.findByTestId('validation-issues')).toHaveTextContent('Q-PRESSURE-FELT is mandatory but linked to no control');
    await userEvent.type(screen.getByLabelText('Change summary for the reviewer'), 'Added the ILP module');
    await userEvent.click(screen.getByTestId('submit-review'));
    expect(await screen.findAllByTestId('editor-error')).not.toHaveLength(0);
    expect(screen.getAllByTestId('editor-error').at(-1)).toHaveTextContent('changed by someone else');
  });

  it('lets a different checker approve, and tells a maker who is also a checker that they cannot', async () => {
    const CHECKER = { ...USER, permissions: [...USER.permissions, 'script.approve', 'script.publish'] };
    const submitted = { ...DETAIL, status: 'SUBMITTED_FOR_REVIEW', makers: ['someone-else'] };
    const items = [summary('v11', '1.1', 'SUBMITTED_FOR_REVIEW')];
    let body: unknown = null;
    stubApi(base({ 'GET /api/v1/me': () => json(200, CHECKER), ...familyRoutes(submitted, items),
      'POST /api/v1/script-versions/v11/review': () => json(200, { script_version_id: 'v11', status: 'APPROVED', manifest_sha256: 'a'.repeat(64), issues: [] }),
    }));
    const realFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const req = input instanceof Request ? input : new Request(new URL(String(input), 'http://localhost'), init);
      if (req.method === 'POST') body = await req.clone().json();
      return realFetch(req);
    });
    const { unmount } = renderAt(<App />, '/scripts/f1?version=v11');
    await userEvent.click(await screen.findByTestId('sv-tab-review'));
    await userEvent.type(screen.getByLabelText('Reviewer reason'), 'Structure and expectations reviewed');
    await userEvent.click(screen.getByTestId('approve'));
    await waitFor(() => expect(body).toEqual({ decision: 'APPROVE', reason: 'Structure and expectations reviewed', acknowledged_unmapped_mandatory: [] }));
    unmount();
    stubApi(base({ 'GET /api/v1/me': () => json(200, CHECKER), ...familyRoutes({ ...submitted, makers: [ME.principal.principal_id] }, items) }));
    renderAt(<App />, '/scripts/f1?version=v11');
    await userEvent.click(await screen.findByTestId('sv-tab-review'));
    expect(screen.getByTestId('maker-note')).toHaveTextContent('another S&C checker must review and publish it');
    expect(screen.queryByTestId('approve')).toBeNull();
  });

  it('configures lifecycle items within the system-enforced gate policies (S2-D.1)', async () => {
    const posts: unknown[] = [];
    const AUTHOR = { ...USER, permissions: [...USER.permissions, 'script.edit'] };
    const LIFE = { stages: ['OPENING', 'IDENTITY', 'DISCLOSURE', 'CONSENT', 'VERIFICATION', 'CLOSING'], kind_stage: { IDENTITY: 'IDENTITY', COMMON: 'VERIFICATION' }, events: {}, assumptions: ['synthetic'],
      roles: [{ role: 'IDENTITY_CHECK', stage: 'IDENTITY', answer_types: ['YES_NO'], on_failure: ['TERMINATE'], default_on_failure: 'TERMINATE', statement: false },
        { role: 'RECORDING_CONSENT', stage: 'CONSENT', answer_types: ['YES_NO'], on_failure: ['CONTINUE_WITHOUT_RECORDING', 'TERMINATE'], default_on_failure: 'CONTINUE_WITHOUT_RECORDING', statement: false },
        { role: 'VERIFICATION', stage: 'VERIFICATION', answer_types: ['YES_NO', 'NUMERIC', 'ENUM', 'FREE_TEXT', 'ACKNOWLEDGEMENT'], on_failure: ['CONTINUE', 'TERMINATE'], default_on_failure: 'CONTINUE', statement: false }] };
    const draft = { ...DETAIL, status: 'DRAFT', manifest_sha256: null, validation_status: 'NOT_VALIDATED', row_version: 7, makers: [ME.principal.principal_id],
      sections: [sec(1, 'SYN_ID', 'Identity (synthetic)', 'IDENTITY', null, [], 'DRAFT')] };
    stubApi(base({
      'GET /api/v1/me': () => json(200, AUTHOR), ...familyRoutes(draft, [summary('v11', '1.1', 'DRAFT')]),
      'GET /api/v1/script-authoring/options': () => json(200, { ...OPTIONS, module_kinds: [...OPTIONS.module_kinds, 'IDENTITY'], lifecycle: LIFE }),
      'POST /api/v1/script-versions/v11/sections/s-SYN_ID/questions': async (r) => { posts.push(await r.json()); return json(200, { script_version_id: 'v11', row_version: 8 }); },
    }));
    renderAt(<App />, '/scripts/f1?version=v11');
    await userEvent.click(await screen.findByTestId('add-question'));
    const lifecycle = await screen.findByTestId('lifecycle-fields');
    expect(screen.getByTestId('q-role')).toHaveValue('IDENTITY_CHECK'); // the section's stage sets the default role
    expect(screen.getByTestId('q-on-failure')).toBeDisabled(); // identity failure always terminates
    expect(lifecycle).toHaveTextContent('System-enforced');
    expect(screen.getByTestId('q-discloses')).toBeDisabled(); // no policy information in the identity stage
    expect(screen.getByLabelText('Answer type')).toHaveDisplayValue('Yes no');
    await userEvent.type(screen.getByLabelText('Question code'), 'Q-SYN-ID-NAME');
    await userEvent.type(screen.getByLabelText(/Exact customer wording/), '[Synthetic] Am I speaking with the policy owner?');
    await userEvent.type(screen.getByLabelText(/Intent/), 'Synthetic identity check');
    await userEvent.click(screen.getByTestId('question-save'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect((posts[0] as { content: Record<string, unknown> }).content).toMatchObject({ lifecycle_role: 'IDENTITY_CHECK', on_failure: 'TERMINATE', answer_type: 'YES_NO', discloses_policy_information: false });
  });

  it('configures a structured evaluation rule: policy fact, unit, approved tolerance and its reference (S3-A)', async () => {
    const posts: unknown[] = [];
    const AUTHOR = { ...USER, permissions: [...USER.permissions, 'script.edit'] };
    const EVAL = { operators: { EQ: 'equal to', GTE: 'at least' }, units: { YEARS: 'years', MONTHS: 'months', SGD: 'SGD' }, note: 'No tolerance or threshold is assumed.',
      facts: { premium_term_years: { kind: 'NUMERIC', unit: 'YEARS', units: ['YEARS', 'MONTHS'], label: 'Premium term' }, premium_frequency: { kind: 'ENUM', values: ['ANNUAL'], label: 'Frequency' } } };
    const draft = { ...DETAIL, status: 'DRAFT', manifest_sha256: null, validation_status: 'NOT_VALIDATED', row_version: 7, makers: [ME.principal.principal_id],
      sections: [sec(1, 'SYN_CORE', 'Core (synthetic)', 'COMMON', null, [], 'DRAFT')] };
    stubApi(base({
      'GET /api/v1/me': () => json(200, AUTHOR), ...familyRoutes(draft, [summary('v11', '1.1', 'DRAFT')]),
      'GET /api/v1/script-authoring/options': () => json(200, { ...OPTIONS, evaluation: EVAL }),
      'POST /api/v1/script-versions/v11/sections/s-SYN_CORE/questions': async (r) => { posts.push(await r.json()); return json(200, { script_version_id: 'v11', row_version: 8 }); },
    }));
    renderAt(<App />, '/scripts/f1?version=v11');
    await userEvent.click(await screen.findByTestId('add-question'));
    await userEvent.selectOptions(await screen.findByLabelText('Answer type'), 'NUMERIC');
    expect(screen.getByTestId('q-method')).toHaveValue('NUMERIC_MATCH_POLICY_FACT');
    await userEvent.selectOptions(screen.getByTestId('q-fact'), 'premium_term_years');
    expect(screen.getByTestId('q-fact')).not.toHaveTextContent('premium_frequency'); // only numeric facts for a numeric rule
    await userEvent.selectOptions(screen.getByTestId('q-unit'), 'MONTHS');
    await userEvent.clear(screen.getByTestId('q-tolerance'));
    await userEvent.type(screen.getByTestId('q-tolerance'), '1');
    await userEvent.type(await screen.findByTestId('q-tolerance-ref'), 'SYN-TOL-1');
    expect(screen.getByTestId('evaluation-fields')).toHaveTextContent('No tolerance or threshold is assumed');
    await userEvent.type(screen.getByLabelText('Question code'), 'Q-SYN-TERM');
    await userEvent.type(screen.getByLabelText(/Exact customer wording/), '[Synthetic] For how many months will you pay premiums?');
    await userEvent.type(screen.getByLabelText(/Intent/), 'Synthetic premium term');
    await userEvent.click(screen.getByTestId('question-save'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect((posts[0] as { content: Record<string, unknown> }).content).toMatchObject({ expected_answer_policy: 'NUMERIC_MATCH_POLICY_FACT', policy_fact_key: 'premium_term_years',
      evaluation: { operator: 'EQ', unit: 'MONTHS', tolerance: '1', tolerance_reference: 'SYN-TOL-1', value: null } });
    expect(ruleSummary({ expected_answer_policy: 'NUMERIC_COMPARE', policy_fact_key: null, expected_value: { operator: 'GTE', value: '18', unit: 'COUNT', tolerance: '0' } })).toBe('Expected ≥ 18 COUNT');
  });

  it('describes stored conditions without evaluating them', () => {
    expect(describeCondition(null)).toBe('Always included');
    expect(describeCondition({ fact: 'is_ilp', equals: true })).toBe('Is ILP is yes');
    expect(describeCondition({ any: [{ risk_band_in: ['HIGH', 'MEDIUM'] }] })).toBe('(SBQ risk band is High or Medium)');
  });
});
