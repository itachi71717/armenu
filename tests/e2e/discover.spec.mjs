import { test, expect } from '@playwright/test';
import { trackErrors } from './_util.mjs';

test('discover page loads and renders content', async ({ page }) => {
  const errors = trackErrors(page);
  const res = await page.goto('/discover');
  expect(res && res.status()).toBeLessThan(400);
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.locator('body')).not.toBeEmpty();
  const card = page.locator('[class*="card"], article, a[href*="/m/"]').first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});
