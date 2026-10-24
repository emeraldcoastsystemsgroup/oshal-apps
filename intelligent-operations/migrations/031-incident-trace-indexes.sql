-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Index exact owner-scoped ticket, delivery, cohort, plan and handoff joins for the incident trace.
CREATE INDEX IF NOT EXISTS operations_trace_investigation_ticket ON operations_investigations(user_sub,(record->>'ticketId'),created_at DESC);
CREATE INDEX IF NOT EXISTS operations_trace_filter_delivery ON operations_filter_decisions(user_sub,delivery_id,created_at DESC);
CREATE INDEX IF NOT EXISTS operations_trace_cohort_deliveries ON operations_topology_decisions USING gin ((record->'deliveryIds'));
CREATE INDEX IF NOT EXISTS operations_trace_plan_ticket ON operations_action_plans(user_sub,(record->>'ticketId'),created_at DESC);
CREATE INDEX IF NOT EXISTS operations_trace_approval_plan ON operations_action_approvals(user_sub,(record->>'planId'),created_at DESC);
CREATE INDEX IF NOT EXISTS operations_trace_execution_plan ON operations_action_executions(user_sub,(record->>'planId'),created_at DESC);
CREATE INDEX IF NOT EXISTS operations_trace_link_ticket ON operations_ticket_links(user_sub,(record->>'ticketId'),created_at DESC);
CREATE INDEX IF NOT EXISTS operations_trace_attempt_link ON operations_sync_attempts(user_sub,(record->>'linkId'),created_at DESC);
