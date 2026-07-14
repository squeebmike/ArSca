const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { openDashboard } = require('./helpers');

test('dashboard html and worker scripts parse', async () => {
  const root = path.resolve(__dirname, '..');
  for (const file of ['dashboard.html', 'sca.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
    for (const [index, code] of scripts.entries()) {
      expect(() => new Function(code), `${file} script ${index + 1}`).not.toThrow();
    }
  }
  const worker = fs.readFileSync(path.join(root, 'cloudflare-worker-full.js'), 'utf8').replace(/^export default/m, 'const __worker =');
  expect(() => new Function(worker), 'cloudflare worker parse').not.toThrow();
});

test('dashboard loads current build with primary nav and Research tab', async ({ page }) => {
  const guard = await openDashboard(page);
  await expect(page.locator('.logo')).toContainText(/WALK-OFF|DEMO DASHBOARD/i);
  const metaVersion = await page.locator('meta[name="version"]').getAttribute('content');
  const runtimeVersion = await page.evaluate(() => window.APP_VERSION);
  expect(metaVersion).toBe(runtimeVersion);
  await expect(page.locator('[data-tab="overview"]')).toBeVisible();
  await expect(page.locator('[data-tab="research"]')).toBeVisible();
  await expect(page.locator('#top-show-chip')).toContainText(/NO SHOW ACTIVE|SHOW ACTIVE/);
  await expect(page.locator('#top-drawer-chip')).toContainText(/CASH BAG/);
  await page.locator('[data-tab="research"]').click();
  await expect(page.locator('#tab-research.on')).toBeVisible();
  await expect(page.getByRole('button', { name: /Queue/i })).toBeVisible();
  await expect(page.locator('#register-quick-panel')).toBeVisible();
  guard.assertClean();
});

test('operational outbox survives reload without the old 500-entry cap', async ({ page }) => {
  const guard = await openDashboard(page);
  const count = await page.evaluate(async () => {
    await syncOutboxReady;
    const now = new Date().toISOString();
    const queue = Array.from({ length: 525 }, (_, index) => ({
      id:`qa_outbox_${index}`,
      type:'qa-durability',
      label:`Durability item ${index}`,
      payload:{ index },
      error:'',
      status:'pending',
      attempts:0,
      createdAt:now,
      updatedAt:now
    }));
    await saveSyncQueue(queue);
    return getSyncQueue().length;
  });
  expect(count).toBe(525);
  await page.reload({ waitUntil:'domcontentloaded' });
  const restored = await page.evaluate(async () => {
    await syncOutboxReady;
    const count = getSyncQueue().filter(item => item.type === 'qa-durability').length;
    await saveSyncQueue(getSyncQueue().filter(item => item.type !== 'qa-durability'));
    return count;
  });
  expect(restored).toBe(525);
  guard.assertClean();
});

test('tracked sealed inventory decrements quantity and blocks overselling', async ({ page }) => {
  const guard = await openDashboard(page);
  const result = await page.evaluate(async () => {
    localStorage.setItem('pos_cart_v2', JSON.stringify({ items:[], discount:0 }));
    const item = { id:'qa_sealed_qty', source:'built_in', name:'QA Booster Box', category:'Sealed Product', status:'in_stock', lifecycle:'in_stock', qty:3, market:100 };
    all.push(item);
    const first = addSaleItemToCart(item, { sourceType:'sealed', inventoryId:item.id, unitPrice:100, quantity:2 });
    const oversell = addSaleItemToCart(item, { sourceType:'sealed', inventoryId:item.id, unitPrice:100, quantity:2 });
    await markCartItemsSoldFromPayment([{ shopId:item.id, name:item.name, price:100, quantity:2 }], 'cash', new Date().toISOString(), { skipRemote:true });
    const afterTwo = { qty:item.qty, status:item.status };
    localStorage.setItem('pos_cart_v2', JSON.stringify({ items:[], discount:0 }));
    await markCartItemsSoldFromPayment([{ shopId:item.id, name:item.name, price:100, quantity:1 }], 'cash', new Date().toISOString(), { skipRemote:true });
    const afterThree = { qty:item.qty, status:item.status };
    all = all.filter(candidate => candidate.id !== item.id);
    return { first:!!first, oversell:!!oversell, afterTwo, afterThree };
  });
  expect(result).toEqual({
    first:true,
    oversell:false,
    afterTwo:{ qty:1, status:'in_stock' },
    afterThree:{ qty:0, status:'sold' }
  });
  guard.assertClean();
});

test('research and drawer use contextual actions and starting cash wording', async ({ page }) => {
  const guard = await openDashboard(page);
  await page.locator('[data-tab="research"]').click();
  await expect(page.locator('#research-actions-panel')).toBeHidden();
  await expect(page.locator('#tab-research')).not.toContainText('ADD SELECTED TO BUY OFFER');
  await expect(page.locator('#tab-research')).not.toContainText('ADD SELECTED TO INVENTORY');
  await expect(page.locator('#tab-research')).not.toContainText('ADD SELECTED TO SALE CART');

  await page.locator('#top-drawer-chip').click();
  await expect(page.locator('#tab-shows.on')).toBeVisible();
  await expect(page.locator('#drawer-closed-view')).toContainText('Starting Cash');
  await page.locator('#drawer-float').fill('200');
  await page.getByRole('button', { name: 'START BAG' }).click();
  await expect(page.locator('#drawer-open-view')).toBeVisible();
  await expect(page.locator('#drawer-open-view')).toContainText('STARTING CASH');
  await expect(page.locator('#drawer-open-view')).toContainText('EXPECTED CASH');
  await expect(page.locator('#drawer-open-view')).toContainText('COUNTED CASH');
  await expect(page.locator('#drawer-float-disp')).toHaveText('$200.00');
  await expect(page.locator('#drawer-expected-disp')).toHaveText('$200.00');
  await expect(page.locator('#top-drawer-chip')).toContainText('$200.00');
  await page.getByRole('button', { name: 'HIDE TOTALS' }).click();
  await expect(page.locator('#top-drawer-chip')).toContainText(/CASH BAG/);
  await expect(page.locator('#drawer-float-disp')).toHaveClass(/drawer-money-hidden/);
  await expect(page.locator('#drawer-expected-disp')).toHaveClass(/drawer-money-hidden/);
  guard.assertClean();
});

test('Pokemon lookup shows a recoverable offline state without cache', async ({ page }) => {
  const guard = await openDashboard(page);
  await page.context().setOffline(true);
  await page.locator('[data-tab="research"]').click();
  await page.locator('.qpl-cat-pill[data-cat="Pokemon TCG"]').click();
  await page.locator('#qpl-input').fill('pikachu 151');
  await page.getByRole('button', { name: 'LOOK UP' }).click();
  await expect(page.locator('#pokemon-offline-banner')).toContainText(/Offline Mode/i);
  await expect(page.locator('#qpl-result')).toContainText(/No cached|OPEN OFFLINE CACHE|DOWNLOAD CATALOG/i);
  await page.context().setOffline(false);
  guard.assertClean();
});

test('auth check workbench uses risk language and missing-check evidence', async ({ page }) => {
  const guard = await openDashboard(page);
  await page.evaluate(() => {
    const item = window.upsertDealerItem({
      identity: {
        category: 'Pokemon',
        title: 'Charizard ex SIR',
        setName: 'Scarlet & Violet 151',
        cardNumber: '199/165',
        printing: 'Special Illustration Rare',
        language: 'English',
      },
      workflow: { stage: 'auth_pending', queueMembership: ['authQueue'] },
    }, 'qa_auth_item_created');
    window.enqueueDealerItem(item.itemId, 'authQueue', 'auth_pending');
    window.openItemInAuthCheck(item.itemId);
  });
  await expect(page.locator('#tab-authcheck.on')).toBeVisible();
  await page.getByRole('button', { name: /run auth check/i }).click();
  await expect(page.locator('#auth-decision-body')).toContainText(/Manual Review Required|High Risk|Medium Risk/);
  await expect(page.locator('#auth-decision-body')).toContainText(/Confidence:/);
  await expect(page.locator('#auth-decision-body')).toContainText(/Front photo|Back photo/);
  await expect(page.locator('#auth-decision-body')).not.toContainText(/\bFake\b|\bReal\b/);
  guard.assertClean();
});
