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
const express_1 = require("express");
const path = __importStar(require("path"));
function createReviewRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.get('/', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(path.join(ctx.appPackageDir, 'tools/review.html'));
    });
    for (const name of ['calendar-workspace.mjs', 'calendar-workspace.css'])
        router.get('/' + name, (req, res) => {
            if (Object.keys(req.query).some(k => k !== 'v') || (req.query.v != null && (typeof req.query.v !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(req.query.v)))) {
                res.status(400).json({ error: 'invalid_asset_query' });
                return;
            }
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.type(name.endsWith('.mjs') ? 'application/javascript' : 'text/css').sendFile(path.join(ctx.appPackageDir, 'tools', name));
        });
    return router;
}
