# Home Workspace

`workspace` is a code-free ADR-141 application group. Its six required members are
`home`, `social`, `career-hunter`, `storage`, `switchboard` and `video`. The Cockpit
opens the member-owned Smart Home dashboard first and borrows the other surfaces
by `{app, surface}` reference. A member remains responsible for its own API,
authority, chat and data. The group names Smart Home's existing `home-bot` as its
metadata-only concierge; it owns no bot, route, tool, migration or copied URL.

The group activates only when all six members are installed and active. If a
member is absent or a borrowed surface is renamed, activation fails with the
missing member/surface named; it does not silently shrink the composition.
The Setup tile offers the three readiness probes currently declared by Career
Hunter and Social, but those probes do not gate the six-app workspace.

To verify an installation, open `/cockpit/?app=workspace` while signed in. The
ribbon must show Smart Home, Switchboard, Social, Career Hunter, Storage and Video
Studio destinations. Switching among them stays inside the group and every
embedded action remains subject to its owning app's authorization checks.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
