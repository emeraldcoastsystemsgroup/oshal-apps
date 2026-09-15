/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve only four bundled face-finding assets under the existing Portrait view permission.
 */
import { join } from 'node:path';
import type { Router } from 'express';

const ASSETS = [
  ['/face-module', 'portrait-face.js', 'application/javascript'],
  ['/face-worker', 'portrait-face-worker.js', 'application/javascript'],
  ['/face-cascade', 'portrait-face-cascade.js', 'application/javascript'],
  ['/face-model', 'face-model/facefinder.json', 'application/json'],
] as const;

/** @description Register a closed set of same-origin local detector assets.
 * @param router Guarded package router. @param surfaceDir Trusted package tools directory.
 * @returns Nothing; no caller-controlled path is accepted.
 */
export function registerPortraitFaceAssets(router: Router, surfaceDir: string): void {
  for (const [route, file, type] of ASSETS) {
    router.get(route, (_req, res) => {
      res.type(type).set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff');
      res.sendFile(join(surfaceDir, file), err => {
        if (err && !res.headersSent) res.status(404).end();
      });
    });
  }
}
