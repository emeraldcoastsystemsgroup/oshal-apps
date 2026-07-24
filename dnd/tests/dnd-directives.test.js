/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-20 21:40:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Guard for the DM's structured directive parser (ROLL / GRANT / CHOICES): valid lines parse and are STRIPPED from the spoken narration; malformed or out-of-bounds directives are dropped, never applied (a bad GRANT must not reach a character sheet). Plain `node`, no framework — the factory is invoked with an empty ctx solely to reach the exposed parser.
 */

'use strict';
const { createDndRoutes } = require('../routes/dnd-routes.js');
createDndRoutes({}); // wires createDndRoutes._parseDirectives; no requests made
const parse = createDndRoutes._parseDirectives;

let failures = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { console.error('  ✗ ' + msg); failures++; } };

// ROLL — valid kinds + DC bounds; attack allowed; stripped from narration.
let r = parse('The chest is wedged tight.\nROLL: dexterity | 13\nCHOICES: pry it | smash it | leave it');
check(r.roll && r.roll.ability === 'dexterity' && r.roll.dc === 13, 'ROLL parses ability+dc');
check(!/ROLL:/.test(r.narration) && !/CHOICES:/.test(r.narration), 'directives stripped from narration');
check(r.choices.length === 3 && r.choices[1] === 'smash it', 'choices parsed');
check(parse('x\nROLL: attack | 12').roll.ability === 'attack', 'attack rolls are a valid kind');
check(parse('x\nROLL: luck | 12').roll === null, 'unknown ability dropped');
check(parse('x\nROLL: dexterity | 3').roll === null, 'DC below 5 dropped');
check(parse('x\nROLL: dexterity | 26').roll === null, 'DC above 25 dropped');

// GRANT — whitelisted dice only; malformed dropped; stripped.
r = parse('You wrench it free.\nGRANT: Pip | Rusty Shortsword | 1d6 | slashing | melee');
check(r.grant && r.grant.hero === 'pip' && r.grant.name === 'Rusty Shortsword' && r.grant.dice === '1d6' && r.grant.delivery === 'melee', 'GRANT parses');
check(!/GRANT:/.test(r.narration), 'GRANT stripped from narration');
check(parse('x\nGRANT: Pip | Doom Cannon | 9d12 | force | ranged').grant === null, 'oversized dice dropped');
check(parse('x\nGRANT: Pip | Thing | 1d6 | slashing | thrown').grant === null, 'bad delivery dropped');
check(parse('x\nGRANT: Pip | d6 club').grant === null, 'malformed GRANT dropped');

// No directives → clean pass-through.
r = parse('Just a story beat with no asks at all.');
check(r.roll === null && r.grant === null && r.choices.length === 0, 'plain narration passes through');
check(r.narration === 'Just a story beat with no asks at all.', 'narration untouched');

if (failures) { console.error(`\n✗ ${failures}/${checks} directive checks failed`); process.exit(1); }
console.log(`✓ DM directive parser guards hold — ${checks} checks green`);
