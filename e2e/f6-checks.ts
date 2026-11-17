import { expect, type Page } from '@playwright/test';
import { a11yAndLayout } from './cp04a-checks';

// F6 — Script Studio and Assignment Rules on the real stack (E2E-09) (backend 8001 + call360_test with S0-SEED-1). The journey
// Script Library → Script Version → Assignment Rule → related Call Detail → back to the pinned version; a historical
// (superseded) rule and its case keep their own version; structure order and manifest equal the API; Singapore only;
// synthetic labelling; S2-A authoring only for script.edit holders; accessibility and layout. Called from overview.spec.ts (both roles hold
// script.read) to reuse its sign-ins.
const MALAYSIA = /SALES_VERIFICATION_MY|MY-SALES-VERIFY|CB-2026-2\d{4}/;

export async function f6Journey(page: Page, shots: boolean): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const lib = await (await page.request.get('/api/v1/scripts')).json();
  expect(lib.markets).toEqual(['SG']);
  const published = lib.items.find((v: { status: string; family: string }) => v.status === 'PUBLISHED' && v.family === 'SALES_VERIFICATION_SG');

  // 1. Script Library.
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Script Studio' }).click();
  await expect(page.getByRole('heading', { name: 'Script Studio', level: 1 })).toBeVisible();
  await expect(page.getByTestId('synthetic-script-banner')).toContainText('not approved AIA/MAS wording');
  await expect(page.getByTestId('script-library').locator('tbody tr')).toHaveCount(lib.total);
  const me = await (await page.request.get('/api/v1/me')).json();
  await expect(page.getByRole('button', { name: 'New script' })).toHaveCount(me.permissions.includes('script.edit') ? 1 : 0); // S2-A
  await page.getByLabel('Status').selectOption('PUBLISHED');
  await expect(page).toHaveURL(/status=PUBLISHED/);
  const publishedCount = lib.items.filter((v: { status: string }) => v.status === 'PUBLISHED').length;
  await expect(page.getByTestId('script-library').locator('tbody tr')).toHaveCount(publishedCount);
  await expect(page.getByTestId('controls')).toContainText('SYN-CTRL-01');
  await expect(page.getByTestId('regulatory-references')).toContainText('Synthetic placeholder');
  expect(await page.locator('body').innerText()).not.toMatch(MALAYSIA);
  if (shots) { await a11yAndLayout(page, 'script-library'); await page.setViewportSize({ width: 1440, height: 900 }); }

  // 2. Script Version: ordered structure, manifest and question detail equal the API.
  await page.getByRole('link', { name: `${published.family} v${published.version_label}` }).click();
  await expect(page.getByRole('heading', { name: 'Script Detail' })).toBeVisible();
  const detail = await (await page.request.get(`/api/v1/script-versions/${published.id}`)).json();
  await expect(page.getByTestId('manifest-sha')).toHaveText(detail.manifest_sha256);
  const headings = page.getByTestId('script-section').getByRole('heading', { level: 2 });
  await expect(headings).toHaveText(detail.sections.map((s: { position: number; module_name: string }) => `${s.position}. ${s.module_name}`));
  const term = page.getByTestId('question-Q-PREMIUM-TERM-YEARS');
  await term.locator('summary').click();
  await expect(term).toContainText('premium_term_years');
  await expect(term).toContainText('Numeric match policy fact');
  const familyVersions = lib.items.filter((v: { script_family_id: string }) => v.script_family_id === published.script_family_id).length;
  await expect(page.getByTestId('version-history').getByRole('link')).toHaveCount(familyVersions);
  await expect(page.getByTestId('immutable-note')).toContainText('Immutable version'); // S2-A: published content never edits
  if (shots) { await a11yAndLayout(page, 'script-detail'); await page.setViewportSize({ width: 1440, height: 900 }); }

  // 3. Assignment Rule selected from the version, with the cases it assigned.
  await page.getByRole('link', { name: 'SG-SALES-VERIFY v2' }).click();
  // S2-B: the F6 deep link opens Rule Detail on that version.
  await expect(page.getByRole('heading', { name: 'Rule Detail', level: 1 })).toBeVisible();
  await expect(page.getByTestId('rule-version-header')).toContainText('v2');
  await expect(page.getByTestId('rule-explanation')).toContainText('when the market is Singapore');
  await expect(page.getByTestId('rule-explanation')).toContainText('callback purpose is Sale verification');
  const rule = page.getByTestId('rule-cases');
  const rules = await (await page.request.get('/api/v1/script-assignment-rules')).json();
  const live = rules.items.find((r: { rule_code: string; version: number }) => r.rule_code === 'SG-SALES-VERIFY' && r.version === 2);
  await expect(page.getByTestId('rule-cases-count')).toContainText(`${live.cases_assigned} cases`);
  expect(await page.locator('body').innerText()).not.toMatch(MALAYSIA);
  if (shots) { await a11yAndLayout(page, 'assignment-rules'); await page.setViewportSize({ width: 1440, height: 900 }); }

  // 4. Related Call Detail: its assignment names the same rule and version, and links back to the script.
  const caseRef: string = live.recent_cases[0].case_ref;
  await rule.getByRole('link', { name: caseRef }).click();
  await expect(page.getByRole('heading', { name: 'Call Detail' })).toBeVisible();
  await expect(page.getByText(caseRef).first()).toBeVisible();
  await expect(page.getByTestId('cd-script-link')).toHaveText(`${published.family} v${published.version_label}`);
  await page.getByTestId('cd-script-link').click();
  await expect(page).toHaveURL(new RegExp(`/scripts/${published.script_family_id}\\?version=${published.id}`));
  await expect(page.getByTestId('manifest-sha')).toHaveText(detail.manifest_sha256);

  // 5. History: a superseded rule's case keeps the version it was assigned.
  const old = rules.items.find((r: { status: string; cases_assigned: number }) => r.status === 'SUPERSEDED' && r.cases_assigned > 0);
  await page.goto(`/assignment-rules?rule=${encodeURIComponent(`${old.rule_code} v${old.version}`)}`);
  await page.getByTestId('rule-cases').getByRole('link', { name: old.recent_cases[0].case_ref }).click();
  await expect(page.getByTestId('cd-script-link')).toHaveText(`${old.target.family} v${old.target.version_label}`);
}
