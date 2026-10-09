#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Backlog #33: publish trunk-bound audit attestations as truthful pending records in the public snapshot. An attestation names a TRUNK commit; scripts/build-store-public.sh cuts a fresh single-commit history in which that commit does not exist, so an installer that pins it fails outright (an older core in compatible mode aborts the whole install on the fetch). Until the promoted catalog is re-audited and rebound to its own commit, the snapshot says "pending" for every package and carries no evidence directory.
 *
 * Usage: node scripts/security/snapshot-audit-reset.mjs <snapshot-dir>
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_AUDIT_CONTROLS, UNAUDITED_SOURCE_SHA, validatePackageAuditCatalog } from './validate-package-audits.mjs';

/**
 * @description Rewrite every non-pending attestation in a snapshot tree to the canonical pending
 * record and sentinel binding, drop audits/evidence/, and prove the result validates.
 * @param {string} root - Snapshot directory (never the trunk checkout).
 * @returns {string[]} The packages whose attestation was reset.
 */
export function resetSnapshotAttestations(root) {
  const catalogPath = join(root, 'marketplace.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const reset = [];
  for (const entry of catalog.apps ?? []) {
    if (!entry?.audit || entry.audit.sourceSha === UNAUDITED_SOURCE_SHA) continue;
    entry.audit = { record: `audits/${entry.name}.json`, sourceSha: UNAUDITED_SOURCE_SHA };
    writeFileSync(join(root, 'audits', `${entry.name}.json`), `${JSON.stringify({
      profileVersion: 1, app: entry.name, version: entry.version, sourceSha: UNAUDITED_SOURCE_SHA, status: 'pending', auditedAt: null,
      controls: Object.fromEntries(PACKAGE_AUDIT_CONTROLS.map((name) => [name, 'pending'])), evidence: [],
    }, null, 2)}\n`);
    reset.push(entry.name);
  }
  if (reset.length) writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  const evidence = join(root, 'audits', 'evidence');
  if (existsSync(evidence)) rmSync(evidence, { recursive: true, force: true });
  const report = validatePackageAuditCatalog(root, 'compatible');
  if (report.errors.length) throw new Error(`snapshot audit records do not validate:\n  ${report.errors.join('\n  ')}`);
  return reset;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const target = process.argv[2];
    if (!target) throw new Error('Usage: snapshot-audit-reset.mjs <snapshot-dir>');
    const reset = resetSnapshotAttestations(resolve(target));
    console.log(`Snapshot audit posture: ${reset.length} trunk-bound attestation(s) published as pending${reset.length ? ` (${reset.join(', ')})` : ''}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
