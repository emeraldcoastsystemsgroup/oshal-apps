"use strict";
/**
 * Travel search handoff links, carried by the Travel package for an installation with no Duffel rail.
 *
 * Why this exists: the native kernel has no Duffel provider (its `status` answers not_connected and every
 * search refuses 503, failing the call), so Jarvis's "find me flights" answered that nothing could be
 * searched. The old core helper (scripts/oshal-duffel.js) handed off a Google Flights search for the slice, a
 * Booking.com search for a stay and a Kayak search for a car. This module builds those same links for the
 * exact trip, with no items and no prices: fares are seen and booked on the linked site, never invented here.
 * Pure: no I/O and no framework imports.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: Google Flights, Booking.com and Kayak search links for the asked trip (the old helper's flightDeepLink, hotelDeepLink and carDeepLink), answered as the flights, hotels, cars and deeplink operations with no items where the runtime has no Duffel rail.
 *
 * @module travel-handoff
 */

const NOTE = 'No fares are searched here. The link opens this exact search on the booking site, where the traveller sees live prices and books on their own account.';
/** A Google Flights search for the slice. */
function flightLink(q) {
    const o = encodeURIComponent(q.origin || ''), d = encodeURIComponent(q.destination || '');
    const ret = q.returnDate ? `%20through%20${encodeURIComponent(q.returnDate)}` : '';
    return `https://www.google.com/travel/flights?q=Flights%20from%20${o}%20to%20${d}%20on%20${encodeURIComponent(q.departDate || '')}${ret}`;
}
/** A Booking.com search for the stay. */
function hotelLink(q) {
    return `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(q.city || '')}&checkin=${encodeURIComponent(q.checkIn || '')}&checkout=${encodeURIComponent(q.checkOut || '')}`;
}
/** A Kayak search for the car. */
function carLink(q) {
    return `https://www.kayak.com/cars/${encodeURIComponent(q.city || '')}/${encodeURIComponent(q.pickupDate || '')}/${encodeURIComponent(q.dropoffDate || '')}`;
}
/**
 * @description Answer one Duffel operation with its search handoff.
 * @param args - [operation, ...arguments] as the provider helper takes them.
 * @returns {source:'handoff', items:[], deepLink, note} for a search, or the handoff status.
 */
function run(args) {
    const [op, a = '', b = '', c = '', d = ''] = Array.isArray(args) ? args.map(String) : [];
    const answer = (deepLink) => ({ source: 'handoff', items: [], deepLink, note: NOTE });
    if (op === 'flights')
        return answer(flightLink({ origin: a, destination: b, departDate: c, returnDate: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '' }));
    if (op === 'hotels')
        return answer(hotelLink({ city: a, checkIn: b, checkOut: c }));
    if (op === 'cars')
        return answer(carLink({ city: a, pickupDate: b, dropoffDate: c }));
    return { configured: false, connected: false, live: false, mode: 'handoff', provider: 'duffel', note: NOTE };
}
module.exports = { flightLink, hotelLink, carLink, run, NOTE };
