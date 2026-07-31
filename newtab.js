
// ── WebExtension Polyfill / Storage Guard for Cross-Browser & Web Compatibility ──
(function() {
  if (typeof window.chrome === 'undefined') {
    window.chrome = {};
  }
  if (!window.chrome.storage) {
    const listeners = new Set();
    const mockStorage = {
      get: (keys, cb) => {
        return new Promise(resolve => {
          let res = {};
          let keyList = keys === null ? Object.keys(localStorage) : (Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : (keys ? Object.keys(keys) : [])));
          keyList.forEach(k => {
            try {
              let val = localStorage.getItem(k);
              if (val !== null) res[k] = JSON.parse(val);
            } catch (e) {
              res[k] = localStorage.getItem(k);
            }
          });
          if (cb) cb(res);
          resolve(res);
        });
      },
      set: (obj, cb) => {
        return new Promise(resolve => {
          let changes = {};
          Object.keys(obj || {}).forEach(k => {
            let oldValue = null;
            try { oldValue = JSON.parse(localStorage.getItem(k)); } catch(e){}
            let newValue = obj[k];
            localStorage.setItem(k, JSON.stringify(newValue));
            changes[k] = { oldValue, newValue };
          });
          listeners.forEach(fn => fn(changes, 'local'));
          if (cb) cb();
          resolve();
        });
      },
      remove: (keys, cb) => {
        return new Promise(resolve => {
          let keyList = Array.isArray(keys) ? keys : [keys];
          keyList.forEach(k => localStorage.removeItem(k));
          if (cb) cb();
          resolve();
        });
      }
    };
    window.chrome.storage = {
      local: mockStorage,
      sync: mockStorage,
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn)
      }
    };
  } else if (!window.chrome.storage.onChanged) {
    window.chrome.storage.onChanged = {
      addListener: () => {},
      removeListener: () => {}
    };
  }
  if (!window.chrome.tabs) {
    window.chrome.tabs = {
      create: (opts, cb) => { if (opts && opts.url) window.open(opts.url, '_blank'); if (cb) cb({}); },
      query: (opts, cb) => { if (cb) cb([{ id: 1, url: location.href, title: document.title }]); }
    };
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      getURL: (path) => path,
      getManifest: () => ({ version: '1.3.1' }),
      lastError: null
    };
  }
})();

// ── Monetization constants — change in one place ──
const TRIAL_DAYS    = 7;
// Price/currency and checkout link are locale-specific — see i18n.js (I18N.price / I18N.buyUrl).
// Two paid plans: 'year' (1-year access, one-time payment) and 'lifetime'.
const PRICE_DISPLAY = (window.I18N ? I18N.price('lifetime').display : '$29');
const YEAR_DISPLAY  = (window.I18N ? I18N.price('year').display : '$19');
const YEAR_MS       = 365 * 86400000;
const SHOW_BADGE_WHEN_DAYS_LEFT = 3;

// Localization shortcut. i18n.js loads before this file.
const T = (k, p) => (window.I18N ? I18N.t(k, p) : k);

// Apply translations to the static markup (all overlays already parsed since
// this script runs at the end of <body>), then fill locale-specific prices.
(function () {
  try { I18N.applyStatic(document); } catch (e) {}
  const disp = PRICE_DISPLAY;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('trialPlanPrice', disp);
  set('trialYearPrice', YEAR_DISPLAY);
  set('trialFree1', T('trial.free1', { n: TRIAL_DAYS }));
  // Inline plan buttons on the paywall (trial ended) and the last-day nudge.
  const paywallBtns = document.getElementById('paywallPlanBtns');
  if (paywallBtns) paywallBtns.appendChild(planCards());
  const nudgeBtns = document.getElementById('nudgePlanBtns');
  if (nudgeBtns) nudgeBtns.appendChild(planCards(() => {
    track('nudge_clicked', { kind: 'trial_lastday' });
    document.getElementById('trialNudgeOverlay').style.display = 'none';
  }));
})();

// ── State ──
let S = {};

const DEFAULTS = {
  pages: [{ id: 'p1', name: 'Home', order: 0 }],
  boards: [],
  trash: { boards: [], bookmarks: [] },
  themeStyle: { boardColorHex: '#ffffff', boardOpacity: 55, boardBlur: 12, accentHex: '#e07a4a', isDark: false, textScale: 1, textBold: false },
  bookmarks: [],
  activePage: 'p1',
  currencyEnabled: true
};

function genId() { return '_' + Math.random().toString(36).slice(2, 10); }

function detectLocale() {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';

  // Time format + date order: language is the right signal (display preference)
  let timeFormat = '24h';
  try {
    if (new Intl.DateTimeFormat(lang, { hour: 'numeric' }).resolvedOptions().hour12) timeFormat = '12h';
  } catch(e) {}

  let dateFormat = 'DMY';
  try {
    const parts = new Intl.DateTimeFormat(lang).formatToParts(new Date(2024, 0, 31));
    const order = parts.filter(p => ['day','month','year'].includes(p.type)).map(p => p.type[0]);
    if (order[0] === 'm') dateFormat = 'MDY';
    else if (order[0] === 'y') dateFormat = 'YMD';
  } catch(e) {}

  // Week start: timezone only — Intl.Locale uses browser language, not actual location
  // Europe + Africa → Monday; everywhere else → Sunday
  const weekStart = /^(Europe|Africa)/.test(tz) ? 1 : 0;

  // Temperature: whitelist of US IANA timezones → imperial; everything else → metric
  const US_TZ = new Set([
    'America/New_York','America/Detroit','America/Kentucky/Louisville','America/Kentucky/Monticello',
    'America/Indiana/Indianapolis','America/Indiana/Vincennes','America/Indiana/Winamac',
    'America/Indiana/Marengo','America/Indiana/Petersburg','America/Indiana/Vevay',
    'America/Chicago','America/Indiana/Tell_City','America/Indiana/Knox','America/Menominee',
    'America/North_Dakota/Center','America/North_Dakota/New_Salem','America/North_Dakota/Beulah',
    'America/Denver','America/Boise','America/Los_Angeles','America/Juneau','America/Sitka',
    'America/Metlakatla','America/Yakutat','America/Anchorage','America/Nome','America/Adak',
    'America/Phoenix','Pacific/Honolulu','America/Puerto_Rico','Pacific/Guam','Pacific/Saipan',
    'Pacific/Pago_Pago','America/St_Thomas',
  ]);
  const tempUnit = US_TZ.has(tz) ? 'imperial' : 'metric';

  return { timeFormat, dateFormat, weekStart, tempUnit, _v: 3 };
}

function getLayoutParams() {
  const GAP = 14;
  const MIN_W = 190;                 // narrowest a board may shrink to
  // The floating sidebar (settings / menu) is fixed ~64px in from the right edge.
  // The grid is centered, so we reserve a symmetric band on BOTH sides — the grid
  // then can never slide under those buttons, on any screen width.
  const SIDE_RESERVE = 76;           // 64px sidebar zone + ~12px breathing gap
  const usable = Math.max(MIN_W, window.innerWidth - 2 * SIDE_RESERVE);
  const requestedW = S.boardWidth || 260;

  // Absolute column ceiling: how many boards fit even at the minimum width.
  const maxCols = Math.max(1, Math.floor((usable + GAP) / (MIN_W + GAP)));
  const manual = S.maxBoardCols;
  const numCols = (manual && manual > 0)
    ? Math.min(manual, maxCols)      // count is user-fixed; only the screen ceiling caps it
    : Math.min(maxCols, Math.max(1, Math.floor((usable + GAP) / (requestedW + GAP))));

  // Clamp width so numCols boards always fit the usable band (never overlap the
  // sidebar). This is what makes "4 columns" allow a wider board than "5 columns":
  // fewer columns → more room each → the cap rises automatically.
  const fitW = Math.floor((usable - (numCols - 1) * GAP) / numCols);
  const BOARD_W = Math.max(MIN_W, Math.min(requestedW, fitW));

  return { BOARD_W, GAP, numCols, autoCols: maxCols, fitW };
}

// Проставляет отсутствующие поля/дефолты в S и мигрирует доски. Вызывается при
// загрузке И после входа (когда S заменяется снапшотом/облаком, где части полей
// может не быть — иначе, напр., S.locale окажется undefined и настройки упадут).
function _normalizeState() {
  if (!Array.isArray(S.pages) || !S.pages.length) S.pages = JSON.parse(JSON.stringify(DEFAULTS.pages));
  if (!Array.isArray(S.boards)) S.boards = [];
  if (!Array.isArray(S.bookmarks)) S.bookmarks = [];
  if (!S.activePage || !S.pages.find(p => p.id === S.activePage)) {
    S.activePage = S.pages[0]?.id || null;
  }
  if (!S.boards) {
    S.boards = JSON.parse(JSON.stringify(DEFAULTS.boards));
    S.bookmarks = JSON.parse(JSON.stringify(DEFAULTS.bookmarks));
  }
  S.boards = S.boards.filter(b => b.id !== '_aihubboard1');
  S.boards = (S.boards || []).filter(b => b.type !== 'ambient' && b.type !== 'studystreak' && b.id !== '_ambientboard1' && b.id !== '_streakboard1' && b.id !== '_todolistboard1');
  if (!S.trash) S.trash = { boards: [], bookmarks: [] };
  if (!S.focusStats) S.focusStats = [];
  if (!S.pomTimers) S.pomTimers = {};
  if (!S.weather) S.weather = { enabled: false, city: '', units: 'metric', lat: null, lon: null, cache: {} };
  if (!S.themeStyle) S.themeStyle = { boardColorHex:'#ffffff', boardOpacity:55, boardBlur:12, accentHex:'#e07a4a', isDark:false, textScale:1, textBold:false };
  if (!S.user) S.user = { name: '', email: '', avatar: '', signedIn: false };
  if (S.openInNewTab === undefined) S.openInNewTab = true;
  if (S.incognito === undefined) S.incognito = false;
  if (S.clockEnabled === undefined) S.clockEnabled = false;
  if (S.navSearchEnabled === undefined) S.navSearchEnabled = true;
  if (S.currencyEnabled === undefined) S.currencyEnabled = true;
  if (!S.currencyBase) S.currencyBase = 'USD';
  if (!S.currencyTarget) S.currencyTarget = 'UZS';
  if (S.hideExtraBookmarks === undefined) S.hideExtraBookmarks = false;
  if (!S.maxBookmarksShown) S.maxBookmarksShown = 5;
  if (S.showDescriptions === undefined) S.showDescriptions = true;
  if (S.sidebarAlwaysExpanded === undefined) S.sidebarAlwaysExpanded = false;
  if (!S.quickSaveBoard) S.quickSaveBoard = '';
  if (!S.locale || S.locale._v !== 3) S.locale = detectLocale();
  // Migrate boards to col/row model
  S.boards.forEach((b, i) => {
    // Per-board customization was removed — drop any leftover style data.
    if (b.boardStyle) delete b.boardStyle;
    if (b.col == null) {
      if (b.x != null) {
        b.col = Math.round(b.x / 274);
        b.row = Math.round(b.y / 220);
      } else {
        const idx = b.order != null ? b.order : i;
        b.col = idx % 4;
        b.row = Math.floor(idx / 4);
      }
      delete b.x; delete b.y; delete b.order;
    }
  });
}

function loadState() {
  return new Promise(resolve => {
    chrome.storage.local.get('appState', res => {
      S = res.appState ? res.appState : JSON.parse(JSON.stringify(DEFAULTS));
      _normalizeState();
      applyThemeStyle(S.themeStyle);
      window.setAnalyticsUser?.({ signed_in: !!S.user?.signedIn });
      resolve();
    });
  });
}

// Unique per open tab, stamped onto every write we make so the storage.onChanged
// listener can tell our own writes apart from external ones (e.g. the Quick Save
// popup) without a racy boolean flag.
const _tabId = 'tab_' + Math.random().toString(36).slice(2);

let _saveTimer = null;
function saveState() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    S._writer = _tabId;
    chrome.storage.local.set({ appState: S });
    if (S.user?.signedIn) scheduleSyncWrite();
  }, 300);
}

// ── Cross-device sync via chrome.storage.sync ──
// Legacy (v1) keys — kept only for backward-compatible reads + cleanup.
const MZ_META    = 'mz_meta';
const MZ_BOARDS  = 'mz_boards';
const MZ_TRASH   = 'mz_trash';
const MZ_BK_PFX  = 'mz_bk_';
const MZ_BK_N    = 'mz_bk_n';
const MZ_BD_PFX  = 'mz_bd_';
const MZ_BD_N    = 'mz_bd_n';

// v2 sync format: the whole payload is serialized to one JSON string and split
// across mz_c_* chunks by byte size, so NO single item can blow the 8KB-per-item
// quota (a long note just spans more chunks). Only the 100KB total quota remains.
const MZ_V       = 'mz_v';      // format version
const MZ_N       = 'mz_n';      // number of payload chunks
const MZ_TS      = 'mz_ts';     // write timestamp (cheap key to watch for remote writes)
const MZ_EMAIL   = 'mz_email';  // owner email (quick ownership check before reassembling)
const MZ_C_PFX   = 'mz_c_';     // payload chunk prefix
const SYNC_ITEM_BUDGET = 7000;  // bytes/chunk, headroom under the 8192-per-item limit
const FOCUS_STATS_MAX  = 1000;  // bound focusStats growth (size no longer breaks sync)

// Split a string into chunks that each stay under `budget` bytes WHEN STORED.
// chrome.storage stores the value JSON-stringified, so a quote/backslash costs 2
// bytes and a control char 6; other chars keep their UTF-8 length. We iterate by
// code point (never splitting a surrogate pair), so concatenating the chunks
// rebuilds the exact original string.
function splitStringByBytes(str, budget) {
  const chunks = [];
  let cur = '', curBytes = 2; // the wrapping "" quotes JSON adds to a string value
  for (const ch of str) {
    const code = ch.codePointAt(0);
    let b;
    if (ch === '"' || ch === '\\') b = 2;
    else if (code < 0x20) b = 6;
    else b = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (cur && curBytes + b > budget) { chunks.push(cur); cur = ch; curBytes = 2 + b; }
    else { cur += ch; curBytes += b; }
  }
  if (cur || !chunks.length) chunks.push(cur);
  return chunks;
}

let _syncTimer   = null;
let _syncWriting = false;

function scheduleSyncWrite() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(writeSyncStorage, 3000);
}

function writeSyncStorage() {
  if (!S.user?.signedIn) return;
  _syncWriting = true;

  // Bound focusStats growth (cheap hygiene; its size no longer breaks sync).
  if (Array.isArray(S.focusStats) && S.focusStats.length > FOCUS_STATS_MAX) {
    S.focusStats = S.focusStats.slice(-FOCUS_STATS_MAX);
  }

  const ts = Date.now();
  const payload = {
    email:                 S.user.email,
    pages:                 S.pages,
    activePage:            S.activePage,
    themeStyle:            S.themeStyle,
    openInNewTab:          S.openInNewTab,
    incognito:             S.incognito,
    clockEnabled:          S.clockEnabled,
    currencyEnabled:       S.currencyEnabled,
    weather:               { enabled: S.weather?.enabled, city: S.weather?.city, units: S.weather?.units },
    hideExtraBookmarks:    S.hideExtraBookmarks,
    maxBookmarksShown:     S.maxBookmarksShown,
    maxBoardCols:          S.maxBoardCols,
    boardWidth:            S.boardWidth,
    showDescriptions:      S.showDescriptions,
    sidebarAlwaysExpanded: S.sidebarAlwaysExpanded,
    quickSaveBoard:        S.quickSaveBoard,
    locale:                S.locale,
    focusStats:            S.focusStats,
    boards:                S.boards || [],
    bookmarks:             S.bookmarks || [],
    trash:                 S.trash || { boards: [], bookmarks: [] },
    // Лицензия за аккаунтом: вход на другом ПК вернёт покупку (honor-based, без бэкенда).
    licenseActivated:      localStorage.getItem('mz-activated') === '1',
    licensePlan:           localStorage.getItem('mz-plan') || null,
    licenseActivatedAt:    parseInt(localStorage.getItem('mz-activated-at') || '0', 10) || null,
    ts,
  };

  const chunks = splitStringByBytes(JSON.stringify(payload), SYNC_ITEM_BUDGET);
  const toSet = { [MZ_V]: 2, [MZ_N]: chunks.length, [MZ_TS]: ts, [MZ_EMAIL]: S.user.email };
  chunks.forEach((c, i) => { toSet[MZ_C_PFX + i] = c; });

  // Drop anything not in this write: leftover payload chunks AND all legacy v1 keys.
  chrome.storage.sync.get(null, existing => {
    const keep = new Set(Object.keys(toSet));
    const stale = Object.keys(existing).filter(k => {
      if (keep.has(k)) return false;
      if (k.startsWith(MZ_C_PFX)) return true; // extra payload chunk beyond current count
      return k === MZ_META || k === MZ_BOARDS || k === MZ_TRASH
          || k.startsWith(MZ_BK_PFX) || k.startsWith(MZ_BD_PFX);
    });
    const done = () => {
      chrome.storage.sync.set(toSet).then(() => {
        S._syncTs = ts;
        S._writer = _tabId;
        chrome.storage.local.set({ appState: S });
      }).catch(err => {
        console.warn('[Wallpaper] Sync write failed:', err.message);
      }).finally(() => { _syncWriting = false; });
    };
    stale.length ? chrome.storage.sync.remove(stale, done) : done();
  });
}

async function loadFromSync(email) {
  return new Promise(resolve => {
    chrome.storage.sync.get(null, items => {
      // v2: reassemble the chunked JSON payload.
      if (items[MZ_V] >= 2) {
        if (items[MZ_EMAIL] && items[MZ_EMAIL] !== email) { resolve(null); return; }
        const n = items[MZ_N] || 0;
        let str = '';
        for (let i = 0; i < n; i++) str += (items[MZ_C_PFX + i] || '');
        let payload;
        try { payload = JSON.parse(str); } catch { resolve(null); return; }
        if (!payload || payload.email !== email) { resolve(null); return; }
        resolve({
          meta: payload,
          boards: payload.boards || [],
          bookmarks: payload.bookmarks || [],
          trash: payload.trash || { boards: [], bookmarks: [] },
        });
        return;
      }

      // v1 (legacy) format: separate meta / boards / bookmarks / trash keys.
      const meta = items[MZ_META];
      if (!meta || meta.email !== email) { resolve(null); return; }
      const numBkChunks = items[MZ_BK_N] || 0;
      const bookmarks = [];
      for (let i = 0; i < numBkChunks; i++) bookmarks.push(...(items[MZ_BK_PFX + i] || []));
      let boards;
      if (items[MZ_BD_N] != null) {
        boards = [];
        for (let i = 0; i < items[MZ_BD_N]; i++) boards.push(...(items[MZ_BD_PFX + i] || []));
      } else {
        boards = items[MZ_BOARDS] || [];
      }
      resolve({ meta, boards, bookmarks, trash: items[MZ_TRASH] || { boards: [], bookmarks: [] } });
    });
  });
}

function applyFromSync(synced) {
  const { meta, boards, bookmarks, trash } = synced;
  S.pages                = meta.pages                || S.pages;
  S.activePage           = meta.activePage           || S.activePage;
  S.boards               = boards;
  S.bookmarks            = bookmarks;
  S.trash                = trash;
  S.themeStyle           = meta.themeStyle           || S.themeStyle;
  S.openInNewTab         = meta.openInNewTab         ?? S.openInNewTab;
  S.incognito            = meta.incognito            ?? S.incognito;
  S.clockEnabled         = meta.clockEnabled         ?? S.clockEnabled;
  S.currencyEnabled      = meta.currencyEnabled      ?? S.currencyEnabled;
  S.hideExtraBookmarks   = meta.hideExtraBookmarks   ?? S.hideExtraBookmarks;
  S.maxBookmarksShown    = meta.maxBookmarksShown    || S.maxBookmarksShown;
  S.maxBoardCols         = meta.maxBoardCols         ?? S.maxBoardCols;
  S.boardWidth           = meta.boardWidth           ?? S.boardWidth;
  S.showDescriptions     = meta.showDescriptions     ?? S.showDescriptions;
  S.sidebarAlwaysExpanded= meta.sidebarAlwaysExpanded?? S.sidebarAlwaysExpanded;
  S.quickSaveBoard       = meta.quickSaveBoard       || S.quickSaveBoard;
  S.locale               = meta.locale               || S.locale;
  S.focusStats           = meta.focusStats           || S.focusStats;
  if (meta.weather) {
    S.weather = { ...S.weather, enabled: meta.weather.enabled, city: meta.weather.city,
      units: meta.weather.units };
  }
  if (!S.activePage || !S.pages.find(p => p.id === S.activePage)) {
    S.activePage = S.pages[0]?.id || null;
  }
  // Лицензия за аккаунтом: только ВОССТАНАВЛИВАЕМ покупку (никогда не снимаем —
  // устройство, где активировали локально, не должно терять доступ из-за синка).
  if (meta.licenseActivated) {
    localStorage.setItem('mz-activated', '1');
    if (meta.licensePlan) localStorage.setItem('mz-plan', meta.licensePlan);
    if (meta.licenseActivatedAt) localStorage.setItem('mz-activated-at', String(meta.licenseActivatedAt));
    localStorage.setItem('mz-plan-chosen', '1');
  }
}

// Дополняет target данными из extra (страницы/доски/закладки) БЕЗ потерь: добавляет
// только то, чего в target ещё нет (по id), а доски с занятой позицией сдвигает вниз,
// чтобы не наложились. Используется при входе — слить гостевую работу с аккаунтом.
function _mergeInto(target, extra) {
  target.pages     = target.pages     || [];
  target.boards    = target.boards    || [];
  target.bookmarks = target.bookmarks || [];

  // Страницы: добавить те, которых нет по id.
  const pageIds = new Set(target.pages.map(p => p.id));
  let maxOrder = target.pages.reduce((m, p) => Math.max(m, p.order || 0), -1);
  (extra.pages || []).forEach(p => {
    if (!pageIds.has(p.id)) { target.pages.push({ ...p, order: ++maxOrder }); pageIds.add(p.id); }
  });

  // Доски: добавить новые по id; занятые позиции сдвигаем по строке вниз.
  const boardIds = new Set(target.boards.map(b => b.id));
  const occ = {};
  target.boards.forEach(b => { (occ[b.pageId] || (occ[b.pageId] = new Set())).add(b.col + ',' + b.row); });
  (extra.boards || []).forEach(b => {
    if (boardIds.has(b.id)) return;
    const pid = pageIds.has(b.pageId) ? b.pageId : (target.pages[0] && target.pages[0].id);
    const set = occ[pid] || (occ[pid] = new Set());
    let col = b.col || 0, row = b.row || 0;
    while (set.has(col + ',' + row)) row++;
    set.add(col + ',' + row);
    target.boards.push({ ...b, pageId: pid, col, row });
    boardIds.add(b.id);
  });

  // Закладки: добавить новые по id, если их доска существует; демо пропускаем.
  const bkIds = new Set(target.bookmarks.map(bk => bk.id));
  const validBoards = new Set(target.boards.map(b => b.id));
  (extra.bookmarks || []).forEach(bk => {
    if (bk.isDemo || bkIds.has(bk.id) || !validBoards.has(bk.boardId)) return;
    target.bookmarks.push({ ...bk });
    bkIds.add(bk.id);
  });
}

// ── Deferred reconcile ──
// Cross-tab / cross-device live updates re-render the whole page. If that fires
// while the user is mid-interaction — typing a new board name or search query,
// editing a popup field, dragging, or with a popup/menu open — the rebuild would
// destroy the focused input (losing focus + typed text) or detach a popup's
// anchor (sending it to the top-left corner). So while the user is busy we hold
// only the NEWEST reconcile and run it once they go idle. Live sync is preserved,
// just applied at a calm moment instead of over an active input.
let _deferredReconcile = null;

function isUserBusy() {
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return true;
  if (_dragId) return true;
  if (document.querySelector('.bk-popup, .board-menu, .focus-stats-popup, .nsb-eng-popup, .pom-settings-popup')) return true;
  return false;
}

function reconcileOrDefer(fn) {
  if (isUserBusy()) { _deferredReconcile = fn; return; }
  fn();
}

function flushDeferredReconcile() {
  if (_deferredReconcile && !isUserBusy()) {
    const fn = _deferredReconcile;
    _deferredReconcile = null;
    fn();
  }
}
// Retry the flush right after the user finishes an interaction.
document.addEventListener('focusout', () => setTimeout(flushDeferredReconcile, 200));
document.addEventListener('dragend',  () => setTimeout(flushDeferredReconcile, 200));
document.addEventListener('click',    () => setTimeout(flushDeferredReconcile, 200));

// Listen for changes pushed from other devices
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || _syncWriting || !S.user?.signedIn) return;
  // v2 writes bump mz_ts; legacy remote writes still touch mz_meta.
  if (!changes[MZ_TS] && !changes[MZ_META]) return;
  if (changes[MZ_TS] && changes[MZ_TS].newValue === S._syncTs) return; // our own write
  reconcileOrDefer(() => {
    loadFromSync(S.user.email).then(synced => {
      if (!synced) return;
      applyFromSync(synced);
      S._writer = _tabId;
      chrome.storage.local.set({ appState: S });
      renderAll();
    });
  });
});

// Reflect external writes to local appState (e.g. Quick Save from the toolbar
// popup, or another open tab) so the page updates live instead of needing a
// manual refresh — and so our next saveState() doesn't clobber the addition.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.appState) return;
  const nv = changes.appState.newValue;
  if (!nv || nv._writer === _tabId) return; // our own write
  reconcileOrDefer(() => {
    loadState().then(() => {
      renderAll();
      if (S.user?.signedIn) scheduleSyncWrite(); // propagate the addition to sync
    });
  });
});

// ── Favicon ──
// Each service should show its real icon, so we build a chain of sources and
// walk it via onerror. The old single fallback was google.com/s2/favicons,
// which collapses every Google product (Gmail, Calendar, …) to a generic "G".
const MULTI_PART_TLDS = [
  'co.uk','com.au','co.jp','co.nz','co.za','com.br','com.mx',
  'co.in','org.uk','gov.uk','ac.uk','com.tr','com.ar','com.sg'
];

function getRootDomain(host) {
  const t = host.split('.');
  if (t.length <= 2) return host;
  const last2 = t.slice(-2).join('.');
  if (MULTI_PART_TLDS.includes(last2)) return t.length <= 3 ? host : t.slice(-3).join('.');
  return last2;
}

// Google products can't be resolved from their bare domain — gmail.com,
// mail.google.com, etc. all report a generic "G" to every favicon service.
// So we hardcode the real product icons (same approach as competitors). Keys
// are hostname, or "hostname/firstPathSegment" for products that share a host
// (docs.google.com/spreadsheets, …). Checked before any network source.
const KNOWN_FAVICONS = {
  'gmail.com':                    'https://ssl.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png',
  'mail.google.com':             'https://ssl.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png',
  'calendar.google.com':         'https://ssl.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png',
  'drive.google.com':            'https://ssl.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png',
  'meet.google.com':             'https://ssl.gstatic.com/images/branding/product/2x/meet_2020q4_48dp.png',
  'chat.google.com':             'https://ssl.gstatic.com/images/branding/product/2x/chat_2020q4_48dp.png',
  'keep.google.com':             'https://ssl.gstatic.com/images/branding/product/2x/keep_2020q4_48dp.png',
  'photos.google.com':           'https://ssl.gstatic.com/images/branding/product/2x/photos_48dp.png',
  'contacts.google.com':         'https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png',
  'translate.google.com':        'https://ssl.gstatic.com/images/branding/product/2x/translate_48dp.png',
  'maps.google.com':             'https://www.gstatic.com/images/branding/product/2x/maps_48dp.png',
  'google.com/maps':             'https://www.gstatic.com/images/branding/product/2x/maps_48dp.png',
  'www.google.com/maps':         'https://www.gstatic.com/images/branding/product/2x/maps_48dp.png',
  'docs.google.com':             'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico',
  'docs.google.com/document':    'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico',
  'docs.google.com/spreadsheets':'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico',
  'docs.google.com/presentation':'https://ssl.gstatic.com/docs/presentations/images/favicon5.ico',
  'docs.google.com/forms':       'https://ssl.gstatic.com/docs/forms/device_home/android_192.png',
  'google.com':                  'https://ssl.gstatic.com/images/branding/product/1x/googleg_48dp.png',
  'www.google.com':              'https://ssl.gstatic.com/images/branding/product/1x/googleg_48dp.png',
};

function knownFavicon(u) {
  const host = u.hostname.toLowerCase();
  const seg1 = u.pathname.split('/').filter(Boolean)[0];
  if (seg1 && KNOWN_FAVICONS[host + '/' + seg1]) return KNOWN_FAVICONS[host + '/' + seg1];
  return KNOWN_FAVICONS[host] || null;
}

// Chrome's own favicon cache (needs "favicon" permission). Only knows icons for
// sites the user has actually visited, so it's the LAST resort — useful when a
// site serves no public favicon.ico but the browser cached one. It always
// yields an image (a default globe when nothing is cached) and never fires
// onerror, so it must come last in the chain.
function chromeFaviconUrl(pageUrl, size = 32) {
  try {
    const u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', String(size));
    return u.toString();
  } catch { return ''; }
}

// Google's faviconV2 resolves the FULL page URL the way Chrome does, so every
// Google product on its own subdomain (gemini/mail/drive/calendar/photos/…)
// returns its real icon — not the generic google.com "G" that the old
// domain-based s2 endpoint gave. (Path-only products like www.google.com/maps
// still need the hardcoded map, since this keys off the origin.)
function faviconV2Url(pageUrl, size = 64) {
  return 'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size='
    + size + '&url=' + encodeURIComponent(pageUrl);
}

function faviconCandidates(url) {
  const list = [];
  try {
    const u = new URL(url);
    const host = u.hostname;
    const root = getRootDomain(host);
    // 1. Hardcoded brand icons (Google products) — works without ever visiting.
    const known = knownFavicon(u);
    if (known) list.push(known);
    // 2. The site's own favicon — best when present, no visit needed.
    list.push(u.origin + '/favicon.ico');
    // 3. faviconV2 by full URL: resolves Google subdomain products correctly.
    //    Must come before the root-domain / ddg-root fallbacks below, which for
    //    a subdomain (gemini.google.com) would return the parent google.com "G".
    list.push(faviconV2Url(url));
    list.push('https://icons.duckduckgo.com/ip3/' + host + '.ico');
    if (root && root !== host) list.push('https://' + root + '/favicon.ico');
    if (root && root !== host) list.push('https://icons.duckduckgo.com/ip3/' + root + '.ico');
    // 4. Chrome's cache as a final guaranteed image (real icon if visited).
    const chromeUrl = chromeFaviconUrl(url);
    if (chromeUrl) list.push(chromeUrl);
  } catch {}
  return list.filter(Boolean);
}

// Favicons are cached as data URLs in chrome.storage.local. Boards re-render on
// every drag/page switch (recreating these <img>s) and the whole page reloads
// each time a new tab opens — without a cache, setFavicon re-walks the network
// chain every time and the first candidate's 404 → swap flickers. Storing the
// actual bytes means a cached icon paints instantly, offline, with no network.
const FAVICON_STORE_KEY = 'faviconCache';
const FAVICON_CACHE_VERSION = 4;               // bump to discard & rebuild the cache
const FAVICON_TTL = 1000 * 60 * 60 * 24 * 30; // refresh icons older than 30 days
const FAVICON_PX = 48;                         // re-encode every icon to this size
const _faviconCache = new Map();   // cacheKey -> data: URL
const _faviconTime = new Map();    // cacheKey -> timestamp (ms)
const _faviconResolving = new Set();
let _faviconDirty = false;
let _faviconSaveTimer = null;

// Key by hostname so all bookmarks of a site share one icon, but keep path
// granularity where we have per-path icons (docs.google.com/spreadsheets, …).
function faviconCacheKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const seg1 = u.pathname.split('/').filter(Boolean)[0];
    if (seg1 && KNOWN_FAVICONS[host + '/' + seg1]) return host + '/' + seg1;
    return host;
  } catch { return url; }
}

function loadFaviconCache() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(FAVICON_STORE_KEY, res => {
        const obj = res && res[FAVICON_STORE_KEY];
        // Discard the whole cache on a version bump so entries poisoned by older
        // logic get rebuilt cleanly instead of breaking a site forever.
        if (obj && typeof obj === 'object' && obj.__v === FAVICON_CACHE_VERSION) {
          for (const k in obj) {
            if (k === '__v') continue;
            const v = obj[k];
            if (typeof v === 'string') { _faviconCache.set(k, v); _faviconTime.set(k, 0); }
            else if (v && typeof v.d === 'string') { _faviconCache.set(k, v.d); _faviconTime.set(k, v.t || 0); }
          }
        }
        resolve();
      });
    } catch { resolve(); }
  });
}

function scheduleFaviconSave() {
  if (_faviconSaveTimer) return;
  _faviconSaveTimer = setTimeout(() => {
    _faviconSaveTimer = null;
    if (!_faviconDirty) return;
    _faviconDirty = false;
    const obj = { __v: FAVICON_CACHE_VERSION };
    for (const [k, v] of _faviconCache) obj[k] = { d: v, t: _faviconTime.get(k) || 0 };
    try { chrome.storage.local.set({ [FAVICON_STORE_KEY]: obj }); } catch {}
  }, 2000);
}

function evictFavicon(key) {
  if (!_faviconCache.has(key)) return;
  _faviconCache.delete(key);
  _faviconTime.delete(key);
  _faviconDirty = true;
  scheduleFaviconSave();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// Fetch one icon source and re-encode it to a small PNG data URL. Returns null
// if the source can't be fetched, decoded, or renders fully transparent. We
// ALWAYS go through PNG: caching the raw bytes of some .ico files (a 2-colour
// icon Chrome decodes to transparency, or a malformed oversized one) produced
// an entry that loaded but showed nothing in the extension — the regression
// behind "site X stopped showing its favicon".
async function reencodeFaviconToPng(src) {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size || !/^image\//.test(blob.type)) return null;
    const bmp = await createImageBitmap(blob); // throws on undecodable bytes
    const canvas = new OffscreenCanvas(FAVICON_PX, FAVICON_PX);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, FAVICON_PX, FAVICON_PX);
    bmp.close && bmp.close();
    const px = ctx.getImageData(0, 0, FAVICON_PX, FAVICON_PX).data;
    let visible = false;
    for (let p = 3; p < px.length; p += 4) { if (px[p] !== 0) { visible = true; break; } }
    if (!visible) return null;
    const out = await canvas.convertToBlob({ type: 'image/png' });
    if (!out.size || out.size > 200000) return null;
    const dataUrl = await blobToDataUrl(out);
    return (typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) ? dataUrl : null;
  } catch { return null; }
}

// Resolve a bookmark's favicon for caching: walk the candidate sources and keep
// the first that re-encodes to a visible PNG. So if a site's own favicon.ico is
// undecodable, we fall through to DuckDuckGo / Google which serve clean PNGs.
async function resolveAndCacheFavicon(key, url, force = false) {
  const have = _faviconCache.get(key);
  if (!force && typeof have === 'string' && have.startsWith('data:')) return;
  if (_faviconResolving.has(key)) return;
  _faviconResolving.add(key);
  try {
    const cands = faviconCandidates(url).filter(c => !c.startsWith('data:'));
    for (const src of cands) {
      const dataUrl = await reencodeFaviconToPng(src);
      if (dataUrl) {
        _faviconCache.set(key, dataUrl);
        _faviconTime.set(key, Date.now());
        _faviconDirty = true;
        scheduleFaviconSave();
        return;
      }
    }
  } finally { _faviconResolving.delete(key); }
}

// Re-resolve a stale icon in the background (handles sites that rebrand). The
// displayed icon keeps using the cached copy; only the stored bytes update.
function maybeRefreshFavicon(key, url) {
  if (Date.now() - (_faviconTime.get(key) || 0) < FAVICON_TTL) return;
  // Mark as fresh now so a failed refresh won't retry on every render.
  _faviconTime.set(key, Date.now());
  _faviconDirty = true;
  scheduleFaviconSave();
  resolveAndCacheFavicon(key, url, true);
}

function setFavicon(img, url) {
  const key = faviconCacheKey(url);
  let candidates = faviconCandidates(url);
  const cached = _faviconCache.get(key);
  if (cached) {
    candidates = [cached, ...candidates.filter(c => c !== cached)];
    maybeRefreshFavicon(key, url);
  }
  let i = 0;
  function next() {
    if (i >= candidates.length) { img.onerror = null; img.onload = null; img.style.visibility = 'hidden'; return; }
    img.src = candidates[i++];
  }
  img.onload = () => {
    // Something is on screen; make sure a clean PNG is cached for next time.
    if (!_faviconCache.has(key)) resolveAndCacheFavicon(key, url);
  };
  img.onerror = () => {
    // A cached entry that no longer loads is poison — drop it and re-resolve.
    if (cached && img.src === cached) evictFavicon(key);
    next();
  };
  next();
}

// ── Render ──
function updateNavLayout() {
  const nav = document.getElementById('pagesNav');
  if (!nav) return;

  const navLeft = nav.getBoundingClientRect().left;
  let rightBound = null;

  const nsbBar = document.querySelector('.nsb-bar');
  if (nsbBar) {
    const r = nsbBar.getBoundingClientRect();
    if (r.width > 0) rightBound = r.left;
  }

  const widgets = document.getElementById('topWidgets');
  if (widgets) {
    const wLeft = widgets.getBoundingClientRect().left;
    rightBound = rightBound !== null ? Math.min(rightBound, wLeft) : wLeft;
  }

  if (rightBound !== null && rightBound > navLeft) {
    nav.style.maxWidth = Math.max(80, rightBound - navLeft - 16) + 'px';
  } else {
    nav.style.maxWidth = '';
  }

  _updateScrollThumb?.();
}

function syncLayout() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  // On narrow viewports the topbar uses CSS flex layout (stacked), so skip
  // JS-driven width/margin which would conflict with the responsive rules.
  if (window.innerWidth <= 600) {
    topbar.style.width = '';
    topbar.style.marginLeft = '';
    updateNavLayout();
    return;
  }
  const colItems = document.querySelectorAll('.boards-columns > .board-column');
  if (!colItems.length) { topbar.style.width = ''; topbar.style.marginLeft = ''; updateNavLayout(); return; }
  const first = colItems[0].getBoundingClientRect();
  const last  = colItems[colItems.length - 1].getBoundingClientRect();
  topbar.style.width = (last.right - first.left) + 'px';
  topbar.style.marginLeft = first.left + 'px';
  updateNavLayout();
}

function renderAll() { renderPages(); renderBoards(); renderNavSearch(); requestAnimationFrame(syncLayout); }

function renderPages() {
  const nav = document.getElementById('pagesNav');
  const prevScroll = nav.querySelector('.tabs-group')?.scrollLeft || 0;
  nav.innerHTML = '';


  const group = document.createElement('div');
  group.className = 'tabs-group';

  let _dragId = null;

  function clearDropIndicators() {
    group.querySelectorAll('.tab-drop-indicator').forEach(el => el.remove());
    group.querySelectorAll('.page-tab').forEach(t => t.classList.remove('drag-over'));
  }

  [...S.pages].sort((a, b) => a.order - b.order).forEach(page => {
    const tab = document.createElement('div');
    tab.className = 'page-tab' + (page.id === S.activePage ? ' active' : '');
    tab.dataset = tab.dataset || {};
    tab.dataset.id = page.id;
    tab.setAttribute('data-id', page.id);
    tab.draggable = true;

    const name = document.createElement('span');
    name.className = 'page-tab-name';
    name.textContent = page.name;
    name.addEventListener('dblclick', e => { e.stopPropagation(); startPageRename(page.id, name); });
    tab.appendChild(name);

    tab.addEventListener('click', () => switchPage(page.id));
    tab.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      showPageMenu(page.id, e.clientX, e.clientY);
    });

    tab.addEventListener('dragstart', e => {
      _dragId = page.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => tab.classList.add('dragging'), 0);
    });

    tab.addEventListener('dragend', () => {
      _dragId = null;
      tab.classList.remove('dragging');
      clearDropIndicators();
    });

    tab.addEventListener('dragover', e => {
      if (!_dragId) return;
      const isBoard = S.boards.some(b => b.id === _dragId);
      if (isBoard) {
        e.preventDefault();
        tab.classList.add('drag-over');
        return;
      }
      if (_dragId === page.id) return;
      e.preventDefault();
      clearDropIndicators();
      const rect = tab.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      const indicator = document.createElement('div');
      indicator.className = 'tab-drop-indicator';
      group.insertBefore(indicator, before ? tab : tab.nextSibling);
    });

    tab.addEventListener('dragleave', () => {
      tab.classList.remove('drag-over');
    });

    tab.addEventListener('drop', e => {
      e.preventDefault();
      clearDropIndicators();
      const draggedBoard = S.boards.find(b => b.id === _dragId);
      if (draggedBoard) {
        if (draggedBoard.pageId !== page.id) {
          draggedBoard.pageId = page.id;
          draggedBoard.col = 0;
          draggedBoard.row = 0;
          saveState();
          renderBoards();
        }
        return;
      }
      if (!_dragId || _dragId === page.id) return;
      const rect = tab.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      const sorted = [...S.pages].sort((a, b) => a.order - b.order);
      const fromIdx = sorted.findIndex(p => p.id === _dragId);
      const [dragged] = sorted.splice(fromIdx, 1);
      const toIdx = sorted.findIndex(p => p.id === page.id);
      sorted.splice(before ? toIdx : toIdx + 1, 0, dragged);
      sorted.forEach((p, i) => { p.order = i; });
      saveState();
      renderPages();
    });

    group.appendChild(tab);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'add-page-btn';
  addBtn.title = T('tip.newPage');
  addBtn.setAttribute('data-tour', 'add-page');
  addBtn.innerHTML = `<span style="font-size:20px;line-height:1;font-weight:300;">+</span>`;
  addBtn.addEventListener('click', addPage);
  group.appendChild(addBtn);

  nav.appendChild(group);

  // Scrollbar inside tabs-group
  const scrollBar = document.createElement('div');
  scrollBar.className = 'tabs-scroll-bar';
  const scrollThumb = document.createElement('div');
  scrollThumb.className = 'tabs-scroll-thumb';
  scrollBar.appendChild(scrollThumb);
  nav.appendChild(scrollBar);

  function updateScrollThumb() {
    const visible = group.clientWidth;
    const total = group.scrollWidth;
    const ratio = visible / total;
    const hasScroll = ratio < 0.999;
    scrollBar.style.opacity = hasScroll ? '1' : '0';
    scrollThumb.style.width = (ratio * 100) + '%';
    scrollThumb.style.left = ((group.scrollLeft / total) * 100) + '%';
    const atEnd = group.scrollLeft + visible >= total - 2;
    nav.classList.toggle('has-overflow', hasScroll && !atEnd);
  }
  _updateScrollThumb = updateScrollThumb;

  group.addEventListener('scroll', updateScrollThumb);

  // Click on track → jump to position
  scrollBar.addEventListener('mousedown', e => {
    if (e.target === scrollThumb) return;
    const rect = scrollBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    group.scrollLeft = pct * group.scrollWidth - group.clientWidth / 2;
    e.preventDefault();
  });

  // Drag thumb
  scrollThumb.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startScroll = group.scrollLeft;
    const barW = scrollBar.clientWidth;
    const total = group.scrollWidth;
    function onMove(ev) {
      const dx = ev.clientX - startX;
      group.scrollLeft = startScroll + (dx / barW) * total;
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  requestAnimationFrame(() => {
    group.scrollLeft = prevScroll;
    updateNavLayout();
    updateScrollThumb();
  });
}

function renderNavSearch() {
  const el = document.getElementById('navSearchBar');
  if (!el) return;
  if (!S.navSearchEnabled) { el.innerHTML = ''; closeNsbEnginePopup(); return; }
  const prevVal = el.querySelector('.nsb-input')?.value || '';
  el.innerHTML = '';

  const bar = document.createElement('div');
  bar.className = 'nsb-bar';

  // Static search icon (left)
  bar.insertAdjacentHTML('beforeend', `<svg class="nsb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`);

  // Text input
  const input = document.createElement('input');
  input.className = 'nsb-input';
  input.type = 'text';
  input.placeholder = T('search.widgetPlaceholder');
  input.value = prevVal;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      nsbDoSearch(input.value.trim());
      input.value = '';
    }
    if (e.key === 'Escape') { closeNsbEnginePopup(); input.blur(); }
  });
  bar.appendChild(input);

  // Engine icon button (right) — shows current engine, click opens picker
  const curEngId = S.navSearchEngine || 'google';
  const curEng = SEARCH_ENGINES.find(e => e.id === curEngId) || SEARCH_ENGINES[1];
  const engBtn = document.createElement('button');
  engBtn.className = 'nsb-eng-logo';
  engBtn.title = `Engine: ${curEng.name}`;
  engBtn.appendChild(nsbEngineIcon(curEng, 16));
  engBtn.addEventListener('click', e => { e.stopPropagation(); openNsbEnginePopup(engBtn); });
  bar.appendChild(engBtn);

  el.appendChild(bar);
}

function closeNsbEnginePopup() {
  if (_nsbEngPopup) { _nsbEngPopup.remove(); _nsbEngPopup = null; }
}

function openNsbEnginePopup(engBtn) {
  closeNsbEnginePopup();

  const popup = document.createElement('div');
  popup.className = 'nsb-eng-popup';
  popup.style.visibility = 'hidden';

  SEARCH_ENGINES.forEach(eng => {
    const opt = document.createElement('button');
    opt.className = 'nsb-eng-opt' + (eng.id === (S.navSearchEngine || 'google') ? ' active' : '');
    opt.appendChild(nsbEngineIcon(eng, 18));
    const label = document.createElement('span');
    label.textContent = eng.name;
    opt.appendChild(label);
    opt.addEventListener('click', e => {
      e.stopPropagation();
      S.navSearchEngine = eng.id;
      saveState();
      closeNsbEnginePopup();
      renderNavSearch();
      requestAnimationFrame(syncLayout);
    });
    popup.appendChild(opt);
  });

  _nsbEngPopup = popup;
  document.body.appendChild(popup);

  // Position after layout — visibility:hidden prevents flash
  const btnRect = engBtn.getBoundingClientRect();
  const popW = popup.offsetWidth;
  const popH = popup.offsetHeight;
  let left = btnRect.left;
  let top  = btnRect.bottom + 8;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  if (top  + popH > window.innerHeight - 8) top = btnRect.top - popH - 8;
  popup.style.left = left + 'px';
  popup.style.top  = top  + 'px';
  popup.style.visibility = '';

  const outsideClick = ev => {
    if (!popup.contains(ev.target) && ev.target !== engBtn) {
      closeNsbEnginePopup();
      document.removeEventListener('click', outsideClick, true);
    }
  };
  setTimeout(() => document.addEventListener('click', outsideClick, true), 0);
}


function activateColDropZones(sourceCol) {
  const ba = document.getElementById('boardsArea');
  const baRect = ba ? ba.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const bottomOffset = window.innerHeight - baRect.bottom;
  const colEls = document.querySelectorAll('.board-column');

  document.querySelectorAll('.col-drop-zone').forEach(z => {
    const c = parseInt(z.dataset.col);
    if (c === sourceCol) return;
    const colEl = colEls[c];
    if (!colEl) return;
    const colRect = colEl.getBoundingClientRect();
    // Start zone from the grid-cell (+ button) position, clamped to visible area
    const gridCell = colEl.querySelector('.grid-cell');
    const naturalTop = gridCell ? gridCell.getBoundingClientRect().top : colRect.bottom;
    const top = Math.max(baRect.top + 8, Math.min(naturalTop, baRect.bottom - 60));
    z.classList.add('active');
    z.style.cssText = `position:fixed;left:${colRect.left}px;width:${colRect.width}px;top:${top}px;bottom:${bottomOffset + 8}px;`;
  });
}
function deactivateColDropZones() {
  document.querySelectorAll('.col-drop-zone').forEach(z => {
    z.classList.remove('active', 'hover');
    z.style.cssText = '';
  });
}


function renderBoards() {
  const area = document.getElementById('boardsArea');
  area.innerHTML = '';

  const { BOARD_W, GAP, numCols } = getLayoutParams();

  const pageBoards = S.boards.filter(b => b.pageId === S.activePage);

  const container = document.createElement('div');
  container.className = 'boards-columns';
  container.style.setProperty('--board-w', BOARD_W + 'px');

  for (let c = 0; c < numCols; c++) {
    const col = document.createElement('div');
    col.className = 'board-column';
    const colBoards = pageBoards.filter(b => (b.col >= numCols ? numCols - 1 : b.col) === c).sort((a, b) => a.row - b.row);
    colBoards.forEach(board => {
      if (board.type === 'calendar') col.appendChild(buildCalendarBoard(board));
      else if (board.type === 'pomodoro') col.appendChild(buildPomodoroBoard(board));
      else if (board.type === 'notes') col.appendChild(buildNotesBoard(board));
      else if (board.type === 'search') col.appendChild(buildSearchBoard(board));
      else if (board.type === 'aihub') col.appendChild(buildAiHubBoard(board));
      else if (board.type === 'studystreak') col.appendChild(buildStreakBoard(board));
      else if (board.type === 'todolist') col.appendChild(buildTodoListBoard(board));
      else col.appendChild(buildBoard(board));
    });
    const dropZone = document.createElement('div');
    dropZone.className = 'col-drop-zone';
    dropZone.dataset.col = c;
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('hover'); });
    dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('hover'); });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('hover', 'active');
      if (_dragId) { moveBoardTo(_dragId, c, 9999); _dragId = null; }
    });
    col.appendChild(dropZone);
    col.appendChild(createCell(c, colBoards.length, true));

    // Gap drop: fires only in the spaces between boards (boards call stopPropagation)
    col.addEventListener('dragover', e => {
      if (!_dragId) return;
      e.preventDefault();
      const boards = [...col.querySelectorAll('.board')].filter(b => b.dataset.id !== _dragId);
      if (!boards.length) return;
      let best = null, bestBefore = true, bestDist = Infinity;
      boards.forEach(b => {
        const r = b.getBoundingClientRect();
        const dTop = Math.abs(e.clientY - r.top);
        const dBot = Math.abs(e.clientY - r.bottom);
        if (dTop < bestDist) { bestDist = dTop; best = b; bestBefore = true; }
        if (dBot < bestDist) { bestDist = dBot; best = b; bestBefore = false; }
      });
      document.querySelectorAll('.board.drop-before,.board.drop-after')
        .forEach(b => b.classList.remove('drop-before', 'drop-after'));
      if (best) {
        best.classList.add(bestBefore ? 'drop-before' : 'drop-after');
        _dropTarget = { id: best.dataset.id, before: bestBefore };
      }
    });
    col.addEventListener('dragleave', e => {
      if (col.contains(e.relatedTarget)) return;
      document.querySelectorAll('.board.drop-before,.board.drop-after')
        .forEach(b => b.classList.remove('drop-before', 'drop-after'));
      _dropTarget = null;
    });
    col.addEventListener('drop', e => {
      if (!_dragId) return;
      e.preventDefault();
      document.querySelectorAll('.board.drop-before,.board.drop-after')
        .forEach(b => b.classList.remove('drop-before', 'drop-after'));
      if (_dropTarget) insertBoardAt(_dragId, _dropTarget.id, _dropTarget.before);
      else moveBoardTo(_dragId, c, 9999);
      _dragId = null; _dropTarget = null;
    });

    container.appendChild(col);
  }

  area.appendChild(container);

  // Center the columns with an INTEGER margin so boards land on whole pixels
  // (sub-pixel positions trigger the backdrop-filter edge-halo). Done here
  // synchronously — not in syncLayout — so dragging never flashes boards left.
  const colsW = numCols * BOARD_W + (numCols - 1) * GAP;
  const offset = Math.max(0, Math.round((area.clientWidth - colsW) / 2));
  container.style.marginLeft = offset + 'px';

  updateFocusStats();
}

function createCell(col, row, canAdd) {
  const cell = document.createElement('div');
  cell.className = 'grid-cell' + (canAdd ? ' can-add' : '');
  const plus = document.createElement('span');
  plus.className = 'cell-plus';
  plus.textContent = '+';
  cell.appendChild(plus);
  if (canAdd) cell.addEventListener('click', () => addBoardAt(col, row));
  cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drag-over'); });
  cell.addEventListener('dragleave', e => { if (!cell.contains(e.relatedTarget)) cell.classList.remove('drag-over'); });
  cell.addEventListener('drop', e => {
    e.preventDefault();
    cell.classList.remove('drag-over');
    if (_dragId) { moveBoardTo(_dragId, col, row); _dragId = null; }
  });
  return cell;
}

function buildBoard(board) {
  const el = document.createElement('div');
  el.className = 'board';
  el.dataset.id = board.id;
  const blurBg = document.createElement('div');
  blurBg.className = 'board-blur-bg';
  el.appendChild(blurBg);

  const hdr = document.createElement('div');
  hdr.className = 'board-header';

  el.addEventListener('dragover', e => {
    if (!_dragBkId) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.add('bk-drop-target');
  });
  el.addEventListener('dragleave', e => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('bk-drop-target');
  });
  el.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('bk-drop-target');
    if (_dragBkId && _dragBkId !== board.id) {
      const bk = S.bookmarks.find(b => b.id === _dragBkId);
      if (bk) {
        bk.boardId = board.id;
        bk.order = S.bookmarks.filter(b => b.boardId === board.id && b.id !== bk.id).length;
        saveState(); renderBoards();
      }
      _dragBkId = null;
    }
  });

  el.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    if (e.target.closest('.link-item') || e.target.closest('.add-link-row')) return;
    el.draggable = true;
  });
  el.addEventListener('dragstart', e => {
    _dragId = board.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', board.id);
    setTimeout(() => el.classList.add('is-dragging'), 0);
    activateColDropZones(board.col);
  });
  el.addEventListener('dragend', () => {
    el.draggable = false;
    el.classList.remove('is-dragging');
    document.querySelectorAll('.board.drop-before,.board.drop-after')
      .forEach(b => b.classList.remove('drop-before', 'drop-after'));
    _dropTarget = null;
    deactivateColDropZones();
    if (_dragId) { _dragId = null; renderBoards(); }
  });

  const titleEl = document.createElement('span');
  titleEl.className = 'board-title';
  titleEl.textContent = board.name;
  titleEl.addEventListener('dblclick', () => startBoardRename(board.id, titleEl));

  const addLinkBtn = document.createElement('button');
  addLinkBtn.className = 'board-add-link-btn';
  addLinkBtn.textContent = '+';
  addLinkBtn.title = T('tip.addLink');
  addLinkBtn.setAttribute('data-tour', 'add-link');
  addLinkBtn.addEventListener('click', e => { e.stopPropagation(); showAddLinkInput(board.id, addLinkBtn); });

  const menuBtn = document.createElement('button');
  menuBtn.className = 'board-menu-btn';
  menuBtn.textContent = '···';
  menuBtn.addEventListener('click', e => { e.stopPropagation(); showBoardMenu(board.id, menuBtn); });

  hdr.appendChild(titleEl);
  hdr.appendChild(addLinkBtn);
  hdr.appendChild(menuBtn);
  el.appendChild(hdr);


  const boardBks = [...S.bookmarks]
    .filter(bk => bk.boardId === board.id)
    .sort((a, b) => a.order - b.order);
  const isExpanded = _expandedBoards.has(board.id);
  const maxShow = (S.hideExtraBookmarks && !isExpanded) ? (S.maxBookmarksShown || 5) : boardBks.length;
  boardBks.slice(0, maxShow).forEach(bk => el.appendChild(buildBookmark(bk)));
  if (S.hideExtraBookmarks) {
    if (boardBks.length > maxShow) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'bk-show-more-btn';
      moreBtn.textContent = T('board.more', { n: boardBks.length - maxShow });
      moreBtn.addEventListener('click', e => {
        e.stopPropagation();
        _expandedBoards.add(board.id);
        renderBoards();
      });
      el.appendChild(moreBtn);
    } else if (isExpanded && boardBks.length > (S.maxBookmarksShown || 5)) {
      const hideBtn = document.createElement('button');
      hideBtn.className = 'bk-show-more-btn';
      hideBtn.textContent = T('board.showLess');
      hideBtn.addEventListener('click', e => {
        e.stopPropagation();
        _expandedBoards.delete(board.id);
        renderBoards();
      });
      el.appendChild(hideBtn);
    }
  }

  el.addEventListener('dragover', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    const before = e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2;
    document.querySelectorAll('.board.drop-before,.board.drop-after')
      .forEach(b => b.classList.remove('drop-before', 'drop-after'));
    el.classList.add(before ? 'drop-before' : 'drop-after');
    _dropTarget = { id: board.id, before };
  });
  el.addEventListener('dragleave', e => {
    if (_dragId && !el.contains(e.relatedTarget))
      el.classList.remove('drop-before', 'drop-after');
  });
  el.addEventListener('drop', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('drop-before', 'drop-after');
    if (_dropTarget) { insertBoardAt(_dragId, _dropTarget.id, _dropTarget.before); }
    _dragId = null; _dropTarget = null;
  });

  applyBoardStyle(el, board);
  return el;
}

function buildBookmark(bk) {
  const el = document.createElement('a');
  el.className = 'link-item';
  el.href = bk.url;
  el.target = S.openInNewTab !== false ? '_blank' : '_self';
  const img = document.createElement('img');
  img.className = 'favicon';
  setFavicon(img, bk.url);

  const info = document.createElement('div');
  info.className = 'link-info';

  const title = document.createElement('span');
  title.className = 'link-title';
  title.textContent = bk.title;
  info.appendChild(title);

  if (bk.description) {
    const desc = document.createElement('span');
    desc.className = 'link-desc';
    desc.textContent = bk.description;
    info.appendChild(desc);
  }

  const menuBtn = document.createElement('button');
  menuBtn.className = 'link-menu-btn';
  menuBtn.textContent = '⋮';
  menuBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); showBookmarkMenu(bk.id, menuBtn); });

  el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showBookmarkMenu(bk.id, menuBtn, e.clientX, e.clientY); });

  el.addEventListener('mouseenter', () => {
    try {
      const origin = new URL(bk.url).origin;
      if (!document.querySelector(`link[data-pre="${origin}"]`)) {
        const l = document.createElement('link');
        l.rel = 'preconnect'; l.href = origin; l.dataset.pre = origin;
        document.head.appendChild(l);
      }
    } catch {}
  });
  el.addEventListener('mousedown', e => { if (e.target.closest('button')) return; el.draggable = true; });
  el.addEventListener('dragstart', e => {
    _dragBkId = bk.id;
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
    setTimeout(() => el.classList.add('bk-dragging'), 0);
  });
  el.addEventListener('dragend', () => {
    el.draggable = false;
    el.classList.remove('bk-dragging');
    document.querySelectorAll('.board.bk-drop-target').forEach(b => b.classList.remove('bk-drop-target'));
    document.querySelectorAll('.link-item.bk-drop-before,.link-item.bk-drop-after')
      .forEach(b => b.classList.remove('bk-drop-before', 'bk-drop-after'));
    _bkDropTarget = null;
    if (_dragBkId) { _dragBkId = null; renderBoards(); }
  });

  el.addEventListener('dragover', e => {
    if (!_dragBkId || _dragBkId === bk.id) return;
    e.preventDefault(); e.stopPropagation();
    const before = e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2;
    document.querySelectorAll('.link-item.bk-drop-before,.link-item.bk-drop-after')
      .forEach(b => b.classList.remove('bk-drop-before', 'bk-drop-after'));
    el.classList.add(before ? 'bk-drop-before' : 'bk-drop-after');
    _bkDropTarget = { id: bk.id, before };
  });
  el.addEventListener('dragleave', e => {
    if (_dragBkId && !el.contains(e.relatedTarget))
      el.classList.remove('bk-drop-before', 'bk-drop-after');
  });
  el.addEventListener('drop', e => {
    if (!_dragBkId || _dragBkId === bk.id) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('bk-drop-before', 'bk-drop-after');
    if (_bkDropTarget) { reorderBookmark(_dragBkId, _bkDropTarget.id, _bkDropTarget.before); }
    _dragBkId = null; _bkDropTarget = null;
  });

  el.appendChild(img); el.appendChild(info); el.appendChild(menuBtn);
  return el;
}

// ── Bookmark popup helpers ──
function _placePopup(popup, anchor) {
  document.body.appendChild(popup);
  const r = anchor.getBoundingClientRect();
  popup.style.top  = Math.min(r.bottom + 6, window.innerHeight - 220) + 'px';
  popup.style.left = Math.min(r.left, window.innerWidth - 236) + 'px';
}

function _popupInput(parent, val, placeholder) {
  const inp = document.createElement('input');
  inp.className = 'add-link-input';
  inp.value = val || '';
  inp.placeholder = placeholder;
  parent.appendChild(inp);
  return inp;
}

function _popupBtns(parent, onCancel, onPrimary, primaryLabel) {
  const row = document.createElement('div');
  row.className = 'bk-popup-btns';
  const cancel = document.createElement('button');
  cancel.className = 'bk-popup-btn';
  cancel.textContent = T('common.cancel');
  cancel.addEventListener('click', onCancel);
  const primary = document.createElement('button');
  primary.className = 'bk-popup-btn bk-popup-btn-primary';
  primary.textContent = primaryLabel;
  primary.addEventListener('click', onPrimary);
  row.appendChild(cancel); row.appendChild(primary);
  parent.appendChild(row);
  return primary;
}

function _outsideClose(popup, exclude) {
  setTimeout(() => {
    const h = e => {
      if (!popup.contains(e.target) && (!exclude || !exclude.contains(e.target))) {
        popup.remove(); document.removeEventListener('click', h);
      }
    };
    document.addEventListener('click', h);
  }, 0);
}

// ── Add link (step 1 → step 2) ──
function showAddLinkInput(boardId, anchor) {
  document.querySelector('.bk-popup')?.remove();

  const popup = document.createElement('div');
  popup.className = 'bk-edit-popup bk-popup';

  const urlInput = _popupInput(popup, '', T('addlink.pasteUrl'));
  _popupBtns(popup, () => popup.remove(), proceed, T('addlink.add'));
  _placePopup(popup, anchor);
  urlInput.focus();

  function proceed() {
    const raw = urlInput.value.trim();
    if (!raw) { urlInput.focus(); return; }
    const url = /^https?:\/\//.test(raw) ? raw : 'https://' + raw;
    popup.remove();
    showAddLinkStep2(boardId, anchor, url);
  }
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') proceed(); if (e.key === 'Escape') popup.remove(); });
  // No outside-click close here: an accidental click outside would discard the
  // typed URL. Dismiss via Esc or the Cancel button instead.
}

function showAddLinkStep2(boardId, anchor, url) {
  const popup = document.createElement('div');
  popup.className = 'bk-edit-popup bk-popup';

  const urlInput  = _popupInput(popup, url, T('popup.url'));
  // Pre-fill the name with the hostname; the user can rename it before saving.
  let autoName = url; try { autoName = new URL(url).hostname.replace('www.', ''); } catch {}
  const nameInput = _popupInput(popup, autoName, T('addlink.name'));
  const descInput = _popupInput(popup, '', T('addlink.descOptional'));

  function save() {
    const finalUrl = urlInput.value.trim();
    if (!finalUrl) return;
    const u = /^https?:\/\//.test(finalUrl) ? finalUrl : 'https://' + finalUrl;
    let auto = u; try { auto = new URL(u).hostname.replace('www.', ''); } catch {}
    addBookmark(boardId, u, nameInput.value.trim() || auto, descInput.value.trim() || undefined);
    popup.remove();
  }

  _popupBtns(popup, () => popup.remove(), save, T('addlink.add'));
  _placePopup(popup, anchor);
  nameInput.focus(); nameInput.select();

  [nameInput, descInput].forEach(inp =>
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') popup.remove(); })
  );
  urlInput.addEventListener('keydown', e => { if (e.key === 'Escape') popup.remove(); });
  // No outside-click close: don't discard a typed name/description by accident.
  // Dismiss via Esc or the Cancel button instead.
}

// ── Bookmark context menu ──
// Shared icon set for context menus — stroke uses currentColor so both themes work.
const MENU_ICONS = {
  open:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  incognito: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  edit:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
  rename:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  openAll:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  trash:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  move:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
};

// Builds a context-menu shell with a consistent icon + label row style.
// Returns { menu, item, sep }. `icon` is one of MENU_ICONS (optional).
function createMenu() {
  const menu = document.createElement('div');
  menu.className = 'board-menu';
  function item(label, icon, cls, cb) {
    const el = document.createElement('div');
    el.className = 'board-menu-item' + (cls ? ' ' + cls : '');
    const ic = document.createElement('span');
    ic.className = 'board-menu-icon';
    if (icon) ic.innerHTML = icon;
    const lb = document.createElement('span');
    lb.className = 'board-menu-label';
    lb.textContent = label;
    el.appendChild(ic); el.appendChild(lb);
    el.addEventListener('click', () => { closeMenu(); cb(); });
    menu.appendChild(el);
  }
  function sep() {
    const el = document.createElement('div');
    el.className = 'board-menu-sep';
    menu.appendChild(el);
  }
  return { menu, item, sep };
}

function showBookmarkMenu(bkId, anchor, cx, cy) {
  closeMenu();
  const { menu, item, sep } = createMenu();
  _menu = menu;

  const bkForMenu = S.bookmarks.find(b => b.id === bkId);
  if (bkForMenu?.url) {
    item(T('menu.open'),           MENU_ICONS.open,      '', () => chrome.tabs.create({ url: bkForMenu.url, active: false }));
    item(T('menu.openIncognito'),  MENU_ICONS.incognito, '', () => chrome.windows.create({ url: bkForMenu.url, incognito: true }));
    sep();
  }
  item(T('menu.edit'),   MENU_ICONS.edit,  '',       () => showBookmarkEdit(bkId, anchor));
  item(T('menu.delete'), MENU_ICONS.trash, 'danger', () => deleteBookmark(bkId));

  document.body.appendChild(menu);

  const mw = menu.offsetWidth + 12;
  if (cx !== undefined && cy !== undefined) {
    menu.style.left = Math.min(cx, window.innerWidth - mw) + 'px';
    menu.style.top  = Math.min(cy, window.innerHeight - menu.offsetHeight - 8) + 'px';
  } else {
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth - mw) + 'px';
    menu.style.top  = (r.bottom + 4) + 'px';
  }
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}

// ── Edit bookmark ──
function showBookmarkEdit(bkId, anchor) {
  document.querySelector('.bk-popup')?.remove();
  const bk = S.bookmarks.find(b => b.id === bkId);
  if (!bk) return;

  const popup = document.createElement('div');
  popup.className = 'bk-edit-popup bk-popup';

  const urlInput  = _popupInput(popup, bk.url,         T('popup.url'));
  const nameInput = _popupInput(popup, bk.title,        T('addlink.name'));
  const descInput = _popupInput(popup, bk.description,  T('addlink.descOptional'));

  function save() {
    const raw = urlInput.value.trim(); if (!raw) return;
    bk.url = /^https?:\/\//.test(raw) ? raw : 'https://' + raw;
    let auto = bk.url; try { auto = new URL(bk.url).hostname.replace('www.', ''); } catch {}
    bk.title = nameInput.value.trim() || auto;
    const d = descInput.value.trim();
    if (d) bk.description = d; else delete bk.description;
    saveState(); renderBoards(); popup.remove();
  }

  _popupBtns(popup, () => popup.remove(), save, T('common.save'));
  _placePopup(popup, anchor);
  nameInput.focus();

  [urlInput, nameInput, descInput].forEach(inp =>
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') popup.remove(); })
  );
  // No outside-click close: don't discard edits by an accidental click outside.
  // Dismiss via Esc or the Cancel button instead.
}

// ── Board menu ──
let _menu = null;
let _dragId = null, _dragBkId = null, _dropTarget = null, _bkDropTarget = null;
let _updateScrollThumb = null;
let _nsbEngPopup = null;

document.addEventListener('wheel', e => {
  if (!_dragId && !_dragBkId) return;
  const ba = document.getElementById('boardsArea');
  if (ba) { ba.scrollTop += e.deltaY; e.preventDefault(); }
}, { passive: false });
let _calendarState = {};
let _pomodoroState = {};
let _expandedBoards = new Set();
function closeMenu() { if (_menu) { _menu.remove(); _menu = null; } }

// Per-board customization was removed (caused backdrop-filter light-stripe
// artifacts with many customized boards). This now only clears any leftover
// inline styling so old boards fall back to the default theme appearance.
function applyBoardStyle(el, board) {
  const textVars = ['--board-text','--board-text-secondary','--board-text-dim','--board-text-hover','--board-hover-bg'];
  el.style.removeProperty('background'); el.style.removeProperty('backdrop-filter');
  el.style.removeProperty('-webkit-backdrop-filter'); el.style.removeProperty('border-color');
  textVars.forEach(v => el.style.removeProperty(v));
  el.classList.remove('board-custom-light');
}

function showBoardMenu(boardId, anchor) {
  closeMenu();
  const { menu, item, sep } = createMenu();

  const board = S.boards.find(b => b.id === boardId);
  const isCalOrPom = board && (board.type === 'calendar' || board.type === 'pomodoro');
  const isBookmarkBoard = board && (board.type === 'bookmarks' || !board.type);
  const isTodo = board && board.type === 'todolist';
  let hasAction = false;

  if (!isCalOrPom) {
    item(T('menu.rename'), MENU_ICONS.rename, '', () => {
      const boardEl = document.querySelector(`.board[data-id="${boardId}"]`);
      if (boardEl) startBoardRename(boardId, boardEl.querySelector('.board-title'));
    });
    hasAction = true;
  }

  if (isBookmarkBoard) {
    item(T('menu.openAll'), MENU_ICONS.openAll, '', () => {
      S.bookmarks.filter(bk => bk.boardId === boardId).forEach(bk => window.open(bk.url, '_blank'));
    });
    hasAction = true;
  } else if (isTodo) {
    const urls = (board.todos || []).map(t => {
      const match = t.text ? t.text.match(/https?:\/\/[^\s]+/) : null;
      return match ? match[0] : null;
    }).filter(Boolean);

    if (urls.length > 0) {
      item(T('menu.openAll'), MENU_ICONS.openAll, '', () => {
        urls.forEach(url => window.open(url, '_blank'));
      });
      hasAction = true;
    }
  }

  if (hasAction) sep();
  item(T('menu.deleteBoard'), MENU_ICONS.trash, 'danger', () => deleteBoard(boardId));

  document.body.appendChild(menu);
  _menu = menu;

  const r = anchor.getBoundingClientRect();
  menu.style.top = (r.bottom + 4) + 'px';
  menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 12) + 'px';

  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}

function showPageMenu(pageId, x, y) {
  closeMenu();
  const { menu, item, sep } = createMenu();

  item(T('menu.rename'), MENU_ICONS.rename, '', () => {
    const tab = document.querySelector(`.page-tab[data-id="${pageId}"]`);
    if (tab) startPageRename(pageId, tab.querySelector('.page-tab-name'));
  });
  if (S.pages.length > 1) {
    sep();
    item(T('menu.delete'), MENU_ICONS.trash, 'danger', () => deletePage(pageId));
  }

  document.body.appendChild(menu);
  _menu = menu;

  menu.style.top = Math.min(y + 6, window.innerHeight - menu.offsetHeight - 8) + 'px';
  menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 12) + 'px';

  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}

// ── Inline rename ──
function startBoardRename(boardId, titleEl, opts = {}) {
  const board = S.boards.find(b => b.id === boardId);
  if (!board || !titleEl || titleEl.tagName === 'INPUT') return;
  const isNew = !!opts.isNew;

  const input = document.createElement('input');
  input.className = 'board-title-input';
  // Stop Chrome autofill from previewing a saved value in the freshly-focused
  // field, which tinted the placeholder pale blue (:-internal-autofill-previewed).
  input.setAttribute('autocomplete', 'off');
  input.spellcheck = false;
  input.value = board.name;
  if (isNew) input.placeholder = T('board.new');
  titleEl.replaceWith(input);
  input.focus(); input.select();

  let done = false;
  function discard() {
    // A brand-new board left unnamed is dropped — protects against accidental
    // clicks on "+" and means an empty board never gets saved.
    done = true;
    S.boards = S.boards.filter(b => b.id !== boardId);
    saveState();
    renderBoards();
  }
  function commit() {
    if (done) return;
    const name = input.value.trim();
    if (isNew && !name) { discard(); return; }
    done = true;
    const finalName = name || board.name || board.title || 'Board';
    board.name = finalName;
    board.title = finalName;
    saveState();
    const newEl = document.createElement('span');
    newEl.className = 'board-title';
    newEl.textContent = finalName;
    newEl.addEventListener('dblclick', () => startBoardRename(boardId, newEl));
    input.replaceWith(newEl);
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      input.removeEventListener('blur', commit);
      if (isNew) { discard(); return; }
      input.value = board.name; commit(); // restore original name
    }
  });
}

function startPageRename(pageId, nameEl) {
  const page = S.pages.find(p => p.id === pageId);
  if (!page) return;

  const input = document.createElement('input');
  input.style.cssText = 'background:none;border:none;border-bottom:1px solid rgba(255,255,255,0.3);color:inherit;font:inherit;outline:none;width:80px;padding:0;';
  input.value = page.name;
  nameEl.replaceWith(input);
  input.focus(); input.select();

  let done = false;
  function commit() {
    if (done) return; done = true;
    page.name = input.value.trim() || page.name;
    saveState();
    nameEl.textContent = page.name;
    input.replaceWith(nameEl);
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { done = true; input.value = page.name; input.blur(); commit(); }
  });
}

// ── CRUD ──
function addPage() {
  if (!hasFullAccess() && S.pages.length >= 1) {
    showLimitHint(T('limit.pages'));
    return;
  }
  const maxOrder = S.pages.length ? Math.max(...S.pages.map(p => p.order)) : -1;
  const page = { id: genId(), name: 'New Page', order: maxOrder + 1 };
  S.pages.push(page);
  S.activePage = page.id;
  track('page_created', { total_pages: S.pages.length });
  saveState(); renderAll();
  setTimeout(() => {
    const tab = document.querySelector(`.page-tab[data-id="${page.id}"]`);
    if (tab) startPageRename(page.id, tab.querySelector('.page-tab-name'));
  }, 50);
}

function deletePage(pageId) {
  if (S.pages.length <= 1) return;
  const boardIds = S.boards.filter(b => b.pageId === pageId).map(b => b.id);
  S.bookmarks = S.bookmarks.filter(bk => !boardIds.includes(bk.boardId));
  S.boards = S.boards.filter(b => b.pageId !== pageId);
  S.pages = S.pages.filter(p => p.id !== pageId);
  if (S.activePage === pageId) S.activePage = S.pages[0].id;
  saveState(); renderAll();
}

function switchPage(pageId) {
  if (S.activePage === pageId) return;
  S.activePage = pageId;
  saveState(); renderAll();
}

function addBoardAt(col, row) {
  if (!hasFullAccess() && S.boards.filter(b => b.pageId === S.activePage).length >= 3) {
    showLimitHint(T('limit.boards'));
    return;
  }
  const board = { id: genId(), pageId: S.activePage, name: '', col, row };
  S.boards.push(board);
  track('board_created', { total_boards: S.boards.length });
  trackOnce('mz-ga-activated', 'activated_user', { via: 'board' });
  // Not saved yet: persists only once the user types a name (see startBoardRename).
  renderBoards();
  const boardEl = document.querySelector(`.board[data-id="${board.id}"]`);
  if (boardEl) startBoardRename(board.id, boardEl.querySelector('.board-title'), { isNew: true });
}

function compactColumn(col) {
  S.boards
    .filter(b => b.pageId === S.activePage && b.col === col)
    .sort((a, b) => a.row - b.row)
    .forEach((b, i) => { b.row = i; });
}

function moveBoardTo(boardId, col, row) {
  const board = S.boards.find(b => b.id === boardId);
  if (!board) return;
  const sourceCol = board.col;
  board.col = col; board.row = row;
  compactColumn(col);
  if (col !== sourceCol) compactColumn(sourceCol);
  saveState(); renderBoards();
}

function insertBoardAt(draggedId, targetId, before) {
  if (draggedId === targetId) return;
  const dragged = S.boards.find(b => b.id === draggedId);
  const target  = S.boards.find(b => b.id === targetId);
  if (!dragged || !target) return;
  const sourceCol = dragged.col;
  const colBoards = S.boards
    .filter(b => b.pageId === S.activePage && b.col === target.col && b.id !== draggedId)
    .sort((a, b) => a.row - b.row);
  const idx = colBoards.findIndex(b => b.id === targetId);
  dragged.col = target.col;
  colBoards.splice(before ? idx : idx + 1, 0, dragged);
  colBoards.forEach((b, i) => { b.row = i; });
  if (sourceCol !== target.col) compactColumn(sourceCol);
  saveState(); renderBoards();
}

function reorderBookmark(draggedId, targetId, before) {
  if (draggedId === targetId) return;
  const dragged = S.bookmarks.find(b => b.id === draggedId);
  const target  = S.bookmarks.find(b => b.id === targetId);
  if (!dragged || !target) return;
  dragged.boardId = target.boardId;
  const boardBks = S.bookmarks
    .filter(b => b.boardId === target.boardId && b.id !== draggedId)
    .sort((a, b) => a.order - b.order);
  const idx = boardBks.findIndex(b => b.id === targetId);
  boardBks.splice(before ? idx : idx + 1, 0, dragged);
  boardBks.forEach((b, i) => { b.order = i; });
  saveState(); renderBoards();
}

function findFreePosition() {
  const { numCols } = getLayoutParams();
  const occupied = new Set(S.boards.filter(b => b.pageId === S.activePage).map(b => `${b.col},${b.row}`));
  for (let row = 0; row < 100; row++) {
    for (let col = 0; col < numCols; col++) {
      if (!occupied.has(`${col},${row}`)) return { col, row };
    }
  }
  return { col: 0, row: 0 };
}

function triggerBrowserNotification(title, bodyText) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body: bodyText, icon: 'icon128.png' });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(permission => {
      if (permission === "granted") {
        new Notification(title, { body: bodyText, icon: 'icon128.png' });
      }
    });
  }
}

let _pomAudioCtx = null;
function playPomSound(type) {
  try {
    if (!_pomAudioCtx) _pomAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _pomAudioCtx;
    // resume() must run synchronously inside user gesture; if context just started
    // currentTime is 0 so schedule slightly ahead to give the clock time to tick
    const needsWarmup = ctx.state !== 'running';
    ctx.resume();
    const t = ctx.currentTime + (needsWarmup ? 0.15 : 0);
    if (type === 'start') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(600, t);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.start(t); osc.stop(t + 0.12);
    } else {
      [[523, 0], [659, 0.18], [784, 0.36]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(freq, t + delay);
        gain.gain.setValueAtTime(0.35, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.6);
        osc.start(t + delay); osc.stop(t + delay + 0.6);
      });
    }
  } catch(e) {}
}

function addPomodoro() {
  const { col, row } = findFreePosition();
  const board = { id: genId(), pageId: S.activePage, name: 'Pomodoro', type: 'pomodoro', col, row };
  S.boards.push(board);
  saveState(); renderBoards();
}

const POM_PLAY  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="8,3 20,12 8,21"/></svg>`;
const POM_PAUSE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const POM_RESET = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3,3 3,8 8,8"/></svg>`;
const POM_SKIP  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="4,4 14,12 4,20" stroke="none"/><rect x="17" y="4" width="3" height="16" rx="1" stroke="none"/></svg>`;
const POM_GEAR  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

function pomFmt(s) { return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0'); }

function getPomSettings(board) {
  return Object.assign({ focus: 25, short: 5, long: 15, cycle: 4 }, board.pomSettings || {});
}

function savePomTimer(boardId) {
  const ps = _pomodoroState[boardId];
  if (!ps || !S.pomTimers) return;
  S.pomTimers[boardId] = {
    phase: ps.phase, sessions: ps.sessions,
    timeLeft: ps.timeLeft, running: ps.running,
    startedAt: ps.startedAt || null, startedTimeLeft: ps.startedTimeLeft != null ? ps.startedTimeLeft : null
  };
  saveState();
}

function getPomState(id, focusMins) {
  if (!_pomodoroState[id]) {
    const saved = S.pomTimers?.[id];
    if (saved) {
      let timeLeft = saved.timeLeft ?? ((focusMins || 25) * 60);
      // Recalculate from wall-clock if timer was running when page was closed
      if (saved.running && saved.startedAt && saved.startedTimeLeft != null) {
        const elapsed = Math.floor((Date.now() - saved.startedAt) / 1000);
        timeLeft = Math.max(0, saved.startedTimeLeft - elapsed);
      }
      let phase = saved.phase || 'work';
      let sessions = saved.sessions || 0;
      const wasRunning = !!(saved.running && timeLeft > 0);
      // Phase completed while away — record focus time and reset
      if (saved.running && timeLeft <= 0 && saved.phase === 'work') {
        if (!S.focusStats) S.focusStats = [];
        S.focusStats.push({ ts: Date.now(), mins: Math.round((saved.startedTimeLeft || (focusMins || 25) * 60) / 60) });
        sessions++; phase = 'work'; timeLeft = (focusMins || 25) * 60;
      } else if (saved.running && timeLeft <= 0) {
        phase = 'work'; timeLeft = (focusMins || 25) * 60;
      }
      _pomodoroState[id] = {
        phase, viewPhase: phase, timeLeft, running: wasRunning, sessions,
        interval: null,
        startedAt: wasRunning ? saved.startedAt : null,
        startedTimeLeft: wasRunning ? saved.startedTimeLeft : null
      };
    } else {
      _pomodoroState[id] = { phase:'work', viewPhase:'work', timeLeft:(focusMins||25)*60, running:false, sessions:0, interval:null, startedAt:null, startedTimeLeft:null };
    }
  } else if (!_pomodoroState[id].viewPhase) {
    _pomodoroState[id].viewPhase = _pomodoroState[id].phase;
  }
  return _pomodoroState[id];
}

function getFocusByDay(days) {
  const now = new Date();
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const start = d.getTime();
    let mins = (S.focusStats || []).filter(s => s.ts >= start && s.ts < start + 86400000).reduce((a, s) => a + s.mins, 0);
    if (i === 0) {
      // Add in-progress/paused work time to today
      Object.entries(_pomodoroState).forEach(([boardId, ps]) => {
        if (ps.phase === 'work') {
          const b = S.boards.find(b => b.id === boardId);
          if (b) mins += Math.floor(Math.max(0, getPomSettings(b).focus * 60 - ps.timeLeft) / 60);
        }
      });
    }
    result.push({ date: d, mins });
  }
  return result;
}

function getFocusByMonth(months) {
  const now = new Date();
  const result = [];
  for (let i = months - 1; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const mins = (S.focusStats || []).filter(s => s.ts >= d.getTime() && s.ts < end.getTime()).reduce((a, s) => a + s.mins, 0);
    result.push({ date: d, mins });
  }
  return result;
}

// ── Clock widget ──

function renderClockWidget() {
  const el = document.getElementById('clockWidget');
  if (!el) return;
  el.style.display = S.clockEnabled ? '' : 'none';
}

function tickClock() {
  const timeEl = document.getElementById('clockTime');
  const dateEl = document.getElementById('clockDate');
  if (!timeEl) return;

  const now = new Date();
  const loc = S.locale || {};
  const use12 = loc.timeFormat === '12h';

  let h = now.getHours(), m = now.getMinutes();
  if (use12) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    timeEl.innerHTML = `${h}:${String(m).padStart(2,'0')}<span class="clock-ampm">${ampm}</span>`;
  } else {
    timeEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  const DAY = T('clock.days');
  const MON = T('cal.monShort');
  const fmt = loc.dateFormat || 'DMY';
  const d = now.getDate(), mo = MON[now.getMonth()], wd = DAY[now.getDay()];
  let dateStr;
  if (fmt === 'MDY') dateStr = `${wd}, ${MON[now.getMonth()]} ${d}`;
  else               dateStr = `${wd}, ${d} ${mo}`;

  dateEl.textContent = dateStr;
}

let _clockInterval = null;
function startClock() {
  renderClockWidget();
  tickClock();
  const now = new Date();
  const msToNextMin = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  setTimeout(() => {
    tickClock();
    _clockInterval = setInterval(tickClock, 60000);
  }, msToNextMin);
}

// ── Weather widget ──

function weatherIcon(code) {
  if (code === 0) {
    return `<svg class="wi-svg wi-sunny" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
  if (code <= 2) {
    return `<svg class="wi-svg wi-cloudy" viewBox="0 0 24 24"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" fill="currentColor"/></svg>`;
  }
  if (code <= 3) {
    return `<svg class="wi-svg wi-cloudy" viewBox="0 0 24 24" style="color:#64748b;"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" fill="currentColor"/></svg>`;
  }
  if (code <= 48) {
    return `<svg class="wi-svg wi-cloudy" viewBox="0 0 24 24" style="opacity: 0.7;"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" fill="currentColor"/><line x1="4" y1="21" x2="20" y2="21" stroke="currentColor" stroke-width="2"/><line x1="6" y1="18" x2="18" y2="18" stroke="currentColor" stroke-width="2"/></svg>`;
  }
  if (code <= 57) {
    return `<svg class="wi-svg wi-rainy" viewBox="0 0 24 24"><path d="M17 14h.5a4.5 4.5 0 1 0 0-9h-1.79A7 7 0 1 0 9 14h8z" fill="currentColor"/><path class="rain-drop drop-1" d="M10 16v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="rain-drop drop-2" d="M14 16v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }
  if (code <= 67) {
    return `<svg class="wi-svg wi-rainy" viewBox="0 0 24 24"><path d="M17 14h.5a4.5 4.5 0 1 0 0-9h-1.79A7 7 0 1 0 9 14h8z" fill="currentColor"/><path class="rain-drop drop-1" d="M10 16v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="rain-drop drop-2" d="M14 16v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }
  if (code <= 77) {
    return `<svg class="wi-svg wi-snowy" viewBox="0 0 24 24"><path d="M17 14h.5a4.5 4.5 0 1 0 0-9h-1.79A7 7 0 1 0 9 14h8z" fill="currentColor"/><circle class="snow-flake flake-1" cx="10" cy="17" r="1.2" fill="currentColor"/><circle class="snow-flake flake-2" cx="14" cy="17" r="1.2" fill="currentColor"/></svg>`;
  }
  if (code <= 82) {
    return `<svg class="wi-svg wi-rainy" viewBox="0 0 24 24"><path d="M17 14h.5a4.5 4.5 0 1 0 0-9h-1.79A7 7 0 1 0 9 14h8z" fill="currentColor"/><path class="rain-drop drop-1" d="M10 16v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="rain-drop drop-2" d="M14 16v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }
  if (code <= 86) {
    return `<svg class="wi-svg wi-snowy" viewBox="0 0 24 24"><path d="M17 14h.5a4.5 4.5 0 1 0 0-9h-1.79A7 7 0 1 0 9 14h8z" fill="currentColor"/><circle class="snow-flake flake-1" cx="10" cy="17" r="1.2" fill="currentColor"/><circle class="snow-flake flake-2" cx="14" cy="17" r="1.2" fill="currentColor"/></svg>`;
  }
  return `<svg class="wi-svg wi-thunder" viewBox="0 0 24 24"><path d="M17 14h.5a4.5 4.5 0 1 0 0-9h-1.79A7 7 0 1 0 9 14h8z" fill="currentColor"/><path class="lightning" d="M12 14l-2 3h3l-2 3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;
}

function weatherDesc(code) {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 55) return 'Drizzle';
  if (code <= 57) return 'Freezing drizzle';
  if (code <= 65) return 'Rain';
  if (code <= 67) return 'Freezing rain';
  if (code <= 75) return 'Snow';
  if (code <= 77) return 'Snow grains';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  return 'Thunderstorm + hail';
}

function renderWeatherWidget() {
  const el = document.getElementById('weatherWidget');
  if (!el) return;
  const w = S.weather;
  if (!w?.enabled) { el.style.display = 'none'; return; }
  el.style.display = '';

  const c = w.cache || {};
  if (c.temp == null) {
    el.innerHTML = `<div class="focus-today-label">${T('widget.weather')}</div><div class="focus-today-value">-</div>`;
    return;
  }

  const isF = (S.locale?.tempUnit ?? w.units) === 'imperial';
  const toF = v => Math.round(v * 9 / 5 + 32);
  const temp = isF ? toF(Math.round(c.temp)) : Math.round(c.temp);
  const unit = isF ? '°F' : '°C';
  const label = c.name || T('widget.weather');

  el.innerHTML = `<div class="focus-today-label">${label}</div><div class="focus-today-value">${weatherIcon(c.code)} ${temp}${unit}</div>`;
}

async function fetchWeatherData(force) {
  const w = S.weather;
  if (!w?.enabled) return;

  const CACHE_MS = 30 * 60 * 1000;
  const c = w.cache || {};
  if (!force && c.temp != null && Date.now() - (c.ts || 0) < CACHE_MS) {
    renderWeatherWidget();
    return;
  }

  try {
    let lat = w.lat, lon = w.lon;

    if (!lat || !lon) {
      if (w.city) {
        const geoLang = (window.I18N && I18N.lang) || 'en';
        const geo = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(w.city)}&count=1&language=${geoLang}&format=json`
        ).then(r => r.json());
        if (geo.results?.length) {
          const r = geo.results[0];
          lat = w.lat = r.latitude;
          lon = w.lon = r.longitude;
          if (!w.cache) w.cache = {};
          w.cache.name = r.name;
        }
      }
    }

    if (lat == null || lon == null) { renderWeatherWidget(); return; }

    const data = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&wind_speed_unit=kmh&timezone=auto`
    ).then(r => r.json());

    const cur = data.current;
    if (!w.cache) w.cache = {};
    Object.assign(w.cache, {
      temp: cur.temperature_2m,
      feels: cur.apparent_temperature,
      code: cur.weather_code,
      wind: cur.wind_speed_10m,
      ts: Date.now(),
      name: w.cache.name || w.city
    });

    saveState();
    renderWeatherWidget();
  } catch (e) {
    renderWeatherWidget();
  }
}

function showWeatherPopup() {
  document.querySelector('.weather-popup')?.remove();
  const w = S.weather;
  const c = w?.cache || {};

  const popup = document.createElement('div');
  popup.className = 'focus-stats-popup weather-popup';

  const isF = (S.locale?.tempUnit ?? w.units) === 'imperial';
  const toF = v => Math.round(v * 9 / 5 + 32);
  const fmt = v => isF ? `${toF(Math.round(v))}°F` : `${Math.round(v)}°C`;
  const name = c.name || w.city || 'Weather';

  const hdr = document.createElement('div');
  hdr.className = 'focus-stats-popup-header';
  const titleEl = document.createElement('span');
  titleEl.className = 'focus-stats-popup-title';
  titleEl.textContent = name;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'focus-stats-popup-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => popup.remove());
  hdr.appendChild(titleEl); hdr.appendChild(closeBtn);
  popup.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'weather-popup-body';

  if (c.temp == null) {
    body.innerHTML = `<div class="weather-popup-desc">${T('weather.loading')}</div>`;
  } else {
    const main = document.createElement('div');
    main.className = 'weather-popup-main';
    main.innerHTML = `
      <span class="weather-popup-icon">${weatherIcon(c.code)}</span>
      <div>
        <div class="weather-popup-temp">${fmt(c.temp)}</div>
        <div class="weather-popup-desc">${weatherDesc(c.code)}</div>
      </div>`;
    body.appendChild(main);

    const meta = document.createElement('div');
    meta.className = 'weather-popup-meta';
    meta.innerHTML = `<span>${T('weather.feels', { v: fmt(c.feels) })}</span><span>${T('weather.wind', { v: Math.round(c.wind) })}</span>`;
    body.appendChild(meta);

    const updated = document.createElement('div');
    updated.className = 'weather-popup-updated';
    updated.textContent = c.ts ? T('weather.updated', { time: new Date(c.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : '';
    body.appendChild(updated);
  }

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'weather-popup-refresh';
  refreshBtn.textContent = T('weather.refresh');
  refreshBtn.addEventListener('click', () => {
    S.weather.lat = null; S.weather.lon = null;
    if (S.weather.cache) S.weather.cache.ts = 0;
    popup.remove();
    fetchWeatherData(true).then(() => showWeatherPopup());
  });
  body.appendChild(refreshBtn);

  popup.appendChild(body);
  document.body.appendChild(popup);

  const el = document.getElementById('weatherWidget');
  const rect = el.getBoundingClientRect();
  popup.style.top = (rect.bottom + 8) + 'px';
  popup.style.right = (window.innerWidth - rect.right) + 'px';

  _outsideClose(popup, el);
}

function updateFocusStats() {
  const el = document.getElementById('focusStats');
  if (!el) return;
  const hasPom = S.boards && S.boards.some(b => b.type === 'pomodoro');
  el.style.display = hasPom ? '' : 'none';
  if (!hasPom) return;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const completedMins = (S.focusStats || []).filter(s => s.ts >= todayStart).reduce((a, s) => a + s.mins, 0);

  // Include in-progress AND paused work time (any elapsed seconds in current work phase)
  let inProgressSecs = 0;
  Object.entries(_pomodoroState).forEach(([boardId, ps]) => {
    if (ps.phase === 'work') {
      const b = S.boards.find(b => b.id === boardId);
      if (b) {
        const st = getPomSettings(b);
        inProgressSecs += Math.max(0, st.focus * 60 - ps.timeLeft);
      }
    }
  });

  const totalMins = Math.floor((completedMins * 60 + inProgressSecs) / 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  let val;
  if (!totalMins)  val = '0m';
  else if (h)      val = `${h}h ${m}m`;
  else             val = `${m}m`;

  el.innerHTML = `<div class="focus-today-label">${T('focus.today')}</div><div class="focus-today-value">${val}</div>`;
}

function showFocusStatsPopup() {
  document.querySelector('.focus-stats-popup')?.remove();
  const popup = document.createElement('div');
  popup.className = 'focus-stats-popup';

  const hdr = document.createElement('div');
  hdr.className = 'focus-stats-popup-header';
  const title = document.createElement('span');
  title.className = 'focus-stats-popup-title';
  title.textContent = T('focus.stats');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'focus-stats-popup-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => popup.remove());
  hdr.appendChild(title); hdr.appendChild(closeBtn);
  popup.appendChild(hdr);

  const toggle = document.createElement('div');
  toggle.className = 'focus-stats-toggle';
  const weekBtn  = document.createElement('button');
  weekBtn.className  = 'focus-stats-toggle-btn active';
  weekBtn.textContent = T('focus.week');
  const monthBtn = document.createElement('button');
  monthBtn.className = 'focus-stats-toggle-btn';
  monthBtn.textContent = T('focus.months');
  toggle.appendChild(weekBtn); toggle.appendChild(monthBtn);
  popup.appendChild(toggle);

  const chartEl = document.createElement('div');
  chartEl.className = 'focus-chart';
  popup.appendChild(chartEl);

  let view = 'week';
  const DAY_SHORT = T('cal.dayShort');
  const MON_SHORT = T('cal.monShort');
  const MAX_BAR_H = 78;
  const now = new Date();

  function renderChart() {
    chartEl.innerHTML = '';
    const data = view === 'week' ? getFocusByDay(7) : getFocusByMonth(6);
    const totalMins = data.reduce((a, d) => a + d.mins, 0);

    if (!totalMins) {
      const empty = document.createElement('div');
      empty.className = 'focus-chart-empty';
      empty.textContent = T('focus.none');
      chartEl.appendChild(empty);
      return;
    }

    const maxMins = Math.max(...data.map(d => d.mins));
    data.forEach((item, i) => {
      const isNow = view === 'week'
        ? i === data.length - 1
        : item.date.getMonth() === now.getMonth() && item.date.getFullYear() === now.getFullYear();

      const col = document.createElement('div');
      col.className = 'focus-chart-col' + (isNow ? ' today' : '');

      const topLabel = document.createElement('div');
      topLabel.className = 'focus-chart-top-label';
      if (item.mins) {
        const h = Math.floor(item.mins / 60);
        topLabel.textContent = h ? `${h}h` : `${item.mins}m`;
      }

      const track = document.createElement('div');
      track.className = 'focus-chart-track';
      const bar = document.createElement('div');
      bar.className = 'focus-chart-bar';
      bar.style.height = (item.mins ? Math.max(3, Math.round((item.mins / maxMins) * MAX_BAR_H)) : 0) + 'px';
      track.appendChild(bar);

      const label = document.createElement('div');
      label.className = 'focus-chart-label';
      label.textContent = view === 'week' ? DAY_SHORT[item.date.getDay()] : MON_SHORT[item.date.getMonth()];

      col.appendChild(topLabel); col.appendChild(track); col.appendChild(label);
      chartEl.appendChild(col);
    });
  }

  weekBtn.addEventListener('click', () => {
    view = 'week'; weekBtn.classList.add('active'); monthBtn.classList.remove('active'); renderChart();
  });
  monthBtn.addEventListener('click', () => {
    view = 'month'; monthBtn.classList.add('active'); weekBtn.classList.remove('active'); renderChart();
  });

  renderChart();
  // Keep chart up-to-date while popup is open
  const chartRefresh = setInterval(() => { if (document.contains(popup)) renderChart(); else clearInterval(chartRefresh); }, 5000);
  closeBtn.addEventListener('click', () => clearInterval(chartRefresh));

  document.body.appendChild(popup);

  const statsEl = document.getElementById('focusStats');
  const rect = statsEl.getBoundingClientRect();
  popup.style.top   = (rect.bottom + 8) + 'px';
  popup.style.right = (window.innerWidth - rect.right) + 'px';

  _outsideClose(popup, document.getElementById('focusStats'));
}

function getCompletedTodosByDay(days) {
  const now = new Date();
  const result = [];
  const allTodos = S.boards.filter(b => b.type === 'todolist').flatMap(b => b.todos || []);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const start = d.getTime();
    const end = start + 86400000;
    const count = allTodos.filter(t => t.done && t.completedAt >= start && t.completedAt < end).length;
    result.push({ date: d, count });
  }
  return result;
}

function getCompletedTodosByMonth(months) {
  const now = new Date();
  const result = [];
  const allTodos = S.boards.filter(b => b.type === 'todolist').flatMap(b => b.todos || []);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const count = allTodos.filter(t => t.done && t.completedAt >= d.getTime() && t.completedAt < end.getTime()).length;
    result.push({ date: d, count });
  }
  return result;
}

function updateTodoStatsWidget() {
  const el = document.getElementById('todoStatsWidget');
  if (!el) return;
  const hasTodo = S.boards && S.boards.some(b => b.type === 'todolist');
  el.style.display = hasTodo ? '' : 'none';
  if (!hasTodo) return;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const allTodos = S.boards.filter(b => b.type === 'todolist').flatMap(b => b.todos || []);
  
  const completedToday = allTodos.filter(t => t.done && t.completedAt >= todayStart).length;
  const pendingToday = allTodos.filter(t => !t.done).length;
  const totalToday = completedToday + pendingToday;

  el.innerHTML = `<div class="focus-today-label">TASKS TODAY</div><div class="focus-today-value">${completedToday} / ${totalToday}</div>`;
}

function showTodoStatsPopup() {
  document.querySelector('.todo-stats-popup')?.remove();
  const popup = document.createElement('div');
  popup.className = 'focus-stats-popup todo-stats-popup';

  const hdr = document.createElement('div');
  hdr.className = 'focus-stats-popup-header';
  const title = document.createElement('span');
  title.className = 'focus-stats-popup-title';
  title.textContent = 'Tasks Completed';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'focus-stats-popup-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => popup.remove());
  hdr.appendChild(title); hdr.appendChild(closeBtn);
  popup.appendChild(hdr);

  const toggle = document.createElement('div');
  toggle.className = 'focus-stats-toggle';
  const weekBtn  = document.createElement('button');
  weekBtn.className  = 'focus-stats-toggle-btn active';
  weekBtn.textContent = T('focus.week') || 'Week';
  const monthBtn = document.createElement('button');
  monthBtn.className = 'focus-stats-toggle-btn';
  monthBtn.textContent = T('focus.months') || 'Month';
  toggle.appendChild(weekBtn); toggle.appendChild(monthBtn);
  popup.appendChild(toggle);

  const chartEl = document.createElement('div');
  chartEl.className = 'focus-chart';
  popup.appendChild(chartEl);

  let view = 'week';
  const DAY_SHORT = T('cal.dayShort') || ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON_SHORT = T('cal.monShort') || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MAX_BAR_H = 78;
  const now = new Date();

  function renderChart() {
    chartEl.innerHTML = '';
    const data = view === 'week' ? getCompletedTodosByDay(7) : getCompletedTodosByMonth(6);
    const totalCount = data.reduce((a, d) => a + d.count, 0);

    if (!totalCount) {
      const empty = document.createElement('div');
      empty.className = 'focus-chart-empty';
      empty.textContent = 'No tasks completed';
      chartEl.appendChild(empty);
      return;
    }

    const maxCount = Math.max(...data.map(d => d.count));
    data.forEach((item, i) => {
      const isNow = view === 'week'
        ? i === data.length - 1
        : item.date.getMonth() === now.getMonth() && item.date.getFullYear() === now.getFullYear();

      const col = document.createElement('div');
      col.className = 'focus-chart-col' + (isNow ? ' today' : '');

      const topLabel = document.createElement('div');
      topLabel.className = 'focus-chart-top-label';
      if (item.count) {
        topLabel.textContent = `${item.count}`;
      }

      const track = document.createElement('div');
      track.className = 'focus-chart-track';
      const bar = document.createElement('div');
      bar.className = 'focus-chart-bar';
      bar.style.height = (item.count ? Math.max(3, Math.round((item.count / maxCount) * MAX_BAR_H)) : 0) + 'px';
      track.appendChild(bar);

      const label = document.createElement('div');
      label.className = 'focus-chart-label';
      label.textContent = view === 'week' ? DAY_SHORT[item.date.getDay()] : MON_SHORT[item.date.getMonth()];

      col.appendChild(topLabel); col.appendChild(track); col.appendChild(label);
      chartEl.appendChild(col);
    });
  }

  weekBtn.addEventListener('click', () => {
    view = 'week'; weekBtn.classList.add('active'); monthBtn.classList.remove('active'); renderChart();
  });
  monthBtn.addEventListener('click', () => {
    view = 'month'; monthBtn.classList.add('active'); weekBtn.classList.remove('active'); renderChart();
  });

  renderChart();

  const widgetEl = document.getElementById('todoStatsWidget');
  if (widgetEl) {
    document.body.appendChild(popup);
    const rect = widgetEl.getBoundingClientRect();
    popup.style.top = (rect.bottom + 8) + 'px';
    popup.style.right = (window.innerWidth - rect.right) + 'px';
    _outsideClose(popup, widgetEl);
  }
}

function showPomodoroSettings(boardId, anchor) {
  document.querySelector('.pom-settings-popup')?.remove();
  const board = S.boards.find(b => b.id === boardId);
  if (!board) return;
  const s = getPomSettings(board);
  const popup = document.createElement('div');
  popup.className = 'bk-edit-popup pom-settings-popup';

  function row(label, key, val) {
    const wrap = document.createElement('div');
    wrap.className = 'pom-setting-row';
    const lbl = document.createElement('span');
    lbl.className = 'pom-setting-label';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = 1; inp.max = 120;
    inp.className = 'add-link-input pom-setting-input';
    inp.value = val; inp.dataset.key = key;
    wrap.appendChild(lbl); wrap.appendChild(inp);
    popup.appendChild(wrap);
    return inp;
  }

  const focusInp = row(T('pom.focusMin'),  'focus', s.focus);
  const shortInp = row(T('pom.shortMin'),  'short', s.short);
  const longInp  = row(T('pom.longMin'),   'long',  s.long);
  const cycleInp = row(T('pom.longAfter'), 'cycle', s.cycle);

  _popupBtns(popup, () => popup.remove(), () => {
    const newS = {
      focus: Math.max(1, parseInt(focusInp.value)||25),
      short: Math.max(1, parseInt(shortInp.value)||5),
      long:  Math.max(1, parseInt(longInp.value)||15),
      cycle: Math.max(1, parseInt(cycleInp.value)||4)
    };
    board.pomSettings = newS;
    const ps = _pomodoroState[boardId];
    if (ps && !ps.running) {
      // Not running — reset to new focus time immediately
      ps.phase = 'work'; ps.viewPhase = 'work'; ps.timeLeft = newS.focus * 60;
    }
    // If running — current slot finishes with old duration, new settings apply next cycle
    saveState(); renderBoards();
    popup.remove();
  }, T('common.save'));

  _placePopup(popup, anchor);
  focusInp.focus(); focusInp.select();
  _outsideClose(popup);
}

function buildPomodoroBoard(board) {
  const el = document.createElement('div');
  el.className = 'board';
  el.dataset.id = board.id;
  const blurBg = document.createElement('div');
  blurBg.className = 'board-blur-bg';
  el.appendChild(blurBg);

  const settings = getPomSettings(board);
  const phases = {
    work:  { label: T('pom.focus'), mins: settings.focus },
    short: { label: T('pom.short'), mins: settings.short },
    long:  { label: T('pom.long'),  mins: settings.long  }
  };
  const ps = getPomState(board.id, settings.focus);

  // ── Header ──
  const hdr = document.createElement('div');
  hdr.className = 'board-header';
  const titleEl = document.createElement('span');
  titleEl.className = 'board-title';
  titleEl.textContent = board.name || T('pom.title');
  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'board-add-link-btn';
  settingsBtn.innerHTML = POM_GEAR;
  settingsBtn.title = T('side.settings');
  settingsBtn.addEventListener('click', e => { e.stopPropagation(); showPomodoroSettings(board.id, settingsBtn); });
  const menuBtn = document.createElement('button');
  menuBtn.className = 'board-menu-btn';
  menuBtn.textContent = '···';
  menuBtn.addEventListener('click', e => { e.stopPropagation(); showBoardMenu(board.id, menuBtn); });
  hdr.appendChild(titleEl); hdr.appendChild(settingsBtn); hdr.appendChild(menuBtn);
  el.appendChild(hdr);

  // ── Phase tabs ──
  const phasesEl = document.createElement('div');
  phasesEl.className = 'pom-phases';
  Object.entries(phases).forEach(([key, ph]) => {
    const btn = document.createElement('button');
    btn.className = 'pom-phase-btn' + (ps.viewPhase === key ? ' active' : '');
    btn.textContent = ph.label;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      ps.viewPhase = key;
      renderBoards();
    });
    phasesEl.appendChild(btn);
  });
  el.appendChild(phasesEl);

  // ── Timer ──
  const timerEl = document.createElement('div');
  timerEl.className = 'pom-timer';
  // Show viewPhase time: if viewing a different phase than running, show that phase's full duration
  timerEl.textContent = pomFmt(ps.viewPhase === ps.phase ? ps.timeLeft : phases[ps.viewPhase].mins * 60);
  el.appendChild(timerEl);

  // ── Session dots ──
  const cycle = settings.cycle;
  const dotsEl = document.createElement('div');
  dotsEl.className = 'pom-dots';
  for (let i = 0; i < cycle; i++) {
    const dot = document.createElement('span');
    dot.className = 'pom-dot' + (i < ps.sessions % cycle ? ' active' : '');
    dotsEl.appendChild(dot);
  }
  el.appendChild(dotsEl);

  // ── Controls ──
  const ctrlEl = document.createElement('div');
  ctrlEl.className = 'pom-controls';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'pom-ctrl-btn'; resetBtn.innerHTML = POM_RESET; resetBtn.title = T('tip.reset');

  const playBtn = document.createElement('button');
  playBtn.className = 'pom-ctrl-btn pom-play-btn';
  playBtn.innerHTML = ps.running ? POM_PAUSE : POM_PLAY;

  const skipBtn = document.createElement('button');
  skipBtn.className = 'pom-ctrl-btn'; skipBtn.innerHTML = POM_SKIP; skipBtn.title = T('tip.skip');

  function tick() {
    // Wall-clock based: accurate even when tab was inactive or page reloaded
    if (ps.startedAt != null) {
      const elapsed = Math.floor((Date.now() - ps.startedAt) / 1000);
      ps.timeLeft = Math.max(0, ps.startedTimeLeft - elapsed);
    } else {
      ps.timeLeft = Math.max(0, ps.timeLeft - 1);
    }
    if (ps.viewPhase === ps.phase) {
      const t = document.querySelector(`.board[data-id="${board.id}"] .pom-timer`);
      if (t) t.textContent = pomFmt(ps.timeLeft);
    }
    updateFocusStats();
    if (ps.timeLeft <= 0) {
      clearInterval(ps.interval); ps.interval = null; ps.running = false;
      ps.startedAt = null; ps.startedTimeLeft = null;
      playPomSound('end');
      if (ps.phase === 'work') {
        S.focusStats.push({ ts: Date.now(), mins: settings.focus });
        ps.sessions++;
        ps.phase = ps.sessions % cycle === 0 ? 'long' : 'short';
        triggerBrowserNotification('Work Session Done!', 'Time to take a break.');
      } else {
        ps.phase = 'work';
        triggerBrowserNotification('Break Done!', 'Time to focus again.');
      }
      ps.viewPhase = ps.phase;
      ps.timeLeft = phases[ps.phase].mins * 60;
      savePomTimer(board.id);
      renderBoards();
    }
  }

  // Auto-restart interval if timer was running when page was closed/refreshed
  if (ps.running && !ps.interval) {
    ps.interval = setInterval(tick, 1000);
  }

  playBtn.addEventListener('click', e => {
    e.stopPropagation();
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    if (ps.viewPhase !== ps.phase) {
      if (ps.interval) { clearInterval(ps.interval); ps.interval = null; }
      ps.phase = ps.viewPhase;
      ps.timeLeft = phases[ps.phase].mins * 60;
      ps.running = true;
      ps.startedAt = Date.now(); ps.startedTimeLeft = ps.timeLeft;
      ps.interval = setInterval(tick, 1000);
      playBtn.innerHTML = POM_PAUSE;
      playPomSound('start');
    } else if (ps.running) {
      clearInterval(ps.interval); ps.interval = null; ps.running = false;
      ps.startedAt = null; ps.startedTimeLeft = null;
      playBtn.innerHTML = POM_PLAY;
      updateFocusStats();
    } else {
      ps.running = true;
      ps.startedAt = Date.now(); ps.startedTimeLeft = ps.timeLeft;
      ps.interval = setInterval(tick, 1000);
      playBtn.innerHTML = POM_PAUSE;
      playPomSound('start');
    }
    if (ps.running) track('pomodoro_started', { phase: ps.phase });
    savePomTimer(board.id);
  });

  resetBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (ps.interval) { clearInterval(ps.interval); ps.interval = null; }

    // Сохраняем прошедшее рабочее время в статистику перед сбросом
    if (ps.phase === 'work') {
      const fullSecs = settings.focus * 60;
      const elapsedSecs = fullSecs - ps.timeLeft;
      if (elapsedSecs >= 60) {
        if (!S.focusStats) S.focusStats = [];
        S.focusStats.push({ ts: Date.now(), mins: Math.floor(elapsedSecs / 60) });
      }
    }

    ps.running = false; ps.startedAt = null; ps.startedTimeLeft = null;
    ps.phase = ps.viewPhase;
    ps.timeLeft = phases[ps.viewPhase].mins * 60;
    timerEl.textContent = pomFmt(ps.timeLeft);
    playBtn.innerHTML = POM_PLAY;
    savePomTimer(board.id);
    updateFocusStats();
  });

  skipBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (ps.interval) { clearInterval(ps.interval); ps.interval = null; }
    ps.startedAt = null; ps.startedTimeLeft = null;
    if (ps.phase === 'work') {
      const elapsedMins = Math.max(1, Math.round((settings.focus * 60 - ps.timeLeft) / 60));
      S.focusStats.push({ ts: Date.now(), mins: elapsedMins });
      ps.sessions++;
      ps.phase = ps.sessions % cycle === 0 ? 'long' : 'short';
    } else ps.phase = 'work';
    ps.viewPhase = ps.phase;
    ps.timeLeft = phases[ps.phase].mins * 60; ps.running = false;
    savePomTimer(board.id);
    renderBoards();
  });

  ctrlEl.appendChild(resetBtn); ctrlEl.appendChild(playBtn); ctrlEl.appendChild(skipBtn);
  el.appendChild(ctrlEl);

  // ── Drag ──
  el.addEventListener('mousedown', e => { if (e.target.closest('button')) return; el.draggable = true; });
  el.addEventListener('dragstart', e => {
    _dragId = board.id; e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', board.id);
    setTimeout(() => el.classList.add('is-dragging'), 0);
    activateColDropZones(board.col);
  });
  el.addEventListener('dragend', () => {
    el.draggable = false; el.classList.remove('is-dragging');
    document.querySelectorAll('.board.drop-before,.board.drop-after').forEach(b => b.classList.remove('drop-before','drop-after'));
    _dropTarget = null; deactivateColDropZones(); if (_dragId) { _dragId = null; renderBoards(); }
  });
  applyBoardStyle(el, board);
  el.addEventListener('dragover', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    const before = e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2;
    document.querySelectorAll('.board.drop-before,.board.drop-after').forEach(b => b.classList.remove('drop-before','drop-after'));
    el.classList.add(before ? 'drop-before' : 'drop-after');
    _dropTarget = { id: board.id, before };
  });
  el.addEventListener('dragleave', e => {
    if (_dragId && !el.contains(e.relatedTarget)) el.classList.remove('drop-before','drop-after');
  });
  el.addEventListener('drop', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('drop-before','drop-after');
    if (_dropTarget) insertBoardAt(_dragId, _dropTarget.id, _dropTarget.before);
    _dragId = null; _dropTarget = null;
  });

  return el;
}

function addBoard() {
  const { col, row } = findFreePosition();
  addBoardAt(col, row);
}

function addCalendar() {
  const { col, row } = findFreePosition();
  const board = { id: genId(), pageId: S.activePage, name: 'Calendar', type: 'calendar', col, row };
  const now = new Date();
  _calendarState[board.id] = { year: now.getFullYear(), month: now.getMonth() };
  S.boards.push(board);
  saveState(); renderBoards();
}

const SEARCH_ENGINES = [
  { id: 'default', name: T('search.defaultEngine'), url: null,                                   domain: null             },
  { id: 'google',  name: 'Google',          url: 'https://www.google.com/search?q=',             domain: 'google.com'     },
  { id: 'yandex',  name: 'Yandex',          url: 'https://yandex.ru/search/?text=',              domain: 'yandex.ru'      },
  { id: 'bing',    name: 'Bing',            url: 'https://www.bing.com/search?q=',               domain: 'bing.com'       },
  { id: 'ddg',     name: 'DuckDuckGo',      url: 'https://duckduckgo.com/?q=',                   domain: 'duckduckgo.com' },
  { id: 'youtube', name: 'YouTube',         url: 'https://www.youtube.com/results?search_query=',domain: 'youtube.com'    },
  { id: 'ecosia',  name: 'Ecosia',          url: 'https://www.ecosia.org/search?q=',             domain: 'ecosia.org'     },
];

function nsbFaviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

// Returns img or span element for engine icon
function nsbEngineIcon(eng, size) {
  size = size || 16;
  if (eng.id === 'default') {
    const wrap = document.createElement('span');
    wrap.style.cssText = `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;opacity:0.6;`;
    wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    return wrap;
  }
  const img = document.createElement('img');
  img.src = nsbFaviconUrl(eng.domain);
  img.width = size;
  img.height = size;
  img.style.cssText = `border-radius:${size <= 16 ? 3 : 4}px;display:block;flex-shrink:0;`;
  return img;
}

function nsbDoSearch(query) {
  const eng = SEARCH_ENGINES.find(e => e.id === (S.navSearchEngine || 'google')) || SEARCH_ENGINES[1];
  track('search_used', { source: 'navbar', engine: eng.id });
  if (eng.id === 'default') {
    chrome.search.query({ text: query, disposition: 'NEW_TAB' });
  } else {
    chrome.tabs.create({ url: eng.url + encodeURIComponent(query) });
  }
}

function addSearch() {
  const { col, row } = findFreePosition();
  const board = { id: genId(), pageId: S.activePage, name: 'Search', type: 'search', col, row, searchEngine: 'google' };
  S.boards.push(board);
  saveState(); renderBoards();
  setTimeout(() => {
    const el = document.querySelector(`.board[data-id="${board.id}"] .search-widget-input`);
    if (el) el.focus();
  }, 60);
}

function buildSearchBoard(board) {
  const el = document.createElement('div');
  el.className = 'board';
  el.dataset.id = board.id;
  const blurBg = document.createElement('div');
  blurBg.className = 'board-blur-bg';
  el.appendChild(blurBg);

  const hdr = document.createElement('div');
  hdr.className = 'board-header';
  const title = document.createElement('span');
  title.className = 'board-title';
  title.textContent = board.name;
  title.addEventListener('dblclick', e => { e.stopPropagation(); startBoardRename(board.id, title); });
  const menuBtn = document.createElement('button');
  menuBtn.className = 'board-menu-btn';
  menuBtn.textContent = '···';
  menuBtn.addEventListener('click', e => { e.stopPropagation(); showBoardMenu(board.id, menuBtn); });
  hdr.appendChild(title);
  hdr.appendChild(menuBtn);
  el.appendChild(hdr);

  // Search input row
  const inputWrap = document.createElement('div');
  inputWrap.className = 'search-widget-wrap';
  inputWrap.innerHTML = `<svg class="search-widget-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  const input = document.createElement('input');
  input.className = 'search-widget-input';
  input.type = 'text';
  input.placeholder = T('search.widgetPlaceholder');
  input.addEventListener('mousedown', e => e.stopPropagation());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      const engine = SEARCH_ENGINES.find(en => en.id === (board.searchEngine || 'google')) || SEARCH_ENGINES[1];
      track('search_used', { source: 'widget', engine: engine.id });
      chrome.tabs.create({ url: engine.url + encodeURIComponent(input.value.trim()) });
      input.value = '';
    }
  });
  inputWrap.appendChild(input);
  el.appendChild(inputWrap);

  // Engine selector (no 'default' option — board widget uses explicit URLs)
  const engines = document.createElement('div');
  engines.className = 'search-widget-engines';
  SEARCH_ENGINES.filter(e => e.id !== 'default').forEach(eng => {
    const btn = document.createElement('button');
    btn.className = 'search-engine-btn' + (eng.id === (board.searchEngine || 'google') ? ' active' : '');
    btn.textContent = eng.name;
    btn.title = eng.name;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      board.searchEngine = eng.id;
      saveState();
      engines.querySelectorAll('.search-engine-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    engines.appendChild(btn);
  });
  el.appendChild(engines);

  // Drag
  el.addEventListener('mousedown', e => {
    if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
    el.draggable = true;
  });
  el.addEventListener('dragstart', e => {
    _dragId = board.id; e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', board.id);
    setTimeout(() => el.classList.add('is-dragging'), 0);
    activateColDropZones(board.col);
  });
  el.addEventListener('dragend', () => {
    el.draggable = false; el.classList.remove('is-dragging');
    document.querySelectorAll('.board.drop-before,.board.drop-after')
      .forEach(b => b.classList.remove('drop-before','drop-after'));
    _dropTarget = null; deactivateColDropZones();
    if (_dragId) { _dragId = null; renderBoards(); }
  });
  el.addEventListener('dragover', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    const before = e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2;
    document.querySelectorAll('.board.drop-before,.board.drop-after')
      .forEach(b => b.classList.remove('drop-before','drop-after'));
    el.classList.add(before ? 'drop-before' : 'drop-after');
    _dropTarget = { id: board.id, before };
  });
  el.addEventListener('dragleave', e => {
    if (_dragId && !el.contains(e.relatedTarget)) el.classList.remove('drop-before','drop-after');
  });
  el.addEventListener('drop', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('drop-before','drop-after');
    if (_dropTarget) insertBoardAt(_dragId, _dropTarget.id, _dropTarget.before);
    _dragId = null; _dropTarget = null;
  });

  applyBoardStyle(el, board);
  return el;
}

function addNotes() {
  const { col, row } = findFreePosition();
  const board = { id: genId(), pageId: S.activePage, name: 'Notes', type: 'notes', col, row, noteContent: '' };
  S.boards.push(board);
  saveState(); renderBoards();
  setTimeout(() => {
    const el = document.querySelector(`.board[data-id="${board.id}"] .notes-textarea`);
    if (el) el.focus();
  }, 60);
}

function buildNotesBoard(board) {
  const el = document.createElement('div');
  el.className = 'board';
  el.dataset.id = board.id;
  const blurBg = document.createElement('div');
  blurBg.className = 'board-blur-bg';
  el.appendChild(blurBg);

  const hdr = document.createElement('div');
  hdr.className = 'board-header';

  const title = document.createElement('span');
  title.className = 'board-title';
  title.textContent = board.name;
  title.addEventListener('dblclick', e => { e.stopPropagation(); startBoardRename(board.id, title); });

  const menuBtn = document.createElement('button');
  menuBtn.className = 'board-menu-btn';
  menuBtn.textContent = '···';
  menuBtn.addEventListener('click', e => { e.stopPropagation(); showBoardMenu(board.id, menuBtn); });

  hdr.appendChild(title);
  hdr.appendChild(menuBtn);
  el.appendChild(hdr);

  const textarea = document.createElement('textarea');
  textarea.className = 'notes-textarea';
  textarea.placeholder = T('notes.placeholder');
  textarea.value = board.noteContent || '';
  textarea.spellcheck = false;
  if (board.noteHeight) textarea.style.height = board.noteHeight + 'px';

  let _saveTimer;
  textarea.addEventListener('input', () => {
    board.noteContent = textarea.value;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => saveState(), 600);
  });
  textarea.addEventListener('mousedown', e => e.stopPropagation());
  textarea.addEventListener('dragstart', e => e.preventDefault());

  el.appendChild(textarea);

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'notes-resize-handle';
  resizeHandle.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="6" r="1.2" fill="currentColor"/>
    <circle cx="10" cy="10" r="1.2" fill="currentColor"/>
    <circle cx="6" cy="10" r="1.2" fill="currentColor"/>
  </svg>`;
  resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const startY = e.clientY;
    const startH = textarea.offsetHeight;
    function onMove(ev) {
      const h = Math.max(60, startH + (ev.clientY - startY));
      textarea.style.height = h + 'px';
      board.noteHeight = h;
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveState();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  el.appendChild(resizeHandle);

  el.addEventListener('mousedown', e => {
    if (e.target.closest('button') || e.target.tagName === 'TEXTAREA') return;
    el.draggable = true;
  });
  el.addEventListener('dragstart', e => {
    _dragId = board.id; e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', board.id);
    setTimeout(() => el.classList.add('is-dragging'), 0);
    activateColDropZones(board.col);
  });
  el.addEventListener('dragend', () => {
    el.draggable = false; el.classList.remove('is-dragging');
    document.querySelectorAll('.board.drop-before,.board.drop-after')
      .forEach(b => b.classList.remove('drop-before','drop-after'));
    _dropTarget = null; deactivateColDropZones();
    if (_dragId) { _dragId = null; document.activeElement?.blur(); renderBoards(); }
  });
  el.addEventListener('dragover', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    const before = e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2;
    document.querySelectorAll('.board.drop-before,.board.drop-after')
      .forEach(b => b.classList.remove('drop-before','drop-after'));
    el.classList.add(before ? 'drop-before' : 'drop-after');
    _dropTarget = { id: board.id, before };
  });
  el.addEventListener('dragleave', e => {
    if (_dragId && !el.contains(e.relatedTarget)) el.classList.remove('drop-before','drop-after');
  });
  el.addEventListener('drop', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('drop-before','drop-after');
    if (_dropTarget) insertBoardAt(_dragId, _dropTarget.id, _dropTarget.before);
    _dragId = null; _dropTarget = null;
  });

  applyBoardStyle(el, board);
  return el;
}

function buildAiHubBoard(board) {
  const el = document.createElement('div');
  el.className = 'board';
  el.dataset.id = board.id;
  const blurBg = document.createElement('div');
  blurBg.className = 'board-blur-bg';
  el.appendChild(blurBg);

  const hdr = document.createElement('div');
  hdr.className = 'board-header';

  const title = document.createElement('span');
  title.className = 'board-title';
  title.textContent = board.title || 'NotebookLM & AI Hub';

  const menuBtn = document.createElement('button');
  menuBtn.className = 'board-menu-btn';
  menuBtn.textContent = '···';
  menuBtn.addEventListener('click', e => { e.stopPropagation(); showBoardMenu(board.id, menuBtn); });

  hdr.appendChild(title);
  hdr.appendChild(menuBtn);
  el.appendChild(hdr);

  const hubContainer = document.createElement('div');
  hubContainer.className = 'ai-smart-hub';
  hubContainer.innerHTML = `
    <textarea class="notes-textarea ai-hub-textarea" placeholder="Write prompt or study notes here..." spellcheck="false" style="height:80px; margin-bottom:10px;"></textarea>
    <div class="ai-hub-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:6px;">
      <button class="ai-hub-btn" data-url="https://notebooklm.google.com/" data-name="NotebookLM" style="display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:8px; border:1px solid rgba(0,0,0,0.1); background:rgba(255,255,255,0.7); cursor:pointer; font-size:11px; font-weight:600; color:#111;">
        <img src="https://www.google.com/s2/favicons?domain=notebooklm.google.com&sz=64" width="14" height="14"> NotebookLM
      </button>
      <button class="ai-hub-btn" data-url="https://claude.ai/new" data-name="Claude" style="display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:8px; border:1px solid rgba(0,0,0,0.1); background:rgba(255,255,255,0.7); cursor:pointer; font-size:11px; font-weight:600; color:#111;">
        <img src="https://www.google.com/s2/favicons?domain=claude.ai&sz=64" width="14" height="14"> Claude
      </button>
      <button class="ai-hub-btn" data-url="https://gemini.google.com/app" data-name="Gemini" style="display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:8px; border:1px solid rgba(0,0,0,0.1); background:rgba(255,255,255,0.7); cursor:pointer; font-size:11px; font-weight:600; color:#111;">
        <img src="https://www.google.com/s2/favicons?domain=gemini.google.com&sz=64" width="14" height="14"> Gemini
      </button>
      <button class="ai-hub-btn" data-url="https://chatgpt.com/" data-name="ChatGPT" style="display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:8px; border:1px solid rgba(0,0,0,0.1); background:rgba(255,255,255,0.7); cursor:pointer; font-size:11px; font-weight:600; color:#111;">
        <img src="https://www.google.com/s2/favicons?domain=chatgpt.com&sz=64" width="14" height="14"> ChatGPT
      </button>
    </div>
  `;

  hubContainer.querySelectorAll('.ai-hub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const txt = hubContainer.querySelector('.ai-hub-textarea');
      const text = txt ? txt.value.trim() : '';
      const url = btn.dataset.url;
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          window.open(url, '_blank');
        }).catch(() => window.open(url, '_blank'));
      } else {
        window.open(url, '_blank');
      }
    });
  });

  el.appendChild(hubContainer);
  applyBoardStyle(el, board);
  return el;
}



function buildStreakBoard(board) {
  const el = document.createElement('div');
  el.className = 'board';
  el.dataset.id = board.id;
  const blurBg = document.createElement('div');
  blurBg.className = 'board-blur-bg';
  el.appendChild(blurBg);

  const hdr = document.createElement('div');
  hdr.className = 'board-header';

  const title = document.createElement('span');
  title.className = 'board-title';
  title.textContent = board.title || 'Daily 5h Study Streak 🔥';

  const menuBtn = document.createElement('button');
  menuBtn.className = 'board-menu-btn';
  menuBtn.textContent = '···';
  menuBtn.addEventListener('click', e => { e.stopPropagation(); showBoardMenu(board.id, menuBtn); });

  hdr.appendChild(title);
  hdr.appendChild(menuBtn);
  el.appendChild(hdr);

  if (board.minsDone === undefined) board.minsDone = 0;
  if (board.streakDays === undefined) board.streakDays = 1;

  const targetMins = 300;
  const pct = Math.min(100, Math.round((board.minsDone / targetMins) * 100));
  const hrsDone = (board.minsDone / 60).toFixed(1);

  const container = document.createElement('div');
  container.className = 'streak-board-content';
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <span style="font-size:13px; font-weight:600; color:#111;">🔥 ${board.streakDays} KUNLIK STREAK</span>
      <span style="font-size:12px; font-weight:600; color:#740d1c;">${hrsDone} / 5.0 soat (${pct}%)</span>
    </div>
    <div class="streak-progress-bar" style="width:100%; height:10px; background:rgba(0,0,0,0.1); border-radius:5px; overflow:hidden; margin-bottom:12px;">
      <div class="streak-progress-fill" style="width:${pct}%; height:100%; background:linear-gradient(90deg, #e07a4a, #740d1c); transition:width 0.3s;"></div>
    </div>
    <div class="streak-btns" style="display:flex; gap:6px;">
      <button class="streak-add-btn" data-add="30" style="flex:1; padding:6px; border-radius:8px; border:none; background:rgba(255,255,255,0.7); border:1px solid rgba(0,0,0,0.1); cursor:pointer; font-size:11px; font-weight:600; color:#111;">+30 daqiqa</button>
      <button class="streak-add-btn" data-add="60" style="flex:1; padding:6px; border-radius:8px; border:none; background:rgba(255,255,255,0.7); border:1px solid rgba(0,0,0,0.1); cursor:pointer; font-size:11px; font-weight:600; color:#111;">+1 soat</button>
      <button class="streak-reset-btn" style="padding:6px 10px; border-radius:8px; border:none; background:rgba(0,0,0,0.06); cursor:pointer; font-size:11px; font-weight:600; color:#555;">🔄</button>
    </div>
  `;

  container.querySelectorAll('.streak-add-btn').forEach(b => {
    b.addEventListener('click', () => {
      const add = parseInt(b.dataset.add, 10);
      board.minsDone = Math.min(300, board.minsDone + add);
      if (board.minsDone >= 300 && !board.completedToday) {
        board.completedToday = true;
        board.streakDays += 1;
        alert("🔥 TABRIKLAYMIZ! Bugungi 5 soatlik dars rejasini bajardingiz! Streak o'sdi!");
      }
      saveState();
      renderBoards();
    });
  });

  container.querySelector('.streak-reset-btn')?.addEventListener('click', () => {
    if (confirm("Bugungi statistikani qayta boshlaysizmi?")) {
      board.minsDone = 0;
      board.completedToday = false;
      saveState();
      renderBoards();
    }
  });

  el.appendChild(container);
  applyBoardStyle(el, board);
  return el;
}

function formatCurrencyValue(rate, target) {
  if (rate >= 100) {
    return `${Math.round(rate).toLocaleString()} ${target}`;
  } else if (rate >= 1) {
    return `${rate.toFixed(2)} ${target}`;
  } else {
    return `${rate.toFixed(4)} ${target}`;
  }
}

function fetchCurrencyRate() {
  const el = document.getElementById('currencyValue');
  const labelEl = document.getElementById('currencyLabel');
  const base = S.currencyBase || 'USD';
  const target = S.currencyTarget || 'UZS';
  if (labelEl) {
    labelEl.textContent = `${base} / ${target}`;
  }

  // 1. Immediately apply cached value (stale-while-revalidate)
  const cacheKey = `rate-cache-${base}-${target}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached && el) {
    el.textContent = formatCurrencyValue(parseFloat(cached), target);
  }

  // 2. Fetch fresh data
  fetch(`https://open.er-api.com/v6/latest/${base}`)
    .then(r => r.json())
    .then(data => {
      if (data && data.result === 'success' && data.rates && data.rates[target] !== undefined) {
        const rate = data.rates[target];
        localStorage.setItem(cacheKey, String(rate));
        if (el) {
          el.textContent = formatCurrencyValue(rate, target);
        }
      }
    })
    .catch(() => {});
}

function renderCurrencyWidget() {
  const el = document.getElementById('currencyWidget');
  if (!el) return;
  el.style.display = S.currencyEnabled ? '' : 'none';
}
fetchCurrencyRate();
renderCurrencyWidget();

function addTodoList() {
  const { col, row } = findFreePosition();
  const board = { id: genId(), pageId: S.activePage, name: 'Todo', title: 'Todo', type: 'todolist', col, row, todos: [] };
  S.boards.push(board);
  saveState(); renderBoards();
}

function buildTodoListBoard(board) {
  const el = document.createElement('div');
  el.className = 'board';
  el.dataset.id = board.id;
  const blurBg = document.createElement('div');
  blurBg.className = 'board-blur-bg';
  el.appendChild(blurBg);

  const hdr = document.createElement('div');
  hdr.className = 'board-header';

  const title = document.createElement('span');
  title.className = 'board-title';
  title.textContent = board.name || board.title || 'Tasks';
  title.addEventListener('dblclick', e => { e.stopPropagation(); startBoardRename(board.id, title); });

  const menuBtn = document.createElement('button');
  menuBtn.className = 'board-menu-btn';
  menuBtn.textContent = '···';
  menuBtn.addEventListener('click', e => { e.stopPropagation(); showBoardMenu(board.id, menuBtn); });

  hdr.appendChild(title);
  hdr.appendChild(menuBtn);
  el.appendChild(hdr);

  if (!board.todos) {
    board.todos = [];
  } else {
    board.todos = board.todos.filter(t => t.id !== 't1' && t.id !== 't2' && t.id !== 't3');
  }

  const container = document.createElement('div');
  container.className = 'todo-board-content';

  function showTodoItemMenu(idx, anchorBtn) {
    closeMenu();
    const { menu, item } = createMenu();
    item('O\'chirish', MENU_ICONS.trash, 'danger', () => {
      board.todos.splice(idx, 1);
      saveState();
      renderTodos();
    });
    document.body.appendChild(menu);
    _menu = menu;
    const r = anchorBtn.getBoundingClientRect();
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 12) + 'px';
    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
  }

  function renderTodos() {
    const doneCount = board.todos.filter(t => t.done).length;
    const pct = board.todos.length > 0 ? Math.round((doneCount / board.todos.length) * 100) : 0;
    const listH = board.listHeight || 180;
    let html = `
      <div class="todo-stats-bar">
        <div class="todo-progress-container">
          <svg class="todo-progress-svg" viewBox="0 0 36 36">
            <path class="todo-progress-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path class="todo-progress-fill" stroke-dasharray="${pct}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
          <span class="todo-progress-text">${pct}%</span>
        </div>
        <span class="todo-stats-text">${doneCount} / ${board.todos.length} bajarildi</span>
      </div>
      <div class="todo-list-items" style="max-height:${listH}px;">
    `;
    board.todos.forEach((t, idx) => {
      html += `
        <div class="todo-item${t.done ? ' done' : ''}">
          <div class="todo-label">
            <input type="checkbox" class="todo-check" data-idx="${idx}" ${t.done ? 'checked' : ''}>
            <span class="todo-text">${t.text}</span>
          </div>
          <button class="todo-item-menu-btn" data-idx="${idx}" title="Sozlamalar">···</button>
        </div>
      `;
    });
    html += `</div>`;
    html += `
      <div class="todo-input-row">
        <input type="text" class="todo-input" placeholder="+ Yangi vazifa...">
        <button class="todo-add-btn">Qo'shish</button>
      </div>
    `;
    container.innerHTML = html;

    container.querySelectorAll('.todo-check').forEach(chk => {
      chk.addEventListener('change', () => {
        const idx = parseInt(chk.dataset.idx, 10);
        board.todos[idx].done = chk.checked;
        board.todos[idx].completedAt = chk.checked ? Date.now() : null;
        saveState();
        renderTodos();
      });
    });

    container.querySelectorAll('.todo-text').forEach(textSpan => {
      textSpan.addEventListener('dblclick', e => {
        e.stopPropagation();
        const chk = textSpan.previousElementSibling;
        if (!chk) return;
        const idx = parseInt(chk.dataset.idx, 10);
        const currentText = board.todos[idx].text;
        
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'todo-input';
        input.style.cssText = 'padding: 2px 6px; font-size: 12.5px; height: auto; flex: 1; margin: 0;';
        input.value = currentText;
        textSpan.replaceWith(input);
        input.focus();
        input.select();
        
        let done = false;
        function commit() {
          if (done) return;
          done = true;
          const val = input.value.trim();
          if (val) {
            board.todos[idx].text = val;
            saveState();
          }
          renderTodos();
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') commit();
          if (ev.key === 'Escape') {
            done = true;
            renderTodos();
          }
        });
      });
    });

    container.querySelectorAll('.todo-item-menu-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        showTodoItemMenu(idx, btn);
      });
    });

    const inp = container.querySelector('.todo-input');
    const addBtn = container.querySelector('.todo-add-btn');

    function addTask() {
      const txt = inp.value.trim();
      if (!txt) return;
      board.todos.push({ id: '_' + Math.random().toString(36).slice(2,8), text: txt, done: false });
      saveState();
      renderTodos();
    }

    addBtn?.addEventListener('click', addTask);
    inp?.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
    updateTodoStatsWidget();
  }

  renderTodos();
  el.appendChild(container);

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'notes-resize-handle';
  resizeHandle.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="6" r="1.2" fill="currentColor"/>
    <circle cx="10" cy="10" r="1.2" fill="currentColor"/>
    <circle cx="6" cy="10" r="1.2" fill="currentColor"/>
  </svg>`;
  resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const startY = e.clientY;
    const itemsList = container.querySelector('.todo-list-items');
    const startH = itemsList ? itemsList.offsetHeight : 180;
    function onMove(ev) {
      const h = Math.max(80, startH + (ev.clientY - startY));
      if (itemsList) itemsList.style.maxHeight = h + 'px';
      board.listHeight = h;
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveState();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  el.appendChild(resizeHandle);

  el.addEventListener('mousedown', e => {
    if (e.target.closest('button') || e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL' || e.target.closest('.notes-resize-handle')) return;
    el.draggable = true;
  });
  el.addEventListener('dragstart', e => {
    _dragId = board.id; e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', board.id);
    setTimeout(() => el.classList.add('is-dragging'), 0);
    activateColDropZones(board.col);
  });
  el.addEventListener('dragend', () => {
    el.draggable = false; el.classList.remove('is-dragging');
    document.querySelectorAll('.board.drop-before,.board.drop-after')
      .forEach(b => b.classList.remove('drop-before','drop-after'));
    _dropTarget = null; deactivateColDropZones();
    if (_dragId) { _dragId = null; document.activeElement?.blur(); renderBoards(); }
  });
  el.addEventListener('dragover', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    const before = e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2;
    document.querySelectorAll('.board.drop-before,.board.drop-after')
      .forEach(b => b.classList.remove('drop-before','drop-after'));
    el.classList.add(before ? 'drop-before' : 'drop-after');
    _dropTarget = { id: board.id, before };
  });
  el.addEventListener('dragleave', e => {
    if (_dragId && !el.contains(e.relatedTarget)) el.classList.remove('drop-before','drop-after');
  });
  el.addEventListener('drop', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('drop-before','drop-after');
    if (_dropTarget) insertBoardAt(_dragId, _dropTarget.id, _dropTarget.before);
    _dragId = null; _dropTarget = null;
  });

  applyBoardStyle(el, board);
  return el;
}

const CAL_MONTHS = (window.I18N ? I18N.t('cal.months') : ['January','February','March','April','May','June','July','August','September','October','November','December']);

function buildCalendarBoard(board) {
  const el = document.createElement('div');
  el.className = 'board';
  el.dataset.id = board.id;
  const blurBg = document.createElement('div');
  blurBg.className = 'board-blur-bg';
  el.appendChild(blurBg);

  if (!_calendarState[board.id]) {
    const now = new Date();
    _calendarState[board.id] = { year: now.getFullYear(), month: now.getMonth() };
  }
  const cs = _calendarState[board.id];

  // ── Header ──
  const hdr = document.createElement('div');
  hdr.className = 'board-header';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'cal-nav-btn';
  prevBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  prevBtn.addEventListener('click', e => {
    e.stopPropagation();
    cs.month--; if (cs.month < 0) { cs.month = 11; cs.year--; }
    renderBoards();
  });

  const titleEl = document.createElement('span');
  titleEl.className = 'board-title';
  titleEl.textContent = CAL_MONTHS[cs.month] + ' ' + cs.year;

  const nextBtn = document.createElement('button');
  nextBtn.className = 'cal-nav-btn';
  nextBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  nextBtn.addEventListener('click', e => {
    e.stopPropagation();
    cs.month++; if (cs.month > 11) { cs.month = 0; cs.year++; }
    renderBoards();
  });

  const menuBtn = document.createElement('button');
  menuBtn.className = 'board-menu-btn';
  menuBtn.textContent = '···';
  menuBtn.addEventListener('click', e => { e.stopPropagation(); showBoardMenu(board.id, menuBtn); });

  hdr.appendChild(prevBtn);
  hdr.appendChild(titleEl);
  hdr.appendChild(nextBtn);
  hdr.appendChild(menuBtn);
  el.appendChild(hdr);

  // ── Day names row ──
  const _wkStart = S.locale?.weekStart ?? 1; // 0=Sun, 1=Mon
  const _ds = T('cal.dayShort'); // Sunday-first
  const CAL_DAYS = _wkStart === 0 ? _ds.slice() : [..._ds.slice(1), _ds[0]];
  const daysRow = document.createElement('div');
  daysRow.className = 'cal-days-row';
  CAL_DAYS.forEach(d => {
    const s = document.createElement('span');
    s.className = 'cal-day-name';
    s.textContent = d;
    daysRow.appendChild(s);
  });
  el.appendChild(daysRow);

  // ── Day grid ──
  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  const today = new Date();
  const firstDow = new Date(cs.year, cs.month, 1).getDay(); // 0=Sun
  const startOffset = _wkStart === 0 ? firstDow : (firstDow === 0 ? 6 : firstDow - 1);
  const daysInMonth = new Date(cs.year, cs.month + 1, 0).getDate();

  for (let i = 0; i < startOffset; i++) {
    const blank = document.createElement('span');
    blank.className = 'cal-day cal-day-blank';
    grid.appendChild(blank);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('span');
    cell.className = 'cal-day';
    const dow = (startOffset + d - 1) % 7;
    const isWeekend = _wkStart === 0 ? (dow === 0 || dow === 6) : dow >= 5;
    if (isWeekend) cell.classList.add('cal-day-weekend');
    if (d === today.getDate() && cs.month === today.getMonth() && cs.year === today.getFullYear())
      cell.classList.add('cal-day-today');
    const numEl = document.createElement('span');
    numEl.className = 'cal-day-num';
    numEl.textContent = d;
    cell.appendChild(numEl);
    const dayEvents = (cs.events || []).filter(ev => ev.date === d);
    if (dayEvents.length) {
      const dots = document.createElement('span');
      dots.className = 'cal-event-dots';
      dayEvents.slice(0, 3).forEach(ev => {
        const dot = document.createElement('span');
        dot.className = 'cal-event-dot';
        if (ev.color) dot.style.background = ev.color;
        dots.appendChild(dot);
      });
      cell.appendChild(dots);
    }
    grid.appendChild(cell);
  }
  el.appendChild(grid);

  // ── Drag (same as buildBoard) ──
  el.addEventListener('mousedown', e => { if (e.target.closest('button')) return; el.draggable = true; });
  el.addEventListener('dragstart', e => {
    _dragId = board.id; e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', board.id);
    setTimeout(() => el.classList.add('is-dragging'), 0);
    activateColDropZones(board.col);
  });
  el.addEventListener('dragend', () => {
    el.draggable = false; el.classList.remove('is-dragging');
    document.querySelectorAll('.board.drop-before,.board.drop-after')
      .forEach(b => b.classList.remove('drop-before','drop-after'));
    _dropTarget = null; deactivateColDropZones();
    if (_dragId) { _dragId = null; renderBoards(); }
  });
  el.addEventListener('dragover', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    const before = e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2;
    document.querySelectorAll('.board.drop-before,.board.drop-after')
      .forEach(b => b.classList.remove('drop-before','drop-after'));
    el.classList.add(before ? 'drop-before' : 'drop-after');
    _dropTarget = { id: board.id, before };
  });
  el.addEventListener('dragleave', e => {
    if (_dragId && !el.contains(e.relatedTarget)) el.classList.remove('drop-before','drop-after');
  });
  el.addEventListener('drop', e => {
    if (!_dragId || _dragId === board.id) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('drop-before','drop-after');
    if (_dropTarget) insertBoardAt(_dragId, _dropTarget.id, _dropTarget.before);
    _dragId = null; _dropTarget = null;
  });

  applyBoardStyle(el, board);
  return el;
}

function deleteBoard(boardId) {
  const board = S.boards.find(b => b.id === boardId);
  if (!board) return;
  if (_pomodoroState[boardId]?.interval) { clearInterval(_pomodoroState[boardId].interval); }
  delete _pomodoroState[boardId];
  const isWidget = board.type === 'calendar' || board.type === 'pomodoro' || board.type === 'notes' || board.type === 'search';
  const hasLinks = S.bookmarks.some(bk => bk.boardId === boardId);
  if (!isWidget && hasLinks) {
    const now = Date.now();
    S.trash.boards.push({ ...board, deletedAt: now });
    S.bookmarks.filter(bk => bk.boardId === boardId).forEach(bk =>
      S.trash.bookmarks.push({ ...bk, deletedAt: now })
    );
  }
  S.boards = S.boards.filter(b => b.id !== boardId);
  S.bookmarks = S.bookmarks.filter(bk => bk.boardId !== boardId);
  saveState(); renderBoards();
  updateTodoStatsWidget();
}

function addBookmark(boardId, url, title, description) {
  if (!hasFullAccess()) {
    const nonDemo = S.bookmarks.filter(bk => !bk.isDemo).length;
    if (nonDemo >= 30) {
      showLimitHint(T('limit.bookmarks'));
      return;
    }
  }
  const count = S.bookmarks.filter(bk => bk.boardId === boardId).length;
  const bk = { id: genId(), boardId, url, title, order: count };
  if (description) bk.description = description;
  S.bookmarks.push(bk);
  track('bookmark_added', { total_bookmarks: S.bookmarks.length });
  trackOnce('mz-ga-activated', 'activated_user', { via: 'bookmark' });
  saveState(); renderBoards();
}

function deleteBookmark(bkId) {
  const bk = S.bookmarks.find(b => b.id === bkId);
  if (!bk) return;
  S.trash.bookmarks.push({ ...bk, deletedAt: Date.now() });
  S.bookmarks = S.bookmarks.filter(b => b.id !== bkId);
  saveState(); renderBoards();
}


document.getElementById('addBoardFab').addEventListener('click', addBoard);
document.getElementById('focusStats').addEventListener('click', () => {
  const existing = document.querySelector('.focus-stats-popup');
  if (existing) existing.remove();
  else showFocusStatsPopup();
});
document.getElementById('todoStatsWidget').addEventListener('click', () => {
  const existing = document.querySelector('.todo-stats-popup');
  if (existing) existing.remove();
  else showTodoStatsPopup();
});

const sidebar = document.getElementById('sidebar');
function openSidebar() { sidebar.classList.add('is-open'); }
function closeSidebar() { sidebar.classList.remove('is-open'); }
function closeAll() {
  closeSidebar();
  document.getElementById('widgetGallery').classList.remove('open');
}

document.getElementById('menuSideBtn').addEventListener('click', e => {
  e.stopPropagation();
  sidebar.classList.contains('is-open') ? closeSidebar() : openSidebar();
});
document.addEventListener('click', e => {
  if (sidebar.classList.contains('is-open') && !sidebar.contains(e.target)) closeSidebar();
});

document.getElementById('searchSideBtn').addEventListener('click', () => { closeSidebar(); openSearch(); });
document.getElementById('mpWallpaper').addEventListener('click', e => {
  e.stopPropagation();
  closeSidebar(); openWallpaperModal();
});

document.getElementById('mpWidgets').addEventListener('click', e => {
  e.stopPropagation();
  const gallery = document.getElementById('widgetGallery');
  const opening = !gallery.classList.contains('open');
  gallery.classList.toggle('open', opening);
});
document.getElementById('mpImport').addEventListener('click', () => {
  if (!hasFullAccess()) { closeSidebar(); showLimitHint(T('limit.import')); return; }
  closeSidebar(); openImportModal();
});
document.getElementById('mpTrash')?.addEventListener('click', () => { closeSidebar(); openTrash(); });

document.addEventListener('click', e => {
  const wg = document.getElementById('widgetGallery');
  if (wg.classList.contains('open') && !wg.contains(e.target) && !document.getElementById('mpWidgets').contains(e.target))
    wg.classList.remove('open');
});
document.getElementById('wcBoard')?.querySelector('.widget-add-btn')?.addEventListener('click', () => {
  addBoard();
  document.getElementById('widgetGallery')?.classList.remove('open');
});

document.getElementById('wcNotes')?.querySelector('.widget-add-btn')?.addEventListener('click', () => {
  addNotes();
  document.getElementById('widgetGallery')?.classList.remove('open');
});
document.getElementById('wcTodoList')?.querySelector('.widget-add-btn')?.addEventListener('click', () => {
  addTodoList();
  document.getElementById('widgetGallery')?.classList.remove('open');
});
document.getElementById('wcCalendar')?.querySelector('.widget-add-btn')?.addEventListener('click', () => {
  addCalendar();
  document.getElementById('widgetGallery')?.classList.remove('open');
});
document.getElementById('wcPomodoro')?.querySelector('.widget-add-btn')?.addEventListener('click', () => {
  addPomodoro();
  document.getElementById('widgetGallery')?.classList.remove('open');
});

// ── Weather card in widget gallery ──
function syncWeatherCard() {
  const toggle = document.getElementById('weatherToggle');
  const config = document.getElementById('weatherCardConfig');
  const cityInput = document.getElementById('weatherCityInput');
  if (!toggle) return;
  const enabled = !!S.weather?.enabled;
  toggle.classList.toggle('on', enabled);
  config.style.display = enabled ? '' : 'none';
  cityInput.value = S.weather?.city || '';
  _wcHideSuggest();
}

document.getElementById('weatherToggle').addEventListener('click', () => {
  S.weather.enabled = !S.weather.enabled;
  if (S.weather.enabled) track('weather_set');
  saveState();
  syncWeatherCard();
  renderWeatherWidget();
  if (S.weather.enabled && S.weather.cache?.temp == null) fetchWeatherData();
});

document.getElementById('weatherCityApply').addEventListener('click', () => {
  const v = document.getElementById('weatherCityInput').value.trim();
  if (!v) return;
  _wcHideSuggest();
  S.weather.city = v;
  S.weather.lat = null; S.weather.lon = null;
  if (S.weather.cache) S.weather.cache.ts = 0;
  track('weather_set');
  saveState();
  fetchWeatherData(true);
});

// ── City autocomplete ──
// As the user types we query Open-Meteo geocoding (up to 5 hits) in the current
// UI language, so Cyrillic / any-language names resolve. Picking a suggestion
// stores lat/lon directly, so we never depend on re-geocoding a raw string.
let _wcTimer = null;
let _wcSeq = 0;      // guards against out-of-order responses
let _wcResults = []; // current suggestions
let _wcActive = -1;  // highlighted index for keyboard nav

function _wcHideSuggest() {
  const box = document.getElementById('weatherCitySuggest');
  if (box) { box.style.display = 'none'; if (box.replaceChildren) box.replaceChildren(); else box.innerHTML = ''; }
  _wcResults = []; _wcActive = -1;
}

function _wcRenderSuggest(results) {
  const box = document.getElementById('weatherCitySuggest');
  if (!box) return;
  _wcResults = results; _wcActive = -1;
  if (box.replaceChildren) box.replaceChildren(); else box.innerHTML = '';
  if (!results.length) { box.style.display = 'none'; return; }
  results.forEach((r, i) => {
    const li = document.createElement('li');
    li.textContent = r.name;
    const parts = [r.admin1, r.country].filter(Boolean).join(', ');
    if (parts) {
      const sub = document.createElement('span');
      sub.className = 'wcs-sub';
      sub.textContent = '  ' + parts;
      li.appendChild(sub);
    }
    // mousedown (not click) so it fires before the input's blur hides the list.
    li.addEventListener('mousedown', e => { e.preventDefault(); _wcPick(i); });
    box.appendChild(li);
  });
  box.style.display = '';
}

function _wcHighlight(idx) {
  const box = document.getElementById('weatherCitySuggest');
  if (!box) return;
  const items = box.querySelectorAll('li');
  if (!items.length) return;
  _wcActive = (idx + items.length) % items.length;
  items.forEach((li, i) => li.classList.toggle('active', i === _wcActive));
}

function _wcPick(i) {
  const r = _wcResults[i];
  if (!r) return;
  document.getElementById('weatherCityInput').value = r.name;
  S.weather.city = r.name;
  S.weather.lat = r.latitude;
  S.weather.lon = r.longitude;
  if (!S.weather.cache) S.weather.cache = {};
  S.weather.cache.name = r.name;
  S.weather.cache.ts = 0;
  _wcHideSuggest();
  track('weather_set');
  saveState();
  fetchWeatherData(true);
}

async function _wcQuery(q) {
  const seq = ++_wcSeq;
  const lang = (window.I18N && I18N.lang) || 'en';
  let results = [];
  try {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=${lang}&format=json`
    ).then(r => r.json());
    results = (geo.results || []).slice(0, 5);
  } catch (e) { results = []; }
  if (seq !== _wcSeq) return; // a newer keystroke already fired
  _wcRenderSuggest(results);
}

document.getElementById('weatherCityInput').addEventListener('input', e => {
  const q = e.target.value.trim();
  clearTimeout(_wcTimer);
  if (q.length < 2) { _wcHideSuggest(); return; }
  _wcTimer = setTimeout(() => _wcQuery(q), 250);
});

document.getElementById('weatherCityInput').addEventListener('keydown', e => {
  const open = _wcResults.length > 0;
  if (e.key === 'ArrowDown' && open) { e.preventDefault(); _wcHighlight(_wcActive + 1); }
  else if (e.key === 'ArrowUp' && open) { e.preventDefault(); _wcHighlight(_wcActive - 1); }
  else if (e.key === 'Escape') { _wcHideSuggest(); }
  else if (e.key === 'Enter') {
    if (open && _wcActive >= 0) { e.preventDefault(); _wcPick(_wcActive); }
    else document.getElementById('weatherCityApply').click();
  }
});

document.getElementById('weatherCityInput').addEventListener('blur', () => {
  setTimeout(_wcHideSuggest, 120); // let a suggestion mousedown land first
});

document.getElementById('mpWidgets').addEventListener('click', syncWeatherCard, { capture: true });

// ── Nav search toggle in widget gallery ──
function syncNavSearchCard() {
  const toggle = document.getElementById('navSearchToggle');
  if (!toggle) return;
  toggle.classList.toggle('on', !!S.navSearchEnabled);
}

document.getElementById('navSearchToggle').addEventListener('click', () => {
  S.navSearchEnabled = !S.navSearchEnabled;
  saveState();
  syncNavSearchCard();
  renderNavSearch();
  requestAnimationFrame(syncLayout);
});

document.getElementById('mpWidgets').addEventListener('click', syncNavSearchCard, { capture: true });

// ── Clock toggle in widget gallery ──
function syncClockCard() {
  const toggle = document.getElementById('clockToggle');
  if (!toggle) return;
  toggle.classList.toggle('on', !!S.clockEnabled);
}

document.getElementById('clockToggle').addEventListener('click', () => {
  S.clockEnabled = !S.clockEnabled;
  saveState();
  syncClockCard();
  renderClockWidget();
});

document.getElementById('mpWidgets').addEventListener('click', syncClockCard, { capture: true });

// ── Currency toggle in widget gallery ──
function syncCurrencyCard() {
  const toggle = document.getElementById('currencyToggle');
  const config = document.getElementById('currencyCardConfig');
  const baseSelect = document.getElementById('currencyBaseSelect');
  const targetSelect = document.getElementById('currencyTargetSelect');
  if (!toggle) return;
  const enabled = !!S.currencyEnabled;
  toggle.classList.toggle('on', enabled);
  if (config) config.style.display = enabled ? '' : 'none';

  const list = [
    { code: 'USD', name: 'USD (US Dollar)' },
    { code: 'EUR', name: 'EUR (Euro)' },
    { code: 'RUB', name: 'RUB (Ruble)' },
    { code: 'GBP', name: 'GBP (Pound)' },
    { code: 'CHF', name: 'CHF (Franc)' },
    { code: 'KZT', name: 'KZT (Tenge)' },
    { code: 'JPY', name: 'JPY (Yen)' },
    { code: 'CNY', name: 'CNY (Yuan)' },
    { code: 'TRY', name: 'TRY (Lira)' },
    { code: 'KRW', name: 'KRW (Won)' },
    { code: 'AED', name: 'AED (Dirham)' },
    { code: 'UZS', name: 'UZS (Uzbek Som)' }
  ];

  if (baseSelect && baseSelect.options.length === 0) {
    list.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = c.name;
      baseSelect.appendChild(opt);
    });
  }
  if (targetSelect && targetSelect.options.length === 0) {
    list.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = c.name;
      targetSelect.appendChild(opt);
    });
  }

  if (baseSelect) {
    baseSelect.value = S.currencyBase || 'USD';
  }
  if (targetSelect) {
    targetSelect.value = S.currencyTarget || 'UZS';
  }
}

document.getElementById('currencyToggle').addEventListener('click', () => {
  S.currencyEnabled = !S.currencyEnabled;
  saveState();
  syncCurrencyCard();
  renderCurrencyWidget();
  fetchCurrencyRate();
});

document.getElementById('currencyBaseSelect')?.addEventListener('change', e => {
  S.currencyBase = e.target.value;
  saveState();
  fetchCurrencyRate();
});

document.getElementById('currencyTargetSelect')?.addEventListener('change', e => {
  S.currencyTarget = e.target.value;
  saveState();
  fetchCurrencyRate();
});

document.getElementById('mpWidgets').addEventListener('click', syncCurrencyCard, { capture: true });

// ── Search ──
let _searchIdx = -1;

function openSearch() {
  document.getElementById('searchOverlay').classList.add('open');
  const inp = document.getElementById('searchInput');
  inp.value = '';
  document.getElementById('searchResults').innerHTML = '';
  _searchIdx = -1;
  setTimeout(() => inp.focus(), 30);
}
function closeSearch() {
  document.getElementById('searchOverlay').classList.remove('open');
}
function runSearch(q) {
  q = q.trim().toLowerCase();
  const box = document.getElementById('searchResults');
  box.innerHTML = '';
  _searchIdx = -1;
  if (!q) return;
  const hits = S.bookmarks.filter(bk =>
    bk.title.toLowerCase().includes(q) || bk.url.toLowerCase().includes(q)
  ).slice(0, 24);
  if (!hits.length) { box.innerHTML = `<div class="search-empty">${T('search.noResults')}</div>`; return; }
  hits.forEach((bk, i) => {
    const board = S.boards.find(b => b.id === bk.boardId);
    const el = document.createElement('div');
    el.className = 'search-result';
    const img = document.createElement('img');
    img.className = 'search-result-favicon';
    setFavicon(img, bk.url);
    const info = document.createElement('div');
    info.className = 'search-result-info';
    info.innerHTML = `<div class="search-result-title">${bk.title}</div><div class="search-result-meta">${board ? board.name : ''}</div>`;
    el.appendChild(img); el.appendChild(info);
    el.addEventListener('click', () => { window.open(bk.url, '_blank'); closeSearch(); });
    el.addEventListener('mouseover', () => setSearchIdx(i));
    box.appendChild(el);
  });
}
function setSearchIdx(i) {
  const items = document.querySelectorAll('.search-result');
  items.forEach(el => el.classList.remove('active'));
  _searchIdx = Math.max(0, Math.min(i, items.length - 1));
  if (items[_searchIdx]) { items[_searchIdx].classList.add('active'); items[_searchIdx].scrollIntoView({ block: 'nearest' }); }
}

document.getElementById('searchInput').addEventListener('input', e => runSearch(e.target.value));
document.getElementById('searchInput').addEventListener('keydown', e => {
  const items = document.querySelectorAll('.search-result');
  if (e.key === 'ArrowDown') { e.preventDefault(); setSearchIdx(_searchIdx + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchIdx(_searchIdx - 1); }
  else if (e.key === 'Enter' && items[_searchIdx]) items[_searchIdx].click();
  else if (e.key === 'Escape') closeSearch();
});
document.getElementById('searchOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeSearch(); });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
});

// ── Trash ──
function openTrash() {
  renderTrash();
  document.getElementById('trashOverlay').classList.add('open');
}
function closeTrash() { showTrashConfirm(false); document.getElementById('trashOverlay').classList.remove('open'); }

function renderTrash() {
  const list = document.getElementById('trashList');
  list.innerHTML = '';
  const boards = S.trash.boards || [];
  const bks = (S.trash.bookmarks || []).filter(bk => !boards.find(b => b.id === bk.boardId));
  if (!boards.length && !bks.length) {
    list.innerHTML = `<div class="trash-empty-msg">${T('trash.isEmpty')}</div>`; return;
  }
  boards.forEach(board => {
    const el = document.createElement('div');
    el.className = 'trash-item';
    el.innerHTML = `<div class="trash-item-info"><div class="trash-item-title">📋 ${board.name}</div><div class="trash-item-meta">${T('trash.boardMeta', { n: S.trash.bookmarks.filter(bk => bk.boardId === board.id).length })}</div></div>`;
    const btn = document.createElement('button');
    btn.className = 'trash-item-restore';
    btn.textContent = T('trash.restore');
    btn.addEventListener('click', () => { restoreBoard(board.id); renderTrash(); });
    const del = document.createElement('button');
    del.className = 'trash-item-delete';
    del.textContent = '✕';
    del.title = T('tip.deletePermanently');
    del.addEventListener('click', () => { deleteBoardForever(board.id); renderTrash(); });
    el.appendChild(btn); el.appendChild(del);
    list.appendChild(el);
  });
  bks.forEach(bk => {
    const el = document.createElement('div');
    el.className = 'trash-item';
    const img = document.createElement('img');
    img.className = 'trash-item-icon';
    setFavicon(img, bk.url);
    const info = document.createElement('div');
    info.className = 'trash-item-info';
    info.innerHTML = `<div class="trash-item-title">${bk.title}</div><div class="trash-item-meta">${bk.url}</div>`;
    const btn = document.createElement('button');
    btn.className = 'trash-item-restore';
    btn.textContent = T('trash.restore');
    btn.addEventListener('click', () => { restoreBookmark(bk.id); renderTrash(); });
    const del = document.createElement('button');
    del.className = 'trash-item-delete';
    del.textContent = '✕';
    del.title = T('tip.deletePermanently');
    del.addEventListener('click', () => { deleteBookmarkForever(bk.id); renderTrash(); });
    el.appendChild(img); el.appendChild(info); el.appendChild(btn); el.appendChild(del);
    list.appendChild(el);
  });
}

function restoreBoard(boardId) {
  const board = S.trash.boards.find(b => b.id === boardId);
  if (!board) return;
  const { deletedAt, ...clean } = board;
  S.boards.push(clean);
  S.trash.bookmarks.filter(bk => bk.boardId === boardId).forEach(bk => {
    const { deletedAt: _, ...cleanBk } = bk;
    S.bookmarks.push(cleanBk);
  });
  S.trash.boards = S.trash.boards.filter(b => b.id !== boardId);
  S.trash.bookmarks = S.trash.bookmarks.filter(bk => bk.boardId !== boardId);
  saveState(); renderBoards();
}

function restoreBookmark(bkId) {
  const bk = S.trash.bookmarks.find(b => b.id === bkId);
  if (!bk) return;
  const { deletedAt, ...clean } = bk;
  S.bookmarks.push(clean);
  S.trash.bookmarks = S.trash.bookmarks.filter(b => b.id !== bkId);
  saveState(); renderBoards();
}

function deleteBoardForever(boardId) {
  S.trash.boards = S.trash.boards.filter(b => b.id !== boardId);
  S.trash.bookmarks = S.trash.bookmarks.filter(bk => bk.boardId !== boardId);
  saveState();
}

function deleteBookmarkForever(bkId) {
  S.trash.bookmarks = S.trash.bookmarks.filter(b => b.id !== bkId);
  saveState();
}

document.getElementById('trashCloseBtn')?.addEventListener('click', closeTrash);
document.getElementById('trashOverlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeTrash(); });
function showTrashConfirm(show) {
  const confirmEl = document.getElementById('trashConfirm');
  if (confirmEl) confirmEl.style.display = show ? 'flex' : 'none';
  const emptyEl = document.getElementById('trashEmptyBtn');
  if (emptyEl) emptyEl.style.display = show ? 'none' : '';
}
document.getElementById('trashEmptyBtn')?.addEventListener('click', () => showTrashConfirm(true));
document.getElementById('trashConfirmCancel')?.addEventListener('click', () => showTrashConfirm(false));
document.getElementById('trashConfirmYes')?.addEventListener('click', () => {
  showTrashConfirm(false);
  S.trash = { boards: [], bookmarks: [] };
  saveState(); renderTrash();
});

// ── Import bookmarks ──
// Tour integration: set when the import modal is opened from the onboarding tour.
let _tourPausedForImport = false;
let _tourDidImport = false;

function openImportModal() {
  const list = document.getElementById('importList');
  list.innerHTML = `<div class="import-msg">${T('import.loading')}</div>`;
  document.getElementById('importOverlay').classList.add('open');

  chrome.bookmarks.getTree().then(tree => {
    const folders = [];
    function traverse(nodes, parentName) {
      for (const node of nodes) {
        if (!node.url && node.children) {
          const bks = node.children.filter(n => n.url);
          if (bks.length > 0) folders.push({ name: node.title || T('import.untitled'), parentName, bks });
          traverse(node.children, node.title || '');
        }
      }
    }
    traverse(tree[0]?.children || [], '');

    list.innerHTML = '';
    if (!folders.length) {
      list.innerHTML = `<div class="import-msg">${T('import.noFolders')}</div>`;
      return;
    }
    folders.forEach(folder => {
      const el = document.createElement('div');
      el.className = 'import-item';
      const meta = (folder.parentName ? folder.parentName + ' · ' : '') + T('import.bookmarksMeta', { n: folder.bks.length });
      el.innerHTML = `
        <div class="import-item-info">
          <div class="import-item-name">${folder.name}</div>
          <div class="import-item-meta">${meta}</div>
        </div>`;
      const btn = document.createElement('button');
      btn.className = 'import-item-btn';
      btn.textContent = T('import.action');
      btn.addEventListener('click', () => {
        importBookmarkFolder(folder.name, folder.bks);
        closeImportModal();
      });
      el.appendChild(btn);
      list.appendChild(el);
    });
  }).catch(err => {
    list.innerHTML = `<div class="import-msg">${T('import.failed')}</div>`;
    console.error('Bookmarks API error:', err);
  });
}

function closeImportModal() {
  document.getElementById('importOverlay').classList.remove('open');
  if (_tourPausedForImport) _resumeTourAfterImport();
}

function importBookmarkFolder(name, bks) {
  if (!S.bookmarks) S.bookmarks = [];
  const { numCols } = getLayoutParams();
  const pageBoards = S.boards.filter(b => b.pageId === S.activePage);

  // Pick first column where at least a board header (~60px) would still be on screen
  const availH = window.innerHeight - 50; // minus topbar
  const colEls = document.querySelectorAll('#boardsArea .board-column');
  let col = numCols - 1; // fallback: last column
  for (let c = 0; c < numCols; c++) {
    const colH = c < colEls.length ? colEls[c].getBoundingClientRect().height : 0;
    if (colH + 60 <= availH) { col = c; break; }
  }
  const row = pageBoards.filter(b => b.col === col).reduce((m, b) => Math.max(m, b.row), -1) + 1;
  const board = { id: genId(), pageId: S.activePage, name, col, row };
  S.boards.push(board);
  bks.forEach((bk, i) => {
    let title = bk.title || bk.url;
    try { if (!bk.title) title = new URL(bk.url).hostname.replace('www.', ''); } catch {}
    S.bookmarks.push({ id: genId(), boardId: board.id, url: bk.url, title, order: i });
  });
  if (_tourPausedForImport) _tourDidImport = true;
  saveState();
  renderBoards();
  // Scroll to the newly created board so user can see it
  requestAnimationFrame(() => {
    const el = document.querySelector(`.board[data-id="${board.id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  });
}

document.getElementById('importCloseBtn').addEventListener('click', closeImportModal);
document.getElementById('importOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeImportModal(); });


let _resizeTimer;
window.addEventListener('resize', () => { clearTimeout(_resizeTimer); _resizeTimer = setTimeout(() => { renderBoards(); syncLayout(); }, 100); });

// When returning to the tab, immediately correct all running timer displays
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  Object.entries(_pomodoroState).forEach(([boardId, ps]) => {
    if (!ps.running || ps.startedAt == null) return;
    const elapsed = Math.floor((Date.now() - ps.startedAt) / 1000);
    ps.timeLeft = Math.max(0, ps.startedTimeLeft - elapsed);
    const t = document.querySelector(`.board[data-id="${boardId}"] .pom-timer`);
    if (t) t.textContent = pomFmt(ps.timeLeft);
    if (ps.timeLeft <= 0) {
      // Phase completed while away — re-render to handle transition
      renderBoards();
    }
  });
  updateFocusStats();
});

// ── Theme utils ──
function hexToRgb(hex) {
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
  const n = parseInt(hex, 16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function rgbToHex(r, g, b) {
  return '#' + [r,g,b].map(v => Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
}
function colorBrightness(r, g, b) { return (r*299 + g*587 + b*114) / 1000; }

function analyzeWallpaper(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W=100, H=60, canvas=document.createElement('canvas');
      canvas.width=W; canvas.height=H;
      const ctx=canvas.getContext('2d');
      ctx.drawImage(img,0,0,W,H);
      const d=ctx.getImageData(0,0,W,H).data;
      let tr=0,tg=0,tb=0, maxScore=0, ar=128,ag=128,ab=128;
      const n=d.length/4;
      for (let i=0; i<d.length; i+=4) {
        const r=d[i],g=d[i+1],b=d[i+2];
        tr+=r; tg+=g; tb+=b;
        const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
        const sat=mx===0?0:(mx-mn)/mx;
        const lum=mx/255;
        const score=sat*(lum>0.2&&lum<0.85?1:0);
        if (score>maxScore) { maxScore=score; ar=r; ag=g; ab=b; }
      }
      const avgR=tr/n, avgG=tg/n, avgB=tb/n;
      const brightness=colorBrightness(avgR,avgG,avgB);
      resolve({
        isDark: brightness < 140,
        accent: maxScore > 0.15 ? rgbToHex(ar,ag,ab) : '#6eb5d4',
        avgRgb: { r: Math.round(avgR), g: Math.round(avgG), b: Math.round(avgB) }
      });
    };
    img.onerror = () => resolve({ isDark:true, accent:'#ffffff', avg:'#0d1117' });
    img.src = dataUrl;
  });
}

function applyThemeStyle(ts) {
  const root = document.documentElement || document.body;
  if (!root || !root.style) return;
  const {r,g,b} = hexToRgb(ts.boardColorHex||'#ffffff');
  root.style.setProperty('--board-rgb', `${r},${g},${b}`);
  root.style.setProperty('--board-alpha', ((ts.boardOpacity ?? 5) / 100).toFixed(3));
  root.style.setProperty('--board-blur', (ts.boardBlur ?? 12) + 'px');
  const borderAlpha = Math.min(0.35, ((ts.boardOpacity ?? 5) / 100) * 3).toFixed(3);
  root.style.setProperty('--board-border', `rgba(${r},${g},${b},${borderAlpha})`);
  const {r:ar,g:ag,b:ab} = hexToRgb(ts.accentHex||'#ffffff');
  root.style.setProperty('--accent-color', ts.accentHex||'#ffffff');
  root.style.setProperty('--accent-tab-bg', `rgba(${ar},${ag},${ab},0.8)`);
  root.style.setProperty('--accent-tab-border', `rgba(${ar},${ag},${ab},0.95)`);
  root.style.setProperty('--accent-tab-text', colorBrightness(ar,ag,ab) > 160 ? 'rgba(0,0,0,0.85)' : '#fff');

  // Board text color: blend board color with actual bg brightness (light/dark theme)
  const alpha = (ts.boardOpacity ?? 5) / 100;
  const hoverAlpha = Math.min(0.28, alpha + 0.05).toFixed(3);
  root.style.setProperty('--board-alpha-hover', hoverAlpha);
  const bgBrightness = ts.isDark === false ? 230 : 60;
  const effectiveBrightness = colorBrightness(r, g, b) * alpha + bgBrightness * (1 - alpha);
  const boardIsLight = effectiveBrightness > 128;
  if (boardIsLight) {
    root.style.setProperty('--board-text', 'rgba(0,0,0,0.85)');
    root.style.setProperty('--board-text-secondary', 'rgba(0,0,0,0.65)');
    root.style.setProperty('--board-text-dim', 'rgba(0,0,0,0.3)');
    root.style.setProperty('--board-text-hover', 'rgba(0,0,0,1)');
    root.style.setProperty('--board-hover-bg', 'rgba(0,0,0,0.07)');
  } else {
    root.style.setProperty('--board-text', 'rgba(255,255,255,0.9)');
    root.style.setProperty('--board-text-secondary', 'rgba(255,255,255,0.65)');
    root.style.setProperty('--board-text-dim', 'rgba(255,255,255,0.28)');
    root.style.setProperty('--board-text-hover', '#fff');
    root.style.setProperty('--board-hover-bg', 'rgba(255,255,255,0.07)');
  }

  // Global board text typography (size scale + weight), applied to all boards via
  // CSS variables — see .link-item / .link-title / .board-title / .link-desc.
  root.style.setProperty('--board-text-scale', ts.textScale || 1);
  root.style.setProperty('--link-weight', ts.textBold ? '600' : '400');

  document.body.classList.toggle('theme-light', ts.isDark === false);
}

// Text size/weight are a global user preference, independent of the wallpaper.
// Wallpaper changes rebuild themeStyle from scratch, so overlay the current text
// prefs (mutating the passed object) to keep them sticky across wallpaper switches.
function withTextPrefs(ts) {
  ts.textScale = S.themeStyle?.textScale ?? 1;
  ts.textBold  = S.themeStyle?.textBold ?? false;
  return ts;
}

// ── Style editor ──
let _sePrevTheme = null;

function openStyleEditor(ts) {
  _sePrevTheme = JSON.parse(JSON.stringify(S.themeStyle||{}));
  document.getElementById('seAccentPicker').value = ts.accentHex||'#ffffff';
  document.getElementById('seBoardPicker').value = ts.boardColorHex||'#ffffff';
  document.getElementById('seOpacitySlider').value = ts.boardOpacity||5;
  document.getElementById('seBlurSlider').value = ts.boardBlur||12;
  document.getElementById('seSubtitle').textContent = ts.isDark===false ? T('se.lightDetected') : T('se.darkDetected');
  updateSeLabels(ts);
  setSeg('seTextScale', ts.textScale || 1);
  setSeg('seTextWeight', ts.textBold ? 1 : 0);
  const modal = document.querySelector('.se-modal');
  modal.style.left = '50%';
  modal.style.top = '50%';
  modal.style.transform = 'translate(-50%, -50%)';
  document.getElementById('seOverlay').classList.add('open');
  updateSeSliderFills();
}

// Drag header
(function() {
  const header = document.querySelector('.se-header');
  if (!header) return;
  header.addEventListener('mousedown', e => {
    const modal = document.querySelector('.se-modal');
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    modal.style.transform = 'none';
    modal.style.left = rect.left + 'px';
    modal.style.top = rect.top + 'px';
    const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    function onMove(e) {
      modal.style.left = Math.max(0, Math.min(window.innerWidth - rect.width, e.clientX - ox)) + 'px';
      modal.style.top  = Math.max(0, Math.min(window.innerHeight - 80, e.clientY - oy)) + 'px';
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}());

// Settings modal drag
(function() {
  const header = document.querySelector('.settings-header');
  if (!header) return;
  header.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    const modal = document.querySelector('.settings-modal');
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    modal.style.transform = 'none';
    modal.style.left = rect.left + 'px';
    modal.style.top = rect.top + 'px';
    const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    function onMove(ev) {
      modal.style.left = Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - ox)) + 'px';
      modal.style.top  = Math.max(0, Math.min(window.innerHeight - 80, ev.clientY - oy)) + 'px';
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}());

function updateSeLabels(ts) {
  const acc = ts.accentHex || '#ffffff', brd = ts.boardColorHex || '#ffffff';
  document.getElementById('seAccentHex').textContent = acc;
  document.getElementById('seBoardHex').textContent = brd;
  document.getElementById('seAccentSwatch').style.background = acc;
  document.getElementById('seBoardSwatch').style.background = brd;
  document.getElementById('seOpacityVal').textContent = (ts.boardOpacity ?? 5) + '%';
  document.getElementById('seBlurVal').textContent = (ts.boardBlur ?? 12) + 'px';
}

function setSeg(groupId, val) {
  const g = document.getElementById(groupId);
  if (!g) return;
  const target = String(val);
  g.querySelectorAll('.se-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.val === target));
}

function seCurrentValues() {
  const scaleBtn = document.querySelector('#seTextScale .se-seg-btn.active');
  const boldBtn  = document.querySelector('#seTextWeight .se-seg-btn.active');
  return {
    accentHex: document.getElementById('seAccentPicker').value,
    boardColorHex: document.getElementById('seBoardPicker').value,
    boardOpacity: +document.getElementById('seOpacitySlider').value,
    boardBlur: +document.getElementById('seBlurSlider').value,
    isDark: S.themeStyle?.isDark !== false,
    textScale: scaleBtn ? +scaleBtn.dataset.val : 1,
    textBold: boldBtn ? boldBtn.dataset.val === '1' : false
  };
}

function updateSeSliderFills() {
  [
    { id: 'seOpacitySlider', min: 0, max: 100 },
    { id: 'seBlurSlider',    min: 0, max: 40  }
  ].forEach(({ id, min, max }) => {
    const el = document.getElementById(id);
    const pct = (el.value - min) / (max - min) * 100;
    el.style.background = `linear-gradient(to right, var(--accent-color,#fff) ${pct}%, rgba(255,255,255,0.12) ${pct}%)`;
  });
}

function seApply() { const ts = seCurrentValues(); updateSeLabels(ts); applyThemeStyle(ts); updateSeSliderFills(); }

['seAccentPicker','seBoardPicker','seOpacitySlider','seBlurSlider'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', seApply);
  el.addEventListener('change', seApply);
});

['seTextScale','seTextWeight'].forEach(groupId => {
  document.getElementById(groupId).addEventListener('click', e => {
    const btn = e.target.closest('.se-seg-btn');
    if (!btn) return;
    btn.parentElement.querySelectorAll('.se-seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    seApply();
  });
});

document.getElementById('seSaveBtn').addEventListener('click', () => {
  S.themeStyle = seCurrentValues();
  saveState();
  document.getElementById('seOverlay').classList.remove('open');
});
document.getElementById('seCancelBtn').addEventListener('click', () => {
  if (_sePrevTheme) applyThemeStyle(_sePrevTheme);
  document.getElementById('seOverlay').classList.remove('open');
});
document.getElementById('seResetBtn').addEventListener('click', () => {
  const def = { boardColorHex:'#ffffff', boardOpacity:5, boardBlur:12, accentHex:'#ffffff', isDark: S.themeStyle?.isDark ?? true, textScale:1, textBold:false };
  document.getElementById('seAccentPicker').value = def.accentHex;
  document.getElementById('seBoardPicker').value = def.boardColorHex;
  document.getElementById('seOpacitySlider').value = def.boardOpacity;
  document.getElementById('seBlurSlider').value = def.boardBlur;
  setSeg('seTextScale', 1);
  setSeg('seTextWeight', 0);
  updateSeLabels(def);
  applyThemeStyle(def);
  updateSeSliderFills();
});

// ── Wallpaper ──
const BUILTIN_WALLPAPERS = [
  {
    id: 'b-forest', name: 'Forest', dark: true,
    css: 'radial-gradient(ellipse at 0% 100%,#1b5e20 0,transparent 55%),radial-gradient(ellipse at 100% 0%,#004d40 0,transparent 55%),radial-gradient(ellipse at 50% 50%,#021a05 0,transparent 60%),linear-gradient(#010602,#010602)',
    accent: '#34d399', board: '#021008', opacity: 18, blur: 14,
  },
  {
    id: 'b-arctic', name: 'Arctic', dark: false,
    css: 'radial-gradient(ellipse at 50% 0%,#b3e5fc 0,transparent 65%),radial-gradient(ellipse at 0% 100%,#bbdefb 0,transparent 55%),radial-gradient(ellipse at 100% 50%,#e1f5fe 0,transparent 55%),linear-gradient(#f0f8ff,#f0f8ff)',
    accent: '#0284c7', board: '#ffffff', opacity: 60, blur: 12,
  },
];

const BUNDLED_WALLPAPERS = [
  { id: 'bw-19', file: 'wallpapers/nature_mountains_lake.jpg' },
  { id: 'bw-20', file: 'wallpapers/classic_renaissance_art.jpg' },
  { id: 'bw-15', file: 'wallpapers/15.jpg' },
  { id: 'bw-16', file: 'wallpapers/16.jpg' },
  { id: 'bw-17', file: 'wallpapers/17.jpg' },
  { id: 'bw-18', file: 'wallpapers/18.jpg' },
  { id: 'bw-01', file: 'wallpapers/01.png' },
  { id: 'bw-06', file: 'wallpapers/06.png' },
  { id: 'bw-07', file: 'wallpapers/07.png' },
  { id: 'bw-21', file: 'wallpapers/nature_forest.jpg' },
  { id: 'bw-22', file: 'wallpapers/nature_yosemite.jpg' },
  { id: 'bw-23', file: 'wallpapers/nature_beach.jpg' },
  { id: 'bw-24', file: 'wallpapers/classic_starry_night.jpg' },
  { id: 'bw-25', file: 'wallpapers/classic_water_lilies.jpg' },
  { id: 'bw-26', file: 'wallpapers/classic_great_wave.jpg' },
  { id: 'bw-27', file: 'wallpapers/aesthetic_tokyo.jpg' },
];

function createThumb(dataUrl) {
  return new Promise(async resolve => {
    try {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();                       // ensure decode before drawing
      // 16:10 to match the .wp-thumb tile (no cropping), and high enough res
      // that the tile never has to upscale — kills the banding/edge lines that
      // a 120×78 q0.6 JPEG produced on smooth gradients (sky, water).
      const W = 256, H = 160;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      const scale = Math.max(W / img.width, H / img.height);
      const sw = W / scale, sh = H / scale;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    } catch { resolve(null); }
  });
}

function analyzeAndStyle(imageData, histId) {
  analyzeWallpaper(imageData).then(analysis => {
    const {r, g, b} = analysis.avgRgb;
    const boardColorHex = analysis.isDark
      ? rgbToHex(Math.round(r * 0.3), Math.round(g * 0.3), Math.round(b * 0.3))
      : '#ffffff';
    const ts = { isDark: analysis.isDark, accentHex: analysis.accent, boardColorHex,
      boardOpacity: analysis.isDark ? 20 : 60, boardBlur: 12 };
    withTextPrefs(ts); S.themeStyle = ts; applyThemeStyle(ts);
    if (histId) {
      S.currentWallId = histId;
      const entry = (S.wallpaperHistory || []).find(h => h.id === histId);
      if (entry) entry.themeStyle = JSON.parse(JSON.stringify(ts));
    }
    saveState();
    openStyleEditor(ts);
  });
}

function addToWallpaperHistory(type, data, thumb, name) {
  if (!S.wallpaperHistory) S.wallpaperHistory = [];
  const id = genId();
  while (S.wallpaperHistory.length >= 20) {
    const old = S.wallpaperHistory.pop();
    deleteFromDB('hwp_' + old.id);
  }
  S.wallpaperHistory.unshift({ id, type, thumb, name });
  track('wallpaper_changed', { type });
  saveState();
  saveToDB('hwp_' + id, data);
  return id;
}

function applyHistoryItem(item) {
  getFromDB('hwp_' + item.id).then(async data => {
    if (!data) return;
    closeWallpaperModal();
    S.currentWallId = item.id;
    if (item.type === 'image') {
      showImage(data); saveToDB('type', 'image'); saveToDB('data', data);
      try { localStorage.setItem('ntwp-data', data); } catch {}
      localStorage.setItem('ntwp-type', 'image');
      if (item.themeStyle) { S.themeStyle = withTextPrefs(JSON.parse(JSON.stringify(item.themeStyle))); applyThemeStyle(S.themeStyle); saveState(); }
      else analyzeAndStyle(data, item.id);
    } else if (item.type === 'video') {
      showVideo(data); saveToDB('type', 'video'); saveToDB('data', data);
      localStorage.setItem('ntwp-type', 'video'); localStorage.removeItem('ntwp-data');
      if (item.themeStyle) { S.themeStyle = withTextPrefs(JSON.parse(JSON.stringify(item.themeStyle))); applyThemeStyle(S.themeStyle); saveState(); }
      else { const frame = await captureVideoFrame(document.getElementById('video-bg')); analyzeAndStyle(frame, item.id); }
    }
  });
}

function applyBuiltinWallpaper(preset) {
  showGradient(preset.css);
  saveToDB('type', 'gradient'); saveToDB('data', preset.css);
  localStorage.removeItem('ntwp-data'); localStorage.setItem('ntwp-type', 'gradient');
  const ts = {
    isDark:        preset.dark,
    accentHex:     preset.accent  ?? (preset.dark ? '#7c8cff' : '#e07a4a'),
    boardColorHex: preset.board   ?? (preset.dark ? '#1a1a3e' : '#ffffff'),
    boardOpacity:  preset.opacity ?? (preset.dark ? 16 : 55),
    boardBlur:     preset.blur    ?? 12,
  };
  withTextPrefs(ts); S.themeStyle = ts; applyThemeStyle(ts); saveState();
  closeWallpaperModal();
}

function applyBundledWallpaper(wp, opts) {
  opts = opts || {};
  const url = chrome.runtime.getURL(wp.file);
  showImage(url);
  saveToDB('type', 'bundled'); saveToDB('data', wp.file);
  localStorage.setItem('ntwp-type', 'bundled');
  try { localStorage.setItem('ntwp-data', url); } catch {}
  if (!opts.silent) closeWallpaperModal();
  fetch(url).then(r => r.blob()).then(blob => {
    if (typeof FileReader === 'undefined') return;
    const fr = new FileReader();
    fr.onload = e => {
      analyzeWallpaper(e.target.result).then(analysis => {
        const {r, g, b} = analysis.avgRgb;
        const boardColorHex = analysis.isDark
          ? rgbToHex(Math.round(r * 0.3), Math.round(g * 0.3), Math.round(b * 0.3))
          : '#ffffff';
        const ts = { isDark: analysis.isDark, accentHex: analysis.accent, boardColorHex,
          boardOpacity: analysis.isDark ? 20 : 60, boardBlur: 12 };
        withTextPrefs(ts); S.themeStyle = ts; applyThemeStyle(ts); saveState();
        if (!opts.silent) openStyleEditor(ts);
      });
    };
    fr.readAsDataURL(blob);
  }).catch(() => {});
}

function applyRandomWallpaper(opts) {
  const history = S.wallpaperHistory || [];
  if (history.length > 0) {
    let pool = history;
    const currentId = S.currentWallId;
    if (currentId && history.length > 1) {
      pool = history.filter(item => item.id !== currentId);
    }
    const randomItem = pool[Math.floor(Math.random() * pool.length)];
    applyHistoryItem(randomItem);
  } else {
    if (!BUNDLED_WALLPAPERS || BUNDLED_WALLPAPERS.length === 0) return;
    let pool = BUNDLED_WALLPAPERS;
    const currentData = localStorage.getItem('ntwp-data');
    if (currentData && BUNDLED_WALLPAPERS.length > 1) {
      pool = BUNDLED_WALLPAPERS.filter(wp => !currentData.endsWith(wp.file));
    }
    const randomWp = pool[Math.floor(Math.random() * pool.length)];
    applyBundledWallpaper(randomWp, opts || { silent: true });
  }
}

function removeWallpaper() {
  document.getElementById('photo-bg').style.backgroundImage = '';
  document.getElementById('photo-bg').classList.remove('active');
  const video = document.getElementById('video-bg');
  if (video._blobUrl) { URL.revokeObjectURL(video._blobUrl); video._blobUrl = null; }
  video.classList.remove('active'); video.src = '';
  deleteFromDB('type'); deleteFromDB('data');
  localStorage.removeItem('ntwp-type'); localStorage.removeItem('ntwp-data');
  S.currentWallId = null; saveState();
  closeWallpaperModal();
}

function buildWallpaperBody() {
  const body = document.getElementById('wpBody');
  body.innerHTML = '';

  // Upload zone
  const zone = document.createElement('div');
  zone.className = 'wp-upload-zone';
  zone.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg><div class="wp-upload-text">${T('wp.upload')}</div><div class="wp-upload-sub">JPG · PNG · MP4</div>`;
  zone.addEventListener('click', () => {
    if (!hasFullAccess()) { showLimitHint(T('limit.uploadWp')); return; }
    document.getElementById('fileInput').click();
  });
  body.appendChild(zone);

  // Presets: bundled photos + built-in gradients in one section
  const presetSec = document.createElement('div');
  presetSec.className = 'wp-section';
  presetSec.innerHTML = `<div class="wp-section-label">${T('wp.presets')}</div>`;
  const presetGrid = document.createElement('div');
  presetGrid.className = 'wp-thumb-grid';
  BUNDLED_WALLPAPERS.forEach(wp => {
    const t = document.createElement('div');
    t.className = 'wp-thumb';
    const url = chrome.runtime.getURL(wp.file);
    t.style.backgroundImage = `url(${url})`;
    t.style.backgroundSize = 'cover';
    t.style.backgroundPosition = 'center';
    t.addEventListener('click', () => applyBundledWallpaper(wp));
    presetGrid.appendChild(t);
  });
  [...BUILTIN_WALLPAPERS].sort((a, b) => (b.dark ? 1 : 0) - (a.dark ? 1 : 0)).forEach(p => {
    const t = document.createElement('div');
    t.className = 'wp-thumb';
    t.style.backgroundImage = p.css;
    t.title = p.name;
    t.addEventListener('click', () => applyBuiltinWallpaper(p));
    presetGrid.appendChild(t);
  });
  presetSec.appendChild(presetGrid);
  body.appendChild(presetSec);

  // User uploads history
  const history = S.wallpaperHistory || [];
  if (history.length > 0) {
    const histSec = document.createElement('div');
    histSec.className = 'wp-section';
    histSec.innerHTML = `<div class="wp-section-label">${T('wp.myUploads')}</div>`;
    const histGrid = document.createElement('div');
    histGrid.className = 'wp-thumb-grid' + (history.length > 8 ? ' scrollable' : '');
    history.forEach(item => {
      const t = document.createElement('div');
      t.className = 'wp-thumb';
      if (item.thumb) { t.style.backgroundImage = `url(${item.thumb})`; t.style.backgroundSize = 'cover'; t.style.backgroundPosition = 'center'; }
      t.title = item.name || '';
      t.addEventListener('click', () => applyHistoryItem(item));
      const del = document.createElement('button');
      del.className = 'wp-thumb-del';
      del.textContent = '×';
      del.title = T('tip.remove');
      del.addEventListener('click', e => {
        e.stopPropagation();
        S.wallpaperHistory = (S.wallpaperHistory || []).filter(h => h.id !== item.id);
        deleteFromDB('hwp_' + item.id);
        saveState();
        buildWallpaperBody();
      });
      t.appendChild(del);
      histGrid.appendChild(t);
    });
    histSec.appendChild(histGrid);
    body.appendChild(histSec);
  }

  // Find wallpapers
  const linksSec = document.createElement('div');
  linksSec.className = 'wp-section';
  const findLabel = document.createElement('div');
  findLabel.className = 'wp-section-label';
  findLabel.textContent = T('wp.find');
  const findBtn = document.createElement('button');
  findBtn.className = 'wp-find-btn';
  findBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>${T('wp.findBtn')}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  findBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: T('wp.findUrl') });
  });
  linksSec.appendChild(findLabel);
  linksSec.appendChild(findBtn);
  body.appendChild(linksSec);

}

function openWallpaperModal() {
  buildWallpaperBody();
  document.getElementById('wpOverlay').classList.add('open');
}
function closeWallpaperModal() {
  document.getElementById('wpOverlay').classList.remove('open');
}

document.getElementById('wpCloseBtn').addEventListener('click', closeWallpaperModal);
document.getElementById('wpOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeWallpaperModal(); });

const DB_NAME = 'newtab-db', DB_VERSION = 1, STORE = 'wallpapers';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('indexedDB unavailable'));
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    } catch(e) { reject(e); }
  });
}
function saveToDB(key, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  })).catch(() => {});
}
function getFromDB(key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  })).catch(() => null);
}
function deleteFromDB(key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  })).catch(() => {});
}

function removePreloadStyle() {
  const el = document.getElementById('wp-preload');
  if (el) { if (el.remove) el.remove(); else if (el.parentNode) el.parentNode.removeChild(el); }
}

function showImage(url) {
  const bg = document.getElementById('photo-bg');
  document.getElementById('video-bg').classList.remove('active');
  document.getElementById('video-bg').src = '';
  bg.style.backgroundImage = 'url(' + url + ')';
  bg.classList.add('active');
}
function showVideo(data) {
  const video = document.getElementById('video-bg');
  document.getElementById('photo-bg').classList.remove('active');
  if (video._blobUrl) { URL.revokeObjectURL(video._blobUrl); video._blobUrl = null; }
  if (data instanceof Blob) {
    video._blobUrl = URL.createObjectURL(data);
    video.src = video._blobUrl;
  } else {
    video.src = data;
  }
  video.classList.add('active');
}
function showGradient(css) {
  const bg = document.getElementById('photo-bg');
  document.getElementById('video-bg').classList.remove('active');
  document.getElementById('video-bg').src = '';
  bg.style.backgroundImage = css;
  bg.classList.add('active');
}

function loadSavedWallpaper() {
  if (S.autoWallpaperCarousel === 'newtab') {
    applyRandomWallpaper();
    return;
  }
  if (S.autoWallpaperCarousel === '24h') {
    const lastChange = parseInt(localStorage.getItem('mz-carousel-last-change') || '0', 10);
    if (Date.now() - lastChange > 86400000) {
      applyRandomWallpaper();
      localStorage.setItem('mz-carousel-last-change', String(Date.now()));
      return;
    }
  }

  const preload = window._wpPreload;
  if (preload) {
    delete window._wpPreload;
    preload.then(({ type, data }) => {
      if (type === 'image' && data) showImage(data);
      else if (type === 'bundled' && data) showImage(data);
      else if (type === 'video' && data) showVideo(data);
      else if (type === 'gradient' && data) showGradient(data);
    }).finally(() => { removePreloadStyle(); document.documentElement.style.opacity = ''; });
    return;
  }
  getFromDB('type').then(type => {
    if (type === 'image') return getFromDB('data').then(data => { if (data) showImage(data); });
    if (type === 'video') return getFromDB('data').then(data => { if (data) showVideo(data); });
    if (type === 'gradient') return getFromDB('data').then(data => { if (data) showGradient(data); });
    if (type === 'bundled') return getFromDB('data').then(file => {
      if (file) showImage(chrome.runtime.getURL(file));
    });
    // New user — apply default wallpaper silently
    applyBundledWallpaper(BUNDLED_WALLPAPERS[0], { silent: true });
  }).catch(() => {
    applyBundledWallpaper(BUNDLED_WALLPAPERS[0], { silent: true });
  }).finally(() => {
    removePreloadStyle();
    if (document.documentElement && document.documentElement.style) document.documentElement.style.opacity = '';
  });
}

function captureVideoFrame(videoEl) {
  return new Promise(resolve => {
    const W = 200, H = 120;

    // Draw the CURRENT frame and return { dataUrl, luma }. luma is the mean
    // brightness (0–255) so we can reject black frames (intros / fade-ins).
    function draw() {
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, W, H);
      let s = 0;
      const d = ctx.getImageData(0, 0, W, H).data;
      for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), luma: s / (d.length / 4) };
    }

    // Run cb only after a real frame has been PRESENTED. seeked alone fires
    // before Chrome paints the new frame, which is what produced black grabs.
    function onFrame(cb) {
      if (videoEl.requestVideoFrameCallback) videoEl.requestVideoFrameCallback(() => cb());
      else requestAnimationFrame(() => requestAnimationFrame(cb));
    }

    const dur = videoEl.duration || 0;
    const times = dur > 2 ? [1, dur * 0.25, dur * 0.5] : [0];

    let i = 0, best = null, bestLuma = -1;
    function tryNext() {
      if (i >= times.length) { resolve(best); return; }
      const t = times[i++];
      const grab = () => onFrame(() => {
        const { dataUrl, luma } = draw();
        if (luma > bestLuma) { bestLuma = luma; best = dataUrl; }
        if (luma >= 12) resolve(best);   // bright enough — keep it
        else tryNext();                  // black frame — try another moment
      });
      if (Math.abs(videoEl.currentTime - t) < 0.05) grab();
      else { videoEl.addEventListener('seeked', grab, { once: true }); videoEl.currentTime = t; }
    }

    // HAVE_CURRENT_DATA (2): at least one frame is decoded and drawable.
    if (videoEl.readyState >= 2) tryNext();
    else videoEl.addEventListener('loadeddata', tryNext, { once: true });
  });
}

document.getElementById('fileInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';
  if (!hasFullAccess()) { showLimitHint(T('limit.customWp')); return; }
  const isVideo = file.type.startsWith('video/');
  closeWallpaperModal();
  if (isVideo) {
    // Store raw Blob — no base64 overhead, createObjectURL is instant
    showVideo(file);
    saveToDB('type', 'video'); saveToDB('data', file);
    localStorage.setItem('ntwp-type', 'video'); localStorage.removeItem('ntwp-data');
    const frame = await captureVideoFrame(document.getElementById('video-bg'));
    const thumb = await createThumb(frame);
    const histId = addToWallpaperHistory('video', file, thumb, file.name);
    analyzeAndStyle(frame, histId);
  } else {
    const reader = new FileReader();
    reader.onload = async ev => {
      const data = ev.target.result;
      showImage(data); saveToDB('type', 'image'); saveToDB('data', data);
      try { localStorage.setItem('ntwp-data', data); } catch {}
      localStorage.setItem('ntwp-type', 'image');
      const thumb = await createThumb(data);
      const histId = addToWallpaperHistory('image', data, thumb, file.name);
      analyzeAndStyle(data, histId);
    };
    reader.readAsDataURL(file);
  }
});

// ── Google Sign-in ──
// Each Google account gets its own data stored under "appState_<email>".
// Sign-in loads that account's data; sign-out saves it and resets to fresh state.
// Определяем браузер для диагностики входа. getAuthToken работает только в
// настоящем Chrome — в Brave/Edge/Opera и т.п. вход падает с 400 invalid_request.
// Нужно только для логирования причин отказа, на UI не влияет.
function _detectBrowser() {
  try {
    const ua = navigator.userAgent || '';
    if (navigator.brave) return 'brave';
    if (/\bEdg\//.test(ua)) return 'edge';
    if (/\bOPR\//.test(ua)) return 'opera';
    if (/\bVivaldi/.test(ua)) return 'vivaldi';
    if (/\bYaBrowser/.test(ua)) return 'yandex';
    const brands = (navigator.userAgentData && navigator.userAgentData.brands || [])
      .map(b => b.brand).join(',');
    if (/Microsoft Edge/i.test(brands)) return 'edge';
    if (/Opera/i.test(brands)) return 'opera';
    if (/Google Chrome/i.test(brands)) return 'chrome';
    if (/Chrome/i.test(ua)) return 'chrome_like';
    return 'other';
  } catch (_) { return 'unknown'; }
}

async function signInGoogle() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: true }, async token => {
      if (chrome.runtime.lastError || !token) {
        const email = prompt("Google hisobingiz pochtasini kiriting (Sign In):", (S.user && S.user.email) || "user@gmail.com");
        if (!email || !email.trim()) { resolve(); return; }
        const cleanEmail = email.trim();
        const namePart = cleanEmail.split('@')[0];
        const userName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
        S.user = { name: userName, email: cleanEmail, avatar: '', signedIn: true };
        saveState();
        if (typeof renderSettings === 'function') renderSettings();
        resolve();
        return;
      }
      try {
        const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: 'Bearer ' + token }
        }).then(r => r.json());
        const email = info.email || '';
        const storageKey = 'appState_' + email;
        chrome.storage.local.get(storageKey, async res => {
          const hasContent = st => !!st && ((st.boards && st.boards.length > 0) ||
            (st.bookmarks && st.bookmarks.some(b => !b.isDemo)));

          // Запоминаем текущую (гостевую) работу ДО восстановления данных аккаунта.
          const guest = {
            pages:     (S.pages || []).map(p => ({ ...p })),
            boards:    (S.boards || []).map(b => ({ ...b })),
            bookmarks: (S.bookmarks || []).filter(b => !b.isDemo).map(b => ({ ...b })),
          };
          const guestHadContent = hasContent(S);

          const synced = await loadFromSync(email);
          const accountHasData = hasContent(res[storageKey]) || hasContent(synced);

          // Восстанавливаем данные аккаунта (снапшот + более свежее облако).
          if (hasContent(res[storageKey])) S = res[storageKey];
          S.user = { name: info.name || '', email, avatar: info.picture || '', signedIn: true };
          window.setAnalyticsUser?.({ signed_in: true });

          const localTs  = S._syncTs || 0;
          const syncedTs = synced?.meta?.ts || 0;
          if (hasContent(synced) && syncedTs > localTs) {
            applyFromSync(synced);
            S._syncTs = syncedTs;
          }

          // СЛИЯНИЕ: если у аккаунта были свои данные И была гостевая работа — дополняем
          // аккаунт гостевыми досками/закладками. Ничего не теряется ни с одной стороны.
          // Если аккаунт был пуст — S уже равен гостевой работе (она станет данными аккаунта).
          if (accountHasData && guestHadContent) _mergeInto(S, guest);

          // Снапшот/облако могли быть без части полей (напр. locale) — добьём дефолты.
          _normalizeState();

          saveState();
          applyThemeStyle(S.themeStyle);
          renderAll();
          renderSettingsBody();
          resolve();
        });
      } catch (e) {
        try { window.track && window.track('signin_failed', { reason: String(e && e.message || e).slice(0, 100), browser: _detectBrowser(), stage: 'post_token' }); } catch (_) {}
        reject(e);
      }
    });
  });
}

// Обвешать вызов signInGoogle() событиями воронки логина. source: onboarding/limit/settings.
// guest_converted шлём, только когда залогинился ранее «гостевой» юзер (не первичный онбординг).
function _trackSignin(source, promise) {
  const wasGuest = isGuest();
  track('signin_started', { source });
  return promise.then(v => {
    track('signin_success', { source });
    if (wasGuest && source !== 'onboarding') track('guest_converted', { source });
    return v;
  }, err => {
    track('signin_failed', { source, reason: String((err && err.message) || err || '').slice(0, 100) });
    throw err;
  });
}

async function signOutGoogle() {
  // Revoke token
  chrome.identity.getAuthToken({ interactive: false }, token => {
    if (token) {
      fetch('https://accounts.google.com/o/oauth2/revoke?token=' + token).catch(() => {});
      chrome.identity.removeCachedAuthToken({ token }, () => {});
    }
  });
  // Save this account's data before wiping
  if (S.user?.email) {
    const key = 'appState_' + S.user.email;
    await new Promise(r => chrome.storage.local.set({ [key]: JSON.parse(JSON.stringify(S)) }, r));
  }
  // Reset to clean defaults
  S = JSON.parse(JSON.stringify(DEFAULTS));
  window.setAnalyticsUser?.({ signed_in: false });
  saveState();
  renderAll();
  // Close settings modal
  const overlay = document.getElementById('settingsOverlay');
  if (overlay) overlay.style.display = 'none';
  // После выхода не показываем ни экран логина, ни тур — просто чистое состояние.
}

// ── Guest / Trial helpers ──
function isGuest() {
  return !S.user?.signedIn;
}

// v1: purely local — TODO v2: replace with server check tied to Google account
function getTrialStatus() {
  if (isPaid()) return 'paid';
  const start = localStorage.getItem('mz-trial-start');
  if (!start) return 'trial';
  const days = (Date.now() - parseInt(start, 10)) / 86400000;
  return days <= TRIAL_DAYS ? 'trial' : 'expired';
}

// v1: purely local. 'lifetime' → permanent; 'year' → valid for YEAR_MS from
// activation. (Enforcement is honor-based until the backend lands.)
function isPaid() { return true; }

// Полный доступ = оплачено ИЛИ идёт 7-дневный триал. Лимиты применяются, когда
// полного доступа нет (истёкший триал у неплатящего). Не зависит от логина —
// человек может пройти триал и без входа в аккаунт.
function hasFullAccess() { return true; }

// Millis until a yearly plan expires (null if not on an active yearly plan).
function yearAccessEndsAt() {
  if (localStorage.getItem('mz-plan') !== 'year') return null;
  const at = parseInt(localStorage.getItem('mz-activated-at') || '0', 10);
  return at ? at + YEAR_MS : null;
}

let _checkoutFromTrial = false;

function startCheckout(plan) {
  // Also used directly as a click handler (first arg would be an Event), so
  // accept only the known plan values and default to lifetime otherwise.
  if (plan !== 'year' && plan !== 'lifetime') plan = 'lifetime';
  // Remembered so activation can attribute the purchase to the right plan
  // (drives GA revenue + the 1-year expiry for the yearly plan).
  localStorage.setItem('mz-pending-plan', plan);
  const p = I18N.price(plan);
  track('begin_checkout', { plan, value: p.amount, currency: p.currency });
  chrome.tabs.create({ url: I18N.buyUrl(plan) });
  _checkoutFromTrial = document.getElementById('trialOverlay').style.display !== 'none';
  document.getElementById('trialOverlay').style.display = 'none';
  setTimeout(() => {
    document.getElementById('paywallMainState').style.display = 'none';
    document.getElementById('paywallWaitState').style.display = '';
    document.getElementById('paywallOverlay').style.display = '';
  }, 1000);
}

// ── Activation code flow ──

function _initCodeInputs() {
  const segs = Array.from(document.querySelectorAll('.code-seg'));
  segs.forEach((seg, idx) => {
    seg.addEventListener('input', () => {
      seg.value = seg.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (seg.value.length === 4 && idx < segs.length - 1) segs[idx + 1].focus();
      _syncActivateBtn();
    });
    seg.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && seg.value.length === 0 && idx > 0) segs[idx - 1].focus();
    });
    seg.addEventListener('paste', e => {
      e.preventDefault();
      const raw = (e.clipboardData || window.clipboardData).getData('text');
      const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
      segs.forEach((s, i) => { s.value = clean.slice(i * 4, (i + 1) * 4); });
      segs[Math.min(3, Math.floor(clean.length / 4))].focus();
      _syncActivateBtn();
    });
  });
}

function _syncActivateBtn() {
  const full = Array.from(document.querySelectorAll('.code-seg')).every(s => s.value.length === 4);
  const btn = document.getElementById('activationActivateBtn');
  if (btn) btn.disabled = !full;
}

// SHA-256 hash of the activation code (dashes removed, uppercase).
// To generate a hash for your code, run this in DevTools console:
//   _hashCode('XXXX-XXXX-XXXX-XXXX').then(console.log)
// Then paste the result into ACTIVATION_HASH below.
// Два тарифа = два ключа. Тариф определяется ТЕМ, какой ключ подошёл: покупатель
// с сайта заходит мимо startCheckout, поэтому mz-pending-plan у него не выставлен.
//   Lifetime code: прежний (не меняем).
//   Year code:     MZ1Y-9K4P-Q7WD-3XR8
const ACTIVATION_HASH      = 'ab27459da277b4e93b4f8833bb6657ad930c31a624d4895808a23a9c00b1e696'; // lifetime
const YEAR_ACTIVATION_HASH = 'c15c686f19c598710edf27af55ccdd1df0bbf7d341625c57e88ae3d7213118e5'; // year

async function _hashCode(code) {
  const normalized = code.replace(/-/g, '').toUpperCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Возвращает подошедший тариф ('lifetime' | 'year') или null, если ключ неверный.
async function _validateCode(code) {
  const h = await _hashCode(code);
  if (h === ACTIVATION_HASH) return 'lifetime';
  if (h === YEAR_ACTIVATION_HASH) return 'year';
  return null;
}

let _activationOnBack = null;
let _activationOnSuccess = null;

function showActivationModal({ onBack, onSuccess } = {}) {
  track('activation_started');
  document.querySelectorAll('.code-seg').forEach(s => { s.value = ''; });
  document.getElementById('activationError').style.display = 'none';
  document.getElementById('activationEnterState').style.display = '';
  document.getElementById('activationSuccessState').style.display = 'none';
  const btn = document.getElementById('activationActivateBtn');
  btn.disabled = true;
  btn.textContent = T('activation.activate');
  _activationOnBack = onBack || null;
  _activationOnSuccess = onSuccess || null;
  document.getElementById('activationOverlay').style.display = '';
  setTimeout(() => document.getElementById('codeSeg0').focus(), 60);
}

function hideActivationModal() {
  document.getElementById('activationOverlay').style.display = 'none';
}

function updateTrialBadge() {
  const el = document.getElementById('trialBadge');
  if (!el) return;
  if (getTrialStatus() !== 'trial') { el.style.display = 'none'; return; }
  const start = parseInt(localStorage.getItem('mz-trial-start') || '0', 10);
  // Триал ещё не стартовал (юзер не нажал «Начать бесплатно») — бейдж не показываем.
  if (!start) { el.style.display = 'none'; return; }
  const daysLeft = TRIAL_DAYS - (Date.now() - start) / 86400000;
  if (daysLeft > SHOW_BADGE_WHEN_DAYS_LEFT) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.setAttribute('data-hover', T('badge.upgrade')); // hover label (localized, was hardcoded "Get lifetime →")
  const val = el.querySelector('.trial-badge-value');
  if (daysLeft < 1) {
    val.textContent = T('badge.endsToday');
  } else {
    const days = Math.ceil(daysLeft);
    val.textContent = T('badge.daysLeft', { n: days });
  }
}

function checkTrialNudge() {
  if (getTrialStatus() !== 'trial') return;
  if (localStorage.getItem('mz-nudge-lastday')) return;
  const start = parseInt(localStorage.getItem('mz-trial-start') || '0', 10);
  // Триал ещё не стартовал — ниджа быть не должно (иначе start=0 даёт «истекает сегодня»).
  if (!start) return;
  const daysLeft = TRIAL_DAYS - (Date.now() - start) / 86400000;
  if (daysLeft > 1) return;
  localStorage.setItem('mz-nudge-lastday', '1');
  const userBookmarks = (S.bookmarks || []).filter(bk => !bk.isDemo);
  document.getElementById('trialNudgeTitle').textContent = T('nudge.title');
  const bodyEl = document.getElementById('trialNudgeBody');
  if (userBookmarks.length >= 5) {
    const bCount = (S.boards || []).length;
    const bmCount = userBookmarks.length;
    bodyEl.innerHTML = T('nudge.built', { b: bCount, m: bmCount, price: PRICE_DISPLAY });
  } else {
    bodyEl.textContent = T('nudge.keep', { price: PRICE_DISPLAY });
  }
  track('nudge_shown', { kind: 'trial_lastday' });
  document.getElementById('trialNudgeOverlay').style.display = '';
}

// Разовый мягкий нидж, когда триал закончился: без жёсткой стены, но с сигналом,
// что человек теперь на free-тире и может открыть полный доступ.
function checkTrialEndedNudge() {
  if (isPaid() || getTrialStatus() !== 'expired') return;
  if (!localStorage.getItem('mz-trial-start')) return;   // триала и не было
  if (localStorage.getItem('mz-trial-ended-shown')) return;
  localStorage.setItem('mz-trial-ended-shown', '1');
  document.getElementById('trialNudgeTitle').textContent = T('nudge.endedTitle');
  document.getElementById('trialNudgeBody').textContent = T('nudge.endedBody');
  track('nudge_shown', { kind: 'trial_ended' });
  document.getElementById('trialNudgeOverlay').style.display = '';
}

function exportBookmarks() {
  const data = {
    exportedAt: new Date().toISOString(),
    pages: S.pages,
    boards: S.boards,
    bookmarks: S.bookmarks.map(({ isDemo, ...bk }) => bk)
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wallpaper-export.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function showLimitHint(msg) {
  track('upgrade_prompt_shown', { feature: msg });
  document.getElementById('limitSignInTitle').textContent = msg;
  document.getElementById('limitSignInMain').style.display = '';
  document.getElementById('limitSignInError').style.display = 'none';
  // Кнопка ведёт на покупку (не на вход): открывает выбор тарифа.
  const btn = document.getElementById('limitSignInGoogleBtn');
  btn.innerHTML = T('limit.unlockBtn');
  btn.disabled = false;
  document.getElementById('limitSignInOverlay').style.display = '';
  setTimeout(() => document.addEventListener('click', _limitSignInOutside), 0);
}

function _closeLimitSignIn() {
  document.getElementById('limitSignInOverlay').style.display = 'none';
  document.removeEventListener('click', _limitSignInOutside);
}

// Single tier-selection surface (Year / Lifetime, plus the free-trial card on
// first sign-in). Opened from every "go to purchase" entry point so the plan
// choice is available everywhere. trial:false hides the free-trial card (upgrade
// context: paywall / settings / badge / nudge).
function openPlanChooser(opts = {}) {
  const showTrial = opts.trial !== false;
  const freeBtn = document.getElementById('trialFreeBtn');
  if (freeBtn) freeBtn.style.display = showTrial ? '' : 'none';
  // Onboarding (trial:true) forces a choice → no close, keeps the welcome copy.
  // Upgrade (trial:false) is dismissable via ✕ and drops the onboarding text.
  document.getElementById('trialCloseBtn').style.display = showTrial ? 'none' : '';
  const titleEl = document.querySelector('.trial-choose-title');
  const subEl   = document.querySelector('.trial-choose-sub');
  const footEl  = document.querySelector('.trial-choose-footer');
  if (titleEl) titleEl.textContent = showTrial ? T('trial.chooseTitle') : T('common.choosePlan');
  if (subEl)  subEl.style.display  = showTrial ? '' : 'none';
  if (footEl) footEl.style.display = showTrial ? '' : 'none';
  document.getElementById('trialChooseState').style.display = '';
  document.getElementById('trialPurchaseState').style.display = 'none';
  document.getElementById('paywallOverlay').style.display = 'none';
  document.getElementById('trialOverlay').style.display = '';
}

function _closePlanChooser() {
  // Жёсткого пейвола больше нет: по истечении триала юзер в free-тире 3/30,
  // поэтому просто закрываем выбор тарифа и пускаем в приложение.
  document.getElementById('trialOverlay').style.display = 'none';
}
document.getElementById('trialCloseBtn').addEventListener('click', _closePlanChooser);

// Compact plan cards (name + price + one benefit line) for the paywall and the
// last-day nudge — same idea as the /buy page, tier choice inline with no extra
// "chooser" window. Always dark (these modals are always dark). `beforeCheckout`
// runs first (e.g. close the current popup).
function planCards(beforeCheckout) {
  const wrap = document.createElement('div');
  wrap.className = 'plan-cards';
  const mk = (plan, name, priceDisp, sub, primary) => {
    const c = document.createElement('button');
    c.className = 'plan-mini' + (primary ? ' plan-mini--primary' : '');
    const row = document.createElement('span'); row.className = 'plan-mini__row';
    const nm = document.createElement('span'); nm.className = 'plan-mini__name';  nm.textContent = name;
    const pr = document.createElement('span'); pr.className = 'plan-mini__price'; pr.textContent = priceDisp;
    row.appendChild(nm); row.appendChild(pr);
    const sb = document.createElement('span'); sb.className = 'plan-mini__sub'; sb.textContent = sub;
    c.appendChild(row); c.appendChild(sb);
    c.addEventListener('click', () => { if (beforeCheckout) beforeCheckout(); startCheckout(plan); });
    return c;
  };
  wrap.appendChild(mk('year',     T('trial.yearName'),     YEAR_DISPLAY,  T('trial.year3'), false));
  wrap.appendChild(mk('lifetime', T('trial.lifetimeName'), PRICE_DISPLAY, T('trial.life1'), true));
  return wrap;
}

// Two direct buy buttons (Year / Lifetime with price) for compact inline surfaces
// like Settings. `beforeCheckout` runs first (e.g. close the current modal).
function planButtons(beforeCheckout) {
  const wrap = document.createElement('div');
  wrap.className = 'st-plan-buttons';
  const mk = (plan, name, priceDisp, primary) => {
    const b = document.createElement('button');
    b.className = 'st-action-btn ' + (primary ? 'st-action-btn--buy' : 'st-action-btn--buy2');
    b.textContent = `${name} · ${priceDisp}`;
    b.addEventListener('click', () => { if (beforeCheckout) beforeCheckout(); startCheckout(plan); });
    return b;
  };
  wrap.appendChild(mk('year',     T('trial.yearName'),     YEAR_DISPLAY,  false));
  wrap.appendChild(mk('lifetime', T('trial.lifetimeName'), PRICE_DISPLAY, true));
  return wrap;
}

function _afterSignIn() {
  // Вход теперь опционален (синхронизация + лицензия за аккаунтом). Ничего не форсим:
  // ни выбор тарифа, ни пейвол — человек уже пользуется приложением. Триал стартует
  // при первом открытии (checkOnboarding). На всякий случай гарантируем trial-start.
  if (!localStorage.getItem('mz-trial-start')) {
    localStorage.setItem('mz-trial-start', String(Date.now()));
    trackOnce('mz-ga-trial-sent', 'trial_start');
  }
}

// Лимит-хит ведёт на покупку: закрываем подсказку и открываем выбор тарифа.
document.getElementById('limitSignInGoogleBtn').addEventListener('click', () => {
  _closeLimitSignIn();
  openPlanChooser({ trial: false });
});
function _limitSignInOutside(e) {
  if (!e.target.closest('.limit-signin-card')) _closeLimitSignIn();
}

document.getElementById('limitSignInCloseBtn').addEventListener('click', _closeLimitSignIn);

// ── Onboarding ──
// true, как только юзер сделал любой выбор (логин/гость). Если ушёл, не выбрав —
// шлём onboarding_abandoned (см. слушатель pagehide ниже).
let _onboardDecided = false;

function checkOnboarding() {
  // If user is not signed in with Google, force onboarding overlay
  if (!S.user?.signedIn) {
    showOnboarding();
  } else if (!localStorage.getItem('mz-plan-chosen') && !isPaid()) {
    openPlanChooser({ trial: true });
  }
}

function showOnboarding() {
  _onboardDecided = false;
  track('onboarding_shown');
  // Reset to main state in case error was shown before
  document.getElementById('onboardMain').style.display = '';
  document.getElementById('onboardError').style.display = 'none';
  const btn = document.getElementById('onboardGoogleBtn');
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> ${T('onboard.google')}`;
  btn.disabled = false;
  document.getElementById('onboardOverlay').style.display = '';
}

function closeOnboarding() {
  localStorage.setItem('mz-onboard-done', '1');
  document.getElementById('onboardOverlay').style.display = 'none';
  setTimeout(() => startTour(), 400);
}

function _onboardSignIn(btn) {
  btn.innerHTML = T('signin.inProgress'); btn.disabled = true;
  _onboardDecided = true;
  _trackSignin('onboarding', signInGoogle()).then(() => {
    document.getElementById('onboardOverlay').style.display = 'none';
    localStorage.setItem('mz-onboard-done', '1');
    if (!localStorage.getItem('mz-trial-start')) {
      localStorage.setItem('mz-trial-start', String(Date.now()));
      trackOnce('mz-ga-trial-sent', 'trial_start');
    }
    if (isPaid() || localStorage.getItem('mz-plan-chosen')) return; // already picked a plan
    openPlanChooser({ trial: true });
  }).catch(err => {
    console.error('[Wallpaper] Sign-in failed:', err);
    document.getElementById('onboardMain').style.display = 'none';
    document.getElementById('onboardError').style.display = '';
  });
}

document.getElementById('trialFreeBtn').addEventListener('click', () => {
  localStorage.setItem('mz-plan-chosen', '1');
  // Старт 7-дневного триала локально, без логина.
  if (!localStorage.getItem('mz-trial-start')) {
    localStorage.setItem('mz-trial-start', String(Date.now()));
    trackOnce('mz-ga-trial-sent', 'trial_start');
  }
  track('plan_chosen', { plan: 'free' });
  document.getElementById('trialOverlay').style.display = 'none';
  setTimeout(() => startTour(), 300);
});
document.getElementById('trialYearBtn').addEventListener('click', () => {
  startCheckout('year');
});
document.getElementById('trialLifetimeBtn').addEventListener('click', () => {
  startCheckout('lifetime');
});
// Куплено на сайте: сразу к ключу, без прогона через чекаут, который открыл бы
// вкладку оплаты уже заплатившему человеку. Оверлей триала остаётся под низом,
// поэтому «Назад» из модалки сам вернёт выбор тарифа.
document.getElementById('trialHaveKeyBtn').addEventListener('click', () => {
  track('activation_from_trial_link');
  showActivationModal();
});

document.getElementById('trialPurchasedBtn').addEventListener('click', () => {
  showActivationModal({
    onBack: () => {
      document.getElementById('trialPurchaseState').style.display = '';
    }
  });
});
document.getElementById('trialBackBtn').addEventListener('click', () => {
  document.getElementById('trialPurchaseState').style.display = 'none';
  document.getElementById('trialChooseState').style.display = '';
});

document.getElementById('onboardGoogleBtn').addEventListener('click', () => {
  _onboardSignIn(document.getElementById('onboardGoogleBtn'));
});

document.getElementById('onboardRetryBtn').addEventListener('click', () => {
  document.getElementById('onboardMain').style.display = '';
  document.getElementById('onboardError').style.display = 'none';
  _onboardSignIn(document.getElementById('onboardGoogleBtn'));
});

// Sign in is mandatory, guest option removed.

// Увидел экран онбординга и ушёл, ничего не выбрав, — твоя гипотеза «увидел логин и закрыл».
window.addEventListener('pagehide', () => {
  const overlay = document.getElementById('onboardOverlay');
  if (overlay && overlay.style.display !== 'none' && !_onboardDecided) {
    track('onboarding_abandoned');
  }
}, { capture: true });

// ── Settings ──
function _settingsOutsideClick(e) {
  if (!_settingsOpen) return;
  const modal = document.querySelector('.settings-modal');
  const btn = document.getElementById('settingsSideBtn');
  if (modal && !modal.contains(e.target) && (!btn || !btn.contains(e.target))) {
    closeSettingsModal();
  }
}

let _settingsInitStyle = null;
let _settingsOpen = false;

function openSettingsModal() {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay) return;
  overlay.classList.remove('closing');
  overlay.style.display = 'flex';
  _settingsOpen = true;
  _settingsInitStyle = JSON.parse(JSON.stringify(S.themeStyle || {}));
  try {
    renderSettingsBody();
    const body = document.getElementById('settingsBody');
    if (body) body.scrollTop = 0;
  } catch (err) {
    console.error('[Wallpaper] Settings render error:', err);
  }
  setTimeout(() => document.addEventListener('click', _settingsOutsideClick), 10);
}

function closeSettingsModal() {
  _settingsOpen = false;
  document.removeEventListener('click', _settingsOutsideClick);
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.classList.remove('closing');
  const modal = document.querySelector('.settings-modal');
  if (modal) { modal.style.left = ''; modal.style.top = ''; modal.style.transform = ''; }
}

function renderSettingsBody() {
  const body = document.getElementById('settingsBody');
  if (!body) return;
  body.innerHTML = '';

  if (typeof window._activeSettingsTab === 'undefined') {
    window._activeSettingsTab = 'account';
  }

  const tabAccount = document.createElement('div');
  tabAccount.className = 'st-tab-content' + (window._activeSettingsTab === 'account' ? ' active' : '');
  tabAccount.dataset.tab = 'account';

  const tabAppearance = document.createElement('div');
  tabAppearance.className = 'st-tab-content' + (window._activeSettingsTab === 'appearance' ? ' active' : '');
  tabAppearance.dataset.tab = 'appearance';

  const tabLayout = document.createElement('div');
  tabLayout.className = 'st-tab-content' + (window._activeSettingsTab === 'layout' ? ' active' : '');
  tabLayout.dataset.tab = 'layout';

  const tabSystem = document.createElement('div');
  tabSystem.className = 'st-tab-content' + (window._activeSettingsTab === 'system' ? ' active' : '');
  tabSystem.dataset.tab = 'system';

  const nav = document.getElementById('settingsNav');
  if (nav) {
    nav.innerHTML = '';
    const tabs = [
      { id: 'account', icon: '👤', label: T('st.account') },
      { id: 'appearance', icon: '🎨', label: T('st.appearance') },
      { id: 'layout', icon: '📏', label: T('st.boards') },
      { id: 'system', icon: '⚙️', label: T('st.general') }
    ];
    tabs.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'st-tab-btn' + (window._activeSettingsTab === t.id ? ' active' : '');
      btn.innerHTML = `<span class="st-tab-icon">${t.icon}</span> <span class="st-tab-text">${t.label}</span>`;
      btn.addEventListener('click', () => {
        window._activeSettingsTab = t.id;
        nav.querySelectorAll('.st-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        body.querySelectorAll('.st-tab-content').forEach(c => {
          c.classList.toggle('active', c.dataset.tab === t.id);
        });
      });
      nav.appendChild(btn);
    });
  }

  function section(title) {
    const s = document.createElement('div');
    s.className = 'st-section';
    const h = document.createElement('div');
    h.className = 'st-section-title';
    h.textContent = title;
    s.appendChild(h);
    return s;
  }
  function row(label, control) {
    const r = document.createElement('div');
    r.className = 'st-row';
    const l = document.createElement('span');
    l.className = 'st-row-label';
    l.textContent = label;
    r.appendChild(l);
    r.appendChild(control);
    return r;
  }
  function toggle(val, onChange) {
    const btn = document.createElement('button');
    btn.className = 'st-toggle' + (val ? ' on' : '');
    btn.innerHTML = '<span class="st-toggle-knob"></span>';
    btn.addEventListener('click', () => {
      const next = !btn.classList.contains('on');
      btn.classList.toggle('on', next);
      onChange(next);
    });
    return btn;
  }
  function btnGroup(options, current, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'st-btn-group';
    options.forEach(({ value, label: lbl }) => {
      const b = document.createElement('button');
      b.className = 'st-group-btn' + (current === value ? ' active' : '');
      b.textContent = lbl;
      b.addEventListener('click', () => {
        wrap.querySelectorAll('.st-group-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        onChange(value);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  // ── Account ──
  const accSec = section(T('st.account'));
  if (S.user?.signedIn) {
    const profile = document.createElement('div');
    profile.className = 'st-profile';
    if (S.user.avatar) {
      const img = document.createElement('img');
      img.src = S.user.avatar; img.className = 'st-avatar';
      img.onerror = () => { img.replaceWith(initials()); };
      profile.appendChild(img);
    } else { profile.appendChild(initials()); }
    const info = document.createElement('div');
    info.className = 'st-profile-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'st-profile-name'; nameEl.textContent = S.user.name || T('st.user');
    const emailEl = document.createElement('div');
    emailEl.className = 'st-profile-email'; emailEl.textContent = S.user.email;
    info.appendChild(nameEl); info.appendChild(emailEl);
    profile.appendChild(info);
    const signOutBtn = document.createElement('button');
    signOutBtn.className = 'st-action-btn st-action-btn--compact';
    signOutBtn.textContent = T('st.signOut');
    signOutBtn.addEventListener('click', signOutGoogle);
    profile.appendChild(signOutBtn);
    accSec.appendChild(profile);
  } else {
    const syncDesc = document.createElement('p');
    syncDesc.className = 'st-plan-guest';
    syncDesc.style.margin = '0 0 12px';
    syncDesc.textContent = T('st.syncDesc');
    accSec.appendChild(syncDesc);
    const googleBtn = document.createElement('button');
    googleBtn.className = 'st-google-btn';
    googleBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> ${T('onboard.google')}`;
    googleBtn.addEventListener('click', async () => {
      googleBtn.textContent = T('signin.inProgress'); googleBtn.disabled = true;
      try {
        await _trackSignin('settings', signInGoogle());
        closeSettingsModal();
        localStorage.setItem('mz-onboard-done', '1');
        _afterSignIn();
      } catch {
        googleBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> ${T('onboard.google')}`; googleBtn.disabled = false;
      }
    });
    accSec.appendChild(googleBtn);
  }
  const dlBtn = document.createElement('button');
  dlBtn.className = 'st-link';
  dlBtn.textContent = T('st.download');
  dlBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'newtab-data.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  accSec.appendChild(dlBtn);
  tabAccount.appendChild(accSec);

  // ── Access ──
  const planSec = section(T('st.access'));
  // Раздел зависит от статуса триала/оплаты, а не от логина: триал теперь идёт
  // и без входа, поэтому «войдите, чтобы открыть доступ» здесь неуместно.
  {
    const status = getTrialStatus();
    const start = parseInt(localStorage.getItem('mz-trial-start') || '0', 10);

    if (status === 'paid') {
      const statusRow = document.createElement('div');
      statusRow.className = 'st-plan-row';
      const endsAt = yearAccessEndsAt();
      const paidLabel = endsAt
        ? T('st.yearActive', { date: new Date(endsAt).toLocaleDateString() })
        : T('st.paidActive');
      statusRow.innerHTML = `<span class="st-plan-badge paid">${paidLabel}</span>`;
      planSec.appendChild(statusRow);
      const thankNote = document.createElement('p');
      thankNote.className = 'st-plan-guest';
      thankNote.textContent = T('st.thanks');
      planSec.appendChild(thankNote);
    } else if (status === 'trial') {
      const daysLeft = Math.max(0, Math.ceil(TRIAL_DAYS - (Date.now() - start) / 86400000));
      const statusRow = document.createElement('div');
      statusRow.className = 'st-plan-row';
      statusRow.innerHTML = `<span class="st-plan-badge trial">${T('st.freeTrial')}</span><span class="st-plan-days">${T('st.daysLeft', { n: daysLeft })}</span>`;
      planSec.appendChild(statusRow);
      planSec.appendChild(planButtons(closeSettingsModal));
    } else {
      const statusRow = document.createElement('div');
      statusRow.className = 'st-plan-row';
      statusRow.innerHTML = `<span class="st-plan-badge expired">${T('st.freePlan')}</span>`;
      planSec.appendChild(statusRow);
      const freeNote = document.createElement('p');
      freeNote.className = 'st-plan-guest';
      freeNote.textContent = T('st.freePlanNote');
      planSec.appendChild(freeNote);
      planSec.appendChild(planButtons(closeSettingsModal));
    }
  }
  tabAccount.appendChild(planSec);

  // ── Appearance ──
  const appSec = section(T('st.appearance'));
  const ts = S.themeStyle;

  function stColorField(label, currentHex, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'st-color-field';
    const l = document.createElement('span'); l.className = 'st-row-label'; l.textContent = label;
    const lbl = document.createElement('label'); lbl.style.cssText = 'display:block;cursor:pointer;position:relative;margin-top:6px;';
    const swatch = document.createElement('div'); swatch.className = 'st-color-swatch';
    swatch.style.background = currentHex;
    const picker = document.createElement('input');
    picker.type = 'color'; picker.value = currentHex;
    picker.style.cssText = 'position:absolute;opacity:0;width:0;height:0;';
    const onInput = () => { swatch.style.background = picker.value; onChange(picker.value); };
    picker.addEventListener('input', onInput); picker.addEventListener('change', onInput);
    lbl.appendChild(swatch); lbl.appendChild(picker);
    wrap.appendChild(l); wrap.appendChild(lbl);
    return wrap;
  }

  function stSliderField(label, min, max, step, current, unit, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'st-slider-field';
    const top = document.createElement('div');
    top.className = 'st-color-field-top';
    const l = document.createElement('span'); l.className = 'st-row-label'; l.textContent = label;
    const valSpan = document.createElement('span'); valSpan.className = 'se-hex-val'; valSpan.textContent = current + unit;
    top.appendChild(l); top.appendChild(valSpan);
    const slider = document.createElement('input');
    slider.type = 'range'; slider.className = 'se-slider st-slider';
    slider.min = min; slider.max = max; slider.step = step; slider.value = current;
    const updateFill = () => {
      const pct = (slider.value - min) / (max - min) * 100;
      slider.style.background = `linear-gradient(to right, var(--accent-color,#fff) ${pct}%, rgba(255,255,255,0.12) ${pct}%)`;
    };
    updateFill();
    slider.addEventListener('input', () => { valSpan.textContent = slider.value + unit; updateFill(); onChange(+slider.value); });
    wrap.appendChild(top); wrap.appendChild(slider);
    return wrap;
  }

  const applyAndSave = () => {
    applyThemeStyle(S.themeStyle);
    // Persist style changes to the active wallpaper history entry
    if (S.currentWallId) {
      const entry = (S.wallpaperHistory || []).find(h => h.id === S.currentWallId);
      if (entry) entry.themeStyle = JSON.parse(JSON.stringify(S.themeStyle));
    }
    saveState();
  };

  const colorPair = document.createElement('div');
  colorPair.className = 'st-color-pair';
  colorPair.appendChild(stColorField(T('st.primaryColor'), ts.accentHex || '#ffffff',
    v => { S.themeStyle.accentHex = v; applyAndSave(); }));
  colorPair.appendChild(stColorField(T('st.boardColor'), ts.boardColorHex || '#ffffff',
    v => { S.themeStyle.boardColorHex = v; applyAndSave(); }));
  appSec.appendChild(colorPair);
  appSec.appendChild(stSliderField(T('st.opacity'), 0, 100, 1, ts.boardOpacity ?? 5, '%',
    v => { S.themeStyle.boardOpacity = v; applyAndSave(); }));
  appSec.appendChild(stSliderField(T('st.blur'), 0, 40, 1, ts.boardBlur ?? 12, 'px',
    v => { S.themeStyle.boardBlur = v; applyAndSave(); }));
  // Auto Wallpaper Carousel
  const carouselSel = document.createElement('select');
  carouselSel.className = 'st-select';
  const carouselOptions = [
    { value: 'off', label: T('st.autoWpOff') },
    { value: 'newtab', label: T('st.autoWpNewtab') },
    { value: '24h', label: T('st.autoWpDaily') }
  ];
  carouselOptions.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    if (S.autoWallpaperCarousel === o.value || (!S.autoWallpaperCarousel && o.value === 'off')) opt.selected = true;
    carouselSel.appendChild(opt);
  });
  carouselSel.addEventListener('change', () => {
    S.autoWallpaperCarousel = carouselSel.value;
    saveState();
  });
  appSec.appendChild(row(T('st.autoWallpaper'), carouselSel));

  // Кнопки Cancel / Reset
  const styleBtnRow = document.createElement('div');
  styleBtnRow.style.cssText = 'display:flex;gap:8px;margin-top:4px;';
  const cancelStyleBtn = document.createElement('button');
  cancelStyleBtn.className = 'st-btn';
  cancelStyleBtn.textContent = T('common.cancel');
  cancelStyleBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (_settingsInitStyle) { S.themeStyle = JSON.parse(JSON.stringify(_settingsInitStyle)); applyThemeStyle(S.themeStyle); saveState(); renderSettingsBody(); }
  });
  const resetStyleBtn = document.createElement('button');
  resetStyleBtn.className = 'st-btn';
  resetStyleBtn.textContent = T('common.reset');
  resetStyleBtn.addEventListener('click', e => {
    e.stopPropagation();
    S.themeStyle = { ...S.themeStyle, boardColorHex: '#ffffff', boardOpacity: 5, boardBlur: 12, accentHex: '#ffffff' };
    applyThemeStyle(S.themeStyle); saveState(); renderSettingsBody();
  });
  styleBtnRow.appendChild(cancelStyleBtn); styleBtnRow.appendChild(resetStyleBtn);
  appSec.appendChild(styleBtnRow);

  tabAppearance.appendChild(appSec);

  // ── Board text ──
  const textSec = section(T('st.boardText'));
  textSec.appendChild(row(T('st.size'), btnGroup(
    [{ value: 0.9, label: 'S' }, { value: 1, label: 'M' }, { value: 1.15, label: 'L' }],
    ts.textScale ?? 1, v => { S.themeStyle.textScale = v; applyAndSave(); })));
  textSec.appendChild(row(T('st.weight'), btnGroup(
    [{ value: false, label: T('common.normal') }, { value: true, label: T('common.bold') }],
    ts.textBold ?? false, v => { S.themeStyle.textBold = v; applyAndSave(); })));
  tabAppearance.appendChild(textSec);

  // ── General ──
  const genSec = section(T('st.general'));
  genSec.appendChild(row(T('st.openNewTab'), toggle(
    S.openInNewTab !== false,
    val => {
      S.openInNewTab = val;
      saveState();
      document.querySelectorAll('a.link-item').forEach(a => { a.target = val ? '_blank' : '_self'; });
    }
  )));

  // Hide extra bookmarks with count sub-option
  const hideRow = document.createElement('div');
  hideRow.className = 'st-row';
  const hideLabel = document.createElement('span');
  hideLabel.className = 'st-row-label';
  hideLabel.textContent = T('st.hideExtra');
  const hideRight = document.createElement('div');
  hideRight.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const countSel = document.createElement('select');
  countSel.className = 'st-select';
  countSel.style.display = S.hideExtraBookmarks ? '' : 'none';
  [5, 10, 15, 20].forEach(n => {
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = T('st.showN', { n });
    if (n === S.maxBookmarksShown) opt.selected = true;
    countSel.appendChild(opt);
  });
  countSel.addEventListener('change', () => {
    S.maxBookmarksShown = +countSel.value; saveState(); renderBoards();
  });
  const hideToggle = toggle(!!S.hideExtraBookmarks, val => {
    S.hideExtraBookmarks = val;
    countSel.style.display = val ? '' : 'none';
    saveState(); renderBoards();
  });
  hideRight.appendChild(countSel);
  hideRight.appendChild(hideToggle);
  hideRow.appendChild(hideLabel);
  hideRow.appendChild(hideRight);
  genSec.appendChild(hideRow);

  genSec.appendChild(row(T('st.showDescriptions'), toggle(
    !!S.showDescriptions,
    val => { S.showDescriptions = val; applyDescriptionsMode(); saveState(); }
  )));

  // ── Boards (layout) ──
  const boardsSec = section(T('st.boards'));

  // Max board columns (Auto = fit to window width). The <select> always shows
  // the EFFECTIVE column count (capped to what the window fits), never a chosen
  // number that can't physically be displayed.
  const colsSel = document.createElement('select');
  colsSel.className = 'st-select';
  const autoOpt = document.createElement('option');
  autoOpt.value = 'auto'; autoOpt.textContent = T('st.colsAuto');
  if (!S.maxBoardCols) autoOpt.selected = true;
  colsSel.appendChild(autoOpt);
  const effSel = S.maxBoardCols ? Math.min(S.maxBoardCols, getLayoutParams().autoCols) : null;
  [4, 5, 6, 7, 8, 9].forEach(n => {
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    if (n === effSel) opt.selected = true;
    colsSel.appendChild(opt);
  });

  // One-off hint: shown only right after the user picks a count that can't fit
  // the current window. It is NOT restored when settings reopen — it's a passing
  // notice, not a persistent warning. Dismissable, and re-appears on a new pick.
  const colsHint = document.createElement('div');
  colsHint.className = 'st-field-hint';
  colsHint.style.display = 'none';
  const colsHintText = document.createElement('span');
  const colsHintClose = document.createElement('button');
  colsHintClose.className = 'st-field-hint-close';
  colsHintClose.textContent = '×';
  colsHintClose.setAttribute('aria-label', T('common.close'));
  colsHintClose.addEventListener('click', () => { colsHint.style.display = 'none'; });
  colsHint.appendChild(colsHintText);
  colsHint.appendChild(colsHintClose);
  // Re-snap the visible selection + hint to what the current width can fit.
  // showHint=true only right after an explicit column pick (a passing notice).
  const refreshColsDisplay = (showHint) => {
    const fits = getLayoutParams().autoCols;
    if (S.maxBoardCols) colsSel.value = String(Math.min(S.maxBoardCols, fits));
    if (showHint && S.maxBoardCols && S.maxBoardCols > fits) {
      colsHintText.textContent = T('st.colsHint', { n: fits });
      colsHint.style.display = '';
    } else {
      colsHint.style.display = 'none';
    }
  };
  colsSel.addEventListener('change', () => {
    S.maxBoardCols = colsSel.value === 'auto' ? null : +colsSel.value;
    saveState(); renderBoards();
    refreshColsDisplay(true);
    bwSync();   // the fit-cap changed → refresh the width slider's ceiling
  });
  boardsSec.appendChild(row(T('st.boardColumns'), colsSel));
  boardsSec.appendChild(colsHint);

  // Board width — independent of the column count. The slider's MAX is the widest
  // the current column count actually allows (the fit-cap), so the handle can't be
  // dragged past the point where boards stop growing and the px readout stays true.
  // S.boardWidth keeps the desired value, so fewer columns auto-widen the boards.
  const BW_MIN = 190, BW_AUTO_MAX = 380;
  const bwWrap = document.createElement('div');
  bwWrap.className = 'st-slider-field';
  const bwTop = document.createElement('div');
  bwTop.className = 'st-color-field-top';
  const bwLabel = document.createElement('span');
  bwLabel.className = 'st-row-label'; bwLabel.textContent = T('st.boardWidth');
  const bwVal = document.createElement('span');
  bwVal.className = 'se-hex-val';
  bwTop.appendChild(bwLabel); bwTop.appendChild(bwVal);
  const bwSlider = document.createElement('input');
  // step=1 so the max (an arbitrary fit-cap like 329px) is always reachable and
  // the handle travels the full track — a step of 10 would stop short of a
  // non-round max, leaving a visible gap at the right end.
  bwSlider.type = 'range'; bwSlider.className = 'se-slider st-slider';
  bwSlider.min = BW_MIN; bwSlider.step = 1;
  const bwFill = () => {
    const min = +bwSlider.min, max = +bwSlider.max;
    const pct = max > min ? (bwSlider.value - min) / (max - min) * 100 : 100;
    bwSlider.style.background = `linear-gradient(to right, var(--accent-color,#fff) ${pct}%, rgba(255,255,255,0.12) ${pct}%)`;
  };
  // Reconcile the slider with the current fit-cap (called on open + on column change).
  function bwSync() {
    const cap = S.maxBoardCols ? getLayoutParams().fitW : BW_AUTO_MAX;
    bwSlider.max = Math.max(BW_MIN, cap);
    const shown = Math.min(S.boardWidth || 260, +bwSlider.max);
    bwSlider.value = shown;
    bwVal.textContent = shown + 'px';
    bwFill();
  }
  bwSlider.addEventListener('input', () => {
    S.boardWidth = +bwSlider.value;
    bwVal.textContent = bwSlider.value + 'px';
    bwFill();
    saveState(); renderBoards(); refreshColsDisplay(false);
  });
  bwWrap.appendChild(bwTop); bwWrap.appendChild(bwSlider);
  bwSync();
  boardsSec.appendChild(bwWrap);

  tabLayout.appendChild(boardsSec);
  tabSystem.appendChild(genSec);

  // ── Quick Save ──
  const qsSec = section(T('st.quickSave'));
  const qsBoards = S.boards.filter(b => b.type !== 'calendar' && b.type !== 'pomodoro' && b.type !== 'notes' && b.type !== 'search');
  if (qsBoards.length) {
    const qsPages = S.pages || [];
    const curQsBoard = qsBoards.find(b => b.id === S.quickSaveBoard);
    let curQsPageId = curQsBoard?.pageId || qsPages[0]?.id;

    if (qsPages.length > 1) {
      const pageRow = document.createElement('div');
      pageRow.className = 'st-row';
      const pageLabel = document.createElement('span');
      pageLabel.className = 'st-row-label';
      pageLabel.textContent = T('st.saveToPage');
      const pageSel = document.createElement('select');
      pageSel.className = 'st-select';
      qsPages.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id; opt.textContent = p.name;
        if (p.id === curQsPageId) opt.selected = true;
        pageSel.appendChild(opt);
      });
      pageRow.appendChild(pageLabel);
      pageRow.appendChild(pageSel);
      qsSec.appendChild(pageRow);

      const boardRow = document.createElement('div');
      boardRow.className = 'st-row';
      const boardLabel = document.createElement('span');
      boardLabel.className = 'st-row-label';
      boardLabel.textContent = T('st.saveToBoard');
      const boardSel = document.createElement('select');
      boardSel.className = 'st-select';

      function refreshQsBoards(pageId) {
        boardSel.innerHTML = '';
        qsBoards.filter(b => b.pageId === pageId).forEach(b => {
          const opt = document.createElement('option');
          opt.value = b.id; opt.textContent = b.title || b.name || 'Untitled';
          if (b.id === S.quickSaveBoard) opt.selected = true;
          boardSel.appendChild(opt);
        });
        if (!S.quickSaveBoard || !boardSel.querySelector(`[value="${S.quickSaveBoard}"]`)) {
          S.quickSaveBoard = boardSel.value; saveState();
        }
      }
      refreshQsBoards(curQsPageId);
      pageSel.addEventListener('change', () => { refreshQsBoards(pageSel.value); });
      boardSel.addEventListener('change', () => { S.quickSaveBoard = boardSel.value; saveState(); });
      boardRow.appendChild(boardLabel);
      boardRow.appendChild(boardSel);
      qsSec.appendChild(boardRow);
    } else {
      const destRow = document.createElement('div');
      destRow.className = 'st-row';
      const destLabel = document.createElement('span');
      destLabel.className = 'st-row-label';
      destLabel.textContent = T('st.saveToBoard');
      const destSel = document.createElement('select');
      destSel.className = 'st-select';
      qsBoards.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id; opt.textContent = b.title || b.name || 'Untitled';
        if (b.id === S.quickSaveBoard || (!S.quickSaveBoard && b === qsBoards[0])) opt.selected = true;
        destSel.appendChild(opt);
      });
      if (!S.quickSaveBoard) { S.quickSaveBoard = qsBoards[0].id; saveState(); }
      destSel.addEventListener('change', () => { S.quickSaveBoard = destSel.value; saveState(); });
      destRow.appendChild(destLabel);
      destRow.appendChild(destSel);
      qsSec.appendChild(destRow);
    }
  }
  const popupRow = document.createElement('div');
  popupRow.className = 'st-row';
  popupRow.innerHTML = `<span class="st-row-label">${T('st.shortcut')}</span>`;
  const popupRight = document.createElement('div');
  popupRight.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const popupKbd = document.createElement('kbd');
  popupKbd.className = 'st-kbd';
  popupKbd.textContent = '…';
  if (typeof chrome !== 'undefined' && chrome.commands && typeof chrome.commands.getAll === 'function') {
    try {
      chrome.commands.getAll(cmds => {
        const cmd = (cmds || []).find(c => c.name === '_execute_action');
        popupKbd.textContent = cmd?.shortcut || T('st.notSet');
      });
    } catch (_) {
      popupKbd.textContent = T('st.notSet');
    }
  } else {
    popupKbd.textContent = T('st.notSet');
  }
  const changeBtn = document.createElement('button');
  changeBtn.className = 'st-action-btn';
  changeBtn.style.cssText = 'width:auto;padding:4px 10px;margin:0;font-size:11px;';
  changeBtn.textContent = T('st.change');
  changeBtn.addEventListener('click', () => { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); });
  popupRight.appendChild(popupKbd);
  popupRight.appendChild(changeBtn);
  popupRow.appendChild(popupRight);
  tabSystem.appendChild(qsSec);

  // ── Language ──
  const langSec = section(T('st.language'));
  langSec.appendChild(btnGroup(
    [{ value: 'auto', label: T('st.langAuto') }, { value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }],
    I18N.currentPref(),
    val => { if (val !== I18N.currentPref()) I18N.setLang(val); } // setLang persists + reloads
  ));
  tabSystem.appendChild(langSec);

  // ── Region ──
  const locSec = section(T('st.region'));
  if (!S.locale) S.locale = (typeof detectLocale === 'function' ? detectLocale() : { timeFormat: '24h', dateFormat: 'DMY', weekStart: 1, tempUnit: 'metric' });
  const loc = S.locale;

  const locTopRow = document.createElement('div');
  locTopRow.className = 'st-row';
  const autoBtn = document.createElement('button');
  autoBtn.className = 'st-btn';
  autoBtn.textContent = T('st.autoDetect');
  autoBtn.addEventListener('click', e => {
    e.stopPropagation();
    S.locale = detectLocale();
    saveState();
    renderBoards();
    renderWeatherWidget();
    renderSettingsBody();
  });
  const advBtn = document.createElement('button');
  advBtn.className = 'st-btn';
  advBtn.textContent = T('st.advancedOpen');
  advBtn.style.marginLeft = 'auto';
  const locAdvanced = document.createElement('div');
  locAdvanced.style.display = 'none';
  advBtn.addEventListener('click', () => {
    const open = locAdvanced.style.display === '';
    locAdvanced.style.display = open ? 'none' : '';
    advBtn.textContent = open ? T('st.advancedOpen') : T('st.advancedClose');
  });
  const locBtnWrap = document.createElement('div');
  locBtnWrap.style.cssText = 'display:flex;gap:6px;width:100%';
  locBtnWrap.appendChild(autoBtn);
  locBtnWrap.appendChild(advBtn);
  locTopRow.appendChild(locBtnWrap);
  locSec.appendChild(locTopRow);

  locAdvanced.appendChild(row(T('st.timeFormat'), btnGroup(
    [{ value: '24h', label: '24h' }, { value: '12h', label: '12h AM/PM' }],
    loc.timeFormat || '24h',
    val => { loc.timeFormat = val; saveState(); tickClock(); }
  )));
  locAdvanced.appendChild(row(T('st.dateFormat'), btnGroup(
    [{ value: 'DMY', label: 'DD/MM/YY' }, { value: 'MDY', label: 'MM/DD/YY' }, { value: 'YMD', label: 'YY-MM-DD' }],
    loc.dateFormat || 'DMY',
    val => { loc.dateFormat = val; saveState(); tickClock(); }
  )));
  locAdvanced.appendChild(row(T('st.weekStart'), btnGroup(
    [{ value: 1, label: T('st.monday') }, { value: 0, label: T('st.sunday') }],
    loc.weekStart ?? 1,
    val => { loc.weekStart = val; saveState(); renderBoards(); }
  )));
  locAdvanced.appendChild(row(T('st.temperature'), btnGroup(
    [{ value: 'metric', label: '°C' }, { value: 'imperial', label: '°F' }],
    loc.tempUnit || 'metric',
    val => { loc.tempUnit = val; saveState(); renderWeatherWidget(); }
  )));
  locSec.appendChild(locAdvanced);

  tabSystem.appendChild(locSec);

  // ── Sidebar ──
  const sbSec = section(T('st.sidebar'));
  sbSec.appendChild(row(T('st.alwaysShow'), toggle(
    !!S.sidebarAlwaysExpanded,
    val => { S.sidebarAlwaysExpanded = val; applySidebarMode(); saveState(); }
  )));
  tabLayout.appendChild(sbSec);

  // ── Support ──
  const supSec = section(T('st.support'));
  const versionRow = document.createElement('div');
  versionRow.className = 'st-row';
  const appVersion = chrome.runtime?.getManifest?.().version || '1.3.1';
  versionRow.innerHTML = `<span class="st-row-label">${T('st.version')}</span><span class="st-row-value">${appVersion}</span>`;
  supSec.appendChild(versionRow);

  const devRow = document.createElement('div');
  devRow.className = 'st-row';
  devRow.innerHTML = `<span class="st-row-label">Developer</span><span class="st-row-value">Abbos Azizov</span>`;
  supSec.appendChild(devRow);

  const contactRow = document.createElement('div');
  contactRow.className = 'st-row';
  contactRow.innerHTML = `<span class="st-row-label">${T('st.contact')}</span><a class="st-link" href="mailto:azizovabbos61@gmail.com">azizovabbos61@gmail.com</a>`;
  supSec.appendChild(contactRow);

  tabAccount.appendChild(supSec);

  body.appendChild(tabAccount);
  body.appendChild(tabAppearance);
  body.appendChild(tabLayout);
  body.appendChild(tabSystem);

  function initials() {
    const c = document.createElement('div');
    c.className = 'st-avatar st-avatar-initials';
    c.textContent = (S.user.name || S.user.email || '?')[0].toUpperCase();
    return c;
  }
}

function applySidebarMode() {
  document.getElementById('sidebar').classList.toggle('always-open', !!S.sidebarAlwaysExpanded);
}
function applyDescriptionsMode() {
  document.body.classList.toggle('show-descriptions', !!S.showDescriptions);
}

document.getElementById('settingsCloseBtn').addEventListener('click', closeSettingsModal);
document.getElementById('settingsSideBtn').addEventListener('click', e => {
  e.stopPropagation();
  if (_settingsOpen) {
    closeSettingsModal();
  } else {
    closeSidebar(); openSettingsModal();
  }
});

// ── Init ──
async function init() {
  await loadState();
  track('app_open', { total_boards: S.boards.length, total_bookmarks: S.bookmarks.length });
  trackDaily('daily_active');
  await loadFaviconCache();
  renderAll();
  loadSavedWallpaper();
  updateFocusStats();
  applySidebarMode();
  applyDescriptionsMode();
  checkOnboarding();
  startClock();
  window.addEventListener('resize', updateNavLayout);
  syncNavSearchCard();
  syncClockCard();
  syncCurrencyCard();
  renderCurrencyWidget();
  fetchCurrencyRate();
  updateTodoStatsWidget();
  renderWeatherWidget();
  syncWeatherCard();
  if (S.weather?.enabled) fetchWeatherData();

  document.getElementById('weatherWidget')?.addEventListener('click', showWeatherPopup);

  // Первый запуск (окно выбора триала) обрабатывает checkOnboarding() выше — для всех,
  // без привязки к логину. По истечении триала неплатящий мягко падает в free-тир 3/30,
  // жёсткого пейвола на старте больше нет.

  updateTrialBadge();
  checkTrialNudge();
  checkTrialEndedNudge();

  if (localStorage.getItem('mz-zen-mode') === '1') {
    document.body.classList.add('zen-mode-active');
  }

  document.addEventListener('dblclick', e => {
    if (!e.target || !e.target.isConnected) return;

    // Always block interactive elements
    if (e.target.closest('button, input, select, textarea, a')) return;

    // Block UI panels and overlays (both in normal and zen mode)
    if (e.target.closest('.board, .sidebar, .settings-modal, .wp-modal, .se-modal, .focus-stats-popup, .todo-stats-popup, .widget-gallery, .bk-edit-popup, .board-menu, .nsb-eng-popup, .tour-tooltip')) return;

    // In zen mode: only block clicks on the actual interactive zen widgets
    // (clock face, breath circle, dots) — clicking the background of zen-hub toggles off
    if (document.body.classList.contains('zen-mode-active')) {
      if (e.target.closest('.zen-breath-circle, .zen-breath-ring, .zen-clock-svg, .zen-dots, .zen-clock-date')) return;
      // Everything else inside zen-hub (background area) → toggle OFF
      const active = document.body.classList.toggle('zen-mode-active');
      localStorage.setItem('mz-zen-mode', active ? '1' : '0');
      return;
    }

    // Normal mode: clicking workspace background → toggle ON
    const active = document.body.classList.toggle('zen-mode-active');
    localStorage.setItem('mz-zen-mode', active ? '1' : '0');
  });
}
init();

document.getElementById('paywallWaitBackBtn')?.addEventListener('click', () => {
  document.getElementById('paywallWaitState').style.display = 'none';
  if (_checkoutFromTrial) {
    // Came from trial choose screen → return to it
    document.getElementById('paywallOverlay').style.display = 'none';
    document.getElementById('trialChooseState').style.display = '';
    document.getElementById('trialPurchaseState').style.display = 'none';
    document.getElementById('trialOverlay').style.display = '';
    _checkoutFromTrial = false;
  } else {
    // Жёсткого пейвола нет — просто закрываем, юзер продолжает в free-тире.
    document.getElementById('paywallOverlay').style.display = 'none';
  }
});
document.getElementById('paywallPurchasedBtn')?.addEventListener('click', () => {
  showActivationModal({
    onBack: () => {
      document.getElementById('paywallWaitState').style.display = '';
    }
  });
});
document.getElementById('paywallExportBtn')?.addEventListener('click', exportBookmarks);

// ── Activation modal handlers ──
_initCodeInputs();

document.getElementById('activationBackBtn').addEventListener('click', () => {
  hideActivationModal();
  if (_checkoutFromTrial) {
    document.getElementById('paywallOverlay').style.display = 'none';
    document.getElementById('trialChooseState').style.display = '';
    document.getElementById('trialPurchaseState').style.display = 'none';
    document.getElementById('trialOverlay').style.display = '';
    _checkoutFromTrial = false;
  } else {
    document.getElementById('paywallOverlay').style.display = 'none';
  }
});

document.getElementById('activationActivateBtn').addEventListener('click', async () => {
  const btn = document.getElementById('activationActivateBtn');
  const code = Array.from(document.querySelectorAll('.code-seg')).map(s => s.value).join('-');
  btn.disabled = true;
  btn.textContent = T('activation.checking');
  document.getElementById('activationError').style.display = 'none';
  const valid = await _validateCode(code);
  if (valid) {
    // Тариф берём из подошедшего ключа: он есть всегда, в отличие от
    // mz-pending-plan, которого нет у покупателя с сайта.
    const plan = valid;
    localStorage.setItem('mz-activated', '1');
    localStorage.setItem('mz-activation-code', code);
    localStorage.setItem('mz-plan', plan);
    localStorage.setItem('mz-activated-at', String(Date.now()));
    // Уже залогинен? Пропихнём лицензию в синк сразу (для незалогиненных синк
    // случится после опционального входа ниже).
    if (!isGuest()) saveState();
    trackOnce('mz-ga-purchase-sent', 'purchase', {
      value: I18N.price(plan).amount,
      currency: I18N.price(plan).currency,
      transaction_id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()),
    });
    document.getElementById('activationEnterState').style.display = 'none';
    document.getElementById('activationSuccessState').style.display = '';
    // Предлагаем войти (опционально) только если ещё не залогинен — чтобы покупка
    // помнилась на других устройствах. Ключ уже активен локально в любом случае.
    document.getElementById('activationSyncPrompt').style.display = isGuest() ? '' : 'none';
    if (_activationOnSuccess) _activationOnSuccess();
  } else {
    track('activation_failed');
    document.getElementById('activationError').style.display = '';
    btn.disabled = false;
    btn.textContent = T('activation.activate');
  }
});

// Опциональный вход после покупки: лицензия уже локальна, вход лишь синкает её на
// аккаунт. Провал входа (напр. Edge) не мешает — ключ уже активен.
document.getElementById('activationSignInBtn')?.addEventListener('click', e => {
  const b = e.currentTarget;
  const span = b.querySelector('span');
  const prev = span ? span.textContent : '';
  b.disabled = true;
  if (span) span.textContent = T('signin.inProgress');
  _trackSignin('purchase', signInGoogle()).then(() => {
    document.getElementById('activationSyncPrompt').style.display = 'none';
  }).catch(err => {
    console.error('[Wallpaper] Sign-in (post-purchase) failed:', err);
    b.disabled = false;
    if (span) span.textContent = prev;
  });
});

document.getElementById('activationDoneBtn').addEventListener('click', () => {
  hideActivationModal();
  const shouldStartTour = _checkoutFromTrial;
  _checkoutFromTrial = false;
  document.getElementById('trialOverlay').style.display = 'none';
  document.getElementById('paywallOverlay').style.display = 'none';
  localStorage.setItem('mz-plan-chosen', '1');
  updateTrialBadge();
  if (document.getElementById('settingsOverlay')?.style.display !== 'none') renderSettingsBody();
  if (shouldStartTour) setTimeout(() => startTour(), 300);
});

document.getElementById('trialBadge').addEventListener('click', () => openPlanChooser({ trial: false }));
document.getElementById('trialNudgeLaterBtn').addEventListener('click', () => {
  document.getElementById('trialNudgeOverlay').style.display = 'none';
});
document.getElementById('trialNudgeCloseBtn').addEventListener('click', () => {
  document.getElementById('trialNudgeOverlay').style.display = 'none';
});



// ── Onboarding Tour ──
const TOUR_STEPS = [
  {
    target: null,
    title: T('tour.createBoardTitle'),
    desc: T('tour.createBoardDesc'),
    pos: 'center', revealCreate: true
  },
  {
    // Есть доска → подсветим «+» на ней; нет доски → элемент не найдётся и шаг
    // автоматически станет центрированной подсказкой.
    target: '[data-tour="add-link"]',
    title: T('tour.addTitle'),
    desc: T('tour.addDesc'),
    pos: 'bottom', shape: 'circle'
  },
  {
    target: '[data-tour="add-page"]',
    title: T('tour.pagesTitle'),
    desc: T('tour.pagesDesc'),
    pos: 'bottom', shape: 'circle'
  },
  {
    target: '#menuSideBtn',
    title: T('tour.menuTitle'),
    desc: T('tour.menuDesc'),
    pos: 'left', shape: 'circle'
  },
  {
    target: '#settingsSideBtn',
    title: T('tour.settingsTitle'),
    desc: T('tour.settingsDesc'),
    pos: 'left', shape: 'circle'
  },
  {
    target: null,
    title: T('tour.saveTitle'),
    desc: T('tour.saveDesc'),
    pos: 'center'
  },
  {
    target: null,
    title: T('tour.bringTitle'),
    desc: T('tour.bringDesc'),
    pos: 'center', cta: 'import'
  },
  {
    target: null,
    title: T('tour.dragTitle'),
    desc: T('tour.dragDesc'),
    pos: 'center', demo: 'drag'
  },
  {
    target: null,
    title: T('tour.doneTitle'),
    desc: T('tour.doneDesc'),
    pos: 'center'
  }
];

let _tourStep = 0;
let _tourHighlighted = null;
// Active steps for the current run — may exclude the import/drag steps when
// the user has no Chrome bookmarks to import.
let _tourSteps = TOUR_STEPS;

function hasChromeBookmarks() {
  return new Promise(resolve => {
    if (!chrome?.bookmarks?.getTree) { resolve(false); return; }
    chrome.bookmarks.getTree(tree => {
      let found = false;
      (function walk(nodes) {
        for (const n of nodes || []) {
          if (found) return;
          if (n.url) { found = true; return; }
          if (n.children) walk(n.children);
        }
      })(tree?.[0]?.children || []);
      resolve(found);
    });
  });
}

function startTour() {
  if (localStorage.getItem('mz-tour-done')) return;
  track('tour_started');
  _tourStep = 0;
  // No bookmarks to import → drop only the import step, but keep the drag demo.
  hasChromeBookmarks().then(has => {
    _tourSteps = has ? TOUR_STEPS : TOUR_STEPS.filter(s => !s.cta);
    document.getElementById('tourOverlay').style.display = '';
    document.getElementById('tourTooltip').style.display = '';
    showTourStep(0);
  });
}

function _clearTourRects() {
  document.querySelectorAll('.tour-overlay-rect').forEach(d => d.remove());
}

function setTourOverlayMask(el, shape, customBounds) {
  const overlay = document.getElementById('tourOverlay');
  _clearTourRects();
  overlay.style.background = '';
  overlay.style.mask = overlay.style.webkitMask = '';

  if (!el) return;

  const r = customBounds || el.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;

  if (shape === 'circle') {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const radius = Math.max(r.width, r.height) / 2 + 18;
    overlay.style.background = `radial-gradient(circle ${radius}px at ${cx}px ${cy}px, transparent ${radius - 1}px, rgba(0,0,0,0.55) ${radius}px)`;
  } else {
    const pad = shape === 'large' ? 24 : 14;
    const x1 = Math.max(0, r.left - pad),   y1 = Math.max(0, r.top - pad);
    const x2 = Math.min(W, r.right + pad),  y2 = Math.min(H, r.bottom + pad);
    const dark = 'rgba(0,0,0,0.55)';
    [
      { t: 0,  l: 0,  w: W,      h: y1        },
      { t: y2, l: 0,  w: W,      h: H - y2    },
      { t: y1, l: 0,  w: x1,     h: y2 - y1   },
      { t: y1, l: x2, w: W - x2, h: y2 - y1   },
    ].forEach(({ t, l, w, h }) => {
      if (w <= 0 || h <= 0) return;
      const d = document.createElement('div');
      d.className = 'tour-overlay-rect';
      d.style.cssText = `position:fixed;z-index:800;pointer-events:none;background:${dark};top:${t}px;left:${l}px;width:${w}px;height:${h}px;`;
      document.body.appendChild(d);
    });
  }
}

function showTourStep(idx) {
  const step = _tourSteps[idx];
  track('tour_step', { index: idx });
  const el = step.target ? document.querySelector(step.target) : null;

  // Первый шаг: подсветить все способы создать доску (FAB + «+»-слоты).
  document.body.classList.toggle('tour-show-create', !!step.revealCreate);

  if (_tourHighlighted) {
    _tourHighlighted.classList.remove('tour-spotlight');
    _tourHighlighted.closest?.('.board')?.classList.remove('tour-board-reveal');
  }
  if (el) {
    el.classList.add('tour-spotlight');
    el.closest?.('.board')?.classList.add('tour-board-reveal');
    _tourHighlighted = el;
  } else { _tourHighlighted = null; }
  setTourOverlayMask(step.noSpotlight ? null : el, step.shape, step.getBounds?.());
  // Шаг с подсветкой слотов — без затемнения экрана (слоты видно на самих обоях).
  if (step.revealCreate) document.getElementById('tourOverlay').style.background = 'transparent';

  document.getElementById('tourStepLabel').textContent = T('tour.counter', { i: idx + 1, total: _tourSteps.length });
  document.getElementById('tourTitle').textContent = step.title;
  document.getElementById('tourDesc').textContent = step.desc;
  const nextBtn = document.getElementById('tourNextBtn');
  nextBtn.textContent = step.cta === 'import' ? T('tour.importBookmarks')
    : (idx === _tourSteps.length - 1 ? T('tour.done') : T('tour.next'));
  document.getElementById('tourLaterBtn').style.display = step.cta === 'import' ? '' : 'none';
  document.getElementById('tourBackBtn').style.display = (idx > 0 && step.cta !== 'import') ? '' : 'none';
  document.querySelector('.tour-footer').classList.toggle('cta', step.cta === 'import');

  // Self-contained drag illustration lives inside the tooltip (no dependency
  // on real board layout/scroll position).
  document.getElementById('tourDemo').style.display = step.demo === 'drag' ? '' : 'none';

  positionTourTooltip(el, step.pos);
}

function positionTourTooltip(el, pos) {
  const tooltip = document.getElementById('tourTooltip');
  if (!el || pos === 'center') {
    tooltip.style.top = '50%';
    tooltip.style.left = '50%';
    tooltip.style.transform = 'translate(-50%, -50%)';
    return;
  }
  const r = el.getBoundingClientRect();
  tooltip.style.transform = '';
  if (pos === 'right') {
    tooltip.style.top = Math.max(16, r.top + r.height / 2 - 80) + 'px';
    tooltip.style.left = (r.right + 16) + 'px';
  } else if (pos === 'left') {
    const rawTop = r.top + r.height / 2 - 80;
    tooltip.style.top = Math.min(Math.max(16, rawTop), window.innerHeight - 220) + 'px';
    tooltip.style.left = Math.max(16, r.left - 296) + 'px';
  } else if (pos === 'bottom') {
    tooltip.style.top = (r.bottom + 12) + 'px';
    tooltip.style.left = Math.min(r.left, window.innerWidth - 300) + 'px';
  } else if (pos === 'top') {
    // Над элементом (для нижних кнопок вроде «+ New board» в левом нижнем углу).
    const h = tooltip.offsetHeight || 180;
    tooltip.style.top = Math.max(16, r.top - 12 - h) + 'px';
    tooltip.style.left = Math.min(Math.max(16, r.left), window.innerWidth - 300) + 'px';
  }
}

function endTour(reason = 'skipped') {
  track(reason === 'completed' ? 'tour_completed' : 'tour_skipped', { step: _tourStep });
  localStorage.setItem('mz-tour-done', '1');
  document.body.classList.remove('tour-show-create');
  document.getElementById('tourOverlay').style.display = 'none';
  document.getElementById('tourTooltip').style.display = 'none';
  document.getElementById('tourDemo').style.display = 'none';
  if (_tourHighlighted) {
    _tourHighlighted.classList.remove('tour-spotlight');
    _tourHighlighted.closest?.('.board')?.classList.remove('tour-board-reveal');
    _tourHighlighted = null;
  }
  setTourOverlayMask(null);
  _clearTourRects();
}

// Opens the import modal mid-tour, hiding the tour chrome until the modal closes.
function _tourOpenImport() {
  _tourPausedForImport = true;
  _tourDidImport = false;
  document.getElementById('tourOverlay').style.display = 'none';
  document.getElementById('tourTooltip').style.display = 'none';
  _clearTourRects();
  if (_tourHighlighted) {
    _tourHighlighted.classList.remove('tour-spotlight');
    _tourHighlighted.closest?.('.board')?.classList.remove('tour-board-reveal');
    _tourHighlighted = null;
  }
  openImportModal();
}

// Called from closeImportModal when the modal was opened by the tour.
function _resumeTourAfterImport() {
  _tourPausedForImport = false;
  document.getElementById('tourOverlay').style.display = '';
  document.getElementById('tourTooltip').style.display = '';
  if (_tourDidImport) {
    _tourDidImport = false;
    _tourStep++; // advance from the import step to the drag demo
  }
  showTourStep(_tourStep);
}

document.getElementById('tourNextBtn').addEventListener('click', () => {
  const step = _tourSteps[_tourStep];
  if (step?.cta === 'import') { _tourOpenImport(); return; }
  if (_tourStep < _tourSteps.length - 1) { _tourStep++; showTourStep(_tourStep); }
  else endTour('completed');
});
document.getElementById('tourLaterBtn').addEventListener('click', () => {
  // Declined import → skip only the import, still show the drag demo next.
  if (_tourStep < _tourSteps.length - 1) { _tourStep++; showTourStep(_tourStep); }
  else endTour('completed');
});
document.getElementById('tourBackBtn').addEventListener('click', () => {
  if (_tourStep > 0) { _tourStep--; showTourStep(_tourStep); }
});
document.getElementById('tourSkipBtn').addEventListener('click', () => endTour('skipped'));



function toggleShortcutsCheatSheet() {
  const existing = document.getElementById('shortcutsOverlay');
  if (existing) {
    existing.classList.add('closing');
    setTimeout(() => existing.remove(), 200);
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'shortcutsOverlay';
  overlay.className = 'shortcuts-overlay';
  overlay.innerHTML = `
    <div class="shortcuts-modal">
      <div class="shortcuts-header">
        <span class="shortcuts-title">Keyboard Shortcuts</span>
        <button class="shortcuts-close-btn" id="shortcutsCloseBtn">×</button>
      </div>
      <div class="shortcuts-body">
        <div class="shortcut-item">
          <kbd>?</kbd>
          <span class="shortcut-desc">Toggle Keyboard Shortcuts</span>
        </div>
        <div class="shortcut-item">
          <kbd>Ctrl</kbd> + <kbd>K</kbd>
          <span class="shortcut-desc">Open Search Panel</span>
        </div>
        <div class="shortcut-item">
          <kbd>Double Click</kbd>
          <span class="shortcut-desc">Toggle Zen Mode (Minimalist Focus)</span>
        </div>
        <div class="shortcut-item">
          <kbd>Esc</kbd>
          <span class="shortcut-desc">Close Active Popup or Menu</span>
        </div>
        <div class="shortcut-item">
          <kbd>Double Click (Board Title)</kbd>
          <span class="shortcut-desc">Rename Board</span>
        </div>
        <div class="shortcut-item">
          <kbd>Double Click (Task Text)</kbd>
          <span class="shortcut-desc">Edit Todo Task Inline</span>
        </div>
      </div>
    </div>
  `;

  overlay.querySelector('#shortcutsCloseBtn').addEventListener('click', () => {
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 200);
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 200);
    }
  });

  document.body.appendChild(overlay);
}

document.addEventListener('keydown', ev => {
  if (ev.target.matches('input, textarea, select, [contenteditable]')) {
    return;
  }
  if (ev.key === '?') {
    ev.preventDefault();
    toggleShortcutsCheatSheet();
  }
});

// ══════════════════════════════════════════════════════
//   ZEN MODE — Analog Clock, Breathing, Quotes
// ══════════════════════════════════════════════════════

// ── Zen Analog Clock ──
(function initZenClockFace() {
  const NS = 'http://www.w3.org/2000/svg';
  const ticksG = document.getElementById('zenClockTicks');
  const numsG = document.getElementById('zenClockNums');
  if (!ticksG || !numsG) return;

  for (let i = 0; i < 60; i++) {
    const a = (i * 6 - 90) * (Math.PI / 180);
    const isMajor = i % 5 === 0;
    const r1 = isMajor ? 80 : 86;
    const r2 = 92;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', 100 + r1 * Math.cos(a));
    line.setAttribute('y1', 100 + r1 * Math.sin(a));
    line.setAttribute('x2', 100 + r2 * Math.cos(a));
    line.setAttribute('y2', 100 + r2 * Math.sin(a));
    line.setAttribute('class', isMajor ? 'zen-clock-tick zen-clock-tick-major' : 'zen-clock-tick');
    ticksG.appendChild(line);
  }

  [12,1,2,3,4,5,6,7,8,9,10,11].forEach(n => {
    const a = (n * 30 - 90) * (Math.PI / 180);
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', 100 + 70 * Math.cos(a));
    text.setAttribute('y', 100 + 70 * Math.sin(a));
    text.setAttribute('class', 'zen-clock-num');
    text.textContent = n;
    numsG.appendChild(text);
  });
})();

let _zenClockRAF = null;
function updateZenClock() {
  const now = new Date();
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  const ms = now.getMilliseconds();

  const secAngle = (s + ms / 1000) * 6 - 90;
  const minAngle = (m + s / 60) * 6 - 90;
  const hourAngle = (h + m / 60) * 30 - 90;

  function setHand(id, angle, len) {
    const rad = angle * (Math.PI / 180);
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('x2', 100 + len * Math.cos(rad));
    el.setAttribute('y2', 100 + len * Math.sin(rad));
  }

  setHand('zenHourHand', hourAngle, 52);
  setHand('zenMinuteHand', minAngle, 70);
  setHand('zenSecondHand', secAngle, 75);

  const dateEl = document.getElementById('zenClockDate');
  if (dateEl) {
    const opts = { weekday: 'long', month: 'long', day: 'numeric' };
    dateEl.textContent = now.toLocaleDateString(undefined, opts);
  }

  if (document.body.classList.contains('zen-mode-active')) {
    _zenClockRAF = requestAnimationFrame(updateZenClock);
  }
}

// ── Zen Breathing Text Cycle ──
let _breathInterval = null;
const BREATH_PHASES = [
  { text: 'INHALE', duration: 4000 },
  { text: 'HOLD', duration: 4000 },
  { text: 'EXHALE', duration: 4000 },
  { text: 'HOLD', duration: 4000 }
];

function startBreathCycle() {
  const el = document.getElementById('zenBreathText');
  if (!el || _breathInterval) return;
  let phase = 0;
  function tick() {
    el.textContent = BREATH_PHASES[phase].text;
    phase = (phase + 1) % BREATH_PHASES.length;
  }
  tick();
  _breathInterval = setInterval(tick, 4000);
}

function stopBreathCycle() {
  if (_breathInterval) { clearInterval(_breathInterval); _breathInterval = null; }
}

// ── Zen Carousel ──
function zenCarouselGoTo(idx) {
  const slides = document.querySelectorAll('.zen-slide');
  const dots = document.querySelectorAll('.zen-dot');
  const count = slides.length;
  const safeIdx = ((idx % count) + count) % count;
  slides.forEach((s, i) => s.classList.toggle('active', i === safeIdx));
  dots.forEach((d, i) => d.classList.toggle('active', i === safeIdx));
}

document.querySelectorAll('.zen-dot').forEach(dot => {
  dot.addEventListener('click', () => zenCarouselGoTo(+dot.dataset.slide));
});

// Touch/swipe + mouse drag support for zen carousel
(function initZenSwipe() {
  const hub = document.getElementById('zenHub');
  if (!hub) return;
  let touchStartX = 0, touchStartY = 0, isSwiping = false;

  hub.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isSwiping = false;
  }, { passive: true });

  hub.addEventListener('touchmove', e => {
    const dx = Math.abs(e.touches[0].clientX - touchStartX);
    const dy = Math.abs(e.touches[0].clientY - touchStartY);
    if (dx > dy && dx > 10) isSwiping = true;
  }, { passive: true });

  hub.addEventListener('touchend', e => {
    if (!isSwiping) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) < 40) return;
    const activeDot = document.querySelector('.zen-dot.active');
    const currentIdx = activeDot ? +activeDot.dataset.slide : 0;
    zenCarouselGoTo(dx < 0 ? currentIdx + 1 : currentIdx - 1);
    isSwiping = false;
  }, { passive: true });

  // Mouse drag (desktop)
  let mouseStartX = 0, mouseDown = false;
  hub.addEventListener('mousedown', e => {
    if (e.target.closest('button, input')) return;
    mouseStartX = e.clientX;
    mouseDown = true;
  });
  document.addEventListener('mouseup', e => {
    if (!mouseDown) return;
    mouseDown = false;
    const dx = e.clientX - mouseStartX;
    if (Math.abs(dx) < 60) return;
    const activeDot = document.querySelector('.zen-dot.active');
    const currentIdx = activeDot ? +activeDot.dataset.slide : 0;
    zenCarouselGoTo(dx < 0 ? currentIdx + 1 : currentIdx - 1);
  });
})();

// ── Motivational Quotes ──
const ZEN_QUOTES = [
  '"Be present in all things and thankful for all things."',
  '"The mind is everything. What you think you become."',
  '"Breathe in calm, breathe out tension."',
  '"In the middle of difficulty lies opportunity."',
  '"Silence is a source of great strength."',
  '"The present moment is the only moment available to us."',
  '"Don\'t let yesterday take up too much of today."',
  '"Your focus determines your reality."',
  '"Simplicity is the ultimate sophistication."',
  '"Peace comes from within. Do not seek it without."',
  '"Almost everything will work again if you unplug it for a few minutes — including you."',
  '"One conscious breath in and out is a meditation."'
];

let _quoteInterval = null;
function startQuoteRotation() {
  const el = document.getElementById('zenQuote');
  if (!el || _quoteInterval) return;
  function setRandom() {
    el.style.opacity = '0';
    setTimeout(() => {
      el.textContent = ZEN_QUOTES[Math.floor(Math.random() * ZEN_QUOTES.length)];
      el.style.opacity = '';
    }, 400);
  }
  setRandom();
  _quoteInterval = setInterval(setRandom, 12000);
}
function stopQuoteRotation() {
  if (_quoteInterval) { clearInterval(_quoteInterval); _quoteInterval = null; }
}

// ── Zen Mode Lifecycle ──
function onZenModeEnter() {
  if (_zenClockRAF) return;
  updateZenClock();
  startBreathCycle();
  startQuoteRotation();
}

function onZenModeExit() {
  if (_zenClockRAF) { cancelAnimationFrame(_zenClockRAF); _zenClockRAF = null; }
  stopBreathCycle();
  stopQuoteRotation();
}

// Patch the existing dblclick zen toggle to call lifecycle hooks
const _origZenObserver = new MutationObserver(muts => {
  for (const m of muts) {
    if (m.attributeName === 'class') {
      if (document.body.classList.contains('zen-mode-active')) {
        onZenModeEnter();
      } else {
        onZenModeExit();
      }
    }
  }
});
_origZenObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

// If zen mode was already active on load, start immediately
if (document.body.classList.contains('zen-mode-active')) {
  onZenModeEnter();
}

