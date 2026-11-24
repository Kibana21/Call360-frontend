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

// Surveys are NOT invented here. A requirement names a survey by the code it has in Survey Studio; the exact published
// version (its id and fingerprints) is pinned from Survey Studio's own catalogue when the workspace opens (surveys.ts).
// Until then — or if Survey Studio does not hold that survey — the reference is visibly "not pinned".
export const DEMO = {
  A: ['S-APPL-DEMO-ILP', 'Survey A · ILP product understanding'], B: ['S-APPL-DEMO-NFTF', 'Survey B · NFTF additional questions'],
  C: ['S-APPL-DEMO-COMBINED', 'Survey C · Combined ILP + NFTF'], D: ['S-APPL-DEMO-REPLACEMENT', 'Survey D · Replacement scenario'],
  E: ['S-APPL-DEMO-RIDER', 'Survey E · Rider scenario'],
} as const;
export type DemoKey = keyof typeof DEMO;
/** A reference waiting to be pinned to what Survey Studio has published (version 0 = not pinned). */
export const unpinned = (k: DemoKey): SurveyRef => ({ code: DEMO[k][0], version: 0, name: DEMO[k][1], fingerprint: '' });
export const include = (id: string, name: string, when: Expr | null, keys: DemoKey[], replaces: string[] = []): Requirement => ({ id, name, when, action: { kind: 'INCLUDE', surveys: keys.map(unpinned) }, replaces });

const base = { code: 'SHOWCASE-ILP-NFTF', name: 'ILP and NFTF showcase', market: 'SG', description: 'The guided example: which showcase surveys a newly sold policy needs. Synthetic.', profiles: ['new_business'], scope: null, shared_deliveries: [] };
export const PUBLISHED: Policy = {
  ...base, version: 1, status: 'PUBLISHED', order: [DEMO.A[0], DEMO.B[0]],
  requirements: [include('r1', 'ILP needs the ILP survey', ref('is_ilp'), ['A']), include('r2', 'NFTF needs the NFTF survey', ref('nftf_applies'), ['B'])],
};
export const DRAFT: Policy = {
  ...base, version: 2, status: 'DRAFT', order: [DEMO.A[0], DEMO.B[0], DEMO.C[0], DEMO.D[0], DEMO.E[0]],
  requirements: [
    ...PUBLISHED.requirements,
    include('r3', 'ILP with NFTF needs the combined survey', ref('ilp_with_nftf'), ['C'], ['r1', 'r2']),
    include('r4', 'A replacement needs the replacement survey', ref('replacement_applies'), ['D']),
    include('r5', 'A critical illness rider needs the rider survey', ref('rider_includes_ci'), ['E']),
  ],
};

// ---- starting points offered when a policy is created (each produces an ordinary, fully editable policy)
export interface Template { id: string; name: string; says: string; build: () => Pick<Policy, 'requirements' | 'order'> }
const both: Expr = { op: 'all', args: [ref('is_ilp'), ref('nftf_applies')] };
export const TEMPLATES: Template[] = [
  { id: 'additive', name: 'Two alone, one combined — all three add up', says: 'ILP → A, NFTF → B, and both together → C as well.', build: () => ({ order: [DEMO.A[0], DEMO.B[0], DEMO.C[0]], requirements: [include('r1', 'ILP needs Survey A', ref('is_ilp'), ['A']), include('r2', 'NFTF needs Survey B', ref('nftf_applies'), ['B']), include('r3', 'ILP with NFTF also needs Survey C', both, ['C'])] }) },
  { id: 'replace', name: 'Two alone, one combined — the combined one replaces', says: 'ILP → A, NFTF → B; when both apply, C replaces A and B.', build: () => ({ order: [DEMO.A[0], DEMO.B[0], DEMO.C[0]], requirements: [include('r1', 'ILP needs Survey A', ref('is_ilp'), ['A']), include('r2', 'NFTF needs Survey B', ref('nftf_applies'), ['B']), include('r3', 'ILP with NFTF needs Survey C instead', both, ['C'], ['r1', 'r2'])] }) },
  { id: 'several', name: 'One condition, several surveys', says: 'When ILP and NFTF both apply, include A, B and C together.', build: () => ({ order: [DEMO.A[0], DEMO.B[0], DEMO.C[0]], requirements: [include('r1', 'ILP with NFTF needs three surveys', both, ['A', 'B', 'C'])] }) },
  { id: 'either', name: 'Either condition, and "but not"', says: 'ILP or NFTF → D; ILP without NFTF → E. A synthetic demonstration of OR and NOT.', build: () => ({ order: [DEMO.D[0], DEMO.E[0]], requirements: [include('r1', 'ILP or NFTF needs Survey D', { op: 'any', args: [ref('is_ilp'), ref('nftf_applies')] }, ['D']), include('r2', 'ILP without NFTF needs Survey E', ref('ilp_without_nftf'), ['E'])] }) },
  { id: 'choose', name: 'Choose exactly one', says: 'One of two surveys, each with its own stated criterion, and an explicit fallback.', build: () => ({ order: [DEMO.A[0], DEMO.C[0], DEMO.B[0]], requirements: [{ id: 'r1', name: 'One survey for an ILP sale', when: ref('is_ilp'), replaces: [], action: { kind: 'CHOOSE_ONE', alternatives: [{ survey: unpinned('C'), when: ref('nftf_applies') }, { survey: unpinned('A'), when: null, fallback: true }] } }] }) },
];
/** A large synthetic policy, only to see how the designer behaves at scale. Its conditions are combinations of the seeded variables. */
export function scalePolicy(n: number): Pick<Policy, 'requirements' | 'order'> {
  const keys = Object.keys(DEMO) as DemoKey[];
  const channels = ['AGENCY', 'BANCASSURANCE', 'BROKER', 'DIRECT'], families = ['ILP', 'PROTECTION', 'ENDOWMENT'], risks = ['LOW', 'MEDIUM', 'HIGH'], freq = ['SINGLE', 'MONTHLY', 'ANNUAL'];
  const shared = [ref('is_ilp'), ref('nftf_applies'), ref('replacement_applies'), ref('rider_includes_ci'), ref('high_premium', 2)];
  const requirements: Requirement[] = Array.from({ length: n }, (_, i) => {
    const args: Expr[] = [
      { op: 'test', variable: 'sales_channel', operator: 'equals', value: channels[i % 4]! },
      { op: 'test', variable: 'product_family', operator: 'equals', value: families[Math.floor(i / 4) % 3]! },
      ...(i % 3 === 0 ? [{ op: 'test' as const, variable: 'risk_class', operator: 'equals' as const, value: risks[Math.floor(i / 12) % 3]! }] : []),
      ...(i % 5 === 0 ? [shared[i % shared.length]!] : []),
      ...(i >= 36 ? [{ op: 'test' as const, variable: 'premium_frequency', operator: 'equals' as const, value: freq[Math.floor(i / 36) % 3]! }] : []),
    ];
    const k = keys[i % keys.length]!;
    return include(`r${i + 1}`, `${channels[i % 4]!.toLowerCase()} · ${families[Math.floor(i / 4) % 3]!.toLowerCase()}${i % 3 === 0 ? ` · ${risks[Math.floor(i / 12) % 3]!.toLowerCase()} risk` : ''}${i >= 36 ? ` · ${freq[Math.floor(i / 36) % 3]!.toLowerCase()}` : ''} needs ${DEMO[k][1].split(' · ')[0]}`, { op: 'all', args }, [k]);
  });
  return { requirements, order: keys.map((k) => DEMO[k][0]) };
}

const sc = (id: string, name: string, description: string, facts: Scenario['facts'], more: Partial<Scenario> = {}): Scenario => ({ id, name, description, profiles: ['new_business'], facts: { market: 'SG', sales_channel: 'AGENCY', replacement: false, ...facts }, suite: 'Core combinations', ...more });
export const SCENARIOS: Scenario[] = [
  sc('sc-ilp', 'ILP only', 'An investment-linked sale made face to face.', { product_family: 'ILP', nftf: false }, { golden: true }),
  sc('sc-nftf', 'NFTF only', 'A protection sale where NFTF applies.', { product_family: 'PROTECTION', nftf: true }, { golden: true }),
  sc('sc-both', 'ILP + NFTF', 'Both conditions at once.', { product_family: 'ILP', nftf: true }, { golden: true }),
  sc('sc-neither', 'Neither', 'A protection sale made face to face.', { product_family: 'PROTECTION', nftf: false }),
  sc('sc-missing', 'ILP with NFTF not known', 'The application does not say whether NFTF applies.', { product_family: 'ILP', nftf: null }),
  sc('sc-replacement', 'ILP replacement', 'An ILP that replaces an existing policy.', { product_family: 'ILP', nftf: false, replacement: true }, { suite: 'Replacement' }),
  sc('sc-rider', 'Protection with a critical illness rider', 'Riders chosen on a protection plan.', { product_family: 'PROTECTION', nftf: false, selected_riders: ['CI', 'WOP'] }, { suite: 'Riders' }),
  sc('sc-invalid', 'Invalid product family', 'A source value that is not one of the allowed values.', { product_family: 'UNIT_TRUST', nftf: true }, { suite: 'Bad input' }),
];

export const seed = (): Data => structuredClone({
  variables: VARIABLES, profiles: PROFILES, conditions: CONDITIONS, surveys: [], scenarios: SCENARIOS,
  suites: ['Core combinations', 'Replacement', 'Riders', 'Bad input'],
  policies: [{
    code: base.code, published: PUBLISHED, draft: DRAFT, candidate: null, versions: [PUBLISHED], unsaved: false, origin: 'SHOWCASE',
    events: [
      { at: '2026-11-18 10:02', who: 'Maya (maker)', persona: 'maker', what: 'Submitted version 1 for review' },
      { at: '2026-11-18 15:40', who: 'Chen (checker)', persona: 'checker', what: 'Approved version 1' },
      { at: '2026-11-19 09:15', who: 'Priya (publisher)', persona: 'publisher', what: 'Published version 1' },
      { at: '2026-11-21 11:30', who: 'Maya (maker)', persona: 'maker', what: 'Started version 2' },
    ],
  }],
} satisfies Data);
