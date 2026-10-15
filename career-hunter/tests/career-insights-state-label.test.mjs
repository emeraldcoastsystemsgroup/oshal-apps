/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Live 2026-10-11 the Insights BY STATE chart labelled postings with no state with a twice-encoded em dash. The analytics BY STATE statement in both the source and the served build carries no double-encoded text, and run against the engine's own schema it labels a blank state "(remote/—)".
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Insights moved to career-insights.ts (covering-index reads, the label computed in code): the mojibake check covers its source and build too, and BY STATE is read from the served readAnalytics over the engine's schema plus its Insights index.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';

const { readAnalytics } = createRequire(import.meta.url)('../routes/career-insights.js');
const files = ['../src-routes/career-board-routes.ts', '../routes/career-board-routes.js',
  '../src-routes/career-insights.ts', '../routes/career-insights.js'];
const MOJIBAKE = /â€/;

/** The engine's own schema text, as the engine creates the stores. */
function engineSchema(name) {
  const engine = fs.readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
  if (name === 'INSIGHTS_INDEX_SQL') {
    const block = engine.match(/\nINSIGHTS_INDEX_SQL = \(([\s\S]*?)\n\)/)[1];
    return [...block.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
  }
  return engine.match(new RegExp(`\\n${name} = """([\\s\\S]*?)"""`))[1];
}

test('the board routes carry no double-encoded text', () => {
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), MOJIBAKE, file);
  }
});

test('a posting with no state is labelled (remote/—) in BY STATE', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  db.exec(engineSchema('CORPUS_SCHEMA'));
  db.exec(engineSchema('USER_SCHEMA'));
  db.exec(engineSchema('INSIGHTS_INDEX_SQL'));
  db.exec(`INSERT INTO corpus.companies (id, name) VALUES (1, 'Fixture Co');
    INSERT INTO corpus.postings_corpus (id, company_id, ats_job_id, active, target_role, state) VALUES
      (1, 1, 'a', 1, 1, ''), (2, 1, 'b', 1, 1, NULL), (3, 1, 'c', 1, 1, 'TX');`);
  assert.deepEqual(readAnalytics(db).states, [{ state: '(remote/—)', n: 2 }, { state: 'TX', n: 1 }]);
  db.close();
});
