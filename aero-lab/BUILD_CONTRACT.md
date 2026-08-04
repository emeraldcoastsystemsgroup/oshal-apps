# aero-lab — BUILD CONTRACT (read this whole file before writing a line)

Mission: package the validated aerosim persistent-flight simulator as a real OSHAL store app.
A person designs a craft on the Aero Lab cockpit surface (span / area / AR / battery / cells /
buoyancy fraction / site / season), runs it through the REAL engine — polar, 24 h energy
limit-cycle, admissibility screen — sees real plots (SOC trace, polar curve, drag buildup,
margin verdict), and downloads the build package (STL / DXF / BOM).

This contract is the single source of truth for the four build agents. Every pattern below was
lifted from a shipped package in this repo (`sat-ops/`, `drone/`, `hello-oshal/`, `eats/`) or
from `BUILDING-EXTENSIONS.md` / the intelligent-sales `UI-CONVENTIONS.md`. **Copy the snippets;
do not invent parallel patterns.** Where this file pins a wire shape (route JSON, worker
protocol, design-vector field names), that shape is frozen — agents build to it in parallel
without waiting on each other.

---

## 0. Ground rules (all agents)

- Everything lands under `c:/Projects/oshal-apps/aero-lab/` only. Never touch another
  package, never touch `c:/Projects/oshal` core, never edit the shared `marketplace.json`
  (agent D writes `aero-lab/marketplace.patch` instead — another team's dirty tree is live).
- **No commits, no pushes.** Working tree only.
- **NO MOCKS.** If the engine is absent/broken/missing a module, routes return an honest
  `503 { error, code: 'capability_unavailable', reason }` — never fabricated numbers.
- 1000 code-line hard cap per file (comments/blanks don't count; `.html`/`.md` exempt).
  Decompose from the start; functions under 50 lines.
- Structured logging only: `createChildLogger({ module: '...' })` from `@/shared/logger`.
  Never `console.log` in route code. Every catch logs at error with the stack. (The Python
  worker logs to **stderr** — stdout is the protocol channel.)
- Change Log header on every `.ts` / `.js` / `.py` / `.sh` file. This store's observed format
  (copy from `sat-ops/routes/sat-routes.js`), AUTHOR per the mission directive:

```
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-02 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — aero-lab <what+why>
 */
```

- Every exported member gets JSDoc (`@description`, `@param`, `@returns`) explaining *why*.
- Validate before handing over: `node c:/Projects/oshal/scripts/oshal-app.js validate aero-lab`
  must exit clean (routes-not-compiled is a warning, everything else must pass).

### The engine being packaged

Lives at (scratchpad, session `a6f28b94-...`):

```
C:/Users/you/AppData/Local/Temp/claude/c--Projects-oshal/a6f28b94-bbf2-435a-9f7c-b5755938e4c5/scratchpad/aerosim
```

Python 3.11 venv at `<engineDir>/.venv/Scripts/python.exe`. Survived a 5-round adversarial
campaign; formally trustworthy. Stable entry points:

| entry point | signature (verified in tree 2026-08-02) | what |
|---|---|---|
| `aerosim.validate_designs.build_solar_cruise(design, ...)` | `(_SolarCruiseDesign, pv_efficiency_scale=1.0, pack_specific_energy_scale=1.0, extra_CD0_scale=1.0, pv_packing_override=None, soc_max=1.0, eta_charge=0.95, thruster_figure_of_merit=None) -> _Build` | design vector → vehicle (mass-closed, every element billed) |
| `aerosim.integrate.integrate_energy(vehicle, env, t0_s, t_end_s, dt_s=60.0)` | `-> SimResult` | quasi-steady trim + RK4 energy loop (limit-cycle closure) |
| `aerosim.validate_screen.screen_design(build, result, check_seasonal=True)` | `-> (bool, list[str])` | admissibility: (admissible, reasons). Empty reasons = admissible |
| `aerosim.aeropolar.wing_polar(span_m, area_m2, taper_ratio, sweep_deg, twist_root_deg, twist_tip_deg, kulfan_upper, kulfan_lower, leading_edge_weight, TE_thickness, alpha_deg, V_ms, rho_kgm3, mu_Pas, n_crit=11.0, ...)` | polar dict | geometry → polar |

**A reality-upgrade workflow is CONCURRENTLY editing that tree** (new modules: `electrochem`,
`electrical`, `propeller`/`prop`, `materials`, `mission`). The adapter must FEATURE-DETECT and
fail gracefully (capability flags), never hard-depend on in-flight code. The engine's own
`FP_01_snapshot.py` shows the sanctioned pattern — import-with-retry (5 attempts, 120 s waits)
and BelowNormal process priority:

```python
import ctypes
ctypes.windll.kernel32.SetPriorityClass(
    ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL  (Windows only; guard with sys.platform)
```

The FINAL_PRODUCT generation pattern (what `export` reproduces) is `FP_01..FP_06_*.py` →
`FINAL_PRODUCT/`: `design_snapshot.json`, `wing.stl`, `wing_panel_left.stl`,
`wing_panel_right.stl`, `ribs.dxf`, `airfoil.dat`, `airfoil_template.dxf`, `hull_gore.dxf`,
`hull_gore.svg`, `three_view.svg`, `BOM.csv`, `BUILD_SHEET.md`, `index.html`, `verify_*.json`.

---

## 1. `oshal-app.yaml` — the exact manifest (agent D owns the file)

The store's field shape, adapted from `sat-ops/oshal-app.yaml` (this app's closest sibling —
`suite: ai-engineering`, inline concierge, route-backed tools, one ribbon tile, focus-mode
ribbon). Copy this verbatim into `aero-lab/oshal-app.yaml` (D may tighten prose, not shape):

```yaml
# ─────────────────────────────────────────────────────────────────────────────
# OSHAL app package — aero-lab ("Aero Lab")
# Packages the validated aerosim persistent-flight simulator (5-round adversarial
# campaign) as a design cockpit: a person shapes a solar-endurance craft
# (span/area/AR/battery/cells/buoyancy/site/season), runs it through the REAL
# engine — wing polar, 24 h energy limit-cycle, admissibility screen — and
# downloads the build package (STL/DXF/BOM).
#
# The ENGINE is external and authoritative (NASA-42-adapter philosophy, but
# subprocess-stdio, not TCP): a Python 3.11 worker under engine/, spawned by the
# packaged route from AERO_LAB_ENGINE_DIR. Modules still being upgraded by a
# concurrent workflow are FEATURE-DETECTED and surfaced as capability flags —
# a missing capability returns an honest 503, never fake data.
# Framework: OSHAL (see docs/adr/085-remote-app-packages-and-registries.md)
# ─────────────────────────────────────────────────────────────────────────────

name: aero-lab
suite: ai-engineering   # ADR-097: primary catalog shelf — exactly one
displayName: Aero Lab
description: >-
  Persistent-flight design lab — shape a solar-endurance aircraft with real
  sliders (span, area, aspect ratio, battery, cells, buoyancy fraction, site,
  season), run it through the validated aerosim engine (wing polar, 24 h energy
  limit cycle, admissibility screen), read the verdict with real plots (SOC
  trace, polar, drag buildup, margins), and download the build package
  (STL / DXF / BOM). A design concierge turns plain language into a design
  vector; the deterministic engine is the only source of numbers.
version: 1.0.0
status: active

source:
  type: git-subdir
  url: https://github.com/emeraldcoastsystemsgroup/oshal-apps
  path: aero-lab
  ref: main

# No connectors: the engine is local; nothing leaves the box.
dependencies:
  apps: []
  tools: []
  connectors: []

# ─────────────────────────────────────────────────────────────────────────────
# BOTS — the design brain (Form B inline concierge — drafts design vectors only,
# never runs the engine itself; the deterministic routes run the engine).
# ─────────────────────────────────────────────────────────────────────────────
bots:
  - agentId: b0ae0000-0000-0000-0000-000000000001
    name: aero-designer
    persona: personas/aero-designer.yaml
    role: engineering/aero-design-drafting
    capabilities:
      - aero-design-drafting
      - design-vector-translation
      - energy-margin-briefing
      - admissibility-awareness

tools:
  - name: aero-capabilities
    displayName: Aero Lab Capabilities
    type: api
    category: engineering
    description: Report the aerosim engine's availability and per-module capability flags (polar, evaluate, screen, mission, export, hybrid buoyancy).
    executor: { executorType: api, apiEndpoint: "GET /api/aero-lab/capabilities" }
    defaultAuthMode: auto
    requiresApproval: false
    usageInstructions: >-
      Read-only. Call FIRST. A capability reported false means that command will return 503 —
      say so; never estimate numbers the engine cannot produce.
    routingTags: [aero, engine, capabilities]
    tags: [aero-lab, route-backed]

  - name: aero-polar
    displayName: Wing Polar
    type: api
    category: engineering
    description: Compute the real wing polar (CL/CD vs alpha, drag buildup) for a design vector via the aerosim engine.
    executor: { executorType: api, apiEndpoint: "POST /api/aero-lab/polar" }
    defaultAuthMode: auto
    requiresApproval: false
    inputSchema:
      type: object
      properties:
        design: { type: object }
      required: [design]
    usageInstructions: >-
      Deterministic engine call. Use the returned polar as the only source of aerodynamic numbers.
    routingTags: [aero, polar, aerodynamics]
    tags: [aero-lab, route-backed]

  - name: aero-evaluate
    displayName: Evaluate Design (24 h energy loop)
    type: api
    category: engineering
    description: Build the vehicle from a design vector and fly the 24 h energy limit cycle — SOC trace, min SOC, drag buildup, mass closure, margins.
    executor: { executorType: api, apiEndpoint: "POST /api/aero-lab/evaluate" }
    defaultAuthMode: auto
    requiresApproval: false
    inputSchema:
      type: object
      properties:
        design: { type: object }
      required: [design]
    usageInstructions: >-
      The authoritative verdict on a design. Slow (up to minutes). Never paraphrase numbers —
      quote them from the response.
    routingTags: [aero, energy, evaluate, endurance]
    tags: [aero-lab, route-backed]

  - name: aero-screen
    displayName: Admissibility Screen
    type: api
    category: engineering
    description: Run the sweep-contract admissibility screen on a design — returns admissible plus the exact reasons when not.
    executor: { executorType: api, apiEndpoint: "POST /api/aero-lab/screen" }
    defaultAuthMode: auto
    requiresApproval: false
    inputSchema:
      type: object
      properties:
        design: { type: object }
      required: [design]
    usageInstructions: >-
      Reasons come verbatim from the engine's screen — surface them unedited.
    routingTags: [aero, screen, admissibility]
    tags: [aero-lab, route-backed]

  - name: aero-export
    displayName: Export Build Package
    type: api
    category: engineering
    description: Generate the physical build package for a design — STL wing panels, DXF ribs/gores, airfoil dat, BOM, build sheet.
    executor: { executorType: api, apiEndpoint: "POST /api/aero-lab/export" }
    defaultAuthMode: auto
    requiresApproval: false
    inputSchema:
      type: object
      properties:
        design: { type: object }
      required: [design]
    usageInstructions: >-
      Returns an export id + file list; files download individually from the export routes.
    routingTags: [aero, export, stl, bom]
    tags: [aero-lab, route-backed]

  - name: draft-aero-design
    displayName: Draft Aero Design
    type: api
    category: engineering
    description: Ask the aero-designer concierge to turn a plain-language craft request into a design vector draft. Drafts are pre-filled into the sliders; the human runs the engine.
    executor: { executorType: api, apiEndpoint: "POST /api/aero-lab/chat" }
    defaultAuthMode: auto
    requiresApproval: false
    inputSchema:
      type: object
      properties:
        message: { type: string }
      required: [message]
    usageInstructions: >-
      Call with {message}. The reply contains say-text and an optional validated design draft;
      running the engine on it is a separate explicit step.
    routingTags: [aero, design, concierge, drafting]
    tags: [aero-lab, route-backed]

# ─────────────────────────────────────────────────────────────────────────────
# COCKPIT UI SURFACE — one ribbon icon opens the Aero Lab, self-served by this
# package's route from tools/aero-lab.html (ctx.appPackageDir).
# ─────────────────────────────────────────────────────────────────────────────
ui:
  static:
    - toolName: aero-lab
      label: Aero Lab
      icon: codicon codicon-symbol-structure
      iframeUrl: /api/aero-lab/app
      section: top

routes:
  - module: routes/aero-lab-routes.js
    factory: createAeroLabRoutes
    mountPath: /api/aero-lab
    requiresAuth: true
    requiresContext: true

# No migrations: evaluations are computed on demand; exports live in a per-run
# temp dir under the package workdir. This surface owns no tables (sat-ops precedent).

# RIBBON VISIBILITY — focus mode for /cockpit?app=aero-lab
ribbon:
  hideFrameworkItems:
    - tickets
    - chat
    - calendar
    - addressbook
    - dashboard
    - echo
    - logs
    - operations
  hideChatPanel: true
  defaultView: aero-lab
```

Notes pinned by this contract:

- `agentId: b0ae0000-0000-0000-0000-000000000001` — verified unique against every
  `oshal-app.yaml` in this store (2026-08-02). Never re-mint.
- `requiresAuth: true` (the loader's default, declared explicitly). There is no service-secret
  rail here — aero-lab has no swarm nodes heartbeating in, so plain OIDC gating is the whole
  story. Do NOT copy sat-ops' `auth: service-or-oidc` line; that exists for node heartbeats.
- No `migrations:`, no `ticketType:`/`workflow:`, no `schedules:` (recurring jobs cost money —
  declare none).

---

## 2. Route registration — how a package's routes mount (agent B owns)

**Files:** TS source in `src-routes/`, compiled CommonJS in `routes/` (the loader `require()`s
the JS; the TS is what tests import). This is the drone/sat-ops layout:

```
aero-lab/
  src-routes/aero-lab-routes.ts     # source of truth
  src-routes/engine-adapter.ts      # the Python-worker adapter (section 5)
  routes/aero-lab-routes.js         # compiled CJS — what the manifest names
  routes/engine-adapter.js          # compiled CJS
```

Compile from the core checkout so `@/` aliases type-check, leaving them intact in the output
(the loader resolves `@/` at runtime — BUILDING-EXTENSIONS §5):

```bash
cd c:/Projects/oshal && npx tsc --module commonjs --target ES2022 --esModuleInterop \
  --moduleResolution node --skipLibCheck --outDir c:/Projects/oshal-apps/aero-lab/routes \
  c:/Projects/oshal-apps/aero-lab/src-routes/*.ts
```

(Then verify `routes/*.js` still `require("@/shared/logger")` — never rewritten relative.)

**The factory shape** — accept EITHER an opts wrapper OR a bare AppContext. This is verbatim
from `sat-ops/routes/sat-routes.js` (the manifest-route-mounter passes the bare context when
`requiresContext: true`; specs pass `{ ctx, adapter }`):

```ts
export function createAeroLabRoutes(arg: CreateOpts | AppContext = {}): Router {
  const isOpts = arg !== null && typeof arg === 'object' && ('adapter' in arg || 'ctx' in arg);
  const opts: CreateOpts = isOpts ? (arg as CreateOpts) : { ctx: arg as AppContext };
  const adapter = opts.adapter ?? new AeroEngineAdapter();   // injectable for tests
  const appPackageDir = (opts.ctx as any)?.appPackageDir as string | undefined;
  const router = Router();
  // ...
  return router;
}
```

**Serving the bundled surface** — verbatim pattern from `sat-routes.js` (capture the package
dir at FACTORY time; `process.env.OSHAL_APP_PACKAGE_DIR` is a LOAD-time-only fallback, reading
it per-request is a bug — BUILDING-EXTENSIONS "Bundled asset paths"):

```ts
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

function surfaceHtml(appPackageDir: string | undefined, fileName: string): string {
  const candidates = [
    appPackageDir ? path.join(appPackageDir, 'tools', fileName) : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools', fileName) : '',
    path.resolve(__dirname, '../tools', fileName),   // running routes/ next to src-routes/ (tests)
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || candidates[candidates.length - 1];
}

function serveFile(filePath: string) {
  return (_req: Request, res: Response) => {
    res.sendFile(filePath, (err) => {
      if (err) { logger.error({ err, filePath }, 'Failed to serve surface file'); res.status(404).send('Page not found'); }
    });
  };
}

router.get('/app', serveFile(surfaceHtml(appPackageDir, 'aero-lab.html')));
router.get('/app.js', serveFile(surfaceHtml(appPackageDir, 'aero-lab.js')));  // if C splits JS out
```

**Framework imports** stay as `@/…` aliases (`createChildLogger` from `@/shared/logger`,
`AppContext` type from `@/app/composition/app-context`). Nothing else from core is needed —
this app has no DB tables and no service-secret rail.

**Auth:** the manifest's `requiresAuth: true` wraps the whole mount — the route file itself
does not re-implement auth. Any route exposing engine output or spawning the worker MUST live
under this mount (they all do). Never add a second, unauthenticated mount.

### 2a. The route API (FROZEN — agent C builds the surface against exactly this)

All request bodies `application/json`. All errors: `{ error: string }` plus, for engine
capability failures, `{ code: 'capability_unavailable', reason: string }`.

| route | request | success response |
|---|---|---|
| `GET /api/aero-lab/app` | — | the surface HTML |
| `GET /api/aero-lab/capabilities` | — | `{ engine: { present: bool, engineDir: string, python: string, venvOk: bool, version: string\|null }, capabilities: { polar: bool, evaluate: bool, screen: bool, mission: bool, export: bool, hybrid: bool, modules: { electrical: bool, prop: bool, mission: bool, materials: bool, electrochem: bool } } }` |
| `POST /api/aero-lab/polar` | `{ design }` | `{ polar: { alpha_deg: number[], CL: number[], CD: number[], LD: number[] }, cruise: { V_ms, CL, Re }\|null, dragBuildup: { label: string, CD: number }[] }` |
| `POST /api/aero-lab/evaluate` | `{ design }` | `{ build: { massBreakdown: { label, kg }[], massAllUpKg, spanM, areaM2, packWh }, energy: { t_s: number[], soc: number[], p_gen_W: number[], p_load_W: number[], minSoc, usable }, closed: bool, verdict: { admissible: bool, reasons: string[] } }` |
| `POST /api/aero-lab/screen` | `{ design }` | `{ admissible: bool, reasons: string[] }` |
| `POST /api/aero-lab/mission` | `{ design, days?: number }` | capability-gated (503 until the in-flight mission module lands); success shape mirrors evaluate with a multi-day `energy` block + `missionReport` passthrough |
| `POST /api/aero-lab/export` | `{ design }` | `{ exportId: string, files: string[] }` |
| `GET /api/aero-lab/export/:exportId/:file` | — | streams the file (Content-Disposition attachment). `:file` MUST be validated against the export's recorded file list — never path-joined raw |
| `POST /api/aero-lab/chat` | `{ message, history?: [{role,content}] }` | `{ say: string, draft: <design vector>\|null }` |

**Status-code mapping** (mirror `sat-routes.js` `orbitError`):

- `400` — malformed body / design-vector validation error (bad field, out of engine bounds).
- `422` — engine ran but the design is un-buildable (mass won't close, trim fails). Body carries
  the engine's reason verbatim.
- `503` + `code: 'capability_unavailable'` — engine dir missing, venv missing, module absent,
  worker won't start, or orchestrator missing (chat). Include `reason`.
- `504` — worker exceeded the command's timeout (section 5). The worker is killed and restarted.
- `500` — everything else; log with stack.

**The design vector (FROZEN wire shape)** — field names are the engine's own proven sweep
vector (`R7_winner_vector.json` "v" block), which map 1:1 onto `_SolarCruiseDesign`:

```json
{
  "area_m2": 0.9, "aspect_ratio": 12.0, "taper_ratio": 0.57,
  "twist_root_deg": 2.0, "twist_tip_deg": -0.93, "extra_CD0": 0.0059,
  "battery_mass_kg": 2.04, "pack_Wh_per_kg": 441.8,
  "cell_eff": 0.29, "pv_density": 0.296, "pv_packing": 0.9,
  "prop_max_W": 2102.7, "prop_diameter_m": 0.498,
  "payload_W": 4.57, "payload_mass_kg": 0.244,
  "altitude_m": 163.7, "latitude_deg": -10.4, "day_of_year": 90,
  "fus_over_floor": 1.01,
  "buoyancy_fraction": 0.0
}
```

- The UI's "span / AR" sliders express `area_m2` + `aspect_ratio` (span is derived:
  `span = sqrt(AR * area)` — display it, don't send it).
- "site / season" = `latitude_deg` + `day_of_year` (surface offers named presets that fill
  these numbers; the wire carries only the numbers).
- `buoyancy_fraction` > 0 requires the `hybrid` capability flag (the HYBRID_* path);
  when `hybrid` is false the route 503s any design with `buoyancy_fraction > 0` rather than
  silently dropping the field.
- Agent A owns the mapping from these names to `_SolarCruiseDesign` kwargs inside the worker
  (e.g. `cell_eff` → `pv_efficiency`, `pv_density` → `pv_areal_density_kg_m2`, mass_all_up
  closure). Agents B/C treat the vector as opaque except for slider bounds.
- Routes validate: every field present-or-defaulted, finite, and inside the engine's published
  bounds (worker's `capabilities` response carries `bounds` — see §5) before spawning work.

### 2b. The concierge `/chat` route (agent B) — sat-ops pattern verbatim

Copy the shape of `sat-routes.js` `POST /chat` exactly:

- `503 { error: 'aero-designer concierge is not wired on this deployment' }` when
  `opts.ctx?.orchestrator` is missing.
- `orchestrator.processMessage(\`aero-${sub}-${started}\`, prompt, { agenticMode: true,
  autoApprove: false, source: 'aero-lab', agentId: AERO_DESIGNER_AGENT_ID, userSub: sub })`
  with `const sub = String(req.oidc?.user?.sub || 'operator')`.
- Prompt = persona-shaped strict-JSON contract (say + draft), plus the LIVE capability flags
  line (so the bot never drafts a hybrid when `hybrid: false`) and the last 8 history turns.
- Parse with a `raw.match(/\{[\s\S]*\}/)` envelope parser that DEGRADES to say-only on any
  malformed draft — a bad draft must never reach the sliders. Validate every numeric field
  finite + inside bounds; clamp nothing — reject the draft instead.
- Empty model output → `env.say = "I couldn't reach the design brain just now — try again in a moment."`

---

## 3. Surface conventions — `tools/` (agent C owns)

**Files:** `tools/aero-lab.html` (+ `tools/aero-lab.js` if the script half would push the HTML
past taste; both are served by agent B's `/app` + `/app.js` routes — reference it as
`<script src="/api/aero-lab/app.js"></script>`, NOT a relative path).

### 3a. Theme wiring (the 2026-07-14 operator standard — non-negotiable)

Head of the file, exactly this order (own CSS LAST so local overrides win):

```html
<!DOCTYPE html>
<html lang="en" data-theme="midnight">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aero Lab — Persistent-Flight Design</title>
<link rel="stylesheet" href="/shared/ui/css/surface-themes.css" />
<script src="/shared/ui/js/surface-theme.js"></script>
<style>
  /* Self-contained surface theme (embedded-surface rule: own your CSS). */
  :root {
    --bg:     var(--bg-primary, #06080f);
    --panel:  var(--bg-card, #0c1120);
    --panel2: var(--bg-tertiary, #101730);
    --line:   var(--border-color, #1c2745);
    --text:   var(--text-primary, #d7e0f4);
    --dim:    var(--text-secondary, #7c89a8);
    --accent: var(--accent-primary, #5aa7ff);
    --ok:     var(--status-success, #38d39f);
    --warn:   var(--status-warning, #ffc857);
    --bad:    var(--status-error, #ff6b6b);
    font-size: 14px;
  }
  ...
</style>
```

(That token block is verbatim from `sat-ops/tools/sat-ops.html` — the shipped precedent.)

Rules, each one a shipped defect somewhere (intelligent-sales `UI-CONVENTIONS.md`):

- **Derive, never hardcode.** Every colour is `var(--framework-token, #fallback)`. Semantic
  accents (chart series colours, the admissible-green, SOC-trace line) may stay literal.
- **`--bg-card` is deliberately TRANSLUCENT** (midnight: `rgba(28,28,48,.55)` — glass over the
  page). Anything that covers other content (modals, slide-overs, sticky headers, toasts,
  tooltips over a plot) must be opaque: paint the themed colour over the opaque page colour —
  `background: var(--bg) linear-gradient(var(--panel), var(--panel));` — never a solid hex.
- **SVG/canvas plot labels:** `fill="#e6e8ee"` is a hardcoded palette in hiding. Use
  `style="fill:var(--text)"` (the `fill` presentation attribute does not resolve custom
  properties). Canvas: read the token once per render via
  `getComputedStyle(document.documentElement).getPropertyValue('--text')`.
- **Layout lives in the stylesheet, never inline in JS.** Inline styles only for non-layout
  cosmetics (a status colour computed from data). One `@media (max-width: 760px)` block —
  append to it, never open a second.
- **390 px phone pass:** one column, no horizontal page scroll; a wide thing (the polar plot,
  the mass table) scrolls inside its own container.
- **No `window.prompt`/`alert` as input controls.** `confirm()` acceptable only for a pure
  destructive yes/no (nothing here is destructive — so: none).
- **Scrollbars:** one declaration on `html, body` — `scrollbar-width: thin; scrollbar-color:
  color-mix(in srgb, var(--dim) 45%, transparent) transparent;` + the `::-webkit-scrollbar`
  block for older Chromium.
- **Raw enum keys never render.** `capability_unavailable` is storage; the surface says
  "Engine module not available yet: <reason>".

### 3b. Ribbon registration

The surface registers on the ribbon ONLY via the manifest (`ui.static` → one tile, iframe to
`/api/aero-lab/app`) — section 1. The HTML itself does nothing to register; there is no
postMessage handshake to write. Focus mode comes from the manifest `ribbon:` block.

### 3c. What the surface actually is (build to the frozen API in §2a)

Left rail — the design sliders (bounds fetched from `GET /capabilities` → `bounds`; disable
the buoyancy slider + show why when `hybrid: false`), site/season presets, Draft-with-AI chat
box (POST `/chat`, applies a returned draft to the sliders — never auto-runs). Center — plots:
polar curve (CL/CD/L-over-D vs α), 24 h SOC trace with the min-SOC line, drag-buildup bar,
mass-closure bar. Right rail — the verdict card (admissible + verbatim reasons; `closed`;
min SOC; usable margin) and the Export panel (POST `/export` → list files → per-file download
links to `GET /export/:exportId/:file`). Every long call shows a progress state and surfaces
the engine's honest 4xx/5xx error text. First paint calls `/capabilities` and renders the
capability flags as chips (present = quiet, absent = amber with reason on hover) — the
in-flight-modules honesty is a FEATURE of the surface, not a footnote.

Plots are hand-rolled SVG (sat-ops precedent — it draws its 3D/section views in raw canvas/SVG
with zero external libs). **No CDN scripts** — the cockpit is self-contained; a `<script src>`
to the internet is a defect.

---

## 4. Persona — `personas/aero-designer.yaml` (agent D owns)

Copy the sat-operator shape (`sat-ops/personas/sat-operator.yaml`) exactly — name / role /
agent_id / personality / perspective / quality_gate. Full template to adapt:

```yaml
# ═══════════════════════════════════════════════════════════════════════════
# AERO DESIGNER — design-vector drafting for the Aero Lab (aerosim engine)
# ═══════════════════════════════════════════════════════════════════════════
# The reasoning brain of the Aero Lab app. Form B inline concierge: it DRAFTS
# design vectors (span/area/AR/battery/cells/buoyancy/site/season) from natural
# language. It NEVER computes aerodynamic or energy numbers itself — every
# number a user sees comes from the deterministic aerosim engine via the
# routes, and every draft it emits is validated by the route and pre-filled
# into the sliders; the human presses Run.
#
# CHANGE LOG
# ---------------------------------------------------------------------------
# 2026-08-02   | maintainer@emeraldcoastsystemsgroup.com  | Initial creation
# ═══════════════════════════════════════════════════════════════════════════

name: aero-designer
role: Persistent-Flight Design Concierge
agent_id: b0ae0000-0000-0000-0000-000000000001

personality:
  tone: calm, precise, design-review brief
  style: short engineering replies; states the draft rationale, then at most one question
  focus: turning intent ("a hand-launchable craft that survives a Seattle winter night")
    into an admissible design vector draft

perspective: |
  You are the **Aero Designer** — the design-drafting brain of the Aero Lab. The user
  describes the craft they want; you produce a design-vector DRAFT. You never compute
  performance numbers: the validated aerosim engine is the only source of polars, SOC
  traces, and verdicts, and your drafts only reach it after the human presses Run.
  Never claim a design works — say the engine will judge it.

  ## Inputs you receive each turn
  The ENGINE CAPABILITIES line (which commands and modules are live — never draft
  buoyancy_fraction > 0 unless hybrid is true), the SLIDER BOUNDS, the user's current
  design vector, and the user's message.

  ## The design space you are driving (know it cold)
  - The vector fields and their meaning: area_m2, aspect_ratio (span derives), taper_ratio,
    twists, extra_CD0, battery_mass_kg, pack_Wh_per_kg, cell_eff, pv_density, pv_packing,
    prop_max_W, prop_diameter_m, payload_W, payload_mass_kg, altitude_m, latitude_deg,
    day_of_year, fus_over_floor, buoyancy_fraction.
  - Winter high latitude is the hard case: short days punish low pack energy and low
    cell_eff; suggest season/site honestly rather than moving the site to make a design pass.
  - Battery capacity is DERIVED from battery_mass_kg × pack_Wh_per_kg — never state Wh
    independently.
  - Admissibility is the engine's screen; when a run comes back inadmissible, read the
    reasons verbatim and draft a targeted change, one lever at a time.

  ## Output contract — STRICT
  Reply with ONLY a JSON object, nothing around it:
  { "say": "your reply", "draft": { "area_m2": 0.9, "aspect_ratio": 12.0, ... } }
  The draft carries ONLY fields from the vector above, all numeric, all inside the
  provided bounds. No draft to suggest → "draft": null. Never invent fields.

quality_gate: |
  Before emitting: (1) the JSON parses and matches the contract exactly; (2) every draft
  field is a finite number inside the provided bounds; (3) buoyancy_fraction is 0 unless
  the capabilities line says hybrid true; (4) the say-text never states a performance
  number the engine has not returned this conversation; (5) honesty about missing
  capabilities — if the user asks for something a flag says is unavailable, say so.
```

The manifest `bots:` block (section 1) references this file; the loader registers the bot from
the package (BUILDING-EXTENSIONS §4). Do NOT touch core `swarm-bot-registry*` — this is a
store package, not a carved core app.

---

## 5. The engine adapter contract (agents A + B, meeting at a frozen protocol)

Philosophy: the NASA-42 pattern — an external authoritative simulator behind a clean adapter —
but **subprocess-stdio JSON-lines**, not TCP. One persistent Python worker per api process,
spawned lazily on first engine call, killed after 10 min idle, restarted on crash/timeout.

### 5a. Process contract (agent B implements the Node side in `src-routes/engine-adapter.ts`)

- **Engine dir:** `process.env.AERO_LAB_ENGINE_DIR`, default (documented, works on this box):
  `C:/Users/you/AppData/Local/Temp/claude/c--Projects-oshal/a6f28b94-bbf2-435a-9f7c-b5755938e4c5/scratchpad/aerosim`
- **Python:** `process.env.AERO_LAB_PYTHON`, else `<engineDir>/.venv/Scripts/python.exe`
  (win32), else `<engineDir>/.venv/bin/python`. If neither exists → every capability false,
  `engine.present: false`, routes 503. Never fall back to a system `python`.
- **Worker script:** `<packageDir>/engine/aero_lab_worker.py` (agent A's file — resolved from
  `ctx.appPackageDir`, same three-candidate pattern as `surfaceHtml`).
- **Spawn** (career-hunter `career-digest.js` is the store's spawn precedent):

```ts
const proc = spawn(pythonPath, [workerPath], {
  cwd: engineDir,
  env: { ...process.env, PYTHONUNBUFFERED: '1', AERO_LAB_ENGINE_DIR: engineDir },
  stdio: ['pipe', 'pipe', 'pipe'],
});
proc.stderr.on('data', (d) => logger.debug({ worker: String(d).slice(0, 500) }, 'engine stderr'));
proc.on('error', (e) => { logger.error({ err: e.message }, 'engine spawn failed'); /* reject all pending */ });
```

- stdout is the protocol channel — parse line-buffered JSON; any non-JSON stdout line is a
  worker bug: log it at warn and drop it.
- One in-flight command at a time per worker (the engine is CPU-bound; queue further requests
  in the adapter, FIFO, queue cap 4 → beyond that reject `503 { error: 'engine busy' }`).
- **Timeouts** (per command, wall-clock from write to response line; on expiry kill the
  worker tree, fail the request `504`, restart lazily):

| cmd | timeout |
|---|---|
| `capabilities` | 30 s (first call pays venv import cost) |
| `polar` | 120 s |
| `screen` | 120 s |
| `evaluate` | 300 s |
| `mission` | 600 s |
| `export` | 300 s |

### 5b. Wire protocol (FROZEN — one JSON object per line, both directions)

Request (Node → worker stdin):

```json
{ "id": "r-17", "cmd": "evaluate", "args": { "design": { ...vector... } } }
```

Response (worker stdout, exactly one line per request, same `id`):

```json
{ "id": "r-17", "ok": true, "result": { ... } }
{ "id": "r-17", "ok": false, "error": { "code": "inadmissible_input", "message": "mass does not close: ..." } }
```

`cmd` ∈ `capabilities | polar | evaluate | screen | mission | export`. Error codes (frozen):

- `capability_unavailable` — module missing / feature-detected off (→ route 503)
- `invalid_design` — field missing / non-finite / out of bounds (→ route 400)
- `inadmissible_input` — engine ran, design un-buildable (→ route 422)
- `engine_error` — unexpected exception; message carries `type: message` (→ route 500)

`capabilities` result (frozen — the route passes it through, §2a):

```json
{
  "engineVersion": "<aerosim __version__ or git-ish or null>",
  "python": "3.11.x",
  "capabilities": { "polar": true, "evaluate": true, "screen": true,
                    "mission": false, "export": true, "hybrid": true,
                    "modules": { "electrical": true, "prop": true, "mission": true,
                                 "materials": false, "electrochem": false } },
  "bounds": { "area_m2": [0.3, 3.0], "aspect_ratio": [6, 25], "...": "one [min,max] per vector field" }
}
```

Bounds come from the engine's own `aerosim.vehicle.param_bounds` / `validate_bounds` when
importable; otherwise agent A hardcodes the documented sweep bounds WITH a source comment.

### 5c. The worker (agent A implements `engine/aero_lab_worker.py`)

- Header docstring + Change Log; BelowNormal priority (guard `sys.platform == 'win32'`);
  `warnings.simplefilter('ignore')`; all logging to **stderr**.
- `sys.path.insert(0, os.environ['AERO_LAB_ENGINE_DIR'])` then **feature-detect** every module
  with `importlib.util.find_spec` / guarded imports — the FP_01 import-with-retry pattern but
  with short retries (3 × 5 s — a web request is waiting, not a batch job); a module that
  still fails import is simply reported `false` in capabilities, and its dependent commands
  return `capability_unavailable`. The stable four (`validate_designs`, `integrate`,
  `validate_screen`, `aeropolar`) failing after retries → every capability false with the
  import error as the reason (still a clean capabilities response — the worker must NOT crash
  on a broken tree; the concurrent reality-upgrade workflow guarantees the tree will
  sometimes be mid-edit).
- Capability mapping:
  - `polar` ← `aerosim.aeropolar.wing_polar` importable
  - `evaluate` ← `build_solar_cruise` + `integrate_energy` importable
  - `screen` ← `screen_design` importable (evaluate runs it too when present)
  - `mission` ← `aerosim.mission.runner.fly_mission` importable
  - `export` ← the FP-pattern geometry deps importable (numpy + the snapshot/STL/DXF/BOM
    code agent A ports into `engine/fp_export.py` from `FP_01/02/03/04/05_*.py` — port, don't
    import the scratchpad scripts by name: they hardcode the f=0.80 hybrid case; the port
    parameterizes on the evaluated design)
  - `hybrid` ← `HYBRID_common` + `HYBRID_piecewise` importable from the engine dir root
- Loop: read stdin lines forever; one request → one response line; catch EVERYTHING per
  request (a bad design must never kill the worker); exit 0 on stdin EOF.
- `export` writes files under `<packageWorkDir>/exports/<exportId>/` where
  `packageWorkDir = args.workDir` supplied by the adapter (the adapter passes
  `path.join(os.tmpdir(), 'aero-lab')`); result = `{ "exportId": ..., "files": [...] }` with
  bare file names only. The Node route owns download streaming + file-name allow-listing.
- Determinism: same design in → same numbers out. No RNG without a fixed seed; no wall-clock
  in results.

### 5d. Engine packaging for a fresh box (agent A)

```
engine/
  aero_lab_worker.py      # the protocol worker (5c)
  fp_export.py            # parameterized FINAL_PRODUCT generation (ported FP_01..05)
  requirements.txt        # copied EXACT pins from <engineDir>/requirements.txt
  setup-venv.ps1          # py -3.11 -m venv .venv; .venv/Scripts/python -m pip install -r requirements.txt
  setup-venv.sh           # posix sibling
  README.md               # AERO_LAB_ENGINE_DIR contract + where the engine tree comes from
```

The venv is DEDICATED (`<engineDir>/.venv`) — the engine's own requirements.txt documents why
(aerosandbox bumps pandas; the box's shared interpreter carries torch + ~50 containers'
tooling). Exact `==` pins because a surrogate model's numbers are only reproducible against a
pinned model version. The engine TREE itself is not vendored into the package (it is a
concurrently-edited scratchpad); `engine/README.md` states plainly: aero-lab REQUIRES an
aerosim checkout at `AERO_LAB_ENGINE_DIR`, and without one every capability reports false and
the surface says so. That is the honest v1.0.0 posture.

---

## 6. Ownership partition (STRICT — no agent touches another's files)

| agent | owns (create + edit) | reads |
|---|---|---|
| **A — engine** | `engine/` (worker, fp_export, requirements, setup scripts, engine README), `tests/aero-worker-protocol.spec.md` optional notes | §5 of this contract; the scratchpad engine tree (read-only) |
| **B — routes + adapter** | `src-routes/aero-lab-routes.ts`, `src-routes/engine-adapter.ts`, compiled `routes/*.js`, `tests/aero-lab-routes.spec.ts`, `tests/aero-engine-adapter.spec.ts` | §2, §5; `sat-ops/src-routes` + `sat-ops/tests` as the pattern |
| **C — surface** | `tools/aero-lab.html`, `tools/aero-lab.js` | §2a (frozen API), §3; `sat-ops/tools/sat-ops.html` as the pattern |
| **D — manifest + personas + docs** | `oshal-app.yaml`, `personas/aero-designer.yaml`, `README.md`, `marketplace.patch` | §1, §4; `sat-ops/README.md` + `marketplace.json` sat-ops entry as the pattern |

Cross-cutting truths so nobody blocks: B codes against §5b without waiting for A (the protocol
is frozen; B's adapter spec tests fake the worker with a tiny inline Python heredoc script
that speaks the protocol — that is a test double for the TRANSPORT, which is legitimate; it
never fakes engine numbers in shipped code). C codes against §2a without waiting for B.
D's manifest names files that A/B/C will create — that is fine in a working tree.

**Tests** (owner B primarily): vitest specs in `tests/`, run from the package root with the
framework checkout on the vitest alias path — copy the header + loopback-HTTP pattern of
`sat-ops/tests/sat-ops-pass-routes.spec.ts` (express app, real router, `beforeAll` listen,
`fetch` against `127.0.0.1:<port>`, port in the 42xxx range — pick 42171+ to avoid sat-ops'
42152). Route specs MUST cover: 503-when-engine-absent (point `AERO_LAB_ENGINE_DIR` at a
temp empty dir), 400 on a malformed vector, the export file-name allow-list (a `../` name
404s), and `/app` serving. Adapter spec covers: timeout → kill → 504, non-JSON stdout line
dropped, queue cap. When the real engine dir exists on the box, a guarded describe
(`describe.skipIf(!fs.existsSync(ENGINE))`) runs one REAL `capabilities` + one REAL `polar`
round-trip — skip loudly with the reason, never silently green.

### marketplace.patch (agent D) — proposed entry, formatted as the file to hand the operator

`aero-lab/marketplace.patch` contains the JSON object to append to `marketplace.json`'s
`apps` array (plus one sentence of instructions at the top of the file as a `//`-free plain
paragraph — the operator applies it by hand):

```json
{
  "name": "aero-lab",
  "suite": "ai-engineering",
  "displayName": "Aero Lab",
  "description": "Persistent-flight design lab - shape a solar-endurance aircraft (span, area, aspect ratio, battery, cells, buoyancy fraction, site, season), run it through the validated aerosim engine (wing polar, 24 h energy limit cycle, admissibility screen), read the verdict with real plots (SOC trace, polar, drag buildup, margins), and download the build package (STL / DXF / BOM). The Python engine is external and feature-detected; missing modules report honestly as unavailable.",
  "version": "1.0.0",
  "dependencies": { "apps": [], "tools": [], "connectors": [] },
  "source": {
    "type": "git-subdir",
    "url": "https://github.com/emeraldcoastsystemsgroup/oshal-apps",
    "path": "aero-lab",
    "ref": "main"
  },
  "audit": "pending",
  "status": "ready"
}
```

---

## 7. Definition of done (per agent, then together)

- A: `echo {"id":"1","cmd":"capabilities"} | .venv python engine/aero_lab_worker.py` (from the
  engine dir env) returns one honest JSON line; a real `evaluate` on the R7 winner vector
  reproduces the engine's own numbers (min SOC ≈ 0.4366, usable ≈ 1.0586 — from
  `R7_winner_vector.json`); a broken/missing module never crashes the worker.
- B: `npx tsc` on src-routes clean; compiled routes/ committed to the tree; specs green
  including the engine-absent 503 path.
- C: surface renders in midnight AND a light theme with zero hardcoded palette leaks; 390 px
  pass; every §2a endpoint exercised from the UI including the honest-error states.
- D: `node c:/Projects/oshal/scripts/oshal-app.js validate aero-lab` clean; README documents
  AERO_LAB_ENGINE_DIR + the setup-venv path + the capability-flag honesty posture.
- Together: with the engine dir present, a human can open `/cockpit?app=aero-lab`, drag
  sliders, Run, watch the real SOC trace draw, read a real verdict, and download a real STL.
  With the engine dir absent, the same human sees exactly why nothing runs — and not one
  fabricated number.
