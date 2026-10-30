/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com    | The channels a person can publish to from Intelligent Communication (Roger, 2026-10-30: X, LinkedIn, a Facebook Page, Slack, and Mastodon where an installation offers it), each through the native kernel's egress on the person's own connection: the package sends no credential, the kernel applies it. Who the account is (name, handle, picture), one publish per channel with the channel's own length cap, the Slack channel list, the Engage reads (Slack DMs and mentions, X mentions) and replies. Every provider call is bounded so a desk request stays inside the kernel's 60 s package call.
 */
'use strict';
Object.defineProperty(exports, '__esModule', { value: true });

/** The headers the kernel egress forwards; anything else (above all Authorization) is the kernel's to apply. */
const PACKAGE_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'if-none-match', 'if-modified-since', 'x-requested-with', 'cache-control', 'range']);
/** One provider call may not take longer than this; the kernel's own egress cap is 20 s. */
exports.CALL_TIMEOUT_MS = 12000;
const GRAPH = `https://graph.facebook.com/${process.env.FACEBOOK_API_VERSION || 'v21.0'}`;
const SLACK = 'https://slack.com/api';
const X = 'https://api.twitter.com/2';
const LINKEDIN = 'https://api.linkedin.com';
const MASTODON = 'https://mastodon.social/api/v1';

/**
 * The publish channels, in the order the desk shows them. `connectors` are the kernel connection ids that carry the
 * grant; `connect` is the id the Connections page starts; `limit` is the channel's own character cap.
 */
exports.CHANNELS = Object.freeze([
  { id: 'x', label: 'X', connectors: ['twitter', 'x'], connect: 'twitter', limit: 280, kind: 'social', color: '#000000', console: 'https://x.com/compose/post' },
  { id: 'linkedin', label: 'LinkedIn', connectors: ['linkedin'], connect: 'linkedin', limit: 3000, kind: 'social', color: '#0a66c2', console: 'https://www.linkedin.com/feed/' },
  { id: 'facebook', label: 'Facebook Page', connectors: ['facebook', 'meta-business'], connect: 'facebook', limit: 63206, kind: 'social', color: '#1877f2', console: 'https://www.facebook.com/' },
  { id: 'slack', label: 'Slack', connectors: ['slack'], connect: 'slack', limit: 4000, kind: 'chat', color: '#4a154b', console: 'https://slack.com/' },
  { id: 'mastodon', label: 'Mastodon', connectors: ['mastodon'], connect: 'mastodon', limit: 500, kind: 'social', color: '#6364ff', console: 'https://mastodon.social/' },
]);

/**
 * @description One channel's definition by id.
 * @param {string} id - The channel id.
 * @returns {object|null} The definition or null.
 */
function channelById(id) {
  return exports.CHANNELS.find((c) => c.id === id) || null;
}
exports.channelById = channelById;

/**
 * @description Is this process the native kernel's package host? Only there does a fetch carry the person's grant.
 * @returns {boolean} True under OSHAL_EGRESS=kernel.
 */
function kernelEgress() {
  return process.env.OSHAL_EGRESS === 'kernel';
}
exports.kernelEgress = kernelEgress;

/**
 * @description The kernel's "that connection is not saved" refusal, raised by the egress fetch itself.
 * @param {unknown} err - The thrown error.
 * @returns {boolean} True for a not-connected refusal.
 */
function isNotConnected(err) {
  return /not connected/i.test(String(err?.message || ''));
}
exports.isNotConnected = isNotConnected;

/**
 * @description Read the caller's saved connections (metadata only) from the kernel; null when the host cannot say.
 * @param {object} ctx - The application context carrying `intent`.
 * @returns {Promise<object|null>} The connectors.metadata answer or null.
 */
async function readConnections(ctx) {
  if (typeof ctx?.intent !== 'function') return null;
  try {
    const answer = await ctx.intent.call(ctx, 'connectors.metadata', {});
    return answer && typeof answer === 'object' ? answer : null;
  } catch (_) {
    return null;
  }
}
exports.readConnections = readConnections;

/**
 * @description A channel's connection state from the metadata: connected, reconnect (lapsed, nothing renews it), none,
 * or unknown (no metadata; the provider call decides).
 * @param {object|null} meta - The connectors.metadata answer.
 * @param {object} channel - The channel definition.
 * @param {number} [now] - The clock.
 * @returns {'connected'|'reconnect'|'none'|'unknown'} The state.
 */
function channelState(meta, channel, now = Date.now()) {
  if (!meta || !Array.isArray(meta.connections)) return 'unknown';
  const rows = meta.connections.filter((c) => channel.connectors.includes(String(c?.provider || '').toLowerCase()));
  if (!rows.length) return 'none';
  const usable = rows.some((c) => c.revoked !== true && (c.expires_at_ms == null || Number(c.expires_at_ms) > now || c.renewable === true));
  return usable ? 'connected' : 'reconnect';
}
exports.channelState = channelState;

/** A fetch whose headers are the forwardable ones only, bounded by CALL_TIMEOUT_MS. */
async function call(url, init = {}) {
  const headers = Object.fromEntries(Object.entries(init.headers || {}).filter(([n]) => PACKAGE_HEADERS.has(n.toLowerCase())));
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), exports.CALL_TIMEOUT_MS) : null;
  try {
    return await fetch(url, { ...init, headers, signal: controller ? controller.signal : undefined });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A JSON call: the parsed body with the status, or a refusal shape for a not-connected grant. */
async function callJson(url, init = {}) {
  let r;
  try {
    r = await call(url, init);
  } catch (err) {
    if (isNotConnected(err)) return { status: 409, notConnected: true, body: {} };
    if (err?.name === 'AbortError') return { status: 504, body: { error: 'timeout' } };
    throw err;
  }
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body, headers: r.headers };
}
exports.callJson = callJson;

const postJson = (url, body) => callJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
const getJson = (url) => callJson(url, { headers: { Accept: 'application/json' } });

/** The refusal a channel answers when the person has no usable grant for it. */
function notConnected(channel) {
  return { ok: false, code: 409, error: `no_${channel.id}_connection`, message: `Connect ${channel.label} first.` };
}

/** A provider refusal, bounded, with the status it came with. */
function rejected(channel, status, body) {
  const detail = body?.error?.message || body?.detail || body?.error || body?.title || body?.message || (typeof body === 'string' ? body : '');
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail || {});
  return { ok: false, code: status === 401 ? 409 : 502, status, error: `${channel.id}_rejected`, message: `${channel.label} answered ${status}${text ? `: ${text.slice(0, 200)}` : ''}` };
}

/**
 * @description Who the connected account is on one channel: name, handle, picture, provider id.
 * @param {string} id - The channel id.
 * @returns {Promise<{ok:boolean,name?:string,handle?:string,avatar?:string,accountId?:string,code?:number,message?:string}>} The identity.
 */
async function identity(id) {
  const channel = channelById(id);
  if (!channel) return { ok: false, code: 400, message: 'unknown channel' };
  const a = await IDENTITY[id]();
  if (a.notConnected) return { ok: false, ...notConnected(channel) };
  if (a.status < 200 || a.status >= 300 || a.body?.ok === false) return { ok: false, ...rejected(channel, a.status, a.body) };
  return { ok: true, ...a.identity };
}
exports.identity = identity;

const IDENTITY = {
  async x() {
    const a = await getJson(`${X}/users/me?user.fields=profile_image_url,username,name`);
    const d = a.body?.data || {};
    return { ...a, identity: { name: d.name || '', handle: d.username ? `@${d.username}` : '', avatar: String(d.profile_image_url || '').replace('_normal', '_bigger'), accountId: d.id || '' } };
  },
  async linkedin() {
    const a = await getJson(`${LINKEDIN}/v2/userinfo`);
    const d = a.body || {};
    return { ...a, identity: { name: d.name || [d.given_name, d.family_name].filter(Boolean).join(' '), handle: d.email || '', avatar: d.picture || '', accountId: d.sub || '' } };
  },
  async facebook() {
    const a = await getJson(`${GRAPH}/me?fields=id,name,picture.width(96).height(96)`);
    const d = a.body || {};
    return { ...a, identity: { name: d.name || '', handle: d.id ? `ID ${d.id}` : '', avatar: d.picture?.data?.url || '', accountId: d.id || '' } };
  },
  async slack() {
    const a = await getJson(`${SLACK}/auth.test`);
    const d = a.body || {};
    let avatar = '';
    if (d.ok && d.user_id) {
      const u = await getJson(`${SLACK}/users.info?user=${encodeURIComponent(d.user_id)}`);
      avatar = u.body?.user?.profile?.image_72 || '';
    }
    return { ...a, identity: { name: d.user || '', handle: d.team ? `${d.team} workspace` : '', avatar, accountId: d.user_id || '' } };
  },
  async mastodon() {
    const a = await getJson(`${MASTODON}/accounts/verify_credentials`);
    const d = a.body || {};
    return { ...a, identity: { name: d.display_name || d.username || '', handle: d.acct ? `@${d.acct}` : '', avatar: d.avatar_static || d.avatar || '', accountId: d.id || '' } };
  },
};

/**
 * @description Publish one text to one channel. The text is sent as written (no model in this path); a text over the
 * channel's cap is refused here, never trimmed.
 * @param {string} id - The channel id.
 * @param {string} text - The text to publish.
 * @param {{slackChannel?:string, replyTo?:object}} [opts] - The Slack channel to post in; a reply target.
 * @returns {Promise<{ok:boolean,id?:string,url?:string,code?:number,error?:string,message?:string}>} The outcome.
 */
async function publish(id, text, opts = {}) {
  const channel = channelById(id);
  if (!channel) return { ok: false, code: 400, error: 'unknown_channel', message: `No channel ${id}.` };
  const body = String(text || '');
  if (!body.trim()) return { ok: false, code: 400, error: 'empty', message: 'Nothing to post.' };
  if (body.length > channel.limit) return { ok: false, code: 400, error: 'too_long', message: `${channel.label} allows ${channel.limit} characters; this is ${body.length}.` };
  const a = await PUBLISH[id](body, opts, channel);
  if (a.ok !== undefined) return a;
  if (a.notConnected) return notConnected(channel);
  if (a.status < 200 || a.status >= 300 || a.body?.ok === false) return rejected(channel, a.status, a.body);
  return a.result;
}
exports.publish = publish;

const PUBLISH = {
  async x(text, opts) {
    const payload = { text };
    if (opts.replyTo?.tweetId) payload.reply = { in_reply_to_tweet_id: String(opts.replyTo.tweetId) };
    const a = await postJson(`${X}/tweets`, payload);
    const tweetId = a.body?.data?.id || '';
    return { ...a, result: { ok: true, id: tweetId, url: tweetId ? `https://x.com/i/web/status/${tweetId}` : '' } };
  },
  async linkedin(text) {
    const me = await getJson(`${LINKEDIN}/v2/userinfo`);
    if (me.notConnected || !me.body?.sub) return me.notConnected ? me : { status: me.status || 502, body: me.body };
    const a = await postJson(`${LINKEDIN}/v2/ugcPosts`, {
      author: `urn:li:person:${me.body.sub}`, lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    });
    const urn = (a.headers && typeof a.headers.get === 'function' && a.headers.get('x-restli-id')) || a.body?.id || '';
    return { ...a, result: { ok: true, id: urn, url: urn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/` : 'https://www.linkedin.com/feed/' } };
  },
  async facebook(text) {
    const pages = await getJson(`${GRAPH}/me/accounts?fields=id,name,access_token`);
    if (pages.notConnected || pages.status < 200 || pages.status >= 300) return pages;
    const page = (pages.body?.data || [])[0];
    if (!page) return { ok: false, code: 409, error: 'no_facebook_pages', message: 'This Facebook account manages no Page, or the connection lacks the Pages permissions (Meta app review).' };
    const a = await postJson(`${GRAPH}/${encodeURIComponent(page.id)}/feed`, { message: text, access_token: page.access_token });
    const postId = a.body?.id || '';
    return { ...a, result: { ok: true, id: postId, url: postId ? `https://www.facebook.com/${postId}` : '', page: page.name } };
  },
  async slack(text, opts, channel) {
    if (!opts.slackChannel) return { ok: false, code: 400, error: 'no_slack_channel', message: 'Choose the Slack channel to post in (Channels).' };
    const payload = { channel: opts.slackChannel, text };
    if (opts.replyTo?.ts) payload.thread_ts = String(opts.replyTo.ts);
    const a = await postJson(`${SLACK}/chat.postMessage`, payload);
    if (a.body?.ok === false) return { status: 502, body: { error: a.body.error }, notConnected: a.body.error === 'not_authed' || a.body.error === 'invalid_auth' };
    let url = '';
    if (a.body?.ok && a.body.ts) {
      const p = await getJson(`${SLACK}/chat.getPermalink?channel=${encodeURIComponent(a.body.channel || opts.slackChannel)}&message_ts=${encodeURIComponent(a.body.ts)}`);
      url = p.body?.permalink || '';
    }
    return { ...a, result: { ok: true, id: a.body?.ts || '', url, channel: channel.label } };
  },
  async mastodon(text) {
    const a = await postJson(`${MASTODON}/statuses`, { status: text });
    return { ...a, result: { ok: true, id: a.body?.id || '', url: a.body?.url || '' } };
  },
};

/**
 * @description The Slack conversations the person can post in (public and private channels, not archived), by name.
 * @returns {Promise<{ok:boolean,channels?:object[],code?:number,message?:string}>} The channels.
 */
async function slackChannels() {
  const a = await getJson(`${SLACK}/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200`);
  if (a.notConnected) return { ok: false, ...notConnected(channelById('slack')) };
  if (a.body?.ok === false) return { ok: false, ...rejected(channelById('slack'), 502, a.body) };
  const channels = (a.body?.channels || []).map((c) => ({ id: c.id, name: c.name || c.id, isPrivate: !!c.is_private, members: c.num_members || 0 }));
  channels.sort((p, q) => p.name.localeCompare(q.name));
  return { ok: true, channels };
}
exports.slackChannels = slackChannels;

/** Rows of one Slack conversation that come from other people, bounded. */
async function slackRows(c, perChannel) {
  const hist = await getJson(`${SLACK}/conversations.history?channel=${encodeURIComponent(c.id)}&limit=${perChannel}`);
  if (!hist.body?.ok) return [];
  const type = c.is_im ? 'dm' : c.is_mpim ? 'dm' : 'channel';
  return (hist.body.messages || []).filter((m) => !m.subtype || m.subtype === 'thread_broadcast').map((m) => ({
    channelId: c.id, channelName: c.name || (c.is_im ? `dm:${c.user || c.id}` : c.id), type, userId: m.user || '', text: String(m.text || ''), ts: m.ts,
    at: new Date(Math.floor(parseFloat(m.ts) * 1000)).toISOString(),
  }));
}

/** Resolve the display names of the Slack users seen, bounded. */
async function slackNames(userIds, max) {
  const names = new Map();
  for (const uid of [...userIds].slice(0, max)) {
    const info = await getJson(`${SLACK}/users.info?user=${encodeURIComponent(uid)}`);
    if (info.body?.ok && info.body.user) names.set(uid, info.body.user.profile?.display_name || info.body.user.real_name || info.body.user.name || uid);
  }
  return names;
}

/**
 * @description The person's Slack direct messages and @-mentions from others, newest first: the Engage rows.
 * @param {{maxChannels?:number, perChannel?:number, maxUsers?:number}} [limits] - Bounds for one read.
 * @returns {Promise<{ok:boolean,items?:object[],code?:number,message?:string}>} The rows.
 */
async function slackInbox(limits = {}) {
  const me = await getJson(`${SLACK}/auth.test`);
  if (me.notConnected) return { ok: false, ...notConnected(channelById('slack')) };
  if (!me.body?.ok) return { ok: false, ...rejected(channelById('slack'), 502, me.body) };
  const convs = await getJson(`${SLACK}/users.conversations?types=public_channel,private_channel,im,mpim&exclude_archived=true&limit=100`);
  if (!convs.body?.ok) return { ok: false, ...rejected(channelById('slack'), 502, convs.body) };
  const mention = `<@${me.body.user_id}>`;
  const rows = [];
  for (const c of (convs.body.channels || []).slice(0, limits.maxChannels || 12)) rows.push(...(await slackRows(c, limits.perChannel || 8)));
  const mine = rows.filter((r) => r.userId !== me.body.user_id && (r.type === 'dm' || r.text.includes(mention)));
  const names = await slackNames(new Set(mine.map((r) => r.userId).filter(Boolean)), limits.maxUsers || 25);
  const items = mine.map((r) => ({
    id: `slack:${r.channelId}:${r.ts}`, channel: 'slack', kind: r.type === 'dm' ? 'dm' : 'mention', from: names.get(r.userId) || r.userId || 'Slack',
    where: r.type === 'dm' ? 'Direct message' : `#${r.channelName}`, text: r.text.replace(mention, '@you').slice(0, 500), at: r.at,
    replyTo: { channelId: r.channelId, ts: r.ts },
  }));
  items.sort((p, q) => Date.parse(q.at) - Date.parse(p.at));
  return { ok: true, items };
}
exports.slackInbox = slackInbox;

/**
 * @description The posts that mention the person on X, newest first: the Engage rows.
 * @returns {Promise<{ok:boolean,items?:object[],code?:number,message?:string}>} The rows.
 */
async function xMentions() {
  const me = await getJson(`${X}/users/me`);
  if (me.notConnected) return { ok: false, ...notConnected(channelById('x')) };
  if (!me.body?.data?.id) return { ok: false, ...rejected(channelById('x'), me.status, me.body) };
  const a = await getJson(`${X}/users/${encodeURIComponent(me.body.data.id)}/mentions?max_results=20&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username,name`);
  if (a.status < 200 || a.status >= 300) return { ok: false, ...rejected(channelById('x'), a.status, a.body) };
  const users = new Map((a.body?.includes?.users || []).map((u) => [u.id, u]));
  const items = (a.body?.data || []).map((t) => {
    const u = users.get(t.author_id) || {};
    return {
      id: `x:${t.id}`, channel: 'x', kind: 'mention', from: u.name ? `${u.name} (@${u.username})` : (u.username ? `@${u.username}` : 'Someone on X'),
      where: 'X', text: String(t.text || '').slice(0, 500), at: t.created_at || null, url: `https://x.com/i/web/status/${t.id}`, replyTo: { tweetId: t.id },
    };
  });
  items.sort((p, q) => Date.parse(q.at || 0) - Date.parse(p.at || 0));
  return { ok: true, items };
}
exports.xMentions = xMentions;
