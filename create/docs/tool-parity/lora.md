# LoRA Studio: parity audit against Civitai and Kohya

`lora` 1.7.6 trains a reusable character model on the owner's GPU worker, scores each version on a fixed validation matrix, and improves weak spots by regenerating data and retraining. It is measured against the Civitai on-site trainer (web, guided, paid in Buzz) and Kohya_ss (a local training GUI with every setting exposed). LoRA Studio goes further than both on scoring, and falls well short on dataset work and on getting the model out. The `lora-director` concierge has two read tools and one of them cannot work (row 15); its persona says it only reasons.

## Table

How to read it:
- Our side comes from reading the snapshot. Nothing here was run. `lora.html` means `lora/tools/lora.html`; routes are in `lora/src-routes/bot-lora-routes.ts` unless named.
- Train, validate and improve need a registered GPU worker; otherwise they answer `box_required`.
- Letters in brackets are sources, listed at the end. [K] means general product knowledge, not re-read. "n/c" means not confirmed. Tier: basic is what the guided Civitai flow shows by default; pro is advanced settings or a Kohya-level control. Neither source shows a phone app, so the mobile cell is n/c unless stated. Kohya runs on the training computer [K].

| # | Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|---|
| 1 | Create a model or character | basic | n/c | Civitai: Train a model [A]; Kohya: yes [B] | `#characterForm`, `lora.html`; starter button `#addStarterBtn` | none | UX only |
| 2 | Edit a character after saving | basic | n/c | n/c | none: `POST /characters` answers 409 if it exists (`lora-character-create.ts`); no update route | none | missing |
| 3 | List my characters | basic | n/c | Civitai: yes [K] | `#chars`, `lora.html` | `lora-characters`; its description promises dataset counts and training state, but the query returns neither | both |
| 4 | Add one image to the dataset | basic | n/c | Civitai: from Generator or profile [A] | `#importArtifactBtn`, `lora.html`: only when another app opened the page with `?artifact=`; no file picker | none | UX only |
| 5 | Upload many images at once, with captions | basic | n/c | Civitai: zip of images and .txt files [A]; Kohya: folder [K] | none | none | missing |
| 6 | Write a caption for an image | basic | n/c | Civitai: manual captions [A] | `#datasetCaption`, `lora.html`, at import only | none | UX only |
| 7 | Auto-tag or auto-caption | basic | n/c | Civitai: WD Tagger, JoyCaption, threshold, blacklist [A] | none | none | missing |
| 8 | See, edit and remove dataset images | basic | n/c | Civitai: captions in the dataset step [A]; removal n/c | list of file names and states only, `#datasetRows`, `#refreshDatasetBtn`; no thumbnail, caption edit or delete; no such route in `lora-dataset-ingest.ts` | none | missing |
| 9 | Choose the base model | basic | n/c | Civitai: SD 1.5, SDXL, Flux, others, custom [A]; Kohya: any file [K] | `baseModel` free text at creation, `lora.html`; must name a file on the worker | none | UX only |
| 10 | Training settings: epochs, repeats, learning rate, network size, buckets | pro | n/c | Civitai: epochs, repeats, some others [A]; Kohya: all [B] | none: rank and epochs are shown afterwards, not chosen | none | missing |
| 11 | Start training | basic | n/c | yes [A][B] | `#trainBtn`, `lora.html`; `POST /train` | none (persona: it never trains) | UX only |
| 12 | Sample images during training | basic | n/c | Civitai: three per epoch from prompts [A]; Kohya: to the output folder [B] | none | none | missing |
| 13 | See state and progress of a run | basic | n/c | Civitai: review screen per epoch [A] | state badge on the version card, `lora.html`; no step, percent or log | none: `GET /characters` query has no training state | UX only |
| 14 | Save and choose between epochs | pro | n/c | Civitai: up to 20 to download [A]; Kohya: save every N [B] | none (one file per version) | none | missing |
| 15 | List trained versions | basic | n/c | Civitai: yes [K] | `#vers`, `lora.html`; `GET /models?subject=` | `lora-models` is declared with no input, but `GET /models` answers 400 `subject required` without a subject (`bot-lora-routes.ts`, compiled `routes/bot-lora-routes.js:477`), so it cannot succeed | UX only |
| 16 | Score a version on a fixed test set | pro | n/c | Not a built-in feature in either source | `#valBtn`, `lora.html`; `POST /validate` | none | UX only |
| 17 | See the scorecard and weak cells | pro | n/c | Not a built-in feature in either source | View scorecard, `gallery()`, `lora.html`; `GET /scorecard` | none: no tool reads a scorecard, though the persona's job is to explain one | UX only |
| 18 | Continue from an earlier model; targeted improve | pro | n/c | Kohya: start from existing weights [B] | `#impBtn`, `lora.html`; `POST /improve` | none | UX only |
| 19 | Unattended overnight runs | pro | n/c | Civitai: several jobs at once [A]; overnight n/c | `#autoTog`, `#overnightBtn`, `lora.html` | none | UX only |
| 20 | Mark the version to use | basic | n/c | Civitai: publish chosen epoch [A] | Keep as active, `lora.html` | none | UX only |
| 21 | Download the trained file | basic | n/c | Civitai: yes [A]; Kohya: local file [B] | none: no download route; only a worker path is stored | none | missing |
| 22 | Publish or share a model | pro | n/c | Civitai: Publish [A] | none | none | missing |
| 23 | Try the model with my own prompt | basic | n/c | Civitai: on-site generator [K] | none (only the fixed matrix) | none | missing |
| 24 | Delete a character | basic | n/c | Civitai: n/c | `#deleteCharBtn` with confirm step, `lora.html` | none | UX only |
| 25 | Delete one version | basic | n/c | Civitai: n/c | none: `DELETE /models/:subject/:version` exists; `lora.html` never calls it | none | missing |

## Backlog

Ordered by what people hit first.

- **CREATE-TOOL-LORA-01: Fix the `lora-models` tool.** It sends no subject and the route needs one. Accept a subject, or let the route list all of the person's versions.
  Done when: "what models have I trained?" returns the real list through a test that runs the tool's declared endpoint against the real route, not only its name.
- **CREATE-TOOL-LORA-02: Make `lora-characters` return what it promises.** Add dataset counts and current run state to the query, or correct the description.
  Done when: while a run is training, asking the concierge names it as training and gives the right image count.
- **CREATE-TOOL-LORA-03: Upload a dataset on screen.** A file picker for many images, and a zip with matching .txt captions.
  Done when: a person drops a zip of 30 pairs, sees 30 queued rows with their captions, and invalid files are refused by name.
- **CREATE-TOOL-LORA-04: See, edit and remove dataset images.** Thumbnails, caption editing, delete.
  Done when: a person fixes one caption and removes one image, and the next training run uses that set. The worker's copy matches.
- **CREATE-TOOL-LORA-05: Concierge action tools.** Held tools for create character, train, validate, improve, keep as active, overnight switch, delete character, dataset import; a read tool for the scorecard and dataset.
  Done when: "validate the latest version and tell me the weakest pose" shows a card, starts the run, and later answers from the saved scorecard; the persona's statement that it only reasons is updated.
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
- **CREATE-TOOL-LORA-13: Delete one version, by button and held tool.**
  Done when: deleting v2 removes its row, score and thumbnails and leaves v1 and v3; deleting the active version asks first.
- **CREATE-TOOL-LORA-14: Publish or share a version.** To another person on the installation, or an exported package with a model card.
  Done when: a person shares a version with a named account, that account can use it, and revoking works.

## Sources

Read directly unless marked. Civitai's guide says of itself that it is out of date and points to a newer Training Studio guide, so details may have moved.

- [A] Civitai, using the on-site LoRA trainer: https://education.civitai.com/using-civitai-the-on-site-lora-trainer
- [B] Aituts, Kohya SS LoRA training settings explained: https://aituts.com/lora-training-settings/
