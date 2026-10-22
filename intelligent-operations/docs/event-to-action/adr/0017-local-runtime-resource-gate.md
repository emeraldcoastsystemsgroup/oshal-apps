# ADR 0017: Resource acceptance precedes local pipeline restart

Status: Original stop recorded 20 October; supervised restart authorized 21 October.
A necessary workspace-floor guard is implemented in kernel source `d37720e`; 49 focused
fixture checks pass. The resumed local installation passes placement/reserve checks
with explicit node budgets. A complete production resource profile remains open.
The operator identified separate training as the source of the earlier load.

## Context

The operator stopped Docker after repeated memory failures. The retained journals
confirm host OOM and NVIDIA allocation errors in two boots. Source and pre-shutdown
inspection establish a separate installation problem: the local workspace PVC
co-locates services whose permitted memory peaks exceed their kind node's ceiling.
The account sidecar must be included in that group. See RESOURCE-REVIEW.md for the
observations, exact sources and limits of the causal evidence.

## Decision

Keep runtime work stopped and use no GPU workload for this application. Retain the
standard shared workspace, kernel authority and isolated investigation model.
Before runtime acceptance resumes, require an explicit installation resource profile
that fits the host and each node, including local-volume placement, sidecars,
system headroom and startup/rollout overlap. Refuse an over-budget plan before
starting workloads. Source review and the subsequently authorized small CPU-only
unit checks do not authorize restarting Docker.

Do not silently increase limits, enable swap, change host VM settings, disable
security controls or launch auxiliary engines to get a passing demonstration.
Resource values remain unchanged until a reviewed correction is implemented and
the operator permits runtime work. No numerical replacement budget is selected by
this ADR. Source edits and acceptance results must remain distinguishable.

## Consequences and verification

The full pipeline goal remains open. Historical successful tests remain useful
evidence but do not prove current availability or capacity. New source review must
not rerun service-dependent hooks, renderers, browser or GPU checks while the stop
constraint applies. Publication and generated exports requiring those processes
remain explicitly pending; hooks are not bypassed.

Acceptance requires a pre-start refusal for insufficient host/node capacity, no
GPU device admission in the application profile, measured startup and steady-state
memory, unchanged shared-PVC behavior, no observed OOM/restart regression and the
complete event-to-action user journey. Infrastructure execution still requires its
own exact-artifact/target approval and verified outcome.

## Source increment and remaining boundary

Kernel `d37720e` adds `deploy/k8s/install_capacity.py` and calls it before fresh
installation and editor, worker, account-sidecar or workspace resource changes.
It compares the combined RWO workspace deployment limits with Docker caps and
Kubernetes allocatable memory, respecting node selectors and bound PV affinity.
Every possible unbound-claim placement must fit. RWX retains independent pod floors.
It counts sidecars, initialization peaks, replicas and declared pod overhead; it
never changes limits. All 19 new regression cases pass, with fixture subprocess
execution prohibited. The exported committed installer snapshot passes 49 tests
across capacity, editor, workspace, account and installer suites. CI registration
is present; the full service-dependent gate remains unrun since shutdown.

The fixture scope enforced 25% of one core, 256 MiB RAM, zero swap, 16 tasks,
nice level 15 and a 60-second timeout. Actual cgroup values were checked before
execution. Peak scope memory was 33.6 MiB; the Python run used 25% CPU over
2.79 seconds. No runtime resource values were changed or services started.

This catches a necessary condition that failed in the observed installation. It
does not certify host reserve, other pods, non-container/GPU demand, concurrent
changes, rollout overlap, aggregate RWX capacity or measured peak usage. The
reported result explicitly carries `fullCapacityCertified: false`. No installer
or runtime execution is authorized by committing the source.
