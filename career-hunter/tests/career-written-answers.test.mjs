/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.79.0, Answers to review: run the drafting engine's contract (tests/career-written-answers-contract.py: a made-up person's real owner SQLite store, fixture inference through enrich.complete) and prove the shipped launcher maps answers-draft to jobhunter.written_answers.run with the request in CH_ANSWER_DRAFTS, so the route's background run reaches that module and no other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), packageRoot = path.resolve(here, '..');

test('Career drafts a written answer from the record and the job’s letter, never a check or a fact no record holds, and keeps only what the record supports', () => {
  const out = execFileSync(process.env.JOBHUNTER_PYTHON || 'python3', [path.join(here, 'career-written-answers-contract.py')], { encoding: 'utf8', timeout: 60000 });
  const result = JSON.parse(out.trim().split('\n').at(-1));
  assert.deepEqual(result.failed, []);
  assert.equal(result.checks, 27);
});

test('the launcher maps answers-draft to jobhunter.written_answers.run with the request in CH_ANSWER_DRAFTS', () => {
  const binPath = path.join(packageRoot, 'bin/oshal-jobhunter.js'), cli = new Module(binPath);
  cli.filename = binPath; cli.paths = Module._nodeModulePaths(path.dirname(binPath));
  cli._compile(fs.readFileSync(binPath, 'utf8') + '\nmodule.exports.mapping=engineRuns;', binPath);
  const runs = cli.exports.mapping('answers-draft', []);
  assert.equal(runs.length, 1);
  assert.equal(runs[0][0], '-c');
  assert.match(runs[0][1], /from jobhunter\.written_answers import run\n/);
  assert.match(runs[0][1], /run\(os\.environ\.get\("CH_ANSWER_DRAFTS",""\)\)/);
});
