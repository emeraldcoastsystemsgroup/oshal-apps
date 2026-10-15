/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: Run headless Godot showed "No active Godot process. | Possible solutions: ..." as
 *   the run's output with 0 error lines (1 of 3 runs): op_godot_run discarded get_debug_output's isError. The real
 *   engine/scene_ops.py op_godot_run is run under python3 with a godot-mcp session double: a get_debug_output that answers
 *   isError is an engine_error naming the reason, and a readable one is still returned as output.
 *
 * Plain `node --test` (python3 on the path, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ENGINE = path.resolve(__dirname, '..', 'engine');

/** Run op_godot_run with a session whose get_debug_output answers `debug`; returns {ok, ...} or {code, message}. */
function run(debug) {
  const script = `
import json, os, sys, tempfile
sys.path.insert(0, ${JSON.stringify(ENGINE)})
import scene_ops
root = tempfile.mkdtemp()
calls = []
class Session:
    def initialize(self, timeout): pass
    def call_tool(self, name, args, timeout):
        calls.append(name)
        if name == "get_debug_output":
            return json.loads(${JSON.stringify(JSON.stringify(debug))})
        return {"content": [{"type": "text", "text": "ok"}]}
    def close(self): pass
class Job:
    def __init__(self, cfg):
        self.project = os.path.join(root, "project"); os.makedirs(self.project, exist_ok=True)
        open(os.path.join(self.project, "project.godot"), "w").close()
    def mcp(self, server): return Session()
    def cleanup(self): pass
scene_ops.Job = Job
scene_ops._godot_import = lambda job: None
scene_ops.time.sleep = lambda s: None
try:
    out = scene_ops.op_godot_run(None, {"seconds": 1, "files": []})
    print(json.dumps({"ok": True, "out": out, "calls": calls}))
except scene_ops.OpError as e:
    print(json.dumps({"code": e.code, "message": str(e), "calls": calls}))
`;
  return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
}

test('a debug read godot-mcp answers as an error is an engine error, never a clean run (sweep 12)', () => {
  const r = run({ isError: true, content: [{ type: 'text', text: 'No active Godot process.\nPossible solutions:\n- Use run_project to start a Godot project first' }] });
  assert.equal(r.code, 'engine_error', JSON.stringify(r));
  assert.match(r.message, /^Godot was not running when the run's output was read, so it may have exited or crashed: No active Godot process\.$/);
  assert.deepEqual(r.calls, ['run_project', 'get_debug_output', 'stop_project'], 'the project is still stopped');
});

test('a readable debug output is still the run\'s output and errors', () => {
  const r = run({ content: [{ type: 'text', text: JSON.stringify({ output: ['Godot Engine v4'], errors: ['E 0:00 boom'] }) }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.out.output, r.out.errors, r.out.seconds], [['Godot Engine v4'], ['E 0:00 boom'], 1]);
});
