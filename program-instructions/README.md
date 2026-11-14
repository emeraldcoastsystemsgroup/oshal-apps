# Program Instructions

Writes the instruction text Jarvis reads before it works inside a program on a person's computer.

A computer that gives the swarm control reports which version of each bound program it has. The kernel keeps one
row for each program version and platform, never for a person or a computer. This package is the writer of those
rows: one background job, one writer bot with no tools, no screen, no route a person can call, and no data of its
own.

**Status, 0.1.0.** Built and tested against a stand-in for the kernel's rails (see Tests). It needs a kernel that
links the capability `application-profiles.write`. On a kernel that does not, the job's claim is refused and each
run says so with the kernel's words; nothing is written.

## What one run does

The job `write-instructions` is due every minute. Each run:

1. Asks the kernel for work (`application_profiles.claim`). The kernel answers with at most one program version:
   the program, its version, the platform, the bridge Jarvis reaches it through, and a contract (the only tools and
   actions the text may name, and its size).
2. Asks the package's own bot `instruction-writer` once. The request is under 8 KiB and is built only from fields of
   a closed shape (short names and a version number), so a computer cannot put sentences of its own in front of the
   model. The request never carries the row's id or the claim. It lists the declared verbs the program's bridge has
   for the program's kind of document, or says that none are known (see *Declared verbs* below). For a program
   measured on its platform and bridge (`lib/program-facts.json`, see *Measured facts* below) it also carries the
   facts the text must say, what it must never say, and the words it must and must not hold.
   A contract listing more than 8 tools or 16 actions is refused before any model call, so the request stays under
   8 KiB even with every declared verb and measured fact; the kernel's contract lists 2 tools and 9 actions today.
3. Checks the answer with the kernel's own rules for instruction text, so a text the kernel would refuse is
   reported without a publication attempt:
   - 200 to 8,192 bytes of UTF-8, no control character other than newline and tab;
   - the first line starts with `# `;
   - no block opened with three backticks and `tool_call` or `handoff`;
   - no `http://`, `https://` or `file:/` anywhere, in capitals or not;
   - every word that starts with `computer.` is one of the contract's tools, anywhere in the text, in backticks or
     not (a full stop that ends a sentence is not part of the word);
   - every `"action": "<name>"` names one of the contract's actions, read with all white space removed;
   - no `<<untrusted` or `<<end untrusted`, in capitals or not (the marks the kernel's prompt fences data with).

   Then one rule of the package's own, **stricter than the kernel's check on purpose**: every
   `"declared": "<id>"` (read with all white space removed) names a verb the request's bridge lists for the
   program, and a text for a bridge with no entry names none. The kernel bounds tools and actions, not a bridge's
   declared verbs, so without this rule a pack could tell Jarvis to run a verb the program does not have.

   And for a measured program the text must hold every required word as written and none of the forbidden ones
   (*Measured facts* below). A published text is never written again, so it is held to them before it is offered.
4. Publishes the text (`application_profiles.publish`) or reports why it was not written
   (`application_profiles.fail`) with one of `model-refused`, `invalid-output`, `over-budget`, `timeout`, and one
   line saying why (`detail`: the check's own words, the kernel's refusal of the publication, or the bot rail's
   refusal). The kernel keeps both on the row and shows them to the computer's owner (`last_failure` in
   `GET /api/computers`). The writer waits for its bot at most 48 s and then reports `timeout` itself, so the report
   fits inside the kernel's 60-second package call. A kernel that does not take `detail` yet gets the report without it.
   When the package's own check refuses the answer and the first turn used at most a third of that deadline (16 s),
   the bot is asked once more in the same run with the refusal's own words; the second answer is published or
   reported. Production's turns took about 11 s; a rail that takes longer is asked once.

There is one request, one bot turn and no second try in a run. An answer that fails the check is reported as it is:
the package never repairs, pads or rewrites what the model wrote. The kernel's own check decides in the end; when it
refuses a text this package passed, that is reported as `invalid-output` too.

The run answers `{ "claimed": n, "published": n, "failed": n }` with HTTP 200, also when there was nothing to claim.
A refused claim or a refused report answers an error status with the kernel's words, so the run is recorded with
that status and not as a quiet success.

The package never learns which person or which computer has the program.

## Declared verbs

A declared verb is an operation a bridge offers inside a program, run with `computer.app` and the `invoke` action,
such as LibreOffice Writer's `insert-paragraph`. `lib/bridge-verbs.json` lists, for each bridge word, its action
names and its declared verb ids by kind of document, with the provenance of each sheet it came from. It is
distilled, never typed, from three sheets: Lane G's bridge fact sheet for the Linux bridges (`bridge-facts.json`,
written from Orbit's compiled code by `make-bridge-facts.cjs`), this package's own
`inputs/windows-bridge-facts.json` for `windows-uia`, the bridge of every Windows program (Word's six edit verbs,
Excel's spreadsheet verbs (nine since 0.1.5, with create-pivot-table and add-chart) and, since 0.1.4, PowerPoint's six slide verbs, each naming the line of Orbit's code it
is read from, and none for any other window), and, since 0.1.6, its own `inputs/godot-bridge-facts.json` for
`godot`, the bridge of the Godot 4 editor with Orbit's add-on in the project (its seventeen verbs, each naming the
line of `bridges/godot-actions.ts` it is declared on; the facts are in `inputs/godot-pack-inputs.json`, each naming
the real Godot 4.7.2 test that proves it), and its own `inputs/blender-bridge-facts.json` for `blender`, the bridge
of a bound Blender (Orbit's Blender add-on: its thirty verbs on the open .blend since 0.1.7, each naming the line of Orbit's code
it is read from), and its own `inputs/vscode-bridge-facts.json` for `vscode`, the bridge of VS Code, Antigravity IDE and
VSCodium with Orbit's VS Code extension (its twelve verbs, each at the line of Orbit's `bridges/vscode-actions.ts` it is
read from):

```bash
node scripts/bridge-verbs.cjs [<sheet> ...]           # rewrite lib/bridge-verbs.json from the sheets
node scripts/bridge-verbs.cjs --check [<sheet> ...]   # exit 1 when the committed file is not what the sheets give now
```

The sheets default to `OSHAL_BRIDGE_FACTS` (else the coordinator's handover copy under the home folder), then
`inputs/windows-bridge-facts.json`, then `inputs/vscode-bridge-facts.json`. When a sheet changes, `tests/sheet/bridge-verbs-sheet.test.cjs` fails until the file is
rewritten and committed, and `tests/sheet/windows-sources.test.cjs` fails when Orbit's code declares other Word,
Excel or PowerPoint verbs than the Windows sheet. Neither is in the store job's `tests/*.test.cjs` glob, so the store gate never
depends on a file outside this repository; the Test Lab cases `bridge-verbs-sheet` and `windows-sources` run them by
name. `tests/windows-programs.test.cjs`, in the glob, holds the committed file to what the Windows sheet gives.

Which kinds apply to a program: the kind its key names (`writer` text, `calc` spreadsheet, `impress`
presentation, `draw` drawing, as Orbit reads a LibreOffice binding's key; `winword.exe` text, `excel.exe`
spreadsheet and `powerpnt.exe` presentation in the keys Orbit gives Word, Excel and PowerPoint on Windows), else the bridge's catch-all kind (`any other window`),
else every kind of the bridge. A bridge the file does not name has no declared verbs. Since 0.1.3 `windows-uia` has an
entry: before it, a Word text naming Word's own `format-text` was refused.

## Turning it on

Installing the package runs nothing. An administrator turns the job on once for the installation:

1. Sign in as an administrator and open `/swarm-admin/jobs` (the **Jobs** page).
2. Under **Ready to turn on**, find the row whose second line reads `program-instructions · write-instructions`.
3. Press **Run as the installation**. The job is a system job: it runs as the application itself, never as you.
   (**Turn on** would run it as you, and the kernel refuses that for this job.)

The job then appears in the **Installation** table of the same page, with **Pause**, **Run now** and **Turn off**.

## What it may spend

Each claimed program version costs one model call of at most 2,000 output tokens, at most one a minute.

This package names no amount of money, in its manifest or its code. What a run may spend is the cap set on the
job's own row: in the **Installation** table press **Set cap**, fill **Most per run ($)** and **Most per day ($)**,
and press **Save cap**. The next run uses it. When the kernel refuses the writer's turn as over budget, the run
reports `over-budget` for that program version.

## Who may do what

- Who may claim, publish and report is decided by the kernel that links the capability, never by this package.
  The package only asks, as the service the administrator turned on, and answers a refusal as an error.
- The route `POST /api/program-instructions/write` is mounted for the service only (`auth: service`). Nothing in
  the package is offered to a signed-in person.
- The package has no authorization catalog, no roles and no permissions of its own, like the other system jobs in
  this store (`calendar`, `marketing-engine`, `daily-trade-recap`). A catalog would stop the job: the kernel
  resolves a catalog application's route through a named role, and an application's service is never given one.

## Measured facts

Lane G measures what Orbit's bridges really do inside a program and writes, for each program on its platform and
bridge, the facts a text must say, what it must not say, and the words an acceptance check holds a text to
(`pack-inputs.json` in the Linux application packs lane). Since 0.1.4 the package keeps its own copy,
`inputs/linux-pack-inputs.json`: Lane G's file with Lane G3's eleven programs, and with Lane G4's wording for Chrome, VS
Code, Firefox and Thunderbird, which Orbit now starts readable when it opens them (a copy the person started unreadable is
refused as started without accessibility). Since 0.1.6 both files also hold the nineteen everyday Linux programs Lane LX1
measured on the Spark (gedit, Calculator, To Do, Document Scanner, Calendar, Characters, Transmission, File Roller, PDF
Arranger, System Monitor, Fonts, Videos, Rhythmbox, Shotwell, Ristretto, Remmina, qBittorrent, Claude and ChatGPT, each
citing `test-linux-everyday-programs.cjs`). Its `amended` record names those four, and
`tests/sheet/linux-sources.test.cjs` fails when the copy differs from Lane G's file anywhere else or a test a fact cites
is not in the kernel checkout. `node scripts/program-facts.cjs` distils the copy into
`lib/program-facts.json` together with this package's own `inputs/windows-pack-inputs.json` (since 0.1.3: the
Windows 11 Notepad, Word and Excel through `windows-uia`, and since 0.1.4 PowerPoint, each fact naming the Windows PC's
receipt it comes from, in `oshal-collab` `windows/proofs/`, or its entry on the Windows board, `windows/FROM-WINDOWS.md`,
as for Excel's pivot tables and charts since 0.1.5), and since 0.1.6 its own `inputs/blender-pack-inputs.json` (Blender on Linux through
`blender`, each fact naming the case of the real-Blender suite `test-blender-plugin-desktop.cjs` or the source it comes from; since 0.1.7
also the game-asset families of Orbit's Blender add-on 1.1.0, measured by `test-blender-game-asset.cjs` on Blender 5.1.0 and Godot 4.7.2) and
`inputs/vscode-pack-inputs.json` (Lane VS1: VS Code on the `vscode` bridge, which Orbit reports from kernel 7ed028e0, each fact
naming the real-VS Code test it is proved by; Lane G's `linux-atspi` entry for VS Code stays for an Orbit that reports that bridge);
`--check` fails when any file's programs, facts or words have changed since.
`tests/sheet/vscode-sources.test.cjs` fails when Orbit's code declares other VS Code verbs or a test or commit a VS Code fact cites is not in the kernel checkout.
Version 0.1.0 had none of this: on the test slot (2026-11-13) it published, for LibreOffice Writer 24.2.7 on Linux, a text that
passed every rule above and lacked four of the eight required words (`add-on`, `"part"`, `whole`, `verified`).
A program with no entry is asked and checked as before.

## Files

| File | What it is |
|---|---|
| `oshal-app.yaml` | The package: its capabilities, the writer bot, the job and its service route. |
| `personas/instruction-writer.yaml` | The writer's persona. |
| `routes/program-instructions.mjs` | The job's handler: claim, one bot turn, check, publish or report. |
| `lib/instruction-pack.js` | The request text builder and the text check. Pure; no kernel call. |
| `lib/bridge-verbs.json` | Each bridge's declared verbs by kind of document, distilled from the bridge fact sheet. |
| `scripts/bridge-verbs.cjs` | Writes and checks `lib/bridge-verbs.json` from the sheet. |
| `lib/program-facts.json` | For each measured program on its platform and bridge: the facts, the never-lines and the required and forbidden words, distilled from Lane G's pack inputs. |
| `scripts/program-facts.cjs` | Writes and checks `lib/program-facts.json` from the Linux pack inputs (`OSHAL_PACK_INPUTS`, else `inputs/linux-pack-inputs.json`) and `inputs/windows-pack-inputs.json`. |
| `inputs/linux-pack-inputs.json` | The package's copy of Lane G's Linux pack inputs, with Lane G4's wording for the four programs its `amended` record names. |
| `inputs/vscode-bridge-facts.json`, `inputs/vscode-pack-inputs.json` | The VS Code inputs (Lane VS1), in the shape of Lane G's two files: the vscode bridge's twelve verbs, and VS Code's measured facts on that bridge with the kernel commit and real-VS Code test each comes from. |
| `inputs/windows-bridge-facts.json`, `inputs/windows-pack-inputs.json` | The Windows inputs, in the shape of Lane G's two files: the windows-uia bridge's verbs, and the measured facts of the Windows 11 Notepad, Word, Excel and PowerPoint with the receipt and source each comes from. |
| `routes/package-smoke.js`, `src-routes/package-smoke.ts` | The store's standard readiness probe. |
| `tests/program-instructions.test.cjs`, `tests/program-facts.test.cjs`, `tests/failure-reasons.test.cjs`, `tests/production-failures.test.cjs`, `tests/windows-programs.test.cjs`, `tests/linux-programs.test.cjs`, `tests/vscode-programs.test.cjs`, `tests/sheet/*.test.cjs`, `tests/test-lab.yaml` | The suites and their Test Lab registration. `tests/fixtures/` holds the text 0.1.0 published on the test slot for Writer 24.2.7, byte for byte. |

## Tests

From this folder, with the store toolchain installed (`npm ci --prefix scripts/toolchain` at the store root, for
Express):

```bash
node --test "tests/*.test.cjs"
```

`tests/sheet/bridge-verbs-sheet.test.cjs` needs the bridge fact sheet (at `OSHAL_BRIDGE_FACTS`, else its handover path) and
fails, never skips, without it; `tests/sheet/windows-sources.test.cjs` needs a kernel checkout (`OSHAL_KERNEL_ROOT`, else
`~/Documents/projects/oshal-kernel`) and the Windows PC's receipts (`OSHAL_WINDOWS_PROOFS`, else
`~/Documents/projects/oshal-collab/windows/proofs`), and fails without them; `tests/sheet/linux-sources.test.cjs` needs Lane G's
handover `pack-inputs.json` and the kernel checkout, and fails without them. The kernel's rails are a stand-in in these tests: they prove what the package sends and how it answers. They do not
prove that a kernel admits the job, that the capability is linked, or that a model writes usable text. Those are
checked on a kernel with the capability before a delivery.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| instruction-writing | instruction text for one program version | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
