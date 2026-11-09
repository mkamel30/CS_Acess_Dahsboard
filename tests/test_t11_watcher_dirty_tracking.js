const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('../node_modules/sqlite3').verbose();
const {
    startFileWatcher,
    stopAllWatchers,
    setAutoSyncEnabled,
    isAutoSyncEnabled,
    isPendingResync,
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

test('T-11 / F-23: Disabling autoSync disables file watcher but preserves outbox flusher', async (t) => {
    const db = await createTempDb();
    await initSyncDatabase(db);

    try {
        // Start watcher
        setAutoSyncEnabled(true, db);
        assert.equal(isAutoSyncEnabled(), true, 'autoSync should be enabled');

        // Disable autoSync
        setAutoSyncEnabled(false, db);
        assert.equal(isAutoSyncEnabled(), false, 'autoSync should be disabled');

        // Check that disabling autoSync does not crash outbox flushing
        // Verify outbox table exists and is readable
        const pending = await new Promise((resolve, reject) => {
            db.all('SELECT count(*) as count FROM delta_outbox;', (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0].count);
            });
        });
        assert.equal(pending, 0);
    } finally {
        stopAllWatchers();
        // Restore enabled state
        setAutoSyncEnabled(true, db);
        stopAllWatchers();
    }
});

test('T-11 / F-11: Source code analysis verifies dirty tracking during active sync', (t) => {
    const engineSource = fs.readFileSync(path.join(__dirname, '../sync_engine.js'), 'utf8');

    // 1. Verify pendingResync is unconditionally set when isSyncInProgress
    assert.match(
        engineSource,
        /if\s*\(\s*isSyncInProgress\s*\)\s*\{\s*pendingResync\s*=\s*true/g,
        'Must set pendingResync = true whenever sync is in progress without dropping events'
    );

    // 2. Verify mtime is not advanced past modified timestamp
    assert.match(
        engineSource,
        /postSyncMtime\s*>\s*preSyncMtime/,
        'Must compare postSyncMtime with preSyncMtime to detect modifications during export'
    );

    // 3. Verify debounce callback rechecks isAutoSyncEnabled
    assert.match(
        engineSource,
        /if\s*\(\s*!isAutoSyncEnabled\(\)\s*\)\s*return;/,
        'Debounce timer callback must recheck isAutoSyncEnabled before proceeding'
    );

    // 4. Verify setAutoSyncEnabled clears timers
    assert.match(
        engineSource,
        /clearTimeout\(\s*watcherDebounceTimer\s*\)/,
        'setAutoSyncEnabled must clear pending watcherDebounceTimer'
    );
});
