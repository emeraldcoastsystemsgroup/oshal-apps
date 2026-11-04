/**
 * Duffel flight search through the native kernel's fenced egress.
 *
 * Why this exists: the native kernel has no Duffel provider helper (its provider rail answers `status`
 * not_connected), so Travel had fallen back to search links. The package sandbox has no network of its own;
 * its global fetch is the kernel's `http.fetch`, which reaches only the hosts the manifest declares and adds
 * the kernel-held Duffel key (`OSHAL_CONNECTOR_SECRET_DUFFEL`) as the bearer token. This module never sees the
 * key. Duffel requires its `Duffel-Version` header on every request (the kernel admits it since 9 of
 * package_egress.rs). An offer request is created without offers and the cheapest offers are then listed
 * sorted by price, so the answer stays far under the kernel's 4 MiB body ceiling and its 20 s deadline.
 * A test-mode key (`duffel_test_…`) answers Duffel's simulated sandbox offers; each offer carries
 * `live_mode`, and such results are labelled test fares, never presented as real prices.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: status (key configured, live or test mode), flights (offer request, cheapest offers sorted by Duffel, the old helper's offer card plus liveMode), the refusals in words (key not configured, key refused, Duffel unreachable or rejecting the trip).
 *
 * @module duffel-egress
 */

const DUFFEL = 'https://api.duffel.com';
const VERSION = 'v2';
const CABINS = ['economy', 'premium_economy', 'business', 'first'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IATA = /^[A-Z]{3}$/;
/** Offers shown per search: the cheapest, as Duffel sorts them. */
const OFFER_LIMIT = 12;
/** Duffel's supplier wait, inside the kernel's 20 s egress deadline. */
const SUPPLIER_TIMEOUT_MS = 12000;

export const SECRET_VARIABLE = 'OSHAL_CONNECTOR_SECRET_DUFFEL';
export const TEST_NOTE = 'Duffel test mode: these are Duffel\'s simulated sandbox fares, not real prices. A live Duffel access token gives real fares.';

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** A Duffel refusal said in words, with whether it means there is no usable key. */
export class DuffelError extends Error {
  code: 'not_configured' | 'unauthorized' | 'rejected' | 'unavailable';
  constructor(code: DuffelError['code'], message: string) {
    super(message);
    this.name = 'DuffelError';
    this.code = code;
  }
}

/**
 * @description Whether this package runs on the native kernel, whose fetch is the fenced egress that adds the key.
 * @returns True on the native kernel.
 */
export function isKernelEgress(): boolean {
  return process.env.OSHAL_EGRESS === 'kernel';
}

/** Whether a thrown fetch error is the kernel saying no Duffel key is configured. */
function notConfigured(err: unknown): boolean {
  return /is not connected|has no credential|OSHAL_CONNECTOR_SECRET/.test(String((err as Error)?.message || err || ''));
}

/** Duffel's first error message, if its error document carries one. */
function duffelMessage(body: any): string {
  const first = body && Array.isArray(body.errors) ? body.errors[0] || {} : {};
  return String(first.message || first.title || '').trim();
}

/** One JSON call to Duffel; the kernel adds the key, this module adds the version header. */
async function call(fetchImpl: FetchLike, method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
  let response: { ok: boolean; status: number; json(): Promise<any> };
  try {
    response = await fetchImpl(`${DUFFEL}${path}`, {
      method,
      headers: { accept: 'application/json', 'content-type': 'application/json', 'duffel-version': VERSION },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (notConfigured(err)) throw new DuffelError('not_configured', `Duffel is not configured for this installation: set ${SECRET_VARIABLE} to a Duffel access token, then restart the kernel.`);
    throw new DuffelError('unavailable', `Duffel could not be reached: ${String((err as Error)?.message || err || 'no answer')}.`);
  }
  const parsed = await response.json().catch(() => ({}));
  if (response.ok) return parsed && typeof parsed === 'object' ? parsed : {};
  const message = duffelMessage(parsed);
  if (response.status === 401 || response.status === 403) throw new DuffelError('unauthorized', `Duffel refused this installation's access token${message ? `: ${message}` : ''}.`);
  if (response.status === 400 || response.status === 422) throw new DuffelError('rejected', `Duffel could not search that trip${message ? `: ${message}` : ''}.`);
  throw new DuffelError('unavailable', `Duffel answered ${response.status}${message ? `: ${message}` : ''}.`);
}

/**
 * @description Whether a Duffel key is configured and whether it is live, read from the newest offer request.
 * @param fetchImpl - The fetch to call (the kernel's egress, or a test double).
 * @returns {configured, provider, mode: 'live'|'test'|'connected'|'not_connected', live, note?}; 'connected' means the
 * key works but no search has shown its mode yet.
 */
export async function status(fetchImpl: FetchLike): Promise<Record<string, unknown>> {
  try {
    const answer = await call(fetchImpl, 'GET', '/air/offer_requests?limit=1');
    const newest = Array.isArray(answer.data) ? answer.data[0] : null;
    const live = newest && typeof newest.live_mode === 'boolean' ? newest.live_mode : null;
    const mode = live === true ? 'live' : live === false ? 'test' : 'connected';
    return { configured: true, provider: 'duffel', mode, live: live === true, ...(live === false ? { note: TEST_NOTE } : {}) };
  } catch (err) {
    if (err instanceof DuffelError && (err.code === 'not_configured' || err.code === 'unauthorized')) {
      return { configured: false, provider: 'duffel', mode: 'not_connected', live: false, note: err.message };
    }
    throw err;
  }
}

function isoMinutes(iso: unknown): number | null {
  const m = String(iso || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return null;
  return (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

function hm(mins: number | null): string | null {
  return mins == null ? null : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * @description A Duffel offer as the flat card the surface and the concierge read (the old helper's shape plus liveMode).
 * @param o - One Duffel offer.
 * @returns The card.
 */
export function normalizeOffer(o: any): Record<string, any> {
  const slices = (o.slices || []).map((s: any) => {
    const segs = s.segments || [];
    const first = segs[0] || {};
    const last = segs[segs.length - 1] || {};
    return {
      origin: s.origin?.iata_code || first.origin?.iata_code || '',
      destination: s.destination?.iata_code || last.destination?.iata_code || '',
      originCity: s.origin?.city_name || first.origin?.city_name || null,
      destinationCity: s.destination?.city_name || last.destination?.city_name || null,
      departAt: first.departing_at || null,
      arriveAt: last.arriving_at || null,
      duration: hm(isoMinutes(s.duration)),
      stops: Math.max(0, segs.length - 1),
      carriers: [...new Set(segs.map((g: any) => g.marketing_carrier?.name).filter(Boolean))],
    };
  });
  return {
    id: o.id,
    price: Number(o.total_amount),
    currency: o.total_currency || 'USD',
    airline: o.owner?.name || slices[0]?.carriers?.[0] || '',
    cabin: o.slices?.[0]?.segments?.[0]?.passengers?.[0]?.cabin_class || null,
    slices,
    expiresAt: o.expires_at || null,
    liveMode: o.live_mode === true,
  };
}

/**
 * @description Search Duffel for the trip and answer its cheapest offers.
 * @param fetchImpl - The fetch to call.
 * @param q - origin, destination (IATA), departDate, optional returnDate (YYYY-MM-DD), pax (1-9), cabin.
 * @returns {source: 'duffel'|'duffel-test', items, note?}; a test key's offers come back as 'duffel-test' with TEST_NOTE.
 */
export async function searchFlights(
  fetchImpl: FetchLike,
  q: { origin: string; destination: string; departDate: string; returnDate?: string; pax?: number; cabin?: string },
): Promise<Record<string, any>> {
  const origin = String(q.origin || '').toUpperCase();
  const destination = String(q.destination || '').toUpperCase();
  if (!IATA.test(origin) || !IATA.test(destination) || !ISO_DATE.test(q.departDate || '')) {
    throw new DuffelError('rejected', 'A flight search needs three-letter airport codes and a YYYY-MM-DD departure date.');
  }
  const slices = [{ origin, destination, departure_date: q.departDate }];
  if (q.returnDate && ISO_DATE.test(q.returnDate)) slices.push({ origin: destination, destination: origin, departure_date: q.returnDate });
  const passengers = Array.from({ length: Math.max(1, Math.min(9, Math.floor(Number(q.pax) || 1))) }, () => ({ type: 'adult' }));
  const cabin = CABINS.includes(String(q.cabin)) ? String(q.cabin) : 'economy';
  const created = await call(fetchImpl, 'POST', `/air/offer_requests?return_offers=false&supplier_timeout=${SUPPLIER_TIMEOUT_MS}`,
    { data: { slices, passengers, cabin_class: cabin } });
  const requestId = created?.data?.id;
  if (!requestId) throw new DuffelError('unavailable', 'Duffel answered no offer request.');
  const listed = await call(fetchImpl, 'GET', `/air/offers?offer_request_id=${encodeURIComponent(requestId)}&sort=total_amount&limit=${OFFER_LIMIT}`);
  const items = (Array.isArray(listed.data) ? listed.data : []).map(normalizeOffer)
    .filter((i: any) => Number.isFinite(i.price))
    .sort((a: any, b: any) => a.price - b.price);
  const live = created.data.live_mode === true;
  return live ? { source: 'duffel', items } : { source: 'duffel-test', items, note: TEST_NOTE };
}
