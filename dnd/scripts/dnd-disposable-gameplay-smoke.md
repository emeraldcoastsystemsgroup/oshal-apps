# Disposable gameplay smoke

## Change log

| Date/time (America/Chicago) | Author | Description |
| --- | --- | --- |
| 2026-07-22 01:34:22 | roger.murphy@emeraldcoastsystemsgroup.com | Document the opt-in, no-cost deployed gameplay guard and its fail-closed campaign and evidence boundaries. |
| 2026-07-22 01:52:18 | roger.murphy@emeraldcoastsystemsgroup.com | Document portable dedicated-profile resolution, bare-origin validation, and retained sanitized failure diagnostics. |
| 2026-07-22 01:59:22 | roger.murphy@emeraldcoastsystemsgroup.com | Block canonical and legacy Dungeon Master model calls during no-cost gameplay runs. |

`dnd-disposable-gameplay-smoke.js` drives one fresh four-hero campaign through the human tactical loop, a visible automated round, life-state checks, and reload plus quit/resume. It uses a second read-only TV page for shared-state observations. It does not claim to validate distinct guest authentication.

The guard defaults to `http://127.0.0.1:35457`. Set `DND_SMOKE_BASE_URL` explicitly to a bare, credential-free origin for any remote environment. The profile defaults to `.oshal-e2e-chrome` under the current user's home directory, and its basename must remain `.oshal-e2e-chrome`; an unauthenticated profile fails instead of borrowing another browser profile.

Required environment:

- `DND_DISPOSABLE_SMOKE=1` opts into creating a disposable campaign.
- `NODE_PATH` must expose the runner's Playwright installation when Playwright is not installed beside this application.

Optional environment:

- `DND_SMOKE_BASE_URL` selects the origin.
- `DND_SMOKE_PROFILE` selects the dedicated profile path.
- `DND_SMOKE_FORBIDDEN_CAMPAIGN_ID` and `DND_SMOKE_FORBIDDEN_CAMPAIGN_CODE` accept comma-separated deny lists for release-specific saved campaigns.
- `DND_SMOKE_EVIDENCE_FILE` selects a `.json` output path outside the repository. The default is a unique file in the operating-system temporary directory.

The browser context blocks service workers before navigation. TTS, cutaway, canonical Dungeon Master chat, and legacy Dungeon Master requests are fulfilled locally with a blocked response. Before the fresh campaign exists, every mutation except the exact campaign-create request is rejected. After creation, every mutation without that fresh campaign ID is rejected. Evidence is recursively scrubbed for authorization, cookies, passwords, secrets, tokens, API keys, session identifiers, bearer values, and JWT-shaped strings before it is written or printed.

Example PowerShell invocation from `dnd/`:

```powershell
$env:DND_DISPOSABLE_SMOKE = '1'
$env:DND_SMOKE_BASE_URL = 'https://deployment.example'
$env:NODE_PATH = 'C:\path\to\playwright\node_modules'
node scripts/dnd-disposable-gameplay-smoke.js
```

The command exits nonzero on any assertion or safety violation. Record the fresh campaign ID and join code from the evidence so the disposable artifact can be identified according to the environment's retention policy.
