# Scene Studio (`scene-studio`) parity audit

## 1. What it is

`scene-studio` (0.2.4) builds Godot games and scenes and Blender models. It runs both engines in a sandboxed container and reaches them through `godot-mcp` and the Blender Lab MCP. Its screen is `tools/scene-studio.html` with `tools/scene-studio.js`. It is measured against the Blender and Godot desktop applications. On the mobile side, Blender has no official phone or tablet app today: the iPad work is on hold and an Android tablet version is reported for the first half of 2027. Godot has an early-access Android editor and a web editor with stated limits. Scene Studio has no modelling or scene-building surface for the hand. A person can only work in three text boxes: a file editor, a JSON box for one Godot tool, and a Python box for Blender.

**How to read the table.**

- "Text box" in the UX column marks a real control (`#file-text`, `#godot-args`, `#blender-code`) that does the job only if the person writes `.tscn` text, JSON or Blender Python. It counts as "both" under the audit's definition of a real control. Read it as weak: someone who does not write code has no way to do these things by hand. Those six rows say "text box" in the UX column. If a text box does not count as a hand tool, read them as concierge only.
- `requiresApproval` is false on the writing tools; they are bound to catalog roles instead (`authorization.yaml`).
- "Yes†" means general product knowledge not re-checked against a source in this audit.
- I read the code and did not run the engine.

## 2. Parity table

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| Create a project from a template | basic | Godot Android: Yes | Yes | `#new-project`, `#new-template` | `scene-create-project` | both |
| List and open projects | basic | Godot Android: Yes | Yes | Project list in `scene-studio.js` | `scene-list-projects`, `scene-get-project` | both |
| Rename a project | basic | Godot Android: Yes† | Yes† | `#rename-project` | none | UX only |
| Delete a project | basic | Godot Android: Yes† | Yes† | `#delete-project` | none (usage text leaves this to the person) | UX only |
| Upload an asset | basic | Godot Android: Yes | Yes | `#upload-file` | none | UX only |
| Edit a script or a scene file as text | basic | Godot Android: Yes (no external editors) | Yes | `#file-text`, `#save-file`, `#delete-file` (text box) | `scene-read-file`, `scene-write-file`, `scene-delete-file` | both |
| Add a node to a scene | basic | Godot Android: Yes | Yes | `#godot-tool`, `#godot-args` (text box, JSON) | `godot-add-node`, `godot-create-scene` | both |
| Change a node's properties | basic | Godot Android: Yes† | Yes | `#file-text`, by editing `.tscn` (text box) | `scene-write-file` | both |
| Sprites and mesh libraries | pro | Godot Android: Yes† | Yes | `#godot-tool` (text box, JSON) | `godot-load-sprite`, `godot-export-mesh-library` | both |
| Scene tree and property inspector you can click | basic | Godot Android: Yes (not phone-optimised) | Yes | none | none (the concierge has no need of a click; the tree is missing for people) | missing |
| Move, rotate, scale objects in a 3D view | basic | Godot Android: Yes† | Yes | none. The viewer only orbits (`/shared/ui/js/stl-viewer.js`) | none (a gesture; the concierge edits by text or Python) | missing |
| Run the game and read its output | basic | Godot Android: Yes; Godot web: no debugger | Yes | `#run-project`, `#run-seconds` (headless, prints and errors) | `godot-run-project` | both |
| Play the game in the page | basic | Godot Android: Yes | Yes | none. No export templates (`BACKLOG.md` B3) | none | missing |
| Debugger and breakpoints | pro | Godot web: No | Yes | none | none | missing |
| Export a playable build (web, Android, desktop) | pro | Godot Android: Yes; Godot web: No | Yes | none. Godot exports only `zip` of the source (`tool-contract.ts`) | none | missing |
| Run Blender Python | pro | Blender: no official mobile app | Yes | `#blender-code`, `#run-blender` (text box) | `blender-run-python`, `blender-file-summary` | both |
| Hand modelling (edit mesh, sculpt, modifiers panel) | basic | Blender: no official mobile app | Yes | none | none as a hand tool. `blender-run-python` can script it | missing |
| Materials and textures | basic | Blender: no official mobile app | Yes | `#blender-code` (text box); no node editor; viewer shows geometry without colour (`BACKLOG.md` B4) | `blender-run-python` | both |
| Keyframes and rigging | pro | Blender: no official mobile app | Yes | none. Python could in principle; not confirmed, and no test or timeline exists | none confirmed | missing |
| Render a still | basic | Blender: no official mobile app | Yes | `#render-preview`, `#preview-samples` (Cycles on CPU) | `scene-render-preview` | both |
| Render an animation to video | pro | Blender: no official mobile app | Yes | none. `blender_render.py` writes one PNG | none | missing |
| View the model in 3D | basic | Blender: no official mobile app | Yes | Orbit viewer in `scene-studio.js` | none (the concierge sees the rendered still only through its preview tool, not confirmed that it can read the image) | UX only |
| Bring a Blender model into a Godot project | pro | not confirmed | Yes (Godot imports glTF†) | `#import-from`, `#import-name`, `#import-model` | `scene-import-model` | both |
| Export models (glTF, FBX, OBJ, STL, zip) | basic | Blender: no official mobile app | Yes | `#export-format`, `#export-project`, `#download-file` | `scene-export` (default `.blend` only, `BACKLOG.md` B7) | both |
| History and restore | basic | Godot Android: Git via Termux | Yes† | History list, Restore buttons in `scene-studio.js` | `scene-restore-revision`, `scene-get-project` | both |

**The mobile and basic/pro picture.** `scene-studio.html` collapses to one column under 900 px, so the boxes fit a phone, but typing Python on a phone is not a basic tool. There is no basic level here. Everything needs code, or a request to the Director. This is the package furthest from the owner's rule in spirit, even though most rows read "both".

## 3. Backlog (ordered by what people hit first)

- **CREATE-TOOL-SCENE-STUDIO-01: Scene tree and inspector.** Done when: a Godot scene shows its nodes as a tree, clicking a node shows typed property fields, and saving a change produces a new revision, with the same read and write available to the concierge as a named operation instead of whole-file text.
- **CREATE-TOOL-SCENE-STUDIO-02: Move objects by hand in a 3D view.** Done when: a person selects an object in a colour 3D view (`BACKLOG.md` B4), drags a move, rotate or scale handle with mouse and touch, and the saved scene or `.blend` matches.
- **CREATE-TOOL-SCENE-STUDIO-03: Play the game in the page.** Done when: `BACKLOG.md` B3 ships, a person presses Play on the 3D template and controls it in the page, and a browser spec proves it loads. Playable web export follows from the same work.
- **CREATE-TOOL-SCENE-STUDIO-04: Basic modelling tools.** Done when: on a Blender project a person can add a primitive, set its size, colour and position, join and duplicate from named buttons with no code, and the concierge has the same named operations.
- **CREATE-TOOL-SCENE-STUDIO-05: Materials panel.** Done when: a person picks a colour and roughness for an object and the render and the colour view show it.
- **CREATE-TOOL-SCENE-STUDIO-06: Concierge parity on project actions.** Done when: tools exist for rename and asset upload, and the owner has confirmed in writing that delete stays person-only (or a held delete tool exists).
- **CREATE-TOOL-SCENE-STUDIO-07: The Director can finish its work on any .blend.** Done when: `BACKLOG.md` B7 is closed, so a second `.blend` can be rendered and exported by tool.
- **CREATE-TOOL-SCENE-STUDIO-08: Animate and render video.** Done when: a person and the Director can set keyframes on an object and render a short MP4, with a test measuring the frame count.
- **CREATE-TOOL-SCENE-STUDIO-09: Run on x86 and render on GPU.** Done when: `BACKLOG.md` B1 and B2 are closed, so the studio is usable on the machines customers actually have.
- **CREATE-TOOL-SCENE-STUDIO-10: Debugger output in the page.** Done when: a script error from Run links to its file and line and opens it in the file editor, with breakpoints left as a separate decision.

## 4. Sources

- Blender iPad on hold, Android first: https://www.macrumors.com/2026/02/27/blender-ipad-pro-app-development-halted/ and https://www.notebookcheck.net/Blender-temporarily-abandons-Apple-iPad-app-development-in-favor-of-Android.1236657.0.html
- Blender Android target and status: https://www.remio.ai/post/blender-android-app-is-coming-in-2027-while-the-ipad-version-stays-paused and https://9to5google.com/2026/09/30/blender-android-app-2027/
- Blender animation and rigging manual: https://docs.blender.org/manual/en/latest/animation/index.html
- Godot Android editor: https://docs.godotengine.org/en/stable/tutorials/editor/using_the_android_editor.html
- Godot web editor limits: https://docs.godotengine.org/en/stable/tutorials/editor/using_the_web_editor.html
- Godot web export: https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
