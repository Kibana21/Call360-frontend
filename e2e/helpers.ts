import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export interface Account { username: string; password: string; display_name: string }
export function accounts(): Record<'admin' | 'user' | 'victim' | 'tabs', Account> {
  return JSON.parse(readFileSync(resolve(here, '.auth/accounts.json'), 'utf8'));
}

export async function signIn(page: Page, account: Account, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Username').fill(account.username);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

export async function signOut(page: Page, displayName: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(displayName) }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}
