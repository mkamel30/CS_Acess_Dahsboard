' Dynamic Access Database Exporter to JSON (all tables)
Option Explicit

Dim fso, conn, rsTables
Set fso = CreateObject("Scripting.FileSystemObject")
Set conn = CreateObject("ADODB.Connection")

Dim dbPath
dbPath = "h:\Programming\Br_DB\BE\Bread_Final_be.accdb"

If WScript.Arguments.Count > 0 Then
    dbPath = WScript.Arguments(0)
End If

Dim connStr
connStr = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" & dbPath & ";Persist Security Info=False;"
conn.Open connStr

Function EscapeJson(str)
    If IsNull(str) Or IsEmpty(str) Then
        EscapeJson = "null"
        Exit Function
    End If
    Dim s, i, c, code
    s = CStr(str)
    Dim res
    res = ""
    For i = 1 To Len(s)
        c = Mid(s, i, 1)
        code = AscW(c)
        Select Case c
            Case """"
                res = res & "\"""
            Case "\"
                res = res & "\\"
            Case vbCr
                res = res & "\r"
            Case vbLf
                res = res & "\n"
            Case vbTab
                res = res & "\t"
            Case Else
                If code >= 32 And code <= 126 Then
                    res = res & c
                ElseIf code >= 0 And code < 32 Then
                    res = res & "\u00" & Right("0" & Hex(code), 2)
                Else
                    res = res & c
                End If
        End Select
    Next
    EscapeJson = """" & res & """"
End Function

Function ExportTableToJson(tableName, outputPath)
    On Error Resume Next
    Dim cmd, rst
    Set cmd = CreateObject("ADODB.Command")
    cmd.ActiveConnection = conn
    cmd.CommandText = "SELECT * FROM [" & tableName & "]"
    Set rst = cmd.Execute
    
    If Err.Number <> 0 Then
        WScript.Echo "Error reading table " & tableName & ": " & Err.Description
        Err.Clear
        Exit Function
    End If
    
    Dim utfStream
    Set utfStream = CreateObject("ADODB.Stream")
    utfStream.Type = 2 ' adTypeText
    utfStream.Charset = "utf-8"
    utfStream.Open
    
    utfStream.WriteText "[" & vbCrLf
    
    Dim isFirstRow, i, fld, val, jsonVal
    isFirstRow = True
    
    Dim rowCount
    rowCount = 0
    
    Do Until rst.EOF
        If Not isFirstRow Then
            utfStream.WriteText "," & vbCrLf
        End If
        isFirstRow = False
        
        utfStream.WriteText "  {"
        Dim isFirstCol
        isFirstCol = True
        For i = 0 To rst.Fields.Count - 1
            Set fld = rst.Fields(i)
            val = fld.Value
            jsonVal = EscapeJson(val)
            
            If Not isFirstCol Then utfStream.WriteText ", "
            isFirstCol = False
            
            utfStream.WriteText """" & fld.Name & """: " & jsonVal
        Next
        utfStream.WriteText "}"
        rowCount = rowCount + 1
        rst.MoveNext
    Loop
    
    utfStream.WriteText vbCrLf & "]"
    
    utfStream.SaveToFile outputPath, 2 ' adSaveCreateOverWrite
    utfStream.Close
    rst.Close
    
    WScript.Echo "Exported " & tableName & " (" & rowCount & " rows) -> " & outputPath
End Function

Dim exportDir
exportDir = "h:\Programming\Br_DB\webapp\data_sync"
If Not fso.FolderExists(exportDir) Then
    fso.CreateFolder(exportDir)
End If

' Whitelist of essential active tables to maximize sync speed
Dim essentialTables
Set essentialTables = CreateObject("Scripting.Dictionary")
essentialTables.CompareMode = 1 ' Case-insensitive

essentialTables.Add "Assets", True
essentialTables.Add "TransAction", True
essentialTables.Add "Maintenance", True
essentialTables.Add "payments", True
essentialTables.Add "Store_POS", True
essentialTables.Add "Store_Sim", True
essentialTables.Add "Store_SP", True
essentialTables.Add "Store_SP_maintenance", True
essentialTables.Add "tblInstallments", True
essentialTables.Add "tblFaults", True
essentialTables.Add "AuthorizedUsers", True
essentialTables.Add "tblFixes", True
essentialTables.Add "failure_points", True

Dim tKey, tArr
tArr = essentialTables.Keys

For Each tKey In tArr
    ExportTableToJson tKey, exportDir & "\" & tKey & ".json"
Next

conn.Close
WScript.Echo "DYNAMIC_EXPORT_FINISHED"
