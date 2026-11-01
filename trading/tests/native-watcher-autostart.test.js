/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger renewed every approval and the job that acts on them stayed suspended behind a separate button: "the watcher has to be on an auto start when activated". Runs the shipped page code against each schedule state.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tools/ui/native-paper.js'), 'utf8');

/** The shipped keeper over a schedule row and the person's approvals. */
function page({ row, watches = [], policies = [], refuse = false }) {
  const posts = [];
  const context = {
    console, document: { hidden: false, addEventListener() {} }, setInterval() {},
    api: async (p) => (p === '/portfolio/management' ? { watches } : p === '/portfolio/backstops' ? { policies } : {}),
    fetch: async (url, opts) => {
      if (opts && opts.method === 'POST') { posts.push({ url, body: JSON.parse(opts.body) }); return refuse ? { ok: false, status: 403, json: async () => ({ detail: 'refused' }) } : { ok: true, json: async () => ({ status: 'activated' }) }; }
      return { ok: true, json: async () => ({ schedules: row ? [row] : [] }) };
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.__start=watcherScheduleStart;globalThis.__keep=watcherScheduleKeep;`, context);
  return { posts, start: context.__start, keep: context.__keep };
}
const watcher = (status, extra = {}) => ({ id: 'job-1', app: 'intelligent-trades', name: 'portfolio-watcher', status, activation: status === 'active' ? { class: 'Person' } : null, reason: null, ...extra });
const live = [{ authority: { active: true } }], exits = [{ nativeStatus: { effectiveStatus: 'active' } }];

test('activating an approval starts the watcher job, whatever state it was in', async () => {
  for (const status of ['not-activated', 'suspended']) {
    const p = page({ row: watcher(status) });
    assert.equal(await p.start(), 'activated', status);
    assert.equal(p.posts[0].url, '/api/v1/agent/schedules/job-1/activate');
    assert.equal(p.posts[0].body.class, 'person', "in the person's own session");
    assert.equal(p.posts[0].body.configuration.timeoutMs, 120000, 'the same limits as every Strategies control');
  }
  const running = page({ row: watcher('active') });
  assert.equal(await running.start(), 'active');
  assert.equal(running.posts.length, 0, 'a running job is left alone');
  assert.equal(await page({ row: watcher('suspended'), refuse: true }).start(), 'refused', 'the approval already succeeded, so a refusal never throws');
});

test('the page restarts a job the kernel suspended while an approval is active, and only then', async () => {
  for (const approvals of [{ watches: live }, { policies: exits }]) {
    const p = page({ row: watcher('suspended'), ...approvals });
    assert.equal(await p.keep(), 'activated', JSON.stringify(approvals));
    assert.equal(p.posts.length, 1);
  }
  const none = page({ row: watcher('suspended'), watches: [{ authority: { active: false } }], policies: [{ nativeStatus: { effectiveStatus: 'source-changed' } }] });
  assert.equal(await none.keep(), 'idle');
  assert.equal(none.posts.length, 0, 'with nothing approved the job has nothing to do');
});

test('a job the person turned off stays off, and a refused restart is not hammered', async () => {
  for (const row of [watcher('not-activated'), watcher('suspended', { reason: 'owner_paused' }), watcher('active')]) {
    const p = page({ row, watches: live, policies: exits });
    assert.equal(await p.keep(), 'idle', JSON.stringify(row));
    assert.equal(p.posts.length, 0);
  }
  const refused = page({ row: watcher('suspended'), watches: live, refuse: true });
  assert.equal(await refused.keep(), 'refused');
  assert.equal(await refused.keep(), 'refused');
  assert.equal(refused.posts.length, 1, 'tried once until the page is opened again');
});

test('every path that activates an approval starts the watcher right after it', () => {
  const shell = fs.readFileSync(path.join(root, 'tools/trading.html'), 'utf8');
  assert.match(shell, /ui\/native-paper\.js/, 'the real page loads the code that starts it');
  for (const file of ['native-account-management.js', 'native-management.js', 'native-protection-controls.js']) assert.match(shell, new RegExp('ui/' + file.replace('.', '\\.')), file);
  for (const [file, activates] of [['native-account-management.js', "api('/portfolio/live/activate'"], ['native-management.js', "api('/portfolio/live/activate'"], ['native-protection-controls.js', "api('/portfolio/backstops/activate'"]]) {
    const text = fs.readFileSync(path.join(root, 'tools/ui', file), 'utf8'), at = text.indexOf(activates);
    assert.ok(at > 0, file);
    assert.match(text.slice(at, at + 400), /\n\s*if\(typeof watcherScheduleStart==='function'\)await watcherScheduleStart\(\);/, file + ' starts the watcher after activating');
  }
});
