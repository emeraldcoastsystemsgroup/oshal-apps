# Creative Studio (`creative-studio`) parity audit

## 1. What it is

`creative-studio` (1.5.2) produces short, kid-safe story videos from a curated public-domain library or a person's own script, alongside an editable storyboard brief workspace. Its screen, `tools/review.html`, shows counts and recorded work, a **Make the next story** button, a browsable **Story library** with `"Made"` / `"Not made yet"` badges and **Choose / Produce** buttons, and a **Custom story** form for title, script, scene count (`1..12`), and shape (`16:9`, `9:16`, `1:1`). It is measured against automated story-video tools such as AutoShorts.ai (series, scheduling, voices, editing the script and images before posting). The research sources for this category are mostly directories and reviews, so read those industry cells as indicative. These tools are web products, so I found no evidence either way on mobile and the column mostly reads "not confirmed".

**Resolved in 1.5.2 (`CREATE-TOOL-CREATIVE-STUDIO-01`..`-05`).** All story production tools (`creative-studio-library`, `creative_list`, `creative_produce_next`, and `creative_produce`) now run as native route-backed `executorType: api` tools inside `/api/creative-studio/stories/...` with exact matching `authorization.yaml` bindings, so the native kernel offers every tool live. All three package personas (`story-editor.yaml`, `creative-producer.yaml`, and `vids-operator.yaml`) reference only real route-backed tools declared in `creative-studio/oshal-app.yaml`. Remaining gaps (`-06`..`-09`) stay open below.

## 2. Parity table

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| Make the next story with one action | basic | not confirmed | Yes (AutoShorts series) | `#makeNextStoryBtn` ("Make the next story") in `tools/review.html` with inline no-worker status | `creative_produce_next` (`POST /api/creative-studio/stories/next`, held for approval) | both (1.5.2) |
| Make a chosen story from the library | basic | not confirmed | Yes† | `#storyLibrarySection` Choose / Produce buttons in `tools/review.html` | `creative_produce` (`POST /api/creative-studio/stories/produce`, `story` slug or title, held for approval) | both (1.5.2) |
| Make a story from your own script | basic | not confirmed | Yes (script editing) | `#customStoryForm` (`#customStoryTitle`, `#customStoryScript`) in `tools/review.html` | `creative_produce` (`title`, `script`, held for approval) | both (1.5.2) |
| Browse the story library | basic | not confirmed | Yes† | `#storyLibraryList` with `"Made"` / `"Not made yet"` badges in `tools/review.html` | `creative-studio-library` (`GET /api/creative-studio/stories/library`, auto) | both (1.5.2) |
| Choose scene count and shape | basic | not confirmed | Yes† | `#customStoryScenes` (`1..12`) and `#customStoryShape` (`16:9`, `9:16`, `1:1`) in `tools/review.html` | `creative_produce` / `creative_produce_next` (`sceneCount`, `shape`) | both (1.5.2) |
| Series on a schedule, automatic posting | pro | not confirmed | Yes (AutoShorts) | none | none | missing |
| See story jobs and counts | basic | not confirmed | Yes | `tools/review.html` `#metrics`, `#records`, `#storyJobsRecords`, `#refresh` | `creative_list` (`GET /api/creative-studio/stories/jobs`, auto) | both (1.5.2) |
| Watch a finished story | basic | not confirmed | Yes | Link "Open Vids Studio" in `review.html`, then Preview on that page | none | UX only |
| Write a brief | basic | not confirmed | Yes† | `review.html` `#title`, `#notes`, `#sourceUrl`; "Use this evidence" | `creative-studio-source-edits` | both |
| Send a brief to another app | ours | not applicable | not applicable | `⋯ More` handoff actions in `review.html` | none | UX only |
| Edit the script before it renders | basic | not confirmed | Yes (AutoShorts) | none (pre-render approval gate not wired) | none | missing |
| Replace images or redo one scene | basic | not confirmed | Yes (AutoShorts: images; one-scene redo not confirmed) | none | none | missing |
| Edit the finished story | basic | not confirmed | Yes (AutoShorts real-time editing, per directory listing) | none | none. A finished story is a flat MP4 from Google Vids; no project is created in `video` | missing |
| Choose a narration voice or clone one | basic to pro | not confirmed | Yes (AutoShorts) | none | none | missing |
| Choose captions and caption style | basic | not confirmed | not confirmed | none | none | missing |
| Choose background music | basic | not confirmed | Yes (AutoShorts) | none | none | missing |
| Choose a language | basic | not confirmed | Yes (AutoShorts) | none | none | missing |
| Post to TikTok, YouTube or Instagram | pro | not confirmed | Yes (AutoShorts) | none | none | missing |

**The mobile and basic/pro picture.** `review.html` now offers Make the next story, Story library browsing with Made status, Custom story script/sceneCount/shape submission, and Recorded work job updates on both desktop (`1440x900`) and mobile (`412x915`) with zero horizontal overflow.

## 3. Backlog (ordered by what people hit first)

- **CREATE-TOOL-CREATIVE-STUDIO-01: A button that makes a story.** **Delivered in 1.5.2.** `review.html` includes `#makeNextStoryBtn` ("Make the next story") posting to `POST /api/creative-studio/stories/next`, showing new jobs in Recorded work or explaining plainly inline when no Vids worker is online (`503 worker_unavailable`).
- **CREATE-TOOL-CREATIVE-STUDIO-02: Tools the kernel will actually offer.** **Delivered in 1.5.2.** `creative_produce_next`, `creative_produce`, `creative_list`, and `creative-studio-library` are route-backed `executorType: api` tools on `/api/creative-studio/stories/*` with matching `authorization.yaml` bindings and approval cards on production actions.
- **CREATE-TOOL-CREATIVE-STUDIO-03: Fix the persona.** **Delivered in 1.5.2.** All three personas in `creative-studio/personas/` (`story-editor.yaml`, `creative-producer.yaml`, `vids-operator.yaml`) reference only real API tools declared in `oshal-app.yaml`, guarded by `creative-studio/tests/story-parity.test.mjs`.
- **CREATE-TOOL-CREATIVE-STUDIO-04: Browse and choose from the library.** **Delivered in 1.5.2.** `GET /api/creative-studio/stories/library`, `creative-studio-library`, `#storyLibrarySection` (`"Made"` / `"Not made yet"` badges + Choose/Produce buttons), and `creative_produce` (`story` slug or title) let both people and the concierge browse and pick any library story.
- **CREATE-TOOL-CREATIVE-STUDIO-05: Own script and settings.** **Delivered in 1.5.2.** `#customStoryForm` (`#customStoryTitle`, `#customStoryScript`, `#customStoryScenes` `1..12`, `#customStoryShape` `16:9`/`9:16`/`1:1`) and `POST /api/creative-studio/stories/produce` / `creative_produce` validate and persist custom story scripts and settings on both the job record and linked source project.
- **CREATE-TOOL-CREATIVE-STUDIO-06: Review before rendering.** Done when: a story shows its scenes and script for edit and approval before any render spends quota, by hand and through the concierge.
- **CREATE-TOOL-CREATIVE-STUDIO-07: A finished story can be edited.** Done when: a finished story opens as a project in `video` with its scenes as separate clips, and captions as editable text where they exist.
- **CREATE-TOOL-CREATIVE-STUDIO-08: Voice, captions, music, language.** Done when: each is a choice on the story form and a tool field, and the result reflects it.
- **CREATE-TOOL-CREATIVE-STUDIO-09: Schedule and post.** Done when: a person sets a weekly schedule as a manifest schedule, finished stories queue for approval, and an approved story reaches a connected account.

## 4. Sources

- AutoShorts.ai features (secondary review): https://vidpros.com/autoshorts-ai-review/
- AutoShorts.ai directory listings: https://creati.ai/ai-tools/autoshorts-ai and https://topai.tools/t/autoshorts-ai
- Scheduled posting in similar tools (directories and vendor docs): https://www.videosdk.live/ai-apps/shortspilot and https://robopost.app/docs/ai-faceless-video/ and https://aitoolsatlas.ai/tools/autofaceless
