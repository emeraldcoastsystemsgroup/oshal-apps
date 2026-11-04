# Vids Studio (`vids`) parity audit

## 1. What it is

`vids` (1.5.7) is a job queue, not an editor. A person types an idea at `/api/vids/app` (page served from `src-routes/vids-routes.ts`). A separate Vids worker, a computer with a screen and Chrome signed in to Google Vids, then clicks through Google Vids to make a Veo clip. Without a worker online, Generate is switched off. The finished file does not come back by itself on this page: the person attaches the MP4 by hand. It is measured against Google Vids (a browser video maker with AI drafting, voiceover, avatars and stock) and Runway (AI video generation and AI editing). Because a clip is edited inside Google Vids, nothing made here can be edited with our own tools. That is the main conflict with the owner's rule.

**How to read the table.** "Yes†" means general product knowledge not re-checked against a source in this audit. I read the code and did not run a worker. `vids_generate` is declared in `oshal-app.yaml` but is a CLI tool: the native kernel offers only route and package tools (kernel `crates/oshald/src/package_api_tools.rs` leaves out anything that is "not a route tool"; `tests/vids-api-tools.test.cjs` records the same failure). So it does not count here.

Google Vids mobile: the availability help page (read through mirror copies) describes viewing on Android or iOS and editing on a computer. A 2024 report says the same. Treat this as probably current, not certain. Runway's help page says the iOS app gives quick access to key features without listing them, so per-feature Runway mobile cells read "not confirmed".

## 2. Parity table

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| Generate a clip from a prompt | basic | Runway iOS: Yes; Google Vids: view only | Yes | `vids-routes.ts` page `#prompt`, `#go` (needs a worker) | `vids-generate-clip` (held for approval) | both |
| Choose landscape, portrait or square | basic | not confirmed | Yes† | `#orientation` | `vids-generate-clip` `orientation`. The tool says "landscape or portrait", but the route accepts only `Landscape`, `Portrait`, `Square` and answers 400 to anything else; no coercion in `vids-routes.ts`. Square is not offered in the description | both |
| Insert as a new scene or extend the last | basic | not confirmed | Google Vids: Yes | `#insertMode` | none. `vids-generate-clip` has no `insertMode` | UX only |
| Start from your own image or video | basic | not confirmed | Yes (image to video) | none. The route reads `ingredient`, but the page has no control | none. Not in the tool's schema | missing |
| Brand intro or still brand graphic | basic | not confirmed | Google Vids: templates | none on the page | `vids-brand-graphic` | concierge only |
| Multi-scene story | basic | not confirmed | Google Vids: Help me create | none. `POST /api/vids/story` has no control on the page | none. No route tool for `/story` | missing |
| Draft outline, script and scenes from a prompt | basic | Google Vids: No | Google Vids: Yes | none | none. The persona shaping a prompt is reasoning, not a tool | missing |
| See jobs and their status | basic | not confirmed | Yes | Jobs table `#rows` | `vids-jobs` | both |
| Cancel or retry a job | basic | not confirmed | Yes† | none. No such route | none | missing |
| See whether a worker is ready | ours | not applicable | not applicable | `#wtxt`, `#whint` | `vids-jobs` returns workers; a generating tool answers 503 | both |
| Get the finished file back | basic | Runway: not confirmed | Yes (MP4, GIF, Drive) | Manual: file input `data-artifact="attach"`, then Preview | none. No tool attaches or fetches the file | UX only |
| Publish or revoke a public link | basic | not confirmed | Google Vids: share† | Publish and Revoke buttons | none | UX only |
| Remove a finished export | basic | not confirmed | Yes† | Remove button | none | UX only |
| Edit on a timeline (trim, arrange, split) | basic | Google Vids: No | Yes | none. Editing happens inside Google Vids on the worker | none | missing |
| AI voiceover | basic | Google Vids: No | Google Vids: Yes (free in US, per reports) | none. `/brand` reads `voiceover`, `voice`, no control | none. Not in `vids-brand-graphic`'s schema | missing |
| Avatars | basic to pro | Google Vids: No | Google Vids: Yes; Runway Act-Two | none | none | missing |
| Record yourself or your screen, teleprompter | basic | Google Vids: No | Google Vids: Yes | none | none | missing |
| Stock video, images and music | basic | Google Vids: No | Google Vids: Yes | none | none | missing |
| Templates | basic | Google Vids: No | Google Vids: Yes | none | none | missing |
| Transitions and animations | basic | Google Vids: No | Google Vids: Yes | none | none | missing |
| AI edit of existing video (remove an object, change a scene) | pro | Runway: not confirmed | Runway Aleph: Yes | none | none | missing |
| Performance capture | pro | not confirmed | Runway Act-Two: Yes | none | none | missing |

**The mobile and basic/pro picture.** The page has a phone-width table layout (change log entry 4 in `vids-routes.ts`) and one form, so basic generation fits a phone. There is no pro level at all. Editing, which is what Google Vids and Runway are for, is not in the package.

## 3. Backlog (ordered by what people hit first)

- **CREATE-TOOL-VIDS-01: The finished clip comes back by itself.** Done when: a job that reaches done shows Preview with no manual upload, and `vids-jobs` returns its file.
- **CREATE-TOOL-VIDS-02: A clip made here can be edited here.** Done when: a finished clip has "Open in Video editor", which adds it to a Video project as an editable source, on screen and through a tool.
- **CREATE-TOOL-VIDS-03: Fix the orientation contract.** Done when: `vids-generate-clip` lists `Landscape`, `Portrait` and `Square` as an enum, or the route accepts lower case, and a test proves lower-case `portrait` from a tool call does not get a 400.
- **CREATE-TOOL-VIDS-04: Say plainly when no worker exists, and offer a way forward.** Done when: on an installation with no worker, the page and the concierge offer a route that does not need one (a hosted model or a stated alternative), or clearly state none exists, instead of a switched-off button.
- **CREATE-TOOL-VIDS-05: Screen and concierge parity on existing features.** Done when: the page has brand intro, brand graphic and story controls, the tool has `insertMode` and a story tool exists, each proven by a chat turn and a browser walk.
- **CREATE-TOOL-VIDS-06: Start from an image or video.** Done when: a person picks an image in the page or names one in chat and the job carries it to the worker, with the clip showing that subject.
- **CREATE-TOOL-VIDS-07: Concierge handles finished exports.** Done when: tools exist for attach status, publish, revoke and remove, with publish held for approval, proven by a chat turn.
- **CREATE-TOOL-VIDS-08: Cancel and retry.** Done when: a queued or running job can be cancelled and a failed job retried, on screen and by tool, and the worker stops the cancelled task.
- **CREATE-TOOL-VIDS-09: Draft a video from a prompt.** Done when: a prompt yields an outline with scenes, scripts and voiceover that the person edits before anything renders.
- **CREATE-TOOL-VIDS-10: Voiceover, stock, templates and record-yourself.** Done when: the owner decides which belong here and which belong in `video`, the decision is recorded, and each kept feature has a control and a tool.
- **CREATE-TOOL-VIDS-11: AI edit of existing video.** Done when: a person selects a clip, describes a change and gets a new clip, with the original kept, by hand and by tool. The owner decides first whether this is in scope.

## 4. Sources

- Google Vids availability and mobile viewing (mirror copy of the help page; the original is https://support.google.com/docs/answer/15609411): https://arrahmah.netlify.app/host-https-support.google.com/docs/answer/15609411?hl=en
- Google Vids getting started: https://support.google.com/docs/answer/15082958?hl=en
- Google Vids narration and media: https://support.google.com/a/users/answer/14907575?hl=en
- Google Vids first video: https://support.google.com/a/users/answer/14819770?hl=en
- Google Vids AI clip generation: https://support.google.com/docs?p=genvideo&hl=en-GB
- Google Vids Help me create: https://workspaceupdates.googleblog.com/2025/03/new-capabilities-for-google-vids-help-me-create.html
- Google Vids avatars: https://workspaceupdates.googleblog.com/2026/04/direct-avatar-to-speak-and-act-anywhere-with-a-consistent-face-and-voice.html
- Google Vids free tier (news report; limits are not from Google directly): https://letsdatascience.com/news/google-opens-free-ai-avatars-in-google-vids-49f9f822
- Runway mobile features: https://help.runwayml.com/hc/en-us/articles/15940483005203-Mobile-features
- Runway Aleph 2 and Edit Studio: https://runway.com/news/introducing-aleph-2-and-edit-studio
- Runway Act-Two: https://help.runwayml.com/hc/en-us/articles/42311337895827-Performance-Capture-with-Act-Two
