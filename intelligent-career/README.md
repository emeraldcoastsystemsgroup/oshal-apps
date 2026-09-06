# Intelligent Career

One front door for the job search. Intelligent Career is an **application group**
([ADR-141](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/141-application-groups.md)):
a manifest with no code that binds four installed applications into one toolbar and
gives them a shared setup page.

| Member | What it brings |
|---|---|
| `career-hunter` | the job board, Search Jobs, Submissions, Resume Studio, Strengthen, Profile Studio, Settings |
| `portrait-studio` | the profile picture |
| `social` | LinkedIn Assistant, the Workspace, Signals, and the Accounts hub (LinkedIn / Facebook / X) |
| `print-ingest` | the Print Inbox — documents printed into the swarm |

## How the toolbar is built

Every tile is **borrowed by reference** from a member, by app and surface name. The
kernel copies the member's label, icon and URL when the group activates and again
every time the ribbon is synthesised, so a member that moves a surface is followed,
and a member that drops one fails this group with both names instead of leaving a
dead tile. Nothing in `oshal-app.yaml` is a copied URL.

## The setup page

The group's first tile is **Setup**, rendered by the kernel from the seven steps in
the manifest:

1. Upload your resume
2. Take or upload a profile picture
3. Connect Facebook
4. Pick the articles you want to comment on
5. Review your resume story by story
6. Add performance reports and other documents
7. Subscribe to the print service

Each step asks a `readiness:` probe the member declares over its own store, in the
signed-in user's session. A step is done only when the member answers `true`; an
error or a missing answer shows as "can't check", never as done. **Fix** opens the
member surface inside the same ribbon.

Step 5 reads honestly today: it reports how many of your roles carry a story, and
the story-by-story review conversation that fills them is a career-hunter feature
tracked in the oshal BACKLOG (ADR-141 D7).

## Install

Installing the group resolves all four members (npm-style, fail-closed). A group
activates only while every member is active — `print-ingest` installs inactive by
design (ADR-135), so activate it first, then the group. After installation, open:

```text
/cockpit/?app=intelligent-career
```

A deployment that maps a hostname to it (`HOST_APP_MAP=career.oshal.ai=intelligent-career`)
lands the subdomain on the group instead of on one member app.
