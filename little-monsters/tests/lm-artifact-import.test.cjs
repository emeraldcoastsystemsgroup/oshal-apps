/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the ADR-139 class-material receiver across the manifest, source, built route, and class-picker surface.
 * -----------------------------------------------------------------------------
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(ROOT, relativePath), 'utf8'); }

test('class-material artifact destination keeps the receiver contract complete', () => {
  const manifest = read('oshal-app.yaml');
  const source = read('src-routes/education-materials-routes.ts');
  const built = read('routes/education-materials-routes.js');
  const dashboard = read('tools/student-dashboard.html');

  assert.match(manifest, /id: class-material/u);
  assert.match(manifest, /types: \[image\/\*, application\/pdf\]/u);
  assert.match(source, /redeemArtifactViaRelay/u);
  assert.match(source, /classifyMaterial\(redeemed\.buffer, type\)/u);
  assert.match(source, /unsupported_artifact_type/u);
  assert.match(source, /router\.post\('\/import-artifact'/u);
  assert.match(source, /shareStatus: row\.share_status/u);
  assert.match(built, /import-artifact/u);
  assert.match(dashboard, /artifactAction/u);
  assert.match(dashboard, /api\/education\/import-artifact/u);
  assert.match(dashboard, /choose the class that should receive it/u);
  assert.match(read('docs/user-guide.md'), /Filing a file into a class/u);
});
