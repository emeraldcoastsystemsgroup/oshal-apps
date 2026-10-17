/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "Evaluate a NACA 2412 airfoil in Aero Lab" from Jarvis: the aero-designer asked for a complete design vector and ran nothing, because every design tool declared `design` as a bare object. The four design tools name exactly the route's design fields, say each is optional, and the route runs the baseline craft for an empty design; an unknown field is still refused, as the route refuses it.
 *
 * Dependency-free `node --test` suite apart from the store toolchain's js-yaml.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const yaml = require(path.join(ROOT, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
const STUBS = {
  express: { Router: () => ({ get() {}, post() {}, put() {}, delete() {}, use() {} }) },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const routes = require('../routes/aero-lab-routes.js');
test.after(() => { Module._load = original; });

const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
const DESIGN_TOOLS = ['aero-polar', 'aero-evaluate', 'aero-screen', 'aero-export'];

test('each design tool names exactly the route\'s design fields and says each is optional', () => {
  for (const name of DESIGN_TOOLS) {
    const design = manifest.tools.find((t) => t.name === name).inputSchema.properties.design;
    assert.deepEqual(Object.keys(design.properties).sort(), Object.keys(routes.DEFAULT_DESIGN).sort(), name);
    assert.ok(Object.values(design.properties).every((p) => p.type === 'number'), name);
    assert.equal(design.additionalProperties, false, name);
    assert.match(design.description, /Every field is optional/);
  }
});

test('an empty design runs the baseline craft and an unknown field is refused', () => {
  assert.deepEqual(routes.validateDesign({}, null).design, routes.DEFAULT_DESIGN);
  assert.match(routes.validateDesign({ airfoil: 'NACA 2412' }, null).error, /unknown design field "airfoil"/);
});
