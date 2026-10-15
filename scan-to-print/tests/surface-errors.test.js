/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A failed request reads as a sentence on the Scan to Print page. The native kernel answers a request that failed after the route ran with a bare {"error":"application_route_failed"}, which the toast showed as is. The shipped failureText (cut out of tools/scan-to-print.js and run) prefers the message, then the detail, then a known code in words, and never shows a bare snake_case code.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'scan-to-print.js'), 'utf8');
const readable = /const READABLE = Object\.freeze\(\{[\s\S]*?\}\);/.exec(source);
const start = source.indexOf('function failureText(');
assert.ok(readable && start > 0, 'the surface declares READABLE and failureText');
let depth = 0;
let end = source.indexOf('{', start);
for (; end < source.length; end += 1) { if (source[end] === '{') depth += 1; else if (source[end] === '}' && --depth === 0) break; }
const sandbox = {};
vm.createContext(sandbox);
new vm.Script(`${readable[0]}\n${source.slice(start, end + 1)}\nglobalThis.failureText = failureText;`).runInContext(sandbox);
const failureText = sandbox.failureText;

test('the kernel\'s bare application_route_failed reads as a sentence, the code kept in brackets', () => {
  const text = failureText({ error: 'application_route_failed' }, 500);
  assert.equal(text, 'The server could not finish this request, so nothing was saved. Try again; if it repeats, lower the resolution. (application_route_failed)');
});

test('a message wins, then a detail, and an unknown code is made readable', () => {
  assert.equal(failureText({ error: 'reconstruction_refused', message: 'Reconstruct at resolution 80 or lower.' }, 422), 'Reconstruct at resolution 80 or lower.');
  assert.equal(failureText({ error: 'native_executor_unavailable', detail: 'Frame extraction is unavailable in this native runtime' }, 503),
    'Frame extraction is unavailable in this native runtime (native_executor_unavailable)');
  assert.equal(failureText({ error: 'storage_unavailable' }, 503), 'The server refused this request: storage unavailable (HTTP 503).');
  assert.equal(failureText(null, 502), 'The server answered HTTP 502.');
});
