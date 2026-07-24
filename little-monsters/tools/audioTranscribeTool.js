/**
 * Audio Transcription Tool — OpenAI Whisper (BYOK sibling)
 *
 * Transcribes lecture recordings to timestamped text using OpenAI Whisper.
 * This is ONE sibling in the voice-providers architecture — the swarm-level
 * default STT is now Gemini via `src/features/voice-providers/` reached over
 * POST /api/voice/transcribe. This tool stays available for operators who
 * prefer Whisper and have an OPENAI_API_KEY to bring.
 *
 * PHASE: Little Monsters Education Platform
 * Pattern: exports { 'tool-name': handlerFn } — auto-discovered by app.js
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 2026-04-19 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com      | Initial creation — Whisper transcription tool
 * 2026-04-21 23:55:00 | roger.murphy@agenticfederal.us   | Clarified as BYOK Whisper sibling; rewrote no-key error message to point at the swarm registry; unblocks tickets by telling the operator exactly what is missing
 * ---------------------------------------------------------------------------
 *
 * @module audioTranscribeTool
 * @agent lecture-scribe, education-foundation
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../../utils/logger');

// ─── Configuration ──────────────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'whisper-1';
const MAX_FILE_SIZE_MB = 25; // Whisper API limit
const SUPPORTED_FORMATS = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg'];

/**
 * Validate that an audio file exists, is within size limits, and is a supported format.
 * @param {string} filePath — absolute path to audio file
 * @returns {{ valid: boolean, error?: string, stats?: fs.Stats }}
 */
function validateAudioFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'audioFilePath is required' };
  }

  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `File not found: ${filePath}` };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported format "${ext}". Supported: ${SUPPORTED_FORMATS.join(', ')}`,
    };
  }

  const stats = fs.statSync(filePath);
  const sizeMB = stats.size / (1024 * 1024);
  if (sizeMB > MAX_FILE_SIZE_MB) {
    return {
      valid: false,
      error: `File too large (${sizeMB.toFixed(1)}MB). Max: ${MAX_FILE_SIZE_MB}MB`,
    };
  }

  return { valid: true, stats };
}

/**
 * Call the OpenAI Whisper API to transcribe an audio file.
 * Uses verbose_json response format for timestamp data.
 *
 * @param {string} filePath — path to audio file
 * @param {string} language — ISO 639-1 language code (default: 'en')
 * @returns {Promise<Object>} — Whisper API response with segments
 */
async function callWhisperAPI(filePath, language = 'en') {
  if (!OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is not set. This tool is the Whisper BYOK sibling — ' +
        'to use it, set OPENAI_API_KEY in .env and restart. To use the swarm default STT ' +
        '(Gemini via GOOGLE_API_KEY), route transcription through POST /api/voice/transcribe on ' +
        'the swarm controller instead of calling this tool directly.',
    );
  }

  // Dynamic import for FormData (Node 18+ built-in or via undici)
  const { FormData, File } = await getFormDataImpl();

  const audioBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const audioFile = new File([audioBuffer], fileName, {
    type: getMimeType(filePath),
  });

  const formData = new FormData();
  formData.append('file', audioFile);
  formData.append('model', WHISPER_MODEL);
  formData.append('language', language);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  logger.info(`[AudioTranscribe] Sending ${fileName} (${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB) to Whisper API`);

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`[AudioTranscribe] Whisper API error: ${response.status} — ${errorBody}`);
    throw new Error(`Whisper API returned ${response.status}: ${errorBody}`);
  }

  const result = await response.json();
  logger.info(`[AudioTranscribe] Transcription complete: ${result.text?.length || 0} chars, ${result.segments?.length || 0} segments`);

  return result;
}

/**
 * Get FormData implementation — uses Node built-in fetch/FormData (18+).
 * Falls back to undici if needed.
 */
async function getFormDataImpl() {
  if (typeof globalThis.FormData !== 'undefined' && typeof globalThis.File !== 'undefined') {
    return { FormData: globalThis.FormData, File: globalThis.File };
  }
  // Fallback: undici (bundled with Node 18+)
  try {
    const undici = require('undici');
    return { FormData: undici.FormData, File: undici.File };
  } catch {
    throw new Error('FormData not available. Requires Node 18+ or undici package.');
  }
}

/**
 * Map file extension to MIME type.
 * @param {string} filePath
 * @returns {string}
 */
function getMimeType(filePath) {
  const mimeMap = {
    '.mp3': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.mpeg': 'audio/mpeg',
    '.mpga': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.webm': 'audio/webm',
    '.ogg': 'audio/ogg',
  };
  return mimeMap[path.extname(filePath).toLowerCase()] || 'audio/mpeg';
}

/**
 * Format seconds to MM:SS timestamp.
 * @param {number} seconds
 * @returns {string}
 */
function formatTimestamp(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Convert Whisper segments into a clean, readable transcript markdown.
 * Groups segments into logical paragraphs based on silence gaps.
 *
 * @param {Object} whisperResult — Whisper verbose_json response
 * @param {Object} meta — { classId, lectureDate, subject }
 * @returns {string} — formatted markdown transcript
 */
function formatTranscript(whisperResult, meta = {}) {
  const segments = whisperResult.segments || [];
  const fullText = whisperResult.text || '';

  if (segments.length === 0) {
    return `# Lecture Transcript\n\n${fullText}`;
  }

  const lines = [
    `# Lecture Transcript`,
    ``,
    `**Date:** ${meta.lectureDate || new Date().toISOString().split('T')[0]}`,
    meta.subject ? `**Subject:** ${meta.subject}` : null,
    meta.classId ? `**Class:** ${meta.classId}` : null,
    `**Duration:** ${formatTimestamp(segments[segments.length - 1].end)}`,
    `**Segments:** ${segments.length}`,
    ``,
    `---`,
    ``,
  ].filter(Boolean);

  // Group segments into paragraphs (gap > 2 seconds = new paragraph)
  let currentParagraph = [];
  let paragraphStart = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (paragraphStart === null) {
      paragraphStart = seg.start;
    }

    currentParagraph.push(seg.text.trim());

    const nextSeg = segments[i + 1];
    const hasGap = nextSeg && (nextSeg.start - seg.end) > 2.0;
    const isLast = i === segments.length - 1;

    if (hasGap || isLast) {
      lines.push(`**[${formatTimestamp(paragraphStart)}]** ${currentParagraph.join(' ')}`);
      lines.push('');
      currentParagraph = [];
      paragraphStart = null;
    }
  }

  return lines.join('\n');
}

// ─── Exported Tool Handlers ─────────────────────────────────────────────────

/**
 * Transcribe a lecture recording to structured markdown.
 *
 * @param {Object} params
 * @param {string} params.audioFilePath — path to audio file in workspace
 * @param {string} [params.classId] — class identifier for metadata
 * @param {string} [params.lectureDate] — date of lecture (YYYY-MM-DD)
 * @param {string} [params.subject] — subject name
 * @param {string} [params.language] — ISO 639-1 code (default: 'en')
 * @param {string} [params.outputPath] — where to write the transcript file
 * @returns {Promise<Object>} — { success, transcript, outputPath, duration, segmentCount }
 */
async function transcribeLecture(params = {}) {
  const { audioFilePath, classId, lectureDate, subject, language, outputPath } = params;

  logger.info(`[AudioTranscribe] transcribe-lecture called: ${audioFilePath} (class: ${classId || 'unknown'})`);

  // Validate input
  const validation = validateAudioFile(audioFilePath);
  if (!validation.valid) {
    logger.warn(`[AudioTranscribe] Validation failed: ${validation.error}`);
    return { success: false, error: validation.error };
  }

  try {
    // Call Whisper API
    const whisperResult = await callWhisperAPI(audioFilePath, language || 'en');

    // Format into readable transcript
    const transcript = formatTranscript(whisperResult, {
      classId,
      lectureDate,
      subject,
    });

    // Determine output path
    const date = lectureDate || new Date().toISOString().split('T')[0];
    const finalOutputPath = outputPath || path.join(
      path.dirname(audioFilePath),
      `TRANSCRIPT-${date}.md`
    );

    // Write transcript to workspace
    const outputDir = path.dirname(finalOutputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(finalOutputPath, transcript, 'utf-8');

    const segments = whisperResult.segments || [];
    const duration = segments.length > 0
      ? formatTimestamp(segments[segments.length - 1].end)
      : 'unknown';

    logger.info(`[AudioTranscribe] Transcript written: ${finalOutputPath} (${duration}, ${segments.length} segments)`);

    return {
      success: true,
      transcript,
      outputPath: finalOutputPath,
      duration,
      segmentCount: segments.length,
      rawText: whisperResult.text,
    };
  } catch (error) {
    logger.error(`[AudioTranscribe] Transcription failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ─── Export (app.js auto-discovery pattern) ──────────────────────────────────

module.exports = {
  'transcribe-lecture': transcribeLecture,
};
