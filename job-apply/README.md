# Job Apply (job-apply) — oshal app package

Job Apply is the tool Career and Jarvis use to apply to jobs, with one per-person setting: **which connected device applies to jobs**.

- **Single setting (`job-apply-settings`, `/api/job-apply/settings`):** lists the signed-in person's connected Open Swarm Orbit computers and browser workers (`GET /api/apply-operator/workers`) and saves their chosen device (`PUT /api/apply-operator/workers`). When no device is connected, the screen shows **None connected** with step-by-step instructions to connect an Open Swarm Orbit computer from **Devices** (`/cockpit/tools/devices.html`).
- **Fail-closed routing & Run Trace grading:** when Career or Jarvis starts an approved application, the kernel routes strictly to the chosen connected device (refusing in plain words before work starts if the chosen device is offline or has remote control turned off) and records a `"kind": "device"` span on `GET /api/trace/{ticketId}`.
- **Company & family audience views (ADR-164 D6):** `?audience=company` and `?audience=family` continue to render the account-scoped submission run card from `GET /api/job-apply/home-summary` via `/shared/ui/js/app-view.js`.

## Dependencies

Requires **career-hunter** (`career-hunter` worker bot and `career-concierge` inline concierge).

## Testing

Registered in `tests/test-lab.yaml`.

- `node --test job-apply/tests/review-page.test.cjs job-apply/tests/audience-view.test.cjs`
- `node --test job-apply/tests/job-apply-device-browser.test.cjs` (Chromium at `412x915` with touch and `1440x900`)
- `node job-apply/tests/live/job-apply-device-live.mjs --base=http://127.0.0.1:38798` (live two-device + trace proof on the test slot with full cleanup)

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| job-application-ticket | job application submission | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
