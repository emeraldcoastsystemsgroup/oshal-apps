"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_AGE_MS = exports.FRESH_MS = void 0;
exports.lookupKey = lookupKey;
exports.searchKey = searchKey;
exports.placeKey = placeKey;
exports.isFresh = isFresh;
exports.isUsable = isUsable;
exports.readLookup = readLookup;
exports.writeLookup = writeLookup;
exports.readSearch = readSearch;
exports.writeSearch = writeSearch;
exports.readPlace = readPlace;
exports.writePlaces = writePlaces;
/** A saved answer younger than this is served without asking Google (ratings and open-now stay a day old at most). */
exports.FRESH_MS = 24 * 60 * 60 * 1000;
/** Google's caching limit for Places and Geocoding content: 30 consecutive days. Nothing older is served. */
exports.MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** The key of an address lookup: the person, the kind (typed text or coordinates) and the value. */
function lookupKey(sub, kind, value) {
    return `${sub}|${kind}:${value}`;
}
/** The key of a restaurant search: the person, the craving, the place and the page shape. */
function searchKey(sub, query, placeId, limit, openNow) {
    return `${sub}|${query.toLowerCase().trim()}|${placeId}|${limit}|${openNow ? 1 : 0}`;
}
/** The key of one restaurant's saved card. */
function placeKey(sub, placeId) {
    return `${sub}|${placeId}`;
}
/** Whether a saved answer is young enough to serve without asking Google. */
function isFresh(fetchedAt, now = Date.now()) {
    return Number.isFinite(fetchedAt) && now - fetchedAt < exports.FRESH_MS;
}
/** Whether a saved answer may still be served at all (within Google's 30 days). */
function isUsable(fetchedAt, now = Date.now()) {
    return Number.isFinite(fetchedAt) && now - fetchedAt >= 0 && now - fetchedAt < exports.MAX_AGE_MS;
}
/** A write refused because the row already exists (a concurrent request saved it first). */
function alreadySaved(err) {
    return /duplicate key|unique|23505/i.test(String(err?.message || err || ''));
}
/** Replace one row by key: delete the old, insert the new, tolerate a concurrent duplicate. */
async function replace(pool, deleteSql, insertSql, key, params) {
    await pool.query(deleteSql, [key]);
    try {
        await pool.query(insertSql, [key, ...params]);
    }
    catch (err) {
        if (!alreadySaved(err))
            throw err;
    }
}
/** A JSON column as text or as the engine's parsed value. */
function parsed(value) {
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch {
            return null;
        }
    }
    return value;
}
/**
 * @description The saved resolution for an address key, when it is still within its 30 days.
 * @param pool - The package pool. @param key - From lookupKey. @param now - The clock.
 * @returns The place with when it was fetched, or null.
 */
async function readLookup(pool, key, now = Date.now()) {
    const r = await pool.query('SELECT address, place_id, latitude, longitude, fetched_ms FROM eats_place_lookups WHERE lookup_key = $1', [key]);
    const row = r.rows[0];
    if (!row || !isUsable(Number(row.fetched_ms), now))
        return null;
    return { address: String(row.address), placeId: String(row.place_id), latitude: Number(row.latitude), longitude: Number(row.longitude), fetchedAt: Number(row.fetched_ms) };
}
/**
 * @description Save an address resolution.
 * @param pool - The package pool. @param key - From lookupKey. @param sub - The person. @param place - What Google answered.
 * @param source - 'places' (a typed address) or 'geocoding' (coordinates). @param now - The clock.
 */
async function writeLookup(pool, key, sub, place, source, now = Date.now()) {
    await replace(pool, 'DELETE FROM eats_place_lookups WHERE lookup_key = $1', 'INSERT INTO eats_place_lookups (lookup_key, user_sub, address, place_id, latitude, longitude, source, fetched_ms, expires_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', key, [sub, place.address, place.placeId, place.latitude, place.longitude, source, now, now + exports.MAX_AGE_MS]);
}
/**
 * @description The saved restaurants for a search key, when still within their 30 days.
 * @param pool - The package pool. @param key - From searchKey. @param now - The clock.
 * @returns The restaurants with when they were fetched, or null.
 */
async function readSearch(pool, key, now = Date.now()) {
    const r = await pool.query('SELECT restaurants, fetched_ms FROM eats_search_cache WHERE search_key = $1', [key]);
    const row = r.rows[0];
    if (!row || !isUsable(Number(row.fetched_ms), now))
        return null;
    const restaurants = parsed(row.restaurants);
    return Array.isArray(restaurants) ? { restaurants, fetchedAt: Number(row.fetched_ms) } : null;
}
/**
 * @description Save a restaurant search.
 * @param pool - The package pool. @param key - From searchKey. @param sub - The person. @param query - The craving.
 * @param placeId - The delivery place. @param restaurants - What Google answered. @param now - The clock.
 */
async function writeSearch(pool, key, sub, query, placeId, restaurants, now = Date.now()) {
    await replace(pool, 'DELETE FROM eats_search_cache WHERE search_key = $1', 'INSERT INTO eats_search_cache (search_key, user_sub, query, place_id, restaurants, fetched_ms, expires_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)', key, [sub, query, placeId, JSON.stringify(restaurants), now, now + exports.MAX_AGE_MS]);
}
/**
 * @description One restaurant's saved card, when still within its 30 days.
 * @param pool - The package pool. @param sub - The person. @param placeId - The restaurant. @param now - The clock.
 * @returns The card, or null.
 */
async function readPlace(pool, sub, placeId, now = Date.now()) {
    const r = await pool.query('SELECT card, fetched_ms FROM eats_places WHERE place_key = $1', [placeKey(sub, placeId)]);
    const row = r.rows[0];
    if (!row || !isUsable(Number(row.fetched_ms), now))
        return null;
    const card = parsed(row.card);
    return card && card.placeId ? card : null;
}
/**
 * @description Save the cards of the restaurants a search answered, so a hand-off to one of them needs no lookup.
 * @param pool - The package pool. @param sub - The person. @param restaurants - The cards. @param now - The clock.
 */
async function writePlaces(pool, sub, restaurants, now = Date.now()) {
    for (const r of restaurants) {
        await replace(pool, 'DELETE FROM eats_places WHERE place_key = $1', 'INSERT INTO eats_places (place_key, user_sub, place_id, card, fetched_ms, expires_ms) VALUES ($1,$2,$3,$4,$5,$6)', placeKey(sub, r.placeId), [sub, r.placeId, JSON.stringify(r), now, now + exports.MAX_AGE_MS]);
    }
}
