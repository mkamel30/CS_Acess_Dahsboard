const path = require('path');
const ngrok = require(path.join(__dirname, 'node_modules', '@ngrok', 'ngrok'));

async function test() {
    try {
        console.log('Connecting to ngrok with auth token...');
        const listener = await ngrok.forward({
            addr: 8970,
            authtoken: '3IJgjBXQtECHckqH68slwcVPEGX_qrF34khDLTRLrLMRKrr1'
        });
        console.log('====================================================');
        console.log('SUCCESS! Ngrok Live URL:', listener.url());
        console.log('====================================================');
        setTimeout(async () => {
            await listener.close();
            console.log('Closed test listener.');
            process.exit(0);
        }, 5000);
    } catch (e) {
        console.error('Ngrok Error:', e);
        process.exit(1);
    }
}

test();
