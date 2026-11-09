const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readConfigSafely } = require('../sync_engine');

test('T-17 / F-22: Config caching prevents per-query disk reads', (t) => {
    // Call readConfigSafely multiple times
    const cfg1 = readConfigSafely();
    const cfg2 = readConfigSafely();

    // Verify object reference equality (cached in memory)
    assert.equal(cfg1, cfg2, 'Subsequent calls must return cached config object');
});

test('T-17 / F-22: Server source verification for pool hygiene, idle timeouts, and client pinning', (t) => {
    const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

    // 1. idle_in_transaction_session_timeout configured
    assert.match(
        serverSource,
        /idle_in_transaction_session_timeout:\s*15000/,
        'pgPool must configure idle_in_transaction_session_timeout to prevent leaked locks'
    );

    // 2. Client pinning for transactions
    assert.match(
        serverSource,
        /async function withPgTransaction/,
        'Must provide withPgTransaction to pin client during multi-statement operations'
    );
    assert.match(
        serverSource,
        /await client\.query\('BEGIN'\)[\s\S]*await client\.query\('COMMIT'\)[\s\S]*client\.release\(\)/,
        'withPgTransaction must strictly pin client and release in finally block'
    );

    // 3. Pool metrics function and diagnostics endpoint
    assert.match(
        serverSource,
        /function getPoolMetrics\(\)/,
        'Must implement getPoolMetrics exposing totalCount, idleCount, waitingCount'
    );
    assert.match(
        serverSource,
        /app\.get\('\/api\/diagnostics\/pool-metrics'/,
        'Must expose /api/diagnostics/pool-metrics endpoint'
    );
});
