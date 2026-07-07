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

test('research quantity expands into separate buy offer inventory lines', async ({ page }) => {
  await openDashboard(page);
  const cards = await runResearchSearch(page, 'pikachu 151', 'Pokemon TCG');
  await cards.first().locator('input[aria-label="Quantity"]').fill('2');
  await cards.first().getByRole('button', { name: /ADD TO BUY/i }).click();
  const buyList = await page.evaluate(() => JSON.parse(localStorage.getItem('pos_buy_list') || '[]'));
  const pikachuLines = buyList.filter(item => /Pikachu/i.test(item.name));
  expect(pikachuLines).toHaveLength(2);
  expect(pikachuLines.every(item => Number(item.quantity || 1) === 1)).toBe(true);
  expect(pikachuLines.every(item => Number(item.sourceQuantity || 0) === 2)).toBe(true);
});
