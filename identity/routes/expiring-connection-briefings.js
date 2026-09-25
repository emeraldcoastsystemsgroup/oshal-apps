"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reconcile unrenewable expiring connections through registered Jarvis briefing source.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOURCE_ID = exports.SESSION = void 0;
exports.expiringConnectionRows = expiringConnectionRows;
exports.collectExpiringConnectionBriefings = collectExpiringConnectionBriefings;
exports.createExpiringConnectionBriefingRoutes = createExpiringConnectionBriefingRoutes;
const express_1 = require("express");
const taskStore = __importStar(require("@/app/routes/jarvis-task-store"));
const jarvis_briefing_delivery_1 = require("@/app/routes/jarvis-briefing-delivery");
const request_identity_1 = require("@/shared/services/database/request-identity");
const connector_tenancy_1 = require("@/app/routes/connector-tenancy");

exports.SESSION = 'identity-expiring-connections';
exports.SOURCE_ID = 'identity:expiring-connections';

async function expiringConnectionRows(ctx) {
    const query = {
        text: `SELECT connection_id, user_sub, connected_by_sub, tenant_id, provider, label,
                  account_key, is_default, account_email, account_id, scopes, access_token,
                  refresh_token, expiry, created_at
           FROM oshal_connections
           WHERE expiry IS NOT NULL AND refresh_token IS NULL
             AND expiry > NOW() AND expiry <= NOW() + INTERVAL '14 days'
           ORDER BY expiry ASC`,
        query_timeout: 2000,
    };
    const result = await (0, request_identity_1.runWithSystemIdentity)(() => ctx.pool.query(query));
    return result.rows;
}

async function collectExpiringConnectionBriefings(ctx, now = Date.now()) {
    const runtime = (0, jarvis_briefing_delivery_1.getJarvisBriefingDelivery)();
    if (typeof taskStore.saveCompletedBriefing !== 'function' || !runtime) {
        return { state: 'unavailable', summary: 'Expiring-connection briefings require the registered completed-briefing runtime.' };
    }
    try {
        if (!await runtime.service.isProducerSession(exports.SESSION)) {
            return { state: 'unavailable', summary: 'Expiring-connection briefing source is not registered.' };
        }
        const rows = await expiringConnectionRows(ctx);
        const counts = { inspected: 0, queued: 0, deferred: 0 };
        const dayKey = new Date(now).toISOString().slice(0, 10);
        for (const row of rows) {
            counts.inspected += 1;
            if (!(0, connector_tenancy_1.isConnectionExpiring)(row, now)) {
                continue;
            }
            const at = new Date(row.expiry).getTime();
            const daysLeft = Math.max(1, Math.ceil((at - now) / (24 * 3600000)));
            const id = `identity:expiring:${row.connection_id}:${dayKey}`;
            const name = row.label || row.account_email || row.provider;
            const title = `Expiring connection: ${name}`;
            const payload = `Your ${name} (${row.provider}) connection will lapse in ${daysLeft} day${daysLeft === 1 ? '' : 's'} and cannot renew itself. Reconnect in Identity Hub before it breaks.`;
            const accepted = await taskStore.saveCompletedBriefing(id, row.user_sub, exports.SESSION, title, payload);
            if (accepted) {
                counts.queued += 1;
            }
            else {
                counts.deferred += 1;
            }
        }
        return {
            state: counts.deferred ? 'deferred' : 'available',
            counts,
            summary: `Expiring connections: ${counts.inspected} inspected, ${counts.queued} queued, ${counts.deferred} deferred or already queued.`,
        };
    }
    catch (err) {
        return { state: 'unavailable', summary: 'Expiring-connection briefing collection is unavailable; a later scheduled run can retry.' };
    }
}

function createExpiringConnectionBriefingRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.post('/collect', async (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const result = await collectExpiringConnectionBriefings(ctx);
        res.status(result.state === 'unavailable' ? 503 : result.state === 'deferred' ? 202 : 200).json(result);
    });
    return router;
}
