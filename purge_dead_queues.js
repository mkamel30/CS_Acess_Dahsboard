/**
 * SmartCS Dead-Queue Purge — preview + safe delete + VACUUM (destructive, gated).
 * Run ON the server host (Share) with the server STOPPED (stop_smartcs.bat).
 *   node purge_dead_queues.js          -> preview only (read-only) + VPS reconciliation gate
 *   node purge_dead_queues.js --run    -> gate check + Y/N + DELETE by explicit IDs + VACUUM
 *   node purge_dead_queues.js --run --force  -> skip the VPS gate (NOT recommended)
 *
 * Purges delta_outbox + delta_outbox_dlq (dead bug-era sync payloads). These are
 * bookkeeping queues, NOT business data. Safety gate: refuses to delete unless the
 * VPS already holds the current business rows (i.e. reseed done), so no unpushed
 * data is lost. audit_change_logs is left to its own 90-day retention.
 */
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const sqlite3 = require('sqlite3');

const args = process.argv.slice(2);
const RUN = args.includes('--run');
const FORCE = args.includes('--force');
const dbArg = args.find(a => !a.startsWith('--'));
const DB_PATH = dbArg ? path.resolve(dbArg) : path.join(__dirname, 'branch_database.db');
const VPS_COUNTS_URL = 'https://smartcs.m-kamel.workers.dev/api/diagnostics/table-counts';

// Tables whose row counts must be reconciled on the VPS before purging unpushed deltas.
const GATE_TABLES = ['transactions_raw', 'payments_raw', 'store_sp_raw', 'temp_transfer_raw',
    'assets_raw', 'maintenance_raw', 'store_sp_maintenance_raw', 'installments_raw',
    'tblfaults_raw', 'tblstaff_raw', 'tblfixes_raw', 'failure_points_raw', 'trade_raw'];

const MB = b => (b / 1048576).toFixed(1);
const get = (db, sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const all = (db, sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
function fileSize(p) { try { return fs.statSync(p).size; } catch (e) { return 0; } }

async function queuePreview(db, table, timeCol) {
    const cnt = await get(db, `SELECT COUNT(*) c, COALESCE(SUM(length(CAST(payload AS BLOB))),0) bytes, MIN(id) mn, MAX(id) mx, MIN(${timeCol}) oldest, MAX(${timeCol}) newest FROM "${table}"`);
    console.log(`\n--- ${table} ---`);
    console.log(`  rows=${cnt.c}  payload≈${MB(cnt.bytes)} MB  id range=[${cnt.mn}..${cnt.mx}]`);
    console.log(`  ${timeCol}: oldest=${cnt.oldest}  newest=${cnt.newest}`);
    const ids = (await all(db, `SELECT id FROM "${table}" ORDER BY id`)).map(r => r.id);
    return { count: cnt.c, bytes: cnt.bytes, ids };
}

async function vpsGate(db) {
    console.log('\n=== بوابة الأمان: هل الـVPS يملك البيانات الحالية؟ (reseed) ===');
    let vps;
    try {
        const r = await fetch(VPS_COUNTS_URL, { signal: AbortSignal.timeout(20000) });
        vps = await r.json();
    } catch (e) {
        console.log(`  [!] تعذّر الوصول للـVPS: ${e.message}`);
        return { pass: false, reason: 'VPS unreachable' };
    }
    if (!vps || !vps.counts) { console.log('  [!] استجابة VPS غير صالحة.'); return { pass: false, reason: 'bad VPS response' }; }
    let allOk = true;
    for (const t of GATE_TABLES) {
        const local = (await get(db, `SELECT COUNT(*) c FROM "${t}"`)).c;
        const cloud = parseInt(vps.counts[t] ?? '-1', 10);
        const ok = cloud >= local;
        if (!ok) allOk = false;
        console.log(`  ${t.padEnd(26)} local=${String(local).padStart(7)}  vps=${String(cloud).padStart(7)}  ${ok ? 'OK' : 'BEHIND ✗'}`);
    }
    return { pass: allOk, reason: allOk ? 'reconciled' : 'VPS behind local — run reseed first' };
}

function askYN(q) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim().toLowerCase()); }));
}

(async () => {
    console.log('SmartCS Dead-Queue Purge');
    console.log('DB:', DB_PATH);
    if (!fs.existsSync(DB_PATH)) { console.error('القاعدة غير موجودة بهذا المسار.'); process.exit(1); }
    console.log('الوضع:', RUN ? 'تنفيذ الحذف (--run)' : 'معاينة فقط (قراءة فقط)');

    const mode = RUN ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY;
    const db = new sqlite3.Database(DB_PATH, mode, err => { if (err) { console.error('فشل فتح القاعدة:', err.message); process.exit(1); } });

    try {
        if (RUN) {
            try { await run(db, 'BEGIN IMMEDIATE'); await run(db, 'ROLLBACK'); }
            catch (e) {
                console.error('\n[!] القاعدة مقفولة — يبدو أن السيرفر ما زال يعمل. أوقفه عبر stop_smartcs.bat أولاً.');
                console.error('    التفاصيل:', e.message);
                db.close(); process.exit(2);
            }
        }

        const beforeMain = fileSize(DB_PATH), beforeWal = fileSize(DB_PATH + '-wal');
        console.log(`\nقبل: main=${MB(beforeMain)} MB  wal=${MB(beforeWal)} MB`);
        const ob = await queuePreview(db, 'delta_outbox', 'created_at');
        const dlq = await queuePreview(db, 'delta_outbox_dlq', 'archived_at');
        const totalRows = ob.count + dlq.count, totalBytes = ob.bytes + dlq.bytes;
        console.log(`\nالإجمالي المرشّح للحذف: ${totalRows} صفاً  ≈${MB(totalBytes)} MB (outbox ${ob.count} + DLQ ${dlq.count})`);

        const gate = await vpsGate(db);
        if (!gate.pass) {
            console.log(`\n[✗] بوابة الأمان لم تنجح: ${gate.reason}`);
            console.log('    لا يُنصح بالحذف قبل إعادة البذر (reseed) حتى لا تفقد بيانات لم تصل للـVPS.');
            if (!(RUN && FORCE)) {
                console.log('    شغّل reseed أولاً ثم أعد المحاولة. (تجاوز البوابة: --run --force — غير موصى به)');
                db.close(); process.exit(3);
            }
            console.log('    [!] --force: تم تجاوز بوابة الأمان بطلب صريح.');
        } else {
            console.log('\n[✓] بوابة الأمان نجحت: الـVPS يملك كل الصفوف الحالية — الحذف آمن (لا فقدان بيانات).');
        }

        if (!RUN) {
            console.log('\nهذه معاينة فقط ولم يُحذف أي شيء.');
            console.log('للتنفيذ: أوقف السيرفر (stop_smartcs.bat) ثم شغّل:  node purge_dead_queues.js --run');
            db.close(); return;
        }

        const ans = await askYN(`\nهل تريد حذف ${totalRows} صفاً (≈${MB(totalBytes)} MB) من outbox/DLQ نهائياً؟ (Y/N): `);
        if (ans !== 'y' && ans !== 'yes') { console.log('أُلغي. لم يُحذف أي شيء.'); db.close(); return; }

        console.log('\n[*] الحذف بـIDs صريحة داخل معاملة مع فحص الأعداد...');
        await run(db, 'BEGIN IMMEDIATE');
        try {
            let deleted = 0;
            for (const [table, q] of [['delta_outbox', ob], ['delta_outbox_dlq', dlq]]) {
                if (q.ids.length === 0) { console.log(`  ${table}: لا صفوف.`); continue; }
                const before = (await get(db, `SELECT COUNT(*) c FROM "${table}"`)).c;
                const ph = q.ids.map(() => '?').join(',');
                const r = await run(db, `DELETE FROM "${table}" WHERE id IN (${ph})`, q.ids);
                const after = (await get(db, `SELECT COUNT(*) c FROM "${table}"`)).c;
                const removed = before - after;
                console.log(`  ${table}: before=${before} deleted=${r.changes} after=${after} (expected ${q.ids.length})`);
                if (r.changes !== q.ids.length || removed !== q.ids.length || after !== before - q.ids.length) {
                    throw new Error(`count mismatch on ${table}: changes=${r.changes} expected=${q.ids.length}`);
                }
                deleted += removed;
            }
            await run(db, 'COMMIT');
            console.log(`  تم حذف ${deleted} صفاً بنجاح (فحص الأعداد مطابق).`);
        } catch (e) {
            await run(db, 'ROLLBACK').catch(() => {});
            throw new Error('فشل الحذف — تم التراجع (ROLLBACK): ' + e.message);
        }

        console.log('[*] دمج WAL وتقليصه (wal_checkpoint TRUNCATE)...');
        console.log('    checkpoint (قبل):', JSON.stringify(await get(db, 'PRAGMA wal_checkpoint(TRUNCATE)')));
        console.log('[*] تنفيذ VACUUM...');
        const t0 = Date.now();
        await run(db, 'VACUUM');
        console.log(`    تم VACUUM في ${((Date.now() - t0) / 1000).toFixed(1)} ثانية.`);
        console.log('[*] دمج WAL بعد VACUUM (wal_checkpoint TRUNCATE)...');
        console.log('    checkpoint (بعد):', JSON.stringify(await get(db, 'PRAGMA wal_checkpoint(TRUNCATE)')));
        const ic = await get(db, 'PRAGMA quick_check');
        const ok = ic && (ic.quick_check === 'ok');
        console.log('[*] quick_check:', ok ? 'ok ✅' : JSON.stringify(ic));

        const afterMain = fileSize(DB_PATH), afterWal = fileSize(DB_PATH + '-wal');
        console.log('\n===== الحصيلة =====');
        console.log(`main : ${MB(beforeMain)} MB -> ${MB(afterMain)} MB`);
        console.log(`wal  : ${MB(beforeWal)} MB -> ${MB(afterWal)} MB`);
        console.log(`المستعاد فعلياً (main+wal): ${MB((beforeMain + beforeWal) - (afterMain + afterWal))} MB`);
        const obAfter = (await get(db, 'SELECT COUNT(*) c FROM delta_outbox')).c;
        const dlqAfter = (await get(db, 'SELECT COUNT(*) c FROM delta_outbox_dlq')).c;
        console.log(`المتبقي: outbox=${obAfter}  DLQ=${dlqAfter}`);
        if (!ok) console.log('\n[!] quick_check لم يرجع ok — لا تعد تشغيل السيرفر قبل المراجعة.');
        else console.log('\nتم بنجاح. يمكنك إعادة تشغيل السيرفر الآن (run_smartcs.bat).');
        db.close();
    } catch (e) {
        console.error('\n[!] خطأ:', e.message);
        if (/locked|busy/i.test(e.message)) console.error('    القاعدة مقفولة — تأكد من إيقاف السيرفر بالكامل ثم أعد المحاولة.');
        try { db.close(); } catch (_) {}
        process.exit(1);
    }
})();