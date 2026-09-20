/**
 * SmartCS Access Database Schema Validator & Health Inspector
 * Validates branch Access database tables and columns against the expected schema contract.
 * Generates human-readable logs and health status for UI diagnostics.
 */

const fs = require("fs");
const path = require("path");

const EXPECTED_SCHEMA = {
    Assets: {
        tableName: "Assets",
        arabicName: "بيانات المخابز والأجهزة (Assets)",
        critical: true,
        primaryKey: "ID",
        expectedColumns: [
            "ID", "bkcode", "Owner", "Comments", "bk_type", "telephone_1", "telephone_2",
            "Address", "dep", "NationalD", "notes", "Condition", "POS", "POS_2", "pos_3",
            "Manufacturer", "Manufacturer2", "Manufacturer3", "Model", "Model2", "Model3",
            "Cell_Serial", "Cell_type", "Cell_Serial3", "Cell_type3", "Acquired Date", "papers_date"
        ],
        criticalColumns: ["ID", "bkcode", "Owner", "POS", "Model"]
    },
    TransAction: {
        tableName: "TransAction",
        arabicName: "حركات وصيانة الماكينات (TransAction)",
        critical: true,
        primaryKey: "ID",
        expectedColumns: [
            "ID", "POSN", "ActionType", "IssueDate", "ActionDate", "NoteG", "NoteD",
            "Fees", "Paid", "FeesAmount", "Procedure"
        ],
        criticalColumns: ["ID", "POSN", "ActionType", "ActionDate"]
    },
    Maintenance: {
        tableName: "Maintenance",
        arabicName: "بلاغات الصيانة (Maintenance)",
        critical: false,
        primaryKey: "ID",
        expectedColumns: [
            "ID", "Unit Serial", "Checked In Date", "Checked Out Date",
            "Checked In Condition", "Procedure", "Notes"
        ],
        criticalColumns: ["ID", "Unit Serial"]
    },
    payments: {
        tableName: "payments",
        arabicName: "المدفوعات والتحصيلات (payments)",
        critical: true,
        primaryKey: "ID",
        expectedColumns: [
            "ID", "pos_number", "payer", "payment_date", "payment_amount", "ref_num",
            "payment_reason", "payment_place"
        ],
        criticalColumns: ["ID", "payment_amount", "ref_num"]
    },
    Store_POS: {
        tableName: "Store_POS",
        arabicName: "مخزن ماكينات الـ POS (Store_POS)",
        critical: true,
        primaryKey: "Serial",
        expectedColumns: ["Serial", "type", "Model", "faulty", "pos_status", "faulty_detils"],
        criticalColumns: ["Serial"]
    },
    Store_Sim: {
        tableName: "Store_Sim",
        arabicName: "مخزن شرائح الاتصال (Store_Sim)",
        critical: false,
        primaryKey: "sim_serial",
        expectedColumns: ["sim_serial", "network", "sim_type", "faulty", "notes"],
        criticalColumns: ["sim_serial"]
    },
    Store_SP: {
        tableName: "Store_SP",
        arabicName: "مخزن وحركات قطع غيار الفرع (Store_SP)",
        critical: true,
        primaryKey: "COMPOSITE",
        expectedColumns: ["Serial", "type", "faulty", "faulty_detils", "notes", "Model", "reviewed", "count_in", "count_out", "out_date", "in_date"],
        criticalColumns: ["Serial", "type", "count_in", "count_out"]
    },
    Store_SP_maintenance: {
        tableName: "Store_SP_maintenance",
        arabicName: "قطع غيار مركز الصيانة الرئيسي (Store_SP_maintenance)",
        critical: false,
        primaryKey: "COMPOSITE",
        expectedColumns: ["formNo", "type", "out_date", "notes", "faulty_detils"],
        criticalColumns: ["type"]
    },
    tblInstallments: {
        tableName: "tblInstallments",
        arabicName: "عقود وأقساط الماكينات (tblInstallments)",
        critical: false,
        primaryKey: "ID",
        expectedColumns: ["ID", "pos", "installments", "monthlyinstallmentprice", "finalunitprice", "unitprice"],
        criticalColumns: ["pos"]
    },
    tblFaults: {
        tableName: "tblFaults",
        arabicName: "قائمة الأعطال (tblFaults)",
        critical: false,
        primaryKey: "faultid",
        expectedColumns: ["faultid", "FaultName"],
        criticalColumns: ["faultid", "FaultName"]
    },
    AuthorizedUsers: {
        tableName: "AuthorizedUsers",
        arabicName: "طاقم العمل والفنيين (AuthorizedUsers)",
        critical: false,
        primaryKey: "id",
        expectedColumns: ["id", "name", "jtitle"],
        criticalColumns: ["name"]
    },
    tblFixes: {
        tableName: "tblFixes",
        arabicName: "أنواع الإصلاحات (tblFixes)",
        critical: false,
        primaryKey: "FixID",
        expectedColumns: ["FixID", "FixName"],
        criticalColumns: ["FixID"]
    },
    failure_points: {
        tableName: "failure_points",
        arabicName: "نقاط الأعطال وأسعار القطع (failure_points)",
        critical: false,
        primaryKey: "COMPOSITE",
        expectedColumns: ["type", "model", "fees", "price"],
        criticalColumns: ["type"]
    }
};

/**
 * Validate extracted JSON files in dataSyncDir against EXPECTED_SCHEMA
 */
function validateSchema(dataSyncDir, logsDir) {
    const report = {
        timestamp: new Date().toISOString(),
        overallStatus: "HEALTHY", // HEALTHY | WARNING | CRITICAL
        totalExpectedTables: Object.keys(EXPECTED_SCHEMA).length,
        existingTablesCount: 0,
        missingTables: [],
        missingCriticalTables: [],
        tablesReport: {},
        warnings: [],
        criticalErrors: []
    };

    for (const [key, spec] of Object.entries(EXPECTED_SCHEMA)) {
        const jsonFile = path.join(dataSyncDir, key + ".json");
        const tblResult = {
            tableName: spec.tableName,
            arabicName: spec.arabicName,
            critical: spec.critical,
            status: "MISSING",
            recordsCount: 0,
            presentColumns: [],
            missingExpectedColumns: [],
            missingCriticalColumns: [],
            extraColumns: []
        };

        if (!fs.existsSync(jsonFile)) {
            report.missingTables.push(spec.tableName);
            if (spec.critical) {
                report.missingCriticalTables.push(spec.tableName);
                report.criticalErrors.push("جدول أساسي مفقود: " + spec.arabicName);
            } else {
                report.warnings.push("جدول اختياري غير موجود: " + spec.arabicName);
            }
            report.tablesReport[key] = tblResult;
            continue;
        }

        let rows = [];
        try {
            const raw = fs.readFileSync(jsonFile, "utf8").trim();
            if (raw) rows = JSON.parse(raw);
        } catch (e) {
            tblResult.status = "CORRUPT";
            report.warnings.push("ملف تالف للجدول: " + spec.arabicName + " - " + e.message);
            report.tablesReport[key] = tblResult;
            continue;
        }

        report.existingTablesCount++;
        tblResult.status = "PRESENT";
        tblResult.recordsCount = rows.length;

        // Collect all distinct columns across sample rows
        const presentColsSet = new Set();
        const sampleSize = Math.min(rows.length, 50);
        for (let i = 0; i < sampleSize; i++) {
            if (rows[i] && typeof rows[i] === "object") {
                Object.keys(rows[i]).forEach(c => presentColsSet.add(c));
            }
        }
        tblResult.presentColumns = Array.from(presentColsSet);

        // Case-insensitive lookup map
        const lowerPresentMap = new Map();
        tblResult.presentColumns.forEach(c => lowerPresentMap.set(c.toLowerCase(), c));

        // Check expected columns
        spec.expectedColumns.forEach(expCol => {
            const expLower = expCol.toLowerCase();
            if (!lowerPresentMap.has(expLower)) {
                tblResult.missingExpectedColumns.push(expCol);
                if (spec.criticalColumns.includes(expCol)) {
                    tblResult.missingCriticalColumns.push(expCol);
                    report.criticalErrors.push("عمود حرج مفقود في " + spec.arabicName + ": " + expCol);
                } else {
                    report.warnings.push("عمود متوقع غير موجود في " + spec.arabicName + ": " + expCol);
                }
            }
        });

        // Check extra columns
        const lowerExpSet = new Set(spec.expectedColumns.map(c => c.toLowerCase()));
        tblResult.presentColumns.forEach(c => {
            if (!lowerExpSet.has(c.toLowerCase())) {
                tblResult.extraColumns.push(c);
            }
        });

        if (tblResult.missingCriticalColumns.length > 0) {
            tblResult.status = "CRITICAL_COLUMNS_MISSING";
        } else if (tblResult.missingExpectedColumns.length > 0) {
            tblResult.status = "WARNING_COLUMNS_MISSING";
        } else {
            tblResult.status = "MATCHED";
        }

        report.tablesReport[key] = tblResult;
    }

    if (report.criticalErrors.length > 0) {
        report.overallStatus = "CRITICAL";
    } else if (report.warnings.length > 0) {
        report.overallStatus = "WARNING";
    } else {
        report.overallStatus = "HEALTHY";
    }

    // Write text log and JSON report
    try {
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
        
        fs.writeFileSync(path.join(logsDir, "schema_health_report.json"), JSON.stringify(report, null, 2), "utf8");

        let txt = "=================================================================\n";
        txt += "     SmartCS Access Database Schema Health & Validation Report   \n";
        txt += "=================================================================\n";
        txt += "التاريخ والوقت     : " + new Date().toLocaleString("ar-EG") + "\n";
        txt += "الحالة العامة       : " + report.overallStatus + "\n";
        txt += "الجداول المتوفرة   : " + report.existingTablesCount + " من أصل " + report.totalExpectedTables + "\n";
        txt += "-----------------------------------------------------------------\n\n";

        if (report.criticalErrors.length > 0) {
            txt += "[⚠️ أعطال وأعمدة حرجة مفقودة - تتطلب مراجعة فنية]:\n";
            report.criticalErrors.forEach(e => txt += "  • [خطأ حرج] " + e + "\n");
            txt += "\n";
        }

        if (report.warnings.length > 0) {
            txt += "[ℹ️ ملاحظات وأعمدة اختيارية مفقودة (تم تعويضها تلقائياً)]:\n";
            report.warnings.forEach(w => txt += "  • [تنبيه] " + w + "\n");
            txt += "\n";
        }

        txt += "-----------------------------------------------------------------\n";
        txt += "تفاصيل الجداول الـ 13:\n";
        txt += "-----------------------------------------------------------------\n";
        for (const [key, t] of Object.entries(report.tablesReport)) {
            const icon = t.status === "MATCHED" ? "✅" : (t.status === "PRESENT" || t.status === "WARNING_COLUMNS_MISSING" ? "⚠️" : "❌");
            txt += icon + " " + t.arabicName + " [" + t.tableName + "]\n";
            txt += "    الحالة: " + t.status + " | السجلات: " + t.recordsCount.toLocaleString("ar-EG") + "\n";
            if (t.missingCriticalColumns.length > 0) {
                txt += "    الأعمدة الحرجة الناقصة: " + t.missingCriticalColumns.join(", ") + "\n";
            }
            if (t.missingExpectedColumns.length > 0) {
                txt += "    الأعمدة المتوقعة الناقصة: " + t.missingExpectedColumns.join(", ") + "\n";
            }
            if (t.extraColumns.length > 0) {
                txt += "    أعمدة إضافية في ملف أكسس: " + t.extraColumns.join(", ") + "\n";
            }
            txt += "\n";
        }
        txt += "=================================================================\n";

        fs.writeFileSync(path.join(logsDir, "schema_validation_report.txt"), txt, "utf8");
        console.log("[SCHEMA VALIDATOR] Report saved to logs/schema_validation_report.txt (Status: " + report.overallStatus + ")");
    } catch (e) {
        console.error("[SCHEMA VALIDATOR] Failed to save log files:", e.message);
    }

    return report;
}

module.exports = {
    EXPECTED_SCHEMA,
    validateSchema
};
