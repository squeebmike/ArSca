// ByteRider sets the site theme (store, 2026-11-05: "have ByteRider say hello
// and ask what their favorite team, pokemon etc is ... only if they haven't
// picked a theme yet. And have it set the theme for the site? Maybe if the
// page is on idle too long?").
//
// He never touches the website's theme code (wo-ui.js, Codex's): he uses the
// site's own theme picker the way a visitor would -- the league tab, then the
// tile -- so the theme is saved and applied exactly as if they'd tapped it.
// The picker sits off screen while he does it.

// The key wo-ui.js saves a chosen theme under (no key = never picked).
export const THEME_KEY = 'wo-v14-static-pokemon-contrast-palette';
export const ASK_KEY = 'byterider-theme-ask';
export const IDLE_MS = 30000;
export const MAX_ASKS = 2;
const LEAGUE_WORDS = [
  ['nfl', /\b(nfl|football)\b/], ['mlb', /\b(mlb|baseball)\b/], ['nba', /\b(nba|basketball)\b/],
  ['nhl', /\b(nhl|hockey)\b/], ['pokemon', /\b(pokemon|pkmn)\b/], ['mtg', /\b(mtg|magic)\b/],
];
const LABEL = { nfl: 'NFL', mlb: 'MLB', nba: 'NBA', nhl: 'NHL', pokemon: 'Pokémon', mtg: 'Magic' };
export const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[♀]/g, ' f').replace(/[♂]/g, ' m').replace(/[^a-z0-9]+/g, ' ').trim();
const FILLER = /\b(my|favorite|favourite|fav|team|is|the|i|like|love|im|a|an|fan|of|go|set|make|it|theme|to|colors?|colours?|please|pls|site|use|change|switch|for|me|probably|definitely|has|to|be|its|it s|color|deck|type)\b/g;

// The league a visitor named, and the name with the filler words out.
export function parseThemeAnswer(text = '') {
  let t = norm(text);
  const league = LEAGUE_WORDS.find(([, re]) => re.test(t))?.[0] || '';
  for (const [, re] of LEAGUE_WORDS) t = t.replace(new RegExp(re.source, 'g'), ' ');
  return { league, name: t.replace(FILLER, ' ').replace(/\s+/g, ' ').trim() };
}
// What they named, in the picker's list [{ league, k, n }]: one sure match,
// or the choices when it fits more than one ("Giants").
export function matchTheme(text, catalog = []) {
  const { league, name } = parseThemeAnswer(text);
  if (!name) return { match: null, choices: [] };
  const pool = catalog.filter(t => !league || t.league === league);
  const exact = pool.filter(t => norm(t.n) === name);
  let hits = exact;
  if (!hits.length && name.length >= 3) hits = pool.filter(t => norm(t.n).split(' ').includes(name) || (name.length >= 4 && norm(t.n).startsWith(name)));
  if (!hits.length && name.length >= 4) hits = pool.filter(t => name.split(' ').includes(norm(t.n)));
  if (hits.length === 1) return { match: hits[0], choices: [] };
  return { match: null, choices: hits.slice(0, 4) };
}
export const choiceLabel = t => t.n + ' (' + (LABEL[t.league] || t.league) + ')';

// Whether to ask now: never picked, not said no, not asked too often, the
// site's own theme nudge not dismissed, and not on a sign-in or checkout page.
export function shouldAsk({ store, path = '/', chatOpen = false, modalOpen = false }) {
  if (chatOpen || modalOpen) return false;
  if (/^\/(checkout|cart|login|signup|account|order|reset)/i.test(path)) return false;
  if (store.get(THEME_KEY) || store.get('wo-theme-nudge-dismissed')) return false;
  const asked = store.get(ASK_KEY) || '';
  return asked !== 'no' && (Number(asked) || 0) < MAX_ASKS;
}

// The site's own picker (wo-ui.js), driven off screen.
const pickerReady = () => typeof window !== 'undefined' && window.WO && typeof window.WO.openTheme === 'function' && typeof window.WO.closeTheme === 'function';
function withPicker(fn) {
  if (!pickerReady()) return null;
  const back = document.activeElement;
  // The tiles he renders while looking are never seen, so their pictures
  // are not downloaded (the picker draws fresh tiles when a visitor opens it).
  const proto = window.HTMLImageElement?.prototype, src = proto && Object.getOwnPropertyDescriptor(proto, 'src');
  if (src) Object.defineProperty(proto, 'src', { configurable: true, get: src.get, set() {} });
  try {
    // Built the first time it opens; open + close in one step never shows it.
    if (!document.querySelector('[aria-label="Choose your theme"]')) { window.WO.openTheme(); window.WO.closeTheme(); }
    const sheet = document.querySelector('[aria-label="Choose your theme"]');
    return sheet ? fn(sheet) : null;
  } finally {
    if (src) Object.defineProperty(proto, 'src', src); if (back && back.focus && back.isConnected) try { back.focus({ preventScroll: true }); } catch {} }
}
// The league tabs only (the team tiles carry data-lg too).
const TAB = 'button[data-lg]:not(.wo-tile)';
let catalog = null;
export function readCatalog() {
  if (catalog?.length) return catalog;
  return catalog = withPicker(sheet => {
    const out = [];
    for (const tab of sheet.querySelectorAll(TAB)) {
      tab.click();
      for (const tile of sheet.querySelectorAll('.wo-tile')) out.push({ league: tab.dataset.lg, k: tile.dataset.k, n: tile.getAttribute('aria-label') || '' });
    }
    // Leave the picker on the visitor's own league, as it was.
    let league = 'nfl'; try { league = JSON.parse(localStorage.getItem(THEME_KEY) || '{}').league || 'nfl'; } catch {}
    sheet.querySelector(`${TAB}[data-lg="${CSS.escape(league)}"]`)?.click();
    return out;
  }) || [];
}
export function applyChoice(choice) {
  return !!withPicker(sheet => {
    sheet.querySelector(`${TAB}[data-lg="${CSS.escape(choice.league)}"]`)?.click();
    const tile = sheet.querySelector(`.wo-tile[data-lg="${CSS.escape(choice.league)}"][data-k="${CSS.escape(String(choice.k))}"]`);
    if (!tile) return false;
    tile.click();
    return true;
  });
}
