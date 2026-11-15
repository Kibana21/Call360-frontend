import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { accounts, signIn } from './helpers';

async function noSeriousViolations(page: Page, name: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${name}: ${v.id} (${v.nodes.length})`)).toEqual([]);
}

for (const width of [1280, 1440]) {
  test(`FE-04 / E2E-17 (partial) accessibility and layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { admin } = accounts();
    await page.goto('/login');
    await noSeriousViolations(page, 'login');
    await page.screenshot({ path: `test-results/screens/login-${width}.png` });
    await signIn(page, admin);
    await noSeriousViolations(page, 'home');
    await page.screenshot({ path: `test-results/screens/home-${width}.png`, fullPage: true });
    await page.goto('/admin/users');
    await expect(page.getByRole('table')).toBeVisible();
    await noSeriousViolations(page, 'users');
    await page.screenshot({ path: `test-results/screens/users-${width}.png`, fullPage: true });
    await page.goto('/admin/audit');
    await expect(page.getByRole('table')).toBeVisible();
    await noSeriousViolations(page, 'audit');
    await page.screenshot({ path: `test-results/screens/audit-${width}.png`, fullPage: true });
    // keyboard: skip link reaches main content
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('FE-04 unauthorized and session-expired screens are accessible', async ({ page }) => {
  const { user } = accounts();
  await page.goto('/session-expired');
  await noSeriousViolations(page, 'session-expired');
  await signIn(page, user, '/admin/users');
  await expect(page).toHaveURL(/unauthorized/);
  await noSeriousViolations(page, 'unauthorized');
  await page.screenshot({ path: `test-results/screens/unauthorized-1440.png`, fullPage: true });
});

for (const width of [1280, 1440]) {
  test(`UI-1…UI-5 mockup fidelity regressions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { admin } = accounts();
    // UI-4: Sign in text centred between the lock icon and chevron.
    await page.goto('/login');
    const button = page.getByRole('button', { name: /sign in/i });
    const [b, t] = await Promise.all([button.boundingBox(), button.getByText('Sign in').boundingBox()]);
    expect(Math.abs((t!.x + t!.width / 2) - (b!.x + b!.width / 2))).toBeLessThanOrEqual(2);

    await signIn(page, admin, '/admin/users');
    // UI-1: 20px above every section heading except the first (mockup .nav-section rules).
    const paddings = await page.locator('.nav-section').evaluateAll((els) => els.map((e) => getComputedStyle(e).paddingTop));
    expect(paddings).toEqual(['6px', '20px', '20px', '20px']);
    // UI-2: no navigation label is truncated.
    const clipped = await page.locator('.navitem > span:nth-child(2)').evaluateAll((els) =>
      els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > (e.closest('.navitem') as HTMLElement).getBoundingClientRect().right)
        .map((e) => e.textContent));
    expect(clipped).toEqual([]);
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByText('SBQ Risk Workbench', { exact: true })).toBeVisible();
    // UI-3: role badges use the mockup colours.
    await expect(page.locator('td .badge', { hasText: 'ADMIN' }).first()).toHaveClass(/purple/);
    await expect(page.locator('td .badge', { hasText: 'USER' }).first()).toHaveClass(/gray/);

    // UI-5: at a short viewport every navigation item is keyboard-reachable and scrolled into view.
    await page.setViewportSize({ width, height: 560 });
    await page.goto('/');
    const labels = await page.locator('.nav-scroll .navitem').evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent ?? ''));
    const reached = new Set<string>();
    for (let i = 0; i < 40 && reached.size < labels.length; i += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el?.classList.contains('navitem')) return null;
        const r = el.getBoundingClientRect();
        return { label: el.querySelector('span')?.textContent ?? '', visible: r.top >= 0 && r.bottom <= window.innerHeight };
      });
      if (focused) { expect(focused.visible, `${focused.label} scrolled into view`).toBe(true); reached.add(focused.label); }
    }
    expect([...reached].sort()).toEqual([...labels].sort());
  });
}
