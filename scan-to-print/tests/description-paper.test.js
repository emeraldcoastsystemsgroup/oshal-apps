/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 14 / demo sweep 2: asked to print a packing list on a home inkjet, Jarvis offered Scan to
 *   Print as "printing to your home printer (inkjet, laser, etc.)": the catalog line it reads (the manifest description, whole
 *   for a named entry up to 600 characters, else its first 80) said "a one-click job on your own ... printer" and never that
 *   the app is for 3D printers only. The description's first 80 characters, the catalog's short form, now say it cannot print
 *   paper documents, and the store catalog mirrors the same words.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Round 21 review: the disclaimer led the description, so the README row (its first
 *   sentence) and the 80-character short form said nothing about what the app does. It now opens with what it does, then
 *   the limit, both inside the first 80 characters: 'Scans and 3D-prints objects. 3D printers only; it cannot print paper documents.'
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const yaml = require(require.resolve('js-yaml', { paths: [path.resolve(PKG, '../scripts/toolchain')] }));
/** The Jarvis catalog's short description form (oshal-kernel crates/api/src/jarvis_context.rs SHORT_BLURB_CHARS). */
const SHORT_BLURB_CHARS = 80;

test('the catalog short form says Scan to Print is for 3D printers only and cannot print paper documents', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  const flat = manifest.description.replace(/\s+/g, ' ').trim();
  const short = flat.slice(0, SHORT_BLURB_CHARS);
  assert.match(short, /^Scans and 3D-prints objects\. 3D printers only; it cannot print paper documents\./, 'what it does first, then the limit');
  const catalog = JSON.parse(fs.readFileSync(path.join(PKG, '..', 'marketplace.json'), 'utf8'));
  assert.equal(catalog.apps.find((a) => a.name === 'scan-to-print').description, flat, 'the store catalog carries the same description');
});
