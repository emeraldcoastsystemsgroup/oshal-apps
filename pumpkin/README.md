# Pumpkin (pumpkin) — OSHAL app package

Animated talking jack-o'-lantern Halloween prop (?app=pumpkin). A full-screen
procedural pumpkin face is projected INTO an inflatable pumpkin — glowing eyes and
a mouth that lip-syncs to speech. Two modes: **mimic** (mic → browser STT → the
pumpkin says your line back; pure voice I/O, no LLM) and **autonomous** (a guest
speaks and pumpkin-bot — the inline agent `...054` — replies in character via
`executeBotOrInline`, so cost lands in `chat_tasks`). Two topologies: all-in-one
(the projector page captures, thinks, speaks) and paired (the projector registers
a room + SSE-subscribes; a phone remote pushes speak/preset/mode events). Input
endpoints honor the optional `PUMPKIN_ALLOWED_SUBS`/`PUMPKIN_ALLOWED_EMAILS`
allowlist; everything is owner-scoped by OIDC sub.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the app manifest (the Pumpkin tile + focus ribbon), the
  `/api/pumpkin` routes (control surface + paired remote, presets CRUD, last-used
  settings, autonomous chat, and the bundled preset/reply/room engine with SSE
  stream + pushes), the two
  surfaces (`tools/pumpkin-app.html`, `tools/pumpkin-remote.html`), a package
  copy of the pumpkin-bot persona for the registrar (the manifest deliberately
  declares NO `bots:` block — the inline node `...054` is already registered in
  core, and re-declaring it would double-register the agent), and a migrations/
  copy of `084-pumpkin-platform.sql` so fresh installs create the tables at load.
- **Stays in the OSHAL kernel:** the full-screen **projector framework page** at
  `/pumpkin/` (`src/pages/pumpkin` via `server-ui-assets` — carved apps keep
  their framework page mounts), the pumpkin-bot **inline node** (both
  `swarm-bot-registry` blocks + the `ai-lab` persona; it rides api rebuilds),
  the kernel migration `scripts/migrations/084-pumpkin-platform.sql`, the voice
  pipeline (`/api/voice/*`), and the default Pumpkin tile in
  `oshal-framework.json`.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Pumpkin | `/api/pumpkin/app` | Control surface: preset + mode, save looks, pair a projector room, and the device links + QR codes (self-served by this package) |
| (remote) | `/api/pumpkin/remote` | Phone remote for the paired topology (self-served by this package) |
| (projector) | `/pumpkin/` | Full-screen projector page (kernel framework page) |

### Device links come from the SERVER, not the browser

The control surface asks `GET /api/pumpkin/links` for every URL it shows, and points its two
`<img>` tags at `GET /api/pumpkin/qr`. It does **not** build links from the browser's own address.
That is the whole point: the cockpit is usually open on `http://localhost:35457`, and a link copied
from that address is dead on arrival on a phone. The server knows the public origin
(`PUMPKIN_PUBLIC_ORIGIN` → `APP_URL` → `req.hostname`) and it owns `roomSlug()`, so it is the only
place that can answer "what do I type on the projector, and what do I scan with the phone".

The QR is a server-rendered PNG (the `qrcode` package already in the core image, same pattern as
`/api/tv/pair/qr`). Nothing is fetched from a CDN — a strict CSP (`script-src 'self'`,
`img-src 'self' data: blob:`) blocks that, and a same-origin `<img>` is safe under it. The two QR
URLs are deliberately **relative** (they render inside the cockpit iframe and must resolve against
whatever host the cockpit is on); the copyable projector/remote URLs are deliberately **absolute**
(they get carried to another device). The room **pairing token is never** put in a link, a QR, or a
`/links` response.

If `/api/pumpkin/links` is unreachable the surface degrades **loudly** — it falls back to a link
built from this browser's own address and says so in the status line, including the warning that a
localhost link will not open on a phone. It never silently hands you a dead URL.

### The room slug is one rule, derived in three places

```
slug = label.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40).replace(/(^-|-$)/g,'') || 'main'
```

Note the order: dashes are trimmed **after** the 40-character slice, so `slug(slug(x)) === slug(x)`.
The old rule trimmed first, and a label longer than 40 characters slugged to something ending in
`-`; re-slugifying that produced a **different** room, and the only symptom was "no projector
listening". Both surfaces now carry this exact rule, and `?room=` on the phone remote is defined as
the **slug** (it was being fed a label, which never matched the picker's option values, so the phone
opened with a blank room picker on every cold scan). Old label-bearing links still work — the remote
slugifies whatever it receives.

## Public browser demo

Pumpkin remains server-side read-only for anonymous guests. The control surface detects a guest
session and runs its showcase controls locally instead: look editing and saved looks use browser
storage, Say/Ask use browser speech plus deterministic zero-cost character replies, and the
control/projector/remote tabs communicate through a same-browser channel. This makes the public
demo fully tappable without creating database rows, spending LLM or voice tokens, allocating
server rooms, or reaching an operator's signed-in projector.

The copied demo-remote link is intentionally same-device/same-browser. Cross-device projector
pairing and autonomous AI use the authenticated, owner-scoped room/API path and require sign-in.

## Night-of runbook

Replace `https://oshal.agenticfederal.us` below with your own `APP_URL` if it differs. Everything
here is owner-scoped by OIDC sub — the projector, the phone and the cockpit must all be the **same
account**.

### 1. Sign the projector in — in daylight, on the same day

On the **projector device's** browser, open:

```
https://oshal.agenticfederal.us/pumpkin/
```

…and sign in. `/pumpkin/` is auth-gated and stays that way: it drives a device and, in autonomous
mode, spends LLM budget.

The real numbers, so you can plan around them:

- The session is **rolling with a 1-hour idle window**. The projector heartbeats its room every
  30 seconds, so that window never elapses while the page is open. Idle timeout is not your problem.
- There is a **hard 24-hour cap from the moment you sign in**, and nothing resets it. Sign in at
  4pm and it dies at 4pm the next day. **Sign in the same day as the party**, not the night before.
- If it does die, the projector shows a large "Signed out" panel rather than pretending to work.
  Recovery needs a human at the projector device to reload and sign in again.

### 2. Set the look and the room from the cockpit

On your laptop, open `/cockpit/?app=pumpkin`. Type the room name (e.g. `Front Porch`), pick the look
and the mode, then press **Launch Projector**. That also saves those three as your defaults.

### 3. Get the URL onto the projector device

The **Projector link** box now shows the full URL, ready to copy:

```
https://oshal.agenticfederal.us/pumpkin/?room=front-porch&mode=mimic&preset=inflatable&listen=ptt
```

Underneath it is the **short form**, which is what you actually type on the awkward device:

```
https://oshal.agenticfederal.us/pumpkin/
```

40 characters, nothing after the slash. With no query string the projector reads `roomLabel`, `mode`
and `activePreset` back from your saved settings — which is exactly what pressing Launch just wrote.
Any query parameter you *do* supply still wins over the stored value.

The projector device **cannot scan its own QR** (no camera pointed at itself), so this one gets
typed once. After that the control surface pushes look/mode/room changes to it live over SSE; you
never type it again.

### 4. Get the phone onto the remote

Scan the **Phone remote** QR with the phone's camera, or copy the link:

```
https://oshal.agenticfederal.us/api/pumpkin/remote?room=front-porch
```

Same login. The room will already be selected — `?room=` carries the canonical slug and the picker
matches on it. If no projector is registered yet, the remote says so and keeps the mic and Send
disabled rather than quietly pairing a phantom room.

### 5. Prove the loop before you walk away

In the cockpit, type a line and press **Say it**. The status must read **"Spoken on 1 screen(s)."**

If it says *"no projector is listening on …"*, the two ends are not in the same room. The status
line now names the rooms that **are** live, e.g. `Live projector rooms right now: "Front Porch"
(front-porch).` — compare that to what you typed. The phone remote's picker shows the same thing,
with `●` for live and `○` for registered-but-quiet.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Phone opens with a blank room picker | Nothing is registered yet, or the projector page is not open | Open the projector link on the projector device; the picker fills in within 15s |
| "no projector is listening on …" | The projector's room and the remote's room differ | Read the live-room list in the status line and match it exactly, or re-press Launch |
| "Signed out" on the projector | 24-hour absolute session cap was reached | Reload `/pumpkin/` on the projector device and sign in again |
| Launch does nothing | The browser blocked the pop-up | Allow pop-ups for the cockpit host, or copy the Projector link manually |
| QR box is empty / "QR code unavailable" | `/api/pumpkin/qr` needs the same login, and its encoder must resolve | Make sure you're signed in on the device viewing the cockpit; check the api log for `qr_unavailable` |
| Link status warns about localhost | `/api/pumpkin/links` was unreachable, so the surface fell back to this browser's address | Fix the api reachability — do **not** carry that link to a phone |
| Two people cannot drive one projector | Rooms are keyed `${sub}|${room}` — they are per-account by design | Use one account for the prop |

### Not built yet

Zero-typing projector pairing (the existing `/api/tv/pair/*` 30-day device-token rail) is the
intended follow-on and is **not** wired to pumpkin. The token comes back over `/pair/poll` and has
to be written into a cookie by page JS, and the only page that could do that is itself auth-gated —
that is a core change with its own threat model, not a shortcut.

## Driving it from the swarm

A bot, a ticket, Jarvis or a headless CLI can make the prop speak through
`POST /api/pumpkin/speak` — a **service-secret-only** door. An OIDC session is not sufficient and
never will be:

```bash
curl -sS -X POST https://oshal.agenticfederal.us/api/pumpkin/speak \
  -H "Content-Type: application/json" \
  -H "X-Service-Secret: $SWARM_SERVICE_SECRET" \
  -H "X-OSHAL-User-Sub: $OSHAL_USER_SUB" \
  -d '{"text":"Happy Halloween!","mode":"say","expression":"laugh","intensity":0.9}'
```

`mode:"say"` speaks the text verbatim (no LLM); `mode:"ask"` runs it through pumpkin-bot and speaks
the reply. Omit `room` and the server resolves your single live room; pass `room:"*"` to fan out to
all of them. It **fails loud** rather than pretending — `409 no_live_pumpkin`, `409 ambiguous_room`,
`409 projector_not_listening` — and only writes to the saved-lines playlist on a 200.

The browser doors (`/rooms/say`, `/rooms/ask`, `/rooms/replay`, `/rooms/preset`, `/rooms/mode`)
**keep the pairing token, permanently**. That token is why holding an OIDC session for an account is
not enough to seize that account's screens — only the browser that registered the screen can drive
it. `/speak` is a strictly higher trust tier, not a loosening of that one.

Two manifest-declared tools sit in front of it: `pumpkin-speak` (write) and `pumpkin-rooms` (read),
both held by pumpkin-bot. They are reachable from **that bot's own tool call** and from any
service-secret holder (a ticket, the headless CLI, a script).

**Jarvis routing is not on**, and the README used to say it was. pumpkin-bot's `accessRoles` in the
core registry is `['operator','swarm']` — no `'jarvis'` — and ADR-085 D3 access is
most-restrictive-wins across every matching definition, so a package manifest can only *narrow* it.
That is why this package deliberately declares no `accessRoles` at all: the core registry entry is
the single authority. Turning Jarvis delegation on is an operator decision that adds `'jarvis'` to
both `swarm-bot-registry.ts` and `swarm-bot-registry-local.ts`; the manifest's `jarvisMode: delegate`
and `selectorDescriptor` are already in place for that day and need no change.

### Allowlists, and who they actually constrain

`PUMPKIN_ALLOWED_SUBS` / `PUMPKIN_ALLOWED_EMAILS` scope the **owner** — whose prop may be driven.
On the browser doors the actor and the owner are the same identity, so that reads the way you would
expect. On `/speak` they are **not** the same: the owner comes from the trusted `X-OSHAL-User-Sub`
header, so the allowlist alone would not stop one service-secret holder driving an allowlisted
owner's screens.

So the swarm door has a second, separate gate. **When either allowlist is configured, `/speak` also
requires `PUMPKIN_ALLOW_SWARM_SPEAK=true`** (a refusal reads `403 swarm_speak_not_enabled`) —
outward-acting automation is opt-in. With no allowlist configured nothing changes and the door is
exactly as open as it was.

One more: a service call has **no resolvable email**, so configuring `PUMPKIN_ALLOWED_EMAILS`
*alone* blocks the swarm entirely. Use `PUMPKIN_ALLOWED_SUBS` (or both) if you want the allowlist on
while the swarm can still drive the prop.

## Install

```bash
node scripts/oshal-app.js install pumpkin
```
