# Engineering shelf (one role for the engineering applications)

`engineering-shelf` declares one role, **Engineer**. An administrator assigns it at **Access** and the person gets the
five engineering applications together, each on the person's own work:

| Application | Role the Engineer role gives |
|---|---|
| Design Studio (`design-studio`) | `@app-admin`, its one role |
| CAD Studio (`cad-studio`) | `@app-admin`, its one role |
| Circuit Lab (`circuit-lab`) | `@app-admin`, its one role |
| Embodied Swarm (`embodied`) | `@app-admin`, its one role |
| Scan to Print (`scan-to-print`) | `maker` |

`@app-admin` is the name of the single role of an application that has no access catalog. It is what every person who
uses those four applications holds today, and it reaches that one application only: it gives nothing in another
application and nothing in the installation's own administration.

Before this package a person needed five separate assignments, and Design Studio stopped at the first poster whose
application had been left out (design-studio BACKLOG B12).

## Why it is a package of its own

A role that spans applications has to be declared by an application that has an access catalog. Design Studio, CAD
Studio, Circuit Lab and Embodied Swarm have none, and must not gain one: the catalog-free `@app-admin` assignment stops
resolving the moment its application has a catalog, so every person who holds one of the four would wait for a new
assignment. This package carries the catalog instead and changes nothing in the five.

It has no screen, no data, no bot and no tool, and it is kept out of the application lists (`hidden: true`). An
administrator meets it in one place: the application list at Access.

## Assigning it

At Access choose the person, the application **Engineering shelf** and the role **Engineer: Design Studio, CAD Studio,
Circuit Lab, Embodied Swarm and Scan to Print, each on the person's own work**. The preview lists the six roles the one
assignment gives (this package's own and the five above); Assign role applies them together. Taking the assignment
back takes all of them back.

All five applications are required by this package, so the role cannot be given with one left out. Where one of the
five is not installed or not active, the kernel does not resolve the role; assign each installed application's own role
there, as before. If one of the five is later removed or turned off, an assignment of this role stops counting for all
five until it is back.

## What's inside

| Path | What |
|---|---|
| `oshal-app.yaml` | The manifest: the five required applications and the `engineer` role template. |
| `authorization.yaml` | One permission, `app.open` (read), one role, `engineer`. |
| `src-routes/package-smoke.ts`, `routes/package-smoke.js` | Install readiness at `/api/engineering-shelf/_smoke`: the package's name and version. It is the store's one reviewed readiness pair, unchanged. |
| `src-routes/shelf-routes.ts`, `routes/shelf-routes.js` | Registers the adapter of the catalog's one resource while the package activates; the kernel refuses a package with a catalog until every resource has one. Declared at the same mount and serves no path. |
| `tests/package-contract.test.mjs` | What the kernel requires of the declaration, read from the five manifests, and both routes on a local listener. |
| `tests/engineer-role-closure.test.mjs` | The role gives exactly what Design Studio's four steps need. |
| `tests/kernel/shelf-activation.test.mjs` | The package in the kernel's own package runner: activation, readiness and the adapter's refusal. |

## Tests

`node --test "tests/*.test.mjs"` from this folder (needs `scripts/toolchain` installed for the YAML reader and Express).
`node --test tests/kernel/shelf-activation.test.mjs` also needs the kernel checkout (`OSHAL_KERNEL_ROOT`, default
`~/Documents/projects/oshal-kernel`); it fails rather than skips without it, so it is registered in Test Lab and kept out
of the store-ci glob.

The contract test holds the manifest to the kernel's rules for a role across applications. The closure test lists the
calls a person's browser makes in Design Studio's New product, a partner-built part, Simulate and Make the print set,
holds that list to Design Studio's own page code, and admits each call the way the kernel does. It fails when one of the
five renames the mapped role, when one of the four gains a catalog, or when Design Studio's page reaches an application
the role does not map.

The role on a running kernel is checked by `design-studio/tests/design-studio-nonadmin-live-proof.mjs`.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **16 / 64 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
