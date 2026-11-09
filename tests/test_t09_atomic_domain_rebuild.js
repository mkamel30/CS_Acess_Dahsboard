const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { syncHighLevelDomainEntities, initSyncDatabase } = require('../sync_engine');
const { translateSqliteToPostgres } = require('../db_translator');

function initDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(':memory:', async (err) => {
            if (err) return reject(err);
            try {
                await initSyncDatabase(db);
                resolve(db);
            } catch (initErr) {
                reject(initErr);
            }
        });
    });
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

test('T-09: syncHighLevelDomainEntities preserves stable IDs for merchants, devices, and sim cards across rebuilds', async () => {
    const db = await initDb();
    try {
        // Populate raw tables
        await run(db, `
            CREATE TABLE IF NOT EXISTS assets_raw (
                bkcode TEXT, "ID" TEXT, "Owner" TEXT, "POS" TEXT, "POS_2" TEXT,
                "Cell_Serial" TEXT, "Cell_Serial3" TEXT, "Cell_type" TEXT, "Cell_type3" TEXT,
                dep TEXT, "Address" TEXT, telephone_1 TEXT, telephone_2 TEXT, "Condition" TEXT,
                notes TEXT, bk_type TEXT, "Acquired Date" TEXT, papers_date TEXT, "NationalD" TEXT
            );
        `);
        await run(db, `
            CREATE TABLE IF NOT EXISTS store_pos_raw (
                "Serial" TEXT, type TEXT, "Model" TEXT, faulty TEXT, pos_status TEXT, faulty_detils TEXT
            );
        `);
        await run(db, `
            CREATE TABLE IF NOT EXISTS store_sim_raw (
                sim_serial TEXT, network TEXT, sim_type TEXT, faulty TEXT, notes TEXT
            );
        `);
        await run(db, `
            CREATE TABLE IF NOT EXISTS maintenance_raw (
                "ID" TEXT, "Unit Serial" TEXT, "Checked In Date" TEXT, "Checked Out Date" TEXT,
                "Checked In Condition" TEXT, "Notes" TEXT, "Procedure" TEXT
            );
        `);
        await run(db, `
            CREATE TABLE IF NOT EXISTS transactions_raw (
                "ID" TEXT, "POSN" TEXT, "IssueDate" TEXT, "ActionDate" TEXT,
                "ActionType" TEXT, "NoteG" TEXT, "NoteD" TEXT, "Procedure" TEXT
            );
        `);

        // Insert initial raw record
        await run(db, `
            INSERT INTO assets_raw (bkcode, "Owner", "POS", "Cell_Serial", dep)
            VALUES ('M1001', 'Bakery Original', 'POS-9001', 'SIM-7001', 'Giza');
        `);

        // First rebuild
        await syncHighLevelDomainEntities(db);

        const m1 = await all(db, "SELECT * FROM merchants WHERE merchant_code = 'M1001';");
        const d1 = await all(db, "SELECT * FROM devices WHERE serial = 'POS-9001';");
        const s1 = await all(db, "SELECT * FROM sim_cards WHERE serial = 'SIM-7001';");

        assert.equal(m1.length, 1);
        assert.equal(d1.length, 1);
        assert.equal(s1.length, 1);

        const initialMerchantId = m1[0].id;
        const initialDeviceId = d1[0].id;
        const initialSimId = s1[0].id;

        // Update raw record and run second rebuild
        await run(db, `UPDATE assets_raw SET "Owner" = 'Bakery Renamed' WHERE bkcode = 'M1001';`);
        await syncHighLevelDomainEntities(db);

        const m2 = await all(db, "SELECT * FROM merchants WHERE merchant_code = 'M1001';");
        const d2 = await all(db, "SELECT * FROM devices WHERE serial = 'POS-9001';");
        const s2 = await all(db, "SELECT * FROM sim_cards WHERE serial = 'SIM-7001';");

        assert.equal(m2[0].name, 'Bakery Renamed', 'Name should be updated');
        assert.equal(m2[0].id, initialMerchantId, 'CRITICAL: Merchant auto-increment ID must remain STABLE');
        assert.equal(d2[0].id, initialDeviceId, 'CRITICAL: Device auto-increment ID must remain STABLE');
        assert.equal(s2[0].id, initialSimId, 'CRITICAL: SIM card auto-increment ID must remain STABLE');
    } finally {
        db.close();
    }
});

test('T-09: Atomic domain rebuild rolls back cleanly on error, leaving prior state intact without empty tables', async () => {
    const db = await initDb();
    try {
        await run(db, `
            CREATE TABLE IF NOT EXISTS assets_raw (
                bkcode TEXT, "ID" TEXT, "Owner" TEXT, "POS" TEXT, "POS_2" TEXT,
                "Cell_Serial" TEXT, "Cell_Serial3" TEXT, "Cell_type" TEXT, "Cell_type3" TEXT,
                dep TEXT, "Address" TEXT, telephone_1 TEXT, telephone_2 TEXT, "Condition" TEXT,
                notes TEXT, bk_type TEXT, "Acquired Date" TEXT, papers_date TEXT, "NationalD" TEXT
            );
        `);
        await run(db, `CREATE TABLE IF NOT EXISTS store_pos_raw ("Serial" TEXT, type TEXT, "Model" TEXT, faulty TEXT, pos_status TEXT, faulty_detils TEXT);`);
        await run(db, `CREATE TABLE IF NOT EXISTS store_sim_raw (sim_serial TEXT, network TEXT, sim_type TEXT, faulty TEXT, notes TEXT);`);
        await run(db, `CREATE TABLE IF NOT EXISTS maintenance_raw ("ID" TEXT, "Unit Serial" TEXT, "Checked In Date" TEXT, "Checked Out Date" TEXT, "Checked In Condition" TEXT, "Notes" TEXT, "Procedure" TEXT);`);
        await run(db, `CREATE TABLE IF NOT EXISTS transactions_raw ("ID" TEXT, "POSN" TEXT, "IssueDate" TEXT, "ActionDate" TEXT, "ActionType" TEXT, "NoteG" TEXT, "NoteD" TEXT, "Procedure" TEXT);`);

        await run(db, `
            INSERT INTO assets_raw (bkcode, "Owner", "POS", "Cell_Serial")
            VALUES ('M2001', 'Bakery Stable', 'POS-8888', 'SIM-9999');
        `);
        await run(db, `
            INSERT INTO maintenance_raw ("ID", "Unit Serial", "Checked In Date", "Checked In Condition")
            VALUES ('MAINT-1', 'POS-8888', '2026-01-01', 'Broken screen');
        `);

        // Successful baseline rebuild
        await syncHighLevelDomainEntities(db);
        const baselineAssets = await all(db, "SELECT * FROM merchant_assets;");
        assert.ok(baselineAssets.length > 0, 'Baseline merchant_assets should have records');

        // Add a trigger that blocks ticket insertions to simulate an unhandled failure during domain rebuild
        await run(db, "CREATE TRIGGER block_tickets BEFORE INSERT ON tickets BEGIN SELECT RAISE(FAIL, 'Simulated domain failure'); END;");

        await assert.rejects(
            async () => {
                await syncHighLevelDomainEntities(db);
            },
            /Simulated domain failure/i,
            'Rebuild must throw when a component fails'
        );

        // Verify that merchant_assets was NOT wiped/left empty (atomic rollback)
        const assetsAfterFailure = await all(db, "SELECT * FROM merchant_assets;");
        assert.equal(assetsAfterFailure.length, baselineAssets.length, 'Prior merchant_assets state must be retained via rollback');
    } finally {
        db.close();
    }
});

test('T-09: db_translator translates ON CONFLICT without duplicating clauses for Postgres', () => {
    const sqliteSql = "INSERT INTO merchants (merchant_code, name) VALUES ('M1', 'Test') ON CONFLICT(merchant_code) DO UPDATE SET name = EXCLUDED.name;";
    const { pgSql } = translateSqliteToPostgres(sqliteSql, []);
    const onConflictOccurrences = (pgSql.match(/ON CONFLICT/gi) || []).length;
    assert.equal(onConflictOccurrences, 1, 'PostgreSQL translation must have exactly one ON CONFLICT clause');
});
