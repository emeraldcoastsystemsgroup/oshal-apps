# Lesson studio

Makes the Study Lab lesson videos in `tools/prep-media/`. A monster from the app's own roster teaches each
lesson in a classroom: the voice is a directed performance, chalk writes as words are spoken, words and math
steps light up and move on the exact spoken word, and the monster points, reacts and speaks in time with its
voice track.

## Making a video

```bash
cd little-monsters/scripts/lesson-studio
export GEMINI_API_KEY=...                 # voice only; nothing here needs it at run time
export PLAYWRIGHT_DIR=<a checkout's node_modules/playwright>
python3 narrate.py linear                 # one take, timed against the script, refused if it does not match
node render.mjs linear                    # writes .videos/linear.mp4 and tools/prep-media/linear.{jpg,vtt}
node make-manifest.cjs                    # refreshes tools/prep-media/manifest.json
python3 ../build-test-prep-content.py     # the catalog takes each lesson's teacher, length and transcript from it
```

## Where the videos live

Not in the package. The kernel copies every package file into each person's sandbox and into each package
that depends on this one, and a package reply stops at 8 MiB with no byte ranges, so the package holds only
posters, captions and the manifest. The videos are in `.videos/` here, which is left out of that copy and out
of `git archive`, and `install-videos.py` puts one of each in the package's lasting directory, where the kernel
streams them with byte ranges. The manifest pins each video by digest, so a package only serves the video it
shipped with.

After delivering a package with new videos, on each installation:

```bash
python3 install-videos.py --data "$OSHAL_PACKAGE_DATA_DIR/little-monsters"          # before the reload
python3 install-videos.py --data "$OSHAL_PACKAGE_DATA_DIR/little-monsters" --prune  # after it
```

An installation that has not run it shows each lesson's poster and written lesson, says the video is
unavailable, and logs why.

To check pictures without spending a voice take: `python3 narrate.py linear --engine kokoro`, then
`node look.mjs linear --engine kokoro --out /tmp/look` prints the layout audit and writes contact sheets.
A rehearsal voice is never published: the guards refuse a video whose manifest names it.

`narrate.py` needs numpy and faster-whisper, `mix.py` numpy, and `render.mjs` Playwright with Chromium and
ffmpeg with libx264. Recast a teacher by changing `voice` in `lessons/teachers.js` and running
`narrate.py <id> --retake`. Free-tier speech keys allow few requests a day per model; a take is one request.

## Files

| Path | What it is |
|---|---|
| `lessons/<id>.js` | One lesson: its spoken beats and what the board does on each cue |
| `lessons/teachers.js` | Who teaches what: name, color, accessory, voice and acting notes |
| `stage/` | The classroom page, its timeline (`stage.js`) and the monster puppet (`monster.js`) |
| `art/` | `build_monster.py` (Blender) and its renders in `monster/`, the room plate, chalk grain |
| `narrate.py` | Records the take, times every word, splices pauses, measures the mouth, writes captions |
| `mix.py` | Generated sound effects mixed under the voice, leveled to one loudness |
| `render.mjs` | Seeks the stage frame by frame and encodes the video |
| `model-tests/` | Measures whether a model can write a lesson or voice one ([findings](../../docs/lesson-studio-local-models.md)) |

## Writing a lesson

A beat is `{ say, run(s, c, v), page?, chipColor?, gap?, pause? }`.

- `say` is what the monster says, spelled as spoken: "three x plus seven", never `3x + 7`. `{name}` before a
  word makes a cue at the moment that word is spoken. `[excited]`-style tags steer the delivery and are not spoken.
- `page: 'Watch me'` wipes the board with the eraser and starts a new page with that chapter label.
- `pause: 5.2` adds silence after the beat ("your turn"). `gap` overrides the silence before it.
- `run` is called once while building. `s` is the stage, `c` the cues of this beat, `v` is shared between beats.

`c.<cue>` is that cue's time; an unknown cue stops the render. `c.start`, `c.end`, `c.word('fifteen', nth)` for
the nth time a word is said in this beat, and `c.from(t, count)` for the spoken words from a time on.

Board coordinates: x 0 to 1228, y 0 to 762. The chapter label sits at the top left down to y 70, the "your turn"
ring at x 1080, y 18. The monster's pointing arm can cover the board's right side below y 450, reaching about x 990 when it points low. Text inside `s.shape` SVG is not audited: size it by hand.

### What `s` can do

| Call | Effect |
|---|---|
| `s.text(html, {x, y, size, color, align, at, dur})` | Write a line in chalk |
| `s.words(text\|array, {x, y, size, at, per, times, wrap, cell})` | Write word by word. `.w[i]` and `.find(word)` give each word. `wrap` sets a width, `cell` makes equal columns for math |
| `s.eq(tokens, opts)` | The same for math, large and tight |
| `s.spoken(text, c, cue, opts)` | Write words exactly as they are spoken, from a cue on |
| `s.below(word, html, opts)` | Write under a word so a working lines up |
| `s.read(line, c.from(t))` | Light each board word as it is read aloud |
| `s.mark(node, t, {color, hold, soft})` | Marker highlight: the word goes dark on solid color. `hold` fades it again |
| `s.circle`, `s.under`, `s.strike`, `s.arrow(a, b, t)` | Hand-drawn marks that draw themselves |
| `s.move(node, dx, dy, t)`, `s.flyTo(node, target, t)`, `s.pulse`, `s.pop`, `s.show`, `s.hide`, `s.swap(node, html, t)`, `s.tint` | Moving parts |
| `s.tag(text, {x, y, at, bg, size})`, `s.chip` | Stickers and labels |
| `s.shape(svg, {x, y, w, h})` then `s.draw`, `s.appear`, `s.turn`, `s.grow`, `s.anim` | Free drawings that draw, tilt and grow |
| `s.plot({...})` with `.line`, `.dot`, `.shade`, `.box`; `s.bars(values, {...})` with `.setTo` | Graphs and bars in data units |
| `s.frame(rect, t)` with `.to(rect, t)` | A frame that changes size |
| `s.critter(x, y, size, t, {hue})` | A tiny monster on the board |
| `s.countdown(t, secs)`, `s.stars(target, t)`, `s.confetti(t)` | Pause ring and celebrations |
| `s.faceCam`, `s.boardCam`, `s.wideCam`, `s.camera(zoom, x, y, t)` | Camera moves |
| `s.m.point(target, t, dur)`, `s.m.look(target, t, dur)` | The monster points or looks at a word, `{x, y}` or `'board'` |
| `s.m.act(name, t, dur)` | `enter`, `wave`, `cheer`, `hop`, `nod`, `shake`, `tilt`, `think`, `shrug`, `thumbs`, `stop`, `lean` |
| `s.m.mood(name, t, dur)` | `happy`, `wow`, `sly`, `hmm`, `oops`, `proud` |
| `s.sfx(name, t, gain)` | `pop`, `ding`, `whoosh`, `swipe`, `chalk`, `poof`, `boing`, `tick`, `tada` |

## Why it is built this way

Every frame is a pure function of its time, so frames render in any order and a re-render matches. Art and
sounds are generated here, so nothing needs a license beyond the OFL fonts in `fonts/` (Patrick Hand, Fredoka).
