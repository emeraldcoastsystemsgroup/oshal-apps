/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6: the Companies refusal told the person an operator adds their subject to CAREER_HUNTER_ADMIN_SUBS "and recreating the API container", a Docker-era step the native runtime does not have. The 403 page in both the TypeScript source and the built route speaks to the person (ask whoever runs the installation) and keeps the heading the kernel's own denial test matches.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const page = (src) => {
  const m = /<main class="card">([\s\S]*?)<\/main>/.exec(src);
  assert.ok(m, 'the denial page has its card');
  return m[1];
};

for (const file of ['../src-routes/career-company-routes.ts', '../routes/career-company-routes.js']) {
  test(`the administrator-only page in ${file.split('/').slice(-2).join('/')} has no deployment instructions`, () => {
    const card = page(read(file));
    assert.match(card, /<h1>Companies is administrator only<\/h1>/);
    assert.match(card, /ask the person who runs this installation/);
    assert.doesNotMatch(card, /container|recreat|CAREER_HUNTER_ADMIN_SUBS|deployment environment/i);
  });
}

test('the operator log line no longer tells anyone to recreate the API', () => {
  for (const file of ['../src-routes/career-company-routes.ts', '../routes/career-company-routes.js']) {
    assert.doesNotMatch(read(file).replace(/^ \*.*$/gm, ''), /recreate the api/i);
  }
});
