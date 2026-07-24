/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:58:40 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract inventory and SRD action normalization from the character-import facade, including mode-specific custom-action validators below the function-size limit.
 */

'use strict';

const {
  ABILITIES,
  ABILITY_NAMES,
  COIN_KEYS,
  INVENTORY_CATEGORIES,
  LIMITS,
  abilityMod,
  asInteger,
  booleanValue,
  cleanString,
  fail,
  firstDefined,
  isRecord,
  normalizeDamage,
  requiredInteger,
  safeId,
} = require('./character-import-common');

// Only open-SRD/basic weapon profiles are generated from D&D Beyond inventory.
// Internal app sheets may additionally carry strictly validated custom actions.
const WEAPONS = Object.freeze({
  club: { name: 'Club', dice: '1d4', damageType: 'bludgeoning', ability: 'str', delivery: 'melee', reach: 5 },
  dagger: { name: 'Dagger', dice: '1d4', damageType: 'piercing', ability: 'finesse', delivery: 'melee', reach: 5, thrown: 20 },
  greatclub: { name: 'Greatclub', dice: '1d8', damageType: 'bludgeoning', ability: 'str', delivery: 'melee', reach: 5 },
  handaxe: { name: 'Handaxe', dice: '1d6', damageType: 'slashing', ability: 'str', delivery: 'melee', reach: 5, thrown: 20 },
  javelin: { name: 'Javelin', dice: '1d6', damageType: 'piercing', ability: 'str', delivery: 'ranged', range: 30 },
  'light-hammer': { name: 'Light Hammer', dice: '1d4', damageType: 'bludgeoning', ability: 'str', delivery: 'melee', reach: 5, thrown: 20 },
  mace: { name: 'Mace', dice: '1d6', damageType: 'bludgeoning', ability: 'str', delivery: 'melee', reach: 5 },
  quarterstaff: { name: 'Quarterstaff', dice: '1d6', damageType: 'bludgeoning', ability: 'str', delivery: 'melee', reach: 5 },
  sickle: { name: 'Sickle', dice: '1d4', damageType: 'slashing', ability: 'str', delivery: 'melee', reach: 5 },
  spear: { name: 'Spear', dice: '1d6', damageType: 'piercing', ability: 'str', delivery: 'melee', reach: 5, thrown: 20 },
  'light-crossbow': { name: 'Light Crossbow', dice: '1d8', damageType: 'piercing', ability: 'dex', delivery: 'ranged', range: 80 },
  dart: { name: 'Dart', dice: '1d4', damageType: 'piercing', ability: 'dex', delivery: 'ranged', range: 20 },
  shortbow: { name: 'Shortbow', dice: '1d6', damageType: 'piercing', ability: 'dex', delivery: 'ranged', range: 80 },
  sling: { name: 'Sling', dice: '1d4', damageType: 'bludgeoning', ability: 'dex', delivery: 'ranged', range: 30 },
  battleaxe: { name: 'Battleaxe', dice: '1d8', damageType: 'slashing', ability: 'str', delivery: 'melee', reach: 5 },
  flail: { name: 'Flail', dice: '1d8', damageType: 'bludgeoning', ability: 'str', delivery: 'melee', reach: 5 },
  glaive: { name: 'Glaive', dice: '1d10', damageType: 'slashing', ability: 'str', delivery: 'melee', reach: 10 },
  greataxe: { name: 'Greataxe', dice: '1d12', damageType: 'slashing', ability: 'str', delivery: 'melee', reach: 5 },
  greatsword: { name: 'Greatsword', dice: '2d6', damageType: 'slashing', ability: 'str', delivery: 'melee', reach: 5 },
  halberd: { name: 'Halberd', dice: '1d10', damageType: 'slashing', ability: 'str', delivery: 'melee', reach: 10 },
  lance: { name: 'Lance', dice: '1d12', damageType: 'piercing', ability: 'str', delivery: 'melee', reach: 10 },
  longsword: { name: 'Longsword', dice: '1d8', damageType: 'slashing', ability: 'str', delivery: 'melee', reach: 5 },
  maul: { name: 'Maul', dice: '2d6', damageType: 'bludgeoning', ability: 'str', delivery: 'melee', reach: 5 },
  morningstar: { name: 'Morningstar', dice: '1d8', damageType: 'piercing', ability: 'str', delivery: 'melee', reach: 5 },
  pike: { name: 'Pike', dice: '1d10', damageType: 'piercing', ability: 'str', delivery: 'melee', reach: 10 },
  rapier: { name: 'Rapier', dice: '1d8', damageType: 'piercing', ability: 'finesse', delivery: 'melee', reach: 5 },
  scimitar: { name: 'Scimitar', dice: '1d6', damageType: 'slashing', ability: 'finesse', delivery: 'melee', reach: 5 },
  shortsword: { name: 'Shortsword', dice: '1d6', damageType: 'piercing', ability: 'finesse', delivery: 'melee', reach: 5 },
  trident: { name: 'Trident', dice: '1d6', damageType: 'piercing', ability: 'str', delivery: 'melee', reach: 5, thrown: 20 },
  'war-pick': { name: 'War Pick', dice: '1d8', damageType: 'piercing', ability: 'str', delivery: 'melee', reach: 5 },
  warhammer: { name: 'Warhammer', dice: '1d8', damageType: 'bludgeoning', ability: 'str', delivery: 'melee', reach: 5 },
  whip: { name: 'Whip', dice: '1d4', damageType: 'slashing', ability: 'finesse', delivery: 'melee', reach: 10 },
  'hand-crossbow': { name: 'Hand Crossbow', dice: '1d6', damageType: 'piercing', ability: 'dex', delivery: 'ranged', range: 30 },
  'heavy-crossbow': { name: 'Heavy Crossbow', dice: '1d10', damageType: 'piercing', ability: 'dex', delivery: 'ranged', range: 100 },
  longbow: { name: 'Longbow', dice: '1d8', damageType: 'piercing', ability: 'dex', delivery: 'ranged', range: 150 },
});

const WEAPON_ALIASES = Object.freeze({
  'crossbow-light': 'light-crossbow', 'crossbow-light-weapon': 'light-crossbow',
  'light-crossbow': 'light-crossbow', 'short-bow': 'shortbow', 'long-bow': 'longbow',
  'short-sword': 'shortsword', 'war-pick': 'war-pick', warpick: 'war-pick',
  'light-hammer': 'light-hammer', 'hand-crossbow': 'hand-crossbow',
  'heavy-crossbow': 'heavy-crossbow',
});

/**
 * @description Match a provider weapon name to the supported SRD catalog.
 * @param {*} name - Candidate weapon name.
 * @returns {string|null} Canonical catalog key or null when unsupported.
 */
function weaponKey(name) {
  let key = safeId(String(name || '')
    .replace(/\([^)]{0,80}\)/g, ' ')
    .replace(/\s+\+\s*\d+\s*$/g, '')
    .replace(/\bplus\s+\d+\b/gi, ' '), '');
  if (WEAPONS[key]) return key;
  key = WEAPON_ALIASES[key] || key;
  if (WEAPONS[key]) return key;
  for (const candidate of Object.keys(WEAPONS).sort((left, right) => right.length - left.length)) {
    if (key === candidate || key.startsWith(candidate + '-')) return candidate;
  }
  return null;
}

/** @description Select the correct ability bonus for a catalog weapon. */
function abilityBonusForWeapon(definition, abilities) {
  const strength = abilityMod(abilities.str);
  const dexterity = abilityMod(abilities.dex);
  if (definition.ability === 'dex') return dexterity;
  if (definition.ability === 'finesse') return Math.max(strength, dexterity);
  return strength;
}

/** @description Reserve a collision-free bounded identifier in one import namespace. */
function uniqueId(base, used) {
  let id = safeId(base, 'item');
  if (!used.has(id)) { used.add(id); return id; }
  const stem = id.slice(0, LIMITS.ID - 3);
  for (let index = 2; index < 1000; index++) {
    const candidate = `${stem}-${index}`.slice(0, LIMITS.ID);
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
  fail('TOO_MANY_ENTRIES', 'Could not assign a unique import id.');
}

/** @description Build safe mechanics for one recognized basic SRD weapon. */
function basicWeaponAction(item, abilities, proficiency, requestedDelivery, used) {
  const key = weaponKey(item.name);
  if (!key) return null;
  const definition = WEAPONS[key];
  const abilityBonus = abilityBonusForWeapon(definition, abilities);
  let delivery = definition.delivery;
  if (requestedDelivery === 'ranged' && (definition.range || definition.thrown)) delivery = 'ranged';
  const action = {
    id: uniqueId(`weapon-${key}`, used || new Set()),
    name: definition.name,
    type: 'weapon',
    mode: 'attack',
    delivery,
    toHit: abilityBonus + proficiency,
    damage: { dice: definition.dice, bonus: abilityBonus, type: definition.damageType },
    text: 'Imported using the basic SRD weapon profile.',
  };
  if (delivery === 'ranged') action.range = definition.range || definition.thrown;
  else action.reach = definition.reach || 5;
  return action;
}

/**
 * @description Classify imported equipment without trusting provider category labels.
 * @param {string} name - Normalized item name.
 * @param {*} explicit - Provider category label.
 * @param {*} definition - Provider type description.
 * @returns {string} Supported inventory category.
 */
function classifyItem(name, explicit, definition) {
  const stated = cleanString(explicit || '', 40, 'inventory.category', false).toLowerCase();
  if (INVENTORY_CATEGORIES.has(stated)) return stated;
  if (['gear', 'consumable', 'other'].includes(stated)) return 'adventuring-gear';
  const type = cleanString(definition || '', 80, 'inventory.type', false);
  const haystack = `${name} ${stated} ${type}`.toLowerCase();
  if (weaponKey(name) || /\bweapon\b/.test(haystack)) return 'weapon';
  if (/\b(armor|armour|shield)\b/.test(haystack)) return 'armor';
  if (/\b(ammunition|arrows?|bolts?|bullets?)\b/.test(haystack)) return 'ammunition';
  if (/\b(focus|component pouch|holy symbol)\b/.test(haystack)) return 'focus';
  if (/\b(tools?|kits?|instruments?|supplies)\b/.test(haystack)) return 'tool';
  if (/\b(clothing|clothes|robe|costume|vestments?)\b/.test(haystack)) return 'clothing';
  return 'adventuring-gear';
}

/** @description Normalize the five supported coin denominations. */
function normalizeCoins(raw) {
  if (raw !== undefined && raw !== null && !isRecord(raw)) {
    fail('INVALID_INPUT', 'inventory.coins must be an object.', 'inventory.coins');
  }
  const source = isRecord(raw) ? raw : {};
  const normalized = {};
  for (const key of COIN_KEYS) {
    normalized[key] = asInteger(source[key], `inventory.coins.${key}`, 0, LIMITS.QUANTITY, 0);
  }
  return normalized;
}

/** @description Normalize one inventory row while keeping the collection loop small. */
function normalizeInventoryItem(entry, index, used) {
  const item = isRecord(entry) ? entry : { name: entry };
  const definition = isRecord(item.definition) ? item.definition : {};
  const name = cleanString(
    firstDefined(item.name, definition.name), LIMITS.ITEM_NAME, `inventory.items[${index}].name`, true,
  );
  const quantity = asInteger(
    firstDefined(item.quantity, item.count), `inventory.items[${index}].quantity`, 1, LIMITS.QUANTITY, 1,
  );
  const category = classifyItem(
    name,
    firstDefined(item.category, item.filterType, definition.filterType),
    firstDefined(item.type, definition.type, definition.subType),
  );
  const normalized = {
    id: uniqueId(`item-${firstDefined(item.id, definition.id, name)}`, used),
    name,
    category,
    quantity,
    equipped: booleanValue(firstDefined(item.equipped, item.isEquipped), false),
  };
  const description = cleanString(
    firstDefined(item.description, definition.description, item.snippet, definition.snippet),
    LIMITS.ITEM_DESCRIPTION, `inventory.items[${index}].description`, false,
  );
  if (description) normalized.description = description;
  const actionId = firstDefined(item.actionId, item.actionID);
  if (actionId !== undefined) normalized.actionId = safeId(actionId, name);
  return normalized;
}

/**
 * @description Normalize inventory rows and currency into the canonical sheet shape.
 * @param {*} raw - Provider or internal inventory payload.
 * @returns {object} Canonical items and five-denomination purse.
 */
function normalizeInventory(raw) {
  if (raw === undefined || raw === null) return { items: [], coins: normalizeCoins() };
  const legacyArray = Array.isArray(raw);
  if (!legacyArray && !isRecord(raw)) {
    fail('INVALID_INPUT', 'inventory must be an object with items and coins.', 'inventory');
  }
  const rows = legacyArray ? raw : (raw.items === undefined ? [] : raw.items);
  if (!Array.isArray(rows)) fail('INVALID_INPUT', 'inventory.items must be an array.', 'inventory.items');
  if (rows.length > LIMITS.INVENTORY_COUNT) {
    fail('TOO_MANY_ENTRIES', `inventory.items may contain at most ${LIMITS.INVENTORY_COUNT} entries.`, 'inventory.items');
  }
  const used = new Set();
  const items = rows.map((entry, index) => normalizeInventoryItem(entry, index, used));
  const coins = normalizeCoins(legacyArray ? undefined : firstDefined(raw.coins, raw.currency, raw.currencies));
  return { items, coins };
}

/** @description Validate the common identity and mode fields of a custom action. */
function customActionIdentity(raw, index, usedIds) {
  if (!isRecord(raw)) fail('INVALID_ACTION', `actions[${index}] must be an object.`, `actions[${index}]`);
  const field = `actions[${index}]`;
  const name = cleanString(raw.name, 80, `${field}.name`, true);
  const type = cleanString(raw.type || 'weapon', 16, `${field}.type`, true).toLowerCase();
  const mode = cleanString(raw.mode, 16, `${field}.mode`, true).toLowerCase();
  const delivery = cleanString(raw.delivery, 16, `${field}.delivery`, true).toLowerCase();
  if (!['weapon', 'spell', 'feature'].includes(type)) fail('INVALID_ACTION', `${field}.type is unsupported.`, `${field}.type`);
  if (!['attack', 'save', 'heal', 'autohit'].includes(mode)) fail('INVALID_ACTION', `${field}.mode is unsupported.`, `${field}.mode`);
  if (!['melee', 'ranged', 'self'].includes(delivery)) fail('INVALID_ACTION', `${field}.delivery is unsupported.`, `${field}.delivery`);
  return { field, name, type, mode, delivery, id: uniqueId(firstDefined(raw.id, name), usedIds) };
}

/** @description Copy optional text, uses, and loot markers onto an action. */
function copyActionMetadata(out, raw, field) {
  const text = cleanString(raw.text, 240, `${field}.text`, false);
  if (text) out.text = text;
  if (raw.uses !== undefined) out.uses = asInteger(raw.uses, `${field}.uses`, 1, 20);
  if (raw.looted === true) out.looted = true;
  return out;
}

/** @description Build a catalog-backed action while honoring safe display metadata. */
function knownWeaponAction(raw, identity, abilities, proficiency) {
  if (identity.type !== 'weapon' || identity.mode !== 'attack' || !weaponKey(identity.name)) return null;
  const generated = basicWeaponAction(
    { name: identity.name }, abilities, proficiency, identity.delivery, new Set(),
  );
  generated.id = identity.id;
  generated.name = identity.name;
  return copyActionMetadata(generated, raw, identity.field);
}

/** @description Apply validated attack-roll mechanics to an action. */
function applyAttackMode(out, raw, field) {
  out.toHit = requiredInteger(raw.toHit, `${field}.toHit`, -10, 20);
  out.damage = normalizeDamage(raw.damage, `${field}.damage`, true);
  if (out.damage.dice === '0d0' && out.damage.bonus < 1) {
    fail('INVALID_ACTION', `${field}.damage fixed attacks must deal at least 1 damage.`, `${field}.damage.bonus`);
  }
  if (!out.damage.type) fail('INVALID_ACTION', `${field}.damage.type is required.`, `${field}.damage.type`);
}

/** @description Apply validated saving-throw mechanics to an action. */
function applySaveMode(out, raw, field) {
  if (!isRecord(raw.save)) fail('INVALID_ACTION', `${field}.save is required.`, `${field}.save`);
  const rawAbility = cleanString(raw.save.ability, 16, `${field}.save.ability`, true).toLowerCase();
  const ability = ABILITIES.find((key) => rawAbility === key || rawAbility === ABILITY_NAMES[key]);
  if (!ability) fail('INVALID_ACTION', `${field}.save.ability is unsupported.`, `${field}.save.ability`);
  out.save = { ability, dc: requiredInteger(raw.save.dc, `${field}.save.dc`, 5, 30), half: !!raw.save.half };
  out.damage = normalizeDamage(raw.damage, `${field}.damage`, false);
  if (!out.damage.type) fail('INVALID_ACTION', `${field}.damage.type is required.`, `${field}.damage.type`);
}

/** @description Apply mechanics specific to the action's declared resolution mode. */
function applyActionMode(out, raw, field) {
  if (out.mode === 'attack') applyAttackMode(out, raw, field);
  else if (out.mode === 'save') applySaveMode(out, raw, field);
  else if (out.mode === 'heal') {
    out.heal = normalizeDamage(raw.heal, `${field}.heal`, true);
    delete out.heal.type;
  } else {
    out.damage = normalizeDamage(raw.damage, `${field}.damage`, false);
    if (!out.damage.type) fail('INVALID_ACTION', `${field}.damage.type is required.`, `${field}.damage.type`);
    out.darts = asInteger(raw.darts, `${field}.darts`, 1, 10, 1);
  }
}

/** @description Apply range, spell-slot, sneak, and area geometry constraints. */
function applyActionExtras(out, raw, field) {
  if (out.delivery === 'ranged') out.range = requiredInteger(raw.range, `${field}.range`, 5, 600);
  if (out.delivery === 'melee') out.reach = asInteger(raw.reach, `${field}.reach`, 5, 20, 5);
  if (raw.slot !== undefined) out.slot = asInteger(raw.slot, `${field}.slot`, 1, 9);
  if (raw.sneak !== undefined) out.sneak = normalizeDamage(raw.sneak, `${field}.sneak`, false);
  if (raw.aoeShape === undefined) return;
  if (raw.aoeShape !== 'cone') {
    fail('INVALID_ACTION', `${field}.aoeShape supports only cone.`, `${field}.aoeShape`);
  }
  out.aoeShape = 'cone';
  out.aoeSize = requiredInteger(raw.aoeSize, `${field}.aoeSize`, 5, 120);
}

/** @description Normalize one trusted-internal custom action into executable mechanics. */
function normalizeCustomAction(raw, index, abilities, proficiency, usedIds) {
  const identity = customActionIdentity(raw, index, usedIds);
  const catalogAction = knownWeaponAction(raw, identity, abilities, proficiency);
  if (catalogAction) return catalogAction;
  const out = copyActionMetadata({
    id: identity.id,
    name: identity.name,
    type: identity.type,
    mode: identity.mode,
    delivery: identity.delivery,
  }, raw, identity.field);
  applyActionMode(out, raw, identity.field);
  applyActionExtras(out, raw, identity.field);
  return out;
}

/**
 * @description Normalize a bounded action collection with collision-free identifiers.
 * @param {*} raw - Candidate action array.
 * @param {object} abilities - Canonical ability scores.
 * @param {number} proficiency - Character proficiency bonus.
 * @returns {Array<object>} Canonical executable actions.
 */
function normalizeActions(raw, abilities, proficiency) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail('INVALID_INPUT', 'actions must be an array.', 'actions');
  if (raw.length > LIMITS.ACTION_COUNT) {
    fail('TOO_MANY_ENTRIES', `actions may contain at most ${LIMITS.ACTION_COUNT} entries.`, 'actions');
  }
  const used = new Set();
  return raw.map((action, index) => normalizeCustomAction(action, index, abilities, proficiency, used));
}

/**
 * @description Derive inventory links for legacy internal sheets that provide only actions.
 * @param {Array<object>} actions - Canonical character actions.
 * @returns {object} Canonical inventory with linked weapon items.
 */
function deriveInventoryFromActions(actions) {
  const used = new Set();
  return {
    items: actions.filter((action) => action.type === 'weapon').map((action) => ({
      id: uniqueId(`item-${action.id}`, used),
      name: action.name,
      category: 'weapon',
      quantity: 1,
      equipped: true,
      actionId: action.id,
      ...(action.text ? { description: action.text } : {}),
    })),
    coins: normalizeCoins(),
  };
}

/** @description Link an unknown inventory item only when a matching custom action exists. */
function linkUnknownWeapon(item, actions) {
  const linked = actions.find((action) => action.type === 'weapon'
    && ((item.actionId && action.id === item.actionId)
      || action.name.toLowerCase() === item.name.toLowerCase()));
  if (linked) {
    item.category = 'weapon';
    item.actionId = linked.id;
    return;
  }
  delete item.actionId;
  if (item.category !== 'weapon') return;
  item.category = 'adventuring-gear';
  if (!item.description) {
    item.description = 'Imported equipment; no supported SRD weapon action was generated.';
  }
}

/**
 * @description Generate and link safe SRD actions for recognized carried weapons.
 * @param {Array<object>} actions - Existing canonical actions, mutated in place.
 * @param {object} inventory - Canonical inventory, mutated in place.
 * @param {object} abilities - Canonical ability scores.
 * @param {number} proficiency - Character proficiency bonus.
 * @returns {Array<object>} The augmented action collection.
 */
function attachWeaponActions(actions, inventory, abilities, proficiency) {
  const actionIds = new Set(actions.map((action) => action.id));
  const existingByWeapon = new Map();
  for (const action of actions) {
    const key = action.type === 'weapon' ? weaponKey(action.name) : null;
    if (key && !existingByWeapon.has(key)) existingByWeapon.set(key, action);
  }
  for (const item of inventory.items) {
    const key = weaponKey(item.name);
    if (!key) { linkUnknownWeapon(item, actions); continue; }
    item.category = 'weapon';
    let action = existingByWeapon.get(key);
    if (!action) {
      if (actions.length >= LIMITS.ACTION_COUNT) {
        fail('TOO_MANY_ENTRIES', `Generated actions exceed ${LIMITS.ACTION_COUNT}.`, 'actions');
      }
      action = basicWeaponAction(item, abilities, proficiency, undefined, actionIds);
      actions.push(action);
      existingByWeapon.set(key, action);
    }
    item.actionId = action.id;
  }
  return actions;
}

/** @description Determine whether at least one action can resolve offensive mechanics. */
function hasExecutableAttack(actions) {
  return actions.some((action) => {
    if (action.mode === 'attack') return !!(action.damage && action.damage.dice) && typeof action.toHit === 'number';
    if (action.mode === 'save') return !!(action.damage && action.damage.dice && action.save);
    if (action.mode === 'autohit') return !!(action.damage && action.damage.dice);
    return false;
  });
}

/**
 * @description Guarantee every imported character has at least one executable attack.
 * @param {Array<object>} actions - Canonical actions, mutated only when a fallback is required.
 * @param {object} abilities - Canonical ability scores.
 * @param {number} proficiency - Character proficiency bonus.
 * @returns {Array<object>} Actions containing an offensive option.
 */
function ensureExecutableAttack(actions, abilities, proficiency) {
  if (hasExecutableAttack(actions)) return actions;
  if (actions.length >= LIMITS.ACTION_COUNT) {
    fail('NO_USABLE_ATTACK', `An import with ${LIMITS.ACTION_COUNT} non-attack actions has no room for the safe fallback attack.`, 'actions');
  }
  const strength = abilityMod(abilities.str);
  actions.push({
    id: uniqueId('unarmed-strike', new Set(actions.map((action) => action.id))),
    name: 'Unarmed Strike',
    type: 'feature',
    mode: 'attack',
    delivery: 'melee',
    reach: 5,
    toHit: strength + proficiency,
    damage: { dice: '0d0', bonus: Math.max(1, 1 + strength), type: 'bludgeoning' },
    text: 'A basic SRD melee attack using Strength; no carried item required.',
  });
  return actions;
}

module.exports = {
  WEAPONS,
  attachWeaponActions,
  classifyItem,
  deriveInventoryFromActions,
  ensureExecutableAttack,
  normalizeActions,
  normalizeInventory,
  weaponKey,
};
