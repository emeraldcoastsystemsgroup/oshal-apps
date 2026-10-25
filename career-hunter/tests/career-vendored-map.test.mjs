/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin shipped Leaflet assets and license to their source receipt after documented line-ending normalization.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
test('shipped map assets match their reviewed source receipt and retain the license', () => {
  const source = JSON.parse(readFileSync(new URL('../tools/vendor/leaflet-1.9.4.json', import.meta.url)));
  assert.equal(source.version, '1.9.4');
  assert.equal(source.source, 'https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz');
  for (const [file, hash] of Object.entries(source.files)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL('../tools/' + file, import.meta.url))).digest('hex'), hash, file);
  }
  assert.match(readFileSync(new URL('../tools/career-leaflet-LICENSE.txt', import.meta.url), 'utf8'), /Copyright.*Volodymyr Agafonkin/);
});
