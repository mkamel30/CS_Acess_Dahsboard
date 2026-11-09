const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('../node_modules/sqlite3').verbose();
const {
    validateExportManifest,
    syncTableWithDiff,
    applyTableAndOutbox,
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

test('T-10 / F-12: Export Manifest Validator enforces all-or-nothing integrity', (t) => {
    const tempDir = path.join(__dirname, 'temp_manifest_test');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    try {
        // Prepare dummy files
        fs.writeFileSync(path.join(tempDir, 'Assets.json'), JSON.stringify([{ id: 1 }, { id: 2 }]));
        fs.writeFileSync(path.join(tempDir, 'Maintenance.json'), JSON.stringify([{ id: 10 }]));

        // 1. Valid manifest
        const validManifest = {
            success: true,
            sourcePath: 'dummy.accdb',
            tables: {
                Assets: { file: 'Assets.json', status: 'OK', rowCount: 2, isEmpty: false },
                Maintenance: { file: 'Maintenance.json', status: 'OK', rowCount: 1, isEmpty: false }
            }
        };
        const res = validateExportManifest(validManifest, ['Assets.json', 'Maintenance.json'], tempDir);
        assert.equal(res.valid, true);

        // 2. Manifest reporting overall failure throws
        assert.throws(() => {
            validateExportManifest({ ...validManifest, success: false }, ['Assets.json', 'Maintenance.json'], tempDir);
        }, /reports failure/);

        // 3. Manifest with one table marked FAILED throws
        assert.throws(() => {
            const badTableManifest = {
                success: true,
                tables: {
                    Assets: { file: 'Assets.json', status: 'FAILED', rowCount: 0, error: 'Locked file' },
                    Maintenance: { file: 'Maintenance.json', status: 'OK', rowCount: 1 }
                }
            };
            validateExportManifest(badTableManifest, ['Assets.json', 'Maintenance.json'], tempDir);
        }, /indicates table 'Assets' failed/);

        // 4. Row count mismatch throws
        assert.throws(() => {
            const mismatchManifest = {
                success: true,
                tables: {
                    Assets: { file: 'Assets.json', status: 'OK', rowCount: 999, isEmpty: false },
                    Maintenance: { file: 'Maintenance.json', status: 'OK', rowCount: 1 }
                }
            };
            validateExportManifest(mismatchManifest, ['Assets.json', 'Maintenance.json'], tempDir);
        }, /row count mismatch/);

        // 5. Corrupted JSON file throws
        fs.writeFileSync(path.join(tempDir, 'Corrupt.json'), 'not valid json {{{');
        assert.throws(() => {
            const corruptManifest = {
                success: true,
                tables: {
                    Corrupt: { file: 'Corrupt.json', status: 'OK', rowCount: 1 }
                }
            };
            validateExportManifest(corruptManifest, ['Corrupt.json'], tempDir);
        }, /invalid JSON array/);

        // 6. Missing table in manifest throws
        assert.throws(() => {
            validateExportManifest(validManifest, ['MissingTable.json'], tempDir);
        }, /missing entry for table 'MissingTable'/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('T-10 / F-13: Legitimate empty table propagates deletions to local replica and outbox', async (t) => {
    const db = await createTempDb();
    await initSyncDatabase(db);

    const tableName = 'tblfaults_raw';
    const pk = 'faultid';

    // Step 1: Baseline populated with 3 records
    const initialRecords = [
        { faultid: 'F1', fault_name: 'Printer issue' },
        { faultid: 'F2', fault_name: 'Network timeout' },
        { faultid: 'F3', fault_name: 'Screen broken' }
    ];

    const diff1 = await syncTableWithDiff(db, tableName, pk, initialRecords);
    assert.equal(diff1.inserted, 3);
    assert.equal(diff1.deleted, 0);
    await applyTableAndOutbox(db, tableName, pk, initialRecords, diff1.deltaList);

    // Verify baseline in SQLite
    const baselineRows = await dbAll(db, `SELECT * FROM "${tableName}"`);
    assert.equal(baselineRows.length, 3);

    // Clear outbox to test new deletions cleanly
    await dbAll(db, `DELETE FROM delta_outbox;`);

    // Step 2: Now Access table is emptied (0 records, empty array)
    const emptyRecords = [];
    const diff2 = await syncTableWithDiff(db, tableName, pk, emptyRecords);

    // Assert that deletion detection was NOT skipped
    assert.equal(diff2.deleted, 3, 'All 3 previous rows must be detected as deleted');
    assert.equal(diff2.inserted, 0);
    assert.equal(diff2.updated, 0);
    assert.equal(diff2.deltaList.length, 3, '3 DELETE delta records generated');

    // Apply empty records
    await applyTableAndOutbox(db, tableName, pk, emptyRecords, diff2.deltaList);

    // Verify local SQLite raw table is now empty
    const remainingRows = await dbAll(db, `SELECT * FROM "${tableName}"`);
    assert.equal(remainingRows.length, 0, 'Local replica table must be empty after source table was emptied');

    // Verify outbox received the DELETE deltas to propagate to the cloud
    const outboxRows = await dbAll(db, `SELECT * FROM delta_outbox`);
    assert.equal(outboxRows.length, 1);
    const payload = JSON.parse(outboxRows[0].payload);
    assert.equal(payload.length, 3);
    assert.equal(payload.every(c => c.change_type === 'DELETE'), true, 'All outbox records must be DELETE type');
    assert.deepEqual(payload.map(c => c.record_id).sort(), ['F1', 'F2', 'F3']);
});
