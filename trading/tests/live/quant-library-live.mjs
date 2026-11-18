#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane QUANTLIB1 (Roger, 2026-11-17: "does the quant have finance books and finance research papers loaded in its rag"): the quant library's live proof on the test slot, after kernel K1, Print Inbox 0.5.0 and Trades 1.62.0 are there and the shelf is loaded (print-ingest/scripts/load-shelf.mjs). Two made-up people with Trades editor access: a reader holding Print Inbox's reader role, and a control with no Print role. For each library question the reader's turn must show the engine recalled passages into trading-concierge (the kernel journal's rag.completed count for that person and bot) and the reply must cite a shelf work that explains the idea, by its link or by its title with its licence (a SUMMARY said as a summary). The control's turn recalls nothing. Questions with nothing to do with theory (paper positions, Schwab, the watchlist) must run the same tools for both people and keep the library out of the reply, so passages that arrive on every turn do not degrade an ordinary answer. Refuses production (:38788) and any non-loopback address; removes both people and the reader's role at the end.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A reply that names a full text's licence by its family ("CC BY-SA") without the version still counts as citing it; the title, link or a summary said as one are unchanged.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The leak check on ordinary answers no longer counts the word "summary" ("a summary of your positions" is ordinary); it looks for the library's own marks: QUANT LIBRARY, Wikipedia contributors, a Creative Commons licence, arXiv or a DOI link.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | One command for the coordinator after the kernel round and the gate: it checks the slot runs Trades 1.62.0+ and Print Inbox 0.5.0+, loads the shelf once through a throwaway publisher (quant-library-shelf.mjs: dry run first, the publisher removed after, the shelf kept), and runs the checks on both conversation orders (bot-fast first, then the swarm order), each put back after. Helpers moved to quant-library-live-kit.mjs.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.62.2: the questions and the citation grade come from quant-library-questions.mjs, shared with the bot-fast replay. A reply cites a shelf work when it names the work's title and one of its authors as the passage's line gives them, and says a SUMMARY is a summary (the coordinator's bar for bot-fast, 2026-11-17); a link alone, or a title with only its licence, no longer counts. The receipt keeps each library reply whole (up to 6,000 characters) so an uncited answer can be read after the run; the slot needs Trades 1.62.2.
 * -----------------------------------------------------------------------------
 *
 * usage: node trading/tests/live/quant-library-live.mjs <base http://127.0.0.1:38798> <slot oshald.env> <out folder>
 *          [--order=bot-fast|swarm|current] [--journal-unit=oshal-native-green.service] [--only=1,4]
 * With no --order it runs bot-fast and then swarm. Exit 0 when every check holds. The administrator credential is read
 * by name from the env file and never printed; the receipt (0600) holds statuses, tool names, recall counts and the
 * replies of the made-up test people, never a credential.
 */
import fs from 'node:fs';
import path from 'node:path';
import { APP, PRINT, say, message, testSlot, adminToken, request, makePerson, giveRole, removePerson, recalled, ask, setOrder, restoreOrder } from './quant-library-live-kit.mjs';
import { SHELF, ensureShelf } from './quant-library-shelf.mjs';
import { LIBRARY, ORDINARY, LIBRARY_MARKERS, citedWork } from './quant-library-questions.mjs';

const receipt = { startedAt: new Date().toISOString(), orders: {}, failures: [] };

function failed(what, detail) {
  receipt.failures.push({ what, ...detail });
  say('FAIL', { what, ...detail });
}

/** @description The slot must run the releases this proof is for; nothing is written before this holds. */
async function prerequisites(origin, admin) {
  const listed = (await request(origin, admin, 'GET', '/packages')).body;
  const held = new Map(((listed && listed.packages) || []).map((row) => [row.name, row]));
  const atLeast = (version, floor) => {
    const [a, b] = [String(version).split('.').map(Number), floor.split('.').map(Number)];
    for (let i = 0; i < 3; i += 1) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i];
    return true;
  };
  for (const [name, floor] of [[APP, '1.62.2'], [PRINT, '0.5.0']]) {
    const row = held.get(name);
    if (!row || row.state !== 'active' || !atLeast(row.version, floor)) throw new Error(`${name} ${floor} or later must be active on this slot (found ${row ? `${row.version} ${row.state}` : 'none'}); it needs the kernel round with K1 first`);
  }
}

/** @description Library questions on one order: recall reached the reader's turn and the reply cites the right shelf work; the control recalls nothing. */
async function libraryChecks(origin, people, unit, works, only, result) {
  for (const [index, item] of LIBRARY.entries()) {
    if (only && !only.has(index + 1)) continue;
    const turn = await ask(origin, people.reader, item.q, `lib-${index + 1}`);
    const recall = recalled(unit, people.reader.principal, turn.from, turn.to);
    const work = citedWork(turn.reply, item.ideas, works);
    const fact = { n: index + 1, status: turn.answer.status, seconds: Math.round((turn.to - turn.from) / 1000), recalled: recall.count, tools: turn.tools, cited: work && work.id, reply: turn.reply.slice(0, 6000) };
    result.library.push(fact);
    say('library', { order: result.order, ...fact, reply: fact.reply.slice(0, 200) });
    if (turn.answer.status !== 200 || recall.count < 1) failed(`${result.order} library question ${index + 1}: passages recalled into the reader's turn`, { status: turn.answer.status, recalled: recall.count });
    if (!work) failed(`${result.order} library question ${index + 1}: the reply cites a shelf work for ideas ${item.ideas} by title and author (a summary said as one)`, { reply: fact.reply.slice(0, 400) });
  }
  const control = await ask(origin, people.control, LIBRARY[0].q, 'control');
  const recall = recalled(unit, people.control.principal, control.from, control.to);
  result.control = { status: control.answer.status, recalled: recall.count, turns: recall.turns };
  say('control', { order: result.order, ...result.control });
  if (control.answer.status !== 200 || recall.count !== 0) failed(`${result.order}: a person without a Print role gets an ordinary answer and no passage`, result.control);
}

/** @description Ordinary questions on one order: the same tools run with and without recall, and no library text leaks. */
async function ordinaryChecks(origin, people, unit, result) {
  for (const [index, item] of ORDINARY.entries()) {
    const withLibrary = await ask(origin, people.reader, item.q, `ord-${index + 1}`);
    const without = await ask(origin, people.control, item.q, `ord-c-${index + 1}`);
    const recall = recalled(unit, people.reader.principal, withLibrary.from, withLibrary.to);
    const fact = { n: index + 1, q: item.q, recalled: recall.count, tools: withLibrary.tools, controlTools: without.tools,
      leaked: LIBRARY_MARKERS.test(withLibrary.reply), reply: withLibrary.reply.slice(0, 240), controlReply: without.reply.slice(0, 240) };
    result.ordinary.push(fact);
    say('ordinary', { order: result.order, ...fact });
    const ran = (tools) => tools.some((tool) => item.tools.includes(tool));
    if (withLibrary.answer.status !== 200 || !ran(withLibrary.tools)) failed(`${result.order} ordinary question ${index + 1}: the right tool ran with recall`, { tools: fact.tools });
    if (without.answer.status !== 200 || !ran(without.tools)) failed(`${result.order} ordinary question ${index + 1}: the right tool ran without recall`, { tools: fact.controlTools });
    if (fact.leaked) failed(`${result.order} ordinary question ${index + 1}: the library stayed out of an answer it does not bear on`, { reply: fact.reply });
  }
}

/** @description One conversation order: set it, run every check, put the saved order back. */
async function runOrder(origin, admin, out, order, context) {
  const result = { order, library: [], ordinary: [] };
  receipt.orders[order] = result;
  const saved = await setOrder(origin, admin, order, out);
  try {
    await libraryChecks(origin, context.people, context.unit, context.works, context.only, result);
    await ordinaryChecks(origin, context.people, context.unit, result);
  } finally {
    const status = await restoreOrder(origin, admin, saved).catch((e) => message(e));
    if (status !== 200) failed('restore the conversation order (saved-conversation-order.json holds it)', { status });
  }
}

async function main(argv) {
  const [base, envFile, out] = argv.filter((a) => !a.startsWith('--')), flag = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1];
  if (!base || !envFile || !out) throw new Error('usage: <base http://127.0.0.1:38798> <slot oshald.env> <out folder> [--order=bot-fast|swarm|current] [--journal-unit=<unit>] [--only=1,4]');
  const origin = testSlot(base), admin = adminToken(envFile), orders = flag('order') ? [flag('order')] : ['bot-fast', 'swarm'];
  const context = { unit: flag('journal-unit') || 'oshal-native-green.service', only: flag('only') ? new Set(flag('only').split(',').map(Number)) : null,
    works: JSON.parse(fs.readFileSync(path.join(SHELF, 'works.json'), 'utf8')), people: {} };
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  await prerequisites(origin, admin);
  try {
    context.people.reader = await makePerson(origin, admin, 'reader');
    await giveRole(origin, admin, context.people.reader, PRINT, 'reader');
    context.people.control = await makePerson(origin, admin, 'control');
    receipt.shelf = await ensureShelf(origin, admin, out, async () => {
      const turn = await ask(origin, context.people.reader, LIBRARY[0].q, 'probe');
      return recalled(context.unit, context.people.reader.principal, turn.from, turn.to);
    });
    say('shelf', receipt.shelf);
    for (const order of orders) await runOrder(origin, admin, out, order, context);
  } catch (error) {
    failed('the proof stopped', { error: message(error) });
  } finally {
    for (const person of Object.values(context.people)) await removePerson(origin, admin, person).catch((e) => failed('remove a test person', { error: message(e) }));
    fs.writeFileSync(path.join(out, 'quant-library-live.json'), JSON.stringify({ ...receipt, finishedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  }
  say('done', { orders, shelf: receipt.shelf && receipt.shelf.action, failures: receipt.failures.length });
  return receipt.failures.length ? 1 : 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(`quant-library-live: ${message(error)}`); process.exitCode = 1; });
