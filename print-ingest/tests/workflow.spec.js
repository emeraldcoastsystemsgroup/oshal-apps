/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guards the approval gate this package documents but did not have. `pipeline: graph` with no processDefinition does not run a graph - it falls through core dispatch routing to manifest-worker and runs workerBot alone, so the human confirmation step the manifest's own comment promises was silently absent. 0.3.1 supplies the graph; these checks fail if it is removed again, if the gate node goes, or if an edge points at a node id that does not exist. Zero-dep and structural rather than a YAML parse, matching the store runner convention: the authoritative refusal lives in the core loader (CKR-11), this is the package-local backstop.
 */

'use strict';

const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = function run() {
  const manifest = readFileSync(join(__dirname, '..', 'oshal-app.yaml'), 'utf-8');
  let checks = 0;

  assert.ok(/^  pipeline: graph$/m.test(manifest), 'workflow.pipeline is no longer graph');
  checks += 1;

  // The whole point: graph without this key is a one-bot run with every gate dropped.
  assert.ok(
    /^  processDefinition:$/m.test(manifest),
    'pipeline is graph with no processDefinition - the approval gate is silently gone again',
  );
  checks += 1;

  assert.ok(
    /type: approval-gate/.test(manifest),
    'the approval-gate node is gone; a human no longer confirms the destination',
  );
  checks += 1;

  // The gate must sit between the bot proposing and the ticket delivering. A gate that
  // dangles off the end of the graph would satisfy a substring check and gate nothing.
  const nodeIds = new Set([...manifest.matchAll(/^        - id: (n-[a-z-]+)$/gm)].map((m) => m[1]));
  assert.ok(nodeIds.size >= 4, `expected at least 4 nodes, found ${nodeIds.size}`);
  checks += 1;

  const endpoints = [...manifest.matchAll(/^          (?:source|target): (n-[a-z-]+)$/gm)].map((m) => m[1]);
  assert.ok(endpoints.length > 0, 'no edges found - the nodes are not connected');
  for (const endpoint of endpoints) {
    assert.ok(nodeIds.has(endpoint), `edge endpoint ${endpoint} is not a declared node id`);
  }
  checks += 1;

  const order = [...manifest.matchAll(/^        - (n-[a-z-]+)$/gm)].map((m) => m[1]);
  assert.ok(
    order.indexOf('n-approve') > order.indexOf('n-classify'),
    'the gate must come after the bot proposes, not before',
  );
  assert.ok(
    order.indexOf('n-deliver') > order.indexOf('n-approve'),
    'delivery must come after the gate, or the gate approves nothing',
  );
  checks += 1;

  return checks;
};
