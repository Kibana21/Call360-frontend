import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, type Account } from '../helpers';

// D-418 — the intermittent "the designer did not open after creating a 20-requirement policy". This file makes the
// suspected timing DETERMINISTIC: the list of saved policies is delayed, and the person clicks before it has arrived.
const here = dirname(fileURLToPath(import.meta.url));
const account = (): Account => JSON.parse(readFileSync(resolve(here, '../.auth/accounts.json'), 'utf8')).survey_applauthor;
const B = '/survey-studio/applicability';

test('D-418 a policy created before the list of saved policies has loaded', async ({ page }) => {
  test.setTimeout(120_000);
  const seen: string[] = [];
  page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/v1/applicability/policies' && r.request().method() === 'POST') void r.text().then((t) => seen.push(`${r.status()} ${t.slice(0, 120)}`)); });
  await signIn(page, account(), `${B}/policies`);
  await expect(page.getByTestId('ap-catalogue')).toHaveAttribute('data-policies', 'ready', { timeout: 25_000 });
  // a 20-requirement policy exists (its code is the first one the gallery would suggest)
  if (!(await page.getByText('Scale review · 20 requirements').count())) { await page.getByTestId('ap-policy-scale-20').click(); await expect(page.getByTestId('ap-designer')).toBeVisible({ timeout: 30_000 }); }
  // now the same page is opened again with the LIST of saved policies arriving three seconds late
  await page.route('**/api/v1/applicability/policies', async (route) => { if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
  await page.goto(`${B}/policies`);
  await expect(page.getByTestId('ap-catalogue')).toHaveAttribute('data-library', 'ready', { timeout: 25_000 });
  const state = await page.getByTestId('ap-catalogue').getAttribute('data-policies');
  const enabled = await page.getByTestId('ap-policy-scale-20').isEnabled();
  console.log(`D418 at the moment of the click: saved policies are "${state}", the button is ${enabled ? 'ENABLED' : 'disabled'}`);
  // THE FIX: while the saved policies are being read, nothing can be created
  expect(state).toBe('loading');
  expect(enabled, 'creation is offered before the saved policies are known').toBe(false);
  await expect(page.getByTestId('ap-policy-new-blank')).toBeDisabled();
  await expect(page.getByTestId('ap-policy-scale-20')).toBeEnabled({ timeout: 15_000 }); // … and it is offered once they are
  await page.getByTestId('ap-policy-scale-20').click();
  const opened = await page.getByTestId('ap-designer').waitFor({ timeout: 15_000 }).then(() => true, () => false);
  console.log(`D418 the server answered the creation with: ${JSON.stringify(seen)}; the designer ${opened ? 'OPENED' : 'DID NOT OPEN'}`);
  expect(opened, `creation answered ${JSON.stringify(seen)}`).toBe(true);
  expect(seen.filter((x) => x.startsWith('409'))).toEqual([]); // no code that was already taken was ever sent
  await expect(page.getByTestId('ap-policy-name')).toHaveValue(/Scale review · 20 requirements \(\d+\)/);
});

test('D-418 measurements: what the gallery and one opened policy ask the server for, with a populated gallery', async ({ page }) => {
  test.setTimeout(180_000);
  type Hit = { what: string; ms: number };
  let hits: Hit[] = [];
  page.on('requestfinished', (q) => { const u = new URL(q.url()); if (!u.pathname.startsWith('/api/v1/applicability/policies')) return; const id = /[0-9a-f-]{36}/.test(u.pathname); hits.push({ what: `${q.method()} ${u.pathname.replace(/[0-9a-f-]{36}/, '{id}')}${u.search}`, ms: Math.round(q.timing().responseEnd) }); void id; });
  const summary = (label: string) => { const by = new Map<string, number[]>(); hits.forEach((h) => by.set(h.what, [...(by.get(h.what) ?? []), h.ms])); const rows = [...by.entries()].map(([k, v]) => `${k} ×${v.length} (slowest ${Math.max(...v)} ms)`); console.log(`D418M ${label}: ${rows.join(' | ') || 'no policy request'}`); return by; };
  await signIn(page, account(), `${B}/policies`);
  const t0 = Date.now();
  await expect(page.getByTestId('ap-catalogue')).toHaveAttribute('data-policies', 'ready', { timeout: 30_000 });
  const count = Number((await page.getByTestId('ap-gallery-count').innerText()).split(' ')[0]);
  console.log(`D418M gallery: ${count} saved policies listed in ${Date.now() - t0} ms after sign-in`);
  const gallery = summary('gallery load');
  // rendering the list reads each policy ONCE, without the inspection, and inspects or evaluates nothing
  expect([...gallery.keys()].filter((k) => /\/(inspect|evaluate|preview)$/.test(k))).toEqual([]);
  expect([...gallery.keys()].filter((k) => k.startsWith('GET /api/v1/applicability/policies/{id}') && !k.includes('inspection=false'))).toEqual([]);
  expect(gallery.get('GET /api/v1/applicability/policies/{id}?inspection=false')?.length).toBe(count);
  expect(gallery.get('GET /api/v1/applicability/policies')?.length).toBe(1); // the list itself is read once
  // ---- opening ONE policy: only that policy is inspected and evaluated; no other policy is read again
  hits = [];
  const t1 = Date.now();
  await page.locator('[data-testid^="ap-gallery-"][data-testid$="-open"]').first().click();
  await expect(page.getByTestId('ap-designer')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ap-preview-source').first()).toHaveAttribute('data-source', 'SAVED', { timeout: 30_000 });
  console.log(`D418M opening one policy: designer and its saved evaluation on screen in ${Date.now() - t1} ms`);
  await page.waitForTimeout(1500);
  const opened = summary('opening one policy');
  expect([...opened.keys()].filter((k) => k.startsWith('GET '))).toEqual([]); // nothing is listed or read again
  expect(opened.get('POST /api/v1/applicability/policies/{id}/inspect')?.length ?? 0).toBeLessThanOrEqual(2);
  expect(opened.get('POST /api/v1/applicability/policies/{id}/evaluate')?.length ?? 0).toBeLessThanOrEqual(3);
  // ---- saving it: that policy alone is read again
  hits = [];
  await page.getByTestId('ap-policy-name').fill(`${await page.getByTestId('ap-policy-name').inputValue()} ·`);
  await page.getByTestId('ap-save-draft').click();
  await expect(page.getByTestId('ap-policy-bar')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  const savedHits = summary('saving one policy');
  expect(savedHits.get('GET /api/v1/applicability/policies/{id}?inspection=false')?.length).toBe(1);
  expect([...savedHits.keys()].filter((k) => k === 'GET /api/v1/applicability/policies')).toEqual([]);
});
