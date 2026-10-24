# Operating TriageNorth

Updated 23 October 2026. The native portal is http://127.0.0.1:38081.
Use the existing portal login. Application/API identity stays intelligent-operations.

If a screen says "Sign in to open this screen", your session has ended (a kernel restart ends
every session). Choose Sign in on that page: after signing in you return to the screen you asked
for, or to the application inside the cockpit when it was refused there.

## Daily operator screens

Start in **Overview** for quarantined events, retry/attention states, source receipts and canonical incident work. **Systems** puts the captured resource tree beside its selected resource and current-user pod diagnostics. **Sources** provides search, exact revision/mapping details and source-specific links into the pipeline; registration and test import are separate controls.

**Data pipeline** separates Flow, Events, Rules, Automation and Correlation. Events has source and validation filters, search, explicit selection and a readable decision trail. Retry/conflict receipts and the original payload remain inspectable. Pipeline tabs support arrow keys; the same panels stack at phone widths. Counts refer to the returned page and captured health retains its observation time.

In **Automation**, explicitly enable retained-evidence capture and choose source revisions before activating the existing personal schedule. A matching capture rule can then preserve already retained, resource-scoped context in an immutable packet. This does not collect new infrastructure data, start an AI investigation or execute remediation. The native scheduled acceptance used five synthetic occurrences: four matches became one admitted symptom, three suppressed duplicates and one automatically captured packet; the fifth event did not match. After acceptance, processing and capture are disabled, the temporary source scope is cleared and the schedule is inactive.

See [the daily operator guide](OPERATOR-WORKSPACE.md) for the screen-by-screen journey. Systems retains readable cluster names while filtering and uses compact desktop filters. For expiring Kubernetes connections, follow [the pod console renewal steps](POD-CONSOLE.md#expiring-connections); saved observations alone do not establish current access.

## Adjust percolation queries

Open **Data pipeline → Rules**. Choose the
named source revision, then edit its policy name, rules, enable/capture choices and
fixed/sliding suppression window. Add AND conditions with the field/value controls;
use each rule's stored-query JSON for nested bool, match, terms or explicit time ranges.
Example: require `status=firing`, add `severity` is one of `["error","critical"]`,
and request context for the matching rule. Unsupported query operators are refused
by the real detection backend rather than silently treated as no match.

In **Events**, select 1–20 recorded alerts from that same source, then open **Rules → Test selected events**. The result shows which rules matched each actual delivery. Testing
saves an immutable candidate; it changes neither the active source binding nor incident
counts or capture reservations. **Publish and activate** is the separate live change.
Earlier decisions remain visible with their original generation. Saved generations
can be loaded as drafts for a reviewed rollback; stale source revisions are refused.

## Understand the two filtering layers

Prometheus uses **PromQL** to turn numeric observations into source alerts. The current
lab defaults scrape and evaluate every five seconds. `LabApplicationErrors` measures
5xx request rates above 0.1 requests/second for ten seconds; readiness and restart rules
observe actual Kubernetes state. The named source's **OpenSearch percolation queries**
then decide which admitted alerts proceed to reduction and evidence. These are separate
queries with separate version/provenance records.

Alertmanager groups by alertname/environment, waits five seconds for a group, has a
15-second group interval and one-minute repeat interval, and sends resolved deliveries.
Grouping does not replace source/type/native-resource symptom keys. The original lab
receiver is `http://event-recorder:8080/webhook`; continuous native source admission is
being connected separately. Do not interpret recorder-only deliveries as product tickets.
Maintained baseline configuration is in `lab/lab.py`; the live Kubernetes ConfigMaps
are the authoritative installed configuration. `lab/verify.py` exercises live HTTP
failure → firing → webhook → recovery → clearing → distinct scaled pod UID.

## Recorded datasets

The verified optional cache is `~/.cache/triagenorth/datasets`. `lab/datasets.json`
pins commits, hashes, file sizes and upstream notices. Prepare/verify it with
`python3 intelligent-operations/lab/prepare_datasets.py`. It contains 2,000 sampled
raw lines each from BGL, OpenStack, Linux and HDFS, plus their selected parsing inputs
and NAB EC2 latency/Auto Scaling CPU series and normal controls. Loghub research notices
are retained and these inputs are separate from the redistributed application bundle.

`node intelligent-operations/lab/evaluate_recorded.cjs` runs the existing opt-in BGL
severity baseline against explicitly disposable PostgreSQL/OpenSearch fixtures. Its
measured receipt is `deploy/evidence/recorded-bgl.json`: 35.48% precision and 260 false
positives, with labels excluded from query inputs. The native synthetic datacenter
replay is a separate regression demonstration. Neither is a calibrated anomaly engine.

## Live fault work

The owned cluster has one control plane and two workers. The 21 October supervised
baseline run proves actual application errors, Prometheus firing, Alertmanager delivery,
HTTP recovery, alert clearing and a new scaled pod UID. It restores two healthy API
replicas and removes the load Jobs. Third-party software patch/configuration/crash
scenarios and the connected automatic investigation/approved-recovery path remain
active implementation work; this guide will record their actual commands and receipts
as those paths pass, rather than marking them complete from the baseline alone.

## 3D graph presets

Open **Topology**. Load a graph at the desired ISO timestamp and optional collection, select a focus asset and choose a predefined query. **Dependencies of focus** follows outgoing dependency/routing edges; **Impact on dependents** follows the reverse direction. These paths show potential impact, not proven causation. **Placement of focus** follows recorded placement/ownership. **Observed degraded assets** excludes unknown health. **Observations older than 15 minutes** compares capture time with the selected snapshot time.

Drag to orbit, Shift-drag to pan, use wheel or buttons to zoom, or use arrow keys on the canvas. The selectable node list offers the same asset inspection with a keyboard. The Display selector retains the 2D view. Counts disclose 100-node/500-edge display limits and a 500-identity traversal limit. Depth is a layout by source scope, not measured network distance. Refresh or access withdrawal clears the private view.

The rule workbench at source7ed15232 was installed through native trust/preview/consent and passed actual HTML sign-in, candidate1/3 matching, unchanged active binding/decisions/reservations during trial and explicit binding revision2 activation. See policy-workbench.json. This does not certify later workflow or external provider delivery.

## Investigation handoff and funnel

In **Data pipeline → Flow**, the existing cohort funnel shows unique evaluated events, rule matches, deduplication survivors and recorded correlation groups. Below it, **From evidence to an accepted report** links those same delivery IDs to pinned packets and canonical workflows. Expand **Evidence work** and click **Start AI investigation** on a capture reservation. The application pins a bounded preprocessed packet; the native workflow receives only that fixed file and its digest. It cannot inspect raw telemetry or the cluster. Refresh workflow progress to read actual completed native outputs and inference receipts. Open the canonical ticket for its workflow, shared workspace and report approval.

### Ticket files and local downloads

From **Incident work**, open the canonical ticket, then choose **Work Artifacts**. The core ticket workspace presents completed workflow outputs in an expandable folder tree, with search by file, folder, bot or phase, refresh, original producing-work provenance, individual Download links and **Save to My files**. The browser saves each Download to the operator's configured Downloads folder or asks for a location according to its own settings. Save to My files explicitly copies an accepted artifact of at most 10 MiB into the signed-in person's core Files; open **My files** to see that copy under Saved ticket files. Merely opening My files does not copy ticket files. Intelligent Operations declares that core Files screen in its application navigation, while the ticket's Work Artifacts tab is available on the canonical ticket without a second application file store.

The installed ticket `ad8d1238-50e5-4f14-8b6f-559b8a16581f` returned three native workflow `answer.md` files for investigate, review and revise, and the signed-in browser displayed all three as authenticated downloads. Each authenticated download matched the accepted byte length and SHA-256 ([ticket-workspace-live.json](../../deploy/evidence/ticket-workspace-live.json)). On installed kernel `d8ac0437`, a signed-in API readback saved a completed 7,425-byte `answer.md` to personal Files, found one listed copy, downloaded identical bytes and confirmed that repeating Save did not duplicate it ([ticket-personal-files-live.json](../../deploy/evidence/ticket-personal-files-live.json)). The core explorer now also projects explicit `file=NAME` fenced sections from an accepted `answer.md` as `generated/` entries under the same producing work. Open each entry to see its source answer digest, download it to a local folder, or select **Save to My files**. On installed kernel `0fae6bc7`, authenticated readback of one ticket verified byte-exact `remediate.sh`, `verify.sh`, `rollback.md` and `verify.md` downloads against the accepted answer, then verified a personal Files copy of `remediate.sh` ([named-file receipt](../../deploy/evidence/ticket-named-artifacts-live.json)). The response planner separately retains its approved-plan copies for review and execution; the ticket tree is a read/download surface and grants no execution authority. Core ADR193 defines the explorer boundary; `deploy/evidence/incident-trace-exact-live.json` records the incident trace.

On installed kernel `e94e2851` and application `f7253060`, a fresh alert's ticket `afd22d06` exposed 13 accepted files in that core explorer. Its five generated response files matched the server-verified plan's authenticated downloads byte for byte ([accepted-work receipt](../../deploy/evidence/accepted-work-live.json)). The test did not approve or execute the plan; the bounded pressure Job was removed afterward.

For a bounded automatic-correlation rehearsal on the owned local Kubernetes lab, run `python3 intelligent-operations/lab/correlation_ticket_live.py` from the repository root. It enables correlation for the existing personal processing schedule, starts one capped CPU-pressure Job, waits for its actual Alertmanager delivery, exact ticket and cohort link, and deletes the Job even when the drill fails. It does not approve a ticket, execute remediation or contact an external provider. Its receipt is `intelligent-operations/deploy/evidence/incident-correlation-live.json`; the observed cohort was degraded and used exact-asset fallback, so it does not establish complete dependency coverage.

Retrying an already linked reservation resumes its existing ticket. An uncertain creation remains held and says to reconcile the canonical board; it never silently creates a second ticket. Done means report accepted. Verified infrastructure recovery stays **Not connected** until a fresh check is implemented. The workflow currently produces its accepted answer.md report; this handoff does not certify generated executable remediation bundles.

SMS service support is now committed in the separate kernel at92da94c, with actual loopback-TLS, native permission and installer checks. Full kernel gate and installation are still pending. Environment key presence was inspected without printing values; no live SMS/call/Telegram transmission was performed. Calling Assistant already has a separate guarded carrier path. Jira/GitLab status-transition catalog gaps and durable synchronization remain under active build.

Native acceptance now confirms the3D presets and real workflow handoff at24d62980. The accepted first-phase report is available in ticket ca7fc196-8a0b-4055-809d-7b957cde68f9 and its shared workspace. deploy/evidence/operating-experience.json records the exact source, artifact, input/report hashes and inference receipt. The underlying evidence is explicitly synthetic; model execution and shared-workspace output are genuine.

The fitted perspective view at source a8697163 is installed and rechecked with
`node intelligent-operations/deploy/operating-acceptance.cjs --graph-only`. This
uses the original graph's exact observation timestamp, avoiding a false stale
result as wall time advances, and dispatches no new inference.

`--workflow-only` reads the existing acceptance ticket and downloads its actual
shared-PVC outputs. All three investigate/review/revise phases now have completed
answers and inference receipts; all three downloaded artifact sizes and SHA-256
hashes match workspace metadata. The ticket remains awaiting human report
approval. See deploy/evidence/workflow-artifacts.json and graph-experience.json.
This verification does not generate another ticket or approve the report.

## Check connections and messaging standing

Open **Connections & tools → Refresh my connections**. Personal account liveness,
selected HTTP services and your invocation scope appear separately. An older kernel
without service metadata explicitly requests the connector rollout. Registered SMS,
Telegram and email transports are compared with your enabled topic routes without
showing destinations. A registered transport is not a successful delivery test.
This screen makes no sends or provider actions and clears private content after
refusal. Brief phone alerts require the explicitly enabled shared voice transport;
interactive Calling Assistant retains its separate account/approval path.

For a specifically authorized local acceptance test, the operator-side
`lab/communications.py` uses the installed portal's standard notification API.
Select the existing literal destination file and owned workflow ticket, then pass
`--authorized-once` only for the approved one-SMS, one-brief-call, one-Telegram test.
It preflights the selected transports before sending, saves and fsyncs a private
reservation before each possible send, and mutes its own test topics afterward.
Reopening the runner never resends an attempted channel, including a lost response.
Never delete or reset its private ledger to force a retry. Inspect an uncertain
outcome before requesting any additional test. Carrier acceptance does not prove
handset delivery, answered speech or human receipt. The fixture tests send nothing.
An explicit `--channel telegram` can finish that approved channel while another
transport rolls out; the same ledger prevents a later all-channel run repeating it.

The local development installation now registers SMS, short phone alerts and
Telegram. The authorized tests each have exactly one attempt and all test topics
are muted. SMS and phone returned explicit carrier acceptance; Telegram returned
success on the older portal contract and its initial response-version mismatch was
reconciled without a resend. The operator confirmed the phone call. A read-only provider lookup confirms the SMS was undelivered with Twilio error30034 (unregistered US A2P sender); Telegram human receipt remains unverified. See
`deploy/evidence/communications-acceptance.json`. General automatic incident
notifications are not enabled by this one-time test approval.

## Link a workflow step to an external ticket

In **Connections & tools → External ticket handoff**, refresh workflow links.
Configure an immutable link to your existing Jira issue, GitLab issue or ServiceNow
incident. Choose the canonical status and phase, then explicitly map the remote
transition/state. **Load available Jira transitions** reads the issue's actual
transition IDs and destination states. No default transition numbers are supplied.
GitLab uses numeric project ID/issue IID and close/reopen; ServiceNow needs the
instance state value and expected displayed value. **Save link only** sends nothing.

**Review mapped update** shows the exact proposed operation and workflow revision.
**Confirm and push status** checks the service realm/account, reserves the snapshot,
checks the canonical revision and uses the shared confirmed connector action. It
reads remote state first; an already matching state needs no update. After a write,
the server re-reads that same issue through your personal connection and the saved
service revision. The durable entry records the state the server observed; it does
not prove that this particular write was delivered. It never changes canonical ticket status
or proves infrastructure recovery. A lost response holds the attempt. Use **Read
remote state** to ask the server to observe again; it sends no transition and never
blindly repeats a write. A withdrawn connection or changed service target refuses
the read without replacing the last observation.

Requires the selected HTTP services in core ADR187. This manual workbench does not
activate unattended two-way synchronization, webhook handling or external ticket
creation. Splunk On-Call and GitHub handoff remain separate provider work.

The [installed lab receipt](../../deploy/evidence/server-readback-admission-live.json) proves route admission and current ticket-file downloads. That account had no linked external issue, so it does not prove a live provider readback or delivery of an external write.

### Optional Splunk context for new incidents

An administrator selects the Splunk HTTPS API endpoint for the native connector. The signed-in operator connects a personal Splunk bearer account in portal Connections, then opens Operations → Connections → Optional Splunk evidence. Choose that account and an allowed index, check the named alert source revisions, and enable the mapping. The next captured alert from those revisions receives one fixed, time-bounded export read before investigation preparation. Incident work → Trace shows the external result status; `evidence/external.json` in new workflow input carries the exact source, time coverage and digest. Refused, unavailable, empty and unsupported searches remain visible while the captured packet and ticket proceed. This setting does not change existing tickets or grant ticket synchronization. Splunk On-Call incident writes are a separate integration.

The selected Jira site and original-person primary account are configured in the
development installation. Its read-only profile probe returns HTTP 404, so account
access/site validation remains open. No external issue has been changed. The native
UI/schema and isolated confirmed-push tests do not prove live Jira synchronization.
The development kernel is source `ac5f00e`; full clean-commit certification remains
open, including the large artifact stream expiry found in the wider gate.

## Inspect the evidence behind a bot decision

After the ADR190 kernel update, open the canonical ticket's Process or Workflow tab.
The graph marks the current phase and approval gate. Each phase names its bot and
shows its admitted input digest, task text and individual file hashes/content.
The file lineage counts added or changed inputs, including forwarded phase reports.
Open **Data presented to this bot** to inspect the actual submitted packet. Text
omitted by the bounded projection is explicitly labelled; no raw cluster authority
is exposed. **Open this ticket in Workflow Studio** opens the same runtime graph
read-only and creates no draft. Use normal Studio authoring to edit a workflow.

Cost shows recorded usage and separately labelled reference estimates for calls
recorded at zero. The Kubernetes budget-reference assumption is$1 input/$3 output
per million tokens, configurable through the two cost-estimate ConfigMap settings.
These assumptions are not billed provider prices. Missing rates show Unpriced;
sub-cent estimates remain visible. Current-day filtering does not create tickets:
only admitted evidence reservations sent to the queue appear as investigations.

Create is the unified studio home; AI Office is its document/deck component.
For mailbox setup use `/utilities?category=email`. Portal email alerts separately
need an administrator SMTP relay or webhook transport. Connecting Outlook/Gmail
alone does not register that transport or send a test message.

## Approve and run a generated response, then verify recovery — 22 October

Open Incident work → Approved response and verified recovery. Refresh response plans, then
expand "Prepare a response plan from accepted work": choose a ticket at its report gate, the
completed phase with the accepted answer (the page previews which generated files it carries:
`remediate.sh`, `verify.sh`, `rollback.md`, `verify.md`), the observed target pod from your
inventory, its container and your Kubernetes account, and prepare the plan. Download and read
the files; their digests are shown. The server reads the selected answer directly from the
kernel accepted-work port and stores its receipt and digest; browser preview text is never a plan
input. Older plans without this verification remain visible for review but must be recreated
before approval, execution or Git promotion (ADR0055). Approve this exact action
(thirty-minute expiry, bound to the
digests, the target and the canonical revision). Execute approved action runs the script once
through your own Kubernetes connection with a fresh confirmation. Verify recovery runs
`verify.sh` and a pod readback; recovery is healthy only with a passing check, the same pod
identity and a resolved alert admitted after the action. Only then does Accept report and update
ticket approve the canonical gate. The execution receipt is downloadable. On the lab this closed
ticket 46b8df31 at revision 5 (`deploy/evidence/response.json`).

## Promote a response through Git, or reconcile a break-glass change

On a response plan, expand Promote through Git. Choose GitHub or GitLab, your own account, the
repository (owner and name, or the numeric GitLab project), the base branch, a folder in the
repository and, for GitHub, an optional workflow file; tick Start the pipeline to run it on the new
branch. Commit, open request commits the plan's exact files and a manifest to
`triagenorth-<plan>` and opens a pull or merge request; every provider write asks for a fresh
confirmation. Use this when the pipeline should apply the change. If you executed the plan as an
emergency change, Reconcile break-glass change in Git appears: it commits the same files with the
execution receipt to `triagenorth-reconcile-<plan>`, and the request must be merged or reverted in
Git within 24 hours; the panel marks it overdue after that. Refresh status reads merge and
pipeline state. The GitHub or GitLab service must be selected by an administrator and your account
connected first.

## Detect anomalies on your own telemetry

Open Live context → Anomaly detection. Choose the telemetry stream sources to score, the alert
source that should receive candidates (publish a percolation policy for it under Data pipeline →
Rules so candidates become decisions), the detector (rolling robust z-score, or the seasonal
time-of-day profile for daily patterns) and its parameters, then enable scoring. Each scheduled
tick scores new metric samples before learning from them; the panel shows per-resource readiness
(cold, ready, stale, late) with the last score and baseline, and Run detection now scores pending
samples immediately. Candidates appear in Events as `anomaly:<detector>:<metric>` and follow the
same filtering and noise reduction as source alerts. The NAB pilot receipt
(`deploy/evidence/anomaly-nab.json`) records measured detection, lead time and false-alert rates
for both detectors; it is not an official NAB score.

## Read what is in each cluster node

Open Systems and expand a Kubernetes system. Nodes are listed with the namespaces and workloads;
selecting a node shows Node facts: capacity against allocatable (CPU, memory, pods), pressure
conditions and cordon state, roles, taints, internal IP and hostname, kubelet, OS, container
runtime, architecture and kernel, and the pods placed on the node. Each pod is a link that opens
that pod in the tree, where the pod console offers current status, logs and reviewed commands
through your own connection. Facts come from the imported scan (`lab/topology.py --output` then
Topology → Import a source-owned scan); absent facts are omitted rather than fabricated.

## Read the live cluster and keep Systems current

In Systems, open Live cluster. Choose your own Kubernetes account and a namespace from its allowed
list, then Read live cluster: nodes (readiness, pressure, roles, allocatable CPU, memory and pods,
kubelet), deployments (ready against desired) and pods (readiness, phase, node, restarts, owner)
are read now, each read with its own confirmation. Save as inventory scan records the read in a
separate live collection, so the tree shows the current state while the collector's services and
routes stay. A read larger than one scan is saved as partial and says how much was kept.

## Let the pipeline start investigations

In Data pipeline → Processing, turn on evidence capture and "Start an AI investigation
automatically". Each processing tick then starts the shared investigation workflow for up to two
newly captured evidence packets, through the same port and checks as your own Start. The tick
result shows how many started. A start whose outcome is unknown is marked uncertain and is not
retried; open it in Incident work and start it by hand if no ticket moved.

## Get a command coached and run it under your own authorization

Open Command helper. Pick the tool (kubectl, AWS CLI, Google Cloud CLI, Azure CLI, or inside a
pod container), say where you will run it, describe the goal and any context, and ask the
operations analyst. It proposes one command as explicit arguments with its reason, whether it is
read-only, its risk and how to verify the result. For an in-pod command, choose the observed pod,
container and your Kubernetes account and run it through your own connection with a fresh
confirmation; the result is recorded. For kubectl and cloud CLIs, copy the command, run it in
your own terminal or OSHAL Node under your signed-in profile, paste the output and record it;
the record says it is operator-provided. The application never holds your cloud credentials and
never runs a cloud command itself; in-application cloud execution needs the kernel rails listed
in KERNEL-RAILS-NEEDED.md.

## Run AWS reads through your own AWS connection

An administrator selects the AWS STS and Amazon EKS services, with the regional endpoint to read
(for example `https://eks.us-east-1.amazonaws.com`). In Connections, connect your own AWS key to
each as JSON with `accessKeyId`, `secretAccessKey` and, for temporary credentials,
`sessionToken`. Prefer a read-only IAM user or a short-lived role session.

In Command helper, choose AWS CLI and ask, for example, "list my EKS clusters". When the analyst
proposes a supported read (`aws sts get-caller-identity`, `aws eks list-clusters`,
`describe-cluster`, `list-nodegroups`, `describe-nodegroup`), choose Run through your AWS
connection. A `--region` that differs from the selected endpoint is refused before any call.
The result is recorded as an AWS-signed read with your account and the region.

## Run a command on a host with your own SSH key

Your administrator selects the hosts in `OSHAL_SSH_SERVICE`, each with a literal address, a
port and the host key's pinned SHA-256 fingerprint. In Connections, save your own SSH connection
as JSON with your `username` and your OpenSSH ed25519 `privateKey`. In Command helper, choose
"On a host (your SSH key)", then Load selected hosts and pick one. Ask for what you need, for
example "how much disk is free". Review the proposed command, then choose Run on the host. It
runs once, as you; the result and the exit code are recorded with the host.

## Ask Jarvis about Operations

Ask Jarvis "what needs my attention in operations?", "what did we hand off to another swarm?" or
"which investigations started on their own?". It answers from your own saved records and names
the Operations page to open. Jarvis never sends, files, approves or starts anything; those stay
on the pages, with your confirmation.

## See every cloud cluster in one place

Open Systems and expand **Cloud clusters**. Choose your AWS, Google Cloud and Azure accounts (each
one you have connected in Connections), type the Google Cloud project ID, and optionally one Azure
subscription. Then choose **Read my cloud clusters**.

- The table lists each EKS, GKE and AKS cluster with its region, Kubernetes version, status, node
  count, and each node pool's machine type, size and autoscaling range.
- Choose **Save as inventory scans** to put them in Systems and Topology. The console then answers
  "which is the largest cluster" across clouds.
- For Azure the read also lists your virtual machines (size, OS) and virtual networks with their
  subnets, and saves them with the clusters.
- Reading never changes anything in your clouds. AWS reads the region your administrator's EKS
  service serves; the panel names it.

## Run Google Cloud and Azure reads through your own account

An administrator registers the Google Cloud and Azure OAuth clients and selects the Google
Cloud and Azure services. In Connections, connect your own Google account for Google Cloud and
your own Microsoft account for Azure. In Command helper, choose the Google Cloud CLI or the
Azure CLI and ask, for example, "list my GKE clusters in acme-prod" or "show the aks-ops
cluster". When the analyst proposes a supported read, choose Run through your Google Cloud
connection or Run through your Azure connection. Google Cloud reads need `--project`; Azure reads
other than `az account list` need `--subscription`.

## Connect GitHub for promotion and provisioning

On GitHub, create a fine-grained personal access token for the repository you will promote to.
Give it Contents, Pull requests and Actions, each read and write, and an expiry. Open any
"Promote through Git" panel. While you have no GitHub connection it offers "Your own access
token": paste the token and choose Save as my connection. The token goes straight to the kernel
vault as your own connection. The page clears it at once and keeps nothing.

## Browse repositories and link each cluster to its GitOps repository

Open Git explorer. The field "GitHub access token (save or replace)" is always there while the
GitHub service is set up. With no connection, paste your token and choose Save as my GitHub
connection; to change a token GitHub rejects or that has expired, paste the new one and choose
Replace my GitHub token. Either way the page checks the token with GitHub at once and says
"Connected to GitHub as <your login>", or names GitHub's refusal. Then choose Load my repositories. Every repository your token can reach is
listed, including your organisation's; filter by name. Open one to see its branches, open pull
requests, recent pipeline runs and files, and click a file to read it. To make a repository the
home of a cluster's manifests, pick the recorded cluster, set the folder (and a workflow if a
pipeline should run), and choose Link this repository to the cluster. Promotion panels then offer
the link, and a response plan for that cluster preselects it.

## Provision a namespace or an app through Git

Open Provisioning and choose a team namespace or an app deployment. Fill in the parameters,
say why, and choose Render manifests. Review the exact files, and if you like, check them with
the `kubectl apply --dry-run=server` command shown. Then use Promote through Git on the request:
your GitHub or GitLab account, the repository, the base branch and a folder. You get a branch,
a pull or merge request and, if chosen, a pipeline run. The application applies nothing; your
pipeline applies the request once it is merged.

## When Overview says the processing schedule is suspended

Re-approving your Operations role, which a release that changes the application's contract asks
for, suspends your processing schedule, because its activation belonged to the previous approval.
Re-activate it under the new approval. After publishing, `lab/reapprove.py` re-approves only when
needed and then re-activates.
Overview shows the state and the kernel's reason; Re-activate resumes it under your authority.
A release that needs no re-approval keeps the schedule running.

## Hand work to another swarm, or take work from one

Open Swarm hand-off.

- **Let another swarm send you work.** Issue a peer token for it, with its name and an expiry,
  and give it the token at once; it is not shown again. Its people save it as their OSHAL peer
  connection. Revoke the token to stop deliveries.
- **Send a response plan.** Your administrator selects the peer installation's HTTPS origin for
  the OSHAL peer installation service. Save the token that installation gave you as your own
  OSHAL peer connection. Then choose the plan, your peer connection and what the other swarm
  should look at, and Send to peer swarm. The reply is the peer's receipt; nothing runs there
  until its people decide.
- **Received work.** It appears under Received from other swarms. Inspect shows it as data.
  File as investigation opens one investigation ticket from it; filing it again returns the
  same ticket.

## Installed decision and mailbox checks — 21 October

The installed 6f1c38f development kernel passed actual HTML password sign-in,
original-owned input/receipt visibility, named bot attribution, separately labelled
reference cost and desktop/phone Studio runtime rendering. The baseline used an
existing real three-phase ticket; earlier reports are never presented as satisfying
new instructions retroactively. Create is installed from public application bceffaf0
and opens at `/cockpit/?app=create`, preserving the existing saved Office work.

Use `/utilities?category=email`, then **Microsoft 365 (Outlook)** or **Gmail**.
The Microsoft client has been prepared through the reviewed private installer;
authorization URL generation works. The signed-in person must still complete
provider consent, and the provider must allow the installation's callback. Portal
notification delivery needs an administrator SMTP/webhook transport separately.
Neither mailbox consent nor an actual email delivery has been certified.

The bounded local reproduction can be run with `python3 lab/verify.py`, followed
by `python3 lab/decision_incident.py` from the application folder. The second
command admits one recent, hash-checked monitoring capture and reserves before
mutations. It refuses a second episode while its durable receipt exists. It does
not give the agent access to Kubernetes or the source stream.

The fresh ticket 2a60f877 failed at the account receiver's 45 second deadline. Its
failed state is retained. The central782ae3d deadline correction uses90 seconds
for account inference,105 seconds for the kernel request and the unchanged120 second
phase limit. `python3 lab/decision_retry.py` performs one explicitly requested
linked child attempt against the same sealed packet; it also reserves before
creation and refuses duplication. Its receipt labels prior provider consumption
unknown when no successful usage receipt exists. Do not delete either receipt to
force retries after uncertain outcomes.

Run `node scripts/operations-decision-acceptance.cjs TICKET_UUID` from the repository root only against a completed fresh
three-phase investigation. It signs into the actual HTML portal and verifies the
evidence/decision tables, retained earlier reports, reference cost, runtime graph,
Create and mail category without approving a report or sending a notification.
Use a bounded CPU/memory scope and keep GPU acceleration disabled as in the helper.

The installed linked retry 537d9d04 completed all 3 analysis phases and is waiting
for human report approval. Its 3 workspace reports pass authenticated download/hash
checks. Cost shows 39,166 tokens and a separately labelled $0.050048 reference
estimate, with $0 recorded spend. This is a budget assumption, not billed cost.
The sealed packet, original report and reviewer response all reach the revise phase.
These are reviewable diagnostic/verification proposals; no infrastructure action
ran and standalone executable script files have not been materialized.
