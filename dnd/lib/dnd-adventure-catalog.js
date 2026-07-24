/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Load and validate a deterministic multi-adventure catalog while retaining the original Coast Road campaign as the compatibility default.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ADVENTURE_ID = 'goblin-ambush';

/** @description Return authored adventure files in stable catalog order. */
function adventureFiles(dataDir) {
  return fs.readdirSync(dataDir)
    .filter((file) => /^adventure-[a-z0-9-]+\.json$/i.test(file))
    .sort((left, right) => {
      const first = left === 'adventure-goblin-ambush.json' ? -1 : 0;
      const second = right === 'adventure-goblin-ambush.json' ? -1 : 0;
      return first - second || left.localeCompare(right);
    });
}

/** @description Reject duplicate adventure and scene identities before serving content. */
function validateCatalog(adventures) {
  const adventureIds = new Set(), sceneIds = new Set();
  for (const adventure of adventures) {
    if (!adventure || !adventure.id || adventureIds.has(adventure.id)) {
      throw new Error(`Invalid or duplicate adventure id: ${adventure && adventure.id}`);
    }
    adventureIds.add(adventure.id);
    for (const scene of adventure.scenes || []) {
      if (!scene.id || sceneIds.has(scene.id)) throw new Error(`Invalid or duplicate scene id: ${scene.id}`);
      sceneIds.add(scene.id);
    }
  }
  return adventures;
}

/**
 * @description Load every packaged adventure as immutable runtime content.
 * @param {string} dataDir - Absolute package data directory.
 * @param {Function} readJson - Existing package JSON reader.
 * @returns {{adventures:object[],adventure:object}} Catalog and compatibility default.
 */
function loadAdventureCatalog(dataDir, readJson) {
  const adventures = validateCatalog(
    adventureFiles(dataDir).map((file) => readJson(path.join(dataDir, file))).filter(Boolean),
  );
  const adventure = adventures.find((entry) => entry.id === DEFAULT_ADVENTURE_ID)
    || adventures[0] || { id: DEFAULT_ADVENTURE_ID, scenes: [] };
  return { adventures, adventure };
}

/** @description Resolve one allowlisted adventure or the compatibility default. */
function resolveAdventure(catalog, id) {
  const adventures = catalog && Array.isArray(catalog.adventures) ? catalog.adventures : [];
  return adventures.find((entry) => entry.id === id) || (catalog && catalog.adventure) || adventures[0];
}

/** @description Resolve a globally unique scene across every packaged adventure. */
function resolveScene(catalog, id) {
  for (const adventure of catalog.adventures || []) {
    const scene = (adventure.scenes || []).find((entry) => entry.id === id);
    if (scene) return scene;
  }
  const fallback = resolveAdventure(catalog);
  return fallback && (fallback.scenes || [])[0];
}

module.exports = {
  DEFAULT_ADVENTURE_ID,
  loadAdventureCatalog,
  resolveAdventure,
  resolveScene,
};
