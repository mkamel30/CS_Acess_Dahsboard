const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const serverPath = path.join(__dirname, '../server.js');
const serverSource = fs.readFileSync(serverPath, 'utf8');

test('T-30 / auto-debloat: retention engine, row caps, DLQ retention, and vacuum are wired in server.js', () => {
    // 1. Durable engine exists and is used by the off-peak job.
    assert.match(serverSource, /async function runDataRetentionAndVacuum\(/, 'runDataRetentionAndVacuum() must be defined');
    assert.match(serverSource, /await runDataRetentionAndVacuum\(\{ fullVacuum \}\)/, 'Off-peak setInterval must call the retention engine');

    // 2. Root-cause guard: age pruning must NOT rely on the datetime('now','-90 days') literal
    //    (db_translator only special-cases that exact string; any other window errors against TEXT
    //    columns on Postgres and is swallowed). Pruning must use a bound-parameter cutoff instead.
    assert.doesNotMatch(
        serverSource,
        /DELETE FROM \w+ WHERE \w+ < datetime\('now', ?'-\d+ days'\)/,
        'Retention DELETEs must not use the datetime(\'now\',\'-N days\') literal (silently fails on Postgres)'
    );
    assert.match(
        serverSource,
        /DELETE FROM \$\{table\} WHERE \$\{timeCol\} < \?/,
        'Age pruning must compare the timestamp column to a bound ? cutoff parameter (TEXT<TEXT on both dialects)'
    );

    // 3. Hard row cap (the true size bound regardless of volume), keyed on the id sequence.
    assert.match(serverSource, /DELETE FROM \$\{table\} WHERE id <= \?/, 'Row-cap pruning must delete by id <= (MAX(id)-cap)');
    assert.match(serverSource, /auditMaxRows:/, 'A default audit row cap must exist');

    // 4. DLQ retention (previously none) + dead-letter age column.
    assert.match(serverSource, /delta_outbox_dlq: \{ timeCol: 'archived_at' \}/, 'DLQ must be a retention target with archived_at');
    assert.match(serverSource, /dlqDays: \d+, dlqMaxRows: \d+/, 'DLQ must have a default age + cap retention policy');

    // 5. Space reclaim for both engines.
    assert.match(serverSource, /PRAGMA auto_vacuum = INCREMENTAL/, 'SQLite must enable incremental autovacuum at startup');
    assert.match(serverSource, /PRAGMA incremental_vacuum/, 'SQLite daily pass must run incremental_vacuum');
    assert.match(serverSource, /VACUUM \(ANALYZE\) \$\{t\}|VACUUM \(ANALYZE\)/, 'Postgres pass must VACUUM (ANALYZE) pruned tables');

    // 6. On-demand endpoint (admin-gated) so maintenance is testable/triggerable.
    assert.match(serverSource, /app\.post\('\/api\/diagnostics\/maintenance', requireAdmin/, 'POST /api/diagnostics/maintenance must exist and be admin-gated');
});

test('T-30 / auto-debloat: TEXT cutoff + id row-cap DELETEs prune correctly against a real SQLite store', async () => {
    const db = new sqlite3.Database(':memory:');
    const run = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this.changes); }));
    const get = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (e, r) => e ? rej(e) : res(r)));

    try {
        await run(`CREATE TABLE audit_change_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT)`);

        // Same cutoff algorithm as _cutoffText() in server.js.
        const pad2 = (n) => String(n).padStart(2, '0');
        const cutoffText = (days) => {
            const d = new Date(Date.now() - days * 864e5);
            return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
        };

        const now = Date.now();
        const fmt = (ms) => {
            const d = new Date(ms);
            return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
        };
        // 100 days old (should be pruned by 30d window) x3, recent x4.
        for (let i = 0; i < 3; i++) await run(`INSERT INTO audit_change_logs (timestamp) VALUES (?)`, [fmt(now - 100 * 864e5)]);
        for (let i = 0; i < 4; i++) await run(`INSERT INTO audit_change_logs (timestamp) VALUES (?)`, [fmt(now - 1 * 864e5)]);

        // Age prune with bound parameter (TEXT<TEXT).
        const aged = await run(`DELETE FROM audit_change_logs WHERE timestamp < ?`, [cutoffText(30)]);
        assert.equal(aged, 3, '30-day cutoff must remove exactly the 3 hundred-day-old rows via lexicographic TEXT compare');
        assert.equal((await get(`SELECT COUNT(*) c FROM audit_change_logs`)).c, 4, 'recent rows survive the age prune');

        // Row-cap prune keeps newest N by id.
        for (let i = 0; i < 6; i++) await run(`INSERT INTO audit_change_logs (timestamp) VALUES (?)`, [fmt(now)]);
        const total = (await get(`SELECT MAX(id) m, COUNT(*) c FROM audit_change_logs`));
        const cap = 5;
        await run(`DELETE FROM audit_change_logs WHERE id <= ?`, [total.m - cap]);
        const after = (await get(`SELECT COUNT(*) c, MIN(id) mn FROM audit_change_logs`));
        assert.equal(after.c, cap, `row cap of ${cap} must retain exactly ${cap} newest rows`);
        assert.ok(after.mn > 0, 'remaining rows are the highest-id (newest) ones');
    } finally {
        await new Promise((res) => db.close(res));
    }
});
