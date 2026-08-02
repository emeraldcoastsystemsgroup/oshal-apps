# The show library — what the joke pump makes

One file per show. `POST /api/video/pump/shows/import` reads this directory and enrols each show for
the caller, which is what puts a row in `video_pump_shows`. Editing a file and re-importing updates
the show; it never resets the enrolment switches (`enabled`, `standingAuthorization`, `dailyCap`) —
those belong to the operator, not to the library.

## The shape

```yaml
slug: stupid-superheroes         # stable handle; one row per (owner, slug)
title: Stupid Superheroes        # what the series is called
premise: |                       # the standing situation, restated to the writer every episode
  ...
styleLock: >-                    # the look, held constant across every episode of the show
  ...
scenesPerEpisode: 4              # the proven joke shape: setup / problem / turn / punchline
orientation: Landscape
introClip: 07-stupid-superheroes-intro-FINAL.mp4   # cached on the render node, or omit
cast:                            # writeSeries hands this to the writer verbatim
  - name: Captain Napkin
    description: beefy caped napkin with a stick-on chest star; announces every plan very loudly.
jokeSeeds:                       # used in rotation, one per episode, then recycled
  - the team argues about who gets to say the catchphrase
```

## The two rules a cast description must follow

Both come from renders that went wrong, and both are enforced by `validateWrittenSeries` before a
single frame is drawn:

1. **The first clause must END in that character's own noun. Props go after "with".** The renderer
   addresses a speaker by that noun (`The bean says: "…"`), so `bean drummer holding two glow sticks`
   makes the *drumsticks* talk. Write `small round bean with two glow sticks`.
2. **Every character's noun must be different.** Two characters that both resolve to `the hero`
   cannot be told apart in a prompt. This is why the superheroes are a napkin, a mug, a megaphone and
   a puppet rather than four capes.

## Why the joke seeds exist

Left to invent its own premise every time, the writer converges: ten episodes of the same joke, which
is exactly how the dropped Wonder Creek series failed ("it's just one scene over and over again").
A seed is one comedic situation, and the pump walks the list in order.
