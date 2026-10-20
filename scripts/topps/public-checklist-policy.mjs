// Public checklist approval is explicit: the legacy sport label alone is unreliable.
export function checklistPublicationProblems(set, approval = {}) {
  const problems = [];
  const name = String(set.setName || set.name || '');
  if (!Number.isInteger(Number(set.year)) || Number(set.year) < 2019) problems.push('outside_2019_onward');
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

export function footballChecklistPublicationProblems(set) {
  const problems=[];
  if(set.sport!=='football'||!set.licensedFootball||!set.reviewed)problems.push('licensed_football_review_required');
  if(!set.displayName||!/Topps/.test(set.displayName)||/panini|university/i.test(set.displayName))problems.push('excluded_release');
  if(!Number.isInteger(set.year)||set.year<2025)problems.push('outside_licensed_scope');
  try {const source=new URL(set.sourceUrl);if(source.protocol!=='https:'||!['www.topps.com','topps.com','ripped.topps.com','cdn.shopify.com'].includes(source.hostname))problems.push('official_source_required');}catch{problems.push('official_source_required');}
  if(!set.cards?.length||set.cards.length!==set.cardCount)problems.push('incomplete_checklist');
  return problems;
}

const norm = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const num = value => String(value || '').trim().toLowerCase().replace(/^0+(?=\d)/, '');

// Importers sometimes put the sport label in the set and identity in the title.
// Normalize only those wrappers, never Chrome/Update/insert/parallel distinctions.
export const sportsSetKey = value => norm(String(value||'')
  .replace(/^(?:baseball|football)\s+cards?\s+/i,'')
  .replace(/\s+(?:baseball|football)$/i,'')
  .replace(/\bUpdate Series\b/ig,'Update'));

// A base checklist can point to a parallel of that numbered card, provided its
// actual listing title stays visible. This is a card-family link, not proof of
// an exact base printing. Inserts and autograph/relic sets remain separate.
export function baseballChecklistInventoryMatches(item,card,set){
  if(baseballInventoryMatches(item,card,set))return true;
  if(item.categorySlug!=='sports-cards'||item.isSealed||/sealed|box|pack|case|bundle|lot/i.test(item.productType||''))return false;
  if(norm(card.section)!=='base'||norm(card.variant)!=='base')return false;
  if(item.subset&&norm(item.subset)!=='base')return false;
  if(item.isRelic||item.isSigned||/autograph|auto\b|relic|memorabilia|image variation|photo variation|short print|\b(?:sp|ssp)\b/i.test([item.name,item.set,item.variant,item.treatment].join(' ')))return false;
  if(sportsSetKey(item.set)!==sportsSetKey(set.displayName||set.setName))return false;
  const setYear=String(item.set||'').match(/\b((?:19|20)\d{2})\b/)?.[1];
  if(item.year&&String(item.year)!==String(set.year))return false;
  if(setYear&&setYear!==String(set.year))return false;
  if(!item.year&&!setYear)return false;
  let title=String(item.name||'').match(/^(.+?)\s+(?:\[([^\]]+)\]\s*)?#\s*([a-z0-9-]+)(?:\s+\/\d+)?\s*$/i);
  // Older intake titles omitted '#'. Accept an explicit known finish between
  // the complete checklist player name and number, not arbitrary extra words.
  if(!title){
    const escapedPlayer=String(card.player||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    title=String(item.name||'').match(new RegExp('^('+escapedPlayer+')\\s+(Magenta Speckle|Blue Sonar|Purple Sonar|Aqua)\\s+([a-z0-9-]+)(?:\\s+\\/\\d+)?\\s*$','i'));
  }
  const player=item.player||title?.[1],number=item.cardNumber||title?.[3];
  // Conflicting structured fields cannot be overridden by a convenient title.
  if(title&&item.player&&norm(item.player)!==norm(title[1]))return false;
  if(title&&item.cardNumber&&num(item.cardNumber)!==num(title[3]))return false;
  return !!norm(player)&&norm(player)===norm(card.player)&&!!num(number)&&num(number)===num(card.cardNumber);
}

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
  const label=set.displayName || set.setName || '';
  const words = [String(label).includes(String(set.year))?null:set.year,label,card.player,card.cardNumber,card.section,card.variant==='Base'?null:card.variant].filter(Boolean);
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
