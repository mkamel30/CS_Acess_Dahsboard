/**
 * SmartCS AI Assistant - Text-to-SQL Engine
 * Powered by OpenRouter API with Strict SQLite Read-Only Safety Sandbox
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const TRAINING_FILE = path.join(__dirname, 'AI_TRAINING_KNOWLEDGE.md');

function readConfigSafely() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

// Verified training knowledge is loaded per question so the .md file stays the single source of truth.
// {TOKENS} inside it are replaced with the real current date at build time.
function readVerifiedTraining(dates) {
    try {
        if (fs.existsSync(TRAINING_FILE)) {
            const text = fs.readFileSync(TRAINING_FILE, 'utf8').trim();
            return text
                .replace(/\{TODAY_ACCESS\}/g, dates.accessDate)
                .replace(/\{TODAY_ISO\}/g, dates.isoDate)
                .replace(/\{MONTH_ACCESS\}/g, dates.accessMonth)
                .replace(/\{MONTH_ISO\}/g, dates.isoMonth)
                .replace(/\{YEAR2\}/g, String(dates.year).slice(-2))
                .replace(/\{YEAR\}/g, dates.year);
        }
    } catch (e) {}
    return '';
}

function getFormattedSystemDates() {
    const d = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    const mon = months[d.getMonth()];
    const yr2 = String(d.getFullYear()).slice(-2);
    const yr4 = String(d.getFullYear());
    const isoMon = String(d.getMonth() + 1).padStart(2, '0');
    return {
        accessDate: `${day}-${mon}-${yr2}`,          // e.g. '17-Sep-26'
        accessMonth: `-${mon}-${yr2}`,               // e.g. '-Sep-26'
        accessDateFull: `${day}-${mon}-${yr4}`,      // e.g. '17-Sep-2026'
        isoDate: `${yr4}-${isoMon}-${day}`,          // e.g. '2026-09-17'
        isoMonth: `${yr4}-${isoMon}`,                // e.g. '2026-09'
        year: yr4
    };
}

function buildSystemPrompt() {
    const dates = getFormattedSystemDates();
    let prompt = `You are an elite SQLite Data Analyst and Senior BI Engineer for the SmartCS Enterprise System (Egypt Smart Cards & POS Bakery Management System).
Your task is to translate user questions written in Arabic (Egyptian dialect or Modern Standard Arabic) into highly optimized, accurate, read-only SQLite SQL queries.

### CRITICAL CALENDAR & DATE HANDLING RULES (VERY IMPORTANT):
- TODAY'S DATE:
  * Access DB text format: '${dates.accessDate}' (e.g. '17-Sep-26')
  * ISO text format: '${dates.isoDate}' (e.g. '2026-09-17')
  * Current Month: '${dates.accessMonth}' or '${dates.isoMonth}'
  * Current Year: '${dates.year}'
- In the database, dates are stored as TEXT strings. Access-mirror (_raw) tables plus tickets.issue_date/close_date use Access format ('${dates.accessDate}'), often with an ENGLISH time suffix (e.g. '${dates.accessDate} 11:22:19 AM' — always AM/PM, never Arabic ص/م). System/normalized tables (tickets.entry_time, temp_transfer, sync_history, audit_change_logs...) use ISO format ('${dates.isoDate} 11:22:19'). Some tickets rows carry ISO timestamps, so ALWAYS check BOTH formats with OR + LIKE.
- For questions about "اليوم" or "النهاردة" or "خلال اليوم" (today): ALWAYS check BOTH formats using OR with LIKE:
  \`("col" LIKE '%${dates.accessDate}%' OR "col" LIKE '%${dates.isoDate}%')\`
  Example for today's spare parts:
  \`SELECT COALESCE(SUM(CAST("count_out" AS INTEGER)),0) AS total_parts_out_today FROM store_sp_maintenance_raw WHERE ("out_date" LIKE '%${dates.accessDate}%' OR "out_date" LIKE '%${dates.isoDate}%')\`
  Example for today's maintenance:
  \`SELECT COUNT(*) FROM maintenance_raw WHERE ("Checked In Date" LIKE '%${dates.accessDate}%' OR "Checked In Date" LIKE '%${dates.isoDate}%')\`
- For questions about "هذا الشهر" / "الشهر ده" (this month): ALWAYS check BOTH month formats using OR:
  \`("col" LIKE '%${dates.accessMonth}%' OR "col" LIKE '%${dates.isoMonth}%')\`
- NEVER use SQLite \`DATE(col) = DATE('now')\` directly because it will return NULL on Access dates!
- ALWAYS use \`LIKE '%...%'\` instead of exact equality \`=\` because timestamp strings are often appended to dates.

### DATABASE SCHEMA & COLUMN MAPPINGS (SQLite):

1. **assets_raw** (All installed POS machines, bakeries & merchants):
   - "ID" (TEXT): Record ID
   - "POS" (TEXT): Machine Hardware Serial Number (سيريال الماكينة الفعلي مثل 2330123394، 3H248698 - وهو الذي يربط مع "Unit Serial" في الصيانة ومع Serial في المخزن)
   - "POSID" (TEXT): Terminal ID on the system (معرّف الترمنال — لكل POS معرّف ثابت يبقى كما هو عند استبدال الماكينة، مثل 010001)
   - "bkcode" (TEXT): Merchant/Client Code (كود العميل/المخبز — يطابق merchants.merchant_code و transactions_raw.GrocerName؛ استخدمه للربط مع التجار وليس POSID)
   - "Model" (TEXT): Device Model (e.g. 'Pax S900', 'Verifone VX520', 'Newland', 'Nexgo')
   - "Manufacturer" (TEXT): Manufacturer name
   - "Condition" (TEXT): Constant '(2) Good' in ALL rows — DO NOT use it to find faulty machines (use devices.status='faulty', store_pos_raw.faulty='True', or maintenance records instead)
   - "SupplyOffice" (TEXT): Supply office name (مكتب التموين)
   - "Address" (TEXT): Address or governorate name (المحافظة / المركز / العنوان)
   - "GrocerNumber" (TEXT): "Damen ID" (رقم الضامن) — NOT the merchant code; almost always empty, do not join on it
   - "Contact_person" (TEXT): Merchant / Bakery Owner Name (اسم صاحب المخبز أو المسؤول)
   - "telephone_1", "telephone_2" (TEXT): Contact phone numbers
   - "Cell_Serial" (TEXT): SIM Card Serial installed in the device
   - "PinpadSerial" (TEXT): Connected Pinpad serial
   - "UPS" (TEXT): Connected UPS battery serial

2. **maintenance_raw** (Maintenance operations, tickets & repairs):
   - "ID" (TEXT): Maintenance Record ID
   - "Unit Serial" (TEXT): Serial number of device being repaired (سيريال الجهاز)
   - "Model" (TEXT): Machine Model
   - "Checked Out To" (TEXT): Technician Name (اسم الفني) — often EMPTY in recent rows; always use COALESCE(NULLIF(TRIM("Checked Out To"),''), TRIM("Procedure")) for the technician
   - "Checked Out Date" (TEXT): Date sent to maintenance (تاريخ الخروج للصيانة)
   - "Checked In Date" (TEXT): Date returned/fixed (تاريخ الدخول/الإصلاح)
   - "Notes" (TEXT): PRIMARY FAULT / REPAIR DESCRIPTION entered by technicians (وصف العطل الأساسي مثل: بورده رئيسيه، قارئ بطاقات، مدخل باور، شاشة، بطارية). *CRITICAL: When the user asks about faults (الأعطال) or repair issues, query the "Notes" column (or COALESCE(NULLIF(Notes, ''), NULLIF(Procedure, '')))*!
   - "Procedure" (TEXT): Action taken / repair details (الإجراء المتبع)
   - "Checked Out Condition" (TEXT): Often empty in legacy data; always fallback to Notes
   - "Checked In Condition" (TEXT): Repair status / outcome (حالة الجهاز بعد الإصلاح)

3. **transactions_raw** (Client VISITS to the branch — سجل زيارات العملاء للفرع؛ every row = one visit, currently all maintenance visits):
   - "GrocerName" (TEXT): Client/Bakery CODE (كود العميل وليس اسماً — يطابق merchants.merchant_code و assets_raw.bkcode)
   - "POSN" (TEXT): Machine hardware serial (سيريال الماكينة)
   - "Place" (TEXT): Visit location ('فرع الشركة' = the branch)
   - "ActionType" (TEXT): Visit purpose. ACTUAL values in this DB: 'اصلاح عطل', 'صيانة أولية', 'مسارات القارئ - البوردة', 'تحتاج قارئ', 'مسارات قديمة - البوردة'
   - "IssueDate" (TEXT): Visit registration date — ALWAYS populated
   - "ActionDate" (TEXT): Execution date — empty in ~1273 rows; use COALESCE(NULLIF(TRIM("ActionDate"),''), "IssueDate")
   - "NoteG" (TEXT): Faulty part category (الجزء المتعطل), "NoteD" (TEXT): Action performed (الإجراء المتبع)
   - "Procedure" (TEXT): Branch technician (الفني — أسماء بمسافة زائدة، TRIM قبل المقارنة)
   - "FeesAmount" (TEXT): Fees / Cost in EGP; "Fees"/"Paid" (TEXT): 'True'/'False' flags

4. **payments_raw** (Financial receipts, post office & bank deposits):
   - "payment_amount" (TEXT): Paid amount in EGP (المبلغ المدفوع بالجنيه)
   - "payment_date" (TEXT): Payment Date (تاريخ الدفع)
   - "payer" (TEXT): Name of payer / merchant (اسم الدافع)
   - "payment_reason" (TEXT): Reason (سبب التوريد: صيانة، غرامة، شريحة...)
   - "payment_place" (TEXT): Location of deposit (مكتب البريد، بنك مصر...)
   - "ref_num" (TEXT): Receipt reference / deposit slip number (رقم الإيصال أو الدفع)
   - "pos_number" (TEXT): POS Machine Code

5. **store_pos_raw** (Warehouse POS Machines stock):
   - "Serial" (TEXT): Device Serial
   - "Model" (TEXT): POS Model
   - "faulty" (TEXT): Is faulty? ACTUAL values: 'True' / 'False' (English)
   - "pos_status" (TEXT): Mostly EMPTY (174/207) or 'Branch' — do not rely on it for stock status

6. **store_sp_raw** (قطع الغيار المسحوبة من مخزن الفرع - Spare parts taken from the Branch warehouse):
   - يمثل قطع الغيار التي تم تغييرها أو استهلاكها أو صرفها في **الفرع** (Branch Local Store).
   - "type" (TEXT): اسم قطعة الغيار (بطارية داخلية، قارئ بطاقات، مجموعة تروس...)
   - "notes" (TEXT): سيريال الماكينة التي رُكبت فيها القطعة (يرتبط مع assets_raw.POS و transactions_raw.POSN)
   - "Serial" (TEXT): نص مركب (رقم الإيصال - اسم القطعة - كود العميل - مجاني/مدفوع). القطعة المجانية: "Serial" LIKE '%مجاني%'
   - ⚠️ "count_out" (TEXT): ALWAYS '0' in EVERY row — NEVER use it for branch consumption!
   - "count_in" (TEXT): NEGATIVE = parts consumed/taken out (-1, -2, -8...), POSITIVE = parts received into stock.
     Parts consumed = SUM(CASE WHEN CAST("count_in" AS INTEGER) < 0 THEN -CAST("count_in" AS INTEGER) ELSE 0 END)
   - "out_date" (TEXT): تاريخ الصرف (العمود الزمني الأساسي), "in_date" (TEXT): تاريخ التوريد (فارغ في 97% من الصفوف)

7. **store_sp_maintenance_raw** (قطع غيار مركز الصيانة الرئيسي - Central HQ Maintenance Spare Parts):
   - يمثل قطع الغيار التي تم تغييرها أو صرفها لعمليات الإصلاح في **مركز الصيانة الرئيسي / المقر** (HQ Maintenance).
   - "type" (TEXT): اسم قطعة الغيار (قارئ بطاقات، لوحة المفاتيح، بوردة، بطارية...)
   - "Model" (TEXT): موديل الماكينة
   - "count_out" (TEXT): الكمية المنصرفة في مركز الصيانة
   - "out_date" (TEXT): تاريخ الصرف
   - "formNo" (TEXT): رقم نموذج الصيانة (Form No)

8. **store_sim_raw** (SIM cards warehouse stock):
   - "sim_serial" (TEXT): SIM Serial
   - "network" (TEXT): 100% EMPTY — do not use. Carrier is in "sim_type" (e.g. 'Orange') or sim_cards.carrier ('Vodafone'/'Orange'/'Etisalat' — mixed case, use COLLATE NOCASE)
   - "faulty" (TEXT): Is faulty? ('True' / 'False')
   - "sim_type" (TEXT): Carrier / card type (الناقل فعلياً هنا)

9. **installments_raw** / **tblinstallments** (عقود وأقساط الماكينات):
   - "pos" (TEXT): كود الماكينة/المخبز (يرتبط مع assets_raw.POS)
   - "installments" (TEXT/INT): عدد الأقساط الإجمالي
   - "unitprice" (TEXT/REAL): سعر الوحدة
   - "monthlyinstallmentprice" (TEXT/REAL): قيمة القسط الشهري
   - "finalunitprice" (TEXT/REAL): السعر النهائي الإجمالي للماكينة

10. **temp_transfer_raw** (حركات استبدال الماكينات المؤقتة):
    - "POSCode" (TEXT): كود الماكينة
    - "OldPOS" (TEXT): سيريال الماكينة المعطلة المستلمة للصيانة
    - "NewPOS" (TEXT): سيريال الماكينة البديلة المسلمة للعميل
    - "Transfer_Date" (TEXT): تاريخ الاستبدال
    - "bkCode" (TEXT): كود المخبز

11. **failure_points_raw** (لائحة أسعار قطع الغيار ورسوم الصيانة):
    - "type" (TEXT): اسم قطعة الغيار
    - "model" (TEXT): موديل الجهاز المتوافق
    - "fees" (TEXT): PAYMENT CODE, not a number! '$' = paid, 'F' = free, '$-F' = both. "price" is the EGP amount. "model" may list multiple models ('S90;D210') → use LIKE not =
    - "price" (TEXT/REAL): سعر بيع القطعة

12. **tblfaults_raw** (قاموس الأعطال):
    - "faultid" (TEXT), "FaultName" (TEXT): Fault name

13. **tblfixes_raw** (دليل الحلول والإصلاحات الفنية):
    - "FixID" (TEXT), "FaultID" (TEXT), "FixName" (TEXT)

14. **tblstaff_raw** (Staff & Technicians directory):
    - "name" (TEXT): Staff / Tech name
    - "jtitle" (TEXT): Job title

15. **merchants**, **devices**, **merchant_assets**, **tickets** (الكيانات المعيارية للنظام):
    - "merchants" (merchant_code, name, type, address, government, contact_phone)
    - "devices" (serial, manufacturer, model, status, faulty_details)
    - "merchant_assets" (merchant_code, device_id, sim_card_id, assigned_date)
    - "tickets" (id, merchant_code, device_id, status, issue_details, technician_name, issue_date, close_date, hq_debt)

---

### CROSS-TABLE RELATIONSHIPS & JOIN RULES (خريطة العلاقات والربط بين الجداول):
- **الأصول مع الصيانة**:
  \`assets_raw.POS = maintenance_raw."Unit Serial"\` (حيث POS في جدول assets_raw هو سيريال الماكينة الفعلي)
- **الصيانة مع قطع غيار مركز الصيانة (HQ)**:
  \`maintenance_raw.FormNo = store_sp_maintenance_raw.formNo\` (رقم نموذج الصيانة يربط الجهاز بالقطع المصروفة له)
- **الأصول مع الأقساط**:
  \`assets_raw.POS = installments_raw.pos\` (السيريال فقط — POSID لا يطابق أبداً)
- **الأقساط مع المدفوعات**:
  \`installments_raw.pos = payments_raw.pos_number\` (مع تصفية: \`payments_raw.payment_reason LIKE '%قسط%'\`)
- **الأصول مع الشريحة**:
  \`assets_raw.Cell_Serial = store_sim_raw.sim_serial\`
- **الماكينات المستبدلة مؤقتاً**:
  \`REPLACE(temp_transfer_raw.OldPOS,'M-','') = assets_raw.POS\` (السيريالات قد تحمل بادئة M- — جرّدها عند المطابقة)
- **أسعار قطع الغيار**:
  \`store_sp_raw.type = failure_points_raw.type\` و \`store_sp_maintenance_raw.type = failure_points_raw.type\`
- **الفنيين مع الصيانة**:
  \`maintenance_raw."Checked Out To" = tblstaff_raw.name\` أو \`maintenance_raw.Procedure = tblstaff_raw.name\`

---

### CRITICAL BUSINESS RULES FOR BRANCH MAINTENANCE (صيانة الفرع):
- صيانة الماكينات في **الفرع** تنقسم إلى حالتين أساسيتين:
  1. **صيانة فقط (اصلاح عطل / صيانة أولية بدون قطع غيار)**:
     - تُسجل في جدول \`transactions_raw\`.
     - \`POSN\`: سيريال الماكينة التي تمت صيانتها في الفرع.
     - \`GrocerName\`: كود المخبز / التاجر.
     - \`ActionDate\`: تاريخ ووقت الصيانة.
     - \`ActionType\`: نوع الصيانة (مثل: 'اصلاح عطل', 'صيانة أولية').
     - \`NoteG\`: الجزء المتعطل (قارئ البطاقات، الطابعة، الباور).
     - \`NoteD\`: تفاصيل ما تم في الصيانة بالفرع (مثل: 'اصلاح القارئ', 'تغير مجموعة تروس', 'صيانة سوكت').
     - \`Procedure\`: فني الصيانة القائم بالإصلاح بالفرع.
     - \`Place\`: مكان الصيانة ('فرع الشركة').
  2. **صيانة مع تغيير قطع غيار في الفرع**:
     - قطع الغيار التي رُكبت بالفرع تُسجل في جدول \`store_sp_raw\`.
     - في جدول \`store_sp_raw\`:
       * عمود \`notes\` يحتوي على سيريال الماكينة (\`store_sp_raw.notes = transactions_raw.POSN\`).
       * عمود \`type\` هو اسم قطعة الغيار التي تم تغييرها (قارئ بطاقات، تروس، بطارية، اكس...).
       * عمود \`out_date\` هو تاريخ ووقت صرف وتركيب القطعة.
  3. **للربط بين صيانة الفرع وقطع الغيار المركبة للماكينة**:
     \`\`\`sql
     SELECT t.POSN AS machine_serial,
            t.GrocerName AS merchant_code,
            t.ActionDate,
            t.ActionType,
            t.NoteD AS maintenance_action,
            t.Procedure AS technician,
            sp.type AS spare_part_replaced
     FROM transactions_raw t
     LEFT JOIN store_sp_raw sp 
       ON t.POSN = sp.notes 
      AND (sp.out_date LIKE '%' || SUBSTR(t.ActionDate, 1, 9) || '%' OR sp.out_date LIKE '%' || SUBSTR(t.ActionDate, 1, 10) || '%')
     \`\`\`
  - عند السؤال عن "الماكينات التي تمت صيانتها في الفرع": استعلم من \`transactions_raw\` (حيث Place LIKE '%فرع%' أو ActionType LIKE '%اصلاح%' أو '%صيانة%') مع عمل LEFT JOIN لـ \`store_sp_raw\` لإظهار قطع الغيار إن وجدت!
  - عند السؤال عن "صيانة الفرع التي تم فيها تغيير قطع غيار": اشترط وجود القطعة في \`store_sp_raw\` (\`sp.type IS NOT NULL\`).
  - عند السؤال عن "صيانة الفرع بدون قطع غيار (صيانة فقط)": اشترط \`sp.notes IS NULL\`.

---

### CRITICAL BUSINESS RULES FOR SPARE PARTS (التمييز الحاسم بين الفرع ومركز الصيانة):
- إذا سأل المستخدم عن قطع الغيار التي تم تغييرها أو صرفها في **الفرع** (Branch): استخدم حصراً جدول \`store_sp_raw\` (حيث عمود notes يحمل سيريال الماكينة وعمود type هو اسم القطعة).
- إذا سأل المستخدم عن قطع الغيار التي تم تغييرها أو صرفها في **مركز الصيانة الرئيسي** أو **المقر** (HQ): استخدم حصراً جدول \`store_sp_maintenance_raw\` (حيث عمود formNo يربط مع FormNo في maintenance_raw).
- إذا سأل عن قطع الغيار المنصرفة اليوم إجمالاً (أو بدون تحديد): يمكنك دمج الجدولين بـ UNION ALL مع تمييز المصدر، أو الاستعلام عن مركز الصيانة والفرع.

---

### CRITICAL SQL RULES:
1. Return ONLY a valid JSON object with EXACTLY this structure:
   {
     "sql": "SELECT ...",
     "explanation": "شرح موجز باللغة العربية للنتائج وكيف تم حسابها",
     "suggested_title": "عنوان قصير جذاب للتقرير"
   }
2. Output NO other text, NO markdown backticks (\`\`\`json), ONLY the raw JSON string.
3. The SQL query MUST be a pure read-only \`SELECT\` statement.
4. If column names have spaces, quote them with double quotes, e.g. "Unit Serial", "Checked Out To", "Checked Out Date", "Acquired Date".
5. Use SQLite string functions when searching Arabic text: \`LIKE '%...%'\` or \`COLLATE NOCASE\`.
6. For numeric calculations on TEXT columns (e.g. payment_amount, count_in, FeesAmount), use \`CAST(NULLIF("payment_amount", '') AS REAL)\`. HQ parts: \`SUM(CAST("count_out" AS INTEGER))\` on store_sp_maintenance_raw ONLY. Branch parts (store_sp_raw): sum NEGATIVE count_in as described above — count_out there is always 0.
7. Always append \`LIMIT 100\` unless an explicit smaller limit or an aggregate (like single row \`COUNT(*)\`) is requested.
8. NEVER execute or generate \`INSERT\`, \`UPDATE\`, \`DELETE\`, \`DROP\`, \`ALTER\`, \`CREATE\`, \`REPLACE\`, \`PRAGMA\`, \`ATTACH\`, \`DETACH\`, \`VACUUM\`.`;

    const training = readVerifiedTraining(dates);
    if (training) {
        prompt += `\n\n---\n\n### VERIFIED SCHEMA & BUSINESS KNOWLEDGE (تم التحقق من البيانات الفعلية — THESE RULES OVERRIDE ANY CONFLICTING INSTRUCTIONS ABOVE):\n${training}\n`;
    }

    const config = readConfigSafely();
    const customKnowledge = (config.customKnowledge || '').trim();
    if (customKnowledge) {
        prompt += `\n\n---\n\n### USER-DEFINED BUSINESS RULES & CUSTOM TRAINING (قواعد وتدريب مخصص من مدير النظام):\n${customKnowledge}\n`;
    }

    return prompt;
}

// Compact schema prompt used ONLY as a fallback when the full prompt exceeds the
// provider's per-request token budget (Groq HTTP 413 "Request too large ... TPM").
// It keeps the essential table/column map, the date rule and the output contract,
// but drops the verbose business-rule prose, verified-training and custom knowledge.
function buildSystemPromptLite() {
    const dates = getFormattedSystemDates();
    return `You are an elite SQLite/BI analyst for SmartCS (Egypt Smart Cards & POS Bakery system). Translate Arabic questions into read-only SQLite SELECT queries.

DATES (TEXT): Access-mirror _raw tables use '${dates.accessDate}' (e.g. '17-Sep-26'); system tables (tickets, temp_transfer, sync_history) use ISO '${dates.isoDate}'. NEVER DATE(col)=DATE('now'). For "today" use: ("col" LIKE '%${dates.accessDate}%' OR "col" LIKE '%${dates.isoDate}%'). For "this month" use LIKE '%${dates.accessMonth}%' OR '%${dates.isoMonth}%'.

TABLES (key cols):
- assets_raw: ID, POS(=machine serial), POSID(=terminal id), bkcode(=merchant code), Model, Manufacturer, Condition(always '(2) Good' - ignore), SupplyOffice, Address, Contact_person, telephone_1/2, Cell_Serial, PinpadSerial, UPS.
- maintenance_raw: ID, "Unit Serial", Model, "Checked Out To"(tech, often empty->COALESCE w/ Procedure), "Checked Out Date", "Checked In Date", Notes(PRIMARY FAULT desc), Procedure, "Checked In Condition".
- transactions_raw (branch visits/repairs): GrocerName(=merchant CODE, matches bkcode), POSN(machine serial), Place, ActionType, IssueDate, ActionDate(maybe empty->COALESCE w/ IssueDate), NoteG(faulty part), NoteD(action), Procedure(tech), FeesAmount, Fees/Paid.
- payments_raw: payment_amount, payment_date, payer, payment_reason, payment_place, ref_num, pos_number.
- store_pos_raw: Serial, Model, faulty('True'/'False'), pos_status(mostly empty).
- store_sp_raw (BRANCH spare parts): type(part name), notes(=machine serial), Serial, count_out(ALWAYS '0' ignore), count_in(NEGATIVE=consumed; consumed=-SUM(count_in<0)), out_date, in_date.
- store_sp_maintenance_raw (HQ spare parts): type, Model, count_out, out_date, formNo.
- store_sim_raw: sim_serial, network(empty; carrier in sim_type), faulty, sim_type.
- installments_raw: pos(=assets.POS), installments, unitprice, monthlyinstallmentprice, finalunitprice.
- temp_transfer_raw: POSCode, OldPOS, NewPOS, Transfer_Date, bkCode.
- failure_points_raw (price list): type, model(LIKE not =), fees('$'paid/'F'free), price.
- tblfaults_raw: faultid, FaultName. tblfixes_raw: FixID, FaultID, FixName. tblstaff_raw: name, jtitle.
- merchants(merchant_code,name,type,address,government,contact_phone); devices(serial,manufacturer,model,status,faulty_details); merchant_assets(merchant_code,device_id,sim_card_id,assigned_date); tickets(id,merchant_code,device_id,status,issue_details,technician_name,issue_date,close_date,hq_debt).

JOINS: assets_raw.POS=maintenance_raw."Unit Serial"; maintenance_raw.FormNo=store_sp_maintenance_raw.formNo; assets_raw.POS=installments_raw.pos; store_sp_raw.notes=transactions_raw.POSN; store_sp_raw.type=failure_points_raw.type.

BRANCH vs HQ parts: branch=store_sp_raw (notes=serial, type=name, sum NEGATIVE count_in); HQ=store_sp_maintenance_raw (count_out, formNo).

OUTPUT: ONLY a raw JSON object (no markdown): {"sql":"SELECT ...","explanation":"شرح عربي موجز","suggested_title":"عنوان قصير"}. Quote spaced columns with double quotes. Append LIMIT 100 unless aggregate/smaller limit. Read-only SELECT only; never INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/REPLACE/PRAGMA/ATTACH/VACUUM.`;
}

// -------------------------------------------------------------
// 2. Strict SQL Safety Sandbox
// -------------------------------------------------------------
function validateSqlSafety(sql) {
    if (!sql || typeof sql !== 'string') {
        return { safe: false, error: 'استعلام الـ SQL فارغ أو غير صالح.' };
    }

    const trimmed = sql.trim();

    // Check 1: Must start with SELECT or WITH (for CTEs)
    if (!/^(SELECT|WITH)\s/i.test(trimmed)) {
        return { safe: false, error: 'غير مسموح إلا باستعلامات القراءة فقط (SELECT).' };
    }

    // Check 2: Strictly forbid destructive or modifying keywords
    const forbiddenPatterns = [
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE)\b/i,
        /\b(ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b/i,
        /\b(EXEC|EXECUTE|SCRIPT|SYSTEM|SHELL)\b/i
    ];

    for (const pattern of forbiddenPatterns) {
        if (pattern.test(trimmed)) {
            return { safe: false, error: `الاستعلام يحتوي على كلمات محظورة لدواعي الأمان (${pattern.source}).` };
        }
    }

    // Check 3: Check for statement stacking (multiple statements via semicolon)
    const withoutStrings = trimmed.replace(/'(?:''|[^'])*'/g, "''").replace(/"(?:""|[^"])*"/g, '""');
    const statements = withoutStrings.split(';').filter(s => s.trim().length > 0);
    if (statements.length > 1) {
        return { safe: false, error: 'غير مسموح بتنفيذ أكثر من استعلام واحد في نفس الوقت.' };
    }

    // Check 4: Enforce safety LIMIT
    let safeSql = trimmed.replace(/;+\s*$/, ''); // remove trailing semicolons
    if (!/\bLIMIT\s+\d+/i.test(safeSql) && !/COUNT\s*\(/i.test(safeSql)) {
        safeSql += ' LIMIT 100';
    }

    return { safe: true, sanitizedSql: safeSql };
}

// -------------------------------------------------------------
async function callLlmApi(prompt, question, modelOverride, apiKeyOverride, isLitePrompt = false) {
    const config = readConfigSafely();
    let targetModel = modelOverride || config.openRouterModel || '';
    let provider = 'openrouter';
    let apiKey = (apiKeyOverride || '').trim();

    // 1. Determine provider from model name
    if (targetModel.startsWith('deepseek')) {
        provider = 'deepseek';
    } else if (targetModel.startsWith('openai/gpt-oss') || targetModel.startsWith('qwen/qwen3.8')) {
        provider = 'groq';
    } else if (targetModel.includes('openrouter') || targetModel.includes(':free')) {
        provider = 'openrouter';
    }

    // 2. Resolve API key if not manually overridden
    if (!apiKey) {
        if (provider === 'deepseek') {
            apiKey = (config.deepseekApiKey || process.env.DEEPSEEK_API_KEY || '').trim();
        } else if (provider === 'groq') {
            apiKey = (config.groqApiKey || process.env.GROQ_API_KEY || '').trim();
        } else if (provider === 'openrouter') {
            apiKey = (config.openRouterApiKey || process.env.OPENROUTER_API_KEY || '').trim();
            if (apiKey && !apiKey.startsWith('sk-or-')) {
                apiKey = '';
            }
        }

        // Fallback key search if selected provider has no key configured
        if (!apiKey) {
            if (config.groqApiKey) {
                apiKey = config.groqApiKey.trim();
                provider = 'groq';
                if (!modelOverride) targetModel = 'openai/gpt-oss-120b';
            } else if (config.deepseekApiKey) {
                apiKey = config.deepseekApiKey.trim();
                provider = 'deepseek';
                if (!modelOverride) targetModel = 'deepseek-chat';
            } else if (config.openRouterApiKey) {
                apiKey = config.openRouterApiKey.trim();
                provider = 'openrouter';
                if (!modelOverride) targetModel = 'openrouter/free';
            } else if (process.env.GROQ_API_KEY) {
                apiKey = process.env.GROQ_API_KEY.trim();
                provider = 'groq';
            } else if (process.env.DEEPSEEK_API_KEY) {
                apiKey = process.env.DEEPSEEK_API_KEY.trim();
                provider = 'deepseek';
            } else if (process.env.OPENROUTER_API_KEY) {
                apiKey = process.env.OPENROUTER_API_KEY.trim();
                provider = 'openrouter';
            }
        }
    } else {
        // If apiKeyOverride was passed, detect provider by key format
        if (apiKey.startsWith('gsk_')) {
            provider = 'groq';
        } else if (apiKey.startsWith('sk-or-')) {
            provider = 'openrouter';
        } else if (apiKey.startsWith('sk-')) {
            provider = 'deepseek';
        }
    }

    if (!apiKey) {
        throw new Error('مفتاح الـ API غير مضبوط. يرجى إدخال مفتاح المزود (Groq أو DeepSeek أو OpenRouter) من إعدادات الـ AI أولاً.');
    }

    // 3. Set endpoint and normalize model per provider
    let endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    let model = targetModel;

    if (provider === 'groq') {
        endpoint = 'https://api.groq.com/openai/v1/chat/completions';
        if (!model || model.includes('openrouter') || model.includes(':free') || model.startsWith('deepseek')) {
            model = 'openai/gpt-oss-120b';
        }
    } else if (provider === 'deepseek') {
        endpoint = 'https://api.deepseek.com/chat/completions';
        if (!model || !model.startsWith('deepseek')) {
            model = 'deepseek-chat';
        }
    } else {
        endpoint = 'https://openrouter.ai/api/v1/chat/completions';
        if (!model || model.startsWith('openai/') || model.startsWith('deepseek')) {
            model = 'openrouter/free';
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000); // 35s timeout

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
    if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'http://localhost:8970';
        headers['X-Title'] = 'SmartCS AI Copilot';
    }

    const requestBody = {
        model: model,
        messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: question }
        ]
    };

    // DeepSeek-Reasoner (R1) does not support temperature or response_format
    if (model === 'deepseek-reasoner') {
        // Leave temperature to default, no response_format
    } else {
        requestBody.temperature = 0.1;
        if (provider === 'groq' || model === 'deepseek-chat') {
            requestBody.response_format = { type: 'json_object' };
        }
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            signal: controller.signal,
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errText = await response.text();

            // Resilient Rate-Limit Fallback Chain for Groq
            if (response.status === 429 && provider === 'groq' && model === 'openai/gpt-oss-120b') {
                console.warn('[AI COPILOT] Groq 120B rate limit reached. Auto-falling back to ultra-fast 20B model ⚡');
                return await callLlmApi(prompt, question, 'openai/gpt-oss-20b', apiKeyOverride, isLitePrompt);
            }
            if (response.status === 429 && provider === 'groq' && model === 'openai/gpt-oss-20b') {
                console.warn('[AI COPILOT] Groq 20B rate limit reached. Auto-falling back to Qwen 3.8 model ⚡');
                return await callLlmApi(prompt, question, 'qwen/qwen3.8-27b', apiKeyOverride, isLitePrompt);
            }

            // Groq HTTP 413 "Request too large ... tokens per minute (TPM)": the prompt itself
            // exceeds the model's per-request budget. Retry ONCE with the compacted schema prompt
            // (drops verbose rules/training/custom-knowledge) so small free-tier models still answer.
            const isTooLarge = response.status === 413 || /Request too large|tokens per minute|reduce your message size/i.test(errText);
            if (provider === 'groq' && isTooLarge && !isLitePrompt) {
                console.warn('[AI COPILOT] Groq prompt exceeded TPM budget (413). Retrying with compacted schema prompt...');
                return await callLlmApi(buildSystemPromptLite(), question, model, apiKeyOverride, true);
            }
            if (provider === 'groq' && isTooLarge) {
                throw new Error('خطأ من خادم Groq (413): حتى الطلب المختصر تجاوز حدّ الرموز للدقيقة (TPM) على هذه الخطة. اختصر سؤالك أكثر، أو استخدم موديل `openai/gpt-oss-120b`، أو قم بالترقية إلى خطة Dev Tier من console.groq.com.');
            }

            // Friendly DeepSeek Insufficient Balance handling
            if (provider === 'deepseek' && (response.status === 402 || errText.includes('Insufficient Balance'))) {
                throw new Error('خطأ من خادم DeepSeek (402): الرصيد غير كافٍ في حساب DeepSeek (Insufficient Balance). يرجى شحن الرصيد من platform.deepseek.com أو التبديل إلى موديلات Groq المجانية فائقة السرعة ⚡');
            }

            // Friendly OpenRouter 401 Authentication error handling
            if (provider === 'openrouter' && (response.status === 401 || errText.includes('Missing Authentication header'))) {
                throw new Error('خطأ مصادقة OpenRouter (401): مفتاح OpenRouter غير صالح أو تم إدخال مفتاح ديب سيك بدلاً منه. يرجى إدخال مفتاح يبدأ بـ sk-or-v1-... في نافذة إعدادات المفتاح والموديل ⚙️ أو التبديل إلى موديلات Groq المجانية ⚡');
            }

            const providerLabels = { groq: 'Groq', deepseek: 'DeepSeek', openrouter: 'OpenRouter' };
            const providerName = providerLabels[provider] || provider;
            throw new Error(`خطأ من خادم ${providerName} (${response.status}): ${errText}`);
        }

        const json = await response.json();
        const rawContent = json.choices?.[0]?.message?.content || '';
        
        return {
            content: rawContent,
            modelUsed: json.model || model,
            provider: provider,
            usage: json.usage || {}
        };
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            throw new Error('استغرقت استجابة الذكاء الاصطناعي وقتاً أطول من المعتاد (انتهت مهلة 35 ثانية).');
        }
        throw err;
    }
}

// -------------------------------------------------------------
// 4. Ultra-Resilient Parser for LLM Output (Handles <think>, raw SQL, malformed JSON)
// -------------------------------------------------------------
function extractJsonFromLlmOutput(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;

    // Step 4.1: Strip reasoning/thinking blocks (DeepSeek R1, QwQ, etc.)
    let text = rawText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .trim();

    // Helper to safely parse JSON or fix trailing commas
    function tryParseJson(str) {
        if (!str) return null;
        try {
            return JSON.parse(str);
        } catch (e) {
            try {
                const fixed = str.replace(/,\s*([}\]])/g, '$1');
                return JSON.parse(fixed);
            } catch (e2) {
                return null;
            }
        }
    }

    // Step 4.2: Try to find markdown json block ```json ... ```
    const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const jsonCandidate = jsonBlock ? jsonBlock[1].trim() : text;
    let parsed = tryParseJson(jsonCandidate);
    if (parsed && parsed.sql) return parsed;

    // Step 4.3: Try extracting between first { and last }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const braceSub = text.substring(firstBrace, lastBrace + 1);
        parsed = tryParseJson(braceSub);
        if (parsed && parsed.sql) return parsed;

        // Step 4.4: Regex extraction if unescaped quotes broke JSON.parse
        const sqlMatch = braceSub.match(/"sql"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"[a-zA-Z_]+"\s*:|"\s*})/i);
        if (sqlMatch && sqlMatch[1]) {
            const titleMatch = braceSub.match(/"suggested_title"\s*:\s*"([^"]*)"/i);
            const expMatch = braceSub.match(/"explanation"\s*:\s*"([^"]*)"/i);
            return {
                sql: sqlMatch[1].replace(/\\"/g, '"').trim(),
                suggested_title: titleMatch ? titleMatch[1] : 'تقرير تحليلي',
                explanation: expMatch ? expMatch[1] : 'تم استخراج البيانات وفق المعايير المطلوبة.'
            };
        }
    }

    // Step 4.5: Direct SQL Fallback (if LLM returned pure markdown ```sql ... ``` or plain SELECT query)
    const sqlBlock = text.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i);
    const sqlCandidate = sqlBlock ? sqlBlock[1].trim() : text;
    const selectMatch = sqlCandidate.match(/(?:^|\n|\s)(SELECT|WITH)\s+[\s\S]+/i);
    if (selectMatch) {
        let extractedSql = selectMatch[0].trim();
        const semiIdx = extractedSql.indexOf(';');
        if (semiIdx !== -1) {
            extractedSql = extractedSql.substring(0, semiIdx);
        }
        return {
            sql: extractedSql,
            suggested_title: 'تقرير استعلام تحليلي',
            explanation: 'تم استخراج وتوليد استعلام SQL بنجاح.'
        };
    }

    return null;
}

// -------------------------------------------------------------
// 5. Query Execution (Supports both SQLite db object and Dual-DB allQuery function)
// -------------------------------------------------------------
function executeSqlPromise(dbOrQueryFn, sql) {
    return new Promise(async (resolve, reject) => {
        const startTime = Date.now();
        try {
            if (typeof dbOrQueryFn === 'function') {
                const rows = await dbOrQueryFn(sql);
                const durationMs = Date.now() - startTime;
                return resolve({ rows: rows || [], durationMs });
            }
            if (dbOrQueryFn && typeof dbOrQueryFn.all === 'function') {
                dbOrQueryFn.all(sql, [], (err, rows) => {
                    const durationMs = Date.now() - startTime;
                    if (err) return reject({ message: err.message, durationMs });
                    return resolve({ rows: rows || [], durationMs });
                });
                return;
            }
            throw new Error('قاعدة البيانات غير متصلة.');
        } catch (err) {
            const durationMs = Date.now() - startTime;
            return reject({ message: err.message, durationMs });
        }
    });
}

// -------------------------------------------------------------
// 6. Main High-Level Controller: Process User Question
// -------------------------------------------------------------
async function processQuestion(question, options = {}, dbOrQueryFn) {
    if (!question || !question.trim()) {
        return { success: false, error: 'يرجى كتابة السؤال المطلوب.' };
    }

    if (!dbOrQueryFn) {
        return { success: false, error: 'قاعدة البيانات غير متصلة.' };
    }

    const startTime = Date.now();

    try {
        // Step 1: Call LLM
        const systemPrompt = buildSystemPrompt();
        const llmResult = await callLlmApi(
            systemPrompt,
            question.trim(),
            options.model,
            options.apiKey
        );

        // Step 2: Parse JSON
        const parsed = extractJsonFromLlmOutput(llmResult.content);
        if (!parsed || !parsed.sql) {
            console.warn('[AI ASSISTANT] Failed to parse LLM output. Raw response was:\n', llmResult.content);
            return {
                success: false,
                error: 'تعذر على الذكاء الاصطناعي استخراج استعلام SQL صالح من السؤال.',
                rawResponse: llmResult.content
            };
        }

        // Step 3: Safety Validate SQL
        const safetyCheck = validateSqlSafety(parsed.sql);
        if (!safetyCheck.safe) {
            return {
                success: false,
                error: safetyCheck.error,
                sql: parsed.sql
            };
        }

        const finalSql = safetyCheck.sanitizedSql;

        // Step 4: Execute on Database
        let execResult;
        try {
            execResult = await executeSqlPromise(dbOrQueryFn, finalSql);
        } catch (execErr) {
            return {
                success: false,
                error: `خطأ في تنفيذ استعلام قاعدة البيانات: ${execErr.message}`,
                sql: finalSql,
                durationMs: execErr.durationMs
            };
        }

        const rows = execResult.rows;
        const totalTimeMs = Date.now() - startTime;

        // Extract column names
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

        // Build summary stats
        const summaryStats = {
            totalRows: rows.length,
            executionTimeMs: execResult.durationMs,
            totalTimeMs,
            modelUsed: llmResult.modelUsed
        };

        return {
            success: true,
            question: question.trim(),
            suggestedTitle: parsed.suggested_title || 'تقرير التحليل الذكي',
            explanation: parsed.explanation || 'تم استخراج البيانات بنجاح وفق المعايير المحددة.',
            sql: finalSql,
            columns,
            data: rows,
            stats: summaryStats
        };

    } catch (err) {
        return {
            success: false,
            error: err.message || 'حدث خطأ غير متوقع أثناء معالجة السؤال الذكي.',
            totalTimeMs: Date.now() - startTime
        };
    }
}

module.exports = {
    processQuestion,
    validateSqlSafety,
    buildSystemPrompt
};
