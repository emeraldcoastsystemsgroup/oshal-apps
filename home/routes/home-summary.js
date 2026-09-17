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
exports.readHomeSnapshot = readHomeSnapshot;
exports.homeSnapshotSummary = homeSnapshotSummary;
/** Read cached home metadata only; never refresh a device or execute a scene. */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function readHomeSnapshot(root, sub, file) {
    if (!sub || sub === '.' || sub === '..' || /[\\/]/.test(sub))
        throw Error('Invalid owner path');
    const base = path.resolve(root), owner = path.resolve(base, sub), target = path.resolve(owner, file);
    if (owner === base || !owner.startsWith(base + path.sep) || path.dirname(owner) !== base || path.dirname(target) !== owner)
        throw Error('Invalid owner path');
    if (!fs.existsSync(target))
        return null;
    const realBase = fs.realpathSync(base), real = fs.realpathSync(target);
    if (!real.startsWith(realBase + path.sep) || path.dirname(real) !== owner || fs.statSync(real).size > 2_000_000)
        throw Error('Invalid snapshot');
    return JSON.parse(fs.readFileSync(real, 'utf8'));
}
function homeSnapshotSummary(index, scenes, failed = false) {
    if (index != null && (!Array.isArray(index.devices) || !index.devices.every((d) => d && typeof d === 'object')))
        throw Error('Invalid device index');
    if (scenes != null && !Array.isArray(scenes.scenes))
        throw Error('Invalid scene index');
    const metrics = [{ id: 'cached-devices', label: 'Cached devices', value: index ? String(index.devices.length) : 'Not indexed' },
        { id: 'saved-scenes', label: 'Saved scenes', value: scenes ? String(scenes.scenes.length) : 'Not indexed' }];
    const at = new Date(index?.generatedAt || '');
    const detail = Number.isFinite(at.getTime()) ? 'Device index saved ' + at.toISOString() : 'Device index has no recorded refresh time';
    const notes = detail + '. ' + metrics.map(m => m.label + ': ' + m.value).join('. ') + '. Cached configuration only; no device liveness or successful execution is established.';
    const items = [{ text: 'Review home configuration', detail, tone: 'neutral', fix: 'home-dashboard', actions: [{ integration: 'prepare-document', context: { title: 'Home configuration review', notes } }] }];
    return { metrics, tiles: metrics, items, partial: failed, asOf: new Date().toISOString() };
}
//# sourceMappingURL=home-summary.js.map