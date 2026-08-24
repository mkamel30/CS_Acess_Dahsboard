const http = require('http');

function testEndpoint(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch(e) {
                    resolve({ status: res.statusCode, raw: data.substring(0, 100) });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTests() {
    console.log('--- COMPREHENSIVE ENDPOINT & SYNC TEST ---');
    try {
        // 1. Sync Status
        const syncStatus = await testEndpoint('/api/sync/status');
        console.log('1. /api/sync/status:', syncStatus.status, syncStatus.data ? 'OK' : 'FAIL');

        // 2. Dashboard Stats
        const dashStats = await testEndpoint('/api/dashboard/stats');
        console.log('2. /api/dashboard/stats:', dashStats.status, 'Total Merchants:', dashStats.data?.kpis?.totalMerchants, 'Active POS:', dashStats.data?.kpis?.totalDevices);

        // 3. Audit Logs
        const auditLogs = await testEndpoint('/api/audit-logs?limit=5');
        console.log('3. /api/audit-logs:', auditLogs.status, 'Total Logs:', auditLogs.data?.total, 'Sample Count:', auditLogs.data?.logs?.length);

        // 4. Reports (All 12 Types)
        const repMerchants = await testEndpoint('/api/reports/query?report_type=merchants&limit=5');
        console.log('4a. /api/reports/query (merchants):', repMerchants.status, 'Total:', repMerchants.data?.total);

        const repModel = await testEndpoint('/api/reports/query?report_type=model_breakdown&limit=5');
        console.log('4b. /api/reports/query (model_breakdown):', repModel.status, 'Total:', repModel.data?.total, 'Sample:', JSON.stringify(repModel.data?.rows?.[0]));

        const repTech = await testEndpoint('/api/reports/query?report_type=technicians_perf&limit=5');
        console.log('4c. /api/reports/query (technicians_perf):', repTech.status, 'Total:', repTech.data?.total, 'Sample:', JSON.stringify(repTech.data?.rows?.[0]));

        const repGov = await testEndpoint('/api/reports/query?report_type=gov_summary&limit=5');
        console.log('4d. /api/reports/query (gov_summary):', repGov.status, 'Total:', repGov.data?.total, 'Sample:', JSON.stringify(repGov.data?.rows?.[0]));

        const repMaint = await testEndpoint('/api/reports/query?report_type=maintenance&limit=5');
        console.log('4e. /api/reports/query (maintenance):', repMaint.status, 'Total:', repMaint.data?.total);

        const repDevices = await testEndpoint('/api/reports/query?report_type=devices&limit=5');
        console.log('4f. /api/reports/query (devices):', repDevices.status, 'Total:', repDevices.data?.total);

        const repHQ = await testEndpoint('/api/reports/query?report_type=hq_shipments&limit=5');
        console.log('4g. /api/reports/query (hq_shipments):', repHQ.status, 'Total:', repHQ.data?.total);

        const repSims = await testEndpoint('/api/reports/query?report_type=sims&limit=5');
        console.log('4h. /api/reports/query (sims):', repSims.status, 'Total:', repSims.data?.total);

        const repCarrier = await testEndpoint('/api/reports/query?report_type=sim_carrier_matrix&limit=5');
        console.log('4i. /api/reports/query (sim_carrier_matrix):', repCarrier.status, 'Total:', repCarrier.data?.total, 'Sample:', JSON.stringify(repCarrier.data?.rows?.[0]));

        const repPay = await testEndpoint('/api/reports/query?report_type=payments&limit=5');
        console.log('4j. /api/reports/query (payments):', repPay.status, 'Total:', repPay.data?.total, 'Sum:', repPay.data?.summary?.total_amount);

        const repSP = await testEndpoint('/api/reports/query?report_type=spare_parts&limit=5');
        console.log('4k. /api/reports/query (spare_parts):', repSP.status, 'Total:', repSP.data?.total);

        const repSPVal = await testEndpoint('/api/reports/query?report_type=sp_consumption&limit=5');
        console.log('4l. /api/reports/query (sp_consumption):', repSPVal.status, 'Total:', repSPVal.data?.total, 'Total Stock Valuation:', repSPVal.data?.summary?.total_amount);

        // 5. Trigger Sync Run
        console.log('5. Triggering /api/sync/run (POST)...');
        const syncRun = await testEndpoint('/api/sync/run', 'POST');
        console.log('   /api/sync/run response:', syncRun.status, syncRun.data?.success ? 'SUCCESS' : 'FAILED', syncRun.data?.message);

        console.log('--- ALL TESTS COMPLETED SUCCESSFULLY ---');
        process.exit(0);
    } catch (err) {
        console.error('Test failed with error:', err);
        process.exit(1);
    }
}

runTests();
