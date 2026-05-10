// ShieldGuard — Content Script  (Chromium + Gecko compatible)
// run_at: document_start  |  all_frames: true
// sgAPI is injected before this file via manifest content_scripts order

(function (ROOT) {
  'use strict';

  // Guard: don't inject twice (can happen in some edge cases)
  if (ROOT.__shieldguard_loaded) return;
  ROOT.__shieldguard_loaded = true;

  // ── Browser API ───────────────────────────────────────────
  // Use sgAPI if available (from compat.js), else fall back to chrome / browser
  const _ext = (typeof sgAPI !== 'undefined') ? sgAPI :
               (typeof browser !== 'undefined') ? browser : chrome;

  // ── Settings (loaded async; defaults used immediately) ────
  let SETTINGS = {
    enabled:               true,
    blockAds:              true,
    blockTrackers:         true,
    blockOverlays:         true,
    fingerprintProtection: true,
    antiAdblockBypass:     true,
    scrollRestoration:     true,
    cosmeticFilters:       true,
    removeUtmParams:       true,
  };

  function loadSettings() {
    try {
      _ext.runtime.sendMessage({ type: 'GET_SETTINGS' })
        .then(s => { if (s && typeof s === 'object') SETTINGS = { ...SETTINGS, ...s }; })
        .catch(() => {});
    } catch { }
  }

  // Live updates from popup / options
  try {
    _ext.runtime.onMessage.addListener(msg => {
      if (msg?.type === 'SETTINGS_UPDATED' && msg.settings) {
        SETTINGS = { ...SETTINGS, ...msg.settings };
      }
    });
  } catch { }

  loadSettings();

  // ── Patterns ──────────────────────────────────────────────
  const OVERLAY_PATTERNS = [
    'modal','overlay','popup','paywall','pay-wall','subscribe','subscription',
    'cookie','consent','gdpr','ccpa','newsletter','signin-wall','login-wall',
    'gate','blocker','adblock','anti-adblock','metered','premium-wall',
    'soft-gate','hard-gate','regwall','reg-wall','survey-wall','age-gate',
  ];
  const AD_PATTERNS = [
    'adsense','doubleclick','dfp-ad','ad-slot','ad-unit','adsbygoogle',
    'googletag','prebid','gpt-ad','advertisement','ad-banner','ad-container',
    'ads-wrapper','ad-wrapper','banner-ad','sponsor-ad','promoted','ad-label',
  ];

  function matchesList(str, list) {
    if (!str) return false;
    const s = str.toLowerCase();
    return list.some(p => s.includes(p));
  }

  // ── 1 · Anti-Adblock Bypass ───────────────────────────────
  function initAntiAdblockBypass() {
    if (!SETTINGS.antiAdblockBypass) return;
    try {
      // Spoof detection globals — set before page scripts run
      const props = {
        canRunAds:       { value: true,  writable: false, configurable: false, enumerable: true },
        canShowAds:      { value: true,  writable: false, configurable: false, enumerable: true },
        adsEnabled:      { value: true,  writable: false, configurable: false, enumerable: true },
        adbThrottled:    { value: false, writable: false, configurable: false, enumerable: true },
        google_jobrunner:{ value: { paused: false }, writable: true,  configurable: true },
        gaData:          { value: {},                writable: true,  configurable: true },
      };
      for (const [k, d] of Object.entries(props)) {
        try { Object.defineProperty(ROOT, k, d); } catch { }
      }
    } catch { }

    // Fake "adsbox" bait div — anti-adblock scripts measure its height.
    // We defer to DOMContentLoaded to safely append to body.
    const appendBait = () => {
      try {
        if (!document.body || document.getElementById('__sg_bait__')) return;
        const bait = document.createElement('div');
        bait.id        = '__sg_bait__';
        bait.className = [
          'adsbox','pub_300x250','pub_300x250m','pub_728x90',
          'text-ad','textAd','text_ad','text_ads','adsbygoogle',
        ].join(' ');
        bait.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';
        // Override geometry so detectors see "ads not blocked"
        Object.defineProperty(bait, 'offsetHeight', { get: () => 1, configurable: true });
        Object.defineProperty(bait, 'offsetWidth',  { get: () => 1, configurable: true });
        bait.getBoundingClientRect = () =>
          ({ top:0, left:0, bottom:1, right:1, width:1, height:1, x:0, y:0 });
        document.body.appendChild(bait);
      } catch { }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', appendBait, { once: true });
    } else { appendBait(); }
  }

  // ── 2 · Fingerprint Protection ────────────────────────────
  function initFingerprintProtection() {
    if (!SETTINGS.fingerprintProtection) return;

    // Session-stable noise seed — same site gets same noise within session
    const seed = parseFloat('0.' + (Math.abs(Math.sin(Date.now()) * 1e9) | 0));

    // --- Canvas ---
    try {
      const origGID  = CanvasRenderingContext2D.prototype.getImageData;
      const origTDU  = HTMLCanvasElement.prototype.toDataURL;
      const origTBlob = HTMLCanvasElement.prototype.toBlob;

      function addNoise(imgData) {
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          // ±1 per channel, imperceptible, based on position + seed
          const n = (Math.sin(i * seed * 9301 + 49297) * 233280 % 1) > 0.5 ? 1 : -1;
          d[i]   = Math.max(0, Math.min(255, d[i]   + n));
          d[i+1] = Math.max(0, Math.min(255, d[i+1] + n));
          d[i+2] = Math.max(0, Math.min(255, d[i+2] + n));
        }
        return imgData;
      }

      CanvasRenderingContext2D.prototype.getImageData = function (...a) {
        return addNoise(origGID.apply(this, a));
      };

      function noisedCanvas(canvas) {
        try {
          const ctx = canvas.getContext('2d');
          if (ctx && canvas.width > 0 && canvas.height > 0) {
            ctx.putImageData(addNoise(origGID.call(ctx, 0, 0, canvas.width, canvas.height)), 0, 0);
          }
        } catch { }
      }

      HTMLCanvasElement.prototype.toDataURL = function (...a) {
        noisedCanvas(this);
        return origTDU.apply(this, a);
      };
      HTMLCanvasElement.prototype.toBlob = function (cb, ...a) {
        noisedCanvas(this);
        return origTBlob.call(this, cb, ...a);
      };
    } catch { }

    // --- WebGL ---
    try {
      const VENDOR   = 'Intel Inc.';
      const RENDERER = 'Intel Iris OpenGL Engine';
      const patchGL  = ctx => {
        if (!ctx) return ctx;
        const orig = ctx.getParameter.bind(ctx);
        ctx.getParameter = p => {
          if (p === 37445) return VENDOR;   // UNMASKED_VENDOR_WEBGL
          if (p === 37446) return RENDERER; // UNMASKED_RENDERER_WEBGL
          return orig(p);
        };
        return ctx;
      };
      const origGetCtx = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...a) {
        const ctx = origGetCtx.call(this, type, ...a);
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') patchGL(ctx);
        return ctx;
      };
    } catch { }

    // --- AudioContext ---
    try {
      const patchAudio = ctx => {
        if (!ctx) return ctx;
        const origOsc = ctx.createOscillator?.bind(ctx);
        const origAn  = ctx.createAnalyser?.bind(ctx);
        if (origAn) {
          ctx.createAnalyser = function () {
            const analyser = origAn();
            const origGBFD = analyser.getByteFrequencyData.bind(analyser);
            analyser.getByteFrequencyData = arr => {
              origGBFD(arr);
              for (let i = 0; i < arr.length; i++) {
                if (Math.random() < 0.005) arr[i] ^= 1; // 0.5% bit flip
              }
            };
            return analyser;
          };
        }
        return ctx;
      };
      if (ROOT.AudioContext) {
        const origAC = ROOT.AudioContext;
        ROOT.AudioContext = function (...a) {
          return patchAudio(new origAC(...a));
        };
        ROOT.AudioContext.prototype = origAC.prototype;
      }
      if (ROOT.webkitAudioContext) {
        const origWAC = ROOT.webkitAudioContext;
        ROOT.webkitAudioContext = function (...a) {
          return patchAudio(new origWAC(...a));
        };
      }
    } catch { }

    // --- Navigator hardware hints ---
    try {
      const shield = { hardwareConcurrency: 4, deviceMemory: 8 };
      for (const [k, v] of Object.entries(shield)) {
        try { Object.defineProperty(navigator, k, { get: () => v, configurable: true }); } catch { }
      }
    } catch { }

    // --- Font enumeration via document.fonts (Gecko-specific API) ---
    try {
      if (document.fonts && Object.getOwnPropertyDescriptor(document.fonts, 'forEach')) {
        // Returning only a fixed safe subset thwarts font fingerprinting
        const safeSubset = ['Arial','sans-serif','monospace','serif'];
        Object.defineProperty(document.fonts, 'forEach', {
          value: function (cb) { safeSubset.forEach(f => cb({ family: f })); },
          configurable: true,
        });
      }
    } catch { }
  }

  // ── 3 · DOM Overlay & Ad Removal ─────────────────────────
  const SAFE_TAGS = new Set(['html','body','head','main','article','section',
    'nav','header','footer','aside','figure','form','table','ul','ol','li','p',
    'h1','h2','h3','h4','h5','h6','span','a','img','video','audio','canvas',
    'input','button','select','textarea','label','script','style','link','meta',
  ]);

  function isFullscreenOverlay(el) {
    try {
      const s   = getComputedStyle(el);
      const pos = s.position;
      if (pos !== 'fixed' && pos !== 'absolute' && pos !== 'sticky') return false;
      const z   = parseInt(s.zIndex, 10) || 0;
      if (z < 50) return false;
      const rect = el.getBoundingClientRect();
      const vw   = ROOT.innerWidth  || document.documentElement.clientWidth  || 800;
      const vh   = ROOT.innerHeight || document.documentElement.clientHeight || 600;
      return rect.width >= vw * 0.75 && rect.height >= vh * 0.75;
    } catch { return false; }
  }

  function shouldRemove(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (SAFE_TAGS.has(tag)) return false;
    const id  = el.id || '';
    const cls = typeof el.className === 'string' ? el.className : '';
    const combo = `${id} ${cls}`;

    if (SETTINGS.blockOverlays && matchesList(combo, OVERLAY_PATTERNS) && isFullscreenOverlay(el)) return true;
    if (SETTINGS.blockAds && matchesList(combo, AD_PATTERNS)) return true;
    if (SETTINGS.blockOverlays && isFullscreenOverlay(el)) return true;
    return false;
  }

  function sweepDOM(root) {
    if (!SETTINGS.blockOverlays && !SETTINGS.blockAds) return;
    const target = root || document.documentElement;
    if (!target) return;
    try {
      const walker  = document.createTreeWalker(target, NodeFilter.SHOW_ELEMENT);
      const pending = [];
      let node;
      while ((node = walker.nextNode())) {
        if (shouldRemove(node)) pending.push(node);
      }
      for (const el of pending) {
        try {
          el.remove();
          notifyBg('OVERLAY_REMOVED');
        } catch { }
      }
    } catch { }
  }

  // ── 4 · Scroll Restoration ────────────────────────────────
  function restoreScroll() {
    if (!SETTINGS.scrollRestoration) return;
    try {
      [document.documentElement, document.body].forEach(el => {
        if (!el) return;
        el.style.setProperty('overflow',     'auto',   'important');
        el.style.setProperty('position',     'static', 'important');
        el.style.setProperty('touch-action', 'auto',   'important');
        el.style.setProperty('height',       'auto',   'important');
        el.style.removeProperty('pointer-events');
      });
    } catch { }
  }

  // ── 5 · Cosmetic CSS ──────────────────────────────────────
  function injectCSS() {
    if (!SETTINGS.cosmeticFilters) return;
    if (document.getElementById('__sg_css__')) return;
    try {
      const isYT = location.hostname.includes('youtube.com');
      const css = `
/* ═══ ShieldGuard Cosmetic Filters ═══ */
[id*="adsense"],[class*="adsense"],
[id*="ad-slot"],[class*="ad-slot"],
[id*="dfp-"],[class*="dfp-"],
[data-ad-unit],[data-ad-slot],[data-ad-format],[data-ad-client],
[id*="google_ads"],[class*="google_ads"],
.adsbygoogle, ins.adsbygoogle,
.ad-container,.ads-container,.advertisement,
.banner-ad,.ad-placeholder,.ad-wrapper,
.ad-label,.sponsor-content,.sponsored,
iframe[src*="doubleclick"],
iframe[src*="googlesyndication"],
iframe[id*="google_ads"] {
  display: none !important;
  visibility: hidden !important;
  max-height: 0 !important;
  overflow: hidden !important;
  pointer-events: none !important;
}
/* Fixed overlays matching paywall/cookie patterns */
body > [class*="paywall"][style*="fixed"],
body > [class*="overlay"][style*="fixed"],
body > [class*="modal"][style*="fixed"],
body > [id*="paywall"][style*="fixed"],
[class*="cookie-banner"],[class*="cookie-consent"],
[class*="gdpr-banner"],[id*="cookie-banner"],[id*="gdpr"],
[class*="consent-banner"],[class*="subscribe-wall"],
[class*="adblock-wall"],[class*="anti-adblock"],
[class*="paywall-overlay"],[class*="gate-overlay"] {
  display: none !important;
  visibility: hidden !important;
}
html, body {
  overflow: auto !important;
  height: auto !important;
}
` + (isYT ? `
/* ═══ YouTube Ad Cosmetic Filters ═══ */
.ytp-ad-overlay-container,
.ytp-ad-text-overlay,
.ytp-ad-overlay-slot,
.ytp-ad-image-overlay,
.ytp-ad-overlay-close-container,
#player-ads,
#masthead-ad,
#panel-ads,
.ytd-promoted-sparkles-web-renderer,
.ytd-display-ad-renderer,
.ytd-ad-slot-renderer,
.ytd-in-feed-ad-layout-renderer,
.ytd-banner-promo-renderer,
.ytd-statement-banner-renderer,
.ytd-promoted-video-renderer,
.ytd-compact-promoted-video-renderer,
.ytd-video-masthead-ad-v3-renderer,
.ytd-primetime-promo-renderer,
.ytd-action-companion-ad-renderer,
.ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
td.video-ads,
.sparkles-light-cta,
.video-ads,
#ad_creative_3,
.ad-showing .ytp-ad-skip-button-container,
#merch-shelf,
ytd-merch-shelf-renderer,
#related ytd-promoted-sparkles-web-renderer,
#search ytd-promoted-sparkles-web-renderer,
.ytd-search-pyv-renderer,
.ytd-movie-offer-module-renderer,
.ytp-ad-progress-list,
.ytp-ad-player-overlay-layout {
  display: none !important;
  visibility: hidden !important;
  max-height: 0 !important;
  overflow: hidden !important;
  pointer-events: none !important;
}
` : '');
      const s    = document.createElement('style');
      s.id       = '__sg_css__';
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    } catch { }
  }

  // ── 6 · UTM / Tracking Param Strip ───────────────────────
  const TRACKING_PARAMS = new Set([
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
    'utm_id','utm_source_platform','utm_creative_format','utm_marketing_tactic',
    'fbclid','gclid','gclsrc','dclid','msclkid','twclid','ttclid',
    'mc_eid','_openstat','yclid','srsltid','igshid','s_cid','zanpid',
    '_ga','_gl','ref','source',
  ]);

  function stripTrackingParams() {
    if (!SETTINGS.removeUtmParams) return;
    try {
      const url = new URL(location.href);
      let changed = false;
      for (const p of TRACKING_PARAMS) {
        if (url.searchParams.has(p)) { url.searchParams.delete(p); changed = true; }
      }
      if (changed) history.replaceState(history.state, '', url.toString());
    } catch { }
  }

  // ── 7 · MutationObserver ──────────────────────────────────
  let sweepQueued = false;
  function queueSweep() {
    if (sweepQueued) return;
    sweepQueued = true;
    requestAnimationFrame(() => {
      sweepDOM();
      restoreScroll();
      sweepQueued = false;
    });
  }

  const domObserver = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        try {
          if (shouldRemove(node)) {
            node.remove();
            notifyBg('OVERLAY_REMOVED');
            continue;
          }
          // Check children of large added subtrees
          if (node.childElementCount > 0) queueSweep();
        } catch { }
      }
    }
    restoreScroll();
  });

  // ── 8 · Notify Background ─────────────────────────────────
  function notifyBg(type, extra = {}) {
    try {
      _ext.runtime.sendMessage({ type, hostname: location.hostname, ...extra }).catch(() => {});
    } catch { }
  }

  // ── 9 · YouTube Ad Interceptor ────────────────────────────
  function initYouTubeAdBlocker() {
    if (!SETTINGS.blockAds) return;
    if (!location.hostname.includes('youtube.com')) return;

    // Auto-click skip buttons and fast-forward video ads
    const ytObserver = new MutationObserver(() => {
      try {
        // --- Skip button auto-click ---
        const skipSelectors = [
          '.ytp-ad-skip-button',
          '.ytp-ad-skip-button-modern',
          '.ytp-skip-ad-button',
          'button.ytp-ad-skip-button-modern',
          '.ytp-ad-skip-button-slot button',
          '[id="skip-button:n"] button',
          '.ytp-ad-overlay-close-button',
        ];
        for (const sel of skipSelectors) {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null) {
            btn.click();
            notifyBg('BLOCKED', { category: 'ads' });
            return;
          }
        }

        // --- Fast-forward unskippable video ads ---
        const player = document.querySelector('.html5-video-player');
        if (player && player.classList.contains('ad-showing')) {
          const video = player.querySelector('video');
          if (video && video.duration && isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration;
            video.playbackRate = 16; // max speed fallback
            notifyBg('BLOCKED', { category: 'ads' });
          }
        }

        // --- Remove overlay ads ---
        const overlayAd = document.querySelector('.ytp-ad-overlay-container');
        if (overlayAd && overlayAd.children.length > 0) {
          overlayAd.innerHTML = '';
          notifyBg('BLOCKED', { category: 'ads' });
        }
      } catch { }
    });

    const startYtObs = () => {
      try {
        const target = document.querySelector('#movie_player') || document.querySelector('.html5-video-player') || document.documentElement;
        ytObserver.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      } catch { }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startYtObs, { once: true });
    } else {
      startYtObs();
    }

    // Periodic check — catches ads that slip through MutationObserver
    setInterval(() => {
      try {
        const player = document.querySelector('.html5-video-player');
        if (player && player.classList.contains('ad-showing')) {
          const video = player.querySelector('video');
          if (video && video.duration && isFinite(video.duration)) {
            video.currentTime = video.duration;
          }
          // Also try clicking any skip buttons
          const skip = player.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern');
          if (skip) skip.click();
        }
      } catch { }
    }, 500);
  }

  // ── 10 · Init ─────────────────────────────────────────────
  function init() {
    if (!SETTINGS.enabled) return;
    injectCSS();
    restoreScroll();
    sweepDOM();
    stripTrackingParams();
    initYouTubeAdBlocker();
    try {
      domObserver.observe(
        document.documentElement || document.body,
        { childList: true, subtree: true, attributes: false }
      );
    } catch { }
  }

  // Boot: anti-adblock & fingerprint protection must run BEFORE page JS
  initAntiAdblockBypass();
  initFingerprintProtection();

  if (document.readyState === 'loading') {
    init(); // early pass — catches whatever is already parsed
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Periodic sweep — catches stubbornly re-injected overlays
  const intervalId = setInterval(() => {
    try { sweepDOM(); restoreScroll(); } catch { }
  }, 1800);

  ROOT.addEventListener('beforeunload', () => {
    domObserver.disconnect();
    clearInterval(intervalId);
  }, { once: true });

}(typeof globalThis !== 'undefined' ? globalThis : self));
