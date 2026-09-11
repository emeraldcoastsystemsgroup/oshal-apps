/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-03 00:50:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — protocol double
 *                     |                             | for the adapter TRANSPORT specs (BUILD_CONTRACT §6:
 *                     |                             | "a test double for the TRANSPORT is legitimate; it
 *                     |                             | never fakes engine numbers in shipped code"). Speaks
 *                     |                             | the frozen §5b JSON-lines protocol over stdio; the
 *                     |                             | request's args drive the behavior under test
 *                     |                             | (__sleepMs, __garbage, __fail). Runs under node so
 *                     |                             | the transport specs need no Python at all — the
 *                     |                             | adapter's pythonPath/workerPath are injectable.
 * 2026-09-11 01:40:00 | maintainer@emeraldcoastsystemsgroup.com | __export: write the named files under
 *                     |                             | the workDir it was HANDED (as cmd_export does) and
 *                     |                             | echo that workDir, so the container-transport spec
 *                     |                             | can prove the bridge pins it and ships the bytes.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, terminal: false });

/** One §5b response line on stdout — stdout is the protocol channel. */
function respond(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

rl.on('line', (line) => {
  const text = String(line).trim();
  if (!text) return;
  let req;
  try {
    req = JSON.parse(text);
  } catch (e) {
    process.stderr.write(`fake-worker: unparseable request line: ${e.message}\n`);
    return;
  }
  const { id, cmd } = req;
  const args = req.args || {};
  const reply = () => {
    if (args.__garbage) process.stdout.write('this is not JSON — the adapter must drop it\n');
    if (args.__fail) {
      respond({ id, ok: false, error: { code: args.__fail.code, message: args.__fail.message } });
      return;
    }
    if (cmd === 'export' && args.__export) {
      const exportId = 'exp-0123456789ab';
      const dir = path.join(String(args.workDir), 'exports', exportId);
      fs.mkdirSync(dir, { recursive: true });
      const files = args.__export.files || {};
      for (const name of Object.keys(files)) fs.writeFileSync(path.join(dir, path.basename(name)), files[name]);
      respond({ id, ok: true, result: { exportId, files: args.__export.names || Object.keys(files), workDirSeen: args.workDir } });
      return;
    }
    if (cmd === 'capabilities') {
      respond({
        id,
        ok: true,
        result: {
          engineVersion: 'fake-0.0.0',
          python: 'node-protocol-double',
          capabilities: {
            polar: true, evaluate: true, screen: true, mission: false, export: true, hybrid: false,
            modules: { electrical: true, prop: true, mission: false, materials: false, electrochem: false },
          },
          bounds: { area_m2: [0.3, 3.0], aspect_ratio: [6, 25] },
        },
      });
      return;
    }
    respond({ id, ok: true, result: { echo: { cmd, args } } });
  };
  const sleepMs = Number(args.__sleepMs || 0);
  if (sleepMs > 0) setTimeout(reply, sleepMs);
  else reply();
});

rl.on('close', () => process.exit(0));
