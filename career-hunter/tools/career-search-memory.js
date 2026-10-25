/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep bounded named and last successful job searches in an explicitly account-scoped browser store.
 */
(function (global) {
  'use strict';
  const FIELDS = ['q', 'remote', 'state', 'near', 'lat', 'lon', 'radius_miles', 'include_unknown_pay',
    'type', 'days', 'min_pay', 'title', 'description', 'company', 'sort', 'view'];
  function criteria(value) {
    const clean = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
    for (const key of FIELDS) {
      if (typeof value[key] === 'string' && value[key].trim() && value[key].length <= 240) clean[key] = value[key].trim();
    }
    return clean;
  }
  function create(storage, accountKey) {
    if (!accountKey || typeof accountKey !== 'string') throw new Error('Sign in to remember searches.');
    const key = 'career-search:v1:' + accountKey;
    function read() {
      let raw;
      try { raw = JSON.parse(storage.getItem(key) || '{}'); } catch (_) { raw = {}; }
      const saved = Array.isArray(raw?.saved) ? raw.saved.filter(row => row && typeof row.id === 'string'
        && row.id.length <= 100 && typeof row.name === 'string' && row.name.trim()).slice(0, 20)
        .map(row => ({ id: row.id, name: row.name.trim().slice(0, 80), criteria: criteria(row.criteria) })) : [];
      return { last: raw?.last ? criteria(raw.last) : null, saved };
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
    };
  }
  const api = { create, criteria, fields: FIELDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.CareerSearchMemory = api;
}(typeof window !== 'undefined' ? window : globalThis));
