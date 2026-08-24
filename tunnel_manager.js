const localtunnel = require('localtunnel');
const ngrok = require('@ngrok/ngrok');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class UniversalTunnelManager {
    constructor(port = 8970) {
        this.port = port;
        this.provider = 'ngrok'; // 'ngrok', 'cloudflare', 'localtunnel'
        this.subdomain = 'smartcs';
        this.publicUrl = 'https://smartcs.m-kamel.workers.dev';
        this.status = 'STOPPED';
        this.startedAt = null;
        this.errorMsg = null;
        this.ltInstance = null;
        this.ngrokListener = null;
        this.cloudflareProcess = null;
        this.cloudflareToken = 'eyJhIjoiZjA1MDc3NTkyN2ZhZDAzOGNmMjk3N2Y4MDkzYjg2OTkiLCJ0IjoiZDQwY2I2ZTAtZjhlYi00YTA0LTk4MWItMDMwOWE0YTViOGM2IiwicyI6Ik9XVTRZVFZoT0dJdFltRXlNQzAwWWpnMExUbGxNMkV0T0RJNVpqYzNORFUxTVRSaCJ9';
        this.ngrokAuthToken = '3IJgjBXQtECHckqH68slwcVPEGX_qrF34khDLTRLrLMRKrr1';
        this.ngrokDomain = 'shading-mulberry-legume.ngrok-free.dev';
    }

    getStatus() {
        return {
            status: this.status,
            running: this.status === 'RUNNING',
            provider: this.provider,
            subdomain: this.subdomain,
            publicUrl: this.publicUrl,
            startedAt: this.startedAt,
            port: this.port,
            error: this.errorMsg
        };
    }

    async start(options = {}) {
        if (typeof options === 'string') {
            options = { token: options };
        }
        const provider = (options && options.provider) || this.provider || 'cloudflare';
        this.provider = provider;
        this.status = 'STARTING';
        this.errorMsg = null;
        this.startedAt = new Date().toISOString();

        if (provider === 'cloudflare') {
            return this.startCloudflare(options || {});
        } else if (provider === 'ngrok') {
            return this.startNgrok(options || {});
        } else {
            return this.startLocalTunnel(options || {});
        }
    }

    async startLocalTunnel(options = {}) {
        try {
            if (this.ltInstance) {
                try { this.ltInstance.close(); } catch(e){}
                this.ltInstance = null;
            }

            const sub = options.subdomain || this.subdomain || 'smartcs';
            console.log(`[LocalTunnel] Requesting custom subdomain: ${sub}...`);

            this.ltInstance = await localtunnel({
                port: this.port,
                subdomain: sub
            });

            this.publicUrl = this.ltInstance.url;
            this.status = 'RUNNING';
            this.provider = 'localtunnel';

            console.log('================================================================');
            console.log(`[CUSTOM DOMAIN ONLINE] Global Web Access: ${this.publicUrl}`);
            console.log('================================================================');

            this.ltInstance.on('close', () => {
                console.log('[LocalTunnel] Closed.');
                this.status = 'STOPPED';
                this.publicUrl = null;
                this.ltInstance = null;
            });

            this.ltInstance.on('error', (err) => {
                console.error('[LocalTunnel Error]', err);
            });

            return this.getStatus();
        } catch (err) {
            console.error('[LocalTunnel Startup Error]', err);
            this.status = 'ERROR';
            this.errorMsg = err.message;
            console.log('[Tunnel] Falling back to Ngrok...');
            return this.startNgrok(options);
        }
    }

    async startNgrok(options = {}) {
        try {
            if (this.ngrokListener) {
                try { await this.ngrokListener.close(); } catch(e){}
                this.ngrokListener = null;
            }

            const token = options.token || this.ngrokAuthToken;
            const domain = options.domain || this.ngrokDomain || 'shading-mulberry-legume.ngrok-free.dev';

            console.log(`[Ngrok Tunnel] Initializing session with domain: ${domain}...`);
            const forwardOpts = {
                addr: this.port,
                authtoken: token
            };
            if (domain) forwardOpts.domain = domain;

            this.ngrokListener = await ngrok.forward(forwardOpts);
            this.publicUrl = 'https://smartcs.m-kamel.workers.dev';
            this.status = 'RUNNING';
            this.provider = 'ngrok';

            console.log('================================================================');
            console.log(`[SMARTCS CLOUDFLARE ONLINE] Global Web Access: ${this.publicUrl}`);
            console.log(`[Underlying Ngrok Bridge]: ${this.ngrokListener.url()}`);
            console.log('================================================================');

            return this.getStatus();
        } catch (err) {
            console.error('[Ngrok Tunnel Error]', err);
            if (err.message && (err.message.includes('ERR_NGROK_334') || err.message.includes('already online')) && !options._retried) {
                console.log('[Ngrok Tunnel] Previous endpoint session releasing, retrying in 3 seconds...');
                await new Promise(r => setTimeout(r, 3000));
                return this.startNgrok({ ...options, _retried: true });
            }
            this.status = 'ERROR';
            this.errorMsg = err.message;
            return this.startCloudflare(options);
        }
    }

    startCloudflare(options = {}) {
        const executablePath = path.join(__dirname, 'cloudflared.exe');
        if (!fs.existsSync(executablePath)) {
            this.status = 'ERROR';
            this.errorMsg = 'cloudflared.exe not found';
            return Promise.reject(new Error(this.errorMsg));
        }

        return new Promise((resolve) => {
            const token = options.token || this.cloudflareToken;
            const args = token 
                ? ['tunnel', 'run', '--token', token]
                : ['tunnel', '--url', `http://localhost:${this.port}`];

            console.log(`[Cloudflare Tunnel] Spawning ${executablePath} with args:`, args.join(' '));
            this.cloudflareProcess = spawn(executablePath, args, {
                cwd: __dirname,
                windowsHide: true
            });

            let resolved = false;

            const parseOutput = (data) => {
                const text = data.toString();
                const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
                if (match && !this.publicUrl) {
                    this.publicUrl = match[0];
                    this.status = 'RUNNING';
                    this.provider = 'cloudflare';
                    console.log('================================================================');
                    console.log(`[CLOUDFLARE TUNNEL ONLINE] Global Web Access: ${this.publicUrl}`);
                    console.log('================================================================');
                    if (!resolved) {
                        resolved = true;
                        resolve(this.getStatus());
                    }
                }
            };

            this.cloudflareProcess.stdout.on('data', parseOutput);
            this.cloudflareProcess.stderr.on('data', parseOutput);

            this.cloudflareProcess.on('close', () => {
                this.status = 'STOPPED';
                this.publicUrl = null;
                this.cloudflareProcess = null;
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    resolve(this.getStatus());
                }
            }, 10000);
        });
    }

    async stop() {
        if (this.ltInstance) {
            try { this.ltInstance.close(); } catch(e){}
            this.ltInstance = null;
        }
        if (this.ngrokListener) {
            try { await this.ngrokListener.close(); } catch(e){}
            this.ngrokListener = null;
        }
        if (this.cloudflareProcess) {
            try { this.cloudflareProcess.kill('SIGKILL'); } catch(e){}
            this.cloudflareProcess = null;
        }
        this.status = 'STOPPED';
        this.publicUrl = null;
        this.startedAt = null;
        return this.getStatus();
    }
}

module.exports = UniversalTunnelManager;
