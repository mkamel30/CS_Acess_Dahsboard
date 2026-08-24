const express = require('express');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const XLSX = require('xlsx');
const syncEngine = require('./sync_engine');

function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                if (!iface.address.startsWith('169.254')) {
                    candidates.unshift(iface.address);
                } else {
                    candidates.push(iface.address);
                }
            }
        }
    }
    return candidates[0] || '127.0.0.1';
}

const CONFIG_FILE = path.join(__dirname, 'config.json');
let configuredPort = 8970;
if (fs.existsSync(CONFIG_FILE)) {
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (cfg.port) configuredPort = parseInt(cfg.port, 10);
    } catch (e) {}
}

const app = express();
const compression = require('compression');
const apiEngine = require('./api_engine');
const PORT = process.env.PORT || configuredPort || 8970;

// Global crash prevention guards for network share disconnects/timeouts
process.on('uncaughtException', (err) => {
    console.error('[SERVER GUARD - UNCAUGHT EXCEPTION]', err.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[SERVER GUARD - UNHANDLED REJECTION]', reason);
});

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/favicon.ico', (req, res) => res.status(204).end());

// ==========================================
// SECURITY: Config-driven secrets & admin guard
// ==========================================
function readAppConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { return {}; }
}
const appCfg = readAppConfig();
const SYNC_SECRET   = appCfg.syncSecret   || process.env.SYNC_SECRET   || 'smartcs-cloud-secret-2026';
const WEBHOOK_SECRET = appCfg.webhookSecret || process.env.WEBHOOK_SECRET || '';
const ADMIN_SECRET   = appCfg.adminSecret   || process.env.ADMIN_SECRET   || '';

// Admin-guard middleware: protects destructive endpoints
// If ADMIN_SECRET is configured, require x-admin-secret header; otherwise allow (backward-compat)
function requireAdmin(req, res, next) {
    if (!ADMIN_SECRET) return next(); // No secret configured = legacy open mode
    const provided = req.headers['x-admin-secret'] || req.query.admin_secret;
    if (provided === ADMIN_SECRET) return next();
    return res.status(403).json({ success: false, error: 'Forbidden: Admin authentication required' });
}

// SQLite connection
const dbPath = path.join(__dirname, 'branch_database.db');
const db = new sqlite3.Database(dbPath);
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA busy_timeout = 10000;");

// Helper for database queries
function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function allQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

const MONTH_MAP_SERVER = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

const MONTH_NUM_MAP_SERVER = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

const UniversalDateEngine = {
    parsePrecisionDate(dStr) {
        if (!dStr || dStr === '-' || dStr === 'BEGINING' || dStr === 'null' || dStr === 'undefined') return null;
        let str = String(dStr).trim();
        if (!str) return null;

        // Check if direct ISO / standard parseable with T
        if (str.includes('T')) {
            const parsed = new Date(str);
            if (!isNaN(parsed.getTime())) return parsed;
        }

        let hours = 12, minutes = 0, seconds = 0;
        const timeMatch = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|am|pm|ص|م))?/i);
        if (timeMatch) {
            hours = parseInt(timeMatch[1], 10);
            minutes = parseInt(timeMatch[2], 10);
            seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
            const ampm = timeMatch[4] ? timeMatch[4].toLowerCase() : '';
            if ((ampm === 'pm' || ampm === 'م') && hours < 12) hours += 12;
            if ((ampm === 'am' || ampm === 'ص') && hours === 12) hours = 0;
            str = str.replace(timeMatch[0], '').trim();
        }

        // Pattern 1: DD-MMM-YY or DD-MMM-YYYY
        const dMonYMatch = str.match(/^(\d{1,2})[-/]([a-zA-Z]{3,})[-/](\d{2,4})/);
        if (dMonYMatch) {
            const day = parseInt(dMonYMatch[1], 10);
            const mKey = dMonYMatch[2].toLowerCase().substring(0, 3);
            const mon = MONTH_MAP_SERVER[mKey] !== undefined ? MONTH_MAP_SERVER[mKey] : 0;
            let yr = parseInt(dMonYMatch[3], 10);
            if (yr < 100) yr = (yr > 50 ? 1900 : 2000) + yr;
            return new Date(yr, mon, day, hours, minutes, seconds);
        }

        // Pattern 2: MMM-YY-DD
        const monYdMatch = str.match(/^([a-zA-Z]{3,})[-/](\d{2,4})[-/](\d{1,2})/);
        if (monYdMatch) {
            const mKey = monYdMatch[1].toLowerCase().substring(0, 3);
            const mon = MONTH_MAP_SERVER[mKey] !== undefined ? MONTH_MAP_SERVER[mKey] : 0;
            let yr = parseInt(monYdMatch[2], 10);
            if (yr < 100) yr = (yr > 50 ? 1900 : 2000) + yr;
            const day = parseInt(monYdMatch[3], 10);
            return new Date(yr, mon, day, hours, minutes, seconds);
        }

        // Pattern 3: YYYY-MM-DD or YYYY/MM/DD
        const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (isoMatch) {
            const yr = parseInt(isoMatch[1], 10);
            const mon = parseInt(isoMatch[2], 10) - 1;
            const day = parseInt(isoMatch[3], 10);
            return new Date(yr, mon, day, hours, minutes, seconds);
        }

        // Pattern 4: DD-MM-YYYY or DD/MM/YYYY
        const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (dmyMatch) {
            const day = parseInt(dmyMatch[1], 10);
            const mon = parseInt(dmyMatch[2], 10) - 1;
            let yr = parseInt(dmyMatch[3], 10);
            if (yr < 100) yr = (yr > 50 ? 1900 : 2000) + yr;
            return new Date(yr, mon, day, hours, minutes, seconds);
        }

        const fallback = new Date(str);
        if (!isNaN(fallback.getTime())) return fallback;
        return null;
    },

    parsePrecisionRange(dateFrom, dateTo) {
        let startTimestamp = null;
        let endTimestamp = null;

        if (dateFrom && String(dateFrom).trim()) {
            const dStr = String(dateFrom).trim();
            const startD = new Date(dStr + (dStr.length === 10 ? 'T00:00:00.000' : ''));
            if (!isNaN(startD.getTime())) startTimestamp = startD.getTime();
        }

        if (dateTo && String(dateTo).trim()) {
            const dStr = String(dateTo).trim();
            const endD = new Date(dStr + (dStr.length === 10 ? 'T23:59:59.999' : ''));
            if (!isNaN(endD.getTime())) endTimestamp = endD.getTime();
        }

        return { startTimestamp, endTimestamp };
    },

    isWithinRange(dateVal, startTimestamp, endTimestamp) {
        if (!startTimestamp && !endTimestamp) return true;
        if (!dateVal) return false;
        
        let ts = null;
        if (typeof dateVal === 'number') {
            ts = dateVal;
        } else if (dateVal instanceof Date) {
            ts = dateVal.getTime();
        } else {
            const p = UniversalDateEngine.parsePrecisionDate(dateVal);
            if (p) ts = p.getTime();
        }

        if (!ts) return false;
        if (startTimestamp && ts < startTimestamp) return false;
        if (endTimestamp && ts > endTimestamp) return false;
        return true;
    },

    parseDateToIso(str) {
        if (!str) return '1970-01-01';
        const p = UniversalDateEngine.parsePrecisionDate(str);
        if (p) {
            const pad = (n) => String(n).padStart(2, '0');
            return `${p.getFullYear()}-${pad(p.getMonth() + 1)}-${pad(p.getDate())}`;
        }
        return String(str).trim();
    }
};

function parseDateToIso(str) {
    return UniversalDateEngine.parseDateToIso(str);
}

// Ensure Sync, Audit and Schema columns are initialized
async function initAppSchema() {
    try {
        await syncEngine.initSyncDatabase(db);
        await runQuery("ALTER TABLE merchants ADD COLUMN status TEXT DEFAULT 'active'").catch(() => {});
        
        // Initialize tblinstallments
        await runQuery(`
            CREATE TABLE IF NOT EXISTS tblinstallments (
                id INTEGER PRIMARY KEY,
                pos TEXT,
                installments INTEGER,
                unitprice REAL,
                monthlyinstallmentprice REAL,
                finalunitprice REAL
            )
        `);
        const countInst = (await getQuery("SELECT COUNT(*) as count FROM tblinstallments"))?.count || 0;
        if (countInst === 0) {
            const instFile = path.join(__dirname, 'data_sync', 'tblInstallments.json');
            if (fs.existsSync(instFile)) {
                const rawJson = fs.readFileSync(instFile, 'utf8').replace(/^\uFEFF/, '');
                const list = JSON.parse(rawJson);
                for (const item of list) {
                    await runQuery(
                        "INSERT OR REPLACE INTO tblinstallments (id, pos, installments, unitprice, monthlyinstallmentprice, finalunitprice) VALUES (?, ?, ?, ?, ?, ?)",
                        [parseInt(item.id), item.pos, parseInt(item.installments), parseFloat(item.unitprice), parseFloat(item.monthlyinstallmentprice), parseFloat(item.finalunitprice)]
                    );
                }
                console.log(`[DB INIT] Initialized tblinstallments with ${list.length} records.`);
            }
        }

        // Initialize store_sp_maintenance_raw from Store_SP_maintenance.json
        await runQuery(`
            CREATE TABLE IF NOT EXISTS store_sp_maintenance_raw (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                serial TEXT,
                type TEXT,
                faulty TEXT,
                faulty_details TEXT,
                form_no TEXT,
                model TEXT,
                count_out INTEGER,
                out_date TEXT,
                notes TEXT
            )
        `);
        const countSpMaint = (await getQuery("SELECT COUNT(*) as count FROM store_sp_maintenance_raw"))?.count || 0;
        if (countSpMaint === 0) {
            const spMaintFile = path.join(__dirname, 'data_sync', 'Store_SP_maintenance.json');
            if (fs.existsSync(spMaintFile)) {
                const rawJson = fs.readFileSync(spMaintFile, 'utf8').replace(/^\uFEFF/, '');
                const list = JSON.parse(rawJson);
                for (const item of list) {
                    await runQuery(
                        `INSERT INTO store_sp_maintenance_raw (serial, type, faulty, faulty_details, form_no, model, count_out, out_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            item.Serial || '',
                            item.type || '',
                            item.faulty || 'False',
                            item.faulty_detils || '',
                            item.formNo || '',
                            item.Model || null,
                            parseInt(item.count_out) || 1,
                            item.out_date || '',
                            item.notes || ''
                        ]
                    );
                }
                console.log(`[DB INIT] Initialized store_sp_maintenance_raw with ${list.length} records from Store_SP_maintenance.json.`);
            }
        }

        console.log("[DB INIT] App Database Schema Verified and Ready.");
    } catch(err) {
        console.error("[DB INIT] Error initializing schema:", err.message);
    }
}
initAppSchema();

// Generic Direct Table Explorer API
app.get('/api/explorer/:table', async (req, res) => {
    try {
        const allowedTables = [
            'merchants', 'devices', 'sim_cards', 'tickets', 'payments', 'spare_parts',
            'assets_raw', 'maintenance_raw', 'transactions_raw', 'store_pos_raw', 'store_sim_raw', 'store_sp_raw', 'store_sp_maintenance_raw', 'tblinstallments', 'temp_transfer_raw'
        ];
        const table = req.params.table.toLowerCase();
        if (!allowedTables.includes(table)) {
            return res.status(400).json({ error: "Table not allowed" });
        }

        const { search = '', limit = 25, offset = 0 } = req.query;
        
        // Get column names
        const columnsInfo = await allQuery(`PRAGMA table_info("${table}")`);
        const UNWANTED_COLS = ['bank_account', 'tax_card', 'fuel_type', 'bread_type', 'training', 'papers_date'];
        const colNames = columnsInfo.map(c => c.name).filter(c => table !== 'merchants' || !UNWANTED_COLS.includes(c));

        let whereClause = "";
        let params = [];
        let countParams = [];

        if (search && colNames.length > 0) {
            const searchConditions = colNames.map(c => `"${c}" LIKE ?`).join(' OR ');
            whereClause = `WHERE (${searchConditions})`;
            const searchVal = `%${search}%`;
            colNames.forEach(() => {
                params.push(searchVal);
                countParams.push(searchVal);
            });
        }

        const countRow = await getQuery(`SELECT COUNT(*) as total FROM "${table}" ${whereClause}`, countParams);
        const total = countRow ? countRow.total : 0;

        params.push(parseInt(limit), parseInt(offset));
        const selectCols = colNames.map(c => `"${c}"`).join(', ');
        const rows = await allQuery(`SELECT ${selectCols} FROM "${table}" ${whereClause} LIMIT ? OFFSET ?`, params);

        res.json({
            success: true,
            table,
            total,
            columns: colNames,
            limit: parseInt(limit),
            offset: parseInt(offset),
            rows
        });
    } catch (err) {
        console.error("Explorer table error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 0. SETTINGS & DB PATH CONFIGURATION API
// ==========================================

// SSE Live Connection Pool for Real-Time UI Updates
const sseClients = new Set();

function broadcastSseEvent(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(payload);
        } catch (e) {
            sseClients.delete(client);
        }
    }
}

// Hook sync completion to SSE broadcast
syncEngine.setOnSyncCompleteCallback((result) => {
    broadcastSseEvent('sync_completed', {
        type: 'sync_completed',
        changesDetected: result.changesDetected || 0,
        tablesSynced: result.tablesSynced || 0,
        totalRecords: result.totalRecords || 0,
        message: result.message,
        timestamp: new Date().toISOString()
    });
});

// SSE Stream Endpoint
app.get('/api/sync/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.add(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', autoSync: syncEngine.isAutoSyncEnabled() })}\n\n`);

    req.on('close', () => {
        sseClients.delete(res);
    });
});

// SSE Keep-Alive Heartbeat (prevents Nginx/Cloudflare from dropping idle connections)
setInterval(() => {
    for (const client of sseClients) {
        try { client.write(': ping\n\n'); } catch (e) { sseClients.delete(client); }
    }
}, 30000);

// Get current Access DB path and status
app.get('/api/settings/db-path', (req, res) => {
    try {
        const currentPath = syncEngine.getAccessFilePath();
        const exists = fs.existsSync(currentPath);
        let fileSizeMb = 0;
        if (exists) {
            try {
                fileSizeMb = (fs.statSync(currentPath).size / (1024 * 1024)).toFixed(2);
            } catch (e) {}
        }
        const localIp = getLocalIpAddress();
        res.json({
            success: true,
            path: currentPath,
            exists: exists,
            fileSizeMb: fileSizeMb,
            provider: 'Microsoft.ACE.OLEDB.12.0',
            localDb: 'SQLite3 (database.sqlite) - WAL Mode',
            isReadOnly: true,
            autoSync: syncEngine.isAutoSyncEnabled(),
            hostName: os.hostname(),
            localIp: localIp,
            networkUrl: `http://${localIp}:${PORT}`,
            localUrl: `http://localhost:${PORT}`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update & Save Access DB path
app.post('/api/settings/db-path', (req, res) => {
    try {
        const { path: newPath } = req.body;
        if (!newPath) {
            return res.status(400).json({ error: 'يرجى إدخال مسار ملف قاعدة بيانات الآكسيس' });
        }
        const savedPath = syncEngine.setAccessFilePath(newPath);
        syncEngine.startFileWatcher(db);
        const fileSizeMb = (fs.statSync(savedPath).size / (1024 * 1024)).toFixed(2);
        res.json({
            success: true,
            message: 'تم حفظ وتحديث مسار قاعدة بيانات الآكسيس بنجاح',
            path: savedPath,
            fileSizeMb: fileSizeMb,
            autoSync: syncEngine.isAutoSyncEnabled()
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});



// Toggle Real-Time Auto-Sync
app.post('/api/settings/auto-sync', requireAdmin, (req, res) => {
    try {
        const { enabled } = req.body;
        const isEnabled = syncEngine.setAutoSyncEnabled(enabled, db);
        res.json({
            success: true,
            autoSync: isEnabled,
            message: isEnabled ? 'تم تفعيل المراقبة اللحظية والمزامنة التلقائية بنجاح ✅' : 'تم إيقاف المزامنة التلقائية مؤقتاً'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Factory Reset / Wipe Web Database Completely
app.post('/api/settings/reset-database', requireAdmin, async (req, res) => {
    try {
        const result = await syncEngine.wipeDatabase(db);
        broadcastSseEvent('sync_completed', {
            type: 'sync_completed',
            changesDetected: 0,
            tablesSynced: 0,
            totalRecords: 0,
            message: 'تم تصفير وتفريغ قاعدة بيانات الويب بنجاح',
            timestamp: new Date().toISOString()
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 1. SYNC & CHANGE TRACKING API ENDPOINTS
// ==========================================

// Get current sync status
app.get('/api/sync/status', async (req, res) => {
    try {
        const status = syncEngine.getSyncStatus();
        const lastHistory = await getQuery("SELECT * FROM sync_history ORDER BY id DESC LIMIT 1");
        const totalLogsCount = (await getQuery("SELECT COUNT(*) as count FROM audit_change_logs"))?.count || 0;
        
        res.json({
            success: true,
            status: status.status,
            isSyncInProgress: status.isSyncInProgress,
            progress: status.progress,
            lastSyncTime: lastHistory ? lastHistory.sync_time : status.lastSyncTime,
            message: status.message,
            changesDetected: lastHistory ? lastHistory.changes_count : status.changesDetected,
            tablesSynced: lastHistory ? lastHistory.tables_count : status.tablesSynced,
            totalRecords: lastHistory ? lastHistory.records_count : status.totalRecords,
            durationMs: lastHistory ? lastHistory.duration_ms : status.durationMs,
            totalAuditLogs: totalLogsCount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Trigger full sync from Access Database
app.post('/api/sync/run', async (req, res) => {
    try {
        const result = await syncEngine.syncFromAccessDatabase(db);
        res.json(result);
    } catch (err) {
        if (err.message && err.message.includes('قيد التنفيذ')) {
            return res.json({ success: true, inProgress: true, message: err.message });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get Sync Execution History
app.get('/api/sync/history', async (req, res) => {
    try {
        const history = await allQuery("SELECT * FROM sync_history ORDER BY id DESC LIMIT 50");
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. AUDIT LOGS & DIFF VIEWER ENDPOINTS
// ==========================================

// Query Audit Change Logs with filtering & pagination
app.get('/api/audit-logs', async (req, res) => {
    try {
        const { table_name, change_type, record_id, limit = 50, offset = 0, search } = req.query;
        let whereClauses = [];
        let params = [];

        if (table_name && table_name !== 'all') {
            whereClauses.push("table_name = ?");
            params.push(table_name);
        }
        if (change_type && change_type !== 'all') {
            whereClauses.push("change_type = ?");
            params.push(change_type.toUpperCase());
        }
        if (record_id) {
            whereClauses.push("record_id = ?");
            params.push(record_id);
        }
        if (search) {
            whereClauses.push("(summary LIKE ? OR record_id LIKE ? OR table_name LIKE ?)");
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const countRow = await getQuery(`SELECT COUNT(*) as count FROM audit_change_logs ${whereSql}`, params);
        const total = countRow ? countRow.count : 0;

        const logs = await allQuery(`
            SELECT id, timestamp, table_name, record_id, change_type, summary, old_data, new_data
            FROM audit_change_logs
            ${whereSql}
            ORDER BY id DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), parseInt(offset)]);

        // Aggregated Stats for change types
        const typeStats = await allQuery(`
            SELECT change_type, COUNT(*) as count 
            FROM audit_change_logs 
            ${whereSql}
            GROUP BY change_type
        `, params);

        res.json({
            success: true,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            logs,
            typeStats
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Specific Audit Log with parsed JSON Diffs
app.get('/api/audit-logs/:id', async (req, res) => {
    try {
        const log = await getQuery("SELECT * FROM audit_change_logs WHERE id = ?", [req.params.id]);
        if (!log) {
            return res.status(404).json({ error: "Audit log not found" });
        }

        let oldData = null;
        let newData = null;
        try { if (log.old_data) oldData = JSON.parse(log.old_data); } catch(e){}
        try { if (log.new_data) newData = JSON.parse(log.new_data); } catch(e){}

        res.json({
            success: true,
            log: {
                ...log,
                old_data_parsed: oldData,
                new_data_parsed: newData
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2.5 SMART NOTIFICATIONS & PROACTIVE ALERTS
// ==========================================
app.get('/api/notifications/alerts', async (req, res) => {
    try {
        // 1. Pending & In-Progress Maintenance Tickets
        const pendingMaintenance = await allQuery(`
            SELECT t.id, t.merchant_code, t.device_id, t.status, t.issue_details, t.technician_name, t.issue_date,
                   m.name as merchant_name, m.government, d.serial as device_serial, d.model as device_model
            FROM tickets t
            LEFT JOIN merchants m ON m.merchant_code = t.merchant_code
            LEFT JOIN devices d ON d.id = t.device_id
            WHERE t.status IN ('OPEN', 'in_progress') OR t.close_date IS NULL OR t.close_date = ''
            ORDER BY t.issue_date DESC
            LIMIT 50
        `);

        // 2. Critical & Low Stock Spare Parts
        const lowStockParts = await allQuery(`
            SELECT id, part_name, quantity_in_stock, critical_limit, price
            FROM spare_parts
            WHERE quantity_in_stock <= critical_limit OR quantity_in_stock = 0
            ORDER BY quantity_in_stock ASC
            LIMIT 50
        `);

        // 3. Installment Contracts & Plans
        const dueInstallments = await allQuery(`
            SELECT i.id, i.pos as device_serial, i.installments as plan_months, 
                   i.monthlyinstallmentprice, i.finalunitprice, i.unitprice,
                   m.name as merchant_name, m.merchant_code, m.government
            FROM installments_raw i
            LEFT JOIN devices d ON d.serial = i.pos
            LEFT JOIN merchant_assets ma ON ma.device_id = d.id
            LEFT JOIN merchants m ON m.merchant_code = ma.merchant_code
            ORDER BY i.id ASC
            LIMIT 50
        `);

        // 4. Faulty Unassigned Devices
        const unassignedFaultyDevices = await allQuery(`
            SELECT id, serial, model, manufacturer, faulty_details
            FROM devices
            WHERE status = 'faulty'
            LIMIT 30
        `);

        const totalAlerts = pendingMaintenance.length + lowStockParts.length + dueInstallments.length;

        res.json({
            success: true,
            totalAlerts,
            pendingMaintenance,
            lowStockParts,
            dueInstallments,
            unassignedFaultyDevices
        });
    } catch (err) {
        console.error("Alerts error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2.6 TECHNICIAN PERFORMANCE & SLA ANALYTICS
// ==========================================
app.get('/api/maintenance/technicians-performance', async (req, res) => {
    try {
        const techsRaw = await allQuery(`
            SELECT 
                COALESCE(NULLIF(technician_name, ''), 'فني الصيانة') as tech_name,
                COUNT(*) as total_tickets,
                SUM(CASE WHEN status = 'completed' OR (close_date IS NOT NULL AND close_date != '') THEN 1 ELSE 0 END) as completed_count,
                SUM(CASE WHEN status != 'completed' AND (close_date IS NULL OR close_date = '') THEN 1 ELSE 0 END) as pending_count
            FROM tickets
            WHERE technician_name IS NOT NULL AND technician_name != '' AND technician_name != '-'
            GROUP BY tech_name
            ORDER BY completed_count DESC
        `);

        const techDetails = await Promise.all(techsRaw.map(async (t) => {
            const topFaults = await allQuery(`
                SELECT issue_details, COUNT(*) as count
                FROM tickets
                WHERE technician_name = ? AND issue_details IS NOT NULL AND issue_details != ''
                GROUP BY issue_details
                ORDER BY count DESC
                LIMIT 3
            `, [t.tech_name]);

            const completionRate = t.total_tickets > 0 ? Math.round((t.completed_count / t.total_tickets) * 100) : 0;

            return {
                tech_name: t.tech_name,
                total_tickets: t.total_tickets,
                completed_count: t.completed_count,
                pending_count: t.pending_count,
                completion_rate: completionRate,
                top_faults: topFaults
            };
        }));

        res.json({
            success: true,
            technicians: techDetails
        });
    } catch (err) {
        console.error("Tech performance error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3. DASHBOARD ANALYTICS & STATS
// ==========================================

app.get('/api/dashboard/stats', async (req, res) => {
    try {
        // High-level counts
        const totalMerchants = (await getQuery("SELECT COUNT(*) as count FROM merchants"))?.count || 0;
        const totalDevices = (await getQuery("SELECT COUNT(*) as count FROM devices"))?.count || 0;
        const inMerchantDevices = (await getQuery("SELECT COUNT(*) as count FROM devices WHERE status = 'in_merchant' OR status = 'DEPLOYED'"))?.count || 0;
        const inStockDevices = (await getQuery("SELECT COUNT(*) as count FROM devices WHERE status = 'in_stock' OR status = 'IN_STOCK'"))?.count || 0;
        const faultyDevices = (await getQuery("SELECT COUNT(*) as count FROM devices WHERE status = 'faulty' OR status = 'FAULTY'"))?.count || 0;
        
        const totalSims = (await getQuery("SELECT COUNT(*) as count FROM sim_cards"))?.count || 0;
        const assignedSims = (await getQuery("SELECT COUNT(*) as count FROM sim_cards WHERE status = 'assigned' OR status = 'DEPLOYED'"))?.count || 0;
        const inStockSims = (await getQuery("SELECT COUNT(*) as count FROM sim_cards WHERE status = 'in_stock' OR status = 'IN_STOCK'"))?.count || 0;

        const totalTickets = (await getQuery("SELECT COUNT(*) as count FROM tickets"))?.count || 0;
        const openTickets = (await getQuery("SELECT COUNT(*) as count FROM tickets WHERE status = 'OPEN' OR status = 'in_progress'"))?.count || 0;
        const closedTickets = (await getQuery("SELECT COUNT(*) as count FROM tickets WHERE status = 'CLOSED' OR status = 'completed'"))?.count || 0;

        const totalPaymentsAmount = (await getQuery("SELECT SUM(amount) as total FROM payments"))?.total || 0;
        const totalPaymentsCount = (await getQuery("SELECT COUNT(*) as count FROM payments"))?.count || 0;

        // Top 5 common faults
        const topFaults = await allQuery(`
            SELECT issue_details, COUNT(*) as count 
            FROM tickets 
            WHERE issue_details IS NOT NULL AND issue_details != '' 
            GROUP BY issue_details 
            ORDER BY count DESC 
            LIMIT 5
        `);

        // Model Distribution
        const modelDistribution = await allQuery(`
            SELECT model, COUNT(*) as count 
            FROM devices 
            WHERE model IS NOT NULL AND model != '' 
            GROUP BY model 
            ORDER BY count DESC 
            LIMIT 6
        `);

        // Geographic Distribution
        const govDistribution = await allQuery(`
            SELECT COALESCE(government, 'غير محدد') as gov, COUNT(*) as count 
            FROM merchants 
            GROUP BY government 
            ORDER BY count DESC 
            LIMIT 5
        `);

        // SIM Carriers Breakdown with case-insensitive normalization and merging
        const rawCarriers = await allQuery(`
            SELECT carrier, COUNT(*) as count 
            FROM sim_cards 
            GROUP BY carrier
        `);

        const carrierNormMap = new Map();
        rawCarriers.forEach(r => {
            let name = String(r.carrier || '').trim();
            const lower = name.toLowerCase();

            if (lower.includes('voda') || lower.includes('فودافون')) {
                name = 'Vodafone';
            } else if (lower.includes('orange') || lower.includes('موبينيل') || lower.includes('اورنج') || lower.includes('أورنج')) {
                name = 'Orange';
            } else if (lower.includes('etisalat') || lower.includes('اتصالات') || lower.includes('e&')) {
                name = 'Etisalat';
            } else if (lower.includes('we') || lower.includes('المصرية') || lower.includes('te')) {
                name = 'WE';
            } else if (lower.includes('new sim') || lower === '-' || lower === 'unknown') {
                name = 'شرائح جديدة';
            } else if (!name) {
                name = 'غير محدد';
            }

            carrierNormMap.set(name, (carrierNormMap.get(name) || 0) + Number(r.count || 0));
        });

        const carriersBreakdown = Array.from(carrierNormMap.entries())
            .map(([carrier, count]) => ({ carrier, count }))
            .sort((a, b) => b.count - a.count);

        // Recent Audit Changes (Last 5)
        const recentChanges = await allQuery(`
            SELECT id, timestamp, table_name, record_id, change_type, summary 
            FROM audit_change_logs 
            ORDER BY id DESC 
            LIMIT 5
        `);

        // Critical Spare Parts
        const sparePartsAlerts = await allQuery(`
            SELECT id, part_name, quantity_in_stock, critical_limit 
            FROM spare_parts 
            WHERE quantity_in_stock <= critical_limit 
            ORDER BY quantity_in_stock ASC
        `);

        const queryOpts = apiEngine.parseDynamicQuery(req.query);
        const kpis = {
            totalMerchants,
            totalDevices,
            inMerchantDevices,
            inStockDevices,
            faultyDevices,
            totalSims,
            assignedSims,
            inStockSims,
            totalTickets,
            openTickets,
            closedTickets,
            totalPaymentsAmount,
            totalPaymentsCount
        };

        const envelope = apiEngine.buildEnvelope({
            success: true,
            summary: kpis,
            view: queryOpts.view,
            legacyKeys: {
                kpis,
                topFaults: queryOpts.view === 'summary' ? [] : topFaults,
                modelDistribution: queryOpts.view === 'summary' ? [] : modelDistribution,
                govDistribution: queryOpts.view === 'summary' ? [] : govDistribution,
                carriersBreakdown: queryOpts.view === 'summary' ? [] : carriersBreakdown,
                recentChanges: queryOpts.view === 'summary' ? [] : recentChanges,
                sparePartsAlerts: queryOpts.view === 'summary' ? [] : sparePartsAlerts
            }
        });

        res.json(envelope);
    } catch (err) {
        console.error("Dashboard stats error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3.5 WAREHOUSE INVENTORY DASHBOARD & CARDS API
// ==========================================

app.get('/api/inventory/warehouse-dashboard', async (req, res) => {
    try {
        const [allDevices, rawStorePos, allTransfers, allTrade, allMerchants] = await Promise.all([
            allQuery(`
                SELECT d.id, d.serial, d.manufacturer, d.model, d.status, d.faulty_details,
                       ma.merchant_code, m.name as merchant_name, m.government
                FROM devices d
                LEFT JOIN merchant_assets ma ON ma.device_id = d.id
                LEFT JOIN merchants m ON m.merchant_code = ma.merchant_code
            `),
            allQuery('SELECT * FROM store_pos_raw ORDER BY rowid ASC'),
            allQuery('SELECT * FROM temp_transfer_raw ORDER BY rowid DESC'),
            allQuery('SELECT * FROM trade_raw ORDER BY rowid DESC'),
            allQuery('SELECT merchant_code, name, government FROM merchants')
        ]);

        const totalDevices = allDevices.length;
        const inMerchantDevices = allDevices.filter(d => d.status === 'in_merchant');
        
        let newForSaleCount = 0;
        let branchInternalCount = 0;
        let readyInStockCount = 0;
        let faultyInBranchCount = 0;

        // Process store_pos_raw items
        const storePosMap = new Map();
        const devicesList = rawStorePos.map((r, idx) => {
            const s = String(r.Serial || '').trim();
            const mfg = String(r.type || 'PAX').trim();
            const model = String(r.Model || 'S90').trim();
            const isFaulty = r.faulty === 'True' || r.faulty === true || r.faulty === 'true' || r.faulty === '1';
            const posStatus = String(r.pos_status || '').trim();
            const statusNote = String(r.status_note || '').trim();
            const notes = String(r.notes || '').trim();
            const faultyDetails = String(r.faulty_detils || '').trim();

            let conditionType = 'READY_IN_STOCK';
            let conditionLabel = 'جاهزة وسليمة بالمخزن';
            let conditionBadge = 'inmerchant';

            if (posStatus.toLowerCase() === 'branch' && statusNote.toLowerCase() === 'new') {
                conditionType = 'NEW_FOR_SALE';
                conditionLabel = 'ماكينة جديدة للبيع والتسليم 🛍️';
                conditionBadge = 'new-sale';
                newForSaleCount++;
            } else if (posStatus.toLowerCase() === 'branch') {
                conditionType = 'BRANCH_INTERNAL';
                conditionLabel = 'عهدة واستخدام داخلي بالفرع 🏢';
                conditionBadge = 'branch-use';
                branchInternalCount++;
            } else if (isFaulty) {
                conditionType = 'FAULTY_IN_BRANCH';
                conditionLabel = 'معطلة / قيد الصيانة بالفرع ⚠️';
                conditionBadge = 'faulty';
                faultyInBranchCount++;
            } else {
                conditionType = 'READY_IN_STOCK';
                conditionLabel = 'جاهزة وسليمة بالمخزن ✅';
                conditionBadge = 'inmerchant';
                readyInStockCount++;
            }

            storePosMap.set(s, {
                conditionType,
                posStatus,
                statusNote,
                notes,
                faultyDetails
            });

            return {
                id: idx + 1,
                serial: s,
                manufacturer: mfg,
                model,
                status: isFaulty ? 'faulty' : 'in_stock',
                condition_type: conditionType,
                condition_label: conditionLabel,
                condition_badge: conditionBadge,
                pos_status: posStatus,
                status_note: statusNote,
                notes,
                faulty_details: faultyDetails || notes || (conditionType === 'NEW_FOR_SALE' ? 'جديدة بالكرتونة للبيع' : (conditionType === 'BRANCH_INTERNAL' ? 'استخدام بالفرع' : (isFaulty ? 'صيانة داخلية' : 'سليمة')))
            };
        });

        const totalWarehouse = devicesList.length;

        // Model Breakdown for Warehouse & Total Fleet
        const modelMap = new Map();
        
        // Initialize from allDevices for field numbers
        allDevices.forEach(d => {
            const mKey = (d.model || 'غير محدد').trim();
            const mfg = (d.manufacturer || 'PAX Technology').trim();
            if (!modelMap.has(mKey)) {
                modelMap.set(mKey, {
                    model: mKey,
                    manufacturer: mfg,
                    new_for_sale: 0,
                    branch_internal: 0,
                    ready_in_stock: 0,
                    faulty: 0,
                    in_merchant: 0,
                    total_warehouse: 0,
                    total_fleet: 0
                });
            }
            const item = modelMap.get(mKey);
            item.total_fleet++;
            if (d.status === 'in_merchant') {
                item.in_merchant++;
            }
        });

        // Populate warehouse-specific counts from store_pos_raw
        devicesList.forEach(item => {
            const mKey = (item.model || 'غير محدد').trim();
            if (!modelMap.has(mKey)) {
                modelMap.set(mKey, {
                    model: mKey,
                    manufacturer: item.manufacturer,
                    new_for_sale: 0,
                    branch_internal: 0,
                    ready_in_stock: 0,
                    faulty: 0,
                    in_merchant: 0,
                    total_warehouse: 0,
                    total_fleet: 0
                });
            }
            const m = modelMap.get(mKey);
            m.total_warehouse++;
            if (item.condition_type === 'NEW_FOR_SALE') m.new_for_sale++;
            else if (item.condition_type === 'BRANCH_INTERNAL') m.branch_internal++;
            else if (item.condition_type === 'FAULTY_IN_BRANCH') m.faulty++;
            else if (item.condition_type === 'READY_IN_STOCK') m.ready_in_stock++;
        });

        const modelsList = Array.from(modelMap.values()).map(m => ({
            ...m,
            warehouse_share_pct: totalWarehouse > 0 ? ((m.total_warehouse / totalWarehouse) * 100).toFixed(1) : 0,
            fleet_share_pct: totalDevices > 0 ? ((m.total_fleet / totalDevices) * 100).toFixed(1) : 0
        })).sort((a, b) => b.total_warehouse - a.total_warehouse || b.total_fleet - a.total_fleet);

        // Manufacturer Breakdown
        const mfgMap = new Map();
        modelsList.forEach(m => {
            const mfg = m.manufacturer || 'PAX Technology';
            if (!mfgMap.has(mfg)) {
                mfgMap.set(mfg, {
                    manufacturer: mfg,
                    models: new Set(),
                    new_for_sale: 0,
                    branch_internal: 0,
                    ready_in_stock: 0,
                    faulty: 0,
                    in_merchant: 0,
                    total_warehouse: 0,
                    total_fleet: 0
                });
            }
            const item = mfgMap.get(mfg);
            item.models.add(m.model);
            item.new_for_sale += m.new_for_sale;
            item.branch_internal += m.branch_internal;
            item.ready_in_stock += m.ready_in_stock;
            item.faulty += m.faulty;
            item.in_merchant += m.in_merchant;
            item.total_warehouse += m.total_warehouse;
            item.total_fleet += m.total_fleet;
        });

        const manufacturersList = Array.from(mfgMap.values()).map(m => ({
            manufacturer: m.manufacturer,
            models_count: m.models.size,
            models_names: Array.from(m.models).join(', '),
            new_for_sale: m.new_for_sale,
            branch_internal: m.branch_internal,
            ready_in_stock: m.ready_in_stock,
            faulty: m.faulty,
            in_merchant: m.in_merchant,
            total_warehouse: m.total_warehouse,
            total_fleet: m.total_fleet,
            warehouse_share_pct: totalWarehouse > 0 ? ((m.total_warehouse / totalWarehouse) * 100).toFixed(1) : 0
        })).sort((a, b) => b.total_warehouse - a.total_warehouse);

        // Standby 'S' and HQ 'M-' logistics stats from transfers
        const standbyTransfers = allTransfers.filter(tr => String(tr.OldPOS || '').startsWith('S') || String(tr.NewPOS || '').startsWith('S'));
        const hqTransfers = allTransfers.filter(tr => String(tr.OldPOS || '').startsWith('M-') || String(tr.NewPOS || '').startsWith('M-'));

        const queryOpts = apiEngine.parseDynamicQuery(req.query);
        const effectiveLimit = req.query.limit ? queryOpts.limit : 999999;
        const defaultCompactFields = ['id', 'serial', 'model', 'manufacturer', 'condition_type', 'condition_label', 'condition_badge', 'notes'];
        const projectedDevices = apiEngine.projectFields(devicesList, queryOpts.fields, queryOpts.view, defaultCompactFields);
        const paginatedDevices = effectiveLimit >= 999999 ? projectedDevices : projectedDevices.slice(queryOpts.offset, queryOpts.offset + effectiveLimit);

        const summary = {
            total_warehouse_pos: totalWarehouse,
            new_for_sale: newForSaleCount,
            branch_internal: branchInternalCount,
            ready_in_stock: readyInStockCount,
            faulty_in_branch: faultyInBranchCount,
            branch_standby_swaps: standbyTransfers.length,
            hq_maintenance_swaps: hqTransfers.length,
            total_merchant_pos: inMerchantDevices.length,
            grand_total_fleet: totalDevices,
            warehouse_utilization_pct: totalDevices > 0 ? ((inMerchantDevices.length / totalDevices) * 100).toFixed(1) : 0
        };

        const envelope = apiEngine.buildEnvelope({
            success: true,
            summary,
            data: paginatedDevices,
            total: devicesList.length,
            page: queryOpts.page,
            limit: queryOpts.limit,
            view: queryOpts.view,
            legacyKeys: {
                models: queryOpts.view === 'summary' ? [] : modelsList,
                manufacturers: queryOpts.view === 'summary' ? [] : manufacturersList,
                devices: paginatedDevices
            }
        });

        res.json(envelope);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3.6 SIM CARDS WAREHOUSE & INVENTORY DASHBOARD API
// ==========================================

app.get('/api/inventory/sims-dashboard', async (req, res) => {
    try {
        const [allSims, rawStoreSims, merchantAssets, allMerchants] = await Promise.all([
            allQuery('SELECT * FROM sim_cards'),
            allQuery('SELECT * FROM store_sim_raw ORDER BY rowid ASC'),
            allQuery(`
                SELECT ma.*, m.name as merchant_name, m.government
                FROM merchant_assets ma
                LEFT JOIN merchants m ON m.merchant_code = ma.merchant_code
                WHERE ma.sim_card_id IS NOT NULL
            `),
            allQuery('SELECT merchant_code, name, government FROM merchants')
        ]);

        function normalizeCarrier(carrier) {
            if (!carrier) return 'غير محدد';
            const c = String(carrier).trim().toLowerCase();
            if (c.includes('voda')) return 'Vodafone';
            if (c.includes('orange') || c.includes('اورنج') || c.includes('أورنج')) return 'Orange';
            if (c.includes('etisalat') || c.includes('اتصالات')) return 'Etisalat';
            if (c.includes('we') || c.includes('te data') || c.includes('المصرية')) return 'WE';
            return carrier.trim();
        }

        const totalSims = allSims.length;
        const inMerchantSims = allSims.filter(s => s.status === 'assigned');

        let newSimsCount = 0;
        let fuelProjectCount = 0;
        let faultySimsCount = 0;
        let readySimsCount = 0;

        const simsList = rawStoreSims.map((r, idx) => {
            const s = String(r.sim_serial || '').trim();
            const carrier = normalizeCarrier(r.sim_type || r.network);
            const notes = String(r.notes || '').trim();
            const isFaulty = r.faulty === 'True' || r.faulty === true || notes.includes('لا تعمل');

            let conditionType = 'READY_IN_STOCK';
            let conditionLabel = 'جاهزة وسليمة بالمخزن ✅';
            let conditionBadge = 'inmerchant';

            if (notes.includes('new_sim') || notes.includes('جديدة')) {
                conditionType = 'NEW_SIM';
                conditionLabel = 'شرائح جديدة واردة 🛍️';
                conditionBadge = 'new-sale';
                newSimsCount++;
            } else if (notes.includes('وقود') || notes.includes('مشروع الوقود')) {
                if (isFaulty) {
                    conditionType = 'FAULTY_SIM';
                    conditionLabel = 'مشروع الوقود (معطلة / لا تعمل) ⚠️';
                    conditionBadge = 'faulty';
                    faultySimsCount++;
                } else {
                    conditionType = 'PROJECT_FUEL';
                    conditionLabel = 'مخصصة لمشروع الوقود ⛽';
                    conditionBadge = 'branch-use';
                    fuelProjectCount++;
                }
            } else if (isFaulty) {
                conditionType = 'FAULTY_SIM';
                conditionLabel = 'معطلة / لا تعمل بالفرع ⚠️';
                conditionBadge = 'faulty';
                faultySimsCount++;
            } else {
                conditionType = 'READY_IN_STOCK';
                conditionLabel = 'جاهزة وسليمة بالمخزن ✅';
                conditionBadge = 'inmerchant';
                readySimsCount++;
            }

            return {
                id: idx + 1,
                serial: s,
                carrier,
                status: isFaulty ? 'faulty' : 'in_stock',
                condition_type: conditionType,
                condition_label: conditionLabel,
                condition_badge: conditionBadge,
                notes: notes || (conditionType === 'NEW_SIM' ? 'وارد جديد' : (conditionType === 'PROJECT_FUEL' ? 'مشروع الوقود' : (isFaulty ? 'شريحة تالفة' : 'سليمة'))),
                reviewed: r.reviewed
            };
        });

        const totalWarehouseSims = simsList.length;

        // Carrier Breakdown for Warehouse & All SIMs
        const carrierMap = new Map();
        
        // Initialize from allSims
        allSims.forEach(sim => {
            const carrier = normalizeCarrier(sim.carrier);
            if (!carrierMap.has(carrier)) {
                carrierMap.set(carrier, {
                    carrier,
                    total_all: 0,
                    in_merchant: 0,
                    total_warehouse: 0,
                    ready_in_stock: 0,
                    new_sims: 0,
                    fuel_project: 0,
                    faulty: 0
                });
            }
            const item = carrierMap.get(carrier);
            item.total_all++;
            if (sim.status === 'assigned') {
                item.in_merchant++;
            }
        });

        // Populate from warehouse list
        simsList.forEach(item => {
            if (!carrierMap.has(item.carrier)) {
                carrierMap.set(item.carrier, {
                    carrier: item.carrier,
                    total_all: 0,
                    in_merchant: 0,
                    total_warehouse: 0,
                    ready_in_stock: 0,
                    new_sims: 0,
                    fuel_project: 0,
                    faulty: 0
                });
            }
            const m = carrierMap.get(item.carrier);
            m.total_warehouse++;
            if (item.condition_type === 'NEW_SIM') m.new_sims++;
            else if (item.condition_type === 'PROJECT_FUEL') m.fuel_project++;
            else if (item.condition_type === 'FAULTY_SIM') m.faulty++;
            else if (item.condition_type === 'READY_IN_STOCK') m.ready_in_stock++;
        });

        const carriersList = Array.from(carrierMap.values()).map(c => ({
            ...c,
            warehouse_share_pct: totalWarehouseSims > 0 ? ((c.total_warehouse / totalWarehouseSims) * 100).toFixed(1) : 0,
            all_share_pct: totalSims > 0 ? ((c.total_all / totalSims) * 100).toFixed(1) : 0
        })).sort((a, b) => b.total_warehouse - a.total_warehouse || b.total_all - a.total_all);

        const queryOpts = apiEngine.parseDynamicQuery(req.query);
        const effectiveLimit = req.query.limit ? queryOpts.limit : 999999;
        const defaultCompactFields = ['id', 'serial', 'sim_type', 'condition_type', 'condition_label', 'condition_badge', 'notes'];
        const projectedSims = apiEngine.projectFields(simsList, queryOpts.fields, queryOpts.view, defaultCompactFields);
        const paginatedSims = effectiveLimit >= 999999 ? projectedSims : projectedSims.slice(queryOpts.offset, queryOpts.offset + effectiveLimit);

        const summary = {
            total_warehouse_sims: totalWarehouseSims,
            new_sims: newSimsCount,
            fuel_project: fuelProjectCount,
            ready_in_stock: readySimsCount,
            faulty_sims: faultySimsCount,
            total_merchant_sims: inMerchantSims.length,
            grand_total_sims: totalSims,
            warehouse_utilization_pct: totalSims > 0 ? ((inMerchantSims.length / totalSims) * 100).toFixed(1) : 0
        };

        const envelope = apiEngine.buildEnvelope({
            success: true,
            summary,
            data: paginatedSims,
            total: simsList.length,
            page: queryOpts.page,
            limit: queryOpts.limit,
            view: queryOpts.view,
            legacyKeys: {
                carriers: queryOpts.view === 'summary' ? [] : carriersList,
                sims: paginatedSims
            }
        });

        res.json(envelope);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3.7 HQ CENTRAL MAINTENANCE DASHBOARD API
// ==========================================
app.get('/api/inventory/hq-maintenance-dashboard', async (req, res) => {
    try {
        const [maintRecords, spRecords, allDevices] = await Promise.all([
            allQuery('SELECT * FROM maintenance_raw ORDER BY CAST(ID AS INTEGER) DESC'),
            allQuery('SELECT * FROM store_sp_maintenance_raw'),
            allQuery('SELECT serial, model, manufacturer, status FROM devices')
        ]);

        // Map spare parts strictly by form_no and by (form_no + serial)
        const spByFormAndSerial = new Map();
        const spByForm = new Map();
        const spNoFormBySerial = new Map();

        spRecords.forEach(sp => {
            const fNo = String(sp.form_no || sp.formNo || '').trim();
            const sNo = String(sp.serial || sp.Serial || '').trim();
            
            if (fNo && fNo !== '0' && fNo !== '-') {
                if (!spByForm.has(fNo)) spByForm.set(fNo, []);
                spByForm.get(fNo).push(sp);

                if (sNo) {
                    const key = `${fNo}_${sNo}`;
                    if (!spByFormAndSerial.has(key)) spByFormAndSerial.set(key, []);
                    spByFormAndSerial.get(key).push(sp);
                }
            } else if (sNo) {
                if (!spNoFormBySerial.has(sNo)) spNoFormBySerial.set(sNo, []);
                spNoFormBySerial.get(sNo).push(sp);
            }
        });

        // Device lookup map
        const deviceMap = new Map();
        allDevices.forEach(d => deviceMap.set(d.serial, d));

        // Process all maintenance dispatches
        let currentlyAtHqCount = 0;
        let completedCyclesCount = 0;
        const uniqueSerials = new Set();
        const modelStatsMap = new Map();
        const faultCategoryMap = new Map();

        const dispatches = maintRecords.map(m => {
            const serial = String(m['Unit Serial'] || '').trim();
            if (serial) uniqueSerials.add(serial);

            const dev = deviceMap.get(serial);
            let model = m.Model || dev?.model || 'S90';
            if (!model || model === '-') model = 'S90';
            let mfg = m.Manufactor || dev?.manufacturer || (model === 'T3' ? 'Trendit' : 'PAX');

            const outDate = m['Checked Out Date'] || '';
            const inDate = m['Checked In Date'] || '';
            const isCurrentlyAtHq = !inDate || inDate.trim() === '';

            if (isCurrentlyAtHq) {
                currentlyAtHqCount++;
            } else {
                completedCyclesCount++;
            }

            // Stats by Model
            if (!modelStatsMap.has(model)) {
                modelStatsMap.set(model, {
                    model,
                    manufacturer: mfg,
                    total_dispatches: 0,
                    currently_at_hq: 0,
                    completed: 0
                });
            }
            const mStat = modelStatsMap.get(model);
            mStat.total_dispatches++;
            if (isCurrentlyAtHq) mStat.currently_at_hq++;
            else mStat.completed++;

            // Fault parsing from Notes
            const notesRaw = String(m.Notes || '').trim();
            const notesLower = notesRaw.toLowerCase();
            const faultsDetected = [];
            if (notesLower.includes('main') || notesLower.includes('board')) faultsDetected.push('بوردة رئيسية (Main Board)');
            if (notesLower.includes('sam')) faultsDetected.push('بوردة سام (SAM Board)');
            if (notesLower.includes('power') || notesLower.includes('socket')) faultsDetected.push('مدخل باور وشحن (Power Socket)');
            if (notesLower.includes('sim')) faultsDetected.push('بيت شريحة (SIM Slot)');
            if (notesLower.includes('printer') || notesLower.includes('طابعة')) faultsDetected.push('طابعة وماكينة ورق (Printer)');
            if (notesLower.includes('reader') || notesLower.includes('قارئ')) faultsDetected.push('قارئ كروت ذكية (Card Reader)');
            if (notesLower.includes('reset') || notesLower.includes('سوفت')) faultsDetected.push('إعادة ضبط وسوفت وير (Reset/Software)');
            if (notesLower.includes('key') || notesLower.includes('كيبورد') || notesLower.includes('f2')) faultsDetected.push('أزرار ولوحة مفاتيح (Keypad/F2)');

            faultsDetected.forEach(f => {
                faultCategoryMap.set(f, (faultCategoryMap.get(f) || 0) + 1);
            });

            // Replaced spare parts strict lookup
            const formNo = String(m.FormNo || '').trim();
            let parts = [];
            if (formNo && formNo !== '0' && formNo !== '-') {
                const spKey = `${formNo}_${serial}`;
                parts = spByFormAndSerial.get(spKey) || spByForm.get(formNo) || [];
            } else if (serial) {
                // If dispatch has no formNo, only match parts without formNo
                parts = spNoFormBySerial.get(serial) || [];
            }

            return {
                id: m.ID,
                serial,
                manufacturer: mfg,
                model,
                out_date: outDate,
                in_date: inDate,
                is_open: isCurrentlyAtHq,
                status_key: isCurrentlyAtHq ? 'OPEN_AT_HQ' : 'COMPLETED',
                status_label: isCurrentlyAtHq ? 'قيد الصيانة بالمركز الرئيسي' : 'تم الإصلاح وعادت للمخزن',
                form_no: formNo || '-',
                notes: notesRaw || '-',
                faults_detected: faultsDetected.length > 0 ? faultsDetected.join(' + ') : (notesRaw || 'فحص شامل'),
                spare_parts: parts.map(p => ({
                    type: p.type,
                    count: p.count_out,
                    date: p.out_date,
                    notes: p.notes
                }))
            };
        });

        // Top faults list
        const topFaults = Array.from(faultCategoryMap.entries())
            .map(([fault, count]) => ({ fault, count }))
            .sort((a, b) => b.count - a.count);

        // Models list sorted
        const modelsList = Array.from(modelStatsMap.values())
            .sort((a, b) => b.total_dispatches - a.total_dispatches);

        const queryOpts = apiEngine.parseDynamicQuery(req.query);
        const effectiveLimit = req.query.limit ? queryOpts.limit : 999999;
        const defaultCompactFields = ['id', 'serial', 'model', 'out_date', 'in_date', 'status_label', 'form_no', 'faults_detected'];
        const projectedDispatches = apiEngine.projectFields(dispatches, queryOpts.fields, queryOpts.view, defaultCompactFields);
        const paginatedDispatches = effectiveLimit >= 999999 ? projectedDispatches : projectedDispatches.slice(queryOpts.offset, queryOpts.offset + effectiveLimit);

        const summary = {
            total_cycles: maintRecords.length,
            currently_at_hq: currentlyAtHqCount,
            completed_cycles: completedCyclesCount,
            unique_machines: uniqueSerials.size,
            spare_parts_consumed: spRecords.length
        };

        const envelope = apiEngine.buildEnvelope({
            success: true,
            summary,
            data: paginatedDispatches,
            total: dispatches.length,
            page: queryOpts.page,
            limit: queryOpts.limit,
            view: queryOpts.view,
            legacyKeys: {
                models: queryOpts.view === 'summary' ? [] : modelsList,
                top_faults: queryOpts.view === 'summary' ? [] : topFaults,
                dispatches: paginatedDispatches
            }
        });

        res.json(envelope);
    } catch (err) {
        console.error('HQ Maintenance Dashboard error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3.8 POS INSTALLMENTS PORTFOLIO DASHBOARD API
// ==========================================
app.get('/api/inventory/installments-dashboard', async (req, res) => {
    try {
        const baseRows = await allQuery(`
            SELECT 
                t.id,
                t.pos as pos_serial,
                t.installments as duration_months,
                CAST(t.unitprice AS REAL) as unit_price,
                CAST(t.finalunitprice AS REAL) as final_unit_price,
                CAST(t.monthlyinstallmentprice AS REAL) as monthly_installment_price,
                COALESCE(m.name, p.payer_max, '-') as merchant_name,
                COALESCE(m.merchant_code, '-') as merchant_code,
                COALESCE(m.government, '-') as government,
                COALESCE(p.paid_installments_sum, 0) as paid_installments_amount,
                COALESCE(p.paid_downpayment_sum, 0) as paid_downpayment_amount,
                COALESCE(p.total_paid_sum, 0) as total_payments_sum,
                p.first_send_date,
                p.last_payment_date,
                d.model as device_model,
                d.manufacturer as device_mfg
            FROM tblinstallments t
            LEFT JOIN (
                SELECT 
                    pos_number,
                    MAX(payer) as payer_max,
                    SUM(CASE WHEN payment_reason LIKE '%قسط%' AND payment_reason NOT LIKE '%مقدم%' THEN CAST(payment_amount AS REAL) ELSE 0 END) as paid_installments_sum,
                    SUM(CASE WHEN payment_reason LIKE '%مقدم%' THEN CAST(payment_amount AS REAL) ELSE 0 END) as paid_downpayment_sum,
                    SUM(CAST(payment_amount AS REAL)) as total_paid_sum,
                    MIN(CASE WHEN payment_reason LIKE '%قسط%' AND payment_reason NOT LIKE '%مقدم%' THEN send_date ELSE NULL END) as first_send_date,
                    MAX(payment_date) as last_payment_date
                FROM payments_raw
                GROUP BY pos_number
            ) p ON t.pos = p.pos_number
            LEFT JOIN devices d ON d.serial = t.pos
            LEFT JOIN merchant_assets ma ON ma.device_id = d.id
            LEFT JOIN merchants m ON m.merchant_code = ma.merchant_code
            ORDER BY CAST(t.id AS INTEGER) ASC
        `);

        let totalExpected = 0;
        let totalCollected = 0;
        let totalRemaining = 0;
        let totalDownpayment = 0;
        let totalPaidInstallments = 0;
        let fullyPaidCount = 0;
        let lateCount = 0;

        const durationStatsMap = {
            '6': { duration: 6, count: 0, total_value: 0, collected: 0, remaining: 0, monthly_price: 1510, completed: 0, late: 0 },
            '12': { duration: 12, count: 0, total_value: 0, collected: 0, remaining: 0, monthly_price: 886, completed: 0, late: 0 }
        };

        const govStatsMap = new Map();

        const contracts = baseRows.map(r => {
            const downPayment = 3000;
            const monthly = r.monthly_installment_price || (r.duration_months === 12 ? 886 : 1510);
            const paidInstallmentsCount = Math.floor(r.paid_installments_amount / monthly);
            const remainingInstallmentsCount = Math.max(0, r.duration_months - paidInstallmentsCount);
            const remainingAmount = Math.max(0, r.final_unit_price - (downPayment + r.paid_installments_amount));
            const isLate = remainingInstallmentsCount > 0 && remainingAmount > 0;
            const totalPaid = downPayment + r.paid_installments_amount;

            totalExpected += r.final_unit_price;
            totalCollected += totalPaid;
            totalRemaining += remainingAmount;
            totalDownpayment += downPayment;
            totalPaidInstallments += r.paid_installments_amount;

            if (isLate) lateCount++;
            else fullyPaidCount++;

            // Duration stats
            const dKey = String(r.duration_months);
            if (durationStatsMap[dKey]) {
                const ds = durationStatsMap[dKey];
                ds.count++;
                ds.total_value += r.final_unit_price;
                ds.collected += totalPaid;
                ds.remaining += remainingAmount;
                if (isLate) ds.late++;
                else ds.completed++;
            }

            // Gov stats
            const govName = r.government && r.government !== '-' ? r.government : 'غير محدد';
            if (!govStatsMap.has(govName)) {
                govStatsMap.set(govName, { name: govName, count: 0, total_value: 0, collected: 0, remaining: 0 });
            }
            const gs = govStatsMap.get(govName);
            gs.count++;
            gs.total_value += r.final_unit_price;
            gs.collected += totalPaid;
            gs.remaining += remainingAmount;

            return {
                id: r.id,
                pos_serial: r.pos_serial,
                merchant_code: r.merchant_code,
                merchant_name: r.merchant_name,
                government: r.government,
                device_model: r.device_model || (r.pos_serial.startsWith('2330') ? 'D230' : (r.pos_serial.startsWith('3210') ? 'T3' : 'S90')),
                device_mfg: r.device_mfg || (r.pos_serial.startsWith('3210') ? 'Trendit' : 'PAX'),
                duration_months: r.duration_months,
                down_payment: downPayment,
                unit_price: r.unit_price,
                final_unit_price: r.final_unit_price,
                monthly_installment_price: monthly,
                paid_installments_count: paidInstallmentsCount,
                paid_installments_amount: r.paid_installments_amount,
                remaining_installments_count: remainingInstallmentsCount,
                remaining_amount: remainingAmount,
                total_paid: totalPaid,
                status_label: isLate ? 'متأخر / عليه متبقي' : 'مسدد بالكامل / منتظم',
                status_key: isLate ? 'LATE' : 'COMPLETED',
                months_late: isLate ? remainingInstallmentsCount : 0,
                overdue_amount: isLate ? remainingInstallmentsCount * monthly : 0,
                first_send_date: r.first_send_date || '-',
                last_payment_date: r.last_payment_date || '-'
            };
        });

        const govList = Array.from(govStatsMap.values()).sort((a, b) => b.count - a.count);

        const queryOpts = apiEngine.parseDynamicQuery(req.query);
        const effectiveLimit = req.query.limit ? queryOpts.limit : 999999;
        const defaultCompactFields = ['id', 'pos_serial', 'merchant_code', 'merchant_name', 'device_model', 'duration_months', 'final_unit_price', 'total_paid', 'remaining_amount', 'status_key', 'status_label'];
        const projectedContracts = apiEngine.projectFields(contracts, queryOpts.fields, queryOpts.view, defaultCompactFields);
        const paginatedContracts = effectiveLimit >= 999999 ? projectedContracts : projectedContracts.slice(queryOpts.offset, queryOpts.offset + effectiveLimit);

        const summary = {
            total_contracts: baseRows.length,
            total_expected_amount: totalExpected,
            total_collected_amount: totalCollected,
            total_downpayment_amount: totalDownpayment,
            total_paid_installments_amount: totalPaidInstallments,
            total_remaining_amount: totalRemaining,
            fully_paid_count: fullyPaidCount,
            late_count: lateCount,
            collection_rate_pct: totalExpected > 0 ? ((totalCollected / totalExpected) * 100).toFixed(1) : 0
        };

        const envelope = apiEngine.buildEnvelope({
            success: true,
            summary,
            data: paginatedContracts,
            total: contracts.length,
            page: queryOpts.page,
            limit: queryOpts.limit,
            view: queryOpts.view,
            legacyKeys: {
                durations: queryOpts.view === 'summary' ? [] : Object.values(durationStatsMap),
                gov_distribution: queryOpts.view === 'summary' ? [] : govList,
                contracts: paginatedContracts
            }
        });

        res.json(envelope);
    } catch (err) {
        console.error('Installments Dashboard error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3.9 SPARE PARTS INVENTORY & MOVEMENTS DASHBOARD API (Store_SP)
// ==========================================
app.get('/api/inventory/spare-parts-dashboard', async (req, res) => {
    try {
        const { date_from = '', date_to = '', payment_status = 'all', part_type = 'all', search = '', limit = 50, offset = 0 } = req.query;

        const [allMovementsRaw, allPartsDef, allMerchants, allMerchantAssets, allPayments] = await Promise.all([
            allQuery(`
                SELECT s.rowid as id, s.type, s.count_in, s.count_out, s.Serial as serial_raw, s.notes, s.out_date, s.in_date, s.Model
                FROM store_sp_raw s
                ORDER BY s.rowid DESC
            `),
            allQuery('SELECT * FROM spare_parts'),
            allQuery('SELECT merchant_code, name, government FROM merchants'),
            allQuery(`
                SELECT ma.merchant_code, m.name as merchant_name, m.government, d.serial as pos_serial, d.model, d.manufacturer
                FROM merchant_assets ma
                JOIN merchants m ON m.merchant_code = ma.merchant_code
                LEFT JOIN devices d ON d.id = ma.device_id
            `),
            allQuery('SELECT ref_num, payment_place FROM payments WHERE ref_num IS NOT NULL AND ref_num != ""')
        ]);

        // Price & metadata map
        const partPricesMap = new Map();
        allPartsDef.forEach(p => partPricesMap.set(p.part_name, { price: parseFloat(p.price) || 100, critical: p.critical_limit || 5 }));

        // Comprehensive Merchants Lookup Map
        const merchantsMap = new Map();
        allMerchants.forEach(m => {
            const codeStr = String(m.merchant_code || '').trim();
            if (codeStr) {
                merchantsMap.set(codeStr, m);
                merchantsMap.set(codeStr.replace(/^0+/, ''), m);
                merchantsMap.set(codeStr.padStart(6, '0'), m);
            }
        });

        // Device to Asset lookup map
        const deviceAssetMap = new Map();
        allMerchantAssets.forEach(a => {
            if (a.pos_serial) {
                deviceAssetMap.set(a.pos_serial.toUpperCase().trim(), a);
                deviceAssetMap.set(a.pos_serial.trim(), a);
            }
        });

        // Receipt to Payment Place Lookup Map
        const paymentsMap = new Map();
        allPayments.forEach(p => {
            if (p.ref_num) {
                paymentsMap.set(p.ref_num.trim(), (p.payment_place || '').trim() || 'ضامن');
            }
        });

        // Precision Date Parser & Filter Range
        const { startTimestamp, endTimestamp } = UniversalDateEngine.parsePrecisionRange(date_from, date_to);

        // 1. Calculate All-Time Stock Balances for every part
        const stockBalanceMap = new Map();
        let grandWarehouseStock = 0;
        allPartsDef.forEach(p => {
            stockBalanceMap.set(p.part_name, 0);
        });

        for (const row of allMovementsRaw) {
            const partName = row.type || 'أخرى';
            const countInVal = parseInt(row.count_in) || 0;
            const countOutVal = parseInt(row.count_out) || 0;
            const isStockIn = countInVal > 0;
            const qty = isStockIn ? countInVal : (countInVal < 0 ? Math.abs(countInVal) : (countOutVal > 0 ? countOutVal : 1));
            
            if (!stockBalanceMap.has(partName)) stockBalanceMap.set(partName, 0);
            const cur = stockBalanceMap.get(partName);
            if (isStockIn) {
                stockBalanceMap.set(partName, cur + qty);
            } else {
                stockBalanceMap.set(partName, cur - qty);
            }
        }

        for (const [_, val] of stockBalanceMap) {
            grandWarehouseStock += Math.max(0, val);
        }

        // 2. Initialize Period / Filter Aggregation Structures
        const periodPartStatsMap = new Map();
        allPartsDef.forEach(p => {
            periodPartStatsMap.set(p.part_name, {
                part_name: p.part_name,
                unit_price: parseFloat(p.price) || 100,
                total_in: 0,
                total_out: 0,
                current_stock: stockBalanceMap.get(p.part_name) || 0,
                paid_count: 0,
                free_count: 0,
                deferred_count: 0,
                total_revenue: 0,
                tx_count: 0
            });
        });

        const periodGovStatsMap = new Map();
        const periodChannelStatsMap = new Map();

        let totalPiecesIn = 0;
        let totalPiecesOut = 0;
        let totalPaidAmount = 0;
        let totalPaidPieces = 0;
        let totalFreePieces = 0;
        let totalFreeValueSaved = 0;
        let totalDeferredAmount = 0;
        let totalDeferredPieces = 0;

        const processedMovements = [];

        // Preload all price history from failure_points_price_history for point-in-time accurate pricing
        const priceHistory = await allQuery(`
            SELECT * FROM failure_points_price_history ORDER BY effective_from ASC;
        `);

        function getHistoricalPrice(part, rawDateStr) {
            if (!part) return 0;
            const pClean = part.trim();
            if (!rawDateStr) return partPricesMap.get(pClean)?.price || 0;

            const mDateObj = UniversalDateEngine.parsePrecisionDate(rawDateStr);
            const mIso = mDateObj ? mDateObj.toISOString() : String(rawDateStr);

            const partChanges = priceHistory.filter(h => h.part_name === pClean && h.effective_from <= mIso);
            if (partChanges.length > 0) {
                return partChanges[partChanges.length - 1].new_price;
            }

            const allForPart = priceHistory.filter(h => h.part_name === pClean);
            if (allForPart.length > 0) {
                return allForPart[0].old_price || allForPart[0].new_price;
            }

            return partPricesMap.get(pClean)?.price || 0;
        }

        for (const row of allMovementsRaw) {
            const rawSerial = String(row.serial_raw || row.Serial || '').trim();
            const rawNotes = String(row.notes || '').trim();
            const partName = row.type ? row.type.trim() : 'قطعة غير محددة';
            const countInVal = parseInt(row.count_in) || 0;
            const countOutVal = parseInt(row.count_out) || 0;
            const isStockIn = countInVal > 0;
            const quantity = isStockIn ? countInVal : (countInVal < 0 ? Math.abs(countInVal) : (countOutVal || 1));

            // Extract POS Serial
            let posSerial = '-';
            if (rawNotes && rawNotes !== '-' && !rawNotes.startsWith('01') && rawNotes.length >= 6) {
                posSerial = rawNotes;
            } else if (rawSerial.includes(' - ')) {
                const parts = rawSerial.split(' - ').map(s => s.trim());
                for (const p of parts) {
                    if (p.length >= 6 && !p.startsWith('401') && !p.startsWith('01') && p !== 'مجاني' && p !== partName) {
                        posSerial = p;
                        break;
                    }
                }
            }

            // Extract Merchant Code & Receipt Number
            const combinedText = `${rawSerial} ${rawNotes}`;
            let extractedMerchantCode = null;
            const mCodeMatch = combinedText.match(/\b0?(\d{5,6})\b/);
            if (mCodeMatch && !mCodeMatch[0].startsWith('401') && !mCodeMatch[0].startsWith('402')) {
                extractedMerchantCode = mCodeMatch[0].padStart(6, '0');
            }

            let receiptNum = '-';
            const receiptMatch = combinedText.match(/(401\d{10,12}|402\d{10,12}|851\d{10,12})/);
            if (receiptMatch) receiptNum = receiptMatch[0];

            // Resolve Merchant Object & Government
            const devAsset = posSerial ? (deviceAssetMap.get(posSerial.toUpperCase()) || deviceAssetMap.get(posSerial)) : null;
            let merchantObj = null;
            if (extractedMerchantCode) {
                merchantObj = merchantsMap.get(extractedMerchantCode) || merchantsMap.get(extractedMerchantCode.replace(/^0+/, ''));
            }
            if (!merchantObj && devAsset) {
                merchantObj = merchantsMap.get(String(devAsset.merchant_code)) || { name: devAsset.merchant_name, government: devAsset.government, merchant_code: devAsset.merchant_code };
            }

            const merchantName = merchantObj?.name || (extractedMerchantCode ? `مخبز كود #${extractedMerchantCode}` : '-');
            const merchantCode = merchantObj?.merchant_code || extractedMerchantCode || (devAsset?.merchant_code ? String(devAsset.merchant_code) : '-');
            const government = merchantObj?.government || devAsset?.government || '-';

            // Determine Payment Classification & Channel
            let payKey = 'PAID_DIRECT';
            let payLabel = 'مسدد بمقابل';
            let paymentChannel = '-';

            const isFree = combinedText.includes('مجاني') || combinedText.includes('ضمان');
            const isDeferred = combinedText.includes('مؤجل') || combinedText.includes('تحصيلات مؤجلة');

            if (isStockIn) {
                payKey = 'STOCK_IN';
                payLabel = 'رصيد / توريد وارد';
                paymentChannel = 'توريد وارد للمخزن 📥';
            } else if (isFree) {
                payKey = 'FREE_WARRANTY';
                payLabel = 'مجاني (بدون مقابل)';
                paymentChannel = 'صيانة مجانية (بدون مقابل) 🛡️';
            } else if (isDeferred) {
                payKey = 'DEFERRED_PENDING';
                payLabel = 'تحصيلات مؤجلة ⚠️';
                paymentChannel = 'تحصيل مؤجل / مستحق ⚠️';
            } else if (receiptNum !== '-') {
                payKey = 'PAID_DIRECT';
                const place = paymentsMap.get(receiptNum) || (receiptNum.startsWith('401') || receiptNum.startsWith('402') ? 'ضامن' : 'إيداع بنكي / بريدي');
                payLabel = `مسدد بمقابل (${place})`;
                paymentChannel = place;
            } else {
                payKey = 'PAID_DIRECT';
                payLabel = 'مسدد بمقابل';
                paymentChannel = 'مسدد بإيصال';
            }

            // Date Parsing with Universal Engine
            const rawDateStr = row.out_date || row.in_date || '';
            const movementDateObj = UniversalDateEngine.parsePrecisionDate(rawDateStr);
            const movementTimestamp = movementDateObj ? movementDateObj.getTime() : null;

            // Point-in-time exact pricing based on movement date!
            const unitPrice = getHistoricalPrice(partName, rawDateStr);
            const totalPrice = (payKey === 'FREE_WARRANTY') ? 0 : (quantity * unitPrice);
            const freePieceValue = (payKey === 'FREE_WARRANTY') ? (quantity * unitPrice) : 0;

            // 1. Check Date Range Filter
            if (startTimestamp && movementTimestamp && movementTimestamp < startTimestamp) continue;
            if (endTimestamp && movementTimestamp && movementTimestamp > endTimestamp) continue;
            if ((startTimestamp || endTimestamp) && !movementTimestamp) continue;

            // 2. Check Payment Status Filter
            if (payment_status === 'PAID' && (payKey !== 'PAID_DIRECT' && payKey !== 'PAID_RECONCILED')) continue;
            if (payment_status === 'FREE' && payKey !== 'FREE_WARRANTY') continue;
            if (payment_status === 'DEFERRED' && payKey !== 'DEFERRED_PENDING') continue;
            if (payment_status === 'STOCK_IN' && payKey !== 'STOCK_IN') continue;

            // 3. Check Part Type Filter
            if (part_type && part_type !== 'all' && partName !== part_type) continue;

            // 4. Check Search Filter
            if (search && search.trim()) {
                const qLower = search.trim().toLowerCase();
                const matchSearch = partName.toLowerCase().includes(qLower) ||
                    rawSerial.toLowerCase().includes(qLower) ||
                    rawNotes.toLowerCase().includes(qLower) ||
                    receiptNum.includes(qLower) ||
                    merchantName.toLowerCase().includes(qLower) ||
                    String(merchantCode).includes(qLower) ||
                    government.toLowerCase().includes(qLower) ||
                    paymentChannel.toLowerCase().includes(qLower) ||
                    (posSerial && posSerial.toLowerCase().includes(qLower));
                if (!matchSearch) continue;
            }

            // Accumulate Statistics ONLY for matching records in the filtered period
            if (!periodPartStatsMap.has(partName)) {
                periodPartStatsMap.set(partName, {
                    part_name: partName,
                    unit_price: unitPrice,
                    total_in: 0,
                    total_out: 0,
                    current_stock: stockBalanceMap.get(partName) || 0,
                    paid_count: 0,
                    free_count: 0,
                    deferred_count: 0,
                    total_revenue: 0,
                    tx_count: 0
                });
            }
            const pStat = periodPartStatsMap.get(partName);
            pStat.tx_count++;

            if (isStockIn) {
                pStat.total_in += quantity;
                totalPiecesIn += quantity;
            } else {
                pStat.total_out += quantity;
                totalPiecesOut += quantity;

                if (payKey === 'FREE_WARRANTY') {
                    pStat.free_count += quantity;
                    totalFreePieces += quantity;
                    totalFreeValueSaved += freePieceValue;
                } else if (payKey === 'DEFERRED_PENDING') {
                    pStat.deferred_count += quantity;
                    totalDeferredPieces += quantity;
                    totalDeferredAmount += (quantity * unitPrice);
                } else {
                    pStat.paid_count += quantity;
                    pStat.total_revenue += totalPrice;
                    totalPaidPieces += quantity;
                    totalPaidAmount += totalPrice;
                }
            }

            // Government Aggregations for matching movements
            if (!isStockIn && government !== '-') {
                if (!periodGovStatsMap.has(government)) {
                    periodGovStatsMap.set(government, { name: government, pieces: 0, amount: 0, paid_pieces: 0, free_pieces: 0 });
                }
                const gStat = periodGovStatsMap.get(government);
                gStat.pieces += quantity;
                if (payKey === 'FREE_WARRANTY') gStat.free_pieces += quantity;
                else {
                    gStat.paid_pieces += quantity;
                    gStat.amount += totalPrice;
                }
            }

            // Channel Aggregations
            if (!isStockIn) {
                const chKey = paymentChannel.includes('ضامن') ? 'ضامن' : (paymentChannel.includes('بريد') ? 'البريد' : (paymentChannel.includes('بنك') ? 'البنك' : (payKey === 'FREE_WARRANTY' ? 'مجاني (بدون مقابل)' : 'أخرى')));
                if (!periodChannelStatsMap.has(chKey)) {
                    periodChannelStatsMap.set(chKey, { name: chKey, pieces: 0, amount: 0 });
                }
                const cStat = periodChannelStatsMap.get(chKey);
                cStat.pieces += quantity;
                if (payKey !== 'FREE_WARRANTY') cStat.amount += totalPrice;
            }

            processedMovements.push({
                id: row.id,
                date: rawDateStr || '-',
                timestamp: movementTimestamp,
                part_name: partName,
                is_stock_in: isStockIn,
                movement_type: isStockIn ? 'توريد وارد' : 'صرف وتركيب',
                quantity: quantity,
                pos_serial: posSerial || '-',
                merchant_name: merchantName,
                merchant_code: merchantCode,
                government: government,
                payment_status_key: payKey,
                payment_status_label: payLabel,
                payment_channel: paymentChannel,
                receipt_number: receiptNum,
                unit_price: unitPrice,
                total_amount: totalPrice,
                notes: rawNotes !== 'BEGINING' ? rawNotes : 'رصيد افتتاحي'
            });
        }

        // Parts breakdown sorted by activity in the filtered period
        const isFilterActive = Boolean(startTimestamp || endTimestamp || payment_status !== 'all' || (part_type && part_type !== 'all') || search);
        const partsBreakdownList = Array.from(periodPartStatsMap.values()).map(p => {
            return {
                ...p,
                consumption_rate_pct: p.total_in > 0 ? Math.min(100, Math.round((p.total_out / p.total_in) * 100)) : (p.total_out > 0 ? 100 : 0)
            };
        }).sort((a, b) => {
            if (isFilterActive) {
                return (b.total_out + b.total_in) - (a.total_out + a.total_in) || b.current_stock - a.current_stock;
            }
            return b.total_out - a.total_out || b.total_in - a.total_in;
        });

        // Top Governments in the filtered period
        const topGovernmentsList = Array.from(periodGovStatsMap.values()).sort((a, b) => b.pieces - a.pieces).slice(0, 15);
        const channelsList = Array.from(periodChannelStatsMap.values()).sort((a, b) => b.pieces - a.pieces);

        const queryOpts = apiEngine.parseDynamicQuery(req.query);
        const totalFiltered = processedMovements.length;
        const pageLimit = req.query.limit === 'all' ? 999999 : (parseInt(req.query.limit, 10) || (queryOpts.view === 'compact' ? 20 : 50));
        const pageOffset = parseInt(req.query.offset, 10) || ((queryOpts.page - 1) * pageLimit);

        const defaultCompactFields = ['id', 'date', 'part_name', 'movement_type', 'quantity', 'pos_serial', 'merchant_name', 'government', 'payment_status_key', 'payment_status_label', 'total_amount'];
        const projectedMovements = apiEngine.projectFields(processedMovements, queryOpts.fields, queryOpts.view, defaultCompactFields);
        const paginatedMovements = pageLimit >= 999999 ? projectedMovements : projectedMovements.slice(pageOffset, pageOffset + pageLimit);

        const summary = {
            total_stock_in: totalPiecesIn,
            total_stock_out: totalPiecesOut,
            current_stock_balance: grandWarehouseStock,
            total_paid_amount: totalPaidAmount,
            total_paid_pieces: totalPaidPieces,
            total_free_pieces: totalFreePieces,
            total_free_value_saved: totalFreeValueSaved,
            total_deferred_amount: totalDeferredAmount,
            total_deferred_pieces: totalDeferredPieces,
            total_movements: allMovementsRaw.length,
            filtered_movements_count: totalFiltered,
            paid_ratio_pct: (totalPaidPieces + totalFreePieces) > 0 ? ((totalPaidPieces / (totalPaidPieces + totalFreePieces)) * 100).toFixed(1) : '0.0'
        };

        const envelope = apiEngine.buildEnvelope({
            success: true,
            summary,
            data: paginatedMovements,
            total: totalFiltered,
            page: queryOpts.page,
            limit: pageLimit,
            view: queryOpts.view,
            legacyKeys: {
                parts_breakdown: queryOpts.view === 'summary' ? [] : partsBreakdownList,
                governments_breakdown: queryOpts.view === 'summary' ? [] : topGovernmentsList,
                channels_breakdown: queryOpts.view === 'summary' ? [] : channelsList,
                movements: paginatedMovements,
                pagination: {
                    total: totalFiltered,
                    limit: pageLimit,
                    offset: pageOffset,
                    pages: Math.ceil(totalFiltered / pageLimit) || 1
                }
            }
        });

        res.json(envelope);
    } catch (err) {
        console.error('Spare Parts Dashboard error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. ADVANCED REPORTS & ANALYTICS API
// ==========================================

app.get('/api/reports/eod-detail', async (req, res) => {
    try {
        const { date = '' } = req.query;
        if (!date) return res.status(400).json({ error: "Date parameter is required" });

        const targetIso = parseDateToIso(date) || date;

        // 1. Closed Tickets on this date
        const allTickets = await allQuery(`
            SELECT 
                t.id, t.type as ticket_type, t.issue_date, t.close_date,
                t.merchant_code, m.name as merchant_name, m.government,
                d.serial as device_serial, d.model as device_model,
                t.issue_details, t.resolution_details, t.technician_name, t.status
            FROM tickets t
            LEFT JOIN merchants m ON m.merchant_code = t.merchant_code
            LEFT JOIN devices d ON d.id = t.device_id
            ORDER BY t.id DESC
        `);
        const dayTickets = allTickets.filter(t => parseDateToIso(t.close_date || t.issue_date) === targetIso);

        // 2. Spare parts dispatched on this date
        const allParts = await allQuery(`
            SELECT 
                s.rowid as id,
                s.type as part_name,
                s.count_in,
                s.Serial as serial_raw,
                s.notes as pos_serial,
                s.out_date,
                COALESCE(sp.price, 100) as unit_price
            FROM store_sp_raw s
            LEFT JOIN spare_parts sp ON sp.part_name = s.type
            WHERE s.count_in LIKE '-%' OR CAST(s.count_in AS INTEGER) < 0
            ORDER BY s.rowid DESC
        `);

        const dayParts = allParts.filter(p => parseDateToIso(p.out_date) === targetIso).map(r => {
            const s = String(r.serial_raw || '').trim();
            const notes = String(r.pos_serial || '').trim();
            let payment_status = 'PAID';
            let receipt_num = '';
            let merchant_code = '';

            if (s.includes('مجاني') || s.includes('ضمان') || notes.includes('مجاني')) {
                payment_status = 'FREE';
            } else if (s.includes('مؤجل') || s.includes('تحصيلات مؤجلة')) {
                payment_status = 'DEFERRED';
            }

            const receiptMatch = s.match(/(\d{10,20})/);
            if (receiptMatch && payment_status === 'PAID') {
                receipt_num = receiptMatch[1];
            }

            const merchantMatch = s.match(/\b(0\d{5}|\d{5,6})\b/);
            if (merchantMatch) {
                merchant_code = merchantMatch[1];
            } else if (s.includes('_3D') || s.includes('_3C') || s.includes('_3H')) {
                const m = s.match(/_([30][A-Z0-9]{7})/);
                if (m) merchant_code = m[1];
            }

            const qty = Math.abs(parseInt(r.count_in) || 1);
            return {
                id: r.id,
                out_date: r.out_date,
                part_name: r.part_name,
                quantity: qty,
                merchant_code: merchant_code || 'عام',
                pos_serial: r.pos_serial || '-',
                payment_status,
                receipt_num: receipt_num || '-',
                unit_price: r.unit_price,
                total_amount: qty * r.unit_price
            };
        });

        // 3. Payments collected on this date
        const allPayments = await allQuery(`
            SELECT p.*, m.name as merchant_name, m.government
            FROM payments p 
            LEFT JOIN merchants m ON m.merchant_code = p.merchant_code
            ORDER BY p.id DESC
        `);
        const dayPayments = allPayments.filter(p => parseDateToIso(p.payment_date) === targetIso);

        // Summary calculations
        const uniqueMerchants = Array.from(new Set(dayTickets.map(t => t.merchant_code).filter(Boolean)));
        const techniciansList = Array.from(new Set(dayTickets.map(t => t.technician_name).filter(Boolean)));
        const totalCash = dayPayments.reduce((acc, p) => acc + (p.amount || 0), 0);
        const totalSparePartsCount = dayParts.reduce((acc, p) => acc + p.quantity, 0);

        res.json({
            success: true,
            date,
            isoDate: targetIso,
            summary: {
                total_tickets: dayTickets.length,
                unique_merchants_count: uniqueMerchants.length,
                technicians_count: techniciansList.length,
                technicians_list: techniciansList,
                total_cash_collected: totalCash,
                spare_parts_dispatched_count: totalSparePartsCount,
                payments_count: dayPayments.length
            },
            tickets: dayTickets,
            spare_parts: dayParts,
            payments: dayPayments
        });
    } catch (err) {
        console.error("EOD detail query error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Universal Asset Search & Historical Timeline API
app.get('/api/assets/timeline', async (req, res) => {
    try {
        const { query = '' } = req.query;
        const q = query.trim();
        if (!q) return res.status(400).json({ error: "Query parameter is required" });

        const cleanQ = q.replace(/^M-/i, '');
        const altQ = 'M-' + cleanQ;

        // 1. Direct deep search in assets_raw (resolves POS, POS_2, POS_3, bkcode, Cell_Serial, SIM2, Owner)
        const rawAsset = await getQuery(`
            SELECT a.*, 
                   COALESCE(a.bkcode, a.POSID) as clean_bkcode,
                   COALESCE(a.Owner, a.Contact_person) as clean_owner,
                   COALESCE(a.dep, a.SupplyOffice) as clean_gov
            FROM assets_raw a
            WHERE a.POS = ? OR a.POS_2 = ? OR a.pos_3 = ? 
               OR a.bkcode = ? OR a.POSID = ? OR a.bkcode = ? OR a.bkcode = ?
               OR a.Cell_Serial = ? OR a.Cell_Serial3 = ?
               OR a.telephone_1 = ? OR a.NationalD = ?
            LIMIT 1
        `, [q, q, q, q, cleanQ, altQ, q.padStart(6, '0'), q, q, q, q]);

        // 2. Search in Devices
        let device = await getQuery(`
            SELECT d.*, m.name as merchant_name, m.merchant_code, m.government, s.serial as sim_serial, s.carrier as sim_carrier
            FROM devices d
            LEFT JOIN merchant_assets ma ON ma.device_id = d.id
            LEFT JOIN merchants m ON m.merchant_code = ma.merchant_code
            LEFT JOIN sim_cards s ON s.id = ma.sim_card_id
            WHERE d.serial = ? OR d.serial = ? OR d.serial = ? OR d.serial LIKE ?
            LIMIT 1
        `, [q, cleanQ, altQ, `%${cleanQ}%`]);

        // 3. Search in SIM Cards
        let sim = await getQuery(`
            SELECT s.*, m.name as merchant_name, m.merchant_code, m.government, d.serial as pos_serial, d.model as pos_model
            FROM sim_cards s
            LEFT JOIN merchant_assets ma ON ma.sim_card_id = s.id
            LEFT JOIN merchants m ON m.merchant_code = ma.merchant_code
            LEFT JOIN devices d ON d.id = ma.device_id
            WHERE s.serial = ? OR s.serial LIKE ?
            LIMIT 1
        `, [q, `%${q}%`]);

        // 4. Search in Merchants
        let merchant = await getQuery(`
            SELECT m.*, d.serial as pos_serial, d.model as pos_model, s.serial as sim_serial, s.carrier as sim_carrier
            FROM merchants m
            LEFT JOIN merchant_assets ma ON ma.merchant_code = m.merchant_code
            LEFT JOIN devices d ON d.id = ma.device_id
            LEFT JOIN sim_cards s ON s.id = ma.sim_card_id
            WHERE m.merchant_code = ? OR m.merchant_code = ? OR m.name LIKE ?
            LIMIT 1
        `, [q, cleanQ, `%${q}%`]);

        // Synthesize Master Asset Profile from assets_raw if found
        if (rawAsset) {
            const isSecondary = String(rawAsset.POS_2).toUpperCase() === q.toUpperCase();
            const isTertiary = String(rawAsset.pos_3).toUpperCase() === q.toUpperCase();
            const serialToUse = isSecondary ? rawAsset.POS_2 : (isTertiary ? rawAsset.pos_3 : rawAsset.POS);
            const modelToUse = isSecondary ? (rawAsset.Model2 || 'S90') : (rawAsset.Model || 'VX520');
            const mfgToUse = isSecondary ? (rawAsset.Manufacturer2 || 'PAX') : (rawAsset.Manufacturer || 'Verifone');

            if (!merchant) {
                merchant = {
                    merchant_code: rawAsset.clean_bkcode,
                    name: rawAsset.clean_owner,
                    government: rawAsset.clean_gov || 'المرج',
                    contact_phone: rawAsset.telephone_1,
                    address: rawAsset.Address,
                    national_id: rawAsset.NationalD,
                    pos_serial: serialToUse,
                    pos_model: modelToUse
                };
            }
            if (!device) {
                device = {
                    serial: serialToUse,
                    model: modelToUse,
                    manufacturer: mfgToUse,
                    status: 'in_merchant',
                    merchant_code: rawAsset.clean_bkcode,
                    merchant_name: rawAsset.clean_owner,
                    government: rawAsset.clean_gov || 'المرج'
                };
            }
            if (!sim) {
                sim = {
                    serial: isSecondary ? (rawAsset.Cell_Serial3 || rawAsset.Cell_Serial || '-') : (rawAsset.Cell_Serial || '-'),
                    carrier: rawAsset.Cell_type || 'Orange',
                    merchant_code: rawAsset.clean_bkcode,
                    merchant_name: rawAsset.clean_owner
                };
            }
        }

        if (!merchant && device?.merchant_code) {
            merchant = await getQuery(`SELECT * FROM merchants WHERE merchant_code = ? LIMIT 1`, [device.merchant_code]);
        }

        // Build list of all related lookup keys (POS Serial, Merchant Code, SIM, alt codes)
        const allPossibleCodes = Array.from(new Set([
            q, cleanQ, altQ,
            rawAsset?.POS,
            rawAsset?.POS_2,
            rawAsset?.pos_3,
            rawAsset?.clean_bkcode,
            rawAsset?.POSID,
            rawAsset?.Cell_Serial,
            rawAsset?.Cell_Serial3,
            device?.serial,
            merchant?.merchant_code,
            merchant?.pos_serial,
            sim?.serial,
            sim?.pos_serial
        ].filter(Boolean)));

        const placeholders = allPossibleCodes.map(() => '?').join(',');
        const timelineEvents = [];

        // 0. Pre-fetch branch spare parts records to correlate with maintenance tickets
        let allSpForAsset = [];
        if (allPossibleCodes.length > 0) {
            allSpForAsset = await allQuery(`
                SELECT s.rowid as id, s.type, s.count_in, s.Serial as serial_raw, s.notes, s.out_date
                FROM store_sp_raw s
                WHERE s.count_in LIKE '-%' OR CAST(s.count_in AS INTEGER) < 0
                ORDER BY s.rowid DESC
            `);
        }

        // 1. Events from transactions_raw (Complete Service History)
        if (allPossibleCodes.length > 0) {
            const transParams = [...allPossibleCodes, ...allPossibleCodes];
            const transactions = await allQuery(`
                SELECT t.*
                FROM transactions_raw t
                WHERE t.POSN IN (${placeholders}) OR t.GrocerName IN (${placeholders})
                ORDER BY t.ID DESC
            `, transParams);

            transactions.forEach(t => {
                let tech = t.Procedure || '';
                if (tech.toUpperCase() === 'AHMEDMAHDY') tech = 'أحمد المهدي محفوظ المهدي';
                else if (tech.toUpperCase() === 'ELFAKHARANY') tech = 'أحمد فؤاد سيد الفخراني';
                else if (tech.toUpperCase() === 'MESSAM') tech = 'محمد عصام محمود فرغلي';
                else if (tech.toUpperCase() === 'MOSTAFA') tech = 'مصطفى محمد أبو العطا';
                else if (!tech || tech.startsWith('DESKTOP') || tech === 'SHARE' || tech === '35') tech = 'فني الصيانة بالفرع';

                const evMerchantCode = t.GrocerName || merchant?.merchant_code || '';
                const evMerchantName = merchant?.name || (evMerchantCode ? `مخبز كود #${evMerchantCode}` : '');
                const noteD = String(t.NoteD || '').trim();
                const noteG = String(t.NoteG || '').trim();

                // Check if this action involved a spare part replacement
                const isPartReplacement = /(?:تغير|تغيير|استبدال|تركيب)\s+([^\s,]+(?:\s+[^\s,]+)?)/i.test(noteD) && !/تنظيف|سوفت|تحديث|فحص|برمجة/.test(noteD);

                let matchedSp = null;
                if (isPartReplacement && allSpForAsset.length > 0) {
                    matchedSp = allSpForAsset.find(sp => {
                        const s = String(sp.serial_raw || '');
                        const n = String(sp.notes || '');
                        const posMatch = (t.POSN && (n.includes(t.POSN) || s.includes(t.POSN)));
                        const d1 = sp.out_date ? sp.out_date.substring(0, 9).toLowerCase() : '';
                        const d2 = t.IssueDate ? t.IssueDate.substring(0, 9).toLowerCase() : (t.ActionDate ? t.ActionDate.substring(0, 9).toLowerCase() : '');
                        const dateMatch = d1 && d2 && d1 === d2;
                        const typeMatch = sp.type && (noteD.includes(sp.type) || sp.type.includes(noteD.replace(/تغير|تغيير|استبدال|تركيب/g, '').trim()));
                        
                        // Exact match: POS + (Same Date OR Same Part Type)
                        if (posMatch && (dateMatch || typeMatch)) return true;
                        // Merchant match if date and part type match
                        if (dateMatch && typeMatch && (s.includes(t.GrocerName) || n.includes(t.GrocerName))) return true;
                        return false;
                    });
                }

                let cost_status = 'FREE';
                let cost_badge = 'مجاني (ضمان)';
                let receipt_number = null;
                let replaced_part = null;

                if (matchedSp) {
                    replaced_part = matchedSp.type;
                    const s = String(matchedSp.serial_raw || '');
                    const rMatch = s.match(/(\d{10,20})/);
                    if (rMatch) {
                        receipt_number = rMatch[1];
                        cost_status = 'PAID';
                        cost_badge = `مسدد بمقابل (إيصال #${receipt_number})`;
                    } else if (s.includes('مؤجل')) {
                        cost_status = 'DEFERRED';
                        cost_badge = 'تحصيل مؤجل ⚠️';
                    } else {
                        cost_status = 'FREE';
                        cost_badge = 'مجاني (بدون مقابل - ضمان)';
                    }
                } else if (isPartReplacement) {
                    replaced_part = noteD.replace(/تغير|تغيير|استبدال|تركيب/g, '').trim();
                    if (t.Fees === 'True' || parseFloat(t.FeesAmount) > 0 || t.Paid === 'True') {
                        cost_status = 'PAID';
                        cost_badge = `مسدد بمقابل (${t.FeesAmount || 0} جم)`;
                    } else {
                        cost_status = 'FREE';
                        cost_badge = 'مجاني (بدون مقابل - ضمان)';
                    }
                } else {
                    // Regular maintenance without spare parts (e.g. cleaning, software update)
                    cost_status = (t.Fees === 'True' || parseFloat(t.FeesAmount) > 0) ? 'PAID' : 'FREE';
                    cost_badge = (t.Fees === 'True' || parseFloat(t.FeesAmount) > 0) ? `مسدد بمقابل (${t.FeesAmount || 0} جم)` : 'صيانة مجانية';
                }

                timelineEvents.push({
                    type: 'MAINTENANCE',
                    title: `بلاغ وإجراء صيانة #${t.ID}: ${t.ActionType || 'إصلاح عطل'}`,
                    date: t.IssueDate || t.ActionDate || 'تاريخ غير محدد',
                    technician: tech,
                    merchant_code: evMerchantCode,
                    merchant_name: evMerchantName,
                    pos_serial: t.POSN || device?.serial || '',
                    merchant: evMerchantName ? `${evMerchantName} (${evMerchantCode})` : evMerchantCode,
                    complaint: noteG || 'عطل ماكينة',
                    resolution: noteD || 'تم الفحص والإصلاح',
                    replaced_part: replaced_part || null,
                    cost_status: cost_status,
                    cost_badge: cost_badge,
                    receipt_number: receipt_number || null,
                    fees_amount: t.FeesAmount || '0',
                    detail: `الشكوى: ${noteG || 'عطل ماكينة'} | ما تم إنجازه: ${noteD || 'تم الفحص والإصلاح'} | الماكينة: ${t.POSN || '-'}`,
                    icon: 'wrench'
                });
            });
        }

        // 2. Events from maintenance_raw (HQ Central Maintenance Dispatches)
        const hqMaintenanceList = [];
        if (allPossibleCodes.length > 0) {
            const maintRecords = await allQuery(`
                SELECT m.*
                FROM maintenance_raw m
                WHERE m."Unit Serial" IN (${placeholders})
                ORDER BY CAST(m.ID AS INTEGER) DESC
            `, allPossibleCodes);

            const spMaintList = await allQuery(`
                SELECT Serial as serial, type, faulty, faulty_detils, formNo as form_no, Model as model, count_out, out_date, notes
                FROM store_sp_maintenance_raw
                WHERE Serial IN (${placeholders}) OR formNo IN (
                    SELECT FormNo FROM maintenance_raw WHERE "Unit Serial" IN (${placeholders}) AND FormNo IS NOT NULL AND FormNo != ''
                )
            `, [...allPossibleCodes, ...allPossibleCodes]);

            maintRecords.forEach(m => {
                let tech = m.Procedure || '';
                if (tech.toUpperCase() === 'AHMEDMAHDY') tech = 'أحمد المهدي محفوظ المهدي';
                else if (tech.toUpperCase() === 'ELFAKHARANY') tech = 'أحمد فؤاد سيد الفخراني';
                else if (tech.toUpperCase() === 'MESSAM') tech = 'محمد عصام محمود فرغلي';
                else if (tech.toUpperCase() === 'MOSTAFA') tech = 'مصطفى محمد أبو العطا';
                else if (!tech || tech.startsWith('DESKTOP')) tech = 'مركز الصيانة الرئيسي (HQ)';

                const formNo = String(m.FormNo || '').trim();
                const uSerial = String(m['Unit Serial'] || '').trim();
                
                let matchedParts = [];
                if (formNo && formNo !== '0' && formNo !== '-') {
                    matchedParts = spMaintList.filter(sp => String(sp.form_no || '').trim() === formNo);
                } else if (uSerial) {
                    matchedParts = spMaintList.filter(sp => 
                        String(sp.serial || '').trim() === uSerial && 
                        (!sp.form_no || String(sp.form_no).trim() === '' || String(sp.form_no).trim() === '0' || String(sp.form_no).trim() === '-')
                    );
                }

                const partsDesc = matchedParts.length > 0 
                    ? ` | قطع الغيار المستبدلة بالمركز الرئيسي: ${matchedParts.map(p => `${p.type} (${p.count_out || 1})`).join('، ')}`
                    : '';

                const isReturned = m['Checked In Date'] && m['Checked In Date'].trim() !== '';
                const statusText = isReturned ? 'تم الإصلاح وعادت للمخزن' : 'قيد الصيانة بالمركز الرئيسي حالياً ⚠️';

                const hqItem = {
                    id: m.ID,
                    serial: uSerial,
                    out_date: m['Checked Out Date'] || '',
                    in_date: m['Checked In Date'] || '',
                    form_no: formNo || '-',
                    model: m.Model || '',
                    notes: m.Notes || '-',
                    status: statusText,
                    is_returned: isReturned,
                    technician: tech,
                    spare_parts: matchedParts.map(p => ({
                        type: p.type,
                        count: p.count_out,
                        date: p.out_date,
                        notes: p.notes
                    }))
                };
                hqMaintenanceList.push(hqItem);

                timelineEvents.push({
                    type: 'HQ_MAINTENANCE',
                    title: `صيانة بالمركز الرئيسي (HQ) #${m.ID}: إذن رقم (${formNo || 'بدون'})`,
                    date: m['Checked In Date'] || m['Checked Out Date'] || 'تاريخ غير محدد',
                    technician: tech,
                    merchant_code: merchant?.merchant_code || '',
                    merchant_name: merchant?.name || '',
                    pos_serial: uSerial || device?.serial || '',
                    merchant: uSerial || '',
                    detail: `تاريخ الإرسال: ${m['Checked Out Date'] || '-'} | تاريخ العودة: ${m['Checked In Date'] || 'قيد الإصلاح'} | الحالة: ${statusText} | تشخيص العطل: ${m.Notes || 'فحص شامل'}${partsDesc}`,
                    icon: 'wrench'
                });
            });
        }

        // 3. Events from Transfers / Movements (temp_transfer_raw)
        if (allPossibleCodes.length > 0) {
            const transferParams = [...allPossibleCodes, ...allPossibleCodes, ...allPossibleCodes];
            const transfers = await allQuery(`
                SELECT tt.*
                FROM temp_transfer_raw tt
                WHERE tt.bkCode IN (${placeholders}) OR tt.OldPOS IN (${placeholders}) OR tt.NewPOS IN (${placeholders})
                ORDER BY tt.Transfer_Date DESC
            `, transferParams);

            transfers.forEach(tr => {
                let tech = tr.procedure || '';
                if (tech.toUpperCase() === 'MESSAM') tech = 'محمد عصام محمود فرغلي';
                else if (tech.toUpperCase() === 'ELFAKHARANY') tech = 'أحمد فؤاد سيد الفخراني';
                else if (tech.toUpperCase() === 'AHMEDMAHDY') tech = 'أحمد المهدي محفوظ المهدي';

                const oldPos = String(tr.OldPOS || '').trim();
                const newPos = String(tr.NewPOS || '').trim();

                let oldDesc = oldPos;
                if (oldPos.startsWith('S') || oldPos.startsWith('s')) oldDesc = `${oldPos} (عهدة فرع)`;
                else if (oldPos.startsWith('M-') || oldPos.startsWith('m-')) oldDesc = `${oldPos} (صيانة رئيسي)`;

                let newDesc = newPos;
                if (newPos.startsWith('S') || newPos.startsWith('s')) newDesc = `${newPos} (عهدة فرع)`;
                else if (newPos.startsWith('M-') || newPos.startsWith('m-')) newDesc = `${newPos} (صيانة رئيسي)`;

                timelineEvents.push({
                    type: 'TRANSFER',
                    title: `استبدال ونقل ماكينة/شريحة: ${oldDesc} ➔ ${newDesc}`,
                    date: tr.Transfer_Date || 'تاريخ سابق',
                    technician: tech || 'قسم النقل والتسليم',
                    merchant_code: tr.bkCode || merchant?.merchant_code || '',
                    merchant_name: tr.POSCode || merchant?.name || '',
                    pos_serial: tr.NewPOS || tr.OldPOS || '',
                    merchant: tr.POSCode ? `${tr.POSCode} (${tr.bkCode || ''})` : (tr.bkCode || ''),
                    detail: `الملاحظات: ${tr.Notes || 'استبدال ماكينة/شريحة'} | النوع: ${tr.OldType || '-'} ➔ ${tr.NewType || '-'}`,
                    icon: 'truck'
                });
            });
        }

        // 4. Events from External Trade Logistics (trade_raw)
        if (allPossibleCodes.length > 0) {
            const allTrade = await allQuery(`
                SELECT t.rowid as id, t.ID as trade_id, t."Item Serial" as item_serial, t."Item Type" as item_type, t."Trade Type" as trade_type, t."Trade Location" as trade_location, t."Out Date" as out_date, t."In Date" as in_date, Quantity, "Form Number" as form_number, "IN/OUT BY" as operator, Comments
                FROM trade_raw t
                ORDER BY t.rowid DESC
            `);

            allTrade.forEach(tr => {
                const s = String(tr.item_serial || '');
                const comments = String(tr.Comments || '');
                const isMatch = allPossibleCodes.some(c => c && (s.includes(c) || comments.includes(c)));
                if (isMatch) {
                    const direction = (String(tr.trade_type || '').toLowerCase().includes('in')) ? 'وارد للمخزن' : 'صادر لجهة خارجية';
                    let tech = tr.operator || '';
                    if (tech.toUpperCase() === 'MESSAM') tech = 'محمد عصام محمود فرغلي';
                    else if (tech.toUpperCase() === 'ELFAKHARANY') tech = 'أحمد فؤاد سيد الفخراني';
                    else if (tech.toUpperCase() === 'AHMEDMAHDY') tech = 'أحمد المهدي محفوظ المهدي';

                    timelineEvents.push({
                        type: 'LOGISTICS',
                        title: `حركة لوجستيات (${direction}): ${tr.trade_location || 'المركز الرئيسي'}`,
                        date: tr.in_date || tr.out_date || 'تاريخ غير محدد',
                        technician: tech || 'لوجستيات ومخازن',
                        merchant_code: merchant?.merchant_code || '',
                        merchant_name: merchant?.name || '',
                        pos_serial: tr.item_serial || device?.serial || '',
                        merchant: tr.trade_location || '',
                        detail: `النوع: ${tr.item_type || 'POS'} | السيريال: ${tr.item_serial} | الاستمارة: ${tr.form_number || '-'} | البيان: ${tr.Comments || '-'}`,
                        icon: 'package'
                    });
                }
            });
        }

        // 5. Events from Branch Spare Parts Dispatches (store_sp_raw - صيانة الفرع المحلية)
        if (allPossibleCodes.length > 0) {
            const allSpForAsset = await allQuery(`
                SELECT s.rowid as id, s.type, s.count_in, s.Serial as serial_raw, s.notes, s.out_date
                FROM store_sp_raw s
                WHERE s.count_in LIKE '-%' OR CAST(s.count_in AS INTEGER) < 0
                ORDER BY s.rowid DESC
            `);

            allSpForAsset.forEach(r => {
                const s = String(r.serial_raw || '');
                const notes = String(r.notes || '');
                const isMatch = allPossibleCodes.some(c => c && (s.includes(c) || notes.includes(c)));
                if (isMatch) {
                    let receiptNum = '-';
                    const rMatch = s.match(/(\d{10,20})/);
                    if (rMatch) receiptNum = rMatch[1];

                    // Extract actual merchant code from the record if embedded
                    let evMerchantCode = merchant?.merchant_code || '';
                    const bkMatch = s.match(/\b0?(\d{5,6})\b/);
                    if (bkMatch && bkMatch[1] !== receiptNum) {
                        evMerchantCode = bkMatch[1];
                    }

                    const isFree = s.includes('مجاني') || s.includes('ضمان') || notes.includes('مجاني');
                    const isDeferred = s.includes('مؤجل') || s.includes('تحصيلات مؤجلة');

                    let statusLabel = 'صيانة مجانية 🛡️';
                    let priceText = 'مجاني (بدون مقابل)';

                    if (isFree) {
                        statusLabel = 'مجاني (بدون مقابل - ضمان)';
                        priceText = 'مجاني (بدون مقابل)';
                    } else if (isDeferred) {
                        statusLabel = 'تحصيلات مؤجلة ⚠️';
                        priceText = 'تحصيل مؤجل';
                    } else if (receiptNum !== '-') {
                        statusLabel = `مسدد بمقابل (إيصال: ${receiptNum}) ✅`;
                        priceText = 'مسدد بإيصال رسمي';
                    } else {
                        statusLabel = 'صيانة فرع معتمدة';
                        priceText = 'مسدد بالفرع';
                    }

                    const evMerchantName = merchant?.name || (evMerchantCode ? `مخبز كود #${evMerchantCode}` : '');
                    const evPos = notes || device?.serial || '-';

                    timelineEvents.push({
                        type: 'SPARE_PART_BRANCH',
                        title: `صيانة وقطع غيار الفرع: ${r.type} (${Math.abs(parseInt(r.count_in) || 1)} قطعة)`,
                        date: r.out_date || 'تاريخ غير محدد',
                        technician: 'صيانة الفرع المحلية',
                        merchant_code: evMerchantCode,
                        merchant_name: evMerchantName,
                        pos_serial: evPos,
                        merchant: evMerchantName ? `${evMerchantName} (${evMerchantCode})` : (evMerchantCode || evPos),
                        detail: `القطعة المستبدلة: ${r.type} | المقابل المالي: ${priceText} | حالة السداد: ${statusLabel} | الماكينة: ${evPos}`,
                        icon: 'cpu'
                    });
                }
            });
        }

        // 6. Events from Payments
        if (allPossibleCodes.length > 0) {
            const payParams = [...allPossibleCodes, ...allPossibleCodes];
            const payments = await allQuery(`
                SELECT p.*, m.name as merchant_name
                FROM payments p
                LEFT JOIN merchants m ON m.merchant_code = p.merchant_code
                WHERE p.merchant_code IN (${placeholders}) OR p.ref_num IN (${placeholders})
                ORDER BY p.id DESC
            `, payParams);

            payments.forEach(p => {
                timelineEvents.push({
                    type: 'PAYMENT',
                    title: `سداد مالي: ${Number(p.amount || 0).toLocaleString('ar-EG')} جم (#${p.ref_num || p.id})`,
                    date: p.payment_date || 'تاريخ غير محدد',
                    technician: p.payment_place || 'الفرع',
                    merchant_code: p.merchant_code || merchant?.merchant_code || '',
                    merchant_name: p.merchant_name || merchant?.name || '',
                    pos_serial: device?.serial || '',
                    merchant: p.merchant_name ? `${p.merchant_name} (${p.merchant_code})` : p.merchant_code,
                    detail: `السبب: ${p.reason || 'سداد مستحقات'} | الإيصال المرجعي: ${p.ref_num || '-'}`,
                    icon: 'receipt'
                });
            });
        }

        res.json({
            success: true,
            query: q,
            totalEvents: timelineEvents.length,
            assetSummary: {
                device: device || null,
                sim: sim || null,
                merchant: merchant || null
            },
            hqMaintenance: hqMaintenanceList,
            timeline: timelineEvents
        });
    } catch (err) {
        console.error("Asset timeline error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Printable Memo / Receipt Data API
app.get('/api/print/memo/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;

        if (type === 'delivery' || type === 'return') {
            const merchant = await getQuery(`
                SELECT m.*, d.serial as pos_serial, d.model as pos_model, d.manufacturer as pos_mfg,
                       s.serial as sim_serial, s.carrier as sim_carrier
                FROM merchants m
                LEFT JOIN merchant_assets ma ON ma.merchant_code = m.merchant_code
                LEFT JOIN devices d ON d.id = ma.device_id
                LEFT JOIN sim_cards s ON s.id = ma.sim_card_id
                WHERE m.merchant_code = ? OR d.serial = ?
                LIMIT 1
            `, [id, id]);

            if (!merchant) return res.status(404).json({ error: "Record not found" });

            res.json({
                success: true,
                type,
                doc_title: type === 'delivery' ? 'إذن تسليم وتركيب ماكينة وشريحة' : 'إذن استرجاع ماكينة للمخزن',
                doc_number: `MEMO-${type.toUpperCase()}-${merchant.merchant_code}-${Date.now().toString().slice(-4)}`,
                date: new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }),
                data: merchant
            });
        } else if (type === 'receipt') {
            const payment = await getQuery(`
                SELECT p.*, m.name as merchant_name, m.government, m.contact_phone,
                       d.serial as pos_serial, d.model as pos_model
                FROM payments p
                LEFT JOIN merchants m ON m.merchant_code = p.merchant_code
                LEFT JOIN merchant_assets ma ON ma.merchant_code = m.merchant_code
                LEFT JOIN devices d ON d.id = ma.device_id
                WHERE p.id = ? OR p.ref_num = ?
                LIMIT 1
            `, [id, id]);

            if (!payment) return res.status(404).json({ error: "Payment not found" });

            res.json({
                success: true,
                type: 'receipt',
                doc_title: 'إيصال استلام وسداد نقدي رسمي',
                doc_number: `REC-${payment.ref_num || payment.id}`,
                date: payment.payment_date,
                data: payment
            });
        } else {
            res.status(400).json({ error: "Invalid memo type" });
        }
    } catch (err) {
        console.error("Print memo error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Spare Parts Official Price Revision History API (failure_points_price_history)
app.get('/api/inventory/spare-parts/price-history', async (req, res) => {
    try {
        const partName = req.query.part_name;
        let rows;
        if (partName) {
            rows = await allQuery(`
                SELECT * FROM failure_points_price_history 
                WHERE part_name = ? 
                ORDER BY effective_from DESC, id DESC
            `, [partName]);
        } else {
            rows = await allQuery(`
                SELECT * FROM failure_points_price_history 
                ORDER BY effective_from DESC, id DESC
            `);
        }
        res.json({ success: true, history: rows });
    } catch (err) {
        console.error("Price history error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. CLOUDFLARE ZERO-TRUST TUNNEL API
// ==========================================
const CloudflareTunnelManager = require('./tunnel_manager');
const tunnelMgr = new CloudflareTunnelManager(PORT);

app.get('/api/tunnel/status', (req, res) => {
    res.json({ success: true, ...tunnelMgr.getStatus() });
});

app.post('/api/tunnel/start', requireAdmin, async (req, res) => {
    try {
        const { token } = req.body || {};
        const status = await tunnelMgr.start(token);
        res.json({ success: true, ...status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/tunnel/stop', requireAdmin, (req, res) => {
    const status = tunnelMgr.stop();
    res.json({ success: true, ...status });
});

// ==========================================
// 5. GITHUB WEBHOOK AUTO-DEPLOY ENDPOINT
// ==========================================
const { exec } = require('child_process');

app.post('/api/webhook/github', express.raw({ type: 'application/json' }), (req, res) => {
    // HMAC-SHA256 signature verification
    if (WEBHOOK_SECRET) {
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) {
            console.warn('[GITHUB WEBHOOK] Rejected: Missing signature header');
            return res.status(401).json({ error: 'Missing signature' });
        }
        const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        const expected = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
            console.warn('[GITHUB WEBHOOK] Rejected: Invalid signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }
    }

    const event = req.headers['x-github-event'] || 'push';
    console.log(`[GITHUB WEBHOOK] Verified event: ${event}`);
    
    if (event === 'ping') {
        return res.json({ success: true, message: 'Pong! Webhook connected successfully.' });
    }
    
    res.json({ success: true, message: 'Auto-deploy triggered!' });
    
    const deployCmd = 'cd /var/www/smartcs && git fetch origin main && git reset --hard origin/main && npm install --production && sudo systemctl restart smartcs';
    exec(deployCmd, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) {
            console.error('[GITHUB WEBHOOK ERROR]', err.message);
        } else {
            console.log('[GITHUB WEBHOOK SUCCESS] Auto-deployed from GitHub:\n', stdout);
        }
    });
});

// ==========================================
// 6. CLOUD INCREMENTAL DELTA SYNC RECEIVER
// ==========================================

app.post('/api/sync/delta', express.json({ limit: '50mb' }), async (req, res) => {
    const secret = req.headers['x-sync-secret'] || req.query.secret;
    if (secret !== SYNC_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid sync secret' });
    }

    const { changes, tablesData } = req.body || {};
    let appliedCount = 0;

    try {
        if (tablesData && typeof tablesData === 'object') {
            for (const [tbl, rows] of Object.entries(tablesData)) {
                if (Array.isArray(rows) && rows.length > 0) {
                    const sample = rows[0];
                    const keys = Object.keys(sample);
                    const createCols = keys.map(k => `"${k}" TEXT`).join(', ');
                    await runQuery(`CREATE TABLE IF NOT EXISTS "${tbl}" (${createCols});`);
                    for (const row of rows) {
                        const rowKeys = Object.keys(row);
                        const placeholders = rowKeys.map(() => '?').join(', ');
                        const quotedCols = rowKeys.map(k => `"${k}"`).join(', ');
                        await runQuery(`INSERT OR REPLACE INTO "${tbl}" (${quotedCols}) VALUES (${placeholders})`, Object.values(row));
                        appliedCount++;
                    }
                }
            }
        }

        if (changes && Array.isArray(changes) && changes.length > 0) {
            for (const change of changes) {
                if (change.table_name && change.new_data) {
                    try {
                        const parsed = JSON.parse(change.new_data);
                        const keys = Object.keys(parsed);
                        const placeholders = keys.map(() => '?').join(', ');
                        const quotedCols = keys.map(k => `"${k}"`).join(', ');
                        await runQuery(`INSERT OR REPLACE INTO "${change.table_name}" (${quotedCols}) VALUES (${placeholders})`, Object.values(parsed));
                        appliedCount++;
                    } catch(e) {}
                } else if (change.table_name && change.change_type === 'DELETE' && change.record_id) {
                    await runQuery(`DELETE FROM "${change.table_name}" WHERE ID = ? OR Serial = ? OR sim_serial = ?`, [change.record_id, change.record_id, change.record_id]);
                    appliedCount++;
                }
            }
        }

        // Re-align high level domain entities
        if (syncEngine && typeof syncEngine.syncHighLevelDomainEntities === 'function') {
            await syncEngine.syncHighLevelDomainEntities(db);
        }

        // Broadcast real-time event to connected browsers
        broadcastSseEvent('sync_completed', {
            type: 'cloud_delta_applied',
            changesCount: appliedCount,
            timestamp: new Date().toISOString()
        });

        // Log to sync_history for cloud telemetry
        try {
            await runQuery(`
                INSERT INTO sync_history (sync_type, status, tables_count, records_count, changes_count, duration_ms, message, details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                'CLOUD_VPS',
                'SUCCESS',
                tablesData ? Object.keys(tablesData).length : (changes ? new Set(changes.map(c => c.table_name)).size : 0),
                appliedCount,
                appliedCount,
                0,
                `استلام وتطبيق ${appliedCount} سجل دلتا على السيرفر السحابي (VPS) بنجاح ⚡`,
                JSON.stringify({ client_ip: req.ip, applied_records: appliedCount })
            ]);
        } catch(e) {}

        console.log(`[CLOUD DELTA SYNC] Successfully applied ${appliedCount} delta record(s) to cloud database!`);
        res.json({ success: true, applied: appliedCount, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('[CLOUD DELTA SYNC ERROR]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Telemetry & Sync History Logs API
app.get('/api/sync/telemetry-logs', async (req, res) => {
    try {
        const filterType = req.query.type;
        let logs;
        if (filterType && filterType !== 'ALL') {
            logs = await allQuery(`
                SELECT * FROM sync_history 
                WHERE sync_type = ? 
                ORDER BY id DESC LIMIT 100
            `, [filterType]);
        } else {
            logs = await allQuery(`
                SELECT * FROM sync_history 
                ORDER BY id DESC LIMIT 100
            `);
        }

        const syncStatus = syncEngine.getSyncStatus();
        res.json({
            success: true,
            logs: logs || [],
            current_status: syncStatus,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error("Telemetry logs error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start Server (Listen on 0.0.0.0 for LAN / Network Sharing)
app.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIpAddress();
    console.log(`================================================================`);
    console.log(`  CS DASHBOARD - CUSTOMER SUPPORT CENTRAL OPERATIONS`);
    console.log(`================================================================`);
    console.log(`  [+] Local Host Access   : http://localhost:${PORT}`);
    console.log(`  [+] Network LAN Access  : http://${localIp}:${PORT}`);
    console.log(`  [+] Oracle Cloud VPS    : https://smartcs.m-kamel.workers.dev`);
    console.log(`  [+] Access DB Connected : ${syncEngine.getAccessFilePath()}`);
    console.log(`  [+] Mode                : READ-ONLY Safe Engine | Multi-User LAN Ready`);
    console.log(`================================================================`);
    syncEngine.startFileWatcher(db);
});
