(function(){
  'use strict';
  const host=document.getElementById('mana-live-studio');if(!host)return;
  // The game modules the remote loads, versioned (2026-11-13: a phone kept an old beasts.mjs, so the Beasts demo did nothing). Bump with each change to them.
  const STUDIO_V='2026.11.24.4';
  host.className='mana-controls';
  // ByteRider_97's reactions and their keyboard shortcuts (store: "how to control him?").
  const MASCOT_KEYS=[['happy','HAPPY','1'],['smug','SMUG','2'],['wink','WINK','3'],['laughing','LAUGH','4'],['love','LOVE','5'],['surprised','SURPRISED','6'],['angry','ANGRY','7'],['dizzy','DIZZY','8'],['sad','SAD','9'],['thinking','THINK','0'],
    ['jackpot','JACKPOT','J'],['celebrating','CELEBRATE','C'],['alert','ALERT','A'],['glitch','GLITCH','G'],['countdown','COUNTDOWN','D'],['sleeping','SLEEP','Z'],['disappearing','REBOOT','R'],['excited','EXCITED','E'],['cool','COOL','O'],['shocked','SHOCKED','K'],['suspicious','SUSPICIOUS','U'],['error','ERROR','X'],['loading','LOADING','L'],['processing','PROCESSING','P'],['remind','RE:MIND','M'],['idle','IDLE','I'],['talking','TALK','T','HEY CHAT! WHAT ARE WE PULLING NEXT?'],['happy','NEW FOLLOWER','N','NEW FOLLOWER! WELCOME TO THE POCKET!']];
  // The original villains (scripts/live-studio-bosses.mjs).
  const BOSS_NAMES={scalper:'THE SCALPER',flipper:'THE FLIPPER',dinged:'THE DINGED CORNER',grader:'THE HARSH GRADER',shipping:'THE SHIPPING DELAY'};
  const num=(name,label,min,max,step)=>`<label>${label}<input name="${name}" type="number" min="${min}" max="${max}"${step?` step="${step}"`:''} required></label>`;
  const box=(name,label)=>`<label class="mana-check"><span><input name="${name}" type="checkbox"> ${label}</span></label>`;
  host.innerHTML=`<h2>Mana Pocket • Live Studio</h2><p id="mana-status" role="status">Connect to load your live sign settings.</p><button id="mana-load">Connect / reload</button>
  <section class="mana-remote" aria-label="Show remote">
  <div class="mana-remote-status"><b id="mana-remote-floor">Tap CONNECT to start</b><span id="mana-remote-score"></span></div>
  <div id="dg-live" class="dg-live" hidden></div>
  <p id="mana-remote-msg" class="mana-remote-msg" role="status"></p>
  <div class="mana-remote-pick"><div class="mana-row" id="mana-doors-pick"></div><div class="mana-row" id="mana-vote-pick"></div><div class="mana-row mana-trivia-who" hidden><input id="mana-trivia-who" maxlength="30" placeholder="Who got it? (their username, optional)"></div></div>
  <div class="mana-remote-grid">
    <button type="button" data-click="#mana-load">🔌 CONNECT</button><button type="button" data-click="#mana-show">📺 USE LIVE SHOW</button><button type="button" data-click="#foc-show-sec">📚 FOC SHOW</button><button type="button" data-click="#bb-show-sec">📦 BAG &amp; BOARD</button><button type="button" data-click="#dg-plan">🗺 DUNGEON PLAN</button><button type="button" data-click="#mana-trivia">❓ TRIVIA</button>
    <button type="button" class="tap" data-click="#mana-taps [data-tap=follow]">➕ FOLLOW</button><button type="button" class="tap" data-click="#mana-taps [data-tap=share]">➕ SHARE</button><button type="button" class="tap" data-click="#mana-taps [data-tap=bookmark]">➕ BOOKMARK</button>
    <button type="button" class="vote" data-click="#mana-vote-open [data-vote=next]">⏭ WHAT'S NEXT</button><button type="button" data-click="#mana-mascot [data-mascot=excited]">🤖 HYPE</button>
  </div>
  <section class="fb-sec" id="foc-show-sec" aria-label="FOC show">
  <h3>📚 FOC SHOW</h3>
  <small>For FOC shows: your camera on top, the books on the bottom half -- nothing else on the overlay (no sign, game or mascot). Pick the week, tap START, then just talk; DISPLAY changes what the books do.</small>
  <div class="mana-row"><button type="button" id="fb-start" style="font-weight:800">📚 START FOC SHOW</button><button type="button" id="fb-end">⏹ END FOC SHOW</button></div>
  <details class="fb-ctl" open><summary>📖 BOOKS, WEEK + DISPLAY</summary>
  <small>Pick a FOC week: every book in it, A to Z, flips by on the overlay -- each of its covers in turn, the price, the credits, the order-by and in-store dates, and the synopsis rolling up. Books with lots of covers stay up longer. No screen share.</small>
  <div class="mana-row"><label>FOC WEEK<select id="fb-week"><option value="">Next FOC</option></select></label><label>FROM<select id="fb-dist"><option value="">PRH + LUNAR</option><option value="PRH">PRH (Marvel, IDW...)</option><option value="Lunar">LUNAR (DC, Image...)</option></select></label><label><input id="fb-comics" type="checkbox" checked> COMICS ONLY (no trades, merch)</label></div>
  <div class="mana-row"><label>SECONDS A BOOK<input id="fb-secs" type="number" min="5" max="60" value="14"></label><label>WHERE<select id="fb-mode"><option value="full">FULL SCREEN</option><option value="lower">LOWER HALF</option></select></label><label>HEADING<input id="fb-title" maxlength="40" placeholder="FOC THIS SUNDAY"></label></div>
  <div class="mana-row"><button type="button" id="fb-go">📖 LOAD + SHOW</button><button type="button" id="fb-back">◀ BACK</button><button type="button" id="fb-next">NEXT ▶</button><button type="button" id="fb-off">HIDE</button></div>
  <div class="mana-row"><label>DISPLAY<select id="fb-show"><option value="auto">🔁 AUTO MIX (all of them in turn)</option><option value="flip">📖 FLIPBOOK</option><option value="wall">🧱 THE WALL</option><option value="versus">⚔ COVER VS COVER</option><option value="mystery">❓ MYSTERY COVER</option><option value="artist">🎨 NAME THAT ARTIST</option><option value="wanted">🏆 MOST WANTED</option></select></label></div>
  <div class="mana-row"><label>GO TO A BOOK (chat asks about one)<select id="fb-jump"><option value="">Load the flipbook first</option></select></label></div>
  </details>
  </section>
  <section class="fb-sec" id="bb-show-sec" aria-label="Bag and board show">
  <h3>📦 BAG &amp; BOARD SHOW</h3>
  <small>While you board and bag the new releases: the bottom half flips through every book you ordered for that Wednesday -- each cover you ordered, A to Z -- so chat sees what's in the next show. Camera on top, nothing else on the overlay. DISPLAY above changes how they flip.</small>
  <div class="mana-row"><label>NEW RELEASES FOR<select id="bb-week"><option value="">Next Wednesday</option></select></label><label>NEXT SHOW<input id="bb-when" maxlength="24" placeholder="SATURDAY"></label></div>
  <div class="mana-row"><button type="button" id="bb-start" style="font-weight:800">📦 START BAG &amp; BOARD SHOW</button><button type="button" id="bb-end">⏹ END</button></div>
  </section>
  <h3>🥤 Vending machine</h3>
  <small>For breaks and surprise sets: a machine of items (or spots), scrolling, a BID button on each slot, the one UP NOW lit, SOLD stamped on what's gone. A sale marks its item by itself (with spots: the one UP NOW). Tap a slot below to mark it by hand.</small>
  <details class="vm-showcase" open><summary>🛒 SHOWCASE -- pre-release shows: NEW RELEASES to pre-order + THE BIN, on the lower half</summary>
  <small>The new releases (your FOC books with covers, their price and FOC date) on top, the in-stock Buy It Now items with their price below, each shelf turning a page every 5 seconds. Shows on the green screen's lower half.</small>
  <div class="mana-row"><button type="button" id="vm-sc-both">🛒 LOAD BOTH (NEW + BIN)</button><button type="button" id="vm-sc-pre">📚 NEW RELEASES ONLY</button><button type="button" id="vm-sc-bin">🏷 BIN ONLY</button></div>
  </details>
  <div class="mana-row"><label>LOOK<select id="vm-theme"><option value="">KIOSK (white)</option><option value="comics">COMIC SHOP (red + yellow)</option><option value="cards">CARD SHOP (red + white)</option><option value="arcane">ARCANE (purple + gold)</option></select></label><label>CHANGE RETURN: A FREE GIVEAWAY EVERY<input id="vm-give" type="number" min="0" max="100" placeholder="0 = off"> SOLD</label><button type="button" id="vm-look-go">SET</button></div>
  <div class="mana-row"><label>⚡ FLASH SALE SLOTS<input id="vm-fl-slots" placeholder="3, 7, 12"></label><label>% OFF<input id="vm-fl-pct" type="number" min="1" max="89" placeholder="20"></label><label>OR SALE PRICE $<input id="vm-fl-price" type="number" min="0" step="0.01"></label><label>MINUTES<input id="vm-fl-min" type="number" min="1" max="60" value="5"></label><button type="button" id="vm-fl-go">⚡ FLASH SALE</button><button type="button" id="vm-fl-end">END SALE</button></div>
  <div class="mana-row"><button type="button" id="vm-load">LOAD FROM NOW + NEXT UP</button><button type="button" id="vm-show">SHOW THE MACHINE</button><button type="button" id="vm-hide">HIDE IT</button></div>
  <div class="mana-row vm-modes"><button type="button" data-vm-mode="panel">▣ SMALL · BEHIND US</button><button type="button" data-vm-mode="full">⛶ FULL SCREEN · BEHIND US</button><button type="button" data-vm-mode="lower">⬇ LOWER HALF · BEHIND US</button><button type="button" data-vm-mode="front">⛶ FULL SCREEN · IN FRONT</button></div>
  <div class="mana-row"><button type="button" id="vm-prev">◀ PREV SLOT</button><button type="button" id="vm-sold-up">✔ UP NOW SOLD → NEXT</button><button type="button" id="vm-next">NEXT SLOT ▶</button></div>
  <p id="vm-up" class="mana-score">Nothing up</p>
  <details class="vm-spots"><summary>🎟 MAKE SPOTS (a break, a surprise set -- not in your inventory)</summary>
  <small>"75 spots at $5", or paste one name a line (characters, teams, packs). They live in the machine only -- nothing is added to the site or your stock. List the spots in the Whatnot app the way you do now; each sale takes the spot UP NOW.</small>
  <div class="mana-row"><label>HOW MANY<input id="vm-n" type="number" min="1" max="120" value="75"></label><label>PRICE EACH $<input id="vm-price" type="number" min="0" step="0.01" placeholder="5"></label><label>CALL THEM<input id="vm-prefix" maxlength="20" value="SPOT"></label></div>
  <div class="mana-row"><select id="vm-preset"><option value="">— READY-MADE LIST —</option><option value="nfl">NFL TEAMS (32)</option><option value="mlb">MLB TEAMS (30)</option><option value="nba">NBA TEAMS (30)</option><option value="nhl">NHL TEAMS (32)</option><option value="marvel">MARVEL CHARACTERS (30)</option><option value="dc">DC CHARACTERS (25)</option><option value="image">IMAGE TITLES (10)</option></select></div>
  <label>OR ONE NAME A LINE<textarea id="vm-names" rows="5" placeholder="SPIDER-MAN&#10;BATMAN&#10;WOLVERINE"></textarea></label>
  <button type="button" id="vm-make" style="width:100%;min-height:52px;font-weight:800">🎟 MAKE THE SPOTS</button>
  <div class="vm-wn"><b>📡 LIST THE SPOTS ON WHATNOT</b>
  <small>Each spot becomes its own listing in your show (⚙ Settings → Show: the Whatnot show ID), reserved for the show, quantity 1, at the spot price. Nothing goes into your site or inventory; each sale marks its spot SOLD here and counts as a Whatnot-only sale (its cost from Settings → Whatnot).</small>
  <div class="mana-row"><select id="vm-wn-cat"><option value="comics">COMICS</option><option value="pokemon">POKÉMON CARDS</option><option value="sports">SPORTS CARDS</option><option value="mtg">MAGIC</option><option value="onepiece">ONE PIECE</option><option value="lorcana">LORCANA</option><option value="yugioh">YU-GI-OH</option></select><select id="vm-wn-mode"><option value="buy_it_now">BUY IT NOW AT THE SPOT PRICE</option><option value="auction">AUCTION STARTING THERE</option></select></div>
  <div class="mana-row"><input id="vm-wn-photo" placeholder="Photo link (https) -- blank: NOW PLAYING's photo"></div>
  <button type="button" id="vm-wn-go" style="width:100%;min-height:52px;font-weight:800">📡 LIST THE SPOTS IN MY WHATNOT SHOW</button></div>
  <small>Saved lists (on this device): save the one above with a name, load it next time.</small>
  <div class="mana-row"><select id="vm-saved"><option value="">— SAVED LISTS —</option></select><button type="button" id="vm-load-list">LOAD</button><button type="button" id="vm-save-list">💾 SAVE THIS LIST</button><button type="button" id="vm-del-list">🗑</button></div>
  </details>
  <div class="mana-row"><input id="vm-title" maxlength="30" placeholder="MACHINE NAME (e.g. SURPRISE SET #3)"><button type="button" id="vm-title-go">NAME IT</button></div>
  <small>BREAK BOARD: with SHOW BUYER NAMES on (⚙ Settings, off by default), each sold spot shows who has it. Write one in by hand:</small>
  <div class="mana-row"><input id="vm-who-slot" placeholder="Spot # (e.g. 5)"><input id="vm-who-name" maxlength="30" placeholder="Username (blank clears)"><button type="button" id="vm-who-go">✍ PUT THE NAME ON</button></div>
  <div id="vm-list" class="vm-list"></div>
  <h3>🎮 Game</h3>
  <div class="mana-row"><button type="button" id="game-dungeon">🗡 THE SHED DUNGEON</button><button type="button" id="game-beasts">👾 LONG BOX BEASTS</button><button type="button" id="game-vending">🥤 VENDING ONLY</button></div>
  <small>VENDING ONLY: no game -- the machine full screen behind you with your lineup (or spots); sales move no game. Each game keeps its own progress. Its controls are in its own section below; its settings in ⚙ Settings.</small>
  <div class="mana-row"><button type="button" id="demo-reset">↺ RESET THE PREVIEW DEMO</button></div>
  <h3>🗡 Dungeon controls</h3>
  <p id="mana-dungeon-status" class="mana-score">Floor 1</p>
  <div class="mana-row" id="mana-taps" hidden><button type="button" data-tap="follow" data-key="F">+ FOLLOW <kbd>F</kbd></button><button type="button" data-tap="share" data-key="Y">+ SHARE <kbd>Y</kbd></button><button type="button" data-tap="bookmark" data-key="B">+ BOOKMARK <kbd>B</kbd></button></div>
  <div class="mana-row"><input id="mana-add-mana" type="number" min="1" max="100000" placeholder="$ sale off Whatnot"><button type="button" id="mana-add-mana-go">+ MANA</button><input id="mana-set-floor" type="number" min="1" max="99" hidden><button type="button" id="mana-set-floor-go" hidden>SET FLOOR</button><button type="button" id="mana-reset-week" hidden>RESET WEEK</button></div>
  <div class="mana-row"><button type="button" id="quick-floor">🔢 SET FLOOR…</button><button type="button" data-click="#mana-reset-week">⏮ START THE WEEK OVER</button></div>
  <div class="mana-row"><label style="flex:1">THIS FLOOR'S BOSS <select id="mana-boss-pick"><option value="">Auto (the set order)</option></select></label><button type="button" id="mana-summon">⚔ SUMMON THE BOSS NOW</button></div>
  <small>Pick who comes out when this floor's flask fills (or when you summon). SUMMON fills the flask now: the boss comes out and sales and taps hit it.</small>
  <details id="dg-setups" class="dg-plan" open><summary>🏰 SAVED DUNGEON SETUPS -- the whole week ready before the show</summary>
  <small>Each setup holds every floor's boss, room, reward and its 3 chests, plus the show's stretch goals. LOAD puts it into the studio (the chests go on their own floors). Claude can write these for you: just say what's on each floor.</small>
  <div id="dg-setups-body"><small>Tap CONNECT to see the saved setups.</small></div></details>
  <details id="dg-plan" class="dg-plan" open><summary>🗺 DUNGEON PLAN -- every floor: its boss, room, reward and what's in each chest</summary>
  <small>This floor and the ones after it. Change a boss or a room here (a room set ahead skips chat's door vote on that floor). Chests open at the $ shown; what's in them comes from LOAD THE CHESTS (in order) -- ✏ EDIT CHESTS to change it.</small>
  <div id="dg-plan-body"><small>Tap CONNECT to see the plan.</small></div></details>
  <small>Chat votes: chat types a number in Whatnot's chat; tap the winner at the top. Nothing is random.</small>
  <div class="mana-remote-grid"><button type="button" class="vote" data-click="#mana-vote-open [data-vote=dig]">⛏ WHERE TO DIG</button><button type="button" class="vote" data-click="#mana-vote-open [data-vote=fork]">🔀 FORK</button><button type="button" class="vote" data-click="#mana-vote-open [data-vote=merchant]">🧙 MERCHANT</button><button type="button" class="vote" data-click="#mana-vote-open [data-vote=weapon]">🗡 WEAPON</button><button type="button" class="vote" data-click="#mana-vote-open [data-vote=door]">🚪 DOOR</button></div>
  <div class="mana-row" id="mana-vote-open" hidden><button type="button" data-vote="starter">CHAT VOTE: THE STARTER (BEASTS)</button><button type="button" data-vote="move">CHAT VOTE: THE ATTACK (BEASTS)</button><button type="button" data-vote="area">CHAT VOTE: THE NEXT AREA (BEASTS)</button><button type="button" data-vote="weather">CHAT VOTE: THE WEATHER (BEASTS)</button><button type="button" data-vote="merchant">CHAT VOTE: THE MERCHANT (2 SPECIAL ITEMS -- THE PICK RUNS)</button><button type="button" data-vote="dig">CHAT VOTE: WHERE TO DIG (FOUND IT!)</button><button type="button" data-vote="fork">CHAT VOTE: FORK IN THE HALL</button><button type="button" data-vote="weapon">CHAT VOTE: HERO'S WEAPON</button><button type="button" data-vote="next">CHAT VOTE: WHAT'S NEXT</button><button type="button" data-vote="door">CHAT VOTE: DOOR</button></div>
  <div class="mana-row"><button type="button" id="mana-trivia">ASK BYTERIDER TRIVIA</button><input id="mana-trivia-q" maxlength="160" placeholder="Your own question (optional)"><input id="mana-trivia-a" maxlength="80" placeholder="Answer"></div>
  <div class="mana-row"><input id="mana-floor-name" maxlength="30" placeholder="Chat's name for this floor"><button type="button" id="mana-floor-name-go">NAME THE FLOOR</button></div>
  <small>Trivia: chat types answers in Whatnot's chat; tap CHAT GOT IT and everyone's mana goes up. Chests along the path open as the crawl reaches them (after chat's goal, if it has one) and bring your most valuable NEXT UP item up as a $1 start.</small>
  <small>Whatnot doesn't send follows, shares or bookmarks -- tap them in as they pop up in the app. Sales fill the flask on their own.</small>
  <small>🎬 SHOW READY: one tap loads the dungeon from your comics in stock.</small>
  <small hidden>One tap loads the dungeon from your comics in stock: comics on every wall and stand, NEXT UP (if it's empty -- SHOW PREP's lineup stays), the chests' and floors' rewards (free giveaways for everyone, low starts on your best books), and special books for the merchant.</small>
  <button type="button" id="mana-show-ready" style="width:100%;min-height:58px;font-size:17px;font-weight:800">🎬 LOAD THE DUNGEON FROM STOCK (COMICS)</button>
  <small>📦 LOAD THE CHESTS: what each chest says and the book that spins when it opens, in the order chests open (all week, every floor). Loaded chests don't use NEXT UP and add nothing to Whatnot -- run the auction or giveaway in Whatnot. Empty list: chests work as before.</small>
  <div id="chest-load" class="chest-load"></div>
  <ul id="mana-ready" class="mana-ready"></ul>
  <small>🕹️ CAMERA</small>
  <small>Drag to look around the hall (up, down, left, right); let go and it eases back after 3 seconds. Works on the green screen, the crawl window and the preview.</small>
  <div class="mana-joy-row"><div id="mana-joy" class="mana-joy" aria-label="Camera joystick"><i></i></div><div class="mana-joy-btns"><button type="button" id="mana-scout">🔭 SCOUT AHEAD</button><button type="button" id="mana-test-attack">⚔️ TEST BOSS ATTACK (preview)</button><button type="button" id="mana-lookback">↩ LOOK BACK</button></div></div>
  <h3>👾 Beasts controls</h3>
  <p id="beast-status" class="mana-score">Route 1</p>
  <div class="mana-row" data-beasts><button type="button" id="battle-front">📺 BATTLE IN FRONT OF US</button><button type="button" id="battle-green">🟩 BATTLE ON THE GREEN SCREEN</button></div>
  <small data-beasts>ATTACK NOW: tap one -- it's used right away (works in the preview too). Or let chat vote.</small>
  <div class="mana-row beast-moves" id="beast-moves"></div>
  <div class="mana-row" data-beasts><input id="beast-new-move" maxlength="16" placeholder="CHAT'S NEW ATTACK (e.g. MOM'S BASEMENT)"><button type="button" id="beast-add-move">➕ ADD CHAT'S ATTACK</button><button type="button" data-click="#mana-vote-open [data-vote=move]">⚔️ CHAT PICKS THE ATTACK</button><button type="button" data-click="#mana-vote-open [data-vote=starter]">🥚 CHAT PICKS THE STARTER</button></div>
  <div class="mana-row"><button type="button" id="beast-preview-evo">✨ PREVIEW AN EVOLUTION</button></div>
  <div class="mana-row"><input id="beast-add" type="number" min="1" max="100000" placeholder="$ sale off Whatnot"><button type="button" id="beast-add-go">+ $ UP THE ROUTE</button><button type="button" id="beast-route">🔢 SET ROUTE…</button><button type="button" id="beast-reset">⏮ START BEASTS OVER</button></div>
  <h3>Now playing &amp; next up</h3>
  <small>What's on screen as NOW PLAYING and NEXT STAGE (and what goes in the chests). Show Prep's LINE IT UP fills it; or find items here.</small>
  <div class="mana-row"><input id="mana-find" placeholder="Find an item in inventory to add…" autocomplete="off"></div>
  <div id="mana-found" class="mana-found"></div>
  <div id="mana-stage" class="mana-stage"></div>
  <div class="mana-row"><button type="button" id="mana-next">NEXT ITEM ▶</button><button type="button" id="mana-stage-clear">CLEAR NOW PLAYING</button></div>
  <small>Chat votes in Whatnot's chat; the winner buttons show up at the top of this box. Everything else is in ⚙ Settings below.</small>
  </section>
  <details class="mana-all mana-sec" id="mana-all"><summary>⚙ Settings</summary><small>Set these up before the show. Tap a section to open it.</small>
  <form id="mana-form">
  <h3>Show</h3>
  <div class="mana-row"><button type="button" id="mana-show">USE LIVE / NEXT SHOW</button><span id="mana-show-name"></span></div>
  <div class="mana-grid"><label>Whatnot show ID<input name="showId" maxlength="120"></label><label>Whatnot seller ID (optional)<input name="sellerId" maxlength="120"></label></div>
  ${box('automatic','Automatic: every sale, giveaway, show start and end plays on stream')}
  <small>Whatnot doesn't share live bids. Each order comes through as it's made (auction, Buy It Now and giveaway), so the score board keeps the money total, items sold and biggest sale.</small>
  <div class="mana-row"><button type="button" id="mana-sync">SYNC TOTALS FROM WHATNOT</button><button type="button" id="mana-reset">RESET TOTALS</button></div>
  <p id="mana-score" class="mana-score">$0 · 0 sold</p>
  <h3>🎮 Which game</h3>
  <label>WHICH GAME<select name="gameMode"><option value="dungeon">THE SHED DUNGEON (first person)</option><option value="beasts">LONG BOX BEASTS (top-down, battles)</option><option value="vending">VENDING ONLY (no game: the machine)</option></select></label>
  <h3>👾 Beasts settings</h3>
  <div class="mana-grid">${num('beastsGoal','Route 1 goal ($)',5,1000000)}${num('beastsGrowth','Each route needs (+%)',0,100)}</div>
  <label>WHEN YOUR BEAST EVOLVES (LV 10 and LV 20), everyone watching gets<input name="beastsEvolveReward" maxlength="120" placeholder="e.g. Free giveaway in the Whatnot tool"></label>
  <small>Levels: every $1 sold is 1 XP (follows, shares and bookmarks count too); a new attack to learn every 5 levels -- chat names it (➕ ADD CHAT'S ATTACK). The level lasts the week. The reward is for the whole room, never buyers only.</small>
  <label>BEASTS GRAPHICS<select name="beastsGfx"><option value="gbc">GBC -- the four greens</option><option value="gba">GBA -- full colour</option><option value="nds">DS -- colour + touch-screen battle panel</option><option value="3ds">3DS -- tilted 3D route + 3D beasts in battle</option></select></label>
  ${box('beastsFollow','Your beast follows you on the route')}
  ${box('beastsSeason','Season pass: your beast keeps its level and beastdex week to week (only the route resets on Wednesday)')}
  <label>TIME OF DAY ON THE ROUTE (BEASTS)<select name="beastsTimeOfDay"><option value="">AUTO (the clock)</option><option value="day">DAY</option><option value="sunset">SUNSET</option><option value="night">NIGHT (fireflies)</option></select></label>
  <label>WHERE THE BATTLE SHOWS (BEASTS)<select name="beastsBattle"><option value="overlay">IN FRONT OF US (the overlay)</option><option value="green">BEHIND US (the green screen)</option></select></label>
  <small>Long Box Beasts is its own game, on its own track (the dungeon stays where it is while Beasts is on): sales and chat's follows, shares and bookmarks walk you up the route; three wild beasts wait in the tall grass; at the top the route's rival sends out their beast; beat it for the route's badge. Chat picks your attack (⚔️ ATTACK below); every sale fires it. You and Champ are drawn in already (cap, beard, MP 24 jersey; bald, glasses, beard) (the chibi walkers are always used now; the face photos below are kept but no longer replace them).</small>
  <div class="mana-row beast-faces"><label>YOUR FACE (a photo)<input type="file" accept="image/*" id="beast-face-file"></label><canvas id="beast-face-view" width="12" height="12"></canvas><label>CHAMP'S FACE<input type="file" accept="image/*" id="beast-buddy-file"></label><canvas id="beast-buddy-view" width="12" height="12"></canvas></div>
  <input type="hidden" name="beastsFace"><input type="hidden" name="beastsBuddy">
  <div class="mana-row"><label>✊ MR FISTER'S FACE (a front-facing photo -- it's mapped onto his 3D head; it stays in the studio, not in the code)<input type="file" accept="image/*" id="fister-face-file"></label><img id="fister-face-view" alt="" style="width:64px;height:74px;object-fit:cover;border-radius:8px"><button type="button" class="mana-btn" id="fister-face-clear">CLEAR</button></div>
  <label>YOUR BEAST'S 4 ATTACKS (one a line)<textarea name="beastsMoves" rows="4" placeholder="LOWBALL&#10;PRICE CHECK&#10;SLEEVE UP&#10;BENT CORNER"></textarea></label>
  <h3>🗡 Dungeon settings</h3>
  ${box('dungeonOn','Dungeon on: the sign is the mana flask (sales, follows, shares and bookmarks fill it)')}
  ${box('finale','FINALE tonight (the last show before Wednesday): bigger goals for every star this week')}
  <div class="mana-grid">${num('floorBase','Floor 1 goal ($)',1,1000000)}${num('floorGrowth','Each floor needs (+%)',0,500)}${num('bossShare','Floor boss HP (% of the floor goal)',1,500)}${num('manaFollow','Follow = mana',0,1000)}${num('manaShare','Share = mana',0,1000)}${num('manaBookmark','Bookmark = mana',0,1000)}${num('starsPerFloor','Stars per floor cleared',0,10)}${num('finaleBoost','Finale: +% goal per star',0,500)}</div>
  <label>Floor rewards (one per line, "3: Free giveaway in the Whatnot tool")<textarea name="floorRewards" maxlength="1200"></textarea></label>
  <label>Room rewards (when a floor has no reward of its own; rooms: vault, library, armory, forge, crypt, lab -- "vault: $1 start on a grail")<textarea name="roomRewards" maxlength="1200"></textarea></label>
  <div class="mana-grid">${box('centerStage','CENTER STAGE: big mana bar across the middle, boss stands on it')}${box('dungeonComics','COMICS ONLY: the walls and stands in the shed and dungeon show comics')}${box('miniMap','MINI-MAP: top-left corner of the green screen, fills in as you walk')}${box('crawlSharp','SHARPER DUNGEON: more pixels on the green screen (uses more of the streaming computer)')}${num('giveawayChests','Giveaway chests (the first N chests each floor are a free giveaway)',0,3)}${num('secretTaps','Cracked wall: comes down at N follows/shares/bookmarks on a floor; a secret vault behind it (0 = off)',0,500)}${num('lockboxTaps','Locked long boxes: open every N follows/shares/bookmarks on a floor (0 = off)',0,100)}${num('panelAlpha','Panel opacity % (0 = clear, 100 = solid: score board, card, map, sign)',0,100)}${box('crawlWindow','CRAWL WINDOW over the top camera (off: the crawl is the green-screen background)')}${box('itemCard','ITEM CARD: the book you walk past pops up top right')}${box('sidePictures','PROPS IN FRONT: the books and shed junk you pass slide by at the sides')}${num('triviaMana','Trivia mana',0,1000)}${box('showMap','Show the dungeon map + relic shelf')}${num('mapX','Map left',0,900)}${num('mapY','Map top',0,1700)}</div>
  <label>This show's unlocks (one per line, by the show's sales, "100: Shoutout to everyone in chat")<textarea name="showUnlocks" maxlength="1200"></textarea></label>
  <label>Treasure chests: chat goals this week, one per line (follows, shares, bookmarks or taps), e.g. "10 follows: Free giveaway in the Whatnot tool" or "25 taps: Open a box on stream"<textarea name="chestGoals" maxlength="1200" placeholder="10 follows: Free giveaway in the Whatnot tool"></textarea></label>
  <small>Chests open on chat's follows, shares and bookmarks -- never on sales -- and the prize is for everyone watching.</small>
  <small class="mana-rules">Every unlock is a goal reached -- nothing is drawn or random. Fill the flask and the floor's boss comes out; sales and taps knock its HP down; beat it to unlock the next floor, its reward and a relic for the shelf. Then two doors open: chat votes in the Whatnot chat (type 1 or 2) and you tap the winner here. No pick by the time the next flask fills means door 1. Progress carries over all week and starts fresh every Wednesday (new comic book day). Rewards are for everyone watching, never a buyers-only prize.</small>
  <h3>Boss battle</h3>
  <div class="mana-grid"><label>Boss<select name="bossCharacter">${Object.entries(BOSS_NAMES).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label><label>Boss name<input name="bossName" maxlength="40"></label>${num('bossGoal','Boss HP (show sales goal, $)',1,10000000)}</div>
  <label>Reward when the boss goes down<input name="bossReward" maxlength="120"></label>
  <small class="mana-rules">Whatnot rules: make the reward something for <b>everyone watching</b> -- a $1 start on a grail, a box opened on stream, or a free giveaway in Whatnot's giveaway tool (free to enter). Not a prize only buyers can win, and nothing tied to how much someone spends. No wheels, spins, raffles or random pulls -- the overlay won't save words for those.</small>
  ${box('showBoss','Show the boss bar')}
  <label>Boss look<select name="bossStyle"><option value="ps1">PS1 (pixelated, wobbly, blows apart)</option><option value="n64">N64 (smooth and shiny)</option></select></label>
  ${box('autoAdvance','When an auction sells, move to the next item lined up')}
  ${box('bigArt','BIG PHOTO: fill the bottom camera with the item\'s photo')}
  <div class="mana-grid">${num('bigArtY','Big photo top',0,1400)}</div>
  <small class="mana-rules">Whatnot can't start auctions from outside its app -- run each auction there; the overlay follows along. With BIG PHOTO, still hold the real book up before the timer starts: the stream is the record if a buyer says it wasn't as shown. Use your own photo of the actual copy, not a catalog cover, for anything where condition matters.</small>
  <h3>Quick</h3>
  <div class="mana-row" id="mana-quick"><button type="button" data-toggle="visible" data-key="H">SIGN ON/OFF <kbd>H</kbd></button><button type="button" data-toggle="marqueeOn" data-key="Q">MARQUEE TEXT ON/OFF <kbd>Q</kbd></button><button type="button" data-toggle="finale" data-key="V">FINALE ON/OFF <kbd>V</kbd></button></div>
  <h3>Effects</h3>
  <div id="mana-effects">${[['coin','INSERT COIN'],['countdown','COUNTDOWN'],['sold','SOLD'],['jackpot','BIG HIT'],['boss','BOSS DEFEATED'],['giveaway','FREE GIVEAWAY'],['ready','READY'],['gameover','GAME OVER'],['clear','CLEAR'],['fister','✊ MR FISTER'],['fistergoo','🖤 SYMBIOTE FISTER'],['seen','🤫 SEEN BUT NOT HEARD'],['amos','✌ AMOS'],['iceberg','🧊 ICE BERG'],['spotlight','🔦 SPOTLIGHT NOW PLAYING']].map(([k,l])=>`<button type="button" data-effect="${k}">${l}</button>`).join('')}</div>
  <small>FREE GIVEAWAY only shows the banner -- run the giveaway itself in Whatnot's giveaway tool. Its winner shows automatically.</small>
  <h3>📺 Share a screen</h3>
  <div class="mana-row"><label>WHAT IT IS<input id="scr-title" maxlength="40" placeholder="FOC ORDERS -- FOLLOW ALONG"></label><label>WHERE<select id="scr-layout"><option value="corner">CORNER</option><option value="half">RIGHT HALF</option><option value="full">FULL SCREEN</option></select></label><button type="button" id="scr-go">📺 SHARE A SCREEN</button><button type="button" id="scr-stop">STOP SHARING</button></div>
  <small>Pick a window or a tab on this computer (your FOC page, the order list) and it shows live in the overlay in OBS, in a frame with the words above on it. Use Chrome or Edge on a computer, and keep this tab open while it's shared. On the computer that runs OBS you can also just add OBS's own Window Capture.</small>
  <h3>ByteRider_97</h3>
  <div class="mana-grid">${box('mascotOn','Show ByteRider_97')}${box('mascotSounds','ByteRider sounds')}${box('showHype','Hype meter')}${box('mascotSaysMarquee','ByteRider says the marquee lines')}${num('mascotSayEvery','…one every (seconds)',10,600)}${box('mascotBorder','His bezel round the screen')}${box('mascotIdleFace','Keep a faint face up between reactions')}${num('mascotScale','Face size (%)',40,150)}${num('mascotFaceY','Face height on screen',250,1650)}</div>
  <small>The phone screen is his monitor: his face pops onto it when he reacts, then clears so the cameras show. He reacts on his own to sales, big hits, the boss K.O., countdowns, giveaways and winners, the show starting and ending, and each new item up. Whatnot doesn't send follows or auction starts, so those are buttons here. He naps after 5 quiet minutes.</small>
  <div id="mana-mascot">${MASCOT_KEYS.map(([k,l,key,say])=>`<button type="button" data-mascot="${k}"${say?` data-say="${say}"`:''} data-key="${key}">${l} <kbd>${key}</kbd></button>`).join('')}</div>
  <label class="mana-check"><span><input type="checkbox" id="mana-dash-br"> Show ByteRider in the dashboard corner (this device)</span></label>
  <label class="mana-check"><span><input type="checkbox" id="mana-keys"> Keyboard shortcuts (the letters/numbers on the buttons; only on the Whatnot tab, never while typing in a box)</span></label>
  <div class="mana-row"><input id="mana-say" maxlength="120" placeholder="Make him say something (a promo, a shout-out)…"><button type="button" id="mana-say-go">SAY IT</button></div>
  <h3>Ask ByteRider (website)</h3>
  <small>On the website, a tap on ByteRider opens a chat. He answers from what's in stock right now and the facts below -- nothing else, so put in what customers ask: store hours, address, events, policies. One fact per line.</small>
  <textarea id="mana-br-facts" maxlength="6000" rows="7" placeholder="Connect / reload to load what he knows…"></textarea>
  <div class="mana-row"><button type="button" id="mana-br-facts-save">SAVE WHAT HE KNOWS</button><button type="button" id="mana-br-facts-reset">BACK TO DEFAULT</button><small id="mana-br-facts-status" role="status"></small></div>
  <div class="mana-row"><button type="button" id="mana-pin">📌 PIN PREVIEW</button><small id="mana-br-status" role="status">Tap a reaction: he plays it in the preview (and on stream once connected).</small></div>
  <h3>Sign &amp; layout</h3>
  <label>Marquee message (separate lines with • or | -- ByteRider says them one at a time)<textarea name="message" maxlength="300"></textarea></label>
  <div class="mana-row" id="mq-tpl-row"><label>MARQUEE TEMPLATES<select id="mq-tpl"></select></label><button type="button" id="mq-use">PUT ON THE SIGN</button><button type="button" id="mq-save">SAVE THIS MESSAGE AS A TEMPLATE</button><button type="button" id="mq-del">DELETE TEMPLATE</button></div>
  <input type="hidden" name="marqueeTemplates">
  <input type="hidden" name="chestLoad">
  <div class="mana-grid">
  ${num('x','Sign left',0,1080)}${num('y','Sign top',0,1920)}${num('width','Sign width',240,1080)}${num('height','Sign height',70,300)}
  ${num('speed','Scroll cycle (seconds)',4,60)}${num('hudY','Score board top',0,1700)}${num('cardX','Card left',0,700)}${num('cardY','Card top',0,1560)}
  ${num('countdownSeconds','Countdown (seconds)',3,15)}${num('volume','Volume (%)',0,100)}${num('jackpotAmount','BIG HIT at ($)',1,1000000)}
  <label>Currency<input name="currency" maxlength="3" pattern="[A-Z]{3}" required></label></div>
  <div class="mana-grid">${box('visible','Show sign')}${box('marqueeOn','Scrolling marquee on the sign')}${box('showHud','Show score board')}${box('showCard','Show now playing')}${box('showQueue','Show next up')}${box('showCombo','Show combos')}${box('attract','INSERT COIN when nothing is playing')}${box('muted','Mute sound')}${box('showBuyerNames','Show buyer usernames ("THANKS @name")')}${box('chaseOn','🔥 Chase countdown (the priciest item lined up)')}</div>
  <div class="mana-row"><label>COUNTDOWN WORD<input name="chaseLabel" maxlength="16" placeholder="CHASE (or HEAT, BIG HIT, KEY)"></label><label>ONLY ITEMS AT OR OVER $<input name="chaseMin" type="number" min="0" step="1"></label></div>
  <small>Buyer usernames are off unless you turn them on. Whatnot shows the winner's username in the app already; check Whatnot's seller rules before showing them. Only the username is ever shown, and there's no "top spender" board.</small>
  <button type="submit">Save live settings</button></form></details>
  <div class="mana-preview"><iframe title="Overlay preview over two camera placeholders" data-src="arcade-overlay.html#preview=1" src="about:blank"></iframe><iframe class="mana-preview-bg" title="Green-screen shed behind the top camera" data-src="shed-background.html#preview=1" src="about:blank"></iframe></div>
  <div class="mana-row"><button type="button" id="mana-demo">DEMO A SALE (preview only)</button><button type="button" id="mana-demo-run">⏩ PLAY THROUGH THE DUNGEON (preview only)</button></div><small>Demo sales only move the preview: the real dungeon, chests, stretch goals and show are not touched. PLAY THROUGH keeps demoing sales so you can watch every floor, chest, boss and stretch goal; tap it again to stop, ↺ RESET to start over.</small><small>Preview is silent. Both camera areas are placeholders; camera sources stay in OBS.</small>
  <button id="mana-link">Create / replace OBS link</button><button id="mana-revoke">Revoke OBS link</button><label>Private OBS Browser Source URL<input id="mana-url" readonly></label><label>Shed background URL (green screen)<input id="mana-shed-url" readonly></label><div class="mana-row"><a href="shed-background.html#demo=1" target="_blank" rel="noopener">PREVIEW ALL SHEDS ↗</a></div><small>Green screen: put the shed background as a Browser Source (1080 × 1920) <b>under</b> your camera, and add OBS's Chroma Key filter to the camera. The shed follows the dungeon's floor, shows the room chat picked, and glows red while a boss is up.</small><small>Link expires after 12 hours. Replacing it disconnects old overlays. OBS: Browser Source 1080 × 1920 above both cameras, enable “Control audio via OBS”. If sound is blocked, use OBS Interact and click the overlay once.</small>`;
  const form=host.querySelector('form'),status=host.querySelector('#mana-status'),frame=host.querySelector('iframe');
  // The studio is on screen: the page is showing and its tab is open (a closed tab panel has no layout).
  const studioOnScreen=()=>!document.hidden&&host.getClientRects().length>0;
  // A demo sale holds the preview where the demo left it for 2 minutes (the 8-second refresh used to snap it back).
  let demoFake=null,demoUntil=0;
  let machineCtl={on:false,items:[]},flipCtl=null;
  let revision=0,connectedStore='',settings=null,stats=null,stage={now:null,next:[]},shedPicsCtl=[];
  function store(){return typeof getActiveStoreId==='function'?getActiveStoreId():'';}
  // The camera joystick (2026-11-12): drag to look; sent a few times a second
  // while dragging, to the show's screens and to the preview here.
  function camSend(cam){
    for(const f of host.querySelectorAll('.mana-preview iframe'))f.contentWindow?.postMessage({type:'mana-camera',cam},location.origin);
    api('camera',cam).catch(e=>{if(!camSend.warned){camSend.warned=1;status.textContent='Camera: '+e.message;}});
  }
  function wireJoystick(){
    const pad=host.querySelector('#mana-joy');if(!pad||pad.dataset.on)return;pad.dataset.on=1;const knob=pad.querySelector('i');let id=null,last=0,cur={yaw:0,pitch:0},timer=0;
    const move=ev=>{const r=pad.getBoundingClientRect(),rad=r.width/2;let dx=(ev.clientX-r.left-rad)/rad,dy=(ev.clientY-r.top-rad)/rad;const m=Math.hypot(dx,dy);if(m>1){dx/=m;dy/=m;}
      knob.style.transform=`translate(${dx*rad*0.62}px,${dy*rad*0.62}px)`;cur={yaw:Math.round(dx*100)/100,pitch:Math.round(-dy*100)/100};
      const now=Date.now();if(now-last>220){last=now;camSend(cur);}else{clearTimeout(timer);timer=setTimeout(()=>{last=Date.now();camSend(cur);},230);}};
    pad.addEventListener('pointerdown',ev=>{id=ev.pointerId;pad.setPointerCapture(id);pad.classList.add('on');move(ev);});
    pad.addEventListener('pointermove',ev=>{if(ev.pointerId===id)move(ev);});
    const up=ev=>{if(ev.pointerId!==id)return;id=null;pad.classList.remove('on');knob.style.transform='';clearTimeout(timer);camSend(cur);};
    pad.addEventListener('pointerup',up);pad.addEventListener('pointercancel',up);
    host.querySelector('#mana-scout').onclick=()=>camSend({action:'scout'});
    host.querySelector('#mana-lookback').onclick=()=>camSend({action:'back'});
    const sr=host.querySelector('#mana-show-ready');if(sr)sr.onclick=()=>{if(confirm('Load the dungeon from your comics in stock? It replaces the chest, floor and room rewards'+((stage.next||[]).length<5?' and fills NEXT UP':'')+'.'))run(showReady);};
    // LONG BOX BEASTS: your face and Champ's from a photo (12 x 12, four greens -- kept in the settings, no upload);
    // chat's new attack goes in as the 4th.
    const faceIn=(fileId,field,viewId)=>{const inp=host.querySelector(fileId);if(!inp||inp.dataset.on)return;inp.dataset.on=1;inp.onchange=()=>{const f=inp.files?.[0];if(!f)return;run(async()=>{const B=await import('./beasts.mjs?v='+STUDIO_V);const url=URL.createObjectURL(f);const im=new Image();await new Promise((ok,no)=>{im.onload=ok;im.onerror=()=>no(Error('Could not read that photo'));im.src=url;});form.elements.namedItem(field).value=B.faceFromImage(im);URL.revokeObjectURL(url);drawFace(viewId,field);const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);status.textContent='Face saved -- it walks the route now.';});};};
    // Mr Fister's face: the middle of the photo (head and beard), 112 x 128, as a small JPEG to the studio.
    const ff=host.querySelector('#fister-face-file');if(ff&&!ff.dataset.on){ff.dataset.on=1;ff.onchange=()=>{const f=ff.files?.[0];if(!f)return;const im=new Image();im.onload=()=>run(async()=>{const c=document.createElement('canvas');c.width=112;c.height=128;const x=c.getContext('2d'),w=im.naturalWidth,h=im.naturalHeight,s=Math.min(w,h*0.875)*0.62,cx=w/2,cy=h*0.42;x.drawImage(im,cx-s/2,cy-s*0.5714,s,s*1.1428,0,0,112,128);const face=c.toDataURL('image/jpeg',0.82);URL.revokeObjectURL(im.src);const v=host.querySelector('#fister-face-view');if(v)v.src=face;if(!connectedStore){status.textContent='Mr Fister\'s face is ready -- connect to send it to the show.';return;}await api('fister-face',{face});status.textContent='Mr Fister\'s face is on his 3D head.';});im.src=URL.createObjectURL(f);};}
    const fc=host.querySelector('#fister-face-clear');if(fc&&!fc.dataset.on){fc.dataset.on=1;fc.onclick=()=>run(async()=>{const v=host.querySelector('#fister-face-view');if(v)v.removeAttribute('src');if(connectedStore)await api('fister-face',{face:''});status.textContent='Mr Fister\'s face cleared.';});}
    faceIn('#beast-face-file','beastsFace','#beast-face-view');faceIn('#beast-buddy-file','beastsBuddy','#beast-buddy-view');
    const addMove=host.querySelector('#beast-add-move');if(addMove)addMove.onclick=()=>run(async()=>{const nm=String(host.querySelector('#beast-new-move').value||'').trim().toUpperCase().slice(0,16);if(!nm)throw Error('Type the attack chat came up with');const el=form.elements.namedItem('beastsMoves');const cur=String(el.value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);const base=cur.length?cur:['LOWBALL','PRICE CHECK','SLEEVE UP','BENT CORNER'];el.value=[...base.slice(0,3),nm].join('\n');const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);host.querySelector('#beast-new-move').value='';status.textContent='New attack: '+nm+' (slot 4).';});
    // THE GAME, in one tap (the setting is saved and the screens switch).
    const gameBtn=(id,mode,msg)=>{const b=host.querySelector(id);if(b)b.onclick=()=>run(async()=>{form.elements.namedItem('gameMode').value=mode;preview();const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);status.textContent=msg;paintGame();});};
    gameBtn('#game-dungeon','dungeon','The Shed Dungeon is on.');
    // VENDING ONLY (2026-11-13): no game; the machine full screen behind you, stocked from the lineup if it's empty.
    const gv=host.querySelector('#game-vending');if(gv)gv.onclick=()=>run(async()=>{form.elements.namedItem('gameMode').value='vending';preview();if(connectedStore){const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);}paintGame();await machineDo({...(!(machineCtl.items||[]).length&&(stage?.now||stage?.next?.length)?{load:'stage'}:{}),on:true,mode:'full'});status.textContent='Vending only: the machine is up, full screen behind you.'+((machineCtl.items||[]).length?'':' It is empty -- load NOW + NEXT UP or make spots.');});gameBtn('#game-beasts','beasts','Long Box Beasts is on.');
    // BEASTS' OWN BUTTONS (its section): taps, + $, the route, start over -- the server sends them to Beasts while it's on.
    host.querySelectorAll('[data-beast-tap]').forEach(b=>{b.onclick=()=>host.querySelector('#mana-taps [data-tap="'+b.dataset.beastTap+'"]')?.click();});
    const ba=host.querySelector('#beast-add-go');if(ba)ba.onclick=()=>{host.querySelector('#mana-add-mana').value=host.querySelector('#beast-add').value;host.querySelector('#beast-add').value='';host.querySelector('#mana-add-mana-go').click();};
    // See the evolution cutscene in the preview (nothing changes in the show).
    const be=host.querySelector('#beast-preview-evo');if(be)be.onclick=()=>run(async()=>{const B=beastsLib||await import('./beasts.mjs?v='+STUDIO_V);const st=stats?.beastStarter||'',now=Date.now();preview({id:'evo-'+now,kind:'beast',beastEvent:'evolve',fromName:B.formName(st,1),beastName:B.formName(st,10),level:10,reward:values().beastsEvolveReward||'',startsAt:now,endsAt:now+7000});status.textContent='Preview: '+B.formName(st,1)+' evolves into '+B.formName(st,10)+'.';});
    const br=host.querySelector('#beast-route');if(br)br.onclick=()=>host.querySelector('#quick-floor')?.click();
    const bz=host.querySelector('#beast-reset');if(bz)bz.onclick=()=>host.querySelector('#mana-reset-week')?.click();
    // Where the battle shows: over the hosts (the overlay) or behind them (the green screen).
    const whereBtn=(id,v,msg)=>{const b=host.querySelector(id);if(b)b.onclick=()=>run(async()=>{form.elements.namedItem('beastsBattle').value=v;preview();paintGame();if(!connectedStore){status.textContent=msg+' (preview)';return;}const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);status.textContent=msg;});};
    whereBtn('#battle-front','overlay','The battle shows in front of you.');whereBtn('#battle-green','green','The battle shows on the green screen, behind you.');
    // Reset the preview's demo (its floor, mana and sales go back to the show's), and set the floor in one tap.
    const dr=host.querySelector('#demo-reset');if(dr)dr.onclick=()=>{demo=0;demoGross=0;demoBig=0;demoDungeon=null;demoBeasts=null;demoFake=null;demoUntil=0;demoMove=null;preview();paintMoves();status.textContent='Preview demo reset.';};
    const qf=host.querySelector('#quick-floor');if(qf)qf.onclick=()=>{const v=prompt(values().gameMode==='beasts'?'Which route? (1-99)':'Which floor? (1-99)');if(!v)return;host.querySelector('#mana-set-floor').value=v;host.querySelector('#mana-set-floor-go').click();};
    form.addEventListener('input',e=>{if(e.target?.name==='beastsMoves')paintMoves();});form.addEventListener('change',e=>{if(['gameMode','beastsBattle'].includes(e.target?.name))paintGame();});setTimeout(paintMoves,0);
    // THE VENDING MACHINE's buttons.
    const vmb=(id,body,msg)=>{const b=host.querySelector(id);if(b)b.onclick=()=>run(async()=>{await machineDo(typeof body==='function'?body():body);const empty=!(machineCtl.items||[]).length;status.textContent=(empty&&machineCtl.on?'The machine is up but EMPTY -- tap LOAD FROM NOW + NEXT UP (fill NOW PLAYING / NEXT UP first) or 🎟 MAKE SPOTS below.':msg)+(connectedStore?'':' (preview -- connect to use it in the show)');if(empty){const sp=host.querySelector('details.vm-spots');if(sp)sp.open=true;}});};
    vmb('#vm-load',{load:'stage'},'Machine loaded from NOW PLAYING + NEXT UP.');vmb('#vm-show',{on:true},'The machine is on the green screen.');vmb('#vm-hide',{on:false},'Machine hidden.');
    vmb('#vm-title-go',()=>({title:String(host.querySelector('#vm-title').value||'')}),'Machine named.');
    // THE SHOWCASE (2026-11-14): the FOC books coming up (covers, price, FOC date) and the in-stock BIN items (price).
    const binItems=()=>inventory().filter(i=>i.status==='in_stock'&&i.sellOnWhatnot===true&&i.whatnotShowOnly!==true&&(https(i.thumbnail)||https(i.imageUrl))).map(i=>({...stageItem(i),price:Number(i.price||i.market||i.marketPrice||0)||0,shelf:'bin'})).filter(it=>it.image&&it.price>0&&!chanceFn(it.title+' '+it.detail)).sort((a,b)=>b.price-a.price).slice(0,60);
    const newReleases=async()=>{const sb=typeof getSupabaseClient==='function'?getSupabaseClient():null,id=store();if(!sb||!id)return[];const today=new Date().toISOString().slice(0,10);
      const {data,error}=await sb.from('comic_skus').select('title,variant_label,cover_image_url,foc_date,on_sale_date,customer_price_cents,msrp_cents').eq('store_id',id).eq('customer_enabled',true).gte('foc_date',today).not('cover_image_url','is',null).order('foc_date',{ascending:true}).limit(40);
      if(error)throw Error('New releases: '+error.message);const md=d=>d?d.slice(5).replace('-','/'):'';
      return (data||[]).filter(r=>https(r.cover_image_url)).map(r=>({title:String((r.title||'')+(r.variant_label?' '+r.variant_label:'')).slice(0,90),detail:'FOC '+md(r.foc_date)+(r.on_sale_date?' · OUT '+md(r.on_sale_date):''),image:r.cover_image_url,price:(Number(r.customer_price_cents)||Number(r.msrp_cents)||0)/100,shelf:'pre',badge:'FOC '+md(r.foc_date)})).filter(it=>!chanceFn(it.title));};
    // THE FOC FLIPBOOK: this week's books (one per title, its covers inside) with their synopses, to the overlay.
    // 2026-11-19: "select a FOC week and it shows all covers in alphabetical order". The weeks come from the FOC
    // cycles (two back, six ahead); the books are every cover of that week's cycles, A to Z.
    const fbSb=()=>{const sb=typeof getSupabaseClient==='function'?getSupabaseClient():null,id=store();if(!sb||!id)throw Error('Sign in to the dashboard first.');return {sb,id};};
    const ymd=d=>d.toISOString().slice(0,10),mdy=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(d||'');return m?(+m[2])+'/'+(+m[3]):d;};
    let fbWeeksFor='';
    async function fbWeeks(){const {sb,id}=fbSb();if(fbWeeksFor===id)return;const now=Date.now();
      const {data,error}=await sb.from('foc_cycles').select('foc_date').eq('store_id',id).gte('foc_date',ymd(new Date(now-15*864e5))).lte('foc_date',ymd(new Date(now+43*864e5))).order('foc_date',{ascending:true});
      if(error)throw Error('FOC weeks: '+error.message);const sel=host.querySelector('#fb-week'),today=ymd(new Date());
      const days=[...new Set((data||[]).map(r=>String(r.foc_date).slice(0,10)))],next=days.find(d=>d>=today)||days[days.length-1]||'';
      sel.replaceChildren(...days.map(d=>{const o=document.createElement('option');o.value=d;o.textContent='FOC '+mdy(d)+(d===next?' (next)':d<today?' (past)':'');return o;}));sel.value=next;fbWeeksFor=id;}
    {const d=host.querySelector('.fb-ctl');if(d)d.addEventListener('toggle',()=>{if(d.open)fbWeeks().catch(e=>{status.textContent=e.message;});});}
    const NOT_COMIC=/\b(TP|HC|GN|SC|OMNIBUS|VOL\.?|VOLUME|COLLECTION|POSTER|BUTTONS?|NET|STATUE|FIGURE|PIN|T-?SHIRT|PLUSH|MAGNET|BOX SET|TRADE PAPERBACK|HARDCOVER|DELUXE|EDITION)\b/i;
    const flipBooks=async()=>{const {sb,id}=fbSb();await fbWeeks();const week=host.querySelector('#fb-week').value,dist=host.querySelector('#fb-dist').value,comics=host.querySelector('#fb-comics').checked;
      if(!week)throw Error('No FOC weeks loaded yet (import a FOC list first).');
      let cq=sb.from('foc_cycles').select('id,distributor').eq('store_id',id).eq('foc_date',week);if(dist)cq=cq.eq('distributor',dist);
      const {data:cyc,error:ce}=await cq;if(ce)throw Error('Flipbook: '+ce.message);const ids=(cyc||[]).map(c=>c.id);if(!ids.length)throw Error('No '+(dist||'')+' FOC list for '+mdy(week)+'.');
      const {data,error}=await sb.from('comic_skus').select('title,variant_label,cover_image_url,foc_date,on_sale_date,customer_price_cents,msrp_cents,description,writer,interior_artist,cover_artist,publisher,is_incentive,order_requirement').eq('store_id',id).in('cycle_id',ids).not('cover_image_url','is',null).order('title',{ascending:true}).limit(1500);
      if(error)throw Error('Flipbook: '+error.message);const F=await import('./flipbook.mjs?v='+STUDIO_V);
      const rows=(data||[]).filter(r=>!comics||!NOT_COMIC.test(r.title||''));
      return {books:F.cleanFlipItems(F.booksFromSkus(rows).filter(b=>!chanceFn(b.title))),week};};
    const fbJumpList=items=>{const sel=host.querySelector('#fb-jump');if(!sel)return;sel.replaceChildren(...[{t:'Pick a book...',v:''},...(items||[]).map((b,k)=>({t:b.title+(b.covers.length>1?' ('+b.covers.length+' covers)':''),v:String(k)}))].map(x=>{const o=document.createElement('option');o.value=x.v;o.textContent=x.t;return o;}));};
    const flipDo=async body=>{if(connectedStore){const d=await api('flip',body);flipCtl=d.flip;preview();return;}
      const f={on:false,items:[],secs:12,mode:'full',title:'',at:Date.now(),...(flipCtl||{})};if(body.items){f.items=body.items;f.at=Date.now();}if(body.secs!==undefined){f.secs=body.secs;f.at=Date.now();}if(body.mode)f.mode=body.mode;if(body.show)f.show=body.show;if(typeof body.only==='boolean')f.only=body.only;if(body.wanted)f.wanted=body.wanted;if(typeof body.title==='string')f.title=body.title.toUpperCase();if(body.step)f.at-=body.step*f.secs*1000;if(typeof body.on==='boolean'){if(body.on&&!f.on)f.at=Date.now();f.on=body.on&&f.items.length>0;}flipCtl=f;preview();};
    const fbLook=()=>({secs:Math.max(5,Math.min(60,Number(host.querySelector('#fb-secs').value)||14)),mode:host.querySelector('#fb-mode').value,title:String(host.querySelector('#fb-title').value||host.querySelector('#fb-title').placeholder.replace(/^FOC THIS SUNDAY$/,'')||'NEW BOOKS THIS WEEK')});
    // MOST WANTED (2026-11-19): the top 5 books of the shop's FOC order for the week so far (titles and covers, never the
    // numbers), checked every 2 minutes while the flipbook is on -- it fills in as the order is put in.
    let fbWeekShown='',fbDistShown='';
    async function fbWanted(){const {sb,id}=fbSb();if(!fbWeekShown)return [];let cq=sb.from('foc_cycles').select('id').eq('store_id',id).eq('foc_date',fbWeekShown);if(fbDistShown)cq=cq.eq('distributor',fbDistShown);
      const {data:cyc}=await cq;const ids=(cyc||[]).map(c=>c.id);if(!ids.length)return [];
      const {data}=await sb.from('comic_skus').select('title,cover_image_url,store_quantity,secured_quantity').eq('store_id',id).in('cycle_id',ids).or('store_quantity.gt.0,secured_quantity.gt.0').not('cover_image_url','is',null).limit(400);
      const F=await import('./flipbook.mjs?v='+STUDIO_V),by=new Map();
      for(const r of data||[]){const q=Math.max(Number(r.store_quantity)||0,Number(r.secured_quantity)||0),bk=F.splitSkuTitle(r.title).book,k=bk.toUpperCase(),w=by.get(k)||{title:bk,image:r.cover_image_url,q:0,top:0};w.q+=q;if(q>w.top){w.top=q;w.image=r.cover_image_url;}by.set(k,w);}
      return [...by.values()].filter(w=>w.q>0).sort((a,b)=>b.q-a.q||a.title.localeCompare(b.title)).slice(0,5).map(w=>({title:w.title,image:w.image}));}
    setInterval(()=>{if(!connectedStore||connectedStore!==store()||document.hidden||!flipCtl?.on)return;fbWanted().then(w=>{if(JSON.stringify(w)!==JSON.stringify(flipCtl.wanted||[]))return flipDo({wanted:w});}).catch(()=>{});},120000);
    // START / END FOC SHOW (2026-11-19): one tap -- the week's books, on the lower half, AUTO MIX, and the overlay shows
    // only them (camera on top). END hides them and brings the rest of the overlay back.
    {const b=host.querySelector('#fb-start');if(b)b.onclick=()=>run(async()=>{if(!connectedStore)await connect();const {books:items,week}=await flipBooks();if(!items.length)throw Error('No books with covers in that FOC week.');
      fbWeekShown=week;fbDistShown=host.querySelector('#fb-dist').value;const wanted=await fbWanted().catch(()=>[]);const tIn=host.querySelector('#fb-title');
      host.querySelector('#fb-mode').value='lower';if(!host.querySelector('#fb-show').value)host.querySelector('#fb-show').value='auto';
      await flipDo({items,...fbLook(),mode:'lower',...(tIn.value?{}:{title:'FOC '+mdy(week)+' · A TO Z'}),show:host.querySelector('#fb-show').value,wanted,only:true,on:true});fbJumpList(items);
      status.textContent='📚 FOC show on: FOC '+mdy(week)+', '+items.length+' books on the bottom half, nothing else on the overlay.';});}
    // BAG & BOARD SHOW (store, 2026-11-19: "when we're boarding and bagging the new releases ... I want the bottom screen
    // to flip through all the books that we ordered that will be in the show"): the books ordered (the store's order
    // count, or copies secured) for that on-sale date -- only the covers ordered -- A to Z, books only on the lower half.
    let bbFor='';
    async function bbWeeks(){const {sb,id}=fbSb();if(bbFor===id)return;const now=Date.now();
      const {data,error}=await sb.from('comic_skus').select('on_sale_date').eq('store_id',id).gte('on_sale_date',ymd(new Date(now-7*864e5))).lte('on_sale_date',ymd(new Date(now+35*864e5))).or('store_quantity.gt.0,secured_quantity.gt.0').limit(3000);
      if(error)throw Error('New release weeks: '+error.message);const today=ymd(new Date());
      // PRH comes out Tuesday, Lunar Wednesday: each week goes by its Wednesday.
      const wed=d=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+((3-x.getUTCDay()+7)%7));return ymd(x);};
      const days=[...new Set((data||[]).map(r=>String(r.on_sale_date||'').slice(0,10)).filter(Boolean).map(wed))].sort(),next=days.find(d=>d>=wed(today))||days[days.length-1]||'';
      const sel=host.querySelector('#bb-week');sel.replaceChildren(...days.map(d=>{const o=document.createElement('option');o.value=d;o.textContent='WEEK OF '+mdy(d)+(d===next?' (next)':d<today?' (out now)':'');return o;}));sel.value=next;bbFor=id;}
    {const s=host.querySelector('#bb-show-sec');if(s)s.addEventListener('pointerenter',()=>{bbWeeks().catch(()=>{});},{once:true});}
    {const b=host.querySelector('#bb-start');if(b)b.onclick=()=>run(async()=>{if(!connectedStore)await connect();const {sb,id}=fbSb();await bbWeeks();const day=host.querySelector('#bb-week').value;
      if(!day)throw Error('No ordered books with an on-sale date coming up (import your FOC orders first).');
      const {data,error}=await sb.from('comic_skus').select('title,variant_label,cover_image_url,foc_date,on_sale_date,customer_price_cents,msrp_cents,description,writer,interior_artist,cover_artist,publisher,is_incentive,order_requirement').eq('store_id',id).gte('on_sale_date',ymd(new Date(Date.parse(day+'T12:00:00Z')-864e5))).lte('on_sale_date',day).or('store_quantity.gt.0,secured_quantity.gt.0').not('cover_image_url','is',null).order('title',{ascending:true}).limit(1500);
      if(error)throw Error('Bag & board: '+error.message);const F=await import('./flipbook.mjs?v='+STUDIO_V);
      const items=F.cleanFlipItems(F.booksFromSkus((data||[]).filter(r=>!NOT_COMIC.test(r.title||''))).filter(b=>!chanceFn(b.title)));
      if(!items.length)throw Error('No ordered books with covers out '+mdy(day)+'.');
      const when=String(host.querySelector('#bb-when').value||'').trim().toUpperCase();
      await flipDo({items,...fbLook(),mode:'lower',title:'NEW '+mdy(day)+(when?' · IN OUR '+when+' SHOW':' · IN OUR NEXT SHOW'),show:host.querySelector('#fb-show').value||'flip',wanted:[],only:true,on:true});fbJumpList(items);
      const covers=items.reduce((n,x)=>n+x.covers.length,0);status.textContent='📦 Bag & board show on: '+items.length+' books ('+covers+' covers) out '+mdy(day)+', on the bottom half.';});}
    {const b=host.querySelector('#bb-end');if(b)b.onclick=()=>run(async()=>{await flipDo({on:false,only:false});status.textContent='Bag & board show off -- the rest of the overlay is back.';});}
    {const b=host.querySelector('#fb-end');if(b)b.onclick=()=>run(async()=>{await flipDo({on:false,only:false});status.textContent='FOC show off -- the rest of the overlay is back.';});}
    {const s=host.querySelector('#fb-show');if(s)s.onchange=()=>void run(async()=>{if(!flipCtl?.items?.length)throw Error('Load the flipbook first (📖 LOAD + SHOW).');await flipDo({show:s.value});status.textContent='Display: '+s.options[s.selectedIndex].textContent;});}
    {const b=host.querySelector('#fb-go');if(b)b.onclick=()=>run(async()=>{const {books:items,week}=await flipBooks();if(!items.length)throw Error('No books with covers in that FOC week.');const tIn=host.querySelector('#fb-title');if(!tIn.value)tIn.placeholder='FOC '+mdy(week);
      fbWeekShown=week;fbDistShown=host.querySelector('#fb-dist').value;const wanted=await fbWanted().catch(()=>[]);
      await flipDo({items,...fbLook(),...(tIn.value?{}:{title:'FOC '+mdy(week)+' · A TO Z'}),show:host.querySelector('#fb-show').value,wanted,on:true});fbJumpList(items);const covers=items.reduce((n,x)=>n+x.covers.length,0);status.textContent='📖 Flipbook on: FOC '+mdy(week)+', '+items.length+' books, '+covers+' covers, A to Z.'+(connectedStore?'':' (preview -- connect to put it on the show)');});}
    {const s=host.querySelector('#fb-jump');if(s)s.onchange=()=>{const k=Number(s.value);if(s.value===''||!flipCtl?.items?.[k])return;void run(async()=>{await flipDo({jump:k});status.textContent='📖 Now showing: '+flipCtl.items[k].title;});};}
    for(const [id,body,msg] of [['#fb-back',{step:-1},'Back a book.'],['#fb-next',{step:1},'Next book.'],['#fb-off',{on:false},'Flipbook hidden.']]){const b=host.querySelector(id);if(b)b.onclick=()=>run(async()=>{if(!flipCtl?.items?.length)throw Error('Load the flipbook first.');await flipDo(body);status.textContent=msg;});}
    for(const id of ['#fb-secs','#fb-mode','#fb-title']){const el=host.querySelector(id);if(el)el.onchange=()=>{if(flipCtl?.on)void run(()=>flipDo(fbLook()));};}
    const showcase=(want,msg)=>{const b=host.querySelector(want);if(b)b.onclick=()=>run(async()=>{const pre=want!=='#vm-sc-bin'?await newReleases():[],bin=want!=='#vm-sc-pre'?binItems():[],items=[...pre,...bin].slice(0,120);if(!items.length)throw Error(want==='#vm-sc-pre'?'No new releases with covers coming up (FOC books need a cover).':want==='#vm-sc-bin'?'No Buy It Now items with photos and prices in stock.':'Nothing to show: no FOC books with covers and no BIN items with photos.');await machineDo({items,kind:'showcase',mode:'lower',on:true});status.textContent=msg+' '+pre.length+' new releases, '+bin.length+' bin items.'+(connectedStore?'':' (preview -- connect to put it on the show)');});};
    showcase('#vm-sc-both','Showcase on the lower half:');showcase('#vm-sc-pre','Showcase (new releases):');showcase('#vm-sc-bin','Showcase (the bin):');
    vmb('#vm-fl-go',()=>({flash:{slots:String(host.querySelector('#vm-fl-slots').value||'').split(/[^0-9]+/).filter(Boolean).map(Number),pct:Number(host.querySelector('#vm-fl-pct').value)||0,price:Number(host.querySelector('#vm-fl-price').value)||0,minutes:Number(host.querySelector('#vm-fl-min').value)||5}}),'⚡ Flash sale is on -- the old prices show crossed out. Change the prices on Whatnot to match.');
    vmb('#vm-fl-end',{flashEnd:true},'Flash sale ended -- back to the old prices.');
    vmb('#vm-look-go',()=>({theme:String(host.querySelector('#vm-theme').value||''),giveEvery:Number(host.querySelector('#vm-give').value)||0}),'Machine look set.');
    host.querySelectorAll('[data-vm-mode]').forEach(b=>{const m=b.dataset.vmMode;vmb('[data-vm-mode="'+m+'"]',{mode:m,on:true},m==='front'?'Machine full screen, in front of you.':m==='full'?'Machine full screen, behind you.':'Machine small, behind you.');});
    // SAVED SPOT LISTS: the break's 75 characters, typed once, used every week (kept on this device).
    const SL='mana-spot-lists',lists=()=>{try{return JSON.parse(localStorage.getItem(SL)||'{}')||{};}catch{return {};}},putLists=o=>{try{localStorage.setItem(SL,JSON.stringify(o));}catch{}};
    const fillSaved=()=>{const sel=host.querySelector('#vm-saved');if(!sel)return;const o=lists();sel.replaceChildren(new Option('— SAVED LISTS —',''),...Object.keys(o).sort().map(k=>new Option(k+' ('+(o[k].names?o[k].names.split('\n').filter(Boolean).length:o[k].count)+')',k)));};fillSaved();
    const q=id=>host.querySelector(id);
    if(q('#vm-save-list'))q('#vm-save-list').onclick=()=>{const name=String(prompt('Name this list (e.g. MARVEL 75)')||'').trim().toUpperCase().slice(0,30);if(!name)return;const o=lists();o[name]={count:Number(q('#vm-n').value)||0,price:Number(q('#vm-price').value)||0,prefix:q('#vm-prefix').value,names:q('#vm-names').value};putLists(o);fillSaved();q('#vm-saved').value=name;status.textContent='Saved: '+name;};
    if(q('#vm-load-list'))q('#vm-load-list').onclick=()=>{const it=lists()[q('#vm-saved').value];if(!it){status.textContent='Pick a saved list first.';return;}q('#vm-n').value=it.count||'';q('#vm-price').value=it.price||'';q('#vm-prefix').value=it.prefix||'SPOT';q('#vm-names').value=it.names||'';status.textContent='Loaded -- tap MAKE THE SPOTS.';};
    if(q('#vm-del-list'))q('#vm-del-list').onclick=()=>{const k=q('#vm-saved').value;if(!k||!confirm('Delete the list '+k+'?'))return;const o=lists();delete o[k];putLists(o);fillSaved();};
    // SPOTS ON WHATNOT: the machine's spots not listed yet, 10 at a time, after a yes.
    const wn=host.querySelector('#vm-wn-go');if(wn)wn.onclick=()=>run(async()=>{
      if(!connectedStore)throw Error('Connect first -- this makes real listings in your Whatnot show.');
      if(machineCtl.kind!=='spots'||!(machineCtl.items||[]).length)throw Error('Make the spots first (🎟 MAKE THE SPOTS).');
      const showId=String(values().showId||'').trim();if(!/^[0-9a-f-]{36}$/i.test(showId))throw Error('Set the Whatnot show first (⚙ Settings → Show → USE LIVE / NEXT SHOW).');
      const photo=String(host.querySelector('#vm-wn-photo').value||'').trim()||stage?.now?.image||'';if(!/^https:\/\//i.test(photo))throw Error('Paste a photo link (https) for the listings, or put an item with a photo in NOW PLAYING.');
      const todo=machineCtl.items.filter(it=>it.ext&&!it.listed&&!it.sold);if(!todo.length){status.textContent='Every spot is already on Whatnot.';return;}
      const mode=host.querySelector('#vm-wn-mode').value,cat=host.querySelector('#vm-wn-cat').value;
      if(!confirm('List '+todo.length+' spots on Whatnot, in your show, as '+(mode==='auction'?'auctions':'Buy It Now')+'? These are REAL listings (not in your site inventory).'))return;
      let done=0;const errs=[];
      for(let i=0;i<todo.length;i+=10){const part=todo.slice(i,i+10);status.textContent='Listing on Whatnot: '+done+' of '+todo.length+'…';
        const res=await storeWorkerFetch('/whatnot/spots-list?store_id='+encodeURIComponent(connectedStore),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({showId,category:cat,mode,photo,spots:part.map(it=>({ext:it.ext,title:it.title,price:it.price}))})});
        const d=await res.json().catch(()=>({}));if(!res.ok||!d.ok)throw Error(d.error||'Whatnot listing failed ('+res.status+')');
        const ok=(d.results||[]).filter(r=>r.listed).map(r=>r.ext);done+=ok.length;for(const r of d.results||[])if(r.error)errs.push(r.error);
        if(ok.length)took(await api('machine',{listed:ok}));}
      status.textContent='On Whatnot: '+done+' of '+todo.length+' spots listed in your show.'+(errs.length?' Problems: '+[...new Set(errs)].slice(0,2).join(' / '):'');
    });
    // Ready-made lists fill the names.
    const pre=host.querySelector('#vm-preset');if(pre)pre.onchange=()=>run(async()=>{if(!pre.value)return;const V=await import('./vending.mjs?v='+STUDIO_V);const list=V.SPOT_PRESETS[pre.value]||[];host.querySelector('#vm-names').value=list.join('\n');host.querySelector('#vm-n').value=list.length;status.textContent=list.length+' names in -- set the price and tap MAKE THE SPOTS.';});
    // The break board by hand: the spot's number ("5" or "#5").
    const slotOf=v=>{const n=Number(String(v||'').replace(/^#/,'').trim());return Number.isInteger(n)&&n>0?n-1:-1;};
    vmb('#vm-who-go',()=>{const i=slotOf(host.querySelector('#vm-who-slot').value);if(i<0||!(machineCtl.items||[])[i])throw Error('Which spot? (its number)');return {buyer:{i,name:String(host.querySelector('#vm-who-name').value||'')}};},'Name on the board.');
    vmb('#vm-prev',{step:-1},'Previous slot is up.');vmb('#vm-next',{step:1},'Next slot is up.');vmb('#vm-sold-up',{soldUp:true},'Sold -- the next slot is up.');
    vmb('#vm-make',()=>({spots:{count:Number(host.querySelector('#vm-n').value)||0,price:Number(host.querySelector('#vm-price').value)||0,prefix:String(host.querySelector('#vm-prefix').value||'SPOT'),names:String(host.querySelector('#vm-names').value||'')},on:true}),'Spots made -- they are in the machine.');
    // TEST A BOSS ATTACK (2026-11-12): the preview only -- into the arena, the boss pulls its move.
    const ta=host.querySelector('#mana-test-attack');if(ta)ta.onclick=()=>{for(const f of host.querySelectorAll('.mana-preview iframe'))f.contentWindow?.postMessage({type:'mana-attack'},location.origin);};
  }
  setTimeout(wireJoystick,0);
  setTimeout(organize,0);
  async function api(path,body){
    if(typeof storeWorkerFetch!=='function')throw Error('Dashboard is still loading');
    // Not connected yet (a reload) or the dashboard switched stores: connect to
    // the store that's open now first, then do what was tapped (2026-11-11:
    // the remote said 'Store changed' and the buttons did nothing).
    let id=store();if(body && (!connectedStore || connectedStore!==id)){await connect();id=store();}
    const res=await storeWorkerFetch('/live-studio/'+path+'?store_id='+encodeURIComponent(id),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
    const d=await res.json();if(!res.ok||!d.ok)throw Error(d.conflict?'Settings changed in another controller. Reload before saving.':d.error||'Live Studio unavailable');
    if(store()!==id)throw Error('Store changed. Connect again.');return d;
  }
  const usd=n=>'$'+(Math.round((Number(n)||0)*100)/100).toLocaleString('en-US',{maximumFractionDigits:2});
  function paint(s){settings=s;for(const [k,v] of Object.entries(s)){const el=form.elements.namedItem(k);if(el)el.type==='checkbox'?el.checked=v:el.value=v;}paintMarqueeTemplates();if(!chestDirty)paintChestLoad(true);preview();}
  // LOAD THE CHESTS (store, 2026-11-17: "I want to load each chest with what it says and what item shows"): the list
  // is edited here and saved with the studio settings (chestLoad); each chest that opens takes the next one not used.
  let chestRows=null,chestDirty=false;
  function chestLoadSaved(){try{const v=JSON.parse(form.elements.namedItem('chestLoad')?.value||'[]');return Array.isArray(v)?v:[];}catch{return [];}}
  const chestId=()=>Date.now().toString(36).slice(-6)+Math.random().toString(36).slice(2,5);
  function paintChestLoad(fromSaved){
    const box=host.querySelector('#chest-load');if(!box)return;
    if(fromSaved||!chestRows)chestRows=chestLoadSaved().map(c=>({...c}));
    const used=new Set(stats?.dungeon?.chestLoadUsed||[]),el=(t,props={},...kids)=>{const e=document.createElement(t);Object.assign(e,props);e.append(...kids);return e;};
    // Where each unopened chest will open: they go in list order, the rest of this floor's chests first, then 3 a floor.
    const dg=stats?.dungeon||{},left=Math.max(0,3-(dg.opened||[]).length),order=chestRows.filter(c=>!used.has(c.id)).map(c=>c.id);
    const whereOf=id=>{const fx=chestRows.find(c=>c.id===id)?.f;if(fx)return' · FLOOR '+fx;const n=order.indexOf(id);if(n<0)return'';const fl=(Number(dg.floor)||1)+(n<left?0:1+Math.floor((n-left)/3));return' · FLOOR '+fl;};
    const rows=chestRows.map((c,k)=>{
      const opened=used.has(c.id),row=el('div',{className:'chest-row'+(opened?' opened':'')});
      const text=el('input',{value:c.t||'',maxLength:120,placeholder:'What it says, e.g. Free giveaway for followers -- Midnight Spider-Man #2'});text.oninput=()=>{c.t=text.value;chestDirty=true;};
      const pic=c.i?.image?el('img',{src:c.i.image,alt:'',style:'width:34px;border-radius:4px'}):el('span',{textContent:'📦'});
      const book=el('span',{textContent:c.i?.title?c.i.title+(c.i.price?' · '+usd(c.i.price):''):'no book picked (the chest just shows its words)',style:'flex:1;min-width:0'});
      const find=el('input',{placeholder:'🔎 pick its book (type a name)',style:'width:100%'}),hits=el('div',{className:'chest-hits'});
      find.oninput=()=>{const q=find.value.trim().toLowerCase();hits.replaceChildren();if(q.length<2)return;
        for(const i of inventory().filter(i=>i.status==='in_stock'&&String(i.name||'').toLowerCase().includes(q)).slice(0,6)){const it=stageItem(i),b=el('button',{type:'button',textContent:it.title+(it.price?' · '+usd(it.price):'')});b.onclick=()=>{c.i={title:it.title,image:it.image||'',price:it.price||0};chestDirty=true;paintChestLoad(false);};hits.append(b);}};
      const up=el('button',{type:'button',textContent:'↑',title:'Opens earlier'});up.onclick=()=>{if(k>0){[chestRows[k-1],chestRows[k]]=[chestRows[k],chestRows[k-1]];chestDirty=true;paintChestLoad(false);}};
      const clr=el('button',{type:'button',textContent:'no book'});clr.onclick=()=>{delete c.i;chestDirty=true;paintChestLoad(false);};
      const del=el('button',{type:'button',textContent:'✕',title:'Take this chest out'});del.onclick=()=>{chestRows.splice(k,1);chestDirty=true;paintChestLoad(false);};
      row.append(el('div',{style:'display:flex;gap:6px;align-items:center'},el('b',{textContent:'CHEST '+(k+1)+(opened?' · OPENED':whereOf(c.id))}),pic,book,up,clr,del),text,find,hits);
      return row;
    });
    const add=el('button',{type:'button',textContent:'+ ADD A CHEST'});add.onclick=()=>{if(chestRows.length>=21){status.textContent='21 loaded chests is the most (3 a floor, 7 floors).';return;}chestRows.push({id:chestId(),t:''});chestDirty=true;paintChestLoad(false);};
    const save=el('button',{type:'button',textContent:'💾 SAVE THE CHESTS',style:'font-weight:800'});save.onclick=()=>run(saveChestLoad);
    box.replaceChildren(...rows,el('div',{style:'display:flex;gap:6px;flex-wrap:wrap'},add,save));
  }
  // SAVED DUNGEON SETUPS (store, 2026-11-24): list them, LOAD one into the studio, DELETE. The setups themselves are
  // written by Claude (or saved from here later); the shape is in scripts/dungeon-setups.mjs.
  let setups=[];
  async function setupsCall(method,query,body){const res=await storeWorkerFetch('/store/dungeon-setups?store_id='+encodeURIComponent(store())+(query||''),method==='GET'?{cache:'no-store'}:{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await res.json().catch(()=>({}));if(!res.ok||!d.ok)throw Error(d.error||'Dungeon setups unavailable');return d;}
  function setupSummary(p){const fl=p.floors||[],ch=fl.reduce((n,f)=>n+(f.chests||[]).length,0);return fl.length+' floor'+(fl.length===1?'':'s')+' · '+ch+' chest'+(ch===1?'':'s')+' · '+(p.stretch||[]).length+' stretch goal'+((p.stretch||[]).length===1?'':'s');}
  function paintSetups(){
    const box=host.querySelector('#dg-setups-body');if(!box)return;
    const el=(t,props={},...kids)=>{const e=document.createElement(t);Object.assign(e,props);e.append(...kids);return e;};
    if(!setups.length){box.replaceChildren(el('small',{textContent:'No saved setups yet. Tell Claude what goes on each floor and it will save one here.'}));return;}
    box.replaceChildren(...setups.map(su=>{const p=su.plan||{};
      const head=el('div',{style:'display:flex;gap:6px;align-items:center;flex-wrap:wrap'},el('b',{textContent:su.name}),el('small',{textContent:(su.show_title?'📺 '+su.show_title+' · ':'')+setupSummary(p)}));
      const lines=el('div',{className:'dg-setup-lines',style:'font-size:11px;line-height:1.5'});
      for(const f of p.floors||[])lines.append(el('div',{textContent:'FLOOR '+f.floor+(f.boss?' · '+(BOSS_NAMES[f.boss]||f.boss.toUpperCase()):'')+(f.room?' · '+f.room.toUpperCase():'')+(f.reward?' · 🏆 '+f.reward:'')+((f.chests||[]).length?' · 🧰 '+(f.chests||[]).map((c,k)=>(k+1)+') '+c.t+(c.i?.title?' ['+c.i.title+']':'')).join('  '):'')}));
      for(const x of p.stretch||[])lines.append(el('div',{textContent:'🎯 $'+x.at+': '+x.text}));
      const load=el('button',{type:'button',textContent:'▶ LOAD INTO THE STUDIO',style:'font-weight:800'});load.onclick=()=>run(()=>loadSetup(su));
      const del=el('button',{type:'button',textContent:'✕ DELETE'});del.onclick=()=>run(async()=>{if(!confirm('Delete the setup "'+su.name+'"?'))return;await setupsCall('DELETE','&id='+encodeURIComponent(su.id));await refreshSetups();status.textContent='Setup deleted.';});
      return el('div',{className:'chest-row'},head,lines,el('div',{style:'display:flex;gap:6px;flex-wrap:wrap'},load,del));}));
  }
  async function refreshSetups(){try{setups=(await setupsCall('GET')).setups||[];}catch(e){setups=[];const b=host.querySelector('#dg-setups-body');if(b)b.textContent=e.message;return;}paintSetups();}
  async function loadSetup(su){
    const p=su.plan||{},fl=p.floors||[];
    if(!confirm('Load "'+su.name+'" into the studio? It replaces the floor rewards, stretch goals and loaded chests.'))return;
    const tag=Date.now().toString(36).slice(-4);
    const set={floorRewards:fl.filter(f=>f.reward).map(f=>f.floor+': '+f.reward).join('\n'),showUnlocks:(p.stretch||[]).map(x=>x.at+': '+x.text).join('\n'),
      chestLoad:JSON.stringify(fl.flatMap(f=>(f.chests||[]).map((c,k)=>({id:tag+'f'+f.floor+'c'+(k+1),t:c.t,f:f.floor,...(c.i?{i:c.i}:{})}))))};
    if(set.chestLoad==='[]')set.chestLoad='';
    if(typeof p.chestGoals==='string')set.chestGoals=p.chestGoals;if(Number.isInteger(p.giveawayChests))set.giveawayChests=p.giveawayChests;
    for(const [k,v] of Object.entries(set)){const e=form.elements.namedItem(k);if(e)e.value=v;}
    const d=await api('settings',{settings:values(),revision});revision=d.revision;chestDirty=false;took(d);
    const skipped=[];
    for(const f of fl){
      if(f.boss)try{took(await api('dungeon-adjust',{boss:f.boss,at:f.floor}));}catch(e){skipped.push('floor '+f.floor+' boss ('+e.message+')');}
      if(f.room)try{took(await api('dungeon-adjust',{room:f.room,at:f.floor}));}catch(e){skipped.push('floor '+f.floor+' room ('+e.message+')');}
    }
    paintChestLoad(true);setTimeout(paintPlan,0);
    status.textContent='Loaded "'+su.name+'".'+(skipped.length?' Not set: '+skipped.join('; '):'');
  }
  async function saveChestLoad(){
    const list=(chestRows||[]).map(c=>({id:c.id||chestId(),t:String(c.t||'').trim().slice(0,120),...(c.f?{f:c.f}:{}),...(c.i?{i:c.i}:{})}));
    if(list.some(c=>!c.t))throw Error('Every chest needs words -- what it says on screen (or take it out).');
    const hid=form.elements.namedItem('chestLoad'),before=hid.value;hid.value=list.length?JSON.stringify(list):'';
    try{const d=await api('settings',{settings:values(),revision});revision=d.revision;chestDirty=false;took(d);}catch(e){hid.value=before;throw e;}
    paintChestLoad(true);status.textContent=list.length?'Chests loaded: '+list.length+' -- they open in this order.':'Loaded chests cleared -- chests work as before.';
  }
  // MARQUEE TEMPLATES (store, 2026-11-15: "a couple templates and being able to save them for the marquee sign"): a few
  // ready-made messages (★), plus the store's own, saved with the studio settings so every device sees the same list.
  const MQ_BUILTIN=[
    {n:'Welcome',t:'WELCOME TO THE MANA POCKET • FOLLOW FOR FREE GIVEAWAYS • TAP THE BOOKMARK SO YOU NEVER MISS A SHOW'},
    {n:'Buy it now',t:'BUY IT NOW IN THE SHOP • COMBINED SHIPPING ALL SHOW • ASK US ABOUT ANY CARD OR COMIC'},
    {n:'New comics / FOC',t:'NEW COMICS EVERY WEEK • PREORDER BEFORE FOC SUNDAY • RATIO COVERS -- ASK IN CHAT'},
    {n:'Giveaway goal',t:'FREE GIVEAWAY FOR EVERYONE WATCHING AT THE NEXT FOLLOWER GOAL • SHARE THE SHOW TO GET US THERE'},
    {n:'Last call',t:'LAST CALL • THANK YOU FOR HANGING OUT • SEE YOU NEXT SHOW'},
  ];
  function savedMarqueeTemplates(){try{const v=JSON.parse(form.elements.namedItem('marqueeTemplates')?.value||'[]');return Array.isArray(v)?v.filter(t=>t&&t.n&&t.t):[];}catch{return [];}}
  function paintMarqueeTemplates(){const sel=host.querySelector('#mq-tpl');if(!sel)return;const keep=sel.value,mine=savedMarqueeTemplates();
    sel.replaceChildren(...MQ_BUILTIN.map((t,i)=>new Option('★ '+t.n,'b'+i)),...mine.map((t,i)=>new Option(t.n,'m'+i)));if([...sel.options].some(o=>o.value===keep))sel.value=keep;}
  const pickedMarquee=()=>{const v=host.querySelector('#mq-tpl')?.value||'',i=Number(v.slice(1));return v[0]==='b'?{t:MQ_BUILTIN[i],mine:false}:v[0]==='m'?{t:savedMarqueeTemplates()[i],i,mine:true}:null;};
  const saveSettings=async msg=>{const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);status.textContent=msg;};
  {const b=host.querySelector('#mq-use');if(b)b.onclick=()=>run(async()=>{const p=pickedMarquee();if(!p?.t)throw Error('Pick a template first.');const ta=form.elements.namedItem('message');ta.value=p.t.t;preview();await saveSettings('Marquee: '+p.t.n+' is on the sign.');});}
  {const b=host.querySelector('#mq-save');if(b)b.onclick=()=>run(async()=>{const text=String(form.elements.namedItem('message').value||'').trim();if(!text)throw Error('Type a marquee message first, then save it.');
    // (store, 2026-11-16) One of your saved templates picked: its name is filled in, so OK updates it in its place.
    const picked=pickedMarquee(),suggest=picked?.mine&&picked.t?picked.t.n:text.split(/\s*[•|]\s*/)[0].slice(0,30);
    const name=String(prompt(picked?.mine?'Save over "'+picked.t.n+'" (or type a new name for a new template)':'Name this template',suggest)||'').trim().slice(0,30);if(!name)return;
    const mine=savedMarqueeTemplates(),at=mine.findIndex(t=>t.n.toLowerCase()===name.toLowerCase());
    if(at<0&&mine.length>=12)throw Error('12 saved templates is the most -- delete one first.');
    if(at>=0)mine[at]={n:name,t:text.slice(0,300)};else mine.push({n:name,t:text.slice(0,300)});
    const hid=form.elements.namedItem('marqueeTemplates'),before=hid.value;hid.value=JSON.stringify(mine);
    try{await saveSettings((at>=0?'Template updated: ':'Template saved: ')+name);}catch(e){hid.value=before;throw e;}paintMarqueeTemplates();host.querySelector('#mq-tpl').value='m'+(at>=0?at:mine.length-1);});}
  {const b=host.querySelector('#mq-del');if(b)b.onclick=()=>run(async()=>{const p=pickedMarquee();if(!p?.mine)throw Error('The ★ templates are built in -- pick one of your saved ones to delete.');if(!confirm('Delete the template "'+p.t.n+'"?'))return;
    const mine=savedMarqueeTemplates();mine.splice(p.i,1);const hid=form.elements.namedItem('marqueeTemplates'),before=hid.value;hid.value=mine.length?JSON.stringify(mine):'';
    try{await saveSettings('Template deleted: '+p.t.n);}catch(e){hid.value=before;throw e;}paintMarqueeTemplates();});}
  // THE DUNGEON PLAN (store, 2026-11-22: "make it easier to see what is set up in each chest and floor, so we can change
  // them ... and the thing that says pack forge"): one card a floor -- boss, room, reward, and each chest's $ and contents.
  let dgLib=null;import('./live-studio-dungeon.mjs?v='+STUDIO_V).then(m=>{dgLib=m;paintPlan();}).catch(()=>{});
  function planChestWords(plan){
    // Which loaded chest lands where: in list order, this floor's unopened chests first, then 3 a floor (as they open).
    const used=new Set(stats?.dungeon?.chestLoadUsed||[]),load=chestLoadSaved().filter(c=>!used.has(c.id)),give=Number(settings?.giveawayChests??2)||0;let n=0;
    // A chest set for a floor (from a saved setup) goes on that floor; the rest fill in, in order.
    const taken=new Set(),free=load.filter(c=>!c.f);
    return plan.map(p=>[0,1,2].map(k=>{if(p.opened.includes(k))return {open:true};const own=load.find(c=>c.f===p.floor&&!taken.has(c.id)),c=own||free[n++];if(c)taken.add(c.id);return {what:c?c.t+(c.i?.title?' ('+c.i.title+')':''):k<give?'FREE GIVEAWAY':'the next book up (NEXT UP)',loaded:!!c};}));
  }
  function paintPlan(){
    const box=host.querySelector('#dg-plan-body'),plan=stats?.dungeon?.plan;if(!box||!dgLib)return;
    if(!plan?.length){box.innerHTML='<small>Tap CONNECT to see the plan.</small>';return;}
    if(box.contains(document.activeElement))return;
    const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    const words=planChestWords(plan),rooms=dgLib.ROOMS||[],bosses=dgLib.BOSS_PICKS||[];
    box.innerHTML=plan.map((p,i)=>{
      const roomName=id=>{const r=rooms.find(x=>x.id===id);return r?r.icon+' '+r.name:'';};
      const roomOpts='<option value="">'+(p.doors.length?'Chat picks: '+p.doors.map(roomName).join(' or '):'Chat picks at the doors')+'</option>'+rooms.map(r=>'<option value="'+r.id+'"'+(p.room===r.id?' selected':'')+'>'+esc(r.icon+' '+r.name+' -- '+r.blurb)+'</option>').join('');
      const bossOpts='<option value="">Auto: '+esc(p.boss.picked?'the set order':p.boss.name)+'</option>'+bosses.map(b=>'<option value="'+b.id+'"'+(p.boss.picked===b.id?' selected':'')+'>'+esc(b.name)+'</option>').join('');
      const chests=words[i].map((w,k)=>'<div class="dg-chest'+(w.open?' open':'')+'"><b>CHEST '+(k+1)+' · $'+p.chestAt[k]+'</b> '+(w.open?'✓ OPENED':esc(w.what)+(w.loaded?'':' <i>(not loaded)</i>'))+'</div>').join('');
      return '<div class="dg-floor"><div class="dg-head"><b>FLOOR '+p.floor+(i===0?' (NOW)':'')+'</b> · '+esc(p.shed)+' · $'+p.goal+' to clear</div>'
        +'<div class="mana-row"><label>BOSS<select data-plan-boss="'+p.floor+'"'+(i===0&&stats?.dungeon?.boss?.active?' disabled':'')+'>'+bossOpts+'</select></label><label>ROOM<select data-plan-room="'+p.floor+'">'+roomOpts+'</select></label></div>'
        +'<div class="mana-row"><label style="flex:1">REWARD<input data-plan-reward="'+p.floor+'" maxlength="120" value="'+esc(p.reward)+'" placeholder="What clearing this floor wins"></label></div>'+chests+'</div>';
    }).join('')+'<div class="mana-row"><button type="button" id="dg-plan-edit">✏ EDIT CHESTS</button></div>';
    box.querySelectorAll('[data-plan-boss]').forEach(s=>s.onchange=()=>run(async()=>{const d=await api('dungeon-adjust',{boss:s.value,at:Number(s.dataset.planBoss)});took(d);status.textContent='Floor '+s.dataset.planBoss+' boss: '+(s.value?s.options[s.selectedIndex].text:'the set order')+'.';}));
    box.querySelectorAll('[data-plan-room]').forEach(s=>s.onchange=()=>run(async()=>{const d=await api('dungeon-adjust',{room:s.value,at:Number(s.dataset.planRoom)});took(d);status.textContent='Floor '+s.dataset.planRoom+' room: '+(s.value?s.options[s.selectedIndex].text.split(' -- ')[0]:'chat picks at the doors')+'.';}));
    box.querySelectorAll('[data-plan-reward]').forEach(inp=>inp.onchange=()=>run(async()=>{const f=Number(inp.dataset.planReward),el=form.elements.namedItem('floorRewards');
      const lines=String(el?.value||'').split('\n').filter(l=>l.trim()&&!new RegExp('^\\s*'+f+'\\s*:').test(l));const v=inp.value.trim();if(v)lines.push(f+': '+v);
      lines.sort((a,b)=>parseInt(a,10)-parseInt(b,10));if(el)el.value=lines.join('\n');const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);status.textContent='Floor '+f+' reward '+(v?'saved.':'cleared (the room\'s reward, if any).');}));
    const ed=box.querySelector('#dg-plan-edit');if(ed)ed.onclick=()=>{const c=host.querySelector('#chest-load');const det=c?.closest('details');if(det)det.open=true;c?.scrollIntoView({behavior:'smooth',block:'start'});};
  }
  function took(d){setTimeout(paintPlan,0);if(d.chestLoaded)status.textContent='Chest opened: '+d.chestLoaded+' -- run it in Whatnot.';if(d.stats&&!chestDirty&&!host.querySelector('#chest-load')?.contains(document.activeElement))setTimeout(()=>paintChestLoad(false),0);if(d.chestGiveaway)status.textContent='Chest opened: FREE GIVEAWAY! Start a giveaway in the Whatnot app (free for everyone watching).';if(d.chestItem)status.textContent='Chest opened: '+d.chestItem.title+' is NOW PLAYING'+(d.chestWhatnot?.added?' and in your Whatnot show as a $1 start -- tap start in the app.':d.chestWhatnot?.error?' (Whatnot: '+d.chestWhatnot.error+')':'.');if(Array.isArray(d.pics))shedPicsCtl=d.pics;if(d.settings)paint(d.settings);if(d.stats){stats=d.stats;host.querySelector('#mana-score').textContent=usd(stats.gross)+' · '+stats.sold+' sold · biggest '+usd(stats.biggest)+(stats.boss&&!stats.dungeon?.on?' · boss '+(stats.boss.defeated?'DEFEATED':'HP '+usd(stats.boss.hp)):'');paintDungeon();}if(d.stage){stage=d.stage;paintStage();}if(d.machine){machineCtl=d.machine;paintMachine();}preview();readyList();paintGame();paintMoves();drawFace('#beast-face-view','beastsFace');drawFace('#beast-buddy-view','beastsBuddy');}
  // The dungeon's status line: floor, mana, stars, the week's reset.
  function paintDungeon(){
    {const bp=host.querySelector('#mana-boss-pick');if(bp&&document.activeElement!==bp&&bp.options.length>1){bp.value=stats?.dungeon?.boss?.picked||'';bp.disabled=!!stats?.dungeon?.boss?.active;}}
    const d=stats?.dungeon,el=host.querySelector('#mana-dungeon-status'),pick=host.querySelector('#mana-doors-pick');pick.replaceChildren();
    // An open chat vote: one button per choice, and CLOSE.
    const vp=host.querySelector('#mana-vote-pick');vp.replaceChildren();
    if(stats?.vote){stats.vote.options.forEach((o,i)=>{const b=document.createElement('button');b.type='button';b.textContent=(stats.vote.kind==='trivia'?'':(i+1)+' → ')+o.label;b.onclick=()=>run(async()=>{const who=host.querySelector('#mana-trivia-who')?.value.trim()||'';const x=await api('vote-pick',{index:i,who});if(who)host.querySelector('#mana-trivia-who').value='';took(x);if(x.effect)preview(x.effect);status.textContent='Chat picked '+o.label+'.';});vp.append(b);});
      const c=document.createElement('button');c.type='button';c.textContent='CLOSE VOTE';c.onclick=()=>run(async()=>{took(await api('vote-close',{}));});vp.append(c);}
    host.querySelector('.mana-trivia-who').hidden=stats?.vote?.kind!=='trivia';
    host.querySelector('.mana-remote').classList.toggle('voting',!!(stats?.vote||d?.doors));
    const bs=stats?.beasts,bst=host.querySelector('#beast-status');
    const beastLine=bs?(bs.form||'')+' LV '+(bs.level||1)+(bs.toEvo?' ('+usd(bs.toEvo)+' to evolve)':'')+' · Route '+bs.route+' · '+(bs.stage==='rival'?bs.rival.name+'\'s '+bs.rival.beast+' HP '+usd(bs.rival.hp)+' / '+usd(bs.rival.max):usd(bs.xp)+' / '+usd(bs.goal)+' to '+bs.rival.name)+' · badges '+bs.badges+' · beasts beaten '+bs.caughtCount:'Connect to see the route.';
    if(bst)bst.textContent=beastLine;
    if(values().gameMode==='beasts'){el.textContent=beastLine;return;}
    if(!d){el.textContent='Connect to see the floor.';return;}
    // Chat's vote: one button per door.
    if(d.doors)d.doors.forEach((r,i)=>{const b=document.createElement('button');b.type='button';b.textContent=(i+1)+' → '+r.icon+' '+r.name;
      b.onclick=()=>run(async()=>{const x=await api('dungeon-adjust',{door:i});took(x);if(x.effect)preview(x.effect);status.textContent='Chat picked '+r.name+'.';});pick.append(b);});
    el.textContent=(d.on?'':'(off) ')+'Floor '+d.floor+' · '+d.shed+(d.room?' · '+d.room.name:'')+' · '+(d.phase==='boss'?d.boss.name+' HP '+usd(d.boss.hp)+' / '+usd(d.boss.max):usd(d.mana)+' / '+usd(d.goal)+' mana')+' · ★ '+d.stars+' · relics '+(d.relics?.length||0)+(d.doors?' · DOOR VOTE OPEN':'')+(d.finale?' · FINALE':'')+' · resets Wed '+d.resets+(d.lastWeek?' · last week: floor '+d.lastWeek.floor+', ★ '+d.lastWeek.stars:'');
  }
  function values(){const out={};for(const el of form.elements){if(!el.name)continue;out[el.name]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;}return out;}
  // The green-screen shed sits behind the top camera in the preview too (2026-11-11).
  function preview(effect,demoStats){const msg={type:'mana-preview',settings:values(),stage,pics:shedPicsCtl,stats:withMove(demoStats||(Date.now()<demoUntil?demoFake:null)||stats||undefined),machine:values().showBuyerNames?machineCtl:{...machineCtl,items:(machineCtl.items||[]).map(({buyer,...it})=>it)},flip:flipCtl,effect};frame.contentWindow?.postMessage(msg,location.origin);host.querySelector('.mana-preview-bg')?.contentWindow?.postMessage(msg,location.origin);}
  async function run(fn){try{await fn();}catch(e){status.textContent=e.message;}}
  async function connect(){const d=await api('state');connectedStore=store();revision=d.revision;took(d);status.textContent='Connected. Controls are live.';refreshSetups();sendShedPics(d.pics).catch(()=>{}).then(readyList);loadFacts();return d;}
  host.querySelector('#mana-load').onclick=()=>run(connect);
  // Connect on its own once the dashboard is signed in.
  (function autoConnect(tries){if(connectedStore)return;if(!studioOnScreen()){setTimeout(()=>autoConnect(tries),3000);return;} // waits until you open the Whatnot tab
    if(typeof storeWorkerFetch==='function'&&store()){connect().catch(()=>{if(tries<5)setTimeout(()=>autoConnect(tries+1),4000);});}else if(tries<20)setTimeout(()=>autoConnect(tries+1),1500);})(0);
  // What ByteRider knows on the website (Worker: /byterider/facts).
  const factsBox=host.querySelector('#mana-br-facts'),factsStatus=host.querySelector('#mana-br-facts-status');
  async function factsCall(body){const res=await storeWorkerFetch('/byterider/facts?store_id='+encodeURIComponent(store()),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});const d=await res.json().catch(()=>({}));if(!res.ok||!d.ok)throw Error(d.error||'Could not reach ByteRider');return d;}
  async function loadFacts(){try{const d=await factsCall();factsBox.value=d.facts||'';const sp=d.spend;factsStatus.textContent=sp?('This month: $'+Number(sp.usd||0).toFixed(2)+' of $'+Number(sp.capUsd||0).toFixed(2)+' cap, '+(sp.answers||0)+' answers'+(Object.keys(sp.models||{}).length?' ('+Object.entries(sp.models).map(([m,n])=>m.replace(/^claude-/,'').replace(/-\d{8}$/,'')+': '+n).join(', ')+')':'')):'';}catch(e){factsStatus.textContent=e.message;}}
  host.querySelector('#mana-br-facts-save').onclick=()=>run(async()=>{const d=await factsCall({facts:factsBox.value});factsBox.value=d.facts;factsStatus.textContent='Saved -- he knows it now.';});
  host.querySelector('#mana-br-facts-reset').onclick=()=>run(async()=>{if(!confirm('Put back the default facts?'))return;const d=await factsCall({facts:''});factsBox.value=d.facts;factsStatus.textContent='Back to the defaults.';});
  // Quick switches (store: "I might not want the marquee sign to show
  // sometimes"): flip the setting and save it live in one tap.
  host.querySelector('#mana-quick').onclick=e=>{const b=e.target.closest('[data-toggle]');if(!b)return;
    const box=form.elements.namedItem(b.dataset.toggle);box.checked=!box.checked;
    void run(async()=>{try{const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);status.textContent=({visible:'Sign ',marqueeOn:'Marquee text ',finale:'Finale '}[b.dataset.toggle]||'')+(box.checked?'on':'off');}catch(err){box.checked=!box.checked;throw err;}});};
  form.onsubmit=e=>{e.preventDefault();void run(async()=>{const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);status.textContent='Live settings saved.';});};
  form.oninput=e=>{
    // Picking a boss gives it its name, unless the store typed its own.
    if(e.target.name==='bossCharacter'){const nm=form.elements.namedItem('bossName');if(!nm.value||Object.values(BOSS_NAMES).includes(nm.value))nm.value=BOSS_NAMES[e.target.value]||nm.value;}
    preview();};
  // Dungeon taps and fixes.
  host.querySelector('#mana-taps').onclick=e=>{const b=e.target.closest('[data-tap]');if(!b)return;const kind=b.dataset.tap;
    if(!connectedStore){const now=Date.now(),v=values();preview({id:'local-'+now,kind:'tap',tapKind:kind,mana:v[{follow:'manaFollow',share:'manaShare',bookmark:'manaBookmark'}[kind]]||0,startsAt:now,endsAt:now+2500});status.textContent='Preview only. Tap Connect / reload to fill the real flask.';return;}
    void run(async()=>{const d=await api('dungeon-tap',{kind});took(d);preview(d.effect);status.textContent='+ '+kind;});};
  host.querySelector('#mana-add-mana-go').onclick=()=>run(async()=>{const v=Number(host.querySelector('#mana-add-mana').value);if(!(v>0))throw Error('Type the $ amount first');const d=await api('dungeon-adjust',{mana:v});took(d);if(d.effect)preview(d.effect);host.querySelector('#mana-add-mana').value='';status.textContent='Added '+usd(v)+' mana.';});
  host.querySelector('#mana-set-floor-go').onclick=()=>run(async()=>{const f=Number(host.querySelector('#mana-set-floor').value);if(!Number.isInteger(f)||f<1)throw Error('Type a floor number');const bm=values().gameMode==='beasts',w=bm?'route':'floor';if(!confirm('Jump to '+w+' '+f+'? It starts at $0.'))return;const d=await api('dungeon-adjust',{floor:f});took(d);status.textContent='Now on '+w+' '+f+'.';});
  // The show remote's big buttons press the real ones (in ALL SETTINGS); its
  // status line mirrors the floor and score.
  host.querySelector('.mana-remote').onclick=e=>{const b=e.target.closest('[data-click]');if(!b)return;const el=host.querySelector(b.dataset.click);if(el?.tagName==='SECTION'||el?.tagName==='DETAILS'){el.scrollIntoView({behavior:'smooth',block:'start'});const d=el.tagName==='DETAILS'?el:el.querySelector('details');if(d)d.open=true;}else el?.click();};
  new MutationObserver(()=>{const m=host.querySelector('#mana-remote-msg');if(m)m.textContent=status.textContent;}).observe(status,{childList:true,characterData:true,subtree:true});
  // While connected, pick up what happened on stream (doors opening, chests,
  // the floor) every 8 seconds, so the winner buttons are always current.
  setInterval(()=>{if(!connectedStore||!studioOnScreen()||connectedStore!==store())return;api('state').then(d=>{if(form.contains(document.activeElement)||d.revision===revision)took({stats:d.stats,stage:d.stage});else{revision=d.revision;took(d);}}).catch(()=>{});},8000);
  // THE LIVE DUNGEON CARD (store, 2026-11-24: "a good way to know ... what's in each chest and what each goal is and how
  // far we're going to the goal ... in real time with my phone ... and up on the computer screen"): the floor, the bar to
  // its goal with the chests on it, the next chest and the $ to it (or the boss's HP), one tap to the whole plan.
  function paintLive(){
    const box=host.querySelector('#dg-live'),d=stats?.dungeon;if(!box)return;
    if(!connectedStore||!d||!d.on||settings?.gameMode==='beasts'||settings?.gameMode==='vending'){box.hidden=true;return;}
    box.hidden=false;const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    const boss=d.phase==='boss',goal=Number(d.goal)||0,mana=Math.min(goal,Number(d.mana)||0),pct=goal?Math.round(mana/goal*100):0,opened=d.opened||[];
    const plan0=(d.plan||[])[0]||{},marks=(plan0.chestAt||[]).map((at,k)=>'<i class="dg-mark'+(opened.includes(k)?' open':'')+'" style="left:'+(goal?Math.min(100,at/goal*100):0)+'%" title="Chest '+(k+1)+' at $'+at+'">'+(opened.includes(k)?'✓':'🧰')+'</i>').join('');
    const next=d.nextChest,nextLine=next&&!boss?'🧰 NEXT CHEST: <b>'+esc(next.what)+'</b> · '+(next.need>0?'<b class="dg-need">$'+next.need+' to go</b>':'<b class="dg-need">opens now</b>'):opened.length>=3?'🧰 All 3 chests open on this floor':'';
    const hp=boss?Math.max(0,Number(d.boss?.hp)||0):0,max=Number(d.boss?.max)||1;
    box.innerHTML='<div class="dg-live-head"><b>FLOOR '+esc(d.floor)+' · '+esc(d.shed)+'</b><span>'+(boss?'⚔ BOSS OUT: ':'Boss: ')+esc(d.boss?.name||'')+'</span></div>'
      +(boss?'<div class="dg-bar boss"><i style="width:'+Math.round(hp/max*100)+'%"></i></div><div class="dg-live-nums"><b>BOSS HP $'+hp+' / $'+max+'</b><span>every sale hits it</span></div>'
        :'<div class="dg-bar"><i style="width:'+pct+'%"></i>'+marks+'</div><div class="dg-live-nums"><b>$'+mana+' / $'+goal+'</b><span>'+pct+'% to the boss</span></div>')
      +(nextLine?'<div class="dg-live-next">'+nextLine+'</div>':'')
      +'<div class="mana-row"><button type="button" data-click="#dg-plan">🗺 FLOOR PLAN &amp; CHESTS</button></div>';
  }
  setInterval(()=>{if(studioOnScreen())paintLive();},1000);
  setInterval(()=>{if(!studioOnScreen())return;const f=host.querySelector('#mana-remote-floor'),sc=host.querySelector('#mana-remote-score');if(!f)return;const d=host.querySelector('#mana-dungeon-status')?.textContent||'';f.textContent=connectedStore?d:'Tap CONNECT to start';sc.textContent=connectedStore?host.querySelector('#mana-score')?.textContent||'':'';},1000);
  try{const all=host.querySelector('#mana-all');all.open=localStorage.getItem('mana-all-open')==='1';all.ontoggle=()=>{try{localStorage.setItem('mana-all-open',all.open?'1':'0');}catch(_){}};}catch(_){}
  host.querySelector('#mana-trivia').onclick=()=>run(async()=>{const q=host.querySelector('#mana-trivia-q').value.trim(),a=host.querySelector('#mana-trivia-a').value.trim();if(q&&!a)throw Error('Type the answer too');const x=await api('trivia',{question:q,answer:a});took(x);host.querySelector('#mana-trivia-q').value='';host.querySelector('#mana-trivia-a').value='';status.textContent='Trivia is on screen'+(x.stats?.vote?.question?': '+x.stats.vote.question:'')+(x.triviaAnswer?' (answer: '+x.triviaAnswer+')':'')+'. Tap CHAT GOT IT when someone does.';});
  host.querySelector('#mana-floor-name-go').onclick=()=>run(async()=>{const n=host.querySelector('#mana-floor-name').value.trim();const x=await api('floor-name',{name:n});took(x);status.textContent=n?'Floor named "'+n.toUpperCase()+'".':'Floor name cleared.';});
  host.querySelector('#mana-vote-open').onclick=e=>{const b=e.target.closest('[data-vote]');if(b)run(async()=>{const x=await api('vote-open',{kind:b.dataset.vote});took(x);status.textContent='Vote is on screen. Tap the winner below.';});};
  // THE HOST PICKS THE BOSS (2026-11-17): who comes out on this floor, and SUMMON NOW.
  const bossPick=host.querySelector('#mana-boss-pick');
  import('./live-studio-dungeon.mjs?v='+STUDIO_V).then(m=>{if(!bossPick||!m.BOSS_PICKS)return;bossPick.append(...m.BOSS_PICKS.map(b=>new Option(b.name,b.id)));bossPick.value=stats?.dungeon?.boss?.picked||'';}).catch(()=>{});
  if(bossPick)bossPick.onchange=()=>run(async()=>{const d=await api('dungeon-adjust',{boss:bossPick.value});took(d);status.textContent=bossPick.value?'This floor\'s boss: '+bossPick.options[bossPick.selectedIndex].text+'.':'This floor\'s boss: the set order.';});
  host.querySelector('#mana-summon').onclick=()=>run(async()=>{if(!confirm('Summon the boss now? The flask fills and the boss comes out.'))return;const d=await api('dungeon-adjust',{summon:true});took(d);status.textContent='The boss is out!';});
  host.querySelector('#mana-reset-week').onclick=()=>run(async()=>{const bm=values().gameMode==='beasts';if(!confirm(bm?'Start Long Box Beasts over at route 1 (no badges, no beasts beaten)? The dungeon is not touched.':'Start the week over at floor 1 with no stars? Long Box Beasts is not touched.'))return;const d=await api('dungeon-adjust',{resetWeek:true});took(d);status.textContent=bm?'Beasts reset: route 1.':'Week reset: floor 1.';});
  // SHARE A SCREEN: this computer's window or tab, straight to the overlay (WebRTC); only the handshake goes through the studio.
  let scrPc=null,scrStream=null,scrId='';
  const scrLook=()=>({layout:host.querySelector('#scr-layout').value,title:host.querySelector('#scr-title').value||'FOC ORDERS -- FOLLOW ALONG'});
  async function stopScreen(tell){scrStream?.getTracks().forEach(t=>t.stop());try{scrPc?.close();}catch{}scrPc=scrStream=null;const was=scrId;scrId='';if(tell&&was)await api('screen',{stop:true});}
  // currentTab: share this very tab (the FOC wall's SHOW MODE asks for it), the browser offering it first.
  async function shareScreen(look,currentTab){
    if(!navigator.mediaDevices?.getDisplayMedia||typeof RTCPeerConnection!=='function')throw Error('This browser can\'t share a screen -- use Chrome or Edge on a computer.');
    if(!connectedStore)await connect();
    await stopScreen(false);
    const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:15,max:30}},audio:false,...(currentTab?{preferCurrentTab:true,selfBrowserSurface:'include'}:{})});
    const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]});scrPc=pc;scrStream=stream;
    for(const t of stream.getTracks())pc.addTrack(t,stream);
    stream.getVideoTracks()[0].onended=()=>{if(scrPc===pc)void run(async()=>{await stopScreen(true);status.textContent='Screen share stopped.';});};
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise(res=>{if(pc.iceGatheringState==='complete')return res();const t=setTimeout(res,2500);pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete'){clearTimeout(t);res();}});});
    const d=await api('screen',{offer:pc.localDescription.sdp,...look});scrId=d.id;status.textContent='Waiting for the overlay in OBS...';
    for(let k=0;k<40;k++){await new Promise(r=>setTimeout(r,750));if(scrId!==d.id)return;const r=await api('screen',{poll:d.id});if(r.answer){await pc.setRemoteDescription({type:'answer',sdp:r.answer});status.textContent='📺 Sharing -- it\'s on the overlay. STOP SHARING (or the browser\'s Stop) ends it.';return;}}
    await stopScreen(true);throw Error('The overlay didn\'t answer. Is the overlay open in OBS and connected? Try again.');
  }
  host.querySelector('#scr-go').onclick=()=>run(()=>shareScreen(scrLook(),false));
  window.manaStudioShareScreen=(o={})=>shareScreen({layout:['corner','half','full'].includes(o.layout)?o.layout:'full',title:String(o.title||'FOLLOW ALONG').slice(0,40)},!!o.currentTab);
  host.querySelector('#scr-stop').onclick=()=>run(async()=>{await stopScreen(false);await api('screen',{stop:true});status.textContent='Screen share stopped.';});
  for(const id of ['#scr-layout','#scr-title'])host.querySelector(id).onchange=()=>{if(scrId)void run(()=>api('screen',scrLook()));};
  host.querySelector('#mana-effects').onclick=e=>{const kind=e.target.dataset.effect;if(kind)void run(async()=>{const d=await api('effect',{kind});preview(d.effect);status.textContent='Sent '+e.target.textContent;});};
  // ByteRider_97: a reaction or a line, on stream (and in the preview).
  // Store, 2026-11-02 (on a phone): "I didn't see it animate in the preview."
  // Before Connect he still plays in the preview, and says so here, right
  // under the buttons (the main status line is far up the page).
  const brStatus=host.querySelector('#mana-br-status');
  const mascotSend=(state,text)=>{
    if(!connectedStore){const now=Date.now();preview({id:'local-'+now+'-'+Math.random().toString(36).slice(2),kind:'mascot',mascotState:state,...(text?{say:text.slice(0,120)}:{}),startsAt:now,endsAt:now+4000});
      brStatus.textContent='Preview only ('+(text||state)+'). Tap Connect / reload at the top to send him to the stream.';return;}
    return run(async()=>{try{const d=await api('effect',{kind:'mascot',state,text});preview(d.effect);status.textContent=brStatus.textContent='ByteRider: '+(text||state)+' (live)';}catch(e){brStatus.textContent=e.message;throw e;}});
  };
  // PIN PREVIEW: docks the preview in the corner so you can tap and watch
  // at the same time on a phone.
  const pin=host.querySelector('#mana-pin'),previewBox=host.querySelector('.mana-preview');
  pin.onclick=()=>{const on=previewBox.classList.toggle('pinned');pin.textContent=on?'📌 UNPIN PREVIEW':'📌 PIN PREVIEW';};
  host.querySelector('#mana-mascot').onclick=e=>{const b=e.target.closest('[data-mascot]');if(b)mascotSend(b.dataset.mascot,b.dataset.say||'');};
  host.querySelector('#mana-say-go').onclick=()=>{const t=host.querySelector('#mana-say').value.trim();if(t)mascotSend('talking',t);};
  // Keyboard shortcuts (this device only): a key fires the button that shows it;
  // S jumps to the SAY box. Never while typing in a box.
  const dashBr=host.querySelector('#mana-dash-br');
  try{dashBr.checked=localStorage.getItem('byterider-dash-hidden')!=='1';}catch{}
  dashBr.onchange=()=>{if(typeof showDashByteRider==='function')showDashByteRider(dashBr.checked);};
  const keys=host.querySelector('#mana-keys');
  try{keys.checked=localStorage.getItem('mana-keys')==='1';}catch{}
  keys.onchange=()=>{try{localStorage.setItem('mana-keys',keys.checked?'1':'0');}catch{}};
  document.addEventListener('keydown',e=>{
    // Only on the Whatnot tab (store: "only on Whatnot tab").
    if(typeof activeTab!=='undefined'&&activeTab!=='whatnot')return;
    if(!keys.checked||e.ctrlKey||e.metaKey||e.altKey||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName||'')||e.target?.isContentEditable)return;
    const k=e.key.length===1?e.key.toUpperCase():'';
    if(k==='S'){e.preventDefault();host.querySelector('#mana-say').focus();return;}
    const b=host.querySelector(`#mana-mascot [data-key="${k}"],#mana-quick [data-key="${k}"],#mana-taps [data-key="${k}"]`);
    if(b){e.preventDefault();b.click();}
  });
  host.querySelector('#mana-show').onclick=()=>run(async()=>{const d=await api('current-show');if(!d.show)throw Error('No live or scheduled Whatnot show found');form.elements.namedItem('showId').value=d.show.id;host.querySelector('#mana-show-name').textContent=(d.show.live?'LIVE: ':'NEXT: ')+(d.show.title||d.show.id);preview();
    // 2026-11-18: picking the show used to need a second tap (Save) -- missed, the dungeon kept the old show and ignored the sales. One tap now.
    const s=await api('settings',{settings:values(),revision});revision=s.revision;took(s);status.textContent='Following this show -- its sales fill the dungeon.';});
  host.querySelector('#mana-sync').onclick=()=>run(async()=>{const d=await api('stats-sync',{});took(d);status.textContent='Totals synced from Whatnot.'+(d.filled>0?' +'+usd(d.filled)+' of missed sales went into the dungeon.':' The dungeon already had every sale.');});
  // AUTO SYNC (2026-11-19: live sales weren't reaching the dungeon): while this remote is connected and following a
  // show, it checks Whatnot's order list once a minute, so a sale Whatnot never told us about still counts.
  setInterval(()=>{if(!connectedStore||connectedStore!==store()||document.hidden||!settings?.automatic||!/^[0-9a-f-]{36}$/i.test(String(settings?.showId||'')))return;
    api('stats-sync',{}).then(d=>{took(d);if(d.filled>0)status.textContent='Auto sync: +'+usd(d.filled)+' of sales went into the dungeon.';}).catch(()=>{});},60000);
  host.querySelector('#mana-reset').onclick=()=>run(async()=>{if(!confirm('Reset the score board and boss to zero?'))return;const d=await api('stats-reset',{});took(d);status.textContent='Totals reset.';});

  // Now playing: picked from the dashboard's inventory.
  function inventory(){try{return typeof all!=='undefined'&&Array.isArray(all)?all:[];}catch{return [];}}
  const https=u=>/^https:\/\//.test(String(u||''))?String(u):'';
  function stageItem(i){
    const price=Number(i.market||i.marketPrice||i.salePrice||0)||0;
    const detail=[i.set,i.variant,i.grader&&i.grade?i.grader+' '+i.grade:'',i.condition].filter(Boolean).join(' · ');
    // What it is, for how the shed shows it: comics lean in the hall, sealed sits on a table, cards stand in top loaders.
    const what=String(i.category||'')+' '+String(i.name||''),kind=/comic/i.test(String(i.category||''))?'comic':(i.isSealed===true||/sealed|booster|box|bundle|\betb\b|tin|blister|collection|pack/i.test(what))?'sealed':'card';
    return {title:String(i.name||'').slice(0,90),detail:detail.slice(0,90),image:https(i.thumbnail)||https(i.imageUrl)||https(i.photoDataUrl),price,kind,...(i.source==='built_in'&&/^[0-9a-f-]{36}$/i.test(String(i.id||''))?{id:i.id}:{})};
  }
  function paintStage(){
    const el=host.querySelector('#mana-stage');el.replaceChildren();
    const row=(label,item,idx)=>{const d=document.createElement('div');d.className='mana-stage-row';const b=document.createElement('b');b.textContent=label;const t=document.createElement('span');t.textContent=item.title+(item.price?' · '+usd(item.price):'');d.append(b,t);
      if(idx!=null){const x=document.createElement('button');x.type='button';x.textContent='✕';x.onclick=()=>run(()=>saveStage({now:stage.now,next:stage.next.filter((_,j)=>j!==idx)}));d.append(x);}return d;};
    if(stage.now)el.append(row('NOW',stage.now));
    (stage.next||[]).forEach((n,i)=>el.append(row('NEXT '+(i+1),n,i)));
  }
  // The shed's walls show the store's own in-stock items: the most valuable
  // ones with photos, a different set each day; sent when you connect.
  let chanceFn=()=>''; // Whatnot's rules: nothing that reads as a game of chance on screen
  async function sendShedPics(current){
    const day=Math.floor(Date.now()/86400000);
    // Comics, cards, sealed, collectibles -- every category takes turns (2026-11-11:
    // "we need comics and stuff too"); supplies stay out of the shed.
    const groups=new Map();
    const comicsOnly=values().dungeonComics!==false;
    for(const i of inventory()){if(i.status!=='in_stock'||!(https(i.thumbnail)||https(i.imageUrl)))continue;const cat=String(i.category||'Other');if(/suppl|bcw|accessor/i.test(cat+' '+(i.vendor||'')))continue;if(comicsOnly&&!/comic/i.test(cat))continue;const it=stageItem(i);if(!it.image||!it.title||chanceFn(it.title+' '+it.detail))continue;if(!groups.has(cat))groups.set(cat,[]);groups.get(cat).push(it);}
    const lists=[...groups.values()].map(l=>l.sort((a,b)=>(b.price||0)-(a.price||0)).slice(0,30));
    if(!lists.length)return;
    const pick=[];for(let k=0;pick.length<24&&k<24*lists.length;k++){const l=lists[k%lists.length],n=Math.floor(k/lists.length);if(n<l.length)pick.push(l[(day*7+n)%l.length]);} // each in turn, starting somewhere new each day (no repeats)
    // MR FISTER's gauntlet (2026-11-14: "comics from our inventory embedded in it like the power stones. Ratios mostly.
    // Fall back to foils"): up to 5 covers tagged ratio (an incentive / 1:N variant) or foil, the priciest first.
    const isRatio=i=>i.isIncentive===true||/\b1\s*:\s*\d+|\bratio\b|\bincentive\b/i.test([i.name,i.variant,i.set].join(' ')),isFoil=i=>/\bfoil\b/i.test([i.name,i.variant].join(' '));
    const comicsIn=inventory().filter(i=>i.status==='in_stock'&&/comic/i.test(String(i.category||''))&&(https(i.thumbnail)||https(i.imageUrl))).sort((a,b)=>(Number(b.market||b.marketPrice||0))-(Number(a.market||a.marketPrice||0)));
    const glove=[...comicsIn.filter(isRatio).map(i=>({...stageItem(i),tag:'ratio'})),...comicsIn.filter(i=>!isRatio(i)&&isFoil(i)).map(i=>({...stageItem(i),tag:'foil'}))].filter(it=>it.image&&!chanceFn(it.title+' '+it.detail)).slice(0,5);
    pick.splice(Math.max(0,24-glove.length),glove.length,...glove);
    const uniq=[...new Map(pick.map(p=>[p.image,p])).values()];
    if(JSON.stringify((current||[]).map(p=>p.image))===JSON.stringify(uniq.map(p=>p.image)))return;
    took(await api('pics',{pics:uniq}));
  }
  // SHOW READY (2026-11-12: "polish this up so I'm show ready -- pre load the
  // dungeon rewards and items based on what I have in stock. Keep it comics").
  const SPECIAL=/\b1\s*:\s*\d+|\bratio\b|incentive|glow|foil|holo|virgin|signed|autograph|sketch|1st app|first app|variant|\bcgc\b|\bcbcs\b/i;
  const short=t=>String(t||'').replace(/\s+/g,' ').trim().slice(0,58);
  function stockComics(){return inventory().filter(i=>i.status==='in_stock'&&/comic/i.test(String(i.category||''))&&(https(i.thumbnail)||https(i.imageUrl))&&Number(i.qty??1)>0).map(stageItem).filter(c=>c.title&&c.image);}
  // The vending machine's list: tap an item to mark it SOLD OUT (or back).
  function paintMachine(){const el=host.querySelector('#vm-list');if(!el)return;el.replaceChildren(...(machineCtl.items||[]).map((it,i)=>{const b=document.createElement('button');b.type='button';b.className='vm-item'+(it.sold?' sold':'');b.textContent=(it.sold?'❌ ':'✅ ')+(it.listed?'📡 ':'')+(it.buyer?'@'+it.buyer+' · ':'')+'#'+(i+1)+'  '+it.title;b.onclick=()=>run(()=>machineDo({toggle:i}));if(i===vmUp(machineCtl))b.classList.add('up');return b;}));const sh=host.querySelector('#vm-show');if(sh)sh.textContent=machineCtl.on?'✅ MACHINE IS ON':'SHOW THE MACHINE';
    host.querySelectorAll('[data-vm-mode]').forEach(b=>b.classList.toggle('on',(machineCtl.mode||'panel')===b.dataset.vmMode));const u=vmUp(machineCtl),upEl=host.querySelector('#vm-up');if(upEl)upEl.textContent=u>=0?'UP NOW: '+'#'+(u+1)+'  '+machineCtl.items[u].title+'  ·  '+machineCtl.items.filter(x=>!x.sold).length+' OF '+machineCtl.items.length+' LEFT':machineCtl.items?.length?'ALL SOLD':'Nothing up';}
  // The slot UP NOW (the same rule as the screens: the host's pick, else the first open one).
  function vmUp(m){if(!m?.items?.length)return -1;if(Number.isInteger(m.up)&&m.items[m.up]&&!m.items[m.up].sold)return m.up;return m.items.findIndex(x=>!x.sold);}
  // Connected: the show's machine. In the preview: the same changes, here only, so you can try it first.
  async function machineDo(body){if(connectedStore){took(await api('machine',body));return;}
    const m={on:false,items:[],...machineCtl},items=m.items=[...m.items],open=(i,dir)=>{for(let k=1;k<=items.length;k++){const j=(((i+dir*k)%items.length)+items.length)%items.length;if(!items[j].sold)return j;}return -1;};
    if(body.load==='stage'){m.items=[stage.now,...(stage.next||[])].filter(x=>x&&x.title).map(x=>({...x,sold:false}));m.kind='items';m.up=0;}
    if(body.spots){const V=await import('./vending.mjs?v='+STUDIO_V);m.items=V.makeSpots(body.spots);if(!m.items.length)throw Error('How many spots? (or one name a line)');for(const it of m.items){const w=chanceFn?.(it.title);if(w)throw Error('"'+w+'" reads as a game of chance -- Whatnot doesn\'t allow those.');}m.kind='spots';m.up=0;}
    if(body.buyer&&items[body.buyer.i]){const nm=String(body.buyer.name||'').replace(/^@/,'').replace(/[^\w.\-]/g,'').slice(0,30);const {buyer,...rest}=items[body.buyer.i];items[body.buyer.i]=nm?{...rest,buyer:nm,sold:true}:rest;}
    if(Number.isInteger(body.toggle)&&items[body.toggle])items[body.toggle]={...items[body.toggle],sold:!items[body.toggle].sold};
    if(Array.isArray(body.items)){m.items=body.items.map(x=>({...x,sold:false}));m.kind=body.kind==='showcase'?'showcase':'items';m.up=0;}if(body.theme!==undefined)m.theme=body.theme;if(body.giveEvery!==undefined)m.giveEvery=body.giveEvery;
    {const un=it=>{if(!it.flashUntil&&!it.wasPrice)return it;const {wasPrice,flashUntil,...r}=it;return {...r,price:Number(wasPrice)>0?wasPrice:it.price};};m.items=m.items.map(it=>it.flashUntil&&Date.now()>=it.flashUntil?un(it):it);if(body.flashEnd)m.items=m.items.map(un);
    if(body.flash){const f=body.flash,pct=Number(f.pct)||0,to=Number(f.price)||0,mins=Math.floor(Number(f.minutes)||0),want=new Set((f.slots||[]).filter(n=>n>=1&&n<=m.items.length));if(!(pct>0&&pct<90)&&!(to>0))throw Error('Flash sale: % off (1-89) or a sale price');if(mins<1||mins>60)throw Error('Flash sale: 1 to 60 minutes');if(!want.size)throw Error('Flash sale: which slot numbers?');const until=Date.now()+mins*60000;let hit=0;
      m.items=m.items.map((it,i)=>{if(!want.has(i+1)||it.sold)return it;const b=un(it),was=Number(b.price)||0,now=Math.round((to>0?to:was*(1-pct/100))*100)/100;if(!(was>0&&now>0&&now<was))return it;hit++;return {...b,wasPrice:was,price:now,flashUntil:until};});if(!hit)throw Error('Flash sale: those slots need a price above the sale price');}}
    if(body.mode)m.mode=body.mode;if(typeof body.on==='boolean')m.on=body.on;if(typeof body.title==='string')m.title=body.title.trim().slice(0,30).toUpperCase();
    if(body.step)m.up=open(vmUp(m),body.step);if(body.soldUp){const u=vmUp(m);if(u>=0){m.items[u]={...m.items[u],sold:true};m.up=open(u,1);}}
    machineCtl=m;paintMachine();preview();}
  // The attack picked in the preview (not connected): shown lit there.
  function withMove(st){return st&&demoMove!=null?{...st,beastMove:demoMove}:st;}
  // ATTACK NOW: the four attacks as buttons; connected, the show uses it; in the preview, the preview does.
  function paintMoves(){const el=host.querySelector('#beast-moves');if(!el)return;const raw=String(form.elements.namedItem('beastsMoves')?.value||'').split(/\r?\n/).map(x=>x.replace(/[^A-Za-z0-9 '!?$&.-]/g,'').trim().toUpperCase().slice(0,16)).filter(Boolean),list=[...raw,'LOWBALL','PRICE CHECK','SLEEVE UP','BENT CORNER'].slice(0,4),cur=demoMove!=null&&!connectedStore?demoMove:Number(stats?.beastMove)||0;
    el.replaceChildren(...list.map((m,i)=>{const b=document.createElement('button');b.type='button';b.textContent='⚔ '+(i+1)+' '+m;b.classList.toggle('on',i===cur);b.onclick=()=>run(async()=>{const now=Date.now();if(connectedStore){const d=await api('beast-move',{index:i});took(d);if(d.effect)preview(d.effect);status.textContent='Attack: '+m;}else{demoMove=i;preview({id:'move-'+now,kind:'move',move:m,startsAt:now,endsAt:now+3000});status.textContent='Preview: '+m+' (connect to use it in the show).';}paintMoves();});return b;}));}
  // Which game is on, lit in the quick section.
  function paintGame(){const m=form.elements.namedItem('gameMode')?.value||'dungeon';host.querySelector('#game-dungeon')?.classList.toggle('on',m==='dungeon');host.querySelector('#game-beasts')?.classList.toggle('on',m==='beasts');host.querySelector('#game-vending')?.classList.toggle('on',m==='vending');
    // Beasts-only buttons stay out of the dungeon (and the other way round).
    host.querySelectorAll('[data-beasts],#beast-moves').forEach(el=>{el.hidden=m!=='beasts';});
    // TOTALLY SEPARATE GAMES (2026-11-13): the other game's sections step aside (your own show/hide choices stay as they are).
    const DUNGEON_ONLY=['🗡 Dungeon controls','🗡 Dungeon settings','Boss battle'],BEASTS_ONLY=['👾 Beasts controls','👾 Beasts settings'];
    host.querySelectorAll('details.mana-sec[data-sec]').forEach(d=>d.classList.toggle('mana-offgame',m==='beasts'?DUNGEON_ONLY.includes(d.dataset.sec):m==='vending'?DUNGEON_ONLY.includes(d.dataset.sec)||BEASTS_ONLY.includes(d.dataset.sec):BEASTS_ONLY.includes(d.dataset.sec)));
    const w=form.elements.namedItem('beastsBattle')?.value||'overlay';host.querySelector('#battle-front')?.classList.toggle('on',w==='overlay');host.querySelector('#battle-green')?.classList.toggle('on',w==='green');}
  // ORGANIZED (2026-11-13: "I want to be able to close a dropdown for different
  // sections. I don't use ByteRider_97 much and like to hide certain sections.
  // Organize it better"): every section folds (it remembers), any section can be
  // hidden (SHOW / HIDE SECTIONS at the bottom), and the remote runs in show order.
  function organize(){
    const K='mana-sec:',get=k=>{try{return localStorage.getItem(K+k);}catch{return null;}},put=(k,v)=>{try{localStorage.setItem(K+k,v);}catch{}};
    const fold=(box,openFirst)=>{const out=[];let cur=null;for(const el of [...box.children]){if(el.tagName==='H3'){const name=el.textContent.trim(),d=document.createElement('details'),sm=document.createElement('summary');d.className='mana-sec';d.dataset.sec=name;sm.textContent=name;d.append(sm);el.replaceWith(d);const st=get(name);d.open=st?st==='open':openFirst.includes(name);d.hidden=get('hide:'+name)==='1';d.addEventListener('toggle',()=>put(name,d.open?'open':'closed'));out.push(d);cur=d;continue;}if(cur&&!el.matches('button[type=submit]'))cur.append(el);}return out;};
    const remote=host.querySelector('.mana-remote'),formBox=host.querySelector('#mana-form');
    const top=fold(remote,['🎮 Game','🗡 Dungeon controls','👾 Beasts controls']),rest=fold(formBox,['🎮 Which game']);
    // The show order up top.
    for(const n of ['🎮 Game','🗡 Dungeon controls','👾 Beasts controls','Now playing & next up','🥤 Vending machine']){const d=top.find(x=>x.dataset.sec===n);if(d)remote.append(d);}
    // SHOW / HIDE SECTIONS.
    const all=[...top,...rest],mgr=document.createElement('details'),sm=document.createElement('summary');mgr.className='mana-sec mana-hider';sm.textContent='👁 SHOW / HIDE SECTIONS';mgr.append(sm);
    const byte=()=>{const off=all.find(d=>d.dataset.sec==='ByteRider_97')?.hidden;host.querySelectorAll('[data-click*="mana-mascot"]').forEach(b=>{b.hidden=!!off;});};
    for(const d of all){const lb=document.createElement('label'),cb=document.createElement('input');lb.className='mana-check';cb.type='checkbox';cb.checked=!d.hidden;cb.onchange=()=>{d.hidden=!cb.checked;put('hide:'+d.dataset.sec,cb.checked?'0':'1');byte();};lb.append(cb,document.createTextNode(' '+d.dataset.sec));mgr.append(lb);}
    host.append(mgr);byte();paintGame();
  }
  // The faces, drawn small in the remote (four greens).
  function drawFace(viewId,field){const cv=host.querySelector(viewId),v=String(form.elements.namedItem(field)?.value||'');if(!cv)return;const x=cv.getContext('2d'),G=['#9bbc0f','#8bac0f','#306230','#0f380f'];x.clearRect(0,0,12,12);if(!/^[0-3]{144}$/.test(v))return;for(let i=0;i<144;i++){x.fillStyle=G[+v[i]];x.fillRect(i%12,Math.floor(i/12),1,1);}}
  function readyList(){
    const el=host.querySelector('#mana-ready');if(!el)return;const v=values(),d=stats?.dungeon,n=(stage.next||[]).length;
    const rows=[[!!connectedStore,'Remote connected to the show'],[v.dungeonOn!==false,'The dungeon is on'],[!!v.showId,'Whatnot show picked (Show: CURRENT SHOW)'],[n>=10,'NEXT UP: '+n+' items'+(n<10?' (10+ is best -- SHOW PREP or LOAD)':'')],[shedPicsCtl.length>=12,'Item photos on the walls: '+shedPicsCtl.length],[!!String(v.chestGoals||'').trim(),'Chest rewards set'],[!!String(v.floorRewards||'').trim(),'Floor rewards set'],[(stage.next||[]).some(x=>SPECIAL.test(x.title+' '+(x.detail||''))),'Special books in NEXT UP for the merchant'],[!!d,'The overlay has the dungeon ('+(d?'floor '+d.floor:'not yet')+')']];
    el.replaceChildren(...rows.map(([ok,t])=>{const li=document.createElement('li');li.className=ok?'ok':'no';li.textContent=(ok?'✅ ':'⚠️ ')+t;return li;}));
  }
  async function showReady(){
    // Nothing that reads as a game of chance goes on screen (Whatnot's rules).
    const comics=stockComics().filter(c=>!chanceFn(c.title+' '+c.detail));
    if(comics.length<6)throw Error('Need at least 6 comics in stock with photos.');
    const byPrice=[...comics].sort((a,b)=>(b.price||0)-(a.price||0)),grails=byPrice.slice(0,8);
    const cheap=comics.filter(c=>c.price>0&&c.price<=8).sort((a,b)=>a.price-b.price),gifts=cheap.length>=3?cheap:[...byPrice].reverse().slice(0,6);
    const g=k=>short(gifts[k%gifts.length].title),top=k=>short(grails[k%grails.length].title);
    // NEXT UP: SHOW PREP's lineup stays; empty, it's 20 comics -- a few specials for the merchant, big books spread through.
    let next=stage.next||[],fill=false;
    if(next.length<5){fill=true;const specials=byPrice.filter(c=>SPECIAL.test(c.title+' '+c.detail)).slice(0,6),rest=byPrice.filter(c=>!specials.includes(c)),mid=rest.slice(Math.floor(rest.length/3)),out=[];
      for(let k=0;out.length<20&&k<60;k++){const src=k%3===2&&specials.length?specials:k%2?mid:rest;const c=src.shift();if(c&&!out.includes(c))out.push(c);}
      next=out;}
    const f=form.elements;
    f.namedItem('chestGoals').value=['5 follows: Free giveaway for everyone -- '+g(0),'10 shares: Free giveaway for everyone -- '+g(1),'25 taps: Low start on '+top(0)].join('\n');
    f.namedItem('floorRewards').value=[1,2,3,4,5,6,7].map(n=>n+': '+(n%2?'Free giveaway for everyone -- '+g(n+1):'Low start on '+top(n>>1))).join('\n');
    f.namedItem('roomRewards').value=['vault: Low start on '+top(1),'library: Free giveaway for everyone -- '+g(5),'armory: Low start on '+top(2),'forge: Free giveaway for everyone -- '+g(6),'crypt: Free giveaway for everyone -- '+g(7),'lab: Low start on '+top(3)].join('\n');
    if(f.namedItem('dungeonComics'))f.namedItem('dungeonComics').checked=true;
    const d=await api('settings',{settings:values(),revision});revision=d.revision;took(d);
    if(fill)await saveStage({now:stage.now||next[0]||null,next:stage.now?next:next.slice(1)});
    await sendShedPics(null);
    readyList();
    status.textContent='Show ready: '+comics.length+' comics in stock'+(fill?', NEXT UP filled with '+next.length:'')+', rewards and wall photos loaded.';
  }
  async function saveStage(next){const d=await api('stage',{stage:next});took(d);status.textContent=next.now?'Now playing: '+next.now.title:'Now playing cleared.';}
  const find=host.querySelector('#mana-find'),found=host.querySelector('#mana-found');
  find.oninput=()=>{
    const q=find.value.trim().toLowerCase();found.replaceChildren();if(q.length<2)return;
    const hits=inventory().filter(i=>i.status==='in_stock'&&String(i.name||'').toLowerCase().includes(q)).slice(0,8);
    for(const i of hits){const item=stageItem(i),d=document.createElement('div');d.className='mana-found-row';const t=document.createElement('span');t.textContent=item.title+(item.price?' · '+usd(item.price):'');
      const now=document.createElement('button');now.type='button';now.textContent='NOW';now.onclick=()=>run(()=>saveStage({now:item,next:stage.next||[]}));
      const nx=document.createElement('button');nx.type='button';nx.textContent='+ NEXT';nx.onclick=()=>run(()=>saveStage({now:stage.now,next:[...(stage.next||[]),item].slice(0,60)}));
      t.title='Tap to play it now';t.onclick=now.onclick;d.append(t,now,nx);found.append(d);}
    if(!hits.length){const d=document.createElement('div');d.className='mana-found-row';d.textContent='No in-stock item matches';found.append(d);}
  };
  host.querySelector('#mana-next').onclick=()=>run(()=>{const [n,...rest]=stage.next||[];if(!n)throw Error('Nothing in next up');return saveStage({now:n,next:rest});});
  host.querySelector('#mana-stage-clear').onclick=()=>run(()=>saveStage({now:null,next:stage.next||[]}));

  // A pretend sale in the preview only -- nothing is sent.
  let demo=0,demoGross=0,demoBig=0,demoDungeon=null,dungeonLib=null,demoMove=null,demoBeasts=null,beastsLib=null;
  import('./beasts.mjs?v='+STUDIO_V).then(m=>{beastsLib=m;}).catch(()=>{});
  import('./live-studio-dungeon.mjs?v='+STUDIO_V).then(m=>{dungeonLib=m;}).catch(()=>{});
  host.querySelector('#mana-demo').onclick=()=>{try{demoSale();}catch(e){status.textContent='Demo: '+(e?.message||e)+' -- reload the dashboard.';}};
  // ⏩ PLAY THROUGH (store, 2026-11-24: "see the whole dungeons as I go through so I can test them out"): a demo sale
  // every few seconds, in the preview only, until tapped again.
  let demoRun=0;const runBtn=host.querySelector('#mana-demo-run');
  runBtn.onclick=()=>{if(demoRun){clearInterval(demoRun);demoRun=0;runBtn.textContent='⏩ PLAY THROUGH THE DUNGEON (preview only)';status.textContent='Play-through stopped.';return;}
    const step=()=>{try{demoSale();}catch(e){clearInterval(demoRun);demoRun=0;runBtn.textContent='⏩ PLAY THROUGH THE DUNGEON (preview only)';status.textContent='Demo: '+(e?.message||e);}};
    runBtn.textContent='⏸ STOP THE PLAY-THROUGH';demoRun=setInterval(step,3500);step();};
  const demoSale=()=>{const v=values(),amount=v.gameMode==='beasts'?[4,3,5,4,6][demo%5]:[12,45,8,150,25][demo%5]; demo++; // beasts: small steps, so the demo walks into the tall grass and fights
    if(demo===1){demoGross=stats?.gross||0;demoBig=stats?.biggest||0;}
    const wasAlive=demoGross<v.bossGoal;demoGross+=amount;demoBig=Math.max(demoBig,amount);const hp=Math.max(0,v.bossGoal-demoGross);
    const fake={gross:demoGross,sold:(stats?.sold||0)+demo,biggest:demoBig,combo:demo,lastSaleAt:Date.now(),giveaways:0,boss:{name:v.bossName,goal:v.bossGoal,hp,pct:hp/v.bossGoal*100,defeated:hp<=0,reward:v.bossReward}};
    let kind=!v.dungeonOn&&wasAlive&&hp<=0&&v.showBoss?'boss':amount>=v.jackpotAmount?'jackpot':'sold',extra={};
    // BEASTS: its own track in the preview too (the dungeon doesn't move).
    if(v.gameMode==='beasts'&&beastsLib){
      if(demo===1){const p=stats?.beasts;demoBeasts=p?{week:p.week,route:p.route,phase:p.stage==='rival'?'rival':'route',xp:p.xp,exp:p.exp||0,rivalHp:p.stage==='rival'?p.rival.hp:0,caught:(p.caught||[]).map(name=>({name})),badges:[]}:beastsLib.emptyBeasts();}
      const r=beastsLib.addBeastXp(demoBeasts,amount,v);demoBeasts=r.beasts;fake.beasts=beastsLib.publicBeasts(demoBeasts,v,stats?.beastStarter||'');fake.dungeon=stats?.dungeon;
      const mo=beastsLib.beastMoment(r.events,stats?.beastStarter||'',v.beastsEvolveReward||'');
      if(mo){kind='beast';const {kind:_k,...rest}=mo;extra=rest;}
    }
    // The dungeon moves too (preview only).
    else if(dungeonLib){
      if(demo===1){const p=stats?.dungeon;demoDungeon=p?{week:p.week,floor:p.floor,phase:p.phase,mana:p.mana,bossHp:p.phase==='boss'?p.boss.hp:0,stars:p.stars,cleared:[],taps:{}}:null;}
      const r=dungeonLib.addMana(demoDungeon,amount,v);demoDungeon=r.dungeon;fake.dungeon=dungeonLib.publicDungeon(demoDungeon,v,demoGross);
      const boss=r.events.filter(x=>x.kind==='boss').pop(),fl=r.events.filter(x=>x.kind==='floor').pop(),un=v.dungeonOn?dungeonLib.showUnlocksCrossed(demoGross-amount,demoGross,v).pop():null;
      // The chests open in the demo too, each with what's loaded in it for that floor (chat's tap goals count as met here).
      let chest=null;if(!boss&&!fl){const c=dungeonLib.chestsToOpen(demoDungeon,{...v,chestGoals:''})[0];if(c){demoDungeon=dungeonLib.openChest(demoDungeon,c.k);const ld=dungeonLib.nextChestLoad(v,demoDungeon);if(ld)demoDungeon=dungeonLib.useChestLoad(demoDungeon,ld.id);
        chest={chestText:ld?ld.t:(c.k<(Number(v.giveawayChests??2)||0)?'FREE GIVEAWAY':'THE NEXT BOOK UP'),chestGoal:'CHEST '+(c.k+1)+' OF 3',...(ld?.i?{item:ld.i}:{})};fake.dungeon=dungeonLib.publicDungeon(demoDungeon,v,demoGross);}}
      if(boss){kind='boss';extra={dungeon:true,...boss};}else if(fl){kind='floor';extra=fl;}else if(chest){kind='chest';extra=chest;}else if(un){kind='unlock';extra={unlockText:un.text,unlockAt:un.n};}
      if(demoRun)status.textContent='Preview: floor '+fake.dungeon.floor+' · '+fake.dungeon.shed+(fake.dungeon.phase==='boss'?' · BOSS: '+fake.dungeon.boss.name:'')+(chest?' · chest: '+chest.chestText:'');
    }
    demoFake=fake;demoUntil=Date.now()+120000;
    preview({id:'demo-'+Date.now(),kind,startsAt:Date.now(),endsAt:Date.now()+5000,amount,word:['POW!','BAM!','KRAK!','ZAP!','KA-CHING!'][demo%5],combo:demo,reward:v.bossReward,bossName:v.bossName,buyer:v.showBuyerNames?'collector42':'',...extra},fake);};

  host.querySelector('#mana-link').onclick=()=>run(async()=>{const d=await api('overlay-link',{});const u=new URL('arcade-overlay.html',location.href);u.hash=new URLSearchParams({worker:WORKER,store:connectedStore,token:d.token}).toString();host.querySelector('#mana-url').value=u.href;const sh=new URL('shed-background.html',location.href);sh.hash=u.hash;host.querySelector('#mana-shed-url').value=sh.href;status.textContent='OBS link ready; expires '+new Date(d.expiresAt).toLocaleTimeString();});
  host.querySelector('#mana-revoke').onclick=()=>run(async()=>{await api('revoke',{});host.querySelector('#mana-url').value='';host.querySelector('#mana-shed-url').value='';status.textContent='OBS links revoked.';});
  const resize=new ResizeObserver(()=>{frame.style.setProperty('--preview-scale',frame.parentElement.clientWidth/1080);});resize.observe(frame.parentElement);
  frame.onload=()=>{if(settings)preview();};
  host.querySelector('.mana-preview-bg').onload=()=>{if(settings)preview();};
  // ASLEEP UNLESS ON SCREEN (store, 2026-11-13: "make sure the Whatnot tab isn't using resources while we
  // aren't using it ... is it running in the background all the time?"): the two previews (the overlay and the
  // green-screen game, drawing every frame) load only while the studio is on screen and are emptied 20 seconds
  // after it goes out of view (another tab, the app in the background); the server isn't asked anything meanwhile.
  let previewOffAt=null;
  const previewsOn=on=>{for(const f of host.querySelectorAll('iframe[data-src]')){const want=on?f.dataset.src:'about:blank';if(on?f.getAttribute('src')!==want:f.getAttribute('src')!=='about:blank')f.setAttribute('src',want);}};
  const watchView=()=>{const v=studioOnScreen();if(v){clearTimeout(previewOffAt);previewOffAt=null;previewsOn(true);}else if(!previewOffAt)previewOffAt=setTimeout(()=>{previewOffAt=null;if(!studioOnScreen())previewsOn(false);},20000);};
  document.addEventListener('visibilitychange',watchView);setInterval(watchView,2000);watchView();
  import('./live-studio-model.mjs').then(m=>{chanceFn=m.chanceWordIn;paint({...m.DEFAULT_STUDIO});}).catch(()=>{});
})();
