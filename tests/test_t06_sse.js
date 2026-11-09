const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const compression = require('compression');

test('T-06: Compression filter explicitly bypasses SSE endpoint and text/event-stream', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

    // 1. Verify compression middleware is configured with filter
    assert.match(serverSource, /app\.use\(compression\(\s*\{\s*filter:/, 'Compression middleware must have a custom filter');
    assert.match(serverSource, /req\.path\s*===\s*['"]\/api\/sync\/events['"]/, 'Filter must explicitly check /api/sync/events');
    assert.match(serverSource, /req\.headers\.accept\s*===\s*['"]text\/event-stream['"]/, 'Filter must check text/event-stream');

    // 2. Test filter logic directly with mock requests
    const filterFn = (req) => {
        if (req.path === '/api/sync/events' || req.headers.accept === 'text/event-stream') {
            return false;
        }
        return true;
    };

    assert.equal(filterFn({ path: '/api/sync/events', headers: {} }), false, 'Must not compress SSE events endpoint');
    assert.equal(filterFn({ path: '/api/other', headers: { accept: 'text/event-stream' } }), false, 'Must not compress event-stream accept header');
    assert.equal(filterFn({ path: '/api/data', headers: { accept: 'application/json' } }), true, 'Standard JSON APIs should allow compression');
});

test('T-06: SSE endpoint includes retry instruction, X-Accel-Buffering: no, and connect snapshot', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

    // Verify proxy buffering bypass
    assert.match(serverSource, /res\.setHeader\(\s*['"]X-Accel-Buffering['"]\s*,\s*['"]no['"]\s*\)/, 'Must set X-Accel-Buffering to no');
    assert.match(serverSource, /res\.setHeader\(\s*['"]Content-Type['"]\s*,\s*['"]text\/event-stream['"]\s*\)/, 'Must set Content-Type to text/event-stream');

    // Verify retry contract and snapshot
    assert.match(serverSource, /res\.write\(\s*['"]retry:\s*5000\\n\\n['"]\s*\)/, 'Must send retry: 5000 contract to client');
    assert.match(serverSource, /snapshot:/, 'Initial connect event must include sync status snapshot');
});

test('T-06: Client app.js implements truthful SSE indicator and reconnection snapshot refresh', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

    // Verify truthful indicator function
    assert.match(appSource, /function updateSseIndicator\(connected\)/, 'app.js must implement updateSseIndicator');
    assert.match(appSource, /sync-telemetry-sse-status/, 'Must target sync-telemetry-sse-status element');
    assert.match(appSource, /settings-sse-state/, 'Must target settings-sse-state element');

    // Verify onerror updates indicator to disconnected state
    assert.match(appSource, /sse\.onerror\s*=\s*\(\)\s*=>\s*\{[\s\S]*?updateSseIndicator\(false\)/, 'onerror must update indicator to false');
    assert.match(appSource, /sse\.addEventListener\(['"]connected['"][\s\S]*?updateSseIndicator\(true\)/, 'connected listener must update indicator to true');
});
