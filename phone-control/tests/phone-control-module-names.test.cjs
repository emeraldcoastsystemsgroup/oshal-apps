/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.5.3: every name a phone-control browser module uses resolves. 1.5.2's tools/session-computer.js called isTvNode, which tools/computer-link.js exports, without importing it, and Your devices answered "could not be read: isTvNode is not defined" on Roger's phone; the text scans in the other suites never parse a module, so nothing caught it. This guard parses every tools/*.js and tools/*.mjs with the TypeScript checker the store pins (scripts/toolchain) against the browser's own globals (DOM and ES2023) and fails on any executable name that is neither declared, imported nor a browser global; and on a name a sibling module exports that a module leaves to a browser global of the same name instead of importing it. Two in-memory copies prove each check goes red: session-computer.js with isTvNode taken out of its import (the 1.5.2 shape), and a module that calls close() where a sibling exports close.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLS = path.join(PKG, 'tools');
const TYPESCRIPT = path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules', 'typescript');
const ts = (() => { try { return require(TYPESCRIPT); } catch { return null; } })();
// "Cannot find name" in its forms: plain, did-you-mean, member hints, missing type packages, and a shorthand property with no value.
const UNRESOLVED = new Set([2304, 2552, 2580, 2581, 2582, 2583, 2584, 2591, 2592, 2593, 2662, 2663, 18004]);

/** @description The browser modules the page loads, as absolute paths. @returns {string[]} tools/*.js and tools/*.mjs. */
function browserModules() {
  return fs.readdirSync(TOOLS).filter((name) => /\.(js|mjs)$/.test(name)).sort().map((name) => path.join(TOOLS, name));
}

/** @description A checker over the given modules, with in-memory text replacing any file named in overlay. @param {string[]} files Absolute paths. @param {Map<string,string>} overlay Path to text. @returns {object} The TypeScript program. */
function programFor(files, overlay = new Map()) {
  const options = {
    allowJs: true, checkJs: true, noEmit: true, noResolve: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts']
  };
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, create) => (overlay.has(name)
    ? ts.createSourceFile(name, overlay.get(name), version, true)
    : getSourceFile(name, version, onError, create));
  host.fileExists = ((exists) => (name) => overlay.has(name) || exists(name))(host.fileExists.bind(host));
  host.readFile = ((readFile) => (name) => (overlay.has(name) ? overlay.get(name) : readFile(name)))(host.readFile.bind(host));
  return ts.createProgram(files, options, host);
}

/** @description Start positions of identifiers in running code (JSDoc type names are not visited). @param {object} sf Source file. @returns {Map<number,object>} Start to identifier. */
function executableIdentifiers(sf) {
  const found = new Map();
  (function walk(node) {
    if (ts.isIdentifier(node)) found.set(node.getStart(sf), node);
    ts.forEachChild(node, walk);
  })(sf);
  return found;
}

/** @description Where a finding is, as tools/<file>:<line>. @param {object} sf Source file. @param {number} start Position. @returns {string} Location. */
function where(sf, start) {
  return `tools/${path.basename(sf.fileName)}:${sf.getLineAndCharacterOfPosition(start).line + 1}`;
}

/** @description Names used in running code that resolve to nothing. @param {object} program Checker program. @param {string[]} files The modules to report on. @returns {string[]} "tools/x.js:12 name" findings. */
function unresolvedNames(program, files) {
  const findings = [];
  for (const file of files) {
    const sf = program.getSourceFile(file);
    const identifiers = executableIdentifiers(sf);
    for (const diagnostic of program.getSemanticDiagnostics(sf)) {
      if (!UNRESOLVED.has(diagnostic.code) || !identifiers.has(diagnostic.start)) continue;
      findings.push(`${where(sf, diagnostic.start)} ${identifiers.get(diagnostic.start).text}`);
    }
  }
  return findings;
}

/** @description Whether an identifier is a name looked up in scope, not a property, key, label or import alias. @param {object} id Identifier. @returns {boolean} True for a scope lookup. */
function scopeLookup(id) {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isQualifiedName(parent) && parent.right === id) return false;
  if ((ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isBindingElement(parent)) && parent.propertyName === id) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  const named = ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)
    || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent);
  return !(named && parent.name === id);
}

/** @description Each module's exported names. @param {object} program Checker program. @param {string[]} files Modules. @returns {Map<string,string[]>} Export name to the modules that export it. */
function exportsByName(program, files) {
  const checker = program.getTypeChecker();
  const owners = new Map();
  for (const file of files) {
    const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(file));
    for (const symbol of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
      if (symbol.name === 'default') continue;
      owners.set(symbol.name, [...(owners.get(symbol.name) || []), path.basename(file)]);
    }
  }
  return owners;
}

/** @description Names a sibling module exports that a module leaves to the browser's global of the same name. @param {object} program Checker program. @param {string[]} files Modules. @returns {string[]} Findings. */
function shadowedSiblingNames(program, files) {
  const checker = program.getTypeChecker();
  const owners = exportsByName(program, files);
  const findings = [];
  for (const file of files) {
    const sf = program.getSourceFile(file);
    for (const id of executableIdentifiers(sf).values()) {
      const exporters = (owners.get(id.text) || []).filter((name) => name !== path.basename(file));
      if (!exporters.length || !scopeLookup(id)) continue;
      const symbol = ts.isShorthandPropertyAssignment(id.parent)
        ? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id);
      const declarations = symbol?.declarations || [];
      if (declarations.length && declarations.every((d) => program.isSourceFileDefaultLibrary(d.getSourceFile()))) {
        findings.push(`${where(sf, id.getStart(sf))} ${id.text} is the browser's global, but ${exporters.join(', ')} exports it`);
      }
    }
  }
  return findings;
}

const toolchain = () => assert.ok(ts, `typescript is required at ${TYPESCRIPT}: run npm ci --prefix scripts/toolchain`);

test('every name a phone-control browser module uses is declared, imported or a browser global', () => {
  toolchain();
  const files = browserModules();
  assert.ok(files.includes(path.join(TOOLS, 'session-computer.js')) && files.length >= 10, `the page's modules are read (${files.length})`);
  assert.deepEqual(unresolvedNames(programFor(files), files), []);
});

test('a name a sibling module exports is imported, never left to the browser global of that name', () => {
  toolchain();
  const files = browserModules();
  assert.deepEqual(shadowedSiblingNames(programFor(files), files), []);
});

test('the guard goes red on the 1.5.2 shape: session-computer.js calling isTvNode without importing it', () => {
  toolchain();
  const files = browserModules();
  const target = path.join(TOOLS, 'session-computer.js');
  const fixed = fs.readFileSync(target, 'utf8');
  const broken = fixed.replace(/(import \{[^}]*?)\bisTvNode, ([^}]*\} from '\/api\/phone-control\/ui\/computer-link\.js';)/, '$1$2');
  assert.notEqual(broken, fixed, 'session-computer.js imports isTvNode from computer-link.js');
  const findings = unresolvedNames(programFor(files, new Map([[target, broken]])), files);
  assert.ok(findings.length >= 1 && findings.every((line) => /^tools\/session-computer\.js:\d+ isTvNode$/.test(line)), findings.join('\n'));
});

test('the guard goes red when a module calls close() that a sibling exports, leaving it to window.close', () => {
  toolchain();
  const sibling = path.join(TOOLS, '__guard-sibling.js');
  const caller = path.join(TOOLS, '__guard-caller.js');
  const overlay = new Map([
    [sibling, 'export function close(sheet) { sheet.hidden = true; }\n'],
    [caller, "import { workHref } from '/api/phone-control/ui/computer-link.js';\nexport function done(sheet) { close(sheet); return workHref(sheet.id); }\n"]
  ]);
  const files = [...browserModules(), sibling, caller];
  const program = programFor(files, overlay);
  assert.deepEqual(unresolvedNames(program, [caller]), [], 'close resolves, to the browser global');
  assert.deepEqual(shadowedSiblingNames(program, [sibling, caller]),
    ["tools/__guard-caller.js:2 close is the browser's global, but __guard-sibling.js exports it"]);
});
