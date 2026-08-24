$officeVersions = @("15.0", "16.0")

foreach ($ver in $officeVersions) {
    $regKey = "HKCU:\Software\Microsoft\Office\$ver\Access\Security\Trusted Locations\WorkspaceBackup"
    if (Test-Path $regKey) {
        Write-Host "Removing trusted location for Access $ver under $regKey"
        Remove-Item -Path $regKey -Force -Recurse | Out-Null
    }
}

Write-Host "Registry cleanup completed successfully."
