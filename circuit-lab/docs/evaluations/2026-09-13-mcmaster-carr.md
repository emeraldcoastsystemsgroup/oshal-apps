# McMaster-Carr — evaluation (2026-09-13)

**What it is.** An industrial parts catalog whose product pages offer CAD downloads. Its
Product Information API page (mcmaster.com/help/api, read 2026-09-13) states that "approved
customers can import data on our product offering into their own systems", that access needs a
client certificate and credentials from McMaster-Carr, that the API returns specifications,
pricing, images and "technical files such as CAD drawings (DWG, STEP formats) and datasheets",
that "bandwidth-intensive endpoints, such as retrieving CAD files, are rate-limited", that "to get
data on a certain product, you must subscribe to information on it" (with limits on subscriptions
and daily additions), and that integration starts by writing to eprocurement@mcmaster.com.

**The question.** What do the site's terms allow for automated CAD retrieval? Is a manual "import
a downloaded McMaster STEP" path into CAD Studio plus a catalog row (mass, dimensions, price)
enough for the parts model?

**Answer.** Automated retrieval is a customer-approved API, not scraping: it needs a business
account, a client certificate and a per-product subscription, so it is a business decision, not a
package feature. The manual path already exists in pieces: CAD Studio imports STEP, and this lab's
`catalog/drivers.json` is the shape of a catalog row (id, name, mass, price, nameplate, source,
usedBy). What is missing is a row type for bought mechanical parts (bearings, shafts, gears,
fasteners) with dimensions, and a place in CAD Studio to attach a downloaded STEP to that row.

| | Cost | Benefit |
|---|---|---|
| Manual path | a `parts` catalog row type with dimensions + "attach STEP" in CAD Studio; the person downloads the file | the printed and the bought parts of a design are one list with masses and prices |
| API path | a business account, a client certificate, per-product subscriptions, rate-limited CAD fetches | the same rows filled automatically |
| Risk | the API's terms are per approved customer; the package must never embed a certificate | — |

**Verdict.** A BACKLOG item for the manual path, **B13 — bought parts in the catalog with a
STEP attached**, and a recorded **no** for automated retrieval until the operator holds an approved
account. Done when: a catalog row of kind `bought` carries dimensions, mass and price with its
source URL, CAD Studio attaches a person-downloaded STEP to that row, and a design's bill of
materials lists printed and bought rows together.

**Evidence.** https://www.mcmaster.com/help/api/ (fetched 2026-09-13).
