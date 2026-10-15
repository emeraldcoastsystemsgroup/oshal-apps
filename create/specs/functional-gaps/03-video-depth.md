# CREATIVE-GAP-03 — Multitrack video editing

Priority: P1. Proposed owner: Video Studio.

## Functional scope and acceptance

Existing foundation: sequential segments, timed titles, one audio bed, immutable media/projects, FFmpeg preview/export jobs and a source-delivered editor screen. Complete the existing install/catalog/installed-Lab gates before calling the foundation delivered on a host.

First delivery:
- Version 2 timeline with at least four video and eight audio tracks, overlapping clips, track mute/lock and deterministic compositing order.
- Trim, split, ripple delete, snapping and linked audio/video; clips keep explicit source-in and timeline start/duration.
- Dissolve and fade-to-color transitions; position, scale, opacity and volume keyframes with linear/hold interpolation.
- Per-clip exposure/contrast/saturation and timed editable captions; waveform display and peak warnings.

Model: integer frame time for video and integer sample time for audio; document conversion policy for variable-frame-rate media. Separate source duration, timeline duration and transition handles. V1 migrates to one video track plus its audio bed with identical output. Reuse compiler, job cancellation and media ownership.

Formats: first export profiles remain explicitly enumerated MP4/H.264/AAC profiles. Choose additional frame rates/resolutions only after capacity measurements. Arbitrary codecs and Premiere project import are deferred.

Acceptance: assemble overlapping footage, linked dialogue, music ducking, dissolve, animated title and captions. Decode the actual exported frames/audio to verify timing, overlap, transition endpoints, sample alignment and final duration. Save/reopen preserves the timeline. Cancellation cleans partial output; retries do not publish duplicate exports. Preview and export use the same effect math.

Later: multicam, proxies, advanced grading, motion tracking, nested sequences and external timeline interchange.

## Shared delivery contract

Status: first-delivery source implemented; installed acceptance and qualification remain pending. Requested 2026-10-11.
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

## Source delivery — 2026-10-11

Video 1.10.0 integrates v2 tracks into the existing manual editor, project/store
validator and FFmpeg export jobs. It adds overlap, mute/lock, linked audio, trims/
splits, ripple editing, drag/snapping, dissolve/black fades, linear/hold keys,
color controls and timed captions. Waveform decoding measures source peaks;
export mixing uses a 0.95 limiter. Render preview uses the same compiler as export.
Declared limits and timing/codec caveats are in Video's README. Real UI, real SQL
and actual runtime-image render/decode proof cover the principal workflow.
Native installed acceptance, waveform-device/browser coverage and maximum-load
qualification remain open; no installed or complete-parity claim is made.
