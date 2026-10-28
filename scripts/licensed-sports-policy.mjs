// Editorial publication checks for additional sports. Provider membership alone
// never establishes licensing, and these checks do not change image eligibility.
const publishers={
 'Upper Deck':['upperdeck.com','www.upperdeck.com'],
 'Panini':['paniniamerica.net','www.paniniamerica.net','blog.paniniamerica.net'],
 'Topps':['topps.com','www.topps.com','ripped.topps.com','cdn.shopify.com']
};
const leagues={hockey:{required:['NHL','NHLPA'],hosts:['nhl.com','www.nhl.com']},basketball:{required:['NBA','NBPA'],hosts:['nba.com','www.nba.com','pr.nba.com']}};
const primary=(value,hosts)=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&hosts?.includes(u.hostname);}catch{return false;}};
export function licensedSportsPublicationProblems(set){
 const problems=[],league=leagues[set.sport],evidence=set.licensingEvidence;
 if(!league)problems.push('sport_review_required');
 if(!set.reviewed||!set.licensed)problems.push('release_review_required');
 if(!Number.isInteger(set.year)||set.year<1800)problems.push('invalid_release_year');
 if(!set.id||!set.displayName||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(set.id))problems.push('invalid_release_identity');
 if(!primary(set.sourceUrl,publishers[set.brand])||!/^[a-f0-9]{64}$/.test(set.sourceSha256||''))problems.push('publisher_checklist_required');
 if(!evidence?.verified||evidence.releaseYear!==set.year||!league?.required.every(l=>evidence.licensors?.includes(l))||!primary(evidence.sourceUrl,league?.hosts))problems.push('league_and_player_licensing_review_required');
 if(!Array.isArray(set.cards)||!set.cards.length||set.cards.length!==set.cardCount)problems.push('incomplete_base_checklist');
 const sectionIds=new Set();
 for(const group of set.sections||[]){
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group.id||'')||sectionIds.has(group.id)||/^all-(?:non-base|autographs|inserts|parallels|relics|prospects)$/.test(group.id))problems.push('invalid_or_duplicate_section_route');
  sectionIds.add(group.id);
  if(!group.name||!Array.isArray(group.cards)||!group.cards.length)problems.push('incomplete_numbered_section');
 }
 const groups=[{cards:set.cards||[]},...(set.sections||[])],ids=new Set();
 for(const group of groups){const numbers=new Set();for(const card of group.cards||[]){
  if(!card.id||ids.has(card.id)||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.id))problems.push('duplicate_or_invalid_card_route');
  ids.add(card.id);
  if(!card.cardNumber||numbers.has(card.cardNumber))problems.push('duplicate_or_missing_number_in_section');
  numbers.add(card.cardNumber);
  if(!card.player||!card.subjects?.length||card.subjects.some(s=>!s.name))problems.push('incomplete_card_identity');
 }}
 return [...new Set(problems)];
}
