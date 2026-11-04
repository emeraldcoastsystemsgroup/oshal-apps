# Video Studio (`video`) parity audit

## 1. What it is

`video` (1.11.1) has two screens. The Video editor (`tools/editor/editor.html`) is a manual timeline editor for clips you upload. It starts as one sequential track, and the person can upgrade a project to multitrack. Video Studio (`tools/video.html`) makes short videos from a prompt and runs series. It is measured against Adobe Premiere Pro on desktop, Premiere on iPhone (Adobe is retiring Premiere Rush in favour of it), and CapCut on phone and desktop. The hard limits come from `tools/editor/timeline-validation.mjs` and `src-routes/video-editor-routes.ts`: H.264 MP4 clips up to 30 s and 100 MiB, WAV audio only, a 60-second timeline, and output fixed at 1280x720 at 30 fps. The concierge (`video-editor`) can only work on the editor. No tool reaches Video Studio.

**How to read the table.** Concierge "operations" are the operations `video-apply-edits` accepts (`tools/editor/agent-tools.mjs`). Abbreviations: `editor.html` and `multitrack-editor.mjs` are in `tools/editor/`. "Yes†" means general product knowledge that I did not re-check against a source in this audit; every other industry cell rests on the sources in section 4. Blank support in a source is written "not confirmed". I read this code and did not run the editor in a browser, so a "both" means the control and the operation exist in code, not that they were walked end to end on a live box.

## 2. Parity table

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| Upload a video clip from the device | basic | Yes | Yes | `editor.html` `#addClip` (H.264 MP4 only) | none. `addSource` needs an existing upload id, and no tool uploads or lists media | UX only |
| Upload everyday phone footage (MOV/HEVC, over 30 s) | basic | Yes† | Yes† | none (refused, limits in `video-editor-routes.ts` `capabilities()`) | none | missing |
| Add an audio or music file | basic | Yes | Yes | `editor.html` `#addBed` (WAV only, no MP3 or M4A) | none. Same upload gap | UX only |
| Add a still image, logo, sticker, or stock media and music | basic | Yes (Premiere stickers, images, stock; CapCut†) | Yes† | none | none | missing |
| Place a source on the timeline | basic | Yes | Yes | `multitrack-editor.mjs` `#multiPlaceSource`; "Add to timeline" in `timeline-view.mjs` | `video-apply-edits` `addClip` | both |
| Trim a clip by typed frame numbers | basic | Yes | Yes | `editor.html` `#trimIn`/`#trimOut`, `#multi-in`/`#multi-out` | `clip` patch `in`/`out` | both |
| Trim by dragging a clip edge | basic | Yes (frame-accurate trim) | Yes | none. No trim handles in any `tools/editor` file | none (a gesture; typed trim is the row above) | missing |
| Split at a point | basic | Yes | Yes | `editor.html` `#split` (S key), `#multiSplit` | `split` | both |
| Delete a clip | basic | Yes | Yes | `#removeSegment`, `#multiRemove` | `removeClip` | both |
| Ripple delete | basic | Yes† | Yes† | `#multiRipple` | `removeClip` with `ripple: true` | both |
| Move or reorder clips | basic | Yes | Yes | `#moveLeft`/`#moveRight`; drag in `multitrack-editor.mjs` (HTML5 drag, which touch screens do not fire); typed `#multi-start` | `moveClip` | both |
| Copy, paste or duplicate a clip with its settings | basic | Yes† | Yes† | none | none. `addClip` starts fresh, with no settings | missing |
| Several video and audio tracks | basic | Yes | Yes | `#multiAddTrack` (4 video, 8 audio) | `addTrack` | both |
| Mute or lock a track | basic | Yes† | Yes† | Mute/Lock buttons in `multitrack-editor.mjs` | `track` patch `muted`/`locked` | both |
| Rename a track | basic | not confirmed | Yes† | none (name is set only when the track is added) | `track` patch `name` | concierge only |
| Delete a track | basic | Yes† | Yes† | none | none. No such operation in `agent-tools.mjs` | missing |
| Change speed, reverse, freeze frame | basic | Yes (CapCut speed ramp, free) | Yes† | none | none. `clip` patch has no speed field | missing |
| Crop, rotate, flip | basic | Yes† | Yes† | none | none | missing |
| Position, scale, opacity | basic | Yes† | Yes† | `#multi-x`, `#multi-y`, `#multi-scale`, `#multi-opacity` | `clip` patch | both |
| Keyframes (position, scale, opacity, volume) | pro | Yes (CapCut) | Yes | `#multiAddKey` with linear or hold; list with Remove | `clip` patch `keys` | both |
| Smooth keyframe easing | pro | not confirmed | Yes† | none (linear and hold only, `multitrack-validation.mjs`) | none | missing |
| Fade in and out on a clip | basic | Yes (audio fade) | Yes† | `#multi-fadeIn`, `#multi-fadeOut`, `#multi-transition` | `clip` patch `fadeIn`/`fadeOut`/`transition` | both |
| Transition library between clips | basic | Yes† | Yes (CapCut built-in library) | none (dissolve or black fade on one clip only) | none | missing |
| Basic colour (brightness, contrast, saturation) | basic | Yes (Premiere sliders) | Yes | `#multi-brightness`, `#multi-contrast`, `#multi-saturation` | `clip` patch | both |
| Pro colour (curves, wheels, LUTs) | pro | Partial (curves, not full Lumetri) | Yes | none | none | missing |
| Filters and effects library | basic | Yes | Yes | none | none | missing |
| Background removal or green screen | basic to pro | Yes (Premiere; CapCut, limited on free) | Yes (CapCut chroma key) | none | none | missing |
| Add timed titles | basic | Yes | Yes | `#titleForm`, `#multiAddText` (Title) | `text` with `track: titles` | both |
| Edit existing text in place | basic | Yes† | Yes† | none. Remove and retype; `updateTitle` in `timeline-model.mjs` is not called from the page | none. `removeText` then `text` | missing |
| Text font, colour, background, animation | basic | Yes (stylised subtitles) | Yes† | none. Three positions and three sizes; white with black border fixed in `video-edit-multitrack-compiler.ts` | none | missing |
| Add captions by hand | basic | Yes | Yes | `#multiAddText` (Caption) | `text` with `track: captions` | both |
| Automatic captions from speech | basic | Yes (CapCut free up to 10 min) | Yes | none in the editor. `tools/video.html` `#captions` only burns in captions on generated videos | none | missing |
| Clip volume | basic | Yes | Yes | `#segmentVolume`, `#multi-volume` | `clip` patch `volume` | both |
| Music under the whole video | basic | Yes | Yes | `#bedSource`, `#bedVolume`; audio track in multitrack | audio `addClip` with `volume` | both |
| Detach or unlink audio from video | basic | Yes† | Yes† | `#multiExtractAudio`, `#multiUnlink` | `extractAudio`, `unlink` | both |
| Audio waveform | basic | Yes (Premiere) | Yes† | `#multiShowWaveform` (one source, on request; not on the clips) | none | UX only |
| Record a voiceover | basic | Yes | Yes† | none | none | missing |
| Clean up speech, EQ, compression | basic to pro | Partial (Enhance Speech; no fine audio controls) | Yes | none | none. Contract lists this as unsupported | missing |
| Live preview on a sequential timeline | basic | Yes | Yes | `editor-player.mjs` (first timeline version only) | none. The concierge cannot view video | UX only |
| Live preview of a multitrack timeline | basic | Yes | Yes | none. `editor-player.mjs` shows "Use Render preview" | none | missing |
| Rendered preview | basic | not confirmed | Yes† | `#renderPreview` (640x360) | `video-render-project` with `variant: preview` | both |
| Undo and redo | basic | Yes† | Yes† | `#undo`, `#redo`, Ctrl+Z | none. No revert tool or operation | UX only |
| See earlier versions and restore one | pro | not confirmed | Yes† | none. Routes `GET /editor/projects/:id/revisions` exist; the page does not use them | none | missing |
| Create, open and rename a project | basic | Yes | Yes | `#newProject`, `#projectList`, `#projectName` (a new screen project starts sequential) | `video-new-project` (starts multitrack), `video-list-projects`, `video-read-project`, `rename` | both |
| Copy or delete a project | basic | Yes† | Yes† | `#saveAsNew`, `#deleteProject` | none | UX only |
| Vertical or square canvas, auto reframe | basic | Yes (Premiere auto reframe) | Yes† | none. Fixed 1280x720 (`PROFILE`) | none | missing |
| Export MP4, with status, cancel and download | basic | Yes | Yes | `#exportMp4`, `#cancelExport`, `#downloadExport` | `video-render-project`, `video-render-status`, `video-list-renders`, `video-cancel-render` | both |
| Export 1080p or 4K, timelines over 60 s | basic to pro | Yes (CapCut 1080p free, 4K Pro; Premiere 4K HDR) | Yes | none. 720p and 60 s are fixed | none | missing |
| Generate a short or a series from an idea | AI | not confirmed | Yes (CapCut AI Video Maker) | `tools/video.html` `#sbBtn`, `#genBtn`, `#seriesBtn`, `#pumpBox` | none. No tool for `/storyboard`, `/generate` or `/series`; the persona redirects people to the screen | UX only |
| Link a motion-graphics composition | pro | No† | Yes† (After Effects link) | `editor.html` `#motionImportPanel` | `video-list-motion-renders`, `video-import-motion-render-job`, `addSource` or `replaceMotionSource` | both |

Rows not in the table because neither side offers them today: multicam, nested sequences, SRT import and export, one-tap publishing to TikTok, Instagram or YouTube (the persona forbids publishing). See backlog items 16 and 18.

**The mobile and basic/pro picture.** Below 900 px the CSS stacks the panels (`editor.css`), but the multitrack section stays one long form of number boxes, and its drag does not work on touch. There is no basic mode and no pro mode. The first screen is sequential and the upgrade button reveals everything at once. Premiere and CapCut hide advanced controls on phones and keep the timeline as the main control.

## 3. Backlog (ordered by what people hit first)

- **CREATE-TOOL-VIDEO-01: Accept ordinary phone footage and audio.** Done when: a 2-minute iPhone MOV (HEVC) and an MP3 upload, get converted, appear in the media list, and export correctly.
- **CREATE-TOOL-VIDEO-02: Vertical and square projects.** Done when: a person picks 9:16, 1:1 or 16:9 on a new project, on screen and through the concierge, and the exported MP4 measures that shape in ffprobe.
- **CREATE-TOOL-VIDEO-03: Live preview of a multitrack timeline.** Done when: pressing Space on a two-track project shows both layers, titles and sound in the browser without a render job, and a test compares one frame with the Render preview output.
- **CREATE-TOOL-VIDEO-04: Let the concierge use media the person already uploaded.** Done when: a tool lists owned uploads, and "put the clip I uploaded yesterday on the timeline" produces an approval card with `addSource` and `addClip` and saves a revision.
- **CREATE-TOOL-VIDEO-05: Touch-friendly timeline.** Done when: on a 412 px phone a person drags a clip to move it and drags its edge to trim it, with no number box, and the saved in, out and start values match.
- **CREATE-TOOL-VIDEO-06: Automatic captions.** Done when: a button and a concierge operation turn a clip's speech into timed captions that the person can then correct, and the export shows them.
- **CREATE-TOOL-VIDEO-07: Edit and style text.** Done when: a person and the concierge can both change an existing title's words, font, colour and background without deleting it, and the export matches.
- **CREATE-TOOL-VIDEO-08: Speed, reverse, freeze, crop, rotate, flip.** Done when: each has a control and a `clip` patch field, and an export of a 10 s clip at 2x speed measures 5 s.
- **CREATE-TOOL-VIDEO-09: Concierge undo and version history.** Done when: "undo that" restores the previous revision through an approval card, and the screen lists revisions with a Restore button.
- **CREATE-TOOL-VIDEO-10: Transition library.** Done when: at least cross dissolve, wipe and slide can be placed between two clips on screen and by the concierge, and the export shows the overlap.
- **CREATE-TOOL-VIDEO-11: Concierge reaches the rest of the screen.** Done when: tools exist for storyboard, generate, series, duplicate project and delete project, each held for approval, and every one is proven by a chat turn.
- **CREATE-TOOL-VIDEO-12: Timeline management gaps.** Done when: a person can duplicate a clip with its settings, delete a track and rename a track on screen, and the concierge can do the same.
- **CREATE-TOOL-VIDEO-13: Higher output and longer timelines.** Done when: a 5-minute project exports at 1080p, with a stated plan for 4K, and the limits read from `capabilities` change on screen and in the contract together.
- **CREATE-TOOL-VIDEO-14: Stills, logos and stock.** Done when: a PNG logo can sit on an upper track with keyframed position, placed by hand and by the concierge.
- **CREATE-TOOL-VIDEO-15: Voiceover and speech clean-up.** Done when: a person records narration from the microphone onto an audio track, can run a clean-up step on it, and the concierge can apply the clean-up.
- **CREATE-TOOL-VIDEO-16: Filters, colour and green screen.** Done when: a filter list, curves or a LUT, and a colour key are available on screen and through `clip` patch, and an export test measures the change.
- **CREATE-TOOL-VIDEO-17: Basic and Pro modes.** Done when: a phone-width first screen shows only the preview, one timeline and the common actions, a Pro switch reveals tracks and keyframes, and a Playwright walk at 412 px finishes an edit and an export.
- **CREATE-TOOL-VIDEO-18: Publish and interchange.** Done when: an approved MP4 reaches a connected social account, and SRT captions can be imported and exported. Multicam and nesting stay out until a person asks for them.

## 4. Sources

- Premiere on iPhone features and gaps: https://www.videomaker.com/reviews/software/adobe-premiere-for-iphone-review-a-step-up-for-mobile-editing/
- Premiere on iPhone features, free and paid: https://digitalproduction.com/2025/09/04/premiere-iphone-adobe-goes-pocket-sized/
- Premiere Rush and the iPhone app, desktop handoff: https://www.digitalcameraworld.com/photography/video-editing/adobe-premiere-launches-on-iphone-features-mobile-to-desktop-editing-and-is-free-to-download and https://community.adobe.com/announcements-732/now-released-send-from-premiere-on-iphone-to-premiere-pro-311940?lang=en
- CapCut free and Pro: https://vidpros.com/capcut-pro-vs-free/ (secondary source; prices and limits vary between sources)
- CapCut keyframes, chroma key and stabiliser on phone and desktop (vendor pages): https://www.capcut.com/resource/capcut-ipad-vs-desktop and https://www.capcut.com/resource/capcut-stabilizer and https://www.capcut.com/create/mobile-vs-desktop-video-editing
