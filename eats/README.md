# Eats — OSHAL app package

1.5.8 gives the one chat window's replies the after-check the page's own chat gave its replies. `replyCheck`
(`{path, label, unavailable}`) names `POST /api/eats/reply-check`, Eats' own reply check, mounted on its own
(`createEatsReplyCheckRoutes`) so the route is exact: a kernel that reads it calls it as the person, read only, after
each turn of the Eats concierge (the window, and Jarvis's hand-off to Eats) with the person's words and the bot's reply,
and shows the line it answers under the reply, labelled "Allergy check". The reply never waits for it; when the check
could not run, its unavailable line is shown and spoken instead. A dish the reply names that usually carries one of the diner's allergies or diet
(saved notes, the profile, or said in those words), in a sentence that does not itself warn, is said on that line
("Allergy and diet check: Pad Thai usually contains peanuts (you avoid peanuts). Ask the restaurant before ordering
it."), so the check no longer rests on the persona alone. The route only reads; an older kernel ignores the key.
Proven by `tests/eats-reply-check.test.js` (Test Lab case `reply-check`).

1.5.7 puts the allergy guard in the tools and makes the Eats Concierge the kernel's one chat window. Before, only the
page's own chat route (`POST /api/eats/chat`) held back a restaurant named for an allergen the diner avoids; the
`search-restaurants` tool (which the Eats concierge and Jarvis's hand-off to Eats call) and `open-uber-eats` went
without it. Now `GET` and `POST /api/eats/search` hold back by the diner's saved allergies and diet (remembered notes and
the profile's dietary list) plus any the caller names in `avoid`, and say which (`allergy.restrictions`,
`allergy.heldBack`); `POST /api/eats/order` refuses a held restaurant (409 `allergy_conflict`, nothing recorded); and
`POST /api/eats/notes` (the new `remember-eats-note` tool) keeps an allergy, diet or taste the person states, grounded
in their own words. The page shows the held-back restaurants under the results. The Eats Concierge panel (on a phone the
sheet behind the Eats Concierge button) holds the window every concierge is (eats-concierge), with its model menu, New
conversation, Recent conversations, Files, Tap to talk and Keep trying, in place of the page's own chat; before each
turn it is told the screen (`context.screen_state`: the delivery address and search fields, the restaurants on screen
with their place ids, the held-back ones, and the saved diet and allergies). An approved `open-uber-eats` card reloads
Opened in Uber Eats. The window needs a kernel with `/shared/ui/js/jarvis-chat-frame.js` (`00c62f98` or later). Proven by
`tests/eats-allergy-tools.test.js` (Test Lab case `allergy-tools`) and `tests/eats-one-chat-window.test.js` (case
`one-chat-window`).

1.5.0 keeps what Google answers. Address resolutions, restaurant searches and restaurant cards are saved per person
(`migrations/041-eats-place-cache.sql`, `src-routes/place-cache.ts`) for the 30 consecutive days Google's terms allow
(place ids may be kept indefinitely; nothing else is served past 30 days). A search whose saved answer is younger than a
day asks Google nothing and says so ("Saved results from ..."); **Refresh** asks Google now; and when Google refuses
(quota reached, unreachable, key not configured) the saved answer within 30 days is served with its saved time and the
reason. The search is a `POST /api/eats/search` (the page, the chat and the Jarvis tool), because the native kernel
admits no write on a GET; `GET /search` still answers, reading the cache but never writing it. Each person has their own
cache (native package tables are per person).

1.4.0 makes the restaurants real. Search answers from **Google Places** around the diner's delivery address, through the
native kernel's fenced egress with the kernel-held `google-places` key (`OSHAL_CONNECTOR_SECRET_GOOGLE_PLACES`; the
package never holds it). The curated five-restaurant catalog, the menu and the cart are gone: Uber publishes no consumer
API, so a menu the package cannot read is not priced here. Ordering is a hand-off into **Uber Eats at the diner's
address**: the link carries the address as Uber's own location token (its Google place id, `pl=`), with the chosen
restaurant searched, and the diner picks the dishes, signs in and pays there. Proven in a browser on 2026-10-30 (a
Central Park token opened 406 taco results) and pinned by `tests/uber-link.test.js`. Set-up for an installation: a Google
Maps Platform key with **Places API (New)** enabled, set as `OSHAL_CONNECTOR_SECRET_GOOGLE_PLACES` in the kernel's
environment; until then the page and the concierge say exactly what is missing, never "no restaurants".

1.3.4 made `GET /cart` a pure read; 1.3.2 added the company audience view (ADR-164 D6). Both are kept in git history.

AI food-delivery concierge, carved out of OSHAL core 2026-07-18 (ADR-085 Wave 2 carve #4).

Find the real restaurants near the diner's delivery address, learn the diner's cuisine and
dietary preferences, and hand off into Uber Eats at that address with the restaurant they
chose. Uber has no consumer API to search Eats or place an order on a third party's behalf,
so ordering is a hand-off: the diner picks the dishes, signs in and pays on Uber. No menu or
price is invented here; no payment or diner credentials touch OSHAL.

## Shape

- `oshal-app.yaml` — manifest: one `service-or-oidc` route mount (`/api/eats`), three route-backed
  framework tools (search-restaurants / open-uber-eats approval-gated / ask-eats-concierge), two
  ribbon tiles (Order Food / Restaurants), `guestTier: blocked`, no person-held connector, the
  `egress` block naming `places.googleapis.com` with the kernel-held `google-places` key as the `key`
  query parameter, ticketType `eats` + concierge workflow.
- `src-routes/places.ts` — the Google Places (New) client over the global fetch: geocode an address
  (one Text Search), the restaurants around it (Text Search biased to the address, restaurant type),
  one restaurant by id, a photo's image URL (redirect skipped), the normalized card, and every refusal
  in words. The field mask travels as the `fields` query parameter because a package may not set the
  `X-Goog-FieldMask` header; no request carries a key.
- `src-routes/uber-link.ts` — the Uber Eats location token and the search/feed links that carry it.
- `src-routes/eats-routes.ts` — the surface + API (compiled to `routes/` by the transpiler). Serves the
  surface from this package's `tools/`; resolves the delivery address (request, coordinates, or the
  profile's saved address; cached per process), searches with a ten-minute cache, records hand-offs
  in `eats_orders`, runs the concierge turn with the real restaurants as candidates, and keeps the
  profile, remembered notes and conversations per diner.
- `src-routes/home-summary.ts` — the Home card: the Uber Eats links opened (counts and the newest three).
- `tools/eats-app.html` — the Eats surface.
- `migrations/040-eats-platform.sql` — idempotent belt-and-braces for the seven tables (the cart tables
  stay declared for rows earlier releases wrote; 1.4.0 reads and writes only the profile, the hand-offs
  and the conversation tables).

## The bot stays in the framework (ADR-093 interim)

`eats-concierge` (`b0080000-0000-0000-0000-000000000001`) is a REAL bot-node: its own
compose container (`eats-bot`), blocks in both framework registries, worker + foundation
personas, and the `uberToolKit.js` / `oshal-uber.js` tool chain. That quadruple is the
operator-applied first-party fragment and does not ship in this package.
`workflow.workerBot: eats-concierge` resolves against the framework's static registry.

Eats 1.2.1 loads the shared theme bootstrap (`/shared/ui/css/surface-themes.css` + `/shared/ui/js/surface-theme.js`) in `tools/eats-app.html` and derives its palette from the framework tokens with the previous colors as fallbacks, so the surface follows the operator's chosen cockpit or experience skin whether embedded or opened standalone. No route, data or permission change.

## Real restaurants and the hand-off (1.4.0)

- **`POST /search {query, address | lat, lng, limit, openNow, refresh}`** (and `GET /search?q=&address=`, read-only). Resolves the address through Google Places (its
  formatted address, place id and coordinates), then lists the restaurants Google finds around it for
  the craving: name, address, cuisine, rating and count, price level, open now, delivery, a photo name,
  the distance, plus `uberUrl`, the Uber Eats search at that address with the restaurant's name. With
  no address anywhere: `400 address_required` in words. A Places refusal is `503` with `error` one of
  `not_configured`, `disabled`, `unauthorized`, `quota`, `unavailable` and a `message` the page shows
  as it is; an address Google cannot place is `404 address_not_found`. Every answer carries `served` (`live` or
  `saved`), `savedAt`, `expiresAt` and, when saved, `savedNote` and the `fallback` refusal that made the cache serve.
- **`GET /photo?name=`** answers `{photoUri}` for a Google photo resource name, resolved by the
  kernel's egress, so the browser loads the image with no key.
- **`POST /order {placeId, address?}`** records the hand-off (`eats_orders`: the place id, the name,
  the link, no total) and answers `checkoutUrl`: Uber Eats at the diner's address with the restaurant
  searched. Nothing is ordered or charged here.
- **The concierge turn** searches the message near the diner's address and offers the real
  restaurants by place id; an `"order"` choice in its reply becomes a `proposal` (a confirm card in
  the surface); only the diner's Confirm calls `POST /order`. With no address or a Places refusal the
  prompt says no search ran and why, and forbids calling it an empty result.
- **Assistant rail.** The manifest declares `surface.ops`; the page publishes the restaurants on
  screen as `context` and applies the custom ops `search` and `open_uber_eats` through the same
  functions its buttons call. The only hand-off site is the explicit Order on Uber Eats.

## Family audience view (1.3.1)

The Home shell opens the first surface as `/api/eats/app?audience=family` (ADR-164 D6). The
shared kit (`/shared/ui/js/app-view.js`, loaded right after the theme bootstrap) paints
"Food delivery": the restaurants opened in Uber Eats lately (the home summary's hand-off items,
newest first), the saved tastes (favorite food, dietary needs, budget per order, delivery
address, in the full page's words for what is not set), the recent Uber Eats links (restaurant,
when) and four counts (opened today, opened in five days, saved links, the rail). On open it
reads only `GET /home-summary`, `GET /profile`, `GET /orders/history` and `GET /config` under
the caller's session: never `GET /search` or `GET /photo` (the restaurant source), never the
concierge, never a write. Nothing in the view is clickable; the one action opens Eats in the
cockpit, and ordering stays in the full page. A partial summary, a side read that could not be
checked, an installation with no restaurant source, 401, 403 and a failed summary are each named. Any other request runs the
full page unchanged: its start, the assistant rail and the handoff / connected-actions module
are each gated on the kit's decision, so nothing but the view's own reads runs behind a view.

## Testing

Registered in `tests/test-lab.yaml`.

- `node --test tests/audience-view.test.cjs` — the audience view contract and behaviour (stub kit,
  stub fetch, stub DOM; no browser). `OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs eats`
  from the store root drives `tests/audience-view.fixture.cjs` over the real page and the real kit in headless Chromium.
- `node --test "tests/*-*.test.js"` from this directory (the store-CI `eats` job): the Uber Eats
  location token, the Places client, the compiled routes over the Places double
  (`tests/eats-routes-harness.js`), the unavailable-source states, the page-state and assistant-rail
  guards, the allergen guard and the concierge-note suites.
- `OSHAL_CORE_DIR=<core checkout> node --test tests/surface.core.spec.mjs` is the 390 x 844 Chromium
  smoke over the compiled router; the framework-coupled gate discovers it.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| eats-concierge-chat | concierge chat turn | T2 | none | template | not yet measured | none recorded |
| eats-order-ticket | food order ticket | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
