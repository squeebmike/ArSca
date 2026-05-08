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
  await expect(page.locator('.logo')).toContainText(/2026\.05\.08\.02/);
  await expect(page.locator('[data-tab="overview"]')).toBeVisible();
  await expect(page.locator('[data-tab="research"]')).toBeVisible();
  await page.locator('[data-tab="research"]').click();
  await expect(page.locator('#tab-research.on')).toBeVisible();
  await expect(page.locator('#research-queue-panel')).toBeVisible();
  await expect(page.locator('#register-quick-panel')).toBeVisible();
  guard.assertClean();
});
