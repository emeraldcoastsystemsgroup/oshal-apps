/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep bounded named and last successful job searches in an explicitly account-scoped browser store.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.56.0, T6 (searches follow the account to every device): state() and replace() read and set the whole copy, and account() keeps it in step with the copy the account holds (GET and POST /api/career-hunter/search-memory). The account's copy wins when it has one; a browser's searches from before 1.56.0 are handed to an account that has none. The server applies the same rules through this module (src-routes/career-search-memory-routes.ts).
 */
(function (global) {
  'use strict';
  const FIELDS = ['q', 'remote', 'state', 'near', 'lat', 'lon', 'radius_miles', 'include_unknown_pay',
    'type', 'days', 'min_pay', 'max_pay', 'pay_period', 'title', 'description', 'company', 'sort', 'per', 'view'];
  function criteria(value) {
    const clean = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
    for (const key of FIELDS) {
      if (typeof value[key] === 'string' && value[key].trim() && value[key].length <= 240) clean[key] = value[key].trim();
    }
    return clean;
  }
  /** A stored copy, cleaned: the last search and at most twenty named ones, only recognised criteria. */
  function clean(raw) {
    const saved = Array.isArray(raw?.saved) ? raw.saved.filter(row => row && typeof row.id === 'string'
      && row.id.length <= 100 && typeof row.name === 'string' && row.name.trim()).slice(0, 20)
      .map(row => ({ id: row.id, name: row.name.trim().slice(0, 80), criteria: criteria(row.criteria) })) : [];
    return { last: raw?.last ? criteria(raw.last) : null, saved };
  }
  function create(storage, accountKey) {
    if (!accountKey || typeof accountKey !== 'string') throw new Error('Sign in to remember searches.');
    const key = 'career-search:v1:' + accountKey;
    function read() {
      let raw;
      try { raw = JSON.parse(storage.getItem(key) || '{}'); } catch (_) { raw = {}; }
      return clean(raw);
    }
    function write(state) {
      try { storage.setItem(key, JSON.stringify(state)); }
      catch (_) { throw new Error('This browser cannot save searches. You can still use the search URL.'); }
    }
    return {
      key,
      last: () => read().last,
      list: () => read().saved,
      remember(value) { const state = read(); state.last = criteria(value); write(state); },
      save(name, value) {
        name = String(name || '').trim().slice(0, 80);
        if (!name) throw new Error('Give this search a name.');
        const state = read(), found = state.saved.find(row => row.name.toLowerCase() === name.toLowerCase());
        const row = { id: found?.id || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), name, criteria: criteria(value) };
        state.saved = [row, ...state.saved.filter(item => item.id !== row.id)].slice(0, 20);
        write(state); return row;
      },
      remove(id) { const state = read(); state.saved = state.saved.filter(row => row.id !== id); write(state); },
      clearLast() { const state = read(); state.last = null; write(state); },
      state: () => read(),
      replace(state) { write(clean(state)); },
    };
  }
  /**
   * @description Keep a browser copy in step with the copy the account holds, so a search remembered or saved on one
   * device is there on every other.
   * @param {object} memory A copy from create().
   * @param {function(string, object=): Promise<object>} request Asks the account: (method, body) -> {last, saved, stored}.
   * @returns {{pull: function(): Promise<string>, send: function(string, object=): Promise<object>}} pull() reads the
   * account's copy into the browser ("account"), hands it this browser's searches when it has none ("adopted"), or finds
   * nothing on either ("empty"); send(op, fields) applies remember, save, remove or clearLast on the account and takes
   * the account's answer as the browser copy.
   */
  function account(memory, request) {
    return {
      async pull() {
        const held = await request('GET');
        if (held && held.stored) { memory.replace(held); return 'account'; }
        const local = memory.state();
        if (!local.last && !local.saved.length) return 'empty';
        memory.replace(await request('POST', { op: 'adopt', state: local }));
        return 'adopted';
      },
      async send(op, fields) {
        const held = await request('POST', Object.assign({ op }, fields || {}));
        memory.replace(held);
        return held;
      },
    };
  }
  const api = { create, criteria, clean, account, fields: FIELDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.CareerSearchMemory = api;
}(typeof window !== 'undefined' ? window : globalThis));
