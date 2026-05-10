# 🛡️ ShieldGuard Extreme — Ultimate AdBlocker

> **ShieldGuard Extreme** is a high-performance, zero-telemetry privacy engine built for the modern web. It fuses the aggressive blocking power of industry leaders like uBlock Origin and AdGuard with the intelligent tracker prevention of Privacy Badger and Ghostery—all inside a single, lightweight, and hardened framework.

## ✨ Features

| Feature | Description |
|---|---|
| 🚫 **Ad Blocking** | **125+** ad network rules via `declarativeNetRequest` — YouTube Ads, video platforms, DoubleClick, programmatic exchanges, and malvertising |
| 👁️ **Tracker Blocking** | **95+** tracker rules — GA4, Plausible, Matomo, Hotjar, FullStory, TikTok Pixel, and CNAME-cloaked trackers |
| 📺 **YouTube Hardening** | Custom interceptor auto-skips video ads, fast-forwards unskippable ads, and removes all overlay/masthead promos |
| 🧹 **Overlay / Paywall Removal** | DOM sweep + MutationObserver removes cookie banners, GDPR dialogs, subscribe walls, and paywalls in real-time |
| 🔮 **Fingerprint Protection** | Injects imperceptible noise into Canvas, WebGL renderer strings, and AudioContext to break cross-site fingerprinting |
| 🤖 **Anti-Adblock Bypass** | Spoofs detection globals and injects bait elements so detectors see "ads running" |
| 🔗 **UTM / Tracking Param Stripping** | Silently removes `utm_*`, `fbclid`, `gclid`, and 30+ other tracking parameters |
| 🛡️ **Security Hardened** | Strict input validation for custom rules and secure CSP policy |

---

## 🏗️ Architecture

```
shieldguard-extreme/
├── manifest.json              # MV3 manifest — rules, content scripts, background
├── background/
│   └── service-worker.js      # Stats, whitelist, custom rules (hardened)
├── content/
│   └── content.js             # YouTube ad interceptor + DOM protection
├── browser/
│   └── compat.js              # Unified browser API shim (Chrome + Firefox)
├── rules/
│   ├── ad_rules.json          # 125 rules — Ads & Video platforms
│   ├── tracker_rules.json     # 95 rules — Analytics & Trackers
│   └── privacy_rules.json     # 70 rules — Data brokers & Privacy
├── popup/ / options/          # Extension UI (Popup & Dashboard)
└── scripts/
    └── validate_rules.js      # DNR rule validation suite
```

---

## 🚀 Installation (Developer Mode)

### 1. Clone the repository
```bash
git clone https://github.com/kavineksith/shieldguard-extreme.git
cd shieldguard-extreme
```

### 2. Load in Browser
ShieldGuard Extreme is compatible with both **Firefox (Gecko)** and **Chromium** (Chrome, Edge, Brave) using a unified Manifest V3 codebase.

#### 🦊 Firefox (Recommended)
1. Open Firefox and type `about:debugging` in the address bar.
2. Click **This Firefox** on the left sidebar.
3. Click **Load Temporary Add-on...**
4. Select the `manifest.json` file inside the cloned folder.
5. The extension is now active. Pin it to your toolbar.

#### 🌐 Chrome / Edge / Brave
1. Open your browser and navigate to the extensions page:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
2. Enable **Developer mode** toggle.
3. Click **Load unpacked** and select the entire `shieldguard-extreme` folder.
4. Pin ShieldGuard from the Extensions (puzzle piece) menu.

---

## 🧪 Verification & Development

To ensure rule integrity, we use a custom validation suite:
1. Ensure [Node.js](https://nodejs.org/) is installed.
2. Run `node scripts/validate_rules.js` from the project root.
3. This verifies all 290+ DNR rules for unique IDs, valid resource types, and syntax correctness.

---

## ⚡ How It Works

### 1. Network Layer (`declarativeNetRequest`)
Rules are enforced by the browser's native engine — **zero JavaScript overhead**. Requests are blocked before they leave the browser's process.

### 2. YouTube Ad Interceptor
Active logic in `content.js` monitors for YouTube's specific ad delivery patterns. It instantly skips advertisements, fast-forwards unskippable segments, and cleans up promotional mastheads.

### 3. Fingerprint Protection
Uses a per-session seed to inject "noise" into data returned by Canvas and Audio APIs. This prevents advertisers from using your hardware profile to track you across sites.

---

## 🔒 Privacy Guarantee

- **Zero telemetry** — No data ever leaves your browser.
- **No remote servers** — All filtering is done locally.
- **Open source** — Every line of code is auditable.
- **No monetization** — No sponsored whitelists or "acceptable ads."

---

## 📄 License

MIT License — free to use, fork, and build upon.

---

## 🙏 Inspired by

- [uBlock Origin](https://github.com/gorhill/uBlock) by Raymond Hill  
- [AdGuard](https://github.com/AdguardTeam)  
- [Privacy Badger](https://github.com/EFForg/privacybadger) by EFF  
- [Ghostery](https://github.com/ghostery/ghostery-extension)
