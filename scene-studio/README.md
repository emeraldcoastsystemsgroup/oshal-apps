# Scene Studio

Godot games and 3-D scenes, and Blender models, that you build by hand or by asking the **Scene
Studio Director** in the chat. The director drives Godot and Blender through their own MCP
servers — [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) and the official
[Blender Lab MCP](https://projects.blender.org/lab/blender_mcp) — which run inside this package's
engine container next to Godot 4.7.2 and Blender 5.1.

- A **project** is a Godot project (scenes, GDScript, assets) or a Blender project (`scene.blend`).
- Every change is a **revision**; restoring one is undo, and nothing is lost.
- A **preview** is a Cycles still rendered on the CPU plus a 3-D orbit view in the studio. A Godot
  scene is exported to glTF by Godot and rendered by Blender, because headless Godot cannot draw.
- A Godot project can be **run** headless for a few seconds; its printed output and errors come back.
- A Blender model can be **brought into** a Godot project: model in Blender, play in Godot.
- **Exports:** a Godot project as a zip; a Blender scene as glTF (GLB), FBX, OBJ, STL or a zip of the project.

It is the 3-D option that runs on the DGX Spark itself. Unreal Engine needs a Windows satellite PC;
see core ADR-051.

## Use it

Open **Scene Studio** from the cockpit (`/cockpit?app=scene-studio`).

1. **New project** → *Godot game or 3-D scene* (templates: 3-D with ground, sun and camera; 2-D;
   empty) or *Blender model* (Blender's default scene, or the same without the cube).
2. Ask the director, for example:
   - "Make a small island with three palm trees and a red boat, then render it."
   - "Add a player that walks with the arrow keys and run it."
   - "In the boat model, make the hull 20 % longer and paint the sail white."
   - "Bring the boat into the island game, floating next to the dock."
3. Or work directly in the studio: edit files, upload assets, call a godot-mcp tool, run Blender
   Python, render, run, export, restore.

The studio follows the open project while the director edits it: new revisions, previews and run
output appear on their own.

## Access

Scene Studio declares an ADR-149 role catalog, [authorization.yaml](authorization.yaml), with one
role: **creator** carries the whole app (open the studio; read, edit, run, render and export your
own projects). A swarm admin grants it in **Access** (`/access` → the person → *This user's
applications* → `scene-studio` → *Edit roles* → **creator**).

Updating from 0.1.x adopts that catalog over the old application-admin fallback, which is a
breaking catalog change: the update is refused with `authorization_catalog_migration_required`
until an administrator approves the catalog-migration review, the approved migration removes the
`@app-admin` grants, and each person then needs **creator**.

The Scene Studio Director's tools are switched on for it at install (its persona's
`authorizations:`); the cockpit's tool toggles can change them later. On the concierge node a
tool must also be marked installed (docs/ARCHITECTURE.md §5).

## The engine container

Godot, Blender and both MCP servers run in the package's own container, `oshal-scene-studio-engine`
(the `cad-studio` pattern, BUILDING-EXTENSIONS §7). Install or rebuild it on the box:

```sh
docker exec <api-container> sh /app/workspace-shared/deployed-apps/scene-studio/engine/install-engine.sh
```

The installer builds the image from pinned upstream sources, starts the container in its own
compose project on the stack network, and runs the engine's end-to-end self-test (19 checks). When
the engine is down or out of date, the studio and `scene-capabilities` say so and print that exact
command.

| Piece | Pin | Checked against |
|---|---|---|
| Godot 4.7.2-stable | official `linux.arm64` build | SHA-256 of the release zip |
| Blender 5.1.0 | CoconutMacaroon/blender-arm64 `v10-5.1` | SHA-256 of the release tarball |
| godot-mcp | Coding-Solo/godot-mcp @ `1209744` (includes the arbitrary-GDScript fix, PR #99) | SHA-256 of the commit tarball |
| Blender Lab MCP | v1.0.3 @ `2cea8d5` | the commit, asserted after clone |
| Node | 24.21.0 | the official `node` image |

No official Blender build exists for linux/arm64, so the Blender pin is a community build from a
single maintainer with no CI or signatures; its integrity check is GitHub's asset digest. The
engine builds for **linux/arm64 only** today; the installer refuses other machines with that reason.

**Code you or the director write runs sandboxed.** Each job (a godot-mcp call, Blender Python, a
run, a render) runs one at a time in a throwaway directory under a seccomp filter that allows only
local (AF_UNIX) sockets: no network, no downloads, no reaching the database or other services.
After every job the engine kills anything the job left running and empties `/tmp`. Details:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §3.

## Layout

```
scene-studio/
  oshal-app.yaml                manifest: the director, 22 package tools, the surface, routes, migration
  authorization.yaml            ADR-149 catalog: permissions, the creator role, route/tool/bot bindings
  personas/scene-studio-director.yaml
  src-routes/*.ts → routes/*.js the package routes (compiled; @/ resolved by the framework at runtime)
  tools/scene-studio.{html,js}  the studio surface
  migrations/001-scene-studio.sql  projects + revisions, forced owner RLS
  engine/
    install-engine.sh           build + start + self-test
    container/Dockerfile        pinned upstreams (see above)
    container/compose.yaml      own compose project, stack network, no host port, CPU/memory caps
    container/scene_engine_bridge.py  JSON lines over TCP; one job at a time; scrub after each
    scene_ops.py                the operations on one project
    sandbox_exec.py             the per-job seccomp + rlimit launcher
    mcp_client.py               the MCP client that drives godot-mcp and the Blender Lab MCP
    scripts/                    Godot and Blender helper scripts (glTF export, render, export, import)
  tests/                        see Test
```

Projects live under the shared workspace: `scene-studio/<owner-hash>/<projectId>/revisions/` (one
gzip file map per revision) and `…/artifacts/<revision>/` (preview and exports). The newest 40
revisions of a project are kept.

## Configuration (all optional)

| Variable | Default | Meaning |
|---|---|---|
| `SCENE_STUDIO_ENGINE_ADDR` | `scene-studio-engine:7414` | where the api dials the engine |
| `SCENE_STUDIO_DATA_DIR` | `<shared workspace>/scene-studio` | project storage |
| `SCENE_ENGINE_MEM_LIMIT` | `6g` | engine container memory cap (install time) |
| `SCENE_ENGINE_CPUS` | `6` | engine container CPU cap (install time) |

## Test

```sh
node --test "tests/*-*.test.js"                      # contracts, package tools, catalog bindings, transport, sandbox, audience view (store CI)
OSHAL_CORE_DIR=<oshal checkout> node --test tests/routes.core.test.js   # routes over loopback HTTP
OSHAL_CORE_DIR=<oshal checkout> node --test tests/tools.core.test.js    # tools, HTTP guard and catalog migration on the real core seam
OSHAL_CORE_DIR=<oshal checkout> node --test tests/store.pg.test.js      # store SQL on a disposable PostgreSQL (docker)
docker exec oshal-scene-studio-engine python3 /opt/scene-studio/engine/container/scene_engine_bridge.py --selftest
```

Every case is registered in [tests/test-lab.yaml](tests/test-lab.yaml) with its prerequisites.

## Models and requirements

For a caller whose brain is a CLI login (the operator's Antigravity), core runs the director on its
shared concierge node (`concierge-bot`, profile `concierge-node`) and stamps the turn with that
brain; other callers run it inline on their hosted lane. Godot and Blender do the
building; no image generation or other model call happens in this package.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **600 / 6400 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| scene-director-chat | director chat turn | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
