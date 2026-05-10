// ShieldGuard — Background Service Worker (Chromium + Gecko compatible)
// Uses sgAPI from browser/compat.js for unified promise-based calls
'use strict';

// Firefox MV3 service worker lacks importScripts in all contexts,
// but the manifest injects compat.js first via "scripts" fallback,
// so sgAPI is already available. For Chromium service worker we import it.
try {
  if (typeof sgAPI === 'undefined') importScripts('../browser/compat.js');
} catch (e) { /* already loaded via manifest scripts[] */ }

// ── Resolve API ───────────────────────────────────────────────
const _api     = (typeof sgAPI !== 'undefined') ? sgAPI   : {};
const _storage = _api.storage?.local ?? chrome.storage.local;
const _tabs    = _api.tabs            ?? chrome.tabs;
const _action  = _api.action          ?? (chrome.action || chrome.browserAction);
const _rt      = _api.runtime         ?? chrome.runtime;
const _dnr     = _api.declarativeNetRequest ?? chrome.declarativeNetRequest;
const _wn      = _api.webNavigation   ?? chrome.webNavigation;
const _cm      = _api.contextMenus    ?? (chrome.contextMenus || chrome.menus);

// ── Storage helper ────────────────────────────────────────────
const DB = {
  GLOBAL_STATS:    'sg_global_stats',
  SITE_STATS:      'sg_site_stats',
  WHITELIST:       'sg_whitelist',
  SETTINGS:        'sg_settings',
  CUSTOM_RULES:    'sg_custom_rules',
  SESSION_BLOCKED: 'sg_session_blocked',
};

const DEFAULT_SETTINGS = {
  enabled:               true,
  blockAds:              true,
  blockTrackers:         true,
  blockOverlays:         true,
  fingerprintProtection: true,
  antiAdblockBypass:     true,
  scrollRestoration:     true,
  cosmeticFilters:       true,
  removeUtmParams:       true,
  blockWebSockets:       false,
};

async function storageGet(key, fallback = null) {
  try {
    const result = await _storage.get(key);
    return (result && result[key] !== undefined) ? result[key] : fallback;
  } catch { return fallback; }
}

async function storageSet(key, value) {
  try { await _storage.set({ [key]: value }); } catch (e) { console.warn('[SG]', e); }
}

async function storageRemove(keys) {
  try { await _storage.remove(Array.isArray(keys) ? keys : [keys]); } catch { }
}

// ── Stats ─────────────────────────────────────────────────────
async function incrementStat(tabId, hostname, category) {
  const safeCategory = ['ads','trackers','scripts','overlays','fingerprints'].includes(category) ? category : 'scripts';

  // Global
  const g = await storageGet(DB.GLOBAL_STATS, { totalBlocked:0, ads:0, trackers:0, scripts:0, overlays:0, fingerprints:0 });
  g.totalBlocked = (g.totalBlocked || 0) + 1;
  g[safeCategory] = (g[safeCategory] || 0) + 1;
  await storageSet(DB.GLOBAL_STATS, g);

  // Per-site
  if (hostname) {
    const sites = await storageGet(DB.SITE_STATS, {});
    if (!sites[hostname]) sites[hostname] = { totalBlocked:0, ads:0, trackers:0, scripts:0, overlays:0, fingerprints:0, lastSeen:0 };
    sites[hostname].totalBlocked++;
    sites[hostname][safeCategory] = (sites[hostname][safeCategory] || 0) + 1;
    sites[hostname].lastSeen = Date.now();
    await storageSet(DB.SITE_STATS, sites);
  }

  // Session (per tab)
  const session = await storageGet(DB.SESSION_BLOCKED, {});
  const key = tabId ? `tab_${tabId}` : 'total';
  if (!session[key]) session[key] = { total:0, ads:0, trackers:0, scripts:0 };
  session[key].total++;
  session[key][safeCategory] = (session[key][safeCategory] || 0) + 1;
  await storageSet(DB.SESSION_BLOCKED, session);

  if (tabId) updateBadge(tabId);
}

async function updateBadge(tabId) {
  try {
    const session  = await storageGet(DB.SESSION_BLOCKED, {});
    const tabStats = session[`tab_${tabId}`];
    const count    = tabStats ? tabStats.total : 0;
    const label    = count > 999 ? '999+' : count > 0 ? String(count) : '';
    const color    = count > 0 ? '#00d4aa' : '#506080';

    _action.setBadgeText({ text: label, tabId }).catch(() => {});
    _action.setBadgeBackgroundColor({ color, tabId }).catch(() => {});
    // Firefox supports setBadgeTextColor
    if (_action.setBadgeTextColor) {
      _action.setBadgeTextColor({ color: '#ffffff', tabId }).catch(() => {});
    }
  } catch { }
}

// ── Whitelist ─────────────────────────────────────────────────
async function isWhitelisted(hostname) {
  if (!hostname) return false;
  const list = await storageGet(DB.WHITELIST, []);
  return list.some(entry => hostname === entry || hostname.endsWith('.' + entry));
}

async function addToWhitelist(hostname) {
  const list = await storageGet(DB.WHITELIST, []);
  if (!list.includes(hostname)) { list.push(hostname); await storageSet(DB.WHITELIST, list); }
}

async function removeFromWhitelist(hostname) {
  const list    = await storageGet(DB.WHITELIST, []);
  const updated = list.filter(h => h !== hostname);
  await storageSet(DB.WHITELIST, updated);
}

// ── Custom Dynamic Rules ──────────────────────────────────────
const DYNAMIC_RULE_ID_START = 10000;

// Security: strict validation for user-submitted URL filter patterns
const VALID_URL_FILTER = /^[a-zA-Z0-9\-._~:/?#\[\]@!$&'()+,;=%|^*]+$/;
const ALLOWED_ACTIONS  = new Set(['block', 'allow']);
const VALID_RESOURCE_TYPES = new Set([
  'main_frame','sub_frame','stylesheet','script','image','font',
  'xmlhttprequest','media','websocket','other',
]);
const MAX_PATTERN_LENGTH = 500;
const MAX_USER_RULES     = 100;

function sanitizePattern(pattern) {
  if (!pattern || typeof pattern !== 'string') return null;
  const trimmed = pattern.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PATTERN_LENGTH) return null;
  if (!VALID_URL_FILTER.test(trimmed)) return null;
  return trimmed;
}

function sanitizeAction(action) {
  if (typeof action === 'string' && ALLOWED_ACTIONS.has(action)) return action;
  return 'block'; // default — never allow arbitrary action types
}

function sanitizeResourceTypes(types) {
  if (!Array.isArray(types) || types.length === 0) {
    return ['script','xmlhttprequest','image','sub_frame'];
  }
  const valid = types.filter(t => typeof t === 'string' && VALID_RESOURCE_TYPES.has(t));
  return valid.length > 0 ? valid : ['script','xmlhttprequest','image','sub_frame'];
}

async function applyCustomRules() {
  if (!_dnr) return;
  try {
    const custom = await storageGet(DB.CUSTOM_RULES, []);
    if (!Array.isArray(custom)) return;

    let existing = [];
    try { existing = await _dnr.getDynamicRules(); } catch { }
    const removeIds = existing.map(r => r.id);

    const addRules = [];
    for (let i = 0; i < Math.min(custom.length, MAX_USER_RULES); i++) {
      const r = custom[i];
      if (!r || r.enabled === false) continue;
      const pattern = sanitizePattern(r.pattern);
      if (!pattern) continue;

      addRules.push({
        id:       DYNAMIC_RULE_ID_START + i,
        priority: 2,  // capped — cannot override built-in rules (priority 1 = static)
        action:   { type: sanitizeAction(r.action) },
        condition: {
          urlFilter:     pattern,
          resourceTypes: sanitizeResourceTypes(r.resourceTypes),
        },
      });
    }

    await _dnr.updateDynamicRules({ removeRuleIds: removeIds, addRules });
    console.log(`[ShieldGuard] Applied ${addRules.length} custom rules.`);
  } catch (e) {
    console.warn('[ShieldGuard] Custom rule error:', e);
  }
}

// ── Toggle Static Rule Sets ───────────────────────────────────
// Chromium supports updateEnabledRulesets; Firefox partial support.
async function updateRulesets(settings) {
  if (!chrome.declarativeNetRequest?.updateEnabledRulesets) return;
  try {
    const enableRulesetIds  = [];
    const disableRulesetIds = [];
    if (settings.blockAds)     enableRulesetIds.push('ad_rules');
    else                       disableRulesetIds.push('ad_rules');
    if (settings.blockTrackers) enableRulesetIds.push('tracker_rules');
    else                        disableRulesetIds.push('tracker_rules');
    enableRulesetIds.push('privacy_rules'); // always on

    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
  } catch { }
}

// ── Message Handler ───────────────────────────────────────────
_rt.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId    = sender?.tab?.id ?? null;
  const frameUrl = sender?.tab?.url ?? '';
  let hostname   = '';
  try { hostname = new URL(frameUrl).hostname; } catch { }

  (async () => {
    let response;
    switch (msg.type) {
      case 'BLOCKED':
        await incrementStat(tabId, msg.hostname || hostname, msg.category || 'scripts');
        response = { ok: true };
        break;

      case 'OVERLAY_REMOVED':
        await incrementStat(tabId, hostname, 'overlays');
        response = { ok: true };
        break;

      case 'GET_SETTINGS':
        response = await storageGet(DB.SETTINGS, DEFAULT_SETTINGS);
        break;

      case 'SET_SETTINGS': {
        const current = await storageGet(DB.SETTINGS, DEFAULT_SETTINGS);
        const updated = { ...current, ...msg.settings };
        await storageSet(DB.SETTINGS, updated);
        await updateRulesets(updated);
        broadcastToAllTabs({ type: 'SETTINGS_UPDATED', settings: updated });
        response = { ok: true };
        break;
      }

      case 'GET_STATS': {
        const [global, session, sites] = await Promise.all([
          storageGet(DB.GLOBAL_STATS, {}),
          storageGet(DB.SESSION_BLOCKED, {}),
          storageGet(DB.SITE_STATS, {}),
        ]);
        const tabStats = tabId ? session[`tab_${tabId}`] : null;
        response = { global, tabStats, sites };
        break;
      }

      case 'GET_WHITELIST':
        response = await storageGet(DB.WHITELIST, []);
        break;

      case 'WHITELIST_ADD':
        await addToWhitelist(msg.hostname);
        response = { ok: true };
        break;

      case 'WHITELIST_REMOVE':
        await removeFromWhitelist(msg.hostname);
        response = { ok: true };
        break;

      case 'IS_WHITELISTED':
        response = await isWhitelisted(msg.hostname);
        break;

      case 'SAVE_CUSTOM_RULES':
        await storageSet(DB.CUSTOM_RULES, msg.rules);
        await applyCustomRules();
        response = { ok: true };
        break;

      case 'GET_CUSTOM_RULES':
        response = await storageGet(DB.CUSTOM_RULES, []);
        break;

      case 'CLEAR_SESSION_STATS':
        await storageSet(DB.SESSION_BLOCKED, {});
        response = { ok: true };
        break;

      case 'CLEAR_ALL_STATS':
        await storageRemove([DB.GLOBAL_STATS, DB.SITE_STATS, DB.SESSION_BLOCKED]);
        response = { ok: true };
        break;

      default:
        response = { ok: false, error: 'Unknown message type' };
    }
    try { sendResponse(response); } catch { }
  })();

  return true; // keep channel open for async sendResponse
});

// ── Broadcast ────────────────────────────────────────────────
async function broadcastToAllTabs(msg) {
  try {
    const tabs = await _tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      try { await _tabs.sendMessage(tab.id, msg); } catch { }
    }
  } catch { }
}

// ── Tab Navigation ────────────────────────────────────────────
if (_wn?.onCommitted) {
  _wn.onCommitted.addListener(async details => {
    if (details.frameId !== 0) return;
    try {
      const session = await storageGet(DB.SESSION_BLOCKED, {});
      delete session[`tab_${details.tabId}`];
      await storageSet(DB.SESSION_BLOCKED, session);
      _action.setBadgeText({ text: '', tabId: details.tabId }).catch(() => {});
    } catch { }
  });
}

// ── Context Menu ──────────────────────────────────────────────
function buildContextMenus() {
  if (!_cm) return;
  try {
    _cm.create({ id: 'sg_whitelist', title: 'ShieldGuard: Whitelist this site',  contexts: ['page'] });
    _cm.create({ id: 'sg_report',   title: 'ShieldGuard: Report broken page',    contexts: ['page'] });
  } catch { }

  if (_cm.onClicked) {
    _cm.onClicked.addListener(async (info, tab) => {
      if (!tab?.url) return;
      let hostname = '';
      try { hostname = new URL(tab.url).hostname; } catch { }

      if (info.menuItemId === 'sg_whitelist' && hostname) {
        await addToWhitelist(hostname);
        _tabs.reload(tab.id);
      }
    });
  }
}

// ── Install / Startup ─────────────────────────────────────────
_rt.onInstalled.addListener(async () => {
  const existing = await storageGet(DB.SETTINGS, null);
  if (!existing) await storageSet(DB.SETTINGS, DEFAULT_SETTINGS);
  await applyCustomRules();
  buildContextMenus();
  console.log('[ShieldGuard] Installed & ready. Engine:', typeof IS_GECKO !== 'undefined' && IS_GECKO ? 'Gecko/Firefox' : 'Chromium');
});

_rt.onStartup.addListener(async () => {
  await applyCustomRules();
  console.log('[ShieldGuard] Service worker restarted.');
});
