/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-16 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Read a manifest's dependencies block into the shape marketplace.json mirrors, so the catalog's dependency block is generated from the package rather than hand-typed. Zero-dependency by design: the store's catalog gate runs on a bare checkout with no npm install, so this is a block reader for the exact YAML subset the dependencies block uses (tiered required/optional or the legacy flat form, flow lists and block sequences, comments and blank lines), not a YAML runtime. It fails closed on anything it cannot read so an unparsed block can never be reported as "no dependencies".
 * 2026-09-16 12:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Mirror the tiers AND the flat apps/tools/connectors keys the catalog has always carried, because the mirror is read by consumers that predate the tiers: the product-site generator builds every package page from `dependencies.connectors` and `dependencies.apps`, and a package suite asserts an empty `apps` array rather than an absent key. Emitting the tiers alone silently emptied both. Each flat key is the reduction the platform dependency contract already exposes for it - required apps, required tools, and the both-tier connector allow-list - so the compatibility view cannot claim something the contract would not.
 */

const TIERS = ['required', 'optional'];
const KINDS = ['apps', 'tools', 'connectors'];

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
  const problems = [];
  const { found, lines } = dependencyBlock(manifestText);
  if (!found) return { dependencies: null, problems };

  const declared = {};
  let group = null;
  let list = null;

  for (const entry of lines) {
    if (entry.raw.includes('\t')) {
      problems.push(`${label}:${entry.line} indents the dependencies block with a tab`);
      return { dependencies: null, problems };
    }
    if (entry.text.startsWith('- ')) {
      if (!list) {
        problems.push(`${label}:${entry.line} has a list item outside any apps/tools/connectors key`);
        return { dependencies: null, problems };
      }
      list.push(entry.text.slice(2).trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(entry.text);
    if (!match) {
      problems.push(`${label}:${entry.line} is not a key or a list item: ${JSON.stringify(entry.text)}`);
      return { dependencies: null, problems };
    }
    const [, key, rest] = match;
    const value = rest.replace(/\s+#.*$/, '').trim();
    if (TIERS.includes(key) && entry.indent === 2) {
      if (value !== '') {
        problems.push(`${label}:${entry.line} tier "${key}" must be a mapping of apps/tools/connectors`);
        return { dependencies: null, problems };
      }
      if (declared[key]) problems.push(`${label}:${entry.line} declares tier "${key}" twice`);
      group = {};
      declared[key] = group;
      list = null;
      continue;
    }
    if (!KINDS.includes(key)) {
      problems.push(`${label}:${entry.line} has unknown dependency key "${key}" (allowed: ${[...TIERS, ...KINDS].join(', ')})`);
      return { dependencies: null, problems };
    }
    const flatKind = entry.indent === 2 && group === null;
    if (!flatKind && entry.indent !== 4) {
      problems.push(`${label}:${entry.line} indents "${key}" by ${entry.indent}; expected 2 (flat form) or 4 (inside a tier)`);
      return { dependencies: null, problems };
    }
    const target = flatKind ? declared : group;
    if (flatKind && Object.keys(declared).some((name) => TIERS.includes(name))) {
      problems.push(`${label}:${entry.line} mixes the flat apps/tools/connectors form with required/optional`);
      return { dependencies: null, problems };
    }
    if (target[key]) problems.push(`${label}:${entry.line} declares "${key}" twice in the same group`);
    if (value === '') {
      list = [];
      target[key] = list;
      continue;
    }
    const parsed = flowList(value);
    if (parsed === null) {
      problems.push(`${label}:${entry.line} value for "${key}" is neither a flow list nor a block sequence: ${JSON.stringify(value)}`);
      return { dependencies: null, problems };
    }
    target[key] = parsed;
    list = null;
  }

  if (problems.length) return { dependencies: null, problems };
  return { dependencies: mirrorDependencies(declared), problems };
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
