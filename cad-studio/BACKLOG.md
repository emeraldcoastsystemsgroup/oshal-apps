# CAD Studio — backlog

Each entry has done-when criteria. Nothing here is built; the README and ARCHITECTURE describe
only what is.

## B1 — Sketch-driven features: revolve, sweep, loft

The kernel does them; the contract does not expose them yet.

Done when: `revolve` (sketch + axis + angle), `sweep` (profile + path polyline) and `loft`
(two or more sketches at offsets) are feature types in both `cad_worker.py` and
`feature-contract.ts`, each with a real-kernel test to an analytic volume and a contract test
naming the field on refusal.

## B2 — Click-to-place in the viewer

The form takes numbers; a tap on the model should fill them in.

Done when: the WebGL viewer reports the picked point and face normal on click, the feature form
pre-fills `x`/`y`/`z` and `axis` from it, and a browser fixture proves a hole placed by click
lands within one STL tolerance of the picked point.

## B3 — Send an STL to Scan to Print for printing

Printing stays behind Scan to Print's confirmation; the hand-off is a download today.

Done when: Scan to Print's `artifacts.accepts` takes `model/stl` and opens a job with the mesh
as its model (no reconstruction), and CAD Studio's revision row offers "Print in Scan to Print"
through the ADR-139 picker.

## B4 — Threads and text

Done when: `thread` (ISO metric profile on a hole or boss, by nominal size and pitch) and `text`
(engossed / debossed, a bundled font) are feature types with real-kernel tests and the STL of a
threaded boss passes the mesh validator.

## B5 — Per-feature timing budget and cancellation

A very slow boolean on a large mesh base holds the worker for the whole request timeout.

Done when: the worker reports per-feature `ms` (it does) AND refuses a single feature past a
configurable budget with a `budget_exceeded` status, and the api exposes a cancel that closes
the connection mid-rebuild and records the last good revision.

## B6 — Store-side execution of the framework-coupled suite and the real-kernel suite

`tests/routes.core.test.js` needs a core checkout; `engine/tests/test_cad_worker.py` needs the
engine image. Both are excluded from the store-CI wildcard and registered in the Test Lab with
their real prerequisites.

Done when: both are registered with the store's framework-coupled runner (or an equivalent gate)
and a red case fails a PR.
