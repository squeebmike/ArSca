// NEW ARRIVALS EMAIL (store, 2026-11-06: "Is there a way to email blast new
// releases when I scan the slip? Right now I only want Sean VanO to get one").
//
// After an FOC slip is received, the shelf copies that came in can be emailed
// to the customers on the store's new-arrivals list (customers.new_arrivals_email,
// set per customer). Covers, prices and a link to each book's page; nothing
// goes out unless the store presses SEND.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Number(n) > 0 ? '$' + Number(n).toFixed(2) : '';

// items: [{ name, price, image, url }] (public fields only).
export function newArrivalsEmail(items = [], { storeName = 'The Mana Pocket', site = 'https://www.themanapocket.com', location = '', firstName = '' } = {}) {
  const list = items.filter(i => i && i.name).slice(0, 60);
  const n = list.length;
  const subject = `New this week at ${storeName}: ${n} new comic${n === 1 ? '' : 's'}`;
  const hi = firstName ? `Hi ${firstName},` : 'Hi,';
  const text = [hi, '', `Just in at ${storeName}:`, '', ...list.map(i => `- ${i.name}${money(i.price) ? ' -- ' + money(i.price) : ''}${i.url ? '\n  ' + i.url : ''}`), '',
    `Shop everything: ${site}`, '', `You're getting this because you asked ${storeName} for new-arrival emails. Reply "stop" and we'll take you off.`, location ? location : ''].join('\n').trim();
  const cards = list.map(i => `<td style="width:50%;padding:8px;vertical-align:top;text-align:center">`
    + (i.image ? `<a href="${esc(i.url || site)}"><img src="${esc(i.image)}" alt="${esc(i.name)}" width="200" style="width:200px;max-width:100%;border-radius:8px;border:3px solid #b4ff3a;display:block;margin:0 auto"></a>` : '')
    + `<div style="font:700 14px/1.3 Arial,sans-serif;color:#ffffff;margin-top:8px">${esc(i.name)}</div>`
    + (money(i.price) ? `<div style="font:900 15px Arial,sans-serif;color:#b4ff3a;margin-top:4px">${money(i.price)}</div>` : '')
    + (i.url ? `<a href="${esc(i.url)}" style="display:inline-block;margin-top:6px;padding:6px 14px;background:#b026ff;color:#ffffff;font:700 12px Arial,sans-serif;text-decoration:none;border-radius:6px">SHOP</a>` : '')
    + `</td>`);
  const rows = []; for (let k = 0; k < cards.length; k += 2) rows.push(`<tr>${cards[k]}${cards[k + 1] || '<td></td>'}</tr>`);
  const html = `<div style="background:#0b0612;padding:20px 0"><table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#160a2b;border-radius:12px;border:2px solid #b4ff3a" cellpadding="0" cellspacing="0">`
    + `<tr><td style="padding:22px 20px 6px;text-align:center"><div style="font:900 italic 30px Arial,sans-serif;color:#ffffff">NEW COMIC <span style="color:#b4ff3a">DAY</span></div>`
    + `<div style="font:700 14px Arial,sans-serif;color:#d9c4ff;margin-top:6px">${esc(hi)} just in at ${esc(storeName)}</div></td></tr>`
    + `<tr><td style="padding:6px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table></td></tr>`
    + `<tr><td style="padding:10px 20px 18px;text-align:center"><a href="${esc(site)}" style="display:inline-block;padding:10px 22px;background:#b4ff3a;color:#0b0612;font:900 14px Arial,sans-serif;text-decoration:none;border-radius:8px">SEE EVERYTHING NEW</a></td></tr>`
    + `<tr><td style="padding:0 20px 18px;text-align:center;font:12px/1.5 Arial,sans-serif;color:#a99cc0">You're getting this because you asked ${esc(storeName)} for new-arrival emails. Reply "stop" and we'll take you off.${location ? '<br>' + esc(location) : ''}</td></tr>`
    + `</table></div>`;
  return { subject, text, html };
}
