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
exports.FORMATS = exports.PrepError = exports.officialPractice = exports.research = exports.catalog = void 0;
exports.examOf = examOf;
exports.availableLessons = availableLessons;
exports.createSession = createSession;
exports.publicSession = publicSession;
exports.changeSession = changeSession;
/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Versioned original curriculum, session blueprints and private grading.
 */
const fs_1 = require("fs");
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
exports.catalog = JSON.parse((0, fs_1.readFileSync)(path.join(__dirname, '../data/test-prep/catalog.json'), 'utf8'));
exports.research = JSON.parse((0, fs_1.readFileSync)(path.join(__dirname, '../data/test-prep/strategies.json'), 'utf8'));
const resourceIndex = JSON.parse((0, fs_1.readFileSync)(path.join(__dirname, '../data/test-prep/official-resources.json'), 'utf8'));
/** Publish publisher links, never the downloaded PDF contents or local storage metadata. */
exports.officialPractice = {
    verifiedOn: resourceIndex.verifiedOn,
    notes: { SAT: resourceIndex.notes.SAT, ACT: resourceIndex.notes.ACT },
    resources: resourceIndex.resources.map(({ id, exam, test, kind, title, url, format, sectionQuestions }) => ({ id, exam, test, kind, title, url, format, sectionQuestions })),
};
class PrepError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
exports.PrepError = PrepError;
exports.FORMATS = {
    SAT: [{ section: 'rw', count: 27, seconds: 1920 }, { section: 'rw', count: 27, seconds: 1920 },
        { section: 'math', count: 22, seconds: 2100 }, { section: 'math', count: 22, seconds: 2100 }],
    ACT: [{ section: 'english', count: 50, seconds: 2100 }, { section: 'math', count: 45, seconds: 3000 },
        { section: 'reading', count: 36, seconds: 2400 }, { section: 'science', count: 40, seconds: 2400 }],
};
function examOf(value) {
    if (value !== 'SAT' && value !== 'ACT')
        throw new PrepError('Choose SAT or ACT.');
    return value;
}
function shuffled(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = (0, crypto_1.randomInt)(i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
function availableLessons(exam, science = true) {
    return exports.catalog.lessons.filter(l => l.sections[exam] && (science || l.domain !== 'science'));
}
function block(label, seconds, questions) {
    return { label, seconds, questions, answers: {}, startedAt: null, endedAt: null };
}
/** Fresh IDs first, round-robin skills to avoid a diagnostic dominated by a single topic. */
function selectItems(items, count, seen) {
    const skills = shuffled([...new Set(items.map(q => q.skill))]);
    const queues = skills.map(skill => shuffled(items.filter(q => q.skill === skill))
        .sort((a, b) => Number(seen.has(a.id)) - Number(seen.has(b.id))));
    const selected = [];
    while (selected.length < count && queues.some(q => q.length)) {
        for (const queue of queues) {
            if (queue.length && selected.length < count)
                selected.push(queue.shift());
        }
    }
    if (selected.length < count)
        throw new PrepError('This question bank cannot fill the requested practice.', 409);
    return selected;
}
function createSession(input, seen, focus, now, bank = exports.catalog.questions) {
    const exam = examOf(input.exam), mode = input.mode;
    if (!['diagnostic', 'practice', 'simulation'].includes(mode))
        throw new PrepError('Unknown practice mode.');
    const multiplier = input.multiplier ?? 1;
    if (![1, 1.5, 2].includes(multiplier))
        throw new PrepError('Choose standard, 1.5× or 2× time.');
    if (input.science !== undefined && typeof input.science !== 'boolean')
        throw new PrepError('Invalid science setting.');
    const science = exam === 'ACT' && input.science === true;
    const lessons = availableLessons(exam, science);
    let pool = bank.filter(q => lessons.some(l => l.id === q.skill)).map(q => {
        const format = exports.FORMATS[exam].find(f => f.section === q.sections[exam]);
        return { ...q, targetSeconds: format.seconds / format.count };
    });
    const blocks = [];
    if (mode === 'simulation') {
        for (const [i, f] of exports.FORMATS[exam].entries()) {
            if (f.section === 'science' && !science)
                continue;
            const items = selectItems(pool.filter(q => q.sections[exam] === f.section), f.count, seen);
            pool = pool.filter(q => !items.some(item => item.id === q.id));
            blocks.push(block(`${exam} ${f.section.toUpperCase()} ${exam === 'SAT' ? `module ${i % 2 + 1}` : ''}`.trim(), f.seconds * multiplier, items));
        }
    }
    else {
        if (mode === 'practice') {
            const skills = input.skill ? [input.skill] : focus.slice(0, 3);
            if (!skills.length || skills.some((s) => !lessons.some(l => l.id === s)))
                throw new PrepError('Choose a skill available for this exam.');
            pool = pool.filter(q => skills.includes(q.skill));
        }
        const count = mode === 'diagnostic' ? lessons.length : Math.min(8, pool.length);
        const items = selectItems(pool, count, seen);
        blocks.push(block(mode === 'diagnostic' ? 'Skill diagnostic' : 'Focused practice', items.reduce((sum, q) => sum + q.targetSeconds, 0) * multiplier, items));
    }
    blocks[0].startedAt = now;
    return { version: exports.catalog.version, exam, mode, multiplier, science, blocks, current: 0, status: 'active',
        createdAt: now, completedAt: null, availableAt: now, reflections: {} };
}
/** Never publish grading fields while any section remains open. */
function publicSession(state, id, revision, now) {
    const complete = state.status === 'complete';
    return { ...state, id, revision, serverNow: now, blocks: state.blocks.map((b, i) => ({ ...b,
            questions: complete ? b.questions : state.status === 'active' && i === state.current ? b.questions.map(q => ({
                id: q.id, skill: q.skill, prompt: q.prompt, options: q.options, targetSeconds: q.targetSeconds,
            })) : [],
            count: b.questions.length,
        })) };
}
function applyAnswers(b, input, now) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new PrepError('Answers must be an object.');
    for (const [id, raw] of Object.entries(input)) {
        const q = b.questions.find(item => item.id === id), a = raw;
        if (!q || !a || !(a.choice === null || Number.isInteger(a.choice) && a.choice >= 0 && a.choice < q.options.length))
            throw new PrepError('Invalid answer.');
        if (!Number.isFinite(a.ms) || a.ms < (b.answers[id]?.ms || 0) || a.ms < 0)
            throw new PrepError('Invalid question time.');
        if (!['unsure', 'guess', 'sure'].includes(a.confidence) || typeof a.flagged !== 'boolean')
            throw new PrepError('Invalid confidence or review flag.');
        b.answers[id] = { choice: a.choice, ms: Math.round(a.ms), confidence: a.confidence, flagged: a.flagged };
    }
    const total = Object.values(b.answers).reduce((sum, a) => sum + a.ms, 0);
    if (total > Math.min(b.seconds * 1000, now - b.startedAt) + 1500)
        throw new PrepError('Question time exceeds elapsed working time.');
}
/** Operates on an isolated copy; callers save atomically with a matching revision. */
function changeSession(original, input, now) {
    const state = JSON.parse(JSON.stringify(original));
    if (input.action === 'begin') {
        if (state.status !== 'ready')
            throw new PrepError('This practice has already started.', 409);
        state.status = 'active';
        state.blocks[0].startedAt = now;
        state.availableAt = now;
        return state;
    }
    if (state.status === 'ready')
        throw new PrepError('Begin this practice before answering.');
    if (input.action === 'reflect') {
        if (state.status !== 'complete')
            throw new PrepError('Finish practice before reviewing.');
        if (!state.blocks.some(b => b.questions.some(q => q.id === input.questionId)))
            throw new PrepError('Unknown question.');
        if (!['concept', 'reading', 'calculation', 'time', 'guess', 'other'].includes(input.reason))
            throw new PrepError('Choose a mistake category.');
        if (typeof input.note !== 'string' || input.note.length > 1000)
            throw new PrepError('Use a note of at most 1,000 characters.');
        state.reflections[input.questionId] = { reason: input.reason, note: input.note.trim() };
        return state;
    }
    if (!['save', 'finish', 'continue'].includes(input.action))
        throw new PrepError('Unknown session action.');
    if (state.status === 'complete')
        return state;
    const b = state.blocks[state.current];
    if (input.action === 'continue') {
        if (!b.endedAt || state.current === state.blocks.length - 1)
            throw new PrepError('Finish this section first.');
        if (now < state.availableAt)
            throw new PrepError('The practice break is still running.', 409);
        state.current++;
        state.blocks[state.current].startedAt = now;
        return state;
    }
    if (b.endedAt)
        return state;
    const expired = now >= b.startedAt + b.seconds * 1000;
    if (!expired)
        applyAnswers(b, input.answers || {}, now);
    if (input.action === 'finish' || expired) {
        b.endedAt = Math.min(now, b.startedAt + b.seconds * 1000);
        if (state.current === state.blocks.length - 1) {
            state.status = 'complete';
            state.completedAt = now;
        }
        // Fixed SAT pacing simulation retains the official between-section break.
        if (state.mode === 'simulation' && state.exam === 'SAT' && state.current === 1)
            state.availableAt = now + 600000;
    }
    return state;
}
//# sourceMappingURL=education-prep-model.js.map