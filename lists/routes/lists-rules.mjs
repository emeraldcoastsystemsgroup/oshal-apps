/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lists 1.0.0: the rules of a list as pure functions. How a list is named and found the way people say it ("my packing list" is the list Packing), which names belong to Shopping (the grocery list is kept there, so a person has one), what an item may hold (words, a note, a whole quantity, a real day), the order of open and done items, and the place a moved item takes between its neighbours.
 */

/** How much one person may keep, and how long each text may be. */
export const LIMITS = Object.freeze({ lists: 100, items: 300, batch: 50, name: 80, title: 300, note: 1000, quantity: 9999 });
/** The distance between two neighbouring places, so a moved item changes one row. */
export const STEP = 65536;
/** Where the grocery list is, said to the person and to the assistant in the same words. */
export const KEPT_BY_SHOPPING = 'Your grocery list is kept by Shopping, which also makes the grocery order from it. Nothing was changed here; ask for the grocery list or open Shopping.';

const GROCERY_KEYS = new Set(['grocery', 'groceries', 'grocery shopping', 'groceries shopping', 'shopping', 'food shopping']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** @description Text with its spaces collapsed, or null when it is not text. @param {unknown} value Anything. @returns {string|null} The text. */
function plain(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : null;
}

/**
 * @description The name a list is kept under and the key it is found by. "my packing list" and "Packing" are the same
 * list: a leading my, the or our and a trailing "list" are how people speak, not part of the name. A name that is only
 * those words keeps them.
 * @param {unknown} said What the person or the assistant called the list.
 * @returns {{ok: true, name: string, key: string}|{ok: false, error: string}} The name and key, or why it is refused.
 */
export function listName(said) {
  const text = plain(said);
  if (!text || CONTROL.test(text)) return { ok: false, error: 'A list needs a name.' };
  if (text.length > LIMITS.name) return { ok: false, error: `A list name is at most ${LIMITS.name} characters.` };
  const core = text.replace(/^(?:my|the|our)\s+/i, '').replace(/\s+list$/i, '').trim();
  const kept = core && !/^list$/i.test(core) ? core : text;
  const name = kept.charAt(0).toLocaleUpperCase() + kept.slice(1);
  return { ok: true, name, key: name.toLocaleLowerCase() };
}

/** @description Whether a list key is the grocery or shopping list, which Shopping keeps. @param {string} key A key from listName. @returns {boolean} True when it is Shopping's. */
export function keptByShopping(key) {
  return GROCERY_KEYS.has(key);
}

/** @description A real calendar day, or undefined. @param {unknown} value 'YYYY-MM-DD'. @returns {string|undefined} The same day. */
function day(value) {
  if (typeof value !== 'string' || !DAY.test(value)) return undefined;
  const at = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value ? value : undefined;
}

/** @description One optional field: null when empty, undefined when it is not allowed. */
const OPTIONAL = {
  note(value) {
    if (value == null || value === '') return null;
    const text = typeof value === 'string' ? value.trim() : undefined;
    return text === undefined || text.length > LIMITS.note ? undefined : text || null;
  },
  quantity(value) {
    if (value == null || value === '') return null;
    const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
    return Number.isInteger(n) && n >= 1 && n <= LIMITS.quantity ? n : undefined;
  },
  due(value) {
    return value == null || value === '' ? null : day(value);
  },
};
const REFUSALS = {
  title: `An item needs its words, at most ${LIMITS.title} characters.`,
  note: `A note is text of at most ${LIMITS.note} characters.`,
  quantity: `A quantity is a whole number from 1 to ${LIMITS.quantity}.`,
  due: 'A due date is a real day written like 2026-11-20.',
};

/** @description An item's words, or undefined. @param {unknown} value The title. @returns {string|undefined} The words. */
function words(value) {
  const text = plain(value);
  return text && text.length <= LIMITS.title && !CONTROL.test(text) ? text : undefined;
}

/**
 * @description A new item as it is stored.
 * @param {object} body {title, note?, quantity?, due?}.
 * @returns {{ok: true, value: {title: string, note: string|null, quantity: number|null, due: string|null}}|{ok: false, error: string}} The item, or the refusal.
 */
export function itemFields(body) {
  const title = words(body && body.title);
  if (!title) return { ok: false, error: REFUSALS.title };
  const value = { title };
  for (const field of ['note', 'quantity', 'due']) {
    const read = OPTIONAL[field](body[field]);
    if (read === undefined) return { ok: false, error: REFUSALS[field] };
    value[field] = read;
  }
  return { ok: true, value };
}

/**
 * @description An item after a change that names only what changes. An empty value clears a note, a quantity or a
 * day; the words cannot be emptied; a field nobody knows is refused so a mistyped one is never silently ignored.
 * @param {object} current The stored row (title, note, quantity, due_on).
 * @param {object} change Any of title, note, quantity, due, and clear: the names of the note, quantity or due date to empty.
 * @returns {{ok: true, value: object}|{ok: false, error: string}} The whole item after the change, or the refusal.
 */
export function itemChange(current, change) {
  const named = Object.keys(change || {}).filter((key) => key !== 'list' && key !== 'item');
  if (!named.length) return { ok: false, error: 'Say what to change: the words, the note, the quantity or the due date.' };
  const unknown = named.find((key) => !['title', 'note', 'quantity', 'due', 'clear'].includes(key));
  if (unknown) return { ok: false, error: `An item has words, a note, a quantity and a due date; "${unknown}" is none of them.` };
  const value = { title: current.title, note: current.note ?? null, quantity: current.quantity ?? null, due: current.due_on ?? null };
  // The assistant's tool schema has no "nothing" value, so it names what to empty: clear: ["quantity", "due"].
  const clear = change.clear === undefined ? [] : change.clear;
  if (!Array.isArray(clear) || clear.some((field) => !['note', 'quantity', 'due'].includes(field))) return { ok: false, error: 'Only the note, the quantity and the due date can be cleared.' };
  for (const field of clear) value[field] = null;
  if ('title' in change) {
    value.title = words(change.title);
    if (!value.title) return { ok: false, error: REFUSALS.title };
  }
  for (const field of ['note', 'quantity', 'due']) {
    if (!(field in change)) continue;
    const read = OPTIONAL[field](change[field]);
    if (read === undefined) return { ok: false, error: REFUSALS[field] };
    value[field] = read;
  }
  return { ok: true, value };
}

/** @description Lists in the order they were made. @param {object[]} rows List rows. @returns {object[]} A sorted copy. */
export function sortLists(rows) {
  return [...rows].sort((a, b) => Number(a.position) - Number(b.position) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
}

/** @description Open items in their order, then done items, the one finished last first. @param {object[]} rows Item rows. @returns {object[]} A sorted copy. */
export function sortItems(rows) {
  const open = rows.filter((row) => !row.done).sort((a, b) => Number(a.position) - Number(b.position) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  const done = rows.filter((row) => row.done).sort((a, b) => String(b.done_at || '').localeCompare(String(a.done_at || '')) || String(a.id).localeCompare(String(b.id)));
  return [...open, ...done];
}

/**
 * @description The place between two neighbours. Null means no whole number is left between them and the open items
 * must be spaced out again first.
 * @param {number|null} before The place of the item above, or null at the top.
 * @param {number|null} after The place of the item below, or null at the bottom.
 * @returns {number|null} The place.
 */
export function between(before, after) {
  if (after == null) return (before == null ? 0 : Number(before)) + STEP;
  const low = before == null ? 0 : Number(before), place = Math.floor((low + Number(after)) / 2);
  return place > low && place < Number(after) ? place : null;
}

/** @description One row by id, exact words or the only one holding the words. */
function find(rows, said, keyOf, labelOf) {
  const text = plain(String(said ?? ''));
  if (!text) return { none: true };
  const byId = rows.find((row) => row.id === text);
  if (byId) return { found: byId };
  const key = text.toLocaleLowerCase();
  const exact = rows.filter((row) => keyOf(row) === key);
  if (exact.length === 1) return { found: exact[0] };
  const holding = exact.length ? exact : rows.filter((row) => keyOf(row).includes(key));
  if (holding.length === 1) return { found: holding[0] };
  return holding.length ? { several: holding.map(labelOf) } : { none: true };
}

/**
 * @description The list a person means: by id, by name as people say it, or the only list whose name holds the words.
 * @param {object[]} lists The person's list rows. @param {unknown} said An id or a name.
 * @returns {{found: object}|{several: string[]}|{none: true}} The list, the names that match, or nothing.
 */
export function findList(lists, said) {
  const named = listName(said);
  const byId = lists.find((row) => row.id === plain(String(said ?? '')));
  if (byId) return { found: byId };
  return named.ok ? find(lists, named.key, (row) => row.name_key, (row) => row.name) : { none: true };
}

/**
 * @description The item a person means: by id, by its exact words (an open one first), or the only item holding the words.
 * @param {object[]} items The list's item rows, in their shown order. @param {unknown} said An id or words.
 * @returns {{found: object}|{several: string[]}|{none: true}} The item, the titles that match, or nothing.
 */
export function findItem(items, said) {
  const text = plain(String(said ?? ''));
  const exact = text ? items.filter((row) => row.title.toLocaleLowerCase() === text.toLocaleLowerCase()) : [];
  if (exact.length > 1) return { found: exact.find((row) => !row.done) || exact[0] };
  return find(items, said, (row) => row.title.toLocaleLowerCase(), (row) => row.title);
}
