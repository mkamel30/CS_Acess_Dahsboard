# =======================================================================
#  SmartCS Host Server - Boot Auto-Start Installer (Task Scheduler)
#  Run via setup_autostart_service.bat (auto-elevates to Administrator).
# =======================================================================
$ErrorActionPreference = 'Stop'
$TaskName = 'SmartCS_Host_Service'
$Port     = 8970

function Fail($msg) {
    Write-Host ""
    Write-Host "[ERROR] $msg" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press ENTER to exit" | Out-Null
    exit 1
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bat = Join-Path $dir 'run_smartcs.bat'

Write-Host "======================================================================="
Write-Host "   SmartCS Host Server - Boot Auto-Start Installer"
Write-Host "======================================================================="
Write-Host "[*] Folder: $dir"
Write-Host ""

# 1. Must run from a LOCAL drive (D:\...) on the host, never from \\Share\...
if ($dir.StartsWith('\\')) {
    Fail "This script is running from a network path ($dir).`n        Run it ON the host server from the local folder, e.g.:`n        D:\gROCER SUPPORT\0 Gro.Support\DB\CS_Dashboard\setup_autostart_service.bat"
}
if (-not (Test-Path $bat)) { Fail "run_smartcs.bat not found in $dir" }
if (-not (Test-Path (Join-Path $dir 'server.js'))) { Fail "server.js not found in $dir" }

# 2. Node.js must be resolvable at boot (before any profile/PATH is loaded)
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js not found in PATH. Install Node.js LTS (machine-wide) first." }
Write-Host "[OK] Node.js: $($node.Source)"

# 3. Account that will run the server.
#    NOT SYSTEM: SYSTEM cannot read \\Share\...\Bread_Final_be.accdb with your
#    credentials, and git refuses repos owned by another user (auto-update breaks).
$user = "$env:USERDOMAIN\$env:USERNAME"
Write-Host ""
Write-Host "[*] The server will run as: $user" -ForegroundColor Cyan
Write-Host "    (whether or not anyone is logged on). Enter this account's Windows password."
Write-Host "    NOTE: if this password changes later, re-run this installer."
$cred = Get-Credential -UserName $user -Message "Windows password for $user (needed to start SmartCS at boot without logon)"
if (-not $cred) { Fail "Cancelled." }
$plainPwd = $cred.GetNetworkCredential().Password
if ([string]::IsNullOrEmpty($plainPwd)) {
    Fail "The account has no password. Windows cannot run boot tasks for accounts without a password.`n        Set a password for this account and re-run."
}

# 4. Remove legacy per-user / all-users Startup shortcuts (they launch a 2nd copy at logon)
$legacy = @()
$legacy += Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Startup\SmartCS Dashboard AutoStart.lnk'
Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $legacy += Join-Path $_.FullName 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\SmartCS AutoStart.lnk'
}
foreach ($l in $legacy) {
    if (Test-Path $l) { Remove-Item $l -Force -ErrorAction SilentlyContinue; Write-Host "[OK] Removed legacy startup shortcut: $l" }
}

# 5. Register the task
$action   = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$bat`" --silent`"" -WorkingDirectory $dir
$trigger  = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT1M'   # give network / \\Share 60s to come up after boot
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

# 5.1 Open Windows Defender Firewall for Port 8970 (LAN Sharing)
Write-Host ""
Write-Host "[*] Configuring Windows Firewall to allow incoming LAN traffic on port $Port..."
try {
    netsh advfirewall firewall delete rule name="SmartCS Dashboard Server (Port $Port)" >$null 2>&1
    netsh advfirewall firewall add rule name="SmartCS Dashboard Server (Port $Port)" dir=in action=allow protocol=TCP localport=$Port profile=any | Out-Null
    Write-Host "[OK] Inbound Firewall Rule added for Port $Port (LAN Access Enabled)." -ForegroundColor Green
} catch {
    Write-Host "[!] Could not configure firewall automatically: $($_.Exception.Message)" -ForegroundColor Yellow
}

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
        -User $user -Password $plainPwd -RunLevel Highest -Force | Out-Null
} catch {
    Fail "Could not register the task (wrong password?): $($_.Exception.Message)"
} finally {
    $plainPwd = $null
}
Write-Host "[OK] Scheduled task '$TaskName' registered (At startup +1 min, no time limit, auto-restart)." -ForegroundColor Green

# 6. Stop any manually-started instance, then start via the task
Write-Host ""
Write-Host "[*] Stopping any manually started SmartCS instance..."
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*run_smartcs.bat*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Write-Host "[*] Starting task now..."
Start-ScheduledTask -TaskName $TaskName

# 7. Verify
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:$Port/api/system/version" -TimeoutSec 3
        if ($r.success) { $ok = $true; break }
    } catch {}
}

Write-Host ""
Write-Host "======================================================================="
if ($ok) {
    Write-Host "  SUCCESS - SmartCS is running at http://localhost:$Port (commit $($r.commit))" -ForegroundColor Green
    Write-Host "  It will start automatically on every boot, with no logon required."
} else {
    Write-Host "  Task registered, but the server did not answer within 60s." -ForegroundColor Yellow
    Write-Host "  Check: Task Scheduler > $TaskName > History, and run_smartcs.bat manually."
}
Write-Host "  To stop:  stop_smartcs.bat (as Administrator)"
Write-Host "  To remove: uninstall_autostart_service.bat"
Write-Host "======================================================================="
Read-Host "Press ENTER to exit" | Out-Null
