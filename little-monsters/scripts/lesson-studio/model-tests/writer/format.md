# Lesson outline format (for a fixed-template animator)

A lesson is ONE JSON object. The animator owns the look: a chalkboard on the left, the monster teacher on the
right. Board items appear in chalk when their `onWord` is spoken; highlights fire on their `onWord`; a demo is a
ready-made animation from the fixed list below, filled with your parameters. You only write the content.

```
{
  "id": "<lesson id>",
  "teacher": "pinky" | "bluebold" | "tealy" | "sprout",
  "title": "<the catalog title>",
  "facts": [["<JavaScript expression>", <value>], ...],      // math lessons only: every number the lesson states
  "beats": [ <beat>, ... ]                                       // 9 to 13 beats, 190 to 290 spoken words in total
}

<beat> = {
  "page": null | "The idea" | "Watch me" | "Your turn" | "A faster way" | "Watch out" | "Remember",
          // a page name wipes the board and starts that chapter; null continues the current page
  "say": "<what the monster says>",
          // spelled exactly as spoken: NO digits and NO symbols (% $ = + × ÷ < > _). Write "twenty percent",
          // "fifty dollars", "three x plus seven". Delivery tags in square brackets are allowed: [playful]
  "board": [ { "text": "<what is written, symbols allowed: 3x + 7 = 22>", "onWord": "<a word spoken in THIS beat>", "nth": 0 } ],
          // at most 5 items per beat, each at most 40 characters. nth = which occurrence of onWord (0 = first), optional
  "highlight": [ { "onWord": "<a word spoken in THIS beat>", "nth": 0, "target": "<text already on the board on this page>", "style": "mark" | "circle" | "underline" | "strike" } ],
          // target must be a board item text (or part of one) written in this beat or earlier on the same page
  "demo": { "type": "<one of the list below>", "onWord": "<a word spoken in THIS beat>", ...parameters },   // optional
  "pause": 5,      // only on the 'Your turn' beat: seconds of silence while the student works
  "gap": 0.1       // only on the beat right after 'Your turn': it starts at once with the answer
}
```

Demos (the only kinds the animator can draw; every `onWord` inside a demo must also be spoken in that beat):

| type | parameters |
|---|---|
| `equation-steps` | `steps`: [{`text`, `onWord`}] working lines written one under another; optional `cancel`: [{`text`, `onWord`}] parts struck through |
| `bar-model` | `parts`: [{`label`, `value`, optional `drop`: true}] a bar split into parts; optional `total` |
| `number-line` | `from`, `to`, optional `marks`: [numbers], optional `jumps`: [{`from`, `to`, `label`, `onWord`}] |
| `balance` | `left`, `right` (what sits on each pan), optional `changes`: [{`do`, `onWord`}] the same change to both sides |
| `sentence-highlight` | `sentence`, `highlights`: [{`text` (part of the sentence), `onWord`, `style`}] |
| `two-column-compare` | `left`, `right`: each {`title`, `items`: [strings]} |
| `table` | `columns`: [strings], `rows`: [[strings]] |
| `simple-graph` | `kind`: line, bar or scatter; `x`, `y`: each {`label`, `values`: [numbers or strings]} |
| `plant-experiment` | `variable` (what is changed), `groups`: [{`label`, `value`}], `constants`: [strings], `measure` (what is measured) |

Rules:
- Order of chapters: an opening beat (page null) where the teacher says hello and hooks the student; then
  'The idea', 'Watch me' (a worked example), 'Your turn' (a NEW question for the student, `pause` 5), the answer in
  the next beat (`gap` 0.1), 'A faster way' (the shortcut), 'Watch out' (the caution and the common mistake, may be
  two beats or two 'Watch out' pages) and 'Remember'. Extra beats with page null may continue any chapter.
- The 'Your turn' board shows the question only, never its answer or the step that gives it away.
- The last beat's `say` contains "Now hit Try this skill" (for example "Now hit Try this skill, and go get 'em!").
- Teach every term before you use it, and show WHY with a demo, not only words.
- Everything must match the catalog entry and be correct.
