/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: after creating an empty project the video-editor concierge offered to "write episodes,
 *   apply edits, or start a render" while Video's prompted generation was not configured, and told the person the project "is
 *   accessible via the `video-read-project` tool". The persona the manifest binds to the bot now forbids naming a tool or field,
 *   offers a render only for a saved revision with clips, never offers prompted generation or episode writing, and says an
 *   unavailable feature plainly; the render tool it may offer is still declared and held for approval.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: after creating a project the concierge wrote the project id and a raw
 *   /api/video/editor?project=<id> path, and a follow-up printed the UUID and revision number; the held card read "Video New
 *   Project" with no sentence. The persona names the project by title and the Video editor tab's saved-project list, with no
 *   id, revision number, link or path; both held editor tools carry a people-facing name and cardText.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const yaml = require(path.resolve(ROOT, '../scripts/toolchain/node_modules/js-yaml'));
const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));

/** The persona file the manifest binds to video-editor, parsed as the kernel reads it. */
function boundPersona() {
  const bot = manifest.bots.find((b) => b.name === 'video-editor');
  assert.ok(bot, 'video-editor is declared');
  return yaml.load(fs.readFileSync(path.join(ROOT, bot.persona), 'utf8')).perspective;
}

test('the editor concierge names no tool and offers only what the project and installation support', () => {
  const text = boundPersona();
  assert.match(text, /Never name a tool, an endpoint or an id field to the person/);
  assert.match(text, /Offer a preview or export render\s+only when a fresh read shows a saved revision with at least one clip; never for an empty timeline/);
  assert.match(text, /Generating footage from a prompt \(Video Studio's Generate\) and writing episodes are not yours/);
  assert.match(text, /generation may not be configured on this installation: never offer them/);
  assert.match(text, /answers that it is unavailable or not\s+configured, say exactly that and do not offer it again/);
});

test('the render the persona may offer is a declared tool held for the person\'s approval', () => {
  const render = manifest.tools.find((t) => t.name === 'video-render-project');
  assert.equal(render.requiresApproval, true);
  assert.match(render.executor.apiEndpoint, /^POST \/api\/video\/editor\/projects\/\{input\.id\}\/exports$/);
});

test('after a create the concierge names the project and the Video editor tab, never an id or a path (sweep 13)', () => {
  const text = boundPersona().replace(/\s+/g, ' ');
  assert.doesNotMatch(text, /\/api\/video\/editor/, 'no path template the model fills with the project id');
  assert.match(text, /After success name the project by its title and say it is saved; it opens from the Video editor tab's "Open a saved project" list/);
  assert.match(text, /never write a project id, a revision number, a link or a path/);
  const tab = manifest.ui.static.find((s) => s.toolName === 'video-editor');
  assert.equal(tab.label, 'Video editor');
  const editor = fs.readFileSync(path.join(ROOT, 'tools', 'editor', 'editor.html'), 'utf8');
  assert.match(editor, /Open a saved project…/, 'the list the reply names is on the editor');
});

test('the held editor tools carry a people-facing name and card sentence (sweep 13)', () => {
  for (const [name, display, card] of [
    ['video-new-project', 'New video project', /^Creates an empty video project you can open from the Video editor tab\.$/],
    ['video-apply-edits', 'Apply video edits', /^Saves these edits to your video project as a new revision\.$/],
  ]) {
    const tool = manifest.tools.find((t) => t.name === name);
    assert.equal(tool.requiresApproval, true, name);
    assert.equal(tool.displayName, display);
    assert.match(String(tool.cardText), card);
  }
});
