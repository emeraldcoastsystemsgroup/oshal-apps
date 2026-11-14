/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0 (Roger, 2026-11-13: the concierge "said that it couldnt change my dates and i needed to go to career profile.. but there is no career profile page"). Nothing Career says sends a person to a Profile page for jobs or dates, the two personas no longer send résumé work to another assistant or call dates unchangeable, they name Work history, and the patch tool the concierge proposes accepts exactly what the engine applies (a job edit, a move, a one-line summary the approval card shows).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2: the patch tool's operations include split (a pasted block into one bullet per line), which the engine applies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const packageRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const yaml = require(require.resolve('js-yaml', { paths: [path.join(packageRoot, '../scripts/toolchain')] }));
const read = (...parts) => fs.readFileSync(path.join(packageRoot, ...parts), 'utf8');
const manifest = yaml.load(read('oshal-app.yaml'));
const personas = ['career-concierge.yaml', 'career-hunter.yaml'].map((name) => [name, yaml.load(read('personas', name)).perspective]);

test('no line a person reads sends them to a Profile page for jobs, titles or dates', () => {
  const office = read('tools', 'career-resume-office.js');
  assert.doesNotMatch(office, /in Profile\b|come from your profile|as your profile records it/);
  assert.match(office, /on the Work history page/);
  const tools = manifest.tools.map((tool) => `${tool.description || ''} ${tool.usageInstructions || ''}`).join('\n');
  assert.doesNotMatch(tools, /anchors and cannot be changed|remain protected anchors/);
  for (const [name, text] of personas) assert.doesNotMatch(text, /\bcareer profile page\b|\bin Profile\b/i, name);
});

test('both personas edit the work history themselves, by card, and name the page that exists', () => {
  for (const [name, text] of personas) {
    assert.doesNotMatch(text, /say to ask the Concierge\s+beside the document/, `${name} still sends résumé work to another assistant`);
    assert.doesNotMatch(text, /do not use career_resume_patch or career_resume_save/, `${name} still forbids its own edit on My résumé`);
    assert.doesNotMatch(text, /Role titles, employers and dates are protected\s+anchors/, `${name} still calls dates unchangeable`);
    assert.match(text, /Work history\s+\(\/cockpit\/\?app=career-hunter&screen=career-work-history\)/, name);
    assert.match(text, /Never say a job's dates, title or\s+employer cannot be changed/, name);
    assert.match(text, /Its card in the chat is their\s+approval/, name);
    assert.match(text, /Work history · Other experience/, name);
  }
  assert.ok(manifest.ui.static.some((tile) => tile.toolName === 'career-work-history' && tile.label === 'Work history'), 'the page the personas name is a tile');
});

test('the patch tool takes exactly what the engine applies, and each edit carries the line its card shows', () => {
  const tool = manifest.tools.find((item) => item.name === 'career_resume_patch');
  const item = tool.inputSchema.properties.edits.items;
  assert.deepEqual(item.properties.op.enum, ['set', 'add', 'remove', 'move', 'split']);
  assert.ok(item.properties.field.enum.includes('role'));
  assert.deepEqual(item.properties.key.enum, ['title', 'org', 'start', 'end']);
  assert.ok(item.required.includes('summary'), 'the approval card names each edit by its summary');
  const engine = read('engine', 'jobhunter', 'master_edit.py').match(/EDIT_KEYS = \{([^}]*)\}/)[1].match(/'([a-zA-Z]+)'/g).map((key) => key.slice(1, -1)).sort();
  assert.deepEqual(Object.keys(item.properties).sort(), engine, 'the schema and the engine accept the same keys');
  assert.equal(tool.requiresApproval, true); assert.equal(tool.defaultAuthMode, 'ask');
});
