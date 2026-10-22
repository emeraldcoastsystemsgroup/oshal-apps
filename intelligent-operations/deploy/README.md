# Operations Kubernetes experience

This package deploys into the owned `operations-lab` kind cluster as namespace
`operations-experience`. It runs the existing native OSHAL kernel, PostgreSQL, persistent
volumes and the committed Operations application. It uses native sign-in, named application
roles and person-scoped records. It does not import home accounts, credentials or records.

```sh
python3 intelligent-operations/deploy/kubernetes.py deploy
python3 intelligent-operations/deploy/kubernetes.py forward --port 38079
```

Open `http://127.0.0.1:38079/login`, sign in with a locally enrolled OSHAL account, then open
`/api/ui/experiences/intelligent-operations/open`. `reader` opens and reads the experience;
`operator` additionally registers source revisions, records alerts and saves inventory captures.
An installation administrator must assign those native roles; a client role selector is never authority.

The deployment tool verifies the existing cluster ownership receipt and exact kernel image identity,
refuses uncommitted Operations changes, builds from `git archive HEAD`, loads the image into kind,
and applies only this namespace. Image identity and source revision are written to the private lab
state directory. The persistent volumes use the lab's `standard` StorageClass and one writer with
Recreate updates. This is a local development deployment; the image is not registry-published.
The native process sandbox requires user namespaces, its reviewed seccomp policy and the existing
host `oshal-bwrap` AppArmor profile. The tool makes securityfs and a separate read-only sysfs mount visible inside each owned kind node, installs the genuine host AppArmor parser by digest and restarts its runtime when needed. This addresses [kind’s nested user-namespace mount issue](https://github.com/kubernetes-sigs/kind/issues/3436) while preserving pod security settings. There is no unsandboxed fallback. The Service is internal;
port forwarding binds only loopback. The global Kubernetes context is unchanged.

Private credentials are created for this new isolated installation only and kept at
`~/.local/state/oshal-operations-lab/experience/credentials.json` with mode 0600. They are supplied
as Kubernetes Secrets, never committed or printed. Keep this file across redeployments. Removing
PVCs destroys this installation's records; the deployment command does not delete them.

To capture current lab pods and containers:

```sh
python3 intelligent-operations/deploy/kubernetes.py capture > /tmp/operations-capture.json
```

Paste that JSON into Estate & topology → Import a Kubernetes capture, then Save capture.
The UI distinguishes readiness at observation time from current monitoring. Each capture has an
explicit cluster UID and timestamp. A partial capture never proves an absent pod was deleted.

Named source definitions and mappings are immutable content-addressed revisions. Alert records
retain original payload, normalized identity, validation decision and source revision. Reposting
an identical payload under the same source revision reuses its record. This is delivery identity
handling, not the established noise-reduction algorithm or a dispatch reservation. No automated
tickets, provider synchronization, infrastructure mutation or inference is activated. The configured
inference provider is noop; this deployment must not be presented as a successful RCA model run.

`render` prints non-secret Kubernetes configuration without contacting a cluster. `status` reads
only the guarded deployment. Installed acceptance and its evidence are recorded separately from
source checks in the project implementation status.

## Installed acceptance

Run the following against this owned lab with the loopback forward running. The first command
enrolls disposable native people and changes only their test role assignments. It uses the real login
page and experience launcher. The second creates bounded synthetic service errors and restores the
healthy baseline. The final command imports hash-verified actual firing/resolved observations and
fault/recovery inventory into the signed-in test operator's records.

```sh
node intelligent-operations/deploy/acceptance.cjs
python3 intelligent-operations/lab/verify.py
# Redeploy a committed application revision to exercise record persistence across pod replacement.
python3 intelligent-operations/deploy/kubernetes.py deploy
# Restart the loopback forward after replacing the pod, then:
node intelligent-operations/deploy/capture-acceptance.cjs
```

Receipts and screenshots are under `~/.local/state/oshal-operations-lab/experience/`.
`persistence-private.json` contains the isolated test operator's access token for native login;
keep it private. The acceptance harness leaves that operator admitted for inspection. Repeating the
initial harness creates a fresh test person. Saved records are person-scoped, so another account
will see its own empty state. Installed tests are explicit commands with lab side effects; they are
not disguised as source-only Test Lab checks.

The capture importer verifies recorded file hashes and exact pod UIDs. It preserves original alert
labels, source revision and capture receipt hash. This is authenticated manual capture acceptance;
the application does not yet run a continuous Alertmanager webhook or scanner. A firing/resolved
record does not automatically create or close an incident.

## Temporal graph acceptance

After installing the committed package and reviewing its native Operations role assignment, run
`python3 intelligent-operations/lab/topology_verify.py` from the store root. It captures only the
owned lab namespace, saves a source-owned scan, checks retry/conflict and unauthenticated refusal,
and records clearly labelled synthetic alerts referencing actual asset IDs. It checks saved
correlation evidence without consuming processing work, sending messages or executing remediation.
The owner-only local receipt is `~/.local/state/oshal-k8s/topology-acceptance.json`; its sanitized
committed counterpart is `deploy/evidence/topology.json`. A changed application authorization
contract requires native administrator re-approval; the verifier does not grant itself access.
