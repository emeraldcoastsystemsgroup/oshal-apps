# Meeting Recap — specification for the AI Office suite

**What it is.** Upload a meeting recording; get back, in order: a
**timeline** of what was said and what was on screen, a **summary** whose
sections carry their highlighted screenshots, and a **PowerPoint review
deck** built by the AI Office engine. The pipeline below is not a proposal —
every stage ran in production during the Junior Mining Network requirements
work (three recordings, 166 minutes, 2026-08-10/11), and the measurements
quoted are from those runs.

**Why AI Office owns it.** The final artifact is a deck; the deck engine,
themes and storage-target save already live here (ADR-103/ADR-108). Recap is
one new intake path — "start from a recording" beside the existing "start
from a topic / upload / one-line draft".

---

## The pipeline

Seven stages. Per ADR-036 the split is strict: stages 1–5 and 7 are
**deterministic operations** — no model ever receives audio or video — and
stage 6 is the **one reasoning step**, an accountable bot reading text.

### 1. Intake
An `.mp4`/`.mov`/`.webm` lands in the caller's `user_sub`-keyed workspace.
Proven at 4.3 GB / 71 minutes. Nothing is published anywhere by any later
stage; every artifact stays in the owner's workspace until they act.

### 2. Audio extraction — deterministic
Bundled ffmpeg (`imageio-ffmpeg`): `-vn -ac 1 -ar 16000` → mono 16 kHz WAV.
Seconds of work even at multi-GB inputs.

### 3. Transcription — deterministic, LOCAL ONLY
`faster-whisper small.en`, int8, CPU, `vad_filter=True` → timestamped
segments (JSON: start/end/text). **Audio never leaves the machine** — this
is the platform's existing local-transcription posture and it is a hard
rule, because meeting audio carries voices of people who never consented to
a cloud service. Measured: 95 min of two-speaker audio → 12,306 words in
~29 min of CPU; accuracy good enough that verbatim quotes were used in
client-facing requirement documents.

Model download note: `distil-small.en` needs symlink privileges Windows
denies by default (`WinError 1314`); `small.en` does not. Default to
`small.en`.

### 4. Scene detection — deterministic
Sample a frame every 15–30 s; keep frames whose **colour-space** distance
from the last kept frame exceeds threshold ~6.0 (mean absolute difference
over a 160×90 resize, int16). **Colour, not greyscale — this is a recorded
defect, not taste:** slides that differ in colour but match in luminance
made greyscale detection miss 2 of 3 slide changes in the first run.
Measured: 24-min call → 14 keyframes; 71-min screen-heavy call → 181.

### 5. Timeline assembly — deterministic
Merge transcript segments and keyframes chronologically: a Markdown document
where each scene-change image sits at its timestamp between the words spoken
around it. This artifact stands alone — it is the "what happened, minute by
minute" record — and it is the grounding the next stage cites into.

### 6. Summary and highlight selection — the reasoning step
An accountable bot (deck-builder persona family) receives the **transcript
text and the keyframe list only** — never media — and produces structured
notes: sections with timestamped verbatim quotes, decisions, action items,
and **which keyframe illustrates which section** (the "highlighted images").
Hosted/BYO inference, cost-attributed through `chat_tasks` like every other
bot call.

Two verbatim-integrity rules, both learned the expensive way:
- **Quotes carry timestamps** so any claim can be checked against the
  recording. A notes document whose quotes cannot be replayed is an
  assertion, not evidence.
- **Coverage is end-to-end, not keyword search.** A truncated keyword pass
  over the JMN transcripts missed the single most valuable topic in the
  meeting; the fix was reading the full transcript. The bot receives the
  whole text, and the prompt requires a section inventory of the entire
  duration — no "highlights only" summarisation that silently drops the
  tail.

### 7. Deck generation — deterministic
The notes structure feeds the existing AI Office outline → deck path
(themed PPTX, twenty layouts): title slide, agenda, one slide per section
(bullets + the section's highlighted screenshot + its best quote with
timestamp), a decisions/actions slide, and an appendix pointing at the full
timeline. Engine caveats already on record apply (chart parts are the known
landmine — recap decks use image + text layouts only).

## Privacy rails (non-negotiable)

- Audio and video **never leave the box** (stage 3 is local; no stage
  uploads media).
- **Faces get cropped or masked before any image is shared onward.**
  Recordings carry camera tiles of participants who did not consent to
  redistribution; the JMN practice — crop the screen-share region, drop the
  camera strip — is the default treatment for every published keyframe.
- The recording itself and raw frames stay in the owner's workspace;
  the deck and notes are the shareable artifacts, and sharing is the
  owner's explicit act (nothing auto-sends — house rule).

## Surface

One new tile flow in the AI Office front door: **"Recap a meeting"** —
upload → progress (extract → transcribe with minutes-processed ticker →
scenes → notes → deck) → three artifacts listed with open/save actions
(timeline.md, summary.md, review.pptx) saved through the existing
storage-target layer (ADR-108).

## Acceptance, measured against the reference runs

| Check | Bar |
|---|---|
| 71-min, 4.3 GB upload completes end to end | proven 2026-08-11 |
| Transcript quotes replay against the recording at their timestamps | spot-check 10 quotes |
| Scene detection catches slide changes that differ only in colour | the greyscale-miss fixture |
| Every summary section names its source timestamps and ≥1 keyframe | structural check on the notes |
| No outbound request carries audio/video bytes | network assertion in the guard |
| Deck opens clean in PowerPoint (no repair prompt) | the ADR-103 engine's existing bar |

## Build shape (for sizing, not built yet)

The deterministic stages are a worker-side pipeline (they are CPU-bound,
minutes-long — never request-cycle work); the bot call is the existing
`BotNodeClient.execute` interactive rail; the deck render is the existing
kernel engine. New code is: the intake surface + progress state, the
pipeline runner around ffmpeg/whisper/OpenCV (all already vendored on the
platform), and the notes→outline adapter. The transcription and
scene-detection code exists as working reference scripts from the JMN runs.
