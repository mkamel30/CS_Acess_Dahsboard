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

async function run() {
    console.log('=== Distinct ActionType in transactions_raw ===');
    const actTypes = await all('SELECT ActionType, COUNT(*) as c FROM transactions_raw GROUP BY ActionType');
    console.log(actTypes);

    console.log('\n=== Distinct type in tickets ===');
    const tickTypes = await all('SELECT type, COUNT(*) as c FROM tickets GROUP BY type');
    console.log(tickTypes);

    console.log('\n=== Sample tickets with مسارات القارئ - البوردة ===');
    const boardTicks = await all("SELECT id, type, merchant_code, issue_details, resolution_details, technician_name, issue_date FROM tickets WHERE type LIKE '%مسارات%' OR issue_details LIKE '%مسارات%' LIMIT 5");
    console.log(boardTicks);

    console.log('\n=== Sample tickets with اصلاح عطل ===');
    const repairTicks = await all("SELECT id, type, merchant_code, issue_details, resolution_details, technician_name, issue_date FROM tickets WHERE type LIKE '%اصلاح%' OR type LIKE '%عطل%' LIMIT 5");
    console.log(repairTicks);

    process.exit(0);
}

run();
