const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ALLOWED_SYNC_TABLES,
    isAllowedSyncTable,
    isValidSqlIdentifier,
    escapeSqlIdentifier
} = require('../sync_engine.js');

test('T-02: Table Whitelist allows only authorized replica tables', () => {
    // Authorized raw tables must pass
    const authorized = [
        'assets_raw', 'transactions_raw', 'maintenance_raw', 'payments_raw',
        'store_pos_raw', 'store_sim_raw', 'store_sp_raw', 'store_sp_maintenance_raw',
        'installments_raw', 'tblfaults_raw', 'tblstaff_raw', 'tblfixes_raw',
        'failure_points_raw', 'trade_raw', 'temp_transfer_raw', 'audit_change_logs', 'sync_history'
    ];

    authorized.forEach(t => {
        assert.ok(isAllowedSyncTable(t), `Table ${t} must be allowed`);
        assert.ok(isAllowedSyncTable(t.toUpperCase()), `Table ${t.toUpperCase()} must be allowed (case-insensitive)`);
    });

    // Unknown or internal tables must be rejected
    const forbidden = [
        'users', 'admin_users', 'config', 'sqlite_master', 'pg_class',
        'system_settings', 'system_error_logs', 'delta_outbox', 'random_table', ''
    ];

    forbidden.forEach(t => {
        assert.ok(!isAllowedSyncTable(t), `Table '${t}' must be rejected`);
    });

    // SQL Injection in table names must be rejected
    const maliciousTables = [
        'assets_raw; DROP TABLE users; --',
        'store_pos_raw" OR "1"="1',
        'store_sim_raw\' OR \'1\'=\'1',
        'assets_raw/*comment*/',
        'assets_raw\0hidden'
    ];

    maliciousTables.forEach(t => {
        assert.ok(!isAllowedSyncTable(t), `Malicious table '${t}' must be rejected`);
    });
});

test('T-02: SQL Column Identifier Validator accepts valid Access names and rejects injection', () => {
    // Valid column names (including Access names with spaces and hyphens)
    const validCols = [
        'ID', 'bkcode', 'Serial', 'sim_serial', 'Acquired Date', 'cell_2-ser',
        'Model2', 'telephone_1', 'Checked In Date', 'faulty_detils', 'FixID'
    ];

    validCols.forEach(col => {
        assert.ok(isValidSqlIdentifier(col), `Column '${col}' should be valid`);
        const escaped = escapeSqlIdentifier(col);
        assert.equal(escaped, `"${col}"`, `Escaped output must be wrapped in double-quotes`);
    });

    // Dangerous identifiers attempting SQL breakout
    const injectionCols = [
        'col"; DROP TABLE assets_raw; --',
        'col"; SELECT * FROM users; --',
        'col\' OR 1=1 --',
        'col`',
        'col/*inline comment*/',
        'col\0nullbyte',
        'col\nnewline',
        'col\rreturn',
        'col;--'
    ];

    injectionCols.forEach(col => {
        assert.ok(!isValidSqlIdentifier(col), `Injection pattern '${col}' must be flagged invalid`);
        assert.throws(() => escapeSqlIdentifier(col), /Rejected invalid SQL identifier/, `escapeSqlIdentifier must throw on '${col}'`);
    });

    // Empty or excessive length identifiers
    assert.ok(!isValidSqlIdentifier(''), 'Empty string must be invalid');
    assert.ok(!isValidSqlIdentifier(null), 'Null must be invalid');
    assert.ok(!isValidSqlIdentifier('a'.repeat(65)), 'Identifier > 64 chars must be invalid');
});

test('T-02: Full-Seed payload validation contract', () => {
    // Verify simulated full-seed table validation logic
    function validateSeedPayload(payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return { valid: false, error: 'Invalid payload' };
        }
        for (const tbl of Object.keys(payload)) {
            if (!isAllowedSyncTable(tbl)) {
                return { valid: false, error: `Table '${tbl}' is not permitted for full-seed` };
            }
            const rows = payload[tbl];
            if (Array.isArray(rows) && rows.length > 0) {
                const cols = Object.keys(rows[0]);
                for (const c of cols) {
                    if (!isValidSqlIdentifier(c)) {
                        return { valid: false, error: `Invalid column name '${c}' in table '${tbl}'` };
                    }
                }
            }
        }
        return { valid: true };
    }

    // Legitimate payload
    const goodPayload = {
        'store_pos_raw': [{ 'Serial': 'POS001', 'Model': 'PAX S90' }],
        'store_sim_raw': [{ 'sim_serial': '89201234', 'network': 'Vodafone' }]
    };
    assert.deepEqual(validateSeedPayload(goodPayload), { valid: true });

    // Unauthorized table in full-seed
    const badTablePayload = {
        'users': [{ 'id': 1, 'username': 'admin' }]
    };
    assert.equal(validateSeedPayload(badTablePayload).valid, false);

    // SQL Injection in column name
    const badColPayload = {
        'assets_raw': [{ 'id': 1, 'notes"; DROP TABLE assets_raw; --': 'val' }]
    };
    assert.equal(validateSeedPayload(badColPayload).valid, false);
});
