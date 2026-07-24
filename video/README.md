# Video Studio (video) — OSHAL app package

Make prompted short-form videos (TikTok / YouTube Shorts / Instagram Reels) from
an idea. The **video-director** bot drafts a scene-by-scene storyboard (LLM,
metered, inline on the api); the framework renders a REAL .mp4 deterministically
(one Veo clip per scene, TTS voiceover, burned-in captions, ffmpeg stitch) and
saves it to your Files storage. A SERIES (`video-series` ticket) is written by the
**screenplay-writer** bot, held at a human approval gate on the script, then
storyboarded and rendered one episode at a time on the remote Vids node (ADR-082
— the state-machine conductor is the runtime, not a workflow graph).

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the `/api/video` routes (storyboard / generate / list +
  the series lifecycle: create / approve / advance / write / storyboard / render),
  the studio surface (`tools/video.html`, self-served at `/api/video/ui`),
  package copies of the three personas for the registrar, migration COPIES of
  066/067 for fresh installs, and `tests/video-manifest-no-graph.spec.ts` (the
  ADR-082 graph-block-retirement guard, moved from the kernel with the manifest).
- **Stays in the OSHAL kernel:** the video-series **conductor engine**
  (`src/app/series-{pipeline,orchestrator,dispatch,drive}.ts`) + the
  `startSeriesReconciler` cron in server.ts; the `src/features/video-generation`
  slice (renderVideo, storyboard sanitizer, Veo cost model); the video-director
  (…048) + screenplay-writer (…052) **inline nodes** in BOTH
  `swarm-bot-registry` blocks + the kernel personas; kernel migrations 066/067;
  and the SHARED vids-operator remote-client desktop worker
  (`packages/oshal-vids-operator`) that renders episodes.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Video Studio | `/api/video/ui` | Storyboard → generate → My videos + the series pipeline (self-served by this package) |

## Install

```bash
node scripts/oshal-app.js install video
```

Requires `APP_PACKAGE_DYNAMIC_ROUTES=1` (the ADR-085 route mounter). Single clips
bill Veo per second under the director's agent id; series storyboards bill the
caller's own connectors (Google Drive for frames; gcp for Vertex images when
`STORYBOARD_IMAGE_PROVIDER=vertex`). Series renders need the Vids worker online:

```bash
npx oshal-vids worker   # on a machine with a screen + signed-in Chrome
```
