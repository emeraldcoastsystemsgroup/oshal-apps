# Scene Studio — backlog

Each entry has done-when criteria. An entry is open until its status line says otherwise; the
README and ARCHITECTURE describe only what is built.

## B1 — Build the engine on linux/amd64

The engine pins arm64 builds (the DGX Spark); `install-engine.sh` refuses other machines.

Done when: the Dockerfile selects Godot's `linux.x86_64` build and Blender's official
`linux-x64` release by `TARGETARCH`, each checked against its published digest; the installer
accepts amd64; and the engine self-test passes on an x86_64 Docker host.

## B2 — Render previews on the GPU

Previews render with Cycles on the CPU. The Spark's GB10 renders the same frames with OptiX in a
fraction of the time.

Done when: the engine container can be installed with the NVIDIA runtime (opt-in), the render
script selects OptiX or CUDA when a device is present and falls back to the CPU, the preview info
names the device, and a GPU render is proven pixel-comparable to the CPU one on the box.

## B3 — Playable builds of a Godot project

Godot export templates are not installed, so a project exports as source only.

Done when: pinned, digest-checked export templates are in the image, `scene-export` offers a web
(HTML5) build, the build is served from the project's artifacts and plays in the studio, and a
test proves a template project's build loads.

## B4 — A colour 3-D viewer in the studio

The orbit view uses the shared STL viewer (geometry only); colour comes from the rendered still.

Done when: the studio shows the preview glTF with its materials in an interactive viewer served
from this package (no third-party CDN), with a browser spec proving a coloured cube renders.

## B5 — Surface lifecycle browser spec

The studio fences replies to the selected project and polls while the director edits it; only the
route and audience-view suites cover the surface today.

Done when: a `tests/*.core.spec.mjs` drives the real page in Chromium against synthetic replies and
proves a late reply for another project never repaints the open one, a director's revision appears
without a reload, and restore and delete update the list.

## B6 — An authorization catalog, so a non-admin can use the studio

The package declares no ADR-149 catalog, so only application admins can open it (like CAD Studio).

Done when: `authorization.yaml` declares the studio's permissions (open, read projects, edit projects,
render and run, export) with a creator role, binds every route and tool to them, the manifest names it,
and a route suite proves a creator can build while a person without the role is refused.

Status: done in 0.2.0 — `authorization.yaml` (creator role); `tests/catalog-bindings.test.js` binds every
route, tool and the director; `tests/tools.core.test.js` proves a creator builds and a person without the
role is refused through the real core guard.

## B7 — The director can preview and export a non-default .blend

The routes accept a `file` argument for preview and export (src-routes/project-routes.ts), but the
`scene-render-preview` and `scene-export` package tools do not, so the director can edit another .blend
with `blender-run-python` and then cannot render or download it.

Done when: both tool specs in `src-routes/tool-input.ts` accept `file` and `src-routes/scene-tools.ts`
passes it to `renderPreview` / `exportProject`, and `tests/tools.core.test.js` renders and exports a
second .blend in a Blender project.
