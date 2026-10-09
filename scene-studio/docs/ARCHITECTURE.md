# Scene Studio — architecture

## 1. Projects and revisions

A project belongs to one person (`owner_sub`, forced row security on both tables). It is either a
**Godot** project (`project.godot`, scenes `.tscn`, scripts `.gd`, assets, and Godot's derived
`.godot/` import state) or a **Blender** project (`scene.blend` plus any files it uses).

The api owns the files. Each revision is one gzip-compressed **file map** (`[{path, data}]`, data
in base64) on the shared workspace, named `<revision>-<random>.json.gz` so that two writers racing
for the same revision number never overwrite each other. The `scene_revision` row records the
action (`create`, `write-file`, `upload`, `delete-file`, `godot:<tool>`, `blender:<tool>`,
`restore`, `import-model`), what changed, the file count and size, and the engine build that
produced it.

A change runs under the project's lock in the api process, starts from the latest revision, and
lands with one SQL statement that advances the project only from the revision the writer read.
If another write got there first, the change is answered `409` and its blob is removed; the
real-PostgreSQL suite proves exactly one of four concurrent commits lands. Restoring is putting an
earlier revision's files back as a new revision. The newest 40 revisions are kept; older ones go
with their artifacts.

Paths are validated identically on both sides (`routes/project-files.js` `validatePath`,
`engine/scene_ops.py` `validate_path`; a spec runs both): relative, forward slashes, no empty, `.`
or `..` segment, a conservative character set, at most 12 levels and 240 characters. Limits: 4,000
files, 48 MB per file, 64 MB per project; a text write is at most ~90 kB (the api's JSON body
limit), larger files are uploads (32 MB).

## 2. The engine

`oshal-scene-studio-engine` is the package's own container (BUILDING-EXTENSIONS §7): its own
compose project, the stack network under the alias `scene-studio-engine`, no host port,
read-only root, every capability dropped, `no-new-privileges`, a pids limit, and CPU and memory
caps (6 CPUs, 6 GB by default) so a render cannot crowd the rest of the box.

The bridge (`container/scene_engine_bridge.py`) speaks JSON lines over TCP. Its first line is a
hello naming the protocol and the build hash of the engine tree baked into the image; the api's
client (`routes/engine-client.js`) refuses a container built from a different tree with the
install command. Operations:

| op | does | changes the project |
|---|---|---|
| `capabilities` | versions, the allowlisted MCP tools as their servers describe them, limits, the sandbox probe | — |
| `new_project` | a Godot template written by the engine, or a `.blend` saved by Blender | creates it |
| `mcp_call` | one allowlisted tool of godot-mcp or the Blender Lab MCP | when the tool changed files |
| `godot_run` | godot-mcp `run_project`, wait, `get_debug_output`, `stop_project` | never |
| `preview` | Cycles still + glTF + STL of the scene | never |
| `export` | Godot zip; Blender glb / fbx / obj / stl / zip | never |
| `import_model` | Blender scene → glTF in the Godot project's `models/`, imported, optionally instanced | yes |

Each request materialises the file map in a fresh job directory, starts the upstream MCP server
(or Godot / Blender) through the sandbox launcher, injects the project location itself
(`projectPath` for godot-mcp, `blend_file` for the Blender Lab MCP — a caller supplying either is
refused), collects the regular files back without following a symlink, and answers with the delta.
Godot's importer runs first whenever an asset has no `.import` sidecar.

Which upstream tools run: godot-mcp `create_scene`, `add_node`, `load_sprite`,
`export_mesh_library`, `save_scene`, `get_uid`, `get_project_info` (not `launch_editor`, which
needs a display, nor `list_projects`, which browses the filesystem); the Blender Lab MCP's
`execute_blender_code_for_cli`, the five `get_blendfile_summary_*_for_cli` tools and its three
documentation tools (the docs ship inside the server, so they work without a network). Its
live-session tools (screenshots, jump-to, viewport renders) need a GUI Blender and are not offered.

`blender-run-python` saves by appending `save_as_mainfile(<the project's .blend>, compress=True)`
to the code unless `save` is false; the code's `result` dict comes back as the reply.

## 3. Isolation of code people write

GDScript a project runs and Python Blender executes are code a person — or their concierge — wrote.
The container is on the stack network (that is how the api reaches it), so the jobs, not the
container, are what must be cut off.

- **No network.** `sandbox_exec.py` installs a seccomp filter before exec'ing any job: `socket()`
  is allowed for `AF_UNIX` only (everything else gets `EACCES`); io_uring (which can create sockets
  without `socket()`), `ptrace`, `process_vm_readv/writev` and `pidfd_getfd` get `EPERM`; a system
  call from a foreign ABI kills the job. The kernel keeps the filter across `fork` and `exec`, and
  the job cannot remove it. A launcher that cannot install it refuses to run the job (exit 126).
  The bridge proves the filter at start (a probe through the real launcher) and refuses to serve if
  a sandboxed job could open an IP socket.
- **Resource limits** the job cannot raise: no core files, a CPU-time budget, a 256 MB largest
  file, an open-file count; plus a wall-clock timeout per operation in the bridge.
- **One job at a time**, each in a throwaway directory with its own `HOME` and `TMPDIR`, and an
  environment that contains nothing from the bridge's.
- **A scrub after every job** (inside the container only): every process except PID 1, the bridge
  and anything entered from outside with `docker exec` (parent 0 in the PID namespace, which no job
  can arrange) is killed — including a daemon that put itself in a new session — and `/tmp` and
  `/dev/shm` are emptied. A process that will not die makes the bridge exit so the container
  restarts clean.
- **No secrets in the container.** The engine has no database credentials, tokens or service
  secret; the request in flight is the only person's data present.

What remains: a job shares the bridge's uid, so it can kill the bridge (the container restarts and
the api reconnects; the only request lost is the job's own) and can occupy the engine until its
timeout. Proof: `tests/engine-sandbox.test.js` (the launcher, the filter shape, the scrub's victim
selection), the engine self-test (user code inside Blender cannot connect to the bridge's own
port), and a live check run on the box (a planted daemon and files outside the job directory were
gone after the job; reaching PostgreSQL by name failed at name resolution).

## 4. Previews

Headless Godot uses a dummy renderer: it can build and run a project, but not draw it. A Godot
preview is therefore: Godot exports the scene to glTF (`scripts/godot_export_glb.gd`, GLTFDocument
— meshes, materials, lights and the camera survive), Blender imports it and renders it
(`scripts/blender_render.py`). A Blender preview renders the `.blend` directly.

The render uses the scene's camera, or a temporary camera framed on every mesh; a temporary sun
when nothing emits light; Cycles on the CPU with OpenImageDenoise. The same run writes glTF and, up
to 400,000 polygons, an STL that the studio shows in the shared OSHAL STL orbit viewer.

## 5. How the swarm drives it

The director (`chatBot: scene-studio-director`) declares no node of its own. For a caller whose
brain is a CLI login, core dispatches it to the shared concierge node (`concierge-bot`, profile
`concierge-node`); other callers run it inline on their hosted lane. Its turns are protected direct turns: the catalog binds the bot
to `scene.run`, and a turn calls only the brokered package tools below.

The 22 tools are in-process package tools (`executor: { executorType: builtin, builtinKey: package }`,
`src-routes/scene-tools.ts`). The route entry registers them with the kernel while the package
activates, together with the `scene` resource adapter of the ADR-149 catalog (`authorization.yaml`).
A call runs in the api under the caller's verified actor, never an identity from its input, and calls
the same services the studio's routes call with the actor's sub as the owner key, so a tool and the
studio see the same projects. The kernel checks the tool's catalog binding before and after the
handler and runs it under the caller's database identity, so forced row security applies.

- **Closed inputs.** Each tool accepts only its declared keys (`src-routes/tool-input.ts`): `userSub`,
  `tenantId`, `projectPath`, `blend_file` and any other undeclared key are refused before a query or an
  engine request.
- **A 285 s deadline** per call, inside the node bridge's 300 s fetch ceiling. On expiry the call is
  refused `tool_deadline_exceeded`; the engine may still finish, and a change it finishes lands as a
  revision.
- **A 192 KiB reply budget** (the kernel refuses a result over 256 KiB, and only after the work ran):
  file and project lists are trimmed from the end with honest counts, a file read returns at most
  96 kB of text, each delta list shows 50 paths with the full counts, the tool text is cut at 6,000
  characters, and a refusal carries the route's code, field and reason.
- **Read-only tools** (capabilities, list, get, read a file, get a UID, project info, file summary,
  docs) are the only ones Jarvis may propose without asking; every write, run and export is an ask.
- **The node's tools bridge** runs a tool only when the director's grant for it is AUTO **and
  installed**. The persona's `authorizations:` seed AUTO grants but never mark them installed; an
  operator does that once for all 22 with `PUT /api/agents/117640d5-e8a6-4a54-b8f4-c6c926172b88/tools/groups/scene-studio`
  and the body `{"groupName":"scene-studio","authMode":"auto"}`. Inline turns check only the AUTO grant.

Files travel only between the api and the engine.

## 6. What it does not do

- No GPU rendering: the engine renders on the CPU (BACKLOG B2).
- No game builds: Godot export templates are not installed, so a project is exported as source
  (BACKLOG B3).
- No windowed editor: Godot runs headless and Blender in the background. Download the project or
  the `.blend` to open it in a desktop editor.
- linux/arm64 only (BACKLOG B1).
- No network inside jobs, by design: no online asset libraries.
