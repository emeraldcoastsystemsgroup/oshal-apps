# Capability discovery

Canonical source package for the existing installed capability-ideator bot (agent ID preserved); the operator-owned capability-ideation Workflow Studio queue remains separate and unchanged. Home reads only the caller’s discovery runs and redacted latest-step output, with an explicit operator gate. Counts describe workflow state, not ideas built or savings achieved. The native page reads the live Home plan to show available versus unavailable app actions and prepares editable process briefs for Office and Venture. The proposer now researches new external tools using primary sources when research tools are available, and clearly marks unverified leads otherwise. Every proposal must name its business process, trigger, required/optional dependencies, connection scopes, review points, data boundaries, failure handling and measurable acceptance criteria. No installation, sending, spending or ticket creation runs on Home or on receipt of a draft.

## Company audience view (1.1.2)

The Business shells open the first surface as `/api/capability-ideator/review?audience=company` (ADR-164 D6). The
shared kit (`/shared/ui/js/app-view.js`, loaded right after the theme bootstrap) paints the signed-in account's saved
discovery evidence from `GET /home-summary`, the one read the view makes: the route's three counts as stats (runs
active, runs needing review, runs completed in 5 days), a title that names the account's state, a table of the newest
three runs (state, latest saved step, the start of that step's saved redacted output, start) read from the route's own
detail and sentence, and the route's closing note. It never starts a discovery run (runs start from the Capability
Ideation workflow in Workflow Studio and spend on a model), never reads the loaded-applications plan, mounts no
connected actions and writes nothing. The one action opens the full page; the escape opens Capability Ideator in the
cockpit. Signed out, the route's operator refusal, a source the route could not check and a failed read are each
named. Any other request runs the full page unchanged; its module script is gated on the kit's decision.

- `node --test capability-ideator/tests/audience-view.test.cjs` from the store root: the view contract and behaviour,
  fed the JSON the real compiled route builds from stub rows (no browser, no database).
- `OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs capability-ideator` from the store root drives
  `tests/audience-view.fixture.cjs` over the real page and the real kit in headless Chromium.
