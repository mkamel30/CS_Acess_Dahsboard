/**
 * T-33: Static-server path-traversal/encoding hardening + 4xx log-noise + pragma TVF translation
 *  - blocker must inspect the DECODED path (defeat %2E bypass) and cover WAL/SHM sidecar + sqlite3
 *  - global error handler must NOT log client 4xx (415/416/400) as ERROR
 *  - db_translator must map SQLite pragma_table_info('t') TVF to information_schema (Postgres)
 */
const fs = require('fs');
const path = require('path');
const { translateSqliteToPostgres } = require('../db_translator');

let pass = true;
const check = (name, cond) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} - ${name}`); if (!cond) pass = false; };

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// --- Blocker hardening ---
check('blocker decodes req.path (decodeURIComponent)',
    /Block access to database[\s\S]{0,500}?decodeURIComponent\(/.test(server));
check('blocker covers WAL/SHM/journal sidecar files',
    /\\\.db-\(wal\|shm\|journal\|hot-journal\)\$/.test(server));
check('blocker covers .sqlite3 variants', /\\\.sqlite\(\\d\+\)\?\$/.test(server));

// Simulate the matcher the middleware uses against the real probe set.
const SENSITIVE = [/\.db$/, /\.db-(wal|shm|journal|hot-journal)$/, /\.sqlite(\d+)?$/, /\.env/,
    /(^|\/)config\.json$/, /(^|\/)package(-lock)?\.json$/, /(^|\/)\.version\.json$/,
    /(^|\/)server\.js$/, /(^|\/)sync_engine\.js$/, /(^|\/)db_translator\.js$/,
    /\.(key|pem|crt|p12|pfx)$/, /\.(bat|cmd|ps1|vbs)$/, /(^|\/)\.git\//];
const blocked = (reqPath) => {
    let dec = reqPath; try { dec = decodeURIComponent(reqPath); } catch (e) {}
    return [reqPath, dec].map(x => String(x).toLowerCase().split('?')[0].split('#')[0])
        .some(p => SENSITIVE.some(re => re.test(p)));
};
for (const leak of ['/branch_database%2Ed%62', '/branch_database.db-wal', '/branch_database.db-shm',
                    '/config%2Ejson', '/database%2Esqlite', '/server%2Ejs']) {
    check(`blocks leak: ${leak}`, blocked(leak) === true);
}
for (const ok of ['/app.js', '/index.html', '/sw.js', '/manifest.json', '/api/system/version']) {
    check(`serves legitimate: ${ok}`, blocked(ok) === false);
}

// --- Global handler: 4xx not logged as ERROR ---
check('global handler skips logging for 4xx client errors',
    /const clientStatus = err\.status[\s\S]{0,160}?if \(clientStatus >= 400 && clientStatus < 500\)[\s\S]{0,160}?return;[\s\S]{0,80}?logSystemError\('EXPRESS_GLOBAL'/.test(server));

// --- db_translator pragma TVF ---
const out = translateSqliteToPostgres("SELECT name FROM pragma_table_info('trade_raw')", []).pgSql;
check('pragma_table_info TVF -> information_schema subquery',
    /information_schema\.columns/.test(out) && !/pragma_table_info/i.test(out));
const out2 = translateSqliteToPostgres("SELECT 'trade_raw' AS tbl, name FROM pragma_table_info('trade_raw')", []).pgSql;
check('UNION-style introspection keeps surrounding SQL intact',
    /'trade_raw' AS tbl/.test(out2) && /WHERE table_name = 'trade_raw'/.test(out2));

console.log(pass ? '\n[T-33] ALL CHECKS PASSED' : '\n[T-33] FAILURES PRESENT');
process.exit(pass ? 0 : 1);
