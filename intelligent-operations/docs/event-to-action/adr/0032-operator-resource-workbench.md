# ADR0032: Give operators one resource workbench and one navigation owner

Installed and browser-accepted, 21 October 2026. Native navigation, resource
ownership expansion and historical RCA citations are visible in the portal.

The native cockpit supplied an application rail while the embedded Operations
page rendered its own header and full navigation. The Systems view used repeated
cards instead of a persistent selection/detail layout, and its default screen
used promotional wording. These are concrete sources of inconsistent navigation.

When embedded, the native rail now owns navigation; the inner header/nav are hidden.
Standalone access retains its own shell. Native entries cover Systems, topology,
data, live context, scenarios, sources, connections and credentials. Systems is
the default; Overview remains an explicit summary. Shared theme tokens and compact
page headings apply across Operations pages. No authority follows from a navigation
entry, and no private/unloaded application is added to the toolbar.

Systems uses a bounded exact-identity tree and one inspection panel. Grouping rows
are explicitly groups. Workload ownership chains determine primary containment;
node placement remains an observed relationship. Ambiguous ownership and cycles
are not silently resolved. Capture time, unknown health and partial collections
remain visible. Read-only graph refresh does not pretend to probe a cluster.
The lab collector additionally retains measured pod phase/readiness and container
waiting/termination facts without copying environment credentials.

The AI terminal and historical RCA reference library are separate backlog work.
Native generic HTTP services currently enforce a public HTTPS fence and expose
no Kubernetes private-CA/exec adapter. Do not weaken that fence or grant cluster
credentials to the evidence-analysis bot. A reusable original-user infrastructure
connection/execution service is required. Existing RCA outputs remain canonical
ticket work/artifacts; the current Operations manifest declares no RCA reference
collection. A future library must cite and revalidate those sources rather than
invent a second causal graph from report text.
