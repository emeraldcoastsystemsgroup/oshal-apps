# ADR0047: Host commands over SSH with the person's own key

Status: implemented and accepted live, 23 October 2026, on kernel ADR-195 (oshal-kernel PR 84).
On the owned lab, a disposable test host was selected by literal address with its key pinned.
The live analyst coached `df -h` as read-only, and it ran once with the person's own key, exit 0,
recorded as `ssh-connection` (`deploy/evidence/ssh-host-command.json`). Guarded.
Roger approved it in session ("yes build ssh"), as a command rail, not a tunnel.

Hosts that are not pods (virtual machines and bare-metal servers) could only be coached. The
person ran the command in their own terminal and pasted the result back.

## Decision

The command helper gains the tool "On a host (your SSH key)".

1. The person loads the administrator's selected hosts. That is a confirmed read of
   `ssh-list-hosts`, and each host shows its name, address and pinned host key.
2. The analyst coaches the command. For `ssh` the argv is the command to run on the host itself,
   never an `ssh` invocation.
3. "Run on the host" sends one `ssh-exec`, with a fresh confirmation, through the person's own
   SSH connection: their username and an ed25519 key.

The kernel accepts the run only when:

- the host is one the administrator selected;
- its host key matches the pin;
- the argv is reviewed and bounded.

Each argument is quoted so the remote shell sees it as one word. The run has a 30 s deadline and
64 KiB of output. The record says `ssh-connection`, with the host and the account, and its own
provenance.

## Not claimed

- Interactive shells, file copy and tunnels.
- Host discovery; hosts are selected by the administrator.
- Response-plan execution on hosts. Remediation scripts still run only through the pod exec rail,
  and host remediation would reuse this rail with the same approval binding.
