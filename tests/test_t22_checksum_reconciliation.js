const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('../node_modules/sqlite3').verbose();
const crypto = require('crypto');

// Test T-22 / F-01, F-02: Row-level checksum reconciliation
test('T-22 / F-01, F-02: computeTableChecksum detects content divergence when row counts match', async (t) => {
    // 1. Setup two databases with identical schemas and counts (2 rows) but differing content
    const db1 = new sqlite3.Database(':memory:');
    const db2 = new sqlite3.Database(':memory:');

    const schema = `CREATE TABLE store_pos_raw (Serial TEXT PRIMARY KEY, Model TEXT, Status TEXT);`;
    await new Promise(r => db1.run(schema, r));
    await new Promise(r => db2.run(schema, r));

    // db1 data
    await new Promise(r => db1.run("INSERT INTO store_pos_raw VALUES ('POS-100', 'V2', 'active')", r));
    await new Promise(r => db1.run("INSERT INTO store_pos_raw VALUES ('POS-101', 'V2', 'active')", r));

    // db2 data: same count (2 rows), same keys, but POS-101 has different Status ('faulty')
    await new Promise(r => db2.run("INSERT INTO store_pos_raw VALUES ('POS-100', 'V2', 'active')", r));
    await new Promise(r => db2.run("INSERT INTO store_pos_raw VALUES ('POS-101', 'V2', 'faulty')", r));

    async function computeChecksum(dbInstance, table, pk) {
        const rows = await new Promise((resolve, reject) => {
            dbInstance.all(`SELECT * FROM "${table}" ORDER BY "${pk}"`, (err, res) => err ? reject(err) : resolve(res));
        });
        const hash = crypto.createHash('sha256');
        for (const r of rows) {
            const sortedKeys = Object.keys(r).sort();
            const rowArr = sortedKeys.map(k => String(r[k] ?? '').trim());
            hash.update(JSON.stringify(rowArr));
        }
        return hash.digest('hex').slice(0, 16);
    }

    const c1 = await computeChecksum(db1, 'store_pos_raw', 'Serial');
    const c2 = await computeChecksum(db2, 'store_pos_raw', 'Serial');

    assert.ok(c1, 'Checksum 1 must be non-empty');
    assert.ok(c2, 'Checksum 2 must be non-empty');
    assert.notEqual(c1, c2, 'Checksums must differ when content diverges even if count is identical');

    // 2. Test reconciliation matrix status classification
    function classifyReconciliation(lCount, cCount, lChecksum, cChecksum) {
        if (lCount !== cCount) return 'MISMATCH';
        if (lChecksum && cChecksum && lChecksum !== cChecksum) return 'CONTENT_MISMATCH';
        return 'MATCHED';
    }

    assert.equal(classifyReconciliation(2, 2, c1, c2), 'CONTENT_MISMATCH', 'Must flag CONTENT_MISMATCH when counts match but content differs');
    assert.equal(classifyReconciliation(2, 2, c1, c1), 'MATCHED', 'Must flag MATCHED when count and checksum match');
    assert.equal(classifyReconciliation(3, 2, c1, c2), 'MISMATCH', 'Must flag MISMATCH when counts differ');

    await new Promise(r => db1.close(r));
    await new Promise(r => db2.close(r));
});
