// ── Localization (i18n) ──────────────────────────────────────────────
// Loaded before newtab.js / popup.js. Exposes a global `I18N` object.
//
// UI language is SEPARATE from S.locale (which controls date/time/temperature
// formatting derived from timezone). Language is chosen by browser language,
// with an optional manual override persisted in localStorage under `mz-lang`
// (values: 'auto' | 'en' | 'ru'). localStorage is shared across the extension
// origin, so the popup and the new-tab page stay in sync.
(function () {
  'use strict';

  const SUPPORTED = ['en', 'ru'];
  const LANG_KEY = 'mz-lang';

  function detectLang() {
    const nav = (typeof navigator !== 'undefined' && ((navigator.languages && navigator.languages[0]) || navigator.language)) || 'en';
    return String(nav).toLowerCase().startsWith('ru') ? 'ru' : 'en';
  }

  function resolveLang() {
    let override;
    try { override = localStorage.getItem(LANG_KEY); } catch (e) {}
    if (SUPPORTED.includes(override)) return override;
    return detectLang();
  }

  const lang = resolveLang();

  // ── Pricing per locale ──
  // Two paid tiers: `year` (access for 1 year, one-time payment — NOT a
  // subscription) and `lifetime`. Adjust amounts / currency here in one place.
  // `amount` + `currency` also feed GA4 revenue events, so keep them accurate.
  const PRICING = {
    en: {
      year:     { amount: 9,   currency: 'USD', display: '$9' },
      lifetime: { amount: 25,  currency: 'USD', display: '$25' },
    },
    ru: {
      year:     { amount: 990,  currency: 'RUB', display: '990 ₽' },
      lifetime: { amount: 1490, currency: 'RUB', display: '1490 ₽' },
    },
  };

  // ── Checkout entry point ──
  // The extension always opens ONE URL we control; that page must do an instant
  // server-side 302 to the real provider (lava.top / Stripe / Pix …) based on the
  // `plan` + `lang` params (and, better, the visitor's region/IP). Keeping the
  // provider OFF the extension lets us swap it, run promos, or fix a broken link
  // WITHOUT shipping a new version through Web Store review.
  const PAY_URL = 'https://zenwallpaper.com/pay';

  // Russian plural: n → [one, few, many]
  // 1 книга / 2 книги / 5 книг
  function plRu(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function plEn(n, one, many) { return n === 1 ? one : many; }

  // ── Strings ──
  // Values are strings (with {name} placeholders) or functions (params) => string.
  const STR = {
    en: {
      // sidebar / chrome
      'fab.newBoard': '+ New board',
      'side.search': 'Search',
      'side.wallpaper': 'Wallpaper',
      'side.widgets': 'Widgets',
      'side.import': 'Import',
      'side.trash': 'Trash',
      'side.menu': 'Menu',
      'side.settings': 'Settings',
      'side.searchTitle': 'Search (Ctrl+K)',
      'side.importTitle': 'Import bookmarks',
      // search
      'search.placeholder': 'Search bookmarks…',
      'search.widgetPlaceholder': 'Search…',
      'search.noResults': 'No results',
      'search.defaultEngine': 'Default browser',
      // import modal
      'import.header': 'Import from Chrome Bookmarks',
      'import.loading': 'Loading…',
      'import.noFolders': 'No bookmark folders found.',
      'import.failed': 'Could not load bookmarks.',
      'import.action': 'Import',
      'import.untitled': 'Untitled',
      'import.bookmarksMeta': (p) => `${p.n} bookmark${p.n !== 1 ? 's' : ''}`,
      // trash
      'trash.title': 'Trash',
      'trash.emptyConfirm': 'Empty trash?',
      'trash.deleteAll': 'Delete all',
      'trash.empty': 'Empty trash',
      'trash.isEmpty': 'Trash is empty',
      'trash.restore': 'Restore',
      'trash.boardMeta': (p) => `Board · ${p.n} link${p.n !== 1 ? 's' : ''}`,
      // wallpaper
      'wp.title': 'Wallpaper',
      'wp.upload': 'Upload image or video',
      'wp.presets': 'Presets',
      'wp.myUploads': 'My uploads',
      'wp.find': 'Find wallpapers',
      'wp.findBtn': 'Search the web for wallpapers',
      'wp.findUrl': 'https://www.google.com/search?q=live+wallpaper',
      // widgets gallery
      'widgets.label': 'Widgets',
      'widget.board': 'Board',
      'widget.notes': 'Notes',
      'widget.calendar': 'Calendar',
      'widget.pomodoro': 'Pomodoro',
      'widget.clock': 'Clock',
      'widget.currency': 'Currency',
      'widget.search': 'Search',
      'widget.weather': 'Weather',
      'widget.add': 'Add',
      'weather.cityPlaceholder': 'City name…',
      'weather.apply': 'Apply',
      // style editor
      'se.title': 'Adjust Wallpaper Style',
      'se.analyzing': 'Analyzing wallpaper…',
      'se.lightDetected': 'Light theme detected.',
      'se.darkDetected': 'Dark theme detected.',
      'se.primaryColor': 'Primary Color',
      'se.boardColor': 'Board Color',
      'se.boardOpacity': 'Board Opacity',
      'se.boardBlur': 'Board Blur',
      'se.textSize': 'Text Size',
      'se.textWeight': 'Text Weight',
      // board / bookmarks
      'board.new': 'New Board',
      'board.more': (p) => `+${p.n} more`,
      'board.showLess': 'Show less',
      'notes.placeholder': 'Write anything...',
      // weather popup
      'weather.loading': 'Loading…',
      'weather.feels': (p) => `Feels like ${p.v}`,
      'weather.wind': (p) => `Wind ${p.v} km/h`,
      'weather.updated': (p) => `Updated ${p.time}`,
      'weather.refresh': '↻ Refresh',
      // focus stats
      'focus.today': 'Focus today',
      'focus.stats': 'Focus statistics',
      'focus.week': 'This week',
      'focus.months': 'By months',
      'focus.none': 'No focus sessions yet',
      // pomodoro
      'pom.focus': 'Focus',
      'pom.short': 'Short Break',
      'pom.long': 'Long Break',
      'pom.title': 'Pomodoro',
      'pom.focusMin': 'Focus (min)',
      'pom.shortMin': 'Short break (min)',
      'pom.longMin': 'Long break (min)',
      'pom.longAfter': 'Long break after',
      // add-link popup
      'addlink.pasteUrl': 'Paste URL…',
      'addlink.name': 'Name',
      'addlink.descOptional': 'Description (optional)',
      'addlink.add': 'Add Link',
      // tooltips
      'tip.newPage': 'New page',
      'tip.addLink': 'Add link',
      'tip.skip': 'Skip',
      'tip.reset': 'Reset',
      'tip.deletePermanently': 'Delete permanently',
      'tip.remove': 'Remove',
      // context menus
      'menu.open': 'Open',
      'menu.openIncognito': 'Open in incognito',
      'menu.edit': 'Edit',
      'menu.delete': 'Delete',
      'menu.rename': 'Rename',
      'menu.openAll': 'Open all links',
      'menu.deleteBoard': 'Delete board',
      // onboarding
      'onboard.title': 'Welcome to Wallpaper',
      'onboard.sub': 'Your new tab, organized.',
      'onboard.google': 'Sign in with Google',
      'onboard.guest': 'Continue without signing in',
      'onboard.errTitle': "Sign-in didn't go through",
      'onboard.errSub': 'Something went wrong. Try again or continue without an account.',
      'onboard.retry': 'Try again',
      'signin.inProgress': 'Signing in…',
      // plan chooser
      'trial.chooseTitle': 'How would you like to start?',
      'trial.chooseSub': 'Pick one to continue.',
      'trial.freeName': 'Free trial',
      'trial.noCard': 'No card needed',
      'trial.free1': (p) => `${p.n} days of full access.`,
      'trial.free2': 'Everything included, no limits.',
      'trial.free3': "Decide on a plan when you're ready.",
      'trial.yearName': 'Yearly',
      'trial.year1': 'Full access for one year.',
      'trial.year2': 'Everything included, all updates.',
      'trial.year3': 'One-time payment, not a subscription.',
      'trial.lifetimeName': 'Lifetime',
      'trial.life1': 'Pay once, own it forever.',
      'trial.life2': 'All features, every future update.',
      'trial.life3': 'No subscriptions, no renewals.',
      'trial.chooseFooter': 'Once you make a selection, Wallpaper will open your workspace.',
      'trial.haveKey': 'I already bought',
      // checkout wait
      'checkout.finishTitle': 'Finish in the other tab',
      'checkout.finishSub': 'We opened the checkout page.<br>Come back here once you\'re done.',
      'checkout.completed': "I've completed my purchase",
      'common.goBack': '← Go back',
      'common.back': '← Back',
      'common.cancel': 'Cancel',
      'common.close': 'Close',
      'common.choosePlan': 'Choose your plan',
      'paywall.fromPrice': (p) => `from ${p.price}`,
      'common.reset': 'Reset',
      'common.save': 'Save',
      'common.normal': 'Normal',
      'common.bold': 'Bold',
      // sign-in prompt
      'signin.title': 'Sign in to continue',
      'signin.errTitle': "Sign-in didn't go through",
      'signin.errSub': 'Something went wrong. Try again.',
      // paywall
      'paywall.title': 'Your free trial has ended',
      'paywall.desc': 'Your bookmarks are safe.<br>Unlock Wallpaper to continue using it.',
      'paywall.payOnce': 'pay once · no subscription',
      'paywall.getAccess': 'Get lifetime access',
      'paywall.secure': 'Secure checkout · activates instantly',
      'paywall.export': 'Export bookmarks',
      // activation
      'activation.enterTitle': 'Enter your code',
      'activation.enterSub': "After your purchase you'll receive a code by email.<br>Paste it here to unlock Wallpaper.",
      'activation.invalid': 'Invalid code. Please try again.',
      'activation.activate': 'Activate',
      'activation.checking': 'Checking…',
      'activation.allSet': 'All set!',
      'activation.unlocked': 'Wallpaper is now unlocked. Enjoy!',
      'activation.syncPrompt': 'Sign in to keep your purchase on all your devices.',
      'activation.getStarted': 'Get started',
      // trial badge / nudge
      'badge.free': 'FREE TRIAL',
      'badge.upgrade': 'Choose a plan →',
      'badge.endsToday': 'Ends today',
      'badge.daysLeft': (p) => `${p.n} day${p.n !== 1 ? 's' : ''} left`,
      'nudge.title': 'Your free trial ends tomorrow',
      'nudge.endedTitle': 'Your free trial has ended',
      'nudge.endedBody': "You're now on the free plan: up to 3 boards and 30 bookmarks. Unlock everything to keep going without limits.",
      'nudge.later': 'Maybe later',
      'nudge.buy': 'Get lifetime access →',
      'nudge.built': (p) => `You've built ${p.b} board${p.b !== 1 ? 's' : ''} with ${p.m} bookmark${p.m !== 1 ? 's' : ''}.<br>Pick a plan to keep it all.`,
      'nudge.keep': () => `Pick a plan to keep everything you built.`,
      // settings
      'settings.title': 'Settings',
      'st.account': 'Account',
      'st.syncDesc': 'Sign in to sync your boards and license across devices.',
      'st.signOut': 'Sign out',
      'st.download': 'Download data',
      'st.user': 'User',
      'st.access': 'Access',
      'st.paidActive': 'Lifetime access · Active ✓',
      'st.yearActive': (p) => `Yearly access · until ${p.date}`,
      'st.thanks': 'Thanks for supporting Wallpaper.',
      'st.freeTrial': 'Free trial',
      'st.daysLeft': (p) => `${p.n} day${p.n !== 1 ? 's' : ''} left`,
      'st.payOnceForever': "Pay once, it's yours forever.",
      'st.getAccessPrice': (p) => `Get lifetime access · ${p.price}`,
      'st.trialEnded': 'Trial ended',
      'st.freePlan': 'Free plan',
      'st.freePlanNote': 'Up to 3 boards and 30 bookmarks. Unlock full access.',
      'st.guestNote': (p) => `Start with a ${p.n}-day free trial. Sign in to get full access.`,
      'st.appearance': 'Appearance',
      'st.primaryColor': 'Primary color',
      'st.boardColor': 'Board color',
      'st.opacity': 'Opacity',
      'st.blur': 'Blur',
      'st.autoWallpaper': 'Auto-Wallpaper',
      'st.autoWpOff': 'Off',
      'st.autoWpNewtab': 'On new tab open',
      'st.autoWpDaily': 'Every 24 hours',
      'st.boardText': 'Board text',
      'st.boards': 'Boards',
      'st.size': 'Size',
      'st.weight': 'Weight',
      'st.general': 'General',
      'st.openNewTab': 'Open links in new tab',
      'st.boardColumns': 'Number of columns',
      'st.boardWidth': 'Board width',
      'st.colsAuto': 'Auto',
      'st.colsHint': (p) => `Your screen fits up to ${p.n} ${plEn(p.n, 'column', 'columns')}.`,
      'st.hideExtra': 'Hide extra bookmarks',
      'st.showN': (p) => `Show ${p.n}`,
      'st.showDescriptions': 'Show descriptions',
      'st.quickSave': 'Quick Save',
      'st.saveToPage': 'Save to page',
      'st.saveToBoard': 'Save to board',
      'st.shortcut': 'Shortcut',
      'st.notSet': 'Not set',
      'st.change': 'Change',
      'st.language': 'Language',
      'st.langAuto': 'Auto',
      'st.region': 'Region',
      'st.autoDetect': 'Auto-detect',
      'st.advancedOpen': 'Advanced ›',
      'st.advancedClose': 'Advanced ‹',
      'st.timeFormat': 'Time format',
      'st.dateFormat': 'Date format',
      'st.weekStart': 'Week starts on',
      'st.monday': 'Monday',
      'st.sunday': 'Sunday',
      'st.temperature': 'Temperature',
      'st.sidebar': 'Sidebar',
      'st.alwaysShow': 'Always show all buttons',
      'st.support': 'Support',
      'st.version': 'Version',
      'st.contact': 'Contact',
      // limit hints
      'limit.pages': 'Unlock Wallpaper to create multiple pages.',
      'limit.boards': 'Unlock Wallpaper to add more than 3 boards.',
      'limit.bookmarks': 'Unlock Wallpaper to save more than 30 bookmarks.',
      'limit.import': 'Unlock Wallpaper to import bookmarks.',
      'limit.uploadWp': 'Unlock Wallpaper to upload your own wallpapers.',
      'limit.customWp': 'Unlock Wallpaper to use custom wallpapers.',
      'limit.unlockBtn': 'Choose a plan',
      // tour
      'tour.skip': 'Skip tour',
      'tour.next': 'Next →',
      'tour.done': 'Done',
      'tour.importBookmarks': 'Import bookmarks',
      'tour.maybeLater': 'Maybe later',
      'tour.counter': (p) => `${p.i} of ${p.total}`,
      'tour.boardsTitle': 'Your boards',
      'tour.boardsDesc': 'Each board holds your bookmarks. Organize them however makes sense for you.',
      'tour.createBoardTitle': 'Create a board',
      'tour.createBoardDesc': 'Boards hold your bookmarks. Click any highlighted “+” slot to create your first one.',
      'tour.addTitle': 'Add a bookmark',
      'tour.addDesc': 'Once you have a board, click the + on it to save any link.',
      'tour.pagesTitle': 'Organize with pages',
      'tour.pagesDesc': 'Create pages for Work, Personal, Travel, or whatever makes sense for you.',
      'tour.menuTitle': 'Explore the menu',
      'tour.menuDesc': 'Change your wallpaper, add widgets, or import your Chrome bookmarks.',
      'tour.settingsTitle': 'Settings',
      'tour.settingsDesc': 'Account, board layout, and everything in between, all in one place.',
      'tour.saveTitle': 'Save any page in a click',
      'tour.saveDesc': 'Click the Wallpaper icon in the toolbar to save the current tab. You can also set up a keyboard shortcut in Settings.',
      'tour.bringTitle': 'Bring in your bookmarks',
      'tour.bringDesc': "Let's import your existing Chrome bookmarks into boards. It only takes a click.",
      'tour.dragTitle': 'Drag to organize',
      'tour.dragDesc': 'Drag any bookmark to move it between boards, or reorder it within a board.',
      'tour.doneTitle': "You're all set!",
      'tour.doneDesc': "That's all you need to know. Go ahead and make it yours.",
      // calendar / stats arrays
      'cal.months': ['January','February','March','April','May','June','July','August','September','October','November','December'],
      'cal.dayShort': ['Su','Mo','Tu','We','Th','Fr','Sa'],
      'cal.monShort': ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
      'clock.days': ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
      // popup (Quick Save)
      'popup.quickSave': 'Quick Save',
      'popup.saveTo': 'Save to Wallpaper',
      'popup.url': 'URL',
      'popup.title': 'Title',
      'popup.titlePlaceholder': 'Page title',
      'popup.page': 'Page',
      'popup.board': 'Board',
      'popup.save': 'Save bookmark',
      'popup.saved': 'Saved!',
      'popup.limit': 'Open Wallpaper to save more than 30 bookmarks.',
      'popup.urlRequired': 'URL is required.',
      'popup.noData': 'No data found.',
      'popup.noBoards': 'No boards found.',
      'popup.loadFail': 'Could not load data.',
    },
    ru: {
      'fab.newBoard': '+ Новая доска',
      'side.search': 'Поиск',
      'side.wallpaper': 'Обои',
      'side.widgets': 'Виджеты',
      'side.import': 'Импорт',
      'side.trash': 'Корзина',
      'side.menu': 'Меню',
      'side.settings': 'Настройки',
      'side.searchTitle': 'Поиск (Ctrl+K)',
      'side.importTitle': 'Импорт закладок',
      'search.placeholder': 'Поиск по закладкам…',
      'search.widgetPlaceholder': 'Поиск…',
      'search.noResults': 'Ничего не найдено',
      'search.defaultEngine': 'Поиск по умолчанию',
      'import.header': 'Импорт из закладок Chrome',
      'import.loading': 'Загрузка…',
      'import.noFolders': 'Папки с закладками не найдены.',
      'import.failed': 'Не удалось загрузить закладки.',
      'import.action': 'Импорт',
      'import.untitled': 'Без названия',
      'import.bookmarksMeta': (p) => `${p.n} ${plRu(p.n, 'закладка', 'закладки', 'закладок')}`,
      'trash.title': 'Корзина',
      'trash.emptyConfirm': 'Очистить корзину?',
      'trash.deleteAll': 'Удалить всё',
      'trash.empty': 'Очистить корзину',
      'trash.isEmpty': 'Корзина пуста',
      'trash.restore': 'Восстановить',
      'trash.boardMeta': (p) => `Доска · ${p.n} ${plRu(p.n, 'ссылка', 'ссылки', 'ссылок')}`,
      'wp.title': 'Обои',
      'wp.upload': 'Загрузите изображение или видео',
      'wp.presets': 'Пресеты',
      'wp.myUploads': 'Мои загрузки',
      'wp.find': 'Найти обои',
      'wp.findBtn': 'Искать обои в интернете',
      'wp.findUrl': 'https://yandex.ru/search/?text=live+wallpaper',
      'widgets.label': 'Виджеты',
      'widget.board': 'Доска',
      'widget.notes': 'Заметки',
      'widget.calendar': 'Календарь',
      'widget.pomodoro': 'Помодоро',
      'widget.clock': 'Часы',
      'widget.currency': 'Курс валют',
      'widget.search': 'Поиск',
      'widget.weather': 'Погода',
      'widget.add': 'Добавить',
      'weather.cityPlaceholder': 'Название города…',
      'weather.apply': 'Применить',
      'se.title': 'Оформление обоев',
      'se.analyzing': 'Анализируем обои…',
      'se.lightDetected': 'Обнаружена светлая тема.',
      'se.darkDetected': 'Обнаружена тёмная тема.',
      'se.primaryColor': 'Основной цвет',
      'se.boardColor': 'Цвет доски',
      'se.boardOpacity': 'Прозрачность доски',
      'se.boardBlur': 'Размытие доски',
      'se.textSize': 'Размер текста',
      'se.textWeight': 'Толщина текста',
      'board.new': 'Новая доска',
      'board.more': (p) => `Ещё ${p.n}`,
      'board.showLess': 'Свернуть',
      'notes.placeholder': 'Пишите что угодно…',
      'weather.loading': 'Загрузка…',
      'weather.feels': (p) => `Ощущается как ${p.v}`,
      'weather.wind': (p) => `Ветер ${p.v} км/ч`,
      'weather.updated': (p) => `Обновлено ${p.time}`,
      'weather.refresh': '↻ Обновить',
      'focus.today': 'Фокус',
      'focus.stats': 'Статистика фокуса',
      'focus.week': 'Эта неделя',
      'focus.months': 'По месяцам',
      'focus.none': 'Пока нет ни одной сессии',
      'pom.focus': 'Фокус',
      'pom.short': 'Перерыв',
      'pom.long': 'Отдых',
      'pom.title': 'Помодоро',
      'pom.focusMin': 'Фокус (мин)',
      'pom.shortMin': 'Короткий перерыв (мин)',
      'pom.longMin': 'Длинный перерыв (мин)',
      'pom.longAfter': 'Длинный перерыв каждые',
      'addlink.pasteUrl': 'Вставьте ссылку…',
      'addlink.name': 'Название',
      'addlink.descOptional': 'Описание (необязательно)',
      'addlink.add': 'Добавить ссылку',
      'tip.newPage': 'Новая страница',
      'tip.addLink': 'Добавить ссылку',
      'tip.skip': 'Пропустить',
      'tip.reset': 'Сбросить',
      'tip.deletePermanently': 'Удалить навсегда',
      'tip.remove': 'Удалить',
      'menu.open': 'Открыть',
      'menu.openIncognito': 'Открыть в инкогнито',
      'menu.edit': 'Изменить',
      'menu.delete': 'Удалить',
      'menu.rename': 'Переименовать',
      'menu.openAll': 'Открыть все ссылки',
      'menu.deleteBoard': 'Удалить доску',
      'onboard.title': 'Добро пожаловать в Wallpaper',
      'onboard.sub': 'Новая вкладка, где всё под рукой.',
      'onboard.google': 'Войти через Google',
      'onboard.guest': 'Продолжить без входа',
      'onboard.errTitle': 'Не удалось войти',
      'onboard.errSub': 'Что-то пошло не так. Попробуйте снова или продолжите без аккаунта.',
      'onboard.retry': 'Попробовать снова',
      'signin.inProgress': 'Входим…',
      'trial.chooseTitle': 'С чего начнём?',
      'trial.chooseSub': 'Выберите вариант, чтобы продолжить.',
      'trial.freeName': 'Пробный период',
      'trial.noCard': 'Карта не нужна',
      'trial.free1': (p) => `Полный доступ на ${p.n} ${plRu(p.n, 'день', 'дня', 'дней')}.`,
      'trial.free2': 'Всё включено, без ограничений.',
      'trial.free3': 'Определитесь с тарифом, когда будете готовы.',
      'trial.yearName': 'Доступ на год',
      'trial.year1': 'Полный доступ на год.',
      'trial.year2': 'Всё включено, все обновления.',
      'trial.year3': 'Разовый платёж, не подписка.',
      'trial.lifetimeName': 'Доступ навсегда',
      'trial.life1': 'Платите один раз и пользуетесь всегда.',
      'trial.life2': 'Все возможности и все будущие обновления.',
      'trial.life3': 'Никаких подписок и продлений.',
      'trial.chooseFooter': 'Как только выберете, откроется рабочее пространство.',
      'trial.haveKey': 'Уже купили',
      'checkout.finishTitle': 'Завершите покупку в соседней вкладке',
      'checkout.finishSub': 'Мы открыли страницу оплаты в новой вкладке.<br>Вернитесь сюда, когда всё оплатите.',
      'checkout.completed': 'Оплата завершена',
      'common.goBack': '← Назад',
      'common.back': '← Назад',
      'common.cancel': 'Отмена',
      'common.close': 'Закрыть',
      'common.choosePlan': 'Выбрать тариф',
      'paywall.fromPrice': (p) => `от ${p.price}`,
      'common.reset': 'Сбросить',
      'common.save': 'Сохранить',
      'common.normal': 'Обычный',
      'common.bold': 'Жирный',
      'signin.title': 'Войдите, чтобы продолжить',
      'signin.errTitle': 'Не удалось войти',
      'signin.errSub': 'Что-то пошло не так. Попробуйте снова.',
      'paywall.title': 'Пробный период закончился',
      'paywall.desc': 'Все ваши закладки на месте.<br>Откройте полный доступ, чтобы продолжить.',
      'paywall.payOnce': 'разовый платёж, без подписки',
      'paywall.getAccess': 'Открыть доступ навсегда',
      'paywall.secure': 'Безопасная оплата, доступ откроется сразу',
      'paywall.export': 'Экспорт закладок',
      'activation.enterTitle': 'Введите код',
      'activation.enterSub': 'После оплаты код придёт на почту.<br>Вставьте его сюда, чтобы открыть Wallpaper.',
      'activation.invalid': 'Неверный код. Попробуйте ещё раз.',
      'activation.activate': 'Активировать',
      'activation.checking': 'Проверяем…',
      'activation.allSet': 'Готово!',
      'activation.unlocked': 'Полный доступ открыт. Пользуйтесь с удовольствием!',
      'activation.syncPrompt': 'Войдите, чтобы покупка работала на всех ваших устройствах.',
      'activation.getStarted': 'Начать',
      'badge.free': 'ПРОБНЫЙ ПЕРИОД',
      'badge.upgrade': 'Выбрать тариф →',
      'badge.endsToday': 'Заканчивается сегодня',
      'badge.daysLeft': (p) => `осталось ${p.n} ${plRu(p.n, 'день', 'дня', 'дней')}`,
      'nudge.title': 'Пробный период заканчивается завтра',
      'nudge.endedTitle': 'Пробный период закончился',
      'nudge.endedBody': 'Теперь вы на бесплатном плане: до 3 досок и 30 закладок. Откройте полный доступ, чтобы продолжить без ограничений.',
      'nudge.later': 'Позже',
      'nudge.buy': 'Открыть доступ навсегда →',
      'nudge.built': (p) => `У вас уже ${p.b} ${plRu(p.b, 'доска', 'доски', 'досок')} и ${p.m} ${plRu(p.m, 'закладка', 'закладки', 'закладок')}.<br>Выберите тариф, чтобы оставить всё это себе.`,
      'nudge.keep': () => `Выберите тариф, чтобы оставить всё, что создали.`,
      'settings.title': 'Настройки',
      'st.account': 'Аккаунт',
      'st.syncDesc': 'Войдите, чтобы синхронизировать доски и лицензию между устройствами.',
      'st.signOut': 'Выйти',
      'st.download': 'Скачать данные',
      'st.user': 'Пользователь',
      'st.access': 'Доступ',
      'st.paidActive': 'Доступ навсегда, активен ✓',
      'st.yearActive': (p) => `Доступ на год · до ${p.date}`,
      'st.thanks': 'Спасибо, что поддерживаете Wallpaper.',
      'st.freeTrial': 'Пробный период',
      'st.daysLeft': (p) => `осталось ${p.n} ${plRu(p.n, 'день', 'дня', 'дней')}`,
      'st.payOnceForever': 'Заплатите один раз и пользуйтесь всегда.',
      'st.getAccessPrice': (p) => `Открыть доступ навсегда за ${p.price}`,
      'st.trialEnded': 'Пробный период истёк',
      'st.freePlan': 'Бесплатный план',
      'st.freePlanNote': 'До 3 досок и 30 закладок. Разблокируйте полный доступ.',
      'st.guestNote': (p) => `Попробуйте бесплатно ${p.n} ${plRu(p.n, 'день', 'дня', 'дней')}. Войдите, чтобы открыть полный доступ.`,
      'st.appearance': 'Внешний вид',
      'st.primaryColor': 'Основной цвет',
      'st.boardColor': 'Цвет доски',
      'st.opacity': 'Прозрачность',
      'st.blur': 'Размытие',
      'st.autoWallpaper': 'Авто-обои',
      'st.autoWpOff': 'Выкл',
      'st.autoWpNewtab': 'При открытии новой вкладки',
      'st.autoWpDaily': 'Каждые 24 часа',
      'st.boardText': 'Текст доски',
      'st.boards': 'Доски',
      'st.size': 'Размер',
      'st.weight': 'Толщина',
      'st.general': 'Общие',
      'st.openNewTab': 'Открывать ссылки в новой вкладке',
      'st.boardColumns': 'Количество колонок',
      'st.boardWidth': 'Ширина досок',
      'st.colsAuto': 'Авто',
      'st.colsHint': (p) => `Ваш размер экрана вмещает максимум ${p.n} ${plRu(p.n, 'колонку', 'колонки', 'колонок')}.`,
      'st.hideExtra': 'Скрывать лишние закладки',
      'st.showN': (p) => `Показать ${p.n}`,
      'st.showDescriptions': 'Показывать описания',
      'st.quickSave': 'Быстрое сохранение',
      'st.saveToPage': 'Сохранять на страницу',
      'st.saveToBoard': 'Сохранять на доску',
      'st.shortcut': 'Горячая клавиша',
      'st.notSet': 'Не задано',
      'st.change': 'Изменить',
      'st.language': 'Язык',
      'st.langAuto': 'Авто',
      'st.region': 'Регион',
      'st.autoDetect': 'Автоопределение',
      'st.advancedOpen': 'Дополнительно ›',
      'st.advancedClose': 'Дополнительно ‹',
      'st.timeFormat': 'Формат времени',
      'st.dateFormat': 'Формат даты',
      'st.weekStart': 'Начало недели',
      'st.monday': 'Понедельник',
      'st.sunday': 'Воскресенье',
      'st.temperature': 'Температура',
      'st.sidebar': 'Боковая панель',
      'st.alwaysShow': 'Всегда показывать все кнопки',
      'st.support': 'Поддержка',
      'st.version': 'Версия',
      'st.contact': 'Написать',
      'limit.pages': 'Откройте полный доступ, чтобы создавать несколько страниц.',
      'limit.boards': 'Откройте полный доступ, чтобы добавить больше 3 досок.',
      'limit.bookmarks': 'Откройте полный доступ, чтобы сохранить больше 30 закладок.',
      'limit.import': 'Откройте полный доступ, чтобы импортировать закладки.',
      'limit.uploadWp': 'Откройте полный доступ, чтобы загружать свои обои.',
      'limit.customWp': 'Откройте полный доступ, чтобы использовать свои обои.',
      'limit.unlockBtn': 'Выбрать тариф',
      'tour.skip': 'Пропустить тур',
      'tour.next': 'Далее →',
      'tour.done': 'Готово',
      'tour.importBookmarks': 'Импортировать закладки',
      'tour.maybeLater': 'Позже',
      'tour.counter': (p) => `${p.i} из ${p.total}`,
      'tour.boardsTitle': 'Ваши доски',
      'tour.boardsDesc': 'На доске лежат ваши закладки. Раскладывайте их так, как удобно именно вам.',
      'tour.createBoardTitle': 'Создайте доску',
      'tour.createBoardDesc': 'Доски хранят ваши закладки. Нажмите любой подсвеченный слот «+», чтобы создать первую.',
      'tour.addTitle': 'Добавьте закладку',
      'tour.addDesc': 'Когда доска создана, нажмите на ней +, чтобы сохранить любую ссылку.',
      'tour.pagesTitle': 'Разложите по страницам',
      'tour.pagesDesc': 'Заведите отдельные страницы: работа, личное, путешествия, что угодно.',
      'tour.menuTitle': 'Загляните в меню',
      'tour.menuDesc': 'Здесь можно сменить обои, добавить виджеты и перенести закладки из Chrome.',
      'tour.settingsTitle': 'Настройки',
      'tour.settingsDesc': 'Аккаунт, вид досок и всё остальное собрано в одном месте.',
      'tour.saveTitle': 'Сохраняйте страницу в один клик',
      'tour.saveDesc': 'Нажмите на значок Wallpaper на панели браузера, чтобы сохранить открытую вкладку. А ещё можно задать горячую клавишу в настройках.',
      'tour.bringTitle': 'Перенесите свои закладки',
      'tour.bringDesc': 'Давайте перенесём ваши закладки из Chrome на доски. Это один клик.',
      'tour.dragTitle': 'Перетаскивайте закладки',
      'tour.dragDesc': 'Перетащите закладку на другую доску или поменяйте порядок внутри доски.',
      'tour.doneTitle': 'Всё готово!',
      'tour.doneDesc': 'Это всё, что нужно знать. Пользуйтесь и настраивайте под себя.',
      'cal.months': ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],
      'cal.dayShort': ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'],
      'cal.monShort': ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'],
      'clock.days': ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'],
      'popup.quickSave': 'Быстрое сохранение',
      'popup.saveTo': 'Сохранить в Wallpaper',
      'popup.url': 'Ссылка',
      'popup.title': 'Название',
      'popup.titlePlaceholder': 'Заголовок страницы',
      'popup.page': 'Страница',
      'popup.board': 'Доска',
      'popup.save': 'Сохранить закладку',
      'popup.saved': 'Сохранено!',
      'popup.limit': 'Откройте Wallpaper, чтобы сохранить больше 30 закладок.',
      'popup.urlRequired': 'Укажите ссылку.',
      'popup.noData': 'Данные не найдены.',
      'popup.noBoards': 'Доски не найдены.',
      'popup.loadFail': 'Не удалось загрузить данные.',
    },
  };

  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
  }

  function t(key, params) {
    let v = STR[lang][key];
    if (v === undefined) v = STR.en[key];
    if (v === undefined) return key;
    if (typeof v === 'function') return v(params || {});
    if (typeof v === 'string') return interpolate(v, params);
    return v; // arrays etc.
  }

  // plan: 'year' | 'lifetime' (defaults to lifetime for backward compatibility)
  function price(plan)  { const p = PRICING[lang] || PRICING.en; return p[plan] || p.lifetime; }
  function buyUrl(plan) {
    const pl = (plan === 'year' || plan === 'lifetime') ? plan : 'lifetime';
    return `${PAY_URL}?plan=${pl}&lang=${lang}`;
  }

  // Apply translations to static markup.
  //  data-i18n           → textContent
  //  data-i18n-html      → innerHTML (for strings containing <br>)
  //  data-i18n-ph        → placeholder attribute
  //  data-i18n-title     → title attribute
  //  data-i18n-aria      → aria-label attribute
  function applyStatic(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
    root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  }

  // Persist a language override and reload so everything re-renders.
  //  'auto' | 'en' | 'ru'
  function setLang(val) {
    try {
      if (val === 'auto') localStorage.removeItem(LANG_KEY);
      else localStorage.setItem(LANG_KEY, val);
    } catch (e) {}
    location.reload();
  }

  function currentPref() {
    try {
      const o = localStorage.getItem(LANG_KEY);
      return SUPPORTED.includes(o) ? o : 'auto';
    } catch (e) { return 'auto'; }
  }

  try { document.documentElement.lang = lang; } catch (e) {}

  window.I18N = { lang, t, price, buyUrl, applyStatic, setLang, currentPref, PRICING, PAY_URL };
})();
