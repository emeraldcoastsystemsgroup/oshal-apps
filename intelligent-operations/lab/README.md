# Operations local Kubernetes lab

This is a separate disposable Kubernetes cluster for generating realistic synthetic operations data.
It does not use or change the existing GitOps cluster, OSHAL services, monitoring containers or default kubeconfig.
It produces local alerts and evidence; OSHAL event ingestion and automatic discovery are later application milestones.

## What runs

The `operations-lab` kind cluster has one control plane and two workers. Node images and workload
images are pinned by digest in `versions.json`; local kind and matching kubectl binaries are pinned
by checksum for Linux ARM64 and AMD64. Tools, private kubeconfig, ownership receipt and captures live
under `~/.local/state/oshal-operations-lab`, outside Git.

| Component | Purpose |
|---|---|
| Frontend and two API replicas | Actual HTTP dependency calls, readiness/liveness, structured synthetic logs and Prometheus request counters. |
| Prometheus | Five-second discovery/scraping and evaluation of request errors, unavailable deployments and container restarts. |
| Alertmanager | Grouped firing/resolved webhook deliveries to the local recorder, including repeat notifications. |
| kube-state-metrics | Pod UID, placement/readiness, deployment availability and restart observations. |
| OpenTelemetry collector | Receives real sampled synthetic request spans over OTLP/HTTP and supports OTLP logs; debug export to bounded container logs. No long-term trace backend yet. |
| Event recorder | At most 1000 local Alertmanager envelopes, bounded to 16 MiB payload content in ephemeral SQLite. Captures export receipts before pod removal. |

Each kind node has a 2-CPU/3-GiB Docker limit; namespace quotas and individual workload limits apply.
This is a separate Kubernetes authority/context on the shared host, not a claim of hardened network isolation.
No public ingress or cloud credentials are configured. Port forwarding binds to loopback only.

## Create or inspect

From the store root, with Docker available:

```bash
python3 intelligent-operations/lab/lab.py setup
python3 intelligent-operations/lab/lab.py status
```

Setup installs verified tools in private lab state, creates its own cluster, applies digest-pinned
manifests and waits for deployments. It refuses to adopt an existing same-name cluster without
the ownership receipt. A remote Docker endpoint is refused. Mutations require the same `kube-system` namespace UID, exact three kind
node names and a loopback API. No command selects or writes your default kubeconfig.

`python3 intelligent-operations/lab/lab.py render` prints the complete Kubernetes List as JSON without
contacting Docker or Kubernetes. Configuration changes require rerunning setup; changing the
workload ConfigMap code also requires explicitly restarting the lab deployments to load that code.

## Generate bounded noise

```bash
python3 intelligent-operations/lab/lab.py scenario errors
python3 intelligent-operations/lab/lab.py load --requests 600 --rate 10
python3 intelligent-operations/lab/lab.py capture
python3 intelligent-operations/lab/lab.py recover
```

The `errors` scenario makes API requests fail, causing frontend dependency failures. Prometheus
then observes rates, Alertmanager groups/repeats notifications, and the recorder keeps the actual
envelopes. Rule evaluation is every five seconds; the request-error alert requires ten seconds
above threshold. Recovery uses the metric's rolling window, so an error alert can remain active
briefly after requests succeed. Observed clearing is verified separately from restoring configuration.

Additional modes are `unready` (alive but failing readiness), `crash` (intentional exit), and
`healthy`. These mutate only the lab API deployment. `scale 1` through `scale 4` changes replica
count, allowing inventory tests to observe new/retired instance UIDs. A workload can be healthy
while monitoring or evidence coverage is incomplete; inspect each component's actual state.

Load defaults to 400 requests at 10/s. It is capped at 2000 requests, 20/s and 110 nominal seconds;
the Job has a hard 120-second active deadline, no retry, a 100m CPU/64Mi memory limit and TTL cleanup.
Timeouts can reduce completed requests. Starting a Job is not proof that it completed its request count.
Recovery cancels remaining owned load jobs and restores two healthy API replicas.

## Real local acceptance and data

```bash
python3 intelligent-operations/lab/pressure_verify.py
```

This explicitly exercises the local cluster: successful dependency request, bounded failure traffic,
Prometheus firing, Alertmanager recording, evidence capture, actual HTTP recovery, alert clearing,
scale-out UID change and cleanup. It writes an acceptance receipt even on failure and attempts
healthy cleanup in `finally`. It does not run as part of the general store gate or against production.

`capture` saves pod/deployment/service/event snapshots, bounded current logs and actual recorded
Alertmanager envelopes. It records failures as partial evidence rather than inventing missing content.
Capture folders and hashes are under private lab state; kubeconfig and secrets are never exported.
The committed sample dataset identifies its source as this synthetic local lab and preserves actual
timestamps and resource IDs. It is not evidence of an OSHAL incident, live cloud integration or recovery automation.

## Inspect locally

Run one foreground port forward per terminal, choosing unused ports:

```bash
python3 intelligent-operations/lab/lab.py forward frontend --port 38080
python3 intelligent-operations/lab/lab.py forward prometheus --port 39090
python3 intelligent-operations/lab/lab.py forward alertmanager --port 39093
python3 intelligent-operations/lab/lab.py forward event-recorder --port 38082
```

Open `http://127.0.0.1:39090` for Prometheus or `http://127.0.0.1:38082/alerts` for the local
recorded envelopes. Stop the foreground process to close its port forward.

## Clean up

`recover` restores the baseline while keeping the cluster. To remove only this owned cluster:

```bash
python3 intelligent-operations/lab/lab.py destroy
```

Captured data and pinned tools remain in private lab state after deletion. Runtime cluster
storage is ephemeral; capture before teardown if the test needs its evidence.

## Measured node CPU pressure and isolated investigation

`python3 intelligent-operations/lab/pressure.py prepare` installs an additional Prometheus
rule and a namespace read-only collector identity in the owned lab. `start --episode <16 hex>`
runs a credential-free Python CPU workload on `operations-lab-worker2`: one CPU, 64 MiB,
150 seconds of work and a 180-second Kubernetes deadline. `LabNodeCpuPressure` measures
process CPU consumption above 0.45 cores for ten seconds; it does not assert Kubernetes
MemoryPressure, DiskPressure, whole-node saturation or production service impact.

`collect.py <episode>` waits for an actual Alertmanager webhook, verifies the exact pod UID
and Job, and writes a closed preprocessed packet plus reviewable scripts under the private
lab state directory. Its short-lived collector token can only get/list pods in operations-demo.
Live checks refuse Secrets, pod exec, deployment changes and reads of the portal namespace.
Raw environment values, annotations, credentials and arbitrary logs are excluded from the packet.

`dispatch.py <episode>` creates an original-owner native Operations ticket and dispatches
only the packet and script proposals as digest-bound worker files. It records an uncertain
create before the API write; it will not blindly create another ticket after a lost response.
A known created ticket can resume a refused start. The native sandboxed worker is separately
enrolled and bound only to the Operations specialist/reviewer. A Studio human acceptance gate
reviews the proposal; it is not an infrastructure execution authorization.

The scripts are files to review. They are never executed by the investigation agent. A user
running stop-pressure.sh must supply the exact lab kubeconfig and exact Job approval value.
Require a matching resolved Alertmanager delivery and healthy nodes before reporting recovery.
The general durable intake, correlation and anomaly engines are separate delivery milestones;
these commands alone do not establish full pipeline parity.


Verify a completed run without approving it or executing its proposed scripts:

```bash
python3 intelligent-operations/lab/pressure_verify.py ~/.local/state/oshal-operations-lab/event-to-action/<episode>/<attempt-directory>
```

This requires three completed canonical worker results, the human report gate, matching firing and
resolved deliveries, absent pressure Job, healthy nodes and actual collector denials. It explicitly
reports `automaticPipeline: false`. Worker configuration must select a real boot-time inference
provider: the current protected worker does not resolve the portal's dynamic fleet settings. The
local demonstration uses `OSHAL_INFERENCE_API=codex-account` and
`OSHAL_INFERENCE_MODEL=gpt-6.1-sol`; account credentials remain in the kernel's private runtime.

The installed portal uses port 38081; use a different port for recorder inspection. Package
upgrades can intentionally withhold results bound to the previous source revision. The verifier
requires three nonempty current-source answers and refuses withheld results. Preserve the old
receipt and create an explicitly recorded verification attempt if the installed source changed;
do not replace historical outputs or treat repeated manual verification tickets as pipeline deduplication.

## Approved response and verified recovery drill

```bash
python3 intelligent-operations/lab/pressure.py prepare
python3 intelligent-operations/lab/pressure.py start --episode <16 hex>
python3 intelligent-operations/lab/collect.py <episode>
python3 intelligent-operations/lab/dispatch.py <episode>
# wait for the canonical ticket to reach awaiting_approval (three real model phases)
python3 ~/Documents/projects/oshal-kernel/deploy/k8s/install.py pod-connect --pod-namespace operations-demo --password-file ~/.local/state/oshal-k8s/admin-password.json
python3 intelligent-operations/lab/response.py <episode>
```

The pressure pod now mounts a writable `/run/pressure`; creating `/run/pressure/stop` inside the
container ends the loop, and the counter stays flat for a grace period so recovery can be measured.
The drill runs for 900 seconds by default (Job deadline 1140 s) so the workflow and a reviewed
response can complete while the pod exists. `response.py` imports a namespace scan, builds the plan
from the accepted answer's generated files, downloads and digest-checks them, approves the exact
plan, reserves and runs one confirmed `kubernetes-exec` through the operator's own connection,
imports the resolved Alertmanager delivery, verifies recovery and approves the canonical report
gate only on a healthy outcome. Receipts are written privately under the episode directory; a
redacted copy is committed as `deploy/evidence/response.json`. `publish.py <commit>` installs an
exact pushed public revision through the registry trust, preview and consent flow.

