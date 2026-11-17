/**
 * T-35: Delta must not adopt the source's volatile surrogate `id` when the row is keyed
 * by the stable natural key (sync_key). Forcing Share's Access-autonumber id into the VPS
 * PRIMARY KEY(id) can collide with a DIFFERENT row's id -> HTTP 422 -> whole batch to DLQ
 * -> chronic "counts match but content mismatches" drift.
 *  - both cloud upsert paths (bulk tablesData + incremental changes) compute matchedPk first
 *    and strip `id` from the write columns when matchedPk is a natural key (not id)
 *  - the reconciliation canonical projection excludes `id` for sync_key tables so legitimate
 *    replica-side id divergence is not misreported as CONTENT_MISMATCH
 */
const fs = require('fs');
const path = require('path');

let pass = true;
const check = (name, cond) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} - ${name}`); if (!cond) pass = false; };

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// matchedPk is now resolved BEFORE the column list is built, in both cloud paths (2 occurrences)
check('matchedPk precomputed before column build (both paths)',
    (server.match(/if \(appCfg\.isCloudServer\) matchedPk = await getPgValidConstraintCol/g) || []).length === 2);

// the volatile-id strip guard exists in both the bulk (rowKeys) and change (keys) paths
check('bulk path strips id when keyed by natural key',
    /let rowKeys = rawRowKeys;[\s\S]{0,220}?matchedPk\.toLowerCase\(\) !== 'id'[\s\S]{0,120}?rawRowKeys\.some\(k => k\.toLowerCase\(\) === 'id'\)[\s\S]{0,120}?rowKeys = rawRowKeys\.filter\(k => k\.toLowerCase\(\) !== 'id'\)/.test(server));
check('delta-change path strips id when keyed by natural key',
    /let keys = rawValidKeys;[\s\S]{0,220}?matchedPk\.toLowerCase\(\) !== 'id'[\s\S]{0,120}?rawValidKeys\.some\(k => k\.toLowerCase\(\) === 'id'\)[\s\S]{0,120}?keys = rawValidKeys\.filter\(k => k\.toLowerCase\(\) !== 'id'\)/.test(server));

// id-keyed tables (matchedPk === id) must NOT be stripped -> guard requires !== 'id'
check('guard keeps id for id-keyed tables (matchedPk !== id)',
    (server.match(/matchedPk\.toLowerCase\(\) !== 'id'/g) || []).length === 2);

// reconciliation projection excludes id for sync_key tables
check('reconciliation excludes id for sync_key tables',
    /RAW_TABLE_PK_MAP\[item\.table\] === 'sync_key'[\s\S]{0,140}?localCols\[item\.table\]\.filter\(c => c\.toLowerCase\(\) !== 'id'\)/.test(server));

console.log(pass ? '\nT-35: ALL CHECKS PASSED' : '\nT-35: FAILURES PRESENT');
process.exit(pass ? 0 : 1);
