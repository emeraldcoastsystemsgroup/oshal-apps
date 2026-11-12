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
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Verify all 15 studio, editor, and device packages that mount registerDocumentSession conform strictly to the Create concierge pattern.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Concierge audit batch 2a: ten more side-chat bots run inline, are registered in CONCIERGES and carry Create's persona rules, with the tool_call fence exactly when the package offers route tools.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | PENDING (T15): Create's region-edit spend and LoRA's routes name their package's own declared bot (create-editor, lora-director) in source and compiled routes, and no route problem names those files.
 * 13 | maintainer@emeraldcoastsystemsgroup.com | PENDING (T15): the Movies and Spotify concierges run inline as their packages' chatBots with Create's persona rules, the fence exactly when the package offers route tools, and the rule that returns their chat route's reply object with the prose in its "say" field; their route files raise no problem.
 * 14 | maintainer@emeraldcoastsystemsgroup.com | PENDING (T15): Commons, Orbit and Studio name jarvis's oshal-assistant, Classroom Little Monsters' class-tutor and Job Apply Career's career-concierge, each imported from a required member that declares it inline; every Classroom role template maps Little Monsters to a role granting class-tutor's binding, and Job Apply's workflow keeps its imported career-hunter worker.
 * 15 | maintainer@emeraldcoastsystemsgroup.com | PENDING (T15): Life, System, the Developer Workspace Index and Hello OSHAL borrow jarvis's oshal-assistant by name: no bot, workflow or bot import of their own, and no concierge binding problem.
 * 16 | maintainer@emeraldcoastsystemsgroup.com | Concierge audit batch 2b: Intelligent Operations and Kalshi. Each side-chat bot runs inline, is registered in CONCIERGES and carries Create's persona rules with the tool_call fence (both packages offer route tools), and none is a bot its package's workflow runs: Operations' front desk is ops-concierge, not its RCA investigator ops-rca-specialist, whose phases stay as they were.
 * 17 | maintainer@emeraldcoastsystemsgroup.com | Concierge audit (T15), the batch after 2b: Intelligent Processing. Its chatBot is a bot it declares itself (the kernel runs a bot with its owner's tools, so the imported ops-rca-specialist answered with Operations' tools and no read of this queue), inline, registered in CONCIERGES, with Create's persona rules and the tool_call fence over its own route tool; it is no worker of the workflow, which still runs the imported specialist and reviewer, and Operations' ops-concierge is not imported in its place.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONCIERGES, PENDING, conciergeBindingProblems, personaProblems, posture, readManifests, routeBotProblems, unexpected } from './check-store-bots.mjs';

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
  const tools=manifest.tools.filter(tool=>tool.executor?.executorType==='api');assert.equal(tools.length,pkg==='create'?10:12);
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

test('all 15 studio, editor, and device packages that mount registerDocumentSession conform strictly to the Create concierge pattern', () => {
  const studioApps = [
    'brand-graphics', 'cad-studio', 'circuit-lab', 'creative-studio', 'design-studio',
    'lora', 'motion-studio', 'pdf-workbench', 'phone-control', 'portrait-studio',
    'presentations', 'publishing-studio', 'scan-to-print', 'scene-studio', 'vids',
  ];
  for (const pkg of studioApps) {
    const manifest = yaml.load(fs.readFileSync(path.join(ROOT, pkg, 'oshal-app.yaml'), 'utf8'));
    assert.ok(typeof manifest.chatBot === 'string' && manifest.chatBot.length > 0, `${pkg} declares explicit chatBot`);
    const bot = (manifest.bots || []).find((b) => b.name === manifest.chatBot);
    assert.ok(bot, `${pkg} declares bot ${manifest.chatBot}`);
    assert.equal(bot.posture, 'inline', `${pkg} bot ${bot.name} has posture: inline`);
    const rel = `${pkg}/${bot.persona}`;
    assert.ok(CONCIERGES.includes(rel), `${rel} is registered in CONCIERGES`);
    const persona = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.equal(persona.runtime?.harness, 'claude-code', `${rel} uses claude-code harness`);
    assert.match(persona.perspective, /plain prose/i, `${rel} carries plain-prose rule`);
    assert.ok(persona.perspective.includes('```tool_call'), `${rel} teaches the \`\`\`tool_call fence`);
  }
});

test('concierge audit batch 2a: ten more side-chat bots follow the Create concierge pattern', () => {
  for (const pkg of ['animatronics', 'calling-assistant', 'codex-packer', 'drone-relay', 'eats', 'identity', 'little-monsters', 'person-model', 'purchasing', 'rides']) {
    const manifest = yaml.load(fs.readFileSync(path.join(ROOT, pkg, 'oshal-app.yaml'), 'utf8'));
    const bot = (manifest.bots || []).find((b) => b.name === manifest.chatBot);
    assert.ok(bot, `${pkg} declares its side-chat bot ${manifest.chatBot}`);
    assert.equal(posture(bot), 'inline', `${pkg} side-chat bot runs inline`);
    const rel = path.join(pkg, bot.persona.replace(/^\.\//, ''));
    assert.ok(CONCIERGES.includes(rel), `${rel} is registered in CONCIERGES`);
    const persona = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.equal(persona.runtime?.harness, 'claude-code', `${rel} names Create's harness`);
    assert.match(persona.perspective, /plain prose/i, `${rel} carries the plain-prose rule`);
    const routeTools = (manifest.tools || []).some((t) => t && t.executor && t.executor.executorType === 'api');
    assert.equal(persona.perspective.includes('```tool_call'), routeTools, `${rel} teaches the tool_call fence exactly when its package offers route tools`);
  }
});

/** A route constant's value in source (`const X = '...'`, `export const X = '...'`) or compiled (`exports.X = '...'`) form. */
function routeConstant(rel, name) {
  const match = new RegExp(`(?:const|exports\\.)\\s*${name}\\s*=\\s*'([^']+)'`).exec(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  assert.ok(match, `${rel} sets ${name}`);
  return match[1];
}

test('Create region edits and LoRA routes name their own package\'s declared bot (T15)', () => {
  const manifests = readManifests(ROOT, yaml);
  const own = (app, name) => manifests.get(app).bots.find((bot) => bot.name === name).agentId;
  const files = {
    'create/src-routes/create-region-edit-routes.ts': ['REGION_EDIT_COST_AGENT_ID', own('create', 'create-editor')],
    'create/routes/create-region-edit-routes.js': ['REGION_EDIT_COST_AGENT_ID', own('create', 'create-editor')],
    'lora/src-routes/bot-lora-routes.ts': ['LORA_DIRECTOR_AGENT_ID', own('lora', 'lora-director')],
    'lora/routes/bot-lora-routes.js': ['LORA_DIRECTOR_AGENT_ID', own('lora', 'lora-director')],
    'lora/src-routes/lora-train-dispatch.ts': ['LORA_DIRECTOR_AGENT_ID', own('lora', 'lora-director')],
    'lora/routes/lora-train-dispatch.js': ['LORA_DIRECTOR_AGENT_ID', own('lora', 'lora-director')],
  };
  const problems = routeBotProblems(ROOT, manifests);
  for (const [rel, [name, id]] of Object.entries(files)) {
    assert.equal(routeConstant(rel, name), id, `${rel} ${name} is the package's own bot`);
    assert.ok(!problems.some((problem) => problem.includes(rel)), `${rel} calls only bots its package declares`);
  }
});

test('the Movies and Spotify concierges run inline as their chatBots and follow the Create concierge pattern (T15)', () => {
  const problems = routeBotProblems(ROOT, readManifests(ROOT, yaml));
  for (const pkg of ['movies', 'spotify']) {
    const manifest = yaml.load(fs.readFileSync(path.join(ROOT, pkg, 'oshal-app.yaml'), 'utf8'));
    const bot = (manifest.bots || []).find((b) => b.name === manifest.chatBot);
    assert.ok(bot, `${pkg} names its own concierge as chatBot`);
    assert.equal(bot.name, manifest.workflow.workerBot, `${pkg} chatBot is its workflow bot`);
    assert.equal(bot.posture, 'inline', `${pkg} concierge runs inline`);
    assert.equal(bot.container, undefined, `${pkg} concierge has no dedicated container`);
    assert.notEqual(bot.requiresOwnNode, true, `${pkg} concierge needs no node`);
    const rel = path.join(pkg, bot.persona);
    assert.ok(CONCIERGES.includes(rel), `${rel} is registered in CONCIERGES`);
    const persona = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.equal(persona.agent_id, bot.agentId, `${rel} carries the declared identity`);
    assert.equal(persona.runtime?.harness, 'claude-code', `${rel} names Create's harness`);
    assert.match(persona.perspective, /plain prose/i, `${rel} carries the plain-prose rule`);
    const routeTools = (manifest.tools || []).some((t) => t && t.executor && t.executor.executorType === 'api');
    assert.equal(persona.perspective.includes('```tool_call'), routeTools, `${rel} teaches the tool_call fence exactly when its package offers route tools`);
    const route = fs.readFileSync(path.join(ROOT, pkg, 'src-routes', `${pkg}-routes.ts`), 'utf8');
    assert.ok(route.includes('Reply with ONLY a JSON object'), `${pkg} chat route still asks for its reply object`);
    assert.ok(flat(persona.perspective).includes('with your prose in its "say" field'), `${rel} returns that object instead of refusing it`);
    for (const dir of ['routes', 'src-routes']) {
      assert.ok(!problems.some((problem) => problem.startsWith(`route ${pkg}/${dir}/`)), `${pkg}/${dir} calls only bots the kernel runs with its tools`);
    }
  }
});

test('experience and Job Apply concierges are imported inline member concierges, not general-bot (T15)', () => {
  const manifests = readManifests(ROOT, yaml);
  const load = (app) => yaml.load(fs.readFileSync(path.join(ROOT, app, 'oshal-app.yaml'), 'utf8'));
  const expected = {
    'commons-experience': ['jarvis', 'oshal-assistant'], 'orbit-experience': ['jarvis', 'oshal-assistant'],
    'studio-experience': ['jarvis', 'oshal-assistant'], 'classroom-experience': ['little-monsters', 'class-tutor'],
    'job-apply': ['career-hunter', 'career-concierge'],
  };
  const bindings = conciergeBindingProblems(ROOT, yaml, manifests);
  for (const [app, [owner, bot]] of Object.entries(expected)) {
    const manifest = load(app);
    assert.equal(manifest.chatBot, bot, `${app} names ${bot}`);
    assert.ok(manifest.dependencies.required.apps.includes(owner), `${app} requires ${owner}`);
    assert.ok(manifest.dependencies.required.bots.some((b) => b.app === owner && b.name === bot), `${app} imports ${owner}/${bot}`);
    const declared = manifests.get(owner);
    if (declared) assert.equal(posture(declared.bots.find((b) => b.name === bot)), 'inline', `${owner}/${bot} runs inline`);
    assert.ok(!bindings.some((problem) => problem.startsWith(`app ${app} `)), `${app} has a concierge the kernel runs with its data`);
  }
  const jobApply = load('job-apply');
  assert.equal(jobApply.workflow.workerBot, 'career-hunter', 'Job Apply keeps its Career worker');
  assert.ok(jobApply.dependencies.required.bots.some((b) => b.app === 'career-hunter' && b.name === 'career-hunter'), 'and still imports it');
  // A Classroom person can run class-tutor: every template maps Little Monsters to a role that grants its bot binding.
  const lm = load('little-monsters');
  const catalog = yaml.load(fs.readFileSync(path.join(ROOT, 'little-monsters', lm.authorization.catalog), 'utf8'));
  const tutorId = lm.bots.find((b) => b.name === 'class-tutor').agentId;
  const needs = catalog.bindings.bots.find((b) => b.id === tutorId).allOf;
  for (const template of load('classroom-experience').experience.roleTemplates) {
    const roles = template.members.filter((m) => m.app === 'little-monsters').map((m) => m.role);
    assert.ok(roles.length, `${template.id} maps Little Monsters`);
    const granted = new Set(roles.flatMap((role) => catalog.roles[role].grants.map((g) => g.permission)));
    for (const permission of needs) assert.ok(granted.has(permission), `${template.id} grants ${permission} for class-tutor`);
  }
});

test('launchers, the developer index and the example borrow the platform assistant instead of general-bot (T15)', () => {
  const bindings = conciergeBindingProblems(ROOT, yaml, readManifests(ROOT, yaml));
  for (const app of ['life', 'system', 'dev-workspace-index', 'hello-oshal']) {
    const manifest = yaml.load(fs.readFileSync(path.join(ROOT, app, 'oshal-app.yaml'), 'utf8'));
    assert.equal(manifest.chatBot, 'oshal-assistant', `${app} borrows the platform assistant`);
    assert.deepEqual(manifest.bots || [], [], `${app} declares no bot of its own`);
    assert.equal(manifest.workflow, undefined, `${app} runs no workflow, so Jarvis keeps a request that names it`);
    for (const tier of ['required', 'optional']) assert.deepEqual(manifest.dependencies?.[tier]?.bots || [], [], `${app} imports no bot`);
    assert.ok(!bindings.some((problem) => problem.startsWith(`app ${app} `)), `${app} has no concierge binding problem`);
  }
});

test('concierge audit batch 2b: Intelligent Operations and Kalshi follow the Create concierge pattern, with a front desk apart from the workers', () => {
  for (const [pkg, chat] of [['intelligent-operations', 'ops-concierge'], ['kalshi', 'kalshi-quant']]) {
    const manifest = yaml.load(fs.readFileSync(path.join(ROOT, pkg, 'oshal-app.yaml'), 'utf8'));
    assert.equal(manifest.chatBot, chat, `${pkg} names its own side-chat bot`);
    const bot = (manifest.bots || []).find((b) => b.name === manifest.chatBot);
    assert.ok(bot, `${pkg} declares its side-chat bot ${manifest.chatBot}`);
    assert.equal(bot.posture, 'inline', `${pkg} side-chat bot runs inline, explicitly`);
    const phases = (manifest.workflow?.phases || []).map((phase) => phase.bot).filter(Boolean);
    assert.ok(!phases.includes(bot.name) && manifest.workflow?.workerBot !== bot.name, `${pkg} side-chat bot is not a worker of its workflow`);
    const rel = path.join(pkg, bot.persona.replace(/^\.\//, ''));
    assert.ok(CONCIERGES.includes(rel), `${rel} is registered in CONCIERGES`);
    const persona = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.equal(persona.runtime?.harness, 'claude-code', `${rel} names Create's harness`);
    assert.match(persona.perspective, /plain prose/i, `${rel} carries the plain-prose rule`);
    assert.ok((manifest.tools || []).some((t) => t?.executor?.executorType === 'api'), `${pkg} offers route tools`);
    assert.ok(persona.perspective.includes('```tool_call'), `${rel} teaches the tool_call fence`);
  }
});

test('concierge audit (T15): Intelligent Processing answers from its own front desk, not an imported worker or Operations\' front desk', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(ROOT, 'intelligent-processing', 'oshal-app.yaml'), 'utf8'));
  const imported = ['required', 'optional'].flatMap((tier) => manifest.dependencies?.[tier]?.bots || []);
  const bot = (manifest.bots || []).find((b) => b.name === manifest.chatBot);
  assert.equal(manifest.chatBot, 'processing-concierge', 'Intelligent Processing names its own side-chat bot');
  assert.ok(bot, 'the chatBot is declared by the package, so the kernel runs it with the package\'s own route tools');
  assert.ok(!imported.some((b) => b.name === manifest.chatBot), 'the chatBot is not an imported bot');
  assert.ok(!imported.some((b) => b.name === 'ops-concierge'), 'Operations\' front desk is not borrowed: its tools read Operations\' records');
  assert.equal(bot.posture, 'inline', 'the side-chat bot runs inline, explicitly');
  const phases = (manifest.workflow?.phases || []).map((phase) => phase.bot).filter(Boolean);
  assert.ok(!phases.includes(bot.name), 'the side-chat bot is not a worker of its workflow');
  assert.deepEqual([...new Set(phases)], ['ops-rca-specialist', 'ops-incident-reviewer'], 'the workflow still runs the imported workers');
  for (const worker of ['ops-rca-specialist', 'ops-incident-reviewer']) {
    assert.ok(imported.some((b) => b.app === 'intelligent-operations' && b.name === worker), `${worker} is still imported`);
  }
  const rel = path.join('intelligent-processing', bot.persona.replace(/^\.\//, ''));
  assert.ok(CONCIERGES.includes(rel), `${rel} is registered in CONCIERGES`);
  const persona = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  assert.equal(persona.agent_id, bot.agentId, `${rel} carries the declared identity`);
  assert.equal(persona.runtime?.harness, 'claude-code', `${rel} names Create's harness`);
  assert.match(persona.perspective, /plain prose/i, `${rel} carries the plain-prose rule`);
  const tools = (manifest.tools || []).filter((t) => t?.executor?.executorType === 'api');
  assert.ok(tools.length > 0, 'Intelligent Processing offers its own route tools');
  for (const tool of tools) assert.match(tool.executor.apiEndpoint, /^GET \/api\/intelligent-processing\//, `${tool.name} reads a route of its own package`);
  assert.ok(persona.perspective.includes('```tool_call'), `${rel} teaches the tool_call fence`);
  assert.ok(!conciergeBindingProblems(ROOT, yaml, readManifests(ROOT, yaml)).some((problem) => problem.startsWith('app intelligent-processing ')));
});
