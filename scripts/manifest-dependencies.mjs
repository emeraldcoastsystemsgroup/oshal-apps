/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Read a manifest's dependencies block into the shape marketplace.json mirrors, so the catalog's dependency block is generated from the package rather than hand-typed. Zero-dependency by design: the store's catalog gate runs on a bare checkout with no npm install, so this is a block reader for the exact YAML subset the dependencies block uses (tiered required/optional or the legacy flat form, flow lists and block sequences, comments and blank lines), not a YAML runtime. It fails closed on anything it cannot read so an unparsed block can never be reported as "no dependencies".
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Mirror the tiers AND the flat apps/tools/connectors keys the catalog has always carried, because the mirror is read by consumers that predate the tiers: the product-site generator builds every package page from `dependencies.connectors` and `dependencies.apps`, and a package suite asserts an empty `apps` array rather than an absent key. Emitting the tiers alone silently emptied both. Each flat key is the reduction the platform dependency contract already exposes for it - required apps, required tools, and the both-tier connector allow-list - so the compatibility view cannot claim something the contract would not.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Read strict app/name bot imports in both tiers, retaining owner bindings and rejecting malformed nesting or undeclared owners before catalog generation.
 */

const TIERS = ['required', 'optional'];
const KINDS = ['apps', 'tools', 'connectors', 'bots'];

/**
 * @description Split the `dependencies:` block out of a manifest, dropping comments and blanks.
 * @param {string} manifestText The raw oshal-app.yaml text.
 * @returns {{ found: boolean, lines: Array<{ indent: number, text: string, line: number }> }}
 *  `found` distinguishes "no dependencies block" from "an empty one" — the caller must never
 *  confuse a block it could not find with a block that declares nothing.
 */
function dependencyBlock(manifestText) {
  const all = manifestText.split(/\r?\n/);
  const start = all.findIndex((line) => /^dependencies:[ \t]*(?:#.*)?$/.test(line));
  if (start === -1) return { found: false, lines: [] };
  const lines = [];
  for (let index = start + 1; index < all.length; index += 1) {
    const raw = all[index].replace(/\s+$/, '');
    if (raw === '') continue;
    if (!/^[ \t]/.test(raw)) break;
    if (/^\s*#/.test(raw)) continue;
    lines.push({ indent: raw.match(/^[ \t]*/)[0].length, text: raw.trim(), line: index + 1, raw });
  }
  return { found: true, lines };
}

/** Parse `[a, b]` / `[]`; returns null when the text is not a flow sequence. */
function flowList(value) {
  if (!/^\[.*\]$/.test(value)) return null;
  const inner = value.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((entry) => entry.trim().replace(/^["']|["']$/g, '')).filter((entry) => entry !== '');
}

/**
 * @description Read one manifest's dependency declaration into the object marketplace.json mirrors.
 * @param {string} manifestText The raw oshal-app.yaml text.
 * @param {string} label How to name this manifest in a problem message.
 * @returns {{ dependencies: object|null, problems: string[] }} `dependencies` is null when the
 *  manifest declares no block at all; otherwise it is the mirror mirrorDependencies() shapes - the
 *  declared tiers plus the flat compatibility keys - and a kind no tier declares stays absent,
 *  because an absent `connectors` key means "unfiltered" and is not the same as `[]`.
 */
export function readManifestDependencies(manifestText, label = 'oshal-app.yaml') {
  const { found, lines } = dependencyBlock(manifestText);
  if (!found) return { dependencies: null, problems: [] };
  const state = { declared: {}, group: null, list: null, bot: null };
  try {
    for (const entry of lines) readEntry(state, entry, label);
    validateBotOwners(state.declared);
    return { dependencies: mirrorDependencies(state.declared), problems: [] };
  } catch (error) {
    // Expected declaration errors are returned to the catalog gate, never dropped as empty input.
    return { dependencies: null, problems: [`${label}: ${error.message}`] };
  }
}

/** Read the bounded YAML subset; an unexpected indentation never becomes a different binding. */
function readEntry(state, entry, label) {
  const at = `${label}:${entry.line}`;
  if (entry.raw.includes('\t')) throw new Error(`${at} indents the dependencies block with a tab`);
  const text = entry.text.replace(/\s+#.*$/, '').trim();
  if (text.startsWith('- ')) return readItem(state, text.slice(2), entry.indent, at);
  if (state.bot && entry.indent === state.list.indent + 4) {
    return botProperty(state.bot, text, at);
  }
  state.bot = null;
  const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(text);
  if (!match) throw new Error(`${at} is not a key or a list item: ${JSON.stringify(text)}`);
  const [, key, value] = match;
  if (TIERS.includes(key) && entry.indent === 2) {
    if (value !== '') throw new Error(`${at} tier "${key}" must be a mapping`);
    if (state.declared[key]) throw new Error(`${at} declares tier "${key}" twice`);
    if (KINDS.some((kind) => Object.hasOwn(state.declared, kind))) throw new Error(`${at} mixes the flat form with required/optional`);
    state.group = state.declared[key] = {};
    state.list = null;
    return;
  }
  readKind(state, key, value, entry.indent, at);
}

/** Each list is attached to exactly one dependency kind and tier. */
function readKind(state, key, value, indent, at) {
  if (!KINDS.includes(key)) throw new Error(`${at} has unknown dependency key "${key}"`);
  const expected = state.group ? 4 : 2;
  if (indent !== expected) throw new Error(`${at} indents "${key}" by ${indent}; expected ${expected}`);
  const target = state.group ?? state.declared;
  if (Object.hasOwn(target, key)) throw new Error(`${at} declares "${key}" twice in the same group`);
  if (value === '') {
    target[key] = [];
    state.list = { kind: key, values: target[key], indent };
    return;
  }
  const parsed = key === 'bots' ? botFlowList(value, at) : flowList(value);
  if (parsed === null) throw new Error(`${at} value for "${key}" is neither a flow list nor a block sequence: ${JSON.stringify(value)}`);
  target[key] = parsed;
  state.list = null;
}

/** A bot list permits a flow object or a two-field block object, never a bare global alias. */
function readItem(state, text, indent, at) {
  const list = state.list;
  if (!list || indent !== list.indent + 2) throw new Error(`${at} has a list item outside its dependency key`);
  state.bot = null;
  if (list.kind !== 'bots') {
    list.values.push(text.trim().replace(/^["']|["']$/g, ''));
    return;
  }
  const bot = {};
  if (text.startsWith('{')) readBotObject(text, bot, at);
  else { botProperty(bot, text, at); state.bot = bot; }
  list.values.push(bot);
}

/** Parse only a sequence of explicit flow mappings, keeping duplicate fields observable. */
function botFlowList(value, at) {
  if (!/^\[.*\]$/.test(value)) return null;
  let rest = value.slice(1, -1).trim();
  const bots = [];
  while (rest) {
    const match = /^\{[^{}]*\}/.exec(rest);
    if (!match) throw new Error(`${at} bots must contain app/name mappings`);
    const bot = {};
    readBotObject(match[0], bot, at);
    bots.push(bot);
    rest = rest.slice(match[0].length).trim();
    if (!rest) break;
    if (!rest.startsWith(',')) throw new Error(`${at} bot mappings need a comma`);
    rest = rest.slice(1).trim();
    if (!rest) throw new Error(`${at} has an empty bot binding`);
  }
  return bots;
}

function readBotObject(text, bot, at) {
  if (!/^\{[^{}]*\}$/.test(text)) throw new Error(`${at} has an invalid bot mapping`);
  for (const field of text.slice(1, -1).split(',')) botProperty(bot, field.trim(), at);
}

/** Keep owner and name as data; extra fields cannot supply a role or provider override. */
function botProperty(bot, text, at) {
  const match = /^(app|name):\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s'"{},]+))$/.exec(text);
  if (!match) throw new Error(`${at} bot binding must name only app and name`);
  const key = match[1];
  if (Object.hasOwn(bot, key)) throw new Error(`${at} repeats bot field "${key}"`);
  bot[key] = match[2] ?? match[3] ?? match[4];
}

/** Owner edges must already be declared; bot references never invent application grants. */
function validateBotOwners(declared) {
  const tiered = TIERS.some((tier) => Object.hasOwn(declared, tier));
  const required = tiered ? declared.required ?? {} : declared;
  const optional = tiered ? declared.optional ?? {} : {};
  const requiredBots = validateBotTier(required.bots ?? [], required.apps ?? [], 'required');
  const optionalBots = validateBotTier(optional.bots ?? [], [...(required.apps ?? []), ...(optional.apps ?? [])], 'optional');
  for (const key of requiredBots) {
    if (optionalBots.has(key)) throw new Error(`bot ${key} is both required and optional`);
  }
}

function validateBotTier(bots, owners, tier) {
  const seen = new Set();
  for (const bot of bots) {
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(bot.app ?? '') || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(bot.name ?? '')) {
      throw new Error(`${tier} bot binding has an invalid or missing app/name`);
    }
    const key = `${bot.app}/${bot.name}`;
    if (seen.has(key)) throw new Error(`${tier} bots repeats ${key}`);
    if (!owners.includes(bot.app)) throw new Error(`${tier} bot ${key} needs its owning app declared in ${tier === 'required' ? 'required.apps' : 'an app tier'}`);
    seen.add(key);
  }
  return seen;
}

/**
 * @description Shape a declared block into the object marketplace.json carries: the tiers exactly as
 * the manifest declares them, plus the flat `apps`/`tools`/`connectors` keys the catalog entry has
 * carried since before the tiers existed and consumers still read. Each flat key is the reduction
 * the platform's dependency contract already exposes for it, so the compatibility view can never
 * claim something the contract would not - `apps` and `tools` are the REQUIRED tier (the legacy flat
 * form reads as all-required, and required apps are the set install refuses to orphan), while
 * `connectors` is the connector allow-list: both tiers concatenated in tier order, because an
 * optional connector is still an account the app's surfaces offer you. A kind no tier declares stays
 * ABSENT: absent means unfiltered, which is not the same as `[]`.
 * @param {object|null} declared The block as the manifest declares it, or null when there is none.
 * @returns {object|null} The mirrored block, or null.
 */
export function mirrorDependencies(declared) {
  if (declared === null || declared === undefined) return null;
  const declaredTiers = TIERS.filter((tier) => declared[tier]);
  // The legacy flat form IS the required tier, so both forms reduce through one path.
  const tiers = declaredTiers.length ? declaredTiers.map((tier) => declared[tier]) : [declared];
  const required = declaredTiers.length ? (declared.required ?? {}) : declared;
  const mirror = {};
  for (const kind of KINDS) {
    if (!tiers.some((tier) => Array.isArray(tier[kind]))) continue;
    mirror[kind] = kind === 'connectors'
      ? tiers.flatMap((tier) => tier[kind] ?? [])
      : [...(required[kind] ?? [])];
  }
  for (const key of Object.keys(declared)) if (TIERS.includes(key)) mirror[key] = declared[key];
  return mirror;
}

/**
 * @description Deep structural comparison for the mirrored dependency block.
 * @param {*} left One value.
 * @param {*} right The other.
 * @returns {boolean} True when the two carry the same keys and list entries in the same order.
 */
export function sameDependencies(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
