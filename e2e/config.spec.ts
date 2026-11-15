import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { accounts, signIn } from './helpers';

test('E2E-20 Configuration: market label version (non-governed), governed denial, stage-locked flags, USER denied', async ({ page, browser }) => {
  const { admin, user } = accounts();
  await signIn(page, admin, '/admin/config');
  await expect(page.getByRole('heading', { name: 'Code lists' })).toBeVisible();
  await expect(page.getByRole('row', { name: /SBQ risk band/ })).toContainText('Governed · read-only');

  // Non-governed market list: create a label version through the UI.
  await page.getByRole('button', { name: 'View Market' }).click();
  let drawer = page.getByRole('dialog', { name: 'Market' });
  const before = await drawer.locator('section[aria-label^="Version"]').count();
  await drawer.getByRole('button', { name: 'New version' }).click();
  const tag = `E2E ${Date.now()}`;
  await drawer.getByLabel(/Label for SG/).fill(`Singapore (synthetic) ${tag}`);
  await drawer.getByLabel('Reason (required)').fill('E2E: clarify market label');
  await drawer.getByRole('button', { name: 'Activate new version' }).click();
  await expect(drawer.locator('section[aria-label^="Version"]')).toHaveCount(before + 1);
  await expect(drawer.locator('section[aria-label^="Version"]').first()).toContainText('ACTIVE');
  await expect(drawer.locator('section[aria-label^="Version"]').first()).toContainText(tag);
  await expect(drawer.locator('section[aria-label^="Version"]').nth(1)).toContainText('SUPERSEDED');
  await drawer.getByRole('button', { name: 'Close' }).click();

  // Governed list: no edit action in the UI, and the API refuses.
  await page.getByRole('button', { name: 'View SBQ risk band' }).click();
  drawer = page.getByRole('dialog', { name: 'SBQ risk band' });
  await expect(drawer.getByRole('note')).toContainText('read-only');
  await expect(drawer.getByRole('button', { name: 'New version' })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Close' }).click();
  const csrf = (await page.context().cookies()).find((c) => c.name === 'c360_csrf')!.value;
  const headers = { 'X-CSRF-Token': csrf, Origin: 'http://127.0.0.1:5174' };
  const governed = await page.request.post('/api/v1/admin/code-lists/sbq_risk_band/versions', { headers,
    data: { based_on_version: 0, reason: 'E2E governed attempt', values: [{ code: 'X1', label: 'x', attributes: {} }] } });
  expect(governed.status()).toBe(403);

  // Stage-locked flag: disabled in the UI with an explanation; the API refuses with 422.
  const enable = page.getByRole('button', { name: 'Enable Browser voice sessions (GPT-Live)' });
  await expect(enable).toBeDisabled();
  await expect(page.getByRole('row', { name: /voice\.browser_sessions/ })).toContainText('Locked until Stage S1');
  const flags = await (await page.request.get('/api/v1/admin/feature-flags')).json();
  const voice = flags.items.find((f: { code: string }) => f.code === 'voice.browser_sessions');
  const gated = await page.request.patch('/api/v1/admin/feature-flags/voice.browser_sessions', {
    headers: { ...headers, 'If-Match': String(voice.row_version) }, data: { enabled: true, reason: 'E2E early enable' } });
  expect(gated.status()).toBe(422);

  // Audit shows the activation with reason.
  await page.getByRole('link', { name: 'Audit' }).click();
  await page.getByPlaceholder(/Action starts with/).fill('CONFIG.');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('row', { name: /CONFIG\.CODE_LIST_VERSION_ACTIVATED/ }).first()).toContainText('E2E: clarify market label');

  // USER is denied in the UI and API.
  const ctx = await browser.newContext();
  const userPage = await ctx.newPage();
  await signIn(userPage, user, '/admin/config');
  await expect(userPage).toHaveURL(/unauthorized/);
  expect((await userPage.request.get('/api/v1/admin/code-lists')).status()).toBe(403);
  await ctx.close();
});

for (const width of [1280, 1440]) {
  test(`FE-04 Configuration screen accessibility at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, accounts().admin, '/admin/config');
    await expect(page.getByRole('heading', { name: 'Feature flags' })).toBeVisible();
    const scan = async (name: string) => {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${name}: ${v.id}`)).toEqual([]);
    };
    await scan('config');
    await page.screenshot({ path: `test-results/screens/config-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'View Market' }).click();
    await page.getByRole('dialog', { name: 'Market' }).waitFor();
    // let the mockup's 140 ms fade-in finish so axe samples final colours, not a blended frame
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished'));
    await scan('config-drawer');
    await page.screenshot({ path: `test-results/screens/config-drawer-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}
