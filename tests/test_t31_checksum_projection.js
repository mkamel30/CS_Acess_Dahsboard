const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');

const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

test('T-31 / checksum: canonical column projection is threaded Share->VPS', () => {
    // Checksum accepts an explicit column list and hashes exactly those columns in order.
    assert.match(serverSource, /async function computeTableChecksum\(table, pk, canonicalCols\)/, 'computeTableChecksum must accept canonicalCols');
    assert.match(serverSource, /SELECT \$\{cols\.map/, 'must build a SELECT of only the canonical columns when supplied');
    assert.match(serverSource, /\(cols \|\| Object\.keys\(r\)\.sort\(\)\)\.map\(k => norm\(r\[k\]\)\)/, 'row hashing must use the canonical column order when projected');

    // Reconciliation derives Share columns and sends them to the cloud.
    assert.match(serverSource, /const localCols = \{\};/, 'reconciliation must build a localCols map');
    assert.match(serverSource, /localCols\[item\.table\] = \(info \|\| \[\]\)\.map\(c => c\.name\)/, 'localCols must come from PRAGMA table_info');
    assert.match(serverSource, /await computeTableChecksum\(item\.table, pk, localCols\[item\.table\]\)/, 'local checksum must use the canonical columns');
    assert.match(serverSource, /\+ '\?cols=' \+ encodeURIComponent\(JSON\.stringify\(localCols\)\)/, 'reconciliation must pass the column map to the cloud');

    // Cloud endpoint consumes the column map.
    assert.match(serverSource, /colMap = JSON\.parse\(req\.query\.cols\)/, 'table-counts must parse the cols query param');
    assert.match(serverSource, /computeTableChecksum\(item\.table, pk, colMap && colMap\[item\.table\]\)/, 'cloud checksum must honor the passed columns');
});

test('T-31 / checksum: replica-only columns (orphan NULL + serial id) no longer diverge under projection', async () => {
    // Mirror of the server hashing algorithm.
    const norm = (val) => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'number') return String(val);
        if (val instanceof Date) return val.toISOString();
        return String(val).trim();
    };
    const hashRows = (rows, cols) => {
        const hash = crypto.createHash('sha256');
        for (const r of rows) {
            const keys = cols || Object.keys(r).sort();
            hash.update(JSON.stringify(keys.map(k => norm(r[k]))));
        }
        return hash.digest('hex').slice(0, 16);
    };

    const db = new sqlite3.Database(':memory:');
    const all = (sql) => new Promise((res, rej) => db.all(sql, (e, r) => e ? rej(e) : res(r)));
    const run = (sql) => new Promise((res, rej) => db.run(sql, (e) => e ? rej(e) : res()));
    try {
        // Share side: only the two business columns.
        await run(`CREATE TABLE share_t (faultid TEXT, "FaultName" TEXT)`);
        await run(`INSERT INTO share_t VALUES ('1','الاتصال'), ('2','الشاشة')`);
        // VPS replica: same business data PLUS an orphan all-NULL column and a serial id.
        await run(`CREATE TABLE vps_t (id INTEGER PRIMARY KEY AUTOINCREMENT, faultid TEXT, "FaultName" TEXT, legacy_desc TEXT)`);
        await run(`INSERT INTO vps_t (faultid, "FaultName") VALUES ('1','الاتصال'), ('2','الشاشة')`);

        const shareRows = await all(`SELECT * FROM share_t ORDER BY faultid`);
        const vpsStar = await all(`SELECT * FROM vps_t ORDER BY faultid`);
        const canonical = ['faultid', 'FaultName'];
        const vpsProjected = await all(`SELECT ${canonical.map(c => `"${c}"`).join(', ')} FROM vps_t ORDER BY faultid`);

        // Baseline bug: SELECT * on the replica diverges from Share.
        assert.notEqual(hashRows(shareRows), hashRows(vpsStar), 'SELECT * must diverge when replica has extra columns (the original false alarm)');
        // Fix: canonical projection makes them identical.
        assert.equal(hashRows(shareRows, canonical), hashRows(vpsProjected, canonical), 'canonical projection must match despite replica-only columns');
    } finally {
        await new Promise((res) => db.close(res));
    }
});
