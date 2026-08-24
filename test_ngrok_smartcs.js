const ngrok = require('@ngrok/ngrok');

async function test() {
    try {
        console.log('Testing domain: smartcs.ngrok-free.app...');
        const listener = await ngrok.forward({
            addr: 8970,
            authtoken: '3IJgjBXQtECHckqH68slwcVPEGX_qrF34khDLTRLrLMRKrr1',
            domain: 'smartcs.ngrok-free.app'
        });
        console.log('====================================================');
        console.log('SUCCESS! Ngrok URL:', listener.url());
        console.log('====================================================');
        process.exit(0);
    } catch (e) {
        console.error('Test Result:', e.message);
        process.exit(1);
    }
}

test();
