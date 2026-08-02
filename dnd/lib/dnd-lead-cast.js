/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-27 23:10:00 | roger.murphy@emeraldcoastsystemsgroup.com  | An investigated lead now walks onto the map. A chapter authored 1-3 static props while the party actually met 4-6 people, places, and objects through leads — and the hero already WALKED to a lead's spot (DnDLeads.leadSpot) where nothing was ever drawn. This casts each discovered lead as a real figure on that exact square, so the board fills in as the investigation does.
 * 2026-07-27 23:55:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Add the authoritative hero walk: the acting hero moves beside the lead's figure in the same board write as the attempt, so every device sees the party cross the room regardless of client version.
 * 2026-07-31 11:05:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract walkHeroBeside(cell) from the lead walk so the conversation path can walk a hero beside an authored prop the fiction sent them to — a lead is no longer the only destination the board understands.
 */

'use strict';

const LEADS = require('../ui/leads.js');

/** Board glyphs mirror the lead-button vocabulary the players already read. */
const LEAD_GLYPH = { person: '☗', place: '⌖', object: '◆' };
const LEAD_COLOR = { person: '#e0a44c', place: '#8fb8de', object: '#cbb6f3' };

/**
 * @description The authored prop this lead already refers to, if any. An explicit
 *   `prop` on the lead wins; an exact id match is the fallback so older content
 *   keeps working without being re-authored.
 * @param {object} lead - Authored lead.
 * @param {object} scene - Authored scene.
 * @returns {string} The prop id, or '' when this lead has no figure yet.
 */
function authoredPropId(lead, scene) {
  const props = (scene && scene.props) || [];
  const explicit = lead && lead.prop ? String(lead.prop) : '';
  if (explicit && props.some((prop) => prop.id === explicit)) return explicit;
  return props.some((prop) => prop.id === (lead && lead.id)) ? String(lead.id) : '';
}

/** @description The board id a cast lead uses — namespaced so it cannot collide with authored ids. */
function castIdFor(lead) {
  return `lead:${lead && lead.id}`;
}

/** @description The one-line label under a cast figure's name on the board and inspector. */
function leadRole(lead) {
  const type = String((lead && lead.type) || 'person');
  if (type === 'place') return 'Searched during the investigation';
  if (type === 'object') return 'Evidence the party recovered';
  return 'Met during the investigation';
}

/**
 * @description Build the board token for a discovered lead, or null when the party
 *   already has this figure (an authored prop, or a cast token from an earlier find).
 *   Placement delegates to DnDLeads.leadSpot — the SAME cell the acting hero walks
 *   to — so a figure can never appear somewhere the fiction did not put it.
 * @param {object} lead - The discovered lead.
 * @param {object} scene - The authored scene.
 * @param {Array} tokens - Current board tokens.
 * @param {Array} siblings - Every lead in the chapter, for deterministic spacing.
 * @returns {object|null} The token to append, or null when nothing new appears.
 */
function castTokenForLead(lead, scene, tokens, siblings) {
  if (!lead || !lead.id) return null;
  const board = Array.isArray(tokens) ? tokens : [];
  if (authoredPropId(lead, scene)) return null;
  const id = castIdFor(lead);
  if (board.some((token) => token.id === id)) return null;
  const at = LEADS.leadSpot(lead, scene, siblings || [lead]);
  if (!at) return null;
  const type = String(lead.type || 'person');
  return {
    id, kind: 'prop', name: lead.name, role: leadRole(lead), storyHook: lead.reveal || '',
    leadId: String(lead.id), leadType: type, met: true,
    x: at.x, y: at.y,
    glyph: LEAD_GLYPH[type] || '•', color: LEAD_COLOR[type] || '#94a3b8',
    hp: 1, maxHp: 1,
  };
}

/**
 * @description Apply a discovery to the board: cast the new figure when there is one,
 *   and mark an authored prop as met so the surface can show the party has reached them.
 * @param {Array} tokens - Current board tokens.
 * @param {object} lead - The discovered lead.
 * @param {object} scene - The authored scene.
 * @param {Array} siblings - Every lead in the chapter.
 * @returns {{tokens:Array, cast:object|null}} The next token list and the figure that appeared.
 */
function withDiscoveredLead(tokens, lead, scene, siblings) {
  const board = (Array.isArray(tokens) ? tokens : []).map((token) => ({ ...token }));
  const authored = authoredPropId(lead, scene);
  if (authored) {
    const existing = board.find((token) => token.id === authored);
    if (existing) { existing.met = true; existing.leadId = String(lead.id); }
    return { tokens: board, cast: null };
  }
  const cast = castTokenForLead(lead, scene, board, siblings);
  if (!cast) return { tokens: board, cast: null };
  board.push(cast);
  return { tokens: board, cast };
}

/**
 * @description The cell a lead's figure occupies (or will occupy): the linked authored
 *   prop, an already-cast figure, or the deterministic lead spot. This is the anchor
 *   the acting hero walks to, so movement and casting can never disagree.
 * @param {object} lead - Authored lead.
 * @param {object} scene - The authored scene.
 * @param {Array} tokens - Current board tokens.
 * @param {Array} siblings - Every lead in the chapter.
 * @returns {{x:number,y:number}} The figure's cell.
 */
function figureCellForLead(lead, scene, tokens, siblings) {
  const board = Array.isArray(tokens) ? tokens : [];
  const authored = authoredPropId(lead, scene);
  const anchor = (authored && (board.find((token) => token.id === authored)
    || (scene.props || []).find((prop) => prop.id === authored)))
    || board.find((token) => token.id === castIdFor(lead));
  if (anchor && Number.isFinite(Number(anchor.x))) return { x: anchor.x, y: anchor.y };
  return LEADS.leadSpot(lead, scene, siblings || [lead]);
}

/**
 * @description Walk a hero to the lead they are working — the AUTHORITATIVE move, made
 *   in the same board write as the attempt, so every device (any client version) sees
 *   the hero cross the room via ordinary state sync. Stands beside the figure, never on
 *   it; deterministic candidate order so all devices agree.
 * @param {Array} tokens - Current board tokens.
 * @param {string} heroSlug - The acting hero.
 * @param {object} lead - The lead being worked.
 * @param {object} scene - The authored scene.
 * @param {Array} siblings - Every lead in the chapter.
 * @returns {{tokens:Array, moved:boolean}} Next token list and whether anyone walked.
 */
function walkHeroBesideLead(tokens, heroSlug, lead, scene, siblings) {
  const spot = figureCellForLead(lead, scene, tokens, siblings);
  return walkHeroBeside(tokens, heroSlug, spot, scene);
}

/**
 * @description Walk a hero to stand beside one exact cell — the shared authoritative
 *   move underneath both the lead walk and the conversation walk. Stands adjacent,
 *   never on the cell; deterministic candidate order so all devices agree.
 * @param {Array} tokens - Current board tokens.
 * @param {string} heroSlug - The acting hero.
 * @param {{x:number,y:number}|null} spot - The destination figure's cell.
 * @param {object} scene - The authored scene, for grid bounds and blocking terrain.
 * @returns {{tokens:Array, moved:boolean}} Next token list and whether anyone walked.
 */
function walkHeroBeside(tokens, heroSlug, spot, scene) {
  const board = (Array.isArray(tokens) ? tokens : []).map((token) => ({ ...token }));
  const hero = board.find((token) => token.kind === 'pc' && token.slug === String(heroSlug || ''));
  if (!hero || !spot || !Number.isFinite(Number(spot.x)) || !Number.isFinite(Number(spot.y))) {
    return { tokens: board, moved: false };
  }
  const grid = (scene && scene.grid) || { w: 18, h: 12 };
  const blocking = new Set((((scene && scene.terrain) || {}).blocking || []).map((cell) => `${cell.x},${cell.y}`));
  const target = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
    .map((offset) => ({ x: spot.x + offset[0], y: spot.y + offset[1] }))
    .find((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < (grid.w || 18) && cell.y < (grid.h || 12)
      && !blocking.has(`${cell.x},${cell.y}`)
      && !board.some((other) => other !== hero && other.x === cell.x && other.y === cell.y));
  if (!target || (hero.x === target.x && hero.y === target.y)) return { tokens: board, moved: false };
  hero.x = target.x; hero.y = target.y;
  return { tokens: board, moved: true };
}

/**
 * @description Bring the board up to date with every lead the party has already found.
 *   Chapters played before figures existed — and any write that raced a discovery —
 *   otherwise keep an empty map forever, because a lead only ever casts once.
 * @param {Array} tokens - Current board tokens.
 * @param {Array} leads - The authored leads for this scene.
 * @param {Array} discovered - Ids the party has shared.
 * @param {object} scene - The authored scene.
 * @returns {{tokens:Array, cast:Array}} Next token list and every figure that appeared.
 */
function reconcileDiscoveredCast(tokens, leads, discovered, scene) {
  const found = new Set((discovered || []).map(String));
  const siblings = leads || [];
  let board = Array.isArray(tokens) ? tokens : [];
  const cast = [];
  for (const lead of siblings) {
    if (!found.has(String(lead.id))) continue;
    const step = withDiscoveredLead(board, lead, scene, siblings);
    board = step.tokens;
    if (step.cast) cast.push(step.cast);
  }
  return { tokens: board, cast };
}

module.exports = {
  LEAD_GLYPH, LEAD_COLOR, authoredPropId, castIdFor, castTokenForLead,
  figureCellForLead, leadRole, walkHeroBeside, walkHeroBesideLead,
  withDiscoveredLead, reconcileDiscoveredCast,
};
