const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('../node_modules/sqlite3').verbose();
const {
    areValuesEqual,
    enrichRecordsWithSyncKey,
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

test('T-12 / F-17: Typed equality preserves NULL and normalizes numbers, dates, and booleans', (t) => {
    // 1. NULL preservation
    assert.equal(areValuesEqual(null, null), true, 'null === null');
    assert.equal(areValuesEqual(undefined, undefined), true, 'undefined === undefined');
    assert.equal(areValuesEqual(null, undefined), true, 'null === undefined');
    assert.equal(areValuesEqual(null, ''), false, 'null !== empty string');
    assert.equal(areValuesEqual('', null), false, 'empty string !== null');
    assert.equal(areValuesEqual(null, '0'), false, 'null !== 0 string');

    // 2. Numeric normalization (avoids false diffs across SQLite and Access)
    assert.equal(areValuesEqual(10, '10.0'), true, '10 === 10.0');
    assert.equal(areValuesEqual('25.50', 25.5), true, '25.50 === 25.5');
    assert.equal(areValuesEqual('0', 0), true, '"0" === 0');
    assert.equal(areValuesEqual(10, 11), false, '10 !== 11');

    // 3. Date normalization
    assert.equal(
        areValuesEqual('2026-05-01T00:00:00.000Z', '2026-05-01 00:00:00 GMT'),
        true,
        'ISO date === GMT representation'
    );
    assert.equal(
        areValuesEqual('2026-05-01', '2026-05-02'),
        false,
        'Different dates must not be equal'
    );

    // 4. Boolean normalization (Access -1 / true)
    assert.equal(areValuesEqual('True', true), true, '"True" === true');
    assert.equal(areValuesEqual('-1', true), true, '-1 === true in Access');
    assert.equal(areValuesEqual('0', false), true, '0 === false');
    assert.equal(areValuesEqual(true, false), false, 'true !== false');

    // 5. String trimming
    assert.equal(areValuesEqual('Cairo ', 'Cairo'), true, 'trailing whitespace trimmed');
    assert.equal(areValuesEqual('Alex', 'Cairo'), false, 'different strings not equal');
});

test('T-12 / F-18: Stable duplicate identity across export orders', (t) => {
    const rawBatch1 = [
        { Serial: 'S1', type: 'ROLLER', in_date: '2026-01-01', count_in: '5', notes: 'First batch' },
        { Serial: 'S1', type: 'ROLLER', in_date: '2026-01-01', count_in: '5', notes: 'First batch' }
    ];

    const rawBatch2 = [
        { Serial: 'S1', type: 'ROLLER', in_date: '2026-01-01', count_in: '5', notes: 'First batch' },
        { Serial: 'S1', type: 'ROLLER', in_date: '2026-01-01', count_in: '5', notes: 'First batch' }
    ];

    const enriched1 = enrichRecordsWithSyncKey('store_sp_raw', rawBatch1);
    const enriched2 = enrichRecordsWithSyncKey('store_sp_raw', rawBatch2);

    assert.ok(enriched1[0].sync_key, 'Must generate sync_key');
    assert.ok(enriched1[1].sync_key, 'Must generate sync_key');
    assert.notEqual(enriched1[0].sync_key, enriched1[1].sync_key, 'Duplicates must have distinct sync keys');

    // Export order stability
    assert.equal(enriched1[0].sync_key, enriched2[0].sync_key, 'Key 0 is identical across runs');
    assert.equal(enriched1[1].sync_key, enriched2[1].sync_key, 'Key 1 is identical across runs');
});

test('T-12 / F-17 Integration: syncTableWithDiff does not trigger false updates on numeric or date formatting', async (t) => {
    const db = await createTempDb();
    await initSyncDatabase(db);

    const tableName = 'tblfixes_raw';
    const pk = 'FixID';

    // Baseline: price is stored as string '100'
    const baseline = [
        { FixID: 'FIX1', FixName: 'Screen Replacement', Cost: '100' }
    ];
    const diff1 = await syncTableWithDiff(db, tableName, pk, baseline);
    assert.equal(diff1.inserted, 1);
    await applyTableAndOutbox(db, tableName, pk, baseline, diff1.deltaList);

    // New sync: Cost comes as number 100 or '100.0'
    const nextSync = [
        { FixID: 'FIX1', FixName: 'Screen Replacement', Cost: 100 }
    ];
    const diff2 = await syncTableWithDiff(db, tableName, pk, nextSync);
    assert.equal(diff2.updated, 0, 'Must NOT trigger false update on numeric representation');

    // New sync with genuine change
    const genuineChange = [
        { FixID: 'FIX1', FixName: 'Screen Replacement', Cost: 150 }
    ];
    const diff3 = await syncTableWithDiff(db, tableName, pk, genuineChange);
    assert.equal(diff3.updated, 1, 'Genuine change from 100 to 150 must trigger UPDATE');
});
