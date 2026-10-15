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
exports.NoteError = exports.WHERE = exports.MAX_NOTE_BYTES = void 0;
exports.noteName = noteName;
exports.plainText = plainText;
exports.listLocal = listLocal;
exports.saveNote = saveNote;
exports.readNote = readNote;
exports.removeNote = removeNote;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Save and read a text note in the caller's OSHAL-local store, and list that store from where it really is. Jarvis handed "save that note somewhere I can find it again" to Storage, whose assistant had no write tool. On the native kernel the OSHAL-local store is the kernel's personal file store (storage.list / storage.save / storage.read intents), not the sandbox filesystem the list read, which always answered empty there; the legacy framework keeps its per-user directory.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Remove a saved .txt or .md note (storage.delete under the native kernel, the per-user directory on the legacy framework), so a note saved by mistake can be taken out again; Storage had no way to remove an OSHAL-local file on the native kernel.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A .txt note is saved as plain text: chat Markdown (bold and italic markers, # headings, * bullets, inline code ticks, links) is taken out before saving (sweep 10: a saved budget note read "**Sweep10 Budget Note**" and "*   **Rent:** $1,800"). A .md note keeps its Markdown.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Review of sweep 10: the clean-up changed real content after the person approved the card ("from pkg import __init__ as x" lost its dunder, "rm *.txt,*.md" became "rm .txt,.md", a "# install" shell comment lost its "#", "Use `--force` flag" lost its ticks). A .txt note now loses only chat bold, a "**" pair around words that opens after a space or punctuation and closes before one (x**2 + y**2 and f(**a,**b) stay); everything else is saved exactly as sent.
 */
/** Text notes in the caller's OSHAL-local store: save (never silently replacing), read back, and list. */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** The largest note saved or read back as text. */
exports.MAX_NOTE_BYTES = 256 * 1024;
/** Where a saved note is found again, said in every save answer. */
exports.WHERE = 'Saved in Storage, in your OSHAL-local store. Ask Storage to list your files or read it back.';
const LOCAL = { provider: 'oshal-local' };
const TEXT = /\.(txt|md)$/i;
/** A refusal the route answers with its own status. */
class NoteError extends Error {
    status;
    constructor(status, message) { super(message); this.status = status; }
}
exports.NoteError = NoteError;
/** True inside the native kernel's package sandbox, where the OSHAL-local store is the kernel's file store. */
function nativeStore(ctx) {
    return process.env.OSHAL_EGRESS === 'kernel' && typeof ctx.intent === 'function';
}
/** One kernel storage operation for the verified caller. */
function intent(ctx, name, sub, input) {
    return ctx.intent(name, { ...input, subject: sub });
}
/**
 * @description A note's file name: letters, digits, spaces, dot, dash and underscore only, at most 120 characters, ending
 * in .txt or .md (.txt is added when there is no extension). Anything else is refused rather than rewritten, so the person
 * finds the note under the name they asked for.
 * @param raw - The requested name.
 * @returns The file name.
 */
function noteName(raw) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name || !/^[\w.\- ]+$/.test(name) || name.startsWith('.'))
        throw new NoteError(400, 'A note name uses letters, digits, spaces, dots, dashes or underscores, like budget-note.txt.');
    const file = /\.[A-Za-z0-9]{1,8}$/.test(name) ? name : `${name}.txt`;
    if (!TEXT.test(file))
        throw new NoteError(400, 'A note is saved as a .txt or .md file.');
    if (file.length > 120)
        throw new NoteError(400, 'A note name is at most 120 characters.');
    return file;
}
/** Chat bold: a "**" pair around words, opening at the start or after a space or punctuation and closing before one. */
const BOLD = /(^|[^\w*])\*\*(?=[^\s*])([^*\n]*[^\s*])\*\*(?![\w*])/g;
/**
 * @description A .txt note's text without chat bold. Only a "**" pair around words is taken out ("**Rent:** $1,800" becomes
 * "Rent: $1,800"), because every other Markdown mark is also ordinary text in a note: "__init__", "*.txt", a "# comment"
 * line, `--force` in ticks, "* * * * *" in a crontab and "x**2" are saved exactly as the person approved them.
 * @param text - The note as the assistant sent it.
 * @returns The note without chat bold.
 */
function plainText(text) {
    return text.replace(BOLD, '$1$2');
}
/**
 * @description The files at the top of the caller's OSHAL-local store: the kernel's file store under the native kernel,
 * the per-user directory on the legacy framework.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param legacyDir - The legacy per-user directory.
 * @returns Name and size of each file (and its signed-in download link under the kernel).
 */
async function listLocal(ctx, sub, legacyDir) {
    if (nativeStore(ctx)) {
        const listed = await intent(ctx, 'storage.list', sub, { kind: 'files', override: LOCAL, subfolder: '' });
        return (Array.isArray(listed?.files) ? listed.files : []).map((f) => ({ name: String(f.name), size: Number(f.size) || 0, ...(f.downloadUrl ? { downloadUrl: String(f.downloadUrl) } : {}) }));
    }
    const dir = legacyDir(sub);
    if (!fs.existsSync(dir))
        return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile())
        .map((e) => ({ name: e.name, size: fs.statSync(path.join(dir, e.name)).size }));
}
/**
 * @description Save a text note in the caller's OSHAL-local store, a .txt note as plain text (see plainText). An existing
 * file of the same name is replaced only when the request says replace: true.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param body - { name, text, replace? }.
 * @param legacyDir - The legacy per-user directory.
 * @returns The saved name, its size and, under the kernel, its download link.
 */
async function saveNote(ctx, sub, body, legacyDir) {
    const name = noteName(body?.name);
    if (typeof body?.text !== 'string' || !body.text.trim())
        throw new NoteError(400, 'The note text is required.');
    const bytes = Buffer.from(/\.txt$/i.test(name) ? plainText(body.text) : body.text, 'utf8');
    if (bytes.length > exports.MAX_NOTE_BYTES)
        throw new NoteError(413, 'A note is at most 256 KB of text.');
    const existing = await listLocal(ctx, sub, legacyDir);
    if (body.replace !== true && existing.some((f) => f.name === name)) {
        throw new NoteError(409, `A file named ${name} is already saved. Choose another name, or replace it with the person's approval.`);
    }
    if (nativeStore(ctx)) {
        const saved = await intent(ctx, 'storage.save', sub, { kind: 'files', name, content: bytes.toString('base64'), override: LOCAL });
        return { name, size: bytes.length, ...(saved?.downloadUrl ? { downloadUrl: String(saved.downloadUrl) } : {}) };
    }
    const dir = legacyDir(sub);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), bytes);
    return { name, size: bytes.length };
}
/**
 * @description Read a saved .txt or .md note back as text.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param raw - The note's file name.
 * @param legacyDir - The legacy per-user directory.
 * @returns The name, size and text.
 */
async function readNote(ctx, sub, raw, legacyDir) {
    const name = noteName(raw);
    let bytes;
    if (nativeStore(ctx)) {
        if (!(await listLocal(ctx, sub, legacyDir)).some((f) => f.name === name))
            throw new NoteError(404, `No file named ${name} in your OSHAL-local store.`);
        const read = await intent(ctx, 'storage.read', sub, { path: name, provider: 'oshal-local' });
        bytes = Buffer.from(String(read?.content || ''), 'base64');
    }
    else {
        const file = path.join(legacyDir(sub), name);
        if (!fs.existsSync(file))
            throw new NoteError(404, `No file named ${name} in your OSHAL-local store.`);
        bytes = fs.readFileSync(file);
    }
    if (bytes.length > exports.MAX_NOTE_BYTES)
        throw new NoteError(413, 'That file is larger than 256 KB; open it from Files instead.');
    return { name, size: bytes.length, text: bytes.toString('utf8') };
}
/**
 * @description Remove a saved .txt or .md note from the caller's OSHAL-local store.
 * @param ctx - The application context.
 * @param sub - The verified caller.
 * @param raw - The note's file name.
 * @param legacyDir - The legacy per-user directory.
 * @returns The removed name.
 */
async function removeNote(ctx, sub, raw, legacyDir) {
    const name = noteName(raw);
    if (!(await listLocal(ctx, sub, legacyDir)).some((f) => f.name === name))
        throw new NoteError(404, `No file named ${name} in your OSHAL-local store.`);
    if (nativeStore(ctx))
        await intent(ctx, 'storage.delete', sub, { kind: 'files', name, override: LOCAL });
    else
        fs.unlinkSync(path.join(legacyDir(sub), name));
    return { name };
}
//# sourceMappingURL=local-notes.js.map