"use strict";
/**
 * Uber Eats hand-off links for a delivery address the package resolved through Google Places.
 *
 * Why this exists: Uber publishes no consumer API for Eats, so the only real way into it is the website, and
 * the website shows restaurants only for a delivery address. Its feed and search pages carry that address in a
 * `pl` parameter: base64 of the URL-encoded JSON {address, reference, referenceType, latitude, longitude},
 * where reference is a Google place id and referenceType is google_places, the same document ubereats.com writes
 * when a person types an address there. A search link built this way opens Uber Eats at the diner's address
 * with the restaurant's name searched: proven in a browser on 2026-10-30 (a Central Park token opened 406 taco
 * results; tests/uber-link.test.js pins that exact token). Without a token Uber Eats asks for an address first.
 * Pure: no I/O and no framework imports.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the delivery-place token (Google place id, address and coordinates as Uber Eats encodes them), the search link that opens Uber Eats at that address with a restaurant or craving searched, the feed link, and the decoder the tests use.
 *
 * @module uber-link
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UBER_EATS = void 0;
exports.placeToken = placeToken;
exports.decodePlaceToken = decodePlaceToken;
exports.feedLink = feedLink;
exports.searchLink = searchLink;
/** The Uber Eats website. Every hand-off opens here, on the diner's own sign-in. */
exports.UBER_EATS = 'https://www.ubereats.com';
/** How long a search term may be in a link. */
const TERM_LIMIT = 200;
/**
 * @description The `pl` token Uber Eats reads as the delivery location: base64 over the URL-encoded JSON document
 * {address, reference, referenceType: google_places, latitude, longitude}, in that field order.
 * @param place - The resolved delivery address.
 * @returns The token, ready for a `pl=` query parameter.
 */
function placeToken(place) {
    const document = JSON.stringify({
        address: String(place.address || ''),
        reference: String(place.placeId || ''),
        referenceType: 'google_places',
        latitude: Number(place.latitude),
        longitude: Number(place.longitude),
    });
    return Buffer.from(encodeURIComponent(document), 'utf8').toString('base64');
}
/**
 * @description Read a `pl` token back into its document (the tests prove the round trip; the routes never need it).
 * @param token - A token as placeToken wrote it.
 * @returns The document, or null when the token is not one.
 */
function decodePlaceToken(token) {
    try {
        const parsed = JSON.parse(decodeURIComponent(Buffer.from(String(token || ''), 'base64').toString('utf8')));
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        return null;
    }
}
/**
 * @description The Uber Eats delivery feed at the diner's address: every restaurant that delivers there.
 * @param place - The resolved delivery address, or null for the feed without one (Uber Eats then asks).
 * @returns The link.
 */
function feedLink(place) {
    const url = new URL('/feed', exports.UBER_EATS);
    url.searchParams.set('diningMode', 'DELIVERY');
    if (place)
        url.searchParams.set('pl', placeToken(place));
    return url.toString();
}
/**
 * @description An Uber Eats search at the diner's address: a restaurant's name opens that restaurant (and its
 * delivering locations), a craving opens everything matching it.
 * @param terms - The restaurant name or craving.
 * @param place - The resolved delivery address, or null for a search without one.
 * @returns The link.
 */
function searchLink(terms, place) {
    const url = new URL('/search', exports.UBER_EATS);
    url.searchParams.set('q', String(terms || '').trim().slice(0, TERM_LIMIT));
    if (place)
        url.searchParams.set('pl', placeToken(place));
    return url.toString();
}
