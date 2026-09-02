const express = require('express');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const fs = require('fs');
const XLSX = require('xlsx');
const rateLimit = require('express-rate-limit');
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

// Global API rate limit
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests from this IP, please try again after a minute' }
});

// Stricter rate limit for sync delta
const syncLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // limit each IP to 30 requests per windowMs
    message: { success: false, error: 'Too many sync requests from this IP' }
});

app.use('/api/', apiLimiter);

app.get('/favicon.ico', (req, res) => res.status(204).end());

// ==========================================
// SECURITY: Config-driven secrets & admin guard
// ==========================================
function readAppConfig() {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; } catch (e) {}
    if (process.platform === 'linux' || process.env.IS_CLOUD_SERVER === 'true') {
        cfg.isCloudServer = true;
        cfg.usePostgres = true;
    }
    return cfg;
}
const appCfg = readAppConfig();
let pgPool = null;
if (appCfg.isCloudServer) {
    pgPool = new Pool({
        user: appCfg.pgUser || process.env.PGUSER || 'smartcs_user',
        password: appCfg.pgPassword || process.env.PGPASSWORD || 'smartcs_secure_2026',
        database: appCfg.pgDatabase || process.env.PGDATABASE || 'smartcs_db',
        host: appCfg.pgHost || process.env.PGHOST || '127.0.0.1',
        port: appCfg.pgPort || process.env.PGPORT || 5432,
        max: 20,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        statement_timeout: 60000,
    });
    pgPool.on('error', (err) => {
        console.error('[PG POOL ERROR] Unexpected error on idle client:', err.message);
    });
}
const SYNC_SECRET   = appCfg.syncSecret   || process.env.SYNC_SECRET   || 'smartcs-cloud-secret-2026';
const WEBHOOK_SECRET = appCfg.webhookSecret || process.env.WEBHOOK_SECRET || '';
const ADMIN_SECRET   = appCfg.adminSecret   || process.env.ADMIN_SECRET   || '';

// Timing-safe secret comparison to prevent timing attacks
function safeCompareSecret(provided, expected) {
    if (!provided || !expected) return false;
    try {
        const bufA = Buffer.from(String(provided));
        const bufB = Buffer.from(String(expected));
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    } catch { return false; }
}

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
db.run(`
    CREATE TABLE IF NOT EXISTS system_error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
        severity TEXT DEFAULT 'ERROR',
        module TEXT,
        endpoint TEXT,
        error_message TEXT,
        stack_trace TEXT,
        request_data TEXT,
        client_ip TEXT
    );
`);

// Helper for database queries with automatic error logging
async function logSystemError(module, endpoint, err, req = null, severity = 'ERROR') {
    try {
        const errMsg = err ? (err.message || String(err)) : 'Unknown error';
        const stack = err && err.stack ? err.stack : '';
        const clientIp = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '') : '';
        const reqData = req ? JSON.stringify({ method: req.method, query: req.query, path: req.path }) : null;
        
        console.error(`[SYSTEM ERROR - ${module}] [${endpoint}]:`, errMsg);
        
        db.run(`
            INSERT INTO system_error_logs (severity, module, endpoint, error_message, stack_trace, request_data, client_ip)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [severity, module, endpoint || '-', errMsg, stack, reqData, clientIp]);

        if (typeof broadcastSseEvent === 'function') {
            broadcastSseEvent('system_error_alert', {
                severity,
                module,
                endpoint,
                error_message: errMsg,
                timestamp: new Date().toISOString()
            });
        }
    } catch (e) {
        console.error('[FAILED TO LOG SYSTEM ERROR]', e.message);
    }
}

const { translateSqliteToPostgres } = require('./db_translator');

function runQuery(sql, params = []) {
    return new Promise(async (resolve, reject) => {
        if (appCfg.isCloudServer && pgPool) {
            try {
                const { pgSql, pgParams } = translateSqliteToPostgres(sql, params);
                const res = await pgPool.query(pgSql, pgParams);
                resolve({ changes: res.rowCount });
            } catch (err) {
                logSystemError('SQL_RUN', sql.slice(0, 120), err);
                reject(err);
            }
            return;
        }
        db.run(sql, params, function(err) {
            if (err) {
                logSystemError('SQL_RUN', sql.slice(0, 120), err);
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
}

function getQuery(sql, params = []) {
    return new Promise(async (resolve, reject) => {
        if (appCfg.isCloudServer && pgPool) {
            try {
                const { pgSql, pgParams } = translateSqliteToPostgres(sql, params);
                const res = await pgPool.query(pgSql, pgParams);
                resolve(res.rows[0]);
            } catch (err) {
                logSystemError('SQL_GET', sql.slice(0, 120), err);
                reject(err);
            }
            return;
        }
        db.get(sql, params, (err, row) => {
            if (err) {
                logSystemError('SQL_GET', sql.slice(0, 120), err);
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

function allQuery(sql, params = []) {
    return new Promise(async (resolve, reject) => {
        if (appCfg.isCloudServer && pgPool) {
            try {
                const { pgSql, pgParams } = translateSqliteToPostgres(sql, params);
                const res = await pgPool.query(pgSql, pgParams);
                resolve(res.rows || []);
            } catch (err) {
                logSystemError('SQL_ALL', sql.slice(0, 120), err);
                reject(err);
            }
            return;
        }
        db.all(sql, params, (err, rows) => {
            if (err) {
                logSystemError('SQL_ALL', sql.slice(0, 120), err);
                reject(err);
            } else {
                resolve(rows || []);
            }
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
        const merchantCols = await allQuery("PRAGMA table_info(merchants)").catch(() => []);
        if (merchantCols && !merchantCols.some(c => c.name === 'status')) {
            await runQuery("ALTER TABLE merchants ADD COLUMN status TEXT DEFAULT 'active'").catch(() => {});
        }
        
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


        // Initialize system_error_logs table for automated diagnostics & tracing
        await runQuery(`
            CREATE TABLE IF NOT EXISTS system_error_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
                severity TEXT DEFAULT 'ERROR',
                module TEXT,
                endpoint TEXT,
                error_message TEXT,
                stack_trace TEXT,
                request_data TEXT,
                client_ip TEXT
            );
        `);
        await runQuery(`CREATE INDEX IF NOT EXISTS idx_system_error_logs_ts ON system_error_logs(timestamp);`).catch(() => {});
        await runQuery(`CREATE INDEX IF NOT EXISTS idx_tickets_issue_clean ON tickets(issue_details);`).catch(() => {});
        await runQuery(`CREATE INDEX IF NOT EXISTS idx_devices_model ON devices(model);`).catch(() => {});
        await runQuery(`CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);`).catch(() => {});
        await runQuery(`CREATE INDEX IF NOT EXISTS idx_sims_carrier ON sim_cards(carrier);`).catch(() => {});
        await runQuery(`CREATE INDEX IF NOT EXISTS idx_sims_status ON sim_cards(status);`).catch(() => {});
        await runQuery(`CREATE INDEX IF NOT EXISTS idx_merchants_gov ON merchants(government);`).catch(() => {});
        await runQuery(`CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);`).catch(() => {});

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
            'assets_raw', 'maintenance_raw', 'transactions_raw', 'payments_raw',
            'store_pos_raw', 'store_sim_raw', 'store_sp_raw', 'store_sp_maintenance_raw',
            'installments_raw', 'tblinstallments', 'tblfaults_raw', 'tblstaff_raw',
            'tblfixes_raw', 'failure_points_raw', 'temp_transfer_raw', 'trade_raw',
            'merchant_assets', 'audit_logs', 'sync_history', 'diagnostic_errors'
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
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disables Nginx/Cloudflare proxy buffering
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
            isCloudServer: !!readAppConfig().isCloudServer,
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
        let lastHistory = null;
        try { lastHistory = await getQuery("SELECT * FROM sync_history ORDER BY id DESC LIMIT 1"); } catch(e){}
        let totalLogsCount = 0;
        try { totalLogsCount = (await getQuery("SELECT COUNT(*) as count FROM audit_change_logs"))?.count || 0; } catch(e){}
        let outboxPending = 0;
        try { outboxPending = (await getQuery("SELECT COUNT(*) as count FROM delta_outbox"))?.count || 0; } catch (e) {}
        
        res.json({
            success: true,
            isCloudServer: !!appCfg.isCloudServer,
            status: status.status || 'idle',
            isSyncInProgress: !!status.isSyncInProgress,
            progress: status.progress || {},
            lastSyncTime: lastHistory ? lastHistory.sync_time : status.lastSyncTime,
            message: status.message || 'جاهز',
            changesDetected: lastHistory ? lastHistory.changes_count : (status.changesDetected || 0),
            tablesSynced: lastHistory ? lastHistory.tables_count : (status.tablesSynced || 0),
            totalRecords: lastHistory ? lastHistory.records_count : (status.totalRecords || 0),
            durationMs: lastHistory ? lastHistory.duration_ms : (status.durationMs || 0),
            totalAuditLogs: totalLogsCount,
            outboxPendingCount: outboxPending
        });
    } catch (err) {
        res.json({
            success: true,
            status: 'idle',
            isSyncInProgress: false,
            message: err.message,
            outboxPendingCount: 0
        });
    }
});

// Trigger full sync from Access Database
app.post('/api/sync/run', async (req, res) => {
    try {
        const config = readAppConfig();
        if (config.isCloudServer) {
            // Cloud VPS is in receiver mode. Rebuild domain entities on demand.
            await syncEngine.syncHighLevelDomainEntities();
            return res.json({ 
                success: true, 
                is_cloud: true, 
                message: 'السيرفر السحابي في وضع الاستقبال التلقائي - تمت إعادة بناء الكيانات السحابية بنجاح ⚡' 
            });
        }
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
        let dueInstallments = [];
        try {
            dueInstallments = await allQuery(`
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
        } catch(e) {
            dueInstallments = [];
        }

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

let _cachedDashboardStats = null;
let _cachedDashboardStatsTime = 0;

app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const now = Date.now();
        if (_cachedDashboardStats && (now - _cachedDashboardStatsTime < 4000)) {
            return res.json(_cachedDashboardStats);
        }

        // High-level counts combined in single ultra-fast query
        const counts = await getQuery(`
            SELECT 
                (SELECT COUNT(*) FROM merchants) as "totalMerchants",
                (SELECT COUNT(*) FROM devices) as "totalDevices",
                (SELECT COUNT(*) FROM devices WHERE status IN ('in_merchant', 'DEPLOYED')) as "inMerchantDevices",
                (SELECT COUNT(*) FROM devices WHERE status IN ('in_stock', 'IN_STOCK')) as "inStockDevices",
                (SELECT COUNT(*) FROM devices WHERE status IN ('faulty', 'FAULTY')) as "faultyDevices",
                (SELECT COUNT(*) FROM sim_cards) as "totalSims",
                (SELECT COUNT(*) FROM sim_cards WHERE status IN ('assigned', 'DEPLOYED')) as "assignedSims",
                (SELECT COUNT(*) FROM sim_cards WHERE status IN ('in_stock', 'IN_STOCK')) as "inStockSims",
                (SELECT COUNT(*) FROM tickets) as "totalTickets",
                (SELECT COUNT(*) FROM tickets WHERE status IN ('OPEN', 'in_progress')) as "openTickets",
                (SELECT COUNT(*) FROM tickets WHERE status IN ('CLOSED', 'completed')) as "closedTickets",
                (SELECT COALESCE(SUM(amount), 0) FROM payments) as "totalPaymentsAmount",
                (SELECT COUNT(*) FROM payments) as "totalPaymentsCount"
        `) || {};

        const totalMerchants = counts.totalMerchants ?? counts.totalmerchants ?? 0;
        const totalDevices = counts.totalDevices ?? counts.totaldevices ?? 0;
        const inMerchantDevices = counts.inMerchantDevices ?? counts.inmerchantdevices ?? 0;
        const inStockDevices = counts.inStockDevices ?? counts.instockdevices ?? 0;
        const faultyDevices = counts.faultyDevices ?? counts.faultydevices ?? 0;
        const totalSims = counts.totalSims ?? counts.totalsims ?? 0;
        const assignedSims = counts.assignedSims ?? counts.assignedsims ?? 0;
        const inStockSims = counts.inStockSims ?? counts.instocksims ?? 0;
        const totalTickets = counts.totalTickets ?? counts.totaltickets ?? 0;
        const openTickets = counts.openTickets ?? counts.opentickets ?? 0;
        const closedTickets = counts.closedTickets ?? counts.closedtickets ?? 0;
        const totalPaymentsAmount = counts.totalPaymentsAmount ?? counts.totalpaymentsamount ?? 0;
        const totalPaymentsCount = counts.totalPaymentsCount ?? counts.totalpaymentscount ?? 0;

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

        _cachedDashboardStats = envelope;
        _cachedDashboardStatsTime = Date.now();

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
            allQuery('SELECT * FROM store_pos_raw ORDER BY rowid ASC').catch(() => []),
            allQuery('SELECT * FROM temp_transfer_raw ORDER BY rowid DESC').catch(() => []),
            allQuery('SELECT * FROM trade_raw ORDER BY rowid DESC').catch(() => []),
            allQuery('SELECT merchant_code, name, government FROM merchants').catch(() => [])
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

        const [allMovementsRaw, allPartsDef, allMerchants, allMerchantAssets, allPayments, allTransactions] = await Promise.all([
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
            allQuery('SELECT ref_num, payment_place FROM payments WHERE ref_num IS NOT NULL AND ref_num != ""'),
            allQuery(`
                SELECT POSN, GrocerName, ActionDate, IssueDate 
                FROM transactions_raw 
                WHERE ActionDate IS NOT NULL AND ActionDate != ""
            `)
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
        // Transactions Lookup Map for Date Override
        const txMap = new Map();
        allTransactions.forEach(t => {
            const code = (t.POSN || t.GrocerName || '').trim();
            if (code) {
                if (!txMap.has(code)) txMap.set(code, []);
                const txDate = UniversalDateEngine.parsePrecisionDate(t.ActionDate || t.IssueDate);
                if (txDate) txMap.get(code).push(txDate);
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
            let movementDateObj = UniversalDateEngine.parsePrecisionDate(rawDateStr);

            // Smart Date Shift Reversal (Resolving 27th artificial shift to actual transaction date)
            if (movementDateObj && !isStockIn) {
                const day = movementDateObj.getDate();
                if (day >= 24 && day <= 28) {
                    const m = movementDateObj.getMonth();
                    const y = movementDateObj.getFullYear();
                    
                    const lookupCode = (posSerial !== '-' ? posSerial : extractedMerchantCode);
                    const txList = lookupCode ? txMap.get(lookupCode) : null;
                    if (txList && txList.length > 0) {
                        const trueTxDate = txList.find(d => 
                            d.getMonth() === m && 
                            d.getFullYear() === y && 
                            d.getDate() >= 24 && 
                            d.getDate() <= 31
                        );
                        if (trueTxDate) {
                            movementDateObj = trueTxDate;
                        }
                    }
                }
            }

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
        let reqDate = String(date || '').trim();
        if (!reqDate) {
            const now = new Date();
            reqDate = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
        }

        const targetIso = parseDateToIso(reqDate) || reqDate;

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

        const allTransactionsEod = await allQuery(`
            SELECT POSN, GrocerName, ActionDate, IssueDate 
            FROM transactions_raw 
            WHERE ActionDate IS NOT NULL AND ActionDate != ""
        `);
        const txMapEod = new Map();
        allTransactionsEod.forEach(t => {
            const code = (t.POSN || t.GrocerName || '').trim();
            if (code) {
                if (!txMapEod.has(code)) txMapEod.set(code, []);
                const txDate = UniversalDateEngine.parsePrecisionDate(t.ActionDate || t.IssueDate);
                if (txDate) txMapEod.get(code).push(txDate);
            }
        });

        let processedAllParts = allParts.map(r => {
            let movementDateObj = UniversalDateEngine.parsePrecisionDate(r.out_date);
            const notesStr = String(r.pos_serial || '').trim();
            const sStr = String(r.serial_raw || '').trim();
            
            // Extract Merchant Code for fallback lookup
            let merchant_code = '';
            const merchantMatch = sStr.match(/\b(0\d{5}|\d{5,6})\b/);
            if (merchantMatch) {
                merchant_code = merchantMatch[1];
            } else if (sStr.includes('_3D') || sStr.includes('_3C') || sStr.includes('_3H')) {
                const m = sStr.match(/_([30][A-Z0-9]{7})/);
                if (m) merchant_code = m[1];
            }

            // Smart Date Shift Reversal
            if (movementDateObj) {
                const day = movementDateObj.getDate();
                if (day >= 24 && day <= 28) {
                    const m = movementDateObj.getMonth();
                    const y = movementDateObj.getFullYear();
                    const posSerial = (notesStr && notesStr !== '-' && notesStr.length >= 6) ? notesStr : merchant_code;
                    
                    const txList = posSerial ? txMapEod.get(posSerial) : null;
                    if (txList && txList.length > 0) {
                        const trueTxDate = txList.find(d => 
                            d.getMonth() === m && 
                            d.getFullYear() === y && 
                            d.getDate() >= 24 && 
                            d.getDate() <= 31
                        );
                        if (trueTxDate) {
                            movementDateObj = trueTxDate;
                            r.out_date = trueTxDate.toISOString(); // update for downstream
                        }
                    }
                }
            }
            return r;
        });

        const dayParts = processedAllParts.filter(p => parseDateToIso(p.out_date) === targetIso).map(r => {
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

// ==========================================================================
// CUSTOMER 360 CRM & ASSET DEEP-DIVE API ENDPOINTS
// ==========================================================================

// 1. Customer Smart Search (Fast suggestions across all fields)
app.get('/api/customers/search', async (req, res) => {
    try {
        const { q = '' } = req.query;
        const query = q.trim();
        if (!query || query.length < 2) {
            return res.json({ success: true, results: [] });
        }

        const cleanQ = query.replace(/^M-/i, '');
        const likeQ = `%${query}%`;
        const likeCleanQ = `%${cleanQ}%`;

        // Search in assets_raw
        const assetsMatches = await allQuery(`
            SELECT a.ID,
                   COALESCE(a.bkcode, a.POSID) as merchant_code,
                   COALESCE(a.Owner, a.Contact_person, 'مخبز غير محدد') as merchant_name,
                   COALESCE(a.dep, a.SupplyOffice, '-') as government,
                   COALESCE(a.NationalD, '-') as national_id,
                   COALESCE(a.telephone_1, a.telephone_2, '-') as phone,
                   a.POS, a.POS_2, a.pos_3,
                   a.Cell_Serial, a.[cell_2-ser] as [cell_2-ser], a.Cell_Serial3,
                   a.Address
            FROM assets_raw a
            WHERE a.bkcode LIKE ? OR a.POSID LIKE ?
               OR a.Owner LIKE ? OR a.Contact_person LIKE ?
               OR a.POS LIKE ? OR a.POS_2 LIKE ? OR a.pos_3 LIKE ?
               OR a.Cell_Serial LIKE ? OR a.[cell_2-ser] LIKE ? OR a.Cell_Serial3 LIKE ?
               OR a.NationalD LIKE ?
               OR a.telephone_1 LIKE ? OR a.telephone_2 LIKE ?
            LIMIT 15
        `, [
            likeCleanQ, likeCleanQ,
            likeQ, likeQ,
            likeQ, likeQ, likeQ,
            likeQ, likeQ, likeQ,
            likeQ,
            likeQ, likeQ
        ]);

        // Deduplicate by merchant_code
        const seenCodes = new Set();
        const results = [];

        assetsMatches.forEach(a => {
            const mCode = String(a.merchant_code || '').trim();
            if (!mCode || seenCodes.has(mCode)) return;
            seenCodes.add(mCode);

            const posList = [a.POS, a.POS_2, a.pos_3].filter(p => p && p !== '-' && p !== 'null');
            const simList = [a.Cell_Serial, a['cell_2-ser'], a.Cell_Serial3].filter(s => s && s !== '-' && s !== 'null');

            // Detect matched field
            let matchReason = 'كود المخبز';
            if (a.merchant_name && a.merchant_name.toLowerCase().includes(query.toLowerCase())) matchReason = 'اسم العميل / المخبز';
            else if (posList.some(p => String(p).toLowerCase().includes(query.toLowerCase()))) matchReason = 'سيريال ماكينة POS';
            else if (simList.some(s => String(s).toLowerCase().includes(query.toLowerCase()))) matchReason = 'سيريال شريحة SIM';
            else if (a.national_id && a.national_id.includes(query)) matchReason = 'الرقم القومي';
            else if (a.phone && a.phone.includes(query)) matchReason = 'رقم الهاتف';

            results.push({
                merchant_code: mCode,
                merchant_name: a.merchant_name,
                government: a.government,
                national_id: a.national_id,
                phone: a.phone,
                address: a.Address || '-',
                pos_serials: posList,
                sim_serials: simList,
                matched_field: matchReason
            });
        });

        res.json({ success: true, results: results.slice(0, 10) });
    } catch (err) {
        console.error("Customer search error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Helper to accurately resolve POS device specs & identify Branch Buffer (S-prefix) machines
function resolveDeviceSpecs(serial, rawAsset = null) {
    if (!serial || serial === '-' || serial === 'null' || serial === 'undefined') {
        return { serial: '-', model: 'غير محدد', manufacturer: '-', is_branch_backup: false, badge_tag: null };
    }
    const cleanRaw = String(serial).trim();
    const isBranchBackup = /^S[0-9A-Za-z]/i.test(cleanRaw);
    const stripped = cleanRaw.replace(/^S/i, '').replace(/^M-/i, '');

    let model = '';
    let manufacturer = '';

    // 1. Check rawAsset if provided
    if (rawAsset) {
        const p1 = String(rawAsset.POS || '').toUpperCase();
        const p2 = String(rawAsset.POS_2 || '').toUpperCase();
        const p3 = String(rawAsset.pos_3 || '').toUpperCase();
        const sUpper = stripped.toUpperCase();

        if (p2.includes(sUpper) || String(rawAsset.POS_2 || '').toUpperCase().includes(cleanRaw.toUpperCase())) {
            model = rawAsset.Model2 || '';
            manufacturer = rawAsset.Manufacturer2 || '';
        } else if (p3.includes(sUpper) || String(rawAsset.pos_3 || '').toUpperCase().includes(cleanRaw.toUpperCase())) {
            model = rawAsset.Model3 || '';
            manufacturer = rawAsset.Manufacturer3 || '';
        } else if (p1.includes(sUpper) || String(rawAsset.POS || '').toUpperCase().includes(cleanRaw.toUpperCase())) {
            model = rawAsset.Model || '';
            manufacturer = rawAsset.Manufacturer || '';
        }
    }

    // 2. Heuristic resolution based on stripped serial (rule: stripping 'S' reveals true model)
    if (!model) {
        const sUpper = stripped.toUpperCase();
        if (sUpper.startsWith('3C') || sUpper.startsWith('3H') || sUpper.startsWith('3D')) {
            manufacturer = manufacturer || 'PAX';
            model = 'S90';
        } else if (sUpper.startsWith('233') || sUpper.startsWith('D230')) {
            manufacturer = manufacturer || 'PAX';
            model = 'D230';
        } else if (sUpper.startsWith('160') || sUpper.startsWith('Q80')) {
            manufacturer = manufacturer || 'PAX';
            model = 'Q80';
        } else if (sUpper.startsWith('520') || sUpper.startsWith('VX')) {
            manufacturer = manufacturer || 'Verifone';
            model = 'VX520';
        } else {
            manufacturer = manufacturer || 'PAX';
            model = 'S90';
        }
    }

    if (!manufacturer) {
        if (model.includes('S90') || model.includes('D230') || model.includes('Q80')) manufacturer = 'PAX';
        else if (model.includes('VX')) manufacturer = 'Verifone';
        else manufacturer = 'PAX';
    }

    return {
        serial: cleanRaw,
        stripped_serial: stripped,
        model: model,
        manufacturer: manufacturer,
        is_branch_backup: isBranchBackup,
        badge_tag: isBranchBackup ? 'ماكينة احتياطية من الفرع (S)' : null
    };
}

// 2. Customer 360 Full Profile
app.get('/api/customers/profile/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const cleanCode = code.trim().replace(/^M-/i, '');
        const altCode = 'M-' + cleanCode;

        // 1. Fetch Master Info from assets_raw
        const asset = await getQuery(`
            SELECT a.*,
                   COALESCE(a.bkcode, a.POSID) as clean_code,
                   COALESCE(a.Owner, a.Contact_person, 'مخبز') as clean_name,
                   COALESCE(a.dep, a.SupplyOffice, '-') as clean_gov
            FROM assets_raw a
            WHERE a.bkcode = ? OR a.POSID = ? OR a.bkcode = ? OR a.POSID = ?
               OR a.bkcode = ? OR a.POS = ? OR a.POS_2 = ?
            LIMIT 1
        `, [code, code, cleanCode, cleanCode, altCode, code, code]);

        if (!asset) {
            return res.status(404).json({ success: false, error: "لم يتم العثور على العميل" });
        }

        const merchantCode = asset.clean_code || code;

        // 2. Resolve all POS devices linked to this customer
        const posSet = new Map();
        if (asset.POS && asset.POS !== '-') {
            const spec = resolveDeviceSpecs(asset.POS, asset);
            posSet.set(asset.POS, {
                serial: asset.POS,
                slot: 'الماكينة الرئيسية (POS 1)',
                model: spec.model,
                manufacturer: spec.manufacturer,
                is_branch_backup: spec.is_branch_backup,
                badge_tag: spec.badge_tag,
                condition: asset.Condition || 'سليمة',
                acquired_date: asset['Acquired Date'] || '-',
                pinpad: asset.PinpadSerial || '-'
            });
        }
        if (asset.POS_2 && asset.POS_2 !== '-') {
            const spec = resolveDeviceSpecs(asset.POS_2, asset);
            posSet.set(asset.POS_2, {
                serial: asset.POS_2,
                slot: 'الماكينة الإضافية (POS 2)',
                model: spec.model,
                manufacturer: spec.manufacturer,
                is_branch_backup: spec.is_branch_backup,
                badge_tag: spec.badge_tag,
                condition: 'سليمة',
                acquired_date: '-',
                pinpad: asset.Pinpad_2 || '-'
            });
        }
        if (asset.pos_3 && asset.pos_3 !== '-') {
            const spec = resolveDeviceSpecs(asset.pos_3, asset);
            posSet.set(asset.pos_3, {
                serial: asset.pos_3,
                slot: 'الماكينة الثالثة (POS 3)',
                model: spec.model,
                manufacturer: spec.manufacturer,
                is_branch_backup: spec.is_branch_backup,
                badge_tag: spec.badge_tag,
                condition: 'سليمة',
                acquired_date: '-',
                pinpad: '-'
            });
        }

        // Check if any other devices appear in transactions_raw for this merchant
        const histDevices = await allQuery(`
            SELECT DISTINCT t.POSN
            FROM transactions_raw t
            WHERE (t.GrocerName = ? OR t.GrocerName = ?) AND t.POSN IS NOT NULL AND t.POSN != '' AND t.POSN != '-'
        `, [merchantCode, cleanCode]);

        histDevices.forEach(h => {
            if (!posSet.has(h.POSN)) {
                const spec = resolveDeviceSpecs(h.POSN, asset);
                posSet.set(h.POSN, {
                    serial: h.POSN,
                    slot: 'ماكينة تاريخية مسجلة بالبلاغات',
                    model: spec.model,
                    manufacturer: spec.manufacturer,
                    is_branch_backup: spec.is_branch_backup,
                    badge_tag: spec.badge_tag,
                    condition: 'تاريخية',
                    acquired_date: '-',
                    pinpad: '-'
                });
            }
        });

        // 3. Resolve all SIM cards
        // 3. Resolve all SIM cards (All possible SIMs linked to customer)
        const simMap = new Map();
        
        function addSim(ser, slot, carrier, phone) {
            if (!ser || ser === '-' || ser === 'null' || ser === 'undefined') return;
            const cleanSer = String(ser).trim();
            if (!cleanSer || cleanSer.length < 5) return;
            if (!simMap.has(cleanSer)) {
                simMap.set(cleanSer, {
                    serial: cleanSer,
                    slot: slot || `شريحة #${simMap.size + 1}`,
                    carrier: carrier || 'غير محدد',
                    phone: phone && phone !== '-' && phone !== 'null' ? phone : '-'
                });
            }
        }

        if (asset.Cell_Serial) addSim(asset.Cell_Serial, 'الشريحة الرئيسية (SIM 1)', asset.Cell_type, asset.telephone_1);
        if (asset['cell_2-ser']) addSim(asset['cell_2-ser'], 'الشريحة الثانية (SIM 2)', asset['Cell_type-2'], asset.telephone_2);
        if (asset.Cell_Serial3) addSim(asset.Cell_Serial3, 'الشريحة الثالثة (SIM 3)', asset.Cell_type3, asset.telephone_3);
        if (asset.Cell_Serial4) addSim(asset.Cell_Serial4, 'الشريحة الرابعة (SIM 4)', asset.Cell_type4, null);
        if (asset.Cell_Serial5) addSim(asset.Cell_Serial5, 'الشريحة الخامسة (SIM 5)', asset.Cell_type5, null);

        // Also look up any additional SIMs from sim_cards and merchant_assets or store_sim_raw
        try {
            const extraSims = await allQuery(`
                SELECT s.serial, s.carrier, s.status, m.merchant_code
                FROM sim_cards s
                LEFT JOIN merchant_assets ma ON ma.sim_card_id = s.id
                LEFT JOIN merchants m ON m.merchant_code = ma.merchant_code
                WHERE m.merchant_code = ? OR m.merchant_code = ?
            `, [merchantCode, cleanCode]);

            extraSims.forEach((es, idx) => {
                addSim(es.serial, `شريحة مربوطة (#${simMap.size + 1})`, es.carrier, null);
            });
        } catch (e) {}

        const simCards = Array.from(simMap.values());

        // 4. Installments info
        const allPosSerials = Array.from(posSet.keys());
        let installments = [];
        let totalInstallmentDebt = 0;
        let totalInstallmentPaid = 0;

        if (allPosSerials.length > 0) {
            const posPlaceholders = allPosSerials.map(() => '?').join(',');
            installments = await allQuery(`
                SELECT i.*
                FROM installments_raw i
                WHERE i.pos IN (${posPlaceholders})
            `, allPosSerials);

            installments.forEach(inst => {
                const total = parseFloat(inst.finalunitprice || inst.unitprice || 0);
                const monthly = parseFloat(inst.monthlyinstallmentprice || 0);
                const count = parseInt(inst.installments || 0, 10);
                totalInstallmentDebt += total;
            });
        }

        // 5. Quick counts (Tickets, Spare Parts, HQ cycles)
        const codesList = [merchantCode, cleanCode, altCode, ...allPosSerials];
        const ph = codesList.map(() => '?').join(',');

        const ticketsCountRes = await getQuery(`
            SELECT COUNT(*) as count
            FROM transactions_raw t
            WHERE t.GrocerName IN (${ph}) OR t.POSN IN (${ph})
        `, [...codesList, ...codesList]);

        const spCountRes = await getQuery(`
            SELECT COUNT(*) as count
            FROM store_sp_raw s
            WHERE s.Serial IN (${ph}) OR s.notes LIKE ?
        `, [...codesList, `%${cleanCode}%`]);

        const hqCountRes = await getQuery(`
            SELECT COUNT(*) as count
            FROM maintenance_raw m
            WHERE m.FormNo IS NOT NULL AND m.[Unit Serial] IN (${ph})
        `, codesList);

        res.json({
            success: true,
            customer: {
                merchant_code: merchantCode,
                name: asset.clean_name,
                government: asset.clean_gov,
                national_id: asset.NationalD || '-',
                phone_1: asset.telephone_1 || '-',
                phone_2: asset.telephone_2 || '-',
                address: asset.Address || '-',
                city: asset.City || '-',
                contact_person: asset.Contact_person || '-'
            },
            devices: Array.from(posSet.values()),
            sim_cards: simCards,
            installments: {
                contracts: installments,
                total_debt: totalInstallmentDebt,
                count: installments.length
            },
            stats: {
                total_tickets: ticketsCountRes?.count || 0,
                total_spare_parts: spCountRes?.count || 0,
                total_hq_cycles: hqCountRes?.count || 0,
                total_devices: posSet.size,
                total_sims: simCards.length
            }
        });

    } catch (err) {
        console.error("Customer profile error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =========================================================================
// UNIFIED MAINTENANCE & SPARE PARTS RESOLUTION ENGINE
// =========================================================================
function normalizePartText(str) {
    return String(str || '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/تغير|تغيير|استبدال|تركيب|صيانة|اصلاح/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseDateScore(dStr) {
    if (!dStr) return 0;
    const clean = String(dStr).trim();
    const m = clean.match(/(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{2,4})/);
    if (!m) return 0;
    const day = parseInt(m[1], 10);
    const yearStr = m[3].length === 2 ? '20' + m[3] : m[3];
    const year = parseInt(yearStr, 10);
    const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
    let month = 1;
    if (isNaN(m[2])) {
        month = months[m[2].toLowerCase()] || 1;
    } else {
        month = parseInt(m[2], 10);
    }
    return new Date(year, month - 1, day).getTime();
}

function resolveMaintenanceServiceDetails(t, allSp = [], allPayments = [], priceMap = new Map()) {
    const noteD = String(t.NoteD || t.action_taken || '').trim();
    const noteG = String(t.NoteG || t.complaint || '').trim();
    const actionType = String(t.ActionType || t.action_type || '').trim();

    const isInitial = actionType.includes('صيانة أولية') || (/تنظيف|سوفت|تحديث|إصدار غير صحيح|اعادة تنزيل|Reset|ضبط|فحص/i.test(noteG + ' ' + noteD) && !/تغير|تغيير|استبدال|تركيب/.test(noteD));
    const isPartReplacement = /(?:تغير|تغيير|استبدال|تركيب)\s+([^\s,]+(?:\s+[^\s,]+)?)/i.test(noteD) && !/تنظيف|سوفت|تحديث|فحص|برمجة/.test(noteD);

    let category = 'LABOR_ONLY';
    let categoryLabel = 'صيانة بالفرع (بدون قطع غيار)';
    if (isInitial) {
        category = 'INITIAL_MAINTENANCE';
        categoryLabel = 'صيانة أولية (فحص وتنظيف مجاني)';
    } else if (isPartReplacement) {
        category = 'PART_REPLACEMENT';
        categoryLabel = 'صيانة مع استبدال قطعة غيار';
    }

    let sparePartInfo = null;

    if (isPartReplacement && allSp && allSp.length > 0) {
        const normNote = normalizePartText(noteD);
        const noteKeywords = normNote.split(' ').map(w => w.replace(/^ال/, '')).filter(w => w.length >= 3);
        const tDateScore = parseDateScore(t.IssueDate || t.ActionDate || t.entry_datetime || t.date);

        const posSerial = t.POSN || t.pos_serial || t.pos || '';
        const grocerCode = t.GrocerName || t.merchant_code || '';

        // Find candidate matching spare parts
        const candidates = allSp.filter(sp => {
            const s = String(sp.Serial || sp.serial_raw || '');
            const n = String(sp.notes || '');
            const posMatch = posSerial && (n.includes(posSerial) || s.includes(posSerial));
            const grocerMatch = grocerCode && (s.includes(grocerCode) || n.includes(grocerCode));

            const normType = normalizePartText(sp.type || sp.part_name);
            const typeKeywords = normType.split(' ').map(w => w.replace(/^ال/, '')).filter(w => w.length >= 3);

            const typeMatch = noteKeywords.some(kw => normType.includes(kw)) || typeKeywords.some(kw => normNote.includes(kw));
            return (posMatch && typeMatch) || (grocerMatch && typeMatch);
        });

        let matchedSp = null;
        let allMatchedSpInfo = [];
        
        if (candidates.length > 0) {
            candidates.sort((a, b) => {
                const diffA = Math.abs(parseDateScore(a.out_date || a.date) - tDateScore);
                const diffB = Math.abs(parseDateScore(b.out_date || b.date) - tDateScore);
                return diffA - diffB;
            });
            
            // Collect all candidates that are very close in time (same day)
            const closestTime = Math.abs(parseDateScore(candidates[0].out_date || candidates[0].date) - tDateScore);
            const validCandidates = candidates.filter(c => {
                 const diff = Math.abs(parseDateScore(c.out_date || c.date) - tDateScore);
                 return Math.abs(diff - closestTime) < 86400000;
            });

            validCandidates.forEach(cand => {
                let matchedPayment = null;
                if (allPayments && allPayments.length > 0) {
                    const spStr = String(cand.Serial || cand.serial_raw);
                    matchedPayment = allPayments.find(p => p.ref_num && spStr.includes(p.ref_num));
                    if (!matchedPayment && posSerial) {
                        const payCandidates = allPayments.filter(p => String(p.pos_number || '').includes(posSerial));
                        if (payCandidates.length > 0) {
                            payCandidates.sort((a, b) => Math.abs(parseDateScore(a.payment_date) - tDateScore) - Math.abs(parseDateScore(b.payment_date) - tDateScore));
                            if (Math.abs(parseDateScore(payCandidates[0].payment_date) - tDateScore) < 7 * 86400000) {
                                matchedPayment = payCandidates[0];
                            }
                        }
                    }
                }

                const partName = cand.type || cand.part_name || noteD.replace(/تغير|تغيير|استبدال|تركيب/g, '').trim();
                const serialRaw = String(cand.Serial || cand.serial_raw || '');
                const rMatch = serialRaw.match(/(\d{10,20})/);
                const receiptNum = rMatch ? rMatch[1] : (matchedPayment?.ref_num || null);

                let payStatus = 'FREE';
                let payStatusLabel = 'صرف مجاني (بدون مقابل)';
                let amount = 0;
                let channel = '-';

                if (serialRaw.includes('مجاني') || serialRaw.includes('بدون مقابل')) {
                    payStatus = 'FREE';
                    payStatusLabel = 'صرف مجاني (بدون مقابل)';
                    amount = 0;
                    channel = 'فرع الشركة';
                } else if (receiptNum) {
                    payStatus = 'PAID';
                    amount = matchedPayment ? parseFloat(matchedPayment.payment_amount) : (priceMap.get(partName.toLowerCase()) || 0);
                    channel = matchedPayment?.payment_place || 'ضامن';
                    payStatusLabel = `مسدد بمقابل (إيصال إيداع #${receiptNum}${channel && channel !== '-' ? ` - جهة الدفع: ${channel}` : ''})`;
                } else if (matchedPayment && matchedPayment.ref_num) {
                    payStatus = 'PAID';
                    amount = parseFloat(matchedPayment.payment_amount);
                    channel = matchedPayment.payment_place || 'ضامن';
                    payStatusLabel = `مسدد بمقابل (إيصال إيداع #${matchedPayment.ref_num}${channel && channel !== '-' ? ` - جهة الدفع: ${channel}` : ''})`;
                } else if (serialRaw.includes('مؤجل')) {
                    payStatus = 'DEFERRED';
                    payStatusLabel = 'تحصيل مؤجل ⚠️';
                    amount = priceMap.get(partName.toLowerCase()) || 0;
                }

                allMatchedSpInfo.push({
                    is_replaced: true,
                    part_name: partName,
                    payment_status: payStatus,
                    payment_status_label: payStatusLabel,
                    receipt_number: receiptNum,
                    amount: amount,
                    payment_channel: channel
                });
            });
            
            sparePartInfo = allMatchedSpInfo.length > 0 ? { ...allMatchedSpInfo[0] } : null;
            if (sparePartInfo) sparePartInfo.all_spare_parts = allMatchedSpInfo;
        }
    }

    return {
        ticket_id: t.ID || t.ticket_id,
        service_category: category,
        service_category_label: categoryLabel,
        is_initial_maintenance: isInitial,
        has_spare_part: !!sparePartInfo,
        spare_part: sparePartInfo,
        labor_fee: 0,
        labor_fee_label: 'خدمة صيانة مجانية بالفرع'
    };
}

// 3. Device Deep-Dive 360 (4 Tabs: Replacements from temp_transfer, Maintenance In/Out, Spare Parts, HQ Central Cycles)
app.get('/api/customers/device-deepdive/:serial', async (req, res) => {
    try {
        const { serial } = req.params;
        const s = serial.trim();
        if (!s) return res.status(400).json({ success: false, error: "Serial is required" });

        // 1. Basic Device Info from assets_raw / devices / maintenance_raw / temp_transfer_raw
        const rawAsset = await getQuery(`
            SELECT a.*,
                   COALESCE(a.bkcode, a.POSID) as clean_code,
                   COALESCE(a.Owner, a.Contact_person) as clean_owner,
                   COALESCE(a.dep, a.SupplyOffice) as clean_gov
            FROM assets_raw a
            WHERE a.POS = ? OR a.POS_2 = ? OR a.pos_3 = ? OR a.POS LIKE ? OR a.POS_2 LIKE ? OR a.pos_3 LIKE ?
            LIMIT 1
        `, [s, s, s, `%${s}%`, `%${s}%`, `%${s}%`]);

        let detectedModel = '';
        let detectedManuf = '';

        if (rawAsset) {
            const cleanS = s.toUpperCase().replace(/^S/i, '').replace(/^M-/i, '');
            const pos1 = String(rawAsset.POS || '').toUpperCase();
            const pos2 = String(rawAsset.POS_2 || '').toUpperCase();
            const pos3 = String(rawAsset.pos_3 || '').toUpperCase();

            if (pos2.includes(cleanS)) {
                detectedModel = rawAsset.Model2 || 'S90';
                detectedManuf = rawAsset.Manufacturer2 || 'PAX';
            } else if (pos3.includes(cleanS)) {
                detectedModel = rawAsset.Model3 || 'S90';
                detectedManuf = rawAsset.Manufacturer3 || 'PAX';
            } else if (pos1.includes(cleanS)) {
                detectedModel = rawAsset.Model || 'S90';
                detectedManuf = rawAsset.Manufacturer || 'PAX';
            }
        }

        // If not found in assets, lookup temp_transfer_raw
        if (!detectedModel) {
            const transferModel = await getQuery(`
                SELECT t.*
                FROM temp_transfer_raw t
                WHERE (t.NewPOS = ? OR t.OldPOS = ? OR t.NewPOS LIKE ? OR t.OldPOS LIKE ?)
                LIMIT 1
            `, [s, s, `%${s}%`, `%${s}%`]).catch(() => null);

            if (transferModel) {
                const rawModelType = transferModel.NewType || transferModel.new_type || transferModel.OldType || transferModel.old_type;
                if (rawModelType) {
                    const parts = String(rawModelType).split('-');
                    if (parts.length >= 2) {
                        detectedManuf = parts[0].trim();
                        detectedModel = parts.slice(1).join('-').trim();
                    } else {
                        detectedModel = String(rawModelType).trim();
                    }
                }
            }
        }

        // If not found, lookup maintenance_raw
        if (!detectedModel) {
            const maintModel = await getQuery(`
                SELECT Model, Manufactor
                FROM maintenance_raw
                WHERE [Unit Serial] = ? OR [Unit Serial] LIKE ?
                LIMIT 1
            `, [s, `%${s}%`]).catch(() => null);

            if (maintModel && maintModel.Model) {
                detectedModel = maintModel.Model;
                detectedManuf = maintModel.Manufactor || '';
            }
        }

        // Accurate heuristic fallback based on serial prefixes in Egypt
        if (!detectedModel) {
            const cleanS = s.toUpperCase().replace(/^S/i, '').replace(/^M-/i, '');
            if (cleanS.startsWith('3C') || cleanS.startsWith('3H') || cleanS.startsWith('3D')) {
                detectedManuf = 'PAX';
                detectedModel = 'S90';
            } else if (cleanS.startsWith('233') || cleanS.startsWith('D230')) {
                detectedManuf = 'PAX';
                detectedModel = 'D230';
            } else if (cleanS.startsWith('160') || cleanS.startsWith('Q80')) {
                detectedManuf = 'PAX';
                detectedModel = 'Q80';
            } else if (cleanS.startsWith('520') || cleanS.startsWith('VX')) {
                detectedManuf = 'Verifone';
                detectedModel = 'VX520';
            } else {
                detectedManuf = 'PAX';
                detectedModel = 'S90';
            }
        }
        if (!detectedManuf) {
            if (detectedModel.includes('S90') || detectedModel.includes('D230') || detectedModel.includes('Q80')) detectedManuf = 'PAX';
            else if (detectedModel.includes('VX')) detectedManuf = 'Verifone';
            else detectedManuf = 'PAX';
        }

        const deviceInfo = {
            serial: s,
            model: detectedModel,
            manufacturer: detectedManuf,
            current_owner: rawAsset?.clean_owner || 'غير محدد',
            merchant_code: rawAsset?.clean_code || '-',
            government: rawAsset?.clean_gov || '-',
            acquired_date: rawAsset?.['Acquired Date'] || '-',
            condition: rawAsset?.Condition || 'سليمة'
        };

        // 2. TAB 1: Replacements & Swaps History strictly from temp_transfer_raw (and temp_transfer)
        const transferRows = await allQuery(`
            SELECT t.rowid as id, t.*
            FROM temp_transfer_raw t
            WHERE t.OldPOS = ? OR t.NewPOS = ? OR t.OldPOS LIKE ? OR t.NewPOS LIKE ?
            ORDER BY t.rowid DESC
        `, [s, s, `%${s}%`, `%${s}%`]).catch(() => []);

        const replacements = transferRows.map(r => {
            const oldSerial = r.OldPOS || r.old_serial || '-';
            const newSerial = r.NewPOS || r.new_serial || '-';
            let role = 'استبدال ماكينة';
            if (String(oldSerial).toUpperCase() === s.toUpperCase()) {
                role = 'ماكينة قديمة مستبدلة (تم سحبها)';
            } else if (String(newSerial).toUpperCase() === s.toUpperCase()) {
                role = 'ماكينة بديلة منصرفة (تم تسليمها)';
            }

            return {
                id: r.id || r.rowid,
                date: r.Transfer_Date || r.transfer_date || '-',
                merchant_code: r.bkCode || r.bkcode || r.POSCode || '-',
                merchant_name: r.bkCode || r.bkcode || r.POSCode || '-',
                old_serial: oldSerial,
                new_serial: newSerial,
                old_type: r.OldType || r.old_type || '-',
                new_type: r.NewType || r.new_type || '-',
                role: role,
                technician: r.procedure || r.procedure_maker || 'فني الصيانة',
                notes: r.Notes || r.notes || '-'
            };
        });

        // 3. TAB 2: Branch Maintenance Tickets (with Entry Date/Time & Exit Date/Time)
        const maintenanceTickets = await allQuery(`
            SELECT t.ID as ticket_id,
                   t.IssueDate as entry_datetime,
                   t.ActionDate as exit_datetime,
                   t.Procedure as technician_raw,
                   t.NoteG as complaint,
                   t.NoteD as action_taken,
                   t.Fees as fees_type,
                   t.Paid as is_paid,
                   t.FeesAmount as fees_amount,
                   t.ActionType as action_type,
                   t.GrocerName as merchant_code
            FROM transactions_raw t
            WHERE t.POSN = ?
            ORDER BY t.ID DESC
        `, [s]);

        // Query official price catalog from failure_points_raw
        const priceCatalogRows = await allQuery(`SELECT type, price FROM failure_points_raw WHERE price IS NOT NULL AND price != ''`).catch(() => []);
        const priceMap = new Map();
        priceCatalogRows.forEach(p => {
            if (p.type) priceMap.set(p.type.trim().toLowerCase(), parseFloat(p.price) || 0);
        });

        const deviceSpList = await allQuery(`
            SELECT s.rowid as id, s.Serial as serial_raw, s.out_date, s.type, s.count_in, s.notes
            FROM store_sp_raw s
            WHERE s.count_in LIKE '-%' OR CAST(s.count_in AS INTEGER) < 0
        `).catch(() => []);

        const devicePayments = await allQuery(`
            SELECT p.ID, p.payment_date, p.payment_amount, p.payment_reason, p.ref_num, p.pos_number, p.policy, p.payer, p.payment_place
            FROM payments_raw p
        `).catch(() => []);

        const formattedTickets = maintenanceTickets.map(t => {
            let tech = t.technician_raw || '';
            if (tech.toUpperCase() === 'AHMEDMAHDY') tech = 'أحمد المهدي محفوظ المهدي';
            else if (tech.toUpperCase() === 'ELFAKHARANY') tech = 'أحمد فؤاد سيد الفخراني';
            else if (tech.toUpperCase() === 'MESSAM') tech = 'محمد عصام محمود فرغلي';
            else if (tech.toUpperCase() === 'MOSTAFA') tech = 'مصطفى محمد أبو العطا';
            else if (!tech || tech.startsWith('DESKTOP') || tech === 'SHARE' || tech === '35') tech = 'فني الصيانة بالفرع';

            const resolved = resolveMaintenanceServiceDetails(t, deviceSpList, devicePayments, priceMap);

            return {
                ticket_id: t.ticket_id,
                entry_datetime: t.entry_datetime || '-',
                exit_datetime: t.exit_datetime || '-',
                technician: tech,
                complaint: t.complaint || 'صيانة دورية / فحص',
                action_taken: t.action_taken || 'تم الإصلاح والفحص',
                action_type: t.action_type || 'صيانة',
                service_category: resolved.service_category,
                service_category_label: resolved.service_category_label,
                is_initial_maintenance: resolved.is_initial_maintenance,
                has_spare_part: resolved.has_spare_part,
                spare_part: resolved.spare_part,
                labor_fee: resolved.labor_fee,
                labor_fee_label: resolved.labor_fee_label,
                fees_type: resolved.has_spare_part ? resolved.spare_part.payment_status_label : (resolved.is_initial_maintenance ? 'صيانة أولية مجانية' : 'صيانة فرع مجانية'),
                fees_amount: resolved.spare_part?.amount || 0,
                is_paid: resolved.spare_part?.payment_status === 'PAID' ? 'نعم' : (resolved.spare_part?.payment_status === 'DEFERRED' ? 'مؤجل' : 'مجاني')
            };
        });

        // 4. TAB 3: Spare Parts Consumed for this machine
        const strippedS = s.replace(/^S/i, '').replace(/^M-/i, '');
        const spareParts = await allQuery(`
            SELECT s.rowid as id,
                   s.Serial as serial_raw,
                   s.out_date as date,
                   s.type as part_name,
                   s.count_in,
                   s.count_out,
                   s.faulty as price_raw,
                   s.faulty_detils as payment_status_raw,
                   s.notes
            FROM store_sp_raw s
            WHERE s.Serial LIKE ? OR s.notes LIKE ? OR s.Serial LIKE ? OR s.notes LIKE ?
            ORDER BY s.rowid DESC
        `, [`%${s}%`, `%${s}%`, `%${strippedS}%`, `%${strippedS}%`]);

        const formattedParts = spareParts.map(sp => {
            const serialRaw = String(sp.serial_raw || '');
            const notesStr = String(sp.notes || '');
            const combinedText = `${serialRaw} ${notesStr} ${String(sp.payment_status_raw || '')}`;

            // Check if free (ضمان / فرع / مجاني)
            let isFree = /مجاني|ضمان|مخزن الفرع|ماكينة مخزن|بدون مقابل/i.test(combinedText);
            let isDeferred = /مؤجل|اجل|تحصيل مؤجل/i.test(combinedText);

            // Extract Receipt Number from serialRaw (e.g. '40180096190525 - قارئ بطاقات ...')
            let receiptNo = '-';
            const numMatch = serialRaw.match(/^([0-9]{6,20})/);
            if (numMatch) {
                receiptNo = numMatch[1];
            } else {
                const rMatch = combinedText.match(/(?:إيصال|ايصال|وصل|رقم|ref|receipt)\s*[:#\-]?\s*([0-9]{6,20})/i);
                if (rMatch) receiptNo = rMatch[1];
            }

            if (receiptNo === '-' && isFree) {
                receiptNo = 'صرف مجاني (بدون مقابل)';
            }

            // Get Official Catalog Price from failure_points_raw
            const partNameTrim = String(sp.part_name || '').trim().toLowerCase();
            let catalogPrice = priceMap.get(partNameTrim) || 0;
            if (catalogPrice === 0) {
                for (const [k, v] of priceMap.entries()) {
                    if (partNameTrim.includes(k) || k.includes(partNameTrim)) {
                        catalogPrice = v;
                        break;
                    }
                }
            }

            // Paid amount
            let paidAmount = 0;
            if (isFree) {
                paidAmount = 0;
            } else {
                let fPrice = parseFloat(sp.price_raw);
                paidAmount = (!isNaN(fPrice) && fPrice > 0) ? fPrice : catalogPrice;
            }

            let paymentChannel = '';
            if (!isFree && receiptNo !== '-' && receiptNo !== 'صرف مجاني (بدون مقابل)' && devicePayments) {
                const matchP = devicePayments.find(p => p.ref_num && receiptNo.includes(p.ref_num));
                if (matchP && matchP.payment_place) paymentChannel = matchP.payment_place;
            }

            let paymentLabel = isFree ? 'صرف مجاني (بدون مقابل)' : (isDeferred ? 'تحصيل مؤجل ⚠️' : (receiptNo !== '-' ? `مسدد بمقابل (إيصال إيداع #${receiptNo}${paymentChannel ? ` - جهة الدفع: ${paymentChannel}` : ''}) ✅` : 'مسدد بمقابل ✅'));

            return {
                id: sp.id,
                date: sp.date || '-',
                part_name: sp.part_name || 'قطعة غيار',
                quantity: Math.abs(parseInt(sp.count_in || sp.count_out || 1, 10)),
                official_price: catalogPrice,
                paid_amount: paidAmount,
                unit_price: catalogPrice,
                total_amount: paidAmount,
                payment_status_label: paymentLabel,
                is_free: isFree,
                receipt_number: receiptNo,
                payment_channel: paymentChannel || (isFree ? 'فرع الشركة' : 'ضامن'),
                notes: sp.notes || serialRaw || '-'
            };
        });

        // 5. TAB 4: HQ Central Maintenance Cycles
        const hqCycles = await allQuery(`
            SELECT m.ID,
                   m.FormNo as form_no,
                   m.[Checked Out Date] as sent_date,
                   m.[Checked In Date] as return_date,
                   m.[Checked Out Condition] as sent_condition,
                   m.[Checked In Condition] as return_condition,
                   m.Notes as notes,
                   m.spstatus as hq_parts_note,
                   m.Procedure as technician,
                   m.Model as model,
                   m.Manufactor as manufacturer
            FROM maintenance_raw m
            WHERE m.[Unit Serial] = ? OR m.[Unit Serial] LIKE ?
            ORDER BY m.ID DESC
        `, [s, `%${s}%`]);

        // Join HQ Spare Parts from store_sp_maintenance_raw for each cycle
        for (const cycle of hqCycles) {
            if (cycle.form_no) {
                const parts = await allQuery(`
                    SELECT sm.*
                    FROM store_sp_maintenance_raw sm
                    WHERE sm.FormNo = ? OR sm.Serial = ?
                `, [cycle.form_no, s]);
                cycle.hq_parts_replaced = parts.map(p => ({
                    part_name: p.type || p.PartName || 'بوردة / قطعة رئيسية',
                    quantity: p.count_in || 1,
                    notes: p.notes || '-'
                }));
            } else {
                cycle.hq_parts_replaced = [];
            }
        }

        res.json({
            success: true,
            device_info: deviceInfo,
            replacements: replacements,
            maintenance: formattedTickets,
            spare_parts: formattedParts,
            hq_cycles: hqCycles
        });

    } catch (err) {
        console.error("Device deepdive error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =========================================================================
// POINT-IN-TIME INVENTORY TIME MACHINE API (آلة الزمن المخزنية)
// =========================================================================
app.get('/api/inventory/time-machine', async (req, res) => {
    try {
        const reqDateStr = req.query.date || req.query.as_of;
        let targetDate;
        if (reqDateStr) {
            targetDate = new Date(reqDateStr);
            if (isNaN(targetDate.getTime())) {
                targetDate = new Date();
            } else {
                targetDate.setHours(23, 59, 59, 999);
            }
        } else {
            targetDate = new Date();
        }

        const dateIso = targetDate.toISOString().slice(0, 10);

        function parseDateHelper(dateStr) {
            if (!dateStr || dateStr === '-' || dateStr === 'null') return null;
            const clean = String(dateStr).trim();
            const match = clean.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
            if (match) {
                const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
                const m = months[match[2].toLowerCase()];
                if (m !== undefined) {
                    let yr = parseInt(match[3], 10);
                    if (yr < 100) yr += (yr >= 70 ? 1900 : 2000);
                    const day = parseInt(match[1], 10);
                    return new Date(Date.UTC(yr, m, day, 12, 0, 0));
                }
            }
            const d = new Date(clean);
            return isNaN(d.getTime()) ? null : d;
        }

        // 1. Spare Parts Point-in-Time Inventory
        const priceCatalogRows = await allQuery(`SELECT type, price FROM failure_points_raw WHERE price IS NOT NULL AND price != ''`);
        const priceMap = new Map();
        priceCatalogRows.forEach(p => {
            if (p.type) priceMap.set(p.type.trim().toLowerCase(), parseFloat(p.price) || 0);
        });

        const spRows = await allQuery(`SELECT * FROM store_sp_raw`);
        const partsMap = new Map();
        let totalSpUnits = 0;
        let totalSpValuation = 0;

        spRows.forEach(r => {
            const inD = parseDateHelper(r.in_date);
            const outD = parseDateHelper(r.out_date);
            const partType = (r.type || 'أخرى').trim();

            if (!partsMap.has(partType)) {
                let unitP = priceMap.get(partType.toLowerCase()) || 0;
                if (unitP === 0) {
                    for (const [k, v] of priceMap.entries()) {
                        if (partType.toLowerCase().includes(k) || k.includes(partType.toLowerCase())) {
                            unitP = v;
                            break;
                        }
                    }
                }
                partsMap.set(partType, {
                    type: partType,
                    unit_price: unitP,
                    cumulative_in: 0,
                    cumulative_out: 0,
                    current_balance: 0,
                    total_value: 0
                });
            }

            const item = partsMap.get(partType);
            const inQty = Math.abs(parseInt(r.count_in, 10) || 0);
            const outQty = Math.abs(parseInt(r.count_out || r.count_in, 10) || 0);

            if (inD && inD <= targetDate) {
                item.cumulative_in += inQty;
            }
            if (outD && outD <= targetDate) {
                item.cumulative_out += outQty;
            }
            item.current_balance = item.cumulative_in - item.cumulative_out;
            item.total_value = item.current_balance * item.unit_price;
        });

        const sparePartsList = Array.from(partsMap.values()).map(p => {
            if (p.current_balance > 0) {
                totalSpUnits += p.current_balance;
                totalSpValuation += (p.current_balance * p.unit_price);
            }
            return p;
        }).sort((a, b) => b.current_balance - a.current_balance);

        // 2. POS Machines Point-in-Time Inventory
        const storePosRows = await allQuery(`SELECT * FROM store_pos_raw`);
        const posModelCounts = {};
        let totalPosCount = 0;
        let branchBackupCount = 0;
        const posList = [];

        for (const row of storePosRows) {
            const serial = (row.Serial || '').trim();
            if (!serial) continue;
            const specs = resolveDeviceSpecs(serial, row);
            const modelName = specs.model || 'S90';
            const fullModel = `${specs.manufacturer} ${modelName}`;
            posModelCounts[fullModel] = (posModelCounts[fullModel] || 0) + 1;
            totalPosCount++;
            if (specs.is_branch_backup) branchBackupCount++;

            posList.push({
                serial: serial,
                manufacturer: specs.manufacturer,
                model: modelName,
                full_model: fullModel,
                is_branch_backup: specs.is_branch_backup,
                status: row.faulty === 'True' ? 'تالفة / صيانة' : 'سليمة وجاهزة',
                notes: row.notes || row.status_note || '-'
            });
        }

        // 3. SIMs Point-in-Time Inventory
        const storeSimRows = await allQuery(`SELECT * FROM store_sim_raw`);
        const simCarrierCounts = { Vodafone: 0, Orange: 0, WE: 0, Etisalat: 0, Other: 0 };
        let totalSimsCount = 0;

        storeSimRows.forEach(s => {
            const rawType = (s.sim_type || s.network || '').toLowerCase();
            let carrier = 'Other';
            if (rawType.includes('voda')) carrier = 'Vodafone';
            else if (rawType.includes('orange') || rawType.includes('اورانج') || rawType.includes('موبينيل')) carrier = 'Orange';
            else if (rawType.includes('we') || rawType.includes('وي') || rawType.includes('te')) carrier = 'WE';
            else if (rawType.includes('etisalat') || rawType.includes('اتصالات')) carrier = 'Etisalat';

            simCarrierCounts[carrier] = (simCarrierCounts[carrier] || 0) + 1;
            totalSimsCount++;
        });

        res.json({
            success: true,
            as_of_date: dateIso,
            as_of_formatted: targetDate.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }),
            summary: {
                total_pos: totalPosCount,
                total_pos_models: Object.keys(posModelCounts).length,
                branch_backup_pos: branchBackupCount,
                total_sims: totalSimsCount,
                total_sp_units: totalSpUnits,
                total_sp_valuation: totalSpValuation
            },
            pos_inventory: {
                total: totalPosCount,
                by_model: posModelCounts,
                items: posList
            },
            sims_inventory: {
                total: totalSimsCount,
                by_carrier: simCarrierCounts,
                items: storeSimRows.slice(0, 100).map(s => ({
                    serial: s.sim_serial,
                    carrier: s.sim_type || s.network || 'عام',
                    notes: s.notes || '-'
                }))
            },
            spare_parts_inventory: {
                total_units: totalSpUnits,
                total_valuation: totalSpValuation,
                items: sparePartsList
            }
        });
    } catch (err) {
        console.error('Error in /api/inventory/time-machine:', err);
        res.status(500).json({ success: false, error: err.message });
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

        // 0. Pre-fetch branch spare parts, payments, and price catalog to correlate with maintenance tickets
        let allSpForAsset = [];
        let allPaymentsForAsset = [];
        const priceCatalogRows = await allQuery(`SELECT type, price FROM failure_points_raw WHERE price IS NOT NULL AND price != ''`).catch(() => []);
        const priceMap = new Map();
        priceCatalogRows.forEach(p => {
            if (p.type) priceMap.set(p.type.trim().toLowerCase(), parseFloat(p.price) || 0);
        });

        if (allPossibleCodes.length > 0) {
            allSpForAsset = await allQuery(`
                SELECT s.rowid as id, s.type, s.count_in, s.Serial as serial_raw, s.notes, s.out_date
                FROM store_sp_raw s
                WHERE s.count_in LIKE '-%' OR CAST(s.count_in AS INTEGER) < 0
                ORDER BY s.rowid DESC
            `).catch(() => []);

            allPaymentsForAsset = await allQuery(`
                SELECT p.ID, p.payment_date, p.payment_amount, p.payment_reason, p.ref_num, p.pos_number, p.policy, p.payer, p.payment_place
                FROM payments_raw p
                ORDER BY p.ID DESC
            `).catch(() => []);
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

                const resolved = resolveMaintenanceServiceDetails(t, allSpForAsset, allPaymentsForAsset, priceMap);

                timelineEvents.push({
                    type: 'MAINTENANCE',
                    title: `بلاغ صيانة #${t.ID}: ${t.ActionType || 'إصلاح عطل'}`,
                    date: t.IssueDate || t.ActionDate || 'تاريخ غير محدد',
                    technician: tech,
                    merchant_code: evMerchantCode,
                    merchant_name: evMerchantName,
                    pos_serial: t.POSN || device?.serial || '',
                    merchant: evMerchantName ? `${evMerchantName} (${evMerchantCode})` : evMerchantCode,
                    complaint: noteG || 'عطل ماكينة',
                    resolution: noteD || 'تم الفحص والإصلاح',
                    service_category: resolved.service_category,
                    service_category_label: resolved.service_category_label,
                    is_initial_maintenance: resolved.is_initial_maintenance,
                    has_spare_part: resolved.has_spare_part,
                    spare_part: resolved.spare_part,
                    all_spare_parts: resolved.spare_part?.all_spare_parts || (resolved.spare_part ? [resolved.spare_part] : null),
                    replaced_part: resolved.spare_part?.all_spare_parts ? resolved.spare_part.all_spare_parts.map(p => p.part_name).join(' + ') : (resolved.spare_part?.part_name || null),
                    cost_status: resolved.spare_part ? resolved.spare_part.payment_status : 'FREE',
                    cost_badge: resolved.spare_part ? resolved.spare_part.payment_status_label : (resolved.is_initial_maintenance ? 'صيانة أولية (فحص وتنظيف مجاني)' : 'صيانة بالفرع (بدون قطع غيار)'),
                    receipt_number: resolved.spare_part?.receipt_number || null,
                    fees_amount: resolved.spare_part?.amount || 0,
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
            let transfers = [];
            try {
                const transferParams = [...allPossibleCodes, ...allPossibleCodes, ...allPossibleCodes];
                transfers = await allQuery(`
                    SELECT tt.*
                    FROM temp_transfer_raw tt
                    WHERE tt.bkCode IN (${placeholders}) OR tt.OldPOS IN (${placeholders}) OR tt.NewPOS IN (${placeholders})
                    ORDER BY tt.Transfer_Date DESC
                `, transferParams);
            } catch (e) {
                transfers = [];
            }

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
            let allTrade = [];
            try {
                allTrade = await allQuery(`SELECT * FROM trade_raw ORDER BY rowid DESC`);
            } catch (e) {
                allTrade = [];
            }

            allTrade.forEach(tr => {
                const s = String(tr['Item Serial'] || tr.item_serial || tr.Serial || '');
                const comments = String(tr.Comments || tr.notes || '');
                const isMatch = allPossibleCodes.some(c => c && (s.includes(c) || comments.includes(c)));
                if (isMatch) {
                    const tradeType = tr['Trade Type'] || tr.trade_type || '';
                    const direction = (String(tradeType).toLowerCase().includes('in')) ? 'وارد للمخزن' : 'صادر لجهة خارجية';
                    let tech = tr['IN/OUT BY'] || tr.operator || '';
                    if (tech.toUpperCase() === 'MESSAM') tech = 'محمد عصام محمود فرغلي';
                    else if (tech.toUpperCase() === 'ELFAKHARANY') tech = 'أحمد فؤاد سيد الفخراني';
                    else if (tech.toUpperCase() === 'AHMEDMAHDY') tech = 'أحمد المهدي محفوظ المهدي';

                    timelineEvents.push({
                        type: 'LOGISTICS',
                        title: `حركة لوجستيات (${direction}): ${tr['Trade Location'] || tr.trade_location || 'المركز الرئيسي'}`,
                        date: tr['In Date'] || tr.in_date || tr['Out Date'] || tr.out_date || 'تاريخ غير محدد',
                        technician: tech || 'لوجستيات ومخازن',
                        merchant_code: merchant?.merchant_code || '',
                        merchant_name: merchant?.name || '',
                        pos_serial: s || device?.serial || '',
                        merchant: tr['Trade Location'] || tr.trade_location || '',
                        detail: `النوع: ${tr['Item Type'] || tr.item_type || 'POS'} | السيريال: ${s} | الاستمارة: ${tr['Form Number'] || tr.form_number || '-'} | البيان: ${comments || '-'}`,
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

                    let statusLabel = 'صيانة مجانية';
                    let priceText = 'مجاني (بدون مقابل)';

                    if (isFree) {
                        statusLabel = 'مجاني (بدون مقابل)';
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

                    let displayDate = r.out_date || 'غير محدد';
                    if (r.out_date && assetTransactions && assetTransactions.length > 0) {
                        const outDateObj = new Date(parseDateHelper(r.out_date));
                        if (!isNaN(outDateObj)) {
                            let closestTxDate = null;
                            let minDiff = Infinity;
                            assetTransactions.forEach(tx => {
                                const txDateStr = tx.ActionDate || tx.IssueDate;
                                if (txDateStr) {
                                    const txDateObj = new Date(parseDateHelper(txDateStr));
                                    if (!isNaN(txDateObj)) {
                                        const diffDays = (outDateObj - txDateObj) / (1000 * 60 * 60 * 24);
                                        if (diffDays >= 0 && diffDays <= 7 && diffDays < minDiff) {
                                            minDiff = diffDays;
                                            closestTxDate = txDateStr;
                                        }
                                    }
                                }
                            });
                            if (closestTxDate) {
                                displayDate = closestTxDate;
                            }
                        }
                    }
                    timelineEvents.push({
                        type: 'SPARE_PART_BRANCH',
                        title: `صيانة وقطع غيار الفرع: ${r.type} (${Math.abs(parseInt(r.count_in) || 1)} قطعة)`,
                        date: displayDate,
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
// 4. CLOUD NETWORK STATUS & FALLBACK API
// ==========================================
app.get('/api/tunnel/status', (req, res) => {
    res.json({
        success: true,
        running: true,
        active: true,
        publicUrl: 'https://smartcs.m-kamel.workers.dev',
        mode: process.platform === 'linux' ? 'cloud_vps' : 'local_with_vps_sync',
        target: 'https://smartcs.m-kamel.workers.dev'
    });
});

// ==========================================
// 4.1 SYSTEM VERSION & GITHUB AUTO-UPDATER
// ==========================================
const updater = require('./updater');

app.get('/api/system/version', async (req, res) => {
    try {
        const info = await updater.getVersionInfo();
        res.json({ success: true, ...info });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/system/check-updates', async (req, res) => {
    try {
        const updateStatus = await updater.checkForUpdates();
        res.json({ success: true, ...updateStatus });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/system/auto-update', async (req, res) => {
    try {
        const result = await updater.performUpdate();
        if (result.success) {
            if (typeof broadcastSseEvent === 'function') {
                broadcastSseEvent('app_updated', {
                    message: 'تم تحديث المنظومة بنجاح إلى أحدث إصدار من GitHub!',
                    version: result.new_version
                });
            }

            res.json({ success: true, ...result });

            setTimeout(() => {
                console.log('[AUTO-UPDATER] Restarting application process after update...');
                process.exit(0);
            }, 1000);
        } else {
            res.status(500).json(result);
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/tunnel/start', requireAdmin, async (req, res) => {
    res.json({ success: true, running: false, message: 'Direct Oracle Cloud VPS active' });
});

app.post('/api/tunnel/stop', requireAdmin, (req, res) => {
    res.json({ success: true, running: false });
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

app.post('/api/sync/delta', syncLimiter, express.json({ limit: '50mb' }), async (req, res) => {
    const secret = req.headers['x-sync-secret'] || req.query.secret;
    if (!safeCompareSecret(secret, SYNC_SECRET)) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid sync secret' });
    }

    const { changes, tablesData } = req.body || {};
    let appliedCount = 0;

    // Whitelist of allowed table names to prevent SQL injection via dynamic table names
    const ALLOWED_SYNC_TABLES = new Set([
        'assets_raw', 'transactions_raw', 'maintenance_raw', 'payments_raw',
        'store_pos_raw', 'store_sim_raw', 'store_sp_raw', 'store_sp_maintenance_raw',
        'installments_raw', 'tblfaults_raw', 'tblstaff_raw', 'tblfixes_raw',
        'failure_points_raw', 'audit_change_logs', 'sync_history'
    ]);

    try {
        if (tablesData && typeof tablesData === 'object') {
            for (const [tbl, rows] of Object.entries(tablesData)) {
                if (Array.isArray(rows) && rows.length > 0 && ALLOWED_SYNC_TABLES.has(tbl)) {
                    const sample = rows[0];
                    const keys = Object.keys(sample);
                    const pkCandidates = ['COMPOSITE', 'ID', 'id', 'Serial', 'sim_serial', 'faultid', 'FixID'];
                    let pkAssigned = false;
                    const createCols = keys.map(k => {
                        if (!pkAssigned && pkCandidates.includes(k)) {
                            pkAssigned = true;
                            return `"${k}" TEXT PRIMARY KEY`;
                        }
                        return `"${k}" TEXT`;
                    }).join(', ');
                    await runQuery(`CREATE TABLE IF NOT EXISTS "${tbl}" (${createCols});`);
                    for (const row of rows) {
                        const rowKeys = Object.keys(row);
                        const placeholders = rowKeys.map(() => '?').join(', ');
                        const quotedCols = rowKeys.map(k => `"${k}"`).join(', ');
                        
                        let insertSql = `INSERT OR REPLACE INTO "${tbl}" (${quotedCols}) VALUES (${placeholders})`;
                        if (appCfg.isCloudServer && pkAssigned) {
                            let matchedPk = null;
                            for (const col of pkCandidates) {
                                if (rowKeys.includes(col)) { matchedPk = col; break; }
                            }
                            if (matchedPk) {
                                const updateCols = rowKeys.filter(k => k !== matchedPk).map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');
                                insertSql = `INSERT INTO "${tbl}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT ("${matchedPk}") DO UPDATE SET ${updateCols || `"${matchedPk}" = EXCLUDED."${matchedPk}"`}`;
                            }
                        }
                        
                        await runQuery(insertSql, Object.values(row));
                        appliedCount++;
                    }
                }
            }
        }

        if (changes && Array.isArray(changes) && changes.length > 0) {
            for (const change of changes) {
                if (change.table_name && ALLOWED_SYNC_TABLES.has(change.table_name) && change.new_data) {
                    try {
                        const parsed = typeof change.new_data === 'string' ? JSON.parse(change.new_data) : change.new_data;
                        const keys = Object.keys(parsed);
                        if (keys.length > 0) {
                            let createCols = keys.map(k => `"${k}" TEXT`).join(', ');
                            const pkCandidates = ['COMPOSITE', 'ID', 'id', 'Serial', 'sim_serial', 'faultid', 'FixID'];
                            let pkAssigned = false;
                            for (const col of pkCandidates) {
                                if (keys.includes(col)) {
                                    createCols = createCols.replace(`"${col}" TEXT`, `"${col}" TEXT PRIMARY KEY`);
                                    pkAssigned = true;
                                    break;
                                }
                            }
                            await runQuery(`CREATE TABLE IF NOT EXISTS "${change.table_name}" (${createCols});`).catch(() => {});
                            const existingInfo = await allQuery(`PRAGMA table_info("${change.table_name}");`).catch(() => []);
                            const existingCols = new Set(existingInfo.map(i => i.name));
                            for (const k of keys) {
                                if (!existingCols.has(k)) {
                                    await runQuery(`ALTER TABLE "${change.table_name}" ADD COLUMN "${k}" TEXT;`).catch(() => {});
                                }
                            }
                            const placeholders = keys.map(() => '?').join(', ');
                            const quotedCols = keys.map(k => `"${k}"`).join(', ');
                            const values = Object.values(parsed).map(v => v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
                            
                            let matchedPk = null;
                            for (const col of pkCandidates) {
                                if (keys.includes(col)) { matchedPk = col; break; }
                            }
                            
                            let insertSql = `INSERT OR REPLACE INTO "${change.table_name}" (${quotedCols}) VALUES (${placeholders})`;
                            if (appCfg.isCloudServer && matchedPk) {
                                const updateCols = keys.filter(k => k !== matchedPk).map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');
                                insertSql = `INSERT INTO "${change.table_name}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT ("${matchedPk}") DO UPDATE SET ${updateCols || `"${matchedPk}" = EXCLUDED."${matchedPk}"`}`;
                            }
                            
                            await runQuery(insertSql, values);
                            appliedCount++;
                        }
                    } catch(e) {
                        console.error(`[DELTA APPLY ERROR on ${change.table_name}]:`, e.message);
                    }
                } else if (change.table_name && ALLOWED_SYNC_TABLES.has(change.table_name) && change.change_type === 'DELETE' && change.record_id) {
                    try {
                        const existingInfo = await allQuery(`PRAGMA table_info("${change.table_name}");`).catch(() => []);
                        const existingCols = new Set(existingInfo.map(i => i.name));
                        const pkCandidates = ['ID', 'id', 'Serial', 'sim_serial', 'faultid', 'FixID'];
                        const matchedPk = pkCandidates.find(c => existingCols.has(c));
                        if (matchedPk) {
                            await runQuery(`DELETE FROM "${change.table_name}" WHERE "${matchedPk}" = ?`, [change.record_id]);
                            appliedCount++;
                        }
                    } catch(e) {
                        console.error(`[DELTA DELETE ERROR on ${change.table_name}]:`, e.message);
                    }
                }

                // Also persist in cloud audit_change_logs
                try {
                    await runQuery(`
                        INSERT INTO audit_change_logs (table_name, record_id, change_type, summary, old_data, new_data, source)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [
                        change.table_name,
                        change.record_id,
                        change.change_type || 'UPDATE',
                        change.summary || '',
                        typeof change.old_data === 'object' ? JSON.stringify(change.old_data) : (change.old_data || null),
                        typeof change.new_data === 'object' ? JSON.stringify(change.new_data) : (change.new_data || null),
                        change.source || 'MS_ACCESS_SYNC'
                    ]);
                } catch(e) {}
            }
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
        
        // IMPORTANT: Send response FIRST so client (and Nginx) doesn't timeout!
        res.json({ success: true, applied: appliedCount, timestamp: new Date().toISOString() });

        // Re-align high level domain entities ASYNCHRONOUSLY after response is safely flushed
        if (syncEngine && typeof syncEngine.syncHighLevelDomainEntities === 'function') {
            setTimeout(() => {
                syncEngine.syncHighLevelDomainEntities(db).catch(e => console.error('[SYNC REBUILD ERROR]', e));
            }, 100);
        }
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

// ==========================================
// 7. DIAGNOSTICS, ERROR TRACER & RECONCILIATION API
// ==========================================

const CORE_RECONCILIATION_TABLES = [
    { table: 'assets_raw', name_ar: 'بيانات المخابز والأجهزة (Assets)' },
    { table: 'transactions_raw', name_ar: 'حركات وصيانة الماكينات (TransAction)' },
    { table: 'maintenance_raw', name_ar: 'بلاغات الصيانة (Maintenance)' },
    { table: 'payments_raw', name_ar: 'المدفوعات والتحصيلات (Payments)' },
    { table: 'store_pos_raw', name_ar: 'مخزن ماكينات الـ POS (Store_POS)' },
    { table: 'store_sim_raw', name_ar: 'مخزن شرائح الاتصال (Store_Sim)' },
    { table: 'store_sp_raw', name_ar: 'مخزن وحركات قطع غيار الفرع (Store_SP)' },
    { table: 'store_sp_maintenance_raw', name_ar: 'قطع غيار مركز الصيانة الرئيسي (Store_SP_maintenance)' },
    { table: 'installments_raw', name_ar: 'عقود وأقساط الماكينات (tblInstallments)' },
    { table: 'tblfaults_raw', name_ar: 'قائمة الأعطال (tblFaults)' },
    { table: 'tblstaff_raw', name_ar: 'طاقم العمل والفنيين (AuthorizedUsers)' },
    { table: 'tblfixes_raw', name_ar: 'أنواع الإصلاحات (tblFixes)' },
    { table: 'failure_points_raw', name_ar: 'نقاط الأعطال والأسعار الرسمية (failure_points)' }
];

// 1. Get System Error Logs
app.get('/api/diagnostics/errors', async (req, res) => {
    try {
        const { limit = 100, severity, module } = req.query;
        let query = 'SELECT * FROM system_error_logs';
        const params = [];
        const conditions = [];

        if (severity && severity !== 'ALL') {
            conditions.push('severity = ?');
            params.push(severity);
        }
        if (module && module !== 'ALL') {
            conditions.push('module = ?');
            params.push(module);
        }
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY id DESC LIMIT ?';
        params.push(parseInt(limit, 10));

        const errors = await allQuery(query, params);
        
        // Summary stats
        const last24hCount = (await getQuery(`
            SELECT COUNT(*) as count FROM system_error_logs 
            WHERE timestamp >= datetime('now', '-24 hours', 'localtime')
        `))?.count || 0;

        const totalErrors = (await getQuery(`SELECT COUNT(*) as count FROM system_error_logs`))?.count || 0;

        res.json({
            success: true,
            total: totalErrors,
            last_24h_count: last24hCount,
            errors
        });
    } catch (err) {
        logSystemError('DIAGNOSTICS', '/api/diagnostics/errors', err, req);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. Client-Side Error Ingestion (Frontend Unhandled Errors)
app.post('/api/diagnostics/log-client-error', express.json(), async (req, res) => {
    try {
        const { message, source, lineno, colno, stack, url, userAgent } = req.body || {};
        const errObj = {
            message: message || 'Client Error',
            stack: stack || `at ${source || 'unknown'}:${lineno || 0}:${colno || 0}\nURL: ${url || ''}\nUA: ${userAgent || ''}`
        };
        await logSystemError('CLIENT_UI', url || 'frontend', errObj, req, 'ERROR');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Clear System Error Logs
app.post('/api/diagnostics/clear-errors', requireAdmin, async (req, res) => {
    try {
        await runQuery('DELETE FROM system_error_logs');
        res.json({ success: true, message: 'تم تفريغ سجل الأخطاء بنجاح' });
    } catch (err) {
        logSystemError('DIAGNOSTICS', '/api/diagnostics/clear-errors', err, req);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Get Table Counts on Current Node
app.get('/api/diagnostics/table-counts', async (req, res) => {
    try {
        const counts = {};
        for (const item of CORE_RECONCILIATION_TABLES) {
            try {
                const r = await getQuery(`SELECT COUNT(*) as c FROM "${item.table}"`);
                counts[item.table] = r ? r.c : 0;
            } catch (e) {
                counts[item.table] = -1; // table might not exist
            }
        }
        res.json({ success: true, counts, timestamp: new Date().toISOString() });
    } catch (err) {
        logSystemError('DIAGNOSTICS', '/api/diagnostics/table-counts', err, req);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. Database Reconciliation Matrix (Local vs Cloud VPS)
app.get('/api/diagnostics/reconciliation', async (req, res) => {
    try {
        // 1. Gather Local Counts
        const localCounts = {};
        for (const item of CORE_RECONCILIATION_TABLES) {
            try {
                const r = await getQuery(`SELECT COUNT(*) as c FROM "${item.table}"`);
                localCounts[item.table] = r ? r.c : 0;
            } catch (e) {
                localCounts[item.table] = 0;
            }
        }

        const config = readAppConfig();
        const isCloud = !!config.isCloudServer;
        let cloudCounts = null;
        let cloudFetchError = null;

        // 2. Fetch Cloud VPS Counts if on local server
        if (!isCloud) {
            const cloudUrl = (config.cloudEndpoint || 'http://141.147.136.170/api/sync/delta').replace(/\/api\/sync\/delta.*$/, '/api/diagnostics/table-counts');
            const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
            try {
                const cloudResp = await fetchFn(cloudUrl, {
                    headers: { 'x-sync-secret': SYNC_SECRET },
                    signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
                });
                const text = await cloudResp.text();
                try {
                    const cloudData = JSON.parse(text);
                    if (cloudData.success && cloudData.counts) {
                        cloudCounts = cloudData.counts;
                    } else {
                        cloudFetchError = cloudData.error || 'Invalid cloud response';
                    }
                } catch (pe) {
                    cloudFetchError = `Cloud HTTP ${cloudResp.status}: ${text.slice(0, 100)}`;
                }
            } catch (e) {
                cloudFetchError = e.message;
            }
        }

        // 3. Build Matrix
        let allMatched = true;
        let mismatchedCount = 0;
        let totalLocalRecords = 0;
        let totalCloudRecords = 0;

        const tableMatrix = CORE_RECONCILIATION_TABLES.map(item => {
            const lCount = parseInt(localCounts[item.table] ?? 0, 10);
            totalLocalRecords += (lCount >= 0 ? lCount : 0);

            let cCount = null;
            let diff = 0;
            let status = 'UNKNOWN';

            if (isCloud) {
                cCount = lCount; // We are on cloud
                status = 'MATCHED';
            } else if (cloudCounts) {
                cCount = parseInt(cloudCounts[item.table] ?? 0, 10);
                totalCloudRecords += (cCount >= 0 ? cCount : 0);
                diff = lCount - cCount;
                if (diff === 0) {
                    status = 'MATCHED';
                } else {
                    status = 'MISMATCH';
                    allMatched = false;
                    mismatchedCount++;
                }
            }

            return {
                table: item.table,
                name_ar: item.name_ar,
                local_count: lCount,
                cloud_count: cCount,
                diff: diff,
                status: status
            };
        });

        // Check recent errors in last 24h
        const errorsLast24h = (await getQuery(`
            SELECT COUNT(*) as count FROM system_error_logs 
            WHERE timestamp >= datetime('now', '-24 hours', 'localtime')
        `))?.count || 0;

        res.json({
            success: true,
            is_cloud_server: isCloud,
            is_all_matched: isCloud ? true : allMatched,
            mismatched_count: mismatchedCount,
            total_local_records: totalLocalRecords,
            total_cloud_records: isCloud ? totalLocalRecords : totalCloudRecords,
            cloud_fetch_error: cloudFetchError,
            errors_last_24h: errorsLast24h,
            tables: tableMatrix,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        logSystemError('DIAGNOSTICS', '/api/diagnostics/reconciliation', err, req);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. Full Cloud Seed Receiver (VPS Endpoint)
app.post('/api/sync/full-seed', express.json({ limit: '100mb' }), async (req, res) => {
    const secret = req.headers['x-sync-secret'] || req.query.secret;
    if (!safeCompareSecret(secret, SYNC_SECRET)) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid sync secret' });
    }

    const { tablesData, isAppend } = req.body || {};
    const startTime = Date.now();
    let totalImported = 0;

    try {
        if (tablesData && typeof tablesData === 'object') {
            for (const [tbl, rows] of Object.entries(tablesData)) {
                if (!Array.isArray(rows) || rows.length === 0) continue;

                const sample = rows[0];
                const cols = Object.keys(sample);
                const pkCandidates = ['COMPOSITE', 'ID', 'id', 'Serial', 'sim_serial', 'faultid', 'FixID'];
                let pkAssigned = false;
                const createCols = cols.map(c => {
                    if (!pkAssigned && pkCandidates.includes(c)) {
                        pkAssigned = true;
                        return `"${c}" TEXT PRIMARY KEY`;
                    }
                    return `"${c}" TEXT`;
                }).join(', ');
                await runQuery(`CREATE TABLE IF NOT EXISTS "${tbl}" (${createCols});`);
                
                if (appCfg.isCloudServer) {
                    const existingInfo = await allQuery(`SELECT column_name as name FROM information_schema.columns WHERE table_name = '${tbl}'`).catch(() => []);
                    const existingCols = new Set(existingInfo.map(i => i.name));
                    for (const c of cols) {
                        if (!existingCols.has(c) && !existingCols.has(c.toLowerCase())) {
                            await runQuery(`ALTER TABLE "${tbl}" ADD COLUMN "${c}" TEXT;`).catch(() => {});
                        }
                    }
                }

                const placeholders = cols.map(() => '?').join(', ');
                const quotedCols = cols.map(c => `"${c}"`).join(', ');
                let insertSql = `INSERT OR REPLACE INTO "${tbl}" (${quotedCols}) VALUES (${placeholders});`;
                
                if (appCfg.isCloudServer && pkAssigned) {
                    let matchedPk = null;
                    for (const col of pkCandidates) {
                        if (cols.includes(col)) { matchedPk = col; break; }
                    }
                    if (matchedPk) {
                        const updateCols = cols.filter(k => k !== matchedPk).map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');
                        insertSql = `INSERT INTO "${tbl}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT ("${matchedPk}") DO UPDATE SET ${updateCols || `"${matchedPk}" = EXCLUDED."${matchedPk}"`};`;
                    }
                }

                if (appCfg.isCloudServer && pgPool) {
                    const client = await pgPool.connect();
                    try {
                        await client.query('BEGIN');
                        if (!isAppend) {
                            await client.query(`DELETE FROM "${tbl}";`);
                        }
                        for (const row of rows) {
                            const vals = cols.map(c => {
                                const v = row[c];
                                if (v === null || v === undefined) return '';
                                if (typeof v === 'object') return JSON.stringify(v);
                                return String(v);
                            });
                            const { pgSql, pgParams } = translateSqliteToPostgres(insertSql, vals);
                            await client.query(pgSql, pgParams);
                        }
                        await client.query('COMMIT');
                        totalImported += rows.length;
                    } catch (e) {
                        await client.query('ROLLBACK').catch(() => {});
                        throw e;
                    } finally {
                        client.release();
                    }
                } else {
                    if (!appCfg.isCloudServer) await runQuery('SAVEPOINT sp_full_seed;');
                    try {
                        if (!isAppend) {
                            await runQuery(`DELETE FROM "${tbl}";`);
                        }
                        for (const row of rows) {
                            const vals = cols.map(c => {
                                const v = row[c];
                                if (v === null || v === undefined) return '';
                                if (typeof v === 'object') return JSON.stringify(v);
                                return String(v);
                            });
                            await runQuery(insertSql, vals);
                        }
                        if (!appCfg.isCloudServer) await runQuery('RELEASE SAVEPOINT sp_full_seed;').catch(() => {});
                        totalImported += rows.length;
                    } catch (e) {
                        if (!appCfg.isCloudServer) await runQuery('ROLLBACK TO SAVEPOINT sp_full_seed;').catch(() => {});
                        throw e;
                    }
                }
            }
        }

        res.json({
            success: true,
            total_records: totalImported,
            duration_ms: Date.now() - startTime,
            message: `تمت المزامنة والتأسيس الشامل بنجاح (${totalImported} سجل)`
        });

        // Rebuild domain entities ASYNCHRONOUSLY to avoid keeping connection open
        if (req.body.rebuildDomain !== false && syncEngine && typeof syncEngine.syncHighLevelDomainEntities === 'function') {
            setTimeout(() => {
                syncEngine.syncHighLevelDomainEntities(db).catch(e => console.error('[SYNC REBUILD ERROR]', e));
            }, 100);
        }
    } catch (err) {
        logSystemError('FULL_SEED_RECEIVE', '/api/sync/full-seed', err, req, 'CRITICAL');
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. Reseed Cloud VPS from Local Database (1-Click Action)
app.post('/api/diagnostics/reseed-vps', requireAdmin, async (req, res) => {
    try {
        const config = readAppConfig();
        if (config.isCloudServer) {
            return res.status(400).json({ success: false, error: 'Cannot reseed cloud from cloud itself.' });
        }

        console.log('[DIAGNOSTICS] Starting 1-Click Batched Cloud Reseed from Local SQLite...');
        const startTime = Date.now();
        let totalCount = 0;

        const cloudUrl = (config.cloudEndpoint || 'https://smartcs.m-kamel.workers.dev/api/sync/delta').replace(/\/api\/sync\/delta.*$/, '/api/sync/full-seed');
        const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');

        for (const item of CORE_RECONCILIATION_TABLES) {
            let rows = [];
            try {
                rows = await allQuery(`SELECT * FROM "${item.table}"`) || [];
            } catch(e) {
                rows = [];
            }
            if (rows.length === 0) continue;

            const CHUNK_SIZE = 500;
            for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
                const chunk = rows.slice(i, i + CHUNK_SIZE);
                const isFirst = (i === 0);

                const cloudResp = await fetchFn(cloudUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-sync-secret': SYNC_SECRET
                    },
                    body: JSON.stringify({
                        tablesData: { [item.table]: chunk },
                        isAppend: !isFirst,
                        rebuildDomain: false,
                        timestamp: new Date().toISOString()
                    })
                });

                const rawText = await cloudResp.text();
                let cloudResult = {};
                try { 
                    cloudResult = JSON.parse(rawText); 
                } catch(e) {
                    console.error(`[RESEED ERROR] Invalid response for ${item.table}:`, rawText.slice(0, 200));
                    throw new Error(`تعذر معالجة استجابة السيرفر السحابي لجدول ${item.name_ar}: ${rawText.slice(0, 100)}`);
                }
                if (!cloudResult.success) {
                    throw new Error(cloudResult.error || `خطأ في مزامنة جدول ${item.name_ar}`);
                }
            }
            totalCount += rows.length;
        }

        // Final trigger to rebuild domain entities on cloud
        try {
            await fetchFn(cloudUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-sync-secret': SYNC_SECRET
                },
                body: JSON.stringify({
                    tablesData: {},
                    rebuildDomain: true,
                    timestamp: new Date().toISOString()
                })
            });
        } catch(e){}

        const duration = Date.now() - startTime;
        console.log(`[DIAGNOSTICS] Full Reseed Successful: ${totalCount} records synced to Cloud VPS in ${duration}ms!`);

        res.json({
            success: true,
            total_records: totalCount,
            duration_ms: duration,
            message: `تمت المزامنة وإعادة التأسيس الشامل بنجاح لجميع الجداول (${totalCount} سجل) على السيرفر السحابي ⚡`
        });
    } catch (err) {
        logSystemError('RESEED_VPS', '/api/diagnostics/reseed-vps', err, req);
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

// Graceful shutdown handler
async function gracefulShutdown(signal) {
    console.log(`\n[SHUTDOWN] ${signal} received. Cleaning up...`);
    try {
        if (pgPool) {
            await pgPool.end();
            console.log('[SHUTDOWN] PostgreSQL pool closed.');
        }
    } catch (e) { console.error('[SHUTDOWN] pgPool close error:', e.message); }
    try {
        db.close();
        console.log('[SHUTDOWN] SQLite database closed.');
    } catch (e) { console.error('[SHUTDOWN] SQLite close error:', e.message); }
    console.log('[SHUTDOWN] Cleanup complete. Exiting.');
    process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Auto-cleanup logs older than 90 days to prevent infinite growth
setInterval(async () => {
    try {
        console.log('[MAINTENANCE] Running log cleanup job...');
        await runQuery(`DELETE FROM audit_change_logs WHERE timestamp < datetime('now', '-90 days')`).catch(() => {});
        await runQuery(`DELETE FROM sync_history WHERE sync_time < datetime('now', '-90 days')`).catch(() => {});
        await runQuery(`DELETE FROM system_error_logs WHERE timestamp < datetime('now', '-90 days')`).catch(() => {});
    } catch (e) {
        console.error('[LOG CLEANUP ERROR]', e.message);
    }
}, 24 * 60 * 60 * 1000); // Run daily
