# Spaces (spaces) — OSHAL app package

<!--
CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Clarified that this installed package is the sole
  | Spaces surface source after removal of the unrouted kernel HTML copies and Compose binds.
-->

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

## Package source of truth

The carve was reconciled on 2026-07-20 and the historical unrouted kernel HTML copies and local
Compose binds have been removed. Routes and surfaces are maintained only in this package:

- Core has no active Spaces route. `src-routes/spaces-routes.ts` here is the maintained source,
  including the `/pair` mobile-ingest endpoint.
- The packaged surfaces include the dimensions and geometry-download work from the completed carve.
- The packaged single-argument `createSpacesRoutes(ctx)` factory and
  `surfaceHtml(ctx.appPackageDir, ...)` serving are required by the app loader. The retired
  two-argument `apiDir` shape must not return.

### Surface stylesheet boundary

The cockpit page follows the deployment theme. The two full-screen embeds intentionally do not:

| Surface | Shared CSS | Design tokens | Reason |
|---|---|---|---|
| `tools/spaces.html` | `surface-themes.css` and `surface-glass.css` | yes | cockpit page |
| `tools/spaces-viewer.html` | none | none | neutral black WebGL rasterizer |
| `tools/spaces-capture.html` | none | none | low-latency phone camera HUD |

`tests/spaces-surfaces.test.js` protects the source-of-truth boundary in both source and compiled
routes, parses every inline surface script, and pins this stylesheet split.
