' Inspect FE Database: Queries, Reports, Relations, TableDefs
Option Explicit

Dim dbPath, appAccess, db, fs, outDir
dbPath = "H:\Programming\Br_DB\Bread_DB.accdb"
outDir = "H:\Programming\Br_DB\webapp\fe_analysis\"

Set fs = CreateObject("Scripting.FileSystemObject")
If Not fs.FolderExists(outDir) Then fs.CreateFolder(outDir)

On Error Resume Next
Set appAccess = CreateObject("Access.Application")
If Err.Number <> 0 Then
    WScript.Echo "Error creating Access application: " & Err.Description
    WScript.Quit 1
End If

appAccess.OpenCurrentDatabase dbPath, False
Set db = appAccess.CurrentDb

If db Is Nothing Then
    WScript.Echo "Error opening database: " & Err.Description
    appAccess.Quit
    WScript.Quit 1
End If

' 1. Export Relations
Dim rel, relFile
Set relFile = fs.CreateTextFile(outDir & "relations.txt", True, True)
relFile.WriteLine "=== RELATIONS IN Bread_DB.accdb ==="
For Each rel In db.Relations
    relFile.WriteLine "Relation: " & rel.Name & " | Table: " & rel.Table & " -> ForeignTable: " & rel.ForeignTable
    Dim fld
    For Each fld In rel.Fields
        relFile.WriteLine "   Field: " & fld.Name & " -> ForeignName: " & fld.ForeignName
    Next
Next
relFile.Close
WScript.Echo "Relations exported."

' 2. Export Queries (QueryDefs)
Dim qry, qryFile
Set qryFile = fs.CreateTextFile(outDir & "queries.txt", True, True)
qryFile.WriteLine "=== QUERIES IN Bread_DB.accdb ==="
For Each qry In db.QueryDefs
    If Left(qry.Name, 1) <> "~" Then
        qryFile.WriteLine "--------------------------------------------------"
        qryFile.WriteLine "QUERY NAME: " & qry.Name
        qryFile.WriteLine "SQL: " & qry.SQL
    End If
Next
qryFile.Close
WScript.Echo "Queries exported."

' 3. Export Reports list
Dim rptFile, i, rptName
Set rptFile = fs.CreateTextFile(outDir & "reports.txt", True, True)
rptFile.WriteLine "=== REPORTS IN Bread_DB.accdb ==="
For i = 0 To appAccess.CurrentProject.AllReports.Count - 1
    rptName = appAccess.CurrentProject.AllReports(i).Name
    rptFile.WriteLine "REPORT: " & rptName
Next
rptFile.Close
WScript.Echo "Reports list exported."

' 4. Export Forms list
Dim frmFile
Set frmFile = fs.CreateTextFile(outDir & "forms.txt", True, True)
frmFile.WriteLine "=== FORMS IN Bread_DB.accdb ==="
For i = 0 To appAccess.CurrentProject.AllForms.Count - 1
    frmFile.WriteLine "FORM: " & appAccess.CurrentProject.AllForms(i).Name
Next
frmFile.Close
WScript.Echo "Forms list exported."

' 5. Export TableDefs (Linked Tables info)
Dim tbl, tblFile
Set tblFile = fs.CreateTextFile(outDir & "tables.txt", True, True)
tblFile.WriteLine "=== TABLES / LINKED TABLES IN Bread_DB.accdb ==="
For Each tbl In db.TableDefs
    If Left(tbl.Name, 4) <> "MSys" And Left(tbl.Name, 1) <> "~" Then
        tblFile.WriteLine "TABLE: " & tbl.Name & " | Connect: " & tbl.Connect & " | SourceTableName: " & tbl.SourceTableName
    End If
Next
tblFile.Close
WScript.Echo "Tables list exported."

appAccess.CloseCurrentDatabase
appAccess.Quit
Set appAccess = Nothing
Set db = Nothing
WScript.Echo "Analysis extraction completed successfully!"
