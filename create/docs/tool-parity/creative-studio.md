# Creative Studio (`creative-studio`) parity audit

## 1. What it is

`creative-studio` (1.2.6) is meant to keep making short, kid-safe story videos from a public-domain library, by driving Google Vids through the same Vids worker that `vids` uses. Its own screen, `tools/review.html`, shows counts and a list of story jobs read from the Vids ledger, plus a form to write a brief and pass it to another app. It has no button that makes a story. It is measured against automated story-video tools such as AutoShorts.ai (series, scheduling, voices, editing the script and images before posting). The research sources for this category are mostly directories and reviews, so read those industry cells as indicative. These tools are web products, so I found no evidence either way on mobile and the column mostly reads "not confirmed".

**The finding that shapes every row below.** All three tools the manifest declares (`creative_produce_next`, `creative_produce`, `creative_list`) are `executorType: cli`. The native kernel offers only route tools and package tools: `crates/oshald/src/package_api_tools.rs` leaves out anything that is "not a route tool", and `crates/packages/src/tool_contract.rs` accepts only `builtinKey: package`. The `vids` test `tests/vids-api-tools.test.cjs` records the same failure for its own CLI tool. So on the native kernel these three are declared but never offered. I wrote them as "declared, not offered". The concierge beside this screen is `vids-operator`, imported from `vids`, whose route tools are `vids-jobs`, `vids-generate-clip` and `vids-brand-graphic`. The persona still tells the bot to call `creative_produce_next`.

The workflow in the manifest registers a `creative-story` ticket type with `autoStart: true`. That is a queue path, not a control, and I did not confirm it runs on the native kernel. I read the code and did not run a story end to end.

## 2. Parity table

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| Make the next story with one action | basic | not confirmed | Yes (AutoShorts series) | none in `tools/review.html` | `creative_produce_next` declared, not offered | missing |
| Make a chosen story from the library | basic | not confirmed | Yes† | none | `creative_produce` declared, not offered | missing |
| Make a story from your own script | basic | not confirmed | Yes (script editing) | none. `POST /api/vids/story` takes `title` and `script`, with no control | `creative_produce` declared, not offered | missing |
| Browse the story library | basic | not confirmed | Yes† | none. The library lives in the worker package | none | missing |
| Choose scene count and shape | basic | not confirmed | Yes† | none | `creative_produce` `beats`, `orientation`; declared, not offered | missing |
| Series on a schedule, automatic posting | pro | not confirmed | Yes (AutoShorts) | none | none | missing |
| See story jobs and counts | basic | not confirmed | Yes | `tools/review.html` `#metrics`, `#records`, `#refresh` | `vids-jobs` through `vids-operator` (`creative_list` declared, not offered) | both |
| Watch a finished story | basic | not confirmed | Yes | Link "Open Vids Studio" in `review.html`, then Preview on that page | none | UX only |
| Write a brief | basic | not confirmed | Yes† | `review.html` `#title`, `#notes`, `#sourceUrl`; "Use this evidence" | none | UX only |
| Send a brief to another app | ours | not applicable | not applicable | `.connected-app-actions` in `review.html` | none | UX only |
| Edit the script before it renders | basic | not confirmed | Yes (AutoShorts) | none | none | missing |
| Replace images or redo one scene | basic | not confirmed | Yes (AutoShorts: images; one-scene redo not confirmed) | none | none | missing |
| Edit the finished story | basic | not confirmed | Yes (AutoShorts real-time editing, per directory listing) | none | none. A finished story is a flat MP4 from Google Vids; no project is created in `video` | missing |
| Choose a narration voice or clone one | basic to pro | not confirmed | Yes (AutoShorts) | none | none | missing |
| Choose captions and caption style | basic | not confirmed | not confirmed | none | none | missing |
| Choose background music | basic | not confirmed | Yes (AutoShorts) | none | none | missing |
| Choose a language | basic | not confirmed | Yes (AutoShorts) | none | none | missing |
| Post to TikTok, YouTube or Instagram | pro | not confirmed | Yes (AutoShorts) | none | none | missing |

**The mobile and basic/pro picture.** `review.html` uses a scrolling table and a simple form, so it reads on a phone, and there is nothing else to fit. It offers no basic action at all: no way to make a story from this screen.

## 3. Backlog (ordered by what people hit first)

- **CREATE-TOOL-CREATIVE-STUDIO-01: A button that makes a story.** Done when: `review.html` has "Make the next story", which starts a story job and shows it in Recorded work, or says in words why it cannot (no worker online).
- **CREATE-TOOL-CREATIVE-STUDIO-02: Tools the kernel will actually offer.** Done when: `creative_produce_next`, `creative_produce` and `creative_list` are replaced by route tools on `/api/vids/story` and `/api/vids/jobs`, and "make the next story" in chat produces an approval card and a job.
- **CREATE-TOOL-CREATIVE-STUDIO-03: Fix the persona.** Done when: the persona names only tools the kernel offers, and a chat test confirms no reply mentions an unavailable tool.
- **CREATE-TOOL-CREATIVE-STUDIO-04: Browse and choose from the library.** Done when: a person sees the story list with what has been made, picks one, and the concierge can do the same by name.
- **CREATE-TOOL-CREATIVE-STUDIO-05: Own script and settings.** Done when: a person enters a title and script, and chooses scene count and shape, on screen and by tool.
- **CREATE-TOOL-CREATIVE-STUDIO-06: Review before rendering.** Done when: a story shows its scenes and script for edit and approval before any render spends quota, by hand and through the concierge.
- **CREATE-TOOL-CREATIVE-STUDIO-07: A finished story can be edited.** Done when: a finished story opens as a project in `video` with its scenes as separate clips, and captions as editable text where they exist.
- **CREATE-TOOL-CREATIVE-STUDIO-08: Voice, captions, music, language.** Done when: each is a choice on the story form and a tool field, and the result reflects it.
- **CREATE-TOOL-CREATIVE-STUDIO-09: Schedule and post.** Done when: a person sets a weekly schedule as a manifest schedule, finished stories queue for approval, and an approved story reaches a connected account.

## 4. Sources

- AutoShorts.ai features (secondary review): https://vidpros.com/autoshorts-ai-review/
- AutoShorts.ai directory listings: https://creati.ai/ai-tools/autoshorts-ai and https://topai.tools/t/autoshorts-ai
- Scheduled posting in similar tools (directories and vendor docs): https://www.videosdk.live/ai-apps/shortspilot and https://robopost.app/docs/ai-faceless-video/ and https://aitoolsatlas.ai/tools/autofaceless
