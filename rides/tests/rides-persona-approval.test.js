/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9: with the prepare-ride-booking card still waiting for Approve, the
 *   concierge said "The UberX ride handoff ... has been prepared". The tool is held for the rider's approval in the manifest,
 *   and the persona the kernel loads for the bot says a held hand-off is proposed and waiting on its card, never prepared or
 *   booked before the tool answers. (A text guard over the shipped persona; the model's behaviour is proved live.)
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Live after 1: an invented fare table with no estimate-ride call, and a card said to be
 *   waiting with no tool call. The persona says fares come only from estimate-ride and a card is mentioned only in a reply that
 *   called prepare-ride-booking.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: "has been prepared" again before approval (1 of 2), the proposal id printed, and a named pickup
 *   asked to be confirmed. The proposing reply has one fixed shape ("Approve the card to make the Uber link ..."), shows no id, tool
 *   name or bracketed card, and uses named places as given.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: "please prepare an UberX ride handoff from <a> to <b>" got no card (it sent the
 *   rider to the map because the Open Uber handoff button was off), and after the card was done the follow-up asked for approval
 *   again. Naming both places and asking to prepare is the request; a done card means the link is on that card.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const yaml = require(path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'));

test('the hand-off is held for approval and the persona says proposed until the tool answers', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  const tool = manifest.tools.find((t) => t.name === 'prepare-ride-booking');
  assert.equal(tool.requiresApproval, true);
  const bot = manifest.bots.find((b) => b.name === 'rides-concierge');
  const persona = yaml.load(fs.readFileSync(path.join(PKG, bot.persona), 'utf8')).perspective;
  assert.match(persona, /Only in a reply where you actually called it may you say the hand-off is proposed\s+and waits on that card; without that call, never mention a card/);
  assert.match(persona, /Never say it has been\s+prepared, created, sent or booked until the tool has answered after their approval/);
  assert.match(persona, /Fares, fare ranges and arrival times come only from estimate-ride's answer in this\s+conversation/);
  assert.match(persona, /estimate-ride and prepare-ride-booking both work here without an Uber connector/);
  assert.match(persona, /"Approve the card to make the Uber link for an UberX from <pickup>\s+to <dropoff>; Uber shows the real price before you request\."/);
  assert.match(persona, /Never show a proposal id, a tool\s+name or a card in brackets/);
  assert.match(persona, /do not ask them to confirm a place they just named/);
});

test('a named trip asked to be prepared gets the card, and a done card points to its link (sweep 13)', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  const tool = manifest.tools.find((t) => t.name === 'prepare-ride-booking');
  assert.doesNotMatch(tool.usageInstructions, /Call only after the rider asks to book\/request/);
  assert.match(tool.usageInstructions, /Call when the rider asks to prepare a hand-off, book or request the ride, with the pickup and drop-off they named \(the screen's map button need not be on\)/);
  const bot = manifest.bots.find((b) => b.name === 'rides-concierge');
  const persona = yaml.load(fs.readFileSync(path.join(PKG, bot.persona), 'utf8')).perspective.replace(/\s+/g, ' ');
  assert.match(persona, /A rider who asks you to prepare, book or request a ride and names both the pickup and the drop-off has asked for the hand-off: call prepare-ride-booking in that reply with those places/);
  assert.match(persona, /never send them to the map first/);
  assert.match(persona, /When the conversation records that the hand-off card ran \("Prepare Ride Handoff: done"\), the hand-off is ready and its Uber link is on that card \(Open uber\.com\): say so\. Never ask them to approve it again/);
});
