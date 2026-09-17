/**
 * SmartCS AI Assistant - Text-to-SQL Engine
 * Powered by OpenRouter API with Strict SQLite Read-Only Safety Sandbox
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

function readConfigSafely() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

// -------------------------------------------------------------
// 1. Detailed Schema & Business Knowledge for LLM
// -------------------------------------------------------------
function buildSystemPrompt() {
    return `You are an elite SQLite Data Analyst and Senior BI Engineer for the SmartCS Enterprise System (Egypt Smart Cards & POS Bakery Management System).
Your task is to translate user questions written in Arabic (Egyptian dialect or Modern Standard Arabic) into highly optimized, accurate, read-only SQLite SQL queries.

### DATABASE SCHEMA & COLUMN MAPPINGS (SQLite):

1. **assets_raw** (All installed POS machines, bakeries & merchants):
   - "ID" (TEXT): Record ID
   - "POS" (TEXT): Primary POS Code / Bakery ID (كود المخبز أو الماكينة)
   - "POSID" (TEXT): Machine Hardware Serial Number (سيريال الماكينة)
   - "Model" (TEXT): Device Model (e.g. 'Pax S900', 'Verifone VX520', 'Newland', 'Nexgo')
   - "Manufacturer" (TEXT): Manufacturer name
   - "Condition" (TEXT): Machine status ('WORKING', 'FAULTY', 'شغال', 'معطل', 'NEW')
   - "SupplyOffice" (TEXT): Supply office name (مكتب التموين)
   - "Address" (TEXT): Address or governorate name (المحافظة / المركز / العنوان)
   - "GrocerNumber" (TEXT): Merchant / Grocer Code (رقم التاجر)
   - "Contact_person" (TEXT): Merchant / Bakery Owner Name (اسم صاحب المخبز أو المسؤول)
   - "telephone_1", "telephone_2" (TEXT): Contact phone numbers
   - "Cell_Serial" (TEXT): SIM Card Serial installed in the device
   - "PinpadSerial" (TEXT): Connected Pinpad serial
   - "UPS" (TEXT): Connected UPS battery serial

2. **maintenance_raw** (Maintenance operations, tickets & repairs):
   - "ID" (TEXT): Maintenance Record ID
   - "Unit Serial" (TEXT): Serial number of device being repaired (سيريال الجهاز)
   - "Model" (TEXT): Machine Model
   - "Checked Out To" (TEXT): Technician Name who took or repaired the machine (اسم الفني)
   - "Checked Out Date" (TEXT): Date sent to maintenance (تاريخ الخروج للصيانة)
   - "Checked In Date" (TEXT): Date returned/fixed (تاريخ الدخول/الإصلاح)
   - "Notes" (TEXT): PRIMARY FAULT / REPAIR DESCRIPTION entered by technicians (وصف العطل الأساسي مثل: بورده رئيسيه، قارئ بطاقات، مدخل باور، شاشة، بطارية). *CRITICAL: When the user asks about faults (الأعطال) or repair issues, query the "Notes" column (or COALESCE(NULLIF(Notes, ''), NULLIF(Procedure, '')))*!
   - "Procedure" (TEXT): Action taken / repair details (الإجراء المتبع)
   - "Checked Out Condition" (TEXT): Often empty in legacy data; always fallback to Notes
   - "Checked In Condition" (TEXT): Repair status / outcome (حالة الجهاز بعد الإصلاح)

3. **transactions_raw** (Administrative transactions & field actions):
   - "GrocerName" (TEXT): Bakery / Merchant Name
   - "POSN" (TEXT): Machine code / Serial
   - "Place" (TEXT): Governorate / Location (المحافظة أو الإدارة)
   - "ActionType" (TEXT): Action Type (استبدال، تركيب، إيقاف، سحب، فحص...)
   - "ActionDate" (TEXT): Transaction Date
   - "FeesAmount" (TEXT): Fees / Cost in EGP

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
   - "faulty" (TEXT): Is faulty? ('نعم', 'لا', '1', '0')
   - "pos_status" (TEXT): Stock status ('متاح', 'محجوز', 'كهنة', 'صيانة', 'جديد')

6. **store_sp_raw** (Spare parts warehouse stock):
   - "type" (TEXT): Spare part name/type (شاشة، طابعة، بوردة، بطارية...)
   - "Model" (TEXT): Compatible model
   - "count_in" (TEXT): Quantities received into stock
   - "count_out" (TEXT): Quantities dispatched from stock
   - "in_date" (TEXT), "out_date" (TEXT): Dates

7. **store_sp_maintenance_raw** (Spare parts dispatched for repairs):
   - "type" (TEXT): Spare part name
   - "Model" (TEXT): POS model
   - "count_out" (TEXT): Dispatched quantity (الكمية المنصرفة)
   - "out_date" (TEXT): Date dispatched
   - "formNo" (TEXT): Maintenance form number

8. **store_sim_raw** (SIM cards warehouse stock):
   - "sim_serial" (TEXT): SIM Serial
   - "network" (TEXT): Carrier ('فودافون', 'أورنج', 'اتصالات', 'وي')
   - "faulty" (TEXT): Is faulty?
   - "sim_type" (TEXT): Type

9. **tblfaults_raw** (Standard faults dictionary):
   - "faultid" (TEXT), "FaultName" (TEXT): Fault name

10. **tblstaff_raw** (Staff & Technicians directory):
    - "name" (TEXT): Staff / Tech name
    - "jtitle" (TEXT): Job title

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
6. For numeric calculations on TEXT columns (e.g. payment_amount, count_out, FeesAmount), use \`CAST(NULLIF("payment_amount", '') AS REAL)\` or \`SUM(CAST("count_out" AS INTEGER))\`.
7. Always append \`LIMIT 100\` unless an explicit smaller limit or an aggregate (like single row \`COUNT(*)\`) is requested.
8. NEVER execute or generate \`INSERT\`, \`UPDATE\`, \`DELETE\`, \`DROP\`, \`ALTER\`, \`CREATE\`, \`REPLACE\`, \`PRAGMA\`, \`ATTACH\`, \`DETACH\`, \`VACUUM\`.`;
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
// 3. OpenRouter API Client
// -------------------------------------------------------------
async function callOpenRouter(prompt, question, modelOverride, apiKeyOverride) {
    const config = readConfigSafely();
    const apiKey = apiKeyOverride || config.openRouterApiKey || process.env.OPENROUTER_API_KEY;
    const model = modelOverride || config.openRouterModel || 'openrouter/free';

    if (!apiKey) {
        throw new Error('مفتاح OpenRouter API غير مضبوط في الإعدادات. يرجى إدخال الـ API Key أولاً.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000); // 35s timeout

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:8970',
                'X-Title': 'SmartCS AI Copilot'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: question }
                ],
                temperature: 0.1,
                max_tokens: 1500
            })
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`خطأ من خادم OpenRouter (${response.status}): ${errText}`);
        }

        const json = await response.json();
        const rawContent = json.choices?.[0]?.message?.content || '';
        
        return {
            content: rawContent,
            modelUsed: json.model || model,
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
// 5. Query Execution on SQLite
// -------------------------------------------------------------
function executeSqlPromise(db, sql) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        db.all(sql, [], (err, rows) => {
            const durationMs = Date.now() - startTime;
            if (err) {
                return reject({
                    message: err.message,
                    durationMs
                });
            }
            resolve({
                rows: rows || [],
                durationMs
            });
        });
    });
}

// -------------------------------------------------------------
// 6. Main High-Level Controller: Process User Question
// -------------------------------------------------------------
async function processQuestion(question, options = {}, db) {
    if (!question || !question.trim()) {
        return { success: false, error: 'يرجى كتابة السؤال المطلوب.' };
    }

    if (!db) {
        return { success: false, error: 'قاعدة البيانات المحلية غير متصلة.' };
    }

    const startTime = Date.now();

    try {
        // Step 1: Call LLM
        const systemPrompt = buildSystemPrompt();
        const llmResult = await callOpenRouter(
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

        // Step 4: Execute on SQLite
        let execResult;
        try {
            execResult = await executeSqlPromise(db, finalSql);
        } catch (execErr) {
            return {
                success: false,
                error: `خطأ في تنفيذ استعلام SQLite: ${execErr.message}`,
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
