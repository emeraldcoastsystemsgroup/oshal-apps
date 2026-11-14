#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1 (T76): distil Lane G's pack inputs (pack-inputs.json: for each Linux program on its bridge, the facts a written text must say, what it must not say, and the words an acceptance check holds a text to) into lib/program-facts.json. The writer's request carries those facts and its text check holds a text to those words; 0.1.0 had neither, and the text it published on the test slot for LibreOffice Writer 24.2.7 lacked four of the eight required words. Nothing in the file is typed by hand; --check exits 1 when the committed file's programs differ from what the inputs give now (their date and commit alone never make it stale).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.3 (Lane A4, T76 on Windows): the file is distilled from every inputs file named, by default Lane G's Linux pack inputs and the package's own inputs/windows-pack-inputs.json (the Windows 11 Notepad, Word and Excel through the windows-uia bridge, each fact naming the Windows PC's proof it comes from). Before it, no Windows program had measured facts. `provenance` is now one entry for each inputs file, with the file it came from; a program named twice for the same platform and bridge, in one file or across them, is refused.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.4 (Lane A5): the Linux inputs are the package's own inputs/linux-pack-inputs.json by default, a copy of Lane G's handover pack-inputs.json with Lane G3's eleven programs and Lane G4's wording for the programs Orbit now starts readable (kernel 6602c84d). Before it the default was Lane G's handover file itself, which G3 had grown to fourteen programs while the committed file held three, so --check failed on main, and G3's programs had no facts. LANE_G_INPUTS names Lane G's file for tests/sheet/linux-sources.test.cjs, which holds the copy to it.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane GD1): the package's own inputs/godot-pack-inputs.json is distilled too, after the Windows inputs: the Godot 4 editor (program godot, bridge godot) with Orbit's add-on, each fact naming the real Godot 4.7.2 test that proves it. Before it, Godot had no measured facts.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane BL1): the package's own inputs/blender-pack-inputs.json joins the default sources, after the Godot inputs: Blender on Linux through the blender bridge (Orbit's Blender add-on), each fact naming the case of the real-Blender suite or the source it comes from.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane VS1): the file is also distilled from the package's own inputs/vscode-pack-inputs.json, VS Code (com.microsoft.vscode) on the vscode bridge, last; Lane G's linux-atspi entry for VS Code stays for an Orbit that reports that bridge.
 *
 * Usage: node scripts/program-facts.cjs [--check] [--out <file>] [<inputs> ...]
 *   <inputs> a pack inputs file; several are merged in order (default: OSHAL_PACK_INPUTS, else the package's
 *            inputs/linux-pack-inputs.json, then the package's inputs/windows-pack-inputs.json,
 *            inputs/godot-pack-inputs.json, inputs/blender-pack-inputs.json and inputs/vscode-pack-inputs.json)
 *   --out    the distilled file (default: lib/program-facts.json in this package)
 *   --check  write nothing; exit 1 when the file's programs are not what the inputs give now
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Where Lane G writes the pack inputs on the coordinator's host; the package's Linux inputs are held to it. */
const LANE_G_INPUTS = path.join(os.homedir(), 'Documents', 'projects', 'oshal-handover',
  'lanes', 'linux-application-packs-2026-11-13', 'pack-inputs.json');
const PACKAGE = path.resolve(__dirname, '..');
/** The package's own Linux inputs: Lane G's file with Lane G4's wording for the programs Orbit starts readable. */
const LINUX_INPUTS = path.join(PACKAGE, 'inputs', 'linux-pack-inputs.json');
/** The Linux inputs the committed file is distilled from. */
const DEFAULT_INPUTS = process.env.OSHAL_PACK_INPUTS || LINUX_INPUTS;
/** The package's own inputs for the Windows programs, written from the Windows PC's proofs and Orbit's code. */
const WINDOWS_INPUTS = path.join(PACKAGE, 'inputs', 'windows-pack-inputs.json');
/** The package's own inputs for the Godot 4 editor, written from the real Godot suites and Orbit's code. */
const GODOT_INPUTS = path.join(PACKAGE, 'inputs', 'godot-pack-inputs.json');
/** The package's own inputs for Blender on Linux (the blender bridge), written from the real-Blender suite and Orbit's code. */
const BLENDER_INPUTS = path.join(PACKAGE, 'inputs', 'blender-pack-inputs.json');
/** The package's own inputs for VS Code on the vscode bridge (Orbit's VS Code extension, Lane VS1). */
const VSCODE_INPUTS = path.join(PACKAGE, 'inputs', 'vscode-pack-inputs.json');
/** Every inputs file the committed file is distilled from, in order. */
const DEFAULT_SOURCES = Object.freeze([DEFAULT_INPUTS, WINDOWS_INPUTS, GODOT_INPUTS, BLENDER_INPUTS, VSCODE_INPUTS]);
const DEFAULT_OUT = path.resolve(__dirname, '..', 'lib', 'program-facts.json');
const MAX_INPUTS_BYTES = 1024 * 1024;
/** The fields of a program row as the kernel keeps them. */
const SHAPES = Object.freeze({ platform: /^[a-z0-9-]{1,32}$/, program: /^[a-z0-9.-]{1,64}$/, bridge: /^[a-z0-9.-]{1,32}$/ });
const COMMIT = /^[0-9a-f]{7,40}$/;
const ABOUT = 'Generated by program-instructions/scripts/program-facts.cjs from the pack inputs files named in provenance; do not '
  + 'edit by hand. For each program on its platform and bridge: the measured facts a written text says, what it never '
  + 'says, and the words a text must and must not hold.';

/**
 * @description Inputs that cannot be distilled, named so the command line can tell them from a difference.
 * @param {string} message What is wrong. @returns {Error} The error, with code pack_inputs_invalid.
 */
function invalid(message) {
  return Object.assign(new Error(message), { code: 'pack_inputs_invalid' });
}

/**
 * @description A list of single lines of text, each at most `most` characters.
 * @param {unknown} list What the inputs carried. @param {string} label For the refusal. @param {number} most Longest line.
 * @returns {string[]} The lines. @throws {Error} When it is not such a list.
 */
function lines(list, label, most) {
  const ok = Array.isArray(list) && list.every((line) => typeof line === 'string' && line.trim() === line && line.length > 0
    && line.length <= most && !/[\u0000-\u001f\u007f]/.test(line));
  if (!ok) throw invalid(`${label} is not a list of single lines`);
  return list.slice();
}

/**
 * @description One program of the inputs as the package keeps it.
 * @param {object} row One entry of the inputs' programs. @returns {object} platform, program, bridge, facts, never, contains, absent.
 */
function programOf(row) {
  const kept = {};
  for (const [field, shape] of Object.entries(SHAPES)) {
    if (typeof row?.[field] !== 'string' || !shape.test(row[field])) throw invalid(`a program's ${field} is not of the shape the kernel keeps`);
    kept[field] = row[field];
  }
  const who = `${kept.platform}/${kept.program}/${kept.bridge}`;
  const said = Array.isArray(row.must_say) ? row.must_say.map((fact) => fact?.fact) : null;
  kept.facts = lines(said, `${who} must_say`, 1000);
  kept.never = lines(row.must_not_say, `${who} must_not_say`, 400);
  kept.contains = lines(row.acceptance?.contains, `${who} acceptance.contains`, 80);
  kept.absent = lines(row.acceptance?.absent, `${who} acceptance.absent`, 80);
  if (kept.facts.length === 0 || kept.contains.length === 0) throw invalid(`${who} has no facts or no required words`);
  return kept;
}

/**
 * @description The distilled data the package keeps from parsed pack inputs. Pure; the same inputs give the same bytes.
 * @param {object} inputs The parsed pack inputs. @returns {object} { about, provenance: { written_at, kernel_commit }, programs }.
 */
function distil(inputs) {
  if (!inputs || !Array.isArray(inputs.programs) || inputs.programs.length === 0) throw invalid('the inputs have no programs');
  const [writtenAt] = lines([inputs.written_at], 'written_at', 64);
  if (typeof inputs.kernel_commit !== 'string' || !COMMIT.test(inputs.kernel_commit)) throw invalid('kernel_commit is not a commit');
  const programs = inputs.programs.map(programOf);
  const keys = programs.map((entry) => `${entry.platform}/${entry.program}/${entry.bridge}`);
  if (new Set(keys).size !== keys.length) throw invalid('a program is named twice for the same platform and bridge');
  return { about: ABOUT, provenance: { written_at: writtenAt, kernel_commit: inputs.kernel_commit }, programs };
}

/**
 * @description The distilled data of several inputs files, merged in order: each file's provenance with the file it
 *   came from, and every program. Pure. @param {Array<{from: string, inputs: object}>} sources The inputs and their names.
 * @returns {object} { about, provenance: [{ inputs, written_at, kernel_commit }], programs }.
 * @throws {Error} When there are none, one cannot be distilled, or a program is named twice for one platform and bridge.
 */
function distilAll(sources) {
  if (!Array.isArray(sources) || sources.length === 0) throw invalid('there are no pack inputs to distil');
  const provenance = [];
  const programs = [];
  for (const { from, inputs } of sources) {
    const one = distil(inputs);
    provenance.push({ inputs: from, ...one.provenance });
    programs.push(...one.programs);
  }
  const keys = programs.map((entry) => `${entry.platform}/${entry.program}/${entry.bridge}`);
  if (new Set(keys).size !== keys.length) throw invalid('a program is named twice for the same platform and bridge');
  return { about: ABOUT, provenance, programs };
}

/**
 * @description How provenance names an inputs file: its path in this package, else its file name (a host's own
 *   folders are not written into the committed file). @param {string} file The path. @returns {string} The name.
 */
function inputsName(file) {
  const inside = path.relative(PACKAGE, file);
  return inside && !inside.startsWith('..') && !path.isAbsolute(inside) ? inside.split(path.sep).join('/') : path.basename(file);
}

/**
 * @description The distilled file's bytes: two-space JSON with one trailing newline.
 * @param {object} distilled What distil returned. @returns {string} The file text.
 */
function render(distilled) {
  return `${JSON.stringify(distilled, null, 2)}\n`;
}

/**
 * @description Read and parse the inputs, bounded in size.
 * @param {string} file The inputs' path. @returns {object} The parsed inputs.
 */
function readInputs(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { throw invalid(`there are no pack inputs at ${file}`); }
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INPUTS_BYTES) throw invalid(`${file} is not a bounded regular file`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw invalid(`${file} is not JSON`); }
}

/**
 * @description The command line's arguments.
 * @param {string[]} argv Arguments after the script. @returns {{check: boolean, out: string, inputs: string[]}} What to do.
 */
function options(argv) {
  const chosen = { check: false, out: DEFAULT_OUT, inputs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') chosen.check = true;
    else if (arg === '--out' && argv[index + 1]) chosen.out = path.resolve(argv[(index += 1)]);
    else if (!arg.startsWith('--')) chosen.inputs.push(path.resolve(arg));
    else throw invalid(`unknown argument ${arg}`);
  }
  if (chosen.inputs.length === 0) chosen.inputs = DEFAULT_SOURCES.slice();
  return chosen;
}

/**
 * @description Whether two distilled files hold the same programs, whatever date and commit they record.
 * @param {string} held The committed file's text. @param {string} expected What the inputs give now. @returns {boolean} Same programs.
 */
function samePrograms(held, expected) {
  try {
    const without = (text) => JSON.stringify({ ...JSON.parse(text), provenance: null });
    return without(held) === without(expected);
  } catch {
    return false;
  }
}

/**
 * @description Write the distilled file, or with --check say whether the committed one is what the inputs files give now.
 * @param {string[]} argv Arguments after the script. @param {{log: Function, error: Function}} [out] Where to report.
 * @returns {number} 0 when written or current; 1 when it differs or the inputs cannot be read.
 */
function main(argv, out = console) {
  try {
    const chosen = options(argv);
    const named = chosen.inputs.join(' ');
    const expected = render(distilAll(chosen.inputs.map((file) => ({ from: inputsName(file), inputs: readInputs(file) }))));
    if (!chosen.check) {
      fs.writeFileSync(chosen.out, expected);
      out.log(`program-facts: wrote ${path.basename(chosen.out)} from ${named}`);
      return 0;
    }
    const held = fs.existsSync(chosen.out) ? fs.readFileSync(chosen.out, 'utf8') : null;
    if (held !== null && samePrograms(held, expected)) {
      out.log(`program-facts: ${path.basename(chosen.out)} is what ${named} gives now`);
      return 0;
    }
    out.error(`program-facts: ${path.basename(chosen.out)} is ${held === null ? 'missing' : 'stale'}; `
      + `run: node scripts/program-facts.cjs ${named}`);
    return 1;
  } catch (error) {
    out.error(`program-facts: ${error.message}`);
    return 1;
  }
}

module.exports = { distil, distilAll, render, main, DEFAULT_INPUTS, DEFAULT_SOURCES, LANE_G_INPUTS, LINUX_INPUTS, WINDOWS_INPUTS, GODOT_INPUTS, BLENDER_INPUTS, VSCODE_INPUTS, DEFAULT_OUT };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
