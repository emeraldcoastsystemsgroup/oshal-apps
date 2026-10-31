/**
 * The Eats place cache: what Google answered, kept so the app does not ask again while it already holds the answer,
 * and so a saved answer still serves when Google's quota is reached.
 *
 * Why this exists: every Places search and address lookup counts against the key's monthly allowance, and the same
 * household asks for the same cravings at the same address. Roger (2026-10-30): "store the data that we pull from the
 * api so we have something cached ... and we don't have to get a map if we already have the data". Google's terms
 * allow place ids to be kept indefinitely and other Places and Geocoding content to be cached for at most 30
 * consecutive days, so every row carries an expiry 30 days after it was fetched and is never served past it.
 * Tables (migrations/041-eats-place-cache.sql) are per person on the native kernel; keys carry the person so the
 * same SQL also behaves on a shared database. Timestamps are epoch milliseconds, which every engine reads the same.
 * Writes are DELETE-by-key then INSERT (no ON CONFLICT, which the native kernel materializes); a duplicate-key refusal
 * from a concurrent write is treated as "already saved".
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: keys, the freshness (one day: served without asking Google) and the usable life (30 days, Google's limit), and the read/write of address lookups, searches and restaurant cards.
 *
 * @module place-cache
 */
import type { Geocoded, Restaurant } from './places';

/** A saved answer younger than this is served without asking Google (ratings and open-now stay a day old at most). */
export const FRESH_MS = 24 * 60 * 60 * 1000;
/** Google's caching limit for Places and Geocoding content: 30 consecutive days. Nothing older is served. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** The pool the routes hold. */
export interface Queryable { query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> }

/** A saved address resolution. */
export interface SavedPlace extends Geocoded { fetchedAt: number }
/** A saved restaurant search. */
export interface SavedSearch { restaurants: Restaurant[]; fetchedAt: number }

/** The key of an address lookup: the person, the kind (typed text or coordinates) and the value. */
export function lookupKey(sub: string, kind: 'text' | 'coords', value: string): string {
  return `${sub}|${kind}:${value}`;
}

/** The key of a restaurant search: the person, the craving, the place and the page shape. */
export function searchKey(sub: string, query: string, placeId: string, limit: number, openNow: boolean): string {
  return `${sub}|${query.toLowerCase().trim()}|${placeId}|${limit}|${openNow ? 1 : 0}`;
}

/** The key of one restaurant's saved card. */
export function placeKey(sub: string, placeId: string): string {
  return `${sub}|${placeId}`;
}

/** Whether a saved answer is young enough to serve without asking Google. */
export function isFresh(fetchedAt: number, now = Date.now()): boolean {
  return Number.isFinite(fetchedAt) && now - fetchedAt < FRESH_MS;
}

/** Whether a saved answer may still be served at all (within Google's 30 days). */
export function isUsable(fetchedAt: number, now = Date.now()): boolean {
  return Number.isFinite(fetchedAt) && now - fetchedAt >= 0 && now - fetchedAt < MAX_AGE_MS;
}

/** A write refused because the row already exists (a concurrent request saved it first). */
function alreadySaved(err: unknown): boolean {
  return /duplicate key|unique|23505/i.test(String((err as Error)?.message || err || ''));
}

/** Replace one row by key: delete the old, insert the new, tolerate a concurrent duplicate. */
async function replace(pool: Queryable, deleteSql: string, insertSql: string, key: string, params: unknown[]): Promise<void> {
  await pool.query(deleteSql, [key]);
  try { await pool.query(insertSql, [key, ...params]); } catch (err) { if (!alreadySaved(err)) throw err; }
}

/** A JSON column as text or as the engine's parsed value. */
function parsed(value: unknown): any {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
  return value;
}

/**
 * @description The saved resolution for an address key, when it is still within its 30 days.
 * @param pool - The package pool. @param key - From lookupKey. @param now - The clock.
 * @returns The place with when it was fetched, or null.
 */
export async function readLookup(pool: Queryable, key: string, now = Date.now()): Promise<SavedPlace | null> {
  const r = await pool.query('SELECT address, place_id, latitude, longitude, fetched_ms FROM eats_place_lookups WHERE lookup_key = $1', [key]);
  const row = r.rows[0];
  if (!row || !isUsable(Number(row.fetched_ms), now)) return null;
  return { address: String(row.address), placeId: String(row.place_id), latitude: Number(row.latitude), longitude: Number(row.longitude), fetchedAt: Number(row.fetched_ms) };
}

/**
 * @description Save an address resolution.
 * @param pool - The package pool. @param key - From lookupKey. @param sub - The person. @param place - What Google answered.
 * @param source - 'places' (a typed address) or 'geocoding' (coordinates). @param now - The clock.
 */
export async function writeLookup(pool: Queryable, key: string, sub: string, place: Geocoded, source: 'places' | 'geocoding', now = Date.now()): Promise<void> {
  await replace(pool,
    'DELETE FROM eats_place_lookups WHERE lookup_key = $1',
    'INSERT INTO eats_place_lookups (lookup_key, user_sub, address, place_id, latitude, longitude, source, fetched_ms, expires_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    key, [sub, place.address, place.placeId, place.latitude, place.longitude, source, now, now + MAX_AGE_MS]);
}

/**
 * @description The saved restaurants for a search key, when still within their 30 days.
 * @param pool - The package pool. @param key - From searchKey. @param now - The clock.
 * @returns The restaurants with when they were fetched, or null.
 */
export async function readSearch(pool: Queryable, key: string, now = Date.now()): Promise<SavedSearch | null> {
  const r = await pool.query('SELECT restaurants, fetched_ms FROM eats_search_cache WHERE search_key = $1', [key]);
  const row = r.rows[0];
  if (!row || !isUsable(Number(row.fetched_ms), now)) return null;
  const restaurants = parsed(row.restaurants);
  return Array.isArray(restaurants) ? { restaurants, fetchedAt: Number(row.fetched_ms) } : null;
}

/**
 * @description Save a restaurant search.
 * @param pool - The package pool. @param key - From searchKey. @param sub - The person. @param query - The craving.
 * @param placeId - The delivery place. @param restaurants - What Google answered. @param now - The clock.
 */
export async function writeSearch(pool: Queryable, key: string, sub: string, query: string, placeId: string, restaurants: Restaurant[], now = Date.now()): Promise<void> {
  await replace(pool,
    'DELETE FROM eats_search_cache WHERE search_key = $1',
    'INSERT INTO eats_search_cache (search_key, user_sub, query, place_id, restaurants, fetched_ms, expires_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    key, [sub, query, placeId, JSON.stringify(restaurants), now, now + MAX_AGE_MS]);
}

/**
 * @description One restaurant's saved card, when still within its 30 days.
 * @param pool - The package pool. @param sub - The person. @param placeId - The restaurant. @param now - The clock.
 * @returns The card, or null.
 */
export async function readPlace(pool: Queryable, sub: string, placeId: string, now = Date.now()): Promise<Restaurant | null> {
  const r = await pool.query('SELECT card, fetched_ms FROM eats_places WHERE place_key = $1', [placeKey(sub, placeId)]);
  const row = r.rows[0];
  if (!row || !isUsable(Number(row.fetched_ms), now)) return null;
  const card = parsed(row.card);
  return card && card.placeId ? card as Restaurant : null;
}

/**
 * @description Save the cards of the restaurants a search answered, so a hand-off to one of them needs no lookup.
 * @param pool - The package pool. @param sub - The person. @param restaurants - The cards. @param now - The clock.
 */
export async function writePlaces(pool: Queryable, sub: string, restaurants: Restaurant[], now = Date.now()): Promise<void> {
  for (const r of restaurants) {
    await replace(pool,
      'DELETE FROM eats_places WHERE place_key = $1',
      'INSERT INTO eats_places (place_key, user_sub, place_id, card, fetched_ms, expires_ms) VALUES ($1,$2,$3,$4,$5,$6)',
      placeKey(sub, r.placeId), [sub, r.placeId, JSON.stringify(r), now, now + MAX_AGE_MS]);
  }
}
