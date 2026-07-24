/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-07 12:00:00 | roger.murphy@agenticfederal.us   | Documentation backfill: added file-header change log block and JSDoc on exported members
 */

/**
 * Study Content Tool — Flashcards, Quizzes, Notes, Assignments, TTS
 *
 * The Swiss Army knife for education content generation. Takes any input
 * (transcript, textbook chunk, topic) and produces structured study materials.
 *
 * All education bots share these tools — the lecture-scribe calls them
 * after transcription, the class-tutor calls them during tutoring sessions,
 * and the quiz-master uses them for assessment generation.
 *
 * Integrates with existing PollyService for text-to-speech (read-aloud).
 *
 * PHASE: Little Monsters Education Platform
 * Pattern: exports { 'tool-name': handlerFn } — auto-discovered by app.js
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * DATE           | AUTHOR                    | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-04-19     | roger.murphy@emeraldcoastsystemsgroup.com    | Initial creation — study content generation + TTS
 * ---------------------------------------------------------------------------
 *
 * @module studyContentTool
 * @agent education-foundation (all education bots)
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../../utils/logger');

// ─── Configuration ──────────────────────────────────────────────────────────
const MAX_CONTENT_LENGTH = 50000; // chars — prevent absurdly large inputs

/**
 * Load PollyService for text-to-speech. Lazy-loaded since not all
 * tool invocations need TTS, and PollyService requires AWS credentials.
 *
 * @returns {Object|null} — PollyService instance or null if unavailable
 */
function getPollyService() {
  try {
    const PollyService = require('../../aws/PollyService');
    return new PollyService();
  } catch (error) {
    logger.warn(`[StudyContent] PollyService unavailable: ${error.message}`);
    return null;
  }
}

/**
 * Validate content input — must be a non-empty string within size limits.
 * @param {string} content
 * @param {string} paramName
 * @returns {{ valid: boolean, error?: string }}
 */
function validateContent(content, paramName = 'content') {
  if (!content || typeof content !== 'string') {
    return { valid: false, error: `${paramName} is required and must be a string` };
  }
  if (content.trim().length < 20) {
    return { valid: false, error: `${paramName} is too short — need at least 20 characters of content` };
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return { valid: false, error: `${paramName} exceeds max length (${MAX_CONTENT_LENGTH} chars)` };
  }
  return { valid: true };
}

// ─── Exported Tool Handlers ─────────────────────────────────────────────────

/**
 * Generate flashcards from content (transcript, notes, textbook chapter).
 *
 * Returns structured JSON that can be stored in the flashcard system.
 * Each card includes spaced repetition metadata for the SM-2 algorithm.
 *
 * Note: This tool produces the STRUCTURE for flashcards. The actual content
 * generation is delegated to the calling bot's LLM — this tool formats the
 * bot's output into the standard flashcard schema.
 *
 * @param {Object} params
 * @param {string} params.content — source material to generate flashcards from
 * @param {string} [params.classId] — class identifier
 * @param {string} [params.topic] — topic tag for filtering
 * @param {string} [params.difficulty] — 'easy', 'medium', 'hard'
 * @param {Array<Object>} [params.cards] — pre-generated cards to format
 * @param {string} [params.outputPath] — where to write the flashcard JSON
 * @returns {Promise<Object>} — { success, cardCount, outputPath, cards }
 */
async function generateFlashcards(params = {}) {
  const { content, classId, topic, difficulty, cards, outputPath } = params;

  logger.info(`[StudyContent] generate-flashcards: topic="${topic || 'general'}", class=${classId || 'unknown'}`);

  // If pre-generated cards are provided, just format and save them
  if (cards && Array.isArray(cards) && cards.length > 0) {
    const formatted = formatFlashcards(cards, { classId, topic, difficulty });
    if (outputPath) {
      writeJsonSafe(outputPath, formatted);
    }
    logger.info(`[StudyContent] Formatted ${formatted.length} pre-generated flashcards`);
    return { success: true, cardCount: formatted.length, cards: formatted, outputPath };
  }

  // Otherwise, validate content for LLM-based generation
  const validation = validateContent(content);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Return the content with generation instructions for the calling bot
  // The bot's LLM does the actual content generation — we provide the schema
  const generationPrompt = buildFlashcardPrompt(content, { topic, difficulty });

  return {
    success: true,
    generationPrompt,
    schema: FLASHCARD_SCHEMA,
    instructions: 'Generate flashcards following the schema. Return as JSON array.',
    contentLength: content.length,
  };
}

/**
 * Standard flashcard schema for the Little Monsters platform.
 * All flashcard-generating bots produce cards in this format.
 */
const FLASHCARD_SCHEMA = {
  front: 'string — question, term, or prompt',
  back: 'string — answer, definition, or explanation',
  type: 'string — "term", "concept", "formula", "fill-blank"',
  difficulty: 'number — 1 (easy), 2 (medium), 3 (hard)',
  topic: 'string — topic tag for filtering',
  hints: 'string[] — optional progressive hints',
  // SM-2 spaced repetition fields (initialized at creation)
  repetitions: 0,
  easeFactor: 2.5,
  interval: 1,
  nextReview: 'ISO date string — when to show this card next',
};

/**
 * Format raw card data into the standard flashcard schema with SM-2 defaults.
 * @param {Array<Object>} rawCards
 * @param {Object} meta — { classId, topic, difficulty }
 * @returns {Array<Object>}
 */
function formatFlashcards(rawCards, meta = {}) {
  const now = new Date().toISOString();
  return rawCards.map((card, i) => ({
    id: `fc-${Date.now()}-${i}`,
    front: card.front || card.question || '',
    back: card.back || card.answer || '',
    type: card.type || 'concept',
    difficulty: card.difficulty || 2,
    topic: card.topic || meta.topic || '',
    classId: meta.classId || '',
    hints: card.hints || [],
    // SM-2 initialization
    repetitions: 0,
    easeFactor: 2.5,
    interval: 1,
    nextReview: now,
    createdAt: now,
  }));
}

/**
 * Build the LLM prompt for flashcard generation.
 * @param {string} content — source material
 * @param {Object} options — { topic, difficulty }
 * @returns {string}
 */
function buildFlashcardPrompt(content, options = {}) {
  const difficultyGuide = {
    easy: 'Focus on vocabulary, basic definitions, and simple recall.',
    medium: 'Include conceptual understanding and application questions.',
    hard: 'Emphasize analysis, synthesis, and connections between concepts.',
  };

  return [
    'Generate flashcards from the following content.',
    options.difficulty ? difficultyGuide[options.difficulty] || '' : '',
    options.topic ? `Topic: ${options.topic}` : '',
    '',
    'For each flashcard, provide:',
    '- front: the question or term',
    '- back: the answer or definition',
    '- type: "term", "concept", "formula", or "fill-blank"',
    '- difficulty: 1 (easy), 2 (medium), or 3 (hard)',
    '- hints: array of 1-2 progressive hints',
    '',
    'Return as a JSON array. Generate 5-15 cards depending on content density.',
    '',
    '--- SOURCE CONTENT ---',
    content.substring(0, 10000), // Cap to prevent token overflow
  ].filter(Boolean).join('\n');
}

/**
 * Generate a quiz from class content.
 *
 * Like flashcards, this provides the schema and generation prompt for the
 * calling bot's LLM. The quiz-master bot handles actual question generation.
 *
 * @param {Object} params
 * @param {string} params.content — source material
 * @param {string} [params.classId] — class identifier
 * @param {string[]} [params.topics] — topic filter
 * @param {number} [params.questionCount] — target number of questions (default: 10)
 * @param {string} [params.difficulty] — 'easy', 'medium', 'hard', 'mixed'
 * @param {Array<Object>} [params.questions] — pre-generated questions to format
 * @param {string} [params.outputPath] — where to write the quiz JSON
 * @returns {Promise<Object>}
 */
async function generateQuiz(params = {}) {
  const { content, classId, topics, questionCount, difficulty, questions, outputPath } = params;

  logger.info(`[StudyContent] generate-quiz: topics="${(topics || []).join(',')}", count=${questionCount || 10}`);

  // If pre-generated questions provided, format and save
  if (questions && Array.isArray(questions) && questions.length > 0) {
    const formatted = formatQuizQuestions(questions, { classId, topics });
    if (outputPath) {
      writeJsonSafe(outputPath, { questions: formatted, metadata: { classId, topics, difficulty, generatedAt: new Date().toISOString() } });
    }
    return { success: true, questionCount: formatted.length, questions: formatted, outputPath };
  }

  const validation = validateContent(content);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const generationPrompt = buildQuizPrompt(content, {
    topics,
    questionCount: questionCount || 10,
    difficulty: difficulty || 'mixed',
  });

  return {
    success: true,
    generationPrompt,
    schema: QUIZ_QUESTION_SCHEMA,
    instructions: 'Generate quiz questions following the schema. Return as JSON array.',
  };
}

/**
 * Standard quiz question schema.
 */
const QUIZ_QUESTION_SCHEMA = {
  question: 'string — the question text',
  type: 'string — "multiple-choice", "short-answer", "true-false"',
  options: 'string[] — for multiple-choice, array of 4 options',
  correctAnswer: 'string — the correct answer (or option letter)',
  explanation: 'string — why this answer is correct',
  difficulty: 'number — 1, 2, or 3',
  topic: 'string — topic tag',
  bloomLevel: 'string — "remember", "understand", "apply", "analyze"',
};

/**
 * Format raw quiz questions into the standard schema.
 */
function formatQuizQuestions(rawQuestions, meta = {}) {
  return rawQuestions.map((q, i) => ({
    id: `quiz-${Date.now()}-${i}`,
    question: q.question || '',
    type: q.type || 'multiple-choice',
    options: q.options || [],
    correctAnswer: q.correctAnswer || q.answer || '',
    explanation: q.explanation || '',
    difficulty: q.difficulty || 2,
    topic: q.topic || (meta.topics && meta.topics[0]) || '',
    bloomLevel: q.bloomLevel || 'understand',
    classId: meta.classId || '',
  }));
}

/**
 * Build the LLM prompt for quiz generation.
 */
function buildQuizPrompt(content, options = {}) {
  return [
    `Generate ${options.questionCount || 10} quiz questions from the following content.`,
    `Difficulty: ${options.difficulty || 'mixed'}`,
    options.topics ? `Topics: ${options.topics.join(', ')}` : '',
    '',
    'Question type mix:',
    '- 60% multiple choice (4 options, plausible distractors)',
    '- 25% short answer',
    '- 15% true/false with explanation',
    '',
    "Apply Bloom's taxonomy — include questions at different levels:",
    '- Remember (recall facts)',
    '- Understand (explain concepts)',
    '- Apply (use in new situations)',
    '- Analyze (compare, contrast, evaluate)',
    '',
    'For each question provide: question, type, options (if MC), correctAnswer, explanation, difficulty (1-3), bloomLevel.',
    'Return as a JSON array.',
    '',
    '--- SOURCE CONTENT ---',
    content.substring(0, 10000),
  ].filter(Boolean).join('\n');
}

/**
 * Generate structured study notes from a transcript or content.
 *
 * @param {Object} params
 * @param {string} params.content — transcript or source material
 * @param {string} [params.classId] — class identifier
 * @param {string} [params.lectureDate] — date of lecture
 * @param {string} [params.outputPath] — where to write notes
 * @returns {Promise<Object>}
 */
async function generateStudyNotes(params = {}) {
  const { content, classId, lectureDate, outputPath } = params;

  logger.info(`[StudyContent] generate-study-notes: class=${classId || 'unknown'}, date=${lectureDate || 'unknown'}`);

  const validation = validateContent(content, 'transcript/content');
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const generationPrompt = [
    'Generate structured study notes from the following lecture content.',
    '',
    'Your notes MUST include:',
    '1. **Lecture Overview** — 2-3 sentence summary of what was covered',
    '2. **Key Concepts** — bulleted list of main topics with brief explanations',
    '3. **Definitions** — any new terms introduced, with clear definitions',
    '4. **Formulas/Equations** — any mathematical or scientific formulas mentioned',
    '5. **Examples** — key examples or demonstrations from the lecture',
    '6. **Connections** — how this material connects to previous lectures or textbook chapters',
    '7. **Questions Raised** — any student questions or open questions from the lecture',
    '8. **Study Tips** — what to focus on when reviewing this material',
    '',
    'Format as clean markdown. Use headers, bullets, and bold for key terms.',
    'Keep it concise but complete — a student should be able to study from these notes alone.',
    '',
    '--- LECTURE CONTENT ---',
    content.substring(0, 15000),
  ].join('\n');

  return {
    success: true,
    generationPrompt,
    outputPath: outputPath || null,
    instructions: 'Generate study notes in markdown format. Write to outputPath if provided.',
  };
}

/**
 * Extract assignments and action items from a transcript.
 *
 * @param {Object} params
 * @param {string} params.content — transcript or source material
 * @param {string} [params.classId] — class identifier
 * @param {string} [params.outputPath] — where to write extracted assignments
 * @returns {Promise<Object>}
 */
async function extractAssignments(params = {}) {
  const { content, classId, outputPath } = params;

  logger.info(`[StudyContent] extract-assignments: class=${classId || 'unknown'}`);

  const validation = validateContent(content, 'transcript/content');
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const generationPrompt = [
    'Extract ALL assignments, homework, action items, and announcements from this lecture content.',
    '',
    'Return as JSON with this structure:',
    '{',
    '  "assignments": [',
    '    {',
    '      "title": "descriptive title",',
    '      "description": "what the student needs to do",',
    '      "dueDate": "YYYY-MM-DD or null if not mentioned",',
    '      "type": "homework | reading | project | lab | quiz-prep",',
    '      "resources": ["textbook ch.5", "lecture notes"]',
    '    }',
    '  ],',
    '  "actionItems": [',
    '    "Bring calculator to next class",',
    '    "Review lab safety procedures"',
    '  ],',
    '  "announcements": [',
    '    "No class next Friday — teacher conference"',
    '  ],',
    '  "upcomingTests": [',
    '    {',
    '      "title": "Chapter 5 Quiz",',
    '      "date": "YYYY-MM-DD or null",',
    '      "topics": ["topic1", "topic2"]',
    '    }',
    '  ]',
    '}',
    '',
    'If no assignments/items are found for a category, return an empty array.',
    'Convert relative dates to absolute dates when possible (today is ' + new Date().toISOString().split('T')[0] + ').',
    '',
    '--- LECTURE CONTENT ---',
    content.substring(0, 15000),
  ].join('\n');

  return {
    success: true,
    generationPrompt,
    schema: {
      assignments: '[]',
      actionItems: '[]',
      announcements: '[]',
      upcomingTests: '[]',
    },
    outputPath: outputPath || null,
    instructions: 'Extract assignments and return as JSON. Write to outputPath if provided.',
  };
}

/**
 * Generate a personalized study plan based on performance data.
 *
 * @param {Object} params
 * @param {string} params.classId — class identifier
 * @param {Object} [params.performance] — { weakTopics, quizScores, flashcardAccuracy }
 * @param {Array<Object>} [params.upcomingDates] — upcoming tests/assignments
 * @param {number} [params.availableHours] — weekly study hours available
 * @returns {Promise<Object>}
 */
async function generateStudyPlan(params = {}) {
  const { classId, performance, upcomingDates, availableHours } = params;

  logger.info(`[StudyContent] generate-study-plan: class=${classId || 'unknown'}, hours=${availableHours || 'flexible'}`);

  if (!classId) {
    return { success: false, error: 'classId is required' };
  }

  const generationPrompt = [
    'Create a personalized weekly study plan for this student.',
    '',
    `Class: ${classId}`,
    `Available study hours: ${availableHours || 'flexible'}`,
    '',
    performance ? `Performance data: ${JSON.stringify(performance)}` : 'No performance data available — create a balanced plan.',
    upcomingDates ? `Upcoming deadlines: ${JSON.stringify(upcomingDates)}` : 'No specific deadlines provided.',
    '',
    'The study plan should:',
    '1. Prioritize weak topics (lowest quiz scores, lowest flashcard accuracy)',
    '2. Schedule review sessions before upcoming tests',
    '3. Include break recommendations (Pomodoro style: 25 min study, 5 min break)',
    '4. Suggest specific actions: "Review flashcard set for Chapter 5", "Take practice quiz on photosynthesis"',
    '5. Be realistic and encouraging — do not overwhelm the student',
    '',
    'Return as a daily schedule for the next 7 days in markdown format.',
  ].join('\n');

  return {
    success: true,
    generationPrompt,
    instructions: 'Generate a 7-day study plan in markdown format.',
  };
}

/**
 * Read content aloud using AWS Polly text-to-speech.
 * Wraps the existing PollyService for education bot use.
 *
 * @param {Object} params
 * @param {string} params.text — text to convert to speech
 * @param {string} [params.voice] — Polly voice ID (default: from PollyService config)
 * @param {string} [params.outputPath] — where to save the MP3 file
 * @returns {Promise<Object>} — { success, audioPath, duration }
 */
async function readAloud(params = {}) {
  const { text, voice, outputPath } = params;

  logger.info(`[StudyContent] read-aloud: ${text?.length || 0} chars`);

  if (!text || text.trim().length === 0) {
    return { success: false, error: 'text is required for read-aloud' };
  }

  const polly = getPollyService();
  if (!polly) {
    logger.warn('[StudyContent] PollyService unavailable — TTS disabled');
    return {
      success: false,
      error: 'Text-to-speech is not available. AWS Polly credentials may not be configured.',
      fallback: 'Use browser-based TTS via the TTSService on the frontend.',
    };
  }

  try {
    const audioBuffer = await polly.synthesizeSpeech(text, voice);

    // Write audio file
    const audioPath = outputPath || path.join(
      process.env.WORKSPACE_ROOT || '/tmp',
      `tts-${Date.now()}.mp3`
    );

    const audioDir = path.dirname(audioPath);
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    fs.writeFileSync(audioPath, audioBuffer);

    // Estimate duration (MP3 at 48kbps neural voice: ~6KB per second)
    const estimatedDuration = Math.ceil(audioBuffer.length / 6000);

    logger.info(`[StudyContent] TTS audio written: ${audioPath} (~${estimatedDuration}s)`);

    return {
      success: true,
      audioPath,
      estimatedDuration,
      textLength: text.length,
    };
  } catch (error) {
    logger.error(`[StudyContent] TTS failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Write JSON to a file, creating directories as needed.
 * @param {string} filePath
 * @param {Object} data
 */
function writeJsonSafe(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    logger.info(`[StudyContent] Wrote JSON: ${filePath}`);
  } catch (error) {
    logger.error(`[StudyContent] Failed to write ${filePath}: ${error.message}`);
  }
}

// ─── Export (app.js auto-discovery pattern) ──────────────────────────────────

/**
 * @description Tool registry consumed by app.js auto-discovery: maps the
 * platform's kebab-case tool names to their handler functions so every
 * education bot (lecture-scribe, class-tutor, quiz-master) can invoke a shared,
 * consistent set of study-content generators without each bot re-implementing
 * the schemas, prompts, or TTS wiring. The keys are the public tool identifiers;
 * the values are the async handlers that return generation prompts/schemas (LLM
 * does the actual content creation) or, for read-aloud, synthesized audio.
 * @type {Object<string, Function>}
 */
module.exports = {
  'generate-flashcards': generateFlashcards,
  'generate-quiz': generateQuiz,
  'generate-study-notes': generateStudyNotes,
  'extract-assignments': extractAssignments,
  'generate-study-plan': generateStudyPlan,
  'read-aloud': readAloud,
};
