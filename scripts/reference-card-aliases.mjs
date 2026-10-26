// Provider captions verified against the 2026 Topps card-number results on
// 2026-10-26. Scoped to immutable card IDs, never generic player wildcards.
const captions={
 '2026-topps-series-1-baseball-11':['National League Leaders RBI'],
 '2026-topps-series-1-baseball-38':['American League Leaders HRs'],
 '2026-topps-series-1-baseball-52':['It Takes Two']
};
export function referenceCardNames(card){return [card.player,...(captions[card.id]||[])];}
