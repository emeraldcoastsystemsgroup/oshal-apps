# WebPlotDigitizer — evaluation (2026-09-13)

**What it is.** A tool that extracts numeric series from plot images. The GitHub repository
(automeris-io/WebPlotDigitizer, read 2026-09-13) states the frontend is "GNU AGPL v3" while
"Automeris 'AI Assist' and other related cloud based systems are closed source and owned by
Automeris LLC"; the repository documents a web interface and local development via Docker or npm,
and no command-line or headless mode.

**The question.** Can its extraction run headless in a package container, and does it beat the
hosted model reading the plot image directly on the ten datasheet curves the drone design needs?

**Answer.** No headless mode exists in the open-source frontend, so "run it in a package
container" means driving a browser UI, and the AGPL would attach to a package that bundled it.
The comparison against the hosted model was not run (*not measured*). What the labs actually need
— motor curves, propeller thrust vs rpm — is a handful of series per part, entered once. The
sensible shape is a desk step: the person digitises the curve in WebPlotDigitizer (or reads the
datasheet table) and pastes the numbers into a catalog row, whose `source` line names the sheet.

| | Cost | Benefit |
|---|---|---|
| Container | driving a browser UI headless; AGPL on a bundled build; a maintenance surface | automation of a step done a few times per design |
| Desk step | none in code; a documented procedure and a catalog row with a source line | the numbers arrive with provenance, which the catalog already requires |
| Risk | hand-entered curves can be mistyped; the source line makes them checkable | — |

**Verdict.** A recorded **no** for a container. The catalog's `source` line (shipped 0.3.0) is the
place a digitised curve's provenance goes; no BACKLOG item.

**Evidence.** https://github.com/automeris-io/WebPlotDigitizer (fetched 2026-09-13).
