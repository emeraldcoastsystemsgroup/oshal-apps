# Local face detector provenance

`facefinder.json` is a lossless representation of the frontal-face cascade from
[pico commit 7d550c78b2c31a4e1dfc5bcdfe9da013297b5cc8](https://github.com/nenadmarkus/pico/blob/7d550c78b2c31a4e1dfc5bcdfe9da013297b5cc8/rnt/cascades/facefinder).
The upstream binary is 239,632 bytes, SHA-256
`d8014993e7298c7b1865d1f8b855d6dbf4ec5c808bf879e2091ab6837abf90cd`.
The JSON retains the eight header bytes, depth 6, all 468 trees' signed codes,
IEEE-754 leaf values and thresholds. The registered unit test re-encodes every
byte and verifies this upstream hash. No model is downloaded at runtime.

The model's [upstream MIT license](https://github.com/nenadmarkus/pico/blob/7d550c78b2c31a4e1dfc5bcdfe9da013297b5cc8/LICENSE)
is retained unchanged in [LICENSE.txt](LICENSE.txt). Copyright (c) 2013 Nenad Markus.
The scanning and classification implementation is adapted from Nenad Markus's
[MIT-licensed picojs](https://github.com/nenadmarkus/picojs/tree/afffa50ec4134a47005f2cbf8112eaa69f65f37e),
whose source declares that license in its first line. That pinned `pico.js` has
SHA-256 `785b981cc79e5fa3f7557dc3fa7773629d7529994d7627de41b77d8687649309`.
The local adaptation splits functions, validates the fixed model and input,
limits candidates to 4,096, omits video tracking, and avoids reusing a candidate
in multiple clusters. Maintainer change logs describe these adaptations and do
not replace the upstream attribution.

This is face **detection**, not recognition, identity verification or a quality
guarantee. It works best on visible, reasonably large, front-facing human faces.
Side profiles, small faces, occlusion, unusual lighting and pets may be missed;
textures may yield false positives. Review and adjust every suggested box.

The browser uses its native detector when available, then falls back locally.
The worker receives grayscale pixels downsampled to a longest side of 640 pixels,
scans faces of at least 24 pixels, and returns at most six suggestions. The native
attempt has a 1.5-second deadline; the worker has an 8-second deadline and is
terminated after success, failure or cancellation. It fetches only the fixed,
same-origin protected model and runtime; it sends no image bytes to a server.
Photos, per-face embeddings and identities are not stored by this detector.
Manual boxes remain available and survive cancellation, failure and no matches.

To reproduce the bundled format, read the original eight header bytes, then
little-endian int32 depth/count. For each tree read `4*(2**depth)-4` signed int8
codes, `2**depth` little-endian float32 leaves, and one float32 threshold. JSON
numbers preserve all these float32 values exactly. Keep provenance and update
the integrity assertion if an upstream model is intentionally replaced.
