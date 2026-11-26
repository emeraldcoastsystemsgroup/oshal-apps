# LoRA Studio: parity audit against Civitai and Kohya

`lora` 1.10.6 trains a reusable character model on the owner's GPU worker, scores each version on a fixed validation matrix, and improves weak spots by regenerating data and retraining. It is measured against the Civitai on-site trainer (web, guided, paid in Buzz) and Kohya_ss (a local training GUI with every setting exposed). LoRA Studio goes further than both on scoring, now gives `lora-director` full read and approval-held action parity across existing studio routes (characters, models, scorecards, dataset receipts, character create/delete, train/validate/improve, active version, overnight toggle, artifact import, and single-version deletion), and still has open backlog work on zip/.txt batch dataset upload, dataset image removal, and model export/prompt testing.

## Table

How to read it:
- Our side comes from reading the snapshot. `lora.html` means `lora/tools/lora.html`; routes are in `lora/src-routes/bot-lora-routes.ts` and `lora/src-routes/lora-read-queries.ts` unless named.
- Train, validate and improve need a registered GPU worker; otherwise they answer `box_required`.
- Letters in brackets are sources, listed at the end. [K] means general product knowledge, not re-read. "n/c" means not confirmed. Tier: basic is what the guided Civitai flow shows by default; pro is advanced settings or a Kohya-level control. Neither source shows a phone app, so the mobile cell is n/c unless stated. Kohya runs on the training computer [K].

| # | Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|---|
| 1 | Create a model or character | basic | n/c | Civitai: Train a model [A]; Kohya: yes [B] | `#characterForm`, `lora.html`; starter button `#addStarterBtn` | `lora-create-character` (held, `POST /api/lora/characters`, 1.10.6) | both |
| 2 | Edit a character after saving | basic | n/c | n/c | Cosmetic display name via `#editIdentityName` (`PATCH /characters/:subject/editor`); full identity settings remain immutable after creation | `lora-editor-character-edit` (cosmetic display name only) | partial |
| 3 | List my characters | basic | n/c | Civitai: yes [K] | `#chars` & `#phoneChars`, `lora.html` (shows version count, dataset count, active version, best score, training state) | `lora-characters` (`GET /api/lora/characters` returns `datasetCount`, `activeModelVersion`, `trainingState`/`activeRunState`, 1.10.6) | both |
| 4 | Add one image to the dataset | basic | n/c | Civitai: from Generator or profile [A] | `#uploadPhotosBtn` multi-photo device uploader with crop/caption (1.10.0) + `#importArtifactBtn` Send-to import | `lora-dataset-import` (held, `POST /api/lora/dataset/import`, 1.10.6) | both |
| 5 | Upload many images at once, with captions | basic | n/c | Civitai: zip of images and .txt files [A]; Kohya: folder [K] | Multi-photo device picker with per-photo captions (1.10.0), no `.zip` + `.txt` batch import yet | none | partial |
| 6 | Write a caption for an image | basic | n/c | Civitai: manual captions [A] | `#datasetCaption`, `#photoCaptionInput`, and saved caption editor `#editSavedCaption` | `lora-editor-caption`, `lora-editor-caption-edit`, `lora-editor-caption-retry` | both |
| 7 | Auto-tag or auto-caption | basic | n/c | Civitai: WD Tagger, JoyCaption, threshold, blacklist [A] | none | none | missing |
| 8 | See, edit and remove dataset images | basic | n/c | Civitai: captions in the dataset step [A]; removal n/c | `#datasetRows` with preview thumbnails and caption editing (1.10.0/1.8.x); no dataset image delete route or button yet | `lora-dataset` (read, 1.10.6) + `lora-editor-caption-edit`; no delete tool yet | partial |
| 9 | Choose the base model | basic | n/c | Civitai: SD 1.5, SDXL, Flux, others, custom [A]; Kohya: any file [K] | `baseModel` free text at creation, `lora.html`; must name a file on the worker | `baseModel` input on `lora-create-character` | both |
| 10 | Training settings: epochs, repeats, learning rate, network size, buckets | pro | n/c | Civitai: epochs, repeats, some others [A]; Kohya: all [B] | none: rank and epochs are shown afterwards, not chosen | none | missing |
| 11 | Start training | basic | n/c | yes [A][B] | `#trainBtn`, `lora.html`; `POST /train` | `lora-train` (held, `POST /api/lora/train`, 1.10.6) | both |
| 12 | Sample images during training | basic | n/c | Civitai: three per epoch from prompts [A]; Kohya: to the output folder [B] | none | none | missing |
| 13 | See state and progress of a run | basic | n/c | Civitai: review screen per epoch [A] | state badge on `#chars` and version cards, `lora.html`; no step, percent or log yet | `lora-characters` (`trainingState`/`activeRunState`) & `lora-models` (`status`) (1.10.6) | partial |
| 14 | Save and choose between epochs | pro | n/c | Civitai: up to 20 to download [A]; Kohya: save every N [B] | none (one file per version) | none | missing |
| 15 | List trained versions | basic | n/c | Civitai: yes [K] | `#vers`, `lora.html`; `GET /models?subject=` | `lora-models` (`GET /api/lora/models?subject={input.subject}`: lists all owned versions newest-first when omitted or filters by subject, 1.10.6) | both |
| 16 | Score a version on a fixed test set | pro | n/c | Not a built-in feature in either source | `#valBtn`, `lora.html`; `POST /validate` | `lora-validate` (held, `POST /api/lora/validate`, 1.10.6) | both |
| 17 | See the scorecard and weak cells | pro | n/c | Not a built-in feature in either source | View scorecard, `gallery()`, `lora.html`; `GET /scorecard` | `lora-scorecard` (read, `GET /api/lora/scorecard?subject={input.subject}&version={input.version}`, 1.10.6) | both |
| 18 | Continue from an earlier model; targeted improve | pro | n/c | Kohya: start from existing weights [B] | `#impBtn`, `lora.html`; `POST /improve` | `lora-improve` (held, `POST /api/lora/improve`, 1.10.6) | both |
| 19 | Unattended overnight runs | pro | n/c | Civitai: several jobs at once [A]; overnight n/c | `#autoTog`, `#overnightBtn`, `lora.html` | `lora-overnight-toggle` (held, `POST /api/lora/characters/{input.subject}/autonomous`, 1.10.6) | both |
| 20 | Mark the version to use | basic | n/c | Civitai: publish chosen epoch [A] | Keep as active, `lora.html` | `lora-activate-model` (held, `POST /api/lora/characters/{input.subject}/active`, 1.10.6) | both |
| 21 | Download the trained file | basic | n/c | Civitai: yes [A]; Kohya: local file [B] | none: no download route; only a worker path is stored | none | missing |
| 22 | Publish or share a model | pro | n/c | Civitai: Publish [A] | none | none | missing |
| 23 | Try the model with my own prompt | basic | n/c | Civitai: on-site generator [K] | none (only the fixed matrix) | none | missing |
| 24 | Delete a character | basic | n/c | Civitai: n/c | `#deleteCharBtn` with confirm step, `lora.html` | `lora-delete-character` (held, `DELETE /api/lora/characters/{input.subject}`, 1.10.6) | both |
| 25 | Delete one version | basic | n/c | Civitai: n/c | Delete version button with inline confirm & active-version warning on each version card, `lora.html` (1.10.6) | `lora-delete-model` (held, `DELETE /api/lora/models/{input.subject}/{input.version}`, 1.10.6) | both |

## Backlog

Ordered by what people hit first.

- **CREATE-TOOL-LORA-01: Fix the `lora-models` tool.** **DONE (1.10.6).** `GET /api/lora/models` lists all of the signed-in owner's trained versions newest-first (with `subject`, `display_name`, `version`, `overall`, `status`, `active`) when `subject` is omitted and filters when `subject` is supplied; `lora-models` declares optional `subject` (`GET /api/lora/models?subject={input.subject}`), proven against the real route both with and without `subject` in `lora/tests/lora-tool-parity.test.mjs`.
- **CREATE-TOOL-LORA-02: Make `lora-characters` return what it promises.** **DONE (1.10.6).** `GET /api/lora/characters` returns accurate per-character `datasetCount`/`dataset_count`, `activeModelVersion`/`active_version`, and `trainingState`/`activeRunState` (`training`, `queued`, `validating`, `ready`, `failed`, `idle`), surfaced on `#chars` and `#phoneChars` in `lora.html` and proven in `lora/tests/lora-tool-parity.test.mjs`.
- **CREATE-TOOL-LORA-03: Upload a dataset on screen.** **OPEN (partial: multi-photo device picker with crop/caption landed in 1.10.0; `.zip` with matching `.txt` captions still missing).** A file picker for many images, and a zip with matching .txt captions.
  Done when: a person drops a zip of 30 pairs, sees 30 queued rows with their captions, and invalid files are refused by name.
- **CREATE-TOOL-LORA-04: See, edit and remove dataset images.** **OPEN (partial: preview thumbnails and caption editing landed in 1.8.x/1.10.0; dataset image delete still missing).** Thumbnails, caption editing, delete.
  Done when: a person fixes one caption and removes one image, and the next training run uses that set. The worker's copy matches.
- **CREATE-TOOL-LORA-05: Concierge action tools.** **DONE (1.10.6).** Added read tools `lora-scorecard` and `lora-dataset`, plus approval-held action tools `lora-create-character`, `lora-train`, `lora-validate`, `lora-improve`, `lora-activate-model`, `lora-overnight-toggle`, `lora-delete-character`, and `lora-dataset-import` bound in `authorization.yaml` with existing permissions only; updated `personas/lora-director.yaml` to remove the reason-only claim and document read vs approval-held tools.
- **CREATE-TOOL-LORA-06: Download the trained model.** An owner-only route and button, plus a tool that returns the link.
  Done when: a person downloads a version's .safetensors, it loads in a stock ComfyUI, and another account's request is refused.
- **CREATE-TOOL-LORA-07: Try it with my own prompt.** A prompt box and strength setting on a version.
  Done when: a person types a prompt and gets an image from that exact version, with its version recorded on the image. The concierge can do the same.
- **CREATE-TOOL-LORA-08: Show training progress.** Step or epoch, recent loss, last log lines, and a cancel.
  Done when: a running version shows moving progress without a reload; Cancel stops the worker job and the state says cancelled.
- **CREATE-TOOL-LORA-09: Sample images per epoch, and choose an epoch.** Sample prompts on the run; save every N; choose which file to keep.
  Done when: a three-epoch run shows samples per epoch, and a person keeps epoch 2 as the version.
- **CREATE-TOOL-LORA-10: Auto-caption.** A tagger or caption model, with threshold and blacklist, and review before saving.
  Done when: a person runs auto-caption over 20 images, edits two, and the saved captions go to training. The concierge can start it.
- **CREATE-TOOL-LORA-11: Training settings with safe defaults.** Epochs, repeats, learning rate, network size, resolution and buckets, behind an Advanced section; a real choice of base model from what the worker has.
  Done when: changed settings reach the worker command and are recorded on the version, and a bad value is refused before dispatch.
- **CREATE-TOOL-LORA-12: Edit a character.** An update route and form, keeping old versions tied to the settings they used.
  Done when: changing the trigger word affects only new versions, and the old version's record still shows the old value.
- **CREATE-TOOL-LORA-13: Delete one version, by button and held tool.** **DONE (1.10.6).** Added **Delete version** button with inline confirmation (explicitly warning when deleting the active version, no native confirm dialog) on `#vers` in `lora.html`, and approval-held `lora-delete-model` (`DELETE /api/lora/models/{input.subject}/{input.version}`) bound to `lora.configure`; verified row/score/thumbnail deletion leaves other versions intact and refuses other owners.
- **CREATE-TOOL-LORA-14: Publish or share a version.** To another person on the installation, or an exported package with a model card.
  Done when: a person shares a version with a named account, that account can use it, and revoking works.

## Sources

Read directly unless marked. Civitai's guide says of itself that it is out of date and points to a newer Training Studio guide, so details may have moved.

- [A] Civitai, using the on-site LoRA trainer: https://education.civitai.com/using-civitai-the-on-site-lora-trainer
- [B] Aituts, Kohya SS LoRA training settings explained: https://aituts.com/lora-training-settings/
