# ADR0043: Swarm hand-off between installations

Status: implemented in source, 22 October 2026. The kernel side is ADR-194 (peer tokens and a
delegation inbox, kernel PR 81), installed on the owned lab and accepted there for the inbound
path. The outbound path is guarded with fixtures: the lab has no second public installation to
send to. Extends ADR0030, ADR0037 and ADR0040.

Roger asked for swarm-to-swarm communication when another swarm owns the lower-level monitoring.
Swarm hand-off is a new page.

**Send.** The person picks a saved response plan, their peer connection and a short request.
The server builds one closed envelope from the plan and reserves it per plan and peer account.
The envelope holds the ticket, the alert, the target, the answer digest, the plan's files with
their SHA-256 digests (content too, when under 40 KiB) and `executionAuthorized: false`. The
browser relays it once through the `oshal-peer` connector, with a fresh confirmation, using the
peer token the other installation issued. The peer's receipt is recorded as operator-reported.
A plan already delivered to that peer is not sent again.

**Receive.** The person's kernel inbox lists what peers delivered. Inspect shows the envelope as
data. "File as investigation" files it once as a canonical Intelligent Operations ticket and
starts it through the package ticket port. The envelope is the evidence packet, and the prompt
treats every field in it as untrusted. An uncertain create is held, and a refused or uncertain
start is labelled as on the processing tick (ADR0041). Nothing a peer sends can run anything.

**Peer tokens.** The page issues (with confirmation, shown once), lists and revokes the tokens
the person gives other swarms.

## Not claimed

- Live delivery between two deployed installations. The full round trip is proven between two
  native kernels over TLS in `two_installations_hand_off_one_confirmed_delegation_over_tls`
  (oshal-kernel PR 83). A deployed pair needs the receiver on a public HTTPS origin, because the
  connector rail reaches only public endpoints.
- The public agent card and acknowledgement back to the sender (ADR-194, deferred).
- Routing through Jarvis by name. The hand-off is the person's explicit action on this page.
