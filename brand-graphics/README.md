# brand-graphics — an OSHAL app package

On-brand OSHAL motion graphics: a specialist bot turns a short brief ("intro for
daily trade recap") into the validated electric-"oshal" intro look by driving
Google Vids (Veo + Voiceover + Music) on the operator's signed-in remote Chrome,
and returns the project URL.

Carved out of the OSHAL core repo 2026-07-17 (ADR-085 Wave 1 — the first Wave-1
carve, and the first packaged **CLI tool**: `brand_graphic`'s script ships in
`tools/` and is invoked via the manifest's `{packageDir}` token).

## Contents

| Piece | File |
|---|---|
| Manifest | `oshal-app.yaml` |
| Bot persona | `personas/brand-graphics.yaml` (agentId `b00f0000-…-000000000001`) |
| CLI tool | `tools/oshal-brand.js` — enqueues a `kind: 'brand'` job to `/api/vids/jobs` |

No routes, no migrations, no schedules, no theme CSS — the cockpit tile embeds the
vids app's job-queue surface (`/api/vids/app`).

## Dependencies

- **vids** (`dependencies.apps: [vids]`) — the `/api/vids` API + the
  `@oshal/vids-operator` worker do the actual rendering. vids is framework-resident
  today; the resolver satisfies the dependency from core until vids itself carves.

## Install

```bash
node scripts/oshal-app.js install brand-graphics
```

Ships `status: inactive` (parity with how it lived in core). Toggle it active once
a Vids worker is registered and signed in. The brand look + Veo filter-safe rules
are documented with the vids-operator package (`BRAND-THEME.md` in the framework).
