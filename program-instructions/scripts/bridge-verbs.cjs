#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.0 (T76): distil the bridge fact sheet (Lane G's bridge-facts.json, written by make-bridge-facts.cjs from Orbit's compiled code) into lib/bridge-verbs.json: for each bridge word its computer.app action names and its declared verb ids by document kind, as the sheet groups them, with the sheet's generated_at, kernel_commit and generator. The writer's request and its text check read that file, so a pack names only verbs a bridge really has. Nothing in the file is typed by hand; --check exits 1 when the committed file differs from what the sheet gives now.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | --check compares the verbs and actions, not the sheet's date and commit: Lane G regenerates the sheet often with the same verbs, and each regeneration made the committed file stale.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.3 (Lane A4, T76 on Windows): the file is distilled from every sheet named, by default Lane G's Linux sheet and the package's own inputs/windows-bridge-facts.json (the windows-uia bridge: Word's and Excel's verbs as Orbit's Windows bridge declares them). Before it, windows-uia had no entry, so a Word text naming Word's own format-text was refused. `provenance` is now one entry for each sheet, with the sheet it came from; a bridge word two sheets name is refused.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane GD1): the package's own inputs/godot-bridge-facts.json is distilled too, after the Windows sheet: the godot bridge word Orbit's Linux reader gives a bound Godot editor, and the seventeen verbs Orbit's Godot add-on declares (desktop/oshal-node/src/main/bridges/godot-actions.ts). Before it, godot had no entry, so a Godot text naming add-node was refused.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane BL1): the package's own inputs/blender-bridge-facts.json joins the default sheets, after the Godot sheet: the blender bridge word Orbit's Linux reader gives a bound Blender, with the sixteen verbs Orbit's Blender add-on declares for the open .blend, each at the line of Orbit's code it is read from.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane VS1): the file is also distilled from the package's own inputs/vscode-bridge-facts.json, the vscode bridge (Orbit's VS Code extension: its twelve verbs as bridges/vscode-actions.ts declares them), last.
 *
 * Usage: node scripts/bridge-verbs.cjs [--check] [--out <file>] [<sheet> ...]
 *   <sheet>  a fact sheet; several are merged in order (default: OSHAL_BRIDGE_FACTS, else the coordinator's handover
 *            copy under the home folder, then the package's inputs/windows-bridge-facts.json,
 *            inputs/godot-bridge-facts.json, inputs/blender-bridge-facts.json and inputs/vscode-bridge-facts.json)
 *   --out    the distilled file (default: lib/bridge-verbs.json in this package)
 *   --check  write nothing; exit 1 when the file's verbs and actions are not what the sheet gives now. The sheet is
 *            regenerated often with the same verbs, so its date and commit alone never make the file stale.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Where Lane G writes the sheet on the coordinator's host. */
const DEFAULT_SHEET = process.env.OSHAL_BRIDGE_FACTS || path.join(os.homedir(), 'Documents', 'projects', 'oshal-handover',
  'lanes', 'linux-application-packs-2026-11-13', 'bridge-facts.json');
/** The package's own sheet for the windows-uia bridge, written from Orbit's code and the Windows PC's proofs. */
const PACKAGE = path.resolve(__dirname, '..');
const WINDOWS_SHEET = path.join(PACKAGE, 'inputs', 'windows-bridge-facts.json');
/** The package's own sheet for the godot bridge, written from Orbit's code and the real Godot suites. */
const GODOT_SHEET = path.join(PACKAGE, 'inputs', 'godot-bridge-facts.json');
/** The package's own sheet for the blender bridge (Orbit's Blender add-on), written from Orbit's code and the real-Blender suite. */
const BLENDER_SHEET = path.join(PACKAGE, 'inputs', 'blender-bridge-facts.json');
/** The package's own sheet for the vscode bridge (Orbit's VS Code extension, Lane VS1), written from Orbit's code and its real-VS Code suite. */
const VSCODE_SHEET = path.join(PACKAGE, 'inputs', 'vscode-bridge-facts.json');
/** Every sheet the committed file is distilled from, in order. */
const DEFAULT_SHEETS = Object.freeze([DEFAULT_SHEET, WINDOWS_SHEET, GODOT_SHEET, BLENDER_SHEET, VSCODE_SHEET]);
const DEFAULT_OUT = path.resolve(__dirname, '..', 'lib', 'bridge-verbs.json');
const MAX_SHEET_BYTES = 4 * 1024 * 1024;
/** A bridge word as the kernel keeps it in a program row. */
const BRIDGE = /^[a-z0-9.-]{1,32}$/;
/** A computer.app action name and a declared verb id as the kernel bounds them (MAX_ID_CHARS 64). */
const ACTION = /^[a-z][a-z0-9_-]{0,31}$/;
const VERB = /^[a-z][a-z0-9-]{0,63}$/;
/** A document kind label: printable ASCII, as the sheet writes them. */
const KIND = /^[ -~]{1,120}$/;
const ABOUT = 'Generated by program-instructions/scripts/bridge-verbs.cjs from the bridge fact sheets named in provenance; '
  + 'do not edit by hand. For each bridge word: its computer.app action names and its declared verb ids by document kind.';

/**
 * @description A sheet that cannot be distilled, named so the command line can tell it from a difference.
 * @param {string} message What is wrong. @returns {Error} The error, with code bridge_sheet_invalid.
 */
function invalid(message) {
  return Object.assign(new Error(message), { code: 'bridge_sheet_invalid' });
}

/**
 * @description One provenance field of the sheet: a non-empty line of text.
 * @param {object} sheet The parsed sheet. @param {string} key The field. @returns {string} Its value.
 */
function provenanceField(sheet, key) {
  const value = sheet[key];
  if (typeof value !== 'string' || !value.trim() || value.length > 300 || /[\u0000-\u001f]/.test(value)) {
    throw invalid(`the sheet's ${key} is not a line of text`);
  }
  return value;
}

/**
 * @description The declared verb ids of one bridge, grouped by document kind in the sheet's order.
 * @param {string} word The bridge word. @param {unknown} declared The sheet's declared block.
 * @returns {Record<string, string[]>} Kind label to verb ids.
 */
function declaredOf(word, declared) {
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) throw invalid(`bridge ${word} has no declared block`);
  const kinds = {};
  for (const [kind, verbs] of Object.entries(declared)) {
    if (!KIND.test(kind)) throw invalid(`bridge ${word} has a document kind that is not a short printable label`);
    if (!Array.isArray(verbs)) throw invalid(`bridge ${word}, kind ${kind}: the declared verbs are not a list`);
    const ids = verbs.map((verb) => (verb && typeof verb === 'object' ? verb.id : undefined));
    const bad = ids.find((id) => typeof id !== 'string' || !VERB.test(id));
    if (bad !== undefined || ids.length !== verbs.length) throw invalid(`bridge ${word}, kind ${kind}: a declared verb id is not of the kernel's shape`);
    if (new Set(ids).size !== ids.length) throw invalid(`bridge ${word}, kind ${kind}: a declared verb id repeats`);
    kinds[kind] = ids;
  }
  return kinds;
}

/**
 * @description The distilled data the package keeps from a parsed sheet. Pure; the same sheet gives the same bytes.
 * @param {object} sheet The parsed bridge fact sheet.
 * @returns {object} { about, provenance: { generated_at, kernel_commit, generator }, bridges }.
 */
function distil(sheet) {
  if (!sheet || typeof sheet !== 'object' || !sheet.bridges || typeof sheet.bridges !== 'object' || Array.isArray(sheet.bridges)) {
    throw invalid('the sheet has no bridges block');
  }
  const provenance = {};
  for (const key of ['generated_at', 'kernel_commit', 'generator']) provenance[key] = provenanceField(sheet, key);
  const bridges = {};
  for (const [word, bridge] of Object.entries(sheet.bridges)) {
    if (!BRIDGE.test(word)) throw invalid('a bridge word is not of the shape the kernel keeps');
    const actions = bridge && bridge.actions && typeof bridge.actions === 'object' ? Object.keys(bridge.actions) : null;
    if (!actions || actions.length === 0 || !actions.every((name) => ACTION.test(name))) throw invalid(`bridge ${word} has no usable action names`);
    bridges[word] = { actions, declared: declaredOf(word, bridge.declared) };
  }
  if (Object.keys(bridges).length === 0) throw invalid('the sheet names no bridge');
  return { about: ABOUT, provenance, bridges };
}

/**
 * @description The distilled data of several sheets, merged in order: each sheet's provenance with the sheet it came
 *   from, and every bridge. Pure. @param {Array<{from: string, sheet: object}>} sources The sheets and their names.
 * @returns {object} { about, provenance: [{ sheet, generated_at, kernel_commit, generator }], bridges }.
 * @throws {Error} When there is no sheet, one cannot be distilled, or two name the same bridge word.
 */
function distilAll(sources) {
  if (!Array.isArray(sources) || sources.length === 0) throw invalid('there is no sheet to distil');
  const provenance = [];
  const bridges = {};
  for (const { from, sheet } of sources) {
    const one = distil(sheet);
    for (const [word, bridge] of Object.entries(one.bridges)) {
      if (Object.prototype.hasOwnProperty.call(bridges, word)) throw invalid(`bridge ${word} is named by two sheets`);
      bridges[word] = bridge;
    }
    provenance.push({ sheet: from, ...one.provenance });
  }
  return { about: ABOUT, provenance, bridges };
}

/**
 * @description How provenance names a sheet: its path in this package, else its file name (a host's own folders are
 *   not written into the committed file). @param {string} file The sheet's path. @returns {string} The name.
 */
function sheetName(file) {
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
 * @description Read and parse the sheet, bounded in size.
 * @param {string} file The sheet's path. @returns {object} The parsed sheet.
 */
function readSheet(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { throw invalid(`there is no bridge fact sheet at ${file}`); }
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_SHEET_BYTES) throw invalid(`${file} is not a bounded regular file`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw invalid(`${file} is not JSON`); }
}

/**
 * @description The command line's arguments.
 * @param {string[]} argv Arguments after the script. @returns {{check: boolean, out: string, sheets: string[]}} What to do.
 */
function options(argv) {
  const chosen = { check: false, out: DEFAULT_OUT, sheets: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') chosen.check = true;
    else if (arg === '--out' && argv[index + 1]) chosen.out = path.resolve(argv[(index += 1)]);
    else if (!arg.startsWith('--')) chosen.sheets.push(path.resolve(arg));
    else throw invalid(`unknown argument ${arg}`);
  }
  if (chosen.sheets.length === 0) chosen.sheets = DEFAULT_SHEETS.slice();
  return chosen;
}

/**
 * @description Whether two distilled files give the same verbs and actions, whatever sheet date and commit they record.
 * @param {string} held The committed file's text. @param {string} expected What the sheet gives now.
 * @returns {boolean} True when everything but the provenance is the same.
 */
function sameVerbs(held, expected) {
  try {
    const without = (text) => JSON.stringify({ ...JSON.parse(text), provenance: null });
    return without(held) === without(expected);
  } catch {
    return false;
  }
}

/**
 * @description Write the distilled file, or with --check say whether the committed one is what the sheets give now.
 * @param {string[]} argv Arguments after the script.
 * @param {{log: Function, error: Function}} [out] Where to report (the console by default).
 * @returns {number} 0 when written or current; 1 when it differs or a sheet cannot be read.
 */
function main(argv, out = console) {
  try {
    const chosen = options(argv);
    const named = chosen.sheets.join(' ');
    const expected = render(distilAll(chosen.sheets.map((file) => ({ from: sheetName(file), sheet: readSheet(file) }))));
    if (!chosen.check) {
      fs.writeFileSync(chosen.out, expected);
      out.log(`bridge-verbs: wrote ${path.basename(chosen.out)} from ${named}`);
      return 0;
    }
    const held = fs.existsSync(chosen.out) ? fs.readFileSync(chosen.out, 'utf8') : null;
    if (held !== null && sameVerbs(held, expected)) {
      out.log(`bridge-verbs: ${path.basename(chosen.out)} is what ${named} gives now`);
      return 0;
    }
    out.error(`bridge-verbs: ${path.basename(chosen.out)} is ${held === null ? 'missing' : 'stale'}; `
      + `run: node scripts/bridge-verbs.cjs ${named}`);
    return 1;
  } catch (error) {
    out.error(`bridge-verbs: ${error.message}`);
    return 1;
  }
}

module.exports = { distil, distilAll, render, main, DEFAULT_SHEET, DEFAULT_SHEETS, WINDOWS_SHEET, GODOT_SHEET, BLENDER_SHEET, VSCODE_SHEET, DEFAULT_OUT };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
