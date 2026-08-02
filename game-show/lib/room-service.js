/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 21:04:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Room lifecycle for the Game Show: create/join, podium seats, the cheap sync poll (rev + per-seat presence_rev), presence frame store/serve, an event log, and the mutate() primitive that serializes every game action under a FOR UPDATE lock so the buzzer stays authoritative.
 * 2026-07-22 02:48:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Own the round clock: stamp the show's open window after every mutation (one integration point), resolve a lapsed window from the sync poll under the room lock (no scheduler, race-safe), and let the host remove a stuck podium.
 * 2026-07-24 11:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog burn-down: audience reactions ride the EVENT LOG (kind 'react' — no rev bump, every surface renders the float, #16); ending a room prunes its presence frames and snapshots final standings into gameshow_seats.score (#13/#19 — the column is now the cross-game leaderboard hook, state jsonb stays authoritative in play); rooms ended 7+ days purge opportunistically on create/list, cascading state/seats/events/presence (#14 — no scheduler, same lazy pattern as the clock).
 * 2026-07-25 22:50:00 | roger.murphy@emeraldcoastsystemsgroup.com  | NPC contestants: addPodium mints npc:<skill>:<uuid> seats (no schema change) and the sync poll drives lib/npc.js — an AI player's due move applies under the room lock on whichever surface polls next, exactly the clock-tick doctrine.
 * 2026-07-31 22:40:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Backlog #11 — the end-of-game score snapshots finally have a reader: leaderboard(sub) returns the top gameshow_seats.score rows across ENDED games the caller hosted or played in (caller-scoped exactly like listRooms, never a global read; zero scores are noise, not fame). Rendered as the lobby's Hall of fame panel.
 */

'use strict';

const crypto = require('crypto');
const { parsedJson, withTransaction, roomDto, seatDto } = require('./route-helpers');
const registry = require('./shows/show-registry');
const clock = require('./clock');
const npc = require('./npc');

const MAX_PRESENCE_BYTES = 400 * 1024;   // one camera still

/** @description Generate a shareable 6-character room code. */
function newJoinCode() {
  return crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
}

/** @description Allocate the next per-room event sequence number. */
async function nextSeq(db, roomId) {
  const result = await db.query('SELECT COALESCE(MAX(seq),0)+1 AS n FROM gameshow_events WHERE room_id=$1', [roomId]);
  return Number(result.rows[0].n);
}

/** @description Append one event beat to a room's log. */
async function appendEvent(db, sub, roomId, kind, content) {
  const seq = await nextSeq(db, roomId);
  await db.query(
    'INSERT INTO gameshow_events (room_id, user_sub, seq, kind, content) VALUES ($1,$2,$3,$4,$5)',
    [roomId, sub, seq, String(kind).slice(0, 24), String(content || '').slice(0, 400)]
  );
  return { seq, kind, content };
}

/** @description Return an owner-or-member room row for authorization, or null. */
async function access(deps, sub, roomId) {
  const result = await deps.pool.query(
    `SELECT r.* FROM gameshow_rooms r
      WHERE r.room_id=$1 AND (r.user_sub=$2 OR EXISTS (
              SELECT 1 FROM gameshow_seats s WHERE s.room_id=r.room_id AND s.user_sub=$2))`,
    [roomId, sub]
  );
  return result.rows[0] || null;
}

/** @description Read raw seat rows for a room in join order. */
async function seatsOf(deps, roomId, db) {
  const result = await (db || deps.pool).query(
    'SELECT * FROM gameshow_seats WHERE room_id=$1 ORDER BY joined_at, podium_index NULLS LAST', [roomId]
  );
  return result.rows;
}

/** @description Create a room with its opening game state and a host seat for the creator. */
async function createRoom(deps, sub, name, body) {
  const showId = registry.has(body && body.showId) ? body.showId : 'family-feud';
  const show = registry.get(showId);
  const roomName = String((body && body.name) || show.title).slice(0, 80);
  const now = Date.now();
  purgeEnded(deps).catch(() => {});   // opportunistic retention sweep (#14)
  return withTransaction(deps.pool, async (db) => {
    const room = (await db.query(
      `INSERT INTO gameshow_rooms (user_sub, show_id, name, join_code, status)
       VALUES ($1,$2,$3,$4,'lobby') RETURNING *`,
      [sub, showId, roomName, newJoinCode()]
    )).rows[0];
    await db.query(
      `INSERT INTO gameshow_seats (room_id, user_sub, display_name, role, podium_index)
       VALUES ($1,$2,$3,'host',0)`,
      [room.room_id, sub, String((body && body.hostName) || name).slice(0, 60)]
    );
    const state = show.initialState(room, [], now);
    await db.query(
      'INSERT INTO gameshow_state (room_id, user_sub, state, rev) VALUES ($1,$2,$3,1)',
      [room.room_id, sub, JSON.stringify(state)]
    );
    return { ok: true, room: roomDto(room, sub), state, rev: 1 };
  });
}

/** @description Join a room by its share code as a player, choosing a team. */
async function joinByCode(deps, sub, name, body) {
  const code = String((body && body.code) || '').trim().toUpperCase();
  const found = await deps.pool.query("SELECT * FROM gameshow_rooms WHERE join_code=$1 AND status<>'ended'", [code]);
  if (!found.rowCount) return { ok: false, status: 404, error: 'No game found with that code.' };
  const room = found.rows[0];
  const team = ['A', 'B'].includes(body && body.team) ? body.team : null;
  // A typed name beats the identity-provider one ("Player" phones were
  // indistinguishable on the podium); a REJOIN keeps the existing seat name so
  // an auto-join deep link never wipes what the player chose earlier.
  const display = String((body && body.name) || name || 'Player').slice(0, 60);
  const seat = (await deps.pool.query(
    `INSERT INTO gameshow_seats (room_id, user_sub, display_name, team, role)
     VALUES ($1,$2,$3,$4,'player')
     ON CONFLICT (room_id, user_sub) DO UPDATE SET
       display_name = CASE WHEN $5 THEN EXCLUDED.display_name ELSE gameshow_seats.display_name END
     RETURNING seat_id, team`,
    [room.room_id, sub, display, team, !!(body && body.name)]
  )).rows[0];
  await deps.pool.query('UPDATE gameshow_state SET rev=rev+1, updated_at=now() WHERE room_id=$1', [room.room_id]);
  return { ok: true, roomId: room.room_id, seatId: seat.seat_id, team: seat.team || null };
}

/**
 * @description Create a host-run "house" podium (hotseat/solo) or, with body.npc,
 *   an AI-played NPC podium (skill 'sharp' | 'casual' | 'wild'). NPC seats carry
 *   a synthetic `npc:<skill>:<uuid>` subject — the skill IS the seat identity, so
 *   no schema change is needed and lib/npc.js can read it wherever seats travel.
 */
async function addPodium(deps, sub, roomId, body) {
  const room = await access(deps, sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  if (room.user_sub !== sub) return { ok: false, status: 403, error: 'Only the host can add podiums.' };
  const team = ['A', 'B'].includes(body && body.team) ? body.team : null;
  const skill = npc.SKILLS.includes(body && body.npc) ? body.npc : null;
  const seatSub = skill ? npc.newNpcSub(skill) : `house:${crypto.randomUUID()}`;
  const name = String((body && body.name) || (skill ? npc.npcName(skill, await seatsOf(deps, roomId)) : 'Podium')).slice(0, 60);
  const seat = (await deps.pool.query(
    `INSERT INTO gameshow_seats (room_id, user_sub, display_name, team, role, presence_kind)
     VALUES ($1,$2,$3,$4,'player','avatar') RETURNING seat_id`,
    [roomId, seatSub, name, team]
  )).rows[0];
  await deps.pool.query('UPDATE gameshow_state SET rev=rev+1, updated_at=now() WHERE room_id=$1', [roomId]);
  return { ok: true, seatId: seat.seat_id, name };
}

/** @description Update the caller's own seat (team, presence module, display name). */
async function updateSeat(deps, sub, roomId, body) {
  const room = await access(deps, sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  const owner = room.user_sub === sub;
  const seatId = owner && body.seatId ? String(body.seatId) : null;   // host may edit any podium
  const fields = [], values = [];
  const push = (frag, val) => { values.push(val); fields.push(`${frag}=$${values.length}`); };
  if (['A', 'B', null].includes(body.team ?? null) && body.team !== undefined) push('team', body.team || null);
  if (['camera', 'avatar', 'off'].includes(body.presenceKind)) push('presence_kind', body.presenceKind);
  if (body.avatarId !== undefined) push('avatar_id', String(body.avatarId || '').slice(0, 40) || null);
  if (body.name !== undefined) push('display_name', String(body.name || '').slice(0, 60) || 'Player');
  if (!fields.length) return { ok: false, status: 400, error: 'Nothing to update.' };
  values.push(roomId);
  const scope = seatId ? `AND seat_id=$${values.length + 1}` : `AND user_sub=$${values.length + 1}`;
  values.push(seatId || sub);
  const updated = await deps.pool.query(
    `UPDATE gameshow_seats SET ${fields.join(', ')} WHERE room_id=$${values.length - 1} ${scope} RETURNING *`,
    values
  );
  if (!updated.rowCount) return { ok: false, status: 404, error: 'No podium to update.' };
  await deps.pool.query('UPDATE gameshow_state SET rev=rev+1, updated_at=now() WHERE room_id=$1', [roomId]);
  return { ok: true, seat: seatDto(updated.rows[0], sub) };
}

/** @description Leave a room, freeing the caller's non-host podium. */
async function leaveRoom(deps, sub, roomId) {
  const room = await access(deps, sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  if (room.user_sub === sub) return { ok: false, status: 400, error: 'The host cannot leave; end the game instead.' };
  await deps.pool.query('DELETE FROM gameshow_seats WHERE room_id=$1 AND user_sub=$2', [roomId, sub]);
  await deps.pool.query('UPDATE gameshow_state SET rev=rev+1, updated_at=now() WHERE room_id=$1', [roomId]);
  return { ok: true };
}

/** @description List the caller's active rooms as compact summaries. */
async function listRooms(deps, sub) {
  purgeEnded(deps).catch(() => {});   // opportunistic retention sweep (#14)
  const result = await deps.pool.query(
    `SELECT r.*, st.rev, st.state->>'phase' AS phase,
            (SELECT COUNT(*)::int FROM gameshow_seats s WHERE s.room_id=r.room_id AND s.role='player') AS players
       FROM gameshow_rooms r
       LEFT JOIN gameshow_state st ON st.room_id=r.room_id
      WHERE r.status<>'ended' AND (r.user_sub=$1 OR EXISTS (
              SELECT 1 FROM gameshow_seats s WHERE s.room_id=r.room_id AND s.user_sub=$1))
      ORDER BY r.updated_at DESC`,
    [sub]
  );
  return { ok: true, rooms: result.rows.map((row) => ({ ...roomDto(row, sub), phase: row.phase || 'lobby', players: Number(row.players) || 0 })) };
}

/** @description Load a full room snapshot: room, seats, state, scoreboard, and event tail. */
async function loadState(deps, sub, roomId) {
  const room = await access(deps, sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  const [stRes, seatRows, log] = await Promise.all([
    deps.pool.query('SELECT state, rev FROM gameshow_state WHERE room_id=$1', [roomId]),
    seatsOf(deps, roomId),
    deps.pool.query('SELECT seq, kind, content FROM gameshow_events WHERE room_id=$1 ORDER BY seq DESC LIMIT 40', [roomId]),
  ]);
  const state = stRes.rowCount ? parsedJson(stRes.rows[0].state, {}) : {};
  const show = registry.get(room.show_id);
  return {
    ok: true, room: roomDto(room, sub), state, rev: stRes.rowCount ? Number(stRes.rows[0].rev) : 0, now: Date.now(),
    seats: seatRows.map((row) => seatDto(row, sub)),
    scoreboard: show ? show.scoreboard(state, seatRows) : [],
    events: log.rows.reverse(), show: show ? { id: show.id, title: show.title, teams: show.teams } : null,
  };
}

/** @description Cheap poll: board rev/state, seats (with presence_rev), and the event tail. */
async function sync(deps, sub, roomId, sinceRev, sinceSeq) {
  const room = await access(deps, sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  let stRes = await deps.pool.query('SELECT state, rev FROM gameshow_state WHERE room_id=$1', [roomId]);
  // The round clock has no scheduler — the poll IS the tick. Any surface watching the
  // room resolves a lapsed window; if nobody is watching, nothing needed to move.
  if (stRes.rowCount && clock.expired(parsedJson(stRes.rows[0].state, {}), Date.now())) {
    const fired = await tick(deps, sub, roomId);
    if (fired.fired) stRes = await deps.pool.query('SELECT state, rev FROM gameshow_state WHERE room_id=$1', [roomId]);
  }
  let seatRows = await seatsOf(deps, roomId);
  // NPC podiums ride the same tick: when an AI player's moment arrives, whichever
  // surface polls next applies its move under the room lock (racers no-op).
  if (stRes.rowCount) {
    const acted = await npc.drive(
      { registry, mutate: (id, actorSub, apply) => mutate(deps, id, actorSub, apply) },
      room, sub, parsedJson(stRes.rows[0].state, {}), seatRows, Date.now()
    ).catch(() => ({ fired: false }));
    if (acted.fired) {
      stRes = await deps.pool.query('SELECT state, rev FROM gameshow_state WHERE room_id=$1', [roomId]);
      seatRows = await seatsOf(deps, roomId);
    }
  }
  const rev = stRes.rowCount ? Number(stRes.rows[0].rev) : 0;
  // `now` lets each surface measure its own clock skew and count down to the SAME
  // deadline the server will enforce — never to its own idea of the time.
  const out = { ok: true, rev, changed: rev > sinceRev, status: room.status, now: Date.now() };
  if (out.changed) out.state = parsedJson(stRes.rows[0].state, {});
  out.seats = seatRows.map((row) => seatDto(row, sub));
  if (out.changed) {
    const show = registry.get(room.show_id);
    out.scoreboard = show ? show.scoreboard(out.state, seatRows) : [];
  }
  const tail = await deps.pool.query(
    'SELECT seq, kind, content FROM gameshow_events WHERE room_id=$1 AND seq>$2 ORDER BY seq ASC LIMIT 30',
    [roomId, sinceSeq]
  );
  out.events = tail.rows;
  return out;
}

/** @description Resolve which podium the caller is acting as (owner may act as any). */
function resolveActor(seats, room, sub, actorSeatId) {
  let seat = seats.find((s) => s.user_sub === sub);
  if (actorSeatId) {
    const target = seats.find((s) => s.seat_id === String(actorSeatId));
    if (!target) return { error: 'No such podium.' };
    if (target.user_sub !== sub && room.user_sub !== sub) return { error: 'You can only act as your own podium.' };
    seat = target;
  }
  if (!seat) return { error: 'You have no podium in this room.' };
  return { actor: { seatId: seat.seat_id, team: seat.team, name: seat.display_name, role: seat.role } };
}

/**
 * @description Serialize one game mutation under a per-room lock. `apply` receives
 *   { state, room, seats, isOwner, db } and returns { ok, state?, error?, status?,
 *   events?, host?, cue?, outcome? }. The state row's rev is bumped on success.
 */
async function mutate(deps, roomId, sub, apply, opts = {}) {
  return withTransaction(deps.pool, async (db, tx) => {
    const roomRes = await db.query(`SELECT * FROM gameshow_rooms WHERE room_id=$1${tx ? ' FOR UPDATE' : ''}`, [roomId]);
    const room = roomRes.rows[0];
    if (!room) return { ok: false, status: 404, error: 'Room not found.' };
    const isOwner = room.user_sub === sub;
    const seats = (await db.query(`SELECT * FROM gameshow_seats WHERE room_id=$1${tx ? ' FOR UPDATE' : ''}`, [roomId])).rows;
    if (!isOwner && !seats.some((s) => s.user_sub === sub)) return { ok: false, status: 403, error: 'You are not in this room.' };
    if (opts.ownerOnly && !isOwner) return { ok: false, status: 403, error: 'Only the host can do that.' };
    const stRes = await db.query(`SELECT state, rev FROM gameshow_state WHERE room_id=$1${tx ? ' FOR UPDATE' : ''}`, [roomId]);
    if (!stRes.rowCount) return { ok: false, status: 409, error: 'No game state.' };
    const state = parsedJson(stRes.rows[0].state, {});
    const result = await apply({ state, room, seats, isOwner, db });
    if (!result || result.ok === false) return { ok: false, status: (result && result.status) || 400, error: (result && result.error) || 'Rejected.' };
    // Reconcile the round clock with whatever window the show now has open. One
    // integration point for every mutation — shows never stamp their own deadlines.
    const next = clock.stamp(result.state || state, registry.get(room.show_id), Date.now());
    const saved = await db.query(
      'UPDATE gameshow_state SET state=$1, rev=rev+1, updated_at=now() WHERE room_id=$2 RETURNING rev',
      [JSON.stringify(next), roomId]
    );
    await db.query('UPDATE gameshow_rooms SET updated_at=now() WHERE room_id=$1', [roomId]);
    for (const event of result.events || []) await appendEvent(db, sub, roomId, event.kind, event.content);
    return { ok: true, rev: Number(saved.rows[0].rev), state: next, host: result.host || null, cue: result.cue || null, outcome: result.outcome || null };
  });
}

/**
 * @description Resolve a lapsed round clock. Safe to call from any polling surface:
 *   expiry is re-checked under the room lock, so two clients racing the same deadline
 *   resolve it exactly once and the loser simply no-ops.
 * @param {object} deps - { pool }.
 * @param {string} sub - Caller (any room member may drive the clock forward).
 * @param {string} roomId - Room to tick.
 * @returns {Promise<{ok:boolean, fired:boolean, rev?:number, state?:object}>}
 */
async function tick(deps, sub, roomId) {
  const applied = await mutate(deps, roomId, sub, async ({ state, room, seats }) => {
    if (!clock.expired(state, Date.now())) return { ok: false, status: 409, error: 'Clock still running.' };
    const show = registry.get(room.show_id);
    if (!show || typeof show.onTimeout !== 'function') return { ok: true, state: clock.clear(state) };
    const result = show.onTimeout(state, state.timer, Date.now(), { seats });
    // A show that cannot interpret its own lapse must not wedge the room: drop the
    // clock and let the host take it from here rather than expiring on every poll.
    if (!result || !result.ok) return { ok: true, state: clock.clear(state) };
    return { ok: true, state: result.state, events: result.event ? [result.event] : [], host: result.host, cue: result.cue };
  });
  return applied.ok ? { ...applied, fired: true } : { ok: true, fired: false };
}

/** @description Remove a podium from the room (host only) — stuck-game recovery. */
async function removeSeat(deps, sub, roomId, seatId) {
  const room = await access(deps, sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  if (room.user_sub !== sub) return { ok: false, status: 403, error: 'Only the host can remove a podium.' };
  const seat = (await deps.pool.query('SELECT * FROM gameshow_seats WHERE room_id=$1 AND seat_id=$2', [roomId, String(seatId)])).rows[0];
  if (!seat) return { ok: false, status: 404, error: 'No such podium.' };
  if (seat.role === 'host') return { ok: false, status: 400, error: 'The host podium cannot be removed.' };
  await deps.pool.query('DELETE FROM gameshow_seats WHERE seat_id=$1', [seat.seat_id]);
  await deps.pool.query('UPDATE gameshow_state SET rev=rev+1, updated_at=now() WHERE room_id=$1', [roomId]);
  return { ok: true };
}

/** @description Store one camera still for a podium the caller owns, bumping its presence_rev. */
async function storePresence(deps, sub, roomId, seatId, bytes, mime) {
  const room = await access(deps, sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  const seat = (await deps.pool.query('SELECT * FROM gameshow_seats WHERE room_id=$1 AND seat_id=$2', [roomId, seatId])).rows[0];
  if (!seat) return { ok: false, status: 404, error: 'No such podium.' };
  if (seat.user_sub !== sub && room.user_sub !== sub) return { ok: false, status: 403, error: 'Not your podium.' };
  if (!bytes || !bytes.length || bytes.length > MAX_PRESENCE_BYTES) return { ok: false, status: 400, error: 'Bad frame.' };
  await withTransaction(deps.pool, async (db) => {
    await db.query(
      `INSERT INTO gameshow_presence (seat_id, room_id, mime, frame, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (seat_id) DO UPDATE SET mime=EXCLUDED.mime, frame=EXCLUDED.frame, updated_at=now()`,
      [seatId, roomId, String(mime || 'image/jpeg').slice(0, 40), bytes]
    );
    await db.query('UPDATE gameshow_seats SET presence_rev=presence_rev+1 WHERE seat_id=$1', [seatId]);
  });
  return { ok: true };
}

/** @description Read the latest camera still for a podium in a room the caller can access. */
async function loadPresence(deps, sub, roomId, seatId) {
  if (!(await access(deps, sub, roomId))) return null;
  const row = (await deps.pool.query('SELECT mime, frame FROM gameshow_presence WHERE room_id=$1 AND seat_id=$2', [roomId, seatId])).rows[0];
  return row && row.frame ? { mime: row.mime || 'image/jpeg', frame: row.frame } : null;
}

/**
 * @description Persist final standings into gameshow_seats.score when a game ends.
 *   The jsonb state stays authoritative DURING play; the column is the durable
 *   end-of-game snapshot a cross-game leaderboard can query without parsing state.
 */
async function snapshotScores(deps, roomId) {
  const room = (await deps.pool.query('SELECT * FROM gameshow_rooms WHERE room_id=$1', [roomId])).rows[0];
  const show = room && registry.get(room.show_id);
  if (!show) return;
  const stRes = await deps.pool.query('SELECT state FROM gameshow_state WHERE room_id=$1', [roomId]);
  if (!stRes.rowCount) return;
  const state = parsedJson(stRes.rows[0].state, {});
  const seats = await seatsOf(deps, roomId);
  const rows = show.scoreboard(state, seats) || [];
  for (const seat of seats) {
    if (seat.role === 'host') continue;
    const hit = rows.find((r) => r.seatId === seat.seat_id) || rows.find((r) => r.team && r.team === seat.team);
    if (!hit) continue;
    await deps.pool.query('UPDATE gameshow_seats SET score=$1 WHERE seat_id=$2', [Math.round(Number(hit.score) || 0), seat.seat_id]);
  }
}

/**
 * @description Cross-game hall of fame (backlog #11): the top end-of-game score
 *   snapshots (gameshow_seats.score, written by snapshotScores when a room ends)
 *   across ended games the caller hosted or played in. Caller-scoped exactly like
 *   listRooms — never a global read. Zero scores are noise, not fame. Retention
 *   (purgeEnded, 7 days) naturally bounds this to recent glory.
 * @param {object} deps - { pool }.
 * @param {string} sub - The caller whose games are read.
 * @returns {Promise<{ok:boolean, entries:Array}>} Best-first score entries.
 */
async function leaderboard(deps, sub) {
  const result = await deps.pool.query(
    `SELECT s.display_name, s.team, s.score, r.show_id, r.updated_at
       FROM gameshow_seats s
       JOIN gameshow_rooms r ON r.room_id = s.room_id
      WHERE r.status='ended' AND s.role<>'host' AND s.score > 0
        AND (r.user_sub=$1 OR EXISTS (
              SELECT 1 FROM gameshow_seats m WHERE m.room_id=r.room_id AND m.user_sub=$1))
      ORDER BY s.score DESC, r.updated_at DESC
      LIMIT 10`,
    [sub]
  );
  return {
    ok: true,
    entries: result.rows.map((row) => ({
      name: row.display_name || 'Player',
      team: row.team || null,
      score: Number(row.score) || 0,
      showId: row.show_id,
      endedAt: row.updated_at,
    })),
  };
}

/**
 * @description Retention: purge rooms ended more than 7 days ago. Cascades take the
 *   state, seats, events, and presence frames with them. Called opportunistically
 *   (create/list) — same no-scheduler pattern as the round clock.
 */
async function purgeEnded(deps) {
  await deps.pool.query("DELETE FROM gameshow_rooms WHERE status='ended' AND updated_at < now() - interval '7 days'");
}

/**
 * @description Broadcast one audience reaction as an event-log beat (never a rev
 *   bump — a reaction must not force every device to re-pull the board).
 */
async function react(deps, sub, name, roomId, emoji) {
  const room = await access(deps, sub, roomId);
  if (!room) return { ok: false, status: 404, error: 'Room not found.' };
  const glyph = String(emoji || '').trim().slice(0, 8);
  if (!glyph) return { ok: false, status: 400, error: 'Pick a reaction.' };
  const event = await appendEvent(deps.pool, sub, roomId, 'react', `${glyph} ${String(name || 'Someone').slice(0, 40)}`);
  return { ok: true, seq: event.seq };
}

/** @description Flip a room's status (lobby -> live -> ended). Owner only. */
async function setStatus(deps, sub, roomId, status) {
  const room = await access(deps, sub, roomId);
  if (!room || room.user_sub !== sub) return { ok: false, status: 403, error: 'Only the host can do that.' };
  const next = ['lobby', 'live', 'ended'].includes(status) ? status : room.status;
  await deps.pool.query('UPDATE gameshow_rooms SET status=$1, updated_at=now() WHERE room_id=$2', [next, roomId]);
  await deps.pool.query('UPDATE gameshow_state SET rev=rev+1, updated_at=now() WHERE room_id=$1', [roomId]);
  if (next === 'ended') {
    // The game is over: the ~30KB/2.2s camera stills have no further audience, and
    // the leaderboard snapshot is the number the seats row keeps forever.
    await snapshotScores(deps, roomId).catch(() => {});
    await deps.pool.query('DELETE FROM gameshow_presence WHERE room_id=$1', [roomId]).catch(() => {});
  }
  return { ok: true, status: next };
}

/**
 * @description Bind room operations to one immutable dependency set.
 * @param {object} deps - { pool }.
 * @returns {object} Room service methods consumed by the router and host service.
 */
function createRoomService(deps) {
  return {
    access: (sub, id) => access(deps, sub, id),
    seatsOf: (id, db) => seatsOf(deps, id, db),
    createRoom: (sub, name, body) => createRoom(deps, sub, name, body),
    joinByCode: (sub, name, body) => joinByCode(deps, sub, name, body),
    addPodium: (sub, id, body) => addPodium(deps, sub, id, body),
    updateSeat: (sub, id, body) => updateSeat(deps, sub, id, body),
    leaveRoom: (sub, id) => leaveRoom(deps, sub, id),
    removeSeat: (sub, id, seatId) => removeSeat(deps, sub, id, seatId),
    tick: (sub, id) => tick(deps, sub, id),
    listRooms: (sub) => listRooms(deps, sub),
    leaderboard: (sub) => leaderboard(deps, sub),
    loadState: (sub, id) => loadState(deps, sub, id),
    sync: (sub, id, rev, seq) => sync(deps, sub, id, rev, seq),
    mutate: (id, sub, apply, opts) => mutate(deps, id, sub, apply, opts),
    resolveActor,
    storePresence: (sub, id, seatId, bytes, mime) => storePresence(deps, sub, id, seatId, bytes, mime),
    loadPresence: (sub, id, seatId) => loadPresence(deps, sub, id, seatId),
    setStatus: (sub, id, status) => setStatus(deps, sub, id, status),
    react: (sub, name, id, emoji) => react(deps, sub, name, id, emoji),
    appendEvent,
  };
}

module.exports = { createRoomService, resolveActor, MAX_PRESENCE_BYTES };
