'use strict';
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Guard for the joke-pump show library: every show must be complete, and every cast must be unambiguous to the renderer. Plain node --test, no dependencies, so store-ci actually runs it (the package's vitest spec next door runs nowhere).
 */
/**
 * @description The show library's guard.
 *
 * A show whose cast is ambiguous does not fail loudly — it renders a video in which the wrong thing
 * talks. The renderer addresses a speaker by ONE NOUN taken from their description, so:
 *
 *   "bean drummer holding two glow sticks"  ->  the DRUMSTICKS speak       (observed live)
 *   "Toast-slice host with crumb freckles"  ->  the FRECKLES speak
 *   four characters described as "... hero" ->  all four are "the hero"
 *
 * The authority on that rule is `resolveSpeakerPointers` in the kernel
 * (src/app/series-pipeline.ts) and the runtime gate is `validateWrittenSeries`, which rejects an
 * ambiguous cast before any image is drawn. This test is the cheap upstream copy: it checks the
 * property that makes the kernel's widening loop a no-op — the last word of each description's first
 * clause is already unique — so it cannot drift away from the real algorithm's base case.
 *
 * Descriptions are required to be ONE LINE for exactly this reason: a folded YAML block would hide
 * the first clause from a line scanner, and this file deliberately has no YAML dependency.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SHOWS_DIR = path.resolve(__dirname, '../shows');

/** Every show file in the library. */
function showFiles() {
  return fs.readdirSync(SHOWS_DIR).filter((f) => f.endsWith('.yaml')).sort();
}

/**
 * @description The cast, read off the file's lines. Deliberately literal: the shape is fixed
 * (`- name:` then `description:`) and a scanner cannot silently accept a folded block.
 * @param {string} text the file contents
 * @returns {Array<{name: string, description: string}>} the cast
 */
function readCast(text) {
  const lines = text.split(/\r?\n/);
  const cast = [];
  let inCast = false;
  let pending = null;
  for (const line of lines) {
    if (/^cast:\s*$/.test(line)) { inCast = true; continue; }
    if (!inCast) continue;
    // A new top-level key ends the cast block.
    if (/^[a-zA-Z]/.test(line)) break;
    const name = line.match(/^\s*-\s*name:\s*(.+?)\s*$/);
    if (name) { pending = { name: name[1], description: '' }; cast.push(pending); continue; }
    const desc = line.match(/^\s*description:\s*(.+?)\s*$/);
    if (desc && pending) pending.description = desc[1];
  }
  return cast;
}

/**
 * @description The noun the renderer would address this character by: the last word of the first
 * clause, with props after `with` / `holding` / `carrying` stripped. Mirrors the base case of the
 * kernel's resolveSpeakerPointers.
 * @param {string} description the cast description
 * @returns {string} the pointer noun
 */
function pointerNoun(description) {
  return String(description)
    .split(/[,;—]/)[0]
    .replace(/^an?\s+|^the\s+/i, '')
    .split(/\s+(?:with|who|that|which|holding|carrying)\s+/i)[0]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-1)[0]
    .toLowerCase();
}

/** One scalar value off a top-level key. */
function scalar(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  return m ? m[1] : null;
}

test('the library has shows, and one of them is the superheroes', () => {
  const files = showFiles();
  assert.ok(files.length >= 6, `expected the six shows, found ${files.length}`);
  assert.ok(files.some((f) => f.includes('stupid-superheroes')), 'Stupid Superheroes is missing');
});

test('every show is complete enough to pump', () => {
  for (const f of showFiles()) {
    const text = fs.readFileSync(path.join(SHOWS_DIR, f), 'utf8');
    const where = `${f}:`;
    assert.ok(scalar(text, 'slug'), `${where} no slug`);
    assert.ok(scalar(text, 'title'), `${where} no title`);
    assert.match(text, /^premise:/m, `${where} no premise`);
    assert.match(text, /^styleLock:/m, `${where} no styleLock — the look must be pinned or the cast drifts`);

    const scenes = Number(scalar(text, 'scenesPerEpisode'));
    assert.ok(scenes >= 2 && scenes <= 10, `${where} scenesPerEpisode ${scenes} is outside 2-10`);

    // Joke seeds are what stop ten episodes being the same joke.
    const seeds = (text.match(/^\s{2}-\s+\S/gm) || []).length;
    assert.ok(seeds >= 5, `${where} needs at least 5 joke seeds, found ~${seeds}`);
  }
});

test('every cast is unambiguous to the renderer', () => {
  for (const f of showFiles()) {
    const text = fs.readFileSync(path.join(SHOWS_DIR, f), 'utf8');
    const cast = readCast(text);
    assert.ok(cast.length >= 2, `${f}: expected a cast, found ${cast.length}`);

    const seen = new Map();
    for (const c of cast) {
      assert.ok(c.description, `${f}: ${c.name} has no single-line description`);
      const noun = pointerNoun(c.description);
      assert.ok(noun && noun.length > 1, `${f}: ${c.name} resolves to a useless pointer "${noun}"`);
      assert.ok(
        !seen.has(noun),
        `${f}: ${c.name} and ${seen.get(noun)} both resolve to "the ${noun}" — `
        + "make each description's first clause end in that character's own noun",
      );
      seen.set(noun, c.name);
    }
  }
});

test('a prop after "with" is never mistaken for the speaker', () => {
  // The live failure this rule exists for: "bean drummer holding two glow sticks" made the
  // drumsticks talk. Any description whose pointer is a plural prop is the same mistake.
  const propish = /^(sticks|glasses|boots|buttons|freckles|wings|holes|eyes|hands|fins|sneakers|arms|points|opinions)$/;
  for (const f of showFiles()) {
    const text = fs.readFileSync(path.join(SHOWS_DIR, f), 'utf8');
    for (const c of readCast(text)) {
      const noun = pointerNoun(c.description);
      assert.ok(!propish.test(noun), `${f}: ${c.name} resolves to the prop "the ${noun}" — move props after "with"`);
    }
  }
});
