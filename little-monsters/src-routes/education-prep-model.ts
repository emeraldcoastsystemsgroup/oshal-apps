/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Versioned original curriculum, session blueprints and private grading.
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { randomInt } from 'crypto';
export type Exam = 'SAT' | 'ACT';
export interface Question {
  id: string; family: string; skill: string; sections: Partial<Record<Exam, string>>;
  prompt: string; options: string[]; answer: number; explanation: string; targetSeconds: number;
}
export interface Lesson {
  id: string; title: string; domain: string; sections: Partial<Record<Exam, string>>;
  learn: string; example: string; shortcut: string; caution: string; mistake: string;
  video: string; captions: string; poster: string; teacher: string; seconds: number;
  frames: { title: string; text: string }[]; transcript: { label: string; text: string }[];
}
export const catalog = JSON.parse(readFileSync(path.join(__dirname, '../data/test-prep/catalog.json'), 'utf8')) as {
  version: string; lessons: Lesson[]; questions: Question[];
};
export const research = JSON.parse(readFileSync(path.join(__dirname, '../data/test-prep/strategies.json'), 'utf8'));
const resourceIndex = JSON.parse(readFileSync(path.join(__dirname, '../data/test-prep/official-resources.json'), 'utf8'));
/** Publish publisher links, never the downloaded PDF contents or local storage metadata. */
export const officialPractice = {
  verifiedOn: resourceIndex.verifiedOn,
  notes: { SAT: resourceIndex.notes.SAT, ACT: resourceIndex.notes.ACT },
  resources: resourceIndex.resources.map(({ id, exam, test, kind, title, url, format, sectionQuestions }: any) =>
    ({ id, exam, test, kind, title, url, format, sectionQuestions })),
};
export class PrepError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface Answer { choice: number | null; ms: number; confidence: string; flagged: boolean }
export interface Block {
  label: string; seconds: number; questions: Question[]; answers: Record<string, Answer>;
  startedAt: number | null; endedAt: number | null;
}
export interface Session {
  version: string; exam: Exam; mode: string; multiplier: number; science: boolean;
  blocks: Block[]; current: number; status: 'ready' | 'active' | 'complete'; createdAt: number;
  completedAt: number | null; availableAt: number; reflections: Record<string, { reason: string; note: string }>;
}
export const FORMATS = {
  SAT: [{ section: 'rw', count: 27, seconds: 1920 }, { section: 'rw', count: 27, seconds: 1920 },
    { section: 'math', count: 22, seconds: 2100 }, { section: 'math', count: 22, seconds: 2100 }],
  ACT: [{ section: 'english', count: 50, seconds: 2100 }, { section: 'math', count: 45, seconds: 3000 },
    { section: 'reading', count: 36, seconds: 2400 }, { section: 'science', count: 40, seconds: 2400 }],
};
export function examOf(value: unknown): Exam {
  if (value !== 'SAT' && value !== 'ACT') throw new PrepError('Choose SAT or ACT.');
  return value;
}
function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function availableLessons(exam: Exam, science = true): Lesson[] {
  return catalog.lessons.filter(l => l.sections[exam] && (science || l.domain !== 'science'));
}
function block(label: string, seconds: number, questions: Question[]): Block {
  return { label, seconds, questions, answers: {}, startedAt: null, endedAt: null };
}
/** Fresh IDs first, round-robin skills to avoid a diagnostic dominated by a single topic. */
function selectItems(items: Question[], count: number, seen: Set<string>): Question[] {
  const skills = shuffled([...new Set(items.map(q => q.skill))]);
  const queues = skills.map(skill => shuffled(items.filter(q => q.skill === skill))
    .sort((a, b) => Number(seen.has(a.id)) - Number(seen.has(b.id))));
  const selected: Question[] = [];
  while (selected.length < count && queues.some(q => q.length)) {
    for (const queue of queues) { if (queue.length && selected.length < count) selected.push(queue.shift()!); }
  }
  if (selected.length < count) throw new PrepError('This question bank cannot fill the requested practice.', 409);
  return selected;
}
export function createSession(input: any, seen: Set<string>, focus: string[], now: number, bank: Question[] = catalog.questions): Session {
  const exam = examOf(input.exam), mode = input.mode;
  if (!['diagnostic', 'practice', 'simulation'].includes(mode)) throw new PrepError('Unknown practice mode.');
  const multiplier = input.multiplier ?? 1;
  if (![1, 1.5, 2].includes(multiplier)) throw new PrepError('Choose standard, 1.5× or 2× time.');
  if (input.science !== undefined && typeof input.science !== 'boolean') throw new PrepError('Invalid science setting.');
  const science = exam === 'ACT' && input.science === true;
  const lessons = availableLessons(exam, science);
  let pool = bank.filter(q => lessons.some(l => l.id === q.skill)).map(q => {
    const format = FORMATS[exam].find(f => f.section === q.sections[exam])!;
    return { ...q, targetSeconds: format.seconds / format.count };
  });
  const blocks: Block[] = [];
  if (mode === 'simulation') {
    for (const [i, f] of FORMATS[exam].entries()) {
      if (f.section === 'science' && !science) continue;
      const items = selectItems(pool.filter(q => q.sections[exam] === f.section), f.count, seen);
      pool = pool.filter(q => !items.some(item => item.id === q.id));
      blocks.push(block(`${exam} ${f.section.toUpperCase()} ${exam === 'SAT' ? `module ${i % 2 + 1}` : ''}`.trim(), f.seconds * multiplier, items));
    }
  } else {
    if (mode === 'practice') {
      const skills = input.skill ? [input.skill] : focus.slice(0, 3);
      if (!skills.length || skills.some((s: string) => !lessons.some(l => l.id === s))) throw new PrepError('Choose a skill available for this exam.');
      pool = pool.filter(q => skills.includes(q.skill));
    }
    const count = mode === 'diagnostic' ? lessons.length : Math.min(8, pool.length);
    const items = selectItems(pool, count, seen);
    blocks.push(block(mode === 'diagnostic' ? 'Skill diagnostic' : 'Focused practice', items.reduce((sum, q) => sum + q.targetSeconds, 0) * multiplier, items));
  }
  blocks[0].startedAt = now;
  return { version: catalog.version, exam, mode, multiplier, science, blocks, current: 0, status: 'active',
    createdAt: now, completedAt: null, availableAt: now, reflections: {} };
}
/** Never publish grading fields while any section remains open. */
export function publicSession(state: Session, id: string, revision: number, now: number): any {
  const complete = state.status === 'complete';
  return { ...state, id, revision, serverNow: now, blocks: state.blocks.map((b, i) => ({ ...b,
    questions: complete ? b.questions : state.status === 'active' && i === state.current ? b.questions.map(q => ({
      id: q.id, skill: q.skill, prompt: q.prompt, options: q.options, targetSeconds: q.targetSeconds,
    })) : [],
    count: b.questions.length,
  })) };
}
function applyAnswers(b: Block, input: any, now: number): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PrepError('Answers must be an object.');
  for (const [id, raw] of Object.entries(input)) {
    const q = b.questions.find(item => item.id === id), a = raw as Answer;
    if (!q || !a || !(a.choice === null || Number.isInteger(a.choice) && a.choice >= 0 && a.choice < q.options.length)) throw new PrepError('Invalid answer.');
    if (!Number.isFinite(a.ms) || a.ms < (b.answers[id]?.ms || 0) || a.ms < 0) throw new PrepError('Invalid question time.');
    if (!['unsure', 'guess', 'sure'].includes(a.confidence) || typeof a.flagged !== 'boolean') throw new PrepError('Invalid confidence or review flag.');
    b.answers[id] = { choice: a.choice, ms: Math.round(a.ms), confidence: a.confidence, flagged: a.flagged };
  }
  const total = Object.values(b.answers).reduce((sum, a) => sum + a.ms, 0);
  if (total > Math.min(b.seconds * 1000, now - b.startedAt!) + 1500) throw new PrepError('Question time exceeds elapsed working time.');
}
/** Operates on an isolated copy; callers save atomically with a matching revision. */
export function changeSession(original: Session, input: any, now: number): Session {
  const state: Session = JSON.parse(JSON.stringify(original));
  if (input.action === 'begin') {
    if (state.status !== 'ready') throw new PrepError('This practice has already started.', 409);
    state.status = 'active'; state.blocks[0].startedAt = now; state.availableAt = now;
    return state;
  }
  if (state.status === 'ready') throw new PrepError('Begin this practice before answering.');
  if (input.action === 'reflect') {
    if (state.status !== 'complete') throw new PrepError('Finish practice before reviewing.');
    if (!state.blocks.some(b => b.questions.some(q => q.id === input.questionId))) throw new PrepError('Unknown question.');
    if (!['concept', 'reading', 'calculation', 'time', 'guess', 'other'].includes(input.reason)) throw new PrepError('Choose a mistake category.');
    if (typeof input.note !== 'string' || input.note.length > 1000) throw new PrepError('Use a note of at most 1,000 characters.');
    state.reflections[input.questionId] = { reason: input.reason, note: input.note.trim() };
    return state;
  }
  if (!['save', 'finish', 'continue'].includes(input.action)) throw new PrepError('Unknown session action.');
  if (state.status === 'complete') return state;
  const b = state.blocks[state.current];
  if (input.action === 'continue') {
    if (!b.endedAt || state.current === state.blocks.length - 1) throw new PrepError('Finish this section first.');
    if (now < state.availableAt) throw new PrepError('The practice break is still running.', 409);
    state.current++; state.blocks[state.current].startedAt = now;
    return state;
  }
  if (b.endedAt) return state;
  const expired = now >= b.startedAt! + b.seconds * 1000;
  if (!expired) applyAnswers(b, input.answers || {}, now);
  if (input.action === 'finish' || expired) {
    b.endedAt = Math.min(now, b.startedAt! + b.seconds * 1000);
    if (state.current === state.blocks.length - 1) { state.status = 'complete'; state.completedAt = now; }
    // Fixed SAT pacing simulation retains the official between-section break.
    if (state.mode === 'simulation' && state.exam === 'SAT' && state.current === 1) state.availableAt = now + 600000;
  }
  return state;
}
