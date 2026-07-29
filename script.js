// ===================================
// CLOCK
// ===================================
function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const minutes = now.getMinutes().toString().padStart(2, '0');
    
    const timeEl = document.getElementById('clockTime');
    if (timeEl) timeEl.innerHTML = `${hours}:${minutes}<span class="clock-ampm">${ampm}</span>`;
    
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateEl = document.getElementById('clockDate');
    if (dateEl) dateEl.textContent = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
}
setInterval(updateClock, 1000);
updateClock();

// ===================================
// CALENDAR
// ===================================
let calDate = new Date();

function renderCalendar() {
    const grid = document.getElementById('calGrid');
    const title = document.getElementById('calMonthTitle');
    if (!grid || !title) return;
    
    const year = calDate.getFullYear();
    const month = calDate.getMonth();
    
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    title.textContent = `${months[month]} ${year}`;
    
    grid.innerHTML = '';
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    
    for (let i = 0; i < firstDay; i++) {
        const span = document.createElement('span');
        span.className = 'cal-day cal-day-blank';
        grid.appendChild(span);
    }
    
    for (let d = 1; d <= daysInMonth; d++) {
        const span = document.createElement('span');
        const dayOfWeek = new Date(year, month, d).getDay();
        const isToday = (d === today.getDate() && month === today.getMonth() && year === today.getFullYear());
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        
        span.className = `cal-day ${isToday ? 'cal-day-today' : ''} ${isWeekend ? 'cal-day-weekend' : ''}`;
        span.innerHTML = `<span class="cal-day-num">${d}</span>`;
        grid.appendChild(span);
    }
}

document.getElementById('calPrev')?.addEventListener('click', () => {
    calDate.setMonth(calDate.getMonth() - 1);
    renderCalendar();
});
document.getElementById('calNext')?.addEventListener('click', () => {
    calDate.setMonth(calDate.getMonth() + 1);
    renderCalendar();
});
renderCalendar();

// ===================================
// POMODORO TIMER
// ===================================
let pomInterval = null;
let pomSeconds = 5 * 60;
let pomRunning = false;
let currentPhase = 'short';

const phaseDurations = {
    focus: 25 * 60,
    short: 5 * 60,
    long: 15 * 60
};

function updatePomDisplay() {
    const timerEl = document.getElementById('pomTimer');
    if (!timerEl) return;
    const mins = Math.floor(pomSeconds / 60).toString().padStart(2, '0');
    const secs = (pomSeconds % 60).toString().padStart(2, '0');
    timerEl.textContent = `${mins}:${secs}`;
}

document.querySelectorAll('.pom-phase-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.pom-phase-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPhase = btn.dataset.phase;
        pomSeconds = phaseDurations[currentPhase];
        pausePom();
        updatePomDisplay();
    });
});

function startPom() {
    if (pomRunning) return;
    pomRunning = true;
    const playBtn = document.getElementById('pomPlay');
    if (playBtn) playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`;
    
    pomInterval = setInterval(() => {
        if (pomSeconds > 0) {
            pomSeconds--;
            if (currentPhase === 'focus') {
                addStudyTime(1);
            }
            updatePomDisplay();
        } else {
            pausePom();
            alert('Time is up!');
        }
    }, 1000);
}

function pausePom() {
    pomRunning = false;
    clearInterval(pomInterval);
    const playBtn = document.getElementById('pomPlay');
    if (playBtn) playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="8,3 20,12 8,21"></polygon></svg>`;
}

document.getElementById('pomPlay')?.addEventListener('click', () => {
    if (pomRunning) pausePom(); else startPom();
});

document.getElementById('pomReset')?.addEventListener('click', () => {
    pausePom();
    pomSeconds = phaseDurations[currentPhase];
    updatePomDisplay();
});

document.getElementById('pomSkip')?.addEventListener('click', () => {
    pausePom();
    if (currentPhase === 'focus') currentPhase = 'short';
    else currentPhase = 'focus';
    
    document.querySelectorAll('.pom-phase-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.phase === currentPhase);
    });
    pomSeconds = phaseDurations[currentPhase];
    updatePomDisplay();
});

updatePomDisplay();

// ===================================
// SIDEBAR MENU & MODALS TOGGLE
// ===================================
const menuBtn = document.getElementById('menuSideBtn');
const sidebarExpanded = document.getElementById('sidebarExpanded');

menuBtn?.addEventListener('click', () => {
    if (sidebarExpanded) {
        const isHidden = sidebarExpanded.style.display === 'none' || !sidebarExpanded.style.display;
        sidebarExpanded.style.display = isHidden ? 'flex' : 'none';
    }
});

// Modals Handling
function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = show ? 'flex' : 'none';
    }
}

document.getElementById('searchSideBtn')?.addEventListener('click', () => toggleModal('searchOverlay', true));
document.getElementById('mpWallpaper')?.addEventListener('click', () => toggleModal('wpOverlay', true));
document.getElementById('mpImport')?.addEventListener('click', () => toggleModal('importOverlay', true));
document.getElementById('mpTrash')?.addEventListener('click', () => toggleModal('trashOverlay', true));
document.getElementById('settingsSideBtn')?.addEventListener('click', () => toggleModal('settingsOverlay', true));

document.getElementById('wpCloseBtn')?.addEventListener('click', () => toggleModal('wpOverlay', false));
document.getElementById('importCloseBtn')?.addEventListener('click', () => toggleModal('importOverlay', false));
document.getElementById('trashCloseBtn')?.addEventListener('click', () => toggleModal('trashOverlay', false));
document.getElementById('settingsCloseBtn')?.addEventListener('click', () => toggleModal('settingsOverlay', false));

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        toggleModal('searchOverlay', false);
        toggleModal('wpOverlay', false);
        toggleModal('importOverlay', false);
        toggleModal('trashOverlay', false);
        toggleModal('settingsOverlay', false);
    }
});

// ===================================
// DRAG & DROP BOARDS
// ===================================
let draggedBoard = null;

function initBoardDrag() {
    const boards = document.querySelectorAll('.board');
    boards.forEach(board => {
        const header = board.querySelector('.board-header');
        board.setAttribute('draggable', 'true');
        
        board.addEventListener('dragstart', (e) => {
            if (header && !header.contains(e.target) && e.target !== header) {
                e.preventDefault();
                return;
            }
            draggedBoard = board;
            setTimeout(() => board.style.opacity = '0.4', 0);
            e.dataTransfer.effectAllowed = 'move';
        });

        board.addEventListener('dragend', () => {
            if (draggedBoard) draggedBoard.style.opacity = '1';
            draggedBoard = null;
        });
    });

    const columns = document.querySelectorAll('.board-column');
    columns.forEach(col => {
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        col.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedBoard && col.contains(draggedBoard) === false) {
                col.insertBefore(draggedBoard, col.querySelector('.col-drop-zone'));
            }
        });
    });
}

initBoardDrag();

// ===================================
// 1. NOTEBOOKLM & AI SMART HUB
// ===================================
function setupAiSmartHub() {
    const txt = document.getElementById('aiHubText');
    const send = (url, name) => {
        const query = txt ? txt.value.trim() : '';
        if (query) {
            navigator.clipboard.writeText(query).then(() => {
                alert(`"${query.slice(0, 30)}..." copied to clipboard! Opening ${name}...`);
                window.open(url, '_blank');
            }).catch(() => window.open(url, '_blank'));
        } else {
            window.open(url, '_blank');
        }
    };

    document.getElementById('btnSendNotebookLM')?.addEventListener('click', () => send('https://notebooklm.google.com/', 'NotebookLM'));
    document.getElementById('btnSendClaude')?.addEventListener('click', () => send('https://claude.ai/new', 'Claude'));
    document.getElementById('btnSendGemini')?.addEventListener('click', () => send('https://gemini.google.com/app', 'Gemini'));
    document.getElementById('btnSendChatGPT')?.addEventListener('click', () => send('https://chatgpt.com/', 'ChatGPT'));
}
setupAiSmartHub();


// ===================================
// 3. DAILY STUDY TRACKER & STREAK (5 HOURS)
// ===================================
const DAILY_TARGET_SECONDS = 5 * 3600; // 5 hours

function getTodayKey() {
    const d = new Date();
    return `study_${d.getFullYear()}_${d.getMonth()+1}_${d.getDate()}`;
}

function updateStudyTracker() {
    const key = getTodayKey();
    const sec = parseInt(localStorage.getItem(key) || '0', 10);
    const streak = parseInt(localStorage.getItem('study_streak') || '1', 10);

    const pct = Math.min(100, Math.round((sec / DAILY_TARGET_SECONDS) * 100));
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);

    const remSec = Math.max(0, DAILY_TARGET_SECONDS - sec);
    const remH = Math.floor(remSec / 3600);
    const remM = Math.floor((remSec % 3600) / 60);

    const fill = document.getElementById('studyProgressFill');
    const pctEl = document.getElementById('studyProgressPct');
    const todayEl = document.getElementById('studyTodayTime');
    const remEl = document.getElementById('studyRemainingTime');
    const streakEl = document.getElementById('studyStreakBadge');

    if (fill) fill.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (todayEl) todayEl.textContent = `${hours}s ${mins}m`;
    if (remEl) remEl.textContent = `${remH}s ${remM}m`;
    if (streakEl) streakEl.textContent = `🔥 ${streak} Kun Streak`;
}

function addStudyTime(seconds) {
    const key = getTodayKey();
    const current = parseInt(localStorage.getItem(key) || '0', 10);
    const updated = current + seconds;
    localStorage.setItem(key, updated.toString());

    if (updated >= DAILY_TARGET_SECONDS && current < DAILY_TARGET_SECONDS) {
        let streak = parseInt(localStorage.getItem('study_streak') || '0', 10);
        streak += 1;
        localStorage.setItem('study_streak', streak.toString());
        alert('🎉 TABRIKLAYMIZ! Kunlik 5 soatlik dars rejasini bajardingiz!');
    }
    updateStudyTracker();
}

updateStudyTracker();

// ===================================
// 4. LIVE CURRENCY RATES (CBU API)
// ===================================
async function fetchCurrencyRates() {
    const el = document.getElementById('currencyVal');
    if (!el) return;
    try {
        const res = await fetch('https://cbu.uz/uz/arkhiv-kursov-valyut/json/');
        const data = await res.json();
        const usd = data.find(c => c.Ccy === 'USD');
        const eur = data.find(c => c.Ccy === 'EUR');

        if (usd) {
            const usdRate = Math.round(parseFloat(usd.Rate)).toLocaleString();
            const eurRate = eur ? Math.round(parseFloat(eur.Rate)).toLocaleString() : '';
            el.innerHTML = `<span>USD: ${usdRate}</span>${eurRate ? `<span style="margin-left:4px;">| EUR: ${eurRate}</span>` : ''}`;
        }
    } catch(e) {
        el.innerHTML = `<span>USD: 12,850 UZS</span>`;
    }
}
fetchCurrencyRates();

