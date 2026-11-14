# Shopping backlog

## One link for the whole grocery order

**As built (1.5.0):** "order the groceries" makes the order from every item still to buy on the list. Each item is
answered with the address that finds it at Walmart (`https://www.walmart.com/search?q=<the item>`); the shopper opens
each, adds it to their Walmart cart and pays there. Lines already matched to a Walmart product go in one cart link,
only where the installation runs Walmart's catalog (the native kernel does not: `GET /api/purchasing/config` answers
`rail: absent`).

**Wanted:** one link that opens a store with every item of the order already matched, so the shopper presses
Add all and checks out.

**How, without a kernel change:** Instacart's developer platform makes a shopping list page from written items:
`POST /idp/v1/products/products_link` with `title` and `line_items: [{name, line_item_measurements}]` answers
`{"products_link_url": ...}`; the shopper opens it, chooses a store, adds the items and checks out
(<https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page>). It takes one API key
in `Authorization: Bearer`, has a development server (`https://connect.dev.instacart.tools`) and a production one
(`https://connect.instacart.com`). The package would reach it through the kernel's fenced egress, as Eats reaches
Google Places: an `egress:` entry for the host with `credential: {connector: instacart, header: authorization,
prefix: "Bearer "}`, the key held by the operator, never by the package.

**Depends on:** an Instacart developer key, registered under the business address
(`docs/partner-app-registration.md` in the core repository, shape B). Not built: there is no key to prove it
against, and a connector is only wired to an API that has answered.

**Done when:**
- with the key set, `POST /api/purchasing/order` answers `orderUrl`, the Instacart page for exactly the items still
  to buy, and the List screen and the concierge give that one link first;
- the request is proved against Instacart's development server with the real key (a recorded answer, not a stand-in),
  and a test with a stand-in egress holds the request's shape and the refusal when the key is missing;
- without the key the order is exactly what 1.5.0 makes, and no screen tells a person to connect anything;
- the link is reused while the list is unchanged (Instacart's own advice) and made again when it changes.

## A Walmart cart from a written item

**As built (1.5.0):** a written item ("eggs") is never matched to a product here, so it is never in a Walmart cart
link. Matching needs Walmart's catalog search, and the native kernel runs no Walmart operation
(`crates/host-process/bridge/provider_rails.js` in the kernel: `status` answers not connected, every other operation
is refused).

**Depends on:** a Walmart catalog search and cart operation on the kernel. That is kernel work, not a package change.

**Done when:**
- on a kernel that runs Walmart's catalog, a written item on the list can be matched to a product from the List
  screen and by the concierge, priced by the server from the catalog row;
- the order's cart link then holds every matched line, and a test proves a written item that was matched is in it.
