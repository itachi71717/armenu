import { test, expect } from '@playwright/test';
import { trackErrors } from './_util.mjs';

test('portal renders a login/sign-in UI', async ({ page }) => {
  const errors = trackErrors(page);
  const res = await page.goto('/portal/');
  expect(res && res.status()).toBeLessThan(400);
  await expect(page.locator('body')).toContainText(/sign in|log in|login|email|portal/i, { timeout: 15_000 });
  expect(errors).toEqual([]);
});
