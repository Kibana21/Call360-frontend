import { expect, type Page } from '@playwright/test';
import { writeHeaders } from './cp04a-checks';

// Governed setup helpers for lifecycle scripts (S2-D.1 / S2-E E2E): the author builds a synthetic lifecycle script
// through the normal Script Studio APIs; a different checker approves and publishes it when asked.
export type Api = { page: Page; post: (path: string, data: unknown, status?: number) => Promise<Record<string, unknown>> };
export async function api(page: Page): Promise<Api> {
  return {
    page,
    post: async (path, data, status = 200) => {
      const r = await page.request.post(`/api/v1${path}`, { data, headers: await writeHeaders(page) });
      expect(r.status(), `${path}: ${await r.text()}`).toBe(status);
      return (await r.json()) as Record<string, unknown>;
    },
  };
}

const item = (wording: string, extra: Record<string, unknown>) => ({
  intent: 'Synthetic lifecycle item (E2E)', category: 'OTHER', customer_wording: `[Synthetic example, not approved wording] ${wording}`,
  delivery_mode: 'CONTROLLED_TTS', answer_type: 'ACKNOWLEDGEMENT', mandatory: true, expected_answer_policy: 'ACKNOWLEDGEMENT', ...extra,
});
const yesNo = (wording: string, role: string, extra: Record<string, unknown> = {}) =>
  item(wording, { answer_type: 'YES_NO', expected_answer_policy: 'COLLECT_ONLY', delivery_mode: 'CONVERSATIONAL', lifecycle_role: role, ...extra });

export async function buildLifecycleScript(author: Api, checker: Api | null, code: string, prefix = 'LCE'): Promise<string> {
  const fam = await author.post('/scripts', { code, name: 'Lifecycle verification (synthetic, E2E)', description: 'S2-D.1 E2E lifecycle script' }, 201);
  const vid = String(fam.script_version_id);
  const rv = async () => Number((await (await author.page.request.get(`/api/v1/script-versions/${vid}`)).json()).row_version);
  const sections: [string, string, [string, Record<string, unknown>][]][] = [
    ['OPENING', `${code}_OPEN`, [[`Q-${prefix}-OPEN`, item('Hello, this is a synthetic callback from the verification team.', { lifecycle_role: 'OPENING_STATEMENT' })]]],
    ['IDENTITY', `${code}_ID`, [[`Q-${prefix}-ID-NAME`, yesNo('Am I speaking with the policy owner?', 'IDENTITY_CHECK')],
      [`Q-${prefix}-ID-DOB`, yesNo('Can you confirm your year of birth?', 'IDENTITY_CHECK')]]],
    ['DISCLOSURE', `${code}_DISC`, [[`Q-${prefix}-DISC`, item('This call is a synthetic verification exercise.', { lifecycle_role: 'DISCLOSURE', on_failure: 'TERMINATE' })]]],
    ['CONSENT', `${code}_CONSENT`, [[`Q-${prefix}-PROCEED`, yesNo('Are you happy to proceed?', 'CONSENT_TO_PROCEED')],
      [`Q-${prefix}-REC`, yesNo('May we record this call?', 'RECORDING_CONSENT', { on_failure: 'CONTINUE_WITHOUT_RECORDING' })]]],
    ['COMMON', `${code}_CORE`, [[`Q-${prefix}-POLICY`, item('Your synthetic protection policy has an annual premium.', { discloses_policy_information: true, lifecycle_role: 'VERIFICATION' })],
      [`Q-${prefix}-UNDERSTOOD`, yesNo('Did the representative explain the policy?', 'VERIFICATION')]]],
    ['CLOSING', `${code}_CLOSE`, [[`Q-${prefix}-CLOSE`, item('Thank you, this synthetic call is complete.', { lifecycle_role: 'CLOSING_STATEMENT', deliver_on_termination: true })]]],
  ];
  for (const [kind, mod, questions] of sections) {
    await author.post(`/script-versions/${vid}/sections`, { expected_row_version: await rv(), module_code: mod, module_name: `${kind.toLowerCase()} (synthetic)`, module_kind: kind });
    const detail = await (await author.page.request.get(`/api/v1/script-versions/${vid}`)).json();
    const sid = detail.sections.find((s: { module_code: string }) => s.module_code === mod).section_id;
    for (const [qcode, content] of questions) await author.post(`/script-versions/${vid}/sections/${sid}/questions`, { expected_row_version: await rv(), question_code: qcode, content });
  }
  const val = await author.post(`/script-versions/${vid}/validate`, {});
  expect((val.issues as { severity: string }[]).filter((i) => i.severity === 'ERROR')).toEqual([]);
  if (!checker) return vid; // left as a DRAFT
  await author.post(`/script-versions/${vid}/submit`, { expected_row_version: await rv(), change_summary: 'Synthetic lifecycle script (S2-D.1 E2E)' });
  const unmapped = (await (await checker.page.request.get(`/api/v1/script-versions/${vid}`)).json()).unmapped_mandatory;
  await checker.post(`/script-versions/${vid}/review`, { decision: 'APPROVE', reason: 'Synthetic lifecycle reviewed (E2E)', acknowledged_unmapped_mandatory: unmapped });
  await checker.post(`/script-versions/${vid}/publish`, {});
  return vid;
}


/** Submit a draft as the author, then approve and publish it as a different checker. */
export async function publishDraft(author: Api, checker: Api, vid: string): Promise<void> {
  const rv = Number((await (await author.page.request.get(`/api/v1/script-versions/${vid}`)).json()).row_version);
  await author.post(`/script-versions/${vid}/submit`, { expected_row_version: rv, change_summary: 'Synthetic lifecycle script (E2E)' });
  const unmapped = (await (await checker.page.request.get(`/api/v1/script-versions/${vid}`)).json()).unmapped_mandatory;
  await checker.post(`/script-versions/${vid}/review`, { decision: 'APPROVE', reason: 'Synthetic lifecycle reviewed (E2E)', acknowledged_unmapped_mandatory: unmapped });
  await checker.post(`/script-versions/${vid}/publish`, {});
}
