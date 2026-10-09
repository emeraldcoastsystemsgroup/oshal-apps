"use strict";
/**
 * Owner-scoped LinkedIn content queue intake. The queue worker later binds this ticket to the
 * kernel LinkedIn Assistant's draft/review/approval lifecycle. This route never publishes.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Create owner-bound linkedin-content-post tickets with bounded source citations and explicit queue provenance.
 */
const { Router } = require("express");

const WORKFLOW = "linkedin-content-post";

function callerSub(req) {
  const sub = req.oidc?.user?.sub;
  return sub ? String(sub) : null;
}

function text(value, max) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function citations(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim().slice(0, 2000)))].slice(0, 8);
}

function createLinkedInContentQueueRoutes(ctx) {
  const router = Router();

  router.post("/", async (req, res) => {
    const sub = callerSub(req);
    if (!sub) return res.status(401).json({ error: "not_authenticated" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const topic = text(body.topic, 500);
    if (!topic) return res.status(400).json({ error: "topic_required" });
    const sourceUrl = text(body.sourceUrl, 2000);
    const sourceCitations = citations(body.sourceCitations);
    const links = [...new Set([...(sourceUrl ? [sourceUrl] : []), ...sourceCitations])].slice(0, 8);
    try {
      const ticket = await ctx.ticketService.createTicket({
        title: `LinkedIn post: ${topic}`.slice(0, 180),
        description: text(body.description, 4000) || topic,
        ticketType: WORKFLOW,
        status: "approved",
        priority: "none",
        labels: ["social", "linkedin-content"],
        ownerSub: sub,
        metadata: {
          source: "linkedin-content-queue",
          topic,
          goal: text(body.goal, 500) || null,
          tone: text(body.tone, 200) || null,
          sourceUrl: sourceUrl || null,
          sourceCitations: links,
        },
      });
      return res.status(202).json({ ticket: { ticketId: ticket.ticketId, ticketType: ticket.ticketType, status: ticket.status }, citations: links });
    } catch (error) {
      return res.status(502).json({ error: "queue_unavailable", message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/", async (req, res) => {
    const sub = callerSub(req);
    if (!sub) return res.status(401).json({ error: "not_authenticated" });
    const tickets = await ctx.ticketService.listTickets({ ownerSub: sub, ticketType: WORKFLOW, limit: 50 });
    return res.json({ tickets });
  });

  return router;
}

module.exports = { createLinkedInContentQueueRoutes };
