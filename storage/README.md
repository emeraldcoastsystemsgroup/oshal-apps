# Storage — OSHAL app package

Your storage hub (ADR-041): choose where OSHAL saves generated **code** vs **files**
(GitHub / Dropbox / OSHAL-local), manage targets by chat with the Storage Assistant,
and browse your files.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 2). This is a **"skill with a
surface"** carve — only the surface layer ships here:

- **In this package:** the app manifest, the `/api/storage` route (settings page,
  prefs CRUD, Dropbox/GitHub pickers, the Storage Assistant chat endpoint, the
  OSHAL-local list/download endpoints), the two surfaces
  (`tools/storage-settings.html`, `tools/storage-assistant.html`), and a package
  copy of the storage-assistant persona for the registrar.
- **Stays in the OSHAL kernel:** the storage-target + storage-browse skill layer
  (Tier-0b — generators call `saveContent`/`listFolder` there), the
  `oshal_storage_prefs` lazy-DDL chokepoint (owner RLS applied kernel-side), the
  unified file browser at `/api/files` (framework Files tile; also serves the
  career provider), and the storage-assistant bot node (container + registry
  block + core persona, ADR-093 interim).

## Surfaces

| Tile | URL | What |
|---|---|---|
| Assistant | `/api/storage/assistant/ui` | Chat: create repos, set targets, list files |
| Storage Settings | `/api/storage` | Pick where code/files save, per bucket |
| Files | `/api/files` | Unified browser (kernel-served) |

## Install

```bash
node scripts/oshal-app.js install storage
```

No migrations — the prefs table is kernel-owned lazy DDL. Uninstall/toggle never
touches data.
