/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1 (T76, the blue proof of 2026-11-13): the writer is given the measured facts of the Linux application packs and a text is held to their words. The fixture tests/fixtures/writer-24.2.7-linux-libreoffice-0.1.0.md is byte for byte the text writer 0.1.0 published on the test slot for LibreOffice Writer 24.2.7 on Linux through the libreoffice bridge (SHA-256 565b96b7..., read back from the computer's own profile): it passed every rule 0.1.0 had and lacks four of the eight words the measured facts require (add-on, "part", whole, verified), because 0.1.0's request gave the bot only the bridge's verbs. These cases prove what the request carries and what the check refuses; the tick runs against the same stand-in for the kernel's rails as the package suite. Facts come from lib/program-facts.json, distilled by scripts/program-facts.cjs from Lane G's pack-inputs.json; the real file's --check runs in tests/sheet/.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1: the failure report of a text lacking the words carries them as its detail.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.2: the refused Writer answer is asked about once more before it is reported.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.1.3 (Lane A4): the committed facts also hold the Windows 11 Notepad, Word and Excel through the windows-uia bridge (from the package's own inputs/windows-pack-inputs.json) and carry one provenance entry for each inputs file; the distiller's command line writes that merged form.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 0.1.4 (Lane A5): the committed facts also hold PowerPoint (microsoft.office.powerpnt.exe.15) through the windows-uia bridge, last, from the package's own inputs/windows-pack-inputs.json.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 0.1.4 (Lane A5): the Linux facts come from the package's own inputs/linux-pack-inputs.json (Lane G's file with Lane G4's wording) and hold Lane G3's eleven programs after Text Editor, Terminal and Writer.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane GD1): the committed facts end with the Godot 4 editor (linux/godot/godot), from a third inputs file, inputs/godot-pack-inputs.json.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane LX1): the committed facts also hold Lane LX1's nineteen everyday Linux programs through linux-atspi, after Lane G3's, from the package's own inputs/linux-pack-inputs.json.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane BL1): the committed facts end with Blender on Linux through the blender bridge, from the package's own inputs/blender-pack-inputs.json, distilled after the Godot inputs.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane VS1): the committed facts also hold VS Code (com.microsoft.vscode) on the vscode bridge, last, from the package's own inputs/vscode-pack-inputs.json, with a third provenance entry.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const pack = require(path.join(root, 'lib/instruction-pack.js'));
const script = path.join(root, 'scripts/program-facts.cjs');
const loadRoutes = () => import(pathToFileURL(path.join(root, 'routes/program-instructions.mjs')).href);

const CONTRACT = Object.freeze({
  tools: ['computer.app', 'computer.open'],
  actions: ['apps', 'snapshot', 'scroll', 'press', 'type', 'select', 'invoke', 'undo', 'restore'],
  min_bytes: 200,
  max_bytes: 8192
});
/** Blue's claimed row for Writer, as the kernel's claim answer shapes it (the id and claim are fixture values). */
const LINUX_WRITER = Object.freeze({
  id: 'ab'.repeat(32), claim: 'cd'.repeat(16), platform: 'linux', program: 'libreoffice-writer', version: '24.2.7',
  version_kind: 'package', bridge: 'libreoffice', attempt: 1, expires_at: 1794560555986, contract: CONTRACT
});
const NOTEPAD = Object.freeze({ ...LINUX_WRITER, platform: 'windows', program: 'notepad', version: '11.2410.21.0', bridge: 'windows-uia' });
/** What writer 0.1.0 published on blue for LibreOffice Writer 24.2.7 (see the change log). */
const BLUE_PACK = fs.readFileSync(path.join(root, 'tests/fixtures/writer-24.2.7-linux-libreoffice-0.1.0.md'), 'utf8');
/** The same text with one added section that holds every word the facts require. */
const HOLDING = `${BLUE_PACK}\n\n## Measured on this bridge\n\nWith the add-on connected a snapshot's \`"part"\` is whole; without it,`
  + ' visible. Every edit\'s answer carries verified.';

const writerFacts = () => pack.factsFor(LINUX_WRITER);

test('the text writer 0.1.0 published on blue for Writer 24.2.7 passes 0.1.0\'s rules and is refused for the words it lacks', () => {
  assert.equal(pack.checkBody(BLUE_PACK, CONTRACT, 'libreoffice', 'libreoffice-writer'), null, 'every rule 0.1.0 had passes');
  const problem = pack.acceptanceProblem(BLUE_PACK, LINUX_WRITER);
  assert.equal(problem, 'the text lacks what the measured facts require: add-on, "part", whole, verified');
  assert.equal(pack.checkBody(HOLDING, CONTRACT, 'libreoffice', 'libreoffice-writer'), null);
  assert.equal(pack.acceptanceProblem(HOLDING, LINUX_WRITER), null, 'with every required word and none forbidden it passes');
  assert.equal(pack.acceptanceProblem(`${HOLDING}\nSave with Ctrl+S.`, LINUX_WRITER), 'the text holds what the measured facts forbid: Ctrl+');
  assert.equal(pack.acceptanceProblem(BLUE_PACK, NOTEPAD), null, 'a program with no measured facts is held to no words');
  assert.equal(pack.acceptanceProblem(BLUE_PACK, { ...LINUX_WRITER, bridge: 'linux-atspi' }), null, 'facts belong to one bridge');
});

test('a Writer request on Linux through the libreoffice bridge carries every measured fact and the words a text must and must not hold', () => {
  const facts = writerFacts();
  assert.ok(facts, 'lib/program-facts.json has linux, libreoffice-writer, libreoffice');
  const text = pack.requestText(LINUX_WRITER);
  assert.match(text, /- Measured for this program on this bridge\. Say each of these, in your own words where you like, and contradict none:\n {2}- /);
  for (const fact of facts.facts) assert.ok(text.includes(`  - ${fact}\n`), fact.slice(0, 80));
  for (const never of facts.never) assert.ok(text.includes(`  - ${never}\n`), never);
  for (const word of facts.contains) assert.ok(text.includes(`  - ${word}\n`), word);
  for (const word of facts.absent) assert.ok(text.includes(`  - ${word}\n`) || text.endsWith(`  - ${word}`), word);
  assert.ok(facts.contains.includes('verified') && facts.contains.includes('"part"'), 'Lane G\'s acceptance words are carried as written');
  assert.ok(Buffer.byteLength(text, 'utf8') < pack.MAX_REQUEST_BYTES, String(Buffer.byteLength(text, 'utf8')));
  assert.ok(!text.includes(LINUX_WRITER.id) && !text.includes(LINUX_WRITER.claim));
  const plain = pack.requestText(NOTEPAD);
  assert.doesNotMatch(plain, /Measured for this program|must hold each of these/, 'a program with no measured facts is asked as before');
  const largest = [...pack.PROGRAM_FACTS.programs].map((entry) => pack.requestText({ ...LINUX_WRITER, ...entry }));
  for (const each of largest) assert.ok(Buffer.byteLength(each, 'utf8') < pack.MAX_REQUEST_BYTES, each.split('\n')[1]);
});

test('a Writer answer that passes the rules but lacks a required word is reported invalid-output and never published', async () => {
  const { runInstructionTick } = await loadRoutes();
  const refused = standInKernel({
    'application_profiles.claim': { requests: [LINUX_WRITER] }, bot: { response: BLUE_PACK }, 'application_profiles.fail': { status: 'pending' }
  });
  assert.deepEqual(await runInstructionTick(refused.ctx), { status: 200, body: { claimed: 1, published: 0, failed: 1 } });
  assert.deepEqual(refused.calls.map((call) => call.step), ['application_profiles.claim', 'bot', 'bot', 'application_profiles.fail']);
  assert.deepEqual(refused.calls[3].input, {
    id: LINUX_WRITER.id, claim: LINUX_WRITER.claim, reason: 'invalid-output',
    detail: 'the text lacks what the measured facts require: add-on, "part", whole, verified'
  });
  assert.equal(refused.calls[1].input.request.text, pack.requestText(LINUX_WRITER), 'the bot was given the facts');
  const published = standInKernel({
    'application_profiles.claim': { requests: [LINUX_WRITER] }, bot: { response: HOLDING }, 'application_profiles.publish': { status: 'published' }
  });
  assert.deepEqual(await runInstructionTick(published.ctx), { status: 200, body: { claimed: 1, published: 1, failed: 0 } });
  assert.deepEqual(published.calls[2].input, { id: LINUX_WRITER.id, claim: LINUX_WRITER.claim, body: HOLDING });
});

test('the distiller keeps each program\'s facts, never-lines and acceptance words, with the inputs\' provenance, and refuses a malformed file', () => {
  const { distil, render } = require(script);
  const out = distil(fixtureInputs());
  assert.deepEqual(Object.keys(out), ['about', 'provenance', 'programs']);
  assert.deepEqual(out.provenance, { written_at: '2026-01-01T00:00:00Z', kernel_commit: 'abcdef01' });
  assert.deepEqual(out.programs, [{
    platform: 'linux', program: 'fixture-editor', bridge: 'fixture-bridge',
    facts: ['It reads the `part` shown.', 'Each answer carries verified.'], never: ['That it saves by itself.'],
    contains: ['"part"', 'verified'], absent: ['Ctrl+']
  }]);
  assert.equal(render(out), render(distil(fixtureInputs())), 'the same inputs give the same bytes');
  const broken = [
    (inputs) => { delete inputs.programs; }, (inputs) => { inputs.kernel_commit = 'not a commit'; },
    (inputs) => { inputs.programs[0].program = 'Not A Key'; }, (inputs) => { inputs.programs[0].must_say = [{ fact: '' }]; },
    (inputs) => { inputs.programs[0].must_not_say = [42]; }, (inputs) => { inputs.programs[0].acceptance.contains = 'verified'; },
    (inputs) => { inputs.programs[0].acceptance.absent.push('line\nbreak'); },
    (inputs) => { inputs.programs.push(inputs.programs[0]); }
  ];
  for (const breakIt of broken) {
    const inputs = fixtureInputs();
    breakIt(inputs);
    assert.throws(() => distil(inputs), { code: 'pack_inputs_invalid' });
  }
});

test('the distiller writes from an inputs path, and --check passes on what it wrote and fails on changed or missing inputs', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'program-facts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const inputs = path.join(dir, 'pack-inputs.json');
  const out = path.join(dir, 'program-facts.json');
  fs.writeFileSync(inputs, JSON.stringify(fixtureInputs()));
  assert.equal(run(['--out', out, inputs]).code, 0);
  const { distilAll, render } = require(script);
  const written = () => render(distilAll([{ from: 'pack-inputs.json', inputs: fixtureInputs() }]));
  assert.equal(fs.readFileSync(out, 'utf8'), written());
  assert.equal(run(['--check', '--out', out, inputs]).code, 0);
  const redated = { ...fixtureInputs(), written_at: '2026-01-02T00:00:00Z', kernel_commit: 'ffffffff' };
  fs.writeFileSync(inputs, JSON.stringify(redated));
  assert.equal(run(['--check', '--out', out, inputs]).code, 0, 'a new date and commit with the same facts is current');
  const changed = fixtureInputs();
  changed.programs[0].acceptance.contains.push('add-on');
  fs.writeFileSync(inputs, JSON.stringify(changed));
  const stale = run(['--check', '--out', out, inputs]);
  assert.equal(stale.code, 1);
  assert.match(stale.said, /program-facts\.json is stale; run: node scripts\/program-facts\.cjs /);
  assert.equal(fs.readFileSync(out, 'utf8'), written(), '--check writes nothing');
  assert.equal(run(['--check', '--out', out, path.join(dir, 'absent.json')]).code, 1);
});

test('the committed program facts are in the distiller\'s own form and are what the request and the check read', () => {
  const held = JSON.parse(fs.readFileSync(path.join(root, 'lib/program-facts.json'), 'utf8'));
  const { render } = require(script);
  assert.equal(fs.readFileSync(path.join(root, 'lib/program-facts.json'), 'utf8'), render(held), 'not edited by hand');
  assert.deepEqual(held.programs.map((entry) => `${entry.platform}/${entry.program}/${entry.bridge}`), [
    'linux/org.gnome.texteditor/linux-atspi', 'linux/org.gnome.terminal/linux-atspi', 'linux/libreoffice-writer/libreoffice',
    ...['google-chrome', 'firefox', 'thunderbird', 'com.microsoft.vscode', 'org.xfce.mousepad', 'org.gnome.evince', 'org.gnome.nautilus',
      'thunar', 'org.kde.okular', 'org.gnome.eog', 'xfce4-terminal'].map((program) => `linux/${program}/linux-atspi`),
    ...['gedit', 'org.gnome.calculator', 'org.gnome.todo', 'simple-scan', 'org.gnome.calendar', 'org.gnome.characters', 'transmission-gtk',
      'org.gnome.fileroller', 'com.github.jeromerobert.pdfarranger', 'org.gnome.systemmonitor', 'org.gnome.font-viewer', 'org.gnome.totem',
      'org.gnome.rhythmbox3', 'org.gnome.shotwell', 'org.xfce.ristretto', 'org.remmina.remmina', 'org.qbittorrent.qbittorrent',
      'com.anthropic.claude', 'chatgpt'].map((program) => `linux/${program}/linux-atspi`),
    'windows/microsoft.windowsnotepad/windows-uia', 'windows/microsoft.office.winword.exe.15/windows-uia',
    'windows/microsoft.office.excel.exe.15/windows-uia', 'windows/microsoft.office.powerpnt.exe.15/windows-uia',
    'linux/godot/godot', 'linux/blender/blender', 'linux/com.microsoft.vscode/vscode'
  ]);
  assert.deepEqual(held.provenance.map((entry) => entry.inputs), ['inputs/linux-pack-inputs.json', 'inputs/windows-pack-inputs.json', 'inputs/godot-pack-inputs.json', 'inputs/blender-pack-inputs.json', 'inputs/vscode-pack-inputs.json']);
  assert.equal(pack.PROGRAM_FACTS, require(path.join(root, 'lib/program-facts.json')));
});

/** A pack-inputs file of Lane G's shape with one fixture program; not a description of any real program. */
function fixtureInputs() {
  return {
    about: 'fixture', written_at: '2026-01-01T00:00:00Z', kernel_commit: 'abcdef01', facts: {}, contract: {},
    programs: [{
      program: 'fixture-editor', name: 'Fixture Editor', platform: 'linux', bridge: 'fixture-bridge', version_on_the_spark: {},
      shipped_guide: null,
      must_say: [{ fact: 'It reads the `part` shown.', evidence: 'fixture' }, { fact: 'Each answer carries verified.', evidence: 'fixture' }],
      must_not_say: ['That it saves by itself.'],
      acceptance: { contains: ['"part"', 'verified'], absent: ['Ctrl+'] }
    }]
  };
}

function run(args) {
  try {
    return { code: 0, said: execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { code: error.status, said: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

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
