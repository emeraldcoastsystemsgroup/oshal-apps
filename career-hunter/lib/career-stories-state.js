/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read the story review's state (GET /stories) straight from the caller's career_db.json with the same projection as engine/jobhunter/stories.py state(), so the read starts no Python child. The native kernel's package sandbox exports no .py source, so `python3 -m jobhunter stories list` could not import the engine there and the Stories screen answered 502; the read never needed the engine's lease, credential brokerage or model rail.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** The same ceiling engine/jobhunter/profile.py enforces on every profile read and write. */
const PROFILE_MAX_BYTES = 4 * 1024 * 1024;

/** A profile that cannot be read as one bounded JSON object; the route answers 502 for it. */
function unreadable(message) {
  return Object.assign(new Error(message), { code: 'career_profile_unreadable' });
}

/** A JSON object that is not an array: the only shape stories.py treats as a role or a story. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Python's `str(value or "")` for the profile's string fields. */
function text(value) {
  return value ? String(value) : '';
}

/**
 * @description Reads the caller's profile the way profile.load() does: a missing file is an empty
 * profile; anything else must be one regular file within the store budget holding a JSON object.
 * @param {string} userDir - The caller's isolated store directory.
 * @returns {Promise<object>} The parsed profile, or {} when none exists yet.
 */
async function readProfile(userDir) {
  const file = path.join(userDir, 'career_db.json');
  let stat;
  try { stat = await fs.promises.lstat(file); } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
  if (!stat.isFile()) throw unreadable('career profile must be a regular file');
  if (stat.size > PROFILE_MAX_BYTES) throw unreadable('career profile exceeds the storage limit');
  const raw = JSON.parse(await fs.promises.readFile(file, 'utf8'));
  if (!isRecord(raw)) throw unreadable('career profile must be a JSON object');
  return raw;
}

/** stories.py _label: "<title> at <org>", either half alone, or "role N". */
function roleLabel(role, index) {
  const title = text(role.title).trim();
  const org = text(role.org).trim();
  if (title && org) return `${title} at ${org}`;
  return title || org || `role ${index + 1}`;
}

/** stories.py _bullets_of: the role's non-blank resume bullets, the only ones a story may cite. */
function roleBullets(role) {
  return Array.isArray(role.deliverables) ? role.deliverables.map(String).filter((b) => b.trim()) : [];
}

/**
 * @description stories.py question_for: the question about one role, built from its own lead
 * bullet so it is specific without spending a token.
 * @param {{label?: string, bullets?: string[]}} roleState - One entry of the state's roles.
 * @returns {string} The question text.
 */
function questionFor(roleState) {
  const label = roleState.label || 'this role';
  const bullets = roleState.bullets || [];
  if (bullets.length) {
    const lead = bullets[0].trim().replace(/\.+$/, '');
    return `At ${label} your resume says: "${lead}". Walk me through one time you actually did `
      + 'that — what the situation was, what you personally decided or built, and how it '
      + 'turned out. Numbers if you have them.';
  }
  return `Tell me about one thing you did at ${label} that you would want an interviewer to hear — `
    + 'the situation, what you personally did, and the result.';
}

/**
 * @description stories.py state(): every role with its stories, how many still need one, and the
 * next question. Pure and read-only.
 * @param {object} raw - A parsed career profile.
 * @returns {{roles: object[], total: number, withStory: number, complete: boolean, next: object|null}}
 */
function storiesState(raw) {
  const roles = Array.isArray(raw.roles) ? raw.roles.filter(isRecord) : [];
  const out = roles.map((role, index) => {
    const stories = Array.isArray(role.stories) ? role.stories.filter(isRecord) : [];
    return {
      index,
      label: roleLabel(role, index),
      title: text(role.title),
      org: text(role.org),
      bullets: roleBullets(role),
      stories,
      hasStory: stories.length > 0,
    };
  });
  const pending = out.filter((role) => !role.hasStory);
  return {
    roles: out,
    total: out.length,
    withStory: out.length - pending.length,
    complete: out.length > 0 && pending.length === 0,
    next: pending.length
      ? { index: pending[0].index, label: pending[0].label, question: questionFor(pending[0]) }
      : null,
  };
}

/**
 * @description The review state for one caller's store directory.
 * @param {string} userDir - The caller's isolated store directory.
 * @returns {Promise<object>} The same document `jobhunter stories list` prints.
 */
async function readStoriesState(userDir) {
  return storiesState(await readProfile(userDir));
}

module.exports = { readStoriesState, storiesState, questionFor, PROFILE_MAX_BYTES };
