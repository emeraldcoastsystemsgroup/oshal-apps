"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPortraitFaceAssets = registerPortraitFaceAssets;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve only four bundled face-finding assets under the existing Portrait view permission.
 */
const node_path_1 = require("node:path");
const ASSETS = [
    ['/face-module', 'portrait-face.js', 'application/javascript'],
    ['/face-worker', 'portrait-face-worker.js', 'application/javascript'],
    ['/face-cascade', 'portrait-face-cascade.js', 'application/javascript'],
    ['/face-model', 'face-model/facefinder.json', 'application/json'],
];
/** @description Register a closed set of same-origin local detector assets.
 * @param router Guarded package router. @param surfaceDir Trusted package tools directory.
 * @returns Nothing; no caller-controlled path is accepted.
 */
function registerPortraitFaceAssets(router, surfaceDir) {
    for (const [route, file, type] of ASSETS) {
        router.get(route, (_req, res) => {
            res.type(type).set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff');
            res.sendFile((0, node_path_1.join)(surfaceDir, file), err => {
                if (err && !res.headersSent)
                    res.status(404).end();
            });
        });
    }
}
