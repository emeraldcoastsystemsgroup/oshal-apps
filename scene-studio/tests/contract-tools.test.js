/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the tool contract the manifest, the routes and the engine
 *                     |                             | share: the api's allowlists, templates and export formats equal the
 *                     |                             | engine's (engine/scene_ops.py, read by the runner's python3); a tool
 *                     |                             | call's body becomes MCP arguments with the framework's fields
 *                     |                             | dropped and an engine-owned argument REFUSED; every manifest tool
 *                     |                             | names a route the router declares, each godot-/blender- tool names an
 *                     |                             | allowlisted upstream tool, and deleting a project is not a tool.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.1.1: the director's persona authorizes exactly the manifest's tools
 *                     |                             | (auto) and turns the generic shell and file tools off. Without the
 *                     |                             | block, install seeded no agent_tools rows and every tool call the
 *                     |                             | director made was refused as unregistered.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | 0.2.0: the tools are in-process package tools now, so the route
 *                     |                             | mapping gives way to the guard against going back: all 22 declare
 *                     |                             | exactly { executorType: builtin, builtinKey: package }, auto and
 *                     |                             | authGroup scene-studio, with no apiEndpoint and no type; the
 *                     |                             | handlers' specs name exactly the manifest's tools in order; the
 *                     |                             | godot targets cover the 7 allowlisted godot-mcp tools and the
 *                     |                             | blender targets are allowlisted; no tool deletes a project. Input
 *                     |                             | schemas stay open (core passes tool input raw; readToolInput closes
 *                     |                             | it server-side) and every tool's description plus usage fits the
 *                     |                             | node bridge's 1024-character budget, because on the director's node
 *                     |                             | that text is the model's only guide to the tool. The persona's
 *                     |                             | perspective names only tools it is authorized for, with no shell,
 *                     |                             | script or secret instruction.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, request, parent, isMain);
};
const PKG = path.resolve(__dirname, '..');
const contract = require(path.join(PKG, 'routes', 'tool-contract.js'));
const { RequestError } = require(path.join(PKG, 'routes', 'project-service.js'));
const { SCENE_TOOL_SPECS } = require(path.join(PKG, 'routes', 'tool-input.js'));

function engineTables() {
  const script = `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.join(PKG, 'engine'))})\nimport scene_ops as s\n` +
    'print(json.dumps({"godot": sorted(s.GODOT_TOOLS), "blender_file": sorted(k for k, v in s.BLENDER_TOOLS.items() if v["file"]),' +
    ' "blender_docs": sorted(k for k, v in s.BLENDER_TOOLS.items() if not v["file"]), "templates": {k: list(v) for k, v in s.TEMPLATES.items()},' +
    ' "exports": {k: sorted(v) for k, v in s.EXPORT_FORMATS.items()}}))';
  return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
}

test('the api allowlists, templates and export formats equal the engine tables', () => {
  const engine = engineTables();
  assert.deepEqual([...contract.GODOT_TOOLS].sort(), engine.godot);
  assert.deepEqual([...contract.BLENDER_PROJECT_TOOLS].sort(), engine.blender_file);
  assert.deepEqual([...contract.BLENDER_DOC_TOOLS].sort(), engine.blender_docs);
  assert.deepEqual({ godot: [...contract.TEMPLATES.godot], blender: [...contract.TEMPLATES.blender] }, engine.templates);
  assert.deepEqual({ godot: [...contract.EXPORT_FORMATS.godot].sort(), blender: [...contract.EXPORT_FORMATS.blender].sort() }, engine.exports);
  assert.equal(contract.GODOT_TOOLS.includes('launch_editor'), false, 'the GUI editor is never launched in the engine');
  assert.equal(contract.GODOT_TOOLS.includes('list_projects'), false, 'godot-mcp never browses the engine filesystem');
});

test('a tool body becomes MCP arguments: framework fields dropped, nested arguments honoured', () => {
  assert.deepEqual(contract.toolArguments({ projectId: 'p', timeoutMs: 9, headers: { a: 1 }, method: 'GET', body: {}, confirm: true, scenePath: 'main.tscn', nodeName: 'Lamp' }),
    { scenePath: 'main.tscn', nodeName: 'Lamp' });
  assert.deepEqual(contract.toolArguments({ projectId: 'p', arguments: { scenePath: 'x.tscn' }, scenePath: 'ignored' }), { scenePath: 'x.tscn' });
  assert.deepEqual(contract.toolArguments({ tool: 'search_api_docs', query: 'mesh' }, ['tool']), { query: 'mesh' });
});

test('an argument the engine owns is refused, never forwarded', () => {
  for (const body of [{ projectPath: '/etc' }, { arguments: { projectPath: '/' } }, { blend_file: '/tmp/x.blend' }, { arguments: { blend_file: 'a' } }]) {
    assert.throws(() => contract.toolArguments(body), (e) => e instanceof RequestError && /set by Scene Studio/.test(e.message));
  }
});

/** The manifest's tools in order: name -> the lines of its declaration (a line scan of the tools: block, no YAML dependency). */
function manifestTools() {
  const text = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const block = text.slice(text.indexOf('\ntools:\n'), text.indexOf('\nui:\n'));
  const tools = new Map();
  let current = null;
  for (const line of block.split('\n')) {
    const name = /^  - name: ([a-z0-9-]+)\s*$/.exec(line);
    if (name) { current = name[1]; tools.set(current, []); continue; }
    if (current) tools.get(current).push(line);
  }
  return tools;
}

const field = (lines, key) => lines.map((line) => new RegExp(`^    ${key}: (.*)$`).exec(line)).find(Boolean)?.[1]?.trim();
/** The node's tool bridge sends description + ' Usage: ' + usageInstructions, cut at this many characters (core internal-tool-bridge-routes.ts). */
const BRIDGE_DESCRIPTION_BUDGET = 1024;
/** A `>-` folded scalar under a tool key, joined the way YAML folds it. */
function folded(lines, key) {
  const start = lines.findIndex((line) => line === `    ${key}: >-`);
  if (start < 0) return field(lines, key) || '';
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^      \S/.test(line)) break;
    body.push(line.trim());
  }
  return body.join(' ');
}

test('every manifest tool is an in-process package tool: builtin/package exactly, auto, one auth group, no route', () => {
  const tools = manifestTools();
  assert.equal(tools.size, 22);
  for (const [name, lines] of tools) {
    assert.equal(field(lines, 'executor'), '{ executorType: builtin, builtinKey: package }', `${name}: executor`);
    assert.equal(field(lines, 'defaultAuthMode'), 'auto', `${name}: defaultAuthMode`);
    assert.equal(field(lines, 'requiresApproval'), 'false', `${name}: requiresApproval`);
    assert.equal(field(lines, 'authGroup'), 'scene-studio', `${name}: authGroup`);
    assert.equal(field(lines, 'type'), undefined, `${name}: a package tool declares no type`);
    assert.equal(field(lines, 'timeoutMs'), undefined, `${name}: timeoutMs bounds only an ASK approval wait, never execution`);
    assert.equal(lines.some((line) => /apiEndpoint|cliCommand|executorType: api/.test(line)), false, `${name}: no route or CLI transport`);
    assert.match(field(lines, 'tags'), /^\[scene-studio, package-tool(, (godot|blender)-mcp)?\]$/, `${name}: tags`);
    assert.equal(lines.some((line) => /additionalProperties/.test(line)), false,
      `${name}: input schemas stay open; core passes tool input raw and readToolInput closes it server-side`);
    const bridged = [field(lines, 'description'), `Usage: ${folded(lines, 'usageInstructions')}`].join(' ');
    assert.ok(bridged.length <= BRIDGE_DESCRIPTION_BUDGET,
      `${name}: description + usage is ${bridged.length} characters; the node bridge cuts it at ${BRIDGE_DESCRIPTION_BUDGET}`);
  }
});

test("the handlers' specs name exactly the manifest's tools, in manifest order", () => {
  assert.deepEqual(SCENE_TOOL_SPECS.map((spec) => spec.name), [...manifestTools().keys()]);
  for (const spec of SCENE_TOOL_SPECS) {
    for (const key of spec.required) assert.ok(spec.keys.includes(key), `${spec.name}: required ${key} is an accepted key`);
    for (const forbidden of ['userSub', 'tenantId', 'arguments', 'projectPath', 'blend_file']) assert.equal(spec.keys.includes(forbidden), false, `${spec.name} must not accept ${forbidden}`);
  }
});

test('each godot-/blender- tool targets an allowlisted upstream tool; deleting a project is not a tool', () => {
  const godot = SCENE_TOOL_SPECS.filter((spec) => spec.target?.server === 'godot').map((spec) => spec.target.tool);
  const blender = SCENE_TOOL_SPECS.filter((spec) => spec.target?.server === 'blender').map((spec) => spec.target.tool);
  for (const tool of godot) assert.ok(contract.GODOT_TOOLS.includes(tool), `godot ${tool}`);
  for (const tool of blender) assert.ok(contract.BLENDER_PROJECT_TOOLS.includes(tool), `blender ${tool}`);
  assert.deepEqual([...godot].sort(), [...contract.GODOT_TOOLS].sort(), 'every allowlisted godot-mcp tool has exactly one package tool');
  for (const spec of SCENE_TOOL_SPECS) if (spec.target) assert.ok(spec.name.startsWith(`${spec.target.server}-`), `${spec.name} names its server`);
  assert.equal(SCENE_TOOL_SPECS.some((spec) => /delete-project|project-delete|remove-project/.test(spec.name)), false);
  const handlers = fs.readFileSync(path.join(PKG, 'src-routes', 'scene-tools.ts'), 'utf8');
  assert.equal(/deleteProject|removeProjectFiles/.test(handlers), false, 'no tool handler can delete a project');
});

/** The persona's `authorizations:` block as {tool: mode} (a line scan, no YAML dependency). */
function personaAuthorizations() {
  const text = fs.readFileSync(path.join(PKG, 'personas', 'scene-studio-director.yaml'), 'utf8');
  const lines = text.slice(text.indexOf('\nauthorizations:\n') + 1).split('\n').slice(1);
  const out = {};
  for (const line of lines) {
    const m = /^  ([a-z0-9_-]+): "(auto|ask|off)"\s*$/.exec(line);
    if (!m) break;
    out[m[1]] = m[2];
  }
  return out;
}

test("the director's persona authorizes exactly the manifest's tools, and nothing generic", () => {
  const auth = personaAuthorizations();
  const manifest = [...manifestTools().keys()].sort();
  assert.deepEqual(Object.keys(auth).filter((t) => auth[t] === 'auto').sort(), manifest, 'every manifest tool, auto — and only those');
  assert.equal(auth.bash, 'off');
  assert.equal(auth.write_file, 'off');
});

/** The persona's `perspective: |` block (its system prompt), as text. */
function personaPerspective() {
  const text = fs.readFileSync(path.join(PKG, 'personas', 'scene-studio-director.yaml'), 'utf8');
  return text.slice(text.indexOf('\nperspective: |\n') + '\nperspective: |\n'.length);
}

test("the director's perspective names only tools it is authorized for, with no shell, script or secret instruction", () => {
  const auth = personaAuthorizations();
  const manifest = new Set(manifestTools().keys());
  const named = [...personaPerspective().matchAll(/`((?:scene|godot|blender)-[a-z0-9-]+)`/g)].map(([, name]) => name);
  assert.ok(named.length >= 22, 'the perspective names its tools');
  for (const name of named) {
    assert.equal(auth[name], 'auto', `${name} is named in the perspective but not authorized auto`);
    assert.ok(manifest.has(name), `${name} is not a manifest tool`);
  }
  const perspective = personaPerspective();
  for (const forbidden of ['node /app/scripts', 'curl ', '$SWARM_', 'SWARM_SERVICE_SECRET', 'execute_command']) {
    assert.equal(perspective.includes(forbidden), false, `the perspective must not say ${forbidden}`);
  }
  assert.equal(/\bbash\b/.test(perspective), false, 'the perspective must not instruct shell use');
});
