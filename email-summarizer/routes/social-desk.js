/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com    | The Social desk routes (Roger, 2026-10-30: Intelligent Communication's Social tab was one profile card; he asked for a publisher's tools a casual person can use to post or stream to two or three services, Slack included). Mounted at /api/email-social: the desk page; the person's channels and who each account is; the Slack channel list; the posting plan; posts (draft, add to the queue's next slot, schedule, post now, edit, delete, retry); the due-post pass the person's social-publish job runs; Engage (Slack DMs and mentions, X mentions, reply); Go Live events whose announcements are posts. Every publish goes out through social-channels on the person's own connection; a request stays inside the kernel's 60 s call (channels in parallel, 12 s each; the due pass stops at 45 s and the next pass continues).
 */
'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.createSocialDeskRoutes = createSocialDeskRoutes;
exports.normalizePostInput = normalizePostInput;
exports.publishPost = publishPost;
exports.RUN_BUDGET_MS = 45000;
const express = require('express');
const path = require('path');
const logger_1 = require('@/shared/logger');
const store = require('./social-store.js');
const channels = require('./social-channels.js');
const logger = (0, logger_1.createChildLogger)({ module: 'email-social-desk' });

/** The event destinations the Go Live planner offers: where a person streams, with the page that starts a stream there. */
const DESTINATIONS = Object.freeze([
  { id: 'youtube', label: 'YouTube', console: 'https://studio.youtube.com/channel/UC/livestreaming' },
  { id: 'twitch', label: 'Twitch', console: 'https://dashboard.twitch.tv/stream-manager' },
  { id: 'facebook-live', label: 'Facebook Live', console: 'https://www.facebook.com/live/producer/' },
  { id: 'kick', label: 'Kick', console: 'https://kick.com/dashboard/stream' },
  { id: 'linkedin-live', label: 'LinkedIn Live', console: 'https://www.linkedin.com/video/golive/' },
  { id: 'tiktok-live', label: 'TikTok LIVE', console: 'https://livecenter.tiktok.com/' },
]);
exports.DESTINATIONS = DESTINATIONS;

/** The authenticated caller's subject, or null. */
function callerSub(req) {
  const u = req.oidc?.user;
  return u?.sub ? String(u.sub) : null;
}

/** Serve a static page from the package tools directory. */
function servePage(dir, file) {
  return (_req, res) => {
    res.sendFile(path.join(dir, file), (err) => {
      if (err) {
        logger.error({ err, file }, 'Social desk page failed to serve');
        if (!res.headersSent) res.status(500).send('Surface unavailable');
      }
    });
  };
}

/** A valid https media link, or nothing. */
function mediaLink(value) {
  const s = store.bounded(value, 1000).trim();
  return /^https:\/\/[^\s]+$/i.test(s) ? s : '';
}

/**
 * @description Normalize what the composer (or the communications bot) sends into a post: bounded text, known channels,
 * per-channel variants inside each channel's cap, a media link and when it goes out.
 * @param {object} body - The request body: text, channels, variants, mediaUrl, when ('now' | 'queue' | 'draft' | ISO), eventId.
 * @param {number} [nowMs] - The clock.
 * @returns {{ok:true, post:object, when:string}|{ok:false, code:number, error:string, message:string}} The normalized post or a refusal.
 */
function normalizePostInput(body, nowMs = Date.now()) {
  const src = body && typeof body === 'object' ? body : {};
  const text = store.bounded(src.text, 65000).trim();
  const ids = [...new Set((Array.isArray(src.channels) ? src.channels : []).map(String))].filter((id) => channels.channelById(id));
  const variants = {};
  const raw = src.variants && typeof src.variants === 'object' ? src.variants : {};
  for (const id of ids) {
    const v = store.bounded(raw[id], 65000).trim();
    if (v && v !== text) variants[id] = v;
  }
  const when = String(src.when || 'queue');
  const draft = when === 'draft';
  if (!draft) {
    if (!ids.length) return { ok: false, code: 400, error: 'no_channels', message: 'Pick at least one channel.' };
    for (const id of ids) {
      const t = variants[id] || text;
      if (!t) return { ok: false, code: 400, error: 'empty', message: 'Write something to post.' };
      const c = channels.channelById(id);
      if (t.length > c.limit) return { ok: false, code: 400, error: 'too_long', channel: id, message: `${c.label} allows ${c.limit} characters; this is ${t.length}.` };
    }
  }
  let scheduledAt = null;
  if (!['now', 'queue', 'draft'].includes(when)) {
    const t = Date.parse(when);
    if (!Number.isFinite(t)) return { ok: false, code: 400, error: 'bad_time', message: 'The time to post is not a date.' };
    if (t < nowMs - 60000) return { ok: false, code: 400, error: 'past', message: 'That time has already passed; choose Post now or a later time.' };
    scheduledAt = new Date(Math.max(t, nowMs)).toISOString();
  }
  const post = { id: store.newId('post'), status: draft ? 'draft' : scheduledAt ? 'scheduled' : when === 'now' ? 'sending' : 'scheduled', text, variants, channels: ids, mediaUrl: mediaLink(src.mediaUrl), eventId: store.bounded(src.eventId, 64), scheduledAt };
  return { ok: true, post, when };
}

/**
 * @description Publish a post to every channel it names that has not already succeeded, in parallel, and record the
 * per-channel outcome and the resulting status (sent, partial or failed).
 * @param {{query:Function}} db - The admitted pool.
 * @param {string} sub - The owner.
 * @param {object} post - The post.
 * @param {object} settings - The owner's settings (the Slack channel).
 * @returns {Promise<object>} The post with its outcomes.
 */
async function publishPost(db, sub, post, settings) {
  const outcomes = { ...(post.outcomes || {}) };
  const pending = post.channels.filter((c) => !(outcomes[c] && outcomes[c].ok));
  await store.updatePost(db, sub, post.id, { status: 'sending' });
  const results = await Promise.all(pending.map(async (c) => {
    const text = (post.variants && post.variants[c]) || post.text;
    try {
      return [c, await channels.publish(c, text, { slackChannel: settings.slackChannel })];
    } catch (err) {
      logger.error({ err, stack: err?.stack, postId: post.id, channel: c }, 'publish failed');
      return [c, { ok: false, code: 502, error: 'failed', message: String(err?.message || err).slice(0, 200) }];
    }
  }));
  const at = new Date().toISOString();
  for (const [c, r] of results) outcomes[c] = { ...r, at };
  const okCount = post.channels.filter((c) => outcomes[c]?.ok).length;
  const status = okCount === post.channels.length ? 'sent' : okCount ? 'partial' : 'failed';
  await store.updatePost(db, sub, post.id, { status, outcomes, sentAt: okCount ? at : null });
  return { ...post, status, outcomes, sentAt: okCount ? at : null };
}

/** Answer a store or provider failure as JSON, logged. */
function fail(res, err, what) {
  logger.error({ err, stack: err?.stack }, what);
  res.status(502).json({ error: 'failed', message: String(err?.message || err).slice(0, 300) });
}

/** The slot the queue gives a new post, or a refusal when the plan has none. */
async function queueSlot(db, sub, settings, nowMs) {
  const taken = (await store.listPosts(db, sub, 'scheduled')).map((p) => p.scheduledAt).filter(Boolean);
  return store.nextSlot(settings.plan, nowMs, taken, settings.timezone || 'UTC');
}

/** The channel rail: every channel's state, and who the account is when asked. */
function channelsRoute(ctx) {
  return async (req, res) => {
    const sub = callerSub(req);
    if (!sub) return res.status(401).json({ error: 'not_authenticated' });
    const meta = await channels.readConnections(ctx);
    const wantIdentity = String(req.query?.identity || '') === '1';
    const settings = await store.readSettings(ctx.pool, sub).catch(() => ({ slackChannel: '', slackLabel: '' }));
    const rows = await Promise.all(channels.CHANNELS.map(async (c) => {
      const state = channels.channelState(meta, c);
      const row = { id: c.id, label: c.label, limit: c.limit, kind: c.kind, color: c.color, connect: c.connect, console: c.console, state };
      if (c.id === 'slack') { row.slackChannel = settings.slackChannel; row.slackLabel = settings.slackLabel; }
      if (wantIdentity && channels.kernelEgress() && (state === 'connected' || state === 'unknown')) {
        const who = await channels.identity(c.id).catch((err) => ({ ok: false, message: String(err?.message || err) }));
        if (who.ok) { row.account = { name: who.name, handle: who.handle, avatar: who.avatar, accountId: who.accountId }; row.state = 'connected'; }
        else if (who.code === 409) row.state = state === 'unknown' ? 'none' : 'reconnect';
        else row.note = who.message || '';
      }
      return row;
    }));
    res.json({ native: channels.kernelEgress(), channels: rows, destinations: DESTINATIONS });
  };
}

/** Create a post: draft, next queue slot, a chosen time, or post now. */
function createPostRoute(ctx) {
  return async (req, res) => {
    const sub = callerSub(req);
    if (!sub) return res.status(401).json({ error: 'not_authenticated' });
    const n = normalizePostInput(req.body);
    if (!n.ok) return res.status(n.code).json(n);
    try {
      const settings = await store.readSettings(ctx.pool, sub);
      if (n.when === 'queue') {
        n.post.scheduledAt = await queueSlot(ctx.pool, sub, settings, Date.now());
        if (!n.post.scheduledAt) return res.status(400).json({ error: 'no_slot', message: 'Your posting plan has no free time in the next three weeks; add a time in Settings.' });
      }
      await store.insertPost(ctx.pool, sub, n.post);
      if (n.when !== 'now') return res.status(201).json({ post: { ...n.post, outcomes: {} } });
      const sent = await publishPost(ctx.pool, sub, { ...n.post, outcomes: {} }, settings);
      res.status(sent.status === 'sent' ? 201 : 207).json({ post: sent, ok: sent.status === 'sent' });
    } catch (err) {
      fail(res, err, 'create post failed');
    }
  };
}

/** Edit a post that has not gone out (text, channels, variants, media, when). */
function patchPostRoute(ctx) {
  return async (req, res) => {
    const sub = callerSub(req);
    if (!sub) return res.status(401).json({ error: 'not_authenticated' });
    try {
      const post = await store.readPost(ctx.pool, sub, String(req.params.id));
      if (!post) return res.status(404).json({ error: 'not_found' });
      if (post.status === 'sending' || post.status === 'sent') return res.status(409).json({ error: 'already_sent', message: 'This post already went out.' });
      const merged = { text: post.text, channels: post.channels, variants: post.variants, mediaUrl: post.mediaUrl, when: 'draft', ...req.body };
      if (merged.when === 'now') merged.when = 'draft';
      const n = normalizePostInput(merged);
      if (!n.ok) return res.status(n.code).json(n);
      const settings = await store.readSettings(ctx.pool, sub);
      const patch = { text: n.post.text, channels: n.post.channels, variants: n.post.variants, mediaUrl: n.post.mediaUrl, outcomes: {} };
      if (n.when === 'queue') {
        patch.scheduledAt = await queueSlot(ctx.pool, sub, settings, Date.now());
        if (!patch.scheduledAt) return res.status(400).json({ error: 'no_slot', message: 'Your posting plan has no free time in the next three weeks; add a time in Settings.' });
        patch.status = 'scheduled';
      } else if (n.when === 'draft') { patch.status = 'draft'; patch.scheduledAt = null; } else { patch.status = 'scheduled'; patch.scheduledAt = n.post.scheduledAt; }
      await store.updatePost(ctx.pool, sub, post.id, patch);
      res.json({ post: await store.readPost(ctx.pool, sub, post.id) });
    } catch (err) {
      fail(res, err, 'edit post failed');
    }
  };
}

/** Post now: a draft, a scheduled post ahead of its time, or a failed one again. */
function publishNowRoute(ctx) {
  return async (req, res) => {
    const sub = callerSub(req);
    if (!sub) return res.status(401).json({ error: 'not_authenticated' });
    try {
      const post = await store.readPost(ctx.pool, sub, String(req.params.id));
      if (!post) return res.status(404).json({ error: 'not_found' });
      if (post.status === 'sent' || post.status === 'sending') return res.status(409).json({ error: 'already_sent', message: 'This post already went out.' });
      if (!post.channels.length) return res.status(400).json({ error: 'no_channels', message: 'Pick at least one channel.' });
      const sent = await publishPost(ctx.pool, sub, post, await store.readSettings(ctx.pool, sub));
      res.status(sent.status === 'sent' ? 200 : 207).json({ post: sent, ok: sent.status === 'sent' });
    } catch (err) {
      fail(res, err, 'publish now failed');
    }
  };
}

/** The due pass the person's social-publish job runs: send what is due, inside the budget, and say what remains. */
function runDueRoute(ctx) {
  return async (req, res) => {
    const sub = callerSub(req);
    if (!sub) return res.status(401).json({ error: 'not_authenticated' });
    const started = Date.now();
    const tally = { sent: 0, partial: 0, failed: 0, remaining: 0 };
    try {
      const settings = await store.readSettings(ctx.pool, sub);
      const due = await store.duePosts(ctx.pool, sub, new Date(started).toISOString());
      for (const post of due) {
        if (Date.now() - started > exports.RUN_BUDGET_MS) { tally.remaining += 1; continue; }
        const r = await publishPost(ctx.pool, sub, post, settings);
        tally[r.status] = (tally[r.status] || 0) + 1;
      }
      res.json({ ...tally, ranMs: Date.now() - started });
    } catch (err) {
      fail(res, err, 'due pass failed');
    }
  };
}

/** Engage: Slack DMs and mentions plus X mentions, each best-effort, newest first. */
function engageRoute(ctx) {
  return async (req, res) => {
    const sub = callerSub(req);
    if (!sub) return res.status(401).json({ error: 'not_authenticated' });
    const meta = await channels.readConnections(ctx);
    const sources = {};
    const read = async (id, reader) => {
      const c = channels.channelById(id);
      const state = channels.channelState(meta, c);
      if (!channels.kernelEgress() || state === 'none' || state === 'reconnect') { sources[id] = { state, items: [] }; return []; }
      const r = await reader().catch((err) => ({ ok: false, message: String(err?.message || err) }));
      sources[id] = { state: r.ok ? 'connected' : (r.code === 409 ? 'none' : state), message: r.ok ? '' : (r.message || '') };
      return r.ok ? r.items : [];
    };
    const [slack, x] = await Promise.all([read('slack', channels.slackInbox), read('x', channels.xMentions)]);
    const items = [...slack, ...x].sort((p, q) => Date.parse(q.at || 0) - Date.parse(p.at || 0)).slice(0, 60);
    res.json({ items, sources });
  };
}

/** Reply to an Engage row on its own channel. */
function replyRoute() {
  return async (req, res) => {
    const sub = callerSub(req);
    if (!sub) return res.status(401).json({ error: 'not_authenticated' });
    const b = req.body || {};
    const id = String(b.channel || '');
    const to = b.replyTo && typeof b.replyTo === 'object' ? b.replyTo : {};
    if (!['slack', 'x'].includes(id)) return res.status(400).json({ error: 'bad_channel', message: 'Replies go to Slack or X.' });
    try {
      const r = await channels.publish(id, store.bounded(b.text, 4000).trim(), { slackChannel: to.channelId, replyTo: to });
      res.status(r.ok ? 200 : (r.code || 502)).json(r);
    } catch (err) {
      fail(res, err, 'reply failed');
    }
  };
}

/** The announcement posts of a Go Live event: each with channels and text, now or at its time. */
async function announce(ctx, sub, settings, eventId, list, nowMs) {
  const posts = [];
  for (const a of (Array.isArray(list) ? list : []).slice(0, 6)) {
    const at = Date.parse(a?.at || '');
    const when = Number.isFinite(at) && at > nowMs + 60000 ? new Date(at).toISOString() : 'now';
    const n = normalizePostInput({ text: a?.text, channels: a?.channels, when, eventId });
    if (!n.ok) continue;
    await store.insertPost(ctx.pool, sub, n.post);
    posts.push(when === 'now' ? await publishPost(ctx.pool, sub, { ...n.post, outcomes: {} }, settings) : { ...n.post, outcomes: {} });
  }
  return posts;
}

/** Create a Go Live event with its announcements. */
function createEventRoute(ctx) {
  return async (req, res) => {
    const sub = callerSub(req);
    if (!sub) return res.status(401).json({ error: 'not_authenticated' });
    const b = req.body || {};
    const title = store.bounded(b.title, 200).trim();
    const startAt = Date.parse(b.startAt || '');
    if (!title) return res.status(400).json({ error: 'no_title', message: 'Give the stream a title.' });
    if (!Number.isFinite(startAt)) return res.status(400).json({ error: 'bad_time', message: 'When does it start?' });
    const destinations = [...new Set((Array.isArray(b.destinations) ? b.destinations : []).map(String))].filter((d) => DESTINATIONS.some((x) => x.id === d));
    const ev = { id: store.newId('live'), title, description: store.bounded(b.description, 2000).trim(), startAt: new Date(startAt).toISOString(), destinations, watchUrl: mediaLink(b.watchUrl) };
    try {
      await store.insertEvent(ctx.pool, sub, ev);
      const posts = await announce(ctx, sub, await store.readSettings(ctx.pool, sub), ev.id, b.announcements, Date.now());
      res.status(201).json({ event: { ...ev, status: 'planned' }, posts });
    } catch (err) {
      fail(res, err, 'create event failed');
    }
  };
}

/**
 * @description Build the Social desk router. The manifest mounts it at /api/email-social (auth: oidc, requiresContext).
 * @param {object} ctx - The application context: pool (admitted SQL), intent (connectors.metadata), appPackageDir.
 * @returns {object} The router.
 */
function createSocialDeskRoutes(ctx) {
  const router = express.Router();
  const assetRoot = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.join(__dirname, '..', 'tools');
  const auth = (handler) => async (req, res) => {
    const sub = callerSub(req);
    if (!sub) return res.status(401).json({ error: 'not_authenticated' });
    try { await handler(sub, req, res); } catch (err) { fail(res, err, 'social desk request failed'); }
  };
  router.get('/', servePage(assetRoot, 'email-social.html'));
  router.get('/channels', channelsRoute(ctx));
  router.get('/slack/channels', auth(async (_sub, _req, res) => {
    if (!channels.kernelEgress()) return res.status(501).json({ error: 'native_only', message: 'The Social desk runs on the native kernel.' });
    const r = await channels.slackChannels();
    res.status(r.ok ? 200 : (r.code || 502)).json(r);
  }));
  router.get('/settings', auth(async (sub, _req, res) => res.json(await store.readSettings(ctx.pool, sub))));
  router.put('/settings', auth(async (sub, req, res) => res.json(await store.writeSettings(ctx.pool, sub, req.body || {}))));
  router.get('/posts', auth(async (sub, req, res) => res.json({ posts: await store.listPosts(ctx.pool, sub, req.query?.status ? String(req.query.status) : undefined) })));
  router.post('/posts', createPostRoute(ctx));
  router.patch('/posts/:id', patchPostRoute(ctx));
  router.delete('/posts/:id', auth(async (sub, req, res) => res.status((await store.deletePost(ctx.pool, sub, String(req.params.id))) ? 200 : 404).json({ ok: true })));
  router.post('/posts/:id/publish', publishNowRoute(ctx));
  router.post('/run-due', runDueRoute(ctx));
  router.get('/engage', engageRoute(ctx));
  router.post('/engage/reply', replyRoute());
  router.get('/events', auth(async (sub, _req, res) => {
    const [events, posts] = await Promise.all([store.listEvents(ctx.pool, sub), store.listPosts(ctx.pool, sub)]);
    res.json({ events: events.map((e) => ({ ...e, posts: posts.filter((p) => p.eventId === e.id) })), destinations: DESTINATIONS });
  }));
  router.post('/events', createEventRoute(ctx));
  router.delete('/events/:id', auth(async (sub, req, res) => res.status((await store.deleteEvent(ctx.pool, sub, String(req.params.id))) ? 200 : 404).json({ ok: true })));
  return router;
}
