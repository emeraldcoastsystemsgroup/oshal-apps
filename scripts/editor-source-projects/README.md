# Owned source persistence

source-project-store.mjs is the canonical generic persistence helper. Portrait Studio, Brand Graphics, Creative Studio and Vids Studio vendor the exact hash-stamped output; they own their typed models, operations, HTTP/AI bindings and current grant decisions. No installed package imports a sibling application or this scripts directory. LoRA’s identity/caption counters and signed worker files are a separate domain operation, not a generic source-project consumer.

The helper serializes writes by the SHA-256 of issuer, subject, principal and one tenant; fences transactions with fresh original authority; appends immutable JSON revisions; compare-and-swaps the project head; and records exact UUID request intents for safe retries. Deletes tombstone retries. Owner quotas bound projects (64), revisions (100), JSON (256 KiB), metadata (32 MiB), original assets (4 MiB each /32 MiB total), source images (128), chunks (64 KiB) and recent requests (256/24 h). Package validators enforce image decoding and reference geometry. PostgreSQL additionally forces owner RLS; native physical principal scoping requires separate explicit closed-SQL-family proof in the kernel.

Generate and verify package-owned runtime, DDL and disposable test fixtures:

```sh
node scripts/editor-source-projects/vendor.mjs
node scripts/editor-source-projects/vendor.mjs --check
OSHAL_STORE_ROOT=/absolute/store node --test create/tests/editor-source-vendor.test.mjs
STORE_CI_TOOLCHAIN=/absolute/canonical/toolchain node --test scripts/editor-source-projects/source-project-store.test.mjs
```

The drift check is registered in Create’s Test Lab catalog as editor-source-vendor. The isolated PostgreSQL test owns a uniquely labeled container from an existing local postgres:16-alpine image, runs as a non-superuser table owner and removes only that verified container. App browser recipes use controlled directory/provider seams and actual package routes/SQL; they never claim live provider or GPU evidence.
