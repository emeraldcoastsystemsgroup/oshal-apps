# Calendar Preparation

The review screen loads independently of optional calendar-sync and briefing services. Explicit sync and brief collection retain their existing authentication, confirmation and consent checks, and report an unavailable operation when the host does not provide those services.

Run `node --test calendar/tests/native-load.test.cjs` from the store root to check independent screen loading and visible failures without provider or database access. The fixture uses the installed framework Express module; set `OSHAL_CORE_ROOT` when the framework checkout is elsewhere.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
