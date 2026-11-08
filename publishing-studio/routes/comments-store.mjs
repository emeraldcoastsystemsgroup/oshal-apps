/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Forced-RLS pinned publication comments, threaded replies, and resolution state (RP-PUB-06).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.5.1: remove comment replies before deleting parent comment row so native SQL foreign-key cascade snapshots are loaded.
 */
import {randomUUID} from 'node:crypto';
import {exact, fail, id, key, number, text} from './model.mjs';

const iso = v => new Date(v).toISOString();

function actorDisplayName(store) {
  const actor = store.ctx.authorization?.currentActor?.() ?? {};
  const raw = actor.displayName || actor.name || actor.email || actor.principalId || actor.sub || 'Reviewer';
  const clean = String(raw).replace(/[^\x20-\x7e]/g, '').trim().slice(0, 120);
  return clean || 'Reviewer';
}

function serializeComment(row, replies = []) {
  return {
    id: row.id,
    documentId: row.document_id,
    revision: row.revision,
    pageId: row.page_id,
    targetType: row.target_type,
    targetId: row.target_id,
    pinX: Number(row.pin_x),
    pinY: Number(row.pin_y),
    authorName: row.author_name,
    body: row.body,
    resolved: Boolean(row.resolved),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    replies: replies.map(r => ({
      id: r.id,
      commentId: r.comment_id,
      authorName: r.author_name,
      body: r.body,
      createdAt: iso(r.created_at),
    })),
  };
}

function verifyPinTarget(model, pageId, targetType, targetId, pinX, pinY) {
  const page = model.pages.find(p => p.id === pageId);
  if (!page) fail(404, 'publishing_comment_target_missing');
  number(pinX, 0, page.width);
  number(pinY, 0, page.height);
  if (targetType === 'page') {
    if (targetId !== pageId) fail(404, 'publishing_comment_target_missing');
    return;
  }
  if (targetType === 'frame') {
    if (!page.frames.some(f => f.id === targetId)) fail(404, 'publishing_comment_target_missing');
    return;
  }
  if (targetType === 'object') {
    if (!page.objects.some(o => o.id === targetId)) fail(404, 'publishing_comment_target_missing');
    return;
  }
  fail(400, 'publishing_model_invalid');
}

async function loadThread(c, o, documentId, commentId) {
  const row = (await c.query('SELECT * FROM publishing_comments WHERE owner_key=$1 AND document_id=$2 AND id=$3', [...o, documentId, commentId])).rows[0];
  if (!row) fail(404, 'publishing_comment_missing');
  const replies = (await c.query('SELECT * FROM publishing_comment_replies WHERE owner_key=$1 AND comment_id=$2 ORDER BY created_at ASC', [...o, commentId])).rows;
  return serializeComment(row, replies);
}

export async function listComments(store, documentId) {
  id(documentId);
  return store.tx('read', false, async (c, o) => {
    await store.getRow(c, o, documentId);
    const rows = (await c.query('SELECT * FROM publishing_comments WHERE owner_key=$1 AND document_id=$2 ORDER BY created_at ASC', [...o, documentId])).rows;
    if (!rows.length) return { comments: [] };
    const replies = (await c.query('SELECT r.* FROM publishing_comment_replies r JOIN publishing_comments m ON m.id=r.comment_id AND m.owner_key=r.owner_key WHERE r.owner_key=$1 AND m.document_id=$2 ORDER BY r.created_at ASC', [...o, documentId])).rows;
    const byParent = new Map();
    for (const r of replies) {
      const arr = byParent.get(r.comment_id) ?? [];
      arr.push(r);
      byParent.set(r.comment_id, arr);
    }
    return { comments: rows.map(row => serializeComment(row, byParent.get(row.id) ?? [])) };
  });
}

export async function addComment(store, documentId, input) {
  id(documentId);
  exact(input, ['pageId', 'targetType', 'targetId', 'body', 'requestKey'], ['pinX', 'pinY']);
  key(input.pageId);
  key(input.targetId);
  if (!['page', 'frame', 'object'].includes(input.targetType)) fail(400, 'publishing_model_invalid');
  const body = text(input.body, 2000).trim();
  if (!body) fail(400, 'publishing_comment_empty');
  return store.tx('change', true, async (c, o) => {
    const source = await store.getRow(c, o, documentId);
    const page = source.model.pages.find(p => p.id === input.pageId);
    if (!page) fail(404, 'publishing_comment_target_missing');
    const item = input.targetType === 'frame' ? page.frames.find(f => f.id === input.targetId) : input.targetType === 'object' ? page.objects.find(obj => obj.id === input.targetId) : null;
    const pinX = input.pinX !== undefined ? input.pinX : (item ? Math.min(page.width, item.x + Math.min(24, item.width / 2)) : page.margin);
    const pinY = input.pinY !== undefined ? input.pinY : (item ? Math.min(page.height, item.y + Math.min(24, item.height / 2)) : page.margin);
    verifyPinTarget(source.model, input.pageId, input.targetType, input.targetId, pinX, pinY);
    const author = actorDisplayName(store);
    const answer = await store.request(c, o, input.requestKey, ['comment', documentId, input.pageId, input.targetType, input.targetId, pinX, pinY, body], async () => {
      const countRow = (await c.query('SELECT count(*)::int AS n FROM publishing_comments WHERE owner_key=$1 AND document_id=$2', [...o, documentId])).rows[0];
      if (Number(countRow.n) >= 128) fail(413, 'publishing_comment_limit');
      const cid = randomUUID();
      await c.query(
        'INSERT INTO publishing_comments(id,owner_key,document_id,revision,page_id,target_type,target_id,pin_x,pin_y,author_name,body) VALUES($2,$1,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [...o, cid, documentId, source.row.current_revision, input.pageId, input.targetType, input.targetId, pinX, pinY, author, body],
      );
      return { resource: cid, result: { comment: { id: cid } } };
    });
    return { comment: await loadThread(c, o, documentId, answer.comment.id), ...(answer.replayed ? { replayed: true } : {}) };
  });
}

export async function replyComment(store, documentId, commentId, input) {
  id(documentId);
  id(commentId);
  exact(input, ['body', 'requestKey']);
  const body = text(input.body, 2000).trim();
  if (!body) fail(400, 'publishing_comment_empty');
  return store.tx('change', true, async (c, o) => {
    await store.getRow(c, o, documentId);
    const parent = (await c.query('SELECT id FROM publishing_comments WHERE owner_key=$1 AND document_id=$2 AND id=$3', [...o, documentId, commentId])).rows[0];
    if (!parent) fail(404, 'publishing_comment_missing');
    const author = actorDisplayName(store);
    const answer = await store.request(c, o, input.requestKey, ['comment-reply', documentId, commentId, body], async () => {
      const countRow = (await c.query('SELECT count(*)::int AS n FROM publishing_comment_replies WHERE owner_key=$1 AND comment_id=$2', [...o, commentId])).rows[0];
      if (Number(countRow.n) >= 64) fail(413, 'publishing_comment_limit');
      const rid = randomUUID();
      await c.query('INSERT INTO publishing_comment_replies(id,owner_key,comment_id,author_name,body) VALUES($2,$1,$3,$4,$5)', [...o, rid, commentId, author, body]);
      await c.query('UPDATE publishing_comments SET updated_at=now() WHERE owner_key=$1 AND id=$2', [...o, commentId]);
      return { resource: rid, result: { replyId: rid } };
    });
    return { comment: await loadThread(c, o, documentId, commentId), ...(answer.replayed ? { replayed: true } : {}) };
  });
}

export async function resolveComment(store, documentId, commentId, input) {
  id(documentId);
  id(commentId);
  exact(input, ['resolved', 'requestKey']);
  if (typeof input.resolved !== 'boolean') fail(400, 'publishing_model_invalid');
  return store.tx('change', true, async (c, o) => {
    await store.getRow(c, o, documentId);
    const answer = await store.request(c, o, input.requestKey, ['comment-resolve', documentId, commentId, input.resolved], async () => {
      const updated = await c.query('UPDATE publishing_comments SET resolved=$4,updated_at=now() WHERE owner_key=$1 AND document_id=$2 AND id=$3 RETURNING id', [...o, documentId, commentId, input.resolved]);
      if (!updated.rows.length) fail(404, 'publishing_comment_missing');
      return { resource: commentId, result: { resolved: input.resolved } };
    });
    return { comment: await loadThread(c, o, documentId, commentId), ...(answer.replayed ? { replayed: true } : {}) };
  });
}

export async function deleteComment(store, documentId, commentId) {
  id(documentId);
  id(commentId);
  return store.tx('change', true, async (c, o) => {
    await store.getRow(c, o, documentId);
    const existing = (await c.query('SELECT id FROM publishing_comments WHERE owner_key=$1 AND document_id=$2 AND id=$3', [...o, documentId, commentId])).rows[0];
    if (!existing) fail(404, 'publishing_comment_missing');
    await c.query('DELETE FROM publishing_comment_replies WHERE owner_key=$1 AND comment_id=$2', [...o, commentId]);
    await store.tombstone(c, o, commentId);
    await c.query('DELETE FROM publishing_comments WHERE owner_key=$1 AND document_id=$2 AND id=$3', [...o, documentId, commentId]);
    return { deleted: true };
  });
}
