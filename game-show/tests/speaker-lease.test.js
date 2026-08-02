/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 13:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard for single-speaker election (backlog #8): the bug it exists to catch is two surfaces both synthesizing the same host line (double cost, overlapping audio). Pins the lease grant/renew/deny, TV-over-host-desk priority, TTL self-healing when the speaking tab dies, and per-room independence. Plain `node tests/speaker-lease.test.js`.
 */

'use strict';

const { createLeaseStore } = require('../lib/speaker-lease');

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

const NOW = 1000000;
const TV = 2, HOST = 1;

let store = createLeaseStore(8000);
check(store.claim('r1', 'tab-host', HOST, NOW).speaker === true, 'the first device in the room becomes the speaker');
check(store.claim('r1', 'tab-host', HOST, NOW + 1000).speaker === true, 'the holder renews freely');
check(store.claim('r1', 'tab-phone', HOST, NOW + 2000).speaker === false, 'an equal-priority rival is denied while the lease is live');
check(store.speakerOf('r1', NOW + 2000) === 'tab-host', 'the holder is reported');

// THE case this exists for: a TV opens after the host desk — the TV is the room's
// voice and takes over immediately, it does not wait for the desk's lease to die.
check(store.claim('r1', 'tab-tv', TV, NOW + 3000).speaker === true, 'a higher-priority TV takes the lease immediately');
check(store.claim('r1', 'tab-host', HOST, NOW + 4000).speaker === false, 'the host desk goes caption-only once the TV speaks');

// TTL self-heal: the speaking tab closes without releasing; the room re-elects.
check(store.claim('r1', 'tab-host', HOST, NOW + 12000).speaker === true, 'an expired lease is re-claimed by whoever polls next');

// Clean release hands the voice over within one poll instead of one TTL.
store.claim('r1', 'tab-tv', TV, NOW + 13000);
check(store.release('r1', 'tab-tv').released === true, 'the holder can release');
check(store.release('r1', 'tab-phone').released === false, 'a non-holder cannot release someone else\'s lease');
check(store.claim('r1', 'tab-host', HOST, NOW + 13500).speaker === true, 'a released lease re-elects immediately');

// Rooms are independent: one game's TV must never silence another game's.
check(store.claim('r2', 'other-tv', TV, NOW + 13500).speaker === true, 'a second room elects its own speaker');
check(store.speakerOf('r1', NOW + 13500) === 'tab-host' && store.speakerOf('r2', NOW + 13500) === 'other-tv', 'leases are per room');

check(store.speakerOf('r3', NOW) === null, 'a room with no lease has no speaker');

if (failures) { console.error(`\n✗ ${failures}/${checks} speaker-lease checks failed`); process.exit(1); }
console.log(`✓ Speaker election holds — ${checks} checks green (one voice per room, TV priority, TTL self-heal)`);
