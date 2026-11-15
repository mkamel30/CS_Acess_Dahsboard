# SmartCS Text-to-SQL — Verified Training Knowledge
# تم التحقق من كل قاعدة أدناه على البيانات الفعلية في branch_database.db بتاريخ 2026-11-15
# الأولوية: هذه القواعد تلغي أي تعليمات أقدم تتعارض معها (PRIORITY: these rules OVERRIDE any older conflicting instructions).

---

## 1) DATE & TIME RULES (قواعد التواريخ — الأهم)

### Format families (عائلتان من الصيغ فقط، تم التحقق بالعينات):
**A. Access TEXT format `dd-Mon-yy`** — English month abbreviations, zero-padded day, 2-digit year:
- Examples: `19-Aug-26`, `08-Sep-24`, `01-Apr-25`
- Often followed by a time: `19-Aug-26 9:51:00 AM` — the suffix is ALWAYS English `AM`/`PM`.
  (لا يوجد أي صيغة عربية ص/م في البيانات الفعلية — verified 0 rows).
- Fixed positions: day = substr(col,1,2), month = substr(col,4,3), year = substr(col,8,2).
- Used in: EVERY `_raw` date column + `tickets.issue_date` + `tickets.close_date` + `payments.payment_date`.

**B. ISO format `yyyy-MM-dd HH:mm:ss`** — used in system/normalized tables ONLY:
- `audit_change_logs.timestamp`, `sync_history.sync_time`, `logs.timestamp`, `system_error_logs.timestamp`,
  `temp_transfer.transfer_date`, `tickets.entry_time`, `failure_points_price_history.created_at`,
  `tblspare_part_logs.timestamp`, `delta_outbox.created_at`, `delta_outbox_dlq.archived_at`.
- Example: `2026-11-08 10:26:49`. Some have minute precision only (`2026-07-28 12:16`).

### Query rules:
(أمثلة اليوم/الشهر/السنة أدناه تُحقن تلقائياً بالتاريخ الفعلي الحالي وقت كل سؤال — استخدم القيم الظاهرة كما هي.)
- NEVER use `DATE(col)`, `strftime()`, or `col >= '2026-01-01'` on Access-format columns → returns NULL / wrong results.
- اليوم / النهاردة (today): `(col LIKE '%{TODAY_ACCESS}%' OR col LIKE '%{TODAY_ISO}%')`
- هذا الشهر (this month): `(col LIKE '%{MONTH_ACCESS}%' OR col LIKE '%{MONTH_ISO}%')`
- سنة {YEAR} (this year): `(substr(col,8,2) = '{YEAR2}' OR col LIKE '{YEAR}-%')`
- يوم محدد (e.g. 17 سبتمبر 2026): `(col LIKE '%17-Sep-26%' OR col LIKE '%2026-09-17%')`
- ALWAYS use LIKE '%...%' not '=' because a time suffix may be appended.
- Arabic month → English abbreviation mapping (mandatory for Access format):
  يناير=Jan, فبراير=Feb, مارس=Mar, أبريل=Apr, مايو=May, يونيو=Jun,
  يوليو=Jul, أغسطس=Aug, سبتمبر=Sep, أكتوبر=Oct, نوفمبر=Nov, ديسمبر=Dec.
- For date RANGES / sorting on Access columns, normalize to an integer yyyymmdd:
  ```sql
  CAST('20' || substr(col, 8, 2) AS INTEGER) * 10000
  + CASE substr(col, 4, 3)
      WHEN 'Jan' THEN 1 WHEN 'Feb' THEN 2 WHEN 'Mar' THEN 3 WHEN 'Apr' THEN 4
      WHEN 'May' THEN 5 WHEN 'Jun' THEN 6 WHEN 'Jul' THEN 7 WHEN 'Aug' THEN 8
      WHEN 'Sep' THEN 9 WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12 END * 100
  + CAST(substr(col, 1, 2) AS INTEGER)
  ```
  (Guard mixed columns with `CASE WHEN col LIKE '____-__-__%' THEN <ISO parse> ELSE <Access parse> END`.)

### Per-column date facts (verified counts):
| Table.Column | Format | Notes |
|---|---|---|
| maintenance_raw."Checked Out Date" | Access, date-only (1010/1010) | تاريخ الخروج للصيانة |
| maintenance_raw."Checked In Date" | Access, date-only | فارغ في 35 صف = الجهاز ما زال تحت الإصلاح |
| transactions_raw.IssueDate | Access (+AM/PM time in 8350) | مملوء دائماً (10056/10056) — تاريخ تسجيل الزيارة |
| transactions_raw.ActionDate | Access (+AM/PM time in 7059) | فارغ في 1273 صف — تاريخ تنفيذ الإجراء خلال الزيارة |
| → قاعدة تاريخ التنفيذ | | استخدم `COALESCE(NULLIF(TRIM(ActionDate),''), IssueDate)` |
| payments_raw.payment_date | Access, date-only | فارغ في 366 صف |
| payments_raw.send_date | Access (+time in 2581) | تاريخ الإرسال/التسجيل، فارغ في 1470 |
| store_sp_raw.out_date | Access (+time in 4667) | تاريخ صرف القطعة بالفرع — العمود الزمني الأساسي |
| store_sp_raw.in_date | Access, date-only | فارغ في 4718/4854 — يملأ فقط عند التوريد |
| store_sp_maintenance_raw.out_date | Access +time (487/487) | تاريخ صرف قطعة بمركز الصيانة |
| temp_transfer_raw.Transfer_Date | Access (+time in 2031) | تاريخ الاستبدال المؤقت |
| trade_raw."Out Date" / "In Date" | Access (date-only or +time) | فارغ حسب اتجاه الحركة (Out فارغ في 855) |
| assets_raw.ReplacedDate | Access, date-only | مملوء في 137 صف فقط |
| tickets.issue_date / close_date | Access (+time) | ⚠️ 35 صف HQ فيها ISO migration timestamp وليس تاريخاً حقيقياً |
| tickets.entry_time | ISO | وقت إدخال الصف للنظام (ليس تاريخ العطل) |
| temp_transfer.transfer_date | ISO | النسخة المعيارية من الاستبدالات |
| failure_points_price_history.change_date | ISO date-only | تاريخ سريان السعر |

### Dead date columns (100% فارغة — لا تستخدمها أبداً في الفلترة):
`assets_raw."Acquired Date"`, `assets_raw."Retired Date"`, `assets_raw.papers_date`, `merchant_assets.assigned_date`.
(`assets_raw."4-8 update_POS1/2"` أعلام True/False وليست تواريخ.)

---

## 2) KEY SEMANTICS (معاني الأعمدة الحقيقية — تم التحقق بالربط الفعلي)

- **الثلاثية الأساسية في assets_raw (معاني معتمدة من مالك النظام):**
  * **POS = السيريال الفعلي للماكينة** (Hardware Serial مثل `3H248698`, `2330125435`) — يتغير عند استبدال الماكينة.
  * **POSID = Terminal ID (معرّف الترمنال على النظام)**: لكل POS معرّف خاص به، **وإذا استُبدلت الماكينة يبقى الـ Terminal ID كما هو**.
    (لذلك POSID فريد لكل صف 2783/2783، بينما يتكرر POS أحياناً عبر الصفوف.)
  * **bkcode = كود التاجر/العميل (Merchant/Client Code)** = merchants.merchant_code.
  POSID = bkcode في 1611 من 2783 فقط — اختلاف مفاهيمي (Terminal ID ≠ Client Code) وليس خطأ بيانات.
  → **للربط مع التجار استخدم bkcode وليس POSID**. للسؤال عن "ترمنال/جهاز برقم ID" استخدم POSID.
  (أي وثيقة قديمة تقول إن POS هو كود المخبز فهي خاطئة.)
- **device_models**: بادئة السيريال → الموديل: `3C`/`3H`→PAX S90, `233`→PAX D230, `185`→PAX A920, `5F`→PAX D210, `T3`→TRENDIT T3.
- **assets_raw.GrocerNumber = "Damen ID" (رقم الضامن)** — وليس كود التاجر. فارغ عملياً في البيانات الحالية (2/2783) → لا تستخدمه للربط مع التجار. Owner و Contact_person = اسم صاحب المخبز.
- كل مخبز قد يملك ماكينات احتياطية: `POS_2` (سيريال الثانية) + `POS-ID_2` (Terminal ID للثانية)، و `pos_3` (+Manufacturer2/3, Model2/3).
- **transactions_raw.GrocerName = كود المخبز (bkcode) وليس اسماً!** يطابق merchants.merchant_code في 10050/10056.
  للحصول على اسم التاجر: JOIN merchants ON merchants.merchant_code = t.GrocerName.
- **الفني في maintenance_raw**: الصفوف الحديثة فيها "Checked Out To" فارغاً والاسم في Procedure.
  القاعدة: `COALESCE(NULLIF(TRIM("Checked Out To"),''), TRIM(Procedure))`.
  ⚠️ أسماء الموظفين تبدأ بمسافة زائدة في tblstaff_raw و transactions_raw.Procedure → **TRIM إلزامي** عند الربط أو المقارنة.
- **payments_raw.pos_number نص حر** وليس سيريالاً نظيفاً: أمثلة `قطع غيار - خبز - 3C786529`, ` - موافقات صيانة`, وأحياناً سيريال مجرد.
  الربط الصحيح: `p.pos_number LIKE '%' || a.POS || '%'` — **ممنوع الربط بـ =**.
  `policy` = كود المخبز، `procedure_maker` = اسم الموظف، `payer` فارغ غالباً، `ref_num` = رقم الإيصال.
- **store_sp_raw.notes = سيريال الماكينة** التي رُكبت فيها القطعة (يطابق assets POS في 591/800 عينة).
  `Serial` = نص مركب: `رقم الإيصال - اسم القطعة - كود المخبز - مجاني/مدفوع`. القطعة المجانية: `Serial LIKE '%مجاني%'`.
- **temp_transfer_raw**: `POSCode` = كود المخبز (وأحياناً اسم شخص!), `OldPOS`/`NewPOS` = سيريالات قد تحمل بادئة `M-`
  (534 صف Old و588 صف New) → جرّد البادئة عند المطابقة: `REPLACE(col,'M-','')`. `procedure` = username (مثل CAIRO-004) أو اسم موظف.
- **tickets.merchant_code مختلط**: غالباً سيريال الماكينة (7642)، وأحياناً كود مخبز (440)، وصفوف HQ تحمل `عام`.
  `device_id` → devices.id (صالح في 10534/11066؛ صفوف HQ قيمته NULL).
  للوصول للتاجر من تذكرة: عبر device_id → merchant_assets → merchants، أو بمطابقة merchant_code مع الاثنين.
- **devices**: بعض الصفوف junk (serial='.') → استبعد `serial IN ('.','')`. status: in_merchant / in_stock / faulty.
- **store_pos_raw.Serial** لا يطابق assets.POS (ماكينات المخزن غير مركبة) — ربطه بالأصول يكون عبر temp_transfer أو trade.

---

## 3) BUSINESS RULES (قواعد العمل الحرجة)

### الصيانة (فرع vs مركز رئيسي):
- **transactions_raw = سجل زيارات العملاء للفرع** (كل صف = زيارة قام بها العميل للفرع، `Place = 'فرع الشركة'`).
  زيارات الصيانة بالفرع تُستعلم منه. ActionType القيم الفعلية (حصراً حالياً): `اصلاح عطل` (8761), `صيانة أولية` (708), `مسارات القارئ - البوردة` (583), `تحتاج قارئ` (3), `مسارات قديمة - البوردة` (1).
  (لا توجد قيم استبدال/تركيب/سحب في هذه القاعدة حالياً.)
  `NoteG` = الجزء المتعطل (قارئ البطاقات، السوفت وير، لوحة مفاتيح...)، `NoteD` = الإجراء (اصلاح القارئ، تغير بطارية داخلية...)،
  `Procedure` = الفني، `Fees`/`Paid` = 'True'/'False'، `FeesAmount` = المبلغ بالجنيه (TEXT).
- **صيانة المركز الرئيسي HQ** = `maintenance_raw`: `Notes` = وصف العطل الأساسي، `Procedure` = الفني/الإجراء،
  `spstatus` القيم: `اصلاح مع تغيير قطع غيار` (329), `موافقات` (202), `اصلاح بدون تغيير قطع غيار` (100), `تالف - لا يمكن الاصلاح` (1), فارغ (378).
  `FormNo` = رقم نموذج الصيانة (فارغ في الصفوف الحديثة).
- **tickets = العرض الموحد للصيانة كلها** (11066 = 10056 فرع + 1010 HQ بنوع `صيانة دورية / استلام`).
  كل الصفوف status='completed'. ⚠️ في تذاكر HQ: issue_date يحمل وقت الهجرة ISO وليس التاريخ الحقيقي → استخدم close_date أو تواريخ maintenance_raw.
  عند السؤال عن "كل الصيانة" بدون تحديد → tickets. عن تفاصيل الفرع → transactions_raw. عن تفاصيل HQ → maintenance_raw.

### قطع الغيار (أهم تصحيح):
- **الفرع store_sp_raw**: ⚠️ **count_out = صفر في كل الصفوف (4854/4854) — لا تستخدمه أبداً!**
  الاستهلاك مسجل كـ **count_in سالب**: `-1`, `-2`, `-8`... (4718 صف سالب = 4979 قطعة مستهلكة).
  التوريد = count_in موجب (5529 قطعة).
  - عدد القطع المنصرفة/المستهلكة بالفرع: `SUM(CASE WHEN CAST(count_in AS INTEGER) < 0 THEN -CAST(count_in AS INTEGER) ELSE 0 END)`
  - عدد صفوف الصرف (حركات): `COUNT(*) WHERE CAST(count_in AS INTEGER) < 0`
  - الوارد للمخزن: `SUM(CASE WHEN CAST(count_in AS INTEGER) > 0 THEN CAST(count_in AS INTEGER) ELSE 0 END)`
  - تاريخ الصرف = out_date. اسم القطعة = type. سيريال الماكينة = notes.
- **المركز store_sp_maintenance_raw**: هنا `count_out` صالح (485 صف غير صفري، 493 قطعة).
  الربط: `formNo = maintenance_raw.FormNo` (487/487 مطابقة). `Serial` = سيريال الماكينة. `faulty_detils` = وصف القطعة + formNo.
- **failure_points_raw.fees ليس رقماً!** هو كود دفع: `$` = مدفوع (36), `F` = مجاني (1), `$-F` = الحالتان (9).
  `price` = السعر بالجنيه. `model` قد يكون متعدد الموديلات `S90;D210` → استخدم LIKE وليس =.
- **spare_parts**: الكتالوج المعياري — quantity_in_stock و critical_limit للتنبيه، compatible_models نص JSON مثل `["S90;D210"]`.

### المدفوعات والأقساط:
- `payments_raw.payment_reason` يحتوي أسماء القطع وكمياتها: `قارئ بطاقات (1) $`, `مجموعة تروس (1) $`.
  دفعات الأقساط: `payment_reason LIKE '%قسط%'` (قسط ماكينة رقم 1..6).
- `payment_place` القيم: `ضامن` (3819 مع مراعاة مسافة زائدة), `بريد`/`البريد` (564), `البنك` (166), `مجاني` (3), فارغ (372) → TRIM وLIKE.
- `installments_raw.pos` = سيريال الماكينة (يطابق assets.POS). الأقساط: installments=عدد الأشهر، monthlyinstallmentprice=القسط الشهري، finalunitprice=الإجمالي.
  المدفوع من الأقساط = SUM(payment_amount) WHERE payment_reason LIKE '%قسط%' وربط pos_number بالسيريال عبر LIKE.

### قيم فعلية يجب عدم الخلط بينها (verified enums):
- `store_pos_raw.faulty` = 'True'/'False' بالإنجليزية (وليس نعم/لا). pos_status فارغ في 174 و'Branch' في 33 — لا تعتمد عليه.
- `assets_raw.Condition` = '(2) Good' ثابت لكل الصفوف — **لا يصلح لمعرفة المعطل**. للمعطل: devices.status='faulty' أو store_pos_raw.faulty='True' أو سجلات الصيانة.
- `store_sim_raw.network` **فارغ 100%** — الناقل موجود في `sim_type` (مثل Orange) أو في `sim_cards.carrier`.
- `sim_cards.carrier`: Vodafone/Orange/Etisalat مع اختلاف حالة ('orange') → COLLATE NOCASE.
- `trade_raw."Trade Type"`: IN/In/OUT/Out → NOCASE. `"Item Type"`: POS/Pos/PAX/pax/SIM/sim/vodafone/orange/Etisalat/Spare Parts/TOOLS → NOCASE + LIKE.
- `merchants.type`: مخبز (1339), مصريين (630), موزع (22). status='active' للجميع.
- `tblfaults_raw` (10 أعطال قياسية): الاتصال والشبكة، مدخل البيانات، السوفت وير، الشاشة، الشحن، الطابعة، جسم الماكينة، قارئ البطاقات، لوحة مفاتيح، مدخل الطاقة.

---

## 4) TABLE CATALOG — 37 tables (verified row counts 2026-11-15)

### A. Access Raw Replicas (مرايا جداول Access — كل التواريخ فيها بصيغة Access dd-Mon-yy):
| Table | Rows | Brief |
|---|---|---|
| assets_raw | 2,783 | سجل الأصول: كل ماكينة POS مركبة عند عميل. POS=سيريال الماكينة، POSID=Terminal ID (ثابت عند الاستبدال)، bkcode=كود العميل، GrocerNumber=Damen ID، Owner/Contact_person=المالك، Address/SupplyOffice=العنوان/مكتب التموين، Cell_Serial=الشريحة، POS_2/pos_3=ماكينات احتياطية. 65 عموداً أغلبها فارغ. |
| maintenance_raw | 1,010 | سجل الماكينات المرسلة إلى مركز الصيانة الرئيسي HQ للإصلاح. "Unit Serial"=السيريال، Notes=العطل، Procedure/Checked Out To=الفني، FormNo=رقم النموذج، spstatus=حالة الموافقات/الإصلاح. |
| transactions_raw | 10,056 | زيارات العملاء للفرع (كل صف=زيارة؛ الزيارات الحالية كلها صيانة). POSN=السيريال، GrocerName=كود العميل، NoteG=الجزء المتعطل، NoteD=الإجراء، IssueDate=تاريخ الزيارة، ActionDate=تاريخ التنفيذ. |
| payments_raw | 4,924 | تسجيل المدفوعات: المبلغ المدفوع ومكان الدفع وسببه. payment_amount، payment_date، send_date=تاريخ التسجيل، pos_number=نص حر يحوي السيريال، policy=كود العميل، ref_num=الإيصال، payment_place=قناة الدفع، payment_reason=السبب. |
| installments_raw | 50 | عقود تقسيط الماكينات: pos=السيريال، installments=عدد الأقساط، unitprice/monthlyinstallmentprice/finalunitprice=الأسعار. (tblinstallments نسخة معيارية مطابقة.) |
| store_pos_raw | 207 | مخزن الفرع لماكينات POS: Serial، Model، faulty=True/False، faulty_detils=وصف العطل، pos_status شبه فارغ. |
| store_sim_raw | 116 | مخزن الفرع للشرائح: sim_serial، sim_type=الناقل (network فارغ!)، faulty=True/False. |
| store_sp_raw | 4,854 | قطع الغيار المسحوبة من مخزن الفرع: type=اسم القطعة، notes=سيريال الماكينة، **الاستهلاك=count_in سالب** (count_out صفر دائماً)، out_date=تاريخ الصرف، Serial=نص مركب فيه رقم الإيصال وعلامة مجاني. |
| store_sp_maintenance_raw | 487 | قطع غيار مركز الصيانة HQ: type، count_out=المنصرف (صالح هنا)، out_date، formNo=رقم نموذج الصيانة، Serial=سيريال الماكينة. |
| temp_transfer_raw | 2,477 | الاستبدالات المؤقتة: POSCode=كود المخبز، OldPOS=المعطلة، NewPOS=البديلة (قد تحمل M-)، Transfer_Date، procedure=المنفذ. |
| trade_raw | 1,169 | دفتر النقل/اللوجستيات بين الفرع والمركز: "Item Serial"، "Item Type" (POS/SIM/Spare Parts...)، "Trade Type" IN/OUT، "Trade Location"، "Out Date"/"In Date"، "IN/OUT BY"، "Form Number". |
| failure_points_raw | 46 | لائحة أسعار القطع: type، model (قد يكون S90;D210)، price=السعر، **fees=كود $/F وليس رقماً**. |
| tblfaults_raw | 10 | قاموس الأعطال القياسي: faultid، FaultName. (tblfaults نسخة معيارية.) |
| tblfixes_raw | 66 | دليل الحلول: FixID، FaultID→tblfaults_raw.faultid، FixName. |
| tblstaff_raw | 7 | الموظفون والفنيون: name (بمسافة زائدة!)، jtitle=المسمى، accesslevel. (tblstaff نسخة معيارية فيها role/can_maintain.) |

### B. Normalized Domain Entities (الكيانات المعيارية):
| Table | Rows | Brief |
|---|---|---|
| merchants | 1,991 | التاجر/المخبز: merchant_code=كود المخبز (يطابق bkcode وGrocerName)، name، type (مخبز/مصريين/موزع)، government، address، contact_phone، national_id. |
| devices | 4,639 | الماكينة المعيارية: id، serial، manufacturer، model، status (in_merchant/in_stock/faulty)، faulty_details، solder_bridges. |
| sim_cards | 3,863 | الشريحة المعيارية: id، serial، carrier (Vodafone/Orange/Etisalat بحالات مختلفة)، status (assigned/in_stock/faulty). |
| merchant_assets | 4,262 | ربط ثلاثي: merchant_code + device_id→devices.id + sim_card_id→sim_cards.id + slot_label (Main POS...). assigned_date فارغ دائماً. |
| tickets | 11,066 | العرض الموحد لكل الصيانة (فرع+HQ): type، merchant_code (مختلط: سيريال/كود/عام)، device_id، issue_date/close_date (Access)، entry_time (ISO)، technician_name (منزوع المسافات)، hq_debt، status='completed' دائماً. |
| payments | 4,924 | نسخة معيارية من payments_raw: merchant_code، amount (REAL)، payment_date (Access)، reason، ref_num، payment_place. |
| temp_transfer | 758 | نسخة معيارية من الاستبدالات: bkcode، old_serial، new_serial، transfer_date (**ISO**)، procedure_maker. |
| tblinstallments | 50 | نسخة معيارية من الأقساط بأنواع رقمية (INTEGER/REAL). |
| spare_parts | 46 | كتالوج قطع الغيار: part_name، compatible_models (JSON نصي)، critical_limit، price (REAL)، quantity_in_stock. |
| tblspare_part_logs | 4 | ledger قطع الغيار per ticket: ticket_id، part_id، quantity، price، is_free، receipt_num، timestamp (ISO). |
| device_models | 6 | خريطة بادئة السيريال→الموديل (3C/3H→S90, 233→D230, 185→A920, 5F→D210, T3→T3). |
| maintenance_records | 0 | فارغة — لا تستخدمها. |

### C. System, Sync & Audit (النظام والمزامنة — تواريخ ISO):
| Table | Rows | Brief |
|---|---|---|
| sync_history | 1,873 | دورات المزامنة: sync_time (ISO)، sync_type (LOCAL_ACCESS/CLOUD_VPS)، status، records_count، duration_ms. |
| audit_change_logs | 111,145 | سجل تدقيق لكل تغيير: timestamp (ISO)، table_name، record_id، change_type، old_data/new_data (JSON). |
| logs | 1,096 | سجل تشغيل عام: timestamp (ISO)، type، message، severity. |
| system_error_logs | 11 | أخطاء النظام: timestamp (ISO)، severity، module، endpoint، error_message، client_ip. |
| delta_outbox | 0 | طابور المزامنة السحابية (فارغ حالياً): payload، created_at (ISO)، attempts. |
| delta_outbox_dlq | 29 | الطابور الميت/المؤرشف: original_id، payload، archived_at (ISO)، last_error. |
| system_meta | 3 | مفاتيح النظام: hq_debt، financialsLocked، migration_time. |

---

## 5) VERIFIED JOIN MAP (خريطة الربط الصحيحة)

```sql
-- الأصول ↔ صيانة HQ (السيريال)
assets_raw.POS = maintenance_raw."Unit Serial"
-- الأصول ↔ صيانة الفرع
assets_raw.POS = transactions_raw.POSN
-- التاجر ↔ حركات الفرع (كود المخبز وليس الاسم)
merchants.merchant_code = transactions_raw.GrocerName      -- = assets_raw.bkcode
-- التاجر ↔ الأصول (bkcode=كود العميل؛ أما POSID فهو Terminal ID وليس كود عميل)
merchants.merchant_code = assets_raw.bkcode
-- صيانة HQ ↔ قطع غيار HQ
maintenance_raw.FormNo = store_sp_maintenance_raw.formNo
-- صيانة الفرع ↔ قطع غيار الفرع (السيريال في notes + تطابق يوم الصرف)
transactions_raw.POSN = store_sp_raw.notes
  AND (store_sp_raw.out_date LIKE '%' || substr(transactions_raw.ActionDate,1,9) || '%')
-- المدفوعات ↔ الأصول (نص حر → LIKE وليس =)
payments_raw.pos_number LIKE '%' || assets_raw.POS || '%'
-- الأقساط ↔ الأصول
installments_raw.pos = assets_raw.POS
-- الشريحة المركبة
assets_raw.Cell_Serial = store_sim_raw.sim_serial
-- الفني (مع TRIM إلزامي)
TRIM(COALESCE(NULLIF(maintenance_raw."Checked Out To",''), maintenance_raw.Procedure)) = TRIM(tblstaff_raw.name)
TRIM(transactions_raw.Procedure) = TRIM(tblstaff_raw.name)
-- التذاكر ↔ الأجهزة ↔ التجار
tickets.device_id = devices.id
devices.id = merchant_assets.device_id AND merchant_assets.merchant_code = merchants.merchant_code
-- الاستبدالات (تجريد بادئة M-)
REPLACE(temp_transfer_raw.OldPOS,'M-','') = assets_raw.POS
-- الأسعار
store_sp_raw.type = failure_points_raw.type AND failure_points_raw.model LIKE '%' || <model> || '%'
```

## 6) GENERAL SQL RULES (تذكير)
- الأعمدة ذات المسافات بين double quotes: "Unit Serial", "Checked Out Date", "Out Date", "Item Serial", "IN/OUT BY".
- الأرقام المخزنة TEXT: `CAST(NULLIF(col,'') AS REAL/INTEGER)` قبل SUM/المقارنة.
- النصوص العربية: LIKE '%...%'، ومقارنات القيم الإنجليزية المتغيرة الحالة: COLLATE NOCASE.
- الأسماء: TRIM قبل المقارنة (مسافات زائدة شائعة).
- SELECT فقط، LIMIT 100 افتراضياً ما لم يكن تجميعاً.