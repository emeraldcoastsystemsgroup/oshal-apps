# Addendum to ADR-085 — `group:` on `ui.static[]`: labelled ribbon sections

- **Status:** Accepted — shipped with career-hunter **1.7.0**.
- **Date:** 2026-08-11
- **Author:** maintainer@emeraldcoastsystemsgroup.com
- **Amends:** [ADR-085 — Every app is a hot-loadable package](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/085-remote-app-packages-and-registries.md)
  (§1, "a package is the complete, self-contained app" — the manifest schema it publishes)
- **Where this note lives:** in the *package*, not the core ADR directory. ADR-085 is a core
  document; this is the first consumer of the new key writing down what the key means so the
  next store package does not have to read `RibbonNav.js` to find out. The core ADR remains
  canonical if the two ever disagree.

---

## What changed

`ui.static[]` gained one optional string key:

```yaml
ui:
  static:
    - toolName: career-board
      label: Job Board
      icon: codicon codicon-briefcase
      iframeUrl: /api/career-hunter/board-native
      section: top
      group: Job Search      # ← new
```

The cockpit ribbon buckets `section: top` entries by their `group` label:

- **Group order is first appearance**, not alphabetical. The order the groups are written in the
  manifest is the order they render.
- **Item order within a group is manifest order.**
- **Entries with no `group` render first, under no header** — the ungrouped lead band. That is
  where a pinned front door belongs (career-hunter puts `Mobile` there).
- A named group renders a small header when the rail is expanded and a thin divider when it is
  collapsed to icons. Grouping is therefore a *reading* aid on a pinned rail; a collapsed rail
  shows the structure only as separation.

Career Hunter's own split, as the worked example:

| group | entries | why |
|---|---|---|
| *(none)* | Mobile | the pinned front door, always first |
| **Job Search** | Job Board · Submissions · Recruiters · Insights | find work, queue it, watch it move, read the funnel |
| **Resume** | Strengthen · Resume Studio | the artifact you send |
| **Presence** | Profile Studio · Portrait Studio | how a recruiter sees you before they read it |

## Why an addendum, not a new ADR

ADR-085's decision is *"a manifest is the complete, portable description of an app, and the
schema is a published contract third-party packages code against."* Nothing about that decision
changes here. What changed is **one additive, optional, presentation-only key inside that
already-decided contract** — no new lifecycle, no new registry, no new failure mode, nothing a
package must now do.

A new ADR would imply a decision was reconsidered. None was. But the change is also not
invisible: it widens a contract that packages outside this repository consume, so leaving it
undocumented would mean the only description of the key lives in a renderer's private method.
An addendum is the right weight — the same shape ADR-085's own D11 addendum takes.

## Limitations, deliberately

### `section: bottom` cannot be grouped

The renderer forces bottom entries ungrouped. The bottom tray is the pinned base of the rail —
Approvals, Companies, Career Settings here — and it is *already* visually divided from the
scrollable middle. A second layer of headers inside a three-item tray buys nothing and costs
vertical space on the surface that has least of it.

Practical consequence: **a `group:` on a bottom entry is a silent no-op.** It is not a load
error, so nothing tells you it was ignored. Do not write one.

### Degradation on an older core is silent — and that is correct

Manifest → cockpit profile synthesis copies known keys. A deployment whose core predates this
change does not know `group`, drops it, and renders exactly the flat ribbon it renders today.
Every tile is present, in manifest order, fully functional; only the headers are missing.

That is the failure mode you want from a presentation key on a distributed contract. A package
in the public store is installed onto deployments the author does not control and cannot
version-check. **Fail-closed is wrong here** — refusing to load a job-search app because a
cosmetic header is unsupported would be an outage in service of a label. Compare
`surface.ops`, which *is* fail-closed, because there the missing capability is a security
boundary rather than a heading.

So: `group` is safe to add to any package today. It has no minimum core version.

## Two things a cross-app tile must get right

Career Hunter's Presence group carries a tile pointing at another *package's* surface
(`/api/portrait-studio/app`). Two behaviours bite here, and neither is obvious from the schema:

1. **`toolName` is global, so a cross-app tile must be scoped.** Activation calls
   `registerDynamicToolUI(toolName, …)` and deactivation calls `deregisterDynamicToolUI(toolName)`
   against a shared registry keyed by name alone. Reusing the target app's own tile name
   (`portrait-studio`) would let this package's activation repoint that tile and its *unload*
   deregister it out of the owning app's ribbon. Career Hunter declares
   `toolName: career-portrait-studio` for exactly this reason. This is the `ui.static` echo of the
   D11 tool-name collision ADR-085 already records for the `tools:` block.

2. **Guest tier follows the URL, not the declaring package.** The ribbon derives a view's app
   segment from the `iframeUrl` (`/api/<segment>/…`), then looks the guest tier up by that
   segment. A cross-app tile therefore inherits the *target's* tier — career-hunter's
   `guestTier: readonly` does not govern the Portrait Studio tile; portrait-studio's does. Check
   the target's tier before putting a cross-app tile on a deployment exposed to the guest demo.

A cross-app tile is also a real dependency: it declares `dependencies.apps: [portrait-studio]`,
which is what makes the installer pull the target in and makes the reverse-dependency guard block
a portrait-studio uninstall while Career Hunter is active (ADR-085 §5 — the block never cascades).

## Related package files

- [`../oshal-app.yaml`](../oshal-app.yaml) — the grouped `ui:` block and the `dependencies:` block,
  both commented in place.
- [`../README.md`](../README.md) — the package shape overview.
