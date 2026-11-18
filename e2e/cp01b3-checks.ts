import { expect, type Page } from '@playwright/test';
import { a11yAndLayout } from './cp04a-checks';
import { signIn } from './helpers';

// CP0.1B-3 — Administration completion on the real stack (backend 8001 + call360_test). E2E-13 (complete): ADMIN
// creates a user whose one-time password is shown once; the new user signs in, is held on Change password until
// they set their own, then reaches the portal; ADMIN sees the user in Groups and Sessions, revokes the session (the
// user is signed out on the next request), resets the password (a new one-time password), checks System health;
// accessibility and layout. Called from overview.spec.ts to reuse the ADMIN sign-in (per-IP login rate limit).
const NEW_PASSWORD = `E2e-${crypto.randomUUID()}`; // generated per run; never written to disk

export async function cp01b3Admin(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const username = `e2e.new.${Date.now().toString(36)}`;
  const displayName = `E2E New User ${Date.now().toString(36).slice(-4)}`;

  // 1. Create a user: the one-time password is shown once.
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'New user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a local user' });
  await dialog.getByLabel('Username').fill(username);
  await dialog.getByLabel('Display name').fill(displayName);
  await dialog.getByLabel('Group').selectOption('LOCAL_USER_SG');
  await dialog.getByLabel('Reason (required)').fill('E2E onboarding (synthetic)');
  await dialog.getByRole('button', { name: 'Create user' }).click();
  const otp = (await page.getByTestId('one-time-password').innerText()).trim();
  expect(otp.length).toBeGreaterThanOrEqual(12);
  await page.getByRole('button', { name: 'Done — hide password' }).click();
  await expect(page.getByTestId('one-time-password')).toHaveCount(0);
  await expect(page.getByRole('row', { name: new RegExp(displayName) })).toBeVisible();
  await a11yAndLayout(page, 'admin-users');
  await page.setViewportSize({ width: 1440, height: 900 });

  // 2. The new user signs in with it and must set their own password first.
  const ctx = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
  const other = await ctx.newPage();
  await signIn(other, { username, password: otp, display_name: displayName }, '/calls');
  await expect(other).toHaveURL(/\/account\/password/);
  await expect(other.getByTestId('password-required')).toBeVisible();
  expect((await other.request.get('/api/v1/cases')).status()).toBe(403);
  await other.getByLabel('One-time password').fill(otp);
  await other.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await other.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await other.getByRole('button', { name: 'Change password' }).click();
  await expect(other.getByRole('heading', { name: 'Command Centre' })).toBeVisible();
  expect((await other.request.get('/api/v1/cases?limit=1')).status()).toBe(200);

  // 3. Groups: the user is a member of Singapore users; history and reserved permissions are visible.
  await page.goto('/admin/groups');
  await expect(page.getByTestId('group-LOCAL_USER_SG')).toContainText(displayName);
  await expect(page.getByTestId('reserved-permissions')).toContainText('pii.unmasked'); // review.decide un-reserved in S3-C
  await expect(page.getByTestId('reserved-permissions')).not.toContainText('review.decide');
  await a11yAndLayout(page, 'admin-groups');
  await page.setViewportSize({ width: 1440, height: 900 });

  // 4. Sessions: revoke the new user's session; they are signed out on their next request.
  await page.goto('/admin/sessions');
  await expect(page.getByRole('button', { name: /Revoke session of/ }).and(page.locator(':disabled'))).toHaveCount(1); // own session
  await page.getByRole('button', { name: `Revoke session of ${displayName}` }).click();
  await page.getByRole('dialog').getByLabel('Reason (required)').fill('E2E revoke (synthetic)');
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke session' }).click();
  await expect(page.getByRole('button', { name: `Revoke session of ${displayName}` })).toHaveCount(0);
  await a11yAndLayout(page, 'admin-sessions');
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await other.request.get('/api/v1/me')).status()).toBe(401);
  await ctx.close();

  // 5. Password reset gives a new one-time password; the audit trail records the actions, never the password.
  await page.goto('/admin/users');
  await page.getByRole('button', { name: `Reset password for ${displayName}` }).click();
  await page.getByRole('dialog').getByLabel('Reason (required)').fill('E2E reset (synthetic)');
  await page.getByRole('dialog').getByRole('button', { name: 'Reset password' }).click();
  const second = (await page.getByTestId('one-time-password').innerText()).trim();
  expect(second).not.toBe(otp);
  await page.getByRole('button', { name: 'Done — hide password' }).click();
  const audit = await (await page.request.get('/api/v1/admin/audit-events?limit=50')).json();
  const actions = audit.items.map((e: { action: string }) => e.action);
  for (const a of ['ADMIN.USER_CREATED', 'AUTH.PASSWORD_CHANGED', 'ADMIN.SESSION_REVOKED', 'ADMIN.PASSWORD_RESET']) expect(actions).toContain(a);
  expect(JSON.stringify(audit)).not.toContain(otp);
  expect(JSON.stringify(audit)).not.toContain(second);

  // 6. System health.
  await page.goto('/admin/system');
  const health = await (await page.request.get('/api/v1/admin/system-health')).json();
  await expect(page.getByTestId('health-checks')).toContainText('Audit hash chain');
  await expect(page.getByTestId('openapi-sha')).toHaveText(health.openapi_sha256);
  expect(health.checks.filter((c: { status: string }) => c.status === 'FAIL')).toEqual([]);
  await a11yAndLayout(page, 'admin-system');
  await page.setViewportSize({ width: 1440, height: 900 });
}

export async function cp01b3User(page: Page): Promise<void> {
  for (const path of ['/admin/groups', '/admin/sessions', '/admin/system']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  }
  for (const path of ['/api/v1/admin/groups', '/api/v1/admin/sessions', '/api/v1/admin/system-health', '/api/v1/admin/roles']) {
    expect((await page.request.get(path)).status()).toBe(403);
  }
  expect((await page.request.get('/api/v1/auth/session')).status()).toBe(200);
}
