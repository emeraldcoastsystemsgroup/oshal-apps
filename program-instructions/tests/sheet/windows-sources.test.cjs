/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.3 (Lane A4, T76 on Windows): the package's own Windows inputs are what their sources say. Word's and Excel's verbs in inputs/windows-bridge-facts.json are exactly WORD_VERBS and EXCEL_VERBS in Orbit's code, and each verb's source line holds it; every Windows PC receipt and every Orbit or orbit-uia file a fact of inputs/windows-pack-inputs.json names as its evidence exists. The kernel checkout is OSHAL_KERNEL_ROOT, else ~/Documents/projects/oshal-kernel; the receipts are OSHAL_WINDOWS_PROOFS, else ~/Documents/projects/oshal-collab/windows/proofs. It fails, never skips, when either is absent. In tests/sheet/, out of the store job's glob, because it reads files outside this repository; the Test Lab runs it by name.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.4 (Lane A5): PowerPoint's verbs in inputs/windows-bridge-facts.json are exactly POWERPOINT_VERBS in Orbit's code (desktop/oshal-node/src/main/windows-powerpoint.ts, the Windows board's W10), each at the line it names, as Word's and Excel's are; the receipt every PowerPoint fact names is checked like the others.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 0.1.5 (Lane A6): Excel's verbs are EXCEL_VERBS at kernel 06f12f46, create-pivot-table and add-chart included (the Windows board's W9). Their receipt is the Windows PC's W9 RESULT entry on the board (windows/FROM-WINDOWS.md, 2026-11-13T19:27:07Z), not a file under proofs/, so a fact naming `windows/FROM-WINDOWS.md entry of <time>` must find that entry, written by @windows-pc, in the board beside the receipts; and an Orbit test script (.cjs) a fact names must exist like its .ts and .rs files.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const PROOFS = process.env.OSHAL_WINDOWS_PROOFS || path.join(os.homedir(), 'Documents', 'projects', 'oshal-collab', 'windows', 'proofs');
const ORBIT = path.join(KERNEL, 'desktop', 'oshal-node');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

/** The quoted ids of `export const <name> = [...]` in an Orbit source file. */
function declaredIn(file, name) {
  const text = fs.readFileSync(path.join(ORBIT, file), 'utf8');
  const list = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(text);
  assert.ok(list, `${name} is in desktop/oshal-node/${file}`);
  return [...list[1].matchAll(/'([a-z][a-z0-9-]*)'/g)].map((match) => match[1]);
}

test('Word\'s, Excel\'s and PowerPoint\'s verbs in the Windows sheet are the ones Orbit\'s code declares, each at the line it names', () => {
  assert.ok(fs.existsSync(ORBIT), `the kernel checkout is at ${KERNEL} (set OSHAL_KERNEL_ROOT)`);
  const declared = readJson('inputs/windows-bridge-facts.json').bridges['windows-uia'].declared;
  const ids = (kind) => declared[kind].map((verb) => verb.id);
  assert.deepEqual(ids('text document (Microsoft Word)'), declaredIn('src/main/windows-word.ts', 'WORD_VERBS'));
  assert.deepEqual(ids('spreadsheet (Microsoft Excel)'), declaredIn('src/main/windows-excel.ts', 'EXCEL_VERBS'));
  assert.deepEqual(ids('presentation (Microsoft PowerPoint)'), declaredIn('src/main/windows-powerpoint.ts', 'POWERPOINT_VERBS'));
  assert.deepEqual(declared['any other window'], []);
  for (const verb of Object.values(declared).flat()) {
    const [file, line] = verb.source.replace(/^desktop\/oshal-node\//, '').split(':');
    const text = fs.readFileSync(path.join(ORBIT, file), 'utf8').split('\n')[Number(line) - 1] || '';
    assert.ok(text.includes(`'${verb.id}'`), `${verb.source} holds ${verb.id}`);
  }
});

test('every receipt and source file a Windows fact names as its evidence exists', () => {
  assert.ok(fs.existsSync(PROOFS), `the Windows PC's receipts are at ${PROOFS} (set OSHAL_WINDOWS_PROOFS)`);
  const board = path.join(PROOFS, '..', 'FROM-WINDOWS.md');
  const entries = fs.existsSync(board) ? fs.readFileSync(board, 'utf8') : '';
  for (const program of readJson('inputs/windows-pack-inputs.json').programs) {
    for (const { evidence } of program.must_say) {
      for (const [, name] of evidence.matchAll(/windows\/proofs\/([a-z0-9-]+\.md)/g)) {
        assert.ok(fs.existsSync(path.join(PROOFS, name)), `${program.program}: windows/proofs/${name}`);
      }
      for (const [, at] of evidence.matchAll(/windows\/FROM-WINDOWS\.md entry of (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)/g)) {
        assert.ok(entries.includes(`\n### ${at} — @windows-pc — `), `${program.program}: the Windows PC's entry of ${at} in ${board}`);
      }
      for (const [, file] of evidence.matchAll(/desktop\/oshal-node\/([A-Za-z0-9/._-]+\.(?:ts|rs|cjs))/g)) {
        assert.ok(fs.existsSync(path.join(ORBIT, file)), `${program.program}: desktop/oshal-node/${file}`);
      }
    }
  }
});
