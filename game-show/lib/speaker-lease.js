/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 11:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Single-speaker election (backlog #8): every speaker surface used to synthesize its own audio — duplicate TTS cost and overlapping playback when a TV and a host desk share a room. One short-TTL lease per room decides which DEVICE speaks; everyone else stays caption-only. Pure and in-memory: leases are advisory playback coordination, not data, so losing them on an api restart just re-elects within a poll.
 */

'use strict';

/**
 * WHY A LEASE AND NOT ROOM STATE: the speaker changes when a tab closes, which is
 * exactly the event a tab cannot report. A TTL lease renewed by the speaking
 * device's poll self-heals in one TTL when that device vanishes, and it never
 * touches gameshow_state (a rev bump per renewal would force every device to
 * re-pull the board every few seconds).
 *
 * Priority resolves the "TV and host desk both open" case: the TV (priority 2)
 * is the room's voice and may take the lease from a host desk (priority 1)
 * immediately; equal or lower priority waits for expiry.
 */

const DEFAULT_TTL_MS = 8000;

/**
 * @description Create an in-memory speaker-lease store (one per route environment).
 * @param {number} [ttlMs] - How long a granted lease lives without renewal.
 * @returns {{claim:Function, release:Function, speakerOf:Function}} Lease operations.
 */
function createLeaseStore(ttlMs = DEFAULT_TTL_MS) {
  const leases = new Map();   // roomId -> { deviceId, priority, expiresAt }

  /**
   * @description Claim or renew the room's speaker lease for one device.
   * @param {string} roomId - Room the device is watching.
   * @param {string} deviceId - Stable per-tab identifier.
   * @param {number} priority - Higher wins (tv=2, host=1); ties keep the holder.
   * @param {number} [now] - Clock injection for tests.
   * @returns {{speaker:boolean}} Whether THIS device should synthesize audio.
   */
  function claim(roomId, deviceId, priority, now = Date.now()) {
    const key = String(roomId);
    const device = String(deviceId);
    const rank = Number(priority) || 0;
    const held = leases.get(key);
    const live = held && held.expiresAt > now;
    if (!live || held.deviceId === device || rank > held.priority) {
      leases.set(key, { deviceId: device, priority: rank, expiresAt: now + ttlMs });
      return { speaker: true };
    }
    return { speaker: false };
  }

  /**
   * @description Release a lease the device holds (tab navigating away cleanly).
   * @param {string} roomId - Room whose lease to release.
   * @param {string} deviceId - Device that believes it holds the lease.
   * @returns {{released:boolean}} Whether a held lease was dropped.
   */
  function release(roomId, deviceId) {
    const held = leases.get(String(roomId));
    if (held && held.deviceId === String(deviceId)) { leases.delete(String(roomId)); return { released: true }; }
    return { released: false };
  }

  /**
   * @description The device currently holding a live lease, or null (for tests/ops).
   * @param {string} roomId - Room to inspect.
   * @param {number} [now] - Clock injection for tests.
   * @returns {?string} Holding deviceId.
   */
  function speakerOf(roomId, now = Date.now()) {
    const held = leases.get(String(roomId));
    return held && held.expiresAt > now ? held.deviceId : null;
  }

  return { claim, release, speakerOf };
}

module.exports = { createLeaseStore, DEFAULT_TTL_MS };
