/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com | Guard against duplicate index names across this package's migrations. 095 named an index idx_career_apps_status, which 031 already owned on a different table; CREATE INDEX IF NOT EXISTS then silently did nothing.
 */

// Postgres index names are unique per SCHEMA, not per table. Two migrations in this
// package can therefore collide, and because every CREATE here uses IF NOT EXISTS the
// collision is SILENT: the second index is simply never created, no error is raised, and
// the migration is recorded as applied. That is exactly what happened on 2026-07-30 --
// 095's idx_career_apps_status never existed on career_user_applications because 031
// already owned the name on career_hunter_applications, while its two sibling indexes
// created normally. Nothing failed; the index was just missing.
//
// Run: node --test tests/migration-index-names.test.mjs
// (node:test -- this repo has no vitest runner.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/** Every `CREATE [UNIQUE] INDEX [IF NOT EXISTS] <name>` in the package, with its file. */
function declaredIndexes() {
  const found = []
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    const re = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi
    let m
    while ((m = re.exec(sql)) !== null) found.push({ name: m[1].toLowerCase(), file })
  }
  return found
}

test('no index name is declared twice across the package migrations', () => {
  const byName = new Map()
  for (const { name, file } of declaredIndexes()) {
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(file)
  }

  const dupes = [...byName.entries()].filter(([, files]) => files.length > 1)
  const detail = dupes
    .map(([name, files]) => `  ${name} declared in: ${files.join(', ')}`)
    .join('\n')

  assert.equal(
    dupes.length,
    0,
    `Duplicate index name(s) across migrations -- the later CREATE INDEX IF NOT EXISTS will\n` +
      `silently do nothing and the index will be MISSING with no error:\n${detail}\n` +
      `Fix: prefix index names per table (e.g. idx_career_user_apps_status).`,
  )
})

test('the specific 031/095 collision stays fixed', () => {
  const names = declaredIndexes()
  const status = names.filter((n) => n.name === 'idx_career_apps_status')
  assert.equal(
    status.length,
    1,
    'idx_career_apps_status must be declared exactly once (031, on career_hunter_applications)',
  )
  assert.match(status[0].file, /^031-/, 'idx_career_apps_status belongs to migration 031')

  // 095's per-user application indexes must all carry the disambiguating prefix.
  for (const suffix of ['status', 'applied', 'posting']) {
    assert.ok(
      names.some((n) => n.name === `idx_career_user_apps_${suffix}`),
      `095 must declare idx_career_user_apps_${suffix} (prefixed to avoid the 031 collision)`,
    )
  }
})

test('sanity: the regex actually finds the indexes it is guarding', () => {
  // A guard that silently matches nothing always passes. Pin a floor so a broken regex
  // or a moved migrations dir fails loudly instead of reporting "no duplicates".
  const found = declaredIndexes()
  assert.ok(
    found.length >= 10,
    `expected to parse at least 10 CREATE INDEX statements, found ${found.length} -- ` +
      `the parser or the migrations path is probably broken`,
  )
})
