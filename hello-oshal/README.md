# hello-oshal — the minimal working example

1.2.3 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

The smallest real OSHAL app package: one self-contained route + one themed ribbon surface. Use it to
prove the install loop, and copy it as the starting point for a new extension.

```
node scripts/oshal-app.js install hello-oshal
# → deployed-apps/hello-oshal/ ; the loader mounts /api/hello-oshal
# GET /api/hello-oshal/ping  → {"ok":true,"app":"hello-oshal",...}
```

Files:
- `oshal-app.yaml` — the definition file (name, one `ui.static` tile, one `route`).
- `routes/hello.js` — the compiled-JS route (self-contained; no framework imports).
- `tests/hello.test.js` — real loopback HTTP tests; run `node --test hello-oshal/tests/hello.test.js` from the store root.
- `tests/test-lab.yaml` — versioned AI Test Lab registration for package readiness, the HTTP suite and the audience view.
- `tests/audience-view.test.cjs` — the company audience view contract and behaviour over the real route factory; run `node --test hello-oshal/tests/audience-view.test.cjs` from the store root.
- `tests/audience-view.fixture.cjs` — the entry `scripts/audience-views.browser.cjs` drives in headless Chromium.

Version 1.2.0 requires the core `test-catalog` capability. Installation registers the suite;
the Test Lab reports the Node runner as pending until an approved runner is available. It does
not treat registration as a passing test. The existing service-authenticated smoke remains the
installation readiness probe. Install this release after a core with that capability is available.

## Company audience view (1.2.2)

The Business shells open the first surface as `/api/hello-oshal/app?audience=company` (ADR-164 D6).
The shared kit (loaded right after the theme bootstrap in the page `routes/hello.js` serves) paints
a compact company view instead of the status card: kicker "Engineering · Hello OSHAL", a title that
names the route's state, three stats (package route, the answer time the route reports, whether the
route factory received the swarm context), a one-row "Route check" table (route, HTTP status,
package, the route's own answer, answered) and "What this package ships" (one JSON route, one ribbon
surface, nothing saved). The package keeps no records, so that is all there is to show. The only way
to act is the kit's escape, "Open Hello OSHAL in the cockpit".

On open the view makes one plain read, `GET /api/hello-oshal/ping`, and writes nothing. An
unreachable route, a 401, a 403, a failing status, an answer that is not JSON and an answer without
the hello-oshal identity are each named for what they are, never shown as responding. The page's
own status script runs only when no view renders, so the route is read once; any request without
the parameter, or on a core without the kit, runs the full page unchanged. The full page's centred
card layout is scoped to the full page so it does not box the kit's root.

- `node --test hello-oshal/tests/audience-view.test.cjs` from the store root (no browser).
- `OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs hello-oshal` from the
  store root drives `tests/audience-view.fixture.cjs` over the page the real route serves and the
  real kit in headless Chromium.

The 1.2.1 audit attestation described the package tree before this change, so `audits/hello-oshal.json`
and its marketplace binding are a pending record until 1.2.2 is audited at its committed SHA.

See [../BUILDING-EXTENSIONS.md](../BUILDING-EXTENSIONS.md) for the full authoring guide.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
