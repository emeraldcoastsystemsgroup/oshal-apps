/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser fixture for the Shopping family audience view (ADR-164 D6): the page, its declared URL, synthetic read-only answers shaped like GET /api/purchasing/lists (list_id, name, status, created_at, item_count = pending lines, oldest first), /lists/:id/items (shop_list_items rows of every status but removed: title, quantity, unit_price as the numeric column's string, status, created_at) and /home-summary (the four metrics, partial), and what the family view must show. The purchased line is newest so the painted "Last added" proves the pending filter runs in the browser. The package stylesheet is served so the full page paints as deployed. Consumed by scripts/audience-views.browser.cjs in headless Chromium; never by the runtime.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Two pages now: the dashboard entry is unchanged, and the concierge chat page (/api/purchasing/chat, Shopping's first surface, the page the Studio, Orbit, Commons and Jarvis shells frame) is a second entry over the SAME synthetic reads, asserting its company view (four stats with the whole-cent cart total and its unpriced line, the cart table newest first with unit and line prices, the lists table with the cart's list marked) and its family view (the dashboard's words). Its full page is proven by the concierge start painting the Deals chip after the profile and cart reads, which only runs without an audience. The module exports an array; the harness accepts one entry or several.
 * -----------------------------------------------------------------------------
 * @module audience-view.fixture
 */
'use strict';

/**
 * @description The synthetic lists as GET /lists returns them: two active lists, oldest first; the first is the active pick.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} shop_lists rows with their pending item_count.
 */
function lists(iso) {
  return [
    { list_id: 'l1', name: 'Synthetic Weekly Groceries', status: 'active', created_at: iso(-400), item_count: '3' },
    { list_id: 'l2', name: 'Synthetic Camping Trip', status: 'active', created_at: iso(-30), item_count: '1' },
  ];
}

/**
 * @description The synthetic lines of the active list: three pending (one without a price) and one purchased, which is the newest.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object[]} shop_list_items rows.
 */
function items(iso) {
  return [
    { item_id: 'i1', list_id: 'l1', title: 'Synthetic Milk', quantity: 2, unit_price: '3.48', status: 'pending', created_at: iso(-30) },
    { item_id: 'i2', list_id: 'l1', title: 'Synthetic Dish Soap', quantity: 1, unit_price: null, status: 'pending', created_at: iso(-100) },
    { item_id: 'i3', list_id: 'l1', title: 'Synthetic Bananas', quantity: 6, unit_price: '0.24', status: 'pending', created_at: iso(-3) },
    { item_id: 'i4', list_id: 'l1', title: 'Synthetic Coffee', quantity: 1, unit_price: '8.98', status: 'purchased', created_at: iso(-1) },
  ];
}

/**
 * @description The read-only answers both pages' views make on open, keyed by route.
 * @param {(hours: number) => string} iso Timestamp helper from the harness (hours from now).
 * @returns {object} Route -> JSON body.
 */
function reads(iso) {
  return {
    '/api/purchasing/lists': { lists: lists(iso) },
    '/api/purchasing/lists/l1/items': { items: items(iso) },
    '/api/purchasing/home-summary': {
      metrics: [
        { id: 'active-shopping-lists', label: 'Active lists', value: '2', tone: 'neutral' },
        { id: 'pending-shopping-items', label: 'Items to review', value: '4', tone: 'neutral' },
        { id: 'shopping-handoffs-24h', label: 'Checkout links / 24h', value: '0', tone: 'neutral' },
        { id: 'shopping-handoffs-5d', label: 'Checkout links / 5 days', value: '1', tone: 'neutral' },
      ],
      tiles: [], items: [{ text: 'Saved active lists and pending items. Checkout handoffs are not confirmed purchases.', tone: 'neutral', fix: 'shop-concierge' }], asOf: iso(0), partial: false,
    },
  };
}

/** What the family view paints on either page: the household list in the same words. */
const FAMILY = {
  stats: 4, sections: ['items', 'lists'],
  text: ['Our list', 'Synthetic Weekly Groceries', '3 things to pick up. Newest: Synthetic Bananas, added 3 h ago.', 'Open the shopping list', 'On the list',
    'Synthetic Milk', '×2 · $3.48 each', 'added yesterday', 'Synthetic Dish Soap', '×1 · no price yet', 'added 4 days ago', 'Synthetic Bananas', '×6 · $0.24 each',
    'Other lists', 'Synthetic Camping Trip', '1 thing on it', 'Checkout links, 5 days', 'Not confirmed purchases'],
  statValues: { pending: '3', lists: '2', added: '3 h ago', handoffs: '1' },
};

/** What the chat page's company view paints: 348 x 2 + 24 x 6 = 840 cents, the dish soap line unpriced. */
const COMPANY = {
  stats: 4, sections: ['cart', 'lists'],
  text: ['Productivity · Shopping', '3 lines in the cart', 'Synthetic Weekly Groceries · last added 3 h ago. Checkout hands the cart to Walmart; nothing is charged here.',
    'Cart lines', 'Synthetic Bananas', '$0.24', '$1.44', 'Synthetic Milk', '$3.48', '$6.96', 'Synthetic Dish Soap', 'no price', '1 without a price',
    'Lists', 'Active · the cart', 'Synthetic Camping Trip', 'Checkout links / 5 days', 'Not confirmed purchases'],
  statValues: { lines: '3', total: '$8.40', lists: '2', handoffs: '1' },
};

/** @param {{ iso: (hours: number) => string }} h Helpers from the harness. @returns {object[]} The page entries: the dashboard, then the chat page. */
module.exports = ({ iso }) => [
  {
    app: 'purchasing', file: 'purchasing/tools/shopping-dashboard.html', url: '/api/purchasing/dashboard', fullMarker: '.tab.active[data-view="shop"]',
    assets: [{ url: '/api/purchasing/purchasing.css', file: 'purchasing/tools/purchasing.css' }],
    reads: reads(iso),
    audiences: { family: FAMILY },
  },
  {
    app: 'purchasing', file: 'purchasing/tools/shopping-chat.html', url: '/api/purchasing/chat', fullMarker: '.chip.active[data-chip="Deals"]',
    reads: reads(iso),
    audiences: { company: COMPANY, family: FAMILY },
  },
];
