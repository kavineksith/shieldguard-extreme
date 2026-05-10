// ShieldGuard — Options Page Script (Chromium + Gecko compatible)
'use strict';

// ── API resolution ─────────────────────────────────────────────
const _ext = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

function msgBg(msg) {
  return new Promise(resolve => {
    try {
      const p = _ext.runtime.sendMessage(msg);
      if (p && typeof p.then === 'function') {
        p.then(r => resolve(r ?? null)).catch(() => resolve(null));
      } else {
        chrome.runtime.sendMessage(msg, r => {
          if (chrome.runtime?.lastError) resolve(null);
          else resolve(r ?? null);
        });
      }
    } catch { resolve(null); }
  });
}

// ── DOM helpers ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Toast ──────────────────────────────────────────────────────
let _toastTimer = null;
function toast(msg, color = 'var(--accent)') {
  const el = $('toast');
  el.textContent    = msg;
  el.style.color       = color;
  el.style.borderColor = color;
  el.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Sidebar navigation ─────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    // Close mobile sidebar after navigation
    const toggle = $('sidebar-toggle');
    if (toggle) toggle.checked = false;

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const page = $('page-' + btn.dataset.page);
    if (page) {
      page.classList.add('active');
      page.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ── Settings ───────────────────────────────────────────────────
async function loadSettings() {
  const s = await msgBg({ type: 'GET_SETTINGS' });
  if (!s) return;
  document.querySelectorAll('[data-setting]').forEach(el => {
    if (el.dataset.setting in s) el.checked = !!s[el.dataset.setting];
  });
}

document.querySelectorAll('[data-setting]').forEach(el => {
  el.addEventListener('change', async () => {
    const res = await msgBg({ type: 'SET_SETTINGS', settings: { [el.dataset.setting]: el.checked } });
    if (res?.ok) toast('✅ Setting saved');
  });
});

// ── Dashboard ──────────────────────────────────────────────────
async function loadDashboard() {
  const data = await msgBg({ type: 'GET_STATS' });
  if (!data) return;
  const { global = {}, sites = {} } = data;

  animNum('gs_total',    global.totalBlocked || 0);
  animNum('gs_ads',      global.ads          || 0);
  animNum('gs_trackers', (global.trackers || 0) + (global.scripts || 0));
  animNum('gs_overlays', global.overlays     || 0);

  renderTopSites(sites);
}

function renderTopSites(sites) {
  const tbody   = $('topSitesTable');
  const entries = Object.entries(sites)
    .sort((a, b) => (b[1].totalBlocked || 0) - (a[1].totalBlocked || 0))
    .slice(0, 25);

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--muted);text-align:center;padding:24px">
      No data yet — browse some sites!
    </td></tr>`;
    return;
  }

  const max = entries[0][1].totalBlocked || 1;
  tbody.innerHTML = entries.map(([domain, d]) => {
    const n   = d.totalBlocked || 0;
    const pct = Math.round((n / max) * 100);
    const detail = [
      d.ads      ? `${d.ads} ads`          : '',
      d.trackers ? `${d.trackers} trackers` : '',
      d.overlays ? `${d.overlays} overlays` : '',
    ].filter(Boolean).join(' · ') || '';
    return `
      <tr>
        <td>
          <span class="mono" style="font-size:var(--fs-xs)">${esc(domain)}</span>
          ${detail ? `<div style="font-size:var(--fs-xs);color:var(--muted);margin-top:2px">${esc(detail)}</div>` : ''}
        </td>
        <td class="mono">${n.toLocaleString()}</td>
        <td>
          <div class="bar-wrap">
            <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
            <span class="pct">${pct}%</span>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function animNum(id, target) {
  const el = $(id);
  if (!el) return;
  const from  = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
  if (from === target) { el.textContent = target.toLocaleString(); return; }
  const start = performance.now();
  const dur   = 650;
  function step(now) {
    const t    = Math.min(1, (now - start) / dur);
    const ease = t < .5 ? 2*t*t : -1 + (4 - 2*t)*t;
    el.textContent = Math.round(from + (target - from) * ease).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

$('clearStatsBtn').addEventListener('click', async () => {
  if (!confirm('Clear all lifetime statistics? This cannot be undone.')) return;
  const res = await msgBg({ type: 'CLEAR_ALL_STATS' });
  if (res?.ok) {
    ['gs_total','gs_ads','gs_trackers','gs_overlays'].forEach(id => {
      const el = $(id); if (el) el.textContent = '0';
    });
    $('topSitesTable').innerHTML =
      '<tr><td colspan="3" style="color:var(--muted);text-align:center;padding:24px">Stats cleared.</td></tr>';
    toast('Stats cleared', 'var(--danger)');
  }
});

// ── Whitelist ──────────────────────────────────────────────────
async function loadWhitelist() {
  const list = await msgBg({ type: 'GET_WHITELIST' });
  renderWhitelist(Array.isArray(list) ? list : []);
}

function renderWhitelist(list) {
  const container = $('wlContainer');
  // Update sidebar badge
  const badge = $('wlCount');
  if (badge) badge.textContent = list.length || '0';

  if (!list.length) {
    container.innerHTML = '<div class="wl-empty">No whitelisted sites yet. Domains added here won\'t be protected by ShieldGuard.</div>';
    return;
  }

  container.innerHTML = list
    .sort()
    .map(domain => `
      <div class="wl-item">
        <span class="wl-domain" title="${esc(domain)}">${esc(domain)}</span>
        <button class="wl-remove" data-domain="${esc(domain)}"
          title="Remove ${esc(domain)} from whitelist"
          aria-label="Remove ${esc(domain)} from whitelist">✕</button>
      </div>`)
    .join('');

  container.querySelectorAll('.wl-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const d = btn.dataset.domain;
      await msgBg({ type: 'WHITELIST_REMOVE', hostname: d });
      await loadWhitelist();
      toast(`Removed ${d}`);
    });
  });
}

// Add domain
async function addWhitelistDomain() {
  let val = $('wlInput').value.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
  if (!val) { toast('⚠️ Enter a domain', 'var(--warn)'); return; }
  // Basic validation
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(val)) {
    toast('⚠️ Invalid domain format', 'var(--warn)');
    return;
  }
  await msgBg({ type: 'WHITELIST_ADD', hostname: val });
  $('wlInput').value = '';
  await loadWhitelist();
  toast(`✅ ${val} whitelisted`);
}

$('wlAddBtn').addEventListener('click', addWhitelistDomain);
$('wlInput').addEventListener('keydown', e => { if (e.key === 'Enter') addWhitelistDomain(); });

// ── Custom Rules ───────────────────────────────────────────────
async function loadCustomRules() {
  const rules = await msgBg({ type: 'GET_CUSTOM_RULES' });
  const arr = Array.isArray(rules) ? rules : [];

  // Update sidebar badge
  const badge = $('rulesCount');
  if (badge) badge.textContent = arr.filter(r => r.enabled !== false).length || '0';

  $('rulesEditor').value = arr
    .filter(r => r.pattern)
    .map(r => (r.action === 'allow' ? '@@' : '') + r.pattern)
    .join('\n');
}

$('saveRulesBtn').addEventListener('click', async () => {
  const raw   = $('rulesEditor').value.trim();
  const lines = raw.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  const rules = lines.map(line => {
    const isAllow = line.startsWith('@@');
    const pattern = isAllow ? line.slice(2) : line;
    return { pattern, action: isAllow ? 'allow' : 'block', enabled: true };
  });

  const res = await msgBg({ type: 'SAVE_CUSTOM_RULES', rules });
  if (res?.ok) {
    const statusEl = $('rulesStatus');
    statusEl.textContent = `✅ ${rules.length} rule${rules.length !== 1 ? 's' : ''} saved and applied.`;
    statusEl.style.color = 'var(--success)';
    // Update sidebar badge
    const badge = $('rulesCount');
    if (badge) badge.textContent = rules.length || '0';
    toast(`✅ ${rules.length} rules applied`);
  }
});

$('clearRulesBtn').addEventListener('click', async () => {
  if ($('rulesEditor').value.trim() && !confirm('Clear all custom rules?')) return;
  $('rulesEditor').value = '';
  await msgBg({ type: 'SAVE_CUSTOM_RULES', rules: [] });
  const statusEl = $('rulesStatus');
  statusEl.textContent = 'All custom rules cleared.';
  statusEl.style.color = 'var(--muted)';
  const badge = $('rulesCount');
  if (badge) badge.textContent = '0';
  toast('Rules cleared', 'var(--warn)');
});

// ── About — detect browser engine ─────────────────────────────
function detectEngine() {
  const el = $('engineLbl');
  if (!el) return;
  const ua = navigator.userAgent;
  if (ua.includes('Firefox'))      el.textContent = 'Gecko (Firefox)';
  else if (ua.includes('Edg/'))    el.textContent = 'Chromium (Edge)';
  else if (ua.includes('Brave') || navigator.brave) el.textContent = 'Chromium (Brave)';
  else if (ua.includes('OPR/') || ua.includes('Opera')) el.textContent = 'Chromium (Opera)';
  else if (ua.includes('Vivaldi')) el.textContent = 'Chromium (Vivaldi)';
  else if (ua.includes('Chrome'))  el.textContent = 'Chromium (Chrome)';
  else                             el.textContent = 'Unknown';
}

// ── Keyboard shortcuts ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const toggle = $('sidebar-toggle');
    if (toggle?.checked) toggle.checked = false;
  }
});

// ── Boot ───────────────────────────────────────────────────────
async function boot() {
  try {
    await Promise.all([
      loadSettings(),
      loadDashboard(),
      loadWhitelist(),
      loadCustomRules(),
    ]);
    detectEngine();

    // Auto-refresh dashboard stats every 10s
    setInterval(loadDashboard, 10000);
  } catch (e) {
    console.error('[ShieldGuard options]', e);
  }
}

document.addEventListener('DOMContentLoaded', boot);
