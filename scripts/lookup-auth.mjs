// Price and grading lookups that spend The Mana Pocket's paid keys answer only
// signed-in store staff (store, 2026-10-27: "lock down the price lookups").
// Before this, SportsCardsPro, PriceCharting search, SoldComps and comic
// variant lookups answered anyone on the internet, on your keys.
//
// PokemonPriceTracker checks its own login (and subscription) in its route.
// A PSA cert photo already cached in R2 costs nothing to show and is used as a
// plain <img src>, so the photo route checks the login only on a cache miss.
export function lookupNeedsLogin(pathname = '') {
  const p = String(pathname);
  if (/^\/psa\/cert\/\d+\/photo$/.test(p)) return false;
  return p.startsWith('/pricing/sportscardspro/')
    || p === '/pricing/pricecharting' || p.startsWith('/pricing/pricecharting/')
    || p === '/pricing/tcg' || p.startsWith('/pricing/tcg/')
    || p.startsWith('/pricing/justtcg/')
    || p === '/comps/sold'
    || p.startsWith('/psa/')
    || p === '/comic/variants';
}
