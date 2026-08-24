const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./branch_database.db');

function runSql(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function cleanAndRebuildSpareParts() {
    // 1. Recreate clean unique spare_parts table
    await runSql(`
        CREATE TABLE IF NOT EXISTS spare_parts_clean (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            part_name TEXT UNIQUE NOT NULL,
            compatible_models TEXT DEFAULT '["PAX S90"]',
            critical_limit INTEGER DEFAULT 5,
            price REAL DEFAULT 100,
            quantity_in_stock INTEGER DEFAULT 0
        );
    `);

    await runSql(`DELETE FROM spare_parts_clean;`);

    // 2. Insert original parts with known prices
    const defaultPrices = {
        'Antenna': 95,
        'اكس برنتر': 100,
        'برنتر': 1100,
        'بطارية داخلية': 120,
        'جسم ماكينة امامى': 400,
        'جسم ماكينة خلفى': 400,
        'شاشة': 900,
        'غطاء برنتر': 160,
        'قارئ الشرائح': 55,
        'قارئ بطاقات': 350,
        'مجموعة تروس': 300,
        'مسامير للماكينة': 6.25,
        'Power Adapter': 600,
        'لوحة المفاتيح F2': 180,
        'بطارية رئيسية': 999,
        'كيباد بورد': 450,
        'مدخل الباور': 95,
        'موتور برنتر': 80,
        'PSAM': 0,
        'لوحة المفاتيح الباور': 165,
        'لوحة المفاتيح الرئيسية الارقام': 165,
        'غطاء بطارية رئيسية': 190,
        'Power Adapter D210': 1400,
        'قارئ بطاقات D210': 240,
        'Axe D210': 620,
        'Printer D210': 620,
        'غطاء طابعة D210': 525,
        'بطارية D210': 1460,
        'غطاء بطارية D210': 150,
        'Processor': 430,
        'بطارية داخلية2': 120,
        'قارئ بطاقات D230': 570,
        'بطارية داخلية D230': 145,
        'جسم امامي D230': 570,
        'جسم خلفي D230': 475,
        'غطاء برنتر D230': 240,
        'بطارية رئيسية D230': 1280,
        'Power Adapter D230': 920,
        'غطاء بطارية D230': 125,
        'Sam Board': 3700,
        'Main Board': 5550,
        'GPRS Module': 550,
        'اي سي شحن': 220,
        'اي سى ميمورى': 450,
        'سوكت فلاشة': 60,
        'قارئ الشرائح2': 55
    };

    // 3. Populate clean spare_parts
    const distinctTypes = await all(`SELECT DISTINCT type FROM store_sp_raw WHERE type IS NOT NULL AND type != ''`);
    for (const t of distinctTypes) {
        const pName = t.type.trim();
        const price = defaultPrices[pName] || 100;
        await runSql(`
            INSERT OR IGNORE INTO spare_parts_clean (part_name, compatible_models, critical_limit, price, quantity_in_stock)
            VALUES (?, '["PAX S90"]', 5, ?, 0)
        `, [pName, price]);
    }

    // 4. Update quantity_in_stock from cumulative ledger
    await runSql(`
        UPDATE spare_parts_clean 
        SET quantity_in_stock = COALESCE((
            SELECT SUM(CAST(COALESCE(count_in, '0') AS INTEGER))
            FROM store_sp_raw
            WHERE type = spare_parts_clean.part_name
        ), 0);
    `);

    // 5. Replace spare_parts table with clean version
    await runSql(`DROP TABLE spare_parts;`);
    await runSql(`ALTER TABLE spare_parts_clean RENAME TO spare_parts;`);

    console.log('Cleaned spare_parts table successfully.');
    const result = await all(`
        SELECT 
            id, part_name,
            COALESCE((SELECT SUM(CASE WHEN CAST(count_in AS INTEGER) > 0 THEN CAST(count_in AS INTEGER) ELSE 0 END) FROM store_sp_raw WHERE type = spare_parts.part_name), 0) as total_in,
            COALESCE((SELECT SUM(CASE WHEN CAST(count_in AS INTEGER) < 0 THEN ABS(CAST(count_in AS INTEGER)) ELSE 0 END) FROM store_sp_raw WHERE type = spare_parts.part_name), 0) as total_out,
            quantity_in_stock,
            price,
            (quantity_in_stock * price) as total_value
        FROM spare_parts
        ORDER BY quantity_in_stock DESC
    `);
    console.table(result);
    process.exit(0);
}

cleanAndRebuildSpareParts();
