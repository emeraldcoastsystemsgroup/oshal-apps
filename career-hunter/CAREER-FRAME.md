# Career's page frame

Career opens as its own application: one bar across the top, its own skin, a home page, and the whole window. This is how
it is built, and what a new Career page has to do to join it. The format follows Little Monsters' page frame
(`little-monsters/tools/lm-mascot.js`).

## What a person sees

- **A top bar** on every Career page: the Intelligent Career mark, the sections of a job search in a job seeker's words
  (Home, Find jobs, My jobs, Applications, Résumé, Profile & contacts), **More**, a chip with their saved-jobs count (or
  their interviews, when there are any), and their first name.
- **A row under the bar** when the open section has several pages: Résumé (Resume Studio, Additional experience,
  Strengthen), Profile & contacts (Profile Studio, Portrait Studio, Workspace, Recruiters).
- **More** holds the sections' pages by name, then Insights, Master record, Accounts, Career Settings, Companies, and
  "← All applications".
- **On a phone**: a 56px top bar (mark, the count chip, a menu) and a bottom bar of Home, Find jobs, My jobs,
  Applications and More. More opens a sheet with everything else.
- **Home** (`/api/career-hunter/home`) is the day of someone looking for a job. Under the search box, **Today** lists the
  day's steps in order, each one line with one button, and only when there is something to do: replies from the inbox
  against their job, new matches since yesterday, applications ready to approve, recruiter follow-ups due, applications
  with no reply for a week, interviews in progress, the next thing for the person's profile, and the next résumé
  improvement. The first step carries the page's one filled button. A person with no résumé sees one sentence saying what
  Career does and three numbered steps instead. Below: this week's counts, the pipeline as six cards, the person's jobs
  (each opens that job and shows its newest reply), the résumé's state, and a card for every page.

## How it works

Every `tools/*.html` page loads two files in its `<head>`:

```html
<link rel="stylesheet" href="/api/career-hunter/static/career-frame.css"><script src="/api/career-hunter/static/career-frame.js"></script>
```

The script is not deferred, so the skin is on before the first paint. It decides who frames the page:

| Host | What the frame does |
|---|---|
| Nothing (the page is the top window) | Draws the bar; links are plain links. |
| The cockpit (`/cockpit/?app=…`) | Takes the cockpit's whole window, draws the bar, and asks the cockpit to change screens. |
| Anything else (an experience home, another Career page) | Nothing. The page looks as it did. |

**The links come from the person's own ribbon profile** (`/api/ui/profile?name=…`): the Intelligent Career front door's
when the cockpit has it open or the person can open it, else Career's own. The kernel has already filtered that answer to
what the person may open, so the bar never offers a page they cannot reach. The sections, their names and their order are
`SECTIONS` in `career-frame.js`; a section shows when the person can open one of its pages, and any page the profile lists
that is in no section is under More, so a tile added to the manifest later is never lost.

**The day** is `tools/career-today.js`: plain functions that turn the answers of routes Career already has (the inbox
check `/jobs/updates`, `/home-summary`, `/jobs/stats`, `/jobs`, `/recruiters`, `/readiness`, `/profile-studio/plan`) and,
only when the person can open those applications, Portrait Studio's `/readiness` and Social's `/content/drafts`, into the
steps. Everything is read in the browser; Career's server cannot call another application. Home does not read Email's own
routes, because a read there starts Email's self-starting jobs.

**The whole window.** In the cockpit the frame adds one stylesheet to the cockpit's document. Its rules hide the cockpit's
header, rail, status bar and chat rail, and they hold only while the cockpit is showing a page under `/api/career-hunter/`
(`body:has(.tool-view-container > iframe[src^="/api/career-hunter/"])`). When the cockpit shows another application's page,
its own chrome is back without anything having to undo it. The floating assistant is never hidden.

**Changing screens.** In the cockpit a click on the bar posts the cockpit's own `app-navigate` message, so the cockpit's
address (`&screen=`), its record of the open screen and what the assistant is told about it stay true. A query goes along
only in the shape the cockpit accepts (`CareerFrame.strictQuery`).

**Another application's screen** (Portrait Studio, the Social workspace, Accounts) opens inside Career's home page at
`/api/career-hunter/home?open=<view>`, in a frame under the bar, and only when the person's profile lists that view.

**The skin** is the block of portal token values at the top of `career-frame.css`, scoped to `html[data-career-frame]`.
Career's pages already paint from those tokens, so they wear it with no change of their own.

## Adding a Career page

1. Give its `<html>` a `data-career-surface`, and add the two tags above to its `<head>`.
   `tests/career-frame.test.mjs` fails until every page under `tools/` has them.
2. Declare its tile in `oshal-app.yaml` (`ui.static`), with a `group:` when it belongs to a section.
3. If the page measures the window (`100dvh`) or pins a part to the top, give the frame its share with
   `var(--cf-top)` and `var(--cf-bottom)`; section 4 of `career-frame.css` has the existing cases.

`career-mobile.html` keeps its own complete phone shell and does not load the frame.

## Checking it

- `node --test tests/career-frame.test.mjs` (from `career-hunter/`): the frame's arithmetic, the every-page guard, the home
  route and its binding.
- `node --test career-hunter/tests/browser/career-frame-proof.mjs` (from the store root): the shipped pages in Chromium as
  the top window, inside a stand-in cockpit, hosted by something else, on a phone and on a narrow desktop, and the home page.
- Before a delivery, in the real cockpit: `node scripts/career-frame-preview.cjs` fronts the test slot's kernel with this
  working copy's pages, and `node scripts/career-frame-walk.cjs <folder>` saves every screen at 1440 and 412 wide.

## What it does not do

- It adds no permission and changes no role. `GET /home` is bound to `app.open`, like every other Career page.
- It does not change the kernel, Little Monsters, or any experience package.
- It does not restyle another application's screen: a borrowed screen keeps the look it has.
