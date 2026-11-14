/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lists 1.0.0: what can be done with a person's lists, one method for each action of the screen and of the concierge (they are the same routes). A list and an item are named by id or by the words a person uses; adding to a list that does not exist yet makes it; an item already on the list is not added twice and a done one comes back; the grocery list is refused here with where it lives (Shopping keeps it, so a person has one). Every answer is a status and a small body the page and the assistant both read.
 */
import { randomUUID } from 'node:crypto';
import { createListsStore } from './lists-store.mjs';
import { LIMITS, STEP, KEPT_BY_SHOPPING, listName, keptByShopping, itemFields, itemChange, sortLists, sortItems, between, findList, findItem } from './lists-rules.mjs';

/** Where the grocery list is, told to the page beside the person's own lists. */
export const GROCERIES = Object.freeze({ keptBy: 'Shopping', app: 'purchasing', open: '/cockpit/?app=purchasing' });

const refuse = (status, error, message, extra = {}) => ({ status, body: { error, message, ...extra } });
const listView = (row, counts) => ({ id: row.id, name: row.name, open: counts ? counts.open : Number(row.open_count), done: counts ? counts.done : Number(row.done_count), updatedAt: row.updated_at });
const itemView = (row) => ({ id: row.id, title: row.title, done: row.done === true, note: row.note ?? null, quantity: row.quantity == null ? null : Number(row.quantity), due: row.due_on ?? null, doneAt: row.done_at ?? null });
const count = (rows) => ({ open: rows.filter((row) => !row.done).length, done: rows.filter((row) => row.done).length });
const key = (title) => title.toLocaleLowerCase();
const bottom = (rows) => between(rows.filter((row) => !row.done).reduce((max, row) => Math.max(max, Number(row.position)), 0) || null, null);
const kept = () => refuse(409, 'kept_by_shopping', KEPT_BY_SHOPPING, { keptBy: GROCERIES });

/** @description The new items of an add call, validated, or the refusal. @param {object} input The request body. @returns {{values: object[]}|{refusal: object}} The items. */
function wanted(input) {
  const raw = Array.isArray(input.items) ? input.items : (input.title !== undefined ? [input] : null);
  if (!raw || raw.length < 1 || raw.length > LIMITS.batch) return { refusal: refuse(400, 'items_required', `Send 1 to ${LIMITS.batch} items, each with its words.`) };
  const values = [];
  for (const entry of raw) {
    const read = itemFields(entry || {});
    if (!read.ok) return { refusal: refuse(400, 'invalid_item', read.error) };
    values.push(read.value);
  }
  return { values };
}

/** @description Split wanted items into new ones, ones already open on the list, and done ones to bring back. @param {object[]} rows The list's items. @param {object[]} values The wanted items. @returns {{fresh: object[], already: string[], reopen: object[]}} The plan. */
function planned(rows, values) {
  const out = { fresh: [], already: [], reopen: [] }, seen = new Set();
  for (const value of values) {
    const same = rows.filter((row) => key(row.title) === key(value.title));
    if (seen.has(key(value.title)) || same.some((row) => !row.done)) out.already.push((same.find((row) => !row.done) || value).title);
    else if (same.length) out.reopen.push(same[0]);
    else out.fresh.push(value);
    seen.add(key(value.title));
  }
  return out;
}

/** @description Where a move ends, as an index among the open items, or null when the request names no place. @param {object} input to, or position. @param {number} from The item's index. @param {number} length How many open items. @returns {number|null} The index. */
function target(input, from, length) {
  const last = length - 1;
  if (input.position !== undefined) return Number.isInteger(input.position) && input.position >= 1 ? Math.min(input.position - 1, last) : null;
  return { top: 0, bottom: last, up: Math.max(0, from - 1), down: Math.min(last, from + 1) }[input.to] ?? null;
}

/**
 * @description The Lists actions over a package pool. Each public method takes the caller first and answers
 * {status, body}.
 */
export class ListsService {
  /** @param {{pool: object, now?: () => Date, id?: () => string}} deps The pool, and seams for the clock and new ids. */
  constructor({ pool, now = () => new Date(), id = randomUUID }) {
    this.store = createListsStore(pool);
    this.now = now;
    this.id = id;
    this.last = 0;
  }

  /** Two changes in the same millisecond still get different times, so "the one finished last" is never a tie. */
  stamp() {
    this.last = Math.max(this.now().getTime(), this.last + 1);
    return new Date(this.last).toISOString();
  }

  /** The list a caller means, or the refusal to answer with. `named` is set when nothing matched. */
  async listOf(sub, said) {
    if (said == null || String(said).trim() === '') return { refusal: refuse(400, 'list_required', 'Say which list: its name.') };
    const lists = sortLists(await this.store.lists(sub));
    const byId = lists.find((row) => row.id === String(said).trim());
    if (byId) return { lists, list: byId };
    const named = listName(said);
    if (named.ok && keptByShopping(named.key)) return { refusal: kept() };
    const hit = findList(lists, said);
    if (hit.found) return { lists, list: hit.found };
    if (hit.several) return { refusal: refuse(409, 'several_match', 'More than one list matches. Say which one.', { matches: hit.several }) };
    const shown = named.ok ? named.name : String(said).trim().slice(0, LIMITS.name);
    return { lists, named, refusal: refuse(404, 'no_such_list', `There is no list named "${shown}".`, { lists: lists.map((row) => row.name) }) };
  }

  /** A list and one of its items, or the refusal to answer with. */
  async itemOf(sub, input) {
    const at = await this.listOf(sub, input && input.list);
    if (at.refusal) return at;
    const rows = sortItems(await this.store.items(sub, at.list.id));
    if (!input.item || String(input.item).trim() === '') return { refusal: refuse(400, 'item_required', 'Say which item: its words.') };
    const hit = findItem(rows, input.item);
    if (hit.found) return { list: at.list, rows, row: hit.found };
    if (hit.several) return { refusal: refuse(409, 'several_match', 'More than one item matches. Say which one.', { matches: hit.several }) };
    return { refusal: refuse(404, 'no_such_item', `"${String(input.item).trim().slice(0, 80)}" is not on ${at.list.name}.`, { items: rows.slice(0, 50).map((row) => row.title) }) };
  }

  /** Keep the list's counts beside it and answer its view. */
  async counted(sub, list, rows) {
    const counts = count(rows), at = this.stamp();
    await this.store.countList(sub, list.id, counts.open, counts.done, at);
    return listView({ ...list, updated_at: at }, counts);
  }

  /** Make a list from a usable name, or the refusal. */
  async makeList(sub, lists, named) {
    if (lists.length >= LIMITS.lists) return { refusal: refuse(409, 'too_many_lists', `You already have ${LIMITS.lists} lists. Delete one before making another.`) };
    const row = { id: this.id(), name: named.name, key: named.key, position: lists.reduce((max, l) => Math.max(max, Number(l.position)), 0) + 1, at: this.stamp() };
    await this.store.insertList(sub, row);
    return { list: { id: row.id, name: row.name, name_key: row.key, position: row.position, open_count: 0, done_count: 0, created_at: row.at, updated_at: row.at } };
  }

  /** The list an add goes to: the one named, or a new one of that name. */
  async listForAdd(sub, said) {
    const at = await this.listOf(sub, said);
    if (!at.refusal) return { list: at.list, created: false };
    if (at.refusal.status !== 404 || !at.named) return { refusal: at.refusal };
    if (!at.named.ok) return { refusal: refuse(400, 'invalid_name', at.named.error) };
    const made = await this.makeList(sub, at.lists, at.named);
    return made.refusal ? made : { list: made.list, created: true };
  }

  /** @description Every list of the caller. @param {string} sub The caller. @returns {Promise<{status: number, body: object}>} The lists, and where the grocery list is. */
  async all(sub) {
    return { status: 200, body: { lists: sortLists(await this.store.lists(sub)).map((row) => listView(row)), groceries: GROCERIES } };
  }

  /** @description One list with its items. @param {string} sub The caller. @param {unknown} said The list's id or name. @returns {Promise<{status: number, body: object}>} The list. */
  async show(sub, said) {
    const at = await this.listOf(sub, said);
    if (at.refusal) return at.refusal;
    const rows = sortItems(await this.store.items(sub, at.list.id));
    return { status: 200, body: { list: listView(at.list, count(rows)), items: rows.map(itemView) } };
  }

  /** @description Make an empty list; one of that name that exists is answered instead. @param {string} sub The caller. @param {{name: string}} input The name. @returns {Promise<{status: number, body: object}>} The list. */
  async create(sub, input) {
    const named = listName(input && input.name);
    if (!named.ok) return refuse(400, 'invalid_name', named.error);
    if (keptByShopping(named.key)) return kept();
    const lists = await this.store.lists(sub), existing = lists.find((row) => row.name_key === named.key);
    if (existing) return { status: 200, body: { ok: true, already: true, list: listView(existing), message: `You already have a list named ${existing.name}.` } };
    const made = await this.makeList(sub, lists, named);
    return made.refusal || { status: 201, body: { ok: true, list: listView(made.list) } };
  }

  /** @description Rename a list. @param {string} sub The caller. @param {{list: string, name: string}} input The list and its new name. @returns {Promise<{status: number, body: object}>} The list. */
  async rename(sub, input) {
    const at = await this.listOf(sub, input && input.list);
    if (at.refusal) return at.refusal;
    const named = listName(input.name);
    if (!named.ok) return refuse(400, 'invalid_name', named.error);
    if (keptByShopping(named.key)) return kept();
    if (at.lists.some((row) => row.id !== at.list.id && row.name_key === named.key)) return refuse(409, 'name_taken', `You already have a list named ${named.name}.`);
    const when = this.stamp();
    await this.store.renameList(sub, at.list.id, named.name, named.key, when);
    return { status: 200, body: { ok: true, list: listView({ ...at.list, name: named.name, updated_at: when }) } };
  }

  /** @description Delete a list and its items. @param {string} sub The caller. @param {{list: string}} input The list. @returns {Promise<{status: number, body: object}>} What was removed. */
  async remove(sub, input) {
    const at = await this.listOf(sub, input && input.list);
    if (at.refusal) return at.refusal;
    const items = await this.store.deleteItems(sub, at.list.id);
    await this.store.deleteList(sub, at.list.id);
    return { status: 200, body: { ok: true, removed: { id: at.list.id, name: at.list.name, items } } };
  }

  /** @description Add one item or several; the list is made when it does not exist. @param {string} sub The caller. @param {object} input list, and title or items. @returns {Promise<{status: number, body: object}>} What was added, already there and brought back. */
  async addItems(sub, input) {
    const want = wanted(input || {});
    if (want.refusal) return want.refusal;
    const at = await this.listForAdd(sub, input.list);
    if (at.refusal) return at.refusal;
    const rows = at.created ? [] : await this.store.items(sub, at.list.id), plan = planned(rows, want.values);
    if (rows.length + plan.fresh.length > LIMITS.items) return refuse(409, 'list_full', `${at.list.name} holds ${rows.length} items and a list holds at most ${LIMITS.items}. Clear the done items or remove some first.`);
    const added = [], reopened = [];
    for (const value of plan.fresh) {
      const row = { id: this.id(), list_id: at.list.id, ...value, due_on: value.due, done: false, position: bottom(rows), created_at: this.stamp(), done_at: null };
      await this.store.insertItem(sub, { id: row.id, listId: at.list.id, title: row.title, note: row.note, quantity: row.quantity, due: row.due, position: row.position, at: row.created_at });
      rows.push(row); added.push(itemView(row));
    }
    for (const row of plan.reopen) {
      Object.assign(row, { done: false, done_at: null, position: bottom(rows) });
      await this.store.setDone(sub, row.id, false, null, row.position, this.stamp());
      reopened.push(itemView(row));
    }
    return { status: 200, body: { ok: true, created: at.created, list: await this.counted(sub, at.list, rows), added, already: plan.already, reopened } };
  }

  /** @description Tick an item off, or put it back at the bottom of the open ones. @param {string} sub The caller. @param {{list: string, item: string}} input The list and item. @param {boolean} done Done or not. @returns {Promise<{status: number, body: object}>} The item and its list. */
  async setDone(sub, input, done) {
    const at = await this.itemOf(sub, input);
    if (at.refusal) return at.refusal;
    if (at.row.done !== done) {
      const when = this.stamp();
      Object.assign(at.row, done ? { done: true, done_at: when } : { done: false, done_at: null, position: bottom(at.rows) });
      await this.store.setDone(sub, at.row.id, done, at.row.done_at, at.row.position, when);
    }
    return { status: 200, body: { ok: true, item: itemView(at.row), list: await this.counted(sub, at.list, at.rows) } };
  }

  /** @description Change an item's words, note, quantity or due date. @param {string} sub The caller. @param {object} input list, item and what changes. @returns {Promise<{status: number, body: object}>} The item. */
  async editItem(sub, input) {
    const at = await this.itemOf(sub, input);
    if (at.refusal) return at.refusal;
    const change = itemChange(at.row, input);
    if (!change.ok) return refuse(400, 'invalid_item', change.error);
    await this.store.editItem(sub, at.row.id, change.value, this.stamp());
    return { status: 200, body: { ok: true, item: itemView({ ...at.row, ...change.value, due_on: change.value.due }) } };
  }

  /** @description Put an open item at another place. @param {string} sub The caller. @param {object} input list, item, and to or position. @returns {Promise<{status: number, body: object}>} The open items in their new order. */
  async moveItem(sub, input) {
    const at = await this.itemOf(sub, input);
    if (at.refusal) return at.refusal;
    if (at.row.done) return refuse(409, 'item_is_done', `${at.row.title} is done, and done items have no place in the order. Untick it first.`);
    const open = at.rows.filter((row) => !row.done), from = open.indexOf(at.row), to = target(input, from, open.length);
    if (to === null) return refuse(400, 'invalid_move', 'Move an item to "top", "bottom", "up" or "down", or to a position counted from 1.');
    if (to !== from) await this.place(sub, open, from, to);
    return { status: 200, body: { ok: true, item: itemView(at.row), order: sortItems(open).map((row) => row.title) } };
  }

  /** Give the moved item a place between its new neighbours; when no whole number is left there, space the open items out again. */
  async place(sub, open, from, to) {
    const [moved] = open.splice(from, 1);
    open.splice(to, 0, moved);
    const spot = between(open[to - 1] ? Number(open[to - 1].position) : null, open[to + 1] ? Number(open[to + 1].position) : null);
    if (spot !== null) { moved.position = spot; await this.store.placeItem(sub, moved.id, spot, this.stamp()); return; }
    for (let index = 0; index < open.length; index += 1) {
      const next = (index + 1) * STEP;
      if (Number(open[index].position) !== next) { open[index].position = next; await this.store.placeItem(sub, open[index].id, next, this.stamp()); }
    }
  }

  /** @description Take one item off its list. @param {string} sub The caller. @param {{list: string, item: string}} input The list and item. @returns {Promise<{status: number, body: object}>} What was removed. */
  async removeItem(sub, input) {
    const at = await this.itemOf(sub, input);
    if (at.refusal) return at.refusal;
    await this.store.deleteItem(sub, at.row.id);
    const rows = at.rows.filter((row) => row !== at.row);
    return { status: 200, body: { ok: true, removed: { id: at.row.id, title: at.row.title }, list: await this.counted(sub, at.list, rows) } };
  }

  /** @description Remove the done items of a list. @param {string} sub The caller. @param {{list: string}} input The list. @returns {Promise<{status: number, body: object}>} How many were cleared. */
  async clearDone(sub, input) {
    const at = await this.listOf(sub, input && input.list);
    if (at.refusal) return at.refusal;
    const rows = await this.store.items(sub, at.list.id), cleared = rows.some((row) => row.done) ? await this.store.deleteDone(sub, at.list.id) : 0;
    return { status: 200, body: { ok: true, cleared, list: await this.counted(sub, at.list, rows.filter((row) => !row.done)) } };
  }
}
