/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.3 (Lane A4, T76 on Windows): the kernel now keeps a row for the Windows 11 Notepad (microsoft.windowsnotepad), Word (microsoft.office.winword.exe.15) and Excel (microsoft.office.excel.exe.15), each reached through the windows-uia bridge. Before 0.1.3 the windows-uia bridge had no entry, so a Word text naming Word's own format-text was refused and the request told the bot that no declared verbs were known; and none of the three had measured facts. These cases prove that Word's and Excel's declared verbs are the ones Orbit's Windows bridge declares for them and no others, that Notepad names none, that each request carries its program's facts and stays small enough to be asked about once more, that the committed files hold exactly what the package's own Windows inputs give, and that each fact names the Windows PC's proof it comes from. The tick runs against the same stand-in for the kernel's rails as the package suite. Program versions are recorded fixture values; no computer was read.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.4 (Lane A5): the kernel now keeps a row for PowerPoint (microsoft.office.powerpnt.exe.15) through the same bridge, and Orbit's Windows bridge edits it live through its own object model (the Windows board's W10, kernel d43b5a8d). Before 0.1.4 its request listed no verbs (no kind named powerpnt.exe, and the sheet's catch-all kind has none), a text naming add-slide was refused, and it had no measured facts. These cases prove that PowerPoint names exactly the six slide verbs Orbit declares for it and no alias, file verb or other program's verb; that no other Windows program names a slide verb; that its request lists them and carries its measured facts with room to be asked once more; that the committed files hold its facts; and that a PowerPoint text holding the measured words is published while one lacking them is reported.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.5 (Lane A6): Orbit's Windows bridge declares create-pivot-table and add-chart for Excel since the Windows board's W9 (kernel 06f12f46, in Orbit 0.7.23), and 0.1.4's Excel facts said there were none and forbade both words. These cases prove that Excel names exactly its nine spreadsheet verbs, the two new ones included, with no alias and no other Windows program naming either; that Excel's facts require both words, forbid neither and no longer say pivot tables and charts are not Excel verbs, while the file verbs stay refused; and that a text 0.1.4's facts held Excel to is now reported for lacking the two words while one naming them is published. The Excel row is the build the Windows PC reads (oshal-collab windows/STATE.md, W7: 16.0.20527.20196).
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane GD1): both distillers' default sources end with the package's own Godot inputs (inputs/godot-bridge-facts.json, inputs/godot-pack-inputs.json).
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane BL1): both distillers take the Windows files second, then Godot's, then Blender's (tests/blender-program.test.cjs holds the whole order).
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 0.1.6 (Lane VS1): the default sources of both distillers end with the package's own VS Code files (inputs/vscode-bridge-facts.json, inputs/vscode-pack-inputs.json).
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
/** A claimed row as the kernel's claim answer shapes it; the id, claim and versions are fixture values. */
const claimed = (program, version, kind) => Object.freeze({
  id: 'ab'.repeat(32), claim: 'cd'.repeat(16), platform: 'windows', program, version, version_kind: kind,
  bridge: 'windows-uia', attempt: 1, expires_at: 1794560555986, contract: CONTRACT
});
const NOTEPAD = claimed('microsoft.windowsnotepad', '11.2410.21.0', 'package');
const WORD = claimed('microsoft.office.winword.exe.15', '16.0.18227.20162', 'file');
const EXCEL = claimed('microsoft.office.excel.exe.15', '16.0.18227.20162', 'file');
/** PowerPoint's row, at the build the W10 receipt reads on the Windows PC (oshal-collab windows/proofs/w10-powerpoint-2026-11-13.md). */
const POWERPOINT = claimed('microsoft.office.powerpnt.exe.15', '16.0.20527.20196', 'file');
/** The verbs Orbit's Windows bridge declares (desktop/oshal-node/src/main/windows-word.ts WORD_VERBS, windows-excel.ts EXCEL_VERBS). */
const WORD_VERBS = ['insert-paragraph', 'add-section', 'replace-text', 'delete-paragraph', 'format-text', 'find-replace'];
const EXCEL_VERBS = ['read-range', 'set-cells', 'format-cells', 'find-replace', 'sort-range', 'filter-range', 'manage-sheet', 'create-pivot-table', 'add-chart'];
/** Excel at the build the Windows PC reads (oshal-collab windows/STATE.md, W7: 16.0.20527.20196). */
const EXCEL_PC = claimed('microsoft.office.excel.exe.15', '16.0.20527.20196', 'file');
/** PowerPoint's (desktop/oshal-node/src/main/windows-powerpoint.ts POWERPOINT_VERBS). */
const POWERPOINT_VERBS = ['add-slide', 'set-slide-text', 'replace-text', 'format-text', 'delete-slide', 'move-slide'];

const declared = (id) => `# Fixture text for a test (not documentation)\n\n${'Plain words. '.repeat(20)}\nRun {"action": "invoke", "declared": "${id}"} next.`;

test('Word and Excel name only the verbs Orbit\'s Windows bridge declares for each, and Notepad names none', () => {
  for (const id of WORD_VERBS) assert.equal(pack.checkBody(declared(id), CONTRACT, 'windows-uia', WORD.program), null, `Word ${id}`);
  for (const id of EXCEL_VERBS) assert.equal(pack.checkBody(declared(id), CONTRACT, 'windows-uia', EXCEL.program), null, `Excel ${id}`);
  const refused = [
    [WORD, 'save-document'], [WORD, 'open-document'], [WORD, 'set-cells'],
    [EXCEL, 'save-document'], [EXCEL, 'insert-paragraph'], [NOTEPAD, 'insert-paragraph'], [NOTEPAD, 'save-document']
  ];
  for (const [row, id] of refused) {
    assert.equal(pack.checkBody(declared(id), CONTRACT, 'windows-uia', row.program),
      `the text names the declared verb "${id}", and the windows-uia bridge does not list it for this program`, `${row.program} ${id}`);
  }
  assert.deepEqual(pack.verbsFor('windows-uia', WORD.program).ids, WORD_VERBS);
  assert.deepEqual(pack.verbsFor('windows-uia', EXCEL.program).ids, EXCEL_VERBS);
  assert.deepEqual(pack.verbsFor('windows-uia', NOTEPAD.program).ids, []);
  assert.deepEqual(pack.verbsFor('windows-uia', 'notepad').ids, [], 'the classic notepad.exe declares none either');
});

test('each Windows request lists its verbs and carries its measured facts, with room to be asked once more', () => {
  const word = pack.requestText(WORD);
  assert.ok(word.includes('- Declared verbs the windows-uia bridge has for this program, by document kind:\n'
    + `  - text document (Microsoft Word): ${WORD_VERBS.join(', ')}\n`), word);
  const excel = pack.requestText(EXCEL);
  assert.ok(excel.includes(`  - spreadsheet (Microsoft Excel): ${EXCEL_VERBS.join(', ')}\n`), excel);
  const notepad = pack.requestText(NOTEPAD);
  assert.ok(notepad.includes('- No declared verbs are known for this program on the windows-uia bridge: describe only the '
    + 'actions above, and never write "declared".'), notepad);
  for (const [row, text] of [[NOTEPAD, notepad], [WORD, word], [EXCEL, excel]]) {
    const facts = pack.factsFor(row);
    assert.ok(facts, `lib/program-facts.json has windows, ${row.program}, windows-uia`);
    for (const line of [...facts.facts, ...facts.never, ...facts.contains]) assert.ok(text.includes(`  - ${line}\n`), line.slice(0, 80));
    for (const word of facts.absent) assert.ok(text.includes(`  - ${word}\n`), word);
    assert.ok(pack.retryText(text, 'x'.repeat(pack.MAX_DETAIL_CHARS)), `${row.program}: a second request still fits under 8 KiB`);
  }
});

test('the committed files hold exactly what the package\'s own Windows inputs give, and each fact names its proof', () => {
  const { distil: distilFacts } = require(path.join(root, 'scripts/program-facts.cjs'));
  const { distil: distilVerbs } = require(path.join(root, 'scripts/bridge-verbs.cjs'));
  const inputs = readJson('inputs/windows-pack-inputs.json');
  const windows = pack.PROGRAM_FACTS.programs.filter((entry) => entry.platform === 'windows');
  assert.deepEqual(windows, distilFacts(inputs).programs);
  assert.deepEqual(windows.map((entry) => `${entry.program}/${entry.bridge}`),
    [NOTEPAD, WORD, EXCEL, POWERPOINT].map((row) => `${row.program}/windows-uia`));
  assert.deepEqual(pack.BRIDGE_VERBS.bridges['windows-uia'], distilVerbs(readJson('inputs/windows-bridge-facts.json')).bridges['windows-uia']);
  for (const program of inputs.programs) {
    for (const { fact, evidence } of program.must_say) {
      assert.match(evidence, /windows\/proofs\/[a-z0-9-]+\.md|desktop\/oshal-node\/[A-Za-z0-9/._-]+/, `${program.program}: ${fact.slice(0, 60)}`);
    }
    assert.ok(program.must_say.some(({ evidence }) => /windows\/proofs\/[a-z0-9-]+\.md/.test(evidence)), `${program.program} cites a proof`);
  }
});

test('a Word text naming Word\'s verbs and holding the measured words is published; one lacking them is reported', async () => {
  const { runInstructionTick } = await loadRoutes();
  const facts = pack.factsFor(WORD);
  const holding = [
    '# Word 16.0.18227.20162 on Windows (fixture text for a test, not documentation)', '',
    'Read first with {"action": "snapshot"}. Edit with {"action": "invoke", "declared": "format-text"} or',
    '{"action": "invoke", "declared": "insert-paragraph"}; replace-text keeps the paragraph\'s format. Every answer carries verified.',
    'Take an edit back with {"action": "undo"}. A type can append or insert; it never replaces a whole document that has text.'
  ].join('\n');
  assert.equal(pack.checkBody(holding, CONTRACT, 'windows-uia', WORD.program), null);
  assert.equal(pack.acceptanceProblem(holding, WORD), null, `holds ${facts.contains.join(', ')}`);
  const published = standInKernel({
    'application_profiles.claim': { requests: [WORD] }, bot: { response: holding }, 'application_profiles.publish': { status: 'published' }
  });
  assert.deepEqual(await runInstructionTick(published.ctx), { status: 200, body: { claimed: 1, published: 1, failed: 0 } });
  assert.deepEqual(published.calls[2].input, { id: WORD.id, claim: WORD.claim, body: holding });
  const lacking = holding.replace('Every answer carries verified.', 'Every answer says what changed.');
  const refused = standInKernel({
    'application_profiles.claim': { requests: [WORD] }, bot: { response: lacking }, 'application_profiles.fail': { status: 'pending' }
  });
  assert.deepEqual(await runInstructionTick(refused.ctx), { status: 200, body: { claimed: 1, published: 0, failed: 1 } });
  assert.equal(refused.calls.at(-1).input.detail, 'the text lacks what the measured facts require: verified');
});

test('PowerPoint names only the six slide verbs Orbit\'s Windows bridge declares for it, and no other Windows program names one', () => {
  for (const id of POWERPOINT_VERBS) assert.equal(pack.checkBody(declared(id), CONTRACT, 'windows-uia', POWERPOINT.program), null, `PowerPoint ${id}`);
  assert.deepEqual(pack.verbsFor('windows-uia', POWERPOINT.program).ids, POWERPOINT_VERBS);
  const refused = [
    [POWERPOINT, 'new-slide'], [POWERPOINT, 'insert-slide'], [POWERPOINT, 'save-document'], [POWERPOINT, 'insert-paragraph'],
    [POWERPOINT, 'set-cells'], [WORD, 'add-slide'], [EXCEL, 'move-slide'], [NOTEPAD, 'set-slide-text']
  ];
  for (const [row, id] of refused) {
    assert.equal(pack.checkBody(declared(id), CONTRACT, 'windows-uia', row.program),
      `the text names the declared verb "${id}", and the windows-uia bridge does not list it for this program`, `${row.program} ${id}`);
  }
});

test('PowerPoint\'s request lists its slide verbs and carries its measured facts, with room to be asked once more', () => {
  const text = pack.requestText(POWERPOINT);
  assert.ok(text.includes('- Declared verbs the windows-uia bridge has for this program, by document kind:\n'
    + `  - presentation (Microsoft PowerPoint): ${POWERPOINT_VERBS.join(', ')}\n`), text);
  const facts = pack.factsFor(POWERPOINT);
  assert.ok(facts, 'lib/program-facts.json has windows, microsoft.office.powerpnt.exe.15, windows-uia');
  for (const line of [...facts.facts, ...facts.never, ...facts.contains]) assert.ok(text.includes(`  - ${line}\n`), line.slice(0, 80));
  for (const word of facts.absent) assert.ok(text.includes(`  - ${word}\n`), word);
  assert.ok(pack.retryText(text, 'x'.repeat(pack.MAX_DETAIL_CHARS)), 'a second request still fits under 8 KiB');
});

test('a PowerPoint text naming its slide verbs and holding the measured words is published; one lacking them is reported', async () => {
  const { runInstructionTick } = await loadRoutes();
  const holding = [
    '# PowerPoint 16.0.20527.20196 on Windows (fixture text for a test, not documentation)', '',
    'Add a slide with {"action": "invoke", "declared": "add-slide"}, change one with {"action": "invoke", "declared": "set-slide-text"},',
    'and use replace-text and format-text for words on the slides. Every answer carries verified.',
    'Take an edit back with {"action": "undo"}.'
  ].join('\n');
  assert.equal(pack.checkBody(holding, CONTRACT, 'windows-uia', POWERPOINT.program), null);
  assert.equal(pack.acceptanceProblem(holding, POWERPOINT), null, `holds ${pack.factsFor(POWERPOINT).contains.join(', ')}`);
  const published = standInKernel({
    'application_profiles.claim': { requests: [POWERPOINT] }, bot: { response: holding }, 'application_profiles.publish': { status: 'published' }
  });
  assert.deepEqual(await runInstructionTick(published.ctx), { status: 200, body: { claimed: 1, published: 1, failed: 0 } });
  assert.deepEqual(published.calls[2].input, { id: POWERPOINT.id, claim: POWERPOINT.claim, body: holding });
  const lacking = holding.replace('Every answer carries verified.', 'Every answer says what changed.');
  const refused = standInKernel({
    'application_profiles.claim': { requests: [POWERPOINT] }, bot: { response: lacking }, 'application_profiles.fail': { status: 'pending' }
  });
  assert.deepEqual(await runInstructionTick(refused.ctx), { status: 200, body: { claimed: 1, published: 0, failed: 1 } });
  assert.equal(refused.calls.at(-1).input.detail, 'the text lacks what the measured facts require: verified');
});

test('Excel names create-pivot-table and add-chart, with no alias, and no other Windows program names either', () => {
  for (const id of ['create-pivot-table', 'add-chart']) assert.equal(pack.checkBody(declared(id), CONTRACT, 'windows-uia', EXCEL_PC.program), null, `Excel ${id}`);
  const refused = [
    [EXCEL_PC, 'insert-chart'], [EXCEL_PC, 'create-chart'], [EXCEL_PC, 'pivot-table'], [EXCEL_PC, 'open-document'],
    [WORD, 'create-pivot-table'], [WORD, 'add-chart'], [POWERPOINT, 'create-pivot-table'], [POWERPOINT, 'add-chart'], [NOTEPAD, 'add-chart']
  ];
  for (const [row, id] of refused) {
    assert.equal(pack.checkBody(declared(id), CONTRACT, 'windows-uia', row.program),
      `the text names the declared verb "${id}", and the windows-uia bridge does not list it for this program`, `${row.program} ${id}`);
  }
  const facts = pack.factsFor(EXCEL_PC);
  for (const id of ['create-pivot-table', 'add-chart']) {
    assert.ok(facts.contains.includes(id), `Excel's text must name ${id}`);
    assert.ok(!facts.absent.includes(id), `Excel's text may name ${id}`);
  }
  assert.ok(!facts.facts.some((fact) => /pivot tables, charts/i.test(fact)), 'no Excel fact says pivot tables and charts are not Excel verbs');
  assert.ok(!facts.never.some((line) => /pivot table or a chart/i.test(line)), 'no never-line forbids saying Jarvis makes one');
  assert.ok(facts.facts.some((fact) => fact.includes('"I can\'t do <verb> in Excel yet."') && /opening or saving workbooks/i.test(fact)), 'the file verbs are still not Excel\'s');
  assert.ok(facts.never.some((line) => /opens, saves or exports a workbook/.test(line)), 'and saying Jarvis opens or saves one is still forbidden');
});

test('a text 0.1.4\'s facts held Excel to is now reported for lacking the two verbs, and one naming them is published', async () => {
  const { runInstructionTick } = await loadRoutes();
  const head = '# Excel 16.0.20527.20196 on Windows (fixture text for a test, not documentation)\n\n';
  const common = 'Read cells with {"action": "invoke", "declared": "read-range"} and write them with set-cells. Every answer carries verified.\n'
    + 'Take an edit back with {"action": "undo"}.\n';
  const old = `${head}${common}Pivot tables and charts are not Excel verbs yet, and the person opens and saves workbooks in Excel.\n`;
  assert.equal(pack.checkBody(old, CONTRACT, 'windows-uia', EXCEL_PC.program), null, 'every rule but the measured words passes');
  assert.equal(pack.acceptanceProblem(old, EXCEL_PC), 'the text lacks what the measured facts require: create-pivot-table, add-chart');
  const reported = standInKernel({
    'application_profiles.claim': { requests: [EXCEL_PC] }, bot: { response: old }, 'application_profiles.fail': { status: 'pending' }
  });
  assert.deepEqual(await runInstructionTick(reported.ctx), { status: 200, body: { claimed: 1, published: 0, failed: 1 } });
  assert.equal(reported.calls.at(-1).input.detail, 'the text lacks what the measured facts require: create-pivot-table, add-chart');
  const holding = `${head}${common}Make a pivot table with {"action": "invoke", "declared": "create-pivot-table"} and a chart with\n`
    + '{"action": "invoke", "declared": "add-chart"}. The person opens and saves workbooks in Excel.';
  assert.equal(pack.checkBody(holding, CONTRACT, 'windows-uia', EXCEL_PC.program), null);
  assert.equal(pack.acceptanceProblem(holding, EXCEL_PC), null, `holds ${pack.factsFor(EXCEL_PC).contains.join(', ')}`);
  const published = standInKernel({
    'application_profiles.claim': { requests: [EXCEL_PC] }, bot: { response: holding }, 'application_profiles.publish': { status: 'published' }
  });
  assert.deepEqual(await runInstructionTick(published.ctx), { status: 200, body: { claimed: 1, published: 1, failed: 0 } });
  assert.deepEqual(published.calls[2].input, { id: EXCEL_PC.id, claim: EXCEL_PC.claim, body: holding });
});

test('both distillers merge their sources in order with each source\'s provenance, and refuse a bridge or program named twice', () => {
  const verbs = require(path.join(root, 'scripts/bridge-verbs.cjs'));
  const facts = require(path.join(root, 'scripts/program-facts.cjs'));
  const sheet = (word, at) => ({ generated_at: at, kernel_commit: 'abcdef01', generator: 'fixture/make.cjs',
    bridges: { [word]: { actions: { snapshot: {} }, declared: { 'any other window': [] } } } });
  const merged = verbs.distilAll([{ from: 'one.json', sheet: sheet('fixture-a', 'one') }, { from: 'two.json', sheet: sheet('fixture-b', 'two') }]);
  assert.deepEqual(Object.keys(merged.bridges), ['fixture-a', 'fixture-b']);
  assert.deepEqual(merged.provenance.map((entry) => [entry.sheet, entry.generated_at]), [['one.json', 'one'], ['two.json', 'two']]);
  assert.throws(() => verbs.distilAll([{ from: 'one.json', sheet: sheet('fixture-a', 'one') }, { from: 'two.json', sheet: sheet('fixture-a', 'two') }]),
    { code: 'bridge_sheet_invalid', message: 'bridge fixture-a is named by two sheets' });
  assert.throws(() => verbs.distilAll([]), { code: 'bridge_sheet_invalid' });
  assert.deepEqual(verbs.DEFAULT_SHEETS, [verbs.DEFAULT_SHEET, verbs.WINDOWS_SHEET, verbs.GODOT_SHEET, verbs.BLENDER_SHEET, verbs.VSCODE_SHEET]);
  const inputs = (program) => ({ written_at: 'w', kernel_commit: 'abcdef01', programs: [{ platform: 'windows', program, bridge: 'windows-uia',
    must_say: [{ fact: 'A fact.', evidence: 'fixture' }], must_not_say: [], acceptance: { contains: ['fact'], absent: [] } }] });
  const both = facts.distilAll([{ from: 'a.json', inputs: inputs('fixture-a') }, { from: 'b.json', inputs: inputs('fixture-b') }]);
  assert.deepEqual(both.programs.map((entry) => entry.program), ['fixture-a', 'fixture-b']);
  assert.deepEqual(both.provenance, [{ inputs: 'a.json', written_at: 'w', kernel_commit: 'abcdef01' }, { inputs: 'b.json', written_at: 'w', kernel_commit: 'abcdef01' }]);
  assert.throws(() => facts.distilAll([{ from: 'a.json', inputs: inputs('fixture-a') }, { from: 'b.json', inputs: inputs('fixture-a') }]),
    { code: 'pack_inputs_invalid' });
  assert.deepEqual(facts.DEFAULT_SOURCES, [facts.DEFAULT_INPUTS, facts.WINDOWS_INPUTS, facts.GODOT_INPUTS, facts.BLENDER_INPUTS, facts.VSCODE_INPUTS]);
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
