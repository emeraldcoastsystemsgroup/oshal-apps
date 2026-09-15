# OpenRocket — evaluation (2026-09-13)

**What it is.** An open-source model-rocket design and flight simulator in Java. The repository
(openrocket/openrocket, read 2026-09-13) states the licence is GNU GPL (v3) and lists ecosystem
projects for scripting: "orhelper — Python scripting/module for OpenRocket (via JPype)",
RocketSerializer and ortools. The core application is GUI-based; the release version was not
read (*unverified*).

**The question.** Can the Java core run headless in a package-owned engine container (the
orhelper-style API) so a design's flight is a route-backed solve the way this lab's circuits are?

**Answer.** Yes in shape: a JRE plus the OpenRocket jar plus orhelper under JPype, driven by a
stdlib worker the way the ngspice worker is, in a package-owned container on the stack network.
The GPL attaches to the container image, which is built locally and never published (the same
posture as Debian's ngspice); the package's own code stays separate. Not yet known: whether the
current jar runs without an X display for simulation only (orhelper's documented use suggests it
does; *unverified* until tried), and the container's size with a JRE.

| | Cost | Benefit |
|---|---|---|
| Build | an engine container (JRE + jar + JPype + orhelper), a contract for a rocket design (body, fins, motor, recovery), routes, a canvas | a rocket lane beside aero-lab: apogee, stability margin, descent, from a design a person edits |
| Run | a JVM per solve (seconds) | — |
| Risk | headless operation and JPype stability to be proven; GPL kept inside the local image | — |

**Verdict.** A BACKLOG item, **B15 — a rocket lane on OpenRocket**, shared with the CEA note.
Done when: a package-owned container runs a named `.ork` design headless through orhelper and
answers apogee within 2 % of OpenRocket's own GUI result for the same file, the design is a
contract a person and the concierge edit, and the flight animates on a canvas.

**Evidence.** https://github.com/openrocket/openrocket (fetched 2026-09-13).
