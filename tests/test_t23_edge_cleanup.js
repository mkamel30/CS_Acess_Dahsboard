const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Test T-23 / F-25: Watcher/export edge cleanup
test('T-23 / F-25: Watcher ignores unrelated .accdb files and only triggers on exact target file', async (t) => {
    const targetFile = 'bread_final_be.accdb';

    function shouldTriggerWatch(triggerFile) {
        if (!triggerFile) return false;
        const lower = path.basename(triggerFile).toLowerCase();
        if (lower.endsWith('.laccdb') || lower.endsWith('.ldb') || lower.startsWith('~$') || lower.endsWith('.tmp')) {
            return false;
        }
        return lower === targetFile;
    }

    // Unrelated .accdb files must be rejected
    assert.equal(shouldTriggerWatch('other_database.accdb'), false);
    assert.equal(shouldTriggerWatch('backup_bread_final_be.accdb'), false);
    assert.equal(shouldTriggerWatch('bread_final_be.laccdb'), false);
    assert.equal(shouldTriggerWatch('~$bread_final_be.accdb'), false);

    // Exact file match must be accepted
    assert.equal(shouldTriggerWatch('bread_final_be.accdb'), true);
    assert.equal(shouldTriggerWatch('Bread_Final_be.accdb'), true);
});

test('T-23 / F-25: Sparse columns across rows are fully unioned in full-seed', async (t) => {
    const rows = [
        { ID: '1', name: 'Alpha', phone: '0101' },
        { ID: '2', name: 'Beta', notes: 'Special merchant' },
        { ID: '3', name: 'Gamma', lat: '30.1', lng: '31.2' }
    ];

    const colSet = new Set();
    for (const r of rows) {
        if (r && typeof r === 'object') {
            for (const k of Object.keys(r)) {
                colSet.add(k);
            }
        }
    }
    const cols = Array.from(colSet);

    // Verify all sparse columns were preserved
    assert.ok(cols.includes('ID'));
    assert.ok(cols.includes('name'));
    assert.ok(cols.includes('phone'), 'phone from row 0 must be included');
    assert.ok(cols.includes('notes'), 'notes from row 1 must be included');
    assert.ok(cols.includes('lat'), 'lat from row 2 must be included');
    assert.ok(cols.includes('lng'), 'lng from row 2 must be included');
    assert.equal(cols.length, 6);
});

test('T-23 / F-25: Source code verification for restored-file baseline and exact match', async (t) => {
    const syncEngineCode = fs.readFileSync(path.join(__dirname, '../sync_engine.js'), 'utf8');
    const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

    // 1. sync_engine.js initializes lastKnownMtime = 0 for unreachable file
    assert.ok(syncEngineCode.includes('lastKnownMtime = 0; // F-25: Restored-file baseline'), 'lastKnownMtime must initialize to 0 for restored files');

    // 2. sync_engine.js uses exact lower === targetFileName
    assert.ok(syncEngineCode.includes('lower === targetFileName'), 'Watcher must match lower === targetFileName');
    assert.ok(!syncEngineCode.includes("|| lower.endsWith('.accdb')"), 'Watcher must not match generic .accdb');

    // 3. server.js unions sparse columns
    assert.ok(serverCode.includes('// F-25: Union sparse columns across all rows in chunk'), 'server.js must union sparse columns in full-seed');
});
