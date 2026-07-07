const { test, expect } = require('@playwright/test');
const { openDashboard } = require('./helpers');

test('inventory item can be archived and restored without hard delete', async ({ page }) => {
  await openDashboard(page);
  await page.locator('[data-tab="inventory"]').click();
  await expect(page.locator('body')).toContainText(/Amazing Spider-Man/i);
  const itemId = await page.evaluate(() => all.find(i => /Amazing Spider-Man/i.test(i.name))?.id);
  expect(itemId).toBeTruthy();
  await page.evaluate(async () => {
    window.prompt = () => 'QA archive test';
    const itemId = all.find(i => /Amazing Spider-Man/i.test(i.name))?.id;
    await archiveInventoryItem(itemId);
  });
  await page.getByRole('button', { name: /^Archived$/i }).click();
  await expect(page.locator('body')).toContainText(/Amazing Spider-Man/i);
  const archived = await page.evaluate(itemId => all.find(i => i.id === itemId)?.status, itemId);
  expect(archived).toBe('archived');
  await page.evaluate(async itemId => restoreInventoryItem(itemId), itemId);
  const restored = await page.evaluate(itemId => all.find(i => i.id === itemId)?.status, itemId);
  expect(restored).toBe('in_stock');
});
