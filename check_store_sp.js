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

function runSql(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function run() {
    console.log('=== Updating spare_parts with cumulative ledger sum ===');
    
    await runSql(`
        INSERT OR IGNORE INTO spare_parts (part_name, compatible_models, quantity_in_stock, critical_limit, price)
        SELECT 
            DISTINCT type AS part_name,
            '["PAX S90"]' AS compatible_models,
            0 AS quantity_in_stock,
            5 AS critical_limit,
            100 AS price
        FROM store_sp_raw
        WHERE type IS NOT NULL AND type != '';
    `);

    await runSql(`
        UPDATE spare_parts 
        SET quantity_in_stock = COALESCE((
            SELECT SUM(CAST(COALESCE(count_in, '0') AS INTEGER))
            FROM store_sp_raw
            WHERE type = spare_parts.part_name
        ), 0);
    `);

    const parts = await all(`
        SELECT 
            sp.id,
            sp.part_name,
            COALESCE((SELECT SUM(CASE WHEN CAST(count_in AS INTEGER) > 0 THEN CAST(count_in AS INTEGER) ELSE 0 END) FROM store_sp_raw WHERE type = sp.part_name), 0) as total_in,
            COALESCE((SELECT SUM(CASE WHEN CAST(count_in AS INTEGER) < 0 THEN ABS(CAST(count_in AS INTEGER)) ELSE 0 END) FROM store_sp_raw WHERE type = sp.part_name), 0) as total_out,
            sp.quantity_in_stock as net_stock_available,
            sp.price,
            (sp.quantity_in_stock * sp.price) as total_value
        FROM spare_parts sp
        ORDER BY net_stock_available DESC
    `);

    console.table(parts);
    process.exit(0);
}
run();
