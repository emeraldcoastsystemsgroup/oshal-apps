"use strict";
/**
 * The Uber Eats curated catalog and order deep link, carried by the Eats package itself.
 *
 * Why this exists: Uber publishes no consumer API to search Eats or place an order, so the old
 * core helper (scripts/oshal-uber.js) answered search and menu from a curated catalog and made
 * ordering a deep link to ubereats.com that the diner completes on their own Uber login. The
 * native kernel has no Uber Eats provider at all: its `status` answers not_connected and every
 * other operation refuses 503, so Jarvis and the concierge could find no restaurant and offered
 * no link. Nothing here needs a credential, so the package answers the same operations itself
 * where the runtime has none. The link is a handoff: no order is placed and nothing is charged.
 * Pure: no I/O and no framework imports.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the curated catalog, search, menu and order deep link of the core helper (status, search, menu, order/cart), untracked official ubereats.com links tagged utm_source=oshal, answered by the package where the runtime has no Uber Eats rail.
 *
 * @module uber-catalog
 */
const IMG = (id) => `https://images.unsplash.com/photo-${id}?w=600&h=400&q=70&auto=format&fit=crop`;
const CATALOG = [
  {
    storeId: 'chipotle', slug: 'chipotle-mexican-grill', name: 'Chipotle Mexican Grill',
    cuisine: 'Mexican', etaMinutes: 25, emoji: '🌯', rating: 4.7,
    imageUrl: IMG('1626700051175-6818013e1d4f'),
    tags: ['burrito', 'bowl', 'tacos', 'mexican', 'chipotle'],
    items: [
      { itemId: 'chp-burrito', name: 'Chicken Burrito', price: 9.95, emoji: '🌯', imageUrl: IMG('1626700051175-6818013e1d4f') },
      { itemId: 'chp-bowl', name: 'Burrito Bowl', price: 9.95, emoji: '🥗', imageUrl: IMG('1543339308-43e59d6b73a6') },
      { itemId: 'chp-tacos', name: 'Three Tacos', price: 9.45, emoji: '🌮', imageUrl: IMG('1551504734-5ee1c4a1479b') },
      { itemId: 'chp-chips', name: 'Chips & Guacamole', price: 4.55, emoji: '🥑', imageUrl: IMG('1600688640154-9619e002df30') },
    ],
  },
  {
    storeId: 'mcdonalds', slug: 'mcdonalds', name: "McDonald's",
    cuisine: 'Fast food', etaMinutes: 18, emoji: '🍔', rating: 4.3,
    imageUrl: IMG('1568901346375-23c9450c58cd'),
    tags: ['burger', 'fries', 'mcdonalds', 'fast food', 'breakfast'],
    items: [
      { itemId: 'mcd-bigmac', name: 'Big Mac', price: 5.99, emoji: '🍔', imageUrl: IMG('1568901346375-23c9450c58cd') },
      { itemId: 'mcd-mcnuggets', name: '10 pc Chicken McNuggets', price: 5.49, emoji: '🍗', imageUrl: IMG('1562967914-608f82629710') },
      { itemId: 'mcd-fries', name: 'Large French Fries', price: 3.99, emoji: '🍟', imageUrl: IMG('1573080496219-bb080dd4f877') },
      { itemId: 'mcd-mccafe', name: 'McCafé Latte', price: 3.29, emoji: '☕', imageUrl: IMG('1541167760496-1628856ab772') },
    ],
  },
  {
    storeId: 'sushi-house', slug: 'sushi-house', name: 'Sushi House',
    cuisine: 'Japanese', etaMinutes: 35, emoji: '🍣', rating: 4.8,
    imageUrl: IMG('1579871494447-9811cf80d66c'),
    tags: ['sushi', 'japanese', 'ramen', 'roll'],
    items: [
      { itemId: 'sh-cali', name: 'California Roll', price: 7.50, emoji: '🍣', imageUrl: IMG('1579871494447-9811cf80d66c') },
      { itemId: 'sh-spicytuna', name: 'Spicy Tuna Roll', price: 8.25, emoji: '🍣', imageUrl: IMG('1617196034796-73dfa7b1fd56') },
      { itemId: 'sh-ramen', name: 'Tonkotsu Ramen', price: 13.95, emoji: '🍜', imageUrl: IMG('1569718212165-3a8278d5f624') },
      { itemId: 'sh-edamame', name: 'Edamame', price: 4.50, emoji: '🫛', imageUrl: IMG('1564834724105-918b73d1b9e0') },
    ],
  },
  {
    storeId: 'pizza-corner', slug: 'pizza-corner', name: 'Pizza Corner',
    cuisine: 'Italian', etaMinutes: 30, emoji: '🍕', rating: 4.6,
    imageUrl: IMG('1513104890138-7c749659a591'),
    tags: ['pizza', 'italian', 'pasta', 'wings'],
    items: [
      { itemId: 'pc-pepperoni', name: 'Large Pepperoni Pizza', price: 16.99, emoji: '🍕', imageUrl: IMG('1513104890138-7c749659a591') },
      { itemId: 'pc-margherita', name: 'Margherita Pizza', price: 15.49, emoji: '🍕', imageUrl: IMG('1574071318508-1cdbab80d002') },
      { itemId: 'pc-wings', name: 'Buffalo Wings (10)', price: 11.99, emoji: '🍗', imageUrl: IMG('1608039755401-742074f0548d') },
      { itemId: 'pc-garlic', name: 'Garlic Knots', price: 5.99, emoji: '🥖', imageUrl: IMG('1509440159596-0249088772ff') },
    ],
  },
  {
    storeId: 'green-bowl', slug: 'green-bowl-salads', name: 'Green Bowl Salads',
    cuisine: 'Healthy', etaMinutes: 22, emoji: '🥗', rating: 4.5,
    imageUrl: IMG('1512621776951-a57141f2eefd'),
    tags: ['salad', 'healthy', 'bowl', 'vegan', 'vegetarian'],
    items: [
      { itemId: 'gb-cobb', name: 'Cobb Salad', price: 10.95, emoji: '🥗', imageUrl: IMG('1512621776951-a57141f2eefd') },
      { itemId: 'gb-caesar', name: 'Chicken Caesar Salad', price: 9.95, emoji: '🥬', imageUrl: IMG('1550304943-4f24f54ddde9') },
      { itemId: 'gb-buddha', name: 'Vegan Buddha Bowl', price: 11.50, emoji: '🍲', imageUrl: IMG('1512852939750-1305098529bf') },
    ],
  },
];

const BASE = 'https://www.ubereats.com';

/** Tag an official ubereats.com link with the oshal source. */
function track(url) {
  const u = new URL(url);
  u.searchParams.set('utm_source', 'oshal');
  return u.toString();
}

/** The restaurant page on ubereats.com. */
function storeUrl(r) { return track(`${BASE}/store/${r.slug}`); }

/** A search on ubereats.com, for terms that name no catalog restaurant. */
function searchUrl(terms) { return track(`${BASE}/search?q=${encodeURIComponent(String(terms || '').trim())}`); }

/** One restaurant as a search card. */
function normalizeStore(r) {
  return {
    retailer: 'ubereats', productId: r.storeId, title: r.name, brand: r.name, cuisine: r.cuisine,
    etaMinutes: r.etaMinutes, rating: r.rating || null, emoji: r.emoji || '\u{1F37D}\uFE0F',
    priceFrom: r.items.length ? Math.min(...r.items.map((i) => i.price)) : null,
    imageUrl: r.imageUrl || '', productUrl: storeUrl(r),
  };
}

/** One dish of a restaurant's menu. */
function normalizeItem(r, it) {
  return {
    retailer: 'ubereats', productId: it.itemId, storeId: r.storeId, title: it.name, brand: r.name,
    price: it.price, emoji: it.emoji || r.emoji || '\u{1F37D}\uFE0F', imageUrl: it.imageUrl || '', productUrl: storeUrl(r),
  };
}

/** Words that ask for food without naming any. */
const GENERIC = new Set(['food', 'want', 'something', 'order', 'some', 'get', 'dinner', 'lunch', 'breakfast', 'delivery', 'the', 'and', 'for', 'from', 'with', 'eat', 'hungry', 'near', 'nearby', 'place', 'restaurant', 'restaurants', 'please', 'uber', 'eats']);

/** Words of a request that can name a restaurant, cuisine, tag or dish. */
function words(q) { return q.split(/[^a-z0-9]+/u).filter((w) => w.length > 2 && !GENERIC.has(w)); }

/** Whether one restaurant answers the request: its name, cuisine, a tag or a dish. */
function matches(r, q) {
  const hay = [r.name, r.cuisine, ...(r.tags || []), ...r.items.map((it) => it.name)].join(' ').toLowerCase();
  if (hay.includes(q)) return true;
  return words(q).some((w) => hay.includes(w) || (w.endsWith('s') && hay.includes(w.slice(0, -1))));
}

/**
 * @description Search the curated catalog by restaurant name, cuisine, tag or dish.
 * @param query - The diner's terms; empty lists every restaurant.
 * @param limit - The most restaurants to answer, 1 to 20.
 * @returns Restaurant cards. Nothing matching answers every restaurant, with matched false, so a
 * caller can say none matched and still offer the ubereats.com search link.
 */
function search(query, limit) {
  const q = String(query || '').toLowerCase().trim();
  const hits = q ? CATALOG.filter((r) => matches(r, q)) : CATALOG;
  const n = Math.max(1, Math.min(20, Math.floor(Number(limit)) || 8));
  return {
    source: 'catalog', matched: hits.length > 0,
    items: (hits.length ? hits : CATALOG).slice(0, n).map(normalizeStore),
    searchUrl: q ? searchUrl(q) : track(BASE),
  };
}

/**
 * @description A restaurant's menu.
 * @param storeId - The catalog store id or slug.
 * @returns The dishes, or no items for a restaurant the catalog does not hold.
 */
function menu(storeId) {
  const r = CATALOG.find((s) => s.storeId === storeId || s.slug === storeId);
  if (!r) return { source: 'catalog', storeId, items: [] };
  return { source: 'catalog', storeId: r.storeId, store: r.name, items: r.items.map((it) => normalizeItem(r, it)) };
}

/**
 * @description The order handoff link: the restaurant's page, or an ubereats.com search for
 * `search:<terms>` and for a store the catalog does not hold.
 * @param spec - A catalog store id, or `search:<terms>`.
 * @returns The checkout link and the handoff note.
 */
function order(spec) {
  const s = String(spec || '').trim();
  const store = CATALOG.find((r) => r.storeId === s);
  const terms = s.toLowerCase().startsWith('search:') ? s.slice(7) : s;
  return {
    source: 'ubereats', checkoutUrl: store ? storeUrl(store) : searchUrl(terms), tracked: false,
    note: 'Open in a browser; sign in to Uber Eats and place the order. This is a handoff, not an in-app charge.',
  };
}

/** What `status` answers: the package's own catalog and deep-link handoff. */
function status() {
  return {
    configured: false, connected: false, live: false, mode: 'catalog', retailer: 'ubereats', baseUrl: BASE,
    catalog: 'curated', ordering: 'deep-link-handoff',
    note: 'Uber Eats has no consumer order API. Ordering is a deep link the diner completes on their own Uber login.',
  };
}

/**
 * @description Answer one Uber Eats operation from the curated catalog.
 * @param args - [operation, ...arguments] as the provider helper takes them.
 * @returns The operation's answer.
 */
function run(args) {
  const [op, a, b] = Array.isArray(args) ? args : [];
  if (op === 'search') return search(a, b);
  if (op === 'menu') return menu(String(a || ''));
  if (op === 'order' || op === 'cart') return order(a);
  if (op === 'accounts') return { connected: false, provider: 'uber', affiliate: false };
  return status();
}

module.exports = { CATALOG, search, menu, order, status, run };
