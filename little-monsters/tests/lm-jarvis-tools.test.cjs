/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Jarvis inside Little Monsters. A student pressed the corner button expecting Jarvis, reached the textbook Tutor (the package's floating ui.assistant, with the Jarvis orb hidden by the page frame), and real Jarvis answered "This application cannot add a new class" because the package declared no tools. Pins: the six route-backed tools, a tool binding per tool equal to the HTTP binding of the route it calls, writes held for approval, every tool admitted to the student role, no floating assistant, a page frame that never hides the orb, and routing words that reach the tutor.
 *
 * Dependency-free node:test over the shipped manifest, authorization catalog and page frame.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(PKG, '../scripts/toolchain')] }));
const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
const catalog = yaml.load(fs.readFileSync(path.join(PKG, 'authorization.yaml'), 'utf8'));
const MOUNT = '/api/education';
const TOOLS = ['lm-my-classes', 'lm-add-class', 'lm-my-schedule', 'lm-my-assignments', 'lm-add-reminder', 'lm-remove-reminder'];
const WRITES = new Set(['lm-add-class', 'lm-add-reminder', 'lm-remove-reminder']);

/** @description The declared tool by name. @param {string} name @returns {object} */
function tool(name) {
  const found = (manifest.tools || []).find(entry => entry.name === name);
  assert.ok(found, `${name} is declared`);
  return found;
}

/** @description The catalog's HTTP binding for a tool's endpoint, with {input.x} as :x. @param {object} declared @returns {object} */
function httpBinding(declared) {
  const [method, url] = declared.executor.apiEndpoint.split(' ');
  assert.ok(url.startsWith(`${MOUNT}/`), `${declared.name} calls inside this package's mount`);
  const route = url.slice(MOUNT.length).replace(/\{input\.([A-Za-z]+)\}/g, (_, field) => `:${field}`);
  const shape = value => value.replace(/:[A-Za-z]+/g, ':param');
  const found = catalog.bindings.http.find(entry => entry.method === method && shape(entry.path) === shape(route));
  assert.ok(found, `${method} ${route} is bound`);
  return found;
}

test('the six tools are declared and each has exactly one tool binding', () => {
  assert.deepEqual((manifest.tools || []).map(entry => entry.name).sort(), [...TOOLS].sort());
  const bound = catalog.bindings.tools.map(entry => entry.id);
  assert.deepEqual([...bound].sort(), [...TOOLS].sort());
  assert.equal(new Set(bound).size, bound.length);
});

test('each tool binding asks exactly what the route it calls asks', () => {
  for (const name of TOOLS) {
    const bound = catalog.bindings.tools.find(entry => entry.id === name);
    assert.deepEqual([...bound.allOf].sort(), [...httpBinding(tool(name)).allOf].sort(), name);
  }
});

test('writes are held for approval and reads resolve to read permissions only', () => {
  for (const name of TOOLS) {
    const declared = tool(name);
    assert.equal(declared.requiresApproval, WRITES.has(name), `${name} approval`);
    assert.equal(declared.executor.apiEndpoint.startsWith('GET '), !WRITES.has(name), `${name} method`);
    if (WRITES.has(name)) continue;
    for (const permission of httpBinding(declared).allOf) {
      assert.equal(catalog.permissions[permission].effect, 'read', `${name} reads with ${permission}`);
    }
  }
});

test('a student holds every permission each tool needs', () => {
  const held = new Set(catalog.roles.student.grants.map(grant => grant.permission));
  for (const entry of catalog.bindings.tools) {
    for (const permission of entry.allOf) assert.ok(held.has(permission), `${entry.id} needs ${permission}`);
  }
});

test('add-reminder takes a calendar item the route accepts', () => {
  const schema = tool('lm-add-reminder').inputSchema;
  assert.deepEqual(schema.required, ['title', 'eventDate', 'eventType']);
  assert.deepEqual(schema.properties.eventType.enum, ['reminder', 'study-session', 'assignment', 'quiz', 'test', 'custom']);
  assert.equal(schema.properties.classId.format, 'uuid');
  assert.equal(tool('lm-remove-reminder').inputSchema.properties.eventId.format, 'uuid');
  assert.deepEqual(tool('lm-add-class').inputSchema.required, ['name', 'subject']);
});

test('the corner button is Jarvis: no floating assistant, and the page frame never hides the orb', () => {
  assert.equal(manifest.ui.assistant, undefined);
  const frame = fs.readFileSync(path.join(PKG, 'tools', 'lm-mascot.js'), 'utf8');
  assert.doesNotMatch(frame, /#jarvisOrbFab|#jarvisOrbPanel/);
});

test('class and school-schedule requests reach the tutor that holds the tools', () => {
  assert.equal(manifest.chatBot, 'class-tutor');
  const tutor = manifest.bots.find(bot => bot.name === 'class-tutor');
  for (const phrase of ['add a class', 'new class', 'my classes', 'my assignments', 'assignments due', 'school calendar', 'little monsters']) {
    assert.ok(tutor.routingKeywords.includes(phrase), phrase);
  }
  const persona = fs.readFileSync(path.join(PKG, 'personas', 'class-tutor.yaml'), 'utf8');
  for (const name of TOOLS) assert.match(persona, new RegExp(name), `persona names ${name}`);
  // Generic schedule words would take other applications' requests ("What is on my team schedule this week?").
  for (const phrase of tutor.routingKeywords) assert.doesNotMatch(phrase, /\b(week|schedule)\b/, phrase);
});
