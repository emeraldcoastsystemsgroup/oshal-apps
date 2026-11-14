/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Jarvis names the application of a step from the descriptions in its catalog (oshal-kernel ADR-212), and a catalog line shows only an application's first eight declared actions, so Intelligent Trades' Trading Performance (its thirteenth tool) never reached the model. "How did my stocks do last week?" went to Finance in kernel scoreboard round 3 (adr212-40c4ddd8) and on production: both descriptions claimed the person's brokerages and holdings, and neither said which one reports how they performed. Intelligent Trades 1.53.8 states the performance its tools report; Finance 1.4.3 states its holdings are as of the last sync and that performance over time is not tracked. Each statement is checked against the tools the manifest declares, so a description cannot promise what no tool does.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | J-3 & J-6: Camera Ops 1.2.1 states it drives GoPro action cameras and Wi-Fi/USB field cameras and does not read SmartThings devices, smart-home cameras, or refrigerator/appliance interior cameras. Smart Home 1.5.0 states it inspects SmartThings devices and reads Samsung Family Hub refrigerator interior cameras (samsungce.viewInside), and keeps Inspect SmartThings Device and Refrigerator View Inside Camera in its first eight declared actions within the 200-character catalog budget.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Portrait Studio 1.17.7 says what it makes. Its description said only "Edit face crops and generation settings in a saved source project ...", so on blue (kernel f86cd306, routing scoreboard r1-before, 3 of 3 runs) "Create a pet portrait of my golden retriever as an astronaut" went to Create and Jarvis called Portrait Studio "built for editing face crops and generation settings on saved photos". The description now says it turns a person's or pet's photo into a headshot, a character portrait or a group scene, each checked against the package's own prompt builder (routes/portrait-catalog.js), and still names the saved projects its declared tools edit.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Calendar Preparation 1.3.0 says it adds single and repeating events to the person's Google Calendar. Production, 2026-11-13: "add that to my Google calendar" (every Friday, 6 to 7 PM) was handed to it while it could neither write Google Calendar nor repeat an event, so Jarvis had no installed application that did and the step ended at the app's refusal. The description is a sentence about the product, not a list of words.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | One application keeps the grocery list. On the test installation, 2026-11-14, "add eggs, bread and bananas to my grocery list" went to Smart Home, whose description said it "keeps your own grocery list", while Shopping, the only application that can order, never said "grocery list"; "order the groceries" was then sent to both and nothing was ordered. Shopping 1.5.0 says it keeps the grocery and shopping list and makes the grocery order from it, with a declared order tool; Smart Home 1.9.0 and Lists 1.0.0 say the grocery list is Shopping's and declare no tool that keeps one; no other description in the store claims a grocery list.
 *
 * Plain `node --test` suite; js-yaml comes from the store toolchain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLCHAIN = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(ROOT, 'scripts', 'toolchain'));
const yaml = createRequire(path.join(TOOLCHAIN, 'package.json'))('js-yaml');

/** A package's manifest, read from its folder. */
function manifest(folder) {
  return yaml.load(fs.readFileSync(path.join(ROOT, folder, 'oshal-app.yaml'), 'utf8'));
}

/** The descriptions of the tools a manifest declares and does not disable, by tool name. */
function tools(app) {
  return new Map((app.tools || []).filter((tool) => tool.enabled !== false)
    .map((tool) => [tool.name, String(tool.description || '')]));
}

/** A description as the kernel's catalog shows it: one line. */
function described(app) {
  return String(app.description || '').split(/\s+/).join(' ');
}

test('Intelligent Trades says it reports how the connected account performed, and a declared tool does', () => {
  const app = manifest('trading');
  const declared = tools(app);
  const text = described(app);
  assert.match(text, /how it performed over a week, a month or a year against the S&P 500/, text);
  assert.match(declared.get('trading_performance') || '', /did over a period/, 'Trading Performance reports a period');
  assert.match(text, /positions, day change/, text);
  assert.match(declared.get('trading_accounts') || '', /day change and current holdings/, 'connected account positions');
});

test('Finance says its holdings are as of the last sync and that it does not track performance over time', () => {
  const app = manifest('finance');
  const text = described(app);
  assert.match(text, /holdings count toward net worth as they stood at the last sync/, text);
  assert.match(text, /how investments performed over time is not tracked here/, text);
  for (const [name, description] of tools(app)) {
    assert.match(description, /last sync|saved finance evidence/, `${name} reads the saved aggregate only`);
    assert.doesNotMatch(description, /over a period|performance|return over/i, `${name} reports no performance`);
  }
});

test('Camera Ops says it drives GoPro/field cameras and does not read SmartThings or refrigerator interior cameras; Smart Home exposes SmartThings device inspection and samsungce.viewInside within its first 8 catalog actions', () => {
  const cameraApp = manifest('camera');
  const cameraText = described(cameraApp);
  assert.match(cameraText, /GoPro/i, cameraText);
  assert.match(cameraText, /does not read SmartThings devices, smart-home cameras, or refrigerator\/appliance interior cameras/i, cameraText);

  const homeApp = manifest('home');
  const homeText = described(homeApp);
  const homeDeclared = tools(homeApp);
  assert.match(homeText, /SmartThings/i, homeText);
  assert.match(homeText, /samsungce\.viewInside/i, homeText);
  assert.ok(homeDeclared.has('home-device-inspect'), 'home-device-inspect is declared');
  assert.ok(homeDeclared.has('home-view-inside'), 'home-view-inside is declared');
  assert.match(homeDeclared.get('home-view-inside') || '', /samsungce\.viewInside/i);

  const firstEight = (homeApp.tools || []).filter((t) => t.enabled !== false).slice(0, 8);
  const firstEightNames = firstEight.map((t) => t.name);
  assert.ok(firstEightNames.includes('home-device-inspect'), `home-device-inspect must be in first 8 actions: ${firstEightNames.join(', ')}`);
  assert.ok(firstEightNames.includes('home-view-inside'), `home-view-inside must be in first 8 actions: ${firstEightNames.join(', ')}`);
  const actionLine = firstEight.map((t) => t.displayName || t.name).join(', ');
  assert.ok(actionLine.length <= 200, `first 8 displayNames must fit within 200-char catalog action budget (${actionLine.length}): ${actionLine}`);
});

test('Portrait Studio says it turns a person\'s or pet\'s photo into a portrait in each of its modes, and its prompt builder makes each one', () => {
  const app = manifest('portrait-studio');
  const text = described(app);
  assert.match(text, /^Turn your own photo of a person or a pet into a portrait worth framing:/, text);
  assert.match(text, /a professional headshot, a character portrait .+, or one group scene with every face from a single photo\./, text);
  const catalog = createRequire(path.join(ROOT, 'portrait-studio', 'package.json'))('./routes/portrait-catalog.js');
  assert.deepEqual(catalog.PORTRAIT_MODES, ['professional', 'character', 'group'], 'the three modes the description names');
  const first = (presets) => presets[0].id;
  assert.match(catalog.buildPortraitPrompt('professional', first(catalog.PROFESSIONAL_PRESETS), {}),
    /^Professional portrait of the same subject as the provided photo/);
  assert.match(catalog.buildPortraitPrompt('character', first(catalog.CHARACTER_PRESETS), {}),
    /same fur or skin coloring/, 'a character portrait keeps a pet\'s face as well as a person\'s');
  assert.match(catalog.buildPortraitPrompt('group', first(catalog.GROUP_PRESETS), { subjects: 3 }),
    /^Group portrait of the 3 people in the provided reference photo/);
  assert.match(text, /keeps your original photos and saved projects, where you can edit each face crop and the generation settings/, text);
  const declared = tools(app);
  assert.match(declared.get('portrait-studio-source-list') || '', /saved editable source projects/);
  assert.match(declared.get('portrait-studio-source-contract') || '', /photo crops and generation settings/);
  assert.ok(declared.has('portrait-studio-source-edits'), 'the saved project is edited by a declared tool');
});

test('Calendar Preparation says plainly that it adds single and repeating events to Google Calendar, and a declared tool does', () => {
  const app = manifest('calendar');
  const text = described(app);
  assert.match(text, /^Add single and repeating events to your Google Calendar once you approve them, /, text);
  assert.match(text, /sync your upcoming primary-calendar events explicitly/, 'it still says what it syncs');
  const declared = tools(app);
  assert.match(declared.get('calendar-add-google-event') || '', /one event, or one repeating series, to the person's primary Google Calendar/);
  assert.ok(text.split(/\s+/).length <= 45, 'a product description, not a word list');
});

test('one application keeps the grocery list: Shopping says so and orders from it, Smart Home and Lists say it is Shopping\'s', () => {
  const shopping = manifest('purchasing'), home = manifest('home'), lists = manifest('lists');
  assert.match(described(shopping), /Keeps your grocery and shopping list and makes the grocery order from it/, described(shopping));
  const shoppingTools = tools(shopping);
  assert.match(shoppingTools.get('shopping-order') || '', /"order the groceries"/, 'a declared tool makes the order the description promises');
  for (const name of ['shopping-list-add', 'shopping-list-add-many']) assert.match(shoppingTools.get(name) || '', /grocery and shopping list/, `${name} writes the grocery list`);

  assert.match(described(home), /your grocery list is kept by Shopping, not here/, described(home));
  assert.doesNotMatch(described(home), /keeps your (own )?grocery list/);
  for (const [name, description] of tools(home)) {
    assert.doesNotMatch(description, /(start|update|add to|put on|keep) [^.]*\b(the person's own|their|a|your) grocery list/i, `${name} keeps no grocery list`);
  }
  const mealTool = home.tools.find((tool) => tool.name === 'home-fridge-meal-cart');
  assert.ok(!mealTool.inputSchema.properties.action.enum.some((action) => /cart/.test(action)), 'Smart Home\'s tool takes no grocery action');

  assert.match(described(lists), /Your grocery and shopping list is not kept here: Shopping keeps it and makes the grocery order from it/, described(lists));
  for (const [name, description] of tools(lists)) assert.doesNotMatch(description, /grocer|shopping/i, `${name} is about the person's other lists`);

  // No other application in the store says it keeps a grocery or shopping list.
  const keepers = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(ROOT, entry.name, 'oshal-app.yaml')))
    .filter((entry) => /\bkeeps? (your|your own|the person's|their) (own )?(grocery|shopping|grocery and shopping) list\b/i.test(described(manifest(entry.name))))
    .map((entry) => entry.name);
  assert.deepEqual(keepers, ['purchasing']);
});

