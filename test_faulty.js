const sqlite3 = require('./webapp/node_modules/sqlite3').verbose();
const db = new sqlite3.Database('webapp/branch_database.db');
db.all('SELECT DISTINCT faulty, pos_status, COUNT(*) as count FROM store_pos_raw GROUP BY faulty, pos_status', (err, rows) => {
    console.log('STORE_POS FAULTY VALUES:', rows);
    process.exit(0);
});
