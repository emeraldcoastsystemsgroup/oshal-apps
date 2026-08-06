# OSHAL package audit records

`audits/<app>.json` is the reviewed release attestation for the package with that catalog name.
It is repository data, never installer/runtime state. The profile is intentionally strict: an
unrecognized field or status requires a new `profileVersion`, rather than silently changing what
an existing attestation means.

The authoritative profile-v1 controls are:

- `manifest`: manifest/catalog validation and source/compiled parity.
- `authz`: route authentication, object authorization, confirmation rails, and a package golden path.
- `rls`: database row isolation plus fresh-install and repeated migration behavior.
- `dependencies`: dependency, secret, and software-supply-chain scans.
- `installLifecycle`: install, update, uninstall, and reinstall against the real package boundary.
- `surface`: responsive and theme behavior on the declared surfaces.

Evidence entries contain a human-readable name and the SHA-256 of the preserved evidence bytes.
A `passed` record needs every control passed, at least one evidence digest, a UTC audit timestamp,
and the exact 40-character Git SHA reviewed. Run an audit against an already committed source SHA,
then publish its record and matching marketplace binding as a separate reviewed change. Never use
the commit containing the attestation as a self-referential source SHA.

## Truthful pending records

The initial records are deliberately `pending`: no passing evidence was fabricated. Pending records
use `auditedAt: null` and the all-zero `sourceSha` sentinel. That sentinel means *no source has been
audited*; it is never a checkout target and is rejected by enforce mode.

When a package changes after a passed audit, its catalog binding must not continue to imply that the
new mutable ref was audited. Reset the current profile to a truthful pending record while review is
in progress, or publish the new attestation only after auditing the already-committed package SHA.
The marketplace and record always change together.

## Staged installer policy

The zero-dependency validator and installer decision live in
`scripts/security/validate-package-audits.mjs`.

```text
node scripts/security/validate-package-audits.mjs
node scripts/security/validate-package-audits.mjs --mode compatible
OSHAL_PACKAGE_AUDIT_MODE=enforce node scripts/security/validate-package-audits.mjs
```

`OSHAL_PACKAGE_AUDIT_MODE` accepts exactly:

- `compatible` (default): validate the store's record shape/binding in CI, but preserve legacy
  installs while records are pending. An unsafe record yields no trusted SHA pin; the caller may
  continue with the catalog `source.ref` only as an explicit rollout compatibility decision.
- `enforce`: fail closed on a missing, malformed, pending, failed, version-mismatched, or
  SHA-mismatched record. A successful decision returns `sourceSha`; installers must fetch and check
  out that exact SHA, never the mutable catalog ref.

Roll enforcement out by risk: children, money/trading, communications, physical-device control,
and external publishing first. Do not switch a deployment to `enforce` until every package it may
install has a genuine passed record.

## Maintainer workflow

1. Commit the package candidate and capture its full Git SHA.
2. Run every profile control at that SHA, preserving the actual outputs as evidence artifacts.
3. Hash the preserved evidence bytes with SHA-256.
4. Update `audits/<app>.json` and the matching `marketplace.json` `audit.sourceSha` together.
5. Run `node --test scripts/security/package-audit.test.mjs` and the validator in `enforce` mode
   for that package decision before review.

The checked-in `profile-v1.schema.json` is documentation/tooling support. The JavaScript validator
is the release gate because the store CI intentionally has no dependency-install step.
