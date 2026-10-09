/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-135 D14/D16 guards for the recommendation builder, against the COMPILED routes/*.js. The cases that matter are the ones where a wrong answer is invisible: a destination silently omitted for a non-admin, a rule matching every document because it declared no criteria, an auto-approve rule reaching the world-readable swarm level, and ownership being inferred from a sidecar field any machine on the LAN can set.
 */

'use strict';

const assert = require('node:assert');
const {
  buildRecommendation, proposeTitle, ruleMatches, ruleMayAutoApprove,
  destinationCatalog, destinationsForCaller,
} = require('../routes/print-classify.js');

const CATALOG = [
  { id: 'private', label: 'Private to me', kind: 'private', collection: 'my-knowledge', readableBy: 'only you' },
  { id: 'swarm', label: 'Swarm knowledge', kind: 'swarm', collection: 'swarm-knowledge', readableBy: 'everyone signed in' },
  {
    id: 'maintenance', label: 'Maintenance bot', kind: 'bot', collection: 'agent-knowledge-maintenance',
    botId: 'maintenance', topics: ['heat exchanger', 'service interval', 'transmitter'],
    readableBy: 'everyone signed in',
  },
  {
    id: 'finance', label: 'Finance bot', kind: 'bot', collection: 'agent-knowledge-finance',
    botId: 'finance', topics: ['invoice', 'accounts payable'], readableBy: 'everyone signed in',
  },
];

const MAINTENANCE_DOC = 'Heat exchanger E-204 was serviced; the service interval returns to nominal. '
  + 'Replace the differential pressure transmitter.';

function sidecar(extra) {
  return Object.assign({
    jobName: 'document', originatingComputer: 'PARENTPC', clientIp: '10.0.0.5',
    printerName: 'oshal print', requestingUser: 'anyone-can-claim-this',
  }, extra || {});
}

function run() {
  let checks = 0;
  const check = (fn) => { fn(); checks += 1; };

  // --- titles -------------------------------------------------------------
  check(() => {
    assert.strictEqual(
      proposeTitle({ jobName: 'Quarterly Report' }, 'body'),
      'Quarterly Report', 'a real job name is the title',
    );
  });
  check(() => {
    // Windows names print jobs "document" constantly; that is worse than useless
    // in an inbox, so the first meaningful line wins instead.
    assert.strictEqual(
      proposeTitle({ jobName: 'document' }, 'QUARTERLY OPERATIONS SUMMARY\nbody text'),
      'QUARTERLY OPERATIONS SUMMARY', 'a generic job name falls through to the text',
    );
  });
  check(() => {
    assert.strictEqual(proposeTitle({}, '   '), 'Untitled document', 'never returns empty');
  });

  // --- content classification --------------------------------------------
  check(() => {
    const rec = buildRecommendation({
      sidecar: sidecar(), text: MAINTENANCE_DOC, destinations: CATALOG, rules: [], callerIsAdmin: true,
    });
    const maintenance = rec.proposals.find((p) => p.id === 'maintenance');
    const finance = rec.proposals.find((p) => p.id === 'finance');
    assert.ok(maintenance.recommended, 'the matching bot is recommended');
    assert.strictEqual(maintenance.confidence, 'high');
    assert.match(maintenance.reason, /heat exchanger/, 'the reason quotes what matched, not a score');
    assert.strictEqual(finance.recommended, false, 'an unrelated bot is not recommended');
    assert.match(finance.reason, /nothing in the text/i, 'and says WHY it was not');
  });
  check(() => {
    // Every destination is returned, including the rejected ones - hiding a
    // low-confidence option is a decision made for someone without telling them.
    const rec = buildRecommendation({
      sidecar: sidecar(), text: MAINTENANCE_DOC, destinations: CATALOG, rules: [], callerIsAdmin: true,
    });
    assert.strictEqual(rec.proposals.length, CATALOG.length, 'no destination is silently omitted');
  });
  check(() => {
    const rec = buildRecommendation({
      sidecar: sidecar(), text: MAINTENANCE_DOC, destinations: CATALOG, rules: [], callerIsAdmin: true,
    });
    const swarm = rec.proposals.find((p) => p.id === 'swarm');
    assert.strictEqual(swarm.recommended, false, 'the world-readable level is never recommended by content alone');
    assert.match(swarm.reason, /current named readers in your tenant/i, 'and says who would be able to read it');
  });

  // --- the swarm level is withheld from a non-admin ------------------------
  check(() => {
    const rec = buildRecommendation({
      sidecar: sidecar(), text: MAINTENANCE_DOC, destinations: CATALOG, rules: [], callerIsAdmin: false,
    });
    assert.ok(!rec.proposals.some((p) => p.id === 'swarm'),
      'a non-admin is not offered an option whose write would be refused');
    assert.ok(rec.proposals.some((p) => p.id === 'private'), 'the other destinations remain');
  });

  // --- rules --------------------------------------------------------------
  check(() => {
    // A rule with no criteria would match every document ever printed. That is
    // never what an admin means, so it matches nothing.
    assert.strictEqual(
      ruleMatches({ enabled: true, destinations: [], autoApprove: false }, sidecar()),
      false, 'a rule with no criteria matches nothing',
    );
  });
  check(() => {
    const rule = { ruleId: 'r1', label: 'Shop PC', enabled: true, matchComputer: 'parentpc', destinations: ['maintenance'], autoApprove: false };
    assert.ok(ruleMatches(rule, sidecar()), 'matching is case-insensitive');
    assert.strictEqual(ruleMatches(rule, sidecar({ originatingComputer: 'OTHER' })), false, 'and exact');
  });
  check(() => {
    const rule = { ruleId: 'r1', label: 'Shop PC', enabled: true, matchComputer: 'PARENTPC', matchPrinter: 'other-printer', destinations: ['maintenance'], autoApprove: false };
    assert.strictEqual(ruleMatches(rule, sidecar()), false, 'EVERY declared criterion must match');
  });
  check(() => {
    const rule = { ruleId: 'r1', label: 'Shop PC', enabled: false, matchComputer: 'PARENTPC', destinations: [], autoApprove: false };
    assert.strictEqual(ruleMatches(rule, sidecar()), false, 'a disabled rule never applies');
  });
  check(() => {
    const rule = { ruleId: 'r1', label: 'Shop PC', enabled: true, matchComputer: 'PARENTPC', destinations: ['finance'], autoApprove: false, suggestedUserSub: 'auth0|dad' };
    const rec = buildRecommendation({
      sidecar: sidecar(), text: MAINTENANCE_DOC, destinations: CATALOG, rules: [rule], callerIsAdmin: true,
    });
    const finance = rec.proposals.find((p) => p.id === 'finance');
    assert.ok(finance.recommended, 'a rule pre-ticks a destination the content would not have');
    assert.match(finance.reason, /administrator rule/i, 'and says the rule did it');
    assert.strictEqual(rec.appliedRule.ruleId, 'r1', 'the rule is recorded so a bad one is discoverable');
    assert.strictEqual(rec.suggestedUserSub, 'auth0|dad', 'a suggested owner is surfaced as a HINT');
  });

  // --- auto-approval bounds ----------------------------------------------
  check(() => {
    const rule = { ruleId: 'r1', label: 'Shop PC', enabled: true, matchComputer: 'PARENTPC', destinations: ['maintenance'], autoApprove: true };
    const rec = buildRecommendation({
      sidecar: sidecar(), text: MAINTENANCE_DOC, destinations: CATALOG, rules: [rule], callerIsAdmin: true,
    });
    assert.strictEqual(ruleMayAutoApprove(rec, CATALOG), true, 'a bot-only auto-approve rule may proceed');
  });
  check(() => {
    // ADR-135 D16 bound 2: nothing reaches the world-readable level without a human.
    const rule = { ruleId: 'r2', label: 'Everything public', enabled: true, matchComputer: 'PARENTPC', destinations: ['swarm'], autoApprove: true };
    const rec = buildRecommendation({
      sidecar: sidecar(), text: MAINTENANCE_DOC, destinations: CATALOG, rules: [rule], callerIsAdmin: true,
    });
    assert.strictEqual(ruleMayAutoApprove(rec, CATALOG), false,
      'no rule may auto-approve into the swarm-wide level');
  });
  check(() => {
    const rule = { ruleId: 'r3', label: 'No auto', enabled: true, matchComputer: 'PARENTPC', destinations: ['maintenance'], autoApprove: false };
    const rec = buildRecommendation({
      sidecar: sidecar(), text: MAINTENANCE_DOC, destinations: CATALOG, rules: [rule], callerIsAdmin: true,
    });
    assert.strictEqual(ruleMayAutoApprove(rec, CATALOG), false, 'auto-approve is opt-in per rule');
  });

  // Current native declarations are already admitted before this pure adapter.
  check(() => {
    const botId = 'a0000000-0000-0000-0000-000000000050';
    const catalog = destinationCatalog([
      {id:'private',label:'Private to me',kind:'private',collection:'my-knowledge'},
      {id:'swarm',label:'Swarm knowledge',kind:'swarm',collection:'swarm-knowledge'},
      {id:`bot:${botId}`,label:'OSHAL Assistant',kind:'bot',collection:'assistant-knowledge',botId},
    ]);
    assert.deepStrictEqual(catalog.map(d=>d.collection), ['my-knowledge','swarm-knowledge','assistant-knowledge']);
    assert.match(catalog[2].readableBy, /current named readers in your tenant/);
    assert.match(catalog[2].readableBy, /routing, not privacy/);
    assert.deepStrictEqual(destinationsForCaller(catalog,false).map(d=>d.kind), ['private','bot']);
    assert.strictEqual(destinationsForCaller(catalog,true).length, 3);
  });
  check(() => {
    assert.throws(()=>destinationCatalog({OSHAL_OPERATOR_SUBS:'forged',PRINT_INGEST_BOT_DESTINATIONS:'forged'}), /unavailable/);
    assert.deepStrictEqual(destinationCatalog([]), [], 'no current native destinations means no guessed fallback');
  });
  check(() => {
    const row={id:'private',label:'Private',kind:'private',collection:'my-knowledge'};
    assert.throws(()=>destinationCatalog([row,row]), /Invalid/);
    assert.throws(()=>destinationCatalog([{...row,collection:'foreign:*'}]), /Invalid/);
    assert.throws(()=>destinationCatalog([{...row,kind:'bot',botId:'forged'}]), /Invalid/);
    assert.throws(()=>destinationCatalog(Array(33).fill(row)), /unavailable/);
  });

  // --- ownership is never inferred ---------------------------------------
  check(() => {
    const rec = buildRecommendation({
      sidecar: sidecar({ requestingUser: 'auth0|victim' }), text: MAINTENANCE_DOC,
      destinations: CATALOG, rules: [], callerIsAdmin: true,
    });
    assert.strictEqual(rec.suggestedUserSub, null,
      'a sidecar requestingUser NEVER becomes a suggested owner - any LAN machine can set it');
  });

  return checks;
}

module.exports = run;
