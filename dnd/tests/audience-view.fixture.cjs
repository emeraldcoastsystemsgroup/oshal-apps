/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Dungeon Master family audience view (ADR-164 D6): the review page, its declared URL, synthetic read-only answers shaped like GET /api/dnd/campaigns (the table's My Games library rows as campaignSummaryDto projects them, join code included so the view is proved never to paint it), /characters (characterDto rows with their normalized sheets) and /home-summary (the route's two metrics, one item per recently saved game with its two offers whose notes carry the latest story beat, the member-rule note last), and what the family view must show. The home summary also feeds the full page's own start without an audience. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | A second entry (the harness takes an array): the table, ui/table.html at /api/dnd/table, the games group's first surface that the Jarvis shell frames with ?audience=family. It serves the table's own stylesheet and classic scripts as the harness assets, the same synthetic /campaigns and /characters answers (the campaigns now carry real adventure and scene ids so chapters resolve) and the REAL bundled /content catalog built the way the route builds it, and names what the family view must show. Without the audience the full table boots from the same reads onto its My Games shelf, which the harness waits for.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The company audience (ADR-164 D6) expects the same card as the family one: the harness paints it in the company grammar over the same synthetic reads.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadAdventureCatalog } = require('../lib/dnd-adventure-catalog');

const JOIN_CODE = 'SYNQ7X';
const DATA = path.join(__dirname, '..', 'data');
/** The table's classic bundle in its served order (routes/dnd-routes.js UI_SCRIPTS), plus its stylesheet. */
const TABLE_ASSETS = ['dnd.css', 'engine.js', 'leads.js', 'table-runtime.js', 'table-voice.js', 'table-dice.js', 'table-presentation.js', 'table-turns.js',
  'table-combat-narration.js', 'table-automation.js', 'table-outcomes.js', 'table-story.js', 'table-exploration.js', 'table-character-sheet.js',
  'table-campaigns.js', 'table-seats.js', 'table-playback.js', 'table-immersive.js', 'table-dock.js', 'table-screens.js'];

/**
 * @description The synthetic saved games as GET /campaigns returns them: newest played first; one battle the caller
 * hosts, one investigation they joined as a player, one finished adventure. Adventure and scene ids are the bundled
 * catalog's own, so the table view resolves each game's adventure and chapter.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} campaignSummaryDto rows.
 */
function campaigns(iso) {
  const row = (id, name, extra) => Object.assign({ campaign_id: id, name, adventure_id: 'goblin-ambush', status: 'active', join_code: JOIN_CODE,
    created_at: iso(-900), updated_at: extra.last_played_at, is_owner: false, my_character: null, mode: 'setup', scene_id: null, round: 0, rev: 1, player_count: 1 }, extra);
  return [
    row('c1', 'Synthetic Bells Beneath Blackwater', { adventure_id: 'bells-beneath-blackwater', is_owner: true, my_character: 'synthetic-aria', mode: 'combat', scene_id: 'blackwater-drowned-chapel', round: 3, rev: 41, player_count: 3, last_played_at: iso(-20) }),
    row('c2', 'Synthetic Goblin Ambush', { my_character: 'synthetic-bram', mode: 'exploration', scene_id: 'coast-road', rev: 12, player_count: 2, last_played_at: iso(-80) }),
    row('c3', 'Synthetic Road of the Last Lantern', { adventure_id: 'road-last-lantern', status: 'archived', is_owner: true, mode: 'complete', scene_id: 'lantern-answering-fires', round: 6, rev: 88, last_played_at: iso(-700) }),
  ];
}

/**
 * @description The bundled catalog exactly as GET /content serves it (routes/dnd-routes.js loadContent and
 * contentBundle): the heroes (the party, then the SRD roster), the default party, the SRD monsters, and the adventures
 * with the compatibility default. Real package content, not user data.
 * @returns {object} The content bundle.
 */
function contentBundle() {
  const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return null; } };
  const party = (readJson(path.join(DATA, 'party.json')) || {}).party || [];
  const roster = (readJson(path.join(DATA, 'srd-roster.json')) || {}).roster || [];
  const catalog = loadAdventureCatalog(DATA, readJson);
  return { heroes: party.concat(roster), defaultParty: party.map((hero) => hero.id), monsters: (readJson(path.join(DATA, 'srd-monsters.json')) || {}).monsters || {},
    adventure: catalog.adventure, adventures: catalog.adventures };
}

/**
 * @description The synthetic character library as GET /characters returns it: two saved heroes, newest first.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} characterDto rows.
 */
function characters(iso) {
  const sheet = (id, name, race, cls, level) => ({ id, name, race, class: cls, level, ac: 14, maxHp: 18, speed: 30, abilities: {}, actions: [], inventory: [] });
  return [
    { character_id: '00000000-0000-4000-8000-000000000001', slug: 'synthetic-aria', name: 'Synthetic Aria', sheet: sheet('synthetic-aria', 'Synthetic Aria', 'Elf', 'Wizard', 3), xp: 900, level: 3, created_at: iso(-600), updated_at: iso(-50) },
    { character_id: '00000000-0000-4000-8000-000000000002', slug: 'synthetic-bram', name: 'Synthetic Bram', sheet: sheet('synthetic-bram', 'Synthetic Bram', 'Dwarf', 'Fighter', 1), xp: 0, level: 1, created_at: iso(-500), updated_at: iso(-400) },
  ];
}

/**
 * @description One saved-game item exactly as routes/home-summary.js builds it: the name, 'status / saved <ISO>' as the
 * detail, and two offers whose notes are the detail plus the latest archive entry (whitespace collapsed by the route).
 * @param {string} name Campaign name.
 * @param {string} status Campaign status.
 * @param {string} saved ISO instant the campaign was saved.
 * @param {string} content The latest archive entry, or 'none' when the game has no story yet.
 * @returns {object} A home-summary item.
 */
function savedGame(name, status, saved, content) {
  const detail = status + ' / saved ' + saved;
  const notes = detail + ' Latest recorded story beat: ' + content + '. Prepare a session recap or discuss refreshments for the next session; no session date is implied.';
  return { text: name, detail, tone: 'neutral', fix: 'dnd-table', actions: ['prepare-document', 'plan-meal'].map((integration) => ({ integration, context: { title: name, notes } })) };
}

/** @param {(hours: number) => string} iso Timestamp helper from the harness. @returns {object} The review page entry. */
const reviewEntry = (iso) => ({
  app: 'dnd', file: 'dnd/tools/review.html', url: '/api/dnd/review', fullMarker: '#records .record',
  reads: {
    '/api/dnd/campaigns': { ok: true, campaigns: campaigns(iso) },
    '/api/dnd/characters': { ok: true, characters: characters(iso) },
    '/api/dnd/home-summary': {
      metrics: [{ id: 'campaigns-active', label: 'Active campaigns', value: '2' }, { id: 'campaigns-archived', label: 'Archived campaigns', value: '1' }],
      tiles: [{ id: 'campaigns-active', label: 'Active campaigns', value: '2' }, { id: 'campaigns-archived', label: 'Archived campaigns', value: '1' }],
      items: [
        savedGame('Synthetic Bells Beneath Blackwater', 'active', iso(-20), 'The bell tolls twice and the drowned choir rises from the reeds.'),
        savedGame('Synthetic Goblin Ambush', 'active', iso(-80), 'none'),
        savedGame('Synthetic Road of the Last Lantern', 'archived', iso(-700), 'The lantern is lit and the road home is safe'),
        { text: 'Shows campaigns the caller owns or currently belongs to using the same campaign member ACL as the game.', tone: 'neutral', fix: 'dnd-table' },
      ],
      asOf: iso(0), partial: false,
    },
  },
  audiences: {
    family: {
      stats: 4, sections: ['games', 'story', 'heroes'],
      text: ['Game night', '2 games in progress', 'Last played: Synthetic Bells Beneath Blackwater, 20 h ago. In a battle · round 3.', 'Open the game table',
        'Our games', 'Synthetic Bells Beneath Blackwater', 'In a battle · round 3 · 3 players', 'You host', 'played 20 h ago',
        'Synthetic Goblin Ambush', 'Following leads · 2 players', 'Playing synthetic-bram', 'played 3 days ago',
        'Synthetic Road of the Last Lantern', 'Adventure finished · 1 player',
        'Where the story left off', 'The bell tolls twice and the drowned choir rises from the reeds.', 'The lantern is lit and the road home is safe',
        'Saved heroes', 'Synthetic Aria', 'Level 3 Elf Wizard', 'saved 2 days ago', 'Synthetic Bram', 'Level 1 Dwarf Fighter'],
      statValues: { playing: '2', finished: '1', heroes: '2', last: '20 h ago' },
    },
  },
});

/**
 * @description The table entry: ui/table.html at its declared URL with the table's own stylesheet and classic bundle as
 * assets, the same synthetic library reads and the real bundled catalog. The full table boots from these reads onto its
 * My Games shelf (a campaign row per saved game), which is the marker that it started untouched.
 * @param {(hours: number) => string} iso Timestamp helper from the harness.
 * @returns {object} The table page entry.
 */
const tableEntry = (iso) => ({
  app: 'dnd', file: 'dnd/ui/table.html', url: '/api/dnd/table', fullMarker: '#overlayCard .campaign-row',
  assets: TABLE_ASSETS.map((file) => ({ url: '/api/dnd/' + file, file: 'dnd/ui/' + file })),
  reads: {
    '/api/dnd/campaigns': { ok: true, campaigns: campaigns(iso) },
    '/api/dnd/characters': { ok: true, characters: characters(iso) },
    '/api/dnd/content': contentBundle(),
  },
  audiences: {
    family: {
      stats: 4, sections: ['games', 'heroes', 'adventures'],
      text: ['Game table', '2 games to pick up',
        'Last played: Synthetic Bells Beneath Blackwater, 20 h ago. The Bells Beneath Blackwater, chapter 3 of 4: When the Lower Bell Rings · In a battle · round 3.',
        'Open the game table', 'Our games', 'Synthetic Bells Beneath Blackwater',
        'The Bells Beneath Blackwater, chapter 3 of 4: When the Lower Bell Rings · In a battle · round 3 · 3 players', 'You host', 'played 20 h ago',
        'Synthetic Goblin Ambush', 'Ambush on the Coast Road, chapter 1 of 2: Ambush on the Coast Road · Following leads · 2 players', 'Playing synthetic-bram', 'played 3 days ago',
        'Synthetic Road of the Last Lantern', 'The Road of the Last Lantern, chapter 4 of 4: The Answering Fires · Adventure finished · 1 player',
        'Saved heroes', 'Synthetic Aria', 'Level 3 Elf Wizard', 'saved 2 days ago', 'Synthetic Bram', 'Level 1 Dwarf Fighter',
        'Adventures on the shelf', 'The Bells Beneath Blackwater', 'Gaslight Harbor Horror', '3 investigations · 1 battle', 'Ambush on the Coast Road', '2 battles',
        'Open Dungeon Master in the cockpit'],
      statValues: { playing: '2', finished: '1', heroes: '2', adventures: '5' },
    },
  },
});

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object[]} The review page and the table, each with its family view. */
module.exports = ({ iso }) => [reviewEntry(iso), tableEntry(iso)];

// ADR-164 D6: the company audience paints the same account-scoped card; every page entry expects the same text, stats and sections under it.
const __secondAudience = module.exports;
module.exports = (helpers) => {
  const entries = __secondAudience(helpers), list = Array.isArray(entries) ? entries : [entries];
  for (const entry of list) if (entry.audiences && entry.audiences.family && !entry.audiences.company) entry.audiences.company = entry.audiences.family;
  return entries;
};
