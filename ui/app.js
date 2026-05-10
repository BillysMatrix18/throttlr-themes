/* ============================================================
   THROTTLR // app.js
   ============================================================ */

let bridge = null;
let isRunning = false;
let currentApp = "";
let appsCache = [];
let bwIn = [], bwOut = [];
let apFilter = "open";
let _hotkeyNotifications = true;
let _toastDurationMs = 3500;

// ============================================================================
// Icon registry — v3.0.1 redesign.
// Bolder, more distinctive monochrome SVGs. All paths use currentColor so
// they pick up theme colour from CSS — never hard-coded fills/strokes.
// Stroke-width 2.4 for chunkier presence than typical line icons (Throttlr
// has a stencil/industrial aesthetic, not Material-thin). Round caps + joins
// for a slightly friendly feel that contrasts the harsh hazard stripes.
// All icons drawn fresh on a 24x24 viewBox.
// Markup: <span class="icon" data-icon="search"></span>
// renderIcons() walks the DOM and inlines the SVG.
// ============================================================================
const ICONS = {
  // ---------- Tool rail / tools ----------
  // Search — magnifier with thick body + visible handle angle
  search:   '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.3" y1="15.3" x2="20.5" y2="20.5"/>',
  // Activity — pulse waveform with a steeper crest for visibility at small sizes
  activity: '<polyline points="2 12 6 12 9 4 15 20 18 12 22 12"/>',
  // Record — concentric ring + dot, hazard-style "armed" indicator
  record:   '<circle cx="12" cy="12" r="9.5" fill="none"/><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  // Film — film reel with sprocket holes (more recognizable than a strip)
  film:     '<rect x="2.5" y="3" width="19" height="18" rx="2.5"/><line x1="2.5" y1="9" x2="21.5" y2="9"/><line x1="2.5" y1="15" x2="21.5" y2="15"/><circle cx="6" cy="6" r="0.9" fill="currentColor" stroke="none"/><circle cx="18" cy="6" r="0.9" fill="currentColor" stroke="none"/><circle cx="6" cy="18" r="0.9" fill="currentColor" stroke="none"/><circle cx="18" cy="18" r="0.9" fill="currentColor" stroke="none"/>',
  // Network — central hub with 4 outer nodes, lines connecting (cleaner than Lucide)
  network:  '<circle cx="12" cy="12" r="2.5"/><circle cx="4.5" cy="4.5" r="2"/><circle cx="19.5" cy="4.5" r="2"/><circle cx="4.5" cy="19.5" r="2"/><circle cx="19.5" cy="19.5" r="2"/><line x1="6.2" y1="6.2" x2="10.2" y2="10.2"/><line x1="13.8" y1="10.2" x2="17.8" y2="6.2"/><line x1="10.2" y1="13.8" x2="6.2" y2="17.8"/><line x1="13.8" y1="13.8" x2="17.8" y2="17.8"/>',
  // Package — 3D box, isometric feel
  package:  '<path d="M21 7.5L12 3 3 7.5"/><path d="M3 7.5v9L12 21l9-4.5v-9"/><line x1="12" y1="12" x2="12" y2="21"/><line x1="12" y1="12" x2="3" y2="7.5"/><line x1="12" y1="12" x2="21" y2="7.5"/>',
  // Zap — lightning bolt, slightly more aggressive angle
  zap:      '<path d="M13 2 4 13.5h7L11 22l9-11.5h-7L13 2z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>',
  // Ban — circle with cross-out diagonal, thicker
  ban:      '<circle cx="12" cy="12" r="9.5"/><line x1="5.5" y1="5.5" x2="18.5" y2="18.5"/>',
  // Globe — equator + meridian + tilted curve
  globe:    '<circle cx="12" cy="12" r="9.5"/><ellipse cx="12" cy="12" rx="4" ry="9.5"/><line x1="2.5" y1="12" x2="21.5" y2="12"/>',
  // Rotate — arrow curving back to start
  rotate:   '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/>',
  // Trophy — cup with handles + base
  trophy:   '<path d="M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M7 6.5H4.5a2 2 0 0 0 0 4H7"/><path d="M17 6.5h2.5a2 2 0 0 1 0 4H17"/><line x1="12" y1="15" x2="12" y2="18"/><line x1="8" y1="20.5" x2="16" y2="20.5"/><line x1="9" y1="18" x2="15" y2="18"/>',
  // Folder — angled tab folder, more defined corners
  folder:   '<path d="M3 6.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  // Play — rounded triangle (less sharp)
  play:     '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke-linejoin="round"/>',
  // Pause — two thick bars
  pause:    '<rect x="6" y="4.5" width="4" height="15" rx="0.5" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="0.5" fill="currentColor" stroke="none"/>',
  // Settings — gear with 8 teeth, cleaner than Lucide's 16-point monstrosity
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/>',

  // ---------- Function panel headers ----------
  // Skull — Throttlr's signature horror icon, slightly more menacing
  skull:    '<path d="M12 2.5c-4.7 0-8.5 3.5-8.5 8 0 2.5 1.2 4.7 3 6v3.5c0 .8.7 1.5 1.5 1.5h8c.8 0 1.5-.7 1.5-1.5V16.5c1.8-1.3 3-3.5 3-6 0-4.5-3.8-8-8.5-8z"/><circle cx="9" cy="11" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1.4" fill="currentColor" stroke="none"/><path d="M11 16h2"/>',
  // Snowflake — 6-arm with tick marks (more snowflake-y)
  snowflake:'<line x1="12" y1="2.5" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="21.5" y2="12"/><line x1="5.2" y1="5.2" x2="18.8" y2="18.8"/><line x1="18.8" y1="5.2" x2="5.2" y2="18.8"/><polyline points="9 4 12 7 15 4"/><polyline points="9 20 12 17 15 20"/><polyline points="4 9 7 12 4 15"/><polyline points="20 9 17 12 20 15"/>',
  // Snail — shell spiral + body, friendlier
  snail:    '<circle cx="14" cy="13" r="6"/><circle cx="14" cy="13" r="2.8"/><path d="M8 19a6 6 0 0 1-6-6"/><line x1="2" y1="13" x2="2" y2="19.5"/><line x1="2" y1="19.5" x2="14" y2="19.5"/><line x1="3" y1="9" x2="3" y2="6"/><line x1="3" y1="6" x2="2" y2="5"/>',
  // Phone — handset receiver, tilted
  phone:    '<path d="M21 16.5v3.5a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 4.2 2 2 0 0 1 3 2h3.5a2 2 0 0 1 2 1.7c.2 1.2.5 2.3.9 3.4a2 2 0 0 1-.5 2.1L7.5 10.5a16 16 0 0 0 6 6l1.3-1.4a2 2 0 0 1 2.1-.5c1.1.4 2.2.7 3.4.9A2 2 0 0 1 21 16.5z"/>',

  // ---------- Signal bars (3-bar style) ----------
  signalLow:    '<rect x="3"  y="17" width="3.5" height="5"  rx="0.4" fill="currentColor" stroke="none"/><rect x="9"  y="13" width="3.5" height="9"  rx="0.4" opacity="0.25" fill="currentColor" stroke="none"/><rect x="15" y="7"  width="3.5" height="15" rx="0.4" opacity="0.25" fill="currentColor" stroke="none"/>',
  signalMid:    '<rect x="3"  y="17" width="3.5" height="5"  rx="0.4" fill="currentColor" stroke="none"/><rect x="9"  y="13" width="3.5" height="9"  rx="0.4" fill="currentColor" stroke="none"/><rect x="15" y="7"  width="3.5" height="15" rx="0.4" opacity="0.25" fill="currentColor" stroke="none"/>',
  signalHigh:   '<rect x="3"  y="17" width="3.5" height="5"  rx="0.4" fill="currentColor" stroke="none"/><rect x="9"  y="13" width="3.5" height="9"  rx="0.4" fill="currentColor" stroke="none"/><rect x="15" y="7"  width="3.5" height="15" rx="0.4" fill="currentColor" stroke="none"/>',

  // ---------- Misc ----------
  // Satellite — dish with signal waves (much cleaner than Lucide)
  satellite:'<path d="M5 14.5c-1.5-1.5-1.5-4 0-5.5l4-4c1.5-1.5 4-1.5 5.5 0l4 4c1.5 1.5 1.5 4 0 5.5l-2 2"/><path d="M11 11l5 5"/><path d="M3 21a8 8 0 0 1 8-8"/><path d="M3 21a4 4 0 0 1 4-4"/>',
  // Undo / Redo — curved arrow returning, mirror pair
  undo:     '<polyline points="3 8 8 8 8 3"/><path d="M3 8a9 9 0 1 1 3 6.7"/>',
  redo:     '<polyline points="21 8 16 8 16 3"/><path d="M21 8a9 9 0 1 0-3 6.7"/>',
};

function iconSvg(name) {
  const body = ICONS[name];
  if (!body) return '';
  // CSS (.icon svg in style.css) sets fill:none, stroke:currentColor,
  // stroke-width:2.4, round caps + joins. Per-element overrides like
  // fill="currentColor" stroke="none" still work for solid icons like
  // record/play/pause/zap because attribute inheritance is per-child.
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
}

function renderIcons(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-icon]:empty, [data-icon][data-icon-needs-render]').forEach(el => {
    const name = el.getAttribute('data-icon');
    el.innerHTML = iconSvg(name);
    el.removeAttribute('data-icon-needs-render');
  });
}

// Snapshot of settings taken when Settings modal opens. Used to revert
// any live-applied previews on Cancel.
let _origSettings = null;

// Customize tab — user-edited layout for the overlay (custom mode)
let _draftLayout = [];

const ROW_LABELS = {
  status_row:      'Status row',
  status_row_kbps: 'Status row + KB/s',
  app_row:         'App name row',
  stats3:          'Stats (3 cells)',
  stats4:          'Stats (4 cells)',
  kbps_row:        'KB/s rate row',
  volume_row:      'Volume row',
  funcs_row:       'Functions chip row',
};

// ============== LOADER ==============
const LOADER_STAGES = [
  { label: "Initializing…",        pct: 22, delay: 350 },
  { label: "Mounting driver…",     pct: 48, delay: 380 },
  { label: "Connecting bridge…",   pct: 72, delay: 360 },
  { label: "Loading interface…",   pct: 94, delay: 320 },
  { label: "Ready",                pct:100, delay: 280 },
];

function runLoader(onComplete) {
  const stage = document.getElementById('loader-stage');
  const pctEl = document.getElementById('loader-pct');
  const fill  = document.getElementById('loader-fill');
  const hexEl = document.getElementById('loader-hex');
  const checks = Array.from(document.querySelectorAll('.ldr-check'));

  // Cycle the corner-readout hex value to feel like the boot is churning data
  const hexChars = '0123456789ABCDEF';
  const randHex = () => Array.from({length:4}, () =>
    hexChars[Math.floor(Math.random() * 16)]).join('');
  let hexInterval = null;
  if (hexEl) {
    hexInterval = setInterval(() => { hexEl.textContent = randHex(); }, 110);
  }

  let i = 0;
  function step() {
    if (i >= LOADER_STAGES.length) {
      // Final flush: ensure all checks done + small hold before fading out
      checks.forEach(c => c.classList.add('done'));
      if (hexInterval) {
        // Lock in a final-looking hex
        clearInterval(hexInterval);
        if (hexEl) hexEl.textContent = 'C400';
      }
      setTimeout(onComplete, 380);
      return;
    }
    const s = LOADER_STAGES[i++];
    stage.textContent = s.label;
    pctEl.textContent = s.pct + "%";
    fill.style.width = s.pct + "%";
    // Light up any check whose threshold this percentage now crosses
    for (const c of checks) {
      const threshold = parseInt(c.dataset.checkPct, 10) || 0;
      if (s.pct >= threshold) c.classList.add('done');
    }
    setTimeout(step, s.delay);
  }
  step();
}

function fadeOutLoader() {
  const el = document.getElementById('loader');
  if (!el) return;
  el.classList.add('fade-out');
  setTimeout(() => el.remove(), 700);
}

// ============== Bridge init ==============
new QWebChannel(qt.webChannelTransport, (channel) => {
  bridge = channel.objects.bridge;
  runLoader(() => { init(); fadeOutLoader(); });
});

function init() {
  bridge.statsChanged.connect(onStatsChanged);
  bridge.statusChanged.connect(onStatusChanged);
  bridge.hotkeyFired.connect(onHotkeyFired);
  bridge.errorMessage.connect((msg) => toast(msg, 'error'));
  bridge.appsRefreshed.connect((json) => {
    appsCache = JSON.parse(json);
    if (!document.getElementById('app-picker-modal').hidden) renderAppPicker();
  });

  bridge.getApps().then((json) => { appsCache = JSON.parse(json); });

  bridge.getSettings().then((json) => {
    const s = JSON.parse(json);
    appSettings = s || {};
    window._currentSettings = s || {};   // v3.0.5 — used by theme customization
    applyTheme(s.theme || "lethal");
    populateHotkeys(s);
    updateHotkeyChips(s);
    applyAppearance(s);
    _hotkeyNotifications = s.hotkey_notifications !== false;
    _toastDurationMs = s.toast_duration_ms || 3500;
    // Apply Phase 1 settings
    if (s.midnight_custom_color) applyMidnightCustomCss(s.midnight_custom_color);
    refreshAchievementsCache();
    refreshRecentApps();
  });

  bridge.isAdmin().then((admin) => {
    const badge = document.getElementById('admin-badge');
    const text = document.getElementById('admin-text');
    if (!admin) {
      badge.classList.add('no-admin');
      text.textContent = "No admin (restricted)";
    }
  });

  setupTitlebar();
  setupResizeEdges();
  setupAppChooser();
  setupFunctions();
  setupStartButton();
  setupModals();
  setupFreezeClear();
  setupCustomThemes();   // v3.0.5 — load installed custom themes + wire up buttons

  // Phase 1 module setups
  setupQuickPresets();
  setupSoundEffects();
  setupCustomAccent();
  setupOverlayPhase1Toggles();
  setupPerAppPrompt();
  setupAchievementsModal();
  setupMultiTarget();
  setupDragDrop();

  // Phase 2 module setups
  setupInspector();
  setupPracticePing();
  setupRecording();
  setupDomainBlock();
  setupGeoBlock();
  // Initial summaries (so UI reflects backend state on first load)
  updateDomainBlockSummary();
  updateGeoBlockSummary();

  // Phase 3 module setups
  setupTopology();
  setupPcap();
  setupFilterScript();

  // Onboarding — first-launch tutorial, update log on version change
  setupTutorial();
  setupChangelog();
  setupUpdateModal();

  // Render all SVG icons declared via data-icon throughout the markup
  renderIcons();

  pushConfig();

  // Run onboarding flow last — after all setups complete, after icons
  // render, after splash transition. Decides between tutorial / changelog
  // / nothing based on what the backend reports.
  runOnboarding();

  // Auto-update — check GitHub release status and prompt if needed.
  // Runs in parallel with onboarding; the modal shows itself only AFTER
  // any tutorial/changelog has been dismissed (via re-checking 1.5s later).
  setTimeout(checkForUpdatePrompt, 1500);
}

// ============== TITLE BAR ==============
function setupTitlebar() {
  const drag = document.getElementById('titlebar-drag');
  drag.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.titlebar-controls')) return;
    bridge.startDragWindow();
  });
  drag.addEventListener('dblclick', () => bridge.toggleMaximizeWindow());
  document.getElementById('tbtn-min').addEventListener('click', () => bridge.minimizeWindow());
  document.getElementById('tbtn-max').addEventListener('click', () => bridge.toggleMaximizeWindow());
  document.getElementById('tbtn-close').addEventListener('click', () => bridge.closeWindow());
}

function setupResizeEdges() {
  document.querySelectorAll('.resize-edge').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      bridge.startResizeWindow(el.dataset.edges);
    });
  });
}

// ============== STATS ==============
const _lastStats = {};
function setStat(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const newText = (typeof value === 'number') ? value.toLocaleString() : String(value);
  if (el.textContent !== newText) {
    el.textContent = newText;
    if (_lastStats[id] !== undefined && value > _lastStats[id]) {
      el.classList.remove('stat-pop');
      void el.offsetWidth;
      el.classList.add('stat-pop');
    }
  }
  _lastStats[id] = value;
}

function onStatsChanged(jsonStr) {
  let s; try { s = JSON.parse(jsonStr); } catch { return; }
  setStat('stat-seen', s.seen);
  setStat('stat-dropped', s.dropped);
  setStat('stat-delayed', s.delayed);
  setStat('stat-held', s.held);
  document.getElementById('stat-bytes').textContent = (s.bytes / 1024).toFixed(1);

  setStat('mini-seen', s.seen);
  setStat('mini-dropped', s.dropped);
  setStat('mini-delayed', s.delayed);
  setStat('mini-held', s.held);

  // Replay state: freeze off, queue still draining. Make it visible —
  // this is the moment the user wants to see (packets flowing back out).
  const replaying = !!s.replaying;
  document.body.classList.toggle('is-replaying', replaying);
  const replayBadge = document.getElementById('replay-badge');
  const replayCount = document.getElementById('replay-count');
  if (replayBadge && replayCount) {
    if (replaying) {
      replayBadge.hidden = false;
      replayCount.textContent = (s.held || 0).toLocaleString();
    } else {
      replayBadge.hidden = true;
    }
  }
  // Dedicated freeze module subtitle when replay is in progress
  const freezeSub = document.getElementById('freeze-replay-sub');
  if (freezeSub) {
    if (replaying) {
      freezeSub.hidden = false;
      freezeSub.textContent = `▶ Replaying — ${(s.held || 0).toLocaleString()} packets remaining`;
    } else {
      freezeSub.hidden = true;
    }
  }

  bwIn = s.bw_in || [];
  bwOut = s.bw_out || [];
  const lastIn = bwIn.length ? bwIn[bwIn.length-1] : 0;
  const lastOut = bwOut.length ? bwOut[bwOut.length-1] : 0;
  document.getElementById('rate-display').textContent = `${((lastIn+lastOut)/1024).toFixed(1)} KB/s`;

  if (s.running !== isRunning) { isRunning = s.running; updateStartButtonUI(); }
  drawTrafficGraph();

  // Phase 1: check achievements every stats tick
  try { checkAchievementsFromStats(s); } catch (e) { /* swallow */ }
}

function onStatusChanged(status) {
  const dot = document.getElementById('ab-status-dot');
  const tdot = document.getElementById('tb-status-dot');
  const ttext = document.getElementById('tb-status-text');
  const line = document.getElementById('ab-status-line');
  const sub = document.getElementById('ab-status-sub');
  if (status === 'running') {
    dot.classList.add('running');
    tdot.classList.add('running');
    ttext.textContent = "Running";
    line.textContent = "Running";
    sub.textContent = `Throttling ${currentApp || "selected app"}`;
  } else {
    dot.classList.remove('running');
    tdot.classList.remove('running');
    ttext.textContent = "Idle";
    line.textContent = "Stopped";
    sub.textContent = "Pick an app and enable a function";
    // When capture stops, remember the config for this app — so next time
    // the user picks it, they can be offered the chance to restore it.
    autoSaveCurrentAppPreset();
  }
}

function onHotkeyFired(which) {
  const labels = {
    startstop: 'Start / Stop',
    freeze: 'Freeze',
    block: 'Block',
    fun: 'Fun',
    killswitch: 'Killswitch',
  };
  if (which === 'startstop') {
    if (isRunning) bridge.stopCapture(); else handleStartClick();
  } else if (which === 'freeze' || which === 'block' || which === 'fun') {
    const cb = document.querySelector(`[data-key="${which}_on"]`);
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
  } else if (which === 'killswitch') {
    // Disable ALL six function toggles instantly
    ['lag_on', 'drop_on', 'throttle_on', 'freeze_on', 'block_on', 'fun_on'].forEach(key => {
      const cb = document.querySelector(`[data-key="${key}"]`);
      if (cb && cb.checked) {
        cb.checked = false;
        cb.dispatchEvent(new Event('change'));
      }
    });
    toast('Killswitch — all functions disabled', 'success');
    return;   // skip the generic "hotkey fired" toast below
  }
  if (_hotkeyNotifications && labels[which]) toast(`${labels[which]} hotkey fired`, 'success');
}

// ============== APP CHOOSER ==============
function setupAppChooser() {
  document.getElementById('app-chooser-btn').addEventListener('click', openAppPicker);
  document.querySelectorAll('[data-ap-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      apFilter = btn.dataset.apFilter;
      document.querySelectorAll('[data-ap-filter]').forEach(b =>
        b.classList.toggle('active', b === btn));
      renderAppPicker();
    });
  });
  document.getElementById('ap-search').addEventListener('input', renderAppPicker);
}

function openAppPicker() {
  bridge.getApps().then((json) => {
    appsCache = JSON.parse(json);
    const hasOpen = appsCache.some(a => a.has_window);
    if (!hasOpen && apFilter === "open") {
      apFilter = "all";
      document.querySelectorAll('[data-ap-filter]').forEach(b =>
        b.classList.toggle('active', b.dataset.apFilter === apFilter));
    }
    document.getElementById('ap-search').value = '';
    showModal('app-picker-modal');
    setTimeout(() => document.getElementById('ap-search').focus(), 80);
    renderAppPicker();
  });
}

function renderAppPicker() {
  const filter = document.getElementById('ap-search').value.toLowerCase();
  const list = document.getElementById('ap-list');
  let apps = appsCache.slice();
  if (apFilter === "open")        apps = apps.filter(a => a.has_window);
  else if (apFilter === "background") apps = apps.filter(a => !a.has_window);
  if (filter) apps = apps.filter(a => a.name.toLowerCase().includes(filter));

  document.getElementById('ap-count').textContent =
    `${apps.length} ${apps.length === 1 ? 'process' : 'processes'}`;

  list.innerHTML = '';
  if (apps.length === 0) {
    let msg = "No matching processes";
    if (apFilter === "open" && !filter) msg = "No open apps detected — try the Background or All tab";
    list.innerHTML = `<div class="loading">${msg}</div>`;
    return;
  }

  for (const app of apps) {
    const div = document.createElement('div');
    div.className = 'app-item';
    if (app.name === currentApp) div.classList.add('selected');
    const tag = app.has_window
      ? '<span class="app-tag">OPEN</span>'
      : '<span class="app-tag bg">BG</span>';
    div.innerHTML = `
      <div class="app-name-wrap">
        <span class="app-name">${tag}${escapeHTML(app.name)}</span>
      </div>
      <span class="app-meta">
        <span>${app.instances} inst</span>
        <span>${app.conns} conn</span>
      </span>`;
    div.addEventListener('click', () => { selectApp(app.name); hideModal('app-picker-modal'); });
    list.appendChild(div);
  }
}

// ============== APP TARGETING ==============
let currentApps = [];           // multi-target: list of app names (1+ apps)
let multiTargetMode = false;
let appSettings = {};           // cached settings (loaded once on startup)

function selectApp(name) {
  if (!name) return;
  if (multiTargetMode) {
    // Add to the list if not already present
    if (!currentApps.includes(name)) {
      currentApps.push(name);
    }
    currentApp = currentApps[0] || "";
    pushTargetApps();
    renderMultiTargetChips();
    bridge.addRecentApp(name);
    refreshRecentApps();
    return;
  }

  // Auto-save the OUTGOING app's config before switching, so when you
  // come back to it later, the popup can offer to restore exactly what
  // you were doing. This is the whole point of per-app memory — it has
  // to happen automatically, not via a manual button.
  if (currentApp && currentApp !== name) {
    autoSaveCurrentAppPreset();
  }

  // Single target mode
  currentApp = name;
  currentApps = [name];
  bridge.setTargetApp(name);
  bridge.addRecentApp(name);
  refreshRecentApps();
  const btn = document.getElementById('app-chooser-btn');
  btn.classList.add('has-app');
  document.getElementById('acb-label').textContent = "Selected app";
  document.getElementById('acb-value').textContent = name;
  const ts = document.getElementById('target-status');
  if (ts) ts.textContent = `Selected: ${name}`;
  // Achievement: targeting Discord
  if (name.toLowerCase() === 'discord.exe') {
    bridge.unlockAchievement('discord_disrupter');
    showAchievementToast('discord_disrupter');
  }
  // Per-app preset prompt
  maybePromptPerAppPreset(name);
}

function pushTargetApps() {
  // For multi-target mode, push the full list to the bridge
  bridge.setTargetApps(JSON.stringify(currentApps));
  // Update the chooser display
  const btn = document.getElementById('app-chooser-btn');
  btn.classList.add('has-app');
  if (currentApps.length === 0) {
    btn.classList.remove('has-app');
    document.getElementById('acb-label').textContent = "No apps selected";
    document.getElementById('acb-value').textContent = "Click + Add app to add more";
  } else if (currentApps.length === 1) {
    document.getElementById('acb-label').textContent = "Selected app";
    document.getElementById('acb-value').textContent = currentApps[0];
  } else {
    document.getElementById('acb-label').textContent = `Selected (${currentApps.length} apps)`;
    document.getElementById('acb-value').textContent = currentApps.slice(0, 3).join(' + ') +
      (currentApps.length > 3 ? ` + ${currentApps.length - 3} more` : '');
  }
  const ts = document.getElementById('target-status');
  if (ts) ts.textContent = currentApps.length > 1
    ? `${currentApps.length} apps targeted`
    : (currentApps[0] ? `Selected: ${currentApps[0]}` : '');
}

function renderMultiTargetChips() {
  const container = document.getElementById('mtl-chips');
  if (!container) return;
  container.innerHTML = '';
  currentApps.forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'mtl-chip';
    chip.innerHTML = `<span>${escapeHtml(name)}</span><span class="x" title="Remove">×</span>`;
    chip.querySelector('.x').addEventListener('click', () => {
      currentApps = currentApps.filter(a => a !== name);
      currentApp = currentApps[0] || "";
      pushTargetApps();
      renderMultiTargetChips();
    });
    container.appendChild(chip);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function setupMultiTarget() {
  const btn = document.getElementById('multi-target-btn');
  const list = document.getElementById('multi-target-list');
  const addBtn = document.getElementById('mtl-add-btn');
  if (!btn || !list || !addBtn) return;

  btn.addEventListener('click', () => {
    multiTargetMode = !multiTargetMode;
    btn.classList.toggle('active', multiTargetMode);
    list.hidden = !multiTargetMode;
    if (multiTargetMode) {
      // If we already have a single app selected, seed the multi-list with it
      if (currentApp && currentApps.length === 0) currentApps = [currentApp];
      pushTargetApps();
      renderMultiTargetChips();
      bridge.unlockAchievement('multi_tasker');
      showAchievementToast('multi_tasker');
    } else {
      // Collapse back to first app only
      if (currentApps.length > 0) {
        const first = currentApps[0];
        currentApps = [first];
        currentApp = first;
        bridge.setTargetApp(first);
      }
    }
  });

  addBtn.addEventListener('click', () => {
    document.getElementById('app-picker-modal').hidden = false;
  });
}

// ============== RECENT APPS ==============
function refreshRecentApps() {
  try {
    bridge.getRecentApps().then((raw) => {
      try {
        const list = JSON.parse(raw || '[]');
        const bar = document.getElementById('recent-apps-bar');
        const chips = document.getElementById('rab-chips');
        if (!bar || !chips) return;
        chips.innerHTML = '';
        if (!list.length) {
          bar.hidden = true;
          return;
        }
        bar.hidden = false;
        list.slice(0, 8).forEach(name => {
          const chip = document.createElement('button');
          chip.className = 'rab-chip';
          chip.textContent = name;
          chip.addEventListener('click', () => selectApp(name));
          chips.appendChild(chip);
        });
      } catch (e) { /* swallow */ }
    });
  } catch (e) { /* swallow */ }
}

// ============== DRAG-AND-DROP .EXE TARGETING ==============
function setupDragDrop() {
  const target = document.body;
  let dragging = false;
  target.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragging) {
      dragging = true;
      target.classList.add('dnd-active');
    }
  });
  target.addEventListener('dragleave', (e) => {
    if (e.target === target || !target.contains(e.relatedTarget)) {
      dragging = false;
      target.classList.remove('dnd-active');
    }
  });
  target.addEventListener('drop', (e) => {
    e.preventDefault();
    dragging = false;
    target.classList.remove('dnd-active');
    if (!e.dataTransfer || !e.dataTransfer.files) return;
    for (const f of e.dataTransfer.files) {
      if (f.name && f.name.toLowerCase().endsWith('.exe')) {
        selectApp(f.name);
        toast(`Targeted ${f.name}`, 'success');
        return;
      }
    }
    toast('Drop an .exe to target it', 'error');
  });
}

// ============== FUNCTIONS ==============
function setupFunctions() {
  document.querySelectorAll('.toggle-input').forEach(input => {
    input.addEventListener('change', () => {
      const card = input.closest('.func-mod');
      card.classList.toggle('active', input.checked);
      pushConfig();
      const k = input.dataset.key;
      if (k === 'freeze_on') bridge.toggleFreeze(input.checked);
      else if (k === 'block_on') bridge.toggleBlock(input.checked);
      else if (k === 'fun_on') bridge.toggleFun(input.checked);
    });
  });
  document.querySelectorAll('.func-mod .dir-check input').forEach(i =>
    i.addEventListener('change', pushConfig));
  document.querySelectorAll('.func-mod .param-input').forEach(i => {
    i.addEventListener('change', pushConfig);
    i.addEventListener('blur', pushConfig);
  });
  document.querySelectorAll('.func-mod .slider-input').forEach(i => {
    if (i.dataset.key !== 'fun_intensity') return;
    const display = document.getElementById('fun-intensity-display');
    i.addEventListener('input', () => {
      if (display) display.textContent = `${i.value}%`;
      pushConfig();
    });
  });
}

function pushConfig() {
  const cfg = {};
  document.querySelectorAll('.func-mod [data-key]').forEach(el => {
    const k = el.dataset.key;
    if (el.type === 'checkbox') cfg[k] = el.checked;
    else if (el.type === 'number' || el.type === 'range') cfg[k] = parseInt(el.value, 10) || 0;
    else if (el.tagName === 'SELECT') cfg[k] = parseInt(el.value, 10) || 0;
    else cfg[k] = el.value;
  });
  bridge.updateConfig(JSON.stringify(cfg));
}

// ============== START BUTTON ==============
function setupStartButton() {
  const btn = document.getElementById('start-btn');
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handleStartClick(); });
}

function handleStartClick() {
  if (!currentApp) {
    toast("Pick an app first — click 'choose application' above", 'error');
    const tp = document.querySelector('.target-panel');
    if (tp) {
      tp.style.borderColor = 'var(--blood)';
      tp.style.boxShadow = '0 0 24px rgba(196,30,58,0.5)';
      setTimeout(() => { tp.style.borderColor = ''; tp.style.boxShadow = ''; }, 1500);
    }
    return;
  }
  if (isRunning) bridge.stopCapture(); else bridge.startCapture();
}

function updateStartButtonUI() {
  const btn = document.getElementById('start-btn');
  const arr = btn.querySelector('.sb-arrow');
  const txt = btn.querySelector('.sb-text');
  if (isRunning) { btn.classList.add('running'); arr.textContent = '■'; txt.textContent = 'Stop'; }
  else           { btn.classList.remove('running'); arr.textContent = '▶'; txt.textContent = 'Start'; }
}

// ============== HOTKEY CHIPS ==============
function updateHotkeyChips(s) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('fm-key-freeze', s.hotkey_freeze || 'F8');
  set('fm-key-block',  s.hotkey_block  || 'F9');
  set('fm-key-fun',    s.hotkey_fun    || 'F10');
  set('hk-hint-startstop', s.hotkey_startstop || 'F5');
  set('hk-hint-freeze',    s.hotkey_freeze    || 'F8');
  set('hk-hint-block',     s.hotkey_block     || 'F9');
  set('hk-hint-fun',       s.hotkey_fun       || 'F10');
  set('sb-key-display',    s.hotkey_startstop || 'F5');
}

// ============== APPEARANCE / LIVE PREVIEW ==============
function applyAppearance(s) {
  document.body.dataset.compact = s.compact_mode ? "true" : "false";
  document.body.dataset.crt = (s.crt_effects === false) ? "off" : "on";
  // v3.0.5 fix — if a custom theme is currently active, don't overwrite
  // dataset.design (the custom theme manages it). This prevents a flash
  // back to "industrial" briefly when this fn runs from settings save.
  if (!window._activeCustomThemeId) {
    document.body.dataset.design = s.ui_design || "industrial";
  }
  document.body.dataset.midnightAccent = s.midnight_accent || "aurora";
  document.querySelectorAll('.design-tile').forEach(t =>
    t.classList.toggle('active',
      !t.classList.contains('custom-theme')
      && !window._activeCustomThemeId
      && t.dataset.design === (s.ui_design || "industrial")));
  document.querySelectorAll('.midnight-tile').forEach(t =>
    t.classList.toggle('active', t.dataset.midnightAccent === (s.midnight_accent || "aurora")));
}

function applyDesign(name) {
  // v3.0.5 — picking a built-in design clears any active custom theme +
  // removes the injected CSS. Custom-theme tiles call applyCustomTheme()
  // which routes through this function for the base, then layers custom on top.
  document.body.dataset.design = name;
  document.body.dataset.customTheme = "";
  _removeCustomThemeCss();
  _removeThemeCustomizeOverrides();
  _hideThemeCustomizeUI();
  document.querySelectorAll('.design-tile').forEach(t =>
    t.classList.toggle('active', !t.classList.contains('custom-theme')
                              && t.dataset.design === name));
  document.querySelectorAll('.design-tile.custom-theme').forEach(t =>
    t.classList.remove('active'));
  if (window._activeCustomThemeId !== null) {
    window._activeCustomThemeId = null;
  }
}

// ============== CUSTOM THEMES (v3.0.5) ==============
// Manifest pairs (.json + .css) live in %USERPROFILE%/.throttlr/themes/.
// On boot we fetch the list, render tiles next to the built-in designs,
// and apply whichever one was previously active.

window._installedCustomThemes = [];     // array of manifests from the bridge
window._activeCustomThemeId = null;     // id of the currently-applied custom theme

const CUSTOM_THEME_STYLE_ID = "custom-theme-css";

function _removeCustomThemeCss() {
  const existing = document.getElementById(CUSTOM_THEME_STYLE_ID);
  if (existing) existing.remove();
}

function _injectCustomThemeCss(cssText) {
  _removeCustomThemeCss();
  const el = document.createElement('style');
  el.id = CUSTOM_THEME_STYLE_ID;
  el.textContent = cssText;
  // Append to the END of <head> so its rules win the cascade against the
  // base theme's rules (same-specificity selectors, later wins).
  document.head.appendChild(el);
}

async function loadInstalledCustomThemes() {
  // Pull from bridge, populate the in-memory list, render the tiles
  try {
    const raw = await bridge.listInstalledThemes();
    window._installedCustomThemes = JSON.parse(raw) || [];
  } catch (e) {
    window._installedCustomThemes = [];
  }
  renderCustomThemeTiles();
}

function renderCustomThemeTiles() {
  const grid = document.getElementById('custom-themes-grid');
  const empty = document.getElementById('custom-themes-empty');
  if (!grid) return;

  const themes = window._installedCustomThemes;
  // Clear all existing custom-theme tiles (but keep the empty-state element)
  grid.querySelectorAll('.design-tile.custom-theme').forEach(el => el.remove());

  if (!themes.length) {
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  for (const t of themes) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'design-tile custom-theme';
    tile.dataset.customThemeId = t.id || '';
    tile.dataset.customThemeBase = t.base || 'industrial';
    tile.dataset.customThemeCss = t._css_filename || '';

    const preview = t.preview || {};
    const bg     = preview.bg     || '#14140e';
    const accent = preview.accent || '#ffb800';
    const accent2 = preview.accent2 || accent;
    const font   = preview.font   || 'Big Shoulders Stencil Display';

    // Mark missing CSS so user knows to also drop the .css file in
    const isBroken = !t._css_exists;

    tile.innerHTML = `
      <div class="design-preview design-preview-custom"
           data-name="${escapeHtml(t.name || 'Untitled')}"
           style="--ct-bg:${escapeHtml(bg)};
                  --ct-accent:${escapeHtml(accent)};
                  --ct-accent2:${escapeHtml(accent2)};
                  --ct-font:'${escapeHtml(font)}',sans-serif;"></div>
      <div class="design-label">
        <span class="design-name">${escapeHtml(t.name || 'Untitled')}${isBroken ? ' ⚠' : ''}</span>
        <span class="design-sub">${escapeHtml(t.author || 'unknown')}${
          isBroken ? ' · missing .css' : (t.description ? ' · ' + escapeHtml(t.description.slice(0, 50)) : '')
        }</span>
      </div>
    `;
    tile.addEventListener('click', () => {
      if (isBroken) {
        toast(`Theme "${t.name}" is missing its .css file — drop it in the themes folder and click Rescan`, 'error');
        return;
      }
      applyCustomTheme(t.id);
    });
    grid.appendChild(tile);
  }
}

async function applyCustomTheme(themeId) {
  const t = (window._installedCustomThemes || []).find(x => x.id === themeId);
  if (!t) {
    toast(`Theme "${themeId}" not found — try Rescan`, 'error');
    return;
  }
  if (!t._css_exists) {
    toast(`Theme "${t.name}" is missing its .css file`, 'error');
    return;
  }

  // Fetch the CSS content from disk via the bridge
  let cssText = '';
  try {
    cssText = await bridge.loadThemeCss(t._css_filename);
  } catch (e) {
    toast(`Couldn't load theme CSS: ${e}`, 'error');
    return;
  }
  if (!cssText) {
    toast(`Theme CSS file is empty or unreadable`, 'error');
    return;
  }

  // Set the base design first (foundation), then layer custom on top
  document.body.dataset.design = t.base || 'industrial';
  document.body.dataset.customTheme = t.id;
  _injectCustomThemeCss(cssText);

  // v3.0.5 — render the per-theme customization UI + apply any saved
  // user color overrides as a second injected <style> tag.
  renderThemeCustomization(t);
  _applyThemeCustomizationOverrides(t.id);

  // Update tile-active state — clear built-ins, set this custom one
  document.querySelectorAll('.design-tile').forEach(el =>
    el.classList.remove('active'));
  document.querySelectorAll('.design-tile.custom-theme').forEach(el =>
    el.classList.toggle('active', el.dataset.customThemeId === t.id));

  window._activeCustomThemeId = t.id;

  // v3.0.6 — also live-preview the floating overlay so it updates the
  // moment a theme tile is clicked, not only after Save. The overlay is
  // a Qt widget on the Python side, so we hop over the bridge.
  try {
    if (typeof bridge !== 'undefined' && bridge.previewOverlayTheme) {
      const customs = (window._currentSettings && window._currentSettings.theme_customizations &&
                       window._currentSettings.theme_customizations[t.id]) || {};
      bridge.previewOverlayTheme(t.id, JSON.stringify(customs));
    }
  } catch (e) { /* preview is best-effort, never fatal */ }
}

// ============== THEME CUSTOMIZATION (v3.0.5) ==============
// Custom themes can declare a `customizable` array in their manifest:
//   [{ key, label, type: "color"|"gradient", default, ...}]
// Users get color pickers in Settings → Appearance to override these.
// Overrides are injected as CSS variables in a separate <style> tag so
// the theme's own CSS can pick them up via `var(--theme-u-<key>, default)`.
// Persists across sessions via the `theme_customizations` setting.

const CUSTOM_THEME_OVERRIDE_STYLE_ID = "custom-theme-overrides";
let _themeCustomizeSaveTimer = null;

function _removeThemeCustomizeOverrides() {
  const el = document.getElementById(CUSTOM_THEME_OVERRIDE_STYLE_ID);
  if (el) el.remove();
}

function _hideThemeCustomizeUI() {
  const sec = document.getElementById('theme-customize-section');
  if (sec) sec.style.display = 'none';
  const rows = document.getElementById('theme-customize-rows');
  if (rows) rows.innerHTML = '';
}

// Get the user's saved customizations for a theme (or {} if none)
function _getThemeCustomizations(themeId) {
  const all = (window._currentSettings && window._currentSettings.theme_customizations) || {};
  return (all && all[themeId]) || {};
}

// Save (debounced) — updates window._currentSettings + persists via bridge
function _saveThemeCustomization(themeId, key, value) {
  if (!window._currentSettings) window._currentSettings = {};
  if (!window._currentSettings.theme_customizations) window._currentSettings.theme_customizations = {};
  if (!window._currentSettings.theme_customizations[themeId]) window._currentSettings.theme_customizations[themeId] = {};
  window._currentSettings.theme_customizations[themeId][key] = value;

  // v3.0.6 — also live-preview the overlay so e.g. dragging the pink
  // picker in Retro updates the floating overlay's accent in real time.
  try {
    if (typeof bridge !== 'undefined' && bridge.previewOverlayTheme && window._activeCustomThemeId === themeId) {
      bridge.previewOverlayTheme(themeId, JSON.stringify(window._currentSettings.theme_customizations[themeId] || {}));
    }
  } catch (e) { /* preview is best-effort */ }

  // Debounce the save — drag events can fire many times per second
  if (_themeCustomizeSaveTimer) clearTimeout(_themeCustomizeSaveTimer);
  _themeCustomizeSaveTimer = setTimeout(() => {
    try {
      bridge.saveSettings(JSON.stringify({
        theme_customizations: window._currentSettings.theme_customizations
      }));
    } catch (e) {
      console.warn('Failed to save theme customization:', e);
    }
  }, 350);
}

// Build the CSS for the override <style> tag from the saved customizations.
// One `body[data-custom-theme="<id>"]` rule with all the override variables.
function _applyThemeCustomizationOverrides(themeId) {
  _removeThemeCustomizeOverrides();
  const t = (window._installedCustomThemes || []).find(x => x.id === themeId);
  if (!t || !Array.isArray(t.customizable) || !t.customizable.length) return;

  const saved = _getThemeCustomizations(themeId);
  const decls = [];

  for (const item of t.customizable) {
    if (!item || !item.key || !item.type) continue;
    const value = (saved[item.key] !== undefined) ? saved[item.key] : item.default;
    if (item.type === 'color') {
      decls.push(`  --theme-u-${item.key}: ${value};`);
    } else if (item.type === 'gradient' && Array.isArray(value)) {
      value.forEach((stop, i) => {
        decls.push(`  --theme-u-${item.key}-${i}: ${stop};`);
      });
    }
  }
  if (!decls.length) return;

  const css = `body[data-custom-theme="${themeId}"] {\n${decls.join('\n')}\n}`;
  const el = document.createElement('style');
  el.id = CUSTOM_THEME_OVERRIDE_STYLE_ID;
  el.textContent = css;
  // Append AFTER the theme's own CSS so the variables actually override
  // any defaults the theme set on the same selector.
  document.head.appendChild(el);
}

// Render the customize panel for a theme (called when applying a theme)
function renderThemeCustomization(theme) {
  const sec = document.getElementById('theme-customize-section');
  const rows = document.getElementById('theme-customize-rows');
  const title = document.getElementById('theme-customize-title');
  const resetBtn = document.getElementById('theme-customize-reset');
  if (!sec || !rows) return;

  if (!Array.isArray(theme.customizable) || !theme.customizable.length) {
    sec.style.display = 'none';
    rows.innerHTML = '';
    return;
  }

  if (title) title.textContent = `Customize ${theme.name || 'theme'}`;
  rows.innerHTML = '';
  sec.style.display = '';

  const saved = _getThemeCustomizations(theme.id);

  for (const item of theme.customizable) {
    if (!item || !item.key || !item.type) continue;
    const row = document.createElement('div');
    row.className = `theme-customize-row ${item.type}`;
    row.dataset.key = item.key;

    const label = document.createElement('div');
    label.className = 'theme-customize-row-label';
    label.textContent = item.label || item.key;
    row.appendChild(label);

    const controls = document.createElement('div');
    controls.className = 'theme-customize-row-controls';
    row.appendChild(controls);

    if (item.type === 'color') {
      const current = (saved[item.key] !== undefined) ? saved[item.key] : item.default;
      const ctrl = _makeColorControl(current, '', (newVal) => {
        _saveThemeCustomization(theme.id, item.key, newVal);
        _applyThemeCustomizationOverrides(theme.id);
      });
      controls.appendChild(ctrl);

    } else if (item.type === 'gradient') {
      const defaults = Array.isArray(item.default) ? item.default : [];
      const currentArr = Array.isArray(saved[item.key]) ? saved[item.key].slice() : defaults.slice();
      // Make sure the saved array is at least as long as defaults
      while (currentArr.length < defaults.length) currentArr.push(defaults[currentArr.length] || '#ffffff');
      const stopLabels = Array.isArray(item.stop_labels) ? item.stop_labels : [];

      const stopsWrap = document.createElement('div');
      stopsWrap.className = 'gradient-stops';
      controls.appendChild(stopsWrap);

      const preview = document.createElement('div');
      preview.className = 'gradient-preview';
      controls.appendChild(preview);

      const updatePreview = () => {
        if (currentArr.length === 1) {
          preview.style.background = currentArr[0];
        } else {
          const stops = currentArr.map((c, i) =>
            `${c} ${Math.round(100 * i / Math.max(1, currentArr.length - 1))}%`
          ).join(', ');
          preview.style.background = `linear-gradient(90deg, ${stops})`;
        }
      };
      updatePreview();

      currentArr.forEach((stopVal, idx) => {
        const stopBox = document.createElement('div');
        stopBox.className = 'gradient-stop';
        const stopLabel = stopLabels[idx] || `Stop ${idx + 1}`;
        const ctrl = _makeColorControl(stopVal, stopLabel, (newVal) => {
          currentArr[idx] = newVal;
          updatePreview();
          _saveThemeCustomization(theme.id, item.key, currentArr.slice());
          _applyThemeCustomizationOverrides(theme.id);
        });
        stopBox.appendChild(ctrl);
        stopsWrap.appendChild(stopBox);
      });
    }

    rows.appendChild(row);
  }

  // Reset button — clears all customizations for this theme
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (!window._currentSettings) window._currentSettings = {};
      if (!window._currentSettings.theme_customizations) window._currentSettings.theme_customizations = {};
      delete window._currentSettings.theme_customizations[theme.id];
      try {
        bridge.saveSettings(JSON.stringify({
          theme_customizations: window._currentSettings.theme_customizations
        }));
      } catch (e) {}
      // Re-render with defaults + re-apply overrides
      renderThemeCustomization(theme);
      _applyThemeCustomizationOverrides(theme.id);
      try { toast(`Reset ${theme.name} colors to defaults`, 'success'); } catch (e) {}
    };
  }
}

// Helper: build a color picker + hex input pair, wired to onChange
function _makeColorControl(initialValue, stopLabel, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'theme-color-control';

  if (stopLabel) {
    const lbl = document.createElement('span');
    lbl.className = 'stop-label';
    lbl.textContent = stopLabel;
    wrap.appendChild(lbl);
  }

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = _toHex6(initialValue);
  wrap.appendChild(colorInput);

  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.value = _toHex6(initialValue);
  hexInput.maxLength = 7;
  hexInput.spellcheck = false;
  wrap.appendChild(hexInput);

  // Color picker drag → update hex input + fire onChange
  colorInput.addEventListener('input', () => {
    hexInput.value = colorInput.value;
    onChange(colorInput.value);
  });

  // Hex text typing → validate, sync color input, fire onChange
  hexInput.addEventListener('input', () => {
    let v = hexInput.value.trim();
    if (v && !v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      colorInput.value = v.toLowerCase();
      onChange(v.toLowerCase());
    } else if (/^#[0-9a-fA-F]{3}$/.test(v)) {
      // Expand 3-char shorthand
      const expanded = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
      colorInput.value = expanded.toLowerCase();
      onChange(expanded.toLowerCase());
    }
  });
  hexInput.addEventListener('blur', () => {
    // On blur, normalize the displayed hex value
    hexInput.value = colorInput.value;
  });

  return wrap;
}

// Coerce any color string to #rrggbb (for the native color input)
function _toHex6(str) {
  if (!str) return '#ffffff';
  const s = String(str).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s[1]+s[1] + s[2]+s[2] + s[3]+s[3];
  // Try parsing rgb()/rgba() — strip alpha and convert
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return '#' + [m[1], m[2], m[3]].map(n => {
      const x = parseInt(n, 10).toString(16);
      return x.length === 1 ? '0' + x : x;
    }).join('');
  }
  return '#ffffff';
}

// Wire up the More themes / Open folder / Rescan buttons + lazy-load themes
function setupCustomThemes() {
  const galleryBtn = document.getElementById('open-themes-gallery-btn');
  const folderBtn  = document.getElementById('open-themes-folder-btn');
  const rescanBtn  = document.getElementById('rescan-themes-btn');

  if (galleryBtn) galleryBtn.addEventListener('click', () => {
    bridge.openThemesGallery();
  });
  if (folderBtn) folderBtn.addEventListener('click', () => {
    bridge.openThemesFolder();
  });
  if (rescanBtn) rescanBtn.addEventListener('click', async () => {
    await loadInstalledCustomThemes();
    // Re-apply the active custom theme if it still exists, or fall back
    // to the base design if it was deleted
    const settings = await bridge.getSettings().then(s => JSON.parse(s));
    const active = settings.active_custom_theme || '';
    if (active) {
      const stillExists = (window._installedCustomThemes || []).some(t => t.id === active);
      if (!stillExists) {
        applyDesign(settings.ui_design || 'industrial');
        toast(`Active custom theme "${active}" was removed — reverted to ${settings.ui_design || 'industrial'}`, 'warning');
      } else if (window._activeCustomThemeId !== active) {
        applyCustomTheme(active);
      }
    }
    toast(`Found ${window._installedCustomThemes.length} custom theme${window._installedCustomThemes.length === 1 ? '' : 's'}`, 'info');
  });

  // Initial load
  loadInstalledCustomThemes();
}

function applyMidnightAccent(name) {
  document.body.dataset.midnightAccent = name;
  document.querySelectorAll('.midnight-tile').forEach(t =>
    t.classList.toggle('active', t.dataset.midnightAccent === name));
}

function applyTheme(name) {
  document.body.dataset.theme = name;
  document.querySelectorAll('.theme-tile').forEach(t =>
    t.classList.toggle('active', t.dataset.theme === name));
}

// ============== FREEZE PURGE ==============
function setupFreezeClear() {
  document.getElementById('freeze-clear').addEventListener('click', () => {
    bridge.clearFreezeQueue().then((n) => {
      toast(`Cleared ${n} held packet${n === 1 ? '' : 's'}`, 'success');
    });
  });
}

// ============== TRAFFIC GRAPH ==============
function drawTrafficGraph() {
  const canvas = document.getElementById('traffic-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,184,0,0.06)';
  ctx.lineWidth = 1 * dpr;
  for (let i = 0; i < 5; i++) { const y = (h/4)*i; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  for (let i = 0; i < 12; i++) { const x = (w/11)*i; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }

  if (bwIn.length === 0 && bwOut.length === 0) return;
  const all = [...bwIn, ...bwOut];
  const maxVal = Math.max(1024, ...all);
  if (bwOut.length > 0) drawSeries(ctx, bwOut, w, h, maxVal, '#ffb800', dpr);
  if (bwIn.length > 0)  drawSeries(ctx, bwIn,  w, h, maxVal, '#7fff6a', dpr);
}

function drawSeries(ctx, data, w, h, maxVal, color, dpr) {
  const N = 60;
  const padded = [];
  for (let i = 0; i < N - data.length; i++) padded.push(0);
  for (const v of data) padded.push(v);

  ctx.beginPath();
  for (let i = 0; i < padded.length; i++) {
    const x = (i / (N - 1)) * w;
    const y = h - (padded[i] / maxVal) * h * 0.9;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexA(color, 0.35)); grad.addColorStop(1, hexA(color, 0.0));
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < padded.length; i++) {
    const x = (i / (N - 1)) * w;
    const y = h - (padded[i] / maxVal) * h * 0.9;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * dpr;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6 * dpr;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function hexA(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ============== MODALS ==============
function showModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('closing');
  m.hidden = false;
  const inner = m.querySelector('.modal-anim');
  if (inner) { inner.style.animation = 'none'; void inner.offsetWidth; inner.style.animation = ''; }
}

function hideModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('closing');
  setTimeout(() => { m.hidden = true; m.classList.remove('closing'); }, 180);
}

function setupModals() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('profiles-btn').addEventListener('click', openProfiles);

  // Close buttons & overlay click-outside
  document.querySelectorAll('[data-close-modal]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.closeModal;
      if (id === 'settings-modal') cancelSettings();
      else hideModal(id);
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', (e) => {
      if (e.target !== ov) return;
      if (ov.id === 'settings-modal') cancelSettings();
      else hideModal(ov.id);
    });
  });
  // Escape key closes top modal
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = ['settings-modal','profiles-modal','app-picker-modal']
      .map(id => document.getElementById(id))
      .filter(m => m && !m.hidden);
    if (open.length === 0) return;
    const top = open[open.length-1];
    if (top.id === 'settings-modal') cancelSettings();
    else hideModal(top.id);
  });

  // Tabs
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      const modal = btn.closest('.modal');
      modal.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === btn));
      modal.querySelectorAll('.tab-pane').forEach(p =>
        p.classList.toggle('active', p.dataset.pane === target));
    });
  });

  // Theme tile click — visual only (saved on Save)
  document.querySelectorAll('.theme-tile').forEach(tile =>
    tile.addEventListener('click', () => applyTheme(tile.dataset.theme)));

  // Design tile click — also visual only, saved on Save
  document.querySelectorAll('.design-tile').forEach(tile =>
    tile.addEventListener('click', () => applyDesign(tile.dataset.design)));

  // Midnight accent tile click
  document.querySelectorAll('.midnight-tile').forEach(tile =>
    tile.addEventListener('click', () => applyMidnightAccent(tile.dataset.midnightAccent)));

  document.getElementById('test-sound').addEventListener('click', () => {
    bridge.playTone(523, 60);
    setTimeout(() => bridge.playTone(659, 60), 80);
    setTimeout(() => bridge.playTone(784, 80), 160);
  });

  // ----- Live-preview wiring (no save until Save) -----
  hookLivePreview();

  // ----- Action buttons in Customize / Advanced tabs -----
  hookCustomizeTab();
  hookAdvancedTab();

  // Save / Cancel
  document.getElementById('save-settings').addEventListener('click', saveSettings);
  document.getElementById('save-profile').addEventListener('click', saveCurrentProfile);

  // Border preview buttons
  document.getElementById('preview-border-running').addEventListener('click', () => {
    bridge.previewScreenBorderRunning();
  });
  document.getElementById('preview-border-stopped').addEventListener('click', () => {
    bridge.previewScreenBorderStopped();
  });
}

function hookLivePreview() {
  // Overlay
  document.getElementById('show-overlay').addEventListener('change', (e) => {
    bridge.setOverlayVisible(e.target.checked);
  });
  document.getElementById('overlay-mode').addEventListener('change', (e) => {
    bridge.setOverlayMode(e.target.value);
  });
  document.getElementById('overlay-locked').addEventListener('change', (e) => {
    bridge.setOverlayLocked(e.target.checked);
  });
  const opSlider = document.getElementById('overlay-opacity');
  opSlider.addEventListener('input', () => {
    document.getElementById('overlay-opacity-display').textContent = `${opSlider.value}%`;
    bridge.setOverlayOpacity(parseInt(opSlider.value, 10));
  });

  // Screen border
  document.getElementById('screen-border-enabled').addEventListener('change', (e) => {
    bridge.setScreenBorderEnabled(e.target.checked);
  });
  const borderDur = document.getElementById('border-duration');
  borderDur.addEventListener('input', () => {
    const ms = parseInt(borderDur.value, 10);
    document.getElementById('border-duration-display').textContent = `${(ms/1000).toFixed(1)}s`;
    bridge.setScreenBorderDuration(ms);
  });
  const borderFeather = document.getElementById('border-feather');
  borderFeather.addEventListener('input', () => {
    document.getElementById('border-feather-display').textContent = `${borderFeather.value} px`;
    bridge.setScreenBorderFeather(parseInt(borderFeather.value, 10));
  });

  // Compact + CRT
  document.getElementById('compact-mode').addEventListener('change', (e) => {
    document.body.dataset.compact = e.target.checked ? "true" : "false";
  });
  document.getElementById('crt-effects').addEventListener('change', (e) => {
    document.body.dataset.crt = e.target.checked ? "on" : "off";
  });

  // Sound vol display
  const volSlider = document.getElementById('sound-volume');
  volSlider.addEventListener('input', () => {
    document.getElementById('sound-volume-display').textContent = `${volSlider.value}%`;
  });

  // Phase 1: sound effects volume display
  const sfxVol = document.getElementById('sound-effects-volume');
  if (sfxVol) {
    sfxVol.addEventListener('input', () => {
      const disp = document.getElementById('sound-effects-volume-display');
      if (disp) disp.textContent = `${sfxVol.value}%`;
    });
  }

  // Advanced — live preview where it makes sense
  document.getElementById('main-always-on-top').addEventListener('change', (e) => {
    bridge.setMainAlwaysOnTop(e.target.checked);
  });
  const statsInt = document.getElementById('stats-interval');
  statsInt.addEventListener('input', () => {
    document.getElementById('stats-interval-display').textContent = `${statsInt.value} ms`;
    bridge.setStatsInterval(parseInt(statsInt.value, 10));
  });
  const appsRef = document.getElementById('apps-refresh');
  appsRef.addEventListener('input', () => {
    document.getElementById('apps-refresh-display').textContent = `${(parseInt(appsRef.value,10)/1000).toFixed(1)}s`;
    bridge.setAppsRefreshInterval(parseInt(appsRef.value, 10));
  });
  const animSpd = document.getElementById('anim-speed');
  animSpd.addEventListener('input', () => {
    document.getElementById('anim-speed-display').textContent = `${parseFloat(animSpd.value).toFixed(1)}×`;
    document.documentElement.style.setProperty('--anim-speed', animSpd.value);
  });
  const toastDur = document.getElementById('toast-duration');
  toastDur.addEventListener('input', () => {
    document.getElementById('toast-duration-display').textContent =
      `${(parseInt(toastDur.value,10)/1000).toFixed(1)}s`;
    _toastDurationMs = parseInt(toastDur.value, 10);
  });

  // Reset stats now (live action, no save needed)
  document.getElementById('reset-stats-btn').addEventListener('click', () => {
    bridge.resetStats(); toast('Stats reset', 'success');
  });
}

// ============== CUSTOMIZE TAB ==============
function hookCustomizeTab() {
  document.getElementById('add-row-btn').addEventListener('click', () => {
    const t = document.getElementById('add-row-type').value;
    _draftLayout.push({ type: t, visible: true });
    renderLayoutList();
    pushDraftLayoutLive();
  });
  document.getElementById('reset-layout-btn').addEventListener('click', () => {
    _draftLayout = [
      { type:'status_row',      visible:true },
      { type:'app_row',         visible:true },
      { type:'stats3',          visible:true },
    ];
    renderLayoutList();
    pushDraftLayoutLive();
    toast('Layout reset to default', 'success');
  });
  document.getElementById('save-preset-btn').addEventListener('click', saveOverlayPreset);
}

function renderLayoutList() {
  const ul = document.getElementById('layout-list');
  ul.innerHTML = '';
  if (_draftLayout.length === 0) {
    ul.innerHTML = '<li style="cursor:default;justify-content:center;color:var(--bone-dim);font-style:italic">Empty layout — add rows below</li>';
    return;
  }
  _draftLayout.forEach((row, idx) => {
    const li = document.createElement('li');
    li.className = (row.visible ? 'visible' : 'hidden-row');
    li.draggable = true;
    li.dataset.idx = String(idx);
    li.innerHTML = `
      <span class="ll-handle" title="Drag to reorder">≡</span>
      <span class="ll-name">${escapeHTML(ROW_LABELS[row.type] || row.type)}</span>
      <span class="ll-toggle" data-action="toggle" title="Show/hide"></span>
      <div class="ll-actions">
        <button class="ll-btn" data-action="up"   title="Move up">▲</button>
        <button class="ll-btn" data-action="down" title="Move down">▼</button>
        <button class="ll-btn del" data-action="del" title="Remove">×</button>
      </div>
    `;
    li.querySelector('[data-action="toggle"]').addEventListener('click', () => {
      row.visible = !row.visible;
      renderLayoutList();
      pushDraftLayoutLive();
    });
    li.querySelector('[data-action="up"]').addEventListener('click', () => {
      if (idx === 0) return;
      [_draftLayout[idx-1], _draftLayout[idx]] = [_draftLayout[idx], _draftLayout[idx-1]];
      renderLayoutList();
      pushDraftLayoutLive();
    });
    li.querySelector('[data-action="down"]').addEventListener('click', () => {
      if (idx === _draftLayout.length - 1) return;
      [_draftLayout[idx+1], _draftLayout[idx]] = [_draftLayout[idx], _draftLayout[idx+1]];
      renderLayoutList();
      pushDraftLayoutLive();
    });
    li.querySelector('[data-action="del"]').addEventListener('click', () => {
      _draftLayout.splice(idx, 1);
      renderLayoutList();
      pushDraftLayoutLive();
    });

    // Native drag & drop reorder
    li.addEventListener('dragstart', (e) => {
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      ul.querySelectorAll('li').forEach(l => l.classList.remove('drop-target-above','drop-target-below'));
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const above = (e.clientY - r.top) < r.height / 2;
      ul.querySelectorAll('li').forEach(l => l.classList.remove('drop-target-above','drop-target-below'));
      li.classList.add(above ? 'drop-target-above' : 'drop-target-below');
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (Number.isNaN(fromIdx) || fromIdx === idx) return;
      const r = li.getBoundingClientRect();
      const above = (e.clientY - r.top) < r.height / 2;
      let toIdx = above ? idx : idx + 1;
      if (fromIdx < toIdx) toIdx -= 1;
      const [moved] = _draftLayout.splice(fromIdx, 1);
      _draftLayout.splice(toIdx, 0, moved);
      renderLayoutList();
      pushDraftLayoutLive();
    });
    ul.appendChild(li);
  });
}

function pushDraftLayoutLive() {
  // Apply as live preview AND auto-switch the Mode dropdown to Custom so
  // the user immediately sees the result. Without this the overlay flips
  // to custom mode internally but the dropdown still says Compact, which
  // is confusing — and on Save would persist mode=compact, ignoring the
  // custom layout.
  const modeSelect = document.getElementById('overlay-mode');
  if (modeSelect && modeSelect.value !== 'custom') {
    modeSelect.value = 'custom';
    bridge.setOverlayMode('custom');
  }
  bridge.setOverlayLayout(JSON.stringify(_draftLayout));
}

function saveOverlayPreset() {
  const nameEl = document.getElementById('preset-name');
  const name = nameEl.value.trim();
  if (!name) { toast('Enter a preset name', 'error'); return; }
  bridge.getSettings().then(json => {
    const s = JSON.parse(json);
    const presets = s.overlay_presets || {};
    presets[name] = JSON.parse(JSON.stringify(_draftLayout));
    bridge.saveSettings(JSON.stringify({ overlay_presets: presets })).then(ok => {
      if (ok) {
        toast(`Saved preset: ${name}`, 'success');
        nameEl.value = '';
        refreshPresetList(presets);
      } else toast('Save failed', 'error');
    });
  });
}

function refreshPresetList(presets) {
  const list = document.getElementById('preset-list');
  list.innerHTML = '';
  const names = Object.keys(presets || {});
  if (names.length === 0) {
    list.innerHTML = '<div class="loading">No saved presets yet</div>';
    return;
  }
  for (const name of names) {
    const div = document.createElement('div');
    div.className = 'profile-item';
    div.innerHTML = `
      <span class="name">${escapeHTML(name)}</span>
      <button class="load">Load</button>
      <button class="delete">Delete</button>
    `;
    div.querySelector('.load').addEventListener('click', () => {
      _draftLayout = JSON.parse(JSON.stringify(presets[name]));
      renderLayoutList();
      pushDraftLayoutLive();
      toast(`Loaded preset: ${name}`, 'success');
    });
    div.querySelector('.delete').addEventListener('click', () => {
      delete presets[name];
      bridge.saveSettings(JSON.stringify({ overlay_presets: presets })).then(() => {
        refreshPresetList(presets);
        toast(`Deleted: ${name}`, 'success');
      });
    });
    list.appendChild(div);
  }
}

// ============== ADVANCED TAB ==============
function hookAdvancedTab() {
  document.getElementById('export-settings-btn').addEventListener('click', () => {
    bridge.exportSettingsJson().then(json => {
      // Trigger a download via blob
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `throttlr-settings-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('Settings exported', 'success');
    });
  });
  document.getElementById('import-settings-btn').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', () => {
      const file = inp.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        bridge.importSettingsJson(reader.result).then(ok => {
          if (ok) {
            toast('Settings imported — reopen Settings to refresh', 'success');
            // Re-fetch fresh settings on next open
            _origSettings = null;
          } else {
            toast('Import failed — invalid JSON', 'error');
          }
        });
      };
      reader.readAsText(file);
    });
    inp.click();
  });
  document.getElementById('reset-settings-btn').addEventListener('click', () => {
    if (!confirm('Reset ALL settings to factory defaults? This cannot be undone.')) return;
    bridge.resetSettingsToDefaults().then(ok => {
      if (ok) {
        toast('Settings reset to defaults', 'success');
        // Re-load settings into UI immediately
        bridge.getSettings().then(json => {
          const s = JSON.parse(json);
          _origSettings = JSON.parse(JSON.stringify(s));
          populateSettingsUI(s);
        });
      } else toast('Reset failed', 'error');
    });
  });

  // Diagnostics — surfaces the current capture state so user can verify
  document.getElementById('show-diag-btn').addEventListener('click', () => {
    bridge.getDiagnostics().then(json => {
      try {
        const d = JSON.parse(json);
        if (d.error) { toast(`Diagnostics error: ${d.error}`, 'error'); return; }
        const onOff = (b) => b ? 'ON' : 'off';
        const lines = [
          `Target: ${d.target_name || '(none)'} — ${d.target_pid_count} PID${d.target_pid_count === 1 ? '' : 's'}`,
          `Capture: ${onOff(d.running)} | FLOW listener: ${d.flow_listener ? 'ACTIVE' : 'inactive (psutil only)'} | Conn map: ${d.conn_map_size} entries`,
          `Seen ${d.packets_seen.toLocaleString()} | Dropped ${d.packets_dropped.toLocaleString()} | Delayed ${d.packets_delayed.toLocaleString()} | Held ${d.packets_held.toLocaleString()}`,
          `Lag ${onOff(d.lag_on)} (${d.lag_ms}ms) · Drop ${onOff(d.drop_on)} (${d.drop_chance}%) · Throttle ${onOff(d.throttle_on)} (${d.throttle_kbps} KB/s)`,
          `Freeze ${onOff(d.freeze_on)} — ${d.freeze_queue_len} queued · Block ${onOff(d.block_on)} · Fun ${onOff(d.fun_mode)}`,
          `Delay queue: ${d.delay_queue_len} pending`,
        ];
        // Show as a long success toast; Billy can screenshot it
        toast(lines.join('\n'), 'success', 12000);
      } catch (e) {
        toast(`Could not parse diagnostics: ${e}`, 'error');
      }
    });
  });
}

// ============== SETTINGS OPEN / SAVE / CANCEL ==============
function openSettings() {
  bridge.getSettings().then((json) => {
    const s = JSON.parse(json);
    _origSettings = JSON.parse(JSON.stringify(s));   // snapshot for revert
    populateSettingsUI(s);
    refreshAutoLoadProfileDropdown(s.auto_load_profile || '');
    refreshPresetList(s.overlay_presets || {});
    showModal('settings-modal');
  });
}

function populateSettingsUI(s) {
  applyTheme(s.theme || 'lethal');
  // v3.0.5 fix — if a custom theme should be active, DON'T call applyDesign,
  // it would reset body.dataset.design + tear down the custom CSS, causing
  // a visible flash before the setTimeout below re-applies the custom theme.
  // Just update the tile selection so the active design tile shows
  // the right base, without touching body state.
  const hasActiveCustom = !!s.active_custom_theme &&
    (window._installedCustomThemes || []).some(t => t.id === s.active_custom_theme);
  if (hasActiveCustom) {
    // Update design-tile active state to reflect the tile, but leave
    // body data alone — applyCustomTheme already set it correctly.
    const baseDesign = (window._installedCustomThemes || [])
      .find(t => t.id === s.active_custom_theme)?.base || 'industrial';
    document.querySelectorAll('.design-tile').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.design-tile.custom-theme').forEach(el =>
      el.classList.toggle('active', el.dataset.customThemeId === s.active_custom_theme));
    // For midnight-only / industrial-only inline blocks that watch dataset.design,
    // the base is already in body.dataset.design from when applyCustomTheme set it,
    // so we don't need to touch it.
    void baseDesign; // (kept for clarity; body.dataset.design was set on apply)
  } else {
    applyDesign(s.ui_design || 'industrial');
  }
  applyMidnightAccent(s.midnight_accent || 'aurora');
  // If active_custom_theme is set but the manifest list hasn't loaded yet,
  // re-apply once it has — covers the race where settings opens before
  // setupCustomThemes finishes loading the themes.
  if (s.active_custom_theme && !hasActiveCustom) {
    setTimeout(() => {
      const exists = (window._installedCustomThemes || []).some(t => t.id === s.active_custom_theme);
      if (exists) applyCustomTheme(s.active_custom_theme);
    }, 250);
  }
  populateHotkeys(s);
  const setBool = (id, v) => { const e = document.getElementById(id); if (e) e.checked = !!v; };
  const setVal  = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };

  // Appearance
  setBool('compact-mode', s.compact_mode);
  setBool('crt-effects',  s.crt_effects !== false);
  document.body.dataset.compact = s.compact_mode ? "true" : "false";
  document.body.dataset.crt = (s.crt_effects === false) ? "off" : "on";

  // Hotkeys
  setBool('hotkey-notifications', s.hotkey_notifications !== false);

  // Overlay
  setBool('show-overlay', s.show_overlay !== false);
  setVal('overlay-mode', s.overlay_mode || (s.overlay_advanced ? 'advanced' : 'compact'));
  setBool('overlay-locked', s.overlay_locked);
  setVal('overlay-opacity', s.overlay_opacity ?? 95);
  document.getElementById('overlay-opacity-display').textContent = `${s.overlay_opacity ?? 95}%`;
  setBool('screen-border-enabled', s.screen_border_enabled);
  setVal('border-duration', s.screen_border_duration_ms ?? 2000);
  document.getElementById('border-duration-display').textContent =
    `${((s.screen_border_duration_ms ?? 2000)/1000).toFixed(1)}s`;
  setVal('border-feather', s.screen_border_feather ?? 90);
  document.getElementById('border-feather-display').textContent = `${s.screen_border_feather ?? 90} px`;

  // Customize
  _draftLayout = Array.isArray(s.overlay_layout) && s.overlay_layout.length
    ? JSON.parse(JSON.stringify(s.overlay_layout))
    : [
        { type:'status_row', visible:true },
        { type:'app_row',    visible:true },
        { type:'stats3',     visible:true },
      ];
  renderLayoutList();

  // Sound
  setBool('sound-enabled', s.sound_enabled);
  setVal('sound-volume', s.sound_volume ?? 100);
  document.getElementById('sound-volume-display').textContent = `${s.sound_volume ?? 100}%`;

  // Behavior
  setBool('auto-start', s.auto_start_on_launch);
  setBool('auto-clear', s.auto_clear_freeze_queue);
  setBool('reset-stats-start', s.reset_stats_on_start);
  setBool('confirm-quit', s.confirm_before_quit !== false);
  setVal('auto-stop-minutes', s.auto_stop_minutes ?? 0);

  // Advanced
  setVal('stats-interval', s.stats_interval_ms ?? 200);
  document.getElementById('stats-interval-display').textContent = `${s.stats_interval_ms ?? 200} ms`;
  setVal('apps-refresh', s.apps_refresh_ms ?? 2000);
  document.getElementById('apps-refresh-display').textContent =
    `${((s.apps_refresh_ms ?? 2000)/1000).toFixed(1)}s`;
  setBool('skip-localhost', s.skip_localhost !== false);
  setBool('verbose-logging', s.verbose_logging);
  setBool('main-always-on-top', s.main_always_on_top);
  setVal('anim-speed', s.anim_speed ?? 1);
  document.getElementById('anim-speed-display').textContent = `${parseFloat(s.anim_speed ?? 1).toFixed(1)}×`;
  document.documentElement.style.setProperty('--anim-speed', s.anim_speed ?? 1);
  setVal('toast-duration', s.toast_duration_ms ?? 3500);
  document.getElementById('toast-duration-display').textContent =
    `${((s.toast_duration_ms ?? 3500)/1000).toFixed(1)}s`;
  setVal('number-format', s.number_format || 'raw');
  setBool('tooltips-enabled', s.tooltips_enabled !== false);

  // Phase 1 settings
  setBool('sound-effects-enabled',  s.sound_effects_enabled !== false);
  setVal('sound-effects-volume',    s.sound_effects_volume ?? 80);
  const sfxDisp = document.getElementById('sound-effects-volume-display');
  if (sfxDisp) sfxDisp.textContent = `${s.sound_effects_volume ?? 80}%`;
  setBool('overlay-stream-safe',    !!s.overlay_stream_safe);
  setBool('overlay-ghost-mode',     !!s.overlay_ghost_mode);
  setBool('auto-load-preset',       s.auto_load_per_app_preset !== false);
  setBool('animated-icon',          s.animated_icon !== false);
  setVal('midnight-custom-hex',     s.midnight_custom_color || '');
  const cp = document.getElementById('midnight-custom-color');
  if (cp && /^#[0-9a-fA-F]{6}$/.test(s.midnight_custom_color || '')) {
    cp.value = s.midnight_custom_color;
  }

  // Refresh the per-app-presets list (Behavior tab)
  appSettings.per_app_presets = s.per_app_presets || {};
  refreshPerAppPresetsList();
}

function refreshAutoLoadProfileDropdown(currentValue) {
  bridge.listProfiles().then(json => {
    try {
      const names = JSON.parse(json) || [];
      const sel = document.getElementById('auto-load-profile');
      if (!sel) return;
      sel.innerHTML = '<option value="">(none)</option>' +
        names.map(n => `<option value="${escapeHTML(n)}">${escapeHTML(n)}</option>`).join('');
      sel.value = currentValue || '';
    } catch {}
  });
}

function cancelSettings() {
  // Revert any live-applied state to the snapshot we took on open
  if (_origSettings) {
    const s = _origSettings;
    applyTheme(s.theme || 'lethal');
    // v3.0.5 fix — same logic as populateSettingsUI: if the snapshot says
    // a custom theme should be active, don't bounce through applyDesign first
    // (it would clear the custom theme and cause a flash).
    const hasActiveCustom = !!s.active_custom_theme &&
      (window._installedCustomThemes || []).some(t => t.id === s.active_custom_theme);
    if (hasActiveCustom) {
      // The custom theme is currently applied (or about to be) — re-apply it
      // to ensure it matches the snapshot, then update tile state.
      applyCustomTheme(s.active_custom_theme);
    } else {
      applyDesign(s.ui_design || 'industrial');
      // v3.0.6 — clear any overlay theme preview that the user kicked off
      // by hovering theme tiles before cancelling. Empty theme_id tells the
      // overlay to rebuild its palette from settings (i.e. the snapshot).
      try {
        if (typeof bridge !== 'undefined' && bridge.previewOverlayTheme) {
          bridge.previewOverlayTheme('', '');
        }
      } catch (e) { /* preview is best-effort */ }
    }
    applyMidnightAccent(s.midnight_accent || 'aurora');
    document.body.dataset.compact = s.compact_mode ? "true" : "false";
    document.body.dataset.crt = (s.crt_effects === false) ? "off" : "on";

    bridge.setOverlayVisible(s.show_overlay !== false);
    bridge.setOverlayMode(s.overlay_mode || (s.overlay_advanced ? 'advanced' : 'compact'));
    bridge.setOverlayLocked(!!s.overlay_locked);
    bridge.setOverlayOpacity(s.overlay_opacity ?? 95);

    bridge.setScreenBorderEnabled(!!s.screen_border_enabled);
    bridge.setScreenBorderDuration(s.screen_border_duration_ms ?? 2000);
    bridge.setScreenBorderFeather(s.screen_border_feather ?? 90);

    bridge.setMainAlwaysOnTop(!!s.main_always_on_top);
    bridge.setStatsInterval(s.stats_interval_ms ?? 200);
    bridge.setAppsRefreshInterval(s.apps_refresh_ms ?? 2000);

    bridge.setOverlayLayout(JSON.stringify(
      Array.isArray(s.overlay_layout) ? s.overlay_layout : []
    ));

    document.documentElement.style.setProperty('--anim-speed', s.anim_speed ?? 1);
    _toastDurationMs = s.toast_duration_ms ?? 3500;
  }
  hideModal('settings-modal');
}

function saveSettings() {
  const newSettings = {
    theme: document.body.dataset.theme,
    ui_design: document.body.dataset.design || 'industrial',
    midnight_accent: document.body.dataset.midnightAccent || 'aurora',
    active_custom_theme: window._activeCustomThemeId || '',

    hotkey_startstop:  document.getElementById('hk-startstop').dataset.value || '',
    hotkey_freeze:     document.getElementById('hk-freeze').dataset.value || '',
    hotkey_block:      document.getElementById('hk-block').dataset.value || '',
    hotkey_fun:        document.getElementById('hk-fun').dataset.value || '',
    hotkey_killswitch: document.getElementById('hk-killswitch').dataset.value || '',
    hotkey_notifications: document.getElementById('hotkey-notifications').checked,

    sound_enabled: document.getElementById('sound-enabled').checked,
    sound_volume:  parseInt(document.getElementById('sound-volume').value, 10),

    auto_start_on_launch:      document.getElementById('auto-start').checked,
    auto_clear_freeze_queue:   document.getElementById('auto-clear').checked,
    reset_stats_on_start:      document.getElementById('reset-stats-start').checked,
    confirm_before_quit:       document.getElementById('confirm-quit').checked,
    auto_stop_minutes:         parseInt(document.getElementById('auto-stop-minutes').value, 10) || 0,

    show_overlay:        document.getElementById('show-overlay').checked,
    overlay_mode:        document.getElementById('overlay-mode').value,
    overlay_advanced:    document.getElementById('overlay-mode').value === 'advanced',
    overlay_locked:      document.getElementById('overlay-locked').checked,
    overlay_opacity:     parseInt(document.getElementById('overlay-opacity').value, 10),
    overlay_layout:      _draftLayout,

    screen_border_enabled:     document.getElementById('screen-border-enabled').checked,
    screen_border_duration_ms: parseInt(document.getElementById('border-duration').value, 10),
    screen_border_feather:     parseInt(document.getElementById('border-feather').value, 10),

    compact_mode: document.getElementById('compact-mode').checked,
    crt_effects:  document.getElementById('crt-effects').checked,

    stats_interval_ms:   parseInt(document.getElementById('stats-interval').value, 10),
    apps_refresh_ms:     parseInt(document.getElementById('apps-refresh').value, 10),
    skip_localhost:      document.getElementById('skip-localhost').checked,
    verbose_logging:     document.getElementById('verbose-logging').checked,
    main_always_on_top:  document.getElementById('main-always-on-top').checked,
    anim_speed:          parseFloat(document.getElementById('anim-speed').value),
    toast_duration_ms:   parseInt(document.getElementById('toast-duration').value, 10),
    number_format:       document.getElementById('number-format').value,
    tooltips_enabled:    document.getElementById('tooltips-enabled').checked,
    auto_load_profile:   document.getElementById('auto-load-profile').value,

    // Phase 1 settings
    sound_effects_enabled:    (document.getElementById('sound-effects-enabled') || {}).checked || false,
    sound_effects_volume:     parseInt((document.getElementById('sound-effects-volume') || {}).value, 10) || 80,
    overlay_stream_safe:      (document.getElementById('overlay-stream-safe') || {}).checked || false,
    overlay_ghost_mode:       (document.getElementById('overlay-ghost-mode') || {}).checked || false,
    auto_load_per_app_preset: (document.getElementById('auto-load-preset') || {}).checked !== false,
    animated_icon:            (document.getElementById('animated-icon') || {}).checked !== false,
    midnight_custom_color:    (document.getElementById('midnight-custom-hex') || {}).value || '',
  };
  const hk = [newSettings.hotkey_startstop, newSettings.hotkey_freeze,
              newSettings.hotkey_block, newSettings.hotkey_fun];
  if (new Set(hk).size !== hk.length) {
    toast("Hotkey collision — each one must be unique", 'error');
    return;
  }
  bridge.saveSettings(JSON.stringify(newSettings)).then((ok) => {
    if (ok) {
      toast('Settings saved', 'success');
      updateHotkeyChips(newSettings);
      applyAppearance(newSettings);
      _hotkeyNotifications = newSettings.hotkey_notifications;
      _toastDurationMs = newSettings.toast_duration_ms;
      _origSettings = JSON.parse(JSON.stringify(newSettings));   // refresh snapshot
      hideModal('settings-modal');
    } else toast('Save failed', 'error');
  });
}

// ============== PROFILES MODAL ==============
function openProfiles() {
  showModal('profiles-modal');
  refreshProfiles();
}

function saveCurrentProfile() {
  const name = document.getElementById('profile-name').value.trim();
  if (!name) { toast('Enter a profile name', 'error'); return; }
  const cfg = collectProfileData();
  bridge.saveProfile(name, JSON.stringify(cfg)).then((ok) => {
    if (ok) {
      toast(`Saved profile: ${name}`, 'success');
      document.getElementById('profile-name').value = '';
      refreshProfiles();
    } else toast('Save failed', 'error');
  });
}

function refreshProfiles() {
  bridge.listProfiles().then((json) => {
    const list = document.getElementById('profile-list');
    const profiles = JSON.parse(json);
    list.innerHTML = '';
    if (profiles.length === 0) {
      list.innerHTML = '<div class="loading">No saved profiles yet</div>';
      return;
    }
    for (const name of profiles) {
      const div = document.createElement('div');
      div.className = 'profile-item';
      div.innerHTML = `
        <span class="name">${escapeHTML(name)}</span>
        <button class="load">Load</button>
        <button class="delete">Delete</button>`;
      div.querySelector('.load').addEventListener('click', () => {
        bridge.loadProfile(name).then((data) => {
          if (data) {
            applyProfileData(JSON.parse(data));
            toast(`Loaded: ${name}`, 'success');
            hideModal('profiles-modal');
          }
        });
      });
      div.querySelector('.delete').addEventListener('click', () => {
        bridge.deleteProfile(name).then((ok) => { if (ok) refreshProfiles(); });
      });
      list.appendChild(div);
    }
  });
}

function collectProfileData() {
  const cfg = {};
  document.querySelectorAll('.func-mod [data-key]').forEach(el => {
    const k = el.dataset.key;
    if (el.type === 'checkbox') cfg[k] = el.checked;
    else if (el.type === 'number' || el.type === 'range') cfg[k] = parseInt(el.value, 10) || 0;
    else if (el.tagName === 'SELECT') cfg[k] = parseInt(el.value, 10) || 0;
    else cfg[k] = el.value;
  });
  return cfg;
}

function applyProfileData(data) {
  for (const [k, v] of Object.entries(data)) {
    const el = document.querySelector(`.func-mod [data-key="${k}"]`);
    if (!el) continue;
    if (el.type === 'checkbox') { el.checked = !!v; el.dispatchEvent(new Event('change')); }
    else                        { el.value = v;     el.dispatchEvent(new Event('change')); }
  }
  pushConfig();
}

function populateHotkeys(s) {
  // v3.0.4 — click-to-capture buttons instead of dropdowns. User clicks
  // the button, presses a key, and that key is bound. Esc cancels,
  // Backspace unbinds. Way faster than scrolling a dropdown.
  const ids = {
    'hk-startstop':  s.hotkey_startstop  || 'F5',
    'hk-freeze':     s.hotkey_freeze     || 'F8',
    'hk-block':      s.hotkey_block      || 'F9',
    'hk-fun':        s.hotkey_fun        || 'F10',
    'hk-killswitch': s.hotkey_killswitch || '',
  };
  for (const [id, current] of Object.entries(ids)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    _setHotkeyButton(btn, current);
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => _startHotkeyCapture(btn));
    }
  }
}

function _setHotkeyButton(btn, value) {
  btn.dataset.value = value || '';
  btn.classList.remove('listening');
  btn.textContent = value && value.length ? value : '— None —';
}

let _hkCapturingBtn = null;
let _hkCaptureKeyHandler = null;

function _startHotkeyCapture(btn) {
  // Cancel any other in-flight capture first
  if (_hkCapturingBtn && _hkCapturingBtn !== btn) {
    _setHotkeyButton(_hkCapturingBtn, _hkCapturingBtn.dataset.value || '');
  }
  _hkCapturingBtn = btn;
  btn.classList.add('listening');
  btn.textContent = 'press a key…';

  _hkCaptureKeyHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      // Cancel — restore previous value
      _setHotkeyButton(btn, btn.dataset.value || '');
      _stopHotkeyCapture();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      // Unbind
      _setHotkeyButton(btn, '');
      _stopHotkeyCapture();
      return;
    }
    // Modifier-only presses don't count — wait for an actual key
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

    const name = _eventToKeyName(e);
    if (!name) {
      // Couldn't translate — keep listening
      return;
    }
    _setHotkeyButton(btn, name);
    _stopHotkeyCapture();
  };
  // Capture phase + true so we beat any other listeners (incl. global shortcuts)
  document.addEventListener('keydown', _hkCaptureKeyHandler, true);
}

function _stopHotkeyCapture() {
  if (_hkCaptureKeyHandler) {
    document.removeEventListener('keydown', _hkCaptureKeyHandler, true);
    _hkCaptureKeyHandler = null;
  }
  if (_hkCapturingBtn) {
    _hkCapturingBtn.classList.remove('listening');
  }
  _hkCapturingBtn = null;
}

function _eventToKeyName(e) {
  // Translate a KeyboardEvent into the canonical key name we store in
  // settings (and that the Python side understands via KEY_NAMES).
  const code = e.code || '';
  const key  = e.key  || '';

  // F1..F24
  if (/^F\d{1,2}$/.test(key)) return key;

  // Letters → uppercase single char
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);

  // Digits — top row + numpad
  if (code.startsWith('Digit'))   return code.slice(5);
  if (code.startsWith('Numpad') && /^\d$/.test(code.slice(6)))
    return 'Num' + code.slice(6);

  // Named keys
  const map = {
    'Space':       'Space',
    'Enter':       'Enter',
    'Tab':         'Tab',
    'Insert':      'Insert',
    'Home':        'Home',
    'End':         'End',
    'PageUp':      'Page Up',
    'PageDown':    'Page Down',
    'Pause':       'Pause',
    'ScrollLock':  'Scroll Lock',
    'PrintScreen': 'Print Screen',
    'ArrowUp':     'Up',
    'ArrowDown':   'Down',
    'ArrowLeft':   'Left',
    'ArrowRight':  'Right',
    'NumpadAdd':         'Num +',
    'NumpadSubtract':    'Num -',
    'NumpadMultiply':    'Num *',
    'NumpadDivide':      'Num /',
    'NumpadDecimal':     'Num .',
    'Minus':       '-',
    'Equal':       '=',
    'BracketLeft': '[',
    'BracketRight':']',
    'Backslash':   '\\',
    'Semicolon':   ';',
    'Quote':       "'",
    'Comma':       ',',
    'Period':      '.',
    'Slash':       '/',
    'Backquote':   '`',
  };
  return map[code] || null;
}

// ============== TOAST ==============
function toast(message, kind = 'info', durationMs = null) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${kind} animate__animated animate__fadeInRight animate__faster`;
  t.textContent = message;
  c.appendChild(t);
  const dur = durationMs != null ? durationMs : _toastDurationMs;
  setTimeout(() => {
    t.style.opacity = '0'; t.style.transform = 'translateX(20px)';
    setTimeout(() => t.remove(), 300);
  }, dur);
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============================================================================
// PHASE 1 — Quick Presets, Sound effects, Theme custom accent, Ghost mode,
//            Per-app preset prompt, Achievements engine
// ============================================================================

// ---- Built-in Quick Preset definitions ---------------------------------
const QUICK_PRESETS = {
  // "Vibes" — subjective, fun, experimental
  vibes: [
    { id:'slow', name:'Slow Connection', icon:'🐌', desc:'250ms lag · 50 KB/s',
      cfg:{ lag_on:true, lag_in:true, lag_out:true, lag_ms:250, lag_jitter_ms:30,
            throttle_on:true, throttle_in:true, throttle_out:true, throttle_kbps:50 } },
    { id:'gamekiller', name:'Connection Killer', icon:'💀', desc:'30% drop · 800ms lag',
      cfg:{ drop_on:true, drop_chance:30, drop_in:true, drop_out:true,
            lag_on:true, lag_ms:800, lag_jitter_ms:200 } },
    { id:'freezeburst', name:'Freeze Burst', icon:'❄️', desc:'Hold & release fast',
      cfg:{ freeze_on:true, freeze_in:true, freeze_out:true, freeze_replay_ms:5 } },
    { id:'spike', name:'Spike', icon:'⚡', desc:'Block all traffic',
      cfg:{ block_on:true, block_in:true, block_out:true } },
    { id:'dnsblock', name:'DNS Block', icon:'🚫', desc:'Drop DNS only',
      cfg:{ drop_on:true, drop_chance:100, drop_dns_only:true,
            drop_in:true, drop_out:true } },
  ],
  // "Real-world" — calibrated to actual measured network conditions
  realworld: [
    { id:'56k', name:'56k Modem', icon:'📞', desc:'7 KB/s · 200±50ms',
      cfg:{ throttle_on:true, throttle_kbps:7, throttle_in:true, throttle_out:true,
            lag_on:true, lag_ms:200, lag_jitter_ms:50 } },
    { id:'3gslow', name:'3G Slow', icon:'📶', desc:'50 KB/s · 400±100ms',
      cfg:{ throttle_on:true, throttle_kbps:50, throttle_in:true, throttle_out:true,
            lag_on:true, lag_ms:400, lag_jitter_ms:100 } },
    { id:'3gfast', name:'3G Fast', icon:'📶', desc:'200 KB/s · 150±50ms',
      cfg:{ throttle_on:true, throttle_kbps:200, throttle_in:true, throttle_out:true,
            lag_on:true, lag_ms:150, lag_jitter_ms:50 } },
    { id:'4glte', name:'4G LTE', icon:'📡', desc:'1.5 MB/s · 50±20ms',
      cfg:{ throttle_on:true, throttle_kbps:1500, throttle_in:true, throttle_out:true,
            lag_on:true, lag_ms:50, lag_jitter_ms:20 } },
    { id:'cable', name:'Cable', icon:'🌐', desc:'5 MB/s · 20ms',
      cfg:{ throttle_on:true, throttle_kbps:5000, throttle_in:true, throttle_out:true,
            lag_on:true, lag_ms:20, lag_jitter_ms:5 } },
    { id:'fiber', name:'Fiber', icon:'⚡', desc:'25 MB/s · 5ms',
      cfg:{ throttle_on:true, throttle_kbps:25000, throttle_in:true, throttle_out:true,
            lag_on:true, lag_ms:5, lag_jitter_ms:1 } },
    { id:'satellite', name:'Satellite', icon:'🛰️', desc:'1 MB/s · 600±100ms',
      cfg:{ throttle_on:true, throttle_kbps:1000, throttle_in:true, throttle_out:true,
            lag_on:true, lag_ms:600, lag_jitter_ms:100 } },
  ],
};

// All filterable cfg keys — used to clear & reset the form
const ALL_CFG_KEYS = [
  'lag_on','lag_in','lag_out','lag_ms','lag_jitter_ms',
  'drop_on','drop_in','drop_out','drop_chance','drop_dns_only',
  'throttle_on','throttle_in','throttle_out','throttle_kbps',
  'freeze_on','freeze_in','freeze_out','freeze_replay_ms',
  'block_on','block_in','block_out',
  'fun_on','fun_intensity',
];

function clearAllFunctions() {
  const cfg = {
    lag_on:false, drop_on:false, throttle_on:false,
    freeze_on:false, block_on:false, fun_on:false,
    drop_dns_only:false,
  };
  applyConfigToUI(cfg);
  pushConfig();
}

function applyConfigToUI(cfg) {
  // Update every form input in the function modules to match the supplied cfg
  document.querySelectorAll('.func-mod [data-key]').forEach(el => {
    const k = el.dataset.key;
    if (!(k in cfg)) return;
    const v = cfg[k];
    if (el.type === 'checkbox') {
      el.checked = !!v;
      const card = el.closest('.func-mod');
      if (card && el.classList.contains('toggle-input')) {
        card.classList.toggle('active', !!v);
      }
    } else if (el.type === 'number' || el.type === 'range') {
      el.value = (v === undefined || v === null) ? el.value : v;
      const evt = new Event('input', { bubbles: true });
      el.dispatchEvent(evt);
    } else if (el.tagName === 'SELECT') {
      el.value = String(v);
    } else {
      el.value = v;
    }
  });
}

function applyPreset(preset) {
  if (!preset || !preset.cfg) return;
  // Reset everything first so the preset's intended state is exact
  const baseline = {};
  ALL_CFG_KEYS.forEach(k => {
    if (k.endsWith('_on') || k.endsWith('_in') || k.endsWith('_out') || k === 'drop_dns_only') {
      baseline[k] = false;
    }
  });
  // Direction defaults — when a preset enables a function, default both directions on
  // unless the preset overrides them
  const merged = { ...baseline, ...preset.cfg };
  if (preset.cfg.lag_on)      { if (!('lag_in' in preset.cfg))      merged.lag_in = true;
                                 if (!('lag_out' in preset.cfg))     merged.lag_out = true; }
  if (preset.cfg.drop_on)     { if (!('drop_in' in preset.cfg))     merged.drop_in = true;
                                 if (!('drop_out' in preset.cfg))    merged.drop_out = true; }
  if (preset.cfg.throttle_on) { if (!('throttle_in' in preset.cfg)) merged.throttle_in = true;
                                 if (!('throttle_out' in preset.cfg))merged.throttle_out = true; }
  if (preset.cfg.freeze_on)   { if (!('freeze_in' in preset.cfg))   merged.freeze_in = true;
                                 if (!('freeze_out' in preset.cfg))  merged.freeze_out = true; }
  if (preset.cfg.block_on)    { if (!('block_in' in preset.cfg))    merged.block_in = true;
                                 if (!('block_out' in preset.cfg))   merged.block_out = true; }

  applyConfigToUI(merged);
  pushConfig();

  bridge.playSoundEffect('preset');
  toast(`Applied: ${preset.icon || ''} ${preset.name}`, 'success');

  // Visual flash on the applied card
  const id = preset.id || preset.name;
  document.querySelectorAll('.preset-card').forEach(c =>
    c.classList.toggle('applied', c.dataset.presetId === id));
  setTimeout(() => {
    document.querySelectorAll('.preset-card.applied').forEach(c => c.classList.remove('applied'));
  }, 1400);
}

function setupQuickPresets() {
  // Tab switching
  document.querySelectorAll('.preset-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.presetTab;
      document.querySelectorAll('.preset-tab').forEach(t => t.classList.toggle('active', t === tab));
      ['vibes','realworld','custom'].forEach(t => {
        const grid = document.getElementById('preset-grid-' + t);
        if (grid) grid.hidden = (t !== target);
      });
      if (target === 'custom') refreshUserPresets();
    });
  });

  // Built-in Vibes presets
  document.querySelectorAll('#preset-grid-vibes .preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.presetId;
      const p = QUICK_PRESETS.vibes.find(x => x.id === id);
      if (p) applyPreset(p);
    });
  });
  // Built-in Real-world presets
  document.querySelectorAll('#preset-grid-realworld .preset-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.presetId;
      const p = QUICK_PRESETS.realworld.find(x => x.id === id);
      if (p) applyPreset(p);
    });
  });

  // "Save current as preset" button
  const saveBtn = document.getElementById('preset-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    document.getElementById('save-preset-modal').hidden = false;
    document.getElementById('save-preset-name').focus();
  });

  // "Clear all functions" button
  const clearBtn = document.getElementById('preset-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearAllFunctions);

  // Save preset modal — icon picker
  let chosenIcon = '⚡';
  document.querySelectorAll('.preset-icon-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      chosenIcon = opt.dataset.pi;
      document.querySelectorAll('.preset-icon-opt').forEach(o =>
        o.classList.toggle('selected', o === opt));
    });
  });
  const confirm = document.getElementById('save-preset-confirm');
  if (confirm) confirm.addEventListener('click', () => {
    const name = (document.getElementById('save-preset-name').value || '').trim();
    if (!name) { toast('Give it a name first', 'error'); return; }
    const cfg = readCurrentConfig();
    const preset = { id: 'user_' + name.toLowerCase().replace(/[^a-z0-9]/g,'_'),
                     name, icon: chosenIcon,
                     desc: summarizeConfig(cfg), cfg };
    bridge.addUserPreset(JSON.stringify(preset));
    document.getElementById('save-preset-modal').hidden = true;
    document.getElementById('save-preset-name').value = '';
    refreshUserPresets();
    toast(`Saved preset "${name}"`, 'success');
  });
}

function readCurrentConfig() {
  const cfg = {};
  document.querySelectorAll('.func-mod [data-key]').forEach(el => {
    const k = el.dataset.key;
    if (el.type === 'checkbox') cfg[k] = el.checked;
    else if (el.type === 'number' || el.type === 'range') cfg[k] = parseInt(el.value, 10) || 0;
    else if (el.tagName === 'SELECT') cfg[k] = parseInt(el.value, 10) || 0;
    else cfg[k] = el.value;
  });
  return cfg;
}

function summarizeConfig(cfg) {
  const parts = [];
  if (cfg.lag_on)      parts.push(`lag ${cfg.lag_ms}ms`);
  if (cfg.drop_on)     parts.push(`drop ${cfg.drop_chance}%${cfg.drop_dns_only?' DNS':''}`);
  if (cfg.throttle_on) parts.push(`${cfg.throttle_kbps} KB/s`);
  if (cfg.freeze_on)   parts.push('freeze');
  if (cfg.block_on)    parts.push('block');
  if (cfg.fun_on)      parts.push('fun');
  return parts.join(' · ') || 'no functions';
}

function refreshUserPresets() {
  try {
    bridge.getUserPresets().then((raw) => {
      try {
        const list = JSON.parse(raw || '[]');
        const grid = document.getElementById('preset-grid-custom');
        if (!grid) return;
        grid.innerHTML = '';
        if (!list.length) {
          grid.innerHTML = `<div class="preset-empty" id="preset-custom-empty">
            No saved presets yet — tweak settings then click <b>Save current</b> to make one.
          </div>`;
          return;
        }
        list.forEach(p => {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'preset-card';
          card.dataset.presetId = p.id || p.name;
          card.innerHTML = `
            <span class="pc-icon-custom" title="Delete this preset">×</span>
            <span class="pc-icon">${p.icon || '⚡'}</span>
            <span class="pc-name">${escapeHtml(p.name || 'Untitled')}</span>
            <span class="pc-desc">${escapeHtml(p.desc || '')}</span>`;
          card.addEventListener('click', (e) => {
            if (e.target.classList.contains('pc-icon-custom')) {
              e.stopPropagation();
              if (confirm(`Delete preset "${p.name}"?`)) {
                bridge.deleteUserPreset(p.name);
                refreshUserPresets();
              }
              return;
            }
            applyPreset(p);
          });
          grid.appendChild(card);
        });
      } catch (e) { /* swallow */ }
    });
  } catch (e) { /* swallow */ }
}

// ---- Sound effects per function -----------------------------------------
function setupSoundEffects() {
  // Hook into the existing toggle-input handlers — when a function is
  // toggled ON, fire the matching effect.
  const fxMap = { lag_on:'lag', drop_on:'drop', throttle_on:'throttle',
                  freeze_on:'freeze', block_on:'block', fun_on:'fun' };
  document.querySelectorAll('.toggle-input').forEach(input => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const fx = fxMap[input.dataset.key];
      if (fx) bridge.playSoundEffect(fx);
    });
  });

  // Sound-tab test buttons
  document.querySelectorAll('[data-test-fx]').forEach(b => {
    b.addEventListener('click', () => bridge.playSoundEffect(b.dataset.testFx));
  });
}

// ---- Theme: custom Midnight accent --------------------------------------
function applyMidnightCustomCss(hex) {
  // Inject a style override that swaps the Midnight accent variables.
  let style = document.getElementById('midnight-custom-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'midnight-custom-style';
    document.head.appendChild(style);
  }
  if (!hex) {
    style.textContent = '';
    return;
  }
  // Build a complementary gradient — accent → lightened version
  const lighter = lightenHex(hex, 0.25);
  style.textContent = `
    body[data-design="midnight"] {
      --accent-primary: ${hex};
      --accent-secondary: ${lighter};
      --accent-glow: ${hex}55;
    }
    body[data-design="midnight"] .accent-grad,
    body[data-design="midnight"] .grad-text {
      background: linear-gradient(135deg, ${hex}, ${lighter}) !important;
      -webkit-background-clip: text !important;
      background-clip: text !important;
      -webkit-text-fill-color: transparent !important;
    }
  `;
}

function lightenHex(hex, amt) {
  try {
    const m = /^#?([a-f0-9]{6})$/i.exec(hex);
    if (!m) return hex;
    const v = parseInt(m[1], 16);
    let r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff;
    r = Math.min(255, r + Math.round((255 - r) * amt));
    g = Math.min(255, g + Math.round((255 - g) * amt));
    b = Math.min(255, b + Math.round((255 - b) * amt));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  } catch { return hex; }
}

function setupCustomAccent() {
  const picker = document.getElementById('midnight-custom-color');
  const hexInput = document.getElementById('midnight-custom-hex');
  const apply = document.getElementById('midnight-custom-apply');
  const clearBtn = document.getElementById('midnight-custom-clear');
  if (!picker || !hexInput || !apply || !clearBtn) return;

  // Sync picker ↔ hex input
  picker.addEventListener('input', () => { hexInput.value = picker.value.toUpperCase(); });
  hexInput.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value)) picker.value = hexInput.value;
  });

  apply.addEventListener('click', () => {
    const hex = hexInput.value.trim() || picker.value;
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { toast('Use #RRGGBB hex format', 'error'); return; }
    applyMidnightCustomCss(hex);
    bridge.applyMidnightCustomColor(hex);
    bridge.unlockAchievement('theme_painter');
    showAchievementToast('theme_painter');
    toast(`Custom accent applied: ${hex}`, 'success');
  });

  clearBtn.addEventListener('click', () => {
    applyMidnightCustomCss('');
    bridge.applyMidnightCustomColor('');
    hexInput.value = '';
    toast('Custom accent reset', 'info');
  });
}

// ---- Stream-safe + Ghost mode wiring (Overlay tab) ---------------------
function setupOverlayPhase1Toggles() {
  const ghost = document.getElementById('overlay-ghost-mode');
  const stream = document.getElementById('overlay-stream-safe');
  if (ghost) {
    ghost.addEventListener('change', () => bridge.setOverlayGhostMode(ghost.checked));
  }
  if (stream) {
    stream.addEventListener('change', () => bridge.setOverlayStreamSafe(stream.checked));
  }
}

// ---- Per-app preset prompt ---------------------------------------------
let _pendingPerAppCfg = null;
const _promptedThisSession = new Set();   // don't re-pop per session

function maybePromptPerAppPreset(name) {
  try {
    if (_promptedThisSession.has(name)) return;
    // Honor the auto_load_per_app_preset setting
    const enabled = (appSettings.auto_load_per_app_preset !== false);
    if (!enabled) return;
    bridge.getPerAppPreset(name).then((raw) => {
      if (!raw) return;
      let cfg;
      try { cfg = JSON.parse(raw); } catch { return; }
      if (!cfg || typeof cfg !== 'object') return;
      // Only prompt if the saved preset has at least one function enabled —
      // otherwise restoring "everything off" is pointless noise
      const hasAny = !!(cfg.lag_on || cfg.drop_on || cfg.throttle_on
                       || cfg.freeze_on || cfg.block_on || cfg.fun_on);
      if (!hasAny) return;
      _pendingPerAppCfg = cfg;
      _promptedThisSession.add(name);
      document.getElementById('per-app-prompt-name').textContent = name;
      document.getElementById('per-app-prompt').hidden = false;
    });
  } catch (e) { /* swallow */ }
}

function setupPerAppPrompt() {
  const accept = document.getElementById('per-app-prompt-accept');
  const decline = document.getElementById('per-app-prompt-decline');
  const modal = document.getElementById('per-app-prompt');
  if (!accept || !decline || !modal) return;
  accept.addEventListener('click', () => {
    if (_pendingPerAppCfg) {
      applyConfigToUI(_pendingPerAppCfg);
      pushConfig();
      toast('Loaded saved configuration', 'success');
    }
    _pendingPerAppCfg = null;
    modal.hidden = true;
  });
  decline.addEventListener('click', () => {
    _pendingPerAppCfg = null;
    modal.hidden = true;
  });
}

// ---- Achievements -------------------------------------------------------
const ACHIEVEMENTS = {
  first_drop:        { name:'First Drop',        icon:'💧', desc:'Drop your first packet' },
  first_freeze:      { name:'First Freeze',      icon:'❄️', desc:'Hold your first packet' },
  frozen_solid:      { name:'Frozen Solid',      icon:'🧊', desc:'Hold 100 packets in one session' },
  net_slayer:        { name:'Net Slayer',        icon:'🗡️', desc:'Affect 10,000 packets total' },
  big_freeze:        { name:'Big Freeze',        icon:'🥶', desc:'Held 1,000 packets in one session' },
  discord_disrupter: { name:'Discord Disrupter', icon:'🎯', desc:'Targeted Discord.exe' },
  multi_tasker:      { name:'Multi-Tasker',      icon:'⊕',  desc:'Enabled multi-target mode' },
  theme_painter:     { name:'Theme Painter',     icon:'🎨', desc:'Used the custom accent picker' },
  patience:          { name:'Patience',          icon:'⏳', desc:'Replayed 1,000+ packets' },
  long_run:          { name:'Long Run',          icon:'🏃', desc:'Ran a session for 1 hour' },
};

let _achUnlockedCache = {};
let _sessionStart = 0;
let _replayedTotal = 0;
let _lastHeld = 0;

function refreshAchievementsCache() {
  try {
    bridge.getAchievements().then((raw) => {
      try { _achUnlockedCache = JSON.parse(raw || '{}'); }
      catch { _achUnlockedCache = {}; }
    });
  } catch { _achUnlockedCache = {}; }
}

function isAchUnlocked(id) { return !!_achUnlockedCache[id]; }

function unlockAch(id) {
  if (isAchUnlocked(id)) return;
  _achUnlockedCache[id] = new Date().toISOString();
  bridge.unlockAchievement(id);
  showAchievementToast(id);
}

function showAchievementToast(id) {
  const def = ACHIEVEMENTS[id];
  if (!def) return;
  // Don't fire if it was already in the cache before this call
  // (prevents duplicate toasts when repeatedly calling unlock for same id)
  const c = document.getElementById('achievement-toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'ach-toast';
  t.innerHTML = `
    <div class="at-icon">${def.icon}</div>
    <div class="at-text">
      <div class="at-label">Achievement unlocked</div>
      <div class="at-name">${escapeHtml(def.name)}</div>
      <div class="at-desc">${escapeHtml(def.desc)}</div>
    </div>`;
  c.appendChild(t);
  setTimeout(() => t.classList.add('fading'), 4000);
  setTimeout(() => t.remove(), 4500);
}

function checkAchievementsFromStats(s) {
  // s = stats payload from onStatsChanged
  if (!s) return;
  if (s.dropped > 0 && !isAchUnlocked('first_drop'))   unlockAch('first_drop');
  if (s.held    > 0 && !isAchUnlocked('first_freeze')) unlockAch('first_freeze');
  if (s.held    >= 100 && !isAchUnlocked('frozen_solid')) unlockAch('frozen_solid');
  if (s.held    >= 1000 && !isAchUnlocked('big_freeze'))  unlockAch('big_freeze');
  const total = (s.dropped || 0) + (s.delayed || 0) + (s.held || 0);
  if (total >= 10000 && !isAchUnlocked('net_slayer'))     unlockAch('net_slayer');

  // Track replayed: count packets that decreased from held queue
  if (_lastHeld > s.held) {
    _replayedTotal += (_lastHeld - s.held);
    if (_replayedTotal >= 1000 && !isAchUnlocked('patience')) unlockAch('patience');
  }
  _lastHeld = s.held;

  // Long-run — track session time
  if (s.running && _sessionStart === 0) _sessionStart = Date.now();
  if (!s.running) _sessionStart = 0;
  if (_sessionStart > 0 && (Date.now() - _sessionStart) >= 3600 * 1000
      && !isAchUnlocked('long_run')) {
    unlockAch('long_run');
  }
}

function setupAchievementsModal() {
  const btn = document.getElementById('show-achievements-btn');
  const modal = document.getElementById('achievements-modal');
  if (!btn || !modal) return;
  btn.addEventListener('click', () => {
    // Refresh cache, then render. .then() chain prevents race.
    bridge.getAchievements().then((raw) => {
      try { _achUnlockedCache = JSON.parse(raw || '{}'); }
      catch { _achUnlockedCache = {}; }
      renderAchievementsList();
      modal.hidden = false;
    });
  });
}

function renderAchievementsList() {
  const list = document.getElementById('ach-list');
  const fill = document.getElementById('ach-progress-fill');
  const txt = document.getElementById('ach-progress-text');
  if (!list) return;
  list.innerHTML = '';
  const ids = Object.keys(ACHIEVEMENTS);
  let unlocked = 0;
  ids.forEach(id => {
    const def = ACHIEVEMENTS[id];
    const stamp = _achUnlockedCache[id];
    const isUnlocked = !!stamp;
    if (isUnlocked) unlocked++;
    const stampText = isUnlocked ? new Date(stamp).toLocaleDateString() : '';
    const row = document.createElement('div');
    row.className = 'ach-row' + (isUnlocked ? ' unlocked' : '');
    row.innerHTML = `
      <div class="ach-icon">${def.icon}</div>
      <div class="ach-text">
        <div class="ach-name">${escapeHtml(def.name)}</div>
        <div class="ach-desc">${escapeHtml(def.desc)}</div>
        ${isUnlocked ? `<div class="ach-stamp">Unlocked ${stampText}</div>` : ''}
      </div>`;
    list.appendChild(row);
  });
  if (txt) txt.textContent = `${unlocked} / ${ids.length} unlocked`;
  if (fill) fill.style.width = `${Math.round(unlocked / ids.length * 100)}%`;
}

// ---- Per-app presets list (Behavior tab) -------------------------------
function setupPerAppPresetsList() {
  // Re-rendered every time settings modal opens — see hookSettingsModalOpen
}

function refreshPerAppPresetsList() {
  const container = document.getElementById('per-app-presets-list');
  if (!container) return;
  let entries = [];
  try {
    // appSettings.per_app_presets is the source of truth; loaded fresh from bridge
    // when settings modal opens — for now we use the cached version
    const presets = appSettings.per_app_presets || {};
    entries = Object.keys(presets).sort();
  } catch { entries = []; }
  container.innerHTML = '';
  if (!entries.length) {
    container.innerHTML = '<div class="loading">No saved per-app presets</div>';
    return;
  }
  entries.forEach(name => {
    const row = document.createElement('div');
    row.className = 'papp-row';
    row.innerHTML = `
      <span class="papp-name">${escapeHtml(name)}</span>
      <div class="papp-actions">
        <button class="papp-btn">Apply</button>
        <button class="papp-btn">Update</button>
        <button class="papp-btn danger">Delete</button>
      </div>`;
    const [applyB, updateB, delB] = row.querySelectorAll('.papp-btn');
    applyB.addEventListener('click', () => {
      const raw = bridge.getPerAppPreset(name);
      if (raw) {
        try { applyConfigToUI(JSON.parse(raw)); pushConfig();
              toast(`Applied saved preset for ${name}`, 'success'); } catch {}
      }
    });
    updateB.addEventListener('click', () => {
      const cfg = readCurrentConfig();
      bridge.setPerAppPreset(name, JSON.stringify(cfg));
      // Update the local cache so the list re-renders
      appSettings.per_app_presets = appSettings.per_app_presets || {};
      appSettings.per_app_presets[name] = cfg;
      toast(`Updated preset for ${name}`, 'success');
    });
    delB.addEventListener('click', () => {
      if (!confirm(`Delete saved preset for ${name}?`)) return;
      bridge.deletePerAppPreset(name);
      if (appSettings.per_app_presets) delete appSettings.per_app_presets[name];
      refreshPerAppPresetsList();
    });
    container.appendChild(row);
  });
}

// ---- Auto-save current config as per-app preset ------------------------
// Triggered when:
//   1. User switches apps (saves OUTGOING app's config)
//   2. User stops capture (saves current app's config)
// Only persists if at least one function is on — empty configs would just
// produce useless popups.
function autoSaveCurrentAppPreset() {
  if (!currentApp) return;
  const cfg = readCurrentConfig();
  const hasAny = !!(cfg.lag_on || cfg.drop_on || cfg.throttle_on
                   || cfg.freeze_on || cfg.block_on || cfg.fun_on);
  if (!hasAny) return;
  bridge.setPerAppPreset(currentApp, JSON.stringify(cfg));
  // Cache locally for the per-app list in Settings
  appSettings.per_app_presets = appSettings.per_app_presets || {};
  appSettings.per_app_presets[currentApp] = cfg;
}


// ============================================================================
// PHASE 2 — Connection Inspector, Practice Ping, Recording/Replay,
//            Domain Blocklist, Geo Blocking
// ============================================================================

// ---- Connection Inspector ----------------------------------------------
let _inspectorTimer = null;
let _inspectorPaused = false;
let _inspectorFilter = '';

function openInspector() {
  document.getElementById('inspector-modal').hidden = false;
  refreshInspector();
  // Poll every 600ms while modal is open. The bridge call is cheap —
  // it just reads the in-memory connection_table snapshot.
  if (_inspectorTimer) clearInterval(_inspectorTimer);
  _inspectorTimer = setInterval(() => {
    if (_inspectorPaused) return;
    if (document.getElementById('inspector-modal').hidden) {
      clearInterval(_inspectorTimer);
      _inspectorTimer = null;
      return;
    }
    refreshInspector();
  }, 600);
}

function refreshInspector() {
  bridge.getConnections().then((raw) => {
    let rows = [];
    try { rows = JSON.parse(raw || '[]'); } catch { rows = []; }
    if (_inspectorFilter) {
      const f = _inspectorFilter.toLowerCase();
      rows = rows.filter(r => (r.hostname || '').toLowerCase().includes(f)
                          || (r.remote_addr || '').includes(f)
                          || (r.country || '').toLowerCase().includes(f));
    }
    renderInspectorTable(rows);
  });
}

function renderInspectorTable(rows) {
  const tbody = document.getElementById('insp-tbody');
  const counter = document.getElementById('insp-count');
  if (!tbody) return;
  if (counter) counter.textContent = `${rows.length} connection${rows.length === 1 ? '' : 's'}`;
  // v2.5.2 — keep last rows around so the detail modal can pull rich data
  // when a row is clicked (the click only knows the addr, not the full row).
  _lastInspectorRows = rows;
  if (!rows.length) {
    tbody.innerHTML = `<tr class="insp-empty"><td colspan="8">
      No connections from the targeted app yet — start capture and they'll appear here.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const host = r.hostname
      ? `<span class="insp-host has-tls" title="${escapeHtml(r.hostname)}">${escapeHtml(r.hostname)}</span>`
      : `<span class="insp-host insp-host-fallback">${escapeHtml(r.remote_addr || '(resolving…)')}</span>`;
    // v2.5.2 — data-addr enables row-click-for-detail. Use remote_addr as
    // the stable key (matches what the geo map uses for stable jitter).
    const addr = r.remote_addr || '';
    return `<tr data-addr="${escapeHtml(addr)}">
      <td>${host}</td>
      <td>${escapeHtml(r.remote || '—')}</td>
      <td><span class="insp-cc">${escapeHtml(r.country || 'XX')}</span></td>
      <td>${escapeHtml(r.proto || '—')}</td>
      <td class="insp-bytes up">${formatBytes(r.bytes_out)}</td>
      <td class="insp-bytes down">${formatBytes(r.bytes_in)}</td>
      <td>${formatDuration(r.age_s)}</td>
      <td>${formatDuration(r.idle_s)}</td>
    </tr>`;
  }).join('');

  // v2.5.2 — if the detail modal is open and showing a row that's still in
  // the data, refresh its contents with the latest values (live updates).
  if (_inspDetailOpen && _inspDetailAddr) {
    const fresh = rows.find(r => (r.remote_addr || '') === _inspDetailAddr);
    if (fresh) _populateInspDetail(fresh);
  }
}

// v2.5.2 — Cache + state for click-row-for-detail
let _lastInspectorRows = [];
let _inspDetailOpen = false;
let _inspDetailAddr = null;

function _populateInspDetail(r) {
  const $ = id => document.getElementById(id);
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };

  set('insp-detail-host',
    r.hostname || r.remote_addr || '(unknown)');
  set('insp-detail-addr',
    `${r.remote_addr || '?'}:${r.remote_port || '?'}`);
  set('insp-detail-country',  r.country || 'XX');
  set('insp-detail-proto',    r.proto || '—');
  set('insp-detail-pid',      r.pid != null ? String(r.pid) : '—');
  set('insp-detail-localport',
    r.local_addr
      ? `${r.local_addr}:${r.local_port || '?'}`
      : (r.local_port ? `:${r.local_port}` : '—'));

  set('insp-detail-bytes-out', formatBytes(r.bytes_out || 0));
  set('insp-detail-bytes-in',  formatBytes(r.bytes_in  || 0));
  set('insp-detail-pkts-out',  (r.packets_out || 0).toLocaleString());
  set('insp-detail-pkts-in',   (r.packets_in  || 0).toLocaleString());
  const total = (r.bytes_in || 0) + (r.bytes_out || 0);
  set('insp-detail-total', formatBytes(total));

  set('insp-detail-age',  formatDuration(r.age_s || 0));
  set('insp-detail-idle', formatDuration(r.idle_s || 0));
}

function _openInspDetail(addr) {
  if (!addr) return;
  const r = _lastInspectorRows.find(x => (x.remote_addr || '') === addr);
  if (!r) return;
  _inspDetailAddr = addr;
  _inspDetailOpen = true;
  _populateInspDetail(r);
  const modal = document.getElementById('insp-detail-modal');
  if (modal) modal.hidden = false;
  // Visually mark the active row
  document.querySelectorAll('#insp-tbody tr.insp-row-selected')
    .forEach(el => el.classList.remove('insp-row-selected'));
  const sel = document.querySelector(`#insp-tbody tr[data-addr="${CSS.escape(addr)}"]`);
  if (sel) sel.classList.add('insp-row-selected');
}

function _closeInspDetail() {
  _inspDetailOpen = false;
  _inspDetailAddr = null;
  const modal = document.getElementById('insp-detail-modal');
  if (modal) modal.hidden = true;
  document.querySelectorAll('#insp-tbody tr.insp-row-selected')
    .forEach(el => el.classList.remove('insp-row-selected'));
}

function formatBytes(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/(1024*1024)).toFixed(2)} MB`;
}
function formatDuration(s) {
  if (s < 1) return `<1s`;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s/60)}m${Math.round(s%60)}s`;
  return `${Math.floor(s/3600)}h${Math.floor((s%3600)/60)}m`;
}

function setupInspector() {
  const btn = document.getElementById('open-inspector-btn');
  if (btn) btn.addEventListener('click', openInspector);
  const pause = document.getElementById('insp-pause');
  if (pause) pause.addEventListener('change', (e) => { _inspectorPaused = e.target.checked; });
  const search = document.getElementById('insp-search');
  if (search) search.addEventListener('input', (e) => {
    _inspectorFilter = e.target.value || '';
    refreshInspector();
  });

  // v2.5.2 — Click any row for detail modal (delegated handler on tbody)
  const tbody = document.getElementById('insp-tbody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-addr]');
      if (!tr) return;
      const addr = tr.getAttribute('data-addr');
      if (addr) _openInspDetail(addr);
    });
  }
  // Detail-modal close button
  const detailClose = document.querySelector(
    '#insp-detail-modal [data-close-modal="insp-detail-modal"]');
  if (detailClose) detailClose.addEventListener('click', _closeInspDetail);
  // Click on overlay (outside modal body) → close
  const detailOverlay = document.getElementById('insp-detail-modal');
  if (detailOverlay) detailOverlay.addEventListener('click', (e) => {
    if (e.target === detailOverlay) _closeInspDetail();
  });
  // Copy buttons
  const copyHost = document.getElementById('insp-detail-copy-host');
  if (copyHost) copyHost.addEventListener('click', () => {
    const txt = document.getElementById('insp-detail-host')?.textContent || '';
    if (txt && navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(
        () => toast('Hostname copied', 'success'),
        () => toast('Copy failed', 'error'));
    }
  });
  const copyAddr = document.getElementById('insp-detail-copy-addr');
  if (copyAddr) copyAddr.addEventListener('click', () => {
    const txt = document.getElementById('insp-detail-addr')?.textContent || '';
    if (txt && navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(
        () => toast('Address copied', 'success'),
        () => toast('Copy failed', 'error'));
    }
  });

  // v2.5.2 — Export current connections as CSV (calls backend QFileDialog slot)
  const exportBtn = document.getElementById('insp-export-csv');
  if (exportBtn) exportBtn.addEventListener('click', () => {
    if (!bridge || !bridge.exportConnectionsCSV) {
      toast('Export unavailable in this build', 'error');
      return;
    }
    exportBtn.disabled = true;
    const oldText = exportBtn.textContent;
    exportBtn.textContent = 'Exporting…';
    bridge.exportConnectionsCSV().then((raw) => {
      let res = {};
      try { res = JSON.parse(raw || '{}'); } catch {}
      if (res.cancelled) {
        // User clicked Cancel in the save dialog — silent, no toast
      } else if (res.ok) {
        toast(`Exported ${res.count || 0} connection${res.count === 1 ? '' : 's'}`, 'success');
      } else {
        toast('Export failed: ' + (res.error || 'unknown error'), 'error');
      }
    }).catch((e) => {
      toast('Export error: ' + e, 'error');
    }).finally(() => {
      exportBtn.disabled = false;
      exportBtn.textContent = oldText;
    });
  });
}

// ---- Practice Ping ------------------------------------------------------
let _selectedPingTarget = 0;

function openPracticePing() {
  document.getElementById('pingmode-modal').hidden = false;
  // Reflect current state if practice ping is already active
  const cfg = readCurrentConfig();
  if (cfg.lag_on && cfg.lag_ms) {
    _selectedPingTarget = cfg.lag_ms;
    document.getElementById('ping-custom').value = cfg.lag_ms;
    document.getElementById('ping-custom-display').textContent = `${cfg.lag_ms} ms`;
    updatePingPresetSelection(cfg.lag_ms);
    document.getElementById('ping-status').textContent = `Active: ${cfg.lag_ms}ms target`;
    document.getElementById('ping-status').classList.remove('off');
  } else {
    _selectedPingTarget = 0;
    document.getElementById('ping-custom').value = 0;
    document.getElementById('ping-custom-display').textContent = `0 ms`;
    updatePingPresetSelection(0);
    document.getElementById('ping-status').textContent = 'No practice-ping target active.';
    document.getElementById('ping-status').classList.add('off');
  }
}

function updatePingPresetSelection(ms) {
  document.querySelectorAll('.ping-preset').forEach(p => {
    p.classList.toggle('selected', parseInt(p.dataset.ping, 10) === ms);
  });
}

function setupPracticePing() {
  const btn = document.getElementById('open-pingmode-btn');
  if (btn) btn.addEventListener('click', openPracticePing);

  document.querySelectorAll('.ping-preset').forEach(p => {
    p.addEventListener('click', () => {
      _selectedPingTarget = parseInt(p.dataset.ping, 10) || 0;
      updatePingPresetSelection(_selectedPingTarget);
      document.getElementById('ping-custom').value = _selectedPingTarget;
      document.getElementById('ping-custom-display').textContent = `${_selectedPingTarget} ms`;
    });
  });

  const slider = document.getElementById('ping-custom');
  if (slider) slider.addEventListener('input', () => {
    _selectedPingTarget = parseInt(slider.value, 10) || 0;
    document.getElementById('ping-custom-display').textContent = `${_selectedPingTarget} ms`;
    updatePingPresetSelection(_selectedPingTarget);
  });

  const apply = document.getElementById('ping-apply-btn');
  if (apply) apply.addEventListener('click', () => {
    bridge.applyPracticePing(_selectedPingTarget);
    // Reflect in the lag function module — so the user sees it actually applied
    const cfg = { lag_on: _selectedPingTarget > 0,
                  lag_in: true, lag_out: true,
                  lag_ms: _selectedPingTarget,
                  lag_jitter_ms: Math.min(30, Math.floor(_selectedPingTarget / 10)) };
    applyConfigToUI(cfg);
    pushConfig();
    if (_selectedPingTarget > 0) {
      toast(`Practice ping: ${_selectedPingTarget}ms target applied`, 'success');
      document.getElementById('ping-status').textContent = `Active: ${_selectedPingTarget}ms target`;
      document.getElementById('ping-status').classList.remove('off');
    } else {
      toast('Practice ping cleared', 'info');
      document.getElementById('ping-status').textContent = 'No practice-ping target active.';
      document.getElementById('ping-status').classList.add('off');
    }
    bridge.playSoundEffect('preset');
  });

  const clearBtn = document.getElementById('ping-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    _selectedPingTarget = 0;
    bridge.applyPracticePing(0);
    applyConfigToUI({ lag_on: false, lag_ms: 0, lag_jitter_ms: 0 });
    pushConfig();
    document.getElementById('ping-custom').value = 0;
    document.getElementById('ping-custom-display').textContent = `0 ms`;
    updatePingPresetSelection(0);
    document.getElementById('ping-status').textContent = 'No practice-ping target active.';
    document.getElementById('ping-status').classList.add('off');
    toast('Practice ping cleared', 'info');
  });
}

// ---- Recording / Replay -------------------------------------------------
let _recording = false;

function setupRecording() {
  const btn = document.getElementById('record-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (_recording) {
      bridge.stopRecording().then((path) => {
        _recording = false;
        btn.classList.remove('active');
        if (path) {
          toast(`Recording saved — open View recordings to play it back`, 'success');
        } else {
          toast('Recording stopped (nothing to save)', 'info');
        }
      });
    } else {
      bridge.startRecording().then((ok) => {
        if (ok) {
          _recording = true;
          btn.classList.add('active');
          toast('Recording started — hit Record again to stop & save', 'success');
        } else {
          toast('Could not start recording', 'error');
        }
      });
    }
  });

  const replayBtn = document.getElementById('open-replay-btn');
  if (replayBtn) replayBtn.addEventListener('click', openRecordings);

  const back = document.getElementById('rv-back');
  if (back) back.addEventListener('click', () => {
    stopReplayPlayback();
    document.getElementById('replay-viewer').hidden = true;
    document.getElementById('recordings-list').hidden = false;
  });

  const scrub = document.getElementById('rv-scrub');
  if (scrub) {
    scrub.addEventListener('input', () => {
      stopReplayPlayback();
      renderReplayFrame(parseInt(scrub.value, 10));
    });
  }

  const playBtn = document.getElementById('rv-play-btn');
  if (playBtn) playBtn.addEventListener('click', toggleReplayPlayback);

  const folderBtn = document.getElementById('open-recordings-folder');
  if (folderBtn) folderBtn.addEventListener('click', () => {
    bridge.openRecordingsFolder().then((ok) => {
      if (!ok) toast('Could not open folder', 'error');
    });
  });
}

let _replayPlayTimer = null;

function toggleReplayPlayback() {
  if (_replayPlayTimer) {
    stopReplayPlayback();
  } else {
    startReplayPlayback();
  }
}

function startReplayPlayback() {
  if (!_currentReplay || !_currentReplay.frames) return;
  const scrub = document.getElementById('rv-scrub');
  const playBtn = document.getElementById('rv-play-btn');
  const playIcon = document.getElementById('rv-play-icon');
  const speedSel = document.getElementById('rv-speed');
  const frames = _currentReplay.frames;
  // If we're at the end, restart from frame 0
  if (parseInt(scrub.value, 10) >= frames.length - 1) {
    scrub.value = 0;
    renderReplayFrame(0);
  }
  playBtn.classList.add('playing');
  playIcon.setAttribute('data-icon', 'pause');
  playIcon.setAttribute('data-icon-needs-render', '1');
  renderIcons(playIcon.parentElement);

  let lastTickWall = performance.now();
  _replayPlayTimer = setInterval(() => {
    const speed = parseFloat(speedSel.value) || 1;
    const idx = parseInt(scrub.value, 10);
    if (idx >= frames.length - 1) {
      stopReplayPlayback();
      return;
    }
    const cur = frames[idx];
    const next = frames[idx + 1];
    const realDelta = (next.t - cur.t);              // ms in recorded time
    const wallNow = performance.now();
    const wallDelta = wallNow - lastTickWall;        // ms wall-clock since last tick
    if (wallDelta * speed >= realDelta) {
      scrub.value = idx + 1;
      renderReplayFrame(idx + 1);
      lastTickWall = wallNow;
    }
  }, 30);
}

function stopReplayPlayback() {
  if (_replayPlayTimer) clearInterval(_replayPlayTimer);
  _replayPlayTimer = null;
  const playBtn = document.getElementById('rv-play-btn');
  const playIcon = document.getElementById('rv-play-icon');
  if (playBtn) playBtn.classList.remove('playing');
  if (playIcon) {
    playIcon.setAttribute('data-icon', 'play');
    playIcon.setAttribute('data-icon-needs-render', '1');
    renderIcons(playIcon.parentElement);
  }
}

function openRecordings() {
  document.getElementById('replay-modal').hidden = false;
  document.getElementById('replay-viewer').hidden = true;
  document.getElementById('recordings-list').hidden = false;
  refreshRecordings();
}

function refreshRecordings() {
  bridge.listRecordings().then((raw) => {
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch { list = []; }
    const container = document.getElementById('recordings-list');
    if (!container) return;
    if (!list.length) {
      container.innerHTML = '<div class="loading">No recordings yet — hit Record to capture a session.</div>';
      return;
    }
    container.innerHTML = '';
    list.forEach(rec => {
      const row = document.createElement('div');
      row.className = 'rec-row';
      const date = new Date(rec.mtime * 1000).toLocaleString();
      const sizeKB = (rec.size / 1024).toFixed(1);
      row.innerHTML = `
        <div class="rec-name">${escapeHtml(rec.name)}</div>
        <div class="rec-meta">${date} · ${sizeKB} KB</div>
        <button type="button" class="rec-edit" title="Open in Throttlr Studio">Edit</button>
        <button type="button" class="rec-del">Delete</button>`;
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('rec-del')) {
          e.stopPropagation();
          if (confirm(`Delete recording "${rec.name}"?`)) {
            bridge.deleteRecording(rec.path).then(() => refreshRecordings());
          }
          return;
        }
        if (e.target.classList.contains('rec-edit')) {
          // Phase 4 — open in Throttlr Studio
          e.stopPropagation();
          // Close the recordings modal first so Studio gets focus
          const replayModal = document.getElementById('replay-modal');
          if (replayModal) replayModal.hidden = true;
          if (typeof window._studioOpen === 'function') {
            window._studioOpen(rec.path);
          } else {
            toast('Studio not available', 'error');
          }
          return;
        }
        loadAndShowReplay(rec.path);
      });
      container.appendChild(row);
    });
  });
}

let _currentReplay = null;

function loadAndShowReplay(path) {
  bridge.loadRecording(path).then((raw) => {
    let data = null;
    try { data = JSON.parse(raw || '{}'); } catch { data = null; }
    if (!data || !data.frames || !data.frames.length) {
      toast('Recording is empty or corrupted', 'error');
      return;
    }
    _currentReplay = data;
    document.getElementById('recordings-list').hidden = true;
    document.getElementById('replay-viewer').hidden = false;
    document.getElementById('rv-title').textContent =
      `${data.target || 'Session'} — ${data.frames.length} frames`;
    const scrub = document.getElementById('rv-scrub');
    scrub.min = 0;
    scrub.max = data.frames.length - 1;
    scrub.value = 0;
    renderReplayFrame(0);
  });
}

function renderReplayFrame(idx) {
  if (!_currentReplay) return;
  const f = _currentReplay.frames[idx];
  if (!f) return;
  const s = f.stats || {};
  document.getElementById('rv-seen').textContent     = (s.seen || 0).toLocaleString();
  document.getElementById('rv-dropped').textContent  = (s.dropped || 0).toLocaleString();
  document.getElementById('rv-delayed').textContent  = (s.delayed || 0).toLocaleString();
  document.getElementById('rv-held').textContent     = (s.held || 0).toLocaleString();
  const t = (f.t || 0) / 1000;
  const mm = Math.floor(t / 60).toString().padStart(2, '0');
  const ss = Math.floor(t % 60).toString().padStart(2, '0');
  document.getElementById('rv-time').textContent = `${mm}:${ss}`;
  // Drive the slider's gradient fill
  const scrub = document.getElementById('rv-scrub');
  const total = _currentReplay.frames.length - 1;
  const pct = total > 0 ? Math.round((idx / total) * 100) : 0;
  if (scrub) scrub.style.setProperty('--rv-progress', pct + '%');
  // Walk back to find the most recent config snapshot
  let cfg = null;
  for (let i = idx; i >= 0; i--) {
    if (_currentReplay.frames[i].config) { cfg = _currentReplay.frames[i].config; break; }
  }
  const cfgEl = document.getElementById('rv-config');
  if (cfg) {
    const parts = [];
    if (cfg.lag_on)          parts.push(`<span class="rvc-on">Lag</span> ${cfg.lag_ms || 0}ms`);
    if (cfg.drop_on)         parts.push(`<span class="rvc-on">Drop</span> ${cfg.drop_chance || 0}%${cfg.drop_dns_only?' DNS':''}`);
    if (cfg.throttle_on)     parts.push(`<span class="rvc-on">Throttle</span> ${cfg.throttle_kbps || 0} KB/s`);
    if (cfg.freeze_on)       parts.push(`<span class="rvc-on">Freeze</span>`);
    if (cfg.block_on)        parts.push(`<span class="rvc-on">Block</span>`);
    if (cfg.fun_on)          parts.push(`<span class="rvc-on">Fun</span>`);
    if (cfg.domain_block_on) parts.push(`<span class="rvc-on">Domain block</span>`);
    if (cfg.geo_block_on)    parts.push(`<span class="rvc-on">Geo block</span>`);
    cfgEl.innerHTML = parts.length ? parts.join(' · ') : '(no functions active)';
  } else {
    cfgEl.innerHTML = '(no config snapshot at this frame)';
  }
}

// ---- Domain Blocklist ---------------------------------------------------
function setupDomainBlock() {
  const btn = document.getElementById('domain-block-config-btn');
  const toggle = document.getElementById('domain-block-toggle');
  if (btn) btn.addEventListener('click', openDomainBlockModal);
  if (toggle) toggle.addEventListener('change', () => {
    bridge.setDomainBlockOn(toggle.checked);
    const card = toggle.closest('.func-mod');
    if (card) card.classList.toggle('active', toggle.checked);
    updateDomainBlockSummary();
    if (toggle.checked) bridge.playSoundEffect('drop');
  });
  const save = document.getElementById('domain-block-save-btn');
  if (save) save.addEventListener('click', saveDomainBlockConfig);
}

function openDomainBlockModal() {
  bridge.getDomainBlocklistInfo().then((raw) => {
    let info = {};
    try { info = JSON.parse(raw || '{}'); } catch { info = {}; }
    const lists = info.available || {};
    const active = new Set(info.active_lists || []);
    const container = document.getElementById('block-lists');
    container.innerHTML = '';
    Object.keys(lists).forEach(name => {
      const meta = lists[name];
      const row = document.createElement('label');
      row.className = 'bl-row';
      row.innerHTML = `
        <input type="checkbox" data-list="${name}" ${active.has(name) ? 'checked' : ''}>
        <span class="bl-name">${name}</span>
        <span class="bl-meta">${(meta.sample || []).slice(0, 4).join(', ')}…</span>
        <span class="bl-count">${meta.count}</span>`;
      container.appendChild(row);
    });
    document.getElementById('block-custom-text').value =
      (info.custom || []).join('\n');
    document.getElementById('domain-block-modal').hidden = false;
  });
}

function saveDomainBlockConfig() {
  const lists = [];
  document.querySelectorAll('#block-lists input[type="checkbox"]').forEach(cb => {
    if (cb.checked) lists.push(cb.dataset.list);
  });
  const customText = document.getElementById('block-custom-text').value || '';
  const custom = customText.split('\n').map(s => s.trim()).filter(Boolean);
  bridge.setDomainBlockLists(JSON.stringify(lists));
  bridge.setDomainBlockCustom(JSON.stringify(custom));
  document.getElementById('domain-block-modal').hidden = true;
  updateDomainBlockSummary();
  toast(`Blocklist saved — ${lists.length} list${lists.length===1?'':'s'} + ${custom.length} custom`, 'success');
}

function updateDomainBlockSummary() {
  bridge.getDomainBlocklistInfo().then((raw) => {
    let info = {};
    try { info = JSON.parse(raw || '{}'); } catch { info = {}; }
    const sub = document.getElementById('domain-block-summary');
    if (!sub) return;
    const lists = info.active_lists || [];
    const custom = info.custom || [];
    const toggle = document.getElementById('domain-block-toggle');
    if (toggle) {
      toggle.checked = !!info.on;
      const card = toggle.closest('.func-mod');
      if (card) card.classList.toggle('active', !!info.on);
    }
    if (!lists.length && !custom.length) {
      sub.textContent = 'No lists active — click Configure to choose';
    } else {
      const parts = [];
      if (lists.length) parts.push(lists.join(' + '));
      if (custom.length) parts.push(`${custom.length} custom`);
      sub.textContent = `Active: ${parts.join(' · ')}`;
    }
  });
}

// ---- Geo Blocking -------------------------------------------------------
const GEO_REGIONS = [
  { cc:'US', name:'United States', flag:'🇺🇸' },
  { cc:'EU', name:'Europe',        flag:'🇪🇺' },
  { cc:'GB', name:'UK',            flag:'🇬🇧' },
  { cc:'DE', name:'Germany',       flag:'🇩🇪' },
  { cc:'CA', name:'Canada',        flag:'🇨🇦' },
  { cc:'JP', name:'Japan',         flag:'🇯🇵' },
  { cc:'CN', name:'China',         flag:'🇨🇳' },
  { cc:'AP', name:'Asia/Pacific',  flag:'🌏' },
  { cc:'AF', name:'Africa',        flag:'🌍' },
  { cc:'BR', name:'Brazil',        flag:'🇧🇷' },
  { cc:'LATAM', name:'Latin Am.',  flag:'🌎' },
  { cc:'XX', name:'Unknown',       flag:'❓' },
];

let _selectedCountries = new Set();

function setupGeoBlock() {
  const btn = document.getElementById('geo-block-config-btn');
  const toggle = document.getElementById('geo-block-toggle');
  if (btn) btn.addEventListener('click', openGeoBlockModal);
  if (toggle) toggle.addEventListener('change', () => {
    bridge.setGeoBlockOn(toggle.checked);
    const card = toggle.closest('.func-mod');
    if (card) card.classList.toggle('active', toggle.checked);
    updateGeoBlockSummary();
    if (toggle.checked) bridge.playSoundEffect('block');
  });
  const save = document.getElementById('geo-block-save-btn');
  if (save) save.addEventListener('click', saveGeoBlockConfig);
}

function openGeoBlockModal() {
  bridge.getGeoBlockState().then((raw) => {
    let state = {};
    try { state = JSON.parse(raw || '{}'); } catch { state = {}; }
    _selectedCountries = new Set(state.countries || []);
    const grid = document.getElementById('country-grid');
    grid.innerHTML = '';
    GEO_REGIONS.forEach(c => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'country-tile' + (_selectedCountries.has(c.cc) ? ' selected' : '');
      tile.dataset.cc = c.cc;
      tile.innerHTML = `
        <div class="ct-flag">${c.flag}</div>
        <div class="ct-name">${c.name}</div>
        <div class="ct-cc">${c.cc}</div>`;
      tile.addEventListener('click', () => {
        if (_selectedCountries.has(c.cc)) _selectedCountries.delete(c.cc);
        else _selectedCountries.add(c.cc);
        tile.classList.toggle('selected', _selectedCountries.has(c.cc));
      });
      grid.appendChild(tile);
    });
    document.getElementById('geo-block-modal').hidden = false;
  });
}

function saveGeoBlockConfig() {
  const arr = Array.from(_selectedCountries);
  bridge.setGeoBlockCountries(JSON.stringify(arr));
  document.getElementById('geo-block-modal').hidden = true;
  updateGeoBlockSummary();
  toast(`Geo block: ${arr.length} region${arr.length === 1 ? '' : 's'} selected`, 'success');
}

function updateGeoBlockSummary() {
  bridge.getGeoBlockState().then((raw) => {
    let state = {};
    try { state = JSON.parse(raw || '{}'); } catch { state = {}; }
    const sub = document.getElementById('geo-block-summary');
    if (!sub) return;
    const list = state.countries || [];
    const toggle = document.getElementById('geo-block-toggle');
    if (toggle) {
      toggle.checked = !!state.on;
      const card = toggle.closest('.func-mod');
      if (card) card.classList.toggle('active', !!state.on);
    }
    if (!list.length) {
      sub.textContent = 'No regions selected — click Pick countries';
    } else {
      sub.textContent = `Blocking: ${list.join(', ')}`;
    }
  });
}


// ============================================================================
// PHASE 3 — Network Topology, PCAP capture, Filter Scripting
// ============================================================================

// ---- Topology (canvas-based force graph) -------------------------------
let _topoTimer = null;
let _topoNodes = [];
let _topoCenter = { x: 0, y: 0 };
let _topoHover = null;
let _topoData = null;
let _topoFrame = 0;
// v2.5.2 — track previous bytes per addr so we can detect "active vs idle"
// (a node whose byte counts didn't change between refreshes is idle)
const _topoPrevBytes = new Map();   // addr → { in, out, lastChangedAt (frame) }

function setupTopology() {
  const btn = document.getElementById('open-topology-btn');
  if (btn) btn.addEventListener('click', openTopology);
  const canvas = document.getElementById('topo-canvas');
  if (!canvas) return;
  canvas.addEventListener('mousemove', onTopoMouseMove);
  canvas.addEventListener('mouseleave', () => {
    _topoHover = null;
    document.getElementById('topo-info').innerHTML =
      '<div class="topo-info-empty">Hover a node for details</div>';
  });
  // v2.5.2 — click any node to open the same connection-detail modal as the Inspector
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let hit = null;
    for (const n of _topoNodes) {
      const r = 8 + Math.min(8, n.weight * 1.2);
      const dx = n.x - mx, dy = n.y - my;
      if (dx * dx + dy * dy <= (r + 2) * (r + 2)) { hit = n; break; }
    }
    if (!hit) return;
    // Reuse the Inspector detail modal by injecting the topology row shape
    // into the row cache and calling the existing populator.
    const row = {
      remote_addr: hit.addr,
      remote_port: (hit.ports && hit.ports[0]) || 0,
      hostname:    hit.host || '',
      country:     hit.country || '',
      proto:       hit.proto || '',
      pid:         null,
      local_addr:  '',
      local_port:  0,
      bytes_in:    hit.bytes_in || 0,
      bytes_out:   hit.bytes_out || 0,
      packets_in:  0,
      packets_out: 0,
      age_s:       0,
      idle_s:      0,
    };
    if (Array.isArray(_lastInspectorRows)) {
      // Replace any existing entry with same addr, otherwise prepend
      const idx = _lastInspectorRows.findIndex(x => (x.remote_addr || '') === row.remote_addr);
      if (idx >= 0) _lastInspectorRows[idx] = row;
      else _lastInspectorRows = [row, ..._lastInspectorRows];
    }
    if (typeof _openInspDetail === 'function') {
      _openInspDetail(row.remote_addr);
    }
  });
}

function openTopology() {
  document.getElementById('topology-modal').hidden = false;
  // Size canvas to its container after layout settles
  setTimeout(() => {
    const canvas = document.getElementById('topo-canvas');
    const cont = canvas.parentElement;
    canvas.width  = cont.clientWidth;
    canvas.height = cont.clientHeight;
    _topoCenter = { x: canvas.width / 2, y: canvas.height / 2 };
    refreshTopology();
  }, 50);
  if (_topoTimer) clearInterval(_topoTimer);
  _topoTimer = setInterval(() => {
    if (document.getElementById('topology-modal').hidden) {
      clearInterval(_topoTimer); _topoTimer = null;
      cancelAnimationFrame(_topoRafId);
      return;
    }
    refreshTopology();
  }, 1000);
  _topoRafId = requestAnimationFrame(animateTopo);
}

function refreshTopology() {
  bridge.getTopology().then((raw) => {
    let data = { target: '', nodes: [] };
    try { data = JSON.parse(raw || '{}'); } catch {}
    _topoData = data;
    layoutTopology(data.nodes || []);
  });
}

function layoutTopology(nodes) {
  // v2.5.2 — Cluster nodes by country so connections to the same country
  // appear near each other (prior version placed every node at a hash-derived
  // angle around the center, which scattered countries randomly).
  // Strategy:
  //   1. Group nodes by country code
  //   2. Each country gets a "wedge" of the circle proportional to its share
  //   3. Within a wedge, individual nodes spread out by their addr hash
  // Nodes without a country code (private IPs, lookup failures) get their own
  // wedge labelled "—".
  const canvas = document.getElementById('topo-canvas');
  if (!canvas) return;
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  _topoCenter = { x: cx, y: cy };

  const radius = Math.min(w, h) * 0.36;
  const previous = new Map(_topoNodes.map(n => [n.addr, n]));

  // Bucket by country
  const buckets = new Map();   // cc → array of nodes
  nodes.forEach(n => {
    const cc = (n.country || '—').toUpperCase();
    if (!buckets.has(cc)) buckets.set(cc, []);
    buckets.get(cc).push(n);
  });
  // Sort buckets by country code so wedge order is stable across refreshes
  const bucketEntries = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const total = nodes.length || 1;
  let cursorAngle = -Math.PI / 2;   // start at top

  const newNodes = [];
  bucketEntries.forEach(([cc, group]) => {
    const wedgeSpan = (group.length / total) * Math.PI * 2;
    // Sort within bucket by addr for stable order
    group.sort((a, b) => (a.addr || '').localeCompare(b.addr || ''));

    group.forEach((n, i) => {
      const addr = n.addr || `${cc}-${i}`;
      // Position within the wedge: spread evenly with a small addr-hash offset
      // for visual variety. Single-element wedges go in the wedge center.
      const localFrac = group.length === 1 ? 0.5 : (i + 0.5) / group.length;
      // Hash addr → small radial variation so nodes don't all sit on the same ring
      let h2 = 5381;
      for (let c = 0; c < addr.length; c++) h2 = ((h2 << 5) + h2 + addr.charCodeAt(c)) | 0;
      const radialJitter = ((Math.abs(h2) % 100) / 100 - 0.5) * 30;  // ±15px
      const r = radius + radialJitter;

      const angle = cursorAngle + wedgeSpan * localFrac;
      const tx = cx + Math.cos(angle) * r;
      const ty = cy + Math.sin(angle) * r;
      const prev = previous.get(addr);

      // v2.5.2 — track byte changes for idle detection
      const prevBytes = _topoPrevBytes.get(addr);
      const totalBytes = (n.bytes_in || 0) + (n.bytes_out || 0);
      const prevTotal = prevBytes ? (prevBytes.in + prevBytes.out) : 0;
      let lastChangedFrame = prevBytes ? prevBytes.lastChangedFrame : _topoFrame;
      if (totalBytes !== prevTotal) lastChangedFrame = _topoFrame;
      _topoPrevBytes.set(addr, {
        in: n.bytes_in || 0, out: n.bytes_out || 0, lastChangedFrame,
      });

      newNodes.push({
        ...n,
        x: prev ? prev.x : tx + (Math.random() - 0.5) * 40,
        y: prev ? prev.y : ty + (Math.random() - 0.5) * 40,
        tx, ty,
        weight: Math.log10(totalBytes || 1),
        // Wedge-center info for cluster labels
        wedgeCenterAngle: cursorAngle + wedgeSpan / 2,
        wedgeCC: cc,
        lastChangedFrame,
      });
    });
    cursorAngle += wedgeSpan;
  });

  _topoNodes = newNodes;

  // Garbage-collect _topoPrevBytes for addresses that are no longer present
  const liveAddrs = new Set(newNodes.map(n => n.addr));
  for (const k of [..._topoPrevBytes.keys()]) {
    if (!liveAddrs.has(k)) _topoPrevBytes.delete(k);
  }
}

let _topoRafId = null;
function animateTopo() {
  const canvas = document.getElementById('topo-canvas');
  if (!canvas) return;
  if (document.getElementById('topology-modal').hidden) {
    cancelAnimationFrame(_topoRafId);
    return;
  }
  const ctx = canvas.getContext('2d');
  _topoFrame++;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Animated background grid — very subtle
  ctx.strokeStyle = 'rgba(255,184,0,0.04)';
  ctx.lineWidth = 1;
  const gridSpacing = 40;
  for (let x = 0; x < w; x += gridSpacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += gridSpacing) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Smooth node positions toward target
  for (const n of _topoNodes) {
    n.x += (n.tx - n.x) * 0.10;
    n.y += (n.ty - n.y) * 0.10;
  }

  // Draw edges with bidirectional flow indicators (v2.5.2)
  // Outbound dots travel from center → node (yellow), inbound from node → center (cyan).
  // Idle nodes (byte counts unchanged for >5 frames ≈ 5 seconds at 1Hz refresh)
  // get faded edges + dimmed dots so the eye can pick out active connections.
  for (const n of _topoNodes) {
    const idleFrames = _topoFrame - (n.lastChangedFrame || _topoFrame);
    const isIdle = idleFrames > 5;
    const fade = isIdle ? 0.35 : 1.0;

    const thickness = Math.max(1, Math.min(4, n.weight - 1));
    const grad = ctx.createLinearGradient(_topoCenter.x, _topoCenter.y, n.x, n.y);
    grad.addColorStop(0, `rgba(255,184,0,${0.45 * fade})`);
    grad.addColorStop(1, `rgba(102,221,255,${0.25 * fade})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(_topoCenter.x, _topoCenter.y);
    ctx.lineTo(n.x, n.y);
    ctx.stroke();

    // Skip animated dots entirely for idle edges — keeps the eye on active ones
    if (isIdle) continue;

    // Outbound flow (center → node): yellow
    const outPhase = ((_topoFrame * 0.012) + (Math.abs(n.x - _topoCenter.x) * 0.001)) % 1;
    const ox = _topoCenter.x + (n.x - _topoCenter.x) * outPhase;
    const oy = _topoCenter.y + (n.y - _topoCenter.y) * outPhase;
    if (n.bytes_out > 0) {
      ctx.fillStyle = 'rgba(255,184,0,0.95)';
      ctx.beginPath(); ctx.arc(ox, oy, 2.8, 0, Math.PI * 2); ctx.fill();
    }

    // Inbound flow (node → center): cyan, offset phase so they don't sync
    const inPhase = ((_topoFrame * 0.012 + 0.5) + (Math.abs(n.x - _topoCenter.x) * 0.001)) % 1;
    const ix = n.x + (_topoCenter.x - n.x) * inPhase;
    const iy = n.y + (_topoCenter.y - n.y) * inPhase;
    if (n.bytes_in > 0) {
      ctx.fillStyle = 'rgba(102,221,255,0.95)';
      ctx.beginPath(); ctx.arc(ix, iy, 2.8, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Draw remote nodes (with idle fade applied)
  for (const n of _topoNodes) {
    const idleFrames = _topoFrame - (n.lastChangedFrame || _topoFrame);
    const isIdle = idleFrames > 5;
    const fade = isIdle ? 0.45 : 1.0;

    const r = 8 + Math.min(8, n.weight * 1.2);
    const isHover = _topoHover && _topoHover.addr === n.addr;
    // Glow
    ctx.shadowColor = isHover ? '#ffb800' : `rgba(102,221,255,${0.55 * fade})`;
    ctx.shadowBlur = isHover ? 18 : 8 * fade;
    ctx.fillStyle = isHover
      ? '#ffb800'
      : (isIdle ? 'rgba(102,221,255,0.45)' : '#66ddff');
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // Country code badge
    if (n.country) {
      ctx.font = "bold 9px 'JetBrains Mono', 'Consolas', monospace";
      ctx.fillStyle = isIdle ? 'rgba(7,9,10,0.6)' : '#07090a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.country, n.x, n.y);
    }
    // Hostname/IP label below
    const label = n.host || n.addr;
    ctx.font = "11px 'Consolas', monospace";
    ctx.fillStyle = isHover ? '#fff'
                            : `rgba(232,230,216,${0.75 * fade})`;
    ctx.textAlign = 'center';
    ctx.fillText(label.length > 28 ? label.slice(0, 27) + '…' : label,
                 n.x, n.y + r + 14);
  }

  // Draw center node (your machine)
  const centerR = 22;
  ctx.shadowColor = '#ffb800';
  ctx.shadowBlur = 20 + Math.sin(_topoFrame * 0.05) * 4;
  ctx.fillStyle = '#ffb800';
  ctx.beginPath();
  ctx.arc(_topoCenter.x, _topoCenter.y, centerR, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Inner ring
  ctx.strokeStyle = '#07090a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(_topoCenter.x, _topoCenter.y, centerR - 5, 0, Math.PI * 2);
  ctx.stroke();
  // Target name
  ctx.font = "bold 11px 'JetBrains Mono', monospace";
  ctx.fillStyle = '#07090a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('YOU', _topoCenter.x, _topoCenter.y);
  // Target app label
  if (_topoData && _topoData.target) {
    ctx.font = "11px 'Consolas', monospace";
    ctx.fillStyle = 'rgba(232,230,216,0.85)';
    ctx.fillText(_topoData.target, _topoCenter.x, _topoCenter.y + centerR + 16);
  }

  // Empty state
  if (!_topoNodes.length) {
    ctx.font = "italic 13px 'Consolas', monospace";
    ctx.fillStyle = 'rgba(232,230,216,0.45)';
    ctx.textAlign = 'center';
    ctx.fillText('No active connections — start capture to see the graph populate.',
                 w / 2, h - 30);
  }

  _topoRafId = requestAnimationFrame(animateTopo);
}

function onTopoMouseMove(e) {
  const canvas = document.getElementById('topo-canvas');
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);
  let hit = null;
  for (const n of _topoNodes) {
    const r = 8 + Math.min(8, n.weight * 1.2) + 4;
    const dx = mx - n.x, dy = my - n.y;
    if (dx*dx + dy*dy <= r*r) { hit = n; break; }
  }
  _topoHover = hit;
  const info = document.getElementById('topo-info');
  if (!info) return;
  if (!hit) {
    info.innerHTML = '<div class="topo-info-empty">Hover a node for details</div>';
    return;
  }
  info.innerHTML = `
    <div class="ti-host">${escapeHtml(hit.host || hit.addr)}</div>
    <div class="ti-row"><span>IP</span><span>${escapeHtml(hit.addr)}</span></div>
    <div class="ti-row"><span>Country</span><span>${escapeHtml(hit.country || '—')}</span></div>
    <div class="ti-row"><span>Protocol</span><span>${escapeHtml(hit.proto || '—')}</span></div>
    <div class="ti-row"><span>Connections</span><span>${hit.conns}</span></div>
    <div class="ti-row"><span>Ports</span><span>${(hit.ports || []).join(', ') || '—'}</span></div>
    <div class="ti-row"><span>↑ Out</span><span>${formatBytes(hit.bytes_out)}</span></div>
    <div class="ti-row"><span>↓ In</span><span>${formatBytes(hit.bytes_in)}</span></div>`;
}

// ---- PCAP capture ------------------------------------------------------
let _pcapTimer = null;

function setupPcap() {
  const btn = document.getElementById('open-pcap-btn');
  if (btn) btn.addEventListener('click', openPcap);
  const toggle = document.getElementById('pcap-toggle-btn');
  if (toggle) toggle.addEventListener('click', togglePcap);
  const folder = document.getElementById('open-pcap-folder');
  if (folder) folder.addEventListener('click', () => {
    bridge.openPcapFolder().then((ok) => {
      if (!ok) toast('Could not open folder', 'error');
    });
  });
}

function openPcap() {
  document.getElementById('pcap-modal').hidden = false;
  refreshPcapStatus();
  refreshPcapList();
  if (_pcapTimer) clearInterval(_pcapTimer);
  _pcapTimer = setInterval(() => {
    if (document.getElementById('pcap-modal').hidden) {
      clearInterval(_pcapTimer); _pcapTimer = null; return;
    }
    refreshPcapStatus();
  }, 500);
}

function togglePcap() {
  bridge.isPcapRecording().then((isRec) => {
    if (isRec) {
      bridge.stopPcap().then((path) => {
        toast(path ? 'PCAP saved' : 'PCAP stopped', 'success');
        refreshPcapStatus();
        refreshPcapList();
      });
    } else {
      bridge.startPcap().then((ok) => {
        if (ok) {
          toast('PCAP capture started — every targeted packet will be recorded', 'success');
        } else {
          toast('Could not start PCAP — start capture first', 'error');
        }
        refreshPcapStatus();
      });
    }
  });
}

function refreshPcapStatus() {
  bridge.getPcapStats().then((raw) => {
    let s = {};
    try { s = JSON.parse(raw || '{}'); } catch {}
    const status = document.getElementById('pcap-status');
    const btn = document.getElementById('pcap-toggle-btn');
    if (s.recording) {
      const sizeKB = (s.bytes / 1024).toFixed(1);
      status.textContent = `● Recording — ${(s.packets || 0).toLocaleString()} packets · ${sizeKB} KB`;
      status.classList.add('recording');
      btn.textContent = '■ Stop PCAP';
      btn.classList.add('recording');
    } else {
      status.textContent = 'Idle';
      status.classList.remove('recording');
      btn.textContent = '● Start PCAP';
      btn.classList.remove('recording');
    }
  });
}

function refreshPcapList() {
  bridge.listPcaps().then((raw) => {
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch {}
    const container = document.getElementById('pcap-list');
    if (!container) return;
    if (!list.length) {
      container.innerHTML = '<div class="loading">No captures yet.</div>';
      return;
    }
    container.innerHTML = '';
    list.forEach(rec => {
      const row = document.createElement('div');
      row.className = 'rec-row';
      const date = new Date(rec.mtime * 1000).toLocaleString();
      const sizeKB = (rec.size / 1024).toFixed(1);
      row.innerHTML = `
        <div class="rec-name">${escapeHtml(rec.name)}.pcap</div>
        <div class="rec-meta">${date} · ${sizeKB} KB</div>
        <button type="button" class="rec-del">Delete</button>`;
      row.querySelector('.rec-del').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete capture "${rec.name}.pcap"?`)) {
          bridge.deletePcap(rec.path).then(() => refreshPcapList());
        }
      });
      container.appendChild(row);
    });
  });
}

// ---- Filter Script -----------------------------------------------------
function setupFilterScript() {
  const btn = document.getElementById('open-script-btn');
  if (btn) btn.addEventListener('click', openScriptModal);
  const compile = document.getElementById('script-compile-btn');
  if (compile) compile.addEventListener('click', compileScript);
  const save = document.getElementById('script-save-btn');
  if (save) save.addEventListener('click', saveScript);
  const enabled = document.getElementById('script-enabled');
  if (enabled) enabled.addEventListener('change', () => {
    bridge.setFilterScriptOn(enabled.checked);
  });
  const action = document.getElementById('script-action');
  if (action) action.addEventListener('change', () => {
    bridge.setFilterScriptAction(action.value);
  });
}

function openScriptModal() {
  bridge.getFilterScriptState().then((raw) => {
    let s = {};
    try { s = JSON.parse(raw || '{}'); } catch {}
    document.getElementById('script-source').value = s.source || '';
    document.getElementById('script-action').value = s.action || 'drop';
    document.getElementById('script-enabled').checked = !!s.on;
    const status = document.getElementById('script-status');
    if (s.compiled) {
      status.textContent = '✓ Compiled and ready';
      status.classList.add('ok');
      status.classList.remove('err');
    } else if (s.error) {
      status.textContent = '✗ ' + s.error;
      status.classList.add('err');
      status.classList.remove('ok');
    } else {
      status.textContent = 'Not compiled';
      status.classList.remove('ok', 'err');
    }
    document.getElementById('script-modal').hidden = false;
  });
}

function compileScript() {
  const src = document.getElementById('script-source').value || '';
  bridge.compileFilterScript(src).then((raw) => {
    let r = {};
    try { r = JSON.parse(raw || '{}'); } catch {}
    const status = document.getElementById('script-status');
    if (r.ok) {
      status.textContent = src.trim() ? '✓ Compiled successfully' : 'Empty script — disabled';
      status.classList.add('ok');
      status.classList.remove('err');
    } else {
      status.textContent = '✗ ' + (r.error || 'Compile failed');
      status.classList.add('err');
      status.classList.remove('ok');
    }
  });
}

function saveScript() {
  const src = document.getElementById('script-source').value || '';
  const action = document.getElementById('script-action').value || 'drop';
  const enabled = document.getElementById('script-enabled').checked;
  // Compile, then save source + action + on
  bridge.compileFilterScript(src).then((raw) => {
    let r = {};
    try { r = JSON.parse(raw || '{}'); } catch {}
    if (!r.ok) {
      const status = document.getElementById('script-status');
      status.textContent = '✗ ' + (r.error || 'Compile failed — fix errors first');
      status.classList.add('err');
      status.classList.remove('ok');
      toast('Cannot save — script has errors', 'error');
      return;
    }
    bridge.setFilterScriptSource(src);
    bridge.setFilterScriptAction(action);
    bridge.setFilterScriptOn(enabled);
    document.getElementById('script-modal').hidden = true;
    toast(`Filter script ${enabled ? 'active' : 'saved'}`, 'success');
  });
}


// ============================================================================
// ONBOARDING — first-launch tutorial + update log
// ============================================================================

// Tutorial pages — each has icon, title, subtitle, body HTML.
// Rendered into the carousel by setupTutorial(). Edit content here.
const TUTORIAL_PAGES = [
  {
    icon: 'zap',
    title: 'Welcome to Throttlr',
    subtitle: '// per-application network throttler',
    body: `
      <p>Throttlr lets you intercept the traffic of any single Windows
      app and tinker with it — drop packets, add lag, throttle bandwidth,
      freeze flows, block traffic outright, or run a fun-mode glitch.</p>
      <p>This quick tour takes about <strong>30 seconds</strong>. Step through
      the pages or skip ahead — your call.</p>`,
  },
  {
    icon: 'search',
    title: 'Pick an app',
    subtitle: '// step 01 — target',
    body: `
      <p>Click the big <strong>"Click here to choose application"</strong>
      slot to pick a running .exe. You can also drag any executable
      onto the window.</p>
      <p>Recently-used apps appear as one-tap chips. Hit
      <strong>Multi-target</strong> if you want to throttle several apps
      together — handy for game launchers that spawn helper processes.</p>`,
  },
  {
    icon: 'activity',
    title: 'The 6 functions',
    subtitle: '// step 02 — make trouble',
    body: `
      <p>Toggle any of these to start affecting the targeted app's
      traffic. Each works inbound, outbound, or both.</p>
      <div class="tut-pills">
        <span class="tut-pill"><span class="icon" data-icon="activity"></span>Lag</span>
        <span class="tut-pill"><span class="icon" data-icon="ban"></span>Drop</span>
        <span class="tut-pill"><span class="icon" data-icon="package"></span>Throttle</span>
        <span class="tut-pill"><span class="icon" data-icon="snowflake"></span>Freeze</span>
        <span class="tut-pill"><span class="icon" data-icon="zap"></span>Block</span>
        <span class="tut-pill"><span class="icon" data-icon="record"></span>Fun</span>
      </div>
      <p>Hit <strong>F5</strong> (or the big yellow Start button) to
      begin capture, then flip switches to feel the impact in real time.</p>`,
  },
  {
    icon: 'folder',
    title: 'Quick Presets',
    subtitle: '// step 03 — one-tap configs',
    body: `
      <p>Don't want to fiddle with sliders? Pick a preset.
      <strong>Chaos</strong> are creative scenarios (Connection Killer,
      Freeze Burst, DNS Block).
      <strong>Real-world</strong> simulates network conditions like
      56k modem, 3G, satellite link.</p>
      <p>Build your own and hit <strong>Save current as preset</strong>
      to drop it in the <strong>My Presets</strong> tab.</p>`,
  },
  {
    icon: 'network',
    title: 'The Tools rail',
    subtitle: '// step 04 — advanced',
    body: `
      <p>The strip on the right edge unlocks the deep stuff —</p>
      <div class="tut-pills">
        <span class="tut-pill"><span class="icon" data-icon="search"></span>Inspector</span>
        <span class="tut-pill"><span class="icon" data-icon="activity"></span>Practice Ping</span>
        <span class="tut-pill"><span class="icon" data-icon="record"></span>Record</span>
        <span class="tut-pill"><span class="icon" data-icon="film"></span>Recordings</span>
        <span class="tut-pill"><span class="icon" data-icon="network"></span>Topology</span>
        <span class="tut-pill"><span class="icon" data-icon="package"></span>PCAP</span>
        <span class="tut-pill"><span class="icon" data-icon="zap"></span>Script</span>
      </div>
      <p>See live connections, watch a force-graph of who your app talks
      to, dump packets to Wireshark, or write your own filter expressions.</p>`,
  },
  {
    icon: 'play',
    title: 'You\'re ready',
    subtitle: '// step 05 — go go go',
    body: `
      <p>Hotkeys to remember:</p>
      <p><strong>F5</strong> — Start / stop capture
      <br><strong>F8</strong> — Toggle Freeze
      <br><strong>F9</strong> — Toggle Block
      <br><strong>F10</strong> — Toggle Fun mode</p>
      <p>You can re-watch this tutorial anytime from
      <strong>Settings → About</strong>. Have fun.</p>`,
  },
];

let _tutorialPage = 0;
let _tutorialMaxReached = 0;

function setupTutorial() {
  // Build pages
  const stage = document.getElementById('tutorial-stage');
  if (!stage) return;
  TUTORIAL_PAGES.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'tut-page' + (i === 0 ? ' active' : '');
    div.dataset.idx = i;
    div.innerHTML = `
      <span class="icon tut-icon" data-icon="${p.icon}"></span>
      <div class="tut-subtitle">${p.subtitle}</div>
      <h2>${p.title}</h2>
      <div class="tut-body">${p.body}</div>`;
    stage.appendChild(div);
  });
  // Build dots
  const dots = document.getElementById('tp-dots');
  TUTORIAL_PAGES.forEach((_, i) => {
    const d = document.createElement('span');
    d.className = 'tp-dot' + (i === 0 ? ' active' : '');
    d.dataset.idx = i;
    dots.appendChild(d);
  });
  document.getElementById('tut-total').textContent = TUTORIAL_PAGES.length;

  document.getElementById('tut-prev').addEventListener('click', () => goTutorialPage(_tutorialPage - 1));
  document.getElementById('tut-next').addEventListener('click', () => {
    if (_tutorialPage < TUTORIAL_PAGES.length - 1) {
      goTutorialPage(_tutorialPage + 1);
    } else {
      finishTutorial();
    }
  });
  document.getElementById('tut-skip').addEventListener('click', finishTutorial);

  renderIcons(stage);
}

function goTutorialPage(idx) {
  if (idx < 0 || idx >= TUTORIAL_PAGES.length) return;
  _tutorialPage = idx;
  if (idx > _tutorialMaxReached) _tutorialMaxReached = idx;
  // Pages
  document.querySelectorAll('#tutorial-stage .tut-page').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
  // Dots
  document.querySelectorAll('#tp-dots .tp-dot').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
    el.classList.toggle('done', i < idx);
  });
  // Progress bar
  const pct = ((idx) / (TUTORIAL_PAGES.length - 1)) * 100;
  document.getElementById('tp-fill').style.width = pct + '%';
  // Counter
  document.getElementById('tut-cur').textContent = idx + 1;
  // Buttons
  document.getElementById('tut-prev').disabled = (idx === 0);
  const nextBtn = document.getElementById('tut-next');
  if (idx === TUTORIAL_PAGES.length - 1) {
    nextBtn.innerHTML = "Get Started ▶";
  } else {
    nextBtn.innerHTML = "Next →";
  }
}

function showTutorial() {
  goTutorialPage(0);
  document.getElementById('tutorial-modal').hidden = false;
}

function finishTutorial() {
  document.getElementById('tutorial-modal').hidden = true;
  bridge.markTutorialSeen();
  bridge.playSoundEffect('preset');
  // After a tiny delay (so the close animation reads), show the
  // changelog next — first-time users get the full intro: tutorial
  // first, then "here's everything in the app" update log second.
  setTimeout(() => {
    bridge.getOnboardingState().then((raw) => {
      let s = {};
      try { s = JSON.parse(raw || '{}'); } catch {}
      // After markTutorialSeen, the backend will report 'changelog'
      // because last_seen_version is still empty/old.
      if (s.mode === 'changelog') {
        showChangelog(s.current_version, s.last_seen_version);
      }
    });
  }, 280);
}

// ---- Changelog modal --------------------------------------------------
function setupChangelog() {
  const dismiss = document.getElementById('changelog-dismiss');
  const closeBtn = document.getElementById('changelog-close');
  const onClose = () => {
    document.getElementById('changelog-modal').hidden = true;
    bridge.markVersionSeen();
  };
  if (dismiss) dismiss.addEventListener('click', onClose);
  if (closeBtn) closeBtn.addEventListener('click', onClose);
}

function _parseVersionTuple(v) {
  // "2.6.0" → [2, 6, 0]. Returns [0,0,0] for empty/invalid.
  if (!v || typeof v !== 'string') return [0, 0, 0];
  const parts = v.replace(/^v/i, '').split('.').slice(0, 3);
  const out = [];
  for (let i = 0; i < 3; i++) {
    const n = parseInt(parts[i], 10);
    out.push(isFinite(n) ? n : 0);
  }
  return out;
}
function _compareVersions(a, b) {
  // Returns negative if a < b, 0 if equal, positive if a > b
  const ta = _parseVersionTuple(a), tb = _parseVersionTuple(b);
  for (let i = 0; i < 3; i++) {
    if (ta[i] !== tb[i]) return ta[i] - tb[i];
  }
  return 0;
}

function showChangelog(currentVersion, lastSeenVersion) {
  bridge.getChangelog().then((raw) => {
    let entries = [];
    try { entries = JSON.parse(raw || '[]'); } catch {}
    // Header line — clearer wording, sanity-check the version state so weird
    // settings (downgrade, stale last_seen, partial install) don't produce
    // nonsensical "you were on a newer version" text.
    const lineEl = document.getElementById('changelog-version-line');
    if (lineEl) {
      const cmp = _compareVersions(lastSeenVersion, currentVersion);
      const cur = escapeHtml(currentVersion);
      const last = escapeHtml(lastSeenVersion || '');
      if (!lastSeenVersion) {
        // First-time user — just finished the tutorial
        lineEl.innerHTML = `Welcome to <strong>v${cur}</strong>. Here's everything that's in this version:`;
      } else if (cmp < 0) {
        // Normal case: upgraded from older to newer
        lineEl.innerHTML = `Updated from <strong>v${last}</strong> to <strong>v${cur}</strong>. Here's what's new:`;
      } else if (cmp > 0) {
        // Downgrade (or stale settings from a future build) — don't pretend
        // we know what they were on, just confirm the current version
        lineEl.innerHTML = `You're now on <strong>v${cur}</strong>. Here's the changelog for this version:`;
      } else {
        // Equal — shouldn't happen since the modal only fires on mismatch,
        // but handle it gracefully just in case
        lineEl.innerHTML = `You're on <strong>v${cur}</strong>.`;
      }
    }
    // Build version blocks
    const list = document.getElementById('changelog-list');
    list.innerHTML = '';
    // v3.0.4 — older versions collapse by default. Only the current version
    // (and the previously-seen-on version, if any) start expanded. Cuts the
    // visual overwhelm — users see what's NEW without 142 lines of history.
    entries.forEach((entry, idx) => {
      const isCurrent = entry.version === currentVersion;
      const isPrevSeen = lastSeenVersion && entry.version === lastSeenVersion;
      const block = document.createElement('div');
      const expanded = isCurrent || isPrevSeen || idx === 0;
      block.className = 'cl-version'
                      + (isCurrent ? ' is-current' : '')
                      + (expanded ? ' is-expanded' : ' is-collapsed');
      const items = (entry.changes || []).map(line => {
        // Detect leading tag prefix like "NEW · ..." → tag + label
        const m = line.match(/^(NEW|FIXED|REMOVED|RENAMED|POLISH)\s*·\s*(.+)$/i);
        const tag = m ? m[1].toUpperCase() : 'OTHER';
        const text = m ? m[2] : line;
        return `<li data-tag="${tag}">${escapeHtml(text)}</li>`;
      }).join('');
      const itemCount = (entry.changes || []).length;
      block.innerHTML = `
        <div class="cl-head" role="button" tabindex="0">
          <div class="cl-ver">
            <span class="cl-chevron">▾</span>
            <span class="cl-vchip">v${escapeHtml(entry.version)}</span>
            <span class="cl-title">${escapeHtml(entry.title || '')}</span>
          </div>
          <span class="cl-date">${escapeHtml(entry.date || '')} · ${itemCount} change${itemCount === 1 ? '' : 's'}</span>
        </div>
        <ul class="cl-changes">${items}</ul>`;
      // Click header toggles expanded state
      const head = block.querySelector('.cl-head');
      head.addEventListener('click', () => {
        block.classList.toggle('is-expanded');
        block.classList.toggle('is-collapsed');
      });
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          head.click();
        }
      });
      list.appendChild(block);
    });
    document.getElementById('changelog-modal').hidden = false;
  });
}

// Decide which (if any) onboarding modal to show, after init
function runOnboarding() {
  bridge.getOnboardingState().then((raw) => {
    let s = {};
    try { s = JSON.parse(raw || '{}'); } catch {}
    if (s.mode === 'tutorial') {
      // Slight delay so the splash transition finishes first
      setTimeout(showTutorial, 350);
    } else if (s.mode === 'changelog') {
      setTimeout(() => showChangelog(s.current_version, s.last_seen_version), 350);
    }
  });
}



// ============================================================
// AUTO-UPDATE — GitHub release check, modal prompt, Info tab
// ============================================================
//
// Flow:
//  1. App startup → backend kicks off background GitHub /releases/latest fetch
//  2. After main UI init + 1.5s delay → checkForUpdatePrompt() runs
//  3. If a newer version is available AND the user hasn't dismissed THIS
//     specific version → show the update modal
//  4. User clicks Yes → applyUpdate() → backend downloads + spawns helper
//     batch → app exits → batch swaps files → relaunches new version
//  5. New version sees last_seen_version != __version__ and shows the
//     existing changelog modal automatically — that's the "what's new"
//     post-update screen
//  6. User clicks Not now → backend records dismissed_update_version →
//     modal closes → Info tab gets a "!" badge until they update or a
//     newer release arrives

let _lastUpdateState = null;   // cached so the Info tab can render without
                               // re-hitting the bridge every time

// ============================================================
// v2.5.1 — Update progress bar driver
// ============================================================
// Translates the rich updateStatus payload (bytes_done, bytes_total,
// speed_bps, eta_seconds) into the visible bar + meta line.
// ============================================================
function _fmtBytes(b) {
  if (!b || b < 0) return '0 B';
  if (b < 1024) return Math.round(b) + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
function _fmtSpeed(bps) {
  if (!bps || bps < 0) return '0 KB/s';
  if (bps < 1024) return Math.round(bps) + ' B/s';
  if (bps < 1024 * 1024) return (bps / 1024).toFixed(1) + ' KB/s';
  return (bps / 1024 / 1024).toFixed(1) + ' MB/s';
}
function _fmtEta(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '—';
  if (seconds < 60) return '~' + Math.ceil(seconds) + 's remaining';
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds - m * 60);
  return `~${m}m ${s}s remaining`;
}

function _setProgress(s) {
  const phaseEl = document.getElementById('update-progress-phase');
  const pctEl   = document.getElementById('update-progress-pct');
  const fillEl  = document.getElementById('update-progress-fill');
  const metaEl  = document.getElementById('update-progress-meta');
  if (!phaseEl || !fillEl) return;

  // Phase label
  const phaseLabels = {
    starting:    'Starting',
    downloading: 'Downloading',
    extracting:  'Extracting',
    preparing:   'Preparing',
    ready:       'Restarting',
  };
  phaseEl.textContent = (phaseLabels[s.phase] || s.phase || 'Working').toUpperCase();

  // Determinate vs indeterminate based on whether we have byte totals
  const hasBytes = s.phase === 'downloading' && s.bytes_total > 0;

  if (hasBytes) {
    const pct = Math.max(0, Math.min(100, (s.bytes_done / s.bytes_total) * 100));
    fillEl.classList.remove('is-indeterminate');
    fillEl.style.width = pct.toFixed(1) + '%';
    if (pctEl) pctEl.textContent = pct.toFixed(0) + '%';
    if (metaEl) {
      metaEl.textContent =
        `${_fmtBytes(s.bytes_done)} / ${_fmtBytes(s.bytes_total)}` +
        `  ·  ${_fmtSpeed(s.speed_bps)}` +
        `  ·  ${_fmtEta(s.eta_seconds)}`;
    }
  } else if (s.phase === 'ready') {
    fillEl.classList.remove('is-indeterminate');
    fillEl.style.width = '100%';
    if (pctEl) pctEl.textContent = '✓';
    if (metaEl) metaEl.textContent = 'Files installed — restarting Throttlr…';
  } else {
    // No byte info → show indeterminate animation (extracting, preparing, etc.)
    fillEl.classList.add('is-indeterminate');
    if (pctEl) pctEl.textContent = '';
    if (metaEl) metaEl.textContent = s.message || 'Working…';
  }
}

function setupUpdateModal() {
  const dismiss = document.getElementById('update-dismiss');
  const closeBtn = document.getElementById('update-close');
  const apply = document.getElementById('update-apply');

  const closeModal = () => {
    document.getElementById('update-modal').hidden = true;
  };

  const onDismiss = () => {
    if (_lastUpdateState && _lastUpdateState.latest) {
      bridge.dismissUpdate(_lastUpdateState.latest);
    }
    closeModal();
    refreshInfoTab();   // updates the "!" badge state
  };

  if (dismiss) dismiss.addEventListener('click', onDismiss);
  if (closeBtn) closeBtn.addEventListener('click', onDismiss);

  if (apply) apply.addEventListener('click', () => {
    // Fire-and-forget — applyUpdate returns immediately, work happens in
    // a background thread. Progress comes via the updateStatus signal.
    apply.disabled = true;
    apply.textContent = 'Starting…';
    if (dismiss) dismiss.disabled = true;
    // v2.5.1 — lock the modal so close/dismiss can't interrupt the install
    const modal = document.getElementById('update-modal');
    if (modal) modal.dataset.updateLocked = '1';
    // Show the progress UI
    const progWrap = document.getElementById('update-progress-wrap');
    if (progWrap) progWrap.hidden = false;
    _setProgress({ phase: 'starting', message: 'Starting…' });
    try {
      bridge.applyUpdate();
    } catch (e) {
      apply.disabled = false;
      apply.textContent = 'Yes, update now';
      if (dismiss) dismiss.disabled = false;
      if (modal) modal.dataset.updateLocked = '';
      if (progWrap) progWrap.hidden = true;
      toast('Update error: ' + e, 'error');
    }
  });

  // Listen for backend progress/result of the update operation
  if (bridge.updateStatus && bridge.updateStatus.connect) {
    bridge.updateStatus.connect((raw) => {
      let s = {};
      try { s = JSON.parse(raw || '{}'); } catch {}

      if (s.phase === 'ready' && s.ok) {
        // Files are downloaded, helper batch is running. Quit so it can swap.
        if (apply) apply.textContent = s.message || 'Restarting…';
        _setProgress({ phase: 'ready', message: s.message || 'Restarting…' });
        setTimeout(() => { bridge.quitForUpdate(); }, 600);
      } else if (s.phase === 'error') {
        if (apply) {
          apply.disabled = false;
          apply.textContent = 'Yes, update now';
        }
        if (dismiss) dismiss.disabled = false;
        const modal = document.getElementById('update-modal');
        if (modal) modal.dataset.updateLocked = '';
        const progWrap = document.getElementById('update-progress-wrap');
        if (progWrap) progWrap.hidden = true;
        toast('Update failed: ' + (s.error || 'unknown error'), 'error');
      } else {
        // starting / downloading / extracting / preparing — drive the UI
        if (apply) apply.textContent = 'Working…';
        _setProgress(s);
      }
    });
  }

  // Settings → Info tab buttons
  const recheck = document.getElementById('info-recheck-btn');
  if (recheck) recheck.addEventListener('click', () => {
    bridge.recheckUpdate();
    recheck.classList.add('is-checking');
    recheck.disabled = true;
    const labelEl = recheck.querySelector('.btn-check-label');
    const oldLabel = labelEl ? labelEl.textContent : '';
    if (labelEl) labelEl.textContent = 'Checking GitHub…';

    // Poll a few times — the result lands when the background thread finishes
    let tries = 0;
    const poll = () => {
      tries++;
      refreshInfoTab().then((s) => {
        if (s && s.checked) {
          // Done — reset the button
          recheck.classList.remove('is-checking');
          recheck.disabled = false;
          if (labelEl) labelEl.textContent = oldLabel || 'Check for updates';
          return;
        }
        if (tries < 12) {
          setTimeout(poll, 500);
        } else {
          // Gave up
          recheck.classList.remove('is-checking');
          recheck.disabled = false;
          if (labelEl) labelEl.textContent = oldLabel || 'Check for updates';
        }
      });
    };
    setTimeout(poll, 600);
  });

  const updateNowFromInfo = document.getElementById('info-update-now-btn');
  if (updateNowFromInfo) updateNowFromInfo.addEventListener('click', () => {
    document.getElementById('settings-modal').hidden = true;
    showUpdateModal();
  });

  const openRelease = document.getElementById('info-open-release-btn');
  if (openRelease) openRelease.addEventListener('click', () => {
    const url = (_lastUpdateState && _lastUpdateState.html_url) ||
                'https://github.com/BillysMatrix18/throttlr/releases/latest';
    window.open(url, '_blank');
  });

  const reportBug = document.getElementById('info-report-bug-btn');
  if (reportBug) reportBug.addEventListener('click', () => {
    // Open GitHub Issues with a pre-filled template that includes system info
    // so users can paste relevant context without typing it manually.
    bridge.getSystemInfo().then((raw) => {
      let sys = {};
      try { sys = JSON.parse(raw || '{}'); } catch {}
      const v = (_lastUpdateState && _lastUpdateState.current) || '';
      const body = encodeURIComponent(
        '## What happened\n\n(describe the bug here)\n\n' +
        '## What you expected\n\n(what should have happened instead)\n\n' +
        '## Steps to reproduce\n\n1. \n2. \n3. \n\n' +
        '## System info\n\n' +
        '- **Throttlr version**: v' + v + '\n' +
        '- **Platform**: ' + (sys.windows || 'unknown') + '\n' +
        '- **Privileges**: ' + (sys.admin ? 'Administrator' : 'Limited') + '\n' +
        '- **WinDivert driver**: ' + (sys.pydivert ? 'OK' : ('Missing — ' + (sys.pydivert_err || ''))) + '\n' +
        '- **Engine state**: ' + (sys.engine || 'unknown') + '\n'
      );
      const url = 'https://github.com/BillysMatrix18/throttlr/issues/new?body=' + body;
      window.open(url, '_blank');
    });
  });

  const showCl = document.getElementById('info-show-changelog-btn');
  if (showCl) showCl.addEventListener('click', () => {
    document.getElementById('settings-modal').hidden = true;
    bridge.getCurrentVersion().then((v) => {
      showChangelog(v, '');
    });
  });

  // When the user opens the settings modal, refresh the Info tab data so
  // it always reflects the current state of the GitHub check
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => setTimeout(refreshInfoTab, 100));
  }
}

function checkForUpdatePrompt() {
  // Don't double-show on top of the tutorial/changelog modal — wait until
  // they're closed, then show ours
  const tut = document.getElementById('tutorial-modal');
  const cl = document.getElementById('changelog-modal');
  if ((tut && !tut.hidden) || (cl && !cl.hidden)) {
    setTimeout(checkForUpdatePrompt, 800);
    return;
  }

  bridge.getUpdateInfo().then((raw) => {
    let s = {};
    try { s = JSON.parse(raw || '{}'); } catch {}
    _lastUpdateState = s;
    if (s.should_prompt) {
      showUpdateModal();
    }
    refreshInfoTab();
  });
}

function showUpdateModal() {
  if (!_lastUpdateState) return;
  const s = _lastUpdateState;

  const cur = document.getElementById('update-current-version');
  const latest = document.getElementById('update-latest-version');
  if (cur) cur.textContent = 'v' + (s.current || '').replace(/^v/i, '');
  if (latest) latest.textContent = (s.latest || '').match(/^v/i)
                                    ? s.latest
                                    : 'v' + (s.latest || '');

  const notesWrap = document.getElementById('update-notes-wrap');
  const notes = document.getElementById('update-notes');
  if (notesWrap && notes) {
    if (s.body && s.body.trim()) {
      notes.textContent = s.body.trim();
      notesWrap.hidden = false;
    } else {
      notesWrap.hidden = true;
    }
  }

  // Reset button states (in case modal was previously opened during a failed apply)
  const apply = document.getElementById('update-apply');
  const dismiss = document.getElementById('update-dismiss');
  if (apply) { apply.disabled = false; apply.textContent = 'Yes, update now'; }
  if (dismiss) dismiss.disabled = false;

  // v2.5.1 — reset progress UI + unlock modal in case prior session left it locked
  const modal = document.getElementById('update-modal');
  if (modal) modal.dataset.updateLocked = '';
  const progWrap = document.getElementById('update-progress-wrap');
  if (progWrap) progWrap.hidden = true;
  const fillEl = document.getElementById('update-progress-fill');
  if (fillEl) { fillEl.classList.remove('is-indeterminate'); fillEl.style.width = '0%'; }
  const pctEl = document.getElementById('update-progress-pct');
  if (pctEl) pctEl.textContent = '0%';

  document.getElementById('update-modal').hidden = false;
}

function refreshInfoTab() {
  // Populate version pill + status pill (top hero block)
  return bridge.getUpdateInfo().then((raw) => {
    let s = {};
    try { s = JSON.parse(raw || '{}'); } catch {}
    _lastUpdateState = s;

    // Hero — current version
    const curEl = document.getElementById('info-current-version');
    if (curEl) curEl.textContent = 'v' + (s.current || '').replace(/^v/i, '');

    // Hero — status pill (color-coded)
    const pill = document.getElementById('info-status-pill');
    const pillText = document.getElementById('info-status-text');
    if (pill && pillText) {
      let state = 'ok';
      let text = 'up to date';
      if (s.error) {
        state = 'error';
        text = 'check failed';
        pill.title = s.error;
      } else if (!s.checked) {
        state = 'unknown';
        text = 'checking…';
        pill.removeAttribute('title');
      } else if (s.available) {
        state = 'update';
        text = (s.dismissed_version === s.latest) ? 'update dismissed' : 'update available';
        pill.removeAttribute('title');
      } else {
        pill.removeAttribute('title');
      }
      pill.setAttribute('data-state', state);
      pillText.textContent = text;
    }

    // Latest version row
    const latestEl = document.getElementById('info-latest-version');
    if (latestEl) {
      if (s.error) {
        latestEl.textContent = 'check failed';
        latestEl.className = 'info-val is-error';
        latestEl.title = s.error;
      } else if (!s.checked) {
        latestEl.textContent = 'checking…';
        latestEl.className = 'info-val';
        latestEl.removeAttribute('title');
      } else if (s.latest) {
        const tag = (s.latest.match(/^v/i) ? s.latest : 'v' + s.latest);
        latestEl.textContent = tag;
        latestEl.className = 'info-val' + (s.available ? ' is-new' : '');
        latestEl.removeAttribute('title');
      } else {
        latestEl.textContent = '—';
        latestEl.className = 'info-val';
        latestEl.removeAttribute('title');
      }
    }

    // Last-checked timestamp ("just now", "2 minutes ago", etc.)
    const lastEl = document.getElementById('info-last-checked');
    if (lastEl) {
      if (!s.checked_at) {
        lastEl.textContent = 'never';
      } else {
        lastEl.textContent = formatRelativeTime(s.checked_at);
      }
    }

    // Show "Install update" button + tab badge only if an update is available
    const badge = document.getElementById('info-tab-badge');
    const installBtn = document.getElementById('info-update-now-btn');
    const showBadge = !!s.available;
    if (badge) badge.hidden = !showBadge;
    if (installBtn) installBtn.hidden = !showBadge;

    // Refresh system info too (independent — won't change often)
    refreshSystemInfo();

    return s;
  });
}

function refreshSystemInfo() {
  if (!bridge.getSystemInfo) return;   // older backend without the slot
  bridge.getSystemInfo().then((raw) => {
    let sys = {};
    try { sys = JSON.parse(raw || '{}'); } catch {}

    // Platform — Windows version string
    const platEl = document.getElementById('info-sys-platform');
    if (platEl) platEl.textContent = sys.windows || 'unknown';

    // Privileges — admin status with colored dot
    const adminText = document.getElementById('info-sys-admin-text');
    const adminDot = document.querySelector('#info-sys-admin .info-status-dot');
    if (adminText && adminDot) {
      if (sys.admin) {
        adminText.textContent = 'Administrator';
        adminDot.setAttribute('data-status', 'ok');
      } else {
        adminText.textContent = 'Limited (no admin)';
        adminDot.setAttribute('data-status', 'error');
      }
    }

    // WinDivert — driver status
    const pdText = document.getElementById('info-sys-pydivert-text');
    const pdDot = document.querySelector('#info-sys-pydivert .info-status-dot');
    if (pdText && pdDot) {
      if (sys.pydivert) {
        pdText.textContent = 'Loaded';
        pdDot.setAttribute('data-status', 'ok');
      } else {
        pdText.textContent = 'Missing';
        pdDot.setAttribute('data-status', 'error');
        if (sys.pydivert_err) pdText.title = sys.pydivert_err;
      }
    }

    // Engine state
    const engText = document.getElementById('info-sys-engine-text');
    const engDot = document.querySelector('#info-sys-engine .info-status-dot');
    if (engText && engDot) {
      if (sys.engine === 'running') {
        engText.textContent = 'Running';
        engDot.setAttribute('data-status', 'active');
      } else {
        engText.textContent = 'Idle';
        engDot.setAttribute('data-status', 'ok');
      }
    }
  });
}

// "23 seconds ago" / "5 minutes ago" / "2 hours ago" — used for last-checked
function formatRelativeTime(unixSeconds) {
  if (!unixSeconds) return 'never';
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 5)     return 'just now';
  if (diff < 60)    return diff + ' seconds ago';
  if (diff < 3600)  { const m = Math.floor(diff / 60); return m + (m === 1 ? ' minute ago' : ' minutes ago'); }
  if (diff < 86400) { const h = Math.floor(diff / 3600); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
  const d = Math.floor(diff / 86400);
  return d + (d === 1 ? ' day ago' : ' days ago');
}


// ============================================================
// PHASE 1 (v2.4.0) — Profile import/export + drag-drop
// ============================================================

function setupProfileTab() {
  const exportBtn = document.getElementById('profile-export-btn');
  const importBtn = document.getElementById('profile-import-btn');

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      bridge.saveProfileToFile().then((raw) => {
        let r = {};
        try { r = JSON.parse(raw || '{}'); } catch {}
        if (r.cancelled) return;   // user clicked Cancel — silent
        if (r.ok) {
          // Show only the filename, not the full path (cleaner toast)
          const filename = (r.path || '').split(/[\\/]/).pop() || 'profile';
          toast(`Profile exported → ${filename}`, 'success');
        } else {
          toast('Export failed: ' + (r.error || 'unknown error'), 'error');
        }
      });
    });
  }

  if (importBtn) {
    importBtn.addEventListener('click', () => {
      bridge.loadProfileFromFile().then((raw) => {
        let r = {};
        try { r = JSON.parse(raw || '{}'); } catch {}
        if (r.cancelled) return;
        handleProfileImportResult(r);
      });
    });
  }
}

function handleProfileImportResult(r) {
  if (!r) return;
  if (r.ok) {
    const name = r.name || 'Throttlr Profile';
    toast(`Imported profile: ${name}`, 'success');
    // Reload settings + config so everything reflects the new state
    setTimeout(() => {
      try { bridge.getSettings && bridge.getSettings().then((s) => applySettings(JSON.parse(s))); } catch {}
      try { bridge.getConfig && bridge.getConfig().then((c) => applyProfileData(JSON.parse(c))); } catch {}
    }, 50);
  } else {
    toast('Import failed: ' + (r.error || 'unknown error'), 'error');
  }
}

// ============================================================
// Drag-drop .throttlr files onto the window
// ============================================================
function setupProfileDragDrop() {
  const overlay = document.getElementById('profile-drop-overlay');
  let dragDepth = 0;   // tracks nested dragenter/dragleave so overlay
                       // doesn't flicker when dragging over child elements

  function isThrottlrFile(items) {
    if (!items) return false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // During dragenter we only have item.kind ('file') and item.type
      // (might be empty for unknown extensions). Always allow files —
      // we'll filter properly on drop.
      if (item.kind === 'file') return true;
    }
    return false;
  }

  window.addEventListener('dragenter', (e) => {
    if (!isThrottlrFile(e.dataTransfer && e.dataTransfer.items)) return;
    e.preventDefault();
    dragDepth++;
    if (overlay) overlay.classList.add('is-active');
  });

  window.addEventListener('dragover', (e) => {
    if (!isThrottlrFile(e.dataTransfer && e.dataTransfer.items)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (e) => {
    if (!isThrottlrFile(e.dataTransfer && e.dataTransfer.items)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && overlay) overlay.classList.remove('is-active');
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    if (overlay) overlay.classList.remove('is-active');

    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;

    const file = files[0];
    const name = (file.name || '').toLowerCase();
    if (!name.endsWith('.throttlr') && !name.endsWith('.json')) {
      toast(`Not a Throttlr profile: ${file.name}`, 'error');
      return;
    }

    // Read the file via FileReader (HTML5 API), pass content directly to backend
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const content = ev.target.result;
        bridge.importProfileJson(content).then((raw) => {
          let r = {};
          try { r = JSON.parse(raw || '{}'); } catch {}
          handleProfileImportResult(r);
        });
      } catch (err) {
        toast('Failed to read file: ' + err, 'error');
      }
    };
    reader.onerror = () => toast('Could not read file', 'error');
    reader.readAsText(file);
  });
}


// ============================================================
// PHASE 1 (v2.4.0) — Bandwidth readouts (peak / average / current)
// ============================================================
//
// Tracks per-session peak and rolling average for inbound and outbound
// bandwidth. Updated each time onStatsChanged fires (~5x per second).
// User can reset peak/average via the ↻ button.

let _bwPeakIn = 0;
let _bwPeakOut = 0;
let _bwSumIn = 0;
let _bwSumOut = 0;
let _bwSamples = 0;

function updateBandwidthReadouts(bwIn, bwOut) {
  const lastIn = bwIn.length ? bwIn[bwIn.length - 1] : 0;
  const lastOut = bwOut.length ? bwOut[bwOut.length - 1] : 0;

  if (lastIn > _bwPeakIn) _bwPeakIn = lastIn;
  if (lastOut > _bwPeakOut) _bwPeakOut = lastOut;

  // Only count toward average if there's actually traffic (avoids huge
  // sample counts of zero diluting the real average)
  if (lastIn > 0 || lastOut > 0) {
    _bwSumIn += lastIn;
    _bwSumOut += lastOut;
    _bwSamples++;
  }

  const avgIn = _bwSamples > 0 ? _bwSumIn / _bwSamples : 0;
  const avgOut = _bwSamples > 0 ? _bwSumOut / _bwSamples : 0;

  setBwReadout('bw-readout-in-cur',   lastIn);
  setBwReadout('bw-readout-out-cur',  lastOut);
  setBwReadout('bw-readout-in-peak',  _bwPeakIn);
  setBwReadout('bw-readout-out-peak', _bwPeakOut);
  setBwReadout('bw-readout-in-avg',   avgIn);
  setBwReadout('bw-readout-out-avg',  avgOut);

  // Y-axis label — max value seen across both series in the live graph
  const all = [...bwIn, ...bwOut];
  const graphMax = all.length ? Math.max(1024, ...all) : 1024;
  const axisEl = document.getElementById('bw-axis-max');
  if (axisEl) axisEl.textContent = formatBytesPerSec(graphMax) + ' max';
}

function setBwReadout(elId, value) {
  const el = document.getElementById(elId);
  if (el) el.textContent = formatBytesPerSec(value);
}

function formatBytesPerSec(bytes) {
  if (!bytes || bytes < 1) return '0 KB/s';
  if (bytes < 1024) return bytes + ' B/s';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB/s';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB/s';
}

function setupBandwidthReadouts() {
  const resetBtn = document.getElementById('bw-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      _bwPeakIn = 0;
      _bwPeakOut = 0;
      _bwSumIn = 0;
      _bwSumOut = 0;
      _bwSamples = 0;
      // Clear displayed values
      ['bw-readout-in-cur','bw-readout-out-cur',
       'bw-readout-in-peak','bw-readout-out-peak',
       'bw-readout-in-avg','bw-readout-out-avg'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '0 KB/s';
      });
      toast('Peak / average reset', 'success');
    });
  }
}

// Hook into the existing onStatsChanged flow — patch in our readouts
// without breaking the existing drawTrafficGraph call. We do this by
// calling updateBandwidthReadouts each time stats arrive.
const _origOnStatsChanged_v240 = typeof onStatsChanged === 'function' ? onStatsChanged : null;
if (_origOnStatsChanged_v240) {
  // Wrap: call original, then update readouts using the global bwIn/bwOut
  window.onStatsChanged = function (json) {
    _origOnStatsChanged_v240(json);
    try {
      // bwIn / bwOut are global vars set inside the original handler
      updateBandwidthReadouts(bwIn || [], bwOut || []);
    } catch (e) { /* swallow */ }
  };
  // Re-bind the bridge signal to the wrapped function
  try {
    if (bridge && bridge.statsChanged && bridge.statsChanged.disconnect) {
      bridge.statsChanged.disconnect(_origOnStatsChanged_v240);
      bridge.statsChanged.connect(window.onStatsChanged);
    }
  } catch (e) { /* swallow — fallback below handles it */ }
}

// Initialize the new Phase 1 UI on DOM ready
(function initPhase1() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupProfileTab();
      setupProfileDragDrop();
      setupBandwidthReadouts();
    });
  } else {
    setupProfileTab();
    setupProfileDragDrop();
    setupBandwidthReadouts();
  }
})();


// ============================================================
// v2.5.0 — Phase 2 — Connection Geo Map
// ============================================================
//
// Embeds a simplified world map (continent outlines as SVG paths) and
// plots the targeted app's connections at the country center coordinates
// using equirectangular projection. Updates live as connections come and
// go, with hover tooltips showing per-connection details.

// Map projection: equirectangular. ViewBox is 1000x500 so:
//   x = (lon + 180) / 360 * 1000
//   y = (90 - lat) / 180 * 500
function geoProject(lat, lon) {
  const x = ((lon + 180) / 360) * 1000;
  const y = ((90 - lat) / 180) * 500;
  return { x, y };
}

// ============================================================
// Country code → approximate center [lat, lon].
// 250 entries covering effectively all geo-IP results we'll see.
// Format: 2-letter ISO code → [lat, lon].
// ============================================================
const COUNTRY_COORDS = {
  AD: [42.5, 1.5], AE: [24.0, 54.0], AF: [33.0, 65.0], AG: [17.05, -61.8], AI: [18.25, -63.17],
  AL: [41.0, 20.0], AM: [40.0, 45.0], AO: [-12.5, 18.5], AR: [-34.0, -64.0], AS: [-14.33, -170.0],
  AT: [47.33, 13.33], AU: [-27.0, 133.0], AW: [12.5, -69.97], AX: [60.12, 19.92], AZ: [40.5, 47.5],
  BA: [44.0, 18.0], BB: [13.17, -59.53], BD: [24.0, 90.0], BE: [50.83, 4.0], BF: [13.0, -2.0],
  BG: [43.0, 25.0], BH: [26.0, 50.55], BI: [-3.5, 30.0], BJ: [9.5, 2.25], BL: [17.9, -62.83],
  BM: [32.33, -64.75], BN: [4.5, 114.67], BO: [-17.0, -65.0], BQ: [12.18, -68.23], BR: [-10.0, -55.0],
  BS: [24.25, -76.0], BT: [27.5, 90.5], BV: [-54.43, 3.4], BW: [-22.0, 24.0], BY: [53.0, 28.0],
  BZ: [17.25, -88.75], CA: [60.0, -95.0], CC: [-12.5, 96.83], CD: [0.0, 25.0], CF: [7.0, 21.0],
  CG: [-1.0, 15.0], CH: [47.0, 8.0], CI: [8.0, -5.0], CK: [-21.23, -159.77], CL: [-30.0, -71.0],
  CM: [6.0, 12.0], CN: [35.0, 105.0], CO: [4.0, -72.0], CR: [10.0, -84.0], CU: [21.5, -80.0],
  CV: [16.0, -24.0], CW: [12.17, -69.0], CX: [-10.5, 105.67], CY: [35.0, 33.0], CZ: [49.75, 15.5],
  DE: [51.0, 9.0], DJ: [11.5, 43.0], DK: [56.0, 10.0], DM: [15.42, -61.33], DO: [19.0, -70.67],
  DZ: [28.0, 3.0], EC: [-2.0, -77.5], EE: [59.0, 26.0], EG: [27.0, 30.0], EH: [24.5, -13.0],
  ER: [15.0, 39.0], ES: [40.0, -4.0], ET: [8.0, 38.0], FI: [64.0, 26.0], FJ: [-18.0, 175.0],
  FK: [-51.75, -59.0], FM: [6.92, 158.25], FO: [62.0, -7.0], FR: [46.0, 2.0], GA: [-1.0, 11.75],
  GB: [54.0, -2.0], GD: [12.12, -61.67], GE: [42.0, 43.5], GF: [4.0, -53.0], GG: [49.47, -2.58],
  GH: [8.0, -2.0], GI: [36.13, -5.35], GL: [72.0, -40.0], GM: [13.47, -16.57], GN: [11.0, -10.0],
  GP: [16.25, -61.58], GQ: [2.0, 10.0], GR: [39.0, 22.0], GS: [-54.5, -37.0], GT: [15.5, -90.25],
  GU: [13.47, 144.78], GW: [12.0, -15.0], GY: [5.0, -59.0], HK: [22.25, 114.17], HM: [-53.1, 72.52],
  HN: [15.0, -86.5], HR: [45.17, 15.5], HT: [19.0, -72.42], HU: [47.0, 20.0], ID: [-5.0, 120.0],
  IE: [53.0, -8.0], IL: [31.5, 34.75], IM: [54.23, -4.55], IN: [20.0, 77.0], IO: [-6.0, 71.5],
  IQ: [33.0, 44.0], IR: [32.0, 53.0], IS: [65.0, -18.0], IT: [42.83, 12.83], JE: [49.21, -2.13],
  JM: [18.25, -77.5], JO: [31.0, 36.0], JP: [36.0, 138.0], KE: [1.0, 38.0], KG: [41.0, 75.0],
  KH: [13.0, 105.0], KI: [1.42, 173.0], KM: [-12.17, 44.25], KN: [17.33, -62.75], KP: [40.0, 127.0],
  KR: [37.0, 127.5], KW: [29.34, 47.66], KY: [19.5, -80.5], KZ: [48.0, 68.0], LA: [18.0, 105.0],
  LB: [33.83, 35.83], LC: [13.88, -60.97], LI: [47.27, 9.53], LK: [7.0, 81.0], LR: [6.5, -9.5],
  LS: [-29.5, 28.5], LT: [56.0, 24.0], LU: [49.75, 6.17], LV: [57.0, 25.0], LY: [25.0, 17.0],
  MA: [32.0, -5.0], MC: [43.73, 7.4], MD: [47.0, 29.0], ME: [42.5, 19.3], MF: [18.07, -63.07],
  MG: [-20.0, 47.0], MH: [9.0, 168.0], MK: [41.83, 22.0], ML: [17.0, -4.0], MM: [22.0, 98.0],
  MN: [46.0, 105.0], MO: [22.17, 113.55], MP: [15.2, 145.75], MQ: [14.67, -61.0], MR: [20.0, -12.0],
  MS: [16.75, -62.2], MT: [35.83, 14.58], MU: [-20.28, 57.55], MV: [3.25, 73.0], MW: [-13.5, 34.0],
  MX: [23.0, -102.0], MY: [2.5, 112.5], MZ: [-18.25, 35.0], NA: [-22.0, 17.0], NC: [-21.5, 165.5],
  NE: [16.0, 8.0], NF: [-29.03, 167.95], NG: [10.0, 8.0], NI: [13.0, -85.0], NL: [52.5, 5.75],
  NO: [62.0, 10.0], NP: [28.0, 84.0], NR: [-0.53, 166.92], NU: [-19.03, -169.87], NZ: [-41.0, 174.0],
  OM: [21.0, 57.0], PA: [9.0, -80.0], PE: [-10.0, -76.0], PF: [-15.0, -140.0], PG: [-6.0, 147.0],
  PH: [13.0, 122.0], PK: [30.0, 70.0], PL: [52.0, 20.0], PM: [46.83, -56.33], PN: [-24.7, -127.4],
  PR: [18.25, -66.5], PS: [32.0, 35.25], PT: [39.5, -8.0], PW: [7.5, 134.5], PY: [-23.0, -58.0],
  QA: [25.5, 51.25], RE: [-21.1, 55.6], RO: [46.0, 25.0], RS: [44.0, 21.0], RU: [60.0, 100.0],
  RW: [-2.0, 30.0], SA: [25.0, 45.0], SB: [-8.0, 159.0], SC: [-4.58, 55.67], SD: [15.0, 30.0],
  SE: [62.0, 15.0], SG: [1.37, 103.8], SH: [-15.93, -5.7], SI: [46.0, 15.0], SJ: [78.0, 20.0],
  SK: [48.67, 19.5], SL: [8.5, -11.5], SM: [43.93, 12.42], SN: [14.0, -14.0], SO: [10.0, 49.0],
  SR: [4.0, -56.0], SS: [8.0, 30.0], ST: [1.0, 7.0], SV: [13.83, -88.92], SX: [18.03, -63.05],
  SY: [35.0, 38.0], SZ: [-26.5, 31.5], TC: [21.75, -71.58], TD: [15.0, 19.0], TF: [-49.25, 69.17],
  TG: [8.0, 1.17], TH: [15.0, 100.0], TJ: [39.0, 71.0], TK: [-9.0, -172.0], TL: [-8.55, 125.52],
  TM: [40.0, 60.0], TN: [34.0, 9.0], TO: [-20.0, -175.0], TR: [39.0, 35.0], TT: [11.0, -61.0],
  TV: [-8.0, 178.0], TW: [23.5, 121.0], TZ: [-6.0, 35.0], UA: [49.0, 32.0], UG: [1.0, 32.0],
  UM: [19.28, 166.6], US: [38.0, -97.0], UY: [-33.0, -56.0], UZ: [41.0, 64.0], VA: [41.9, 12.45],
  VC: [13.25, -61.2], VE: [8.0, -66.0], VG: [18.43, -64.62], VI: [18.33, -64.83], VN: [16.17, 107.83],
  VU: [-16.0, 167.0], WF: [-13.3, -176.2], WS: [-13.58, -172.33], YE: [15.0, 48.0], YT: [-12.83, 45.17],
  ZA: [-29.0, 24.0], ZM: [-15.0, 30.0], ZW: [-19.0, 29.5],
};

// ============================================================
// Simplified world map. Continent outlines as SVG path data,
// projected with equirectangular onto the 1000x500 viewBox.
// 24 paths, ~5 KB total. Stylized — recognisable continents,
// no copyrighted source data, just hand-chosen control points.
// ============================================================
const WORLD_MAP_PATHS = [
  // North America
  "M33.3,66.7L66.7,52.8L111.1,55.6L144.4,55.6L194.4,44.4L238.9,44.4L283.3,50.0L311.1,66.7L322.2,83.3L341.7,97.2L347.2,108.3L355.6,119.4L319.4,127.8L305.6,136.1L294.4,138.9L288.9,152.8L277.8,161.1L277.8,177.8L272.2,180.6L252.8,169.4L238.9,169.4L230.6,177.8L230.6,191.7L238.9,200.0L255.6,200.0L258.3,191.7L250.0,191.7L252.8,205.6L266.7,208.3L269.4,216.7L269.4,222.2L286.1,225.0L283.3,227.8L277.8,225.0L258.3,216.7L238.9,208.3L222.2,202.8L205.6,191.7L194.4,186.1L183.3,169.4L175.0,161.1L166.7,155.6L158.3,144.4L155.6,130.6L155.6,119.4L144.4,111.1L133.3,100.0L122.2,88.9L97.2,83.3L83.3,83.3L61.1,88.9L50.0,97.2L44.4,100.0L47.2,83.3L41.7,72.2Z",
  // Greenland
  "M408.3,19.4L438.9,22.2L450.0,33.3L444.4,44.4L438.9,55.6L400.0,69.4L375.0,80.6L355.6,66.7L347.2,50.0L338.9,38.9L319.4,30.6L347.2,22.2L375.0,19.4Z",
  // Cuba
  "M272.2,186.1L283.3,186.1L288.9,191.7L291.7,194.4L286.1,194.4L269.4,188.9Z",
  // Hispaniola
  "M297.2,194.4L311.1,197.2L311.1,200.0L297.2,200.0L297.2,197.2Z",
  // South America
  "M300.0,216.7L308.3,216.7L319.4,222.2L327.8,219.4L333.3,227.8L355.6,236.1L361.1,247.2L400.0,263.9L394.4,283.3L388.9,311.1L366.7,319.4L355.6,338.9L338.9,344.4L327.8,361.1L313.9,377.8L308.3,388.9L311.1,400.0L305.6,402.8L291.7,394.4L291.7,377.8L297.2,366.7L297.2,352.8L302.8,333.3L305.6,313.9L302.8,300.0L286.1,283.3L275.0,263.9L275.0,255.6L277.8,247.2L283.3,233.3L286.1,227.8L288.9,225.0Z",
  // Africa
  "M483.3,147.2L525.0,147.2L530.6,158.3L569.4,163.9L588.9,163.9L588.9,166.7L591.7,169.4L594.4,175.0L600.0,188.9L605.6,200.0L611.1,208.3L619.4,216.7L638.9,222.2L630.6,236.1L613.9,255.6L608.3,269.4L611.1,288.9L591.7,322.2L586.1,333.3L569.4,344.4L550.0,344.4L547.2,330.6L538.9,313.9L533.3,291.7L533.3,266.7L525.0,252.8L525.0,238.9L516.7,238.9L508.3,233.3L500.0,236.1L480.6,238.9L463.9,236.1L455.6,222.2L452.8,208.3L452.8,191.7L463.9,175.0L472.2,166.7L477.8,158.3L483.3,152.8Z",
  // Madagascar
  "M636.1,283.3L638.9,291.7L633.3,311.1L630.6,319.4L622.2,319.4L619.4,308.3L627.8,291.7L633.3,286.1Z",
  // Eurasia
  "M569.4,52.8L583.3,55.6L613.9,63.9L638.9,61.1L666.7,55.6L708.3,47.2L777.8,44.4L791.7,38.9L861.1,47.2L894.4,47.2L922.2,52.8L994.4,55.6L977.8,66.7L986.1,77.8L950.0,83.3L930.6,86.1L894.4,100.0L894.4,119.4L872.2,130.6L861.1,141.7L847.2,141.7L836.1,152.8L836.1,169.4L813.9,186.1L800.0,191.7L802.8,211.1L791.7,222.2L786.1,247.2L775.0,227.8L763.9,205.6L752.8,188.9L738.9,194.4L722.2,216.7L713.9,227.8L702.8,208.3L694.4,188.9L686.1,183.3L666.7,180.6L655.6,177.8L655.6,183.3L663.9,188.9L652.8,202.8L652.8,213.9L625.0,216.7L619.4,211.1L616.7,205.6L608.3,191.7L597.2,172.2L597.2,169.4L591.7,166.7L594.4,163.9L597.2,158.3L600.0,152.8L600.0,150.0L600.0,147.2L613.9,138.9L613.9,133.3L600.0,125.0L583.3,125.0L577.8,127.8L577.8,133.3L577.8,136.1L572.2,138.9L563.9,141.7L561.1,147.2L555.6,141.7L552.8,138.9L544.4,130.6L536.1,125.0L527.8,127.8L519.4,130.6L511.1,130.6L508.3,136.1L500.0,141.7L494.4,147.2L486.1,150.0L475.0,147.2L475.0,130.6L494.4,125.0L486.1,116.7L502.8,111.1L511.1,102.8L522.2,100.0L522.2,91.7L513.9,88.9L513.9,77.8L536.1,66.7L538.9,61.1L555.6,55.6Z",
  // Iceland
  "M438.9,66.7L455.6,66.7L461.1,72.2L447.2,75.0L436.1,72.2Z",
  // Great Britain
  "M491.7,88.9L494.4,88.9L494.4,91.7L497.2,100.0L505.6,105.6L502.8,108.3L497.2,111.1L486.1,111.1L486.1,105.6L491.7,100.0L486.1,97.2L483.3,94.4L483.3,88.9Z",
  // Ireland
  "M477.8,97.2L483.3,100.0L483.3,105.6L472.2,108.3L472.2,102.8Z",
  // Japan
  "M894.4,125.0L905.6,130.6L891.7,136.1L894.4,144.4L888.9,152.8L866.7,158.3L861.1,163.9L861.1,158.3L866.7,152.8L883.3,144.4L888.9,136.1L888.9,133.3L891.7,125.0Z",
  // Taiwan
  "M836.1,180.6L838.9,183.3L836.1,188.9L833.3,188.9L833.3,183.3Z",
  // Philippines
  "M836.1,200.0L838.9,205.6L844.4,216.7L847.2,227.8L847.2,233.3L838.9,222.2L836.1,213.9L833.3,208.3Z",
  // Sri Lanka
  "M722.2,222.2L727.8,227.8L725.0,233.3L722.2,230.6Z",
  // Sumatra
  "M763.9,236.1L772.2,236.1L783.3,252.8L791.7,266.7L777.8,258.3L766.7,244.4Z",
  // Java
  "M791.7,266.7L802.8,269.4L813.9,272.2L819.4,272.2L813.9,269.4L805.6,266.7Z",
  // Borneo
  "M825.0,230.6L830.6,238.9L825.0,252.8L813.9,258.3L805.6,258.3L802.8,247.2L805.6,236.1Z",
  // Sulawesi
  "M833.3,247.2L844.4,244.4L838.9,255.6L830.6,263.9L838.9,263.9L833.3,255.6Z",
  // New Guinea
  "M866.7,252.8L891.7,258.3L902.8,266.7L894.4,275.0L916.7,277.8L908.3,275.0L883.3,269.4L872.2,258.3Z",
  // Australia
  "M866.7,280.6L891.7,283.3L902.8,291.7L908.3,302.8L925.0,319.4L919.4,344.4L916.7,352.8L908.3,358.3L900.0,355.6L888.9,352.8L883.3,347.2L872.2,338.9L855.6,336.1L836.1,341.7L825.0,347.2L819.4,338.9L813.9,322.2L816.7,311.1L830.6,305.6L844.4,297.2L855.6,288.9L863.9,283.3Z",
  // Tasmania
  "M902.8,363.9L911.1,363.9L911.1,369.4L905.6,372.2L900.0,369.4Z",
  // New Zealand North
  "M980.6,344.4L986.1,352.8L994.4,358.3L986.1,363.9L983.3,358.3L983.3,350.0Z",
  // New Zealand South
  "M977.8,363.9L983.3,366.7L969.4,377.8L963.9,377.8L966.7,372.2Z",
];

// State for the geo map — keyed by remote_addr so we can update existing
// dots smoothly rather than redrawing from scratch every refresh.
const _geoState = {
  initialized: false,
  dotsLayer: null,
  tooltip: null,
  emptyEl: null,
  // remote_addr → { dot SVG element, last data, last seen timestamp }
  dots: new Map(),
};

function setupGeoMap() {
  if (_geoState.initialized) return;

  // 1. Inject the world map paths into the <g id="geo-map-land">
  const landLayer = document.getElementById('geo-map-land');
  if (landLayer && !landLayer.children.length) {
    const svgNS = 'http://www.w3.org/2000/svg';
    WORLD_MAP_PATHS.forEach(d => {
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      landLayer.appendChild(path);
    });
  }

  // 2. Inject latitude/longitude reference grid
  const gridLayer = document.getElementById('geo-map-grid');
  if (gridLayer && !gridLayer.children.length) {
    const svgNS = 'http://www.w3.org/2000/svg';
    // Latitude lines every 30 degrees
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = ((90 - lat) / 180) * 500;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('y1', y);
      line.setAttribute('x2', '1000');
      line.setAttribute('y2', y);
      if (lat === 0) line.setAttribute('class', 'equator');
      gridLayer.appendChild(line);
    }
    // Longitude lines every 60 degrees
    for (let lon = -120; lon <= 120; lon += 60) {
      const x = ((lon + 180) / 360) * 1000;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', x);
      line.setAttribute('y1', '0');
      line.setAttribute('x2', x);
      line.setAttribute('y2', '500');
      if (lon === 0) line.setAttribute('class', 'prime-meridian');
      gridLayer.appendChild(line);
    }
  }

  _geoState.dotsLayer = document.getElementById('geo-map-dots');
  _geoState.tooltip = document.getElementById('geo-map-tooltip');
  _geoState.emptyEl = document.getElementById('geo-map-empty');

  // View toggle buttons (Table / Map)
  document.querySelectorAll('[data-insp-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.inspView;
      // Toggle button active state
      document.querySelectorAll('[data-insp-view]').forEach(b =>
        b.classList.toggle('active', b === btn));
      // Show/hide panes
      document.querySelectorAll('[data-insp-pane]').forEach(pane => {
        pane.hidden = pane.dataset.inspPane !== view;
      });
      const body = document.querySelector('.insp-body');
      if (body) body.dataset.inspActiveView = view;
      // Force a refresh when switching to map so dots are current
      if (view === 'map' && typeof refreshInspector === 'function') refreshInspector();
    });
  });

  _geoState.initialized = true;
}

// Compute dot radius from total bytes — sqrt scaling so a 100x byte
// difference shows as a 10x area difference, not a 100x one.
function _geoDotRadius(totalBytes) {
  if (!totalBytes || totalBytes < 100) return 3;
  const r = 3 + Math.min(12, Math.sqrt(totalBytes / 1024) * 0.7);
  return Math.min(15, r);
}

function _formatBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// v2.5.2 — Update the geo map stats bar with aggregate values.
// `rows` is the full inspector row list (incl. unplottable like localhost),
// `byCountry` is the already-bucketed map of plottable countries.
function _updateGeoStats(rows, byCountry) {
  const ccountEl = document.getElementById('geo-stat-countries');
  const conncEl  = document.getElementById('geo-stat-conns');
  const inEl     = document.getElementById('geo-stat-in');
  const outEl    = document.getElementById('geo-stat-out');
  const topEl    = document.getElementById('geo-stat-top');

  const countries = Object.keys(byCountry || {});
  if (ccountEl) ccountEl.textContent = countries.length;
  if (conncEl)  conncEl.textContent = (rows || []).length;

  let totalIn = 0, totalOut = 0;
  let topCC = null, topBytes = 0;
  for (const [cc, conns] of Object.entries(byCountry || {})) {
    let countryBytes = 0;
    for (const c of conns) {
      totalIn  += (c.bytes_in  || 0);
      totalOut += (c.bytes_out || 0);
      countryBytes += (c.bytes_in || 0) + (c.bytes_out || 0);
    }
    if (countryBytes > topBytes) { topBytes = countryBytes; topCC = cc; }
  }
  if (inEl)  inEl.textContent  = _formatBytes(totalIn);
  if (outEl) outEl.textContent = _formatBytes(totalOut);
  if (topEl) topEl.textContent = topCC || '—';
}

// Called from the existing inspector refresh flow with the same row data
function renderGeoMap(rows) {
  if (!_geoState.initialized) return;
  if (!_geoState.dotsLayer) return;

  // Group connections by country first — we need this to decide which
  // empty-state message to show (no rows at all vs rows-but-none-plottable).
  const svgNS = 'http://www.w3.org/2000/svg';
  const now = Date.now() / 1000;
  const seenAddrs = new Set();
  const byCountry = {};
  if (rows && rows.length) {
    rows.forEach(r => {
      const cc = (r.country || '').toUpperCase();
      if (!cc || !COUNTRY_COORDS[cc]) return;
      if (!byCountry[cc]) byCountry[cc] = [];
      byCountry[cc].push(r);
    });
  }
  const plottableCount = Object.values(byCountry).reduce((n, arr) => n + arr.length, 0);

  // v2.5.2 — Update the stats bar (countries / connections / total bytes)
  _updateGeoStats(rows || [], byCountry);

  // Empty-state visibility + message
  if (_geoState.emptyEl) {
    if (plottableCount > 0) {
      _geoState.emptyEl.hidden = true;
    } else {
      _geoState.emptyEl.hidden = false;
      const txt = _geoState.emptyEl.querySelector('.geo-empty-text');
      const sub = _geoState.emptyEl.querySelector('.geo-empty-sub');
      if (rows && rows.length) {
        if (txt) txt.textContent = 'No mappable connections';
        if (sub) sub.textContent = `${rows.length} connection${rows.length === 1 ? '' : 's'} active — but they're local or private addresses with no geo data. The Table view shows them all.`;
      } else {
        if (txt) txt.textContent = 'No connections yet';
        if (sub) sub.textContent = "Start capture on a target app — connections will plot here as they're made";
      }
    }
  }

  if (plottableCount === 0) {
    // Clear all dots and bail
    _geoState.dotsLayer.innerHTML = '';
    _geoState.dots.clear();
    return;
  }

  // v2.5.2 — fully stable hash → 2D offset. The earlier version still depended
  // on `idx` for distance, so when a connection appeared/disappeared in the
  // same country, every other dot's idx (and therefore distance) shifted —
  // that's the glitch the user reported. This version derives both angle AND
  // distance from the address hash directly, so each connection has a fixed
  // position regardless of how many other connections exist in that country.
  // Trade-off: a single connection won't sit at the exact country center,
  // but it'll still be within ~12px so it visually reads as "at" the country.
  function _stableJitterFor(addr) {
    if (!addr) return { dx: 0, dy: 0 };
    // Two independent hashes for two stable dimensions
    let h1 = 0, h2 = 5381;
    for (let c = 0; c < addr.length; c++) {
      h1 = (h1 * 31 + addr.charCodeAt(c)) | 0;
      h2 = ((h2 << 5) + h2 + addr.charCodeAt(c)) | 0;  // djb2
    }
    const angle = ((Math.abs(h1) % 10000) / 10000) * Math.PI * 2;
    // Distance: 0 to 12px from country center, derived from second hash.
    const dist = (Math.abs(h2) % 1200) / 100;
    return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist };
  }

  Object.entries(byCountry).forEach(([cc, conns]) => {
    const [lat, lon] = COUNTRY_COORDS[cc];
    const center = geoProject(lat, lon);

    conns.forEach((r, idx) => {
      const addr = r.remote_addr || `${cc}-${idx}`;
      seenAddrs.add(addr);

      const jitter = _stableJitterFor(addr);

      const x = center.x + jitter.dx;
      const y = center.y + jitter.dy;
      const totalBytes = (r.bytes_in || 0) + (r.bytes_out || 0);
      const radius = _geoDotRadius(totalBytes);

      // Determine active/idle: active if seen in last 5 seconds
      const isActive = (r.last_seen && (now - r.last_seen) < 5);

      let entry = _geoState.dots.get(addr);
      if (!entry) {
        // Create new dot SVG group
        const group = document.createElementNS(svgNS, 'g');
        group.setAttribute('class', 'geo-dot');
        group.style.setProperty('--dot-r', radius);

        // Pulse circle (only animates when active)
        const pulse = document.createElementNS(svgNS, 'circle');
        pulse.setAttribute('cx', x);
        pulse.setAttribute('cy', y);
        pulse.setAttribute('r', radius);
        pulse.setAttribute('class', 'geo-dot-pulse');
        group.appendChild(pulse);

        // Core circle (the actual dot)
        const core = document.createElementNS(svgNS, 'circle');
        core.setAttribute('cx', x);
        core.setAttribute('cy', y);
        core.setAttribute('r', radius);
        core.setAttribute('class', 'geo-dot-core');
        group.appendChild(core);

        // Hover for tooltip
        group.addEventListener('mouseenter', e => _geoShowTooltip(e, r));
        group.addEventListener('mousemove', e => _geoMoveTooltip(e));
        group.addEventListener('mouseleave', () => _geoHideTooltip());

        _geoState.dotsLayer.appendChild(group);
        entry = { group, pulse, core, data: r };
        _geoState.dots.set(addr, entry);
      } else {
        // Update existing dot's position and size
        entry.pulse.setAttribute('cx', x);
        entry.pulse.setAttribute('cy', y);
        entry.pulse.setAttribute('r', radius);
        entry.core.setAttribute('cx', x);
        entry.core.setAttribute('cy', y);
        entry.core.setAttribute('r', radius);
        entry.group.style.setProperty('--dot-r', radius);
        entry.data = r;
      }

      entry.group.classList.toggle('is-active', isActive);
      entry.group.classList.toggle('is-idle', !isActive);
    });
  });

  // Remove dots for connections that are no longer present
  for (const [addr, entry] of _geoState.dots.entries()) {
    if (!seenAddrs.has(addr)) {
      entry.group.remove();
      _geoState.dots.delete(addr);
    }
  }
}

function _geoShowTooltip(e, conn) {
  if (!_geoState.tooltip) return;
  const host = document.getElementById('geo-tt-host');
  const meta = document.getElementById('geo-tt-meta');
  const stats = document.getElementById('geo-tt-stats');
  if (host) host.textContent = conn.hostname || conn.remote_addr || '—';
  if (meta) meta.textContent =
    `${conn.country || '??'} · ${conn.proto || '?'} · port ${conn.remote_port || 0}`;
  if (stats) stats.innerHTML =
    `↑ ${_formatBytes(conn.bytes_out || 0)}    ↓ ${_formatBytes(conn.bytes_in || 0)}`;
  _geoState.tooltip.hidden = false;
  _geoMoveTooltip(e);
}

function _geoMoveTooltip(e) {
  if (!_geoState.tooltip || _geoState.tooltip.hidden) return;
  const wrap = document.querySelector('.insp-map-wrap');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const tx = e.clientX - rect.left + 14;
  const ty = e.clientY - rect.top + 14;
  // Keep tooltip inside the map bounds
  const ttRect = _geoState.tooltip.getBoundingClientRect();
  const maxX = rect.width - ttRect.width - 8;
  const maxY = rect.height - ttRect.height - 8;
  _geoState.tooltip.style.left = Math.min(tx, maxX) + 'px';
  _geoState.tooltip.style.top = Math.min(ty, maxY) + 'px';
}

function _geoHideTooltip() {
  if (_geoState.tooltip) _geoState.tooltip.hidden = true;
}

// Hook into the existing renderInspectorTable to also populate the map.
// The original function still does its job for the table view; we just
// piggy-back so map data stays in sync with table data.
const _origRenderInspector_v250 = typeof renderInspectorTable === 'function'
  ? renderInspectorTable : null;
if (_origRenderInspector_v250) {
  window.renderInspectorTable = function (rows) {
    _origRenderInspector_v250(rows);
    try { renderGeoMap(rows); } catch (e) { console.error('[geo-map]', e); }
  };
}

// Initialize on DOM ready
(function initGeoMap() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupGeoMap);
  } else {
    setupGeoMap();
  }
})();


// ============================================================
// Phase 3 (v2.6.0) — Automation rules tab + editor
// ============================================================
// Renders the rules list, opens the editor modal, talks to the bridge for
// save/delete/test/master-toggle, and animates rule cards when they fire.
// ============================================================

let _automationRules = [];           // local cache, refreshed from bridge
let _editingRuleId = null;            // rule id being edited (null = new)
let _automationEngineOn = true;

function _autoFmtRuleSummary(rule) {
  const c = rule.condition || {};
  const a = rule.action || {};
  let when = '';
  switch (c.type) {
    case 'schedule': {
      const days = (c.weekdays || []).map(d => ['Mo','Tu','We','Th','Fr','Sa','Su'][d]).join('');
      when = `⏰ ${c.start || '?'}–${c.end || '?'} · ${days || 'no days'}`;
      break;
    }
    case 'app_running':
      when = `🎯 ${c.process_name || '?'} running`;
      break;
    case 'bandwidth':
      when = `📊 BW > ${c.threshold_kbps || 0} KB/s`;
      break;
    case 'conn_count':
      when = `🔢 conns > ${c.threshold || 0}`;
      break;
    default:
      when = '?';
  }
  let then = '';
  switch (a.type) {
    case 'preset':
      then = `📦 apply "${a.preset_name || '?'}"`;
      break;
    case 'function':
      then = `🎚 ${a.function || '?'} ${a.on ? 'ON' : 'OFF'}`;
      break;
    case 'toast':
      then = `💬 toast`;
      break;
    case 'capture':
      then = a.command === 'stop' ? '◼ stop capture' : '▶︎ start capture';
      break;
    default:
      then = '?';
  }
  return { when, then };
}

function _autoRenderRules() {
  const list = document.getElementById('auto-rules-list');
  const empty = document.getElementById('auto-empty');
  if (!list) return;
  list.innerHTML = '';
  if (!_automationRules || _automationRules.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  for (const rule of _automationRules) {
    const card = document.createElement('div');
    card.className = 'auto-rule-card';
    card.dataset.ruleId = rule.id;
    card.dataset.disabled = rule.enabled === false ? '1' : '0';

    const summary = _autoFmtRuleSummary(rule);

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'rule-toggle';
    toggle.checked = rule.enabled !== false;
    toggle.title = rule.enabled === false ? 'Enable this rule' : 'Disable this rule';
    toggle.addEventListener('change', () => {
      const on = toggle.checked;
      bridge.setAutomationRuleEnabled(rule.id, on).then((ok) => {
        if (ok) {
          rule.enabled = on;
          card.dataset.disabled = on ? '0' : '1';
          toggle.title = on ? 'Disable this rule' : 'Enable this rule';
        } else {
          // Revert
          toggle.checked = rule.enabled !== false;
          toast('Failed to toggle rule', 'error');
        }
      });
    });
    card.appendChild(toggle);

    const info = document.createElement('div');
    info.className = 'rule-info';
    const name = document.createElement('span');
    name.className = 'rule-name';
    name.textContent = rule.name || '(unnamed)';
    info.appendChild(name);
    const sumEl = document.createElement('span');
    sumEl.className = 'rule-summary';
    sumEl.innerHTML =
      `<span class="when">${summary.when}</span> ⟶ <span class="then">${summary.then}</span>`;
    info.appendChild(sumEl);
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'rule-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'rule-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => _autoOpenEditor(rule));
    const delBtn = document.createElement('button');
    delBtn.className = 'rule-btn danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => _autoDeleteRule(rule));
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    list.appendChild(card);
  }
}

function _autoLoadRules() {
  if (!bridge || !bridge.getAutomationRules) return;
  bridge.getAutomationRules().then((raw) => {
    let res = {};
    try { res = JSON.parse(raw || '{}'); } catch {}
    _automationRules = Array.isArray(res.rules) ? res.rules : [];
    _automationEngineOn = !!res.engine_enabled;
    const eng = document.getElementById('auto-engine-enabled');
    if (eng) eng.checked = _automationEngineOn;
    _autoRenderRules();
  });
}

function _autoDeleteRule(rule) {
  if (!confirm(`Delete rule "${rule.name}"? This can't be undone.`)) return;
  bridge.deleteAutomationRule(rule.id).then((ok) => {
    if (!ok) { toast('Failed to delete rule', 'error'); return; }
    _automationRules = _automationRules.filter(r => r.id !== rule.id);
    _autoRenderRules();
    toast('Rule deleted', 'success');
  });
}

function _autoSwitchCondPane(type) {
  document.querySelectorAll('[data-cond-pane]').forEach(p => {
    p.hidden = p.dataset.condPane !== type;
  });
  const sel = document.getElementById('auto-cond-type');
  if (sel) sel.value = type;
}

function _autoSwitchActionPane(type) {
  document.querySelectorAll('[data-action-pane]').forEach(p => {
    p.hidden = p.dataset.actionPane !== type;
  });
  const sel = document.getElementById('auto-action-type');
  if (sel) sel.value = type;
}

function _autoPopulatePresetDropdown() {
  // Fetch user presets and populate the action's preset selector
  const sel = document.getElementById('auto-action-preset');
  if (!sel || !bridge || !bridge.getUserPresets) return;
  bridge.getUserPresets().then((raw) => {
    let presets = [];
    try { presets = JSON.parse(raw || '[]'); } catch {}
    const cur = sel.value;
    sel.innerHTML = '<option value="">— select a preset —</option>';
    for (const p of presets) {
      if (!p || !p.name) continue;
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      sel.appendChild(opt);
    }
    // Restore selection if it still exists
    if (cur && presets.some(p => p && p.name === cur)) sel.value = cur;
  });
}

function _autoPopulateProcessDatalist() {
  const list = document.getElementById('auto-cond-app-list');
  if (!list || !bridge || !bridge.listRunningProcesses) return;
  bridge.listRunningProcesses().then((raw) => {
    let names = [];
    try { names = JSON.parse(raw || '[]'); } catch {}
    list.innerHTML = '';
    for (const n of names) {
      const opt = document.createElement('option');
      opt.value = n;
      list.appendChild(opt);
    }
  });
}

function _autoOpenEditor(rule) {
  // rule = null/undefined for new, otherwise existing rule object to edit
  const modal = document.getElementById('auto-edit-modal');
  const titleEl = document.getElementById('auto-edit-title');
  if (!modal) return;

  _editingRuleId = rule ? rule.id : null;
  if (titleEl) titleEl.textContent = rule ? 'Edit automation rule' : 'New automation rule';

  // Refresh dropdowns each time so newly-saved presets / freshly-running processes show up
  _autoPopulatePresetDropdown();
  _autoPopulateProcessDatalist();

  // Fill name
  document.getElementById('auto-rule-name').value = rule ? (rule.name || '') : '';

  // Condition
  const c = (rule && rule.condition) ? rule.condition : { type: 'schedule' };
  _autoSwitchCondPane(c.type || 'schedule');
  if (c.type === 'schedule' || !rule) {
    document.getElementById('auto-cond-start').value = c.start || '09:00';
    document.getElementById('auto-cond-end').value = c.end || '17:00';
    const wds = c.weekdays || [0, 1, 2, 3, 4];
    document.querySelectorAll('#auto-weekday-row input[type="checkbox"]').forEach(cb => {
      cb.checked = wds.includes(parseInt(cb.dataset.wd, 10));
    });
  }
  if (c.type === 'app_running') {
    document.getElementById('auto-cond-app').value = c.process_name || '';
  } else if (!rule) {
    document.getElementById('auto-cond-app').value = '';
  }
  if (c.type === 'bandwidth') {
    document.getElementById('auto-cond-bw').value = c.threshold_kbps || 500;
  } else if (!rule) {
    document.getElementById('auto-cond-bw').value = 500;
  }
  if (c.type === 'conn_count') {
    document.getElementById('auto-cond-cc').value = c.threshold || 50;
  } else if (!rule) {
    document.getElementById('auto-cond-cc').value = 50;
  }

  // Action
  const a = (rule && rule.action) ? rule.action : { type: 'preset' };
  _autoSwitchActionPane(a.type || 'preset');
  if (a.type === 'preset') {
    setTimeout(() => {  // wait for dropdown populate
      const sel = document.getElementById('auto-action-preset');
      if (sel && a.preset_name) sel.value = a.preset_name;
    }, 100);
  }
  if (a.type === 'function') {
    document.getElementById('auto-action-func').value = a.function || 'lag';
    document.getElementById('auto-action-on').value = (a.on === false ? 'false' : 'true');
  } else if (!rule) {
    document.getElementById('auto-action-func').value = 'lag';
    document.getElementById('auto-action-on').value = 'true';
  }
  if (a.type === 'toast') {
    document.getElementById('auto-action-toast').value = a.message || '';
  } else if (!rule) {
    document.getElementById('auto-action-toast').value = '';
  }
  if (a.type === 'capture') {
    document.getElementById('auto-action-cap').value = a.command || 'start';
  } else if (!rule) {
    document.getElementById('auto-action-cap').value = 'start';
  }

  // Clear test result
  const tr = document.getElementById('auto-test-result');
  if (tr) { tr.textContent = ''; tr.className = 'auto-test-result'; }

  modal.hidden = false;
}

function _autoCloseEditor() {
  const modal = document.getElementById('auto-edit-modal');
  if (modal) modal.hidden = true;
  _editingRuleId = null;
}

function _autoBuildConditionFromForm() {
  const type = document.getElementById('auto-cond-type').value;
  if (type === 'schedule') {
    const wds = [];
    document.querySelectorAll('#auto-weekday-row input[type="checkbox"]').forEach(cb => {
      if (cb.checked) wds.push(parseInt(cb.dataset.wd, 10));
    });
    return {
      type: 'schedule',
      start: document.getElementById('auto-cond-start').value || '09:00',
      end:   document.getElementById('auto-cond-end').value   || '17:00',
      weekdays: wds,
    };
  }
  if (type === 'app_running') {
    return {
      type: 'app_running',
      process_name: (document.getElementById('auto-cond-app').value || '').trim(),
    };
  }
  if (type === 'bandwidth') {
    return {
      type: 'bandwidth',
      threshold_kbps: parseFloat(document.getElementById('auto-cond-bw').value) || 0,
    };
  }
  if (type === 'conn_count') {
    return {
      type: 'conn_count',
      threshold: parseInt(document.getElementById('auto-cond-cc').value, 10) || 0,
    };
  }
  return { type: 'schedule' };
}

function _autoBuildActionFromForm() {
  const type = document.getElementById('auto-action-type').value;
  if (type === 'preset') {
    return {
      type: 'preset',
      preset_name: document.getElementById('auto-action-preset').value || '',
    };
  }
  if (type === 'function') {
    return {
      type: 'function',
      function: document.getElementById('auto-action-func').value || 'lag',
      on: document.getElementById('auto-action-on').value === 'true',
    };
  }
  if (type === 'toast') {
    return {
      type: 'toast',
      message: (document.getElementById('auto-action-toast').value || '').trim(),
    };
  }
  if (type === 'capture') {
    return {
      type: 'capture',
      command: document.getElementById('auto-action-cap').value || 'start',
    };
  }
  return { type: 'preset' };
}

function _autoValidateForm(rule) {
  if (!rule.name) return 'Rule needs a name.';
  const c = rule.condition;
  if (c.type === 'schedule' && (!c.weekdays || c.weekdays.length === 0)) {
    return 'Pick at least one weekday for the schedule.';
  }
  if (c.type === 'app_running' && !c.process_name) {
    return 'Pick a process name for the app-running condition.';
  }
  if (c.type === 'bandwidth' && (!c.threshold_kbps || c.threshold_kbps <= 0)) {
    return 'Bandwidth threshold must be a positive number.';
  }
  if (c.type === 'conn_count' && (!c.threshold || c.threshold <= 0)) {
    return 'Connection count threshold must be a positive number.';
  }
  const a = rule.action;
  if (a.type === 'preset' && !a.preset_name) {
    return 'Pick a preset for the action (or save one first in Quick Presets).';
  }
  if (a.type === 'toast' && !a.message) {
    return 'Toast notification needs a message.';
  }
  return null;
}

function _autoSaveFromForm() {
  const name = document.getElementById('auto-rule-name').value.trim();
  const rule = {
    id: _editingRuleId || '',   // empty → backend generates
    name,
    enabled: true,
    condition: _autoBuildConditionFromForm(),
    action:    _autoBuildActionFromForm(),
  };
  // Preserve existing enabled state when editing
  if (_editingRuleId) {
    const existing = _automationRules.find(r => r.id === _editingRuleId);
    if (existing) rule.enabled = existing.enabled !== false;
  }
  const err = _autoValidateForm(rule);
  if (err) { toast(err, 'error'); return; }

  bridge.saveAutomationRule(JSON.stringify(rule)).then((raw) => {
    let res = {};
    try { res = JSON.parse(raw || '{}'); } catch {}
    if (!res.ok) { toast('Save failed: ' + (res.error || 'unknown'), 'error'); return; }
    rule.id = res.rule_id;
    // Update local cache
    const idx = _automationRules.findIndex(r => r.id === rule.id);
    if (idx >= 0) _automationRules[idx] = rule;
    else _automationRules.push(rule);
    _autoRenderRules();
    _autoCloseEditor();
    toast(_editingRuleId ? 'Rule updated' : 'Rule created', 'success');
  });
}

function _autoTestCondition() {
  const cond = _autoBuildConditionFromForm();
  const tr = document.getElementById('auto-test-result');
  if (!tr) return;
  tr.textContent = 'Testing…';
  tr.className = 'auto-test-result';
  bridge.testAutomationCondition(JSON.stringify(cond)).then((raw) => {
    let res = {};
    try { res = JSON.parse(raw || '{}'); } catch {}
    if (res.error) {
      tr.textContent = '✗ ' + res.error;
      tr.className = 'auto-test-result is-error';
      return;
    }
    if (res.active) {
      tr.textContent = '✓ Active right now';
      tr.className = 'auto-test-result is-true';
    } else {
      tr.textContent = '○ Not active right now';
      tr.className = 'auto-test-result is-false';
    }
  });
}

function setupAutomationTab() {
  // Master engine toggle
  const eng = document.getElementById('auto-engine-enabled');
  if (eng) eng.addEventListener('change', () => {
    const on = eng.checked;
    bridge.setAutomationEngineEnabled(on).then((ok) => {
      if (!ok) { eng.checked = !on; toast('Failed to toggle engine', 'error'); return; }
      _automationEngineOn = on;
      toast(on ? 'Automation engine enabled' : 'Automation engine paused', on ? 'success' : 'info');
    });
  });

  // New rule button
  const newBtn = document.getElementById('auto-add-rule');
  if (newBtn) newBtn.addEventListener('click', () => _autoOpenEditor(null));

  // Editor controls
  const condTypeSel = document.getElementById('auto-cond-type');
  if (condTypeSel) condTypeSel.addEventListener('change', () => _autoSwitchCondPane(condTypeSel.value));
  const actionTypeSel = document.getElementById('auto-action-type');
  if (actionTypeSel) actionTypeSel.addEventListener('change', () => _autoSwitchActionPane(actionTypeSel.value));

  const saveBtn = document.getElementById('auto-edit-save');
  if (saveBtn) saveBtn.addEventListener('click', _autoSaveFromForm);
  const cancelBtn = document.getElementById('auto-edit-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', _autoCloseEditor);
  const closeBtn = document.getElementById('auto-edit-close');
  if (closeBtn) closeBtn.addEventListener('click', _autoCloseEditor);

  const testBtn = document.getElementById('auto-test-cond');
  if (testBtn) testBtn.addEventListener('click', _autoTestCondition);

  // Subscribe to fire events for visual flash + recent indicator
  if (bridge && bridge.automationRuleFired && bridge.automationRuleFired.connect) {
    bridge.automationRuleFired.connect((raw) => {
      let evt = {};
      try { evt = JSON.parse(raw || '{}'); } catch {}
      // Flash the card if visible
      const card = document.querySelector(`.auto-rule-card[data-rule-id="${evt.rule_id}"]`);
      if (card) {
        card.classList.remove('is-firing');
        // Force reflow so the animation restarts even if it was already running
        void card.offsetWidth;
        card.classList.add('is-firing');
      }
      // Update "last fired" indicator
      const recent = document.getElementById('auto-recent-fire');
      const nameEl = document.getElementById('auto-recent-name');
      const whenEl = document.getElementById('auto-recent-when');
      if (recent && nameEl && whenEl) {
        recent.hidden = false;
        nameEl.textContent = evt.rule_name || '(unnamed)';
        whenEl.textContent = 'just now';
        // Show a toast too
        toast(`Rule fired: ${evt.rule_name} → ${evt.action_summary}`, 'info');
      }
    });
  }

  // Initial load — bridge is guaranteed ready by the init IIFE
  _autoLoadRules();
}

// Initialise once DOM + bridge are both ready
(function initAutomation() {
  let _autoInitRetries = 0;
  const MAX_RETRIES = 50;   // ~10 seconds at 200ms — enough for any normal startup
  function tryInit() {
    if (typeof bridge !== 'undefined' && bridge && bridge.getAutomationRules) {
      setupAutomationTab();
      return;
    }
    _autoInitRetries++;
    if (_autoInitRetries < MAX_RETRIES) {
      setTimeout(tryInit, 200);
    }
    // After MAX_RETRIES we silently give up — bridge isn't coming. This
    // happens in test/non-Throttlr environments and is harmless.
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();


// ============================================================
// Phase 4 (v2.7.0) — Throttlr Studio: visual timeline editor
// ============================================================
// Canvas-based multi-lane editor for .thrtlrec recordings. Each function
// (lag/drop/throttle/freeze/block/fun) gets a horizontal lane. Function
// on-periods render as colored blocks. Drag to move, drag edges to resize,
// click empty space to add, click+Delete to remove. Undo/redo via stack.
// ============================================================

const STUDIO_LANES = [
  { key: 'lag',      label: 'Lag',      color: '#ffb800' },
  { key: 'drop',     label: 'Drop',     color: '#ff5b5b' },
  { key: 'throttle', label: 'Throttle', color: '#66ddff' },
  { key: 'freeze',   label: 'Freeze',   color: '#7fbfff' },
  { key: 'block',    label: 'Block',    color: '#888888' },
  { key: 'fun',      label: 'Fun',      color: '#c66bff' },
];
const STUDIO_LANE_HEIGHT  = 44;
const STUDIO_RULER_HEIGHT = 28;
const STUDIO_HANDLE_PX    = 6;     // edge resize zone width

// Studio state
let _studio = {
  open: false,
  src_path: '',
  events: [],            // [{lane, start_ms, end_ms, params}, ...]
  duration_ms: 0,
  zoom: 1.0,             // 1.0 = fit-to-width baseline
  base_pixels_per_ms: 0,
  scrub_ms: 0,
  selected_idx: -1,
  hover_idx: -1,
  drag_state: null,      // {mode: 'move'|'resize-left'|'resize-right'|'scrub'|'create', ...}
  history: [],           // undo stack of {events, duration}
  future: [],            // redo stack
  snap_ms: 1000,
  meta: {},
};

function setupStudio() {
  // Wire up close button and keyboard shortcuts
  const modal = document.getElementById('studio-modal');
  if (!modal) return;

  document.getElementById('studio-close-btn')?.addEventListener('click', _studioClose);

  // Toolbar
  document.getElementById('studio-undo')?.addEventListener('click', _studioUndo);
  document.getElementById('studio-redo')?.addEventListener('click', _studioRedo);
  document.getElementById('studio-snap')?.addEventListener('change', (e) => {
    _studio.snap_ms = parseInt(e.target.value, 10) || 0;
  });
  document.getElementById('studio-zoom-in')?.addEventListener('click', () => _studioZoom(1.5));
  document.getElementById('studio-zoom-out')?.addEventListener('click', () => _studioZoom(1 / 1.5));
  document.getElementById('studio-zoom-fit')?.addEventListener('click', () => { _studio.zoom = 1.0; _studioRender(); });
  document.getElementById('studio-save-btn')?.addEventListener('click', () => _studioSave(false));
  document.getElementById('studio-saveas-btn')?.addEventListener('click', () => _studioSave(true));

  // Canvas events
  const canvas = document.getElementById('studio-canvas');
  if (canvas) {
    canvas.addEventListener('mousedown', _studioMouseDown);
    canvas.addEventListener('mousemove', _studioMouseMove);
    canvas.addEventListener('mouseup',   _studioMouseUp);
    canvas.addEventListener('mouseleave', _studioMouseUp);
    canvas.addEventListener('wheel',     _studioWheel, { passive: false });
  }

  // Keyboard
  document.addEventListener('keydown', _studioKeyDown);
}

function _studioOpen(src_path) {
  if (!bridge || !bridge.getStudioTimeline) return;
  bridge.getStudioTimeline(src_path).then((raw) => {
    let res = {};
    try { res = JSON.parse(raw || '{}'); } catch {}
    if (!res.ok) {
      toast('Could not open recording: ' + (res.error || 'unknown error'), 'error');
      return;
    }
    _studio.open = true;
    _studio.src_path = src_path;
    _studio.events = (res.events || []).map(e => ({...e}));
    _studio.duration_ms = res.duration_ms || 0;
    _studio.scrub_ms = 0;
    _studio.selected_idx = -1;
    _studio.hover_idx = -1;
    _studio.history = [];
    _studio.future = [];
    _studio.zoom = 1.0;
    _studio.meta = {
      target: res.target || '',
      started: res.started || '',
      ended: res.ended || '',
      edited: res.edited || '',
    };

    // Subtitle showing source path
    const sub = document.getElementById('studio-subtitle');
    if (sub) {
      const fname = (src_path || '').split(/[/\\]/).pop() || '';
      sub.textContent = `editing ${fname}${res.target ? ` (${res.target})` : ''}`;
    }

    document.getElementById('studio-modal').hidden = false;
    _studioRenderLaneLabels();
    setTimeout(_studioRender, 50);  // wait one frame for layout
  });
}

function _studioClose() {
  _studio.open = false;
  document.getElementById('studio-modal').hidden = true;
}

function _studioRenderLaneLabels() {
  const container = document.getElementById('studio-lanes-labels');
  if (!container) return;
  container.innerHTML = '';
  for (const lane of STUDIO_LANES) {
    const div = document.createElement('div');
    div.className = 'studio-lane-label';
    div.innerHTML = `<span class="swatch" style="background:${lane.color}"></span>${lane.label}`;
    container.appendChild(div);
  }
}

function _studioRecordSnapshot() {
  // Push current state onto undo stack, clear redo
  _studio.history.push({
    events: _studio.events.map(e => ({...e, params: e.params ? {...e.params} : {}})),
    duration_ms: _studio.duration_ms,
  });
  if (_studio.history.length > 100) _studio.history.shift();
  _studio.future = [];
  _studioUpdateUndoButtons();
}

function _studioUpdateUndoButtons() {
  document.getElementById('studio-undo').disabled = _studio.history.length === 0;
  document.getElementById('studio-redo').disabled = _studio.future.length === 0;
}

function _studioUndo() {
  if (_studio.history.length === 0) return;
  _studio.future.push({
    events: _studio.events.map(e => ({...e, params: e.params ? {...e.params} : {}})),
    duration_ms: _studio.duration_ms,
  });
  const prev = _studio.history.pop();
  _studio.events = prev.events;
  _studio.duration_ms = prev.duration_ms;
  _studio.selected_idx = -1;
  _studioUpdateUndoButtons();
  _studioRender();
}

function _studioRedo() {
  if (_studio.future.length === 0) return;
  _studio.history.push({
    events: _studio.events.map(e => ({...e, params: e.params ? {...e.params} : {}})),
    duration_ms: _studio.duration_ms,
  });
  const next = _studio.future.pop();
  _studio.events = next.events;
  _studio.duration_ms = next.duration_ms;
  _studio.selected_idx = -1;
  _studioUpdateUndoButtons();
  _studioRender();
}

function _studioZoom(factor) {
  _studio.zoom = Math.max(0.1, Math.min(20, _studio.zoom * factor));
  _studioRender();
}

function _studioWheel(e) {
  e.preventDefault();
  if (e.deltaY < 0) _studioZoom(1.1);
  else _studioZoom(1 / 1.1);
}

function _studioKeyDown(e) {
  if (!_studio.open) return;
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y for undo/redo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault(); _studioUndo(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault(); _studioRedo(); return;
  }
  // Delete to remove selected event
  if ((e.key === 'Delete' || e.key === 'Backspace') && _studio.selected_idx >= 0) {
    e.preventDefault();
    _studioRecordSnapshot();
    _studio.events.splice(_studio.selected_idx, 1);
    _studio.selected_idx = -1;
    _studioRender();
    return;
  }
  // +/- for zoom
  if (e.key === '+' || e.key === '=') { e.preventDefault(); _studioZoom(1.5); return; }
  if (e.key === '-') { e.preventDefault(); _studioZoom(1/1.5); return; }
}

function _studioPxPerMs() {
  const canvas = document.getElementById('studio-canvas');
  const wrap = canvas?.parentElement;
  if (!canvas || !wrap || _studio.duration_ms <= 0) return 0.01;
  // Base = fit visible duration into wrap width
  const visible_w = Math.max(400, wrap.clientWidth);
  _studio.base_pixels_per_ms = visible_w / Math.max(1000, _studio.duration_ms);
  return _studio.base_pixels_per_ms * _studio.zoom;
}

function _studioCanvasWidthForData() {
  return Math.max(400, _studio.duration_ms * _studioPxPerMs() + 40);
}

function _studioRender() {
  const canvas = document.getElementById('studio-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Resize canvas based on zoom / data
  const total_h = STUDIO_RULER_HEIGHT + STUDIO_LANE_HEIGHT * STUDIO_LANES.length;
  const target_w = _studioCanvasWidthForData();
  if (canvas.width !== Math.floor(target_w)) canvas.width = Math.floor(target_w);
  if (canvas.height !== total_h) canvas.height = total_h;

  const w = canvas.width, h = canvas.height;
  const ppms = _studioPxPerMs();

  // --- Background ---
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, w, h);

  // --- Time ruler ---
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, 0, w, STUDIO_RULER_HEIGHT);
  // Tick marks every 1s, labels every 5s (or smarter at high zoom)
  const tick_interval = ppms < 0.05 ? 5000 : (ppms < 0.2 ? 2000 : 1000);
  const label_every = ppms < 0.1 ? 5 : (ppms < 0.5 ? 2 : 1);
  ctx.fillStyle = 'rgba(232,230,216,0.4)';
  ctx.font = "10px 'JetBrains Mono', 'Consolas', monospace";
  ctx.textBaseline = 'top';
  for (let t = 0, i = 0; t <= _studio.duration_ms + 100; t += tick_interval, i++) {
    const x = t * ppms;
    if (x > w) break;
    ctx.fillRect(x, STUDIO_RULER_HEIGHT - 6, 1, 6);
    if (i % label_every === 0) {
      ctx.fillText(_fmtMs(t), x + 3, 4);
    }
  }
  // Bottom border of ruler
  ctx.fillStyle = 'rgba(255,184,0,0.25)';
  ctx.fillRect(0, STUDIO_RULER_HEIGHT - 1, w, 1);

  // --- Lane backgrounds + dividers ---
  for (let li = 0; li < STUDIO_LANES.length; li++) {
    const y = STUDIO_RULER_HEIGHT + li * STUDIO_LANE_HEIGHT;
    if (li % 2 === 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(0, y, w, STUDIO_LANE_HEIGHT);
    }
    // Divider
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, y + STUDIO_LANE_HEIGHT - 1, w, 1);
  }

  // --- Event blocks ---
  for (let i = 0; i < _studio.events.length; i++) {
    const ev = _studio.events[i];
    const lane_idx = STUDIO_LANES.findIndex(l => l.key === ev.lane);
    if (lane_idx < 0) continue;
    const lane = STUDIO_LANES[lane_idx];
    const x = ev.start_ms * ppms;
    const w_block = Math.max(2, (ev.end_ms - ev.start_ms) * ppms);
    const y = STUDIO_RULER_HEIGHT + lane_idx * STUDIO_LANE_HEIGHT + 6;
    const h_block = STUDIO_LANE_HEIGHT - 12;
    const isSelected = i === _studio.selected_idx;
    const isHover    = i === _studio.hover_idx;

    // Body
    ctx.fillStyle = lane.color;
    ctx.globalAlpha = isSelected ? 1.0 : (isHover ? 0.85 : 0.7);
    ctx.fillRect(x, y, w_block, h_block);
    ctx.globalAlpha = 1.0;
    // Outline (thicker if selected)
    ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(0,0,0,0.4)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w_block - 1, h_block - 1);
    // Label (if there's room)
    if (w_block > 50) {
      ctx.fillStyle = '#000';
      ctx.font = "bold 10px 'JetBrains Mono', 'Consolas', monospace";
      ctx.textBaseline = 'middle';
      const dur = _fmtMs(ev.end_ms - ev.start_ms);
      ctx.fillText(`${lane.label} · ${dur}`, x + 5, y + h_block / 2);
    }
  }

  // --- Scrub head ---
  const scrub_x = _studio.scrub_ms * ppms;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(scrub_x, 0);
  ctx.lineTo(scrub_x, h);
  ctx.stroke();
  // Scrub handle (top triangle)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(scrub_x - 6, 0);
  ctx.lineTo(scrub_x + 6, 0);
  ctx.lineTo(scrub_x, 8);
  ctx.fill();

  // --- Time / event info readouts ---
  document.getElementById('studio-time').textContent =
    `${_fmtMs(_studio.scrub_ms)} / ${_fmtMs(_studio.duration_ms)}`;
  document.getElementById('studio-zoom-display').textContent =
    `${Math.round(_studio.zoom * 100)}%`;

  const info = document.getElementById('studio-event-info');
  if (info) {
    if (_studio.selected_idx >= 0 && _studio.events[_studio.selected_idx]) {
      const ev = _studio.events[_studio.selected_idx];
      info.textContent = `${ev.lane.toUpperCase()} · ${_fmtMs(ev.start_ms)} → ${_fmtMs(ev.end_ms)} · duration ${_fmtMs(ev.end_ms - ev.start_ms)}`;
    } else {
      info.textContent = `${_studio.events.length} event${_studio.events.length === 1 ? '' : 's'}`;
    }
  }
}

function _fmtMs(ms) {
  ms = Math.max(0, Math.round(ms));
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function _studioHitTest(mx, my) {
  // Returns {kind: 'event-body'|'event-left'|'event-right'|'scrub'|'lane'|'ruler', idx, lane_idx}
  const ppms = _studioPxPerMs();

  // Scrub head detection (top of canvas)
  const scrub_x = _studio.scrub_ms * ppms;
  if (my < STUDIO_RULER_HEIGHT && Math.abs(mx - scrub_x) <= 6) {
    return { kind: 'scrub' };
  }
  if (my < STUDIO_RULER_HEIGHT) return { kind: 'ruler' };

  const lane_idx = Math.floor((my - STUDIO_RULER_HEIGHT) / STUDIO_LANE_HEIGHT);
  if (lane_idx < 0 || lane_idx >= STUDIO_LANES.length) return { kind: 'none' };

  // Test event blocks on this lane
  for (let i = 0; i < _studio.events.length; i++) {
    const ev = _studio.events[i];
    if (ev.lane !== STUDIO_LANES[lane_idx].key) continue;
    const x = ev.start_ms * ppms;
    const w_block = Math.max(2, (ev.end_ms - ev.start_ms) * ppms);
    const y = STUDIO_RULER_HEIGHT + lane_idx * STUDIO_LANE_HEIGHT + 6;
    const h_block = STUDIO_LANE_HEIGHT - 12;
    if (mx >= x && mx <= x + w_block && my >= y && my <= y + h_block) {
      // Inside block — determine left edge / right edge / body
      if (mx < x + STUDIO_HANDLE_PX) return { kind: 'event-left',  idx: i, lane_idx };
      if (mx > x + w_block - STUDIO_HANDLE_PX) return { kind: 'event-right', idx: i, lane_idx };
      return { kind: 'event-body', idx: i, lane_idx };
    }
  }
  return { kind: 'lane', lane_idx };
}

function _studioSnap(ms) {
  if (_studio.snap_ms <= 0) return ms;
  return Math.round(ms / _studio.snap_ms) * _studio.snap_ms;
}

function _studioMouseDown(e) {
  const canvas = document.getElementById('studio-canvas');
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const ppms = _studioPxPerMs();
  const ms = mx / ppms;

  const hit = _studioHitTest(mx, my);

  if (hit.kind === 'scrub' || hit.kind === 'ruler') {
    _studio.drag_state = { mode: 'scrub' };
    _studio.scrub_ms = Math.max(0, Math.min(_studio.duration_ms, ms));
    canvas.classList.add('is-scrubbing');
    _studioRender();
    return;
  }
  if (hit.kind === 'event-body') {
    _studio.selected_idx = hit.idx;
    _studio.drag_state = {
      mode: 'move', idx: hit.idx,
      grab_offset_ms: ms - _studio.events[hit.idx].start_ms,
      orig_start: _studio.events[hit.idx].start_ms,
      orig_end:   _studio.events[hit.idx].end_ms,
      moved: false,
    };
    canvas.classList.add('is-dragging');
    _studioRecordSnapshot();
    _studioRender();
    return;
  }
  if (hit.kind === 'event-left') {
    _studio.selected_idx = hit.idx;
    _studio.drag_state = {
      mode: 'resize-left', idx: hit.idx,
      orig_start: _studio.events[hit.idx].start_ms,
      orig_end:   _studio.events[hit.idx].end_ms,
    };
    canvas.classList.add('is-resizing-left');
    _studioRecordSnapshot();
    _studioRender();
    return;
  }
  if (hit.kind === 'event-right') {
    _studio.selected_idx = hit.idx;
    _studio.drag_state = {
      mode: 'resize-right', idx: hit.idx,
      orig_start: _studio.events[hit.idx].start_ms,
      orig_end:   _studio.events[hit.idx].end_ms,
    };
    canvas.classList.add('is-resizing-right');
    _studioRecordSnapshot();
    _studioRender();
    return;
  }
  if (hit.kind === 'lane') {
    // Click empty space → create new event with default 2-second duration on this lane
    const lane = STUDIO_LANES[hit.lane_idx];
    const start_ms = _studioSnap(Math.max(0, ms - 1000));
    const end_ms   = Math.min(_studio.duration_ms || start_ms + 2000, start_ms + 2000);
    if (end_ms - start_ms < 100) return;  // too small, don't create
    _studioRecordSnapshot();
    const new_event = {
      lane: lane.key,
      start_ms,
      end_ms,
      params: {},  // empty params — backend uses defaults
    };
    _studio.events.push(new_event);
    _studio.selected_idx = _studio.events.length - 1;
    _studio.duration_ms = Math.max(_studio.duration_ms, end_ms);
    _studioRender();
    return;
  }
  // Click background → deselect
  _studio.selected_idx = -1;
  _studioRender();
}

function _studioMouseMove(e) {
  const canvas = document.getElementById('studio-canvas');
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const ppms = _studioPxPerMs();
  const ms = mx / ppms;

  if (_studio.drag_state) {
    const ds = _studio.drag_state;
    if (ds.mode === 'scrub') {
      _studio.scrub_ms = Math.max(0, Math.min(_studio.duration_ms, ms));
      _studioRender();
      return;
    }
    const ev = _studio.events[ds.idx];
    if (!ev) return;
    if (ds.mode === 'move') {
      const dur = ds.orig_end - ds.orig_start;
      let new_start = _studioSnap(Math.max(0, ms - ds.grab_offset_ms));
      let new_end   = new_start + dur;
      if (new_end > _studio.duration_ms) {
        new_end = _studio.duration_ms;
        new_start = new_end - dur;
      }
      ev.start_ms = new_start;
      ev.end_ms   = new_end;
      ds.moved = true;
    } else if (ds.mode === 'resize-left') {
      const new_start = _studioSnap(Math.max(0, Math.min(ev.end_ms - 100, ms)));
      ev.start_ms = new_start;
    } else if (ds.mode === 'resize-right') {
      const new_end = _studioSnap(Math.max(ev.start_ms + 100, Math.min(_studio.duration_ms, ms)));
      ev.end_ms = new_end;
    }
    _studioRender();
    return;
  }

  // Hover detection
  const hit = _studioHitTest(mx, my);
  let new_hover = -1;
  let cursor = 'crosshair';
  if (hit.kind === 'event-body') { new_hover = hit.idx; cursor = 'grab'; }
  else if (hit.kind === 'event-left' || hit.kind === 'event-right') { new_hover = hit.idx; cursor = 'ew-resize'; }
  else if (hit.kind === 'scrub')  { cursor = 'col-resize'; }
  else if (hit.kind === 'ruler')  { cursor = 'col-resize'; }
  else if (hit.kind === 'lane')   { cursor = 'crosshair'; }
  canvas.style.cursor = cursor;
  if (new_hover !== _studio.hover_idx) {
    _studio.hover_idx = new_hover;
    _studioRender();
  }
}

function _studioMouseUp(e) {
  const canvas = document.getElementById('studio-canvas');
  if (!canvas) return;
  canvas.classList.remove('is-dragging', 'is-resizing-left', 'is-resizing-right', 'is-scrubbing');
  if (_studio.drag_state) {
    // If a move-drag happened but the position is identical to original, pop the snapshot
    if (_studio.drag_state.mode === 'move' && !_studio.drag_state.moved) {
      _studio.history.pop();
      _studioUpdateUndoButtons();
    }
  }
  _studio.drag_state = null;
}

function _studioSave(saveAs) {
  if (!_studio.open || !_studio.src_path) return;
  const events_json = JSON.stringify(_studio.events);
  if (saveAs) {
    bridge.cloneRecordingForEdit(_studio.src_path).then((raw) => {
      let res = {};
      try { res = JSON.parse(raw || '{}'); } catch {}
      if (!res.ok) { toast('Save as failed: ' + (res.error || ''), 'error'); return; }
      _studioWriteSave(res.new_path, events_json);
    });
  } else {
    _studioWriteSave(_studio.src_path, events_json);
  }
}

function _studioWriteSave(dest_path, events_json) {
  bridge.saveStudioTimeline(_studio.src_path, dest_path, events_json, _studio.duration_ms).then((raw) => {
    let res = {};
    try { res = JSON.parse(raw || '{}'); } catch {}
    if (res.ok) {
      toast(`Saved ${res.count} event${res.count === 1 ? '' : 's'}`, 'success');
      // If saved as new, switch to editing the new file
      if (dest_path !== _studio.src_path) {
        _studio.src_path = dest_path;
        const sub = document.getElementById('studio-subtitle');
        if (sub) {
          const fname = dest_path.split(/[/\\]/).pop() || '';
          sub.textContent = `editing ${fname}`;
        }
      }
    } else {
      toast('Save failed: ' + (res.error || 'unknown'), 'error');
    }
  });
}

// Wire studio init at DOM ready (idempotent)
(function initStudio() {
  function tryInit() {
    if (typeof bridge !== 'undefined' && bridge && bridge.getStudioTimeline) {
      setupStudio();
      return;
    }
    if ((initStudio._tries || 0) < 50) {
      initStudio._tries = (initStudio._tries || 0) + 1;
      setTimeout(tryInit, 200);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();

// Expose _studioOpen so the recordings list can hook it up
window._studioOpen = _studioOpen;


// ============================================================
// Phase 5 (v3.0.0) — Network tab (LAN coordination)
// ============================================================

let _lanState = null;
let _lanRefreshTimer = null;
let _lanPairExpiresTs = 0;

function _lanFmtSecondsAgo(s) {
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

function _lanRenderPeers() {
  if (!_lanState) return;
  const list = document.getElementById('lan-peer-list');
  if (!list) return;
  const peers = _lanState.peers || [];
  if (peers.length === 0) {
    list.innerHTML = `<div class="auto-empty">
      <span class="auto-empty-icon">🌐</span>
      <p>No peers discovered yet.</p>
      <p class="hint-text">Make sure LAN sync is on, both PCs are on the same network, and Windows Firewall isn't blocking Throttlr's UDP/TCP ports.</p>
    </div>`;
    return;
  }
  list.innerHTML = '';
  peers.forEach(peer => {
    const card = document.createElement('div');
    card.className = 'lan-peer-card';
    card.dataset.paired = peer.paired ? '1' : '0';
    card.dataset.running = peer.status === 'running' ? '1' : '0';

    card.appendChild(Object.assign(document.createElement('span'), { className: 'peer-status-dot' }));

    const info = document.createElement('div');
    info.className = 'peer-info';
    const nameRow = document.createElement('div');
    nameRow.className = 'peer-name';
    nameRow.textContent = peer.name || '?';
    if (peer.paired) {
      const badge = document.createElement('span');
      badge.className = 'peer-paired-badge';
      badge.textContent = 'PAIRED';
      nameRow.appendChild(badge);
    }
    info.appendChild(nameRow);
    const metaRow = document.createElement('div');
    metaRow.className = 'peer-meta';
    const statusTxt = peer.status === 'running'
      ? `running · ${peer.target || '(no target)'}` + (peer.kbps_in || peer.kbps_out ? ` · ↓${peer.kbps_in} ↑${peer.kbps_out} KB/s` : '')
      : 'idle';
    metaRow.textContent = `${peer.ip}:${peer.port} · v${peer.version} · ${statusTxt} · seen ${_lanFmtSecondsAgo(peer.last_seen_ago_s)}`;
    info.appendChild(metaRow);
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'peer-actions';
    if (peer.paired) {
      const btnStart = document.createElement('button');
      btnStart.className = 'peer-btn'; btnStart.textContent = 'Start';
      btnStart.title = 'Tell this peer to start capturing';
      btnStart.addEventListener('click', () => _lanSendCmd(peer, 'start_capture'));
      const btnStop = document.createElement('button');
      btnStop.className = 'peer-btn'; btnStop.textContent = 'Stop';
      btnStop.addEventListener('click', () => _lanSendCmd(peer, 'stop_capture'));
      const btnPing = document.createElement('button');
      btnPing.className = 'peer-btn'; btnPing.textContent = 'Ping';
      btnPing.addEventListener('click', () => _lanSendCmd(peer, 'ping'));
      const btnUnpair = document.createElement('button');
      btnUnpair.className = 'peer-btn danger'; btnUnpair.textContent = 'Unpair';
      btnUnpair.addEventListener('click', () => {
        if (confirm(`Unpair from ${peer.name}? You'll need to re-pair to control it again.`)) {
          bridge.lanUnpair(peer.peer_id).then(() => _lanRefresh());
        }
      });
      actions.appendChild(btnStart);
      actions.appendChild(btnStop);
      actions.appendChild(btnPing);
      actions.appendChild(btnUnpair);
    } else {
      const btnPair = document.createElement('button');
      btnPair.className = 'peer-btn'; btnPair.textContent = 'Pair';
      btnPair.addEventListener('click', () => _lanInitiatePair(peer));
      actions.appendChild(btnPair);
    }
    card.appendChild(actions);
    list.appendChild(card);
  });
}

function _lanRenderPending() {
  const wrap = document.getElementById('lan-pending-list');
  if (!wrap) return;
  const pending = (_lanState && _lanState.pending) || [];
  if (pending.length === 0) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = '<div class="field-label">Pending pairing requests</div>';
  pending.forEach(req => {
    const card = document.createElement('div');
    card.className = 'lan-pending-card';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'pp-name'; name.textContent = req.name || '?';
    const meta = document.createElement('div');
    meta.className = 'pp-meta'; meta.textContent = `${req.ip} · expires in ${req.remaining_s}s`;
    info.appendChild(name); info.appendChild(meta);
    const actions = document.createElement('div');
    actions.className = 'pp-actions';
    const accept = document.createElement('button');
    accept.className = 'peer-btn'; accept.textContent = 'Accept';
    accept.addEventListener('click', () => {
      bridge.lanAcceptPairing(req.peer_id).then(() => {
        toast(`Paired with ${req.name}`, 'success');
        _lanRefresh();
      });
    });
    const reject = document.createElement('button');
    reject.className = 'peer-btn danger'; reject.textContent = 'Reject';
    reject.addEventListener('click', () => {
      bridge.lanRejectPairing(req.peer_id).then(() => _lanRefresh());
    });
    actions.appendChild(accept); actions.appendChild(reject);
    card.appendChild(info); card.appendChild(actions);
    wrap.appendChild(card);
  });
}

function _lanRefresh() {
  if (!bridge || !bridge.lanGetState) return;
  bridge.lanGetState().then((raw) => {
    let s = {};
    try { s = JSON.parse(raw || '{}'); } catch {}
    _lanState = s;
    const tog = document.getElementById('lan-enabled-toggle');
    if (tog) tog.checked = !!s.enabled;
    const nameInput = document.getElementById('lan-display-name');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = s.my_name || '';
    _lanRenderPeers();
    _lanRenderPending();
  });
}

function _lanInitiatePair(peer) {
  const code = prompt(`Enter the 6-digit pairing code shown on ${peer.name}:\n\n(Have someone open Throttlr on ${peer.name}, go to Settings → Network, and click "Open pairing window".)`);
  if (!code) return;
  bridge.lanRequestPair(peer.peer_id, code.trim()).then((raw) => {
    let res = {};
    try { res = JSON.parse(raw || '{}'); } catch {}
    if (res.ok) {
      toast(`Pairing request sent to ${peer.name}. Waiting for them to approve.`, 'success');
    } else {
      toast(`Pair failed: ${res.error || 'unknown'}`, 'error');
    }
    _lanRefresh();
  });
}

function _lanSendCmd(peer, method, params) {
  bridge.lanSendCommand(peer.peer_id, method, JSON.stringify(params || {})).then((raw) => {
    let res = {};
    try { res = JSON.parse(raw || '{}'); } catch {}
    if (res.ok && res.result && res.result.ok !== false) {
      toast(`${peer.name} · ${method} · ✓`, 'success');
    } else {
      toast(`${peer.name} · ${method} · failed: ${(res.result && res.result.error) || res.error || ''}`, 'error');
    }
  });
}

function _lanOpenPairWindow() {
  bridge.lanOpenPairingWindow().then((raw) => {
    let res = {};
    try { res = JSON.parse(raw || '{}'); } catch {}
    if (!res.ok) { toast('Could not open pairing window', 'error'); return; }
    const box = document.getElementById('lan-pair-code-box');
    document.getElementById('lan-pair-code').textContent = res.code;
    _lanPairExpiresTs = Date.now() + (res.expires_s * 1000);
    if (box) box.hidden = false;
    _lanUpdatePairCountdown();
  });
}

function _lanUpdatePairCountdown() {
  const meta = document.getElementById('lan-pair-code-expires');
  const box = document.getElementById('lan-pair-code-box');
  if (!meta || !box || box.hidden) return;
  const remaining = Math.max(0, Math.floor((_lanPairExpiresTs - Date.now()) / 1000));
  meta.textContent = remaining > 0 ? `Valid for ${remaining}s` : 'Expired';
  if (remaining > 0) setTimeout(_lanUpdatePairCountdown, 1000);
  else box.hidden = true;
}

function _lanClosePairWindow() {
  bridge.lanClosePairingWindow();
  document.getElementById('lan-pair-code-box').hidden = true;
}

function setupNetworkTab() {
  document.getElementById('lan-enabled-toggle')?.addEventListener('change', (e) => {
    bridge.lanSetEnabled(e.target.checked).then(() => {
      toast(e.target.checked ? 'LAN sync enabled' : 'LAN sync paused', 'info');
      _lanRefresh();
    });
  });
  document.getElementById('lan-display-name')?.addEventListener('change', (e) => {
    bridge.lanSetDisplayName(e.target.value).then(() => _lanRefresh());
  });
  document.getElementById('lan-refresh-btn')?.addEventListener('click', _lanRefresh);
  document.getElementById('lan-pair-open-btn')?.addEventListener('click', _lanOpenPairWindow);
  document.getElementById('lan-pair-cancel-btn')?.addEventListener('click', _lanClosePairWindow);

  // Subscribe to peer-list changes
  if (bridge.lanPeerListChanged && bridge.lanPeerListChanged.connect) {
    bridge.lanPeerListChanged.connect((raw) => {
      try { _lanState = JSON.parse(raw || '{}'); } catch {}
      _lanRenderPeers();
      _lanRenderPending();
    });
  }
  // Subscribe to remote command notifications
  if (bridge.lanCommandReceived && bridge.lanCommandReceived.connect) {
    bridge.lanCommandReceived.connect((raw) => {
      let evt = {};
      try { evt = JSON.parse(raw || '{}'); } catch {}
      const sym = evt.ok ? '✓' : '✗';
      toast(`${evt.from_name || 'remote'} sent: ${evt.method} ${sym}`, evt.ok ? 'info' : 'error');
    });
  }

  _lanRefresh();
  // Auto-refresh peer list while tab is visible
  if (_lanRefreshTimer) clearInterval(_lanRefreshTimer);
  _lanRefreshTimer = setInterval(() => {
    if (!document.getElementById('studio-modal') || document.getElementById('studio-modal').hidden) {
      _lanRefresh();
    }
  }, 5000);
}

// ============================================================
// Phase 5 (v3.0.0) — Plugins tab
// ============================================================

function _pluginRender(plugins) {
  const list = document.getElementById('plugin-list');
  if (!list) return;
  if (!plugins || plugins.length === 0) {
    list.innerHTML = `<div class="auto-empty">
      <span class="auto-empty-icon">🧩</span>
      <p>No plugins installed.</p>
      <p class="hint-text">Click <strong>Open plugins folder</strong> and drop a <code>.py</code> file or a folder with a <code>plugin.py</code> inside.</p>
    </div>`;
    return;
  }
  list.innerHTML = '';
  plugins.forEach(p => {
    const card = document.createElement('div');
    card.className = 'plugin-card';
    card.dataset.error = p.error ? '1' : '0';
    card.dataset.loaded = p.loaded ? '1' : '0';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'plugin-toggle';
    toggle.checked = !!p.enabled;
    toggle.disabled = !!p.error;
    toggle.title = p.error ? 'Plugin has an error' : (p.enabled ? 'Disable plugin' : 'Enable plugin');
    toggle.addEventListener('change', () => _pluginToggle(p, toggle));
    card.appendChild(toggle);

    const info = document.createElement('div');
    info.className = 'plugin-info';
    const name = document.createElement('div');
    name.className = 'plugin-name';
    name.innerHTML = `${escapeHtml(p.display_name || p.name)} <span class="plugin-version">v${escapeHtml(p.version)}</span>`;
    info.appendChild(name);
    if (p.description) {
      const desc = document.createElement('div');
      desc.className = 'plugin-desc';
      desc.textContent = p.description;
      info.appendChild(desc);
    }
    if (p.error) {
      const err = document.createElement('div');
      err.className = 'plugin-error';
      err.textContent = `⚠ ${p.error}`;
      info.appendChild(err);
    }
    card.appendChild(info);

    const status = document.createElement('div');
    status.className = 'plugin-status';
    status.textContent = p.loaded ? 'Loaded' : (p.enabled ? 'Pending' : 'Off');
    card.appendChild(status);

    list.appendChild(card);
  });
}

function _pluginToggle(plugin, toggleEl) {
  if (toggleEl.checked) {
    bridge.pluginsEnable(plugin.name).then((raw) => {
      let res = {};
      try { res = JSON.parse(raw || '{}'); } catch {}
      if (res.ok) {
        toast(`Plugin "${plugin.display_name || plugin.name}" enabled`, 'success');
      } else {
        toggleEl.checked = false;
        toast(`Failed to enable: ${res.error || ''}`, 'error');
      }
      _pluginRefresh();
    });
  } else {
    bridge.pluginsDisable(plugin.name).then(() => {
      toast(`Plugin "${plugin.display_name || plugin.name}" disabled`, 'info');
      _pluginRefresh();
    });
  }
}

function _pluginRefresh() {
  if (!bridge || !bridge.pluginsList) return;
  bridge.pluginsList().then((raw) => {
    let plugins = [];
    try { plugins = JSON.parse(raw || '[]'); } catch {}
    _pluginRender(plugins);
  });
  if (bridge.pluginsGetFolder) {
    bridge.pluginsGetFolder().then((path) => {
      const el = document.getElementById('plugin-folder-path');
      if (el) el.textContent = path || '—';
    });
  }
}

function setupPluginsTab() {
  document.getElementById('plugin-refresh-btn')?.addEventListener('click', _pluginRefresh);
  document.getElementById('plugin-open-folder-btn')?.addEventListener('click', () => {
    bridge.pluginsOpenFolder().then((ok) => {
      if (!ok) toast('Could not open plugins folder', 'error');
    });
  });
  _pluginRefresh();
}

// Init both tabs once bridge is ready
(function initPhase5() {
  let tries = 0;
  function tryInit() {
    if (typeof bridge !== 'undefined' && bridge && bridge.lanGetState && bridge.pluginsList) {
      setupNetworkTab();
      setupPluginsTab();
      return;
    }
    if (++tries < 50) setTimeout(tryInit, 200);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
})();
