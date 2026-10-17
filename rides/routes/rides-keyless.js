"use strict";
/**
 * Rides keyless rail — distance, modelled fares, address lookup and the Uber hand-off link with
 * no Uber connector.
 *
 * The platform's Uber Rides helper never needed a credential for any of this: the map pins are
 * real coordinates, the distance between them is measured, the fare is a stated model on top of
 * that distance, addresses resolve through OpenStreetMap Nominatim, and the hand-off is Uber's own
 * public universal link that the rider opens in their own Uber app or browser. An installation
 * whose runtime reports Uber "not connected" (the native kernel has no Uber connector) used to
 * refuse every one of those calls with HTTP 503, so the rider got no distance, no fare and no
 * assistant. This module does the same keyless work inside the package: Nominatim through the
 * global fetch (on the native kernel that is the fenced egress to the host the manifest declares),
 * the measurement and the fare model in plain arithmetic. Nothing here claims Uber priced or booked
 * anything: every fare is `estimate: true` with a `basis` and a note naming the model.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: the keyless rail ported from the platform's oshal-uber-rides helper (haversine distance, 1.3 road factor, per-type fare model, Nominatim geocode/reverse on one 1.1 s queue with a bounded cache, web and app hand-off links), plus estimates straight from two map pins so a dropped pin prices without any address lookup.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A dropoff that geocodes farther than a car ride (300 km) from the pickup is refused, naming where it landed: "home to the airport" was handed to Uber from a Washington street to Helsinki airport. Guard: tests/rides-saved-places.test.js.
 *
 * @module rides-keyless
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_CONNECTOR_NOTE = exports.NOMINATIM_URL = exports.ROAD_FACTOR = exports.RIDE_TYPES = void 0;
exports.haversineKm = haversineKm;
exports.buildRideOptions = buildRideOptions;
exports.pointFrom = pointFrom;
exports.estimateFromPoints = estimateFromPoints;
exports.isMyLocation = isMyLocation;
exports.buildRideLinks = buildRideLinks;
exports.createNominatim = createNominatim;
exports.createKeylessRides = createKeylessRides;
/** The ride types the platform helper priced, with its per-type fare model. */
exports.RIDE_TYPES = Object.freeze([
    { key: 'uberx', label: 'UberX', seats: 4, base: 9, perKm: 1.1 },
    { key: 'comfort', label: 'Comfort', seats: 4, base: 12, perKm: 1.4 },
    { key: 'xl', label: 'UberXL', seats: 6, base: 15, perKm: 1.8 },
    { key: 'black', label: 'Uber Black', seats: 4, base: 22, perKm: 2.6 },
]);
/** Streets are not great circles: the stated detour ratio applied to the measured straight line. */
exports.ROAD_FACTOR = 1.3;
/** Door-to-door city average used for the trip-time estimate. */
const AVG_SPEED_KMH = 32;
/** The public Nominatim endpoint (its usage policy: a real User-Agent, at most one request a second). */
exports.NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const NOMINATIM_UA = 'oshal-rides/1.6 (+https://github.com/emeraldcoastsystemsgroup/oshal-apps)';
const MIN_INTERVAL_MS = 1100;
const LOOKUP_TIMEOUT_MS = 8000;
const CACHE_MAX = 500;
/** The sentence every keyless answer carries: what this installation does and does not have. */
exports.NO_CONNECTOR_NOTE = 'This installation has no Uber rail (no Uber connector exists here). '
    + 'Distance is measured from the two points and the fare is modelled from it, labelled as an estimate; '
    + 'the hand-off opens Uber\'s own app or website, where you see the real price and confirm the ride.';
/**
 * @description Great-circle distance between two points: the measured half of every estimate.
 * @param a - First point.
 * @param b - Second point.
 * @returns Kilometres.
 */
function haversineKm(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}
/**
 * @description One option row per ride type. A null distance (a point could not be placed) gives
 * null fares, never a plausible-looking number.
 * @param distanceKm - Road-adjusted distance, or null when unresolved.
 * @returns The option rows, each `estimate: true`.
 */
function buildRideOptions(distanceKm) {
    const known = typeof distanceKm === 'number' && Number.isFinite(distanceKm);
    return exports.RIDE_TYPES.map((t) => {
        const fare = known ? t.base + t.perKm * distanceKm : null;
        return {
            type: t.key, label: t.label, seats: t.seats,
            fareLow: fare === null ? null : Math.round(fare * 0.9),
            fareHigh: fare === null ? null : Math.round(fare * 1.15),
            etaPickupMin: null,
            tripMin: known ? Math.max(4, Math.round((distanceKm / AVG_SPEED_KMH) * 60 + 3)) : null,
            estimate: true,
        };
    });
}
/**
 * @description A valid map point from untrusted input, or null.
 * @param lat - Latitude (any type).
 * @param lon - Longitude (any type).
 * @returns The point, or null when either value is missing or out of range.
 */
function pointFrom(lat, lon) {
    if (lat === undefined || lat === null || lat === '' || lon === undefined || lon === null || lon === '')
        return null;
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180)
        return null;
    return { lat: la, lon: lo };
}
/**
 * @description The estimate for two (possibly unresolved) points, in the platform helper's shape.
 * @param pickup - Pickup point, or null.
 * @param dropoff - Destination point, or null.
 * @param lookupError - Why an address lookup failed, when it did (shown instead of "did not resolve").
 * @returns options, distance, basis, coords and the rider-facing note.
 */
function estimateFromPoints(pickup, dropoff, lookupError) {
    const straight = pickup && dropoff ? haversineKm(pickup, dropoff) : null;
    const distanceKm = straight === null ? null : Math.round(straight * exports.ROAD_FACTOR * 10) / 10;
    const straightLineKm = straight === null ? null : Math.round(straight * 10) / 10;
    let note;
    if (distanceKm !== null) {
        note = `Modelled fares: a measured ${straightLineKm} km straight line × ${exports.ROAD_FACTOR} road factor (not a driven route). ${exports.NO_CONNECTOR_NOTE}`;
    }
    else if (lookupError) {
        note = `No fare: ${lookupError} Drop both pins on the map and the distance and fare are computed here from the pins.`;
    }
    else {
        note = 'No fare: one of these places did not resolve to a location. Drop a pin on the map, or add a city or street number.';
    }
    return {
        source: 'estimate', rail: 'keyless', options: buildRideOptions(distanceKm), distanceKm, straightLineKm,
        basis: distanceKm === null ? 'unresolved' : 'geocoded', roadFactor: distanceKm === null ? null : exports.ROAD_FACTOR,
        coords: { pickup, dropoff }, note,
    };
}
/** True when the pickup is "my location" (the rider's phone supplies it in Uber, not this server). */
function isMyLocation(pickup) {
    return !pickup || /my location|current/i.test(pickup);
}
/**
 * @description Uber's public hand-off links for a trip (no client id: this installation has no Uber connector).
 * @param pickup - Pickup text ("my location" lets Uber use the phone's position).
 * @param dropoff - Destination text.
 * @param pins - Coordinates when known; Uber sets its pins from them (the text is a display label).
 * @returns webUrl (any browser), appUrl (the Uber app) and which ends carried coordinates.
 */
function buildRideLinks(pickup, dropoff, pins) {
    const mine = isMyLocation(pickup);
    const place = (text, p) => JSON.stringify({ ...(p ? { latitude: p.lat, longitude: p.lon } : {}), addressLine1: text });
    const web = [];
    if (!mine)
        web.push('pickup=' + encodeURIComponent(place(pickup, pins.pickup)));
    web.push('drop[0]=' + encodeURIComponent(place(dropoff, pins.dropoff)));
    web.push('utm_source=oshal');
    const app = new URLSearchParams();
    app.set('action', 'setPickup');
    if (mine)
        app.set('pickup', 'my_location');
    else {
        if (pins.pickup) {
            app.set('pickup[latitude]', String(pins.pickup.lat));
            app.set('pickup[longitude]', String(pins.pickup.lon));
        }
        app.set('pickup[formatted_address]', pickup);
        app.set('pickup[nickname]', pickup.slice(0, 40));
    }
    if (pins.dropoff) {
        app.set('dropoff[latitude]', String(pins.dropoff.lat));
        app.set('dropoff[longitude]', String(pins.dropoff.lon));
    }
    app.set('dropoff[formatted_address]', dropoff);
    app.set('dropoff[nickname]', dropoff.slice(0, 40));
    app.set('utm_source', 'oshal');
    const webUrl = `https://m.uber.com/go/product-selection?${web.join('&')}`;
    return { source: 'uber-link', rideUrl: webUrl, webUrl, appUrl: `https://m.uber.com/ul/?${app.toString()}`,
        geocoded: { pickup: !!pins.pickup, dropoff: !!pins.dropoff } };
}
/**
 * @description The Nominatim client: one queue at the policy's pace, a bounded cache, and a readable
 * reason instead of a throw when the lookup host is unreachable or refused.
 * @param options - fetch seam, pacing and clock.
 * @returns geocode(address) and reverse(lat, lon), each resolving to a Lookup.
 */
function createNominatim(options = {}) {
    // Resolved per lookup, not at load: the native runner installs its egress fetch on the global.
    const fetchNow = () => options.fetchImpl || globalThis.fetch;
    const interval = options.minIntervalMs ?? MIN_INTERVAL_MS;
    const now = options.now || Date.now;
    const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const cache = new Map();
    let chain = Promise.resolve();
    let last = 0;
    const remember = (key, value) => {
        if (cache.size >= CACHE_MAX)
            cache.delete(cache.keys().next().value);
        cache.set(key, value);
    };
    const get = (url) => {
        const run = chain.then(async () => {
            const gap = interval - (now() - last);
            if (gap > 0)
                await wait(gap);
            last = now();
            return lookupJson(fetchNow(), url);
        });
        chain = run.then(() => undefined, () => undefined);
        return run;
    };
    return {
        async geocode(address) {
            const key = `f:${address.trim().toLowerCase()}`;
            if (cache.has(key))
                return { point: cache.get(key) || null };
            const url = new URL(`${exports.NOMINATIM_URL}/search`);
            url.searchParams.set('format', 'json');
            url.searchParams.set('q', address);
            url.searchParams.set('limit', '1');
            const answer = await get(url).catch((err) => ({ failed: lookupFailure(err) }));
            if (answer && typeof answer === 'object' && 'failed' in answer)
                return { point: null, error: String(answer.failed) };
            const hit = Array.isArray(answer) && answer[0] && answer[0].lat && answer[0].lon
                ? { lat: Number(answer[0].lat), lon: Number(answer[0].lon), label: String(answer[0].display_name || address) } : null;
            remember(key, hit);
            return { point: hit };
        },
        async reverse(lat, lon) {
            const key = `r:${lat.toFixed(5)},${lon.toFixed(5)}`;
            if (cache.has(key))
                return { point: cache.get(key) || null };
            const url = new URL(`${exports.NOMINATIM_URL}/reverse`);
            url.searchParams.set('format', 'json');
            url.searchParams.set('lat', String(lat));
            url.searchParams.set('lon', String(lon));
            url.searchParams.set('zoom', '18');
            const answer = await get(url).catch((err) => ({ failed: lookupFailure(err) }));
            if (answer && typeof answer === 'object' && 'failed' in answer)
                return { point: null, error: String(answer.failed) };
            const label = answer && typeof answer === 'object' && answer.display_name;
            const hit = label ? { lat, lon, label: String(label) } : null;
            remember(key, hit);
            return { point: hit };
        },
    };
}
/** One bounded GET of a Nominatim JSON answer. */
async function lookupJson(fetchImpl, url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
        const res = await fetchImpl(url.toString(), { headers: { 'User-Agent': NOMINATIM_UA, Accept: 'application/json' }, signal: controller.signal });
        if (!res.ok)
            throw new Error(`the address service answered HTTP ${res.status}`);
        return await res.json();
    }
    finally {
        clearTimeout(timer);
    }
}
/** A lookup failure in words (the kernel's egress refusal names the host it refused). */
function lookupFailure(err) {
    const text = err instanceof Error ? err.message : String(err);
    return `address lookup is unavailable here (${text.slice(0, 160)}).`;
}
/** Farther than any car ride: a place word that geocoded to the wrong city or country. */
exports.MAX_TRIP_KM = 300;
/**
 * @description The refusal for a dropoff that geocoded farther than a car ride from the pickup.
 * @param text - The dropoff as asked.
 * @param pickup - The resolved pickup.
 * @param dropoff - The resolved dropoff.
 * @returns The sentence to answer with, or null when the trip is a car ride.
 */
function farTrip(text, pickup, dropoff) {
    if (!pickup || !dropoff)
        return null;
    const km = haversineKm(pickup, dropoff);
    if (km <= exports.MAX_TRIP_KM)
        return null;
    return `"${text}" resolved to ${dropoff.label || 'a place'}, ${Math.round(km)} km from the pickup, which is not a car ride. Name the city or the street address.`;
}
exports.farTrip = farTrip;
/**
 * @description The keyless rail with the platform helper's operation surface (status, geocode,
 * reverse, estimate, ride), plus pin-priced estimates.
 * @param options - Lookup seams (tests).
 * @returns run(args, pins?) resolving to the same shapes the provider helper returned.
 */
function createKeylessRides(options = {}) {
    const nominatim = createNominatim(options);
    const resolve = async (text, pin, mine) => {
        if (pin)
            return { point: pin };
        if (mine || !text)
            return { point: null };
        return nominatim.geocode(text);
    };
    return {
        async run(args, pins = { pickup: null, dropoff: null }) {
            const [cmd, a = '', b = ''] = args;
            if (cmd === 'status')
                return { configured: false, connected: false, mode: 'keyless', provider: 'Uber Rides', reason: exports.NO_CONNECTOR_NOTE };
            if (cmd === 'geocode') {
                const hit = await nominatim.geocode(a);
                return hit.point ? { source: 'nominatim', ...hit.point } : { source: 'nominatim', error: hit.error || 'address did not resolve' };
            }
            if (cmd === 'reverse') {
                const hit = await nominatim.reverse(Number(a), Number(b));
                return hit.point ? { source: 'nominatim', ...hit.point } : { source: 'nominatim', error: hit.error || 'no address at that point' };
            }
            const [p, d] = await Promise.all([resolve(a, pins.pickup, isMyLocation(a)), resolve(b, pins.dropoff, false)]);
            const far = farTrip(b, p.point, d.point);
            if (far)
                return cmd === 'ride' ? { error: far } : estimateFromPoints(null, null, far);
            if (cmd === 'estimate')
                return estimateFromPoints(p.point, d.point, p.error || d.error);
            if (cmd === 'ride')
                return buildRideLinks(a || 'my location', b, { pickup: p.point, dropoff: d.point });
            return { error: `unknown rides operation: ${cmd}` };
        },
    };
}
//# sourceMappingURL=rides-keyless.js.map