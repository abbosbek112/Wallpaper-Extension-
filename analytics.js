// ── Analytics: GA4 Measurement Protocol ─────────────────────────────────────
// MV3 + CSP (script-src 'self') запрещают загрузку gtag.js, поэтому события
// отправляются вручную POST-запросом на /mp/collect. Фокус — воронка монетизации
// плюс вовлечённость/активация/онбординг (см. ANALYTICS_PLAN.md).
//
// НАСТРОЙКА: подставь значения из своего GA4 ресурса
//   Measurement ID:  Admin → Data Streams → (Web stream) → "G-XXXXXXXXXX"
//   API secret:      Admin → Data Streams → Measurement Protocol API secrets → Create
//
// Замечание: api_secret лежит в коде расширения и технически извлекаем — это
// принятое ограничение клиентской GA4-аналитики. Он даёт право только ОТПРАВЛЯТЬ
// события (не читать твои отчёты и не трогать аккаунт).
const GA_MEASUREMENT_ID = 'G-L00GLF3F8M';
const GA_API_SECRET     = 'Px5TRelLRqKDiuXiVB1POQ';

// Включить на время отладки: события сразу видны в GA4 → Admin → DebugView.
// В проде поставить false (или удалить debug_mode из params).
const GA_DEBUG = false;

// Стабильный идентификатор устройства: генерируем один раз и храним локально.
let _gaClientIdPromise = null;
function getClientId() {
  if (_gaClientIdPromise) return _gaClientIdPromise;
  _gaClientIdPromise = new Promise(resolve => {
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
  return _gaClientIdPromise;
}

// ── Сессия ──────────────────────────────────────────────────────────────────
// GA4-сессия должна жить дольше одной вкладки и закрываться по таймауту
// неактивности (30 мин). Иначе для new-tab расширения каждая вкладка = «сессия»
// и метрика «сколько раз пользуется» раздувается в разы.
const GA_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
function getSessionId() {
  const now = Date.now();
  let id, last;
  try {
    id = localStorage.getItem('mz-ga-session-id');
    last = parseInt(localStorage.getItem('mz-ga-session-last') || '0', 10);
  } catch { /* localStorage недоступен */ }
  if (!id || !last || (now - last) > GA_SESSION_TIMEOUT_MS) {
    id = String(now);
  }
  try {
    localStorage.setItem('mz-ga-session-id', id);
    localStorage.setItem('mz-ga-session-last', String(now));
  } catch { /* no-op */ }
  return id;
}

// ── Реальное время вовлечённости ────────────────────────────────────────────
// Копим миллисекунды, пока вкладка видима; каждое событие уносит накопленную
// дельту (и обнуляет её). Так GA4 получает честный engagement_time вместо 100.
let _engVisibleSince = (document.visibilityState === 'visible') ? performance.now() : 0;
let _engAccumMs = 0;
document.addEventListener('visibilitychange', () => {
  const now = performance.now();
  if (document.visibilityState === 'visible') {
    _engVisibleSince = now;
  } else if (_engVisibleSince) {
    _engAccumMs += now - _engVisibleSince;
    _engVisibleSince = 0;
    flushEngagement();
  }
});
// Досылаем накопленное время при уходе со вкладки. Для new-tab сценария
// (открыл → кликнул закладку → ушёл) следующего события обычно нет, и engagement
// у app_open терялся бы. keepalive в track() доставляет событие даже на выгрузке.
window.addEventListener('pagehide', () => flushEngagement(), { capture: true });
function flushEngagement() {
  if (_engVisibleSince) {
    _engAccumMs += performance.now() - _engVisibleSince;
    _engVisibleSince = 0;
  }
  if (_engAccumMs >= 1000) track('user_engagement');
}
function consumeEngagementMs() {
  const now = performance.now();
  if (_engVisibleSince) {
    _engAccumMs += now - _engVisibleSince;
    _engVisibleSince = now;
  }
  const ms = Math.max(1, Math.round(_engAccumMs));
  _engAccumMs = 0;
  return ms;
}

// ── User properties ─────────────────────────────────────────────────────────
// plan_status / trial_day считаем из localStorage (их пишет newtab.js),
// signed_in пробрасывает newtab.js через setAnalyticsUser().
let _userCtx = { signed_in: false };
function setAnalyticsUser(ctx) {
  if (ctx && typeof ctx === 'object') _userCtx = { ..._userCtx, ...ctx };
}
function getUserProperties() {
  let planStatus = 'trial';
  let trialDay = 0; // 0 = триал ещё не стартовал
  try {
    if (localStorage.getItem('mz-activated') === '1') {
      planStatus = 'paid';
    } else {
      const start = parseInt(localStorage.getItem('mz-trial-start') || '0', 10);
      if (start) {
        const days = (Date.now() - start) / 86400000;
        planStatus = days <= 7 ? 'trial' : 'expired';
        trialDay = Math.min(7, Math.floor(days) + 1);
      }
    }
  } catch { /* no-op */ }
  return {
    plan_status: { value: planStatus },
    trial_day:   { value: trialDay },
    signed_in:   { value: _userCtx.signed_in ? 'true' : 'false' },
  };
}

// ── Отправка события ──────────────────────────────────────────────────────────
// Ошибки сети глотаем — аналитика никогда не ломает UI.
async function track(name, params = {}) {
  try {
    // Dev opt-out: не слать НИЧЕГО с этого устройства, чтобы не портить статистику.
    // Включить в консоли new-tab страницы:
    //   localStorage.setItem('mz-no-analytics','1'); chrome.storage.local.set({mz_no_analytics:1}); location.reload();
    // Выключить: localStorage.removeItem('mz-no-analytics'); chrome.storage.local.remove('mz_no_analytics');
    // Безопасно оставлять в релизе — у обычных пользователей флаг не выставлен.
    if (localStorage.getItem('mz-no-analytics') === '1') return;
    const clientId = await getClientId();
    const url = 'https://www.google-analytics.com/mp/collect'
      + '?measurement_id=' + encodeURIComponent(GA_MEASUREMENT_ID)
      + '&api_secret=' + encodeURIComponent(GA_API_SECRET);
    const body = {
      client_id: clientId,
      user_properties: getUserProperties(),
      events: [{
        name,
        params: {
          session_id: getSessionId(),
          engagement_time_msec: consumeEngagementMs(),
          platform: 'extension',
          ...(GA_DEBUG ? { debug_mode: true } : {}),
          ...params,
        },
      }],
    };
    await fetch(url, { method: 'POST', body: JSON.stringify(body), keepalive: true });
  } catch (_) { /* no-op */ }
}

// Отправить событие не более одного раза (флаг в localStorage). Для trial_start /
// purchase / activated_user, которые иначе могли бы повториться при перезагрузке.
function trackOnce(flagKey, name, params = {}) {
  try {
    if (localStorage.getItem(flagKey)) return;
    localStorage.setItem(flagKey, '1');
  } catch { /* если localStorage недоступен — всё равно шлём */ }
  track(name, params);
}

// Отправить событие не чаще одного раза в сутки (UTC). Для daily_active.
function trackDaily(name, params = {}) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = 'mz-ga-daily-' + name;
  try {
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
  } catch { /* если localStorage недоступен — всё равно шлём */ }
  track(name, params);
}

// ── Глобальный лог ошибок ─────────────────────────────────────────────────────
// Тихие падения = тихий отток. Шлём обрезанный stack, без PII.
function _reportError(source, message, stack) {
  track('js_error', {
    source: String(source || '').slice(0, 60),
    message: String(message || '').slice(0, 120),
    stack: String(stack || '').slice(0, 300),
  });
}
window.addEventListener('error', e => {
  _reportError(e.filename, e.message, e.error && e.error.stack);
});
window.addEventListener('unhandledrejection', e => {
  const r = e && e.reason;
  _reportError('promise', (r && r.message) || String(r), r && r.stack);
});

window.track = track;
window.trackOnce = trackOnce;
window.trackDaily = trackDaily;
window.setAnalyticsUser = setAnalyticsUser;
