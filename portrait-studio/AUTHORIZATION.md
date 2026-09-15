# Portrait Studio application permissions

Version 1.13.0 imports `authorization.yaml` through the core `application-authorization`
capability. No role is assigned automatically. A swarm administrator manages assignments but
receives no business access from being an administrator. An explicit app deny blocks the
component, API operations and artist dispatch regardless of other role assignments.

| Imported role | Operations on this principal's portraits |
| --- | --- |
| `viewer` | Open the studio and style catalog; no saved portrait data |
| `reader` | View and read the gallery, images, source photos, readiness and Home summary |
| `creator` | Read and create a new portrait |
| `editor` | Read and change a saved portrait's title |
| `deleter` | Read and delete a saved portrait |
| `exporter` | Read and download/export a saved portrait |
| `mailer` | Read/export plus the separately declared email permission; sending is currently unavailable |
| `artist` | View and dispatch the portrait artist under the core's protected execution boundary |
| `manager` | All declared business operations; ownership restrictions still apply |

Roles compose. For example, assign `reader` plus `editor` without granting create or delete.
The exact permission IDs are `portrait.view`, `portrait.read`, `portrait.create`,
`portrait.change`, `portrait.delete`, `portrait.export`, `portrait.email` and `portrait.artist`.
Every bound operation also requires `portrait.view`. The server's `GET /permissions` returns
current operation booleans; the page hides controls when their operation is unavailable.
Changing the browser never grants API access. The title PATCH accepts only `title`, up to
120 characters, and cannot change ownership, image paths or generation status.

Every resource grant is `own`. Rows must match **both** the verified identity issuer and
subject. No tenant/team scope is declared, and a supplied tenant does not broaden access.
The adapter checks individual record ownership; collections constrain SQL to the same exact
principal. Runtime queries use the restricted business database identity, without operator
bypass. New image folders hash the issuer and subject together.

Migration `003-verified-portrait-ownership.sql` adds nullable `owner_issuer` and `title`.
Historical rows remain intact with a null issuer and are inaccessible through the protected
package. The migration deliberately does not infer an issuer from email, the current login,
configuration defaults or subject alone. A separate operator-reviewed migration must establish
an exact historical identity mapping before attaching legacy rows. It must preserve their
existing image paths and record the reviewed mapping; no such live migration runs on install.

Creation rechecks permission after waiting for a generation slot, before every provider
attempt and before publishing its result. Revoked work cannot publish a new image. Bytes
already sent to a provider cannot be recalled. Gallery and Home reads do not trigger the
previous lazy status sweep; interrupted rows are repaired at package startup.

The platform `codex`, `openrouter` and configured `comfyui` image providers retain their
normal configuration requirements. The subject-only `codex-cli` operator rail cannot carry
these app rights and is refused with `portrait_cli_authorization_unavailable` before a row
is queued. Email is refused with `portrait_mail_identity_unavailable` before any connection
lookup because the existing mailbox broker has no verified issuer ownership argument.
These are capability failures, separate from a missing role (403). Downloading a portrait
and using one's own mail application remains available to an exporter. No connector storage
migration or expanded provider authority is introduced here.

## Legacy ownership review report

After the schema migration, an authorized operator may run the unlisted
`migrations/legacy-owner-review.sql` through an existing PostgreSQL client. It uses a
read-only transaction and a ten-second statement timeout. Report the total and
`portraits_requiring_owner_review` counts in installation acceptance; a nonzero count means
records were preserved but need review. The subject-grouped output contains identity data
and belongs in the private operator record, never a public commit or Test Lab artifact.

Complete this record before proposing any separate data migration:

| Review field | Required evidence |
| --- | --- |
| Installed source/version | Installer source stamp and Portrait version |
| Database/report timestamp | Exact database identity and read-only report time |
| Legacy subject and count | Exact stored subject and expected affected count |
| Verified destination issuer and subject | Independent identity-provider or historical authentication evidence; an email match alone is insufficient |
| Reviewed portrait IDs | Explicit bounded list belonging to that historical principal |
| Preserved paths | Existing source/output paths and row IDs remain unchanged |
| Reviewer and approval | Authorized operator, evidence reference and approved mapping |
| Proposed migration verification | Match exact IDs, old subject and null issuer; abort on count mismatch; review before executing |

This release includes no automatic issuer assignment and does not claim the report has been
run against a user's installation. If authoritative historical evidence is unavailable, keep
those records unchanged and report the pending count.

The metadata smoke declares `requiresUser: true` and `auth: pat`. Installation reports it as
pending until an authenticated user PAT is provided; that user must have `portrait.view`.
A service secret alone cannot access the protected package. AI Test Lab registers this
readiness case with the manifest's user prerequisite and never reports pending as passed.
The `authenticated-artifacts` capability also requires a core that preserves verified caller
identity when the shared artifact picker reads a protected Portrait source.

## Reproducible isolated verification

Use an explicitly selected compatible core checkout with its locked dependencies installed:

```powershell
$env:OSHAL_CORE_ROOT = '<absolute-core-checkout>'
node "$env:OSHAL_CORE_ROOT/node_modules/vitest/vitest.mjs" run --config portrait-studio/tests/authorization.config.mjs
```

`authorization.spec.ts` exercises real policy/runtime and package HTTP with isolated business
records and a provider double: exact owner isolation, independent CRUD grants, no admin
bypass, denial/revocation, queued generation and unavailable transports.
`authorization-browser.spec.ts` uses disposable Chromium contexts against that actual HTTP
fixture to verify two-user galleries, hidden controls, title changes and revocation. Neither
suite uses real accounts, a live database, a camera, or an external provider. The separate
shared artifact picker regression runs from the compatible core checkout.

All suite and support files are registered in `tests/test-lab.yaml`. Installed registration
records the source/version and prerequisites; it does not claim these local suites executed.
