// The studio sleeps unless it's on screen (store, 2026-11-13: "make sure the Whatnot tab isn't using resources
// while we aren't using it ... is it running in the background all the time?").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ctl = readFileSync(new URL('../scripts/live-studio-controls.js', import.meta.url), 'utf8');
assert.ok(ctl.includes("const studioOnScreen=()=>!document.hidden&&host.getClientRects().length>0;"));
assert.ok(ctl.includes('data-src="arcade-overlay.html#preview=1" src="about:blank"') && ctl.includes('data-src="shed-background.html#preview=1" src="about:blank"'), 'the previews start empty');
assert.ok(ctl.includes("previewOffAt=setTimeout(()=>{previewOffAt=null;if(!studioOnScreen())previewsOn(false);},20000);"), 'emptied 20 s after leaving');
assert.ok(ctl.includes("if(!connectedStore||!studioOnScreen()||connectedStore!==store())return;api('state')"), 'no polling off screen');
assert.ok(ctl.includes("if(!studioOnScreen()){setTimeout(()=>autoConnect(tries),3000);return;}"), 'connects only once the tab is opened');
assert.ok(!/ src="arcade-overlay\.html/.test(ctl) && !/ src="shed-background\.html/.test(ctl), "never loaded up front");
console.log('The studio sleeps off screen: passed');
