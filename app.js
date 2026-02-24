// ============================================================
// HABIT TRACKER - Frontend JavaScript
// Kết nối với Google Apps Script API
// ============================================================

// ⚙️ CONFIG - Lấy từ localStorage (người dùng nhập ở trang Settings)
let API_URL = localStorage.getItem('habitflow_api_url') || '';
let displayName = localStorage.getItem('habitflow_name') || 'Người dùng';

// State toàn cục
const state = {
    habits: [],
    completions: [],
    stats: null,
    viewMode: 'monthly', // 'monthly' | 'weekly'
    currentDate: new Date(),
    editingHabitId: null,
    unlockedBadges: [], // Danh sách badge đã mở khóa
};

// ============================================================
// 🏆 GAMIFICATION - BADGES DEFINITIONS
// ============================================================
const BADGES = [
    { id: 'first_step', name: 'Bước đầu tiên', icon: '🐣', desc: 'Hoàn thành thói quen đầu tiên', goal: 1 },
    { id: 'streak_7', name: 'Chiến binh 7 ngày', icon: '🔥', desc: 'Đạt chuỗi 7 ngày liên tiếp', goal: 7 },
    { id: 'consistency_pro', name: 'Thần chuyên cần', icon: '👑', desc: 'Điểm chuyên cần >= 90%', goal: 90 },
    { id: 'habit_master', name: 'Bậc thầy thói quen', icon: '🧙‍♂️', desc: 'Hoàn thành 100 lần', goal: 100 },
    { id: 'multi_tasker', name: 'Người đa năng', icon: '🎭', desc: 'Theo dõi 5+ thói quen cùng lúc', goal: 5 }
];

// ============================================================
// 💾 LOCALSTORAGE CACHE
// Mọi thay đổi được lưu cache NGAY LẬP TỨC.
// Khi mở lại trang → hiển thị từ cache trước, API cập nhật ngầm.
// ============================================================
const CACHE_KEYS = {
    habits: 'habitflow_habits',
    completions: 'habitflow_completions',
    stats: 'habitflow_stats',
};

function saveCache() {
    try {
        localStorage.setItem(CACHE_KEYS.habits, JSON.stringify(state.habits));
        localStorage.setItem(CACHE_KEYS.completions, JSON.stringify(state.completions));
        if (state.stats) localStorage.setItem(CACHE_KEYS.stats, JSON.stringify(state.stats));
    } catch (e) { /* quota exceeded – ignore */ }
}

function loadCache() {
    try {
        const h = localStorage.getItem(CACHE_KEYS.habits);
        const c = localStorage.getItem(CACHE_KEYS.completions);
        const s = localStorage.getItem(CACHE_KEYS.stats);
        if (h) state.habits = JSON.parse(h);
        if (c) state.completions = JSON.parse(c);
        if (s) state.stats = JSON.parse(s);
        const b = localStorage.getItem('habitflow_badges');
        if (b) state.unlockedBadges = JSON.parse(b);
        return !!(h || c); // true nếu có cache
    } catch (e) { return false; }
}

// ============================================================
// 📤 API SYNC QUEUE
// Đảm bảo mọi tick đều được gửi lên Sheets theo thứ tự.
// Nếu đang gửi thì xếp hàng, không mất tick nào.
// ============================================================
const syncQueue = [];
let syncRunning = false;

function enqueuSync(habitId, date) {
    // Nếu đã có trong queue chờ (chưa gửi) thì toggle lại (hủy)
    const pendingIdx = syncQueue.findIndex(q => q.habitId === habitId && q.date === date);
    if (pendingIdx >= 0) {
        syncQueue.splice(pendingIdx, 1); // hủy bỏ – hai lần toggle = không đổi
    } else {
        syncQueue.push({ habitId, date });
    }
    processSyncQueue();
}

async function processSyncQueue() {
    if (syncRunning || syncQueue.length === 0 || !API_URL) return;
    syncRunning = true;
    while (syncQueue.length > 0) {
        const item = syncQueue.shift();
        try {
            await apiPost({ action: 'toggleCompletion', habitId: item.habitId, date: item.date });
        } catch (err) {
            // Kết nối lỗi: giữ nguyên state cache (không revert UI)
            showToast('⚠️ Mất kết nối – dữ liệu đã lưu offline, sẽ đồng bộ sau.', 'error');
        }
    }
    syncRunning = false;
    // Refresh stats sau khi sync xong
    refreshStatsBackground();
}

async function refreshStatsBackground() {
    if (!API_URL) return;
    try {
        const s = await apiGet({ action: 'getStats' });
        if (s.success) {
            state.stats = s.stats;
            saveCache();
            renderStats();
            updateXP();
        }
    } catch { /* silent */ }
}

// Mỗi ngày trong tháng hiển thị 1 câu khác nhau (chọn theo ngày)
const QUOTES = [
    { text: 'Thói quen tốt là chìa khóa của mọi thành công.', author: 'Og Mandino' },
    { text: 'Mỗi ngày một chút, theo thời gian bạn sẽ thấy sự thay đổi lớn lao.', author: 'Khuyết danh' },
    { text: 'Không phải động lực tạo nên thói quen, mà là thói quen tạo ra động lực.', author: 'Khuyết danh' },
    { text: 'Một năm từ bây giờ, bạn sẽ mong đã bắt đầu hôm nay.', author: 'Karen Lamb' },
    { text: 'Thành công là kết quả của những thói quen nhỏ được thực hiện liên tục.', author: 'James Clear' },
    { text: 'Hãy cẩn thận với những gì bạn lặp đi lặp lại, vì đó là con người bạn.', author: 'Aristotle' },
    { text: 'Chúng ta là những gì chúng ta liên tục làm. Vì vậy, xuất sắc không phải là hành động mà là thói quen.', author: 'Aristotle' },
    { text: 'Kỷ luật là cây cầu nối giữa ước mơ và thành tựu.', author: 'Jim Rohn' },
    { text: 'Đừng chờ cảm hứng. Nó trốn bạn vì bạn không hành động. Hành động trước, cảm hứng sẽ theo sau.', author: 'Jack London' },
    { text: 'Hành trình ngàn dặm bắt đầu từ một bước chân.', author: 'Lão Tử' },
    { text: 'Mỗi buổi sáng bạn có hai lựa chọn: tiếp tục ngủ với những giấc mơ, hoặc thức dậy và theo đuổi chúng.', author: 'Khuyết danh' },
    { text: 'Không có bí quyết nào dẫn đến thành công. Đó là kết quả của sự chuẩn bị, làm việc chăm chỉ và học hỏi từ thất bại.', author: 'Colin Powell' },
    { text: 'Người thành công không làm những điều khác biệt, họ làm những điều thông thường theo cách khác biệt.', author: 'Booker T. Washington' },
    { text: 'Bạn không cần phải vĩ đại để bắt đầu, nhưng bạn phải bắt đầu để trở nên vĩ đại.', author: 'Zig Ziglar' },
    { text: 'Điều quan trọng nhất là không bao giờ ngừng đặt câu hỏi.', author: 'Albert Einstein' },
    { text: 'Sự kiên nhẫn, sự bền bỉ và mồ hôi tạo thành một công thức bất khả chiến bại cho sự thành công.', author: 'Napoleon Hill' },
    { text: 'Kẻ thắng không bao giờ từ bỏ; kẻ từ bỏ không bao giờ thắng.', author: 'Vince Lombardi' },
    { text: 'Cuộc sống không phải là chờ đợi cơn bão qua đi— mà là học cách khiêu vũ dưới mưa.', author: 'Vivian Greene' },
    { text: 'Thay đổi thói quen, thay đổi cuộc đời.', author: 'Jack Canfield' },
    { text: 'Đầu tư tốt nhất bạn có thể thực hiện là đầu tư vào chính bản thân mình.', author: 'Warren Buffett' },
    { text: 'Sáng tạo là thông minh biết cách vui đùa.', author: 'Albert Einstein' },
    { text: 'Nếu bạn muốn sống một cuộc đời hạnh phúc, hãy gắn nó với một mục tiêu, không phải với con người hay đồ vật.', author: 'Albert Einstein' },
    { text: 'Thành công thường đến với những người quá bận rộn để tìm kiếm nó.', author: 'Henry David Thoreau' },
    { text: 'Hãy là sự thay đổi mà bạn muốn thấy trên thế giới.', author: 'Mahatma Gandhi' },
    { text: 'Tương lai thuộc về những ai tin vào vẻ đẹp của ước mơ.', author: 'Eleanor Roosevelt' },
    { text: 'Cách tốt nhất để dự đoán tương lai là tự tạo ra nó.', author: 'Peter Drucker' },
    { text: 'Nếu bạn không xây dựng giấc mơ của mình, ai đó sẽ thuê bạn để xây dựng giấc mơ của họ.', author: 'Tony Gaskins' },
    { text: 'Mỗi chuyên gia từng một lần là người mới bắt đầu. Mỗi người giỏi từng một lần là người không giỏi.', author: 'Robin Sharma' },
    { text: 'Đừng đếm những ngày, hãy làm cho những ngày đáng nhớ.', author: 'Muhammad Ali' },
    { text: 'Hạnh phúc không phải là thứ làm sẵn. Nó đến từ hành động của chính bạn.', author: 'Đạt Lai Lạt Ma' },
    { text: 'Năng lực của bạn để học hỏi và thích nghi là tài sản quý giá nhất bạn có.', author: 'Brian Tracy' },
];


// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    initUI();
    initSettings();
    loadData();
});

function initUI() {
    // Today's date (Sidebar & Dashboard Header)
    const today = new Date();
    const dateStrVi = formatDateVi(today);
    document.getElementById('todayDate').textContent = dateStrVi;

    const dashDate = document.getElementById('dashTodayDate');
    if (dashDate) dashDate.textContent = dateStrVi;

    // Greeting logic
    const hour = today.getHours();
    let greeting = 'Chào ngày mới';
    if (hour < 12) greeting = 'Chào buổi sáng';
    else if (hour < 18) greeting = 'Chào buổi chiều';
    else greeting = 'Chào buổi tối';

    const greetingEl = document.getElementById('greetingMsg');
    if (greetingEl) {
        const userName = localStorage.getItem('habitflow_user_name') || 'Người dùng';
        greetingEl.innerHTML = `${greeting}, <span class="user-name-val">${userName}</span>! 👋`;
    }

    // Câu nói theo ngày
    const dayIndex = (today.getDate() - 1) % QUOTES.length;
    const q = QUOTES[dayIndex];
    const quoteEl = document.getElementById('dailyQuote');
    if (quoteEl) quoteEl.textContent = `"${q.text}"`;
    const authorEl = document.getElementById('dailyQuoteAuthor');
    if (authorEl) authorEl.textContent = `— ${q.author}`;


    // Navigation
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
        el.addEventListener('click', e => {
            e.preventDefault();
            showPage(el.dataset.page);
        });
    });

    // Mobile menu
    document.getElementById('menuBtn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.add('open');
        document.getElementById('overlay').classList.add('show');
    });
    document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
    document.getElementById('overlay').addEventListener('click', closeSidebar);

    // View switch
    document.getElementById('btnMonthly').addEventListener('click', () => setView('monthly'));
    document.getElementById('btnWeekly').addEventListener('click', () => setView('weekly'));

    // Calendar navigation
    document.getElementById('prevPeriod').addEventListener('click', () => navigatePeriod(-1));
    document.getElementById('nextPeriod').addEventListener('click', () => navigatePeriod(1));
    document.getElementById('gotoToday').addEventListener('click', () => {
        state.currentDate = new Date();
        renderCalendar();
    });

    // Add habit
    document.getElementById('openAddHabit').addEventListener('click', () => openHabitModal());
    document.getElementById('openAddHabit2').addEventListener('click', () => openHabitModal());
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('cancelModal').addEventListener('click', closeModal);
    document.getElementById('confirmHabit').addEventListener('click', saveHabit);

    // Emoji picker
    document.querySelectorAll('.emoji-opt').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('.emoji-opt').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
            document.getElementById('habitIcon').value = el.dataset.emoji;
        });
    });

    // Color picker
    document.querySelectorAll('.color-opt').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('.color-opt').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
        });
    });

    // Search
    document.getElementById('habitSearch').addEventListener('input', e => {
        renderHabitsList(e.target.value.toLowerCase());
    });

    // Update profile display
    document.getElementById('userName').textContent = displayName;
    document.getElementById('displayNameInput').value = displayName;
    document.getElementById('apiUrlInput').value = API_URL;
}

function initSettings() {
    document.getElementById('saveApiUrl').addEventListener('click', () => {
        const url = document.getElementById('apiUrlInput').value.trim();
        if (!url) { showToast('Vui lòng nhập URL API!', 'error'); return; }
        API_URL = url;
        localStorage.setItem('habitflow_api_url', url);
        showApiStatus('success', '✅ Đã lưu API URL!');
        showToast('Đã lưu API URL thành công!', 'success');
        document.getElementById('apiBanner').classList.remove('show');
        loadData();
    });

    document.getElementById('testApiBtn').addEventListener('click', testAPI);

    document.getElementById('saveProfile').addEventListener('click', () => {
        const name = document.getElementById('displayNameInput').value.trim() || 'Người dùng';
        displayName = name;
        localStorage.setItem('habitflow_name', name);
        document.getElementById('userName').textContent = name;

        // Cập nhật greeting ở Dashboard nếu có
        const greetingVal = document.querySelector('.user-name-val');
        if (greetingVal) greetingVal.textContent = name;

        showToast('Đã lưu hồ sơ!', 'success');
    });
}

// ============================================================
// DATA LOADING
// ============================================================
async function loadData() {
    // 1️⃣ Hiển thị ngay từ cache (không cần chờ API)
    const hasCached = loadCache();
    if (hasCached) {
        renderAll();
    }

    if (!API_URL) {
        document.getElementById('apiBanner').classList.add('show');
        if (!hasCached) { renderCalendar(); renderTodayHabits(); renderHabitsList(); }
        return;
    }

    // 2️⃣ Load từ API ngầm (background refresh) — không block UI
    if (!hasCached) showLoading(true);
    try {
        const data = await apiGet({ action: 'getAll' });
        if (data.success) {
            // ✅ MERGE HABITS: Giữ lại trạng thái 'active' từ local nếu server chưa có
            const serverHabits = data.habits || [];
            state.habits = serverHabits.map(sh => {
                const localH = state.habits.find(lh => lh.id === sh.id);
                // Nếu server có giá trị active (sau khi đã update Code.gs) thì dùng của server
                // Nếu server chưa có (cũ) thì dùng của local
                if (sh.active !== undefined) return sh;
                return { ...sh, active: localH ? localH.active : true };
            });

            // ✅ MERGE COMPLETIONS (như cũ)
            state.completions = mergeCompletions(data.completions || [], state.completions);

            state.stats = data.stats || null;
            saveCache();
            renderAll();
        }
        else {
            showToast('Lỗi tải dữ liệu: ' + (data.error || 'Không xác định'), 'error');
            if (!hasCached) renderCalendar();
        }
    } catch (err) {
        if (!hasCached) {
            showToast('Không thể kết nối API. Đang dùng dữ liệu offline.', 'error');
            document.getElementById('apiBanner').classList.add('show');
            renderCalendar();
        } else {
            showToast('⚠️ Không thể kết nối API – đang hiển thị dữ liệu đã cache.', 'error');
        }
    } finally {
        showLoading(false);
    }
}

/**
 * Merge completions từ API với completions đang có trong cache.
 *
 * Quy tắc:
 *  - Lấy TẤT CẢ từ API (dữ liệu đã confirmed trên Sheets).
 *  - Giữ lại những item trong cache mà API CHƯA CÓ
 *    → đây là những tick vừa click chưa kịp sync lên Sheets.
 *
 * Kết quả: tick không bao giờ biến mất sau refresh.
 */
function mergeCompletions(fromAPI, fromCache) {
    const apiKeys = new Set(fromAPI.map(c => `${c.habitId}_${c.date}`));
    const pendingLocal = fromCache.filter(c => !apiKeys.has(`${c.habitId}_${c.date}`));
    return [...fromAPI, ...pendingLocal];
}

async function loadCompletionsForMonth(year, month) {
    if (!API_URL) return;
    try {
        const data = await apiGet({ action: 'getCompletions', year, month });
        if (data.success) {
            const prefix = `${year}-${String(month).padStart(2, '0')}`;
            // Lấy những tháng khác giữ nguyên, tháng mới dùng merge
            const otherMonths = state.completions.filter(c => !c.date.startsWith(prefix));
            const thisMerged = mergeCompletions(data.completions || [],
                state.completions.filter(c => c.date.startsWith(prefix)));
            state.completions = [...otherMonths, ...thisMerged];
            saveCache();
        }
    } catch { /* silent – dùng cache hiện tại */ }
}

function renderAll() {
    calculateLocalStats(); // Tính toán lại stats từ state local
    renderCalendar();
    renderTodayHabits();
    renderHabitsList();
    renderStats();
    updateXP();
    renderDailySummaries(); // Mới: Render tóm tắt 7 ngày
}

/**
 * Tính toán thống kê từ dữ liệu Local (Real-time)
 * Giúp người dùng thấy kết quả ngay lập tức khi tick thói quen
 */
function calculateLocalStats() {
    const habits = state.habits;
    const completions = state.completions;
    if (habits.length === 0) {
        state.stats = { totalHabits: 0, currentStreak: 0, consistencyScore: 0, last30Days: [], streaks: {} };
        return;
    }

    const activeHabits = habits.filter(h => h.active !== false);
    const activeCount = activeHabits.length || 1; // tránh chia cho 0
    const today = new Date();
    const last30Days = [];
    let totalPoints = 0;

    // 1. Tính toán 30 ngày gần nhất
    for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = formatDate(d);

        const doneCount = completions.filter(c => {
            const h = habits.find(hab => hab.id === c.habitId);
            return c.date === dateStr && (!h || h.active !== false);
        }).length;
        const pts = Math.round((doneCount / activeCount) * 100);

        last30Days.push({ date: dateStr, completed: doneCount, points: pts });
        totalPoints += pts;
    }

    // 2. Tính Consistency Score (30 ngày)
    const consistencyScore = Math.round(totalPoints / 30);

    // 3. Tính streaks cho từng habit
    const streaks = {};
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayStr = formatDate(yesterday);
    const todayStr = formatDate(today);

    habits.forEach(h => {
        let s = 0;
        let curr = new Date(today);

        // Kiểm tra xem hôm nay có làm không
        const isDoneToday = completions.some(c => c.habitId === h.id && c.date === todayStr);
        const isDoneYesterday = completions.some(c => c.habitId === h.id && c.date === yesterdayStr);

        // Nếu không làm cả hôm qua lẫn hôm nay -> streak = 0
        if (!isDoneToday && !isDoneYesterday) {
            streaks[h.id] = 0;
            return;
        }

        // Bắt đầu đếm ngược từ hôm nay hoặc hôm qua
        let checkDate = isDoneToday ? new Date(today) : new Date(yesterday);
        while (true) {
            const dStr = formatDate(checkDate);
            if (completions.some(c => c.habitId === h.id && c.date === dStr)) {
                s++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }
        streaks[h.id] = s;
    });

    // 4. Tính Overall Current Streak (Ngày có ít nhất 1 habit xong)
    let currentStreak = 0;
    const hasToday = completions.some(c => c.date === todayStr);
    const hasYesterday = completions.some(c => c.date === yesterdayStr);

    if (hasToday || hasYesterday) {
        let d = hasToday ? new Date(today) : new Date(yesterday);
        while (true) {
            const dStr = formatDate(d);
            if (completions.some(c => c.date === dStr)) {
                currentStreak++;
                d.setDate(d.getDate() - 1);
            } else {
                break;
            }
        }
    }

    state.stats = {
        totalHabits: habits.length,
        currentStreak,
        consistencyScore,
        last30Days,
        streaks
    };
}

// ============================================================
// CALENDAR
// ============================================================
function renderCalendar() {
    const container = document.getElementById('calendarContainer');
    updateCalendarTitle();
    if (state.viewMode === 'monthly') {
        container.innerHTML = renderMonthlyCalendar();
        attachCalendarEvents();
    } else {
        container.innerHTML = renderWeeklyCalendar();
        attachCalendarEvents();
    }
}

function updateCalendarTitle() {
    const d = state.currentDate;
    const months = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
        'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
    document.getElementById('calendarTitle').textContent = `${months[d.getMonth()]}, ${d.getFullYear()}`;
}

function renderMonthlyCalendar() {
    const d = state.currentDate;
    const year = d.getFullYear(), month = d.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = formatDate(new Date());

    const dayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    let html = `<div class="cal-month-head">`;
    dayLabels.forEach(l => html += `<div class="cal-day-label">${l}</div>`);
    html += '</div><div class="cal-month-grid">';

    // Ô trống đầu (ngày tháng trước)
    const prevDaysInMonth = new Date(year, month, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
        const day = prevDaysInMonth - i;
        const dateStr = formatDateFromParts(year, month - 1, day);
        html += buildCalCell(dateStr, day, true, today);
    }

    // Ngày trong tháng
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = formatDateFromParts(year, month, day);
        html += buildCalCell(dateStr, day, false, today);
    }

    // Ô trống cuối (ngày tháng sau)
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    let nextDay = 1;
    for (let i = firstDay + daysInMonth; i < totalCells; i++) {
        const dateStr = formatDateFromParts(year, month + 1, nextDay);
        html += buildCalCell(dateStr, nextDay++, true, today);
    }

    html += '</div>';
    return html;
}

function buildCalCell(dateStr, dayNum, isOther, today) {
    const dayCompletions = state.completions.filter(c => c.date === dateStr);
    const completedIds = dayCompletions.map(c => c.habitId);
    const activeHabits = state.habits.filter(h => h.active !== false || completedIds.includes(h.id));
    const totalActive = state.habits.filter(h => h.active !== false).length;
    const doneActive = dayCompletions.filter(c => {
        const h = state.habits.find(hab => hab.id === c.habitId);
        return h && h.active !== false;
    }).length;
    const pct = totalActive > 0 ? Math.round((doneActive / totalActive) * 100) : 0;

    let ptsClass = '';
    let ptsBg = '';
    if (pct === 100) { ptsClass = 'color:#10b981'; ptsBg = 'background:rgba(16,185,129,.2)'; }
    else if (pct >= 50) { ptsClass = 'color:#f59e0b'; ptsBg = 'background:rgba(245,158,11,.2)'; }
    else if (pct > 0) { ptsClass = 'color:#8b949e'; ptsBg = 'background:rgba(139,148,158,.1)'; }

    const isToday = dateStr === today;
    let cellClass = 'cal-cell' + (isOther ? ' other-month' : '') + (isToday ? ' today' : '');

    let habitsHtml = '';
    (activeHabits.slice(0, 4)).forEach(h => {
        const isDone = completedIds.includes(h.id);
        const isPaused = h.active === false;
        habitsHtml += `<div class="cal-habit-row ${isDone ? 'done' : ''} ${isPaused ? 'paused' : ''}" 
      data-habit="${h.id}" data-date="${dateStr}" 
      style="color:${isPaused ? 'var(--text-dim)' : (h.color || '#6366f1')}">
      <div class="habit-check"></div>
      <span>${h.icon || '⭐'} ${h.name}</span>
    </div>`;
    });
    if (activeHabits.length > 4) {
        habitsHtml += `<div style="font-size:10px;color:var(--text-dim);padding-left:4px">+${activeHabits.length - 4} khác</div>`;
    }

    return `<div class="${cellClass}">
    <div class="cal-date">
      <span>${dayNum}</span>
      ${totalActive > 0 ? `<span class="cal-pts-badge" style="${ptsClass};${ptsBg}">${pct}%</span>` : ''}
    </div>
    <div class="cal-habits-mini">${habitsHtml}</div>
    ${totalActive > 0 ? `<div class="cal-progress-bar"><div class="cal-progress-fill" style="width:${pct}%"></div></div>` : ''}
  </div>`;
}

function renderWeeklyCalendar() {
    const today = new Date();
    // Tuần chứa currentDate
    const d = new Date(state.currentDate);
    const firstDayOfWeek = new Date(d);
    firstDayOfWeek.setDate(d.getDate() - d.getDay());

    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const day = new Date(firstDayOfWeek);
        day.setDate(firstDayOfWeek.getDate() + i);
        weekDays.push(day);
    }

    const todayStr = formatDate(today);
    const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    let html = '<div class="cal-week">';

    // Header row
    html += '<div class="cal-week-corner"></div>';
    weekDays.forEach((day, i) => {
        const isToday = formatDate(day) === todayStr;
        html += `<div class="cal-week-day ${isToday ? 'today-col' : ''}">
      <div class="wday">${dayNames[i]}</div>
      <div class="wdate">${day.getDate()}</div>
    </div>`;
    });

    // Habit rows
    state.habits.filter(h => h.active !== false).forEach(h => {
        html += `<div class="cal-habit-label">
      <div class="habit-dot" style="background:${h.color}"></div>
      ${h.icon} ${h.name}
    </div>`;
        weekDays.forEach(day => {
            const dateStr = formatDate(day);
            const isDone = state.completions.some(c => c.habitId === h.id && c.date === dateStr);
            html += `<div class="cal-week-cell ${isDone ? 'done' : ''}" data-habit="${h.id}" data-date="${dateStr}">
        <div class="cal-week-check" style="${isDone ? `background:${h.color}; border-color:${h.color}` : ''}">
          ${isDone ? '✓' : ''}
        </div>
      </div>`;
        });
    });

    html += '</div>';
    return html;
}

function attachCalendarEvents() {
    // Monthly: click habit row
    document.querySelectorAll('.cal-habit-row').forEach(el => {
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            const habitId = el.dataset.habit;
            const date = el.dataset.date;
            await toggleCompletion(habitId, date);
        });
    });

    // Weekly: click cell
    document.querySelectorAll('.cal-week-cell').forEach(el => {
        el.addEventListener('click', async () => {
            const habitId = el.dataset.habit;
            const date = el.dataset.date;
            await toggleCompletion(habitId, date);
        });
    });
}

// ============================================================
// TODAY PANEL
// ============================================================
function renderTodayHabits() {
    const container = document.getElementById('todayHabits');
    const today = formatDate(new Date());
    const todayComp = state.completions.filter(c => c.date === today).map(c => c.habitId);

    if (state.habits.length === 0) {
        container.innerHTML = '<div class="empty-state-sm">Chưa có thói quen nào. Thêm thói quen mới nhé!</div>';
        document.getElementById('todayProgress').textContent = '0/0';
        return;
    }

    const activeHabits = state.habits.filter(h => h.active !== false);
    const completedActiveCount = todayComp.filter(id => {
        const h = state.habits.find(hab => hab.id === id);
        return h && h.active !== false;
    }).length;

    const totalCount = activeHabits.length;
    document.getElementById('todayProgress').textContent = `${completedActiveCount}/${totalCount}`;

    // 🎯 Cập nhật Dash Summary
    const pct = totalCount > 0 ? Math.round((completedActiveCount / totalCount) * 100) : 0;
    const dashPct = document.getElementById('dashTodayPct');
    if (dashPct) dashPct.textContent = `${pct}%`;

    // 🎯 Vẽ biểu đồ tròn % (Goal Circle)
    renderGoalCircle(completedActiveCount, totalCount);

    container.innerHTML = activeHabits.map(h => {
        const isDone = todayComp.includes(h.id);
        return `
            <div class="today-habit-item ${isDone ? 'done' : ''}" data-habit="${h.id}" data-date="${today}">
                <div class="today-habit-main">
                    <span class="today-habit-icon">${h.icon || '⭐'}</span>
                    <span class="today-habit-name">${h.name}</span>
                </div>
                <div class="today-check"></div>
            </div>`;
    }).join('');

    container.querySelectorAll('.today-habit-item').forEach(el => {
        el.addEventListener('click', async () => {
            await toggleCompletion(el.dataset.habit, el.dataset.date);
        });
    });
}

// ============================================================
// DASHBOARD DAILY SUMMARIES – TUẦN HIỆN TẠI
// Hiện 7 ngày (T2→CN). Hôm nay phóng to, bên trái cùng.
// ============================================================
function renderDailySummaries() {
    const container = document.getElementById('dailySummariesContainer');
    if (!container) return;

    const now = new Date();
    const todayStr = formatDate(now);

    // Tính Thứ 2 đầu tuần
    const dow = now.getDay(); // 0=CN, 1=T2 … 6=T7
    const diffToMon = dow === 0 ? 6 : dow - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMon);

    // Tạo 7 ngày T2 → CN
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        weekDays.push(d);
    }

    // Sắp xếp: TODAY trước, rồi các ngày còn lại theo thứ tự gốc T2→CN
    const todayIndex = weekDays.findIndex(d => formatDate(d) === todayStr);
    const sorted = [];
    sorted.push(weekDays[todayIndex]); // Hôm nay đầu tiên
    // Sau đó các ngày còn lại (giữ nguyên thứ tự T2→CN, bỏ qua hôm nay)
    for (let i = 0; i < weekDays.length; i++) {
        if (i !== todayIndex) sorted.push(weekDays[i]);
    }

    const activeHabits = state.habits.filter(h => h.active !== false);
    const dayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

    container.innerHTML = sorted.map((date, idx) => {
        const dateStr = formatDate(date);
        const isToday = dateStr === todayStr;
        const isFuture = date > now && !isToday;
        const isPast = date < new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const dayName = isToday ? 'TODAY' : dayLabels[date.getDay()];
        const displayDate = `Thg ${date.getMonth() + 1}, ${date.getDate()}`;

        const dayCompletions = state.completions.filter(c => c.date === dateStr);
        const total = activeHabits.length;
        const done = dayCompletions.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const points = done * 10;
        const totalPoints = total * 10;

        // Status icon
        let statusIcon = '';
        let statusClass = '';
        if (isFuture) {
            statusIcon = '<i class="fa-regular fa-clock"></i>';
            statusClass = 'future';
        } else if (pct === 100) {
            statusIcon = '<i class="fa-solid fa-circle-check"></i>';
            statusClass = 'success';
        } else if (isToday && pct > 0) {
            statusIcon = '<i class="fa-solid fa-rotate-right fa-spin"></i>';
            statusClass = 'today';
        } else if (isToday) {
            statusIcon = '<i class="fa-solid fa-rotate-right"></i>';
            statusClass = 'today';
        } else if (isPast && pct > 0) {
            // Quá khứ hoàn thành 1 phần → dấu tích xanh nửa
            statusIcon = '<i class="fa-solid fa-circle-check"></i>';
            statusClass = 'past-partial';
        } else if (isPast) {
            // Quá khứ 0% → dấu X mờ
            statusIcon = '<i class="fa-solid fa-circle-xmark"></i>';
            statusClass = 'past-empty';
        }

        // ── Màu sắc theo thời gian ──
        // Quá khứ: xanh lá (#10b981) | Hôm nay: tím accent (#6366f1) | Tương lai: xanh cyan (#06b6d4)
        let circleStroke, timeClass;
        if (isFuture) {
            circleStroke = pct > 0 ? '#06b6d4' : 'var(--border)';
            timeClass = 'future';
        } else if (isToday) {
            circleStroke = pct === 100 ? 'var(--green)' : (pct > 0 ? 'var(--accent)' : 'var(--border)');
            timeClass = 'current';
        } else {
            // Quá khứ
            circleStroke = pct === 100 ? 'var(--green)' : (pct > 0 ? 'var(--amber)' : 'var(--border)');
            timeClass = 'past';
        }

        // ── TODAY: Biểu đồ tròn phát sáng (Glow Ring) ──
        if (isToday) {
            const R = 52;
            const circSize = 120;
            const circCenter = circSize / 2;
            const circ = 2 * Math.PI * R;
            const circOffset = circ - (pct / 100) * circ;
            const glowColor = pct === 100 ? '#10b981' : '#22d3ee';

            return `
                <div class="daily-card today time-${timeClass}">
                    <div class="daily-card-header">
                        <div class="header-text">
                            <div class="daily-day-name">${dayName}</div>
                            <div class="daily-date">${displayDate}</div>
                        </div>
                        <div class="daily-status-icon ${statusClass}">${statusIcon}</div>
                    </div>
                    <div class="today-glow-wrapper">
                        <div class="today-glow-ring">
                            <svg width="${circSize}" height="${circSize}" viewBox="0 0 ${circSize} ${circSize}">
                                <defs>
                                    <filter id="glowFilter" x="-50%" y="-50%" width="200%" height="200%">
                                        <feGaussianBlur stdDeviation="4" result="blur"/>
                                        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
                                    </filter>
                                </defs>
                                <circle class="glow-bg" cx="${circCenter}" cy="${circCenter}" r="${R}"></circle>
                                <circle class="glow-fill" cx="${circCenter}" cy="${circCenter}" r="${R}" 
                                    filter="url(#glowFilter)"
                                    style="stroke-dasharray: ${circ}; stroke-dashoffset: ${circOffset}; stroke: ${glowColor}"></circle>
                            </svg>
                            <div class="glow-center-text">
                                <span class="glow-pct">${pct}%</span>
                            </div>
                        </div>
                        <div class="today-glow-stats">
                            <span class="glow-points">${points}/${totalPoints}</span>
                            <span class="glow-label">POINTS</span>
                        </div>
                    </div>
                </div>
            `;
        }


        // ── OTHER DAYS: Biểu đồ tròn ──
        const r = 20;
        const size = 44;
        const center = size / 2;
        const circumference = 2 * Math.PI * r;
        const offset = isFuture ? circumference : circumference - (pct / 100) * circumference;

        return `
            <div class="daily-card ${isFuture ? 'future' : ''} time-${timeClass}">
                <div class="daily-card-header">
                    <div class="header-text">
                        <div class="daily-day-name">${dayName}</div>
                        <div class="daily-date">${displayDate}</div>
                    </div>
                    <div class="daily-status-icon ${statusClass}">${statusIcon}</div>
                </div>
                <div class="daily-card-body">
                    <div class="daily-progress-circle">
                        <svg width="${size}" height="${size}">
                            <circle class="bg" cx="${center}" cy="${center}" r="${r}"></circle>
                            <circle class="fill" cx="${center}" cy="${center}" r="${r}" 
                                style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}; stroke: ${circleStroke}"></circle>
                        </svg>
                        <span class="pct">${isFuture ? '—' : pct + '%'}</span>
                    </div>
                    <div class="daily-card-stats">
                        <span class="daily-stats-label">Points</span>
                        <span class="daily-stats-val">${isFuture ? '—' : points + '/' + totalPoints}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderGoalCircle(done, total) {
    const canvas = document.getElementById('goalCircle');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pct = total > 0 ? (done / total) : 0;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = (canvas.width / 2) - 5;

    // Background circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Progress arc
    if (pct > 0) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, -Math.PI / 2, (-Math.PI / 2) + (2 * Math.PI * pct));
        ctx.strokeStyle = '#6366f1';
        ctx.lineCap = 'round';
        ctx.lineWidth = 6;
        ctx.stroke();
    }

    // Text %
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(pct * 100) + '%', centerX, centerY);
}

function renderHabitConsistency() {
    // 1. Render for Stats Page
    const statsContainer = document.getElementById('habitConsistencyList');
    const dashContainer = document.getElementById('dashConsistencyList');

    const active = state.habits.filter(h => h.active !== false);

    if (statsContainer) {
        if (active.length === 0) {
            statsContainer.innerHTML = '<div class="empty-state-sm">Không có thói quen đang hoạt động</div>';
        } else {
            statsContainer.innerHTML = active.map(h => {
                const doneCount = state.completions.filter(c => c.habitId === h.id).length;
                const pct = Math.min(100, (doneCount / 30) * 100);
                return `
                    <div class="consistency-item">
                        <div class="consistency-top">
                            <div class="consistency-info">
                                <span class="consistency-icon" style="background:${h.color}15">${h.icon}</span>
                                <span class="consistency-name">${h.name}</span>
                            </div>
                            <span class="consistency-label">${doneCount}/30 Days</span>
                        </div>
                        <div class="consistency-bar-bg">
                            <div class="consistency-bar-fill" style="width:${pct}%; background:${h.color}"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // 2. Render for Dashboard (New Design)
    if (dashContainer) {
        if (active.length === 0) {
            dashContainer.innerHTML = '<div class="empty-state-sm">Bắt đầu thói quen ngay!</div>';
        } else {
            dashContainer.innerHTML = active.map(h => {
                const doneCount = state.completions.filter(c => c.habitId === h.id).length;
                const pct = Math.min(100, (doneCount / 30) * 100);
                return `
                    <div class="consistency-dash-item">
                        <div class="consistency-dash-top">
                            <div class="consistency-dash-info">
                                <span class="consistency-dash-icon" style="background:${h.color}15">${h.icon}</span>
                                <span class="consistency-dash-name">${h.name}</span>
                            </div>
                            <span class="consistency-dash-label">${doneCount}/30 Days</span>
                        </div>
                        <div class="consistency-dash-bar-bg">
                            <div class="consistency-dash-bar-fill" style="width:${pct}%; background:${h.color}"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}

// ============================================================
// HABITS LIST PAGE
// ============================================================
function renderHabitsList(filter = '') {
    const container = document.getElementById('habitsList');
    const filtered = state.habits.filter(h =>
        h.name.toLowerCase().includes(filter)
    );

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state-sm" style="padding:40px 0">
      ${filter ? '🔍 Không tìm thấy thói quen phù hợp' : '✨ Chưa có thói quen nào. Hãy thêm thói quen mới!'}
    </div>`;
        return;
    }

    container.innerHTML = filtered.map(h => {
        const streak = state.stats?.streaks?.[h.id] || 0;
        const allDone = state.completions.filter(c => c.habitId === h.id).length;
        const isActive = h.active !== false;

        return `<div class="habit-card ${!isActive ? 'inactive' : ''}" data-habit-id="${h.id}">
      <div class="habit-card-icon" style="border-color:${h.color}30">${h.icon || '⭐'}</div>
      <div class="habit-card-info">
        <div class="habit-card-name" style="color:${isActive ? h.color : 'var(--text-dim)'}">${h.name} ${!isActive ? '<span class="status-badge">Đã tắt</span>' : ''}</div>
        <div class="habit-card-meta">📊 ${allDone} lần hoàn thành</div>
      </div>
      <div class="habit-card-streak">
        <div class="streak-num">🔥 ${streak}</div>
        <div class="streak-lbl">NGÀY LIÊN TIẾP</div>
      </div>
      <div class="habit-card-actions">
        <button class="toggle-status-btn ${isActive ? 'active' : ''}" title="${isActive ? 'Tạm dừng' : 'Kích hoạt'}" onclick="toggleHabitStatus('${h.id}')">
          <i class="fa-solid ${isActive ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
        </button>
        <button class="btn-icon" title="Chỉnh sửa" onclick="editHabit('${h.id}')">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn-icon danger" title="Xoá" onclick="confirmDeleteHabit('${h.id}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>`;
    }).join('');
}

async function toggleHabitStatus(habitId) {
    const habit = state.habits.find(h => h.id === habitId);
    if (!habit) return;

    habit.active = habit.active === false ? true : false;
    saveCache();
    renderAll();

    if (API_URL) {
        try {
            await apiPost({ action: 'updateHabit', habitId: habit.id, active: habit.active });
        } catch {
            showToast('⚠️ Đồng bộ trạng thái lỗi – sẽ thử lại sau.', 'error');
        }
    }
}

// ============================================================
// STATS PAGE
// ============================================================
function renderStats() {
    if (!state.stats) return;
    const s = state.stats;

    const statTotalHabits = document.getElementById('statTotalHabits');
    const statStreak = document.getElementById('statStreak');
    const statScore = document.getElementById('statScore');
    const statTotalDone = document.getElementById('statTotalDone');

    if (statTotalHabits) statTotalHabits.textContent = s.totalHabits || 0;
    if (statStreak) statStreak.textContent = (s.currentStreak || 0) + ' ngày';
    if (statScore) statScore.textContent = (s.consistencyScore || 0) + '%';

    if (statTotalDone) {
        const totalDone = (s.last30Days || []).reduce((sum, d) => sum + d.completed, 0);
        statTotalDone.textContent = totalDone;
    }

    // Streaks list
    const list = document.getElementById('streaksList');
    const maxStreak = Math.max(1, ...Object.values(s.streaks || {}));
    list.innerHTML = state.habits.map(h => {
        const st = s.streaks?.[h.id] || 0;
        const pct = Math.round((st / maxStreak) * 100);
        return `<div class="streak-item">
      <span class="streak-icon">${h.icon || '⭐'}</span>
      <span class="streak-name">${h.name}</span>
      <div class="streak-bar-wrap">
        <div class="streak-bar-fill" style="width:${pct}%; background:${h.color}"></div>
      </div>
      <span class="streak-val">🔥 ${st}</span>
    </div>`;
    }).join('') || '<div class="empty-state-sm">Chưa có dữ liệu</div>';

    renderStatsChart(s.last30Days || []);
    renderHabitConsistency(); // Render danh sách bền bỉ (bây giờ ở trang Thống kê)

    // Dashboard milestones
    const dashStreak = document.getElementById('dashCurrentStreak');
    if (dashStreak) dashStreak.textContent = `${s.currentStreak || 0} Ngày`;

    // Milestones (old element if kept)
    const curStreakEl = document.getElementById('currentStreak');
    if (curStreakEl) curStreakEl.innerHTML = `🔥 ${s.currentStreak || 0} Ngày`;

    const consisScoreEl = document.getElementById('consistencyScore');
    if (consisScoreEl) consisScoreEl.innerHTML = `📈 ${s.consistencyScore || 0}%`;

    // Badges section (Stats Page)
    renderBadges();
}

function renderBadges() {
    const container = document.getElementById('badgesContainer');
    if (!container) return;

    container.innerHTML = BADGES.map(b => {
        const isUnlocked = state.unlockedBadges.includes(b.id);
        return `
            <div class="badge-item ${isUnlocked ? 'unlocked' : 'locked'}">
                <div class="badge-icon">${isUnlocked ? b.icon : '🔒'}</div>
                <div class="badge-info">
                    <div class="badge-name">${b.name}</div>
                    <div class="badge-desc">${b.desc}</div>
                </div>
            </div>
        `;
    }).join('');
}

let statsChartInst = null;
function renderStatsChart(data) {
    const ctx = document.getElementById('statsChart');
    if (!ctx) return;
    if (statsChartInst) statsChartInst.destroy();

    // Style matching the user's image (Teal line area chart)
    statsChartInst = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => {
                const date = new Date(d.date);
                return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
            }),
            datasets: [{
                label: 'Hoàn thành (%)',
                data: data.map(d => d.points),
                borderColor: '#10b981', // Teal color from image
                backgroundColor: 'rgba(16, 185, 129, 0.15)', // Light teal fill
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: '#10b981',
                pointBorderColor: '#fff',
                pointBorderWidth: 1,
                pointRadius: 4,
                pointHoverRadius: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: ctx => `${ctx.raw}%` }
                }
            },
            scales: {
                y: {
                    min: 0, max: 100,
                    grid: { color: 'rgba(48, 54, 61, 0.4)' },
                    ticks: {
                        color: '#8b949e',
                        font: { size: 10 },
                        callback: v => v + '%'
                    }
                },
                x: {
                    grid: { color: 'rgba(48, 54, 61, 0.2)' },
                    ticks: {
                        color: '#8b949e',
                        font: { size: 10 }, // Trả về cỡ chữ bình thường cho full-width
                        maxRotation: 0,
                        minRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 15
                    }
                }
            }
        }
    });
}



function updateXP() {
    const totalDone = state.completions.length;
    const xp = totalDone * 10;

    let level = 1;
    let tempXp = xp;
    while (tempXp >= level * 100) {
        tempXp -= level * 100;
        level++;
    }

    const xpNeeded = level * 100;
    const progress = Math.min(100, (tempXp / xpNeeded) * 100);

    // Sidebar & Sidebar stats
    const userXPEl = document.getElementById('userXP');
    const xpBarEl = document.getElementById('xpBar');
    if (userXPEl) userXPEl.textContent = `${xp} XP · Level ${level}`;
    if (xpBarEl) xpBarEl.style.width = progress + '%';

    // Dashboard Info
    const dashLevel = document.getElementById('dashLevel');
    if (dashLevel) dashLevel.textContent = `Cấp ${level}`;

    // Update Premium Rank Card
    updateRankCard(level, tempXp, xpNeeded, progress);

    // Check badges
    checkBadges(totalDone, level);
}

function updateRankCard(level, currentXP, nextXP, progress) {
    const rankNameEl = document.getElementById('rankName');
    const rankLevelEl = document.getElementById('rankLevel');
    const rankXPTextEl = document.getElementById('rankXPText');
    const rankProgressBarEl = document.getElementById('rankProgressBar');
    const nextMilestoneEl = document.getElementById('nextMilestone');

    if (!rankNameEl) return;

    // Rank Logic
    let rank = 'Novice Habit-builder';
    if (level > 20) rank = 'Unstoppable Force';
    else if (level > 15) rank = 'Master of Will';
    else if (level > 10) rank = 'Elite Performer';
    else if (level > 5) rank = 'Disciplined Learner';

    rankNameEl.textContent = rank;
    rankLevelEl.textContent = `Level ${level}`;
    rankXPTextEl.textContent = `${currentXP.toLocaleString()} / ${nextXP.toLocaleString()} XP`;
    rankProgressBarEl.style.width = progress + '%';

    // Milestone Logic
    let nextMilestone = 'Level ' + (level + 1);
    // Suggest unobtained badges
    const unobtained = BADGES.filter(b => !state.unlockedBadges.includes(b.id));
    if (unobtained.length > 0) {
        nextMilestone = `"${unobtained[0].name}" Badge`;
    }

    nextMilestoneEl.textContent = nextMilestone;
}

function checkBadges(totalDone, level) {
    const newlyUnlocked = [];
    const stats = state.stats;

    BADGES.forEach(b => {
        if (state.unlockedBadges.includes(b.id)) return;

        let unlocked = false;
        if (b.id === 'first_step' && totalDone >= 1) unlocked = true;
        if (b.id === 'streak_7' && (stats?.currentStreak || 0) >= 7) unlocked = true;
        if (b.id === 'consistency_pro' && (stats?.consistencyScore || 0) >= 90) unlocked = true;
        if (b.id === 'habit_master' && totalDone >= 100) unlocked = true;
        if (b.id === 'multi_tasker' && state.habits.length >= 5) unlocked = true;

        if (unlocked) {
            state.unlockedBadges.push(b.id);
            newlyUnlocked.push(b);
        }
    });

    if (newlyUnlocked.length > 0) {
        localStorage.setItem('habitflow_badges', JSON.stringify(state.unlockedBadges));
        newlyUnlocked.forEach(b => {
            showToast(`🏆 Mở khóa danh hiệu: ${b.name} ${b.icon}`, 'success');
        });
        if (state.currentPage === 'stats') renderStats(); // Refresh stats page if open
    }
}

// ============================================================
// TOGGLE COMPLETION
// ✅ Tick → lưu cache ngay lập tức → sync API ngầm
// ❌ Không bao giờ revert UI dù API lỗi
// ============================================================
function toggleCompletion(habitId, date) {
    // 1️⃣ Cập nhật state ngay lập tức
    const existingIdx = state.completions.findIndex(
        c => c.habitId === habitId && c.date === date
    );
    const isNowDone = existingIdx < 0; // true = vừa tick, false = vừa bỏ tick

    if (existingIdx >= 0) {
        state.completions.splice(existingIdx, 1);
    } else {
        state.completions.push({ habitId, date, completedAt: new Date().toISOString() });
    }

    // 2️⃣ Lưu cache ngay – giữ nguyên dù reload trang
    saveCache();

    // 3️⃣ Cập nhật UI ngay
    calculateLocalStats(); // Tính stats mới ngay
    renderCalendar();
    renderTodayHabits();
    renderStats(); // Update dashboard & stats page
    updateXP();
    renderDailySummaries(); // Update Daily Summaries (points)

    // 4️⃣ Hiện toast tức thì (không chờ API)
    showToast(isNowDone ? '✅ Đã hoàn thành! Đang lưu...' : '↩️ Đã bỏ đánh dấu', 'success');

    if (!API_URL) {
        // Không có API: vẫn lưu cache, chỉ cảnh báo
        showToast('💾 Lưu offline – kết nối API để đồng bộ lên Sheets', 'error');
        return;
    }

    // 5️⃣ Đẩy vào queue để sync lên Google Sheets ngầm
    enqueuSync(habitId, date);
}

// ============================================================
// HABIT MODAL
// ============================================================
function openHabitModal(habit = null) {
    state.editingHabitId = habit?.id || null;
    document.getElementById('modalTitle').textContent = habit ? 'Chỉnh sửa thói quen' : 'Thêm thói quen mới';
    document.getElementById('habitName').value = habit?.name || '';
    document.getElementById('habitIcon').value = habit?.icon || '';

    // emoji
    document.querySelectorAll('.emoji-opt').forEach(e => {
        e.classList.toggle('selected', e.dataset.emoji === (habit?.icon || '⭐'));
    });
    // color
    document.querySelectorAll('.color-opt').forEach(e => {
        e.classList.toggle('selected', e.dataset.color === (habit?.color || '#6366f1'));
    });

    document.getElementById('habitModal').classList.add('show');
}

function closeModal() {
    document.getElementById('habitModal').classList.remove('show');
    state.editingHabitId = null;
}

async function saveHabit() {
    const name = document.getElementById('habitName').value.trim();
    if (!name) { showToast('Vui lòng nhập tên thói quen!', 'error'); return; }

    const iconInput = document.getElementById('habitIcon').value.trim();
    const selectedEmoji = document.querySelector('.emoji-opt.selected')?.dataset.emoji || '⭐';
    const icon = iconInput || selectedEmoji;
    const color = document.querySelector('.color-opt.selected')?.dataset.color || '#6366f1';

    closeModal();
    showLoading(true);

    try {
        if (state.editingHabitId) {
            const idx = state.habits.findIndex(h => h.id === state.editingHabitId);
            if (idx >= 0) {
                state.habits[idx].name = name;
                state.habits[idx].icon = icon;
                state.habits[idx].color = color;
            }
            if (API_URL) {
                const habit = state.habits[idx];
                const result = await apiPost({
                    action: 'updateHabit',
                    habitId: state.editingHabitId,
                    name,
                    icon,
                    color,
                    active: habit.active !== false
                });
                if (result.success) {
                    showToast('✅ Đã cập nhật thói quen!', 'success');
                } else {
                    throw new Error(result.error || 'Lỗi không xác định khi cập nhật');
                }
            } else {
                showToast('✅ Đã cập nhật thói quen!', 'success');
            }
        } else {
            const newHabit = { name, icon, color, active: true, createdAt: new Date().toISOString() };
            if (!API_URL) {
                newHabit.id = 'local_' + Date.now();
                state.habits.push(newHabit);
                showToast('✅ Đã thêm thói quen mới!', 'success');
            } else {
                const result = await apiPost({ action: 'addHabit', ...newHabit });
                if (result.success) {
                    state.habits.push(result.habit);
                    showToast('✅ Đã thêm thói quen mới!', 'success');
                } else {
                    throw new Error(result.error || 'Lỗi không xác định khi thêm mới');
                }
            }
        }
        saveCache(); // lưu habits mới vào cache
        renderAll();
    } catch (err) {
        showToast('Lỗi: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

function editHabit(habitId) {
    const habit = state.habits.find(h => h.id === habitId);
    if (habit) openHabitModal(habit);
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('show');
}

function showConfirmModal({ title, message, onConfirm, confirmText, isDanger }) {
    document.getElementById('confirmTitle').textContent = title || 'Xác nhận';
    document.getElementById('confirmMessage').textContent = message || 'Bạn có chắc chắn?';

    const confirmBtn = document.getElementById('btnConfirmAction');
    confirmBtn.innerHTML = `<i class="fa-solid fa-${isDanger ? 'trash' : 'check'}"></i> ${confirmText || 'Đồng ý'}`;
    confirmBtn.className = `btn-confirm ${isDanger ? 'danger' : ''}`;

    // Xoá listeners cũ bằng cách clone node
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

    newBtn.addEventListener('click', () => {
        onConfirm();
        closeConfirmModal();
    });

    document.getElementById('confirmModal').classList.add('show');
}

async function confirmDeleteHabit(habitId) {
    const habit = state.habits.find(h => h.id === habitId);
    const name = habit ? habit.name : 'thói quen này';

    showConfirmModal({
        title: 'Xoá thói quen',
        message: `Bạn có chắc muốn xoá "${name}" không?\nDữ liệu lịch sử liên quan sẽ bị xoá vĩnh viễn.`,
        confirmText: 'Đồng ý xoá',
        isDanger: true,
        onConfirm: async () => {
            // Xoá ngay lập tức trên UI
            state.habits = state.habits.filter(h => h.id !== habitId);
            state.completions = state.completions.filter(c => c.habitId !== habitId);
            saveCache();
            showToast('🗑️ Đã xoá thói quen!', 'success');
            renderAll();

            if (API_URL) {
                showLoading(true);
                try {
                    await apiPost({ action: 'deleteHabit', habitId });
                } catch {
                    showToast('⚠️ Xoá offline – chưa đồng bộ lên Sheets.', 'error');
                } finally {
                    showLoading(false);
                }
            }
        }
    });
}

// ============================================================
// API HELPERS
// ============================================================
async function apiGet(params) {
    const url = new URL(API_URL);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
    const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
    return res.json();
}

async function apiPost(body) {
    const res = await fetch(API_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(body)
    });
    return res.json();
}

async function testAPI() {
    const url = document.getElementById('apiUrlInput').value.trim();
    if (!url) { showToast('Nhập URL trước!', 'error'); return; }
    const btn = document.getElementById('testApiBtn');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kiểm tra...';
    try {
        const res = await fetch(url + '?action=getHabits', { redirect: 'follow' });
        const data = await res.json();
        if (data.success !== undefined) {
            showApiStatus('success', `✅ Kết nối thành công! Tìm thấy ${data.habits?.length || 0} thói quen.`);
        } else {
            showApiStatus('error', '❌ API trả về dữ liệu không hợp lệ');
        }
    } catch (err) {
        showApiStatus('error', '❌ Lỗi kết nối: ' + err.message);
    } finally {
        btn.innerHTML = '<i class="fa-solid fa-vial"></i> Kiểm tra kết nối';
    }
}

function showApiStatus(type, msg) {
    const el = document.getElementById('apiStatus');
    el.className = 'api-status ' + type;
    el.textContent = msg;
    setTimeout(() => el.className = 'api-status', 5000);
}

// ============================================================
// NAVIGATION
// ============================================================
function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + name)?.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.page === name);
    });
    const titles = { dashboard: 'Dashboard', habits: 'Thói quen', stats: 'Thống kê', settings: 'Cài đặt' };
    document.querySelector('#pageTitle h1').textContent = titles[name] || name;
    closeSidebar();
    if (name === 'stats') { renderStats(); }
}

function setView(mode) {
    state.viewMode = mode;
    document.getElementById('btnMonthly').classList.toggle('active', mode === 'monthly');
    document.getElementById('btnWeekly').classList.toggle('active', mode === 'weekly');
    renderCalendar();
}

function navigatePeriod(dir) {
    const d = state.currentDate;
    if (state.viewMode === 'monthly') {
        state.currentDate = new Date(d.getFullYear(), d.getMonth() + dir, 1);
        // Tải completions cho tháng mới
        if (API_URL) {
            loadCompletionsForMonth(state.currentDate.getFullYear(), state.currentDate.getMonth() + 1)
                .then(() => renderCalendar());
            return;
        }
    } else {
        state.currentDate = new Date(d);
        state.currentDate.setDate(d.getDate() + dir * 7);
    }
    renderCalendar();
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
}

// ============================================================
// UI HELPERS
// ============================================================
function showLoading(show) {
    document.getElementById('loadingOverlay').classList.toggle('show', show);
}

let toastTimer = null;
function showToast(msg, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.className = 'toast', 3000);
}

// ============================================================
// DATE UTILS
// ============================================================
function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateFromParts(year, month, day) {
    // month is 0-indexed, handles overflow
    const d = new Date(year, month, day);
    return formatDate(d);
}

function formatDateVi(date) {
    const days = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
    return `${days[date.getDay()]}, ${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}
