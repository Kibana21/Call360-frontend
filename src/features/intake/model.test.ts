// CP0.4b — Manual Intake payload shaping and server error mapping (no business rules live here).
import { describe, expect, it } from 'vitest';
import { emptyForm, isoToSgtInput, issueKey, issuesOf, prefillFromPolicy, sgtInputToIso, toPayload, type PolicyDetail } from './model';

const REF = { market_code: 'SG', currency: 'SGD' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose view of the generated request body in assertions
type Body = Record<string, any>;

describe('intake model', () => {
  it('builds the exact API body: synthetic, SG/SGD from reference data, blanks as null or omitted', () => {
    const f = emptyForm();
    f.policy.product = 'SYN-PROT-TERM|PROTECTION|TERM_LIFE';
    f.policy.premium_amount = ' 180.00 ';
    f.parties[0]!.name = 'Example Holder';
    f.parties[0]!.contacts[0]!.value = 'SYN-TEL-SG-123456';
    f.callback.priority = '2';
    const b = toPayload(f, REF) as unknown as Body;
    expect(b.is_synthetic).toBe(true);
    expect(b.policy).toMatchObject({ market_code: 'SG', currency: 'SGD', product_code: 'SYN-PROT-TERM', product_family: 'PROTECTION',
      product_subtype: 'TERM_LIFE', premium_amount: '180.00', premium_term_years: null, sum_assured: null, sum_assured_currency: null });
    expect(b.sale).toMatchObject({ currency: 'SGD', campaign_code: null, premium_amount_band: null });
    expect(b.parties[0]).not.toHaveProperty('source_party_id');
    expect(b.parties[0]).not.toHaveProperty('authorization');
    expect(b.parties[0].contacts).toEqual([{ channel: 'PHONE', value: 'SYN-TEL-SG-123456', consent_status: 'GRANTED', preference_rank: 1 }]);
    expect(b.source_risk).toBeNull();
    expect(b.callback_request.priority).toBe(2);
    f.callback.priority = '';
    expect((toPayload(f, REF) as unknown as Body).callback_request.priority).toBeNull(); // the server reports it missing
  });

  it('pairs sum assured with the market currency and includes risk only when switched on', () => {
    const f = emptyForm();
    f.policy.sum_assured = '250000';
    f.include_risk = true;
    f.risk = { band_code: 'HIGH', source_original_value: 'SBQ-H', status: 'FINAL', assessed_at: '2026-11-10T10:00:00+08:00', reason_codes: 'A1, B2,' };
    const b = toPayload(f, REF) as unknown as Body;
    expect([b.policy.sum_assured, b.policy.sum_assured_currency]).toEqual(['250000', 'SGD']);
    expect(b.source_risk.reason_codes).toEqual(['A1', 'B2']);
  });

  it('converts SGT inputs to ISO with offset and back, keeping a prefilled ISO value exact', () => {
    expect(sgtInputToIso('2026-11-15T09:30')).toBe('2026-11-15T09:30:00+08:00');
    expect(isoToSgtInput('2026-11-15T01:30:00Z')).toBe('2026-11-15T09:30:00');
    expect(isoToSgtInput('')).toBe('');
  });

  it('prefills an existing policy from the stored values and sends no parties', () => {
    const p = { id: 'p1', policy_ref: 'POL-SG-000123', product_code: 'SYN-ILP-GROWTH', product_family: 'ILP', product_subtype: 'ILP_REGULAR',
      status: 'IN_FORCE', premium_amount: 420, premium_frequency: 'MONTHLY', premium_term_years: 10, sum_assured: 150000,
      effective_from: '2025-03-04T05:06:07.123456Z' } as unknown as PolicyDetail;
    const f = prefillFromPolicy(emptyForm(), p);
    const b = toPayload(f, REF) as unknown as Body;
    expect(f.mode).toBe('EXISTING');
    expect(b.policy).toMatchObject({ policy_ref: 'POL-SG-000123', premium_amount: '420.00', premium_term_years: 10, sum_assured: '150000.00',
      effective_from: '2025-03-04T05:06:07.123456Z' });
    expect(b.sale.sale_event_type).toBe('TOP_UP');
    expect(b.parties).toEqual([]);
  });

  it('maps server field locations to form inputs', () => {
    expect(issueKey(['body', 'parties', 0, 'contacts', 1, 'value'])).toBe('parties.0.contacts.1.value');
    expect(issueKey(['body', 'policy', 'product_code'])).toBe('policy.product');
    expect(issueKey(['body', 'callback_request', 'due_at'])).toBe('callback.due_at');
    expect(issueKey(['body', 'source_risk', 'band_code'])).toBe('risk.band_code');
    expect(issuesOf([{ loc: ['body', 'sale', 'fsc_ref'], code: 'UNKNOWN_FSC', message: 'No active representative' }]))
      .toEqual([{ key: 'sale.fsc_ref', code: 'UNKNOWN_FSC', message: 'No active representative' }]);
  });
});
