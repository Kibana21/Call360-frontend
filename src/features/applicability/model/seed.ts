// The synthetic starting workspace of the prototype. Every name, value and survey here is an illustration: ILP, NFTF,
// replacement and riders are NOT approved business definitions, and a source is marked MAPPED only where today's fact
// snapshot really carries the value (specs 55_APP-1 §2–3). Nothing here is saved to Call360.
import type { Condition, Data, Expr, Policy, Profile, Requirement, Scenario, SurveyRef, Variable } from './types';

const v = (x: Omit<Variable, 'markets' | 'version' | 'status'> & Partial<Variable>): Variable => ({ markets: ['SG'], version: 1, status: 'PUBLISHED', ...x });
const SNAP = 'Policy fact snapshot';
export const VARIABLES: Variable[] = [
  v({ code: 'market', name: 'Market', description: 'The market the application belongs to.', category: 'Application', type: 'ENUM', values: [{ value: 'SG', label: 'Singapore' }], source: { status: 'MAPPED', system: SNAP, field: 'facts.market' }, owner: 'Standards & Compliance', samples: ['SG'] }),
  v({ code: 'product_family', name: 'Product family', description: 'The broad kind of product that was sold.', category: 'Product', type: 'ENUM', values: [{ value: 'ILP', label: 'Investment-linked' }, { value: 'PROTECTION', label: 'Protection' }, { value: 'ENDOWMENT', label: 'Endowment' }], source: { status: 'MAPPED', system: SNAP, field: 'facts.product_family' }, owner: 'Product', samples: ['ILP', 'PROTECTION'] }),
  v({ code: 'is_ilp', name: 'Is ILP', description: 'Yes when the product family is investment-linked. Worked out from Product family; nobody enters it.', category: 'Product', type: 'BOOLEAN', source: { status: 'DERIVED', note: 'Derived from Product family' }, derived: { expr: { op: 'test', variable: 'product_family', operator: 'equals', value: 'ILP' } }, samples: [true] }),
  v({ code: 'selected_riders', name: 'Selected riders', description: 'Riders added to the base plan.', category: 'Product', type: 'MULTI_ENUM', values: [{ value: 'CI', label: 'Critical illness' }, { value: 'WOP', label: 'Waiver of premium' }, { value: 'HOSP', label: 'Hospital cash' }], source: { status: 'UNMAPPED', note: 'No rider data exists in Call360 today.' }, samples: [['CI']] }),
  v({ code: 'sales_channel', name: 'Sales channel', description: 'How the sale was made.', category: 'Sale', type: 'ENUM', values: [{ value: 'AGENCY', label: 'Agency' }, { value: 'BANCASSURANCE', label: 'Bancassurance' }, { value: 'BROKER', label: 'Broker' }, { value: 'DIRECT', label: 'Direct' }], source: { status: 'MAPPED', system: SNAP, field: 'facts.selling_channel' }, owner: 'Distribution', samples: ['AGENCY'] }),
  v({ code: 'nftf', name: 'NFTF applies', description: 'Illustrative. What NFTF means, and where it comes from, has not been defined or approved.', category: 'Sale', type: 'BOOLEAN', source: { status: 'UNMAPPED', note: 'No definition and no source yet.' }, samples: [true, false] }),
  v({ code: 'replacement', name: 'Replacement applies', description: 'The sale replaces an existing policy.', category: 'Sale', type: 'BOOLEAN', source: { status: 'PROPOSED', system: 'Sale event', field: 'sale_event_type = REPLACEMENT', note: 'The sale type exists; the mapping is not approved and the replaced policy is not recorded.' }, samples: [false] }),
  v({ code: 'premium_frequency', name: 'Premium frequency', description: 'How often the premium is paid.', category: 'Premium', type: 'ENUM', values: [{ value: 'SINGLE', label: 'Single' }, { value: 'MONTHLY', label: 'Monthly' }, { value: 'ANNUAL', label: 'Annual' }], source: { status: 'MAPPED', system: SNAP, field: 'facts.premium_frequency' }, samples: ['ANNUAL'] }),
  v({ code: 'annual_premium', name: 'Annual premium', description: 'The premium for one year.', category: 'Premium', type: 'MONEY', currency: 'SGD', min: 0, source: { status: 'PROPOSED', system: SNAP, field: 'premium_amount × frequency', note: 'What "annual" means for a single premium is not defined.' }, samples: [12000, 60000] }),
  v({ code: 'risk_class', name: 'Risk classification', description: 'The SBQ sale-selection risk band. Not investment risk tolerance.', category: 'Risk', type: 'ENUM', values: [{ value: 'LOW', label: 'Low' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HIGH', label: 'High' }], source: { status: 'MAPPED', system: 'SBQ risk assessment', field: 'band_code' }, owner: 'Standards & Compliance', samples: ['LOW'] }),
  v({ code: 'customer_age', name: 'Customer age', description: 'Age in years.', category: 'Customer', type: 'NUMBER', min: 0, max: 120, source: { status: 'UNMAPPED', note: 'Only a year of birth is held; whose age, and at which date, is not defined.' }, samples: [42] }),
  v({ code: 'commencement_date', name: 'Policy commencement date', description: 'The day cover starts.', category: 'Product', type: 'DATE', source: { status: 'PROPOSED', system: 'Policy', field: 'effective_from', note: 'On the policy, not in the fact snapshot.' }, samples: ['2026-07-01'] }),
];

const p = (x: Omit<Profile, 'version' | 'status' | 'required' | 'extends'> & Partial<Profile>): Profile => ({ version: 1, status: 'PUBLISHED', required: [], extends: [], ...x });
export const PROFILES: Profile[] = [
  p({ code: 'common', name: 'Common insurance application', description: 'What every application carries.', required: ['market', 'product_family'], sections: [{ name: 'Application', variables: ['market', 'sales_channel'] }, { name: 'Product and premium', variables: ['product_family', 'premium_frequency', 'annual_premium', 'commencement_date'] }, { name: 'Risk and customer', variables: ['risk_class', 'customer_age'] }] }),
  p({ code: 'ilp_extension', name: 'ILP extension', description: 'Added for investment-linked products.', extends: ['common'], sections: [{ name: 'Investment-linked', variables: ['is_ilp'] }], constraints: { product_family: { allowed: ['ILP'] } } }),
  p({ code: 'protection_extension', name: 'Protection extension', description: 'Added for protection products.', extends: ['common'], sections: [], constraints: { product_family: { allowed: ['PROTECTION'] } } }),
  p({ code: 'nftf_extension', name: 'NFTF extension', description: 'Illustrative: facts about a non-face-to-face sale, once defined.', sections: [{ name: 'Non-face-to-face', variables: ['nftf'] }] }),
  p({ code: 'replacement_extension', name: 'Replacement extension', description: 'Added when a policy may be replaced.', sections: [{ name: 'Replacement', variables: ['replacement'] }] }),
  p({ code: 'rider_extension', name: 'Rider extension', description: 'Added when riders can be selected.', sections: [{ name: 'Riders', variables: ['selected_riders'] }] }),
  p({ code: 'new_business', name: 'New business application', description: 'The usual combination: common facts, the ILP flag, NFTF, replacement and riders. It does not narrow the product family.', extends: ['common', 'nftf_extension', 'replacement_extension', 'rider_extension'], sections: [{ name: 'Investment-linked', variables: ['is_ilp'] }] }),
];

const ref = (condition: string, version = 1): Expr => ({ op: 'ref', condition, version });
const c = (x: Omit<Condition, 'version' | 'status'> & Partial<Condition>): Condition => ({ version: 1, status: 'PUBLISHED', ...x });
export const CONDITIONS: Condition[] = [
  c({ code: 'is_ilp', name: 'Is ILP', description: 'The product is investment-linked.', expr: { op: 'test', variable: 'is_ilp', operator: 'is_true' } }),
  c({ code: 'nftf_applies', name: 'NFTF applies', description: 'Illustrative.', expr: { op: 'test', variable: 'nftf', operator: 'is_true' } }),
  c({ code: 'ilp_with_nftf', name: 'ILP with NFTF', description: 'Both at once.', expr: { op: 'all', args: [ref('is_ilp'), ref('nftf_applies')] } }),
  c({ code: 'ilp_without_nftf', name: 'ILP without NFTF', description: 'ILP, and NFTF does not apply.', expr: { op: 'all', args: [ref('is_ilp'), { op: 'not', arg: ref('nftf_applies') }] } }),
  c({ code: 'replacement_applies', name: 'Replacement applies', description: 'The sale replaces an existing policy.', expr: { op: 'test', variable: 'replacement', operator: 'is_true' } }),
  c({ code: 'high_premium', name: 'High premium', description: 'Synthetic threshold, not an approved one.', version: 2, expr: { op: 'test', variable: 'annual_premium', operator: 'gte', value: 50000 }, history: [{ version: 1, expr: { op: 'test', variable: 'annual_premium', operator: 'gte', value: 20000 } }] }),
  c({ code: 'rider_includes_ci', name: 'Selected rider includes CI', description: 'A critical illness rider was chosen.', expr: { op: 'test', variable: 'selected_riders', operator: 'includes_any', values: ['CI'] } }),
];

const s = (letter: string, name: string, summary: string, version = 1): SurveyRef => ({ code: `S-${letter}`, version, name: `Survey ${letter} · ${name}`, label: `${version}.0`, summary, fingerprint: `synthetic-${letter.toLowerCase()}${version}-${'0f3a9c6b1d7e'.slice(0, 8)}` });
export const SURVEYS: SurveyRef[] = [
  s('A', 'ILP product understanding', 'Checks the customer understood an investment-linked plan.'),
  s('B', 'Non-face-to-face sale check', 'Checks how the sale was conducted.'),
  s('C', 'ILP sold non-face-to-face', 'One combined survey covering both.'),
  s('D', 'Replacement advice check', 'Checks the advice given when a policy is replaced.'),
  s('E', 'High premium affordability', 'Checks affordability for a large premium.'),
  s('F', 'Critical illness rider disclosure', 'Checks what was explained about the rider.'),
];
const S = (letter: string) => SURVEYS.find((x) => x.code === `S-${letter}`)!;
const include = (id: string, name: string, when: Expr | null, letters: string[], replaces: string[] = []): Requirement => ({ id, name, when, action: { kind: 'INCLUDE', surveys: letters.map(S) }, replaces });

const base = { code: 'SG-NEW-BUSINESS', name: 'Singapore new business', market: 'SG', description: 'Which surveys a newly sold policy needs. Synthetic.', profiles: ['new_business'], scope: null, same_survey: 'ONE_DELIVERY' as const };
export const PUBLISHED: Policy = {
  ...base, version: 1, status: 'PUBLISHED', order: ['S-A', 'S-B'],
  requirements: [include('r1', 'ILP needs the ILP survey', ref('is_ilp'), ['A']), include('r2', 'NFTF needs the NFTF survey', ref('nftf_applies'), ['B'])],
};
export const DRAFT: Policy = {
  ...base, version: 2, status: 'DRAFT', order: ['S-A', 'S-B', 'S-C', 'S-D'],
  requirements: [
    ...PUBLISHED.requirements,
    include('r3', 'ILP with NFTF needs the combined survey', ref('ilp_with_nftf'), ['C'], ['r1', 'r2']),
    include('r4', 'A replacement needs the replacement survey', ref('replacement_applies'), ['D']),
  ],
};

const sc = (id: string, name: string, description: string, facts: Scenario['facts'], more: Partial<Scenario> = {}): Scenario => ({ id, name, description, profiles: ['new_business'], facts: { market: 'SG', sales_channel: 'AGENCY', replacement: false, ...facts }, suite: 'Core combinations', ...more });
export const SCENARIOS: Scenario[] = [
  sc('sc-ilp', 'ILP only', 'An investment-linked sale made face to face.', { product_family: 'ILP', nftf: false }, { golden: true }),
  sc('sc-nftf', 'NFTF only', 'A protection sale where NFTF applies.', { product_family: 'PROTECTION', nftf: true }, { golden: true }),
  sc('sc-both', 'ILP + NFTF', 'Both conditions at once.', { product_family: 'ILP', nftf: true }, { golden: true }),
  sc('sc-neither', 'Neither', 'A protection sale made face to face.', { product_family: 'PROTECTION', nftf: false }),
  sc('sc-missing', 'ILP with NFTF not known', 'The application does not say whether NFTF applies.', { product_family: 'ILP', nftf: null }),
  sc('sc-replacement', 'ILP replacement', 'An ILP that replaces an existing policy.', { product_family: 'ILP', nftf: false, replacement: true }, { suite: 'Replacement' }),
  sc('sc-invalid', 'Invalid product family', 'A source value that is not one of the allowed values.', { product_family: 'UNIT_TRUST', nftf: true }, { suite: 'Bad input' }),
];

export const seed = (): Data => structuredClone({
  variables: VARIABLES, profiles: PROFILES, conditions: CONDITIONS, surveys: SURVEYS, scenarios: SCENARIOS,
  suites: ['Core combinations', 'Replacement', 'Bad input'],
  policies: [{
    code: base.code, published: PUBLISHED, draft: DRAFT, candidate: null, versions: [PUBLISHED], unsaved: false,
    events: [
      { at: '2026-11-18 10:02', who: 'Maya (maker)', persona: 'maker', what: 'Submitted version 1 for review' },
      { at: '2026-11-18 15:40', who: 'Chen (checker)', persona: 'checker', what: 'Approved version 1' },
      { at: '2026-11-19 09:15', who: 'Priya (publisher)', persona: 'publisher', what: 'Published version 1' },
      { at: '2026-11-21 11:30', who: 'Maya (maker)', persona: 'maker', what: 'Started version 2' },
    ],
  }],
} satisfies Data);
