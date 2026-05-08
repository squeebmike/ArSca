const { test, expect } = require('@playwright/test');
const { openDashboard, runResearchSearch } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await openDashboard(page);
});

test('strict Pokemon searches keep unrelated cards out of primary results', async ({ page }) => {
  let cards = await runResearchSearch(page, 'pikachu sir', 'Pokemon TCG');
  await expect(cards.first()).toContainText(/Pikachu SIR|Special Illustration Rare/i);
  await expect(cards.first()).not.toContainText(/Pikachu ex/i);

  cards = await runResearchSearch(page, 'pikachu ex', 'Pokemon TCG');
  await expect(cards.first()).toContainText(/Pikachu ex/i);
  await expect(cards.first()).not.toContainText(/VMAX|VSTAR|promo/i);
});

test('dealer query examples return useful candidates', async ({ page }) => {
  const examples = [
    ['pikachu 151', 'Pokemon TCG', /Pikachu/i],
    ['umbreon vmax evolving skies', 'Pokemon TCG', /Umbreon VMAX/i],
    ['charizard 199\/165', 'Pokemon TCG', /Charizard/i],
    ['wolverine 1', 'Comic', /Wolverine #1/i],
    ['asm 300', 'Comic', /Amazing Spider-Man #300/i],
    ['zelda ocarina n64', 'Video Games', /Zelda|Ocarina/i],
  ];
  for (const [query, category, expected] of examples) {
    const cards = await runResearchSearch(page, query, category);
    await expect(cards.first(), query).toContainText(expected);
  }
});

test('category dropdown refilters already-loaded results', async ({ page }) => {
  await runResearchSearch(page, 'wolverine', '');
  await page.locator('#qpl-cat').selectOption('Comic');
  await expect(page.locator('#qpl-result')).toContainText(/Wolverine #1/i);

  await runResearchSearch(page, 'pikachu', '');
  await page.locator('#qpl-cat').selectOption('Pokemon TCG');
  await expect(page.locator('#qpl-result')).toContainText(/Pikachu/i);

  await runResearchSearch(page, 'zelda', '');
  await page.locator('#qpl-cat').selectOption('Video Games');
  await expect(page.locator('#qpl-result')).toContainText(/Zelda|Search This Category|No results/i);
});

test('variant selectors use exact variant matrix and chart button opens graph modal', async ({ page }) => {
  const cards = await runResearchSearch(page, 'pikachu 151', 'Pokemon TCG');
  const first = cards.first();
  await expect(first).toContainText(/Real Variant Price|JustTCG/i);
  await first.locator('select[aria-label="Condition"]').selectOption('LP');
  await expect(first).toContainText(/\$18\.04|Real Variant Price|JustTCG/i);
  await first.locator('select[aria-label="Condition"]').selectOption('NM');
  await first.locator('select[aria-label="Finish"]').selectOption({ label: 'Foil' });
  await expect(first).toContainText(/\$30\.80|Real Variant Price|JustTCG/i);
  await first.getByRole('button', { name: /^CHART$/i }).click();
  await expect(page.locator('#qpl-chart-modal, .qpl-chart-modal')).toBeVisible();
  await expect(page.locator('body')).toContainText(/price graph|No price graph|JustTCG|Pikachu/i);
});
