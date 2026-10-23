-- CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Repository links: each recorded Kubernetes cluster linked to its GitOps repository, base branch, folder and optional workflow, so promotion targets the right repository.
CREATE TABLE IF NOT EXISTS operations_repo_links (
 user_sub text NOT NULL, id text NOT NULL, created_at timestamptz NOT NULL, record jsonb NOT NULL,
 PRIMARY KEY(user_sub,id)
);
