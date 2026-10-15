/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 11: the manifest description began "Print a document to the swarm" and Jarvis, reading
 *     |                                             | it in the catalog, offered home printing ("choose your home printer as the destination", "queue it
 *     |                                             | for printing"). The description - and the catalog and README copies of it - say this is an inbound
 *     |                                             | virtual printer that files documents into the swarm's inbox and cannot print to a printer.
 *     |                                             | Run: node --test print-ingest/tests/description.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(ROOT, '../scripts/toolchain')] }));

test('the description names an inbound virtual printer that files documents and cannot print to a printer', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const description = manifest.description;
  assert.doesNotMatch(description, /^Print a document/);
  assert.match(description, /^An inbound virtual printer for the swarm/);
  assert.match(description, /never printed on\s+paper/);
  assert.match(description, /It cannot print to a home or office printer\.$/);
  assert.match(description, /nothing is written until you\s+approve it/);
});

test('the catalog and README copies say the same', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'marketplace.json'), 'utf8'));
  assert.equal(catalog.apps.find((app) => app.name === 'print-ingest').description, manifest.description);
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /^Print a document to the swarm/m);
  assert.match(readme, /It cannot print to a home or office printer\./);
});
