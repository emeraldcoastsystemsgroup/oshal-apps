/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.13.0 (T79, the device inventory; Roger, 2026-11-12: "when you add a device and that device gives the swarm control it runs discovery on the device ... so then there is a device inventory with how it can integrate, what is available over each integration and what you can get to"): What a TV can play is kept where Jarvis and the Devices page read it. POST /devices/:id/apps/record (tool phone-control-tv-apps-record) takes the one JSON line the TV's computer printed for What a TV can play, checks it (the bridge's tv_apps answer, its apps through the same closed list, a count of the others, the model and maker when they are plain names), records it against the TV, and hands the kernel's device.inventory.record, as the person, what was found: the TV (by its saved id, name and type: a Fire TV when its model or name says so, else an Android TV), its ADB route through the person's own computer that carries it and that it worked now, that its applications can be listed, the applications found with the services they reach, the seven it looked for and how many others it saw. A failed read records the route as down (the TV did not answer) or refused, with the bridge's words, and changes nothing else. A kernel without the intent, or one that refuses it, is said in words beside the applications, which are answered either way.
 */

'use strict';

/** The apps the bridge's tv_apps looks for, in its order (oshal_phone_apps.KNOWN_APPS), and the service each reaches. */
const LOOKED_FOR = Object.freeze(['netflix', 'prime', 'disney', 'max', 'hulu', 'youtube', 'oshal']);
const SERVICES = Object.freeze({
  netflix: ['netflix'], prime: ['prime-video'], disney: ['disney-plus'], max: ['max'], hulu: ['hulu'], youtube: ['youtube'], oshal: ['oshal']
});
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,63}$/;
const MAX_REPLY = 16384;
const MAX_OTHERS = 1000000;

/**
 * @description The bridge's answer from what Jarvis or the page sent: the object, a run result's stdout, or the line.
 * @param {unknown} value The answer as sent.
 * @returns {object|null} The bridge's answer, or null when there is none.
 */
function readReply(value) {
  if (value && typeof value === 'object') {
    const out = value.output?.stdout ?? value.result?.stdout ?? value.stdout;
    if (typeof out === 'string') return readReply(out);
    return typeof value.ok === 'boolean' ? value : null;
  }
  if (typeof value !== 'string' || value.length > MAX_REPLY) return null;
  for (const line of value.trim().split('\n').reverse()) {
    let parsed = null;
    try { parsed = JSON.parse(line.trim()); } catch { /* not the bridge's line */ }
    const found = parsed && typeof parsed === 'object' ? readReply(parsed) : null;
    if (found) return found;
  }
  return null;
}

/**
 * @description The tv_apps answer, checked: the apps through the closed list (each once), the others counted, the model
 *   and maker only as plain names; a failed read keeps the bridge's code and words.
 * @param {object} store The store module (for its refusal).
 * @param {object|null} reply The bridge's answer.
 * @returns {object} The checked answer.
 */
function tvAppsAnswer(store, reply) {
  if (!reply) throw store.refusal(400, 'reply_required', 'Pass reply: the one JSON line the TV\'s computer printed for What a TV can play.');
  if (reply.ok !== true) {
    return { ok: false, error: String(reply.error || 'bridge_failed').slice(0, 40), message: String(reply.message || '').slice(0, 300) };
  }
  if (reply.action !== 'tv_apps' || !Array.isArray(reply.apps)) {
    throw store.refusal(400, 'reply_invalid', 'That is not the answer of What a TV can play: it has no list of the TV\'s apps.');
  }
  const apps = [];
  for (const app of reply.apps.slice(0, 32)) {
    const key = String(app?.key || '');
    if (!LOOKED_FOR.includes(key) || apps.some((held) => held.key === key)) continue;
    const name = String(app.name || key).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) || key;
    apps.push({ key, name, package: PACKAGE.test(String(app.package || '')) ? String(app.package) : '' });
  }
  const others = Number.isInteger(reply.unknownCount) && reply.unknownCount >= 0 ? Math.min(reply.unknownCount, MAX_OTHERS) : null;
  const plain = (value) => (PLAIN.test(String(value || '')) ? String(value) : '');
  return { ok: true, apps, others, model: plain(reply.model), maker: plain(reply.maker) };
}

/**
 * @description The TV's type on the ladder, never guessed: a Fire TV by its model (AFT...) or its name, an Android TV
 *   by another model it reported, else only a TV (the kernel keeps a more exact type it was told before).
 * @param {object} device The saved TV. @param {object} answer The checked answer.
 * @returns {string} Its type.
 */
function tvKind(device, answer) {
  if (/^AFT/i.test(answer.model || '') || /\b(fire|aft\w*)\b/i.test(String(device.name || ''))) return 'fire-tv';
  return answer.model ? 'android-tv' : 'tv';
}

/**
 * @description What the kernel's device.inventory.record is told after a read of the TV's apps.
 * @param {object} device The saved TV. @param {object} answer The checked answer.
 * @returns {object} The device report.
 */
function inventoryReport(device, answer) {
  const identity = {};
  if (answer.model) identity.model = answer.model;
  if (answer.maker) identity.maker = answer.maker;
  const report = { key: device.id, name: String(device.name || 'TV').slice(0, 80), kind: tvKind(device, answer) };
  if (Object.keys(identity).length) report.identity = identity;
  if (!answer.ok) {
    const state = answer.error === 'not_connected' ? 'down' : 'refused';
    const detail = (answer.message || answer.error).slice(0, 160);
    return { ...report, routes: [{ kind: 'adb', via: device.computerNodeId, state, detail }] };
  }
  return {
    ...report,
    routes: [{ kind: 'adb', via: device.computerNodeId, state: 'up', worked: true }],
    components: [{ kind: 'applications', capabilities: [{ name: 'list', can: 'yes', worked: true }] }],
    apps: answer.apps.map((app) => ({
      key: app.key, name: app.name, ...(app.package ? { package: app.package } : {}), route: 'adb', services: SERVICES[app.key]
    })),
    looked_for: LOOKED_FOR.slice(),
    ...(answer.others === null ? {} : { others: answer.others }),
    read_over: 'adb'
  };
}

/**
 * @description Hand the report to the kernel's inventory as the person; never fails the answer.
 * @param {object} ctx The package context. @param {object} report The device report.
 * @returns {Promise<object>} Whether it was recorded, with the record's id or the kernel's words.
 */
async function recordInventory(ctx, report) {
  if (!ctx || typeof ctx.intent !== 'function') return { recorded: false, reason: 'This installation keeps no device inventory yet.' };
  try {
    const kept = await ctx.intent('device.inventory.record', report);
    return { recorded: true, id: kept && typeof kept.id === 'string' ? kept.id : null };
  } catch (error) {
    return { recorded: false, reason: String(error && error.message ? error.message : error).slice(0, 300) };
  }
}

/**
 * @description Record what the TV's computer answered for What a TV can play, against the TV and in the inventory.
 * @param {object} env { store, db, owner, ctx }. @param {object} device The saved TV. @param {object} body { reply }.
 * @returns {Promise<object>} The applications found, the ones not found and whether the inventory kept them.
 */
async function recordTvApps(env, device, body) {
  const { store, db, owner, ctx } = env;
  if (device.platform !== 'android' || device.form !== 'tv') {
    throw store.refusal(400, 'not_android_tv', 'What a TV can play is recorded for a saved Android or Fire TV.');
  }
  const answer = tvAppsAnswer(store, readReply(body.reply));
  const summary = answer.ok ? `${answer.apps.length} streaming apps found` : `the read failed: ${answer.error}`;
  store.recordHistory(db, owner, {
    computerNodeId: device.computerNodeId, phoneId: device.id, action: 'tv_apps_recorded', summary, ok: answer.ok, exitCode: answer.ok ? 0 : 1
  });
  const inventory = await recordInventory(ctx, inventoryReport(device, answer));
  const notFound = answer.ok ? LOOKED_FOR.filter((key) => !answer.apps.some((app) => app.key === key)) : [];
  return {
    ok: answer.ok, device: { id: device.id, name: device.name, platform: device.platform, form: device.form },
    apps: answer.ok ? answer.apps : [], notFound, unknownCount: answer.ok ? answer.others : null,
    model: answer.model || null, maker: answer.maker || null,
    ...(answer.ok ? {} : { error: answer.error, message: answer.message }), inventory
  };
}

/**
 * @description Mount POST /devices/:id/apps/record.
 * @param {object} router The router. @param {object} env { store, db, ctx, resolveDevice, refuse }.
 * @returns {void}
 */
function mountInventory(router, env) {
  const { store, db, ctx, resolveDevice, refuse } = env;
  router.post('/devices/:id/apps/record', async (req, res) => {
    const device = resolveDevice(store, db, req.owner, req.params.id);
    if (!device) return res.status(404).json({ error: 'device_not_found' });
    try {
      return res.json(await recordTvApps({ store, db, owner: req.owner, ctx }, device, req.body || {}));
    } catch (error) {
      return refuse(res, error);
    }
  });
}

module.exports = { mountInventory, readReply, tvAppsAnswer, inventoryReport, recordTvApps, LOOKED_FOR, SERVICES };
