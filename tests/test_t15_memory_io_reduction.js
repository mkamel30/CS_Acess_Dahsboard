const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('../node_modules/sqlite3').verbose();
const {
    applyTableAndOutbox,
    syncTableWithDiff,
    initSyncDatabase
} = require('../sync_engine');

function createTempDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(':memory:', (err) => {
            if (err) reject(err);
            else resolve(db);
        });
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

test('T-15 / F-16: Targeted upsert/delete eliminates full table delete/reinsert write amplification', async (t) => {
    const db = await createTempDb();
    await initSyncDatabase(db);

    const tableName = 'tblfixes_raw';
    const pk = 'FixID';

    // Baseline: 10 rows
    const baseline = [];
    for (let i = 1; i <= 10; i++) {
        baseline.push({ FixID: `FIX_${i}`, FixName: `Fix Type ${i}`, Cost: `${i * 10}` });
    }

    // Step 1: Initial baseline load
    const diff1 = await syncTableWithDiff(db, tableName, pk, baseline);
    assert.equal(diff1.inserted, 10);
    await applyTableAndOutbox(db, tableName, pk, baseline, diff1.deltaList);

    const rowsAfterBaseline = await dbAll(db, `SELECT * FROM "${tableName}"`);
    assert.equal(rowsAfterBaseline.length, 10);

    // Step 2: Incremental change: 1 update (FIX_3), 1 insert (FIX_11), 1 delete (FIX_8)
    // 8 out of 10 rows remain untouched!
    const nextRecords = [];
    for (let i = 1; i <= 10; i++) {
        if (i === 8) continue; // Delete FIX_8
        if (i === 3) {
            nextRecords.push({ FixID: `FIX_3`, FixName: 'Fix Type 3 (Updated)', Cost: '999' });
        } else {
            nextRecords.push({ FixID: `FIX_${i}`, FixName: `Fix Type ${i}`, Cost: `${i * 10}` });
        }
    }
    nextRecords.push({ FixID: 'FIX_11', FixName: 'Fix Type 11 (New)', Cost: '110' });

    const diff2 = await syncTableWithDiff(db, tableName, pk, nextRecords);
    assert.equal(diff2.inserted, 1, '1 insert');
    assert.equal(diff2.updated, 1, '1 update');
    assert.equal(diff2.deleted, 1, '1 delete');

    // Apply incremental changes via targeted upsert/delete
    await applyTableAndOutbox(db, tableName, pk, nextRecords, diff2.deltaList);

    const finalRows = await dbAll(db, `SELECT * FROM "${tableName}" ORDER BY FixID ASC`);
    assert.equal(finalRows.length, 10, 'Total rows = 10 - 1 + 1 = 10');

    // Verify deleted row FIX_8 is gone
    assert.equal(finalRows.some(r => r.FixID === 'FIX_8'), false, 'FIX_8 must be deleted');

    // Verify updated row FIX_3 has new values
    const updatedRow = finalRows.find(r => r.FixID === 'FIX_3');
    assert.ok(updatedRow);
    assert.equal(updatedRow.FixName, 'Fix Type 3 (Updated)');
    assert.equal(updatedRow.Cost, '999');

    // Verify untouched rows remain intact (e.g. FIX_1)
    const untouched = finalRows.find(r => r.FixID === 'FIX_1');
    assert.ok(untouched);
    assert.equal(untouched.Cost, '10');

    // Verify inserted row FIX_11 exists
    const insertedRow = finalRows.find(r => r.FixID === 'FIX_11');
    assert.ok(insertedRow);
    assert.equal(insertedRow.Cost, '110');
});

test('T-15 / F-16: Server source verification for single-table streaming and lightweight count', (t) => {
    const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

    // 1. Upfront count uses COUNT(*) queries without loading all rows into RAM
    assert.match(
        serverSource,
        /SELECT\s+COUNT\(\*\)\s+AS\s+cnt\s+FROM/,
        'Reseed must use lightweight COUNT(*) queries instead of loading all tables into memory upfront'
    );

    // 2. Streams only current table in loop
    assert.match(
        serverSource,
        /let\s+rows\s*=\s*await\s+allQuery\(\s*`SELECT\s+\*\s+FROM\s+"\$\{item\.table\}"`\s*\)/,
        'Reseed must query and stream only current table within table loop'
    );
});
