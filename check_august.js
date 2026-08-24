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

const MONTH_MAP = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

function parseDateToIso(str) {
    if (!str) return '1970-01-01';
    const s = String(str).trim();
    // Pattern DD-Mon-YY (e.g. 17-Aug-26)
    const m = s.match(/^(\d{1,2})[-/]([a-zA-Z]{3,})[-/](\d{2,4})/);
    if (m) {
        const day = m[1].padStart(2, '0');
        const month = MONTH_MAP[m[2].toLowerCase().substring(0, 3)] || '01';
        let y = m[3];
        if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
        return `${y}-${month}-${day}`;
    }
    return s;
}

async function run() {
    const rows = await all(`
        SELECT 
            substr(t.close_date, 1, 9) as raw_date,
            COUNT(*) as total_tickets_closed,
            COUNT(DISTINCT t.merchant_code) as unique_merchants_served,
            COUNT(DISTINCT t.technician_name) as active_technicians_count
        FROM tickets t
        WHERE t.close_date IS NOT NULL AND t.close_date != ''
        GROUP BY raw_date
    `);

    // Sort properly by ISO date descending
    rows.forEach(r => r.isoDate = parseDateToIso(r.raw_date));
    rows.sort((a, b) => b.isoDate.localeCompare(a.isoDate));

    console.log('Total distinct days:', rows.length);
    console.log('\nTop 15 Days (Sorted by actual Date DESC):');
    rows.slice(0, 15).forEach(r => {
        console.log(r.isoDate, '(', r.raw_date, ') -> Tickets closed:', r.total_tickets_closed, 'Merchants:', r.unique_merchants_served);
    });

    process.exit(0);
}

run();
