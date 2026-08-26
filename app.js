/**
 * Egypt Smart Cards - Access Database Web Management Application
 * Complete Frontend Controller & Client Architecture
 */

// --- Global Skeleton Loader Helpers ---
window.showTableLoading = function(tbodyId, columnsCount, rowsCount = 5) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    
    let html = '';
    for (let i = 0; i < rowsCount; i++) {
        html += '<tr class="skeleton-row">';
        for (let j = 0; j < columnsCount; j++) {
            html += `<td style="background-color: inherit;"><div class="skeleton-block"></div></td>`;
        }
        html += '</tr>';
    }
    tbody.innerHTML = html;
};

// Safe Local Storage Wrapper
function safeStorageGet(key, defaultVal = null) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage.getItem(key) || defaultVal;
        }
    } catch (e) {}
    return defaultVal;
}

function safeStorageSet(key, val) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(key, val);
        }
    } catch (e) {}
}

// ==========================================
// 1. GLOBAL STATE & CONFIGURATION
// ==========================================
const AppState = {
    currentTab: 'dashboard',
    theme: safeStorageGet('Br_Theme', 'dark'),
    audit: {
        currentPage: 1,
        pageSize: 20,
        total: 0,
        sortBy: 'timestamp',
        sortOrder: 'desc',
        rows: []
    },
    explorer: {
        currentTable: 'merchants',
        currentPage: 1,
        pageSize: 25,
        total: 0,
        sortBy: null,
        sortOrder: 'asc',
        columns: [],
        rows: []
    }
};

// Universal Smart Date Formatter: DD-MM-YYYY (Day-Month-Year)
const MONTH_MAP = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

function formatDateDDMMYYYY(val, includeTime = false, asHtml = false) {
    if (!val || val === '-' || val === 'null' || val === 'undefined') return '-';
    let str = String(val).trim();
    if (!str) return '-';

    let day = '', month = '', year = '', timeStr = '';

    // Match time if present (e.g. "1:05:40 PM" or "10:00:00 AM" or "14:30:00" or "10:18:00 ص")
    const timeMatch = str.match(/(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM|am|pm|ص|م))?)/i);
    if (timeMatch) {
        timeStr = timeMatch[1].replace(/AM/i, 'ص').replace(/PM/i, 'م').trim();
        str = str.replace(timeMatch[0], '').trim();
    }

    // Pattern 1: "DD-Mon-YY" or "DD-Mon-YYYY" (e.g. "31-Oct-25", "01-Apr-2025", "08-Sep-24")
    const dMonYMatch = str.match(/^(\d{1,2})[-/]([a-zA-Z]{3,})[-/](\d{2,4})/);
    if (dMonYMatch) {
        day = dMonYMatch[1].padStart(2, '0');
        const mKey = dMonYMatch[2].toLowerCase().substring(0, 3);
        month = MONTH_MAP[mKey] || '01';
        let y = dMonYMatch[3];
        if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
        year = y;
    } 
    // Pattern 2: "Mon-YY-DD" (e.g. "Oct-25-31", "Aug-26-10")
    else if (/^[a-zA-Z]{3,}[-/]\d{2,4}[-/]\d{1,2}/.test(str)) {
        const parts = str.split(/[-/]/);
        const mKey = parts[0].toLowerCase().substring(0, 3);
        month = MONTH_MAP[mKey] || '01';
        let y = parts[1];
        if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
        year = y;
        day = parts[2].padStart(2, '0');
    } 
    // Pattern 3: "YYYY-MM-DD" (ISO Date e.g. "2026-08-17")
    else if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) {
        const parts = str.split(/[-/]/);
        year = parts[0];
        month = parts[1].padStart(2, '0');
        day = parts[2].substring(0, 2).padStart(2, '0');
    } 
    // Pattern 4: "DD-MM-YYYY" or "DD/MM/YYYY" (Already formatted)
    else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(str)) {
        const parts = str.split(/[-/]/);
        day = parts[0].padStart(2, '0');
        month = parts[1].padStart(2, '0');
        let y = parts[2];
        if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
        year = y;
    } 
    // Fallback: Date.parse
    else {
        const rawTs = str.includes('Z') || str.includes('T') ? str : str.replace(' ', 'T') + 'Z';
        const dObj = new Date(rawTs);
        if (!isNaN(dObj.getTime())) {
            day = String(dObj.getUTCDate()).padStart(2, '0');
            month = String(dObj.getUTCMonth() + 1).padStart(2, '0');
            year = String(dObj.getUTCFullYear());
        }
    }

    if (day && month && year) {
        const formattedDate = `${day}-${month}-${year}`;
        if (includeTime && timeStr) {
            if (asHtml) {
                return `<span class="dt-badge"><bdi class="dt-date">${formattedDate}</bdi><span class="dt-sep">•</span><bdi class="dt-time"><i data-lucide="clock" style="width:10px;height:10px;vertical-align:middle;margin-left:2px;color:var(--color-primary);"></i>${timeStr}</bdi></span>`;
            }
            return `\u200F${formattedDate} \u200E${timeStr}`;
        }
        if (asHtml) {
            return `<bdi class="dt-date">${formattedDate}</bdi>`;
        }
        return formattedDate;
    }

    return String(val);
}
window.formatDateDDMMYYYY = formatDateDDMMYYYY;

function formatDateTimeCell(val) {
    if (!val || val === '-' || val === 'null' || val === 'undefined') return '<span style="color:var(--text-muted);">-</span>';
    let str = String(val).trim();
    if (!str) return '<span style="color:var(--text-muted);">-</span>';

    return formatDateDDMMYYYY(val, true, true);
}
window.formatDateTimeCell = formatDateTimeCell;

// ==========================================
// UNIVERSAL PRECISION DATE ENGINE (CLIENT-SIDE)
// ==========================================
const UniversalDateEngine = {
    getPresetRange(preset) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const formatYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

        if (preset === 'today') {
            const todayStr = formatYMD(now);
            return { from: todayStr, to: todayStr };
        } else if (preset === 'yesterday') {
            const yest = new Date(now.getTime() - 86400000);
            const yestStr = formatYMD(yest);
            return { from: yestStr, to: yestStr };
        } else if (preset === 'week') {
            const weekAgo = new Date(now.getTime() - 7 * 86400000);
            return { from: formatYMD(weekAgo), to: formatYMD(now) };
        } else if (preset === 'month') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            return { from: formatYMD(startOfMonth), to: formatYMD(now) };
        }
        return { from: '', to: '' };
    },

    setQuickDate(scope, preset, onChangeCallback) {
        const fromEl = document.getElementById(`${scope}-date-from`);
        const toEl = document.getElementById(`${scope}-date-to`);
        const allBtns = document.querySelectorAll(`.btn-${scope}-quick-date`);

        allBtns.forEach(b => {
            b.classList.remove('active');
            b.style.background = '';
            b.style.color = '';
        });

        const activeBtn = document.getElementById(`btn-${scope}-date-${preset}`);
        if (activeBtn) {
            activeBtn.classList.add('active');
            activeBtn.style.background = 'var(--md-sys-color-primary-container)';
            activeBtn.style.color = 'var(--md-sys-color-primary)';
        }

        const range = UniversalDateEngine.getPresetRange(preset);
        if (fromEl) fromEl.value = range.from;
        if (toEl) toEl.value = range.to;

        if (typeof onChangeCallback === 'function') {
            onChangeCallback();
        }
    }
};
window.UniversalDateEngine = UniversalDateEngine;

// Universal Smart Data Parser for Sorting
function parseSortValue(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'number') return val;
    let s = String(val).trim();
    
    // Strip HTML tags if any (from badges/formatters)
    if (s.includes('<') && s.includes('>')) {
        s = s.replace(/<[^>]*>/g, '').trim();
    }

    // Numbers, Percentages & Currencies (e.g. "120 جم", "12 بلاغ", "45.5%", "1,440", "٣٢٦٢٣")
    const numClean = s.replace(/[جم%,\s]/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    if (/^-?\d+(\.\d+)?$/.test(numClean)) {
        return parseFloat(numClean);
    }

    // Convert date to timestamp for reliable sorting
    const formattedD = formatDateDDMMYYYY(s);
    if (/^\d{2}-\d{2}-\d{4}$/.test(formattedD)) {
        const [d, m, y] = formattedD.split('-');
        return new Date(`${y}-${m}-${d}`).getTime();
    }

    const d = Date.parse(s);
    if (!isNaN(d)) return d;
    const dObj = new Date(s);
    if (!isNaN(dObj.getTime())) return dObj.getTime();

    return s.toLowerCase();
}

// Universal Sorter
function sortRows(rows, key, order = 'asc') {
    return [...rows].sort((a, b) => {
        const valA = parseSortValue(a[key]);
        const valB = parseSortValue(b[key]);

        if (typeof valA === 'number' && typeof valB === 'number') {
            return order === 'asc' ? valA - valB : valB - valA;
        }

        const strA = String(valA);
        const strB = String(valB);
        const cmp = strA.localeCompare(strB, 'ar-EG', { numeric: true, sensitivity: 'base' });
        return order === 'asc' ? cmp : -cmp;
    });
}

// Helper: Refresh Lucide Icons
function refreshIcons() {
    if (typeof window !== 'undefined' && window.lucide) {
        window.lucide.createIcons();
    }
}

// ==========================================
// 2. THEME & CLOCK INITIALIZATION
// ==========================================
function initTheme() {
    const toggleBtn = document.getElementById('theme-toggle-btn');
    const toggleText = document.getElementById('theme-toggle-text');
    const toggleIcon = document.getElementById('theme-toggle-icon');

    const applyTheme = (t) => {
        if (t === 'light') {
            document.body.classList.add('light-theme');
            if (toggleText) toggleText.textContent = 'الوضع المظلم';
            if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'moon');
        } else {
            document.body.classList.remove('light-theme');
            if (toggleText) toggleText.textContent = 'الوضع المضيء';
            if (toggleIcon) toggleIcon.setAttribute('data-lucide', 'sun');
        }
        safeStorageSet('Br_Theme', t);
        refreshIcons();
    };

    applyTheme(AppState.theme);

    toggleBtn?.addEventListener('click', () => {
        AppState.theme = AppState.theme === 'light' ? 'dark' : 'light';
        applyTheme(AppState.theme);
    });
}

function formatCairoDateTime(dateInput, asHtml = true) {
    if (!dateInput) return '-';
    try {
        let d;
        if (typeof dateInput === 'string' && !dateInput.endsWith('Z') && !dateInput.includes('+')) {
            d = new Date(dateInput.replace(' ', 'T') + 'Z');
            if (isNaN(d.getTime())) d = new Date(dateInput);
        } else {
            d = new Date(dateInput);
        }
        if (isNaN(d.getTime())) return formatDateDDMMYYYY(dateInput, true, asHtml);

        const options = { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
        const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(d);
        const map = {};
        parts.forEach(p => map[p.type] = p.value);

        const day = map.day;
        const month = map.month;
        const year = map.year;
        const hour = map.hour;
        const min = map.minute;
        const sec = map.second;
        const ampm = map.dayPeriod ? (map.dayPeriod.toLowerCase() === 'pm' ? 'م' : 'ص') : '';

        const formattedDate = `${day}-${month}-${year}`;
        const timeStr = `${hour}:${min}:${sec} ${ampm}`.trim();

        if (asHtml) {
            return `<span class="dt-badge"><bdi class="dt-date">${formattedDate}</bdi><span class="dt-sep">•</span><bdi class="dt-time"><i data-lucide="clock" style="width:10px;height:10px;vertical-align:middle;margin-left:2px;color:var(--color-primary);"></i>${timeStr}</bdi></span>`;
        }
        return `\u200F${formattedDate} \u200E${timeStr}`;
    } catch (e) {
        return formatDateDDMMYYYY(dateInput, true, asHtml);
    }
}
window.formatCairoDateTime = formatCairoDateTime;

function initClock() {
    const timeDisplay = document.getElementById('cairo-time');
    const updateTime = () => {
        const now = new Date();
        if (timeDisplay) {
            timeDisplay.textContent = now.toLocaleTimeString('ar-EG', {
                timeZone: 'Africa/Cairo',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
            });
        }
    };
    updateTime();
    setInterval(updateTime, 1000);
}

// ==========================================
// 3. NAVIGATION & GLOBAL SEARCH
// ==========================================
// 4. NAVIGATION & TAB SWITCHING
// ==========================================
function switchTab(tabName) {
    if (!tabName) return;
    const navItem = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
    if (navItem) {
        navItem.click();
    } else {
        const navItems = document.querySelectorAll('.nav-item');
        const tabContents = document.querySelectorAll('.tab-content');
        navItems.forEach(n => {
            if (n.getAttribute('data-tab') === tabName) n.classList.add('active');
            else n.classList.remove('active');
        });
        tabContents.forEach(c => c.classList.remove('active'));
        const target = document.getElementById(`tab-${tabName}`);
        if (target) target.classList.add('active');
        AppState.currentTab = tabName;
        
        if (tabName === 'dashboard') loadDashboard();
        else if (tabName === 'customers') initCustomerManagement();
        else if (tabName === 'branch-warehouse') loadWarehouseInventory();
        else if (tabName === 'sim-warehouse') loadSimsInventory();
        else if (tabName === 'hq-maintenance') loadHqMaintenanceInventory();
        else if (tabName === 'installments') loadInstallmentsDashboard();
        else if (tabName === 'spare-parts-inventory') loadSparePartsInventory();
        else if (tabName === 'time-machine') initTimeMachineTab();
        else if (tabName === 'sync-monitor') loadSyncMonitor();
        else if (tabName === 'data-explorer') loadDataExplorer();
        else if (tabName === 'settings') loadSettings();
    }
}
window.switchTab = switchTab;

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabName = item.getAttribute('data-tab');
            if (!tabName) return;

            navItems.forEach(n => n.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            item.classList.add('active');
            const target = document.getElementById(`tab-${tabName}`);
            if (target) target.classList.add('active');

            AppState.currentTab = tabName;

            // Route handler
            if (tabName === 'dashboard') loadDashboard();
            else if (tabName === 'customers') initCustomerManagement();
            else if (tabName === 'branch-warehouse') loadWarehouseInventory();
            else if (tabName === 'sim-warehouse') loadSimsInventory();
            else if (tabName === 'hq-maintenance') loadHqMaintenanceInventory();
            else if (tabName === 'installments') loadInstallmentsDashboard();
            else if (tabName === 'spare-parts-inventory') loadSparePartsInventory();
            else if (tabName === 'time-machine') initTimeMachineTab();
            else if (tabName === 'sync-monitor') loadSyncMonitor();
            else if (tabName === 'data-explorer') loadDataExplorer();
            else if (tabName === 'settings') loadSettings();
        });
    });

    // Global Search Auto-Routing to Universal Asset Timeline
    const globalSearch = document.getElementById('global-search');
    globalSearch?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = e.target.value.trim();
            if (val.length > 0) {
                openAssetTimeline(val);
            }
        }
    });

    // Quick Navigation Buttons on Dashboard & Warehouse Switchers
    document.getElementById('btn-goto-customers')?.addEventListener('click', () => {
        document.getElementById('tab-btn-customers')?.click();
    });
    document.getElementById('btn-goto-warehouse')?.addEventListener('click', () => {
        document.getElementById('tab-btn-branch-warehouse')?.click();
    });
    document.getElementById('btn-goto-sims')?.addEventListener('click', () => {
        document.getElementById('tab-btn-sim-warehouse')?.click();
    });
    document.getElementById('btn-goto-spare-parts')?.addEventListener('click', () => {
        document.getElementById('tab-btn-spare-parts-inventory')?.click();
    });
    document.getElementById('btn-goto-time-machine')?.addEventListener('click', () => {
        document.getElementById('tab-btn-time-machine')?.click();
    });
    document.getElementById('btn-goto-maintenance')?.addEventListener('click', () => {
        document.getElementById('tab-btn-hq-maintenance')?.click();
    });
    document.getElementById('btn-goto-installments')?.addEventListener('click', () => {
        document.getElementById('tab-btn-installments')?.click();
    });
    document.getElementById('btn-goto-reports')?.addEventListener('click', () => {
        document.getElementById('tab-btn-reports')?.click();
    });

    // Warehouse & Operations Sub-tabs Switcher Bindings (All 6 Tabs)
    ['', '-2', '-3', '-4', '-5', '-6'].forEach(suffix => {
        document.getElementById(`switch-to-customers${suffix}`)?.addEventListener('click', () => {
            document.getElementById('tab-btn-customers')?.click();
        });
        document.getElementById(`switch-to-pos${suffix}`)?.addEventListener('click', () => {
            document.getElementById('tab-btn-branch-warehouse')?.click();
        });
        document.getElementById(`switch-to-sims${suffix}`)?.addEventListener('click', () => {
            document.getElementById('tab-btn-sim-warehouse')?.click();
        });
        document.getElementById(`switch-to-maint${suffix}`)?.addEventListener('click', () => {
            document.getElementById('tab-btn-hq-maintenance')?.click();
        });
        document.getElementById(`switch-to-inst${suffix}`)?.addEventListener('click', () => {
            document.getElementById('tab-btn-installments')?.click();
        });
        document.getElementById(`switch-to-sp${suffix}`)?.addEventListener('click', () => {
            document.getElementById('tab-btn-spare-parts-inventory')?.click();
        });
    });
}

// ==========================================
// 4. ACCESS DB SYNCHRONIZATION ENGINE
// ==========================================
async function triggerAccessSync(btn, icon) {
    const modal = document.getElementById('modal-sync-progress');
    const stageEl = document.getElementById('sync-progress-stage');
    const percentEl = document.getElementById('sync-progress-percent');
    const fillEl = document.getElementById('sync-progress-bar-fill');
    const detailEl = document.getElementById('sync-progress-detail-text');
    const doneBtn = document.getElementById('btn-sync-progress-done');
    const closeBtn = document.getElementById('btn-close-sync-progress');

    // Reset progress UI
    if (stageEl) stageEl.textContent = 'جاري الاتصال بملف الآكسيس...';
    if (percentEl) percentEl.textContent = '0%';
    if (fillEl) fillEl.style.width = '0%';
    if (detailEl) detailEl.textContent = 'تجهيز المحرك وفتح BE\\Bread_Final_be.accdb...';
    if (doneBtn) doneBtn.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none';

    // Reset step indicators
    for (let s = 1; s <= 5; s++) {
        const stepEl = document.getElementById(`sync-step-${s}`);
        if (stepEl) {
            const badge = stepEl.querySelector('.step-status-badge');
            if (badge) badge.innerHTML = `<i data-lucide="clock" style="width:12px; height:12px;"></i> قيد الانتظار`;
            stepEl.style.borderColor = 'rgba(255,255,255,0.04)';
            stepEl.style.background = 'rgba(255,255,255,0.02)';
        }
    }

    if (modal) modal.classList.add('active');
    if (btn) btn.disabled = true;
    if (icon) icon.classList.add('spin-animation');
    refreshIcons();

    // Close button handlers
    const closeModal = () => modal?.classList.remove('active');
    doneBtn?.addEventListener('click', closeModal, { once: true });
    closeBtn?.addEventListener('click', closeModal, { once: true });

    // Start real-time progress polling
    let pollingActive = true;
    const pollInterval = setInterval(async () => {
        if (!pollingActive) return;
        try {
            const statusRes = await fetch('/api/sync/status');
            const statusData = await statusRes.json();
            if (statusData && statusData.progress) {
                const prog = statusData.progress;
                if (percentEl) percentEl.textContent = `${prog.percent}%`;
                if (fillEl) fillEl.style.width = `${prog.percent}%`;
                if (stageEl && prog.stage) stageEl.textContent = prog.stage;
                if (detailEl && prog.detail) detailEl.textContent = prog.detail;

                // Update active steps
                const currentStepIdx = prog.stepIndex || 1;
                for (let s = 1; s <= 5; s++) {
                    const stepEl = document.getElementById(`sync-step-${s}`);
                    if (stepEl) {
                        const badge = stepEl.querySelector('.step-status-badge');
                        if (s < currentStepIdx) {
                            if (badge) badge.innerHTML = `<span style="color:#10b981;"><i data-lucide="check-circle" style="width:12px; height:12px;"></i> اكتمل</span>`;
                            stepEl.style.borderColor = 'rgba(16,185,129,0.3)';
                            stepEl.style.background = 'rgba(16,185,129,0.05)';
                        } else if (s === currentStepIdx) {
                            if (badge) badge.innerHTML = `<span style="color:#3b82f6;"><i data-lucide="loader-2" class="spin-animation" style="width:12px; height:12px;"></i> جاري الآن</span>`;
                            stepEl.style.borderColor = 'rgba(59,130,246,0.5)';
                            stepEl.style.background = 'rgba(59,130,246,0.1)';
                        } else {
                            if (badge) badge.innerHTML = `<span style="color:var(--text-muted);"><i data-lucide="clock" style="width:12px; height:12px;"></i> قيد الانتظار</span>`;
                            stepEl.style.borderColor = 'rgba(255,255,255,0.04)';
                            stepEl.style.background = 'rgba(255,255,255,0.02)';
                        }
                    }
                }
                refreshIcons();
            }
        } catch (e) {}
    }, 350);

    try {
        const response = await fetch('/api/sync/run', { method: 'POST' });
        const data = await response.json();
        pollingActive = false;
        clearInterval(pollInterval);

        if (response.ok && data.success) {
            if (percentEl) percentEl.textContent = '100%';
            if (fillEl) fillEl.style.width = '100%';
            if (stageEl) stageEl.textContent = '✅ اكتملت المزامنة بنجاح!';
            if (detailEl) detailEl.textContent = data.message;

            for (let s = 1; s <= 5; s++) {
                const stepEl = document.getElementById(`sync-step-${s}`);
                if (stepEl) {
                    const badge = stepEl.querySelector('.step-status-badge');
                    if (badge) badge.innerHTML = `<span style="color:#10b981;"><i data-lucide="check-circle" style="width:12px; height:12px;"></i> اكتمل</span>`;
                    stepEl.style.borderColor = 'rgba(16,185,129,0.3)';
                    stepEl.style.background = 'rgba(16,185,129,0.05)';
                }
            }

            if (doneBtn) doneBtn.style.display = 'inline-flex';
            if (closeBtn) closeBtn.style.display = 'inline-flex';
            refreshIcons();

            // Auto reload current tab data in background
            if (AppState.currentTab === 'dashboard') loadDashboard();
            else if (AppState.currentTab === 'branch-warehouse') loadWarehouseInventory();
            else if (AppState.currentTab === 'sim-warehouse') loadSimsInventory();
            else if (AppState.currentTab === 'hq-maintenance') loadHqMaintenanceInventory();
            else if (AppState.currentTab === 'installments') loadInstallmentsDashboard();
            else if (AppState.currentTab === 'spare-parts-inventory') loadSparePartsInventory();
            else if (AppState.currentTab === 'sync-monitor') loadSyncMonitor();
            else if (AppState.currentTab === 'data-explorer') fetchDataExplorerTable();

            // Auto close modal after 3 seconds if not closed manually
            setTimeout(() => {
                modal?.classList.remove('active');
            }, 3500);
        } else {
            throw new Error(data.error || "فشلت المزامنة من قاعدة بيانات الآكسيس");
        }
    } catch (err) {
        pollingActive = false;
        clearInterval(pollInterval);
        console.error("Sync error:", err);
        if (stageEl) stageEl.textContent = '❌ خطأ أثناء المزامنة';
        if (detailEl) detailEl.textContent = err.message;
        if (closeBtn) closeBtn.style.display = 'inline-flex';
        refreshIcons();
    } finally {
        if (btn) btn.disabled = false;
        if (icon) icon.classList.remove('spin-animation');
    }
}

// ==========================================
// 5. DASHBOARD MODULE
// ==========================================
async function loadDashboard() {
    try {
        // Fetch Sync Status
        const syncRes = await fetch('/api/sync/status');
        if (syncRes.ok) {
            const s = await syncRes.json();
            const timeEl = document.getElementById('dash-last-sync-time');
            if (timeEl) timeEl.innerHTML = s.lastSyncTime ? formatCairoDateTime(s.lastSyncTime, true) : 'لم تتم بعد';
            
            const tblEl = document.getElementById('dash-synced-tables');
            if (tblEl && s.tablesSynced) tblEl.textContent = s.tablesSynced;

            const recEl = document.getElementById('dash-synced-records');
            if (recEl && s.totalRecords) recEl.textContent = Number(s.totalRecords).toLocaleString('ar-EG');

            const chgEl = document.getElementById('dash-changes-count');
            if (chgEl && s.changesDetected !== undefined) chgEl.textContent = s.changesDetected;
        }

        // Fetch Dashboard KPIs and Deep Analytics
        const statsRes = await fetch('/api/dashboard/stats');
        if (statsRes.ok) {
            const data = await statsRes.json();
            const k = data.kpis || {};

            // 1. KPI Cards
            document.getElementById('stat-total-merchants').textContent = Number(k.totalMerchants || 0).toLocaleString('ar-EG');
            document.getElementById('stat-active-pos').textContent = Number(k.inMerchantDevices || 0).toLocaleString('ar-EG');
            document.getElementById('stat-active-tickets').textContent = Number(k.openTickets || 0).toLocaleString('ar-EG');
            document.getElementById('stat-active-sims').textContent = Number(k.assignedSims || 0).toLocaleString('ar-EG');
            document.getElementById('stat-total-payments').textContent = Number(k.totalPaymentsAmount || 0).toLocaleString('ar-EG') + ' جم';

            // 2. Top Common Faults Breakdown
            const faultsContainer = document.getElementById('dash-top-faults-list');
            if (faultsContainer) {
                faultsContainer.innerHTML = '';
                const topFaults = data.topFaults || [];
                const maxFaultCount = topFaults.length > 0 ? topFaults[0].count : 1;
                topFaults.forEach(f => {
                    const percent = Math.round((f.count / maxFaultCount) * 100);
                    faultsContainer.innerHTML += `
                        <div class="breakdown-item" style="margin-bottom: 12px; direction: rtl;">
                            <div class="breakdown-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 13px; direction: rtl;">
                                <span class="breakdown-label" style="font-weight: 600; color: var(--text-primary); text-align: right;">${f.issue_details || 'عطل عام'}</span>
                                <span class="breakdown-value" style="display: inline-flex; align-items: center; gap: 4px; direction: rtl;">
                                    <strong style="font-family: var(--font-en); font-size: 13px; font-weight: 700; color: var(--color-warning);">${Number(f.count).toLocaleString('en-US')}</strong>
                                    <span style="font-size: 11px; color: var(--text-muted);">بلاغ</span>
                                </span>
                            </div>
                            <div class="breakdown-bar-track" style="height: 6px; background: var(--md-sys-color-surface-container-high); border-radius: 4px; overflow: hidden;">
                                <div class="breakdown-bar-fill warning" style="width: ${percent}%; height: 100%; border-radius: 4px;"></div>
                            </div>
                        </div>
                    `;
                });
                if (topFaults.length === 0) faultsContainer.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:10px; text-align:center;">لا توجد بلاغات مسجلة</div>';
            }

            // 3. Geographic Distribution
            const govContainer = document.getElementById('dash-gov-distribution-list');
            if (govContainer) {
                govContainer.innerHTML = '';
                const govList = data.govDistribution || [];
                const maxGovCount = govList.length > 0 ? govList[0].count : 1;
                govList.forEach(g => {
                    const percent = Math.round((g.count / maxGovCount) * 100);
                    govContainer.innerHTML += `
                        <div class="breakdown-item" style="margin-bottom: 12px; direction: rtl;">
                            <div class="breakdown-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 13px; direction: rtl;">
                                <span class="breakdown-label" style="font-weight: 600; color: var(--text-primary); text-align: right;">${g.gov || 'أخرى'}</span>
                                <span class="breakdown-value" style="display: inline-flex; align-items: center; gap: 4px; direction: rtl;">
                                    <strong style="font-family: var(--font-en); font-size: 13px; font-weight: 700; color: var(--color-primary);">${Number(g.count).toLocaleString('en-US')}</strong>
                                    <span style="font-size: 11px; color: var(--text-muted);">مخبز</span>
                                </span>
                            </div>
                            <div class="breakdown-bar-track" style="height: 6px; background: var(--md-sys-color-surface-container-high); border-radius: 4px; overflow: hidden;">
                                <div class="breakdown-bar-fill primary" style="width: ${percent}%; height: 100%; border-radius: 4px;"></div>
                            </div>
                        </div>
                    `;
                });
                if (govList.length === 0) govContainer.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:10px; text-align:center;">لا توجد بيانات جغرافية مسجلة</div>';
            }

            // 4. POS Models Distribution
            const modelsContainer = document.getElementById('dash-models-list');
            if (modelsContainer) {
                modelsContainer.innerHTML = '';
                const modelsList = data.modelDistribution || [];
                const maxModelCount = modelsList.length > 0 ? modelsList[0].count : 1;
                modelsList.forEach(m => {
                    const percent = Math.round((m.count / maxModelCount) * 100);
                    modelsContainer.innerHTML += `
                        <div class="breakdown-item" style="margin-bottom: 12px; direction: rtl;">
                            <div class="breakdown-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 13px; direction: rtl;">
                                <span class="breakdown-label" style="font-family: var(--font-en); font-weight: 700; color: var(--text-primary); text-align: right; font-size: 13px;">${m.model || 'POS'}</span>
                                <span class="breakdown-value" style="display: inline-flex; align-items: center; gap: 4px; direction: rtl;">
                                    <strong style="font-family: var(--font-en); font-size: 13px; font-weight: 700; color: var(--color-success);">${Number(m.count).toLocaleString('en-US')}</strong>
                                    <span style="font-size: 11px; color: var(--text-muted);">جهاز</span>
                                </span>
                            </div>
                            <div class="breakdown-bar-track" style="height: 6px; background: var(--md-sys-color-surface-container-high); border-radius: 4px; overflow: hidden;">
                                <div class="breakdown-bar-fill success" style="width: ${percent}%; height: 100%; border-radius: 4px;"></div>
                            </div>
                        </div>
                    `;
                });
                if (modelsList.length === 0) modelsContainer.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:10px; text-align:center;">لا توجد أجهزة مسجلة</div>';
            }

            // 5. SIM Carriers Distribution
            const carriersContainer = document.getElementById('dash-carriers-list');
            if (carriersContainer) {
                carriersContainer.innerHTML = '';
                const carriersList = data.carriersBreakdown || [];
                const maxCarrierCount = carriersList.length > 0 ? Math.max(...carriersList.map(c => c.count)) : 1;
                carriersList.forEach(c => {
                    const percent = Math.round((c.count / maxCarrierCount) * 100);
                    const cLower = String(c.carrier || '').toLowerCase();
                    const carrierBadgeClass = cLower.includes('voda') ? 'vodafone' : cLower.includes('orange') ? 'orange' : cLower.includes('etisalat') ? 'etisalat' : cLower.includes('we') ? 'we' : 'other';
                    
                    carriersContainer.innerHTML += `
                        <div class="breakdown-item" style="margin-bottom: 12px; direction: rtl;">
                            <div class="breakdown-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 13px; direction: rtl;">
                                <span class="breakdown-label" style="font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 8px; text-align: right;">
                                    <span class="badge-carrier ${carrierBadgeClass}">${c.carrier}</span>
                                    <span>شبكة ${c.carrier}</span>
                                </span>
                                <span class="breakdown-value" style="display: inline-flex; align-items: center; gap: 4px; direction: rtl;">
                                    <strong style="font-family: var(--font-en); font-size: 13px; font-weight: 700; color: var(--color-primary);">${Number(c.count).toLocaleString('en-US')}</strong>
                                    <span style="font-size: 11px; color: var(--text-muted);">شريحة</span>
                                </span>
                            </div>
                            <div class="breakdown-bar-track" style="height: 6px; background: var(--md-sys-color-surface-container-high); border-radius: 4px; overflow: hidden;">
                                <div class="breakdown-bar-fill primary" style="width: ${percent}%; height: 100%; border-radius: 4px;"></div>
                            </div>
                        </div>
                    `;
                });
                if (carriersList.length === 0) carriersContainer.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:10px; text-align:center;">لا توجد شرائح مسجلة</div>';
            }

            // 6. Recent Audit Changes Table
            const recentChangesBody = document.getElementById('dash-recent-changes-body');
            if (recentChangesBody) {
                recentChangesBody.innerHTML = '';
                const changes = data.recentChanges || [];
                changes.forEach(chg => {
                    const typeBadgeClass = chg.change_type === 'INSERT' ? 'insert' : chg.change_type === 'UPDATE' ? 'update' : 'delete';
                    const typeLabel = chg.change_type === 'INSERT' ? 'إضافة' : chg.change_type === 'UPDATE' ? 'تعديل' : 'حذف';
                    const time = new Date(chg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
                    recentChangesBody.innerHTML += `
                        <tr>
                            <td style="font-family:var(--font-en);">${time}</td>
                            <td><strong style="color:var(--color-primary); font-family:var(--font-en);">${chg.table_name}</strong></td>
                            <td><span class="change-type-badge ${typeBadgeClass}">${typeLabel}</span></td>
                            <td><code style="font-family:var(--font-en);">${chg.record_id || '-'}</code></td>
                            <td style="max-width:250px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${chg.summary || '-'}</td>
                        </tr>
                    `;
                });
                if (changes.length === 0) {
                    recentChangesBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:15px;">لا توجد تغييرات مرصودة حديثاً</td></tr>`;
                }
            }

            // 7. Spare Parts Stock Alerts
            const alertsContainer = document.getElementById('sp-stock-alerts');
            if (alertsContainer) {
                alertsContainer.innerHTML = '';
                const alerts = data.sparePartsAlerts || [];
                alerts.forEach(sp => {
                    alertsContainer.innerHTML += `
                        <div class="alert-item ${sp.quantity_in_stock === 0 ? '' : 'warn'}" style="margin-bottom:8px; padding:8px 12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:6px; font-size:12px; display:flex; justify-content:space-between; align-items:center;">
                            <span><strong>${sp.part_name}</strong> - الرصيد: <strong style="color:#ef4444; font-family:var(--font-en);">${sp.quantity_in_stock}</strong> قطع</span>
                            <span class="badge faulty" style="font-size:10px;">حرِج</span>
                        </div>
                    `;
                });
                if (alerts.length === 0) {
                    alertsContainer.innerHTML = `<div style="color:var(--text-muted); font-size:12px; padding:15px; text-align:center;">رصيد كافة قطع الغيار في المستوى الآمن.</div>`;
                }
            }
        }

        // 8. Load Branch Technicians Performance & SLA Cards
        if (typeof loadTechniciansPerformance === 'function') {
            loadTechniciansPerformance();
        }

        refreshIcons();
    } catch (e) {
        console.error("Error loading dashboard:", e);
    }
}

// ==========================================
// 5.5 BRANCH WAREHOUSE INVENTORY DASHBOARD MODULE
// ==========================================
let warehouseDataCache = null;

const WarehouseTableState = {
    page: 1,
    pageSize: 15,
    sortCol: 'serial',
    sortDir: 'asc'
};

function sortWarehouseTable(column) {
    if (WarehouseTableState.sortCol === column) {
        WarehouseTableState.sortDir = WarehouseTableState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        WarehouseTableState.sortCol = column;
        WarehouseTableState.sortDir = 'asc';
    }
    // Update sort indicators on headers
    ['serial', 'manufacturer', 'model', 'condition'].forEach(col => {
        const el = document.getElementById(`wh-sort-${col}`);
        if (el) {
            if (WarehouseTableState.sortCol === col) {
                el.textContent = WarehouseTableState.sortDir === 'asc' ? '▲' : '▼';
                el.style.color = 'var(--md-sys-color-primary)';
            } else {
                el.textContent = '⇕';
                el.style.color = 'var(--md-sys-color-on-surface-variant)';
            }
        }
    });
    renderWarehouseDevicesTable();
}
window.sortWarehouseTable = sortWarehouseTable;

function setWarehousePage(p) {
    WarehouseTableState.page = p;
    renderWarehouseDevicesTable();
    document.getElementById('wh-devices-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
window.setWarehousePage = setWarehousePage;

async function loadWarehouseInventory() {
    const kpiTotal = document.getElementById('wh-kpi-total');
    const kpiGrandFleet = document.getElementById('wh-kpi-grand-fleet');
    const kpiInMerchant = document.getElementById('wh-kpi-in-merchant');
    const kpiNewSale = document.getElementById('wh-kpi-newsale');
    const kpiReady = document.getElementById('wh-kpi-ready');
    const kpiFaulty = document.getElementById('wh-kpi-faulty');
    const kpiBranchUse = document.getElementById('wh-kpi-branchuse');
    const modelsCountLabel = document.getElementById('wh-models-count-label');
    const modelsGrid = document.getElementById('wh-models-cards-grid');
    const mfgGrid = document.getElementById('wh-manufacturers-cards-grid');
    const modelFilter = document.getElementById('wh-table-model-filter');
    const statusFilter = document.getElementById('wh-table-status-filter');
    const searchInput = document.getElementById('wh-table-search-input');
    const pageSizeSelect = document.getElementById('wh-page-size-select');
    const refreshBtn = document.getElementById('btn-refresh-warehouse-stock');
    const exportBtn = document.getElementById('btn-export-warehouse-excel');

    try {
        if (window.showTableLoading) window.showTableLoading('wh-devices-table-body', 6, 8);
        
        const res = await fetch('/api/inventory/warehouse-dashboard');
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to load warehouse data');

        warehouseDataCache = data;

        // 1. Update KPI Summary
        const s = data.summary;
        if (kpiTotal) kpiTotal.textContent = s.total_warehouse_pos.toLocaleString();
        if (kpiGrandFleet) kpiGrandFleet.textContent = s.grand_total_fleet.toLocaleString();
        if (kpiInMerchant) kpiInMerchant.textContent = s.total_merchant_pos.toLocaleString();
        if (kpiNewSale) kpiNewSale.textContent = s.new_for_sale.toLocaleString();
        if (kpiReady) kpiReady.textContent = s.ready_in_stock.toLocaleString();
        if (kpiFaulty) kpiFaulty.textContent = s.faulty_in_branch.toLocaleString();
        if (kpiBranchUse) kpiBranchUse.textContent = s.branch_internal.toLocaleString();

        // 2. Render Models Breakdown Cards
        const models = data.models || [];
        if (modelsCountLabel) modelsCountLabel.textContent = `تم رصد (${models.length}) موديلات مختلفة في المخزن والمخابز`;

        if (modelsGrid) {
            modelsGrid.innerHTML = '';
            models.forEach(m => {
                modelsGrid.innerHTML += `
                    <div class="wh-model-card" data-model="${m.model}" onclick="drilldownWarehouse({ model: '${m.model}', cardEl: this })" title="انقر لتصفية جدول المخزن وعرض ماكينات ${m.model}" style="cursor:pointer;">
                        <div>
                            <div class="wh-model-header">
                                <div>
                                    <h3 class="wh-model-title">
                                        <i data-lucide="cpu" style="width:18px; height:18px; color:var(--md-sys-color-primary);"></i>
                                        <span>${m.model}</span>
                                    </h3>
                                    <span class="wh-mfg-badge">${m.manufacturer}</span>
                                </div>
                                <div class="wh-count-display">
                                    <div class="wh-count-number">${m.total_warehouse}</div>
                                    <span class="wh-count-label">بالمخزن بالفرع</span>
                                </div>
                            </div>

                            <div class="wh-progress-container">
                                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px; color:var(--md-sys-color-on-surface-variant);">
                                    <span>نسبة التواجد بالمخزن</span>
                                    <strong style="font-family:var(--font-en); color:var(--md-sys-color-primary);">${m.warehouse_share_pct}%</strong>
                                </div>
                                <div class="wh-progress-track">
                                    <div class="wh-progress-bar" style="width: ${Math.max(4, m.warehouse_share_pct)}%;"></div>
                                </div>
                            </div>

                            <div class="wh-metrics-pills">
                                <div class="wh-pill-item" style="border-right: 3px solid #06b6d4; ${m.new_for_sale > 0 ? 'background:rgba(6,182,212,0.08);' : ''}">
                                    <span>🛍️ جديدة للبيع:</span>
                                    <strong style="color:#06b6d4;">${m.new_for_sale}</strong>
                                </div>
                                <div class="wh-pill-item" style="border-right: 3px solid #10b981;">
                                    <span>🟢 جاهزة وسليمة:</span>
                                    <strong style="color:#10b981;">${m.ready_in_stock}</strong>
                                </div>
                                <div class="wh-pill-item" style="border-right: 3px solid #ef4444;">
                                    <span>🔴 معطلة بالفرع:</span>
                                    <strong style="color:#ef4444;">${m.faulty}</strong>
                                </div>
                                <div class="wh-pill-item" style="border-right: 3px solid #f59e0b;">
                                    <span>🏢 عهدة الفرع:</span>
                                    <strong style="color:#f59e0b;">${m.branch_internal}</strong>
                                </div>
                                <div class="wh-pill-item" style="border-right: 3px solid #38bdf8;">
                                    <span>🏪 بالمخابز:</span>
                                    <strong style="color:var(--md-sys-color-primary);">${m.in_merchant}</strong>
                                </div>
                                <div class="wh-pill-item" style="border-right: 3px solid #818cf8;">
                                    <span>📊 إجمالي الماكينات:</span>
                                    <strong style="color:var(--md-sys-color-secondary);">${m.total_fleet}</strong>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        // 3. Render Manufacturers Breakdown Cards
        const manufacturers = data.manufacturers || [];
        if (mfgGrid) {
            mfgGrid.innerHTML = '';
            manufacturers.forEach(mfg => {
                mfgGrid.innerHTML += `
                    <div class="wh-mfg-card" onclick="drilldownWarehouse({ search: '${mfg.manufacturer}', cardEl: this })" title="انقر لتصفية ماكينات شركة ${mfg.manufacturer}" style="cursor:pointer;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <div style="width:38px; height:38px; border-radius:10px; background:rgba(129, 140, 248, 0.15); display:flex; align-items:center; justify-content:center; color:var(--md-sys-color-secondary);">
                                    <i data-lucide="building-2" style="width:20px; height:20px;"></i>
                                </div>
                                <div>
                                    <h4 style="margin:0; font-size:15px; font-weight:800;">${mfg.manufacturer}</h4>
                                    <span style="font-size:11px; color:var(--md-sys-color-on-surface-variant);">${mfg.models_count} موديلات (${mfg.models_names})</span>
                                </div>
                            </div>
                            <div style="text-align:left;">
                                <span style="font-size:24px; font-weight:900; font-family:var(--font-en); color:var(--md-sys-color-secondary);">${mfg.total_warehouse}</span>
                                <span style="font-size:10px; color:var(--md-sys-color-on-surface-variant); display:block;">بالمخزن</span>
                            </div>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--md-sys-color-on-surface-variant); padding-top:8px; border-top:1px dashed var(--md-sys-color-outline-variant); flex-wrap:wrap; gap:6px;">
                            <span>🛍️ جديدة: <strong style="color:#06b6d4; font-family:var(--font-en);">${mfg.new_for_sale}</strong></span>
                            <span>🟢 جاهز: <strong style="color:#10b981; font-family:var(--font-en);">${mfg.ready_in_stock}</strong></span>
                            <span>🔴 معطل: <strong style="color:#ef4444; font-family:var(--font-en);">${mfg.faulty}</strong></span>
                            <span>🏢 عهدة: <strong style="color:#f59e0b; font-family:var(--font-en);">${mfg.branch_internal}</strong></span>
                            <span>🏪 بالمخابز: <strong style="color:var(--md-sys-color-tertiary); font-family:var(--font-en);">${mfg.in_merchant}</strong></span>
                            <span>📊 إجمالي الماكينات: <strong style="color:var(--md-sys-color-on-surface); font-family:var(--font-en);">${mfg.total_fleet}</strong></span>
                        </div>
                    </div>
                `;
            });
        }

        // 4. Populate Model Filter Dropdown
        if (modelFilter) {
            modelFilter.innerHTML = '<option value="all">كافة الموديلات</option>';
            models.forEach(m => {
                modelFilter.innerHTML += `<option value="${m.model}">${m.model} (${m.total_warehouse} بالمخزن)</option>`;
            });
        }

        // 5. Render Warehouse Table Devices
        renderWarehouseDevicesTable();

        // 6. Setup Event Listeners
        searchInput?.replaceWith(searchInput.cloneNode(true));
        statusFilter?.replaceWith(statusFilter.cloneNode(true));
        modelFilter?.replaceWith(modelFilter.cloneNode(true));
        pageSizeSelect?.replaceWith(pageSizeSelect.cloneNode(true));

        const newSearchInput = document.getElementById('wh-table-search-input');
        const newStatusFilter = document.getElementById('wh-table-status-filter');
        const newModelFilter = document.getElementById('wh-table-model-filter');
        const newPageSizeSelect = document.getElementById('wh-page-size-select');

        newSearchInput?.addEventListener('input', () => {
            document.querySelectorAll('#tab-branch-warehouse .active-drilldown').forEach(c => c.classList.remove('active-drilldown'));
            WarehouseTableState.page = 1;
            renderWarehouseDevicesTable();
        });
        newStatusFilter?.addEventListener('change', () => {
            document.querySelectorAll('#tab-branch-warehouse .active-drilldown').forEach(c => c.classList.remove('active-drilldown'));
            WarehouseTableState.page = 1;
            renderWarehouseDevicesTable();
        });
        newModelFilter?.addEventListener('change', () => {
            document.querySelectorAll('#tab-branch-warehouse .active-drilldown').forEach(c => c.classList.remove('active-drilldown'));
            WarehouseTableState.page = 1;
            renderWarehouseDevicesTable();
        });
        newPageSizeSelect?.addEventListener('change', () => {
            WarehouseTableState.page = 1;
            renderWarehouseDevicesTable();
        });

        document.querySelectorAll('.btn-filter-model').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetModel = btn.getAttribute('data-model');
                drilldownWarehouse({ model: targetModel, cardEl: btn.closest('.wh-model-card') || btn });
            });
        });

        if (refreshBtn) {
            refreshBtn.onclick = () => {
                const icon = document.getElementById('icon-wh-refresh');
                if (icon) icon.classList.add('spin-animation');
                loadWarehouseInventory().then(() => {
                    if (icon) icon.classList.remove('spin-animation');
                });
            };
        }

        if (exportBtn) {
            exportBtn.onclick = () => {
                exportWarehouseStockToExcel();
            };
        }

        refreshIcons();
    } catch (err) {
        console.error('Error loading warehouse inventory dashboard:', err);
    }
}

function renderWarehouseDevicesTable() {
    if (!warehouseDataCache || !warehouseDataCache.devices) return;
    const tableBody = document.getElementById('wh-devices-table-body');
    const countLabel = document.getElementById('wh-table-count-label');
    const paginationControls = document.getElementById('wh-pagination-controls');
    const searchVal = (document.getElementById('wh-table-search-input')?.value || '').trim().toLowerCase();
    const statusVal = document.getElementById('wh-table-status-filter')?.value || 'all';
    const modelVal = document.getElementById('wh-table-model-filter')?.value || 'all';

    // 1. Filter ALL devices across whole dataset
    let filtered = warehouseDataCache.devices;

    if (statusVal !== 'all') {
        filtered = filtered.filter(d => d.condition_type === statusVal);
    }
    if (modelVal !== 'all') {
        filtered = filtered.filter(d => d.model === modelVal);
    }
    if (searchVal) {
        filtered = filtered.filter(d => 
            (d.serial && d.serial.toLowerCase().includes(searchVal)) ||
            (d.model && d.model.toLowerCase().includes(searchVal)) ||
            (d.manufacturer && d.manufacturer.toLowerCase().includes(searchVal)) ||
            (d.notes && d.notes.toLowerCase().includes(searchVal)) ||
            (d.pos_status && d.pos_status.toLowerCase().includes(searchVal)) ||
            (d.status_note && d.status_note.toLowerCase().includes(searchVal)) ||
            (d.faulty_details && d.faulty_details.toLowerCase().includes(searchVal))
        );
    }

    // 2. Sort ALL filtered devices
    const sortCol = WarehouseTableState.sortCol;
    const sortDir = WarehouseTableState.sortDir;
    filtered.sort((a, b) => {
        let valA = '', valB = '';
        if (sortCol === 'serial') { valA = a.serial || ''; valB = b.serial || ''; }
        else if (sortCol === 'manufacturer') { valA = a.manufacturer || ''; valB = b.manufacturer || ''; }
        else if (sortCol === 'model') { valA = a.model || ''; valB = b.model || ''; }
        else if (sortCol === 'condition') { valA = a.condition_label || ''; valB = b.condition_label || ''; }
        else { valA = a[sortCol] || ''; valB = b[sortCol] || ''; }

        const res = String(valA).localeCompare(String(valB), 'ar-EG', { numeric: true });
        return sortDir === 'asc' ? res : -res;
    });

    // 3. Pagination calculation
    const totalMatching = filtered.length;
    const pageSizeVal = document.getElementById('wh-page-size-select')?.value || '15';
    const pageSize = pageSizeVal === 'all' ? totalMatching || 1 : parseInt(pageSizeVal, 10);
    const totalPages = Math.ceil(totalMatching / pageSize) || 1;

    if (WarehouseTableState.page > totalPages) WarehouseTableState.page = totalPages;
    if (WarehouseTableState.page < 1) WarehouseTableState.page = 1;

    const startIdx = (WarehouseTableState.page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalMatching);
    const pagedList = filtered.slice(startIdx, endIdx);

    // 4. Update Summary Label
    if (countLabel) {
        if (totalMatching === 0) {
            countLabel.textContent = `لا توجد نتائج مطابقة`;
        } else if (totalMatching === warehouseDataCache.summary.total_warehouse_pos) {
            countLabel.textContent = `عرض (${startIdx + 1} إلى ${endIdx}) من أصل (${totalMatching}) جهاز بالمخزن (صفحة ${WarehouseTableState.page} من ${totalPages})`;
        } else {
            countLabel.textContent = `عرض (${startIdx + 1} إلى ${endIdx}) من (${totalMatching}) نتيجة مطابقة (إجمالي المخزن: ${warehouseDataCache.summary.total_warehouse_pos}) (صفحة ${WarehouseTableState.page} من ${totalPages})`;
        }
    }

    // 5. Render Pagination Buttons
    if (paginationControls) {
        paginationControls.innerHTML = '';
        if (totalPages > 1) {
            const isFirst = WarehouseTableState.page === 1;
            paginationControls.innerHTML += `
                <button type="button" class="btn btn-secondary" onclick="setWarehousePage(1)" ${isFirst ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة الأولى">«</button>
                <button type="button" class="btn btn-secondary" onclick="setWarehousePage(${WarehouseTableState.page - 1})" ${isFirst ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة السابقة">‹</button>
            `;

            const maxButtons = 5;
            let startPage = Math.max(1, WarehouseTableState.page - 2);
            let endPage = Math.min(totalPages, startPage + maxButtons - 1);
            if (endPage - startPage < maxButtons - 1) {
                startPage = Math.max(1, endPage - maxButtons + 1);
            }

            for (let p = startPage; p <= endPage; p++) {
                const isActive = p === WarehouseTableState.page;
                paginationControls.innerHTML += `
                    <button type="button" class="btn ${isActive ? 'btn-primary' : 'btn-secondary'}" onclick="setWarehousePage(${p})" style="padding:4px 10px; font-size:11px; font-weight:700; border-radius:6px; min-width:28px;">${p}</button>
                `;
            }

            const isLast = WarehouseTableState.page === totalPages;
            paginationControls.innerHTML += `
                <button type="button" class="btn btn-secondary" onclick="setWarehousePage(${WarehouseTableState.page + 1})" ${isLast ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة التالية">›</button>
                <button type="button" class="btn btn-secondary" onclick="setWarehousePage(${totalPages})" ${isLast ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة الأخيرة">»</button>
            `;
        }
    }

    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (totalMatching === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--md-sys-color-on-surface-variant);">لا توجد أجهزة مطابقة لمعايير البحث في المخزن</td></tr>`;
        return;
    }

    pagedList.forEach((d, idx) => {
        let badgeClass = 'inmerchant';
        let badgeText = d.condition_label;

        if (d.condition_type === 'NEW_FOR_SALE') {
            badgeClass = 'new-sale';
        } else if (d.condition_type === 'BRANCH_INTERNAL') {
            badgeClass = 'branch-use';
        } else if (d.condition_type === 'FAULTY_IN_BRANCH') {
            badgeClass = 'faulty';
        } else {
            badgeClass = 'inmerchant';
        }

        tableBody.innerHTML += `
            <tr>
                <td style="font-family:var(--font-en); font-weight:700; color:var(--md-sys-color-on-surface-variant);">${startIdx + idx + 1}</td>
                <td>
                    <a href="javascript:void(0)" onclick="openAssetTimeline('${d.serial}')" style="font-family:var(--font-en); font-weight:800; color:var(--md-sys-color-primary); text-decoration:underline;">
                        ${d.serial}
                    </a>
                </td>
                <td>${d.manufacturer}</td>
                <td><strong style="color:var(--md-sys-color-on-surface); font-family:var(--font-en);">${d.model}</strong></td>
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                <td style="max-width:280px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; font-size:12px; color:var(--md-sys-color-on-surface-variant);">
                    ${(() => {
                        const n = String(d.notes || '').trim();
                        const f = String(d.faulty_details || '').trim();
                        if (n && f && n !== f) return `<span style="font-weight:700; color:var(--md-sys-color-primary);">${n}</span> - ${f}`;
                        if (n) return `<span style="font-weight:700; color:var(--md-sys-color-primary);">${n}</span>`;
                        if (f) return f;
                        return '<span style="color:var(--text-muted);">-</span>';
                    })()}
                </td>
                <td>
                    <button type="button" class="btn btn-secondary" onclick="openAssetTimeline('${d.serial}')" style="padding:4px 10px; font-size:11px; border-radius:var(--md-shape-corner-full); display:flex; align-items:center; gap:4px;">
                        <i data-lucide="history" style="width:12px; height:12px;"></i>
                        <span>تتبع الماكينة</span>
                    </button>
                </td>
            </tr>
        `;
    });

    refreshIcons();
}

function exportWarehouseStockToExcel() {
    if (!warehouseDataCache || !warehouseDataCache.devices) {
        alert('لا توجد بيانات جاهزة للتصدير');
        return;
    }

    const searchVal = (document.getElementById('wh-table-search-input')?.value || '').trim().toLowerCase();
    const statusVal = document.getElementById('wh-table-status-filter')?.value || 'all';
    const modelVal = document.getElementById('wh-table-model-filter')?.value || 'all';

    let list = warehouseDataCache.devices;
    if (statusVal !== 'all') list = list.filter(d => d.condition_type === statusVal);
    if (modelVal !== 'all') list = list.filter(d => d.model === modelVal);
    if (searchVal) {
        list = list.filter(d => 
            (d.serial && d.serial.toLowerCase().includes(searchVal)) ||
            (d.model && d.model.toLowerCase().includes(searchVal)) ||
            (d.manufacturer && d.manufacturer.toLowerCase().includes(searchVal)) ||
            (d.notes && d.notes.toLowerCase().includes(searchVal)) ||
            (d.pos_status && d.pos_status.toLowerCase().includes(searchVal)) ||
            (d.status_note && d.status_note.toLowerCase().includes(searchVal)) ||
            (d.faulty_details && d.faulty_details.toLowerCase().includes(searchVal))
        );
    }

    const rows = list.map((d, idx) => ({
        "م": idx + 1,
        "سيريال الماكينة (Serial)": d.serial,
        "الشركة المصنعة": d.manufacturer,
        "الموديل": d.model,
        "حالة وتصنيف الماكينة": d.condition_label,
        "ملاحظات الفرع والعهدة": d.notes || '-',
        "تفاصيل الفحص / العطل": d.faulty_details
    }));

    if (window.XLSX) {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "مخزون ماكينات المخزن");
        XLSX.writeFile(wb, `جرد_ماكينات_المخزن_${new Date().toISOString().substring(0, 10)}.xlsx`);
    } else {
        const headers = Object.keys(rows[0]).join(",");
        const csvContent = "\uFEFF" + [headers, ...rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\r\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `جرد_ماكينات_المخزن_${new Date().toISOString().substring(0, 10)}.csv`;
        link.click();
    }
}

// ==========================================
// 5.6 SIM CARDS WAREHOUSE INVENTORY DASHBOARD MODULE
// ==========================================
let simsDataCache = null;

const SimsTableState = {
    page: 1,
    pageSize: 15,
    sortCol: 'serial',
    sortDir: 'asc'
};

function sortSimsTable(column) {
    if (SimsTableState.sortCol === column) {
        SimsTableState.sortDir = SimsTableState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        SimsTableState.sortCol = column;
        SimsTableState.sortDir = 'asc';
    }
    // Update sort indicators on headers
    ['serial', 'carrier', 'condition'].forEach(col => {
        const el = document.getElementById(`sims-sort-${col}`);
        if (el) {
            if (SimsTableState.sortCol === col) {
                el.textContent = SimsTableState.sortDir === 'asc' ? '▲' : '▼';
                el.style.color = 'var(--md-sys-color-primary)';
            } else {
                el.textContent = '⇕';
                el.style.color = 'var(--md-sys-color-on-surface-variant)';
            }
        }
    });
    renderSimsDevicesTable();
}
window.sortSimsTable = sortSimsTable;

function setSimsPage(p) {
    SimsTableState.page = p;
    renderSimsDevicesTable();
    document.getElementById('sims-devices-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
window.setSimsPage = setSimsPage;

async function loadSimsInventory() {
    const kpiTotal = document.getElementById('sims-kpi-total');
    const kpiGrandTotal = document.getElementById('sims-kpi-grand-total');
    const kpiInMerchant = document.getElementById('sims-kpi-in-merchant');
    const kpiNewSale = document.getElementById('sims-kpi-newsale');
    const kpiReady = document.getElementById('sims-kpi-ready');
    const kpiFuel = document.getElementById('sims-kpi-fuel');
    const kpiFaulty = document.getElementById('sims-kpi-faulty');
    const countLabel = document.getElementById('sims-carriers-count-label');
    const carriersGrid = document.getElementById('sims-carriers-cards-grid');
    const carrierFilter = document.getElementById('sims-table-carrier-filter');
    const statusFilter = document.getElementById('sims-table-status-filter');
    const searchInput = document.getElementById('sims-table-search-input');
    const pageSizeSelect = document.getElementById('sims-page-size-select');
    const refreshBtn = document.getElementById('btn-refresh-sims-stock');
    const exportBtn = document.getElementById('btn-export-sims-excel');

    try {
        if (window.showTableLoading) window.showTableLoading('sims-table-body', 6, 8);

        const res = await fetch('/api/inventory/sims-dashboard');
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to load sims data');

        simsDataCache = data;

        // 1. Update KPI Summary
        const s = data.summary;
        if (kpiTotal) kpiTotal.textContent = s.total_warehouse_sims.toLocaleString();
        if (kpiGrandTotal) kpiGrandTotal.textContent = s.grand_total_sims.toLocaleString();
        if (kpiInMerchant) kpiInMerchant.textContent = s.total_merchant_sims.toLocaleString();
        if (kpiNewSale) kpiNewSale.textContent = s.new_sims.toLocaleString();
        if (kpiReady) kpiReady.textContent = s.ready_in_stock.toLocaleString();
        if (kpiFuel) kpiFuel.textContent = s.fuel_project.toLocaleString();
        if (kpiFaulty) kpiFaulty.textContent = s.faulty_sims.toLocaleString();

        // 2. Render Carriers Breakdown Cards
        const carriers = (data.carriers || []).filter(c => c.carrier !== 'new sim type' || c.total_all > 0);
        if (countLabel) countLabel.textContent = `تم رصد (${carriers.length}) شبكات اتصال في المخزن والمنظومة`;

        if (carriersGrid) {
            carriersGrid.innerHTML = '';
            carriers.forEach(c => {
                let carrierClass = 'vodafone';
                let iconColor = '#ef4444';
                const cLower = c.carrier.toLowerCase();
                if (cLower.includes('orange')) {
                    carrierClass = 'orange';
                    iconColor = '#f97316';
                } else if (cLower.includes('etisalat')) {
                    carrierClass = 'etisalat';
                    iconColor = '#22c55e';
                } else if (cLower.includes('we')) {
                    carrierClass = 'we';
                    iconColor = '#a855f7';
                }

                carriersGrid.innerHTML += `
                    <div class="sim-carrier-card ${carrierClass}" data-carrier="${c.carrier}" onclick="drilldownSims({ carrier: '${c.carrier}', cardEl: this })" title="انقر لتصفية جدول الشرائح وعرض شرائح ${c.carrier}" style="cursor:pointer;">
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                                <div style="display:flex; align-items:center; gap:10px;">
                                    <div style="width:40px; height:40px; border-radius:12px; background:rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:center; color:${iconColor};">
                                        <i data-lucide="radio" style="width:22px; height:22px;"></i>
                                    </div>
                                    <div>
                                        <h3 style="margin:0; font-size:18px; font-weight:800;">${c.carrier}</h3>
                                        <span style="font-size:11px; color:var(--md-sys-color-on-surface-variant);">شبكة اتصالات</span>
                                    </div>
                                </div>
                                <div style="text-align:left;">
                                    <div style="font-size:26px; font-weight:900; font-family:var(--font-en); color:${iconColor};">${c.total_warehouse}</div>
                                    <span style="font-size:10px; color:var(--md-sys-color-on-surface-variant); display:block;">بالمخزن</span>
                                </div>
                            </div>

                            <div style="margin-bottom:14px;">
                                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px; color:var(--md-sys-color-on-surface-variant);">
                                    <span>نسبة التواجد بالمخزن</span>
                                    <strong style="font-family:var(--font-en); color:${iconColor};">${c.warehouse_share_pct}%</strong>
                                </div>
                                <div class="wh-progress-track">
                                    <div class="wh-progress-bar" style="width: ${Math.max(4, c.warehouse_share_pct)}%; background:${iconColor};"></div>
                                </div>
                            </div>

                            <div class="wh-metrics-pills">
                                <div class="wh-pill-item" style="border-right: 3px solid #06b6d4; ${c.new_sims > 0 ? 'background:rgba(6,182,212,0.08);' : ''}">
                                    <span>🛍️ وارد جديد:</span>
                                    <strong style="color:#06b6d4;">${c.new_sims}</strong>
                                </div>
                                <div class="wh-pill-item" style="border-right: 3px solid #10b981;">
                                    <span>🟢 جاهزة وسليمة:</span>
                                    <strong style="color:#10b981;">${c.ready_in_stock}</strong>
                                </div>
                                <div class="wh-pill-item" style="border-right: 3px solid #f59e0b;">
                                    <span>⛽ مشروع الوقود:</span>
                                    <strong style="color:#f59e0b;">${c.fuel_project}</strong>
                                </div>
                                <div class="wh-pill-item" style="border-right: 3px solid #ef4444;">
                                    <span>🔴 معطلة / لا تعمل:</span>
                                    <strong style="color:#ef4444;">${c.faulty}</strong>
                                </div>
                                <div class="wh-pill-item" style="border-right: 3px solid #38bdf8;">
                                    <span>🏪 بالمخابز:</span>
                                    <strong style="color:var(--md-sys-color-primary);">${c.in_merchant}</strong>
                                </div>
                                <div class="wh-pill-item" style="border-right: 3px solid #818cf8;">
                                    <span>📊 إجمالي الشرائح:</span>
                                    <strong style="color:var(--md-sys-color-secondary);">${c.total_all}</strong>
                                </div>
                            </div>
                        </div>

                        <div style="margin-top:14px; border-top:1px solid var(--md-sys-color-outline-variant); padding-top:12px;">
                            <button type="button" class="btn btn-secondary btn-block btn-filter-carrier" data-carrier="${c.carrier}" style="width:100%; font-size:12px; padding:8px 12px; display:flex; justify-content:center; align-items:center; gap:6px; border-radius:var(--md-shape-corner-full);">
                                <i data-lucide="search" style="width:14px; height:14px;"></i>
                                <span>استعراض شرائح (${c.carrier}) في جدول المخزن</span>
                            </button>
                        </div>
                    </div>
                `;
            });
        }

        // 3. Populate Carrier Filter Dropdown
        if (carrierFilter) {
            carrierFilter.innerHTML = '<option value="all">كافة شبكات الاتصال</option>';
            carriers.forEach(c => {
                carrierFilter.innerHTML += `<option value="${c.carrier}">${c.carrier} (${c.total_warehouse} بالمخزن)</option>`;
            });
        }

        // 4. Render SIMs Table Devices
        renderSimsDevicesTable();

        // 5. Setup Event Listeners
        searchInput?.replaceWith(searchInput.cloneNode(true));
        statusFilter?.replaceWith(statusFilter.cloneNode(true));
        carrierFilter?.replaceWith(carrierFilter.cloneNode(true));
        pageSizeSelect?.replaceWith(pageSizeSelect.cloneNode(true));

        const newSearchInput = document.getElementById('sims-table-search-input');
        const newStatusFilter = document.getElementById('sims-table-status-filter');
        const newCarrierFilter = document.getElementById('sims-table-carrier-filter');
        const newPageSizeSelect = document.getElementById('sims-page-size-select');

        newSearchInput?.addEventListener('input', () => {
            SimsTableState.page = 1;
            renderSimsDevicesTable();
        });
        newStatusFilter?.addEventListener('change', () => {
            SimsTableState.page = 1;
            renderSimsDevicesTable();
        });
        newCarrierFilter?.addEventListener('change', () => {
            SimsTableState.page = 1;
            renderSimsDevicesTable();
        });
        newPageSizeSelect?.addEventListener('change', () => {
            SimsTableState.page = 1;
            renderSimsDevicesTable();
        });

        document.querySelectorAll('.btn-filter-carrier').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetCarrier = btn.getAttribute('data-carrier');
                if (newCarrierFilter) {
                    newCarrierFilter.value = targetCarrier;
                    SimsTableState.page = 1;
                    renderSimsDevicesTable();
                    document.getElementById('sims-devices-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
        });

        if (refreshBtn) {
            refreshBtn.onclick = () => {
                const icon = document.getElementById('icon-sims-refresh');
                if (icon) icon.classList.add('spin-animation');
                loadSimsInventory().then(() => {
                    if (icon) icon.classList.remove('spin-animation');
                });
            };
        }

        if (exportBtn) {
            exportBtn.onclick = () => {
                exportSimsStockToExcel();
            };
        }

        refreshIcons();
    } catch (err) {
        console.error('Error loading sims inventory dashboard:', err);
    }
}

function renderSimsDevicesTable() {
    if (!simsDataCache || !simsDataCache.sims) return;
    const tableBody = document.getElementById('sims-devices-table-body');
    const countLabel = document.getElementById('sims-table-count-label');
    const paginationControls = document.getElementById('sims-pagination-controls');
    const searchVal = (document.getElementById('sims-table-search-input')?.value || '').trim().toLowerCase();
    const statusVal = document.getElementById('sims-table-status-filter')?.value || 'all';
    const carrierVal = document.getElementById('sims-table-carrier-filter')?.value || 'all';

    // 1. Filter ALL SIMs across whole dataset
    let filtered = simsDataCache.sims;

    if (statusVal !== 'all') {
        filtered = filtered.filter(s => s.condition_type === statusVal);
    }
    if (carrierVal !== 'all') {
        filtered = filtered.filter(s => s.carrier === carrierVal);
    }
    if (searchVal) {
        filtered = filtered.filter(s => 
            (s.serial && s.serial.toLowerCase().includes(searchVal)) ||
            (s.carrier && s.carrier.toLowerCase().includes(searchVal)) ||
            (s.notes && s.notes.toLowerCase().includes(searchVal))
        );
    }

    // 2. Sort ALL filtered SIMs
    const sortCol = SimsTableState.sortCol;
    const sortDir = SimsTableState.sortDir;
    filtered.sort((a, b) => {
        let valA = '', valB = '';
        if (sortCol === 'serial') { valA = a.serial || ''; valB = b.serial || ''; }
        else if (sortCol === 'carrier') { valA = a.carrier || ''; valB = b.carrier || ''; }
        else if (sortCol === 'condition') { valA = a.condition_label || ''; valB = b.condition_label || ''; }
        else { valA = a[sortCol] || ''; valB = b[sortCol] || ''; }

        const res = String(valA).localeCompare(String(valB), 'ar-EG', { numeric: true });
        return sortDir === 'asc' ? res : -res;
    });

    // 3. Pagination calculation
    const totalMatching = filtered.length;
    const pageSizeVal = document.getElementById('sims-page-size-select')?.value || '15';
    const pageSize = pageSizeVal === 'all' ? totalMatching || 1 : parseInt(pageSizeVal, 10);
    const totalPages = Math.ceil(totalMatching / pageSize) || 1;

    if (SimsTableState.page > totalPages) SimsTableState.page = totalPages;
    if (SimsTableState.page < 1) SimsTableState.page = 1;

    const startIdx = (SimsTableState.page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalMatching);
    const pagedList = filtered.slice(startIdx, endIdx);

    // 4. Update Summary Label
    if (countLabel) {
        if (totalMatching === 0) {
            countLabel.textContent = `لا توجد نتائج مطابقة`;
        } else if (totalMatching === simsDataCache.summary.total_warehouse_sims) {
            countLabel.textContent = `عرض (${startIdx + 1} إلى ${endIdx}) من أصل (${totalMatching}) شريحة بالمخزن (صفحة ${SimsTableState.page} من ${totalPages})`;
        } else {
            countLabel.textContent = `عرض (${startIdx + 1} إلى ${endIdx}) من (${totalMatching}) نتيجة مطابقة (إجمالي المخزن: ${simsDataCache.summary.total_warehouse_sims}) (صفحة ${SimsTableState.page} من ${totalPages})`;
        }
    }

    // 5. Render Pagination Buttons
    if (paginationControls) {
        paginationControls.innerHTML = '';
        if (totalPages > 1) {
            const isFirst = SimsTableState.page === 1;
            paginationControls.innerHTML += `
                <button type="button" class="btn btn-secondary" onclick="setSimsPage(1)" ${isFirst ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة الأولى">«</button>
                <button type="button" class="btn btn-secondary" onclick="setSimsPage(${SimsTableState.page - 1})" ${isFirst ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة السابقة">‹</button>
            `;

            const maxButtons = 5;
            let startPage = Math.max(1, SimsTableState.page - 2);
            let endPage = Math.min(totalPages, startPage + maxButtons - 1);
            if (endPage - startPage < maxButtons - 1) {
                startPage = Math.max(1, endPage - maxButtons + 1);
            }

            for (let p = startPage; p <= endPage; p++) {
                const isActive = p === SimsTableState.page;
                paginationControls.innerHTML += `
                    <button type="button" class="btn ${isActive ? 'btn-primary' : 'btn-secondary'}" onclick="setSimsPage(${p})" style="padding:4px 10px; font-size:11px; font-weight:700; border-radius:6px; min-width:28px;">${p}</button>
                `;
            }

            const isLast = SimsTableState.page === totalPages;
            paginationControls.innerHTML += `
                <button type="button" class="btn btn-secondary" onclick="setSimsPage(${SimsTableState.page + 1})" ${isLast ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة التالية">›</button>
                <button type="button" class="btn btn-secondary" onclick="setSimsPage(${totalPages})" ${isLast ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة الأخيرة">»</button>
            `;
        }
    }

    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (totalMatching === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--md-sys-color-on-surface-variant);">لا توجد شرائح مطابقة لمعايير البحث في المخزن</td></tr>`;
        return;
    }

    pagedList.forEach((s, idx) => {
        let badgeClass = 'inmerchant';
        let badgeText = s.condition_label;

        if (s.condition_type === 'NEW_SIM') {
            badgeClass = 'new-sale';
        } else if (s.condition_type === 'PROJECT_FUEL') {
            badgeClass = 'branch-use';
        } else if (s.condition_type === 'FAULTY_SIM') {
            badgeClass = 'faulty';
        } else {
            badgeClass = 'inmerchant';
        }

        tableBody.innerHTML += `
            <tr>
                <td style="font-family:var(--font-en); font-weight:700; color:var(--md-sys-color-on-surface-variant);">${startIdx + idx + 1}</td>
                <td>
                    <a href="javascript:void(0)" onclick="openAssetTimeline('${s.serial}')" style="font-family:var(--font-en); font-weight:800; color:var(--md-sys-color-primary); text-decoration:underline;">
                        ${s.serial}
                    </a>
                </td>
                <td><strong style="color:var(--md-sys-color-on-surface); font-family:var(--font-en);">${s.carrier}</strong></td>
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                <td style="max-width:280px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; font-size:12px; color:var(--md-sys-color-on-surface-variant);">
                    ${s.notes ? `<span style="font-weight:700; color:var(--md-sys-color-primary);">${s.notes}</span>` : 'سليمة بالمخزن'}
                </td>
                <td>
                    <button type="button" class="btn btn-secondary" onclick="openAssetTimeline('${s.serial}')" style="padding:4px 10px; font-size:11px; border-radius:var(--md-shape-corner-full); display:flex; align-items:center; gap:4px;">
                        <i data-lucide="history" style="width:12px; height:12px;"></i>
                        <span>تتبع الشريحة</span>
                    </button>
                </td>
            </tr>
        `;
    });

    refreshIcons();
}

function exportSimsStockToExcel() {
    if (!simsDataCache || !simsDataCache.sims) {
        alert('لا توجد بيانات جاهزة للتصدير');
        return;
    }

    const searchVal = (document.getElementById('sims-table-search-input')?.value || '').trim().toLowerCase();
    const statusVal = document.getElementById('sims-table-status-filter')?.value || 'all';
    const carrierVal = document.getElementById('sims-table-carrier-filter')?.value || 'all';

    let list = simsDataCache.sims;
    if (statusVal !== 'all') list = list.filter(s => s.condition_type === statusVal);
    if (carrierVal !== 'all') list = list.filter(s => s.carrier === carrierVal);
    if (searchVal) {
        list = list.filter(s => 
            (s.serial && s.serial.toLowerCase().includes(searchVal)) ||
            (s.carrier && s.carrier.toLowerCase().includes(searchVal)) ||
            (s.notes && s.notes.toLowerCase().includes(searchVal))
        );
    }

    const rows = list.map((s, idx) => ({
        "م": idx + 1,
        "سيريال الشريحة (SIM Serial)": s.serial,
        "شركة الاتصالات / الشبكة": s.carrier,
        "حالة وتصنيف الشريحة": s.condition_label,
        "ملاحظات الاستخدام والمشروع": s.notes || '-'
    }));

    if (window.XLSX) {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "مخزون شرائح الاتصال");
        XLSX.writeFile(wb, `جرد_شرائح_المخزن_${new Date().toISOString().substring(0, 10)}.xlsx`);
    } else {
        const headers = Object.keys(rows[0]).join(",");
        const csvContent = "\uFEFF" + [headers, ...rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\r\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `جرد_شرائح_المخزن_${new Date().toISOString().substring(0, 10)}.csv`;
        link.click();
    }
}

// ==========================================
// 5.7 HQ CENTRAL MAINTENANCE DASHBOARD MODULE
// ==========================================
let hqMaintenanceDataCache = null;

const HqMaintenanceTableState = {
    page: 1,
    pageSize: 15,
    sortCol: 'out_date',
    sortDir: 'desc'
};

function sortHqMaintenanceTable(column) {
    if (HqMaintenanceTableState.sortCol === column) {
        HqMaintenanceTableState.sortDir = HqMaintenanceTableState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        HqMaintenanceTableState.sortCol = column;
        HqMaintenanceTableState.sortDir = column === 'out_date' || column === 'in_date' ? 'desc' : 'asc';
    }
    // Update sort indicators on headers
    ['serial', 'model', 'out_date', 'in_date', 'status', 'form_no'].forEach(col => {
        const el = document.getElementById(`hq-sort-${col}`);
        if (el) {
            if (HqMaintenanceTableState.sortCol === col) {
                el.textContent = HqMaintenanceTableState.sortDir === 'asc' ? '▲' : '▼';
                el.style.color = 'var(--md-sys-color-primary)';
            } else {
                el.textContent = '⇕';
                el.style.color = 'var(--md-sys-color-on-surface-variant)';
            }
        }
    });
    renderHqMaintenanceTable();
}
window.sortHqMaintenanceTable = sortHqMaintenanceTable;

function setHqMaintenancePage(p) {
    HqMaintenanceTableState.page = p;
    renderHqMaintenanceTable();
    document.getElementById('hq-devices-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
window.setHqMaintenancePage = setHqMaintenancePage;

async function loadHqMaintenanceInventory() {
    const kpiOpen = document.getElementById('hq-kpi-open');
    const kpiCompleted = document.getElementById('hq-kpi-completed');
    const kpiTotal = document.getElementById('hq-kpi-total');
    const kpiUnique = document.getElementById('hq-kpi-unique');
    const kpiSp = document.getElementById('hq-kpi-sp-consumed');
    const modelsCountLabel = document.getElementById('hq-models-count-label');
    const modelsGrid = document.getElementById('hq-models-cards-grid');
    const faultsList = document.getElementById('hq-top-faults-list');
    const modelFilter = document.getElementById('hq-table-model-filter');
    const statusFilter = document.getElementById('hq-table-status-filter');
    const searchInput = document.getElementById('hq-table-search-input');
    const pageSizeSelect = document.getElementById('hq-page-size-select');
    const refreshBtn = document.getElementById('btn-refresh-hq-stock');
    const exportBtn = document.getElementById('btn-export-hq-excel');

    try {
        if (window.showTableLoading) window.showTableLoading('hq-devices-table-body', 6, 8);

        const res = await fetch('/api/inventory/hq-maintenance-dashboard');
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to load HQ maintenance data');

        hqMaintenanceDataCache = data;

        // 1. Update KPI Summary
        const s = data.summary;
        if (kpiOpen) kpiOpen.textContent = s.currently_at_hq.toLocaleString();
        if (kpiCompleted) kpiCompleted.textContent = s.completed_cycles.toLocaleString();
        if (kpiTotal) kpiTotal.textContent = s.total_cycles.toLocaleString();
        if (kpiUnique) kpiUnique.textContent = s.unique_machines.toLocaleString();
        if (kpiSp) kpiSp.textContent = s.spare_parts_consumed.toLocaleString();

        // 2. Render Models Breakdown Cards
        const models = data.models || [];
        if (modelsCountLabel) modelsCountLabel.textContent = `تم رصد (${models.length}) موديلات خضعت للصيانة المركزية`;

        if (modelsGrid) {
            modelsGrid.innerHTML = '';
            models.forEach(m => {
                modelsGrid.innerHTML += `
                    <div class="wh-model-card" data-model="${m.model}" onclick="drilldownHq({ search: '${m.model}', cardEl: this })" title="انقر لتصفية سجل الصيانة وعرض دورات ${m.model}" style="border-right: 4px solid #f59e0b; cursor:pointer;">
                        <div>
                            <div class="wh-model-header">
                                <div>
                                    <h3 class="wh-model-title">
                                        <i data-lucide="cpu" style="width:18px; height:18px; color:#f59e0b;"></i>
                                        <span>${m.model}</span>
                                    </h3>
                                    <span class="wh-mfg-badge">${m.manufacturer}</span>
                                </div>
                                <div class="wh-count-display">
                                    <div class="wh-count-number" style="color:#f59e0b;">${m.total_dispatches}</div>
                                    <span class="wh-count-label">إجمالي الدورات</span>
                                </div>
                            </div>

                            <div class="wh-metrics-pills" style="margin-top:10px;">
                                <div class="wh-pill-item" style="border-right: 3px solid #ef4444; ${m.currently_at_hq > 0 ? 'background:rgba(239,68,68,0.08);' : ''}">
                                    <span>⚠️ بالمركز حالياً:</span>
                                    <strong style="color:#ef4444;">${m.currently_at_hq}</strong>
                                </div>
                                <div class="wh-pill-item" style="border-right: 3px solid #10b981;">
                                    <span>✅ تم الإصلاح:</span>
                                    <strong style="color:#10b981;">${m.completed}</strong>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        // 3. Render Top Faults List
        const faults = data.top_faults || [];
        if (faultsList) {
            faultsList.innerHTML = '';
            const maxFault = faults.length > 0 ? faults[0].count : 1;
            faults.forEach(f => {
                const pct = Math.round((f.count / maxFault) * 100);
                faultsList.innerHTML += `
                    <div class="fault-item-drilldown" onclick="drilldownHq({ search: '${f.fault}', cardEl: this })" title="انقر لتصفية سجل الصيانة لعطل (${f.fault})" style="display:flex; flex-direction:column; gap:4px; font-size:12px; cursor:pointer; padding:6px 8px; border-radius:8px; transition:background 0.2s;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-weight:600; color:var(--md-sys-color-on-surface);">${f.fault}</span>
                            <strong style="font-family:var(--font-en); color:#ef4444;">${f.count} حركة</strong>
                        </div>
                        <div class="wh-progress-track">
                            <div class="wh-progress-bar" style="width:${pct}%; background:#ef4444;"></div>
                        </div>
                    </div>
                `;
            });
        }

        // 4. Populate Model Filter Dropdown
        if (modelFilter) {
            modelFilter.innerHTML = '<option value="all">كافة الموديلات</option>';
            models.forEach(m => {
                modelFilter.innerHTML += `<option value="${m.model}">${m.model} (${m.total_dispatches} دورة)</option>`;
            });
        }

        // 5. Render Table Devices
        renderHqMaintenanceTable();

        // 6. Setup Event Listeners
        searchInput?.replaceWith(searchInput.cloneNode(true));
        statusFilter?.replaceWith(statusFilter.cloneNode(true));
        modelFilter?.replaceWith(modelFilter.cloneNode(true));
        pageSizeSelect?.replaceWith(pageSizeSelect.cloneNode(true));

        const newSearchInput = document.getElementById('hq-table-search-input');
        const newStatusFilter = document.getElementById('hq-table-status-filter');
        const newModelFilter = document.getElementById('hq-table-model-filter');
        const newPageSizeSelect = document.getElementById('hq-page-size-select');

        newSearchInput?.addEventListener('input', () => {
            HqMaintenanceTableState.page = 1;
            renderHqMaintenanceTable();
        });
        newStatusFilter?.addEventListener('change', () => {
            HqMaintenanceTableState.page = 1;
            renderHqMaintenanceTable();
        });
        newModelFilter?.addEventListener('change', () => {
            HqMaintenanceTableState.page = 1;
            renderHqMaintenanceTable();
        });
        newPageSizeSelect?.addEventListener('change', () => {
            HqMaintenanceTableState.page = 1;
            renderHqMaintenanceTable();
        });

        document.querySelectorAll('.btn-filter-hq-model').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetModel = btn.getAttribute('data-model');
                if (newModelFilter) {
                    newModelFilter.value = targetModel;
                    HqMaintenanceTableState.page = 1;
                    renderHqMaintenanceTable();
                    document.getElementById('hq-devices-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
        });

        if (refreshBtn) {
            refreshBtn.onclick = () => {
                const icon = document.getElementById('icon-hq-refresh');
                if (icon) icon.classList.add('spin-animation');
                loadHqMaintenanceInventory().then(() => {
                    if (icon) icon.classList.remove('spin-animation');
                });
            };
        }

        if (exportBtn) {
            exportBtn.onclick = () => {
                exportHqMaintenanceToExcel();
            };
        }

        refreshIcons();
    } catch (err) {
        console.error('Error loading HQ maintenance dashboard:', err);
    }
}

function renderHqMaintenanceTable() {
    if (!hqMaintenanceDataCache || !hqMaintenanceDataCache.dispatches) return;
    const tableBody = document.getElementById('hq-devices-table-body');
    const countLabel = document.getElementById('hq-table-count-label');
    const paginationControls = document.getElementById('hq-pagination-controls');
    const searchVal = (document.getElementById('hq-table-search-input')?.value || '').trim().toLowerCase();
    const statusVal = document.getElementById('hq-table-status-filter')?.value || 'all';
    const modelVal = document.getElementById('hq-table-model-filter')?.value || 'all';

    // 1. Filter ALL dispatches
    let filtered = hqMaintenanceDataCache.dispatches;

    if (statusVal !== 'all') {
        filtered = filtered.filter(d => d.status_key === statusVal);
    }
    if (modelVal !== 'all') {
        filtered = filtered.filter(d => d.model === modelVal);
    }
    if (searchVal) {
        filtered = filtered.filter(d => 
            (d.serial && d.serial.toLowerCase().includes(searchVal)) ||
            (d.model && d.model.toLowerCase().includes(searchVal)) ||
            (d.manufacturer && d.manufacturer.toLowerCase().includes(searchVal)) ||
            (d.form_no && d.form_no.toLowerCase().includes(searchVal)) ||
            (d.notes && d.notes.toLowerCase().includes(searchVal)) ||
            (d.faults_detected && d.faults_detected.toLowerCase().includes(searchVal))
        );
    }

    // 2. Sort ALL filtered dispatches
    const sortCol = HqMaintenanceTableState.sortCol;
    const sortDir = HqMaintenanceTableState.sortDir;
    filtered.sort((a, b) => {
        let valA = '', valB = '';
        if (sortCol === 'serial') { valA = a.serial || ''; valB = b.serial || ''; }
        else if (sortCol === 'model') { valA = a.model || ''; valB = b.model || ''; }
        else if (sortCol === 'out_date') { valA = a.out_date || ''; valB = b.out_date || ''; }
        else if (sortCol === 'in_date') { valA = a.in_date || ''; valB = b.in_date || ''; }
        else if (sortCol === 'status') { valA = a.status_label || ''; valB = b.status_label || ''; }
        else if (sortCol === 'form_no') { valA = a.form_no || ''; valB = b.form_no || ''; }
        else { valA = a[sortCol] || ''; valB = b[sortCol] || ''; }

        const res = String(valA).localeCompare(String(valB), 'ar-EG', { numeric: true });
        return sortDir === 'asc' ? res : -res;
    });

    // 3. Pagination calculation
    const totalMatching = filtered.length;
    const pageSizeVal = document.getElementById('hq-page-size-select')?.value || '15';
    const pageSize = pageSizeVal === 'all' ? totalMatching || 1 : parseInt(pageSizeVal, 10);
    const totalPages = Math.ceil(totalMatching / pageSize) || 1;

    if (HqMaintenanceTableState.page > totalPages) HqMaintenanceTableState.page = totalPages;
    if (HqMaintenanceTableState.page < 1) HqMaintenanceTableState.page = 1;

    const startIdx = (HqMaintenanceTableState.page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalMatching);
    const pagedList = filtered.slice(startIdx, endIdx);

    // 4. Update Summary Label
    if (countLabel) {
        if (totalMatching === 0) {
            countLabel.textContent = `لا توجد نتائج مطابقة`;
        } else if (totalMatching === hqMaintenanceDataCache.summary.total_cycles) {
            countLabel.textContent = `عرض (${startIdx + 1} إلى ${endIdx}) من أصل (${totalMatching}) حركة صيانة (صفحة ${HqMaintenanceTableState.page} من ${totalPages})`;
        } else {
            countLabel.textContent = `عرض (${startIdx + 1} إلى ${endIdx}) من (${totalMatching}) نتيجة مطابقة (إجمالي السجل: ${hqMaintenanceDataCache.summary.total_cycles}) (صفحة ${HqMaintenanceTableState.page} من ${totalPages})`;
        }
    }

    // 5. Render Pagination Buttons
    if (paginationControls) {
        paginationControls.innerHTML = '';
        if (totalPages > 1) {
            const isFirst = HqMaintenanceTableState.page === 1;
            paginationControls.innerHTML += `
                <button type="button" class="btn btn-secondary" onclick="setHqMaintenancePage(1)" ${isFirst ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة الأولى">«</button>
                <button type="button" class="btn btn-secondary" onclick="setHqMaintenancePage(${HqMaintenanceTableState.page - 1})" ${isFirst ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة السابقة">‹</button>
            `;

            const maxButtons = 5;
            let startPage = Math.max(1, HqMaintenanceTableState.page - 2);
            let endPage = Math.min(totalPages, startPage + maxButtons - 1);
            if (endPage - startPage < maxButtons - 1) {
                startPage = Math.max(1, endPage - maxButtons + 1);
            }

            for (let p = startPage; p <= endPage; p++) {
                const isActive = p === HqMaintenanceTableState.page;
                paginationControls.innerHTML += `
                    <button type="button" class="btn ${isActive ? 'btn-primary' : 'btn-secondary'}" onclick="setHqMaintenancePage(${p})" style="padding:4px 10px; font-size:11px; font-weight:700; border-radius:6px; min-width:28px;">${p}</button>
                `;
            }

            const isLast = HqMaintenanceTableState.page === totalPages;
            paginationControls.innerHTML += `
                <button type="button" class="btn btn-secondary" onclick="setHqMaintenancePage(${HqMaintenanceTableState.page + 1})" ${isLast ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة التالية">›</button>
                <button type="button" class="btn btn-secondary" onclick="setHqMaintenancePage(${totalPages})" ${isLast ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة الأخيرة">»</button>
            `;
        }
    }

    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (totalMatching === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--md-sys-color-on-surface-variant);">لا توجد حركات صيانة مطابقة لمعايير البحث</td></tr>`;
        return;
    }

    pagedList.forEach((d, idx) => {
        const badgeClass = d.is_open ? 'faulty' : 'inmerchant';
        const badgeText = d.status_label;

        const partsHtml = d.spare_parts && d.spare_parts.length > 0 
            ? `<div style="margin-top:4px;"><span class="badge" style="background:rgba(6,182,212,0.15); color:#06b6d4; font-size:10px; border:1px solid rgba(6,182,212,0.3);"><i data-lucide="layers" style="width:10px;height:10px;"></i> قطع مستبدلة: ${d.spare_parts.map(p => p.type).join(', ')}</span></div>`
            : '';

        tableBody.innerHTML += `
            <tr>
                <td style="font-family:var(--font-en); font-weight:700; color:var(--md-sys-color-on-surface-variant);">${startIdx + idx + 1}</td>
                <td>
                    <a href="javascript:void(0)" onclick="openAssetTimeline('${d.serial}')" style="font-family:var(--font-en); font-weight:800; color:var(--md-sys-color-primary); text-decoration:underline;">
                        ${d.serial}
                    </a>
                </td>
                <td><strong style="color:var(--md-sys-color-on-surface); font-family:var(--font-en);">${d.model}</strong></td>
                <td style="font-family:var(--font-en); font-size:12px;">${formatDateDDMMYYYY(d.out_date, false)}</td>
                <td style="font-family:var(--font-en); font-size:12px;">${d.in_date ? formatDateDDMMYYYY(d.in_date, false) : '<span style="color:#ef4444; font-weight:700;">قيد الإصلاح</span>'}</td>
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                <td style="font-family:var(--font-en); font-weight:700;"><code style="background:var(--md-sys-color-surface-container); padding:2px 6px; border-radius:4px;">${d.form_no}</code></td>
                <td style="max-width:280px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; font-size:12px; color:var(--md-sys-color-on-surface-variant);">
                    <span style="font-weight:600; color:var(--md-sys-color-on-surface);">${d.faults_detected}</span>
                    ${partsHtml}
                </td>
                <td>
                    <button type="button" class="btn btn-secondary" onclick="openAssetTimeline('${d.serial}')" style="padding:4px 10px; font-size:11px; border-radius:var(--md-shape-corner-full); display:flex; align-items:center; gap:4px;">
                        <i data-lucide="history" style="width:12px; height:12px;"></i>
                        <span>تتبع الماكينة</span>
                    </button>
                </td>
            </tr>
        `;
    });

    refreshIcons();
}

function exportHqMaintenanceToExcel() {
    if (!hqMaintenanceDataCache || !hqMaintenanceDataCache.dispatches) {
        alert('لا توجد بيانات جاهزة للتصدير');
        return;
    }

    const searchVal = (document.getElementById('hq-table-search-input')?.value || '').trim().toLowerCase();
    const statusVal = document.getElementById('hq-table-status-filter')?.value || 'all';
    const modelVal = document.getElementById('hq-table-model-filter')?.value || 'all';

    let list = hqMaintenanceDataCache.dispatches;
    if (statusVal !== 'all') list = list.filter(d => d.status_key === statusVal);
    if (modelVal !== 'all') list = list.filter(d => d.model === modelVal);
    if (searchVal) {
        list = list.filter(d => 
            (d.serial && d.serial.toLowerCase().includes(searchVal)) ||
            (d.model && d.model.toLowerCase().includes(searchVal)) ||
            (d.manufacturer && d.manufacturer.toLowerCase().includes(searchVal)) ||
            (d.form_no && d.form_no.toLowerCase().includes(searchVal)) ||
            (d.notes && d.notes.toLowerCase().includes(searchVal)) ||
            (d.faults_detected && d.faults_detected.toLowerCase().includes(searchVal))
        );
    }

    const rows = list.map((d, idx) => ({
        "م": idx + 1,
        "سيريال الماكينة (Serial)": d.serial,
        "الشركة المصنعة": d.manufacturer,
        "الموديل": d.model,
        "تاريخ الإرسال للصيانة (Check Out)": d.out_date,
        "تاريخ العودة والاستلام (Check In)": d.in_date || 'قيد الإصلاح بالمركز الرئيسي',
        "موقف وحالة الصيانة": d.status_label,
        "رقم إذن/محضر الصيانة (Form No)": d.form_no,
        "تشخيص العطل والملاحظات": d.notes,
        "قطع الغيار المستبدلة": d.spare_parts.map(p => p.type).join(' | ') || '-'
    }));

    if (window.XLSX) {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "سجل الصيانة المركزية");
        XLSX.writeFile(wb, `سجل_الصيانة_المركزية_HQ_${new Date().toISOString().substring(0, 10)}.xlsx`);
    } else {
        const headers = Object.keys(rows[0]).join(",");
        const csvContent = "\uFEFF" + [headers, ...rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\r\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `سجل_الصيانة_المركزية_HQ_${new Date().toISOString().substring(0, 10)}.csv`;
        link.click();
    }
}

// ==========================================
// 3.8 POS INSTALLMENTS PORTFOLIO MODULE
// ==========================================
let installmentsDataCache = null;
let installmentsListenersBound = false;
const InstallmentsTableState = {
    page: 1,
    pageSize: 15,
    sortCol: 'id',
    sortDir: 'asc'
};

function sortInstallmentsTable(column) {
    if (InstallmentsTableState.sortCol === column) {
        InstallmentsTableState.sortDir = InstallmentsTableState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        InstallmentsTableState.sortCol = column;
        InstallmentsTableState.sortDir = (column === 'final_price' || column === 'total_paid' || column === 'remaining_amount' || column === 'duration') ? 'desc' : 'asc';
    }
    // Update sort indicators
    ['pos', 'merchant_name', 'government', 'duration', 'final_price', 'total_paid', 'remaining_amount', 'status'].forEach(col => {
        const el = document.getElementById(`inst-sort-${col}`);
        if (el) {
            if (InstallmentsTableState.sortCol === col) {
                el.textContent = InstallmentsTableState.sortDir === 'asc' ? '▲' : '▼';
                el.style.color = 'var(--md-sys-color-primary)';
            } else {
                el.textContent = '⇕';
                el.style.color = 'var(--md-sys-color-on-surface-variant)';
            }
        }
    });
    renderInstallmentsTable();
}
window.sortInstallmentsTable = sortInstallmentsTable;

function setInstallmentsPage(p) {
    InstallmentsTableState.page = p;
    renderInstallmentsTable();
    document.getElementById('inst-contracts-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
window.setInstallmentsPage = setInstallmentsPage;

function filterInstallmentsByDuration(dur) {
    const sel = document.getElementById('inst-table-duration-filter');
    if (sel) {
        sel.value = dur;
        InstallmentsTableState.page = 1;
        renderInstallmentsTable();
        document.getElementById('inst-contracts-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
window.filterInstallmentsByDuration = filterInstallmentsByDuration;

function filterInstallmentsByGov(gov) {
    const sel = document.getElementById('inst-table-gov-filter');
    if (sel) {
        sel.value = gov;
        InstallmentsTableState.page = 1;
        renderInstallmentsTable();
        document.getElementById('inst-contracts-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
window.filterInstallmentsByGov = filterInstallmentsByGov;

async function loadInstallmentsDashboard() {
    const kpiExpected = document.getElementById('inst-kpi-total-expected');
    const kpiCollected = document.getElementById('inst-kpi-total-collected');
    const kpiRemaining = document.getElementById('inst-kpi-total-remaining');
    const kpiContracts = document.getElementById('inst-kpi-total-contracts');
    const kpiFullyPaid = document.getElementById('inst-kpi-fully-paid');
    const kpiLate = document.getElementById('inst-kpi-late');
    const kpiRate = document.getElementById('inst-kpi-collection-rate');
    const plansGrid = document.getElementById('inst-plans-grid');
    const financeBreakdown = document.getElementById('inst-finance-breakdown');
    const govBreakdownList = document.getElementById('inst-gov-breakdown-list');
    const govFilter = document.getElementById('inst-table-gov-filter');
    const refreshBtn = document.getElementById('btn-refresh-inst-stock');
    const exportBtn = document.getElementById('btn-export-inst-excel');

    try {
        if (window.showTableLoading) window.showTableLoading('inst-contracts-table-body', 7, 8);

        const res = await fetch('/api/inventory/installments-dashboard');
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to load installments data');

        installmentsDataCache = data;

        // 1. Update KPI Cards
        const s = data.summary;
        if (kpiExpected) kpiExpected.textContent = Number(s.total_expected_amount || 0).toLocaleString('ar-EG') + ' جم';
        if (kpiCollected) kpiCollected.textContent = Number(s.total_collected_amount || 0).toLocaleString('ar-EG') + ' جم';
        if (kpiRemaining) kpiRemaining.textContent = Number(s.total_remaining_amount || 0).toLocaleString('ar-EG') + ' جم';
        if (kpiContracts) kpiContracts.textContent = Number(s.total_contracts || 0).toLocaleString('ar-EG');
        if (kpiFullyPaid) kpiFullyPaid.textContent = Number(s.fully_paid_count || 0).toLocaleString('ar-EG');
        if (kpiLate) kpiLate.textContent = Number(s.late_count || 0).toLocaleString('ar-EG');
        if (kpiRate) kpiRate.textContent = `نسبة التحصيل الفعلي: ${s.collection_rate_pct}%`;

        // 2. Render Plans Grid
        if (plansGrid && data.durations) {
            plansGrid.innerHTML = data.durations.map(plan => {
                const completionRate = plan.total_value > 0 ? ((plan.collected / plan.total_value) * 100).toFixed(1) : 0;
                return `
                    <div class="wh-model-card" onclick="drilldownInstallments({ duration: '${plan.duration}', cardEl: this })" title="انقر لتصفية جدول الأقساط لنظام (${plan.duration} شهور)" style="padding: 16px; border-radius: 14px; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); cursor:pointer;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 10px;">
                            <div>
                                <span class="badge inmerchant" style="font-size:12px; font-weight:800; font-family:var(--font-en); padding:4px 8px;">
                                    نظام ${plan.duration} شهور
                                </span>
                                <h3 style="font-size: 18px; font-weight: 800; margin: 8px 0 2px 0; color: var(--md-sys-color-primary);">
                                    ${Number(plan.monthly_price).toLocaleString('ar-EG')} جم <span style="font-size:11px; font-weight:normal; color:var(--text-muted);">/ شهرياً</span>
                                </h3>
                                <span style="font-size: 11px; color: var(--md-sys-color-on-surface-variant);">مقدم ثابت: 3,000 جم | إجمالي العقد: ${Number(plan.duration === 12 ? 13632 : 12060).toLocaleString('ar-EG')} جم</span>
                            </div>
                            <div style="text-align:left;">
                                <span style="font-size:24px; font-weight:800; font-family:var(--font-en); color:var(--text-primary); display:block;">${plan.count}</span>
                                <span style="font-size:10px; color:var(--text-muted);">عقد تقسيط</span>
                            </div>
                        </div>

                        <!-- Progress Bar -->
                        <div style="margin: 12px 0 8px 0;">
                            <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                                <span style="color:var(--text-secondary);">المحصل: ${Number(plan.collected).toLocaleString('ar-EG')} جم</span>
                                <strong style="color:var(--color-success); font-family:var(--font-en);">${completionRate}%</strong>
                            </div>
                            <div style="width:100%; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                                <div style="width:${completionRate}%; height:100%; background:linear-gradient(90deg, #10b981, #34d399); border-radius:3px;"></div>
                            </div>
                        </div>

                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; padding-top:8px; border-top:1px dashed var(--md-sys-color-outline-variant);">
                            <span style="color:#10b981; font-weight:700;"><i data-lucide="check" style="width:12px;height:12px;vertical-align:middle;"></i> ${plan.completed} مسدد</span>
                            <span style="color:#ef4444; font-weight:700;"><i data-lucide="clock" style="width:12px;height:12px;vertical-align:middle;"></i> ${plan.late} متأخر</span>
                            <button type="button" class="btn btn-secondary" onclick="filterInstallmentsByDuration('${plan.duration}')" style="padding:2px 8px; font-size:10px; border-radius:4px;">تصفية</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 3. Render Financial Breakdown Card
        if (financeBreakdown) {
            financeBreakdown.innerHTML = `
                <div style="padding:10px 14px; border-radius:10px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:12px; font-weight:700; color:var(--text-secondary);">إجمالي المقدمات المحصلة (50 عقد):</span>
                        <strong style="font-size:14px; font-family:var(--font-en); color:#10b981;">${Number(s.total_downpayment_amount || 150000).toLocaleString('ar-EG')} جم</strong>
                    </div>
                </div>
                <div style="padding:10px 14px; border-radius:10px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:12px; font-weight:700; color:var(--text-secondary);">إجمالي الأقساط الشهرية المسددة:</span>
                        <strong style="font-size:14px; font-family:var(--font-en); color:var(--color-primary);">${Number(s.total_paid_installments_amount || 0).toLocaleString('ar-EG')} جم</strong>
                    </div>
                </div>
                <div style="padding:10px 14px; border-radius:10px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:12px; font-weight:700; color:var(--text-secondary);">إجمالي المتبقي والمتأخرات:</span>
                        <strong style="font-size:14px; font-family:var(--font-en); color:#ef4444;">${Number(s.total_remaining_amount || 0).toLocaleString('ar-EG')} جم</strong>
                    </div>
                </div>
            `;
        }

        // 4. Render Government Breakdown Card
        if (govBreakdownList && data.gov_distribution) {
            const maxGovContracts = data.gov_distribution.length > 0 ? Math.max(...data.gov_distribution.map(g => g.count)) : 1;
            govBreakdownList.innerHTML = data.gov_distribution.map(g => {
                const pct = Math.round((g.count / maxGovContracts) * 100);
                const colPct = g.total_value > 0 ? ((g.collected / g.total_value) * 100).toFixed(0) : 0;
                return `
                    <div class="breakdown-item" style="cursor:pointer; padding:6px 10px; border-radius:8px; background:var(--md-sys-color-surface-container-low); border:1px solid var(--md-sys-color-outline-variant); transition: all 0.15s ease;" onclick="filterInstallmentsByGov('${g.name}')" title="اضغط للتصفية حسب ${g.name}">
                        <div class="breakdown-header" style="display:flex; justify-content:space-between; align-items:center; font-size:12px; margin-bottom:4px;">
                            <span style="font-weight:700; color:var(--md-sys-color-on-surface);"><i data-lucide="map-pin" style="width:12px; height:12px; vertical-align:middle; color:#f59e0b;"></i> ${g.name}</span>
                            <div style="display:flex; gap:8px; align-items:center;">
                                <span style="font-size:10px; color:#10b981; font-weight:700;">${colPct}% محصل</span>
                                <strong style="font-family:var(--font-en); font-size:12px; color:var(--md-sys-color-primary);">${g.count} عقد</strong>
                            </div>
                        </div>
                        <div class="breakdown-bar-track" style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
                            <div class="breakdown-bar-fill primary" style="width: ${pct}%; height:100%; border-radius:3px; background: linear-gradient(90deg, #f59e0b, #d97706);"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 5. Populate Gov Filter Dropdown
        if (govFilter && data.gov_distribution) {
            const currentGov = govFilter.value;
            govFilter.innerHTML = `<option value="all">كل الإدارات التموينية (${data.gov_distribution.length})</option>` +
                data.gov_distribution.map(g => `<option value="${g.name}" ${currentGov === g.name ? 'selected' : ''}>${g.name} (${g.count} عقد)</option>`).join('');
        }

        // 5. Render Table
        renderInstallmentsTable();

        // 6. Hook Listeners once
        if (!installmentsListenersBound) {
            document.getElementById('inst-table-search-input')?.addEventListener('input', () => {
                InstallmentsTableState.page = 1;
                renderInstallmentsTable();
            });
            document.getElementById('inst-table-status-filter')?.addEventListener('change', () => {
                InstallmentsTableState.page = 1;
                renderInstallmentsTable();
            });
            document.getElementById('inst-table-duration-filter')?.addEventListener('change', () => {
                InstallmentsTableState.page = 1;
                renderInstallmentsTable();
            });
            document.getElementById('inst-table-gov-filter')?.addEventListener('change', () => {
                InstallmentsTableState.page = 1;
                renderInstallmentsTable();
            });
            document.getElementById('inst-page-size-select')?.addEventListener('change', (e) => {
                InstallmentsTableState.pageSize = e.target.value === 'all' ? 99999 : parseInt(e.target.value, 10);
                InstallmentsTableState.page = 1;
                renderInstallmentsTable();
            });
            refreshBtn?.addEventListener('click', () => {
                const icon = document.getElementById('icon-inst-refresh');
                if (icon) icon.classList.add('spin-animation');
                loadInstallmentsDashboard().finally(() => {
                    if (icon) icon.classList.remove('spin-animation');
                });
            });
            exportBtn?.addEventListener('click', exportInstallmentsToExcel);
            installmentsListenersBound = true;
        }

        refreshIcons();
    } catch (err) {
        console.error("Error loading installments dashboard:", err);
        const tb = document.getElementById('inst-contracts-table-body');
        if (tb) tb.innerHTML = `<tr><td colspan="14" style="text-align:center; color:var(--color-critical); padding:30px;">خطأ في تحميل بيانات الأقساط: ${err.message}</td></tr>`;
    }
}
window.loadInstallmentsDashboard = loadInstallmentsDashboard;

function renderInstallmentsTable() {
    if (!installmentsDataCache || !installmentsDataCache.contracts) return;

    const tableBody = document.getElementById('inst-contracts-table-body');
    const countLabel = document.getElementById('inst-table-count-label');
    const paginationControls = document.getElementById('inst-pagination-controls');

    const searchVal = document.getElementById('inst-table-search-input')?.value.trim().toLowerCase() || '';
    const statusVal = document.getElementById('inst-table-status-filter')?.value || 'all';
    const durationVal = document.getElementById('inst-table-duration-filter')?.value || 'all';
    const govVal = document.getElementById('inst-table-gov-filter')?.value || 'all';

    // 1. Filter
    let filtered = installmentsDataCache.contracts.filter(c => {
        if (statusVal !== 'all' && c.status_key !== statusVal) return false;
        if (durationVal !== 'all' && String(c.duration_months) !== durationVal) return false;
        if (govVal !== 'all' && c.government !== govVal) return false;
        if (searchVal) {
            const matches = 
                (c.pos_serial && c.pos_serial.toLowerCase().includes(searchVal)) ||
                (c.merchant_code && c.merchant_code.toLowerCase().includes(searchVal)) ||
                (c.merchant_name && c.merchant_name.toLowerCase().includes(searchVal)) ||
                (c.government && c.government.toLowerCase().includes(searchVal)) ||
                (c.device_model && c.device_model.toLowerCase().includes(searchVal));
            if (!matches) return false;
        }
        return true;
    });

    // 2. Sort Globally
    const col = InstallmentsTableState.sortCol;
    const dir = InstallmentsTableState.sortDir;
    filtered.sort((a, b) => {
        let vA, vB;
        if (col === 'pos') { vA = a.pos_serial; vB = b.pos_serial; }
        else if (col === 'merchant_name') { vA = a.merchant_name; vB = b.merchant_name; }
        else if (col === 'government') { vA = a.government; vB = b.government; }
        else if (col === 'duration') { vA = a.duration_months; vB = b.duration_months; }
        else if (col === 'final_price') { vA = a.final_unit_price; vB = b.final_unit_price; }
        else if (col === 'total_paid') { vA = a.total_paid; vB = b.total_paid; }
        else if (col === 'remaining_amount') { vA = a.remaining_amount; vB = b.remaining_amount; }
        else if (col === 'status') { vA = a.status_key; vB = b.status_key; }
        else { vA = a.id; vB = b.id; }

        if (typeof vA === 'number' && typeof vB === 'number') {
            return dir === 'asc' ? vA - vB : vB - vA;
        }
        return dir === 'asc' ? String(vA).localeCompare(String(vB), 'ar') : String(vB).localeCompare(String(vA), 'ar');
    });

    // 3. Paginate
    const totalMatching = filtered.length;
    const pageSize = InstallmentsTableState.pageSize;
    const totalPages = Math.ceil(totalMatching / pageSize) || 1;
    if (InstallmentsTableState.page > totalPages) InstallmentsTableState.page = totalPages;
    if (InstallmentsTableState.page < 1) InstallmentsTableState.page = 1;

    const startIdx = (InstallmentsTableState.page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalMatching);
    const pagedList = filtered.slice(startIdx, endIdx);

    // 4. Update Summary Label
    if (countLabel) {
        if (totalMatching === 0) {
            countLabel.textContent = `لا توجد عقود مطابقة`;
        } else if (totalMatching === installmentsDataCache.summary.total_contracts) {
            countLabel.textContent = `عرض (${startIdx + 1} إلى ${endIdx}) من أصل (${totalMatching}) عقد تقسيط (صفحة ${InstallmentsTableState.page} من ${totalPages})`;
        } else {
            countLabel.textContent = `عرض (${startIdx + 1} إلى ${endIdx}) من (${totalMatching}) نتيجة مطابقة (إجمالي العقود: ${installmentsDataCache.summary.total_contracts}) (صفحة ${InstallmentsTableState.page} من ${totalPages})`;
        }
    }

    // 5. Render Pagination Controls
    if (paginationControls) {
        paginationControls.innerHTML = '';
        if (totalPages > 1) {
            const isFirst = InstallmentsTableState.page === 1;
            paginationControls.innerHTML += `
                <button type="button" class="btn btn-secondary" onclick="setInstallmentsPage(1)" ${isFirst ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة الأولى">«</button>
                <button type="button" class="btn btn-secondary" onclick="setInstallmentsPage(${InstallmentsTableState.page - 1})" ${isFirst ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة السابقة">‹</button>
            `;

            const maxButtons = 5;
            let startPage = Math.max(1, InstallmentsTableState.page - 2);
            let endPage = Math.min(totalPages, startPage + maxButtons - 1);
            if (endPage - startPage < maxButtons - 1) {
                startPage = Math.max(1, endPage - maxButtons + 1);
            }

            for (let p = startPage; p <= endPage; p++) {
                const isActive = p === InstallmentsTableState.page;
                paginationControls.innerHTML += `
                    <button type="button" class="btn ${isActive ? 'btn-primary' : 'btn-secondary'}" onclick="setInstallmentsPage(${p})" style="padding:4px 10px; font-size:11px; font-weight:700; border-radius:6px; min-width:28px;">${p}</button>
                `;
            }

            const isLast = InstallmentsTableState.page === totalPages;
            paginationControls.innerHTML += `
                <button type="button" class="btn btn-secondary" onclick="setInstallmentsPage(${InstallmentsTableState.page + 1})" ${isLast ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة التالية">›</button>
                <button type="button" class="btn btn-secondary" onclick="setInstallmentsPage(${totalPages})" ${isLast ? 'disabled' : ''} style="padding:4px 8px; font-size:11px; border-radius:6px;" title="الصفحة الأخيرة">»</button>
            `;
        }
    }

    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (totalMatching === 0) {
        tableBody.innerHTML = `<tr><td colspan="14" style="text-align:center; padding:30px; color:var(--md-sys-color-on-surface-variant);">لا توجد عقود تقسيط مطابقة لمعايير البحث</td></tr>`;
        return;
    }

    pagedList.forEach((c) => {
        const isCompleted = c.status_key === 'COMPLETED';
        const badgeHtml = isCompleted
            ? `<span class="badge inmerchant" style="font-weight:800;"><i data-lucide="check-circle" style="width:12px;height:12px;vertical-align:middle;margin-left:4px;"></i> مسدد بالكامل ✅</span>`
            : `<span class="badge faulty" style="font-weight:800;"><i data-lucide="alert-triangle" style="width:12px;height:12px;vertical-align:middle;margin-left:4px;"></i> متأخر (${c.months_late} شهر) ⚠️</span>`;

        const rowHtml = `
            <tr>
                <td style="font-weight:bold; font-family:var(--font-en);">${c.id}</td>
                <td>
                    <a href="javascript:void(0)" onclick="openAssetTimeline('${c.pos_serial}')" style="font-family:var(--font-en); font-weight:800; color:var(--md-sys-color-primary); text-decoration:underline;" title="انقر لتتبع الماكينة">
                        ${c.pos_serial}
                    </a>
                    <span style="display:block; font-size:10px; color:var(--text-muted); font-family:var(--font-en);">${c.device_mfg} ${c.device_model}</span>
                </td>
                <td>
                    <strong>${c.merchant_name}</strong>
                    <span style="display:block; font-size:11px; color:var(--text-muted);">${c.merchant_code !== '-' ? `كود #${c.merchant_code}` : ''}</span>
                </td>
                <td><span style="font-size:12px;">${c.government || '-'}</span></td>
                <td><span class="badge instore" style="font-weight:700; font-family:var(--font-en);">${c.duration_months} شهور</span></td>
                <td style="font-family:var(--font-en); font-weight:600;">${Number(c.down_payment).toLocaleString('ar-EG')} جم</td>
                <td style="font-family:var(--font-en); font-weight:700; color:var(--md-sys-color-primary);">${Number(c.monthly_installment_price).toLocaleString('ar-EG')} جم</td>
                <td style="font-family:var(--font-en); font-weight:700;">${Number(c.final_unit_price).toLocaleString('ar-EG')} جم</td>
                <td style="font-family:var(--font-en); font-weight:800; color:var(--color-success); font-size:13px;">${c.paid_installments_count} من ${c.duration_months}</td>
                <td style="font-family:var(--font-en); font-weight:800; color:var(--color-success); font-size:13px;">${Number(c.total_paid).toLocaleString('ar-EG')} جم</td>
                <td style="font-family:var(--font-en); font-weight:700; color:${c.remaining_installments_count > 0 ? '#ef4444' : 'var(--color-success)'};">${c.remaining_installments_count} قسط</td>
                <td style="font-family:var(--font-en); font-weight:800; color:${c.remaining_amount > 0 ? '#ef4444' : 'var(--color-success)'}; font-size:13px;">${Number(c.remaining_amount).toLocaleString('ar-EG')} جم</td>
                <td>${badgeHtml}</td>
                <td>
                    <button type="button" class="btn btn-secondary" onclick="openAssetTimeline('${c.pos_serial}')" style="padding:4px 8px; font-size:11px; color:#60a5fa;" title="تتبع الأصل وتاريخ السداد">
                        <i data-lucide="history" style="width:12px; height:12px;"></i> تتبع
                    </button>
                </td>
            </tr>
        `;
        tableBody.insertAdjacentHTML('beforeend', rowHtml);
    });

    refreshIcons();
}

function exportInstallmentsToExcel() {
    if (!installmentsDataCache || !installmentsDataCache.contracts) {
        alert("لا توجد بيانات متاحة للتصدير");
        return;
    }

    const searchVal = document.getElementById('inst-table-search-input')?.value.trim().toLowerCase() || '';
    const statusVal = document.getElementById('inst-table-status-filter')?.value || 'all';
    const durationVal = document.getElementById('inst-table-duration-filter')?.value || 'all';
    const govVal = document.getElementById('inst-table-gov-filter')?.value || 'all';

    let list = installmentsDataCache.contracts;
    if (statusVal !== 'all') list = list.filter(c => c.status_key === statusVal);
    if (durationVal !== 'all') list = list.filter(c => String(c.duration_months) === durationVal);
    if (govVal !== 'all') list = list.filter(c => c.government === govVal);
    if (searchVal) {
        list = list.filter(c =>
            (c.pos_serial && c.pos_serial.toLowerCase().includes(searchVal)) ||
            (c.merchant_code && c.merchant_code.toLowerCase().includes(searchVal)) ||
            (c.merchant_name && c.merchant_name.toLowerCase().includes(searchVal)) ||
            (c.government && c.government.toLowerCase().includes(searchVal))
        );
    }

    const rows = list.map((c) => ({
        "م": c.id,
        "سيريال الماكينة (POS Serial)": c.pos_serial,
        "موديل الماكينة": `${c.device_mfg} ${c.device_model}`,
        "اسم العميل / المخبز": c.merchant_name,
        "كود المخبز": c.merchant_code,
        "الإدارة التموينية": c.government,
        "مدة القسط (شهور)": c.duration_months,
        "المقدم المدفوع (جم)": c.down_payment,
        "القسط الشهري (جم)": c.monthly_installment_price,
        "سعر الماكينة بدون فوائد": c.unit_price,
        "إجمالي القيمة بعد الفوائد (جم)": c.final_unit_price,
        "عدد الأقساط المسددة": c.paid_installments_count,
        "إجمالي المبالغ المسددة (مقدم + أقساط)": c.total_paid,
        "عدد الأقساط المتبقية": c.remaining_installments_count,
        "المبلغ المتبقي والمتأخر (جم)": c.remaining_amount,
        "موقف السداد": c.status_label,
        "عدد الشهور المتأخرة": c.months_late,
        "تاريخ آخر دفعة": c.last_payment_date
    }));

    if (window.XLSX) {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "سجل عقود الأقساط");
        XLSX.writeFile(wb, `سجل_عقود_أقساط_الماكينات_${new Date().toISOString().substring(0, 10)}.xlsx`);
    } else {
        const headers = Object.keys(rows[0]).join(",");
        const csvContent = "\uFEFF" + [headers, ...rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\r\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `سجل_عقود_أقساط_الماكينات_${new Date().toISOString().substring(0, 10)}.csv`;
        link.click();
    }
}

// ==========================================
// 5.5 SPARE PARTS INVENTORY & MOVEMENTS MODULE (Store_SP)
// ==========================================
let sparePartsDataCache = null;
let sparePartsListenersBound = false;

const SparePartsTableState = {
    page: 1,
    pageSize: 25,
    sortCol: 'date',
    sortDir: 'desc'
};

async function loadSparePartsInventory() {
    const tableBody = document.getElementById('sp-movements-table-body');
    const refreshIcon = document.getElementById('icon-sp-refresh');
    if (refreshIcon) refreshIcon.classList.add('spin-animation');

    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="loader-2" class="spin-animation"></i> جاري تحميل حركات ورصيد قطع الغيار...</td></tr>`;
        refreshIcons();
    }

    try {
        const dateFrom = document.getElementById('sp-date-from')?.value || '';
        const dateTo = document.getElementById('sp-date-to')?.value || '';
        const payStatus = document.getElementById('sp-payment-filter')?.value || 'all';
        const partType = document.getElementById('sp-type-filter')?.value || 'all';
        const search = document.getElementById('sp-search-input')?.value.trim() || '';

        const url = `/api/inventory/spare-parts-dashboard?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}&payment_status=${encodeURIComponent(payStatus)}&part_type=${encodeURIComponent(partType)}&search=${encodeURIComponent(search)}&limit=5000&offset=0`;

        const res = await fetch(url);
        const data = await res.json();

        if (!res.ok || !data.success) throw new Error(data.error || "فشل تحميل بيانات قطع الغيار");

        sparePartsDataCache = data;

        // 1. Populate KPI Cards
        const s = data.summary || {};
        const elInStock = document.getElementById('sp-kpi-in-stock');
        const elSubIn = document.getElementById('sp-kpi-sub-in');
        const elConsumed = document.getElementById('sp-kpi-consumed');
        const elSubTx = document.getElementById('sp-kpi-sub-total-tx');
        const elPaidAmt = document.getElementById('sp-kpi-paid-amount');
        const elSubPaid = document.getElementById('sp-kpi-sub-paid-pieces');
        const elFreeCount = document.getElementById('sp-kpi-free-count');
        const elSubFreeVal = document.getElementById('sp-kpi-sub-free-val');
        const elDeferredAmt = document.getElementById('sp-kpi-deferred-amount');
        const elSubDefPieces = document.getElementById('sp-kpi-sub-deferred-pieces');
        const elPaidRatio = document.getElementById('sp-kpi-paid-ratio');

        if (elInStock) elInStock.textContent = Number(s.current_stock_balance || 0).toLocaleString('ar-EG');
        if (elSubIn) elSubIn.textContent = Number(s.total_stock_in || 0).toLocaleString('ar-EG');
        if (elConsumed) elConsumed.textContent = Number(s.total_stock_out || 0).toLocaleString('ar-EG');
        if (elSubTx) elSubTx.textContent = Number(s.total_movements || 0).toLocaleString('ar-EG');
        if (elPaidAmt) elPaidAmt.textContent = Number(s.total_paid_amount || 0).toLocaleString('ar-EG') + ' جم';
        if (elSubPaid) elSubPaid.textContent = Number(s.total_paid_pieces || 0).toLocaleString('ar-EG') + ' قطعة';
        if (elFreeCount) elFreeCount.textContent = Number(s.total_free_pieces || 0).toLocaleString('ar-EG');
        if (elSubFreeVal) elSubFreeVal.textContent = Number(s.total_free_value_saved || 0).toLocaleString('ar-EG') + ' جم';
        if (elDeferredAmt) elDeferredAmt.textContent = Number(s.total_deferred_amount || 0).toLocaleString('ar-EG') + ' جم';
        if (elSubDefPieces) elSubDefPieces.textContent = Number(s.total_deferred_pieces || 0).toLocaleString('ar-EG');
        if (elPaidRatio) elPaidRatio.textContent = (s.paid_ratio_pct || 0) + '%';

        // 2. Render Column 1: Parts Aggregation Breakdown
        const partsListEl = document.getElementById('sp-parts-breakdown-list');
        const badgeCountEl = document.getElementById('sp-parts-count-badge');
        if (badgeCountEl && data.parts_breakdown) {
            badgeCountEl.textContent = `${data.parts_breakdown.length} نوع`;
        }

        if (partsListEl && data.parts_breakdown) {
            const maxPieces = Math.max(...data.parts_breakdown.map(p => Math.max(p.total_in, p.total_out)), 1);
            partsListEl.innerHTML = data.parts_breakdown.map(p => {
                const barPct = Math.min(100, Math.round((p.total_out / maxPieces) * 100));
                const isSelected = partType === p.part_name;
                return `
                    <div class="breakdown-item" style="cursor:pointer; padding:10px 14px; border-radius:10px; background:${isSelected ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container-low)'}; border:1px solid ${isSelected ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)'}; transition: all 0.15s ease;" onclick="filterSparePartsByType('${p.part_name}')" title="اضغط للتصفية وعرض حركات ${p.part_name}">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
                            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                <strong style="font-size:13px; color:var(--md-sys-color-on-surface); font-weight:800;">${p.part_name}</strong>
                                <span style="font-size:11px; color:var(--text-muted); font-family:var(--font-en); font-weight:600;">(${p.unit_price} جم)</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <span style="font-size:12px; font-weight:800; color:#10b981; font-family:var(--font-en); white-space:nowrap;">${Number(p.total_revenue).toLocaleString('ar-EG')} جم</span>
                                <span class="badge ${p.current_stock > 0 ? 'inmerchant' : 'faulty'}" style="font-size:10px; font-family:var(--font-en); font-weight:700; white-space:nowrap;">${p.current_stock} بالمخزن</span>
                            </div>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text-secondary); margin-bottom:6px; flex-wrap:wrap; gap:4px;">
                            <span>منصرف: <strong style="font-family:var(--font-en); color:#a855f7; font-weight:700;">${p.total_out}</strong> قطعة (${p.paid_count} بمقابل / ${p.free_count} مجاني)</span>
                            <span style="font-family:var(--font-en); font-weight:700; color:var(--md-sys-color-primary);">${p.consumption_rate_pct}% استهلاك</span>
                        </div>
                        <div style="height:5px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
                            <div style="width:${barPct}%; height:100%; border-radius:3px; background:linear-gradient(90deg, #38bdf8, #818cf8);"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 3. Populate Part Type Dropdown
        const typeSelect = document.getElementById('sp-type-filter');
        if (typeSelect && data.parts_breakdown && typeSelect.options.length <= 1) {
            const currentSelected = typeSelect.value;
            typeSelect.innerHTML = `<option value="all">كافة أنواع قطع الغيار (${data.parts_breakdown.length})</option>` +
                data.parts_breakdown.map(p => `<option value="${p.part_name}" ${currentSelected === p.part_name ? 'selected' : ''}>${p.part_name} (رصيد: ${p.current_stock})</option>`).join('');
        }

        // 4. Render Column 2: Financial Breakdown Card
        const finListEl = document.getElementById('sp-financial-breakdown-list');
        if (finListEl) {
            finListEl.innerHTML = `
                <div style="padding:12px 14px; border-radius:10px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); cursor:pointer;" onclick="filterSparePartsByStatus('PAID')">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:4px;">
                        <span style="font-size:12px; font-weight:700; color:#10b981;"><i data-lucide="check-circle" style="width:14px;height:14px;vertical-align:middle;"></i> مسدد بمقابل (إيصال إيداع):</span>
                        <strong style="font-size:14px; font-family:var(--font-en); color:#10b981; white-space:nowrap;">${Number(s.total_paid_amount || 0).toLocaleString('ar-EG')} جم</strong>
                    </div>
                    <span style="font-size:11px; color:var(--text-secondary);">عدد القطع المسددة بإيصالات إيداع: <strong>${Number(s.total_paid_pieces || 0).toLocaleString('ar-EG')}</strong> قطعة</span>
                </div>
                <div style="padding:12px 14px; border-radius:10px; background:rgba(6,182,212,0.08); border:1px solid rgba(6,182,212,0.25); cursor:pointer;" onclick="filterSparePartsByStatus('FREE')">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:4px;">
                        <span style="font-size:12px; font-weight:700; color:#06b6d4;"><i data-lucide="shield-check" style="width:14px;height:14px;vertical-align:middle;"></i> منصرف مجاني (بدون مقابل):</span>
                        <strong style="font-size:14px; font-family:var(--font-en); color:#06b6d4; white-space:nowrap;">${Number(s.total_free_value_saved || 0).toLocaleString('ar-EG')} جم</strong>
                    </div>
                    <span style="font-size:11px; color:var(--text-secondary);">عدد القطع المصروفة مجاناً: <strong>${Number(s.total_free_pieces || 0).toLocaleString('ar-EG')}</strong> قطعة</span>
                </div>
                <div style="padding:12px 14px; border-radius:10px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); cursor:pointer;" onclick="filterSparePartsByStatus('DEFERRED')">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:4px;">
                        <span style="font-size:12px; font-weight:700; color:#ef4444;"><i data-lucide="clock" style="width:14px;height:14px;vertical-align:middle;"></i> تحصيلات ومستحقات مؤجلة:</span>
                        <strong style="font-size:14px; font-family:var(--font-en); color:#ef4444; white-space:nowrap;">${Number(s.total_deferred_amount || 0).toLocaleString('ar-EG')} جم</strong>
                    </div>
                    <span style="font-size:11px; color:var(--text-secondary);">عدد القطع المؤجلة: <strong>${Number(s.total_deferred_pieces || 0).toLocaleString('ar-EG')}</strong> قطعة</span>
                </div>
                <div style="padding:10px 14px; border-radius:10px; background:var(--md-sys-color-surface-container-low); border:1px solid var(--md-sys-color-outline-variant);">
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; font-size:11px;">
                        <span style="color:var(--text-secondary);">إجمالي الحركات المفحوصة:</span>
                        <strong style="font-family:var(--font-en); color:var(--md-sys-color-primary); white-space:nowrap;">${Number(s.filtered_movements_count || 0).toLocaleString('ar-EG')} حركة</strong>
                    </div>
                </div>
            `;
        }

        // 5. Render Column 3: Governments Breakdown Card
        const govListEl = document.getElementById('sp-tech-breakdown-list');
        if (govListEl && data.governments_breakdown) {
            const maxGovPieces = data.governments_breakdown.length > 0 ? Math.max(...data.governments_breakdown.map(g => g.pieces)) : 1;
            govListEl.innerHTML = data.governments_breakdown.map(g => {
                const gPct = Math.round((g.pieces / maxGovPieces) * 100);
                return `
                    <div class="breakdown-item" style="padding:8px 12px; border-radius:8px; background:var(--md-sys-color-surface-container-low); border:1px solid var(--md-sys-color-outline-variant); cursor:pointer;" onclick="filterSparePartsBySearch('${g.name}')">
                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; margin-bottom:4px; flex-wrap:wrap; gap:6px;">
                            <span style="font-weight:700; color:var(--md-sys-color-on-surface);"><i data-lucide="map-pin" style="width:12px;height:12px;vertical-align:middle;color:#f59e0b;"></i> ${g.name}</span>
                            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                                <strong style="font-family:var(--font-en); font-size:12px; color:#10b981; white-space:nowrap;">${Number(g.amount || 0).toLocaleString('ar-EG')} جم</strong>
                                <span class="badge inmerchant" style="font-family:var(--font-en); font-size:10px; font-weight:700; white-space:nowrap;">${g.pieces} قطعة</span>
                            </div>
                        </div>
                        <div style="height:5px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
                            <div style="width:${gPct}%; height:100%; border-radius:3px; background:linear-gradient(90deg, #f59e0b, #eab308);"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 6. Render Movements Table
        renderSparePartsTable();

        // 7. Bind Listeners once
        if (!sparePartsListenersBound) {
            document.getElementById('sp-search-input')?.addEventListener('input', () => {
                SparePartsTableState.page = 1;
                loadSparePartsInventory();
            });
            document.getElementById('sp-payment-filter')?.addEventListener('change', () => {
                SparePartsTableState.page = 1;
                loadSparePartsInventory();
            });
            document.getElementById('sp-type-filter')?.addEventListener('change', () => {
                SparePartsTableState.page = 1;
                loadSparePartsInventory();
            });
            document.getElementById('sp-date-from')?.addEventListener('change', () => {
                SparePartsTableState.page = 1;
                loadSparePartsInventory();
            });
            document.getElementById('sp-date-to')?.addEventListener('change', () => {
                SparePartsTableState.page = 1;
                loadSparePartsInventory();
            });
            document.getElementById('sp-page-size-select')?.addEventListener('change', (e) => {
                SparePartsTableState.pageSize = e.target.value === 'all' ? 99999 : parseInt(e.target.value, 10);
                SparePartsTableState.page = 1;
                renderSparePartsTable();
            });

            // Quick Date Buttons via UniversalDateEngine
            document.getElementById('btn-sp-date-today')?.addEventListener('click', () => setSparePartsQuickDate('today'));
            document.getElementById('btn-sp-date-yesterday')?.addEventListener('click', () => setSparePartsQuickDate('yesterday'));
            document.getElementById('btn-sp-date-week')?.addEventListener('click', () => setSparePartsQuickDate('week'));
            document.getElementById('btn-sp-date-month')?.addEventListener('click', () => setSparePartsQuickDate('month'));
            document.getElementById('btn-sp-date-all')?.addEventListener('click', () => setSparePartsQuickDate('all'));

            document.getElementById('btn-sp-refresh')?.addEventListener('click', () => loadSparePartsInventory());
            document.getElementById('btn-export-sp-excel')?.addEventListener('click', exportSparePartsToExcel);

            sparePartsListenersBound = true;
        }

        refreshIcons();
    } catch (err) {
        console.error("Spare Parts Dashboard Load Error:", err);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:var(--color-critical); padding:30px;">خطأ: ${err.message}</td></tr>`;
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('spin-animation');
    }
}

function setSparePartsQuickDate(preset) {
    UniversalDateEngine.setQuickDate('sp', preset, () => {
        SparePartsTableState.page = 1;
        loadSparePartsInventory();
    });
}

function filterSparePartsByType(partName) {
    const typeSelect = document.getElementById('sp-type-filter');
    if (typeSelect) {
        typeSelect.value = (typeSelect.value === partName) ? 'all' : partName;
    }
    SparePartsTableState.page = 1;
    loadSparePartsInventory();
    const tableEl = document.getElementById('sp-movements-table');
    if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.filterSparePartsByType = filterSparePartsByType;

function filterSparePartsByStatus(statusKey) {
    const paySelect = document.getElementById('sp-payment-filter');
    if (paySelect) {
        paySelect.value = (paySelect.value === statusKey) ? 'all' : statusKey;
    }
    SparePartsTableState.page = 1;
    loadSparePartsInventory();
    const tableEl = document.getElementById('sp-movements-table');
    if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.filterSparePartsByStatus = filterSparePartsByStatus;

function filterSparePartsBySearch(term) {
    const searchInput = document.getElementById('sp-search-input');
    if (searchInput) {
        searchInput.value = term;
    }
    SparePartsTableState.page = 1;
    loadSparePartsInventory();
    const tableEl = document.getElementById('sp-movements-table');
    if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.filterSparePartsBySearch = filterSparePartsBySearch;

function sortSparePartsTable(key) {
    if (SparePartsTableState.sortKey === key) {
        SparePartsTableState.sortDir = SparePartsTableState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        SparePartsTableState.sortKey = key;
        SparePartsTableState.sortDir = (key === 'total_amount' || key === 'quantity' || key === 'timestamp') ? 'desc' : 'asc';
    }

    // Update Header Sort Icons
    const allSortIcons = document.querySelectorAll('#sp-movements-table .sort-icon');
    allSortIcons.forEach(icon => icon.textContent = '⬍');
    const currentIcon = document.getElementById(`sp-sort-${key}`);
    if (currentIcon) {
        currentIcon.textContent = SparePartsTableState.sortDir === 'asc' ? '▲' : '▼';
    }

    if (sparePartsDataCache && sparePartsDataCache.movements) {
        sparePartsDataCache.movements.sort((a, b) => {
            let valA = a[key];
            let valB = b[key];
            if (valA === undefined || valA === null) valA = '';
            if (valB === undefined || valB === null) valB = '';

            if (typeof valA === 'number' && typeof valB === 'number') {
                return SparePartsTableState.sortDir === 'asc' ? valA - valB : valB - valA;
            }

            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();
            return SparePartsTableState.sortDir === 'asc' ? strA.localeCompare(strB, 'ar') : strB.localeCompare(strA, 'ar');
        });
    }

    renderSparePartsTable();
}
window.sortSparePartsTable = sortSparePartsTable;

function renderSparePartsTable() {
    if (!sparePartsDataCache || !sparePartsDataCache.movements) return;

    const tableBody = document.getElementById('sp-movements-table-body');
    const countLabel = document.getElementById('sp-table-count-label');
    const totalCountBadge = document.getElementById('sp-table-total-count');
    const paginationControls = document.getElementById('sp-pagination-controls');

    let list = [...sparePartsDataCache.movements];

    if (totalCountBadge) {
        totalCountBadge.textContent = `${list.length.toLocaleString('ar-EG')} حركة مطابقة`;
    }

    const pageSize = SparePartsTableState.pageSize;
    const totalMatching = list.length;
    const totalPages = Math.ceil(totalMatching / pageSize) || 1;
    if (SparePartsTableState.page > totalPages) SparePartsTableState.page = totalPages;
    if (SparePartsTableState.page < 1) SparePartsTableState.page = 1;

    const startIdx = (SparePartsTableState.page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalMatching);
    const pagedList = list.slice(startIdx, endIdx);

    if (countLabel) {
        countLabel.textContent = totalMatching === 0 
            ? `لا توجد حركات مطابقة` 
            : `عرض (${startIdx + 1} إلى ${endIdx}) من أصل (${totalMatching}) حركة (صفحة ${SparePartsTableState.page} من ${totalPages})`;
    }

    if (paginationControls) {
        paginationControls.innerHTML = `
            <button type="button" class="btn btn-secondary" id="btn-sp-first" ${SparePartsTableState.page === 1 ? 'disabled' : ''} style="padding:4px 8px; font-size:11px;">الأولى</button>
            <button type="button" class="btn btn-secondary" id="btn-sp-prev" ${SparePartsTableState.page === 1 ? 'disabled' : ''} style="padding:4px 8px; font-size:11px;">السابق</button>
            <span style="font-family:var(--font-en); font-weight:700; font-size:12px; margin:0 4px;">${SparePartsTableState.page} / ${totalPages}</span>
            <button type="button" class="btn btn-secondary" id="btn-sp-next" ${SparePartsTableState.page >= totalPages ? 'disabled' : ''} style="padding:4px 8px; font-size:11px;">التالي</button>
            <button type="button" class="btn btn-secondary" id="btn-sp-last" ${SparePartsTableState.page >= totalPages ? 'disabled' : ''} style="padding:4px 8px; font-size:11px;">الأخيرة</button>
        `;

        document.getElementById('btn-sp-first')?.addEventListener('click', () => { SparePartsTableState.page = 1; renderSparePartsTable(); });
        document.getElementById('btn-sp-prev')?.addEventListener('click', () => { if (SparePartsTableState.page > 1) { SparePartsTableState.page--; renderSparePartsTable(); } });
        document.getElementById('btn-sp-next')?.addEventListener('click', () => { if (SparePartsTableState.page < totalPages) { SparePartsTableState.page++; renderSparePartsTable(); } });
        document.getElementById('btn-sp-last')?.addEventListener('click', () => { SparePartsTableState.page = totalPages; renderSparePartsTable(); });
    }

    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (pagedList.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:35px; color:var(--text-muted);">لا توجد حركات مطابقة لمعايير البحث والتاريخ المحددة.</td></tr>`;
        refreshIcons();
        return;
    }

    pagedList.forEach((m, idx) => {
        let badgeHtml = '';
        if (m.payment_status_key === 'FREE_WARRANTY') {
            badgeHtml = `<span class="badge" style="background:rgba(6,182,212,0.15); color:#06b6d4; border:1px solid rgba(6,182,212,0.3); font-weight:700;"><i data-lucide="shield-check" style="width:11px;height:11px;vertical-align:middle;margin-left:4px;"></i> مجاني (بدون مقابل)</span>`;
        } else if (m.payment_status_key === 'DEFERRED_PENDING') {
            badgeHtml = `<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); font-weight:700;"><i data-lucide="clock" style="width:11px;height:11px;vertical-align:middle;margin-left:4px;"></i> تحصيلات مؤجلة ⚠️</span>`;
        } else if (m.payment_status_key === 'STOCK_IN') {
            badgeHtml = `<span class="badge instore" style="font-weight:700;"><i data-lucide="download" style="width:11px;height:11px;vertical-align:middle;margin-left:4px;"></i> توريد وارد</span>`;
        } else {
            badgeHtml = `<span class="badge inmerchant" style="font-weight:700;"><i data-lucide="check-circle" style="width:11px;height:11px;vertical-align:middle;margin-left:4px;"></i> مسدد بمقابل ✅</span>`;
        }

        let channelBadge = '';
        if (m.receipt_number && m.receipt_number !== '-') {
            const chName = m.payment_channel || 'ضامن';
            const chBadgeClass = chName.includes('ضامن') ? 'inmerchant' : (chName.includes('بريد') ? 'instore' : 'warning');
            const chIcon = chName.includes('ضامن') ? 'check-circle' : (chName.includes('بريد') ? 'mail' : 'landmark');
            channelBadge = `
                <div style="display:flex; flex-direction:column; gap:3px;">
                    <span style="font-family:var(--font-en); font-weight:800; color:var(--color-success); font-size:12px;">${m.receipt_number}</span>
                    <span class="badge ${chBadgeClass}" style="font-weight:700; font-size:10px; width:fit-content; padding:2px 8px;">
                        <i data-lucide="${chIcon}" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> ${chName}
                    </span>
                </div>
            `;
        } else if (m.payment_status_key === 'FREE_WARRANTY') {
            channelBadge = `<span class="badge" style="background:rgba(6,182,212,0.12); color:#06b6d4; border:1px solid rgba(6,182,212,0.25); font-size:10px; font-weight:700;"><i data-lucide="shield-check" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> صيانة مجانية</span>`;
        } else if (m.payment_status_key === 'DEFERRED_PENDING') {
            channelBadge = `<span class="badge" style="background:rgba(239,68,68,0.12); color:#ef4444; border:1px solid rgba(239,68,68,0.25); font-size:10px; font-weight:700;"><i data-lucide="clock" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> تحصيل مؤجل</span>`;
        } else if (m.is_stock_in) {
            channelBadge = `<span class="badge instore" style="font-size:10px; font-weight:700;"><i data-lucide="download" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> توريد مخزن</span>`;
        } else {
            channelBadge = `<span style="color:var(--text-muted);">-</span>`;
        }

        const serialLink = m.pos_serial && m.pos_serial !== '-' 
            ? `<a href="javascript:void(0)" onclick="openAssetTimeline('${m.pos_serial}')" style="font-family:var(--font-en); font-weight:800; color:var(--color-primary); text-decoration:underline;">${m.pos_serial}</a>`
            : '<span style="color:var(--text-muted);">-</span>';

        const rowHtml = `
            <tr>
                <td style="font-family:var(--font-en); color:var(--text-muted); font-size:12px;">${startIdx + idx + 1}</td>
                <td>${formatDateTimeCell(m.date)}</td>
                <td><strong style="color:var(--md-sys-color-primary); font-size:13px;">${m.part_name}</strong></td>
                <td>
                    <span class="badge ${m.is_stock_in ? 'instore' : 'inmerchant'}" style="font-family:var(--font-en); font-size:11px; font-weight:700;">
                        ${m.quantity} قطعة (${m.movement_type})
                    </span>
                </td>
                <td>${serialLink}</td>
                <td>
                    <div>
                        <strong style="font-size:13px; color:var(--md-sys-color-on-surface);">${m.merchant_name}</strong>
                        <span style="display:block; font-size:11px; color:var(--text-muted); font-family:var(--font-en);">${m.merchant_code && m.merchant_code !== '-' ? `كود #${m.merchant_code}` : ''}</span>
                    </div>
                </td>
                <td>
                    <span class="badge inmerchant" style="font-size:11px; font-weight:600;">${m.government || '-'}</span>
                </td>
                <td>${badgeHtml}</td>
                <td>${channelBadge}</td>
                <td style="font-family:var(--font-en); font-weight:800; color:${m.payment_status_key === 'DEFERRED_PENDING' ? '#ef4444' : '#10b981'}; font-size:13px;">
                    ${Number(m.total_amount).toLocaleString('ar-EG')} جم
                </td>
                <td>
                    <button type="button" class="btn btn-secondary" onclick="openAssetTimeline('${m.pos_serial !== '-' ? m.pos_serial : (m.merchant_code !== '-' ? m.merchant_code : m.part_name)}')" style="padding:4px 8px; font-size:11px; color:#60a5fa;" title="تتبع الأصل وتاريخ الصيانة">
                        <i data-lucide="history" style="width:12px; height:12px;"></i> تتبع
                    </button>
                </td>
            </tr>
        `;
        tableBody.insertAdjacentHTML('beforeend', rowHtml);
    });

    refreshIcons();
}

function exportSparePartsToExcel() {
    if (!sparePartsDataCache || !sparePartsDataCache.movements) {
        alert("لا توجد بيانات متاحة للتصدير");
        return;
    }

    const list = sparePartsDataCache.movements;
    const rows = list.map((m, idx) => ({
        "م": idx + 1,
        "تاريخ ووقت الحركة": formatDateDDMMYYYY(m.date, true),
        "نوع قطعة الغيار": m.part_name,
        "نوع الحركة": m.movement_type,
        "الكمية": m.quantity,
        "سيريال الماكينة (POS)": m.pos_serial,
        "اسم المخبز / العميل": m.merchant_name,
        "كود المخبز": m.merchant_code,
        "الإدارة التموينية": m.government,
        "حالة السداد والمقابل": m.payment_status_label,
        "جهة وقناة الدفع": m.payment_channel,
        "رقم الإيصال": m.receipt_number,
        "سعر القطعة (جم)": m.unit_price,
        "إجمالي القيمة المالية (جم)": m.total_amount,
        "ملاحظات": m.notes
    }));

    const dateFrom = document.getElementById('sp-date-from')?.value || 'البداية';
    const dateTo = document.getElementById('sp-date-to')?.value || 'اليوم';

    if (window.XLSX) {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "حركات ورصيد قطع الغيار");
        XLSX.writeFile(wb, `تقرير_مخزن_وقطع_الغيار_${dateFrom}_إلى_${dateTo}.xlsx`);
    } else {
        const headers = Object.keys(rows[0]).join(",");
        const csvContent = "\uFEFF" + [headers, ...rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\r\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `تقرير_مخزن_وقطع_الغيار_${dateFrom}_إلى_${dateTo}.csv`;
        link.click();
    }
}

// ==========================================
// 6. SYNC & CHANGE TRACKING MONITOR MODULE

// ==========================================
async function loadSyncMonitor() {
    try {
        const syncRes = await fetch('/api/sync/status');
        if (syncRes.ok) {
            const data = await syncRes.json();
            const lastSync = data.lastSyncTime ? formatCairoDateTime(data.lastSyncTime) : 'لم تتم بعد';
            
            const badge = document.getElementById('monitor-sync-status-badge');
            if (badge) {
                badge.className = data.status === 'error' ? 'badge faulty' : 'sync-db-badge';
                badge.innerHTML = `<i data-lucide="${data.status === 'error' ? 'alert-circle' : 'check-circle'}"></i> ${data.status === 'error' ? 'تنبيه اتصال' : 'متصلة ومحدثة'}`;
            }

            const timeEl = document.getElementById('monitor-last-sync-time');
            if (timeEl) timeEl.innerHTML = lastSync;

            const recEl = document.getElementById('monitor-total-records-count');
            if (recEl && data.totalRecords) recEl.textContent = Number(data.totalRecords).toLocaleString('ar-EG') + ' سجل';
        }

        await fetchAndRenderAuditLogs();
        refreshIcons();
    } catch (err) {
        console.error("Error rendering sync monitor:", err);
    }
}

async function fetchAndRenderAuditLogs() {
    const tbody = document.getElementById('audit-logs-body');
    if (!tbody) return;

    const page = AppState.audit.currentPage;
    const pageSize = AppState.audit.pageSize;

    const tableName = document.getElementById('audit-table-filter')?.value || 'all';
    const changeType = document.getElementById('audit-type-filter')?.value || 'all';
    const search = document.getElementById('audit-search-input')?.value.trim() || '';

    const offset = (page - 1) * pageSize;
    const url = `/api/audit-logs?table_name=${encodeURIComponent(tableName)}&change_type=${encodeURIComponent(changeType)}&search=${encodeURIComponent(search)}&limit=${pageSize}&offset=${offset}`;

    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 25px; color: var(--text-muted);"><i data-lucide="loader-2" class="spin-animation" style="vertical-align:middle; margin-left:8px;"></i> جاري تحميل سجلات التغيير...</td></tr>`;
    refreshIcons();

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch logs");
        const data = await res.json();

        // Update counters
        let inserts = 0, updates = 0, deletes = 0;
        if (data.typeStats) {
            data.typeStats.forEach(t => {
                if (t.change_type === 'INSERT') inserts = t.count;
                if (t.change_type === 'UPDATE') updates = t.count;
                if (t.change_type === 'DELETE') deletes = t.count;
            });
        }
        document.getElementById('stat-audit-inserts').textContent = Number(inserts).toLocaleString('ar-EG');
        document.getElementById('stat-audit-updates').textContent = Number(updates).toLocaleString('ar-EG');
        document.getElementById('stat-audit-deletes').textContent = Number(deletes).toLocaleString('ar-EG');

        tbody.innerHTML = '';
        if (!data.logs || data.logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 30px; color: var(--text-muted);">لا توجد سجلات تغيير مطابقة</td></tr>`;
            return;
        }

        data.logs.forEach((log, idx) => {
            const tr = document.createElement('tr');
            const typeBadgeClass = log.change_type === 'INSERT' ? 'insert' : log.change_type === 'UPDATE' ? 'update' : 'delete';
            const typeLabel = log.change_type === 'INSERT' ? 'إضافة (+)' : log.change_type === 'UPDATE' ? 'تعديل (~)' : 'حذف (-)';
            const time = formatCairoDateTime(log.timestamp);

            const cleanRecordId = formatAuditRecordId(log.table_name, log.record_id);
            const cleanSummary = formatAuditSummary(log);

            tr.innerHTML = `
                <td style="font-family: var(--font-en);">${offset + idx + 1}</td>
                <td style="font-family: var(--font-en); white-space: nowrap;">${time}</td>
                <td><strong style="color: var(--color-primary); font-family: var(--font-en);">${log.table_name}</strong></td>
                <td><span class="change-type-badge ${typeBadgeClass}">${typeLabel}</span></td>
                <td><code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-family: var(--font-en); font-weight:700; font-size:11px;" title="${log.record_id || ''}">${cleanRecordId}</code></td>
                <td style="max-width: 320px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${cleanSummary}">${cleanSummary}</td>
                <td>
                    <button type="button" class="btn btn-secondary" onclick="openDiffViewerModal(${log.id})" style="padding: 4px 10px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
                        <i data-lucide="git-compare" style="width:12px;height:12px;"></i> معاينة الفروقات
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Pagination
        const totalPages = Math.ceil(data.total / pageSize) || 1;
        document.getElementById('audit-page-info').textContent = `الصفحة ${page} من ${totalPages} (إجمالي ${data.total.toLocaleString('ar-EG')} عملية)`;
        document.getElementById('btn-audit-prev-page').disabled = page <= 1;
        document.getElementById('btn-audit-next-page').disabled = page >= totalPages;

        refreshIcons();
    } catch (err) {
        console.error("Audit log error:", err);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--color-critical); padding: 25px;">خطأ: ${err.message}</td></tr>`;
    }
}

function formatAuditRecordId(tableName, recordId) {
    if (!recordId || recordId === '-') return '-';
    if (!recordId.includes('|')) return recordId;

    const parts = recordId.split('|').map(p => p.trim()).filter(Boolean);
    if (tableName === 'store_sp_raw' || tableName === 'store_sp_maintenance_raw') {
        const rawFirst = parts[0] || '';
        const rMatch = rawFirst.match(/(\d{10,})/);
        const posMatch = recordId.match(/\b(3H\d+|S\d+|[A-Z0-9]{8,10})\b/);
        
        let label = rMatch ? `#${rMatch[1]}` : (rawFirst.includes('مجاني') ? 'صرف مجاني' : rawFirst.split('-')[0].trim());
        const partName = parts[1] || '';
        const posSerial = posMatch ? ` • ${posMatch[1]}` : '';

        return `${label}${partName ? ` (${partName})` : ''}${posSerial}`;
    }
    return parts.slice(0, 2).join(' - ');
}

function formatAuditSummary(log) {
    if (!log) return '-';
    let summary = log.summary || '';
    if (summary.includes('إضافة سجل جديد بالمعرف:')) {
        const cleanId = formatAuditRecordId(log.table_name, log.record_id);
        return `إضافة سجل جديد (${cleanId})`;
    }
    if (summary.includes('|')) {
        summary = summary.split('|')[0].trim();
    }
    return summary;
}

async function openDiffViewerModal(logId) {
    const modal = document.getElementById('modal-diff-viewer');
    if (!modal) return;

    modal.classList.add('active');
    document.getElementById('diff-modal-table').textContent = 'جاري التحميل...';
    document.getElementById('diff-modal-record-id').textContent = '...';
    document.getElementById('diff-modal-time').textContent = '...';
    document.getElementById('diff-modal-summary-text').textContent = 'جاري جلب تفاصيل السجل...';
    document.getElementById('diff-old-content').innerHTML = `<div style="text-align:center; padding:15px;"><i data-lucide="loader-2" class="spin-animation"></i></div>`;
    document.getElementById('diff-new-content').innerHTML = `<div style="text-align:center; padding:15px;"><i data-lucide="loader-2" class="spin-animation"></i></div>`;
    refreshIcons();

    try {
        const res = await fetch(`/api/audit-logs/${logId}`);
        if (!res.ok) throw new Error("Log not found");
        const { log } = await res.json();

        // Format Cairo Local Time DD-MM-YYYY
        let formattedTime = formatDateDDMMYYYY(log.timestamp, true);

        document.getElementById('diff-modal-table').textContent = log.table_name;
        document.getElementById('diff-modal-record-id').textContent = formatAuditRecordId(log.table_name, log.record_id);
        document.getElementById('diff-modal-time').textContent = formattedTime;
        document.getElementById('diff-modal-summary-text').textContent = formatAuditSummary(log);

        const typeBadge = document.getElementById('diff-modal-type');
        const typeBadgeClass = log.change_type === 'INSERT' ? 'insert' : log.change_type === 'UPDATE' ? 'update' : 'delete';
        typeBadge.className = `change-type-badge ${typeBadgeClass}`;
        typeBadge.textContent = log.change_type === 'INSERT' ? 'إضافة (INSERT)' : log.change_type === 'UPDATE' ? 'تعديل (UPDATE)' : 'حذف (DELETE)';

        const oldData = log.old_data_parsed || {};
        const newData = log.new_data_parsed || {};
        const allKeys = Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)]));

        let oldHtml = '';
        let newHtml = '';

        if (log.change_type === 'INSERT') {
            oldHtml = `<p style="color:var(--text-muted); font-style:italic; padding:10px;">لا توجد بيانات سابقة (سجل جديد).</p>`;
            allKeys.forEach(k => {
                let val = newData[k] !== undefined && newData[k] !== null ? String(newData[k]) : '-';
                if (/date|time/i.test(k) && val !== '-') val = formatDateDDMMYYYY(val, true);
                newHtml += `<div class="diff-field-row changed"><strong>${k}:</strong><span>${val}</span></div>`;
            });
        } else if (log.change_type === 'DELETE') {
            newHtml = `<p style="color:var(--text-muted); font-style:italic; padding:10px;">تم حذف السجل من قاعدة البيانات.</p>`;
            allKeys.forEach(k => {
                let val = oldData[k] !== undefined && oldData[k] !== null ? String(oldData[k]) : '-';
                if (/date|time/i.test(k) && val !== '-') val = formatDateDDMMYYYY(val, true);
                oldHtml += `<div class="diff-field-row changed"><strong>${k}:</strong><span>${val}</span></div>`;
            });
        } else {
            allKeys.forEach(k => {
                let oldVal = oldData[k] !== undefined && oldData[k] !== null ? String(oldData[k]) : '';
                let newVal = newData[k] !== undefined && newData[k] !== null ? String(newData[k]) : '';
                const isChanged = oldVal !== newVal;
                if (/date|time/i.test(k)) {
                    if (oldVal) oldVal = formatDateDDMMYYYY(oldVal, true);
                    if (newVal) newVal = formatDateDDMMYYYY(newVal, true);
                }
                oldHtml += `<div class="diff-field-row ${isChanged ? 'changed' : ''}"><strong>${k}:</strong><span>${oldVal || '<i style="color:var(--text-muted);">فارغ</i>'}</span></div>`;
                newHtml += `<div class="diff-field-row ${isChanged ? 'changed' : ''}"><strong>${k}:</strong><span>${newVal || '<i style="color:var(--text-muted);">فارغ</i>'}</span></div>`;
            });
        }

        document.getElementById('diff-old-content').innerHTML = oldHtml || '<p style="padding:10px;">لا توجد بيانات</p>';
        document.getElementById('diff-new-content').innerHTML = newHtml || '<p style="padding:10px;">لا توجد بيانات</p>';
        refreshIcons();
    } catch (err) {
        alert("خطأ أثناء استرجاع تفاصيل التغيير: " + err.message);
    }
}
window.openDiffViewerModal = openDiffViewerModal;

// ==========================================
// 8. DATA EXPLORER MODULE
// ==========================================
function loadDataExplorer() {
    fetchDataExplorerTable();
}

function renderExplorerTableRows() {
    const thead = document.getElementById('explorer-table-head');
    const tbody = document.getElementById('explorer-table-body');
    const cols = AppState.explorer.columns || [];

    if (thead) {
        thead.innerHTML = `<tr>${cols.map(c => {
            const isSorted = AppState.explorer.sortBy === c;
            const iconName = isSorted ? (AppState.explorer.sortOrder === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down';
            const activeClass = isSorted ? 'sortable active-sort' : 'sortable';
            return `<th class="${activeClass}" onclick="toggleExplorerSort('${c}')" title="انقر للفرز والترتيب حسب: ${c}">
                <span class="sort-icon"><i data-lucide="${iconName}" style="width:12px;height:12px;"></i></span>
                ${c}
            </th>`;
        }).join('')}</tr>`;
    }

    if (tbody) {
        let rows = AppState.explorer.rows || [];
        if (AppState.explorer.sortBy) {
            rows = sortRows(rows, AppState.explorer.sortBy, AppState.explorer.sortOrder);
        }

        tbody.innerHTML = '';
        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${cols.length || 1}" style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد سجلات مطابقة</td></tr>`;
            refreshIcons();
            return;
        }

        rows.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = cols.map(c => {
                let val = row[c];
                if (val !== null && val !== undefined) {
                    if (/date|time/i.test(c)) {
                        val = formatDateDDMMYYYY(val, true, true);
                    } else {
                        val = String(val);
                    }
                } else {
                    val = '-';
                }
                return `<td>${val}</td>`;
            }).join('');
            tbody.appendChild(tr);
        });
    }

    refreshIcons();
}

function toggleExplorerSort(col) {
    if (AppState.explorer.sortBy === col) {
        AppState.explorer.sortOrder = AppState.explorer.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        AppState.explorer.sortBy = col;
        AppState.explorer.sortOrder = 'asc';
    }
    renderExplorerTableRows();
}
window.toggleExplorerSort = toggleExplorerSort;

async function fetchDataExplorerTable() {
    const tableSelect = document.getElementById('explorer-table-select');
    const tableTitle = document.getElementById('explorer-table-title');
    const thead = document.getElementById('explorer-table-head');
    const tbody = document.getElementById('explorer-table-body');
    const searchInput = document.getElementById('explorer-search-input');
    if (!tableSelect || !thead || !tbody) return;

    const tableName = tableSelect.value;
    const page = AppState.explorer.currentPage;
    const pageSize = AppState.explorer.pageSize;
    const search = searchInput?.value.trim() || '';

    tableTitle.textContent = `بيانات الجدول: ${tableName}`;
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="loader-2" class="spin-animation"></i> جاري استعراض السجلات...</td></tr>`;
    refreshIcons();

    const offset = (page - 1) * pageSize;
    const url = `/api/explorer/${encodeURIComponent(tableName)}?search=${encodeURIComponent(search)}&limit=${pageSize}&offset=${offset}`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        document.getElementById('explorer-record-count').textContent = Number(data.total || 0).toLocaleString('ar-EG') + ' سجل';

        if (!data.rows || data.rows.length === 0) {
            thead.innerHTML = `<tr><th>الحالة</th></tr>`;
            tbody.innerHTML = `<tr><td style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد سجلات في هذا الجدول</td></tr>`;
            return;
        }

        AppState.explorer.columns = data.columns || Object.keys(data.rows[0]);
        AppState.explorer.rows = data.rows || [];

        renderExplorerTableRows();

        // Pagination
        const totalPages = Math.ceil(data.total / pageSize) || 1;
        document.getElementById('explorer-page-info').textContent = `الصفحة ${page} من ${totalPages} (إجمالي ${data.total.toLocaleString('ar-EG')} سجل)`;
        document.getElementById('btn-explorer-prev-page').disabled = page <= 1;
        document.getElementById('btn-explorer-next-page').disabled = page >= totalPages;

        refreshIcons();
    } catch (err) {
        console.error("Data Explorer error:", err);
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--color-critical); padding:20px;">خطأ في قراءة الجدول: ${err.message}</td></tr>`;
    }
}

// ==========================================
// 10. UNIVERSAL ASSET SEARCH & TIMELINE
// ==========================================
async function openAssetTimeline(query = '') {
    const modal = document.getElementById('modal-asset-timeline');
    const input = document.getElementById('timeline-search-input');
    if (modal) modal.classList.add('active');
    if (input && query) {
        input.value = query;
        searchAssetTimeline(query);
    }
    refreshIcons();
}

async function searchAssetTimeline(query) {
    const q = query || document.getElementById('timeline-search-input')?.value.trim();
    if (!q) return;

    const card = document.getElementById('timeline-asset-card');
    const container = document.getElementById('timeline-events-container');
    const hqContainer = document.getElementById('timeline-hq-container');
    const countAllEl = document.getElementById('tl-count-all');
    const countHqEl = document.getElementById('tl-count-hq');
    const btnTabAll = document.getElementById('btn-tl-tab-all');
    const btnTabHq = document.getElementById('btn-tl-tab-hq');

    if (container) container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="loader-2" class="spin-animation"></i> جاري البحث في كافة السجلات وتجميع التاريخ الزمني...</div>`;
    if (hqContainer) hqContainer.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="loader-2" class="spin-animation"></i> جاري فحص دورات الصيانة المركزية...</div>`;
    refreshIcons();

    // Reset sub-tab buttons
    if (btnTabAll) {
        btnTabAll.onclick = () => {
            btnTabAll.classList.add('active');
            if (btnTabHq) btnTabHq.classList.remove('active');
            if (container) container.style.display = 'block';
            if (hqContainer) hqContainer.style.display = 'none';
            refreshIcons();
        };
    }
    if (btnTabHq) {
        btnTabHq.onclick = () => {
            btnTabHq.classList.add('active');
            if (btnTabAll) btnTabAll.classList.remove('active');
            if (container) container.style.display = 'none';
            if (hqContainer) hqContainer.style.display = 'block';
            refreshIcons();
        };
    }

    // Default to general timeline tab
    if (btnTabAll) btnTabAll.classList.add('active');
    if (btnTabHq) btnTabHq.classList.remove('active');
    if (container) container.style.display = 'block';
    if (hqContainer) hqContainer.style.display = 'none';

    try {
        const res = await fetch(`/api/assets/timeline?query=${encodeURIComponent(q)}`);
        const data = await res.json();

        if (!res.ok || !data.success) throw new Error(data.error || "لم يتم العثور على نتائج");

        const dev = data.assetSummary.device;
        const sim = data.assetSummary.sim;
        const mer = data.assetSummary.merchant;

        if (card) {
            card.style.display = 'block';
            const merchantCodeVal = mer?.merchant_code || dev?.merchant_code || (q.length <= 6 && /^\d+$/.test(q) ? q : '-');
            const merchantCodeEl = document.getElementById('tl-merchant-code');
            if (merchantCodeEl) merchantCodeEl.textContent = merchantCodeVal;

            document.getElementById('tl-device-serial').textContent = dev?.serial || mer?.pos_serial || '-';
            document.getElementById('tl-device-model').textContent = dev?.model ? `${dev.model} (${dev.manufacturer || ''})` : (mer?.pos_model || '-');
            document.getElementById('tl-sim-serial').textContent = sim?.serial || mer?.sim_serial || dev?.sim_serial || '-';
            document.getElementById('tl-sim-carrier').textContent = sim?.carrier || mer?.sim_carrier || dev?.sim_carrier || 'Orange';
            document.getElementById('tl-merchant-name').textContent = mer?.name || dev?.merchant_name || (mer?.merchant_code ? `مخبز كود #${mer.merchant_code}` : '-');
            document.getElementById('tl-merchant-gov').textContent = mer?.government || dev?.government || 'محافظة غير محددة';
        }

        const events = data.timeline || [];
        const hqList = data.hqMaintenance || [];

        if (countAllEl) countAllEl.textContent = events.length;
        if (countHqEl) countHqEl.textContent = hqList.length;

        // 1. Render General Timeline Events
        if (events.length === 0) {
            if (container) container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="info"></i> لا توجد حركات أو صيانات مسجلة لهذا الأصل حتى الآن.</div>`;
        } else if (container) {
            container.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding:10px 16px; background:var(--md-sys-color-primary-container); border-radius:var(--md-shape-corner-medium); border:1px solid var(--md-sys-color-outline-variant);">
                    <span style="font-size:13px; font-weight:800; color:var(--color-primary);">سجل التاريخ الزمني وكافة بلاغات الصيانة:</span>
                    <span class="badge inmerchant" style="font-size:12px; font-weight:bold; font-family:var(--font-en);">${events.length} حركة وبلاغ مسجل</span>
                </div>
            `;
            events.forEach((ev, idx) => {
                const isBoardTrace = ev.title?.includes('مسارات') || ev.detail?.includes('مسارات') || ev.detail?.includes('مسار');
                const isHqMaint = ev.type === 'HQ_MAINTENANCE';
                const isBranchSp = ev.type === 'SPARE_PART_BRANCH' || ev.type === 'SPARE_PART';
                const isTransfer = ev.type === 'TRANSFER';
                const isPayment = ev.type === 'PAYMENT';

                let colorClass = 'var(--color-primary)';
                let iconName = ev.icon || 'activity';

                if (isBoardTrace) { colorClass = '#c084fc'; iconName = 'cpu'; }
                else if (isHqMaint) { colorClass = '#f59e0b'; iconName = 'wrench'; }
                else if (isBranchSp) { colorClass = '#06b6d4'; iconName = 'layers'; }
                else if (isTransfer) { colorClass = '#a855f7'; iconName = 'truck'; }
                else if (isPayment) { colorClass = '#10b981'; iconName = 'receipt'; }
                else if (ev.type === 'MAINTENANCE') { colorClass = '#38bdf8'; iconName = 'wrench'; }

                let codeToShow = ev.merchant_code;
                if (!codeToShow && ev.merchant && /^\d{4,6}$/.test(ev.merchant)) codeToShow = ev.merchant;
                if (!codeToShow && mer?.merchant_code) codeToShow = mer.merchant_code;
                if (!codeToShow) codeToShow = '-';

                const nameToShow = ev.merchant_name || mer?.name || '';

                let costBadgeHtml = '';
                const isInitialMaint = (ev.action_type || '').includes('صيانة أولية') || (ev.title || '').includes('صيانة أولية') || ev.is_initial_maintenance;

                if (isInitialMaint) {
                    costBadgeHtml = `<span class="badge" style="background:rgba(14,165,233,0.15); color:#0284c7; border:1px solid rgba(14,165,233,0.3); font-size:10px; font-weight:700;"><i data-lucide="sparkles" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> صيانة أولية</span>`;
                } else if (ev.has_spare_part || ev.replaced_part) {
                    costBadgeHtml = `<span class="badge inmerchant" style="font-size:10px; font-weight:700;"><i data-lucide="cpu" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> استبدال قطع غيار</span>`;
                } else if (ev.type === 'MAINTENANCE') {
                    costBadgeHtml = `<span class="badge" style="background:rgba(100,116,139,0.15); color:#64748b; border:1px solid rgba(100,116,139,0.3); font-size:10px; font-weight:700;"><i data-lucide="wrench" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> صيانة بالفرع</span>`;
                }

                const item = document.createElement('div');
                item.className = 'timeline-item';
                item.innerHTML = `
                    <div style="width:36px; height:36px; border-radius:50%; background:var(--md-sys-color-surface-container); border:1.5px solid ${colorClass}; display:flex; align-items:center; justify-content:center; color:${colorClass}; flex-shrink:0;">
                        <i data-lucide="${iconName}" style="width:18px; height:18px;"></i>
                    </div>
                    <div style="flex:1;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
                            <div class="timeline-item-title" style="display:flex; align-items:center; flex-wrap:wrap; gap:6px;">
                                <span style="color:var(--text-muted); font-size:11px; font-family:var(--font-en); font-weight:700;">#${events.length - idx}</span>
                                ${isHqMaint ? '<span class="badge" style="background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); font-size:10px;"><i data-lucide="wrench" style="width:10px;height:10px;"></i> صيانة رئيسي (HQ)</span>' : ''}
                                ${isBranchSp ? '<span class="badge" style="background:rgba(6,182,212,0.15); color:#06b6d4; border:1px solid rgba(6,182,212,0.3); font-size:10px;"><i data-lucide="layers" style="width:10px;height:10px;"></i> صرف قطع غيار</span>' : ''}
                                ${isTransfer ? '<span class="badge" style="background:rgba(168,85,247,0.15); color:#a855f7; border:1px solid rgba(168,85,247,0.3); font-size:10px;"><i data-lucide="truck" style="width:10px;height:10px;"></i> نقل وتبديل</span>' : ''}
                                ${isPayment ? '<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); font-size:10px;"><i data-lucide="receipt" style="width:10px;height:10px;"></i> سداد مالي</span>' : ''}
                                ${isBoardTrace ? '<span class="badge" style="background:rgba(168,85,247,0.15); color:#a855f7; border:1px solid rgba(168,85,247,0.3); font-size:10px;"><i data-lucide="cpu" style="width:10px;height:10px;"></i> مسارات بوردة</span>' : ''}
                                ${costBadgeHtml}
                                <span style="font-weight:700; color:var(--text-primary);">${ev.title}</span>
                            </div>
                            <span class="timeline-item-date">${formatDateDDMMYYYY(ev.date, true, true)}</span>
                        </div>
                        <div class="timeline-item-detail">
                            <div style="display:flex; flex-direction:column; gap:4px; font-size:12px; line-height:1.6;">
                                ${ev.complaint ? `<div style="color:var(--text-secondary);"><strong style="color:var(--text-primary);"><i data-lucide="alert-circle" style="width:12px;height:12px;vertical-align:middle;margin-left:3px;color:#f59e0b;"></i> الشكوى:</strong> ${ev.complaint}</div>` : ''}
                                ${ev.resolution ? `<div style="color:var(--text-secondary);"><strong style="color:var(--text-primary);"><i data-lucide="wrench" style="width:12px;height:12px;vertical-align:middle;margin-left:3px;color:#0284c7;"></i> الإجراء الفني:</strong> ${ev.resolution}</div>` : ''}
                                ${!ev.complaint && !ev.resolution && ev.detail ? `<div>${ev.detail}</div>` : ''}
                            </div>
                            ${ev.replaced_part ? `
                                <div style="margin-top:8px; padding:8px 12px; background:rgba(6,182,212,0.06); border:1px solid rgba(6,182,212,0.25); border-radius:8px; font-size:11.5px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                                    <div>
                                        <strong style="color:#06b6d4;"><i data-lucide="cpu" style="width:13px;height:13px;vertical-align:middle;margin-left:3px;"></i> قطعة الغيار المسحوبة من المخزن:</strong>
                                        <span style="font-weight:700; color:var(--text-primary); margin-right:4px;">${ev.replaced_part}</span>
                                    </div>
                                    <div>
                                        ${ev.cost_status === 'PAID' 
                                            ? `<span style="color:#10b981; font-weight:700;"><i data-lucide="check-circle" style="width:12px;height:12px;vertical-align:middle;"></i> مسددة بمقابل ${ev.receipt_number ? `(إيصال إيداع: <a href="javascript:void(0)" onclick="openPrintMemo('receipt', '${ev.receipt_number}')" style="color:#10b981; font-family:var(--font-en); font-weight:800; text-decoration:underline;">#${ev.receipt_number}</a>${((ev.spare_part?.payment_channel && ev.spare_part?.payment_channel !== '-') || (ev.payment_channel && ev.payment_channel !== '-')) ? ` - جهة الدفع: <strong>${ev.spare_part?.payment_channel || ev.payment_channel}</strong>` : ''}${parseFloat(ev.fees_amount) > 0 ? ` - بمبلغ: <strong>${Number(ev.fees_amount).toLocaleString('ar-EG')} جم</strong>` : ''})` : ''}</span>` 
                                            : (ev.cost_status === 'DEFERRED'
                                                ? `<span style="color:#ef4444; font-weight:700;"><i data-lucide="clock" style="width:12px;height:12px;vertical-align:middle;"></i> تحصيل مؤجل ⚠️</span>`
                                                : `<span style="color:#06b6d4; font-weight:700;"><i data-lucide="shield-check" style="width:12px;height:12px;vertical-align:middle;"></i> صرف مجاني (بدون مقابل)</span>`)}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                        <div class="timeline-item-meta">
                            <span><strong style="color:var(--color-primary);">كود العميل:</strong> <code style="font-family:var(--font-en); font-weight:bold; color:var(--color-primary); background:var(--md-sys-color-primary-container); padding:2px 6px; border-radius:4px;">${codeToShow}</code></span>
                            ${nameToShow ? `<span><strong style="color:var(--color-success);">اسم العميل:</strong> <span style="font-weight:600; color:var(--text-primary);">${nameToShow}</span></span>` : ''}
                            ${ev.pos_serial ? `<span><strong style="color:var(--text-secondary);">الماكينة:</strong> <code style="font-family:var(--font-en); font-weight:bold; color:var(--text-primary);">${ev.pos_serial}</code></span>` : ''}
                            <span><strong style="color:var(--text-secondary);">الفني المسؤول:</strong> <span style="font-weight:600; color:var(--text-primary);">${ev.technician}</span></span>
                        </div>
                    </div>
                `;
                container.appendChild(item);
            });
        }

        // 2. Render Dedicated HQ Maintenance Records
        if (hqContainer) {
            if (hqList.length === 0) {
                hqContainer.innerHTML = `
                    <div style="text-align:center; padding:35px; color:var(--text-muted);">
                        <i data-lucide="shield-check" style="width:36px; height:36px; color:#10b981; margin-bottom:8px;"></i>
                        <p style="margin:0; font-size:13px; font-weight:700; color:var(--text-primary);">لا توجد حركات إرسال لمركز الصيانة الرئيسي (HQ) لهذا الجهاز.</p>
                        <span style="font-size:11px; color:var(--text-secondary);">لم تخضع هذه الماكينة لأي دورات صيانة خارجية بمركز الصيانة الرئيسي.</span>
                    </div>
                `;
            } else {
                hqContainer.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding:10px 16px; background:rgba(245,158,11,0.08); border-radius:var(--md-shape-corner-medium); border:1px solid rgba(245,158,11,0.25);">
                        <span style="font-size:13px; font-weight:800; color:#f59e0b;">سجل دورات الصيانة المعتمدة بالمركز الرئيسي (HQ):</span>
                        <span class="badge" style="background:rgba(245,158,11,0.2); color:#f59e0b; font-size:12px; font-weight:bold; font-family:var(--font-en);">${hqList.length} دورة صيانة مسجلة</span>
                    </div>
                `;
                hqList.forEach((hq, idx) => {
                    const badgeClass = hq.is_returned ? 'inmerchant' : 'faulty';
                    const partsListHtml = hq.spare_parts && hq.spare_parts.length > 0
                        ? `<div style="margin-top:8px; padding:8px 12px; background:rgba(6,182,212,0.08); border:1px solid rgba(6,182,212,0.25); border-radius:8px;">
                            <strong style="font-size:11px; color:#06b6d4;"><i data-lucide="layers" style="width:12px;height:12px;vertical-align:middle;"></i> قطع الغيار المستبدلة بالصيانة:</strong>
                            <ul style="margin:4px 0 0 0; padding-right:18px; font-size:11px; color:var(--text-primary);">
                                ${hq.spare_parts.map(p => `<li><span style="font-weight:700;">${p.type}</span> (عدد ${p.count || 1}) ${p.notes ? ` - ${p.notes}` : ''}</li>`).join('')}
                            </ul>
                           </div>`
                        : '';

                    const hqCard = document.createElement('div');
                    hqCard.className = 'timeline-item';
                    hqCard.innerHTML = `
                        <div style="width:36px; height:36px; border-radius:50%; background:rgba(245,158,11,0.1); border:1.5px solid #f59e0b; display:flex; align-items:center; justify-content:center; color:#f59e0b; flex-shrink:0;">
                            <i data-lucide="wrench" style="width:18px; height:18px;"></i>
                        </div>
                        <div style="flex:1;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
                                <div class="timeline-item-title">
                                    <span style="color:var(--text-muted); font-size:11px; margin-left:4px; font-family:var(--font-en);">#${hqList.length - idx}</span>
                                    <span style="font-size:13px; font-weight:800;">دورة صيانة رقم #${hq.id} - إذن محضر (<code style="font-family:var(--font-en); color:#f59e0b;">${hq.form_no}</code>)</span>
                                </div>
                                <span class="badge ${badgeClass}">${hq.status}</span>
                            </div>
                            <div style="font-size:12px; color:var(--text-secondary); margin-bottom:4px; line-height:1.6;">
                                <div><strong>تاريخ الإرسال (Out):</strong> <span style="font-family:var(--font-en);">${formatDateDDMMYYYY(hq.out_date, false)}</span> | <strong>تاريخ العودة (In):</strong> <span style="font-family:var(--font-en);">${hq.in_date ? formatDateDDMMYYYY(hq.in_date, false) : '<span style="color:#ef4444; font-weight:700;">قيد الصيانة بالمركز الرئيسي</span>'}</span></div>
                                <div><strong>تشخيص العطل والملاحظات:</strong> <span style="color:var(--text-primary); font-weight:600;">${hq.notes}</span></div>
                            </div>
                            ${partsListHtml}
                        </div>
                    `;
                    hqContainer.appendChild(hqCard);
                });
            }
        }

        refreshIcons();
    } catch (err) {
        console.error("Timeline error:", err);
        if (container) container.innerHTML = `<div style="text-align:center; padding:25px; color:var(--color-critical);">خطأ أثناء البحث: ${err.message}</div>`;
        if (hqContainer) hqContainer.innerHTML = `<div style="text-align:center; padding:25px; color:var(--color-critical);">خطأ أثناء البحث: ${err.message}</div>`;
    }
}

// ==========================================
// 11. PRINTABLE MEMOS & OFFICIAL RECEIPTS
// ==========================================
async function openPrintMemo(type, id) {
    const modal = document.getElementById('modal-print-memo');
    const content = document.getElementById('printable-memo-content');
    const titleEl = document.getElementById('print-modal-title');

    if (!modal || !content) return;
    modal.classList.add('active');

    content.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;"><i data-lucide="loader-2" class="spin-animation"></i> جاري إعداد وتنسيق المستند الرسمي للطباعة...</div>`;
    refreshIcons();

    try {
        const res = await fetch(`/api/print/memo/${type}/${encodeURIComponent(id)}`);
        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.error || "تعذر جلب بيانات المستند");

        const doc = result;
        const d = doc.data;
        const formattedDocDate = formatDateDDMMYYYY(doc.date || new Date().toISOString(), false);

        if (titleEl) titleEl.textContent = doc.doc_title;

        if (type === 'delivery' || type === 'return') {
            content.innerHTML = `
                <div style="font-family: 'Cairo', sans-serif; color:#0f172a; line-height:1.6; border: 2px solid #0f172a; padding: 24px; border-radius: 8px;">
                    <!-- Header -->
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 20px;">
                        <div>
                            <h2 style="margin:0; font-size:18px; color:#1e3a8a;">شركة سمارت كارد لنظم المعلومات</h2>
                            <p style="margin:2px 0 0; font-size:12px; color:#475569;">إدارة الدعم الفني والصيانة - منظومة الخبز والسلع التموينية</p>
                        </div>
                        <div style="text-align:left;">
                            <strong style="font-size:13px; font-family:'Roboto', sans-serif; color:#1e3a8a;">${doc.doc_number}</strong>
                            <div style="font-size:11px; color:#64748b;">التاريخ: ${formattedDocDate}</div>
                        </div>
                    </div>

                    <!-- Doc Title -->
                    <div style="text-align:center; margin-bottom:20px;">
                        <h3 style="margin:0; font-size:16px; text-decoration: underline; color:#0f172a;">${doc.doc_title}</h3>
                    </div>

                    <!-- Details Table -->
                    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:13px;">
                        <tbody>
                            <tr>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold; width:25%;">اسم المخبز / التاجر</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; font-weight:bold; color:#1e3a8a;">${d.name || '-'}</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold; width:20%;">كود المخبز</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; font-family:'Roboto', sans-serif; font-weight:bold;">${d.merchant_code || '-'}</td>
                            </tr>
                            <tr>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold;">المحافظة / الإدارة</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px;">${d.government || '-'}</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold;">رقم الهاتف</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; font-family:'Roboto', sans-serif;">${d.contact_phone || '-'}</td>
                            </tr>
                            <tr>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold;">سيريال الماكينة (POS)</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; font-family:'Roboto', sans-serif; font-weight:bold; color:#059669;">${d.pos_serial || '-'}</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold;">الموديل / الشركة</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; font-family:'Roboto', sans-serif;">${d.pos_model || 'PAX S90'} (${d.pos_mfg || 'PAX'})</td>
                            </tr>
                            <tr>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold;">سيريال الشريحة (SIM)</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; font-family:'Roboto', sans-serif; font-weight:bold;">${d.sim_serial || '-'}</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold;">مشغل الشبكة</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px;">${d.sim_carrier || 'Orange'}</td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- Statement -->
                    <div style="font-size:12px; background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:6px; margin-bottom:30px;">
                        <p style="margin:0;">
                            ${type === 'delivery' 
                                ? 'أقر أنا الموقع أدناه باستلام الماكينة ومشتملاتها الموضحة بعاليه بحالة جيدة وسليمة وتعمل بكفاءة، وأتعهد بالمحافظة عليها واستخدامها في الغرض المخصص لها طبقاً للتعليمات.' 
                                : 'تم استلام الماكينة الموضحة بعاليه من التاجر بمعرفة مندوب الدعم الفني لإجراء الفحص والصيانة الدورية / الإحلال بالمخزن.'}
                        </p>
                    </div>

                    <!-- Signatures -->
                    <div style="display:flex; justify-content:space-between; margin-top:40px; padding:0 20px; font-size:13px;">
                        <div style="text-align:center;">
                            <strong>توقيع المستلم / العميل</strong>
                            <div style="margin-top:40px; border-top:1px dashed #94a3b8; width:160px;">الاسم والتوقيع</div>
                        </div>
                        <div style="text-align:center;">
                            <strong>فني الصيانة / المندوب</strong>
                            <div style="margin-top:40px; border-top:1px dashed #94a3b8; width:160px;">التوقيع</div>
                        </div>
                        <div style="text-align:center;">
                            <strong>اعتماد إدارة الفرع</strong>
                            <div style="margin-top:40px; border-top:1px dashed #94a3b8; width:160px;">خاتم الفرع والتاريخ</div>
                        </div>
                    </div>
                </div>
            `;
        } else if (type === 'receipt') {
            content.innerHTML = `
                <div style="font-family: 'Cairo', sans-serif; color:#0f172a; line-height:1.6; border: 2px solid #0f172a; padding: 24px; border-radius: 8px;">
                    <!-- Header -->
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 20px;">
                        <div>
                            <h2 style="margin:0; font-size:18px; color:#1e3a8a;">شركة سمارت كارد لنظم المعلومات</h2>
                            <p style="margin:2px 0 0; font-size:12px; color:#475569;">إيصال إيداع وتحصيل وسداد نقدي</p>
                        </div>
                        <div style="text-align:left;">
                            <strong style="font-size:14px; font-family:'Roboto', sans-serif; color:#dc2626;">${doc.doc_number}</strong>
                            <div style="font-size:11px; color:#64748b;">التاريخ: ${formattedDocDate}</div>
                        </div>
                    </div>

                    <!-- Receipt Amount Box -->
                    <div style="background:#f0fdf4; border:2px solid #16a34a; border-radius:8px; padding:15px; text-align:center; margin-bottom:20px;">
                        <span style="font-size:13px; color:#15803d; display:block;">المبلغ المستلم والمحصل</span>
                        <h1 style="margin:5px 0 0; font-size:28px; font-family:'Roboto', sans-serif; color:#15803d;">${Number(d.amount || 0).toLocaleString('ar-EG')} جنيه مصري فقط لا غير</h1>
                    </div>

                    <!-- Details Table -->
                    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:13px;">
                        <tbody>
                            <tr>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold; width:25%;">استلمنا من السيد / المخبز</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; font-weight:bold; color:#1e3a8a;">${d.merchant_name || '-'}</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold; width:20%;">كود المخبز</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; font-family:'Roboto', sans-serif; font-weight:bold;">${d.merchant_code || '-'}</td>
                            </tr>
                            <tr>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold;">وذلك قيمة</td>
                                <td colspan="3" style="border:1px solid #cbd5e1; padding:8px 12px; font-weight:bold;">${d.reason || 'سداد مقابل صيانة / استبدال قطع غيار'}</td>
                            </tr>
                            <tr>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold;">جهة الدفع والتحصيل</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; font-weight:bold; color:#15803d;">${d.payment_place || 'ضامن'}</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; background:#f8fafc; font-weight:bold;">الماكينة المعنية</td>
                                <td style="border:1px solid #cbd5e1; padding:8px 12px; font-family:'Roboto', sans-serif;">${d.pos_serial || '-'}</td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- Signatures -->
                    <div style="display:flex; justify-content:space-between; margin-top:40px; padding:0 20px; font-size:13px;">
                        <div style="text-align:center;">
                            <strong>المسدد / العميل</strong>
                            <div style="margin-top:35px; border-top:1px dashed #94a3b8; width:150px;">التوقيع</div>
                        </div>
                        <div style="text-align:center;">
                            <strong>أمين الخزينة / المحصل</strong>
                            <div style="margin-top:35px; border-top:1px dashed #94a3b8; width:150px;">التوقيع</div>
                        </div>
                        <div style="text-align:center;">
                            <strong>مدير الفرع</strong>
                            <div style="margin-top:35px; border-top:1px dashed #94a3b8; width:150px;">الاعتماد والختم</div>
                        </div>
                    </div>
                </div>
            `;
        }

        refreshIcons();
    } catch (err) {
        console.error("Memo print error:", err);
        content.innerHTML = `<div style="text-align:center; padding:30px; color:#dc2626;">خطأ في تجهيز المستند: ${err.message}</div>`;
    }
}

// ==========================================
// 12. EOD SINGLE DAY BREAKDOWN CONTROLLER
// ==========================================
async function openEODDayDetails(rawDate, isoDate) {
    const modal = document.getElementById('modal-eod-detail');
    if (!modal) return;

    modal.classList.add('active');
    const formattedDate = formatDateDDMMYYYY(rawDate || isoDate);
    const titleEl = document.getElementById('eod-detail-title');
    const subTitleEl = document.getElementById('eod-detail-subtitle');

    if (titleEl) titleEl.textContent = `تفاصيل وسجل تقفيل يومية (${formattedDate})`;
    if (subTitleEl) subTitleEl.textContent = `استعراض البلاغات المنفذة، قطع الغيار، والمتحصلات المسجلة`;

    // Reset subtabs to tickets
    document.querySelectorAll('.eod-subtab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-eod-tab-tickets')?.classList.add('active');
    document.querySelectorAll('.eod-tab-pane').forEach(p => p.style.display = 'none');
    const paneTickets = document.getElementById('eod-pane-tickets');
    if (paneTickets) paneTickets.style.display = 'block';

    // Reset tables
    document.getElementById('eod-table-body-tickets').innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="loader-2" class="spin-animation"></i> جاري تحميل تفاصيل اليومية...</td></tr>`;
    document.getElementById('eod-table-body-parts').innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="loader-2" class="spin-animation"></i> جاري التحميل...</td></tr>`;
    document.getElementById('eod-table-body-payments').innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="loader-2" class="spin-animation"></i> جاري التحميل...</td></tr>`;
    refreshIcons();

    try {
        const queryDate = isoDate || rawDate;
        const res = await fetch(`/api/reports/eod-detail?date=${encodeURIComponent(queryDate)}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "تعذر جلب تفاصيل اليومية");

        const sum = data.summary || {};
        document.getElementById('eod-kpi-tickets').textContent = sum.total_tickets || 0;
        document.getElementById('eod-kpi-merchants').textContent = `${sum.unique_merchants_count || 0} مخبز`;
        document.getElementById('eod-kpi-cash').textContent = `${Number(sum.total_cash_collected || 0).toLocaleString('ar-EG')} جم`;
        document.getElementById('eod-kpi-parts').textContent = `${sum.spare_parts_dispatched_count || 0} قطعة`;
        document.getElementById('eod-detail-technicians').textContent = sum.technicians_list && sum.technicians_list.length > 0 ? sum.technicians_list.join(' • ') : 'فني الصيانة بالفرع';

        // Badge Counts
        document.getElementById('eod-tab-count-tickets').textContent = data.tickets ? data.tickets.length : 0;
        document.getElementById('eod-tab-count-parts').textContent = data.spare_parts ? data.spare_parts.length : 0;
        document.getElementById('eod-tab-count-payments').textContent = data.payments ? data.payments.length : 0;

        // Render Tickets Table
        const tbTickets = document.getElementById('eod-table-body-tickets');
        if (data.tickets && data.tickets.length > 0) {
            tbTickets.innerHTML = data.tickets.map((t) => {
                const isBoard = t.ticket_type && t.ticket_type.includes('مسارات');
                return `
                    <tr>
                        <td><strong>#${t.id}</strong></td>
                        <td>${isBoard ? '<span class="badge" style="background:rgba(168,85,247,0.15); color:#a855f7;"><i data-lucide="cpu" style="width:10px;height:10px;"></i> مسارات بوردة</span>' : '<span class="badge inmerchant">' + (t.ticket_type || 'إصلاح عطل') + '</span>'}</td>
                        <td><code style="font-family:var(--font-en); font-weight:bold; color:var(--color-primary);">${t.merchant_code || '-'}</code></td>
                        <td><strong>${t.merchant_name || '-'}</strong></td>
                        <td><code style="font-family:var(--font-en);">${t.device_serial || '-'}</code></td>
                        <td><span style="font-size:12px; color:var(--text-secondary);">${t.issue_details || '-'}</span></td>
                        <td><span style="font-size:12px; font-weight:600; color:var(--text-primary);">${t.resolution_details || '-'}</span></td>
                        <td><strong style="color:var(--color-primary);">${t.technician_name || '-'}</strong></td>
                    </tr>
                `;
            }).join('');
        } else {
            tbTickets.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد بلاغات مسجلة في هذا اليوم.</td></tr>`;
        }

        // Render Spare Parts Table
        const tbParts = document.getElementById('eod-table-body-parts');
        if (data.spare_parts && data.spare_parts.length > 0) {
            tbParts.innerHTML = data.spare_parts.map(p => {
                let statusBadge = '<span class="badge" style="background:rgba(6,182,212,0.15); color:#06b6d4; font-weight:700;"><i data-lucide="shield-check" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> صرف مجاني</span>';
                if (p.payment_status === 'DEFERRED') {
                    statusBadge = '<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; font-weight:700;"><i data-lucide="clock" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> تحصيل مؤجل ⚠️</span>';
                } else if (p.payment_status === 'PAID') {
                    statusBadge = '<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; font-weight:700;"><i data-lucide="check-circle" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> مسدد بمقابل ✅</span>';
                }

                return `
                    <tr>
                        <td><strong>#${p.id}</strong></td>
                        <td>${formatDateTimeCell(p.out_date)}</td>
                        <td><strong style="color:var(--color-primary);">${p.part_name}</strong></td>
                        <td><span class="badge inmerchant" style="font-family:var(--font-en);">${p.quantity} قطعة</span></td>
                        <td><code style="font-family:var(--font-en); font-weight:bold;">${p.merchant_code || '-'}</code></td>
                        <td><code style="font-family:var(--font-en);">${p.pos_serial || '-'}</code></td>
                        <td>${statusBadge}</td>
                        <td><span style="font-family:var(--font-en); font-weight:bold; color:var(--color-success);">${p.receipt_num || '-'}</span></td>
                        <td><strong style="font-family:var(--font-en); color:${p.payment_status === 'DEFERRED' ? '#f87171' : 'var(--color-success)'};">${Number(p.total_amount || 0).toLocaleString('ar-EG')} جم</strong></td>
                    </tr>
                `;
            }).join('');
        } else {
            tbParts.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد قطع غيار منصرفة في هذا اليوم.</td></tr>`;
        }

        // Render Payments Table
        const tbPayments = document.getElementById('eod-table-body-payments');
        if (data.payments && data.payments.length > 0) {
            tbPayments.innerHTML = data.payments.map(p => `
                <tr>
                    <td><strong>#${p.id}</strong></td>
                    <td><span style="font-family:var(--font-en); font-weight:bold; color:var(--color-primary);">${p.ref_num || '-'}</span></td>
                    <td><code style="font-family:var(--font-en); font-weight:bold;">${p.merchant_code || '-'}</code></td>
                    <td><strong>${p.merchant_name || '-'}</strong></td>
                    <td><strong style="font-family:var(--font-en); color:var(--color-success); font-size:13px;">${Number(p.amount || 0).toLocaleString('ar-EG')} جم</strong></td>
                    <td><span class="badge inmerchant">${p.payment_type || 'سداد نقدي'}</span></td>
                    <td>${formatDateTimeCell(p.payment_date)}</td>
                </tr>
            `).join('');
        } else {
            tbPayments.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد متحصلات نقدية مسجلة في هذا اليوم.</td></tr>`;
        }

        refreshIcons();
    } catch (err) {
        console.error("EOD detail fetch error:", err);
        alert("حدث خطأ أثناء تحميل تفاصيل اليومية: " + err.message);
    }
}

// ==========================================
// 8.5 SYSTEM SETTINGS & REAL-TIME AUTO-SYNC
// ==========================================
async function loadSettings() {
    try {
        const res = await fetch('/api/settings/db-path');
        if (!res.ok) throw new Error('فشل جلب إعدادات المسار');
        const data = await res.json();

        const pathInput = document.getElementById('settings-access-path');
        const sizeLabel = document.getElementById('settings-file-size');
        const statusBadge = document.getElementById('settings-db-status-badge');
        const providerInput = document.getElementById('settings-provider-name');
        const engineInput = document.getElementById('settings-local-engine');
        const autoSyncToggle = document.getElementById('settings-auto-sync-toggle');
        const autoSyncBadge = document.getElementById('settings-auto-sync-status-badge');
        const watcherState = document.getElementById('settings-watcher-state');
        const networkUrlInput = document.getElementById('settings-network-url');

        if (pathInput && data.path) pathInput.value = data.path;
        if (sizeLabel && data.fileSizeMb) sizeLabel.textContent = `${data.fileSizeMb} MB`;
        if (providerInput && data.provider) providerInput.value = data.provider;
        if (engineInput && data.localDb) engineInput.value = data.localDb;
        if (networkUrlInput && data.networkUrl) networkUrlInput.value = data.networkUrl;

        const isAuto = data.autoSync !== false;
        if (autoSyncToggle) autoSyncToggle.checked = isAuto;
        if (autoSyncBadge) {
            autoSyncBadge.className = isAuto ? 'badge inmerchant' : 'badge faulty';
            autoSyncBadge.innerHTML = isAuto ? '<i data-lucide="zap" style="width:12px; height:12px; vertical-align:middle;"></i> مراقبة حية نشطة' : '<i data-lucide="pause" style="width:12px; height:12px; vertical-align:middle;"></i> المراقبة معطلة';
        }
        if (watcherState) {
            watcherState.textContent = isAuto ? 'مفعل ونشط (Debounce 3s)' : 'متوقف حالياً';
            watcherState.style.color = isAuto ? 'var(--color-success)' : 'var(--text-muted)';
        }

        if (statusBadge) {
            if (data.exists) {
                statusBadge.className = 'badge inmerchant';
                statusBadge.innerHTML = `<i data-lucide="check-circle" style="width:12px; height:12px; vertical-align:middle;"></i> متصل ومتاح`;
            } else {
                statusBadge.className = 'badge faulty';
                statusBadge.innerHTML = `<i data-lucide="alert-triangle" style="width:12px; height:12px; vertical-align:middle;"></i> الملف غير موجود`;
            }
        }
        refreshIcons();
    } catch (err) {
        console.error('Error loading settings:', err);
    }
}

function initSettingsListeners() {
    const browseBtn = document.getElementById('btn-settings-browse');
    const filePicker = document.getElementById('settings-file-picker');
    const pathInput = document.getElementById('settings-access-path');
    const saveBtn = document.getElementById('btn-settings-save-path');
    const statusMsg = document.getElementById('settings-status-message');
    const autoSyncToggle = document.getElementById('settings-auto-sync-toggle');

    browseBtn?.addEventListener('click', () => {
        filePicker?.click();
    });

    filePicker?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file && pathInput) {
            if (file.path) {
                pathInput.value = file.path;
            } else {
                pathInput.value = file.name;
            }
        }
    });

    saveBtn?.addEventListener('click', async () => {
        const path = pathInput?.value.trim();
        if (!path) {
            alert('يرجى إدخال مسار ملف الآكسيس');
            return;
        }

        saveBtn.disabled = true;
        if (statusMsg) {
            statusMsg.style.display = 'block';
            statusMsg.style.color = 'var(--text-secondary)';
            statusMsg.innerHTML = '<i data-lucide="loader-2" class="spin-animation"></i> جاري حفظ وفحص مسار قاعدة البيانات...';
            refreshIcons();
        }

        try {
            const res = await fetch('/api/settings/db-path', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'فشل حفظ المسار');
            }

            if (statusMsg) {
                statusMsg.style.color = 'var(--color-success)';
                statusMsg.innerHTML = `<i data-lucide="check-circle" style="vertical-align:middle;"></i> ${data.message} (حجم الملف: ${data.fileSizeMb} MB)`;
            }

            loadSettings();
            refreshIcons();
        } catch (err) {
            if (statusMsg) {
                statusMsg.style.color = 'var(--color-critical)';
                statusMsg.innerHTML = `<i data-lucide="alert-circle" style="vertical-align:middle;"></i> خطأ: ${err.message}`;
                refreshIcons();
            }
        } finally {
            saveBtn.disabled = false;
        }
    });

    // Auto-Sync Toggle Listener
    autoSyncToggle?.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        try {
            const res = await fetch('/api/settings/auto-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            });
            const data = await res.json();
            loadSettings();
        } catch (err) {
            console.error('Error toggling auto-sync:', err);
        }
    });

    // Wipe Database Listener
    const resetDbBtn = document.getElementById('btn-settings-reset-db');
    resetDbBtn?.addEventListener('click', async () => {
        const confirmed = confirm('تحذير: هل أنت متأكد من رغبتك في تصفير وتفريغ قاعدة بيانات الويب بالكامل؟\n\nسيتم مسح كافة السجلات الحالية من الويب لتجهيزها لربط ملف آكسيس جديد.');
        if (!confirmed) return;

        resetDbBtn.disabled = true;
        if (statusMsg) {
            statusMsg.style.display = 'block';
            statusMsg.style.color = 'var(--text-secondary)';
            statusMsg.innerHTML = '<i data-lucide="loader-2" class="spin-animation"></i> جاري تفريغ وتصفير قاعدة بيانات الويب...';
            refreshIcons();
        }

        try {
            const res = await fetch('/api/settings/reset-database', { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'فشل تصفير قاعدة البيانات');

            if (statusMsg) {
                statusMsg.style.color = 'var(--color-success)';
                statusMsg.innerHTML = `<i data-lucide="check-circle" style="vertical-align:middle;"></i> ${data.message}`;
            }

            alert('تم تفريغ قاعدة بيانات الويب بنجاح! يمكنك الآن اختيار ملف الآكسيس الجديد والبدء في مزامنته.');
            refreshActiveTab();
            loadSettings();
        } catch (err) {
            if (statusMsg) {
                statusMsg.style.color = 'var(--color-critical)';
                statusMsg.innerHTML = `<i data-lucide="alert-circle" style="vertical-align:middle;"></i> خطأ: ${err.message}`;
                refreshIcons();
            }
        } finally {
            resetDbBtn.disabled = false;
        }
    });

    // Copy Network URL Listener
    const copyUrlBtn = document.getElementById('btn-copy-network-url');
    const copyLabel = document.getElementById('copy-btn-label');
    const networkUrlInput = document.getElementById('settings-network-url');
    copyUrlBtn?.addEventListener('click', async () => {
        if (!networkUrlInput || !networkUrlInput.value) return;
        try {
            await navigator.clipboard.writeText(networkUrlInput.value);
            if (copyLabel) copyLabel.textContent = 'تم النسخ! ✅';
            setTimeout(() => {
                if (copyLabel) copyLabel.textContent = 'نسخ الرابط';
            }, 2500);
        } catch (err) {
            networkUrlInput.select();
            document.execCommand('copy');
            if (copyLabel) copyLabel.textContent = 'تم النسخ! ✅';
            setTimeout(() => {
                if (copyLabel) copyLabel.textContent = 'نسخ الرابط';
            }, 2500);
        }
    });
}

// ==========================================
// 8.6 REAL-TIME SERVER-SENT EVENTS (SSE) STREAM
// ==========================================
function initLiveSyncStream() {
    if (!window.EventSource) return;

    let reconnectDelay = 3000;
    let sse = null;
    function connect() {
        sse = new EventSource('/api/sync/events');

        sse.addEventListener('connected', (e) => {
            console.log('[LIVE SSE] Connected to server auto-sync stream.');
            const sseState = document.getElementById('settings-sse-state');
            if (sseState) sseState.textContent = 'متصل ومستعد (Live Connected)';
            reconnectDelay = 3000;
        });

        const handleSyncEvent = (rawPayload) => {
            try {
                const data = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
                console.log('[LIVE SSE] Real-time sync event received:', data);

                // 1. Invalidate all cached datasets across modules so every tab receives fresh data
                warehouseDataCache = null;
                simsDataCache = null;
                hqMaintenanceDataCache = null;
                installmentsDataCache = null;
                sparePartsDataCache = null;

                // 2. Show Live Toast Notification
                showLiveSyncToast(data);

                // 3. Refresh current active tab view smoothly
                refreshActiveTab();

                // 4. Update Header Notifications & Alerts & Health
                if (typeof checkSyncHealth === 'function') checkSyncHealth();
                if (typeof loadNotifications === 'function') loadNotifications();
            } catch (err) {
                console.error('[LIVE SSE] Error parsing sync event:', err);
            }
        };

        sse.addEventListener('sync_completed', (e) => handleSyncEvent(e.data));
        sse.addEventListener('app_updated', (e) => {
            try {
                const data = JSON.parse(e.data);
                if (typeof showLiveSyncToast === 'function') {
                    showLiveSyncToast({
                        title: '🚀 تحديث منظومة SmartCS',
                        summary: data.message || 'تم تحديث البرنامج بنجاح من GitHub! جاري إعادة التحميل...',
                        sync_type: 'SYSTEM_UPDATE'
                    });
                }
                setTimeout(() => window.location.reload(), 2000);
            } catch (err) {}
        });
        sse.onmessage = (e) => handleSyncEvent(e.data);

        sse.onerror = () => {
            const sseState = document.getElementById('settings-sse-state');
            if (sseState) sseState.textContent = 'جاري إعادة الاتصال...';
            sse.close();
            setTimeout(connect, reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        };
    }

    connect();
}

function showLiveSyncToast(data) {
    const toast = document.getElementById('live-sync-toast');
    const toastMsg = document.getElementById('live-sync-toast-msg');
    if (!toast) return;

    const changes = data?.changesDetected || data?.changesCount || 0;
    if (toastMsg) {
        if (changes > 0) {
            toastMsg.textContent = `تم رصد وتحديث (${changes}) حركة جديدة بالآكسيس وتحديث الشاشة فورياً.`;
        } else {
            toastMsg.textContent = `تمت المزامنة الآلية مع الآكسيس وتحديث الشاشة بنجاح.`;
        }
    }

    toast.style.display = 'flex';
    requestAnimationFrame(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.transform = 'translateY(20px)';
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.style.display = 'none';
        }, 400);
    }, 4500);
}

function refreshActiveTab() {
    const activeNav = document.querySelector('.nav-item.active');
    const activePanel = document.querySelector('.tab-content.active');
    const tabName = activeNav?.getAttribute('data-tab') || (activePanel ? activePanel.id.replace(/^tab-/, '') : 'dashboard');

    console.log(`[REFRESH ACTIVE TAB] Auto-refreshing view for tab: "${tabName}"`);
    if (tabName === 'dashboard') loadDashboard();
    else if (tabName === 'branch-warehouse') loadWarehouseInventory();
    else if (tabName === 'sim-warehouse') loadSimsInventory();
    else if (tabName === 'hq-maintenance') loadHqMaintenanceInventory();
    else if (tabName === 'installments') loadInstallmentsDashboard();
    else if (tabName === 'spare-parts-inventory') loadSparePartsInventory();
    else if (tabName === 'merchants' && typeof loadMerchants === 'function') loadMerchants();
    else if (tabName === 'devices' && typeof loadDevices === 'function') loadDevices();
    else if (tabName === 'sim-cards' && typeof loadSimCards === 'function') loadSimCards();
    else if (tabName === 'tickets' && typeof loadTickets === 'function') loadTickets();
    else if (tabName === 'assets' && typeof loadAssets === 'function') loadAssets();
    else if (tabName === 'reports' && typeof loadReports === 'function') loadReports();
    else if (tabName === 'sync-monitor') loadSyncMonitor();
    else if (tabName === 'data-explorer') fetchDataExplorerTable();
}

// ==========================================
// 8.7 SMART NOTIFICATIONS & PROACTIVE ALERTS
// ==========================================
async function loadNotifications() {
    try {
        const res = await fetch('/api/notifications/alerts');
        if (!res.ok) return;
        const data = await res.json();

        const badge = document.getElementById('header-notifications-badge');
        const totalBadge = document.getElementById('dropdown-alerts-total-badge');
        const maintCount = document.getElementById('notif-maint-count');
        const spCount = document.getElementById('notif-sp-count');
        const instCount = document.getElementById('notif-inst-count');

        const totalAlerts = data.totalAlerts || 0;
        const pendingMaint = data.pendingMaintenance || [];
        const lowParts = data.lowStockParts || [];
        const dueInst = data.dueInstallments || [];

        if (badge) {
            badge.textContent = totalAlerts;
            badge.style.display = totalAlerts > 0 ? 'inline-flex' : 'none';
        }
        if (totalBadge) totalBadge.textContent = `${totalAlerts} تنبيه نشط`;
        if (maintCount) maintCount.textContent = pendingMaint.length;
        if (spCount) spCount.textContent = lowParts.length;
        if (instCount) instCount.textContent = dueInst.length;

        // Render Pending Maintenance List
        const maintList = document.getElementById('notif-maint-list');
        if (maintList) {
            if (pendingMaint.length === 0) {
                maintList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">✅ لا توجد ماكينات معلقة بالصيانة</div>';
            } else {
                maintList.innerHTML = pendingMaint.map(m => `
                    <div class="notif-card-item" onclick="document.getElementById('tab-btn-hq-maintenance').click(); document.getElementById('dropdown-notifications-panel').style.display='none';">
                        <div class="notif-item-icon warning"><i data-lucide="wrench" style="width:16px;height:16px;"></i></div>
                        <div style="flex:1;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <strong style="font-size:12px; color:var(--text-primary);">${m.device_serial || 'ماكينة صيانة'} (${m.device_model || 'POS'})</strong>
                                <span style="font-size:10px; color:var(--color-warning); font-weight:700;">معلقة</span>
                            </div>
                            <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
                                ${m.merchant_name ? m.merchant_name + ' - ' : ''}${m.issue_details || 'عطل جهاز'}
                            </div>
                            <div style="font-size:10px; color:var(--text-muted); margin-top:3px; display:flex; justify-content:space-between;">
                                <span>الفني: ${m.technician_name || 'غير محدد'}</span>
                                <span style="font-family:var(--font-en);">${m.issue_date ? new Date(m.issue_date).toLocaleDateString('ar-EG') : ''}</span>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        }

        // Render Low Stock Spare Parts List
        const spList = document.getElementById('notif-sp-list');
        if (spList) {
            if (lowParts.length === 0) {
                spList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">✅ كافة قطع الغيار متوفرة بمستويات آمنة</div>';
            } else {
                spList.innerHTML = lowParts.map(p => `
                    <div class="notif-card-item" onclick="document.getElementById('tab-btn-spare-parts-inventory').click(); document.getElementById('dropdown-notifications-panel').style.display='none';">
                        <div class="notif-item-icon critical"><i data-lucide="alert-triangle" style="width:16px;height:16px;"></i></div>
                        <div style="flex:1;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <strong style="font-size:12px; color:var(--text-primary);">${p.part_name}</strong>
                                <span class="badge faulty" style="font-size:10px;">${p.quantity_in_stock} متبقي</span>
                            </div>
                            <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
                                الحد الحرج للأمان بالمخزن: ${p.critical_limit} قطع
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        }

        // Render Due Installments List
        const instList = document.getElementById('notif-inst-list');
        if (instList) {
            if (dueInst.length === 0) {
                instList.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">✅ لا توجد عقود أقساط مسجلة</div>';
            } else {
                instList.innerHTML = dueInst.map(i => {
                    const title = i.merchant_name 
                        ? `مخبز: ${i.merchant_name} (${i.merchant_code || i.device_serial})`
                        : `ماكينة قسط: ${i.device_serial || ('عقد #' + i.id)}`;
                    const monthly = Number(i.monthlyinstallmentprice || 0).toLocaleString('en-US');
                    const total = Number(i.finalunitprice || 0).toLocaleString('en-US');
                    const planText = i.plan_months ? `${i.plan_months} أشهر` : 'نظام معتمد';

                    return `
                        <div class="notif-card-item" onclick="document.getElementById('tab-btn-installments').click(); document.getElementById('dropdown-notifications-panel').style.display='none';">
                            <div class="notif-item-icon primary"><i data-lucide="calculator" style="width:16px;height:16px;"></i></div>
                            <div style="flex:1;">
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    <strong style="font-size:12px; color:var(--text-primary); max-width:210px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${title}">${title}</strong>
                                    <span style="font-size:11px; font-weight:800; font-family:var(--font-en); color:#0284c7; white-space:nowrap;">${monthly} جم/ش</span>
                                </div>
                                <div style="font-size:11px; color:var(--text-secondary); margin-top:3px; display:flex; justify-content:space-between; align-items:center;">
                                    <span>نظام: ${planText}</span>
                                    <span>الإجمالي: <strong style="font-family:var(--font-en); color:var(--text-primary);">${total} جم</strong></span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        refreshIcons();
    } catch (err) {
        console.error('Error loading notifications:', err);
    }
}

function initNotifications() {
    const bellBtn = document.getElementById('btn-header-notifications');
    const dropdown = document.getElementById('dropdown-notifications-panel');
    const refreshBtn = document.getElementById('btn-refresh-notifications');

    bellBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = dropdown.style.display === 'none';
        dropdown.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) loadNotifications();
    });

    document.addEventListener('click', (e) => {
        if (dropdown && !dropdown.contains(e.target) && e.target !== bellBtn) {
            dropdown.style.display = 'none';
        }
    });

    refreshBtn?.addEventListener('click', () => {
        loadNotifications();
    });

    // Notification tabs
    const notifTabs = document.querySelectorAll('.notif-tab-btn');
    notifTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');
            notifTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            document.querySelectorAll('.notif-tab-panel').forEach(p => p.style.display = 'none');
            const targetPanel = document.getElementById(`notif-${target}-list`);
            if (targetPanel) targetPanel.style.display = 'block';
        });
    });

    loadNotifications();
}

// ==========================================
// 8.8 TECHNICIAN PERFORMANCE & SLA
// ==========================================
async function loadTechniciansPerformance() {
    const container = document.getElementById('tech-performance-cards-grid');
    if (!container) return;

    try {
        const res = await fetch('/api/maintenance/technicians-performance');
        if (!res.ok) return;
        const data = await res.json();
        const techs = data.technicians || [];

        if (techs.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:15px; grid-column:1/-1; text-align:center;">لا توجد بيانات فنيين مسجلة</div>';
            return;
        }

        container.innerHTML = techs.map(t => {
            const initials = t.tech_name.split(' ').slice(0, 2).map(n => n[0]).join(' ');
            const topFaultsTags = (t.top_faults || []).map(f => `<span class="tech-fault-tag">${f.issue_details} (${f.count})</span>`).join('');

            return `
                <div class="tech-card">
                    <div class="tech-card-header">
                        <div class="tech-avatar">${initials || 'ف'}</div>
                        <div class="tech-info">
                            <h4>${t.tech_name}</h4>
                            <span>فني صيانة معتمد بالفرع</span>
                        </div>
                    </div>
                    
                    <div class="tech-stats-row">
                        <div>
                            <span class="tech-stat-val" style="color:var(--color-primary);">${Number(t.total_tickets).toLocaleString('en-US')}</span>
                            <span class="tech-stat-lbl">إجمالي التذاكر</span>
                        </div>
                        <div>
                            <span class="tech-stat-val" style="color:var(--color-success);">${Number(t.completed_count).toLocaleString('en-US')}</span>
                            <span class="tech-stat-lbl">تم الإصلاح ✅</span>
                        </div>
                        <div>
                            <span class="tech-stat-val" style="color:${t.pending_count > 0 ? '#ef4444' : 'var(--text-muted)'};">${Number(t.pending_count).toLocaleString('en-US')}</span>
                            <span class="tech-stat-lbl">قيد الفحص ⏳</span>
                        </div>
                    </div>

                    <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; margin-bottom:4px;">
                        <span style="color:var(--text-secondary);">نسبة الإنجاز:</span>
                        <span style="color:var(--color-success); font-family:var(--font-en);">${t.completion_rate}%</span>
                    </div>
                    <div class="tech-progress-bar">
                        <div class="tech-progress-fill" style="width: ${t.completion_rate}%;"></div>
                    </div>

                    ${topFaultsTags ? `
                        <div style="margin-top:6px;">
                            <span style="font-size:10px; color:var(--text-muted); display:block; margin-bottom:4px;">أبرز الأعطال المنجزة:</span>
                            <div class="tech-top-faults">${topFaultsTags}</div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        refreshIcons();
    } catch (err) {
        console.error('Error loading tech performance:', err);
    }
}

// ==========================================
// 8.9 PWA (PROGRESSIVE WEB APP) INSTALLATION
// ==========================================
let deferredPrompt = null;
function initPwaInstall() {
    // 1. Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
            .catch(err => console.error('[PWA] Service Worker registration failed:', err));
    }

    // 2. Install Prompt Listener
    const installBtn = document.getElementById('btn-pwa-install');
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (installBtn) installBtn.style.display = 'inline-flex';
    });

    installBtn?.addEventListener('click', async () => {
        if (!deferredPrompt) {
            alert('لتثبيت التطبيق على هاتفك أو جهازك:\n- على متصفح Chrome/Edge: اضغط على خيارات المتصفح (⋮) واختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية".');
            return;
        }
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            console.log('[PWA] User accepted the install prompt');
            if (installBtn) installBtn.style.display = 'none';
        }
        deferredPrompt = null;
    });

    window.addEventListener('appinstalled', () => {
        console.log('[PWA] App installed successfully');
        if (installBtn) installBtn.style.display = 'none';
    });
}

// Expose globally for HTML onclick handlers
window.openAssetTimeline = openAssetTimeline;
window.openPrintMemo = openPrintMemo;
window.openEODDayDetails = openEODDayDetails;

// ==========================================
// 9. EVENT LISTENERS & APP BOOTSTRAP
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Theme & Clock
    initTheme();
    initClock();

    // 2. Navigation, Notifications, PWA, & Real-time Listeners
    initNavigation();
    initNotifications();
    initPwaInstall();
    initSettingsListeners();
    initLiveSyncStream();

    // 3. Sync Triggers
    const btnDashSync = document.getElementById('btn-dashboard-sync-now');
    const iconDashSync = document.getElementById('icon-dash-sync');
    btnDashSync?.addEventListener('click', () => triggerAccessSync(btnDashSync, iconDashSync));

    const btnMonitorSync = document.getElementById('btn-sync-monitor-run');
    const iconMonitorSpinner = document.getElementById('icon-sync-monitor-spinner');
    btnMonitorSync?.addEventListener('click', () => triggerAccessSync(btnMonitorSync, iconMonitorSpinner));

    document.getElementById('btn-settings-test-sync')?.addEventListener('click', () => {
        const icon = document.getElementById('icon-settings-sync-spinner');
        triggerAccessSync(document.getElementById('btn-settings-test-sync'), icon);
    });

    // Quick navigation jumps
    document.getElementById('btn-dash-open-audit')?.addEventListener('click', () => {
        document.getElementById('tab-btn-sync-monitor')?.click();
    });

    // 5. Audit Log Event Listeners
    document.getElementById('audit-table-filter')?.addEventListener('change', () => {
        AppState.audit.currentPage = 1;
        fetchAndRenderAuditLogs();
    });
    document.getElementById('audit-type-filter')?.addEventListener('change', () => {
        AppState.audit.currentPage = 1;
        fetchAndRenderAuditLogs();
    });
    document.getElementById('audit-search-input')?.addEventListener('input', () => {
        AppState.audit.currentPage = 1;
        fetchAndRenderAuditLogs();
    });
    document.getElementById('btn-audit-prev-page')?.addEventListener('click', () => {
        if (AppState.audit.currentPage > 1) {
            AppState.audit.currentPage--;
            fetchAndRenderAuditLogs();
        }
    });
    document.getElementById('btn-audit-next-page')?.addEventListener('click', () => {
        AppState.audit.currentPage++;
        fetchAndRenderAuditLogs();
    });

    // 6. Diff Viewer Modal Close
    const diffModal = document.getElementById('modal-diff-viewer');
    const closeDiff = () => diffModal?.classList.remove('active');
    document.getElementById('btn-close-diff-modal')?.addEventListener('click', closeDiff);
    document.getElementById('btn-dismiss-diff-modal')?.addEventListener('click', closeDiff);

    // 7. Data Explorer Listeners
    document.getElementById('explorer-table-select')?.addEventListener('change', () => {
        AppState.explorer.currentPage = 1;
        fetchDataExplorerTable();
    });
    document.getElementById('explorer-search-input')?.addEventListener('input', () => {
        AppState.explorer.currentPage = 1;
        fetchDataExplorerTable();
    });
    document.getElementById('btn-explorer-prev-page')?.addEventListener('click', () => {
        if (AppState.explorer.currentPage > 1) {
            AppState.explorer.currentPage--;
            fetchDataExplorerTable();
        }
    });
    document.getElementById('btn-explorer-next-page')?.addEventListener('click', () => {
        AppState.explorer.currentPage++;
        fetchDataExplorerTable();
    });

    // 8. Universal Timeline Listeners
    const timelineModal = document.getElementById('modal-asset-timeline');
    const closeTimeline = () => timelineModal?.classList.remove('active');
    document.getElementById('btn-open-universal-search')?.addEventListener('click', () => openAssetTimeline());
    document.getElementById('btn-close-timeline-modal')?.addEventListener('click', closeTimeline);
    document.getElementById('btn-timeline-search-submit')?.addEventListener('click', () => searchAssetTimeline());
    document.getElementById('timeline-search-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchAssetTimeline();
    });

    // 9. Price History Modal Listeners
    const priceHistModal = document.getElementById('modal-part-price-history');
    const closePriceHist = () => priceHistModal?.classList.remove('active');
    document.getElementById('btn-open-price-history')?.addEventListener('click', () => openPriceHistoryModal('all'));
    document.getElementById('btn-close-price-history-modal')?.addEventListener('click', closePriceHist);

    // 10. Print Modal Listeners
    const printModal = document.getElementById('modal-print-memo');
    const closePrint = () => printModal?.classList.remove('active');
    document.getElementById('btn-close-print-modal')?.addEventListener('click', closePrint);
    document.getElementById('btn-trigger-print')?.addEventListener('click', () => {
        window.print();
    });

    // 11. EOD Detail Modal Listeners
    const eodModal = document.getElementById('modal-eod-detail');
    const closeEOD = () => eodModal?.classList.remove('active');
    document.getElementById('btn-close-eod-modal')?.addEventListener('click', closeEOD);
    document.getElementById('btn-print-eod-day')?.addEventListener('click', () => {
        window.print();
    });

    const eodSubTabs = document.querySelectorAll('.eod-subtab-btn');
    eodSubTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            eodSubTabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.eod-tab-pane').forEach(p => p.style.display = 'none');
            const targetPane = document.getElementById(`eod-pane-${targetTab}`);
            if (targetPane) targetPane.style.display = 'block';
            refreshIcons();
        });
    });

    // 12. Available Spare Parts Modal Listeners
    const availSpModal = document.getElementById('modal-available-spare-parts');
    const closeAvailSp = () => {
        if (availSpModal) {
            availSpModal.classList.remove('active');
            availSpModal.style.display = 'none';
        }
    };
    document.getElementById('btn-close-avail-sp-modal')?.addEventListener('click', closeAvailSp);
    document.getElementById('btn-dismiss-avail-sp-modal')?.addEventListener('click', closeAvailSp);
    document.getElementById('modal-avail-sp-search')?.addEventListener('input', () => renderAvailableSparePartsModalTable());
    document.getElementById('btn-export-avail-sp-excel')?.addEventListener('click', exportAvailableSparePartsToExcel);
    availSpModal?.addEventListener('click', (e) => {
        if (e.target === availSpModal) closeAvailSp();
    });

    // 13. Initial Load
    loadDashboard();
});

// Spare Parts Price History Functions
async function openPriceHistoryModal(specificPart = 'all') {
    const modal = document.getElementById('modal-part-price-history');
    if (!modal) return;
    modal.classList.add('active');

    const filterSelect = document.getElementById('modal-price-history-filter');
    const tableBody = document.getElementById('table-price-history-body');

    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="refresh-cw" class="spin-animation"></i> جاري تحميل سجل الأسعار...</td></tr>`;
        refreshIcons();
    }

    try {
        const res = await fetch(`/api/inventory/spare-parts/price-history`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'فشل جلب سجل الأسعار');

        const history = data.history || [];

        // Populate Part Filter dropdown
        if (filterSelect) {
            const uniqueParts = Array.from(new Set(history.map(h => h.part_name))).sort();
            filterSelect.innerHTML = `<option value="all">كافة قطع الغيار (الكل)</option>` + 
                uniqueParts.map(p => `<option value="${p}" ${p === specificPart ? 'selected' : ''}>${p}</option>`).join('');

            filterSelect.onchange = () => {
                renderPriceHistoryRows(history, filterSelect.value);
            };
        }

        renderPriceHistoryRows(history, specificPart);
    } catch (err) {
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--color-danger);">حدث خطأ أثناء تحميل سجل الأسعار: ${err.message}</td></tr>`;
        }
    }
}
window.openPriceHistoryModal = openPriceHistoryModal;

function renderPriceHistoryRows(history, filterPart = 'all') {
    const tableBody = document.getElementById('table-price-history-body');
    const countBadge = document.getElementById('modal-price-history-count');
    if (!tableBody) return;

    let filtered = history;
    if (filterPart && filterPart !== 'all') {
        filtered = history.filter(h => h.part_name === filterPart);
    }

    if (countBadge) {
        countBadge.textContent = `${filtered.length.toLocaleString('ar-EG')} تعديل مسجل`;
    }

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد تعديلات أسعار مسجلة لهذه القطعة حتى الآن.</td></tr>`;
        return;
    }

    tableBody.innerHTML = filtered.map((h, idx) => {
        const diff = Number(h.new_price) - Number(h.old_price);
        let diffBadge = '';
        if (h.change_source === 'INITIAL_BASELINE') {
            diffBadge = `<span class="badge inmerchant" style="font-size:11px;">سعر أساسي أولي</span>`;
        } else if (diff > 0) {
            diffBadge = `<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); font-size:11px; font-weight:bold;">+${diff.toLocaleString('ar-EG')} جم (زيادة)</span>`;
        } else if (diff < 0) {
            diffBadge = `<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); font-size:11px; font-weight:bold;">${diff.toLocaleString('ar-EG')} جم (تخفيض)</span>`;
        } else {
            diffBadge = `<span class="badge inmerchant" style="font-size:11px;">بدون تغيير</span>`;
        }

        const formattedDate = formatCairoDateTime(h.effective_from || h.created_at || h.change_date);

        return `
            <tr>
                <td style="font-family:var(--font-en); font-weight:bold; color:var(--text-muted);">${filtered.length - idx}</td>
                <td><strong style="color:var(--color-primary);">${h.part_name}</strong></td>
                <td><span style="font-family:var(--font-en); font-size:12px; color:var(--text-secondary);">${h.model || 'PAX S90'}</span></td>
                <td><span style="font-family:var(--font-en); font-weight:600; color:var(--text-muted);">${Number(h.old_price).toLocaleString('ar-EG')} جم</span></td>
                <td><strong style="font-family:var(--font-en); font-weight:800; color:var(--color-success); font-size:13px;">${Number(h.new_price).toLocaleString('ar-EG')} جم</strong></td>
                <td>${diffBadge}</td>
                <td><span style="font-family:var(--font-en); font-size:12px; font-weight:600; color:var(--text-primary);">${formattedDate}</span></td>
                <td><span class="badge ${h.change_source === 'INITIAL_BASELINE' ? 'inmerchant' : 'assigned'}" style="font-size:10px;">${h.change_source === 'INITIAL_BASELINE' ? 'التعريف الأولي' : 'مزامنة Access'}</span></td>
            </tr>
        `;
    }).join('');

    refreshIcons();
}

function copyTextToClipboard(text, successMsg = 'تم نسخ الرابط بنجاح! ✅') {
    if (!text) return;
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(() => {
            if (typeof showGlobalToast === 'function') showGlobalToast(successMsg);
            else alert(successMsg);
        }).catch(() => {
            fallbackCopyText(text, successMsg);
        });
    } else {
        fallbackCopyText(text, successMsg);
    }
}

function fallbackCopyText(text, successMsg) {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (successful) {
            if (typeof showGlobalToast === 'function') showGlobalToast(successMsg);
            else alert(successMsg);
            return;
        }
    } catch (err) {}
    prompt('انسخ الرابط يدوياً:', text);
}

// ==========================================
// 15. CLOUDFLARE ZERO-TRUST TUNNEL CLIENT
// ==========================================
async function checkCloudflareTunnelStatus() {
    try {
        const res = await fetch('/api/tunnel/status');
        const data = await res.json();
        
        const badge = document.getElementById('settings-tunnel-status-badge');
        const input = document.getElementById('settings-tunnel-url');
        const btnOpen = document.getElementById('btn-open-tunnel-url');
        const btnHeaderTunnel = document.getElementById('btn-header-tunnel');

        if (data.success && data.publicUrl) {
            if (badge) {
                badge.innerHTML = `<i data-lucide="check-circle-2" style="width:12px; height:12px; vertical-align:middle;"></i> نفق سحابي متصل ونشط 🌐`;
                badge.className = 'badge inmerchant';
                badge.style.background = 'rgba(16,185,129,0.15)';
                badge.style.color = '#10b981';
                badge.style.borderColor = 'rgba(16,185,129,0.3)';
            }
            if (input) {
                input.value = data.publicUrl;
            }
            if (btnOpen) {
                btnOpen.style.display = 'inline-flex';
                btnOpen.href = data.publicUrl;
            }
            if (btnHeaderTunnel) {
                btnHeaderTunnel.style.display = 'inline-flex';
                btnHeaderTunnel.onclick = () => {
                    copyTextToClipboard(data.publicUrl, `تم نسخ رابط الويب: ${data.publicUrl}`);
                };
            }
        } else if (data.status === 'STARTING') {
            if (badge) badge.innerHTML = `<i data-lucide="loader-2" class="spin-animation" style="width:12px; height:12px; vertical-align:middle;"></i> جاري إنشاء النفق المشفر...`;
            if (input) input.value = 'جاري الاتصال بـ Cloudflare...';
        } else {
            if (badge) {
                badge.innerHTML = `<i data-lucide="circle-slash" style="width:12px; height:12px; vertical-align:middle;"></i> النفق متوقف`;
                badge.className = 'badge faulty';
            }
            if (input) input.value = 'النفق السحابي غير مشغل حالياً';
            if (btnOpen) btnOpen.style.display = 'none';
            if (btnHeaderTunnel) btnHeaderTunnel.style.display = 'none';
        }
        refreshIcons();
    } catch (e) {
        console.error('Tunnel check error:', e);
    }
}
window.checkCloudflareTunnelStatus = checkCloudflareTunnelStatus;

// Copy Tunnel URL button handler
document.addEventListener('DOMContentLoaded', () => {
    const btnCopyTunnel = document.getElementById('btn-copy-tunnel-url');
    if (btnCopyTunnel) {
        btnCopyTunnel.onclick = () => {
            const urlInput = document.getElementById('settings-tunnel-url');
            if (urlInput && urlInput.value && urlInput.value.startsWith('http')) {
                copyTextToClipboard(urlInput.value, `تم نسخ رابط الويب السحابي: ${urlInput.value}`);
                const label = document.getElementById('copy-tunnel-btn-label');
                if (label) {
                    label.textContent = 'تم النسخ بنجاح! ✅';
                    setTimeout(() => {
                        label.textContent = 'نسخ رابط الويب';
                    }, 2500);
                }
            } else {
                if (typeof showGlobalToast === 'function') showGlobalToast('النفق السحابي جاري تجهيزه، يرجى الانتظار ثوانٍ...');
            }
        };
    }

    checkCloudflareTunnelStatus();
    setInterval(checkCloudflareTunnelStatus, 8000);
});

// ==========================================
// 16. INTERACTIVE DRILL-DOWN ANALYTICS CONTROLLER
// ==========================================

function smoothScrollToElement(elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// 1. POS Warehouse Drill-Down
function drilldownWarehouse(opts = {}) {
    const { status, model, search, cardEl, targetTab } = opts;
    if (targetTab) {
        if (typeof switchTab === 'function') switchTab(targetTab);
        return;
    }

    const statusFilter = document.getElementById('wh-table-status-filter');
    const modelFilter = document.getElementById('wh-table-model-filter');
    const searchInput = document.getElementById('wh-table-search-input');

    const isAlreadyActive = cardEl && cardEl.classList.contains('active-drilldown');

    // Clear active highlight on all warehouse cards
    document.querySelectorAll('#tab-branch-warehouse .active-drilldown').forEach(c => c.classList.remove('active-drilldown'));

    if (isAlreadyActive) {
        // Toggle OFF -> Reset filters to default all
        if (statusFilter) statusFilter.value = 'all';
        if (modelFilter) modelFilter.value = 'all';
        if (searchInput) searchInput.value = '';
    } else {
        // Toggle ON -> Apply target filter, cleanly reset sibling filters
        if (cardEl) cardEl.classList.add('active-drilldown');
        if (statusFilter) statusFilter.value = (status !== undefined) ? status : 'all';
        if (modelFilter) modelFilter.value = (model !== undefined) ? model : 'all';
        if (searchInput) searchInput.value = (search !== undefined) ? search : '';
    }

    if (typeof WarehouseTableState !== 'undefined') WarehouseTableState.page = 1;
    if (typeof renderWarehouseDevicesTable === 'function') renderWarehouseDevicesTable();

    smoothScrollToElement('#wh-devices-table');
}
window.drilldownWarehouse = drilldownWarehouse;

// 2. SIM Cards Warehouse Drill-Down
function drilldownSims(opts = {}) {
    const { status, carrier, search, cardEl } = opts;

    const statusFilter = document.getElementById('sims-table-status-filter');
    const carrierFilter = document.getElementById('sims-table-carrier-filter');
    const searchInput = document.getElementById('sims-table-search-input');

    const isAlreadyActive = cardEl && cardEl.classList.contains('active-drilldown');

    document.querySelectorAll('#tab-sim-warehouse .active-drilldown').forEach(c => c.classList.remove('active-drilldown'));

    if (isAlreadyActive) {
        if (statusFilter) statusFilter.value = 'all';
        if (carrierFilter) carrierFilter.value = 'all';
        if (searchInput) searchInput.value = '';
    } else {
        if (cardEl) cardEl.classList.add('active-drilldown');
        if (statusFilter) statusFilter.value = (status !== undefined) ? status : 'all';
        if (carrierFilter) carrierFilter.value = (carrier !== undefined) ? carrier : 'all';
        if (searchInput) searchInput.value = (search !== undefined) ? search : '';
    }

    if (typeof SimsTableState !== 'undefined') SimsTableState.page = 1;
    if (typeof renderSimsDevicesTable === 'function') renderSimsDevicesTable();

    smoothScrollToElement('#sims-devices-table');
}
window.drilldownSims = drilldownSims;

// 3. HQ Central Maintenance Drill-Down
function drilldownHq(opts = {}) {
    const { status, search, cardEl, targetTab } = opts;
    if (targetTab) {
        if (typeof switchTab === 'function') switchTab(targetTab);
        return;
    }

    const statusFilter = document.getElementById('hq-table-status-filter');
    const searchInput = document.getElementById('hq-table-search-input');

    const isAlreadyActive = cardEl && cardEl.classList.contains('active-drilldown');

    document.querySelectorAll('#tab-hq-maintenance .active-drilldown').forEach(c => c.classList.remove('active-drilldown'));

    if (isAlreadyActive) {
        if (statusFilter) statusFilter.value = 'all';
        if (searchInput) searchInput.value = '';
    } else {
        if (cardEl) cardEl.classList.add('active-drilldown');
        if (statusFilter) statusFilter.value = (status !== undefined) ? status : 'all';
        if (searchInput) searchInput.value = (search !== undefined) ? search : '';
    }

    if (typeof HqTableState !== 'undefined') HqTableState.page = 1;
    if (typeof renderHqDispatchesTable === 'function') renderHqDispatchesTable();

    smoothScrollToElement('#hq-dispatches-table');
}
window.drilldownHq = drilldownHq;

// 4. Installments Portfolio Drill-Down
function drilldownInstallments(opts = {}) {
    const { status, duration, gov, search, cardEl } = opts;

    const statusFilter = document.getElementById('inst-table-status-filter');
    const durationFilter = document.getElementById('inst-table-duration-filter');
    const govFilter = document.getElementById('inst-table-gov-filter');
    const searchInput = document.getElementById('inst-table-search-input');

    const isAlreadyActive = cardEl && cardEl.classList.contains('active-drilldown');

    document.querySelectorAll('#tab-installments .active-drilldown').forEach(c => c.classList.remove('active-drilldown'));

    if (isAlreadyActive) {
        if (statusFilter) statusFilter.value = 'all';
        if (durationFilter) durationFilter.value = 'all';
        if (govFilter) govFilter.value = 'all';
        if (searchInput) searchInput.value = '';
    } else {
        if (cardEl) cardEl.classList.add('active-drilldown');
        if (statusFilter) statusFilter.value = (status !== undefined) ? status : 'all';
        if (durationFilter) durationFilter.value = (duration !== undefined) ? duration : 'all';
        if (govFilter) govFilter.value = (gov !== undefined) ? gov : 'all';
        if (searchInput) searchInput.value = (search !== undefined) ? search : '';
    }

    if (typeof InstallmentsTableState !== 'undefined') InstallmentsTableState.page = 1;
    if (typeof renderInstallmentsTable === 'function') renderInstallmentsTable();

    smoothScrollToElement('#inst-contracts-table');
}
window.drilldownInstallments = drilldownInstallments;

// 5. Spare Parts Inventory Drill-Down
function drilldownSpareParts(opts = {}) {
    if (opts.showStockModal) {
        if (typeof openAvailableSparePartsModal === 'function') {
            openAvailableSparePartsModal();
        }
        return;
    }

    const { paymentStatus, movementType, partType, search, cardEl } = opts;

    const payFilter = document.getElementById('sp-payment-status-filter');
    const moveFilter = document.getElementById('sp-movement-type-filter');
    const partFilter = document.getElementById('sp-part-type-filter');
    const searchInput = document.getElementById('sp-search-input');

    const isAlreadyActive = cardEl && cardEl.classList.contains('active-drilldown');

    document.querySelectorAll('#tab-spare-parts-inventory .active-drilldown').forEach(c => c.classList.remove('active-drilldown'));

    if (isAlreadyActive) {
        if (payFilter) payFilter.value = 'all';
        if (moveFilter) moveFilter.value = 'all';
        if (partFilter) partFilter.value = 'all';
        if (searchInput) searchInput.value = '';
    } else {
        if (cardEl) cardEl.classList.add('active-drilldown');
        if (payFilter) payFilter.value = (paymentStatus !== undefined) ? paymentStatus : 'all';
        if (moveFilter) moveFilter.value = (movementType !== undefined) ? movementType : 'all';
        if (partFilter) partFilter.value = (partType !== undefined) ? partType : 'all';
        if (searchInput) searchInput.value = (search !== undefined) ? search : '';
    }

    if (typeof loadSparePartsInventory === 'function') loadSparePartsInventory(1);

    smoothScrollToElement('#sp-movements-table');
}
window.drilldownSpareParts = drilldownSpareParts;

// ==========================================================================
// 17. HEADER DATABASE STATUS INDICATOR (GREEN / RED HEALTH MONITOR)
// ==========================================================================
function updateHeaderDatabaseStatus(isOnline, dbName, errorMessage, outboxPendingCount = 0) {
    const pill = document.getElementById('header-db-pill');
    const statusText = document.getElementById('header-db-status');
    if (!pill || !statusText) return;

    if (!isOnline) {
        pill.classList.remove('online', 'warning');
        pill.classList.add('offline');
        statusText.textContent = 'الآكسيس غير متصل ⚠️';
        pill.title = errorMessage || 'المزامنة متوقفة / تعذر الاتصال بملف الآكسيس ❌';
    } else if (outboxPendingCount > 0) {
        pill.classList.remove('online', 'offline');
        pill.classList.add('warning');
        statusText.textContent = `${dbName || 'الآكسيس'} (جاري دفع ${outboxPendingCount} حركات ⏳)`;
        pill.title = `تم حفظ ${outboxPendingCount} تعديلات محلياً وجاري المحاولة التلقائية لدفعها إلى السيرفر السحابي (VPS) ☁️`;
    } else {
        pill.classList.remove('offline', 'warning');
        pill.classList.add('online');
        statusText.textContent = dbName || 'Bread_Final_be.accdb';
        pill.title = 'قاعدة بيانات الآكسيس متصلة والمزامنة التلقائية مع السحابة نشطة 24/7 ✅';
    }
}
window.updateHeaderDatabaseStatus = updateHeaderDatabaseStatus;

async function checkSyncHealth() {
    if (document.hidden) return; // Skip polling when tab is in background
    try {
        const res = await fetch('/api/sync/status');
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        const data = await res.json();
        
        // Healthy if status is NOT error and data.success is not false
        const isHealthy = data && data.status !== 'error' && data.success !== false;
        const fileName = (data && data.accessFilePath) ? data.accessFilePath.split(/[\\/]/).pop() : 'Bread_Final_be.accdb';
        const pendingCount = data.outboxPendingCount || 0;
        updateHeaderDatabaseStatus(isHealthy, fileName, data?.message, pendingCount);
    } catch (err) {
        updateHeaderDatabaseStatus(false, null, 'تعذر الاتصال بالسيرفر أو ملف الآكسيس');
    }
}
window.checkSyncHealth = checkSyncHealth;

// ==========================================================================
// 18. FONT CUSTOMIZATION SYSTEM (GOOGLE FONTS ARABIC ENGINE)
// ==========================================================================
const AVAILABLE_FONTS = [
    {
        id: 'cairo',
        name: 'Cairo (كايرا)',
        family: "'Cairo', 'Tajawal', sans-serif",
        desc: 'الخط الافتراضي الرسمي - واضح وأنيق ومتوازن للقراءة',
        sample: 'نظام إدارة ومتابعة بلاغات الصيانة لخدمة عملاء المخابز الذكية'
    },
    {
        id: 'alexandria',
        name: 'Alexandria (الإسكندرية)',
        family: "'Alexandria', sans-serif",
        desc: 'خط هندسي حديث فائق الأناقة ومميز للواجهات العصرية',
        sample: 'نظام إدارة ومتابعة بلاغات الصيانة لخدمة عملاء المخابز الذكية'
    },
    {
        id: 'tajawal',
        name: 'Tajawal (تجوال)',
        family: "'Tajawal', sans-serif",
        desc: 'خط سلس وناعم ومريح جداً للعين أثناء العمل الطويل',
        sample: 'نظام إدارة ومتابعة بلاغات الصيانة لخدمة عملاء المخابز الذكية'
    },
    {
        id: 'almarai',
        name: 'Almarai (المراعي)',
        family: "'Almarai', sans-serif",
        desc: 'خط مؤسسي رسمي واضح ومثالي للتقارير والبيانات الإدارية',
        sample: 'نظام إدارة ومتابعة بلاغات الصيانة لخدمة عملاء المخابز الذكية'
    },
    {
        id: 'readex',
        name: 'Readex Pro (ريدكس برو)',
        family: "'Readex Pro', sans-serif",
        desc: 'خط تقني متطور ممتاز للأرقام والجداول واللوحات التحليلية',
        sample: 'نظام إدارة ومتابعة بلاغات الصيانة لخدمة عملاء المخابز الذكية'
    },
    {
        id: 'ibm-plex',
        name: 'IBM Plex Sans Arabic (آي بي إم)',
        family: "'IBM Plex Sans Arabic', sans-serif",
        desc: 'خط برمجي وهندسي دقيق وعالي الوضوح في الشاشات',
        sample: 'نظام إدارة ومتابعة بلاغات الصيانة لخدمة عملاء المخابز الذكية'
    },
    {
        id: 'noto-sans',
        name: 'Noto Sans Arabic (نوتو سانس)',
        family: "'Noto Sans Arabic', sans-serif",
        desc: 'خط جوجل العالمي الموحد لكل الأجهزة والشاشات',
        sample: 'نظام إدارة ومتابعة بلاغات الصيانة لخدمة عملاء المخابز الذكية'
    }
];

function initFontSystem() {
    const savedFontId = localStorage.getItem('smartcs_custom_font') || 'cairo';
    applyFont(savedFontId, false);
    renderFontSelectionCards();
}

function applyFont(fontId, saveToStorage = true) {
    const fontObj = AVAILABLE_FONTS.find(f => f.id === fontId) || AVAILABLE_FONTS[0];
    document.documentElement.style.setProperty('--font-ar', fontObj.family);
    
    if (saveToStorage) {
        localStorage.setItem('smartcs_custom_font', fontObj.id);
    }

    // Update active badges in settings
    const activeBadge = document.getElementById('preview-active-font-name');
    if (activeBadge) activeBadge.textContent = fontObj.name;

    document.querySelectorAll('.font-card').forEach(card => {
        if (card.dataset.fontId === fontObj.id) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });
}

function renderFontSelectionCards() {
    const container = document.getElementById('font-selection-container');
    if (!container) return;

    const currentFontId = localStorage.getItem('smartcs_custom_font') || 'cairo';

    container.innerHTML = AVAILABLE_FONTS.map(f => {
        const isActive = f.id === currentFontId;
        return `
            <div class="font-card ${isActive ? 'active' : ''}" data-font-id="${f.id}" onclick="switchAppFont('${f.id}')" style="font-family:${f.family};">
                <div class="font-card-header">
                    <div class="font-card-title">${f.name}</div>
                    ${isActive ? '<span class="badge inmerchant" style="font-size:10px; font-weight:700;"><i data-lucide="check" style="width:10px;height:10px;vertical-align:middle;"></i> مفعل</span>' : ''}
                </div>
                <div class="font-card-desc">${f.desc}</div>
                <div class="font-card-sample" style="font-family:${f.family};">
                    ${f.sample}
                    <div style="margin-top:4px; font-weight:700; font-size:12px; color:var(--color-primary);">123,456.78 جم • 24-08-2026</div>
                </div>
            </div>
        `;
    }).join('');

    refreshIcons();
}

function switchAppFont(fontId) {
    applyFont(fontId, true);
    renderFontSelectionCards();
}
window.switchAppFont = switchAppFont;

function resetAppFont() {
    switchAppFont('cairo');
}
window.resetAppFont = resetAppFont;

// ==========================================================================
// 19. SETTINGS SUBTABS & SYNC TELEMETRY LOGS VIEWER
// ==========================================================================
function switchSettingsSubtab(subtabId) {
    // 1. Update buttons
    document.querySelectorAll('.settings-subtab-btn').forEach(btn => {
        if (btn.dataset.subtab === subtabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 2. Update panes
    const paneMap = {
        'settings-db': 'pane-settings-db',
        'settings-fonts': 'pane-settings-fonts',
        'settings-sync-logs': 'pane-settings-sync-logs',
        'settings-updates': 'pane-settings-updates',
        'settings-diagnostics': 'pane-settings-diagnostics'
    };

    Object.entries(paneMap).forEach(([key, paneId]) => {
        const paneEl = document.getElementById(paneId);
        if (!paneEl) return;
        if (key === subtabId) {
            paneEl.style.display = 'block';
            paneEl.classList.add('active');
        } else {
            paneEl.style.display = 'none';
            paneEl.classList.remove('active');
        }
    });

    // If switching to subtab, fetch fresh data
    if (subtabId === 'settings-sync-logs') {
        loadSyncTelemetryLogs();
    } else if (subtabId === 'settings-fonts') {
        renderFontSelectionCards();
    } else if (subtabId === 'settings-updates') {
        loadSystemVersionInfo();
    } else if (subtabId === 'settings-diagnostics') {
        loadDiagnosticsDashboard();
    }

    refreshIcons();
}
window.switchSettingsSubtab = switchSettingsSubtab;

async function loadSystemVersionInfo() {
    try {
        const res = await fetch('/api/system/version');
        const data = await res.json();
        if (data.success) {
            const verEl = document.getElementById('settings-app-version');
            const commitEl = document.getElementById('settings-app-commit');
            const dateEl = document.getElementById('settings-app-date');
            const branchEl = document.getElementById('settings-app-branch');
            const msgEl = document.getElementById('settings-app-msg');

            if (verEl) verEl.textContent = `v${data.version}`;
            if (commitEl) commitEl.textContent = `#${data.commit}`;
            if (dateEl) dateEl.textContent = data.date || '-';
            if (branchEl) branchEl.textContent = data.branch || 'main';
            if (msgEl) msgEl.textContent = data.message || '-';
        }
    } catch (err) {
        console.warn('Error loading system version:', err);
    }
}
window.loadSystemVersionInfo = loadSystemVersionInfo;

async function checkGitHubUpdates(manual = false) {
    const spinIcon = document.getElementById('icon-check-updates-spin');
    const resultMsg = document.getElementById('settings-update-result-msg');
    const applyBtn = document.getElementById('btn-apply-github-update');
    const badgeEl = document.getElementById('settings-git-status-badge');

    if (spinIcon) spinIcon.classList.add('spin-animation');
    if (resultMsg) {
        resultMsg.style.display = 'block';
        resultMsg.innerHTML = '<span style="color:var(--md-sys-color-primary);"><i data-lucide="loader-2" class="spin-animation" style="width:12px;height:12px;vertical-align:middle;"></i> جاري الاتصال بمستودع GitHub للتحقق من التحديثات...</span>';
    }
    refreshIcons();

    try {
        const res = await fetch('/api/system/check-updates');
        const data = await res.json();

        if (spinIcon) spinIcon.classList.remove('spin-animation');

        if (!data.success) {
            if (resultMsg) resultMsg.innerHTML = `<span style="color:#ef4444;"><i data-lucide="alert-circle" style="width:12px;height:12px;vertical-align:middle;"></i> ${data.error || 'تعذر التحقق من التحديثات'}</span>`;
            return;
        }

        if (data.has_update) {
            if (badgeEl) {
                badgeEl.className = 'badge warning';
                badgeEl.innerHTML = `<i data-lucide="download" style="width:12px;height:12px;vertical-align:middle;"></i> يتوفر تحديث جديد (#${data.remote_commit})`;
            }
            if (applyBtn) applyBtn.style.display = 'inline-flex';
            if (resultMsg) {
                resultMsg.innerHTML = `
                    <div style="padding:12px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:8px;">
                        <strong style="color:#10b981; display:block; margin-bottom:4px;">🌟 يوجد تحديث جديد متاح على GitHub!</strong>
                        <div style="font-size:11.5px; color:var(--text-primary);">
                            <span>الكوميت الأخير: <code style="font-family:var(--font-en); font-weight:bold;">#${data.remote_commit}</code></span> | 
                            <span>التاريخ: ${data.remote_date}</span>
                        </div>
                        <div style="font-size:11px; color:var(--text-secondary); margin-top:3px;">
                            ${data.remote_message}
                        </div>
                    </div>
                `;
            }
        } else {
            if (badgeEl) {
                badgeEl.className = 'badge inmerchant';
                badgeEl.innerHTML = `<i data-lucide="check-circle" style="width:12px; height:12px; vertical-align:middle;"></i> الإصدار الأحدث ✅`;
            }
            if (applyBtn) applyBtn.style.display = 'none';
            if (resultMsg) {
                resultMsg.innerHTML = `<span style="color:#10b981; font-weight:bold;"><i data-lucide="check" style="width:13px;height:13px;vertical-align:middle;"></i> ${data.message || 'أنت تعمل على أحدث إصدار معتمد من GitHub ✅'}</span>`;
            }
        }
    } catch (err) {
        if (spinIcon) spinIcon.classList.remove('spin-animation');
        if (resultMsg) resultMsg.innerHTML = `<span style="color:#ef4444;"><i data-lucide="alert-circle" style="width:12px;height:12px;vertical-align:middle;"></i> خطأ بالاتصال: ${err.message}</span>`;
    }

    refreshIcons();
}
window.checkGitHubUpdates = checkGitHubUpdates;

async function applyGitHubUpdate() {
    const applyBtn = document.getElementById('btn-apply-github-update');
    const resultMsg = document.getElementById('settings-update-result-msg');

    if (!confirm('هل تريد تطبيق التحديث الآن من GitHub؟ سيتم سحب أحدث كود وإعادة تشغيل المنظومة تلقائياً.')) return;

    if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.innerHTML = '<i data-lucide="loader-2" class="spin-animation"></i> <span>جاري سحب التحديث وتثبيته...</span>';
    }
    if (resultMsg) {
        resultMsg.innerHTML = '<span style="color:var(--color-primary);"><i data-lucide="loader-2" class="spin-animation"></i> جاري تحديث الملفات وتثبيت الحزم... يرجى الانتظار</span>';
    }
    refreshIcons();

    try {
        const res = await fetch('/api/system/auto-update', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            if (resultMsg) {
                resultMsg.innerHTML = '<span style="color:#10b981; font-weight:bold;"><i data-lucide="check-circle"></i> تم التحديث بنجاح! جاري إعادة تحميل الصفحة...</span>';
            }
            setTimeout(() => {
                window.location.reload();
            }, 2500);
        } else {
            if (applyBtn) {
                applyBtn.disabled = false;
                applyBtn.innerHTML = '<i data-lucide="download-cloud"></i> <span>إعادة المحاولة 🚀</span>';
            }
            if (resultMsg) {
                resultMsg.innerHTML = `<span style="color:#ef4444;"><i data-lucide="alert-circle"></i> فشل التحديث: ${data.error}</span>`;
            }
        }
    } catch (err) {
        if (resultMsg) {
            resultMsg.innerHTML = '<span style="color:#10b981; font-weight:bold;"><i data-lucide="refresh-cw" class="spin-animation"></i> تم إرسال أمر التحديث! جاري إعادة إقلاع السيرفر...</span>';
        }
        setTimeout(() => {
            window.location.reload();
        }, 3000);
    }
    refreshIcons();
}
window.applyGitHubUpdate = applyGitHubUpdate;

async function loadSyncTelemetryLogs() {
    const tableBody = document.getElementById('sync-telemetry-table-body');
    const refreshIcon = document.getElementById('icon-sync-log-refresh');
    const filterType = document.getElementById('sync-log-filter-type')?.value || 'ALL';

    if (refreshIcon) refreshIcon.classList.add('spin-animation');
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="loader-2" class="spin-animation"></i> جاري جلب وتحديث سجلات المزامنة...</td></tr>`;
    refreshIcons();

    try {
        const res = await fetch(`/api/sync/telemetry-logs?type=${encodeURIComponent(filterType)}`);
        const data = await res.json();

        if (!res.ok || !data.success) throw new Error(data.error || 'فشل جلب سجلات المزامنة');

        const logs = data.logs || [];
        if (!tableBody) return;

        if (logs.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">لا توجد سجلات مزامنة مسجلة حتى الآن.</td></tr>`;
            return;
        }

        tableBody.innerHTML = logs.map((log, idx) => {
            const isCloud = log.sync_type === 'CLOUD_VPS';
            const typeBadge = isCloud 
                ? `<span class="badge" style="background:rgba(59,130,246,0.15); color:#3b82f6; border:1px solid rgba(59,130,246,0.3); font-weight:700;"><i data-lucide="cloud" style="width:11px;height:11px;vertical-align:middle;margin-left:3px;"></i> سحابي (VPS Delta) ☁️</span>`
                : `<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); font-weight:700;"><i data-lucide="database" style="width:11px;height:11px;vertical-align:middle;margin-left:3px;"></i> محلي (Access Share) 🖥️</span>`;

            const isSuccess = log.status === 'SUCCESS';
            const statusBadge = isSuccess
                ? `<span class="badge inmerchant" style="font-weight:700;"><i data-lucide="check-circle" style="width:11px;height:11px;vertical-align:middle;margin-left:3px;"></i> ناجحة ✅</span>`
                : `<span class="badge faulty" style="font-weight:700;"><i data-lucide="alert-triangle" style="width:11px;height:11px;vertical-align:middle;margin-left:3px;"></i> تعثرت ❌</span>`;

            const formattedTime = formatCairoDateTime(log.sync_time || log.timestamp || new Date().toISOString());
            const durationText = log.duration_ms ? `${log.duration_ms} ms` : '-';
            const deltaCount = log.changes_count !== undefined ? Number(log.changes_count).toLocaleString('ar-EG') : '0';
            const tablesCount = log.tables_count !== undefined ? `${log.tables_count} جداول` : '-';

            return `
                <tr>
                    <td style="font-family:var(--font-en); font-weight:700; color:var(--text-muted);">${idx + 1}</td>
                    <td>${typeBadge}</td>
                    <td>${formattedTime}</td>
                    <td>${statusBadge}</td>
                    <td style="font-weight:700;">${tablesCount}</td>
                    <td><strong style="font-family:var(--font-en); color:${log.changes_count > 0 ? 'var(--color-primary)' : 'var(--text-muted)'};">${deltaCount}</strong></td>
                    <td style="font-family:var(--font-en); font-size:11px; color:var(--text-muted);">${durationText}</td>
                    <td style="font-size:12px; color:var(--text-primary); max-width:300px; white-space:normal;">${log.message || log.details || '-'}</td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error("Telemetry logs error:", err);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-critical); padding:25px;">خطأ في جلب السجلات: ${err.message}</td></tr>`;
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('spin-animation');
        refreshIcons();
    }
}
window.loadSyncTelemetryLogs = loadSyncTelemetryLogs;

// ==========================================================================
// AVAILABLE SPARE PARTS INVENTORY MODAL (الرصيد المتاح > 0)
// ==========================================================================
async function openAvailableSparePartsModal() {
    const modal = document.getElementById('modal-available-spare-parts');
    if (!modal) {
        console.error("modal-available-spare-parts not found!");
        return;
    }

    modal.classList.add('active');
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    modal.style.zIndex = '999999';

    if (!sparePartsDataCache || !sparePartsDataCache.parts_breakdown) {
        const tbody = document.getElementById('modal-avail-sp-tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="refresh-cw" class="spin-animation" style="width:16px;height:16px;vertical-align:middle;"></i> جاري تحميل بيانات الرصيد من السيرفر...</td></tr>`;
        if (typeof refreshIcons === 'function') refreshIcons();
        
        try {
            const res = await fetch('/api/inventory/spare-parts-dashboard');
            const data = await res.json();
            if (data.success) {
                sparePartsDataCache = data;
            }
        } catch (e) {
            console.error("Error loading spare parts for modal:", e);
        }
    }

    renderAvailableSparePartsModalTable();

    // Bind listeners once
    if (!window.availSpModalBound) {
        document.getElementById('btn-close-avail-sp-modal')?.addEventListener('click', closeAvailableSparePartsModal);
        document.getElementById('btn-dismiss-avail-sp-modal')?.addEventListener('click', closeAvailableSparePartsModal);
        document.getElementById('modal-avail-sp-search')?.addEventListener('input', () => renderAvailableSparePartsModalTable());
        document.getElementById('btn-export-avail-sp-excel')?.addEventListener('click', exportAvailableSparePartsToExcel);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeAvailableSparePartsModal();
        });
        window.availSpModalBound = true;
    }
}
window.openAvailableSparePartsModal = openAvailableSparePartsModal;

function closeAvailableSparePartsModal() {
    const modal = document.getElementById('modal-available-spare-parts');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
        modal.style.opacity = '0';
        modal.style.visibility = 'hidden';
    }
}
window.closeAvailableSparePartsModal = closeAvailableSparePartsModal;

function renderAvailableSparePartsModalTable() {
    const tbody = document.getElementById('modal-avail-sp-tbody');
    const searchVal = (document.getElementById('modal-avail-sp-search')?.value || '').trim().toLowerCase();
    const totalPiecesBadge = document.getElementById('modal-avail-sp-total-pieces');
    const typesCountBadge = document.getElementById('modal-avail-sp-types-count');
    if (!tbody) return;

    if (!sparePartsDataCache || !sparePartsDataCache.parts_breakdown) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);">جاري تحميل بيانات الرصيد من السيرفر...</td></tr>`;
        return;
    }

    // Filter strictly to current_stock > 0
    let list = sparePartsDataCache.parts_breakdown.filter(p => Number(p.current_stock || 0) > 0);

    if (searchVal) {
        list = list.filter(p => p.part_name && p.part_name.toLowerCase().includes(searchVal));
    }

    // Sort descending by current_stock
    list.sort((a, b) => Number(b.current_stock || 0) - Number(a.current_stock || 0));

    const totalAvailablePieces = list.reduce((sum, p) => sum + Number(p.current_stock || 0), 0);
    if (totalPiecesBadge) totalPiecesBadge.textContent = `${totalAvailablePieces.toLocaleString('ar-EG')} قطعة متوفرة`;
    if (typesCountBadge) typesCountBadge.textContent = `${list.length} صنف متوفر`;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:35px; color:var(--text-muted);">لا توجد قطع غيار متوفرة مطابقة للبحث أو رصيدها أكبر من الصفر.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((p, idx) => {
        const stock = Number(p.current_stock || 0);
        let statusBadge = stock >= 10 
            ? `<span class="badge inmerchant" style="font-weight:700;"><i data-lucide="check-circle" style="width:11px; height:11px; vertical-align:middle; margin-left:3px;"></i> متوفر بوفرة</span>`
            : `<span class="badge warning" style="font-weight:700;"><i data-lucide="alert-triangle" style="width:11px; height:11px; vertical-align:middle; margin-left:3px;"></i> كمية محدودة</span>`;

        return `
            <tr>
                <td style="font-family:var(--font-en); color:var(--text-muted); font-weight:700;">${idx + 1}</td>
                <td>
                    <strong style="color:var(--md-sys-color-primary); font-size:13px;">${p.part_name}</strong>
                </td>
                <td style="font-family:var(--font-en); font-weight:700; color:#10b981;">${Number(p.unit_price || 0).toLocaleString('ar-EG')} جم</td>
                <td>
                    <span class="badge inmerchant" style="font-family:var(--font-en); font-size:13px; font-weight:800; padding:4px 10px;">
                        ${stock.toLocaleString('ar-EG')} قطعة
                    </span>
                </td>
                <td style="font-family:var(--font-en); font-weight:600; color:var(--md-sys-color-on-surface-variant);">${Number(p.total_in || 0).toLocaleString('ar-EG')}</td>
                <td style="font-family:var(--font-en); font-weight:600; color:#a855f7;">${Number(p.total_out || 0).toLocaleString('ar-EG')}</td>
                <td>${statusBadge}</td>
                <td>
                    <button type="button" class="btn btn-secondary" onclick="closeAvailableSparePartsModal(); filterSparePartsByType('${p.part_name}');" style="padding:4px 8px; font-size:11px;" title="عرض سجل حركات ${p.part_name}">
                        <i data-lucide="list" style="width:11px; height:11px;"></i> الحركات
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    refreshIcons();
}
window.renderAvailableSparePartsModalTable = renderAvailableSparePartsModalTable;

function exportAvailableSparePartsToExcel() {
    if (!sparePartsDataCache || !sparePartsDataCache.parts_breakdown) {
        alert("لا توجد بيانات متاحة للتصدير");
        return;
    }

    const list = sparePartsDataCache.parts_breakdown.filter(p => Number(p.current_stock || 0) > 0);
    list.sort((a, b) => Number(b.current_stock || 0) - Number(a.current_stock || 0));

    const rows = list.map((p, idx) => ({
        "م": idx + 1,
        "اسم قطعة الغيار": p.part_name,
        "سعر القطعة (جم)": p.unit_price,
        "الرصيد المتاح حالياً بالمخزن": p.current_stock,
        "إجمالي الوارد التراكمي": p.total_in,
        "إجمالي المنصرف": p.total_out,
        "منصرف بمقابل": p.paid_count,
        "منصرف مجاني": p.free_count,
        "إجمالي الإيراد المحصل (جم)": p.total_revenue,
        "نسبة الاستهلاك (%)": p.consumption_rate_pct
    }));

    if (window.XLSX) {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "جرد الرصيد المتاح بالمخزن");
        XLSX.writeFile(wb, `بيان_جرد_قطع_الغيار_المتوفرة_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } else {
        const headers = Object.keys(rows[0]).join(",");
        const csvContent = "\uFEFF" + [headers, ...rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\r\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `بيان_جرد_قطع_الغيار_المتوفرة_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
    }
}
window.exportAvailableSparePartsToExcel = exportAvailableSparePartsToExcel;

// ==========================================================================
// 6. CUSTOMER 360 CRM & ASSET DEEP-DIVE CONTROLLERS
// ==========================================================================

let activeCustomerProfile = null;
let custSearchDebounceTimer = null;
let currentDeviceDeepdiveData = null;

function initCustomerManagement() {
    initCustomerSearch();
    initDeviceDeepdiveModal();
}
window.initCustomerManagement = initCustomerManagement;

function initCustomerSearch() {
    const input = document.getElementById('cust-search-input');
    const suggestionsBox = document.getElementById('cust-search-suggestions');
    const clearBtn = document.getElementById('btn-clear-cust-search');

    if (!input || input.dataset.bound) return;
    input.dataset.bound = "true";

    input.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';

        clearTimeout(custSearchDebounceTimer);
        if (val.length < 2) {
            if (suggestionsBox) {
                suggestionsBox.style.display = 'none';
                suggestionsBox.innerHTML = '';
            }
            return;
        }

        custSearchDebounceTimer = setTimeout(async () => {
            await fetchCustomerSuggestions(val);
        }, 220);
    });

    clearBtn?.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        if (suggestionsBox) suggestionsBox.style.display = 'none';
        input.focus();
    });

    ['click', 'touchstart', 'pointerdown'].forEach(evt => {
        document.addEventListener(evt, (e) => {
            if (!input.contains(e.target) && !suggestionsBox?.contains(e.target)) {
                if (suggestionsBox) suggestionsBox.style.display = 'none';
            }
        }, { passive: true });
    });

    input.addEventListener('focus', () => {
        if (input.value.trim().length >= 2 && suggestionsBox && suggestionsBox.children.length > 0) {
            suggestionsBox.style.display = 'block';
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const firstItem = suggestionsBox?.querySelector('.cust-suggestion-item');
            if (firstItem) {
                firstItem.click();
            }
        }
    });
}

async function fetchCustomerSuggestions(q) {
    const suggestionsBox = document.getElementById('cust-search-suggestions');
    if (!suggestionsBox) return;

    try {
        suggestionsBox.innerHTML = `<div style="padding:14px; text-align:center; color:var(--text-muted); font-size:12px;"><i data-lucide="refresh-cw" class="spin-animation" style="width:14px; height:14px; vertical-align:middle;"></i> جاري البحث الفوري في سجلات العملاء والماكينات...</div>`;
        suggestionsBox.style.display = 'block';
        if (typeof refreshIcons === 'function') refreshIcons();

        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();

        if (!data.success || !data.results || data.results.length === 0) {
            suggestionsBox.innerHTML = `
                <div style="padding:16px; text-align:center; color:var(--text-muted); font-size:12px;">
                    <i data-lucide="alert-circle" style="width:16px; height:16px; vertical-align:middle; margin-left:4px; color:#f59e0b;"></i>
                    لا توجد نتائج مطابقة لـ "${q}"
                </div>
            `;
            if (typeof refreshIcons === 'function') refreshIcons();
            return;
        }

        suggestionsBox.innerHTML = data.results.map(item => {
            let posBadge = '';
            if (item.pos_serials && item.pos_serials.length > 0) {
                if (item.pos_serials.length <= 2) {
                    posBadge = `<span class="badge inmerchant" style="font-family:var(--font-en); font-size:10px; padding:1px 6px;">POS: ${item.pos_serials.join(', ')}</span>`;
                } else {
                    posBadge = `<span class="badge inmerchant" style="font-family:var(--font-en); font-size:10px; padding:1px 6px;">POS: ${item.pos_serials[0]} (+${item.pos_serials.length - 1})</span>`;
                }
            }

            let simBadge = '';
            if (item.sim_serials && item.sim_serials.length > 0) {
                if (item.sim_serials.length === 1) {
                    const s = String(item.sim_serials[0]);
                    const displaySim = s.length > 10 ? `...${s.slice(-7)}` : s;
                    simBadge = `<span class="badge" style="background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.3); font-family:var(--font-en); font-size:10px; padding:1px 6px;">SIM: ${displaySim}</span>`;
                } else {
                    simBadge = `<span class="badge" style="background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.3); font-family:var(--font-en); font-size:10px; padding:1px 6px;">${item.sim_serials.length} شرائح SIM</span>`;
                }
            }

            return `
                <div class="cust-suggestion-item" onclick="selectCustomerResult('${item.merchant_code}')" style="padding:10px 14px; border-bottom:1px solid var(--md-sys-color-outline-variant); cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px; transition:background 0.15s ease;" onmouseover="this.style.background='var(--md-sys-color-surface-container-high)'" onmouseout="this.style.background='transparent'">
                    <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                        <div style="width:32px; height:32px; border-radius:10px; background:rgba(37,99,235,0.15); color:#2563eb; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                            <i data-lucide="store" style="width:16px; height:16px;"></i>
                        </div>
                        <div style="min-width:0;">
                            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                <strong style="font-size:13px; color:var(--md-sys-color-on-surface); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">${item.merchant_name}</strong>
                                <span class="badge inmerchant" style="font-family:var(--font-en); font-size:10px; padding:1px 5px;">#${item.merchant_code}</span>
                                <span class="badge" style="background:rgba(245,158,11,0.15); color:#f59e0b; font-size:10px; padding:1px 5px;">${item.government}</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:6px; margin-top:3px; flex-wrap:wrap;">
                                <span style="font-size:10px; color:var(--text-muted);">${item.matched_field}</span>
                                ${posBadge}
                                ${simBadge}
                            </div>
                        </div>
                    </div>
                    <div style="color:var(--md-sys-color-primary); flex-shrink:0;">
                        <i data-lucide="chevron-left" style="width:16px; height:16px;"></i>
                    </div>
                </div>
            `;
        }).join('');

        if (typeof refreshIcons === 'function') refreshIcons();

    } catch (err) {
        console.error("Suggestions error:", err);
        suggestionsBox.innerHTML = `<div style="padding:14px; text-align:center; color:#ef4444; font-size:12px;">حدث خطأ أثناء البحث</div>`;
    }
}

async function selectCustomerResult(merchantCode) {
    clearTimeout(custSearchDebounceTimer);
    const suggestionsBox = document.getElementById('cust-search-suggestions');
    if (suggestionsBox) {
        suggestionsBox.style.display = 'none';
        suggestionsBox.innerHTML = '';
    }

    const input = document.getElementById('cust-smart-search-input');
    if (input) {
        input.blur(); // Hide virtual keyboard on mobile
    }

    await loadCustomerProfile(merchantCode);
}
window.selectCustomerResult = selectCustomerResult;

async function loadCustomerProfile(merchantCode) {
    const emptyPrompt = document.getElementById('cust-empty-prompt');
    const profileContainer = document.getElementById('cust-profile-container');
    const suggestionsBox = document.getElementById('cust-search-suggestions');
    if (suggestionsBox) {
        suggestionsBox.style.display = 'none';
        suggestionsBox.innerHTML = '';
    }

    if (!profileContainer) return;

    if (emptyPrompt) emptyPrompt.style.display = 'none';
    profileContainer.style.display = 'block';

    // Show loading state in header
    document.getElementById('cust-profile-name').textContent = 'جاري تحميل ملف العميل...';
    document.getElementById('cust-profile-code-badge').textContent = `#${merchantCode}`;

    // Smooth scroll into view on mobile
    profileContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        const res = await fetch(`/api/customers/profile/${encodeURIComponent(merchantCode)}`);
        const data = await res.json();

        if (!data.success) {
            alert(data.error || "تعذر جلب ملف العميل");
            return;
        }

        activeCustomerProfile = data;
        renderCustomerProfileView(data);

    } catch (err) {
        console.error("Error loading customer profile:", err);
        alert("حدث خطأ أثناء تحميل بيانات العميل");
    }
}
window.loadCustomerProfile = loadCustomerProfile;

function renderCustomerProfileView(data) {
    const { customer, devices, sim_cards, installments, stats } = data;

    // 1. Header & Badges
    document.getElementById('cust-profile-name').textContent = customer.name;
    document.getElementById('cust-profile-code-badge').textContent = `#${customer.merchant_code}`;
    document.getElementById('cust-profile-gov-badge').textContent = customer.government || 'الإدارة غير محددة';
    document.getElementById('cust-profile-contact-person').textContent = customer.contact_person ? `المسؤول: ${customer.contact_person}` : 'التاجر / صاحب المخبز';

    // 2. Metadata Grid (Clean 4 Core Fields)
    document.getElementById('cust-profile-nid').textContent = customer.national_id || '-';
    const phones = [customer.phone_1, customer.phone_2].filter(p => p && p !== '-' && p !== 'null').join(' / ');
    document.getElementById('cust-profile-phones').textContent = phones || '-';
    const govEl = document.getElementById('cust-profile-gov-field');
    if (govEl) govEl.textContent = customer.government || '-';
    document.getElementById('cust-profile-address').textContent = customer.address || '-';

    // 3. Stats KPIs
    document.getElementById('cust-kpi-devices').textContent = stats.total_devices;
    document.getElementById('cust-kpi-sims').textContent = stats.total_sims;
    document.getElementById('cust-kpi-tickets').textContent = stats.total_tickets;
    document.getElementById('cust-kpi-sp').textContent = stats.total_spare_parts;
    document.getElementById('cust-kpi-debt').textContent = `${Number(installments.total_debt || 0).toLocaleString('ar-EG')} جم`;

    // 4. POS Devices List
    const devList = document.getElementById('cust-devices-list');
    document.getElementById('cust-devices-count-badge').textContent = `${devices.length} ماكينة`;

    if (devices.length === 0) {
        devList.innerHTML = `<div style="text-align:center; padding:25px; color:var(--text-muted); font-size:12px;">لا توجد ماكينات مسجلة حالياً على هذا العميل</div>`;
    } else {
        devList.innerHTML = devices.map(d => {
            const isBranch = d.is_branch_backup || /^S[0-9A-Za-z]/i.test(d.serial);
            return `
            <div style="background:var(--md-sys-color-surface-container-low); border:1px solid var(--md-sys-color-outline-variant); border-radius:12px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center; gap:12px; transition:border-color 0.15s ease;" onmouseover="this.style.borderColor='var(--md-sys-color-primary)'" onmouseout="this.style.borderColor='var(--md-sys-color-outline-variant)'">
                <div style="display:flex; align-items:center; gap:12px; min-width:0;">
                    <div style="width:34px; height:34px; border-radius:10px; background:rgba(56,189,248,0.15); color:var(--md-sys-color-primary); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                        <i data-lucide="boxes" style="width:18px; height:18px;"></i>
                    </div>
                    <div style="min-width:0;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <strong style="font-size:14px; font-family:var(--font-en); color:var(--md-sys-color-primary); letter-spacing:0.5px;">${d.serial}</strong>
                            <span class="badge inmerchant" style="font-size:10px; padding:2px 8px;">${d.slot}</span>
                            ${isBranch ? `<span class="badge" style="background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); font-size:10px; padding:2px 6px;">ماكينة احتياطية من الفرع (S)</span>` : ''}
                            <span class="badge" style="background:rgba(56,189,248,0.12); color:var(--md-sys-color-primary); font-size:10px; padding:2px 6px;">${d.condition || 'سليمة'}</span>
                        </div>
                        <span style="display:block; font-size:11px; color:var(--text-muted); margin-top:2px;">
                            الموديل: <strong style="color:var(--md-sys-color-on-surface);">${d.manufacturer} ${d.model}</strong>
                            ${d.pinpad && d.pinpad !== '-' ? `• Pinpad: <span style="font-family:var(--font-en);">${d.pinpad}</span>` : ''}
                        </span>
                    </div>
                </div>
                <button type="button" class="btn btn-primary" onclick="openDevice360Modal('${d.serial}')" style="padding:6px 12px; font-size:11px; display:inline-flex; align-items:center; gap:6px; border-radius:8px; white-space:nowrap; flex-shrink:0; box-shadow:0 2px 6px rgba(37,99,235,0.25);">
                    <i data-lucide="search" style="width:13px; height:13px;"></i>
                    <span>فحص الماكينة (360°)</span>
                </button>
            </div>
        `;
        }).join('');
    }

    // 5. SIM Cards List (All SIMs linked)
    const simsList = document.getElementById('cust-sims-list');
    const simsCountBadge = document.getElementById('cust-sims-count-badge');
    if (simsCountBadge) simsCountBadge.textContent = `${sim_cards.length} شريحة`;

    if (sim_cards.length === 0) {
        simsList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">لا توجد شرائح مسجلة</div>`;
    } else {
        simsList.innerHTML = sim_cards.map(s => {
            let carrierColor = '#10b981';
            const cLower = String(s.carrier || '').toLowerCase();
            if (cLower.includes('orange')) carrierColor = '#f97316';
            else if (cLower.includes('vodafone')) carrierColor = '#ef4444';
            else if (cLower.includes('we') || cLower.includes('te')) carrierColor = '#a855f7';
            else if (cLower.includes('etisalat')) carrierColor = '#84cc16';

            return `
                <div style="background:var(--md-sys-color-surface-container-low); border:1px solid var(--md-sys-color-outline-variant); border-radius:12px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div style="width:34px; height:34px; border-radius:10px; background:rgba(16,185,129,0.15); color:${carrierColor}; display:flex; align-items:center; justify-content:center;">
                            <i data-lucide="signal" style="width:18px; height:18px;"></i>
                        </div>
                        <div>
                            <strong style="font-size:13px; font-family:var(--font-en); color:var(--md-sys-color-on-surface); letter-spacing:0.3px;">${s.serial}</strong>
                            <span style="display:block; font-size:11px; color:var(--text-muted); margin-top:2px;">
                                <span class="badge inmerchant" style="font-size:10px; padding:2px 8px; margin-left:4px;">${s.slot}</span>
                                <strong style="color:${carrierColor};">${s.carrier}</strong>
                                ${s.phone !== '-' ? `• هاتف: <span style="font-family:var(--font-en); font-weight:700;">${s.phone}</span>` : ''}
                            </span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 6. Installments List
    const instList = document.getElementById('cust-installments-list');
    document.getElementById('cust-inst-count-badge').textContent = `${installments.count} عقود`;

    if (installments.count === 0) {
        instList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">لا توجد عقود أقساط مسجلة على هذه الماكينات</div>`;
    } else {
        instList.innerHTML = installments.contracts.map(c => `
            <div style="background:var(--md-sys-color-surface-container-low); border:1px solid var(--md-sys-color-outline-variant); border-radius:12px; padding:14px 16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong style="font-size:13px; font-family:var(--font-en); color:#f59e0b;">عقد ماكينة #${c.pos}</strong>
                    <span class="badge inmerchant" style="font-family:var(--font-en); font-weight:800; font-size:12px;">${Number(c.finalunitprice || c.unitprice || 0).toLocaleString('ar-EG')} جم</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted);">
                    <span>عدد الأقساط: <strong>${c.installments || 0} شهر</strong></span>
                    <span>القسط الشهري: <strong style="color:var(--md-sys-color-primary); font-family:var(--font-en);">${Number(c.monthlyinstallmentprice || 0).toLocaleString('ar-EG')} جم</strong></span>
                </div>
            </div>
        `).join('');
    }

    if (typeof refreshIcons === 'function') refreshIcons();
}

// --------------------------------------------------------------------------
// DEVICE 360 INTERACTIVE MODAL (4 TABS)
// --------------------------------------------------------------------------

function initDeviceDeepdiveModal() {
    if (window.devDeepdiveModalBound) return;

    document.getElementById('btn-close-device-360-modal')?.addEventListener('click', closeDevice360Modal);
    document.getElementById('btn-dismiss-device-360-modal')?.addEventListener('click', closeDevice360Modal);

    const modal = document.getElementById('modal-device-360-deepdive');
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeDevice360Modal();
    });

    // Subtab switching
    document.querySelectorAll('.dev-deepdive-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const subtab = btn.getAttribute('data-subtab');
            switchDeviceSubtab(subtab);
        });
    });

    window.devDeepdiveModalBound = true;
}

function switchDeviceSubtab(subtab) {
    document.querySelectorAll('.dev-deepdive-tab').forEach(b => {
        if (b.getAttribute('data-subtab') === subtab) {
            b.classList.remove('btn-secondary');
            b.classList.add('btn-primary', 'active');
        } else {
            b.classList.remove('btn-primary', 'active');
            b.classList.add('btn-secondary');
        }
    });

    document.querySelectorAll('.dev-subtab-pane').forEach(p => {
        p.style.display = 'none';
    });

    const targetPane = document.getElementById(`dev-pane-${subtab}`);
    if (targetPane) targetPane.style.display = 'block';

    if (typeof refreshIcons === 'function') refreshIcons();
}

async function openDevice360Modal(serial) {
    const modal = document.getElementById('modal-device-360-deepdive');
    if (!modal) return;

    modal.classList.add('active');
    modal.style.display = 'flex';
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    modal.style.zIndex = '999999';

    // Header info
    document.getElementById('dev-modal-serial').textContent = serial;
    document.getElementById('dev-modal-model').textContent = 'جاري الفحص...';
    document.getElementById('dev-modal-owner').textContent = '-';

    // Initial Loading spinners in all 4 tables
    const loadingHtml = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="refresh-cw" class="spin-animation" style="width:16px;height:16px;vertical-align:middle;"></i> جاري تحميل السجلات المدققة...</td></tr>`;
    document.getElementById('dev-table-maintenance-body').innerHTML = loadingHtml;
    document.getElementById('dev-table-replacements-body').innerHTML = loadingHtml;
    document.getElementById('dev-table-spare-parts-body').innerHTML = loadingHtml;
    document.getElementById('dev-table-hq-body').innerHTML = loadingHtml;

    // Reset to first subtab
    switchDeviceSubtab('maintenance');

    try {
        const res = await fetch(`/api/customers/device-deepdive/${encodeURIComponent(serial)}`);
        const data = await res.json();

        if (!data.success) {
            alert(data.error || "تعذر جلب سجلات الماكينة");
            return;
        }

        currentDeviceDeepdiveData = data;
        renderDeviceDeepdiveContent(data);

    } catch (err) {
        console.error("Error fetching device deepdive:", err);
        alert("حدث خطأ أثناء تحميل سجل الماكينة");
    }
}
window.openDevice360Modal = openDevice360Modal;

function closeDevice360Modal() {
    const modal = document.getElementById('modal-device-360-deepdive');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
        modal.style.opacity = '0';
        modal.style.visibility = 'hidden';
    }
}
window.closeDevice360Modal = closeDevice360Modal;

function renderDeviceDeepdiveContent(data) {
    const { device_info, maintenance, replacements, spare_parts, hq_cycles } = data;

    // Modal Header
    document.getElementById('dev-modal-serial').textContent = device_info.serial;
    const isBranch = device_info.is_branch_backup || /^S[0-9A-Za-z]/i.test(device_info.serial);
    const modelBadge = document.getElementById('dev-modal-model');
    if (modelBadge) {
        modelBadge.innerHTML = `${device_info.manufacturer} ${device_info.model} ${isBranch ? '<span style="background:rgba(245,158,11,0.25); color:#f59e0b; border:1px solid rgba(245,158,11,0.4); font-size:10px; padding:1px 6px; border-radius:6px; margin-right:6px;">ماكينة احتياطية من الفرع (S)</span>' : ''}`;
    }
    document.getElementById('dev-modal-owner').textContent = `المالك الحالي: ${device_info.current_owner} (#${device_info.merchant_code}) • ${device_info.government}`;

    // Subtab counts
    document.getElementById('dev-tab-count-maint').textContent = maintenance.length;
    document.getElementById('dev-tab-count-rep').textContent = replacements.length;
    document.getElementById('dev-tab-count-sp').textContent = spare_parts.length;
    document.getElementById('dev-tab-count-hq').textContent = hq_cycles.length;

    // TAB 1: Maintenance Tickets (Entry & Exit timestamps)
    const maintBody = document.getElementById('dev-table-maintenance-body');
    if (maintenance.length === 0) {
        maintBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:35px; color:var(--text-muted);">لا توجد صيانات مسجلة لهذه الماكينة بالفرع</td></tr>`;
    } else {
        maintBody.innerHTML = maintenance.map((m, idx) => {
            let feeBadge = '';
            if (m.has_spare_part && m.spare_part) {
                if (m.spare_part.payment_status === 'PAID') {
                    feeBadge = `<span class="badge inmerchant" style="font-size:11px; font-weight:700;"><i data-lucide="check-circle" style="width:11px;height:11px;vertical-align:middle;margin-left:3px;"></i> مسدد (${m.spare_part.receipt_number ? `#${m.spare_part.receipt_number}` : ''}${m.spare_part.payment_channel ? ` - ${m.spare_part.payment_channel}` : ''})</span>`;
                } else if (m.spare_part.payment_status === 'DEFERRED') {
                    feeBadge = `<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; font-size:11px; font-weight:700;"><i data-lucide="clock" style="width:11px;height:11px;vertical-align:middle;margin-left:3px;"></i> مؤجل</span>`;
                } else {
                    feeBadge = `<span class="badge" style="background:rgba(6,182,212,0.15); color:#06b6d4; font-size:11px; font-weight:700;"><i data-lucide="shield-check" style="width:11px;height:11px;vertical-align:middle;margin-left:3px;"></i> مجاني</span>`;
                }
            } else if (m.is_initial_maintenance) {
                feeBadge = `<span class="badge" style="background:rgba(14,165,233,0.15); color:#0284c7; font-size:11px; font-weight:700;">صيانة أولية</span>`;
            } else {
                feeBadge = `<span class="badge" style="background:rgba(100,116,139,0.15); color:#64748b; font-size:11px; font-weight:700;">صيانة فرع</span>`;
            }

            return `
            <tr>
                <td style="font-family:var(--font-en); font-weight:700; color:var(--text-muted);">${idx + 1}</td>
                <td>${formatDateTimeCell(m.entry_datetime)}</td>
                <td>${formatDateTimeCell(m.exit_datetime)}</td>
                <td><strong style="color:var(--md-sys-color-primary); font-size:12px;">${m.technician}</strong></td>
                <td style="max-width:200px; word-break:break-word; font-size:12px;">${m.complaint}</td>
                <td style="max-width:220px; word-break:break-word; font-size:12px; color:var(--md-sys-color-on-surface);">${m.action_taken}</td>
                <td>${feeBadge}</td>
            </tr>
        `;
        }).join('');
    }

    // TAB 2: Replacements & Swaps (from temp_transfer)
    const repBody = document.getElementById('dev-table-replacements-body');
    if (replacements.length === 0) {
        repBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:35px; color:var(--text-muted);">لا توجد حركات استبدال مسجلة لهذه الماكينة في جدول الاستبدالات</td></tr>`;
    } else {
        repBody.innerHTML = replacements.map((r, idx) => `
            <tr>
                <td style="font-family:var(--font-en); font-weight:700; color:var(--text-muted);">${idx + 1}</td>
                <td>${formatDateTimeCell(r.date)}</td>
                <td><strong style="font-family:var(--font-en); color:#ef4444; font-size:13px;">${r.old_serial}</strong></td>
                <td><strong style="font-family:var(--font-en); color:#10b981; font-size:13px;">${r.new_serial}</strong></td>
                <td><span class="badge inmerchant" style="font-size:11px; font-weight:700;">${(r.old_type && r.new_type && r.old_type !== r.new_type) ? `${r.old_type} ⬅️ ${r.new_type}` : (r.new_type || r.old_type || 'PAX - S90')}</span></td>
                <td><strong style="font-size:12px; color:var(--md-sys-color-primary);">${r.technician || 'فني الصيانة'}</strong></td>
                <td style="font-size:11px; color:var(--md-sys-color-on-surface); max-width:220px; word-break:break-word;">${r.notes || '-'}</td>
            </tr>
        `).join('');
    }

    // TAB 3: Spare Parts
    const spBody = document.getElementById('dev-table-spare-parts-body');
    if (spare_parts.length === 0) {
        spBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:35px; color:var(--text-muted);">لا توجد قطع غيار منصرفة لهذه الماكينة في سجلات المخزن</td></tr>`;
    } else {
        spBody.innerHTML = spare_parts.map((sp, idx) => {
            const hasReceipt = sp.receipt_number && sp.receipt_number !== '-' && !sp.receipt_number.includes('مجاني');
            const receiptHtml = hasReceipt
                ? `<a href="javascript:void(0)" onclick="openPrintMemo('receipt', '${sp.receipt_number}')" class="badge inmerchant" style="font-family:var(--font-en); font-weight:800; font-size:11px; padding:2px 8px; border:1px solid rgba(56,189,248,0.4); text-decoration:underline;" title="انقر لطباعة إيصال الإيداع"><i data-lucide="receipt" style="width:11px; height:11px; vertical-align:middle; margin-left:3px;"></i>#${sp.receipt_number}</a>`
                : `<span style="font-size:11px; color:var(--text-muted);">-</span>`;

            const paidColor = sp.paid_amount > 0 ? '#10b981' : 'var(--text-muted)';
            const statusBadge = sp.is_free
                ? `<span class="badge" style="background:rgba(6,182,212,0.15); color:#06b6d4; font-size:11px; font-weight:700;"><i data-lucide="shield-check" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> صرف مجاني</span>`
                : (String(sp.payment_status_label || '').includes('مؤجل')
                    ? `<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; font-size:11px; font-weight:700;"><i data-lucide="clock" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> تحصيل مؤجل ⚠️</span>`
                    : `<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; font-size:11px; font-weight:700;"><i data-lucide="check-circle" style="width:10px;height:10px;vertical-align:middle;margin-left:3px;"></i> مسدد بمقابل${sp.payment_channel && sp.payment_channel !== '-' ? ` (${sp.payment_channel})` : ''}</span>`);

            return `
            <tr>
                <td style="font-family:var(--font-en); font-weight:700; color:var(--text-muted);">${idx + 1}</td>
                <td>${formatDateTimeCell(sp.date)}</td>
                <td><strong style="color:var(--md-sys-color-primary); font-size:13px;">${sp.part_name}</strong></td>
                <td style="font-family:var(--font-en); font-weight:700;">${sp.quantity}</td>
                <td style="font-family:var(--font-en); font-weight:700; color:var(--md-sys-color-on-surface);">${Number(sp.official_price || 0).toLocaleString('ar-EG')} جم</td>
                <td style="font-family:var(--font-en); font-weight:800; color:${paidColor};">${sp.paid_amount > 0 ? `${Number(sp.paid_amount).toLocaleString('ar-EG')} جم` : '0 جم (مجاني)'}</td>
                <td>${statusBadge}</td>
                <td>${receiptHtml}</td>
                <td style="font-size:11px; color:var(--text-muted); max-width:200px; word-break:break-word;">${sp.notes}</td>
            </tr>
        `;
        }).join('');
    }

    // TAB 4: HQ Central Maintenance
    const hqBody = document.getElementById('dev-table-hq-body');
    if (hq_cycles.length === 0) {
        hqBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:35px; color:var(--text-muted);">لم يتم إرسال هذه الماكينة إلى مركز الصيانة الرئيسي بالشركة</td></tr>`;
    } else {
        hqBody.innerHTML = hq_cycles.map((hq, idx) => {
            const partsBadges = hq.hq_parts_replaced && hq.hq_parts_replaced.length > 0
                ? hq.hq_parts_replaced.map(p => `<span class="badge warning" style="margin:2px; font-size:11px;">${p.part_name}</span>`).join('')
                : (hq.hq_parts_note || '<span style="color:var(--text-muted); font-size:11px;">صيانة شاملة</span>');

            return `
                <tr>
                    <td style="font-family:var(--font-en); font-weight:700; color:var(--text-muted);">${idx + 1}</td>
                    <td><span class="badge inmerchant" style="font-family:var(--font-en); font-weight:800;">إذن #${hq.form_no || '-'}</span></td>
                    <td>${formatDateTimeCell(hq.sent_date)}</td>
                    <td>${formatDateTimeCell(hq.return_date)}</td>
                    <td><span class="badge inmerchant">${hq.return_condition || hq.sent_condition || 'تم الفحص'}</span></td>
                    <td>${partsBadges}</td>
                    <td style="font-size:11px; color:var(--text-muted); max-width:180px; word-break:break-word;">${hq.notes || '-'}</td>
                </tr>
            `;
        }).join('');
    }

    if (typeof refreshIcons === 'function') refreshIcons();
}

// =========================================================================
// POINT-IN-TIME INVENTORY TIME MACHINE (آلة الزمن المخزنية)
// =========================================================================
let timeMachineCurrentData = null;
let timeMachineActiveSubtab = 'sp';

function initTimeMachineTab() {
    const dateInput = document.getElementById('tm-date-input');
    if (dateInput && !dateInput.value) {
        const todayStr = new Date().toISOString().slice(0, 10);
        dateInput.value = todayStr;
    }

    // Bind subtab buttons
    document.querySelectorAll('.tm-subtab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tm-subtab-btn').forEach(b => {
                b.classList.remove('active');
                b.style.background = '';
                b.style.color = '';
            });
            document.querySelectorAll('.tm-subpane').forEach(p => p.style.display = 'none');

            btn.classList.add('active');
            timeMachineActiveSubtab = btn.dataset.subtab;
            const pane = document.getElementById(`tm-pane-${timeMachineActiveSubtab}`);
            if (pane) pane.style.display = 'block';
            if (typeof refreshIcons === 'function') refreshIcons();
        };
    });

    // Bind presets
    document.querySelectorAll('.tm-preset-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tm-preset-btn').forEach(b => {
                b.classList.remove('active');
                b.style.background = '';
                b.style.color = '';
            });
            btn.classList.add('active');
            btn.style.background = 'var(--md-sys-color-primary-container)';
            btn.style.color = 'var(--md-sys-color-primary)';

            const preset = btn.dataset.preset;
            let targetDate = new Date();

            if (preset === 'today') {
                targetDate = new Date();
            } else if (preset === 'end_last_month') {
                const now = new Date();
                targetDate = new Date(now.getFullYear(), now.getMonth(), 0);
            } else if (preset === 'start_year_2026') {
                targetDate = new Date('2026-01-01');
            } else if (preset === 'end_year_2025') {
                targetDate = new Date('2025-12-31');
            } else if (preset === 'mid_year_2025') {
                targetDate = new Date('2025-06-30');
            }

            const yyyy = targetDate.getFullYear();
            const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
            const dd = String(targetDate.getDate()).padStart(2, '0');
            const formatted = `${yyyy}-${mm}-${dd}`;

            if (dateInput) dateInput.value = formatted;
            loadTimeMachineData(formatted);
        };
    });

    // Query button
    document.getElementById('btn-tm-query')?.addEventListener('click', () => {
        const val = dateInput ? dateInput.value : '';
        loadTimeMachineData(val);
    });

    // Search filters
    document.getElementById('tm-sp-search')?.addEventListener('input', (e) => {
        renderTimeMachineSpareParts(e.target.value.trim());
    });
    document.getElementById('tm-pos-search')?.addEventListener('input', (e) => {
        renderTimeMachinePos(e.target.value.trim());
    });
    document.getElementById('tm-sims-search')?.addEventListener('input', (e) => {
        renderTimeMachineSims(e.target.value.trim());
    });

    // Print button
    document.getElementById('btn-tm-print')?.addEventListener('click', () => {
        window.print();
    });

    // Initial load
    const currentVal = dateInput ? dateInput.value : '';
    loadTimeMachineData(currentVal);
}

async function loadTimeMachineData(dateStr) {
    try {
        const queryDate = dateStr || new Date().toISOString().slice(0, 10);
        
        // Show loading in tables
        const spTbody = document.getElementById('tm-sp-table-body');
        if (spTbody) spTbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:35px; color:var(--text-muted);"><i data-lucide="loader-2" class="spin-animation" style="width:20px;height:20px;vertical-align:middle;margin-left:6px;"></i> جاري استرجاع رصيد آلة الزمن لتاريخ ${queryDate}...</td></tr>`;
        if (typeof refreshIcons === 'function') refreshIcons();

        const res = await fetch(`/api/inventory/time-machine?date=${encodeURIComponent(queryDate)}`);
        const data = await res.json();

        if (!data.success) {
            if (typeof showToast === 'function') showToast('error', 'تعذر استرجاع رصيد آلة الزمن', data.error || '');
            return;
        }

        timeMachineCurrentData = data;

        // 1. Update KPI Highlights
        const posValEl = document.getElementById('tm-stat-pos-count');
        if (posValEl) posValEl.textContent = Number(data.summary.total_pos).toLocaleString('ar-EG');
        const posSubEl = document.getElementById('tm-stat-pos-sub');
        if (posSubEl) posSubEl.textContent = `${data.summary.total_pos_models} موديل • ${data.summary.branch_backup_pos} ماكينة احتياطية (S)`;

        const simValEl = document.getElementById('tm-stat-sims-count');
        if (simValEl) simValEl.textContent = Number(data.summary.total_sims).toLocaleString('ar-EG');
        const simSubEl = document.getElementById('tm-stat-sims-sub');
        if (simSubEl) simSubEl.textContent = `متاحة بالمخزن`;

        const spValEl = document.getElementById('tm-stat-sp-units');
        if (spValEl) spValEl.textContent = Number(data.summary.total_sp_units).toLocaleString('ar-EG') + ' قطعة';
        const spCostEl = document.getElementById('tm-stat-sp-valuation');
        if (spCostEl) spCostEl.textContent = Number(data.summary.total_sp_valuation).toLocaleString('ar-EG') + ' جم';

        const asOfEl = document.getElementById('tm-as-of-date-text');
        if (asOfEl) asOfEl.textContent = data.as_of_formatted || data.as_of_date;

        // Subtab counts
        const cntSp = document.getElementById('tm-subcount-sp');
        if (cntSp) cntSp.textContent = data.spare_parts_inventory.items.length;
        const cntPos = document.getElementById('tm-subcount-pos');
        if (cntPos) cntPos.textContent = data.pos_inventory.total;
        const cntSims = document.getElementById('tm-subcount-sims');
        if (cntSims) cntSims.textContent = data.sims_inventory.total;

        // 2. Render Subtabs
        renderTimeMachineSpareParts();
        renderTimeMachinePos();
        renderTimeMachineSims();

        if (typeof refreshIcons === 'function') refreshIcons();
    } catch (err) {
        console.error('loadTimeMachineData error:', err);
        if (typeof showToast === 'function') showToast('error', 'خطأ في الاتصال بالخادم', err.message);
    }
}

function renderTimeMachineSpareParts(filterText = '') {
    if (!timeMachineCurrentData) return;
    const items = timeMachineCurrentData.spare_parts_inventory.items || [];
    const tbody = document.getElementById('tm-sp-table-body');
    if (!tbody) return;

    const filtered = items.filter(it => !filterText || it.type.toLowerCase().includes(filterText.toLowerCase()));

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:35px; color:var(--text-muted);">لا توجد قطع غيار مطابقة للبحث في هذا التاريخ</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((p, idx) => {
        let statusBadge = '<span class="badge inmerchant">رصيد متوفر ✅</span>';
        let balColor = '#10b981';
        if (p.current_balance <= 0) {
            statusBadge = '<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3);">رصيد نفد ⚠️</span>';
            balColor = '#ef4444';
        } else if (p.current_balance < 5) {
            statusBadge = '<span class="badge warning">رصيد منخفض ⚠️</span>';
            balColor = '#f59e0b';
        }

        return `
            <tr>
                <td style="font-family:var(--font-en); font-weight:700; color:var(--text-muted);">${idx + 1}</td>
                <td><strong style="font-size:13px; color:var(--md-sys-color-primary);">${p.type}</strong></td>
                <td style="font-family:var(--font-en); font-weight:700; color:var(--md-sys-color-on-surface);">${Number(p.unit_price).toLocaleString('ar-EG')} جم</td>
                <td style="font-family:var(--font-en); font-weight:700; color:#38bdf8;">+${Number(p.cumulative_in).toLocaleString('ar-EG')}</td>
                <td style="font-family:var(--font-en); font-weight:700; color:#ef4444;">-${Number(p.cumulative_out).toLocaleString('ar-EG')}</td>
                <td><strong style="font-family:var(--font-en); font-size:14px; color:${balColor};">${Number(p.current_balance).toLocaleString('ar-EG')}</strong></td>
                <td style="font-family:var(--font-en); font-weight:800; color:#fbbf24;">${Number(p.total_value).toLocaleString('ar-EG')} جم</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

function renderTimeMachinePos(filterText = '') {
    if (!timeMachineCurrentData) return;
    const { by_model, items } = timeMachineCurrentData.pos_inventory;
    
    // 1. Models Matrix (Standard System Card Design)
    const grid = document.getElementById('tm-pos-models-grid');
    if (grid && by_model) {
        grid.innerHTML = Object.entries(by_model).map(([modelName, count]) => `
            <div class="card" style="background:var(--md-sys-color-surface-container); border:1px solid var(--md-sys-color-outline-variant); border-radius:16px; padding:18px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--md-elevation-1);">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="width:40px; height:40px; border-radius:12px; background:rgba(56,189,248,0.15); display:flex; align-items:center; justify-content:center; color:var(--md-sys-color-primary);">
                        <i data-lucide="cpu" style="width:22px; height:22px;"></i>
                    </div>
                    <div>
                        <span style="font-size:11px; font-weight:700; color:var(--md-sys-color-on-surface-variant); display:block;">موديل الماكينة</span>
                        <strong style="font-size:15px; color:var(--md-sys-color-on-surface); font-family:var(--font-en);">${modelName}</strong>
                    </div>
                </div>
                <div style="text-align:left;">
                    <span class="badge inmerchant" style="font-family:var(--font-en); font-size:16px; font-weight:800; padding:4px 12px;">${count}</span>
                </div>
            </div>
        `).join('');
    }

    // 2. Table Rows
    const tbody = document.getElementById('tm-pos-table-body');
    if (!tbody) return;

    const filtered = (items || []).filter(it => {
        if (!filterText) return true;
        const q = filterText.toLowerCase();
        return it.serial.toLowerCase().includes(q) || it.full_model.toLowerCase().includes(q) || it.notes.toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:35px; color:var(--text-muted);">لا توجد ماكينات مطابقة في مخزن هذا التاريخ</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((d, idx) => `
        <tr>
            <td style="font-family:var(--font-en); font-weight:700; color:var(--text-muted);">${idx + 1}</td>
            <td>
                <strong style="font-family:var(--font-en); color:var(--md-sys-color-primary); font-size:13px; letter-spacing:0.5px;">${d.serial}</strong>
                ${d.is_branch_backup ? '<span class="badge" style="background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); font-size:10px; padding:2px 6px; margin-right:4px;">ماكينة احتياطية (S)</span>' : ''}
            </td>
            <td><strong style="font-family:var(--font-en); font-size:12px;">${d.full_model}</strong></td>
            <td><span class="badge inmerchant" style="font-size:11px;">ماكينة فرع</span></td>
            <td><span class="badge ${d.status.includes('تالفة') ? 'warning' : 'ready'}" style="font-size:11px;">${d.status}</span></td>
            <td style="font-size:11px; color:var(--text-muted); max-width:200px; word-break:break-word;">${d.notes}</td>
        </tr>
    `).join('');
}

function renderTimeMachineSims(filterText = '') {
    if (!timeMachineCurrentData) return;
    const { by_carrier, items } = timeMachineCurrentData.sims_inventory;

    // 1. Carriers Grid (Standard System Card Design)
    const grid = document.getElementById('tm-sims-carriers-grid');
    if (grid && by_carrier) {
        const carrierConfigs = {
            Vodafone: { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', name: 'فودافون مصر' },
            Orange: { color: '#f97316', bg: 'rgba(249,115,22,0.15)', name: 'أورانج مصر' },
            WE: { color: '#a855f7', bg: 'rgba(168,85,247,0.15)', name: 'المصرية للاتصالات WE' },
            Etisalat: { color: '#10b981', bg: 'rgba(16,185,129,0.15)', name: 'اتصالات مصر' },
            Other: { color: '#64748b', bg: 'rgba(100,116,139,0.15)', name: 'شرائح عامة' }
        };

        grid.innerHTML = Object.entries(by_carrier).map(([carrier, count]) => {
            const cfg = carrierConfigs[carrier] || carrierConfigs.Other;
            return `
            <div class="card" style="background:var(--md-sys-color-surface-container); border:1px solid var(--md-sys-color-outline-variant); border-radius:16px; padding:18px; display:flex; justify-content:space-between; align-items:center; box-shadow:var(--md-elevation-1);">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="width:40px; height:40px; border-radius:12px; background:${cfg.bg}; display:flex; align-items:center; justify-content:center; color:${cfg.color};">
                        <i data-lucide="signal" style="width:22px; height:22px;"></i>
                    </div>
                    <div>
                        <span style="font-size:11px; font-weight:700; color:var(--md-sys-color-on-surface-variant); display:block;">${cfg.name}</span>
                        <strong style="font-size:15px; color:${cfg.color}; font-family:var(--font-en);">${carrier}</strong>
                    </div>
                </div>
                <div style="text-align:left;">
                    <span class="badge inmerchant" style="font-family:var(--font-en); font-size:16px; font-weight:800; padding:4px 12px;">${count}</span>
                </div>
            </div>
        `;
        }).join('');
    }

    // 2. Table Rows
    const tbody = document.getElementById('tm-sims-table-body');
    if (!tbody) return;

    const filtered = (items || []).filter(it => {
        if (!filterText) return true;
        const q = filterText.toLowerCase();
        return it.serial.toLowerCase().includes(q) || it.carrier.toLowerCase().includes(q) || it.notes.toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:35px; color:var(--text-muted);">لا توجد شرائح مطابقة في مخزن هذا التاريخ</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((s, idx) => `
        <tr>
            <td style="font-family:var(--font-en); font-weight:700; color:var(--text-muted);">${idx + 1}</td>
            <td><strong style="font-family:var(--font-en); color:var(--md-sys-color-primary); font-size:13px; letter-spacing:0.5px;">${s.serial}</strong></td>
            <td><span class="badge inmerchant" style="font-family:var(--font-en); font-weight:700;">${s.carrier}</span></td>
            <td style="font-size:11px; color:var(--text-muted);">${s.notes}</td>
        </tr>
    `).join('');
}

window.initTimeMachineTab = initTimeMachineTab;
window.loadTimeMachineData = loadTimeMachineData;

// ==========================================================================
// 19. SYSTEM DIAGNOSTICS, ERROR TRACER & RECONCILIATION AUDITOR
// ==========================================================================

// Global Frontend Error Listeners (Capture client JS errors automatically)
window.addEventListener('error', function(e) {
    try {
        fetch('/api/diagnostics/log-client-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: e.message,
                source: e.filename,
                lineno: e.lineno,
                colno: e.colno,
                stack: e.error ? e.error.stack : '',
                url: window.location.href,
                userAgent: navigator.userAgent
            })
        }).catch(() => {});
        checkDiagnosticsPulse();
    } catch(err) {}
});

window.addEventListener('unhandledrejection', function(e) {
    try {
        const reason = e.reason;
        fetch('/api/diagnostics/log-client-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: reason ? (reason.message || String(reason)) : 'Unhandled Promise Rejection',
                stack: reason && reason.stack ? reason.stack : '',
                url: window.location.href,
                userAgent: navigator.userAgent
            })
        }).catch(() => {});
        checkDiagnosticsPulse();
    } catch(err) {}
});

function openDiagnosticsTab() {
    switchTab('settings');
    switchSettingsSubtab('settings-diagnostics');
}
window.openDiagnosticsTab = openDiagnosticsTab;

async function loadDiagnosticsDashboard() {
    loadReconciliationMatrix();
    loadDiagnosticsErrorLogs();
}
window.loadDiagnosticsDashboard = loadDiagnosticsDashboard;

async function loadReconciliationMatrix() {
    const tbody = document.getElementById('reconciliation-matrix-tbody');
    const refreshIcon = document.getElementById('icon-reconciliation-refresh');
    if (refreshIcon) refreshIcon.classList.add('spin-animation');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);"><i data-lucide="loader-2" class="spin-animation"></i> جاري فحص ومقارنة السجلات بين السيرفر المحلي والـ VPS...</td></tr>`;
    refreshIcons();

    try {
        const res = await fetch('/api/diagnostics/reconciliation');
        const data = await res.json();

        if (!res.ok || !data.success) throw new Error(data.error || 'تعذر فحص التطابق');

        // Update KPIs
        const kpiErrors24h = document.getElementById('diag-kpi-errors-24h');
        const kpiMatchStatus = document.getElementById('diag-kpi-match-status');
        const kpiMismatchCount = document.getElementById('diag-kpi-mismatch-count');
        const kpiTotalRecords = document.getElementById('diag-kpi-total-records');

        if (kpiErrors24h) kpiErrors24h.textContent = data.errors_last_24h ?? 0;
        if (kpiTotalRecords) kpiTotalRecords.textContent = Number(data.total_local_records || 0).toLocaleString('ar-EG');

        if (data.is_all_matched) {
            if (kpiMatchStatus) {
                kpiMatchStatus.textContent = '100% متطابق ✅';
                kpiMatchStatus.style.color = '#10b981';
            }
            if (kpiMismatchCount) kpiMismatchCount.textContent = 'كافة الجداول متطابقة تماماً';
        } else {
            if (kpiMatchStatus) {
                kpiMatchStatus.textContent = '⚠️ يوجد عدم تطابق';
                kpiMatchStatus.style.color = '#ef4444';
            }
            if (kpiMismatchCount) kpiMismatchCount.textContent = `${data.mismatched_count} جداول بها فارق في السجلات`;
        }

        // Render Matrix Table
        if (!tbody) return;
        const tables = data.tables || [];

        tbody.innerHTML = tables.map((t, idx) => {
            const isMatched = t.status === 'MATCHED';
            const hexIdx = `0x${(idx + 1).toString(16).toUpperCase().padStart(2, '0')}`;
            
            const statusBadge = isMatched
                ? `<span class="cyber-badge-matched"><i data-lucide="shield-check" style="width:12px;height:12px;"></i> [MATCH_OK: 100%]</span>`
                : `<span class="cyber-badge-mismatch"><i data-lucide="alert-triangle" style="width:12px;height:12px;"></i> [DIFF_DELTA: ${Math.abs(t.diff)}]</span>`;

            const diffBadge = t.diff === 0
                ? `<span style="color:var(--cyber-neon-green); font-weight:800; font-size:13px;">0</span>`
                : `<span style="color:var(--cyber-neon-red); font-weight:900; font-size:13px; text-shadow:0 0 8px rgba(255,0,85,0.4);">${t.diff > 0 ? '+' : ''}${t.diff}</span>`;

            const cloudCountText = t.cloud_count !== null 
                ? Number(t.cloud_count).toLocaleString('en-US')
                : (data.cloud_fetch_error ? `<span style="color:#ef4444; font-size:10px;">[LINK_OFFLINE]</span>` : '-');

            return `
                <tr style="${!isMatched ? 'background:rgba(255,0,85,0.06);' : ''}">
                    <td><span class="cyber-badge-hex">${hexIdx}</span></td>
                    <td>
                        <strong style="color:#ffffff; font-size:13px; display:block;">${t.name_ar}</strong>
                        <span class="cyber-code-box" style="margin-top:3px;">${t.table}</span>
                    </td>
                    <td><strong style="color:var(--cyber-neon-cyan); font-size:14px; letter-spacing:0.5px;">${Number(t.local_count).toLocaleString('en-US')}</strong></td>
                    <td><strong style="color:${isMatched ? 'var(--cyber-neon-green)' : 'var(--cyber-neon-red)'}; font-size:14px; letter-spacing:0.5px;">${cloudCountText}</strong></td>
                    <td>${diffBadge}</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error("Reconciliation error:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--cyber-neon-red); padding:25px; font-family:var(--cyber-font-mono);">[FATAL_RECONCILIATION_EXCEPTION]: ${err.message}</td></tr>`;
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('spin-animation');
        refreshIcons();
    }
}
window.loadReconciliationMatrix = loadReconciliationMatrix;

async function triggerFullCloudReseed() {
    const btn = document.getElementById('btn-reseed-vps-action');
    const icon = document.getElementById('icon-reseed-vps');

    const confirmed = confirm('هل أنت متأكد من رغبتك في إعادة مزامنة وتأسيس السيرفر السحابي (VPS) بالكامل؟\n\nسيتم إرسال كافة الجداول الـ 13 محلياً بدقة متناهية وإعادة بناء كافة الكيانات السحابية.');
    if (!confirmed) return;

    if (btn) btn.disabled = true;
    if (icon) icon.classList.add('spin-animation');

    try {
        const res = await fetch('/api/diagnostics/reseed-vps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (!res.ok || !data.success) throw new Error(data.error || 'فشلت المزامنة الشاملة');

        alert(`✅ نجحت العملية!\n${data.message}\n(المدة: ${data.duration_ms || 0} ms)`);
        loadReconciliationMatrix();
        checkDiagnosticsPulse();
    } catch (err) {
        alert(`❌ حدث خطأ أثناء المزامنة: ${err.message}`);
    } finally {
        if (btn) btn.disabled = false;
        if (icon) icon.classList.remove('spin-animation');
        refreshIcons();
    }
}
window.triggerFullCloudReseed = triggerFullCloudReseed;

async function loadDiagnosticsErrorLogs() {
    const tbody = document.getElementById('system-errors-tbody');
    const refreshIcon = document.getElementById('icon-diag-refresh');
    const severity = document.getElementById('diag-error-filter-severity')?.value || 'ALL';

    if (refreshIcon) refreshIcon.classList.add('spin-animation');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#64748b; font-family:var(--cyber-font-mono);"><i data-lucide="loader-2" class="spin-animation"></i> [STREAMING_SYSTEM_BLACKBOX_LOGS]...</td></tr>`;
    refreshIcons();

    try {
        const res = await fetch(`/api/diagnostics/errors?severity=${encodeURIComponent(severity)}`);
        const data = await res.json();

        if (!res.ok || !data.success) throw new Error(data.error || 'فشل جلب الأخطاء');

        const errors = data.errors || [];
        const kpiErrorsTotal = document.getElementById('diag-kpi-errors-total');
        if (kpiErrorsTotal) kpiErrorsTotal.textContent = `إجمالي الأخطاء المسجلة: ${data.total || 0}`;

        if (!tbody) return;

        if (errors.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:35px; color:var(--cyber-neon-green); font-weight:800; font-family:var(--cyber-font-mono);"><i data-lucide="shield-check" style="width:20px; height:20px; vertical-align:middle; margin-left:6px;"></i> [BLACKBOX_CLEAR]: NO ANOMALIES DETECTED // 100% OPERATIONAL EXCELLENCE ✨</td></tr>`;
            return;
        }

        window.__diagnosticErrorStackMap = {};
        tbody.innerHTML = errors.map((err, idx) => {
            window.__diagnosticErrorStackMap[err.id] = err.stack_trace || '';
            const hexIdx = `0x${(idx + 1).toString(16).toUpperCase().padStart(2, '0')}`;
            
            let sevBadge = `<span style="background:rgba(255,0,85,0.15); color:var(--cyber-neon-red); border:1px solid rgba(255,0,85,0.4); padding:2px 8px; border-radius:4px; font-weight:900; font-size:10px;">[ERROR]</span>`;
            if (err.severity === 'CRITICAL') {
                sevBadge = `<span style="background:var(--cyber-neon-red); color:#ffffff; font-weight:900; font-size:10px; padding:2px 8px; border-radius:4px; box-shadow:0 0 10px rgba(255,0,85,0.6);">[CRITICAL_ALERT 🚨]</span>`;
            } else if (err.severity === 'WARN') {
                sevBadge = `<span style="background:rgba(255,183,3,0.15); color:var(--cyber-neon-amber); border:1px solid rgba(255,183,3,0.4); padding:2px 8px; border-radius:4px; font-weight:800; font-size:10px;">[WARN ⚠️]</span>`;
            } else if (err.module === 'CLIENT_UI') {
                sevBadge = `<span style="background:rgba(192,132,252,0.15); color:var(--cyber-neon-purple); border:1px solid rgba(192,132,252,0.4); padding:2px 8px; border-radius:4px; font-weight:800; font-size:10px;">[CLIENT_UI 🖥️]</span>`;
            }

            const formattedTime = formatCairoDateTime(err.timestamp || new Date().toISOString());
            const hasStack = err.stack_trace && err.stack_trace.trim().length > 0;

            return `
                <tr>
                    <td><span class="cyber-badge-hex">${hexIdx}</span></td>
                    <td>${sevBadge}</td>
                    <td><span class="cyber-code-box">${err.module || 'SYS'}</span></td>
                    <td><span style="font-family:var(--cyber-font-mono); font-size:11px; color:var(--cyber-neon-cyan);">${err.endpoint || '-'}</span></td>
                    <td style="font-size:12px; font-weight:600; color:#f1f5f9; max-width:320px; white-space:normal; word-break:break-word; font-family:var(--cyber-font-mono);">
                        ${err.error_message || 'Unspecified Error'}
                    </td>
                    <td><span style="color:#94a3b8; font-size:11px; font-family:var(--cyber-font-mono);">${formattedTime}</span></td>
                    <td>
                        ${hasStack ? `
                            <button type="button" class="cyber-btn-secondary" style="padding:3px 10px; font-size:10px;" onclick="showDiagnosticStack(${err.id})">
                                <i data-lucide="terminal"></i> [TRACE_STACK]
                            </button>
                        ` : '<span style="color:#475569; font-size:11px;">[NO_STACK]</span>'}
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error("Error logs fetch error:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--cyber-neon-red); padding:25px; font-family:var(--cyber-font-mono);">[FATAL_LOG_STREAM_EXCEPTION]: ${err.message}</td></tr>`;
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('spin-animation');
        refreshIcons();
    }
}
window.loadDiagnosticsErrorLogs = loadDiagnosticsErrorLogs;

function showDiagnosticStack(id) {
    const stack = window.__diagnosticErrorStackMap ? window.__diagnosticErrorStackMap[id] : '';
    if (stack) {
        alert('تفاصيل الـ Stack Trace:\n\n' + stack);
    }
}
window.showDiagnosticStack = showDiagnosticStack;

async function clearAllDiagnosticsErrors() {
    const confirmed = confirm('هل أنت متأكد من رغبتك في مسح وتفريغ سجل الأخطاء بالكامل؟');
    if (!confirmed) return;

    try {
        const res = await fetch('/api/diagnostics/clear-errors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'فشل مسح السجل');

        loadDiagnosticsErrorLogs();
        checkDiagnosticsPulse();
    } catch (err) {
        alert('خطأ أثناء مسح السجل: ' + err.message);
    }
}
window.clearAllDiagnosticsErrors = clearAllDiagnosticsErrors;

async function checkDiagnosticsPulse() {
    if (document.hidden) return;
    try {
        const res = await fetch('/api/diagnostics/errors?limit=1');
        const data = await res.json();
        const headerPill = document.getElementById('header-diagnostic-pill');
        const headerText = document.getElementById('header-diagnostic-text');

        if (data && data.last_24h_count > 0) {
            if (headerPill) {
                headerPill.style.display = 'flex';
                headerPill.classList.add('pulse-alert');
            }
            if (headerText) headerText.textContent = `${data.last_24h_count} أخطاء مرصودة ⚠️`;
        } else {
            if (headerPill) {
                headerPill.style.display = 'none';
                headerPill.classList.remove('pulse-alert');
            }
        }
    } catch (e) {}
}
window.checkDiagnosticsPulse = checkDiagnosticsPulse;

// Auto-run font initialization & sync health monitor
if (typeof document !== 'undefined') {
    initFontSystem();
    checkSyncHealth();
    checkDiagnosticsPulse();
    setInterval(checkSyncHealth, 15000);
    setInterval(checkDiagnosticsPulse, 20000);
}

