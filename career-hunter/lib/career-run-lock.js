/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Add atomic cross-process Career engine leases with canonical resource keys, bounded stale recovery, heartbeats, and token-validated parent-to-child adoption.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Keep heartbeat and cleanup diagnostics from interrupting remaining token-safe resource release.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Heartbeat adopted leases in the CLI child so a surviving detached worker cannot be overlapped after its API parent exits.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Carry the parent's clamped lease timing in each adoption proof so a detached child preserves the same expiry safety margin.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Carry the parent's absolute engine deadline so an orphaned adopted wrapper cannot heartbeat a hung run forever.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Fence a running owner when any heartbeat resource disappears, changes generation, or cannot be refreshed.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Serialize generation transitions with token-scoped markers so stale reaping and release cannot rename a successor.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Enforce the engine concurrency ceiling with shared filesystem capacity slots across API replicas and direct CLI runs.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Add an isolated upload-body capacity namespace so multipart admission is globally bounded without consuming engine slots.
 * 10 | maintainer@emeraldcoastsystemsgroup.com  | Recover crash-abandoned transition markers and honor the recorded owner's TTL during stale-generation decisions.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveContainedPath, userStoreSegment } = require('./user-store-path');

const LOCK_DIRECTORY = '.career-run-locks';
const OWNER_FILE = 'owner.json';
const TRANSITION_PREFIX = '.lease-transition-';
const TRANSITION_STALE_MS = 30_000;
const ADOPTION_VERSION = 3;
const DEFAULT_TTL_MS = 60_000;
const MIN_CONFIGURED_TTL_MS = 10_000;
const MAX_TTL_MS = 30 * 60_000;
const DEFAULT_RUN_DEADLINE_MS = 2 * 60 * 60_000;
const MAX_RUN_DEADLINE_MS = 24 * 60 * 60_000;
const MAX_CAPACITY_SLOTS = 64;
const SHARED_CORPUS_WRITERS = new Set([
  'pull', 'score', 'score-titles', 'seturl', 'discover', 'enrich',
]);
/** @description Private environment key carrying an exact opaque parent lock adoption proof. */
const RUN_LOCK_ADOPTION_ENV = 'OSHAL_CAREER_RUN_LOCK_ADOPTION';

/** Clamp a duration while allowing deliberately short dependency-free test leases. */
function leaseDuration(options) {
  if (Number.isFinite(options.ttlMs)) return Math.max(50, Math.min(MAX_TTL_MS, options.ttlMs));
  const configured = Number(process.env.CAREER_HUNTER_LOCK_TTL_MS);
  if (!Number.isFinite(configured)) return DEFAULT_TTL_MS;
  return Math.max(MIN_CONFIGURED_TTL_MS, Math.min(MAX_TTL_MS, configured));
}

/** Derive a heartbeat cadence that leaves at least two missed beats before expiry. */
function heartbeatDuration(ttlMs, options) {
  if (Number.isFinite(options.heartbeatMs)) {
    return Math.max(20, Math.min(Math.floor(ttlMs / 2), options.heartbeatMs));
  }
  return Math.max(1_000, Math.min(10_000, Math.floor(ttlMs / 3)));
}

/** Normalize resources so every process acquires multiple locks in one stable order. */
function normalizeResources(resources) {
  return [...new Set(resources.map((resource) => String(resource)).filter(Boolean))].sort();
}

/** Resolve the hidden lock directory beneath the same contained tenant store as its data. */
function runLockRoot(storeRoot, tenant) {
  const tenantRoot = resolveContainedPath(storeRoot, tenant);
  return resolveContainedPath(tenantRoot, LOCK_DIRECTORY);
}

/** Hash a structured resource identity into a fixed, portable lock directory name. */
function lockDirectory(root, resource) {
  const digest = crypto.createHash('sha256').update(resource).digest('hex');
  return path.join(root, digest);
}

/** Read ownership metadata without converting a transient/malformed file into ownership. */
function readOwner(directory) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(directory, OWNER_FILE), 'utf8'));
    return owner && /^[a-f0-9]{48}$/.test(owner.token) ? owner : null;
  } catch {
    return null;
  }
}

/** Return the fixed marker that grants one transition exclusive control of a generation. */
function transitionFile(directory, token) {
  return path.join(directory, `${TRANSITION_PREFIX}${token}`);
}

/** Remove only a transition marker old enough that its synchronous owner cannot still be active. */
function removeAbandonedTransition(marker) {
  try {
    if (Date.now() - fs.statSync(marker).mtimeMs <= TRANSITION_STALE_MS) return false;
    fs.rmSync(marker);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'ENOENT');
  }
}

/** Create one token-scoped transition marker, recovering one crash-abandoned predecessor. */
function beginTransition(directory, token, purpose) {
  const marker = transitionFile(directory, token);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(marker, purpose, { flag: 'wx', mode: 0o600 });
      return marker;
    } catch (error) {
      if (!error || error.code === 'ENOENT') return null;
      if (error.code !== 'EEXIST') throw error;
      if (!removeAbandonedTransition(marker)) return null;
    }
  }
  return null;
}

/** Resolve persisted owner timing, conservatively covering legacy metadata without a duration. */
function ownerLeaseDuration(owner, requesterTtlMs) {
  if (Number.isInteger(owner?.ttlMs) && owner.ttlMs >= 50 && owner.ttlMs <= MAX_TTL_MS) {
    return owner.ttlMs;
  }
  return owner ? Math.max(DEFAULT_TTL_MS, requesterTtlMs) : requesterTtlMs;
}

/** Read the heartbeat and owner-selected expiry used for every stale-generation decision. */
function generationSnapshot(directory, requesterTtlMs) {
  const owner = readOwner(directory);
  const heartbeatPath = owner ? path.join(directory, OWNER_FILE) : directory;
  try {
    return {
      token: owner?.token || 'unowned',
      mtimeMs: fs.statSync(heartbeatPath).mtimeMs,
      ttlMs: ownerLeaseDuration(owner, requesterTtlMs),
    };
  }
  catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Confirm a marked generation, owner duration, and heartbeat are unchanged and still expired. */
function staleGenerationMatches(directory, snapshot) {
  const current = generationSnapshot(directory, snapshot.ttlMs);
  if (!current || current.token !== snapshot.token) return false;
  if (current.ttlMs !== snapshot.ttlMs) return false;
  if (snapshot.token !== 'unowned' && current.mtimeMs !== snapshot.mtimeMs) return false;
  return Date.now() - snapshot.mtimeMs > snapshot.ttlMs;
}

/** Move and remove one expired marked generation without racing another transition or successor. */
function reapStaleDirectory(directory, ttlMs) {
  const snapshot = generationSnapshot(directory, ttlMs);
  if (!snapshot) return true;
  if (Date.now() - snapshot.mtimeMs <= snapshot.ttlMs) return false;
  const marker = beginTransition(directory, snapshot.token, 'stale-reap');
  if (!marker) return false;
  const quarantine = `${directory}.stale-${crypto.randomBytes(8).toString('hex')}`;
  let moved = false;
  try {
    if (!staleGenerationMatches(directory, snapshot)) return false;
    fs.renameSync(directory, quarantine);
    moved = true;
  } catch (error) {
    if (!error || !['ENOENT', 'EEXIST'].includes(error.code)) return false;
  } finally {
    if (!moved) fs.rmSync(marker, { force: true });
  }
  if (moved) fs.rmSync(quarantine, { recursive: true, force: true });
  return moved;
}

/** Create one directory atomically, retrying once after bounded stale-owner recovery. */
function acquireEntry(root, resource, token, ttlMs) {
  const directory = lockDirectory(root, resource);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { fs.mkdirSync(directory); } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      if (!reapStaleDirectory(directory, ttlMs)) return null;
      continue;
    }
    try {
      const owner = {
        version: ADOPTION_VERSION, token, pid: process.pid, ttlMs, acquiredAt: Date.now(),
      };
      fs.writeFileSync(path.join(directory, OWNER_FILE), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
      if (fs.existsSync(transitionFile(directory, 'unowned'))) return null;
      return { directory, resource };
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }
  return null;
}

/** Report a heartbeat failure through the caller without letting a timer crash the process. */
function reportLeaseError(lease, error) {
  lease.lastHeartbeatError = error;
  if (typeof lease.onError !== 'function') return;
  try { lease.onError(error); } catch { /* retain the original lease failure */ }
}

/** Mark a lease irrecoverably lost once and ask its process owner to self-fence. */
function loseLease(lease, error) {
  if (lease.lost) return;
  lease.lost = true;
  if (lease.timer) clearInterval(lease.timer);
  reportLeaseError(lease, error);
  if (typeof lease.onLost !== 'function') return;
  try { lease.onLost(error); } catch { /* the lost lease remains fenced */ }
}

/** Refresh every owned directory or fence the writer when any generation is no longer held. */
function heartbeatLease(lease) {
  const now = new Date();
  for (const entry of lease.entries) {
    try {
      const marker = transitionFile(entry.directory, lease.token);
      if (fs.existsSync(marker) || readOwner(entry.directory)?.token !== lease.token) {
        loseLease(lease, Object.assign(new Error('Career run lease ownership was lost'), {
          code: 'CAREER_LEASE_LOST', resource: entry.resource,
        }));
        return;
      }
      fs.utimesSync(path.join(entry.directory, OWNER_FILE), now, now);
      if (fs.existsSync(marker) || readOwner(entry.directory)?.token !== lease.token) {
        throw Object.assign(new Error('Career run lease transition started during heartbeat'), {
          code: 'CAREER_LEASE_LOST', resource: entry.resource,
        });
      }
    } catch (error) {
      loseLease(lease, error);
      return;
    }
  }
}

/** Attach an unref'ed heartbeat timer to an owned lease. */
function startHeartbeat(lease, heartbeatMs) {
  lease.timer = setInterval(() => heartbeatLease(lease), heartbeatMs);
  lease.timer.unref?.();
  return lease;
}

/** Remove an entry only after its token proves the caller still owns that generation. */
function releaseEntry(entry, token) {
  const marker = beginTransition(entry.directory, token, 'release');
  if (!marker) return;
  const quarantine = `${entry.directory}.release-${crypto.randomBytes(8).toString('hex')}`;
  let moved = false;
  try {
    if (readOwner(entry.directory)?.token !== token) return;
    fs.renameSync(entry.directory, quarantine);
    moved = true;
  } catch { return; }
  finally { if (!moved) fs.rmSync(marker, { force: true }); }
  fs.rmSync(quarantine, { recursive: true, force: true });
}

/** Best-effort release a resource set while reporting cleanup failures to its caller. */
function releaseEntries(entries, token, onError) {
  for (const entry of [...entries].reverse()) {
    try { releaseEntry(entry, token); } catch (error) {
      if (typeof onError === 'function') {
        try { onError(error); } catch { /* preserve cleanup progress */ }
      }
    }
  }
}

/** Build the structured user or tenant-global resource identity shared by API and CLI paths. */
function resourceKey(scope, owner, slot) {
  return JSON.stringify([scope, owner, slot]);
}

/** Return true only for engine capacity resources that an engine child proof may inherit. */
function isCapacityResource(resource) {
  try {
    const parsed = JSON.parse(resource);
    return Array.isArray(parsed) && parsed.length === 3 && parsed[0] === 'capacity'
      && parsed[1] === '' && /^\d+$/.test(parsed[2]);
  } catch { return false; }
}

/** Resolve one closed capacity namespace without accepting caller-chosen resource scopes. */
function capacityScope(options) {
  const group = options.capacityGroup || 'engine';
  if (group === 'engine') return 'capacity';
  if (group === 'upload-body') return 'upload-capacity';
  throw new Error('Career capacity group is invalid');
}

/** Clamp an opt-in shared capacity ceiling and leave non-engine leases uncapped. */
function capacitySlotCount(options) {
  if (!Number.isFinite(options.capacitySlots)) return 0;
  return Math.max(1, Math.min(MAX_CAPACITY_SLOTS, Math.floor(options.capacitySlots)));
}

/** Claim the first available slot in one closed capacity namespace under the domain token. */
function acquireCapacityEntry(root, token, ttlMs, slots, scope) {
  for (let index = 0; index < slots; index += 1) {
    const resource = resourceKey(scope, '', String(index));
    const entry = acquireEntry(root, resource, token, ttlMs);
    if (entry) return entry;
  }
  return null;
}

/**
 * @description Builds canonical cross-process resources for one engine command. Raw OIDC values
 * never become lock paths; the same collision-safe user-store segment identifies their database.
 * @param {string} userSub - Authenticated raw OIDC subject.
 * @param {string} verb - Engine command verb used to identify shared-corpus writers.
 * @param {string} [slot=user-store] - Per-user mutation lane.
 * @param {string[]} [globalSlots=[]] - Additional tenant-wide mutation lanes.
 * @returns {string[]} Stable structured resource identities.
 */
function buildRunResources(userSub, verb, slot = 'user-store', globalSlots = []) {
  const resources = [resourceKey('user', userStoreSegment(userSub), slot || 'engine')];
  const globals = [...globalSlots];
  if (SHARED_CORPUS_WRITERS.has(String(verb || ''))) globals.push('corpus-write');
  for (const globalSlot of globals) {
    if (globalSlot) resources.push(resourceKey('global', '', String(globalSlot)));
  }
  return normalizeResources(resources);
}

/**
 * @description Atomically acquires every requested filesystem resource or rolls back the partial
 * set. Each owned lease heartbeats until explicitly released, allowing bounded crash recovery.
 * @param {string} storeRoot - Configured Career store root.
 * @param {string} tenant - Contained Career tenant directory.
 * @param {string[]} resources - Structured resource identities to acquire together.
 * @param {{ttlMs?:number,heartbeatMs?:number,capacitySlots?:number,capacityGroup?:'engine'|'upload-body',onError?:(error:unknown)=>void,onLost?:(error:unknown)=>void}} [options] - Lease tuning, closed shared-capacity namespace, and fencing diagnostics.
 * @returns {{status:'ok',lease:object}|{status:'inflight'|'busy'}} Acquisition result.
 */
function tryAcquireRunLocks(storeRoot, tenant, resources, options = {}) {
  const normalized = normalizeResources(resources);
  if (!normalized.length) throw new Error('Career run lock requires at least one resource');
  const root = runLockRoot(storeRoot, tenant);
  fs.mkdirSync(root, { recursive: true });
  const token = crypto.randomBytes(24).toString('hex');
  const ttlMs = leaseDuration(options);
  const entries = [];
  try {
    for (const resource of normalized) {
      const entry = acquireEntry(root, resource, token, ttlMs);
      if (!entry) {
        releaseEntries(entries, token, options.onError);
        return { status: 'inflight' };
      }
      entries.push(entry);
    }
    const slots = capacitySlotCount(options);
    if (slots) {
      const capacity = acquireCapacityEntry(root, token, ttlMs, slots, capacityScope(options));
      if (!capacity) {
        releaseEntries(entries, token, options.onError);
        return { status: 'busy' };
      }
      entries.push(capacity);
    }
  } catch (error) {
    releaseEntries(entries, token, options.onError);
    throw error;
  }
  const heartbeatMs = heartbeatDuration(ttlMs, options);
  const lease = {
    owned: true, root, token, resources: normalizeResources(entries.map((entry) => entry.resource)),
    entries, ttlMs, heartbeatMs,
    onError: options.onError, onLost: options.onLost,
  };
  return { status: 'ok', lease: startHeartbeat(lease, heartbeatMs) };
}

/**
 * @description Serializes only the opaque token and exact resource set needed by the spawned CLI
 * to prove it is executing beneath the parent lease rather than reacquiring and deadlocking.
 * @param {object} lease - Owned filesystem lease returned by tryAcquireRunLocks.
 * @param {number} [deadlineAt] - Absolute epoch-millisecond engine deadline owned by the parent.
 * @returns {string} Base64url adoption proof suitable for a child environment variable.
 */
function serializeRunLockAdoption(lease, deadlineAt = Date.now() + DEFAULT_RUN_DEADLINE_MS) {
  if (!lease?.owned || !lease.token) throw new Error('Only an owned Career run lock can be adopted');
  if (!Number.isInteger(deadlineAt) || deadlineAt <= 0
      || deadlineAt - Date.now() > MAX_RUN_DEADLINE_MS + 60_000) {
    throw new Error('Career run lock adoption deadline is invalid');
  }
  const payload = {
    version: ADOPTION_VERSION, token: lease.token, resources: lease.resources,
    ttlMs: lease.ttlMs, heartbeatMs: lease.heartbeatMs, deadlineAt,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Parse and shape-check a child proof, allowing exactly one parent-selected capacity slot. */
function parseAdoptionProof(encoded, resources) {
  let payload;
  try { payload = JSON.parse(Buffer.from(String(encoded), 'base64url').toString('utf8')); }
  catch { return null; }
  const expected = normalizeResources(resources);
  if (payload?.version !== ADOPTION_VERSION || typeof payload.token !== 'string') return null;
  if (!Array.isArray(payload.resources)) return null;
  if (!Number.isInteger(payload.ttlMs) || payload.ttlMs < 50 || payload.ttlMs > MAX_TTL_MS) return null;
  if (!Number.isInteger(payload.heartbeatMs) || payload.heartbeatMs < 20) return null;
  if (payload.heartbeatMs > Math.floor(payload.ttlMs / 2)) return null;
  if (!Number.isInteger(payload.deadlineAt) || payload.deadlineAt <= 0) return null;
  if (payload.deadlineAt - Date.now() > MAX_RUN_DEADLINE_MS + 60_000) return null;
  const actual = normalizeResources(payload.resources);
  const domain = actual.filter((resource) => !isCapacityResource(resource));
  const capacity = actual.filter(isCapacityResource);
  if (domain.length !== expected.length || domain.some((item, index) => item !== expected[index])) return null;
  if (capacity.length > 1 || actual.length !== domain.length + capacity.length) return null;
  return {
    token: payload.token, resources: actual,
    ttlMs: payload.ttlMs, heartbeatMs: payload.heartbeatMs, deadlineAt: payload.deadlineAt,
  };
}

/**
 * @description Validates exact token ownership for every inherited parent lock. The child also
 * heartbeats that generation so detached work remains exclusive if its runner parent exits.
 * @param {string} storeRoot - Configured Career store root.
 * @param {string} tenant - Contained Career tenant directory.
 * @param {string[]} resources - Exact resources required by the child command.
 * @param {string} encoded - Opaque parent adoption proof.
 * @param {{onError?:(error:unknown)=>void,onLost?:(error:unknown)=>void}} [options] - Child-side heartbeat diagnostics and fencing callback.
 * @returns {{status:'ok',lease:object}|{status:'invalid'}} Adoption result.
 */
function adoptRunLocks(storeRoot, tenant, resources, encoded, options = {}) {
  const proof = parseAdoptionProof(encoded, resources);
  if (!proof) return { status: 'invalid' };
  const root = runLockRoot(storeRoot, tenant);
  const entries = proof.resources.map((resource) => ({ resource, directory: lockDirectory(root, resource) }));
  if (entries.some((entry) => readOwner(entry.directory)?.token !== proof.token)) {
    return { status: 'invalid' };
  }
  const lease = {
    owned: false, root, token: proof.token, resources: proof.resources, entries,
    ttlMs: proof.ttlMs, heartbeatMs: proof.heartbeatMs, deadlineAt: proof.deadlineAt,
    onError: options.onError, onLost: options.onLost,
  };
  return { status: 'ok', lease: startHeartbeat(lease, proof.heartbeatMs) };
}

/**
 * @description Stops heartbeats and token-safely releases only the generation owned by this
 * process. Adopted children stop their heartbeat but leave token-safe removal to the parent or TTL.
 * @param {object} lease - Owned or adopted filesystem lease.
 * @returns {void}
 */
function releaseRunLocks(lease) {
  if (!lease || lease.released) return;
  lease.released = true;
  if (lease.timer) clearInterval(lease.timer);
  if (!lease.owned) return;
  releaseEntries(lease.entries, lease.token, lease.onError);
}

module.exports = {
  RUN_LOCK_ADOPTION_ENV,
  adoptRunLocks,
  buildRunResources,
  releaseRunLocks,
  serializeRunLockAdoption,
  tryAcquireRunLocks,
};
