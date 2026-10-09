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

A `passed` or `failed` record names exactly seven evidence documents: one per control plus
`goldenPath`. `goldenPath` is the package's own offline Test Lab case, and it gates `authz`. A
`pending` record names none. A `passed` record needs every control passed, a UTC audit timestamp,
and the exact 40-character Git SHA reviewed. Run an audit against an already committed source SHA,
then publish its record and matching marketplace binding as a separate reviewed change. Never use
the commit containing the attestation as a self-referential source SHA.

## Evidence

Each evidence document is stored at `audits/evidence/<app>/<sourceSha>/<name>.json`. It is
canonical JSON: keys are sorted at every depth, with two-space indentation and one trailing
newline. It carries no timestamp or duration, so re-running a control over the same source
reproduces the same bytes. A document names the app, version, source SHA, `source.path`, the Git
tree ID of the package at that SHA (`packageTree`), its control, its result, and the named checks
with their problems. The record's `evidence[].sha256` is the SHA-256 of those bytes.

The validator and the core installer both re-hash every document. They also require it to describe
this record, and require the record's control statuses to equal the documents' results. A changed
byte, a missing document, or a record that disagrees with its evidence fails in every mode.

A passed record is **current** only while the package tree at `HEAD` equals the tree at
`sourceSha`. Any later change to the package, including a manifest version bump, makes the record
stale, and CI fails with "re-audit required". The validator therefore needs a checkout that holds
the audited commit. The security workflow's inventories job fetches full history for that reason.

## Running an audit

`scripts/security/run-package-audit.mjs` extracts the committed SHA with `git archive`. It never
uses a worktree and never touches the checkout. It runs each control against the extracted tree:

| Evidence | Checks |
|---|---|
| `manifest` | core `oshal-app.js validate`; `check-catalog` problems for this package; compiled-route peers from the route inventory |
| `authz` | the package's route/auth/write inventory equals the reviewed `store-route-inventory.json`; machine-write routes need a passing authorization/isolation test |
| `rls` | `check-forced-rls` for this package's migrations; a package with migrations fails until the disposable-PostgreSQL replay and two-owner proof is added to the runner |
| `dependencies` | undeclared cross-package edges, the connector allow-list, public secret fallbacks; third-party `package.json`/Python dependencies fail until an advisory scan is added |
| `installLifecycle` | install, update, uninstall and reinstall through the core installer CLI from a throwaway single-commit store. The installed files must equal the audited package tree |
| `surface` | `audit-live-surfaces.mjs` in Chromium on desktop and mobile in two themes, against a loopback host that mounts the package's own routes. A route that needs the framework host fails with that reason |
| `goldenPath` | every offline `node-test` case in the package's `tests/test-lab.yaml`, with outcomes recorded by name |

```text
node scripts/security/run-package-audit.mjs <app> --sha <40-hex> --framework <core checkout>
node scripts/security/run-package-audit.mjs <app> --sha <40-hex> --framework <core checkout> --write
node scripts/security/run-package-audit.mjs <app> --verify --framework <core checkout>
```

A run without `--write` only prints the results. `--write` writes the seven documents, the record
and the catalog binding together, and removes this app's evidence for older SHAs. `--verify`
re-runs every control at the recorded SHA and fails unless each document reproduces byte for byte
and still hashes to the recorded digest.

The public snapshot (`scripts/build-store-public.sh`) is a fresh single-commit history, so no
audited trunk SHA exists in it. Step 4c publishes every attestation there as a truthful pending
record until the promoted catalog is audited against its own commit.

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

1. Commit the package candidate and capture its full Git SHA (a commit on `main`, so installers
   can fetch it).
2. Run `node scripts/security/run-package-audit.mjs <app> --sha <sha> --framework <core> --write`.
   It runs every control at that SHA and writes the evidence, the record and the binding together.
3. Run `node scripts/security/run-package-audit.mjs <app> --verify --framework <core>` to prove
   the audit reproduces.
4. Run `node --test scripts/security/package-audit.test.mjs` and the validator in `enforce` mode
   for that package decision before review, then commit the record, binding and evidence.

The checked-in `profile-v1.schema.json` is documentation/tooling support. The JavaScript validator
is the release gate because the store CI intentionally has no dependency-install step.
