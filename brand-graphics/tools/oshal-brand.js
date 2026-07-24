#!/usr/bin/env node
/*
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR        | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-27          | Claude Opus   | Brand Graphics CLI: backs the registered
 *   brand_graphic tool for the marketing-graphics bot. Enqueues an on-brand
 *   motion-graphic job (the validated electric-"oshal" intro) to the remote Vids
 *   worker, which runs the vids-operator's src/brand/graphics.js against
 *   the operator's signed-in Chrome and posts the project URL back.
 *
 *   Mirrors the vids app's oshal-vids.js: a CLI tool that returns JSON on stdout
 *   for a bot to read. Calls the LOCAL /api/vids API (same container) with a
 *   brand-graphic job; reuses the SAME vids worker / remote-client registry (no
 *   new control-plane plumbing).
 *
 * Verbs (argv[2]) with a JSON input object (argv[3], the tool's {input}):
 *   intro     {brief?, subject?, voiceover?, music?}  -> build the full OSHAL intro
 *   graphic   {brief, voiceover?, music?}             -> graphic-only brand bumper
 * 2026-07-05 13:29:28 | roger.murphy@emeraldcoastsystemsgroup.com   | Send X-Service-Secret (SWARM_SERVICE_SECRET) — /api/vids is now guarded by serviceSecretOr(requiresAuth)
 * 2026-07-17 01:25:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carved into the brand-graphics store package (ADR-085 Wave 1; was core scripts/oshal-brand.js, invoked via the manifest tool's {packageDir}). FIX: the 07-05 service-secret change called authHeaders() but only ever defined it in oshal-vids.js — every invocation of THIS script died on a ReferenceError (unnoticed: the app shipped inactive). Helper now defined here.
 */
'use strict';

const BASE = `http://localhost:${process.env.PORT || '5000'}/api/vids`;
const SECRET = (process.env.SWARM_SERVICE_SECRET || '').trim();

function authHeaders(extra) {
  const h = Object.assign({}, extra);
  if (SECRET) h['X-Service-Secret'] = SECRET;
  return h;
}

function parseInput(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return r.json();
}

// Enqueue a vids job tagged as a brand-graphic build. The worker recognizes
// kind:'brand' and routes it through src/brand/graphics.js (makeIntro/makeBrandGraphic)
// instead of the generic Veo path, so the OSHAL look + filter-safe rules apply.
function brandJob(verb, input) {
  const brief = input.brief || input.subject || input.prompt || '';
  if (!brief && verb === 'graphic') throw new Error('brief required');
  return {
    kind: 'brand',
    brandMode: verb === 'graphic' ? 'graphic' : 'intro',
    brief,
    subject: input.subject || brief,
    voiceover: input.voiceover,
    music: input.music,
    musicMood: input.musicMood,
    voice: input.voice,
  };
}

async function run(verb, input) {
  switch (verb) {
    case 'intro':
    case 'graphic':
      return postJson(`${BASE}/jobs`, brandJob(verb, input));
    default:
      throw new Error(`unknown verb: ${verb}`);
  }
}

(async () => {
  const verb = process.argv[2];
  const input = parseInput(process.argv[3]);
  try {
    const out = await run(verb, input);
    process.stdout.write(JSON.stringify(out));
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: String((err && err.message) || err) }));
    process.exitCode = 1;
  }
})();
