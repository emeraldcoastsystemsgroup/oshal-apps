# Audio Studio (`audio`)

**Audio Studio** (`suite: ai-creative`) is an `oshal` personal-scope multitrack digital audio workstation, stem processor, 5-stage DSP mixing console, and broadcast loudness mastering workbench with Jarvis and Cockpit concierge integration.

---

## 1. Package Layout

```
audio/
├── oshal-app.yaml                       # Package manifest, routes, UI surfaces, and 12 Jarvis tools
├── authorization.yaml                   # Named RBAC catalog and HTTP/bot/tool bindings
├── personas/
│   └── audio-engineer.yaml              # Accountable inline audio-engineer concierge persona
├── migrations/
│   ├── 001_initial_audio_studio.sql     # PostgreSQL schema with two-arm Forced RLS policies
│   └── native/001-audio.sql             # Native SQLite schema under OSHAL_PACKAGE_DATA_DIR
├── routes/
│   ├── package-smoke.js                 # GET /api/audio/_smoke readiness probe
│   ├── home-summary.js                  # GET /api/audio/home-summary tile and metric counts
│   ├── audio-macro-presets.js           # ADR-208 standard formula DSP presets and recipe compiler
│   ├── audio-routes.js                  # Studio UI, byte-range CAS streaming, Kokoro TTS, and live rack
│   └── audio-editor-routes.js           # Editing contract, revisioned operations, stems, and WAV/MP3 render
├── tools/
│   ├── audio.html                       # Crisp-glass 3-pane desktop and mobile-tabbed mixing console
│   ├── audio.css                        # Theme-token stylesheet with opaque surfaces and >=44px phone targets
│   ├── audio-ui-helpers.js              # Waveform pyramid renderer, WAV encoder, and file decoder
│   ├── audio.js                         # Interactive Web Audio DSP graph and session controller
│   └── editor-handoff.mjs               # Surface bridge and document-handoff session registration
├── lib/
│   ├── db.js                            # Dual PostgreSQL Forced-RLS and SQLite repository
│   ├── blob_store.js                    # SHA-256 content-addressable blob storage under OSHAL_PACKAGE_DATA_DIR
│   ├── dsp_synth.js                     # Seeded deterministic multi-instrument stem synthesis
│   ├── dsp_engine.js                    # 5-stage biquad/compressor/reverb/ducking DSP & BS.1770 LUFS mastering
│   ├── audio_io.js                      # RIFF/WAVE + FFmpeg (-threads 4) codec and Kokoro TTS adapter
│   ├── security.js                      # Fail-closed actor & personal-scope authorization guard
│   └── router.js                        # Express-compatible standalone HTTP router
└── tests/
    ├── test-lab.yaml                    # Test catalog manifest
    ├── audio-acceptance.test.cjs        # DSP math, WAV/MP3 binary, CAS, RLS/isolation, and UI acceptance suite
    └── audio-dev-shim.test.cjs          # Host-process bridge runner (runner.js) JSON-RPC integration suite
```

---

## 2. Signal Processing & Storage Guarantees (`ADR-208`)

- **5-Stage Channel Strip**: Input preamp gain, 85 Hz 2nd-order Butterworth high-pass rumble filter, 3-band parametric EQ (100 Hz low shelf, 1.5 kHz peaking mid, 8 kHz high shelf), dynamics (noise gate, feed-forward compressor, vocal-triggered sidechain ducker, multi-mode saturation, Schroeder room reverb), and constant-power stereo pan.
- **Broadcast Loudness Mastering**: Coupled stereo K-weighted loudness measurement (ITU-R BS.1770) normalized to `-14.0 LUFS` with a `-1.0 dBTP` true-peak brickwall limiter, exported as 16-bit PCM WAV or 192 kbps MP3.
- **Two-Arm Owner Isolation**: Every table enforces `owner_issuer` + `owner_sub` isolation (`ENABLE` + `FORCE ROW LEVEL SECURITY` in PostgreSQL and composite owner keys in SQLite), and `GET /api/audio/blobs/:hash` verifies blob ownership before streaming `200` / `206 Partial Content` byte ranges.

---

## 3. Running Verification

```bash
cd audio && node --test "tests/*.test.cjs"
```

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| audio-editing-command | editing command | T1 | none | disable | not yet measured | none recorded |
| stem-mixdown | audio mixdown | T2 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
