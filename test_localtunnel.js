const localtunnel = require('localtunnel');

async function testLT() {
    try {
        console.log('Testing subdomain: smartcs-pos...');
        const tunnel = await localtunnel({ port: 8970, subdomain: 'smartcs-pos' });
        console.log('RESULT URL:', tunnel.url);
        tunnel.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

testLT();
