/**
 * T-32: SSE no-op broadcast gate (Share sync-completion + VPS cloud_delta_applied)
 * Static contract that periodic/heartbeat/mtime-touch syncs with 0 actual changes
 * do NOT broadcast a refresh to live clients (fixes "SSE refresh spam"), while the
 * deliberate reset-database broadcast is preserved.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

let pass = true;
function check(name, cond) {
    console.log(`  ${cond ? 'PASS' : 'FAIL'} - ${name}`);
    if (!cond) pass = false;
}

// 1. Share-side: completion callback gated on changesDetected > 0
check('completion callback computes changed from changesDetected',
    /setOnSyncCompleteCallback[\s\S]{0,400}?const changed = \(result && \(result\.changesDetected \|\| 0\)\) > 0;/.test(src));
check('completion callback early-returns on no-op sync',
    /setOnSyncCompleteCallback[\s\S]{0,600}?if \(!changed\) return;[\s\S]{0,600}?broadcastSseEvent\('sync_completed'/.test(src));

// 2. VPS-side: cloud_delta_applied broadcast gated on appliedCount > 0
check('cloud_delta_applied wrapped in appliedCount>0 guard',
    /if \(\(appliedCount \|\| 0\) > 0\) \{[\s\S]{0,220}?type: 'cloud_delta_applied'/.test(src));

// 3. The deliberate reset-database broadcast must remain unconditional (still notifies after wipe)
check('reset-database still broadcasts sync_completed',
    /reset-database[\s\S]{0,400}?broadcastSseEvent\('sync_completed'/.test(src));

// 4. Negative: the guard must sit between the callback start and its broadcast
const cbRegion = (src.match(/setOnSyncCompleteCallback\([\s\S]*?broadcastSseEvent\('sync_completed'/) || [''])[0];
check('completion callback region contains the guard before broadcasting', /if \(!changed\) return;/.test(cbRegion));

console.log(pass ? '\n[T-32] ALL CHECKS PASSED' : '\n[T-32] FAILURES PRESENT');
process.exit(pass ? 0 : 1);
