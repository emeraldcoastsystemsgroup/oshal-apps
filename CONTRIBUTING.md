# Contributing to the store repo

## Work identifies the LANE, never a model

Standing operator directive: **no model attribution anywhere** — not in a file, not in a commit
message, not in a PR body, not in a `COLLABORATE.md` entry. Identify the lane doing the work
(`LANE B`, `@game-show-backlog`, `trading lane`), never the model running it.

Two gates enforce it here. Both fail closed.

| where | what it reads | what it refuses |
|---|---|---|
| `.githooks/pre-push` | the commit messages **this push publishes** | a `*-by:` trailer naming the vendor or the model, the vendor no-reply address, a "generated with" tool footer |
| `store-ci` job **no model attribution** (`scripts/check-no-model-attribution.test.mjs`) | every tracked text file | the shapes above, plus a Change Log AUTHOR column naming a model, plus a `COLLABORATE.md` entry whose byline names one |

### Turn the hook on — once per clone

```bash
git config core.hooksPath .githooks
```

The hook is not automatic: git only runs hooks from a path the clone has been told to use. Without
this line you have no push-time gate at all.

### What is *not* attribution

The guard matches the **shape** of an attribution, never the bare identifier, because the identifier
is legitimate product vocabulary throughout this repo and gating on it would flag correct content
until somebody switched the gate off:

- `claude-code` is a real `harnessType` in this product, and packages declare it in manifests and personas.
- `ANTHROPIC_API_KEY` / `CLAUDE_CODE_MODEL` are real environment variables.
- `CLAUDE.md` is a filename.
- `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` are real model ids in persona YAML.
- `Co-authored-by: oshal maintainers <maintainer@emeraldcoastsystemsgroup.com>` is the sanctioned
  house identity and names no model.
- `career-hunter/engine/jobhunter/data/us_cities.tsv` carries the real towns of **Claude, Texas** and
  **Haiku, Hawaii**.

Every one of those has a green regression case in `scripts/check-no-model-attribution.test.mjs`. If
the guard ever flags one of them, fix the rule's shape — never delete the green case.

### The tree was cleaned in the same change — keep it that way

The guard did not land on a clean repo. When it was written, `origin/main` carried **165 attributed
lines in 5 files**: 161 `COLLABORATE.md` entry bylines naming a model (`## claude-opus-5 …`,
`[…] Claude Fable 5.1 (session …)`, `@handle (Claude Fable)`, `LANE D (Claude Opus 5)`) and four
Change Log AUTHOR cells reading `| Claude Opus |` (`brand-graphics/tools/oshal-brand.js`,
`little-monsters/tests/unit/education-serve-file.spec.ts`, `vids/routes/vids-routes.js`,
`vids/src-routes/vids-routes.ts`).

All 165 were corrected in the same change that added the guard, so the job lands **green**. The
bylines keep their lane, their session id and their topic and lose only the model name; the four
AUTHOR cells read `maintainer@emeraldcoastsystemsgroup.com`. Nothing was exempted and no pattern
was narrowed — a gate that is red from the day it lands trains everyone to ignore red, and a gate
narrowed to the files that tripped it is what `CLAUDE.md` forbids: *"never 'fix' a hit by narrowing
a pattern to the file that tripped it. Gate on the identifier, not on where it has appeared."*

So when this job goes red, your change introduced the line. **Do not add an exemption, an allowlist,
or a `continue-on-error`.** Rewrite the byline to name your lane, or set the AUTHOR cell to
`maintainer@emeraldcoastsystemsgroup.com`.

Because the tree is clean, `.githooks/pre-push` runs the tree spec too (`SCAN_TREE` defaults to 1),
so a push is refused before CI ever sees it. Set `OSHAL_ATTRIBUTION_SCAN_TREE=0` only to unblock a
push while a tree-wide cleanup is mid-flight — never as a way past your own change.

The commit-message half of the hook is scoped to the commits a push publishes, so history the
remote already holds is out of scope and nobody is blocked from working.
