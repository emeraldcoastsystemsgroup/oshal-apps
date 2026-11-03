# Can local models make the lesson videos?

Measured on 2026-11-02 on the DGX Spark, against the 21 Study Lab lesson videos of Little Monsters 1.7.0. The
tools are in [`scripts/lesson-studio/model-tests/`](../scripts/lesson-studio/model-tests/README.md).

## Short answer

- Almost all of a lesson is already made locally: the monster art (Blender), the classroom (ComfyUI), the board
  animation and the filming (Chromium, ffmpeg), the word timing (faster-whisper), the sound effects and every check.
- **The writer's half can be local.** Given a fixed outline format, the local model `bot-fast` with thinking on
  wrote a valid outline, sample problem and script for all four lessons, in 3 to 9 minutes each, with correct
  content. Each still needs an editor's pass: practice questions that give the answer away, long lines, and few
  demonstrations in reading and grammar.
- **Hand-coding the animation is what the local model cannot do.** Asked to write each lesson as free-form stage
  code, the way the published lessons were written, `bot-fast` passed 1 of 12 runs (55 drafts). A blind panel
  scored that lesson 4 to 5 out of 10 and called it unpublishable. The published lessons scored 8 to 9.
- **The animator should not need a model.** A fixed renderer, turning an outline into the chalkboard video with a
  set of beat templates and demonstrations, would replace the hand-coding. It is not built yet.
- **The voice can be local.** Three local voices read a whole lesson without missing a word. Their pitch moves less
  than the published voice's, and they don't take acting notes the way the published voice does.

## Where each step runs

| Step | Done by | Local? |
|---|---|---|
| Writing the lesson: outline, sample problem and what the monster says | A frontier model | Yes, with an editor's pass |
| Animating it: what the board does on each word | Hand-written stage code per lesson | Not by the local model; a fixed renderer would need none |
| The voice | Gemini speech, free tier | Possible, see below |
| Word timing | faster-whisper (`narrate.py`) | Yes |
| Monster art and classroom | Blender (`art/build_monster.py`), ComfyUI | Yes |
| Board animation and filming | Chromium, ffmpeg (`render.mjs`) | Yes |
| Sound effects and mix | Generated in Python (`mix.py`), ffmpeg | Yes |
| Checks: arithmetic, layout, moving parts, captions | The `lm-lesson-studio`, `lm-lesson-videos` and `lm-prep-media-route` guards | Yes |

## Writing: the local model against the published lessons

`bot-fast` is Qwen3.6-35B-A3B in NVFP4 on vLLM. It is a mixture-of-experts model with 35B parameters, of which
about 3B run for each token. Its context window is 131,072 tokens.

`author.py` gave it the materials a person writing a lesson has: the studio guide, `stage/stage.js`, the teachers,
two finished lessons and the catalog entry. It wrote four lessons whose published scripts it never saw: `percent`,
`transitions`, `mainidea` and `science-design`. Every draft went through the house rules, a rehearsal take, a build
on the real stage and the layout audit, and the problems went back to the model.

The published lessons all pass, with no layout problems and 19 to 89 moving parts each.

| Run | Lessons passed | Rounds | Model time per round |
|---|---|---|---|
| Thinking off (the server's default), first version of the harness | 1 of 4 | 4 each | 1 to 4 minutes |
| Thinking off, final harness | 0 of 4 | 5 each | 1 to 4 minutes |
| Thinking on, final harness | 0 of 4 | 5 each | 5 to 25 minutes |

- The one lesson that passed (`percent`) moves one thing in the whole lesson, and its highlights land on the words
  "the", "the" and "your".
- With thinking on, three replies ran for 15 to 25 minutes and hit the 48,000-token reply limit without any code.
  The model kept re-checking which spoken words its cues land on.
- The replies that did come back used 11,000 to 37,000 tokens and still failed.
- Thinking on cost 208 minutes of model time and 497,000 tokens across the four lessons.
- **Typical faults:**
  - board writing timed to words the monster never says;
  - new writing on top of old writing;
  - lines running off the board;
  - a word used as a cue marker, so the monster would skip it.

A blind panel of nine reviewers judged each published lesson against the best local version of the same lesson.
They worked from end-of-beat contact sheets and the scripts, labelled only A and B. There were three lenses: a
test-prep teacher, an animation designer and a student.

| Lesson | Preferred, published : local | Overall, published | Overall, local | Publishable, published : local |
|---|---|---|---|---|
| percent | 3 : 0 | 8, 8, 8.5 | 5, 4, 5 | 2 : 0 |
| transitions | 3 : 0 | 9, 9, 9 | 3, 3, 3 | 3 : 0 |
| science-design | 3 : 0 | 9, 8, 9 | 4, 3, 3 | 3 : 0 |

Not measured: the larger local model, a 27B dense Qwen3.8, which is not running. `author.py` measures any
OpenAI-compatible model with the same command.

## Writing: the outline only

The writer's half was then tested on its own with `model-tests/writer/`. The model filled in `format.md`:

- beats in the fixed chapters;
- each `say` spelled as spoken;
- board items, each landing on a spoken word;
- highlights;
- one demonstration per beat, chosen from nine fixed kinds.

Its prompt was about 3,600 tokens: the format, the teachers, one published lesson (`linear`) converted into the
format, and the catalog entry. It never saw the published scripts of the four lessons it wrote. `grade.py` checked
every attempt, and the model had up to two repairs.

| Lesson | Mode | Passed | Attempts | Time | Words |
|---|---|---|---|---|---|
| percent | thinking off | no: 348 words, a highlight on nothing | 3 | 173 s | 348 |
| percent | thinking on | yes | 2 | 365 s | 272 |
| transitions | thinking off | no: too long, an unspoken trigger word | 3 | 107 s | 310 |
| transitions | thinking on | yes | 3 | 531 s | 243 |
| mainidea | thinking off | no: too long | 3 | 108 s | 309 |
| mainidea | thinking on | yes | 2 | 280 s | 250 |
| science-design | thinking off | yes | 3 | 129 s | 267 |
| science-design | thinking on | yes | 1 | 167 s | 223 |

A reader compared the passing outlines with the catalog and the published scripts:

- **Correctness:** no factual or arithmetic errors. Every outline covers the idea, the example, the shortcut, the
  caution and the mistake.
- **Math and science are the strongest.**
  - `percent` derives 1 − 0.2 = 0.8 on the board, asks a new practice question (an eighty-dollar shirt, up ten
    percent) and states the base trap (10 / 40 = 25%, not 20).
  - `science-design` teaches "independent" and "dependent variable" before asking about them.
- **The usual fault is a practice question that gives the answer away.** The `mainidea` question states the main
  idea itself, and its answer, "The library focus", is vague.
- **Weaker than the published scripts:** wordier, flatter lines; few demonstrations in reading and grammar; odd
  phrases such as "Think of it like a window."
- **Every outline needs an editor's pass** before it is published.

The outlines and every attempt are kept with the other evidence on the Spark (below).

## Voices: local engines against the published voice

The test used the published `percent` lesson: same script, same picture, with only the voice swapped. Pitch
movement is measured with `robust_pitch.py`. The middle-half figure is the range of the middle 50% of pitch.

| Voice | Pitch range (semitones) | Middle half | Length | Words matched |
|---|---|---|---|---|
| Gemini Achird (published Pinky) | 19.7 | 8.6 | 115 s | 100% |
| Kokoro `af_heart` (the studio's rehearsal voice) | 9.3 | 4.4 | 97 s | 100% |
| Kokoro `am_puck` | 17.1 | 5.2 | 89 s | 100% |
| Qwen3-TTS 1.7B VoiceDesign | 10.8 | 6.6 | 108 s | 100% |
| VoxCPM2 voice design | 12.3 | 7.1 | 88 s | 100% |

The published takes measure 15.3 to 22.0, with a middle half of 6.3 to 9.8.

- **Kokoro** is the speech service already running on the Spark. Of its 46 English voices, `am_puck`, `am_fenrir`
  and `af_kore` move most. The deep voices that seemed to move most were octave errors.
- **Qwen3-TTS and VoxCPM2** ran from the official PyTorch CUDA 13 wheels in their own Python environments.
  - Memory: Qwen3-TTS took 4.7 GiB of GPU memory and VoxCPM2 7.3 GiB.
  - Speed: each takes about 2 to 2.6 seconds to make one second of speech.
- **Licences:** all three are Apache-2.0.
- **Direction:** the published voice takes director's notes for each teacher. Qwen3-TTS and VoxCPM2 take a voice
  description. Kokoro has fixed voices.
- **Outside evidence:**
  - Public speech leaderboard (Artificial Analysis, read 2026-11-02): Kokoro 1059, Gemini 2.5 Flash TTS 1068,
    Gemini 3.1 Flash TTS 1212.
  - One emotion test (EmergentTTS-Eval, reported in the dots.tts paper): Gemini 2.5 Flash 95.9%, Qwen3-TTS 40 to
    60%, VoxCPM2 42%.
  - The highest-ranked open voice with a commercial licence, Ming-3.0-tts (MIT, 1188), has no report of running on
    the GB10 and was not tried.

The sample videos stay on the Spark, outside the repository, in
`~/.local/state/oshal-lm-lessons-proof/local-models-2026-11-02/`, with the blind panel's materials and verdicts.

## What follows from it

- The writer's half can move to the local model with an editor's pass, once lessons are rendered from an outline.
  Until then, each new lesson is still hand-coded as stage code, which the local model cannot do.
- The animator to build is a renderer from `format.md` to the stage: one template per beat kind and one per
  demonstration, timed by the same `narrate.py` word timing. With it, a lesson needs no hand-written code.
- The published voices stay on Gemini's free tier while it lasts. The tier gives about 10 takes per speech model
  per day, and the four teachers use three models.
- A local voice can take over if one sounds good enough to the product owner. It would need a voice engine in
  `narrate.py` and a speech service on the Spark. Neither is built.
