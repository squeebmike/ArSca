import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// ── Contract: both intervals now check something before running, unlike
// their previous unconditional setInterval(fn, ms) form ──
assert.match(dashboard, /setInterval\(\(\) => \{ if\(shouldPollTab\('pos'\)\) renderTodayMode\(\); \}, 10000\);/, 'renderTodayMode must be gated by the POS tab, matching the convention used for its sibling POS-tab intervals (renderScanInbox, renderStorefrontOrders)');
assert.match(dashboard, /setInterval\(\(\) => \{ if\(!document\.hidden\) updateDealerStatusBar\(\); \}, 5000\);/, 'updateDealerStatusBar must be gated by document.hidden, matching its neighbor probeNetwork()');
assert.doesNotMatch(dashboard, /setInterval\(renderTodayMode, 10000\);/, 'the old unconditional interval call must be gone');
assert.doesNotMatch(dashboard, /setInterval\(updateDealerStatusBar, 5000\);/, 'the old unconditional interval call must be gone');

console.log('Interval gating wiring contract checks passed');

// ── Contract: direct (non-interval) callers are untouched -- real actions
// like a completed sale or a drawer change must still refresh instantly,
// not wait out a poll cycle or a hidden-tab gate ──
const directCallSites = [
  /renderTodayMode\(\); renderDataHealthPanel\(\); renderOnboardingPanel\(\); updateUndoButton\(\);/,
  /renderStats\(\); renderTodayMode\(\); renderSoldTable\(\);/,
  /renderStats\(\);renderTodayMode\(\);/,
  /renderStats\(\); renderTodayMode\(\); renderBuySignals\(\);/,
];
for(const pattern of directCallSites){
  assert.match(dashboard, pattern, `direct call site must remain unguarded: ${pattern}`);
}
assert.match(dashboard, /if\(typeof updateDealerStatusBar === 'function'\) updateDealerStatusBar\(\);/, 'the post-load direct call to updateDealerStatusBar must remain unguarded');

console.log('Direct-caller contract checks passed');

// ── Contract: today-mode-grid really does live inside the POS tab's DOM (the
// premise for using shouldPollTab('pos') instead of just document.hidden) --
// pin this so a future refactor that moves the panel elsewhere doesn't leave
// a now-wrong gate silently in place ──
assert.match(dashboard, /const register = document\.getElementById\('tab-pos'\);/, 'organizeRegisterLayout must resolve the POS tab container as "register"');
assert.match(dashboard, /ensureTodayModePanel\(register\);/, 'ensureTodayModePanel must be called with the POS tab container');
assert.match(dashboard, /const anchor = document\.getElementById\('register-show-panel'\);\s*\n\s*if\(anchor\) register\.insertBefore\(panel, anchor\);\s*\n\s*else register\.appendChild\(panel\);/, 'the today-mode panel must actually be inserted into the POS tab container, not some cross-tab location');

// ── Contract: the dealer status bar really is outside any tab panel (the
// premise for using document.hidden instead of a specific shouldPollTab tab)
assert.match(dashboard, /<!-- Dealer status bar — always visible, shows key info at a glance -->\s*\n\s*<div class="dealer-status-bar" id="dealer-status-bar">/, 'the dealer status bar must be marked and structured as an always-visible, cross-tab element');

console.log('Gating-premise contract checks passed');
