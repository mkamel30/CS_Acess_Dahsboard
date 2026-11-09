const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('T-14 / F-15: Static contract inspection for async 202 jobs, AbortSignal timeouts, and byte chunk caps', (t) => {
    const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

    // 1. /api/sync/run returns 202 Accepted
    assert.match(
        serverSource,
        /res\.status\(202\)\.json\(\s*\{[\s\S]*status:\s*'accepted'[\s\S]*status_url:\s*'\/api\/sync\/status'/m,
        'app.post(/api/sync/run) must return HTTP 202 with status_url'
    );

    // 2. /api/diagnostics/reseed-vps returns 202 Accepted
    assert.match(
        serverSource,
        /res\.status\(202\)\.json\(\s*\{[\s\S]*status:\s*'accepted'[\s\S]*status_url:\s*'\/api\/diagnostics\/reseed-status'/m,
        'app.post(/api/diagnostics/reseed-vps) must return HTTP 202 with status_url'
    );

    // 3. AbortSignal timeouts used in reseed fetch calls
    assert.match(
        serverSource,
        /AbortSignal\.timeout\(30000\)/,
        'Reseed outgoing fetch calls must specify AbortSignal timeout to prevent proxy-ceiling hangs'
    );

    // 4. Byte-size chunk cap implemented
    assert.match(
        serverSource,
        /MAX_CHUNK_BYTES\s*=\s*2\s*\*\s*1024\s*\*\s*1024/,
        'Reseed must enforce MAX_CHUNK_BYTES cap (2MB) alongside row count caps'
    );

    // 5. Client app.js handles 202 Accepted and continues polling/SSE
    assert.match(
        appSource,
        /res\.status\s*===\s*202\s*\|\|\s*data\.status\s*===\s*'accepted'/,
        'app.js triggerFullCloudReseed must detect 202/accepted and let SSE/polling drive modal'
    );
});
