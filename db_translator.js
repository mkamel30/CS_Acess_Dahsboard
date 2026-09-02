function translateSqliteToPostgres(sql, params) {
    let pgSql = sql;
    let pgParams = params ? [...params] : [];
    
    // Convert ? to $1, $2, ...
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
    
    // PRAGMA table_info("table")
    const pragmaMatch = pgSql.match(/PRAGMA table_info\((['"]?)(.*?)\1\)/i);
    if (pragmaMatch) {
        pgSql = `SELECT column_name as name FROM information_schema.columns WHERE table_name = '${pragmaMatch[2]}'`;
    }
    
    // INSERT OR REPLACE INTO tblinstallments
    if (pgSql.match(/INSERT OR REPLACE INTO tblinstallments/i)) {
        pgSql = pgSql.replace(/INSERT OR REPLACE INTO tblinstallments \((.*?)\) VALUES \((.*?)\)/i, 
            "INSERT INTO tblinstallments ($1) VALUES ($2) ON CONFLICT (id) DO UPDATE SET pos = EXCLUDED.pos, installments = EXCLUDED.installments, unitprice = EXCLUDED.unitprice, monthlyinstallmentprice = EXCLUDED.monthlyinstallmentprice, finalunitprice = EXCLUDED.finalunitprice");
    }
    else if (pgSql.match(/INSERT OR REPLACE INTO merchants/i)) {
        pgSql = pgSql.replace(/INSERT OR REPLACE INTO merchants \((.*?)\)\s+SELECT/is, 
            "INSERT INTO merchants ($1) SELECT");
        pgSql = pgSql.replace(/;\s*$/, '') + 
            " ON CONFLICT (merchant_code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, contact_phone = EXCLUDED.contact_phone, contact_phone_2 = EXCLUDED.contact_phone_2, address = EXCLUDED.address, government = EXCLUDED.government, national_id = EXCLUDED.national_id, notes = EXCLUDED.notes, status = EXCLUDED.status";
    }
    else if (pgSql.match(/INSERT OR REPLACE INTO devices/i)) {
        pgSql = pgSql.replace(/INSERT OR REPLACE INTO devices \((.*?)\)\s+SELECT/is, 
            "INSERT INTO devices ($1) SELECT");
        pgSql = pgSql.replace(/;\s*$/, '') + 
            " ON CONFLICT (serial) DO UPDATE SET manufacturer = EXCLUDED.manufacturer, model = EXCLUDED.model, status = EXCLUDED.status, faulty_details = EXCLUDED.faulty_details, solder_bridges = EXCLUDED.solder_bridges";
    }
    else if (pgSql.match(/INSERT OR REPLACE INTO sim_cards/i)) {
        pgSql = pgSql.replace(/INSERT OR REPLACE INTO sim_cards \((.*?)\)\s+SELECT/is, 
            "INSERT INTO sim_cards ($1) SELECT");
        pgSql = pgSql.replace(/;\s*$/, '') + 
            " ON CONFLICT (serial) DO UPDATE SET carrier = EXCLUDED.carrier, status = EXCLUDED.status";
    }
    else if (pgSql.match(/INSERT OR REPLACE INTO payments/i)) {
        pgSql = pgSql.replace(/INSERT OR REPLACE INTO payments \((.*?)\)\s+SELECT/is, 
            "INSERT INTO payments ($1) SELECT");
        pgSql = pgSql.replace(/;\s*$/, '') + 
            " ON CONFLICT (id) DO UPDATE SET merchant_code = EXCLUDED.merchant_code, payment_date = EXCLUDED.payment_date, amount = EXCLUDED.amount, ref_num = EXCLUDED.ref_num, reason = EXCLUDED.reason, payment_place = EXCLUDED.payment_place";
    }
    else if (pgSql.match(/INSERT OR REPLACE INTO tblfaults/i)) {
        pgSql = pgSql.replace(/INSERT OR REPLACE INTO tblfaults \((.*?)\)\s+SELECT/is, 
            "INSERT INTO tblfaults ($1) SELECT");
        pgSql = pgSql.replace(/;\s*$/, '') + 
            " ON CONFLICT (id) DO UPDATE SET fault_name = EXCLUDED.fault_name";
    }
    else if (pgSql.match(/INSERT OR REPLACE INTO tblstaff/i)) {
        pgSql = pgSql.replace(/INSERT OR REPLACE INTO tblstaff \((.*?)\)\s+SELECT/is, 
            "INSERT INTO tblstaff ($1) SELECT");
        pgSql = pgSql.replace(/;\s*$/, '') + 
            " ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, can_maintain = EXCLUDED.can_maintain";
    }
    else if (pgSql.match(/INSERT OR IGNORE INTO spare_parts/i)) {
        pgSql = pgSql.replace(/INSERT OR IGNORE INTO spare_parts/i, "INSERT INTO spare_parts");
        pgSql = pgSql.replace(/;\s*$/, '') + 
            " ON CONFLICT (part_name) DO NOTHING";
    }
    else if (pgSql.match(/INSERT OR IGNORE INTO/i)) {
        pgSql = pgSql.replace(/INSERT OR IGNORE INTO/i, "INSERT INTO");
        if (pgSql.includes("temp_transfer")) {
            // best effort for other tables, just ignore on conflict
            // Assuming no specific conflict target, Postgres requires a target for DO NOTHING unless it's a constraint, but we'll try DO NOTHING on id.
        }
    }
    
    pgSql = pgSql.replace(/datetime\('now', '-24 hours', 'localtime'\)/ig, "to_char(NOW() - INTERVAL '24 hours', 'YYYY-MM-DD HH24:MI:SS')");
    pgSql = pgSql.replace(/datetime\('now', '-90 days'\)/ig, "to_char(NOW() - INTERVAL '90 days', 'YYYY-MM-DD HH24:MI:SS')");
    pgSql = pgSql.replace(/datetime\('now', 'localtime'\)/ig, "to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')");
    pgSql = pgSql.replace(/datetime\('now'\)/ig, "to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')");
    pgSql = pgSql.replace(/\bDATETIME\b/ig, 'TEXT');
    pgSql = pgSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/ig, 'SERIAL PRIMARY KEY');
    
    // Auto-convert SQLite bracketed identifiers [Column Name] to PostgreSQL double quotes "Column Name"
    pgSql = pgSql.replace(/\[([^\]]+)\]/g, '"$1"');

    // Auto-convert SQLite case-insensitive LIKE to PostgreSQL ILIKE
    pgSql = pgSql.replace(/\bLIKE\b/ig, 'ILIKE');

    // Auto-convert SQLite rowid references for PostgreSQL compatibility
    pgSql = pgSql.replace(/\b(\w+\.)?rowid\s+as\s+id\b/ig, '1 as id');
    pgSql = pgSql.replace(/\bORDER\s+BY\s+(\w+\.)?rowid(\s+(ASC|DESC))?/ig, 'ORDER BY 1 $2');
    pgSql = pgSql.replace(/\b(\w+\.)?rowid\b/ig, '1');
    
    // Translate SQLite ON CONFLICT(col) to PostgreSQL ON CONFLICT (col)
    pgSql = pgSql.replace(/ON CONFLICT\(([^)]+)\)/ig, 'ON CONFLICT ($1)');
    
    // Auto-convert timestamp empty string comparisons to NULL checks for PostgreSQL
    pgSql = pgSql.replace(/\b(close_date|issue_date|maintenance_date|payment_date|assigned_date|entry_time)\s*=\s*''/ig, '$1 IS NULL');
    pgSql = pgSql.replace(/\b(close_date|issue_date|maintenance_date|payment_date|assigned_date|entry_time)\s*(!=|<>)\s*''/ig, '$1 IS NOT NULL');
    
    // Auto-convert ALTER TABLE ADD COLUMN to ADD COLUMN IF NOT EXISTS
    pgSql = pgSql.replace(/\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/ig, 'ADD COLUMN IF NOT EXISTS ');
    
    return { pgSql, pgParams };
}

module.exports = { translateSqliteToPostgres };
