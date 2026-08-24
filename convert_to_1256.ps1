$srcPath = "h:\Programming\Br_DB\webapp\Module_BackupRestore.bas"
$destPath = "h:\Programming\Br_DB\webapp\Module_BackupRestore_Arabic.bas"

if (Test-Path $srcPath) {
    # Read as UTF-8 string
    $content = [System.IO.File]::ReadAllText($srcPath, [System.Text.Encoding]::UTF8)
    
    # Get Windows-1256 (Arabic ANSI) encoding
    $ansiArabic = [System.Text.Encoding]::GetEncoding(1256)
    
    # Convert string to Windows-1256 bytes
    $bytes = $ansiArabic.GetBytes($content)
    
    # Write bytes to destination
    [System.IO.File]::WriteAllBytes($destPath, $bytes)
    
    Write-Host "File successfully converted to Windows-1256 encoding!"
} else {
    Write-Error "Source file not found!"
}
