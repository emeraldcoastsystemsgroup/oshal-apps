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
exports.detectRendererCapabilities = detectRendererCapabilities;
exports.renderBrandClipToFile = renderBrandClipToFile;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: local ffmpeg MP4 clip renderer for Brand Graphics (aspect, duration, brand kit colors/name, title, sourceLink, voiceover, music) with honest worker_unavailable detection.
 */
const node_child_process_1 = require("node:child_process");
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const render_types_1 = require("./render-types");
const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const FONT_REG = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const RENDER_TIMEOUT_MS = 45000;
function configuredFfmpegBin(ctx) {
    if (typeof ctx?.brandGraphicsFfmpegBin === 'string')
        return ctx.brandGraphicsFfmpegBin;
    if (typeof process.env.BRAND_GRAPHICS_FFMPEG_BIN === 'string')
        return process.env.BRAND_GRAPHICS_FFMPEG_BIN;
    return process.env.FFMPEG_PATH || 'ffmpeg';
}
function detectRendererCapabilities(ctx) {
    if (ctx?.brandGraphicsRendererDisabled === true || process.env.BRAND_GRAPHICS_DISABLE_RENDERER === '1') {
        return { available: false, localFfmpeg: false, workerReady: false, ffmpegBin: null };
    }
    const bin = configuredFfmpegBin(ctx);
    if (!bin || bin === '__none__') {
        return { available: false, localFfmpeg: false, workerReady: false, ffmpegBin: null };
    }
    try {
        (0, node_child_process_1.execFileSync)(bin, ['-version'], {
            stdio: 'ignore',
            timeout: 3000,
            env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C' },
        });
        return { available: true, localFfmpeg: true, workerReady: true, ffmpegBin: bin };
    }
    catch {
        return { available: false, localFfmpeg: false, workerReady: false, ffmpegBin: null };
    }
}
function hexToFfmpeg(hex) {
    return `0x${hex.replace(/^#/, '').toLowerCase()}`;
}
function drawableText(text) {
    const clean = text.replace(/\r?\n/g, ' ').trim();
    const extraBytes = Buffer.byteLength(clean, 'utf8') - [...clean].length;
    return clean + ' '.repeat(Math.max(0, extraBytes));
}
function wrapSnippet(text, maxChars) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxChars)
        return compact;
    return `${compact.slice(0, maxChars - 3).trim()}...`;
}
function writeTextFile(workDir, name, content) {
    const file = path.join(workDir, name);
    fs.writeFileSync(file, drawableText(content), { encoding: 'utf8', mode: 0o600 });
    return file;
}
function musicFilterExpr(music, hasVoiceover) {
    const gain = hasVoiceover ? 0.14 : 0.20;
    switch (music) {
        case 'broadcast-sting':
            return `${gain}*(sin(2*PI*110*t)+0.5*sin(2*PI*164.81*t)+0.3*sin(2*PI*220*t)*(0.6+0.4*cos(2*PI*0.5*t)))`;
        case 'clean-pulse':
            return `${gain}*(0.7*sin(2*PI*196*t)+0.4*sin(2*PI*293.66*t))*(0.5+0.5*sin(2*PI*2*t))`;
        case 'warm-ambient':
            return `${gain}*(0.6*sin(2*PI*146.83*t)+0.4*sin(2*PI*220*t)+0.25*sin(2*PI*293.66*t))`;
        case 'none':
        default:
            return hasVoiceover ? '0.09*sin(2*PI*240*t)*(0.5+0.5*sin(2*PI*3*t))' : '0';
    }
}
function buildVideoFilter(input, kit, width, height, workDir) {
    const bg = hexToFfmpeg(kit.backgroundColor);
    const primary = hexToFfmpeg(kit.primaryColor);
    const accent = hexToFfmpeg(kit.accentColor);
    const bandH = Math.max(12, Math.round(height * 0.04));
    const accentH = Math.max(8, Math.round(height * 0.02));
    const filters = [
        `drawbox=x=0:y=0:w=${width}:h=${height}:color=${bg}:t=fill`,
        `drawbox=x=0:y=0:w=${width}:h=${bandH}:color=${primary}:t=fill`,
        `drawbox=x=0:y=${height - bandH}:w=${width}:h=${bandH}:color=${primary}:t=fill`,
        `drawbox=x=48:y=${Math.round(height * 0.24)}:w=${Math.max(120, Math.round(width * 0.28))}:h=${accentH}:color=${accent}:t=fill`,
    ];
    const hasBold = fs.existsSync(FONT_BOLD);
    const hasReg = fs.existsSync(FONT_REG);
    if (hasBold || hasReg) {
        const bold = hasBold ? FONT_BOLD : FONT_REG;
        const reg = hasReg ? FONT_REG : FONT_BOLD;
        const brandSize = Math.round(Math.min(width, height) * 0.055);
        const titleSize = Math.round(Math.min(width, height) * 0.062);
        const bodySize = Math.round(Math.min(width, height) * 0.036);
        const footSize = Math.round(Math.min(width, height) * 0.026);
        const maxChars = width >= height ? 44 : 26;
        const brandFile = writeTextFile(workDir, 'brand.txt', wrapSnippet(kit.brandName, 36));
        const titleFile = writeTextFile(workDir, 'title.txt', wrapSnippet(input.title, maxChars));
        const subLine = input.voiceover || input.brief;
        const subFile = writeTextFile(workDir, 'sub.txt', wrapSnippet(subLine, maxChars + 14));
        filters.push(`drawtext=fontfile=${bold}:textfile=${brandFile}:expansion=none:fontsize=${brandSize}:fontcolor=${accent}:x=48:y=${Math.round(height * 0.14)}`, `drawtext=fontfile=${bold}:textfile=${titleFile}:expansion=none:fontsize=${titleSize}:fontcolor=0xffffff:x=48:y=${Math.round(height * 0.34)}`, `drawtext=fontfile=${reg}:textfile=${subFile}:expansion=none:fontsize=${bodySize}:fontcolor=0xe2e8f0:x=48:y=${Math.round(height * 0.50)}`);
        if (input.sourceLink) {
            const linkFile = writeTextFile(workDir, 'source.txt', wrapSnippet(input.sourceLink, maxChars + 18));
            filters.push(`drawtext=fontfile=${reg}:textfile=${linkFile}:expansion=none:fontsize=${footSize}:fontcolor=0x94a3b8:x=48:y=${Math.round(height * 0.84)}`);
        }
    }
    filters.push('format=yuv420p');
    return filters.join(',');
}
function buildFfmpegArgs(input, kit, width, height, workDir, outFile) {
    const vf = buildVideoFilter(input, kit, width, height, workDir);
    const audioExpr = musicFilterExpr(input.music, Boolean(input.voiceover));
    const comment = [
        `style=${kit.brandStyle}`,
        `music=${input.music}`,
        input.voiceover ? `voiceover=${input.voiceover.slice(0, 160)}` : '',
        input.sourceLink ? `source=${input.sourceLink.slice(0, 200)}` : '',
    ].filter(Boolean).join('; ');
    return [
        '-y', '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2',
        '-f', 'lavfi', '-i', `color=c=${hexToFfmpeg(kit.backgroundColor)}:s=${width}x${height}:r=24:d=${input.durationSec}`,
        '-f', 'lavfi', '-i', `aevalsrc=${audioExpr}|${audioExpr}:s=44100:d=${input.durationSec}`,
        '-vf', vf,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-shortest', '-movflags', '+faststart',
        '-metadata', `title=${input.title}`,
        '-metadata', `artist=${kit.brandName}`,
        '-metadata', `comment=${comment}`,
        outFile,
    ];
}
async function renderBrandClipToFile(ctx, input, kit, targetMp4) {
    const caps = detectRendererCapabilities(ctx);
    if (!caps.available || !caps.ffmpegBin) {
        throw new render_types_1.RenderError(503, 'worker_unavailable', 'No render worker or local renderer is available on this installation, so nothing was queued.');
    }
    const { width, height } = render_types_1.ASPECT_DIMENSIONS[input.aspect];
    const parentDir = path.dirname(targetMp4);
    const workDir = fs.mkdtempSync(path.join(parentDir, 'work-'));
    const tmpMp4 = path.join(parentDir, `.tmp-${crypto.randomBytes(6).toString('hex')}.mp4`);
    try {
        const args = buildFfmpegArgs(input, kit, width, height, workDir, tmpMp4);
        await new Promise((resolve, reject) => {
            (0, node_child_process_1.execFile)(caps.ffmpegBin, args, { timeout: RENDER_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024, env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C' } }, (error, _stdout, stderr) => {
                if (error) {
                    reject(new render_types_1.RenderError(503, 'render_failed', `Clip render failed: ${String(stderr || error.message).slice(0, 240)}`));
                    return;
                }
                resolve();
            });
        });
        const stat = fs.statSync(tmpMp4);
        if (!stat.isFile() || stat.size < 1024) {
            throw new render_types_1.RenderError(503, 'render_failed', 'Rendered output was empty.');
        }
        fs.renameSync(tmpMp4, targetMp4);
        return { width, height, fileBytes: stat.size, renderer: 'local-ffmpeg' };
    }
    finally {
        fs.rmSync(workDir, { recursive: true, force: true });
        if (fs.existsSync(tmpMp4))
            fs.rmSync(tmpMp4, { force: true });
    }
}
