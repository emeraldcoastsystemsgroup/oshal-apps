/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 13:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Isolate multiplayer lobby and authored investigation-start authorization below the repository decomposition threshold.
 */

'use strict';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** @description Copy a board without the fields intentionally changed by investigation startup. */
function withoutPhaseFields(value) {
  const copy = { ...(value || {}) };
  ['exploration', 'mode', 'order', 'round', 'turnIndex'].forEach((key) => delete copy[key]);
  return copy;
}

/** @description Permit only the exact authored setup-to-investigation phase change. */
function validExplorationStart(current, proposed) {
  if (!current || !proposed || proposed.mode !== 'exploration') return false;
  const progress = proposed.exploration;
  if (!progress || !same(Object.keys(progress).sort(), ['discovered'])
      || !Array.isArray(progress.discovered) || progress.discovered.length) return false;
  const pcOrder = (current.tokens || [])
    .filter((token) => token.kind === 'pc').map((token) => token.id);
  return same(proposed.order, pcOrder) && Number(proposed.turnIndex) === 0
    && Number(proposed.round) === 0
    && same(withoutPhaseFields(current), withoutPhaseFields(proposed));
}

/**
 * @description Authorize only host-owned setup writes and keep joined players in the lobby until claimed.
 * @param {boolean} owner - Whether the caller owns the campaign.
 * @param {object[]} seats - Current multiplayer seats.
 * @param {object} current - Authoritative setup board.
 * @param {object} proposed - Candidate first playable board.
 * @returns {{ok:boolean,code?:string,error?:string}} Exact setup decision.
 */
function setupWriteDecision(owner, seats, current, proposed) {
  if (!owner) return { ok: false, code: 'NOT_YOUR_TURN', error: 'Only the host can set up the encounter.' };
  const startsQuest = current && proposed && current.mode === 'setup'
    && ['combat', 'exploration'].includes(proposed.mode);
  if (startsQuest && (seats || []).some((seat) => !seat.character_slug)) {
    return { ok: false, code: 'LOBBY_NOT_READY', error: 'Every joined player must claim a hero before the quest starts.' };
  }
  if (proposed && proposed.mode === 'exploration' && !validExplorationStart(current, proposed)) {
    return { ok: false, code: 'STATE_FORBIDDEN', error: 'An investigation must begin with an empty shared clue ledger and the authored board unchanged.' };
  }
  return { ok: true };
}

module.exports = { setupWriteDecision };
