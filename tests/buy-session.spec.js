const { test, expect } = require('@playwright/test');
const { openDashboard, runResearchSearch } = require('./helpers');

test('selected Research result renders Buy and Sell actions without an availability ReferenceError', async ({ page }) => {
  await openDashboard(page);
  await page.locator('[data-tab="research"]').click();
  await page.evaluate(async () => {
    qplResults = [{
      id:'qa-selected-item', name:'QA Selected Card', category:'Collectibles',
      source:'inventory', raw:{ id:'qa-selected-item', status:'in_stock', quantity:1 },
      market:12, condition:'NM', set:'QA Set', year:'2026'
    }];
    await selectQuickLookupResult(0);
  });
  await expect(page.locator('.qpl-selected-card')).toContainText('QA Selected Card');
  await expect(page.locator('.qpl-selected-card').getByRole('button', { name:'ADD TO BUY' })).toBeEnabled();
  await expect(page.locator('.qpl-selected-card').getByRole('button', { name:'SELL' })).toBeEnabled();
});

test('direct trade handoff subtracts credit on Sell and carries it into checkout', async ({ page }) => {
  await openDashboard(page);
  await page.evaluate(() => {
    const credit = issueStoreCredit({ customerName:'QA Trade Customer', amount:20, buySessionId:'qa-trade-session' });
    localStorage.setItem('pos_pending_trade_purchase', JSON.stringify({ creditId:credit.id, buySessionId:'qa-trade-session' }));
    const cart = { items:[{ id:'qa-sale-item', name:'QA Purchase Item', price:50, cost:10, quantity:1 }], total:50, subtotal:50, discount:0 };
    saveCartDataLocal(cart, 'QA direct trade handoff');
    switchTab('display');
    renderDealerCartTools(cart);
  });
  await expect(page.locator('#dealer-cart-lines')).toContainText('QA Purchase Item');
  await expect(page.locator('#dealer-cart-total')).toContainText('SUBTOTAL $50.00');
  await expect(page.locator('#dealer-cart-total')).toContainText('TRADE CREDIT');
  await expect(page.locator('#dealer-cart-total')).toContainText('BALANCE $30.00');
  await page.getByRole('button', { name:/CHECKOUT & TAKE PAYMENT/i }).click();
  await expect(page.locator('#customer-payment-workbench')).toContainText('$20.00 trade credit applied');
});

test('Sell supports multiple named carts with images, price detail, and no cost or profit', async ({ page }) => {
  await openDashboard(page);
  const firstId = await page.evaluate(async () => {
    const first = ensureActiveSaleCart();
    renameActiveSaleCart('Alice');
    saveCartDataLocal({ ...first, customerName:'Alice', items:[{ id:'alice-line', name:'Alice Card', price:40, originalPrice:50, imageUrl:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', quantity:1 }] }, 'QA Alice cart');
    startNewSaleCart();
    renameActiveSaleCart('Bob');
    const bob = ensureActiveSaleCart();
    saveCartDataLocal({ ...bob, customerName:'Bob', items:[{ id:'bob-line', name:'Bob Card', price:25, quantity:1 }] }, 'QA Bob cart');
    await switchSaleCart(first.cartId);
    switchTab('display');
    await renderCustomerDisplay();
    return first.cartId;
  });
  expect(firstId).toBeTruthy();
  await expect(page.locator('#sale-cart-switcher')).toContainText('Alice');
  await expect(page.locator('#sale-cart-switcher')).toContainText('Bob');
  await expect(page.locator('#dealer-cart-lines')).toContainText('Alice Card');
  await expect(page.locator('#dealer-cart-lines')).toContainText('Was $50.00');
  await expect(page.locator('#dealer-cart-lines img.dealer-line-image')).toHaveCount(1);
  await expect(page.locator('#dealer-cart-lines').getByRole('button', { name:'EDIT' })).toBeVisible();
  await expect(page.locator('#dealer-cart-lines')).not.toContainText(/Cost|Profit/);
});

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
