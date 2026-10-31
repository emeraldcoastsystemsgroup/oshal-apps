"use strict";
/**
 * Google Places (New) client for the Eats package: real restaurants near a delivery address.
 *
 * Why this exists: Uber publishes no consumer API for Eats, and the package used to answer search from a
 * hand-written list of five restaurants. Google Places is a real, documented source of the restaurants near
 * an address (name, address, rating, price level, whether it is open and offers delivery, a photo), and the
 * Google place id of the address itself is what Uber Eats takes in its location token (./uber-link). Every call
 * goes through the global fetch, which on the native kernel is the fenced egress: the manifest declares
 * places.googleapis.com with the kernel-held `google-places` key placed as the `key` query parameter, so the
 * key never enters this package, its logs or the browser. The field mask travels as the `fields` query
 * parameter (a Google system parameter) because a package may not set the X-Goog-FieldMask header.
 * No I/O of its own and no framework imports: the fetch is a parameter.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: geocode an address (Text Search, one result), search restaurants around it (Text Search with a location bias and the restaurant type), one restaurant's details, a photo's image URL, the normalized restaurant card with distance and price label, and the refusals named in words (key not configured, Places API (New) not enabled with its activation link, key refused, quota, address not found).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 1.4.2: coordinates (the page's Use location) resolve through the Geocoding API's reverse lookup on maps.googleapis.com (the same key; a second declared egress host), because Places Text Search refuses "lat, lng" as a query (live 2026-10-30: "Coordinates are not a valid input for the query search parameter"). A Geocoding refusal (API not enabled on the key's project, or the key restricted away from it) is `geocoding_unavailable`, said in words with the advice to type the street address.
 *
 * @module places
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GEOCODING_UNAVAILABLE = exports.PlacesError = exports.PHOTO_NAME = exports.PLACE_ID = exports.DEFAULT_RADIUS_METERS = exports.SECRET_VARIABLE = exports.CONNECTOR = exports.SOURCE = exports.GEOCODING = exports.PLACES = void 0;
exports.classifyThrown = classifyThrown;
exports.classifyAnswer = classifyAnswer;
exports.geocode = geocode;
exports.reverseGeocode = reverseGeocode;
exports.priceLevel = priceLevel;
exports.distanceKm = distanceKm;
exports.normalizePlace = normalizePlace;
exports.searchRestaurants = searchRestaurants;
exports.placeDetails = placeDetails;
exports.photoUri = photoUri;
/** The Places API (New) root; the manifest declares this host. */
exports.PLACES = 'https://places.googleapis.com/v1';
/** The Geocoding API (reverse lookup of coordinates); the manifest declares this host with the same key. */
exports.GEOCODING = 'https://maps.googleapis.com/maps/api/geocode/json';
/** The source every answer names. */
exports.SOURCE = 'Google Places';
/** The connector whose operator-held key the kernel places on every request to the Places host. */
exports.CONNECTOR = 'google-places';
/** The environment variable the kernel reads that key from, for the sentence shown when it is missing. */
exports.SECRET_VARIABLE = 'OSHAL_CONNECTOR_SECRET_GOOGLE_PLACES';
/** The furthest a search looks around the address, in metres (a delivery radius). */
exports.DEFAULT_RADIUS_METERS = 8000;
/** Google answers at most this many places in one page. */
const PAGE_LIMIT = 20;
/** Fields of a restaurant card (Pro, Enterprise and Atmosphere tiers; one search is billed at the highest). */
const SEARCH_FIELDS = [
    'places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.types',
    'places.primaryTypeDisplayName', 'places.rating', 'places.userRatingCount', 'places.priceLevel',
    'places.currentOpeningHours.openNow', 'places.delivery', 'places.takeout', 'places.photos.name',
    'places.googleMapsUri', 'places.websiteUri',
].join(',');
/** Fields of a resolved address (Pro tier only). */
const GEOCODE_FIELDS = 'places.id,places.formattedAddress,places.location';
/** Fields of one restaurant looked up by id for a hand-off. */
const DETAILS_FIELDS = 'id,displayName,formattedAddress,location';
/** A Google place id. */
exports.PLACE_ID = /^[A-Za-z0-9_-]{8,256}$/;
/** A Google photo resource name. */
exports.PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;
/** A refused or failed Places call. */
class PlacesError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.name = 'PlacesError';
        this.code = code;
        this.status = status;
    }
}
exports.PlacesError = PlacesError;
/** Whether a thrown fetch error is the kernel saying the key is not configured. */
function notConfigured(err) {
    const text = String(err?.message || err || '');
    return /is not connected|OSHAL_CONNECTOR_SECRET/.test(text);
}
/**
 * @description The refusal for a thrown fetch: the kernel's own sentence for a missing key becomes `not_configured`
 * with the variable named; anything else is `unavailable` with the reason.
 * @param err - What fetch threw.
 * @returns The error to raise.
 */
function classifyThrown(err) {
    if (err instanceof PlacesError)
        return err;
    if (notConfigured(err)) {
        return new PlacesError('not_configured', `${exports.SOURCE} is not configured for this installation: set ${exports.SECRET_VARIABLE} to a Google Maps Platform key with Places API (New) enabled, then restart the kernel.`, 503);
    }
    return new PlacesError('unavailable', `${exports.SOURCE} could not be reached: ${String(err?.message || err || 'no answer')}.`, 503);
}
/**
 * @description The refusal for a non-2xx Google answer, read from Google's error document.
 * @param status - The HTTP status.
 * @param body - The parsed JSON body (Google's {error: {code, message, status, details}}), or anything.
 * @returns The error to raise.
 */
function classifyAnswer(status, body) {
    const error = body && typeof body === 'object' ? body.error || {} : {};
    const details = Array.isArray(error.details) ? error.details : [];
    const info = details.find((d) => d && d.reason) || {};
    const message = String(error.message || '').trim();
    if (status === 403 && (info.reason === 'SERVICE_DISABLED' || /has not been used|is disabled/.test(message))) {
        const project = info.metadata && info.metadata.consumer ? ` (${String(info.metadata.consumer).replace(/^projects\//, 'project ')})` : '';
        const link = info.metadata && info.metadata.activationUrl ? ` Enable it at ${info.metadata.activationUrl}, then try again in a minute.` : ' Enable Places API (New) on that key\'s Google Cloud project, then try again in a minute.';
        return new PlacesError('disabled', `Places API (New) is not enabled for this installation's Google key${project}.${link}`, 503);
    }
    if (status === 429 || error.status === 'RESOURCE_EXHAUSTED') {
        return new PlacesError('quota', `${exports.SOURCE} refused the request for quota: ${message || 'too many requests'}.`, 503);
    }
    if (status === 400 || status === 401 || status === 403) {
        const refused = /API key|API_KEY|key/i.test(message) || status !== 400;
        return new PlacesError(refused ? 'unauthorized' : 'bad_request', `${exports.SOURCE} refused the request: ${message || `HTTP ${status}`}.`, refused ? 503 : 400);
    }
    return new PlacesError('unavailable', `${exports.SOURCE} answered ${status}${message ? `: ${message}` : ''}.`, 503);
}
/** One JSON call to the Places host; the kernel adds the key, this module adds the field mask. */
async function callPlaces(fetchImpl, method, path, fields, body) {
    const url = `${exports.PLACES}${path}${path.includes('?') ? '&' : '?'}fields=${encodeURIComponent(fields)}`;
    let response;
    try {
        response = await fetchImpl(url, {
            method,
            headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }
    catch (err) {
        throw classifyThrown(err);
    }
    const parsed = await response.json().catch(() => ({}));
    if (!response.ok)
        throw classifyAnswer(response.status, parsed);
    return parsed && typeof parsed === 'object' ? parsed : {};
}
/**
 * @description Resolve an address (or "lat, lng") to the place Uber Eats and the search need.
 * @param fetchImpl - The fetch to use.
 * @param text - The address as the diner typed it, at most 200 characters.
 * @returns The formatted address, its Google place id and coordinates.
 */
async function geocode(fetchImpl, text) {
    const query = String(text || '').trim().slice(0, 200);
    if (!query)
        throw new PlacesError('bad_request', 'An address is required.', 400);
    const answer = await callPlaces(fetchImpl, 'POST', '/places:searchText', GEOCODE_FIELDS, { textQuery: query, pageSize: 1 });
    const hit = Array.isArray(answer.places) ? answer.places[0] : null;
    const lat = Number(hit?.location?.latitude), lng = Number(hit?.location?.longitude);
    if (!hit || !hit.id || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new PlacesError('address_not_found', `No place named "${query}" was found. Type a street address with its city, or use your location.`, 404);
    }
    return { address: String(hit.formattedAddress || query), placeId: String(hit.id), latitude: lat, longitude: lng };
}
/** What the page is told when coordinates cannot be resolved: the installation's fact, and what to do instead. */
exports.GEOCODING_UNAVAILABLE = 'Location lookup needs the Geocoding API enabled on this installation\'s Google key (the same key as Places API (New), with the Geocoding API allowed on it). Type your street address with the city instead.';
/**
 * @description Resolve coordinates (the page's Use location) to the nearest street address with its Google place id,
 * through the Geocoding API's reverse lookup: Places Text Search refuses coordinates as a query.
 * @param fetchImpl - The fetch to use.
 * @param latitude - The latitude. @param longitude - The longitude.
 * @returns The formatted address, its place id and the coordinates Google places it at.
 */
async function reverseGeocode(fetchImpl, latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
        throw new PlacesError('bad_request', 'Coordinates are required.', 400);
    const url = `${exports.GEOCODING}?latlng=${encodeURIComponent(`${latitude},${longitude}`)}&result_type=street_address%7Cpremise%7Csubpremise%7Croute`;
    let response;
    try {
        response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
    }
    catch (err) {
        throw classifyThrown(err);
    }
    const answer = await response.json().catch(() => ({}));
    const status = String(answer?.status || '');
    if (!response.ok || status === 'REQUEST_DENIED' || status === 'OVER_QUERY_LIMIT' || status === 'OVER_DAILY_LIMIT') {
        const detail = String(answer?.error_message || answer?.error?.message || status || `HTTP ${response.status}`);
        if (/not authorized|not enabled|API project|has not been used|REQUEST_DENIED/i.test(detail) || status === 'REQUEST_DENIED') {
            throw new PlacesError('geocoding_unavailable', `${exports.GEOCODING_UNAVAILABLE} (Google said: ${detail})`, 503);
        }
        if (status.startsWith('OVER_'))
            throw new PlacesError('quota', `Google Geocoding refused the request for quota: ${detail}.`, 503);
        throw classifyAnswer(response.status, answer);
    }
    const hit = Array.isArray(answer.results) ? answer.results[0] : null;
    const lat = Number(hit?.geometry?.location?.lat), lng = Number(hit?.geometry?.location?.lng);
    if (!hit || !hit.place_id || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new PlacesError('address_not_found', 'No street address was found at your location. Type your street address with the city instead.', 404);
    }
    return { address: String(hit.formatted_address || `${latitude}, ${longitude}`), placeId: String(hit.place_id), latitude: lat, longitude: lng };
}
/** The price level as a count of dollar signs, as Google's enum names it. */
function priceLevel(value) {
    switch (String(value || '')) {
        case 'PRICE_LEVEL_FREE': return 0;
        case 'PRICE_LEVEL_INEXPENSIVE': return 1;
        case 'PRICE_LEVEL_MODERATE': return 2;
        case 'PRICE_LEVEL_EXPENSIVE': return 3;
        case 'PRICE_LEVEL_VERY_EXPENSIVE': return 4;
        default: return null;
    }
}
/**
 * @description Great-circle distance between two points, in kilometres.
 * @param lat1 - First latitude. @param lng1 - First longitude. @param lat2 - Second latitude. @param lng2 - Second longitude.
 * @returns The distance.
 */
function distanceKm(lat1, lng1, lat2, lng2) {
    const rad = (d) => (d * Math.PI) / 180;
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const bool = (v) => (typeof v === 'boolean' ? v : null);
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
/**
 * @description One Google place as a restaurant card.
 * @param place - The place document Google returned.
 * @param origin - The delivery address, for the distance.
 * @returns The card, or null for a document without an id.
 */
function normalizePlace(place, origin) {
    if (!place || !place.id)
        return null;
    const lat = num(place.location?.latitude), lng = num(place.location?.longitude);
    const level = priceLevel(place.priceLevel);
    const photo = Array.isArray(place.photos) && place.photos[0] && exports.PHOTO_NAME.test(String(place.photos[0].name || '')) ? String(place.photos[0].name) : null;
    return {
        placeId: String(place.id),
        name: String(place.displayName?.text || place.displayName || '').trim() || 'Restaurant',
        address: String(place.formattedAddress || '').trim(),
        cuisine: String(place.primaryTypeDisplayName?.text || '').trim(),
        rating: num(place.rating),
        ratingCount: num(place.userRatingCount),
        priceLevel: level,
        priceLabel: level ? '$'.repeat(level) : '',
        openNow: bool(place.currentOpeningHours?.openNow),
        delivery: bool(place.delivery),
        takeout: bool(place.takeout),
        photo,
        mapsUrl: place.googleMapsUri ? String(place.googleMapsUri) : null,
        website: place.websiteUri ? String(place.websiteUri) : null,
        latitude: lat,
        longitude: lng,
        distanceKm: origin && lat !== null && lng !== null ? Math.round(distanceKm(origin.latitude, origin.longitude, lat, lng) * 10) / 10 : null,
    };
}
/**
 * @description Restaurants matching a craving around the delivery address: Google's Text Search biased to a circle
 * around it and restricted to the restaurant type, in Google's own relevance order.
 * @param fetchImpl - The fetch to use.
 * @param opts - The craving (empty lists restaurants), the address's coordinates, the radius and the page size.
 * @returns The restaurant cards.
 */
async function searchRestaurants(fetchImpl, opts) {
    const query = String(opts.query || '').trim().slice(0, 200);
    const body = {
        textQuery: query || 'restaurants',
        includedType: 'restaurant',
        strictTypeFiltering: true,
        pageSize: Math.max(1, Math.min(PAGE_LIMIT, Math.floor(Number(opts.limit)) || 12)),
        locationBias: { circle: { center: { latitude: opts.latitude, longitude: opts.longitude }, radius: Math.max(100, Math.min(50000, Number(opts.radiusMeters) || exports.DEFAULT_RADIUS_METERS)) } },
    };
    if (opts.openNow)
        body.openNow = true;
    const answer = await callPlaces(fetchImpl, 'POST', '/places:searchText', SEARCH_FIELDS, body);
    const origin = { latitude: opts.latitude, longitude: opts.longitude };
    return (Array.isArray(answer.places) ? answer.places : []).map((p) => normalizePlace(p, origin)).filter(Boolean);
}
/**
 * @description One restaurant by its place id, for a hand-off to a restaurant the search cache no longer holds.
 * @param fetchImpl - The fetch to use.
 * @param placeId - The Google place id.
 * @returns Its name, address and coordinates.
 */
async function placeDetails(fetchImpl, placeId) {
    if (!exports.PLACE_ID.test(String(placeId || '')))
        throw new PlacesError('bad_request', 'A place id is required.', 400);
    const place = await callPlaces(fetchImpl, 'GET', `/places/${encodeURIComponent(placeId)}`, DETAILS_FIELDS);
    const card = normalizePlace(place);
    if (!card)
        throw new PlacesError('address_not_found', 'That restaurant was not found.', 404);
    return { name: card.name, address: card.address, placeId: card.placeId, latitude: card.latitude ?? 0, longitude: card.longitude ?? 0 };
}
/**
 * @description The image URL behind a photo resource name, read without following Google's redirect so the browser
 * loads the image from Google's image host with no key.
 * @param fetchImpl - The fetch to use.
 * @param name - The photo resource name from a restaurant card.
 * @param maxWidthPx - The widest image wanted.
 * @returns The image URL, or null when Google gave none.
 */
async function photoUri(fetchImpl, name, maxWidthPx = 640) {
    if (!exports.PHOTO_NAME.test(String(name || '')))
        throw new PlacesError('bad_request', 'A photo name is required.', 400);
    const answer = await callPlaces(fetchImpl, 'GET', `/${name}/media?maxWidthPx=${Math.max(64, Math.min(1600, Math.floor(maxWidthPx) || 640))}&skipHttpRedirect=true`, 'name,photoUri');
    const uri = String(answer.photoUri || '').trim();
    return /^https:\/\//.test(uri) ? uri : null;
}
