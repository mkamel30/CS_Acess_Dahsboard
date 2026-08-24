/**
 * Access Database Synchronization & Change Tracking Engine
 * Connects SQLite Webapp Database <---> MS Access Database (Bread_Final_be.accdb)
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();

const DATA_SYNC_DIR = path.join(__dirname, 'data_sync');
const CONFIG_FILE_PATH = path.join(__dirname, 'config.json');
const DEFAULT_ACCESS_FILE_PATH = 'h:\\Programming\\Br_DB\\BE\\Bread_Final_be.accdb';
const VBS_EXPORTER_PATH = path.join(__dirname, 'export_accdb_tables.vbs');

function readConfigSafely() {
    try {
        if (fs.existsSync(CONFIG_FILE_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8')) || {};
        }
    } catch (e) {}
    return {};
}

function getAccessFilePath() {
    const config = readConfigSafely();
    if (config && config.accessFilePath && typeof config.accessFilePath === 'string') {
        return config.accessFilePath.trim();
    }
    return DEFAULT_ACCESS_FILE_PATH;
}

function setAccessFilePath(newPath) {
    if (!newPath || typeof newPath !== 'string') {
        throw new Error('مسار قاعدة البيانات غير صالح');
    }
    const cleanPath = newPath.trim().replace(/^["']|["']$/g, '');
    if (!cleanPath.includes('\\') && !cleanPath.includes('/')) {
        throw new Error(`تم استلام اسم الملف فقط (${cleanPath}) بدون مسار المجلد. يرجى كتابة أو لصق المسار الكامل مثل: \\\\ServerIP\\Share\\${cleanPath} أو Z:\\${cleanPath}`);
    }
    if (!fs.existsSync(cleanPath)) {
        throw new Error('الملف غير موجود في المسار المحدد: ' + cleanPath + ' (تأكد من صحة المسار وصلاحيات المشاركة على الشبكة)');
    }
    if (!/\.(accdb|mdb)$/i.test(cleanPath)) {
        throw new Error('نوع الملف غير مدعوم. يجب أن يكون ملف آكسيس بصيغة .accdb أو .mdb');
    }
    const config = { ...readConfigSafely(), accessFilePath: cleanPath, updatedAt: new Date().toISOString() };
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf8');
    return cleanPath;
}

let fileWatcher = null;
let watcherDebounceTimer = null;
let periodicInterval = null;
let onSyncCompleteCallback = null;
let lastKnownMtime = 0;

function isAutoSyncEnabled() {
    const config = readConfigSafely();
    return config.autoSync !== false; // Default enabled
}

function setOnSyncCompleteCallback(cb) {
    onSyncCompleteCallback = cb;
}

function startFileWatcher(db) {
    if (fileWatcher) {
        try { fileWatcher.close(); } catch(e){}
        fileWatcher = null;
    }
    if (periodicInterval) {
        clearInterval(periodicInterval);
        periodicInterval = null;
    }

    if (!isAutoSyncEnabled()) {
        console.log('[FILE WATCHER] Real-time auto-sync is currently disabled in settings.');
        return;
    }

    const accessPath = getAccessFilePath();
    if (!fs.existsSync(accessPath)) {
        console.warn(`[FILE WATCHER] Access file not found: ${accessPath}`);
        return;
    }

    try {
        lastKnownMtime = fs.statSync(accessPath).mtimeMs;
    } catch (e) {
        lastKnownMtime = Date.now();
    }

    const dir = path.dirname(accessPath);
    const fileName = path.basename(accessPath);
    const baseTarget = fileName.toLowerCase().replace(/\.(accdb|mdb)$/, '');

    const triggerAutoSync = (reason) => {
        clearTimeout(watcherDebounceTimer);
        watcherDebounceTimer = setTimeout(async () => {
            if (isSyncInProgress) return;
            try {
                if (fs.existsSync(accessPath)) {
                    const curMtime = fs.statSync(accessPath).mtimeMs;
                    lastKnownMtime = curMtime;
                    console.log(`[FILE WATCHER] Auto-triggering sync (${reason})...`);
                    const result = await performFullSync(db);
                    if (onSyncCompleteCallback && typeof onSyncCompleteCallback === 'function') {
                        onSyncCompleteCallback(result);
                    }
                }
            } catch (err) {
                console.error('[FILE WATCHER] Auto-sync error:', err.message);
            }
        }, 3000);
    };

    // 1. Native Directory Watcher
    try {
        console.log(`[FILE WATCHER] Real-Time Watcher active on: ${accessPath}`);
        fileWatcher = fs.watch(dir, { persistent: true }, (eventType, triggerFile) => {
            if (!isAutoSyncEnabled() || isSyncInProgress) return;
            if (!triggerFile) return;

            const lower = triggerFile.toLowerCase();
            if (lower.includes(baseTarget) || lower.endsWith('.accdb') || lower.endsWith('.laccdb') || lower.endsWith('.ldb')) {
                triggerAutoSync(`detected modification in ${triggerFile}`);
            }
        });

        if (fileWatcher) {
            fileWatcher.on('error', (err) => {
                console.warn('[FILE WATCHER] Network share watcher notice (recovering gracefully):', err.message);
                try { fileWatcher.close(); } catch(e){}
                fileWatcher = null;
                setTimeout(() => {
                    if (isAutoSyncEnabled()) {
                        startFileWatcher(db);
                    }
                }, 15000);
            });
        }
    } catch (err) {
        console.error('[FILE WATCHER] Could not attach fs.watch (will rely on polling):', err.message);
    }

    // 2. Periodic Polling fallback (every 25 seconds)
    periodicInterval = setInterval(() => {
        if (!isAutoSyncEnabled() || isSyncInProgress) return;
        try {
            if (fs.existsSync(accessPath)) {
                const curMtime = fs.statSync(accessPath).mtimeMs;
                if (curMtime > lastKnownMtime) {
                    lastKnownMtime = curMtime;
                    triggerAutoSync('mtime changed');
                }
            }
        } catch (e) {}
    }, 25000);
}

function setAutoSyncEnabled(enabled, db) {
    const isEnabled = !!enabled;
    const config = { ...readConfigSafely(), autoSync: isEnabled, updatedAt: new Date().toISOString() };
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf8');
    if (isEnabled) {
        startFileWatcher(db);
    } else {
        if (fileWatcher) {
            try { fileWatcher.close(); } catch(e){}
            fileWatcher = null;
        }
        if (periodicInterval) {
            clearInterval(periodicInterval);
            periodicInterval = null;
        }
    }
    return isEnabled;
}

let isSyncInProgress = false;
let lastSyncResult = {
    lastSyncTime: null,
    status: 'idle',
    message: 'لم يتم إجراء مزامنة بعد',
    changesDetected: 0,
    tablesSynced: 0,
    totalRecords: 0,
    durationMs: 0
};

// Helper: Run SQL as Promise
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// Initialize SQLite tables for Sync & Change Tracking & Domain Entities
async function initSyncDatabase(db) {
    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS audit_change_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            table_name TEXT NOT NULL,
            record_id TEXT,
            change_type TEXT NOT NULL, /* INSERT, UPDATE, DELETE */
            summary TEXT,
            old_data TEXT,
            new_data TEXT,
            source TEXT DEFAULT 'MS_ACCESS_SYNC'
        );
    `);

    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS sync_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT,
            tables_count INTEGER,
            records_count INTEGER,
            changes_count INTEGER,
            duration_ms INTEGER,
            details TEXT
        );
    `);

    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS merchants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_code TEXT UNIQUE,
            name TEXT,
            type TEXT,
            contact_phone TEXT,
            contact_phone_2 TEXT,
            address TEXT,
            government TEXT,
            bank_account TEXT,
            tax_card TEXT,
            fuel_type TEXT,
            bread_type TEXT,
            training TEXT,
            papers_date TEXT,
            national_id TEXT,
            notes TEXT,
            status TEXT DEFAULT 'active'
        );
    `);

    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY,
            serial TEXT UNIQUE,
            manufacturer TEXT,
            model TEXT,
            status TEXT,
            faulty_details TEXT,
            solder_bridges TEXT
        );
    `);

    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS sim_cards (
            id INTEGER PRIMARY KEY,
            serial TEXT UNIQUE,
            carrier TEXT,
            status TEXT
        );
    `);

    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS merchant_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_code TEXT,
            device_id INTEGER,
            sim_card_id INTEGER,
            sim_id INTEGER,
            slot_label TEXT DEFAULT 'Main POS',
            assigned_date DATETIME,
            status TEXT DEFAULT 'active'
        );
    `);
    try { await dbRun(db, `ALTER TABLE merchant_assets ADD COLUMN sim_card_id INTEGER;`); } catch(e){}
    try { await dbRun(db, `ALTER TABLE merchant_assets ADD COLUMN slot_label TEXT DEFAULT 'Main POS';`); } catch(e){}

    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY,
            type TEXT,
            merchant_code TEXT,
            device_id INTEGER,
            status TEXT,
            issue_details TEXT,
            resolution_details TEXT,
            technician_name TEXT,
            issue_date DATETIME,
            close_date DATETIME,
            hq_debt REAL DEFAULT 0,
            hq_payment_ref TEXT,
            entry_time DATETIME,
            selected_faults TEXT,
            selected_bridges TEXT
        );
    `);

    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS maintenance_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER,
            technician_name TEXT,
            action_taken TEXT,
            parts_used TEXT,
            maintenance_date DATETIME,
            status TEXT
        );
    `);

    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY,
            merchant_code TEXT,
            payment_date DATETIME,
            amount REAL,
            ref_num TEXT,
            reason TEXT,
            payment_place TEXT
        );
    `);

    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS tblfaults (
            id INTEGER PRIMARY KEY,
            fault_name TEXT
        );
    `);

    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS tblstaff (
            id INTEGER PRIMARY KEY,
            name TEXT,
            role TEXT,
            can_maintain INTEGER DEFAULT 1
        );
    `);

    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS spare_parts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            part_name TEXT UNIQUE,
            compatible_models TEXT,
            critical_limit INTEGER DEFAULT 5,
            price REAL DEFAULT 100,
            quantity_in_stock INTEGER DEFAULT 0
        );
    `);

    await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_audit_table_time ON audit_change_logs(table_name, timestamp DESC);`);
    await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_change_logs(change_type);`);
}

/**
 * Execute the VBScript extractor to dump Access tables to JSON
 */
function runAccessExporter() {
    return new Promise((resolve, reject) => {
        const cscriptPath = 'C:\\Windows\\System32\\cscript.exe';
        const activePath = getAccessFilePath();
        const cmd = `"${cscriptPath}" //nologo "${VBS_EXPORTER_PATH}" "${activePath}"`;
        
        console.log(`[SYNC ENGINE] Starting Access Database Export from: ${activePath}`);
        const startTime = Date.now();
        
        exec(cmd, { maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
            const duration = Date.now() - startTime;
            if (error) {
                console.error('[SYNC ENGINE] Export Error:', error.message);
                return reject(error);
            }
            console.log(`[SYNC ENGINE] Export finished in ${duration}ms`);
            resolve({ stdout, duration });
        });
    });
}

/**
 * Helper to safely read JSON with UTF-8 BOM removal
 */
function readJsonSafely(filePath) {
    if (!fs.existsSync(filePath)) return null;
    let content = fs.readFileSync(filePath, 'utf8');
    content = content.replace(/^\uFEFF/, '').trim();
    if (!content) return null;
    try {
        return JSON.parse(content);
    } catch (e) {
        console.error(`[SYNC ENGINE] JSON parse error in ${filePath}:`, e.message);
        return null;
    }
}

/**
 * Generic Table Diff & Sync Function
 */
async function syncTableWithDiff(db, tableName, primaryKey, jsonRecords) {
    if (!jsonRecords || !Array.isArray(jsonRecords)) return { inserted: 0, updated: 0, deleted: 0, total: 0 };

    let existingRows = [];
    try {
        existingRows = await dbAll(db, `SELECT * FROM "${tableName}"`);
    } catch (err) {
        existingRows = [];
    }

    const existingMap = new Map();
    existingRows.forEach(row => {
        const key = String(row[primaryKey] || row.id || row.ID || row.Serial || row.bkCode || row.bkcode || row.merchant_code || '');
        if (key) existingMap.set(key, row);
    });

    const currentMap = new Map();
    let insertedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    const changeLogs = [];

    for (const item of jsonRecords) {
        const key = String(item[primaryKey] || item.id || item.ID || item.Serial || item.bkCode || item.bkcode || item.merchant_code || '');
        if (!key) continue;
        currentMap.set(key, item);

        if (!existingMap.has(key)) {
            // NEW INSERTION
            insertedCount++;
            changeLogs.push({
                table_name: tableName,
                record_id: key,
                change_type: 'INSERT',
                summary: `إضافة سجل جديد بالمعرف: ${key}`,
                old_data: null,
                new_data: JSON.stringify(item),
                source: 'MS_ACCESS_SYNC'
            });
        } else {
            // CHECK FOR MODIFICATIONS
            const oldRow = existingMap.get(key);
            const diffFields = [];
            for (const prop of Object.keys(item)) {
                const oldVal = oldRow[prop];
                const newVal = item[prop];
                if (newVal !== undefined && newVal !== null && String(oldVal !== null && oldVal !== undefined ? oldVal : '') !== String(newVal)) {
                    diffFields.push({ field: prop, old: oldVal, new: newVal });
                }
            }

            if (diffFields.length > 0) {
                updatedCount++;
                changeLogs.push({
                    table_name: tableName,
                    record_id: key,
                    change_type: 'UPDATE',
                    summary: `تعديل الحقول: ${diffFields.slice(0, 5).map(f => f.field).join(', ')}${diffFields.length > 5 ? '...' : ''}`,
                    old_data: JSON.stringify(oldRow),
                    new_data: JSON.stringify(item),
                    source: 'MS_ACCESS_SYNC'
                });
            }
        }
    }

    // Check for DELETIONS (if existing records were already populated)
    if (existingRows.length > 0 && jsonRecords.length > 0) {
        for (const [key, oldRow] of existingMap.entries()) {
            if (!currentMap.has(key)) {
                deletedCount++;
                changeLogs.push({
                    table_name: tableName,
                    record_id: key,
                    change_type: 'DELETE',
                    summary: `حذف السجل بالمعرف: ${key} من قاعدة بيانات الآكسيس`,
                    old_data: JSON.stringify(oldRow),
                    new_data: null,
                    source: 'MS_ACCESS_SYNC'
                });
            }
        }
    }

    // Save change logs (limit batch per sync to avoid huge payload on first run)
    const logsToInsert = changeLogs.slice(0, 500); // cap initial sync log batch
    if (logsToInsert.length > 0) {
        for (const log of logsToInsert) {
            try {
                await dbRun(db, `
                    INSERT INTO audit_change_logs (table_name, record_id, change_type, summary, old_data, new_data, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [log.table_name, log.record_id, log.change_type, log.summary, log.old_data, log.new_data, log.source]);
            } catch (e) {
                // ignore duplicate log error
            }
        }
    }

    return {
        inserted: insertedCount,
        updated: updatedCount,
        deleted: deletedCount,
        total: jsonRecords.length,
        deltaList: changeLogs
    };
}

/**
 * Dynamically recreate/upsert raw tables
 */
async function upsertTableData(db, tableName, pkField, records) {
    if (!records || records.length === 0) return;

    const sample = records[0];
    const cols = Object.keys(sample);
    const createCols = cols.map(c => `"${c}" TEXT`).join(', ');

    await dbRun(db, `DROP TABLE IF EXISTS "${tableName}";`);
    await dbRun(db, `CREATE TABLE "${tableName}" (${createCols});`);

    const placeholders = cols.map(() => '?').join(', ');
    const quotedCols = cols.map(c => `"${c}"`).join(', ');
    const insertSql = `INSERT INTO "${tableName}" (${quotedCols}) VALUES (${placeholders});`;

    await dbRun(db, 'BEGIN TRANSACTION;');
    try {
        const stmt = db.prepare(insertSql);
        for (const row of records) {
            const vals = cols.map(c => {
                const val = row[c];
                if (val === null || val === undefined) return '';
                if (typeof val === 'object') return JSON.stringify(val);
                return String(val);
            });
            stmt.run(vals);
        }
        await new Promise(resolve => stmt.finalize(resolve));
        await dbRun(db, 'COMMIT;');
    } catch (err) {
        await dbRun(db, 'ROLLBACK;');
        throw err;
    }
}

/**
 * Synchronize Structured Domain Entities
 */
async function syncHighLevelDomainEntities(db) {
    console.log('[SYNC] Rebuilding Structured Domain Entities...');

    // 1. Merchants
    await dbRun(db, `
        INSERT OR REPLACE INTO merchants (
            merchant_code, name, type, contact_phone, contact_phone_2,
            address, government, bank_account, tax_card, fuel_type,
            bread_type, training, papers_date, national_id, notes, status
        )
        SELECT 
            COALESCE(bkcode, ID) AS merchant_code,
            COALESCE(Owner, Comments, 'مخبز ' || COALESCE(bkcode, ID)) AS name,
            COALESCE(bk_type, 'مخبز بلدي') AS type,
            COALESCE(telephone_1, '') AS contact_phone,
            COALESCE(telephone_2, '') AS contact_phone_2,
            COALESCE(Address, '') AS address,
            COALESCE(dep, 'القاهرة') AS government,
            COALESCE(bankacc, '') AS bank_account,
            COALESCE(Tax_Card, '') AS tax_card,
            COALESCE(fueltype, 'سولار') AS fuel_type,
            COALESCE(breadtype, 'طري') AS bread_type,
            COALESCE(training, '') AS training,
            COALESCE(papers_date, '') AS papers_date,
            COALESCE(NationalD, '') AS national_id,
            COALESCE(notes, '') AS notes,
            CASE 
                WHEN Condition LIKE '%تالف%' OR Condition LIKE '%كهنة%' OR Condition LIKE '%مغلق%' THEN 'suspended'
                ELSE 'active'
            END AS status
        FROM assets_raw
        WHERE COALESCE(bkcode, ID) IS NOT NULL AND COALESCE(bkcode, ID) != '';
    `);

    // 2. Devices (POS)
    await dbRun(db, `DELETE FROM devices;`);
    await dbRun(db, `
        INSERT INTO devices (
            id, serial, manufacturer, model, status, faulty_details, solder_bridges
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY serial) AS id,
            serial, manufacturer, model, status, faulty_details, solder_bridges
        FROM (
            SELECT 
                POS AS serial,
                COALESCE(Manufacturer, 'Verifone') AS manufacturer,
                COALESCE(Model, 'VX520') AS model,
                'in_merchant' AS status,
                '' AS faulty_details,
                '' AS solder_bridges
            FROM assets_raw
            WHERE POS IS NOT NULL AND TRIM(POS) != ''
            GROUP BY POS
            UNION
            SELECT 
                POS_2 AS serial,
                COALESCE(Manufacturer2, 'PAX') AS manufacturer,
                COALESCE(Model2, 'S90') AS model,
                'in_merchant' AS status,
                '' AS faulty_details,
                '' AS solder_bridges
            FROM assets_raw
            WHERE POS_2 IS NOT NULL AND TRIM(POS_2) != ''
            GROUP BY POS_2
            UNION
            SELECT 
                pos_3 AS serial,
                COALESCE(Manufacturer3, 'PAX') AS manufacturer,
                COALESCE(Model3, 'S90') AS model,
                'in_merchant' AS status,
                '' AS faulty_details,
                '' AS solder_bridges
            FROM assets_raw
            WHERE pos_3 IS NOT NULL AND TRIM(pos_3) != ''
            GROUP BY pos_3
            UNION
            SELECT 
                Serial AS serial,
                COALESCE(type, 'Verifone') AS manufacturer,
                COALESCE(Model, 'VX520') AS model,
                CASE 
                    WHEN LOWER(COALESCE(faulty, '')) IN ('true', '1', '-1', 'yes', 'نعم') OR pos_status LIKE '%عطل%' OR pos_status LIKE '%غير سليم%' OR pos_status LIKE '%كهنة%' OR pos_status LIKE '%تالف%' THEN 'faulty'
                    ELSE 'in_stock'
                END AS status,
                COALESCE(faulty_detils, '') AS faulty_details,
                '' AS solder_bridges
            FROM store_pos_raw
            WHERE Serial IS NOT NULL AND TRIM(Serial) != ''
            GROUP BY Serial
        );
    `);

    // 3. SIM Cards
    await dbRun(db, `DELETE FROM sim_cards;`);
    await dbRun(db, `
        INSERT INTO sim_cards (
            id, serial, carrier, status
        )
        SELECT 
            ROW_NUMBER() OVER (ORDER BY serial) AS id,
            serial, carrier, status
        FROM (
            SELECT 
                Cell_Serial AS serial,
                CASE 
                    WHEN LOWER(COALESCE(Cell_type, '')) LIKE '%voda%' OR LOWER(COALESCE(Cell_type, '')) LIKE '%فودافون%' THEN 'Vodafone'
                    WHEN LOWER(COALESCE(Cell_type, '')) LIKE '%orange%' OR LOWER(COALESCE(Cell_type, '')) LIKE '%اورنج%' OR LOWER(COALESCE(Cell_type, '')) LIKE '%أورنج%' OR LOWER(COALESCE(Cell_type, '')) LIKE '%موبينيل%' THEN 'Orange'
                    WHEN LOWER(COALESCE(Cell_type, '')) LIKE '%etisalat%' OR LOWER(COALESCE(Cell_type, '')) LIKE '%اتصالات%' OR LOWER(COALESCE(Cell_type, '')) LIKE '%e&%' THEN 'Etisalat'
                    WHEN LOWER(COALESCE(Cell_type, '')) LIKE '%we%' OR LOWER(COALESCE(Cell_type, '')) LIKE '%المصرية%' OR LOWER(COALESCE(Cell_type, '')) LIKE '%te%' THEN 'WE'
                    ELSE COALESCE(NULLIF(Cell_type, ''), 'Orange')
                END AS carrier,
                'assigned' AS status
            FROM assets_raw
            WHERE Cell_Serial IS NOT NULL AND TRIM(Cell_Serial) != ''
            GROUP BY Cell_Serial
            UNION
            SELECT 
                Cell_Serial3 AS serial,
                CASE 
                    WHEN LOWER(COALESCE(Cell_type3, '')) LIKE '%voda%' OR LOWER(COALESCE(Cell_type3, '')) LIKE '%فودافون%' THEN 'Vodafone'
                    WHEN LOWER(COALESCE(Cell_type3, '')) LIKE '%orange%' OR LOWER(COALESCE(Cell_type3, '')) LIKE '%اورنج%' OR LOWER(COALESCE(Cell_type3, '')) LIKE '%أورنج%' OR LOWER(COALESCE(Cell_type3, '')) LIKE '%موبينيل%' THEN 'Orange'
                    WHEN LOWER(COALESCE(Cell_type3, '')) LIKE '%etisalat%' OR LOWER(COALESCE(Cell_type3, '')) LIKE '%اتصالات%' OR LOWER(COALESCE(Cell_type3, '')) LIKE '%e&%' THEN 'Etisalat'
                    WHEN LOWER(COALESCE(Cell_type3, '')) LIKE '%we%' OR LOWER(COALESCE(Cell_type3, '')) LIKE '%المصرية%' OR LOWER(COALESCE(Cell_type3, '')) LIKE '%te%' THEN 'WE'
                    ELSE COALESCE(NULLIF(Cell_type3, ''), 'Orange')
                END AS carrier,
                'assigned' AS status
            FROM assets_raw
            WHERE Cell_Serial3 IS NOT NULL AND TRIM(Cell_Serial3) != ''
            GROUP BY Cell_Serial3
            UNION
            SELECT 
                sim_serial AS serial,
                CASE 
                    WHEN LOWER(COALESCE(network, sim_type, '')) LIKE '%voda%' OR LOWER(COALESCE(network, sim_type, '')) LIKE '%فودافون%' THEN 'Vodafone'
                    WHEN LOWER(COALESCE(network, sim_type, '')) LIKE '%orange%' OR LOWER(COALESCE(network, sim_type, '')) LIKE '%اورنج%' OR LOWER(COALESCE(network, sim_type, '')) LIKE '%أورنج%' OR LOWER(COALESCE(network, sim_type, '')) LIKE '%موبينيل%' THEN 'Orange'
                    WHEN LOWER(COALESCE(network, sim_type, '')) LIKE '%etisalat%' OR LOWER(COALESCE(network, sim_type, '')) LIKE '%اتصالات%' OR LOWER(COALESCE(network, sim_type, '')) LIKE '%e&%' THEN 'Etisalat'
                    WHEN LOWER(COALESCE(network, sim_type, '')) LIKE '%we%' OR LOWER(COALESCE(network, sim_type, '')) LIKE '%المصرية%' OR LOWER(COALESCE(network, sim_type, '')) LIKE '%te%' THEN 'WE'
                    ELSE COALESCE(NULLIF(network, ''), NULLIF(sim_type, ''), 'Orange')
                END AS carrier,
                CASE 
                    WHEN LOWER(COALESCE(faulty, '')) IN ('true', '1', '-1', 'yes', 'نعم') OR notes LIKE '%لا تعمل%' OR notes LIKE '%تالف%' THEN 'faulty'
                    ELSE 'in_stock'
                END AS status
            FROM store_sim_raw
            WHERE sim_serial IS NOT NULL AND TRIM(sim_serial) != ''
            GROUP BY sim_serial
        );
    `);

    // 4. Merchant Assets Mapping
    await dbRun(db, `DELETE FROM merchant_assets;`);
    await dbRun(db, `
        INSERT INTO merchant_assets (
            merchant_code, device_id, sim_card_id, slot_label, assigned_date
        )
        SELECT 
            COALESCE(a.bkcode, a.ID) AS merchant_code,
            d.id AS device_id,
            s.id AS sim_card_id,
            'Main POS' AS slot_label,
            COALESCE(a."Acquired Date", a.papers_date, datetime('now')) AS assigned_date
        FROM assets_raw a
        JOIN devices d ON d.serial = a.POS
        LEFT JOIN sim_cards s ON s.serial = a.Cell_Serial
        WHERE COALESCE(a.bkcode, a.ID) IS NOT NULL
        UNION ALL
        SELECT 
            COALESCE(a.bkcode, a.ID) AS merchant_code,
            d.id AS device_id,
            s.id AS sim_card_id,
            'Secondary POS (POS_2)' AS slot_label,
            COALESCE(a."Acquired Date", a.papers_date, datetime('now')) AS assigned_date
        FROM assets_raw a
        JOIN devices d ON d.serial = a.POS_2
        LEFT JOIN sim_cards s ON s.serial = a.Cell_Serial3
        WHERE COALESCE(a.bkcode, a.ID) IS NOT NULL AND a.POS_2 IS NOT NULL AND TRIM(a.POS_2) != '';
    `);

    // 5. Maintenance Tickets
    await dbRun(db, `DELETE FROM tickets;`);
    await dbRun(db, `
        INSERT INTO tickets (
            id, type, merchant_code, device_id, status, issue_details,
            resolution_details, technician_name, issue_date, close_date,
            hq_debt, hq_payment_ref, entry_time, selected_faults, selected_bridges
        )
        SELECT 
            ROW_NUMBER() OVER () AS id,
            type, merchant_code, device_id, status, issue_details,
            resolution_details, technician_name, issue_date, close_date,
            hq_debt, hq_payment_ref, entry_time, selected_faults, selected_bridges
        FROM (
            SELECT 
                'صيانة دورية / استلام' AS type,
                (SELECT COALESCE(bkcode, ID) FROM assets_raw WHERE POS = m."Unit Serial" LIMIT 1) AS merchant_code,
                d.id AS device_id,
                CASE 
                    WHEN m."Checked Out Date" IS NOT NULL AND m."Checked Out Date" != '' THEN 'completed'
                    ELSE 'in_progress'
                END AS status,
                COALESCE(NULLIF(m."Checked In Condition", ''), 'عطل جهاز') AS issue_details,
                COALESCE(NULLIF(m.Notes, ''), 'تم الفحص والإصلاح الفني') AS resolution_details,
                CASE 
                    WHEN UPPER(TRIM(COALESCE(m."Procedure", ''))) = 'AHMEDMAHDY' THEN 'أحمد المهدي محفوظ المهدي'
                    WHEN UPPER(TRIM(COALESCE(m."Procedure", ''))) = 'ELFAKHARANY' THEN 'أحمد فؤاد سيد الفخراني'
                    WHEN UPPER(TRIM(COALESCE(m."Procedure", ''))) = 'MESSAM' THEN 'محمد عصام محمود فرغلي'
                    WHEN UPPER(TRIM(COALESCE(m."Procedure", ''))) = 'MOSTAFA' THEN 'مصطفى محمد أبو العطا'
                    WHEN TRIM(COALESCE(m."Procedure", '')) != '' THEN TRIM(m."Procedure")
                    ELSE 'فني الصيانة'
                END AS technician_name,
                COALESCE(NULLIF(m."Checked In Date", ''), datetime('now')) AS issue_date,
                NULLIF(m."Checked Out Date", '') AS close_date,
                0 AS hq_debt,
                '' AS hq_payment_ref,
                datetime('now') AS entry_time,
                COALESCE(m."Checked In Condition", '') AS selected_faults,
                '' AS selected_bridges
            FROM maintenance_raw m
            LEFT JOIN devices d ON d.serial = m."Unit Serial"
            WHERE m.ID IS NOT NULL AND m.ID != ''
            UNION ALL
            SELECT 
                COALESCE(NULLIF(t.ActionType, ''), 'إجراء صيانة / حركة') AS type,
                COALESCE(NULLIF(t.POSN, ''), (SELECT COALESCE(bkcode, ID) FROM assets_raw WHERE POS = t.POSN LIMIT 1)) AS merchant_code,
                d.id AS device_id,
                'completed' AS status,
                COALESCE(NULLIF(t.NoteG, ''), NULLIF(t.ActionType, ''), 'شكوى عطل ماكينة') AS issue_details,
                COALESCE(NULLIF(t.NoteD, ''), 'تم الإصلاح الفني') AS resolution_details,
                CASE 
                    WHEN UPPER(TRIM(COALESCE(t."Procedure", ''))) = 'AHMEDMAHDY' THEN 'أحمد المهدي محفوظ المهدي'
                    WHEN UPPER(TRIM(COALESCE(t."Procedure", ''))) = 'ELFAKHARANY' THEN 'أحمد فؤاد سيد الفخراني'
                    WHEN UPPER(TRIM(COALESCE(t."Procedure", ''))) = 'MESSAM' THEN 'محمد عصام محمود فرغلي'
                    WHEN UPPER(TRIM(COALESCE(t."Procedure", ''))) = 'MOSTAFA' THEN 'مصطفى محمد أبو العطا'
                    WHEN TRIM(COALESCE(t."Procedure", '')) != '' AND TRIM(t."Procedure") NOT LIKE 'DESKTOP%' AND TRIM(t."Procedure") != 'SHARE' AND TRIM(t."Procedure") != '35' THEN TRIM(t."Procedure")
                    ELSE 'فني الصيانة'
                END AS technician_name,
                COALESCE(NULLIF(t.IssueDate, ''), datetime('now')) AS issue_date,
                COALESCE(NULLIF(t.ActionDate, ''), t.IssueDate) AS close_date,
                0 AS hq_debt,
                '' AS hq_payment_ref,
                datetime('now') AS entry_time,
                '' AS selected_faults,
                '' AS selected_bridges
            FROM transactions_raw t
            LEFT JOIN devices d ON d.serial = t.POSN
            WHERE t.ID IS NOT NULL AND t.ID != ''
        );
    `);

    // 6. Payments
    await dbRun(db, `
        INSERT OR REPLACE INTO payments (
            id, merchant_code, payment_date, amount, ref_num, reason, payment_place
        )
        SELECT 
            ID AS id,
            COALESCE(pos_number, payer, 'عام') AS merchant_code,
            COALESCE(payment_date, datetime('now')) AS payment_date,
            CAST(COALESCE(payment_amount, '0') AS REAL) AS amount,
            COALESCE(ref_num, '') AS ref_num,
            COALESCE(payment_reason, 'سداد مستحقات') AS reason,
            COALESCE(payment_place, 'الفرع') AS payment_place
        FROM payments_raw
        WHERE ID IS NOT NULL AND ID != '';
    `);

    // 7. Faults List
    await dbRun(db, `
        INSERT OR REPLACE INTO tblfaults (id, fault_name)
        SELECT CAST(faultid AS INTEGER), FaultName
        FROM tblfaults_raw
        WHERE faultid IS NOT NULL;
    `);

    // 8. Staff
    await dbRun(db, `
        INSERT OR REPLACE INTO tblstaff (id, name, role, can_maintain)
        SELECT CAST(id AS INTEGER), name, COALESCE(jtitle, 'موظف'), 1
        FROM tblstaff_raw
        WHERE id IS NOT NULL;
    `);

    // 9. Failure Points & Spare Parts Official Price History Engine
    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS failure_points_price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            part_name TEXT NOT NULL,
            model TEXT,
            old_price REAL NOT NULL,
            new_price REAL NOT NULL,
            change_date TEXT NOT NULL,
            effective_from TEXT NOT NULL,
            change_source TEXT DEFAULT 'ACCESS_SYNC',
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);

    // Fetch current prices from failure_points_raw
    const fpRecords = await dbAll(db, `SELECT type, model, fees, price FROM failure_points_raw WHERE type IS NOT NULL AND TRIM(type) != '';`);
    const existingParts = await dbAll(db, `SELECT part_name, price FROM spare_parts;`);
    const partPriceMap = new Map(existingParts.map(p => [p.part_name, p.price]));
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.slice(0, 10);

    for (const fp of fpRecords) {
        const partName = fp.type.trim();
        const newPrice = parseFloat(fp.price) || 0;
        const model = fp.model || 'PAX S90';

        if (partPriceMap.has(partName)) {
            const oldPrice = partPriceMap.get(partName);
            if (Math.abs(oldPrice - newPrice) > 0.001) {
                // Price has changed! Record in failure_points_price_history
                await dbRun(db, `
                    INSERT INTO failure_points_price_history (
                        part_name, model, old_price, new_price, change_date, effective_from, change_source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [partName, model, oldPrice, newPrice, todayStr, nowIso, 'ACCESS_SYNC']);

                // Record in audit change logs
                await dbRun(db, `
                    INSERT INTO audit_change_logs (table_name, record_id, change_type, old_data, new_data, summary, timestamp)
                    VALUES (?, ?, 'UPDATE', ?, ?, ?, ?)
                `, [
                    'failure_points',
                    partName,
                    JSON.stringify({ price: oldPrice }),
                    JSON.stringify({ price: newPrice }),
                    `تغيير سعر قطعة الغيار [${partName}] من ${oldPrice} جم إلى ${newPrice} جم`,
                    nowIso
                ]);
            }
        } else {
            // First time baseline entry
            await dbRun(db, `
                INSERT INTO failure_points_price_history (
                    part_name, model, old_price, new_price, change_date, effective_from, change_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [partName, model, newPrice, newPrice, '2020-01-01', '2020-01-01T00:00:00.000Z', 'INITIAL_BASELINE']);
        }

        // Upsert into spare_parts
        await dbRun(db, `
            INSERT INTO spare_parts (part_name, compatible_models, critical_limit, price, quantity_in_stock)
            VALUES (?, ?, 5, ?, 0)
            ON CONFLICT(part_name) DO UPDATE SET 
                price = excluded.price,
                compatible_models = excluded.compatible_models;
        `, [partName, JSON.stringify([model]), newPrice]);
    }

    // Insert any remaining types from store_sp_raw if not present
    await dbRun(db, `
        INSERT OR IGNORE INTO spare_parts (part_name, compatible_models, critical_limit, price, quantity_in_stock)
        SELECT 
            DISTINCT type AS part_name,
            '["PAX S90"]' AS compatible_models,
            5 AS critical_limit,
            0 AS price,
            0 AS quantity_in_stock
        FROM store_sp_raw
        WHERE type IS NOT NULL AND TRIM(type) != '';
    `);

    // Recalculate physical inventory count from store_sp_raw (Inflow minus Outflow)
    await dbRun(db, `
        UPDATE spare_parts 
        SET quantity_in_stock = COALESCE((
            SELECT SUM(CAST(COALESCE(count_in, '0') AS INTEGER)) - SUM(CAST(COALESCE(count_out, '0') AS INTEGER))
            FROM store_sp_raw
            WHERE type = spare_parts.part_name
        ), 0);
    `);
}

// Real-time Sync Progress State
let syncProgress = {
    isSyncInProgress: false,
    percent: 0,
    stage: 'جاهز',
    detail: '',
    currentTable: '',
    stepIndex: 0,
    totalSteps: 5,
    startedAt: null
};

function setProgress(percent, stage, detail = '', currentTable = '', stepIndex = 0) {
    syncProgress.percent = Math.min(100, Math.max(0, percent));
    syncProgress.stage = stage;
    syncProgress.detail = detail;
    syncProgress.currentTable = currentTable;
    syncProgress.stepIndex = stepIndex;
}

/**
 * Main Full Sync Handler
 */
async function performFullSync(db) {
    if (isSyncInProgress) {
        throw new Error('عملية المزامنة قيد التنفيذ بالفعل، يرجى الانتظار...');
    }

    isSyncInProgress = true;
    syncProgress.isSyncInProgress = true;
    syncProgress.startedAt = new Date().toISOString();
    setProgress(5, 'بدء الاتصال بقاعدة بيانات الآكسيس', 'فتح ملف BE\\Bread_Final_be.accdb وتجهيز المحرك...', '', 1);

    const startTime = Date.now();

    try {
        await initSyncDatabase(db);
        setProgress(12, 'تصدير الجداول من الآكسيس', 'تشغيل محرك VBS لاستخراج الجداول والبيانات إلى JSON...', 'Bread_Final_be.accdb', 2);

        // Step 1: Run VBS Access Extractor
        await runAccessExporter();

        // Step 2: Read exported JSON files and perform change tracking
        let totalChanges = 0;
        let tablesCount = 0;
        let totalRecords = 0;

        const tableConfigs = [
            { file: 'Assets.json', table: 'assets_raw', pk: 'ID', arabicName: 'بيانات المخابز والأجهزة (Assets)' },
            { file: 'TransAction.json', table: 'transactions_raw', pk: 'ID', arabicName: 'حركات وصيانة الماكينات (TransAction)' },
            { file: 'Maintenance.json', table: 'maintenance_raw', pk: 'ID', arabicName: 'بلاغات الصيانة (Maintenance)' },
            { file: 'payments.json', table: 'payments_raw', pk: 'ID', arabicName: 'المدفوعات والتحصيلات (Payments)' },
            { file: 'Store_POS.json', table: 'store_pos_raw', pk: 'Serial', arabicName: 'مخزن ماكينات الـ POS (Store_POS)' },
            { file: 'Store_Sim.json', table: 'store_sim_raw', pk: 'sim_serial', arabicName: 'مخزن شرائح الاتصال (Store_Sim)' },
            { file: 'Store_SP.json', table: 'store_sp_raw', pk: 'Serial', arabicName: 'مخزن قطع الغيار (Store_SP)' },
            { file: 'Store_SP_maintenance.json', table: 'store_sp_maintenance_raw', pk: 'faulty_detils', arabicName: 'قطع غيار الصيانة المركزية (Store_SP_maintenance)' },
            { file: 'tblInstallments.json', table: 'installments_raw', pk: 'ID', arabicName: 'عقود وأقساط الماكينات (tblInstallments)' },
            { file: 'tblFaults.json', table: 'tblfaults_raw', pk: 'faultid', arabicName: 'قائمة الأعطال (tblFaults)' },
            { file: 'AuthorizedUsers.json', table: 'tblstaff_raw', pk: 'id', arabicName: 'طاقم العمل والفنيين (AuthorizedUsers)' },
            { file: 'tblFixes.json', table: 'tblfixes_raw', pk: 'FixID', arabicName: 'أنواع الإصلاحات (tblFixes)' },
            { file: 'failure_points.json', table: 'failure_points_raw', pk: 'FailurePointID', arabicName: 'نقاط الأعطال (failure_points)' }
        ];

        setProgress(30, 'مقارنة وفحص التغييرات', 'بدء فحص وتتبع التغييرات ومقارنة الفروقات...', '', 3);

        let allDeltaChanges = [];

        for (let i = 0; i < tableConfigs.length; i++) {
            const cfg = tableConfigs[i];
            const currentPct = 30 + Math.round(((i + 1) / tableConfigs.length) * 45); // 30% to 75%
            setProgress(currentPct, 'مقارنة وفحص التغييرات', `فحص جدول ${cfg.arabicName} وتوليد سجلات التدقيق...`, cfg.table, 3);

            const filePath = path.join(DATA_SYNC_DIR, cfg.file);
            const records = readJsonSafely(filePath);
            if (records && Array.isArray(records)) {
                try {
                    const diffResult = await syncTableWithDiff(db, cfg.table, cfg.pk, records);
                    const changesInTable = diffResult.inserted + diffResult.updated + diffResult.deleted;
                    totalChanges += changesInTable;
                    tablesCount++;
                    totalRecords += records.length;

                    if (diffResult.deltaList && diffResult.deltaList.length > 0) {
                        allDeltaChanges.push(...diffResult.deltaList);
                    }

                    console.log(`[SYNC] ${cfg.table}: +${diffResult.inserted} ~${diffResult.updated} -${diffResult.deleted} (Total: ${diffResult.total})`);

                    if (records.length > 0) {
                        await upsertTableData(db, cfg.table, cfg.pk, records);
                    }
                } catch (e) {
                    console.error(`[SYNC ERROR] Error processing ${cfg.file}:`, e.message);
                }
            }
        }

        // Step 3: Populate high-level business domain tables
        setProgress(85, 'إعادة بناء ومطابقة الكيانات', 'تحديث وتوزيع المخابز، الماكينات، والشرائح، وبلاغات الصيانة...', 'merchants & devices', 4);
        await syncHighLevelDomainEntities(db);

        // Step 4: Incremental Cloud Delta Sync (Push delta directly to Cloud VPS in milliseconds)
        if (allDeltaChanges.length > 0) {
            setProgress(90, 'مزامنة السحابة التلقائية', `إرسال ${allDeltaChanges.length} تعديلاً فورياً إلى السيرفر السحابي...`, 'cloud_delta_sync', 4);
            await pushDeltaToCloud(allDeltaChanges);
        }

        setProgress(95, 'تحديث الإحصائيات والمؤشرات', 'إعادة حساب إحصائيات لوحة القيادة والتقارير...', 'dashboard_kpis', 5);

        const duration = Date.now() - startTime;
        lastSyncResult = {
            success: true,
            lastSyncTime: new Date().toISOString(),
            status: 'success',
            message: `تمت المزامنة بنجاح لعدد ${tablesCount} جدولاً و ${totalRecords.toLocaleString('ar-EG')} سجلاً. التغييرات المرصودة: ${totalChanges}`,
            changesDetected: totalChanges,
            tablesSynced: tablesCount,
            totalRecords: totalRecords,
            durationMs: duration
        };

        setProgress(100, 'اكتملت المزامنة بنجاح!', lastSyncResult.message, '', 5);

        // Record in sync history
        await dbRun(db, `
            INSERT INTO sync_history (status, tables_count, records_count, changes_count, duration_ms, details)
            VALUES (?, ?, ?, ?, ?, ?)
        `, ['SUCCESS', tablesCount, totalRecords, totalChanges, duration, lastSyncResult.message]);

        isSyncInProgress = false;
        syncProgress.isSyncInProgress = false;
        return lastSyncResult;
    } catch (err) {
        isSyncInProgress = false;
        syncProgress.isSyncInProgress = false;
        setProgress(100, 'فشل المزامنة', err.message, '', 5);

        const duration = Date.now() - startTime;
        lastSyncResult = {
            lastSyncTime: new Date().toISOString(),
            status: 'error',
            message: 'فشلت عملية المزامنة: ' + err.message,
            changesDetected: 0,
            tablesSynced: 0,
            totalRecords: 0,
            durationMs: duration
        };

        await dbRun(db, `
            INSERT INTO sync_history (status, tables_count, records_count, changes_count, duration_ms, details)
            VALUES (?, 0, 0, 0, ?, ?)
        `, ['ERROR', duration, err.message]).catch(() => {});

        throw err;
    }
}

async function wipeDatabase(db) {
    const allTables = [
        'assets_raw', 'transactions_raw', 'maintenance_raw', 'payments_raw',
        'store_pos_raw', 'store_sim_raw', 'store_sp_raw', 'store_sp_maintenance_raw',
        'installments_raw', 'tblfaults_raw', 'tblstaff_raw', 'tblfixes_raw', 'failure_points_raw',
        'merchants', 'devices', 'sim_cards', 'merchant_assets', 'tickets',
        'maintenance_records', 'payments', 'spare_parts', 'spare_parts_ledger',
        'tblinstallments', 'tblfaults', 'tblstaff', 'tblfixes', 'failure_points',
        'audit_change_logs', 'sync_history'
    ];

    for (const tbl of allTables) {
        try {
            await dbRun(db, `DELETE FROM "${tbl}";`);
        } catch (e) {}
    }

    try {
        await dbRun(db, `VACUUM;`);
    } catch (e) {}

    // Clear data_sync directory files
    try {
        if (fs.existsSync(DATA_SYNC_DIR)) {
            const files = fs.readdirSync(DATA_SYNC_DIR);
            for (const f of files) {
                if (f.endsWith('.json')) {
                    fs.unlinkSync(path.join(DATA_SYNC_DIR, f));
                }
            }
        }
    } catch (e) {}

    // Reset lastSyncResult
    lastSyncResult = {
        lastSyncTime: null,
        status: 'idle',
        message: 'تم تصفير وتفريغ قاعدة البيانات بالكامل بنجاح',
        changesDetected: 0,
        tablesSynced: 0,
        totalRecords: 0,
        durationMs: 0
    };

    return { success: true, message: 'تم تفريغ وتصفير قاعدة بيانات الويب بالكامل بنجاح' };
}

/**
 * Push Incremental Delta Changes to Oracle Cloud VPS in milliseconds
 */
async function pushDeltaToCloud(deltaChanges) {
    if (!deltaChanges || deltaChanges.length === 0) return;
    const config = readConfigSafely();
    if (config.isCloudServer) return; // Skip if already on cloud

    const cloudEndpoint = 'http://141.147.136.170/api/sync/delta';
    const secret = 'smartcs-cloud-secret-2026';

    console.log(`[CLOUD DELTA SYNC] Pushing ${deltaChanges.length} incremental change(s) to Oracle Cloud VPS...`);
    try {
        const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
        const response = await fetchFn(cloudEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sync-secret': secret
            },
            body: JSON.stringify({
                changes: deltaChanges,
                timestamp: new Date().toISOString()
            })
        });
        const data = await response.json();
        if (data.success) {
            console.log(`[CLOUD DELTA SYNC SUCCESS] Applied ${data.applied} change(s) in cloud database! ⚡`);
        } else {
            console.warn(`[CLOUD DELTA SYNC WARNING] Cloud response:`, data.error);
        }
    } catch (err) {
        console.warn(`[CLOUD DELTA SYNC NOTICE] Cloud sync offline/delayed: ${err.message}`);
    }
}

module.exports = {
    performFullSync,
    syncFromAccessDatabase: performFullSync,
    getSyncStatus: () => ({ ...lastSyncResult, isSyncInProgress, progress: syncProgress }),
    initSyncDatabase,
    syncHighLevelDomainEntities,
    pushDeltaToCloud,
    getAccessFilePath,
    setAccessFilePath,
    startFileWatcher,
    isAutoSyncEnabled,
    setAutoSyncEnabled,
    setOnSyncCompleteCallback,
    wipeDatabase
};
