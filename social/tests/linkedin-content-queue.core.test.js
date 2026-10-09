"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Owner-bound queue intake guard: bounded citation provenance, caller-only listing, and unauthenticated denial.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Manifest-contract case: the shipped oshal-app.yaml must register linkedin-content-post with pipeline manifest-worker and workerBot social-writer, and the intake must file tickets of that same type with no provider/target override. The kernel's bound queue worker refuses any other shape, so a manifest without the pipeline made every queued ticket fail at dispatch.
 */
const path = require("node:path");
process.env.NODE_PATH = [
  process.env.NODE_PATH,
  path.join(process.env.OSHAL_CORE_ROOT || path.resolve(__dirname, "../../../oshal"), "node_modules"),
].filter(Boolean).join(path.delimiter);
require("node:module").Module._initPaths();
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLinkedInContentQueueRoutes } = require("../routes/linkedin-content-queue.js");
const fs = require("node:fs");
const yaml = require("js-yaml");

const MANIFEST = yaml.load(fs.readFileSync(path.join(__dirname, "..", "oshal-app.yaml"), "utf8"));

function invoke(router, method, path, body, sub) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method.toLowerCase()]);
  assert.ok(layer, `route ${method} ${path} exists`);
  const req = { method, path, body, oidc: sub ? { user: { sub } } : undefined };
  const result = { statusCode: 200, body: undefined };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(value) { result.body = value; return this; },
  };
  return Promise.resolve(layer.handle(req, res, () => {})).then(() => result);
}

test("queue intake is owner-bound and keeps bounded citation provenance", async () => {
  let created;
  const ctx = {
    ticketService: {
      async createTicket(input) { created = input; return { ticketId: "ticket-1", ticketType: input.ticketType, status: input.status }; },
      async listTickets(options) { return [{ ownerSub: options.ownerSub, ticketType: options.ticketType }]; },
    },
  };
  const router = createLinkedInContentQueueRoutes(ctx);
  const response = await invoke(router, "POST", "/", {
    topic: "release notes", sourceUrl: "https://example.test/one",
    sourceCitations: ["https://example.test/one", "https://example.test/two"],
  }, "owner-1");
  assert.equal(response.statusCode, 202);
  assert.equal(created.ticketType, "linkedin-content-post");
  assert.equal(created.ownerSub, "owner-1");
  assert.equal(created.metadata.source, "linkedin-content-queue");
  assert.deepEqual(created.metadata.sourceCitations, ["https://example.test/one", "https://example.test/two"]);
  const listed = await invoke(router, "GET", "/", undefined, "owner-1");
  assert.deepEqual(listed.body.tickets[0], { ownerSub: "owner-1", ticketType: "linkedin-content-post" });
});
test("queue intake denies an unauthenticated caller", async () => {
  const router = createLinkedInContentQueueRoutes({ ticketService: { createTicket: async () => { throw new Error("must not run"); } } });
  const response = await invoke(router, "POST", "/", { topic: "not admitted" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, "not_authenticated");
});
test("the manifest registers the exact workflow the kernel queue binding admits", async () => {
  // core src/app/linkedin-content-queue-workflow.ts refuses a ticket unless the registered
  // workflow is this ticketType + pipeline + workerBot triplet; the registry passes the
  // manifest's pipeline through unchanged, so a missing key fails every queued ticket.
  assert.equal(MANIFEST.ticketType, "linkedin-content-post");
  assert.equal(MANIFEST.workflow.pipeline, "manifest-worker");
  assert.equal(MANIFEST.workflow.workerBot, "social-writer");
  let created;
  const router = createLinkedInContentQueueRoutes({
    ticketService: { async createTicket(input) { created = input; return { ticketId: "ticket-2", ...input }; } },
  });
  const response = await invoke(router, "POST", "/", { topic: "contract check" }, "owner-2");
  assert.equal(response.statusCode, 202);
  assert.equal(created.ticketType, MANIFEST.ticketType);
  assert.equal(created.status, "approved");
  assert.equal(Object.hasOwn(created.metadata, "providerIntent"), false);
  assert.equal(Object.hasOwn(created.metadata, "targetAgentId"), false);
});
