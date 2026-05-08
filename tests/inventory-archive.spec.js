const { test, expect } = require('@playwright/test');
const { openDashboard } = require('./helpers');

test('inventory item can be archived and restored without hard delete', async ({ page }) => {
  await openDashboard(page);
  await page.locator('[data-tab="inventory"]').click();
  await expect(page.locator('body')).toContainText(/Wolverine #1/i);
  await page.evaluate(async () => {
    window.prompt = () => 'QA archive test';
    await archiveInventoryItem('qa-inv-wolverine-1');
  });
  await page.getByRole('button', { name: /^Archived$/i }).click();
  await expect(page.locator('body')).toContainText(/Wolverine #1/i);
  const archived = await page.evaluate(() => all.find(i => i.id === 'qa-inv-wolverine-1')?.status);
  expect(archived).toBe('archived');
  await page.evaluate(async () => restoreInventoryItem('qa-inv-wolverine-1'));
  const restored = await page.evaluate(() => all.find(i => i.id === 'qa-inv-wolverine-1')?.status);
  expect(restored).toBe('in_stock');
});
