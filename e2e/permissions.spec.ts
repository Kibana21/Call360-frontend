import { expect, test } from '@playwright/test';
import { accounts, signIn } from './helpers';

test('E2E-10 (partial) USER is denied Administration in the UI and by the API', async ({ page }) => {
  const { user } = accounts();
  await signIn(page, user);
  await page.getByRole('link', { name: 'Administration' }).click();
  await expect(page).toHaveURL(/\/unauthorized$/);
  await expect(page.getByRole('heading', { name: 'Administrator access required' })).toBeVisible();
  expect((await page.request.get('/api/v1/admin/users')).status()).toBe(403);
  expect((await page.request.get('/api/v1/admin/audit-events')).status()).toBe(403);
});

test('E2E-13 (partial) ADMIN disables a user: that user is signed out on the next request; audit shows before/after', async ({ browser }) => {
  const { admin, victim } = accounts();
  const victimCtx = await browser.newContext();
  const victimPage = await victimCtx.newPage();
  await signIn(victimPage, victim);

  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await signIn(adminPage, admin, '/admin/users');
  const row = adminPage.getByRole('row', { name: new RegExp(victim.display_name) });
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: `Disable ${victim.display_name}` }).click();
  const dialog = adminPage.getByRole('dialog');
  await dialog.getByLabel('Reason (required)').fill('E2E: access no longer required');
  await dialog.getByRole('button', { name: 'Disable user' }).click();
  await expect(row.getByText('Disabled', { exact: true })).toBeVisible();

  await victimPage.reload();
  await expect(victimPage).toHaveURL(/\/(login|session-expired)/);
  expect((await victimPage.request.get('/api/v1/me')).status()).toBe(401);

  await adminPage.getByRole('link', { name: 'Audit' }).click();
  await adminPage.getByPlaceholder(/Action starts with/).fill('ADMIN.USER_DISABLED');
  await adminPage.getByRole('button', { name: 'Apply' }).click();
  const event = adminPage.getByRole('row', { name: /ADMIN\.USER_DISABLED/ }).first();
  await expect(event).toContainText('E2E: access no longer required');
  await event.getByRole('button', { name: 'View' }).click();
  await expect(adminPage.getByRole('dialog')).toContainText('"status": "ACTIVE"');
  await expect(adminPage.getByRole('dialog')).toContainText('"status": "DISABLED"');
  await victimCtx.close();
  await adminCtx.close();
});
