# Local runtime resource review

Initial review: 20 October 2026, America/Chicago. The shutdown findings below are
historical. The operator resumed Docker and development on 21 October; the final
section records the applied local startup limits and their measured scope.

## Historical operator constraint and stopped state

The operator requested that Docker be stopped, no processes be started, and no GPU
work be used. All 38 then-running Docker containers were stopped. The Docker
service, Docker socket and containerd subsequently reported `inactive`. Container
data was retained. No application services, builds, test services, renderers or
GPU workloads were started for this review. Runtime acceptance remains on hold.
The operator subsequently authorized small CPU-only unit checks, with resource
limits. That permission does not restart the lab or authorize GPU work.

The existing application processing receipt already records its personal worker
disabled and schedule inactive at the end of that acceptance run. This is separate
from the subsequent host shutdown. Historical success does not prove that a stopped
portal is currently available.

## Host observations

| Observation | Recorded value | Interpretation |
|---|---|---|
| Linux `MemTotal` | 127598544 KiB, approximately 121.7 GiB | Host-reported usable RAM. |
| `MemAvailable` after shutdown | 86603832 KiB, approximately 82.6 GiB | A point-in-time estimate, not a workload allocation. |
| Swap total / free | 33554428 / 33554428 KiB | Approximately 32 GiB, unused at that observation. |
| Memory pressure | `some` and `full` avg10/60/300 all 0.00 | No measured current pressure in those windows; does not erase earlier failures. |
| `vm.overcommit_memory` | 1 | Existing host setting; unchanged. |
| `vm.overcommit_ratio` | 50 | Recorded alongside overcommit mode; not a workload memory budget. |
| `vm.swappiness` | 10 | Existing host setting; unchanged. |
| Finite caps across the 38 previously running containers | 101.4375 GiB | Sum of Docker memory ceilings, not actual consumption or reserved memory. |
| Unbounded container among that set | `oshal-kernel-pg`, memory limit 0 | Additional demand not covered by the finite-cap sum. |

The container ceilings do not include native desktop applications or the separate
non-container training process observed holding NVIDIA device handles. This review
did not terminate that separate project or measure GPU allocations. No claim is
made that Docker limits accounted for all GPU-backed allocations.

Kernel journals establish two failure periods in the retained boots:

- 20:41:16–20:49:20: 255 NVIDIA `NV_ERR_NO_MEMORY` entries and 11 global OOM
  selections, including workloads in both Kubernetes labs.
- 21:31:27–21:32:01: 34 NVIDIA allocation failures, followed by a global OOM
  selection at 21:33:33. A CUDA event-handler thread invoked the OOM path.

These logs establish memory exhaustion and affected processes. An OOM victim or
the allocating thread does not establish the sole source of demand. This review
does not independently establish all three incidents reported by the operator.

## Installation budget mismatch

| Component | Memory ceiling | Source inspected |
|---|---|---|
| Each Operations kind node | 3 GiB; swap ceiling also 3 GiB; 2 CPUs | Docker inspection and `lab/lab.py:setup`. Three nodes total 9 GiB. |
| Local native kernel | 1536 MiB | Kernel `deploy/k8s/install_model.py`. Overrides the generic template's 32 GiB ceiling. |
| Workspace Code Server | 1 GiB | Kernel `deploy/k8s/code-server.yaml`. |
| One enrolled worker | 2 GiB | Kernel `deploy/k8s/install_worker.py`. |
| CLI account sidecar, when installed | 1536 MiB | Kernel `deploy/k8s/install_accounts.py`. Shares the kernel pod. |
| Local PostgreSQL | 512 MiB | Kernel `deploy/k8s/install_model.py`. |
| OpenSearch | 1536 MiB; Java heap 512 MiB | `lab/detection.py`. Heap is only part of process memory. |
| Detection engine | 256 MiB | `lab/detection.py`. |
| Lab Prometheus | 512 MiB | `lab/lab.py`; retention 6 hours / 128 MB on disk. |
| OTel collector | 256 MiB | `lab/lab.py`; processor limit 128 MiB, spike allowance 32 MiB. |
| Alertmanager / state metrics | 128 / 256 MiB | `lab/lab.py`. |

The standard workspace must remain one shared PVC. With the current local-path
storage, its node affinity co-locates the kernel, editor and enrolled worker.
Their ceilings alone total **4.5 GiB against a 3 GiB node ceiling**. The installed
account sidecar raises that group to **6 GiB**, before node services, other pods,
page cache and execution overhead. This is a permitted-peak budget mismatch,
not evidence that those containers consumed their limits simultaneously.

The low pod requests do not reserve their full permitted peaks. The monitoring and
demo namespace quotas are each 6 GiB of limits and do not budget the installation
namespace or enforce an aggregate host reserve. The node cap is applied by
`setup` after `kind create`; the bootstrap interval also needs an explicit budget.

## Required correction before runtime acceptance resumes

1. Define one CPU-only installation profile covering the control plane, workspace
   node, monitoring/search, database, account runtime, worker and editor. Preserve
   shared storage and preprocessing; do not solve placement by removing isolation.
2. Reconcile requests, ceilings, system reservations and local-volume placement.
   Include sidecars, initialization, rollout overlap and bounded worker concurrency.
   Refuse an installation that cannot fit before creating or scaling workloads.
3. Account for other host services and an explicit host reserve before selecting
   node ceilings. Do not automatically enlarge containers or launch all optional
   engines. Bound any database or auxiliary service included in this profile.
4. Enforce and report the budget during cluster creation as well as after startup.
   A successful `docker update` after unbounded creation is insufficient.
5. After the operator permits runtime work, collect actual per-node and per-pod
   memory, peak startup consumption, OOM/restart counts and memory-pressure signals.
   Re-run fresh installation, shared-workspace and pipeline acceptance with GPU
   access disabled. Do not use GPU pressure as a test scenario.

No new numeric allocation has been selected or applied. The application will not
claim that this review fixes the host, proves capacity, or authorizes restarting it.

## Corrective increment and bounded fixture verification

Kernel commit `d37720e` adds a read-only workspace memory-floor guard before the
five baseline/upgrade mutation paths. It is designed to reject the observed
6-GiB RWO workspace group on a 3-GiB node, including the account sidecar; it does
not change a resource limit. After explicit permission, an export of that committed
snapshot passed all 49 focused capacity/editor/workspace/account/installer tests,
including all 19 new memory-floor and refusal-before-write cases. No Docker,
Kubernetes, browser, build or GPU workload was started.

The test scope enforced 25% of one CPU core, 256 MiB RAM, no swap, at most 16 tasks,
nice level 15 and a 60-second timeout. The runner asserted the actual cgroup limits
before testing. Its cgroup memory peak was 35,180,544 bytes (33.6 MiB); Python took
2.79 seconds at 25% CPU, with 28,536 KiB peak RSS. These measurements describe only
the fixtures. They do not replace installation or full-pipeline acceptance.

This increment does not complete the required resource profile above. Its explicit
scope is the necessary floor for declared workspace Deployments; other workloads,
host reserve, concurrent changes and rollout/startup budget acceptance remain open.
See ADR0017 for the exact implemented boundary and verification still required.

## Evidence and scope

Sources were `/proc/meminfo`, `/proc/swaps`, `/proc/pressure/memory`, the three
`/proc/sys/vm` settings, narrowly selected Docker HostConfig fields before shutdown,
systemd unit state, retained kernel journals and the named source templates.
Kernel source was `edb6420`; application source was `239a86b1`. No credentials,
container environments, private configuration files or GPU diagnostic jobs were
needed. Runtime checks and the normal service-dependent publication gate remain
unexecuted since shutdown. See [ADR0017](adr/0017-local-runtime-resource-gate.md).

## 21 October supervised resumption

The operator explicitly resumed runtime work and identified separate training as the
source of the reported load. Existing Operations node caps now read3GiB control plane,
8GiB shared workspace and5GiB monitoring, unchanged2CPU/node and no container swap.
The6GiB workspace consumer floor fits8GiB. The superseded operations-experience
prototype is scaled to zero without deleting its PVCs; the extra GitOps lab that resumed
is stopped. Host/Docker peak accounting passed a20GiB host-reserve check before changes;
this point-in-time check is not a complete scheduling or production capacity certificate.
Native kernel, account runtime, worker, editor and monitoring resumed with no new Operations
node cgroup OOM kills in startup verification. Source feature work in this increment
requires no core change or model startup.
