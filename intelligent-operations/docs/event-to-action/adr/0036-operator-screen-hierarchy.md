# ADR0036 — Consistent daily operator screens

Status: accepted direction; implementation and deployment receipts are recorded separately.
Date: 21 October 2026.

## Problem

Operations, Systems, Data pipeline and Sources mixed explanation, daily monitoring, setup forms and raw records. Pipeline exposed the rule editor, worker settings, correlation and every event in one long page. Sources rendered every revision as a full card followed by both setup forms. Internal hash navigation could leave the cockpit rail naming another screen.

## Decision

Use a shared compact operator layout over existing caller-owned records. Operations highlights attention and recent activity. Systems keeps its tree and selected resource detail. Pipeline has Flow, Events, Rules, Automation and Correlation tabs. Sources has search, a selectable revision list and its exact mapping/detail panel; setup is a separate disclosure.

Cross-screen actions use the existing manifest-owned `app-navigate` message with bounded source/event selectors. The shell remains responsible for resolving an authorized application screen. Standalone navigation uses local query parameters. Do not introduce a second navigation service, credential store, collector or action executor.

## Accuracy and authority

Counts are explicitly bounded to returned cohorts. Source registration does not imply connectivity. Captured health is not a live probe; report acceptance is not recovery. A tab switch does not trigger evaluation, publication, collection, model calls or infrastructure actions. Original action controllers remain responsible for writes. New read projections clear on refusal and reject stale async ticket responses.

## Verification

Browser contracts cover source search and exact-revision drill-downs, event trails, raw-data disclosure, tab keyboard behavior, phone widths and access withdrawal. Existing SQL/browser contracts continue to exercise policy trials and activation, personal worker configuration and sealed investigation start. Native installed-screen inspection is a separate acceptance step.

## Embedded Systems follow-up

Native cockpit inspection at 1280px exposed inherited setup-form label margins and an early filter wrap that displaced the resource workbench. The filters now use compact margins and a single desktop row at embedded widths of at least 960px, with wrapping below that width. Filtered tree groups use the validated system catalogue for their labels, preserving the observed cluster name without adding excluded assets. Tests exercise the 1040px embedded width and filtered-pod label alongside existing phone, keyboard and access cases.
