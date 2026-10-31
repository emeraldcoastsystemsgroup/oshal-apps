/**
 * Eats Routes: the food-delivery concierge surface API.
 *
 * Backs the Eats surface at /cockpit?app=eats. The shape, as of 1.4.0:
 *  - RESTAURANTS are real: Google Places (./places) finds the restaurants near the diner's delivery address,
 *    through the native kernel's fenced egress with the kernel-held key. The package never holds the key.
 *  - ORDERING is a hand-off into Uber Eats (./uber-link): the link opens ubereats.com at the diner's resolved
 *    address with the chosen restaurant searched, and the diner picks the dishes, confirms and pays there on
 *    their own sign-in. Uber publishes no consumer API, so there is no menu, cart or price in this package:
 *    nothing here pretends to know what a restaurant sells.
 *  - The BRAIN runs on the eats-concierge bot through the accountable bot path, never a hard-coded LLM call.
 *  - Profile, remembered notes, conversations and the hand-off history persist per diner, scoped by the OIDC sub.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * ---------------------------------------------------------------------------
 * (1.0 to 1.3.6: the Uber Eats provider helper, the curated catalog, the menu-priced cart and the confirmation-gated
 * deep link; see git history.)
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: the place cache (./place-cache, migration 041). Address resolutions, searches and restaurant cards are saved per person for Google's 30-day limit; a saved search younger than a day is served without asking Google, Refresh asks again, and at Google's quota (or with Google unreachable) the saved answer within 30 days is served with its saved time and the reason. The search is a POST (the page, the chat and the Jarvis tool), because the native kernel admits no write on a GET; GET /search still answers, reading the cache but never writing it. Guards: tests/eats-routes.test.js (the cache cases), tests/eats-place-cache.test.js.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.4.2: coordinates (Use location, sent as lat/lng or as the "lat, lng" address text) resolve through the Geocoding API's reverse lookup instead of a Places text search, which refuses them live. Guard: tests/eats-routes.test.js (the coordinates case), tests/places-client.test.js.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: real restaurants. The curated five-restaurant catalog, the menu and the cart are gone: search resolves the delivery address and lists the restaurants Google Places finds around it (rating, price level, open now, delivery, distance, photo); POST /order records a hand-off and answers the Uber Eats search link at that address for the chosen restaurant; the chat turn offers those restaurants by place id and an "order" choice becomes a confirm proposal; /config names the rail; a Places refusal (key not configured, API not enabled, quota) is answered in words, never as an empty result. Guards: tests/eats-routes.test.js, tests/places-client.test.js, tests/uber-link.test.js, tests/eats-places-unavailable.test.js.
 * ---------------------------------------------------------------------------
 *
 * @module eats-routes
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/logger';
import { buildOwnerRlsPolicyStatements, runRuntimeSchemaBootstrap } from '@/shared/services/database';
import type { AppContext } from '@/app/composition/app-context';
import type { Pool } from 'pg';
import { getTrustedServiceUserSub } from '@/shared/middleware/authz';
import { ConciergeStore } from '@/app/routes/concierge-store';
import { cleanConciergeReply } from '@/app/routes/concierge-reply';
import { forgetNote, rememberedList } from './remembered-notes';
import { allergyCheckLine, dinerRestrictions, holdConflicting, restrictionPrompt, unwarnedMentions, type Conflict, type Restriction } from './allergen-check';
import { CONNECTOR, PHOTO_NAME, PLACE_ID, PlacesError, SOURCE, geocode, photoUri, placeDetails, reverseGeocode, searchRestaurants, type FetchLike, type Geocoded, type Restaurant } from './places';
import { feedLink, searchLink } from './uber-link';
import { FRESH_MS, MAX_AGE_MS, isFresh, lookupKey, readLookup, readPlace, readSearch, searchKey, writeLookup, writePlaces, writeSearch } from './place-cache';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';

const logger = createChildLogger({ module: 'eats-routes' });

/** The eats-concierge reasoning agent. Reached through BotNodeClient so cost/audit remain attributable. */
const CONCIERGE_AGENT_ID = 'b0080000-0000-0000-0000-000000000001';
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** What /config says about this installation's rail. */
export const EATS_RAIL_NOTE = 'Restaurants come from Google Places for your delivery address; ordering opens Uber Eats at that address, where you choose the dishes, sign in and pay yourself.';
/** What a search without any address answers. */
export const ADDRESS_REQUIRED = 'Set your delivery address first (the Delivery address box, or Use location), so the restaurants found are the ones near you.';
/** What a search served from the cache says, with the saved time filled in by the page. */
export const SAVED_NOTE = 'Saved results: Google was not asked again because these are less than a day old. Press Refresh to ask Google now.';
/** What a search served from the cache at Google\'s quota says. */
export const QUOTA_NOTE = 'Google could not be asked (its limit for this key is reached or it is unreachable), so these are the results saved earlier.';
/** What the hand-off answer says. */
export const HANDOFF_NOTE = 'Opens Uber Eats at your delivery address with this restaurant searched. Sign in, pick the dishes and pay there; nothing is ordered or charged here.';

/** How long a search answer is reused for the same craving at the same address. */
const SEARCH_TTL_MS = 10 * 60 * 1000;
/** How long a photo URL is reused. */
const PHOTO_TTL_MS = 60 * 60 * 1000;
/** The most entries any cache keeps (oldest dropped first). */
const CACHE_MAX = 300;

/** In-process copies; `persisted` says whether the person's saved rows hold them yet (a GET may read but never write). */
const GEOCODE_CACHE = new Map<string, { place: Geocoded; persisted: boolean }>();
const SEARCH_CACHE = new Map<string, { at: number; restaurants: Restaurant[]; persisted: boolean }>();
const RESTAURANT_CACHE = new Map<string, Restaurant>();
const PHOTO_CACHE = new Map<string, { at: number; uri: string }>();

/** Keep one more entry, dropping the oldest past the cap. */
function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.size >= CACHE_MAX) { const oldest = map.keys().next().value; if (oldest !== undefined) map.delete(oldest); }
  map.set(key, value);
}

/**
 * @description Forget every cached geocode, search, restaurant and photo (a test seam; the process otherwise keeps them).
 */
export function resetCaches(): void {
  GEOCODE_CACHE.clear(); SEARCH_CACHE.clear(); RESTAURANT_CACHE.clear(); PHOTO_CACHE.clear();
}

/** The fetch the routes call: the context's (a test double) or the global one (the kernel's fenced egress). */
function fetchOf(ctx: AppContext): FetchLike {
  const own = (ctx as any).fetch;
  return typeof own === 'function' ? own : (globalThis as any).fetch;
}

/** Serve a static surface file from the package tools dir (ctx.appPackageDir). */
function serveFile(surfaceDir: string, fileName: string): RequestHandler {
  return (_req: Request, res: Response) => {
    const filePath = path.join(surfaceDir, fileName);
    res.sendFile(filePath, (err: unknown) => {
      if (err) {
        logger.error({ err, fileName }, `Failed to serve ${fileName}`);
        res.status(404).send(`Page not found: ${fileName}`);
      }
    });
  };
}

/** The authenticated diner, resolved from the OIDC session (never client-supplied). */
function resolveDinerSub(req: Request): string {
  const trustedSub = getTrustedServiceUserSub(req);
  if (trustedSub) return trustedSub;
  const oidc = (req as any).oidc;
  if (oidc && typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated()) {
    const u = oidc.user || {};
    const sub = u.sub || u.oid;
    if (sub) return String(sub);
  }
  if (process.env.MOCK_OIDC === 'true') return 'demo-diner';
  throw Object.assign(new Error('Not authenticated'), { status: 401 });
}

// ── Schema ───────────────────────────────────────────────────────────────────

/** Create tables if a fresh deploy hasn't run the migrations yet. Idempotent. The cart tables stay declared for the
 *  rows earlier releases wrote; 1.4.0 reads and writes only eats_profile, eats_orders and the conversation tables. */
export async function ensureEatsSchema(pool: Pool): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'eats routes',
    statements: [`
    CREATE TABLE IF NOT EXISTS eats_profile (
      user_sub VARCHAR(255) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
      display_name TEXT, dietary TEXT[] NOT NULL DEFAULT '{}',
      favorite_cuisines TEXT[] NOT NULL DEFAULT '{}', default_address TEXT,
      budget_per_order NUMERIC(10,2), notes TEXT, onboarded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_carts (
      cart_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, store_id VARCHAR(64), store_name TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_cart_items (
      row_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cart_id UUID NOT NULL REFERENCES eats_carts(cart_id) ON DELETE CASCADE,
      user_sub VARCHAR(255) NOT NULL, store_id VARCHAR(64), store_name TEXT,
      item_id VARCHAR(64), title TEXT, price NUMERIC(10,2), quantity INT NOT NULL DEFAULT 1,
      emoji TEXT, image_url TEXT, status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_orders (
      order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, store_id VARCHAR(64), store_name TEXT,
      items JSONB NOT NULL DEFAULT '[]'::jsonb, total NUMERIC(10,2), handoff_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_conversations (
      conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_messages (
      message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES eats_conversations(conversation_id) ON DELETE CASCADE,
      user_sub VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_feedback (
      feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE UNIQUE INDEX IF NOT EXISTS uq_eats_feedback_user_note ON eats_feedback (user_sub, lower(note));
  `,
      ...buildOwnerRlsPolicyStatements('eats_profile', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('eats_carts', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('eats_cart_items', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('eats_orders', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('eats_conversations', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('eats_messages', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('eats_feedback', 'user_sub'),
    ],
    requirements: [
      { table: 'eats_profile', columns: ['user_sub', 'tenant_id', 'display_name', 'dietary', 'favorite_cuisines', 'onboarded', 'created_at', 'updated_at'] },
      { table: 'eats_orders', columns: ['order_id', 'user_sub', 'store_id', 'store_name', 'items', 'total', 'handoff_url', 'created_at'] },
      { table: 'eats_conversations', columns: ['conversation_id', 'user_sub', 'title', 'created_at', 'updated_at'] },
      { table: 'eats_messages', columns: ['message_id', 'conversation_id', 'user_sub', 'role', 'content', 'created_at'] },
      { table: 'eats_feedback', columns: ['feedback_id', 'user_sub', 'note', 'created_at'] },
    ],
  });
}

// ── The delivery address and the restaurants around it ───────────────────────

/** Where a request says the diner is: an address, or coordinates from the browser. */
interface Where { address?: unknown; latitude?: unknown; longitude?: unknown }

/** A "lat, lng" pair as the page's Use location writes it into the address box. */
const COORDINATES = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** What to resolve for an address or a coordinate pair: coordinates (reverse lookup) or text, and its cache key. */
function placeText(where: Where): { text: string; key: string; coords: { latitude: number; longitude: number } | null } | null {
  const lat = Number(where.latitude), lng = Number(where.longitude);
  if (where.latitude !== undefined && where.latitude !== '' && where.longitude !== undefined && where.longitude !== '' && Number.isFinite(lat) && Number.isFinite(lng)) {
    const text = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return { text, key: text, coords: { latitude: lat, longitude: lng } };
  }
  const text = String(where.address || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return null;
  const pair = COORDINATES.exec(text);
  if (pair && Math.abs(Number(pair[1])) <= 90 && Math.abs(Number(pair[2])) <= 180) {
    const coords = { latitude: Number(pair[1]), longitude: Number(pair[2]) };
    const key = `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
    return { text: key, key, coords };
  }
  return { text, key: text.toLowerCase(), coords: null };
}

/**
 * @description The diner's delivery place: the request's address or coordinates, else the profile's saved address.
 * The person's saved resolution (./place-cache) is used first; otherwise text resolves through Places Text Search and
 * coordinates (a lat/lng pair, or the page's "lat, lng" address text) through the Geocoding API's reverse lookup, and
 * the answer is saved when the request may write (a POST; the native kernel admits no write on a GET).
 * @param fetchImpl - The fetch to use.
 * @param where - What the request named.
 * @param profile - The diner's profile row (its default_address is the fallback).
 * @returns The resolved place, or null when nothing names where the diner is.
 */
async function resolvePlace(fetchImpl: FetchLike, pool: Pool, sub: string, where: Where, profile: any, canWrite: boolean): Promise<Geocoded | null> {
  const wanted = placeText(where) || placeText({ address: profile?.default_address });
  if (!wanted) return null;
  const key = lookupKey(sub, wanted.coords ? 'coords' : 'text', wanted.key);
  const source = wanted.coords ? 'geocoding' : 'places';
  const cached = GEOCODE_CACHE.get(wanted.key);
  if (cached) {
    // Fetched earlier on a request that could not write: save it on this one.
    if (canWrite && !cached.persisted) { await writeLookup(pool, key, sub, cached.place, source); cached.persisted = true; }
    return cached.place;
  }
  // What this person resolved before (any age within Google's 30 days: addresses do not move) comes first.
  const saved = await readLookup(pool, key);
  if (saved) {
    const place = { address: saved.address, placeId: saved.placeId, latitude: saved.latitude, longitude: saved.longitude };
    remember(GEOCODE_CACHE, wanted.key, { place, persisted: true });
    return place;
  }
  // Coordinates go to the Geocoding API's reverse lookup: Places Text Search refuses them as a query.
  const place = wanted.coords ? await reverseGeocode(fetchImpl, wanted.coords.latitude, wanted.coords.longitude) : await geocode(fetchImpl, wanted.text);
  if (canWrite) await writeLookup(pool, key, sub, place, source);
  remember(GEOCODE_CACHE, wanted.key, { place, persisted: canWrite });
  return place;
}

/** What a search answered and where it came from. */
interface Served { restaurants: Restaurant[]; served: 'live' | 'saved'; savedAt: number; fallback: PlacesError | null }

/** What a search asks for beyond the craving. */
interface SearchAsk { limit: number; openNow: boolean; refresh: boolean; canWrite: boolean }

/**
 * @description Restaurants for a craving at a place. The person's saved answer younger than a day is served without
 * asking Google (Refresh asks anyway); otherwise Google is asked and the answer saved; and when Google refuses (quota,
 * unreachable, not configured) a saved answer within Google's 30 days is served with the refusal named.
 * @param fetchImpl - The fetch. @param pool - The package pool. @param sub - The person. @param query - The craving.
 * @param place - The delivery place. @param ask - Page size, open-now, refresh, and whether this request may write.
 * @returns The restaurants, whether they are live or saved, when they were fetched, and Google's refusal if any.
 */
async function searchCached(fetchImpl: FetchLike, pool: Pool, sub: string, query: string, place: Geocoded, ask: SearchAsk): Promise<Served> {
  const key = searchKey(sub, query, place.placeId, ask.limit, ask.openNow);
  const now = Date.now();
  const persist = async (at: number, restaurants: Restaurant[]) => { await writeSearch(pool, key, sub, query, place.placeId, restaurants, at); await writePlaces(pool, sub, restaurants, at); };
  const recent = SEARCH_CACHE.get(key);
  if (!ask.refresh && recent && now - recent.at < SEARCH_TTL_MS) {
    // Fetched earlier on a request that could not write: save it on this one.
    if (ask.canWrite && !recent.persisted) { await persist(recent.at, recent.restaurants); recent.persisted = true; }
    return { restaurants: recent.restaurants, served: 'saved', savedAt: recent.at, fallback: null };
  }
  const saved = ask.refresh ? null : await readSearch(pool, key, now);
  if (saved && isFresh(saved.fetchedAt, now)) {
    remember(SEARCH_CACHE, key, { at: saved.fetchedAt, restaurants: saved.restaurants, persisted: true });
    for (const r of saved.restaurants) remember(RESTAURANT_CACHE, r.placeId, r);
    return { restaurants: saved.restaurants, served: 'saved', savedAt: saved.fetchedAt, fallback: null };
  }
  try {
    const restaurants = await searchRestaurants(fetchImpl, { query, latitude: place.latitude, longitude: place.longitude, limit: ask.limit, openNow: ask.openNow });
    if (ask.canWrite) await persist(now, restaurants);
    remember(SEARCH_CACHE, key, { at: now, restaurants, persisted: ask.canWrite });
    for (const r of restaurants) remember(RESTAURANT_CACHE, r.placeId, r);
    return { restaurants, served: 'live', savedAt: now, fallback: null };
  } catch (err) {
    if (!(err instanceof PlacesError)) throw err;
    const older = saved || await readSearch(pool, key, now);
    if (!older) throw err;
    for (const r of older.restaurants) remember(RESTAURANT_CACHE, r.placeId, r);
    return { restaurants: older.restaurants, served: 'saved', savedAt: older.fetchedAt, fallback: err };
  }
}

/** The cache fields every search answer carries. */
function servedFields(found: Served): Record<string, unknown> {
  return {
    served: found.served, savedAt: new Date(found.savedAt).toISOString(), expiresAt: new Date(found.savedAt + MAX_AGE_MS).toISOString(),
    freshForMs: FRESH_MS,
    savedNote: found.served === 'saved' ? (found.fallback ? QUOTA_NOTE : SAVED_NOTE) : '',
    fallback: found.fallback ? { error: found.fallback.code, message: found.fallback.message } : null,
  };
}

/** A restaurant card as the surface and Jarvis receive it: the card plus its Uber Eats link at the diner's address. */
function card(place: Geocoded): (r: Restaurant) => Record<string, unknown> {
  return (r) => ({ ...r, uberUrl: searchLink(r.name, place) });
}

/** Answer a Places refusal in words with its status; anything else is a route error. */
function answerPlacesError(res: Response, err: unknown, where: string): void {
  if (err instanceof PlacesError) {
    logger.warn({ code: err.code, where }, err.message);
    res.status(err.status).json({ error: err.code, message: err.message, source: SOURCE });
    return;
  }
  throw err;
}

// ── Concierge brain ──────────────────────────────────────────────────────────

/** The concierge's reply object. */
interface ChatEnvelope { say: string; show: string[]; remember: string[]; order: string | null }

/** What a chat "order" choice returns instead of a hand-off: the confirm card the surface shows. */
export interface OrderProposal { actionId: 'open_uber_eats'; placeId: string; store: string; summary: string }

/**
 * @description Describe the hand-off the diner would be confirming, WITHOUT building it or recording anything. Only
 * the diner's confirm (POST /order) does that.
 * @param restaurant - The chosen restaurant.
 * @param place - The delivery address.
 * @returns The proposal.
 */
export function orderProposal(restaurant: Restaurant, place: Geocoded): OrderProposal {
  return {
    actionId: 'open_uber_eats', placeId: restaurant.placeId, store: restaurant.name,
    summary: `Open Uber Eats at ${place.address} with ${restaurant.name} searched? You pick the dishes, confirm the address and pay in Uber Eats; nothing is ordered or charged here.`,
  };
}

/**
 * @description The concierge's "remember" entries worth saving: trimmed, non-empty, not already saved and not repeated
 * in the same turn (case and spacing ignored).
 * @param remember - The envelope's remember list.
 * @param saved - The diner's saved notes.
 * @returns The notes to save, in order.
 */
export function newNotes(remember: string[], saved: string[]): string[] {
  const key = (n: unknown) => String(n ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const seen = new Set((saved || []).map(key));
  const out: string[] = [];
  for (const note of remember || []) {
    const k = key(note);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(note).trim());
  }
  return out;
}

/** One candidate line of the prompt. */
function candidateLine(r: Restaurant): string {
  const facts = [
    r.cuisine || 'restaurant',
    r.rating !== null ? `rating ${r.rating}${r.ratingCount !== null ? ` (${r.ratingCount} reviews)` : ''}` : '',
    r.priceLabel,
    r.openNow === true ? 'open now' : r.openNow === false ? 'closed now' : '',
    r.distanceKm !== null ? `${r.distanceKm} km away` : '',
    r.delivery === true ? 'delivers' : r.delivery === false ? 'no delivery listed' : '',
  ].filter(Boolean);
  return `- id:${r.placeId} | ${r.name} | ${facts.join(' | ')}`;
}

function buildConciergePrompt(o: {
  message: string; history: Array<{ role: string; content: string }>;
  candidates: Restaurant[]; place: Geocoded | null; profile: any; notes: string[]; searchNote: string; restrictions?: string;
}): string {
  const p = o.profile || {};
  const profileLine = p.onboarded
    ? `diet:${(p.dietary || []).join(',') || 'none'} | cuisines:${(p.favorite_cuisines || []).join(',') || 'any'} | address:${p.default_address || 'ask'} | budget:${p.budget_per_order ? '$' + p.budget_per_order : 'n/a'}`
    : 'NOT ONBOARDED: warmly ask one or two questions first (dietary needs, favorite cuisines, delivery address, per-order budget), then save the profile.';
  const candidates = o.searchNote
    ? `CANDIDATES (none: no search ran. ${o.searchNote} Never say a search came back empty, found nothing, or that nothing matched; say what is missing instead.)`
    : `CANDIDATES (real, from Google Places near ${o.place ? o.place.address : 'the delivery address'}; the ONLY restaurants you may show or open):\n${o.candidates.map(candidateLine).join('\n') || '(no restaurant matched this craving near the address: say so and ask for another craving)'}`;
  const notes = newNotes(o.notes || [], []).map((n) => `- ${n}`).join('\n') || '(none yet)';
  const convo = (o.history || []).map((h) => `${h.role === 'assistant' ? 'You' : 'Diner'}: ${h.content}`).join('\n');
  return [
    'You are the Eats Concierge, a warm, fast food-delivery assistant. The restaurants under CANDIDATES are real places near the diner\'s delivery address, found through Google Places just now. The diner orders in Uber Eats: when they choose a restaurant, set "order" to its id and Uber Eats opens at their address with that restaurant searched; the dishes, prices and payment are chosen there. Never invent a restaurant, a dish, a price, a menu or a delivery time, and never say an order was placed.',
    'Be conversational and brief. Ask ONE good question when it helps (what cuisine? how many people? budget?). Only show candidates by id, and say why each fits. Set "order" only when the diner asks to order from, open, or go with one candidate; otherwise null.',
    '"remember" only a NEW food preference the diner states in THIS message: not one already under SAVED PREFERENCES, not a guess, and never a status such as onboarding or a missing address.',
    '',
    candidates,
    '',
    `DINER PROFILE: ${profileLine}`,
    o.restrictions || '',
    `SAVED PREFERENCES (from earlier conversations, NOT part of this request: never fold one into your summary of what the diner asked; if one matters, ask about it as its own question, e.g. "Last time you wanted spicy food. Still want that?"):\n${notes}`,
    '',
    convo ? `CONVERSATION SO FAR:\n${convo}` : '',
    '',
    `DINER: ${o.message}`,
    '',
    'Reply with ONLY a JSON object, nothing around it:',
    '{ "say": "your reply (ask a question when useful)", "show": ["candidate id", ...], "remember": ["a preference to save"], "order": "candidate id, or null" }',
  ].filter(Boolean).join('\n');
}

/**
 * @description Repair the one malformation a local model was seen to emit: an object whose fields are not separated by
 * commas (a value's closing quote, bracket or literal, a newline, then the next "key"). Only that shape is touched.
 * @param s - The candidate object text.
 * @returns The text with the missing field commas inserted.
 */
function insertMissingFieldCommas(s: string): string {
  return s.replace(/("|\]|\}|true|false|null|\d)(\s*\n\s*)("[A-Za-z_]+"\s*:)/g, '$1,$2$3');
}

/**
 * @description The "say" string of an envelope whose JSON cannot be parsed even after repair, read as a JSON string literal.
 * @param s - The candidate object text.
 * @returns The decoded say text, or '' when none is present.
 */
function sayFromBrokenEnvelope(s: string): string {
  const m = s.match(/"say"\s*:\s*("(?:[^"\\]|\\.)*")/);
  if (!m) return '';
  try { return String(JSON.parse(escapeRawControls(m[1]))); } catch { return ''; }
}

/**
 * @description Escape the raw control characters (a newline, a tab) a model writes inside a JSON string literal, which
 * JSON.parse refuses. Only characters inside string literals are touched; the layout between fields is left as it is.
 * @param s - The candidate object (or string literal) text.
 * @returns The same text with every control character inside a string literal written as its JSON escape.
 */
function escapeRawControls(s: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString && c === '\\') { out += c + (s[i + 1] ?? ''); i++; continue; }
    if (c === '"') inString = !inString;
    const code = c.charCodeAt(0);
    out += inString && code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : c;
  }
  return out;
}

function envelopeFrom(o: any, fallbackSay: string): ChatEnvelope {
  const order = typeof o.order === 'string' && o.order.trim() && o.order.trim().toLowerCase() !== 'null' ? o.order.trim() : null;
  return {
    say: cleanConciergeReply(o.say, fallbackSay),
    show: Array.isArray(o.show) ? o.show.map(String) : [],
    remember: Array.isArray(o.remember) ? o.remember.map(String).filter(Boolean) : [],
    order,
  };
}

/**
 * @description The concierge's reply envelope. A missing-comma object is repaired; anything still unparsable that is
 * shaped like the envelope shows only its "say" text (nothing is shown, saved or proposed), and never the raw object.
 * Plain prose with no object is still the reply.
 * @param text - The concierge's raw answer.
 * @returns The envelope to act on.
 */
export function parseEnvelope(text: string): ChatEnvelope {
  const fallback: ChatEnvelope = { say: cleanConciergeReply(text), show: [], remember: [], order: null };
  if (!text) return fallback;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return fallback;
  const body = s.slice(start, end + 1);
  for (const candidate of [body, insertMissingFieldCommas(body), insertMissingFieldCommas(escapeRawControls(body))]) {
    // A parsed envelope's empty say stays empty (the route then answers its own default), never the raw object.
    try { return envelopeFrom(JSON.parse(candidate), ''); } catch { /* try the next form */ }
  }
  if (!/"say"\s*:/.test(body)) return fallback;
  return { say: sayFromBrokenEnvelope(body), show: [], remember: [], order: null };
}

/**
 * @description The concierge's words without chat Markdown marks. Bold and italic marks around words and heading marks
 * at a line start are taken out; the words, numbers and list lines stay.
 * @param text - The reply text.
 * @returns The same words with those marks left out.
 */
export function plainProse(text: string): string {
  return String(text || '')
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/(^|[\s(])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?=[\s).,!?;:]|$)/gm, '$1$2')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
}

const NOTE_FILLER = new Set(['want', 'wants', 'wanted', 'like', 'likes', 'food', 'foods', 'meal', 'meals', 'something', 'prefer', 'prefers', 'preference', 'preferences', 'please', 'would', 'some', 'order', 'orders', 'with', 'that', 'this', 'from', 'have', 'just'].map(stemWord));
/** Food words under four letters that still name what a person eats or must not eat. */
const SHORT_FOOD = new Set(['egg', 'soy', 'nut', 'oat', 'rye', 'pea', 'fig', 'ham', 'yam', 'tea', 'gum']);
/** A note that records an allergy, an intolerance or a diet: one the diner states is never dropped. */
const RESTRICTION_NOTE = /allerg|intoleran|celiac|coeliac|anaphyla|vegan|vegetarian|pescatarian|halal|kosher|gluten|dairy|lactose/;
/** A message that states an allergy, an intolerance, a diet or a food the person cannot eat. */
const RESTRICTION_SAID = /allerg|intoleran|celiac|coeliac|anaphyla|epi-?pen|can'?t (?:eat|have)|cannot (?:eat|have)|don'?t eat|do not eat|avoid|sensitiv|vegan|vegetarian|pescatarian|halal|kosher|gluten|dairy|lactose/;

/**
 * @description A word's stem, so a paraphrase still matches. Deliberately light: one suffix removed.
 * @param word - One lower-case word.
 * @returns The stem.
 */
function stemWord(word: string): string {
  const w = String(word || '').toLowerCase().replace(/'s$/, '');
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3);
  for (const suffix of ['ically', 'ical', 'ic', 'es', 's', 'y', 'e']) {
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
  }
  return w;
}

function noteWords(text: string): string[] {
  return String(text || '').toLowerCase().replace(/[‘’]/g, "'").split(/[^a-z0-9']+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => /^\d+$/.test(w) || w.length >= 4 || SHORT_FOOD.has(stemWord(w)))
    .map(stemWord)
    .filter((w) => w && !NOTE_FILLER.has(w));
}

/**
 * @description The remember entries the diner actually stated in THIS message: each must share a word stem with the
 * message (filler such as "food" or "want" does not count), and an allergy, intolerance or diet note is always kept when
 * the message states one.
 * @param remember - The envelope's remember list.
 * @param message - The diner's message this turn.
 * @returns The entries grounded in the message, in order.
 */
export function statedNotes(remember: string[], message: string): string[] {
  const said = new Set(noteWords(message));
  const restrictionSaid = RESTRICTION_SAID.test(String(message || '').toLowerCase().replace(/[‘’]/g, "'"));
  return (remember || []).filter((note) =>
    noteWords(note).some((w) => said.has(w)) || (restrictionSaid && RESTRICTION_NOTE.test(String(note || '').toLowerCase())));
}

async function loadProfile(pool: Pool, sub: string): Promise<any> {
  const r = await pool.query(`SELECT * FROM eats_profile WHERE user_sub = $1`, [sub]);
  return r.rows[0] || { user_sub: sub, onboarded: false, dietary: [], favorite_cuisines: [] };
}

/** The diner's allergies and diet for one chat turn, and the restaurants split by them. */
interface AllergyGuard { restrictions: Restriction[]; safe: Restaurant[]; held: Conflict[]; block: string }

/**
 * @description Check this turn's restaurants against the diner's allergies and diet before the concierge sees them: a
 * restaurant whose name names an allergen the diner avoids (a peanut house for a peanut allergy) is held back, and the
 * prompt states the restrictions as facts so the concierge checks every dish it names from general knowledge.
 * @param message - The diner's message.
 * @param notes - The saved concierge notes.
 * @param profile - The diner's profile row.
 * @param candidates - The restaurants search returned.
 * @returns The restrictions, the safe and held restaurants, and the prompt block.
 */
export function allergyGuard(message: string, notes: string[], profile: any, candidates: Restaurant[]): AllergyGuard {
  const restrictions = dinerRestrictions([message, ...(notes || []), ...((profile && profile.dietary) || [])]);
  const { safe, held } = holdConflicting(candidates.map((r) => ({ ...r, title: r.name, description: r.cuisine })), restrictions);
  return { restrictions, safe: safe.map(({ title, description, ...r }) => r as Restaurant), held, block: restrictionPrompt(restrictions, held) };
}

/**
 * @description One concierge reasoning turn through the accountable bot (cost and audit stay on eats-concierge).
 * @param ctx - The app context.
 * @param sub - The verified diner.
 * @param prompt - The assembled prompt.
 * @returns The concierge's raw text, or '' when the dispatch failed (logged).
 */
async function askConcierge(ctx: AppContext, sub: string, prompt: string): Promise<string> {
  try {
    const result = await executeBotOrInline(ctx, botClient, CONCIERGE_AGENT_ID, {
      text: prompt,
      taskId: `eats-${sub}-${randomUUID()}`,
      workspaceFolderId: `eats-${sub}`,
      agentId: CONCIERGE_AGENT_ID,
      agenticMode: false,
      direct: true,
      userSub: sub,
    });
    return String(result?.response || '').trim();
  } catch (e) { logger.error({ e }, 'eats concierge dispatch failed'); return ''; }
}

// ── Router ───────────────────────────────────────────────────────────────────

/** A bounded page size. */
const limitOf = (value: unknown, fallback: number): number => Math.max(1, Math.min(20, Math.floor(Number(value)) || fallback));

export function createEatsRoutes(ctx: AppContext): Router {
  const router = Router();
  const pool = ctx.pool;
  const store = new ConciergeStore(pool, 'eats');
  const surfaceDir = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.resolve(process.cwd(), 'tools');
  const fetchImpl = fetchOf(ctx);

  ensureEatsSchema(pool).catch((err) => logger.warn({ err }, 'Eats schema bootstrap deferred: tables may not exist yet'));

  const diner =
    (fn: (req: Request, res: Response, sub: string) => Promise<void>): RequestHandler =>
    async (req, res) => {
      let sub: string;
      try { sub = resolveDinerSub(req); }
      catch (e: any) { res.status(e.status || 401).json({ error: e.message }); return; }
      try { await fn(req, res, sub); }
      catch (err: any) { logger.error({ err, path: req.path }, 'eats route error'); res.status(500).json({ error: err.message || 'internal error' }); }
    };

  // ── Surface ────────────────────────────────────────────────────────────────
  router.get('/app', serveFile(surfaceDir, 'eats-app.html'));
  router.get('/chat', serveFile(surfaceDir, 'eats-app.html')); // alias (parity with purchasing's /chat surface)

  router.get('/config', diner(async (_req, res) => {
    res.json({ rail: 'places', source: SOURCE, connector: CONNECTOR, handoff: 'uber-eats', uberConnected: false, railNote: EATS_RAIL_NOTE });
  }));

  // ── Restaurants (Google Places around the delivery address, cache first) ──
  // POST is what the page, the chat and the Jarvis tool use: it may save what Google answered. GET still answers,
  // reading the cache, because the native kernel admits no write on a GET.
  const searchHandler = diner(async (req, res, sub) => {
    const input = req.method === 'GET' ? req.query : { ...(req.query || {}), ...(req.body || {}) };
    const q = String(input.q || input.query || '').trim().slice(0, 200);
    const ask: SearchAsk = { limit: limitOf(input.limit, 12), openNow: String(input.openNow || '') === 'true' || input.openNow === true, refresh: String(input.refresh || '') === 'true' || input.refresh === true, canWrite: req.method !== 'GET' };
    try {
      const place = await resolvePlace(fetchImpl, pool, sub, { address: input.address, latitude: input.lat, longitude: input.lng }, await loadProfile(pool, sub), ask.canWrite);
      if (!place) { res.status(400).json({ error: 'address_required', message: ADDRESS_REQUIRED }); return; }
      const found = await searchCached(fetchImpl, pool, sub, q, place, ask);
      res.json({ source: SOURCE, place, query: q, items: found.restaurants.map(card(place)), feedUrl: feedLink(place), uberSearchUrl: searchLink(q || 'food', place), ...servedFields(found) });
    } catch (err) { answerPlacesError(res, err, 'search'); }
  });
  router.get('/search', searchHandler);
  router.post('/search', searchHandler);

  // A restaurant photo's image URL, resolved by the kernel's egress so the browser never needs the key.
  router.get('/photo', diner(async (req, res) => {
    const name = String(req.query.name || '');
    if (!PHOTO_NAME.test(name)) { res.status(400).json({ error: 'photo name is required' }); return; }
    const hit = PHOTO_CACHE.get(name);
    if (hit && Date.now() - hit.at < PHOTO_TTL_MS) { res.json({ photoUri: hit.uri }); return; }
    try {
      const uri = await photoUri(fetchImpl, name, limitOf(req.query.width, 10) * 64);
      if (!uri) { res.status(404).json({ error: 'no_photo' }); return; }
      remember(PHOTO_CACHE, name, { at: Date.now(), uri });
      res.json({ photoUri: uri });
    } catch (err) { answerPlacesError(res, err, 'photo'); }
  }));

  // ── The hand-off into Uber Eats ───────────────────────────────────────────
  router.post('/order', diner(async (req, res, sub) => {
    const b = req.body || {};
    const placeId = String(b.placeId || b.storeId || '').trim();
    if (!PLACE_ID.test(placeId)) { res.status(400).json({ error: 'placeId is required' }); return; }
    try {
      const place = await resolvePlace(fetchImpl, pool, sub, { address: b.address, latitude: b.lat, longitude: b.lng }, await loadProfile(pool, sub), true);
      if (!place) { res.status(400).json({ error: 'address_required', message: ADDRESS_REQUIRED }); return; }
      const known = RESTAURANT_CACHE.get(placeId) || await readPlace(pool, sub, placeId);
      const name = known ? known.name : (await placeDetails(fetchImpl, placeId)).name;
      const checkoutUrl = searchLink(name, place);
      await pool.query(
        `INSERT INTO eats_orders (user_sub, store_id, store_name, items, total, handoff_url) VALUES ($1,$2,$3,'[]'::jsonb,NULL,$4)`,
        [sub, placeId, name, checkoutUrl]);
      res.json({ checkoutUrl, store: name, placeId, address: place.address, note: HANDOFF_NOTE });
    } catch (err) { answerPlacesError(res, err, 'order'); }
  }));

  router.get('/orders/history', diner(async (_req, res, sub) => {
    const r = await pool.query(
      `SELECT store_id, store_name, total, handoff_url, created_at
         FROM eats_orders
        WHERE user_sub = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [sub],
    );
    res.json({ orders: r.rows });
  }));

  // ── Profile ────────────────────────────────────────────────────────────────
  router.get('/profile', diner(async (_req, res, sub) => {
    res.json({ profile: await loadProfile(pool, sub), remembered: rememberedList(await store.loadNotes(sub, 100)) });
  }));

  // Forget one remembered note, every saved copy of it. Body: { note }.
  router.post('/notes/forget', diner(async (req, res, sub) => {
    const note = String(req.body?.note || '').trim();
    if (!note || note.length > 2000) { res.status(400).json({ error: 'note is required' }); return; }
    const forgotten = await forgetNote(pool, store, sub, note);
    if (!forgotten) { res.status(404).json({ error: 'Nothing remembered matches that note.' }); return; }
    res.json({ ok: true, note, forgotten });
  }));

  router.post('/profile', diner(async (req, res, sub) => {
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO eats_profile (user_sub, display_name, dietary, favorite_cuisines, default_address, budget_per_order, notes, onboarded, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,false),NOW())
       ON CONFLICT (user_sub) DO UPDATE SET
         display_name=COALESCE(EXCLUDED.display_name, eats_profile.display_name),
         dietary=COALESCE(EXCLUDED.dietary, eats_profile.dietary),
         favorite_cuisines=COALESCE(EXCLUDED.favorite_cuisines, eats_profile.favorite_cuisines),
         default_address=COALESCE(EXCLUDED.default_address, eats_profile.default_address),
         budget_per_order=COALESCE(EXCLUDED.budget_per_order, eats_profile.budget_per_order),
         notes=COALESCE(EXCLUDED.notes, eats_profile.notes),
         onboarded=(EXCLUDED.onboarded OR eats_profile.onboarded), updated_at=NOW()
       RETURNING *`,
      [sub, b.displayName ?? null, b.dietary ?? null, b.favoriteCuisines ?? null, b.defaultAddress ?? null,
       b.budgetPerOrder ?? null, b.notes ?? null, b.onboarded ?? null]);
    res.json({ profile: r.rows[0] });
  }));

  // ── Conversational concierge (brain runs on the bot via the orchestrator) ──
  router.post('/chat', diner(async (req, res, sub) => {
    const message = String(req.body?.message || '').trim();
    if (!message) { res.status(400).json({ error: 'message is required' }); return; }

    // Conversation + message + feedback persistence (durable resume, IDOR guard) is shared: ConciergeStore.
    const conversationId = await store.ensureConversation(sub, req.body?.conversationId || undefined, message);
    await store.addMessage(conversationId, sub, 'user', message);
    const history = await store.loadHistory(conversationId);
    const [profile, notes] = await Promise.all([loadProfile(pool, sub), store.loadNotes(sub)]);

    // The real restaurants for this message near the diner: a Places refusal is a fact the prompt states, never an empty result.
    let place: Geocoded | null = null, found: Restaurant[] = [], searchNote = '';
    try {
      place = await resolvePlace(fetchImpl, pool, sub, { address: req.body?.location || req.body?.address, latitude: req.body?.lat, longitude: req.body?.lng }, profile, true);
      if (place) found = (await searchCached(fetchImpl, pool, sub, message, place, { limit: 8, openNow: false, refresh: false, canWrite: true })).restaurants;
      else searchNote = ADDRESS_REQUIRED;
    } catch (err) {
      if (!(err instanceof PlacesError)) throw err;
      searchNote = err.message;
    }
    const allergy = allergyGuard(message, notes, profile, found);
    const candById = new Map<string, Restaurant>(allergy.safe.map((r) => [r.placeId, r]));

    const prompt = buildConciergePrompt({ message, history, candidates: allergy.safe, place, profile, notes, searchNote, restrictions: allergy.block });
    const env = parseEnvelope(await askConcierge(ctx, sub, prompt));
    env.say = plainProse(env.say);
    const shown = env.show.length ? env.show.map((id) => candById.get(id)).filter(Boolean) as Restaurant[] : allergy.safe.slice(0, 6);
    if (!env.say) env.say = shown.length
      ? 'Here are a few places near you. Pick one and I will open it in Uber Eats.'
      : "I'm having trouble reaching my assistant right now. Give me a moment and try again.";

    const remembered = newNotes(statedNotes(env.remember, message), notes);
    for (const note of remembered) await store.saveNote(sub, note);

    // The concierge may decide the diner wants to order; it may not hand off on its own. A proposal is returned for the
    // surface's confirm card and NOTHING outward-facing happens (no link opened, no eats_orders row) until the diner
    // confirms, which calls POST /order.
    const chosen = env.order ? candById.get(env.order) : undefined;
    const proposal = chosen && place ? orderProposal(chosen, place) : null;

    const check = allergyCheckLine(unwarnedMentions(env.say, allergy.restrictions));
    await store.addMessage(conversationId, sub, 'assistant', check ? `${env.say}\n${check}` : env.say);
    await store.touch(conversationId);

    res.json({
      conversationId,
      reply: env.say,
      cards: place ? shown.map(card(place)) : [],
      remembered,
      allergy: { restrictions: allergy.restrictions.map((r) => r.label), heldBack: allergy.held, check },
      checkout: null,
      proposal,
      place,
      searchNote,
      source: SOURCE,
    });
  }));

  router.get('/conversation', diner(async (req, res, sub) => {
    // Durable resume by id (else latest), user-scoped: the shared ConciergeStore.
    res.json(await store.resume(sub, String(req.query.id || '')));
  }));

  return router;
}
