/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.4 (Lane A5): the kernel keeps a row for the eleven Linux programs Lane G3 measured on the Spark (Chrome, Firefox, Thunderbird, VS Code, Mousepad, Document Viewer, Files, Thunar, Okular, Image Viewer, Xfce Terminal; kernel PROGRAMS since 6e05f160), but the committed facts held only Text Editor, Terminal and Writer, so the writer asked for those eleven with nothing measured. These cases prove that every one of them now has its facts, that Chrome, VS Code, Firefox and Thunderbird say Lane G4's words (Orbit starts them readable when it opens them; a copy the person started unreadable is refused as started without accessibility), that the committed Linux entries are exactly what the package's own inputs/linux-pack-inputs.json gives, that every Linux request still leaves room to be asked once more, and that a Firefox text lacking G4's words is reported. The tick runs against the same stand-in for the kernel's rails as the package suite. Program versions are recorded fixture values; no computer was read.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane GD1): the Linux entries held to inputs/linux-pack-inputs.json are those of Lane G's bridges; the Godot editor's (bridge godot) comes from the package's own inputs/godot-pack-inputs.json and has its cases in tests/godot-program.test.cjs.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane LX1): the kernel keeps a row for nineteen everyday Linux programs Lane LX1 measured on the Spark (kernel 52981f3b; Orbit's bridge on them 4eb54fdb): each has its measured facts, qBittorrent, Claude and ChatGPT say that Orbit starts them readable and how a copy the person started is refused, File Roller says its file list is not published, and Document Scanner and Transmission say what is not done without the person asking.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane BL1): the Linux entries compared with Lane G's inputs leave out Blender, whose facts come from the package's own inputs/blender-pack-inputs.json (tests/blender-program.test.cjs holds those).
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane VS1): the Linux entries held to inputs/linux-pack-inputs.json are those not on the vscode bridge; VS Code's vscode entry is the package's own inputs/vscode-pack-inputs.json, held by vscode-programs.test.cjs.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const pack = require(path.join(root, 'lib/instruction-pack.js'));
const loadRoutes = () => import(pathToFileURL(path.join(root, 'routes/program-instructions.mjs')).href);
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

const CONTRACT = Object.freeze({
  tools: ['computer.app', 'computer.open'],
  actions: ['apps', 'snapshot', 'scroll', 'press', 'type', 'select', 'invoke', 'undo', 'restore'],
  min_bytes: 200,
  max_bytes: 8192
});
/** A claimed Linux row as the kernel's claim answer shapes it; the id, claim and version are fixture values. */
const claimed = (program, bridge = 'linux-atspi') => Object.freeze({
  id: 'ab'.repeat(32), claim: 'cd'.repeat(16), platform: 'linux', program, version: '1.0.0', version_kind: 'package',
  bridge, attempt: 1, expires_at: 1794560555986, contract: CONTRACT
});
/** The eleven programs Lane G3 measured (kernel PROGRAMS since 6e05f160), through the linux-atspi bridge. */
const G3 = ['google-chrome', 'firefox', 'thunderbird', 'com.microsoft.vscode', 'org.xfce.mousepad', 'org.gnome.evince',
  'org.gnome.nautilus', 'thunar', 'org.kde.okular', 'org.gnome.eog', 'xfce4-terminal'];
/** The programs Orbit starts readable when it opens them (Lane G4, kernel 6602c84d). */
const G4 = ['google-chrome', 'com.microsoft.vscode', 'firefox', 'thunderbird'];
const STARTED_UNREADABLE = 'it was started without accessibility; close it and let Jarvis open it, or use the mouse and keyboard.';

test('every Linux program Lane G3 measured has its measured facts', () => {
  for (const program of G3) assert.ok(pack.factsFor(claimed(program)), `lib/program-facts.json has linux, ${program}, linux-atspi`);
});

test('Chrome, VS Code, Firefox and Thunderbird say that Orbit starts them readable and how a copy started unreadable is refused', () => {
  for (const program of G4) {
    const facts = pack.factsFor(claimed(program));
    assert.ok(facts, program);
    const first = facts.facts[0];
    assert.ok(first.includes(STARTED_UNREADABLE) && first.includes('Orbit') && first.includes('computer.open'), `${program}: ${first}`);
    assert.ok(facts.contains.includes('started without accessibility'), `${program} requires G4's words`);
    assert.ok(!facts.facts.some((fact) => /the person restarts|With the switch on/.test(fact)), `${program} keeps no word G4 replaced`);
  }
});

test('the committed Linux entries are what the package\'s own Linux inputs give, and every Linux request leaves room to be asked once more', () => {
  const { distil } = require(path.join(root, 'scripts/program-facts.cjs'));
  const inputs = readJson('inputs/linux-pack-inputs.json');
  // The Godot editor's Linux entry comes from inputs/godot-pack-inputs.json (tests/godot-program.test.cjs), Blender's from
  // inputs/blender-pack-inputs.json (tests/blender-program.test.cjs) and VS Code's vscode entry from inputs/vscode-pack-inputs.json
  // (vscode-programs.test.cjs), not from this file.
  const own = new Set(readJson('inputs/blender-pack-inputs.json').programs.map((entry) => `${entry.program}/${entry.bridge}`));
  const linux = pack.PROGRAM_FACTS.programs.filter((entry) => entry.platform === 'linux' && entry.bridge !== 'godot' && entry.bridge !== 'vscode' && !own.has(`${entry.program}/${entry.bridge}`));
  assert.deepEqual(linux, distil(inputs).programs);
  assert.deepEqual(linux.map((entry) => entry.program), inputs.programs.map((entry) => entry.program));
  for (const entry of linux) {
    const text = pack.requestText(claimed(entry.program, entry.bridge));
    for (const line of [...entry.facts, ...entry.never, ...entry.contains]) assert.ok(text.includes(`  - ${line}\n`), line.slice(0, 80));
    assert.ok(pack.retryText(text, 'x'.repeat(pack.MAX_DETAIL_CHARS)), `${entry.program}: a second request still fits under 8 KiB`);
  }
});

test('a Firefox text holding the measured words is published; one without G4\'s words is reported', async () => {
  const { runInstructionTick } = await loadRoutes();
  const firefox = claimed('firefox');
  const holding = [
    '# Firefox on Linux (fixture text for a test, not documentation)', '',
    'Open Firefox with computer.open so Orbit starts it readable, then read the page with {"action": "snapshot"}.',
    'A Firefox the person started without accessibility is refused as started without accessibility: ask them to close it.',
    'Typing into a page is refused: This needs the mouse and keyboard.'
  ].join('\n');
  assert.equal(pack.checkBody(holding, CONTRACT, 'linux-atspi', firefox.program), null);
  assert.equal(pack.acceptanceProblem(holding, firefox), null, `holds ${pack.factsFor(firefox).contains.join(', ')}`);
  const published = standInKernel({
    'application_profiles.claim': { requests: [firefox] }, bot: { response: holding }, 'application_profiles.publish': { status: 'published' }
  });
  assert.deepEqual(await runInstructionTick(published.ctx), { status: 200, body: { claimed: 1, published: 1, failed: 0 } });
  const lacking = holding.replace(/^A Firefox the person started .*$/m, 'A Firefox the person started is refused: ask them to close it.');
  const refused = standInKernel({
    'application_profiles.claim': { requests: [firefox] }, bot: { response: lacking }, 'application_profiles.fail': { status: 'pending' }
  });
  assert.deepEqual(await runInstructionTick(refused.ctx), { status: 200, body: { claimed: 1, published: 0, failed: 1 } });
  assert.equal(refused.calls.at(-1).input.detail, 'the text lacks what the measured facts require: started without accessibility');
});

/** The package suite's stand-in for the kernel's rails: each call by name answers what the case scripts, and is recorded. */
function standInKernel(script) {
  const calls = [];
  const answer = (step, input) => {
    calls.push({ step, input });
    if (script[step] === undefined) throw new Error(`refused: the stand-in kernel has no answer for ${step}`);
    return script[step];
  };
  return { calls, ctx: { intent: async (name, input) => answer(name, input), executeBot: async (agentId, request) => answer('bot', { agentId, request }) } };
}

/** The nineteen everyday programs Lane LX1 measured (kernel PROGRAMS since 52981f3b), through the linux-atspi bridge. */
const LX1 = ['gedit', 'org.gnome.calculator', 'org.gnome.todo', 'simple-scan', 'org.gnome.calendar', 'org.gnome.characters',
  'transmission-gtk', 'org.gnome.fileroller', 'com.github.jeromerobert.pdfarranger', 'org.gnome.systemmonitor',
  'org.gnome.font-viewer', 'org.gnome.totem', 'org.gnome.rhythmbox3', 'org.gnome.shotwell', 'org.xfce.ristretto',
  'org.remmina.remmina', 'org.qbittorrent.qbittorrent', 'com.anthropic.claude', 'chatgpt'];
/** The ones Orbit starts readable when it opens them: a Qt 6 program and two Chromium programs (kernel 4eb54fdb, 6602c84d). */
const LX1_READABLE = ['org.qbittorrent.qbittorrent', 'com.anthropic.claude', 'chatgpt'];

test('every everyday Linux program Lane LX1 measured has its measured facts, each citing its suite', () => {
  for (const program of LX1) {
    const facts = pack.factsFor(claimed(program));
    assert.ok(facts, `lib/program-facts.json has linux, ${program}, linux-atspi`);
    assert.ok(facts.facts.length >= 1 && facts.never.includes('Any tool other than computer.app and computer.open.'), program);
  }
  const inputs = readJson('inputs/linux-pack-inputs.json').programs.filter((entry) => LX1.includes(entry.program));
  assert.equal(inputs.length, LX1.length);
  for (const entry of inputs) assert.ok(entry.must_say.every(({ evidence }) => evidence.includes('test-linux-everyday-programs.cjs')), entry.program);
});

test('qBittorrent, Claude and ChatGPT say that Orbit starts them readable and how a copy the person started is refused; what is never done without the person asking is said', () => {
  for (const program of LX1_READABLE) {
    const facts = pack.factsFor(claimed(program));
    assert.ok(facts.facts[0].includes(STARTED_UNREADABLE) && facts.facts[0].includes('computer.open'), `${program}: ${facts.facts[0]}`);
    assert.ok(facts.contains.includes('started without accessibility'), program);
  }
  assert.ok(pack.factsFor(claimed('org.gnome.fileroller')).facts.some((fact) => /not published/.test(fact)));
  assert.ok(pack.factsFor(claimed('simple-scan')).never.includes('That a scan was made without the person asking.'));
  assert.ok(pack.factsFor(claimed('transmission-gtk')).never.includes('That a download was started without the person asking.'));
});
