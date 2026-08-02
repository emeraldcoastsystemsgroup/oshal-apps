/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-25 02:20:00 | codex                                      | Define the reusable broadcast-cutaway catalog, deterministic state-to-cutaway selection, and safe optional MP4 discovery.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CUTAWAYS = Object.freeze([
  { id: 'show-open', label: 'Show open', durationMs: 3200 },
  { id: 'buzzer-race', label: 'Buzzer race', durationMs: 2600 },
  { id: 'team-huddle', label: 'Team huddle', durationMs: 3000 },
  { id: 'interview', label: 'Contestant interview', durationMs: 2600 },
  { id: 'strike', label: 'Strike', durationMs: 1800 },
  { id: 'celebration', label: 'Celebration', durationMs: 4200 },
]);

const BY_ID = new Map(CUTAWAYS.map((item) => [item.id, item]));

/**
 * @description Pick a reusable cutaway from semantic game state. Returns null
 * for normal board and scoreboard shots so cutaways remain punctuation.
 */
function selectCutaway(state) {
  const current = state || {};
  const phase = String(current.phase || '');
  const shot = String((current.shot && current.shot.type) || '');
  if (phase === 'strike') return 'strike';
  if (shot === 'buzzer-race') return 'buzzer-race';
  if (shot === 'team-huddle') return 'team-huddle';
  if (shot === 'interview') return 'interview';
  if (shot === 'celebration') return 'celebration';
  if (shot === 'lobby' || (shot === 'audience-pan' && phase === 'intro')) return 'show-open';
  return null;
}

/** @description Resolve only a named catalog asset beneath ui/cutaways. */
function resolveCutawayFile(root, id) {
  const item = BY_ID.get(String(id || ''));
  if (!item) return null;
  const file = path.join(path.resolve(root), 'ui', 'cutaways', `${item.id}.mp4`);
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0 ? file : null;
  } catch (_error) {
    return null;
  }
}

/** @description Public metadata; rendered MP4s are optional and fail soft. */
function listCutaways(root) {
  return CUTAWAYS.map((item) => ({
    ...item,
    available: !!resolveCutawayFile(root, item.id),
    src: `/api/game-show/cutaways/${item.id}.mp4`,
  }));
}

module.exports = { CUTAWAYS, selectCutaway, resolveCutawayFile, listCutaways };
