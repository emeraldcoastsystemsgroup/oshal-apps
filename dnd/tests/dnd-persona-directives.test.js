/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-10-12 00:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Sweep 8: the Games concierge (this persona) ended a how-to answer with 'CHOICES: Start New Campaign | Check My Characters | Read How to Play', shown as text. The served persona scopes the directive lines to the table's own story requests and forbids them in combat highlights and concierge answers. The model is the boundary this cannot cross; tests/dnd-dm-fast-path.test.js proves the table strips a stray line in code.
 * 2026-10-12 23:55:00 | maintainer@emeraldcoastsystemsgroup.com     | Sweep 10: screen answers name the acting hero from the "<Name>'s turn" line (the concierge said Bram's turn while the screen said Pip's), read the latest Result line as what just happened, and never think aloud (it printed "(wait, Tallow was defeated? ... Let me re-read carefully. Ah, ...").
 * 2026-10-13 00:30:00 | maintainer@emeraldcoastsystemsgroup.com     | Sweep 11: in play the cockpit concierge (the kernel's panel, not a dnd route, so no package code strips its reply) again ended 'CHOICES: Watch the goblin's next move | ...'. The persona itself still printed 'ROLL: dexterity | 13', a GRANT line and a 'CHOICES:' template for the model to copy. No line of the served persona now begins with a directive; the table's own TABLE CONVERSATION request still carries all three exact formats.
 * 2026-10-12 21:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Sweep 9: the served persona says a new campaign needs no saved character (the Games concierge said one must be created first) and, for questions about the table screen, reads each combatant's marked side, gives a final reading without its working and names only the controls the screen shows (it called the enemy archer a hero, printed '21/21? Wait...' and offered a Review tab). The side marks themselves are proved in tests/browser/dnd-initiative-sides.test.cjs.
 * 2026-10-13 12:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Sweep 13: the concierge gave Vesh (AMBUSH ARCHER) Snaggletooth's role, invented an initiative roll for the next combatant and asked "What do you do?" during the Dungeon Master's turn. Screen answers read roles from the line after the side mark, the next to act from the bar's order, cite only shown rolls, and say the person waits.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PERSONA = fs.readFileSync(path.join(__dirname, '..', 'personas', 'dungeon-master.yaml'), 'utf8');
const perspective = PERSONA.slice(PERSONA.indexOf('perspective: |'), PERSONA.indexOf('\ncapabilities:'));

test('directive lines are scoped to the table and forbidden in concierge answers and combat highlights', () => {
  assert.match(perspective, /The CHOICES, ROLL and GRANT lines are read by the D&D table only\./);
  assert.match(perspective, /never write one\s+in a combat highlight, and never in an answer to a question beside the app/i);
  assert.match(perspective, /End on the answer itself: never a\s+closing "CHOICES:" list/);
});

test('a new campaign needs no saved character, and screen answers read sides and name only real controls', () => {
  assert.match(perspective, /no saved or imported character is needed to start: an empty My\s+Characters never blocks a new campaign/);
  assert.match(perspective, /"\(enemy\)" is a monster the party fights, "\(party\)" is a hero/);
  assert.match(perspective, /Never call an enemy a hero or a hero an enemy/);
  assert.match(perspective, /Give your final reading\s+only, never your working/);
  assert.match(perspective, /Name\s+only buttons and tabs the screen shows/);
});

test('screen answers name the acting hero from the turn line and never think aloud (sweep 10)', () => {
  assert.match(perspective, /Whose turn it is is the "<Name>'s turn" line under the bar, nothing else/);
  assert.match(perspective, /"YOU" marks\s+the person's own hero, which is not always the one acting/);
  assert.match(perspective, /What just happened is the latest "Result:" line/);
  assert.match(perspective, /Never think aloud: no parenthesised asides, no "Let me re-read"/);
});

test('the served persona writes no directive line; only the table request carries the formats (sweep 11)', () => {
  assert.doesNotMatch(perspective, /^\s*(?:CHOICES|ROLL|GRANT):/m, 'a template line in the persona is copied into concierge answers');
  assert.match(perspective, /Their exact format is given inside a table request/);
  assert.match(perspective, /Never\s+begin any line of a concierge answer with a capitalised word and a colon/);
  const service = fs.readFileSync(path.join(__dirname, '..', 'lib', 'dnd-dm-service.js'), 'utf8');
  const table = service.slice(service.indexOf('TABLE CONVERSATION'), service.indexOf('return `# LIVE TABLE REQUEST'));
  for (const format of [/^ROLL: <kind> \| <DC>/m, /^GRANT: <hero first name> \| <item name>/m, /^CHOICES: first useful next step/m]) assert.match(table, format);
});

test('screen answers read roles, the next to act and the Dungeon Master turn from the screen (sweep 13)', () => {
  const flat = perspective.replace(/\s+/g, ' ');
  assert.match(flat, /Each combatant's own role is the capitalised line straight after its side mark \("Vesh \(enemy\) AMBUSH ARCHER" makes Vesh the ambush archer\); never give one combatant another's role/);
  assert.match(flat, /The bar is the turn order, left to right: who acts next is the one after the acting one/);
  assert.match(flat, /Name a roll only when the screen shows it; the screen shows no initiative rolls/);
  assert.match(flat, /When the screen says "The Dungeon Master controls this turn", the person has nothing to do until their own hero's turn: say so, and never ask "What do you do\?"/);
  assert.match(flat, /"Watching <Name>" means that combatant is acting now/);
});
