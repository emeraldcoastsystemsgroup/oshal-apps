/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 22:04:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Validate durable opening and rewind narration gates so multiplayer state cannot advance while required presentation is pending.
 * 2026-07-22 00:18:41 | roger.murphy@emeraldcoastsystemsgroup.com  | Shorten abandoned presenter leases so a disconnected narration client cannot hold a shared table for two minutes.
 */

'use strict';

const PENDING_KEYS = [
  'complete', 'createdAt', 'id', 'kind', 'lease', 'leaseAt', 'message',
  'sceneId', 'turnSerial',
].sort();
const COMPLETE_KEYS = PENDING_KEYS.concat('completedAt').sort();
/** @description Time after which a disconnected presenter lease may transfer. */
const LEASE_STALE_MS = 20000;

/** @description Compare JSON-safe values used by the board contract. */
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @description Build the standard state-write rejection shape. */
function failure(error) {
  return { ok: false, code: 'STATE_FORBIDDEN', error };
}

/** @description Accept one bounded nonempty gate string. */
function boundedText(value, maximum) {
  return typeof value === 'string' && value.trim().length > 0
    && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * @description Validate a pending or completed gate against its containing board.
 * @param {*} value - Untrusted presentation gate.
 * @param {object} board - Board whose scene and turn the gate must identify.
 * @returns {object|null} The original valid gate, or null.
 */
function presentationGateRecord(value, board) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !board) return null;
  const expected = value.complete === true ? COMPLETE_KEYS : value.complete === false ? PENDING_KEYS : [];
  if (!same(Object.keys(value).sort(), expected)) return null;
  if (!boundedText(value.id, 80) || !boundedText(value.lease, 80)) return null;
  if (!['opening', 'rewind'].includes(value.kind) || !boundedText(value.message, 900)) return null;
  const serial = Number(board.turnSerial) || 0;
  if (value.sceneId !== String(board.sceneId || '') || value.turnSerial !== serial
      || !Number.isSafeInteger(value.turnSerial) || value.turnSerial < 0) return null;
  if (!Number.isFinite(value.createdAt) || value.createdAt <= 0
      || !Number.isFinite(value.leaseAt) || value.leaseAt < value.createdAt) return null;
  if (value.complete && (!Number.isFinite(value.completedAt)
      || value.completedAt < value.createdAt)) return null;
  return value;
}

/** @description Compare boards while allowing only the presentation gate to change. */
function sameBoardExceptGate(current, proposed) {
  const left = { ...current }, right = { ...proposed };
  delete left.presentationGate; delete right.presentationGate;
  return same(left, right);
}

/** @description Compare every immutable field of a pending gate. */
function sameGateIdentity(current, proposed) {
  const keys = ['id', 'kind', 'sceneId', 'turnSerial', 'message', 'createdAt'];
  return keys.every((key) => same(current[key], proposed[key]));
}

/** @description Accept an exact pending-to-complete transition. */
function exactCompletion(current, proposed) {
  return proposed.complete === true && sameGateIdentity(current, proposed)
    && current.lease === proposed.lease && current.leaseAt === proposed.leaseAt;
}

/** @description Bound lease refreshes and expired-client takeovers to current time. */
function validLeaseChange(current, proposed, now) {
  if (proposed.complete || !sameGateIdentity(current, proposed)) return false;
  if (proposed.leaseAt <= current.leaseAt || proposed.leaseAt < now - 300000
      || proposed.leaseAt > now + 30000) return false;
  return proposed.lease === current.lease || now - current.leaseAt >= LEASE_STALE_MS;
}

/** @description Decide the only two writes allowed while a gate is pending. */
function pendingGateDecision(current, proposed, owner, now) {
  if (!owner) return failure('Wait for the host presentation to finish.');
  const oldGate = presentationGateRecord(current.presentationGate, current);
  const nextGate = presentationGateRecord(proposed && proposed.presentationGate, proposed);
  if (!oldGate || !nextGate || !sameBoardExceptGate(current, proposed)) {
    return failure('A pending presentation must finish before the board can change.');
  }
  if (exactCompletion(oldGate, nextGate) || validLeaseChange(oldGate, nextGate, now)) return { ok: true };
  return failure('A pending presentation may only complete or transfer an expired presenter lease.');
}

/** @description Recognize the one setup transition that replaces a completed rewind. */
function openingAfterRewind(current, proposed, owner) {
  const oldGate = presentationGateRecord(current.presentationGate, current);
  const nextGate = presentationGateRecord(proposed && proposed.presentationGate, proposed);
  return !!(owner && current.mode === 'setup' && proposed && proposed.mode === 'combat'
    && oldGate && oldGate.complete && oldGate.kind === 'rewind'
    && nextGate && !nextGate.complete && nextGate.kind === 'opening');
}

/**
 * @description Gate a board write before ordinary ownership and combat validation.
 * @param {object} current - Authoritative board.
 * @param {object} proposed - Candidate board.
 * @param {boolean} owner - Whether the caller owns the campaign.
 * @param {number} [now] - Current epoch time for deterministic lease tests.
 * @returns {object|null} Final decision when handled, otherwise null to continue.
 */
function presentationGateDecision(current, proposed, owner, now) {
  if (!current || !proposed) return null;
  const oldGate = current.presentationGate, nextGate = proposed.presentationGate;
  if (!owner && current.mode === 'setup' && proposed.mode === 'combat') return null;
  if (oldGate && oldGate.complete === false) {
    return pendingGateDecision(current, proposed, owner, Number(now) || Date.now());
  }
  if (oldGate && oldGate.complete === true && !same(oldGate, nextGate)) {
    return openingAfterRewind(current, proposed, owner) ? null
      : failure('A completed presentation record cannot be removed, reopened, or rewritten.');
  }
  if (!oldGate && nextGate) {
    const valid = owner && current.mode === 'setup' && proposed.mode === 'combat'
      && (presentationGateRecord(nextGate, proposed) || {}).kind === 'opening'
      && nextGate.complete === false;
    return valid ? null : failure('Only the host may create the opening presentation when combat starts.');
  }
  if (!oldGate && current.mode === 'setup' && proposed.mode === 'combat') {
    return failure('The opening narration must be saved before combat starts.');
  }
  return null;
}

module.exports = {
  LEASE_STALE_MS, presentationGateRecord, presentationGateDecision,
};
