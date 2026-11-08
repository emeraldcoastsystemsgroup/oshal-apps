/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Forced-RLS social post scheduling and immediate egress dispatch behind explicit confirmation (RP-PUB-07).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.5.1: snapshot-load referenced publishing_revisions rows before native SQL updates on publishing_social_posts.
 */
import {randomUUID} from 'node:crypto';
import {exact, fail, id, integer, LIMITS, text} from './model.mjs';

const CHANNELS = Object.freeze({
  twitter: { id: 'twitter', label: 'X (Twitter)', providers: ['twitter', 'x'], limit: 280 },
  linkedin: { id: 'linkedin', label: 'LinkedIn', providers: ['linkedin'], limit: 2000 },
});
const iso = v => (v ? new Date(v).toISOString() : null);

function serializePost(row) {
  return {
    id: row.id,
    documentId: row.document_id,
    revision: row.revision,
    channel: row.channel,
    caption: row.caption,
    status: row.status,
    scheduledFor: iso(row.scheduled_for),
    publishedAt: iso(row.published_at),
    remoteId: row.remote_id ?? null,
    error: row.error ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function connectorStates(ctx) {
  let meta = null;
  if (typeof ctx?.intent === 'function') {
    try { meta = await ctx.intent('connectors.metadata', {}); } catch { meta = null; }
  }
  const now = Date.now();
  return Object.values(CHANNELS).map(ch => {
    const rows = Array.isArray(meta?.connections)
      ? meta.connections.filter(c => ch.providers.includes(String(c?.provider ?? '').toLowerCase()))
      : [];
    const connected = rows.some(c => c.revoked !== true && (c.expires_at_ms == null || Number(c.expires_at_ms) > now || c.renewable === true));
    return { id: ch.id, label: ch.label, limit: ch.limit, connected, authorizePath: `/connectors/${ch.id}/authorize` };
  });
}

async function dispatchToProvider(ctx, channel, caption) {
  const fetcher = ctx.socialFetch ?? globalThis.fetch;
  if (channel === 'twitter') {
    const r = await fetcher('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ text: caption }),
      signal: AbortSignal.timeout(12000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body?.data?.id) fail(502, 'publishing_social_provider_rejected', { channel, status: r.status });
    return String(body.data.id);
  }
  const meRes = await fetcher('https://api.linkedin.com/v2/userinfo', {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !me?.sub) fail(502, 'publishing_social_provider_rejected', { channel, status: meRes.status });
  const r = await fetcher('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      author: `urn:li:person:${me.sub}`,
      lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: caption }, shareMediaCategory: 'NONE' } },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
    signal: AbortSignal.timeout(12000),
  });
  const body = await r.json().catch(() => ({}));
  const remoteId = r.headers?.get?.('x-restli-id') || body?.id;
  if (!r.ok || !remoteId) fail(502, 'publishing_social_provider_rejected', { channel, status: r.status });
  return String(remoteId);
}

export async function listSocialChannels(ctx) {
  return { channels: await connectorStates(ctx) };
}

export async function listSocialPosts(store, documentId) {
  id(documentId);
  return store.tx('read', false, async (c, o) => {
    await store.getRow(c, o, documentId);
    const rows = (await c.query('SELECT * FROM publishing_social_posts WHERE owner_key=$1 AND document_id=$2 ORDER BY created_at DESC', [...o, documentId])).rows;
    return { posts: rows.map(serializePost) };
  });
}

export async function createSocialPost(store, ctx, documentId, input) {
  id(documentId);
  exact(input, ['revision', 'channel', 'caption', 'requestKey'], ['scheduledFor', 'confirm']);
  integer(input.revision, 1, LIMITS.revisions);
  const ch = CHANNELS[input.channel];
  if (!ch) fail(400, 'publishing_social_channel_unsupported');
  const caption = text(input.caption, 2000).trim();
  if (!caption) fail(400, 'publishing_caption_empty');
  if (caption.length > ch.limit) fail(400, 'publishing_caption_too_long', { limit: ch.limit, length: caption.length });
  if (input.confirm !== true) fail(428, 'publishing_confirmation_required');

  let scheduledIso = null;
  if (input.scheduledFor !== undefined && input.scheduledFor !== null) {
    const ts = Date.parse(String(input.scheduledFor));
    if (!Number.isFinite(ts) || ts <= Date.now() + 5000) fail(400, 'publishing_schedule_in_past');
    scheduledIso = new Date(ts).toISOString();
  }

  const states = await connectorStates(ctx);
  if (!states.find(s => s.id === ch.id)?.connected) {
    fail(409, 'publishing_connector_disconnected', { channel: ch.id, authorizePath: `/connectors/${ch.id}/authorize` });
  }

  const staged = await store.tx('export', true, async (c, o) => {
    const source = await store.getRow(c, o, documentId, input.revision);
    if (!(await store.rendered(c, o, source))) fail(409, 'publishing_render_required');
    return store.request(c, o, input.requestKey, ['social-post', documentId, input.revision, ch.id, caption, scheduledIso], async () => {
      const countRow = (await c.query('SELECT count(*)::int AS n FROM publishing_social_posts WHERE owner_key=$1', o)).rows[0];
      if (Number(countRow.n) >= 64) fail(413, 'publishing_social_post_limit');
      const postId = randomUUID();
      const initialStatus = scheduledIso ? 'scheduled' : 'publishing';
      await c.query(
        'INSERT INTO publishing_social_posts(id,owner_key,document_id,revision,channel,caption,status,scheduled_for) VALUES($2,$1,$3,$4,$5,$6,$7,$8)',
        [...o, postId, documentId, input.revision, ch.id, caption, initialStatus, scheduledIso],
      );
      return { resource: postId, result: { postId } };
    });
  });

  if (!scheduledIso && !staged.replayed) {
    try {
      const remoteId = await dispatchToProvider(ctx, ch.id, caption);
      await store.tx('export', true, async (c, o) => {
        await c.query('SELECT * FROM publishing_revisions WHERE owner_key=$1 AND document_id=$2 AND revision=$3', [...o, documentId, input.revision]);
        await c.query("UPDATE publishing_social_posts SET status='published',published_at=now(),remote_id=$3,error=NULL,updated_at=now() WHERE owner_key=$1 AND id=$2", [...o, staged.postId, remoteId]);
      });
    } catch (err) {
      const code = err?.code ?? 'publishing_social_provider_rejected';
      await store.tx('export', true, async (c, o) => {
        await c.query('SELECT * FROM publishing_revisions WHERE owner_key=$1 AND document_id=$2 AND revision=$3', [...o, documentId, input.revision]);
        await c.query("UPDATE publishing_social_posts SET status='failed',error=$3,updated_at=now() WHERE owner_key=$1 AND id=$2", [...o, staged.postId, code]);
      });
      throw err;
    }
  }

  return store.tx('read', false, async (c, o) => {
    const row = (await c.query('SELECT * FROM publishing_social_posts WHERE owner_key=$1 AND id=$2', [...o, staged.postId])).rows[0];
    return { post: serializePost(row), ...(staged.replayed ? { replayed: true } : {}) };
  });
}

export async function cancelSocialPost(store, documentId, postId) {
  id(documentId);
  id(postId);
  return store.tx('export', true, async (c, o) => {
    const row = (await c.query('SELECT * FROM publishing_social_posts WHERE owner_key=$1 AND document_id=$2 AND id=$3', [...o, documentId, postId])).rows[0];
    if (!row) fail(404, 'publishing_social_post_missing');
    if (row.status === 'published') fail(409, 'publishing_social_post_already_published');
    await store.tombstone(c, o, postId);
    await c.query('DELETE FROM publishing_social_posts WHERE owner_key=$1 AND document_id=$2 AND id=$3', [...o, documentId, postId]);
    return { deleted: true };
  });
}

export async function runDueSocialPosts(store, ctx) {
  const due = await store.tx('export', true, async (c, o) => {
    const rows = (await c.query("SELECT * FROM publishing_social_posts WHERE owner_key=$1 AND status='scheduled' AND scheduled_for<=now() ORDER BY scheduled_for ASC LIMIT 10", o)).rows;
    const claimed = [];
    for (const r of rows) {
      await c.query('SELECT * FROM publishing_revisions WHERE owner_key=$1 AND document_id=$2 AND revision=$3', [...o, r.document_id, r.revision]);
      const u = await c.query("UPDATE publishing_social_posts SET status='publishing',updated_at=now() WHERE owner_key=$1 AND id=$2 AND status='scheduled' RETURNING *", [...o, r.id]);
      if (u.rows.length) claimed.push(u.rows[0]);
    }
    return claimed;
  });
  let published = 0, failed = 0;
  for (const row of due) {
    try {
      const remoteId = await dispatchToProvider(ctx, row.channel, row.caption);
      await store.tx('export', true, async (c, o) => {
        await c.query('SELECT * FROM publishing_revisions WHERE owner_key=$1 AND document_id=$2 AND revision=$3', [...o, row.document_id, row.revision]);
        await c.query("UPDATE publishing_social_posts SET status='published',published_at=now(),remote_id=$3,error=NULL,updated_at=now() WHERE owner_key=$1 AND id=$2", [...o, row.id, remoteId]);
      });
      published += 1;
    } catch (err) {
      failed += 1;
      await store.tx('export', true, async (c, o) => {
        await c.query('SELECT * FROM publishing_revisions WHERE owner_key=$1 AND document_id=$2 AND revision=$3', [...o, row.document_id, row.revision]);
        await c.query("UPDATE publishing_social_posts SET status='failed',error=$3,updated_at=now() WHERE owner_key=$1 AND id=$2", [...o, row.id, err?.code ?? 'publishing_social_provider_rejected']);
      });
    }
  }
  return { processed: due.length, published, failed };
}
