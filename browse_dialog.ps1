Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = "Access Database (*.accdb;*.mdb)|*.accdb;*.mdb|All Files (*.*)|*.*"
$dialog.Title = "اختر ملف قاعدة بيانات الآكسيس (Access Database)"
$dialog.RestoreDirectory = $true
$res = $dialog.ShowDialog()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::WriteLine($dialog.FileName)
}
