#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.7 (Roger, 2026-11-17: "the bullets for oshal now should be oswarm and updated"). Apply an approved saved-portfolio draft (a JSON file in the shape of the main résumé's `oss_portfolio`: _note, label, entry{title, org, person_url, platform_url, product_url, span, bullets, tech, applications}, skills, scoring_blurb) to ONE person's Career through the same edit the Other experience form sends (POST /resume/master-edit, field portfolio), as that person's own session. Dry run by default: it signs in with the person's token, reads the portfolio with its revision, refuses unless the current organization is the one named with --expect-org, and prints which fields would change (counts only, no values). --apply saves (backed up and audited) and prints the Undo command; --undo puts the earlier version back. The token is read from its file and never printed; the session it opens is signed out at the end.
 *
 * Usage (a loopback kernel only):
 *   node career-hunter/scripts/portfolio-apply.mjs <origin> <token file> <draft.json> --expect-org "<current organization>"            (dry run)
 *   node career-hunter/scripts/portfolio-apply.mjs <origin> <token file> <draft.json> --expect-org "<current organization>" --apply
 *   node career-hunter/scripts/portfolio-apply.mjs <origin> <token file> --undo <revision after> <revision before>
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const TEXT_PLACES = { label: ['label'], note: ['_note'], title: ['entry', 'title'], org: ['entry', 'org'], span: ['entry', 'span'],
  person_url: ['entry', 'person_url'], platform_url: ['entry', 'platform_url'], product_url: ['entry', 'product_url'], scoring_blurb: ['scoring_blurb'] };
const LIST_PLACES = { bullets: ['entry', 'bullets'], tech: ['entry', 'tech'], applications: ['entry', 'applications'], skills: ['skills'] };
const TOP = new Set(['_note', 'label', 'entry', 'skills', 'scoring_blurb']);
const ENTRY = new Set(['title', 'org', 'person_url', 'platform_url', 'product_url', 'span', 'bullets', 'tech', 'applications']);

/**
 * @description The Edit form's fields from a draft in the stored shape. A key the form cannot write is refused, so a
 * draft never claims to have saved something it did not.
 * @param {object} draft The draft, shaped like `oss_portfolio`.
 * @returns {object} The form: nine texts and four lists.
 */
export function toForm(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('the draft must be one JSON object');
  const extra = [...Object.keys(draft).filter((key) => !TOP.has(key)), ...Object.keys(draft.entry || {}).filter((key) => !ENTRY.has(key)).map((key) => `entry.${key}`)];
  if (extra.length) throw new Error(`the draft holds fields the form cannot save: ${extra.join(', ')}`);
  const at = ([first, second]) => (second ? (draft[first] || {})[second] : draft[first]);
  const form = {};
  for (const [name, place] of Object.entries(TEXT_PLACES)) {
    const value = at(place);
    if (value !== undefined && typeof value !== 'string') throw new Error(`${place.join('.')} must be text`);
    form[name] = value || '';
  }
  for (const [name, place] of Object.entries(LIST_PLACES)) {
    const value = at(place);
    if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) throw new Error(`${place.join('.')} must be a list of text`);
    form[name] = value || [];
  }
  return form;
}

/** @description The fields that differ between two forms, with counts only (never values). */
export function changes(before, after) {
  return Object.keys(after).filter((name) => JSON.stringify(before[name]) !== JSON.stringify(after[name])).map((name) => (Array.isArray(after[name])
    ? { field: name, items: `${(before[name] || []).length} -> ${after[name].length}` } : { field: name, chars: `${String(before[name] || '').length} -> ${after[name].length}` }));
}

function loopback(base) {
  const origin = new URL(String(base || '')).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('this tool runs only against a loopback kernel, http://127.0.0.1:<port>');
  return origin;
}

async function http(origin, credential, method, route, body, accepted = [200]) {
  const response = await fetch(new URL(route, origin), { method, redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const parsed = await response.json().catch(() => null);
  if (!accepted.includes(response.status)) throw new Error(`${method} ${route.split('?')[0]}: ${response.status} ${(parsed && parsed.error) || ''}`.trim());
  return parsed;
}

async function main(argv) {
  const [base, tokenFile, ...rest] = argv, origin = loopback(base);
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const session = (await http(origin, '', 'POST', '/sessions', { token }, [200, 201])).session;
  try {
    const who = (await http(origin, session, 'GET', '/api/auth/user')) || {};
    if (who.subject === 'admin') throw new Error('this session is the administrator\'s own account, not the person\'s; use the person\'s token');
    if (rest[0] === '--undo') {
      const undone = await http(origin, session, 'POST', '/api/career-hunter/resume/master-undo', { revision: rest[1], restore: rest[2] });
      console.log(JSON.stringify({ step: 'undone', revision: undone.revision }));
      return 0;
    }
    const [draftFile, ...flags] = rest, expect = flags.includes('--expect-org') ? flags[flags.indexOf('--expect-org') + 1] : null;
    const form = toForm(JSON.parse(fs.readFileSync(draftFile, 'utf8')));
    const read = await http(origin, session, 'GET', '/api/career-hunter/resume/master-section?field=portfolio', undefined, [200, 400]);
    if (!read || read.ok === false) throw new Error('this Career cannot read the saved portfolio (career-hunter 1.68.7 is not installed here)');
    if (!read.present) throw new Error('this person has no saved portfolio; nothing is written');
    if (read.copy) throw new Error('this person\'s Other experience list keeps its own copy of the portfolio; edit it there');
    if (expect === null || read.portfolio.org !== expect) throw new Error('the current organization is not the one named with --expect-org; nothing is written');
    const body = { revision: read.revision, edits: [{ op: 'set', field: 'portfolio', value: form, summary: 'Approved portfolio draft applied' }] };
    const plan = { step: 'dry run', bytes: Buffer.byteLength(JSON.stringify(body)), limit: 12 * 1024, revision: read.revision, changes: changes(read.portfolio, form) };
    if (!flags.includes('--apply')) { console.log(JSON.stringify(plan)); return plan.bytes <= plan.limit ? 0 : 1; }
    const saved = await http(origin, session, 'POST', '/api/career-hunter/resume/master-edit', body);
    console.log(JSON.stringify({ step: 'applied', changed: saved.changed, changelog: saved.changelog, revision: saved.revision, before: read.revision,
      undo: `node career-hunter/scripts/portfolio-apply.mjs ${origin} <token file> --undo ${saved.revision} ${read.revision}` }));
    return 0;
  } finally {
    await http(origin, session, 'DELETE', '/sessions', undefined, [200, 204]).catch(() => console.error('portfolio-apply: sign-out failed'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(`portfolio-apply: ${String(error.message || error).slice(0, 300)}`); process.exitCode = 1; });
}
