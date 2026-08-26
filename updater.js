/**
 * SmartCS Auto-Updater Engine
 * Manages GitHub synchronization, version detection, and automated updates.
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

function runCommand(cmd, cwd = __dirname) {
    return new Promise((resolve) => {
        exec(cmd, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                resolve({ success: false, error: error.message, stderr, stdout });
            } else {
                resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
            }
        });
    });
}

async function getVersionInfo() {
    try {
        const localCommit = await runCommand('git rev-parse --short HEAD');
        const commitDate = await runCommand('git log -1 --format=%cd --date=format:"%Y-%m-%d %H:%M"');
        const commitMsg = await runCommand('git log -1 --format=%s');
        const branch = await runCommand('git rev-parse --abbrev-ref HEAD');

        let packageVer = '4.0.0';
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
            if (pkg.version) packageVer = pkg.version;
        } catch (e) {}

        return {
            version: packageVer,
            commit: localCommit.success ? localCommit.stdout : 'unknown',
            date: commitDate.success ? commitDate.stdout : '-',
            message: commitMsg.success ? commitMsg.stdout : '-',
            branch: branch.success ? branch.stdout : 'main',
            platform: process.platform,
            node_version: process.version
        };
    } catch (err) {
        return {
            version: '4.0.0',
            commit: 'unknown',
            error: err.message
        };
    }
}

async function checkForUpdates() {
    try {
        // Fetch remote without merging
        const fetchRes = await runCommand('git fetch --prune origin main');
        if (!fetchRes.success) {
            return { has_update: false, error: 'تعذر الاتصال بـ GitHub: ' + (fetchRes.error || fetchRes.stderr) };
        }

        const localHash = (await runCommand('git rev-parse HEAD')).stdout;
        const remoteHash = (await runCommand('git rev-parse origin/main')).stdout;

        if (localHash && remoteHash && localHash !== remoteHash) {
            const commitsBehindRes = await runCommand('git log HEAD..origin/main --oneline');
            const remoteCommitMsg = await runCommand('git log -1 origin/main --format=%s');
            const remoteCommitDate = await runCommand('git log -1 origin/main --format=%cd --date=format:"%Y-%m-%d %H:%M"');

            const commitsList = commitsBehindRes.success && commitsBehindRes.stdout 
                ? commitsBehindRes.stdout.split('\n').filter(Boolean) 
                : [];

            return {
                has_update: true,
                local_commit: localHash.substring(0, 7),
                remote_commit: remoteHash.substring(0, 7),
                remote_message: remoteCommitMsg.stdout || '-',
                remote_date: remoteCommitDate.stdout || '-',
                commits_behind: commitsList.length || 1,
                commits_summary: commitsList
            };
        }

        return {
            has_update: false,
            current_commit: localHash ? localHash.substring(0, 7) : 'latest',
            message: 'أنت تعمل على أحدث إصدار معتمد من GitHub ✅'
        };
    } catch (err) {
        return { has_update: false, error: err.message };
    }
}

async function performUpdate() {
    try {
        console.log('[AUTO-UPDATER] Fetching and applying updates from origin/main...');
        const fetchRes = await runCommand('git fetch --prune origin main');
        if (!fetchRes.success) throw new Error('فشل جلب التحديثات: ' + (fetchRes.error || fetchRes.stderr));

        const resetRes = await runCommand('git reset --hard origin/main');
        if (!resetRes.success) throw new Error('فشل تطبيق التحديثات: ' + (resetRes.error || resetRes.stderr));

        // Check if package.json has updates to install dependencies
        await runCommand('npm install --omit=dev');

        const newVersion = await getVersionInfo();
        console.log('[AUTO-UPDATER] Update completed successfully! New Commit:', newVersion.commit);

        return {
            success: true,
            new_version: newVersion,
            message: 'تم تحديث البرنامج بنجاح إلى أحدث إصدار!'
        };
    } catch (err) {
        console.error('[AUTO-UPDATER ERROR]', err);
        return {
            success: false,
            error: err.message
        };
    }
}

// CLI usage: node updater.js check | update | version
if (require.main === module) {
    const action = process.argv[2] || 'version';
    if (action === 'check') {
        checkForUpdates().then(r => console.log(JSON.stringify(r, null, 2)));
    } else if (action === 'update') {
        performUpdate().then(r => console.log(JSON.stringify(r, null, 2)));
    } else {
        getVersionInfo().then(r => console.log(JSON.stringify(r, null, 2)));
    }
}

module.exports = {
    getVersionInfo,
    checkForUpdates,
    performUpdate
};
