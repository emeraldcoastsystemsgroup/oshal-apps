/* trading/ui/native-paper.js — the native paper autopilot controls (TRADE-01).
 *
 * Classic script (like every view module): plain globals over app.js's $, esc, money, api, STATUS, render.
 * On the native kernel the paper book has no broker rail; GET /status then carries `nativePaper` and this
 * module offers the person their own paper book instead of "broker not connected":
 *   - Start: POST /api/trading/paper/arm with the person's guardrails, then the person's OWN
 *     POST /api/v1/agent/schedules/{id}/activate {class:'person'} for the package's paper-autopilot job
 *     (the same request the Jobs screen's "Activate for me" makes), so the kernel fires the tick as them.
 *   - Stop: POST /api/trading/paper/disarm, then POST /api/v1/agent/schedules/{id}/deactivate.
 * Every step prints the server's own answer; a refused activation leaves the book armed and says so.
 * Armed is not scheduled: once the header paints, it reads the person's own paper-autopilot job and shows the two
 * apart ("armed, not scheduled" with an Activate button, never "autopilot on" for a book whose job is not active).
 * Paper only: nothing here can place a broker order.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: arm/disarm the native paper book and activate/deactivate its person schedule from the account view.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Armed vs scheduled told apart: the header pill said "autopilot on" and the button offered only Stop for an armed book whose paper-autopilot job was not activated, so nothing traded and the page offered no way to schedule it. After the header paints, nativePaperSync reads the person's job (GET /api/v1/agent/schedules) and paperAutopilotState decides the pill, the button (Activate paper schedule / Stop / Start) and the line under it. A start whose job is not listed or not activated now repaints too, so the header never keeps the pre-arm state.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The page keeps the paper schedule on: while the person has any armed paper account (one the concierge created in chat, or a Start pressed earlier) and their paper-autopilot job is not active, the page activates it in their own session, on open and every minute while visible. Before this, an account the concierge armed never traded until the person found the separate schedule button, and a Trading update that suspended the job left paper silently stopped.
 */

/* The Jobs screen's own activation configuration (crates/api/src/jobs.js "Activate for me"). */
const PAPER_ACTIVATION = { class: 'person', configuration: { runBudgetMicros: 1000000, dailyBudgetMicros: 10000000, timeoutMs: 60000 } };

/**
 * @description One request to the kernel's schedule API, same origin with the person's session.
 * @param {string} path - Kernel path.
 * @param {object} [opts] - fetch options.
 * @returns {Promise<object>} The parsed answer; throws with the server's own message on refusal.
 */
async function paperKernel(path, opts) {
  const r = await fetch(path, Object.assign({ credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }, opts || {}));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || j.message || j.error || ('HTTP ' + r.status));
  return j;
}

/**
 * @description The package's paper-autopilot schedule row from the caller's schedule list, or null.
 * @param {{app:string, name:string}} sched - The schedule the server named in GET /status.
 * @returns {Promise<object|null>} The row ({id, status, activation, ...}).
 */
async function paperScheduleRow(sched) {
  const j = await paperKernel('/api/v1/agent/schedules');
  const rows = j.schedules || j.jobs || [];
  return rows.find((s) => s.app === sched.app && s.name === sched.name) || null;
}

/**
 * @description Whether a schedule row is active for this caller.
 * @param {object|null} row - Schedule row.
 * @returns {boolean} True when the caller's own activation is live.
 */
function paperScheduleActive(row) {
  return Boolean(row && row.activation && row.status === 'active');
}

/**
 * @description The arm form's values (blank = the server's default).
 * @returns {object} Arm body.
 */
function paperArmBody() {
  const v = (id) => { const el = $(id); return el && el.value !== '' ? el.value : undefined; };
  return { posture: v('npPosture'), startingCash: v('npCash'), maxShares: v('npShares'), maxNotional: v('npNotional') };
}

/**
 * @description The panel offered when this paper book has no broker and no native paper account yet.
 * @param {string} name - Escaped account label.
 * @returns {string} HTML.
 */
function nativePaperArmPanel(name) {
  return '<div class="panel" id="npPanel"><h2>Paper autopilot for ' + name + '</h2>' +
    '<div class="sub">No broker is connected, so this account runs as your own paper book: the autopilot decides from the platform\'s market prices every five minutes while the US market is open and records simulated fills. It never places a broker order.</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">' +
    '<label class="foot">Risk posture <select id="npPosture"><option value="balanced">balanced</option><option value="conservative">conservative</option><option value="active">active</option><option value="aggressive">aggressive</option></select></label>' +
    '<label class="foot">Starting cash <input id="npCash" type="number" min="1000" step="1000" placeholder="100000" /></label>' +
    '<label class="foot">Max shares per order <input id="npShares" type="number" min="1" placeholder="100" /></label>' +
    '<label class="foot">Max $ per order <input id="npNotional" type="number" min="100" step="100" placeholder="5000" /></label></div>' +
    '<button class="btn primary" data-np="start">Start paper autopilot</button> <span id="npMsg" class="sub"></span></div>';
}

/**
 * @description The header control for an opened native paper book. Its label is provisional until nativePaperSync
 * has read the person's own paper-autopilot job; until then it says so instead of claiming the book trades.
 * @returns {string} HTML (empty when the native paper book does not apply).
 */
function nativePaperHeaderButton() {
  const np = STATUS && STATUS.nativePaper;
  if (!np || !np.opened) return '';
  return ' <button class="btn ghost" id="npBtn" data-np="' + (np.armed ? 'stop' : 'start') + '">' + (np.armed ? 'Stop paper autopilot' : 'Start paper autopilot') + '</button>' +
    ' <span id="npMsg" class="sub">' + (np.armed ? 'Checking whether your paper-autopilot job is active…' : '') + '</span>';
}

/**
 * @description What the header shows for a paper book: armed (the package's book) and scheduled (the person's own
 * kernel activation of the paper-autopilot job) are separate facts, and the book trades only with both.
 * @param {boolean} armed - Whether the paper book is armed.
 * @param {object|null} row - The person's paper-autopilot schedule row, or null when the host does not list it.
 * @returns {{action:string, label:string, pill:string, running:boolean, say:string, bad:boolean}} The header state.
 */
function paperAutopilotState(armed, row) {
  const active = paperScheduleActive(row);
  const why = row && row.status && row.status !== 'not-activated' && !active ? ' (it is ' + row.status + (row.reason ? ': ' + row.reason : '') + ')' : '';
  if (armed && active) return { action: 'stop', label: 'Stop paper autopilot', pill: 'autopilot on', running: true, bad: false,
    say: 'Armed and scheduled: it ticks every five minutes while the US market is open.' };
  if (armed && !row) return { action: 'stop', label: 'Stop paper autopilot', pill: 'armed, not scheduled', running: false, bad: true,
    say: 'Armed, but this host does not list the paper-autopilot job, so nothing fires on its own.' };
  if (armed) return { action: 'start', label: 'Activate paper schedule', pill: 'armed, not scheduled', running: false, bad: true,
    say: 'Armed, but your paper-autopilot job is not active' + why + ', so nothing trades. Activate it to start.' };
  if (active) return { action: 'start', label: 'Start paper autopilot', pill: 'autopilot off', running: false, bad: false,
    say: 'Disarmed: your paper-autopilot job is still active, but every tick refuses until the book is armed.' };
  return { action: 'start', label: 'Start paper autopilot', pill: 'autopilot off', running: false, bad: false, say: '' };
}

/**
 * @description Read the person's own paper-autopilot job and show armed vs scheduled in the header: the button, the
 * line under it and the autopilot pill the account header painted from the book alone.
 * @param {HTMLElement} host - The account header.
 * @returns {Promise<void>}
 */
async function nativePaperSync(host) {
  const np = STATUS && STATUS.nativePaper;
  const btn = host && host.querySelector('#npBtn');
  if (!np || !np.opened || !btn) return;
  let row;
  try { row = await paperScheduleRow(np.schedule); }
  catch (e) { npSay('Could not read your paper-autopilot job: ' + e.message, true); return; }
  const st = paperAutopilotState(Boolean(np.armed), row);
  btn.setAttribute('data-np', st.action);
  btn.textContent = st.label;
  npSay(st.say, st.bad);
  const pill = Array.from(host.querySelectorAll('.pill')).find((el) => /^autopilot (on|off)$/.test(el.textContent));
  if (pill) { pill.textContent = st.pill; pill.className = 'pill' + (st.running ? ' ok' : ''); }
}

/**
 * @description Write one progress line under the control.
 * @param {string} text - Message.
 * @param {boolean} [bad] - Whether it is a refusal.
 * @returns {void}
 */
function npSay(text, bad) {
  const el = $('npMsg'); if (el) { el.className = 'sub ' + (bad ? 'err' : 'ok'); el.textContent = text; }
}

/**
 * @description Arm the paper book, then activate the person's own schedule.
 * @returns {Promise<void>}
 */
async function nativePaperStart() {
  const np = STATUS.nativePaper || {};
  npSay('Arming your paper book…');
  let armed;
  try { armed = await api('/paper/arm', jbody('POST', np.opened ? {} : paperArmBody())); }
  catch (e) { npSay('Arming refused: ' + e.message, true); return; }
  try {
    const row = await paperScheduleRow(armed.schedule || np.schedule);
    if (row && !paperScheduleActive(row)) await paperKernel('/api/v1/agent/schedules/' + encodeURIComponent(row.id) + '/activate', { method: 'POST', body: JSON.stringify(PAPER_ACTIVATION) });
  } catch (e) { npSay('Armed, but the schedule could not be activated: ' + e.message, true); return; }
  // The repainted header reads the job again and says whether the book is now scheduled (or why not).
  RENDER_TOKEN += 1; render();
}

/**
 * @description Disarm the paper book, then withdraw the person's own schedule activation.
 * @returns {Promise<void>}
 */
async function nativePaperStop() {
  const np = STATUS.nativePaper || {};
  try { await api('/paper/disarm', jbody('POST', {})); }
  catch (e) { npSay('Stopping refused: ' + e.message, true); return; }
  try {
    const row = await paperScheduleRow(np.schedule);
    if (row && paperScheduleActive(row)) await paperKernel('/api/v1/agent/schedules/' + encodeURIComponent(row.id) + '/deactivate', { method: 'POST', body: '{}' });
  } catch (e) { npSay('Disarmed (the tick now refuses), but the schedule could not be withdrawn: ' + e.message, true); return; }
  RENDER_TOKEN += 1; render();
}

/**
 * @description Wire the native paper buttons inside a host element (delegated; CSP allows no handler attributes).
 * @param {HTMLElement|null} host - Element containing data-np buttons.
 * @returns {void}
 */
function wireNativePaper(host) {
  if (!host) return;
  if (host.querySelector && host.querySelector('#npBtn')) nativePaperSync(host);
  host.addEventListener('click', (e) => {
    const el = e.target.closest('[data-np]');
    if (!el || !host.contains(el)) return;
    e.preventDefault();
    if (el.getAttribute('data-np') === 'start') nativePaperStart(); else nativePaperStop();
  });
}

/** One keeper pass at a time; a refused activation stops the keeper until the page is opened again. */
const PAPER_KEEPER = { busy: false, refused: null };

/**
 * @description Whether the person has an armed paper account: the reference book or any named one not archived.
 * @param {object} read - GET /api/trading/paper/books.
 * @returns {boolean} Armed.
 */
function paperAnyArmed(read) {
  const named = (read && read.accounts) || [];
  return Boolean(read && read.reference && read.reference.config && read.reference.config.armed)
    || named.some((b) => !(b.archived === true || b.archived === 't') && b.config && b.config.armed);
}

/**
 * @description Activate the person's paper-autopilot job in their own session when an armed account needs it.
 * Arming is the person's decision to paper trade (on the page or by asking the concierge); the job is what makes
 * an armed account trade, so the page completes it the way Start does. Nothing here reaches a broker.
 * @returns {Promise<string>} What the pass did: 'idle', 'active', 'activated' or 'refused'.
 */
async function paperScheduleKeep() {
  if (PAPER_KEEPER.busy || PAPER_KEEPER.refused) return PAPER_KEEPER.refused ? 'refused' : 'idle';
  PAPER_KEEPER.busy = true;
  try {
    const read = await api('/paper/books');
    if (!paperAnyArmed(read)) return 'idle';
    const row = await paperScheduleRow((read.paperSchedule && read.paperSchedule.name) ? read.paperSchedule : { app: 'intelligent-trades', name: 'paper-autopilot' });
    if (!row) return 'idle';
    if (paperScheduleActive(row)) return 'active';
    try {
      await paperKernel('/api/v1/agent/schedules/' + encodeURIComponent(row.id) + '/activate', { method: 'POST',
        body: JSON.stringify({ ...PAPER_ACTIVATION, configuration: { ...PAPER_ACTIVATION.configuration, timeoutMs: 120000 } }) });
    } catch (e) { PAPER_KEEPER.refused = e.message || 'refused'; return 'refused'; }
    return 'activated';
  } catch { return 'idle'; } finally { PAPER_KEEPER.busy = false; }
}

/**
 * @description Run the keeper now and every minute while the page is visible.
 * @returns {void}
 */
function startPaperScheduleKeeper() {
  const pass = () => { if (!document.hidden) paperScheduleKeep(); };
  pass();
  setInterval(pass, 60000);
  document.addEventListener('visibilitychange', pass);
}
