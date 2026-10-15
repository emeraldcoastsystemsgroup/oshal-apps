/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Concierge grounding (2026-10-11 sweep). The kernel now gives a concierge turn
 *   an ON SCREEN NOW block read from the application's Home summary (with the current time) and the INSTALLED
 *   APPLICATIONS this person can open. Each persona below answered from the wrong world live: the ideator said it could
 *   not see installed applications, Print Inbox answered "0 tickets" from its classification queue, Kid Lens promised a
 *   .zip and Dropbox pickup this installation does not have, Portrait Studio gave a cause other than its missing image
 *   provider, Animatronics said a `warn` supply verdict blocks arming and asked for a rigId, Aero Lab named a structural
 *   failure no evaluation recorded, Daily Trade Recap invented missed-recap counts, World gave a wrong time and called
 *   stale sources fresh, and Marketing said it could not see campaigns. Each prompt must carry its grounded rule and
 *   drop the wrong one, and every screen text or route behaviour a prompt quotes is read from the shipped file, so a
 *   renamed label or a changed rule fails here. Little Monsters names a concierge that writes quizzes.
 */
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const yaml = createRequire(path.join(path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, 'scripts', 'toolchain')), 'package.json'))('js-yaml');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (value) => String(value || '').replace(/\s+/g, ' ');
const prompt = (rel) => flat((yaml.load(read(rel)) || {}).perspective);

/** [persona, phrases it must carry, phrases it must not, [shipped file, text it must contain] pairs]. */
const GROUNDED = [
  ['capability-ideator/personas/capability-ideator.yaml',
    ['INSTALLED APPLICATIONS block', 'never propose building an application the list already has'],
    ['You cannot see which applications are installed or active on this installation'], []],
  ['print-ingest/personas/print-ingest-bot.yaml',
    ['ON SCREEN NOW', 'never answer "what is in my print queue", "what is in my inbox" or "what is waiting" from them', 'never an /api/ address'],
    [], [['print-ingest/routes/home-summary.js', 'Awaiting filing approval']]],
  ['youtube-kids/personas/kid-lens-analyzer.yaml',
    ['"Choose your watch-history.json"). That upload always works', 'only where this installation has the Takeout archive service'],
    [], [['youtube-kids/tools/youtube-kids-dashboard.html', 'Choose your watch-history.json'],
      ['youtube-kids/tools/youtube-kids-dashboard.html', 'Dropbox pickup and .zip unpacking are not available on this installation']]],
  ['portrait-studio/personas/portrait-artist.yaml',
    ['Portraits cannot be generated here: no image-generation provider is configured on this installation', 'nothing for them to connect'],
    [], [['portrait-studio/tools/portrait-studio.html', 'Portraits cannot be generated here: no image-generation provider is configured on this installation']]],
  ['animatronics/personas/animatronics-director.yaml',
    ['a `warn` verdict still arms', '"Connect (Web Serial)"', '"Arm rig…"', 'Never ask for a rigId'],
    [], [['animatronics/tools/animatronics.html', 'Connect (Web Serial)'], ['animatronics/tools/animatronics.html', 'Arm rig…'],
      ['animatronics/routes/rig-routes.js', "if (power.verdict === 'refuse') {"]]],
  ['aero-lab/personas/aero-designer.yaml',
    ['ON SCREEN NOW', '"concept" means nothing has been evaluated at the current design, never that it failed'],
    [], [['aero-lab/oshal-app.yaml', 'path: /api/aero-lab/home-summary'], ['aero-lab/routes/home-summary.js', "label: 'Sized at current design'"]]],
  ['vids/personas/vids-operator.yaml',
    ['ON SCREEN NOW', 'with its exact numbers, including 0', 'never an /api/ address'],
    [], [['daily-trade-recap/routes/home-summary.js', 'Sessions with no recap / 7 days']]],
  ['world/personas/world-analyst.yaml',
    ['"Current time" line is the time now (UTC)', 'never call the coverage current, live or fresh on your own'],
    [], [['world/routes/home-summary.js', 'Last pull:']]],
  ['marketing-engine/personas/campaign-director.yaml',
    ['ON SCREEN NOW', '"Campaigns (not archived)"', 'never an /api/ address'],
    ['You hold no tool here and cannot see their board'], [['marketing-engine/routes/home-summary.js', "'Campaigns (not archived)'"]]],
];

test('each concierge answers from what its screen shows, with its wrong rule gone', () => {
  for (const [rel, must, mustNot, shipped] of GROUNDED) {
    const text = prompt(rel);
    for (const phrase of must) assert.ok(text.includes(phrase), `${rel} says: ${phrase}`);
    for (const phrase of mustNot) assert.ok(!text.includes(phrase), `${rel} no longer says: ${phrase}`);
    for (const [file, quoted] of shipped) assert.ok(read(file).includes(quoted), `${file} still carries: ${quoted}`);
  }
});

test('Little Monsters names a concierge that answers questions and writes practice quizzes, not lecture processing', () => {
  const manifest = yaml.load(read('little-monsters/oshal-app.yaml'));
  assert.equal(manifest.chatBot, 'class-tutor');
  const bot = (manifest.bots || []).find((item) => item.name === manifest.chatBot);
  assert.ok(bot, 'the chatBot is declared by the package');
  assert.notEqual(manifest.chatBot, (manifest.bots || [])[0].name, 'the first declared bot (lecture-scribe) is not the concierge');
});
