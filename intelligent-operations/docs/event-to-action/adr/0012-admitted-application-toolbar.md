# ADR 0012: Application-defined cockpit navigation

Status: Implemented; installed acceptance recorded in IMPLEMENTATION-STATUS.md.

The Operations ticket link opened the global cockpit without `app=intelligent-operations`.
The global framework profile also returned every static application tile without checking
whether its provider was installed, active and admitted to the current person.

Use the existing application manifest contract. Operations `ui.static` declares its
Overview, Topology, Data pipeline, Sources and Workflow Studio destinations;
`ribbon.hideFrameworkItems` retains the canonical Tickets view and excludes unrelated
framework workbenches. Ticket links preserve `/cockpit/?app=intelligent-operations&ticket=…`.
The shell resolves the declared default tool name to its registered view identifier.
Workflow Studio appears only when its owning application is active and admitted.

Global toolbar links use the same current route-owner admission as application tiles.
An administrator does not get links to unloaded applications merely by being an
administrator. Native Files, Security Center, Test Lab and Eval Wall remain kernel
pages with their existing reader/operator checks. The Apps menu continues to use
current admitted workspace discovery. Hidden navigation never substitutes for route
authorization, which is checked again on use.

This changes navigation and context retention; it does not implement missing telemetry,
anomaly detection, generated remediation or automated infrastructure execution.
