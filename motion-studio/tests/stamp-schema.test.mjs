/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "List my Motion Studio projects" from Jarvis: the bot sent a first-page stamp other than the word start, every page was refused motion_invalid_index_stamp, and it reported it could not list them. Each stamp-paged tool describes its stamp (the exact word start, then the returned stamp), and the project index accepts start at offset 0 and refuses any other first-page word.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { projectIndex } from '../routes/project-inspection.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const yaml = createRequire(path.join(path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, '..', 'scripts', 'toolchain')), 'package.json'))('js-yaml');
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));

test('every stamp-paged tool says the first page is the exact word start', () => {
  const paged = manifest.tools.filter((t) => t.inputSchema?.properties?.stamp);
  assert.deepEqual(paged.map((t) => t.name).sort(), ['motion-list-effects', 'motion-list-fonts', 'motion-list-projects']);
  for (const tool of paged) assert.match(tool.inputSchema.properties.stamp.description, /exact lowercase word start/, tool.name);
});

test('the project index takes start at offset 0 and refuses another first-page word', () => {
  assert.equal(projectIndex([], 'start', 0).complete, true);
  for (const stamp of ['START', 'first', 'initial']) {
    assert.throws(() => projectIndex([], stamp, 0), (e) => /motion_invalid_index_stamp/.test(String(e.code || e.message)), stamp);
  }
});
