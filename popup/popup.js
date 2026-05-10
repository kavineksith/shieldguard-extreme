// ShieldGuard — Popup Script (Chromium + Gecko compatible)
'use strict';

// ── API resolution ─────────────────────────────────────────
// sgAPI is injected by compat.js (listed first in manifest content_scripts).
// For the popup context (not a content script), compat.js is loaded via
// popup.html script tag order doesn't apply — use raw chrome/browser API.
const _ext = (typeof sgAPI !== 'undefined') ? sgAPI :
             (typeof browser !== 'undefined') ? browser : chrome;

function msgBg(msg) {
  return new Promise((resolve, reject) => {
    try {
      const res = _ext.runtime.sendMessage(msg);
      if (res && typeof res.then === 'function') {
        res.then(resolve).catch(() => resolve(null));
      } else {
        // callback style (Chrome without promise polyfill in popup)
        chrome.runtime.sendMessage(msg, r => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r);
        });
      }
    } catch { resolve(null); }
  });
}

// ── DOM helpers ────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── State ──────────────────────────────────────────────────
let currentTabId   = null;
let currentHost    = '';
let currentScope   = 'session';
let currentSettings= {};
let statsData      = {};
let statsTimer     = null;

// ── Initialise ─────────────────────────────────────────────
async function init() {
  try {
    // Get active tab
    const tabs = await new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, t => resolve(t));
    });
    const tab = tabs?.[0];
    if (!tab) return;

    currentTabId = tab.id;
    try { currentHost = new URL(tab.url).hostname; } catch { }

    $('siteDomain').textContent = currentHost || 'System page';
    $('siteDomain').title       = currentHost;

    // Load in parallel
    const [isWL, settings] = await Promise.all([
      msgBg({ type: 'IS_WHITELISTED', hostname: currentHost }),
      msgBg({ type: 'GET_SETTINGS' }),
    ]);

    currentSettings = settings || {};
    applySettingsToUI(currentSettings);
    updateSiteStatus(!!isWL);

    await refreshStats();
    wireEvents();

    // Poll stats every 2s while popup is open
    statsTimer = setInterval(refreshStats, 2000);
  } catch (e) {
    console.error('[ShieldGuard popup]', e);
  }
}

// ── Stats ──────────────────────────────────────────────────
async function refreshStats() {
  const data = await msgBg({ type: 'GET_STATS' });
  if (data) { statsData = data; renderStats(); }
}

function renderStats() {
  const { global = {}, tabStats = {} } = statsData;
  const src = currentScope === 'lifetime' ? global : (tabStats || {});
  animateCount('statTotal',    src.totalBlocked || 0);
  animateCount('statAds',      src.ads || 0);
  animateCount('statTrackers', (src.trackers || 0) + (src.scripts || 0));
}

const _prevNums = {};
function animateCount(id, target) {
  const el = $(id);
  if (!el) return;
  const prev = _prevNums[id] ?? 0;
  _prevNums[id] = target;
  if (prev === target) { el.textContent = target.toLocaleString(); return; }

  const from  = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
  const start = performance.now();
  const dur   = 380;

  function step(now) {
    const t    = Math.min(1, (now - start) / dur);
    const ease = t < .5 ? 2*t*t : -1 + (4 - 2*t)*t;
    el.textContent = Math.round(from + (target - from) * ease).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Site status UI ─────────────────────────────────────────
function updateSiteStatus(isWhitelisted) {
  const statusEl  = $('siteStatus');
  const toggleEl  = $('siteToggle');
  const labelEl   = $('toggleLbl');
  const wlBtn     = $('whitelistBtn');
  const logoEl    = $('logoIcon');

  if (isWhitelisted) {
    statusEl.textContent = '🏳️ Whitelisted — Protection paused';
    statusEl.className   = 'site-status whitelisted';
    toggleEl.checked     = false;
    labelEl.textContent  = 'OFF';
    wlBtn.textContent    = '🛡️ Re-enable Protection';
    document.body.classList.add('sg-disabled');
    logoEl.classList.remove('pulsing');
  } else {
    statusEl.textContent = '🔒 Protected';
    statusEl.className   = 'site-status';
    toggleEl.checked     = true;
    labelEl.textContent  = 'ON';
    wlBtn.textContent    = '🏳️ Whitelist Site';
    document.body.classList.remove('sg-disabled');
    logoEl.classList.add('pulsing');
  }
}

// ── Settings ───────────────────────────────────────────────
function applySettingsToUI(settings) {
  const keys = ['blockAds','blockTrackers','blockOverlays','fingerprintProtection','removeUtmParams'];
  for (const k of keys) {
    const el = document.querySelector(`[data-setting="${k}"]`);
    if (el) el.checked = !!settings[k];
  }
}

async function saveSetting(key, value) {
  currentSettings[key] = value;
  await msgBg({ type: 'SET_SETTINGS', settings: { [key]: value } });
}

// ── Events ─────────────────────────────────────────────────
function wireEvents() {
  // Site on/off toggle
  $('siteToggle').addEventListener('change', async e => {
    const on = e.target.checked;
    $('toggleLbl').textContent = on ? 'ON' : 'OFF';
    if (!on) {
      await msgBg({ type: 'WHITELIST_ADD', hostname: currentHost });
      updateSiteStatus(true);
    } else {
      await msgBg({ type: 'WHITELIST_REMOVE', hostname: currentHost });
      updateSiteStatus(false);
    }
    reloadTab();
  });

  // Whitelist button
  $('whitelistBtn').addEventListener('click', async () => {
    const isWL = await msgBg({ type: 'IS_WHITELISTED', hostname: currentHost });
    if (isWL) {
      await msgBg({ type: 'WHITELIST_REMOVE', hostname: currentHost });
      updateSiteStatus(false);
    } else {
      await msgBg({ type: 'WHITELIST_ADD', hostname: currentHost });
      updateSiteStatus(true);
    }
    reloadTab();
  });

  // Reload
  $('reloadBtn').addEventListener('click', reloadTab);

  // Settings / dashboard links
  $('settingsBtn').addEventListener('click', openOptions);
  $('fullStatsLink').addEventListener('click', e => { e.preventDefault(); openOptions(); });
  $('rulesLink').addEventListener('click',     e => { e.preventDefault(); openOptions(); });

  // Scope tabs
  document.querySelectorAll('.scope-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scope-tab').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      currentScope = btn.dataset.scope;
      renderStats();
    });
  });

  // Feature toggles
  document.querySelectorAll('[data-setting]').forEach(el => {
    el.addEventListener('change', () => saveSetting(el.dataset.setting, el.checked));
  });

  // Cleanup on popup close
  window.addEventListener('unload', () => {
    if (statsTimer) clearInterval(statsTimer);
  });
}

// ── Helpers ────────────────────────────────────────────────
function reloadTab() {
  if (currentTabId !== null) {
    chrome.tabs.reload(currentTabId, {}, () => {});
  }
}

function openOptions() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    // Firefox fallback
    const url = chrome.runtime.getURL('options/options.html');
    chrome.tabs.create({ url });
  }
}

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
