$path = "h:\Programming\Br_DB"

# Setup registry entries for Access 2013 (15.0) and Access 2016/2019/365 (16.0)
$officeVersions = @("15.0", "16.0")

foreach ($ver in $officeVersions) {
    $regKey = "HKCU:\Software\Microsoft\Office\$ver\Access\Security\Trusted Locations\WorkspaceBackup"
    
    # Check if security path exists, if not create it
    $securityKey = "HKCU:\Software\Microsoft\Office\$ver\Access\Security"
    if (!(Test-Path $securityKey)) {
        New-Item -Path $securityKey -Force | Out-Null
    }
    $locationsKey = "HKCU:\Software\Microsoft\Office\$ver\Access\Security\Trusted Locations"
    if (!(Test-Path $locationsKey)) {
        New-Item -Path $locationsKey -Force | Out-Null
    }

    Write-Host "Setting trusted location for Access $ver under $regKey"
    if (!(Test-Path $regKey)) {
        New-Item -Path $regKey -Force | Out-Null
    }
    
    Set-ItemProperty -Path $regKey -Name "Path" -Value $path
    Set-ItemProperty -Path $regKey -Name "AllowSubfolders" -Value 1 -Type DWord
    Set-ItemProperty -Path $regKey -Name "Description" -Value "Workspace for database migration"
}

Write-Host "Registry updates completed successfully."
