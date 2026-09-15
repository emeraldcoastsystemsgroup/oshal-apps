# dnd - BACKLOG

Open work on the packaged D&D app. Every entry has a done-when so scope does not have to be
guessed later.

---

## A. `ui/table-screens.js` was over the decomposition threshold - fixed 2026-09-14

**Context:** the package's own governance suite
(`tests/dnd-governance.test.js:108`, *all D&D JavaScript stays below the 800 executable-line
decomposition threshold*) fails on `ui/table-screens.js`. The file is 872 physical lines and 811
executable, against a threshold of 800 - so it is over by eleven lines, and the guard is the
package's own restatement of the repository limit in CLAUDE.md ("at 800 code lines, stop and
propose a decomposition plan before adding code").

This has been red on every run of `feat/package-test-catalog-pilots`, which is how a red gate stops
being read. It is a genuine breach, not a stale assertion: the companion cases in the same suite
(the under-50-line function rule, the Change Log rule) still pass, so only the size rule fires.

**The trap to avoid:** eleven lines over is exactly the size where someone deletes comments or
joins lines to get under the bar. The threshold measures executable lines, so that does not work,
and it would not be the point if it did - the guard exists to force a decomposition, not a diet.

**Resolved:** the dock moved out whole into `ui/table-dock.js` - turn-button state, the identity
and hero/downed/automated variants, action selection and the initiative bar. It is one concern: whose
turn it is, what that actor may do right now, and why a control is locked. `table-screens.js` went
from 811 executable lines to **659**, and the new module is **153** - both far enough under 800 that
the next change does not reopen this. `banner()` stayed behind; it is a general toast, not a dock
control.

Four ordered script lists name the file and all four were updated together (`routes/dnd-routes.js`
allowlist, `ui/table.html` script order, `tests/dnd-route-assets.test.js`,
`tests/dnd-ui-contract.test.js`), with `table-dock.js` loaded before `table-screens.js`. Three suites
read the table surface as a single source string and now read both files, so no assertion was lost
with the code it guards. dnd suites: **312/312**.

**Done when (met):**
- `ui/table-screens.js` is decomposed along a seam a reader would recognise (one screen or one
  concern per module), not split at an arbitrary line number, and each resulting file carries its
  own Change Log entry as the governance suite requires.
- `node --test "tests/*-*.test.js"` in `dnd/` passes, including the 800-line case and the
  under-50-line function case, with no threshold edited and no file added to an exemption list.
- The screens behave identically: the existing D&D suites covering table behaviour pass unchanged,
  and no export consumed elsewhere in the package disappears or changes shape.

## B. The owner-RLS suite pinned a release instead of an invariant - fixed 2026-09-14

**Context:** `tests/dnd-owner-rls.test.js` asserted the CURRENT manifest version still equalled
`0.19.1`, the release the SEC-04 owner migration shipped in. That passed exactly once and then
failed on every release after it; dnd is now `0.21.1`. Removed in favour of the assertions that
actually prove installation - the manifest and README references to `migrations/006-owner-rls.sql`,
the README's historical "Shipped in v0.19.1" line, catalog/manifest agreement, and every owner
column, FORCE RLS and trigger assertion, all unchanged.

**Done when:** done. Recorded here so the pin is not reintroduced as a "release check" - a security
guard must outlive the release it shipped in.
