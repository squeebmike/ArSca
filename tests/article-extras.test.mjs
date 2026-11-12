import assert from 'node:assert/strict';
import { fillImageAlts, linkBookMentions, coverArtists, alsoLove, quickAnswers, renderQuickAnswers, nice } from '../scripts/article-extras.mjs';
import { renderArticlePage } from '../scripts/comic-articles.mjs';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Cover artists from variant titles, every naming style the store's catalog uses.
assert.deepEqual(coverArtists('SPIDER-WOMAN #1 COVER E MARK BROOKS VARIANT').map(nice), ['Mark Brooks']);
assert.deepEqual(coverArtists('MIDNIGHT X-MEN #1 COVER F CLAYTON CRAIN 3-PART CONNECTING VARIANT').map(nice), ['Clayton Crain']);
assert.deepEqual(coverArtists('UNCANNY X-MEN #38 PEACH MOMOKO MOMO-TONE VARIANT').map(nice), ['Peach Momoko']);
assert.deepEqual(coverArtists('Teenage Mutant Ninja Turtles #23 Variant B (Eastman & Bishop)'), ['Eastman', 'Bishop']);
assert.deepEqual(coverArtists('Dungeons & Dragons #1 (CVR B) (Tyler Jacobson)'), ['Tyler Jacobson']);
assert.deepEqual(coverArtists('SPIDER-WOMAN #1 COVER A'), []);
assert.equal(nice('SPIDER-WOMAN #1'), 'Spider-Woman #1'); assert.equal(nice('Midnight X-Men'), 'Midnight X-Men');

// 1. Images get descriptions; ones that have them keep them.
const alts = fillImageAlts('<figure><img src="a.jpg" alt=""></figure><p>This cover by Mark Brooks is great. Yes.</p><img src="b.jpg"><p>Wow.</p><img src="c.jpg" alt="Mine">', 'Spider-Woman returns', 'SPIDER-WOMAN #1');
assert.ok(alts.includes('alt="Spider-Woman #1: This cover by Mark Brooks is great."'));
assert.ok(alts.includes('<img src="b.jpg" alt="Spider-Woman #1 (image 2)">'));
assert.ok(alts.includes('alt="Mine"'));

// 2. The first mention of a book links to it; never inside a link or a tag.
const linked = linkBookMentions('<p title="Spider-Woman #1">Spider-Woman #1 is out, and <a href="/x">Spider-Woman #1</a>; spider-woman #1 again. Spider-Woman #12 too.</p>', [{ name: 'SPIDER-WOMAN #1', href: '/item/1/spider-woman-1' }]);
assert.equal((linked.match(/href="\/item\/1\/spider-woman-1"/g) || []).length, 1);
assert.ok(linked.includes('title="Spider-Woman #1"'), 'attributes untouched');
assert.ok(linked.includes('<a href="/item/1/spider-woman-1">Spider-Woman #1</a> is out'));
assert.ok(!/<a href="\/item\/1\/spider-woman-1">Spider-Woman #12/.test(linked));

// 4. "You may also love": same cover artist first, then same series, then same characters; nothing already on the page.
const comics = ['SPIDER-WOMAN #1 COVER E MARK BROOKS VARIANT', 'VENOM #1', 'VENOM #1 JOHN ROMITA JR. VARIANT', 'MIDNIGHT SPIDER-MAN #1 COVER F CLAYTON CRAIN 3-PART CONNECTING VARIANT', 'AVENGERS #1 MARK BROOKS VARIANT', 'Gambit #3', 'SPIDER-WOMAN #1 COVER B NOGI SAN SENSATIONAL VARIANT']
  .map((name, i) => ({ id: 'c' + i, name, price: 5, image: 'https://x/' + i + '.jpg', href: '/item/c' + i + '/x' }));
const statuses = [{ name: 'SPIDER-WOMAN #1', state: 'in_stock', href: '/item/c0/x', onSale: '2026-11-05T12:00:00Z', stock: [{ id: 'c0', name: comics[0].name, price: 4.99 }, { id: 'c9', name: 'SPIDER-WOMAN #1 COVER C STONEHOUSE NOIR VARIANT', price: 4.99 }] }];
const text = 'Spider-Woman #1. Cletus Kasady, host of Carnage, offspring of Venom. Here is a cover by Mark Brooks and one by Clayton Crain.';
const picks = alsoLove({ text, statuses, comics });
assert.deepEqual(picks.slice(0, 2).map(p => p.c.id).sort(), ['c3', 'c4'], 'cover artists he names first');
assert.deepEqual(picks.slice(2).map(p => p.c.id), ['c6', 'c1'], 'then the same series, then the same characters; one per book');
assert.equal(picks.find(p => p.c.id === 'c4').why, 'Cover by Mark Brooks');
assert.ok(!picks.some(p => p.c.id === 'c0'), 'not what the page already shows');
assert.ok(!picks.some(p => p.c.id === 'c5'), 'nothing unrelated');

// 3. Quick answers from the catalog, marked up as an FAQ.
const qa = quickAnswers(statuses, Date.parse('2026-11-12'));
assert.deepEqual(qa.map(q => q[0]), ['When did Spider-Woman #1 come out?', 'Who drew the Spider-Woman #1 variant covers?', 'Where can I buy Spider-Woman #1?']);
assert.ok(qa[1][1].includes('Mark Brooks and Stonehouse'));
assert.ok(qa[2][1].includes('2 covers of Spider-Woman #1 in stock from $4.99'));
const faq = renderQuickAnswers(qa, esc);
assert.ok(faq.includes('<h2>Quick answers</h2>') && faq.includes('"@type":"FAQPage"') && !faq.includes('</script><'), 'FAQ markup');
assert.equal(renderQuickAnswers([], esc), '');

// The page has all four.
const page = renderArticlePage({ slug: 'spider-woman-1', title: 'Spider-Woman #1 The return', summary: 'Carnage is back', author: 'S.A. Van Overbeke', facts: [], books: ['SPIDER-WOMAN #1'], bodyHtml: '<figure><img src="https://x/a.jpg" alt=""></figure><p>Spider-Woman #1 is great. ' + text + '</p>' }, statuses, [], { esc, pageShell: p => p.bodyHtml, alsoLoveComics: comics, storeId: 's' });
assert.ok(page.includes('alt="Spider-Woman #1 (image 1)"') || page.includes('alt="Spider-Woman #1:'), 'image described');
assert.ok(page.includes('<a href="/item/c0/x">Spider-Woman #1</a> is great'), 'book linked');
assert.ok(page.includes('<h2>Quick answers</h2>') && page.includes('FAQPage'), 'quick answers');
assert.ok(page.includes('<h2>You may also love</h2>') && page.includes('data-article-cart') && page.includes('AVENGERS #1 MARK BROOKS VARIANT'), 'also love with add to cart');
console.log('Article extras: image descriptions, book links, quick answers, you may also love passed');
