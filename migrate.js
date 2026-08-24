const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Dynamically locate SheetJS library
let XLSX;
try {
    XLSX = require('xlsx');
} catch (e) {
    console.error("Error: The 'xlsx' library is not installed.");
    console.error("Please run: npm install xlsx");
    process.exit(1);
}

// ----------------------------------------------------
// Path configurations
// ----------------------------------------------------
const backupBase = 'h:\\Programming\\Br_DB\\FE\\backup\\exc_backup';
let backupDir = 'h:\\Programming\\Br_DB\\FE\\backup\\exc_backup\\20260610_084528';

// Detect latest backup folder dynamically
if (fs.existsSync(backupBase)) {
    try {
        const folders = fs.readdirSync(backupBase).filter(f => {
            try {
                return fs.statSync(path.join(backupBase, f)).isDirectory();
            } catch (e) {
                return false;
            }
        });
        if (folders.length > 0) {
            folders.sort();
            backupDir = path.join(backupBase, folders[folders.length - 1]);
        }
    } catch (err) {
        console.error("Error reading backup base directory:", err.message);
    }
}

console.log(`Using database backup directory: ${backupDir}`);

// Diagnostic tool to dump Excel columns for debugging
try {
    const debugColumns = {};
    const filesToInspect = [
        'Store_SP.xlsx',
        'Store_POS.xlsx',
        'Store_Sim.xlsx',
        'Assets.xlsx',
        'معدات_تم_إحلالها.xlsx',
        'TransAction.xlsx',
        'Maintenance.xlsx',
        'payments.xlsx',
        'Temp_transfer.xlsx'
    ];
    filesToInspect.forEach(file => {
        const filePath = path.join(backupDir, file);
        if (fs.existsSync(filePath)) {
            try {
                const workbook = XLSX.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet);
                if (rows.length > 0) {
                    debugColumns[file] = {
                        rowCount: rows.length,
                        firstRowKeys: Object.keys(rows[0]),
                        sampleRow: rows[0]
                    };
                } else {
                    debugColumns[file] = { rowCount: 0, firstRowKeys: [], sampleRow: null };
                }
            } catch (e) {
                debugColumns[file] = { error: e.message };
            }
        } else {
            debugColumns[file] = { error: "File not found" };
        }
    });
    fs.writeFileSync(path.join(__dirname, 'debug_excel.json'), JSON.stringify(debugColumns, null, 4), 'utf8');
    console.log("Debug Excel columns written to debug_excel.json");
} catch (err) {
    console.error("Error creating debug_excel.json:", err.message);
}

// Helper: Case-insensitive column value retriever
function getValue(row, keys, defaultVal = '') {
    for (let k of keys) {
        if (row[k] !== undefined && row[k] !== null) return row[k];
        const lowerK = k.toLowerCase();
        const foundKey = Object.keys(row).find(x => x.toLowerCase() === lowerK);
        if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
            return row[foundKey];
        }
    }
    return defaultVal;
}

function formatExcelDate(val, includeTime = true) {
    if (!val) return includeTime ? '2026-06-01 12:00' : '2026-06-01';
    if (typeof val === 'number') {
        const date = new Date(Math.round((val - 25569) * 86400 * 1000));
        const hasTime = (val % 1) !== 0;
        const YYYY = date.getFullYear();
        const MM = String(date.getMonth() + 1).padStart(2, '0');
        const DD = String(date.getDate()).padStart(2, '0');
        if (includeTime) {
            const hh = hasTime ? String(date.getHours()).padStart(2, '0') : '12';
            const mm = hasTime ? String(date.getMinutes()).padStart(2, '0') : '00';
            return `${YYYY}-${MM}-${DD} ${hh}:${mm}`;
        } else {
            return `${YYYY}-${MM}-${DD}`;
        }
    }
    const s = String(val).trim();
    if (s.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return includeTime ? `${s} 12:00` : s;
    }
    if (s.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)) {
        return includeTime ? s : s.split(' ')[0];
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
        const YYYY = d.getFullYear();
        const MM = String(d.getMonth() + 1).padStart(2, '0');
        const DD = String(d.getDate()).padStart(2, '0');
        if (includeTime) {
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return `${YYYY}-${MM}-${DD} ${hh}:${mm}`;
        } else {
            return `${YYYY}-${MM}-${DD}`;
        }
    }
    return includeTime ? '2026-06-01 12:00' : '2026-06-01';
}

// Read Excel file safely
function readExcelFile(fileName) {
    const filePath = path.join(backupDir, fileName);
    if (!fs.existsSync(filePath)) {
        console.warn(`Warning: File not found: ${filePath}`);
        return [];
    }
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        return XLSX.utils.sheet_to_json(worksheet);
    } catch (err) {
        console.error(`Error reading ${fileName}:`, err.message);
        return [];
    }
}

// Helper: Guess manufacturer and model from serial by scanning device_models prefix
function guessDeviceMetadata(serial) {
    const s = String(serial).trim().toUpperCase();
    const sortedModels = [...state.device_models].sort((a, b) => (b.prefix || "").length - (a.prefix || "").length);
    for (const m of sortedModels) {
        if (m.prefix && s.startsWith(m.prefix.toUpperCase())) {
            return { manufacturer: m.manufacturer, model: m.model_name };
        }
    }
    return { manufacturer: 'PAX', model: 'PAX A920' };
}

// Helper: Guess SIM Carrier
function guessCarrier(serial, carrierCol) {
    const s = String(serial).trim();
    const c = String(carrierCol || '').toLowerCase();
    if (c.includes('voda') || c.includes('فودا') || s.startsWith('89201')) return 'Vodafone';
    if (c.includes('oran') || c.includes('أوران') || c.includes('موبين') || s.startsWith('89202')) return 'Orange';
    if (c.includes('etis') || c.includes('اتصا') || s.startsWith('89203')) return 'Etisalat';
    if (c.includes('we') || c.includes('وي') || s.startsWith('89204')) return 'WE';
    
    // Default fallback cycling
    const lastDigit = s.length > 0 ? (s.charCodeAt(s.length - 1) % 4) : 0;
    return ['Vodafone', 'Orange', 'Etisalat', 'WE'][lastDigit] || 'Vodafone';
}

// ----------------------------------------------------
// Main ETL migration logic
// ----------------------------------------------------
// Calculate a unique signature based on Excel files modification times to prevent resetting localStorage
const filesToWatch = [
    'Store_SP.xlsx',
    'Store_POS.xlsx',
    'Store_Sim.xlsx',
    'Assets.xlsx',
    'معدات_تم_إحلالها.xlsx',
    'TransAction.xlsx',
    'Maintenance.xlsx',
    'payments.xlsx',
    'Temp_transfer.xlsx',
    'failure_points.xlsx'
];
let totalMtime = 0;
filesToWatch.forEach(file => {
    const filePath = path.join(backupDir, file);
    if (fs.existsSync(filePath)) {
        try {
            totalMtime += fs.statSync(filePath).mtime.getTime();
        } catch (e) {
            // Ignore error
        }
    }
});
const migrationSignature = `MIG_${totalMtime}`;

const state = {
    migration_time: migrationSignature,
    merchants: [],
    devices: [],
    sim_cards: [],
    merchant_assets: [],
    device_models: [
        { model_name: "PAX A920", manufacturer: "PAX", prefix: "185" },
        { model_name: "PAX D230", manufacturer: "PAX", prefix: "233" },
        { model_name: "PAX S90", manufacturer: "PAX", prefix: "3C" },
        { model_name: "PAX D210", manufacturer: "PAX", prefix: "5F" },
        { model_name: "Trendit T3", manufacturer: "Trendit", prefix: "T3" }
    ],
    spare_parts: [],
    tickets: [],
    payments: [],
    hq_debt: 0,
    financialsLocked: false,
    temp_transfers: [],
    logs: []
};

// Maps to keep track of added serials
const deviceSerialMap = new Map(); // serial -> deviceObj
const simSerialMap = new Map();    // serial -> simObj

// 1. Process Spare Parts (failure_points.xlsx & Store_SP.xlsx)
console.log("Processing Spare Parts and calculating inventory...");
const rawFailurePoints = readExcelFile('failure_points.xlsx');
const rawStoreSP = readExcelFile('Store_SP.xlsx');

// Aggregate transaction logs in Store_SP.xlsx to find actual stock
const stockMap = {};
rawStoreSP.forEach(row => {
    const type = row.type || row.spname || row.part_name || row.Name;
    if (!type) return;
    const countIn = parseInt(row.count_in || 0);
    const countOut = parseInt(row.count_out || 0);
    const isFaulty = row.faulty === true || row.faulty === 1 || String(row.faulty).toLowerCase() === 'true';
    
    if (!stockMap[type]) {
        stockMap[type] = { in: 0, out: 0 };
    }
    if (!isFaulty) {
        stockMap[type].in += countIn;
    }
    stockMap[type].out += countOut;
});

let spIdCounter = 1;
rawFailurePoints.forEach(row => {
    const name = row.type;
    if (!name) return;
    
    const price = parseFloat(row.price || 0);
    const comp = row.model || 'مشترك';
    
    // Map compatibility codes to full model names
    let compatibleModels = [];
    if (comp && comp !== 'مشترك') {
        const parts = comp.split(/[\/,;\+]/).map(x => x.trim().toUpperCase()).filter(x => x);
        parts.forEach(p => {
            if (p.includes('S90')) compatibleModels.push('PAX S90');
            if (p.includes('A920')) compatibleModels.push('PAX A920');
            if (p.includes('D230')) compatibleModels.push('PAX D230');
            if (p.includes('D210') || p.includes('210')) compatibleModels.push('PAX D210');
            if (p.includes('T3') || p.includes('TRENDIT')) compatibleModels.push('Trendit T3');
        });
    }
    
    if (compatibleModels.length === 0) {
        compatibleModels = ["PAX A920", "PAX D230", "PAX S90", "PAX D210", "Trendit T3"];
    }
    
    // Calculate stock
    const stock = stockMap[name] || { in: 0, out: 0 };
    const qty = Math.max(0, stock.in - stock.out);
    
    state.spare_parts.push({
        id: spIdCounter++,
        part_name: name,
        compatible_models: compatibleModels,
        max_qty_per_device: 1, // default limit
        quantity_in_stock: qty,
        price: price,
        critical_limit: 5 // default critical limit
    });
});

// 2. Process Store Inventory Devices (Store_POS.xlsx)
console.log("Processing Store POS Devices...");
const rawStorePOS = readExcelFile('Store_POS.xlsx');
let devIdCounter = 1;
rawStorePOS.forEach(row => {
    const serial = String(getValue(row, ['serial', 'POS', 'السيريال', 'الرقم المسلسل'])).trim();
    if (!serial || serial === 'undefined') return;

    const faulty = parseInt(getValue(row, ['faulty', 'تالف'], 0));
    const status = (faulty === 1) ? 'IN_MAINTENANCE' : 'IN_STORE';
    const notes = getValue(row, ['notes', 'ملاحظات', 'faulty_details'], '');
    
    const meta = guessDeviceMetadata(serial);
    const brand = getValue(row, ['company', 'manufacturer', 'الشركة'], meta.manufacturer);
    const model = getValue(row, ['model', 'الموديل'], meta.model);

    const devObj = {
        id: devIdCounter++,
        serial,
        manufacturer: brand,
        model,
        status,
        faulty_details: notes
    };
    state.devices.push(devObj);
    deviceSerialMap.set(serial, devObj);
});

// 3. Process Store Inventory SIMs (Store_Sim.xlsx)
console.log("Processing Store SIM Cards...");
const rawStoreSim = readExcelFile('Store_Sim.xlsx');
let simIdCounter = 1;
rawStoreSim.forEach(row => {
    const serial = String(getValue(row, ['serial', 'السيريال'])).trim();
    if (!serial || serial === 'undefined') return;

    const faulty = parseInt(getValue(row, ['faulty', 'تالف'], 0));
    const status = (faulty === 1) ? 'FAULTY' : 'IN_STORE';
    
    const carrierCol = getValue(row, ['company', 'carrier', 'الشركة', 'الشبكة']);
    const carrier = guessCarrier(serial, carrierCol);

    const simObj = {
        id: simIdCounter++,
        serial,
        carrier,
        status
    };
    state.sim_cards.push(simObj);
    simSerialMap.set(serial, simObj);
});

// 4. Process Deployed Merchants and Assets (Assets.xlsx)
console.log("Processing Merchants and deployed assets...");
const rawAssets = readExcelFile('Assets.xlsx');
let assetLinkCounter = 1;

rawAssets.forEach(row => {
    const bkcode = getValue(row, ['bkcode', 'code', 'كود العميل', 'كود المخبز']);
    if (!bkcode) return;

    const name = getValue(row, ['Owner', 'Name', 'الاسم', 'صاحب المخبز', 'الاسم التجاري'], 'عميل غير معروف');
    const phone1 = getValue(row, ['telephone_1', 'phone1', 'تليفون 1', 'الهاتف']);
    const phone2 = getValue(row, ['telephone_2', 'phone2', 'تليفون 2']);
    const address = getValue(row, ['Address', 'العنوان'], 'القاهرة');
    const gov = getValue(row, ['Gov', 'المديرية', 'المحافظة', 'government'], 'القاهرة');
    const bankacc = getValue(row, ['bankacc', 'الحساب البنكي', 'bank_account']);
    const taxCard = getValue(row, ['Tax_Card', 'البطاقة الضريبية', 'tax_card']);
    const fuel = getValue(row, ['fueltype', 'نوع الوقود', 'fuel_type'], 'سولار');
    const bread = getValue(row, ['breadtype', 'نوع الخبز', 'bread_type'], 'بلدي مدعم');
    const train = getValue(row, ['training', 'التدريب'], 'مكتمل');
    const clientTypeRaw = String(getValue(row, ['Client_type', 'type', 'النوع'])).toLowerCase();
    
    let type = 'bakery';
    if (clientTypeRaw.includes('grocer') || clientTypeRaw.includes('بقال') || bread.includes('لا يوجد')) {
        type = 'grocer';
    }

    state.merchants.push({
        merchant_code: bkcode,
        name,
        type,
        contact_phone: phone1 || '01000000000',
        contact_phone_2: phone2 || '',
        address,
        government: gov,
        bank_account: bankacc || '',
        tax_card: taxCard || '',
        fuel_type: fuel,
        bread_type: bread,
        training: train,
        papers_date: '2025-01-01',
        national_id: getValue(row, ['NationalD', 'الرقم القومي', 'national_id', 'national_d']) || '',
        notes: getValue(row, ['Comments', 'ملاحظات', 'comments', 'notes']) || ''
    });

    // Extract POS slots
    const posSlots = [
        { serial: String(getValue(row, ['POS'])).trim(), label: 'ماكينة أساسية أولى' },
        { serial: String(getValue(row, ['POS_2'])).trim(), label: 'ماكينة ثانية' },
        { serial: String(getValue(row, ['pos_3'])).trim(), label: 'ماكينة احتياطية بديلة' }
    ];

    posSlots.forEach(slot => {
        if (!slot.serial || slot.serial === 'undefined' || slot.serial === '' || slot.serial.toLowerCase() === 'null') return;
        
        let dev = deviceSerialMap.get(slot.serial);
        if (!dev) {
            // Create a new deployed device
            const meta = guessDeviceMetadata(slot.serial);
            dev = {
                id: devIdCounter++,
                serial: slot.serial,
                manufacturer: meta.manufacturer,
                model: meta.model,
                status: 'DEPLOYED',
                faulty_details: ''
            };
            state.devices.push(dev);
            deviceSerialMap.set(slot.serial, dev);
        } else {
            // Update store device status to deployed
            dev.status = 'DEPLOYED';
        }

        state.merchant_assets.push({
            id: assetLinkCounter++,
            merchant_code: bkcode,
            device_id: dev.id,
            sim_card_id: null,
            slot_label: slot.label,
            assigned_date: '2025-01-01'
        });
    });

    // Extract SIM slots
    const simSlots = [
        { serial: String(getValue(row, ['Cell_Serial'])).trim(), label: 'شريحة أولى' },
        { serial: String(getValue(row, ['cell_2-ser'])).trim(), label: 'شريحة ثانية' },
        { serial: String(getValue(row, ['Cell_Serial3'])).trim(), label: 'شريحة ثالثة' },
        { serial: String(getValue(row, ['Cell_Serial4'])).trim(), label: 'شريحة رابعة' }
    ];

    simSlots.forEach(slot => {
        if (!slot.serial || slot.serial === 'undefined' || slot.serial === '' || slot.serial.toLowerCase() === 'null') return;

        let sim = simSerialMap.get(slot.serial);
        if (!sim) {
            sim = {
                id: simIdCounter++,
                serial: slot.serial,
                carrier: guessCarrier(slot.serial),
                status: 'DEPLOYED'
            };
            state.sim_cards.push(sim);
            simSerialMap.set(slot.serial, sim);
        } else {
            sim.status = 'DEPLOYED';
        }

        // Add to asset slots (or link to existing device slot for the merchant)
        const existingLink = state.merchant_assets.find(ma => ma.merchant_code === bkcode && ma.sim_card_id === null);
        if (existingLink) {
            existingLink.sim_card_id = sim.id;
        } else {
            state.merchant_assets.push({
                id: assetLinkCounter++,
                merchant_code: bkcode,
                device_id: null,
                sim_card_id: sim.id,
                slot_label: slot.label,
                assigned_date: '2025-01-01'
            });
        }
    });
});

// 5. Process Retired/Scrapped Devices (معدات_تم_إحلالها.xlsx)
console.log("Processing Scrapped/Retired POS Devices...");
const rawScrapped = readExcelFile('معدات_تم_إحلالها.xlsx');
rawScrapped.forEach(row => {
    const serial = String(getValue(row, ['serial', 'POS', 'السيريال'])).trim();
    if (!serial || serial === 'undefined') return;

    let dev = deviceSerialMap.get(serial);
    if (!dev) {
        const meta = guessDeviceMetadata(serial);
        dev = {
            id: devIdCounter++,
            serial: serial,
            manufacturer: meta.manufacturer,
            model: meta.model,
            status: 'SCRAPPED',
            faulty_details: 'تم إحلالها واستبدالها تاريخياً'
        };
        state.devices.push(dev);
        deviceSerialMap.set(serial, dev);
    } else {
        dev.status = 'SCRAPPED';
        dev.faulty_details = 'تم إحلالها واستبدالها تاريخياً';
    }
});

// 6. Process Local Branch Repairs (TransAction.xlsx)
console.log("Processing Branch Local Repairs (TransAction)...");
const rawLocalRepairs = readExcelFile('TransAction.xlsx');
rawLocalRepairs.forEach(row => {
    const bkcode = String(row.GrocerName || '').trim();
    if (!bkcode) return;

    const serial = String(row.POSN || '').trim();
    let dev = deviceSerialMap.get(serial);
    if (!dev && serial && serial !== 'undefined') {
        const meta = guessDeviceMetadata(serial);
        dev = {
            id: devIdCounter++,
            serial: serial,
            manufacturer: meta.manufacturer,
            model: meta.model,
            status: 'DEPLOYED',
            faulty_details: ''
        };
        state.devices.push(dev);
        deviceSerialMap.set(serial, dev);
    }

    const issue = String(row.NoteG || 'عطل صيانة داخلية').trim();
    const res = String(row.NoteD || 'تم الإصلاح بنجاح').trim();
    const tech = String(row.Place || 'فني الفرع').trim();
    
    // Format issue and action dates
    const issueDate = formatExcelDate(row.IssueDate);
    const closeDate = formatExcelDate(row.ActionDate);

    state.tickets.push({
        id: parseInt(row.ID),
        type: 'LOCAL_REPAIR',
        merchant_code: bkcode,
        device_id: dev ? dev.id : null,
        status: 'CLOSED',
        issue_details: issue,
        resolution_details: res,
        technician_name: tech,
        issue_date: issueDate,
        close_date: closeDate,
        entry_time: issueDate,
        hq_debt: 0,
        hq_payment_ref: ''
    });
});

// 7. Process External HQ Repairs (Maintenance.xlsx)
console.log("Processing HQ External Repairs (Maintenance)...");
const rawHQRepairs = readExcelFile('Maintenance.xlsx');
rawHQRepairs.forEach(row => {
    const serial = String(row['Unit Serial'] || '').trim();
    if (!serial || serial === 'undefined') return;

    let dev = deviceSerialMap.get(serial);
    if (!dev) {
        const meta = guessDeviceMetadata(serial);
        dev = {
            id: devIdCounter++,
            serial: serial,
            manufacturer: meta.manufacturer,
            model: meta.model,
            status: 'IN_MAINTENANCE',
            faulty_details: 'مرسلة للمركز الرئيسي'
        };
        state.devices.push(dev);
        deviceSerialMap.set(serial, dev);
    }

    // Try to find merchant from assets for this device serial
    const assetLink = state.merchant_assets.find(ma => ma.device_id === dev.id);
    const bkcode = assetLink ? assetLink.merchant_code : 'HQ_DEALER';

    const issue = 'عطل بوردة ومعالج رئيسي';
    const res = 'تم الإصلاح بالمركز الرئيسي للشركة';
    
    const sentDate = formatExcelDate(row['Checked Out Date']);
    const returnDate = formatExcelDate(row['Checked In Date']);
    const cost = 0; // Cost is not in Maintenance.xlsx columns

    state.tickets.push({
        id: parseInt(row.ID),
        type: 'HQ_REPAIR',
        merchant_code: bkcode,
        device_id: dev.id,
        status: 'CLOSED',
        issue_details: issue,
        resolution_details: res,
        technician_name: 'المركز الرئيسي للشركة',
        issue_date: sentDate,
        close_date: returnDate,
        entry_time: sentDate,
        hq_debt: cost,
        hq_payment_ref: ''
    });

    state.hq_debt += cost;
});

// 8. Process Payments & Clean Installments (payments.xlsx)
console.log("Processing Payments and clearing installments...");
const rawPayments = readExcelFile('payments.xlsx');
rawPayments.forEach(row => {
    const payerStr = row.payer || row.policy || '';
    const parts = payerStr.split('_');
    const bkcode = parts[parts.length - 1] ? parts[parts.length - 1].trim() : '';
    if (!bkcode) return;

    const amount = parseFloat(row.payment_amount || 0);
    const date = formatExcelDate(row.payment_date, false); // Keep date only
    const ref = String(row.ref_num || '').trim();
    
    let place = String(row.payment_place || 'بنك').trim();
    if (place === 'البنك') place = 'بنك';
    if (place === 'البريد') place = 'بريد';
    if (place !== 'بنك' && place !== 'بريد' && place !== 'ضامن') place = 'بنك'; // Normalize
    
    let reason = String(row.payment_reason || 'تكاليف صيانة أجهزة').trim();
    if (reason.includes('قسط') || reason.toLowerCase().includes('installment')) {
        reason = 'تكاليف صيانة أجهزة';
    }

    state.payments.push({
        id: parseInt(row.ID),
        merchant_code: bkcode,
        payment_date: date,
        amount: amount,
        ref_num: ref || `999000${row.ID}`,
        reason: reason,
        payment_place: place
    });
});

// 9. Process Swaps as logs (Temp_transfer.xlsx)
console.log("Processing Swaps into system timeline logs...");
const rawSwaps = readExcelFile('Temp_transfer.xlsx');
state.temp_transfers = [];
rawSwaps.forEach(row => {
    const bkcode = getValue(row, ['POSCode', 'bkcode', 'merchant_code', 'كود العميل']);
    const oldSer = getValue(row, ['OldPOS', 'old_serial', 'POS_old', 'الماكينة القديمة']);
    const newSer = getValue(row, ['NewPOS', 'new_serial', 'POS_new', 'الماكينة الجديدة']);
    const date = getValue(row, ['Transfer_Date', 'transfer_date', 'date', 'التاريخ'], '2026-06-09 12:00');
    const procedure = getValue(row, ['procedure', 'procedure_maker', 'المسؤول'], 'System');
    const newType = getValue(row, ['NewType', 'new_type', 'النوع'], '');
    const notes = getValue(row, ['notes', 'ملاحظات'], '');

    if (!bkcode || !newSer) return;
    
    const formattedDate = formatExcelDate(date);
    
    state.temp_transfers.push({
        bkcode: bkcode,
        old_serial: oldSer,
        new_serial: newSer,
        transfer_date: formattedDate,
        procedure_maker: procedure,
        new_type: newType,
        notes: notes
    });
    
    state.logs.push({
        timestamp: formattedDate,
        type: 'maintenance',
        message: `استبدال أصول: تم سحب الماكينة القديمة ${oldSer || 'غير محددة'} وصرف الماكينة البديلة ${newSer} للعميل ${bkcode}.`,
        severity: 'info'
    });
});

// 10. Process Fault Scenarios (tblFaults.xlsx)
console.log("Processing Fault Scenarios (tblFaults)...");
const rawFaults = readExcelFile('tblFaults.xlsx');
const faultsList = [];
let faultIdCounter = 1;
rawFaults.forEach(row => {
    const keys = Object.keys(row);
    const idKey = keys.find(k => k.toLowerCase() === 'id' || k.toLowerCase() === 'faultid');
    const nameKey = keys.find(k => {
        const kl = k.toLowerCase();
        return kl === 'faultname' || kl === 'fault_name' || kl.includes('name') || kl.includes('عطل') || kl.includes('الشكوى');
    });
    const id = idKey ? parseInt(row[idKey]) : faultIdCounter++;
    if (nameKey) {
        const name = String(row[nameKey]).trim();
        if (name && name !== 'undefined') {
            faultsList.push({ id, fault_name: name });
        }
    }
});

// Fallback defaults if tblFaults.xlsx was empty or missing
if (faultsList.length === 0) {
    faultsList.push(
        { id: 1, fault_name: "عطل بوردة شحن" },
        { id: 2, fault_name: "تلف قارئ الكروت" },
        { id: 3, fault_name: "بهتان طباعة البونات" },
        { id: 4, fault_name: "تلف بكرة السحب" },
        { id: 5, fault_name: "عطل شبكة / اتصال" },
        { id: 6, fault_name: "شاشة مكسورة / تالفة" }
    );
}
state.faults = faultsList;

// 11. Process Staff & Roles (AuthorizedUsers.xlsx)
console.log("Processing Staff & Roles (AuthorizedUsers)...");
const rawAuthUsers = readExcelFile('AuthorizedUsers.xlsx');
const staffList = [];
rawAuthUsers.forEach(row => {
    const id = parseInt(row.id);
    const name = String(row.name || row.username || '').trim();
    const role = String(row.jtitle || '').trim();
    if (name && name !== 'undefined') {
        staffList.push({
            id,
            name,
            role,
            can_maintain: role.includes('صيانة') ? 1 : 0
        });
    }
});
state.staff = staffList;

// Add startup logs
state.logs.unshift(
    { timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16), type: 'system', message: 'تم إنجاز الهجرة الفعلية لقاعدة بيانات فرع القاهرة بنجاح وبدء التطبيق بالبيانات الحية.', severity: 'info' }
);

// ----------------------------------------------------
// Write output to real_data.js
// ----------------------------------------------------
const outputPath = path.join(__dirname, 'real_data.js');
const jsContent = `// This file is auto-generated by the database migration script. Do not modify manually.\nwindow.REAL_DATA = ${JSON.stringify(state, null, 4)};\n`;

fs.writeFileSync(outputPath, jsContent, 'utf8');
console.log(`Success! Normalized database exported to: ${outputPath}`);
console.log(`Total Merchants: ${state.merchants.length}`);
console.log(`Total Devices: ${state.devices.length}`);
console.log(`Total SIMs: ${state.sim_cards.length}`);
console.log(`Total Fault Scenarios: ${state.faults.length}`);
console.log(`Total Tickets: ${state.tickets.length}`);
console.log(`Total Payments: ${state.payments.length}`);

// ----------------------------------------------------
// SQLite DB Migration Implementation
// ----------------------------------------------------
function runQuery(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getQuery(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

async function runSQLiteMigration() {
    const dbPath = path.join(__dirname, 'branch_database.db');
    const db = new sqlite3.Database(dbPath);
    db.run("PRAGMA journal_mode = WAL;");
    db.run("PRAGMA busy_timeout = 5000;");

    return new Promise((resolve, reject) => {
        db.serialize(async () => {
            try {
                // Backup manual testing data before drops
                let manualTickets = [];
                let manualPayments = [];
                let manualSparePartLogs = [];
                let manualTransfers = [];

                try {
                    const ticketTableCheck = await new Promise((res, rej) => {
                        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='tickets'", (err, row) => {
                            if (err) rej(err);
                            else res(row);
                        });
                    });

                    if (ticketTableCheck) {
                        manualTickets = await new Promise((res, rej) => {
                            db.all("SELECT * FROM tickets WHERE id < 3000", (err, rows) => {
                                if (err) rej(err);
                                else res(rows || []);
                            });
                        });
                        manualPayments = await new Promise((res, rej) => {
                            db.all("SELECT * FROM payments WHERE id < 1000", (err, rows) => {
                                if (err) rej(err);
                                else res(rows || []);
                            });
                        });
                        manualSparePartLogs = await new Promise((res, rej) => {
                            db.all("SELECT * FROM tblspare_part_logs WHERE ticket_id < 3000", (err, rows) => {
                                if (err) rej(err);
                                else res(rows || []);
                            });
                        });
                        
                        // Check if temp_transfer exists and backup manual transfers
                        const transferTableCheck = await new Promise((res, rej) => {
                            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='temp_transfer'", (err, row) => {
                                if (err) rej(err);
                                else res(row);
                            });
                        });
                        if (transferTableCheck) {
                            manualTransfers = await new Promise((res, rej) => {
                                db.all("SELECT * FROM temp_transfer WHERE id < 1000", (err, rows) => {
                                    if (err) rej(err);
                                    else res(rows || []);
                                });
                            });
                        }
                        
                        console.log(`Successfully backed up ${manualTickets.length} manual tickets, ${manualPayments.length} manual payments, ${manualSparePartLogs.length} spare part logs, and ${manualTransfers.length} manual transfers.`);
                    }
                } catch (backupErr) {
                    console.log("No existing database/tables found for backup. Starting clean:", backupErr.message);
                }

                // 0. Drop old tables to force recreation with new schema
                await runQuery(db, "DROP TABLE IF EXISTS merchants");
                await runQuery(db, "DROP TABLE IF EXISTS tblfaults");
                await runQuery(db, "DROP TABLE IF EXISTS tickets");
                await runQuery(db, "DROP TABLE IF EXISTS tblstaff");
                await runQuery(db, "DROP TABLE IF EXISTS tblspare_part_logs");
                await runQuery(db, "DROP TABLE IF EXISTS payments");
                await runQuery(db, "DROP TABLE IF EXISTS logs");

                // 1. Create tables
                await runQuery(db, `CREATE TABLE IF NOT EXISTS merchants (
                    merchant_code TEXT PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    contact_phone TEXT,
                    contact_phone_2 TEXT,
                    address TEXT,
                    government TEXT,
                    bank_account TEXT,
                    tax_card TEXT,
                    fuel_type TEXT,
                    bread_type TEXT,
                    training TEXT,
                    papers_date TEXT,
                    national_id TEXT,
                    notes TEXT
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS tblfaults (
                    id INTEGER PRIMARY KEY,
                    fault_name TEXT
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS devices (
                    id INTEGER PRIMARY KEY,
                    serial TEXT UNIQUE,
                    manufacturer TEXT,
                    model TEXT,
                    status TEXT,
                    faulty_details TEXT,
                    solder_bridges TEXT
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS sim_cards (
                    id INTEGER PRIMARY KEY,
                    serial TEXT UNIQUE,
                    carrier TEXT,
                    status TEXT
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS merchant_assets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    merchant_code TEXT,
                    device_id INTEGER,
                    sim_card_id INTEGER,
                    slot_label TEXT,
                    assigned_date TEXT
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS device_models (
                    prefix TEXT PRIMARY KEY,
                    model_name TEXT,
                    manufacturer TEXT
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS spare_parts (
                    id INTEGER PRIMARY KEY,
                    part_name TEXT,
                    compatible_models TEXT,
                    max_qty_per_device INTEGER,
                    quantity_in_stock INTEGER,
                    price REAL,
                    critical_limit INTEGER
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS tickets (
                    id INTEGER PRIMARY KEY,
                    type TEXT,
                    merchant_code TEXT,
                    device_id INTEGER,
                    status TEXT,
                    issue_details TEXT,
                    resolution_details TEXT,
                    technician_name TEXT,
                    issue_date TEXT,
                    close_date TEXT,
                    hq_debt REAL,
                    hq_payment_ref TEXT,
                    entry_time TEXT,
                    selected_faults TEXT,
                    selected_bridges TEXT
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS payments (
                    id INTEGER PRIMARY KEY,
                    merchant_code TEXT,
                    payment_date TEXT,
                    amount REAL,
                    ref_num TEXT,
                    reason TEXT,
                    payment_place TEXT
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS tblstaff (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    role TEXT,
                    can_maintain INTEGER
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS tblspare_part_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticket_id INTEGER,
                    part_id INTEGER,
                    part_name TEXT,
                    merchant_code TEXT,
                    device_id INTEGER,
                    quantity INTEGER,
                    price REAL,
                    is_free INTEGER,
                    receipt_num TEXT,
                    timestamp TEXT
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS temp_transfer (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bkcode TEXT,
                    old_serial TEXT,
                    new_serial TEXT,
                    transfer_date TEXT,
                    procedure_maker TEXT,
                    new_type TEXT,
                    notes TEXT
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT,
                    type TEXT,
                    message TEXT,
                    severity TEXT
                )`);
                await runQuery(db, `CREATE TABLE IF NOT EXISTS system_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )`);

                console.log("SQLite tables verified.");

                // 2. Clear master tables
                await runQuery(db, "DELETE FROM merchants");
                await runQuery(db, "DELETE FROM devices");
                await runQuery(db, "DELETE FROM sim_cards");
                await runQuery(db, "DELETE FROM merchant_assets");
                await runQuery(db, "DELETE FROM device_models");
                await runQuery(db, "DELETE FROM spare_parts");

                // 3. Insert Device Models
                const insertModel = db.prepare("INSERT INTO device_models (prefix, model_name, manufacturer) VALUES (?, ?, ?)");
                state.device_models.forEach(m => {
                    insertModel.run(m.prefix, m.model_name, m.manufacturer);
                });
                insertModel.finalize();

                // 4. Insert Spare Parts
                const insertSP = db.prepare("INSERT INTO spare_parts (id, part_name, compatible_models, max_qty_per_device, quantity_in_stock, price, critical_limit) VALUES (?, ?, ?, ?, ?, ?, ?)");
                state.spare_parts.forEach(sp => {
                    insertSP.run(sp.id, sp.part_name, JSON.stringify(sp.compatible_models), sp.max_qty_per_device, sp.quantity_in_stock, sp.price, sp.critical_limit);
                });
                insertSP.finalize();

                // 5. Insert Devices
                const insertDevice = db.prepare("INSERT INTO devices (id, serial, manufacturer, model, status, faulty_details) VALUES (?, ?, ?, ?, ?, ?)");
                state.devices.forEach(d => {
                    insertDevice.run(d.id, d.serial, d.manufacturer, d.model, d.status, d.faulty_details);
                });
                insertDevice.finalize();

                // 6. Insert SIM Cards
                const insertSIM = db.prepare("INSERT INTO sim_cards (id, serial, carrier, status) VALUES (?, ?, ?, ?)");
                state.sim_cards.forEach(s => {
                    insertSIM.run(s.id, s.serial, s.carrier, s.status);
                });
                insertSIM.finalize();

                // 6b. Insert Fault Scenarios
                const insertFault = db.prepare("INSERT INTO tblfaults (id, fault_name) VALUES (?, ?)");
                state.faults.forEach(f => {
                    insertFault.run(f.id, f.fault_name);
                });
                insertFault.finalize();

                // 6c. Insert Staff
                const insertStaff = db.prepare("INSERT INTO tblstaff (id, name, role, can_maintain) VALUES (?, ?, ?, ?)");
                state.staff.forEach(s => {
                    insertStaff.run(s.id, s.name, s.role, s.can_maintain);
                });
                insertStaff.finalize();

                // 7. Insert Merchants
                const insertMerchant = db.prepare("INSERT OR REPLACE INTO merchants (merchant_code, name, type, contact_phone, contact_phone_2, address, government, bank_account, tax_card, fuel_type, bread_type, training, papers_date, national_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                state.merchants.forEach(m => {
                    insertMerchant.run(
                        m.merchant_code, m.name, m.type, m.contact_phone, m.contact_phone_2 || '',
                        m.address, m.government, m.bank_account, m.tax_card, m.fuel_type,
                        m.bread_type, m.training, m.papers_date, m.national_id || '', m.notes || ''
                    );
                });
                insertMerchant.finalize();

                // 8. Insert Merchant Assets
                const insertAsset = db.prepare("INSERT INTO merchant_assets (id, merchant_code, device_id, sim_card_id, slot_label, assigned_date) VALUES (?, ?, ?, ?, ?, ?)");
                state.merchant_assets.forEach(ma => {
                    insertAsset.run(ma.id, ma.merchant_code, ma.device_id, ma.sim_card_id, ma.slot_label, ma.assigned_date);
                });
                insertAsset.finalize();

                                // 9. Seeding maintenance tickets
                console.log("Seeding maintenance tickets...");
                const insertTicket = db.prepare("INSERT INTO tickets (id, type, merchant_code, device_id, status, issue_details, resolution_details, technician_name, issue_date, close_date, hq_debt, hq_payment_ref, entry_time, selected_faults, selected_bridges) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                state.tickets.forEach(t => {
                    insertTicket.run(
                        t.id, t.type, t.merchant_code, t.device_id, t.status, t.issue_details, 
                        t.resolution_details, t.technician_name, t.issue_date, t.close_date, 
                        t.hq_debt, t.hq_payment_ref, t.entry_time || t.issue_date, 
                        t.selected_faults || null, t.selected_bridges || null
                    );
                });
                manualTickets.forEach(t => {
                    insertTicket.run(
                        t.id, t.type, t.merchant_code, t.device_id, t.status, t.issue_details, 
                        t.resolution_details, t.technician_name, t.issue_date, t.close_date, 
                        t.hq_debt, t.hq_payment_ref, t.entry_time, 
                        t.selected_faults, t.selected_bridges
                    );
                });
                insertTicket.finalize();

                // Seeding payments
                console.log("Seeding payments...");
                const insertPayment = db.prepare("INSERT INTO payments (id, merchant_code, payment_date, amount, ref_num, reason, payment_place) VALUES (?, ?, ?, ?, ?, ?, ?)");
                state.payments.forEach(p => {
                    insertPayment.run(p.id, p.merchant_code, p.payment_date, p.amount, p.ref_num, p.reason, p.payment_place);
                });
                manualPayments.forEach(p => {
                    insertPayment.run(p.id, p.merchant_code, p.payment_date, p.amount, p.ref_num, p.reason, p.payment_place);
                });
                insertPayment.finalize();

                // Seeding temp_transfers
                console.log("Seeding temp_transfers...");
                await runQuery(db, "DELETE FROM temp_transfer");
                const insertTransfer = db.prepare("INSERT INTO temp_transfer (bkcode, old_serial, new_serial, transfer_date, procedure_maker, new_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");
                state.temp_transfers.forEach(t => {
                    insertTransfer.run(t.bkcode, t.old_serial, t.new_serial, t.transfer_date, t.procedure_maker, t.new_type, t.notes);
                });
                manualTransfers.forEach(t => {
                    insertTransfer.run(t.bkcode, t.old_serial, t.new_serial, t.transfer_date, t.procedure_maker, t.new_type, t.notes);
                });
                insertTransfer.finalize();

                // Seeding manual spare part logs if any
                if (manualSparePartLogs && manualSparePartLogs.length > 0) {
                    console.log("Restoring manual spare part logs...");
                    const insertLogPart = db.prepare("INSERT INTO tblspare_part_logs (id, ticket_id, part_id, part_name, merchant_code, device_id, quantity, price, is_free, receipt_num, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                    manualSparePartLogs.forEach(l => {
                        insertLogPart.run(
                            l.id, l.ticket_id, l.part_id, l.part_name, l.merchant_code, 
                            l.device_id, l.quantity, l.price, l.is_free, l.receipt_num, l.timestamp
                        );
                    });
                    insertLogPart.finalize();
                }

                // Seeding logs
                console.log("Seeding system logs...");
                const insertLog = db.prepare("INSERT INTO logs (timestamp, type, message, severity) VALUES (?, ?, ?, ?)");
                state.logs.forEach(l => {
                    insertLog.run(l.timestamp, l.type, l.message, l.severity);
                });
                insertLog.finalize();

                // 10. Update system meta parameters
                await runQuery(db, "INSERT OR REPLACE INTO system_meta (key, value) VALUES ('migration_time', ?)", [state.migration_time]);
                
                const checkMetaDebt = await getQuery(db, "SELECT value FROM system_meta WHERE key = 'hq_debt'");
                if (!checkMetaDebt) {
                    const ticketsDebtRow = await getQuery(db, "SELECT SUM(hq_debt) as total FROM tickets WHERE type = 'HQ_REPAIR'");
                    const calculatedDebt = ticketsDebtRow ? (ticketsDebtRow.total || 0) : 0;
                    await runQuery(db, "INSERT OR REPLACE INTO system_meta (key, value) VALUES ('hq_debt', ?)", [String(calculatedDebt)]);
                }
                
                const checkMetaLocked = await getQuery(db, "SELECT value FROM system_meta WHERE key = 'financialsLocked'");
                if (!checkMetaLocked) {
                    await runQuery(db, "INSERT OR REPLACE INTO system_meta (key, value) VALUES ('financialsLocked', 'false')");
                }

                console.log("SQLite Migration completed successfully!");
                db.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            } catch (err) {
                console.error("Error during SQLite migration transaction:", err.message);
                db.close();
                reject(err);
            }
        });
    });
}

// Execute migration
runSQLiteMigration().then(() => {
    console.log("Excel migration to SQLite database complete.");
    process.exit(0);
}).catch(err => {
    console.error("SQLite Migration failed:", err);
    process.exit(1);
});
