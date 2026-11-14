/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lists 1.0.0: every statement the package issues, in one place. Two plain tables (migrations/001-lists.sql), each with one text primary key. Every statement names the caller, so a row is only ever read or changed for its own person. The statements are the simple shapes the native kernel's interpreter runs for other packages: a read by text equality, a plain INSERT, an UPDATE or DELETE by key, no ON CONFLICT, no join, no ORDER BY (the package sorts), and never inside a transaction.
 */

const LIST_COLUMNS = 'id, name, name_key, position, open_count, done_count, created_at, updated_at';
const ITEM_COLUMNS = 'id, list_id, title, done, note, quantity, due_on, position, created_at, updated_at, done_at';

/**
 * @description The Lists store over a package pool, for one person at a time.
 * @param {{query: Function}} pool The package's pool (ctx.pool).
 * @returns {object} The statements as functions; each takes the caller first.
 */
export function createListsStore(pool) {
  const run = async (text, values) => pool.query(text, values);
  return {
    /** @description Every list of a person. @param {string} sub The caller. @returns {Promise<object[]>} Rows. */
    lists: async (sub) => (await run(`SELECT ${LIST_COLUMNS} FROM lists_lists WHERE user_sub = $1`, [sub])).rows,
    /** @description Make a list. @param {string} sub The caller. @param {object} row id, name, key, position, at. @returns {Promise<void>} */
    insertList: async (sub, row) => {
      await run('INSERT INTO lists_lists (id, user_sub, name, name_key, position, open_count, done_count, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 0, 0, $6, $7)',
        [row.id, sub, row.name, row.key, row.position, row.at, row.at]);
    },
    /** @description Rename a list. @returns {Promise<number>} Rows changed. */
    renameList: async (sub, id, name, key, at) => (await run('UPDATE lists_lists SET name = $3, name_key = $4, updated_at = $5 WHERE user_sub = $1 AND id = $2', [sub, id, name, key, at])).rowCount,
    /** @description Keep a list's open and done counts beside it, so the list of lists is one small read. @returns {Promise<number>} Rows changed. */
    countList: async (sub, id, open, done, at) => (await run('UPDATE lists_lists SET open_count = $3, done_count = $4, updated_at = $5 WHERE user_sub = $1 AND id = $2', [sub, id, open, done, at])).rowCount,
    /** @description Delete a list row. @returns {Promise<number>} Rows removed. */
    deleteList: async (sub, id) => (await run('DELETE FROM lists_lists WHERE user_sub = $1 AND id = $2', [sub, id])).rowCount,
    /** @description The items of one list. @returns {Promise<object[]>} Rows. */
    items: async (sub, listId) => (await run(`SELECT ${ITEM_COLUMNS} FROM lists_items WHERE user_sub = $1 AND list_id = $2`, [sub, listId])).rows,
    /** @description Add an open item. @param {object} row id, listId, title, note, quantity, due, position, at. @returns {Promise<void>} */
    insertItem: async (sub, row) => {
      await run('INSERT INTO lists_items (id, user_sub, list_id, title, done, note, quantity, due_on, position, created_at, updated_at) VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, $10)',
        [row.id, sub, row.listId, row.title, row.note, row.quantity, row.due, row.position, row.at, row.at]);
    },
    /** @description Change an item's words, note, quantity and day. @returns {Promise<number>} Rows changed. */
    editItem: async (sub, id, value, at) => (await run('UPDATE lists_items SET title = $3, note = $4, quantity = $5, due_on = $6, updated_at = $7 WHERE user_sub = $1 AND id = $2',
      [sub, id, value.title, value.note, value.quantity, value.due, at])).rowCount,
    /** @description Tick an item off or put it back, with its place. @returns {Promise<number>} Rows changed. */
    setDone: async (sub, id, done, doneAt, position, at) => (await run('UPDATE lists_items SET done = $3, done_at = $4, position = $5, updated_at = $6 WHERE user_sub = $1 AND id = $2',
      [sub, id, done, doneAt, position, at])).rowCount,
    /** @description Give an item a place. @returns {Promise<number>} Rows changed. */
    placeItem: async (sub, id, position, at) => (await run('UPDATE lists_items SET position = $3, updated_at = $4 WHERE user_sub = $1 AND id = $2', [sub, id, position, at])).rowCount,
    /** @description Remove one item. @returns {Promise<number>} Rows removed. */
    deleteItem: async (sub, id) => (await run('DELETE FROM lists_items WHERE user_sub = $1 AND id = $2', [sub, id])).rowCount,
    /** @description Remove the done items of a list. @returns {Promise<number>} Rows removed. */
    deleteDone: async (sub, listId) => (await run('DELETE FROM lists_items WHERE user_sub = $1 AND list_id = $2 AND done = $3', [sub, listId, true])).rowCount,
    /** @description Remove every item of a list. @returns {Promise<number>} Rows removed. */
    deleteItems: async (sub, listId) => (await run('DELETE FROM lists_items WHERE user_sub = $1 AND list_id = $2', [sub, listId])).rowCount,
  };
}
