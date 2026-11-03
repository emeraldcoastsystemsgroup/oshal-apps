# Model tests for the lesson studio

Tools that answer one question with measurements: can a given model write a lesson, or voice one, well enough
for the Study Lab? The findings of the first run, on 2026-11-02, are in
[docs/lesson-studio-local-models.md](../../../docs/lesson-studio-local-models.md).

Nothing here changes a lesson, a take or a video in this checkout. Every run works in folders you name.

## Can a model write a lesson?

```bash
cd little-monsters/scripts/lesson-studio/model-tests
export LESSON_PYTHON=<a python with numpy and faster-whisper>    # narrate.py times the rehearsal take with it
python3 author.py --model bot-fast --endpoint http://127.0.0.1:8000/v1 --think \
    --targets percent,transitions,mainidea,science-design --rounds 5 --parallel 2 --out /tmp/lesson-model-runs
python3 compare.py /tmp/lesson-model-runs
```

`author.py` gives the model what a person writing a lesson has: the studio guide, `stage/stage.js`, the teachers,
two finished lessons (`linear`, `agreement`) and the catalog entry. It never shows the model the published script
of the lesson it writes.

Each draft goes through the same checks as the published lessons:

- `check.cjs` checks the house rules and the arithmetic. It also finds every cue and spoken word that a beat's
  `run` asks for but the beat does not have.
- `narrate.py --engine kokoro` records a rehearsal take and times every word.
- `build-audit.cjs` builds the lesson on the real stage and runs the layout audit after every cue.

The problems go back to the model, up to `--rounds` times. The model is also told when it returns a file
unchanged.

The prompt is about 45,000 tokens, so `--max-tokens` (default 48,000) plus the prompt must fit the model's
context. `--think` asks for the model's reasoning; `vllm-fast` starts with it off. Keep `--parallel` at about 3
on the shared local model.

`compare.py` puts each run beside the published lesson. It shows passed, rounds, words, beats, length, moving
parts, highlights, layout problems, problems left, model minutes and tokens.

These tools run model-written JavaScript: `narrate.py` and `check.cjs` load the drafted lesson in Node, and
`build-audit.cjs` loads it in Chromium. Point them only at a model you run yourself. A drafted lesson's `facts`
are evaluated only when they are plain arithmetic.

## Can a model write the outline? (the writer's half)

A writer turns the catalog entry into an outline, a sample problem and the script. An animator renders that in
the fixed chalkboard format. `writer/` tests the writer's half on its own:

```bash
cd little-monsters/scripts/lesson-studio/model-tests/writer
python3 run.py --out /tmp/writer-runs --modes fast,think --parallel 2
python3 grade.py /tmp/writer-runs/percent-think.json percent math "Use percent multipliers"
```

`format.md` is the outline the model fills in. It has:

- beats in the fixed chapters;
- each `say` spelled as spoken;
- board items, each landing on a spoken word;
- highlights;
- one demonstration per beat, chosen from nine fixed kinds.

`example-linear.json` is a published lesson (`linear`) converted into that format by hand. It is the model's one
example. `grade.py` checks:

- the format and the chapter order;
- words spelled as spoken;
- every trigger word is actually spoken;
- the your-turn pause and its answer beat;
- the closing line;
- the arithmetic, as plain arithmetic only;
- the length.

The grader passes the example. Whether the questions give the answer away, and whether the teaching is good,
still needs a reader. The animator that would render this format is not built.

## Can a local voice read a lesson?

```bash
python3 voices.py kokoro percent --out /tmp/kokoro-voices                 # every English Kokoro voice, measured
<qwen python> voices.py qwen3 percent --describe "<voice>" --out /tmp/qwen3.wav
<voxcpm python> voices.py voxcpm2 percent --describe "<voice>" --out /tmp/voxcpm2.wav
python3 robust_pitch.py /tmp/qwen3.wav /tmp/voxcpm2.wav
python3 register_take.py percent /tmp/voxcpm2.wav --cache /tmp/vox-cache --label voxcpm2
LESSON_CACHE=/tmp/vox-cache $LESSON_PYTHON ../narrate.py percent --engine kokoro
LESSON_CACHE=/tmp/vox-cache node ../render.mjs percent --engine kokoro --out /tmp/vox-video --small /tmp/vox-video
```

Qwen3-TTS and VoxCPM2 each need their own Python environment on the Spark:

```bash
python3 -m venv q && q/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu130 && q/bin/pip install qwen-tts
python3 -m venv v && v/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu130 && v/bin/pip install "voxcpm>=2.0.2"
```

The weights download to `~/.cache/huggingface` on first use: about 4.3 GB for Qwen3-TTS and 4.7 GB for VoxCPM2.
If the GB10's shared memory is short when a model starts, it reports CUDA out of memory, so start it when other
jobs are quiet.

`register_take.py` files the take as a rehearsal take. A video made from it can be watched and compared, but the
guards refuse to publish a video whose manifest names a rehearsal voice.

`robust_pitch.py` measures pitch movement the way `narrate.py` does, but first drops octave jumps.
`narrate.py`'s figure reads deep voices an octave off. Kokoro `am_onyx` measured 29.7 semitones there; it is
really 6.2.

The voice descriptions used on 2026-11-02 for Pinky:

- Qwen3-TTS: "A young cartoon monster teacher with a bright, warm, playful voice and a real smile in it. Curious
  and lively, with big swings in pitch, quick delight when revealing a sneaky math trick, and clear emphasis on key
  numbers. Energetic but clear American English for teenagers."
- VoxCPM2: "A young cartoon monster teacher, bright warm playful voice with a real smile in it, curious and lively
  with big swings in pitch, delighted when revealing a sneaky math trick, unhurried teaching pace with small pauses
  between ideas, American English"
