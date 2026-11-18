"use strict";
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
exports.createReviewRoutes = createReviewRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Serve the Job Apply connected-device setting screen on GET /settings and GET /review, plus read-only GET /config metadata for Career and Jarvis.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Read package version dynamically from oshal-app.yaml instead of hardcoding a literal string.
 */
const express_1 = require("express");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function readManifestVersion(packageDir) {
    try {
        const raw = fs.readFileSync(path.join(packageDir, 'oshal-app.yaml'), 'utf8');
        const match = /^version:\s*([^\s#]+)/m.exec(raw);
        return match?.[1] ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
function createReviewRoutes(ctx) {
    const router = (0, express_1.Router)();
    const packageDir = ctx.appPackageDir;
    const version = readManifestVersion(packageDir);
    const pagePath = path.join(packageDir, 'tools/review.html');
    const sendPage = (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(pagePath);
    };
    router.get('/settings', sendPage);
    router.get('/review', sendPage);
    router.get('/config', (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        const authed = req.oidc?.isAuthenticated?.() === true;
        if (!authed) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        res.json({
            package: 'job-apply',
            version,
            setting: 'job_apply_device',
            settingsUrl: '/cockpit/?app=job-apply&screen=job-apply-settings',
            workersEndpoint: '/api/apply-operator/workers',
            devicesPageUrl: '/cockpit/tools/devices.html',
            careerUrl: '/cockpit/?app=career-hunter&screen=career-submission-activity',
        });
    });
    return router;
}
