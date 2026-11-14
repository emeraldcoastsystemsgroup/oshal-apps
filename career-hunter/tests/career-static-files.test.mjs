/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Verify published browser asset declarations cover actual references and retain their existing read permission. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const yaml=createRequire(new URL('../../scripts/toolchain/package.json',import.meta.url))('js-yaml');
test('kernel static files cover browser references with real files and the existing permission',()=>{
  const manifest=yaml.load(readFileSync(root+'oshal-app.yaml','utf8')),auth=yaml.load(readFileSync(root+'authorization.yaml','utf8'));
  const published=manifest.staticFiles?.find(row=>row.route==='/api/career-hunter/static/:file');assert.ok(published);
  assert.equal(published.folder,'tools');assert.equal(new Set(published.files).size,published.files.length);
  for(const file of published.files){assert.match(file,/^[\w.-]+$/);assert.ok(lstatSync(root+'tools/'+file).isFile(),file);}
  const referenced=new Set(readdirSync(root+'tools').filter(file=>/\.(html|js|css)$/.test(file)).flatMap(file=>
    [...readFileSync(root+'tools/'+file,'utf8').matchAll(/\/api\/career-hunter\/static\/([\w.-]+\.(?:js|css|svg|json))/g)].map(match=>match[1])));
  for(const file of referenced)assert.ok(published.files.includes(file),'directly answer '+file);
  assert.deepEqual(auth.bindings.http.find(row=>row.id==='static-asset').allOf,['app.open']);assert.ok(published.files.includes('career-submission-browser.js')===false,'private helper code is not published');
});
