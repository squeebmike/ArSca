// Research Loupe: a live jeweler's-loupe camera for the Research tab --
// point the phone at a card, turn on the flashlight, zoom in, and drag a
// circular magnifier over tiny print (card numbers, copyright lines, holo
// patterns) to read it with your own eyes. This is deliberately NOT the
// AI card-identification scanner (openCardSightScanner, see dashboard.html)
// -- that one takes a photo and asks "what card is this" for pricing.
// Loupe never analyzes anything; it's pure optical inspection, closer to
// holding a real loupe than to a scan button. The two live side by side in
// the same search row on purpose.
//
// Self-contained like card-intake-dashboard.js/daily-tasks-dashboard.js,
// but builds its own DOM at runtime instead of relying on markup already
// in dashboard.html -- there's nothing there to move into, and it keeps
// dashboard.html's edit surface down to one new button. Every internal
// control is wired with addEventListener (not inline onclick="..."), so
// unlike those two files there's no window-exposure list to maintain --
// the only function dashboard.html's markup ever calls directly is
// window.openResearchLoupe.
(function(){

// ── Tunables ──────────────────────────────────────────────────────────
var DIGITAL_MAX_ZOOM = 5;      // always achievable, regardless of hardware
var MIN_ZOOM = 1;
var QUICK_ZOOMS = [1, 2, 5];
var MAG_LEVELS = [2, 4, 8];    // loupe glass magnification, separate from camera zoom
var DEFAULT_MAG = 4;
var GLASS_SIZE = 148;          // px, the magnifier circle's diameter

// ── Pure geometry helper (exported for tests) ────────────────────────────
// Given the camera preview box size, a drag point as a 0..1 fraction of
// that box, and a magnification level, returns exactly where to position
// the glass circle and its inner (larger, re-cropped) clone video so the
// point under the glass stays visually centered. Kept pure/DOM-free on
// purpose -- this is the one piece of Loupe's math worth unit testing
// without mocking a camera.
function computeLoupeGeometry(containerW, containerH, fx, fy, mag, glassSize){
  fx = Math.min(1, Math.max(0, fx));
  fy = Math.min(1, Math.max(0, fy));
  var glassLeft = fx * containerW - glassSize / 2;
  var glassTop = fy * containerH - glassSize / 2;
  var videoWidth = containerW * mag;
  var videoHeight = containerH * mag;
  var videoLeft = glassSize / 2 - fx * videoWidth;
  var videoTop = glassSize / 2 - fy * videoHeight;
  return { glassLeft: glassLeft, glassTop: glassTop, videoWidth: videoWidth, videoHeight: videoHeight, videoLeft: videoLeft, videoTop: videoTop };
}

function clamp(n, lo, hi){ return Math.min(hi, Math.max(lo, n)); }

// ── Persisted preferences ─────────────────────────────────────────────
// Store request: leaving Loupe zoomed in on a set number should stay that
// way next time, not silently reset to 1x. Only zoom + loupe magnification
// persist -- deliberately NOT torch (a phone that auto-turns its flashlight
// back on next time, possibly face-down in a pocket, is a worse default
// than just tapping it again), and not loupeOn/position (those are
// per-session framing, not a standing preference).
var PREFS_KEY = 'research_loupe_prefs_v1';
function loadPrefs(){
  try {
    var raw = window.localStorage && localStorage.getItem(PREFS_KEY);
    if(!raw) return {};
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch(e){ return {}; }
}
function savePrefs(patch){
  try {
    if(!window.localStorage) return;
    var current = loadPrefs();
    localStorage.setItem(PREFS_KEY, JSON.stringify(Object.assign(current, patch)));
  } catch(e){ /* private browsing / storage blocked -- zoom just won't persist */ }
}
var prefs = loadPrefs();

// ── State ─────────────────────────────────────────────────────────────
var state = {
  open: false,
  started: false,          // camera actually running (vs. still starting up, or failed)
  stream: null,
  track: null,
  torchOn: false,
  torchSupported: null,    // null = unknown until camera starts
  zoomHwSupported: null,
  zoomHwMin: 1, zoomHwMax: 1, zoomHwStep: 0.1,
  zoomLevel: clamp(Number(prefs.zoom) || 1, MIN_ZOOM, DIGITAL_MAX_ZOOM),
  usingDigitalZoom: false,
  loupeOn: false,
  loupeMag: MAG_LEVELS.includes(Number(prefs.mag)) ? Number(prefs.mag) : DEFAULT_MAG,
  loupeFx: 0.5, loupeFy: 0.38,
  error: '',
};

var dom = null; // populated by ensureDom()
var pinch = null; // {startDist, startZoom} while a two-finger gesture is active
var dragging = false;
var rafPending = false;

function toast(msg){ if(typeof toast_dash === 'function') toast_dash(msg); }

// ── DOM shell (built once, reused across opens) ──────────────────────────
function ensureDom(){
  if(dom) return dom;
  var overlay = document.createElement('div');
  overlay.className = 'rloupe-overlay';
  overlay.innerHTML =
    '<div class="rloupe-sheet" role="dialog" aria-label="Loupe visual inspection">' +
      '<div class="rloupe-head">' +
        '<div class="rloupe-title">LOUPE <span class="rloupe-title-sub">visual inspection</span></div>' +
        '<button type="button" class="hbtn rloupe-close" aria-label="Close Loupe">CLOSE</button>' +
      '</div>' +
      '<div class="rloupe-cat-row">' +
        '<span class="rloupe-cat-label">Category</span>' +
        '<div class="rloupe-cat-slot"></div>' +
      '</div>' +
      '<div class="rloupe-camera">' +
        '<video class="rloupe-video" playsinline muted></video>' +
        '<div class="rloupe-glass" hidden>' +
          '<video class="rloupe-glass-video" playsinline muted></video>' +
          '<div class="rloupe-glass-ring"></div>' +
          '<div class="rloupe-glass-mag"></div>' +
        '</div>' +
        '<button type="button" class="rloupe-x" aria-label="Close Loupe">✕</button>' +
        '<div class="rloupe-error" hidden>' +
          '<div class="rloupe-error-msg"></div>' +
          '<button type="button" class="hbtn rloupe-retry" data-action="retry" style="color:var(--g)">TRY AGAIN</button>' +
        '</div>' +
      '</div>' +
      '<div class="rloupe-controls">' +
        '<button type="button" class="hbtn rloupe-torch" aria-label="Toggle flashlight" disabled>🔦 TORCH</button>' +
        '<div class="rloupe-zoom-group">' +
          '<div class="rloupe-zoom-btns"></div>' +
          '<input type="range" class="rloupe-zoom-slider" min="1" max="' + DIGITAL_MAX_ZOOM + '" step="0.1" value="1" aria-label="Camera zoom">' +
          '<span class="rloupe-zoom-note"></span>' +
        '</div>' +
        '<button type="button" class="hbtn rloupe-loupe-toggle" aria-label="Enable jeweler\'s loupe">🔍 LOUPE</button>' +
        '<div class="rloupe-mag-btns" hidden></div>' +
      '</div>' +
      '<div class="rloupe-input-row">' +
        '<input type="text" class="tsi rloupe-input" placeholder="Ask/search anything...">' +
        '<button type="button" class="hbtn rloupe-mic" aria-label="Voice search" style="width:54px;padding:0">MIC</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  dom = {
    overlay: overlay,
    sheet: overlay.querySelector('.rloupe-sheet'),
    closeBtn: overlay.querySelector('.rloupe-close'),
    xBtn: overlay.querySelector('.rloupe-x'),
    catSlot: overlay.querySelector('.rloupe-cat-slot'),
    camera: overlay.querySelector('.rloupe-camera'),
    video: overlay.querySelector('.rloupe-video'),
    glass: overlay.querySelector('.rloupe-glass'),
    glassVideo: overlay.querySelector('.rloupe-glass-video'),
    glassMagLabel: overlay.querySelector('.rloupe-glass-mag'),
    errorBox: overlay.querySelector('.rloupe-error'),
    errorMsg: overlay.querySelector('.rloupe-error-msg'),
    retryBtn: overlay.querySelector('.rloupe-retry'),
    torchBtn: overlay.querySelector('.rloupe-torch'),
    zoomBtnsWrap: overlay.querySelector('.rloupe-zoom-btns'),
    zoomSlider: overlay.querySelector('.rloupe-zoom-slider'),
    zoomNote: overlay.querySelector('.rloupe-zoom-note'),
    loupeToggle: overlay.querySelector('.rloupe-loupe-toggle'),
    magBtnsWrap: overlay.querySelector('.rloupe-mag-btns'),
    input: overlay.querySelector('.rloupe-input'),
    mic: overlay.querySelector('.rloupe-mic'),
  };

  QUICK_ZOOMS.forEach(function(z){
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'hbtn rloupe-zoom-btn'; b.textContent = z + '×';
    b.setAttribute('aria-label', 'Zoom to ' + z + 'x');
    b.addEventListener('click', function(){ applyZoom(z); });
    dom.zoomBtnsWrap.appendChild(b);
  });
  MAG_LEVELS.forEach(function(m){
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'hbtn rloupe-mag-btn'; b.textContent = m + '×';
    b.setAttribute('aria-label', 'Loupe magnification ' + m + 'x');
    b.addEventListener('click', function(){ state.loupeMag = m; savePrefs({ mag: m }); renderMagButtons(); updateGlassGeometry(); });
    dom.magBtnsWrap.appendChild(b);
  });

  dom.closeBtn.addEventListener('click', requestCloseResearchLoupe);
  dom.xBtn.addEventListener('click', requestCloseResearchLoupe);
  dom.overlay.addEventListener('click', function(e){ if(e.target === dom.overlay) requestCloseResearchLoupe(); });
  dom.retryBtn.addEventListener('click', function(){
    if(dom.retryBtn.dataset.action === 'reload') location.reload();
    else startLoupeCamera();
  });
  dom.torchBtn.addEventListener('click', function(){ setTorch(!state.torchOn); });
  dom.loupeToggle.addEventListener('click', toggleLoupeGlass);
  dom.zoomSlider.addEventListener('input', function(){ applyZoom(parseFloat(dom.zoomSlider.value) || 1); });
  dom.input.addEventListener('input', function(){
    var main = document.getElementById('qpl-input');
    if(!main) return;
    main.value = dom.input.value;
    main.dispatchEvent(new Event('input', { bubbles: true }));
  });
  dom.input.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); if(typeof runPriceLookup === 'function') runPriceLookup(); }
  });
  dom.mic.addEventListener('click', function(){
    if(typeof startVoiceInput === 'function') startVoiceInput('qpl-input', typeof runPriceLookup === 'function' ? runPriceLookup : undefined);
    else toast('Voice input not available');
  });

  bindDragHandlers();
  window.addEventListener('resize', function(){ if(state.loupeOn) updateGlassGeometry(); });
  document.addEventListener('visibilitychange', function(){
    if(document.hidden || !state.open || !state.started) return;
    // Most browsers pause the camera track while backgrounded rather than
    // ending it -- but some (notably some Android WebViews under memory
    // pressure) do end it, so recover instead of leaving a dead preview.
    if(state.track && state.track.readyState === 'ended') startLoupeCamera();
  });
  // Store request: "pressing the back button should close the loupe."
  // Opening pushes one history entry; the phone/browser back button then
  // fires a real popstate, which is the only place actual teardown happens
  // -- the X/close-button/tap-outside paths below all go through
  // requestCloseResearchLoupe, which just calls history.back() to trigger
  // this same popstate rather than duplicating the close logic.
  window.addEventListener('popstate', function(){
    if(!state.open) return;
    historyPushed = false;
    performLoupeClose();
  });

  return dom;
}

// ── Open / close ──────────────────────────────────────────────────────
var historyPushed = false;

function openResearchLoupe(){
  ensureDom();
  if(state.open) return;
  state.open = true;
  dom.overlay.classList.add('on');
  document.body.style.overflow = 'hidden';
  relocateCategoryWheel();
  var mainInput = document.getElementById('qpl-input');
  dom.input.value = mainInput ? mainInput.value : '';
  showError('');
  // Covers the very first open, before stopLoupeCamera has ever run once
  // to put the controls row into its correct disabled/off state.
  renderControls();
  try { history.pushState({ rloupeOpen: true }, ''); historyPushed = true; }
  catch(e){ historyPushed = false; } // e.g. sandboxed context -- back button just won't close it there
  // Store request: "if I open the loupe, the camera should already be on"
  // -- no separate "enable camera" tap. Fires immediately; a failure (denied
  // permission, no camera, in use elsewhere) surfaces as the error/retry
  // panel, not a screen shown proactively before ever trying.
  startLoupeCamera();
}

// UI-facing close (X button, header close, tap-outside): consumes the
// history entry opening pushed, which is what actually triggers
// performLoupeClose via the popstate listener above -- keeps the back
// button and every other close path running through one code path.
function requestCloseResearchLoupe(){
  if(historyPushed){ historyPushed = false; history.back(); }
  else performLoupeClose();
}

function performLoupeClose(){
  stopLoupeCamera();
  state.open = false;
  if(dom){ dom.overlay.classList.remove('on'); }
  document.body.style.overflow = '';
  restoreCategoryWheel();
}

// ── Category picker: relocates the REAL #qpl-cat-wheel (the same
// scrolling pill wheel the main Research search row uses) into the Loupe
// sheet for as long as it's open, then puts it back exactly where it came
// from. Store request: "category picker should be the scrolling thing we
// have in research tab." This is the actual live element -- its existing
// onclick/onscroll handlers (scrollQplCatWheelTo/handleQplCatWheelScroll,
// both defined in dashboard.html) already update the real #qpl-cat select
// and dispatch its change event, so there is nothing here to keep in sync
// by hand and no second category model. If the wheel isn't on the page
// for some reason, the slot is just left empty rather than failing.
var catWheelHome = null; // {parent, next} -- where to put it back on close

function relocateCategoryWheel(){
  var wheel = document.getElementById('qpl-cat-wheel');
  if(!wheel || !dom.catSlot) return;
  if(!catWheelHome) catWheelHome = { parent: wheel.parentNode, next: wheel.nextSibling };
  dom.catSlot.appendChild(wheel);
}

function restoreCategoryWheel(){
  var wheel = document.getElementById('qpl-cat-wheel');
  if(!wheel || !catWheelHome) return;
  if(catWheelHome.next && catWheelHome.next.parentNode === catWheelHome.parent){
    catWheelHome.parent.insertBefore(wheel, catWheelHome.next);
  } else {
    catWheelHome.parent.appendChild(wheel);
  }
}

// ── Camera lifecycle ──────────────────────────────────────────────────
// Store report: "I still see the try again button even though I see the
// camera feed darkened behind it" -- a slow/stale startLoupeCamera() call
// (an earlier tap, or the auto-start racing a manual retry tap) was
// resolving its error handling AFTER a later call had already succeeded,
// re-showing the error panel on top of an actually-working camera. Every
// call captures its own attemptId; any await-resumption checks it's still
// the current attempt before touching shared state or the UI, and a
// superseded call's own stream/track is torn down rather than adopted.
var cameraAttemptId = 0;

async function startLoupeCamera(){
  var attemptId = ++cameraAttemptId;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    showError('Camera not supported in this browser.');
    return false;
  }
  showError('');
  var stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, focusMode: { ideal: 'continuous' } },
      audio: false,
    });
  } catch(e){
    if(attemptId !== cameraAttemptId) return false; // a newer attempt has already taken over
    await handleCameraStartError(e, attemptId);
    return false;
  }
  if(attemptId !== cameraAttemptId){
    // Superseded while getUserMedia was resolving -- this stream belongs
    // to no one now; stop it immediately rather than leaving it running
    // unseen, and leave whatever the newer attempt already set up alone.
    stream.getTracks().forEach(function(t){ t.stop(); });
    return false;
  }
  state.stream = stream;
  if(typeof window.applyContinuousAutofocus === 'function'){
    try { await window.applyContinuousAutofocus(state.stream); } catch(e){ /* best effort */ }
  }
  if(attemptId !== cameraAttemptId){
    stream.getTracks().forEach(function(t){ t.stop(); });
    if(state.stream === stream) state.stream = null;
    return false;
  }
  state.track = state.stream.getVideoTracks()[0] || null;
  dom.video.srcObject = state.stream;
  dom.glassVideo.srcObject = state.stream;
  try { await dom.video.play(); } catch(e){ /* autoplay quirks -- video still becomes playable on interaction */ }
  try { await dom.glassVideo.play(); } catch(e){ /* ditto */ }
  if(attemptId !== cameraAttemptId){
    stream.getTracks().forEach(function(t){ t.stop(); });
    if(state.stream === stream){ state.stream = null; state.track = null; dom.video.srcObject = null; dom.glassVideo.srcObject = null; }
    return false;
  }
  state.started = true;
  showError('');
  detectCapabilities();
  renderControls();
  // A fresh track never remembers last session's zoom on its own (hardware
  // zoom is a per-track constraint, and any digital-zoom CSS transform was
  // cleared when the previous track stopped) -- reapply the remembered
  // level explicitly so "leave it zoomed in" actually holds across closing
  // and reopening Loupe, not just while one camera session stays open.
  applyZoom(state.zoomLevel);
  if(state.track){
    state.track.addEventListener('ended', function(){
      if(attemptId !== cameraAttemptId || !state.open) return; // a newer attempt already replaced this track
      showError('Camera stopped unexpectedly (it may be in use by another app).');
      stopLoupeCamera();
    });
  }
  return true;
}

function stopLoupeCamera(){
  if(state.stream){ state.stream.getTracks().forEach(function(t){ t.stop(); }); }
  state.stream = null;
  state.track = null;
  state.started = false;
  state.torchOn = false;
  state.torchSupported = null;
  state.zoomHwSupported = null;
  // state.zoomLevel is deliberately NOT reset here -- it's the remembered
  // "leave it zoomed in" preference (see startLoupeCamera, which reapplies
  // it to whatever track opens next), not live session state.
  state.usingDigitalZoom = false;
  if(state.loupeOn) toggleLoupeGlass();
  if(dom){
    dom.video.srcObject = null;
    dom.glassVideo.srcObject = null;
    dom.video.style.transform = '';
    // Unconditional, not just inside the loupeOn branch above -- torch/zoom
    // button enabled+active states must never survive past the stream that
    // backed them, whether or not the magnifier happened to be on.
    renderControls();
  }
}

function cameraErrorMessage(e){
  var name = (e && e.name) || '';
  if(name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No camera found on this device.';
  if(name === 'NotReadableError' || name === 'TrackStartError') return 'Camera is already in use by another app.';
  return 'Could not start the camera: ' + (e && e.message ? e.message : 'unknown error');
}

// Best-effort: not every browser implements a 'camera' Permissions API
// descriptor (notably Safari), so a null return just means "can't tell" --
// callers fall back to a message that covers both the not-yet-asked and
// blocked cases without claiming to know which one it is.
async function cameraPermissionState(){
  try {
    if(!navigator.permissions || !navigator.permissions.query) return null;
    var status = await navigator.permissions.query({ name: 'camera' });
    return status.state;
  } catch(e){ return null; }
}

// Store report: "said try again right away, and the button doesn't turn
// on camera" -- the exact signature of a site-level camera block, not a
// prompt the user just hasn't answered yet. Once a browser blocks camera
// access for a site, NO page script can reopen that permission prompt --
// getUserMedia() just rejects instantly, every time, forever, until the
// user changes it in the browser's own site settings. Tapping a TRY AGAIN
// button that calls getUserMedia again can't fix that, so this checks the
// Permissions API (when available) to tell the two cases apart and gives
// real instructions for the blocked one instead of implying retry will work.
async function handleCameraStartError(e){
  var name = (e && e.name) || '';
  if(name === 'NotAllowedError' || name === 'PermissionDeniedError'){
    var permState = await cameraPermissionState();
    if(permState === 'denied'){
      showError('Camera is blocked for this site. Tap the lock/info icon next to the address bar, open Permissions, allow Camera, then reload this page.', true);
      return;
    }
    showError('Camera permission was not granted. Tap TRY AGAIN and allow camera access when your browser prompts you.', false);
    return;
  }
  showError(cameraErrorMessage(e), false);
}

function showError(msg, blocked){
  if(!dom) return;
  dom.errorBox.hidden = !msg;
  dom.errorMsg.textContent = msg || '';
  dom.retryBtn.textContent = blocked ? 'RELOAD PAGE' : 'TRY AGAIN';
  dom.retryBtn.dataset.action = blocked ? 'reload' : 'retry';
}

// ── Capability detection (torch / hardware zoom) ─────────────────────────
function detectCapabilities(){
  var caps = (state.track && state.track.getCapabilities) ? (state.track.getCapabilities() || {}) : {};
  state.torchSupported = 'torch' in caps;
  state.zoomHwSupported = 'zoom' in caps;
  if(state.zoomHwSupported){
    state.zoomHwMin = caps.zoom.min != null ? caps.zoom.min : 1;
    state.zoomHwMax = caps.zoom.max != null ? caps.zoom.max : 1;
    state.zoomHwStep = caps.zoom.step || 0.1;
  }
}

// ── Torch ─────────────────────────────────────────────────────────────
async function setTorch(on){
  if(!state.track || !state.torchSupported) return;
  try {
    await state.track.applyConstraints({ advanced: [{ torch: on }] });
    state.torchOn = on;
  } catch(e){
    state.torchOn = false;
    toast('Flashlight control failed on this device');
  }
  renderControls();
}

// ── Zoom (hardware when available, CSS digital zoom always as fallback) ──
async function applyZoom(level){
  level = clamp(level, MIN_ZOOM, DIGITAL_MAX_ZOOM);
  state.zoomLevel = level;
  savePrefs({ zoom: level });
  var usedHardware = false;
  if(state.track && state.zoomHwSupported && level <= state.zoomHwMax){
    try {
      await state.track.applyConstraints({ advanced: [{ zoom: clamp(level, state.zoomHwMin, state.zoomHwMax) }] });
      usedHardware = true;
      dom.video.style.transform = '';
    } catch(e){ usedHardware = false; }
  }
  if(!usedHardware){
    dom.video.style.transform = 'scale(' + level + ')';
  }
  state.usingDigitalZoom = !usedHardware;
  renderControls();
  if(state.loupeOn) updateGlassGeometry();
}

// ── Jeweler's loupe magnifier ─────────────────────────────────────────
function toggleLoupeGlass(){
  state.loupeOn = !state.loupeOn;
  dom.glass.hidden = !state.loupeOn;
  renderControls();
  if(state.loupeOn) updateGlassGeometry();
}

function renderMagButtons(){
  Array.prototype.forEach.call(dom.magBtnsWrap.children, function(btn, i){
    btn.classList.toggle('active', MAG_LEVELS[i] === state.loupeMag);
  });
  dom.glassMagLabel.textContent = state.loupeMag + '×';
}

function updateGlassGeometry(){
  if(!state.loupeOn) return;
  var rect = dom.camera.getBoundingClientRect();
  var g = computeLoupeGeometry(rect.width, rect.height, state.loupeFx, state.loupeFy, state.loupeMag, GLASS_SIZE);
  dom.glass.style.left = g.glassLeft + 'px';
  dom.glass.style.top = g.glassTop + 'px';
  dom.glassVideo.style.width = g.videoWidth + 'px';
  dom.glassVideo.style.height = g.videoHeight + 'px';
  dom.glassVideo.style.left = g.videoLeft + 'px';
  dom.glassVideo.style.top = g.videoTop + 'px';
}

function scheduleGlassUpdate(){
  if(rafPending) return;
  rafPending = true;
  requestAnimationFrame(function(){ rafPending = false; updateGlassGeometry(); });
}

function pointFromEvent(e){
  var rect = dom.camera.getBoundingClientRect();
  return { fx: (e.clientX - rect.left) / rect.width, fy: (e.clientY - rect.top) / rect.height };
}

function bindDragHandlers(){
  var el = dom.camera;
  el.addEventListener('pointerdown', function(e){
    // Dragging only repositions an already-visible glass -- the 🔍 LOUPE
    // button is what turns it on, so a stray tap on the camera (focusing
    // attention, adjusting zoom) never silently re-enables a magnifier the
    // user just turned off.
    if(!state.started || !state.loupeOn) return;
    if(e.isPrimary === false) return; // let the pinch handler own multi-touch
    dragging = true;
    var p = pointFromEvent(e);
    state.loupeFx = p.fx; state.loupeFy = p.fy;
    scheduleGlassUpdate();
    try { el.setPointerCapture(e.pointerId); } catch(err){}
  });
  el.addEventListener('pointermove', function(e){
    if(!dragging || !state.loupeOn) return;
    var p = pointFromEvent(e);
    state.loupeFx = p.fx; state.loupeFy = p.fy;
    scheduleGlassUpdate();
  });
  function endDrag(e){ dragging = false; try { el.releasePointerCapture(e.pointerId); } catch(err){} }
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  // Pinch-to-zoom: tracked via raw touch events (Pointer Events don't give
  // a clean two-finger distance API) -- kept independent of the loupe drag
  // above, which only ever tracks a single pointer.
  el.addEventListener('touchstart', function(e){
    if(e.touches.length !== 2) return;
    pinch = { startDist: touchDist(e.touches), startZoom: state.zoomLevel };
  }, { passive: true });
  el.addEventListener('touchmove', function(e){
    if(!pinch || e.touches.length !== 2) return;
    var dist = touchDist(e.touches);
    var ratio = dist / (pinch.startDist || 1);
    applyZoom(pinch.startZoom * ratio);
  }, { passive: true });
  el.addEventListener('touchend', function(e){ if(e.touches.length < 2) pinch = null; }, { passive: true });

  el.addEventListener('dblclick', function(e){
    if(!state.started) return;
    var target = state.zoomLevel > 1.5 ? 1 : clamp(3, MIN_ZOOM, DIGITAL_MAX_ZOOM);
    applyZoom(target);
  });
}

function touchDist(touches){
  var dx = touches[0].clientX - touches[1].clientX;
  var dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Control rendering (torch/zoom/loupe button states) ────────────────
function renderControls(){
  if(!dom) return;
  dom.torchBtn.disabled = !state.torchSupported;
  dom.torchBtn.classList.toggle('active', !!state.torchOn);
  dom.torchBtn.title = state.torchSupported === false ? 'Flashlight unavailable on this device/browser.' : 'Toggle flashlight';

  dom.zoomSlider.value = String(state.zoomLevel);
  dom.zoomSlider.disabled = !state.started;
  Array.prototype.forEach.call(dom.zoomBtnsWrap.children, function(btn, i){
    btn.classList.toggle('active', Math.abs(QUICK_ZOOMS[i] - state.zoomLevel) < 0.05);
  });
  dom.zoomNote.textContent = state.started && state.usingDigitalZoom ? 'digital zoom' : (state.started && state.zoomHwSupported ? 'hardware zoom' : '');

  dom.loupeToggle.disabled = !state.started;
  dom.loupeToggle.classList.toggle('active', !!state.loupeOn);
  dom.magBtnsWrap.hidden = !state.loupeOn;
  renderMagButtons();
}

// ── Styles (injected once, kept out of dashboard.html's already-huge
// stylesheet -- self-contained like the rest of this file) ───────────────
function ensureStyles(){
  if(document.getElementById('research-loupe-styles')) return;
  var style = document.createElement('style');
  style.id = 'research-loupe-styles';
  style.textContent = [
    '.rloupe-overlay{display:none;position:fixed;inset:0;z-index:10070;background:rgba(0,0,0,.88);padding:18px;align-items:center;justify-content:center;}',
    '.rloupe-overlay.on{display:flex;}',
    // Store report: "can't get to the mic button unless scroll first" --
    // a fixed aspect-ratio:3/4 camera box grows without bound as the sheet
    // gets wider, so on a lot of phones it alone was taller than the
    // viewport, pushing the input/mic row below the fold. The sheet is now
    // a flex column with the camera as the only flexible piece (capped by
    // max-height, not aspect-ratio), and the input row is sticky to the
    // bottom of the sheet\'s own scroll area as a second guarantee -- mic
    // and typed search stay reachable without scrolling on virtually any
    // screen, and even degrade to "pinned while you scroll" rather than
    // "gone" on the rare screen too short for that guarantee to hold.
    '.rloupe-sheet{width:min(520px,100%);max-height:92vh;overflow:auto;display:flex;flex-direction:column;background:var(--surf);border:1px solid rgba(0,255,179,.3);border-radius:14px;padding:16px;box-shadow:0 24px 80px rgba(0,0,0,.7);}',
    '.rloupe-head{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;}',
    '.rloupe-title{font:900 13px \'Orbitron\',monospace;color:var(--g);letter-spacing:1px;}',
    '.rloupe-title-sub{font-family:var(--font-mono);font-size:9px;color:var(--dim);font-weight:400;letter-spacing:0;margin-left:6px;}',
    '.rloupe-cat-row{flex:0 0 auto;display:flex;align-items:center;gap:8px;margin-bottom:10px;}',
    '.rloupe-cat-label{font-family:var(--font-mono);font-size:9px;color:var(--dim);white-space:nowrap;}',
    '.rloupe-cat-slot{flex:1;min-width:0;display:flex;}',
    '.rloupe-camera{flex:1 1 auto;min-height:150px;max-height:40vh;position:relative;background:#030405;border:1px solid var(--border);border-radius:10px;overflow:hidden;touch-action:none;}',
    '.rloupe-video{width:100%;height:100%;object-fit:cover;display:block;transform-origin:center center;}',
    '.rloupe-glass-video{width:100%;height:100%;object-fit:cover;position:absolute;left:0;top:0;}',
    '.rloupe-glass{position:absolute;width:' + GLASS_SIZE + 'px;height:' + GLASS_SIZE + 'px;border-radius:50%;overflow:hidden;pointer-events:none;box-shadow:0 8px 26px rgba(0,0,0,.55);}',
    '.rloupe-glass-ring{position:absolute;inset:0;border-radius:50%;border:2px solid var(--g);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);pointer-events:none;}',
    '.rloupe-glass-mag{position:absolute;right:8px;bottom:6px;font-family:\'Orbitron\',monospace;font-size:10px;font-weight:900;color:var(--g);text-shadow:0 1px 3px rgba(0,0,0,.8);}',
    '.rloupe-x{position:absolute;top:8px;right:8px;z-index:3;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.55);color:#fff;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}',
    '.rloupe-x:hover,.rloupe-x:active{background:rgba(0,0,0,.75);}',
    '.rloupe-error{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;text-align:center;background:rgba(5,6,7,.94);}',
    '.rloupe-error-msg{font-family:var(--font-mono);font-size:11px;color:var(--red);max-width:280px;}',
    '.rloupe-controls{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;}',
    '.rloupe-torch{white-space:nowrap;}',
    '.rloupe-torch.active{color:var(--g);border-color:rgba(0,255,179,.5);background:rgba(0,255,179,.12);}',
    '.rloupe-torch:disabled{opacity:.4;}',
    '.rloupe-zoom-group{display:flex;align-items:center;gap:6px;flex:1;min-width:180px;}',
    '.rloupe-zoom-btns{display:flex;gap:4px;}',
    '.rloupe-zoom-btn{min-height:34px;padding:4px 8px;}',
    '.rloupe-zoom-btn.active{color:var(--g);border-color:rgba(0,255,179,.5);background:rgba(0,255,179,.12);}',
    '.rloupe-zoom-slider{flex:1;min-width:70px;accent-color:var(--g);}',
    '.rloupe-zoom-note{font-family:var(--font-mono);font-size:8px;color:var(--dim);white-space:nowrap;}',
    '.rloupe-loupe-toggle.active{color:var(--purple);border-color:rgba(199,125,255,.5);background:rgba(199,125,255,.12);}',
    '.rloupe-mag-btns{display:flex;gap:4px;width:100%;}',
    '.rloupe-mag-btn{flex:1;min-height:34px;}',
    '.rloupe-mag-btn.active{color:var(--purple);border-color:rgba(199,125,255,.5);background:rgba(199,125,255,.12);}',
    '.rloupe-input-row{flex:0 0 auto;position:sticky;bottom:0;display:flex;gap:6px;margin-top:10px;padding-top:8px;background:var(--surf);}',
    '.rloupe-input{flex:1;margin-bottom:0;}',
    '@media(max-width:640px){',
    '  .rloupe-overlay{padding:0;align-items:flex-end;}',
    '  .rloupe-sheet{width:100%;max-height:calc(100vh - 24px - env(safe-area-inset-bottom));border-radius:16px 16px 0 0;padding:14px 12px calc(16px + env(safe-area-inset-bottom));}',
    '  .rloupe-camera{max-height:32vh;}',
    '  .rloupe-controls .hbtn{min-height:44px;}',
    '}',
  ].join('\n');
  document.head.appendChild(style);
}

// ── Entry point ───────────────────────────────────────────────────────
function openResearchLoupeEntry(){
  ensureStyles();
  openResearchLoupe();
}

window.openResearchLoupe = openResearchLoupeEntry;
window.closeResearchLoupe = requestCloseResearchLoupe;
// Exposed for tests only -- not part of the public feature surface.
window.__researchLoupeInternals = { computeLoupeGeometry: computeLoupeGeometry, state: state };
})();
