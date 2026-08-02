/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-21 19:52:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract the shared tabletop state, renderer, captions, and direct map interaction from the HTML surface so browser logic remains independently testable and below the file-size limit.
 * 2026-07-21 20:02:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Track queued combat-die presentations so overlapping rolls remain visible instead of being discarded.
 * 2026-07-21 20:08:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Decompose board pointer handling into setup, free-roam, targeting, and movement helpers while preserving inspect-only access to other heroes.
 * 2026-07-21 21:28:07 | roger.murphy@emeraldcoastsystemsgroup.com  | Track the active combat-die job so turn narration can await or cancel its visible presentation safely.
 * 2026-07-21 21:47:38 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep map interaction inspect-only while the shared Dungeon Master presentation gate is pending.
 * 2026-07-21 22:15:31 | roger.murphy@emeraldcoastsystemsgroup.com  | Move authoritative combat-die queue ownership into the focused structured-dice presentation module.
 * 2026-07-21 22:47:03 | roger.murphy@emeraldcoastsystemsgroup.com  | Extract board-background painting so every gameplay function remains below the enforced fifty-line limit.
 * 2026-07-21 23:08:58 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep a fleeing monster visible while its saved retreat and Dungeon Master narration are still being presented.
 * 2026-07-21 23:10:58 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep a newly defeated monster visible through its exact dice and narration so a rejected save can never look like resurrection.
 * 2026-07-21 23:12:03 | roger.murphy@emeraldcoastsystemsgroup.com  | Add opt-in request deadlines so a lost state or sync connection cannot freeze the tabletop pipeline forever.
 * 2026-07-22 00:18:41 | roger.murphy@emeraldcoastsystemsgroup.com  | Show narration captions immediately and bound presentation waits independently from asynchronous natural-voice playback.
 * 2026-07-22 01:03:46 | roger.murphy@emeraldcoastsystemsgroup.com  | Keep the caption for the line actually being spoken on screen, and reveal queued narration only when its natural audio starts.
 * 2026-07-22 01:45:06 | roger.murphy@emeraldcoastsystemsgroup.com  | Persist the authoritative position marker with every legal human move so action controls and server validation share one Move-to-Choose contract.
 * 2026-07-22 10:10:58 | roger.murphy@emeraldcoastsystemsgroup.com  | Let explicit tactical phases await natural playback within a bounded deadline while every other narration caller remains non-blocking by default.
 * 2026-07-23 09:30:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Let authoritative completed results immediately restore post-action movement even if a local presentation latch became stale.
 * 2026-07-23 00:31:18 | roger.murphy@emeraldcoastsystemsgroup.com  | Resolve saved generic monster labels through scene-authored identities so names remain names and tactical roles remain subtitles.
 * 2026-07-23 11:21:50 | roger.murphy@emeraldcoastsystemsgroup.com  | Hold stateful presentation until natural narration settles and allow post-action movement while the Dungeon Master speaks.
 * 2026-07-23 12:35:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Resolve scenes and preload maps across the selected multi-adventure catalog while applying campaign-specific table themes.
 */

'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Dungeon Master — CINEMATIC tabletop (v0.12). Painted battle-map backgrounds,
// AI character-portrait tokens, animated movement/attacks/spells, floating
// damage, and DM voiceover captions — a TV show you play. Rules run on the
// shared, tested engine (ui/engine.js); this file is the view + the show.
// Multiplayer (join codes, claims, rev-sync), multi-scene arcs, level-up, TV
// mode, and the DM bot are all preserved from v0.3. v0.12 makes every automated
// phase explicit and keeps downed heroes on the board for visible death saves.
// Open CC-BY SRD 5.1.
// ─────────────────────────────────────────────────────────────────────────────
const ENG = window.DnDEngine;
const API = '/api/dnd';
const params = new URLSearchParams(location.search);
const TV = params.get('mode') === 'tv';

let content = null, campaign = null, players = [], board = null;
let rev = 0, sheetsRev = '', lastSeq = 0, selected = null, selectedAction = null;
let confirmedBoard = null, confirmedBoardRev = 0, confirmedCampaignId = '';
let campaignEpoch = 0;
let archiveSeenSeq = new Set();
let reachable = new Set(), movementCosts = new Map(), boardSheets = {}, inspect = null;
let voiceOn = true, recapDone = false;
let savedCharacters = [], menuRequest = 0, sharedRollPresentation = '';
let cell = 40, dpr = 1;

const $ = (id) => document.getElementById(id);
const cvs = $('board'), ctx = cvs.getContext('2d');
const now = () => (window.performance ? performance.now() : Date.now());
const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(pathname, opts) {
  const options = Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {});
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0); delete options.timeoutMs;
  const controller = timeoutMs && !options.signal && typeof AbortController === 'function'
    ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  if (controller) options.signal = controller.signal;
  try {
    const response = await fetch(API + pathname, options);
    return response.json();
  } finally { if (timer) clearTimeout(timer); }
}
const keyOf = (x, y) => x + ',' + y;
const cheb = ENG.cheb;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Art (portrait tokens + painted maps), preloaded once ─────────────────────
const art = { tokens: {}, maps: {}, ready: false };
function loadArt() {
  const add = (bag, key, url) => { const im = new Image(); im.src = url; bag[key] = im; };
  content.heroes.forEach((h) => add(art.tokens, h.id, `${API}/art/token/${h.id}`));
  Object.keys(content.monsters).forEach((k) => add(art.tokens, k, `${API}/art/token/${k}`));
  (content.adventures || [content.adventure]).forEach((adventure) => {
    (adventure.scenes || []).forEach((scene) => add(art.maps, scene.id, `${API}/art/map/${scene.id}`));
  });
  art.ready = true;
}
const tokenImg = (t) => art.tokens[t.kind === 'pc' ? t.slug : t.ref];

// ── Control ownership ────────────────────────────────────────────────────────
const isOwner = () => !TV && !!(campaign && campaign.is_owner);
const myClaims = () => players.filter((p) => p.me && p.slug).map((p) => p.slug);
const claimedBy = (slug) => players.find((p) => p.slug === slug);
const isAICompanion = (token) => !!(token && token.kind === 'pc' && !claimedBy(token.slug));
function sceneTokenDefinition(token) {
  const scene = SC();
  if (!token || !scene) return null;
  if (token.kind === 'monster') return (scene.monsters || []).find((entry) => entry.instanceId === token.id) || null;
  // A figure cast from a discovered lead has no authored props entry — it carries its
  // own identity, so inspecting it must fall through to the token instead of blanking.
  if (token.kind === 'prop') return (scene.props || []).find((entry) => entry.id === token.id) || (token.leadId ? token : null);
  return null;
}
function tokenDisplayName(token) {
  const authored = sceneTokenDefinition(token);
  return String(authored && authored.name || token && token.name || '').trim();
}
function tokenRoleLabel(token) {
  const authored = sceneTokenDefinition(token);
  return String(authored && authored.role || token && token.role || '').trim();
}
function tokenPersonality(token) {
  const authored = sceneTokenDefinition(token);
  return String(authored && authored.personality || token && token.personality || '').trim();
}
function shortTokenLabel(token) {
  if (!token) return '';
  return tokenDisplayName(token).split(/[\s,]/)[0];
}
function controllerLabel(token) {
  if (!token || token.kind !== 'pc') return '';
  const seat = claimedBy(token.slug);
  return !seat ? 'AI Companion' : seat.me ? 'You' : seat.name.split(/[\s@]/)[0];
}
function controls(token) {
  if (TV || !token || token.kind !== 'pc') return false;
  return myClaims().includes(token.slug);
}

// ── Scene + world handle (state the engine reads) ────────────────────────────
function adventureById(id) {
  const adventures = content && content.adventures || [];
  return adventures.find((entry) => entry.id === id) || content.adventure || adventures[0];
}
function activateAdventure(id) {
  const adventure = adventureById(id);
  if (!adventure) return null;
  content.adventure = adventure;
  document.body.dataset.campaignTheme = adventure.theme && adventure.theme.id || 'classic-fantasy';
  return adventure;
}
function SC() {
  const adventure = adventureById(board && board.adventureId);
  const scenes = adventure && adventure.scenes || [];
  return scenes.find((entry) => entry.id === (board && board.sceneId)) || scenes[0];
}
function sheetOf(t) { return t.kind === 'pc' ? content.heroes.find((h) => h.id === t.slug) : content.monsters[t.ref]; }
function actionsOf(t) { const live = boardSheets[t.slug]; return (live && live.actions) || ((sheetOf(t) || {}).actions || []); }
const isDowned = (t) => !!(ENG.isDowned ? ENG.isDowned(t) : t && t.kind === 'pc' && t.downed && !t.dead && !t.fled);
const isStable = (t) => !!(isDowned(t) && t.stable);
const isConscious = (t) => !!(ENG.isConscious ? ENG.isConscious(t) : t && !t.dead && !t.fled && !t.downed);
const living = (kind) => board.tokens.filter((t) => t.kind === kind && !t.dead && !t.fled && (kind !== 'pc' || !t.downed));
const canTakeTurn = (t) => !!(t && !t.dead && !t.fled && (t.kind !== 'pc' || !isStable(t)));
const deathSaveScore = (t) => ({
  successes: Math.max(0, Number(t && t.deathSaves && t.deathSaves.successes) || 0),
  failures: Math.max(0, Number(t && t.deathSaves && t.deathSaves.failures) || 0),
});
const deathSaveResolvedThisTurn = (t) => !!(t && t.deathSaves &&
  Number(t.deathSaves.turnSerial) === Number(board && board.turnSerial));
const turnStoryPending = (t) => !!(t && t.turnResult && Number(t.turnResult.serial) === Number(board && board.turnSerial) && !t.turnResult.complete);
const movementStoryPending = (t) => !!(t && t.movementResult && Number(t.movementResult.serial) === Number(board && board.turnSerial) && !t.movementResult.complete);
const hasDeathSaveResult = (t) => !!(t && t.kind === 'pc' && deathSaveResolvedThisTurn(t) && t.turnResult &&
  Number(t.turnResult.serial) === Number(board && board.turnSerial));
const activeToken = () => board.tokens.find((t) => t.id === board.order[board.turnIndex]);
let blockSet = new Set(), diffSet = new Set(), blockKind = {};
function indexTerrain() {
  blockSet = new Set(); diffSet = new Set(); blockKind = {};
  const ter = (SC() && SC().terrain) || {};
  (ter.blocking || []).forEach((c) => { blockSet.add(keyOf(c.x, c.y)); blockKind[keyOf(c.x, c.y)] = c.kind; });
  (ter.difficult || []).forEach((c) => diffSet.add(keyOf(c.x, c.y)));
}
function W() {
  return { grid: SC().grid, blockSet, diffSet, tokens: board.tokens,
    sheetFor: (t) => t.kind === 'pc' ? (boardSheets[t.slug] || sheetOf(t)) : (t.kind === 'monster' ? content.monsters[t.ref] : {}) };
}

// Engine delegations — the surface calls the SAME code the tests exercise.
const unitFeet = () => (SC() && SC().grid && SC().grid.unitFeet) || 5;
const movementLeft = (t) => t && Number.isFinite(Number(t.moveRemaining))
  ? Math.max(0, Number(t.moveRemaining)) : Math.max(0, Number(t && t.speed) || 0);
const positionChosen = (t) => !!(t && t.positionSet);
function clearReachable() { reachable = new Set(); movementCosts = new Map(); }
function computeReachable(t) {
  movementCosts = t ? ENG.computeMovementCosts(W(), { ...t, speed: movementLeft(t) }) : new Map();
  reachable = new Set();
  if (t) movementCosts.forEach((_cost, k) => { if (k !== keyOf(t.x, t.y)) reachable.add(k); });
}
// Out of combat you can walk your hero anywhere the map allows (no turn budget).
function freeReachable(t) {
  movementCosts = t ? ENG.computeMovementCosts(W(), { ...t, speed: (t.speed || 30) * 8 }) : new Map();
  reachable = new Set();
  if (t) movementCosts.forEach((_cost, k) => { if (k !== keyOf(t.x, t.y)) reachable.add(k); });
}
const validTargets = (a, act) => ENG.validTargets(W(), a, act);
const resolveAction = (a, act, t) => ENG.resolveAction(W(), a, act, t);

// ── Cinematic renderer + animation ───────────────────────────────────────────
const rp = {};              // token id → eased pixel position
let fx = [], floaters = [], embers = [];
let telegraph = null;
const combatTelegraph = () => telegraph || (board && board.telegraph) || null;
const cc = (t) => ({ x: t.x * cell + cell / 2, y: t.y * cell + cell / 2 });

function layout() {
  const g = SC().grid, st = $('stage');
  dpr = window.devicePixelRatio || 1;
  const w = st.clientWidth, h = st.clientHeight;
  cell = Math.floor(Math.min(w / g.w, h / g.h));
  const cw = cell * g.w, chh = cell * g.h;
  cvs.style.width = cw + 'px'; cvs.style.height = chh + 'px';
  cvs.style.left = Math.floor((w - cw) / 2) + 'px'; cvs.style.top = Math.floor((h - chh) / 2) + 'px'; cvs.style.margin = '0';
  cvs.width = cw * dpr; cvs.height = chh * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  Object.keys(rp).forEach((k) => delete rp[k]); // no glide across relayouts/scenes
  embers = Array.from({ length: 26 }, () => newEmber(cw, chh, true));
}
function newEmber(w, h, spread) { return { x: Math.random() * w, y: spread ? Math.random() * h : h + 5, vy: 6 + Math.random() * 14, vx: (Math.random() - 0.5) * 6, r: 0.6 + Math.random() * 1.6, a: 0.15 + Math.random() * 0.35 }; }

function easeAll(dt) {
  if (!board) return;
  const k = Math.min(1, dt / 90);
  board.tokens.forEach((t) => { const c = cc(t); let p = rp[t.id]; if (!p) { p = { x: c.x, y: c.y }; rp[t.id] = p; } p.x += (c.x - p.x) * k; p.y += (c.y - p.y) * k; });
  const g = SC().grid, W2 = cell * g.w, H2 = cell * g.h;
  embers.forEach((e) => { e.y -= e.vy * dt / 1000; e.x += e.vx * dt / 1000; if (e.y < -5) Object.assign(e, newEmber(W2, H2, false)); });
  const t = now();
  fx = fx.filter((f) => t - f.t0 < f.dur);
  floaters = floaters.filter((f) => t - f.t0 < f.dur);
}

function drawBoardBackground(width, height) {
  const map = art.maps[board.sceneId];
  if (map && map.complete && map.naturalWidth) ctx.drawImage(map, 0, 0, width, height);
  else { ctx.fillStyle = '#1c1712'; ctx.fillRect(0, 0, width, height); }
}

function defeatPresentationPending(token) {
  const actor = board && board.mode === 'combat' ? activeToken() : null;
  const event = turnStoryPending(actor) && actor.turnResult && actor.turnResult.rollEvent;
  return !!(token && token.dead && event && Array.isArray(event.rolls)
    && event.rolls.some((roll) => roll && roll.targetId === token.id));
}

function draw() {
  if (!board) return;
  const g = SC().grid, W2 = cell * g.w, H2 = cell * g.h;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  // painted map background (cover-fit) + contrast darken + vignette
  drawBoardBackground(W2, H2);
  ctx.fillStyle = 'rgba(9,7,5,.12)'; ctx.fillRect(0, 0, W2, H2);           // light touch — keep the map readable
  const vg = ctx.createRadialGradient(W2 / 2, H2 / 2, Math.min(W2, H2) * 0.58, W2 / 2, H2 / 2, Math.max(W2, H2) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.28)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W2, H2);
  // subtle grid
  ctx.strokeStyle = 'rgba(210,180,130,.12)'; ctx.lineWidth = 1;
  for (let x = 0; x <= g.w; x++) { ctx.beginPath(); ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, H2); ctx.stroke(); }
  for (let y = 0; y <= g.h; y++) { ctx.beginPath(); ctx.moveTo(0, y * cell); ctx.lineTo(W2, y * cell); ctx.stroke(); }
  // functional terrain drawn as clear game pieces (the real board, over the art)
  diffSet.forEach((k) => { const [x, y] = k.split(',').map(Number); ctx.fillStyle = 'rgba(40,80,30,.28)'; ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2); });
  blockSet.forEach((k) => { const [x, y] = k.split(',').map(Number); drawBlock(x, y, blockKind[k]); });
  // Legal movement destinations. Dim the art slightly, then draw a crisp blue
  // tile + destination dot. On larger boards, label the movement cost too.
  if (selected && !selectedAction && controls(selected)) {
    ctx.fillStyle = 'rgba(3,8,18,.20)'; ctx.fillRect(0, 0, W2, H2);
    const pulse = 0.28 + 0.07 * Math.sin(now() / 320);
    reachable.forEach((k) => {
      const [x, y] = k.split(',').map(Number), px = x * cell, py = y * cell;
      ctx.fillStyle = `rgba(37,126,214,${pulse})`; ctx.fillRect(px + 2, py + 2, cell - 4, cell - 4);
      ctx.strokeStyle = 'rgba(132,204,255,.95)'; ctx.lineWidth = Math.max(1.5, cell * 0.035);
      ctx.strokeRect(px + 3, py + 3, cell - 6, cell - 6);
      ctx.fillStyle = '#d8f1ff'; ctx.beginPath(); ctx.arc(px + cell / 2, py + cell / 2, Math.max(2.5, cell * 0.055), 0, 7); ctx.fill();
      if (cell >= 48) {
        const feet = (movementCosts.get(k) || 0) * unitFeet();
        ctx.font = `600 ${Math.max(9, Math.floor(cell * 0.16))}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(235,248,255,.92)'; ctx.fillText(`${feet} ft`, px + cell / 2, py + cell - 6);
      }
    });
  }
  // targetable enemies
  if (selectedAction && selected) validTargets(selected, selectedAction).forEach((t) => ring(cc(t), cell * 0.5, 'rgba(220,80,60,.95)', 3));
  // embers behind tokens
  embers.forEach((e) => { ctx.globalAlpha = e.a; ctx.fillStyle = '#e8a23a'; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1;
  // tokens, depth-sorted
  // Defeated monsters leave the board. Heroes at 0 HP stay visibly prone so a
  // player never wonders where their character went and can still be healed.
  board.tokens.filter((t) => (!t.fled || turnStoryPending(t))
    && (!t.dead || t.kind === 'pc' || defeatPresentationPending(t))).sort((a, b) => a.y - b.y).forEach(drawToken);
  if (combatTelegraph()) drawCombatTelegraph();
  // effects + floaters on top
  fx.forEach(renderFx);
  floaters.forEach(renderFloater);
}

function ring(p, r, color, w) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke(); }
function drawCombatTelegraph() {
  const warning = combatTelegraph(); if (!warning) return;
  const actor = board.tokens.find((t) => t.id === warning.actorId && !t.dead && !t.fled);
  const target = board.tokens.find((t) => t.id === warning.targetId && !t.dead && !t.fled);
  if (!actor || !target) return;
  const a = rp[actor.id] || cc(actor), b = rp[target.id] || cc(target);
  ctx.save(); ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(255,91,68,.95)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  ring(a, cell * .5, 'rgba(255,190,82,.98)', 4); ring(b, cell * .54, 'rgba(255,72,60,.98)', 5);
  ctx.fillStyle = '#ffd8cf'; ctx.font = `700 ${Math.max(9, Math.floor(cell * .15))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('TARGET', b.x, b.y - cell * .54); ctx.restore();
}
function rrect(x, y, w, h, r) { if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); } else { ctx.beginPath(); ctx.rect(x, y, w, h); } }
/** A blocking cell drawn as a recognizable, semi-opaque game piece over the map. */
function drawBlock(x, y, kind) {
  const px = x * cell, py = y * cell, cx = px + cell / 2, cy = py + cell / 2, r = cell * 0.34;
  ctx.save();
  ctx.fillStyle = 'rgba(8,6,5,.30)'; rrect(px + 2, py + 2, cell - 4, cell - 4, 6); ctx.fill();
  if (kind === 'cart') {
    ctx.fillStyle = 'rgba(126,86,44,.95)'; rrect(px + cell * 0.16, py + cell * 0.26, cell * 0.68, cell * 0.42, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(50,32,16,.95)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px + cell * 0.32, py + cell * 0.76, cell * 0.11, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(px + cell * 0.68, py + cell * 0.76, cell * 0.11, 0, 7); ctx.stroke();
  } else if (kind === 'rock') {
    ctx.fillStyle = 'rgba(122,118,112,.95)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(158,154,148,.6)'; ctx.beginPath(); ctx.arc(cx - r * 0.32, cy - r * 0.3, r * 0.5, 0, 7); ctx.fill();
  } else if (kind === 'fire') {
    ctx.fillStyle = 'rgba(206,72,20,.96)'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(252,196,66,.96)'; ctx.beginPath(); ctx.arc(cx, cy - 2, r * 0.46, 0, 7); ctx.fill();
  } else if (kind === 'cage') {
    ctx.strokeStyle = 'rgba(186,166,124,.96)'; ctx.lineWidth = 2.5;
    rrect(px + cell * 0.2, py + cell * 0.2, cell * 0.6, cell * 0.6, 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, py + cell * 0.2); ctx.lineTo(cx, py + cell * 0.8); ctx.stroke();
  } else { // tree
    ctx.fillStyle = 'rgba(28,62,30,.95)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(48,92,44,.9)'; ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.25, r * 0.55, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function drawToken(t) {
  const base = rp[t.id] || cc(t);
  const lo = lungeOffset(t);
  const p = { x: base.x + lo.x, y: base.y + lo.y };
  const r = cell * 0.42;
  if (t.kind === 'prop') {
    ctx.font = `${Math.floor(cell * 0.6)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(p.x, p.y + r * 0.7, r * 0.5, 0, 7); ctx.fill();
    ctx.fillText(t.glyph || '•', p.x, p.y);
    nameplate(p, r, t.name.split(' ').slice(-1)[0]); return;
  }
  const active = activeToken() && activeToken().id === t.id;
  const rim = t.kind === 'pc' ? (t.color || '#3b82f6') : '#ef5030';
  // ground shadow lifts the token off the map
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + r * 0.9, r * 0.88, r * 0.34, 0, 0, 7); ctx.fill();
  // bright coin backing so even a dark portrait (goblins!) separates from the art
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 8;
  ctx.fillStyle = active ? 'rgba(60,48,28,.95)' : 'rgba(26,22,18,.92)'; ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, 7); ctx.fill(); ctx.restore();
  if (active) { ctx.save(); ctx.shadowColor = '#f0bf68'; ctx.shadowBlur = 26; ring(p, r + 4, 'rgba(240,191,104,.98)', 4.5); ctx.restore(); }
  // portrait clipped to a circle (fallback: team disc + glyph)
  const img = tokenImg(t);
  ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.clip();
  if (img && img.complete && img.naturalWidth) ctx.drawImage(img, p.x - r, p.y - r, r * 2, r * 2);
  else { ctx.fillStyle = t.kind === 'pc' ? (t.color || '#3b82f6') : '#7a2018'; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); ctx.fillStyle = '#0d0b09'; ctx.font = `${Math.floor(cell * 0.44)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t.glyph || '@', p.x, p.y); }
  if (isDowned(t) || t.dead || t.fled) { ctx.fillStyle = isDowned(t) ? 'rgba(48,8,8,.56)' : 'rgba(12,10,8,.72)'; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); }
  ctx.restore();
  // triple rim (dark → team → light) so it reads on bright OR dark map + HP arc
  ring(p, r, 'rgba(0,0,0,.9)', 5);
  ring(p, r - 0.5, rim, 3);
  ring(p, r - 2.5, 'rgba(255,246,225,.4)', 1.4);
  if (isDowned(t)) {
    ring(p, r + 3, 'rgba(255,82,68,.98)', 4);
    ctx.fillStyle = '#fff0e8'; ctx.font = `800 ${Math.max(9, Math.floor(cell * 0.16))}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t.stable ? 'STABLE' : 'DOWN', p.x, p.y);
  } else if (!t.dead && !t.fled) hpArc(p, r + 3, t);
  else { ctx.fillStyle = 'rgba(230,210,180,.9)'; ctx.font = `${Math.floor(cell * 0.5)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t.fled ? '»' : '✕', p.x, p.y); }
  const owner = t.kind === 'pc' && claimedBy(t.slug);
  const condition = isDowned(t) ? (t.stable ? ' · STABLE' : ' · DOWN') : t.kind === 'pc' && t.dead ? ' · FALLEN' : '';
  nameplate(p, r, shortTokenLabel(t) + (owner ? ' · ' + (owner.me ? 'You' : owner.name.split(/[\s@]/)[0]) : t.kind === 'pc' ? ' · AI Companion' : '') + condition);
}
function hpArc(p, r, t) {
  const frac = Math.max(0, t.hp / t.maxHp);
  ctx.lineWidth = 3.5; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(p.x, p.y, r, -Math.PI * 0.75, Math.PI * 0.75); ctx.stroke();
  ctx.strokeStyle = frac > 0.5 ? '#6fbf73' : frac > 0.25 ? '#e0a44c' : '#e0503a';
  ctx.beginPath(); ctx.arc(p.x, p.y, r, -Math.PI * 0.75, -Math.PI * 0.75 + Math.PI * 1.5 * frac); ctx.stroke();
}
function nameplate(p, r, text) {
  ctx.font = `${Math.max(9, Math.floor(cell * 0.19))}px "Iowan Old Style", Georgia, serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 8, y = p.y + r + cell * 0.2;
  ctx.fillStyle = 'rgba(10,8,6,.66)'; ctx.beginPath();
  (ctx.roundRect ? ctx.roundRect(p.x - w / 2, y - cell * 0.13, w, cell * 0.26, 5) : ctx.rect(p.x - w / 2, y - cell * 0.13, w, cell * 0.26)); ctx.fill();
  ctx.fillStyle = '#e7dcc6'; ctx.fillText(text, p.x, y);
}

// Lunge + effects
function lungeOffset(t) {
  if (!t._lungeT0) return { x: 0, y: 0 };
  const k = (now() - t._lungeT0) / 240; if (k >= 1) { t._lungeT0 = 0; return { x: 0, y: 0 }; }
  const amp = Math.sin(k * Math.PI) * cell * 0.42; return { x: (t._ldx || 0) * amp, y: (t._ldy || 0) * amp };
}
function floater(t, text, color) { const p = cc(t); floaters.push({ x: p.x, y: p.y - cell * 0.4, text, color, t0: now(), dur: 1150 }); }
function renderFloater(f) {
  const k = (now() - f.t0) / f.dur;
  ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.font = `bold ${Math.floor(cell * 0.34)}px "Iowan Old Style", Georgia, serif`;
  ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
  ctx.strokeText(f.text, f.x, f.y - k * cell * 0.9); ctx.fillText(f.text, f.x, f.y - k * cell * 0.9); ctx.globalAlpha = 1;
}
const DMG_COLOR = { fire: '#ff7a2e', force: '#a855f7', radiant: '#ffd85e', piercing: '#d7c9b0', slashing: '#d7c9b0', bludgeoning: '#d7c9b0', psychic: '#e05aa8' };
function spellFx(actor, action, aim) {
  const from = cc(actor), to = cc(aim || actor);
  const type = (action.damage && action.damage.type) || (action.mode === 'heal' ? 'heal' : 'slashing');
  if (action.mode === 'heal') { fx.push({ kind: 'sparkle', at: to, color: '#7ff0a0', t0: now(), dur: 900 }); return; }
  if (action.aoeShape === 'cone') { fx.push({ kind: 'cone', from, to, color: '#ff7a2e', t0: now(), dur: 620 }); return; }
  if (action.mode === 'autohit') { for (let i = 0; i < (action.darts || 3); i++) fx.push({ kind: 'streak', from, to, color: DMG_COLOR.force, t0: now() + i * 90, dur: 420 }); return; }
  if (action.delivery === 'ranged') { fx.push({ kind: type === 'radiant' ? 'beam' : 'streak', from, to, color: DMG_COLOR[type] || '#ffd85e', t0: now(), dur: type === 'radiant' ? 520 : 420 }); return; }
  fx.push({ kind: 'slash', at: to, color: '#fff2d6', t0: now(), dur: 300 });
}
function renderFx(f) {
  const k = Math.max(0, Math.min(1, (now() - f.t0) / f.dur));
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if (f.kind === 'streak' || f.kind === 'beam') {
    const x = f.from.x + (f.to.x - f.from.x) * (f.kind === 'beam' ? 1 : k);
    const y = f.from.y + (f.to.y - f.from.y) * (f.kind === 'beam' ? 1 : k);
    ctx.strokeStyle = f.color; ctx.globalAlpha = f.kind === 'beam' ? (1 - k) : 0.9; ctx.lineWidth = f.kind === 'beam' ? 7 : 4; ctx.lineCap = 'round';
    ctx.shadowColor = f.color; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.moveTo(f.from.x, f.from.y); ctx.lineTo(x, y); ctx.stroke();
    if (f.kind === 'streak' && k > 0.9) burstDots(f.to, f.color, (k - 0.9) * 10);
  } else if (f.kind === 'cone') {
    const ang = Math.atan2(f.to.y - f.from.y, f.to.x - f.from.x), spread = Math.PI / 4, len = cell * 3 * (0.5 + k * 0.5);
    const grad = ctx.createRadialGradient(f.from.x, f.from.y, 2, f.from.x, f.from.y, len);
    grad.addColorStop(0, `rgba(255,240,180,${0.9 * (1 - k)})`); grad.addColorStop(0.5, `rgba(255,110,40,${0.7 * (1 - k)})`); grad.addColorStop(1, 'rgba(120,20,0,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(f.from.x, f.from.y);
    ctx.arc(f.from.x, f.from.y, len, ang - spread, ang + spread); ctx.closePath(); ctx.fill();
  } else if (f.kind === 'slash') {
    ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.color; ctx.lineWidth = 3 + 4 * (1 - k); ctx.lineCap = 'round';
    const s = cell * 0.5; ctx.beginPath(); ctx.moveTo(f.at.x - s + k * s, f.at.y - s); ctx.lineTo(f.at.x + s, f.at.y + s - k * s); ctx.stroke();
  } else if (f.kind === 'sparkle') {
    for (let i = 0; i < 7; i++) { const a = i / 7 * 7 + k * 3, rr = cell * (0.15 + k * 0.5); ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.at.x + Math.cos(a) * rr, f.at.y - k * cell * 0.5 + Math.sin(a) * rr * 0.4, 2.2, 0, 7); ctx.fill(); }
  } else if (f.kind === 'burst') {
    ctx.globalAlpha = 1 - k; ring(f.at, cell * (0.2 + k * 0.7), f.color, 4 * (1 - k) + 1);
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
function burstDots(at, color, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 7, d = Math.random() * cell * 0.4; ctx.fillStyle = color; ctx.globalAlpha = Math.random(); ctx.beginPath(); ctx.arc(at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, 1.6, 0, 7); ctx.fill(); } ctx.globalAlpha = 1; }
function impact(t) { fx.push({ kind: 'burst', at: cc(t), color: '#fff0d0', t0: now(), dur: 320 }); }

/** Wrap a resolution so damage/heal/death animate. Returns the engine result. */
function withShow(actor, action, aim, fn) {
  const before = {}; board.tokens.forEach((t) => { before[t.id] = t.hp; });
  if (action.delivery === 'melee' && aim) { const a = cc(actor), b = cc(aim); const d = Math.hypot(b.x - a.x, b.y - a.y) || 1; actor._lungeT0 = now(); actor._ldx = (b.x - a.x) / d; actor._ldy = (b.y - a.y) / d; }
  spellFx(actor, action, aim);
  const res = fn();
  board.tokens.forEach((t) => {
    const d = before[t.id] - t.hp;
    if (d > 0) { floater(t, '-' + d, '#ff7a5a'); impact(t); }
    else if (d < 0) floater(t, '+' + (-d), '#7ff0a0');
    if (before[t.id] > 0 && t.hp <= 0) fx.push({ kind: 'burst', at: cc(t), color: '#c25', t0: now(), dur: 480 });
  });
  return res;
}

// ── Cinematic caption (DM voiceover over the scene) ─────────────────────────
// A caption appears as soon as narration is requested, remains held through
// natural playback, and then keeps a readable tail. Tactical captions arriving
// meanwhile wait instead of replacing words the Dungeon Master is still saying.
let capTimer = null, capHideTimer = null, capSerial = 0, heldCaption = null, pendingCaption = null;
const captionReadMs = (text) => Math.min(60000, Math.max(5200, 2200 + String(text || '').length * 90));
function captionExcerpt(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 260) return clean;
  const first = clean.slice(0, 257), stop = Math.max(first.lastIndexOf('. '), first.lastIndexOf('! '), first.lastIndexOf('? '));
  return (stop > 110 ? first.slice(0, stop + 1) : first) + '…';
}
function dismissCaption() {
  const el = $('caption'); clearTimeout(capTimer); clearTimeout(capHideTimer); capTimer = null;
  heldCaption = null; pendingCaption = null;
  el.classList.remove('show'); capHideTimer = setTimeout(() => el.classList.add('hidden'), 220);
}
function caption(text, options) {
  if (!text) return null;
  const opts = options || {};
  if (heldCaption) {
    if (!opts.hold) pendingCaption = String(text);
    return null;
  }
  clearTimeout(capHideTimer); capHideTimer = null; clearTimeout(capTimer); capTimer = null;
  const el = $('caption'); el.textContent = captionExcerpt(text); el.title = 'Full narration is in Story · tap to dismiss'; el.tabIndex = 0;
  el.setAttribute('role', 'button'); el.setAttribute('aria-label', `${captionExcerpt(text)} — tap to dismiss`);
  if (!el._dismissReady) { el._dismissReady = true; el.onclick = dismissCaption; el.onkeydown = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dismissCaption(); } }; }
  el.classList.remove('hidden'); el.classList.add('show');
  const id = ++capSerial, ms = captionReadMs(text);
  if (opts.hold) heldCaption = { id, startedAt: Date.now(), minMs: ms };
  else capTimer = setTimeout(dismissCaption, ms);
  return id;
}
function releaseSpokenCaption(id) {
  if (!heldCaption || heldCaption.id !== id) return;
  const held = heldCaption; heldCaption = null;
  if (pendingCaption) {
    const pending = pendingCaption; pendingCaption = null; caption(pending); return;
  }
  const remaining = Math.max(900, held.minMs - (Date.now() - held.startedAt));
  clearTimeout(capTimer); capTimer = setTimeout(dismissCaption, remaining);
}
function speakCaption(text, priority) {
  let captionId = caption(text, { hold: true });
  const lifecycle = {
    onStart: () => { if (!captionId) captionId = caption(text, { hold: true }); },
    onDone: () => releaseSpokenCaption(captionId),
    onSkip: () => { if (captionId) releaseSpokenCaption(captionId); else caption(text); },
  };
  try {
    return Promise.resolve(speak(text, priority, lifecycle)).catch(() => {
      if (captionId) releaseSpokenCaption(captionId); else caption(text);
      return 'unavailable';
    });
  } catch (_error) {
    if (captionId) releaseSpokenCaption(captionId); else caption(text);
    return Promise.resolve('unavailable');
  }
}
async function presentPhase(text, minimumMs, priority, onSpeechSettled, maximumMs) {
  let settled = false, status = 'playing', settlePhase;
  const settledPhase = new Promise((resolve) => { settlePhase = resolve; });
  const finish = (result) => {
    settled = true; status = result || 'unavailable';
    if (onSpeechSettled) onSpeechSettled(status);
    settlePhase(status);
  };
  try { void Promise.resolve(speakCaption(text, priority)).then(finish, () => finish('unavailable')); }
  catch (_error) { finish('unavailable'); }
  const minimum = Math.max(0, Number(minimumMs) || 0);
  const maximum = Math.max(minimum, Number(maximumMs) || minimum);
  await waitMs(minimum);
  if (!settled && maximum > minimum) await Promise.race([settledPhase, waitMs(maximum - minimum)]);
  if (!settled) await settledPhase;
  return status;
}

// ── Interaction ──────────────────────────────────────────────────────────────
function boardPoint(event) {
  const rect = cvs.getBoundingClientRect();
  return {
    x: Math.floor((event.clientX - rect.left) / cell),
    y: Math.floor((event.clientY - rect.top) / cell),
  };
}
function tokenAtPoint(point, myTurn) {
  const stacked = board.tokens.filter((token) => !token.fled && (!token.dead || token.kind === 'pc') && token.x === point.x && token.y === point.y);
  const legal = myTurn && selected && selectedAction
    ? validTargets(selected, selectedAction).find((candidate) => stacked.some((token) => token.id === candidate.id))
    : null;
  return legal || stacked.find((token) => token.kind === 'monster' && !token.dead) || stacked.find(isConscious) || stacked[0];
}
function inspectSetupToken(token) {
  if (token && token.kind === 'pc') showCharacterSheet(token);
  else { selected = null; clearReachable(); inspect = null; renderDock(); }
}
function handleFreeRoamPointer(token, point) {
  if (token && token.kind === 'pc' && controls(token)) {
    selected = token; inspect = token; freeReachable(token); renderDock();
    banner(`Walking ${shortTokenLabel(token)} — tap where to go`); return;
  }
  if (selected && controls(selected) && !token && reachable.has(keyOf(point.x, point.y))) {
    selected.x = point.x; selected.y = point.y; freeReachable(selected); persist(); return;
  }
  if (token && token.kind === 'pc') { showCharacterSheet(token); return; }
  selected = null; clearReachable(); inspect = null; renderDock();
}
function handleActionTarget(token) {
  if (token && token.kind !== 'prop' && validTargets(selected, selectedAction).some((candidate) => candidate.id === token.id)) doAction(token);
  else { selectedAction = null; renderDock(); }
}
function handleMovementTarget(point) {
  const destination = keyOf(point.x, point.y);
  if (!reachable.has(destination)) {
    banner(movementLeft(selected) > 0 ? 'That square is not a legal destination — choose a blue tile.' : 'No movement left this turn — choose an action or end the turn.');
    return;
  }
  const spent = (movementCosts.get(destination) || 0) * unitFeet();
  selected.x = point.x; selected.y = point.y;
  selected.moveRemaining = Math.max(0, movementLeft(selected) - spent);
  selected.moved = selected.moveRemaining < selected.speed; selected.positionSet = true;
  computeReachable(selected); persist(); renderDock();
  banner(`${shortTokenLabel(selected)} moves ${spent} ft · ${movementLeft(selected)} ft left`);
}
function onBoardPointerDown(event) {
  if (TV || !board) return;
  const point = boardPoint(event), active = activeToken(), presenting = presentationGatePending();
  const myTurn = !presenting && board.mode === 'combat' && active && active.kind === 'pc'
    && controls(active) && !isDowned(active) && (!turnStoryPending(active) || active.acted);
  const token = tokenAtPoint(point, myTurn);
  if (presenting) { if (token && token.kind === 'pc') showCharacterSheet(token); else presentationGateBlocksInput(); return; }
  if (board.mode === 'setup') { inspectSetupToken(token); return; }
  if (board.mode !== 'combat') { handleFreeRoamPointer(token, point); return; }
  if (myTurn && selected && selectedAction) { handleActionTarget(token); return; }
  if (myTurn && selected && !selectedAction && !token) { handleMovementTarget(point); return; }
  if (token && token.kind === 'pc') showCharacterSheet(token);
}
cvs.addEventListener('pointerdown', onBoardPointerDown);
