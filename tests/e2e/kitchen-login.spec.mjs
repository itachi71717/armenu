import { test, expect } from '@playwright/test';

test('kitchen shows a PIN gate', async ({ page }) => {
  const res = await page.goto('/kitchen');
  expect(res && res.status()).toBeLessThan(400);
  await expect(page.locator('body')).toContainText(/pin|sign in|log in|staff/i, { timeout: 15_000 });
  await expect(page.locator('input, button').first()).toBeVisible();
});
