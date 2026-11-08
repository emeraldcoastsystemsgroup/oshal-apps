-- CHANGE LOG
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Native final schema for pinned comments, replies, scheduled social posts, and MP4 video jobs.
CREATE TABLE IF NOT EXISTS publishing_comments (
 id UUID PRIMARY KEY,
 owner_key TEXT NOT NULL,
 document_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),
 page_id TEXT NOT NULL CHECK(length(page_id) BETWEEN 1 AND 64),
 target_type TEXT NOT NULL CHECK(target_type IN('page','frame','object')),
 target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 64),
 pin_x DOUBLE PRECISION NOT NULL CHECK(pin_x>=0 AND pin_x<=2000),
 pin_y DOUBLE PRECISION NOT NULL CHECK(pin_y>=0 AND pin_y<=2000),
 author_name TEXT NOT NULL CHECK(length(author_name) BETWEEN 1 AND 120),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 resolved BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,owner_key),
 FOREIGN KEY(document_id,owner_key) REFERENCES publishing_documents(id,owner_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS publishing_comment_replies (
 id UUID PRIMARY KEY,
 owner_key TEXT NOT NULL,
 comment_id UUID NOT NULL,
 author_name TEXT NOT NULL CHECK(length(author_name) BETWEEN 1 AND 120),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,owner_key),
 FOREIGN KEY(comment_id,owner_key) REFERENCES publishing_comments(id,owner_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS publishing_social_posts (
 id UUID PRIMARY KEY,
 owner_key TEXT NOT NULL,
 document_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),
 channel TEXT NOT NULL CHECK(channel IN('twitter','linkedin')),
 caption TEXT NOT NULL CHECK(length(caption) BETWEEN 1 AND 2000),
 status TEXT NOT NULL CHECK(status IN('scheduled','publishing','published','failed','cancelled')),
 scheduled_for TIMESTAMPTZ,
 published_at TIMESTAMPTZ,
 remote_id TEXT,
 error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,owner_key),
 FOREIGN KEY(document_id,revision,owner_key) REFERENCES publishing_revisions(document_id,revision,owner_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS publishing_video_jobs (
 id UUID PRIMARY KEY,
 owner_key TEXT NOT NULL,
 document_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 state TEXT NOT NULL CHECK(state IN('queued','rendering','ready','failed','cancelled')),
 blob_id UUID UNIQUE,
 result JSONB CHECK(result IS NULL OR octet_length(result::text)<=262144),
 error TEXT,
 details JSONB CHECK(details IS NULL OR octet_length(details::text)<=65536),
 run_until TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,owner_key),
 FOREIGN KEY(document_id,revision,owner_key) REFERENCES publishing_revisions(document_id,revision,owner_key) ON DELETE CASCADE,
 FOREIGN KEY(blob_id,owner_key) REFERENCES publishing_blobs(id,owner_key)
);
CREATE INDEX IF NOT EXISTS publishing_comments_doc ON publishing_comments(owner_key,document_id,created_at);
CREATE INDEX IF NOT EXISTS publishing_comment_replies_parent ON publishing_comment_replies(owner_key,comment_id,created_at);
CREATE INDEX IF NOT EXISTS publishing_social_posts_owner ON publishing_social_posts(owner_key,status,scheduled_for);
CREATE INDEX IF NOT EXISTS publishing_video_jobs_owner ON publishing_video_jobs(owner_key,document_id,revision,created_at);

-- Native variant intentionally omits PostgreSQL GUC policies: the native importer scopes
-- relations physically to the original admitted person/tenant. Every application predicate
-- and composite foreign key additionally binds SHA256([issuer,sub,principalId,tenant]).
