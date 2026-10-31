/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the store bot contract on isolated fixtures and the real tree: a route that names the platform
 *   comms bot b0000000-0000-0000-0000-000000000001 without declaring or importing it, or a node-posture own or imported bot, is refused;
 *   the package's own inline bot and an imported inline bot pass; a persona prompt teaching /app/scripts/ or an example.com link is
 *   refused while a comment mentioning them is not; a named concierge without a plain-prose rule is refused; a pending entry that no
 *   longer violates fails; and this repository has no unexpected violation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A concierge whose package declares route-backed tools but whose persona does not
 *   teach the ```tool_call fence is refused (the Feeds curator answered a person with a bare "tool_call" label), one that
 *   teaches it passes, and the real feeds-curator is a named concierge.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A chatBot naming the platform general-bot, or a declared or imported node-posture chatBot, is refused
 *   and an imported inline one passes; on the real tree Home, Jarvis and Games have app concierges, social-writer and the
 *   purchasing concierge run inline, and the Social, Sat Ops and Aero Lab concierges carry their answer rules.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Each concierge the 2026-10-11 sweep caught answering from the wrong world names its
 *   app's real controls and states, and each label it names is read from that app's own screen file, so a renamed button
 *   fails here instead of in a person's chat.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The Games launcher's concierge, resolved through games' chatBot to its persona, names
 *   Game Show's own controls read from game-show/ui/gs-surfaces.js and the four shows read from game-show/lib/shows, forbids
 *   saying a show cannot be hosted here, and keeps the D&D controls out of Game Show answers (it had sent a Family Feud
 *   host to + Start New Campaign and, earlier, to Jackbox).
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The Travel concierge's facts follow the installation: no Duffel connector exists here, so it
 *   must say there is no Duffel rail, never send the traveller to Connections (/utilities) for a Duffel token and never offer a
 *   fare watch; the screen label it names is the page's own no-rail sentence (the old one sent people to connect Duffel).
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Register and verify original-owner agent editing, immutable revision batches and approval-bound API tools.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Guard the exact original-Writer metadata-only Motion catalogue POST separately while preserving approval for every mutation POST.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | The Games concierge guard follows Game Show's real labels after its one-press start: Play against the computer and Host for friends instead replace Host this show, Solo night and Pick tonight.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONCIERGES, PENDING, conciergeBindingProblems, personaProblems, readManifests, routeBotProblems, unexpected } from './check-store-bots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const yaml = createRequire(path.join(path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, 'scripts', 'toolchain')), 'package.json'))('js-yaml');
const COMMS = 'b0000000-0000-0000-0000-000000000001';
const STORAGE = 'a0000000-0000-0000-0000-000000000041';

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-store-bots-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof body === 'string' ? body : yaml.dump(body));
  }
  return root;
}

const route = (id) => `const DATA_MGMT_BOT = '${id}';\nawait executeBotOrInline(ctx, botClient, DATA_MGMT_BOT, { agentId: DATA_MGMT_BOT });\n`;
const storage = (bot = { agentId: STORAGE, name: 'storage-assistant' }) => ({ name: 'storage', bots: [bot] });
const email = (bot) => ({ name: 'email-summarizer', bots: [{ agentId: COMMS, name: 'communications-bot', ...bot }] });
const switchboard = { name: 'switchboard', dependencies: { required: { apps: ['email-summarizer'], bots: [{ app: 'email-summarizer', name: 'communications-bot' }] } } };

function routeProblems(root) {
  return routeBotProblems(root, readManifests(root, yaml));
}

test('a route naming the undeclared platform comms bot is refused; its own declared bot passes', (t) => {
  const red = fixture(t, { 'storage/oshal-app.yaml': storage(), 'storage/routes/storage-routes.js': route(COMMS) });
  assert.deepEqual(routeProblems(red), [`route storage/routes/storage-routes.js calls bot ${COMMS}, which is neither declared nor imported by this package`]);
  const green = fixture(t, { 'storage/oshal-app.yaml': storage(), 'storage/routes/storage-routes.js': route(STORAGE) });
  assert.deepEqual(routeProblems(green), []);
});

test('a route-called node-posture bot is refused whether owned or imported; inline passes', (t) => {
  const owned = fixture(t, {
    'storage/oshal-app.yaml': storage({ agentId: STORAGE, name: 'storage-assistant', container: 'storage-bot', requiresOwnNode: true }),
    'storage/src-routes/storage-routes.ts': route(STORAGE),
  });
  assert.match(routeProblems(owned)[0], /storage-assistant is node-posture/);
  const imported = fixture(t, {
    'email-summarizer/oshal-app.yaml': email({ container: 'email-bot', requiresOwnNode: true }),
    'switchboard/oshal-app.yaml': switchboard,
    'switchboard/routes/compose.js': `const COMMS_BOT_AGENT_ID = '${COMMS}';\n`,
  });
  assert.match(routeProblems(imported)[0], /imported email-summarizer\/communications-bot is node-posture/);
  const inline = fixture(t, {
    'email-summarizer/oshal-app.yaml': email({ posture: 'inline' }),
    'switchboard/oshal-app.yaml': switchboard,
    'switchboard/routes/compose.js': `const COMMS_BOT_AGENT_ID = '${COMMS}';\n`,
  });
  assert.deepEqual(routeProblems(inline), []);
});

test('a bot named by its selector in executeBotOrInline is checked like an id', (t) => {
  const root = fixture(t, { 'storage/oshal-app.yaml': storage(), 'storage/routes/r.js': "await (0, x.executeBotOrInline)(ctx, botClient, 'general-bot', {});\n" });
  assert.match(routeProblems(root)[0], /calls bot general-bot, which is neither declared nor imported/);
});

test('persona prompts teaching retired scripts or example links are refused; comments are not', (t) => {
  const root = fixture(t, {
    'home/oshal-app.yaml': { name: 'home' },
    'home/personas/home-bot.yaml': '# was: node /app/scripts/oshal-smartthings.js\nname: home-bot\nperspective: |\n  Answer in plain prose.\n',
    'home/personas/old.yaml': 'name: old\nperspective: |\n  Run `node /app/scripts/oshal-smartthings.js index`.\n',
    'spotify/oshal-app.yaml': { name: 'spotify' },
    'spotify/personas/s.yaml': 'name: s\nsystemPrompt: Send them to https://example.com/spotify/auth\n',
  });
  assert.deepEqual(personaProblems(root, yaml, ['home/personas/home-bot.yaml']).sort(), [
    'persona home/personas/old.yaml teaches /app/scripts/',
    'persona spotify/personas/s.yaml teaches example.com',
  ]);
});

test('a named concierge without a plain-prose rule is refused', (t) => {
  const root = fixture(t, { 'cloud/oshal-app.yaml': { name: 'cloud' }, 'cloud/personas/c.yaml': 'name: c\nperspective: |\n  Reply with ONLY a JSON object.\n' });
  assert.deepEqual(personaProblems(root, yaml, ['cloud/personas/c.yaml']), ['concierge cloud/personas/c.yaml has no plain-prose answer rule']);
});

test('a concierge with route-backed tools must teach the tool_call fence', (t) => {
  const tools = [{ name: 'feeds-messages', executor: { executorType: 'api', apiEndpoint: 'GET /api/feeds/messages' } }];
  const label = 'name: f\nperspective: |\n  Answer in plain prose.\n  To read the feed write tool_call then {"tool": "feeds-messages", "arguments": {}}.\n';
  const red = fixture(t, { 'feeds/oshal-app.yaml': { name: 'feeds', tools }, 'feeds/personas/f.yaml': label });
  assert.deepEqual(personaProblems(red, yaml, ['feeds/personas/f.yaml']), ['concierge feeds/personas/f.yaml has route-backed tools but does not teach the ```tool_call fence']);
  const fenced = 'name: f\nperspective: |\n  Answer in plain prose.\n  Emit one ```tool_call block holding {"tool": "<name>", "arguments": {}}.\n';
  const green = fixture(t, { 'feeds/oshal-app.yaml': { name: 'feeds', tools }, 'feeds/personas/f.yaml': fenced });
  assert.deepEqual(personaProblems(green, yaml, ['feeds/personas/f.yaml']), []);
  const toolless = fixture(t, { 'feeds/oshal-app.yaml': { name: 'feeds' }, 'feeds/personas/f.yaml': label });
  assert.deepEqual(personaProblems(toolless, yaml, ['feeds/personas/f.yaml']), []);
});

test('a general-bot or node-posture concierge is refused; an imported inline concierge passes', (t) => {
  const shop = (bot) => ({ name: 'purchasing', bots: [{ agentId: 'b0070000-0000-0000-0000-000000000001', name: 'shopping-concierge', ...bot }] });
  const home = (chatBot) => ({ name: 'home-experience', chatBot, dependencies: { required: { apps: ['purchasing'], bots: [{ app: 'purchasing', name: 'shopping-concierge' }] } } });
  const check = (root) => conciergeBindingProblems(root, yaml, readManifests(root, yaml));
  const generic = fixture(t, { 'purchasing/oshal-app.yaml': shop({ posture: 'inline' }), 'home-experience/oshal-app.yaml': home('general-bot') });
  assert.deepEqual(check(generic), ['app home-experience binds its concierge to the platform general-bot, which holds none of its data']);
  const node = fixture(t, { 'purchasing/oshal-app.yaml': shop({ container: 'shopping-bot', requiresOwnNode: true }), 'home-experience/oshal-app.yaml': home('shopping-concierge') });
  assert.deepEqual(check(node), ['app home-experience concierge shopping-concierge: imported purchasing/shopping-concierge is node-posture']);
  const inline = fixture(t, { 'purchasing/oshal-app.yaml': shop({ posture: 'inline' }), 'home-experience/oshal-app.yaml': home('shopping-concierge') });
  assert.deepEqual(check(inline), []);
});

const PERSONA_FACTS = [
  // [persona, phrases its prompt must carry, phrases it must not, [screen file, label it names] pairs]
  ['dnd/personas/dungeon-master.yaml', ['out of character', 'Export to', 'Join with Code', 'My Characters'], [], [['dnd/ui/table-screens.js', 'Start New Campaign'], ['dnd/ui/table-screens.js', 'Import Character'], ['dnd/ui/table-screens.js', 'My Games']]],
  ['vids/personas/vids-operator.yaml', ['npx oshal-vids worker', 'not the prompt, the orientation or a cooldown', 'Never ask for log'], [], [['vids/routes/vids-routes.js', 'no worker registered'], ['creative-studio/routes/home-summary.js', 'Stories done / 5d'], ['daily-trade-recap/routes/home-summary.js', 'Sessions with no recap / 7 days']]],
  ['marketing-engine/personas/campaign-director.yaml', ['NO DATA is a marker inside a review, never an answer to a person', 'Ideas are part of your job', 'Switchboard Compose'], [], [['marketing-engine/tools/marketing-engine.html', 'Approvals'], ['switchboard/oshal-app.yaml', 'label: Compose'], ['switchboard/oshal-app.yaml', 'label: Streams']]],
  ['youtube-kids/personas/kid-lens-analyzer.yaml', ['takeout.google.com', 'never need them to paste titles'], [], [['youtube-kids/tools/youtube-kids-dashboard.html', 'Choose your Takeout .zip'], ['youtube-kids/tools/youtube-kids-dashboard.html', 'Find my Takeout in Dropbox']]],
  ['print-ingest/personas/print-ingest-bot.yaml', ['Private to me', 'Never guess a count'], [], [['print-ingest/ui/index.html', 'Awaiting approval'], ['print-ingest/ui/index.html', 'Approve']]],
  ['video/personas/video-director.yaml', ['never a JSON object or a code block'], [], [['video/tools/video.html', 'My videos']]],
  ['bake-off/personas/bake-off-analyst.yaml', ['one metered inference rail', 'nothing for the person to configure'], [], [['bake-off/tools/bake-off.html', 'Not available here']]],
  ['brand-graphics/personas/brand-graphics.yaml', ['Never send them to another', 'no worker registered'], ['Runway', 'Pika'], [['brand-graphics/tools/review.html', 'Render this brand brief'], ['brand-graphics/tools/review.html', 'Open Vids Studio']]],
  ['spaces/personas/spaces-operator.yaml', ['no_reconstruction_engine', 'never present those as options'], ['Reply with ONLY a JSON object'], []],
  ['travel/personas/travel-concierge.yaml', ['```tool_call', 'Never tell the traveller to connect Duffel', 'Never offer a fare watch there', 'Never say you "can check live prices" or "check live options"', 'Live fares need a Duffel rail (read first)'], ['(/utilities)', 'Connections page'], [['travel/tools/travel-app.html', 'no Duffel rail (no Duffel connector exists here)']]],
];

/** A prompt with its line breaks and indentation folded to single spaces. */
const flat = (value) => String(value || '').replace(/\s+/g, ' ');

test('each concierge names its app\'s real controls and states', () => {
  for (const [rel, must, mustNot, labels] of PERSONA_FACTS) {
    const text = flat((yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')) || {}).perspective);
    for (const phrase of must) assert.ok(text.includes(phrase), `${rel} says: ${phrase}`);
    for (const phrase of mustNot) assert.ok(!text.includes(phrase), `${rel} never says: ${phrase}`);
    for (const [screen, label] of labels) {
      assert.ok(fs.readFileSync(path.join(ROOT, screen), 'utf8').includes(label), `${screen} still shows ${label}`);
      assert.ok(text.includes(label.replace(/^label: /, '')), `${rel} names ${label}`);
    }
    assert.ok(CONCIERGES.includes(rel), `${rel} is a named concierge`);
  }
});

/** The persona file of the bot an application's chatBot names, resolved through its own or imported bots. */
function conciergePersona(app) {
  const manifest = (name) => yaml.load(fs.readFileSync(path.join(ROOT, name, 'oshal-app.yaml'), 'utf8')) || {};
  const own = manifest(app);
  const imports = ['required', 'optional'].flatMap((tier) => (own.dependencies?.[tier]?.bots) || []);
  const owner = (own.bots || []).some((bot) => bot.name === own.chatBot) ? app : imports.find((bot) => bot.name === own.chatBot)?.app;
  assert.ok(owner, `${app} chatBot ${own.chatBot} is declared or imported`);
  const bot = (manifest(owner).bots || []).find((item) => item.name === own.chatBot);
  return path.join(owner, bot.persona);
}

test('the Games concierge names Game Show\'s real controls and never sends a show elsewhere', () => {
  const rel = conciergePersona('games');
  const text = flat((yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')) || {}).perspective);
  const screen = fs.readFileSync(path.join(ROOT, 'game-show/ui/gs-surfaces.js'), 'utf8');
  for (const label of ['Play against the computer', 'Host for friends instead', 'Join game', 'Enter join code', 'New game', 'Your open games', 'How to play']) {
    assert.ok(screen.includes(label), `game-show/ui/gs-surfaces.js still shows ${label}`);
    assert.ok(text.includes(label), `${rel} names ${label}`);
  }
  const shows = fs.readdirSync(path.join(ROOT, 'game-show/lib/shows')).flatMap((file) => [...fs.readFileSync(path.join(ROOT, 'game-show/lib/shows', file), 'utf8').matchAll(/id: ID, title: '([^']+)'/g)].map((m) => m[1].replace(/!$/, '')));
  assert.equal(shows.length, 4, 'the four catalog shows');
  for (const show of shows) assert.ok(text.includes(show), `${rel} names the show ${show}`);
  assert.ok(text.includes('Never say a show cannot be hosted here'), `${rel} forbids sending a show elsewhere`);
  assert.ok(text.includes('never Start New Campaign'), `${rel} keeps D&D controls out of Game Show answers`);
});

test('pending entries hide only themselves and fail once fixed', () => {
  const pending = new Set(['known']);
  assert.deepEqual(unexpected(['known', 'new'], pending), ['new']);
  assert.deepEqual(unexpected([], pending), ['pending entry no longer violates; remove it: known']);
});

test('this repository has no unexpected store bot violation', () => {
  const manifests = readManifests(ROOT, yaml);
  const problems = [...routeBotProblems(ROOT, manifests), ...conciergeBindingProblems(ROOT, yaml, manifests), ...personaProblems(ROOT, yaml)];
  assert.deepEqual(unexpected(problems, PENDING), []);
  for (const app of ['home-experience', 'jarvis-experience', 'games', 'social', 'purchasing']) {
    assert.ok(!problems.some((problem) => problem.startsWith(`route ${app}/`) || problem.startsWith(`app ${app} `)), `${app} has a concierge and route bots the kernel runs`);
  }
  for (const rel of ['social/personas/social-writer.yaml', 'sat-ops/personas/sat-operator.yaml', 'aero-lab/personas/aero-designer.yaml']) {
    assert.ok(CONCIERGES.includes(rel), `${rel} answers a person directly`);
  }
  for (const rel of ['storage/routes/storage-routes.js', 'presentations/routes/bot-presentation-routes.js', 'switchboard/routes/switchboard-compose-routes.js', 'camera/routes/camera-routes.js', 'home/routes/home-routes.js', 'eats/routes/eats-routes.js']) {
    assert.ok(!problems.some((problem) => problem.includes(rel)), `${rel} calls only bots the kernel runs for it`);
  }
  assert.ok(CONCIERGES.length >= 14);
  assert.ok(CONCIERGES.includes('feeds/personas/feeds-curator.yaml'), 'the Feeds curator answers a person directly');
});

test('Create and Video editing agents bind actual bounded API tools, immutable model schemas and named permissions', async () => {
 const manifests=readManifests(ROOT,yaml);
 for(const pkg of ['create','video']) {
  const manifest=yaml.load(fs.readFileSync(path.join(ROOT,pkg,'oshal-app.yaml'),'utf8')),bot=manifest.bots.find(bot=>bot.name===pkg+'-editor');
  assert.equal(manifest.chatBot,bot.name);assert.equal(bot.posture,'inline');
  const persona=yaml.load(fs.readFileSync(path.join(ROOT,pkg,bot.persona),'utf8'));
  assert.equal(persona.agent_id,bot.agentId);assert.match(persona.perspective,/```tool_call/);assert.match(persona.perspective,/baseRevision/);
  const module=await import(pathToFileURL(path.join(ROOT,pkg,'tools/editor/agent-tools.mjs')).href);
  const tools=manifest.tools.filter(tool=>tool.executor?.executorType==='api');assert.equal(tools.length,pkg==='create'?9:12);
  const edit=tools.find(tool=>tool.name===pkg+'-apply-edits');assert.deepEqual(edit.inputSchema.properties.operations.items,module.operationSchema);
  assert.equal(edit.inputSchema.additionalProperties,false);assert.deepEqual(edit.inputSchema.required,['id','baseRevision','operations']);
  const catalog=yaml.load(fs.readFileSync(path.join(ROOT,pkg,'authorization.yaml'),'utf8'));
  for(const tool of tools) {
   assert.equal(persona.authorizations[tool.name],tool.defaultAuthMode);
   const [method,pathTemplate]=tool.executor.apiEndpoint.split(' ');const base=pkg==='create'?'/api/create':'/api/video';
   const route=pathTemplate.slice(base.length).replace('{input.id}',':id').replace('{input.ref}',':ref');
   if(pathTemplate.includes('{input.ref}')){assert.equal(pkg,'create');assert.equal(tool.name,'create-inspect-psd');assert.equal(method,'GET');assert.equal(pathTemplate,'/api/create/psd-artifacts/{input.ref}/inspect');assert.ok(tool.inputSchema.properties.ref);}
   assert.ok(catalog.bindings.http.some(binding=>binding.method===method&&binding.path===route),`${tool.name} has its own named binding`);
   const catalogue=pkg==='video'&&tool.name==='video-list-motion-renders';
   if(catalogue){
    assert.equal(method,'POST');assert.equal(pathTemplate,'/api/video/editor/motion-renders');
    assert.deepEqual(tool.inputSchema,{type:'object',additionalProperties:false,properties:{}});
    assert.deepEqual(catalog.bindings.tools.find(binding=>binding.id===tool.name).allOf,['editor.view','editor.read','editor.change']);
    assert.deepEqual(catalog.bindings.http.find(binding=>binding.path===route&&binding.method===method).allOf,['editor.view','editor.read','editor.change']);
    assert.match(tool.description,/original Writer/);assert.match(tool.usageInstructions,/metadata call creates no project, render/);
   }
   assert.equal(tool.requiresApproval,method!=='GET'&&!catalogue);assert.equal(tool.defaultAuthMode,method==='GET'||catalogue?'auto':'ask');
   assert.equal(tool.inputSchema.additionalProperties,false);
  }
  assert.match(persona.perspective,pkg==='create'?/still unbuilt/:/remain unavailable in this editor/);
  if(pkg==='video') {
   const motion=tools.find(tool=>tool.name==='video-import-motion-render');
   assert.deepEqual(motion.inputSchema.required,['ref','name','requestKey']);
   assert.equal(motion.requiresApproval,true);assert.equal(motion.defaultAuthMode,'ask');
   assert.deepEqual(catalog.bindings.tools.find(binding=>binding.id===motion.name).allOf,['editor.view','editor.read','editor.change']);
   assert.match(persona.perspective,/Never invent lineage/);
  }
 }
});
