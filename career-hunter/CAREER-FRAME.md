# Career's page frame

Career opens as its own application: one bar across the top, its own skin, a home page, and the whole window. This is how
it is built, and what a new Career page has to do to join it. The format follows Little Monsters' page frame
(`little-monsters/tools/lm-mascot.js`).

## What a person sees

- **A top bar** on every Career page: the Intelligent Career mark, the sections of a job search in a job seeker's words
  (Home, Find jobs, My jobs, Applications, Résumé, Profile & contacts), **More**, a chip with one count (interviews under
  way, else the jobs they have applied to, else saved jobs), and one pill with their first name and their role in Career:
  "Ada · Job seeker", or "Ada · Job source administrator".
- **My jobs and Applications are the two sides of one page** (`/api/career-hunter/board-native`). My jobs opens it on
  Saved, with New matches, Getting ready and Removed in the row of stages; Applications opens it on Applied, with
  Interviewing, Offer and Closed. The bar marks whichever side the open stage is on, and the page shows that side's row only.
- **The activity page** (`/api/career-hunter/submissions`) is a page of Applications. No menu lists it: Applications links
  to it, with one quiet link, while Career is sending something from the person's computer or a send did not go through.
- **A row under the bar** when the open section has several pages: Résumé (My résumé, Other experience, Improve it),
  Profile & contacts (LinkedIn profile, Photo, Posts, Recruiters). Photo and Posts are the bar's own words for Portrait
  Studio's page and Social's workspace; those applications are not changed. Improve it is the bar's word, under Résumé,
  for the page whose own name is Improve my résumé: a toolbar or a menu that lists it alone, and a card on Home, show the
  whole name.
- **More** holds the sections' pages by name, then Career Review, Job market, Download my data, Accounts, Settings,
  Companies (for an administrator), and "← All applications".
- **On a phone**: a 56px top bar (mark, the count chip, a menu with the person's name and role) and a bottom bar of Home,
  Find jobs, My jobs, Applications and More. More opens a sheet with everything else.
- **Home** (`/api/career-hunter/home`) is the day of someone looking for a job. Under the search box, **Today** lists the
  day's steps in order, each one line with one button, and only when there is something to do: replies from the inbox
  against their job, new matches since yesterday, the jobs Career picked that are still waiting, recruiter follow-ups due,
  applications with no reply for a week, interviews in progress, the next thing for the person's profile, and the next résumé
  improvement. The first step carries the page's one filled button. A person with no résumé sees one sentence saying what
  Career does and three numbered steps instead. Below: this week's counts, the pipeline as six cards (New matches, with the
  number scored since yesterday, then Saved, Getting ready, Applied, Interviewing and Offer), the person's jobs
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
that is in no section is under More, so a tile added to the manifest later is never lost. Two sections may share a page:
each then names the query that opens it and its side of the page, and `sideOf` reads the side from the address
(`?view=status`, `interviewing`, `offer` and `closed` are Applications; every other address of the Job Board is My jobs).
The stage row is `tools/career-stages.js`, a separate file with the same split, and `tests/career-frame.test.mjs` holds
the two to each other. A page listed in `QUIET` is admitted and served but is in no menu. A page that has just moved a job
to another stage calls `CareerFrame.refresh()`, which re-reads the count and marks the section the page is on now.

**The role** beside the name is `roleOf` in `career-frame.js`. It reads the same profile: the Companies page
(`/api/career-hunter/companies-admin`) is bound to `career.administer` in `authorization.yaml`, and the kernel lists a page
only for a person it would admit to it, so that page in the profile means Job source administrator and its absence means
Job seeker. A profile that gave no page says nothing. The two words are the labels of the manifest's role templates
(`tests/career-role-label.test.mjs` holds them together). The frame asks for nothing new and checks no permission itself.

**The names** of Career's own pages are the manifest's labels, the same words as each page's title and heading
(`tests/career-page-names.test.mjs`).

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
- `node --test career-hunter/tests/browser/career-role-proof.mjs` (from the store root): the role beside the name for a
  job seeker and for a job source administrator, at 1440 by 900 and at 412 by 915, drawn from the shipped manifest's tiles.
- Before a delivery, in the real cockpit: `node scripts/career-frame-preview.cjs` fronts the test slot's kernel with this
  working copy's pages, and `node scripts/career-frame-walk.cjs <folder>` saves every screen at 1440 and 412 wide.

## What it does not do

- It adds no permission and changes no role. `GET /home` is bound to `app.open`, like every other Career page. Showing a
  role is presentation: what a person may do is decided by the server on every request.
- It does not change the kernel, Little Monsters, or any experience package.
- It does not restyle another application's screen: a borrowed screen keeps the look it has.
