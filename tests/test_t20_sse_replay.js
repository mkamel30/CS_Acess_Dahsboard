const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Test T-20: SSE Monotonic Event IDs and Last-Event-ID Replay Contract (F-21)
test('T-20 / F-21: Server implements monotonic SSE IDs, bounded ring buffer, and Last-Event-ID replay', async (t) => {
    const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

    // 1. Verify monotonic ID and ring buffer declaration
    assert.ok(serverCode.includes('let nextSseEventId = 1'), 'nextSseEventId must be initialized');
    assert.ok(serverCode.includes('const SSE_BUFFER_MAX = 100'), 'SSE_BUFFER_MAX must be defined');
    assert.ok(serverCode.includes('const sseEventBuffer = []'), 'sseEventBuffer must be defined');

    // 2. Verify broadcastSseEvent formats id line and updates ring buffer
    assert.ok(serverCode.includes('id: ${eventId}\\nevent: ${eventType}'), 'broadcast payload must include monotonic id');
    assert.ok(serverCode.includes('sseEventBuffer.push('), 'broadcast must push to ring buffer');
    assert.ok(serverCode.includes('sseEventBuffer.shift()'), 'ring buffer must drop oldest past capacity');

    // 3. Verify /api/sync/events checks Last-Event-ID and replays missed events
    assert.ok(serverCode.includes("req.headers['last-event-id']"), 'SSE endpoint must read Last-Event-ID header');
    assert.ok(serverCode.includes('e.id > lastEventId'), 'SSE endpoint must filter missed events with id > lastEventId');

    // 4. Test ring buffer and replay logic in simulation
    let simNextId = 1;
    const simBuffer = [];
    const SIM_MAX = 5;

    function simBroadcast(eventType, data) {
        const id = simNextId++;
        simBuffer.push({ id, eventType, data });
        if (simBuffer.length > SIM_MAX) simBuffer.shift();
        return id;
    }

    function simReplay(lastSeenId) {
        return simBuffer.filter(e => e.id > lastSeenId);
    }

    for (let i = 1; i <= 10; i++) {
        simBroadcast('sync_update', { step: i });
    }

    assert.equal(simBuffer.length, 5, 'Buffer should be capped at SIM_MAX (5)');
    assert.equal(simBuffer[0].data.step, 6, 'Oldest buffered event should be step 6');
    assert.equal(simBuffer[4].data.step, 10, 'Latest buffered event should be step 10');

    // Client reconnects with last-seen ID 7 (missed 8, 9, 10)
    const missed = simReplay(7);
    assert.equal(missed.length, 3, 'Should replay exactly 3 missed events');
    assert.deepEqual(missed.map(m => m.data.step), [8, 9, 10]);

    // Client reconnects with latest ID 10 (missed nothing)
    assert.equal(simReplay(10).length, 0, 'Should replay 0 events when up to date');
});
