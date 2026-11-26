#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Refuse a package Test Lab catalog the kernel cannot parse. The kernel reads a declared catalog with serde_yaml 0.9 (oshal-kernel crates/packages/src/test_catalog.rs) and answers "the catalog is not valid YAML" for the whole package, so its Test Lab shows nothing. Twelve catalogs went out that way on 2026-11-19 and 2026-11-20 (aero-lab, animatronics, cad-studio, camera, circuit-lab, create, drone, drone-relay, embodied, little-monsters, pumpkin, sat-ops): an unquoted value holding ": " (```tool_call {"tool": ...}```, `hideChatPanel: false`, `{ flipX: false }`). No check that runs here parsed them: scripts/check-test-catalogs.mjs needs the retired platform checkout and is reported SKIPPED by the local gate. This check needs no framework. Each catalog must pass libyaml, the parser serde_yaml 0.9 embeds (unsafe-libyaml, a translation of libyaml 0.2.5), reached through python3's PyYAML CSafeLoader, and js-yaml with the JSON schema, the parser the framework loader uses. Both legs are needed: js-yaml reads YAML 1.2 and accepts text libyaml refuses (a U+2028 or U+0085 inside a plain value, which YAML 1.1 reads as a line break; an implicit key over 1024 characters), and libyaml accepts a duplicate key js-yaml refuses. On top of the parse it holds the shape serde_yaml needs to give the kernel a JSON value: one document, no application tag, no list or mapping as a key, and a top-level cases list. A missing python3 or libyaml refuses the run, and the entry point is compared as a real path so a start through a linked folder still judges: it never passes unchecked.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Find a python3 that has libyaml instead of taking the first on PATH. In the store gate both steps failed with "this python3 has no PyYAML built with libyaml": scripts/store-gate-services.sh puts Career's fixture virtual environment (~/.local/state/oshal-test-fixtures/career-node24/python/bin, no PyYAML) first on PATH. The check now tries python3 on PATH, then /usr/bin/python3, uses the first that has yaml.CSafeLoader, and refuses, naming each interpreter and why, only when none has it.
 *
 * Usage: node scripts/check-test-catalog-yaml.mjs [storeRoot]
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CONVENTIONAL_CATALOG } from './check-test-catalogs.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The libyaml leg, run by python3 in isolated mode (-I: no environment, user site or working-directory
 * imports). It reads a JSON list of files on stdin and prints one JSON object: file -> problem or null.
 * It walks libyaml's own events, so it judges the parse and never constructs values (PyYAML's YAML 1.1
 * timestamp and boolean typing is not what serde_yaml does, and a construction error would be a false red).
 */
const LIBYAML_PROGRAM = String.raw`
import json, sys
try:
    import yaml
    LOADER = yaml.CSafeLoader
except (ImportError, AttributeError):
    print(json.dumps({"unavailable": "this python3 has no PyYAML built with libyaml (yaml.CSafeLoader)"}))
    sys.exit(0)
CORE = {"tag:yaml.org,2002:" + name for name in ("str", "int", "float", "bool", "null", "seq", "map")}

def where(error):
    mark = getattr(error, "problem_mark", None) or getattr(error, "context_mark", None)
    words = "; ".join(part for part in (getattr(error, "problem", None), getattr(error, "context", None)) if part)
    return ("line %d, column %d: %s" % (mark.line + 1, mark.column + 1, words)) if mark else (words or str(error))

def shape(text):
    stack, anchors, documents = [], {}, 0
    for event in yaml.parse(text, Loader=LOADER):
        if isinstance(event, yaml.DocumentStartEvent):
            documents += 1
            if documents > 1:
                return "it holds more than one YAML document"
        if isinstance(event, yaml.CollectionEndEvent):
            stack.pop()
            continue
        if not isinstance(event, yaml.NodeEvent):
            continue
        is_key = bool(stack) and stack[-1][0] == "map" and stack[-1][1] % 2 == 0
        if stack:
            stack[-1][1] += 1
        line = event.start_mark.line + 1
        tag = getattr(event, "tag", None)
        if tag is not None and tag not in CORE:
            return "line %d: the tag %s, which the kernel's parser cannot turn into a plain value" % (line, tag)
        collection = isinstance(event, yaml.CollectionStartEvent)
        if isinstance(event, yaml.AliasEvent):
            collection = anchors.get(event.anchor, False)
        elif event.anchor is not None:
            anchors[event.anchor] = collection
        if is_key and collection:
            return "line %d: a list or mapping used as a key, which the kernel reads only as text" % line
        if isinstance(event, yaml.CollectionStartEvent):
            stack.append(["map" if isinstance(event, yaml.MappingStartEvent) else "seq", 0])
    node = yaml.compose(text, Loader=LOADER)
    if not isinstance(node, yaml.MappingNode):
        return "the catalog has no cases list (its top level is not a mapping)"
    cases = [value for key, value in node.value if isinstance(key, yaml.ScalarNode) and key.value == "cases"]
    if not cases or not isinstance(cases[-1], yaml.SequenceNode):
        return "the catalog has no cases list"
    return None

result = {}
for file in json.load(sys.stdin):
    try:
        with open(file, encoding="utf-8") as handle:
            text = handle.read()
    except (OSError, UnicodeDecodeError) as error:
        result[file] = "it cannot be read as UTF-8 text: %s" % error
        continue
    try:
        result[file] = shape(text)
    except yaml.YAMLError as error:
        result[file] = where(error)
print(json.dumps(result))
`;

/** What a failing catalog's author does about it, printed once under the problems. */
export const HINT = 'Quote the value (single quotes keep backticks, braces, double quotes and # as written; write \'\' for a quote inside):'
  + ' a plain value may not hold ": " or " #", nor start with a backtick, @, %, ! or a quote it does not close.';

/**
 * @description js-yaml from the gate's own toolchain (never the retired platform checkout).
 * @param {string} root The store root, whose scripts/toolchain holds the pinned js-yaml.
 * @returns {{ load: Function, JSON_SCHEMA: object }} The js-yaml module.
 */
export function toolchainYaml(root = REPOSITORY_ROOT) {
  const toolchain = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(root, 'scripts', 'toolchain'));
  try {
    return createRequire(path.join(toolchain, 'package.json'))('js-yaml');
  } catch (error) {
    throw new Error(`No js-yaml in the gate toolchain ${toolchain} (run: npm ci --prefix scripts/toolchain) - refusing rather than passing unchecked: ${error.message}`);
  }
}

/**
 * @description Every package catalog the kernel would read, plus a conventional one the manifest does
 *   not declare (judged anyway, so the day it is declared cannot be the day it breaks). Discovery is
 *   structural: every top-level directory holding an oshal-app.yaml.
 * @param {string} storeRoot The store root.
 * @param {{ load: Function }} yaml js-yaml, for reading the manifests.
 * @returns {{ app: string, catalog: string, file: string, problems: string[] }[]} One entry per catalog;
 *   a manifest that does not parse is an entry with its problem and no file.
 */
export function storeCatalogs(storeRoot, yaml) {
  const entries = [];
  const folders = fs.readdirSync(storeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && fs.existsSync(path.join(storeRoot, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort();
  for (const app of folders) {
    let manifest;
    try {
      manifest = yaml.load(fs.readFileSync(path.join(storeRoot, app, 'oshal-app.yaml'), 'utf8'));
    } catch (error) {
      entries.push({ app, catalog: 'oshal-app.yaml', file: '', problems: [`${app}: oshal-app.yaml does not parse: ${String(error.message).split('\n')[0]}`] });
      continue;
    }
    const declared = typeof manifest?.testing?.catalog === 'string' ? manifest.testing.catalog : '';
    const catalog = declared || CONVENTIONAL_CATALOG;
    const file = path.join(storeRoot, app, catalog);
    if (!fs.existsSync(file)) {
      if (declared) entries.push({ app, catalog, file: '', problems: [`${app}: the declared catalog ${catalog} is missing`] });
      continue;
    }
    entries.push({ app, catalog, file, problems: [] });
  }
  return entries;
}

/**
 * Interpreters tried for the libyaml leg, in order: python3 on PATH, then the system one. The gate puts a
 * suite's own virtual environment first on PATH (Career's fixture Python, which has no PyYAML), so the
 * first python3 found is not always one that can parse; the first that has yaml.CSafeLoader is used.
 */
export const PYTHONS = ['python3', '/usr/bin/python3'];

/**
 * @description Run the libyaml program with one interpreter.
 * @param {string} python The interpreter.
 * @param {string[]} files Absolute catalog paths.
 * @returns {{ result?: Record<string, string|null>, missing?: string }} The verdicts, or why this
 *   interpreter could not give them.
 */
function runLibyaml(python, files) {
  const run = spawnSync(python, ['-I', '-c', LIBYAML_PROGRAM], { input: JSON.stringify(files), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (run.error || run.status !== 0) {
    return { missing: `${python}: ${run.error ? run.error.message : (run.stderr || `exit ${run.status}`).trim()}` };
  }
  const result = JSON.parse(run.stdout);
  return result.unavailable ? { missing: `${python}: ${result.unavailable}` } : { result };
}

/**
 * @description Parse files with libyaml through python3's PyYAML CSafeLoader, the C parser serde_yaml
 *   0.9 carries as unsafe-libyaml, and hold the shape serde_yaml needs to make a JSON value.
 * @param {string[]} files Absolute catalog paths.
 * @param {{ pythons?: string[] }} [options] Interpreters to try in order (PYTHONS by default).
 * @returns {Record<string, string|null>} Each file's problem, or null when the kernel's parser reads it.
 * @throws {Error} When no interpreter has the libyaml binding: a parser that did not run is never a pass.
 */
export function libyamlProblems(files, { pythons = PYTHONS } = {}) {
  if (!files.length) return {};
  const missing = [];
  for (const python of pythons) {
    const attempt = runLibyaml(python, files);
    if (attempt.result) return attempt.result;
    missing.push(attempt.missing);
  }
  throw new Error(`The libyaml leg did not run (${missing.join('; ')}) - install python3 with PyYAML built on libyaml; refusing rather than passing unchecked`);
}

/**
 * @description Parse one catalog with js-yaml under the JSON schema, as the framework loader does.
 * @param {string} file Absolute catalog path.
 * @param {{ load: Function, JSON_SCHEMA: object }} yaml js-yaml.
 * @returns {string|null} The problem, or null when it parses with a cases list.
 */
export function jsYamlProblem(file, yaml) {
  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    return String(error.message).split('\n')[0];
  }
  return Array.isArray(parsed?.cases) ? null : 'the catalog has no cases list';
}

/**
 * @description Judge every package catalog in a store with both parsers.
 * @param {string} storeRoot The store root.
 * @param {{ yaml?: object, pythons?: string[] }} [options] js-yaml and the interpreters, for tests.
 * @returns {{ catalogs: number, problems: string[] }} How many catalogs were read and every problem found.
 */
export function storeYamlProblems(storeRoot, { yaml = toolchainYaml(), pythons } = {}) {
  const entries = storeCatalogs(path.resolve(storeRoot), yaml);
  const readable = entries.filter((entry) => entry.file);
  const strict = libyamlProblems(readable.map((entry) => entry.file), { pythons });
  const problems = entries.flatMap((entry) => entry.problems);
  for (const entry of readable) {
    const kernel = strict[entry.file];
    if (kernel) problems.push(`${entry.app}: ${entry.catalog} is refused by the kernel's parser (libyaml, as serde_yaml reads it): ${kernel}`);
    const framework = jsYamlProblem(entry.file, yaml);
    if (framework) problems.push(`${entry.app}: ${entry.catalog} is refused by js-yaml (the framework loader's parser): ${framework}`);
  }
  return { catalogs: readable.length, problems };
}

/**
 * @description Fail the gate when any package catalog would not parse in the kernel or the framework.
 *   Finding no catalog at all is a refusal: an empty walk must never read as green.
 * @param {string} storeRoot The store root.
 * @returns {void} Sets process.exitCode to 1 on any problem.
 */
export function main(storeRoot = REPOSITORY_ROOT) {
  const { catalogs, problems } = storeYamlProblems(storeRoot);
  if (!catalogs) problems.push(`no package Test Lab catalog was found under ${storeRoot} - refusing a vacuous pass`);
  if (problems.length) {
    console.error(`Package test catalogs that do not parse as the kernel parses them (${problems.length}):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(HINT);
    process.exitCode = 1;
    return;
  }
  console.log(`Package test catalogs parse in libyaml (the kernel's serde_yaml parser) and js-yaml: ${catalogs} catalogs`);
}

/**
 * @description Whether this file is the program node was asked to run. Compared as real paths: node
 *   reports the resolved file in import.meta.url, so a check started through a linked scripts folder
 *   would otherwise skip main() and exit 0 having judged nothing.
 * @returns {boolean} True when this module is the entry point.
 */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    main(process.argv[2] ? path.resolve(process.argv[2]) : REPOSITORY_ROOT);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
