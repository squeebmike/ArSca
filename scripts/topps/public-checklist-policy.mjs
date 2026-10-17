// Public checklist approval is explicit: the legacy sport label alone is unreliable.
export function checklistPublicationProblems(set, approval = {}) {
  const problems = [];
  const name = String(set.setName || set.name || '');
  if (!Number.isInteger(Number(set.year)) || Number(set.year) < 2023) problems.push('outside_2023_onward');
  if (set.sport !== 'baseball' || /basketball|football|star wars|mcquarrie/i.test(name)) problems.push('not_verified_baseball');
  if (/panini/i.test(name + ' ' + (set.brand || ''))) problems.push('excluded_publisher');
  if (/checklists provided|configuration of|actual contents/i.test(name)) problems.push('disclaimer_used_as_set_name');
  if (!approval.displayName || !approval.licensedBaseball || !approval.reviewed) problems.push('editorial_review_required');
  try {
    const source = new URL(approval.sourceUrl);
    if (source.protocol !== 'https:' || !['www.topps.com','topps.com','ripped.topps.com','cdn.shopify.com'].includes(source.hostname)) problems.push('official_source_required');
  } catch { problems.push('official_source_required'); }
  if (!Number(set.cardCount)) problems.push('empty_checklist');
  return problems;
}

const norm = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const num = value => String(value || '').trim().toLowerCase().replace(/^0+(?=\d)/, '');

// Require complete printing identity. A shared player or card number is insufficient.
export function baseballInventoryMatches(item, card, set) {
  if (item.categorySlug !== 'sports-cards' || item.isSealed) return false;
  if (/sealed|box|pack|case|bundle/i.test(item.productType || '')) return false;
  const fields = [[item.year,set.year], [item.set,set.displayName || set.setName], [item.player,card.player], [item.subset,card.section], [item.variant,card.variant]];
  return fields.every(([a,b]) => !!norm(a) && norm(a) === norm(b)) && !!num(item.cardNumber) && num(item.cardNumber) === num(card.cardNumber);
}

export function ebayChecklistSearch(card, set, campaignId) {
  // No tracking or attribution claim until the owner supplies their campaign ID.
  if (!/^\d+$/.test(String(campaignId || ''))) return null;
  const words = [set.year,set.displayName || set.setName,card.player,card.cardNumber,card.section,card.variant].filter(Boolean);
  if (!card.player || !card.cardNumber || !set.year) return null;
  const url = new URL('https://www.ebay.com/sch/i.html');
  url.searchParams.set('_nkw', words.join(' '));
  url.searchParams.set('mkcid','1');
  url.searchParams.set('mkevt','1');
  url.searchParams.set('campid',String(campaignId));
  url.searchParams.set('toolid','10001');
  url.searchParams.set('customid','mana-baseball-checklist');
  return url.href;
}
