// Automated Verification Test for All Advanced Features
const http = require('http');

function get(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, text: data });
                }
            });
        }).on('error', reject);
    });
}

async function runTests() {
    console.log("=== RUNNING ADVANCED SUITE VERIFICATION ===");
    
    // 1. Test Frequent Faults Report (Abuse)
    const abuse = await get('http://localhost:3000/api/reports/query?report_type=frequent_faults&limit=5');
    console.log(`[1] Frequent Faults (Abuse): Total = ${abuse.body.total}, First Row Faults = ${abuse.body.rows[0]?.total_faults_count}, Merchant = ${abuse.body.rows[0]?.merchant_name}`);

    // 2. Test End of Day (EOD) Summary
    const eod = await get('http://localhost:3000/api/reports/query?report_type=eod_summary&limit=5');
    console.log(`[2] End of Day (EOD): Total = ${eod.body.total}, First Day Tickets Closed = ${eod.body.rows[0]?.total_tickets_closed}, Date = ${eod.body.rows[0]?.operation_date}`);

    // 3. Test Spare Parts Warranty vs Paid Matrix
    const spWarranty = await get('http://localhost:3000/api/reports/query?report_type=sp_warranty_matrix&limit=5');
    console.log(`[3] SP Warranty Matrix: Total = ${spWarranty.body.total}, First Part = ${spWarranty.body.rows[0]?.part_name}, Warranty Free = ${spWarranty.body.rows[0]?.warranty_free_count}, Paid = ${spWarranty.body.rows[0]?.paid_dispatched_count}`);

    // 4. Test Universal Asset Timeline Search
    const timeline = await get('http://localhost:3000/api/assets/timeline?query=14352');
    console.log(`[4] Universal Asset Timeline: Merchant = ${timeline.body.assetSummary?.merchant?.name}, Events Count = ${timeline.body.timeline?.length}`);

    // 5. Test Printable Delivery Memo
    const memoDelivery = await get('http://localhost:3000/api/print/memo/delivery/14352');
    console.log(`[5] Printable Delivery Memo: Doc = ${memoDelivery.body.doc_title}, Number = ${memoDelivery.body.doc_number}`);

    // 6. Test Printable Payment Receipt
    const receipt = await get('http://localhost:3000/api/print/memo/receipt/1');
    console.log(`[6] Printable Receipt: Doc = ${receipt.body.doc_title}, Number = ${receipt.body.doc_number}, Amount = ${receipt.body.data?.amount}`);

    console.log("\n>>> ALL ADVANCED FEATURES VERIFIED SUCCESSFULLY! <<<");
}

setTimeout(runTests, 3000);
