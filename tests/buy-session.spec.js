const { test, expect } = require('@playwright/test');
const { openDashboard, runResearchSearch } = require('./helpers');

test('research result can be added to Buy Offer with source and price data', async ({ page }) => {
  await openDashboard(page);
  const cards = await runResearchSearch(page, 'pikachu 151', 'Pokemon TCG');
  await cards.first().getByRole('button', { name: /ADD TO BUY/i }).click();
  await page.locator('[data-tab="intake"]').click();
  await expect(page.locator('#register-buy-panel')).toContainText(/Pikachu/i);
  await expect(page.locator('#register-buy-panel')).toContainText(/\$|JustTCG|QA fixture/i);
});

test('research result can be added to sale cart', async ({ page }) => {
  await openDashboard(page);
  const cards = await runResearchSearch(page, 'pikachu 151', 'Pokemon TCG');
  await cards.first().getByRole('button', { name: /ADD TO CART/i }).click();
  const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('pos_cart_v2') || '{"items":[]}'));
  expect(cart.items.some(item => /Pikachu/i.test(item.name))).toBe(true);
});
