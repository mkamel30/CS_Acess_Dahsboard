' Export Reports and Forms from MSysObjects
Option Explicit

Dim dbEngine, db, rs, fs, outFile
Dim dbPath, outPath

dbPath = "H:\Programming\Br_DB\Bread_DB.accdb"
outPath = "H:\Programming\Br_DB\webapp\fe_analysis\reports_and_forms.txt"

Set fs = CreateObject("Scripting.FileSystemObject")
Set dbEngine = CreateObject("DAO.DBEngine.120")
If Err.Number <> 0 Then Set dbEngine = CreateObject("DAO.DBEngine")

Set db = dbEngine.OpenDatabase(dbPath, False, True)

Set outFile = fs.CreateTextFile(outPath, True, True)

' 1. Reports
outFile.WriteLine "=== REPORTS IN Bread_DB.accdb ==="
Dim doc
On Error Resume Next
For Each doc In db.Containers("Reports").Documents
    outFile.WriteLine "REPORT: " & doc.Name & " | Created: " & doc.DateCreated & " | Updated: " & doc.LastUpdated
Next

' 2. Forms
outFile.WriteLine ""
outFile.WriteLine "=== FORMS IN Bread_DB.accdb ==="
For Each doc In db.Containers("Forms").Documents
    outFile.WriteLine "FORM: " & doc.Name & " | Created: " & doc.DateCreated & " | Updated: " & doc.LastUpdated
Next

' 3. Scripts / Modules
outFile.WriteLine ""
outFile.WriteLine "=== MODULES IN Bread_DB.accdb ==="
For Each doc In db.Containers("Modules").Documents
    outFile.WriteLine "MODULE: " & doc.Name
Next

' 3. Linked Tables Connection Strings
outFile.WriteLine ""
outFile.WriteLine "=== LINKED TABLES AND PATHS ==="
Dim tbl
For Each tbl In db.TableDefs
    If Left(tbl.Name, 4) <> "MSys" And Left(tbl.Name, 1) <> "~" Then
        If Len(tbl.Connect) > 0 Then
            outFile.WriteLine "LINKED TABLE: " & tbl.Name & " -> " & tbl.SourceTableName & " (" & tbl.Connect & ")"
        Else
            outFile.WriteLine "LOCAL TABLE: " & tbl.Name
        End If
    End If
Next

outFile.Close
db.Close
WScript.Echo "Reports and Forms exported successfully."
