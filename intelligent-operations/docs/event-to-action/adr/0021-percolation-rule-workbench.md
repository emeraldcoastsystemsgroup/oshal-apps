# ADR 0021: Versioned rule editing and side-effect-free candidate trials

Status: Implemented in source; focused real SQL/OpenSearch/browser acceptance passes.
Date: 21 October 2026. Extends ADR0010 and ADR0013.

An operator needs to understand and change the percolation wall without rewriting a
JSON policy from scratch or changing live incident counts merely to test an idea.
The application keeps a named rule form, enable/capture choices, explicit fixed/sliding
suppression window, simple AND-condition builder and lossless advanced query JSON.
Saved immutable generations can be loaded as drafts; activation is always explicit.

A candidate trial selects 1–20 validated deliveries from the same owned source. Reject
foreign-owner/source and invalid references before contacting the engine or saving a
candidate. Seal a complete query generation through the existing real percolator and
save it as an intentional immutable candidate in the existing policy journal. Return
complete match sets per delivery; no active binding, filtering decision, symptom count
or evidence reservation changes. Repeating the same definition reuses its generation.
These saved candidates are retained policy history, not disposable unmanaged indexes.

Activation separately compares the source binding revision that the editor loaded.
A changed binding preserves the draft and blocks a stale overwrite. Existing decisions
retain their original policy; reevaluation is a separate recorded action. Trial mode
never grants snapshot or execution permission. The same current-user records-write
authority covers saving candidates and activation; the browser clears private rule,
history and trial contents on access withdrawal and ignores late results.

The focused acceptance uses actual PostgreSQL owner policies and OpenSearch, not a
local query imitation. Browser acceptance exercises editing, trial counts, explicit
activation, saved-draft restoration, phone layout and denial clearing. This decision
closes the rule-adjustment interaction; it does not itself wire continuous monitoring,
generate remediation, execute a change or establish incident recovery.
