/**
 * ShieldGuard — Browser Compatibility Shim
 * Normalises chrome.* (Chromium) and browser.* (Gecko/Firefox) into one
 * promise-based API surface exposed as `sgAPI`.
 *
 * Strategy:
 *  - Firefox exposes BOTH `browser` (promise-based) and `chrome` (callback).
 *  - Chrome 105+ exposes `browser` but it is incomplete; `chrome` is canonical.
 *  - We detect the environment and wrap once so every caller uses promises.
 */

(function (globalScope) {
  'use strict';

  // ── Detect engine ────────────────────────────────────────────
  const IS_GECKO = (
    typeof globalScope.browser !== 'undefined' &&
    typeof globalScope.browser.runtime !== 'undefined' &&
    globalScope.browser.runtime.getManifest !== undefined &&
    // Firefox's browser.runtime.id is always defined; Chrome's may not be
    navigator.userAgent.includes('Firefox')
  );

  // Raw native API object
  const _native = IS_GECKO ? globalScope.browser : globalScope.chrome;

  // ── Promise wrapper for callback-based APIs (Chrome) ─────────
  function promisify(fn, context) {
    return function (...args) {
      return new Promise((resolve, reject) => {
        fn.apply(context, [
          ...args,
          function (result) {
            const err = (context || globalScope.chrome).runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(result);
          },
        ]);
      });
    };
  }

  // ── Build unified API ─────────────────────────────────────────
  const sgAPI = {};

  // runtime
  sgAPI.runtime = {
    sendMessage: IS_GECKO
      ? _native.runtime.sendMessage.bind(_native.runtime)
      : promisify(_native.runtime.sendMessage.bind(_native.runtime), _native.runtime),
    openOptionsPage: () => _native.runtime.openOptionsPage(),
    getManifest:     () => _native.runtime.getManifest(),
    onMessage:       _native.runtime.onMessage,
    onInstalled:     _native.runtime.onInstalled,
    onStartup:       _native.runtime.onStartup,
    lastError:       null, // accessed via getter below
  };
  Object.defineProperty(sgAPI.runtime, 'lastError', {
    get: () => _native.runtime.lastError,
  });

  // storage.local
  sgAPI.storage = {
    local: {
      get: IS_GECKO
        ? _native.storage.local.get.bind(_native.storage.local)
        : promisify(_native.storage.local.get.bind(_native.storage.local), _native.storage.local),
      set: IS_GECKO
        ? _native.storage.local.set.bind(_native.storage.local)
        : promisify(_native.storage.local.set.bind(_native.storage.local), _native.storage.local),
      remove: IS_GECKO
        ? _native.storage.local.remove.bind(_native.storage.local)
        : promisify(_native.storage.local.remove.bind(_native.storage.local), _native.storage.local),
    },
  };

  // tabs
  sgAPI.tabs = {
    query: IS_GECKO
      ? _native.tabs.query.bind(_native.tabs)
      : promisify(_native.tabs.query.bind(_native.tabs), _native.tabs),
    reload: (id, props) => _native.tabs.reload(id, props),
    sendMessage: IS_GECKO
      ? _native.tabs.sendMessage.bind(_native.tabs)
      : promisify(_native.tabs.sendMessage.bind(_native.tabs), _native.tabs),
  };

  // action / browserAction (Firefox MV2 uses browserAction; MV3 unified to action)
  const _action = _native.action || _native.browserAction;
  sgAPI.action = {
    setBadgeText:            (d) => _action.setBadgeText(d),
    setBadgeBackgroundColor: (d) => _action.setBadgeBackgroundColor(d),
    setBadgeTextColor:       (d) => _action.setBadgeTextColor ? _action.setBadgeTextColor(d) : Promise.resolve(),
  };

  // declarativeNetRequest (Chromium MV3 + Firefox 113+)
  if (_native.declarativeNetRequest) {
    sgAPI.declarativeNetRequest = {
      updateDynamicRules: IS_GECKO
        ? _native.declarativeNetRequest.updateDynamicRules.bind(_native.declarativeNetRequest)
        : promisify(_native.declarativeNetRequest.updateDynamicRules.bind(_native.declarativeNetRequest), _native.declarativeNetRequest),
      getDynamicRules: IS_GECKO
        ? _native.declarativeNetRequest.getDynamicRules.bind(_native.declarativeNetRequest)
        : promisify(_native.declarativeNetRequest.getDynamicRules.bind(_native.declarativeNetRequest), _native.declarativeNetRequest),
    };
  } else {
    // Graceful no-op fallback if DNR not available
    sgAPI.declarativeNetRequest = {
      updateDynamicRules: () => Promise.resolve(),
      getDynamicRules:    () => Promise.resolve([]),
    };
  }

  // webNavigation
  if (_native.webNavigation) {
    sgAPI.webNavigation = { onCommitted: _native.webNavigation.onCommitted };
  }

  // contextMenus (Firefox: menus)
  const _menus = _native.contextMenus || _native.menus;
  if (_menus) {
    sgAPI.contextMenus = {
      create:      (props) => _menus.create(props),
      onClicked:   _menus.onClicked,
    };
  }

  // alarms
  if (_native.alarms) {
    sgAPI.alarms = _native.alarms;
  }

  // scripting (Chrome MV3 / Firefox 102+)
  if (_native.scripting) {
    sgAPI.scripting = _native.scripting;
  }

  // ── Expose globally ───────────────────────────────────────────
  globalScope.sgAPI = sgAPI;
  globalScope.IS_GECKO = IS_GECKO;

}(typeof globalThis !== 'undefined' ? globalThis : self));
