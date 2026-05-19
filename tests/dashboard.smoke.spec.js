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
  await expect(page.locator('.logo')).toContainText(/WALK-OFF/i);
  await expect(page.locator('.logo')).toContainText(/2026\.05\.19\.02/);
  await expect(page.locator('[data-tab="overview"]')).toBeVisible();
  await expect(page.locator('[data-tab="research"]')).toBeVisible();
  await expect(page.locator('[data-tab="authcheck"]')).toBeVisible();
  await expect(page.locator('#top-show-chip')).toContainText(/NO SHOW ACTIVE|SHOW ACTIVE/);
  await expect(page.locator('#top-drawer-chip')).toContainText(/DRAWER/);
  await page.locator('[data-tab="research"]').click();
  await expect(page.locator('#tab-research.on')).toBeVisible();
  await expect(page.locator('#research-queue-panel')).toBeVisible();
  await expect(page.locator('#register-quick-panel')).toBeVisible();
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
  await page.getByRole('button', { name: 'OPEN DRAWER' }).click();
  await expect(page.locator('#drawer-open-view')).toBeVisible();
  await expect(page.locator('#drawer-open-view')).toContainText('STARTING CASH');
  await expect(page.locator('#drawer-open-view')).toContainText('EXPECTED CASH');
  await expect(page.locator('#drawer-open-view')).toContainText('COUNTED CASH');
  await expect(page.locator('#drawer-float-disp')).toHaveText('$200.00');
  await expect(page.locator('#drawer-expected-disp')).toHaveText('$200.00');
  await expect(page.locator('#top-drawer-chip')).toContainText('$200.00');
  await page.getByRole('button', { name: 'HIDE TOTALS' }).click();
  await expect(page.locator('#top-drawer-chip')).toHaveText('DRAWER OPEN');
  await expect(page.locator('#drawer-float-disp')).toHaveClass(/drawer-money-hidden/);
  await expect(page.locator('#drawer-expected-disp')).toHaveClass(/drawer-money-hidden/);
  guard.assertClean();
});

test('Pokemon lookup uses cached results while offline', async ({ page }) => {
  const guard = await openDashboard(page);
  await page.evaluate(async () => {
    const row = {
      source: 'justtcg',
      name: 'Pikachu',
      category: 'Pokemon TCG',
      set: 'Scarlet & Violet 151',
      card_number: '025/165',
      market: 12.34,
      imageUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22168%22%3E%3Crect width=%22120%22 height=%22168%22 fill=%22%2307080a%22/%3E%3Ctext x=%2210%22 y=%2284%22 fill=%22%2300ffb3%22 font-size=%2212%22%3EPikachu%3C/text%3E%3C/svg%3E',
      priceSource: 'JustTCG Exact Variant',
      availableVariants: [{ condition: 'NM', finish: 'normal', language: 'English', marketPrice: 12.34 }]
    };
    await window.savePokemonCacheResults('pikachu 151', [row], 'QA cached Pokemon');
  });
  await page.context().setOffline(true);
  await page.locator('[data-tab="research"]').click();
  await page.locator('#qpl-cat').selectOption('Pokemon TCG');
  await page.locator('#qpl-input').fill('pikachu 151');
  await page.getByRole('button', { name: 'LOOK UP' }).click();
  await expect(page.locator('#pokemon-offline-banner')).toContainText(/Offline Mode|cached/i);
  await expect(page.locator('#qpl-result')).toContainText('Pikachu');
  await expect(page.locator('#qpl-result')).toContainText(/Cached|Offline/i);
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
