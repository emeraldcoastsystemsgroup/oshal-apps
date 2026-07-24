# Spaces (spaces) — OSHAL app package

Turn a real space into an explorable 3D scene, then reason over it (`?app=spaces`,
ADR-111). Film a walkthrough clip, **import** a finished capture from an iPhone/iPad
Pro LiDAR scan / depth sensor / drone photogrammetry app (`.ply`/`.splat`), or fly a
**sim-drone** scan orbit — all three flow the same pipeline into a Gaussian-splat
scene you walk in a WebGL viewer. Get live **walk/pan** guidance on a phone HUD while
you film, and paint a Wi-Fi/RF **coverage overlay** onto the ready map. All scans are
owner-scoped; the reconstruction itself is deterministic I/O — no LLM in the pipeline.
The **spaces-operator** inline concierge only BRIEFS scans and DRAFTS capture guidance;
it never runs a reconstruction.

Carved out of OSHAL core (ADR-085, "skill with a surface" — ADR-093):

- **In this package:** the app manifest (`uses: spatial-mapping` + the Spaces tile),
  the `/api/spaces` routes (the surface/viewer/capture HTML serve, owner-scoped scan
  upload/import/list/read/delete, the streamed `.splat` artifact + poses, the RF
  coverage overlay, the deterministic capture-plan, the phone-HUD capture + telemetry
  sink, and the sim-first drone scan), the three surfaces (`tools/spaces.html`,
  `tools/spaces-viewer.html`, `tools/spaces-capture.html`), and a package copy of the
  spaces-operator persona for the registrar.
- **Stays in the OSHAL kernel:** the reconstruction **engine** + owner-scoped scan
  store (`@/features/spatial-mapping` — `SpatialMappingService`, the Sim + Edge
  reconstruction providers, the import engine, pose persistence, `RfOverlayService`,
  and the capture-plan / drone-scan pattern generators), a **PINNED kernel skill**
  (`spatial-mapping`) this package declares in `uses:` and resolves from the running
  framework's dist at mount time; the spaces-operator **inline concierge node** (both
  `swarm-bot-registry` blocks + the `ai-lab` persona); and the sim-drone helper
  (`@/features/drone` `SimDroneProvider` + `validateMission`) the drone-scan mission
  flies — kernel-resident via the drone node-server pin (imported here at runtime, but
  NOT a declarable kernel-skill id, so it is not in `uses:`).

## `uses: spatial-mapping`

This app imports the reconstruction engine from the framework rather than bundling it.
`uses: [spatial-mapping]` is validated **fail-closed** at load against the kernel-skill
registry (`src/shared/kernel-skills/registry.ts`) — the id must be exactly
`spatial-mapping`. The CI kernel-skill guard keeps `@/features/spatial-mapping` in the
built image for as long as any installed app declares it.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Spaces | `/api/spaces/app` | The Spaces home: capture/import/drone-scan, scan list, brief |
| (embedded) | `/api/spaces/viewer` | Self-contained WebGL splat viewer |
| (phone) | `/api/spaces/capture` | Live guided-capture HUD (walk vs pan arrows) |

The surfaces are self-contained except for the framework-served shared UI
(`/shared/ui/...`, root-relative same-origin) — consumed read-only, same as every
cockpit surface.

## Install / uninstall

```bash
node scripts/oshal-app.js install spaces
node scripts/oshal-app.js uninstall spaces
```

No migrations — the owner-scoped scan store is created lazily by the spatial-mapping
service at first use (`runRuntimeSchemaBootstrap` + owner RLS at the chokepoint).

## ⚠️ Surfaces + routes MUST be re-synced from core before the release build

This package was mirrored while core was still being edited. Before the orchestrator's
final `oshal-app build`, **re-sync from core**:

- **`tools/spaces-capture.html`** — the phone-capture HUD was being modified by a
  concurrent change at carve time. Re-copy the CURRENT
  `src/api/spaces-capture.html`. (Also re-copy `spaces.html` + `spaces-viewer.html` if
  they changed.)
- **`src-routes/spaces-routes.ts`** (and therefore the built `routes/spaces-routes.js`)
  — the handler region is marked `// SYNC FROM CORE spaces-routes.ts AT INTEGRATION`.
  Core `spaces-routes.ts` is being extended with a **mobile-ingest endpoint**; re-sync
  the handler bodies from the FINAL core source, then rebuild the `.js`.
  **Keep the packaged adaptations when re-syncing:** the single-arg `createSpacesRoutes(ctx)`
  factory (the mounter calls `factory(packageCtx)`) and the `surfaceHtml(ctx.appPackageDir, ...)`
  surface serving — do **not** reintroduce core's `apiDir` parameter.
