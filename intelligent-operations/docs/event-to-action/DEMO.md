# TriageNorth demonstration path

A twelve-minute walk through the installed application on the owned lab, in the order a judge
should see it. Every step uses the native OSHAL sign-in and the signed-in person's own
authority; every number on screen comes from a stored record or a live read, and each step
names the receipt that proves it. Open the portal at http://127.0.0.1:38081 and choose
Operations.

| Minute | Screen | What to show | Proof |
|---|---|---|---|
| 0–1 | Overview | Needs attention leads with what waits on you: reports to approve, response plans to approve, executions without verified recovery, overdue break-glass reconciliations, firing anomaly baselines. Incident work opens on "Needs you". | `tests/operator-workspace.test.cjs` |
| 1–3 | Systems | Open Live cluster and Read live cluster: the three nodes, deployments and pods as they are now; Save as inventory scan. Expand `operations-lab · kubernetes`, select a node: capacity against allocatable, pressure, versions, taints and the pods on it; click a pod, then Read current status through your own Kubernetes connection. | ADR0039, ADR0041, `deploy/evidence/live-cluster.json` |
| 3–4 | Scenario lab | Run the datacenter scenario: 100 occurrences → 40 matches → 4 symptoms → 2 dependency groups, four pinned packets. | `deploy/evidence/replay.json` |
| 4–5 | Live context | Anomaly detection: real frontend 503 ratio from Prometheus scored by the local detector; readiness, last score and the candidate it raised. | `deploy/evidence/anomaly-live.json`, `deploy/evidence/anomaly-nab.json` |
| 5–6 | Data pipeline | The anomaly candidate as an event, its percolation decision and reduction; correlation results; with automatic investigation on, the tick starts the investigation itself. | ADR0038, ADR0041, `deploy/evidence/auto-investigate-live.json` |
| 6–9 | Incident work | Ticket `46b8df31`: three real model phases, the generated `remediate.sh`/`verify.sh`/`rollback.md`/`verify.md` (download them), the approval bound to their digests and the pod, one confirmed exec, `verify.sh` plus the resolved alert → healthy, ticket done at revision 5. | ADR0037, `deploy/evidence/response.json` |
| 9–10 | Incident work → Promote through Git | Upper level: commit the same files and a manifest to a branch, open a pull request, start the pipeline. Lower level: after a break-glass exec, reconcile in Git within 24 hours. | ADR0040, `tests/git-promotion.test.cjs` |
| 10–11 | Command helper | Ask for "list the EKS clusters in us-east-1": a coached, read-only argv with risk and verification, then Run through your AWS connection, signed with your own key. `gcloud container clusters list` and `az aks list` run the same way through your Google and Microsoft accounts. Choose "On a host (your SSH key)" to run a coached command on a selected host. For a pod, run a reviewed command through your own Kubernetes connection. | ADR0039, ADR0042, `tests/command-helper.test.cjs` |
| 11–12 | Git explorer | Load your repositories; open the cluster's GitOps repository: branches, open pull requests, runs, a manifest file; link it to the cluster. | ADR0048, `tests/git-explorer.test.cjs` |
| 11–12 | Provisioning | Render a team namespace: quota, defaults, default-deny ingress, editors binding; the exact YAML; promote it through Git. | ADR0044, `deploy/evidence/provisioning-dry-run.json` |
| 11–12 | Jarvis | Ask "what needs my attention in operations?": the summary from your own records, and the page to open. | ADR0046, `tests/attention.test.cjs` |
| 11–12 | Swarm hand-off | Issue a peer token for a lower swarm; the received delegation in the inbox, inspected as data and filed as an investigation; a plan sent through the peer connection (fixture). | ADR0043, kernel ADR-194, `tests/delegations.test.cjs` |
| 11–12 | Workflow Studio | The same workflow as the ticket graph; integration points and what the kernel still needs. | WORKFLOW-ALIGNMENT.md, KERNEL-RAILS-NEEDED.md |

## Talking points that stay true

- Report acceptance is not recovery. Recovery is a passing check on the same pod plus a resolved
  signal admitted after the action.
- The analysis bots never hold a credential. Every infrastructure or provider write is the
  person's own connection with a fresh confirmation.
- Command results pasted from a terminal are labelled operator-provided; the application runs no
  cloud command itself.
- The anomaly receipts show both the strong and the weak cases (about 20 alerts a day on noisy
  CPU with a-priori parameters; missed EC2 windows when calibrated). Nothing is tuned on the
  evaluation data.

## Before the demo

```bash
python3 ~/Documents/projects/oshal-kernel/deploy/k8s/install.py pod-connect --pod-namespace operations-demo --password-file ~/.local/state/oshal-k8s/admin-password.json
```

The Kubernetes connection is a one-hour namespace-scoped token; renew it shortly before the demo.

What only a person or an administrator can connect. Do these before the demo to show the live
paths rather than the fixtures:

| For | Who | What |
|---|---|---|
| AWS reads | You | Connections → AWS STS and Amazon EKS: your own read-only key as `{"accessKeyId","secretAccessKey"}`; an administrator selects the regional endpoints |
| Google Cloud reads | Administrator, then you | Register `GCP_CLIENT_ID`/`GCP_CLIENT_SECRET` with the installation's public callback; select the Google Cloud service; you connect your Google account |
| Azure reads | Administrator, then you | Register `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` (Microsoft identity platform, Resource Manager `user_impersonation`); select the Azure service; you connect your Microsoft account |
| Git promotion and provisioning | You | GitHub is enabled on the lab (`https://api.github.com`). Create a fine-grained personal access token on GitHub for one test repository (Contents, Pull requests and Actions: read and write) and paste it in a promotion panel's "Your own access token" field; it goes straight to the kernel vault |
| SSH host commands | Administrator, then you | Select hosts in `OSHAL_SSH_SERVICE` (name, literal address, port, pinned SHA-256 host key); you save your own username and ed25519 key as your SSH connection |
| Sending to another swarm | The other swarm's owner, then you | They issue a peer token on Swarm hand-off; an administrator selects their HTTPS origin for the OSHAL peer installation service; you save the token as your peer connection |
GitHub/GitLab promotion needs the service selected by an administrator and your account connected.
