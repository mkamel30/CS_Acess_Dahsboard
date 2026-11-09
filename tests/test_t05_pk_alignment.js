const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { getRowIdentifier, RAW_TABLE_PK_MAP } = require('../sync_engine.js');

const DATA_SYNC_DIR = path.join(__dirname, '..', 'data_sync');

function readJsonClean(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw.replace(/^\uFEFF/, '').trim());
}

test('T-05 / F-03: store_sim_raw resolves 178/178 SIM identifiers from Store_Sim.json', () => {
    const filePath = path.join(DATA_SYNC_DIR, 'Store_Sim.json');
    assert.ok(fs.existsSync(filePath), 'Store_Sim.json must exist');
    const records = readJsonClean(filePath);

    assert.equal(records.length, 178, 'Expected Store_Sim.json to contain 178 records');

    const validIdentifiers = records.filter(r => {
        const id = getRowIdentifier('store_sim_raw', 'sim_serial', r);
        return id && id.trim().length > 0;
    });

    assert.equal(validIdentifiers.length, 178, 'All 178 SIM records must have non-empty identifiers');

    // Verify first 10 match exact sim_serial property
    records.slice(0, 10).forEach(r => {
        const id = getRowIdentifier('store_sim_raw', 'sim_serial', r);
        assert.equal(id, String(r.sim_serial).trim(), 'Identifier must match sim_serial');
    });
});

test('T-05 / F-14: store_pos_raw resolves 207/207 POS identifiers from Store_POS.json', () => {
    const filePath = path.join(DATA_SYNC_DIR, 'Store_POS.json');
    assert.ok(fs.existsSync(filePath), 'Store_POS.json must exist');
    const records = readJsonClean(filePath);

    assert.equal(records.length, 207, 'Expected Store_POS.json to contain 207 records');

    const validIdentifiers = records.filter(r => {
        const id = getRowIdentifier('store_pos_raw', 'Serial', r);
        return id && id.trim().length > 0;
    });

    assert.equal(validIdentifiers.length, 207, 'All 207 POS records must have non-empty identifiers');

    // Verify first 10 match exact Serial property
    records.slice(0, 10).forEach(r => {
        const id = getRowIdentifier('store_pos_raw', 'Serial', r);
        assert.equal(id, String(r.Serial).trim(), 'Identifier must match Serial');
    });
});

test('T-05: RAW_TABLE_PK_MAP canonical alignment in sync_engine and server.js', () => {
    assert.equal(RAW_TABLE_PK_MAP['store_sim_raw'], 'sim_serial', 'store_sim_raw PK must be sim_serial');
    assert.equal(RAW_TABLE_PK_MAP['store_pos_raw'], 'Serial', 'store_pos_raw PK must be Serial');

    // Static verification of server.js parity
    const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(serverCode.includes("syncEngine.RAW_TABLE_PK_MAP"), 'server.js must inherit RAW_TABLE_PK_MAP from sync_engine.js');
    assert.ok(serverCode.includes("'store_sim_raw': 'sim_serial'"), "server.js fallback must specify 'sim_serial'");
    assert.ok(serverCode.includes("'store_pos_raw': 'Serial'"), "server.js fallback must specify 'Serial'");
});

test('T-05 Contract: All expected tables in data_sync produce 100% non-empty identifiers', () => {
    const manifest = [
        { file: 'Assets.json', table: 'assets_raw', pk: 'ID' },
        { file: 'TransAction.json', table: 'transactions_raw', pk: 'ID' },
        { file: 'Maintenance.json', table: 'maintenance_raw', pk: 'ID' },
        { file: 'payments.json', table: 'payments_raw', pk: 'ID' },
        { file: 'Store_POS.json', table: 'store_pos_raw', pk: 'Serial' },
        { file: 'Store_Sim.json', table: 'store_sim_raw', pk: 'sim_serial' },
        { file: 'Store_SP.json', table: 'store_sp_raw', pk: 'sync_key' },
        { file: 'Store_SP_maintenance.json', table: 'store_sp_maintenance_raw', pk: 'sync_key' },
        { file: 'tblInstallments.json', table: 'installments_raw', pk: 'ID' },
        { file: 'tblFaults.json', table: 'tblfaults_raw', pk: 'faultid' },
        { file: 'AuthorizedUsers.json', table: 'tblstaff_raw', pk: 'id' },
        { file: 'tblFixes.json', table: 'tblfixes_raw', pk: 'FixID' },
        { file: 'Trade.json', table: 'trade_raw', pk: 'ID' }
    ];

    manifest.forEach(item => {
        const filePath = path.join(DATA_SYNC_DIR, item.file);
        if (fs.existsSync(filePath)) {
            const records = readJsonClean(filePath);
            if (records.length > 0) {
                const validCount = records.filter(r => {
                    const id = getRowIdentifier(item.table, item.pk, r);
                    return id && id.trim().length > 0;
                }).length;
                assert.equal(validCount, records.length, `Table ${item.table} (${item.file}) must have 100% valid identifiers. Got ${validCount}/${records.length}`);
            }
        }
    });
});
