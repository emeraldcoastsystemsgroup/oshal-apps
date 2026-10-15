# CREATIVE-GAP-07 — Audio recording, editing and mixing

Priority: P2. Proposed owner: Proposed audio-studio package; Video uses rendered mixes.

## Functional scope and acceptance

Existing foundation: speech, voiceover and audio in video. This is a multitrack production gap, not a missing audio-output capability.

First delivery:
- Device-selected recording with permission/device-loss states, input meter and explicit record/stop.
- At least eight audio tracks with trim/split, fades, clip gain, mute/solo, pan and sample-aligned placement.
- Per-track EQ and compressor, master limiter, loudness/peak measurement and offline mixdown.
- Waveform zoom, loop region and basic volume/pan automation.

Model: immutable PCM source assets, sample-based clip placement, project sample rate, effect chain/settings and automation points. Recording writes recoverable chunks; interrupted recording can be recovered without overwriting other takes. Resampling and effect order are explicit. Reuse owned-media/job primitives where compatible.

Formats: WAV import/export first; MP3/AAC import only through tested decoders. Export a stereo WAV master and a supported compressed review copy. MIDI/instrument/plugin hosting is later.

Acceptance: record two takes, combine dialogue/music, automate a fade and mix down. Inspect decoded samples for timing and fades, meter peak/loudness, and avoid unexpected clipping. Save/reopen preserves edits/effects. Test disconnected devices, interrupted recording, resampling, cancellation and long silence. Offline and playback mixes agree within a documented tolerance.

Later: MIDI, virtual instruments, plugin hosting, time stretching, pitch correction and surround mixing.

## Shared delivery contract

Status: specified backlog, not implemented or installed. Requested 2026-10-11.
Functional scope drives this spec; manual operation must work without an AI provider.

Reuse current application authorization, owner-qualified assets, revision conflicts,
undo/history, artifact handles, job cancellation and ledger where relevant. The same
validated model operations may be exposed to agents; that does not expand authority.
Recheck permissions at save/export and job completion. Never replace a newer revision
with an older result. Existing installed behavior is a regression gate.

Before implementation, freeze schema, route/tool catalog, migrations, engine choice,
format matrix and quotas in the owning package. Extend existing routes where suitable;
new project APIs use create/read/apply-operations/save-revision/export/job-status/cancel
with baseRevision and idempotency keys. Read/export/delete remain separate grants.
Do not add new kernel app-specific state.

Measure preview latency, peak memory, file size and export duration on the DGX arm64
host and a browser client. Publish supported dimensions/durations/object counts and
concurrency limits from those measurements. Acceptance requires real render/decode
fixtures, browser workflows, two-owner/permission-revocation checks, cancellation and
installed Test Lab receipts. Source-only proof is not installed acceptance.
