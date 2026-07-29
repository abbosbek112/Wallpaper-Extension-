// ── Service worker ────────────────────────────────────────────────────────────
// В SW нет localStorage/DOM, поэтому здесь свой минимальный отправщик GA4 MP.
// client_id общий с newtab (chrome.storage.local: 'ga_client_id'), чтобы события
// установки/удаления связывались с тем же устройством, что и остальная воронка.

const GA_MEASUREMENT_ID = 'G-L00GLF3F8M';
const GA_API_SECRET     = 'Px5TRelLRqKDiuXiVB1POQ';
const GA_DEBUG          = false; // в проде — false (синхронно с analytics.js)

function bgGetClientId() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get('ga_client_id', res => {
        let id = res && res.ga_client_id;
        if (!id) {
          id = (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
               (Date.now() + '.' + Math.random().toString(36).slice(2));
          chrome.storage.local.set({ ga_client_id: id });
        }
        resolve(id);
      });
    } catch {
      resolve(Date.now() + '.' + Math.random().toString(36).slice(2));
    }
  });
}

async function bgTrack(name, params = {}) {
  try {
    // Dev opt-out (парный к analytics.js). В service worker нет localStorage,
    // поэтому флаг читаем из chrome.storage.local.mz_no_analytics.
    const optOut = await new Promise(r => {
      try { chrome.storage.local.get('mz_no_analytics', o => r(!!(o && o.mz_no_analytics))); }
      catch { r(false); }
    });
    if (optOut) return;
    const clientId = await bgGetClientId();
    const url = 'https://www.google-analytics.com/mp/collect'
      + '?measurement_id=' + encodeURIComponent(GA_MEASUREMENT_ID)
      + '&api_secret=' + encodeURIComponent(GA_API_SECRET);
    const body = {
      client_id: clientId,
      events: [{
        name,
        params: {
          session_id: String(Date.now()),
          engagement_time_msec: 1,
          platform: 'extension',
          ...(GA_DEBUG ? { debug_mode: true } : {}),
          ...params,
        },
      }],
    };
    await fetch(url, { method: 'POST', body: JSON.stringify(body), keepalive: true });
  } catch (_) { /* no-op */ }
}

// Страница-опросник «почему удалили» открывается при удалении расширения.
// cid позволит связать причину с устройством (на стороне сайта/GA).
async function setUninstallUrl() {
  try {
    const cid = await bgGetClientId();
    chrome.runtime.setUninstallURL('https://zenwallpaper.com/uninstall?cid=' + encodeURIComponent(cid));
  } catch (_) { /* no-op */ }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  setUninstallUrl();
  if (reason === 'install') {
    bgTrack('extension_installed');
    chrome.tabs.create({ url: 'newtab.html' });
  }
});

// onInstalled не срабатывает при каждом старте браузера — переустанавливаем URL.
chrome.runtime.onStartup.addListener(setUninstallUrl);
