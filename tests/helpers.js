const { expect } = require('@playwright/test');
const path = require('path');
const { installConsoleGuard } = require('./fixtures/consoleGuard');
const { seedDemoStore, mockWalkoffApis } = require('./test-data');

function appUrl(fileName) {
  if (process.env.WALKOFF_BASE_URL) return fileName;
  const fullPath = path.resolve(__dirname, '..', fileName);
  return 'file:///' + fullPath.replace(/\\/g, '/');
}

async function openDashboard(page, target = 'dashboard.html') {
  await mockWalkoffApis(page);
  await seedDemoStore(page);
  const guard = await installConsoleGuard(page, {
    allowRequest: [/favicon/i, /supabase/i],
  });
  await page.goto(appUrl(target), { waitUntil: 'domcontentloaded' });
  const auth = page.locator('#auth-screen.on');
  if (await auth.count()) {
    await page.getByRole('button', { name: /local demo/i }).click();
  }
  await expect(page.locator('.tabs')).toBeVisible();
  return guard;
}

async function openScanner(page, target = 'sca.html') {
  await mockWalkoffApis(page);
  await seedDemoStore(page);
  const guard = await installConsoleGuard(page, {
    allowRequest: [/favicon/i, /supabase/i],
  });
  await page.goto(appUrl(target), { waitUntil: 'domcontentloaded' });
  return guard;
}

async function runResearchSearch(page, query, category = '') {
  await page.locator('[data-tab="research"]').click();
  if (category) await page.locator('#qpl-cat').selectOption(category);
  await page.locator('#qpl-input').fill(query);
  await page.getByRole('button', { name: /^LOOK UP$/ }).click();
  await expect(page.locator('#qpl-result')).not.toContainText('Searching local inventory', { timeout: 15_000 });
  return page.locator('.qpl-hero-card');
}

module.exports = { openDashboard, openScanner, runResearchSearch };
