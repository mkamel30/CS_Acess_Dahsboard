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
        let packageVer = '4.8.2';
        let verMeta = {};
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
            if (pkg.version) packageVer = pkg.version;
        } catch (e) {}

        try {
            if (fs.existsSync(path.join(__dirname, '.version.json'))) {
                verMeta = JSON.parse(fs.readFileSync(path.join(__dirname, '.version.json'), 'utf8')) || {};
            }
        } catch(e) {}

        let localCommit = await runCommand('git -c safe.directory=* rev-parse --short HEAD');
        if (!localCommit.success) {
            localCommit = await runCommand('git rev-parse --short HEAD');
        }
        let commitDate = await runCommand('git -c safe.directory=* log -1 --format=%cd --date=format:"%Y-%m-%d %H:%M"');
        let commitMsg = await runCommand('git -c safe.directory=* log -1 --format=%s');
        let branch = await runCommand('git -c safe.directory=* rev-parse --abbrev-ref HEAD');

        let resolvedCommit = localCommit.success ? localCommit.stdout : (verMeta.commit || '');
        let resolvedDate = commitDate.success ? commitDate.stdout : (verMeta.date || '');
        let resolvedMsg = commitMsg.success ? commitMsg.stdout : (verMeta.message || '');
        let resolvedBranch = branch.success ? branch.stdout : (verMeta.branch || 'main');

        // If commit or date still unknown (e.g. Git command not working on VPS host), fetch from GitHub API
        if (!resolvedCommit || resolvedCommit === 'latest' || !resolvedDate || resolvedDate === '-') {
            try {
                const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
                const apiRes = await fetchFn('https://api.github.com/repos/mkamel30/CS_Acess_Dahsboard/commits/main', {
                    headers: { 'User-Agent': 'SmartCS-App' }
                });
                if (apiRes.ok) {
                    const data = await apiRes.json();
                    resolvedCommit = (data.sha || '').substring(0, 7);
                    resolvedMsg = (data.commit?.message || 'أحدث إصدار معتمد من GitHub').split('\n')[0];
                    resolvedDate = data.commit?.committer?.date 
                        ? new Date(data.commit.committer.date).toISOString().replace('T', ' ').substring(0, 16)
                        : new Date().toISOString().replace('T', ' ').substring(0, 16);
                    resolvedBranch = 'main';
                }
            } catch (apiErr) {}
        }

        return {
            version: packageVer,
            commit: resolvedCommit || 'd3bbf1a',
            date: resolvedDate || '2026-09-17 12:29',
            message: resolvedMsg || 'fix(ai): add ultra-resilient LLM parser to handle thinking tags (v4.8.2-ai)',
            branch: resolvedBranch || 'main',
            platform: process.platform,
            node_version: process.version
        };
    } catch (err) {
        return {
            version: '4.8.2',
            commit: 'd3bbf1a',
            error: err.message
        };
    }
}

async function checkForUpdates() {
    try {
        const localVersion = await getVersionInfo();
        const localCommit = (localVersion.commit || '').trim();

        // 1. Fetch latest commit metadata directly from GitHub API (works with or without Git)
        const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
        try {
            const apiRes = await fetchFn('https://api.github.com/repos/mkamel30/CS_Acess_Dahsboard/commits/main', {
                headers: { 'User-Agent': 'SmartCS-App' }
            });
            if (apiRes.ok) {
                const data = await apiRes.json();
                const remoteCommit = (data.sha || '').substring(0, 7);
                const remoteMsg = data.commit?.message?.split('\n')[0] || 'تحديث جديد معتمد على GitHub';
                const remoteDate = data.commit?.committer?.date 
                    ? new Date(data.commit.committer.date).toLocaleString('ar-EG') 
                    : new Date().toLocaleDateString('ar-EG');

                if (remoteCommit && remoteCommit !== localCommit) {
                    return {
                        has_update: true,
                        local_commit: localCommit === 'unknown' ? `v${localVersion.version}` : localCommit,
                        remote_commit: remoteCommit,
                        remote_message: remoteMsg,
                        remote_date: remoteDate,
                        commits_behind: 1,
                        commits_summary: [remoteMsg]
                    };
                }
            }
        } catch (apiErr) {
            console.warn('[UPDATER] GitHub API check fallback to git:', apiErr.message);
        }

        // 2. Fallback: Check via Git if repository is present
        const isGit = fs.existsSync(path.join(__dirname, '.git'));
        if (isGit) {
            const fetchRes = await runCommand('git -c safe.directory=* fetch --prune origin main');
            if (fetchRes.success) {
                const localHash = (await runCommand('git -c safe.directory=* rev-parse HEAD')).stdout;
                const remoteHash = (await runCommand('git -c safe.directory=* rev-parse origin/main')).stdout;

                if (localHash && remoteHash && localHash !== remoteHash) {
                    const remoteCommitMsg = await runCommand('git -c safe.directory=* log -1 origin/main --format=%s');
                    const remoteCommitDate = await runCommand('git -c safe.directory=* log -1 origin/main --format=%cd --date=format:"%Y-%m-%d %H:%M"');

                    return {
                        has_update: true,
                        local_commit: localHash.substring(0, 7),
                        remote_commit: remoteHash.substring(0, 7),
                        remote_message: remoteCommitMsg.stdout || '-',
                        remote_date: remoteCommitDate.stdout || '-',
                        commits_behind: 1,
                        commits_summary: [remoteCommitMsg.stdout || '-']
                    };
                }
            }
        }

        return {
            has_update: false,
            current_commit: localCommit,
            message: 'أنت تعمل على أحدث إصدار معتمد من GitHub ✅'
        };
    } catch (err) {
        return { has_update: false, error: err.message };
    }
}

async function performUpdate() {
    try {
        const isGit = fs.existsSync(path.join(__dirname, '.git'));
        if (isGit) {
            console.log('[AUTO-UPDATER] Fetching and applying updates from origin/main via Git...');
            await runCommand('git -c safe.directory=* fetch --prune origin main');
            const resetRes = await runCommand('git -c safe.directory=* reset --hard origin/main');
            if (!resetRes.success) throw new Error('فشل تطبيق التحديثات عبر Git: ' + (resetRes.error || resetRes.stderr));
        } else {
            console.log('[AUTO-UPDATER] Updating files via PowerShell GitHub Release ZIP...');
            const destDir = __dirname.replace(/\\/g, '\\\\');
            const psCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ext = Join-Path $env:TEMP 'smartcs_upd'; if (Test-Path $ext) { Remove-Item $ext -Recurse -Force -ErrorAction SilentlyContinue }; $zip = Join-Path $env:TEMP 'smartcs_upd.zip'; if (Test-Path $zip) { Remove-Item $zip -Force -ErrorAction SilentlyContinue }; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/mkamel30/CS_Acess_Dahsboard/archive/refs/heads/main.zip' -OutFile $zip; Expand-Archive -Path $zip -DestinationPath $ext -Force; Get-ChildItem -Path (Join-Path $ext 'CS_Acess_Dahsboard-main') | Copy-Item -Destination '${destDir}' -Recurse -Force; Remove-Item $zip, $ext -Recurse -Force -ErrorAction SilentlyContinue"`;
            const psRes = await runCommand(psCmd);
            if (!psRes.success) throw new Error('فشل تحميل التحديث عبر ZIP: ' + (psRes.error || psRes.stderr));
        }

        // Guarantee clean run_smartcs.bat launcher with resilient loop
        try {
            const cleanBat = '@echo off\r\nset "PATH=%SystemRoot%\\System32;%SystemRoot%\\System32\\WindowsPowerShell\\v1.0;%ProgramFiles%\\nodejs;%ProgramFiles(x86)%\\nodejs;%LOCALAPPDATA%\\Programs\\nodejs;%APPDATA%\\npm;%ProgramFiles%\\Git\\cmd;%PATH%"\r\ntitle SmartCS Dashboard - Operations Server\r\ncolor 0a\r\ncd /d "%~dp0"\r\nfor /f "tokens=5" %%a in (\'netstat -aon ^| findstr ":8970" ^| findstr "LISTENING"\') do taskkill /F /PID %%a >nul 2>nul\r\nstart "" "http://localhost:8970"\r\n:loop\r\necho.\r\necho =======================================================================\r\necho   SmartCS Dashboard Server Running on Port 8970\r\necho   Keep this window OPEN. Press Ctrl+C to stop.\r\necho =======================================================================\r\necho.\r\nnode server.js\r\necho.\r\necho [WARNING] Server stopped or exited with code %errorlevel%!\r\necho Restarting in 3 seconds... (Press Ctrl+C to abort)\r\ntimeout /t 3 /nobreak >nul\r\ngoto loop\r\n';
            fs.writeFileSync(path.join(__dirname, 'run_smartcs.bat'), cleanBat, 'utf8');
        } catch(e) {}

        await runCommand('npm install --omit=dev');
        const newVersion = await getVersionInfo();
        console.log('[AUTO-UPDATER] Update completed successfully! New Version:', newVersion.version, newVersion.commit);

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

async function initDatabase() {
    try {
        const sqlite3 = require('sqlite3');
        const { initSyncDatabase } = require('./sync_engine');
        const dbPath = path.join(__dirname, 'branch_database.db');
        const db = new sqlite3.Database(dbPath);
        db.run('PRAGMA journal_mode = WAL;');
        await initSyncDatabase(db);
        console.log('  [+] App Database Schema Created and Ready!');
        db.close();
        return { success: true };
    } catch (err) {
        console.error('  [!] Database init error:', err.message);
        return { success: false, error: err.message };
    }
}

// CLI usage: node updater.js check | update | version | init-db | update-silent
if (require.main === module) {
    const action = process.argv[2] || 'version';
    if (action === 'check') {
        checkForUpdates().then(r => console.log(JSON.stringify(r, null, 2)));
    } else if (action === 'update') {
        performUpdate().then(r => console.log(JSON.stringify(r, null, 2)));
    } else if (action === 'update-silent') {
        (async () => {
            try {
                const chk = await checkForUpdates();
                if (chk && chk.has_update) {
                    console.log('[*] New GitHub update detected. Applying update...');
                    await performUpdate();
                }
            } catch (e) {}
            process.exit(0);
        })();
    } else if (action === 'init-db') {
        initDatabase().then(() => process.exit(0));
    } else {
        getVersionInfo().then(r => console.log(JSON.stringify(r, null, 2)));
    }
}

module.exports = {
    getVersionInfo,
    checkForUpdates,
    performUpdate,
    initDatabase
};
