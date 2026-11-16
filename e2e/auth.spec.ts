import { expect, test } from '@playwright/test';
import { accounts, signIn, signOut } from './helpers';

test('E2E-01 unauthenticated redirect, login, landing with real session data, logout', async ({ page }) => {
  const { admin } = accounts();
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fusers/);
  await expect(page.getByText('Local demo identity')).toBeVisible();
  await expect(page.getByRole('button', { name: /continue as/i })).toHaveCount(0); // no passwordless role switching
  await page.getByLabel('Username').fill(admin.username);
  await page.getByLabel('Password').fill('Definitely-Wrong-123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('alert')).toHaveText('Sign-in failed. Check your username and password.');
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/users$/); // returnTo honoured
  await page.getByRole('link', { name: 'Overview' }).click();
  // The landing page is the Overview (F1): real session (top bar) and real SG data from the API.
  await expect(page.getByRole('heading', { name: 'Command Centre' })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(admin.display_name) })).toBeVisible();
  await expect(page.getByTestId('kpi-OPS-01')).toHaveText(/\d/);
  await signOut(page, admin.display_name);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  const me = await page.request.get('/api/v1/me');
  expect(me.status()).toBe(401);
});

test('E2E-15 tokens only in HttpOnly cookies; no storage or URL tokens; CSRF and origin enforced', async ({ page, context }) => {
  const { user } = accounts();
  await signIn(page, user);
  const storage = await page.evaluate(() => ({ l: JSON.stringify(localStorage), s: JSON.stringify(sessionStorage) }));
  const cookies = await context.cookies();
  const access = cookies.find((c) => c.name === 'c360_at');
  const refresh = cookies.find((c) => c.name === 'c360_rt');
  expect(access?.httpOnly).toBe(true);
  expect(refresh?.httpOnly).toBe(true);
  expect(refresh?.path).toBe('/api/v1/auth/refresh');
  for (const value of [access!.value, refresh!.value]) {
    expect(storage.l).not.toContain(value);
    expect(storage.s).not.toContain(value);
    expect(page.url()).not.toContain(value);
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain('c360_at');
  const noCsrf = await page.request.post('/api/v1/auth/logout', { headers: { Origin: 'http://127.0.0.1:5174' } });
  expect(noCsrf.status()).toBe(403);
  const csrf = cookies.find((c) => c.name === 'c360_csrf')!.value;
  const crossSite = await page.request.post('/api/v1/auth/logout', { headers: { Origin: 'https://evil.example', 'X-CSRF-Token': csrf } });
  expect(crossSite.status()).toBe(403);
  expect((await page.request.get('/api/v1/me')).status()).toBe(200); // session untouched by the rejected requests
});

test('D-23 two tabs refreshing an expired access token concurrently keep the session', async ({ context }) => {
  const { tabs } = accounts();
  const first = await context.newPage();
  await signIn(first, tabs);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Command Centre' })).toBeVisible();
  const sessionBefore = (await (await first.request.get('/api/v1/me')).json()).session.session_id;
  // Simulate access-token expiry in the shared cookie jar, then make both tabs hit the API at once.
  const kept = (await context.cookies()).filter((c) => c.name !== 'c360_at');
  await context.clearCookies();
  await context.addCookies(kept);
  await Promise.all([first.reload(), second.reload()]);
  await expect(first.getByRole('heading', { name: 'Command Centre' })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Command Centre' })).toBeVisible();
  const after = await (await first.request.get('/api/v1/me')).json();
  expect(after.session.session_id).toBe(sessionBefore); // same session, not revoked by a false reuse
});

test('E2E-18 (partial) branding and terminology', async ({ page }) => {
  const { user } = accounts();
  await signIn(page, user);
  await expect(page).toHaveTitle(/^Call360 · /);
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('Call 360');
  expect(text).not.toContain('Survey Studio');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByText('Script Studio')).toBeVisible();
  const disabled = page.locator('.navitem[aria-disabled="true"]');
  expect(await disabled.count()).toBe(3); // F2 enabled Call Explorer, Work Queues and Search; F4 Policy Explorer; F5 SBQ Risk Workbench; CP0.4b Data Intake; F6 Script Studio and Assignment Rules; F7 Review Workbench and Voice Studio
  await expect(page.locator('.navitem[aria-disabled="true"]', { hasText: 'Live Monitor' })).toContainText('Stage S4');
});
