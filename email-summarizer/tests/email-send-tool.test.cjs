/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "Send an email to ... saying the sweep is done" from Jarvis answered "I cannot send emails directly": the communications bot held only read tools. email-send is an approval-held route tool on the mounted POST /api/email/send, its schema requires confirm true (the route's explicit write confirmation), a recipient and a body, and the persona calls it and never says an email was sent before the tool answers. The route's own confirmation and kernel-egress send path stay pinned in kernel-egress.test.cjs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | "Email it to me" needs no recipient (the route sends to the person's own address); asked to email a deck to the person, the bot asked for their address.
 *
 * Dependency-free `node --test` suite apart from the store toolchain's js-yaml.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const yaml = require(path.join(ROOT, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'email-summarizer.yaml'), 'utf8'));

test('email-send is an approval-held tool on the mounted POST /api/email/send', () => {
  const tool = manifest.tools.find((t) => t.name === 'email-send');
  assert.ok(tool);
  assert.equal(tool.executor.apiEndpoint, 'POST /api/email/send');
  assert.equal(tool.requiresApproval, true);
  assert.deepEqual(tool.inputSchema.properties.confirm, { type: 'boolean', const: true });
  assert.deepEqual(tool.inputSchema.required, ['confirm', 'body'], 'no recipient means their own address');
  assert.ok(fs.readFileSync(path.join(ROOT, 'routes', 'email-app-routes.js'), 'utf8').includes("String(b.to || '').trim() || (await mailbox.ownAddress())"), 'the route sends to the person when no recipient is given');
  assert.ok(manifest.routes.some((r) => r.mountPath === '/api/email'));
  assert.ok(fs.readFileSync(path.join(ROOT, 'routes', 'email-app-routes.js'), 'utf8').includes("router.post('/send', sendMail(ctx))"));
});

test('the persona sends only through email-send and never claims a send before the tool answers', () => {
  assert.match(persona.perspective, /email-send: send one email from their own mailbox/);
  assert.match(persona.perspective, /never say it was sent until the tool answers ok/);
  assert.match(persona.perspective, /leave "to" out \(it goes to their own address\); never ask them for it/);
  assert.doesNotMatch(persona.perspective, /Nothing is ever sent from a chat answer/);
});
