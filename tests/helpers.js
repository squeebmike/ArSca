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
    allowConsole: [/ERR_NETWORK_ACCESS_DENIED/i, /ERR_INTERNET_DISCONNECTED/i, /URL scheme "file" is not supported/i],
    allowRequest: [/favicon/i, /supabase/i, /cdn\.jsdelivr\.net/i, /swarnerauto\.workers\.dev/i],
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
    allowConsole: [/ERR_NETWORK_ACCESS_DENIED/i, /ERR_INTERNET_DISCONNECTED/i, /URL scheme "file" is not supported/i],
    allowRequest: [/favicon/i, /supabase/i, /cdn\.jsdelivr\.net/i, /swarnerauto\.workers\.dev/i],
  });
  await page.goto(appUrl(target), { waitUntil: 'domcontentloaded' });
  return guard;
}

async function runResearchSearch(page, query, category = '') {
  await page.locator('[data-tab="research"]').click();
  if (category) {
    const pill = page.locator(`.qpl-cat-pill[data-cat="${category}"]`).first();
    if (await pill.count()) {
      await pill.click();
    } else {
      await page.locator('#qpl-cat').evaluate((select, value) => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, category);
    }
  }
  await page.locator('#qpl-input').fill(query);
  await page.getByRole('button', { name: /^LOOK UP$/ }).click();
  await expect(page.locator('#qpl-result')).not.toContainText(/Searching local (inventory|cache)/i, { timeout: 15_000 });
  return page.locator('.qpl-hero-card');
}

module.exports = { openDashboard, openScanner, runResearchSearch };
