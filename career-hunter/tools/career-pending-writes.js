/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-CONCURRENT (Roger, 2026-11-25: "when im batch running resumes and trying to look for jobs i cant post them .. hit save... ect.."): a change Career cannot take while it writes a résumé is kept and saved by itself. On the native kernel a résumé being written holds the person's Career files for its whole run (three minutes or so), and the kernel answers every other change of theirs 409 career_run_in_progress before Career runs it, so nothing was written; the pages said "Try saving again when it finishes" and the press was gone. Every Career page now sends its changes through this one door (career-frame.js loads it): a change refused that way is kept, in order, in the person's own browser storage, the page says "Saving — waiting for the résumé being written now…", and it is sent again every few seconds until Career takes it, then "Saved." The press that made it waits for that answer, so its own page carries on as if Career had answered slowly. Only that refusal (and the kernel's "did not run" busy answers) is retried: anything else is answered as before. A change made while another is waiting goes after it, so a later change is never overwritten by an earlier one; a page that closes hands its waiting changes to another open Career page of the same person, which sends them, and one not sent within 30 minutes is dropped with words saying so. Batch work (My jobs' bulk queue, Generate again, Fill in several) marks its own requests careerBatch and keeps its own waiting; it asks waiting() and starts no new job while a person's change is waiting, so the change goes first.
 */
(function (root) {
  'use strict';
  // Loaded twice (the frame and a page's own tag): the first door stays the only one.
  if (root.CareerPendingWrites && root.CareerPendingWrites.door) return;
  /** One waiting change per key, beside the person's other Career storage. */
  const PREFIX = 'career-pending-write:v1:';
  /** What another page made of a change it sent for this one. */
  const DONE_PREFIX = 'career-pending-done:v1:';
  const API = '/api/career-hunter/';
  /** How often a waiting change is sent again. */
  const RETRY_MS = 2500;
  /** A change whose page has not touched it for this long is another open page's to send. */
  const STALE_MS = 15000;
  /** A change not sent within this long is dropped and said (the kernel ends a run at 30 minutes). */
  const KEEP_MS = 30 * 60 * 1000;
  /** How long an answer for another page is kept for it to read. */
  const DONE_MS = 2 * 60 * 1000;
  /** After this long, the page says the work is taking longer. */
  const LONG_MS = 2 * 60 * 1000;
  const WORDS = {
    one: 'Saving — waiting for the résumé being written now. Your change saves by itself when it finishes, usually within a few minutes. You can keep working.',
    many: (n) => `Saving ${n} changes — waiting for the résumé being written now. They save by themselves when it finishes, usually within a few minutes. You can keep working.`,
    long: 'Still saving — Career is finishing its work on your account. Your change is kept and saves by itself.',
    saved: 'Saved.',
    lost: (when) => `A change you made at ${when} was not saved: Career was busy and the page closed before it could save. Make it again if you still want it.`,
    refused: (why) => `A change you made earlier was not saved: ${why}`,
  };

  function newId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  /**
   * @description Whether the kernel refused a change before Career ran it, so sending it again cannot do anything twice:
   * 409 career_run_in_progress (a run holds the person's files), or a busy answer that says the request did not run.
   * @param {Response} response The answer. @returns {Promise<boolean>}
   */
  async function refusedBeforeRunning(response) {
    if (!response || (response.status !== 409 && response.status !== 503)) return false;
    let body;
    try { body = await response.clone().json(); } catch (_) { return false; }
    if (response.status === 409) return !!body && body.error === 'career_run_in_progress';
    return /did not run|nothing was run/i.test(String((body && (body.detail || body.error)) || ''));
  }

  /** @description A request's headers as a plain map, or null when it carries one this door must not keep (a confirmation). */
  function plainHeaders(headers) {
    const out = {}, pairs = [];
    if (!headers) return out;
    if (Array.isArray(headers)) pairs.push(...headers);
    else if (typeof headers.forEach === 'function' && typeof headers.get === 'function') headers.forEach((value, name) => pairs.push([name, value]));
    else pairs.push(...Object.entries(headers));
    for (const [name, value] of pairs) {
      const key = String(name).toLowerCase();
      if (key !== 'content-type' && key !== 'accept') return null;
      out[key] = String(value);
    }
    return out;
  }

  /** @description What a page sent, when it is a Career change this door keeps; null for anything else. */
  function describe(input, init, origin, base) {
    if (typeof input !== 'string' && !(typeof URL === 'function' && input instanceof URL)) return null;
    const options = init || {}, method = String(options.method || 'GET').toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return null;
    let url;
    try { url = new URL(String(input), base || origin + '/'); } catch (_) { return null; }
    if (url.origin !== origin || !url.pathname.startsWith(API)) return null;
    const headers = plainHeaders(options.headers);
    if (!headers) return null;
    const body = options.body, text = body == null || typeof body === 'string';
    const resendable = text || (typeof FormData === 'function' && body instanceof FormData) || (typeof Blob === 'function' && body instanceof Blob);
    if (!resendable) return null;
    return { method, url: url.pathname + url.search, headers, body: text ? (body == null ? null : body) : null, persist: text };
  }

  /** @description An init without this door's own fields (careerBatch, careerWaiting). */
  function strip(init) {
    if (!init || !('careerBatch' in init || 'careerWaiting' in init)) return init;
    const copy = { ...init };
    delete copy.careerBatch;
    delete copy.careerWaiting;
    return copy;
  }

  /** @description A clock time a person reads ("14:05"). */
  function clockTime(ms) {
    try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (_) { return new Date(ms).toISOString().slice(11, 16); }
  }

  /** @description Why a change was refused, in the words Career answered. */
  function reason(response, text, error) {
    if (error) return 'Career could not be reached, so it may not have been saved. Check it before making it again.';
    try { const said = JSON.parse(text); if (said && typeof said.error === 'string') return said.error; } catch (_) { /* not JSON */ }
    return 'Career answered HTTP ' + (response && response.status) + '.';
  }

  /**
   * @description Make one page's door. @param {object} deps fetch (the browser's own), storage (localStorage; any call may
   * throw), now, schedule(fn, ms)/cancel(handle), tab, origin, identity (async: the signed-in person as 'tenant:principal',
   * or ''), onView(view) to draw the page's line. @returns {object} fetch (the door), waiting, pump, handOver, holdsUnsaved, view.
   */
  function create(deps) {
    const tab = deps.tab || newId(), now = deps.now || (() => Date.now()), memory = new Map(), notices = [];
    let owner = null, asked = null, timer = null, pumping = false, seq = 0, since = 0, settledBad = false, shown = '';

    const safe = (work, fallback) => { try { return work(); } catch (_) { return fallback; } };
    const key = (id) => PREFIX + owner + ':' + id;
    const doneKey = (id) => DONE_PREFIX + owner + ':' + id;
    const keys = () => safe(() => { const out = []; for (let i = 0; i < deps.storage.length; i += 1) out.push(deps.storage.key(i)); return out; }, []);
    const read = (name) => safe(() => JSON.parse(deps.storage.getItem(name) || 'null'), null);
    const write = (name, value) => safe(() => { deps.storage.setItem(name, JSON.stringify(value)); return true; }, false);
    const drop = (name) => safe(() => { deps.storage.removeItem(name); return true; }, false);

    /** Learn who is signed in, once; without a person nothing is kept past this page. */
    function knowOwner() {
      if (owner !== null) return Promise.resolve(owner);
      if (!asked) asked = Promise.resolve().then(() => deps.identity()).catch(() => '').then((who) => { owner = String(who || ''); return owner; });
      return asked;
    }
    const anyStored = () => !!deps.storage && keys().some((name) => name && name.startsWith(PREFIX));
    /** The changes this person has waiting in storage (every open page of theirs). */
    function stored() {
      if (!owner || !deps.storage) return [];
      return keys().filter((name) => name && name.startsWith(PREFIX + owner + ':')).map(read).filter((entry) => entry && entry.id && entry.url);
    }
    const unkept = () => [...memory.values()].filter((held) => !held.persisted).map((held) => held.entry);
    /** @description How many of the person's changes are waiting, on every open page of theirs. @param {string} [who] */
    function waiting(who) {
      if (who && owner === null) owner = String(who);
      return stored().length + unkept().length;
    }
    function later(ms) {
      if (timer !== null) return;
      timer = deps.schedule(() => { timer = null; void pump(); }, ms);
    }

    /** Keep a refused change and answer its press when Career takes it. */
    function enqueue(request, init) {
      return knowOwner().then(() => new Promise((resolve, reject) => {
        const entry = { id: newId(), tab, seq: ++seq, at: now(), beat: now(), attempts: 1, ...request };
        const held = { entry, resolve, reject, body: init && init.body, signal: init && init.signal, persisted: false };
        if (request.persist && owner) held.persisted = write(key(entry.id), entry);
        memory.set(entry.id, held);
        if (held.signal) held.signal.addEventListener('abort', () => abandon(entry.id), { once: true });
        // A press with its own deadline for an unanswered write hears that its change is known to be waiting, not lost.
        if (init && typeof init.careerWaiting === 'function') { try { init.careerWaiting(); } catch (_) { /* the press keeps waiting */ } }
        if (!since) since = now();
        view();
        later(RETRY_MS);
      }));
    }
    /** The press stopped waiting (its page aborted it): the change is not sent. */
    function abandon(id) {
      const held = memory.get(id);
      if (!held) return;
      memory.delete(id);
      drop(key(id));
      const error = typeof DOMException === 'function' ? new DOMException('The change was cancelled before Career took it.', 'AbortError') : Error('aborted');
      held.reject(error);
      view();
    }

    /** The page's fetch: a Career change goes in line when one is waiting, and waits when the kernel refused it unrun. */
    async function door(input, init) {
      const request = describe(input, init, deps.origin, deps.base);
      if (!request || (init && init.careerBatch)) return deps.fetch(input, strip(init));
      if (memory.size || (anyStored() && (await knowOwner()) !== null && stored().length)) return enqueue(request, init);
      const response = await deps.fetch(input, strip(init));
      if (await refusedBeforeRunning(response)) return enqueue(request, init);
      return response;
    }

    /** Take the changes another page left (it closed or stopped sending), drop those too old to send, and mark ours. */
    function line(t) {
      const out = [];
      for (const entry of stored()) {
        if (entry.tab !== tab && t - (entry.beat || 0) > STALE_MS) {
          if (t - entry.at > KEEP_MS) { drop(key(entry.id)); notices.push(WORDS.lost(clockTime(entry.at))); continue; }
          Object.assign(entry, { tab, beat: t, adoptedAt: t });
          write(key(entry.id), entry);
        } else if (entry.tab === tab) {
          entry.beat = t;
          write(key(entry.id), entry);
        }
        out.push(entry);
      }
      return out.concat(unkept()).sort((a, b) => a.at - b.at || a.seq - b.seq);
    }

    /** Answer this page's presses whose changes another page sent; put back a kept change storage lost. */
    function collect() {
      for (const [id, held] of memory) {
        if (!held.persisted) continue;
        const done = read(doneKey(id));
        if (done) {
          memory.delete(id);
          drop(doneKey(id));
          if (done.error) { held.reject(Error(done.error)); continue; }
          const empty = [204, 205, 304].includes(done.status);
          held.resolve(new Response(empty ? null : done.text, { status: done.status, headers: { 'content-type': done.type || 'application/json' } }));
          if (done.status >= 400) settledBad = true;
        } else if (!read(key(id))) held.persisted = write(key(id), held.entry);
      }
      for (const name of keys()) {
        if (!name || !name.startsWith(DONE_PREFIX)) continue;
        const done = read(name);
        if (!done || now() - (done.at || 0) > DONE_MS) drop(name);
      }
    }

    /** Send the changes in line, first one first, while the first is this page's to send and Career takes them. */
    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        if (anyStored() || memory.size) await knowOwner();
        for (let sent = 0; sent < 20; sent += 1) {
          collect();
          const t = now(), head = line(t)[0];
          if (!head || head.tab !== tab || (head.adoptedAt && t - head.adoptedAt < RETRY_MS)) break;
          if (!(await send(head))) break;
        }
      } finally {
        pumping = false;
        view();
        if (waiting() || memory.size) later(RETRY_MS);
      }
    }

    async function send(entry) {
      const held = memory.get(entry.id);
      const body = held && !held.persisted ? held.body : entry.body == null ? undefined : entry.body;
      const init = { method: entry.method, headers: entry.headers, body, credentials: 'same-origin', cache: 'no-store' };
      if (held && held.signal) init.signal = held.signal;
      let response;
      try { response = await deps.fetch(entry.url, init); } catch (error) { await settle(entry, held, null, error); return true; }
      if (await refusedBeforeRunning(response)) {
        entry.attempts += 1;
        if (!held || held.persisted) write(key(entry.id), entry);
        return false;
      }
      await settle(entry, held, response, null);
      return true;
    }

    /** Career took the change (or refused it for a reason of its own): answer its press, or the page that made it. */
    async function settle(entry, held, response, error) {
      if (!held) {
        const text = response ? await response.clone().text().catch(() => '') : '';
        const type = response ? response.headers.get('content-type') || 'application/json' : '';
        write(doneKey(entry.id), response ? { at: now(), status: response.status, type, text } : { at: now(), error: reason(null, '', error) });
        if (!response || !response.ok) notices.push(WORDS.refused(reason(response, text, error)));
      }
      drop(key(entry.id));
      memory.delete(entry.id);
      if (!response || !response.ok) settledBad = true;
      if (held) { if (error) held.reject(error); else held.resolve(response); }
    }

    /** @description What the page says now: the waiting line, Saved once all landed, or a change that was not saved. */
    function view() {
      const count = waiting(), t = now();
      let text = '', tone = 'waiting';
      if (count) {
        if (!since) since = t;
        text = t - since > LONG_MS ? WORDS.long : count === 1 ? WORDS.one : WORDS.many(count);
      } else if (since) {
        since = 0;
        text = settledBad ? '' : WORDS.saved;
        tone = 'saved';
        settledBad = false;
      }
      if (notices.length) { text = notices.splice(0).join(' '); tone = 'notice'; }
      const value = { count, text, tone };
      if (deps.onView && (text || shown)) deps.onView(value);
      shown = text;
      return value;
    }

    /** @description The page is going: its kept changes become another open page's to send at once. */
    function handOver() {
      for (const held of memory.values()) {
        if (!held.persisted) continue;
        held.entry.beat = 0;
        write(key(held.entry.id), held.entry);
      }
    }
    /** @description Whether leaving would lose a change (one that could not be kept in storage). */
    const holdsUnsaved = () => unkept().length > 0;

    /** @description Start sending what another page of this person left, if anything. */
    function resume() { if (anyStored()) void knowOwner().then(() => { if (stored().length) later(0); }); }

    return { fetch: door, waiting, pump, handOver, holdsUnsaved, view, resume, tab: () => tab, owner: () => owner };
  }

  /** @description The page's line: one quiet status at the bottom, read out by a screen reader. */
  function line(doc) {
    let el = null, hide = null;
    return (value) => {
      if (!doc.body) return;
      if (!el) {
        el = doc.createElement('div');
        el.className = 'career-pending-writes';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.style.cssText = 'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:2147483000;'
          + 'box-sizing:border-box;max-width:min(560px, calc(100vw - 32px));padding:10px 14px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;'
          + 'background:var(--ds-surface, Canvas);color:var(--ds-text, CanvasText);border:1px solid var(--ds-edge, GrayText);box-shadow:0 4px 16px rgba(0,0,0,.18);';
        doc.body.appendChild(el);
      }
      // The same words again are not written again, so a screen reader says them once.
      if (el.textContent === value.text && el.dataset.tone === value.tone && !el.hidden === !!value.text) return;
      if (hide) { clearTimeout(hide); hide = null; }
      el.textContent = value.text;
      el.dataset.tone = value.tone;
      el.hidden = !value.text;
      if (value.text && value.tone !== 'waiting') hide = setTimeout(() => { el.hidden = true; }, value.tone === 'notice' ? 12000 : 4000);
    };
  }

  /** @description Put the door in front of this page's fetch, once. @param {Window} win @returns {object|null} The door. */
  function install(win) {
    if (!win || !win.document || typeof win.fetch !== 'function') return null;
    if (win.CareerPendingWrites && win.CareerPendingWrites.door) return win.CareerPendingWrites.door;
    const raw = win.fetch.bind(win);
    let storage = null;
    try { storage = win.localStorage; } catch (_) { storage = null; }
    const door = create({
      fetch: raw, storage, origin: win.location.origin, base: win.location.href, schedule: (fn, ms) => win.setTimeout(fn, ms), now: () => Date.now(), onView: line(win.document),
      identity: async () => {
        const response = await raw('/api/auth/user', { cache: 'no-store' });
        const who = await response.json();
        return response.ok && who && who.authenticated && who.tenant && who.principal_id ? who.tenant + ':' + who.principal_id : '';
      },
    });
    win.fetch = (input, init) => door.fetch(input, init);
    win.addEventListener('storage', (event) => { if (event.key && (event.key.startsWith(PREFIX) || event.key.startsWith(DONE_PREFIX))) void door.pump(); });
    win.addEventListener('pagehide', () => door.handOver());
    win.addEventListener('beforeunload', (event) => { if (door.holdsUnsaved()) { event.preventDefault(); event.returnValue = ''; } });
    win.CareerPendingWrites.door = door;
    door.resume();
    return door;
  }

  const api = { create, install, refusedBeforeRunning, describe, WORDS, RETRY_MS, STALE_MS, KEEP_MS, PREFIX,
    /** @description How many of the person's changes are waiting (0 before the door is in place). @param {string} [owner] */
    waiting: (owner) => (api.door ? api.door.waiting(owner) : 0) };
  root.CareerPendingWrites = api;
  if (root.document && root.fetch) install(root);
})(typeof window === 'undefined' ? globalThis : window);
