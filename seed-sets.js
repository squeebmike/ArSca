#!/usr/bin/env node
/**
 * seed-sets.js — push local set JSON files into the Worker KV via /sets/import-json
 *
 * Usage:
 *   node seed-sets.js [worker-url]
 *
 * Default worker URL: https://still-resonance-4f87.swarnerauto.workers.dev
 */

const fs = require('fs');
const path = require('path');

const WORKER = process.argv[2] || 'https://still-resonance-4f87.swarnerauto.workers.dev';

const SETS = [
  {
    file: path.join(__dirname, '2026_topps_s1_baseball.json'),
    slug: '2026-topps-s1-baseball',
    name: '2026 Topps Series 1 Baseball',
    sport: 'baseball',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-topps-finest-basketball.json'),
    slug: '2025-26-topps-finest-basketball',
    name: "2025-26 Topps Finest Basketball",
    sport: 'basketball',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-bowman-basketball.json'),
    slug: '2025-26-bowman-basketball',
    name: "2025-26 Bowman Basketball",
    sport: 'basketball',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-manchester-united-collector-tin.json'),
    slug: '2025-26-manchester-united-collector-tin',
    name: "2025-26 Manchester United Collector Tin",
    sport: 'soccer',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-topps-chrome-basketball-sapphire.json'),
    slug: '2025-26-topps-chrome-basketball-sapphire',
    name: "2025-26 Topps Chrome Basketball Sapphire",
    sport: 'basketball',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-topps-chrome-cactus-jack-basketball.json'),
    slug: '2025-26-topps-chrome-cactus-jack-basketball',
    name: "2025-26 Topps Chrome Cactus Jack Basketball",
    sport: 'basketball',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-topps-cosmic-chrome-basketball.json'),
    slug: '2025-26-topps-cosmic-chrome-basketball',
    name: "2025-26 Topps Cosmic Chrome Basketball",
    sport: 'basketball',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-topps-hoops-basketball.json'),
    slug: '2025-26-topps-hoops-basketball',
    name: "2025-26 Topps Hoops Basketball",
    sport: 'basketball',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-topps-inception-basketball.json'),
    slug: '2025-26-topps-inception-basketball',
    name: "2025-26 Topps Inception Basketball",
    sport: 'basketball',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-topps-signature-class-basketball.json'),
    slug: '2025-26-topps-signature-class-basketball',
    name: "2025-26 Topps Signature Class Basketball",
    sport: 'basketball',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-topps-three-basketball.json'),
    slug: '2025-26-topps-three-basketball',
    name: "2025-26 Topps Three Basketball",
    sport: 'basketball',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-bowman-draft-baseball-sapphire-edition.json'),
    slug: '2025-bowman-draft-baseball-sapphire-edition',
    name: "2025 Bowman Draft Baseball Sapphire Edition",
    sport: 'baseball',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-bowman-s-best-baseball.json'),
    slug: '2025-bowman-s-best-baseball',
    name: "2025 Bowman's Best Baseball",
    sport: 'baseball',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-chrome-football.json'),
    slug: '2025-topps-chrome-football',
    name: "2025 Topps Chrome Football",
    sport: 'football',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-chrome-football-sapphire.json'),
    slug: '2025-topps-chrome-football-sapphire',
    name: "2025 Topps Chrome Football Sapphire",
    sport: 'football',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-marvel-the-collector.json'),
    slug: '2025-topps-marvel-the-collector',
    name: "2025 Topps Marvel The Collector",
    sport: 'marvel',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-pristine-baseball.json'),
    slug: '2025-topps-pristine-baseball',
    name: "2025 Topps Pristine Baseball",
    sport: 'baseball',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-star-wars-masterwork.json'),
    slug: '2025-topps-star-wars-masterwork',
    name: "2025 Topps Star Wars Masterwork",
    sport: 'star wars',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-star-wars-smugglers-outpost.json'),
    slug: '2025-topps-star-wars-smugglers-outpost',
    name: "2025 Topps Star Wars Smugglers Outpost",
    sport: 'star wars',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-chrome-black-football.json'),
    slug: '2025-topps-chrome-black-football',
    name: "2025 Topps Chrome Black Football",
    sport: 'football',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-chrome-deadpool.json'),
    slug: '2025-topps-chrome-deadpool',
    name: "2025 Topps Chrome Deadpool",
    sport: 'marvel',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-chrome-formula-1-sapphire-edition.json'),
    slug: '2025-topps-chrome-formula-1-sapphire-edition',
    name: "2025 Topps Chrome Formula 1 Sapphire Edition",
    sport: 'motorsport',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-chrome-mcdonald-s-all-american-basketball.json'),
    slug: '2025-topps-chrome-mcdonald-s-all-american-basketball',
    name: "2025 Topps Chrome McDonald's All-American Basketball",
    sport: 'basketball',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-chrome-platinum-baseball.json'),
    slug: '2025-topps-chrome-platinum-baseball',
    name: "2025 Topps Chrome Platinum Baseball",
    sport: 'baseball',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-cosmic-chrome-football.json'),
    slug: '2025-topps-cosmic-chrome-football',
    name: "2025 Topps Cosmic Chrome Football",
    sport: 'football',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-disneyland-70th-anniversary.json'),
    slug: '2025-topps-disneyland-70th-anniversary',
    name: "2025 Topps Disneyland 70th Anniversary",
    sport: 'disney',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-finest-football.json'),
    slug: '2025-topps-finest-football',
    name: "2025 Topps Finest Football",
    sport: 'football',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-inception-baseball.json'),
    slug: '2025-topps-inception-baseball',
    name: "2025 Topps Inception Baseball",
    sport: 'baseball',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-marvel-studios-chrome-sapphire.json'),
    slug: '2025-topps-marvel-studios-chrome-sapphire',
    name: "2025 Topps Marvel Studios Chrome Sapphire",
    sport: 'marvel',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-museum-collection-baseball.json'),
    slug: '2025-topps-museum-collection-baseball',
    name: "2025 Topps Museum Collection Baseball",
    sport: 'baseball',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-stadium-club-baseball.json'),
    slug: '2025-topps-stadium-club-baseball',
    name: "2025 Topps Stadium Club Baseball",
    sport: 'baseball',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-universe-wwe.json'),
    slug: '2025-topps-universe-wwe',
    name: "2025 Topps Universe WWE",
    sport: 'wrestling',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-transcendent-collection-baseball.json'),
    slug: '2025-topps-transcendent-collection-baseball',
    name: "2025 Topps Transcendent Collection Baseball",
    sport: 'baseball',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-dynamic-duals-baseball.json'),
    slug: '2026-topps-dynamic-duals-baseball',
    name: "2026 Topps Dynamic Duals Baseball",
    sport: 'baseball',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-finest-baseball.json'),
    slug: '2026-topps-finest-baseball',
    name: "2026 Topps Finest Baseball",
    sport: 'baseball',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-brooklyn-collection.json'),
    slug: '2026-topps-brooklyn-collection',
    name: "2026 Topps Brooklyn Collection",
    sport: 'baseball',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-chrome-baseball-v2.json'),
    slug: '2026-topps-chrome-baseball-v2',
    name: "2026 Topps Chrome Baseball (v2)",
    sport: 'baseball',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-chrome-baseball.json'),
    slug: '2026-topps-chrome-baseball',
    name: "2026 Topps Chrome Baseball",
    sport: 'baseball',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-chrome-u-s-winter-olympics-paralympic-team-hopefuls.json'),
    slug: '2026-topps-chrome-u-s-winter-olympics-paralympic-team-hopefuls',
    name: "2026 Topps Chrome U.S. Winter Olympics & Paralympic Team Hopefuls",
    sport: 'olympics',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-chrome-veefriends.json'),
    slug: '2026-topps-chrome-veefriends',
    name: "2026 Topps Chrome VeeFriends",
    sport: 'veefriends',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-disney-neon.json'),
    slug: '2026-topps-disney-neon',
    name: "2026 Topps Disney Neon",
    sport: 'disney',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-finest-fantastic-four.json'),
    slug: '2026-topps-finest-fantastic-four',
    name: "2026 Topps Finest Fantastic Four",
    sport: 'marvel',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-series-1-baseball.json'),
    slug: '2026-topps-series-1-baseball',
    name: "2026 Topps Series 1 Baseball",
    sport: 'baseball',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-series-2-baseball.json'),
    slug: '2026-topps-series-2-baseball',
    name: "2026 Topps Series 2 Baseball",
    sport: 'baseball',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-chrome-disney.json'),
    slug: '2026-topps-chrome-disney',
    name: "2026 Topps Chrome Disney",
    sport: 'disney',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-midnight-ufc.json'),
    slug: '2026-topps-midnight-ufc',
    name: "2026 Topps Midnight UFC",
    sport: 'mma',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-topps-nbl-basketball.json'),
    slug: '2025-26-topps-nbl-basketball',
    name: "2025-26 Topps NBL Basketball",
    sport: 'basketball',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', 'topps-chrome-uefa-club-competitions-2025-26.json'),
    slug: 'topps-chrome-uefa-club-competitions-2025-26',
    name: "Topps Chrome UEFA Club Competitions 2025-26",
    sport: 'soccer',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-definitive-baseball.json'),
    slug: '2025-topps-definitive-baseball',
    name: "2025 Topps Definitive Baseball",
    sport: 'baseball',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-royalty-ufc.json'),
    slug: '2025-topps-royalty-ufc',
    name: "2025 Topps Royalty UFC",
    sport: 'mma',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-royalty-wwe.json'),
    slug: '2025-topps-royalty-wwe',
    name: "2025 Topps Royalty WWE",
    sport: 'wrestling',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-dynasty-baseball.json'),
    slug: '2025-topps-dynasty-baseball',
    name: "2025 Topps Dynasty Baseball",
    sport: 'baseball',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2025-26-bowman-university-best-basketball.json'),
    slug: '2025-26-bowman-university-best-basketball',
    name: "2025-26 Bowman University Best Basketball",
    sport: 'basketball',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-tier-one-baseball.json'),
    slug: '2026-topps-tier-one-baseball',
    name: "2026 Topps Tier One Baseball",
    sport: 'baseball',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-signature-class-football.json'),
    slug: '2025-topps-signature-class-football',
    name: "2025 Topps Signature Class Football",
    sport: 'football',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-collector-kit.json'),
    slug: '2026-topps-collector-kit',
    name: "2026 Topps Collector Kit",
    sport: 'baseball',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-exalted-wwe.json'),
    slug: '2025-topps-exalted-wwe',
    name: "2025 Topps Exalted WWE",
    sport: 'wrestling',
    year: '2025',
  },
  {
    file: path.join(__dirname, 'sets', '2026-topps-chrome-wwe.json'),
    slug: '2026-topps-chrome-wwe',
    name: "2026 Topps Chrome WWE",
    sport: 'wrestling',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', 'topps-finest-premier-league-2026.json'),
    slug: 'topps-finest-premier-league-2026',
    name: "Topps Finest Premier League 2026",
    sport: 'soccer',
    year: '2026',
  },
  {
    file: path.join(__dirname, 'sets', 'topps-manchester-united-2025-26-team-set.json'),
    slug: 'topps-manchester-united-2025-26-team-set',
    name: "Topps Manchester United 2025/26 Team Set",
    sport: 'soccer',
    year: '2025-26',
  },
  {
    file: path.join(__dirname, 'sets', '2025-topps-30-years-of-toy-story.json'),
    slug: '2025-topps-30-years-of-toy-story',
    name: "2025 Topps 30 Years of Toy Story",
    sport: 'disney',
    year: '2025',
  },
];

async function seedSet({ file, slug, name, sport, year }) {
  if (!fs.existsSync(file)) {
    console.error(`  ✗ File not found: ${file}`);
    return false;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);

  // Attach metadata fields the Worker needs
  const payload = { ...data, slug, name: name || data.set, sport, year: year || data.release_date };

  console.log(`  → Seeding ${name} (${(raw.length / 1024).toFixed(0)} KB)…`);

  const res = await fetch(`${WORKER}/sets/import-json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (result.ok) {
    console.log(`  ✓ ${name}: ${result.baseCount} base cards`);
    return true;
  } else {
    console.error(`  ✗ Failed: ${result.error}`);
    return false;
  }
}

(async () => {
  console.log(`Seeding sets → ${WORKER}\n`);
  let ok = 0, fail = 0;
  for (const s of SETS) {
    const success = await seedSet(s);
    success ? ok++ : fail++;
  }
  console.log(`\nDone: ${ok} seeded, ${fail} failed`);
})();
