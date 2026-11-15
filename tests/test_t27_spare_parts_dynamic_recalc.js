const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { recalculateSparePartsStock, initSyncDatabase } = require('../sync_engine');

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

test('T-27: recalculateSparePartsStock accurately computes dynamic stock from store_sp_raw inflows and outflows', async () => {
    const db = await initDb();
    try {
        // Setup raw tables
        await run(db, `
            CREATE TABLE IF NOT EXISTS store_sp_raw (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT,
                Model TEXT,
                in_date TEXT,
                out_date TEXT,
                count_in TEXT,
                count_out TEXT,
                notes TEXT,
                user_name TEXT
            )
        `);

        // Populate price definition
        await run(db, `INSERT INTO failure_points_raw (type, price) VALUES ('بكرة ورق حراري', '25')`);
        await run(db, `INSERT INTO failure_points_raw (type, price) VALUES ('شاحن D210', '150')`);
        await run(db, `INSERT INTO failure_points_raw (type, price) VALUES ('بطارية S90', '200')`);

        // Populate store_sp_raw:
        // 1. 'بكرة ورق حراري': 100 in, -10 out, -5 out -> net 85
        await run(db, `INSERT INTO store_sp_raw (type, in_date, count_in, count_out) VALUES ('بكرة ورق حراري', '2026-01-01', '100', '0')`);
        await run(db, `INSERT INTO store_sp_raw (type, out_date, count_in, count_out) VALUES ('بكرة ورق حراري', '2026-01-05', '-10', '0')`);
        await run(db, `INSERT INTO store_sp_raw (type, out_date, count_in, count_out) VALUES ('بكرة ورق حراري', '2026-01-10', '-5', '0')`);

        // 2. 'شاحن D210': 10 in, -8 out (Access negative count_in) -> net 2 (Critical <= 5)
        await run(db, `INSERT INTO store_sp_raw (type, in_date, count_in, count_out) VALUES ('شاحن D210', '2026-01-02', '10', '0')`);
        await run(db, `INSERT INTO store_sp_raw (type, out_date, count_in, count_out) VALUES ('شاحن D210', '2026-01-06', '-8', '0')`);

        // 3. 'بطارية S90': 5 in, -5 out -> net 0 (Out of stock)
        await run(db, `INSERT INTO store_sp_raw (type, in_date, count_in, count_out) VALUES ('بطارية S90', '2026-01-03', '5', '0')`);
        await run(db, `INSERT INTO store_sp_raw (type, out_date, count_in, count_out) VALUES ('بطارية S90', '2026-01-07', '-5', '0')`);

        // Execute recalculation
        const result = await recalculateSparePartsStock(db);

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.total_parts, 3);
        // Total stock units: 85 + 2 + 0 = 87
        assert.strictEqual(result.total_stock_units, 87);
        // Valuation: (85 * 25) + (2 * 150) + (0 * 200) = 2125 + 300 = 2425
        assert.strictEqual(result.total_stock_valuation, 2425);
        // Critical alerts: 'شاحن D210' (2 <= 5) is critical_low, 'بطارية S90' (0 <= 0) is out_of_stock
        assert.strictEqual(result.critical_count, 1);
        assert.strictEqual(result.out_of_stock_count, 1);

        // Verify spare_parts table records in SQLite
        const parts = await all(db, `SELECT part_name, quantity_in_stock, price, critical_limit FROM spare_parts ORDER BY part_name ASC`);
        assert.strictEqual(parts.length, 3);

        const paperRoll = parts.find(p => p.part_name === 'بكرة ورق حراري');
        assert.strictEqual(paperRoll.quantity_in_stock, 85);
        assert.strictEqual(paperRoll.price, 25);

        const charger = parts.find(p => p.part_name === 'شاحن D210');
        assert.strictEqual(charger.quantity_in_stock, 2);
        assert.strictEqual(charger.price, 150);

        const battery = parts.find(p => p.part_name === 'بطارية S90');
        assert.strictEqual(battery.quantity_in_stock, 0);
        assert.strictEqual(battery.price, 200);
    } finally {
        await new Promise(r => db.close(r));
    }
});

test('T-27: recalculateSparePartsStock on real branch_database.db completes and preserves accurate stock', async () => {
    const dbPath = path.join(__dirname, '../branch_database.db');
    const db = new sqlite3.Database(dbPath);

    try {
        const result = await recalculateSparePartsStock(db);
        assert.strictEqual(result.success, true);
        assert.ok(result.total_parts >= 28, 'Should have at least 28 spare parts from real Access data');
        assert.strictEqual(result.total_stock_units, 550, 'Net warehouse stock across store_sp_raw is exactly 550 pieces');
        assert.ok(result.total_stock_valuation > 0, 'Total stock valuation should be positive');
        assert.ok(result.recalculated_at !== undefined);
    } finally {
        await new Promise(r => db.close(r));
    }
});
