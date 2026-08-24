const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./branch_database.db');

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function parseSerialField(serialStr, notesStr) {
    const s = String(serialStr || '').trim();
    const notes = String(notesStr || '').trim();

    let paymentCategory = 'PAID'; // 'FREE', 'DEFERRED', 'PAID'
    let receiptNum = '';
    let merchantCode = '';

    if (s.includes('مجاني') || s.includes('ضمان') || notes.includes('مجاني')) {
        paymentCategory = 'FREE';
    } else if (s.includes('مؤجل') || s.includes('تحصيلات مؤجلة')) {
        paymentCategory = 'DEFERRED';
    }

    // Extract receipt number (e.g. 14 digits like 40156841170826 or 85174124638465)
    const receiptMatch = s.match(/(\d{10,20})/);
    if (receiptMatch && paymentCategory === 'PAID') {
        receiptNum = receiptMatch[1];
    }

    // Extract merchant code (e.g. 010808 or from notes / serial)
    const merchantMatch = s.match(/\b(0\d{5}|\d{5,6})\b/);
    if (merchantMatch) {
        merchantCode = merchantMatch[1];
    } else if (s.includes('_3D') || s.includes('_3C') || s.includes('_3H')) {
        const m = s.match(/_([30][A-Z0-9]{7})/);
        if (m) merchantCode = m[1];
    }

    return { paymentCategory, receiptNum, merchantCode };
}

async function run() {
    const rows = await all("SELECT Serial, type, count_in, notes, out_date FROM store_sp_raw WHERE count_in LIKE '-%' OR CAST(count_in AS INTEGER) < 0 ORDER BY rowid DESC LIMIT 25");
    
    console.log('=== Parsing Sample store_sp_raw rows ===');
    rows.forEach((r, i) => {
        const parsed = parseSerialField(r.Serial, r.notes);
        console.log(i + 1, 'Date:', r.out_date, '| Part:', r.type, '| Qty:', r.count_in, '| POS:', r.notes, '| Cat:', parsed.paymentCategory, '| Receipt:', parsed.receiptNum || '-', '| Merchant:', parsed.merchantCode || '-');
    });

    console.log('\n=== Category Counts across all store_sp_raw ===');
    const allOutRows = await all("SELECT Serial, notes, count_in FROM store_sp_raw WHERE count_in LIKE '-%' OR CAST(count_in AS INTEGER) < 0");
    let freeCount = 0, deferredCount = 0, paidCount = 0;
    allOutRows.forEach(r => {
        const p = parseSerialField(r.Serial, r.notes);
        if (p.paymentCategory === 'FREE') freeCount++;
        else if (p.paymentCategory === 'DEFERRED') deferredCount++;
        else paidCount++;
    });
    console.log('Total Outgoing Records:', allOutRows.length);
    console.log('Free / Warranty (مجاني وضمان):', freeCount);
    console.log('Deferred / Outstanding Debt (تحصيلات مؤجلة):', deferredCount);
    console.log('Paid / Deposit Receipt (مسدد بإيصال):', paidCount);

    console.log('\n=== Deferred Collections Sample Rows ===');
    const defRows = await all("SELECT Serial, type, count_in, notes, out_date FROM store_sp_raw WHERE (Serial LIKE '%مؤجل%' OR Serial LIKE '%تحصيلات مؤجلة%') AND (count_in LIKE '-%' OR CAST(count_in AS INTEGER) < 0) ORDER BY rowid DESC LIMIT 10");
    console.table(defRows);

    process.exit(0);
}

run();
