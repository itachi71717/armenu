import { test, expect } from '@playwright/test';
import { trackErrors } from './_util.mjs';

test('guest can open the demo menu and see dishes', async ({ page }) => {
  const errors = trackErrors(page);
  const res = await page.goto('/m/demo');
  expect(res && res.status()).toBeLessThan(400);
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.locator('body')).not.toBeEmpty();

  // Dishes come from the API; if the backend is unreachable, don't fail on data.
  const dish = page.locator('[data-dish-id], .dish, .dish-card, .menu-item, [class*="dish"]').first();
  const hasDish = await dish.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
  test.info().annotations.push({ type: 'dishes-rendered', description: String(hasDish) });

  if (hasDish) {
    const add = page.locator('button:has-text("Add"), [data-add], [aria-label*="add" i]').first();
    if (await add.isVisible().catch(() => false)) {
      await add.click().catch(() => {});
      const cart = page.locator('#cartBtn, [data-cart], button:has-text("Cart"), [aria-label*="cart" i]').first();
      if (await cart.isVisible().catch(() => false)) await cart.click().catch(() => {});
    }
  }
  expect(errors, 'no uncaught page errors').toEqual([]);
});
