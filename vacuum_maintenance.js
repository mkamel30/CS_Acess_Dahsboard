/**
 * SmartCS DB Maintenance — measure + VACUUM (non-destructive).
 * Run ON the server host (Share) with the server STOPPED (stop_smartcs.bat).
 *   node vacuum_maintenance.js            -> measure only (read-only, safe)
 *   node vacuum_maintenance.js --run      -> checkpoint WAL + VACUUM + integrity check
 * VACUUM rebuilds the file and reclaims free pages; it deletes NO data.
 */
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');

const args = process.argv.slice(2);
const RUN = args.includes('--run');
const dbArg = args.find(a => !a.startsWith('--'));
const DB_PATH = dbArg ? path.resolve(dbArg) : path.join(__dirname, 'branch_database.db');

const MB = b => (b / 1048576).toFixed(1);
const get = (db, sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const all = (db, sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));

function fileSize(p) { try { return fs.statSync(p).size; } catch (e) { return 0; } }

async function measure(db, label) {
    const ps = (await get(db, 'PRAGMA page_size')).page_size;
    const pc = (await get(db, 'PRAGMA page_count')).page_count;
    const fl = (await get(db, 'PRAGMA freelist_count')).freelist_count;
    const total = pc * ps, free = fl * ps;
    const mainB = fileSize(DB_PATH), walB = fileSize(DB_PATH + '-wal'), shmB = fileSize(DB_PATH + '-shm');
    console.log(`\n===== ${label} =====`);
    console.log(`ملف القاعدة الرئيسي : ${MB(mainB)} MB`);
    console.log(`ملف WAL             : ${MB(walB)} MB`);
    console.log(`page_size=${ps}  page_count=${pc}  freelist_count=${fl}`);
    console.log(`الحجم المنطقي الكلي : ${MB(total)} MB  |  صفحات حرة (قابلة للاستعادة): ${MB(free)} MB  |  مستخدم: ${MB(total - free)} MB`);
    return { mainB, walB, total, free, used: total - free };
}

async function tableSizes(db) {
    const tables = ['audit_change_logs', 'delta_outbox', 'delta_outbox_dlq', 'sync_history',
        'tickets', 'transactions_raw', 'assets_raw', 'maintenance_raw', 'payments_raw', 'store_sp_raw'];
    console.log('\n--- تقدير حجم محتوى الجداول (بايت، بدون فهارس/صفحات) ---');
    for (const t of tables) {
        try {
            const cols = await all(db, `PRAGMA table_info("${t}")`);
            if (!cols.length) { console.log(`${t.padEnd(22)} (غير موجود)`); continue; }
            const expr = cols.map(c => `COALESCE(length(CAST("${c.name}" AS BLOB)),0)`).join('+');
            const r = await get(db, `SELECT COUNT(*) AS rows, COALESCE(SUM(${expr}),0) AS bytes FROM "${t}"`);
            console.log(`${t.padEnd(22)} rows=${String(r.rows).padStart(8)}  content≈${MB(r.bytes)} MB`);
        } catch (e) { console.log(`${t.padEnd(22)} خطأ: ${e.message}`); }
    }
}

(async () => {
    console.log('SmartCS DB Maintenance');
    console.log('DB:', DB_PATH);
    if (!fs.existsSync(DB_PATH)) { console.error('القاعدة غير موجودة بهذا المسار.'); process.exit(1); }
    console.log('الوضع:', RUN ? 'تنفيذ VACUUM (--run)' : 'قياس فقط (قراءة فقط)');

    const mode = RUN ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY;
    const db = new sqlite3.Database(DB_PATH, mode, err => { if (err) { console.error('فشل فتح القاعدة:', err.message); process.exit(1); } });

    try {
        if (RUN) {
            // Exclusive-access probe: abort if the server (or another writer) is still connected.
            try { await run(db, 'BEGIN IMMEDIATE'); await run(db, 'ROLLBACK'); }
            catch (e) {
                console.error('\n[!] القاعدة مقفولة — يبدو أن السيرفر ما زال يعمل أو هناك اتصال آخر.');
                console.error('    أوقف السيرفر أولاً عبر stop_smartcs.bat ثم أعد التشغيل.');
                console.error('    التفاصيل:', e.message);
                db.close(); process.exit(2);
            }
        }

        const before = await measure(db, 'قبل');
        await tableSizes(db);

        if (!RUN) {
            console.log('\nهذا قياس فقط ولم يتم تعديل أي شيء.');
            console.log('للتنفيذ: أوقف السيرفر (stop_smartcs.bat) ثم شغّل:  node vacuum_maintenance.js --run');
            db.close(); return;
        }

        console.log('\n[*] دمج ملف WAL وتقليصه قبل البدء (wal_checkpoint TRUNCATE)...');
        const ck0 = await get(db, 'PRAGMA wal_checkpoint(TRUNCATE)');
        console.log('    checkpoint (قبل):', JSON.stringify(ck0));

        console.log('[*] تنفيذ VACUUM (إعادة بناء الملف واستعادة الصفحات الحرة — بدون حذف بيانات)...');
        const t0 = Date.now();
        await run(db, 'VACUUM');
        console.log(`    تم VACUUM في ${((Date.now() - t0) / 1000).toFixed(1)} ثانية.`);

        // VACUUM in WAL mode writes the whole rebuilt DB into the WAL; without a
        // checkpoint afterwards the WAL stays as large as the database itself.
        console.log('[*] دمج ملف WAL وتقليصه بعد VACUUM (wal_checkpoint TRUNCATE)...');
        const ck1 = await get(db, 'PRAGMA wal_checkpoint(TRUNCATE)');
        console.log('    checkpoint (بعد):', JSON.stringify(ck1));

        console.log('[*] فحص السلامة (quick_check)...');
        const ic = await get(db, 'PRAGMA quick_check');
        const ok = ic && (ic.quick_check === 'ok');
        console.log('    النتيجة:', ok ? 'ok ✅' : JSON.stringify(ic));

        const after = await measure(db, 'بعد');
        console.log('\n===== الحصيلة =====');
        console.log(`الملف الرئيسي : ${MB(before.mainB)} MB  ->  ${MB(after.mainB)} MB`);
        console.log(`WAL           : ${MB(before.walB)} MB  ->  ${MB(after.walB)} MB`);
        const reclaimed = (before.mainB + before.walB) - (after.mainB + after.walB);
        console.log(`المستعاد فعلياً (رئيسي+WAL): ${MB(reclaimed)} MB`);
        if (after.walB > 50 * 1048576) console.log('[!] تنبيه: ما زال WAL كبيراً بعد checkpoint — راجع الاتصالات قبل إعادة التشغيل.');
        if (!ok) console.log('\n[!] فحص السلامة لم يرجع ok — لا تعد تشغيل السيرفر قبل المراجعة.');
        else console.log('\nتم بنجاح. يمكنك إعادة تشغيل السيرفر الآن (run_smartcs.bat).');
        db.close();
    } catch (e) {
        console.error('\n[!] خطأ:', e.message);
        if (/locked|busy/i.test(e.message)) console.error('    القاعدة مقفولة — تأكد من إيقاف السيرفر بالكامل ثم أعد المحاولة.');
        try { db.close(); } catch (_) {}
        process.exit(1);
    }
})();