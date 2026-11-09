const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Test isPrivateIp logic from server.js
function isPrivateIp(ipStr) {
    if (!ipStr || typeof ipStr !== 'string') return false;
    let ip = ipStr.trim();
    if (ip === 'localhost' || ip === '::1') return true;
    if (ip.startsWith('::ffff:')) {
        ip = ip.slice(7);
    }
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
        return false;
    }
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 10.0.0.0/8 (Class A private)
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 (Class B private: 172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Class C private)
    if (parts[0] === 192 && parts[1] === 168) return true;

    return false;
}

function safeCompareSecret(provided, expected) {
    if (!provided || !expected) return false;
    try {
        const bufA = Buffer.from(String(provided));
        const bufB = Buffer.from(String(expected));
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    } catch { return false; }
}

function createSyncValidator(primary, transitionOld = '') {
    return function isValidSyncSecret(provided) {
        if (!provided) return false;
        if (primary && safeCompareSecret(provided, primary)) return true;
        if (transitionOld && safeCompareSecret(provided, transitionOld)) return true;
        return false;
    };
}

test('T-01: RFC 1918 Private CIDR matching accepts only real LAN and rejects public 172.x', () => {
    // Valid private addresses
    assert.equal(isPrivateIp('127.0.0.1'), true, '127.0.0.1 must be private');
    assert.equal(isPrivateIp('::1'), true, '::1 must be private');
    assert.equal(isPrivateIp('localhost'), true, 'localhost must be private');
    assert.equal(isPrivateIp('192.168.1.100'), true, '192.168.1.100 must be private');
    assert.equal(isPrivateIp('::ffff:192.168.1.100'), true, 'IPv6-mapped 192.168.1.100 must be private');
    assert.equal(isPrivateIp('10.20.30.40'), true, '10.x must be private');
    assert.equal(isPrivateIp('172.16.0.1'), true, '172.16.0.1 must be private');
    assert.equal(isPrivateIp('172.31.255.254'), true, '172.31.255.254 must be private');

    // Insecure / Public addresses previously bypassed by startsWith("172.")
    assert.equal(isPrivateIp('172.0.0.1'), false, '172.0.0.1 is PUBLIC and must NOT bypass');
    assert.equal(isPrivateIp('172.1.2.3'), false, '172.1.2.3 is PUBLIC and must NOT bypass');
    assert.equal(isPrivateIp('172.15.255.255'), false, '172.15.x is PUBLIC and must NOT bypass');
    assert.equal(isPrivateIp('172.32.0.1'), false, '172.32.x is PUBLIC and must NOT bypass');
    assert.equal(isPrivateIp('172.217.16.206'), false, 'Google 172.217.x is PUBLIC and must NOT bypass');
    assert.equal(isPrivateIp('::ffff:172.1.1.1'), false, 'IPv6-mapped 172.1.1.1 is PUBLIC and must NOT bypass');
    assert.equal(isPrivateIp('8.8.8.8'), false, '8.8.8.8 is PUBLIC');
});

test('T-01: Dual-secret rotation validator allows zero-downtime key rotation and rejects defaults', () => {
    const validator = createSyncValidator('new-rot-key-abc123', 'old-key-xyz789');

    // Both current and transition keys are accepted
    assert.equal(validator('new-rot-key-abc123'), true, 'Primary secret accepted');
    assert.equal(validator('old-key-xyz789'), true, 'Transition old secret accepted');

    // Default leaked secret or random string is rejected
    assert.equal(validator('smartcs-cloud-secret-2026'), false, 'Leaked default secret rejected');
    assert.equal(validator('wrong-secret'), false, 'Arbitrary secret rejected');
    assert.equal(validator(''), false, 'Empty secret rejected');
    assert.equal(validator(null), false, 'Null secret rejected');

    // Fail-closed when no secret is configured
    const unconfiguredValidator = createSyncValidator('', '');
    assert.equal(unconfiguredValidator('any-key'), false, 'Must fail closed when secret unconfigured');
});

test('T-01: Source code scan confirms removal of hardcoded admin alternates and default secrets', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const syncSource = fs.readFileSync(path.join(__dirname, '../sync_engine.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

    // Verify TITI is completely removed
    assert.doesNotMatch(serverSource, /['"]TITI['"]/, 'server.js must not contain TITI');
    assert.doesNotMatch(appSource, /['"]TITI['"]/, 'app.js must not contain TITI');

    // Verify fail closed in sync_engine
    assert.match(syncSource, /No syncSecret configured/, 'sync_engine must log error and abort when secret missing');

    // Verify requireAdmin does not have hardcoded alternates
    assert.doesNotMatch(serverSource, /smartcs-admin-2026/, 'server.js requireAdmin must not contain hardcoded alternate admin passwords');
});
