// CP0.4b Manual Intake — form state and the exact API-084/085 payload built from it. Every business check runs on the
// server; this module only shapes what the user typed (blank → absent, SGT input → ISO time, amounts as text) and maps
// the server's field locations back to inputs. Values offered in selects come from API-087, never from this file.
import type { components } from '../../api/generated/schema';

export type IntakeTransaction = components['schemas']['IntakeTransaction'];
export type IntakeOutcome = components['schemas']['IntakeOutcome'];
export type IntakeReference = components['schemas']['IntakeReference'];
export type PolicyDetail = components['schemas']['PolicyDetail'];

export interface ContactForm { channel: string; value: string; consent_status: string; preference_rank: string }
export interface PartyForm {
  kind: string; name: string; source_party_id: string; date_of_birth_year: string; roles: string[];
  contacts: ContactForm[]; auth_reference: string; auth_valid_from: string; auth_valid_to: string;
}
export interface IntakeForm {
  mode: 'NEW' | 'EXISTING';
  source_system: string; source_event_id: string; reason: string;
  policy: {
    policy_ref: string; product: string; status: string; premium_amount: string; premium_frequency: string;
    premium_term_years: string; sum_assured: string; effective_from: string;
  };
  sale: {
    sale_ref: string; sale_event_type: string; sold_at: string; fsc_ref: string; selling_channel: string;
    selling_location: string; campaign_code: string; proposal_ref: string; premium_amount: string; premium_amount_band: string;
  };
  parties: PartyForm[];
  include_risk: boolean;
  risk: { band_code: string; source_original_value: string; status: string; assessed_at: string; reason_codes: string };
  callback: { source_request_ref: string; due_at: string; priority: string };
}

/** Times are held as ISO strings so a prefilled value is sent back exactly; inputs show them in SGT. */
const SGT_OFFSET = '+08:00';
export function isoToSgtInput(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return new Date(t.getTime() + 8 * 3600_000).toISOString().slice(0, 19);
}
export function sgtInputToIso(value: string): string {
  if (!value) return '';
  const v = value.length === 16 ? `${value}:00` : value;
  return `${v}${SGT_OFFSET}`;
}

export const productKey = (p: { product_code: string; product_family: string; product_subtype: string }) =>
  `${p.product_code}|${p.product_family}|${p.product_subtype}`;

export const emptyContact = (channel = 'PHONE'): ContactForm => ({ channel, value: '', consent_status: 'GRANTED', preference_rank: '1' });
export const emptyParty = (roles: string[] = []): PartyForm => ({
  kind: 'PERSON', name: '', source_party_id: '', date_of_birth_year: '', roles, contacts: [emptyContact()],
  auth_reference: '', auth_valid_from: '', auth_valid_to: '',
});

export function emptyForm(): IntakeForm {
  return {
    mode: 'NEW', source_system: 'SYN-POLICY-ADMIN', source_event_id: '', reason: '',
    policy: { policy_ref: '', product: '', status: 'IN_FORCE', premium_amount: '', premium_frequency: 'MONTHLY', premium_term_years: '', sum_assured: '', effective_from: '' },
    sale: { sale_ref: '', sale_event_type: 'NEW_BUSINESS', sold_at: '', fsc_ref: '', selling_channel: '', selling_location: '', campaign_code: '', proposal_ref: '', premium_amount: '', premium_amount_band: '' },
    parties: [emptyParty(['OWNER', 'PROPOSER', 'PAYER', 'INSURED'])],
    include_risk: false,
    risk: { band_code: '', source_original_value: '', status: 'FINAL', assessed_at: '', reason_codes: '' },
    callback: { source_request_ref: '', due_at: '', priority: '' },
  };
}

const money = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2));

/** Existing-policy mode: the policy's stored values, so a matching top-up is accepted and any change is a 409. */
export function prefillFromPolicy(form: IntakeForm, p: PolicyDetail): IntakeForm {
  return {
    ...form,
    mode: 'EXISTING',
    policy: {
      policy_ref: p.policy_ref, product: productKey(p), status: p.status, premium_amount: money(p.premium_amount),
      premium_frequency: p.premium_frequency ?? '', premium_term_years: p.premium_term_years == null ? '' : String(p.premium_term_years),
      sum_assured: money(p.sum_assured), effective_from: p.effective_from ?? '',
    },
    sale: { ...form.sale, sale_event_type: form.sale.sale_event_type === 'NEW_BUSINESS' ? 'TOP_UP' : form.sale.sale_event_type },
    parties: [],
  };
}

const opt = (v: string) => (v.trim() === '' ? undefined : v.trim());
const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

/** The request body exactly as it will be previewed and submitted. Blank optional fields are omitted. */
export function toPayload(form: IntakeForm, ref: Pick<IntakeReference, 'market_code' | 'currency'>): IntakeTransaction {
  const [product_code = '', product_family = '', product_subtype = ''] = form.policy.product.split('|');
  const sumAssured = opt(form.policy.sum_assured);
  const body: Record<string, unknown> = {
    is_synthetic: true,
    source_system: form.source_system.trim(),
    source_event_id: form.source_event_id.trim(),
    reason: form.reason.trim(),
    policy: {
      policy_ref: form.policy.policy_ref.trim(), market_code: ref.market_code,
      product_code, product_family, product_subtype, status: form.policy.status,
      premium_amount: form.policy.premium_amount.trim(), currency: ref.currency, premium_frequency: form.policy.premium_frequency,
      premium_term_years: intOrNull(form.policy.premium_term_years),
      sum_assured: sumAssured ?? null, sum_assured_currency: sumAssured ? ref.currency : null,
      effective_from: form.policy.effective_from,
    },
    sale: {
      sale_ref: form.sale.sale_ref.trim(), sale_event_type: form.sale.sale_event_type, sold_at: form.sale.sold_at,
      fsc_ref: form.sale.fsc_ref, selling_channel: form.sale.selling_channel, selling_location: form.sale.selling_location.trim(),
      campaign_code: opt(form.sale.campaign_code) ?? null, proposal_ref: form.sale.proposal_ref.trim(),
      premium_amount: form.sale.premium_amount.trim(), currency: ref.currency,
      premium_amount_band: opt(form.sale.premium_amount_band) ?? null,
    },
    parties: form.mode === 'EXISTING' ? [] : form.parties.map((p) => ({
      kind: p.kind, name: p.name.trim(), roles: p.roles,
      ...(opt(p.source_party_id) ? { source_party_id: p.source_party_id.trim() } : {}),
      ...(opt(p.date_of_birth_year) ? { date_of_birth_year: Number(p.date_of_birth_year) } : {}),
      ...(opt(p.auth_reference) ? { authorization: {
        reference: p.auth_reference.trim(), valid_from: p.auth_valid_from, valid_to: opt(p.auth_valid_to) ? p.auth_valid_to : null,
      } } : {}),
      contacts: p.contacts.filter((c) => c.value.trim() !== '').map((c) => ({
        channel: c.channel, value: c.value.trim(), consent_status: c.consent_status, preference_rank: Number(c.preference_rank || '1'),
      })),
    })),
    source_risk: form.include_risk ? {
      band_code: form.risk.band_code, source_original_value: form.risk.source_original_value.trim(), status: form.risk.status,
      assessed_at: form.risk.assessed_at,
      reason_codes: form.risk.reason_codes.split(',').map((c) => c.trim()).filter(Boolean),
    } : null,
    callback_request: {
      source_request_ref: form.callback.source_request_ref.trim(), due_at: form.callback.due_at,
      priority: form.callback.priority.trim() === '' ? null : Number(form.callback.priority),
    },
  };
  return body as unknown as IntakeTransaction;
}

// ---- server error locations → inputs -----------------------------------------------------------------------------
export interface FieldIssue { key: string; code: string; message: string }

/** `['body','parties',0,'contacts',1,'value']` → `parties.0.contacts.1.value`. */
export function issueKey(loc: unknown): string {
  if (!Array.isArray(loc)) return '';
  const parts = loc.map(String);
  if (parts[0] === 'body') parts.shift();
  // The form edits one "product" select for the three product columns, and one source-risk switch.
  const key = parts.join('.');
  if (/^policy\.product_(code|family|subtype)$/.test(key)) return 'policy.product';
  if (key === 'callback_request' || key.startsWith('callback_request.')) return key.replace(/^callback_request/, 'callback');
  if (key.startsWith('source_risk')) return key.replace(/^source_risk/, 'risk');
  return key;
}

export function issuesOf(details: unknown): FieldIssue[] {
  if (!Array.isArray(details)) return [];
  return details.map((d: { loc?: unknown; code?: string; type?: string; message?: string; msg?: string }) => ({
    key: issueKey(d.loc), code: d.code ?? d.type ?? 'INVALID', message: d.message ?? d.msg ?? 'Invalid value',
  }));
}

/** DOM id for a field key (also the anchor of the error summary). */
export const fieldId = (key: string) => `in-${key.replace(/\./g, '-')}`;

export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  const id = c && 'randomUUID' in c ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `portal-${id}`;
}
