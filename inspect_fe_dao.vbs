' Fast Direct DAO/ADOX Inspection for Bread_DB.accdb
Option Explicit

Dim dbEngine, db, qry, rel, tbl, fld
Dim fs, outDir, dbPath
Dim qryFile, relFile, tblFile

dbPath = "H:\Programming\Br_DB\Bread_DB.accdb"
outDir = "H:\Programming\Br_DB\webapp\fe_analysis\"

Set fs = CreateObject("Scripting.FileSystemObject")
If Not fs.FolderExists(outDir) Then fs.CreateFolder(outDir)

On Error Resume Next
Set dbEngine = CreateObject("DAO.DBEngine.120")
If Err.Number <> 0 Then
    Set dbEngine = CreateObject("DAO.DBEngine")
End If

Set db = dbEngine.OpenDatabase(dbPath, False, True)
If Err.Number <> 0 Then
    WScript.Echo "DAO Open Error: " & Err.Description
    WScript.Quit 1
End If

' 1. Export Queries
Set qryFile = fs.CreateTextFile(outDir & "queries.txt", True, True)
qryFile.WriteLine "=== QUERIES IN Bread_DB.accdb (" & db.QueryDefs.Count & " Total) ==="
For Each qry In db.QueryDefs
    If Left(qry.Name, 1) <> "~" Then
        qryFile.WriteLine "--------------------------------------------------"
        qryFile.WriteLine "QUERY: " & qry.Name
        qryFile.WriteLine "SQL: " & qry.SQL
    End If
Next
qryFile.Close
WScript.Echo "Queries exported successfully."

' 2. Export Relations
Set relFile = fs.CreateTextFile(outDir & "relations.txt", True, True)
relFile.WriteLine "=== RELATIONS IN Bread_DB.accdb (" & db.Relations.Count & " Total) ==="
For Each rel In db.Relations
    relFile.WriteLine "--------------------------------------------------"
    relFile.WriteLine "RELATION: " & rel.Name & " | Primary: " & rel.Table & " -> Foreign: " & rel.ForeignTable
    For Each fld In rel.Fields
        relFile.WriteLine "   Field: " & fld.Name & " ===> " & fld.ForeignName
    Next
Next
relFile.Close
WScript.Echo "Relations exported successfully."

' 3. Export TableDefs
Set tblFile = fs.CreateTextFile(outDir & "tables.txt", True, True)
tblFile.WriteLine "=== TABLEDEFS IN Bread_DB.accdb (" & db.TableDefs.Count & " Total) ==="
For Each tbl In db.TableDefs
    If Left(tbl.Name, 4) <> "MSys" And Left(tbl.Name, 1) <> "~" Then
        tblFile.WriteLine "TABLE: " & tbl.Name & " | Connect: " & tbl.Connect & " | Source: " & tbl.SourceTableName
    End If
Next
tblFile.Close
WScript.Echo "Tables exported successfully."

db.Close
Set db = Nothing
Set dbEngine = Nothing
WScript.Echo "ALL DAO METADATA EXPORTED!"
