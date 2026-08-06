/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Provide collision-resistant, reversible user-store segments and fail-closed containment checks for controller and CLI paths.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Encode tenant-global corpus filenames so an adversarial subject cannot occupy or block shared SQLite state.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Reject unpaired UTF-16 surrogates before UTF-8 encoding so distinct raw subjects cannot collapse onto the replacement character.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Preserve exact direct-child raw stores as compatibility aliases while new unsafe identities use encoded paths.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Require exact on-disk legacy names and identity-mark encoded directories to defeat Windows aliases and reserved-prefix ambiguity.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Publish new encoded directories with their identity marker in one atomic rename and reserve tenant metadata names.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Require ownership signatures for legacy aliases and reject symlink or case-fold database entries.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Reject Windows device names case-insensitively and tolerate verified same-generation mkdir races.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Document unsafe legacy stores as in-place compatibility aliases rather than claiming their absolute paths are migrated.
 * 10 | maintainer@emeraldcoastsystemsgroup.com  | Reject terminal high surrogates and raw/canonical directory collisions before marker inspection.
 * 11 | maintainer@emeraldcoastsystemsgroup.com  | Add a side-effect-free resolver for kernel read/export surfaces so probing an absent user store never creates one.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ENCODED_PREFIX = '~sub-';
const IDENTITY_FILE = '.oshal-user-sub';
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const MAX_SEGMENT_BYTES = 240;
const LEGACY_SAFE = /^[a-z0-9](?:[a-z0-9._@-]{0,238}[a-z0-9_@-])?$/;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const TENANT_RESERVED = new Set([
  'corpus.db', 'corpus.db-journal', 'corpus.db-shm', 'corpus.db-wal',
  '.career-run-locks', '.last-evening-run',
]);

/** Reject only unpaired UTF-16 surrogates while preserving valid astral Unicode identities. */
function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xDC00 || next > 0xDFFF) return false;
      index += 1;
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) return false;
  }
  return true;
}

/** Encode UTF-8 bytes with a lowercase-only alphabet that cannot case-fold into a collision. */
function encodeBase32(buffer) {
  let accumulator = 0;
  let bits = 0;
  let encoded = '';
  for (const byte of buffer) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += BASE32[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) encoded += BASE32[(accumulator << (5 - bits)) & 31];
  return encoded;
}

/** Decode the canonical lowercase base32 payload; the public decoder rechecks canonical form. */
function decodeBase32(encoded) {
  let accumulator = 0;
  let bits = 0;
  const bytes = [];
  for (const character of encoded) {
    const value = BASE32.indexOf(character);
    if (value < 0) return null;
    accumulator = (accumulator << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Return true only for portable, case-stable legacy segments that can remain byte-for-byte. */
function isLegacySafe(userSub) {
  return LEGACY_SAFE.test(userSub)
    && !WINDOWS_RESERVED.test(userSub)
    && !TENANT_RESERVED.has(userSub.toLowerCase());
}

/**
 * @description Maps a raw OIDC subject to one portable filesystem segment. Existing lowercase
 * legacy-safe identifiers remain unchanged; every other identifier uses reversible lowercase
 * base32 so separators, Unicode, and case folding cannot traverse or collide after sanitization.
 * @param {string} userSub - Raw authenticated OIDC subject used for database/RLS identity.
 * @returns {string} A canonical, portable directory and filename segment.
 */
function userStoreSegment(userSub) {
  const raw = String(userSub || '');
  if (!raw) throw new Error('Career user identity is required');
  if (raw.includes('\0')) throw new Error('Career user identity contains a NUL byte');
  if (!isWellFormedUnicode(raw)) throw new Error('Career user identity contains invalid Unicode');
  if (isLegacySafe(raw)) return raw;
  const segment = `${ENCODED_PREFIX}${encodeBase32(Buffer.from(raw, 'utf8'))}`;
  if (Buffer.byteLength(segment, 'utf8') > MAX_SEGMENT_BYTES) {
    throw new Error('Career user identity is too long for a portable store path');
  }
  return segment;
}

/**
 * @description Reverses a canonical store directory name for cron fan-out while rejecting
 * malformed or noncanonical names instead of treating arbitrary directories as user identities.
 * @param {string} segment - Directory entry beneath the Career tenant store.
 * @returns {string|null} The raw OIDC subject, or null when the entry is not a canonical user.
 */
function userSubFromStoreSegment(segment) {
  const value = String(segment || '');
  if (isLegacySafe(value)) return value;
  if (!value.startsWith(ENCODED_PREFIX)) return null;
  const decoded = decodeBase32(value.slice(ENCODED_PREFIX.length));
  if (!decoded) return null;
  return userStoreSegment(decoded) === value ? decoded : null;
}

/**
 * @description Resolves a child path and rejects any result outside its intended root. This is
 * the final invariant after segment encoding and also protects tenant/configuration inputs.
 * @param {string} root - Absolute or relative directory that must contain the result.
 * @param {...string} segments - Child path segments to resolve beneath the root.
 * @returns {string} The absolute contained child path.
 */
function resolveContainedPath(root, ...segments) {
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, ...segments);
  const relative = path.relative(absoluteRoot, resolved);
  const escaped = !relative || relative === '..' || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
  if (escaped) throw new Error('Career user-store path escaped its configured root');
  return resolved;
}

/** Return a legacy raw subject only when it was one direct child on every supported platform. */
function directLegacyName(userSub) {
  const value = String(userSub || '');
  if (!value || value === '.' || value === '..' || /[\\/\0]/.test(value)) return null;
  if (value.startsWith(ENCODED_PREFIX) || /[ .]$/.test(value) || value.includes(':')) return null;
  if (TENANT_RESERVED.has(value.toLowerCase())) return null;
  if (WINDOWS_RESERVED.test(value) || (process.platform === 'win32' && /[<>"|?*]/.test(value))) return null;
  if (!isWellFormedUnicode(value) || Buffer.byteLength(value, 'utf8') > MAX_SEGMENT_BYTES) return null;
  return value;
}

/** Find an exact-case real entry without accepting a platform-normalized alias or symlink. */
function hasExactEntry(parent, name, kind) {
  try {
    return fs.readdirSync(parent, { withFileTypes: true }).some((entry) => (
      entry.name === name && (kind === 'directory' ? entry.isDirectory() : entry.isFile())
    ));
  } catch { return false; }
}

/** Detect a differently-cased sibling that would alias the requested name on Windows/macOS. */
function hasCaseAlias(parent, name) {
  try {
    const folded = name.toLowerCase();
    return fs.readdirSync(parent).some((entry) => entry !== name && entry.toLowerCase() === folded);
  } catch { return false; }
}

/** Require an existing database path to be one exact regular file, never a symlink or alias. */
function exactDatabaseExists(parent, name) {
  const candidate = resolveContainedPath(parent, name);
  const exact = hasExactEntry(parent, name, 'file');
  if (hasCaseAlias(parent, name) || (!exact && fs.existsSync(candidate))) {
    throw new Error('Career user database path is a symlink or case alias');
  }
  return exact;
}

/** Prove that an unsafe raw directory has the database/profile shape created by old releases. */
function hasLegacyStoreSignature(userDir, userSub) {
  return exactDatabaseExists(userDir, `user-${userSub}.db`)
    || hasExactEntry(userDir, 'career_db.json', 'file');
}

/** Resolve an exact legacy directory alias, rejecting split raw/canonical generations. */
function compatibleLegacyDirectory(tenantDir, userSub, canonicalDir) {
  const legacyName = directLegacyName(userSub);
  if (!legacyName || legacyName === path.basename(canonicalDir)) return null;
  const legacyDir = resolveContainedPath(tenantDir, legacyName);
  const hasLegacyDirectory = hasExactEntry(tenantDir, legacyName, 'directory');
  const canonicalName = path.basename(canonicalDir);
  const hasCanonical = hasExactEntry(tenantDir, canonicalName, 'directory');
  if (hasLegacyDirectory && hasCanonical) {
    throw new Error('Career user store has both legacy and canonical directories');
  }
  const hasLegacy = hasLegacyDirectory && hasLegacyStoreSignature(legacyDir, userSub);
  return hasLegacy ? legacyDir : null;
}

/** Verify the exact identity marker on an already-published encoded directory. */
function verifyIdentityMarker(canonicalDir, userSub) {
  const marker = resolveContainedPath(canonicalDir, IDENTITY_FILE);
  if (!hasExactEntry(canonicalDir, IDENTITY_FILE, 'file')) {
    throw new Error('Career encoded store is ambiguous without an identity marker');
  }
  if (fs.readFileSync(marker, 'utf8') !== userSub) {
    throw new Error('Career encoded store identity marker does not match');
  }
}

/** Stage directory and marker privately, then publish both in one atomic tenant-local rename. */
function publishEncodedDirectory(tenantDir, canonicalDir, userSub) {
  const staging = fs.mkdtempSync(resolveContainedPath(tenantDir, '.encoded-store-'));
  try {
    fs.writeFileSync(path.join(staging, IDENTITY_FILE), userSub, { flag: 'wx', mode: 0o600 });
    fs.renameSync(staging, canonicalDir);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!hasExactEntry(tenantDir, path.basename(canonicalDir), 'directory')) throw error;
  }
  verifyIdentityMarker(canonicalDir, userSub);
}

/** Create or verify a canonical directory without exposing an unmarked encoded generation. */
function ensureCanonicalDirectory(tenantDir, canonicalDir, userSub, segment) {
  const name = path.basename(canonicalDir);
  const exists = hasExactEntry(tenantDir, name, 'directory');
  if (!exists && fs.existsSync(canonicalDir)) throw new Error('Career user store path aliases another directory');
  if (segment !== userSub) {
    if (exists) verifyIdentityMarker(canonicalDir, userSub);
    else publishEncodedDirectory(tenantDir, canonicalDir, userSub);
    return canonicalDir;
  }
  if (!exists) {
    try { fs.mkdirSync(canonicalDir, { recursive: false }); } catch (error) {
      if (!error || error.code !== 'EEXIST'
          || !hasExactEntry(tenantDir, name, 'directory')) throw error;
    }
  }
  return canonicalDir;
}

/** Select an unmoved legacy database basename only when exactly one database generation exists. */
function compatibleUserDatabase(userDir, userSub, segment) {
  const canonical = resolveContainedPath(userDir, `user-${segment}.db`);
  const canonicalExists = exactDatabaseExists(userDir, path.basename(canonical));
  const legacyName = directLegacyName(userSub);
  if (!legacyName || legacyName === segment) return canonical;
  const legacy = resolveContainedPath(userDir, `user-${legacyName}.db`);
  const legacyExists = exactDatabaseExists(userDir, path.basename(legacy));
  if (canonicalExists && legacyExists) {
    throw new Error('Career user store has both legacy and canonical databases');
  }
  return legacyExists ? legacy : canonical;
}

/**
 * @description Resolve the shared controller/CLI layout, retaining a signed unsafe legacy store
 * in place as a compatibility alias so persisted absolute artifact paths remain valid.
 * @param {string} storeRoot - Configured Career data root.
 * @param {string} tenant - Contained tenant segment.
 * @param {string} userSub - Raw authenticated OIDC subject.
 * @returns {{tenantDir:string,userDir:string,userDb:string,userSegment:string}} Contained layout.
 */
function resolveUserStoreLayout(storeRoot, tenant, userSub) {
  const tenantDir = resolveContainedPath(storeRoot, tenant);
  fs.mkdirSync(tenantDir, { recursive: true });
  const userSegment = userStoreSegment(userSub);
  const canonicalDir = resolveContainedPath(tenantDir, userSegment);
  const legacyDir = compatibleLegacyDirectory(tenantDir, userSub, canonicalDir);
  const userDir = legacyDir || ensureCanonicalDirectory(
    tenantDir, canonicalDir, userSub, userSegment,
  );
  return {
    tenantDir, userDir, userSegment,
    userDb: compatibleUserDatabase(userDir, userSub, userSegment),
  };
}

/**
 * @description Find an existing exact user-store layout without creating a tenant, directory,
 * marker, or database. Ambiguous aliases still throw rather than choosing one generation.
 * @param {string} storeRoot - Configured Career data root.
 * @param {string} tenant - Contained tenant segment.
 * @param {string} userSub - Raw authenticated OIDC subject.
 * @returns {{tenantDir:string,userDir:string,userDb:string,userSegment:string}|null} Existing layout.
 */
function findUserStoreLayout(storeRoot, tenant, userSub) {
  const tenantDir = resolveContainedPath(storeRoot, tenant);
  if (!hasExactEntry(storeRoot, path.basename(tenantDir), 'directory')) return null;
  const userSegment = userStoreSegment(userSub);
  const canonicalDir = resolveContainedPath(tenantDir, userSegment);
  const legacyDir = compatibleLegacyDirectory(tenantDir, userSub, canonicalDir);
  if (legacyDir) {
    return { tenantDir, userDir: legacyDir, userSegment,
      userDb: compatibleUserDatabase(legacyDir, userSub, userSegment) };
  }
  const canonicalName = path.basename(canonicalDir);
  if (!hasExactEntry(tenantDir, canonicalName, 'directory')) {
    if (fs.existsSync(canonicalDir)) throw new Error('Career user store path aliases another directory');
    return null;
  }
  if (userSegment !== userSub) verifyIdentityMarker(canonicalDir, userSub);
  return { tenantDir, userDir: canonicalDir, userSegment,
    userDb: compatibleUserDatabase(canonicalDir, userSub, userSegment) };
}

/** Identify an in-place direct-child compatibility store only when its old ownership signature exists. */
function legacyUserSubFromStoreEntry(tenantDir, entryName) {
  const userSub = directLegacyName(entryName);
  if (!userSub || userSub.startsWith('.') || userSub.startsWith('_')) return null;
  if (userSubFromStoreSegment(userSub)) return null;
  const userDir = resolveContainedPath(tenantDir, userSub);
  if (!hasExactEntry(tenantDir, userSub, 'directory')) return null;
  return hasLegacyStoreSignature(userDir, userSub) ? userSub : null;
}

module.exports = {
  findUserStoreLayout,
  legacyUserSubFromStoreEntry,
  resolveContainedPath,
  resolveUserStoreLayout,
  userStoreSegment,
  userSubFromStoreSegment,
};
