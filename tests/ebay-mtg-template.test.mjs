import assert from 'node:assert/strict';
import fs from 'node:fs';

// Store request: an eBay listing template for Magic: The Gathering in the
// same branded HTML style as the comic template, built for the Secret Lair
// Commander Deck: Goblin Storm -- and it has to work for singles too. One
// category template serves both, so computeEbayListingFields now emits
// tokens that are filled for one kind and blank for the other.

const app = fs.readFileSync('scripts/dashboard-app.js', 'utf8');
const template = fs.readFileSync('templates/ebay/magic-the-gathering.html', 'utf8');
function extract(name) {
  const start = app.indexOf('function ' + name + '(');
  assert.ok(start !== -1, name + ' must exist');
  let depth = 0, i = app.indexOf('{', app.indexOf(')', start));
  for (; i < app.length; i++) { if (app[i] === '{') depth++; else if (app[i] === '}' && --depth === 0) break; }
  return app.slice(start, i + 1);
}
const lib = new Function(extract('ebayItemIsSealed') + '\n' + extract('ebaySealedSingleTokens') + '\n' + extract('renderEbayDescriptionTemplate') + '\nreturn { ebayItemIsSealed, ebaySealedSingleTokens, renderEbayDescriptionTemplate };')();

// The real Goblin Storm row, trimmed to the fields that matter.
const goblin = { name:'Magic Secret Lair Drop Series Secret Lair Commander Deck Goblin Storm', category:'Magic: The Gathering', set:'Magic: The Gathering', variant:'Factory Sealed', condition:'NM', selectedFinish:'sealed', configuration:'Secret Lair' };
const crop = { name:'Crop Rotation', category:'Magic: The Gathering', set:'Secrets of Strixhaven Mystical Archive', card_number:'51', variant:'Showcase · Rare', condition:'NM', selectedFinish:'normal', artist:'Seb McKinnon' };
const sonic = { name:'Magic Secret Lair Drop Series Secret Lair x Sonic The Hedgehog Superdrop Turbo Gear Non Foil', category:'Magic: The Gathering', set:'Magic: The Gathering', rarity:'Factory Sealed', variant:'Factory Sealed', condition:'NM', selectedFinish:'sealed' };

assert.equal(lib.ebayItemIsSealed(goblin), true, 'a sealed finish marks it sealed even though the name never says "sealed"');
assert.equal(lib.ebayItemIsSealed(crop), false);

function render(item, extra = {}) {
  const isSealed = /box|blaster|mega|hobby|pack|case|tin|sealed/.test(item.name.toLowerCase()) || lib.ebayItemIsSealed(item);
  const finish = item.finish || item.printing || item.selectedFinish || '';
  const tokens = { title:item.name, set:item.set, variant:item.variant, cardNumber:item.card_number || '', rarity:item.rarity || '', finish, condition:'Near Mint', language:'', grade:'', notes:'',
    shippingLine:isSealed ? 'Sealed product ships boxed with extra padding to protect the original packaging. Ships within 1 business day with tracking.' : 'Cards ship in a penny sleeve and toploader inside a bubble mailer to prevent bending. Ships within 1 business day with tracking.', ...extra };
  Object.assign(tokens, lib.ebaySealedSingleTokens(item, { isSealed, condText:'Near Mint', finish, inferConfig:item.configuration || '' }));
  return { html:lib.renderEbayDescriptionTemplate(template, tokens), tokens };
}

{
  const { html, tokens } = render(goblin);
  assert.equal(tokens.sealedProduct, 'Secret Lair Commander Deck');
  assert.equal(tokens.setName, '', '"Magic: The Gathering" as the set is just the game name again');
  assert.match(html, /SEALED PRODUCT DETAILS/);
  assert.match(html, /Product: Secret Lair Commander Deck/);
  assert.match(html, /Condition: Factory sealed, unopened/);
  assert.match(html, /Factory sealed and unopened -- a Secret Lair Commander Deck/);
  assert.match(html, /Sealed product ships boxed/);
  assert.doesNotMatch(html, /CARD DETAILS|Finish:|Rarity:|Near Mint|Treatment/, 'no single-card lines on a sealed deck');
  assert.doesNotMatch(html, /\[\[|\]\]|\{\w+\}/, 'no leftover brackets or tokens');
  assert.equal((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length, 'every section opens and closes');
}
{
  const { html, tokens } = render(crop);
  assert.equal(tokens.cardFinish, 'Non-Foil');
  assert.match(html, /CARD DETAILS/);
  assert.match(html, /Set: Secrets of Strixhaven Mystical Archive/);
  assert.match(html, /Card number: 51/);
  assert.match(html, /Treatment \/ variant: Showcase · Rare/);
  assert.match(html, /Artist: Seb McKinnon/);
  assert.match(html, /Condition: Near Mint/);
  assert.match(html, /Single Card • #51 • Non-Foil • Showcase · Rare • Near Mint/);
  assert.match(html, /penny sleeve and toploader/);
  assert.doesNotMatch(html, /SEALED PRODUCT|Factory sealed/);
  assert.doesNotMatch(html, /\[\[|\]\]|\{\w+\}/);
  assert.equal((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length);
}
{
  const { html, tokens } = render(sonic);
  assert.equal(tokens.cardRarity, '', '"Factory Sealed" in the rarity field is not a rarity');
  assert.equal(tokens.sealedProduct, 'Secret Lair Drop');
  assert.match(html, /Factory Sealed/);
  assert.doesNotMatch(html, /Rarity:/);
}
{
  // The ✨ AI DESCRIPTION paragraph lands inside the same layout.
  const { html } = render(crop, { aiSummary:'A Mystical Archive staple for lands decks.' });
  assert.match(html, /<div style="font-size:13px;margin-top:8px">A Mystical Archive staple for lands decks\.<\/div>/);
}

// Wiring inside computeEbayListingFields.
assert.match(app, /const isSealed = \/box\|blaster\|mega\|hobby\|pack\|case\|tin\|sealed\/\.test\(lowerName\) \|\| ebayItemIsSealed\(item\);/);
assert.match(app, /Object\.assign\(tokens, ebaySealedSingleTokens\(item, \{ isSealed, isGraded, isComic, condText, finish:tokens\.finish, inferConfig \}\)\);/);
assert.match(app, /\{productKind\} \{setName\} \{cardHeading\} \{cardCondition\} \{cardFinish\} \{cardRarity\} \{cardVariant\} \{sealedHeading\} \{sealedProduct\}/, 'the settings help lists the new tokens');

// Store report listing the Goblin Storm deck: "Publish failed (400): ... invalid
// item condition information. Item condition is required for this category."
// Sealed product is New; the fallback condition list had no New at all.
assert.match(app, /const isFactorySealed = !isGraded && \(ebayItemIsSealed\(item\) \|\| \/\\b\(factory \)\?sealed\\b\/\.test\(lowerName\)\);/);
assert.match(app, /const conditionId = \(isPresaleItem \|\| isFactorySealed\) \? '1000'/);
assert.match(app, /<option value="1000" \$\{keep==='1000'\?'selected':''\}>New \/ Factory Sealed<\/option>/);
assert.match(app, /This is factory sealed -- this category is for single cards/);
assert.equal(lib.ebayItemIsSealed({ name:'Justin Martin Showcase', variant:'Showcase · Rare', selectedFinish:'normal' }), false, 'a single is never New-by-default');

console.log('MTG eBay template (sealed deck + singles) checks passed');
