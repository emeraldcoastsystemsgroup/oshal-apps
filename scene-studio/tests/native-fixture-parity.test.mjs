/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the package-contained native fixture identical to its pinned reviewed source; archived Scene tests need no CAD files.
 */
import test from'node:test';import assert from'node:assert/strict';import{readFileSync,existsSync}from'node:fs';import{createHash}from'node:crypto';
test('Scene native fixture is package-contained and matches its pinned canonical source',()=>{const file=readFileSync(new URL('./native-editor-fixture.mjs',import.meta.url),'utf8'),match=file.match(/^\/\/ Vendored[^\n]*\n\/\/ Canonical SHA256: ([a-f0-9]{64})\n/);assert.ok(match);const source=file.slice(match[0].length);assert.equal(createHash('sha256').update(source).digest('hex'),match[1]);const canonical=new URL('../../cad-studio/tests/native-editor-fixture.mjs',import.meta.url);if(existsSync(canonical))assert.equal(source,readFileSync(canonical,'utf8'));});
