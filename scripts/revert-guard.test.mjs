/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the revert guard in .githooks/commit-msg: a commit or merge that puts a file back to an older committed version of itself is refused with the path and the commit that version came from, while edits, new files, deletions, renames and deliberate reverts ([allow-revert], OSHAL_ALLOW_REVERT=1, git revert) pass. Every case is a real git command in a throwaway repository under the system temporary directory whose core.hooksPath is this checkout's own .githooks, so the hook under test is the committed file, run by git itself. The suite fails, never skips, when the hook is missing or not executable, because git ignores such a hook without a word.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Regression cases for the review fixes: a mode-only change (chmod +x, or a merged side that changed only the mode) passes while a content revert of the same file is still refused, and a version more than 300 history entries back is refused by default (marketplace.json has over 1,000 entries, and its copy from a checkout 148 commits behind sat beyond a 300-entry window), with an explicit OSHAL_REVERT_GUARD_COMMITS bound naming the path it cut.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const HOOKS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.githooks');
const HOOK = join(HOOKS, 'commit-msg');
const REFUSED = 'COMMIT REFUSED by the revert guard';
const MERGE_REFUSED = 'MERGE REFUSED by the revert guard';

/**
 * @description An environment that reaches no outer repository, user configuration or editor. Every
 *   GIT_* variable is dropped: a suite started from inside a git hook (the pre-push gate) inherits
 *   GIT_DIR and friends, which would point these commands at the outer checkout.
 * @param {string} home The throwaway home directory.
 * @returns {NodeJS.ProcessEnv} The child environment.
 */
function cleanEnvironment(home) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  for (const key of ['OSHAL_ALLOW_REVERT', 'OSHAL_REVERT_GUARD_MAX_PATHS', 'OSHAL_REVERT_GUARD_COMMITS']) delete env[key];
  mkdirSync(join(home, 'tmp'), { recursive: true });
  writeFileSync(join(home, 'gitconfig'), '');
  return {
    ...env,
    HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), TMPDIR: join(home, 'tmp'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'gitconfig'),
    GIT_AUTHOR_NAME: 'Hook Test', GIT_AUTHOR_EMAIL: 'hook-test@example.invalid',
    GIT_COMMITTER_NAME: 'Hook Test', GIT_COMMITTER_EMAIL: 'hook-test@example.invalid',
    GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no', LC_ALL: 'C',
  };
}

/**
 * @description A throwaway repository whose hooks are this checkout's .githooks.
 * @param {import('node:test').TestContext} t The test, which removes the directory afterwards.
 * @returns {object} Helpers that run real git commands in it.
 */
function makeRepo(t) {
  const base = mkdtempSync(join(tmpdir(), 'oshal-revert-guard-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const path = join(base, 'repo');
  mkdirSync(path);
  const env = cleanEnvironment(join(base, 'home'));
  const git = (args, { extra = {}, check = true, input } = {}) => {
    const result = spawnSync('git', args, { cwd: path, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60_000, input });
    if (check && result.status !== 0) {
      throw new Error(`git ${args.join(' ')} exited ${result.status}:\n${result.stdout}${result.stderr}`);
    }
    return result;
  };
  const write = (name, text) => {
    mkdirSync(dirname(join(path, name)), { recursive: true });
    writeFileSync(join(path, name), text);
  };
  const rev = (name) => git(['rev-parse', '--verify', name]).stdout.trim();
  const short = (name) => git(['rev-parse', '--short', name]).stdout.trim();
  const show = (spec) => git(['show', spec]).stdout;
  const commitFile = (name, text, message) => {
    write(name, text);
    git(['add', '--', name]);
    git(['commit', '-q', '-m', message]);
    return rev('HEAD');
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'core.hooksPath', HOOKS]);
  return { base, path, git, write, rev, short, show, commitFile };
}

/**
 * @description A repository whose app.js went v1 -> v2, with an older copy of v1 ready to stage.
 * @param {import('node:test').TestContext} t The test.
 * @returns {object} The repository plus the two commit ids.
 */
function shippedRepo(t) {
  const repo = makeRepo(t);
  repo.write('other.txt', 'x\n');
  repo.git(['add', 'other.txt']);
  const first = repo.commitFile('app.js', 'export const v = 1;\n', 'add app');
  const second = repo.commitFile('app.js', 'export const v = 2;\n', 'ship the v2 feature');
  const stageOlderCopy = () => {
    repo.write('app.js', 'export const v = 1;\n');
    repo.git(['add', 'app.js']);
  };
  return { ...repo, first, second, stageOlderCopy };
}

test('the commit-msg hook exists and is executable', () => {
  assert.ok(existsSync(HOOK) && statSync(HOOK).isFile(), `${HOOK} is missing: the guard would not run at all`);
  assert.doesNotThrow(() => accessSync(HOOK, constants.X_OK), `${HOOK} is not executable: git would ignore it`);
  assert.equal(spawnSync('git', ['--version']).status, 0, 'git is required to prove the hook');
});

test('committing an older version of a file is refused', (t) => {
  const repo = shippedRepo(t);
  repo.stageOlderCopy();
  const result = repo.git(['commit', '-m', 'update app'], { check: false });
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, new RegExp(REFUSED));
  assert.ok(result.stderr.includes('  app.js\n'));
  assert.ok(result.stderr.includes(`the version committed in ${repo.short(repo.first)}`));
  assert.ok(result.stderr.includes(`replaced in ${repo.short(repo.second)}`));
  assert.ok(result.stderr.includes('git restore --source=HEAD --staged --worktree -- <path>'));
  assert.ok(result.stderr.includes('[allow-revert]') && result.stderr.includes('--no-verify'));
  assert.equal(repo.rev('HEAD'), repo.second, 'a refused commit must not move HEAD');
});

test('an older version from further back is found', (t) => {
  const repo = shippedRepo(t);
  repo.commitFile('app.js', 'export const v = 3;\n', 'v3');
  repo.commitFile('app.js', 'export const v = 4;\n', 'v4');
  repo.stageOlderCopy();
  const result = repo.git(['commit', '-m', 'update app'], { check: false });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(`the version committed in ${repo.short(repo.first)}`));
});

test('a normal edit passes silently', (t) => {
  const repo = shippedRepo(t);
  repo.write('app.js', 'export const v = 3;\n');
  repo.git(['add', 'app.js']);
  const result = repo.git(['commit', '-m', 'v3']);
  assert.ok(!result.stderr.includes('revert guard'), result.stderr);
  assert.equal(repo.show('HEAD:app.js'), 'export const v = 3;\n');
});

test('the [allow-revert] marker and OSHAL_ALLOW_REVERT=1 pass', (t) => {
  const repo = shippedRepo(t);
  repo.stageOlderCopy();
  repo.git(['commit', '-q', '-m', 'restore v1 on purpose [allow-revert]']);
  assert.equal(repo.show('HEAD:app.js'), 'export const v = 1;\n');
  repo.commitFile('app.js', 'export const v = 2;\n', 'v2 again [allow-revert]');
  repo.stageOlderCopy();
  const result = repo.git(['commit', '-m', 'restore v1'], { extra: { OSHAL_ALLOW_REVERT: '1' } });
  assert.ok(result.stderr.includes('not checked (OSHAL_ALLOW_REVERT=1)'));
  assert.equal(repo.show('HEAD:app.js'), 'export const v = 1;\n');
});

test('the marker on a comment line does not count', (t) => {
  const repo = shippedRepo(t);
  repo.stageOlderCopy();
  const message = join(repo.base, 'message.txt');
  writeFileSync(message, 'update app\n# [allow-revert]\n');
  const result = repo.git(['commit', '--cleanup=strip', '-F', message], { check: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(REFUSED));
});

test('a real git revert, its reapply, and git revert --no-commit then git commit pass', (t) => {
  const repo = shippedRepo(t);
  repo.git(['revert', '--no-edit', 'HEAD']);
  assert.ok(repo.git(['log', '-1', '--format=%s']).stdout.startsWith('Revert "'));
  assert.equal(repo.show('HEAD:app.js'), 'export const v = 1;\n');
  repo.git(['revert', '--no-edit', 'HEAD']);
  assert.equal(repo.show('HEAD:app.js'), 'export const v = 2;\n');
  // Here git commit itself runs commit-msg; REVERT_HEAD marks the revert under any message.
  repo.git(['revert', '--no-commit', repo.second]);
  repo.git(['commit', '-q', '-m', 'back out the v2 feature']);
  assert.equal(repo.show('HEAD:app.js'), 'export const v = 1;\n');
});

test('a "Revert ..." subject passes', (t) => {
  const repo = shippedRepo(t);
  repo.stageOlderCopy();
  repo.git(['commit', '-q', '-m', 'Revert "ship the v2 feature"']);
  assert.equal(repo.show('HEAD:app.js'), 'export const v = 1;\n');
});

test('a pathspec commit is judged on the paths it names', (t) => {
  const repo = shippedRepo(t);
  repo.stageOlderCopy();
  repo.write('other.txt', 'y\n');
  repo.git(['add', 'other.txt']);
  repo.git(['commit', '-q', '-m', 'other only', '--', 'other.txt']);
  assert.equal(repo.show('HEAD:app.js'), 'export const v = 2;\n');
  const result = repo.git(['commit', '-m', 'app too', '--', 'app.js'], { check: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(REFUSED));
});

test('a path with pathspec magic characters is checked literally', (t) => {
  const repo = makeRepo(t);
  const name = ':(glob)weird *[name].txt';
  let older = '';
  for (const [text, message] of [['one\n', 'add weird'], ['two\n', 'change weird']]) {
    repo.write(name, text);
    repo.git(['--literal-pathspecs', 'add', '--', name]);
    repo.git(['commit', '-q', '-m', message]);
    if (!older) older = repo.rev('HEAD');
  }
  repo.write(name, 'one\n');
  repo.git(['--literal-pathspecs', 'add', '--', name]);
  const result = repo.git(['commit', '-m', 'touch weird'], { check: false });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(`the version committed in ${repo.short(older)}`));
});

test('a mode-only change passes and a content revert of the same file is still refused', (t) => {
  const repo = shippedRepo(t);
  // The blob of a chmod is HEAD's own, which the history walk always finds: that is not a revert.
  chmodSync(join(repo.path, 'app.js'), 0o755);
  repo.git(['add', 'app.js']);
  const result = repo.git(['commit', '-m', 'make app.js executable'], { check: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(repo.git(['ls-tree', 'HEAD', 'app.js']).stdout.split(/\s+/)[0], '100755');
  repo.stageOlderCopy();
  const refused = repo.git(['commit', '-m', 'update app'], { check: false });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, new RegExp(REFUSED));
});

test('a version more than 300 history entries back is refused, and a set bound names what it cut', (t) => {
  // marketplace.json has over 1,000 history entries; a checkout 148 commits behind holds a copy more than
  // 300 entries back, which a 300-entry window let through without a word.
  const repo = makeRepo(t);
  let stream = '';
  for (let i = 0; i < 320; i += 1) {
    const text = `v${i}`;
    stream += `commit refs/heads/main\ncommitter t <t@x.invalid> ${1700000000 + i} +0000\ndata ${text.length}\n${text}\n`;
    stream += `M 100644 inline f.txt\ndata ${text.length + 1}\n${text}\n\n`;
  }
  repo.git(['fast-import', '--quiet'], { input: stream });
  repo.git(['reset', '-q', '--hard']);
  const oldest = repo.rev('HEAD~319');
  repo.write('f.txt', 'v0\n');
  repo.git(['add', 'f.txt']);
  const result = repo.git(['commit', '-m', 'update f'], { check: false });
  assert.notEqual(result.status, 0, result.stderr);
  assert.ok(result.stderr.includes(`the version committed in ${repo.short(oldest)}`), result.stderr);
  const bounded = repo.git(['commit', '-m', 'update f'], { extra: { OSHAL_REVERT_GUARD_COMMITS: '300' } });
  assert.ok(bounded.stderr.includes('versions older than the newest 300 history entries were NOT checked for 1 path(s)'), bounded.stderr);
  assert.ok(bounded.stderr.includes('  f.txt\n'), bounded.stderr);
});

test('the path bound is reported when it is reached', (t) => {
  const repo = shippedRepo(t);
  repo.commitFile('aaa.txt', 'first\n', 'add aaa');
  repo.write('aaa.txt', 'second\n');
  repo.git(['add', 'aaa.txt']);
  repo.stageOlderCopy();
  const result = repo.git(['commit', '-m', 'two files'], { extra: { OSHAL_REVERT_GUARD_MAX_PATHS: '1' } });
  assert.ok(result.stderr.includes('only the first 1 were checked and 1 were NOT'), result.stderr);
});

test('new files, deletions and renames pass; a re-added deleted file gets a note', (t) => {
  const repo = makeRepo(t);
  repo.commitFile('gone.txt', 'old content\n', 'add gone');
  repo.commitFile('moved.txt', 'moving\n', 'add moved');
  repo.commitFile('brand-new.txt', 'new\n', 'add a new file');
  repo.git(['rm', '-q', 'gone.txt']);
  repo.git(['commit', '-q', '-m', 'delete gone']);
  repo.git(['mv', 'moved.txt', 'renamed.txt']);
  repo.git(['commit', '-q', '-m', 'rename moved']);
  repo.git(['mv', 'renamed.txt', 'moved.txt']);
  repo.git(['commit', '-q', '-m', 'rename it back']);
  assert.equal(repo.show('HEAD:moved.txt'), 'moving\n');
  repo.write('gone.txt', 'old content\n');
  repo.git(['add', 'gone.txt']);
  const result = repo.git(['commit', '-m', 'bring gone back']);
  assert.ok(result.stderr.includes('note: new file gone.txt is identical to an earlier committed version'), result.stderr);
});

test('the first commit of a repository passes', (t) => {
  const repo = makeRepo(t);
  repo.commitFile('only.txt', 'one\n', 'initial');
  assert.equal(repo.show('HEAD:only.txt'), 'one\n');
});

test('a merge that brings back a stale copy is refused until it keeps the newer file', (t) => {
  const repo = shippedRepo(t);
  // The side branch carries an older copy committed before the guard existed (simulated with the
  // override); main never touched app.js since, so git merges the old copy in cleanly.
  repo.git(['switch', '-q', '-c', 'stale']);
  repo.write('app.js', 'export const v = 1;\n');
  repo.write('notes.txt', 'stale lane work\n');
  repo.git(['add', 'app.js', 'notes.txt']);
  repo.git(['commit', '-q', '-m', 'lane work'], { extra: { OSHAL_ALLOW_REVERT: '1' } });
  repo.git(['switch', '-q', 'main']);
  const tip = repo.commitFile('main.txt', 'main moves on\n', 'main work');
  const result = repo.git(['merge', '--no-ff', '-m', 'Merge branch stale', 'stale'], { check: false });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(MERGE_REFUSED));
  assert.ok(result.stderr.includes('  app.js\n'));
  assert.ok(result.stderr.includes(`the version committed in ${repo.short(repo.first)}`));
  assert.ok(result.stderr.includes('git merge --abort'));
  assert.equal(repo.rev('HEAD'), tip, 'a refused merge must not commit');
  assert.ok(existsSync(join(repo.path, '.git', 'MERGE_HEAD')));
  const retry = repo.git(['commit', '-m', 'Merge branch stale'], { check: false });
  assert.notEqual(retry.status, 0, 'finishing the merge without a decision must refuse too');
  repo.git(['checkout', 'HEAD', '--', 'app.js']);
  repo.git(['commit', '-q', '-m', 'Merge branch stale, keeping the newer app.js']);
  assert.equal(repo.show('HEAD:app.js'), 'export const v = 2;\n');
  assert.equal(repo.show('HEAD:notes.txt'), 'stale lane work\n');
  assert.equal(repo.git(['log', '-1', '--format=%P']).stdout.trim().split(/\s+/).length, 2);
});

test('a merge whose side changed only the mode passes', (t) => {
  // The kernel's PR #158 merge (29f50558) took ops/deploy-bare-metal.sh from 100755 to 100644 with the same blob.
  const repo = shippedRepo(t);
  repo.git(['switch', '-q', '-c', 'modes']);
  chmodSync(join(repo.path, 'app.js'), 0o755);
  repo.git(['add', 'app.js']);
  repo.git(['commit', '-q', '-m', 'app.js is executable']);
  repo.git(['switch', '-q', 'main']);
  repo.commitFile('main.txt', 'main moves on\n', 'main work');
  const result = repo.git(['merge', '--no-ff', '-m', 'Merge branch modes', 'modes'], { check: false });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(repo.git(['ls-tree', 'HEAD', 'app.js']).stdout.split(/\s+/)[0], '100755');
});

test('a deliberate stale merge passes with the marker; a merge of new work passes', (t) => {
  const repo = shippedRepo(t);
  repo.git(['switch', '-q', '-c', 'stale']);
  repo.write('app.js', 'export const v = 1;\n');
  repo.git(['add', 'app.js']);
  repo.git(['commit', '-q', '-m', 'lane work'], { extra: { OSHAL_ALLOW_REVERT: '1' } });
  repo.git(['switch', '-q', '-c', 'feature', 'main']);
  repo.commitFile('feature.txt', 'feature\n', 'feature file');
  repo.git(['switch', '-q', 'main']);
  repo.commitFile('app.js', 'export const v = 3;\n', 'v3 on main');
  const merged = repo.git(['merge', '--no-ff', '-m', 'Merge branch feature', 'feature']);
  assert.ok(!merged.stderr.includes('revert guard'), merged.stderr);
  repo.git(['merge', '--no-ff', '-q', '-X', 'theirs', '-m', 'Merge branch stale [allow-revert]', 'stale']);
  assert.equal(repo.show('HEAD:app.js'), 'export const v = 1;\n');
});
